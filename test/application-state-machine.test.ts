import { describe, expect, it } from 'vitest'

const {
  aggregateResourceApplicationStatusForReview,
  assertCanAnswerApplication,
  assertCanRejectApplication,
  assertCanCompleteApplication,
  assertCanRequestApplicationSupplement,
  transitionApplicationAnswered,
  transitionApplicationCompleted,
  transitionApplicationRejected,
  transitionApplicationSupplementRequested,
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
})
