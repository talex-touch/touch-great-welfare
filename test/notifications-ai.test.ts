import type { User, WelfareState } from '../src/composables/welfare'
import { describe, expect, it, vi } from 'vitest'
import { dispatchWelfareStateChangeNotifications } from '../src/worker/notifications'

function user(points = 120): User {
  return {
    id: 'user_1',
    role: 'user',
    points,
    profile: {
      displayName: '开源同学',
      email: 'student@example.com',
      studentVerified: false,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    lastLoginAt: '2026-06-01T00:00:00.000Z',
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
    applications: [],
    studentVerifications: [],
    transactions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function createMemoryD1() {
  const notifications: Record<string, unknown>[] = []
  const deliveries: Record<string, unknown>[] = []
  const settings: Record<string, unknown>[] = []
  let appState: WelfareState | undefined

  return {
    data: {
      notifications,
      deliveries,
      settings,
    },
    setState(value: WelfareState) {
      appState = value
    },
    prepare(query: string) {
      return {
        values: [] as unknown[],
        bind(...values: unknown[]) {
          this.values = values
          return this
        },
        async run() {
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
            })
          }
        },
        async first() {
          if (query.includes('select state from welfare_app_state'))
            return appState ? { state: JSON.stringify(appState) } : null
          if (query.includes('select * from notification_settings'))
            return settings.find(item => item.user_id === this.values[0]) ?? null
          return null
        },
        async all() {
          return { results: [] }
        },
      }
    },
  }
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
    await dispatchWelfareStateChangeNotifications({
      LOCAL_DB: d1 as unknown as D1Database,
    }, previous, next)

    expect(d1.data.notifications).toHaveLength(1)
    expect(d1.data.notifications[0].event).toBe('application_answered')
    expect(d1.data.deliveries).toHaveLength(1)
    expect(d1.data.deliveries[0].channel).toBe('in_app')
  })
})
