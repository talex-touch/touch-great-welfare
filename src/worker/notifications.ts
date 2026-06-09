import type { WorkerEnv } from './welfare-state'
import type { AttachmentMeta, StudentVerification, User, WelfareApplication, WelfareState } from '~/composables/welfare'
import type {
  AdminAnnouncementListResult,
  AdminAnnouncementSummary,
  CreateAdminAnnouncementPayload,
  DeliveryStatus,
  EmailDeliveryAttempt,
  NotificationChannel,
  NotificationEvent,
  NotificationItem,
  NotificationSettingsView,
  PushSubscriptionPayload,
  SaveNotificationSettingsPayload,
  SendEmailTestPayload,
  SendEmailTestResult,
  SystemLogItem,
  SystemLogLevel,
  SystemLogListResult,
} from '~/shared/notifications'
import { EMAIL_NOTIFICATION_COST } from '~/shared/notifications'
import { richTextToPlainText } from '~/utils/rich-text'
import {
  assertAdminRequest,
  assertSafeExternalUrl,
  assertWelfareState,
  boolValue,
  createId,
  errorResponse,
  fetchWithTimeout,
  getAuthenticatedRequest,
  json,
  maskSecret,
  now,
  readJson,
} from './auth'
import { base64UrlDecode, base64UrlEncode, decryptSecret, encryptSecret } from './crypto'
import { appendPointTransaction, pointTransactionId } from './points'
import { getPool, readWelfareState, readWelfareStateRecord, shouldUseD1, writeWelfareState } from './welfare-state'

type NotificationStatus = 'processed' | 'failed'
type NotificationDeliveryProvider = '' | EmailDeliveryProvider | 'feishu_webhook' | 'web_push'

interface SystemLogInput {
  level: SystemLogLevel
  module: string
  action: string
  message: string
  details?: Record<string, unknown>
  refId?: string
  durationMs?: number
}

interface SystemLogRow {
  id: string
  level: SystemLogLevel
  module: string
  action: string
  message: string
  details: string | Record<string, unknown>
  ref_id?: string | null
  duration_ms?: number | null
  created_at?: string | Date | null
}

interface NotificationRow {
  id: string
  user_id: string
  event: NotificationEvent
  title: string
  body: string
  data: string
  read_at?: string | Date | null
  created_at: string | Date
}

interface NotificationSettingsRow {
  user_id: string
  email_enabled: number | boolean
  email_address: string
  feishu_enabled: number | boolean
  feishu_webhook_encrypted?: string | null
  browser_push_enabled: number | boolean
}

interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent?: string | null
  enabled: number | boolean
}

interface NotificationProviderConfigRow {
  id: string
  resend_api_key_encrypted?: string | null
  resend_from_email?: string | null
  vapid_public_key?: string | null
  vapid_private_key_encrypted?: string | null
  vapid_subject?: string | null
  feishu_mail_enabled?: number | boolean | null
  feishu_app_id?: string | null
  feishu_app_secret_encrypted?: string | null
  feishu_user_access_token_encrypted?: string | null
  feishu_refresh_token_encrypted?: string | null
  feishu_access_token_expires_at?: string | Date | null
  feishu_refresh_token_expires_at?: string | Date | null
  feishu_user_mailbox_id?: string | null
  feishu_site_base_url?: string | null
  feishu_daily_limit?: number | null
}

interface NotificationProviderConfigPayload {
  resendApiKey?: string
  resendFromEmail?: string
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject?: string
  feishuMailEnabled?: boolean
  feishuAppId?: string
  feishuAppSecret?: string
  feishuUserAccessToken?: string
  feishuRefreshToken?: string
  feishuAccessTokenExpiresAt?: string
  feishuRefreshTokenExpiresAt?: string
  feishuUserMailboxId?: string
  feishuSiteBaseUrl?: string
  feishuDailyLimit?: number
  clearResendApiKey?: boolean
  clearVapidPrivateKey?: boolean
  clearFeishuAppSecret?: boolean
  clearFeishuUserAccessToken?: boolean
  clearFeishuRefreshToken?: boolean
}

interface GenerateVapidKeysPayload {
  regenerate?: boolean
}

export interface CreateNotificationInput {
  userId: string
  event: NotificationEvent
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface NotificationQueueJob {
  type: 'notification.dispatch'
  input: CreateNotificationInput
}

const NOTIFICATION_LIMIT = 80
const ADMIN_ANNOUNCEMENT_LIMIT = 1200
const NOTIFICATION_PROVIDER_CONFIG_ID = 'default'
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@welfare.dev'
const DEFAULT_FEISHU_USER_MAILBOX_ID = 'me'
const DEFAULT_FEISHU_DAILY_LIMIT = 400
const MAX_FEISHU_DAILY_LIMIT = 400
const FEISHU_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000
const EMAIL_BODY_TEXT_LIMIT = 1800
const ADMIN_ANNOUNCEMENT_CHANNELS: NotificationChannel[] = ['in_app', 'email', 'feishu', 'browser_push']
type EmailDeliveryProvider = EmailDeliveryAttempt['provider']
type EmailDeliveryStatus = EmailDeliveryAttempt['status']
const EMAIL_DELIVERY_PROVIDER_LABELS: Record<EmailDeliveryProvider, string> = {
  feishu_mail: '飞书邮件',
  resend: 'Resend 邮件',
}
const EMAIL_DELIVERY_STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  sent: '已发送',
  failed: '失败',
  skipped: '跳过',
}

function encryptionSecret(env: WorkerEnv) {
  return env.NOTIFY_SECRET_KEY ?? ''
}

async function addD1ColumnIfMissing(env: WorkerEnv, table: string, column: string, definition: string) {
  const columns = await env.LOCAL_DB!.prepare(`pragma table_info(${table})`).all<{ name: string }>()
  if (!(columns.results ?? []).some(item => item.name === column))
    await env.LOCAL_DB!.prepare(`alter table ${table} add column ${column} ${definition}`).run()
}

function toIso(value?: string | Date | null) {
  if (!value)
    return undefined
  return value instanceof Date ? value.toISOString() : value
}

function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    userId: row.user_id,
    event: row.event,
    title: row.title,
    body: row.body,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at) ?? now(),
  }
}

function safeNotificationData(row: NotificationRow) {
  try {
    return JSON.parse(row.data || '{}') as Record<string, unknown>
  }
  catch {
    return {}
  }
}

function normalizeNotificationChannels(channels: NotificationChannel[] | undefined, forcePush = false) {
  const normalized = new Set<NotificationChannel>(['in_app'])
  for (const channel of channels ?? []) {
    if (ADMIN_ANNOUNCEMENT_CHANNELS.includes(channel))
      normalized.add(channel)
  }
  if (forcePush)
    normalized.add('browser_push')
  return [...normalized]
}

function assertEmail(value: string) {
  if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(value))
    throw new Error('请填写有效邮箱')
}

function normalizeExternalHttpsUrl(value: string, label: string) {
  try {
    return assertSafeExternalUrl(value).toString()
  }
  catch (error) {
    throw new Error(`${label}${error instanceof Error ? `：${error.message}` : '格式无效'}`)
  }
}

function normalizePushEndpoint(value: string) {
  const endpoint = normalizeExternalHttpsUrl(value, 'Push endpoint 无效')
  if (endpoint.length > 2048)
    throw new Error('Push endpoint 过长')
  return endpoint
}

function assertPushKey(value: string, label: string) {
  if (!/^[\w-]+=*$/.test(value) || value.length < 16 || value.length > 512)
    throw new Error(`${label} 参数无效`)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function notificationText(title: string, body: string) {
  return `${title}\n\n${body}\n\nTouch Great Welfare`
}

function normalizeSiteBaseUrl(value?: string | null) {
  const text = value?.trim().replace(/\/+$/, '') ?? ''
  if (!text)
    return ''

  let url: URL
  try {
    url = new URL(text)
  }
  catch {
    throw new Error('站点根地址格式无效')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('站点根地址必须使用 HTTP 或 HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function normalizeFeishuDailyLimit(value: unknown) {
  const number = Number(value ?? DEFAULT_FEISHU_DAILY_LIMIT)
  if (!Number.isFinite(number))
    return DEFAULT_FEISHU_DAILY_LIMIT
  return Math.min(MAX_FEISHU_DAILY_LIMIT, Math.max(1, Math.floor(number)))
}

function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map(part => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

function expiresAtFromNow(seconds?: number) {
  if (!Number.isFinite(seconds))
    return ''
  return new Date(Date.now() + Math.max(0, Number(seconds)) * 1000).toISOString()
}

function shouldRefreshFeishuAccessToken(accessToken: string, expiresAt?: string) {
  if (!accessToken)
    return true
  if (!expiresAt)
    return true
  const time = Date.parse(expiresAt)
  return !Number.isFinite(time) || time <= Date.now() + FEISHU_TOKEN_REFRESH_SKEW_MS
}

function truncateEmailBody(value: string) {
  const text = value.trim()
  if (text.length <= EMAIL_BODY_TEXT_LIMIT)
    return text
  return `${text.slice(0, EMAIL_BODY_TEXT_LIMIT).trimEnd()}\n\n（内容已截断，请进入站内查看完整内容。）`
}

function notificationPlainBody(body: string) {
  return truncateEmailBody(richTextToPlainText(body) || body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function absoluteNotificationUrl(value: string, siteBaseUrl: string) {
  const text = value.trim()
  if (!text)
    return ''
  if (/^https?:\/\//i.test(text))
    return text
  if (!siteBaseUrl)
    return text
  return new URL(text.startsWith('/') ? text : `/${text}`, siteBaseUrl).toString()
}

function notificationAttachments(data: Record<string, unknown> | undefined, siteBaseUrl: string) {
  const rawAttachments = Array.isArray(data?.attachments) ? data.attachments : []
  return rawAttachments
    .filter(isRecord)
    .map((item) => {
      const id = typeof item.id === 'string' ? item.id : ''
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '附件'
      const rawUrl = typeof item.url === 'string' && item.url.trim()
        ? item.url
        : id
          ? `/api/uploads/${encodeURIComponent(id)}/file`
          : ''
      return {
        name,
        url: absoluteNotificationUrl(rawUrl, siteBaseUrl),
      }
    })
    .filter(item => item.url)
}

export function renderNotificationEmailContent(title: string, body: string, data: Record<string, unknown> | undefined, siteBaseUrl: string) {
  const plainBody = notificationPlainBody(body)
  const attachments = notificationAttachments(data, siteBaseUrl)
  const attachmentText = attachments.length
    ? `\n\n附件：\n${attachments.map((item, index) => `${index + 1}. ${item.name} - 点击下载：${item.url}`).join('\n')}`
    : ''
  const text = `${title}\n\n${plainBody}${attachmentText}\n\nTouch Great Welfare`
  const attachmentHtml = attachments.length
    ? `<p><strong>附件：</strong></p><ol>${attachments.map(item => `<li>${escapeHtml(item.name)} - <a href="${escapeHtml(item.url)}">点击下载</a></li>`).join('')}</ol>`
    : ''
  const html = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(plainBody).replace(/\n/g, '<br>')}</p>${attachmentHtml}<p style="color:#64748b">Touch Great Welfare</p>`
  return { text, html }
}

function attachmentData(attachments?: AttachmentMeta[]) {
  return attachments?.map(file => ({
    id: file.id,
    name: file.name,
    url: file.url,
  })) ?? []
}

export async function ensureNotificationSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    const statements = [
      `
        create table if not exists integration_events (
          id text primary key,
          provider text not null,
          event_id text,
          event_type text,
          signature_valid integer not null default 0,
          payload text not null,
          status text not null,
          error text,
          created_at text not null default current_timestamp,
          processed_at text
        )
      `,
      `
        create table if not exists ai_provider_config (
          id text primary key,
          enabled integer not null default 0,
          base_url text not null,
          image_model text not null,
          review_model text not null default 'gpt-4.1-mini',
          temporary_key_ttl_minutes integer not null default 60,
          temporary_key_quota integer not null default 100,
          llm_api_models text,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists ai_image_jobs (
          id text primary key,
          user_id text not null,
          application_id text,
          model text not null,
          prompt text not null,
          status text not null,
          r2_object_key text,
          content_type text,
          error text,
          created_at text not null default current_timestamp,
          completed_at text,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists ai_temporary_keys (
          id text primary key,
          user_id text not null,
          key_hash text not null,
          upstream_token_id text,
          name text,
          key_masked text,
          quota integer not null,
          status text not null default 'active',
          provider text not null default 'newapi',
          expires_at text not null,
          revoked_at text,
          created_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists system_logs (
          id text primary key,
          level text not null,
          module text not null,
          action text not null,
          message text not null,
          details text not null default '{}',
          ref_id text,
          duration_ms integer,
          created_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists notifications (
          id text primary key,
          user_id text not null,
          event text not null,
          title text not null,
          body text not null,
          data text not null default '{}',
          read_at text,
          created_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists notification_settings (
          user_id text primary key,
          email_enabled integer not null default 0,
          email_address text not null default '',
          feishu_enabled integer not null default 0,
          feishu_webhook_encrypted text,
          browser_push_enabled integer not null default 0,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists notification_deliveries (
          id text primary key,
          notification_id text not null,
          channel text not null,
          status text not null,
          error text,
          charged_points integer not null default 0,
          provider_message_id text,
          provider text not null default '',
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists push_subscriptions (
          id text primary key,
          user_id text not null,
          endpoint text not null unique,
          p256dh text not null,
          auth text not null,
          user_agent text,
          enabled integer not null default 1,
          disabled_at text,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists notification_provider_config (
          id text primary key,
          resend_api_key_encrypted text,
          resend_from_email text not null default '',
          vapid_public_key text not null default '',
          vapid_private_key_encrypted text,
          vapid_subject text not null default '',
          feishu_mail_enabled integer not null default 0,
          feishu_app_id text not null default '',
          feishu_app_secret_encrypted text,
          feishu_user_access_token_encrypted text,
          feishu_refresh_token_encrypted text,
          feishu_access_token_expires_at text,
          feishu_refresh_token_expires_at text,
          feishu_user_mailbox_id text not null default 'me',
          feishu_site_base_url text not null default '',
          feishu_daily_limit integer not null default 400,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists sub2api_config (
          id text primary key,
          enabled integer not null default 0,
          base_url text not null default '',
          admin_api_key_encrypted text,
          database_url_encrypted text,
          default_group_id integer,
          default_quota_usd real not null default 0,
          default_expires_in_days integer not null default 30,
          default_rate_limit_5h real not null default 0,
          default_rate_limit_1d real not null default 0,
          default_rate_limit_7d real not null default 0,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists sub2api_key_bindings (
          id text primary key,
          user_id text not null,
          application_id text,
          item_id text,
          sub2api_user_id text not null,
          sub2api_key_id text,
          key_hash text not null,
          key_masked text not null,
          name text not null,
          quota_usd real not null default 0,
          expires_at text,
          status text not null,
          created_at text not null default current_timestamp,
          revoked_at text
        )
      `,
      `
        create table if not exists sub2api_resource_provision_locks (
          id text primary key,
          owner text not null,
          expires_at text not null,
          created_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists database_provision_config (
          id text primary key,
          enabled integer not null default 0,
          root_url_encrypted text,
          default_expires_in_days integer not null default 30,
          database_prefix text not null default 'twg',
          onepanel_base_url text not null default '',
          onepanel_api_key_encrypted text,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `,
      `
        create table if not exists database_resource_bindings (
          id text primary key,
          user_id text not null,
          application_id text not null,
          item_id text not null,
          database_type text not null,
          database_name text not null,
          username text not null,
          password_hash text not null,
          connection_url_encrypted text,
          connection_url_masked text not null,
          permission text not null,
          expires_at text,
          status text not null,
          created_at text not null default current_timestamp,
          revoked_at text
        )
      `,
    ]

    for (const statement of statements)
      await env.LOCAL_DB!.prepare(statement).run()
    await addD1ColumnIfMissing(env, 'sub2api_key_bindings', 'application_id', 'text')
    await addD1ColumnIfMissing(env, 'sub2api_key_bindings', 'item_id', 'text')
    const indexStatements = [
      'create index if not exists idx_database_resource_bindings_user_created on database_resource_bindings (user_id, created_at desc, id desc)',
      'create index if not exists idx_database_resource_bindings_item on database_resource_bindings (application_id, item_id)',
      'create index if not exists idx_sub2api_key_bindings_resource_item on sub2api_key_bindings (application_id, item_id, status)',
      `
        update database_resource_bindings
        set status = 'revoked',
            revoked_at = coalesce(revoked_at, current_timestamp)
        where status = 'active'
          and exists (
            select 1
            from database_resource_bindings newer
            where newer.application_id = database_resource_bindings.application_id
              and newer.item_id = database_resource_bindings.item_id
              and newer.status = 'active'
              and (
                newer.created_at > database_resource_bindings.created_at
                or (newer.created_at = database_resource_bindings.created_at and newer.id > database_resource_bindings.id)
              )
          )
      `,
      'create unique index if not exists idx_database_resource_bindings_active_item on database_resource_bindings (application_id, item_id) where status = \'active\'',
      'create index if not exists idx_system_logs_created on system_logs (created_at desc, id desc)',
    ]
    for (const statement of indexStatements)
      await env.LOCAL_DB!.prepare(statement).run()
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'review_model', 'text not null default \'gpt-4.1-mini\'')
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'api_key_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'newapi_key_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'newapi_management_base_url', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'newapi_user_id', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'ai_provider_config', 'llm_api_models', 'text')
    await addD1ColumnIfMissing(env, 'ai_temporary_keys', 'name', 'text')
    await addD1ColumnIfMissing(env, 'ai_temporary_keys', 'key_masked', 'text')
    await addD1ColumnIfMissing(env, 'ai_temporary_keys', 'status', 'text not null default \'active\'')
    await addD1ColumnIfMissing(env, 'ai_temporary_keys', 'provider', 'text not null default \'newapi\'')
    await addD1ColumnIfMissing(env, 'sub2api_config', 'database_url_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'database_provision_config', 'onepanel_base_url', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'database_provision_config', 'onepanel_api_key_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'notification_deliveries', 'provider', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_mail_enabled', 'integer not null default 0')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_app_id', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_app_secret_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_user_access_token_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_refresh_token_encrypted', 'text')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_access_token_expires_at', 'text')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_refresh_token_expires_at', 'text')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_user_mailbox_id', 'text not null default \'me\'')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_site_base_url', 'text not null default \'\'')
    await addD1ColumnIfMissing(env, 'notification_provider_config', 'feishu_daily_limit', 'integer not null default 400')
    return
  }

  const pool = getPool(env)
  await pool.query(`
    create table if not exists integration_events (
      id text primary key,
      provider text not null,
      event_id text,
      event_type text,
      signature_valid boolean not null default false,
      payload text not null,
      status text not null,
      error text,
      created_at timestamptz not null default now(),
      processed_at timestamptz
    )
  `)
  await pool.query(`
    create table if not exists ai_provider_config (
      id text primary key,
      enabled boolean not null default false,
      base_url text not null,
      image_model text not null,
      review_model text not null default 'gpt-4.1-mini',
      api_key_encrypted text,
      newapi_key_encrypted text,
      newapi_management_base_url text not null default '',
      newapi_user_id text not null default '',
      temporary_key_ttl_minutes integer not null default 60,
      temporary_key_quota integer not null default 100,
      llm_api_models jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table ai_provider_config add column if not exists review_model text not null default $1', ['gpt-4.1-mini'])
  await pool.query('alter table ai_provider_config add column if not exists api_key_encrypted text')
  await pool.query('alter table ai_provider_config add column if not exists newapi_key_encrypted text')
  await pool.query('alter table ai_provider_config add column if not exists newapi_management_base_url text not null default $1', [''])
  await pool.query('alter table ai_provider_config add column if not exists newapi_user_id text not null default $1', [''])
  await pool.query('alter table ai_provider_config add column if not exists llm_api_models jsonb')
  await pool.query(`
    create table if not exists ai_image_jobs (
      id text primary key,
      user_id text not null,
      application_id text,
      model text not null,
      prompt text not null,
      status text not null,
      r2_object_key text,
      content_type text,
      error text,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists ai_temporary_keys (
      id text primary key,
      user_id text not null,
      key_hash text not null,
      upstream_token_id text,
      name text,
      key_masked text,
      quota integer not null,
      status text not null default 'active',
      provider text not null default 'newapi',
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table ai_temporary_keys add column if not exists name text')
  await pool.query('alter table ai_temporary_keys add column if not exists key_masked text')
  await pool.query('alter table ai_temporary_keys add column if not exists status text not null default $1', ['active'])
  await pool.query('alter table ai_temporary_keys add column if not exists provider text not null default $1', ['newapi'])
  await pool.query(`
    create table if not exists sub2api_config (
      id text primary key,
      enabled boolean not null default false,
      base_url text not null default '',
      admin_api_key_encrypted text,
      database_url_encrypted text,
      default_group_id bigint,
      default_quota_usd numeric(20,8) not null default 0,
      default_expires_in_days integer not null default 30,
      default_rate_limit_5h numeric(20,8) not null default 0,
      default_rate_limit_1d numeric(20,8) not null default 0,
      default_rate_limit_7d numeric(20,8) not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table sub2api_config add column if not exists database_url_encrypted text')
  await pool.query(`
    create table if not exists sub2api_key_bindings (
      id text primary key,
      user_id text not null,
      application_id text,
      item_id text,
      sub2api_user_id text not null,
      sub2api_key_id text,
      key_hash text not null,
      key_masked text not null,
      name text not null,
      quota_usd numeric(20,8) not null default 0,
      expires_at timestamptz,
      status text not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    )
  `)
  await pool.query('alter table sub2api_key_bindings add column if not exists application_id text')
  await pool.query('alter table sub2api_key_bindings add column if not exists item_id text')
  await pool.query('create index if not exists idx_sub2api_key_bindings_resource_item on sub2api_key_bindings (application_id, item_id, status)')
  await pool.query(`
    create table if not exists sub2api_resource_provision_locks (
      id text primary key,
      owner text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists database_provision_config (
      id text primary key,
      enabled boolean not null default false,
      root_url_encrypted text,
      default_expires_in_days integer not null default 30,
      database_prefix text not null default 'twg',
      onepanel_base_url text not null default '',
      onepanel_api_key_encrypted text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table database_provision_config add column if not exists onepanel_base_url text not null default \'\'')
  await pool.query('alter table database_provision_config add column if not exists onepanel_api_key_encrypted text')
  await pool.query(`
    create table if not exists database_resource_bindings (
      id text primary key,
      user_id text not null,
      application_id text not null,
      item_id text not null,
      database_type text not null,
      database_name text not null,
      username text not null,
      password_hash text not null,
      connection_url_encrypted text,
      connection_url_masked text not null,
      permission text not null,
      expires_at timestamptz,
      status text not null,
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    )
  `)
  await pool.query('create index if not exists idx_database_resource_bindings_user_created on database_resource_bindings (user_id, created_at desc, id desc)')
  await pool.query('create index if not exists idx_database_resource_bindings_item on database_resource_bindings (application_id, item_id)')
  await pool.query(`
    update database_resource_bindings
    set status = 'revoked',
        revoked_at = coalesce(revoked_at, current_timestamp)
    where status = 'active'
      and exists (
        select 1
        from database_resource_bindings newer
        where newer.application_id = database_resource_bindings.application_id
          and newer.item_id = database_resource_bindings.item_id
          and newer.status = 'active'
          and (
            newer.created_at > database_resource_bindings.created_at
            or (newer.created_at = database_resource_bindings.created_at and newer.id > database_resource_bindings.id)
          )
      )
  `)
  await pool.query('create unique index if not exists idx_database_resource_bindings_active_item on database_resource_bindings (application_id, item_id) where status = \'active\'')
  await pool.query(`
    create table if not exists system_logs (
      id text primary key,
      level text not null,
      module text not null,
      action text not null,
      message text not null,
      details jsonb not null default '{}'::jsonb,
      ref_id text,
      duration_ms integer,
      created_at timestamptz not null default now()
    )
  `)
  await pool.query('create index if not exists idx_system_logs_created on system_logs (created_at desc, id desc)')
  await pool.query(`
    create table if not exists notifications (
      id text primary key,
      user_id text not null,
      event text not null,
      title text not null,
      body text not null,
      data text not null default '{}',
      read_at timestamptz,
      created_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists notification_settings (
      user_id text primary key,
      email_enabled boolean not null default false,
      email_address text not null default '',
      feishu_enabled boolean not null default false,
      feishu_webhook_encrypted text,
      browser_push_enabled boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists notification_deliveries (
      id text primary key,
      notification_id text not null,
      channel text not null,
      status text not null,
      error text,
      charged_points integer not null default 0,
      provider_message_id text,
      provider text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table notification_deliveries add column if not exists provider text not null default $1', [''])
  await pool.query(`
    create table if not exists push_subscriptions (
      id text primary key,
      user_id text not null,
      endpoint text not null unique,
      p256dh text not null,
      auth text not null,
      user_agent text,
      enabled boolean not null default true,
      disabled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`)
  await pool.query(`
    create table if not exists notification_provider_config (
      id text primary key,
      resend_api_key_encrypted text,
      resend_from_email text not null default '',
      vapid_public_key text not null default '',
      vapid_private_key_encrypted text,
      vapid_subject text not null default '',
      feishu_mail_enabled boolean not null default false,
      feishu_app_id text not null default '',
      feishu_app_secret_encrypted text,
      feishu_user_access_token_encrypted text,
      feishu_refresh_token_encrypted text,
      feishu_access_token_expires_at timestamptz,
      feishu_refresh_token_expires_at timestamptz,
      feishu_user_mailbox_id text not null default 'me',
      feishu_site_base_url text not null default '',
      feishu_daily_limit integer not null default 400,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table notification_provider_config add column if not exists feishu_mail_enabled boolean not null default false')
  await pool.query('alter table notification_provider_config add column if not exists feishu_app_id text not null default $1', [''])
  await pool.query('alter table notification_provider_config add column if not exists feishu_app_secret_encrypted text')
  await pool.query('alter table notification_provider_config add column if not exists feishu_user_access_token_encrypted text')
  await pool.query('alter table notification_provider_config add column if not exists feishu_refresh_token_encrypted text')
  await pool.query('alter table notification_provider_config add column if not exists feishu_access_token_expires_at timestamptz')
  await pool.query('alter table notification_provider_config add column if not exists feishu_refresh_token_expires_at timestamptz')
  await pool.query('alter table notification_provider_config add column if not exists feishu_user_mailbox_id text not null default $1', [DEFAULT_FEISHU_USER_MAILBOX_ID])
  await pool.query('alter table notification_provider_config add column if not exists feishu_site_base_url text not null default $1', [''])
  await pool.query('alter table notification_provider_config add column if not exists feishu_daily_limit integer not null default $1', [DEFAULT_FEISHU_DAILY_LIMIT])
}

async function insertNotification(env: WorkerEnv, input: CreateNotificationInput) {
  await ensureNotificationSchema(env)
  const id = createId('ntf')
  const payload = JSON.stringify(input.data ?? {})

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notifications (id, user_id, event, title, body, data, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
      `)
      .bind(id, input.userId, input.event, input.title, input.body, payload)
      .run()
  }
  else {
    await getPool(env).query(`
      insert into notifications (id, user_id, event, title, body, data, created_at)
      values ($1, $2, $3, $4, $5, $6, now())
    `, [id, input.userId, input.event, input.title, input.body, payload])
  }

  return id
}

async function recordDelivery(
  env: WorkerEnv,
  notificationId: string,
  channel: NotificationChannel,
  status: DeliveryStatus,
  error = '',
  chargedPoints = 0,
  providerMessageId = '',
  provider: NotificationDeliveryProvider = '',
) {
  await ensureNotificationSchema(env)
  const id = createId('dlv')

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notification_deliveries (id, notification_id, channel, status, error, charged_points, provider_message_id, provider, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, current_timestamp, current_timestamp)
      `)
      .bind(id, notificationId, channel, status, error || null, chargedPoints, providerMessageId || null, provider)
      .run()
    return
  }

  await getPool(env).query(`
    insert into notification_deliveries (id, notification_id, channel, status, error, charged_points, provider_message_id, provider, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
  `, [id, notificationId, channel, status, error || null, chargedPoints, providerMessageId || null, provider])
}

async function writeSystemLog(env: WorkerEnv, input: SystemLogInput) {
  await ensureNotificationSchema(env)
  const id = createId('log')
  const details = JSON.stringify(input.details ?? {})
  const durationMs = input.durationMs === undefined ? null : Math.max(0, Math.trunc(input.durationMs))

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into system_logs (id, level, module, action, message, details, ref_id, duration_ms, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, current_timestamp)
      `)
      .bind(id, input.level, input.module, input.action, input.message, details, input.refId || null, durationMs)
      .run()
    return id
  }

  await getPool(env).query(`
    insert into system_logs (id, level, module, action, message, details, ref_id, duration_ms, created_at)
    values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
  `, [id, input.level, input.module, input.action, input.message, details, input.refId || null, durationMs])
  return id
}

function parseLogDetails(value: SystemLogRow['details']) {
  if (!value)
    return {}
  if (typeof value === 'object')
    return value as Record<string, unknown>
  try {
    return JSON.parse(value) as Record<string, unknown>
  }
  catch {
    return { raw: value }
  }
}

function mapSystemLog(row: SystemLogRow): SystemLogItem {
  return {
    id: row.id,
    level: row.level,
    module: row.module,
    action: row.action,
    message: row.message,
    details: parseLogDetails(row.details),
    refId: row.ref_id || undefined,
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? undefined : Number(row.duration_ms),
    createdAt: toIso(row.created_at) ?? now(),
  }
}

async function listSystemLogs(env: WorkerEnv, limit = 100): Promise<SystemLogListResult> {
  await ensureNotificationSchema(env)
  const normalizedLimit = Math.max(1, Math.min(300, Math.trunc(limit)))
  if (shouldUseD1(env)) {
    const rows = (await env.LOCAL_DB!
      .prepare('select * from system_logs order by created_at desc, id desc limit ?1')
      .bind(normalizedLimit)
      .all<SystemLogRow>()).results
    return { logs: rows.map(mapSystemLog) }
  }

  const result = await getPool(env).query<SystemLogRow>('select * from system_logs order by created_at desc, id desc limit $1', [normalizedLimit])
  return { logs: result.rows.map(mapSystemLog) }
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function emailDeliveryAttempt(provider: EmailDeliveryProvider, status: EmailDeliveryStatus, message: string): EmailDeliveryAttempt {
  return {
    provider,
    providerLabel: EMAIL_DELIVERY_PROVIDER_LABELS[provider],
    status,
    message,
  }
}

function formatEmailDeliveryAttempt(attempt: EmailDeliveryAttempt) {
  return `${attempt.providerLabel}：${EMAIL_DELIVERY_STATUS_LABELS[attempt.status]}（${attempt.message || '未返回详情'}）`
}

function emailTestFailureMessage(attempts: EmailDeliveryAttempt[]) {
  if (!attempts.length)
    return '测试邮件发送失败，请检查邮箱通知服务配置'

  return [
    '测试邮件发送失败，已尝试以下通道：',
    ...attempts.map(formatEmailDeliveryAttempt),
    '请根据以上信息检查邮箱通知服务配置。',
  ].join('\n')
}

async function getSettingsRow(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from notification_settings where user_id = ?1')
      .bind(userId)
      .first<NotificationSettingsRow>()
  }

  const result = await getPool(env).query<NotificationSettingsRow>(
    'select * from notification_settings where user_id = $1',
    [userId],
  )
  return result.rows[0] ?? null
}

async function countPushSubscriptions(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select count(*) as count from push_subscriptions where user_id = ?1 and enabled = 1')
      .bind(userId)
      .first<{ count: number }>()
    return Number(row?.count ?? 0)
  }

  const result = await getPool(env).query<{ count: string }>(
    'select count(*) as count from push_subscriptions where user_id = $1 and enabled = true',
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function toSettingsView(env: WorkerEnv, user: User, row: NotificationSettingsRow | null): Promise<NotificationSettingsView> {
  let feishuWebhookMasked = ''
  if (row?.feishu_webhook_encrypted) {
    try {
      feishuWebhookMasked = maskSecret(await decryptSecret(row.feishu_webhook_encrypted, encryptionSecret(env)))
    }
    catch {
      feishuWebhookMasked = '••••'
    }
  }

  return {
    emailEnabled: boolValue(row?.email_enabled),
    emailAddress: row?.email_address || user.profile.email,
    feishuEnabled: boolValue(row?.feishu_enabled),
    feishuWebhookMasked,
    browserPushEnabled: boolValue(row?.browser_push_enabled),
    pushSubscriptionCount: await countPushSubscriptions(env, user.id),
  }
}

async function saveSettings(env: WorkerEnv, user: User, payload: SaveNotificationSettingsPayload) {
  await ensureNotificationSchema(env)
  const current = await getSettingsRow(env, user.id)
  const emailAddress = (payload.emailAddress?.trim() || user.profile.email).toLowerCase()
  if (payload.emailEnabled)
    assertEmail(emailAddress)

  let feishuWebhookEncrypted = current?.feishu_webhook_encrypted ?? null
  if (payload.clearFeishuWebhook)
    feishuWebhookEncrypted = null
  if (payload.feishuWebhookUrl?.trim()) {
    const url = normalizeExternalHttpsUrl(payload.feishuWebhookUrl, '飞书 Webhook 无效')
    feishuWebhookEncrypted = await encryptSecret(url, encryptionSecret(env))
  }
  if (payload.feishuEnabled && !feishuWebhookEncrypted)
    throw new Error('启用飞书通知前请先填写 Webhook')
  if (payload.browserPushEnabled && await countPushSubscriptions(env, user.id) === 0)
    throw new Error('启用浏览器 Push 前请先完成注册')

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notification_settings (
          user_id, email_enabled, email_address, feishu_enabled, feishu_webhook_encrypted, browser_push_enabled, updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
        on conflict (user_id)
        do update set
          email_enabled = excluded.email_enabled,
          email_address = excluded.email_address,
          feishu_enabled = excluded.feishu_enabled,
          feishu_webhook_encrypted = excluded.feishu_webhook_encrypted,
          browser_push_enabled = excluded.browser_push_enabled,
          updated_at = current_timestamp
      `)
      .bind(user.id, payload.emailEnabled ? 1 : 0, emailAddress, payload.feishuEnabled ? 1 : 0, feishuWebhookEncrypted, payload.browserPushEnabled ? 1 : 0)
      .run()
  }
  else {
    await getPool(env).query(`
      insert into notification_settings (
        user_id, email_enabled, email_address, feishu_enabled, feishu_webhook_encrypted, browser_push_enabled, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (user_id)
      do update set
        email_enabled = excluded.email_enabled,
        email_address = excluded.email_address,
        feishu_enabled = excluded.feishu_enabled,
        feishu_webhook_encrypted = excluded.feishu_webhook_encrypted,
        browser_push_enabled = excluded.browser_push_enabled,
        updated_at = now()
    `, [user.id, payload.emailEnabled, emailAddress, payload.feishuEnabled, feishuWebhookEncrypted, payload.browserPushEnabled])
  }

  return toSettingsView(env, user, await getSettingsRow(env, user.id))
}

async function listNotifications(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  let rows: NotificationRow[] = []

  if (shouldUseD1(env)) {
    rows = (await env.LOCAL_DB!
      .prepare(`
        select * from notifications
        where user_id = ?1
        order by created_at desc
        limit ?2
      `)
      .bind(userId, NOTIFICATION_LIMIT)
      .all<NotificationRow>()).results
  }
  else {
    const result = await getPool(env).query<NotificationRow>(`
      select * from notifications
      where user_id = $1
      order by created_at desc
      limit $2
    `, [userId, NOTIFICATION_LIMIT])
    rows = result.rows
  }

  const notifications = rows.map(mapNotification)
  return {
    notifications,
    unreadCount: notifications.filter(item => !item.readAt).length,
  }
}

async function markNotificationRead(env: WorkerEnv, userId: string, id: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update notifications set read_at = coalesce(read_at, current_timestamp) where id = ?1 and user_id = ?2')
      .bind(id, userId)
      .run()
    return
  }

  await getPool(env).query('update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2', [id, userId])
}

async function markAllNotificationsRead(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update notifications set read_at = coalesce(read_at, current_timestamp) where user_id = ?1 and read_at is null')
      .bind(userId)
      .run()
    return
  }

  await getPool(env).query('update notifications set read_at = coalesce(read_at, now()) where user_id = $1 and read_at is null', [userId])
}

async function getPushSubscriptions(env: WorkerEnv, userId: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return (await env.LOCAL_DB!
      .prepare('select * from push_subscriptions where user_id = ?1 and enabled = 1')
      .bind(userId)
      .all<PushSubscriptionRow>()).results
  }

  const result = await getPool(env).query<PushSubscriptionRow>(
    'select * from push_subscriptions where user_id = $1 and enabled = true',
    [userId],
  )
  return result.rows
}

async function savePushSubscription(env: WorkerEnv, userId: string, payload: PushSubscriptionPayload, userAgent: string) {
  await ensureNotificationSchema(env)
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth)
    throw new Error('Push 订阅参数无效')
  const endpoint = normalizePushEndpoint(payload.endpoint)
  assertPushKey(payload.keys.p256dh, 'Push p256dh')
  assertPushKey(payload.keys.auth, 'Push auth')

  const id = createId('psh')
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, enabled, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, 1, current_timestamp)
        on conflict (endpoint)
        do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = 1, disabled_at = null, updated_at = current_timestamp
      `)
      .bind(id, userId, endpoint, payload.keys.p256dh, payload.keys.auth, userAgent)
      .run()
    await setBrowserPushEnabled(env, userId, true)
    return
  }

  await getPool(env).query(`
    insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, enabled, updated_at)
    values ($1, $2, $3, $4, $5, $6, true, now())
    on conflict (endpoint)
    do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = true, disabled_at = null, updated_at = now()
  `, [id, userId, endpoint, payload.keys.p256dh, payload.keys.auth, userAgent])
  await setBrowserPushEnabled(env, userId, true)
}

async function setBrowserPushEnabled(env: WorkerEnv, userId: string, enabled: boolean) {
  const current = await getSettingsRow(env, userId)
  if (!current) {
    if (shouldUseD1(env)) {
      await env.LOCAL_DB!
        .prepare('insert into notification_settings (user_id, browser_push_enabled, updated_at) values (?1, ?2, current_timestamp)')
        .bind(userId, enabled ? 1 : 0)
        .run()
      return
    }
    await getPool(env).query('insert into notification_settings (user_id, browser_push_enabled, updated_at) values ($1, $2, now())', [userId, enabled])
    return
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update notification_settings set browser_push_enabled = ?1, updated_at = current_timestamp where user_id = ?2')
      .bind(enabled ? 1 : 0, userId)
      .run()
    return
  }

  await getPool(env).query('update notification_settings set browser_push_enabled = $1, updated_at = now() where user_id = $2', [enabled, userId])
}

async function disablePushSubscription(env: WorkerEnv, id: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update push_subscriptions set enabled = 0, disabled_at = current_timestamp, updated_at = current_timestamp where id = ?1')
      .bind(id)
      .run()
    return
  }

  await getPool(env).query('update push_subscriptions set enabled = false, disabled_at = now(), updated_at = now() where id = $1', [id])
}

async function disableAllPushSubscriptions(env: WorkerEnv) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update push_subscriptions set enabled = 0, disabled_at = current_timestamp, updated_at = current_timestamp where enabled = 1')
      .run()
    await env.LOCAL_DB!
      .prepare('update notification_settings set browser_push_enabled = 0, updated_at = current_timestamp where browser_push_enabled = 1')
      .run()
    return
  }

  await getPool(env).query('update push_subscriptions set enabled = false, disabled_at = now(), updated_at = now() where enabled = true')
  await getPool(env).query('update notification_settings set browser_push_enabled = false, updated_at = now() where browser_push_enabled = true')
}

async function deletePushSubscription(env: WorkerEnv, userId: string, id: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare('update push_subscriptions set enabled = 0, disabled_at = current_timestamp, updated_at = current_timestamp where id = ?1 and user_id = ?2')
      .bind(id, userId)
      .run()
    return
  }

  await getPool(env).query('update push_subscriptions set enabled = false, disabled_at = now(), updated_at = now() where id = $1 and user_id = $2', [id, userId])
}

async function hasEnoughPoints(env: WorkerEnv, userId: string, points: number) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const user = state.users.find(item => item.id === userId)
  return !!user && user.points >= points
}

async function chargeEmailNotification(env: WorkerEnv, userId: string, notificationId: string) {
  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  assertWelfareState(state)
  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('通知用户不存在')
  if (user.points < EMAIL_NOTIFICATION_COST)
    throw new Error('邮箱通知余额不足')

  await appendPointTransaction(env, {
    id: pointTransactionId('email_notification', notificationId),
    userId,
    delta: -EMAIL_NOTIFICATION_COST,
    type: 'spend',
    reason: '邮箱通知发送扣费',
    refId: notificationId,
  }, state)
  await writeWelfareState(env, state, { expectedVersion: record.version })
}

async function getNotificationProviderConfig(env: WorkerEnv) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from notification_provider_config where id = ?1')
      .bind(NOTIFICATION_PROVIDER_CONFIG_ID)
      .first<NotificationProviderConfigRow>()
  }

  const result = await getPool(env).query<NotificationProviderConfigRow>(
    'select * from notification_provider_config where id = $1',
    [NOTIFICATION_PROVIDER_CONFIG_ID],
  )
  return result.rows[0] ?? null
}

async function decryptProviderSecret(value: string | null | undefined, env: WorkerEnv) {
  if (!value)
    return ''
  try {
    return await decryptSecret(value, encryptionSecret(env))
  }
  catch {
    return ''
  }
}

function isFeishuMailConfigured(config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  return !!(
    config.feishuMailEnabled
    && config.feishuAppId
    && config.feishuAppSecret
    && config.feishuUserMailboxId
  )
}

async function getEffectiveNotificationProviderConfig(env: WorkerEnv) {
  const stored = await getNotificationProviderConfig(env)
  const resendApiKey = await decryptProviderSecret(stored?.resend_api_key_encrypted, env)
  const vapidPrivateKey = await decryptProviderSecret(stored?.vapid_private_key_encrypted, env)
  const feishuAppSecret = await decryptProviderSecret(stored?.feishu_app_secret_encrypted, env)
  const feishuUserAccessToken = await decryptProviderSecret(stored?.feishu_user_access_token_encrypted, env)
  const feishuRefreshToken = await decryptProviderSecret(stored?.feishu_refresh_token_encrypted, env)
  return {
    resendApiKey,
    resendFromEmail: stored?.resend_from_email || '',
    vapidPublicKey: stored?.vapid_public_key || '',
    vapidPrivateKey,
    vapidSubject: stored?.vapid_subject || DEFAULT_VAPID_SUBJECT,
    feishuMailEnabled: boolValue(stored?.feishu_mail_enabled),
    feishuAppId: stored?.feishu_app_id || '',
    feishuAppSecret,
    feishuUserAccessToken,
    feishuRefreshToken,
    feishuAccessTokenExpiresAt: toIso(stored?.feishu_access_token_expires_at),
    feishuRefreshTokenExpiresAt: toIso(stored?.feishu_refresh_token_expires_at),
    feishuUserMailboxId: stored?.feishu_user_mailbox_id || DEFAULT_FEISHU_USER_MAILBOX_ID,
    feishuSiteBaseUrl: stored?.feishu_site_base_url || '',
    feishuDailyLimit: normalizeFeishuDailyLimit(stored?.feishu_daily_limit),
    source: stored ? 'admin' as const : 'empty' as const,
  }
}

function serializeNotificationProviderConfig(config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  const feishuMailConfigured = isFeishuMailConfigured(config)
  return {
    configured: {
      email: !!(config.resendApiKey && config.resendFromEmail) || feishuMailConfigured,
      push: !!(config.vapidPublicKey && config.vapidPrivateKey),
      feishuMail: feishuMailConfigured,
    },
    resendApiKeyMasked: maskSecret(config.resendApiKey),
    resendFromEmail: config.resendFromEmail,
    vapidPublicKey: config.vapidPublicKey,
    vapidPrivateKeyMasked: maskSecret(config.vapidPrivateKey),
    vapidSubject: config.vapidSubject,
    feishuMailEnabled: config.feishuMailEnabled,
    feishuAppId: config.feishuAppId,
    feishuAppSecretMasked: maskSecret(config.feishuAppSecret),
    feishuUserAccessTokenMasked: maskSecret(config.feishuUserAccessToken),
    feishuRefreshTokenMasked: maskSecret(config.feishuRefreshToken),
    feishuAccessTokenExpiresAt: config.feishuAccessTokenExpiresAt,
    feishuRefreshTokenExpiresAt: config.feishuRefreshTokenExpiresAt,
    feishuUserMailboxId: config.feishuUserMailboxId,
    feishuSiteBaseUrl: config.feishuSiteBaseUrl,
    feishuDailyLimit: config.feishuDailyLimit,
    source: config.source,
  }
}

async function saveNotificationProviderConfig(env: WorkerEnv, payload: NotificationProviderConfigPayload) {
  await ensureNotificationSchema(env)
  const stored = await getNotificationProviderConfig(env)
  let resendApiKeyEncrypted = stored?.resend_api_key_encrypted || null
  let vapidPrivateKeyEncrypted = stored?.vapid_private_key_encrypted || null
  let feishuAppSecretEncrypted = stored?.feishu_app_secret_encrypted || null
  let feishuUserAccessTokenEncrypted = stored?.feishu_user_access_token_encrypted || null
  let feishuRefreshTokenEncrypted = stored?.feishu_refresh_token_encrypted || null
  if (payload.clearResendApiKey)
    resendApiKeyEncrypted = null
  if (payload.clearVapidPrivateKey)
    vapidPrivateKeyEncrypted = null
  if (payload.clearFeishuAppSecret)
    feishuAppSecretEncrypted = null
  if (payload.clearFeishuUserAccessToken)
    feishuUserAccessTokenEncrypted = null
  if (payload.clearFeishuRefreshToken)
    feishuRefreshTokenEncrypted = null
  if (payload.resendApiKey?.trim())
    resendApiKeyEncrypted = await encryptSecret(payload.resendApiKey.trim(), encryptionSecret(env))
  if (payload.vapidPrivateKey?.trim())
    vapidPrivateKeyEncrypted = await encryptSecret(payload.vapidPrivateKey.trim(), encryptionSecret(env))
  if (payload.feishuAppSecret?.trim())
    feishuAppSecretEncrypted = await encryptSecret(payload.feishuAppSecret.trim(), encryptionSecret(env))
  if (payload.feishuUserAccessToken?.trim())
    feishuUserAccessTokenEncrypted = await encryptSecret(payload.feishuUserAccessToken.trim(), encryptionSecret(env))
  if (payload.feishuRefreshToken?.trim())
    feishuRefreshTokenEncrypted = await encryptSecret(payload.feishuRefreshToken.trim(), encryptionSecret(env))

  const feishuMailEnabled = !!payload.feishuMailEnabled
  const feishuAppId = payload.feishuAppId?.trim() || ''
  const feishuUserMailboxId = payload.feishuUserMailboxId?.trim() || DEFAULT_FEISHU_USER_MAILBOX_ID
  const feishuSiteBaseUrl = normalizeSiteBaseUrl(payload.feishuSiteBaseUrl)
  const feishuDailyLimit = normalizeFeishuDailyLimit(payload.feishuDailyLimit)
  if (feishuMailEnabled) {
    if (!feishuAppId)
      throw new Error('启用飞书邮件前请填写 App ID')
    if (!feishuAppSecretEncrypted)
      throw new Error('启用飞书邮件前请填写 App Secret')
    if (!feishuUserMailboxId)
      throw new Error('启用飞书邮件前请填写发信邮箱')
  }

  const config = {
    resendApiKeyEncrypted,
    resendFromEmail: payload.resendFromEmail?.trim() || '',
    vapidPublicKey: payload.vapidPublicKey?.trim() || '',
    vapidPrivateKeyEncrypted,
    vapidSubject: payload.vapidSubject?.trim() || DEFAULT_VAPID_SUBJECT,
    feishuMailEnabled,
    feishuAppId,
    feishuAppSecretEncrypted,
    feishuUserAccessTokenEncrypted,
    feishuRefreshTokenEncrypted,
    feishuAccessTokenExpiresAt: payload.clearFeishuUserAccessToken ? '' : payload.feishuAccessTokenExpiresAt?.trim() || toIso(stored?.feishu_access_token_expires_at) || '',
    feishuRefreshTokenExpiresAt: payload.clearFeishuRefreshToken ? '' : payload.feishuRefreshTokenExpiresAt?.trim() || toIso(stored?.feishu_refresh_token_expires_at) || '',
    feishuUserMailboxId,
    feishuSiteBaseUrl,
    feishuDailyLimit,
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notification_provider_config (
          id, resend_api_key_encrypted, resend_from_email, vapid_public_key, vapid_private_key_encrypted, vapid_subject,
          feishu_mail_enabled, feishu_app_id, feishu_app_secret_encrypted, feishu_user_access_token_encrypted,
          feishu_refresh_token_encrypted, feishu_access_token_expires_at, feishu_refresh_token_expires_at,
          feishu_user_mailbox_id, feishu_site_base_url, feishu_daily_limit, updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, current_timestamp)
        on conflict (id)
        do update set
          resend_api_key_encrypted = excluded.resend_api_key_encrypted,
          resend_from_email = excluded.resend_from_email,
          vapid_public_key = excluded.vapid_public_key,
          vapid_private_key_encrypted = excluded.vapid_private_key_encrypted,
          vapid_subject = excluded.vapid_subject,
          feishu_mail_enabled = excluded.feishu_mail_enabled,
          feishu_app_id = excluded.feishu_app_id,
          feishu_app_secret_encrypted = excluded.feishu_app_secret_encrypted,
          feishu_user_access_token_encrypted = excluded.feishu_user_access_token_encrypted,
          feishu_refresh_token_encrypted = excluded.feishu_refresh_token_encrypted,
          feishu_access_token_expires_at = excluded.feishu_access_token_expires_at,
          feishu_refresh_token_expires_at = excluded.feishu_refresh_token_expires_at,
          feishu_user_mailbox_id = excluded.feishu_user_mailbox_id,
          feishu_site_base_url = excluded.feishu_site_base_url,
          feishu_daily_limit = excluded.feishu_daily_limit,
          updated_at = current_timestamp
      `)
      .bind(
        NOTIFICATION_PROVIDER_CONFIG_ID,
        config.resendApiKeyEncrypted,
        config.resendFromEmail,
        config.vapidPublicKey,
        config.vapidPrivateKeyEncrypted,
        config.vapidSubject,
        config.feishuMailEnabled ? 1 : 0,
        config.feishuAppId,
        config.feishuAppSecretEncrypted,
        config.feishuUserAccessTokenEncrypted,
        config.feishuRefreshTokenEncrypted,
        config.feishuAccessTokenExpiresAt || null,
        config.feishuRefreshTokenExpiresAt || null,
        config.feishuUserMailboxId,
        config.feishuSiteBaseUrl,
        config.feishuDailyLimit,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into notification_provider_config (
        id, resend_api_key_encrypted, resend_from_email, vapid_public_key, vapid_private_key_encrypted, vapid_subject,
        feishu_mail_enabled, feishu_app_id, feishu_app_secret_encrypted, feishu_user_access_token_encrypted,
        feishu_refresh_token_encrypted, feishu_access_token_expires_at, feishu_refresh_token_expires_at,
        feishu_user_mailbox_id, feishu_site_base_url, feishu_daily_limit, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
      on conflict (id)
      do update set
        resend_api_key_encrypted = excluded.resend_api_key_encrypted,
        resend_from_email = excluded.resend_from_email,
        vapid_public_key = excluded.vapid_public_key,
        vapid_private_key_encrypted = excluded.vapid_private_key_encrypted,
        vapid_subject = excluded.vapid_subject,
        feishu_mail_enabled = excluded.feishu_mail_enabled,
        feishu_app_id = excluded.feishu_app_id,
        feishu_app_secret_encrypted = excluded.feishu_app_secret_encrypted,
        feishu_user_access_token_encrypted = excluded.feishu_user_access_token_encrypted,
        feishu_refresh_token_encrypted = excluded.feishu_refresh_token_encrypted,
        feishu_access_token_expires_at = excluded.feishu_access_token_expires_at,
        feishu_refresh_token_expires_at = excluded.feishu_refresh_token_expires_at,
        feishu_user_mailbox_id = excluded.feishu_user_mailbox_id,
        feishu_site_base_url = excluded.feishu_site_base_url,
        feishu_daily_limit = excluded.feishu_daily_limit,
        updated_at = now()
    `, [
      NOTIFICATION_PROVIDER_CONFIG_ID,
      config.resendApiKeyEncrypted,
      config.resendFromEmail,
      config.vapidPublicKey,
      config.vapidPrivateKeyEncrypted,
      config.vapidSubject,
      config.feishuMailEnabled,
      config.feishuAppId,
      config.feishuAppSecretEncrypted,
      config.feishuUserAccessTokenEncrypted,
      config.feishuRefreshTokenEncrypted,
      config.feishuAccessTokenExpiresAt || null,
      config.feishuRefreshTokenExpiresAt || null,
      config.feishuUserMailboxId,
      config.feishuSiteBaseUrl,
      config.feishuDailyLimit,
    ])
  }

  return getEffectiveNotificationProviderConfig(env)
}

async function createVapidKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as JsonWebKey
  if (!publicJwk.x || !publicJwk.y || !privateJwk.d)
    throw new Error('VAPID 密钥生成失败')

  return {
    publicKey: base64UrlEncode(new Uint8Array([
      4,
      ...base64UrlDecode(publicJwk.x),
      ...base64UrlDecode(publicJwk.y),
    ])),
    privateKey: privateJwk.d,
  }
}

async function generateVapidKeys(env: WorkerEnv, payload: GenerateVapidKeysPayload) {
  const current = await getEffectiveNotificationProviderConfig(env)
  if (current.vapidPublicKey && current.vapidPrivateKey && !payload.regenerate)
    throw new Error('VAPID 已配置，如需替换请确认重新生成')

  const shouldDisableExistingSubscriptions = !!(current.vapidPublicKey && current.vapidPrivateKey && payload.regenerate)
  const keys = await createVapidKeyPair()
  const next = await saveNotificationProviderConfig(env, {
    resendFromEmail: current.resendFromEmail,
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    vapidSubject: current.vapidSubject || DEFAULT_VAPID_SUBJECT,
    feishuMailEnabled: current.feishuMailEnabled,
    feishuAppId: current.feishuAppId,
    feishuUserAccessToken: current.feishuUserAccessToken,
    feishuRefreshToken: current.feishuRefreshToken,
    feishuAccessTokenExpiresAt: current.feishuAccessTokenExpiresAt,
    feishuRefreshTokenExpiresAt: current.feishuRefreshTokenExpiresAt,
    feishuUserMailboxId: current.feishuUserMailboxId,
    feishuSiteBaseUrl: current.feishuSiteBaseUrl,
    feishuDailyLimit: current.feishuDailyLimit,
  })

  if (shouldDisableExistingSubscriptions) {
    await disableAllPushSubscriptions(env)
    await writeSystemLog(env, {
      level: 'warning',
      module: 'notifications',
      action: 'push.vapid_regenerated',
      message: 'VAPID 密钥已重新生成，旧浏览器 Push 订阅已禁用',
    })
  }

  return {
    ...serializeNotificationProviderConfig(next),
    regenerated: !!(current.vapidPublicKey && current.vapidPrivateKey),
  }
}

async function countSentFeishuMailToday(env: WorkerEnv) {
  await ensureNotificationSchema(env)
  const dateKey = shanghaiDateKey()
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare(`
        select count(*) as count
        from notification_deliveries
        where provider = ?1
          and status = 'sent'
          and date(created_at, '+8 hours') = ?2
      `)
      .bind('feishu_mail', dateKey)
      .first<{ count: number }>()
    return Number(row?.count ?? 0)
  }

  const result = await getPool(env).query<{ count: string }>(`
    select count(*) as count
    from notification_deliveries
    where provider = $1
      and status = 'sent'
      and (created_at at time zone 'Asia/Shanghai')::date = $2::date
  `, ['feishu_mail', dateKey])
  return Number(result.rows[0]?.count ?? 0)
}

async function updateFeishuTokens(
  env: WorkerEnv,
  accessToken: string,
  refreshToken: string,
  accessTokenExpiresAt: string,
  refreshTokenExpiresAt: string,
) {
  const accessTokenEncrypted = await encryptSecret(accessToken, encryptionSecret(env))
  const refreshTokenEncrypted = await encryptSecret(refreshToken, encryptionSecret(env))
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        update notification_provider_config
        set feishu_user_access_token_encrypted = ?1,
            feishu_refresh_token_encrypted = ?2,
            feishu_access_token_expires_at = ?3,
            feishu_refresh_token_expires_at = ?4,
            updated_at = current_timestamp
        where id = ?5
      `)
      .bind(accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt, NOTIFICATION_PROVIDER_CONFIG_ID)
      .run()
    return
  }

  await getPool(env).query(`
    update notification_provider_config
    set feishu_user_access_token_encrypted = $1,
        feishu_refresh_token_encrypted = $2,
        feishu_access_token_expires_at = $3,
        feishu_refresh_token_expires_at = $4,
        updated_at = now()
    where id = $5
  `, [accessTokenEncrypted, refreshTokenEncrypted, accessTokenExpiresAt, refreshTokenExpiresAt, NOTIFICATION_PROVIDER_CONFIG_ID])
}

async function refreshFeishuUserAccessToken(env: WorkerEnv, config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  if (!config.feishuAppId || !config.feishuAppSecret || !config.feishuRefreshToken)
    throw new Error('飞书用户授权凭证未配置')

  const response = await fetchWithTimeout('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.feishuAppId,
      client_secret: config.feishuAppSecret,
      refresh_token: config.feishuRefreshToken,
    }),
  })
  const text = await response.text()
  const result = text
    ? JSON.parse(text) as {
      code?: number
      access_token?: string
      expires_in?: number
      refresh_token?: string
      refresh_token_expires_in?: number
      error?: string
      error_description?: string
    }
    : {}
  if (!response.ok || result.code !== 0)
    throw new Error(result.error_description || result.error || `飞书 token 刷新失败：${response.status}`)
  if (!result.access_token || !result.refresh_token)
    throw new Error('飞书 token 刷新响应缺少 access_token 或 refresh_token')

  const accessTokenExpiresAt = expiresAtFromNow(result.expires_in)
  const refreshTokenExpiresAt = expiresAtFromNow(result.refresh_token_expires_in)
  await updateFeishuTokens(env, result.access_token, result.refresh_token, accessTokenExpiresAt, refreshTokenExpiresAt)
  return result.access_token
}

async function getFeishuTenantAccessToken(config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  if (!config.feishuAppId || !config.feishuAppSecret)
    throw new Error('飞书 App ID 或 App Secret 未配置')

  const response = await fetchWithTimeout('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      app_id: config.feishuAppId,
      app_secret: config.feishuAppSecret,
    }),
  })
  const text = await response.text()
  const result = text
    ? JSON.parse(text) as { code?: number, tenant_access_token?: string, msg?: string, error?: string, error_description?: string }
    : {}
  if (!response.ok || result.code !== 0)
    throw new Error(result.error_description || result.error || result.msg || `飞书 tenant_access_token 获取失败：${response.status}`)
  if (!result.tenant_access_token)
    throw new Error('飞书 tenant_access_token 响应为空')
  return result.tenant_access_token
}

async function feishuAccessTokenForSend(env: WorkerEnv, config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  if (!config.feishuUserAccessToken && !config.feishuRefreshToken)
    return getFeishuTenantAccessToken(config)
  if (shouldRefreshFeishuAccessToken(config.feishuUserAccessToken, config.feishuAccessTokenExpiresAt))
    return refreshFeishuUserAccessToken(env, config)
  return config.feishuUserAccessToken
}

async function sendResendEmail(
  config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>,
  to: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  if (!config.resendApiKey || !config.resendFromEmail)
    throw new Error('Resend 邮箱通知未配置')
  const content = renderNotificationEmailContent(title, body, data, config.feishuSiteBaseUrl)

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${config.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resendFromEmail,
      to: [to],
      subject: title,
      text: content.text,
      html: content.html,
    }),
  })
  const result = await response.json().catch(() => ({})) as { id?: string, message?: string }
  if (!response.ok)
    throw new Error(result.message || `Resend 请求失败：${response.status}`)

  return result.id ?? ''
}

async function sendFeishuMail(
  env: WorkerEnv,
  config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>,
  to: string,
  title: string,
  body: string,
  notificationId: string,
  data?: Record<string, unknown>,
) {
  if (!isFeishuMailConfigured(config))
    throw new Error('飞书邮件通知未配置')

  const accessToken = await feishuAccessTokenForSend(env, config)
  const content = renderNotificationEmailContent(title, body, data, config.feishuSiteBaseUrl)
  const response = await fetchWithTimeout(`https://open.feishu.cn/open-apis/mail/v1/user_mailboxes/${encodeURIComponent(config.feishuUserMailboxId)}/messages/send`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      subject: title,
      to: [{ mail_address: to }],
      body_plain_text: content.text,
      body_html: content.html,
      dedupe_key: notificationId,
    }),
  })
  const text = await response.text()
  const result = text ? JSON.parse(text) as { code?: number, msg?: string, data?: { message_id?: string } } : {}
  if (!response.ok || result.code !== 0)
    throw new Error(result.msg || `飞书邮件请求失败：${response.status}`)

  return result.data?.message_id ?? ''
}

async function dispatchEmailChannel(
  env: WorkerEnv,
  userId: string,
  address: string,
  notificationId: string,
  input: CreateNotificationInput,
  chargedPoints = 0,
) {
  const config = await getEffectiveNotificationProviderConfig(env)
  const attempts: EmailDeliveryAttempt[] = []

  if (config.feishuMailEnabled) {
    if (!isFeishuMailConfigured(config)) {
      const message = '飞书邮件通知未配置完整'
      await recordDelivery(env, notificationId, 'email', 'skipped', message, 0, '', 'feishu_mail')
      attempts.push(emailDeliveryAttempt('feishu_mail', 'skipped', message))
    }
    else if (await countSentFeishuMailToday(env) >= config.feishuDailyLimit) {
      const message = `飞书邮件已达到每日 ${config.feishuDailyLimit} 封限额`
      await recordDelivery(env, notificationId, 'email', 'skipped', message, 0, '', 'feishu_mail')
      attempts.push(emailDeliveryAttempt('feishu_mail', 'skipped', message))
    }
    else {
      try {
        const providerId = await sendFeishuMail(env, config, address, input.title, input.body, notificationId, input.data)
        if (chargedPoints)
          await chargeEmailNotification(env, userId, notificationId)
        await recordDelivery(env, notificationId, 'email', 'sent', '', chargedPoints, providerId, 'feishu_mail')
        attempts.push(emailDeliveryAttempt('feishu_mail', 'sent', providerId ? `服务商消息 ID：${providerId}` : '服务商已受理'))
        return { sent: true, provider: 'feishu_mail' as const, attempts }
      }
      catch (error) {
        const message = errorMessage(error, '飞书邮件发送失败')
        await recordDelivery(env, notificationId, 'email', 'failed', message, 0, '', 'feishu_mail')
        attempts.push(emailDeliveryAttempt('feishu_mail', 'failed', message))
      }
    }
  }

  try {
    const providerId = await sendResendEmail(config, address, input.title, input.body, input.data)
    if (chargedPoints)
      await chargeEmailNotification(env, userId, notificationId)
    await recordDelivery(env, notificationId, 'email', 'sent', '', chargedPoints, providerId, 'resend')
    attempts.push(emailDeliveryAttempt('resend', 'sent', providerId ? `服务商消息 ID：${providerId}` : '服务商已受理'))
    return { sent: true, provider: 'resend' as const, attempts }
  }
  catch (error) {
    const message = errorMessage(error, '邮箱发送失败')
    await recordDelivery(env, notificationId, 'email', 'failed', message, 0, '', 'resend')
    attempts.push(emailDeliveryAttempt('resend', 'failed', message))
    return { sent: false, provider: undefined, attempts }
  }
}

async function sendFeishu(env: WorkerEnv, encryptedWebhook: string, title: string, body: string) {
  const webhook = normalizeExternalHttpsUrl(await decryptSecret(encryptedWebhook, encryptionSecret(env)), '飞书 Webhook 无效')
  const response = await fetchWithTimeout(webhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: notificationText(title, body),
      },
    }),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(text || `飞书 Webhook 请求失败：${response.status}`)
}

async function createVapidJwt(env: WorkerEnv, endpoint: string) {
  const config = await getEffectiveNotificationProviderConfig(env)
  if (!config.vapidPublicKey || !config.vapidPrivateKey)
    throw new Error('Web Push VAPID 未配置')

  const publicBytes = base64UrlDecode(config.vapidPublicKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4)
    throw new Error('VAPID_PUBLIC_KEY 格式无效')

  const privateD = base64UrlEncode(base64UrlDecode(config.vapidPrivateKey))
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33)),
      d: privateD,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const encoder = new TextEncoder()
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.vapidSubject,
  })))
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

async function sendPush(env: WorkerEnv, subscription: PushSubscriptionRow) {
  const endpoint = normalizePushEndpoint(subscription.endpoint)
  const config = await getEffectiveNotificationProviderConfig(env)
  const jwt = await createVapidJwt(env, endpoint)
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${config.vapidPublicKey}`,
      ttl: '120',
      urgency: 'normal',
    },
  })
  if (response.status === 404 || response.status === 410) {
    await disablePushSubscription(env, subscription.id)
    throw new Error(`Push 订阅已失效：${response.status}`)
  }
  if (!response.ok)
    throw new Error(`Web Push 请求失败：${response.status}`)
}

async function dispatchSpecificEmailProvider(
  env: WorkerEnv,
  userId: string,
  address: string,
  notificationId: string,
  input: CreateNotificationInput,
  provider: EmailDeliveryProvider,
  chargedPoints = 0,
) {
  const config = await getEffectiveNotificationProviderConfig(env)
  const attempts: EmailDeliveryAttempt[] = []
  try {
    const providerId = provider === 'feishu_mail'
      ? await sendFeishuMail(env, config, address, input.title, input.body, notificationId, input.data)
      : await sendResendEmail(config, address, input.title, input.body, input.data)
    if (chargedPoints)
      await chargeEmailNotification(env, userId, notificationId)
    await recordDelivery(env, notificationId, 'email', 'sent', '', chargedPoints, providerId, provider)
    attempts.push(emailDeliveryAttempt(provider, 'sent', providerId ? `服务商消息 ID：${providerId}` : '服务商已受理'))
    return { sent: true, provider, attempts }
  }
  catch (error) {
    const message = errorMessage(error, '邮箱发送失败')
    await recordDelivery(env, notificationId, 'email', 'failed', message, 0, '', provider)
    attempts.push(emailDeliveryAttempt(provider, 'failed', message))
    return { sent: false, provider: undefined, attempts }
  }
}

async function sendEmailTest(env: WorkerEnv, user: User, payload: SendEmailTestPayload): Promise<SendEmailTestResult> {
  const emailAddress = (payload.emailAddress?.trim() || user.profile.email).toLowerCase()
  assertEmail(emailAddress)

  const chargedPoints = payload.free ? 0 : EMAIL_NOTIFICATION_COST
  if (chargedPoints && !await hasEnoughPoints(env, user.id, EMAIL_NOTIFICATION_COST))
    throw new Error('邮箱通知余额不足')

  const notificationId = await insertNotification(env, {
    userId: user.id,
    event: 'email_test',
    title: 'Touch Great Welfare 邮箱测试',
    body: chargedPoints ? `这是一封测试邮件，发送成功会消耗 ${EMAIL_NOTIFICATION_COST} 积分。后续正式通知将按你的通知设置发送。` : '这是一封后台邮件通道测试邮件，不会扣除用户积分。',
    data: {
      kind: 'email_test',
      emailAddress,
      chargedPoints,
      provider: payload.provider ?? 'auto',
    },
  })
  await recordDelivery(env, notificationId, 'in_app', 'sent')

  const input: CreateNotificationInput = {
    userId: user.id,
    event: 'email_test',
    title: 'Touch Great Welfare 邮箱测试',
    body: chargedPoints ? `这是一封测试邮件，发送成功会消耗 ${EMAIL_NOTIFICATION_COST} 积分。后续正式通知将按你的通知设置发送。` : '这是一封后台邮件通道测试邮件，不会扣除用户积分。',
    data: {
      kind: 'email_test',
      emailAddress,
      chargedPoints,
      provider: payload.provider ?? 'auto',
    },
  }
  const startedAt = performance.now()
  const delivery = payload.provider && payload.provider !== 'auto'
    ? await dispatchSpecificEmailProvider(env, user.id, emailAddress, notificationId, input, payload.provider, chargedPoints)
    : await dispatchEmailChannel(env, user.id, emailAddress, notificationId, input, chargedPoints)

  if (!delivery.sent || !delivery.provider) {
    await writeSystemLog(env, {
      level: 'error',
      module: 'notifications',
      action: 'email_test',
      message: '邮箱测试发送失败',
      refId: notificationId,
      durationMs: elapsedMs(startedAt),
      details: {
        emailAddress,
        provider: payload.provider ?? 'auto',
        chargedPoints,
        attempts: delivery.attempts,
      },
    })
    throw new Error(emailTestFailureMessage(delivery.attempts))
  }

  await writeSystemLog(env, {
    level: 'success',
    module: 'notifications',
    action: 'email_test',
    message: '邮箱测试发送成功',
    refId: notificationId,
    durationMs: elapsedMs(startedAt),
    details: {
      emailAddress,
      provider: delivery.provider,
      chargedPoints,
      attempts: delivery.attempts,
    },
  })

  return {
    ok: true,
    notificationId,
    emailAddress,
    chargedPoints,
    deliveryProvider: delivery.provider,
    deliveryProviderLabel: EMAIL_DELIVERY_PROVIDER_LABELS[delivery.provider],
    deliveryAttempts: delivery.attempts,
  }
}

async function dispatchOptionalChannels(env: WorkerEnv, user: User, settings: NotificationSettingsRow | null, notificationId: string, input: CreateNotificationInput) {
  if (boolValue(settings?.email_enabled)) {
    const address = settings?.email_address || user.profile.email
    if (!await hasEnoughPoints(env, user.id, EMAIL_NOTIFICATION_COST)) {
      await recordDelivery(env, notificationId, 'email', 'skipped', '邮箱通知余额不足')
    }
    else {
      await dispatchEmailChannel(env, user.id, address, notificationId, input, EMAIL_NOTIFICATION_COST)
    }
  }

  if (boolValue(settings?.feishu_enabled)) {
    if (!settings?.feishu_webhook_encrypted) {
      await recordDelivery(env, notificationId, 'feishu', 'skipped', '飞书 Webhook 未配置', 0, '', 'feishu_webhook')
    }
    else {
      try {
        await sendFeishu(env, settings.feishu_webhook_encrypted, input.title, input.body)
        await recordDelivery(env, notificationId, 'feishu', 'sent', '', 0, '', 'feishu_webhook')
      }
      catch (error) {
        await recordDelivery(env, notificationId, 'feishu', 'failed', error instanceof Error ? error.message : '飞书通知发送失败', 0, '', 'feishu_webhook')
      }
    }
  }

  if (boolValue(settings?.browser_push_enabled)) {
    const subscriptions = await getPushSubscriptions(env, user.id)
    if (!subscriptions.length) {
      await recordDelivery(env, notificationId, 'browser_push', 'skipped', '未注册浏览器 Push 订阅', 0, '', 'web_push')
      return
    }

    let sent = 0
    const errors: string[] = []
    for (const subscription of subscriptions) {
      try {
        await sendPush(env, subscription)
        sent += 1
      }
      catch (error) {
        errors.push(error instanceof Error ? error.message : 'Push 发送失败')
      }
    }
    await recordDelivery(env, notificationId, 'browser_push', sent > 0 ? 'sent' : 'failed', errors.join('\n'), 0, '', 'web_push')
  }
}

async function dispatchAdminAnnouncementChannels(
  env: WorkerEnv,
  user: User,
  settings: NotificationSettingsRow | null,
  notificationId: string,
  input: CreateNotificationInput,
  channels: NotificationChannel[],
  forcePush: boolean,
) {
  const results: Array<{ channel: NotificationChannel, status: DeliveryStatus, message: string, durationMs: number }> = []
  const recordResult = (channel: NotificationChannel, status: DeliveryStatus, message: string, startedAt: number) => {
    results.push({ channel, status, message, durationMs: elapsedMs(startedAt) })
  }

  if (channels.includes('email')) {
    const startedAt = performance.now()
    const address = settings?.email_address || user.profile.email
    const result = await dispatchEmailChannel(env, user.id, address, notificationId, input)
    const failed = result.attempts.filter(item => item.status === 'failed')
    recordResult('email', result.sent ? 'sent' : failed.length ? 'failed' : 'skipped', result.attempts.map(formatEmailDeliveryAttempt).join('；'), startedAt)
  }

  if (channels.includes('feishu')) {
    const startedAt = performance.now()
    if (!settings?.feishu_webhook_encrypted) {
      const message = '飞书 Webhook 未配置'
      await recordDelivery(env, notificationId, 'feishu', 'skipped', message, 0, '', 'feishu_webhook')
      recordResult('feishu', 'skipped', message, startedAt)
    }
    else {
      try {
        await sendFeishu(env, settings.feishu_webhook_encrypted, input.title, input.body)
        await recordDelivery(env, notificationId, 'feishu', 'sent', '', 0, '', 'feishu_webhook')
        recordResult('feishu', 'sent', '飞书 Webhook 已受理', startedAt)
      }
      catch (error) {
        const message = errorMessage(error, '飞书通知发送失败')
        await recordDelivery(env, notificationId, 'feishu', 'failed', message, 0, '', 'feishu_webhook')
        recordResult('feishu', 'failed', message, startedAt)
      }
    }
  }

  if (channels.includes('browser_push')) {
    const startedAt = performance.now()
    const canPush = forcePush || boolValue(settings?.browser_push_enabled)
    if (!canPush) {
      const message = '用户未启用浏览器 Push'
      await recordDelivery(env, notificationId, 'browser_push', 'skipped', message, 0, '', 'web_push')
      recordResult('browser_push', 'skipped', message, startedAt)
      return results
    }

    const subscriptions = await getPushSubscriptions(env, user.id)
    if (!subscriptions.length) {
      const message = '未注册浏览器 Push 订阅'
      await recordDelivery(env, notificationId, 'browser_push', 'skipped', message, 0, '', 'web_push')
      recordResult('browser_push', 'skipped', message, startedAt)
      return results
    }

    let sent = 0
    const errors: string[] = []
    for (const subscription of subscriptions) {
      try {
        await sendPush(env, subscription)
        sent += 1
      }
      catch (error) {
        errors.push(errorMessage(error, 'Push 发送失败'))
      }
    }
    const status = sent > 0 ? 'sent' : 'failed'
    const message = errors.join('\n') || `已发送 ${sent}/${subscriptions.length} 个订阅`
    await recordDelivery(env, notificationId, 'browser_push', status, errors.join('\n'), 0, '', 'web_push')
    recordResult('browser_push', status, message, startedAt)
  }

  return results
}

async function listAdminAnnouncements(env: WorkerEnv): Promise<AdminAnnouncementListResult> {
  await ensureNotificationSchema(env)
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const userMap = new Map(state.users.map(user => [user.id, user]))
  let rows: NotificationRow[] = []

  if (shouldUseD1(env)) {
    rows = (await env.LOCAL_DB!
      .prepare(`
        select * from notifications
        where event = ?1
        order by created_at desc
        limit ?2
      `)
      .bind('admin_announcement', ADMIN_ANNOUNCEMENT_LIMIT)
      .all<NotificationRow>()).results
  }
  else {
    const result = await getPool(env).query<NotificationRow>(`
      select * from notifications
      where event = $1
      order by created_at desc
      limit $2
    `, ['admin_announcement', ADMIN_ANNOUNCEMENT_LIMIT])
    rows = result.rows
  }

  const groups = new Map<string, AdminAnnouncementSummary>()
  for (const row of rows) {
    const data = safeNotificationData(row)
    const announcementId = typeof data.announcementId === 'string' ? data.announcementId : ''
    if (!announcementId)
      continue

    const user = userMap.get(row.user_id)
    const channels = Array.isArray(data.channels)
      ? normalizeNotificationChannels(data.channels as NotificationChannel[], data.forcePush === true)
      : ['in_app'] as NotificationChannel[]
    const readAt = toIso(row.read_at)
    const existing = groups.get(announcementId)
    const summary = existing ?? {
      id: announcementId,
      title: row.title,
      body: row.body,
      channels,
      forcePopup: data.forcePopup === true,
      forcePush: data.forcePush === true,
      createdAt: toIso(row.created_at) ?? now(),
      createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
      totalCount: 0,
      readCount: 0,
      unreadCount: 0,
      recipients: [],
    }

    summary.totalCount += 1
    summary.readCount += readAt ? 1 : 0
    summary.unreadCount += readAt ? 0 : 1
    summary.recipients.push({
      userId: row.user_id,
      displayName: user?.profile.displayName || row.user_id,
      email: user?.profile.email || '',
      readAt,
      notificationId: row.id,
    })
    groups.set(announcementId, summary)
  }

  return {
    announcements: [...groups.values()]
      .map(item => ({
        ...item,
        recipients: item.recipients.sort((left, right) => {
          if (!!left.readAt !== !!right.readAt)
            return left.readAt ? 1 : -1
          return left.displayName.localeCompare(right.displayName, 'zh-CN')
        }),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  }
}

async function createAdminAnnouncement(env: WorkerEnv, admin: User, payload: CreateAdminAnnouncementPayload) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const title = payload.title?.trim() ?? ''
  const body = payload.body?.trim() ?? ''
  if (!title)
    throw new Error('请填写通告标题')
  if (!body)
    throw new Error('请填写通告内容')

  const forcePush = !!payload.forcePush
  const channels = normalizeNotificationChannels(payload.channels, forcePush)
  const targetIds = new Set((payload.targetUserIds ?? []).map(id => id.trim()).filter(Boolean))
  const recipients = state.users.filter(user => !targetIds.size || targetIds.has(user.id))
  if (!recipients.length)
    throw new Error('没有可推送的用户')

  const announcementId = createId('ann')
  const startedAt = performance.now()
  await writeSystemLog(env, {
    level: 'info',
    module: 'notifications',
    action: 'admin_announcement.start',
    message: `开始发送管理员通告：${title}`,
    refId: announcementId,
    details: { channels, forcePopup: !!payload.forcePopup, forcePush, recipientCount: recipients.length, adminId: admin.id },
  })

  try {
    for (const recipient of recipients) {
      const recipientStartedAt = performance.now()
      const notificationId = await insertNotification(env, {
        userId: recipient.id,
        event: 'admin_announcement',
        title,
        body,
        data: {
          announcementId,
          channels,
          forcePopup: !!payload.forcePopup,
          forcePush,
          createdBy: admin.id,
        },
      })
      await recordDelivery(env, notificationId, 'in_app', 'sent')
      const channelResults = await dispatchAdminAnnouncementChannels(
        env,
        recipient,
        await getSettingsRow(env, recipient.id),
        notificationId,
        {
          userId: recipient.id,
          event: 'admin_announcement',
          title,
          body,
        },
        channels,
        forcePush,
      )
      const hasFailure = channelResults.some(item => item.status === 'failed')
      const hasSkipped = channelResults.some(item => item.status === 'skipped')
      await writeSystemLog(env, {
        level: hasFailure ? 'error' : hasSkipped ? 'warning' : 'success',
        module: 'notifications',
        action: 'admin_announcement.recipient',
        message: `${recipient.profile.displayName || recipient.profile.email || recipient.id} 通告发送${hasFailure ? '存在失败' : hasSkipped ? '存在跳过' : '完成'}`,
        refId: announcementId,
        durationMs: elapsedMs(recipientStartedAt),
        details: { notificationId, userId: recipient.id, email: recipient.profile.email, channelResults },
      })
    }

    await writeSystemLog(env, {
      level: 'success',
      module: 'notifications',
      action: 'admin_announcement.finish',
      message: `管理员通告发送完成：${title}`,
      refId: announcementId,
      durationMs: elapsedMs(startedAt),
      details: { recipientCount: recipients.length, channels },
    })
    return listAdminAnnouncements(env)
  }
  catch (error) {
    await writeSystemLog(env, {
      level: 'error',
      module: 'notifications',
      action: 'admin_announcement.error',
      message: errorMessage(error, '管理员通告发送失败'),
      refId: announcementId,
      durationMs: elapsedMs(startedAt),
      details: { recipientCount: recipients.length, channels },
    })
    throw error
  }
}

export function isNotificationQueueJob(value: unknown): value is NotificationQueueJob {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === 'notification.dispatch'
    && !!(value as Record<string, unknown>).input
}

async function enqueueNotification(env: WorkerEnv, input: CreateNotificationInput, fallbackUser?: User) {
  if (env.ASYNC_JOBS) {
    await env.ASYNC_JOBS.send({ type: 'notification.dispatch', input } satisfies NotificationQueueJob)
    return undefined
  }

  if (fallbackUser)
    return createAndDispatchNotificationForUser(env, fallbackUser, input)

  return createAndDispatchNotification(env, input)
}

async function createAndDispatchNotificationForUser(env: WorkerEnv, user: User, input: CreateNotificationInput) {
  const notificationId = await insertNotification(env, input)
  await recordDelivery(env, notificationId, 'in_app', 'sent')
  try {
    const settings = await getSettingsRow(env, user.id)
    await dispatchOptionalChannels(env, user, settings, notificationId, input)
  }
  catch (error) {
    await writeSystemLog(env, {
      level: 'error',
      module: 'notifications',
      action: 'dispatch.optional_channels_failed',
      message: errorMessage(error, '外部通知渠道发送失败'),
      refId: notificationId,
      details: { userId: user.id, event: input.event },
    }).catch(() => {})
  }
  return notificationId
}

export async function createAndDispatchNotification(env: WorkerEnv, input: CreateNotificationInput) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const user = state.users.find(item => item.id === input.userId)
  if (!user)
    throw new Error('通知用户不存在')

  return createAndDispatchNotificationForUser(env, user, input)
}

function applicationNotification(application: WelfareApplication, event: NotificationEvent) {
  const isRejected = event === 'application_rejected'
  const typeName = application.type.toUpperCase()
  const message = latestApplicationMessage(application, 'result_submission')
  return {
    title: isRejected ? `${typeName} 申请已退回` : `${typeName} 申请已答复`,
    body: application.answer || (isRejected ? `你的 ${typeName} 申请已退回，已按退回规则处理积分。` : `你的 ${typeName} 申请已通过并完成答复。`),
    data: {
      applicationId: application.id,
      type: application.type,
      attachments: attachmentData(message?.attachments),
    },
  }
}

function latestApplicationMessage(application: WelfareApplication, type?: string) {
  return [...(application.messages ?? [])]
    .filter(message => !type || message.type === type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

function supplementRequestNotification(application: WelfareApplication) {
  const typeName = application.type.toUpperCase()
  const message = latestApplicationMessage(application, 'system')
  return {
    title: `${typeName} 申请需要补充材料`,
    body: message?.content || `你的 ${typeName} 申请需要补充材料，请进入申请详情查看要求。`,
    data: {
      applicationId: application.id,
      type: application.type,
    },
  }
}

function supplementSubmittedNotification(application: WelfareApplication, user?: User) {
  const typeName = application.type.toUpperCase()
  const message = latestApplicationMessage(application, 'supplement')
  const displayName = user?.profile.displayName || user?.profile.email || application.userId
  return {
    title: `${typeName} 申请已补充材料`,
    body: message?.content || `${displayName} 已补充 ${typeName} 申请材料，请继续审核。`,
    data: {
      applicationId: application.id,
      type: application.type,
      userId: application.userId,
      attachments: attachmentData(message?.attachments),
    },
  }
}

function verificationDisplayName(verification: StudentVerification, users: User[]) {
  const user = users.find(item => item.id === verification.userId)
  return user?.profile.displayName || user?.profile.email || verification.realName || verification.userId
}

function verificationNotificationTitle(verification: StudentVerification, suffix: string) {
  const typeName = verification.verificationType === 'frontline' ? '一线认证' : '学生认证'
  return `${typeName}${suffix}`
}

function verificationSubmittedNotification(verification: StudentVerification, users: User[]) {
  const displayName = verificationDisplayName(verification, users)
  return {
    title: verificationNotificationTitle(verification, '已提交'),
    body: `${displayName} 已提交 ${verification.category} 认证材料，请进入审核队列处理。`,
    data: {
      verificationId: verification.id,
      verificationType: verification.verificationType ?? 'student',
      userId: verification.userId,
      attachments: attachmentData(verification.attachments),
    },
  }
}

function verificationSubmittedUserNotification(verification: StudentVerification) {
  return {
    title: verificationNotificationTitle(verification, '已提交'),
    body: `你的 ${verification.category} 认证材料已提交，等待管理员审核。`,
    data: {
      verificationId: verification.id,
      verificationType: verification.verificationType ?? 'student',
    },
  }
}

function verificationSupplementSubmittedNotification(verification: StudentVerification, users: User[]) {
  const displayName = verificationDisplayName(verification, users)
  return {
    title: verificationNotificationTitle(verification, '已补充材料'),
    body: `${displayName} 已补充 ${verification.category} 认证材料，请继续审核。`,
    data: {
      verificationId: verification.id,
      verificationType: verification.verificationType ?? 'student',
      userId: verification.userId,
      attachments: attachmentData(verification.attachments),
    },
  }
}

function verificationSupplementSubmittedUserNotification(verification: StudentVerification) {
  return {
    title: verificationNotificationTitle(verification, '已补充材料'),
    body: `你的 ${verification.category} 认证补充材料已提交，等待管理员继续审核。`,
    data: {
      verificationId: verification.id,
      verificationType: verification.verificationType ?? 'student',
    },
  }
}

function verificationReviewNotification(verification: StudentVerification, suffix: string, fallback: string) {
  return {
    title: verificationNotificationTitle(verification, suffix),
    body: verification.reply || fallback,
    data: {
      verificationId: verification.id,
      verificationType: verification.verificationType ?? 'student',
    },
  }
}

export async function dispatchWelfareStateChangeNotifications(env: WorkerEnv, previous: Partial<WelfareState>, next: Partial<WelfareState>) {
  const users = Array.isArray(next.users) ? next.users : []
  const usersById = new Map(users.map(user => [user.id, user]))
  const admins = users.filter(user => user.role === 'admin')

  async function notify(input: CreateNotificationInput) {
    const user = usersById.get(input.userId)
    if (!user)
      throw new Error('通知用户不存在')
    return enqueueNotification(env, input, user)
  }
  const previousApplications = new Map((Array.isArray(previous.applications) ? previous.applications : []).map(item => [item.id, item]))
  const nextApplications = Array.isArray(next.applications) ? next.applications : []
  for (const application of nextApplications) {
    const before = previousApplications.get(application.id)
    if (!before || before.status === application.status)
      continue

    if (['pending_review', 'processing'].includes(before.status) && ['answered', 'completed', 'closed'].includes(application.status)) {
      const message = applicationNotification(application, 'application_answered')
      await notify({
        userId: application.userId,
        event: 'application_answered',
        ...message,
      })
    }

    if (['pending_review', 'processing'].includes(before.status) && application.status === 'rejected') {
      const message = applicationNotification(application, 'application_rejected')
      await notify({
        userId: application.userId,
        event: 'application_rejected',
        ...message,
      })
    }

    if (['pending_review', 'processing'].includes(before.status) && application.status === 'needs_supplement') {
      const message = supplementRequestNotification(application)
      await notify({
        userId: application.userId,
        event: 'application_needs_supplement',
        ...message,
      })
    }

    if (before.status === 'needs_supplement' && application.status === 'pending_review') {
      const applicant = users.find(user => user.id === application.userId)
      const message = supplementSubmittedNotification(application, applicant)
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          event: 'application_supplement_submitted',
          ...message,
        })
      }
    }
  }

  const previousVerifications = new Map((Array.isArray(previous.studentVerifications) ? previous.studentVerifications : []).map(item => [item.id, item]))
  const nextVerifications = Array.isArray(next.studentVerifications) ? next.studentVerifications : []
  for (const verification of nextVerifications) {
    const before = previousVerifications.get(verification.id)
    if (!before) {
      if (verification.status === 'pending') {
        await notify({
          userId: verification.userId,
          event: 'student_submitted',
          ...verificationSubmittedUserNotification(verification),
        })
        const message = verificationSubmittedNotification(verification, users)
        for (const admin of admins) {
          await notify({
            userId: admin.id,
            event: 'student_submitted',
            ...message,
          })
        }
      }
      continue
    }
    if (before.status === verification.status)
      continue

    if (before.status === 'needs_supplement' && verification.status === 'pending') {
      await notify({
        userId: verification.userId,
        event: 'student_supplement_submitted',
        ...verificationSupplementSubmittedUserNotification(verification),
      })
      const message = verificationSupplementSubmittedNotification(verification, users)
      for (const admin of admins) {
        await notify({
          userId: admin.id,
          event: 'student_supplement_submitted',
          ...message,
        })
      }
    }

    if (before.status === 'pending' && verification.status === 'needs_supplement') {
      await notify({
        userId: verification.userId,
        event: 'student_needs_supplement',
        ...verificationReviewNotification(verification, '需要补充材料', '你的认证材料需要补充，请进入认证详情查看要求。'),
      })
    }

    if (before.status === 'pending' && verification.status === 'approved') {
      await notify({
        userId: verification.userId,
        event: 'student_approved',
        ...verificationReviewNotification(verification, '已通过', '你的认证已通过，审核积分已返还。'),
      })
    }

    if (before.status === 'pending' && verification.status === 'rejected') {
      await notify({
        userId: verification.userId,
        event: 'student_rejected',
        ...verificationReviewNotification(verification, '已退回', '你的认证材料未通过审核，审核费不返还。'),
      })
    }

    if (before.status === 'approved' && verification.status === 'revoked') {
      await notify({
        userId: verification.userId,
        event: 'student_revoked',
        ...verificationReviewNotification(verification, '已撤销', '你的认证已被撤销，请进入认证详情查看原因。'),
      })
    }
  }
}

export async function handleNotificationJob(job: NotificationQueueJob, env: WorkerEnv) {
  await createAndDispatchNotification(env, job.input)
}

export async function handleNotificationRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/notifications'.length) || '/'

    if (path === '/push/public-key' && request.method === 'GET') {
      const config = await getEffectiveNotificationProviderConfig(env)
      return json({
        publicKey: config.vapidPublicKey,
        configured: !!(config.vapidPublicKey && config.vapidPrivateKey),
      })
    }

    if (path === '/provider-config' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      return json(serializeNotificationProviderConfig(await getEffectiveNotificationProviderConfig(env)))
    }

    if (path === '/provider-config' && request.method === 'PUT') {
      await assertAdminRequest(request, env)
      const payload = await readJson<NotificationProviderConfigPayload>(request)
      return json(serializeNotificationProviderConfig(await saveNotificationProviderConfig(env, payload)))
    }

    if (path === '/provider-config/vapid/generate' && request.method === 'POST') {
      await assertAdminRequest(request, env)
      const payload = await readJson<GenerateVapidKeysPayload>(request)
      return json(await generateVapidKeys(env, payload))
    }

    if (path === '/admin-announcements' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      return json(await listAdminAnnouncements(env))
    }

    if (path === '/system-logs' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      const limit = Number(url.searchParams.get('limit') || 100)
      return json(await listSystemLogs(env, limit))
    }

    if (path === '/provider-config/email-test' && request.method === 'POST') {
      const { user } = await assertAdminRequest(request, env)
      const payload = await readJson<SendEmailTestPayload>(request)
      return json(await sendEmailTest(env, user, { ...payload, free: true, provider: payload.provider ?? 'feishu_mail' }))
    }

    if (path === '/admin-announcements' && request.method === 'POST') {
      const { user } = await assertAdminRequest(request, env)
      const payload = await readJson<CreateAdminAnnouncementPayload>(request)
      return json(await createAdminAnnouncement(env, user, payload))
    }

    const { user } = await getAuthenticatedRequest(request, env)

    if (path === '/' && request.method === 'GET')
      return json(await listNotifications(env, user.id))

    if (path === '/settings' && request.method === 'GET')
      return json(await toSettingsView(env, user, await getSettingsRow(env, user.id)))

    if (path === '/settings' && request.method === 'PUT') {
      const payload = await readJson<SaveNotificationSettingsPayload>(request)
      return json(await saveSettings(env, user, payload))
    }

    if (path === '/email-test' && request.method === 'POST') {
      const payload = await readJson<SendEmailTestPayload>(request)
      return json(await sendEmailTest(env, user, payload))
    }

    if (path === '/push-subscriptions' && request.method === 'POST') {
      const payload = await readJson<PushSubscriptionPayload>(request)
      await savePushSubscription(env, user.id, payload, request.headers.get('user-agent') ?? '')
      return json(await toSettingsView(env, user, await getSettingsRow(env, user.id)))
    }

    if (path.startsWith('/push-subscriptions/') && request.method === 'DELETE') {
      await deletePushSubscription(env, user.id, path.slice('/push-subscriptions/'.length))
      return json(await toSettingsView(env, user, await getSettingsRow(env, user.id)))
    }

    if (path === '/read-all' && request.method === 'PATCH') {
      await markAllNotificationsRead(env, user.id)
      return json({ ok: true })
    }

    if (path.endsWith('/read') && request.method === 'PATCH') {
      const id = path.slice(1, -'/read'.length)
      await markNotificationRead(env, user.id, id)
      return json({ ok: true })
    }

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}

export async function recordIntegrationEvent(
  env: WorkerEnv,
  provider: string,
  eventId: string,
  eventType: string,
  signatureValid: boolean,
  payload: unknown,
  status: NotificationStatus,
  error = '',
) {
  await ensureNotificationSchema(env)
  const id = createId('evt')
  const body = JSON.stringify(payload)
  const processedAt = status === 'processed'

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into integration_events (id, provider, event_id, event_type, signature_valid, payload, status, error, created_at, processed_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, current_timestamp, ${processedAt ? 'current_timestamp' : 'null'})
      `)
      .bind(id, provider, eventId || null, eventType || null, signatureValid ? 1 : 0, body, status, error || null)
      .run()
    return id
  }

  await getPool(env).query(`
    insert into integration_events (id, provider, event_id, event_type, signature_valid, payload, status, error, created_at, processed_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, now(), ${processedAt ? 'now()' : 'null'})
  `, [id, provider, eventId || null, eventType || null, signatureValid, body, status, error || null])
  return id
}
