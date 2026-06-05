import type { WorkerEnv } from './welfare-state'
import type { CreditTransaction, User, WelfareApplication, WelfareState } from '~/composables/welfare'
import type {
  DeliveryStatus,
  NotificationChannel,
  NotificationEvent,
  NotificationItem,
  NotificationSettingsView,
  PushSubscriptionPayload,
  SaveNotificationSettingsPayload,
} from '~/shared/notifications'
import { EMAIL_NOTIFICATION_COST } from '~/shared/notifications'
import {
  assertAdminRequest,
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
import { getPool, readWelfareState, shouldUseD1, writeWelfareState } from './welfare-state'

type NotificationStatus = 'processed' | 'failed'

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
}

interface NotificationProviderConfigPayload {
  resendApiKey?: string
  resendFromEmail?: string
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject?: string
  clearResendApiKey?: boolean
  clearVapidPrivateKey?: boolean
}

export interface CreateNotificationInput {
  userId: string
  event: NotificationEvent
  title: string
  body: string
  data?: Record<string, unknown>
}

const NOTIFICATION_LIMIT = 80
const NOTIFICATION_PROVIDER_CONFIG_ID = 'default'
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@welfare.dev'

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

function assertEmail(value: string) {
  if (!/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(value))
    throw new Error('请填写有效邮箱')
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

function notificationHtml(title: string, body: string) {
  return `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p><p style="color:#64748b">Touch Great Welfare</p>`
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
    ]

    for (const statement of statements)
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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
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
) {
  await ensureNotificationSchema(env)
  const id = createId('dlv')

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notification_deliveries (id, notification_id, channel, status, error, charged_points, provider_message_id, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, current_timestamp, current_timestamp)
      `)
      .bind(id, notificationId, channel, status, error || null, chargedPoints, providerMessageId || null)
      .run()
    return
  }

  await getPool(env).query(`
    insert into notification_deliveries (id, notification_id, channel, status, error, charged_points, provider_message_id, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $6, $7, now(), now())
  `, [id, notificationId, channel, status, error || null, chargedPoints, providerMessageId || null])
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
    const url = payload.feishuWebhookUrl.trim()
    if (!url.startsWith('https://'))
      throw new Error('飞书 Webhook 必须使用 HTTPS')
    feishuWebhookEncrypted = await encryptSecret(url, encryptionSecret(env))
  }
  if (payload.feishuEnabled && !feishuWebhookEncrypted)
    throw new Error('启用飞书通知前请先填写 Webhook')

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

  const id = createId('psh')
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, enabled, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, 1, current_timestamp)
        on conflict (endpoint)
        do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = 1, disabled_at = null, updated_at = current_timestamp
      `)
      .bind(id, userId, payload.endpoint, payload.keys.p256dh, payload.keys.auth, userAgent)
      .run()
    await setBrowserPushEnabled(env, userId, true)
    return
  }

  await getPool(env).query(`
    insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, enabled, updated_at)
    values ($1, $2, $3, $4, $5, $6, true, now())
    on conflict (endpoint)
    do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, enabled = true, disabled_at = null, updated_at = now()
  `, [id, userId, payload.endpoint, payload.keys.p256dh, payload.keys.auth, userAgent])
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
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('通知用户不存在')
  if (user.points < EMAIL_NOTIFICATION_COST)
    throw new Error('邮箱通知余额不足')

  user.points -= EMAIL_NOTIFICATION_COST
  const tx: CreditTransaction = {
    id: createId('tx'),
    userId,
    delta: -EMAIL_NOTIFICATION_COST,
    type: 'spend',
    reason: '邮箱通知发送扣费',
    refId: notificationId,
    createdAt: now(),
  }
  state.transactions.unshift(tx)
  await writeWelfareState(env, state)
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

async function getEffectiveNotificationProviderConfig(env: WorkerEnv) {
  const stored = await getNotificationProviderConfig(env)
  const resendApiKey = await decryptProviderSecret(stored?.resend_api_key_encrypted, env)
  const vapidPrivateKey = await decryptProviderSecret(stored?.vapid_private_key_encrypted, env)
  return {
    resendApiKey,
    resendFromEmail: stored?.resend_from_email || '',
    vapidPublicKey: stored?.vapid_public_key || '',
    vapidPrivateKey,
    vapidSubject: stored?.vapid_subject || DEFAULT_VAPID_SUBJECT,
    source: stored ? 'admin' as const : 'empty' as const,
  }
}

function serializeNotificationProviderConfig(config: Awaited<ReturnType<typeof getEffectiveNotificationProviderConfig>>) {
  return {
    configured: {
      email: !!(config.resendApiKey && config.resendFromEmail),
      push: !!(config.vapidPublicKey && config.vapidPrivateKey),
    },
    resendApiKeyMasked: maskSecret(config.resendApiKey),
    resendFromEmail: config.resendFromEmail,
    vapidPublicKey: config.vapidPublicKey,
    vapidPrivateKeyMasked: maskSecret(config.vapidPrivateKey),
    vapidSubject: config.vapidSubject,
    source: config.source,
  }
}

async function saveNotificationProviderConfig(env: WorkerEnv, payload: NotificationProviderConfigPayload) {
  await ensureNotificationSchema(env)
  const stored = await getNotificationProviderConfig(env)
  let resendApiKeyEncrypted = stored?.resend_api_key_encrypted || null
  let vapidPrivateKeyEncrypted = stored?.vapid_private_key_encrypted || null
  if (payload.clearResendApiKey)
    resendApiKeyEncrypted = null
  if (payload.clearVapidPrivateKey)
    vapidPrivateKeyEncrypted = null
  if (payload.resendApiKey?.trim())
    resendApiKeyEncrypted = await encryptSecret(payload.resendApiKey.trim(), encryptionSecret(env))
  if (payload.vapidPrivateKey?.trim())
    vapidPrivateKeyEncrypted = await encryptSecret(payload.vapidPrivateKey.trim(), encryptionSecret(env))

  const config = {
    resendApiKeyEncrypted,
    resendFromEmail: payload.resendFromEmail?.trim() || '',
    vapidPublicKey: payload.vapidPublicKey?.trim() || '',
    vapidPrivateKeyEncrypted,
    vapidSubject: payload.vapidSubject?.trim() || DEFAULT_VAPID_SUBJECT,
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into notification_provider_config (
          id, resend_api_key_encrypted, resend_from_email, vapid_public_key, vapid_private_key_encrypted, vapid_subject, updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
        on conflict (id)
        do update set
          resend_api_key_encrypted = excluded.resend_api_key_encrypted,
          resend_from_email = excluded.resend_from_email,
          vapid_public_key = excluded.vapid_public_key,
          vapid_private_key_encrypted = excluded.vapid_private_key_encrypted,
          vapid_subject = excluded.vapid_subject,
          updated_at = current_timestamp
      `)
      .bind(
        NOTIFICATION_PROVIDER_CONFIG_ID,
        config.resendApiKeyEncrypted,
        config.resendFromEmail,
        config.vapidPublicKey,
        config.vapidPrivateKeyEncrypted,
        config.vapidSubject,
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into notification_provider_config (
        id, resend_api_key_encrypted, resend_from_email, vapid_public_key, vapid_private_key_encrypted, vapid_subject, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now())
      on conflict (id)
      do update set
        resend_api_key_encrypted = excluded.resend_api_key_encrypted,
        resend_from_email = excluded.resend_from_email,
        vapid_public_key = excluded.vapid_public_key,
        vapid_private_key_encrypted = excluded.vapid_private_key_encrypted,
        vapid_subject = excluded.vapid_subject,
        updated_at = now()
    `, [
      NOTIFICATION_PROVIDER_CONFIG_ID,
      config.resendApiKeyEncrypted,
      config.resendFromEmail,
      config.vapidPublicKey,
      config.vapidPrivateKeyEncrypted,
      config.vapidSubject,
    ])
  }

  return getEffectiveNotificationProviderConfig(env)
}

async function sendEmail(env: WorkerEnv, to: string, title: string, body: string) {
  const config = await getEffectiveNotificationProviderConfig(env)
  if (!config.resendApiKey || !config.resendFromEmail)
    throw new Error('Resend 邮箱通知未配置')

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
      text: notificationText(title, body),
      html: notificationHtml(title, body),
    }),
  })
  const result = await response.json().catch(() => ({})) as { id?: string, message?: string }
  if (!response.ok)
    throw new Error(result.message || `Resend 请求失败：${response.status}`)

  return result.id ?? ''
}

async function sendFeishu(env: WorkerEnv, encryptedWebhook: string, title: string, body: string) {
  const webhook = await decryptSecret(encryptedWebhook, encryptionSecret(env))
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
  const config = await getEffectiveNotificationProviderConfig(env)
  const jwt = await createVapidJwt(env, subscription.endpoint)
  const response = await fetchWithTimeout(subscription.endpoint, {
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

async function dispatchOptionalChannels(env: WorkerEnv, user: User, settings: NotificationSettingsRow | null, notificationId: string, input: CreateNotificationInput) {
  if (boolValue(settings?.email_enabled)) {
    const address = settings?.email_address || user.profile.email
    if (!await hasEnoughPoints(env, user.id, EMAIL_NOTIFICATION_COST)) {
      await recordDelivery(env, notificationId, 'email', 'skipped', '邮箱通知余额不足')
    }
    else {
      try {
        const providerId = await sendEmail(env, address, input.title, input.body)
        await chargeEmailNotification(env, user.id, notificationId)
        await recordDelivery(env, notificationId, 'email', 'sent', '', EMAIL_NOTIFICATION_COST, providerId)
      }
      catch (error) {
        await recordDelivery(env, notificationId, 'email', 'failed', error instanceof Error ? error.message : '邮箱发送失败')
      }
    }
  }

  if (boolValue(settings?.feishu_enabled)) {
    if (!settings?.feishu_webhook_encrypted) {
      await recordDelivery(env, notificationId, 'feishu', 'skipped', '飞书 Webhook 未配置')
    }
    else {
      try {
        await sendFeishu(env, settings.feishu_webhook_encrypted, input.title, input.body)
        await recordDelivery(env, notificationId, 'feishu', 'sent')
      }
      catch (error) {
        await recordDelivery(env, notificationId, 'feishu', 'failed', error instanceof Error ? error.message : '飞书通知发送失败')
      }
    }
  }

  if (boolValue(settings?.browser_push_enabled)) {
    const subscriptions = await getPushSubscriptions(env, user.id)
    if (!subscriptions.length) {
      await recordDelivery(env, notificationId, 'browser_push', 'skipped', '未注册浏览器 Push 订阅')
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
    await recordDelivery(env, notificationId, 'browser_push', sent > 0 ? 'sent' : 'failed', errors.join('\n'))
  }
}

export async function createAndDispatchNotification(env: WorkerEnv, input: CreateNotificationInput) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const user = state.users.find(item => item.id === input.userId)
  if (!user)
    throw new Error('通知用户不存在')

  const notificationId = await insertNotification(env, input)
  await recordDelivery(env, notificationId, 'in_app', 'sent')
  const settings = await getSettingsRow(env, user.id)
  await dispatchOptionalChannels(env, user, settings, notificationId, input)
  return notificationId
}

function applicationNotification(application: WelfareApplication, event: NotificationEvent) {
  const isRejected = event === 'application_rejected'
  const typeName = application.type.toUpperCase()
  return {
    title: isRejected ? `${typeName} 申请已退回` : `${typeName} 申请已答复`,
    body: application.answer || (isRejected ? `你的 ${typeName} 申请已退回，已按退回规则处理积分。` : `你的 ${typeName} 申请已通过并完成答复。`),
    data: {
      applicationId: application.id,
      type: application.type,
    },
  }
}

export async function dispatchWelfareStateChangeNotifications(env: WorkerEnv, previous: Partial<WelfareState>, next: Partial<WelfareState>) {
  const previousApplications = new Map((Array.isArray(previous.applications) ? previous.applications : []).map(item => [item.id, item]))
  const nextApplications = Array.isArray(next.applications) ? next.applications : []
  for (const application of nextApplications) {
    const before = previousApplications.get(application.id)
    if (!before || before.status === application.status)
      continue

    if (['pending_review', 'processing'].includes(before.status) && ['answered', 'completed', 'closed'].includes(application.status)) {
      const message = applicationNotification(application, 'application_answered')
      await createAndDispatchNotification(env, {
        userId: application.userId,
        event: 'application_answered',
        ...message,
      })
    }

    if (['pending_review', 'processing'].includes(before.status) && application.status === 'rejected') {
      const message = applicationNotification(application, 'application_rejected')
      await createAndDispatchNotification(env, {
        userId: application.userId,
        event: 'application_rejected',
        ...message,
      })
    }
  }

  const previousVerifications = new Map((Array.isArray(previous.studentVerifications) ? previous.studentVerifications : []).map(item => [item.id, item]))
  const nextVerifications = Array.isArray(next.studentVerifications) ? next.studentVerifications : []
  for (const verification of nextVerifications) {
    const before = previousVerifications.get(verification.id)
    if (!before || before.status === verification.status)
      continue

    if (before.status === 'pending' && verification.status === 'approved') {
      await createAndDispatchNotification(env, {
        userId: verification.userId,
        event: 'student_approved',
        title: '学生认证已通过',
        body: verification.reply || '你的学生认证已通过，审核积分已返还。',
        data: { verificationId: verification.id },
      })
    }

    if (before.status === 'pending' && verification.status === 'rejected') {
      await createAndDispatchNotification(env, {
        userId: verification.userId,
        event: 'student_rejected',
        title: '学生认证已退回',
        body: verification.reply || '你的学生认证材料未通过审核，审核费不返还。',
        data: { verificationId: verification.id },
      })
    }
  }
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

    const { user } = await getAuthenticatedRequest(request, env)

    if (path === '/' && request.method === 'GET')
      return json(await listNotifications(env, user.id))

    if (path === '/settings' && request.method === 'GET')
      return json(await toSettingsView(env, user, await getSettingsRow(env, user.id)))

    if (path === '/settings' && request.method === 'PUT') {
      const payload = await readJson<SaveNotificationSettingsPayload>(request)
      return json(await saveSettings(env, user, payload))
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
