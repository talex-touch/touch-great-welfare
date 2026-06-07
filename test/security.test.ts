import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const { assertSafeExternalUrl, normalizeUrlBase } = await import('../src/worker/auth')
const { createSessionCookie, readSessionUserId } = await import('../src/worker/session')
const { markdownToSafeHtml } = await import('../src/utils/markdown')
const { sanitizeRichText } = await import('../src/utils/rich-text')

describe('security hardening', () => {
  it('rejects local and non-HTTPS external URLs', () => {
    expect(() => assertSafeExternalUrl('http://example.com')).toThrow('HTTPS')
    expect(() => assertSafeExternalUrl('https://localhost:8787')).toThrow('内网')
    expect(() => assertSafeExternalUrl('https://127.0.0.1')).toThrow('内网')
    expect(() => assertSafeExternalUrl('https://169.254.169.254/latest/meta-data')).toThrow('内网')
    expect(normalizeUrlBase('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
  })

  it('strips data image URLs from rich text and markdown HTML', () => {
    expect(sanitizeRichText('<p>Hi<img src="data:image/png;base64,aaaa" alt="x"></p>')).not.toContain('data:image')
    expect(markdownToSafeHtml('![x](data:image/png;base64,aaaa)')).not.toContain('data:image')
  })

  it('requires a configured secret for signed sessions', async () => {
    const request = new Request('https://example.com/')
    await expect(createSessionCookie(request, {}, 'user_1')).rejects.toThrow('SESSION_SECRET')

    const cookie = await createSessionCookie(request, { NOTIFY_SECRET_KEY: 'test-secret' }, 'user_1')
    expect(await readSessionUserId(new Request('https://example.com/', { headers: { cookie } }), { NOTIFY_SECRET_KEY: 'test-secret' })).toBe('user_1')
    expect(await readSessionUserId(new Request('https://example.com/', { headers: { cookie } }), {})).toBe('')
  })
})
