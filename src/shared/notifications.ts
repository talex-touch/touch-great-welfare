export type NotificationChannel = 'in_app' | 'email' | 'feishu' | 'browser_push'
export type NotificationEvent = 'application_answered' | 'application_rejected' | 'student_approved' | 'student_rejected' | 'ai_image_succeeded' | 'ai_image_failed'
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

export const EMAIL_NOTIFICATION_COST = 5

export function notificationEventText(event: NotificationEvent) {
  const map: Record<NotificationEvent, string> = {
    application_answered: '申请已通过',
    application_rejected: '申请已退回',
    student_approved: '学生认证通过',
    student_rejected: '学生认证退回',
    ai_image_succeeded: '图片生成完成',
    ai_image_failed: '图片生成失败',
  }
  return map[event]
}
