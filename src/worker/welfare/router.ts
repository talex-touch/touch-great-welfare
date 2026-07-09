import type { WorkerEnv } from './core'
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
  grantAdminCouponsAction,
  json,
  loginAdmin,
  publicConfigResponse,
  redeemCouponCodeAction,
  rejectAdminApplicationAction,
  reportSquareBoostAction,
  requestAdminApplicationSupplementAction,
  requestCurrentUserResourceLifecycleAction,
  reviewAdminApplicationItemAction,
  reviewAdminStudentVerificationAction,
  reviewCollaborationApplication,
  reviewDeliveryResult,
  revokeAdminStudentVerificationAction,
  sessionResponse,
  squareStateResponse,
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
} from './core'
import { legacyFullStateSave } from './legacy-state-write'

export { handleApplicationSubmitRequest } from './core'

function sessionLogoutResponse(request: Request) {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) })
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
