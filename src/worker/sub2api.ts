import type { WorkerEnv } from './welfare-state'
import type { User } from '~/composables/welfare'
import { Pool } from 'pg'
import {
  assertAdminRequest,
  assertSafeExternalUrl,
  boolValue,
  createId,
  errorResponse,
  fetchWithTimeout,
  getAuthenticatedRequest,
  json,
  maskSecret,
  normalizeUrlBase,
  now,
  readJson,
} from './auth'
import { decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { ensureNotificationSchema } from './notifications'
import { getPool, shouldUseD1 } from './welfare-state'

interface Sub2ApiConfigRow {
  id: string
  enabled: number | boolean
  base_url: string
  admin_api_key_encrypted?: string | null
  database_url_encrypted?: string | null
  default_group_id?: number | string | null
  default_quota_usd?: number | string | null
  default_expires_in_days?: number | string | null
  default_rate_limit_5h?: number | string | null
  default_rate_limit_1d?: number | string | null
  default_rate_limit_7d?: number | string | null
}

interface Sub2ApiKeyBindingRow {
  id: string
  user_id: string
  application_id?: string | null
  item_id?: string | null
  sub2api_user_id: string
  sub2api_key_id?: string | null
  key_hash: string
  key_masked: string
  name: string
  quota_usd: number | string
  expires_at?: string | Date | null
  status: 'active' | 'revoked'
  created_at: string | Date
  revoked_at?: string | Date | null
}

interface SaveSub2ApiConfigPayload {
  enabled?: boolean
  baseUrl?: string
  adminApiKey?: string
  databaseUrl?: string
  clearAdminApiKey?: boolean
  clearDatabaseUrl?: boolean
  defaultGroupId?: number | string | null
  defaultQuotaUsd?: number
  defaultExpiresInDays?: number
  defaultRateLimit5h?: number
  defaultRateLimit1d?: number
  defaultRateLimit7d?: number
}

interface CreateSub2ApiKeyPayload {
  name?: string
  quotaUsd?: number
  expiresInDays?: number
  groupId?: number | string | null
  rateLimit5h?: number
  rateLimit1d?: number
  rateLimit7d?: number
  ipWhitelist?: string[]
  ipBlacklist?: string[]
  maxActiveIps?: number
  ipIdleTimeoutSeconds?: number
  maxConcurrency?: number
}

interface ResourceProvisionRef {
  applicationId: string
  itemId: string
}

interface UpstreamEnvelope<T> {
  code?: number
  message?: string
  data?: T
  items?: T
}

interface UpstreamUser {
  id?: number | string
  email?: string
  username?: string
}

interface UpstreamApiKey {
  id?: number | string
  key?: string
  name?: string
  status?: string
  quota?: number
  expires_at?: string | null
  created_at?: string
}

const DEFAULT_EXPIRES_IN_DAYS = 30
const DEFAULT_KEY_QUOTA_USD = 10
const SUB2API_CONFIG_ID = 'default'
const RESOURCE_LOCK_TTL_SECONDS = 60

class Sub2ApiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'Sub2ApiHttpError'
  }
}

function encryptionSecret(env: WorkerEnv) {
  return env.NOTIFY_SECRET_KEY ?? ''
}

function toIso(value?: string | Date | null) {
  if (!value)
    return undefined
  return value instanceof Date ? value.toISOString() : value
}

function numberValue(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function optionalInt(value: unknown) {
  if (value === undefined || value === null || value === '')
    return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0)
    return null
  return Math.trunc(numeric)
}

function optionalNonNegativeInt(value: unknown) {
  if (value === undefined || value === null || value === '')
    return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0)
    return null
  return Math.trunc(numeric)
}

function normalizeQuota(value: unknown, fallback: number) {
  return Math.max(0, Math.min(100000, numberValue(value, fallback)))
}

function normalizeExpiresInDays(value: unknown) {
  return Math.max(1, Math.min(365, Math.trunc(numberValue(value, DEFAULT_EXPIRES_IN_DAYS))))
}

function normalizeRateLimit(value: unknown) {
  return Math.max(0, Math.min(100000, numberValue(value, 0)))
}

function maskKey(value: string) {
  return maskSecret(value)
}

function normalizeResponseData<T>(payload: UpstreamEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in payload)
    return (payload as UpstreamEnvelope<T>).data as T
  return payload as T
}

function buildUserEmail(user: User) {
  const email = user.profile.email.trim()
  if (email)
    return email
  return `${user.id}@touch-great-welfare.local`
}

function buildUserName(user: User) {
  return user.profile.displayName.trim() || user.profile.githubUsername || user.id
}

function resourceLockId(ref: ResourceProvisionRef) {
  return `${ref.applicationId}:${ref.itemId}`
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

async function getStoredSub2ApiConfig(env: WorkerEnv) {
  await ensureNotificationSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from sub2api_config where id = ?1')
      .bind(SUB2API_CONFIG_ID)
      .first<Sub2ApiConfigRow>()
  }

  const result = await getPool(env).query<Sub2ApiConfigRow>(
    'select * from sub2api_config where id = $1',
    [SUB2API_CONFIG_ID],
  )
  return result.rows[0] ?? null
}

async function getEffectiveSub2ApiConfig(env: WorkerEnv) {
  const stored = await getStoredSub2ApiConfig(env)
  const adminApiKey = await decryptOptionalSecret(stored?.admin_api_key_encrypted, env)
  const databaseUrl = await decryptOptionalSecret(stored?.database_url_encrypted, env)
  return {
    enabled: stored ? boolValue(stored.enabled) : false,
    baseUrl: normalizeUrlBase(stored?.base_url || ''),
    adminApiKey,
    databaseUrl,
    defaultGroupId: optionalInt(stored?.default_group_id),
    defaultQuotaUsd: normalizeQuota(stored?.default_quota_usd, DEFAULT_KEY_QUOTA_USD),
    defaultExpiresInDays: normalizeExpiresInDays(stored?.default_expires_in_days),
    defaultRateLimit5h: normalizeRateLimit(stored?.default_rate_limit_5h),
    defaultRateLimit1d: normalizeRateLimit(stored?.default_rate_limit_1d),
    defaultRateLimit7d: normalizeRateLimit(stored?.default_rate_limit_7d),
    configured: !!(stored?.base_url && (adminApiKey || databaseUrl)),
    source: stored ? 'admin' as const : 'empty' as const,
  }
}

function serializeConfig(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    adminApiKeyMasked: maskSecret(config.adminApiKey),
    databaseUrlMasked: maskSecret(config.databaseUrl),
    defaultGroupId: config.defaultGroupId,
    defaultQuotaUsd: config.defaultQuotaUsd,
    defaultExpiresInDays: config.defaultExpiresInDays,
    defaultRateLimit5h: config.defaultRateLimit5h,
    defaultRateLimit1d: config.defaultRateLimit1d,
    defaultRateLimit7d: config.defaultRateLimit7d,
    source: config.source,
  }
}

function serializePublicConfig(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    adminApiKeyMasked: '',
    databaseUrlMasked: '',
    defaultGroupId: config.defaultGroupId,
    defaultQuotaUsd: config.defaultQuotaUsd,
    defaultExpiresInDays: config.defaultExpiresInDays,
    defaultRateLimit5h: config.defaultRateLimit5h,
    defaultRateLimit1d: config.defaultRateLimit1d,
    defaultRateLimit7d: config.defaultRateLimit7d,
    source: config.source,
  }
}

async function saveSub2ApiConfig(env: WorkerEnv, payload: SaveSub2ApiConfigPayload) {
  await ensureNotificationSchema(env)
  const stored = await getStoredSub2ApiConfig(env)
  let adminApiKeyEncrypted = stored?.admin_api_key_encrypted || null
  let databaseUrlEncrypted = stored?.database_url_encrypted || null

  if (payload.clearAdminApiKey)
    adminApiKeyEncrypted = null
  if (payload.clearDatabaseUrl)
    databaseUrlEncrypted = null
  if (payload.adminApiKey?.trim())
    adminApiKeyEncrypted = await encryptSecret(payload.adminApiKey.trim(), encryptionSecret(env))
  if (payload.databaseUrl?.trim())
    databaseUrlEncrypted = await encryptSecret(payload.databaseUrl.trim(), encryptionSecret(env))

  const config = {
    enabled: payload.enabled !== false,
    baseUrl: normalizeUrlBase(payload.baseUrl?.trim() || ''),
    adminApiKeyEncrypted,
    databaseUrlEncrypted,
    defaultGroupId: optionalInt(payload.defaultGroupId),
    defaultQuotaUsd: normalizeQuota(payload.defaultQuotaUsd, DEFAULT_KEY_QUOTA_USD),
    defaultExpiresInDays: normalizeExpiresInDays(payload.defaultExpiresInDays),
    defaultRateLimit5h: normalizeRateLimit(payload.defaultRateLimit5h),
    defaultRateLimit1d: normalizeRateLimit(payload.defaultRateLimit1d),
    defaultRateLimit7d: normalizeRateLimit(payload.defaultRateLimit7d),
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into sub2api_config (
          id, enabled, base_url, admin_api_key_encrypted, database_url_encrypted,
          default_group_id, default_quota_usd, default_expires_in_days,
          default_rate_limit_5h, default_rate_limit_1d, default_rate_limit_7d, updated_at
        )
        values ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          admin_api_key_encrypted = excluded.admin_api_key_encrypted,
          database_url_encrypted = excluded.database_url_encrypted,
          default_group_id = excluded.default_group_id,
          default_quota_usd = excluded.default_quota_usd,
          default_expires_in_days = excluded.default_expires_in_days,
          default_rate_limit_5h = excluded.default_rate_limit_5h,
          default_rate_limit_1d = excluded.default_rate_limit_1d,
          default_rate_limit_7d = excluded.default_rate_limit_7d,
          updated_at = current_timestamp
      `)
      .bind(
        config.enabled ? 1 : 0,
        config.baseUrl,
        config.adminApiKeyEncrypted,
        config.databaseUrlEncrypted,
        config.defaultGroupId,
        config.defaultQuotaUsd,
        config.defaultExpiresInDays,
        config.defaultRateLimit5h,
        config.defaultRateLimit1d,
        config.defaultRateLimit7d,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into sub2api_config (
        id, enabled, base_url, admin_api_key_encrypted, database_url_encrypted,
        default_group_id, default_quota_usd, default_expires_in_days,
        default_rate_limit_5h, default_rate_limit_1d, default_rate_limit_7d, updated_at
      )
      values ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      on conflict (id)
      do update set
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        admin_api_key_encrypted = excluded.admin_api_key_encrypted,
        database_url_encrypted = excluded.database_url_encrypted,
        default_group_id = excluded.default_group_id,
        default_quota_usd = excluded.default_quota_usd,
        default_expires_in_days = excluded.default_expires_in_days,
        default_rate_limit_5h = excluded.default_rate_limit_5h,
        default_rate_limit_1d = excluded.default_rate_limit_1d,
        default_rate_limit_7d = excluded.default_rate_limit_7d,
        updated_at = now()
    `, [
      config.enabled,
      config.baseUrl,
      config.adminApiKeyEncrypted,
      config.databaseUrlEncrypted,
      config.defaultGroupId,
      config.defaultQuotaUsd,
      config.defaultExpiresInDays,
      config.defaultRateLimit5h,
      config.defaultRateLimit1d,
      config.defaultRateLimit7d,
    ])
  }

  return getEffectiveSub2ApiConfig(env)
}

async function callSub2Api<T>(
  config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!config.baseUrl)
    throw new Error('Sub2API 地址未配置')
  if (!config.adminApiKey)
    throw new Error('Sub2API Admin API Key 未配置')

  const baseUrl = assertSafeExternalUrl(config.baseUrl).toString().replace(/\/+$/, '')
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.adminApiKey,
      ...init?.headers,
    },
  }, 20000)
  const text = await response.text()
  let payload = {} as UpstreamEnvelope<T> | T
  if (text) {
    try {
      payload = JSON.parse(text) as UpstreamEnvelope<T> | T
    }
    catch {
      payload = { message: text } as UpstreamEnvelope<T>
    }
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as UpstreamEnvelope<T>).message)
      : `Sub2API 请求失败：${response.status}`
    throw new Sub2ApiHttpError(message, response.status)
  }
  return normalizeResponseData(payload)
}

function isUnsupportedAdminKeyEndpoint(error: unknown) {
  return error instanceof Sub2ApiHttpError && [404, 405].includes(error.status)
}

async function findSub2ApiUser(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, user: User) {
  const email = encodeURIComponent(buildUserEmail(user))
  const result = await callSub2Api<{ items?: UpstreamUser[], users?: UpstreamUser[] } | UpstreamUser[]>(
    config,
    `/api/v1/admin/users?search=${email}&page=1&page_size=20`,
  )
  const users = Array.isArray(result) ? result : result.items || result.users || []
  return users.find(item => item.email === buildUserEmail(user)) ?? null
}

async function createSub2ApiUser(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, user: User) {
  const password = `TGW-${crypto.randomUUID()}-${Date.now()}`
  const payload = {
    email: buildUserEmail(user),
    password,
    username: buildUserName(user),
    notes: `Touch Great Welfare user ${user.id}`,
    balance: 0,
    concurrency: 5,
    rpm_limit: 0,
    allowed_groups: config.defaultGroupId ? [config.defaultGroupId] : [],
  }
  return await callSub2Api<UpstreamUser>(config, '/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

async function withSub2ApiDatabase<T>(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, callback: (pool: Pool) => Promise<T>) {
  if (!config.databaseUrl)
    throw new Error('Sub2API 数据库连接未配置')

  const pool = new Pool({ connectionString: config.databaseUrl })
  try {
    return await callback(pool)
  }
  finally {
    await pool.end()
  }
}

async function findSub2ApiUserByDatabase(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, user: User) {
  return await withSub2ApiDatabase(config, async (pool) => {
    const result = await pool.query<{ id: number | string }>(
      'select id from users where email = $1 and deleted_at is null limit 1',
      [buildUserEmail(user)],
    )
    return result.rows[0]?.id ? String(result.rows[0].id) : ''
  })
}

async function createSub2ApiUserByDatabase(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, user: User) {
  return await withSub2ApiDatabase(config, async (pool) => {
    const result = await pool.query<{ id: number | string }>(`
      insert into users (
        email, password_hash, role, balance, concurrency, status,
        username, notes, signup_source, created_at, updated_at
      )
      values ($1, $2, 'user', 0, 5, 'active', $3, $4, 'email', now(), now())
      returning id
    `, [
      buildUserEmail(user),
      `disabled-password-${crypto.randomUUID()}`,
      buildUserName(user),
      `Touch Great Welfare user ${user.id}`,
    ])
    const id = result.rows[0]?.id
    if (!id)
      throw new Error('Sub2API 数据库未返回用户 ID')
    return String(id)
  })
}

async function ensureSub2ApiUser(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, user: User) {
  if (config.adminApiKey) {
    try {
      const existing = await findSub2ApiUser(config, user)
      if (existing?.id)
        return String(existing.id)

      const created = await createSub2ApiUser(config, user)
      if (!created.id)
        throw new Error('Sub2API 未返回用户 ID')
      return String(created.id)
    }
    catch (error) {
      if (!config.databaseUrl)
        throw error
    }
  }

  const existing = await findSub2ApiUserByDatabase(config, user)
  if (existing)
    return existing
  return await createSub2ApiUserByDatabase(config, user)
}

function buildSub2ApiKeyPayload(
  config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>,
  payload: CreateSub2ApiKeyPayload,
) {
  const groupId = optionalInt(payload.groupId) ?? config.defaultGroupId
  const expiresInDays = normalizeExpiresInDays(payload.expiresInDays ?? config.defaultExpiresInDays)
  return {
    name: payload.name?.trim() || `touch-great-welfare-${Date.now()}`,
    group_id: groupId || undefined,
    quota: normalizeQuota(payload.quotaUsd, config.defaultQuotaUsd),
    expires_in_days: expiresInDays,
    rate_limit_5h: normalizeRateLimit(payload.rateLimit5h ?? config.defaultRateLimit5h),
    rate_limit_1d: normalizeRateLimit(payload.rateLimit1d ?? config.defaultRateLimit1d),
    rate_limit_7d: normalizeRateLimit(payload.rateLimit7d ?? config.defaultRateLimit7d),
    ip_whitelist: payload.ipWhitelist ?? [],
    ip_blacklist: payload.ipBlacklist ?? [],
    max_active_ips: optionalNonNegativeInt(payload.maxActiveIps) ?? 0,
    ip_idle_timeout_seconds: optionalNonNegativeInt(payload.ipIdleTimeoutSeconds) ?? 0,
    max_concurrency: optionalNonNegativeInt(payload.maxConcurrency) ?? 0,
  }
}

async function createSub2ApiKeyByDatabase(
  config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>,
  sub2apiUserId: string,
  payload: CreateSub2ApiKeyPayload,
) {
  const key = `sk-${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
  const request = buildSub2ApiKeyPayload(config, payload)
  const expiresAt = new Date(Date.now() + Number(request.expires_in_days) * 24 * 60 * 60 * 1000).toISOString()
  const id = await withSub2ApiDatabase(config, async (pool) => {
    const result = await pool.query<{ id: number | string }>(`
      insert into api_keys (
        user_id, key, name, group_id, status, ip_whitelist, ip_blacklist,
        quota, quota_used, expires_at, rate_limit_5h, rate_limit_1d, rate_limit_7d,
        usage_5h, usage_1d, usage_7d, max_active_ips, ip_idle_timeout_seconds,
        max_concurrency, created_at, updated_at
      )
      values (
        $1, $2, $3, $4, 'active', $10::jsonb, $11::jsonb,
        $5, 0, $6, $7, $8, $9,
        0, 0, 0, $12, $13,
        $14, now(), now()
      )
      returning id
    `, [
      Number(sub2apiUserId),
      key,
      request.name,
      request.group_id || null,
      request.quota,
      expiresAt,
      request.rate_limit_5h,
      request.rate_limit_1d,
      request.rate_limit_7d,
      JSON.stringify(request.ip_whitelist),
      JSON.stringify(request.ip_blacklist),
      request.max_active_ips,
      request.ip_idle_timeout_seconds,
      request.max_concurrency,
    ])
    const createdId = result.rows[0]?.id
    if (!createdId)
      throw new Error('Sub2API 数据库未返回 API Key ID')
    return createdId
  })
  return {
    id,
    key,
    name: request.name,
    status: 'active',
    quota: request.quota,
    expires_at: expiresAt,
  } satisfies UpstreamApiKey
}

async function createSub2ApiKeyByAdminApi(
  config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>,
  sub2apiUserId: string,
  payload: CreateSub2ApiKeyPayload,
) {
  const request = buildSub2ApiKeyPayload(config, payload)
  return await callSub2Api<UpstreamApiKey>(config, `/api/v1/admin/users/${encodeURIComponent(sub2apiUserId)}/api-keys`, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

async function insertBinding(
  env: WorkerEnv,
  userId: string,
  sub2apiUserId: string,
  key: UpstreamApiKey,
  quotaUsd: number,
  resourceRef?: ResourceProvisionRef,
) {
  const rawKey = key.key?.trim()
  if (!rawKey)
    throw new Error('Sub2API 未返回 API Key')

  const id = createId('s2k')
  const keyHash = await sha256Hex(rawKey)
  const expiresAt = key.expires_at || undefined
  const status = key.status === 'inactive' ? 'revoked' : 'active'
  const name = key.name || `Sub2API Key ${id}`

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into sub2api_key_bindings (
          id, user_id, application_id, item_id, sub2api_user_id, sub2api_key_id,
          key_hash, key_masked, name, quota_usd, expires_at, status, created_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, current_timestamp)
      `)
      .bind(
        id,
        userId,
        resourceRef?.applicationId || null,
        resourceRef?.itemId || null,
        sub2apiUserId,
        key.id ? String(key.id) : null,
        keyHash,
        maskKey(rawKey),
        name,
        quotaUsd,
        expiresAt || null,
        status,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into sub2api_key_bindings (
        id, user_id, application_id, item_id, sub2api_user_id, sub2api_key_id,
        key_hash, key_masked, name, quota_usd, expires_at, status, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
    `, [
      id,
      userId,
      resourceRef?.applicationId || null,
      resourceRef?.itemId || null,
      sub2apiUserId,
      key.id ? String(key.id) : null,
      keyHash,
      maskKey(rawKey),
      name,
      quotaUsd,
      expiresAt || null,
      status,
    ])
  }

  return {
    id,
    key: rawKey,
    keyMasked: maskKey(rawKey),
    name,
    quotaUsd,
    expiresAt,
    status,
    sub2apiUserId,
    sub2apiKeyId: key.id ? String(key.id) : '',
    reused: false,
  }
}

function mapBinding(row: Sub2ApiKeyBindingRow) {
  return {
    id: row.id,
    sub2apiUserId: row.sub2api_user_id,
    sub2apiKeyId: row.sub2api_key_id || '',
    keyMasked: row.key_masked,
    name: row.name,
    quotaUsd: numberValue(row.quota_usd, 0),
    expiresAt: toIso(row.expires_at),
    status: row.status,
    createdAt: toIso(row.created_at) ?? now(),
    revokedAt: toIso(row.revoked_at),
  }
}

function existingResourceBinding(row: Sub2ApiKeyBindingRow) {
  return {
    ...mapBinding(row),
    reused: true,
  }
}

async function getActiveResourceBinding(env: WorkerEnv, ref: ResourceProvisionRef) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare(`
        select * from sub2api_key_bindings
        where application_id = ?1 and item_id = ?2 and status = ?3
        order by created_at desc, id desc
        limit 1
      `)
      .bind(ref.applicationId, ref.itemId, 'active')
      .first<Sub2ApiKeyBindingRow>()
  }

  const result = await getPool(env).query<Sub2ApiKeyBindingRow>(`
    select * from sub2api_key_bindings
    where application_id = $1 and item_id = $2 and status = $3
    order by created_at desc, id desc
    limit 1
  `, [ref.applicationId, ref.itemId, 'active'])
  return result.rows[0] ?? null
}

async function acquireResourceProvisionLock(env: WorkerEnv, ref: ResourceProvisionRef) {
  await ensureNotificationSchema(env)
  const id = resourceLockId(ref)
  const owner = createId('s2l')
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('delete from sub2api_resource_provision_locks where id = ?1 and expires_at <= current_timestamp')
      .bind(id)
      .run()
    const result = await env.LOCAL_DB!
      .prepare(`
        insert into sub2api_resource_provision_locks (id, owner, expires_at, created_at)
        values (?1, ?2, datetime(current_timestamp, '+' || ?3 || ' seconds'), current_timestamp)
        on conflict (id) do nothing
      `)
      .bind(id, owner, RESOURCE_LOCK_TTL_SECONDS)
      .run() as { meta?: { changes?: number } }
    if (result.meta?.changes === 0)
      throw new Error('该资源正在自动发放，请稍后刷新重试')
    return { id, owner }
  }

  const pool = getPool(env)
  await pool.query('delete from sub2api_resource_provision_locks where id = $1 and expires_at <= now()', [id])
  const result = await pool.query<{ id: string }>(`
    insert into sub2api_resource_provision_locks (id, owner, expires_at, created_at)
    values ($1, $2, now() + ($3::text || ' seconds')::interval, now())
    on conflict (id) do nothing
    returning id
  `, [id, owner, RESOURCE_LOCK_TTL_SECONDS])
  if (!result.rows[0])
    throw new Error('该资源正在自动发放，请稍后刷新重试')
  return { id, owner }
}

async function releaseResourceProvisionLock(env: WorkerEnv, lock: { id: string, owner: string }) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('delete from sub2api_resource_provision_locks where id = ?1 and owner = ?2')
      .bind(lock.id, lock.owner)
      .run()
    return
  }

  await getPool(env).query(
    'delete from sub2api_resource_provision_locks where id = $1 and owner = $2',
    [lock.id, lock.owner],
  )
}

async function withResourceProvisionLock<T>(env: WorkerEnv, ref: ResourceProvisionRef, run: () => Promise<T>) {
  const lock = await acquireResourceProvisionLock(env, ref)
  try {
    return await run()
  }
  finally {
    await releaseResourceProvisionLock(env, lock).catch(() => undefined)
  }
}

async function listBindings(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare('select * from sub2api_key_bindings where user_id = ?1 order by created_at desc limit 20')
      .bind(userId)
      .all<Sub2ApiKeyBindingRow>()
    return (result.results ?? []).map(mapBinding)
  }

  const result = await getPool(env).query<Sub2ApiKeyBindingRow>(
    'select * from sub2api_key_bindings where user_id = $1 order by created_at desc limit 20',
    [userId],
  )
  return result.rows.map(mapBinding)
}

async function getActiveBinding(env: WorkerEnv, userId: string, bindingId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from sub2api_key_bindings where id = ?1 and user_id = ?2 and status = ?3')
      .bind(bindingId, userId, 'active')
      .first<Sub2ApiKeyBindingRow>()
  }

  const result = await getPool(env).query<Sub2ApiKeyBindingRow>(
    'select * from sub2api_key_bindings where id = $1 and user_id = $2 and status = $3',
    [bindingId, userId, 'active'],
  )
  return result.rows[0] ?? null
}

async function revokeBinding(env: WorkerEnv, bindingId: string) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update sub2api_key_bindings set status = ?2, revoked_at = current_timestamp where id = ?1')
      .bind(bindingId, 'revoked')
      .run()
    return
  }

  await getPool(env).query(
    'update sub2api_key_bindings set status = $2, revoked_at = now() where id = $1',
    [bindingId, 'revoked'],
  )
}

async function deleteSub2ApiKeyByDatabase(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, sub2apiKeyId: string) {
  await withSub2ApiDatabase(config, async (pool) => {
    await pool.query('update api_keys set deleted_at = now(), status = $2, updated_at = now() where id = $1', [Number(sub2apiKeyId), 'inactive'])
  })
}

async function deleteSub2ApiKeyByAdminApi(config: Awaited<ReturnType<typeof getEffectiveSub2ApiConfig>>, sub2apiKeyId: string) {
  await callSub2Api(config, `/api/v1/admin/api-keys/${encodeURIComponent(sub2apiKeyId)}`, {
    method: 'DELETE',
  })
}

async function createKey(request: Request, env: WorkerEnv) {
  const auth = await assertAdminRequest(request, env)
  const payload = await readJson<CreateSub2ApiKeyPayload>(request)
  return await createSub2ApiKeyForUser(env, auth.user, payload)
}

export async function createSub2ApiKeyForUser(env: WorkerEnv, user: User, payload: CreateSub2ApiKeyPayload) {
  return await createSub2ApiKey(env, user, payload)
}

async function createSub2ApiKey(env: WorkerEnv, user: User, payload: CreateSub2ApiKeyPayload, resourceRef?: ResourceProvisionRef) {
  const config = await getEffectiveSub2ApiConfig(env)
  if (!config.enabled)
    throw new Error('Sub2API 未启用')
  if (!config.configured)
    throw new Error('Sub2API 尚未配置完成')

  const sub2apiUserId = await ensureSub2ApiUser(config, user)
  const quotaUsd = normalizeQuota(payload.quotaUsd, config.defaultQuotaUsd)
  let upstreamKey: UpstreamApiKey
  if (config.adminApiKey) {
    try {
      upstreamKey = await createSub2ApiKeyByAdminApi(config, sub2apiUserId, payload)
    }
    catch (error) {
      if (!isUnsupportedAdminKeyEndpoint(error))
        throw error
      if (!config.databaseUrl)
        throw new Error('Sub2API Admin API 不支持创建 API Key，且数据库连接未配置')
      upstreamKey = await createSub2ApiKeyByDatabase(config, sub2apiUserId, payload)
    }
  }
  else {
    upstreamKey = await createSub2ApiKeyByDatabase(config, sub2apiUserId, payload)
  }

  return await insertBinding(env, user.id, sub2apiUserId, upstreamKey, quotaUsd, resourceRef)
}

export async function createSub2ApiKeyForResourceItem(env: WorkerEnv, user: User, payload: CreateSub2ApiKeyPayload, resourceRef: ResourceProvisionRef) {
  const existing = await getActiveResourceBinding(env, resourceRef)
  if (existing)
    return existingResourceBinding(existing)

  return await withResourceProvisionLock(env, resourceRef, async () => {
    const existingAfterLock = await getActiveResourceBinding(env, resourceRef)
    if (existingAfterLock)
      return existingResourceBinding(existingAfterLock)

    return await createSub2ApiKey(env, user, payload, resourceRef)
  })
}

async function deleteKey(request: Request, env: WorkerEnv) {
  const auth = await getAuthenticatedRequest(request, env)
  const url = new URL(request.url)
  const bindingId = url.pathname.split('/').pop()?.trim() || ''
  if (!bindingId)
    throw new Error('API Key ID 不能为空')

  const binding = await getActiveBinding(env, auth.user.id, bindingId)
  if (!binding)
    throw new Error('API Key 不存在或已删除')

  const config = await getEffectiveSub2ApiConfig(env)
  if (binding.sub2api_key_id) {
    if (config.adminApiKey) {
      try {
        await deleteSub2ApiKeyByAdminApi(config, binding.sub2api_key_id)
      }
      catch (error) {
        if (!isUnsupportedAdminKeyEndpoint(error))
          throw error
        if (!config.databaseUrl)
          throw new Error('Sub2API Admin API 不支持删除 API Key，且数据库连接未配置')
        await deleteSub2ApiKeyByDatabase(config, binding.sub2api_key_id)
      }
    }
    else {
      await deleteSub2ApiKeyByDatabase(config, binding.sub2api_key_id)
    }
  }

  await revokeBinding(env, binding.id)
  return { ok: true }
}

async function testSub2ApiConfig(env: WorkerEnv) {
  const config = await getEffectiveSub2ApiConfig(env)
  if (!config.enabled)
    throw new Error('Sub2API 未启用')
  if (!config.configured)
    throw new Error('Sub2API 尚未配置完成')

  let adminApiReachable = false
  let databaseReachable = false
  if (config.adminApiKey) {
    await callSub2Api(config, '/api/v1/admin/users?page=1&page_size=1')
    adminApiReachable = true
  }
  if (config.databaseUrl) {
    await withSub2ApiDatabase(config, async (pool) => {
      await pool.query('select 1')
    })
    databaseReachable = true
  }
  return { ok: true, adminApiReachable, databaseReachable }
}

export async function handleSub2ApiRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)

    if (url.pathname === '/api/sub2api/config') {
      if (request.method === 'GET') {
        await assertAdminRequest(request, env)
        return json(serializeConfig(await getEffectiveSub2ApiConfig(env)))
      }
      if (request.method === 'PUT') {
        await assertAdminRequest(request, env)
        const payload = await readJson<SaveSub2ApiConfigPayload>(request)
        return json(serializeConfig(await saveSub2ApiConfig(env, payload)))
      }
    }

    if (url.pathname === '/api/sub2api/test' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      return json(await testSub2ApiConfig(env))
    }

    if (url.pathname === '/api/sub2api/keys') {
      const auth = await getAuthenticatedRequest(request, env)
      if (request.method === 'GET') {
        return json({
          keys: await listBindings(env, auth.user.id),
          config: auth.user.role === 'admin'
            ? serializeConfig(await getEffectiveSub2ApiConfig(env))
            : serializePublicConfig(await getEffectiveSub2ApiConfig(env)),
        })
      }
      if (request.method === 'POST')
        return json(await createKey(request, env))
    }

    if (url.pathname.startsWith('/api/sub2api/keys/') && request.method === 'DELETE')
      return json(await deleteKey(request, env))

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error, error instanceof Error && error.message === '需要管理员权限' ? 403 : 500)
  }
}
