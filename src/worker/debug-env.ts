// 调试端点 - 检查环境变量
import type { WorkerEnv } from './welfare-state'

export async function handleDebugEnv(env: WorkerEnv) {
  return new Response(JSON.stringify({
    USE_NORMALIZED_TABLES: env.USE_NORMALIZED_TABLES || 'not set',
    hasD1: !!env.LOCAL_DB,
  }, null, 2), {
    headers: { 'content-type': 'application/json' },
  })
}
