import type { User, WelfareApplication, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const { createSessionCookie } = await import('../src/worker/session')
const { handleWelfareStateRequest } = await import('../src/worker/welfare-state')

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    role: 'user',
    points: 1000,
    profile: {
      displayName: '用户',
      email: 'user@example.com',
      studentVerified: false,
    },
    accountStatus: 'active',
    createdAt: '2026-06-02T00:00:00.000Z',
    lastLoginAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

function state(): WelfareState {
  return {
    users: [user()],
    oauth: {
      enabled: true,
      provider: 'github',
      clientId: 'client',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      callbackUrl: 'https://example.com/callback',
      scopes: 'read:user',
    },
    applicationPolicy: {
      minDescriptionChars: 10,
      submitCooldownSeconds: 0,
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
    siteBanner: { enabled: false, title: '', body: '' },
    systemConfig: {
      siteEnabled: true,
      siteClosedReason: '',
      loginEnabled: true,
      loginClosedReason: '',
      rechargeEnabled: true,
      rechargeClosedReason: '',
      verification: {
        student: { enabled: true, reason: '' },
        frontline: { enabled: true, reason: '' },
      },
    },
    applications: [],
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
    createdAt: '2026-06-02T00:00:00.000Z',
  }
}

function createMemoryD1(initialState: WelfareState) {
  let storedState: unknown = initialState
  const pointTransactions: Record<string, unknown>[] = []
  return {
    get pointTransactions() {
      return pointTransactions
    },
    prepare(query: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values
          return this
        },
        async first() {
          if (query.includes('select state from welfare_app_state'))
            return { state: JSON.stringify(storedState) }
          if (query.includes('select id from point_transactions where id'))
            return pointTransactions.find(item => item.id === this.values[0]) ? { id: this.values[0] } : null
          if (query.includes('select balance_after from point_transactions')) {
            const rows = pointTransactions.filter(item => item.user_id === this.values[0])
            return rows.at(-1) ? { balance_after: rows.at(-1)!.balance_after } : null
          }
          return null
        },
        async run() {
          if (query.includes('insert into welfare_app_state'))
            storedState = JSON.parse(String(this.values[1])) as unknown
          if (query.includes('insert into point_transactions')) {
            if (pointTransactions.some(item => item.id === this.values[0]))
              return
            pointTransactions.push({
              id: this.values[0],
              user_id: this.values[1],
              delta: this.values[2],
              type: this.values[3],
              reason: this.values[4],
              ref_id: this.values[5],
              balance_after: this.values[6],
              created_at: this.values[7],
            })
          }
        },
        async all() {
          return { results: [] }
        },
      }
    },
  }
}

function codeApplication(overrides: Partial<WelfareApplication> = {}): WelfareApplication {
  return {
    id: 'app_1',
    userId: 'user_1',
    type: 'code',
    title: 'Codex 申请',
    description: '<p>这是一个公益代码项目申请，说明足够长。</p>',
    hasOpenSourceBadge: false,
    attachments: [],
    status: 'pending_review',
    baseCost: 800,
    cost: 8,
    costCharged: true,
    aiReviewFeeRate: 0.3,
    rejectionReviewFee: 300,
    rejectionReviewFeeWaived: false,
    rejectionFraudulent: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: '2026-06-09T00:00:00.000Z',
    createdAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('welfare state security', () => {
  it('ignores forged client transactions and derives points from trusted new records', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')
    const nextState = {
      ...state(),
      users: [{ ...state().users[0], points: 999999 }],
      applications: [codeApplication()],
      transactions: [{
        id: 'tx_forged',
        userId: 'user_1',
        delta: 999999,
        type: 'grant',
        reason: 'forged',
        createdAt: '2026-06-02T00:00:00.000Z',
      }],
    }

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'PUT',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: nextState }),
    }), env)

    expect(response.status).toBe(200)
    expect(d1.pointTransactions).toHaveLength(1)
    expect(d1.pointTransactions[0].id).toBe('srv_application_cost_app_1')
    expect(d1.pointTransactions[0].delta).toBe(-8)

    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.users[0].points).toBe(992)
    expect(payload.state.transactions).toEqual([])
  })
})
