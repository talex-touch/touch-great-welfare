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
  keyMasked: string
  name: string
  expiresAt: string
  quota: number
  status: 'active'
  createdAt: string
  revokedAt?: string
}

export interface TemporaryKeyView {
  id: string
  upstreamTokenId: string
  keyMasked: string
  name: string
  quota: number
  status: 'active' | 'expired' | 'revoked'
  provider: 'newapi'
  expiresAt: string
  createdAt: string
  revokedAt?: string
}

export interface TemporaryKeysResult {
  keys: TemporaryKeyView[]
  config: {
    enabled: boolean
    configured: boolean
    baseUrl: string
    temporaryKeyTtlMinutes: number
    temporaryKeyQuota: number
  }
}

export interface CreateTemporaryKeyPayload {
  name?: string
  ttlMinutes?: number
  quota?: number
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

export type ProvisionApplicationRewardResult
  = | {
    status: 'provisioned'
    provider: 'newapi'
    applicationId: string
    key: TemporaryKeyResult
  }
  | {
    status: 'provisioned'
    provider: 'sub2api' | 'resource'
    applicationId: string
    items: Array<
      {
        itemId: string
        provider?: 'sub2api'
        key: {
          id: string
          key: string
          keyMasked: string
          name: string
          quotaUsd: number
          expiresAt?: string
          status: 'active' | 'revoked'
          sub2apiUserId: string
          sub2apiKeyId: string
        }
      }
      | {
        itemId: string
        provider: 'database'
        database: {
          id: string
          databaseType: string
          databaseName: string
          username: string
          password?: string
          connectionUrl?: string
          connectionUrlMasked: string
          permission: string
          expiresAt?: string
          status: 'active'
          reused?: boolean
        }
      }
    >
  }
  | {
    status: 'pending_manual'
    applicationId: string
    error: string
  }
  | {
    status: 'skipped'
    applicationId: string
    reason?: string
    provider?: 'newapi' | 'sub2api' | 'resource'
    items?: unknown[]
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

export function loadTemporaryAiKeys(userId: string) {
  return requestAi<TemporaryKeysResult>('/api/ai/temporary-keys', userId)
}

export function createTemporaryAiKey(userId: string, payload: CreateTemporaryKeyPayload = {}) {
  return requestAi<TemporaryKeyResult>('/api/ai/temporary-key', userId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteTemporaryAiKey(userId: string, keyId: string) {
  return requestAi<{ ok: true }>(`/api/ai/temporary-keys/${encodeURIComponent(keyId)}`, userId, {
    method: 'DELETE',
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

export function provisionApplicationReward(adminUserId: string, applicationId: string, itemId?: string) {
  return requestAi<ProvisionApplicationRewardResult>(`/api/ai/applications/${encodeURIComponent(applicationId)}/provision`, adminUserId, {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  })
}
