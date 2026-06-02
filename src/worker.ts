import type { WorkerEnv } from './worker/welfare-state'
import { handleAiRequest } from './worker/ai'
import { handleGitHubAppRequest } from './worker/github-app'
import { handleNotificationRequest } from './worker/notifications'
import { handleRechargeRequest } from './worker/recharge'
import { handleWebhookRequest } from './worker/webhook'
import { handleWelfareStateRequest } from './worker/welfare-state'

export default {
  fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url)
    if (url.pathname === '/api/welfare-state')
      return handleWelfareStateRequest(request, env)
    if (url.pathname.startsWith('/api/ai/'))
      return handleAiRequest(request, env)
    if (url.pathname.startsWith('/api/github-app/'))
      return handleGitHubAppRequest(request, env)
    if (url.pathname.startsWith('/api/notifications'))
      return handleNotificationRequest(request, env)
    if (url.pathname.startsWith('/api/recharge/'))
      return handleRechargeRequest(request, env)
    if (url.pathname.startsWith('/api/webhooks/'))
      return handleWebhookRequest(request, env)

    return new Response('Not Found', { status: 404 })
  },
}
