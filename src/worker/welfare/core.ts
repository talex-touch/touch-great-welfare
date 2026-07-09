import type { AtomicPointTransaction } from './state-store'
import type {
  CouponTemplate,
  CrowdReview,
  DailyCheckIn,
  EducationEmailChallenge,
  InvitationBinding,
  ResourceApprovalStatus,
  SquareBoost,
  SquarePost,
  SquareReport,
  StudentVerification,
  SubmitApplicationPayload,
  SubmitResourceApplicationPayload,
  SubmitStudentPayload,
  User,
  UserCoupon,
  WelfareApplication,
  WelfareState,
} from '~/shared/welfare-types'
import {
  applyResourceLifecycleAction,
  buildPricingSnapshot,
  calculateLlmApiCostPoints,
  calculateLlmApiRateLimitChangeCost,
  calculateRejectionReviewFee,
  createFraudRejectionCooldownUntil,
  createProcessingDueAt,
  createRejectionFeeWaiverBlockedUntil,
  createRetentionExpiresAt,
  llmApiRequiresExtendedReview,
  normalizeApplicationPolicy,
  normalizeResourceItems,
  normalizeSiteBanner,
  resolveResourceLifecycleStatus,
  resolveSelectableLlmApiModel,
  resourceActivityPromotionName,
  resourceApprovalStatusText,
  resourceTypeLabel,
  rollDailyCheckInPoints,
} from '~/composables/welfare'
import { analyzeEducationEmail, educationEmailAdminRecommendationLabel } from '~/shared/education-email'
import {
  ACTIVITY_END_AT,
  BASE_REQUEST_COST,
  calculateActivityPrice,
  calculateLlmApiBudgetActivityPrice,
  COLLABORATION_APPLICATION_MIN_REASON_CHARS,
  COLLABORATION_DELIVERY_REWARD_MAX,
  COLLABORATION_DELIVERY_REWARD_MIN,
  createUserInviteCode,
  DAILY_CHECK_IN_MAX_POINTS,
  EDUCATION_EMAIL_CHALLENGE_TTL_HOURS,
  EDUCATION_EMAIL_REVIEW_INBOX,
  INVITATION_BIND_WINDOW_HOURS,
  LLM_API_EXTENDED_PROCESSING_HOURS,
  LLM_API_STANDARD_PROCESSING_HOURS,
  MAX_ATTACHMENT_BYTES,
  normalizeLlmApiBudgetUsd,
  normalizeSystemConfig,
  PRO_CONTEXT_APPEND_COST,
  PRO_EXPEDITE_COST,
  PRO_STANDARD_PROCESSING_HOURS,
  REJECTION_REVIEW_FEE_RATE,
  SQUARE_BOOST_REPORT_COOLDOWN_DAYS,
  SQUARE_BOOST_REPORT_PENALTY_POINTS,
  SQUARE_BOOST_REWARD_POINTS,
  SQUARE_DAILY_BOOST_LIMIT,
  SQUARE_MIN_DISCOUNT_RATE,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
} from '~/shared/welfare-domain'
import { isRichTextEmpty, richTextToPlainText } from '~/utils/rich-text'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { base64UrlDecode, base64UrlEncode, sha256Hex } from '../crypto'
import { dispatchWelfareStateChangeNotifications } from '../notifications'
import { appendPointTransaction, ensurePointTransactionSchema, pointTransactionId, syncUserPointBalancesFromLedger } from '../points'
import { authenticatedUserId, createSessionCookie } from '../session'
import {
  aggregateResourceApplicationStatusForReview,
  assertCanAnswerApplication,
  assertCanCompleteApplication,
  assertCanRejectApplication,
  assertCanRequestApplicationSupplement,
  transitionApplicationAnswered,
  transitionApplicationCompleted,
  transitionApplicationRejected,
  transitionApplicationSupplementRequested,
} from './application-state-machine'
import {
  adminApplication,
  appendWorkerApplicationMessage,
  assertApplicationPolicyForState,
  assertCanCreateRequestForState,
  assertResourceTypeCanApplyForState,
  attachmentsFromPayload,
  buildResourceDescription,
  buildResourceTermsAcceptances,
  ensureApplications,
  manualProvisionNote,
  normalizeManualProvisionPayload,
  pushApplicationMessage,
  rejectionFeeWaiverBlockedUntilForState,
  sanitizeResourceLifecycleAction,
  stateApplications,
  totalAttachmentBytes,
  totalResourceApplicationAttachmentBytes,
} from './applications'
import { getPool, shouldUseD1 } from './connection'
import {
  createCouponCodeValue,
  createDailyCoupon,
  createUserCouponFromRule,
  DEFAULT_COUPON_TTL_DAYS,
  ensureCoupons,
  normalizeWorkerCouponRule,
  resourceCheckoutSnapshotForState,
  squareDiscountSnapshot,
} from './coupons'
import { parseOffsetParam, parsePositiveIntegerParam, parseStatusParam } from './query'
import { isRecord } from './records'
import { isMaskedSecret, maskSecret } from './secrets'
import { buildResourceSquarePost, ensureSquareBoosts, ensureSquarePosts, ensureSquareReports } from './square'
import {
  readAdminApplicationSnapshots,
  readCurrentUserApplicationSnapshots,
  readCurrentUserCouponSnapshots,
  readWelfareState,
  readWelfareStateRecord,
  StateVersionConflictError,
  stateVersionPayload,
  writeWelfareState,
  writeWelfareStateWithAtomicPointTransactions,
} from './state-store'
import {
  adminTargetUser,
  clientVisibleWelfareState,
  ensureCollaborationApplications,
  ensureDailyCheckIns,
  ensureInvitationBindings,
  publicBootstrapPayload,
  publicBootstrapState,
  sanitizeOwnedApplications,
  sanitizeUser,
  stateUsers,
  userVisibleFromIds,
} from './users'
import {
  appendWorkerStudentSupplementNotes,
  assertEducationEmail,
  assertVerifiedEducationEmailChallengeForState,
  ensureStudentVerifications,
  latestEducationEmailChallengeForState,
  markWorkerEducationEmailVerified,
  normalizeClientRequestId,
  normalizeStudentEmail,
  normalizeVerificationType,
  positiveStudentReviewFee,
  studentVerificationIdForRequest,
  syncStudentVerifiedProfiles,
  verificationTypeLabel,
} from './verifications'

export { allowUnstableNormalizedReads, getPool, shouldUseD1 } from './connection'
export { isRecord } from './records'
export {
  readWelfareState,
  readWelfareStateRecord,
  StateVersionConflictError,
  writeWelfareState,
} from './state-store'
export { sanitizeUser } from './users'

export interface WorkerEnv {
  LOCAL_DB?: D1Database
  AI_ASSETS?: R2Bucket
  HYPERDRIVE?: {
    connectionString: string
  }
  NOTIFY_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  WELFARE_STATE_SECRET_KEY?: string
  WEBHOOK_SECRET?: string
  ASYNC_JOBS?: Queue<unknown>
  USE_NORMALIZED_TABLES?: string // 'true' = 从规范化表读取
  ALLOW_UNSTABLE_NORMALIZED_READS?: string // 'true' = 仅本地允许试验性规范化表读取
  ENABLE_TEMP_ADMIN_ENDPOINTS?: string // 'true' = 启用临时迁移/调试端点
  ENABLE_LEGACY_STATE_WRITE?: string // 'true' = 临时允许 /api/welfare-state 全量写入
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
const ADMIN_LOGIN_MAX_FAILURES = 8
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000
const PASSWORD_PBKDF2_ITERATIONS = 100000
const adminLoginAttempts = new Map<string, { failures: number, firstFailureAt: number, lockedUntil: number }>()

export async function requestUserId(request: Request, env: WorkerEnv) {
  return await authenticatedUserId(request, env)
}

async function requireRequestUserId(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')
  return userId
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string') : []
}

function recordMap(value: unknown) {
  return new Map(arrayRecords(value).map(item => [item.id as string, item]))
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = Number(record[key])
  return Number.isFinite(value) ? value : fallback
}

function boolField(record: Record<string, unknown>, key: string) {
  return record[key] === true || record[key] === 1 || record[key] === '1'
}

function transactionId(scope: string, refId: string) {
  return pointTransactionId(scope, refId)
}

function expectedApplicationBaseCost(application: Record<string, unknown>) {
  const type = typeof application.type === 'string' ? application.type : ''
  const createdAt = typeof application.createdAt === 'string' ? application.createdAt : now()
  if (type === 'code' && application.llmApiBudgetUsd !== undefined) {
    const model = resolveSelectableLlmApiModel(typeof application.llmApiModelKey === 'string' ? application.llmApiModelKey : undefined)
    const budgetUsd = numberField(application, 'llmApiBudgetUsd', model.defaultBudgetUsd)
    return calculateLlmApiBudgetActivityPrice(calculateLlmApiCostPoints(budgetUsd, model), budgetUsd, model, createdAt)
  }
  if (type === 'code' || type === 'image' || type === 'pro')
    return calculateActivityPrice(BASE_REQUEST_COST[type], createdAt)
  return 0
}

function assertTrustedNewApplication(application: Record<string, unknown>, userId: string) {
  if (application.userId !== userId)
    throw new Error('无权提交其他用户的申请')

  const type = typeof application.type === 'string' ? application.type : ''
  const status = typeof application.status === 'string' ? application.status : ''
  if (!['code', 'image', 'pro', 'resource'].includes(type))
    throw new Error('申请类型无效')
  if (type === 'resource' && !['draft', 'in_review'].includes(status))
    throw new Error('资源申请初始状态无效')
  if (type !== 'resource' && status !== 'pending_review')
    throw new Error('申请初始状态无效')

  const cost = numberField(application, 'cost')
  const isDraft = type === 'resource' && status === 'draft'
  if (isDraft)
    return

  if (!boolField(application, 'costCharged'))
    throw new Error('申请必须由服务端记录预扣费')
  if (cost < 0)
    throw new Error('申请费用无效')

  const minimumBaseCost = Math.floor(expectedApplicationBaseCost(application) * SQUARE_MIN_DISCOUNT_RATE)
  if (minimumBaseCost > 0 && cost < minimumBaseCost)
    throw new Error('申请费用低于服务端规则')
}

async function appendTrustedPointTransaction(env: WorkerEnv, state: unknown, input: Parameters<typeof appendPointTransaction>[1]) {
  await appendPointTransaction(env, input, state)
}

async function hasPointTransaction(env: WorkerEnv, id: string) {
  await ensurePointTransactionSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select id from point_transactions where id = ?1')
      .bind(id)
      .first<{ id: string }>()
    return !!row
  }

  const result = await getPool(env).query<{ id: string }>('select id from point_transactions where id = $1', [id])
  return !!result.rows[0]
}

export async function applyTrustedPointTransactionsFromState(env: WorkerEnv, previousState: unknown, nextState: unknown, userId: string) {
  if (!isRecord(previousState) || !isRecord(nextState))
    return

  const previousApplications = recordMap(previousState.applications)
  for (const application of arrayRecords(nextState.applications)) {
    if (application.userId !== userId)
      continue

    const previousApplication = previousApplications.get(application.id as string)
    if (previousApplication) {
      if (previousApplication.status !== 'draft' || application.type !== 'resource' || application.status !== 'in_review' || application.costCharged !== true)
        continue
    }
    else {
      assertTrustedNewApplication(application, userId)
      if (application.type === 'resource' && application.status === 'draft')
        continue
    }

    const applicationId = application.id as string
    const cost = Math.trunc(numberField(application, 'cost'))
    if (cost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: transactionId('application_cost', applicationId),
        userId,
        delta: -cost,
        type: 'spend',
        reason: `${String(application.type || '申请').toUpperCase()} 申请预扣`,
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }

    const storageExtensionCost = Math.trunc(numberField(application, 'storageExtensionCost', boolField(application, 'storageExtended') ? STORAGE_EXTENSION_COST : 0))
    if (storageExtensionCost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: transactionId('storage_extension', applicationId),
        userId,
        delta: -storageExtensionCost,
        type: 'spend',
        reason: '延长申请存储服务 7 天预扣',
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }

    const expediteCost = Math.trunc(numberField(application, 'expediteCost', boolField(application, 'expedited') ? PRO_EXPEDITE_COST : 0))
    if (expediteCost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: transactionId('expedite', applicationId),
        userId,
        delta: -expediteCost,
        type: 'spend',
        reason: 'Pro 处理加速预扣',
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }
  }

  const previousVerifications = recordMap(previousState.studentVerifications)
  for (const verification of arrayRecords(nextState.studentVerifications)) {
    if (previousVerifications.has(verification.id as string) || verification.userId !== userId)
      continue
    if (verification.status !== 'pending' || boolField(verification, 'feeReturned'))
      throw new Error('认证申请状态无效')

    const verificationId = verification.id as string
    const reviewFee = Math.trunc(numberField(verification, 'reviewFee', STUDENT_REVIEW_FEE))
    if (reviewFee !== STUDENT_REVIEW_FEE)
      throw new Error('认证审核费无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: transactionId('student_review', verificationId),
      userId,
      delta: -STUDENT_REVIEW_FEE,
      type: 'spend',
      reason: '认证审核费',
      refId: verificationId,
      createdAt: typeof verification.createdAt === 'string' ? verification.createdAt : now(),
    })
  }

  const previousCheckIns = recordMap(previousState.dailyCheckIns)
  for (const checkIn of arrayRecords(nextState.dailyCheckIns)) {
    if (previousCheckIns.has(checkIn.id as string) || checkIn.userId !== userId)
      continue
    const points = Math.trunc(numberField(checkIn, 'points'))
    if (points < 1 || points > DAILY_CHECK_IN_MAX_POINTS)
      throw new Error('签到奖励积分无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: transactionId('daily_checkin', checkIn.id as string),
      userId,
      delta: points,
      type: 'grant',
      reason: `每日签到奖励（连续 ${Math.max(1, Math.trunc(numberField(checkIn, 'streak', 1)))} 天）`,
      refId: checkIn.id as string,
      createdAt: typeof checkIn.createdAt === 'string' ? checkIn.createdAt : now(),
    })
  }

  const previousBoosts = recordMap(previousState.squareBoosts)
  for (const boost of arrayRecords(nextState.squareBoosts)) {
    if (previousBoosts.has(boost.id as string) || boost.userId !== userId)
      continue
    const mode = typeof boost.mode === 'string' ? boost.mode : 'boost'
    const pointsGranted = Math.trunc(numberField(boost, 'pointsGranted'))
    if (mode === 'post_approval_vote') {
      if (pointsGranted !== 0)
        throw new Error('结束后助力投票不能发放积分')
      continue
    }
    if (pointsGranted !== SQUARE_BOOST_REWARD_POINTS)
      throw new Error('助力奖励积分无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: transactionId('square_boost', boost.id as string),
      userId,
      delta: SQUARE_BOOST_REWARD_POINTS,
      type: 'grant',
      reason: '广场拼一刀助力奖励',
      refId: boost.id as string,
      createdAt: typeof boost.createdAt === 'string' ? boost.createdAt : now(),
    })
  }

  const previousReports = recordMap(previousState.squareReports)
  const previousBoostById = recordMap(previousState.squareBoosts)
  const nextBoostById = recordMap(nextState.squareBoosts)
  for (const report of arrayRecords(nextState.squareReports)) {
    if (previousReports.has(report.id as string) || report.reporterId !== userId)
      continue
    const boostId = typeof report.boostId === 'string' ? report.boostId : ''
    const previousBoost = previousBoostById.get(boostId)
    const nextBoost = nextBoostById.get(boostId)
    if (!previousBoost || !nextBoost || previousBoost.penaltyApplied === true || nextBoost.penaltyApplied !== true || nextBoost.reportedBy !== userId)
      throw new Error('举报扣分状态无效')
    const targetUserId = typeof previousBoost.userId === 'string' ? previousBoost.userId : ''
    if (!targetUserId || targetUserId === userId)
      throw new Error('举报目标无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: transactionId('square_report_penalty', boostId),
      userId: targetUserId,
      delta: -SQUARE_BOOST_REPORT_PENALTY_POINTS,
      type: 'spend',
      reason: '广场助力被举报扣除积分',
      refId: boostId,
      createdAt: typeof report.createdAt === 'string' ? report.createdAt : now(),
      allowDebt: true,
    })
  }

  const previousUsers = arrayRecords(previousState.users)
  const pointsByUser = new Map(previousUsers.map(user => [user.id as string, user.points]))
  if (Array.isArray(nextState.users)) {
    for (const user of nextState.users) {
      if (isRecord(user) && typeof user.id === 'string' && pointsByUser.has(user.id))
        user.points = pointsByUser.get(user.id)
    }
  }
  nextState.transactions = []
}

export function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

export function forbidden(message = '需要管理员权限') {
  return json({ error: message }, 403)
}

export function errorResponse(error: unknown) {
  if (error instanceof StateVersionConflictError) {
    return json({
      code: 'STATE_VERSION_CONFLICT',
      error: error.message,
    }, 409)
  }

  const message = error instanceof Error ? error.message : '服务端错误'
  return json({
    error: message,
  }, message === '请先登录' ? 401 : 500)
}

export async function readPayload(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as { state?: unknown }
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function now() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function randomSalt() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
}

async function hashPasswordV1(password: string, salt = randomSalt()) {
  return `v1:${salt}:${await sha256Hex(`${salt}:${password}`)}`
}

async function hashPassword(password: string, salt = randomSalt(), iterations = PASSWORD_PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64UrlDecode(salt),
      iterations,
    },
    key,
    256,
  )
  return `pbkdf2-sha256:${iterations}:${salt}:${base64UrlEncode(new Uint8Array(derived))}`
}

async function verifyPassword(password: string, storedHash: unknown) {
  if (typeof storedHash !== 'string')
    return { ok: false, needsRehash: false }

  const parts = storedHash.split(':')
  if (parts[0] === 'pbkdf2-sha256') {
    const iterations = Number(parts[1])
    const salt = parts[2]
    const expected = parts[3]
    if (!Number.isFinite(iterations) || !salt || !expected)
      return { ok: false, needsRehash: false }
    const actual = await hashPassword(password, salt, iterations)
    return { ok: actual === storedHash, needsRehash: actual === storedHash && iterations < PASSWORD_PBKDF2_ITERATIONS }
  }

  if (parts[0] === 'v1') {
    const [, salt, expected] = parts
    if (!salt || !expected)
      return { ok: false, needsRehash: false }
    const ok = await hashPasswordV1(password, salt) === storedHash
    return { ok, needsRehash: ok }
  }

  return { ok: false, needsRehash: false }
}

function loginAttemptKey(request: Request, email: string) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  return `${ip}:${email}`
}

function assertLoginAllowed(request: Request, email: string) {
  const key = loginAttemptKey(request, email)
  const attempt = adminLoginAttempts.get(key)
  if (!attempt)
    return

  const currentTime = Date.now()
  if (attempt.lockedUntil > currentTime)
    throw new Error('登录失败次数过多，请稍后再试')
  if (currentTime - attempt.firstFailureAt > ADMIN_LOGIN_WINDOW_MS)
    adminLoginAttempts.delete(key)
}

function recordLoginFailure(request: Request, email: string) {
  const key = loginAttemptKey(request, email)
  const currentTime = Date.now()
  const existing = adminLoginAttempts.get(key)
  const attempt = existing && currentTime - existing.firstFailureAt <= ADMIN_LOGIN_WINDOW_MS
    ? existing
    : { failures: 0, firstFailureAt: currentTime, lockedUntil: 0 }
  attempt.failures += 1
  if (attempt.failures >= ADMIN_LOGIN_MAX_FAILURES)
    attempt.lockedUntil = currentTime + ADMIN_LOGIN_LOCK_MS
  adminLoginAttempts.set(key, attempt)
}

function clearLoginFailures(request: Request, email: string) {
  adminLoginAttempts.delete(loginAttemptKey(request, email))
}

function assertPassword(value: unknown) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < 8)
    throw new Error('管理员密码至少 8 位')

  return password
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeWorkerRichText(value: unknown) {
  const source = typeof value === 'string' ? value : ''
  if (!source.trim())
    return ''

  const allowedTags = new Set(['p', 'br', 'b', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4'])
  const placeholders: string[] = []
  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const protectedHtml = withoutScripts.replace(/<\/?([a-z0-9-]+)(?:\s[^>]*)?>/gi, (match, tagName: string) => {
    const normalized = tagName.toLowerCase()
    if (!allowedTags.has(normalized))
      return ''

    const token = `__TGW_TAG_${placeholders.length}__`
    placeholders.push(match.startsWith('</') ? `</${normalized}>` : `<${normalized}>`)
    return token
  })

  let escaped = escapeHtml(protectedHtml)
  placeholders.forEach((tag, index) => {
    escaped = escaped.replaceAll(`__TGW_TAG_${index}__`, tag)
  })
  return escaped
}

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString()
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

export async function authenticatedUser(request: Request, env: WorkerEnv, state: Partial<WelfareState>) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const user = stateUsers(state).find(item => item.id === userId)
  if (!user || user.accountStatus === 'suspended')
    throw new Error('请先登录')

  return user
}

export function assertAdminUser(user: User) {
  if (user.role !== 'admin')
    throw new Error('需要管理员权限')
}

function assertReviewerUser(user: User) {
  if (user.role !== 'reviewer' && user.role !== 'admin')
    throw new Error('需要协作处理员权限')
}

function normalizeInviteCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

async function applyStandardApplicationCommand(env: WorkerEnv, state: Partial<WelfareState>, user: User, payload: SubmitApplicationPayload) {
  if (!['code', 'image', 'pro'].includes(payload.type))
    throw new Error('申请类型无效')

  const title = payload.title.trim()
  const description = sanitizeWorkerRichText(payload.description)
  if (!title)
    throw new Error('请填写申请标题')
  if (isRichTextEmpty(description))
    throw new Error('请填写申请说明')

  const attachments = attachmentsFromPayload(payload.attachments)
  if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
    throw new Error('附件总大小不能超过 200MB')

  const createdAt = now()
  const cooldownUntil = stateApplications(state)
    .filter(item => item.userId === user.id && item.type === payload.type && !!item.rejectionFraudulent && !!item.cooldownUntil)
    .map(item => item.cooldownUntil!)
    .filter((value) => {
      const time = new Date(value).getTime()
      return Number.isFinite(time) && time > Date.now()
    })
    .sort()
    .at(-1)
  if (cooldownUntil)
    throw new Error(`同类申请限制中，请在 ${cooldownUntil} 后再提交`)

  const waiveBlockedUntil = rejectionFeeWaiverBlockedUntilForState(state, user.id)
  if (payload.waiveRejectionReviewFee && waiveBlockedUntil)
    throw new Error(`认真填写承诺暂不可用，请在 ${waiveBlockedUntil} 后再勾选`)

  assertCanCreateRequestForState(state, user.id)
  assertApplicationPolicyForState(state, {
    userId: user.id,
    type: payload.type,
    title,
    description,
    createdAt,
    powNonce: payload.powNonce,
    turnstileVerified: payload.turnstileVerified,
  })

  const pricing = buildPricingSnapshot(payload.type, createdAt)
  const llmApiModel = payload.type === 'code'
    ? resolveSelectableLlmApiModel(payload.llmApiModelKey ?? (payload.codexBudgetUsd ? 'codex' : undefined))
    : undefined
  const llmApiBudgetUsd = payload.type === 'code' && llmApiModel
    ? normalizeLlmApiBudgetUsd(payload.llmApiBudgetUsd ?? payload.codexBudgetUsd, llmApiModel)
    : undefined
  const llmApiCustomRpmLimit = llmApiModel && payload.llmApiCustomRpmLimit !== undefined ? Math.max(1, Math.trunc(Number(payload.llmApiCustomRpmLimit))) : undefined
  const llmApiCustomTpmLimit = llmApiModel && payload.llmApiCustomTpmLimit !== undefined ? Math.max(1, Math.trunc(Number(payload.llmApiCustomTpmLimit))) : undefined
  const llmApiRateLimitChangeCost = llmApiModel
    ? calculateLlmApiRateLimitChangeCost(llmApiCustomRpmLimit ?? llmApiModel.rpmLimit, llmApiModel.rpmLimit, llmApiCustomTpmLimit ?? llmApiModel.tpmLimit, llmApiModel.tpmLimit)
    : 0
  const cost = llmApiBudgetUsd && llmApiModel ? calculateLlmApiCostPoints(llmApiBudgetUsd, llmApiModel) : pricing.cost
  const storageExtended = payload.type !== 'code' && !!payload.extendStorage
  const storageExtensionCost = storageExtended ? STORAGE_EXTENSION_COST : 0
  const expedited = payload.type === 'pro' && !!payload.expediteProcessing
  const expediteCost = expedited ? PRO_EXPEDITE_COST : 0
  const rejectionReviewFeeWaived = payload.type !== 'code' && !!payload.waiveRejectionReviewFee
  const squareResult = squareDiscountSnapshot(cost, !!payload.shareToSquare)
  const prepaidCost = squareResult.cost + storageExtensionCost + expediteCost
  if (user.points < prepaidCost)
    throw new Error(`积分不足，本次申请需要预扣 ${prepaidCost} 积分`)

  const applicationId = createId('app')
  const squarePostId = payload.shareToSquare ? createId('square') : undefined
  const application: WelfareApplication = {
    id: applicationId,
    userId: user.id,
    type: payload.type,
    title,
    description,
    githubRepo: payload.githubRepo,
    hasOpenSourceBadge: !!payload.githubRepo && !!user.profile.githubUsername && !!user.profile.githubAuthorized,
    attachments,
    status: 'pending_review',
    baseCost: llmApiBudgetUsd ? cost : pricing.baseCost,
    cost: squareResult.cost,
    costCharged: true,
    sharedToSquare: !!payload.shareToSquare,
    squarePostId,
    squareDiscountRate: squareResult.discountRate,
    squareDiscountAmount: squareResult.discountAmount,
    pricingDiscountRate: llmApiBudgetUsd ? 1 : pricing.discountRate,
    pricingPromotionName: llmApiBudgetUsd ? undefined : pricing.promotionName,
    pricingPromotionEndsAt: llmApiBudgetUsd ? undefined : pricing.promotionEndsAt,
    pricingAppliedAt: pricing.appliedAt,
    aiReview: {
      status: 'pending',
      summary: 'AI 审核排队中，管理员处理前会展示自动审核结果。',
      risk: 'medium',
    },
    aiReviewFeeRate: REJECTION_REVIEW_FEE_RATE,
    rejectionReviewFee: calculateRejectionReviewFee(squareResult.cost),
    rejectionReviewFeeWaived,
    rejectionFraudulent: false,
    llmApiModelKey: llmApiModel?.key,
    llmApiModelName: llmApiModel?.name,
    llmApiProvider: llmApiModel?.provider,
    llmApiBudgetUsd,
    llmApiPointRate: llmApiModel?.pointsPerUsd,
    llmApiIpLimit: llmApiModel?.ipLimit,
    llmApiRpmLimit: llmApiModel?.rpmLimit,
    llmApiTpmLimit: llmApiModel?.tpmLimit,
    llmApiCustomRpmLimit,
    llmApiCustomTpmLimit,
    llmApiRateLimitChangeCost,
    llmApiConcurrencyLimit: llmApiModel?.concurrencyLimit,
    llmApiRequiresExtendedReview: llmApiBudgetUsd && llmApiModel ? llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel) : undefined,
    codexBudgetUsd: llmApiModel?.key === 'codex' ? llmApiBudgetUsd : undefined,
    codexPointRate: llmApiModel?.key === 'codex' ? llmApiModel.pointsPerUsd : undefined,
    codexIpLimit: llmApiModel?.key === 'codex' ? llmApiModel.ipLimit : undefined,
    codexRpmLimit: llmApiModel?.key === 'codex' ? llmApiModel.rpmLimit : undefined,
    codexConcurrencyLimit: llmApiModel?.key === 'codex' ? llmApiModel.concurrencyLimit : undefined,
    codexRequiresExtendedReview: llmApiModel?.key === 'codex' && llmApiBudgetUsd ? llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel) : undefined,
    storageExtended,
    storageExtensionCost,
    retentionExpiresAt: createRetentionExpiresAt(createdAt, storageExtended),
    standardProcessingHours: payload.type === 'pro'
      ? PRO_STANDARD_PROCESSING_HOURS
      : llmApiBudgetUsd && llmApiModel
        ? (llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel) ? LLM_API_EXTENDED_PROCESSING_HOURS : LLM_API_STANDARD_PROCESSING_HOURS)
        : undefined,
    processingDueAt: llmApiBudgetUsd && llmApiModel ? createProcessingDueAt(createdAt, payload.type, expedited) : createProcessingDueAt(createdAt, payload.type, expedited),
    expedited,
    expediteCost,
    contextAppendCost: payload.type === 'pro' ? PRO_CONTEXT_APPEND_COST : undefined,
    contextAppendUntil: createRetentionExpiresAt(createdAt, storageExtended),
    postApprovalSupplementLimit: payload.type === 'pro' ? 1 : undefined,
    postApprovalSupplementCount: payload.type === 'pro' ? 0 : undefined,
    createdAt,
  }

  ensureApplications(state).unshift(application)
  if (payload.shareToSquare && squarePostId) {
    ensureSquarePosts(state).unshift({
      id: squarePostId,
      userId: user.id,
      type: 'application_template',
      title,
      content: sanitizeWorkerRichText(payload.squarePostContent || description),
      applicationId: application.id,
      requestType: payload.type,
      template: {
        type: payload.type,
        title,
        description,
        githubRepo: payload.githubRepo,
        extendStorage: payload.extendStorage,
        expediteProcessing: payload.expediteProcessing,
        llmApiModelKey: payload.llmApiModelKey,
        llmApiBudgetUsd: payload.llmApiBudgetUsd,
        llmApiCustomRpmLimit: payload.llmApiCustomRpmLimit,
        llmApiCustomTpmLimit: payload.llmApiCustomTpmLimit,
      },
      createdAt,
      updatedAt: createdAt,
    })
  }

  if (application.cost > 0) {
    await appendTrustedPointTransaction(env, state, {
      id: transactionId('application_cost', application.id),
      userId: user.id,
      delta: -application.cost,
      type: 'spend',
      reason: `${payload.type.toUpperCase()} 申请预扣`,
      refId: application.id,
      createdAt,
    })
  }
  if (storageExtensionCost > 0) {
    await appendTrustedPointTransaction(env, state, {
      id: transactionId('storage_extension', application.id),
      userId: user.id,
      delta: -storageExtensionCost,
      type: 'spend',
      reason: '延长申请存储服务 7 天预扣',
      refId: application.id,
      createdAt,
    })
  }
  if (expediteCost > 0) {
    await appendTrustedPointTransaction(env, state, {
      id: transactionId('expedite', application.id),
      userId: user.id,
      delta: -expediteCost,
      type: 'spend',
      reason: 'Pro 处理加速预扣',
      refId: application.id,
      createdAt,
    })
  }

  return application
}

async function applyResourceApplicationCommand(env: WorkerEnv, state: Partial<WelfareState>, user: User, payload: SubmitResourceApplicationPayload & { applicationId?: string }) {
  const title = payload.title.trim()
  const createdAt = now()
  const isDraft = !!payload.saveAsDraft
  const resourceTypes = Array.from(new Set(payload.selectedResourceTypes))
  if (!title)
    throw new Error('请填写申请标题')
  if (!isDraft && !payload.reason.trim())
    throw new Error('请填写申请说明')
  if (totalResourceApplicationAttachmentBytes(payload) > MAX_ATTACHMENT_BYTES)
    throw new Error('附件总大小不能超过 200MB')
  if (!resourceTypes.length)
    throw new Error('请至少选择一种资源类型')
  for (const resourceType of resourceTypes)
    assertResourceTypeCanApplyForState(state, resourceType, user)
  for (const item of payload.resourceItems)
    assertResourceTypeCanApplyForState(state, item.resourceType, user)
  if (!payload.resourceItems.length)
    throw new Error('请至少添加一条资源明细')
  assertCanCreateRequestForState(state, user.id)

  if (!isDraft) {
    assertApplicationPolicyForState(state, {
      userId: user.id,
      type: 'resource',
      title,
      description: buildResourceDescription(payload, sanitizeWorkerRichText),
      createdAt,
      powNonce: payload.powNonce,
      turnstileVerified: payload.turnstileVerified,
    })
  }

  const applications = ensureApplications(state)
  const existing = payload.applicationId
    ? applications.find(item => item.id === payload.applicationId)
    : undefined
  if (payload.applicationId && (!existing || existing.type !== 'resource'))
    throw new Error('资源申请不存在')
  if (existing && existing.userId !== user.id)
    throw new Error('只能编辑自己的草稿')
  if (existing && existing.status !== 'draft')
    throw new Error('提交后申请内容不可修改')

  const applicationId = existing?.id ?? createId('app')
  const resourceItems = normalizeResourceItems(applicationId, payload.resourceItems, createdAt, !isDraft)
  const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
  const checkout = isDraft
    ? undefined
    : resourceCheckoutSnapshotForState(state, user.id, payload.resourceItems, payload.couponId, createdAt, !!payload.shareToSquare)
  const promotionName = checkout && checkout.activityDiscountAmount > 0 ? resourceActivityPromotionName(payload.resourceItems, createdAt) : undefined
  if (checkout && user.points < checkout.cost)
    throw new Error(`积分不足，本单需要预扣 ${checkout.cost} 积分`)

  const rejectionReviewFeeWaived = !!payload.waiveRejectionReviewFee
  const waiveBlockedUntil = rejectionReviewFeeWaived ? rejectionFeeWaiverBlockedUntilForState(state, user.id) : ''
  if (rejectionReviewFeeWaived && waiveBlockedUntil)
    throw new Error(`认真填写承诺暂不可用，请在 ${waiveBlockedUntil} 后再勾选`)

  const termsAcceptances = isDraft
    ? []
    : buildResourceTermsAcceptances(actualResourceTypes, payload.acceptedTermIds, user.id, createdAt)
  const squarePostId = !isDraft && payload.shareToSquare ? createId('square') : undefined
  const application: WelfareApplication = {
    id: applicationId,
    userId: user.id,
    type: 'resource',
    title,
    description: buildResourceDescription(payload, sanitizeWorkerRichText),
    hasOpenSourceBadge: false,
    attachments: attachmentsFromPayload(payload.attachments),
    status: isDraft ? 'draft' : 'in_review',
    baseCost: checkout?.baseCost ?? 0,
    cost: checkout?.cost ?? 0,
    costCharged: !isDraft,
    couponId: checkout?.coupon?.id,
    couponName: checkout?.coupon?.name,
    couponDiscountRate: checkout?.coupon?.discountRate,
    couponDiscountAmount: checkout?.couponDiscountAmount,
    sharedToSquare: !isDraft && !!payload.shareToSquare,
    squarePostId,
    squareDiscountRate: checkout?.squareDiscountRate,
    squareDiscountAmount: checkout?.squareDiscountAmount,
    pricingDiscountRate: checkout?.activityDiscountRate ?? 1,
    pricingPromotionName: promotionName,
    pricingPromotionEndsAt: checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_END_AT : undefined,
    pricingAppliedAt: createdAt,
    aiReviewFeeRate: REJECTION_REVIEW_FEE_RATE,
    rejectionReviewFee: 0,
    rejectionReviewFeeWaived,
    rejectionFraudulent: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: createRetentionExpiresAt(createdAt, false),
    standardProcessingHours: 72,
    processingDueAt: createProcessingDueAt(createdAt, 'resource'),
    contextAppendUntil: createRetentionExpiresAt(createdAt, false),
    departmentId: payload.departmentId?.trim() || undefined,
    projectId: payload.projectId?.trim() || undefined,
    reason: payload.reason.trim(),
    businessBackground: payload.businessBackground.trim(),
    urgency: payload.urgency,
    expectedEffectiveAt: payload.expectedEffectiveAt,
    costCenter: payload.costCenter?.trim() || undefined,
    ownerId: payload.ownerId?.trim() || user.id,
    selectedResourceTypes: actualResourceTypes,
    resourceItems,
    termsAcceptances,
    submittedAt: isDraft ? undefined : createdAt,
    createdAt: existing?.createdAt ?? createdAt,
  }

  if (existing) {
    Object.assign(existing, application)
  }
  else {
    applications.unshift(application)
  }

  if (!isDraft) {
    if (application.cost > 0) {
      await appendTrustedPointTransaction(env, state, {
        id: transactionId('application_cost', application.id),
        userId: user.id,
        delta: -application.cost,
        type: 'spend',
        reason: '资源申请订单预扣',
        refId: application.id,
        createdAt,
      })
    }
    if (checkout?.coupon) {
      checkout.coupon.usedAt = createdAt
      checkout.coupon.usedFor = 'resource_application'
      checkout.coupon.usedRefId = application.id
      checkout.coupon.usedApplicationId = application.id
    }
    if (squarePostId)
      ensureSquarePosts(state).unshift(buildResourceSquarePost(application, payload, actualResourceTypes, squarePostId, createdAt, sanitizeWorkerRichText))
  }

  ensureCoupons(state)
  return application
}

export async function handleApplicationSubmitRequest(request: Request, env: WorkerEnv) {
  try {
    if (request.method !== 'POST')
      return json({ error: 'Method Not Allowed' }, 405)

    const userId = await requestUserId(request, env)
    if (!userId)
      throw new Error('请先登录')

    const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
    const mutableState = state as Partial<WelfareState>
    const originalState = cloneState(mutableState)
    const user = stateUsers(mutableState).find(item => item.id === userId && item.accountStatus !== 'suspended')
    if (!user)
      throw new Error('请先登录')

    const payload = await readPayload(request) as SubmitApplicationPayload & SubmitResourceApplicationPayload & { type?: string, applicationId?: string }
    const application = payload.type === 'resource'
      ? await applyResourceApplicationCommand(env, mutableState, user, payload as SubmitResourceApplicationPayload & { applicationId?: string })
      : await applyStandardApplicationCommand(env, mutableState, user, payload as SubmitApplicationPayload)
    const result = await commitActionState(env, originalState, mutableState, version)
    return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
  }
  catch (error) {
    return errorResponse(error)
  }
}

async function commitCurrentUserAction(
  request: Request,
  env: WorkerEnv,
  mutate: (state: Partial<WelfareState>, user: User, payload: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const mutableState = state as Partial<WelfareState>
  const originalState = cloneState(mutableState)
  const user = stateUsers(mutableState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  const payload = await readPayload(request) as Record<string, unknown>
  const body = await mutate(mutableState, user, payload)
  const result = await commitActionState(env, originalState, mutableState, version)
  return json({ ok: true, ...(body ?? {}), version: result.version })
}

export async function updateCurrentProfileAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (_state, user, payload) => {
    const profile = isRecord(payload.profile) ? payload.profile : payload
    user.profile = {
      ...user.profile,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : user.profile.displayName,
      email: typeof profile.email === 'string' ? profile.email : user.profile.email,
      bio: typeof profile.bio === 'string' ? profile.bio : user.profile.bio,
      selectedRepo: typeof profile.selectedRepo === 'string' ? profile.selectedRepo : user.profile.selectedRepo,
    }
  })
}

export async function checkInTodayAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, async (state, user) => {
    const createdAt = now()
    const dateKey = localDateKey(new Date(createdAt))
    const checkIns = ensureDailyCheckIns(state)
    if (checkIns.some(item => item.userId === user.id && item.dateKey === dateKey))
      throw new Error('今日已签到')

    const lastCheckIn = checkIns
      .filter(item => item.userId === user.id && item.dateKey < dateKey)
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey))[0]
    const streak = lastCheckIn?.dateKey === shiftDateKey(dateKey, -1) ? lastCheckIn.streak + 1 : 1
    const points = rollDailyCheckInPoints()
    const coupons: UserCoupon[] = []
    if (streak === 3)
      coupons.push(createDailyCoupon(user.id, 'daily_streak_3', 0.8, createdAt))
    if (streak > 0 && streak % 7 === 0)
      coupons.push(createDailyCoupon(user.id, 'daily_streak_7', 0.5, createdAt))
    ensureCoupons(state).unshift(...coupons)

    const checkIn: DailyCheckIn = {
      id: createId('checkin'),
      userId: user.id,
      dateKey,
      points,
      streak,
      couponIds: coupons.map(coupon => coupon.id),
      createdAt,
    }
    checkIns.unshift(checkIn)
    await appendTrustedPointTransaction(env, state, {
      id: transactionId('daily_checkin', checkIn.id),
      userId: user.id,
      delta: points,
      type: 'grant',
      reason: `每日签到奖励（连续 ${streak} 天）`,
      refId: checkIn.id,
      createdAt,
    })
    return { checkIn }
  })
}

export async function bindInvitationCodeAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const normalizedCode = normalizeInviteCode(payload.code)
    if (!normalizedCode)
      throw new Error('请填写邀请码')
    const bindings = ensureInvitationBindings(state)
    if (bindings.some(item => item.inviteeUserId === user.id))
      throw new Error('你已经绑定过邀请人')
    const deadline = new Date(addHours(user.createdAt, INVITATION_BIND_WINDOW_HOURS)).getTime()
    if (Number.isFinite(deadline) && Date.now() > deadline)
      throw new Error(`注册超过 ${INVITATION_BIND_WINDOW_HOURS} 小时，无法再绑定邀请人`)

    const inviter = stateUsers(state).find(item => normalizeInviteCode(item.profile.inviteCode || createUserInviteCode(item.id)) === normalizedCode)
    if (!inviter)
      throw new Error('邀请码不存在')
    if (inviter.id === user.id)
      throw new Error('不能绑定自己的邀请码')

    const binding: InvitationBinding = {
      id: createId('invite'),
      inviterUserId: inviter.id,
      inviteeUserId: user.id,
      inviteCode: normalizedCode,
      createdAt: now(),
    }
    bindings.unshift(binding)
    return { binding }
  })
}

export async function vouchInvitationAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const binding = ensureInvitationBindings(state).find(item => item.id === payload.bindingId)
    if (!binding)
      throw new Error('邀请关系不存在')
    const createdAt = now()
    if (binding.inviterUserId === user.id) {
      binding.inviterVouchedAt = createdAt
      return { binding }
    }
    if (binding.inviteeUserId === user.id) {
      binding.inviteeVouchedAt = createdAt
      return { binding }
    }
    throw new Error('只能为自己的邀请关系担保')
  })
}

export async function redeemCouponCodeAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const codeText = normalizeInviteCode(payload.code)
    if (!codeText)
      throw new Error('请输入兑换码')
    const code = (state.couponCodes ?? []).find(item => item.code === codeText)
    if (!code || !code.enabled)
      throw new Error('兑换码无效')
    if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now())
      throw new Error('兑换码已过期')
    if (code.redeemedCount >= code.maxRedemptions)
      throw new Error('兑换码次数已用完')
    const template = (state.couponTemplates ?? []).find(item => item.id === code.templateId)
    if (!template || !template.enabled)
      throw new Error('优惠券已停用')
    state.couponRedemptions ??= []
    const userRedeemedCount = state.couponRedemptions.filter(item => item.codeId === code.id && item.userId === user.id).length
    if (userRedeemedCount >= code.perUserLimit)
      throw new Error('该兑换码已达到你的兑换上限')

    const coupon = createUserCouponFromRule(user.id, 'redemption_code', template, now(), code.id)
    code.redeemedCount += 1
    template.grantedCount += 1
    ensureCoupons(state).unshift(coupon)
    state.couponRedemptions.unshift({
      id: createId('cdr'),
      codeId: code.id,
      templateId: template.id,
      userId: user.id,
      couponId: coupon.id,
      redeemedAt: coupon.createdAt,
    })
    return { coupon }
  })
}

export async function boostSquarePostAction(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const mutableState = state as Partial<WelfareState>
  const originalState = cloneState(mutableState)
  const user = stateUsers(mutableState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  const payload = await readPayload(request) as Record<string, unknown>
  const postId = typeof payload.postId === 'string' ? payload.postId : ''
  const post = ensureSquarePosts(mutableState).find(item => item.id === postId)
  if (!post)
    throw new Error('广场内容不存在')
  if (post.userId === user.id)
    throw new Error('不能为自己的广场内容拼一刀')
  const boosts = ensureSquareBoosts(mutableState)
  const existingBoost = boosts.find(item => item.postId === postId && item.userId === user.id)
  if (existingBoost)
    return json({ ok: true, boost: existingBoost, version })

  const createdAt = now()
  const dailyBoostCount = boosts.filter(item =>
    item.userId === user.id
    && (item.mode ?? 'boost') === 'boost'
    && localDateKey(item.createdAt) === localDateKey(createdAt),
  ).length
  if (dailyBoostCount >= SQUARE_DAILY_BOOST_LIMIT)
    throw new Error(`今日助力机会已用完，每人每天最多 ${SQUARE_DAILY_BOOST_LIMIT} 次`)
  const declaration = sanitizeWorkerRichText(payload.declaration)
  if (richTextToPlainText(declaration).trim().length < 20)
    throw new Error('助力宣言至少 20 字，请说明为什么支持这个领域')

  const boost: SquareBoost = {
    id: createId('boost'),
    postId,
    userId: user.id,
    mode: 'boost',
    declaration,
    pointsGranted: SQUARE_BOOST_REWARD_POINTS,
    createdAt,
  }
  boosts.unshift(boost)
  user.points += SQUARE_BOOST_REWARD_POINTS
  const result = await commitActionStateWithPointTransactions(env, originalState, mutableState, version, [{
    id: transactionId('square_boost', `${postId}_${user.id}`),
    userId: user.id,
    delta: SQUARE_BOOST_REWARD_POINTS,
    type: 'grant',
    reason: '广场拼一刀助力奖励',
    refId: boost.id,
    balanceAfter: user.points,
    createdAt,
  }])
  return json({ ok: true, boost, ...stateVersionPayload(result.version) })
}

export async function reportSquareBoostAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, async (state, user, payload) => {
    const boostId = typeof payload.boostId === 'string' ? payload.boostId : ''
    const boost = ensureSquareBoosts(state).find(item => item.id === boostId)
    if (!boost)
      throw new Error('助力记录不存在')
    if ((boost.mode ?? 'boost') === 'post_approval_vote')
      throw new Error('结束后助力投票不产生奖惩，不支持举报扣分')
    if (boost.userId === user.id)
      throw new Error('不能举报自己的助力宣言')
    const reports = ensureSquareReports(state)
    if (reports.some(item => item.boostId === boostId && item.reporterId === user.id))
      throw new Error('你已经举报过该助力宣言')
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    if (reason.length < 6)
      throw new Error('请说明举报理由')

    const createdAt = now()
    const report: SquareReport = {
      id: createId('report'),
      postId: boost.postId,
      boostId,
      reporterId: user.id,
      reason,
      createdAt,
    }
    boost.reportedAt = createdAt
    boost.reportReason = reason
    boost.reportedBy = user.id
    boost.cooldownUntil = addDays(createdAt, SQUARE_BOOST_REPORT_COOLDOWN_DAYS)
    if (!boost.penaltyApplied) {
      await appendTrustedPointTransaction(env, state, {
        id: transactionId('square_report_penalty', boost.id),
        userId: boost.userId,
        delta: -SQUARE_BOOST_REPORT_PENALTY_POINTS,
        type: 'spend',
        reason: '广场助力被举报扣除积分',
        refId: boost.id,
        createdAt,
        allowDebt: true,
      })
      boost.penaltyApplied = true
    }
    const post = ensureSquarePosts(state).find(item => item.id === boost.postId)
    if (post) {
      post.penaltyCount = (post.penaltyCount || 0) + 1
      post.lastPenaltyAt = createdAt
      post.updatedAt = createdAt
    }
    reports.unshift(report)
    return { report }
  })
}

export async function submitApplicationSupplementAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const applicationId = typeof payload.applicationId === 'string' ? payload.applicationId : ''
    const application = stateApplications(state).find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.userId !== user.id)
      throw new Error('只能补充自己的申请材料')
    if (!['needs_supplement', 'answered', 'pending_allocation', 'delivered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持补充材料')
    if (['submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status) && application.type !== 'resource')
      throw new Error('只有资源工单支持该阶段补充材料')
    if (['answered', 'pending_allocation', 'delivered'].includes(application.status)) {
      if (application.type !== 'pro')
        throw new Error('只有 Pro 申请通过后支持免费补充材料')
      const limit = application.postApprovalSupplementLimit ?? 0
      const count = application.postApprovalSupplementCount ?? 0
      if (count >= limit)
        throw new Error('本次 Pro 申请的免费补充次数已用完')
      application.postApprovalSupplementCount = count + 1
    }

    const content = sanitizeWorkerRichText(payload.content)
    if (isRichTextEmpty(content))
      throw new Error('请填写补充材料内容')
    const attachments = attachmentsFromPayload(payload.attachments)
    if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')

    pushApplicationMessage(application, user.id, 'supplement', content, attachments)
    if (application.status === 'needs_supplement')
      application.status = application.type === 'resource' ? 'in_review' : 'pending_review'
    return { applicationId: application.id }
  })
}

export async function submitStudentVerificationAction(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const mutableState = state as Partial<WelfareState>
  const originalState = cloneState(mutableState)
  const user = stateUsers(mutableState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  const input = await readPayload(request) as unknown as SubmitStudentPayload
  const clientRequestId = normalizeClientRequestId(input.clientRequestId)
  if (!clientRequestId)
    throw new Error('提交认证缺少幂等请求 ID，请刷新后重试')
  const verificationId = await studentVerificationIdForRequest(user.id, clientRequestId)
  const reviewTransactionId = transactionId('student_review', verificationId)
  const existingVerification = ensureStudentVerifications(mutableState).find(item => item.id === verificationId)
  if (existingVerification) {
    if (existingVerification.userId !== user.id)
      throw new Error('认证申请不存在')
    return json({ ok: true, verificationId: existingVerification.id, version })
  }
  const reviewFeeAlreadyCharged = await hasPointTransaction(env, reviewTransactionId)

  const verificationType = normalizeVerificationType(input.verificationType)
  const systemConfig = mutableState.systemConfig
  const feature = systemConfig?.verification?.[verificationType]
  if (systemConfig && !systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (feature && !feature.enabled)
    throw new Error(feature.reason || `${verificationTypeLabel(verificationType)}暂未开放`)

  const realName = input.realName.trim()
  if (!realName)
    throw new Error('请填写真实姓名')
  if (!input.category.trim())
    throw new Error('请填写认证类目')
  const notes = sanitizeWorkerRichText(input.notes)
  if (isRichTextEmpty(notes))
    throw new Error('请填写认证材料说明')
  const educationEmail = input.educationEmail?.trim() ? normalizeStudentEmail(input.educationEmail) : undefined
  if (educationEmail)
    assertEducationEmail(educationEmail)
  const attachments = attachmentsFromPayload(input.attachments)
  if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
    throw new Error('材料附件总大小不能超过 200MB')
  if (!reviewFeeAlreadyCharged) {
    assertCanCreateRequestForState(mutableState, user.id)
    if (user.points < STUDENT_REVIEW_FEE)
      throw new Error('积分不足')
  }

  const emailChallenge = educationEmail
    ? (mutableState.educationEmailChallenges ?? []).find(item =>
        item.id === input.educationEmailChallengeId
        && item.userId === user.id
        && item.email === educationEmail,
      ) ?? latestEducationEmailChallengeForState(mutableState, user.id, educationEmail)
    : undefined
  if (educationEmail)
    assertVerifiedEducationEmailChallengeForState(emailChallenge, !!input.educationEmailVerified)

  const createdAt = now()
  const balanceAfter = reviewFeeAlreadyCharged ? user.points : user.points - STUDENT_REVIEW_FEE
  const verification: StudentVerification = {
    id: verificationId,
    userId: user.id,
    verificationType,
    realName,
    category: input.category.trim(),
    school: input.school?.trim(),
    identity: input.identity?.trim(),
    grade: input.grade?.trim(),
    educationLevel: input.educationLevel?.trim(),
    educationEmail,
    educationEmailVerified: !!emailChallenge?.verifiedAt,
    educationEmailVerifiedAt: emailChallenge?.verifiedAt,
    educationEmailVerificationSource: emailChallenge?.verifiedAt ? 'mail_auto' : undefined,
    educationEmailChallengeId: emailChallenge?.id,
    notes,
    attachments,
    status: 'pending',
    reviewFee: STUDENT_REVIEW_FEE,
    feeReturned: false,
    createdAt,
  }
  user.points = balanceAfter
  ensureStudentVerifications(mutableState).unshift(verification)
  if (emailChallenge)
    emailChallenge.submittedAt = verification.createdAt

  const result = reviewFeeAlreadyCharged
    ? await commitActionState(env, originalState, mutableState, version)
    : await commitActionStateWithPointTransactions(env, originalState, mutableState, version, [{
        id: reviewTransactionId,
        userId: user.id,
        delta: -STUDENT_REVIEW_FEE,
        type: 'spend',
        reason: `${verificationTypeLabel(verificationType)}审核费`,
        refId: verification.id,
        balanceAfter,
        createdAt,
      }])
  return json({ ok: true, verificationId: verification.id, ...stateVersionPayload(result.version) })
}

export async function submitAdminStudentVerificationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const input = payload as unknown as SubmitStudentPayload & { userId?: string }
    const targetUserId = typeof input.userId === 'string' ? input.userId.trim() : ''
    const targetUser = stateUsers(state).find(item => item.id === targetUserId && item.accountStatus !== 'suspended')
    if (!targetUser)
      throw new Error('请选择有效用户')

    const verificationType = normalizeVerificationType(input.verificationType)
    const realName = input.realName.trim()
    if (!realName)
      throw new Error('请填写真实姓名')
    if (!input.category.trim())
      throw new Error('请填写认证类目')
    const notes = sanitizeWorkerRichText(input.notes)
    if (isRichTextEmpty(notes))
      throw new Error('请填写认证材料说明')
    const educationEmail = input.educationEmail?.trim() ? normalizeStudentEmail(input.educationEmail) : undefined
    if (educationEmail)
      assertEducationEmail(educationEmail)
    const attachments = attachmentsFromPayload(input.attachments)
    if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')

    const createdAt = now()
    const verification: StudentVerification = {
      id: createId('stu'),
      userId: targetUser.id,
      verificationType,
      realName,
      category: input.category.trim(),
      school: input.school?.trim(),
      identity: input.identity?.trim(),
      grade: input.grade?.trim(),
      educationLevel: input.educationLevel?.trim(),
      educationEmail,
      educationEmailVerified: !!input.educationEmailVerified,
      educationEmailVerifiedAt: input.educationEmailVerified ? createdAt : undefined,
      educationEmailVerificationSource: input.educationEmailVerified ? 'admin_approved' : undefined,
      notes: `${notes}<p><strong>管理员代提交：</strong>${admin.profile.displayName || admin.profile.email || admin.id}</p>`,
      attachments,
      status: 'pending',
      reviewFee: 0,
      feeReturned: true,
      createdAt,
    }
    ensureStudentVerifications(state).unshift(verification)
    return { verificationId: verification.id }
  })
}

export async function supplementStudentVerificationAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const input = payload as unknown as SubmitStudentPayload
    if (!input.verificationId)
      throw new Error('认证申请不存在')
    const verification = ensureStudentVerifications(state).find(item => item.id === input.verificationId && item.userId === user.id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'needs_supplement')
      throw new Error('该认证申请暂不需要补充资料')

    const realName = input.realName.trim()
    if (!realName)
      throw new Error('请填写真实姓名')
    if (!input.category.trim())
      throw new Error('请填写认证类目')
    const notes = sanitizeWorkerRichText(input.notes)
    if (isRichTextEmpty(notes))
      throw new Error('请填写认证材料说明')
    const educationEmail = input.educationEmail?.trim() ? normalizeStudentEmail(input.educationEmail) : undefined
    if (educationEmail)
      assertEducationEmail(educationEmail)
    const emailChallenge = educationEmail
      ? (state.educationEmailChallenges ?? []).find(item =>
          item.id === input.educationEmailChallengeId
          && item.userId === user.id
          && item.email === educationEmail,
        ) ?? latestEducationEmailChallengeForState(state, user.id, educationEmail)
      : undefined
    if (educationEmail)
      assertVerifiedEducationEmailChallengeForState(emailChallenge, !!input.educationEmailVerified)
    const newAttachments = attachmentsFromPayload(input.attachments)
    if (totalAttachmentBytes([...(verification.attachments ?? []), ...newAttachments]) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')

    const supplementedAt = now()
    verification.realName = realName
    verification.category = input.category.trim()
    verification.school = input.school?.trim()
    verification.identity = input.identity?.trim()
    verification.grade = input.grade?.trim()
    verification.educationLevel = input.educationLevel?.trim()
    verification.educationEmail = educationEmail
    verification.educationEmailVerified = !!emailChallenge?.verifiedAt
    verification.educationEmailVerifiedAt = emailChallenge?.verifiedAt
    verification.educationEmailVerificationSource = emailChallenge?.verifiedAt ? 'mail_auto' : undefined
    verification.educationEmailChallengeId = emailChallenge?.id
    verification.notes = appendWorkerStudentSupplementNotes(verification.notes, notes, supplementedAt)
    verification.attachments = [...(verification.attachments ?? []), ...newAttachments]
    verification.status = 'pending'
    verification.reply = undefined
    verification.supplementedAt = supplementedAt
    verification.reviewedAt = undefined
    if (emailChallenge)
      emailChallenge.submittedAt = supplementedAt
    return { verificationId: verification.id }
  })
}

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

function isDeliveryApplication(application: WelfareApplication) {
  return ['code', 'pro'].includes(application.type)
    && ['answered', 'pending_allocation', 'delivered'].includes(application.status)
    && !application.deliveryRewardedAt
}

function canClaimDeliveryApplication(application: WelfareApplication, user: User) {
  return user.role === 'reviewer'
    && user.accountStatus !== 'suspended'
    && isDeliveryApplication(application)
    && !application.deliveryAssigneeId
    && application.userId !== user.id
}

async function commitActionState(env: WorkerEnv, previousState: Partial<WelfareState>, nextState: Partial<WelfareState>, expectedVersion?: number) {
  const retained = syncStudentVerifiedProfiles(applyWelfareRetentionPolicy(nextState).state)
  if (isRecord(retained))
    delete retained.currentUserId
  const version = await writeWelfareState(env, retained, { ...(expectedVersion === undefined ? {} : { expectedVersion }), previousState })
  await dispatchWelfareStateChangeNotifications(env, previousState, retained)
  return { state: retained, version }
}

export async function commitActionStateWithPointTransactions(
  env: WorkerEnv,
  previousState: Partial<WelfareState>,
  nextState: Partial<WelfareState>,
  expectedVersion: number,
  pointTransactions: AtomicPointTransaction[],
) {
  const retained = syncStudentVerifiedProfiles(applyWelfareRetentionPolicy(nextState).state)
  if (isRecord(retained))
    delete retained.currentUserId
  const version = await writeWelfareStateWithAtomicPointTransactions(env, retained, pointTransactions, { expectedVersion, previousState })
  await dispatchWelfareStateChangeNotifications(env, previousState, retained)
  return { state: retained, version }
}

export async function bootstrapAdmin(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  const users = Array.isArray(state.users) ? state.users : []
  if (users.some(user => user.role === 'admin'))
    throw new Error('管理员已经创建')

  const payload = await readPayload(request) as { displayName?: string, email?: string, password?: string }
  const email = normalizeEmail(payload.email)
  if (!email)
    throw new Error('请填写管理员邮箱')

  const password = assertPassword(payload.password)
  const adminId = createId('admin')
  const admin: User = {
    id: adminId,
    role: 'admin',
    profile: {
      displayName: payload.displayName?.trim() || '公益管理员',
      email,
      inviteCode: createUserInviteCode(adminId),
      githubAuthorized: false,
      studentVerified: false,
    },
    points: 0,
    passwordHash: await hashPassword(password),
    accountStatus: 'active',
    createdAt: now(),
    lastLoginAt: now(),
  }

  const nextState = {
    ...state,
    users: [admin],
    currentUserId: undefined,
    applications: [],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    collaborationApplications: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    createdAt: state.createdAt || now(),
  }
  await writeWelfareState(env, nextState)
  return json({ ok: true })
}

export async function loginAdmin(request: Request, env: WorkerEnv) {
  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  const users = Array.isArray(state.users) ? state.users : []
  const payload = await readPayload(request) as { email?: string, password?: string }
  const email = normalizeEmail(payload.email)
  assertLoginAllowed(request, email)
  const admin = users.find(user => user.role === 'admin' && normalizeEmail(user.profile.email) === email)
  const passwordResult = admin
    ? await verifyPassword(typeof payload.password === 'string' ? payload.password : '', admin.passwordHash)
    : { ok: false, needsRehash: false }
  if (!admin || !passwordResult.ok) {
    recordLoginFailure(request, email)
    throw new Error('管理员账号或密码错误')
  }

  clearLoginFailures(request, email)
  if (passwordResult.needsRehash)
    admin.passwordHash = await hashPassword(typeof payload.password === 'string' ? payload.password : '')
  admin.lastLoginAt = now()
  delete state.currentUserId
  const version = await writeWelfareState(env, state, { expectedVersion: record.version })
  return json({ ok: true, userId: admin.id, state: clientVisibleWelfareState(state, admin.id), version }, 200, {
    'set-cookie': await createSessionCookie(request, env, admin.id),
  })
}

export async function submitCollaborationApplication(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  if (user.role === 'admin' || user.role === 'reviewer')
    throw new Error('当前账号已经具备协作处理权限')

  const payload = await readPayload(request) as { reason?: string }
  const reason = sanitizeWorkerRichText(payload.reason)
  if (richTextToPlainText(reason).length < COLLABORATION_APPLICATION_MIN_REASON_CHARS)
    throw new Error(`申请说明不得少于 ${COLLABORATION_APPLICATION_MIN_REASON_CHARS} 字`)

  const applications = ensureCollaborationApplications(previousState)
  if (applications.some(item => item.userId === user.id && item.status === 'pending'))
    throw new Error('已有待审核的协作处理员申请')

  const application = {
    id: createId('coa'),
    userId: user.id,
    reason,
    status: 'pending' as const,
    createdAt: now(),
  }
  applications.unshift(application)
  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, application, ...stateVersionPayload(result.version) })
}

export async function reviewCollaborationApplication(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertAdminUser(user)

  const payload = await readPayload(request) as { id?: string, status?: string, reply?: string }
  if (payload.status !== 'approved' && payload.status !== 'rejected')
    throw new Error('请选择有效的审核结果')

  const applications = ensureCollaborationApplications(previousState)
  const application = applications.find(item => item.id === payload.id)
  if (!application)
    throw new Error('协作处理员申请不存在')
  if (application.status !== 'pending')
    throw new Error('该协作处理员申请已经处理')

  application.status = payload.status
  application.reply = sanitizeWorkerRichText(payload.reply) || (payload.status === 'approved' ? '申请已通过，已开通协作处理员权限。' : '申请未通过，请完善资料后再试。')
  application.reviewedBy = user.id
  application.reviewedAt = now()

  if (payload.status === 'approved') {
    const targetUser = stateUsers(previousState).find(item => item.id === application.userId)
    if (!targetUser)
      throw new Error('申请用户不存在')
    if (targetUser.role !== 'admin')
      targetUser.role = 'reviewer'
  }

  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, application, ...stateVersionPayload(result.version) })
}

export async function claimDeliveryApplication(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertReviewerUser(user)
  if (user.role !== 'reviewer')
    throw new Error('需要协作处理员权限')

  const payload = await readPayload(request) as { applicationId?: string }
  const application = stateApplications(previousState).find(item => item.id === payload.applicationId)
  if (!application)
    throw new Error('申请不存在')
  if (!canClaimDeliveryApplication(application, user))
    throw new Error('该任务当前不可认领')

  application.deliveryAssigneeId = user.id
  application.deliveryClaimedAt = now()
  application.deliveryReviewStatus = undefined

  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
}

export async function cancelDeliveryClaim(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertReviewerUser(user)

  const payload = await readPayload(request) as { applicationId?: string }
  const application = stateApplications(previousState).find(item => item.id === payload.applicationId)
  if (!application)
    throw new Error('申请不存在')
  if (application.deliveryAssigneeId !== user.id && user.role !== 'admin')
    throw new Error('只能取消自己认领的任务')
  if (application.deliveryReviewStatus === 'pending_review')
    throw new Error('交付结果正在复核，不能取消认领')
  if (application.deliveryRewardedAt)
    throw new Error('该任务已发放奖励')

  application.deliveryAssigneeId = undefined
  application.deliveryClaimedAt = undefined
  application.deliverySubmittedAt = undefined
  application.deliveryReviewStatus = undefined

  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
}

export async function submitDeliveryResult(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertReviewerUser(user)
  if (user.role !== 'reviewer')
    throw new Error('需要协作处理员权限')

  const payload = await readPayload(request) as { applicationId?: string, content?: string, attachments?: unknown }
  const application = stateApplications(previousState).find(item => item.id === payload.applicationId)
  if (!application)
    throw new Error('申请不存在')
  if (!isDeliveryApplication(application))
    throw new Error('该申请不在可交付状态')
  if (application.deliveryAssigneeId !== user.id)
    throw new Error('只能处理自己认领的任务')
  if (application.deliveryReviewStatus === 'pending_review')
    throw new Error('交付结果正在等待管理员复核')

  const content = sanitizeWorkerRichText(payload.content)
  if (isRichTextEmpty(content))
    throw new Error('请填写交付结果')
  const attachments = attachmentsFromPayload(payload.attachments)
  if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
    throw new Error('附件总大小不能超过 200MB')

  pushApplicationMessage(application, user.id, 'result_submission', content, attachments)
  application.deliverySubmittedAt = now()
  application.deliveryReviewStatus = 'pending_review'

  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
}

export async function reviewDeliveryResult(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertAdminUser(user)

  const payload = await readPayload(request) as { applicationId?: string, approved?: boolean, rewardPoints?: number, note?: string }
  const application = stateApplications(previousState).find(item => item.id === payload.applicationId)
  if (!application)
    throw new Error('申请不存在')
  if (application.deliveryReviewStatus !== 'pending_review')
    throw new Error('该任务没有待复核的交付结果')
  if (!application.deliveryAssigneeId)
    throw new Error('该任务没有协作处理员')
  if (application.deliveryRewardedAt)
    throw new Error('该任务已发放奖励')

  const note = sanitizeWorkerRichText(payload.note)
  if (!payload.approved) {
    application.deliveryAssigneeId = undefined
    application.deliveryClaimedAt = undefined
    application.deliverySubmittedAt = undefined
    application.deliveryReviewStatus = 'rejected'
    pushApplicationMessage(application, user.id, 'system', note || '<p>管理员复核未通过，任务已重新开放认领。</p>')
    const result = await commitActionState(env, originalState, previousState, record.version)
    return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
  }

  const rewardPoints = Math.trunc(Number(payload.rewardPoints))
  if (!Number.isFinite(rewardPoints) || rewardPoints < COLLABORATION_DELIVERY_REWARD_MIN || rewardPoints > COLLABORATION_DELIVERY_REWARD_MAX)
    throw new Error(`奖励积分必须是 ${COLLABORATION_DELIVERY_REWARD_MIN} 到 ${COLLABORATION_DELIVERY_REWARD_MAX} 的整数`)

  const reviewedAt = now()
  application.deliveryReviewStatus = 'approved'
  application.deliveryRewardPoints = rewardPoints
  application.deliveryRewardedAt = reviewedAt
  application.deliveryRewardedBy = user.id
  application.status = 'completed'
  application.completedAt = reviewedAt
  pushApplicationMessage(application, user.id, 'system', note || `<p>管理员已复核通过协作交付，发放 ${rewardPoints} 积分奖励。</p>`)

  await appendPointTransaction(env, {
    id: transactionId('delivery_reward', application.id),
    userId: application.deliveryAssigneeId,
    delta: rewardPoints,
    type: 'grant',
    reason: `${application.type.toUpperCase()} 协作交付奖励`,
    refId: application.id,
    createdAt: reviewedAt,
  }, previousState)
  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, applicationId: application.id, ...stateVersionPayload(result.version) })
}

function publicConfigPayload(state: unknown) {
  const applicationPolicy = isRecord(state) && isRecord(state.applicationPolicy)
    ? {
        ...state.applicationPolicy,
        turnstileSecretKey: maskSecret(state.applicationPolicy.turnstileSecretKey),
      }
    : undefined

  return {
    siteBanner: isRecord(state) ? state.siteBanner : undefined,
    systemConfig: isRecord(state) ? state.systemConfig : undefined,
    applicationPolicy,
    createdAt: isRecord(state) && typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString(),
  }
}

export async function publicConfigResponse(env: WorkerEnv) {
  const state = await readWelfareState(env)
  return json(publicConfigPayload(state))
}

async function visibleCurrentUserState(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const sourceState = state as Partial<WelfareState>
  const user = stateUsers(sourceState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  return {
    user,
    userId,
    version,
    state: clientVisibleWelfareState(sourceState, userId) as Partial<WelfareState>,
  }
}

export async function currentUserProfileResponse(request: Request, env: WorkerEnv) {
  const current = await visibleCurrentUserState(request, env)
  const currentUser = stateUsers(current.state).find(item => item.id === current.userId) ?? sanitizeUser(current.user)
  return json({ currentUser, currentUserId: current.userId, version: current.version })
}

export async function currentUserApplicationsResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const sourceState = state as Partial<WelfareState>
  const user = stateUsers(sourceState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  const url = new URL(request.url)
  const status = parseStatusParam(url.searchParams.get('status'))
  const limit = parsePositiveIntegerParam(url.searchParams.get('limit'), 50, 100)
  const offset = parseOffsetParam(url.searchParams.get('offset'))
  const hasExplicitSnapshotQuery = status.length > 0 || offset > 0 || url.searchParams.has('limit')
  const snapshotApplications = await readCurrentUserApplicationSnapshots(env, userId, { status, limit, offset })
  const fallbackApplications = sanitizeOwnedApplications(stateApplications(sourceState), userId)
    .filter(item => !status.length || status.includes(item.status))
    .slice(offset, offset + limit)
  const applications = snapshotApplications.length || hasExplicitSnapshotQuery
    ? snapshotApplications
    : fallbackApplications
  const visibleUserIds = new Set(applications.map(item => item.userId))
  visibleUserIds.add(userId)

  return json({
    applications,
    users: userVisibleFromIds(stateUsers(sourceState), visibleUserIds, userId),
    currentUserId: userId,
    version,
  })
}

export async function currentUserWalletResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const sourceState = state as Partial<WelfareState>
  const user = stateUsers(sourceState).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  const snapshotCoupons = await readCurrentUserCouponSnapshots(env, userId)
  const coupons = snapshotCoupons.length
    ? snapshotCoupons
    : (Array.isArray(sourceState.coupons) ? sourceState.coupons.filter(item => isRecord(item) && item.userId === userId) : [])

  return json({
    coupons,
    dailyCheckIns: Array.isArray(sourceState.dailyCheckIns) ? sourceState.dailyCheckIns.filter(item => isRecord(item) && item.userId === userId) : [],
    invitationBindings: Array.isArray(sourceState.invitationBindings)
      ? sourceState.invitationBindings.filter(item => isRecord(item) && (item.inviteeUserId === userId || item.inviterUserId === userId))
      : [],
    transactions: Array.isArray(sourceState.transactions) ? sourceState.transactions.filter(item => isRecord(item) && item.userId === userId) : [],
    currentUserId: userId,
    version,
  })
}

export async function currentUserVerificationResponse(request: Request, env: WorkerEnv) {
  const current = await visibleCurrentUserState(request, env)
  return json({
    studentVerifications: current.state.studentVerifications ?? [],
    educationEmailChallenges: current.state.educationEmailChallenges ?? [],
    currentUserId: current.userId,
    version: current.version,
  })
}

export async function squareStateResponse(request: Request, env: WorkerEnv) {
  const current = await visibleCurrentUserState(request, env)
  return json({
    squarePosts: current.state.squarePosts ?? [],
    squareBoosts: current.state.squareBoosts ?? [],
    squareReports: current.state.squareReports ?? [],
    applications: current.state.applications ?? [],
    users: current.state.users ?? [],
    currentUserId: current.userId,
    version: current.version,
  })
}

export async function collaborationStateResponse(request: Request, env: WorkerEnv) {
  const current = await visibleCurrentUserState(request, env)
  const applications = current.state.applications ?? []
  return json({
    collaborationApplications: current.state.collaborationApplications ?? [],
    claimableDeliveryApplications: applications.filter(item => canClaimDeliveryApplication(item, current.user)),
    currentUserDeliveryApplications: applications.filter(item => item.deliveryAssigneeId === current.userId && item.status !== 'completed'),
    pendingDeliveryReviewApplications: applications.filter(item => item.deliveryReviewStatus === 'pending_review'),
    crowdReviews: current.state.crowdReviews ?? [],
    currentUserId: current.userId,
    version: current.version,
  })
}

async function adminVisibleState(request: Request, env: WorkerEnv) {
  const userId = await requireRequestUserId(request, env)
  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const sourceState = state as Partial<WelfareState>
  const user = await authenticatedUser(request, env, sourceState)
  assertAdminUser(user)
  return {
    user,
    version,
    state: clientVisibleWelfareState(sourceState, user.id) as Partial<WelfareState>,
  }
}

export async function adminConfigResponse(request: Request, env: WorkerEnv) {
  const current = await adminVisibleState(request, env)
  return json({
    oauth: current.state.oauth,
    applicationPolicy: current.state.applicationPolicy,
    siteBanner: current.state.siteBanner,
    systemConfig: current.state.systemConfig,
    currentUserId: current.user.id,
    version: current.version,
  })
}

export async function adminApplicationsResponse(request: Request, env: WorkerEnv) {
  const current = await adminVisibleState(request, env)
  const url = new URL(request.url)
  const status = parseStatusParam(url.searchParams.get('status'))
  const limit = parsePositiveIntegerParam(url.searchParams.get('limit'), 100, 200)
  const offset = parseOffsetParam(url.searchParams.get('offset'))
  const hasExplicitSnapshotQuery = status.length > 0 || offset > 0 || url.searchParams.has('limit')
  const snapshotApplications = await readAdminApplicationSnapshots(env, { status, limit, offset })
  const fallbackApplications = stateApplications(current.state)
    .filter(item => !status.length || status.includes(item.status))
    .slice(offset, offset + limit)
  const applications = snapshotApplications.length || hasExplicitSnapshotQuery
    ? snapshotApplications
    : fallbackApplications
  const visibleUserIds = new Set(applications.map(item => item.userId))
  visibleUserIds.add(current.user.id)

  return json({
    applications,
    crowdReviews: current.state.crowdReviews ?? [],
    users: userVisibleFromIds(stateUsers(current.state), visibleUserIds, current.user.id),
    currentUserId: current.user.id,
    version: current.version,
  })
}

export async function adminVerificationsResponse(request: Request, env: WorkerEnv) {
  const current = await adminVisibleState(request, env)
  return json({
    studentVerifications: current.state.studentVerifications ?? [],
    educationEmailChallenges: current.state.educationEmailChallenges ?? [],
    users: current.state.users ?? [],
    currentUserId: current.user.id,
    version: current.version,
  })
}

function payloadRecord(payload: Record<string, unknown>, key: string) {
  return isRecord(payload[key]) ? payload[key] as Record<string, unknown> : payload
}

async function commitAdminStateAction(
  request: Request,
  env: WorkerEnv,
  mutate: (state: Partial<WelfareState>, user: User, payload: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void,
) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const previousState = record.state as Partial<WelfareState>
  const originalState = cloneState(previousState)
  const user = await authenticatedUser(request, env, previousState)
  assertAdminUser(user)
  const payload = await readPayload(request) as Record<string, unknown>
  const body = await mutate(previousState, user, payload)
  const result = await commitActionState(env, originalState, previousState, record.version)
  return json({ ok: true, ...(body ?? {}), version: result.version })
}

export async function updateAdminSystemConfigAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, user, payload) => {
    const input = payloadRecord(payload, 'systemConfig') as Partial<WelfareState['systemConfig']>
    const currentConfig = normalizeSystemConfig(state.systemConfig)
    state.systemConfig = normalizeSystemConfig({
      ...currentConfig,
      ...input,
      verification: {
        student: input.verification?.student ?? currentConfig.verification.student,
        frontline: input.verification?.frontline ?? currentConfig.verification.frontline,
      },
      updatedAt: now(),
      updatedBy: user.id,
    })
    return { systemConfig: state.systemConfig }
  })
}

export async function updateAdminApplicationPolicyAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _user, payload) => {
    const input = payloadRecord(payload, 'applicationPolicy') as Partial<WelfareState['applicationPolicy']>
    const previousSecret = state.applicationPolicy?.turnstileSecretKey ?? ''
    const nextSecret = typeof input.turnstileSecretKey === 'string' ? input.turnstileSecretKey.trim() : ''
    const applicationPolicy = normalizeApplicationPolicy({
      ...state.applicationPolicy,
      ...input,
      turnstileSecretKey: nextSecret && !isMaskedSecret(nextSecret) ? nextSecret : previousSecret,
    })
    state.applicationPolicy = applicationPolicy
    return { applicationPolicy: { ...applicationPolicy, turnstileSecretKey: maskSecret(applicationPolicy.turnstileSecretKey) } }
  })
}

export async function updateAdminSiteBannerAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, user, payload) => {
    const input = payloadRecord(payload, 'siteBanner') as Partial<WelfareState['siteBanner']>
    state.siteBanner = normalizeSiteBanner({
      ...state.siteBanner,
      ...input,
      updatedAt: now(),
      updatedBy: user.id,
    })
    return { siteBanner: state.siteBanner }
  })
}

export async function updateAdminOauthAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _user, payload) => {
    const input = payloadRecord(payload, 'oauth')
    state.oauth = {
      enabled: input.enabled === undefined ? !!state.oauth?.enabled : !!input.enabled,
      provider: input.provider === 'google' || input.provider === 'custom' ? input.provider : 'github',
      clientId: typeof input.clientId === 'string' ? input.clientId.trim() : state.oauth?.clientId ?? '',
      authorizeUrl: typeof input.authorizeUrl === 'string' ? input.authorizeUrl.trim() : state.oauth?.authorizeUrl ?? '',
      tokenUrl: typeof input.tokenUrl === 'string' ? input.tokenUrl.trim() : state.oauth?.tokenUrl ?? '',
      callbackUrl: typeof input.callbackUrl === 'string' ? input.callbackUrl.trim() : state.oauth?.callbackUrl ?? '',
      scopes: typeof input.scopes === 'string' ? input.scopes.trim() : state.oauth?.scopes ?? '',
    }
    return { oauth: state.oauth }
  })
}

export async function updateAdminUserRoleAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const target = adminTargetUser(state, payload.userId)
    if (target.role === 'admin')
      throw new Error('管理员角色不能在此切换')
    target.role = payload.enabled === true || payload.role === 'reviewer' ? 'reviewer' : 'user'
    return { user: sanitizeUser(target) }
  })
}

export async function updateAdminUserSuspensionAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const target = adminTargetUser(state, payload.userId)
    if (target.role === 'admin')
      throw new Error('管理员账号不能封禁')
    if (target.id === admin.id)
      throw new Error('不能封禁当前管理员账号')
    if (payload.suspended) {
      target.accountStatus = 'suspended'
      target.suspendedReason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : '违反平台使用政策'
      target.suspendedAt = now()
      target.suspendedBy = admin.id
    }
    else {
      target.accountStatus = 'active'
      target.suspendedReason = undefined
      target.suspendedAt = undefined
      target.suspendedBy = undefined
    }
    return { user: sanitizeUser(target) }
  })
}

export async function updateAdminUserStudentVerifiedAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const target = adminTargetUser(state, payload.userId)
    target.profile.studentVerified = !!payload.verified
    return { user: sanitizeUser(target) }
  })
}

export async function unbindAdminUserGithubAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const target = adminTargetUser(state, payload.userId)
    if (!target.profile.githubAuthorized && !target.profile.githubUsername && !target.profile.githubId)
      throw new Error('该用户没有可解绑的 GitHub 认证')
    target.profile.githubAuthorized = false
    target.profile.githubAuthorizedAt = undefined
    target.profile.githubId = undefined
    target.profile.githubUsername = undefined
    target.profile.selectedRepo = ''
    target.profile.githubRepos = []
    return { user: sanitizeUser(target) }
  })
}

export async function adjustAdminUserPointsAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, async (state, _admin, payload) => {
    const target = adminTargetUser(state, payload.userId)
    const amount = Math.trunc(Number(payload.amount))
    if (!Number.isFinite(amount) || amount === 0)
      throw new Error('请输入非零积分调整值')
    const tx = await appendPointTransaction(env, {
      userId: target.id,
      delta: amount,
      type: 'adjustment',
      reason: typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : '管理员手动调整',
      createdAt: now(),
      allowDebt: true,
    }, state)
    return { transaction: tx, user: sanitizeUser(target) }
  })
}

export async function reviewAdminApplicationItemAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (application.type !== 'resource')
      throw new Error('资源申请不存在')
    if (!['submitted', 'in_review'].includes(application.status))
      throw new Error('该申请不在审批中')
    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')
    if (item.approvalStatus !== 'pending')
      throw new Error('该资源明细已经审批')
    const status = payload.status as ResourceApprovalStatus
    if (!['approved', 'adjusted_approved', 'rejected'].includes(status))
      throw new Error('审批状态无效')
    const note = typeof payload.rejectReason === 'string' ? payload.rejectReason.trim() : typeof payload.note === 'string' ? payload.note.trim() : ''
    if (status === 'rejected' && !note)
      throw new Error('驳回资源明细时必须填写原因')
    if (status === 'adjusted_approved' && !isRecord(payload.approvedPayload))
      throw new Error('调整后通过必须填写批准后的额度/权限')
    item.approvalStatus = status
    item.approvedPayload = isRecord(payload.approvedPayload) ? payload.approvedPayload : undefined
    item.rejectReason = status === 'rejected' ? note || undefined : undefined
    item.provisionStatus = ['approved', 'adjusted_approved'].includes(status) ? 'pending' : 'not_required'
    item.lifecycleStatus = status === 'rejected' ? 'rejected' : 'provisioning'
    item.expiresAt = typeof item.expiresAt === 'string' ? item.expiresAt : typeof item.approvedPayload?.expiresAt === 'string' ? item.approvedPayload.expiresAt : typeof item.payload?.expiresAt === 'string' ? item.payload.expiresAt : undefined
    item.updatedAt = now()
    application.status = aggregateResourceApplicationStatusForReview(application.resourceItems ?? [], application.status)
    if (['pending_allocation', 'delivered', 'approved', 'partial_approved', 'rejected'].includes(application.status)) {
      application.reviewedAt = item.updatedAt
      if (['delivered', 'rejected'].includes(application.status))
        application.completedAt = item.updatedAt
    }
    application.answer = `<p>资源申请审批已更新：${resourceTypeLabel(item.resourceType)} / ${item.resourceSubtype} / ${resourceApprovalStatusText(item.approvalStatus)}。</p>`
    return { applicationId: application.id, item }
  })
}

export async function completeAdminResourceProvisionAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (application.type !== 'resource')
      throw new Error('资源申请不存在')
    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')
    if (!['approved', 'adjusted_approved'].includes(item.approvalStatus))
      throw new Error('只有通过的资源明细需要开通')
    const provisionPayload = normalizeManualProvisionPayload(payload)
    item.provisionStatus = 'completed'
    item.lifecycleStatus = resolveResourceLifecycleStatus({ ...item, provisionStatus: 'completed', lifecycleStatus: undefined })
    item.provisionPayload = provisionPayload
    item.provisionNote = manualProvisionNote(provisionPayload)
    item.provisionCompletedAt = now()
    item.activatedAt = item.lifecycleStatus === 'active' ? item.provisionCompletedAt : item.activatedAt
    item.updatedAt = item.provisionCompletedAt
    application.status = aggregateResourceApplicationStatusForReview(application.resourceItems ?? [], application.status)
    if (application.status === 'delivered')
      application.completedAt = item.provisionCompletedAt
    return { applicationId: application.id, item }
  })
}

export async function completeAdminApplicationAllocationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (application.status !== 'pending_allocation')
      throw new Error('只有待分配资源的申请可以完成发放')
    const allocationPayload = normalizeManualProvisionPayload(payload)
    const completedAt = now()
    application.status = 'delivered'
    application.allocationPayload = allocationPayload
    application.allocationNote = manualProvisionNote(allocationPayload)
    application.allocationCompletedAt = completedAt
    application.completedAt = completedAt
    pushApplicationMessage(application, admin.id, 'system', `<p>管理员已完成资源发放。</p><pre>${escapeHtml(application.allocationNote)}</pre>`)
    return { applicationId: application.id }
  })
}

export async function requestCurrentUserResourceLifecycleAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const application = (state.applications ?? []).find(item => item.id === payload.applicationId && item.userId === user.id)
    if (!application || application.type !== 'resource')
      throw new Error('资源申请不存在')
    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')
    const action = sanitizeResourceLifecycleAction(payload.action)
    if (!['request_renewal', 'return'].includes(action))
      throw new Error('该资源操作仅管理员可执行')
    const actedAt = now()
    applyResourceLifecycleAction(item, { action }, actedAt)
    const note = typeof payload.note === 'string' && payload.note.trim()
      ? payload.note.trim()
      : action === 'request_renewal'
        ? '申请人已发起资源续期申请。'
        : '申请人已主动归还资源。'
    pushApplicationMessage(application, user.id, 'system', note)
    return { applicationId: application.id, item }
  })
}

export async function updateAdminResourceLifecycleAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (application.type !== 'resource')
      throw new Error('资源申请不存在')
    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')
    const actedAt = now()
    applyResourceLifecycleAction(item, {
      action: sanitizeResourceLifecycleAction(payload.action),
      expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined,
    }, actedAt)
    const note = typeof payload.note === 'string' ? payload.note.trim() : ''
    if (note)
      pushApplicationMessage(application, admin.id, 'system', note)
    return { applicationId: application.id, item }
  })
}

export async function answerAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, async (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    assertCanAnswerApplication(application.status)
    const answer = sanitizeWorkerRichText(payload.answer)
    if (isRichTextEmpty(answer))
      throw new Error('请填写审核答复')
    if (!application.costCharged && application.cost > 0) {
      await appendPointTransaction(env, {
        id: transactionId('application_cost', application.id),
        userId: application.userId,
        delta: -application.cost,
        type: 'spend',
        reason: `${application.type.toUpperCase()} 申请历史补扣`,
        refId: application.id,
        createdAt: now(),
      }, state)
      application.costCharged = true
    }
    const reviewedAt = now()
    transitionApplicationAnswered(application, answer, reviewedAt)
    pushApplicationMessage(application, admin.id, 'system', answer)
    return { applicationId: application.id }
  })
}

export async function rejectAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, async (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    assertCanRejectApplication(application.status)
    const reason = sanitizeWorkerRichText(payload.reason)
    if (isRichTextEmpty(reason))
      throw new Error('请填写退回原因')
    const reviewedAt = now()
    const fraudulent = !!payload.fraudulent
    if (application.costCharged && application.cost > 0) {
      await appendPointTransaction(env, {
        id: transactionId('application_refund', application.id),
        userId: application.userId,
        delta: application.cost,
        type: 'refund',
        reason: `${application.type.toUpperCase()} 申请退回返还预扣`,
        refId: application.id,
        createdAt: reviewedAt,
      }, state)
      application.costCharged = false
    }
    if (application.expediteCost) {
      await appendPointTransaction(env, {
        id: transactionId('expedite_refund', application.id),
        userId: application.userId,
        delta: application.expediteCost,
        type: 'refund',
        reason: 'Pro 处理加速退回返还',
        refId: application.id,
        createdAt: reviewedAt,
      }, state)
      application.expediteCost = 0
    }
    if (fraudulent)
      application.cooldownUntil = createFraudRejectionCooldownUntil(reviewedAt)
    if (application.rejectionReviewFeeWaived)
      application.waiveRejectionReviewFeeBlockedUntil = createRejectionFeeWaiverBlockedUntil(reviewedAt)
    if (!application.rejectionReviewFeeWaived || fraudulent) {
      const fee = application.rejectionReviewFee || calculateRejectionReviewFee(application.cost)
      await appendPointTransaction(env, {
        id: transactionId('rejection_review_fee', application.id),
        userId: application.userId,
        delta: -fee,
        type: 'spend',
        reason: '申请退回扣除 AI 审核手续费',
        refId: application.id,
        createdAt: reviewedAt,
        allowDebt: true,
      }, state)
    }
    transitionApplicationRejected(application, reason, reviewedAt, fraudulent)
    pushApplicationMessage(application, admin.id, 'system', reason)
    return { applicationId: application.id }
  })
}

export async function completeAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    assertCanCompleteApplication(application.status)
    const completedAt = now()
    transitionApplicationCompleted(application, completedAt)
    pushApplicationMessage(application, admin.id, 'system', '<p>管理员已确认所有结果，申请完成。</p>')
    return { applicationId: application.id }
  })
}

export async function requestAdminApplicationSupplementAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    assertCanRequestApplicationSupplement(application.status)
    const content = sanitizeWorkerRichText(payload.content)
    if (isRichTextEmpty(content))
      throw new Error('请填写补充材料要求')
    transitionApplicationSupplementRequested(application, now())
    pushApplicationMessage(application, admin.id, 'system', content)
    return { applicationId: application.id }
  })
}

export async function addCurrentUserApplicationMessageAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const application = stateApplications(state).find(item => item.id === payload.applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.userId !== user.id)
      throw new Error('只能回复自己的申请工单')
    if (!['pending_review', 'processing', 'needs_supplement', 'answered', 'pending_allocation', 'delivered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持追加消息')
    if (payload.type === 'result_submission' || payload.type === 'system')
      throw new Error('用户不能提交管理员结果消息')
    return appendWorkerApplicationMessage(application, user, payload, sanitizeWorkerRichText)
  })
}

export async function addAdminApplicationMessageAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    return appendWorkerApplicationMessage(application, admin, payload, sanitizeWorkerRichText)
  })
}

export async function reviewAdminStudentVerificationAction(request: Request, env: WorkerEnv) {
  await requireRequestUserId(request, env)
  const record = await readWelfareStateRecord(env)
  const state = record.state as Partial<WelfareState>
  const admin = await authenticatedUser(request, env, state)
  assertAdminUser(admin)

  const payload = await readPayload(request) as Record<string, unknown>
  const verification = ensureStudentVerifications(state).find(item => item.id === payload.id)
  if (!verification)
    throw new Error('认证申请不存在')

  const decision = payload.status
  if (decision !== 'approved' && decision !== 'needs_supplement' && decision !== 'rejected')
    throw new Error('认证审核结果无效')
  if (verification.status !== 'pending') {
    if (verification.status === decision)
      return json({ ok: true, verificationId: verification.id, version: record.version })
    throw new Error('该认证申请已经处理')
  }

  await syncUserPointBalancesFromLedger(env, state, [verification.userId])
  const originalState = cloneState(state)
  const reply = sanitizeWorkerRichText(payload.reply)
  const reviewedAt = now()
  const pointTransactions: AtomicPointTransaction[] = []

  if (decision === 'approved') {
    verification.status = 'approved'
    verification.reply = richTextToPlainText(reply) ? reply : '认证通过，审核积分已返还。'
    verification.reviewedAt = reviewedAt
    markWorkerEducationEmailVerified(verification, reviewedAt, 'admin_approved')
    const target = stateUsers(state).find(item => item.id === verification.userId)
    if (!target)
      throw new Error('申请用户不存在')

    if (!verification.feeReturned) {
      const reviewFee = positiveStudentReviewFee(verification)
      verification.feeReturned = true
      const refundTransactionId = transactionId('student_review_refund', verification.id)
      if (!(await hasPointTransaction(env, refundTransactionId))) {
        const balanceAfter = target.points + reviewFee
        target.points = balanceAfter
        pointTransactions.push({
          id: refundTransactionId,
          userId: verification.userId,
          delta: reviewFee,
          type: 'refund',
          reason: `${verificationTypeLabel(normalizeVerificationType(verification.verificationType))}通过返还审核费`,
          refId: verification.id,
          balanceAfter,
          createdAt: reviewedAt,
        })
      }
    }
    if (normalizeVerificationType(verification.verificationType) === 'student')
      target.profile.studentVerified = true
  }
  else if (decision === 'needs_supplement') {
    verification.status = 'needs_supplement'
    verification.reply = richTextToPlainText(reply) ? reply : '材料不足，请补充有效证明后继续审核。'
    verification.reviewedAt = reviewedAt
    verification.supplementRequestedAt = reviewedAt
  }
  else {
    verification.status = 'rejected'
    verification.reply = richTextToPlainText(reply) ? reply : '材料不足，审核费不返还。'
    verification.reviewedAt = reviewedAt
  }

  const result = pointTransactions.length
    ? await commitActionStateWithPointTransactions(env, originalState, state, record.version, pointTransactions)
    : await commitActionState(env, originalState, state, record.version)
  return json({ ok: true, verificationId: verification.id, ...stateVersionPayload(result.version) })
}

export async function revokeAdminStudentVerificationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const userId = typeof payload.userId === 'string' ? payload.userId : ''
    const reason = sanitizeWorkerRichText(payload.reason)
    if (isRichTextEmpty(reason))
      throw new Error('请填写撤销学生认证原因')
    const target = adminTargetUser(state, userId)
    const verification = ensureStudentVerifications(state)
      .filter(item => item.userId === userId && normalizeVerificationType(item.verificationType) === 'student' && item.status === 'approved')
      .sort((left, right) => (right.reviewedAt || right.createdAt).localeCompare(left.reviewedAt || left.createdAt))[0]
    if (!verification)
      throw new Error('没有可撤销的已通过学生认证')
    verification.status = 'revoked'
    verification.reply = `<p>管理员撤销认证。</p>${reason}`
    verification.reviewedAt = now()
    target.profile.studentVerified = false
    return { verificationId: verification.id, user: sanitizeUser(target) }
  })
}

export async function createAdminCouponTemplateAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name)
      throw new Error('请填写优惠券名称')
    const rule = normalizeWorkerCouponRule(isRecord(payload.rule) ? payload.rule : payload)
    if (rule.discountType === 'rate' && (!rule.discountRate || rule.discountRate <= 0 || rule.discountRate > 1))
      throw new Error('折扣倍率需在 0.01 到 1 之间')
    if (rule.discountType !== 'rate' && !rule.discountAmount)
      throw new Error('固定抵扣金额需大于 0')
    const createdAt = now()
    const template: CouponTemplate = {
      id: createId('cpt'),
      name,
      description: typeof payload.description === 'string' && payload.description.trim() ? payload.description.trim() : undefined,
      enabled: payload.enabled !== false,
      rule,
      ttlDays: Math.max(0, Math.min(3650, Math.trunc(Number(payload.ttlDays ?? DEFAULT_COUPON_TTL_DAYS)))),
      totalGrantLimit: payload.totalGrantLimit ? Math.max(1, Math.trunc(Number(payload.totalGrantLimit))) : undefined,
      grantedCount: 0,
      createdAt,
      updatedAt: createdAt,
      createdBy: admin.id,
    }
    state.couponTemplates ??= []
    state.couponTemplates.unshift(template)
    return { template }
  })
}

export async function createAdminCouponCodeAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const template = (state.couponTemplates ?? []).find(item => item.id === payload.templateId)
    if (!template)
      throw new Error('优惠券模板不存在')
    const codeText = (typeof payload.code === 'string' && payload.code.trim() ? payload.code.trim() : createCouponCodeValue()).toUpperCase()
    state.couponCodes ??= []
    if (state.couponCodes.some(item => item.code === codeText))
      throw new Error('兑换码已存在')
    const code = {
      id: createId('ccd'),
      code: codeText,
      templateId: template.id,
      enabled: true,
      maxRedemptions: Math.max(1, Math.trunc(Number(payload.maxRedemptions || 1))),
      redeemedCount: 0,
      perUserLimit: Math.max(1, Math.trunc(Number(payload.perUserLimit || 1))),
      expiresAt: typeof payload.expiresAt === 'string' && payload.expiresAt ? payload.expiresAt : undefined,
      createdAt: now(),
      createdBy: admin.id,
    }
    state.couponCodes.unshift(code)
    return { code }
  })
}

export async function grantAdminCouponsAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, _admin, payload) => {
    const template = (state.couponTemplates ?? []).find(item => item.id === payload.templateId)
    if (!template || !template.enabled)
      throw new Error('优惠券模板不存在或已停用')
    const userIds = Array.isArray(payload.userIds) ? Array.from(new Set(payload.userIds.filter((item): item is string => typeof item === 'string'))) : []
    const existingUserIds = userIds.filter(userId => stateUsers(state).some(user => user.id === userId))
    if (!existingUserIds.length)
      throw new Error('请选择要发放的用户')
    if (template.totalGrantLimit && template.grantedCount + existingUserIds.length > template.totalGrantLimit)
      throw new Error('发放数量超过模板总发放上限')
    const createdAt = now()
    const coupons = existingUserIds.map(userId => createUserCouponFromRule(userId, 'bulk_grant', template, createdAt))
    ensureCoupons(state).unshift(...coupons)
    template.grantedCount += coupons.length
    template.updatedAt = createdAt
    return { coupons }
  })
}

export async function submitCrowdReviewAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    if (user.role !== 'admin' && user.role !== 'reviewer')
      throw new Error('需要协作处理员权限')
    if (payload.targetType !== 'pro_application')
      throw new Error('协作建议当前只开放 Pro 申请摘要')
    const targetId = typeof payload.targetId === 'string' ? payload.targetId : ''
    const application = stateApplications(state).find(item => item.id === targetId && item.type === 'pro')
    if (!application)
      throw new Error('申请不存在')
    assertCanAnswerApplication(application.status)
    if (application.userId === user.id)
      throw new Error('不能审核自己的申请')
    const decision = payload.decision === 'approve' || payload.decision === 'reject' || payload.decision === 'needs_admin' ? payload.decision : ''
    if (!decision)
      throw new Error('请选择有效的审核建议')
    const note = sanitizeWorkerRichText(payload.note)
    if (isRichTextEmpty(note))
      throw new Error('请填写协作建议')
    state.crowdReviews ??= []
    const existing = state.crowdReviews.find(item => item.targetType === 'pro_application' && item.targetId === targetId && item.reviewerId === user.id)
    if (existing) {
      existing.decision = decision
      existing.note = note
      existing.createdAt = now()
      return { review: existing }
    }
    const review: CrowdReview = {
      id: createId('crv'),
      targetType: 'pro_application',
      targetId,
      reviewerId: user.id,
      decision,
      note,
      createdAt: now(),
    }
    state.crowdReviews.unshift(review)
    return { review }
  })
}

export async function createSquarePostAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    const content = sanitizeWorkerRichText(payload.content)
    if (!title)
      throw new Error('请填写广场标题')
    if (isRichTextEmpty(content))
      throw new Error('请填写广场内容')
    const applicationId = typeof payload.applicationId === 'string' ? payload.applicationId : ''
    const application = applicationId ? stateApplications(state).find(item => item.id === applicationId && item.userId === user.id) : undefined
    if (applicationId && !application)
      throw new Error('只能分享自己的申请记录')
    const createdAt = now()
    const post: SquarePost = {
      id: createId('square'),
      userId: user.id,
      type: application ? 'application_template' : 'review',
      title,
      content,
      applicationId: application?.id,
      requestType: application?.type,
      template: payload.shareTemplate && application
        ? {
            type: application.type,
            title: application.title,
            description: application.description,
            githubRepo: application.githubRepo,
            extendStorage: application.storageExtended,
            expediteProcessing: application.expedited,
            selectedResourceTypes: application.selectedResourceTypes,
            resourceItems: application.resourceItems?.map(item => ({
              resourceType: item.resourceType,
              resourceSubtype: item.resourceSubtype,
              payload: item.payload,
              requestedQuota: item.requestedQuota,
              requestedPermission: item.requestedPermission,
              duration: item.duration,
            })),
          }
        : undefined,
      createdAt,
      updatedAt: createdAt,
    }
    ensureSquarePosts(state).unshift(post)
    return { post }
  })
}

function createEducationEmailCodeValue() {
  const randomParts = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10).toUpperCase())
  return `TGW-EDU-${Date.now().toString(36).toUpperCase()}-${randomParts.join('-')}`
}

export async function createEducationEmailChallengeAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const email = normalizeStudentEmail(payload.email)
    const realName = typeof payload.realName === 'string' ? payload.realName.trim() : ''
    assertEducationEmail(email)
    const emailProfile = analyzeEducationEmail(email)
    const createdAt = now()
    const code = createEducationEmailCodeValue()
    const subject = `Touch Great Welfare 教育邮箱认证 ${code}`
    const body = [
      'Touch Great Welfare 学生认证邮件证明',
      '',
      `认证码：${code}`,
      `申请人姓名：${realName || '未填写'}`,
      `平台用户：${user.profile.displayName || user.profile.email}`,
      `平台用户 ID：${user.id}`,
      `教育邮箱：${email}`,
      `机构识别：${emailProfile.categoryLabel}`,
      `管理员建议：${educationEmailAdminRecommendationLabel(emailProfile)}`,
      `识别依据：${emailProfile.reason}`,
      '',
      '我确认该邮件由本人从该邮箱发出，仅作为学生认证辅助证明，仍需平台人工复核。',
    ].join('\n')
    const challenge: EducationEmailChallenge = {
      id: createId('edu_email'),
      userId: user.id,
      email,
      code,
      subject,
      body,
      mailto: `mailto:${EDUCATION_EMAIL_REVIEW_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      expiresAt: addHours(createdAt, EDUCATION_EMAIL_CHALLENGE_TTL_HOURS),
      createdAt,
    }
    state.educationEmailChallenges = (state.educationEmailChallenges ?? []).filter((item) => {
      const expiresAt = new Date(item.expiresAt).getTime()
      return item.verifiedAt || (Number.isFinite(expiresAt) && expiresAt > Date.now())
    })
    state.educationEmailChallenges.unshift(challenge)
    return { challenge }
  })
}

export async function currentStateResponse(request: Request, env: WorkerEnv) {
  const { state, version } = await readWelfareStateRecord(env)
  const userId = await requestUserId(request, env)
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const user = userId ? users.find(item => isRecord(item) && item.id === userId) : undefined

  if (!user)
    return json({ state: publicBootstrapState(state), version })

  return json({ state: clientVisibleWelfareState(state, userId), currentUserId: userId, version })
}

export async function bootstrapResponse(env: WorkerEnv) {
  const state = await readWelfareState(env)
  return json(publicBootstrapPayload(state))
}

export async function sessionResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    return json({ currentUser: null })

  const state = await readWelfareState(env)
  const user = stateUsers(state as Partial<WelfareState>).find(item => item.id === userId && item.accountStatus !== 'suspended')
  return json({
    currentUser: user ? sanitizeUser(user) : null,
  })
}

export async function currentUserStateResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const user = stateUsers(state as Partial<WelfareState>).find(item => item.id === userId && item.accountStatus !== 'suspended')
  if (!user)
    throw new Error('请先登录')

  return json({ state: clientVisibleWelfareState(state, userId), currentUserId: userId, version })
}

export async function adminStateResponse(request: Request, env: WorkerEnv) {
  const userId = await requireRequestUserId(request, env)
  const { state, version } = await readWelfareStateRecord(env, { syncPointBalances: 'current-user', currentUserId: userId })
  const user = await authenticatedUser(request, env, state as Partial<WelfareState>)
  assertAdminUser(user)
  return json({ state: clientVisibleWelfareState(state, user.id), currentUserId: user.id, version })
}
