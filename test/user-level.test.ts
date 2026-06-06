import type { StudentVerification, User, WelfareApplication, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const { buildUserLevelCard, defaultApplicationPolicy } = await import('../src/composables/welfare')

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    role: 'user',
    points: 120,
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

function state(partial: Partial<WelfareState>): WelfareState {
  return {
    users: [],
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
    ...partial,
  }
}

function application(index: number, userId: string, overrides: Partial<WelfareApplication> = {}): WelfareApplication {
  return {
    id: `app_${index}`,
    userId,
    type: 'pro',
    title: '公益项目支持',
    description: '需要支持',
    hasOpenSourceBadge: false,
    attachments: [],
    status: 'answered',
    cost: 100,
    costCharged: true,
    aiReviewFeeRate: 0.3,
    rejectionReviewFee: 30,
    rejectionReviewFeeWaived: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: '2026-06-08T00:00:00.000Z',
    createdAt: `2026-06-01T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    reviewedAt: `2026-06-01T${String(index % 24).padStart(2, '0')}:30:00.000Z`,
    ...overrides,
  }
}

function studentVerification(userId: string, overrides: Partial<StudentVerification> = {}): StudentVerification {
  return {
    id: 'stu_1',
    userId,
    realName: '公益同学',
    category: '大学生',
    notes: '材料完整',
    attachments: [],
    status: 'approved',
    reviewFee: 10,
    feeReturned: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('user level card', () => {
  it('keeps early verified users at starter level', () => {
    const currentUser = user({
      profile: {
        displayName: '可信用户',
        email: 'trusted@example.com',
        githubAuthorized: true,
        studentVerified: true,
      },
      points: 800,
    })
    const card = buildUserLevelCard(currentUser, state({
      applications: [
        application(1, currentUser.id, { hasOpenSourceBadge: true }),
        application(2, currentUser.id, {
          type: 'code',
          cost: 1,
          rejectionReviewFee: 1,
        }),
      ],
      studentVerifications: [
        studentVerification(currentUser.id),
      ],
    }))

    expect(card.score).toBe(54)
    expect(card.key).toBe('starter')
    expect(card.priority).toBe(1)
  })

  it('keeps old high-priority histories below high-priority levels', () => {
    const currentUser = user({
      profile: {
        displayName: '长期共建用户',
        email: 'builder@example.com',
        githubAuthorized: true,
        studentVerified: true,
      },
      points: 20000,
    })
    const applications = Array.from({ length: 18 }, (_, index) =>
      application(index + 1, currentUser.id, { hasOpenSourceBadge: true }))

    const card = buildUserLevelCard(currentUser, state({
      applications,
      studentVerifications: [studentVerification(currentUser.id)],
    }))

    expect(card.key).toBe('starter')
    expect(card.score).toBeLessThan(300)
  })

  it('requires much longer sustained approvals before high-priority levels', () => {
    const currentUser = user({
      profile: {
        displayName: '长期共建用户',
        email: 'builder@example.com',
        githubAuthorized: true,
        studentVerified: true,
      },
      points: 20000,
    })
    const applications = Array.from({ length: 760 }, (_, index) =>
      application(index + 1, currentUser.id, { hasOpenSourceBadge: true }))

    const card = buildUserLevelCard(currentUser, state({
      applications,
      studentVerifications: [studentVerification(currentUser.id)],
    }))

    expect(card.key).toBe('priority')
    expect(card.score).toBeGreaterThanOrEqual(1600)
    expect(card.score).toBeLessThan(2450)
  })

  it('keeps guardian level for deep contribution history', () => {
    const currentUser = user({
      profile: {
        displayName: '深度共建用户',
        email: 'guardian@example.com',
        githubAuthorized: true,
        studentVerified: true,
      },
      points: 32000,
    })
    const applications = Array.from({ length: 1160 }, (_, index) =>
      application(index + 1, currentUser.id, { hasOpenSourceBadge: true }))

    const card = buildUserLevelCard(currentUser, state({
      applications,
      studentVerifications: [studentVerification(currentUser.id)],
    }))

    expect(card.key).toBe('guardian')
    expect(card.score).toBeGreaterThanOrEqual(2450)
  })

  it('penalizes rejected records', () => {
    const currentUser = user({ points: 80 })
    const card = buildUserLevelCard(currentUser, state({
      applications: [
        application(1, currentUser.id, {
          status: 'rejected',
          costCharged: false,
        }),
      ],
      studentVerifications: [],
    }))

    expect(card.key).toBe('starter')
    expect(card.score).toBeLessThan(300)
  })
})
