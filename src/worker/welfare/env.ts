export interface WorkerEnv {
  LOCAL_DB?: D1Database
  AI_ASSETS?: R2Bucket
  HYPERDRIVE?: {
    connectionString: string
  }
  NOTIFY_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  WELFARE_STATE_SECRET_KEY?: string
  WEBHOOK_SECRET?: string
  ASYNC_JOBS?: Queue<unknown>
  USE_NORMALIZED_TABLES?: string
  ALLOW_UNSTABLE_NORMALIZED_READS?: string
  ENABLE_TEMP_ADMIN_ENDPOINTS?: string
  ENABLE_LEGACY_STATE_WRITE?: string
}
