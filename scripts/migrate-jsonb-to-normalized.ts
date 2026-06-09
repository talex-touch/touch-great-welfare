/**
 * 数据迁移脚本：JSONB state → 规范化表
 *
 * 使用方法:
 *   pnpm tsx scripts/migrate-jsonb-to-normalized.ts --dry-run
 *   pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute
 *
 * 环境变量:
 *   DATABASE_URL - PostgreSQL 连接字符串
 */

import { Pool } from 'pg'
import * as process from 'node:process'

const DATABASE_URL = process.env.DATABASE_URL || process.env.HYPERDRIVE_URL
if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })
const isDryRun = process.argv.includes('--dry-run')

interface MigrationStats {
  users: number
  applications: number
  applicationAttachments: number
  applicationMessages: number
  applicationItems: number
  studentVerifications: number
  dailyCheckIns: number
  invitationBindings: number
  squarePosts: number
  squareBoosts: number
  collaborationApplications: number
  errors: Array<{ table: string, id: string, error: string }>
}

const stats: MigrationStats = {
  users: 0,
  applications: 0,
  applicationAttachments: 0,
  applicationMessages: 0,
  applicationItems: 0,
  studentVerifications: 0,
  dailyCheckIns: 0,
  invitationBindings: 0,
  squarePosts: 0,
  squareBoosts: 0,
  collaborationApplications: 0,
  errors: [],
}

async function main() {
  console.log(`🚀 Starting migration (${isDryRun ? 'DRY RUN' : 'EXECUTE'})...\n`)

  // 1. 读取 JSONB state
  console.log('📖 Reading JSONB state...')
  const stateRow = await pool.query(
    `SELECT state FROM welfare_app_state WHERE id = 'default'`
  )

  if (!stateRow.rows[0]) {
    console.error('❌ No state found!')
    process.exit(1)
  }

  const state = stateRow.rows[0].state as any
  const stateSize = JSON.stringify(state).length
  console.log(`✅ State loaded (${(stateSize / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`   Users: ${state.users?.length || 0}`)
  console.log(`   Applications: ${state.applications?.length || 0}`)
  console.log(`   Student Verifications: ${state.studentVerifications?.length || 0}`)
  console.log()

  if (isDryRun) {
    await pool.query('BEGIN')
    console.log('🔄 Starting DRY RUN (changes will be rolled back)\n')
  } else {
    console.log('⚠️  EXECUTING REAL MIGRATION (changes will be committed)\n')
    await pool.query('BEGIN')
  }

  try {
    // 2. 迁移 users
    await migrateUsers(state.users || [])

    // 3. 迁移 applications（及其子表）
    await migrateApplications(state.applications || [])

    // 4. 迁移 student_verifications
    await migrateStudentVerifications(state.studentVerifications || [])

    // 5. 迁移 daily_check_ins
    await migrateDailyCheckIns(state.dailyCheckIns || [])

    // 6. 迁移 invitation_bindings
    await migrateInvitationBindings(state.invitationBindings || [])

    // 7. 迁移 square_posts
    await migrateSquarePosts(state.squarePosts || [])

    // 8. 迁移 square_boosts
    await migrateSquareBoosts(state.squareBoosts || [])

    // 9. 迁移 collaboration_applications
    await migrateCollaborationApplications(state.collaborationApplications || [])

    if (isDryRun) {
      await pool.query('ROLLBACK')
      console.log('\n🔄 Dry run complete - changes rolled back')
    } else {
      await pool.query('COMMIT')
      console.log('\n✅ Migration complete - changes committed')
    }

    printStats()
  } catch (error) {
    await pool.query('ROLLBACK')
    console.error('\n❌ Migration failed:', error)
    printStats()
    process.exit(1)
  } finally {
    await pool.end()
  }
}

async function migrateUsers(users: any[]) {
  console.log(`\n👥 Migrating ${users.length} users...`)

  for (const user of users) {
    try {
      await pool.query(`
        INSERT INTO users (
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
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          updated_at = NOW()
      `, [
        user.id,
        user.email || user.profile?.email,
        user.passwordHash,
        user.profile?.displayName || 'Unnamed User',
        user.profile?.avatar,
        user.profile?.bio,
        user.role || 'user',
        user.accountStatus || 'active',
        0,  // points 从 point_transactions 计算，这里先设为 0
        user.profile?.githubUsername,
        user.profile?.githubAuthorized || false,
        user.profile?.selectedRepo,
        user.profile?.studentVerified || false,
        user.profile?.studentVerifiedAt,
        user.invitationCode,
        user.invitedByUserId,
        user.createdAt || new Date().toISOString(),
        user.lastLoginAt,
      ])

      stats.users++
    } catch (error) {
      stats.errors.push({
        table: 'users',
        id: user.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate user ${user.id}:`, error)
    }
  }

  console.log(`  ✅ Migrated ${stats.users} users`)

  // 同步积分
  if (stats.users > 0) {
    console.log(`  🔄 Syncing user points from point_transactions...`)
    await pool.query(`
      UPDATE users
      SET points = COALESCE((
        SELECT SUM(amount)
        FROM point_transactions
        WHERE user_id = users.id
      ), 0),
      points_updated_at = NOW()
    `)
    console.log(`  ✅ User points synced`)
  }
}

// 继续在下一个文件块...

async function migrateApplications(applications: any[]) {
  console.log(`\n📝 Migrating ${applications.length} applications...`)

  for (const app of applications) {
    try {
      // 迁移主表
      await pool.query(`
        INSERT INTO applications (
          id, user_id, type, status, title, description,
          base_cost, cost, cost_charged,
          github_repo, has_open_source_badge,
          storage_extended, retention_expires_at,
          ai_review_status, ai_review_summary, ai_reviewed_at,
          reviewed_at, reviewer_user_id,
          rejection_reason, rejection_review_fee,
          answer, completed_at,
          delivery_assignee_id, delivery_claimed_at,
          created_at, submitted_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11,
          $12, $13,
          $14, $15, $16,
          $17, $18,
          $19, $20,
          $21, $22,
          $23, $24,
          $25, $26, $27
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        app.id,
        app.userId,
        app.type,
        app.status,
        app.title,
        app.description,
        app.baseCost || 0,
        app.cost || 0,
        app.costCharged || false,
        app.githubRepo,
        app.hasOpenSourceBadge || false,
        app.storageExtended || false,
        app.retentionExpiresAt,
        app.aiReviewStatus,
        app.aiReviewSummary,
        app.aiReviewedAt,
        app.reviewedAt,
        app.reviewerUserId,
        app.rejectionReason,
        app.rejectionReviewFee || 0,
        app.answer,
        app.completedAt,
        app.deliveryAssigneeId,
        app.deliveryClaimedAt,
        app.createdAt || new Date().toISOString(),
        app.submittedAt,
        app.updatedAt || app.createdAt || new Date().toISOString(),
      ])

      stats.applications++

      // 迁移附件
      if (app.attachments?.length) {
        for (const attachment of app.attachments) {
          await pool.query(`
            INSERT INTO application_attachments (
              id, application_id, file_name, file_size, mime_type, storage_key
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            attachment.id || `${app.id}_att_${Date.now()}_${Math.random()}`,
            app.id,
            attachment.name,
            attachment.size,
            attachment.type,
            attachment.storageKey || attachment.url,
          ])
          stats.applicationAttachments++
        }
      }

      // 迁移消息
      if (app.messages?.length) {
        for (const message of app.messages) {
          await pool.query(`
            INSERT INTO application_messages (
              id, application_id, sender_user_id, type, content, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            message.id || `${app.id}_msg_${Date.now()}_${Math.random()}`,
            app.id,
            message.senderId,
            message.type || 'system',
            message.content,
            message.createdAt || new Date().toISOString(),
          ])
          stats.applicationMessages++
        }
      }

      // 迁移 resource items
      if (app.type === 'resource' && app.resourceItems?.length) {
        for (const item of app.resourceItems) {
          await pool.query(`
            INSERT INTO application_items (
              id, application_id, resource_type, resource_subtype,
              payload, approver_group, approval_status, provision_status,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
          `, [
            item.id || `${app.id}_item_${Date.now()}_${Math.random()}`,
            app.id,
            item.resourceType,
            item.resourceSubtype,
            JSON.stringify(item),
            item.approverGroup || '管理员',
            item.approvalStatus || 'pending',
            item.provisionStatus || 'not_required',
            item.createdAt || new Date().toISOString(),
          ])
          stats.applicationItems++
        }
      }
    } catch (error) {
      stats.errors.push({
        table: 'applications',
        id: app.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate application ${app.id}:`, error)
    }
  }

  console.log(`  ✅ Migrated ${stats.applications} applications`)
  console.log(`     ├─ ${stats.applicationAttachments} attachments`)
  console.log(`     ├─ ${stats.applicationMessages} messages`)
  console.log(`     └─ ${stats.applicationItems} resource items`)
}

async function migrateStudentVerifications(verifications: any[]) {
  console.log(`\n🎓 Migrating ${verifications.length} student verifications...`)

  for (const verif of verifications) {
    try {
      await pool.query(`
        INSERT INTO student_verifications (
          id, user_id, status, category, notes,
          review_fee, fee_returned,
          education_email, education_email_verified, education_email_verified_at,
          reply, reviewed_at, reviewed_by,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7,
          $8, $9, $10,
          $11, $12, $13,
          $14
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        verif.id,
        verif.userId,
        verif.status,
        verif.category || '学生',
        verif.notes,
        verif.reviewFee || 800,
        verif.feeReturned || false,
        verif.educationEmail,
        verif.educationEmailVerified || false,
        verif.educationEmailVerifiedAt,
        verif.reply,
        verif.reviewedAt,
        verif.reviewedBy,
        verif.createdAt || new Date().toISOString(),
      ])

      stats.studentVerifications++
    } catch (error) {
      stats.errors.push({
        table: 'student_verifications',
        id: verif.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate verification ${verif.id}:`, error)
    }
  }

  console.log(`  ✅ Migrated ${stats.studentVerifications} verifications`)
}

async function migrateDailyCheckIns(checkIns: any[]) {
  console.log(`\n📅 Migrating ${checkIns.length} daily check-ins...`)

  for (const checkIn of checkIns) {
    try {
      await pool.query(`
        INSERT INTO daily_check_ins (
          id, user_id, date_key, points, streak, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, date_key) DO NOTHING
      `, [
        checkIn.id || `checkin_${checkIn.userId}_${checkIn.dateKey}`,
        checkIn.userId,
        checkIn.dateKey,
        checkIn.points,
        checkIn.streak || 1,
        checkIn.createdAt || new Date().toISOString(),
      ])

      stats.dailyCheckIns++
    } catch (error) {
      stats.errors.push({
        table: 'daily_check_ins',
        id: checkIn.id || checkIn.dateKey,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Migrated ${stats.dailyCheckIns} check-ins`)
}

async function migrateInvitationBindings(bindings: any[]) {
  console.log(`\n🎟️  Migrating ${bindings.length} invitation bindings...`)

  for (const binding of bindings) {
    try {
      await pool.query(`
        INSERT INTO invitation_bindings (
          id, code, inviter_user_id, invitee_user_id,
          vouched, vouched_at,
          reward_granted, reward_granted_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (invitee_user_id) DO NOTHING
      `, [
        binding.id || `binding_${binding.inviteeUserId}`,
        binding.code,
        binding.inviterUserId,
        binding.inviteeUserId,
        binding.vouched || false,
        binding.vouchedAt,
        binding.rewardGranted || false,
        binding.rewardGrantedAt,
        binding.createdAt || new Date().toISOString(),
      ])

      stats.invitationBindings++
    } catch (error) {
      stats.errors.push({
        table: 'invitation_bindings',
        id: binding.id || binding.inviteeUserId,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Migrated ${stats.invitationBindings} bindings`)
}

async function migrateSquarePosts(posts: any[]) {
  console.log(`\n📢 Migrating ${posts.length} square posts...`)

  for (const post of posts) {
    try {
      await pool.query(`
        INSERT INTO square_posts (
          id, user_id, type, title, content,
          application_id, template,
          penalty_count, last_penalty_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING
      `, [
        post.id,
        post.userId,
        post.type,
        post.title,
        post.content,
        post.applicationId,
        post.template ? JSON.stringify(post.template) : null,
        post.penaltyCount || 0,
        post.lastPenaltyAt,
        post.createdAt || new Date().toISOString(),
      ])

      stats.squarePosts++
    } catch (error) {
      stats.errors.push({
        table: 'square_posts',
        id: post.id,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Migrated ${stats.squarePosts} posts`)
}

async function migrateSquareBoosts(boosts: any[]) {
  console.log(`\n🚀 Migrating ${boosts.length} square boosts...`)

  for (const boost of boosts) {
    try {
      await pool.query(`
        INSERT INTO square_boosts (
          id, post_id, user_id, mode, declaration,
          points_granted, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (post_id, user_id) DO NOTHING
      `, [
        boost.id,
        boost.postId,
        boost.userId,
        boost.mode,
        boost.declaration,
        boost.pointsGranted || 0,
        boost.createdAt || new Date().toISOString(),
      ])

      stats.squareBoosts++
    } catch (error) {
      stats.errors.push({
        table: 'square_boosts',
        id: boost.id,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Migrated ${stats.squareBoosts} boosts`)
}

async function migrateCollaborationApplications(applications: any[]) {
  console.log(`\n🤝 Migrating ${applications.length} collaboration applications...`)

  for (const app of applications) {
    try {
      await pool.query(`
        INSERT INTO collaboration_applications (
          id, user_id, reason, status,
          reply, reviewed_at, reviewed_by,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [
        app.id,
        app.userId,
        app.reason,
        app.status || 'pending',
        app.reply,
        app.reviewedAt,
        app.reviewedBy,
        app.createdAt || new Date().toISOString(),
      ])

      stats.collaborationApplications++
    } catch (error) {
      stats.errors.push({
        table: 'collaboration_applications',
        id: app.id,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Migrated ${stats.collaborationApplications} collaboration applications`)
}

function printStats() {
  console.log('\n📊 Migration Statistics:')
  console.log(`  Users:                      ${stats.users}`)
  console.log(`  Applications:               ${stats.applications}`)
  console.log(`  - Attachments:              ${stats.applicationAttachments}`)
  console.log(`  - Messages:                 ${stats.applicationMessages}`)
  console.log(`  - Resource Items:           ${stats.applicationItems}`)
  console.log(`  Student Verifications:      ${stats.studentVerifications}`)
  console.log(`  Daily Check-ins:            ${stats.dailyCheckIns}`)
  console.log(`  Invitation Bindings:        ${stats.invitationBindings}`)
  console.log(`  Square Posts:               ${stats.squarePosts}`)
  console.log(`  Square Boosts:              ${stats.squareBoosts}`)
  console.log(`  Collaboration Apps:         ${stats.collaborationApplications}`)
  console.log(`  Errors:                     ${stats.errors.length}`)

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:')
    stats.errors.slice(0, 10).forEach(err => {
      console.log(`  - ${err.table}/${err.id}: ${err.error}`)
    })
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more errors`)
    }
  }
}

main().catch(console.error)
