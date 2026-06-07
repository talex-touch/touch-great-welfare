import type { WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  Response.json({ state: {} }),
))

const { handleAiRequest } = await import('../src/worker/ai')
const { handleSub2ApiRequest } = await import('../src/worker/sub2api')
const { createSessionCookie } = await import('../src/worker/session')
const { readWelfareState } = await import('../src/worker/welfare-state')

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
              sub2api_user_id: this.values[2],
              sub2api_key_id: this.values[3],
              key_hash: this.values[4],
              key_masked: this.values[5],
              name: this.values[6],
              quota_usd: this.values[7],
              expires_at: this.values[8],
              status: this.values[9],
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
      retentionExpiresAt: createdAt,
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

describe('sub2api resource provisioning', () => {
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
    expect(updatedState.applications[0].resourceItems?.[0].provisionStatus).toBe('completed')
  })
})
