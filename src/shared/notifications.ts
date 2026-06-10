export type NotificationChannel = 'in_app' | 'email' | 'feishu' | 'browser_push'
export type NotificationEvent = 'application_answered' | 'application_rejected' | 'application_needs_supplement' | 'application_supplement_submitted' | 'student_submitted' | 'student_needs_supplement' | 'student_supplement_submitted' | 'student_approved' | 'student_rejected' | 'student_revoked' | 'ai_image_succeeded' | 'ai_image_failed' | 'admin_announcement' | 'email_test'
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface NotificationItem {
  id: string
  userId: string
  event: NotificationEvent
  title: string
  body: string
  data: Record<string, unknown>
  readAt?: string
  createdAt: string
}

export interface NotificationSettingsView {
  emailEnabled: boolean
  emailAddress: string
  feishuEnabled: boolean
  feishuWebhookMasked: string
  browserPushEnabled: boolean
  pushSubscriptionCount: number
}

export interface SaveNotificationSettingsPayload {
  emailEnabled: boolean
  emailAddress?: string
  feishuEnabled: boolean
  feishuWebhookUrl?: string
  clearFeishuWebhook?: boolean
  browserPushEnabled: boolean
}

export interface EmailProviderTestConfig {
  resendApiKey?: string
  resendFromEmail?: string
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject?: string
  feishuMailEnabled?: boolean
  feishuAppId?: string
  feishuAppSecret?: string
  feishuUserMailboxId?: string
  feishuSiteBaseUrl?: string
  feishuDailyLimit?: number
  smtpEnabled?: boolean
  smtpHost?: string
  smtpPort?: number
  smtpUsername?: string
  smtpPassword?: string
  smtpFromEmail?: string
  smtpFromName?: string
}

export interface SendEmailTestPayload {
  emailAddress?: string
  provider?: 'auto' | 'feishu_mail' | 'resend'
  free?: boolean
  providerConfig?: EmailProviderTestConfig
}

export interface EmailDeliveryAttempt {
  provider: 'feishu_mail' | 'resend' | 'smtp'
  providerLabel: string
  status: Extract<DeliveryStatus, 'sent' | 'failed' | 'skipped'>
  message: string
}

export interface SendEmailTestResult {
  ok: true
  notificationId: string
  emailAddress: string
  chargedPoints: number
  deliveryProvider: EmailDeliveryAttempt['provider']
  deliveryProviderLabel: string
  deliveryAttempts: EmailDeliveryAttempt[]
}

export interface PushSubscriptionPayload {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface NotificationListResult {
  notifications: NotificationItem[]
  unreadCount: number
}

export interface AdminAnnouncementRecipient {
  userId: string
  displayName: string
  email: string
  readAt?: string
  notificationId: string
}

export interface AdminAnnouncementSummary {
  id: string
  title: string
  body: string
  channels: NotificationChannel[]
  forcePopup: boolean
  forcePush: boolean
  createdAt: string
  createdBy: string
  totalCount: number
  readCount: number
  unreadCount: number
  recipients: AdminAnnouncementRecipient[]
}

export interface AdminAnnouncementListResult {
  announcements: AdminAnnouncementSummary[]
}

export type SystemLogLevel = 'info' | 'warning' | 'error' | 'success'

export interface SystemLogItem {
  id: string
  level: SystemLogLevel
  module: string
  action: string
  message: string
  details: Record<string, unknown>
  refId?: string
  durationMs?: number
  createdAt: string
}

export interface SystemLogListResult {
  logs: SystemLogItem[]
}

export interface CreateAdminAnnouncementPayload {
  title: string
  body: string
  channels: NotificationChannel[]
  forcePopup: boolean
  forcePush: boolean
  targetUserIds?: string[]
}

export const EMAIL_NOTIFICATION_COST = 5

export function notificationEventText(event: NotificationEvent) {
  const map: Record<NotificationEvent, string> = {
    application_answered: '申请已通过',
    application_rejected: '申请已退回',
    application_needs_supplement: '申请待补充',
    application_supplement_submitted: '申请已补充',
    student_submitted: '认证已提交',
    student_needs_supplement: '认证待补充',
    student_supplement_submitted: '认证已补充',
    student_approved: '学生认证通过',
    student_rejected: '学生认证退回',
    student_revoked: '学生认证撤销',
    ai_image_succeeded: '图片生成完成',
    ai_image_failed: '图片生成失败',
    admin_announcement: '管理员通告',
    email_test: '邮箱测试',
  }
  return map[event]
}
