import { Pool } from 'pg'
import { applyWelfareRetentionPolicy } from '../shared/welfare-retention'
import { dispatchWelfareStateChangeNotifications } from './notifications'

export interface WorkerEnv {
  LOCAL_DB?: D1Database
  AI_ASSETS?: R2Bucket
  HYPERDRIVE?: {
    connectionString: string
  }
  LDC_GATEWAY_BASE_URL?: string
  LDC_PID?: string
  LDC_KEY?: string
  LDC_PAYMENT_ENABLED?: string
  AI_PROVIDER_ENABLED?: string
  AI_PROVIDER_BASE_URL?: string
  AI_IMAGE_MODEL?: string
  AI_REVIEW_MODEL?: string
  OPENAI_API_KEY?: string
  NEWAPI_API_KEY?: string
  NEWAPI_MANAGEMENT_BASE_URL?: string
  NEWAPI_USER_ID?: string
  NEWAPI_TEMP_KEY_TTL_MINUTES?: string
  NEWAPI_TEMP_KEY_QUOTA?: string
  GITHUB_APP_ENABLED?: string
  GITHUB_APP_NAME?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_CLIENT_ID?: string
  GITHUB_APP_CLIENT_SECRET?: string
  GITHUB_APP_CALLBACK_URL?: string
  GITHUB_APP_AUTHORIZE_URL?: string
  GITHUB_APP_TOKEN_URL?: string
  GITHUB_APP_API_BASE_URL?: string
  GITHUB_APP_SCOPES?: string
  NOTIFY_SECRET_KEY?: string
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

const STATE_KEY = 'default'
const MAX_BODY_BYTES = 2 * 1024 * 1024

let pool: Pool | undefined
let poolKey = ''

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
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

    const state = row?.state ? JSON.parse(row.state) : {}
    const result = applyWelfareRetentionPolicy(state)
    if (result.changed)
      await writeWelfareState(env, result.state)

    return result.state
  }

  const result = await getPool(env).query(
    'select state from welfare_app_state where id = $1',
    [STATE_KEY],
  )

  const state = result.rows[0]?.state ?? {}
  const retentionResult = applyWelfareRetentionPolicy(state)
  if (retentionResult.changed)
    await writeWelfareState(env, retentionResult.state)

  return retentionResult.state
}

export async function writeWelfareState(env: WorkerEnv, state: unknown) {
  await ensureSchema(env)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into welfare_app_state (id, state, updated_at)
        values (?1, ?2, current_timestamp)
        on conflict (id)
        do update set state = excluded.state, updated_at = current_timestamp
      `)
      .bind(STATE_KEY, JSON.stringify(state))
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
    [STATE_KEY, JSON.stringify(state)],
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
  for (const key of ['users', 'applications', 'studentVerifications', 'crowdReviews', 'transactions']) {
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
