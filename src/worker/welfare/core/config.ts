/**
 * 配置和常量
 */

export const STATE_KEY = 'default'
export const INITIAL_STATE_VERSION = 1
export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const MASKED_SECRET_MARKER = '****'

// 管理员登录限制
export const ADMIN_LOGIN_MAX_FAILURES = 8
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000
export const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000
export const PASSWORD_PBKDF2_ITERATIONS = 100000

// PostgreSQL 配置
export const POSTGRES_CONNECTION_TIMEOUT_MS = 15000
export const POSTGRES_QUERY_TIMEOUT_MS = 20000
export const POSTGRES_POOL_MAX = 20
export const POSTGRES_POOL_MIN = 2
export const POSTGRES_IDLE_TIMEOUT_MS = 30000
export const POSTGRES_PERF_LOG_THRESHOLD_MS = 500
export const POSTGRES_SNAPSHOT_BATCH_SIZE = 200

// 类型定义
export type PointBalanceSyncMode = false | 'current-user' | 'all'

export interface ReadWelfareStateOptions {
  syncPointBalances?: PointBalanceSyncMode
  currentUserId?: string
}

export interface WelfareStateRecord {
  state: unknown
  version: number
}

export interface WriteWelfareStateOptions {
  expectedVersion?: number
  previousState?: unknown
}

export interface EncryptedWelfareStateEnvelope {
  __encrypted: true
  payload: string
  encryptedAt: string
}

// 全局状态（保留在这里以保持兼容性）
export const adminLoginAttempts = new Map<string, {
  failures: number
  firstFailureAt: number
  lockedUntil: number
}>()
