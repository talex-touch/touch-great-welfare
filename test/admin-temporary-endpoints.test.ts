import type { User, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () => Response.json({ state: {} })))

const worker = (await import('../src/worker')).default
const { createSessionCookie } = await import('../src/worker/session')

function user(id: string, role: User['role']): User {
  return {
    id,
    role,
    points: 100,
    profile: {
      displayName: id,
      email: `${id}@example.com`,
      studentVerified: false,
    },
    accountStatus: 'active',
    createdAt: '2026-06-10T00:00:00.000Z',
    lastLoginAt: '2026-06-10T00:00:00.000Z',
  }
}

function state(): WelfareState {
  return {
    users: [user('admin_1', 'admin'), user('user_1', 'user')],
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
    createdAt: '2026-06-10T00:00:00.000Z',
  }
}

function createMemoryD1(initialState: WelfareState) {
  return {
    prepare(query: string) {
      return {
        bind() {
          return this
        },
        async first() {
          if (query.includes('select state, version from welfare_app_state'))
            return { state: JSON.stringify(initialState), version: 1 }
          return null
        },
        async run() {
          return { meta: { changes: 1 } }
        },
        async all() {
          return { results: [] }
        },
      }
    },
  }
}

describe('temporary admin endpoints', () => {
  it('requires admin authentication for legacy admin endpoints', async () => {
    const env = {
      LOCAL_DB: createMemoryD1(state()) as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
    }
    const endpoints = [
      ['GET', '/admin/test-tables'],
      ['GET', '/admin/debug-env'],
      ['GET', '/admin/export-state'],
      ['POST', '/admin/migrate-now'],
      ['POST', '/admin/full-migration'],
      ['POST', '/admin/batch-migration'],
    ] as const

    for (const [method, path] of endpoints) {
      const anonymous = await worker.fetch(new Request(`https://example.com${path}`, { method }), env)
      expect(anonymous.status, `${method} ${path} anonymous`).toBe(401)

      const userCookie = await createSessionCookie(new Request('https://example.com/'), env, 'user_1')
      const regularUser = await worker.fetch(new Request(`https://example.com${path}`, {
        method,
        headers: { cookie: userCookie },
      }), env)
      expect(regularUser.status, `${method} ${path} user`).toBe(403)
    }
  })

  it('allows admins to read temporary debug status', async () => {
    const env = {
      LOCAL_DB: createMemoryD1(state()) as unknown as D1Database,
      NOTIFY_SECRET_KEY: 'test-secret',
      USE_NORMALIZED_TABLES: 'false',
    }
    const adminCookie = await createSessionCookie(new Request('https://example.com/'), env, 'admin_1')

    const response = await worker.fetch(new Request('https://example.com/admin/debug-env', {
      headers: { cookie: adminCookie },
    }), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      USE_NORMALIZED_TABLES: 'false',
      hasD1: true,
    })
  })
})
