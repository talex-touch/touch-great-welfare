// 临时数据迁移端点
// 访问 /admin/migrate-now 执行迁移

import type { WorkerEnv } from '../composables/welfare'

export async function handleMigrateNow(env: WorkerEnv) {
  const db = env.LOCAL_DB

  try {
    // 1. 读取 JSONB state
    const result = await db.prepare(
      'SELECT state FROM welfare_app_state WHERE id = ?'
    ).bind('default').first()

    if (!result || !result.state) {
      return new Response(JSON.stringify({
        error: 'No state found'
      }), { status: 404 })
    }

    const state = JSON.parse(result.state as string)

    const stats = {
      users: 0,
      applications: 0,
      pointTransactions: 0,
      studentVerifications: 0,
      errors: [] as string[],
    }

    // 2. 迁移用户
    if (Array.isArray(state.users)) {
      for (const user of state.users) {
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
            user.email,
            user.passwordHash || null,
            user.profile?.displayName || user.email,
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
            user.invitationCode || null,
            user.invitedByUserId || null,
            user.createdAt || new Date().toISOString(),
            user.lastLoginAt || null
          ).run()

          stats.users++
        } catch (error) {
          stats.errors.push(`User ${user.id}: ${error}`)
        }
      }
    }

    // 3. 迁移申请
    if (Array.isArray(state.applications)) {
      for (const app of state.applications) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO applications (
              id, user_id, type, status, title, description,
              base_cost, cost, cost_charged, cost_charged_at,
              created_at, updated_at, submitted_at, reviewed_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            app.id,
            app.userId,
            app.type,
            app.status,
            app.title,
            app.description || null,
            app.baseCost || 0,
            app.cost || 0,
            app.costCharged ? 1 : 0,
            app.costChargedAt || null,
            app.createdAt || new Date().toISOString(),
            app.updatedAt || new Date().toISOString(),
            app.submittedAt || null,
            app.reviewedAt || null,
            app.completedAt || null
          ).run()

          stats.applications++
        } catch (error) {
          stats.errors.push(`Application ${app.id}: ${error}`)
        }
      }
    }

    // 4. 迁移积分交易
    if (Array.isArray(state.pointTransactions)) {
      for (const tx of state.pointTransactions) {
        try {
          await db.prepare(`
            INSERT OR REPLACE INTO point_transactions (
              id, user_id, amount, balance_after, type, reason,
              application_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            tx.id,
            tx.userId,
            tx.amount,
            tx.balanceAfter,
            tx.type,
            tx.reason || null,
            tx.applicationId || null,
            tx.createdAt || new Date().toISOString()
          ).run()

          stats.pointTransactions++
        } catch (error) {
          stats.errors.push(`Transaction ${tx.id}: ${error}`)
        }
      }
    }

    // 5. 迁移学生认证
    if (Array.isArray(state.studentVerifications)) {
      for (const sv of state.studentVerifications) {
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

          stats.studentVerifications++
        } catch (error) {
          stats.errors.push(`StudentVerification ${sv.id}: ${error}`)
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    }, null, 2), {
      headers: { 'content-type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
}
