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

async function passwordHash(password: string) {
  const { sha256Hex } = await import('../src/worker/crypto')
  const salt = 'test-salt'
  return `v1:${salt}:${await sha256Hex(`${salt}:${password}`)}`
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
  const queries: Array<{ method: 'all' | 'first' | 'run', query: string, values: unknown[] }> = []
  return {
    get pointTransactions() {
      return pointTransactions
    },
    get queries() {
      return queries
    },
    prepare(query: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values
          return this
        },
        async first() {
          queries.push({ method: 'first', query, values: [...this.values] })
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
          queries.push({ method: 'run', query, values: [...this.values] })
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
          queries.push({ method: 'all', query, values: [...this.values] })
          if (query.includes('from point_transactions') && query.includes('row_number()')) {
            const userIds = new Set(this.values.map(String))
            const latestByUser = new Map<string, Record<string, unknown>>()
            for (const tx of pointTransactions
              .filter(item => userIds.has(String(item.user_id)))
              .sort((a, b) =>
                String(b.created_at).localeCompare(String(a.created_at))
                || String(b.id).localeCompare(String(a.id)),
              )) {
              const userId = String(tx.user_id)
              if (!latestByUser.has(userId))
                latestByUser.set(userId, tx)
            }
            return {
              results: Array.from(latestByUser.values()).map(item => ({
                user_id: item.user_id,
                balance_after: item.balance_after,
              })),
            }
          }
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
  it('allows admin password login without an existing session', async () => {
    const admin = user({
      id: 'admin_1',
      role: 'admin',
      profile: {
        displayName: '管理员',
        email: 'admin@welfare.dev',
        studentVerified: false,
      },
      passwordHash: await passwordHash('admin-password'),
    })
    const d1 = createMemoryD1({ ...state(), users: [admin] })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-welfare-action': 'login-admin',
      },
      body: JSON.stringify({ email: 'admin@welfare.dev', password: 'admin-password' }),
    }), env)

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('tg_welfare_session=')
    await expect(response.json()).resolves.toMatchObject({ ok: true, userId: 'admin_1', state: { currentUserId: 'admin_1' } })
  })

  it('keeps anonymous bootstrap reads off the point ledger', async () => {
    const users = Array.from({ length: 100 }, (_, index) => user({ id: `user_${index}`, points: 1000 + index }))
    const d1 = createMemoryD1({ ...state(), users })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    const bootstrapResponse = await handleWelfareStateRequest(new Request('https://example.com/api/bootstrap'), env)
    expect(bootstrapResponse.status).toBe(200)
    await expect(bootstrapResponse.json()).resolves.toMatchObject({ hasAdmin: false })

    const legacyResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state'), env)
    expect(legacyResponse.status).toBe(200)

    expect(d1.queries.filter(item => item.query.includes('point_transactions'))).toHaveLength(0)
  })

  it('syncs only the current user balance for the me state endpoint', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [
        user({ id: 'user_1', points: 1000 }),
        user({ id: 'user_2', points: 1000 }),
      ],
    })
    d1.pointTransactions.push(
      {
        id: 'tx_user_1',
        user_id: 'user_1',
        delta: 200,
        type: 'grant',
        reason: 'sync user 1',
        ref_id: null,
        balance_after: 1200,
        created_at: '2026-06-03T00:00:00.000Z',
      },
      {
        id: 'tx_user_2',
        user_id: 'user_2',
        delta: 500,
        type: 'grant',
        reason: 'sync user 2',
        ref_id: null,
        balance_after: 1500,
        created_at: '2026-06-03T00:00:00.000Z',
      },
    )
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/me', {
      headers: { cookie },
    }), env)

    expect(response.status).toBe(200)
    const payload = await response.json() as { state: WelfareState }
    expect(payload.state.users.find(item => item.id === 'user_1')?.points).toBe(1200)
    expect(payload.state.users.find(item => item.id === 'user_2')).toBeUndefined()

    const balanceQueries = d1.queries.filter(item => item.method === 'all' && item.query.includes('from point_transactions'))
    expect(balanceQueries).toHaveLength(1)
    expect(balanceQueries[0].values).toEqual(['user_1'])
  })

  it('syncs admin state balances with one batched ledger query', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const users = [
      admin,
      ...Array.from({ length: 99 }, (_, index) => user({ id: `user_${index + 1}`, points: 1000 })),
    ]
    const d1 = createMemoryD1({ ...state(), users })
    d1.pointTransactions.push(
      {
        id: 'tx_user_42',
        user_id: 'user_42',
        delta: 888,
        type: 'grant',
        reason: 'sync user 42',
        ref_id: null,
        balance_after: 1888,
        created_at: '2026-06-03T00:00:00.000Z',
      },
      {
        id: 'tx_admin_1',
        user_id: 'admin_1',
        delta: 50,
        type: 'grant',
        reason: 'sync admin',
        ref_id: null,
        balance_after: 50,
        created_at: '2026-06-03T00:00:00.000Z',
      },
    )
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/admin', {
      headers: { cookie },
    }), env)

    expect(response.status).toBe(200)
    const payload = await response.json() as { state: WelfareState }
    expect(payload.state.users.find(item => item.id === 'admin_1')?.points).toBe(50)
    expect(payload.state.users.find(item => item.id === 'user_42')?.points).toBe(1888)

    const balanceQueries = d1.queries.filter(item => item.method === 'all' && item.query.includes('from point_transactions'))
    expect(balanceQueries).toHaveLength(1)
    expect(new Set(balanceQueries[0].values)).toEqual(new Set(users.map(item => item.id)))
  })

  it('prevents non-admin PUT from replacing global users when applicationPolicy is omitted', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')
    const { applicationPolicy: _applicationPolicy, ...nextState } = {
      ...state(),
      users: [{ ...state().users[0], role: 'admin' as const, points: 999999 }],
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

    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.users[0].role).toBe('user')
    expect(payload.state.users[0].points).toBe(1000)
  })

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
