import type { WorkerEnv } from './welfare-state'
import type { User, WelfareState } from '~/shared/welfare-types'
import { authenticatedUserId } from './session'
import { readWelfareState } from './welfare-state'

export interface AuthenticatedRequest {
  state: WelfareState
  user: User
}

export function now() {
  return new Date().toISOString()
}

export function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

export function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : '服务端错误'
  return json({ error: message }, message === '请先登录' ? 401 : status)
}

export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as T
}

export function assertWelfareState(input: Partial<WelfareState>): asserts input is WelfareState {
  if (!Array.isArray(input.users))
    throw new Error('用户状态未初始化')
  if (!Array.isArray(input.applications))
    throw new Error('申请状态未初始化')
  if (!Array.isArray(input.studentVerifications))
    throw new Error('学生认证状态未初始化')
  if (!Array.isArray(input.educationEmailChallenges))
    input.educationEmailChallenges = []
  if (!Array.isArray(input.coupons))
    input.coupons = []
  if (!Array.isArray(input.dailyCheckIns))
    input.dailyCheckIns = []
  if (!Array.isArray(input.invitationBindings))
    input.invitationBindings = []
  if (!Array.isArray(input.crowdReviews))
    input.crowdReviews = []
  if (!Array.isArray(input.squarePosts))
    input.squarePosts = []
  if (!Array.isArray(input.squareBoosts))
    input.squareBoosts = []
  if (!Array.isArray(input.squareReports))
    input.squareReports = []
  if (!Array.isArray(input.transactions))
    throw new Error('积分流水状态未初始化')
}

export async function getAuthenticatedRequest(request: Request, env: WorkerEnv): Promise<AuthenticatedRequest> {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)

  const userId = await authenticatedUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')

  return { state, user }
}

export async function assertAdminRequest(request: Request, env: WorkerEnv) {
  const auth = await getAuthenticatedRequest(request, env)
  if (auth.user.role !== 'admin')
    throw new Error('需要管理员权限')

  return auth
}

export function maskSecret(value?: string | null) {
  const text = value?.trim() ?? ''
  if (!text)
    return ''
  if (text.length <= 8)
    return '••••'
  return `${text.slice(0, 4)}••••${text.slice(-4)}`
}

export async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  }
  finally {
    clearTimeout(timer)
  }
}

export function boolValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return true
  if (host === '0.0.0.0' || host === '::' || host === '::1')
    return true

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4)
    return false

  const [, aText, bText] = ipv4
  const a = Number(aText)
  const b = Number(bText)
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
}

export function assertSafeExternalUrl(value: string, options: { allowHttp?: boolean, allowLocalhost?: boolean } = {}) {
  const text = value.trim()
  if (!text)
    throw new Error('URL 不能为空')

  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    throw new Error('URL 格式无效')
  }

  const allowedProtocols = options.allowHttp ? ['https:', 'http:'] : ['https:']
  if (!allowedProtocols.includes(url.protocol))
    throw new Error('URL 必须使用 HTTPS')
  if (!options.allowLocalhost && isPrivateHost(url.hostname))
    throw new Error('URL 不能指向本地或内网地址')
  url.username = ''
  url.password = ''
  return url
}

export function normalizeUrlBase(value: string, options: { allowHttp?: boolean, allowLocalhost?: boolean } = {}) {
  const text = value.trim().replace(/\/+$/, '')
  if (!text)
    return ''
  const url = assertSafeExternalUrl(text, options)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}
