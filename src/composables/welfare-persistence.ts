import type { CreateAdminPayload, LoginAdminPayload, ReviewCollaborationApplicationPayload, ReviewDeliveryPayload, SubmitApplicationPayload, SubmitCollaborationApplicationPayload, SubmitDeliveryPayload, SubmitResourceApplicationPayload, SubmitStudentPayload, User, UserProfile, UserRole, WelfareState } from './welfare'

const STATE_ENDPOINT = '/api/welfare-state'
const BOOTSTRAP_ENDPOINT = '/api/bootstrap'
const SESSION_ENDPOINT = '/api/session'
const APPLICATION_SUBMIT_ENDPOINT = '/api/applications/submit'
const STATE_REQUEST_TIMEOUT_MS = 10000
let currentWelfareStateVersion = 0

interface BootstrapPayload {
  hasAdmin: boolean
  siteBanner?: WelfareState['siteBanner']
  systemConfig?: WelfareState['systemConfig']
  createdAt: string
}

interface WelfareStatePayload {
  state: Partial<WelfareState>
  currentUserId?: string
  version?: number
}

export type SubmitApplicationCommand
  = | SubmitApplicationPayload
    | (SubmitResourceApplicationPayload & { type: 'resource', applicationId?: string })

async function requestState<T>(path = STATE_ENDPOINT, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STATE_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
      signal: controller.signal,
    })

    if (!response.ok)
      throw new Error(await readErrorMessage(response))

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json'))
      throw new Error('接口返回了页面内容，请使用 pnpm dev 启动 Cloudflare 本地环境后访问 Wrangler 地址')

    return response.json() as Promise<T>
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new Error('数据库接口响应超时，请检查生产数据库或 Hyperdrive 配置')

    throw error
  }
  finally {
    clearTimeout(timeout)
  }
}

function adminPlaceholderUser(): User {
  return {
    id: 'admin-present',
    role: 'admin',
    profile: {
      displayName: '管理员',
      email: '',
      studentVerified: false,
    },
    points: 0,
    accountStatus: 'active',
    createdAt: '',
    lastLoginAt: '',
  }
}

function mergeBootstrapAndSession(bootstrap: BootstrapPayload, currentUser: User | null): Partial<WelfareState> {
  const users = bootstrap.hasAdmin ? [adminPlaceholderUser()] : []
  if (currentUser) {
    const index = users.findIndex(user => user.id === currentUser.id)
    if (index >= 0)
      users[index] = currentUser
    else
      users.push(currentUser)
  }

  return {
    users,
    currentUserId: currentUser?.id,
    siteBanner: bootstrap.siteBanner,
    systemConfig: bootstrap.systemConfig,
    createdAt: bootstrap.createdAt,
  }
}

async function readErrorMessage(response: Response) {
  const fallback = '数据库状态同步失败'
  const text = await response.text()
  if (!text)
    return fallback

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || fallback
  }
  catch {
    if (text.trimStart().startsWith('<'))
      return '接口返回了页面内容，请使用 pnpm dev 启动 Cloudflare 本地环境后访问 Wrangler 地址'

    return text
  }
}

export async function loadInitialWelfareState() {
  const [bootstrap, session] = await Promise.all([
    requestState<BootstrapPayload>(BOOTSTRAP_ENDPOINT),
    requestState<{ currentUser: User | null }>(SESSION_ENDPOINT),
  ])
  return mergeBootstrapAndSession(bootstrap, session.currentUser)
}

export async function loadWelfareState(role?: UserRole) {
  const endpoint = role === 'admin' ? `${STATE_ENDPOINT}/admin` : `${STATE_ENDPOINT}/me`
  const result = await requestState<WelfareStatePayload>(endpoint)
  currentWelfareStateVersion = Math.trunc(Number(result.version || 0))
  return {
    ...result.state,
    currentUserId: result.currentUserId,
  }
}

export async function saveWelfareState(state: WelfareState, userId?: string) {
  const result = await requestState<{ ok: true, version?: number }>(STATE_ENDPOINT, {
    method: 'PUT',
    headers: userId ? { 'x-welfare-user-id': userId } : undefined,
    body: JSON.stringify({ state, version: currentWelfareStateVersion }),
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
}

export async function submitApplicationCommand(payload: SubmitApplicationCommand) {
  const result = await requestState<{ ok: true, applicationId: string, version?: number }>(APPLICATION_SUBMIT_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
  return result
}

export async function bootstrapAdmin(payload: CreateAdminPayload) {
  await requestState<{ ok: true }>(STATE_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'x-welfare-action': 'bootstrap-admin',
    },
  })
}

export async function loginAdmin(payload: LoginAdminPayload) {
  const result = await requestState<{ ok: true, userId: string, state?: Partial<WelfareState>, version?: number }>(STATE_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'x-welfare-action': 'login-admin',
    },
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
  return result
}

export async function endSession() {
  await requestState<{ ok: true }>(STATE_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-welfare-action': 'logout',
    },
  })
}

async function postWelfareAction<T>(action: string, payload: unknown) {
  const result = await requestState<T & { version?: number }>(STATE_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    headers: {
      'x-welfare-action': action,
    },
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
  return result
}

export async function submitCollaborationApplicationAction(payload: SubmitCollaborationApplicationPayload) {
  return postWelfareAction<{ ok: true }>('submit-collaboration-application', payload)
}

export async function reviewCollaborationApplicationAction(payload: ReviewCollaborationApplicationPayload) {
  return postWelfareAction<{ ok: true }>('review-collaboration-application', payload)
}

export async function claimDeliveryApplicationAction(applicationId: string) {
  return postWelfareAction<{ ok: true }>('claim-delivery-application', { applicationId })
}

export async function cancelDeliveryClaimAction(applicationId: string) {
  return postWelfareAction<{ ok: true }>('cancel-delivery-claim', { applicationId })
}

export async function submitDeliveryResultAction(payload: SubmitDeliveryPayload) {
  return postWelfareAction<{ ok: true }>('submit-delivery-result', payload)
}

export async function reviewDeliveryResultAction(payload: ReviewDeliveryPayload) {
  return postWelfareAction<{ ok: true }>('review-delivery-result', payload)
}

export async function updateCurrentProfileAction(profile: Partial<UserProfile>) {
  return postWelfareAction<{ ok: true }>('update-current-profile', { profile })
}

export async function checkInTodayAction() {
  return postWelfareAction<{ ok: true, checkIn?: WelfareState['dailyCheckIns'][number] }>('check-in-today', {})
}

export async function bindInvitationCodeAction(code: string) {
  return postWelfareAction<{ ok: true }>('bind-invitation-code', { code })
}

export async function vouchInvitationAction(bindingId: string) {
  return postWelfareAction<{ ok: true }>('vouch-invitation', { bindingId })
}

export async function redeemCouponCodeAction(code: string) {
  return postWelfareAction<{ ok: true, coupon?: WelfareState['coupons'][number] }>('redeem-coupon-code', { code })
}

export async function boostSquarePostAction(postId: string, declaration: string) {
  return postWelfareAction<{ ok: true }>('boost-square-post', { postId, declaration })
}

export async function reportSquareBoostAction(boostId: string, reason: string) {
  return postWelfareAction<{ ok: true }>('report-square-boost', { boostId, reason })
}

export async function submitApplicationSupplementAction(applicationId: string, content: string, attachments: unknown[] = []) {
  return postWelfareAction<{ ok: true }>('submit-application-supplement', { applicationId, content, attachments })
}

export async function submitStudentVerificationAction(payload: SubmitStudentPayload) {
  return postWelfareAction<{ ok: true, verificationId?: string }>('submit-student-verification', payload)
}

export async function supplementStudentVerificationAction(payload: SubmitStudentPayload) {
  return postWelfareAction<{ ok: true, verificationId?: string }>('supplement-student-verification', payload)
}
