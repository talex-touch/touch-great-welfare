/**
 * 数据一致性验证工具
 *
 * 用途：
 * 1. 验证 JSONB state 和规范化表的数据一致性
 * 2. 发现双写过程中的数据差异
 * 3. 生成详细的不一致报告
 *
 * 使用方法:
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/validate-consistency.ts
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/validate-consistency.ts --fix
 */

import * as process from 'node:process'
import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || process.env.HYPERDRIVE_URL
if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })
const shouldFix = process.argv.includes('--fix')

interface ValidationResult {
  entity: string
  id: string
  field: string
  stateValue: any
  tableValue: any
  severity: 'critical' | 'warning' | 'info'
}

interface ValidationStats {
  totalEntities: number
  validatedEntities: number
  mismatches: ValidationResult[]
  errors: Array<{ entity: string, id: string, error: string }>
}

const stats: ValidationStats = {
  totalEntities: 0,
  validatedEntities: 0,
  mismatches: [],
  errors: [],
}

async function main() {
  console.log(`🔍 Starting consistency validation (${shouldFix ? 'FIX MODE' : 'CHECK MODE'})...\n`)

  // 1. 读取 JSONB state
  console.log('📖 Reading JSONB state...')
  const stateRow = await pool.query(
    `SELECT state FROM welfare_app_state WHERE id = 'default'`,
  )

  if (!stateRow.rows[0]) {
    console.error('❌ No state found!')
    process.exit(1)
  }

  const state = stateRow.rows[0].state as any
  console.log(`✅ State loaded`)
  console.log(`   Users: ${state.users?.length || 0}`)
  console.log(`   Applications: ${state.applications?.length || 0}`)
  console.log()

  // 2. 验证用户
  await validateUsers(state.users || [])

  // 3. 验证申请
  await validateApplications(state.applications || [])

  // 4. 输出报告
  printReport()

  await pool.end()
}

async function validateUsers(users: any[]) {
  console.log(`👥 Validating ${users.length} users...`)
  stats.totalEntities += users.length

  for (const stateUser of users) {
    try {
      // 从表读取
      const result = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [stateUser.id],
      )

      if (!result.rows[0]) {
        stats.mismatches.push({
          entity: 'users',
          id: stateUser.id,
          field: '_existence',
          stateValue: 'exists',
          tableValue: 'missing',
          severity: 'critical',
        })

        if (shouldFix) {
          console.log(`  🔧 Creating missing user: ${stateUser.id}`)
          await insertUserToTable(stateUser)
        }

        continue
      }

      const tableUser = result.rows[0]

      // 对比关键字段
      compareField('users', stateUser.id, 'email', stateUser.email, tableUser.email, 'critical')
      compareField('users', stateUser.id, 'displayName', stateUser.profile?.displayName, tableUser.display_name, 'warning')
      compareField('users', stateUser.id, 'role', stateUser.role, tableUser.role, 'critical')
      compareField('users', stateUser.id, 'accountStatus', stateUser.accountStatus, tableUser.account_status, 'critical')

      // 积分对比（从 point_transactions 计算）
      const pointsResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM point_transactions WHERE user_id = $1`,
        [stateUser.id],
      )
      const calculatedPoints = Number(pointsResult.rows[0].total)

      if (stateUser.points !== calculatedPoints) {
        stats.mismatches.push({
          entity: 'users',
          id: stateUser.id,
          field: 'points',
          stateValue: stateUser.points,
          tableValue: calculatedPoints,
          severity: 'warning',
        })

        if (shouldFix) {
          console.log(`  🔧 Syncing points for user ${stateUser.id}: ${stateUser.points} → ${calculatedPoints}`)
          await pool.query(
            `UPDATE users SET points = $1, points_updated_at = NOW() WHERE id = $2`,
            [calculatedPoints, stateUser.id],
          )
        }
      }

      stats.validatedEntities++
    }
    catch (error) {
      stats.errors.push({
        entity: 'users',
        id: stateUser.id,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Validated ${stats.validatedEntities}/${stats.totalEntities} users\n`)
}

async function validateApplications(applications: any[]) {
  console.log(`📝 Validating ${applications.length} applications...`)
  const startCount = stats.validatedEntities
  stats.totalEntities += applications.length

  for (const stateApp of applications) {
    try {
      const result = await pool.query(
        `SELECT * FROM applications WHERE id = $1`,
        [stateApp.id],
      )

      if (!result.rows[0]) {
        stats.mismatches.push({
          entity: 'applications',
          id: stateApp.id,
          field: '_existence',
          stateValue: 'exists',
          tableValue: 'missing',
          severity: 'critical',
        })

        if (shouldFix) {
          console.log(`  🔧 Creating missing application: ${stateApp.id}`)
          await insertApplicationToTable(stateApp)
        }

        continue
      }

      const tableApp = result.rows[0]

      // 对比关键字段
      compareField('applications', stateApp.id, 'userId', stateApp.userId, tableApp.user_id, 'critical')
      compareField('applications', stateApp.id, 'type', stateApp.type, tableApp.type, 'critical')
      compareField('applications', stateApp.id, 'status', stateApp.status, tableApp.status, 'critical')
      compareField('applications', stateApp.id, 'title', stateApp.title, tableApp.title, 'warning')
      compareField('applications', stateApp.id, 'cost', stateApp.cost, tableApp.cost, 'warning')

      // 验证附件数量
      const attachmentsResult = await pool.query(
        `SELECT COUNT(*) as count FROM application_attachments WHERE application_id = $1`,
        [stateApp.id],
      )
      const tableAttachmentCount = Number(attachmentsResult.rows[0].count)
      const stateAttachmentCount = stateApp.attachments?.length || 0

      if (stateAttachmentCount !== tableAttachmentCount) {
        stats.mismatches.push({
          entity: 'applications',
          id: stateApp.id,
          field: 'attachments.count',
          stateValue: stateAttachmentCount,
          tableValue: tableAttachmentCount,
          severity: 'warning',
        })
      }

      stats.validatedEntities++
    }
    catch (error) {
      stats.errors.push({
        entity: 'applications',
        id: stateApp.id,
        error: String(error),
      })
    }
  }

  console.log(`  ✅ Validated ${stats.validatedEntities - startCount}/${applications.length} applications\n`)
}

function compareField(
  entity: string,
  id: string,
  field: string,
  stateValue: any,
  tableValue: any,
  severity: 'critical' | 'warning' | 'info',
) {
  // 规范化比较
  const normalizedState = normalizeValue(stateValue)
  const normalizedTable = normalizeValue(tableValue)

  if (normalizedState !== normalizedTable) {
    stats.mismatches.push({
      entity,
      id,
      field,
      stateValue,
      tableValue,
      severity,
    })
  }
}

function normalizeValue(value: any): any {
  if (value === null || value === undefined)
    return null
  if (typeof value === 'string')
    return value.trim()
  return value
}

async function insertUserToTable(user: any) {
  await pool.query(
    `INSERT INTO users (
      id, email, password_hash, display_name, role, account_status,
      points, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO NOTHING`,
    [
      user.id,
      user.email,
      user.passwordHash || null,
      user.profile?.displayName || 'Unnamed User',
      user.role || 'user',
      user.accountStatus || 'active',
      user.points || 0,
      user.createdAt || new Date().toISOString(),
    ],
  )
}

async function insertApplicationToTable(app: any) {
  await pool.query(
    `INSERT INTO applications (
      id, user_id, type, status, title, description,
      base_cost, cost, cost_charged,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (id) DO NOTHING`,
    [
      app.id,
      app.userId,
      app.type,
      app.status,
      app.title,
      app.description,
      app.baseCost || 0,
      app.cost || 0,
      app.costCharged || false,
      app.createdAt || new Date().toISOString(),
      app.updatedAt || app.createdAt || new Date().toISOString(),
    ],
  )
}

function printReport() {
  console.log('📊 Validation Report\n')
  console.log('='.repeat(80))

  console.log(`\n✅ Summary:`)
  console.log(`   Total entities:      ${stats.totalEntities}`)
  console.log(`   Validated:           ${stats.validatedEntities}`)
  console.log(`   Mismatches:          ${stats.mismatches.length}`)
  console.log(`   Errors:              ${stats.errors.length}`)

  if (stats.mismatches.length > 0) {
    console.log(`\n⚠️  Mismatches by Severity:`)
    const critical = stats.mismatches.filter(m => m.severity === 'critical')
    const warnings = stats.mismatches.filter(m => m.severity === 'warning')
    const info = stats.mismatches.filter(m => m.severity === 'info')

    console.log(`   🔴 Critical: ${critical.length}`)
    console.log(`   🟡 Warning:  ${warnings.length}`)
    console.log(`   🔵 Info:     ${info.length}`)

    // 显示前 10 个不一致
    console.log(`\n📋 Top Mismatches:`)
    stats.mismatches.slice(0, 10).forEach((m, i) => {
      const icon = m.severity === 'critical' ? '🔴' : m.severity === 'warning' ? '🟡' : '🔵'
      console.log(`   ${i + 1}. ${icon} ${m.entity}/${m.id}`)
      console.log(`      Field: ${m.field}`)
      console.log(`      State: ${JSON.stringify(m.stateValue)}`)
      console.log(`      Table: ${JSON.stringify(m.tableValue)}`)
    })

    if (stats.mismatches.length > 10) {
      console.log(`   ... and ${stats.mismatches.length - 10} more`)
    }
  }

  if (stats.errors.length > 0) {
    console.log(`\n❌ Errors:`)
    stats.errors.slice(0, 5).forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.entity}/${e.id}: ${e.error}`)
    })

    if (stats.errors.length > 5) {
      console.log(`   ... and ${stats.errors.length - 5} more`)
    }
  }

  console.log(`\n${'='.repeat(80)}`)

  if (stats.mismatches.length === 0 && stats.errors.length === 0) {
    console.log('\n✅ All data is consistent!')
  }
  else {
    console.log(`\n⚠️  Found ${stats.mismatches.length} mismatches and ${stats.errors.length} errors`)
    if (!shouldFix) {
      console.log('💡 Run with --fix to automatically repair issues')
    }
  }
}

main().catch(console.error)
