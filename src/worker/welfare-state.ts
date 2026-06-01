import { Pool } from 'pg'

export interface WorkerEnv {
  LOCAL_DB?: D1Database
  HYPERDRIVE?: {
    connectionString: string
  }
}

const STATE_KEY = 'default'
const MAX_BODY_BYTES = 2 * 1024 * 1024

let pool: Pool | undefined
let poolKey = ''

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
}

function shouldUseD1(env: WorkerEnv) {
  return !!env.LOCAL_DB && !env.HYPERDRIVE
}

function getPool(env: WorkerEnv) {
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

async function readState(env: WorkerEnv) {
  await ensureSchema(env)

  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select state from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ state: string }>()

    return row?.state ? JSON.parse(row.state) : {}
  }

  const result = await getPool(env).query(
    'select state from welfare_app_state where id = $1',
    [STATE_KEY],
  )

  return result.rows[0]?.state ?? {}
}

async function writeState(env: WorkerEnv, state: unknown) {
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
  for (const key of ['users', 'applications', 'studentVerifications', 'transactions']) {
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
      return json({ state: await readState(env) })

    if (request.method === 'PUT') {
      const payload = await readPayload(request)
      assertStateShape(payload.state)
      await writeState(env, payload.state)
      return json({ ok: true })
    }

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
