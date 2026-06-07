import type { WelfareState } from '../src/composables/welfare'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const poolQueries: Array<{ sql: string, values?: unknown[] }> = []

vi.mock('pg', () => {
  return {
    Pool: class MockPool {
      async query(sql: string, values?: unknown[]) {
        poolQueries.push({ sql, values })
        if (sql.includes('from pg_database'))
          return { rowCount: 0, rows: [] }
        if (sql.includes('from pg_roles'))
          return { rowCount: 0, rows: [] }
        return { rowCount: 1, rows: [] }
      }

      async end() {}
    },
  }
})

vi.stubGlobal('fetch', vi.fn(async () =>
  Response.json({ state: {} }),
))

const { handleAiRequest } = await import('../src/worker/ai')
const { handleDatabaseProvisionRequest } = await import('../src/worker/database-provisioning')
const { createSessionCookie } = await import('../src/worker/session')
const { readWelfareState } = await import('../src/worker/welfare-state')

function createMemoryD1(state: WelfareState) {
  let appState = state
  let appVersion = 1
  let databaseConfig: Record<string, unknown> | null = null
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
          if (query.includes('insert into database_provision_config')) {
            databaseConfig = {
              id: 'default',
              enabled: this.values[0],
              root_url_encrypted: this.values[1],
              default_expires_in_days: this.values[2],
              database_prefix: this.values[3],
              onepanel_base_url: this.values[4],
              onepanel_api_key_encrypted: this.values[5],
            }
          }
          if (query.includes('insert into database_resource_bindings')) {
            bindings.push({
              id: this.values[0],
              user_id: this.values[1],
              application_id: this.values[2],
              item_id: this.values[3],
              database_type: this.values[4],
              database_name: this.values[5],
              username: this.values[6],
              password_hash: this.values[7],
              connection_url_encrypted: this.values[8],
              connection_url_masked: this.values[9],
              permission: this.values[10],
              expires_at: this.values[11],
              status: 'active',
            })
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
          return { meta: { changes: 1 } }
        },
        async first() {
          if (query.includes('select state, version from welfare_app_state'))
            return { state: JSON.stringify(appState), version: appVersion }
          if (query.includes('select version from welfare_app_state'))
            return { version: appVersion }
          if (query.includes('select * from database_provision_config'))
            return databaseConfig
          if (query.includes('select * from database_resource_bindings')) {
            return bindings.find(item =>
              item.application_id === this.values[0]
              && item.item_id === this.values[1]
              && item.status === 'active',
            ) ?? null
          }
          if (query.includes('from point_transactions where id'))
            return null
          return null
        },
        async all() {
          if (query.includes('pragma table_info'))
            return { results: [] }
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
        accountStatus: 'active',
        createdAt,
        lastLoginAt: createdAt,
      },
      {
        id: 'user_1',
        role: 'user',
        points: 100,
        profile: { displayName: '申请人', email: 'user@example.com', studentVerified: false },
        accountStatus: 'active',
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
      title: '数据库申请',
      description: '用于自动发放测试',
      hasOpenSourceBadge: false,
      attachments: [],
      status: 'approved',
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
      selectedResourceTypes: ['database'],
      resourceItems: [{
        id: 'item_1',
        applicationId: 'app_1',
        resourceType: 'database',
        resourceSubtype: 'postgresql',
        payload: {
          name: 'orders_prod',
          environment: 'dev',
          permission: 'readonly',
          operationScope: '只读查询订单统计',
          duration: '7 天',
        },
        approvedPayload: {
          databaseName: 'approved_orders',
          username: 'approved_reader',
          permission: 'readwrite',
          expiresInDays: 14,
        },
        requestedPermission: 'readonly',
        duration: '7 天',
        approverGroup: 'DBA',
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

describe('database resource provisioning', () => {
  beforeEach(() => {
    poolQueries.length = 0
  })

  it('creates a PostgreSQL database binding for approved database resource items', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    const configResponse = await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
      }),
    }), env)
    expect(configResponse.ok).toBe(true)

    const provisionResponse = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)

    expect(provisionResponse.ok).toBe(true)
    const result = await provisionResponse.json() as {
      status: string
      provider: string
      items: Array<{ provider: string, database: { databaseName: string, username: string, password: string, connectionUrl: string } }>
    }
    expect(result.status).toBe('provisioned')
    expect(result.provider).toBe('resource')
    expect(result.items[0].provider).toBe('database')
    expect(result.items[0].database).toMatchObject({
      databaseName: 'approved_orders',
      username: 'approved_reader',
    })
    expect(result.items[0].database.password).toBeTruthy()
    expect(result.items[0].database.connectionUrl).toContain('approved_reader')

    expect(poolQueries.some(item => item.sql.includes('create database "approved_orders"'))).toBe(true)
    expect(poolQueries.some(item => item.sql.includes('create role "approved_reader"'))).toBe(true)
    expect(poolQueries.some(item => item.sql.includes('grant insert, update, delete'))).toBe(true)
    expect(d1.data.bindings).toHaveLength(1)
    expect(d1.data.bindings[0]).toMatchObject({
      user_id: 'user_1',
      application_id: 'app_1',
      item_id: 'item_1',
      database_type: 'postgresql',
      database_name: 'approved_orders',
      username: 'approved_reader',
      permission: 'readwrite',
      status: 'active',
    })

    const updatedState = await readWelfareState(env)
    const resourceItem = updatedState.applications[0].resourceItems?.[0]
    expect(resourceItem?.provisionStatus).toBe('completed')
    expect(resourceItem?.provisionNote).toContain('approved_orders')
    expect(resourceItem?.provisionNote).toContain('postgresql://approved_reader:****@db.example.com')
    expect(resourceItem?.provisionNote).not.toContain(result.items[0].database.password)

    updatedState.applications[0].resourceItems![0].provisionStatus = 'pending'
    d1.data.state = updatedState
    poolQueries.length = 0

    const retryResponse = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)

    expect(retryResponse.ok).toBe(true)
    const retryResult = await retryResponse.json() as {
      status: string
      items: Array<{ provider: string, database: { reused?: boolean, password?: string, connectionUrl?: string } }>
    }
    expect(retryResult.status).toBe('provisioned')
    expect(retryResult.items[0].database.reused).toBe(true)
    expect(retryResult.items[0].database.password).toBeUndefined()
    expect(retryResult.items[0].database.connectionUrl).toBeUndefined()
    expect(poolQueries).toHaveLength(0)
    expect(d1.data.bindings).toHaveLength(1)
    const retryState = await readWelfareState(env)
    expect(retryState.applications[0].resourceItems?.[0].provisionNote).toContain('明文密码不再返回')
  })
})
