import { Pool } from 'pg'
import { applyWelfareRetentionPolicy } from '../shared/welfare-retention'
import { decryptSecret, encryptSecret } from './crypto'
import { dispatchWelfareStateChangeNotifications } from './notifications'

export interface WorkerEnv {
  LOCAL_DB?: D1Database
  AI_ASSETS?: R2Bucket
  HYPERDRIVE?: {
    connectionString: string
  }
  NOTIFY_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  WELFARE_STATE_SECRET_KEY?: string
}

const STATE_KEY = 'default'
const MAX_BODY_BYTES = 2 * 1024 * 1024

let pool: Pool | undefined
let poolKey = ''

interface EncryptedWelfareStateEnvelope {
  __encrypted: true
  payload: string
  encryptedAt: string
}

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
}

function stateEncryptionSecret(env: WorkerEnv) {
  return env.WELFARE_STATE_SECRET_KEY?.trim() || env.NOTIFY_SECRET_KEY?.trim() || ''
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

export function shouldUseD1(env: WorkerEnv) {
  return !!env.LOCAL_DB && !env.HYPERDRIVE
}

export function getPool(env: WorkerEnv) {
  const connectionString = getConnectionString(env)
  if (!connectionString)
    throw new Error('Hyperdrive binding is required')

  if (!pool || poolKey !== connectionString) {
    poolKey = connectionString
    pool = new Pool({
      connectionString,
    })
  }

  return pool
}

async function ensureSchema(env: WorkerEnv) {
  if (shouldUseD1(env))
    return

  await getPool(env).query(`
    create table if not exists welfare_app_state (
      id text primary key,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `)
}

export async function readWelfareState(env: WorkerEnv) {
  await ensureSchema(env)

  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select state from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ state: string }>()

    const state = await decodeStoredState(env, row?.state ? JSON.parse(row.state) : {})
    const result = applyWelfareRetentionPolicy(state)
    if (result.changed)
      await writeWelfareState(env, result.state)

    return result.state
  }

  const result = await getPool(env).query(
    'select state from welfare_app_state where id = $1',
    [STATE_KEY],
  )

  const state = await decodeStoredState(env, result.rows[0]?.state ?? {})
  const retentionResult = applyWelfareRetentionPolicy(state)
  if (retentionResult.changed)
    await writeWelfareState(env, retentionResult.state)

  return retentionResult.state
}

export async function writeWelfareState(env: WorkerEnv, state: unknown) {
  await ensureSchema(env)
  const storedState = await encodeStoredState(env, state)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into welfare_app_state (id, state, updated_at)
        values (?1, ?2, current_timestamp)
        on conflict (id)
        do update set state = excluded.state, updated_at = current_timestamp
      `)
      .bind(STATE_KEY, JSON.stringify(storedState))
      .run()
    return
  }

  await getPool(env).query(
    `
      insert into welfare_app_state (id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set state = excluded.state, updated_at = now()
    `,
    [STATE_KEY, JSON.stringify(storedState)],
  )
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })
}

function errorResponse(error: unknown) {
  return json({
    error: error instanceof Error ? error.message : '服务端错误',
  }, 500)
}

function assertStateShape(state: unknown): asserts state is Record<string, unknown> {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('state must be an object')

  const record = state as Record<string, unknown>
  for (const key of ['users', 'applications', 'studentVerifications', 'educationEmailChallenges', 'crowdReviews', 'transactions']) {
    if (record[key] !== undefined && !Array.isArray(record[key]))
      throw new Error(`${key} must be an array`)
  }

  if (record.oauth !== undefined && (!record.oauth || typeof record.oauth !== 'object' || Array.isArray(record.oauth)))
    throw new Error('oauth must be an object')
}

async function readPayload(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as { state?: unknown }
}

export async function handleWelfareStateRequest(request: Request, env: WorkerEnv) {
  try {
    if (request.method === 'GET')
      return json({ state: await readWelfareState(env) })

    if (request.method === 'PUT') {
      const previousState = await readWelfareState(env)
      const payload = await readPayload(request)
      assertStateShape(payload.state)
      const nextState = applyWelfareRetentionPolicy(payload.state).state
      await writeWelfareState(env, nextState)
      await dispatchWelfareStateChangeNotifications(env, previousState, nextState)
      return json({ ok: true })
    }

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
