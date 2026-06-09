// 批量数据迁移脚本
// 分批处理，避免超时

import type { WorkerEnv } from '../composables/welfare'
import { readWelfareState } from './welfare/core'

interface MigrationProgress {
  usersOffset: number
  applicationsOffset: number
  studentVerificationsOffset: number
}

export async function handleBatchMigration(env: WorkerEnv, request: Request) {
  const db = env.LOCAL_DB

  if (!db) {
    return new Response(JSON.stringify({
      success: false,
      error: 'D1 database not available'
    }), { status: 500 })
  }

  const url = new URL(request.url)
  const batchSize = parseInt(url.searchParams.get('batchSize') || '50')
  const usersOffset = parseInt(url.searchParams.get('usersOffset') || '0')
  const applicationsOffset = parseInt(url.searchParams.get('applicationsOffset') || '0')
  const studentVerificationsOffset = parseInt(url.searchParams.get('studentVerificationsOffset') || '0')

  try {
    // 读取并解密 state
    const state = await readWelfareState(env)

    const stats = {
      users: { processed: 0, success: 0, errors: [] as string[], hasMore: false },
      applications: { processed: 0, success: 0, errors: [] as string[], hasMore: false },
      studentVerifications: { processed: 0, success: 0, errors: [] as string[], hasMore: false },
    }

    // 1. 迁移用户（批量）
    if (Array.isArray(state.users) && usersOffset < state.users.length) {
      const usersBatch = state.users.slice(usersOffset, usersOffset + batchSize)
      stats.users.hasMore = (usersOffset + batchSize) < state.users.length

      for (const user of usersBatch) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO users (
              id, email, password_hash, display_name, avatar, bio,
              role, account_status, points, github_username,
              github_authorized, selected_repo, student_verified,
              student_verified_at, invitation_code, invited_by_user_id,
              created_at, last_login_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            user.id,
            user.profile?.email || user.email || `${user.id}@unknown.local`,
            user.passwordHash || null,
            user.profile?.displayName || user.profile?.email || user.email || user.id,
            user.profile?.avatar || null,
            user.profile?.bio || null,
            user.role || 'user',
            user.accountStatus || 'active',
            user.points || 0,
            user.profile?.githubUsername || null,
            user.profile?.githubAuthorized ? 1 : 0,
            user.profile?.selectedRepo || null,
            user.profile?.studentVerified ? 1 : 0,
            user.profile?.studentVerifiedAt || null,
            user.profile?.inviteCode || null,
            user.invitedByUserId || null,
            user.createdAt || new Date().toISOString(),
            user.lastLoginAt || null
          ).run()

          stats.users.success++
        } catch (error) {
          stats.users.errors.push(`User ${user.id}: ${error}`)
        }
        stats.users.processed++
      }
    }

    // 2. 迁移申请（批量）
    if (Array.isArray(state.applications) && applicationsOffset < state.applications.length) {
      const applicationsBatch = state.applications.slice(applicationsOffset, applicationsOffset + batchSize)
      stats.applications.hasMore = (applicationsOffset + batchSize) < state.applications.length

      for (const app of applicationsBatch) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO applications (
              id, user_id, type, status, title, description,
              base_cost, cost, cost_charged, cost_charged_at,
              created_at, updated_at, submitted_at, reviewed_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            app.id,
            app.userId || app.ownerId,
            app.type,
            app.status,
            app.title,
            app.description || null,
            app.baseCost || 0,
            app.cost || 0,
            app.costCharged ? 1 : 0,
            app.costChargedAt || app.submittedAt || null,
            app.createdAt || new Date().toISOString(),
            app.updatedAt || app.createdAt || new Date().toISOString(),
            app.submittedAt || null,
            app.reviewedAt || null,
            app.completedAt || null
          ).run()

          stats.applications.success++
        } catch (error) {
          stats.applications.errors.push(`Application ${app.id}: ${error}`)
        }
        stats.applications.processed++
      }
    }

    // 3. 迁移学生认证（批量）
    if (Array.isArray(state.studentVerifications) && studentVerificationsOffset < state.studentVerifications.length) {
      const svBatch = state.studentVerifications.slice(studentVerificationsOffset, studentVerificationsOffset + batchSize)
      stats.studentVerifications.hasMore = (studentVerificationsOffset + batchSize) < state.studentVerifications.length

      for (const sv of svBatch) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO student_verifications (
              id, user_id, education_email, verification_status,
              code_sent, code_expires_at, verified_at, verification_source,
              balance, last_awarded_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            sv.id,
            sv.userId,
            sv.educationEmail,
            sv.verificationStatus || 'pending',
            sv.codeSent || null,
            sv.codeExpiresAt || null,
            sv.verifiedAt || null,
            sv.verificationSource || null,
            sv.balance || 0,
            sv.lastAwardedAt || null,
            sv.createdAt || new Date().toISOString()
          ).run()

          stats.studentVerifications.success++
        } catch (error) {
          stats.studentVerifications.errors.push(`StudentVerification ${sv.id}: ${error}`)
        }
        stats.studentVerifications.processed++
      }
    }

    const nextBatch = {
      usersOffset: stats.users.hasMore ? usersOffset + batchSize : usersOffset,
      applicationsOffset: stats.applications.hasMore ? applicationsOffset + batchSize : applicationsOffset,
      studentVerificationsOffset: stats.studentVerifications.hasMore ? studentVerificationsOffset + batchSize : studentVerificationsOffset,
    }

    const allDone = !stats.users.hasMore && !stats.applications.hasMore && !stats.studentVerifications.hasMore

    return new Response(JSON.stringify({
      success: true,
      stats,
      nextBatch,
      allDone,
      progress: {
        users: `${usersOffset + stats.users.processed}/${state.users?.length || 0}`,
        applications: `${applicationsOffset + stats.applications.processed}/${state.applications?.length || 0}`,
        studentVerifications: `${studentVerificationsOffset + stats.studentVerifications.processed}/${state.studentVerifications?.length || 0}`,
      },
      timestamp: new Date().toISOString(),
    }, null, 2), {
      headers: { 'content-type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
}
