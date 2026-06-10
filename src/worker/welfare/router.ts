import type { WorkerEnv } from './core'
import type { WelfareState } from '~/composables/welfare'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { dispatchWelfareStateChangeNotifications } from '../notifications'
import { syncUserPointBalancesFromLedger } from '../points'
import { clearSessionCookie } from '../session'
import {
  addAdminApplicationMessageAction,
  addCurrentUserApplicationMessageAction,
  adjustAdminUserPointsAction,
  adminApplicationsResponse,
  adminConfigResponse,
  adminStateResponse,
  adminVerificationsResponse,
  answerAdminApplicationAction,
  assertStateShape,
  bindInvitationCodeAction,
  boostSquarePostAction,
  bootstrapAdmin,
  bootstrapResponse,
  cancelDeliveryClaim,
  checkInTodayAction,
  claimDeliveryApplication,
  collaborationStateResponse,
  completeAdminApplicationAction,
  completeAdminApplicationAllocationAction,
  completeAdminResourceProvisionAction,
  createAdminCouponCodeAction,
  createAdminCouponTemplateAction,
  createEducationEmailChallengeAction,
  createSquarePostAction,
  currentStateResponse,
  currentUserApplicationsResponse,
  currentUserProfileResponse,
  currentUserStateResponse,
  currentUserVerificationResponse,
  currentUserWalletResponse,
  errorResponse,
  forbidden,
  grantAdminCouponsAction,
  isAdminUser,
  isRecord,
  json,
  loginAdmin,
  mergeSensitiveWelfareState,
  publicConfigResponse,
  readPayload,
  readWelfareStateRecord,
  redeemCouponCodeAction,
  rejectAdminApplicationAction,
  reportSquareBoostAction,
  requestAdminApplicationSupplementAction,
  requestCurrentUserResourceLifecycleAction,
  requestUserId,
  reviewAdminApplicationItemAction,
  reviewAdminStudentVerificationAction,
  reviewCollaborationApplication,
  reviewDeliveryResult,
  revokeAdminStudentVerificationAction,
  sessionResponse,
  squareStateResponse,
  StateVersionConflictError,
  submitAdminStudentVerificationAction,
  submitApplicationSupplementAction,
  submitCollaborationApplication,
  submitCrowdReviewAction,
  submitDeliveryResult,
  submitStudentVerificationAction,
  supplementStudentVerificationAction,
  unbindAdminUserGithubAction,
  updateAdminApplicationPolicyAction,
  updateAdminOauthAction,
  updateAdminResourceLifecycleAction,
  updateAdminSiteBannerAction,
  updateAdminSystemConfigAction,
  updateAdminUserRoleAction,
  updateAdminUserStudentVerifiedAction,
  updateAdminUserSuspensionAction,
  updateCurrentProfileAction,
  vouchInvitationAction,
  writeWelfareState,
} from './core'

export { handleApplicationSubmitRequest } from './core'

function sessionLogoutResponse(request: Request) {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) })
}

function changedPointUserIds(previousState: Partial<WelfareState>, nextState: unknown) {
  if (!isRecord(nextState) || !Array.isArray(nextState.users))
    return []

  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const previousPointsByUserId = new Map(previousUsers.map(user => [user.id, user.points]))
  const userIds = new Set<string>()

  for (const user of nextState.users) {
    if (!isRecord(user) || typeof user.id !== 'string')
      continue

    const previousPoints = previousPointsByUserId.get(user.id)
    if (previousPoints !== undefined && user.points !== previousPoints)
      userIds.add(user.id)
  }

  return Array.from(userIds)
}

function preserveServerPointState(previousState: Partial<WelfareState>, nextState: unknown) {
  if (!isRecord(nextState))
    return

  nextState.transactions = []
  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const previousPointsByUserId = new Map(previousUsers.map(user => [user.id, user.points]))
  if (!Array.isArray(nextState.users))
    return

  for (const user of nextState.users) {
    if (!isRecord(user) || typeof user.id !== 'string')
      continue

    const points = previousPointsByUserId.get(user.id)
    if (points !== undefined)
      user.points = points
  }
}

async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')
  const previousRecord = await readWelfareStateRecord(env)
  const previousState = previousRecord.state as Partial<WelfareState>
  const currentVersion = previousRecord.version
  if (!isAdminUser(previousState, userId))
    return forbidden('全量状态保存仅允许管理员使用')

  const payload = await readPayload(request) as { state?: unknown, version?: unknown }
  const expectedVersion = Math.trunc(Number(payload.version))
  if (!Number.isFinite(expectedVersion) || expectedVersion <= 0) {
    return json({
      code: 'STATE_VERSION_REQUIRED',
      error: '保存业务状态必须携带有效 version',
    }, 400)
  }
  if (expectedVersion !== currentVersion)
    throw new StateVersionConflictError()
  assertStateShape(payload.state)
  const statePayload = payload.state
  const pointUserIds = changedPointUserIds(previousState, statePayload)
  if (pointUserIds.length)
    await syncUserPointBalancesFromLedger(env, previousState, pointUserIds)

  const mergedSensitiveState = await mergeSensitiveWelfareState(previousState, statePayload, request, env)
  preserveServerPointState(previousState, mergedSensitiveState)
  const nextState = applyWelfareRetentionPolicy(mergedSensitiveState).state
  if (isRecord(nextState))
    delete nextState.currentUserId
  const nextVersion = await writeWelfareState(env, nextState, { expectedVersion })
  await dispatchWelfareStateChangeNotifications(env, previousState, nextState as Partial<WelfareState>)
  return json({ ok: true, version: nextVersion })
}

async function handleLegacyAction(request: Request, env: WorkerEnv, action: string) {
  if (action === 'bootstrap-admin')
    return await bootstrapAdmin(request, env)
  if (action === 'login-admin')
    return await loginAdmin(request, env)
  if (action === 'logout')
    return sessionLogoutResponse(request)
  if (action === 'submit-collaboration-application')
    return await submitCollaborationApplication(request, env)
  if (action === 'review-collaboration-application')
    return await reviewCollaborationApplication(request, env)
  if (action === 'claim-delivery-application')
    return await claimDeliveryApplication(request, env)
  if (action === 'cancel-delivery-claim')
    return await cancelDeliveryClaim(request, env)
  if (action === 'submit-delivery-result')
    return await submitDeliveryResult(request, env)
  if (action === 'review-delivery-result')
    return await reviewDeliveryResult(request, env)
  if (action === 'update-current-profile')
    return await updateCurrentProfileAction(request, env)
  if (action === 'check-in-today')
    return await checkInTodayAction(request, env)
  if (action === 'bind-invitation-code')
    return await bindInvitationCodeAction(request, env)
  if (action === 'vouch-invitation')
    return await vouchInvitationAction(request, env)
  if (action === 'redeem-coupon-code')
    return await redeemCouponCodeAction(request, env)
  if (action === 'boost-square-post')
    return await boostSquarePostAction(request, env)
  if (action === 'report-square-boost')
    return await reportSquareBoostAction(request, env)
  if (action === 'submit-application-supplement')
    return await submitApplicationSupplementAction(request, env)
  if (action === 'submit-student-verification')
    return await submitStudentVerificationAction(request, env)
  if (action === 'supplement-student-verification')
    return await supplementStudentVerificationAction(request, env)
  return undefined
}

export async function handleWelfareStateRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      if (url.pathname === '/api/bootstrap')
        return await bootstrapResponse(env)
      if (url.pathname === '/api/session')
        return await sessionResponse(request, env)
      if (url.pathname === '/api/me')
        return await currentUserProfileResponse(request, env)
      if (url.pathname === '/api/config/public')
        return await publicConfigResponse(env)
      if (url.pathname === '/api/applications/mine')
        return await currentUserApplicationsResponse(request, env)
      if (url.pathname === '/api/wallet/summary')
        return await currentUserWalletResponse(request, env)
      if (url.pathname === '/api/verifications/mine')
        return await currentUserVerificationResponse(request, env)
      if (url.pathname === '/api/square/posts')
        return await squareStateResponse(request, env)
      if (url.pathname === '/api/collaboration/mine')
        return await collaborationStateResponse(request, env)
      if (url.pathname === '/api/admin/welfare/state')
        return await adminStateResponse(request, env)
      if (url.pathname === '/api/admin/config/welfare')
        return await adminConfigResponse(request, env)
      if (url.pathname === '/api/admin/applications')
        return await adminApplicationsResponse(request, env)
      if (url.pathname === '/api/admin/verifications')
        return await adminVerificationsResponse(request, env)
      if (url.pathname === '/api/welfare-state/me')
        return await currentUserStateResponse(request, env)
      if (url.pathname === '/api/welfare-state/admin')
        return await adminStateResponse(request, env)
      if (url.pathname === '/api/welfare-state')
        return currentStateResponse(request, env)
    }

    if (request.method === 'DELETE') {
      if (url.pathname === '/api/session')
        return sessionLogoutResponse(request)
    }

    if (request.method === 'PATCH') {
      if (url.pathname === '/api/me/profile')
        return await updateCurrentProfileAction(request, env)
    }

    if (request.method === 'PUT') {
      if (url.pathname === '/api/admin/config/system')
        return await updateAdminSystemConfigAction(request, env)
      if (url.pathname === '/api/admin/config/application-policy')
        return await updateAdminApplicationPolicyAction(request, env)
      if (url.pathname === '/api/admin/config/site-banner')
        return await updateAdminSiteBannerAction(request, env)
      if (url.pathname === '/api/admin/config/oauth')
        return await updateAdminOauthAction(request, env)
      if (url.pathname === '/api/welfare-state')
        return await legacyFullStateSave(request, env)
    }

    if (request.method === 'POST') {
      if (url.pathname === '/api/session/admin/bootstrap')
        return await bootstrapAdmin(request, env)
      if (url.pathname === '/api/session/admin/login')
        return await loginAdmin(request, env)
      if (url.pathname === '/api/check-ins/today')
        return await checkInTodayAction(request, env)
      if (url.pathname === '/api/invitations/bind')
        return await bindInvitationCodeAction(request, env)
      if (url.pathname === '/api/invitations/vouch')
        return await vouchInvitationAction(request, env)
      if (url.pathname === '/api/coupons/redeem')
        return await redeemCouponCodeAction(request, env)
      if (url.pathname === '/api/square/posts')
        return await createSquarePostAction(request, env)
      if (url.pathname === '/api/square/boosts')
        return await boostSquarePostAction(request, env)
      if (url.pathname === '/api/square/reports')
        return await reportSquareBoostAction(request, env)
      if (url.pathname === '/api/applications/supplements')
        return await submitApplicationSupplementAction(request, env)
      if (url.pathname === '/api/applications/messages')
        return await addCurrentUserApplicationMessageAction(request, env)
      if (url.pathname === '/api/applications/resource-lifecycle')
        return await requestCurrentUserResourceLifecycleAction(request, env)
      if (url.pathname === '/api/verifications/student')
        return await submitStudentVerificationAction(request, env)
      if (url.pathname === '/api/verifications/student/supplement')
        return await supplementStudentVerificationAction(request, env)
      if (url.pathname === '/api/verifications/education-email-challenges')
        return await createEducationEmailChallengeAction(request, env)
      if (url.pathname === '/api/collaboration/applications')
        return await submitCollaborationApplication(request, env)
      if (url.pathname === '/api/collaboration/applications/review')
        return await reviewCollaborationApplication(request, env)
      if (url.pathname === '/api/collaboration/crowd-reviews')
        return await submitCrowdReviewAction(request, env)
      if (url.pathname === '/api/deliveries/claim')
        return await claimDeliveryApplication(request, env)
      if (url.pathname === '/api/deliveries/cancel-claim')
        return await cancelDeliveryClaim(request, env)
      if (url.pathname === '/api/deliveries/submit')
        return await submitDeliveryResult(request, env)
      if (url.pathname === '/api/deliveries/review')
        return await reviewDeliveryResult(request, env)
      if (url.pathname === '/api/admin/users/role')
        return await updateAdminUserRoleAction(request, env)
      if (url.pathname === '/api/admin/users/suspension')
        return await updateAdminUserSuspensionAction(request, env)
      if (url.pathname === '/api/admin/users/student-verification')
        return await updateAdminUserStudentVerifiedAction(request, env)
      if (url.pathname === '/api/admin/users/revoke-student-verification')
        return await revokeAdminStudentVerificationAction(request, env)
      if (url.pathname === '/api/admin/users/github-unbind')
        return await unbindAdminUserGithubAction(request, env)
      if (url.pathname === '/api/admin/users/points')
        return await adjustAdminUserPointsAction(request, env)
      if (url.pathname === '/api/admin/applications/review-item')
        return await reviewAdminApplicationItemAction(request, env)
      if (url.pathname === '/api/admin/applications/complete-provision')
        return await completeAdminResourceProvisionAction(request, env)
      if (url.pathname === '/api/admin/applications/complete-allocation')
        return await completeAdminApplicationAllocationAction(request, env)
      if (url.pathname === '/api/admin/applications/resource-lifecycle')
        return await updateAdminResourceLifecycleAction(request, env)
      if (url.pathname === '/api/admin/applications/answer')
        return await answerAdminApplicationAction(request, env)
      if (url.pathname === '/api/admin/applications/reject')
        return await rejectAdminApplicationAction(request, env)
      if (url.pathname === '/api/admin/applications/complete')
        return await completeAdminApplicationAction(request, env)
      if (url.pathname === '/api/admin/applications/request-supplement')
        return await requestAdminApplicationSupplementAction(request, env)
      if (url.pathname === '/api/admin/applications/messages')
        return await addAdminApplicationMessageAction(request, env)
      if (url.pathname === '/api/admin/verifications/student')
        return await submitAdminStudentVerificationAction(request, env)
      if (url.pathname === '/api/admin/verifications/student/review')
        return await reviewAdminStudentVerificationAction(request, env)
      if (url.pathname === '/api/admin/coupons/templates')
        return await createAdminCouponTemplateAction(request, env)
      if (url.pathname === '/api/admin/coupons/codes')
        return await createAdminCouponCodeAction(request, env)
      if (url.pathname === '/api/admin/coupons/grants')
        return await grantAdminCouponsAction(request, env)

      const action = request.headers.get('x-welfare-action')?.trim()
      if (action) {
        const legacyResponse = await handleLegacyAction(request, env, action)
        if (legacyResponse)
          return legacyResponse
      }
    }

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
