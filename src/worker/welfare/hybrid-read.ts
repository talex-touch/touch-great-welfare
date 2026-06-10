/**
 * 混合读取层 - 从规范化表读取数据，转换为 state 格式
 */

import type { WorkerEnv } from '~/composables/welfare'
import { getAllUsersFromTable } from './table-access'

export async function readWelfareStateFromTables(env: WorkerEnv) {
  const db = env.LOCAL_DB
  if (!db) {
    throw new Error('D1 database not available')
  }

  // 并行读取所有数据
  const [users, applications, studentVerifications] = await Promise.all([
    getAllUsersFromTable(env),
    db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM student_verifications ORDER BY created_at DESC').all(),
  ])

  // 转换为原来的 state 格式
  return {
    users,
    applications: applications.results?.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      status: row.status,
      title: row.title,
      description: row.description,
      baseCost: row.base_cost,
      cost: row.cost,
      costCharged: row.cost_charged === 1,
      costChargedAt: row.cost_charged_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
      completedAt: row.completed_at,
    })) || [],
    studentVerifications: studentVerifications.results?.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      educationEmail: row.education_email,
      verificationStatus: row.verification_status,
      codeSent: row.code_sent,
      codeExpiresAt: row.code_expires_at,
      verifiedAt: row.verified_at,
      verificationSource: row.verification_source,
      balance: row.balance,
      lastAwardedAt: row.last_awarded_at,
      createdAt: row.created_at,
    })) || [],
    pointTransactions: [],
  }
}
