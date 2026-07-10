import type { WorkerEnv } from './env'
import { Pool } from 'pg'

const POSTGRES_CONNECTION_TIMEOUT_MS = 15000
const POSTGRES_QUERY_TIMEOUT_MS = 20000
const POSTGRES_POOL_MAX = 20
const POSTGRES_POOL_MIN = 2
const POSTGRES_IDLE_TIMEOUT_MS = 30000

let pool: Pool | undefined
let poolKey = ''

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
}

export function shouldUseD1(env: WorkerEnv) {
  return !!env.LOCAL_DB && !env.HYPERDRIVE
}

export function allowUnstableNormalizedReads(env: WorkerEnv) {
  return env.USE_NORMALIZED_TABLES === 'true'
    && env.ALLOW_UNSTABLE_NORMALIZED_READS === 'true'
    && shouldUseD1(env)
}

export function getPool(env: WorkerEnv) {
  const connectionString = getConnectionString(env)
  if (!connectionString)
    throw new Error('Hyperdrive binding is required')

  if (!pool || poolKey !== connectionString) {
    poolKey = connectionString
    pool = new Pool({
      connectionString,
      max: POSTGRES_POOL_MAX,
      min: POSTGRES_POOL_MIN,
      idleTimeoutMillis: POSTGRES_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POSTGRES_CONNECTION_TIMEOUT_MS,
      query_timeout: POSTGRES_QUERY_TIMEOUT_MS,
      statement_timeout: POSTGRES_QUERY_TIMEOUT_MS,
    })
  }

  return pool
}
