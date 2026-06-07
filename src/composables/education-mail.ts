export interface EducationMailConfigView {
  enabled: boolean
  configured: boolean
  baseUrl: string
  adminKeyMasked: string
  inboxAddress: string
  lookbackHours: number
  source: 'admin' | 'empty'
}

export interface SaveEducationMailConfigPayload {
  enabled: boolean
  baseUrl: string
  adminKey?: string
  clearAdminKey?: boolean
  inboxAddress: string
  lookbackHours: number
}

export interface EducationMailSyncResult {
  checked: number
  verified: number
  matched: Array<{
    challengeId: string
    verificationId?: string
    email: string
    mailId: string
    receivedAt?: string
  }>
}

export interface VerifyEducationMailChallengeResult {
  verified: boolean
  challengeId: string
  email: string
  verifiedAt?: string
  mailId?: string
  receivedAt?: string
}

async function readErrorMessage(response: Response) {
  const fallback = '教育邮箱收件接口请求失败'
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

async function requestEducationMail<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
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

export function loadEducationMailConfig(adminUserId: string) {
  return requestEducationMail<EducationMailConfigView>('/api/education-mail/config', adminUserId)
}

export function saveEducationMailConfig(adminUserId: string, payload: SaveEducationMailConfigPayload) {
  return requestEducationMail<EducationMailConfigView>('/api/education-mail/config', adminUserId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function testEducationMailConfig(adminUserId: string) {
  return requestEducationMail<{ ok: boolean }>('/api/education-mail/test', adminUserId, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function syncEducationMailChallenges(adminUserId: string) {
  return requestEducationMail<EducationMailSyncResult>('/api/education-mail/sync', adminUserId, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function verifyEducationMailChallenge(userId: string, challengeId: string) {
  return requestEducationMail<VerifyEducationMailChallengeResult>('/api/education-mail/verify', userId, {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  })
}
