import type { WorkerEnv } from './core'
import type { CreditTransaction, UserCoupon, WelfareApplication, WelfareState } from '~/shared/welfare-types'
import { normalizeApplicationPolicy } from '~/composables/welfare'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { decryptSecret, encryptSecret } from '../crypto'
import { backfillPointTransactionsFromState, ensurePointTransactionSchema, syncUserPointBalancesFromLedger } from '../points'
import { allowUnstableNormalizedReads, getPool, shouldUseD1 } from './connection'
import { isRecord } from './records'
import { syncStudentVerifiedProfiles } from './verifications'

const STATE_KEY = 'default'
const INITIAL_STATE_VERSION = 1
const POSTGRES_PERF_LOG_THRESHOLD_MS = 500
const POSTGRES_SNAPSHOT_BATCH_SIZE = 200

export type PointBalanceSyncMode = false | 'current-user' | 'all'

export interface ReadWelfareStateOptions {
  syncPointBalances?: PointBalanceSyncMode
  currentUserId?: string
}

export interface WelfareStateRecord {
  state: unknown
  version: number
}

export function stateVersionPayload(version: number) {
  return { version }
}

export interface WriteWelfareStateOptions {
  expectedVersion?: number
  previousState?: unknown
}

export type AtomicPointTransaction = Required<Pick<CreditTransaction, 'id' | 'userId' | 'delta' | 'type' | 'reason' | 'balanceAfter' | 'createdAt'>> & Pick<CreditTransaction, 'refId'>

export class StateVersionConflictError extends Error {
  constructor() {
    super('业务状态已被其他请求更新，请刷新后重试')
    this.name = 'StateVersionConflictError'
  }
}

let postgresSchemaKey = ''
let postgresSchemaPromise: Promise<void> | undefined
const d1SchemaPromises = new WeakMap<D1Database, Promise<void>>()

interface EncryptedWelfareStateEnvelope {
  __encrypted: true
  payload: string
  encryptedAt: string
}

function now() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function stateEncryptionSecret(env: WorkerEnv) {
  return env.WELFARE_STATE_SECRET_KEY?.trim() || env.NOTIFY_SECRET_KEY?.trim() || ''
}

function logWelfarePerf(label: string, startedAt: number, details = '') {
  const duration = Date.now() - startedAt

  if (duration >= 1000) {
    console.error(`[welfare:perf:SLOW] ${label} ${duration}ms${details ? ` ${details}` : ''}`)
  }
  else if (duration >= POSTGRES_PERF_LOG_THRESHOLD_MS) {
    console.warn(`[welfare:perf:WARN] ${label} ${duration}ms${details ? ` ${details}` : ''}`)
  }
  return duration
}

function isEncryptedWelfareStateEnvelope(value: unknown): value is EncryptedWelfareStateEnvelope {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).__encrypted === true
    && typeof (value as Record<string, unknown>).payload === 'string'
}

async function decodeStoredState(env: WorkerEnv, storedState: unknown) {
  if (!isEncryptedWelfareStateEnvelope(storedState))
    return storedState

  const secret = stateEncryptionSecret(env)
  if (!secret)
    throw new Error('WELFARE_STATE_SECRET_KEY 未配置，无法读取加密业务状态')

  return JSON.parse(await decryptSecret(storedState.payload, secret))
}

async function encodeStoredState(env: WorkerEnv, state: unknown) {
  const secret = stateEncryptionSecret(env)
  if (!secret)
    return state

  return {
    __encrypted: true,
    payload: await encryptSecret(JSON.stringify(state), secret),
    encryptedAt: new Date().toISOString(),
  } satisfies EncryptedWelfareStateEnvelope
}

async function runSchemaSetup(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_app_state (
          id text primary key,
          state text not null,
          updated_at text not null default current_timestamp,
          version integer not null default 1,
          mutation_id text
        )
      `)
      .run()
    try {
      await env.LOCAL_DB!
        .prepare('alter table welfare_app_state add column version integer not null default 1')
        .run()
    }
    catch {
      // Some D1 runtimes do not support ADD COLUMN IF NOT EXISTS; duplicate-column is harmless here.
    }
    try {
      await env.LOCAL_DB!
        .prepare('alter table welfare_app_state add column mutation_id text')
        .run()
    }
    catch {
      // Duplicate-column is harmless; this marker lets D1 point-ledger writes avoid comparing large state JSON blobs.
    }
    await ensureSnapshotSchema(env)
    return
  }

  await getPool(env).query(`
    create table if not exists welfare_app_state (
      id text primary key,
      state jsonb not null,
      version integer not null default 1,
      updated_at timestamptz not null default now(),
      mutation_id text
    )
  `)
  await getPool(env).query('alter table welfare_app_state add column if not exists version integer not null default 1')
  await getPool(env).query('alter table welfare_app_state add column if not exists mutation_id text')
  await ensureSnapshotSchema(env)
}

export async function ensureSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    const db = env.LOCAL_DB!
    const current = d1SchemaPromises.get(db)
    if (current)
      return current

    const next = runSchemaSetup(env).catch((error) => {
      if (d1SchemaPromises.get(db) === next)
        d1SchemaPromises.delete(db)
      throw error
    })
    d1SchemaPromises.set(db, next)
    return next
  }

  const key = `pg:${env.HYPERDRIVE?.connectionString ?? ''}`
  if (postgresSchemaPromise && postgresSchemaKey === key)
    return postgresSchemaPromise

  postgresSchemaKey = key
  postgresSchemaPromise = runSchemaSetup(env).catch((error) => {
    if (postgresSchemaKey === key)
      postgresSchemaPromise = undefined
    throw error
  })
  return postgresSchemaPromise
}

async function ensureSnapshotSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_applications (
          id text primary key,
          user_id text not null,
          type text not null,
          status text not null,
          title text not null,
          payload text not null,
          created_at text not null,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_status_created on welfare_applications (status, created_at asc, id asc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_user_status_created on welfare_applications (user_id, status, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists user_coupons (
          id text primary key,
          user_id text not null,
          name text not null,
          scope text,
          discount_type text,
          discount_rate real not null,
          discount_amount integer,
          payload text not null,
          created_at text not null,
          expires_at text,
          used_at text
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
      .run()
    return
  }

  await getPool(env).query(`
    create table if not exists welfare_applications (
      id text primary key,
      user_id text not null,
      type text not null,
      status text not null,
      title text not null,
      payload text not null,
      created_at text not null,
      updated_at text not null default current_timestamp
    )
  `)
  await getPool(env).query('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
  await getPool(env).query('create index if not exists idx_welfare_applications_status_created on welfare_applications (status, created_at asc, id asc)')
  await getPool(env).query('create index if not exists idx_welfare_applications_user_status_created on welfare_applications (user_id, status, created_at desc, id desc)')
  await getPool(env).query(`
    create table if not exists user_coupons (
      id text primary key,
      user_id text not null,
      name text not null,
      scope text,
      discount_type text,
      discount_rate real not null,
      discount_amount integer,
      payload text not null,
      created_at text not null,
      expires_at text,
      used_at text
    )
  `)
  await getPool(env).query('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
}

function normalizeStateVersion(value: unknown) {
  const version = Math.trunc(Number(value))
  return Number.isFinite(version) && version > 0 ? version : INITIAL_STATE_VERSION
}

export async function readWelfareStateRecord(env: WorkerEnv, options: ReadWelfareStateOptions = {}): Promise<WelfareStateRecord> {
  const totalStartedAt = Date.now()
  const schemaStartedAt = Date.now()
  await ensureSchema(env)
  logWelfarePerf('ensureSchema', schemaStartedAt)

  const readStartedAt = Date.now()
  const record = shouldUseD1(env)
    ? await (async () => {
        const row = await env.LOCAL_DB!
          .prepare('select state, version from welfare_app_state where id = ?1')
          .bind(STATE_KEY)
          .first<{ state: string, version?: number }>()
        return {
          state: row?.state ? JSON.parse(row.state) : {},
          version: normalizeStateVersion(row?.version),
        }
      })()
    : await (async () => {
        const row = (await getPool(env).query<{ state: unknown, version?: number }>(
          'select state, version from welfare_app_state where id = $1',
          [STATE_KEY],
        )).rows[0]
        return {
          state: row?.state ?? {},
          version: normalizeStateVersion(row?.version),
        }
      })()
  logWelfarePerf('read state record', readStartedAt, shouldUseD1(env) ? 'store=d1' : 'store=postgres')

  const decodeStartedAt = Date.now()
  const state = await decodeStoredState(env, record.state) as Partial<WelfareState>
  state.applicationPolicy = normalizeApplicationPolicy(state.applicationPolicy)
  logWelfarePerf('decode state', decodeStartedAt)

  if (options.syncPointBalances === 'all') {
    const syncStartedAt = Date.now()
    await syncUserPointBalancesFromLedger(env, state)
    logWelfarePerf('sync point balances', syncStartedAt, 'scope=all')
  }
  else if (options.syncPointBalances === 'current-user' && options.currentUserId) {
    const syncStartedAt = Date.now()
    await syncUserPointBalancesFromLedger(env, state, [options.currentUserId])
    logWelfarePerf('sync point balances', syncStartedAt, 'scope=current-user')
  }

  const retentionStartedAt = Date.now()
  const retainedState = syncStudentVerifiedProfiles(applyWelfareRetentionPolicy(state).state)
  logWelfarePerf('apply retention policy', retentionStartedAt)
  logWelfarePerf('readWelfareStateRecord total', totalStartedAt, `sync=${options.syncPointBalances || false}`)
  return {
    state: retainedState,
    version: record.version,
  }
}

export async function readWelfareState(env: WorkerEnv, options: ReadWelfareStateOptions = {}) {
  if (allowUnstableNormalizedReads(env)) {
    const { readWelfareStateFromTables } = await import('./hybrid-read')
    const state = await readWelfareStateFromTables(env) as unknown as Partial<WelfareState>
    state.applicationPolicy = normalizeApplicationPolicy(state.applicationPolicy)
    return syncStudentVerifiedProfiles(state)
  }

  return (await readWelfareStateRecord(env, options)).state
}

export async function readCurrentUserApplicationSnapshots(env: WorkerEnv, userId: string, options: { status?: string[], limit?: number, offset?: number } = {}) {
  await ensureSchema(env)
  const status = options.status?.filter(Boolean) ?? []
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  if (shouldUseD1(env)) {
    const statusClause = status.length ? ` and status in (${status.map(() => '?').join(', ')})` : ''
    const result = await env.LOCAL_DB!
      .prepare(`select payload from welfare_applications where user_id = ?${statusClause} order by created_at desc, id desc limit ? offset ?`)
      .bind(userId, ...status, limit, offset)
      .all<{ payload: string }>()
    return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
  }

  const result = status.length
    ? await getPool(env).query<{ payload: string }>(
        'select payload from welfare_applications where user_id = $1 and status = any($2) order by created_at desc, id desc limit $3 offset $4',
        [userId, status, limit, offset],
      )
    : await getPool(env).query<{ payload: string }>(
        'select payload from welfare_applications where user_id = $1 order by created_at desc, id desc limit $2 offset $3',
        [userId, limit, offset],
      )
  return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
}

export async function readAdminApplicationSnapshots(env: WorkerEnv, options: { status?: string[], limit?: number, offset?: number } = {}) {
  await ensureSchema(env)
  const status = options.status?.filter(Boolean) ?? []
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0

  if (shouldUseD1(env)) {
    const statusClause = status.length ? ` where status in (${status.map(() => '?').join(', ')})` : ''
    const result = await env.LOCAL_DB!
      .prepare(`select payload from welfare_applications${statusClause} order by created_at desc, id desc limit ? offset ?`)
      .bind(...status, limit, offset)
      .all<{ payload: string }>()
    return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
  }

  const result = status.length
    ? await getPool(env).query<{ payload: string }>(
        'select payload from welfare_applications where status = any($1) order by created_at desc, id desc limit $2 offset $3',
        [status, limit, offset],
      )
    : await getPool(env).query<{ payload: string }>(
        'select payload from welfare_applications order by created_at desc, id desc limit $1 offset $2',
        [limit, offset],
      )
  return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
}

export async function readCurrentUserCouponSnapshots(env: WorkerEnv, userId: string) {
  await ensureSchema(env)
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare('select payload from user_coupons where user_id = ?1 order by created_at desc, id desc')
      .bind(userId)
      .all<{ payload: string }>()
    return (result.results ?? []).map(row => JSON.parse(row.payload) as UserCoupon)
  }

  const result = await getPool(env).query<{ payload: string }>(
    'select payload from user_coupons where user_id = $1 order by created_at desc, id desc',
    [userId],
  )
  return result.rows.map(row => JSON.parse(row.payload) as UserCoupon)
}

async function currentStateVersion(env: WorkerEnv) {
  await ensureSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select version from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ version?: number }>()
    return row ? normalizeStateVersion(row.version) : undefined
  }

  const row = (await getPool(env).query<{ version?: number }>(
    'select version from welfare_app_state where id = $1',
    [STATE_KEY],
  )).rows[0]
  return row ? normalizeStateVersion(row.version) : undefined
}

async function assertExpectedStateVersion(env: WorkerEnv, expectedVersion?: number) {
  if (expectedVersion === undefined)
    return

  const currentVersion = await currentStateVersion(env)
  if (currentVersion !== undefined && currentVersion !== expectedVersion)
    throw new StateVersionConflictError()
}

function applicationSnapshotUpdatedAt(application: WelfareApplication) {
  return application.completedAt
    || application.reviewedAt
    || application.submittedAt
    || application.deliveryRewardedAt
    || application.deliverySubmittedAt
    || application.deliveryClaimedAt
    || application.createdAt
    || now()
}

function couponSnapshotDiscountRate(coupon: UserCoupon) {
  const rate = Number(coupon.discountRate ?? 1)
  return Number.isFinite(rate) ? rate : 1
}

function applicationSnapshotValues(application: WelfareApplication) {
  return [
    application.id,
    application.userId,
    application.type,
    application.status,
    application.title || '未命名申请',
    JSON.stringify(application),
    application.createdAt || now(),
    applicationSnapshotUpdatedAt(application),
  ]
}

function couponSnapshotValues(coupon: UserCoupon) {
  return [
    coupon.id,
    coupon.userId,
    coupon.name || '未命名优惠券',
    coupon.scope ?? null,
    coupon.discountType ?? 'rate',
    couponSnapshotDiscountRate(coupon),
    coupon.discountAmount ?? null,
    JSON.stringify(coupon),
    coupon.createdAt || now(),
    coupon.expiresAt ?? null,
    coupon.usedAt ?? null,
  ]
}

async function runD1Statements(env: WorkerEnv, statements: Array<ReturnType<D1Database['prepare']>>) {
  if (!statements.length)
    return

  const localDb = env.LOCAL_DB! as D1Database & {
    batch?: (items: Array<ReturnType<D1Database['prepare']>>) => Promise<unknown[]>
  }
  if (typeof localDb.batch === 'function') {
    await localDb.batch(statements)
    return
  }

  for (const statement of statements)
    await statement.run()
}

function postgresValuesPlaceholders(rowCount: number, columnCount: number) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const offset = rowIndex * columnCount
    return `(${Array.from({ length: columnCount }, (__, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`
  }).join(', ')
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size))
  return result
}

async function syncD1StateSnapshots(env: WorkerEnv, applications: WelfareApplication[], coupons: UserCoupon[], deletedApplicationIds: string[], deletedCouponIds: string[]) {
  const localDb = env.LOCAL_DB!
  await runD1Statements(env, [
    ...applications.map(application => localDb
      .prepare(`
        insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        on conflict (id)
        do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .bind(...applicationSnapshotValues(application))),
    ...coupons.map(coupon => localDb
      .prepare(`
        insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        on conflict (id)
        do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
      `)
      .bind(...couponSnapshotValues(coupon))),
    ...deletedApplicationIds.map(id => localDb
      .prepare('delete from welfare_applications where id = ?1')
      .bind(id)),
    ...deletedCouponIds.map(id => localDb
      .prepare('delete from user_coupons where id = ?1')
      .bind(id)),
  ])
}

async function syncPostgresStateSnapshots(env: WorkerEnv, applications: WelfareApplication[], coupons: UserCoupon[], deletedApplicationIds: string[], deletedCouponIds: string[]) {
  const pool = getPool(env)
  if (deletedApplicationIds.length)
    await pool.query('delete from welfare_applications where id = any($1)', [deletedApplicationIds])
  if (deletedCouponIds.length)
    await pool.query('delete from user_coupons where id = any($1)', [deletedCouponIds])

  for (const batch of chunks(applications, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
    const values = batch.flatMap(applicationSnapshotValues)
    await pool.query(
      `
        insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
        values ${postgresValuesPlaceholders(batch.length, 8)}
        on conflict (id)
        do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
      `,
      values,
    )
  }
  for (const batch of chunks(coupons, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
    const values = batch.flatMap(couponSnapshotValues)
    await pool.query(
      `
        insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
        values ${postgresValuesPlaceholders(batch.length, 11)}
        on conflict (id)
        do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
      `,
      values,
    )
  }
}

function snapshotItems<T extends { id: string }>(state: unknown, key: 'applications' | 'coupons') {
  return isRecord(state) && Array.isArray(state[key])
    ? state[key].filter((item): item is T => isRecord(item) && typeof item.id === 'string')
    : []
}

function changedSnapshotItems<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return nextItems

  const previousItems = snapshotItems<T>(previousState, key)
  const previousPayloadById = new Map(previousItems.map(item => [item.id, JSON.stringify(item)]))
  return nextItems.filter(item => previousPayloadById.get(item.id) !== JSON.stringify(item))
}

function deletedSnapshotIds<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return []

  const nextIds = new Set(nextItems.map(item => item.id))
  return snapshotItems<T>(previousState, key)
    .filter(item => !nextIds.has(item.id))
    .map(item => item.id)
}

async function syncStateSnapshots(env: WorkerEnv, state: unknown, previousState?: unknown) {
  if (!isRecord(state))
    return

  const allApplications = snapshotItems<WelfareApplication>(state, 'applications')
  const allCoupons = snapshotItems<UserCoupon>(state, 'coupons')
  const applications = previousState === undefined ? allApplications : changedSnapshotItems(previousState, allApplications, 'applications')
  const coupons = previousState === undefined ? allCoupons : changedSnapshotItems(previousState, allCoupons, 'coupons')
  const deletedApplicationIds = previousState === undefined ? [] : deletedSnapshotIds(previousState, allApplications, 'applications')
  const deletedCouponIds = previousState === undefined ? [] : deletedSnapshotIds(previousState, allCoupons, 'coupons')
  if (!applications.length && !coupons.length && !deletedApplicationIds.length && !deletedCouponIds.length)
    return

  if (shouldUseD1(env)) {
    await syncD1StateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds)
    return
  }

  await syncPostgresStateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds)
}

export async function writeWelfareState(env: WorkerEnv, state: unknown, options: WriteWelfareStateOptions = {}) {
  await ensureSchema(env)
  await assertExpectedStateVersion(env, options.expectedVersion)
  await backfillPointTransactionsFromState(env, state)
  const storedState = await encodeStoredState(env, state)
  const nextVersion = options.expectedVersion !== undefined
    ? options.expectedVersion + 1
    : (await currentStateVersion(env) ?? 0) + 1
  const mutationId = createId('mut')

  if (shouldUseD1(env)) {
    if (options.expectedVersion !== undefined) {
      const result = await env.LOCAL_DB!
        .prepare(`
          update welfare_app_state
          set state = ?2, updated_at = current_timestamp, version = ?3, mutation_id = ?5
          where id = ?1 and version = ?4
        `)
        .bind(STATE_KEY, JSON.stringify(storedState), nextVersion, options.expectedVersion, mutationId)
        .run() as { meta?: { changes?: number } }
      if (!result.meta?.changes)
        throw new StateVersionConflictError()
    }
    else {
      await env.LOCAL_DB!
        .prepare(`
          insert into welfare_app_state (id, state, updated_at, version, mutation_id)
          values (?1, ?2, current_timestamp, ?3, ?4)
          on conflict (id)
          do update set state = excluded.state, updated_at = current_timestamp, version = excluded.version, mutation_id = excluded.mutation_id
        `)
        .bind(STATE_KEY, JSON.stringify(storedState), nextVersion, mutationId)
        .run()
    }
    await syncStateSnapshots(env, state, options.previousState)
    return nextVersion
  }

  if (options.expectedVersion !== undefined) {
    const result = await getPool(env).query<{ version: number }>(
      `
        update welfare_app_state
        set state = $2::jsonb, updated_at = now(), version = version + 1, mutation_id = $4
        where id = $1 and version = $3
        returning version
      `,
      [STATE_KEY, JSON.stringify(storedState), options.expectedVersion, mutationId],
    )
    const version = result.rows[0]?.version
    if (!version)
      throw new StateVersionConflictError()
    await syncStateSnapshots(env, state, options.previousState)
    return normalizeStateVersion(version)
  }

  await getPool(env).query(
    `
      insert into welfare_app_state (id, state, updated_at, version, mutation_id)
      values ($1, $2::jsonb, now(), $3, $4)
      on conflict (id)
      do update set state = excluded.state, updated_at = now(), version = excluded.version, mutation_id = excluded.mutation_id
    `,
    [STATE_KEY, JSON.stringify(storedState), nextVersion, mutationId],
  )
  await syncStateSnapshots(env, state, options.previousState)
  return nextVersion
}

function sanitizeTransientStateTransactions(state: unknown) {
  if (isRecord(state) && Array.isArray(state.transactions))
    state.transactions = []
}

export async function writeWelfareStateWithAtomicPointTransactions(
  env: WorkerEnv,
  state: unknown,
  pointTransactions: AtomicPointTransaction[],
  options: { expectedVersion: number, previousState?: unknown },
) {
  await ensureSchema(env)
  await ensurePointTransactionSchema(env)
  await assertExpectedStateVersion(env, options.expectedVersion)
  sanitizeTransientStateTransactions(state)
  const storedState = await encodeStoredState(env, state)
  const storedStateJson = JSON.stringify(storedState)
  const nextVersion = options.expectedVersion + 1
  const mutationId = createId('mut')

  if (shouldUseD1(env)) {
    const localDb = env.LOCAL_DB! as D1Database & {
      batch: (statements: Array<ReturnType<D1Database['prepare']>>) => Promise<Array<{ meta?: { changes?: number } }>>
    }
    const statements = [
      localDb
        .prepare(`
          update welfare_app_state
          set state = ?2, updated_at = current_timestamp, version = ?3, mutation_id = ?5
          where id = ?1 and version = ?4
        `)
        .bind(STATE_KEY, storedStateJson, nextVersion, options.expectedVersion, mutationId),
      ...pointTransactions.map(tx =>
        localDb
          .prepare(`
            insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
            select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
            where exists (select 1 from welfare_app_state where id = ?9 and version = ?10 and mutation_id = ?11)
            on conflict (id) do nothing
          `)
          .bind(tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt, STATE_KEY, nextVersion, mutationId),
      ),
    ]
    const results = await localDb.batch(statements)
    if (!results[0]?.meta?.changes)
      throw new StateVersionConflictError()
    await syncStateSnapshots(env, state, options.previousState)
    return nextVersion
  }

  const client = await getPool(env).connect()
  try {
    await client.query('begin')
    const result = await client.query<{ version: number }>(
      `
        update welfare_app_state
        set state = $2::jsonb, updated_at = now(), version = version + 1, mutation_id = $4
        where id = $1 and version = $3
        returning version
      `,
      [STATE_KEY, storedStateJson, options.expectedVersion, mutationId],
    )
    const version = result.rows[0]?.version
    if (!version) {
      await client.query('rollback')
      throw new StateVersionConflictError()
    }

    for (const tx of pointTransactions) {
      await client.query(`
        insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do nothing
      `, [tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt])
    }

    await client.query('commit')
    await syncStateSnapshots(env, state, options.previousState)
    return normalizeStateVersion(version)
  }
  catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
  finally {
    client.release()
  }
}
