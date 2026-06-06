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
      displayName: role === 'admin' ? '管理员' : '公益用户',
      email: `${id}@example.com`,
      studentVerified: false,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
  }
}

function proApplication(overrides: Partial<WelfareApplication> = {}): WelfareApplication {
  return {
    id: 'app_1',
    userId: 'user_1',
    type: 'pro',
    title: 'Pro 支持',
    description: '<p>需要协作支持</p>',
    hasOpenSourceBadge: false,
    attachments: [],
    status: 'pending_review',
    cost: 120,
    costCharged: true,
    aiReviewFeeRate: 0.3,
    rejectionReviewFee: 300,
    rejectionReviewFeeWaived: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: '2026-06-08T00:00:00.000Z',
    postApprovalSupplementLimit: 1,
    postApprovalSupplementCount: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function resetStore() {
  const store = useWelfareStore()
  store.isHydrated.value = false
  store.persistenceError.value = ''
  Object.assign(store.state, {
    users: [user('admin_1', 'admin'), user('user_1'), user('user_2')],
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
    applications: [proApplication()],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    transactions: [],
    currentUserId: 'admin_1',
    createdAt: '2026-06-01T00:00:00.000Z',
  })
  store.isHydrated.value = true
  return store
}

describe('pro supplement workflow', () => {
  beforeEach(() => {
    resetStore()
  })

  it('lets admins request supplementary material and moves the application out of direct review actions', () => {
    const store = useWelfareStore()

    store.requestApplicationSupplement('app_1', '<p>请补充项目背景和仓库链接。</p>')

    const application = store.state.applications[0]
    expect(application.status).toBe('needs_supplement')
    expect(application.messages?.at(-1)?.type).toBe('system')
    expect(application.messages?.at(-1)?.userId).toBe('admin_1')
  })

  it('lets the owner submit requested material and returns the application to review', () => {
    const store = useWelfareStore()
    store.requestApplicationSupplement('app_1', '<p>请补充项目背景。</p>')
    store.state.currentUserId = 'user_1'

    store.submitApplicationSupplement('app_1', '<p>已补充完整背景。</p>')

    const application = store.state.applications[0]
    expect(application.status).toBe('pending_review')
    expect(application.messages?.at(-1)?.type).toBe('supplement')
    expect(application.messages?.at(-1)?.userId).toBe('user_1')
  })

  it('allows exactly one free post-approval supplement for Pro applications', () => {
    const store = useWelfareStore()
    store.state.applications[0] = proApplication({ status: 'answered' })
    store.state.currentUserId = 'user_1'

    store.submitApplicationSupplement('app_1', '<p>通过后补充一次说明。</p>')

    expect(store.state.applications[0].postApprovalSupplementCount).toBe(1)
    expect(() => store.submitApplicationSupplement('app_1', '<p>第二次补充。</p>'))
      .toThrow('免费补充次数已用完')
  })

  it('blocks non-owners from supplementing an application', () => {
    const store = useWelfareStore()
    store.requestApplicationSupplement('app_1', '<p>请补充项目背景。</p>')
    store.state.currentUserId = 'user_2'

    expect(() => store.submitApplicationSupplement('app_1', '<p>越权补充。</p>'))
      .toThrow('只能补充自己的申请材料')
  })
})
