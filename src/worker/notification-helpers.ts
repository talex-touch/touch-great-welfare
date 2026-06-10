/**
 * 通知服务优化 - 直接使用规范化表
 */

import type { WorkerEnv } from './welfare-state'

// 直接从 users 表查询积分
export async function getUserPoints(env: WorkerEnv, userId: string): Promise<number | null> {
  const db = env.LOCAL_DB
  if (!db)
    return null

  const result = await db.prepare(`
    SELECT points FROM users WHERE id = ?
  `).bind(userId).first<{ points: number }>()

  return result?.points ?? null
}

// 检查用户积分是否足够
export async function hasEnoughPoints(env: WorkerEnv, userId: string, required: number): Promise<boolean> {
  const points = await getUserPoints(env, userId)
  return points !== null && points >= required
}
