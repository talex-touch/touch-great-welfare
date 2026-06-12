export type NotificationChannel = 'in_app' | 'email' | 'feishu' | 'browser_push'
export type NotificationEvent = 'application_answered' | 'application_rejected' | 'application_needs_supplement' | 'application_supplement_submitted' | 'student_submitted' | 'student_needs_supplement' | 'student_supplement_submitted' | 'student_approved' | 'student_rejected' | 'student_revoked' | 'ai_image_succeeded' | 'ai_image_failed' | 'admin_announcement' | 'email_test'
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type NotificationTemplateId = 'default' | 'announcement' | 'action_required' | 'result' | 'system'

export interface NotificationTemplateVariable {
  key: string
  label: string
  description: string
}

export interface NotificationTemplateOption {
  id: NotificationTemplateId
  name: string
  description: string
  subjectExample: string
  bodyExample: string
  variables: NotificationTemplateVariable[]
}

export const NOTIFICATION_TEMPLATE_OPTIONS: NotificationTemplateOption[] = [
  {
    id: 'default',
    name: '默认通知',
    description: '适合常规站内、邮件和飞书通知，风格克制简洁。',
    subjectExample: '{{title}}',
    bodyExample: '你好 {{recipientName}}，\n\n{{body}}',
    variables: [
      { key: 'title', label: '标题', description: '通知标题或通告标题' },
      { key: 'body', label: '正文', description: '通知正文，支持从富文本转为纯文本' },
      { key: 'recipientName', label: '收件人', description: '用户显示名，缺省使用邮箱或用户 ID' },
      { key: 'siteName', label: '站点名', description: '固定为 Touch Great Welfare' },
      { key: 'actionUrl', label: '详情链接', description: '申请、认证、消息中心或后台通告链接' },
    ],
  },
  {
    id: 'announcement',
    name: '管理员通告',
    description: '适合批量运营通知，突出通告内容和站内查看入口。',
    subjectExample: '【通告】{{title}}',
    bodyExample: '你好 {{recipientName}}，\n\n{{body}}\n\n可在消息中心查看完整通告。',
    variables: [
      { key: 'title', label: '通告标题', description: '管理员填写的通告标题' },
      { key: 'body', label: '通告内容', description: '管理员填写的通告正文' },
      { key: 'recipientName', label: '收件人', description: '逐个收件人的显示名' },
      { key: 'createdAt', label: '发送时间', description: '通告创建时间' },
      { key: 'actionUrl', label: '消息中心', description: '跳转到站内消息入口' },
    ],
  },
  {
    id: 'action_required',
    name: '需要处理',
    description: '适合补充材料、审核提醒等需要用户下一步操作的通知。',
    subjectExample: '需要处理：{{title}}',
    bodyExample: '你好 {{recipientName}}，\n\n{{body}}\n\n请尽快进入站内处理。',
    variables: [
      { key: 'title', label: '事项标题', description: '需要处理的事项' },
      { key: 'body', label: '处理说明', description: '补充要求或审核说明' },
      { key: 'recipientName', label: '收件人', description: '用户显示名' },
      { key: 'actionUrl', label: '处理链接', description: '申请、认证或消息中心链接' },
    ],
  },
  {
    id: 'result',
    name: '结果通知',
    description: '适合申请通过、退回、认证完成、图片生成结果等状态更新。',
    subjectExample: '结果更新：{{title}}',
    bodyExample: '你好 {{recipientName}}，\n\n{{body}}\n\n详情可在站内查看。',
    variables: [
      { key: 'title', label: '结果标题', description: '结果状态标题' },
      { key: 'body', label: '结果说明', description: '审核回复、发放说明或失败原因' },
      { key: 'recipientName', label: '收件人', description: '用户显示名' },
      { key: 'actionUrl', label: '详情链接', description: '相关业务详情页链接' },
    ],
  },
  {
    id: 'system',
    name: '系统简报',
    description: '适合测试邮件、系统维护和配置验证，内容更短。',
    subjectExample: '{{title}}',
    bodyExample: '{{body}}',
    variables: [
      { key: 'title', label: '标题', description: '系统消息标题' },
      { key: 'body', label: '正文', description: '系统消息正文' },
      { key: 'siteName', label: '站点名', description: '固定为 Touch Great Welfare' },
      { key: 'createdAt', label: '生成时间', description: '邮件生成时间' },
    ],
  },
]

export function notificationTemplateOption(id?: string) {
  return NOTIFICATION_TEMPLATE_OPTIONS.find(item => item.id === id) ?? NOTIFICATION_TEMPLATE_OPTIONS[0]
}

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

export interface EmailTemplateTestPayload {
  templateId?: NotificationTemplateId
  subjectTemplate: string
  bodyTemplate: string
  variables?: Record<string, string>
}

export interface SendEmailTestPayload {
  emailAddress?: string
  provider?: 'auto' | 'feishu_mail' | 'resend' | 'smtp'
  free?: boolean
  providerConfig?: EmailProviderTestConfig
  template?: EmailTemplateTestPayload
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
  templateId: NotificationTemplateId
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
  templateId?: NotificationTemplateId
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
