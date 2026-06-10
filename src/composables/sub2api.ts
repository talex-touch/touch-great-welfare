export interface Sub2ApiGroupView {
  id: number
  name: string
}

export interface Sub2ApiConfigView {
  enabled: boolean
  mockEnabled: boolean
  configured: boolean
  baseUrl: string
  adminApiKeyMasked: string
  databaseUrlMasked: string
  defaultGroupId: number | null
  defaultQuotaUsd: number
  defaultExpiresInDays: number
  defaultRateLimit5h: number
  defaultRateLimit1d: number
  defaultRateLimit7d: number
  source: 'admin' | 'empty'
}

export interface SaveSub2ApiConfigPayload {
  enabled: boolean
  mockEnabled?: boolean
  baseUrl: string
  adminApiKey?: string
  databaseUrl?: string
  clearAdminApiKey?: boolean
  clearDatabaseUrl?: boolean
  defaultGroupId?: number | string | null
  defaultQuotaUsd: number
  defaultExpiresInDays: number
  defaultRateLimit5h: number
  defaultRateLimit1d: number
  defaultRateLimit7d: number
}

export interface Sub2ApiKeyView {
  id: string
  sub2apiUserId: string
  sub2apiKeyId: string
  keyMasked: string
  name: string
  quotaUsd: number
  expiresAt?: string
  status: 'active' | 'revoked'
  createdAt: string
  revokedAt?: string
}

export interface Sub2ApiKeyCreateResult extends Sub2ApiKeyView {
  key: string
}

export interface Sub2ApiKeysResult {
  keys: Sub2ApiKeyView[]
  config: Sub2ApiConfigView
}

export interface CreateSub2ApiKeyPayload {
  name?: string
  quotaUsd?: number
  expiresInDays?: number
  groupId?: number | string | null
  rateLimit5h?: number
  rateLimit1d?: number
  rateLimit7d?: number
  ipWhitelist?: string[]
  ipBlacklist?: string[]
  maxActiveIps?: number
  ipIdleTimeoutSeconds?: number
  maxConcurrency?: number
}

async function readErrorMessage(response: Response) {
  const fallback = 'Sub2API 请求失败'
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

async function requestSub2Api<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
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

export function loadSub2ApiConfig(adminUserId: string) {
  return requestSub2Api<Sub2ApiConfigView>('/api/sub2api/config', adminUserId)
}

export function saveSub2ApiConfig(adminUserId: string, payload: SaveSub2ApiConfigPayload) {
  return requestSub2Api<Sub2ApiConfigView>('/api/sub2api/config', adminUserId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function testSub2ApiConfig(adminUserId: string, payload?: Partial<SaveSub2ApiConfigPayload>) {
  return requestSub2Api<{ ok: boolean, adminApiReachable?: boolean, mock?: boolean, groups: Sub2ApiGroupView[] }>('/api/sub2api/test', adminUserId, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export function loadSub2ApiKeys(userId: string) {
  return requestSub2Api<Sub2ApiKeysResult>('/api/sub2api/keys', userId)
}

export function createSub2ApiKey(userId: string, payload: CreateSub2ApiKeyPayload) {
  return requestSub2Api<Sub2ApiKeyCreateResult>('/api/sub2api/keys', userId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteSub2ApiKey(userId: string, keyId: string) {
  return requestSub2Api<{ ok: true }>(`/api/sub2api/keys/${encodeURIComponent(keyId)}`, userId, {
    method: 'DELETE',
  })
}
