/**
 * UserRepository - 用户数据访问层
 */

import type { User } from '~/composables/welfare'
import { BaseRepository } from './base'

export class UserRepository extends BaseRepository<User> {
  // 从 JSONB state 读取用户
  readFromState(state: any, userId: string): User | null {
    if (!Array.isArray(state.users))
      return null

    return state.users.find((u: User) => u.id === userId) || null
  }

  // 写入 JSONB state
  writeToState(state: any, user: User): void {
    if (!Array.isArray(state.users))
      state.users = []

    const index = state.users.findIndex((u: User) => u.id === user.id)
    if (index >= 0) {
      state.users[index] = user
    }
    else {
      state.users.push(user)
    }
  }

  // 从规范化表读取用户
  async readFromTable(userId: string): Promise<User | null> {
    const result = await this.pool.query<{
      id: string
      email: string
      password_hash: string | null
      display_name: string
      avatar: string | null
      bio: string | null
      role: string
      account_status: string
      points: number
      github_username: string | null
      github_authorized: boolean
      selected_repo: string | null
      student_verified: boolean
      student_verified_at: string | null
      invitation_code: string | null
      invited_by_user_id: string | null
      created_at: string
      last_login_at: string | null
    }>(
      `SELECT * FROM users WHERE id = $1`,
      [userId],
    )

    if (!result.rows[0])
      return null

    const row = result.rows[0]

    // 转换为 User 对象
    return {
      id: row.id,
      passwordHash: row.password_hash || undefined,
      role: row.role as any,
      accountStatus: row.account_status as any,
      points: row.points,
      profile: {
        displayName: row.display_name,
        avatar: row.avatar || undefined,
        bio: row.bio || undefined,
        email: row.email,
        githubUsername: row.github_username || undefined,
        githubAuthorized: row.github_authorized,
        selectedRepo: row.selected_repo || undefined,
        studentVerified: row.student_verified,
        inviteCode: row.invitation_code || undefined,
      },
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at || row.created_at,
    }
  }

  // 写入规范化表
  async writeToTable(user: User): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (
        id, email, password_hash, display_name, avatar, bio,
        role, account_status, points,
        github_username, github_authorized, selected_repo,
        student_verified, student_verified_at,
        invitation_code, invited_by_user_id,
        created_at, last_login_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14,
        $15, $16,
        $17, $18
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        avatar = EXCLUDED.avatar,
        bio = EXCLUDED.bio,
        role = EXCLUDED.role,
        account_status = EXCLUDED.account_status,
        points = EXCLUDED.points,
        github_username = EXCLUDED.github_username,
        github_authorized = EXCLUDED.github_authorized,
        selected_repo = EXCLUDED.selected_repo,
        student_verified = EXCLUDED.student_verified,
        student_verified_at = EXCLUDED.student_verified_at,
        invitation_code = EXCLUDED.invitation_code,
        invited_by_user_id = EXCLUDED.invited_by_user_id,
        last_login_at = EXCLUDED.last_login_at,
        updated_at = NOW()
      `,
      [
        user.id,
        user.profile.email,
        user.passwordHash || null,
        user.profile.displayName,
        user.profile.avatar || null,
        user.profile.bio || null,
        user.role,
        user.accountStatus,
        user.points,
        user.profile.githubUsername || null,
        user.profile.githubAuthorized || false,
        user.profile.selectedRepo || null,
        user.profile.studentVerified || false,
        null,
        user.profile.inviteCode || null,
        null,
        user.createdAt,
        user.lastLoginAt || null,
      ],
    )
  }

  // 批量读取（优化：减少数据库往返）
  async readManyFromTable(userIds: string[]): Promise<Map<string, User>> {
    if (userIds.length === 0)
      return new Map()

    const result = await this.pool.query(
      `SELECT * FROM users WHERE id = ANY($1)`,
      [userIds],
    )

    const userMap = new Map<string, User>()
    for (const row of result.rows) {
      const user = await this.readFromTable(row.id)
      if (user)
        userMap.set(row.id, user)
    }

    return userMap
  }

  // 查询：根据邮箱查找用户
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    )

    if (!result.rows[0])
      return null

    return this.readFromTable(result.rows[0].id)
  }

  // 查询：根据邀请码查找用户
  async findByInvitationCode(code: string): Promise<User | null> {
    const result = await this.pool.query(
      `SELECT id FROM users WHERE invitation_code = $1`,
      [code],
    )

    if (!result.rows[0])
      return null

    return this.readFromTable(result.rows[0].id)
  }
}
