/**
 * ApplicationRepository - 申请数据访问层
 */

import { BaseRepository } from './base'
import type { WelfareApplication } from '~/composables/welfare'

export class ApplicationRepository extends BaseRepository<WelfareApplication> {
  // 从 JSONB state 读取申请
  readFromState(state: any, applicationId: string): WelfareApplication | null {
    if (!Array.isArray(state.applications))
      return null

    return state.applications.find((a: WelfareApplication) => a.id === applicationId) || null
  }

  // 写入 JSONB state
  writeToState(state: any, application: WelfareApplication): void {
    if (!Array.isArray(state.applications))
      state.applications = []

    const index = state.applications.findIndex((a: WelfareApplication) => a.id === application.id)
    if (index >= 0) {
      state.applications[index] = application
    }
    else {
      state.applications.push(application)
    }
  }

  // 从规范化表读取申请
  async readFromTable(applicationId: string): Promise<WelfareApplication | null> {
    // 主表
    const result = await this.pool.query<any>(
      `SELECT * FROM applications WHERE id = $1`,
      [applicationId],
    )

    if (!result.rows[0])
      return null

    const row = result.rows[0]

    // 读取附件
    const attachmentsResult = await this.pool.query(
      `SELECT * FROM application_attachments WHERE application_id = $1 ORDER BY uploaded_at`,
      [applicationId],
    )

    // 读取消息
    const messagesResult = await this.pool.query(
      `SELECT * FROM application_messages WHERE application_id = $1 ORDER BY created_at`,
      [applicationId],
    )

    // 读取资源项
    const itemsResult = await this.pool.query(
      `SELECT * FROM application_items WHERE application_id = $1`,
      [applicationId],
    )

    // 转换为 WelfareApplication 对象
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      status: row.status,
      title: row.title,
      description: row.description,
      baseCost: row.base_cost,
      cost: row.cost,
      costCharged: row.cost_charged,
      githubRepo: row.github_repo || undefined,
      hasOpenSourceBadge: row.has_open_source_badge || false,
      storageExtended: row.storage_extended || false,
      retentionExpiresAt: row.retention_expires_at || undefined,
      aiReviewStatus: row.ai_review_status || undefined,
      aiReviewSummary: row.ai_review_summary || undefined,
      aiReviewedAt: row.ai_reviewed_at || undefined,
      reviewedAt: row.reviewed_at || undefined,
      reviewerUserId: row.reviewer_user_id || undefined,
      rejectionReason: row.rejection_reason || undefined,
      rejectionReviewFee: row.rejection_review_fee || 0,
      answer: row.answer || undefined,
      completedAt: row.completed_at || undefined,
      deliveryAssigneeId: row.delivery_assignee_id || undefined,
      deliveryClaimedAt: row.delivery_claimed_at || undefined,
      attachments: attachmentsResult.rows.map(att => ({
        id: att.id,
        name: att.file_name,
        size: att.file_size,
        type: att.mime_type,
        url: att.storage_key,
      })),
      messages: messagesResult.rows.map(msg => ({
        id: msg.id,
        senderId: msg.sender_user_id,
        type: msg.type,
        content: msg.content,
        attachments: msg.attachments || [],
        createdAt: msg.created_at,
      })),
      resourceItems: itemsResult.rows.map(item => ({
        ...JSON.parse(item.payload),
        id: item.id,
        approvalStatus: item.approval_status,
        provisionStatus: item.provision_status,
      })),
      createdAt: row.created_at,
      submittedAt: row.submitted_at || undefined,
      updatedAt: row.updated_at,
    } as WelfareApplication
  }

  // 写入规范化表
  async writeToTable(application: WelfareApplication): Promise<void> {
    // 开启事务
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      // 1. 写入主表
      await client.query(
        `INSERT INTO applications (
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
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          cost = EXCLUDED.cost,
          cost_charged = EXCLUDED.cost_charged,
          storage_extended = EXCLUDED.storage_extended,
          retention_expires_at = EXCLUDED.retention_expires_at,
          ai_review_status = EXCLUDED.ai_review_status,
          ai_review_summary = EXCLUDED.ai_review_summary,
          ai_reviewed_at = EXCLUDED.ai_reviewed_at,
          reviewed_at = EXCLUDED.reviewed_at,
          reviewer_user_id = EXCLUDED.reviewer_user_id,
          rejection_reason = EXCLUDED.rejection_reason,
          rejection_review_fee = EXCLUDED.rejection_review_fee,
          answer = EXCLUDED.answer,
          completed_at = EXCLUDED.completed_at,
          delivery_assignee_id = EXCLUDED.delivery_assignee_id,
          delivery_claimed_at = EXCLUDED.delivery_claimed_at,
          submitted_at = EXCLUDED.submitted_at,
          updated_at = NOW()
        `,
        [
          application.id,
          application.userId,
          application.type,
          application.status,
          application.title,
          application.description,
          application.baseCost,
          application.cost,
          application.costCharged,
          application.githubRepo || null,
          application.hasOpenSourceBadge || false,
          application.storageExtended || false,
          application.retentionExpiresAt || null,
          application.aiReviewStatus || null,
          application.aiReviewSummary || null,
          application.aiReviewedAt || null,
          application.reviewedAt || null,
          application.reviewerUserId || null,
          application.rejectionReason || null,
          application.rejectionReviewFee || 0,
          application.answer || null,
          application.completedAt || null,
          application.deliveryAssigneeId || null,
          application.deliveryClaimedAt || null,
          application.createdAt,
          application.submittedAt || null,
          application.updatedAt || application.createdAt,
        ],
      )

      // 2. 同步附件（先删除旧的，再插入新的）
      await client.query(
        `DELETE FROM application_attachments WHERE application_id = $1`,
        [application.id],
      )

      if (application.attachments?.length) {
        for (const att of application.attachments) {
          await client.query(
            `INSERT INTO application_attachments (
              id, application_id, file_name, file_size, mime_type, storage_key
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              att.id || `${application.id}_att_${Date.now()}`,
              application.id,
              att.name,
              att.size,
              att.type || 'application/octet-stream',
              att.url || att.storageKey,
            ],
          )
        }
      }

      // 3. 同步消息
      await client.query(
        `DELETE FROM application_messages WHERE application_id = $1`,
        [application.id],
      )

      if (application.messages?.length) {
        for (const msg of application.messages) {
          await client.query(
            `INSERT INTO application_messages (
              id, application_id, sender_user_id, type, content, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              msg.id || `${application.id}_msg_${Date.now()}`,
              application.id,
              msg.senderId || null,
              msg.type,
              msg.content,
              msg.createdAt,
            ],
          )
        }
      }

      // 4. 同步资源项（仅针对 resource 类型）
      if (application.type === 'resource' && application.resourceItems?.length) {
        await client.query(
          `DELETE FROM application_items WHERE application_id = $1`,
          [application.id],
        )

        for (const item of application.resourceItems) {
          await client.query(
            `INSERT INTO application_items (
              id, application_id, resource_type, resource_subtype,
              payload, approver_group, approval_status, provision_status,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              item.id || `${application.id}_item_${Date.now()}`,
              application.id,
              item.resourceType,
              item.resourceSubtype || null,
              JSON.stringify(item),
              item.approverGroup || '管理员',
              item.approvalStatus || 'pending',
              item.provisionStatus || 'not_required',
              item.createdAt || new Date().toISOString(),
            ],
          )
        }
      }

      await client.query('COMMIT')
    }
    catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    finally {
      client.release()
    }
  }

  // 批量读取用户的申请
  async findByUserId(userId: string, limit = 100): Promise<WelfareApplication[]> {
    const result = await this.pool.query(
      `SELECT id FROM applications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    )

    const applications: WelfareApplication[] = []
    for (const row of result.rows) {
      const app = await this.readFromTable(row.id)
      if (app)
        applications.push(app)
    }

    return applications
  }

  // 查询待审核的申请
  async findPendingReview(limit = 50): Promise<WelfareApplication[]> {
    const result = await this.pool.query(
      `SELECT id FROM applications
       WHERE status IN ('pending_review', 'needs_supplement')
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    )

    const applications: WelfareApplication[] = []
    for (const row of result.rows) {
      const app = await this.readFromTable(row.id)
      if (app)
        applications.push(app)
    }

    return applications
  }
}
