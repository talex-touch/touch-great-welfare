/**
 * 用户操作重构示例 - 使用 Repository 模式
 *
 * 这个文件展示如何将现有的直接操作 state 的代码
 * 重构为使用 Repository 的代码
 */

import type { WorkerEnv, User, UserProfile } from '~/composables/welfare'
import { getPool } from '../database/connection'
import { createRepositories } from '../repository'
import { readWelfareStateRecord, writeWelfareState } from '../database/state-io'

/**
 * 更新用户资料（重构后）
 */
export async function updateCurrentProfileAction(
  request: Request,
  env: WorkerEnv,
) {
  // 1. 读取当前 state
  const stateRecord = await readWelfareStateRecord(env)
  const state = stateRecord.state as any

  // 2. 获取当前用户
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  // 3. 创建 Repository
  const pool = getPool(env)
  const repos = createRepositories(env, pool)

  // 4. 使用 Repository 读取用户（支持灰度）
  const user = await repos.users.read(state, userId, userId)
  if (!user)
    throw new Error('用户不存在')

  // 5. 解析请求
  const payload = await request.json() as { profile: Partial<UserProfile> }
  const { profile } = payload

  // 6. 更新用户对象
  const updatedUser: User = {
    ...user,
    profile: {
      ...user.profile,
      ...profile,
      displayName: profile.displayName?.trim() || user.profile.displayName,
      bio: profile.bio?.trim() || user.profile.bio,
      avatar: profile.avatar?.trim() || user.profile.avatar,
    },
  }

  // 7. 使用 Repository 写入（自动双写）
  await repos.users.write(state, updatedUser)

  // 8. 保存 state（向后兼容）
  await writeWelfareState(env, state, {
    expectedVersion: stateRecord.version,
    previousState: stateRecord.state,
  })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 对比：原始实现 vs Repository 实现
 */

// ❌ 原始实现（直接操作 state）
async function updateProfileOldWay(request: Request, env: WorkerEnv) {
  const stateRecord = await readWelfareStateRecord(env)
  const state = stateRecord.state as any
  const userId = await requestUserId(request, env)

  // 直接修改 state.users 数组
  const userIndex = state.users.findIndex((u: User) => u.id === userId)
  if (userIndex < 0)
    throw new Error('用户不存在')

  const payload = await request.json() as { profile: Partial<UserProfile> }

  // ⚠️ 只更新 JSONB，表数据不同步
  state.users[userIndex].profile = {
    ...state.users[userIndex].profile,
    ...payload.profile,
  }

  await writeWelfareState(env, state, {
    expectedVersion: stateRecord.version,
  })

  return new Response(JSON.stringify({ ok: true }))
}

// ✅ Repository 实现（自动双写）
async function updateProfileNewWay(request: Request, env: WorkerEnv) {
  const stateRecord = await readWelfareStateRecord(env)
  const state = stateRecord.state as any
  const userId = await requestUserId(request, env)

  const pool = getPool(env)
  const repos = createRepositories(env, pool)

  // Repository 读取（支持灰度）
  const user = await repos.users.read(state, userId, userId)
  if (!user)
    throw new Error('用户不存在')

  const payload = await request.json() as { profile: Partial<UserProfile> }

  const updatedUser = {
    ...user,
    profile: { ...user.profile, ...payload.profile },
  }

  // ✅ Repository 写入（自动双写到 state + table）
  await repos.users.write(state, updatedUser)

  await writeWelfareState(env, state, {
    expectedVersion: stateRecord.version,
  })

  return new Response(JSON.stringify({ ok: true }))
}

/**
 * 管理员调整用户积分（重构后）
 */
export async function adjustUserPointsAction(
  request: Request,
  env: WorkerEnv,
) {
  const stateRecord = await readWelfareStateRecord(env)
  const state = stateRecord.state as any

  const adminUserId = await requestUserId(request, env)
  if (!isAdminUser(state, adminUserId))
    throw new Error('权限不足')

  const payload = await request.json() as {
    userId: string
    amount: number
    reason: string
  }

  const pool = getPool(env)
  const repos = createRepositories(env, pool)

  // 使用 Repository 读取目标用户
  const targetUser = await repos.users.read(state, payload.userId)
  if (!targetUser)
    throw new Error('目标用户不存在')

  // 创建积分交易记录
  const transaction = {
    id: createId('credit'),
    userId: targetUser.id,
    delta: payload.amount,
    type: 'admin_adjustment',
    reason: payload.reason,
    balanceAfter: targetUser.points + payload.amount,
    createdAt: new Date().toISOString(),
  }

  // 保存交易到 point_transactions 表
  await pool.query(
    `INSERT INTO point_transactions (id, user_id, delta, type, reason, balance_after, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      transaction.id,
      transaction.userId,
      transaction.delta,
      transaction.type,
      transaction.reason,
      transaction.balanceAfter,
      transaction.createdAt,
    ],
  )

  // 更新用户积分
  const updatedUser = {
    ...targetUser,
    points: transaction.balanceAfter,
  }

  // 使用 Repository 写入
  await repos.users.write(state, updatedUser)

  await writeWelfareState(env, state, {
    expectedVersion: stateRecord.version,
  })

  return new Response(JSON.stringify({ ok: true }))
}

/**
 * 查询用户申请列表（重构后）
 */
export async function getUserApplicationsAction(
  request: Request,
  env: WorkerEnv,
) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const pool = getPool(env)
  const repos = createRepositories(env, pool)

  // ✅ 如果启用了表读取，直接从表查询（高效）
  const config = getMigrationConfig()
  if (config.readMode.source === 'table' || shouldReadFromTable(userId)) {
    // 从表查询（使用索引，快速）
    const applications = await repos.applications.findByUserId(userId, 100)

    return new Response(JSON.stringify({
      ok: true,
      applications: applications.map(sanitizeOwnedApplication),
    }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  // ⚠️ 否则从 state 读取（兼容旧模式）
  const stateRecord = await readWelfareStateRecord(env)
  const state = stateRecord.state as any

  const applications = (state.applications || [])
    .filter((app: any) => app.userId === userId)
    .sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 100)

  return new Response(JSON.stringify({
    ok: true,
    applications: applications.map(sanitizeOwnedApplication),
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

// 辅助函数（从 core.ts 导入）
async function requestUserId(request: Request, env: WorkerEnv): Promise<string | null> {
  // 实现省略...
  return null
}

function isAdminUser(state: any, userId: string): boolean {
  const user = state.users?.find((u: User) => u.id === userId)
  return user?.role === 'admin'
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function sanitizeOwnedApplication(app: any): any {
  // 实现省略...
  return app
}

function getMigrationConfig() {
  // 从 repository/base.ts 导入
  return { readMode: { source: 'state' } }
}

function shouldReadFromTable(userId: string): boolean {
  // 从 repository/base.ts 导入
  return false
}
