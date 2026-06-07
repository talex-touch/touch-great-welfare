import type { WelfareState } from '../src/composables/welfare'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const poolQueries: Array<{ sql: string, values?: unknown[] }> = []
let onAdvisoryLock: (() => void) | undefined

vi.mock('pg', () => {
  return {
    Pool: class MockPool {
      async query(sql: string, values?: unknown[]) {
        poolQueries.push({ sql, values })
        if (sql.includes('pg_advisory_lock'))
          onAdvisoryLock?.()
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
const { createDatabaseForResourceItem, handleDatabaseProvisionRequest } = await import('../src/worker/database-provisioning')
const { md5Hex } = await import('../src/worker/ldc-credit')
const { createSessionCookie } = await import('../src/worker/session')
const { readWelfareState } = await import('../src/worker/welfare-state')

function createMemoryD1(state: WelfareState) {
  let appState = state
  let appVersion = 1
  let databaseConfig: Record<string, unknown> | null = null
  const bindings: Record<string, unknown>[] = []
  const data = {
    get state() {
      return appState
    },
    set state(value: WelfareState) {
      appState = value
    },
    bindings,
    conflictAfterNextBindingInsert: false,
  }

  return {
    data,
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
            if (data.conflictAfterNextBindingInsert) {
              data.conflictAfterNextBindingInsert = false
              appVersion += 1
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
    onAdvisoryLock = undefined
    vi.mocked(fetch).mockImplementation(async () => Response.json({ state: {} }))
  })

  it('reads OnePanel status snapshots with signed API key headers', async () => {
    const d1 = createMemoryD1(createState())
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')
    const calls: Array<{ url: string, init?: RequestInit }> = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init })
      const url = new URL(String(input))
      return Response.json({ code: 200, data: { path: url.pathname } })
    })

    const configResponse = await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
        onePanelBaseUrl: 'https://panel.example.com/',
        onePanelApiKey: 'op_test_key',
      }),
    }), env)
    expect(configResponse.ok).toBe(true)

    const statusResponse = await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/onepanel-status', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }), env)

    expect(statusResponse.ok).toBe(true)
    const snapshot = await statusResponse.json() as {
      ok: boolean
      baseUrl: string
      endpoints: Array<{ ok: boolean, path: string, data: { data: { path: string } } }>
    }
    expect(snapshot.ok).toBe(true)
    expect(snapshot.baseUrl).toBe('https://panel.example.com')
    expect(snapshot.endpoints).toHaveLength(3)
    expect(snapshot.endpoints.every(item => item.ok)).toBe(true)
    expect(calls.map(item => new URL(item.url).pathname)).toEqual([
      '/api/v2/toolbox/device/base',
      '/api/v1/dashboard/base/os',
      '/api/v1/dashboard/current',
    ])

    const firstHeaders = new Headers(calls[0].init?.headers as HeadersInit)
    const timestamp = firstHeaders.get('1Panel-Timestamp') || ''
    expect(timestamp).toBeTruthy()
    expect(firstHeaders.get('1Panel-Token')).toBe(md5Hex(`1Panelop_test_key${timestamp}`))
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
    expect(poolQueries.some(item => item.sql.includes('grant create on schema public to "approved_reader"'))).toBe(true)
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

  it('generates distinct default names for multiple items with long user ids', async () => {
    const state = createState()
    const longUserId = 'user_with_a_very_long_identifier_that_would_hide_item_id_when_truncated'
    const user = state.users[1]!
    const application = state.applications[0]!
    const firstItem = application.resourceItems![0]!

    user.id = longUserId
    application.userId = longUserId
    delete firstItem.approvedPayload
    firstItem.requestedPermission = 'readonly'
    firstItem.payload = {
      name: 'analytics',
      environment: 'dev',
      permission: 'readonly',
      operationScope: '读取统计数据',
      duration: '7 天',
    }
    application.resourceItems!.push({
      ...firstItem,
      id: 'item_2',
      payload: {
        ...firstItem.payload,
        operationScope: '读取审计数据',
      },
    })

    const d1 = createMemoryD1(state)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }), env)

    expect(response.ok).toBe(true)
    expect(d1.data.bindings).toHaveLength(2)
    const databaseNames = d1.data.bindings.map(item => String(item.database_name))
    const usernames = d1.data.bindings.map(item => String(item.username))
    expect(new Set(databaseNames).size).toBe(2)
    expect(new Set(usernames).size).toBe(2)
    expect(databaseNames.every(name => name.length <= 63)).toBe(true)
    expect(usernames.every(name => name.length <= 63)).toBe(true)
  })

  it('keeps generated PostgreSQL identifiers valid when approved names start with digits', async () => {
    const state = createState()
    const item = state.applications[0].resourceItems![0]
    item.approvedPayload = {
      databaseName: '2026-orders',
      username: '123_reader',
      permission: 'readonly',
      expiresInDays: 14,
    }

    const d1 = createMemoryD1(state)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: '2026',
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)

    expect(response.ok).toBe(true)
    expect(d1.data.bindings[0]).toMatchObject({
      database_name: 'x_2026_orders',
      username: 'x_123_reader',
    })
    expect(poolQueries.some(item => item.sql.includes('create database "x_2026_orders"'))).toBe(true)
    expect(poolQueries.some(item => item.sql.includes('create role "x_123_reader"'))).toBe(true)
  })

  it('keeps successful database secrets when another resource item falls back to manual provisioning', async () => {
    const state = createState()
    const application = state.applications[0]!
    const firstItem = application.resourceItems![0]!
    application.resourceItems!.push({
      ...firstItem,
      id: 'item_mysql',
      resourceSubtype: 'mysql',
      approvedPayload: undefined,
      payload: {
        name: 'legacy_mysql',
        environment: 'dev',
        permission: 'readonly',
        operationScope: '读取历史系统数据',
        duration: '7 天',
      },
    })

    const d1 = createMemoryD1(state)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }), env)

    expect(response.ok).toBe(true)
    const result = await response.json() as {
      status: string
      items: Array<{ provider: string, database: { password?: string, connectionUrl?: string } }>
      failures: Array<{ itemId: string, error: string }>
    }
    expect(result.status).toBe('provisioned')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].database.password).toBeTruthy()
    expect(result.items[0].database.connectionUrl).toContain('approved_reader')
    expect(result.failures).toEqual([
      { itemId: 'item_mysql', error: '数据库自动发放当前仅支持 PostgreSQL，mysql 需人工处理' },
    ])
    expect(d1.data.bindings).toHaveLength(1)

    const updatedState = await readWelfareState(env)
    const [postgresItem, mysqlItem] = updatedState.applications[0].resourceItems!
    expect(postgresItem.provisionStatus).toBe('completed')
    expect(postgresItem.provisionNote).toContain('明文密码仅在本次发放响应中返回')
    expect(mysqlItem.provisionStatus).toBe('pending')
    expect(mysqlItem.provisionNote).toContain('待人工处理')
  })

  it('reuses a binding created while waiting for the database provision lock', async () => {
    const state = createState()
    const d1 = createMemoryD1(state)
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
      }),
    }), env)

    onAdvisoryLock = () => {
      if (d1.data.bindings.length)
        return
      d1.data.bindings.push({
        id: 'dbp_existing',
        user_id: 'user_1',
        application_id: 'app_1',
        item_id: 'item_1',
        database_type: 'postgresql',
        database_name: 'existing_orders',
        username: 'existing_reader',
        password_hash: 'hash',
        connection_url_encrypted: 'encrypted',
        connection_url_masked: 'postgresql://existing_reader:****@db.example.com:5432/existing_orders',
        permission: 'readonly',
        expires_at: '2026-06-22T00:00:00.000Z',
        status: 'active',
      })
    }

    const result = await createDatabaseForResourceItem(env, {
      applicationId: 'app_1',
      item: state.applications[0].resourceItems![0],
      user: state.users[1],
    })

    expect(result.reused).toBe(true)
    expect(result.password).toBeUndefined()
    expect(result.databaseName).toBe('existing_orders')
    expect(poolQueries.some(item => item.sql.includes('create database'))).toBe(false)
    expect(poolQueries.some(item => item.sql.includes('create role'))).toBe(false)
  })

  it('keeps first-use database secrets when state write conflicts after binding creation', async () => {
    const d1 = createMemoryD1(createState())
    d1.data.conflictAfterNextBindingInsert = true
    const env = {
      LOCAL_DB: d1,
      NOTIFY_SECRET_KEY: 'test-secret-for-database-provisioning',
      WELFARE_STATE_SECRET_KEY: 'test-secret-for-database-provisioning',
    }
    const cookie = await createSessionCookie(new Request('https://welfare.example.com/'), env, 'admin_1')

    await handleDatabaseProvisionRequest(new Request('https://welfare.example.com/api/database-provision/config', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        rootUrl: 'postgresql://root:secret@db.example.com:5432/postgres',
        defaultExpiresInDays: 30,
        databasePrefix: 'twg',
      }),
    }), env)

    const response = await handleAiRequest(new Request('https://welfare.example.com/api/ai/applications/app_1/provision', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: 'item_1' }),
    }), env)

    expect(response.ok).toBe(true)
    const result = await response.json() as {
      status: string
      items: Array<{ provider: string, database: { password?: string, connectionUrl?: string } }>
    }
    expect(result.status).toBe('provisioned')
    expect(result.items[0].database.password).toBeTruthy()
    expect(result.items[0].database.connectionUrl).toContain(result.items[0].database.password!)
    expect(d1.data.bindings).toHaveLength(1)
    expect(poolQueries.filter(item => item.sql.includes('create role "approved_reader"'))).toHaveLength(1)

    const updatedState = await readWelfareState(env)
    const resourceItem = updatedState.applications[0].resourceItems?.[0]
    expect(resourceItem?.provisionStatus).toBe('completed')
    expect(resourceItem?.provisionNote).toContain('明文密码仅在本次发放响应中返回')
    expect(resourceItem?.provisionNote).not.toContain(result.items[0].database.password)
  })
})
