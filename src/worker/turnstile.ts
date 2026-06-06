import type { WorkerEnv } from './welfare-state'
import { errorResponse, fetchWithTimeout, getAuthenticatedRequest, json, readJson } from './auth'

interface VerifyTurnstilePayload {
  token?: string
}

interface TurnstileSiteVerifyResult {
  'success'?: boolean
  'error-codes'?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function configuredTurnstileSecret(state: unknown, env: WorkerEnv) {
  const policy = isRecord(state) && isRecord(state.applicationPolicy)
    ? state.applicationPolicy
    : {}
  const savedSecret = typeof policy.turnstileSecretKey === 'string'
    ? policy.turnstileSecretKey.trim()
    : ''

  return savedSecret || env.TURNSTILE_SECRET_KEY?.trim() || ''
}

export async function handleTurnstileRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/turnstile'.length) || '/'

    if (path !== '/verify' || request.method !== 'POST')
      return json({ error: 'Not Found' }, 404)

    const auth = await getAuthenticatedRequest(request, env)
    const secret = configuredTurnstileSecret(auth.state, env)
    if (!secret)
      throw new Error('Turnstile Secret Key 未配置')

    const payload = await readJson<VerifyTurnstilePayload>(request)
    const token = payload.token?.trim()
    if (!token)
      throw new Error('缺少 Turnstile token')

    const form = new FormData()
    form.set('secret', secret)
    form.set('response', token)
    form.set('remoteip', request.headers.get('cf-connecting-ip') ?? '')

    const response = await fetchWithTimeout('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
    const result = await response.json().catch(() => ({})) as TurnstileSiteVerifyResult
    if (!response.ok || !result.success)
      throw new Error(`Turnstile 校验失败：${result['error-codes']?.join(', ') || response.status}`)

    return json({ ok: true })
  }
  catch (error) {
    return errorResponse(error)
  }
}
