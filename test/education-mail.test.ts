import type { WelfareState } from '../src/composables/welfare'
import { describe, expect, it } from 'vitest'
import { verifyEducationMailChallengesInState } from '../src/worker/education-mail'

function state(): WelfareState {
  return {
    users: [{
      id: 'user_1',
      role: 'user',
      points: 1000,
      profile: {
        displayName: '公益同学',
        email: 'user@example.com',
        studentVerified: false,
      },
      accountStatus: 'active',
      createdAt: '2026-06-01T00:00:00.000Z',
      lastLoginAt: '2026-06-01T00:00:00.000Z',
    }],
    oauth: {
      enabled: true,
      provider: 'github',
      clientId: '',
      authorizeUrl: '',
      tokenUrl: '',
      callbackUrl: '',
      scopes: '',
    },
    applicationPolicy: {
      minDescriptionChars: 50,
      submitCooldownSeconds: 60,
      powEnabled: false,
      powDifficulty: 3,
      turnstileEnabled: false,
      turnstileSiteKey: '',
      turnstileSecretKey: '',
      categories: {
        code: { enabled: true, dailyLimit: 80, perUserDailyLimit: 3, openStart: '', openEnd: '', closedReason: '' },
        image: { enabled: true, dailyLimit: 40, perUserDailyLimit: 2, openStart: '', openEnd: '', closedReason: '' },
        pro: { enabled: true, dailyLimit: 30, perUserDailyLimit: 2, openStart: '', openEnd: '', closedReason: '' },
        resource: { enabled: true, dailyLimit: 30, perUserDailyLimit: 2, openStart: '', openEnd: '', closedReason: '' },
      },
    },
    siteBanner: {
      enabled: false,
      title: '',
      body: '',
      tone: 'info',
    },
    applications: [],
    studentVerifications: [{
      id: 'stu_1',
      userId: 'user_1',
      verificationType: 'student',
      realName: '公益同学',
      category: '大学生',
      school: '北京大学',
      educationEmail: 'student@pku.edu.cn',
      educationEmailVerified: false,
      educationEmailChallengeId: 'edu_email_1',
      notes: '<p>已上传材料。</p>',
      attachments: [],
      status: 'pending',
      reviewFee: 800,
      feeReturned: false,
      createdAt: '2026-06-01T01:00:00.000Z',
    }],
    educationEmailChallenges: [{
      id: 'edu_email_1',
      userId: 'user_1',
      email: 'student@pku.edu.cn',
      code: 'TGW-EDU-ABC',
      subject: 'Touch Great Welfare 教育邮箱认证 TGW-EDU-ABC',
      body: '认证码：TGW-EDU-ABC',
      mailto: 'mailto:welfare@example.com',
      expiresAt: '2026-06-08T00:00:00.000Z',
      submittedAt: '2026-06-01T01:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
    }],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('education mail verification', () => {
  it('marks a challenge and its verification when DoneMail returns the matching code from the education inbox', async () => {
    const data = state()
    const matched = await verifyEducationMailChallengesInState(data, [{
      id: 'mail_1',
      from: 'student@pku.edu.cn',
      to: 'welfare@example.com',
      subject: 'Touch Great Welfare 教育邮箱认证 TGW-EDU-ABC',
      text: '认证码：TGW-EDU-ABC',
      receivedAt: '2026-06-01T02:00:00.000Z',
    }], new Date('2026-06-01T02:05:00.000Z'))

    expect(matched).toHaveLength(1)
    expect(data.educationEmailChallenges[0].verifiedAt).toBe('2026-06-01T02:05:00.000Z')
    expect(data.studentVerifications[0].educationEmailVerified).toBe(true)
    expect(data.studentVerifications[0].educationEmailVerifiedAt).toBe('2026-06-01T02:05:00.000Z')
  })

  it('ignores expired challenges and messages from a different sender', async () => {
    const data = state()
    data.educationEmailChallenges[0].expiresAt = '2026-06-01T01:00:00.000Z'
    const matched = await verifyEducationMailChallengesInState(data, [{
      id: 'mail_1',
      from: 'other@pku.edu.cn',
      subject: 'TGW-EDU-ABC',
      text: 'TGW-EDU-ABC',
    }], new Date('2026-06-01T02:05:00.000Z'))

    expect(matched).toHaveLength(0)
    expect(data.educationEmailChallenges[0].verifiedAt).toBeUndefined()
    expect(data.studentVerifications[0].educationEmailVerified).toBe(false)
  })
})
