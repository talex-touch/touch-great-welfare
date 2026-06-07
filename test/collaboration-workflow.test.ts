import type { User, WelfareApplication } from '../src/composables/welfare'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const { defaultApplicationPolicy, useWelfareStore } = await import('../src/composables/welfare')

function user(id: string, role: User['role'] = 'user'): User {
  return {
    id,
    role,
    points: 0,
    profile: {
      displayName: role === 'admin' ? '管理员' : role === 'reviewer' ? '协作处理员' : '公益用户',
      email: `${id}@example.com`,
      studentVerified: false,
    },
    accountStatus: 'active',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
  }
}

function application(overrides: Partial<WelfareApplication> = {}): WelfareApplication {
  return {
    id: 'app_1',
    userId: 'owner_1',
    type: 'code',
    title: 'Codex 额度交付',
    description: '<p>需要开通 Codex 额度。</p>',
    hasOpenSourceBadge: false,
    attachments: [],
    status: 'answered',
    cost: 120,
    costCharged: true,
    aiReviewFeeRate: 0.3,
    rejectionReviewFee: 300,
    rejectionReviewFeeWaived: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: '2026-06-08T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    reviewedAt: '2026-06-02T00:00:00.000Z',
    answer: '<p>审核已通过，等待交付。</p>',
    ...overrides,
  }
}

function resetStore() {
  const store = useWelfareStore()
  store.isHydrated.value = false
  store.persistenceError.value = ''
  Object.assign(store.state, {
    users: [user('admin_1', 'admin'), user('owner_1'), user('helper_1', 'reviewer'), user('user_1')],
    oauth: {
      enabled: true,
      provider: 'github',
      clientId: 'client',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      callbackUrl: 'http://localhost/callback',
      scopes: 'read:user',
    },
    applicationPolicy: defaultApplicationPolicy(),
    applications: [application()],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    collaborationApplications: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    currentUserId: 'user_1',
    createdAt: '2026-06-01T00:00:00.000Z',
  })
  store.isHydrated.value = true
  return store
}

describe('collaboration workflow', () => {
  beforeEach(() => {
    resetStore()
  })

  it('lets users apply for collaboration access and admins approve it', () => {
    const store = useWelfareStore()

    const request = store.submitCollaborationApplication({
      reason: '<p>我可以处理 Codex 和 Pro 交付任务，熟悉 API Key、额度说明和用户沟通。</p>',
    })

    expect(request.status).toBe('pending')
    expect(() => store.submitCollaborationApplication({
      reason: '<p>重复申请，应该被拦截。</p>',
    })).toThrow('已有待审核')

    store.state.currentUserId = 'admin_1'
    store.reviewCollaborationApplication({
      id: request.id,
      status: 'approved',
      reply: '<p>通过。</p>',
    })

    expect(store.state.collaborationApplications[0].status).toBe('approved')
    expect(store.state.users.find(item => item.id === 'user_1')?.role).toBe('reviewer')
  })

  it('restricts delivery claims to eligible collaboration handlers', () => {
    const store = useWelfareStore()

    expect(() => store.claimDeliveryApplication('app_1')).toThrow('需要协作处理员权限')

    store.state.currentUserId = 'owner_1'
    store.state.users.find(item => item.id === 'owner_1')!.role = 'reviewer'
    expect(() => store.claimDeliveryApplication('app_1')).toThrow('该任务当前不可认领')

    store.state.currentUserId = 'helper_1'
    store.claimDeliveryApplication('app_1')
    expect(store.state.applications[0].deliveryAssigneeId).toBe('helper_1')

    store.state.applications[0].deliveryAssigneeId = undefined
    store.state.applications[0].status = 'completed'
    expect(() => store.claimDeliveryApplication('app_1')).toThrow('该任务当前不可认领')
  })

  it('requires admin review before reward and blocks duplicate reward', () => {
    const store = useWelfareStore()
    store.state.currentUserId = 'helper_1'

    store.claimDeliveryApplication('app_1')
    store.submitDeliveryResult({
      applicationId: 'app_1',
      content: '<p>已完成交付，Key 和额度说明已回复。</p>',
    })

    expect(store.state.applications[0].deliveryReviewStatus).toBe('pending_review')
    expect(store.state.users.find(item => item.id === 'helper_1')?.points).toBe(0)

    store.state.currentUserId = 'admin_1'
    store.reviewDeliveryResult({
      applicationId: 'app_1',
      approved: true,
      rewardPoints: 120,
      note: '<p>交付有效。</p>',
    })

    expect(store.state.applications[0].status).toBe('completed')
    expect(store.state.users.find(item => item.id === 'helper_1')?.points).toBe(120)
    expect(store.state.transactions[0].reason).toBe('CODE 协作交付奖励')
    expect(() => store.reviewDeliveryResult({
      applicationId: 'app_1',
      approved: true,
      rewardPoints: 120,
    })).toThrow('该任务没有待复核')
  })

  it('reopens a task when admin rejects delivery review', () => {
    const store = useWelfareStore()
    store.state.currentUserId = 'helper_1'
    store.claimDeliveryApplication('app_1')
    store.submitDeliveryResult({
      applicationId: 'app_1',
      content: '<p>交付说明不完整。</p>',
    })

    store.state.currentUserId = 'admin_1'
    store.reviewDeliveryResult({
      applicationId: 'app_1',
      approved: false,
      note: '<p>缺少交付链接。</p>',
    })

    expect(store.state.applications[0].deliveryAssigneeId).toBeUndefined()
    expect(store.state.applications[0].deliveryReviewStatus).toBe('rejected')

    store.state.currentUserId = 'helper_1'
    store.claimDeliveryApplication('app_1')
    expect(store.state.applications[0].deliveryAssigneeId).toBe('helper_1')
  })
})
