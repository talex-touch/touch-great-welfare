export type NotificationChannel = 'in_app' | 'email' | 'feishu' | 'browser_push'
export type NotificationEvent = 'application_answered' | 'application_rejected' | 'application_needs_supplement' | 'application_supplement_submitted' | 'student_submitted' | 'student_needs_supplement' | 'student_supplement_submitted' | 'student_approved' | 'student_rejected' | 'student_revoked' | 'ai_image_succeeded' | 'ai_image_failed' | 'admin_announcement' | 'email_test'
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type NotificationTemplateId = 'default' | 'resource_approved' | 'resource_delivered' | 'application_rejected' | 'supplement_required' | 'supplement_submitted' | 'student_approved' | 'student_rejected' | 'student_required' | 'image_succeeded' | 'image_failed' | 'announcement' | 'system'

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

const commonVariables: NotificationTemplateVariable[] = [
  { key: 'title', label: '标题', description: '通知标题或业务标题' },
  { key: 'body', label: '正文', description: '审核回复、发放说明、拒绝理由或系统说明' },
  { key: 'recipientName', label: '收件人', description: '用户显示名，缺省使用邮箱或用户 ID' },
  { key: 'siteName', label: '站点名', description: '固定为 Touch Great Welfare' },
  { key: 'actionUrl', label: '详情链接', description: '申请、认证、消息中心或后台通告链接' },
]

const createdAtVariable: NotificationTemplateVariable = { key: 'createdAt', label: '时间', description: '通知创建或发送时间' }

export const NOTIFICATION_TEMPLATE_OPTIONS: NotificationTemplateOption[] = [
  {
    id: 'resource_approved',
    name: '资源申请已通过',
    description: '用户申请的资源已审核通过，等待或进入发放流程。',
    subjectExample: '你申请的 {{title}} 已通过',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你申请的 <strong>{{title}}</strong> 已通过审核。</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">点击这里查看申请详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'resource_delivered',
    name: '资源已发放',
    description: '资源、额度、系统账号、密钥或访问权限已完成发放。',
    subjectExample: '你申请的 {{title}} 资源已发放',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你申请的 <strong>{{title}}</strong> 已完成资源发放。</p>\n<p>{{body}}</p>\n<blockquote>如包含系统密钥、API Key、数据库账号或访问地址，请进入申请详情查看并妥善保管。</blockquote>\n<p><a href="{{actionUrl}}">点击这里查看发放详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'application_rejected',
    name: '申请被拒绝',
    description: '申请被退回或拒绝，展示拒绝理由和后续处理说明。',
    subjectExample: '你的 {{title}} 未通过审核',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的 <strong>{{title}}</strong> 未通过本次审核。</p>\n<p><strong>理由：</strong>{{body}}</p>\n<p>你可以根据说明调整材料后重新提交，或进入详情页查看处理记录。</p>\n<p><a href="{{actionUrl}}">查看申请详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'supplement_required',
    name: '需要补充材料',
    description: '审核人要求用户补充资料、说明或附件。',
    subjectExample: '需要补充材料：{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的 <strong>{{title}}</strong> 需要补充材料后继续审核。</p>\n<p>{{body}}</p>\n<p>请尽快进入申请详情按要求补充。</p>\n<p><a href="{{actionUrl}}">去补充材料</a></p>',
    variables: commonVariables,
  },
  {
    id: 'supplement_submitted',
    name: '补充材料已提交',
    description: '用户已提交补充材料，提醒管理员继续审核。',
    subjectExample: '{{title}} 已提交补充材料',
    bodyExample: '<p>管理员你好，</p>\n<p><strong>{{title}}</strong> 的补充材料已提交。</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">进入后台查看材料</a></p>',
    variables: commonVariables,
  },
  {
    id: 'student_approved',
    name: '学生认证已通过',
    description: '学生、教师或一线身份认证审核通过。',
    subjectExample: '{{title}} 已通过',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的 <strong>{{title}}</strong> 已通过审核。</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">查看认证详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'student_rejected',
    name: '认证未通过',
    description: '身份认证被退回、撤销或拒绝。',
    subjectExample: '{{title}} 未通过',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的 <strong>{{title}}</strong> 未通过审核。</p>\n<p><strong>原因：</strong>{{body}}</p>\n<p><a href="{{actionUrl}}">查看认证详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'student_required',
    name: '认证需补充材料',
    description: '认证材料需要补充或重新提交。',
    subjectExample: '认证需要补充材料：{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的 <strong>{{title}}</strong> 需要补充材料。</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">去补充认证材料</a></p>',
    variables: commonVariables,
  },
  {
    id: 'image_succeeded',
    name: '图片生成完成',
    description: 'AI 图片生成任务完成，可查看生成结果。',
    subjectExample: '{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的图片生成任务已完成。</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">查看生成结果</a></p>',
    variables: commonVariables,
  },
  {
    id: 'image_failed',
    name: '图片生成失败',
    description: 'AI 图片生成失败，展示失败原因和积分处理。',
    subjectExample: '{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>你的图片生成任务未能完成。</p>\n<p><strong>失败原因：</strong>{{body}}</p>\n<p>相关积分会按规则处理，你也可以进入申请详情查看记录。</p>\n<p><a href="{{actionUrl}}">查看任务详情</a></p>',
    variables: commonVariables,
  },
  {
    id: 'announcement',
    name: '管理员通告',
    description: '批量运营通知、维护公告或资源开放提醒。',
    subjectExample: '【通告】{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">可在消息中心查看完整通告</a></p>',
    variables: [
      { key: 'title', label: '通告标题', description: '管理员填写的通告标题' },
      { key: 'body', label: '通告内容', description: '管理员填写的通告正文' },
      { key: 'recipientName', label: '收件人', description: '逐个收件人的显示名' },
      createdAtVariable,
      { key: 'actionUrl', label: '消息中心', description: '跳转到站内消息入口' },
    ],
  },
  {
    id: 'system',
    name: '系统测试 / 配置验证',
    description: '测试邮件、系统维护和配置验证。',
    subjectExample: '{{title}}',
    bodyExample: '<p>{{body}}</p>\n<p><small>生成时间：{{createdAt}}</small></p>',
    variables: [
      { key: 'title', label: '标题', description: '系统消息标题' },
      { key: 'body', label: '正文', description: '系统消息正文' },
      { key: 'siteName', label: '站点名', description: '固定为 Touch Great Welfare' },
      createdAtVariable,
    ],
  },
  {
    id: 'default',
    name: '通用兜底通知',
    description: '未匹配到具体业务场景时使用的兜底模板。',
    subjectExample: '{{title}}',
    bodyExample: '<p>你好 {{recipientName}}，</p>\n<p>{{body}}</p>\n<p><a href="{{actionUrl}}">查看详情</a></p>',
    variables: commonVariables,
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
  userAgent?: string
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

export interface CreateAdminAnnouncementPayload {
  title: string
  body: string
  templateId?: NotificationTemplateId
  channels: NotificationChannel[]
  forcePopup: boolean
  forcePush: boolean
  targetUserIds?: string[]
}

export type SystemLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface SystemLogItem {
  id: string
  level: SystemLogLevel
  module: string
  action: string
  message: string
  details: Record<string, unknown>
  refId?: string
  createdAt: string
  durationMs?: number
}

export interface SystemLogListResult {
  logs: SystemLogItem[]
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
