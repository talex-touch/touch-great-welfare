import type { User } from '../src/composables/welfare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const {
  applicationPowChallenge,
  createUserInviteCode,
  defaultApplicationPolicy,
  RESOURCE_DEFAULT_DURATION,
  rollDailyCheckInPoints,
  solveApplicationPow,
  useWelfareStore,
} = await import('../src/composables/welfare')

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    role: 'user',
    points: 1_000_000,
    profile: {
      displayName: '公益用户',
      email: 'user@example.com',
      studentVerified: false,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function longRichText(label = '申请') {
  return `<p>${label}用于校园公益项目的持续维护、研发协作、用户支持和必要资源开通，已经明确说明具体场景、预期收益、风险边界和后续复盘方式。</p>`
}

function resetStore() {
  const store = useWelfareStore()
  store.isHydrated.value = false
  store.persistenceError.value = ''
  Object.assign(store.state, {
    users: [user()],
    currentUserId: 'user_1',
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
    transactions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
  })
  store.isHydrated.value = true
  return store
}

describe('application policy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-02T09:00:00.000Z'))
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('requires the configured minimum application description length', () => {
    const store = useWelfareStore()

    expect(() => store.submitApplication({
      type: 'code',
      title: '短申请',
      description: '<p>太短</p>',
    })).toThrow('申请内容不得少于 50 字')
  })

  it('enforces the one-minute submit cooldown', () => {
    const store = useWelfareStore()
    store.submitApplication({
      type: 'code',
      title: '第一次申请',
      description: longRichText('第一次申请'),
    })

    expect(() => store.submitApplication({
      type: 'code',
      title: '第二次申请',
      description: longRichText('第二次申请'),
    })).toThrow('提交过于频繁')
  })

  it('enforces per-user daily limits', () => {
    const store = useWelfareStore()
    store.state.applicationPolicy.submitCooldownSeconds = 0
    store.state.applicationPolicy.categories.code.perUserDailyLimit = 1
    store.submitApplication({
      type: 'code',
      title: '第一次申请',
      description: longRichText('第一次申请'),
    })

    expect(() => store.submitApplication({
      type: 'code',
      title: '第二次申请',
      description: longRichText('第二次申请'),
    })).toThrow('今日 CODE 申请次数已达上限')
  })

  it('blocks disabled application categories', () => {
    const store = useWelfareStore()
    store.state.applicationPolicy.categories.pro.enabled = false
    store.state.applicationPolicy.categories.pro.closedReason = 'Pro 今日维护'

    expect(() => store.submitApplication({
      type: 'pro',
      title: 'Pro 支持',
      description: longRichText('Pro 支持'),
    })).toThrow('Pro 今日维护')
  })

  it('requires and accepts valid PoW when enabled', () => {
    const store = useWelfareStore()
    const title = 'PoW 申请'
    const description = longRichText('PoW 申请')
    store.state.applicationPolicy.powEnabled = true
    store.state.applicationPolicy.powDifficulty = 2

    expect(() => store.submitApplication({
      type: 'code',
      title,
      description,
    })).toThrow('PoW 校验未通过')

    const nonce = solveApplicationPow(applicationPowChallenge({
      userId: 'user_1',
      type: 'code',
      title,
      description,
    }), 2)
    const application = store.submitApplication({
      type: 'code',
      title,
      description,
      powNonce: nonce,
    })

    expect(application.title).toBe(title)
  })

  it('lets resource drafts bypass formal submission policy', () => {
    const store = useWelfareStore()
    store.state.applicationPolicy.minDescriptionChars = 200

    const draft = store.submitResourceApplication({
      title: '资源草稿',
      reason: '',
      businessBackground: '',
      urgency: 'normal',
      duration: RESOURCE_DEFAULT_DURATION,
      selectedResourceTypes: ['database'],
      resourceItems: [{
        resourceType: 'database',
        resourceSubtype: 'mysql',
        payload: {},
      }],
      acceptedTermIds: [],
      saveAsDraft: true,
    })

    expect(draft.status).toBe('draft')
    expect(() => store.submitResourceApplication({
      title: '正式资源申请',
      reason: '<p>说明不足</p>',
      businessBackground: '',
      urgency: 'normal',
      duration: RESOURCE_DEFAULT_DURATION,
      selectedResourceTypes: ['database'],
      resourceItems: [{
        resourceType: 'database',
        resourceSubtype: 'mysql',
        payload: {},
      }],
      acceptedTermIds: [],
      saveAsDraft: false,
    })).toThrow('申请内容不得少于 200 字')
  })

  it('requires a real name for student verification', () => {
    const store = useWelfareStore()

    expect(() => store.submitStudentVerification({
      realName: '',
      category: '大学生',
      notes: '<p>已上传学生证和校园材料。</p>',
    })).toThrow('请填写真实姓名')
  })

  it('grants daily check-in points and streak coupons', () => {
    const store = useWelfareStore()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    expect(rollDailyCheckInPoints(() => 0)).toBe(30)
    expect(rollDailyCheckInPoints(() => 0.99)).toBe(1)

    for (let day = 2; day <= 8; day += 1) {
      vi.setSystemTime(new Date(`2026-06-${String(day).padStart(2, '0')}T09:00:00.000Z`))
      store.checkInToday()
    }

    expect(store.state.dailyCheckIns).toHaveLength(7)
    expect(store.state.dailyCheckIns[0].streak).toBe(7)
    expect(store.state.users[0].points).toBe(1_000_007)
    expect(store.state.coupons.map(coupon => coupon.discountRate)).toEqual([0.5, 0.8])
  })

  it('binds invitation codes only within eight hours and supports mutual guarantees', () => {
    const store = useWelfareStore()
    const inviter = user({
      id: 'user_inviter',
      profile: {
        displayName: '邀请人',
        email: 'inviter@example.com',
        inviteCode: createUserInviteCode('user_inviter'),
        studentVerified: false,
      },
      createdAt: '2026-06-01T00:00:00.000Z',
    })
    store.state.users.unshift(inviter)
    store.state.users.find(item => item.id === 'user_1')!.createdAt = '2026-06-02T09:00:00.000Z'

    const binding = store.bindInvitationCode(inviter.profile.inviteCode!)
    expect(binding.inviterUserId).toBe(inviter.id)
    expect(binding.inviteeUserId).toBe('user_1')

    store.vouchInvitation(binding.id)
    expect(store.state.invitationBindings[0].inviteeVouchedAt).toBeTruthy()

    store.state.currentUserId = inviter.id
    store.vouchInvitation(binding.id)
    expect(store.state.invitationBindings[0].inviterVouchedAt).toBeTruthy()

    store.state.currentUserId = 'user_1'
    store.state.invitationBindings = []
    store.state.users.find(item => item.id === 'user_1')!.createdAt = '2026-06-02T00:00:00.000Z'
    expect(() => store.bindInvitationCode(inviter.profile.inviteCode!)).toThrow('注册超过 8 小时')
  })
})
