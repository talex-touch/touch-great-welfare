import { StateVersionConflictError } from './state-store'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

export function forbidden(message = '需要管理员权限') {
  return json({ error: message }, 403)
}

export function errorResponse(error: unknown) {
  if (error instanceof StateVersionConflictError) {
    return json({
      code: 'STATE_VERSION_CONFLICT',
      error: error.message,
    }, 409)
  }

  const message = error instanceof Error ? error.message : '服务端错误'
  return json({ error: message }, message === '请先登录' ? 401 : 500)
}

export async function readPayload(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as { state?: unknown }
}
