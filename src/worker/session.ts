import type { WorkerEnv } from './welfare-state'
import { base64UrlDecode, base64UrlEncode } from './crypto'

const SESSION_COOKIE_NAME = 'tg_welfare_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

interface SessionPayload {
  userId: string
  expiresAt: number
}

function sessionSecret(env: WorkerEnv) {
  const secret = env.WELFARE_STATE_SECRET_KEY?.trim()
    || env.NOTIFY_SECRET_KEY?.trim()
  if (!secret)
    throw new Error('SESSION_SECRET 未配置：请设置 WELFARE_STATE_SECRET_KEY 或 NOTIFY_SECRET_KEY')
  return secret
}

async function sign(value: string, env: WorkerEnv) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(value))))
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key === name)
      return valueParts.join('=')
  }
  return ''
}

function encodePayload(payload: SessionPayload) {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(payload)))
}

function decodePayload(value: string): SessionPayload {
  return JSON.parse(textDecoder.decode(base64UrlDecode(value))) as SessionPayload
}

function cookieAttributes(request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export async function createSessionCookie(request: Request, env: WorkerEnv, userId: string) {
  const payload = encodePayload({
    userId,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  })
  return `${SESSION_COOKIE_NAME}=${payload}.${await sign(payload, env)}; ${cookieAttributes(request, SESSION_TTL_SECONDS)}`
}

export function clearSessionCookie(request: Request) {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(request, 0)}`
}

export async function readSessionUserId(request: Request, env: WorkerEnv) {
  const value = cookieValue(request, SESSION_COOKIE_NAME)
  if (!value)
    return ''

  const [payloadText, signature] = value.split('.')
  if (!payloadText || !signature)
    return ''

  let expectedSignature = ''
  try {
    expectedSignature = await sign(payloadText, env)
  }
  catch {
    return ''
  }
  if (expectedSignature !== signature)
    return ''

  const payload = decodePayload(payloadText)
  if (!payload.userId || payload.expiresAt < Date.now())
    return ''

  return payload.userId
}

export async function authenticatedUserId(request: Request, env: WorkerEnv) {
  return await readSessionUserId(request, env)
}
