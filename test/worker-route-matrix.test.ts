import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const worker = (await import('../src/worker')).default
const FAST_RESPONSE_MS = 250

function localDbEnv(state: Record<string, unknown> = {}) {
  return {
    LOCAL_DB: {
      prepare(sql: string) {
        return {
          bind() {
            return this
          },
          async run() {
            return { success: true }
          },
          async first() {
            if (/select state, version from welfare_app_state/i.test(sql)) {
              return {
                state: JSON.stringify(state),
                version: 1,
              }
            }
            if (/select version from welfare_app_state/i.test(sql))
              return { version: 1 }
            return null
          },
          async all() {
            return { results: [] }
          },
        }
      },
      async batch(items: Array<{ run: () => Promise<unknown> }>) {
        return Promise.all(items.map(item => item.run()))
      },
    },
  }
}

async function expectFastResponse(request: Request, env: Record<string, unknown> = {}) {
  const startedAt = performance.now()
  const response = await worker.fetch(request, env)
  expect(performance.now() - startedAt).toBeLessThan(FAST_RESPONSE_MS)
  return response
}

describe('worker route matrix', () => {
  it('returns 404 for unknown routes', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/not-found'))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  it.each([
    '/api/notifications-disabled',
    '/api/admin/welfare-disabled',
  ])('does not route adjacent path prefixes for %s', async (path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  it('returns method boundaries from the welfare router', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), {})

    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({ error: 'Method Not Allowed' })
  })

  it('rejects cross-origin writes before route handlers touch storage', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/check-ins/today', {
      method: 'POST',
      headers: { 'origin': 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    }), {})

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: '不允许的跨源写请求' })
  })

  it.each([
    ['GET', '/admin/test-tables'],
    ['GET', '/admin/debug-env'],
    ['POST', '/admin/migrate-now'],
    ['POST', '/admin/full-migration'],
    ['POST', '/admin/batch-migration'],
    ['GET', '/admin/export-state'],
  ])('keeps temporary admin endpoint disabled by default for %s %s', async (method, path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  it.each([
    ['GET', '/admin/test-tables'],
    ['GET', '/admin/debug-env'],
    ['POST', '/admin/migrate-now'],
    ['POST', '/admin/full-migration'],
    ['POST', '/admin/batch-migration'],
    ['GET', '/admin/export-state'],
  ])('guards enabled temporary admin endpoint before handler execution for %s %s', async (method, path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }), { ENABLE_TEMP_ADMIN_ENDPOINTS: 'true' })

    expect(response.status, `${method} ${path}`).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '请先登录' })
  })

  it('serves anonymous session reads without touching storage', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/session'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ currentUser: null })
  })

  it.each([
    ['public bootstrap', '/api/bootstrap'],
    ['legacy anonymous state', '/api/welfare-state'],
  ])('serves %s from the worker entrypoint without timing out', async (_label, path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`), localDbEnv({
      users: [{ id: 'admin_1', role: 'admin', profile: { studentVerified: false } }],
      systemConfig: { siteEnabled: true },
      siteBanner: { enabled: true, title: '公告' },
      createdAt: '2026-06-01T00:00:00.000Z',
    }))

    expect(response.status).toBe(200)
    if (path === '/api/bootstrap') {
      await expect(response.json()).resolves.toMatchObject({
        hasAdmin: true,
        systemConfig: { siteEnabled: true },
        siteBanner: { enabled: true, title: '公告' },
        createdAt: '2026-06-01T00:00:00.000Z',
      })
    }
    else {
      await expect(response.json()).resolves.toMatchObject({
        version: 1,
        state: {
          users: [{ id: 'admin-present', role: 'admin' }],
          systemConfig: { siteEnabled: true },
          siteBanner: { enabled: true, title: '公告' },
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      })
    }
  })

  it('converts legacy state storage failures into deterministic JSON', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/welfare-state'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Hyperdrive binding is required' })
  })

  it('serves public config with masked secrets from the worker entrypoint', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/config/public'), localDbEnv({
      applicationPolicy: {
        turnstileSecretKey: 'secret-value-123456',
        turnstileSiteKey: 'site-key',
      },
      systemConfig: { siteEnabled: true },
      createdAt: '2026-06-01T00:00:00.000Z',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      applicationPolicy: {
        turnstileSecretKey: 'secr****3456',
        turnstileSiteKey: 'site-key',
      },
      systemConfig: { siteEnabled: true },
      createdAt: '2026-06-01T00:00:00.000Z',
    })
  })

  it('freezes the legacy full-state write route by default at the worker entrypoint', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/welfare-state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, state: {} }),
    }), {})

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      code: 'LEGACY_STATE_WRITE_FROZEN',
    })
  })

  it('keeps the legacy action bus behind authentication while full-state writes are frozen', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/welfare-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-welfare-action': 'check-in-today' },
      body: '{}',
    }), {})

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '请先登录' })
  })

  it('clears the session cookie without touching storage', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/session', { method: 'DELETE' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('tg_welfare_session=;')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns method boundary for direct application submission route', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/applications/submit'))

    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({ error: 'Method Not Allowed' })
  })

  it.each([
    ['POST', '/api/session/admin/bootstrap'],
    ['POST', '/api/session/admin/login'],
  ])('routes admin session action %s %s to deterministic JSON failure', async (method, path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), localDbEnv({ users: [{ id: 'admin_1', role: 'admin', profile: { email: 'root@example.com', studentVerified: false } }] }))

    expect(response.status, `${method} ${path}`).toBe(500)
    const payload = await response.json()
    expect(payload).toHaveProperty('error')
  })

  it.each([
    ['GET', '/api/ai/config'],
    ['PUT', '/api/ai/config'],
    ['GET', '/api/ai/temporary-keys'],
    ['POST', '/api/ai/temporary-key'],
    ['DELETE', '/api/ai/temporary-keys/key_1'],
    ['POST', '/api/ai/reviews'],
    ['POST', '/api/ai/applications/app_1/provision'],
    ['POST', '/api/ai/images'],
    ['GET', '/api/sub2api/config'],
    ['PUT', '/api/sub2api/config'],
    ['POST', '/api/sub2api/test'],
    ['GET', '/api/sub2api/keys'],
    ['POST', '/api/sub2api/keys'],
    ['DELETE', '/api/sub2api/keys/key_1'],
    ['GET', '/api/notifications/provider-config'],
    ['PUT', '/api/notifications/provider-config'],
    ['POST', '/api/notifications/provider-config/vapid/generate'],
    ['POST', '/api/notifications/provider-config/feishu/authorize'],
    ['POST', '/api/notifications/provider-config/feishu/mailboxes'],
    ['POST', '/api/notifications/provider-config/email-test'],
    ['GET', '/api/notifications/admin-announcements'],
    ['POST', '/api/notifications/admin-announcements'],
    ['GET', '/api/notifications/system-logs'],
    ['GET', '/api/notifications'],
    ['GET', '/api/notifications/settings'],
    ['PUT', '/api/notifications/settings'],
    ['POST', '/api/notifications/email-test'],
    ['POST', '/api/notifications/push-subscriptions'],
    ['DELETE', '/api/notifications/push-subscriptions'],
    ['PATCH', '/api/notifications/read-all'],
    ['PATCH', '/api/notifications/notification_1/read'],
    ['DELETE', '/api/notifications/push-subscriptions/sub_1'],
    ['GET', '/api/database-provision/config'],
    ['PUT', '/api/database-provision/config'],
    ['POST', '/api/database-provision/test'],
    ['POST', '/api/database-provision/onepanel-status'],
    ['GET', '/api/education-mail/config'],
    ['PUT', '/api/education-mail/config'],
    ['POST', '/api/education-mail/test'],
    ['POST', '/api/education-mail/sync'],
    ['POST', '/api/education-mail/verify'],
    ['GET', '/api/github-app/config'],
    ['PUT', '/api/github-app/config'],
    ['GET', '/api/oauth/configs'],
    ['PUT', '/api/oauth/configs'],
    ['GET', '/api/points/transactions'],
    ['PUT', '/api/recharge/config'],
    ['POST', '/api/recharge/create'],
    ['GET', '/api/recharge/status?out_trade_no=order_1'],
    ['POST', '/api/turnstile/verify'],
    ['POST', '/api/uploads/images'],
  ])('guards integration config route %s %s before touching storage', async (method, path) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    const response = await expectFastResponse(new Request(`https://example.com${path}`, { method }))

    expect(response.status, `${method} ${path}`).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '请先登录' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets external webhook callbacks bypass same-origin write rejection and fail at webhook config boundary', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: { 'origin': 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    }), {})

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook secret is not configured' })
  })

  it('rejects non-GET recharge return callbacks', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/recharge/return', {
      method: 'POST',
    }))

    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({ error: 'Method Not Allowed' })
  })

  it('serves anonymous recharge config without exposing merchant secrets', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/recharge/config'), localDbEnv({
      users: [],
      transactions: [],
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      pid: '',
      keyMasked: '',
      paymentType: 'epay',
    })
  })

  it('keeps recharge provider callbacks deterministic without database config', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/recharge/notify'))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('fail')
  })

  it('redirects recharge return callbacks without touching storage', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/recharge/return?out_trade_no=order_1'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://example.com/dashboard/profile?recharge=order_1')
  })

  it.each([
    ['POST', '/api/github-app/authorize'],
    ['POST', '/api/github-app/callback'],
    ['POST', '/api/oauth/authorize'],
    ['POST', '/api/oauth/callback'],
    ['GET', '/api/notifications/provider-config/feishu/callback'],
  ])('keeps public integration action %s %s deterministic without external calls', async (method, path) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }), localDbEnv({
      users: [],
      transactions: [],
      systemConfig: { siteEnabled: true, loginEnabled: true },
    }))

    expect(response.status, `${method} ${path}`).toBe(500)
    expect(await response.json()).toHaveProperty('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', '/api/ai/not-found', 404, { error: 'Not Found' }],
    ['GET', '/api/ai/images/job_1/file', 401, { error: '请先登录' }],
    ['GET', '/api/ai/images/job_1', 401, { error: '请先登录' }],
    ['POST', '/api/sub2api/not-found', 405, { error: 'Method Not Allowed' }],
    ['PATCH', '/api/sub2api/config', 405, { error: 'Method Not Allowed' }],
    ['GET', '/api/database-provision/not-found', 404, { error: 'Not Found' }],
    ['GET', '/api/education-mail/not-found', 405, { error: 'Method Not Allowed' }],
    ['PATCH', '/api/education-mail/config', 405, { error: 'Method Not Allowed' }],
    ['GET', '/api/github-app/not-found', 404, { error: 'Not Found' }],
    ['GET', '/api/github-app/authorize', 405, { error: 'Method Not Allowed' }],
    ['PATCH', '/api/github-app/callback', 405, { error: 'Method Not Allowed' }],
    ['GET', '/api/oauth/not-found', 404, { error: 'Not Found' }],
    ['GET', '/api/oauth/authorize', 405, { error: 'Method Not Allowed' }],
    ['PATCH', '/api/oauth/callback', 405, { error: 'Method Not Allowed' }],
    ['POST', '/api/points/transactions', 405, { error: 'Method Not Allowed' }],
    ['GET', '/api/recharge/not-found', 404, { error: 'Not Found' }],
    ['POST', '/api/recharge/status', 405, { error: 'Method Not Allowed' }],
    ['GET', '/api/turnstile/not-found', 404, { error: 'Not Found' }],
    ['GET', '/api/turnstile/verify', 404, { error: 'Not Found' }],
    ['GET', '/api/uploads/not-found', 404, { error: 'Not Found' }],
    ['POST', '/api/uploads/att_1/file', 404, { error: 'Not Found' }],
  ])('returns deterministic integration route boundary for %s %s', async (method, path, status, payload) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }), {})

    expect(response.status, `${method} ${path}`).toBe(status)
    await expect(response.json()).resolves.toEqual(payload)
  })

  it('serves notification public key from an empty local provider config', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/notifications/push/public-key'), localDbEnv())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      publicKey: '',
      configured: false,
    })
  })

  it('serves public OAuth providers from an empty local config', async () => {
    const response = await expectFastResponse(new Request('https://example.com/api/oauth/providers'), localDbEnv())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ providers: [] })
  })

  it.each([
    ['/api/oauth/callback', 'oauth_login=error'],
    ['/api/github-app/callback', 'github_auth=error'],
  ])('redirects failed browser callback %s without hanging', async (path, marker) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`))

    expect(response.status, path).toBe(302)
    expect(response.headers.get('location')).toContain(marker)
  })

  it.each([
    ['PATCH', '/api/me/profile'],
    ['GET', '/api/me'],
    ['GET', '/api/applications/mine'],
    ['GET', '/api/wallet/summary'],
    ['GET', '/api/verifications/mine'],
    ['GET', '/api/square/posts'],
    ['GET', '/api/collaboration/mine'],
    ['GET', '/api/welfare-state/me'],
    ['POST', '/api/applications/submit'],
    ['POST', '/api/check-ins/today'],
    ['POST', '/api/invitations/bind'],
    ['POST', '/api/invitations/vouch'],
    ['POST', '/api/coupons/redeem'],
    ['POST', '/api/square/posts'],
    ['POST', '/api/square/boosts'],
    ['POST', '/api/square/reports'],
    ['POST', '/api/applications/supplements'],
    ['POST', '/api/applications/messages'],
    ['POST', '/api/applications/resource-lifecycle'],
    ['POST', '/api/verifications/student'],
    ['POST', '/api/verifications/student/supplement'],
    ['POST', '/api/verifications/education-email-challenges'],
    ['POST', '/api/collaboration/applications'],
    ['POST', '/api/collaboration/applications/review'],
    ['POST', '/api/collaboration/crowd-reviews'],
    ['POST', '/api/deliveries/claim'],
    ['POST', '/api/deliveries/cancel-claim'],
    ['POST', '/api/deliveries/submit'],
    ['POST', '/api/deliveries/review'],
    ['POST', '/api/admin/users/role'],
    ['POST', '/api/admin/users/suspension'],
    ['POST', '/api/admin/users/student-verification'],
    ['POST', '/api/admin/users/revoke-student-verification'],
    ['POST', '/api/admin/users/github-unbind'],
    ['POST', '/api/admin/users/points'],
    ['POST', '/api/admin/applications/review-item'],
    ['POST', '/api/admin/applications/complete-provision'],
    ['POST', '/api/admin/applications/complete-allocation'],
    ['POST', '/api/admin/applications/resource-lifecycle'],
    ['POST', '/api/admin/applications/answer'],
    ['POST', '/api/admin/applications/reject'],
    ['POST', '/api/admin/applications/complete'],
    ['POST', '/api/admin/applications/request-supplement'],
    ['POST', '/api/admin/applications/messages'],
    ['POST', '/api/admin/verifications/student'],
    ['POST', '/api/admin/verifications/student/review'],
    ['POST', '/api/admin/coupons/templates'],
    ['POST', '/api/admin/coupons/codes'],
    ['POST', '/api/admin/coupons/grants'],
    ['PUT', '/api/admin/config/system'],
    ['PUT', '/api/admin/config/application-policy'],
    ['PUT', '/api/admin/config/site-banner'],
    ['PUT', '/api/admin/config/oauth'],
  ])('routes %s %s to an authenticated welfare handler', async (method, path) => {
    const response = await expectFastResponse(new Request(`https://example.com${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }), {})

    expect(response.status, `${method} ${path}`).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '请先登录' })
  })

  it.each([
    ['GET', '/api/admin/welfare/state'],
    ['GET', '/api/admin/config/welfare'],
    ['GET', '/api/admin/applications'],
    ['GET', '/api/admin/verifications'],
    ['GET', '/api/welfare-state/admin'],
  ])('guards admin read route %s %s before touching storage', async (method, path) => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    const response = await expectFastResponse(new Request(`https://example.com${path}`, { method }))

    expect(response.status, `${method} ${path}`).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: '请先登录' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
