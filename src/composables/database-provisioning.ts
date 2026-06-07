export interface DatabaseProvisionConfigView {
  enabled: boolean
  configured: boolean
  rootUrlMasked: string
  defaultExpiresInDays: number
  databasePrefix: string
  onePanelBaseUrl: string
  onePanelApiKeyMasked: string
  source: 'admin' | 'empty'
}

export interface SaveDatabaseProvisionConfigPayload {
  enabled: boolean
  rootUrl?: string
  clearRootUrl?: boolean
  defaultExpiresInDays: number
  databasePrefix: string
  onePanelBaseUrl?: string
  onePanelApiKey?: string
  clearOnePanelApiKey?: boolean
}

async function readErrorMessage(response: Response) {
  const fallback = '数据库发放接口请求失败'
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

async function requestDatabaseProvision<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
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

export function loadDatabaseProvisionConfig(adminUserId: string) {
  return requestDatabaseProvision<DatabaseProvisionConfigView>('/api/database-provision/config', adminUserId)
}

export function saveDatabaseProvisionConfig(adminUserId: string, payload: SaveDatabaseProvisionConfigPayload) {
  return requestDatabaseProvision<DatabaseProvisionConfigView>('/api/database-provision/config', adminUserId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function testDatabaseProvisionConfig(adminUserId: string) {
  return requestDatabaseProvision<{ ok: boolean }>('/api/database-provision/test', adminUserId, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
