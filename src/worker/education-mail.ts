import type { WorkerEnv } from './welfare-state'
import type { EducationEmailChallenge, StudentVerification, WelfareState } from '~/shared/welfare-types'
import { EDUCATION_EMAIL_REVIEW_INBOX } from '~/shared/welfare-domain'
import {
  assertAdminRequest,
  assertSafeExternalUrl,
  assertWelfareState,
  boolValue,
  errorResponse,
  fetchWithTimeout,
  getAuthenticatedRequest,
  json,
  maskSecret,
  normalizeUrlBase,
  now,
  readJson,
} from './auth'
import { decryptSecret, encryptSecret } from './crypto'
import { getPool, readWelfareStateRecord, shouldUseD1, writeWelfareState } from './welfare-state'

interface EducationMailConfigRow {
  id: string
  enabled: number | boolean
  base_url: string
  admin_key_encrypted?: string | null
  inbox_address: string
  lookback_hours: number | string
}

interface SaveEducationMailConfigPayload {
  enabled?: boolean
  baseUrl?: string
  adminKey?: string
  clearAdminKey?: boolean
  inboxAddress?: string
  lookbackHours?: number
}

interface VerifyEducationMailChallengePayload {
  challengeId?: string
}

interface DoneMailMessage {
  id?: string
  from?: string
  to?: string
  subject?: string
  preview?: string
  text?: string
  html?: string
  receivedAt?: string
}

interface DoneMailListResponse {
  ok?: boolean
  data?: DoneMailMessage[]
  error?: {
    message?: string
  }
}

const EDUCATION_MAIL_CONFIG_ID = 'default'
const DEFAULT_LOOKBACK_HOURS = 24 * 7

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

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeLookbackHours(value: unknown) {
  const hours = Number(value)
  if (!Number.isFinite(hours))
    return DEFAULT_LOOKBACK_HOURS
  return Math.max(1, Math.min(24 * 30, Math.round(hours)))
}

function configured(config: Awaited<ReturnType<typeof getEffectiveEducationMailConfig>>) {
  return !!(config.baseUrl && config.adminKey && config.inboxAddress)
}

async function ensureEducationMailSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!.prepare(`
      create table if not exists education_mail_config (
        id text primary key,
        enabled integer not null default 0,
        base_url text not null default '',
        admin_key_encrypted text,
        inbox_address text not null default '',
        lookback_hours integer not null default 168,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      )
    `).run()
    return
  }

  await getPool(env).query(`
    create table if not exists education_mail_config (
      id text primary key,
      enabled boolean not null default false,
      base_url text not null default '',
      admin_key_encrypted text,
      inbox_address text not null default '',
      lookback_hours integer not null default 168,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
}

async function getStoredEducationMailConfig(env: WorkerEnv) {
  await ensureEducationMailSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from education_mail_config where id = ?1')
      .bind(EDUCATION_MAIL_CONFIG_ID)
      .first<EducationMailConfigRow>()
  }

  const result = await getPool(env).query<EducationMailConfigRow>(
    'select * from education_mail_config where id = $1',
    [EDUCATION_MAIL_CONFIG_ID],
  )
  return result.rows[0] ?? null
}

export async function getEffectiveEducationMailConfig(env: WorkerEnv) {
  const stored = await getStoredEducationMailConfig(env)
  const adminKey = await decryptOptionalSecret(stored?.admin_key_encrypted, env)

  return {
    enabled: boolValue(stored?.enabled),
    configured: false,
    baseUrl: stored?.base_url ?? '',
    adminKey,
    inboxAddress: stored?.inbox_address || EDUCATION_EMAIL_REVIEW_INBOX,
    lookbackHours: normalizeLookbackHours(stored?.lookback_hours),
    source: stored ? 'admin' as const : 'empty' as const,
  }
}

function serializeConfig(config: Awaited<ReturnType<typeof getEffectiveEducationMailConfig>>) {
  return {
    enabled: config.enabled,
    configured: configured(config),
    baseUrl: config.baseUrl,
    adminKeyMasked: maskSecret(config.adminKey),
    inboxAddress: config.inboxAddress,
    lookbackHours: config.lookbackHours,
    source: config.source,
  }
}

async function saveEducationMailConfig(env: WorkerEnv, payload: SaveEducationMailConfigPayload) {
  const previous = await getEffectiveEducationMailConfig(env)
  const adminKey = payload.clearAdminKey
    ? ''
    : payload.adminKey?.trim() || previous.adminKey
  const config = {
    enabled: payload.enabled !== false,
    baseUrl: payload.baseUrl?.trim() ? normalizeUrlBase(payload.baseUrl) : previous.baseUrl,
    adminKeyEncrypted: adminKey ? await encryptSecret(adminKey, encryptionSecret(env)) : null,
    inboxAddress: normalizeEmail(payload.inboxAddress) || previous.inboxAddress,
    lookbackHours: normalizeLookbackHours(payload.lookbackHours ?? previous.lookbackHours),
  }

  if (!config.baseUrl)
    throw new Error('请填写 DoneMail API 基础地址')
  if (!adminKey)
    throw new Error('请填写 DoneMail X-Admin-Key')
  if (!config.inboxAddress)
    throw new Error('请填写平台收件邮箱')

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into education_mail_config (
          id, enabled, base_url, admin_key_encrypted, inbox_address, lookback_hours, updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          admin_key_encrypted = excluded.admin_key_encrypted,
          inbox_address = excluded.inbox_address,
          lookback_hours = excluded.lookback_hours,
          updated_at = current_timestamp
      `)
      .bind(
        EDUCATION_MAIL_CONFIG_ID,
        config.enabled ? 1 : 0,
        config.baseUrl,
        config.adminKeyEncrypted,
        config.inboxAddress,
        config.lookbackHours,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into education_mail_config (
        id, enabled, base_url, admin_key_encrypted, inbox_address, lookback_hours, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (id)
      do update set
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        admin_key_encrypted = excluded.admin_key_encrypted,
        inbox_address = excluded.inbox_address,
        lookback_hours = excluded.lookback_hours,
        updated_at = now()
    `, [
      EDUCATION_MAIL_CONFIG_ID,
      config.enabled,
      config.baseUrl,
      config.adminKeyEncrypted,
      config.inboxAddress,
      config.lookbackHours,
    ])
  }

  return await getEffectiveEducationMailConfig(env)
}

async function listDoneMailMessages(config: Awaited<ReturnType<typeof getEffectiveEducationMailConfig>>, params: Record<string, string>) {
  if (!config.baseUrl || !config.adminKey)
    throw new Error('DoneMail 配置不完整')

  const url = new URL(`${assertSafeExternalUrl(config.baseUrl).toString().replace(/\/+$/, '')}/api/mails`)
  for (const [key, value] of Object.entries(params)) {
    if (value)
      url.searchParams.set(key, value)
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'x-admin-key': config.adminKey,
    },
  })
  const payload = await response.json() as DoneMailListResponse
  if (!response.ok || payload.ok === false)
    throw new Error(payload.error?.message || 'DoneMail 邮件列表请求失败')

  return Array.isArray(payload.data) ? payload.data : []
}

function pendingChallenges(state: WelfareState, lookbackHours: number) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000
  return state.educationEmailChallenges.filter((challenge) => {
    if (challenge.verifiedAt)
      return false
    const expiresAt = new Date(challenge.expiresAt).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      return false
    const createdAt = new Date(challenge.createdAt).getTime()
    return !Number.isFinite(createdAt) || createdAt >= cutoff
  })
}

function mailContainsChallenge(mail: DoneMailMessage, challenge: EducationEmailChallenge) {
  const content = [
    mail.subject,
    mail.preview,
    mail.text,
    mail.html,
  ].filter(Boolean).join('\n')

  return normalizeEmail(mail.from) === challenge.email
    && content.includes(challenge.code)
}

function findVerificationForChallenge(state: WelfareState, challenge: EducationEmailChallenge) {
  return state.studentVerifications.find(item =>
    item.educationEmailChallengeId === challenge.id
    || (item.userId === challenge.userId && normalizeEmail(item.educationEmail) === challenge.email && item.status === 'pending'),
  )
}

async function syncEducationEmailChallenges(env: WorkerEnv) {
  const config = await getEffectiveEducationMailConfig(env)
  if (!config.enabled)
    throw new Error('教育邮箱收件验证未启用')
  if (!configured(config))
    throw new Error('教育邮箱收件配置不完整')

  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  assertWelfareState(state)

  const challenges = pendingChallenges(state, config.lookbackHours)
  const matched: Array<{
    challengeId: string
    verificationId?: string
    email: string
    mailId: string
    receivedAt?: string
  }> = []

  for (const challenge of challenges) {
    const messages = await listDoneMailMessages(config, {
      limit: '10',
      from: challenge.email,
      to: config.inboxAddress,
      content: challenge.code,
    })
    const mail = messages.find(item => mailContainsChallenge(item, challenge))
    if (!mail)
      continue

    challenge.verifiedAt = now()
    const verification = findVerificationForChallenge(state, challenge)
    if (verification) {
      verification.educationEmailVerified = true
      verification.educationEmailVerifiedAt = challenge.verifiedAt
      verification.educationEmailVerificationSource = 'mail_auto'
      verification.educationEmailChallengeId = challenge.id
    }
    matched.push({
      challengeId: challenge.id,
      verificationId: verification?.id,
      email: challenge.email,
      mailId: mail.id || '',
      receivedAt: mail.receivedAt,
    })
  }

  if (matched.length)
    await writeWelfareState(env, state, { expectedVersion: record.version })

  return {
    checked: challenges.length,
    verified: matched.length,
    matched,
  }
}

async function verifyEducationEmailChallengeForUser(request: Request, env: WorkerEnv) {
  const { user } = await getAuthenticatedRequest(request, env)
  const config = await getEffectiveEducationMailConfig(env)
  if (!config.enabled)
    throw new Error('教育邮箱收件验证未启用')
  if (!configured(config))
    throw new Error('教育邮箱收件配置不完整')

  const payload = await readJson<VerifyEducationMailChallengePayload>(request)
  const challengeId = payload.challengeId?.trim()
  if (!challengeId)
    throw new Error('教育邮箱证明码不存在')

  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  assertWelfareState(state)
  const challenge = state.educationEmailChallenges.find(item => item.id === challengeId && item.userId === user.id)
  if (!challenge)
    throw new Error('教育邮箱证明码不存在')

  const expiresAt = new Date(challenge.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error('教育邮箱证明码已过期，请重新生成')

  if (challenge.verifiedAt) {
    return {
      verified: true,
      challengeId: challenge.id,
      email: challenge.email,
      verifiedAt: challenge.verifiedAt,
    }
  }

  const messages = await listDoneMailMessages(config, {
    limit: '10',
    from: challenge.email,
    to: config.inboxAddress,
    content: challenge.code,
  })
  const mail = messages.find(item => mailContainsChallenge(item, challenge))
  if (!mail) {
    return {
      verified: false,
      challengeId: challenge.id,
      email: challenge.email,
    }
  }

  const verifiedAt = now()
  challenge.submittedAt = challenge.submittedAt || verifiedAt
  challenge.verifiedAt = verifiedAt
  const verification = findVerificationForChallenge(state, challenge)
  if (verification) {
    verification.educationEmailVerified = true
    verification.educationEmailVerifiedAt = verifiedAt
    verification.educationEmailVerificationSource = 'mail_auto'
    verification.educationEmailChallengeId = challenge.id
  }
  await writeWelfareState(env, state, { expectedVersion: record.version })

  return {
    verified: true,
    challengeId: challenge.id,
    email: challenge.email,
    verifiedAt,
    mailId: mail.id || '',
    receivedAt: mail.receivedAt,
  }
}

export async function verifyEducationMailChallengesInState(
  state: WelfareState,
  messages: DoneMailMessage[],
  referenceNow = new Date(),
) {
  const matched: Array<{ challenge: EducationEmailChallenge, verification?: StudentVerification, mail: DoneMailMessage }> = []
  const activeChallenges = state.educationEmailChallenges.filter((challenge) => {
    if (challenge.verifiedAt)
      return false
    const expiresAt = new Date(challenge.expiresAt).getTime()
    return Number.isFinite(expiresAt) && expiresAt > referenceNow.getTime()
  })

  for (const challenge of activeChallenges) {
    const mail = messages.find(item => mailContainsChallenge(item, challenge))
    if (!mail)
      continue

    const verifiedAt = referenceNow.toISOString()
    challenge.verifiedAt = verifiedAt
    const verification = findVerificationForChallenge(state, challenge)
    if (verification) {
      verification.educationEmailVerified = true
      verification.educationEmailVerifiedAt = verifiedAt
      verification.educationEmailVerificationSource = 'mail_auto'
      verification.educationEmailChallengeId = challenge.id
    }
    matched.push({ challenge, verification, mail })
  }

  return matched
}

export async function handleEducationMailRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/education-mail'.length) || '/'

    if (path === '/config' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      return json(serializeConfig(await getEffectiveEducationMailConfig(env)))
    }

    if (path === '/config' && request.method === 'PUT') {
      await assertAdminRequest(request, env)
      return json(serializeConfig(await saveEducationMailConfig(env, await readJson<SaveEducationMailConfigPayload>(request))))
    }

    if (path === '/test' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      const config = await getEffectiveEducationMailConfig(env)
      await listDoneMailMessages(config, { limit: '1', to: config.inboxAddress })
      return json({ ok: true })
    }

    if (path === '/sync' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      return json(await syncEducationEmailChallenges(env))
    }

    if (path === '/verify' && request.method === 'POST')
      return json(await verifyEducationEmailChallengeForUser(request, env))

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
