import type { ApplicationPolicyConfig, User, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const asyncJobs = await import('../src/worker/async-jobs')
const notifications = await import('../src/worker/notifications')
const { createSessionCookie } = await import('../src/worker/session')
const { readWelfareState } = await import('../src/worker/welfare-state')

function user(points = 120, id = 'user_1', role: User['role'] = 'user'): User {
  return {
    id,
    role,
    points,
    profile: {
      displayName: role === 'admin' ? '管理员' : '开源同学',
      email: `${id}@example.com`,
      studentVerified: false,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
  }
}

function applicationPolicy(): ApplicationPolicyConfig {
  return {
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
  }
}

function state(points = 120): WelfareState {
  return {
    users: [user(points)],
    oauth: {
      enabled: true,
      provider: 'github',
      clientId: 'client',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      callbackUrl: 'http://localhost/callback',
      scopes: 'read:user',
    },
    applicationPolicy: applicationPolicy(),
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
  }
}

function createMemoryD1() {
  const notifications: Record<string, unknown>[] = []
  const deliveries: Record<string, unknown>[] = []
  const settings: Record<string, unknown>[] = []
  const pushSubscriptions: Record<string, unknown>[] = []
  const pointTransactions: Record<string, unknown>[] = []
  const queries: Array<{ method: 'all' | 'first' | 'run', query: string, values: unknown[] }> = []
  let providerConfig: Record<string, unknown> | null = null
  let appState: WelfareState | undefined
  let appVersion = 1

  return {
    data: {
      notifications,
      deliveries,
      settings,
      pushSubscriptions,
      pointTransactions,
      queries,
      get providerConfig() {
        return providerConfig
      },
      get state() {
        return appState
      },
    },
    setState(value: WelfareState) {
      appState = value
      appVersion = 1
    },
    addNotificationSetting(value: Record<string, unknown>) {
      settings.push(value)
    },
    setProviderConfig(value: Record<string, unknown>) {
      providerConfig = value
    },
    prepare(query: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values
          return this
        },
        async run() {
          queries.push({ method: 'run', query, values: [...this.values] })
          if (query.includes('insert into notifications')) {
            notifications.push({
              id: this.values[0],
              user_id: this.values[1],
              event: this.values[2],
              title: this.values[3],
              body: this.values[4],
              data: this.values[5],
              read_at: null,
              created_at: '2026-06-01T00:00:00.000Z',
            })
          }
          if (query.includes('insert into notification_deliveries')) {
            deliveries.push({
              id: this.values[0],
              notification_id: this.values[1],
              channel: this.values[2],
              status: this.values[3],
              error: this.values[4],
              charged_points: this.values[5],
              provider_message_id: this.values[6],
              provider: this.values[7] ?? '',
              created_at: '2026-06-01T00:00:00.000Z',
            })
          }
          if (query.includes('insert into notification_settings')) {
            const existing = settings.find(item => item.user_id === this.values[0])
            const onlyBrowserPush = query.includes('(user_id, browser_push_enabled, updated_at)')
            const next = onlyBrowserPush
              ? {
                  user_id: this.values[0],
                  email_enabled: existing?.email_enabled ?? 0,
                  email_address: existing?.email_address ?? '',
                  feishu_enabled: existing?.feishu_enabled ?? 0,
                  feishu_webhook_encrypted: existing?.feishu_webhook_encrypted ?? null,
                  browser_push_enabled: this.values[1] ?? 0,
                }
              : {
                  user_id: this.values[0],
                  email_enabled: this.values[1] ?? existing?.email_enabled ?? 0,
                  email_address: this.values[2] ?? existing?.email_address ?? '',
                  feishu_enabled: this.values[3] ?? existing?.feishu_enabled ?? 0,
                  feishu_webhook_encrypted: this.values[4] ?? existing?.feishu_webhook_encrypted ?? null,
                  browser_push_enabled: this.values[5] ?? existing?.browser_push_enabled ?? 0,
                }
            if (existing)
              Object.assign(existing, next)
            else
              settings.push(next)
          }
          if (query.includes('update notification_settings set browser_push_enabled')) {
            for (const setting of settings) {
              if (this.values.length < 2 || setting.user_id === this.values[1])
                setting.browser_push_enabled = this.values.length ? this.values[0] : 0
            }
          }
          if (query.includes('insert into push_subscriptions')) {
            const existing = pushSubscriptions.find(item => item.endpoint === this.values[2])
            const next = {
              id: this.values[0],
              user_id: this.values[1],
              endpoint: this.values[2],
              p256dh: this.values[3],
              auth: this.values[4],
              user_agent: this.values[5],
              enabled: 1,
            }
            if (existing)
              Object.assign(existing, next)
            else
              pushSubscriptions.push(next)
          }
          if (query.includes('update push_subscriptions set enabled = 0')) {
            for (const subscription of pushSubscriptions) {
              const matchesEndpoint = query.includes('where user_id = ?1 and endpoint = ?2')
                && subscription.user_id === this.values[0]
                && subscription.endpoint === this.values[1]
              const matchesId = !query.includes('where user_id = ?1 and endpoint = ?2')
                && (this.values.length === 0 || subscription.id === this.values[0])
              if (matchesEndpoint || matchesId) {
                subscription.enabled = 0
                subscription.disabled_at = '2026-06-01T00:00:00.000Z'
              }
            }
          }
          if (query.includes('insert into notification_provider_config')) {
            providerConfig = {
              id: this.values[0],
              resend_api_key_encrypted: this.values[1],
              resend_from_email: this.values[2],
              vapid_public_key: this.values[3],
              vapid_private_key_encrypted: this.values[4],
              vapid_subject: this.values[5],
              feishu_mail_enabled: this.values[6],
              feishu_app_id: this.values[7],
              feishu_app_secret_encrypted: this.values[8],
              feishu_user_access_token_encrypted: this.values[9],
              feishu_refresh_token_encrypted: this.values[10],
              feishu_access_token_expires_at: this.values[11],
              feishu_refresh_token_expires_at: this.values[12],
              feishu_user_mailbox_id: this.values[13],
              feishu_site_base_url: this.values[14],
              feishu_daily_limit: this.values[15],
              smtp_enabled: this.values[16],
              smtp_host: this.values[17],
              smtp_port: this.values[18],
              smtp_username: this.values[19],
              smtp_password_encrypted: this.values[20],
              smtp_from_email: this.values[21],
              smtp_from_name: this.values[22],
            }
          }
          if (query.includes('update notification_provider_config') && providerConfig) {
            providerConfig.feishu_user_access_token_encrypted = this.values[0]
            providerConfig.feishu_refresh_token_encrypted = this.values[1]
            providerConfig.feishu_access_token_expires_at = this.values[2]
            providerConfig.feishu_refresh_token_expires_at = this.values[3]
          }
          if (query.includes('insert into point_transactions')) {
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
          if (query.includes('insert into welfare_app_state')) {
            appState = JSON.parse(String(this.values[1])) as WelfareState
            appVersion = Number(this.values[2] || appVersion + 1)
            return { meta: { changes: 1 } }
          }
          if (query.includes('update welfare_app_state')) {
            if (appVersion !== Number(this.values[3]))
              return { meta: { changes: 0 } }

            appState = JSON.parse(String(this.values[1])) as WelfareState
            appVersion = Number(this.values[2] || appVersion + 1)
            return { meta: { changes: 1 } }
          }
        },
        async first() {
          queries.push({ method: 'first', query, values: [...this.values] })
          if (query.includes('select state') && query.includes('welfare_app_state'))
            return appState ? { state: JSON.stringify(appState), version: appVersion } : null
          if (query.includes('select version') && query.includes('welfare_app_state'))
            return appState ? { version: appVersion } : null
          if (query.includes('select * from notification_provider_config'))
            return providerConfig
          if (query.includes('select * from notification_settings'))
            return settings.find(item => item.user_id === this.values[0]) ?? null
          if (query.includes('select count(*) as count') && query.includes('notification_deliveries')) {
            return {
              count: deliveries.filter(item => item.provider === this.values[0] && item.status === 'sent').length,
            }
          }
          if (query.includes('select count(*) as count') && query.includes('push_subscriptions')) {
            return {
              count: pushSubscriptions.filter(item => item.user_id === this.values[0] && (item.enabled === 1 || item.enabled === true)).length,
            }
          }
          if (query.includes('from point_transactions where id'))
            return pointTransactions.find(item => item.id === this.values[0]) ?? null
          return null
        },
        async all() {
          queries.push({ method: 'all', query, values: [...this.values] })
          if (query.includes('pragma table_info'))
            return { results: [] }
          if (query.includes('from push_subscriptions')) {
            return {
              results: pushSubscriptions.filter(item => item.user_id === this.values[0] && (item.enabled === 1 || item.enabled === true)),
            }
          }
          if (query.includes('from point_transactions'))
            return { results: [] }
          return { results: [] }
        },
      }
    },
  }
}

async function saveNotificationProvider(d1: ReturnType<typeof createMemoryD1>, adminId = 'admin_1', overrides: Record<string, unknown> = {}) {
  const env = {
    LOCAL_DB: d1 as unknown as D1Database,
    NOTIFY_SECRET_KEY: 'test-secret',
  }
  const cookie = await createSessionCookie(new Request('https://example.com/'), env, adminId)
  const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config', {
    method: 'PUT',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      resendApiKey: 're_test',
      resendFromEmail: 'Touch Great Welfare <notice@example.com>',
      vapidPublicKey: '',
      vapidPrivateKey: '',
      vapidSubject: 'mailto:admin@example.com',
      feishuMailEnabled: true,
      feishuAppId: 'cli_test',
      feishuAppSecret: 'app_secret',
      feishuUserAccessToken: '',
      feishuRefreshToken: 'refresh_old',
      feishuAccessTokenExpiresAt: '',
      feishuRefreshTokenExpiresAt: '2026-06-15T00:00:00.000Z',
      feishuUserMailboxId: 'me',
      feishuSiteBaseUrl: 'https://welfare.example.com',
      feishuDailyLimit: 400,
      ...overrides,
    }),
  }), env)
  expect(response.ok).toBe(true)
  return response.json() as Promise<Record<string, any>>
}

describe('notification dispatch', () => {
  it('creates in-app notification for pro approval without optional channels', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'pending_review' as const,
        cost: 100,
        costCharged: false,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'answered' as const,
        answer: '已通过',
        reviewedAt: '2026-06-01T01:00:00.000Z',
      }],
    }

    vi.stubGlobal('crypto', globalThis.crypto)
    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
    }, previous, next)

    expect(d1.data.notifications).toHaveLength(1)
    expect(d1.data.notifications[0].event).toBe('application_answered')
    expect(d1.data.deliveries).toHaveLength(1)
    expect(d1.data.deliveries[0].channel).toBe('in_app')
    expect(d1.data.queries.some(item => item.query.includes('select state') && item.query.includes('welfare_app_state'))).toBe(false)
  })

  it('does not send a separate approval notification before auto provisioning resource items', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'resource' as const,
        title: 'LLM 额度申请',
        description: '请支持自动发放资源',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'in_review' as const,
        cost: 0,
        costCharged: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        selectedResourceTypes: ['llm_api_quota' as const],
        resourceItems: [{
          id: 'item_1',
          applicationId: 'app_1',
          resourceType: 'llm_api_quota' as const,
          resourceSubtype: 'codex',
          payload: { model: 'codex' },
          approverGroup: 'AI 平台/成本负责人',
          approvalStatus: 'pending' as const,
          provisionStatus: 'not_required' as const,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        }],
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'pending_allocation' as const,
        answer: '<p>资源申请审批已更新：LLM API 额度 / codex / 已通过。</p>',
        resourceItems: [{
          ...previous.applications[0].resourceItems[0],
          approvalStatus: 'approved' as const,
          provisionStatus: 'pending' as const,
        }],
      }],
    }
    d1.setState(next)

    vi.stubGlobal('crypto', globalThis.crypto)
    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
    }, previous, next)

    expect(d1.data.notifications).toHaveLength(0)
    expect(d1.data.deliveries).toHaveLength(0)
  })

  it('enqueues state-change notifications when async jobs are configured', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    const jobs: unknown[] = []
    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'pending_review' as const,
        cost: 100,
        costCharged: false,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'answered' as const,
        answer: '已通过',
        reviewedAt: '2026-06-01T01:00:00.000Z',
      }],
    }

    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
      ASYNC_JOBS: {
        send: async (job: unknown) => {
          jobs.push(job)
        },
      } as unknown as Queue<unknown>,
    }, previous, next)

    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ type: 'notification.dispatch', input: { event: 'application_answered', userId: 'user_1' } })
    expect(d1.data.notifications).toHaveLength(0)
  })

  it('dispatches queued notification jobs', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    const ack = vi.fn()
    const retry = vi.fn()

    await asyncJobs.handleAsyncJobBatch({
      messages: [{
        body: {
          type: 'notification.dispatch',
          input: {
            userId: 'user_1',
            event: 'application_answered',
            title: '申请已通过',
            body: '已通过',
          },
        },
        ack,
        retry,
      }],
    } as unknown as MessageBatch<unknown>, { LOCAL_DB: d1 as unknown as D1Database })

    expect(d1.data.notifications).toHaveLength(1)
    expect(d1.data.notifications[0].event).toBe('application_answered')
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it('notifies applicant when an application needs supplementary material', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'pending_review' as const,
        cost: 100,
        costCharged: true,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'needs_supplement' as const,
        messages: [{
          id: 'msg_1',
          applicationId: 'app_1',
          userId: 'admin_1',
          type: 'system' as const,
          content: '<p>请补充项目背景。</p>',
          attachments: [],
          createdAt: '2026-06-01T01:00:00.000Z',
        }],
      }],
    }
    d1.setState(next)

    vi.stubGlobal('crypto', globalThis.crypto)
    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
    }, previous, next)

    expect(d1.data.notifications).toHaveLength(1)
    expect(d1.data.notifications[0].user_id).toBe('user_1')
    expect(d1.data.notifications[0].event).toBe('application_needs_supplement')
  })

  it('notifies admins after the applicant submits supplementary material', async () => {
    const stored = {
      ...state(),
      users: [user(120), user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'needs_supplement' as const,
        cost: 100,
        costCharged: true,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'pending_review' as const,
        messages: [{
          id: 'msg_1',
          applicationId: 'app_1',
          userId: 'user_1',
          type: 'supplement' as const,
          content: '<p>已补充背景。</p>',
          attachments: [],
          createdAt: '2026-06-01T01:00:00.000Z',
        }],
      }],
    }
    d1.setState(next)

    vi.stubGlobal('crypto', globalThis.crypto)
    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
    }, previous, next)

    expect(d1.data.notifications).toHaveLength(1)
    expect(d1.data.notifications[0].user_id).toBe('admin_1')
    expect(d1.data.notifications[0].event).toBe('application_supplement_submitted')
  })

  it('saves, masks, and clears Feishu mail provider secrets', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)

    const saved = await saveNotificationProvider(d1)

    expect(saved.configured.feishuMail).toBe(true)
    expect(saved.feishuAppId).toBe('cli_test')
    expect(saved.feishuAppSecretMasked).not.toBe('app_secret')
    expect(saved.feishuRefreshTokenMasked).not.toBe('refresh_old')

    const cleared = await saveNotificationProvider(d1, 'admin_1', {
      feishuMailEnabled: false,
      feishuAppSecret: '',
      feishuRefreshToken: '',
      clearFeishuAppSecret: true,
      clearFeishuRefreshToken: true,
    })

    expect(cleared.configured.feishuMail).toBe(false)
    expect(cleared.feishuAppSecretMasked).toBe('')
    expect(cleared.feishuRefreshTokenMasked).toBe('')
  })

  it('saves Feishu mail config without manual user tokens', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)

    const saved = await saveNotificationProvider(d1, 'admin_1', {
      feishuUserAccessToken: '',
      feishuRefreshToken: '',
      feishuAccessTokenExpiresAt: '',
      feishuRefreshTokenExpiresAt: '',
    })

    expect(saved.configured.feishuMail).toBe(true)
    expect(saved.feishuAppId).toBe('cli_test')
    expect(saved.feishuAppSecretMasked).toBeTruthy()
    expect(saved.feishuRefreshTokenMasked).toBe('')
  })

  it('tests Feishu mail with the current provider config and saved user authorization', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authen/v2/oauth/token')) {
        return new Response(JSON.stringify({
          code: 0,
          access_token: 'access_new',
          expires_in: 7200,
          refresh_token: 'refresh_new',
          refresh_token_expires_in: 604800,
        }))
      }
      if (url.includes('/mail/v1/user_mailboxes/'))
        return new Response(JSON.stringify({ code: 0, msg: 'success', data: { message_id: 'msg_test' } }))
      return new Response(JSON.stringify({ id: 'unexpected' }))
    }))
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')
    await saveNotificationProvider(d1)

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/email-test', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailAddress: 'tagzxxia@gmail.com',
        provider: 'feishu_mail',
        providerConfig: {
          feishuMailEnabled: true,
          feishuAppId: 'cli_current',
          feishuAppSecret: 'current_secret',
          feishuUserMailboxId: 'welfare@example.com',
          feishuSiteBaseUrl: 'https://welfare.example.com',
          feishuDailyLimit: 400,
        },
      }),
    }), env)

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      deliveryProvider: 'feishu_mail',
      emailAddress: 'tagzxxia@gmail.com',
    })
    expect(d1.data.providerConfig?.feishu_app_id).toBe('cli_current')
  })

  it('tests SMTP mail with SMTP config instead of Resend', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'resend_should_not_run' })))
    vi.stubGlobal('fetch', fetchMock)
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')
    await saveNotificationProvider(d1, 'admin_1', {
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpUsername: 'welfare@example.com',
      smtpPassword: 'smtp_secret',
      smtpFromEmail: 'welfare@example.com',
      smtpFromName: '通知中心',
    })

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/email-test', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailAddress: 'tagzxxia@gmail.com',
        provider: 'smtp',
        providerConfig: {
          smtpEnabled: true,
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpUsername: 'welfare@example.com',
          smtpPassword: 'smtp_secret',
          smtpFromEmail: 'welfare@example.com',
          smtpFromName: '通知中心',
        },
      }),
    }), env)

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      deliveryProvider: 'smtp',
      emailAddress: 'tagzxxia@gmail.com',
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('api.resend.com'))).toBe(false)
  })

  it('rejects Feishu mail tests before user authorization', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/email-test', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailAddress: 'tagzxxia@gmail.com',
        provider: 'feishu_mail',
        providerConfig: {
          feishuMailEnabled: true,
          feishuAppId: 'cli_current',
          feishuAppSecret: 'current_secret',
          feishuUserMailboxId: 'welfare@example.com',
          feishuDailyLimit: 400,
        },
      }),
    }), env)

    expect(response.ok).toBe(false)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('授权飞书邮箱') })
  })

  it('authorizes Feishu mail and stores user tokens from callback', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      access_token: 'access_authorized',
      expires_in: 7200,
      refresh_token: 'refresh_authorized',
      refresh_token_expires_in: 604800,
    }))))
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const authorize = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/feishu/authorize', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        redirect: '/dashboard/admin?tab=system',
        providerConfig: {
          feishuMailEnabled: true,
          feishuAppId: 'cli_current',
          feishuAppSecret: 'current_secret',
          feishuUserMailboxId: 'welfare@example.com',
          feishuDailyLimit: 400,
        },
      }),
    }), env)

    expect(authorize.ok).toBe(true)
    const authorizationPayload = await authorize.json() as { authorizationUrl: string }
    const stateParam = new URL(authorizationPayload.authorizationUrl).searchParams.get('state')
    expect(stateParam).toBeTruthy()

    const callback = await notifications.handleNotificationRequest(new Request(`https://example.com/api/notifications/provider-config/feishu/callback?code=auth_code&state=${encodeURIComponent(stateParam!)}`), env)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toContain('feishu_mail_auth=success')
    expect(d1.data.providerConfig?.feishu_user_access_token_encrypted).toBeTruthy()
    expect(d1.data.providerConfig?.feishu_refresh_token_encrypted).toBeTruthy()
  })

  it('rejects unsafe Feishu webhook URLs in user settings', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/settings', {
      method: 'PUT',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailEnabled: false,
        feishuEnabled: true,
        feishuWebhookUrl: 'https://127.0.0.1/webhook',
        browserPushEnabled: false,
      }),
    }), env)

    expect(response.ok).toBe(false)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('本地或内网地址') })
    expect(d1.data.settings).toHaveLength(0)
  })

  it('rejects unsafe browser push endpoints', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/push-subscriptions', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: 'https://localhost/push/evil',
        keys: {
          p256dh: 'valid-p256dh-key-1234567890',
          auth: 'valid-auth-key-1234567890',
        },
      }),
    }), env)

    expect(response.ok).toBe(false)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('本地或内网地址') })
    expect(d1.data.pushSubscriptions).toHaveLength(0)
  })

  it('disables the current browser push subscription by endpoint', async () => {
    const stored = state()
    const d1 = createMemoryD1()
    d1.setState(stored)
    d1.data.pushSubscriptions.push({
      id: 'psh_1',
      user_id: 'user_1',
      endpoint: 'https://push.example.com/send/1',
      p256dh: 'valid-p256dh-key-1234567890',
      auth: 'valid-auth-key-1234567890',
      enabled: 1,
    })
    d1.data.settings.push({
      user_id: 'user_1',
      email_enabled: 0,
      email_address: 'user_1@example.com',
      feishu_enabled: 0,
      browser_push_enabled: 1,
    })
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')

    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/push-subscriptions', {
      method: 'DELETE',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ endpoint: 'https://push.example.com/send/1' }),
    }), env)

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({ browserPushEnabled: false, pushSubscriptionCount: 0 })
    expect(d1.data.pushSubscriptions[0].enabled).toBe(0)
    expect(d1.data.settings[0].browser_push_enabled).toBe(0)
  })

  it('disables old push subscriptions when VAPID keys are regenerated', async () => {
    const stored = {
      ...state(),
      users: [user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const first = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/vapid/generate', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }), env)
    expect(first.ok).toBe(true)
    d1.data.pushSubscriptions.push({
      id: 'psh_1',
      user_id: 'admin_1',
      endpoint: 'https://push.example.com/send/1',
      p256dh: 'valid-p256dh-key-1234567890',
      auth: 'valid-auth-key-1234567890',
      enabled: 1,
    })
    d1.data.settings.push({
      user_id: 'admin_1',
      email_enabled: 0,
      email_address: 'admin_1@example.com',
      feishu_enabled: 0,
      browser_push_enabled: 1,
    })

    const regenerated = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/provider-config/vapid/generate', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ regenerate: true }),
    }), env)

    expect(regenerated.ok).toBe(true)
    await expect(regenerated.json()).resolves.toMatchObject({ regenerated: true })
    expect(d1.data.pushSubscriptions[0].enabled).toBe(0)
    expect(d1.data.settings[0].browser_push_enabled).toBe(0)
  })

  it('uses Feishu mail before Resend and charges email points once', async () => {
    const stored = {
      ...state(),
      users: [user(120), user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    d1.addNotificationSetting({
      user_id: 'user_1',
      email_enabled: 1,
      email_address: 'notify@example.com',
      feishu_enabled: 0,
      browser_push_enabled: 0,
    })
    vi.stubGlobal('crypto', globalThis.crypto)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authen/v2/oauth/token')) {
        return new Response(JSON.stringify({
          code: 0,
          access_token: 'access_new',
          expires_in: 7200,
          refresh_token: 'refresh_new',
          refresh_token_expires_in: 604800,
        }))
      }
      if (url.includes('/mail/v1/user_mailboxes/')) {
        return new Response(JSON.stringify({
          code: 0,
          msg: 'success',
          data: { message_id: 'msg_feishu' },
        }))
      }
      return new Response(JSON.stringify({ id: 'resend_should_not_run' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await saveNotificationProvider(d1)

    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'pending_review' as const,
        cost: 100,
        costCharged: false,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'answered' as const,
        answer: '<p>已通过。</p>',
        reviewedAt: '2026-06-01T01:00:00.000Z',
      }],
    }
    d1.setState(next)

    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }, previous, next)

    const emailDeliveries = d1.data.deliveries.filter(item => item.channel === 'email')
    expect(emailDeliveries).toHaveLength(1)
    expect(emailDeliveries[0].provider).toBe('feishu_mail')
    expect(emailDeliveries[0].charged_points).toBe(5)
    expect(d1.data.pointTransactions).toHaveLength(1)
    const decodedState = await readWelfareState({
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }) as WelfareState
    expect(decodedState.users.find(item => item.id === 'user_1')?.points).toBe(115)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('api.resend.com'))).toBe(false)
    expect(d1.data.providerConfig?.feishu_refresh_token_expires_at).toBeTruthy()
  })

  it('falls back to Resend when Feishu mail reaches the daily limit', async () => {
    const stored = {
      ...state(),
      users: [user(120), user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    d1.addNotificationSetting({
      user_id: 'user_1',
      email_enabled: 1,
      email_address: 'notify@example.com',
      feishu_enabled: 0,
      browser_push_enabled: 0,
    })
    for (let index = 0; index < 400; index += 1) {
      d1.data.deliveries.push({
        id: `old_${index}`,
        channel: 'email',
        status: 'sent',
        provider: 'feishu_mail',
        created_at: '2026-06-01T00:00:00.000Z',
      })
    }
    vi.stubGlobal('crypto', globalThis.crypto)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.resend.com'))
        return new Response(JSON.stringify({ id: 'resend_msg' }))
      return new Response(JSON.stringify({ code: 0, data: { message_id: 'unexpected_feishu' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await saveNotificationProvider(d1)

    const previous = {
      ...stored,
      applications: [{
        id: 'app_1',
        userId: 'user_1',
        type: 'pro' as const,
        title: 'Pro 支持',
        description: '请支持',
        hasOpenSourceBadge: false,
        attachments: [],
        status: 'pending_review' as const,
        cost: 100,
        costCharged: false,
        createdAt: '2026-06-01T00:00:00.000Z',
      }],
    }
    const next = {
      ...stored,
      applications: [{
        ...previous.applications[0],
        status: 'answered' as const,
        answer: '<p>已通过。</p>',
        reviewedAt: '2026-06-01T01:00:00.000Z',
      }],
    }
    d1.setState(next)

    await notifications.dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }, previous, next)

    const latestEmailDeliveries = d1.data.deliveries.filter(item => item.notification_id)
    expect(latestEmailDeliveries.some(item => item.provider === 'feishu_mail' && item.status === 'skipped')).toBe(true)
    expect(latestEmailDeliveries.some(item => item.provider === 'resend' && item.status === 'sent')).toBe(true)
    expect(d1.data.pointTransactions).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/mail/v1/user_mailboxes/'))).toBe(false)
  })

  it('sends admin announcements through Feishu mail without charging users', async () => {
    const stored = {
      ...state(),
      users: [user(120), user(0, 'admin_1', 'admin')],
    }
    const d1 = createMemoryD1()
    d1.setState(stored)
    vi.stubGlobal('crypto', globalThis.crypto)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/authen/v2/oauth/token')) {
        return new Response(JSON.stringify({
          code: 0,
          access_token: 'access_new',
          expires_in: 7200,
          refresh_token: 'refresh_new',
          refresh_token_expires_in: 604800,
        }))
      }
      return new Response(JSON.stringify({
        code: 0,
        msg: 'success',
        data: { message_id: 'msg_feishu' },
      }))
    }))
    await saveNotificationProvider(d1)

    const env = {
      LOCAL_DB: d1 as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const cookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')
    const response = await notifications.handleNotificationRequest(new Request('https://example.com/api/notifications/admin-announcements', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '维护通知',
        body: '<p>今晚维护。</p>',
        channels: ['in_app', 'email'],
        forcePopup: false,
        forcePush: false,
      }),
    }), env)

    expect(response.ok).toBe(true)
    const emailDeliveries = d1.data.deliveries.filter(item => item.channel === 'email')
    expect(emailDeliveries.length).toBeGreaterThan(0)
    expect(emailDeliveries.every(item => item.provider === 'feishu_mail')).toBe(true)
    expect(emailDeliveries.every(item => item.charged_points === 0)).toBe(true)
    expect(d1.data.pointTransactions).toHaveLength(0)
  })

  it('truncates email body and renders attachment download links', () => {
    const longBody = `<p>${'这是一段很长的回复内容'.repeat(220)}</p>`
    const content = notifications.renderNotificationEmailContent('申请回复', longBody, {
      attachments: [{
        id: 'att_1',
        name: 'xxx.pdf',
        url: '/api/uploads/att_1/file',
      }],
    }, 'https://welfare.example.com')

    expect(content.text).toContain('内容已截断')
    expect(content.text).toContain('1. xxx.pdf - 点击下载：https://welfare.example.com/api/uploads/att_1/file')
    expect(content.html).toContain('<a href="https://welfare.example.com/api/uploads/att_1/file">点击下载</a>')
  })
})
