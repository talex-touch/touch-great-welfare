import type { WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  Response.json({ state: {} }),
))

const { handleAiRequest } = await import('../src/worker/ai')
const { handleSub2ApiRequest } = await import('../src/worker/sub2api')
const { createSessionCookie } = await import('../src/worker/session')
const { handleWelfareStateRequest, readWelfareState } = await import('../src/worker/welfare-state')

function createMemoryD1(state: WelfareState) {
  let appState = state
  let appVersion = 1
  let sub2apiConfig: Record<string, unknown> | null = null
  const bindings: Record<string, unknown>[] = []

  return {
    data: {
      get state() {
        return appState
      },
      set state(value: WelfareState) {
        appState = value
      },
      bindings,
    },
    prepare(query: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values
          return this
        },
        async run() {
          if (query.includes('insert into sub2api_config')) {
            sub2apiConfig = {
              id: 'default',
              enabled: this.values[0],
              base_url: this.values[1],
              admin_api_key_encrypted: this.values[2],
              database_url_encrypted: this.values[3],
              default_group_id: this.values[4],
              default_quota_usd: this.values[5],
              default_expires_in_days: this.values[6],
              default_rate_limit_5h: this.values[7],
              default_rate_limit_1d: this.values[8],
              default_rate_limit_7d: this.values[9],
            }
          }
          if (query.includes('update welfare_app_state')) {
            if (appVersion !== Number(this.values[3]))
              return { meta: { changes: 0 } }
            appState = JSON.parse(String(this.values[1])) as WelfareState
            appVersion = Number(this.values[2])
            return { meta: { changes: 1 } }
          }
          if (query.includes('insert into welfare_app_state')) {
            appState = JSON.parse(String(this.values[1])) as WelfareState
            appVersion = Number(this.values[2])
            return { meta: { changes: 1 } }
          }
          if (query.includes('insert into sub2api_key_bindings')) {
            bindings.push({
              id: this.values[0],
              user_id: this.values[1],
              application_id: this.values[2],
              item_id: this.values[3],
              sub2api_user_id: this.values[4],
              sub2api_key_id: this.values[5],
              key_hash: this.values[6],
              key_masked: this.values[7],
              name: this.values[8],
              quota_usd: this.values[9],
              expires_at: this.values[10],
              status: this.values[11],
            })
          }
          return { meta: { changes: 1 } }
        },
        async first() {
          if (query.includes('select state, version from welfare_app_state'))
            return { state: JSON.stringify(appState), version: appVersion }
          if (query.includes('select version from welfare_app_state'))
            return { version: appVersion }
          if (query.includes('select * from sub2api_config'))
            return sub2apiConfig
          if (query.includes('select * from sub2api_key_bindings')) {
            return bindings.find(item =>
              item.application_id === this.values[0]
              && item.item_id === this.values[1]
              && item.status === this.values[2],
            ) ?? null
          }
          if (query.includes('from point_transactions where id'))
            return null
          return null
        },
        async all() {
          if (query.includes('pragma table_info'))
            return { results: [] }
          if (query.includes('from sub2api_key_bindings'))
            return { results: bindings }
          return { results: [] }
        },
      }
    },
  }
}

function createState(): WelfareState {
  const createdAt = '2026-06-08T00:00:00.000Z'
  const retentionExpiresAt = '2099-01-01T00:00:00.000Z'
  return {
    users: [
      {
        id: 'admin_1',
        role: 'admin',
        points: 0,
        profile: { displayName: '管理员', email: 'admin@example.com', studentVerified: false },
        createdAt,
        lastLoginAt: createdAt,
      },
      {
        id: 'user_1',
        role: 'user',
        points: 100,
        profile: { displayName: '申请人', email: 'user@example.com', studentVerified: false },
        createdAt,
        lastLoginAt: createdAt,
      },
    ],
    oauth: {
      enabled: true,
      provider: 'github',
      clientId: 'client',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      callbackUrl: 'https://welfare.example.com/callback',
      scopes: 'read:user',
    },
    applications: [{
      id: 'app_1',
      userId: 'user_1',
      type: 'resource',
      title: 'LLM 额度申请',
      description: '用于自动发放测试',
      hasOpenSourceBadge: false,
      attachments: [],
      status: 'in_review',
      baseCost: 0,
      cost: 0,
      costCharged: true,
      aiReviewFeeRate: 0,
      rejectionReviewFee: 0,
      rejectionReviewFeeWaived: false,
      rejectionFraudulent: false,
      storageExtended: false,
      storageExtensionCost: 0,
      retentionExpiresAt,
      standardProcessingHours: 24,
      processingDueAt: createdAt,
      contextAppendUntil: createdAt,
      reason: '测试自动发放',
      businessBackground: '测试',
      selectedResourceTypes: ['llm_api_quota'],
      resourceItems: [{
        id: 'item_1',
        applicationId: 'app_1',
        resourceType: 'llm_api_quota',
        resourceSubtype: 'codex',
        payload: {
          model: 'codex',
          budgetLimit: 10,
          duration: '7 天',
          rpmLimit: 2,
          tpmLimit: 10000,
          usageScenario: '测试',
        },
        approvedPayload: {
          budgetLimit: 25,
          expiresInDays: 14,
          groupId: 7,
          rateLimit5h: 1.5,
          ipWhitelist: ['203.0.113.0/24'],
          maxActiveIps: 1,
          maxConcurrency: 2,
        },
        requestedQuota: '$10',
        duration: '7 天',
        approverGroup: 'AI 平台/成本负责人',
        approvalStatus: 'adjusted_approved',
        provisionStatus: 'pending',
        createdAt,
        updatedAt: createdAt,
      }],
      messages: [],
      transactions: [],
      studentVerificationRequired: false,
      createdAt,
    }],
    applicationPolicy: {
      minDescriptionChars: 1,
      submitCooldownSeconds: 0,
      powEnabled: false,
      powDifficulty: 3,
      turnstileEnabled: false,
      turnstileSiteKey: '',
      turnstileSecretKey: '',
      categories: {
        code: { enabled: true, dailyLimit: 30, perUserDailyLimit: 3, openStart: '', openEnd: '', closedReason: '' },
        image: { enabled: true, dailyLimit: 30, perUserDailyLimit: 3, openStart: '', openEnd: '', closedReason: '' },
        pro: { enabled: true, dailyLimit: 30, perUserDailyLimit: 3, openStart: '', openEnd: '', closedReason: '' },
        resource: { enabled: true, dailyLimit: 30, perUserDailyLimit: 3, openStart: '', openEnd: '', closedReason: '' },
      },
    },
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
    createdAt,
  }
}

describe('ai application review security', () => {
  it('does not persist AI review results when requested by the application owner', async () => {
    const currentState = createState()
    currentState.applications[0] = {
      ...currentState.applications[0],
      type: 'pro',
      status: 'pending_review',
      answer: undefined,
      aiReview: undefined,
    }
    const d1 = createMemoryD1(currentState)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-ai-review',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-ai-review',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'user_1')

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/reviews', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'app_1' }),
    }), env)

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({ applicationId: 'app_1', persisted: false })
    const updatedState = await readWelfareState(env) as WelfareState
    expect(updatedState.applications[0].aiReview).toBeUndefined()
    expect(updatedState.applications[0].answer).toBeUndefined()
  })
})

describe('sub2api resource provisioning', () => {
  it('rejects direct Sub2API key creation by regular users', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'user_1')

    const response = await handleSub2ApiRequest(new Request('https://welfare.example.com/api/sub2api/keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bypass', quotaUsd: 100000, expiresInDays: 365 }),
    }), env)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: '需要管理员权限' })
    expect(d1.data.bindings).toHaveLength(0)
  })

  it('enqueues resource provisioning when async jobs are configured', async () => {
    const d1 = createMemoryD1(createState())
    const jobs: unknown[] = []
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
      ASYNC_JOBS: {
        send: async (job: unknown) => {
          jobs.push(job)
        },
      } as unknown as Queue<unknown>,
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('external Sub2API should not be called during enqueue')
    }))

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)
    const result = await response.json() as { status: string }

    expect(response.ok).toBe(true)
    expect(result.status).toBe('pending')
    expect(jobs).toEqual([{ type: 'resource.provision', applicationId: 'app_1', adminUserId: 'admin_1', itemId: 'item_1' }])
    expect(d1.data.bindings).toHaveLength(0)
  })

  it('passes approved LLM resource limits to the Sub2API admin create endpoint', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')
    let createKeyBody: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/admin/users?')) {
        return Response.json({ data: { items: [{ id: 42, email: 'user@example.com' }] } })
      }
      if (url.endsWith('/api/v1/admin/users/42/api-keys')) {
        createKeyBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          data: {
            id: 99,
            key: 'sk-test-created',
            name: createKeyBody.name,
            status: 'active',
            quota: createKeyBody.quota,
            expires_at: '2026-06-22T00:00:00.000Z',
          },
        })
      }
      return Response.json({ message: 'not found' }, { status: 404 })
    }))

    await handleSub2ApiRequest(new Request('https://welfare.example.com/api/sub2api/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        baseUrl: 'https://sub2api.example.com',
        adminApiKey: 'admin-key',
        clearDatabaseUrl: true,
        defaultQuotaUsd: 10,
        defaultExpiresInDays: 30,
        defaultRateLimit5h: 0,
        defaultRateLimit1d: 0,
        defaultRateLimit7d: 0,
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)
    const result = await response.json() as { status: string }

    expect(response.ok).toBe(true)
    expect(result.status).toBe('provisioned')
    expect(createKeyBody).toMatchObject({
      name: 'TGW app_1-item_1',
      group_id: 7,
      quota: 25,
      expires_in_days: 14,
      rate_limit_5h: 1.5,
      ip_whitelist: ['203.0.113.0/24'],
      ip_blacklist: [],
      max_active_ips: 1,
      max_concurrency: 2,
    })
    const updatedState = await readWelfareState(env) as WelfareState
    expect(d1.data.bindings).toHaveLength(1)
    expect(d1.data.bindings[0]).toMatchObject({
      application_id: 'app_1',
      item_id: 'item_1',
    })
    expect(updatedState.applications[0].status).toBe('delivered')
    expect(updatedState.applications[0].answer).toContain('sk-test-created')
    expect(updatedState.applications[0].resourceItems?.[0].provisionStatus).toBe('completed')
  })

  it('reuses an existing Sub2API resource binding when resource state is retried', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')
    let createKeyCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v1/admin/users?'))
        return Response.json({ data: { items: [{ id: 42, email: 'user@example.com' }] } })
      if (url.endsWith('/api/v1/admin/users/42/api-keys')) {
        createKeyCalls += 1
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        return Response.json({
          data: {
            id: 99,
            key: 'sk-test-created',
            name: body.name,
            status: 'active',
            quota: body.quota,
            expires_at: '2026-06-22T00:00:00.000Z',
          },
        })
      }
      return Response.json({ message: 'not found' }, { status: 404 })
    }))

    await handleSub2ApiRequest(new Request('https://welfare.example.com/api/sub2api/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        baseUrl: 'https://sub2api.example.com',
        adminApiKey: 'admin-key',
        clearDatabaseUrl: true,
        defaultQuotaUsd: 10,
        defaultExpiresInDays: 30,
        defaultRateLimit5h: 0,
        defaultRateLimit1d: 0,
        defaultRateLimit7d: 0,
      }),
    }), env)

    const first = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)
    expect(first.ok).toBe(true)

    const state = await readWelfareState(env) as WelfareState
    state.applications[0].resourceItems![0].provisionStatus = 'pending'
    d1.data.state = state

    const retry = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)
    const retryResult = await retry.json() as { items: Array<{ key: { reused?: boolean, key?: string } }> }

    expect(retry.ok).toBe(true)
    expect(createKeyCalls).toBe(1)
    expect(d1.data.bindings).toHaveLength(1)
    expect(retryResult.items[0].key.reused).toBe(true)
    expect(retryResult.items[0].key.key).toBeUndefined()
  })

  it('treats non-JSON 404 responses as unsupported admin key endpoints', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/admin/users?'))
        return Response.json({ data: { items: [{ id: 42, email: 'user@example.com' }] } })
      if (url.endsWith('/api/v1/admin/users/42/api-keys')) {
        return new Response('missing route', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        })
      }
      return Response.json({ message: 'not found' }, { status: 404 })
    }))

    await handleSub2ApiRequest(new Request('https://welfare.example.com/api/sub2api/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        baseUrl: 'https://sub2api.example.com',
        adminApiKey: 'admin-key',
        clearDatabaseUrl: true,
        defaultQuotaUsd: 10,
        defaultExpiresInDays: 30,
        defaultRateLimit5h: 0,
        defaultRateLimit1d: 0,
        defaultRateLimit7d: 0,
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)
    const result = await response.json() as { status: string, error: string }

    expect(response.ok).toBe(true)
    expect(result).toMatchObject({
      status: 'pending_manual',
      error: 'Sub2API Admin API 不支持创建 API Key，且数据库连接未配置',
    })
    const updatedState = await readWelfareState(env) as WelfareState
    expect(updatedState.applications[0].status).toBe('pending_allocation')
    expect(updatedState.applications[0].resourceItems?.[0].provisionStatus).toBe('pending')
    expect(updatedState.applications[0].resourceItems?.[0].provisionNote).toContain('Sub2API Admin API 不支持创建 API Key')
  })

  it('lets admins complete pending manual allocation with a structured resource form', async () => {
    const currentState = createState()
    currentState.applications[0].status = 'pending_allocation'
    const d1 = createMemoryD1(currentState)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-sub2api',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-sub2api',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    const response = await handleWelfareStateRequest(new Request('https://welfare.example.com/api/admin/applications/complete-allocation', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        applicationId: 'app_1',
        resourceName: 'Codex 订阅',
        resourceType: 'subscription',
        accessUrl: 'https://sub.example.com/token',
        credential: 'sub-token-1',
        expiresAt: '2026-07-01',
        note: '仅限本人使用',
      }),
    }), env)

    expect(response.ok).toBe(true)
    const updatedState = await readWelfareState(env) as WelfareState
    expect(updatedState.applications[0].status).toBe('delivered')
    expect(updatedState.applications[0].allocationPayload).toMatchObject({
      resourceName: 'Codex 订阅',
      resourceType: 'subscription',
      credential: 'sub-token-1',
    })
    expect(updatedState.applications[0].messages?.at(-1)?.content).toContain('管理员已完成资源发放')
  })
})
