import type { WorkerEnv } from './welfare-state'
import { errorResponse, json } from './auth'
import { base64UrlEncode, bytesToHex } from './crypto'
import { recordIntegrationEvent } from './notifications'

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

function webhookSecret(env: WorkerEnv, provider: string) {
  const providerKey = `WEBHOOK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
  const dynamicEnv = env as unknown as Record<string, string | undefined>
  return dynamicEnv[providerKey]?.trim() || env.WEBHOOK_SECRET?.trim() || ''
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  if (leftBytes.length !== rightBytes.length)
    return false

  let diff = 0
  for (let index = 0; index < leftBytes.length; index += 1)
    diff |= leftBytes[index] ^ rightBytes[index]
  return diff === 0
}

async function hmacSha256(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
}

async function verifyWebhookSignature(request: Request, body: string, secret: string) {
  const signature = request.headers.get('x-webhook-signature')
    || request.headers.get('x-hub-signature-256')
    || request.headers.get('x-signature')
    || ''
  if (!signature)
    return false

  const digest = await hmacSha256(secret, body)
  const hex = bytesToHex(digest)
  const base64Url = base64UrlEncode(digest)
  const candidates = [hex, `sha256=${hex}`, base64Url]
  return candidates.some(candidate => timingSafeEqual(signature.trim(), candidate))
}

async function readWebhookBody(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_WEBHOOK_BODY_BYTES)
    throw new Error('Webhook 请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_WEBHOOK_BODY_BYTES)
    throw new Error('Webhook 请求体过大')
  return text
}

export async function handleWebhookRequest(request: Request, env: WorkerEnv) {
  let provider = ''
  try {
    if (request.method !== 'POST')
      return json({ error: 'Method Not Allowed' }, 405)

    const url = new URL(request.url)
    provider = url.pathname.slice('/api/webhooks/'.length).trim().toLowerCase()
    if (!provider)
      return json({ error: 'provider is required' }, 400)

    const text = await readWebhookBody(request)
    const secret = webhookSecret(env, provider)
    if (!secret)
      return json({ error: 'Webhook secret is not configured' }, 503)

    const signatureValid = await verifyWebhookSignature(request, text, secret)
    if (!signatureValid)
      return json({ error: 'Invalid webhook signature' }, 401)

    let payload: unknown = text
    try {
      payload = JSON.parse(text || '{}') as Record<string, unknown>
    }
    catch {}

    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {}
    const eventId = String(record.id || record.event_id || request.headers.get('x-event-id') || '')
    const eventType = String(record.type || record.event || request.headers.get('x-event-type') || '')
    const id = await recordIntegrationEvent(env, provider, eventId, eventType, true, payload, 'processed')

    return json({ ok: true, id })
  }
  catch (error) {
    try {
      await recordIntegrationEvent(env, provider, '', '', false, {}, 'failed', error instanceof Error ? error.message : 'webhook failed')
    }
    catch {}
    return errorResponse(error)
  }
}
