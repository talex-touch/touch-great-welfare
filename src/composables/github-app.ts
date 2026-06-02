export interface GitHubAppConfigView {
  enabled: boolean
  configured: boolean
  appName: string
  appSlug: string
  clientId: string
  clientSecretMasked: string
  callbackUrl: string
  authorizeUrl: string
  tokenUrl: string
  apiBaseUrl: string
  scopes: string
  source?: 'env' | 'admin' | 'empty'
}

export interface SaveGitHubAppConfigPayload {
  enabled: boolean
  appName: string
  appSlug: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  authorizeUrl: string
  tokenUrl: string
  apiBaseUrl: string
  scopes: string
}

export interface SaveGitHubAppConfigResult {
  ok: true
  message: string
  env: Record<string, string>
}

export interface CreateGitHubAuthorizationResult {
  authorizeUrl: string
  state: string
}

async function readErrorMessage(response: Response) {
  const fallback = 'GitHub App 接口请求失败'
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

async function requestGitHubApp<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  return response.json() as Promise<T>
}

export function loadGitHubAppConfig() {
  return requestGitHubApp<GitHubAppConfigView>('/api/github-app/config')
}

export function saveGitHubAppConfig(payload: SaveGitHubAppConfigPayload, adminUserId: string) {
  return requestGitHubApp<SaveGitHubAppConfigResult>('/api/github-app/config', {
    method: 'PUT',
    headers: {
      'x-welfare-user-id': adminUserId,
    },
    body: JSON.stringify(payload),
  })
}

export function createGitHubAuthorization(redirect = '/dashboard/open-source', userId?: string, mode: 'login' | 'connect' = 'connect') {
  return requestGitHubApp<CreateGitHubAuthorizationResult>('/api/github-app/authorize', {
    method: 'POST',
    headers: userId
      ? {
          'x-welfare-user-id': userId,
        }
      : undefined,
    body: JSON.stringify({ redirect, mode }),
  })
}
