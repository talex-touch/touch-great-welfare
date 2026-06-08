import { afterEach, describe, expect, it, vi } from 'vitest'

const { bootstrapAdmin, endSession, loadWelfareState, loginAdmin } = await import('../src/composables/welfare-persistence')

describe('welfare API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the current user state through one aggregated endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      state: {
        currentUserId: 'user_1',
        users: [],
        applications: [],
      },
      currentUserId: 'user_1',
      version: 2,
    }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await loadWelfareState('user')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/welfare-state/me', expect.objectContaining({
      credentials: 'same-origin',
    }))
  })

  it('uses explicit session endpoints without the legacy action bus', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, userId: 'admin_1' }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await bootstrapAdmin({ displayName: '管理员', email: 'admin@example.com', password: 'admin-password' })
    await loginAdmin({ email: 'admin@example.com', password: 'admin-password' })
    await endSession()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/session/admin/bootstrap', expect.objectContaining({
      method: 'POST',
      headers: expect.not.objectContaining({ 'x-welfare-action': expect.any(String) }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/session/admin/login', expect.objectContaining({
      method: 'POST',
      headers: expect.not.objectContaining({ 'x-welfare-action': expect.any(String) }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/session', expect.objectContaining({
      method: 'DELETE',
      headers: expect.not.objectContaining({ 'x-welfare-action': expect.any(String) }),
    }))
  })
})
