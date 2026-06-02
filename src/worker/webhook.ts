import type { WorkerEnv } from './welfare-state'
import { errorResponse, json } from './auth'
import { recordIntegrationEvent } from './notifications'

export async function handleWebhookRequest(request: Request, env: WorkerEnv) {
  try {
    if (request.method !== 'POST')
      return json({ error: 'Method Not Allowed' }, 405)

    const url = new URL(request.url)
    const provider = url.pathname.slice('/api/webhooks/'.length).trim()
    if (!provider)
      return json({ error: 'provider is required' }, 400)

    const text = await request.text()
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
      const url = new URL(request.url)
      await recordIntegrationEvent(env, url.pathname.slice('/api/webhooks/'.length), '', '', false, {}, 'failed', error instanceof Error ? error.message : 'webhook failed')
    }
    catch {}
    return errorResponse(error)
  }
}
