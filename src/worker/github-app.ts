import type { WorkerEnv } from './welfare-state'
import type { WelfareState } from '~/shared/welfare-types'
import { createUserInviteCode, normalizeSystemConfig } from '~/shared/welfare-domain'
import { assertSafeExternalUrl } from './auth'
import { bytesToHex, decryptSecret, encryptSecret } from './crypto'
import { authenticatedUserId, createSessionCookie } from './session'
import { getPool, readWelfareState, readWelfareStateRecord, shouldUseD1, writeWelfareState } from './welfare-state'

interface GitHubAppConfigRecord {
  id: string
  enabled: number | boolean
  app_name: string
  app_slug: string
  client_id: string
  client_secret?: string | null
  client_secret_encrypted?: string | null
  callback_url: string
  authorize_url: string
  token_url: string
  api_base_url: string
  scopes: string
}

interface GitHubAppConfigPayload {
  enabled?: boolean
  appName?: string
  appSlug?: string
  clientId?: string
  clientSecret?: string
  callbackUrl?: string
  authorizeUrl?: string
  tokenUrl?: string
  apiBaseUrl?: string
  scopes?: string
}

interface GitHubAuthorizePayload {
  redirect?: string
  mode?: 'login' | 'connect'
}

interface GitHubCallbackPayload {
  code?: string
  state?: string
}

interface GitHubTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

interface GitHubUserResponse {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url?: string | null
}

interface GitHubEmailResponse {
  email: string
  primary: boolean
  verified: boolean
  visibility?: string | null
}

interface GitHubRepoResponse {
  full_name: string
  private: boolean
  html_url?: string
}

interface GithubOAuthState {
  redirect: string
  mode: 'login' | 'connect'
  localUserId?: string
  createdAt: number
}

const DEFAULT_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const DEFAULT_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_SCOPES = 'read:user user:email public_repo'
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const MAX_JSON_BYTES = 64 * 1024
const stateSigner = {
  secret: '',
  key: undefined as CryptoKey | undefined,
}

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : '服务端错误'
  return json({ error: message }, message === '请先登录' ? 401 : status)
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function defaultCallbackUrl(request: Request) {
  return `${getRequestOrigin(request)}/api/github-app/callback`
}

function getRuntimeCallbackUrl(request: Request, configured?: string) {
  const callbackUrl = configured?.trim()
  if (!callbackUrl)
    return defaultCallbackUrl(request)
  if (callbackUrl.startsWith('/'))
    return new URL(callbackUrl, getRequestOrigin(request)).toString()
  return callbackUrl
}

function maskSecret(value?: string) {
  const text = value?.trim() ?? ''
  if (!text)
    return ''
  if (text.length <= 8)
    return '••••'
  return `${text.slice(0, 4)}••••${text.slice(-4)}`
}

function encryptionSecret(env: WorkerEnv) {
  return env.NOTIFY_SECRET_KEY ?? ''
}

async function decryptOptionalSecret(value: string | null | undefined, env: WorkerEnv) {
  if (!value)
    return ''
  try {
    return await decryptSecret(value, encryptionSecret(env))
  }
  catch {
    return ''
  }
}

async function resolveStoredClientSecret(stored: GitHubAppConfigRecord | null | undefined, env: WorkerEnv) {
  return await decryptOptionalSecret(stored?.client_secret_encrypted, env) || stored?.client_secret || ''
}

async function readJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_JSON_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as T
}

function normalizeRedirect(input?: string) {
  if (!input || !input.startsWith('/') || input.startsWith('//'))
    return '/dashboard/open-source'
  if (input.startsWith('/login'))
    return '/dashboard/open-source'
  return input
}

function base64UrlEncodeText(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeText(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function getStateSecret(env: WorkerEnv, settings: { clientSecret: string }) {
  return env.NOTIFY_SECRET_KEY || settings.clientSecret
}

async function getSigningKey(secret: string) {
  if (stateSigner.key && stateSigner.secret === secret)
    return stateSigner.key

  stateSigner.secret = secret
  stateSigner.key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return stateSigner.key
}

async function signStatePayload(secret: string, payload: string) {
  const key = await getSigningKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return bytesToHex(new Uint8Array(signature))
}

async function createOAuthState(env: WorkerEnv, settings: { clientSecret: string }, input: Omit<GithubOAuthState, 'createdAt'>) {
  const payload = base64UrlEncodeText(JSON.stringify({
    ...input,
    createdAt: Date.now(),
  }))
  const signature = await signStatePayload(getStateSecret(env, settings), payload)
  return `${payload}.${signature}`
}

async function consumeOAuthState(env: WorkerEnv, settings: { clientSecret: string }, stateText?: string) {
  if (!stateText)
    throw new Error('缺少 GitHub OAuth state')

  const [payload, signature] = stateText.split('.')
  if (!payload || !signature)
    throw new Error('GitHub OAuth state 格式无效')

  const expected = await signStatePayload(getStateSecret(env, settings), payload)
  if (signature !== expected)
    throw new Error('GitHub OAuth state 签名无效，请重新授权')

  const state = JSON.parse(base64UrlDecodeText(payload)) as GithubOAuthState
  if (!state.createdAt || Date.now() - state.createdAt > OAUTH_STATE_TTL_MS)
    throw new Error('GitHub OAuth state 已失效，请重新授权')

  return state
}

function redirectWithMessage(request: Request, path: string, params: Record<string, string>, headers?: HeadersInit) {
  const redirectUrl = new URL(path, getRequestOrigin(request))
  for (const [key, value] of Object.entries(params))
    redirectUrl.searchParams.set(key, value)
  return new Response(null, {
    status: 302,
    headers: {
      location: redirectUrl.toString(),
      ...headers,
    },
  })
}

async function ensureGitHubAppSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists github_app_config (
          id text primary key,
          enabled integer not null default 0,
          app_name text not null default '',
          app_slug text not null default '',
          client_id text not null,
          client_secret text not null,
          client_secret_encrypted text,
          callback_url text not null,
          authorize_url text not null,
          token_url text not null,
          api_base_url text not null,
          scopes text not null,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('alter table github_app_config add column client_secret_encrypted text')
      .run()
      .catch(() => undefined)
    return
  }

  await getPool(env).query(`
    create table if not exists github_app_config (
      id text primary key,
      enabled boolean not null default false,
      app_name text not null default '',
      app_slug text not null default '',
      client_id text not null,
      client_secret text not null,
      client_secret_encrypted text,
      callback_url text not null,
      authorize_url text not null,
      token_url text not null,
      api_base_url text not null,
      scopes text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await getPool(env).query('alter table github_app_config add column if not exists client_secret_encrypted text')
}

async function getStoredGitHubAppConfig(env: WorkerEnv) {
  await ensureGitHubAppSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from github_app_config where id = ?1')
      .bind('default')
      .first<GitHubAppConfigRecord>()
  }

  const result = await getPool(env).query<GitHubAppConfigRecord>(
    'select * from github_app_config where id = $1',
    ['default'],
  )
  return result.rows[0] ?? null
}

async function upsertStoredGitHubAppConfig(env: WorkerEnv, payload: Required<GitHubAppConfigPayload>) {
  await ensureGitHubAppSchema(env)
  const clientSecretEncrypted = await encryptSecret(payload.clientSecret, encryptionSecret(env))

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into github_app_config (
          id, enabled, app_name, app_slug, client_id, client_secret, client_secret_encrypted, callback_url,
          authorize_url, token_url, api_base_url, scopes, updated_at
        ) values ('default', ?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, ?10, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          app_name = excluded.app_name,
          app_slug = excluded.app_slug,
          client_id = excluded.client_id,
          client_secret = '',
          client_secret_encrypted = excluded.client_secret_encrypted,
          callback_url = excluded.callback_url,
          authorize_url = excluded.authorize_url,
          token_url = excluded.token_url,
          api_base_url = excluded.api_base_url,
          scopes = excluded.scopes,
          updated_at = current_timestamp
      `)
      .bind(
        payload.enabled ? 1 : 0,
        payload.appName,
        payload.appSlug,
        payload.clientId,
        clientSecretEncrypted,
        payload.callbackUrl,
        payload.authorizeUrl,
        payload.tokenUrl,
        payload.apiBaseUrl,
        payload.scopes,
      )
      .run()
    return
  }

  await getPool(env).query(`
    insert into github_app_config (
      id, enabled, app_name, app_slug, client_id, client_secret, client_secret_encrypted, callback_url,
      authorize_url, token_url, api_base_url, scopes, updated_at
    ) values ('default', $1, $2, $3, $4, '', $5, $6, $7, $8, $9, $10, now())
    on conflict (id)
    do update set
      enabled = excluded.enabled,
      app_name = excluded.app_name,
      app_slug = excluded.app_slug,
      client_id = excluded.client_id,
      client_secret = '',
      client_secret_encrypted = excluded.client_secret_encrypted,
      callback_url = excluded.callback_url,
      authorize_url = excluded.authorize_url,
      token_url = excluded.token_url,
      api_base_url = excluded.api_base_url,
      scopes = excluded.scopes,
      updated_at = now()
  `, [
    payload.enabled,
    payload.appName,
    payload.appSlug,
    payload.clientId,
    clientSecretEncrypted,
    payload.callbackUrl,
    payload.authorizeUrl,
    payload.tokenUrl,
    payload.apiBaseUrl,
    payload.scopes,
  ])
}

async function getEffectiveGitHubAppSettings(env: WorkerEnv, request: Request) {
  const stored = await getStoredGitHubAppConfig(env)
  const clientSecret = await resolveStoredClientSecret(stored, env)

  return {
    enabled: stored
      ? !!stored.enabled
      : false,
    appName: stored?.app_name || '',
    appSlug: stored?.app_slug || '',
    clientId: stored?.client_id || '',
    clientSecret,
    callbackUrl: getRuntimeCallbackUrl(request, stored?.callback_url || ''),
    authorizeUrl: stored?.authorize_url || DEFAULT_AUTHORIZE_URL,
    tokenUrl: stored?.token_url || DEFAULT_TOKEN_URL,
    apiBaseUrl: stored?.api_base_url || DEFAULT_API_BASE_URL,
    scopes: stored?.scopes || DEFAULT_SCOPES,
    source: stored ? 'admin' : 'empty',
  }
}

function isConfigured(settings: { clientId: string, clientSecret: string }) {
  return !!(settings.clientId.trim() && settings.clientSecret.trim())
}

async function assertAdminRequest(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  if (!Array.isArray(state.users))
    throw new Error('用户状态未初始化')

  const userId = await authenticatedUserId(request, env)
  const user = state.users.find(item => item.id === userId)
  if (!user || user.role !== 'admin')
    throw new Error('需要管理员权限')
}

async function handleGitHubAppConfig(request: Request, env: WorkerEnv) {
  if (request.method === 'GET') {
    const userId = await authenticatedUserId(request, env)
    if (!userId)
      throw new Error('请先登录')

    const settings = await getEffectiveGitHubAppSettings(env, request)
    const state = await readWelfareState(env) as Partial<WelfareState>
    const user = Array.isArray(state.users) ? state.users.find(item => item.id === userId) : undefined
    if (user?.role !== 'admin') {
      return json({
        enabled: settings.enabled,
        configured: isConfigured(settings),
        appName: settings.appName,
        appSlug: settings.appSlug,
        clientId: '',
        clientSecretMasked: '',
        callbackUrl: settings.callbackUrl,
        authorizeUrl: '',
        tokenUrl: '',
        apiBaseUrl: '',
        scopes: settings.scopes,
        source: settings.source,
      })
    }

    return json({
      enabled: settings.enabled,
      configured: isConfigured(settings),
      appName: settings.appName,
      appSlug: settings.appSlug,
      clientId: settings.clientId,
      clientSecretMasked: maskSecret(settings.clientSecret),
      callbackUrl: settings.callbackUrl,
      authorizeUrl: settings.authorizeUrl,
      tokenUrl: settings.tokenUrl,
      apiBaseUrl: settings.apiBaseUrl,
      scopes: settings.scopes,
      source: settings.source,
    })
  }

  if (request.method === 'PUT') {
    await assertAdminRequest(request, env)
    const payload = await readJson<GitHubAppConfigPayload>(request)
    const stored = await getStoredGitHubAppConfig(env)
    const storedClientSecret = await resolveStoredClientSecret(stored, env)
    const clientId = payload.clientId?.trim() || stored?.client_id || ''
    const clientSecretForStorage = payload.clientSecret?.trim() || storedClientSecret
    const clientSecretForRuntime = clientSecretForStorage
    const config = {
      enabled: payload.enabled !== false,
      appName: payload.appName?.trim() ?? stored?.app_name ?? '',
      appSlug: payload.appSlug?.trim() ?? stored?.app_slug ?? '',
      clientId,
      clientSecret: clientSecretForStorage,
      callbackUrl: payload.callbackUrl?.trim() || stored?.callback_url || defaultCallbackUrl(request),
      authorizeUrl: payload.authorizeUrl?.trim() ? assertSafeExternalUrl(payload.authorizeUrl).toString() : stored?.authorize_url || DEFAULT_AUTHORIZE_URL,
      tokenUrl: payload.tokenUrl?.trim() ? assertSafeExternalUrl(payload.tokenUrl).toString() : stored?.token_url || DEFAULT_TOKEN_URL,
      apiBaseUrl: payload.apiBaseUrl?.trim() ? assertSafeExternalUrl(payload.apiBaseUrl).toString().replace(/\/+$/, '') : stored?.api_base_url || DEFAULT_API_BASE_URL,
      scopes: payload.scopes?.trim() || stored?.scopes || DEFAULT_SCOPES,
    }

    if (!clientId)
      throw new Error('请填写 GitHub App Client ID')
    if (!clientSecretForRuntime)
      throw new Error('请填写 GitHub App Client Secret')

    await upsertStoredGitHubAppConfig(env, config)

    return json({
      ok: true,
      message: 'GitHub App 配置已保存到服务端配置；环境变量仅作为旧部署兜底。',
      env: {
        GITHUB_APP_ENABLED: config.enabled ? 'true' : 'false',
        GITHUB_APP_NAME: config.appName,
        GITHUB_APP_SLUG: config.appSlug,
        GITHUB_APP_CLIENT_ID: config.clientId,
        GITHUB_APP_CALLBACK_URL: config.callbackUrl,
        GITHUB_APP_SCOPES: config.scopes,
      },
    })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

async function handleGitHubAuthorize(request: Request, env: WorkerEnv) {
  if (request.method !== 'POST')
    return json({ error: 'Method Not Allowed' }, 405)

  const settings = await getEffectiveGitHubAppSettings(env, request)
  if (!settings.enabled)
    throw new Error('GitHub App 授权当前未启用，请联系管理员')
  if (!isConfigured(settings))
    throw new Error('GitHub App 尚未配置 Client ID / Secret')

  const payload = await readJson<GitHubAuthorizePayload>(request)
  const mode = payload.mode === 'login' ? 'login' : 'connect'
  const stateSnapshot = await readWelfareState(env) as Partial<WelfareState>
  const systemConfig = normalizeSystemConfig(stateSnapshot.systemConfig)
  if (!systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (mode === 'login' && !systemConfig.loginEnabled)
    throw new Error(systemConfig.loginClosedReason)

  const redirect = normalizeRedirect(payload.redirect)
  const state = await createOAuthState(env, settings, {
    redirect,
    mode,
    localUserId: await authenticatedUserId(request, env) || undefined,
  })
  const authorizeUrl = new URL(settings.authorizeUrl)
  authorizeUrl.searchParams.set('client_id', settings.clientId)
  authorizeUrl.searchParams.set('redirect_uri', settings.callbackUrl)
  authorizeUrl.searchParams.set('scope', settings.scopes)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('allow_signup', 'true')

  return json({ authorizeUrl: authorizeUrl.toString(), state })
}

async function exchangeCodeForToken(settings: Awaited<ReturnType<typeof getEffectiveGitHubAppSettings>>, code: string) {
  const response = await fetch(assertSafeExternalUrl(settings.tokenUrl).toString(), {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Touch-Great-Welfare',
    },
    body: JSON.stringify({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code,
      redirect_uri: settings.callbackUrl,
    }),
  })

  const payload = await response.json() as GitHubTokenResponse
  if (!response.ok || payload.error || !payload.access_token)
    throw new Error(payload.error_description || payload.error || 'GitHub 授权换取 Token 失败')

  return payload.access_token
}

async function githubApi<T>(settings: Awaited<ReturnType<typeof getEffectiveGitHubAppSettings>>, token: string, path: string) {
  const response = await fetch(new URL(path, assertSafeExternalUrl(settings.apiBaseUrl).toString()).toString(), {
    headers: {
      'accept': 'application/vnd.github+json',
      'authorization': `Bearer ${token}`,
      'user-agent': 'Touch-Great-Welfare',
      'x-github-api-version': '2022-11-28',
    },
  })

  if (!response.ok)
    throw new Error(`GitHub API 请求失败：${response.status}`)

  return response.json() as Promise<T>
}

function pickEmail(user: GitHubUserResponse, emails: GitHubEmailResponse[]) {
  if (user.email)
    return user.email
  return emails.find(item => item.primary && item.verified)?.email
    || emails.find(item => item.verified)?.email
    || `${user.login}@users.noreply.github.com`
}

function createUserId(githubId: number) {
  return `github_${githubId}`
}

function now() {
  return new Date().toISOString()
}

async function persistAuthorizedUser(env: WorkerEnv, oauthState: GithubOAuthState, user: GitHubUserResponse, emails: GitHubEmailResponse[], repos: GitHubRepoResponse[]) {
  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  if (!Array.isArray(state.users) || !Array.isArray(state.transactions))
    throw new Error('用户状态未初始化')

  const systemConfig = normalizeSystemConfig(state.systemConfig)
  if (!systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (oauthState.mode === 'login' && !systemConfig.loginEnabled)
    throw new Error(systemConfig.loginClosedReason)

  const email = pickEmail(user, emails).toLowerCase()
  const githubId = createUserId(user.id)
  const githubAccountId = String(user.id)
  const publicRepos = repos
    .filter(repo => !repo.private)
    .map(repo => repo.full_name)
  const selectedRepo = publicRepos[0] ?? ''

  let localUser = oauthState.mode === 'connect' && oauthState.localUserId
    ? state.users.find(item => item.id === oauthState.localUserId)
    : undefined

  localUser ||= state.users.find(item => item.id === githubId || item.profile.githubId === githubAccountId)
    || state.users.find(item => item.profile.email.toLowerCase() === email)

  if (!localUser) {
    if (!systemConfig.registrationEnabled)
      throw new Error(systemConfig.registrationClosedReason)

    localUser = {
      id: githubId,
      role: 'user',
      profile: {
        displayName: user.name?.trim() || user.login,
        email,
        inviteCode: createUserInviteCode(githubId),
        avatar: user.avatar_url ?? undefined,
        githubId: githubAccountId,
        githubUsername: user.login,
        selectedRepo,
        githubRepos: publicRepos,
        githubAuthorized: true,
        githubAuthorizedAt: now(),
        studentVerified: false,
      },
      points: 0,
      accountStatus: 'active',
      createdAt: now(),
      lastLoginAt: now(),
    }
    state.users.push(localUser)
  }
  else {
    localUser.lastLoginAt = now()
    localUser.profile = {
      ...localUser.profile,
      displayName: localUser.profile.displayName || user.name?.trim() || user.login,
      email: localUser.profile.email || email,
      inviteCode: localUser.profile.inviteCode || createUserInviteCode(localUser.id),
      avatar: user.avatar_url ?? localUser.profile.avatar,
      githubId: githubAccountId,
      githubUsername: user.login,
      selectedRepo: localUser.profile.selectedRepo && publicRepos.includes(localUser.profile.selectedRepo)
        ? localUser.profile.selectedRepo
        : selectedRepo,
      githubRepos: publicRepos,
      githubAuthorized: true,
      githubAuthorizedAt: now(),
    }
  }

  delete state.currentUserId
  await writeWelfareState(env, state, { expectedVersion: record.version })

  return localUser
}

async function completeGitHubAuthorization(request: Request, env: WorkerEnv, code: string, stateNonce: string) {
  const settings = await getEffectiveGitHubAppSettings(env, request)
  if (!settings.enabled || !isConfigured(settings))
    throw new Error('GitHub App 授权未启用或配置不完整')

  const oauthState = await consumeOAuthState(env, settings, stateNonce)

  const token = await exchangeCodeForToken(settings, code)
  const [user, emails, repos] = await Promise.all([
    githubApi<GitHubUserResponse>(settings, token, '/user'),
    githubApi<GitHubEmailResponse[]>(settings, token, '/user/emails'),
    githubApi<GitHubRepoResponse[]>(settings, token, '/user/repos?per_page=100&sort=updated&type=owner'),
  ])

  const localUser = await persistAuthorizedUser(env, oauthState, user, emails, repos)
  return {
    redirect: oauthState.redirect,
    userId: localUser.id,
  }
}

async function handleGitHubCallback(request: Request, env: WorkerEnv) {
  const url = new URL(request.url)

  if (request.method === 'GET') {
    try {
      const error = url.searchParams.get('error')
      if (error)
        throw new Error(url.searchParams.get('error_description') || error)

      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code)
        throw new Error('GitHub 未返回授权 code')

      const result = await completeGitHubAuthorization(request, env, code, state)
      return redirectWithMessage(request, result.redirect, {
        github_auth: 'success',
      }, {
        'set-cookie': await createSessionCookie(request, env, result.userId),
      })
    }
    catch (error) {
      return redirectWithMessage(request, '/dashboard/open-source', {
        github_auth: 'error',
        message: error instanceof Error ? error.message : 'GitHub 授权失败',
      })
    }
  }

  if (request.method === 'POST') {
    const payload = await readJson<GitHubCallbackPayload>(request)
    const result = await completeGitHubAuthorization(request, env, payload.code ?? '', payload.state ?? '')
    return json({ ok: true, redirect: result.redirect }, 200, {
      'set-cookie': await createSessionCookie(request, env, result.userId),
    })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

export async function handleGitHubAppRequest(request: Request, env: WorkerEnv) {
  const url = new URL(request.url)

  try {
    if (url.pathname === '/api/github-app/config')
      return await handleGitHubAppConfig(request, env)
    if (url.pathname === '/api/github-app/authorize')
      return await handleGitHubAuthorize(request, env)
    if (url.pathname === '/api/github-app/callback')
      return await handleGitHubCallback(request, env)

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}
