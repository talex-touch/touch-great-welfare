import type { ApplicationMessageType, ApplicationPolicyConfig, CompleteProvisionPayload, CreateAdminPayload, CreateSquarePostPayload, CrowdReviewDecision, CrowdReviewTargetType, LoginAdminPayload, OauthConfig, RejectApplicationOptions, ReviewApplicationItemPayload, ReviewCollaborationApplicationPayload, ReviewDeliveryPayload, SiteBannerConfig, SubmitApplicationPayload, SubmitCollaborationApplicationPayload, SubmitDeliveryPayload, SubmitResourceApplicationPayload, SubmitStudentPayload, SystemConfig, User, UserProfile, UserRole, WelfareState } from '../welfare'

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

export async function loadLegacyWelfareState(role?: UserRole) {
  const endpoint = role === 'admin' ? `${STATE_ENDPOINT}/admin` : `${STATE_ENDPOINT}/me`
  const result = await requestState<WelfareStatePayload>(endpoint)
  currentWelfareStateVersion = Math.trunc(Number(result.version || 0))
  return {
    ...result.state,
    currentUserId: result.currentUserId,
  }
}

export async function loadWelfareState(role?: UserRole) {
  const endpoint = role === 'admin' ? '/api/admin/welfare/state' : `${STATE_ENDPOINT}/me`
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
  await requestState<{ ok: true }>('/api/session/admin/bootstrap', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function loginAdmin(payload: LoginAdminPayload) {
  const result = await requestState<{ ok: true, userId: string, state?: Partial<WelfareState>, version?: number }>('/api/session/admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
  return result
}

export async function endSession() {
  await requestState<{ ok: true }>(SESSION_ENDPOINT, {
    method: 'DELETE',
  })
}

async function postDomainAction<T>(path: string, payload: unknown = {}, method = 'POST') {
  const result = await requestState<T & { version?: number }>(path, {
    method,
    body: JSON.stringify(payload ?? {}),
  })
  currentWelfareStateVersion = Math.trunc(Number(result.version || currentWelfareStateVersion))
  return result
}

export async function submitCollaborationApplicationAction(payload: SubmitCollaborationApplicationPayload) {
  return postDomainAction<{ ok: true }>('/api/collaboration/applications', payload)
}

export async function reviewCollaborationApplicationAction(payload: ReviewCollaborationApplicationPayload) {
  return postDomainAction<{ ok: true }>('/api/collaboration/applications/review', payload)
}

export async function submitCrowdReviewAction(targetType: CrowdReviewTargetType, targetId: string, decision: CrowdReviewDecision, note: string) {
  return postDomainAction<{ ok: true }>('/api/collaboration/crowd-reviews', { targetType, targetId, decision, note })
}

export async function claimDeliveryApplicationAction(applicationId: string) {
  return postDomainAction<{ ok: true }>('/api/deliveries/claim', { applicationId })
}

export async function cancelDeliveryClaimAction(applicationId: string) {
  return postDomainAction<{ ok: true }>('/api/deliveries/cancel-claim', { applicationId })
}

export async function submitDeliveryResultAction(payload: SubmitDeliveryPayload) {
  return postDomainAction<{ ok: true }>('/api/deliveries/submit', payload)
}

export async function reviewDeliveryResultAction(payload: ReviewDeliveryPayload) {
  return postDomainAction<{ ok: true }>('/api/deliveries/review', payload)
}

export async function updateCurrentProfileAction(profile: Partial<UserProfile>) {
  return postDomainAction<{ ok: true }>('/api/me/profile', { profile }, 'PATCH')
}

export async function checkInTodayAction() {
  return postDomainAction<{ ok: true, checkIn?: WelfareState['dailyCheckIns'][number] }>('/api/check-ins/today')
}

export async function bindInvitationCodeAction(code: string) {
  return postDomainAction<{ ok: true }>('/api/invitations/bind', { code })
}

export async function vouchInvitationAction(bindingId: string) {
  return postDomainAction<{ ok: true }>('/api/invitations/vouch', { bindingId })
}

export async function redeemCouponCodeAction(code: string) {
  return postDomainAction<{ ok: true, coupon?: WelfareState['coupons'][number] }>('/api/coupons/redeem', { code })
}

export async function createSquarePostAction(payload: CreateSquarePostPayload) {
  return postDomainAction<{ ok: true, post?: WelfareState['squarePosts'][number] }>('/api/square/posts', payload)
}

export async function boostSquarePostAction(postId: string, declaration: string) {
  return postDomainAction<{ ok: true }>('/api/square/boosts', { postId, declaration })
}

export async function reportSquareBoostAction(boostId: string, reason: string) {
  return postDomainAction<{ ok: true }>('/api/square/reports', { boostId, reason })
}

export async function submitApplicationSupplementAction(applicationId: string, content: string, attachments: unknown[] = []) {
  return postDomainAction<{ ok: true }>('/api/applications/supplements', { applicationId, content, attachments })
}

export async function submitStudentVerificationAction(payload: SubmitStudentPayload) {
  return postDomainAction<{ ok: true, verificationId?: string }>('/api/verifications/student', payload)
}

export async function supplementStudentVerificationAction(payload: SubmitStudentPayload) {
  return postDomainAction<{ ok: true, verificationId?: string }>('/api/verifications/student/supplement', payload)
}

export async function createEducationEmailChallengeAction(email: string, realName = '') {
  return postDomainAction<{ ok: true, challenge: WelfareState['educationEmailChallenges'][number] }>('/api/verifications/education-email-challenges', { email, realName })
}

export async function updateSystemConfigAction(systemConfig: Partial<SystemConfig>) {
  return postDomainAction<{ ok: true, systemConfig?: SystemConfig }>('/api/admin/config/system', { systemConfig }, 'PUT')
}

export async function updateApplicationPolicyAction(applicationPolicy: Partial<ApplicationPolicyConfig>) {
  return postDomainAction<{ ok: true, applicationPolicy?: ApplicationPolicyConfig }>('/api/admin/config/application-policy', { applicationPolicy }, 'PUT')
}

export async function updateSiteBannerAction(siteBanner: Partial<SiteBannerConfig>) {
  return postDomainAction<{ ok: true, siteBanner?: SiteBannerConfig }>('/api/admin/config/site-banner', { siteBanner }, 'PUT')
}

export async function updateOauthConfigAction(oauth: Partial<OauthConfig>) {
  return postDomainAction<{ ok: true, oauth?: OauthConfig }>('/api/admin/config/oauth', { oauth }, 'PUT')
}

export async function reviewApplicationItemAction(payload: ReviewApplicationItemPayload) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/review-item', payload)
}

export async function completeResourceProvisionAction(payload: CompleteProvisionPayload) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/complete-provision', payload)
}

export async function answerApplicationAction(applicationId: string, answer: string) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/answer', { applicationId, answer })
}

export async function rejectApplicationAction(applicationId: string, reason: string, options: RejectApplicationOptions = {}) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/reject', { applicationId, reason, ...options })
}

export async function completeApplicationAction(applicationId: string) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/complete', { applicationId })
}

export async function requestApplicationSupplementAdminAction(applicationId: string, content: string) {
  return postDomainAction<{ ok: true }>('/api/admin/applications/request-supplement', { applicationId, content })
}

export async function addApplicationMessageAction(applicationId: string, type: ApplicationMessageType, content: string, attachments: unknown[] = [], admin = false) {
  return postDomainAction<{ ok: true }>(admin ? '/api/admin/applications/messages' : '/api/applications/messages', { applicationId, type, content, attachments })
}

export async function reviewStudentVerificationAction(id: string, status: 'approved' | 'needs_supplement' | 'rejected', reply: string) {
  return postDomainAction<{ ok: true }>('/api/admin/verifications/student/review', { id, status, reply })
}

export async function createCouponTemplateAction(payload: { name: string, description?: string, enabled?: boolean, rule: unknown, ttlDays?: number, totalGrantLimit?: number }) {
  return postDomainAction<{ ok: true, template?: WelfareState['couponTemplates'][number] }>('/api/admin/coupons/templates', payload)
}

export async function createCouponCodeAction(payload: { templateId: string, code?: string, maxRedemptions?: number, perUserLimit?: number, expiresAt?: string }) {
  return postDomainAction<{ ok: true, code?: WelfareState['couponCodes'][number] }>('/api/admin/coupons/codes', payload)
}

export async function grantCouponsAction(userIds: string[], templateId: string) {
  return postDomainAction<{ ok: true, coupons?: WelfareState['coupons'] }>('/api/admin/coupons/grants', { userIds, templateId })
}

export async function setUserCrowdReviewerAction(userId: string, enabled: boolean) {
  return postDomainAction<{ ok: true }>('/api/admin/users/role', { userId, enabled })
}

export async function setUserSuspendedAction(userId: string, suspended: boolean, reason = '') {
  return postDomainAction<{ ok: true }>('/api/admin/users/suspension', { userId, suspended, reason })
}

export async function setUserStudentVerifiedAction(userId: string, verified: boolean) {
  return postDomainAction<{ ok: true }>('/api/admin/users/student-verification', { userId, verified })
}

export async function revokeUserStudentVerificationAction(userId: string, reason: string) {
  return postDomainAction<{ ok: true }>('/api/admin/users/revoke-student-verification', { userId, reason })
}

export async function unbindUserGitHubAction(userId: string) {
  return postDomainAction<{ ok: true }>('/api/admin/users/github-unbind', { userId })
}

export async function adjustUserPointsAction(userId: string, amount: number, reason: string) {
  return postDomainAction<{ ok: true }>('/api/admin/users/points', { userId, amount, reason })
}
