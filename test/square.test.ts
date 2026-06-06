import type { SubmitResourceApplicationPayload, User } from '../src/composables/welfare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const {
  defaultApplicationPolicy,
  RESOURCE_DEFAULT_DURATION,
  SQUARE_BOOST_REPORT_PENALTY_POINTS,
  SQUARE_BOOST_REWARD_POINTS,
  SQUARE_SHARE_DISCOUNT_RATE,
  useWelfareStore,
} = await import('../src/composables/welfare')

function user(id: string, points = 1_000_000): User {
  return {
    id,
    role: 'user',
    points,
    profile: {
      displayName: id,
      email: `${id}@example.com`,
      studentVerified: false,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
  }
}

function longRichText(label: string) {
  return `<p>${label}用于校园公益项目的持续维护、研发协作、用户支持和必要资源开通，已经明确说明具体场景、预期收益、风险边界和后续复盘方式。</p>`
}

function boostDeclaration(label: string) {
  return `<p>${label}方向能持续帮助更多公益项目降低协作成本，我愿意公开支持并承担真实评价责任。</p>`
}

function resetStore() {
  const store = useWelfareStore()
  store.isHydrated.value = false
  store.persistenceError.value = ''
  Object.assign(store.state, {
    users: [
      user('owner'),
      user('helper_1', 100),
      user('helper_2', 100),
      user('helper_3', 100),
    ],
    currentUserId: 'owner',
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
    applications: [],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
  })
  store.isHydrated.value = true
  return store
}

function resourcePayload(overrides: Partial<SubmitResourceApplicationPayload> = {}): SubmitResourceApplicationPayload {
  return {
    title: '数据库资源模板',
    reason: longRichText('数据库资源申请'),
    businessBackground: '业务背景需要独立保留，不能被申请说明覆盖。',
    urgency: 'normal',
    duration: RESOURCE_DEFAULT_DURATION,
    selectedResourceTypes: ['database'],
    resourceItems: [{
      resourceType: 'database',
      resourceSubtype: 'mysql',
      payload: {
        name: 'welfare_read_model',
        environment: 'prod',
        permission: 'readonly',
        sensitiveData: true,
        operationScope: '只读查询公益统计报表',
        duration: RESOURCE_DEFAULT_DURATION,
      },
      requestedPermission: 'readonly',
      duration: RESOURCE_DEFAULT_DURATION,
    }],
    acceptedTermIds: ['general_resource_terms', 'database_security_terms'],
    saveAsDraft: false,
    ...overrides,
  }
}

describe('square workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-02T09:00:00.000Z'))
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('creates a square template and applies the share discount for normal applications', () => {
    const store = useWelfareStore()

    const application = store.submitApplication({
      type: 'pro',
      title: 'Pro 公益协作模板',
      description: longRichText('Pro 公益协作模板'),
      shareToSquare: true,
      squarePostContent: '<p>这个模板适合持续维护型公益项目。</p>',
    })

    expect(application.cost).toBe(114)
    expect(application.sharedToSquare).toBe(true)
    expect(application.squareDiscountRate).toBe(SQUARE_SHARE_DISCOUNT_RATE)
    expect(application.squareDiscountAmount).toBe(6)
    expect(store.state.users.find(item => item.id === 'owner')?.points).toBe(999_886)
    expect(store.state.squarePosts[0]).toMatchObject({
      id: application.squarePostId,
      applicationId: application.id,
      requestType: 'pro',
      type: 'application_template',
      title: 'Pro 公益协作模板',
    })
  })

  it('shares resource applications as reusable templates and preserves business background', () => {
    const store = useWelfareStore()

    const application = store.submitResourceApplication(resourcePayload({
      shareToSquare: true,
      squarePostContent: '<p>适合有生产只读报表诉求的公益项目。</p>',
    }))

    expect(application.status).toBe('in_review')
    expect(application.cost).toBe(38)
    expect(application.businessBackground).toBe('业务背景需要独立保留，不能被申请说明覆盖。')
    expect(application.squareDiscountAmount).toBe(2)
    expect(store.state.squarePosts[0].template?.resourceItems?.[0]).toMatchObject({
      resourceType: 'database',
      resourceSubtype: 'mysql',
      requestedPermission: 'readonly',
    })
  })

  it('shares a resource draft when it is submitted formally', () => {
    const store = useWelfareStore()
    const draft = store.submitResourceApplication(resourcePayload({
      acceptedTermIds: [],
      saveAsDraft: true,
    }))

    const application = store.updateResourceDraft(draft.id, resourcePayload({
      shareToSquare: true,
      squarePostContent: '<p>草稿完善后公开复用。</p>',
    }))

    expect(application.status).toBe('in_review')
    expect(application.sharedToSquare).toBe(true)
    expect(application.squarePostId).toBeTruthy()
    expect(store.state.squarePosts[0]).toMatchObject({
      id: application.squarePostId,
      applicationId: application.id,
      requestType: 'resource',
    })
  })

  it('rewards valid boosts, lowers the displayed discount, and penalizes reported boosts', () => {
    const store = useWelfareStore()
    const post = store.createSquarePost({
      type: 'review',
      title: '值得支持的公益方向',
      content: longRichText('公益方向评价'),
    })

    for (const helperId of ['helper_1', 'helper_2', 'helper_3']) {
      store.state.currentUserId = helperId
      store.boostSquarePost(post.id, boostDeclaration(helperId))
    }

    expect(store.squarePostValidBoosts(post.id)).toHaveLength(3)
    expect(store.squarePostDiscountRate(post.id)).toBe(0.94)
    expect(store.state.users.find(item => item.id === 'helper_1')?.points).toBe(100 + SQUARE_BOOST_REWARD_POINTS)

    const reportedBoost = store.state.squareBoosts.find(item => item.userId === 'helper_1')!
    store.state.currentUserId = 'owner'
    store.reportSquareBoost(reportedBoost.id, '宣言明显灌水，无法说明真实支持理由。')

    expect(store.state.squareReports).toHaveLength(1)
    expect(store.squarePostValidBoosts(post.id)).toHaveLength(2)
    expect(store.squarePostDiscountRate(post.id)).toBe(SQUARE_SHARE_DISCOUNT_RATE)
    expect(store.state.users.find(item => item.id === 'helper_1')?.points).toBe(100 + SQUARE_BOOST_REWARD_POINTS - SQUARE_BOOST_REPORT_PENALTY_POINTS)

    const otherPost = store.createSquarePost({
      type: 'review',
      title: '另一个公益方向',
      content: longRichText('另一个公益方向评价'),
    })
    store.state.currentUserId = 'helper_1'

    expect(() => store.boostSquarePost(otherPost.id, boostDeclaration('冷却用户')))
      .toThrow('举报处罚冷却中')
  })
})
