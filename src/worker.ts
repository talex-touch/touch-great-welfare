import type { WorkerEnv } from './worker/welfare-state'
import { handleWelfareStateRequest } from './worker/welfare-state'

export default {
  fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url)
    if (url.pathname === '/api/welfare-state')
      return handleWelfareStateRequest(request, env)

    return new Response('Not Found', { status: 404 })
  },
}
