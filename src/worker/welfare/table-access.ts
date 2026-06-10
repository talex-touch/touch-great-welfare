/**
 * 简化的用户数据访问 - 直接使用 D1
 */

import type { WorkerEnv } from './core'
import type { User } from '~/composables/welfare'

export async function getUserFromTable(env: WorkerEnv, userId: string): Promise<User | null> {
  const db = env.LOCAL_DB
  if (!db)
    return null

  const result = await db.prepare(`
    SELECT * FROM users WHERE id = ?
  `).bind(userId).first()

  if (!result)
    return null

  const row = result as any

  return {
    id: row.id,
    passwordHash: row.password_hash || undefined,
    role: row.role,
    accountStatus: row.account_status,
    points: row.points,
    profile: {
      displayName: row.display_name,
      avatar: row.avatar || undefined,
      bio: row.bio || undefined,
      email: row.email,
      githubUsername: row.github_username || undefined,
      githubAuthorized: row.github_authorized === 1,
      selectedRepo: row.selected_repo || undefined,
      studentVerified: row.student_verified === 1,
      inviteCode: row.invitation_code || undefined,
    },
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || undefined,
  }
}

export async function getAllUsersFromTable(env: WorkerEnv): Promise<User[]> {
  const db = env.LOCAL_DB
  if (!db)
    return []

  const result = await db.prepare(`
    SELECT * FROM users ORDER BY created_at DESC
  `).all()

  if (!result.results)
    return []

  return result.results.map((row: any) => ({
    id: row.id,
    passwordHash: row.password_hash || undefined,
    role: row.role,
    accountStatus: row.account_status,
    points: row.points,
    profile: {
      displayName: row.display_name,
      avatar: row.avatar || undefined,
      bio: row.bio || undefined,
      email: row.email,
      githubUsername: row.github_username || undefined,
      githubAuthorized: row.github_authorized === 1,
      selectedRepo: row.selected_repo || undefined,
      studentVerified: row.student_verified === 1,
      inviteCode: row.invitation_code || undefined,
    },
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || undefined,
  }))
}
