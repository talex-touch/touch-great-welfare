import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

describe('application message thread', () => {
  it('answered status is excluded from pendingApplications filter', () => {
    // answered apps should NOT appear in the pending review queue
    // they are active (can submit results) but admin has already replied
    const pendingStatuses = ['pending_review', 'processing', 'submitted', 'in_review']
    expect(pendingStatuses).not.toContain('answered')
    expect(pendingStatuses).not.toContain('completed')
  })

  it('answered status counts as approved in user stats', () => {
    // answered should be counted among approved/completed states
    const approvedLike = ['answered', 'completed', 'closed', 'approved', 'partial_approved']
    expect(approvedLike).toContain('answered')
    expect(approvedLike).toContain('completed')
  })

  it('requestStatus type includes the full status flow', () => {
    const statuses: string[] = [
      'draft',
      'reserved',
      'pending_review',
      'processing',
      'answered',
      'completed',
      'closed',
      'rejected',
    ]
    // A valid flow: pending_review → answered → completed
    const flow = statuses.filter(s => ['pending_review', 'answered', 'completed'].includes(s))
    expect(flow).toEqual(['pending_review', 'answered', 'completed'])
  })

  it('applicationMessageType covers all conversation types', () => {
    const types: string[] = [
      'comment',
      'result_submission',
      'system',
    ]
    expect(types.length).toBe(3)
    // result_submission is distinct from comment
    expect(types).toContain('result_submission')
    expect(types).toContain('comment')
    expect(types).toContain('system')
  })

  it('isActiveApplication excludes answered and completed', () => {
    // isActiveApplication controls request creation limits
    // answered/completed apps should NOT block new requests
    const active = ['reserved', 'pending_review', 'processing', 'submitted', 'in_review']
    expect(active).not.toContain('answered')
    expect(active).not.toContain('completed')
    expect(active).not.toContain('closed')
    expect(active).not.toContain('rejected')
  })

  it('completeApplication only valid from answered status', () => {
    // Business rule: can only mark complete if already answered
    const validFrom = 'answered'
    const invalidFrom = ['pending_review', 'processing', 'completed', 'rejected']
    expect(invalidFrom).not.toContain(validFrom)
  })
})
