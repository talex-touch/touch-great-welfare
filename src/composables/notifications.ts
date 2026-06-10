import type {
  AdminAnnouncementListResult,
  CreateAdminAnnouncementPayload,
  NotificationListResult,
  NotificationSettingsView,
  PushSubscriptionPayload,
  SaveNotificationSettingsPayload,
  SendEmailTestPayload,
  SendEmailTestResult,
  SystemLogListResult,
} from '~/shared/notifications'

export interface NotificationProviderConfigView {
  configured: {
    email: boolean
    push: boolean
    feishuMail: boolean
  }
  resendApiKeyMasked: string
  resendFromEmail: string
  vapidPublicKey: string
  vapidPrivateKeyMasked: string
  vapidSubject: string
  feishuMailEnabled: boolean
  feishuAppId: string
  feishuAppSecretMasked: string
  feishuUserAccessTokenMasked: string
  feishuRefreshTokenMasked: string
  feishuAccessTokenExpiresAt: string
  feishuRefreshTokenExpiresAt: string
  feishuUserMailboxId: string
  feishuSiteBaseUrl: string
  feishuDailyLimit: number
  source: 'env' | 'admin' | 'empty'
}

export interface GenerateVapidKeysResult extends NotificationProviderConfigView {
  regenerated: boolean
}

export interface FeishuMailAuthorizationResult {
  authorizationUrl: string
  callbackUrl: string
}

export interface FeishuMailboxOption {
  id: string
  label: string
  email: string
  type: string
}

export interface FeishuMailboxListResult {
  mailboxes: FeishuMailboxOption[]
}

export interface SaveNotificationProviderConfigPayload {
  resendApiKey?: string
  resendFromEmail: string
  vapidPublicKey: string
  vapidPrivateKey?: string
  vapidSubject: string
  feishuMailEnabled: boolean
  feishuAppId: string
  feishuAppSecret?: string
  feishuUserAccessToken?: string
  feishuRefreshToken?: string
  feishuAccessTokenExpiresAt?: string
  feishuRefreshTokenExpiresAt?: string
  feishuUserMailboxId: string
  feishuSiteBaseUrl: string
  feishuDailyLimit: number
  clearResendApiKey?: boolean
  clearVapidPrivateKey?: boolean
  clearFeishuAppSecret?: boolean
  clearFeishuUserAccessToken?: boolean
  clearFeishuRefreshToken?: boolean
}

async function readErrorMessage(response: Response) {
  const fallback = '通知接口请求失败'
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

async function requestNotifications<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
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

export function loadNotifications(userId: string) {
  return requestNotifications<NotificationListResult>('/api/notifications', userId)
}

export function markNotificationRead(userId: string, notificationId: string) {
  return requestNotifications<{ ok: true }>(`/api/notifications/${notificationId}/read`, userId, {
    method: 'PATCH',
  })
}

export function markAllNotificationsRead(userId: string) {
  return requestNotifications<{ ok: true }>('/api/notifications/read-all', userId, {
    method: 'PATCH',
  })
}

export function loadNotificationSettings(userId: string) {
  return requestNotifications<NotificationSettingsView>('/api/notifications/settings', userId)
}

export function saveNotificationSettings(userId: string, payload: SaveNotificationSettingsPayload) {
  return requestNotifications<NotificationSettingsView>('/api/notifications/settings', userId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function sendEmailTest(userId: string, payload: SendEmailTestPayload) {
  return requestNotifications<SendEmailTestResult>('/api/notifications/email-test', userId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function sendProviderEmailTest(adminUserId: string, payload: SendEmailTestPayload) {
  return requestNotifications<SendEmailTestResult>('/api/notifications/provider-config/email-test', adminUserId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loadNotificationProviderConfig(adminUserId: string) {
  return requestNotifications<NotificationProviderConfigView>('/api/notifications/provider-config', adminUserId)
}

export function saveNotificationProviderConfig(adminUserId: string, payload: SaveNotificationProviderConfigPayload) {
  return requestNotifications<NotificationProviderConfigView>('/api/notifications/provider-config', adminUserId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function generateVapidKeys(adminUserId: string, regenerate: boolean) {
  return requestNotifications<GenerateVapidKeysResult>('/api/notifications/provider-config/vapid/generate', adminUserId, {
    method: 'POST',
    body: JSON.stringify({ regenerate }),
  })
}

export function createFeishuMailAuthorization(adminUserId: string, payload: { redirect?: string, providerConfig?: SaveNotificationProviderConfigPayload }) {
  return requestNotifications<FeishuMailAuthorizationResult>('/api/notifications/provider-config/feishu/authorize', adminUserId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loadFeishuMailboxes(adminUserId: string, payload: { providerConfig?: SaveNotificationProviderConfigPayload }) {
  return requestNotifications<FeishuMailboxListResult>('/api/notifications/provider-config/feishu/mailboxes', adminUserId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loadAdminAnnouncements(adminUserId: string) {
  return requestNotifications<AdminAnnouncementListResult>('/api/notifications/admin-announcements', adminUserId)
}

export function createAdminAnnouncement(adminUserId: string, payload: CreateAdminAnnouncementPayload) {
  return requestNotifications<AdminAnnouncementListResult>('/api/notifications/admin-announcements', adminUserId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loadSystemLogs(adminUserId: string, limit = 100) {
  return requestNotifications<SystemLogListResult>(`/api/notifications/system-logs?limit=${encodeURIComponent(String(limit))}`, adminUserId)
}

export async function loadPushPublicKey() {
  const response = await fetch('/api/notifications/push/public-key')
  if (!response.ok)
    throw new Error(await readErrorMessage(response))
  return response.json() as Promise<{ publicKey: string, configured: boolean }>
}

export function savePushSubscription(userId: string, payload: PushSubscriptionPayload) {
  return requestNotifications<NotificationSettingsView>('/api/notifications/push-subscriptions', userId, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deletePushSubscription(userId: string, endpoint?: string) {
  return requestNotifications<NotificationSettingsView>('/api/notifications/push-subscriptions', userId, {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
}

export function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const rawData = globalThis.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let index = 0; index < rawData.length; index += 1)
    outputArray[index] = rawData.charCodeAt(index)

  return outputArray
}
