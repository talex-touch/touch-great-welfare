/**
 * 数据库连接管理
 */

import { Pool } from 'pg'
import type { D1Database } from '@cloudflare/workers-types'
import type { WorkerEnv } from '~/composables/welfare'
import {
  POSTGRES_CONNECTION_TIMEOUT_MS,
  POSTGRES_QUERY_TIMEOUT_MS,
  POSTGRES_POOL_MAX,
  POSTGRES_POOL_MIN,
  POSTGRES_IDLE_TIMEOUT_MS,
} from '../config'

let pool: Pool | undefined
let poolKey = ''
let postgresSchemaKey = ''
let postgresSchemaPromise: Promise<void> | undefined
const d1SchemaPromises = new WeakMap<D1Database, Promise<void>>()

export function getConnectionString(env: WorkerEnv) {
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

// 导出内部状态供 schema.ts 使用
export function getSchemaPromises() {
  return {
    postgresSchemaKey,
    postgresSchemaPromise,
    d1SchemaPromises,
    setPostgresSchema: (key: string, promise: Promise<void>) => {
      postgresSchemaKey = key
      postgresSchemaPromise = promise
    },
    clearPostgresSchema: () => {
      postgresSchemaPromise = undefined
    },
  }
}
