import type { WorkerEnv } from './welfare-state'
import type { WelfareState } from '~/shared/welfare-types'
import { createUserInviteCode, normalizeSystemConfig } from '~/shared/welfare-domain'
import { assertAdminRequest, assertSafeExternalUrl, errorResponse, json, maskSecret, now, readJson } from './auth'
import { bytesToHex, decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { createSessionCookie } from './session'
import { getPool, readWelfareState, readWelfareStateRecord, shouldUseD1, writeWelfareState } from './welfare-state'

interface OAuthProviderRecord {
  id: string
  enabled: number | boolean
  name: string
  logo_url?: string | null
  client_id: string
  client_secret?: string | null
  client_secret_encrypted?: string | null
  callback_url: string
  authorize_url: string
  token_url: string
  userinfo_url: string
  issuer_url?: string | null
  scopes: string
}

interface OAuthProviderPayload {
  id?: string
  enabled?: boolean
  name?: string
  logoUrl?: string
  clientId?: string
  clientSecret?: string
  callbackUrl?: string
  authorizeUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  issuerUrl?: string
  scopes?: string
}

interface AuthorizePayload {
  providerId?: string
  redirect?: string
}

interface CallbackPayload {
  code?: string
  state?: string
}

interface OAuthState {
  providerId: string
  redirect: string
  createdAt: number
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}

interface UserInfoResponse {
  sub?: string
  id?: string | number
  email?: string
  email_verified?: boolean
  name?: string
  username?: string
  preferred_username?: string
  nickname?: string
  picture?: string
  avatar_url?: string
  avatar_template?: string
}

const DEFAULT_SCOPES = 'openid profile email'
const LINUX_DO_PROVIDER_ID = 'linux-do'
const BUILTIN_OAUTH_PROVIDERS: OAuthProviderRecord[] = [
  {
    id: LINUX_DO_PROVIDER_ID,
    enabled: false,
    name: 'LINUX DO',
    logo_url: '',
    client_id: '',
    client_secret: '',
    callback_url: '/api/oauth/callback',
    authorize_url: 'https://connect.linux.do/oauth2/authorize',
    token_url: 'https://connect.linux.do/oauth2/token',
    userinfo_url: 'https://connect.linux.do/api/user',
    issuer_url: 'https://linux.do',
    scopes: '',
  },
]
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const stateSigner = {
  secret: '',
  key: undefined as CryptoKey | undefined,
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function defaultCallbackUrl(request: Request) {
  return `${getRequestOrigin(request)}/api/oauth/callback`
}

function runtimeUrl(request: Request, configured?: string) {
  const value = configured?.trim()
  if (!value)
    return defaultCallbackUrl(request)
  if (value.startsWith('/'))
    return new URL(value, getRequestOrigin(request)).toString()
  return value
}

function normalizeRedirect(input?: string) {
  if (!input || !input.startsWith('/') || input.startsWith('//'))
    return '/dashboard/apply'
  if (input.startsWith('/login') || input.startsWith('/init'))
    return '/dashboard/apply'
  return input
}

function normalizeProviderId(input?: string) {
  const id = input?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') ?? ''
  return id.replace(/^-+|-+$/g, '')
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

async function resolveStoredProviderSecret(stored: OAuthProviderRecord | null | undefined, env: WorkerEnv) {
  return await decryptOptionalSecret(stored?.client_secret_encrypted, env) || stored?.client_secret || ''
}

function getStateSecret(env: WorkerEnv, provider: Pick<OAuthProviderRecord, 'client_secret'>) {
  return env.NOTIFY_SECRET_KEY || provider.client_secret || ''
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

async function createOAuthState(env: WorkerEnv, provider: OAuthProviderRecord, input: Omit<OAuthState, 'createdAt'>) {
  const payload = base64UrlEncodeText(JSON.stringify({
    ...input,
    createdAt: Date.now(),
  }))
  const signature = await signStatePayload(getStateSecret(env, provider), payload)
  return `${payload}.${signature}`
}

async function consumeOAuthState(env: WorkerEnv, provider: OAuthProviderRecord, stateText?: string) {
  if (!stateText)
    throw new Error('缺少 OAuth state')

  const [payload, signature] = stateText.split('.')
  if (!payload || !signature)
    throw new Error('OAuth state 格式无效')

  const expected = await signStatePayload(getStateSecret(env, provider), payload)
  if (signature !== expected)
    throw new Error('OAuth state 签名无效，请重新登录')

  const state = JSON.parse(base64UrlDecodeText(payload)) as OAuthState
  if (state.providerId !== provider.id)
    throw new Error('OAuth state 与登录源不匹配')
  if (!state.createdAt || Date.now() - state.createdAt > OAUTH_STATE_TTL_MS)
    throw new Error('OAuth state 已失效，请重新登录')
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

async function ensureOAuthSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists oauth_provider_config (
          id text primary key,
          enabled integer not null default 0,
          name text not null,
          logo_url text not null default '',
          client_id text not null,
          client_secret text not null,
          client_secret_encrypted text,
          callback_url text not null,
          authorize_url text not null,
          token_url text not null,
          userinfo_url text not null,
          issuer_url text not null default '',
          scopes text not null,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('alter table oauth_provider_config add column logo_url text not null default ""')
      .run()
      .catch(() => undefined)
    await env.LOCAL_DB!
      .prepare('alter table oauth_provider_config add column client_secret_encrypted text')
      .run()
      .catch(() => undefined)
    return
  }

  await getPool(env).query(`
    create table if not exists oauth_provider_config (
      id text primary key,
      enabled boolean not null default false,
      name text not null,
      client_id text not null,
      client_secret text not null,
      client_secret_encrypted text,
      callback_url text not null,
      authorize_url text not null,
      token_url text not null,
      userinfo_url text not null,
      issuer_url text not null default '',
      scopes text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)

  await getPool(env).query('alter table oauth_provider_config add column if not exists logo_url text not null default \'\'')
  await getPool(env).query('alter table oauth_provider_config add column if not exists client_secret_encrypted text')
}

async function listStoredProviders(env: WorkerEnv) {
  await ensureOAuthSchema(env)
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare('select * from oauth_provider_config order by name asc')
      .all<OAuthProviderRecord>()
    return result.results ?? []
  }

  const result = await getPool(env).query<OAuthProviderRecord>('select * from oauth_provider_config order by name asc')
  return result.rows
}

function mergeBuiltinProviders(providers: OAuthProviderRecord[]) {
  const providerById = new Map(providers.map(provider => [provider.id, provider]))
  for (const provider of BUILTIN_OAUTH_PROVIDERS) {
    if (!providerById.has(provider.id))
      providerById.set(provider.id, provider)
  }
  return [...providerById.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function getStoredProvider(env: WorkerEnv, id: string) {
  await ensureOAuthSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from oauth_provider_config where id = ?1')
      .bind(id)
      .first<OAuthProviderRecord>()
  }

  const result = await getPool(env).query<OAuthProviderRecord>('select * from oauth_provider_config where id = $1', [id])
  return result.rows[0] ?? null
}

async function upsertProvider(env: WorkerEnv, provider: OAuthProviderRecord) {
  await ensureOAuthSchema(env)
  const clientSecret = provider.client_secret?.trim() || ''
  const clientSecretEncrypted = clientSecret ? await encryptSecret(clientSecret, encryptionSecret(env)) : null

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into oauth_provider_config (
          id, enabled, name, logo_url, client_id, client_secret, client_secret_encrypted, callback_url,
          authorize_url, token_url, userinfo_url, issuer_url, scopes, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8, ?9, ?10, ?11, ?12, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          name = excluded.name,
          logo_url = excluded.logo_url,
          client_id = excluded.client_id,
          client_secret = '',
          client_secret_encrypted = excluded.client_secret_encrypted,
          callback_url = excluded.callback_url,
          authorize_url = excluded.authorize_url,
          token_url = excluded.token_url,
          userinfo_url = excluded.userinfo_url,
          issuer_url = excluded.issuer_url,
          scopes = excluded.scopes,
          updated_at = current_timestamp
      `)
      .bind(
        provider.id,
        provider.enabled ? 1 : 0,
        provider.name,
        provider.logo_url || '',
        provider.client_id,
        clientSecretEncrypted,
        provider.callback_url,
        provider.authorize_url,
        provider.token_url,
        provider.userinfo_url,
        provider.issuer_url || '',
        provider.scopes,
      )
      .run()
    return
  }

  await getPool(env).query(`
    insert into oauth_provider_config (
      id, enabled, name, logo_url, client_id, client_secret, client_secret_encrypted, callback_url,
      authorize_url, token_url, userinfo_url, issuer_url, scopes, updated_at
    ) values ($1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, $11, $12, now())
    on conflict (id)
    do update set
      enabled = excluded.enabled,
      name = excluded.name,
      logo_url = excluded.logo_url,
      client_id = excluded.client_id,
      client_secret = '',
      client_secret_encrypted = excluded.client_secret_encrypted,
      callback_url = excluded.callback_url,
      authorize_url = excluded.authorize_url,
      token_url = excluded.token_url,
      userinfo_url = excluded.userinfo_url,
      issuer_url = excluded.issuer_url,
      scopes = excluded.scopes,
      updated_at = now()
  `, [
    provider.id,
    !!provider.enabled,
    provider.name,
    provider.logo_url || '',
    provider.client_id,
    clientSecretEncrypted,
    provider.callback_url,
    provider.authorize_url,
    provider.token_url,
    provider.userinfo_url,
    provider.issuer_url || '',
    provider.scopes,
  ])
}

async function deleteProvider(env: WorkerEnv, id: string) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!.prepare('delete from oauth_provider_config where id = ?1').bind(id).run()
    return
  }
  await getPool(env).query('delete from oauth_provider_config where id = $1', [id])
}

function providerConfigured(provider: OAuthProviderRecord) {
  return !!(
    provider.client_id.trim()
    && provider.client_secret?.trim()
    && provider.callback_url.trim()
    && provider.authorize_url.trim()
    && provider.token_url.trim()
    && provider.userinfo_url.trim()
  )
}

async function configView(provider: OAuthProviderRecord, request: Request, env: WorkerEnv) {
  const clientSecret = await resolveStoredProviderSecret(provider, env)
  const runtimeProvider = { ...provider, client_secret: clientSecret }
  return {
    id: provider.id,
    enabled: !!provider.enabled,
    configured: providerConfigured(runtimeProvider),
    builtin: BUILTIN_OAUTH_PROVIDERS.some(item => item.id === provider.id),
    name: provider.name,
    logoUrl: provider.logo_url || '',
    clientId: provider.client_id,
    clientSecretMasked: maskSecret(clientSecret),
    callbackUrl: runtimeUrl(request, provider.callback_url),
    authorizeUrl: provider.authorize_url,
    tokenUrl: provider.token_url,
    userInfoUrl: provider.userinfo_url,
    issuerUrl: provider.issuer_url || '',
    scopes: provider.scopes,
  }
}

async function resolveRuntimeProvider(env: WorkerEnv, provider: OAuthProviderRecord) {
  return {
    ...provider,
    client_secret: await resolveStoredProviderSecret(provider, env),
  }
}

async function handlePublicProviders(request: Request, env: WorkerEnv) {
  const providers = (await Promise.all((await listStoredProviders(env)).map(provider => resolveRuntimeProvider(env, provider))))
    .filter(provider => !!provider.enabled && providerConfigured(provider))
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      logoUrl: provider.logo_url || '',
      scopes: provider.scopes,
      builtin: BUILTIN_OAUTH_PROVIDERS.some(item => item.id === provider.id),
    }))
  return json({ providers })
}

async function handleProviderConfigs(request: Request, env: WorkerEnv) {
  if (request.method === 'GET') {
    await assertAdminRequest(request, env)
    const providers = await Promise.all(
      mergeBuiltinProviders(await listStoredProviders(env)).map(provider => configView(provider, request, env)),
    )
    return json({ providers })
  }

  if (request.method === 'PUT') {
    await assertAdminRequest(request, env)
    const payload = await readJson<{ providers?: OAuthProviderPayload[] }>(request)
    const stored = new Map((await listStoredProviders(env)).map(provider => [provider.id, provider]))
    const nextIds = new Set<string>()
    for (const item of payload.providers ?? []) {
      const id = normalizeProviderId(item.id || item.name)
      if (!id)
        throw new Error('请填写登录源 ID')
      if (nextIds.has(id))
        throw new Error(`登录源 ID 重复：${id}`)
      nextIds.add(id)
      const existing = stored.get(id)
      const existingClientSecret = await resolveStoredProviderSecret(existing, env)
      const provider: OAuthProviderRecord = {
        id,
        enabled: item.enabled !== false,
        name: item.name?.trim() || existing?.name || id,
        logo_url: item.logoUrl?.trim() || existing?.logo_url || '',
        client_id: item.clientId?.trim() || existing?.client_id || '',
        client_secret: item.clientSecret?.trim() || existingClientSecret,
        callback_url: item.callbackUrl?.trim() || existing?.callback_url || defaultCallbackUrl(request),
        authorize_url: item.authorizeUrl?.trim() ? assertSafeExternalUrl(item.authorizeUrl).toString() : existing?.authorize_url || '',
        token_url: item.tokenUrl?.trim() ? assertSafeExternalUrl(item.tokenUrl).toString() : existing?.token_url || '',
        userinfo_url: item.userInfoUrl?.trim() ? assertSafeExternalUrl(item.userInfoUrl).toString() : existing?.userinfo_url || '',
        issuer_url: item.issuerUrl?.trim() ? assertSafeExternalUrl(item.issuerUrl).toString() : existing?.issuer_url || '',
        scopes: item.scopes === undefined ? (existing?.scopes ?? DEFAULT_SCOPES) : item.scopes.trim(),
      }
      if (provider.enabled) {
        if (!provider.client_id)
          throw new Error(`${provider.name} 缺少 Client ID`)
        if (!provider.client_secret)
          throw new Error(`${provider.name} 缺少 Client Secret`)
        if (!provider.authorize_url || !provider.token_url || !provider.userinfo_url)
          throw new Error(`${provider.name} 缺少授权、Token 或 UserInfo 地址`)
      }
      await upsertProvider(env, provider)
    }

    for (const id of stored.keys()) {
      if (!nextIds.has(id))
        await deleteProvider(env, id)
    }

    return json({
      ok: true,
      providers: await Promise.all((await listStoredProviders(env)).map(provider => configView(provider, request, env))),
    })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

async function handleAuthorize(request: Request, env: WorkerEnv) {
  if (request.method !== 'POST')
    return json({ error: 'Method Not Allowed' }, 405)

  const appState = await readWelfareState(env) as Partial<WelfareState>
  const systemConfig = normalizeSystemConfig(appState.systemConfig)
  if (!systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (!systemConfig.loginEnabled)
    throw new Error(systemConfig.loginClosedReason)

  const payload = await readJson<AuthorizePayload>(request)
  const providerId = normalizeProviderId(payload.providerId)
  const storedProvider = providerId ? await getStoredProvider(env, providerId) : null
  const provider = storedProvider ? await resolveRuntimeProvider(env, storedProvider) : null
  if (!provider || !provider.enabled || !providerConfigured(provider))
    throw new Error('登录源未启用或配置不完整')

  const state = await createOAuthState(env, provider, {
    providerId: provider.id,
    redirect: normalizeRedirect(payload.redirect),
  })
  const authorizeUrl = assertSafeExternalUrl(provider.authorize_url)
  authorizeUrl.searchParams.set('client_id', provider.client_id)
  authorizeUrl.searchParams.set('redirect_uri', runtimeUrl(request, provider.callback_url))
  authorizeUrl.searchParams.set('response_type', 'code')
  if (provider.scopes.trim())
    authorizeUrl.searchParams.set('scope', provider.scopes.trim())
  authorizeUrl.searchParams.set('state', state)

  return json({ authorizeUrl: authorizeUrl.toString(), state })
}

async function exchangeCodeForToken(request: Request, provider: OAuthProviderRecord, code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: provider.client_id,
    client_secret: provider.client_secret || '',
    code,
    redirect_uri: runtimeUrl(request, provider.callback_url),
  })
  const response = await fetch(assertSafeExternalUrl(provider.token_url).toString(), {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Touch-Great-Welfare',
    },
    body,
  })
  const payload = await response.json() as TokenResponse
  if (!response.ok || payload.error || !payload.access_token)
    throw new Error(payload.error_description || payload.error || 'OAuth 授权换取 Token 失败')
  return payload.access_token
}

async function fetchUserInfo(provider: OAuthProviderRecord, token: string) {
  const response = await fetch(assertSafeExternalUrl(provider.userinfo_url).toString(), {
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${token}`,
      'user-agent': 'Touch-Great-Welfare',
    },
  })
  if (!response.ok)
    throw new Error(`OAuth UserInfo 请求失败：${response.status}`)
  return response.json() as Promise<UserInfoResponse>
}

function pickUserEmail(provider: OAuthProviderRecord, userInfo: UserInfoResponse) {
  const email = userInfo.email?.trim().toLowerCase()
  if (email)
    return email
  const subject = String(userInfo.sub ?? userInfo.id ?? '').trim()
  return `${provider.id}-${subject || 'user'}@oauth.local`
}

async function createUserId(providerId: string, subject: string) {
  return `oauth_${providerId}_${(await sha256Hex(`${providerId}:${subject}`)).slice(0, 24)}`
}

function resolveUserAvatar(provider: OAuthProviderRecord, userInfo: UserInfoResponse) {
  const rawAvatar = userInfo.picture || userInfo.avatar_url || userInfo.avatar_template
  if (!rawAvatar)
    return undefined

  const sizedAvatar = rawAvatar.replace('{size}', '120')
  if (sizedAvatar.startsWith('//'))
    return `https:${sizedAvatar}`
  if (sizedAvatar.startsWith('/')) {
    const baseUrl = provider.id === LINUX_DO_PROVIDER_ID ? 'https://linux.do' : provider.issuer_url || provider.userinfo_url
    return new URL(sizedAvatar, assertSafeExternalUrl(baseUrl).toString()).toString()
  }
  return sizedAvatar
}

async function persistOAuthUser(env: WorkerEnv, provider: OAuthProviderRecord, oauthState: OAuthState, userInfo: UserInfoResponse) {
  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  if (!Array.isArray(state.users) || !Array.isArray(state.transactions))
    throw new Error('用户状态未初始化')

  const systemConfig = normalizeSystemConfig(state.systemConfig)
  if (!systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (!systemConfig.loginEnabled)
    throw new Error(systemConfig.loginClosedReason)

  const subject = String(userInfo.sub ?? userInfo.id ?? '').trim()
  if (!subject)
    throw new Error('OAuth UserInfo 缺少 sub/id')
  const email = pickUserEmail(provider, userInfo)
  const userId = await createUserId(provider.id, subject)
  const username = userInfo.preferred_username || userInfo.username || userInfo.nickname || email.split('@')[0]
  const avatar = resolveUserAvatar(provider, userInfo)

  let localUser = state.users.find(item =>
    item.profile.oauthProviderId === provider.id
    && item.profile.oauthSubject === subject,
  )
  localUser ||= state.users.find(item => item.id === userId)
    || state.users.find(item => item.profile.email.toLowerCase() === email)

  if (!localUser) {
    if (!systemConfig.registrationEnabled)
      throw new Error(systemConfig.registrationClosedReason)

    localUser = {
      id: userId,
      role: 'user',
      profile: {
        displayName: userInfo.name?.trim() || username || provider.name,
        email,
        inviteCode: createUserInviteCode(userId),
        avatar,
        oauthProviderId: provider.id,
        oauthSubject: subject,
        oauthUsername: username,
        oauthAuthorizedAt: now(),
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
      displayName: localUser.profile.displayName || userInfo.name?.trim() || username || provider.name,
      email: localUser.profile.email || email,
      inviteCode: localUser.profile.inviteCode || createUserInviteCode(localUser.id),
      avatar: avatar || localUser.profile.avatar,
      oauthProviderId: provider.id,
      oauthSubject: subject,
      oauthUsername: username,
      oauthAuthorizedAt: now(),
    }
  }

  delete state.currentUserId
  await writeWelfareState(env, state, { expectedVersion: record.version })
  return {
    redirect: oauthState.redirect,
    userId: localUser.id,
  }
}

async function completeOAuthAuthorization(request: Request, env: WorkerEnv, code: string, stateText: string) {
  const [payload] = stateText.split('.')
  const rawState = payload ? JSON.parse(base64UrlDecodeText(payload)) as OAuthState : undefined
  const providerId = normalizeProviderId(rawState?.providerId)
  const storedProvider = providerId ? await getStoredProvider(env, providerId) : null
  const provider = storedProvider ? await resolveRuntimeProvider(env, storedProvider) : null
  if (!provider || !provider.enabled || !providerConfigured(provider))
    throw new Error('登录源未启用或配置不完整')
  const oauthState = await consumeOAuthState(env, provider, stateText)
  const token = await exchangeCodeForToken(request, provider, code)
  const userInfo = await fetchUserInfo(provider, token)
  return persistOAuthUser(env, provider, oauthState, userInfo)
}

async function handleCallback(request: Request, env: WorkerEnv) {
  const url = new URL(request.url)

  if (request.method === 'GET') {
    try {
      const error = url.searchParams.get('error')
      if (error)
        throw new Error(url.searchParams.get('error_description') || error)

      const code = url.searchParams.get('code') ?? ''
      const state = url.searchParams.get('state') ?? ''
      if (!code)
        throw new Error('OAuth 未返回授权 code')
      const result = await completeOAuthAuthorization(request, env, code, state)
      return redirectWithMessage(request, result.redirect, { oauth_login: 'success' }, {
        'set-cookie': await createSessionCookie(request, env, result.userId),
      })
    }
    catch (error) {
      return redirectWithMessage(request, '/login', {
        oauth_login: 'error',
        message: error instanceof Error ? error.message : 'OAuth 登录失败',
      })
    }
  }

  if (request.method === 'POST') {
    const payload = await readJson<CallbackPayload>(request)
    const result = await completeOAuthAuthorization(request, env, payload.code ?? '', payload.state ?? '')
    return json({ ok: true, redirect: result.redirect }, 200, {
      'set-cookie': await createSessionCookie(request, env, result.userId),
    })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

export async function handleOAuthRequest(request: Request, env: WorkerEnv) {
  const url = new URL(request.url)
  try {
    if (url.pathname === '/api/oauth/providers')
      return await handlePublicProviders(request, env)
    if (url.pathname === '/api/oauth/configs')
      return await handleProviderConfigs(request, env)
    if (url.pathname === '/api/oauth/authorize')
      return await handleAuthorize(request, env)
    if (url.pathname === '/api/oauth/callback')
      return await handleCallback(request, env)
    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}
