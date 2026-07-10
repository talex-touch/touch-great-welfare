import type { WorkerEnv } from './env'
import type { CreditTransaction, WelfareState } from '~/shared/welfare-types'
import { normalizeApplicationPolicy } from '~/composables/welfare'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { decryptSecret, encryptSecret } from '../crypto'
import { backfillPointTransactionsFromState, ensurePointTransactionSchema, syncUserPointBalancesFromLedger } from '../points'
import { allowUnstableNormalizedReads, getPool, shouldUseD1 } from './connection'
import { isRecord } from './records'
import { ensureSnapshotSchema, syncStateSnapshots } from './state-snapshots'
import { syncStudentVerifiedProfiles } from './verifications'

export {
  readAdminApplicationSnapshots,
  readCurrentUserApplicationSnapshots,
  readCurrentUserCouponSnapshots,
  readSnapshotStateVersion,
  type WelfareSnapshotRecord,
} from './state-snapshots'

const STATE_KEY = 'default'
const INITIAL_STATE_VERSION = 1
const POSTGRES_PERF_LOG_THRESHOLD_MS = 500

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
    await syncStateSnapshots(env, state, nextVersion)
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
    const normalizedVersion = normalizeStateVersion(version)
    await syncStateSnapshots(env, state, normalizedVersion)
    return normalizedVersion
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
  await syncStateSnapshots(env, state, nextVersion)
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
  options: { expectedVersion: number },
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
    await syncStateSnapshots(env, state, nextVersion)
    return nextVersion
  }

  const client = await getPool(env).connect()
  let committedVersion = nextVersion
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
    if (!version)
      throw new StateVersionConflictError()
    committedVersion = normalizeStateVersion(version)

    for (const tx of pointTransactions) {
      await client.query(`
        insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do nothing
      `, [tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt])
    }

    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
  finally {
    client.release()
  }
  await syncStateSnapshots(env, state, committedVersion)
  return committedVersion
}
