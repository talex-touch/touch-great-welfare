import { describe, expect, it } from 'vitest'

const {
  aggregateResourceApplicationStatusForReview,
  assertCanAnswerApplication,
  assertCanRejectApplication,
  assertCanCompleteApplication,
  assertCanRequestApplicationSupplement,
  assertCanReviewResourceApplication,
  assertResourceApplication,
  transitionApplicationAllocationCompleted,
  transitionApplicationAnswered,
  transitionApplicationCompleted,
  transitionApplicationRejected,
  transitionApplicationSupplementRequested,
  transitionResourceItemReviewed,
  transitionResourceProvisionCompleted,
} = await import('../src/worker/welfare/application-state-machine')

describe('worker application state machine', () => {
  it('aggregates resource item approvals into review statuses', () => {
    expect(aggregateResourceApplicationStatusForReview([])).toBe('draft')
    expect(aggregateResourceApplicationStatusForReview([{ approvalStatus: 'pending' }])).toBe('in_review')
    expect(aggregateResourceApplicationStatusForReview([{ approvalStatus: 'approved' }, { approvalStatus: 'adjusted_approved' }])).toBe('pending_allocation')
    expect(aggregateResourceApplicationStatusForReview([{ approvalStatus: 'approved', provisionStatus: 'completed' }])).toBe('delivered')
    expect(aggregateResourceApplicationStatusForReview([{ approvalStatus: 'rejected' }, { approvalStatus: 'rejected' }])).toBe('rejected')
  })

  it('keeps ordinary review decisions inside pending review states', () => {
    expect(() => assertCanAnswerApplication('pending_review')).not.toThrow()
    expect(() => assertCanAnswerApplication('processing')).not.toThrow()
    expect(() => assertCanRejectApplication('pending_review')).not.toThrow()
    expect(() => assertCanRejectApplication('processing')).not.toThrow()
    expect(() => assertCanRequestApplicationSupplement('pending_review')).not.toThrow()
    expect(() => assertCanRequestApplicationSupplement('processing')).not.toThrow()

    expect(() => assertCanAnswerApplication('in_review')).toThrow('该申请已经处理')
    expect(() => assertCanRejectApplication('pending_allocation')).toThrow('该申请已经处理')
    expect(() => assertCanRequestApplicationSupplement('answered')).toThrow('只有审核中的申请可以请求补充材料')
  })

  it('keeps completion inside delivered result states', () => {
    expect(() => assertCanCompleteApplication('answered')).not.toThrow()
    expect(() => assertCanCompleteApplication('delivered')).not.toThrow()

    expect(() => assertCanCompleteApplication('pending_review')).toThrow('只有已答复或已交付的申请可以标记完成')
    expect(() => assertCanCompleteApplication('completed')).toThrow('只有已答复或已交付的申请可以标记完成')
  })

  it('centralizes ordinary application review state transitions', () => {
    const application = {
      status: 'pending_review',
      cost: 0,
      costCharged: false,
      answer: '',
    }

    transitionApplicationAnswered(application, '<p>已答复</p>', '2026-06-01T00:00:00.000Z')
    expect(application).toMatchObject({
      status: 'pending_allocation',
      answer: '<p>已答复</p>',
      reviewedAt: '2026-06-01T00:00:00.000Z',
      processingStartedAt: '2026-06-01T00:00:00.000Z',
    })

    transitionApplicationSupplementRequested(application, '2026-06-02T00:00:00.000Z')
    expect(application).toMatchObject({
      status: 'needs_supplement',
      processingStartedAt: '2026-06-01T00:00:00.000Z',
    })

    transitionApplicationRejected(application, '<p>退回</p>', '2026-06-03T00:00:00.000Z', true)
    expect(application).toMatchObject({
      status: 'rejected',
      answer: '<p>退回</p>',
      reviewedAt: '2026-06-03T00:00:00.000Z',
      rejectionFraudulent: true,
    })

    transitionApplicationCompleted(application, '2026-06-04T00:00:00.000Z')
    expect(application).toMatchObject({
      status: 'completed',
      completedAt: '2026-06-04T00:00:00.000Z',
    })
  })

  it('centralizes resource item review transitions', () => {
    const item = {
      id: 'item_1',
      applicationId: 'app_1',
      resourceType: 'database',
      resourceSubtype: 'postgresql',
      payload: { expiresAt: '2026-08-01T00:00:00.000Z' },
      approverGroup: '管理员',
      approvalStatus: 'pending',
      provisionStatus: 'not_required',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    const application = {
      id: 'app_1',
      userId: 'user_1',
      type: 'resource',
      title: '数据库申请',
      description: '测试',
      hasOpenSourceBadge: false,
      attachments: [],
      status: 'in_review',
      cost: 0,
      costCharged: false,
      aiReviewFeeRate: 0,
      rejectionReviewFee: 0,
      rejectionReviewFeeWaived: false,
      storageExtended: false,
      storageExtensionCost: 0,
      retentionExpiresAt: '2026-08-01T00:00:00.000Z',
      resourceItems: [item],
      createdAt: '2026-07-01T00:00:00.000Z',
    }

    transitionResourceItemReviewed(application as never, item as never, {
      status: 'approved',
      approvedPayload: { expiresAt: '2026-09-01T00:00:00.000Z' },
      note: '',
    }, '2026-07-02T00:00:00.000Z', '<p>审批通过</p>')

    expect(item).toMatchObject({
      approvalStatus: 'approved',
      provisionStatus: 'pending',
      lifecycleStatus: 'provisioning',
      expiresAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    })
    expect(application).toMatchObject({
      status: 'pending_allocation',
      reviewedAt: '2026-07-02T00:00:00.000Z',
      answer: '<p>审批通过</p>',
    })
  })

  it('rejects invalid resource review decisions', () => {
    const application = { type: 'resource', status: 'in_review', resourceItems: [] }
    const item = { approvalStatus: 'pending', payload: {} }

    expect(() => transitionResourceItemReviewed(application as never, item as never, {
      status: 'rejected',
      note: '',
    }, '2026-07-02T00:00:00.000Z', '')).toThrow('驳回资源明细时必须填写原因')
    expect(() => transitionResourceItemReviewed(application as never, item as never, {
      status: 'adjusted_approved',
      note: '',
    }, '2026-07-02T00:00:00.000Z', '')).toThrow('调整后通过必须填写批准后的额度/权限')

    expect(() => assertResourceApplication({ type: 'code' })).toThrow('资源申请不存在')
    expect(() => assertCanReviewResourceApplication({ type: 'resource', status: 'pending_allocation' })).toThrow('该申请不在审批中')
  })

  it('centralizes resource provision and allocation completion', () => {
    const item = {
      approvalStatus: 'approved',
      provisionStatus: 'pending',
      lifecycleStatus: 'provisioning',
      payload: {},
    }
    const application = {
      type: 'resource',
      status: 'pending_allocation',
      resourceItems: [item],
    }

    transitionResourceProvisionCompleted(application as never, item as never, {
      lifecycleStatus: 'active',
      payload: { resourceName: 'PostgreSQL' },
      note: '资源：PostgreSQL',
    }, '2026-07-03T00:00:00.000Z')
    expect(item).toMatchObject({
      provisionStatus: 'completed',
      lifecycleStatus: 'active',
      provisionCompletedAt: '2026-07-03T00:00:00.000Z',
      activatedAt: '2026-07-03T00:00:00.000Z',
    })
    expect(application).toMatchObject({
      status: 'delivered',
      completedAt: '2026-07-03T00:00:00.000Z',
    })

    const ordinaryApplication = { status: 'pending_allocation' }
    transitionApplicationAllocationCompleted(ordinaryApplication as never, { resourceName: 'Codex' }, '资源：Codex', '2026-07-04T00:00:00.000Z')
    expect(ordinaryApplication).toMatchObject({
      status: 'delivered',
      allocationPayload: { resourceName: 'Codex' },
      allocationNote: '资源：Codex',
      allocationCompletedAt: '2026-07-04T00:00:00.000Z',
      completedAt: '2026-07-04T00:00:00.000Z',
    })
  })
})
