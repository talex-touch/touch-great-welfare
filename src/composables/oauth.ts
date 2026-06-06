export interface PublicOAuthProvider {
  id: string
  name: string
  logoUrl: string
  scopes: string
}

export interface OAuthProviderConfigView extends PublicOAuthProvider {
  enabled: boolean
  configured: boolean
  clientId: string
  clientSecretMasked: string
  logoUrl: string
  callbackUrl: string
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  issuerUrl: string
}

export interface SaveOAuthProviderConfigPayload {
  id: string
  enabled: boolean
  name: string
  logoUrl: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  issuerUrl: string
  scopes: string
}

export interface CreateOAuthAuthorizationResult {
  authorizeUrl: string
  state: string
}

async function readErrorMessage(response: Response) {
  const fallback = 'OAuth 接口请求失败'
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

async function requestOAuth<T>(path: string, init?: RequestInit): Promise<T> {
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

export function loadOAuthProviders() {
  return requestOAuth<{ providers: PublicOAuthProvider[] }>('/api/oauth/providers')
}

export function loadOAuthProviderConfigs(adminUserId: string) {
  return requestOAuth<{ providers: OAuthProviderConfigView[] }>('/api/oauth/configs', {
    headers: {
      'x-welfare-user-id': adminUserId,
    },
  })
}

export function saveOAuthProviderConfigs(providers: SaveOAuthProviderConfigPayload[], adminUserId: string) {
  return requestOAuth<{ ok: true, providers: OAuthProviderConfigView[] }>('/api/oauth/configs', {
    method: 'PUT',
    headers: {
      'x-welfare-user-id': adminUserId,
    },
    body: JSON.stringify({ providers }),
  })
}

export function createOAuthAuthorization(providerId: string, redirect = '/dashboard/apply') {
  return requestOAuth<CreateOAuthAuthorizationResult>('/api/oauth/authorize', {
    method: 'POST',
    body: JSON.stringify({ providerId, redirect }),
  })
}
