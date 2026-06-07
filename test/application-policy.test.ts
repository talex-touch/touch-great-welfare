import type { User, WelfareState } from '../src/composables/welfare'
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
  normalizeVerificationType,
  RESOURCE_DEFAULT_DURATION,
  rollDailyCheckInPoints,
  solveApplicationPow,
  verificationTypeLabel,
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
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
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

  it('defaults verification records to student type', () => {
    const store = useWelfareStore()

    const beforePoints = store.state.users[0].points
    store.submitStudentVerification({
      realName: '公益同学',
      category: '大学生',
      notes: '<p>已上传学生证和校园材料。</p>',
    })

    expect(store.state.studentVerifications[0].verificationType).toBe('student')
    expect(store.state.transactions[0].reason).toBe('学生认证审核费')
    expect(store.state.users[0].points).toBe(beforePoints - 800)
  })

  it('keeps frontline approval from marking student verification', () => {
    const store = useWelfareStore()
    store.state.users.push(user({
      id: 'admin_1',
      role: 'admin',
      profile: {
        displayName: '管理员',
        email: 'admin@example.com',
        studentVerified: false,
      },
    }))

    store.submitStudentVerification({
      verificationType: 'frontline',
      realName: '一线伙伴',
      category: '乡村振兴',
      school: '驻村项目组',
      notes: '<p>已上传单位证明、服务记录和项目材料。</p>',
    })
    const verificationId = store.state.studentVerifications[0].id

    store.state.currentUserId = 'admin_1'
    store.approveStudentVerification(verificationId, '通过')

    expect(store.state.studentVerifications[0].verificationType).toBe('frontline')
    expect(store.state.studentVerifications[0].feeReturned).toBe(true)
    expect(store.state.users.find(item => item.id === 'user_1')?.profile.studentVerified).toBe(false)
    expect(store.state.transactions[0].reason).toBe('一线认证通过返还审核费')
  })

  it('marks education email as admin verified when approving student verification', () => {
    const store = useWelfareStore()
    store.state.users.push(user({
      id: 'admin_1',
      role: 'admin',
      profile: {
        displayName: '管理员',
        email: 'admin@example.com',
        studentVerified: false,
      },
    }))

    store.submitStudentVerification({
      realName: '公益同学',
      category: '大学生',
      educationEmail: 'student@pku.edu.cn',
      notes: '<p>已上传学生证和校园材料。</p>',
    })
    const verificationId = store.state.studentVerifications[0].id

    store.state.currentUserId = 'admin_1'
    store.approveStudentVerification(verificationId, '通过')

    expect(store.state.studentVerifications[0].educationEmailVerified).toBe(true)
    expect(store.state.studentVerifications[0].educationEmailVerifiedAt).toBe('2026-06-02T09:00:00.000Z')
    expect(store.state.studentVerifications[0].educationEmailVerificationSource).toBe('admin_approved')
  })

  it('keeps user confirmed education email verification on student submission', () => {
    const store = useWelfareStore()
    const challenge = store.createEducationEmailChallenge('student@pku.edu.cn', '公益同学')

    store.confirmEducationEmailChallengeSent(challenge.id)
    store.submitStudentVerification({
      realName: '公益同学',
      category: '大学生',
      educationEmail: 'student@pku.edu.cn',
      educationEmailChallengeId: challenge.id,
      educationEmailVerified: true,
      notes: '<p>已上传学生证和校园邮箱邮件证明。</p>',
    })

    expect(store.state.educationEmailChallenges[0].verifiedAt).toBe('2026-06-02T09:00:00.000Z')
    expect(store.state.studentVerifications[0].educationEmailVerified).toBe(true)
    expect(store.state.studentVerifications[0].educationEmailVerifiedAt).toBe('2026-06-02T09:00:00.000Z')
    expect(store.state.studentVerifications[0].educationEmailVerificationSource).toBe('user_confirmed_sent')
  })

  it('lets admins request student supplements and users resubmit without another review fee', () => {
    const store = useWelfareStore()
    store.state.users.push(user({
      id: 'admin_1',
      role: 'admin',
      profile: {
        displayName: '管理员',
        email: 'admin@example.com',
        studentVerified: false,
      },
    }))

    store.submitStudentVerification({
      realName: '公益同学',
      category: '大学生',
      school: '北京航空航天大学',
      grade: '2026 级',
      educationEmail: 'old@buaa.edu.cn',
      notes: '<p>已上传学生证和校园邮箱截图。</p>',
    })
    const verificationId = store.state.studentVerifications[0].id
    expect(store.state.transactions).toHaveLength(1)

    store.state.currentUserId = 'admin_1'
    store.requestStudentSupplement(verificationId, '请重新提交教育邮箱证明。')
    expect(store.state.studentVerifications[0].status).toBe('needs_supplement')

    store.state.currentUserId = 'user_1'
    const challenge = store.createEducationEmailChallenge('new@buaa.edu.cn', '公益同学')
    store.confirmEducationEmailChallengeSent(challenge.id)
    store.supplementStudentVerification({
      verificationId,
      realName: '公益同学',
      category: '大学生',
      school: '北京航空航天大学',
      grade: '2026 级',
      educationEmail: 'new@buaa.edu.cn',
      educationEmailChallengeId: challenge.id,
      educationEmailVerified: true,
      notes: '<p>已重新发送教育邮箱证明，并补充校园系统截图。</p>',
    })

    expect(store.state.studentVerifications[0].status).toBe('pending')
    expect(store.state.studentVerifications[0].educationEmail).toBe('new@buaa.edu.cn')
    expect(store.state.studentVerifications[0].educationEmailChallengeId).toBe(challenge.id)
    expect(store.state.studentVerifications[0].educationEmailVerified).toBe(true)
    expect(store.state.transactions).toHaveLength(1)
  })

  it('lets admins request frontline supplements and users resubmit the same record', () => {
    const store = useWelfareStore()
    store.state.users.push(user({
      id: 'admin_1',
      role: 'admin',
      profile: {
        displayName: '管理员',
        email: 'admin@example.com',
        studentVerified: false,
      },
    }))

    store.submitStudentVerification({
      verificationType: 'frontline',
      realName: '一线伙伴',
      category: '乡村振兴',
      school: '驻村项目组',
      grade: '半年内',
      notes: '<p>已上传服务记录。</p>',
    })
    const verificationId = store.state.studentVerifications[0].id

    store.state.currentUserId = 'admin_1'
    store.requestStudentSupplement(verificationId, '请补充组织证明。')
    expect(store.state.studentVerifications[0].status).toBe('needs_supplement')

    store.state.currentUserId = 'user_1'
    store.supplementStudentVerification({
      verificationId,
      verificationType: 'frontline',
      realName: '一线伙伴',
      category: '乡村振兴',
      school: '驻村项目组',
      grade: '1 年',
      notes: '<p>已补充组织证明和更完整的服务记录。</p>',
    })

    expect(store.state.studentVerifications).toHaveLength(1)
    expect(store.state.studentVerifications[0].status).toBe('pending')
    expect(store.state.studentVerifications[0].verificationType).toBe('frontline')
    expect(store.state.studentVerifications[0].educationEmail).toBeUndefined()
    expect(store.state.transactions).toHaveLength(1)
  })

  it('refreshes state before submitting student verification so stale tabs cannot overspend', async () => {
    const store = useWelfareStore()
    const { useWelfareUiState } = await import('../src/composables/welfare-ui')
    const ui = useWelfareUiState()
    const remoteState: WelfareState = {
      ...store.state,
      users: [user({ points: 0 })],
      currentUserId: 'user_1',
      studentVerifications: [],
      transactions: [{
        id: 'tx_recharge_spent',
        userId: 'user_1',
        delta: -800,
        type: 'spend',
        reason: '学生认证审核费',
        refId: 'stu_previous',
        createdAt: '2026-06-02T08:00:00.000Z',
      }],
    }
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ state: remoteState, currentUserId: 'user_1' }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    store.state.users[0].points = 800

    await expect(ui.submitStudentVerification({
      realName: '公益同学',
      category: '大学生',
      notes: '<p>已上传学生证和校园材料。</p>',
    })).rejects.toThrow('积分不足')

    expect(store.state.users[0].points).toBe(0)
    expect(store.state.studentVerifications).toHaveLength(0)
    expect(store.state.transactions).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes missing verification types as student', () => {
    expect(normalizeVerificationType(undefined)).toBe('student')
    expect(verificationTypeLabel(undefined)).toBe('学生认证')
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
