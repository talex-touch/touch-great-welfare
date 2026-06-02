import type { LlmApiModelPricing } from './welfare'

export interface AiConfigView {
  enabled: boolean
  configured: boolean
  baseUrl: string
  imageModel: string
  reviewModel: string
  apiKeyMasked: string
  newapiKeyMasked: string
  newapiManagementBaseUrl: string
  newapiUserId: string
  temporaryKeyTtlMinutes: number
  temporaryKeyQuota: number
  llmApiModels: LlmApiModelPricing[]
  source: 'env' | 'admin' | 'empty'
  env: Record<string, string>
}

export interface SaveAiConfigPayload {
  enabled: boolean
  baseUrl: string
  imageModel: string
  reviewModel: string
  apiKey?: string
  newapiKey?: string
  newapiManagementBaseUrl: string
  newapiUserId: string
  clearApiKey?: boolean
  clearNewapiKey?: boolean
  temporaryKeyTtlMinutes: number
  temporaryKeyQuota: number
  llmApiModels: LlmApiModelPricing[]
}

export interface TemporaryKeyResult {
  id: string
  key: string
  expiresAt: string
  quota: number
}

export interface CreateImageResult {
  jobId: string
  status: 'succeeded'
  fileUrl: string
}

export interface CreateApplicationReviewResult {
  applicationId: string
  review: {
    status: 'pending' | 'approved' | 'rejected' | 'needs_human' | 'failed'
    summary: string
    risk: 'low' | 'medium' | 'high'
    reason?: string
    model?: string
    reviewedAt?: string
  }
}

async function readErrorMessage(response: Response) {
  const fallback = 'AI 接口请求失败'
  const text = await response.text()
  if (!text)
    return fallback

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || fallback
  }
  catch {
    return text
  }
}

async function requestAi<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-welfare-user-id': userId,
      ...init?.headers,
    },
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  return response.json() as Promise<T>
}

export function loadAiConfig(adminUserId: string) {
  return requestAi<AiConfigView>('/api/ai/config', adminUserId)
}

export function saveAiConfig(adminUserId: string, payload: SaveAiConfigPayload) {
  return requestAi<AiConfigView>('/api/ai/config', adminUserId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function createTemporaryAiKey(userId: string) {
  return requestAi<TemporaryKeyResult>('/api/ai/temporary-key', userId, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function createImageJob(userId: string, prompt: string, applicationId?: string) {
  return requestAi<CreateImageResult>('/api/ai/images', userId, {
    method: 'POST',
    body: JSON.stringify({ prompt, applicationId }),
  })
}

export function createApplicationReview(userId: string, applicationId: string) {
  return requestAi<CreateApplicationReviewResult>('/api/ai/reviews', userId, {
    method: 'POST',
    body: JSON.stringify({ applicationId }),
  })
}
