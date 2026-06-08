import type { WorkerEnv } from './worker/welfare-state'
import { handleAiRequest } from './worker/ai'
import { handleDatabaseProvisionRequest } from './worker/database-provisioning'
import { handleEducationMailRequest } from './worker/education-mail'
import { handleGitHubAppRequest } from './worker/github-app'
import { handleNotificationRequest } from './worker/notifications'
import { handleOAuthRequest } from './worker/oauth'
import { handlePointRequest } from './worker/points'
import { handleRechargeRequest } from './worker/recharge'
import { handleSub2ApiRequest } from './worker/sub2api'
import { handleTurnstileRequest } from './worker/turnstile'
import { handleUploadRequest } from './worker/uploads'
import { handleWebhookRequest } from './worker/webhook'
import { handleApplicationSubmitRequest, handleWelfareStateRequest } from './worker/welfare-state'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Paths that receive external callbacks (signed or server-to-server) and are exempt from same-origin checks. */
function isExternalCallbackPath(pathname: string) {
  return pathname === '/api/recharge/notify'
    || pathname.startsWith('/api/webhooks/')
}

/** Reject browser-originated write requests from cross-origin to harden against CSRF. */
function rejectCrossOriginWrite(request: Request, url: URL) {
  if (SAFE_METHODS.has(request.method))
    return null
  if (isExternalCallbackPath(url.pathname))
    return null

  const origin = request.headers.get('origin')
  if (!origin)
    return null

  if (origin !== url.origin) {
    return new Response(JSON.stringify({ error: '不允许的跨源写请求' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  return null
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url)

    const blocked = rejectCrossOriginWrite(request, url)
    if (blocked)
      return blocked

    if (url.pathname === '/api/applications/submit')
      return handleApplicationSubmitRequest(request, env)
    if (url.pathname === '/api/bootstrap'
      || url.pathname === '/api/session'
      || url.pathname === '/api/me'
      || url.pathname === '/api/welfare-state'
      || url.pathname.startsWith('/api/welfare-state/')
      || url.pathname.startsWith('/api/config/')
      || url.pathname.startsWith('/api/wallet/')
      || url.pathname.startsWith('/api/applications/')
      || url.pathname.startsWith('/api/verifications/')
      || url.pathname.startsWith('/api/check-ins/')
      || url.pathname.startsWith('/api/invitations/')
      || url.pathname.startsWith('/api/coupons/')
      || url.pathname.startsWith('/api/square/')
      || url.pathname.startsWith('/api/collaboration/')
      || url.pathname.startsWith('/api/deliveries/')
      || url.pathname.startsWith('/api/admin/welfare')
      || url.pathname.startsWith('/api/admin/config/')
      || url.pathname.startsWith('/api/admin/applications/')
      || url.pathname.startsWith('/api/admin/verifications/')
      || url.pathname.startsWith('/api/admin/coupons/')
      || url.pathname.startsWith('/api/admin/users/')) {
      return handleWelfareStateRequest(request, env)
    }
    if (url.pathname.startsWith('/api/ai/'))
      return handleAiRequest(request, env)
    if (url.pathname.startsWith('/api/database-provision/'))
      return handleDatabaseProvisionRequest(request, env)
    if (url.pathname.startsWith('/api/education-mail/'))
      return handleEducationMailRequest(request, env)
    if (url.pathname.startsWith('/api/github-app/'))
      return handleGitHubAppRequest(request, env)
    if (url.pathname.startsWith('/api/oauth/'))
      return handleOAuthRequest(request, env)
    if (url.pathname.startsWith('/api/notifications'))
      return handleNotificationRequest(request, env)
    if (url.pathname.startsWith('/api/points/'))
      return handlePointRequest(request, env)
    if (url.pathname.startsWith('/api/recharge/'))
      return handleRechargeRequest(request, env)
    if (url.pathname.startsWith('/api/sub2api/'))
      return handleSub2ApiRequest(request, env)
    if (url.pathname.startsWith('/api/turnstile/'))
      return handleTurnstileRequest(request, env)
    if (url.pathname.startsWith('/api/uploads/'))
      return handleUploadRequest(request, env)
    if (url.pathname.startsWith('/api/webhooks/'))
      return handleWebhookRequest(request, env)

    return new Response('Not Found', { status: 404 })
  },
}
