import type { WorkerEnv } from './welfare-state'
import type { ApplicationItem, User } from '~/composables/welfare'
import { Pool } from 'pg'
import { assertAdminRequest, boolValue, createId, errorResponse, fetchWithTimeout, json, maskSecret, readJson } from './auth'
import { decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { md5Hex } from './ldc-credit'
import { ensureNotificationSchema } from './notifications'
import { getPool, shouldUseD1 } from './welfare-state'

interface DatabaseProvisionConfigRow {
  id: string
  enabled: number | boolean
  root_url_encrypted?: string | null
  default_expires_in_days?: number | string | null
  database_prefix?: string | null
  onepanel_base_url?: string | null
  onepanel_api_key_encrypted?: string | null
}

interface DatabaseResourceBindingRow {
  id: string
  user_id: string
  application_id: string
  item_id: string
  database_type: string
  database_name: string
  username: string
  password_hash: string
  connection_url_encrypted?: string | null
  connection_url_masked: string
  permission: string
  expires_at?: string | Date | null
  status: 'active' | 'revoked'
  created_at: string | Date
  revoked_at?: string | Date | null
}

interface SaveDatabaseProvisionConfigPayload {
  enabled?: boolean
  rootUrl?: string
  clearRootUrl?: boolean
  defaultExpiresInDays?: number
  databasePrefix?: string
  onePanelBaseUrl?: string
  onePanelApiKey?: string
  clearOnePanelApiKey?: boolean
}

interface DatabaseProvisionPayload {
  applicationId: string
  item: ApplicationItem
  user: User
}

interface DatabaseProvisionResult {
  id: string
  databaseType: string
  databaseName: string
  username: string
  password?: string
  connectionUrl?: string
  connectionUrlMasked: string
  permission: string
  expiresAt?: string
  status: 'active'
  reused?: boolean
}

interface OnePanelStatusEndpoint {
  id: string
  label: string
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

const DATABASE_PROVISION_CONFIG_ID = 'default'
const DEFAULT_EXPIRES_IN_DAYS = 30
const DEFAULT_DATABASE_PREFIX = 'twg'
const SUPPORTED_DATABASE_SUBTYPES = new Set(['postgresql'])
const ONE_PANEL_STATUS_ENDPOINTS: OnePanelStatusEndpoint[] = [
  { id: 'v2_device_base', label: '设备基础信息', method: 'POST', path: '/api/v2/toolbox/device/base', body: {} },
  { id: 'v1_base_os', label: '系统基础信息', method: 'GET', path: '/api/v1/dashboard/base/os' },
  { id: 'v1_dashboard_current', label: '实时概览', method: 'GET', path: '/api/v1/dashboard/current?ioOption=all&netOption=all&scope=all' },
]

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

function normalizeExpiresInDays(value: unknown) {
  return Math.max(1, Math.min(365, Math.trunc(numberValue(value, DEFAULT_EXPIRES_IN_DAYS))))
}

function normalizeOnePanelBaseUrl(value: unknown) {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!text)
    return ''

  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    throw new Error('OnePanel 地址格式无效')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('OnePanel 地址必须使用 HTTP 或 HTTPS')

  url.username = ''
  url.password = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function normalizeNamePart(value: unknown, fallback: string, maxLength = 32) {
  const text = typeof value === 'string' ? value : fallback
  let fallbackNormalized = fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
  if (fallbackNormalized && !/^[a-z_]/.test(fallbackNormalized))
    fallbackNormalized = `x_${fallbackNormalized}`.slice(0, maxLength)
  let normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
  if (normalized && !/^[a-z_]/.test(normalized))
    normalized = `x_${normalized}`.slice(0, maxLength)
  return normalized || fallbackNormalized || 'x'
}

function stableHashInt(parts: unknown[]) {
  const text = parts.map(part => String(part ?? '')).join('|')
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}

function stableIdentifierHash(parts: unknown[]) {
  return (stableHashInt(parts) >>> 0).toString(36).padStart(7, '0').slice(0, 7)
}

function composedIdentifier(parts: unknown[], fallback: string) {
  const suffix = stableIdentifierHash(parts)
  const baseMaxLength = 63 - suffix.length - 1
  const base = normalizeNamePart(
    parts.map(part => normalizeNamePart(part, 'x', 16)).join('_'),
    fallback,
    baseMaxLength,
  )
  return normalizeNamePart(`${base}_${suffix}`, fallback, 63)
}

function quoteIdent(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
    throw new Error(`数据库标识符不合法：${value}`)
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, '\'\'')}'`
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, 'A').replace(/\//g, 'b').replace(/=+$/g, '')
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

async function getStoredDatabaseProvisionConfig(env: WorkerEnv) {
  await ensureNotificationSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from database_provision_config where id = ?1')
      .bind(DATABASE_PROVISION_CONFIG_ID)
      .first<DatabaseProvisionConfigRow>()
  }

  const result = await getPool(env).query<DatabaseProvisionConfigRow>(
    'select * from database_provision_config where id = $1',
    [DATABASE_PROVISION_CONFIG_ID],
  )
  return result.rows[0] ?? null
}

async function getEffectiveDatabaseProvisionConfig(env: WorkerEnv) {
  const stored = await getStoredDatabaseProvisionConfig(env)
  const rootUrl = await decryptOptionalSecret(stored?.root_url_encrypted, env)
  const onePanelApiKey = await decryptOptionalSecret(stored?.onepanel_api_key_encrypted, env)
  return {
    enabled: stored ? boolValue(stored.enabled) : false,
    rootUrl,
    defaultExpiresInDays: normalizeExpiresInDays(stored?.default_expires_in_days),
    databasePrefix: normalizeNamePart(stored?.database_prefix, DEFAULT_DATABASE_PREFIX),
    onePanelBaseUrl: normalizeOnePanelBaseUrl(stored?.onepanel_base_url),
    onePanelApiKey,
    configured: !!rootUrl,
    source: stored ? 'admin' as const : 'empty' as const,
  }
}

function serializeConfig(config: Awaited<ReturnType<typeof getEffectiveDatabaseProvisionConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    rootUrlMasked: maskSecret(config.rootUrl),
    defaultExpiresInDays: config.defaultExpiresInDays,
    databasePrefix: config.databasePrefix,
    onePanelBaseUrl: config.onePanelBaseUrl,
    onePanelApiKeyMasked: maskSecret(config.onePanelApiKey),
    source: config.source,
  }
}

async function saveDatabaseProvisionConfig(env: WorkerEnv, payload: SaveDatabaseProvisionConfigPayload) {
  await ensureNotificationSchema(env)
  const stored = await getStoredDatabaseProvisionConfig(env)
  let rootUrlEncrypted = stored?.root_url_encrypted || null
  let onePanelApiKeyEncrypted = stored?.onepanel_api_key_encrypted || null

  if (payload.clearRootUrl)
    rootUrlEncrypted = null
  if (payload.clearOnePanelApiKey)
    onePanelApiKeyEncrypted = null
  if (payload.rootUrl?.trim())
    rootUrlEncrypted = await encryptSecret(payload.rootUrl.trim(), encryptionSecret(env))
  if (payload.onePanelApiKey?.trim())
    onePanelApiKeyEncrypted = await encryptSecret(payload.onePanelApiKey.trim(), encryptionSecret(env))

  const config = {
    enabled: payload.enabled !== false,
    rootUrlEncrypted,
    defaultExpiresInDays: normalizeExpiresInDays(payload.defaultExpiresInDays),
    databasePrefix: normalizeNamePart(payload.databasePrefix, DEFAULT_DATABASE_PREFIX),
    onePanelBaseUrl: normalizeOnePanelBaseUrl(payload.onePanelBaseUrl),
    onePanelApiKeyEncrypted,
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into database_provision_config (
          id, enabled, root_url_encrypted, default_expires_in_days,
          database_prefix, onepanel_base_url, onepanel_api_key_encrypted, updated_at
        )
        values ('default', ?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          root_url_encrypted = excluded.root_url_encrypted,
          default_expires_in_days = excluded.default_expires_in_days,
          database_prefix = excluded.database_prefix,
          onepanel_base_url = excluded.onepanel_base_url,
          onepanel_api_key_encrypted = excluded.onepanel_api_key_encrypted,
          updated_at = current_timestamp
      `)
      .bind(
        config.enabled ? 1 : 0,
        config.rootUrlEncrypted,
        config.defaultExpiresInDays,
        config.databasePrefix,
        config.onePanelBaseUrl,
        config.onePanelApiKeyEncrypted,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into database_provision_config (
        id, enabled, root_url_encrypted, default_expires_in_days,
        database_prefix, onepanel_base_url, onepanel_api_key_encrypted, updated_at
      )
      values ('default', $1, $2, $3, $4, $5, $6, now())
      on conflict (id)
      do update set
        enabled = excluded.enabled,
        root_url_encrypted = excluded.root_url_encrypted,
        default_expires_in_days = excluded.default_expires_in_days,
        database_prefix = excluded.database_prefix,
        onepanel_base_url = excluded.onepanel_base_url,
        onepanel_api_key_encrypted = excluded.onepanel_api_key_encrypted,
        updated_at = now()
    `, [
      config.enabled,
      config.rootUrlEncrypted,
      config.defaultExpiresInDays,
      config.databasePrefix,
      config.onePanelBaseUrl,
      config.onePanelApiKeyEncrypted,
    ])
  }

  return getEffectiveDatabaseProvisionConfig(env)
}

function assertPostgresRootUrl(rootUrl: string) {
  if (!/^postgres(?:ql)?:\/\//i.test(rootUrl))
    throw new Error('数据库 root 连接当前仅支持 PostgreSQL URL')
  return rootUrl
}

async function withRootPool<T>(rootUrl: string, run: (pool: Pool) => Promise<T>) {
  const pool = new Pool({ connectionString: assertPostgresRootUrl(rootUrl), max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000 })
  try {
    return await run(pool)
  }
  finally {
    await pool.end().catch(() => undefined)
  }
}

function advisoryLockKeys(applicationId: string, itemId: string) {
  return [
    stableHashInt(['database-provision', applicationId]),
    stableHashInt(['database-provision', applicationId, itemId]),
  ]
}

async function withDatabaseProvisionLock<T>(rootUrl: string, applicationId: string, itemId: string, run: () => Promise<T>) {
  return withRootPool(rootUrl, async (pool) => {
    const keys = advisoryLockKeys(applicationId, itemId)
    await pool.query('select pg_advisory_lock($1, $2)', keys)
    try {
      return await run()
    }
    finally {
      await pool.query('select pg_advisory_unlock($1, $2)', keys).catch(() => undefined)
    }
  })
}

function rootUrlForDatabase(rootUrl: string, databaseName: string) {
  const url = new URL(assertPostgresRootUrl(rootUrl))
  url.pathname = `/${databaseName}`
  return url.toString()
}

function databaseValue(item: ApplicationItem, ...keys: string[]) {
  for (const source of [item.approvedPayload, item.payload]) {
    if (!source)
      continue
    for (const key of keys) {
      const value = source[key]
      if (value !== undefined && value !== null && value !== '')
        return value
    }
  }
  return undefined
}

function databaseNameForItem(config: Awaited<ReturnType<typeof getEffectiveDatabaseProvisionConfig>>, user: User, item: ApplicationItem) {
  const approved = databaseValue(item, 'databaseName', 'dbName')
  if (approved)
    return normalizeNamePart(approved, `${config.databasePrefix}_db`, 63)

  const env = normalizeNamePart(databaseValue(item, 'environment'), 'dev')
  return composedIdentifier([config.databasePrefix, env, user.id, item.id], `${config.databasePrefix}_db`)
}

function usernameForItem(config: Awaited<ReturnType<typeof getEffectiveDatabaseProvisionConfig>>, user: User, item: ApplicationItem) {
  const approved = databaseValue(item, 'username', 'userName')
  if (approved)
    return normalizeNamePart(approved, `${config.databasePrefix}_user`, 63)

  return composedIdentifier([config.databasePrefix, user.id, item.id], `${config.databasePrefix}_user`)
}

function permissionForItem(item: ApplicationItem) {
  const permission = String(databaseValue(item, 'permission') || item.requestedPermission || 'readonly')
  return ['readonly', 'readwrite', 'admin', 'temporary_ops'].includes(permission) ? permission : 'readonly'
}

function expiresAtForItem(config: Awaited<ReturnType<typeof getEffectiveDatabaseProvisionConfig>>, item: ApplicationItem) {
  const expiresInDays = normalizeExpiresInDays(databaseValue(item, 'expiresInDays') ?? config.defaultExpiresInDays)
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
  return expiresAt.toISOString()
}

function maskedConnectionUrl(connectionUrl: string) {
  const url = new URL(connectionUrl)
  if (url.password)
    url.password = '****'
  return url.toString()
}

function buildUserConnectionUrl(rootUrl: string, databaseName: string, username: string, password: string) {
  const url = new URL(rootUrlForDatabase(rootUrl, databaseName))
  url.username = username
  url.password = password
  return url.toString()
}

async function ensureDatabaseAndRole(rootUrl: string, databaseName: string, username: string, password: string, permission: string, expiresAt: string) {
  await withRootPool(rootUrl, async (pool) => {
    const existingDatabase = await pool.query('select 1 from pg_database where datname = $1', [databaseName])
    if (!existingDatabase.rowCount)
      await pool.query(`create database ${quoteIdent(databaseName)}`)

    const existingRole = await pool.query('select 1 from pg_roles where rolname = $1', [username])
    if (!existingRole.rowCount)
      await pool.query(`create role ${quoteIdent(username)} with login password ${quoteLiteral(password)} valid until ${quoteLiteral(expiresAt)}`)
    else
      await pool.query(`alter role ${quoteIdent(username)} with login password ${quoteLiteral(password)} valid until ${quoteLiteral(expiresAt)}`)

    await pool.query(`grant connect on database ${quoteIdent(databaseName)} to ${quoteIdent(username)}`)
    if (permission === 'admin' || permission === 'temporary_ops')
      await pool.query(`grant all privileges on database ${quoteIdent(databaseName)} to ${quoteIdent(username)}`)
  })

  await withRootPool(rootUrlForDatabase(rootUrl, databaseName), async (pool) => {
    await pool.query(`grant usage on schema public to ${quoteIdent(username)}`)
    if (permission === 'admin' || permission === 'temporary_ops') {
      await pool.query(`grant all privileges on schema public to ${quoteIdent(username)}`)
      await pool.query(`grant all privileges on all tables in schema public to ${quoteIdent(username)}`)
      await pool.query(`grant all privileges on all sequences in schema public to ${quoteIdent(username)}`)
      await pool.query(`alter default privileges in schema public grant all privileges on tables to ${quoteIdent(username)}`)
      await pool.query(`alter default privileges in schema public grant all privileges on sequences to ${quoteIdent(username)}`)
      return
    }

    await pool.query(`grant select on all tables in schema public to ${quoteIdent(username)}`)
    await pool.query(`alter default privileges in schema public grant select on tables to ${quoteIdent(username)}`)
    if (permission === 'readwrite') {
      await pool.query(`grant insert, update, delete on all tables in schema public to ${quoteIdent(username)}`)
      await pool.query(`grant usage, select on all sequences in schema public to ${quoteIdent(username)}`)
      await pool.query(`alter default privileges in schema public grant insert, update, delete on tables to ${quoteIdent(username)}`)
      await pool.query(`alter default privileges in schema public grant usage, select on sequences to ${quoteIdent(username)}`)
    }
  })
}

async function insertDatabaseResourceBinding(
  env: WorkerEnv,
  input: {
    userId: string
    applicationId: string
    itemId: string
    databaseType: string
    databaseName: string
    username: string
    password: string
    connectionUrl: string
    permission: string
    expiresAt: string
  },
): Promise<DatabaseProvisionResult> {
  const id = createId('dbp')
  const passwordHash = await sha256Hex(input.password)
  const connectionUrlEncrypted = await encryptSecret(input.connectionUrl, encryptionSecret(env))
  const connectionUrlMasked = maskedConnectionUrl(input.connectionUrl)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into database_resource_bindings (
          id, user_id, application_id, item_id, database_type, database_name,
          username, password_hash, connection_url_encrypted, connection_url_masked,
          permission, expires_at, status, created_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', current_timestamp)
      `)
      .bind(
        id,
        input.userId,
        input.applicationId,
        input.itemId,
        input.databaseType,
        input.databaseName,
        input.username,
        passwordHash,
        connectionUrlEncrypted,
        connectionUrlMasked,
        input.permission,
        input.expiresAt,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into database_resource_bindings (
        id, user_id, application_id, item_id, database_type, database_name,
        username, password_hash, connection_url_encrypted, connection_url_masked,
        permission, expires_at, status, created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', now())
    `, [
      id,
      input.userId,
      input.applicationId,
      input.itemId,
      input.databaseType,
      input.databaseName,
      input.username,
      passwordHash,
      connectionUrlEncrypted,
      connectionUrlMasked,
      input.permission,
      input.expiresAt,
    ])
  }

  return {
    id,
    databaseType: input.databaseType,
    databaseName: input.databaseName,
    username: input.username,
    password: input.password,
    connectionUrl: input.connectionUrl,
    connectionUrlMasked,
    permission: input.permission,
    expiresAt: input.expiresAt,
    status: 'active' as const,
  }
}

async function findActiveDatabaseResourceBinding(env: WorkerEnv, applicationId: string, itemId: string) {
  await ensureNotificationSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare(`
        select * from database_resource_bindings
        where application_id = ?1 and item_id = ?2 and status = 'active'
        order by created_at desc, id desc
        limit 1
      `)
      .bind(applicationId, itemId)
      .first<DatabaseResourceBindingRow>()
  }

  const result = await getPool(env).query<DatabaseResourceBindingRow>(`
    select * from database_resource_bindings
    where application_id = $1 and item_id = $2 and status = 'active'
    order by created_at desc, id desc
    limit 1
  `, [applicationId, itemId])
  return result.rows[0] ?? null
}

function existingDatabaseProvisionResult(row: DatabaseResourceBindingRow): DatabaseProvisionResult {
  return {
    ...serializeDatabaseResourceBinding(row),
    status: 'active',
    reused: true,
  }
}

async function testDatabaseProvisionConfig(env: WorkerEnv) {
  const config = await getEffectiveDatabaseProvisionConfig(env)
  if (!config.enabled)
    throw new Error('数据库自动发放未启用')
  if (!config.rootUrl)
    throw new Error('数据库 root 连接未配置')

  await withRootPool(config.rootUrl, async (pool) => {
    await pool.query('select current_database()')
  })
  return { ok: true }
}

function onePanelRequestHeaders(apiKey: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return {
    'content-type': 'application/json',
    '1Panel-Token': md5Hex(`1Panel${apiKey}${timestamp}`),
    '1Panel-Timestamp': timestamp,
  }
}

function onePanelPayloadError(payload: unknown) {
  if (!payload || typeof payload !== 'object')
    return ''

  const data = payload as { code?: unknown, message?: unknown, msg?: unknown }
  const code = data.code === undefined || data.code === null ? '' : String(data.code)
  if (!code || code === '200' || code === '0')
    return ''

  return String(data.message || data.msg || `OnePanel 返回异常状态：${code}`)
}

async function fetchOnePanelEndpoint(config: Awaited<ReturnType<typeof getEffectiveDatabaseProvisionConfig>>, endpoint: OnePanelStatusEndpoint) {
  const response = await fetchWithTimeout(`${config.onePanelBaseUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: onePanelRequestHeaders(config.onePanelApiKey),
    body: endpoint.method === 'POST' ? JSON.stringify(endpoint.body ?? {}) : undefined,
  }, 12000)

  const text = await response.text()
  let data: unknown = text
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    }
    catch {
      data = text
    }
  }
  else {
    data = {}
  }

  const payloadError = response.ok ? onePanelPayloadError(data) : ''
  return {
    id: endpoint.id,
    label: endpoint.label,
    method: endpoint.method,
    path: endpoint.path,
    ok: response.ok && !payloadError,
    status: response.status,
    error: response.ok ? payloadError || undefined : `OnePanel 请求失败：${response.status}`,
    data,
  }
}

async function fetchOnePanelStatus(env: WorkerEnv) {
  const config = await getEffectiveDatabaseProvisionConfig(env)
  if (!config.onePanelBaseUrl)
    throw new Error('OnePanel 地址未配置')
  if (!config.onePanelApiKey)
    throw new Error('OnePanel API Key 未配置')

  const endpoints = await Promise.all(ONE_PANEL_STATUS_ENDPOINTS.map(async (endpoint) => {
    try {
      return await fetchOnePanelEndpoint(config, endpoint)
    }
    catch (error) {
      return {
        id: endpoint.id,
        label: endpoint.label,
        method: endpoint.method,
        path: endpoint.path,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : 'OnePanel 请求失败',
        data: {},
      }
    }
  }))

  return {
    configured: true,
    baseUrl: config.onePanelBaseUrl,
    checkedAt: new Date().toISOString(),
    ok: endpoints.some(endpoint => endpoint.ok),
    endpoints,
  }
}

export async function createDatabaseForResourceItem(env: WorkerEnv, payload: DatabaseProvisionPayload) {
  const existing = await findActiveDatabaseResourceBinding(env, payload.applicationId, payload.item.id)
  if (existing)
    return existingDatabaseProvisionResult(existing)

  const config = await getEffectiveDatabaseProvisionConfig(env)
  if (!config.enabled)
    throw new Error('数据库自动发放未启用')
  if (!config.rootUrl)
    throw new Error('数据库 root 连接未配置')
  if (!SUPPORTED_DATABASE_SUBTYPES.has(payload.item.resourceSubtype))
    throw new Error(`数据库自动发放当前仅支持 PostgreSQL，${payload.item.resourceSubtype} 需人工处理`)

  return withDatabaseProvisionLock(config.rootUrl, payload.applicationId, payload.item.id, async () => {
    const existingAfterLock = await findActiveDatabaseResourceBinding(env, payload.applicationId, payload.item.id)
    if (existingAfterLock)
      return existingDatabaseProvisionResult(existingAfterLock)

    const databaseName = databaseNameForItem(config, payload.user, payload.item)
    const username = usernameForItem(config, payload.user, payload.item)
    const permission = permissionForItem(payload.item)
    const expiresAt = expiresAtForItem(config, payload.item)
    const password = randomPassword()
    const connectionUrl = buildUserConnectionUrl(config.rootUrl, databaseName, username, password)

    await ensureDatabaseAndRole(config.rootUrl, databaseName, username, password, permission, expiresAt)
    return insertDatabaseResourceBinding(env, {
      userId: payload.user.id,
      applicationId: payload.applicationId,
      itemId: payload.item.id,
      databaseType: 'postgresql',
      databaseName,
      username,
      password,
      connectionUrl,
      permission,
      expiresAt,
    })
  })
}

export function serializeDatabaseResourceBinding(row: DatabaseResourceBindingRow) {
  return {
    id: row.id,
    databaseType: row.database_type,
    databaseName: row.database_name,
    username: row.username,
    connectionUrlMasked: row.connection_url_masked,
    permission: row.permission,
    expiresAt: toIso(row.expires_at),
    status: row.status,
    createdAt: toIso(row.created_at) || '',
    revokedAt: toIso(row.revoked_at),
  }
}

export async function handleDatabaseProvisionRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)

    if (url.pathname === '/api/database-provision/config' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      return json(serializeConfig(await getEffectiveDatabaseProvisionConfig(env)))
    }

    if (url.pathname === '/api/database-provision/config' && request.method === 'PUT') {
      await assertAdminRequest(request, env)
      const payload = await readJson<SaveDatabaseProvisionConfigPayload>(request)
      return json(serializeConfig(await saveDatabaseProvisionConfig(env, payload)))
    }

    if (url.pathname === '/api/database-provision/test' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      return json(await testDatabaseProvisionConfig(env))
    }

    if (url.pathname === '/api/database-provision/onepanel-status' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      return json(await fetchOnePanelStatus(env))
    }

    return errorResponse(new Error('Not Found'), 404)
  }
  catch (error) {
    return errorResponse(error, error instanceof Error && error.message === '需要管理员权限' ? 403 : 500)
  }
}
