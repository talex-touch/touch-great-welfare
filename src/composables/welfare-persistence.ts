import type { CreateAdminPayload, LoginAdminPayload, ReviewCollaborationApplicationPayload, ReviewDeliveryPayload, SubmitCollaborationApplicationPayload, SubmitDeliveryPayload, WelfareState } from './welfare'

const STATE_ENDPOINT = '/api/welfare-state'

async function requestState<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(STATE_ENDPOINT, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json'))
    throw new Error('接口返回了页面内容，请使用 pnpm dev 启动 Cloudflare 本地环境后访问 Wrangler 地址')

  return response.json() as Promise<T>
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

export async function loadWelfareState() {
  const result = await requestState<{ state: Partial<WelfareState>, currentUserId?: string }>()
  return {
    ...result.state,
    currentUserId: result.currentUserId,
  }
}

export async function saveWelfareState(state: WelfareState, userId?: string) {
  await requestState<{ ok: true }>({
    method: 'PUT',
    headers: userId ? { 'x-welfare-user-id': userId } : undefined,
    body: JSON.stringify({ state }),
  })
}

export async function bootstrapAdmin(payload: CreateAdminPayload) {
  await requestState<{ ok: true }>({
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'x-welfare-action': 'bootstrap-admin',
    },
  })
}

export async function loginAdmin(payload: LoginAdminPayload) {
  return requestState<{ ok: true, userId: string }>({
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'x-welfare-action': 'login-admin',
    },
  })
}

export async function endSession() {
  await requestState<{ ok: true }>({
    method: 'POST',
    headers: {
      'x-welfare-action': 'logout',
    },
  })
}

async function postWelfareAction<T>(action: string, payload: unknown) {
  return requestState<T>({
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    headers: {
      'x-welfare-action': action,
    },
  })
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
