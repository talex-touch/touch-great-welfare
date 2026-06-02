import type { WorkerEnv } from './welfare-state'
import type { AiApplicationReview, LlmApiModelPricing, WelfareApplication, WelfareState } from '~/composables/welfare'
import { calculateActivityPrice, DEFAULT_LLM_API_MODELS, normalizeLlmApiModelPricings, REQUEST_COST } from '~/composables/welfare'
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
  normalizeUrlBase,
  now,
  readJson,
} from './auth'
import { decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { createAndDispatchNotification, ensureNotificationSchema } from './notifications'
import { getPool, readWelfareState, shouldUseD1, writeWelfareState } from './welfare-state'

type AiImageJobStatus = 'pending' | 'succeeded' | 'failed'

interface AiProviderConfigRow {
  id: string
  enabled: number | boolean
  base_url: string
  image_model: string
  review_model?: string | null
  api_key_encrypted?: string | null
  newapi_key_encrypted?: string | null
  newapi_management_base_url?: string | null
  newapi_user_id?: string | null
  temporary_key_ttl_minutes: number
  temporary_key_quota: number
  llm_api_models?: string | LlmApiModelPricing[] | null
}

interface AiImageJobRow {
  id: string
  user_id: string
  application_id?: string | null
  model: string
  prompt: string
  status: AiImageJobStatus
  r2_object_key?: string | null
  content_type?: string | null
  error?: string | null
  created_at?: string | Date
  completed_at?: string | Date | null
}

interface SaveAiConfigPayload {
  enabled?: boolean
  baseUrl?: string
  imageModel?: string
  reviewModel?: string
  apiKey?: string
  newapiKey?: string
  newapiManagementBaseUrl?: string
  newapiUserId?: string
  clearApiKey?: boolean
  clearNewapiKey?: boolean
  temporaryKeyTtlMinutes?: number
  temporaryKeyQuota?: number
  llmApiModels?: LlmApiModelPricing[]
}

interface CreateTemporaryKeyPayload {
  userId?: string
  ttlMinutes?: number
  quota?: number
}

interface CreateImagePayload {
  prompt?: string
  applicationId?: string
  size?: string
  quality?: string
}

interface CreateReviewPayload {
  applicationId?: string
}

interface OpenAiImageResponse {
  data?: Array<{
    b64_json?: string
    url?: string
  }>
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  output_text?: string
}

interface NewApiTokenResponse {
  id?: number | string
  key?: string
  token?: string
  data?: {
    id?: number | string
    key?: string
    token?: string
  }
}

const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5'
const DEFAULT_REVIEW_MODEL = 'gpt-4.1-mini'
const DEFAULT_TEMP_KEY_TTL_MINUTES = 60
const DEFAULT_TEMP_KEY_QUOTA = 100

function toIso(value?: string | Date | null) {
  if (!value)
    return undefined
  return value instanceof Date ? value.toISOString() : value
}

function encryptionSecret(env: WorkerEnv) {
  return env.NOTIFY_SECRET_KEY ?? ''
}

async function decryptOptionalSecret(value: string | null | undefined, env: WorkerEnv) {
  if (!value)
    return ''
  try {
    return await decryptSecret(value, encryptionSecret(env))
  }
  catch {
    return ''
  }
}

async function getApiKey(env: WorkerEnv, stored?: AiProviderConfigRow | null) {
  return await decryptOptionalSecret(stored?.api_key_encrypted, env) || env.OPENAI_API_KEY || await decryptOptionalSecret(stored?.newapi_key_encrypted, env) || env.NEWAPI_API_KEY || ''
}

async function getNewApiKey(env: WorkerEnv, stored?: AiProviderConfigRow | null) {
  return await decryptOptionalSecret(stored?.newapi_key_encrypted, env) || env.NEWAPI_API_KEY || ''
}

async function getStoredAiConfig(env: WorkerEnv) {
  await ensureNotificationSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from ai_provider_config where id = ?1')
      .bind('default')
      .first<AiProviderConfigRow>()
  }

  const result = await getPool(env).query<AiProviderConfigRow>(
    'select * from ai_provider_config where id = $1',
    ['default'],
  )
  return result.rows[0] ?? null
}

function parseStoredLlmApiModels(value: AiProviderConfigRow['llm_api_models']) {
  if (!value)
    return DEFAULT_LLM_API_MODELS
  if (Array.isArray(value))
    return value

  try {
    return JSON.parse(value) as LlmApiModelPricing[]
  }
  catch {
    return DEFAULT_LLM_API_MODELS
  }
}

async function getEffectiveAiConfig(env: WorkerEnv) {
  const stored = await getStoredAiConfig(env)
  const apiKey = await getApiKey(env, stored)
  const newapiKey = await getNewApiKey(env, stored)
  return {
    enabled: stored
      ? boolValue(stored.enabled)
      : env.AI_PROVIDER_ENABLED === 'true',
    baseUrl: normalizeUrlBase(stored?.base_url || env.AI_PROVIDER_BASE_URL || DEFAULT_AI_BASE_URL),
    imageModel: stored?.image_model || env.AI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    reviewModel: stored?.review_model || env.AI_REVIEW_MODEL || DEFAULT_REVIEW_MODEL,
    apiKey,
    newapiKey,
    newapiManagementBaseUrl: normalizeUrlBase(stored?.newapi_management_base_url || env.NEWAPI_MANAGEMENT_BASE_URL || ''),
    newapiUserId: stored?.newapi_user_id || env.NEWAPI_USER_ID || '',
    temporaryKeyTtlMinutes: Number(stored?.temporary_key_ttl_minutes || env.NEWAPI_TEMP_KEY_TTL_MINUTES || DEFAULT_TEMP_KEY_TTL_MINUTES),
    temporaryKeyQuota: Number(stored?.temporary_key_quota || env.NEWAPI_TEMP_KEY_QUOTA || DEFAULT_TEMP_KEY_QUOTA),
    llmApiModels: normalizeLlmApiModelPricings(parseStoredLlmApiModels(stored?.llm_api_models)),
    source: stored ? 'admin' : env.AI_PROVIDER_BASE_URL || env.AI_IMAGE_MODEL || env.OPENAI_API_KEY || env.NEWAPI_API_KEY ? 'env' : 'empty',
    configured: !!apiKey,
  }
}

async function saveAiConfig(env: WorkerEnv, payload: SaveAiConfigPayload) {
  await ensureNotificationSchema(env)
  const stored = await getStoredAiConfig(env)
  let apiKeyEncrypted = stored?.api_key_encrypted || null
  let newapiKeyEncrypted = stored?.newapi_key_encrypted || null
  if (payload.clearApiKey)
    apiKeyEncrypted = null
  if (payload.clearNewapiKey)
    newapiKeyEncrypted = null
  if (payload.apiKey?.trim())
    apiKeyEncrypted = await encryptSecret(payload.apiKey.trim(), encryptionSecret(env))
  if (payload.newapiKey?.trim())
    newapiKeyEncrypted = await encryptSecret(payload.newapiKey.trim(), encryptionSecret(env))

  const config = {
    enabled: payload.enabled !== false,
    baseUrl: normalizeUrlBase(payload.baseUrl?.trim() || DEFAULT_AI_BASE_URL),
    imageModel: payload.imageModel?.trim() || DEFAULT_IMAGE_MODEL,
    reviewModel: payload.reviewModel?.trim() || DEFAULT_REVIEW_MODEL,
    apiKeyEncrypted,
    newapiKeyEncrypted,
    newapiManagementBaseUrl: payload.newapiManagementBaseUrl?.trim() || '',
    newapiUserId: payload.newapiUserId?.trim() || '',
    temporaryKeyTtlMinutes: Math.max(5, Math.min(24 * 60, Math.trunc(payload.temporaryKeyTtlMinutes || DEFAULT_TEMP_KEY_TTL_MINUTES))),
    temporaryKeyQuota: Math.max(1, Math.min(100000, Math.trunc(payload.temporaryKeyQuota || DEFAULT_TEMP_KEY_QUOTA))),
    llmApiModels: normalizeLlmApiModelPricings(payload.llmApiModels),
  }

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into ai_provider_config (
          id, enabled, base_url, image_model, review_model, api_key_encrypted, newapi_key_encrypted,
          newapi_management_base_url, newapi_user_id, temporary_key_ttl_minutes, temporary_key_quota, llm_api_models, updated_at
        )
        values ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, current_timestamp)
        on conflict (id)
        do update set
          enabled = excluded.enabled,
          base_url = excluded.base_url,
          image_model = excluded.image_model,
          review_model = excluded.review_model,
          api_key_encrypted = excluded.api_key_encrypted,
          newapi_key_encrypted = excluded.newapi_key_encrypted,
          newapi_management_base_url = excluded.newapi_management_base_url,
          newapi_user_id = excluded.newapi_user_id,
          temporary_key_ttl_minutes = excluded.temporary_key_ttl_minutes,
          temporary_key_quota = excluded.temporary_key_quota,
          llm_api_models = excluded.llm_api_models,
          updated_at = current_timestamp
      `)
      .bind(
        config.enabled ? 1 : 0,
        config.baseUrl,
        config.imageModel,
        config.reviewModel,
        config.apiKeyEncrypted,
        config.newapiKeyEncrypted,
        config.newapiManagementBaseUrl,
        config.newapiUserId,
        config.temporaryKeyTtlMinutes,
        config.temporaryKeyQuota,
        JSON.stringify(config.llmApiModels),
      )
      .run()
  }
  else {
    await getPool(env).query(`
      insert into ai_provider_config (
        id, enabled, base_url, image_model, review_model, api_key_encrypted, newapi_key_encrypted,
        newapi_management_base_url, newapi_user_id, temporary_key_ttl_minutes, temporary_key_quota, llm_api_models, updated_at
      )
      values ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())
      on conflict (id)
      do update set
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        image_model = excluded.image_model,
        review_model = excluded.review_model,
        api_key_encrypted = excluded.api_key_encrypted,
        newapi_key_encrypted = excluded.newapi_key_encrypted,
        newapi_management_base_url = excluded.newapi_management_base_url,
        newapi_user_id = excluded.newapi_user_id,
        temporary_key_ttl_minutes = excluded.temporary_key_ttl_minutes,
        temporary_key_quota = excluded.temporary_key_quota,
        llm_api_models = excluded.llm_api_models,
        updated_at = now()
    `, [
      config.enabled,
      config.baseUrl,
      config.imageModel,
      config.reviewModel,
      config.apiKeyEncrypted,
      config.newapiKeyEncrypted,
      config.newapiManagementBaseUrl,
      config.newapiUserId,
      config.temporaryKeyTtlMinutes,
      config.temporaryKeyQuota,
      JSON.stringify(config.llmApiModels),
    ])
  }

  return getEffectiveAiConfig(env)
}

function serializeAiConfig(config: Awaited<ReturnType<typeof getEffectiveAiConfig>>) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    imageModel: config.imageModel,
    reviewModel: config.reviewModel,
    apiKeyMasked: maskSecret(config.apiKey),
    newapiKeyMasked: maskSecret(config.newapiKey),
    newapiManagementBaseUrl: config.newapiManagementBaseUrl,
    newapiUserId: config.newapiUserId,
    temporaryKeyTtlMinutes: config.temporaryKeyTtlMinutes,
    temporaryKeyQuota: config.temporaryKeyQuota,
    llmApiModels: config.llmApiModels,
    source: config.source,
    env: {
      AI_PROVIDER_ENABLED: 'true',
      AI_PROVIDER_BASE_URL: config.baseUrl,
      AI_IMAGE_MODEL: config.imageModel,
      AI_REVIEW_MODEL: config.reviewModel,
      OPENAI_API_KEY: '<兼容旧部署；推荐改用后台加密配置>',
      NEWAPI_API_KEY: '<兼容旧部署；推荐改用后台加密配置>',
    },
  }
}

async function insertTemporaryKey(env: WorkerEnv, userId: string, key: string, upstreamTokenId: string, quota: number, expiresAt: string) {
  await ensureNotificationSchema(env)
  const id = createId('atk')
  const keyHash = await sha256Hex(key)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into ai_temporary_keys (id, user_id, key_hash, upstream_token_id, quota, expires_at, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp)
      `)
      .bind(id, userId, keyHash, upstreamTokenId || null, quota, expiresAt)
      .run()
  }
  else {
    await getPool(env).query(`
      insert into ai_temporary_keys (id, user_id, key_hash, upstream_token_id, quota, expires_at, created_at)
      values ($1, $2, $3, $4, $5, $6, now())
    `, [id, userId, keyHash, upstreamTokenId || null, quota, expiresAt])
  }

  return id
}

async function createTemporaryKey(request: Request, env: WorkerEnv) {
  const auth = await getAuthenticatedRequest(request, env)
  const payload = await readJson<CreateTemporaryKeyPayload>(request)
  const config = await getEffectiveAiConfig(env)
  if (!config.enabled)
    throw new Error('AI Provider 未启用')
  if (!config.newapiKey)
    throw new Error('NEWAPI_API_KEY 未配置，无法生成临时 Key')

  const targetUserId = auth.user.role === 'admin' && payload.userId?.trim()
    ? payload.userId.trim()
    : auth.user.id
  const ttlMinutes = Math.max(5, Math.min(24 * 60, Math.trunc(payload.ttlMinutes || config.temporaryKeyTtlMinutes)))
  const quota = Math.max(1, Math.min(100000, Math.trunc(payload.quota || config.temporaryKeyQuota)))
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
  const baseUrl = config.newapiManagementBaseUrl || config.baseUrl
  const response = await fetchWithTimeout(`${baseUrl}/api/token/`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${config.newapiKey}`,
      'content-type': 'application/json',
      ...(config.newapiUserId ? { 'New-Api-User': config.newapiUserId } : {}),
    },
    body: JSON.stringify({
      name: `touch-great-welfare-${targetUserId}-${Date.now()}`,
      remain_quota: quota,
      expired_time: Math.floor(new Date(expiresAt).getTime() / 1000),
    }),
  })
  const result = await response.json().catch(() => ({})) as NewApiTokenResponse
  if (!response.ok)
    throw new Error(`NewAPI 临时 Key 创建失败：${response.status}`)

  const key = result.key || result.token || result.data?.key || result.data?.token
  if (!key)
    throw new Error('NewAPI 未返回临时 Key')

  const id = await insertTemporaryKey(env, targetUserId, key, String(result.id || result.data?.id || ''), quota, expiresAt)
  return {
    id,
    key,
    expiresAt,
    quota,
  }
}

async function insertImageJob(env: WorkerEnv, row: {
  id: string
  userId: string
  applicationId?: string
  model: string
  prompt: string
  status: AiImageJobStatus
}) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into ai_image_jobs (id, user_id, application_id, model, prompt, status, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, current_timestamp, current_timestamp)
      `)
      .bind(row.id, row.userId, row.applicationId || null, row.model, row.prompt, row.status)
      .run()
    return
  }

  await getPool(env).query(`
    insert into ai_image_jobs (id, user_id, application_id, model, prompt, status, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $6, now(), now())
  `, [row.id, row.userId, row.applicationId || null, row.model, row.prompt, row.status])
}

async function updateImageJob(env: WorkerEnv, id: string, status: AiImageJobStatus, objectKey = '', contentType = '', error = '') {
  await ensureNotificationSchema(env)
  const completed = status === 'pending' ? 'null' : 'current_timestamp'

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        update ai_image_jobs
        set status = ?2, r2_object_key = ?3, content_type = ?4, error = ?5, completed_at = ${completed}, updated_at = current_timestamp
        where id = ?1
      `)
      .bind(id, status, objectKey || null, contentType || null, error || null)
      .run()
    return
  }

  await getPool(env).query(`
    update ai_image_jobs
    set status = $2, r2_object_key = $3, content_type = $4, error = $5, completed_at = ${status === 'pending' ? 'null' : 'now()'}, updated_at = now()
    where id = $1
  `, [id, status, objectKey || null, contentType || null, error || null])
}

async function getImageJob(env: WorkerEnv, id: string) {
  await ensureNotificationSchema(env)
  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from ai_image_jobs where id = ?1')
      .bind(id)
      .first<AiImageJobRow>()
  }

  const result = await getPool(env).query<AiImageJobRow>('select * from ai_image_jobs where id = $1', [id])
  return result.rows[0] ?? null
}

function decodeBase64(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function plainTextFromRichText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseJsonObject(value: string) {
  const direct = value.trim()
  try {
    return JSON.parse(direct) as Record<string, unknown>
  }
  catch {
    const match = direct.match(/\{[\s\S]*\}/)
    if (!match)
      throw new Error('AI 审核结果不是有效 JSON')
    return JSON.parse(match[0]) as Record<string, unknown>
  }
}

function normalizeAiReview(input: Record<string, unknown>, model: string): AiApplicationReview {
  const decision = typeof input.decision === 'string' ? input.decision : 'needs_human'
  const rawRisk = typeof input.risk === 'string' ? input.risk : 'medium'
  const risk: AiApplicationReview['risk'] = rawRisk === 'low' || rawRisk === 'medium' || rawRisk === 'high'
    ? rawRisk
    : 'medium'
  const status = decision === 'approved' || decision === 'rejected' || decision === 'needs_human'
    ? decision
    : 'needs_human'
  const summary = typeof input.summary === 'string' && input.summary.trim()
    ? input.summary.trim()
    : 'AI 已完成初审，但未给出明确摘要。'
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''

  return {
    status,
    summary,
    risk,
    reason: reason || undefined,
    model,
    reviewedAt: now(),
  }
}

function buildReviewPrompt(application: WelfareApplication) {
  const description = plainTextFromRichText(application.description).slice(0, 6000)
  return [
    '你是公益申请后台的 AI 初审助手，只做风险和材料完整性初审，最终决定由管理员执行。',
    '请检查申请是否明显为空泛、和公益无关、含敏感信息、违法违规、材料不足或风险较高。',
    '必须只输出 JSON，不要 Markdown，不要额外解释。',
    'JSON 字段：decision 为 approved/rejected/needs_human；risk 为 low/medium/high；summary 为 30 到 80 字中文摘要；reason 为给管理员看的具体理由。',
    `申请类型：${application.type}`,
    `申请标题：${application.title}`,
    `关联仓库：${application.githubRepo || '未关联'}`,
    `开源认证：${application.hasOpenSourceBadge ? '是' : '否'}`,
    `附件数量：${application.attachments.length}`,
    `详细说明：${description}`,
  ].join('\n')
}

async function callReviewProvider(env: WorkerEnv, config: Awaited<ReturnType<typeof getEffectiveAiConfig>>, application: WelfareApplication) {
  const key = config.apiKey
  if (!key)
    throw new Error('AI Provider API Key 未配置')

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.reviewModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是严格、简洁的公益申请 AI 初审助手。你只输出符合要求的 JSON。',
        },
        {
          role: 'user',
          content: buildReviewPrompt(application),
        },
      ],
    }),
  }, 60000)
  const result = await response.json().catch(() => ({})) as OpenAiChatResponse & { error?: { message?: string } }
  if (!response.ok)
    throw new Error(result.error?.message || `AI 审核失败：${response.status}`)

  const content = result.choices?.[0]?.message?.content || result.output_text || ''
  if (!content)
    throw new Error('AI Provider 未返回审核结果')

  return normalizeAiReview(parseJsonObject(content), config.reviewModel)
}

function fallbackReview(error: unknown): AiApplicationReview {
  return {
    status: 'failed',
    summary: 'AI 初审未完成，管理员需要人工审核。',
    risk: 'medium',
    reason: error instanceof Error ? error.message : 'AI 审核失败',
    reviewedAt: now(),
  }
}

function reviewToAnswer(review: AiApplicationReview) {
  const resultText = review.status === 'approved'
    ? '建议通过'
    : review.status === 'rejected'
      ? '建议退回'
      : review.status === 'failed'
        ? '审核失败'
        : '建议人工复核'

  return `<p><strong>AI 初审：</strong>${escapeHtml(resultText)} · 风险 ${escapeHtml(review.risk)}</p><p>${escapeHtml(review.summary)}</p>${review.reason ? `<p>${escapeHtml(review.reason)}</p>` : ''}`
}

async function createApplicationReview(request: Request, env: WorkerEnv) {
  const auth = await getAuthenticatedRequest(request, env)
  const payload = await readJson<CreateReviewPayload>(request)
  const applicationId = payload.applicationId?.trim()
  if (!applicationId)
    throw new Error('申请 ID 不能为空')

  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const application = state.applications.find(item => item.id === applicationId)
  if (!application)
    throw new Error('申请不存在')
  if (auth.user.role !== 'admin' && application.userId !== auth.user.id)
    throw new Error('无权审核该申请')

  const config = await getEffectiveAiConfig(env)

  let review: AiApplicationReview
  if (!config.enabled) {
    review = fallbackReview(new Error('AI Provider 未启用'))
  }
  else {
    try {
      review = await callReviewProvider(env, config, application)
    }
    catch (error) {
      review = fallbackReview(error)
    }
  }

  application.aiReview = review
  if (application.status === 'pending_review')
    application.answer = reviewToAnswer(review)
  await writeWelfareState(env, state)

  return {
    applicationId: application.id,
    review,
  }
}

async function callImageProvider(env: WorkerEnv, config: Awaited<ReturnType<typeof getEffectiveAiConfig>>, prompt: string, payload: CreateImagePayload) {
  const key = config.apiKey
  if (!key)
    throw new Error('AI Provider API Key 未配置')

  const response = await fetchWithTimeout(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      size: payload.size || '1024x1024',
      quality: payload.quality || 'auto',
      response_format: 'b64_json',
    }),
  }, 120000)
  const result = await response.json().catch(() => ({})) as OpenAiImageResponse & { error?: { message?: string } }
  if (!response.ok)
    throw new Error(result.error?.message || `图片生成失败：${response.status}`)

  const first = result.data?.[0]
  if (first?.b64_json)
    return { bytes: decodeBase64(first.b64_json), contentType: 'image/png' }
  if (first?.url) {
    const image = await fetchWithTimeout(first.url, {}, 60000)
    if (!image.ok)
      throw new Error(`图片下载失败：${image.status}`)
    return {
      bytes: new Uint8Array(await image.arrayBuffer()),
      contentType: image.headers.get('content-type') || 'image/png',
    }
  }

  throw new Error('AI Provider 未返回图片')
}

function adjustPoints(state: WelfareState, userId: string, delta: number, reason: string, refId: string) {
  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')
  const next = user.points + delta
  if (next < 0)
    throw new Error('积分不足')

  user.points = next
  state.transactions.unshift({
    id: createId('tx'),
    userId,
    delta,
    type: delta < 0 ? 'spend' : 'refund',
    reason,
    refId,
    createdAt: now(),
  })
}

function updateApplicationForImage(state: WelfareState, applicationId: string | undefined, userId: string, status: 'completed' | 'rejected', answer: string) {
  if (!applicationId)
    return

  const application = state.applications.find(item => item.id === applicationId)
  if (!application || application.userId !== userId || application.type !== 'image')
    return

  application.status = status
  application.answer = answer
  if (status === 'completed')
    application.costCharged = true
  application.reviewedAt = now()
  if (status === 'completed')
    application.completedAt = application.reviewedAt
}

function imageApplicationForRequest(state: WelfareState, applicationId: string | undefined, authUserId: string, isAdmin: boolean) {
  if (!applicationId)
    return undefined

  const application = state.applications.find(item => item.id === applicationId)
  if (!application || application.type !== 'image')
    return undefined
  if (!isAdmin && application.userId !== authUserId)
    throw new Error('无权处理该图片申请')

  return application
}

async function createImage(request: Request, env: WorkerEnv) {
  const auth = await getAuthenticatedRequest(request, env)
  const payload = await readJson<CreateImagePayload>(request)
  const prompt = payload.prompt?.trim()
  if (!prompt)
    throw new Error('请填写图片生成提示词')

  const config = await getEffectiveAiConfig(env)
  if (!config.enabled)
    throw new Error('AI Provider 未启用')
  if (!env.AI_ASSETS)
    throw new Error('AI_ASSETS R2 Binding 未配置')

  const currentState = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(currentState)
  const application = imageApplicationForRequest(currentState, payload.applicationId, auth.user.id, auth.user.role === 'admin')
  if (application && !['pending_review', 'processing'].includes(application.status))
    throw new Error('该图片申请已经处理')
  const targetUserId = application?.userId ?? auth.user.id

  const jobId = createId('img')
  await insertImageJob(env, {
    id: jobId,
    userId: targetUserId,
    applicationId: payload.applicationId,
    model: config.imageModel,
    prompt,
    status: 'pending',
  })

  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  try {
    const imageApplication = imageApplicationForRequest(state, payload.applicationId, auth.user.id, auth.user.role === 'admin')
    if (imageApplication) {
      if (!imageApplication.costCharged) {
        const imageCost = Number.isFinite(imageApplication.cost)
          ? imageApplication.cost
          : calculateActivityPrice(REQUEST_COST.image)
        adjustPoints(state, targetUserId, -imageCost, 'Image 生成历史补扣', payload.applicationId || jobId)
        imageApplication.costCharged = true
      }
    }
    else if (!payload.applicationId) {
      adjustPoints(state, targetUserId, -calculateActivityPrice(REQUEST_COST.image), 'Image 生成预扣', payload.applicationId || jobId)
    }
    await writeWelfareState(env, state)

    const image = await callImageProvider(env, config, prompt, payload)
    const objectKey = `ai-images/${targetUserId}/${jobId}.png`
    await env.AI_ASSETS.put(objectKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
      },
    })

    const latestState = await readWelfareState(env) as Partial<WelfareState>
    assertWelfareState(latestState)
    updateApplicationForImage(latestState, payload.applicationId, targetUserId, 'completed', `图片生成已完成：/api/ai/images/${jobId}/file`)
    await writeWelfareState(env, latestState)
    await updateImageJob(env, jobId, 'succeeded', objectKey, image.contentType)
    await createAndDispatchNotification(env, {
      userId: targetUserId,
      event: 'ai_image_succeeded',
      title: '图片生成完成',
      body: '你的图片生成任务已完成，可在申请记录中查看结果。',
      data: { jobId, applicationId: payload.applicationId },
    })

    return {
      jobId,
      status: 'succeeded' as const,
      fileUrl: `/api/ai/images/${jobId}/file`,
    }
  }
  catch (error) {
    const rollbackState = await readWelfareState(env) as Partial<WelfareState>
    assertWelfareState(rollbackState)
    const refId = payload.applicationId || jobId
    const alreadyRefunded = rollbackState.transactions.some(item => item.type === 'refund' && item.refId === refId)
    const imageApplication = imageApplicationForRequest(rollbackState, payload.applicationId, auth.user.id, auth.user.role === 'admin')
    if (!alreadyRefunded && imageApplication?.costCharged)
      adjustPoints(rollbackState, targetUserId, imageApplication.cost, 'Image 生成失败退款', refId)
    updateApplicationForImage(rollbackState, payload.applicationId, targetUserId, 'rejected', error instanceof Error ? error.message : '图片生成失败')
    await writeWelfareState(env, rollbackState)

    const message = error instanceof Error ? error.message : '图片生成失败'
    await updateImageJob(env, jobId, 'failed', '', '', message)
    await createAndDispatchNotification(env, {
      userId: targetUserId,
      event: 'ai_image_failed',
      title: '图片生成失败',
      body: `${message}。已退回本次图片生成积分。`,
      data: { jobId, applicationId: payload.applicationId },
    })
    throw error
  }
}

function mapImageJob(row: AiImageJobRow) {
  return {
    id: row.id,
    userId: row.user_id,
    applicationId: row.application_id || undefined,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    fileUrl: row.status === 'succeeded' ? `/api/ai/images/${row.id}/file` : undefined,
    error: row.error || undefined,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
  }
}

async function readImageFile(request: Request, env: WorkerEnv, jobId: string) {
  const auth = await getAuthenticatedRequest(request, env)
  const job = await getImageJob(env, jobId)
  if (!job)
    return json({ error: '图片任务不存在' }, 404)
  if (auth.user.role !== 'admin' && job.user_id !== auth.user.id)
    return json({ error: '无权读取该图片' }, 403)
  if (job.status !== 'succeeded' || !job.r2_object_key)
    return json({ error: '图片尚未生成完成' }, 404)
  if (!env.AI_ASSETS)
    throw new Error('AI_ASSETS R2 Binding 未配置')

  const object = await env.AI_ASSETS.get(job.r2_object_key)
  if (!object)
    return json({ error: '图片文件不存在' }, 404)

  return new Response(object.body, {
    headers: {
      'cache-control': 'private, max-age=300',
      'content-type': job.content_type || object.httpMetadata?.contentType || 'image/png',
    },
  })
}

export async function handleAiRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/ai'.length) || '/'

    if (path === '/config' && request.method === 'GET') {
      await assertAdminRequest(request, env)
      return json(serializeAiConfig(await getEffectiveAiConfig(env)))
    }

    if (path === '/config' && request.method === 'PUT') {
      await assertAdminRequest(request, env)
      const payload = await readJson<SaveAiConfigPayload>(request)
      return json(serializeAiConfig(await saveAiConfig(env, payload)))
    }

    if (path === '/temporary-key' && request.method === 'POST')
      return json(await createTemporaryKey(request, env))

    if (path === '/reviews' && request.method === 'POST')
      return json(await createApplicationReview(request, env))

    if (path === '/images' && request.method === 'POST')
      return json(await createImage(request, env))

    if (path.startsWith('/images/') && path.endsWith('/file') && request.method === 'GET') {
      const jobId = path.slice('/images/'.length, -'/file'.length)
      return readImageFile(request, env, jobId)
    }

    if (path.startsWith('/images/') && request.method === 'GET') {
      const jobId = path.slice('/images/'.length)
      const auth = await getAuthenticatedRequest(request, env)
      const job = await getImageJob(env, jobId)
      if (!job)
        return json({ error: '图片任务不存在' }, 404)
      if (auth.user.role !== 'admin' && job.user_id !== auth.user.id)
        return json({ error: '无权读取该任务' }, 403)
      return json(mapImageJob(job))
    }

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}
