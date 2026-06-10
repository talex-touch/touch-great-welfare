import type { User, WelfareApplication, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const { createEpaySign } = await import('../src/worker/ldc-credit')
const { createSessionCookie } = await import('../src/worker/session')
const { appendPointTransaction, pointTransactionId } = await import('../src/worker/points')
const { STUDENT_REVIEW_FEE } = await import('../src/composables/welfare')
const { handleRechargeRequest } = await import('../src/worker/recharge')
const { handleUploadRequest } = await import('../src/worker/uploads')
const { handleApplicationSubmitRequest, handleWelfareStateRequest, readWelfareState, writeWelfareState } = await import('../src/worker/welfare-state')

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

function recordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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

function dateKeyOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function createMemoryD1(initialState: WelfareState) {
  let storedState: unknown = initialState
  let storedVersion = 1
  let storedMutationId = ''
  let bumpVersionAfterNextVersionRead = false
  const pointTransactions: Record<string, unknown>[] = []
  const queries: Array<{ method: 'all' | 'first' | 'run', query: string, values: unknown[] }> = []
  const rechargeOrders: Record<string, unknown>[] = []
  const rechargeConfig = {
    id: 'default',
    enabled: 1,
    gateway_base_url: 'https://credit.example/epay',
    pid: 'pid_1',
    key: 'secret_1',
    key_encrypted: null,
    points_per_ldc: 10,
  }
  return {
    get queries() {
      return queries
    },
    get rechargeOrders() {
      return rechargeOrders
    },
    get pointTransactions() {
      return pointTransactions
    },
    bumpVersionAfterNextVersionRead() {
      bumpVersionAfterNextVersionRead = true
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
          if (query.includes('select state') && query.includes('welfare_app_state'))
            return { state: JSON.stringify(storedState), version: storedVersion }
          if (query.includes('select version from welfare_app_state')) {
            const version = storedVersion
            if (bumpVersionAfterNextVersionRead) {
              storedVersion += 1
              bumpVersionAfterNextVersionRead = false
            }
            return { version }
          }
          if (query.includes('select * from recharge_merchant_config'))
            return rechargeConfig
          if (query.includes('select * from recharge_orders where out_trade_no'))
            return rechargeOrders.find(item => item.out_trade_no === this.values[0]) ?? null
          if (query.includes('from point_transactions where id'))
            return pointTransactions.find(item => item.id === this.values[0]) ?? null
          if (query.includes('select id from point_transactions where type'))
            return pointTransactions.find(item => item.type === this.values[0] && item.ref_id === this.values[1]) ? { id: 'exists' } : null
          if (query.includes('select balance_after from point_transactions')) {
            const rows = pointTransactions.filter(item => item.user_id === this.values[0])
            return rows.at(-1) ? { balance_after: rows.at(-1)!.balance_after } : null
          }
          return null
        },
        async run() {
          queries.push({ method: 'run', query, values: [...this.values] })
          if (query.includes('update welfare_app_state')) {
            if (storedVersion !== Number(this.values[3]))
              return { meta: { changes: 0 } }

            storedState = JSON.parse(String(this.values[1])) as unknown
            storedVersion = Number(this.values[2] || storedVersion + 1)
            storedMutationId = typeof this.values[4] === 'string' ? this.values[4] : storedMutationId
            return { meta: { changes: 1 } }
          }
          if (query.includes('insert into welfare_app_state')) {
            storedState = JSON.parse(String(this.values[1])) as unknown
            storedVersion = Number(this.values[2] || storedVersion + 1)
            storedMutationId = typeof this.values[3] === 'string' ? this.values[3] : storedMutationId
            return { meta: { changes: 1 } }
          }
          if (query.includes('insert into recharge_orders')) {
            rechargeOrders.push({
              out_trade_no: this.values[0],
              user_id: this.values[1],
              amount: this.values[2],
              credited_points: this.values[3],
              status: this.values[4],
              payment_type: this.values[5],
              order_name: this.values[6],
            })
            return { meta: { changes: 1 } }
          }
          if (query.includes('update recharge_orders')) {
            const order = rechargeOrders.find(item => item.out_trade_no === this.values[0])
            if (order && (!query.includes('status = \'pending\'') || order.status === 'pending')) {
              order.status = 'succeeded'
              order.ldc_trade_no = this.values[1]
              order.notify_payload = this.values[2]
              return { meta: { changes: 1 } }
            }
            return { meta: { changes: 0 } }
          }
          if (query.includes('insert into point_transactions')) {
            if (query.includes('where exists')) {
              const expectedVersion = Number(this.values[9])
              const expectedMutationId = String(this.values[10])
              if (storedVersion !== expectedVersion || storedMutationId !== expectedMutationId)
                return { meta: { changes: 0 } }
            }
            if (pointTransactions.some(item => item.id === this.values[0]))
              return { meta: { changes: 0 } }
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
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async all() {
          queries.push({ method: 'all', query, values: [...this.values] })
          if (query.includes('select payload from welfare_applications')) {
            const applications = recordLike(storedState) && Array.isArray(storedState.applications) ? storedState.applications : []
            return {
              results: applications
                .filter(item => recordLike(item) && item.userId === this.values[0])
                .map(item => ({ payload: JSON.stringify(item) })),
            }
          }
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
    batchCalls: [] as number[],
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      this.batchCalls.push(statements.length)
      const results = []
      for (const statement of statements)
        results.push(await statement.run())
      return results
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
    retentionExpiresAt: `${dateKeyOffset(30)}T00:00:00.000Z`,
    createdAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('welfare state security', () => {
  it('rejects forged attachment metadata that points at another user upload', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user({ id: 'user_a' }), user({ id: 'user_b' })],
      applications: [
        codeApplication({
          id: 'app_b',
          userId: 'user_b',
          attachments: [{
            id: 'att_forged',
            name: 'forged.png',
            size: 4,
            type: 'image/png',
            r2Key: 'user-uploads/user_a/att_real.png',
            url: '/api/uploads/att_forged/file',
          }],
        }),
      ],
    })
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
      AI_ASSETS: {
        async get(key: string) {
          return key === 'user-uploads/user_a/att_real.png'
            ? new Response('real', { headers: { 'content-type': 'image/png' } })
            : null
        },
      } as unknown as R2Bucket,
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_b')

    const response = await handleUploadRequest(new Request('https://example.com/api/uploads/att_forged/file', {
      headers: { cookie },
    }), env)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: '无权读取该图片' })
  })

  it('initializes the welfare schema once per D1 binding', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    await readWelfareState(env)
    await readWelfareState(env)

    const schemaQueries = d1.queries.filter(item => item.method === 'run' && item.query.includes('create table if not exists welfare_app_state'))
    expect(schemaQueries).toHaveLength(1)
  })

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

  it('allows admin password login through explicit session endpoint', async () => {
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

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/session/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@welfare.dev', password: 'admin-password' }),
    }), env)

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('tg_welfare_session=')
    await expect(response.json()).resolves.toMatchObject({ ok: true, userId: 'admin_1', state: { currentUserId: 'admin_1' } })
  })

  it('syncs welfare snapshots through one D1 batch', async () => {
    const d1 = createMemoryD1({
      ...state(),
      applications: [
        codeApplication({ id: 'app_1' }),
        codeApplication({ id: 'app_2', title: '第二个申请' }),
      ],
      coupons: [
        {
          id: 'coupon_1',
          userId: 'user_1',
          name: '测试券',
          scope: 'all',
          discountType: 'rate',
          discountRate: 0.9,
          createdAt: '2026-06-03T00:00:00.000Z',
        },
      ],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    await writeWelfareState(env, await readWelfareState(env))

    expect(d1.batchCalls).toContain(3)
  })

  it('hides delivery answer and internal messages before a reviewer claims the application', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user({ role: 'reviewer' }), user({ id: 'user_2' })],
      applications: [
        codeApplication({
          id: 'app_1',
          userId: 'user_2',
          status: 'answered',
          answer: '<p>内部交付答案</p>',
          messages: [
            {
              id: 'msg_system',
              applicationId: 'app_1',
              userId: 'admin_1',
              type: 'system',
              content: '<p>内部系统说明</p>',
              attachments: [],
              createdAt: '2026-06-02T01:00:00.000Z',
            },
            {
              id: 'msg_result',
              applicationId: 'app_1',
              userId: 'user_2',
              type: 'result_submission',
              content: '<p>交付提交内容</p>',
              attachments: [],
              createdAt: '2026-06-02T02:00:00.000Z',
            },
          ],
        }),
      ],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/me', {
      headers: { cookie },
    }), env)
    const payload = await response.json() as { state: WelfareState }
    const application = payload.state.applications.find(item => item.id === 'app_1')

    expect(response.status).toBe(200)
    expect(application?.answer).toBeUndefined()
    expect(application?.messages ?? []).toHaveLength(0)
  })

  it('deletes stale welfare snapshots when action commits remove applications or coupons', async () => {
    const previous = {
      ...state(),
      applications: [
        codeApplication({ id: 'app_deleted', userId: 'user_1' }),
        codeApplication({ id: 'app_kept', userId: 'user_1' }),
      ],
      coupons: [
        {
          id: 'coupon_deleted',
          userId: 'user_1',
          name: '过期券',
          scope: 'all' as const,
          discountType: 'rate' as const,
          discountRate: 0.8,
          createdAt: '2026-06-02T00:00:00.000Z',
        },
        {
          id: 'coupon_kept',
          userId: 'user_1',
          name: '保留券',
          scope: 'all' as const,
          discountType: 'rate' as const,
          discountRate: 0.9,
          createdAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    }
    const next = {
      ...previous,
      applications: previous.applications.filter(item => item.id !== 'app_deleted'),
      coupons: previous.coupons.filter(item => item.id !== 'coupon_deleted'),
    }
    const d1 = createMemoryD1(previous)
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    await writeWelfareState(env, next, { expectedVersion: 1, previousState: previous })

    expect(d1.queries.some(item => item.query.includes('delete from welfare_applications') && item.values[0] === 'app_deleted')).toBe(true)
    expect(d1.queries.some(item => item.query.includes('delete from user_coupons') && item.values[0] === 'coupon_deleted')).toBe(true)
    expect(d1.queries.some(item => item.query.includes('delete from welfare_applications') && item.values[0] === 'app_kept')).toBe(false)
    expect(d1.queries.some(item => item.query.includes('delete from user_coupons') && item.values[0] === 'coupon_kept')).toBe(false)
  })

  it('syncs only changed welfare snapshots for action commits', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user({ role: 'reviewer' }), user({ id: 'user_2' })],
      applications: [
        codeApplication({ id: 'app_1', userId: 'user_2', status: 'answered', answer: '可认领' }),
        codeApplication({ id: 'app_2', userId: 'user_2', status: 'answered', answer: '不变' }),
      ],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/deliveries/claim', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'app_1' }),
    }), env)

    expect(response.status).toBe(200)
    expect(d1.batchCalls.at(-1)).toBe(1)
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

  it('syncs only the current admin balance for admin state reads', async () => {
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
    expect(payload.state.users.find(item => item.id === 'user_42')?.points).toBe(1000)

    const balanceQueries = d1.queries.filter(item => item.method === 'all' && item.query.includes('from point_transactions'))
    expect(balanceQueries).toHaveLength(1)
    expect(balanceQueries[0].values).toEqual(['admin_1'])
  })

  it('credits replayed recharge notifications only once', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    d1.rechargeOrders.push({
      out_trade_no: 'TGW_TEST_ORDER',
      user_id: 'user_1',
      amount: '2.00',
      credited_points: 20,
      status: 'pending',
      payment_type: 'epay',
      order_name: '测试充值',
    })
    const params = new URLSearchParams({
      pid: 'pid_1',
      type: 'epay',
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: 'TGW_TEST_ORDER',
      money: '2.00',
      trade_no: 'LDC_TEST_TRADE',
      sign_type: 'MD5',
    })
    params.set('sign', createEpaySign(Object.fromEntries(params.entries()), 'secret_1'))

    const notifyUrl = `https://example.com/api/recharge/notify?${params.toString()}`
    const first = await handleRechargeRequest(new Request(notifyUrl), env)
    const second = await handleRechargeRequest(new Request(notifyUrl), env)

    expect(await first.text()).toBe('success')
    expect(await second.text()).toBe('success')
    expect(d1.pointTransactions).toHaveLength(1)
    expect(d1.pointTransactions[0]).toMatchObject({
      id: 'srv_recharge_TGW_TEST_ORDER',
      user_id: 'user_1',
      delta: 20,
      type: 'recharge',
      ref_id: 'TGW_TEST_ORDER',
    })
    expect(d1.rechargeOrders[0].status).toBe('succeeded')
  })

  it('rejects non-admin full-state PUT', async () => {
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

    expect(response.status).toBe(403)

    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.users[0].role).toBe('user')
    expect(payload.state.users[0].points).toBe(1000)
  })

  it('requires matching version for admin full-state PUT', async () => {
    const admin = user({ id: 'admin_1', role: 'admin' })
    const d1 = createMemoryD1({ ...state(), users: [admin] })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const currentResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/admin', {
      headers: { cookie },
    }), env)
    const current = await currentResponse.json() as { state: WelfareState, version: number }

    const first = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'PUT',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: current.version,
        state: {
          ...current.state,
          siteBanner: { enabled: true, title: '公告', body: '请留意' },
        },
      }),
    }), env)
    expect(first.status).toBe(200)

    const second = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'PUT',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: current.version,
        state: {
          ...current.state,
          siteBanner: { enabled: true, title: '过期公告', body: '不应覆盖' },
        },
      }),
    }), env)
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({ code: 'STATE_VERSION_CONFLICT' })
  })

  it('returns the next state version from collaboration actions', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-welfare-action': 'submit-collaboration-application',
      },
      body: JSON.stringify({
        reason: '<p>我可以长期协助处理公益申请，熟悉项目交付和用户沟通流程。</p>',
      }),
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: 2 })
  })

  it('rejects D1 conditional writes when state changes between version check and update', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    d1.bumpVersionAfterNextVersionRead()

    await expect(writeWelfareState(env, {
      ...state(),
      siteBanner: { enabled: true, title: '并发公告', body: '不应覆盖较新状态' },
    }, { expectedVersion: 1 })).rejects.toThrow('业务状态已被其他请求更新')

    expect(d1.queries.some(item =>
      item.query.includes('update welfare_app_state')
      && item.values[3] === 1,
    )).toBe(true)
  })

  it('uses state version checks when standalone point writes update balances', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    d1.bumpVersionAfterNextVersionRead()

    await expect(appendPointTransaction(env, {
      userId: 'user_1',
      delta: 10,
      type: 'grant',
      reason: '并发积分发放',
    })).rejects.toThrow('业务状态已被其他请求更新')

    expect(d1.queries.some(item =>
      item.query.includes('update welfare_app_state')
      && item.values[3] === 1,
    )).toBe(true)
  })

  it('keeps deterministic point transactions idempotent after a state write conflict', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const txId = pointTransactionId('race_grant', 'app_1')

    d1.bumpVersionAfterNextVersionRead()

    await expect(appendPointTransaction(env, {
      id: txId,
      userId: 'user_1',
      delta: 10,
      type: 'grant',
      reason: '并发后重试发放',
      refId: 'app_1',
      createdAt: '2026-06-08T00:00:00.000Z',
    })).rejects.toThrow('业务状态已被其他请求更新')

    await appendPointTransaction(env, {
      id: txId,
      userId: 'user_1',
      delta: 10,
      type: 'grant',
      reason: '并发后重试发放',
      refId: 'app_1',
      createdAt: '2026-06-08T00:00:00.000Z',
    })

    expect(d1.pointTransactions.filter(item => item.id === txId)).toHaveLength(1)
    const latestState = await readWelfareState(env) as WelfareState
    expect(latestState.users.find(item => item.id === 'user_1')?.points).toBe(1010)
  })

  it('submits applications through command API and ignores forged client fields', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user({ points: 2000 })],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleApplicationSubmitRequest(new Request('https://example.com/api/applications/submit', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'image',
        title: '图片申请',
        description: '<p>这是一个说明足够长的图片申请。</p>',
        userId: 'admin_1',
        status: 'approved',
        cost: 0,
        transactions: [{ id: 'tx_forged', delta: 999999 }],
      }),
    }), env)

    expect(response.status).toBe(200)
    expect(d1.pointTransactions).toHaveLength(1)
    expect(Number(d1.pointTransactions[0].delta)).toBeLessThan(0)

    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/me', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.applications).toHaveLength(1)
    expect(payload.state.applications[0]).toMatchObject({
      userId: 'user_1',
      type: 'image',
      status: 'pending_review',
      costCharged: true,
    })
    expect(payload.state.transactions).toEqual([])
    expect(d1.queries.some(item => item.query.includes('insert into welfare_applications') && item.values[0] === payload.state.applications[0].id)).toBe(true)
  })

  it('appends point transactions from the latest ledger balance', async () => {
    const d1 = createMemoryD1(state())
    d1.pointTransactions.push({
      id: 'tx_existing_balance',
      user_id: 'user_1',
      delta: 800,
      type: 'recharge',
      reason: '历史充值',
      ref_id: 'recharge_existing',
      balance_after: 800,
      created_at: '2026-06-07T00:00:00.000Z',
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }

    await appendPointTransaction(env, {
      id: 'tx_after_ledger',
      userId: 'user_1',
      delta: 10,
      type: 'grant',
      reason: '助力奖励',
      refId: 'boost_1',
      createdAt: '2026-06-07T01:00:00.000Z',
    })

    expect(d1.pointTransactions.at(-1)).toMatchObject({
      id: 'tx_after_ledger',
      balance_after: 810,
    })
    const latest = await readWelfareState(env) as WelfareState
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(810)
  })

  it('does not write square boost point transactions when the state write loses CAS', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user({ id: 'owner_1' }), user({ id: 'user_1', points: 1000 })],
      squarePosts: [{
        id: 'post_1',
        userId: 'owner_1',
        type: 'review',
        title: '公益方向',
        content: '<p>这个公益方向值得长期支持和维护。</p>',
        createdAt: '2026-06-07T00:00:00.000Z',
        updatedAt: '2026-06-07T00:00:00.000Z',
      }],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    d1.bumpVersionAfterNextVersionRead()

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/square/boosts', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        postId: 'post_1',
        declaration: '<p>我认可这个公益方向，愿意支持它继续帮助更多项目降低协作和资源成本。</p>',
      }),
    }), env)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'STATE_VERSION_CONFLICT' })
    expect(d1.pointTransactions).toHaveLength(0)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.squareBoosts).toHaveLength(0)
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000)
  })

  it('does not write student review point transactions when the state write loses CAS', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    d1.bumpVersionAfterNextVersionRead()

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientRequestId: 'student-race-1',
        verificationType: 'student',
        realName: '测试用户',
        category: '高校学生',
        school: '测试大学',
        notes: '<p>学生认证材料说明足够长。</p>',
        attachments: [],
      }),
    }), env)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'STATE_VERSION_CONFLICT' })
    expect(d1.pointTransactions).toHaveLength(0)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.studentVerifications).toHaveLength(0)
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000)
  })

  it('requires an idempotency key for student verification charges', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        verificationType: 'student',
        realName: '测试用户',
        category: '高校学生',
        school: '测试大学',
        notes: '<p>学生认证材料说明足够长。</p>',
        attachments: [],
      }),
    }), env)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: '提交认证缺少幂等请求 ID，请刷新后重试' })
    expect(d1.pointTransactions).toHaveLength(0)
  })

  it('keeps student verification submission idempotent for the same client request', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')
    const body = {
      clientRequestId: 'student-submit-1',
      verificationType: 'student',
      realName: '测试用户',
      category: '高校学生',
      school: '测试大学',
      notes: '<p>学生认证材料说明足够长。</p>',
      attachments: [],
    }

    const first = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env)
    const second = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstPayload = await first.json() as { verificationId: string }
    const secondPayload = await second.json() as { verificationId: string }
    expect(secondPayload.verificationId).toBe(firstPayload.verificationId)
    expect(d1.pointTransactions).toHaveLength(1)
    expect(d1.pointTransactions[0]).toMatchObject({
      id: pointTransactionId('student_review', firstPayload.verificationId),
      user_id: 'user_1',
      delta: -STUDENT_REVIEW_FEE,
      type: 'spend',
      ref_id: firstPayload.verificationId,
    })

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.studentVerifications).toHaveLength(1)
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000 - STUDENT_REVIEW_FEE)
  })

  it('repairs orphaned student review charges without charging again', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')
    const body = {
      clientRequestId: 'student-orphan-charge-1',
      verificationType: 'student',
      realName: '测试用户',
      category: '高校学生',
      school: '测试大学',
      notes: '<p>学生认证材料说明足够长。</p>',
      attachments: [],
    }

    const first = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env)
    expect(first.status).toBe(200)
    const firstPayload = await first.json() as { verificationId: string }
    expect(d1.pointTransactions).toHaveLength(1)

    const orphanedState = await readWelfareState(env) as WelfareState
    orphanedState.studentVerifications = []
    await writeWelfareState(env, orphanedState)

    const retry = await handleWelfareStateRequest(new Request('https://example.com/api/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env)

    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({ verificationId: firstPayload.verificationId })
    expect(d1.pointTransactions).toHaveLength(1)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.studentVerifications).toHaveLength(1)
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000 - STUDENT_REVIEW_FEE)
  })

  it('refunds student review fees atomically and only once on approval', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const normalUser = user({ id: 'user_1', points: 1000 - STUDENT_REVIEW_FEE })
    const verificationId = 'stu_existing'
    const d1 = createMemoryD1({
      ...state(),
      users: [admin, normalUser],
      studentVerifications: [{
        id: verificationId,
        userId: 'user_1',
        verificationType: 'student',
        realName: '测试用户',
        category: '高校学生',
        school: '测试大学',
        notes: '<p>学生认证材料说明。</p>',
        attachments: [],
        status: 'pending',
        reviewFee: STUDENT_REVIEW_FEE,
        feeReturned: false,
        createdAt: '2026-06-08T00:00:00.000Z',
      }],
    })
    d1.pointTransactions.push({
      id: pointTransactionId('student_review', verificationId),
      user_id: 'user_1',
      delta: -STUDENT_REVIEW_FEE,
      type: 'spend',
      reason: '学生认证审核费',
      ref_id: verificationId,
      balance_after: 1000 - STUDENT_REVIEW_FEE,
      created_at: '2026-06-08T00:00:00.000Z',
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')
    const reviewBody = JSON.stringify({ id: verificationId, status: 'approved', reply: '通过' })

    const first = await handleWelfareStateRequest(new Request('https://example.com/api/admin/verifications/student/review', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: reviewBody,
    }), env)
    const second = await handleWelfareStateRequest(new Request('https://example.com/api/admin/verifications/student/review', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: reviewBody,
    }), env)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(d1.pointTransactions.filter(item => item.id === pointTransactionId('student_review_refund', verificationId))).toHaveLength(1)
    const guardedInsert = d1.queries.find(item => item.query.includes('insert into point_transactions') && item.query.includes('mutation_id'))
    expect(guardedInsert?.values[10]).toMatch(/^mut_/)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000)
    expect(latest.users.find(item => item.id === 'user_1')?.profile.studentVerified).toBe(true)
    expect(latest.studentVerifications[0]).toMatchObject({ status: 'approved', feeReturned: true })
  })

  it('absorbs orphaned student refund transactions without refunding twice', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const normalUser = user({ id: 'user_1', points: 1000 - STUDENT_REVIEW_FEE })
    const verificationId = 'stu_orphan_refund'
    const d1 = createMemoryD1({
      ...state(),
      users: [admin, normalUser],
      studentVerifications: [{
        id: verificationId,
        userId: 'user_1',
        verificationType: 'student',
        realName: '测试用户',
        category: '高校学生',
        school: '测试大学',
        notes: '<p>学生认证材料说明。</p>',
        attachments: [],
        status: 'pending',
        reviewFee: STUDENT_REVIEW_FEE,
        feeReturned: false,
        createdAt: '2026-06-08T00:00:00.000Z',
      }],
    })
    d1.pointTransactions.push(
      {
        id: pointTransactionId('student_review', verificationId),
        user_id: 'user_1',
        delta: -STUDENT_REVIEW_FEE,
        type: 'spend',
        reason: '学生认证审核费',
        ref_id: verificationId,
        balance_after: 1000 - STUDENT_REVIEW_FEE,
        created_at: '2026-06-08T00:00:00.000Z',
      },
      {
        id: pointTransactionId('student_review_refund', verificationId),
        user_id: 'user_1',
        delta: STUDENT_REVIEW_FEE,
        type: 'refund',
        reason: '学生认证通过返还审核费',
        ref_id: verificationId,
        balance_after: 1000,
        created_at: '2026-06-08T00:01:00.000Z',
      },
    )
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/admin/verifications/student/review', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: verificationId, status: 'approved', reply: '通过' }),
    }), env)

    expect(response.status).toBe(200)
    expect(d1.pointTransactions.filter(item => item.id === pointTransactionId('student_review_refund', verificationId))).toHaveLength(1)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1000)
    expect(latest.studentVerifications[0]).toMatchObject({ status: 'approved', feeReturned: true })
  })

  it('keeps coupon snapshots when issuing check-in coupons', async () => {
    const d1 = createMemoryD1({
      ...state(),
      dailyCheckIns: [
        { id: 'checkin_2', userId: 'user_1', dateKey: dateKeyOffset(-1), points: 1, streak: 2, createdAt: new Date().toISOString() },
        { id: 'checkin_1', userId: 'user_1', dateKey: dateKeyOffset(-2), points: 1, streak: 1, createdAt: new Date().toISOString() },
      ],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-welfare-action': 'check-in-today',
      },
      body: '{}',
    }), env)

    expect(response.status).toBe(200)
    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state/me', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.coupons).toHaveLength(1)
    expect(d1.queries.some(item => item.query.includes('insert into user_coupons') && item.values[0] === payload.state.coupons[0].id)).toBe(true)
  })

  it('rejects forged non-admin PUT transactions before state merge', async () => {
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

    expect(response.status).toBe(403)
    expect(d1.pointTransactions).toHaveLength(0)

    const stateResponse = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      headers: { cookie },
    }), env)
    const payload = await stateResponse.json() as { state: WelfareState }
    expect(payload.state.users[0].points).toBe(1000)
    expect(payload.state.transactions).toEqual([])
  })

  it('ignores client point transactions during admin full-state saves', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const normalUser = user({ id: 'user_1', points: 1000 })
    const d1 = createMemoryD1({ ...state(), users: [admin, normalUser] })
    d1.pointTransactions.push({
      id: 'tx_existing_balance',
      user_id: 'user_1',
      delta: 50,
      type: 'grant',
      reason: '已有服务端流水',
      ref_id: null,
      balance_after: 1050,
      created_at: '2026-06-08T00:00:00.000Z',
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const currentResponse = await handleWelfareStateRequest(new Request('https://example.com/api/admin/welfare/state', {
      headers: { cookie },
    }), env)
    const current = await currentResponse.json() as { state: WelfareState, version: number }
    const response = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: current.version,
        state: {
          ...current.state,
          siteBanner: { enabled: true, title: '公告', body: '保存业务字段' },
          users: current.state.users.map(item => item.id === 'user_1' ? { ...item, points: 999999 } : item),
          transactions: [{
            id: 'tx_client_forged',
            userId: 'user_1',
            delta: 999999,
            type: 'grant',
            reason: '伪造客户端流水',
            createdAt: '2026-06-08T00:01:00.000Z',
          }],
        },
      }),
    }), env)

    expect(response.status).toBe(200)
    expect(d1.pointTransactions.map(item => item.id)).toEqual(['tx_existing_balance'])

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.siteBanner).toMatchObject({ enabled: true, title: '公告' })
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(1050)
    expect(latest.transactions).toEqual([])
  })

  it('serves segmented current-user read DTOs without leaking hidden users', async () => {
    const d1 = createMemoryD1({
      ...state(),
      users: [user(), user({ id: 'user_2', profile: { displayName: '其他用户', email: 'other@example.com', studentVerified: false } })],
      applications: [codeApplication(), codeApplication({ id: 'app_2', userId: 'user_2', title: '其他人的申请' })],
      coupons: [{ id: 'coupon_1', userId: 'user_1', name: '测试券', discountRate: 0.8, source: 'manual', createdAt: '2026-06-02T00:00:00.000Z' }],
    })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const me = await handleWelfareStateRequest(new Request('https://example.com/api/me', { headers: { cookie } }), env)
    const applications = await handleWelfareStateRequest(new Request('https://example.com/api/applications/mine', { headers: { cookie } }), env)
    const wallet = await handleWelfareStateRequest(new Request('https://example.com/api/wallet/summary', { headers: { cookie } }), env)

    expect(me.status).toBe(200)
    await expect(me.json()).resolves.toMatchObject({ currentUser: { id: 'user_1' }, currentUserId: 'user_1', version: 1 })

    const applicationPayload = await applications.json() as { applications: WelfareApplication[], users: User[] }
    expect(applicationPayload.applications.map(item => item.id)).toEqual(['app_1'])
    expect(applicationPayload.users.map(item => item.id)).toEqual(['user_1'])
    expect(d1.queries.some(item => item.method === 'all' && item.query.includes('select payload from welfare_applications'))).toBe(true)

    const walletPayload = await wallet.json() as { coupons: UserCoupon[], transactions: unknown[] }
    expect(walletPayload.coupons.map(item => item.id)).toEqual(['coupon_1'])
    expect(walletPayload.transactions).toEqual([])
  })

  it('accepts domain check-in actions while keeping the legacy action compatible', async () => {
    const d1 = createMemoryD1(state())
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/check-ins/today', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: 2, checkIn: { userId: 'user_1' } })
    expect(d1.pointTransactions).toHaveLength(1)

    const legacy = await handleWelfareStateRequest(new Request('https://example.com/api/welfare-state', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-welfare-action': 'check-in-today' },
      body: '{}',
    }), env)
    expect(legacy.status).toBe(500)
    await expect(legacy.json()).resolves.toMatchObject({ error: '今日已签到' })
  })

  it('updates admin config through segmented admin endpoints', async () => {
    const admin = user({ id: 'admin_1', role: 'admin' })
    const d1 = createMemoryD1({ ...state(), users: [admin] })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/admin/config/system', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ systemConfig: { siteEnabled: false, siteClosedReason: '维护中' } }),
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, systemConfig: { siteEnabled: false, siteClosedReason: '维护中' }, version: 2 })

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.systemConfig.siteEnabled).toBe(false)
    expect(latest.systemConfig.siteClosedReason).toBe('维护中')
  })

  it('adjusts points through segmented admin user endpoints', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const normalUser = user({ id: 'user_1', points: 100 })
    const d1 = createMemoryD1({ ...state(), users: [admin, normalUser] })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/admin/users/points', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user_1', amount: 25, reason: '测试调整' }),
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: 2 })
    expect(d1.pointTransactions).toHaveLength(1)
    expect(d1.pointTransactions[0]).toMatchObject({ user_id: 'user_1', delta: 25, type: 'adjustment', reason: '测试调整' })

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(125)
  })

  it('lets admins submit student verification materials for a user without charging review fees', async () => {
    const admin = user({ id: 'admin_1', role: 'admin', points: 0 })
    const normalUser = user({ id: 'user_1', points: 100 })
    const d1 = createMemoryD1({ ...state(), users: [admin, normalUser] })
    const env = { LOCAL_DB: d1 as unknown as D1Database, NOTIFY_SECRET_KEY: 'test-secret' }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://example.com/api/admin/verifications/student', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'user_1',
        verificationType: 'student',
        realName: '测试用户',
        category: '大学生',
        school: '测试大学',
        grade: '2026 级',
        educationLevel: '本科',
        notes: '<p>管理员代提交材料</p>',
        attachments: [{ id: 'att_1', name: 'proof.png', size: 128, type: 'image/png', url: '/api/uploads/user_1/proof.png' }],
      }),
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, version: 2 })
    expect(d1.pointTransactions).toHaveLength(0)

    const latest = await readWelfareState(env) as WelfareState
    expect(latest.users.find(item => item.id === 'user_1')?.points).toBe(100)
    expect(latest.studentVerifications).toHaveLength(1)
    expect(latest.studentVerifications[0]).toMatchObject({
      userId: 'user_1',
      status: 'pending',
      reviewFee: 0,
      feeReturned: true,
      realName: '测试用户',
      school: '测试大学',
    })
  })
})
