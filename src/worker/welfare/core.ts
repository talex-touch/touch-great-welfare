import type {
  ApplicationItem,
  ApplicationMessageType,
  AttachmentMeta,
  CouponDiscountType,
  CouponScope,
  CouponTemplate,
  CreditTransaction,
  CrowdReview,
  DailyCheckIn,
  EducationEmailChallenge,
  InvitationBinding,
  ResourceApprovalStatus,
  ResourceType,
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
} from '~/composables/welfare'
import { Pool } from 'pg'
import {
  ACTIVITY_END_AT,
  applicationPowChallenge,
  applyRateDiscount,
  BASE_REQUEST_COST,
  buildPricingSnapshot,
  buildUserLevelCard,
  calculateActivityPrice,
  calculateLlmApiBudgetActivityPrice,
  calculateLlmApiCostPoints,
  calculateLlmApiRateLimitChangeCost,
  calculateRejectionReviewFee,
  canApplyResourceType,
  COLLABORATION_APPLICATION_MIN_REASON_CHARS,
  COLLABORATION_DELIVERY_REWARD_MAX,
  COLLABORATION_DELIVERY_REWARD_MIN,
  createFraudRejectionCooldownUntil,
  createProcessingDueAt,
  createRejectionFeeWaiverBlockedUntil,
  createRetentionExpiresAt,
  createUserInviteCode,
  DAILY_CHECK_IN_COUPON_TTL_DAYS,
  DAILY_CHECK_IN_MAX_POINTS,
  discountedResourceItemCost,
  EDUCATION_EMAIL_CHALLENGE_TTL_HOURS,
  EDUCATION_EMAIL_REVIEW_INBOX,
  estimatedResourceItemCost,
  INVITATION_BIND_WINDOW_HOURS,
  isValidApplicationPow,
  LLM_API_EXTENDED_PROCESSING_HOURS,
  LLM_API_STANDARD_PROCESSING_HOURS,
  llmApiRequiresExtendedReview,
  MAX_ACTIVE_USER_REQUESTS,
  MAX_ATTACHMENT_BYTES,
  normalizeApplicationPolicy,
  normalizeLlmApiBudgetUsd,
  normalizeResourceItems,
  normalizeSiteBanner,
  normalizeSystemConfig,
  PRO_CONTEXT_APPEND_COST,
  PRO_EXPEDITE_COST,
  PRO_STANDARD_PROCESSING_HOURS,
  REJECTION_REVIEW_FEE_RATE,
  resolveSelectableLlmApiModel,
  RESOURCE_TYPE_CONFIGS,
  resourceActivityPromotionName,
  resourceApprovalStatusText,
  resourceTypeLabel,
  rollDailyCheckInPoints,
  SQUARE_BOOST_REPORT_COOLDOWN_DAYS,
  SQUARE_BOOST_REPORT_PENALTY_POINTS,
  SQUARE_BOOST_REWARD_POINTS,
  SQUARE_DAILY_BOOST_LIMIT,
  SQUARE_MIN_DISCOUNT_RATE,
  SQUARE_SHARE_DISCOUNT_RATE,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
  termsForResourceTypes,
} from '~/composables/welfare'
import { analyzeEducationEmail, assertEducationEmailAddress, educationEmailAdminRecommendationLabel } from '~/shared/education-email'
import { isRichTextEmpty, richTextToPlainText } from '~/utils/rich-text'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { base64UrlDecode, base64UrlEncode, decryptSecret, encryptSecret, sha256Hex } from '../crypto'
import { dispatchWelfareStateChangeNotifications } from '../notifications'
import { appendPointTransaction, backfillPointTransactionsFromState, ensurePointTransactionSchema, pointTransactionId, syncUserPointBalancesFromLedger } from '../points'
import { authenticatedUserId, createSessionCookie } from '../session'

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
}

const STATE_KEY = 'default'
const INITIAL_STATE_VERSION = 1
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MASKED_SECRET_MARKER = '****'
const ADMIN_LOGIN_MAX_FAILURES = 8
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000
const PASSWORD_PBKDF2_ITERATIONS = 210000
const POSTGRES_TIMEOUT_MS = 10000
const POSTGRES_SNAPSHOT_BATCH_SIZE = 200

type PointBalanceSyncMode = false | 'current-user' | 'all'

interface ReadWelfareStateOptions {
  syncPointBalances?: PointBalanceSyncMode
  currentUserId?: string
}

interface WelfareStateRecord {
  state: unknown
  version: number
}

interface WriteWelfareStateOptions {
  expectedVersion?: number
  previousState?: unknown
}

type AtomicPointTransaction = Required<Pick<CreditTransaction, 'id' | 'userId' | 'delta' | 'type' | 'reason' | 'balanceAfter' | 'createdAt'>> & Pick<CreditTransaction, 'refId'>

export class StateVersionConflictError extends Error {
  constructor() {
    super('业务状态已被其他请求更新，请刷新后重试')
    this.name = 'StateVersionConflictError'
  }
}

let pool: Pool | undefined
let poolKey = ''
let postgresSchemaKey = ''
let postgresSchemaPromise: Promise<void> | undefined
const d1SchemaPromises = new WeakMap<D1Database, Promise<void>>()
const adminLoginAttempts = new Map<string, { failures: number, firstFailureAt: number, lockedUntil: number }>()

interface EncryptedWelfareStateEnvelope {
  __encrypted: true
  payload: string
  encryptedAt: string
}

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
}

function stateEncryptionSecret(env: WorkerEnv) {
  return env.WELFARE_STATE_SECRET_KEY?.trim() || env.NOTIFY_SECRET_KEY?.trim() || ''
}

function isEncryptedWelfareStateEnvelope(value: unknown): value is EncryptedWelfareStateEnvelope {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).__encrypted === true
    && typeof (value as Record<string, unknown>).payload === 'string'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function maskSecret(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text)
    return ''
  if (text.length <= 8)
    return MASKED_SECRET_MARKER
  return `${text.slice(0, 4)}${MASKED_SECRET_MARKER}${text.slice(-4)}`
}

function isMaskedSecret(value: unknown) {
  return typeof value === 'string' && value.includes(MASKED_SECRET_MARKER)
}

export function sanitizeUser(user: User): User {
  const { passwordHash: _passwordHash, ...visibleUser } = user
  return visibleUser
}

function publicUser(user: User): User {
  return {
    id: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    profile: {
      displayName: user.profile.displayName,
      email: '',
      avatar: user.profile.avatar,
      githubUsername: user.profile.githubUsername,
      githubAuthorized: !!user.profile.githubAuthorized,
      studentVerified: !!user.profile.studentVerified,
    },
    points: 0,
    accountStatus: 'active',
    createdAt: user.createdAt,
    lastLoginAt: '',
  }
}

function userVisibleFromIds(users: User[], userIds: Iterable<string>, currentUserId: string) {
  const visibleIds = new Set(userIds)
  visibleIds.add(currentUserId)
  return users
    .filter(user => visibleIds.has(user.id))
    .map(user => user.id === currentUserId ? sanitizeUser(user) : publicUser(user))
}

function publicApplicationForReview(application: WelfareApplication): WelfareApplication {
  return {
    id: application.id,
    userId: application.userId,
    type: application.type,
    title: application.title,
    description: '',
    githubRepo: application.githubRepo ? '已关联开源仓库' : undefined,
    hasOpenSourceBadge: application.hasOpenSourceBadge,
    attachments: [],
    status: application.status,
    cost: 0,
    costCharged: false,
    aiReview: application.aiReview
      ? {
          status: application.aiReview.status,
          summary: application.aiReview.summary,
          risk: application.aiReview.risk,
          reviewedAt: application.aiReview.reviewedAt,
        }
      : undefined,
    aiReviewFeeRate: application.aiReviewFeeRate,
    rejectionReviewFee: 0,
    rejectionReviewFeeWaived: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: application.retentionExpiresAt,
    createdAt: application.createdAt,
  }
}

function publicApplicationForDelivery(application: WelfareApplication, currentUserId: string): WelfareApplication {
  const claimedByCurrentUser = application.deliveryAssigneeId === currentUserId
  return {
    ...publicApplicationForReview(application),
    type: application.type,
    status: application.status,
    cost: application.cost,
    answer: claimedByCurrentUser ? application.answer : undefined,
    messages: claimedByCurrentUser
      ? application.messages?.filter(item => item.type === 'system' || item.type === 'result_submission') ?? []
      : [],
    deliveryAssigneeId: application.deliveryAssigneeId,
    deliveryClaimedAt: application.deliveryClaimedAt,
    deliverySubmittedAt: application.deliverySubmittedAt,
    deliveryReviewStatus: application.deliveryReviewStatus,
    deliveryRewardPoints: application.deliveryRewardPoints,
  }
}

function publicSquareApplication(application: WelfareApplication): WelfareApplication {
  return {
    id: application.id,
    userId: application.userId,
    type: application.type,
    title: application.title,
    description: '',
    hasOpenSourceBadge: application.hasOpenSourceBadge,
    attachments: [],
    status: application.status,
    cost: application.cost,
    costCharged: false,
    aiReviewFeeRate: application.aiReviewFeeRate,
    rejectionReviewFee: 0,
    rejectionReviewFeeWaived: false,
    storageExtended: false,
    storageExtensionCost: 0,
    retentionExpiresAt: application.retentionExpiresAt,
    createdAt: application.createdAt,
    reviewedAt: application.reviewedAt,
    completedAt: application.completedAt,
  }
}

function sanitizeApplicationItemForPublicTemplate(item: Partial<ApplicationItem> & Pick<ApplicationItem, 'resourceType' | 'resourceSubtype' | 'payload'>): ApplicationItem {
  const createdAt = item.createdAt || new Date().toISOString()
  return {
    id: item.id || '',
    applicationId: item.applicationId || '',
    resourceType: item.resourceType,
    resourceSubtype: item.resourceSubtype,
    payload: item.payload,
    requestedQuota: item.requestedQuota,
    requestedPermission: item.requestedPermission,
    duration: item.duration,
    approverGroup: item.approverGroup || '管理员',
    approvalStatus: 'pending',
    provisionStatus: 'not_required',
    createdAt,
    updatedAt: item.updatedAt || createdAt,
  }
}

function sanitizePublicSquarePost(post: SquarePost): SquarePost {
  return {
    id: post.id,
    userId: post.userId,
    type: post.type,
    title: post.title,
    content: post.content,
    applicationId: post.applicationId,
    requestType: post.requestType,
    template: post.template
      ? {
          type: post.template.type,
          title: post.template.title,
          description: post.template.description,
          githubRepo: post.template.githubRepo,
          extendStorage: post.template.extendStorage,
          expediteProcessing: post.template.expediteProcessing,
          selectedResourceTypes: post.template.selectedResourceTypes,
          resourceItems: post.template.resourceItems?.map(sanitizeApplicationItemForPublicTemplate),
          reason: post.template.reason,
          businessBackground: post.template.businessBackground,
          urgency: post.template.urgency,
          expectedEffectiveAt: post.template.expectedEffectiveAt,
          duration: post.template.duration,
          acceptedTermIds: post.template.acceptedTermIds,
        }
      : undefined,
    penaltyCount: post.penaltyCount,
    lastPenaltyAt: post.lastPenaltyAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  }
}

function sanitizePublicSquareBoost(boost: SquareBoost): SquareBoost {
  return {
    id: boost.id,
    postId: boost.postId,
    userId: boost.userId,
    mode: boost.mode,
    declaration: boost.declaration,
    pointsGranted: boost.pointsGranted,
    createdAt: boost.createdAt,
    reportedAt: boost.reportedAt,
  }
}

function sanitizeOwnedApplications(applications: WelfareApplication[], currentUserId: string) {
  return applications.filter(item => item.userId === currentUserId)
}

function sanitizeReviewerApplications(applications: WelfareApplication[], currentUserId: string) {
  return applications
    .filter(item => item.type === 'pro' && item.userId !== currentUserId && ['pending_review', 'needs_supplement', 'processing'].includes(item.status))
    .map(publicApplicationForReview)
}

function sanitizeDeliveryApplications(applications: WelfareApplication[], currentUserId: string) {
  return applications
    .filter(item =>
      ['code', 'pro'].includes(item.type)
      && item.userId !== currentUserId
      && item.status === 'answered'
      && !item.deliveryRewardedAt
      && (!item.deliveryAssigneeId || item.deliveryAssigneeId === currentUserId),
    )
    .map(item => publicApplicationForDelivery(item, currentUserId))
}

function clientVisibleWelfareStateForUser(state: Record<string, unknown>, currentUserId: string, currentUser: User) {
  const users = Array.isArray(state.users) ? state.users.filter((item): item is User => isRecord(item) && typeof item.id === 'string') : []
  const applications = Array.isArray(state.applications) ? state.applications.filter((item): item is WelfareApplication => isRecord(item) && typeof item.id === 'string') : []
  const squarePosts = Array.isArray(state.squarePosts) ? state.squarePosts.filter((item): item is SquarePost => isRecord(item) && typeof item.id === 'string') : []
  const squareBoosts = Array.isArray(state.squareBoosts) ? state.squareBoosts.filter((item): item is SquareBoost => isRecord(item) && typeof item.id === 'string') : []
  const publicPostIds = new Set(squarePosts.map(item => item.id))
  const publicApplicationIds = new Set(squarePosts.map(item => item.applicationId).filter((id): id is string => !!id))
  const visibleApplications = [
    ...sanitizeOwnedApplications(applications, currentUserId),
    ...(currentUser.role === 'reviewer'
      ? [
          ...sanitizeReviewerApplications(applications, currentUserId),
          ...sanitizeDeliveryApplications(applications, currentUserId),
        ]
      : []),
    ...applications
      .filter(item => publicApplicationIds.has(item.id) && item.userId !== currentUserId)
      .map(publicSquareApplication),
  ]
  const applicationById = new Map<string, WelfareApplication>()
  for (const application of visibleApplications)
    applicationById.set(application.id, application)

  const visibleSquareBoosts = squareBoosts
    .filter(item => publicPostIds.has(item.postId))
    .map(sanitizePublicSquareBoost)
  const visibleUserIds = new Set<string>([
    currentUserId,
    ...squarePosts.map(item => item.userId),
    ...visibleSquareBoosts.map(item => item.userId),
    ...Array.from(applicationById.values()).map(item => item.userId),
  ])
  const invitationBindings = Array.isArray(state.invitationBindings)
    ? state.invitationBindings.filter((item): item is InvitationBinding => isRecord(item) && (item.inviteeUserId === currentUserId || item.inviterUserId === currentUserId))
    : []
  for (const binding of invitationBindings) {
    visibleUserIds.add(binding.inviterUserId)
    visibleUserIds.add(binding.inviteeUserId)
  }

  return {
    ...state,
    currentUserId,
    users: userVisibleFromIds(users, visibleUserIds, currentUserId),
    applications: Array.from(applicationById.values()),
    studentVerifications: Array.isArray(state.studentVerifications)
      ? state.studentVerifications.filter((item): item is StudentVerification => isRecord(item) && item.userId === currentUserId)
      : [],
    educationEmailChallenges: Array.isArray(state.educationEmailChallenges)
      ? state.educationEmailChallenges.filter((item): item is EducationEmailChallenge => isRecord(item) && item.userId === currentUserId)
      : [],
    coupons: Array.isArray(state.coupons) ? state.coupons.filter(item => isRecord(item) && item.userId === currentUserId) : [],
    dailyCheckIns: Array.isArray(state.dailyCheckIns) ? state.dailyCheckIns.filter(item => isRecord(item) && item.userId === currentUserId) : [],
    invitationBindings,
    crowdReviews: Array.isArray(state.crowdReviews)
      ? state.crowdReviews.filter((item): item is CrowdReview => isRecord(item) && item.reviewerId === currentUserId)
      : [],
    collaborationApplications: Array.isArray(state.collaborationApplications)
      ? state.collaborationApplications.filter(item => isRecord(item) && item.userId === currentUserId)
      : [],
    squarePosts: squarePosts.map(sanitizePublicSquarePost),
    squareBoosts: visibleSquareBoosts,
    squareReports: Array.isArray(state.squareReports)
      ? state.squareReports.filter((item): item is SquareReport => isRecord(item) && item.reporterId === currentUserId)
      : [],
    transactions: Array.isArray(state.transactions)
      ? state.transactions.filter((item): item is CreditTransaction => isRecord(item) && item.userId === currentUserId)
      : [],
  }
}

function clientVisibleWelfareState(state: unknown, currentUserId = '') {
  if (!isRecord(state))
    return state

  const users = Array.isArray(state.users) ? state.users : []
  const currentUser = users.find(user => isRecord(user) && user.id === currentUserId)
  const isAdmin = isRecord(currentUser) && currentUser.role === 'admin'

  const applicationPolicy = isRecord(state.applicationPolicy)
    ? {
        ...state.applicationPolicy,
        turnstileSecretKey: maskSecret(state.applicationPolicy.turnstileSecretKey),
      }
    : state.applicationPolicy

  if (!isAdmin && isRecord(currentUser))
    return clientVisibleWelfareStateForUser({ ...state, applicationPolicy }, currentUserId, currentUser as unknown as User)

  return {
    ...state,
    currentUserId: currentUserId || undefined,
    users: users.map(user => isRecord(user) ? sanitizeUser(user as unknown as User) : user),
    studentVerifications: state.studentVerifications,
    applicationPolicy,
  }
}

function publicBootstrapState(state: unknown) {
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const hasAdmin = users.some(user => isRecord(user) && user.role === 'admin')
  return {
    users: hasAdmin
      ? [{
          id: 'admin-present',
          role: 'admin',
          profile: {
            displayName: '管理员',
            email: '',
            studentVerified: false,
          },
          points: 0,
          accountStatus: 'active',
          createdAt: '',
          lastLoginAt: '',
        }]
      : [],
    siteBanner: isRecord(state) ? state.siteBanner : undefined,
    systemConfig: isRecord(state) ? state.systemConfig : undefined,
    createdAt: isRecord(state) && typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString(),
  }
}

function publicBootstrapPayload(state: unknown) {
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const hasAdmin = users.some(user => isRecord(user) && user.role === 'admin')
  return {
    hasAdmin,
    siteBanner: isRecord(state) ? state.siteBanner : undefined,
    systemConfig: isRecord(state) ? state.systemConfig : undefined,
    createdAt: isRecord(state) && typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString(),
  }
}

export async function requestUserId(request: Request, env: WorkerEnv) {
  return await authenticatedUserId(request, env)
}

export async function canUpdateState(previousState: unknown, request: Request, env: WorkerEnv) {
  if (!isRecord(previousState))
    return false

  const userId = await requestUserId(request, env)
  if (!userId)
    return false

  const users = Array.isArray(previousState.users) ? previousState.users : []
  return users.some(item => isRecord(item) && item.id === userId && item.accountStatus !== 'suspended')
}

async function canUpdateSensitiveState(previousState: unknown, request: Request, env: WorkerEnv) {
  if (!isRecord(previousState))
    return false

  const userId = await requestUserId(request, env)
  if (!userId)
    return false

  const users = Array.isArray(previousState.users) ? previousState.users : []
  const user = users.find(item => isRecord(item) && item.id === userId)
  return isRecord(user) && user.role === 'admin'
}

export function isAdminUser(previousState: unknown, userId: string) {
  if (!isRecord(previousState))
    return false

  const users = Array.isArray(previousState.users) ? previousState.users : []
  const user = users.find(item => isRecord(item) && item.id === userId)
  return isRecord(user) && user.role === 'admin'
}

function mergeScopedRecords(
  previousValue: unknown,
  nextValue: unknown,
  predicate: (item: Record<string, unknown>) => boolean,
) {
  if (!Array.isArray(previousValue))
    return []
  if (!Array.isArray(nextValue))
    return previousValue

  const nextScopedRecords = nextValue.filter((item): item is Record<string, unknown> => isRecord(item) && predicate(item))
  const nextById = new Map(nextScopedRecords
    .filter(item => typeof item.id === 'string')
    .map(item => [item.id as string, item]))
  const previousIds = new Set<string>()
  const merged = previousValue.map((previousItem) => {
    if (!isRecord(previousItem) || typeof previousItem.id !== 'string' || !predicate(previousItem))
      return previousItem

    previousIds.add(previousItem.id)
    return nextById.get(previousItem.id) ?? previousItem
  })

  for (const item of nextScopedRecords) {
    if (typeof item.id === 'string' && previousIds.has(item.id))
      continue
    merged.push(item)
  }

  return merged
}

function mergeSquareBoostsForNonAdmin(previousValue: unknown, nextValue: unknown, userId: string) {
  if (!Array.isArray(previousValue))
    return []
  if (!Array.isArray(nextValue))
    return previousValue

  const nextRecords = nextValue.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string')
  const nextById = new Map(nextRecords.map(item => [item.id as string, item]))
  const previousIds = new Set<string>()
  const merged = previousValue.map((previousItem) => {
    if (!isRecord(previousItem) || typeof previousItem.id !== 'string')
      return previousItem

    previousIds.add(previousItem.id)
    const nextItem = nextById.get(previousItem.id)
    if (!nextItem)
      return previousItem
    if (previousItem.userId === userId && nextItem.userId === userId)
      return nextItem
    if (nextItem.reportedBy === userId && typeof nextItem.reportedAt === 'string') {
      return {
        ...previousItem,
        reportedAt: nextItem.reportedAt,
        reportReason: typeof nextItem.reportReason === 'string' ? nextItem.reportReason : previousItem.reportReason,
        reportedBy: userId,
        cooldownUntil: typeof nextItem.cooldownUntil === 'string' ? nextItem.cooldownUntil : previousItem.cooldownUntil,
        penaltyApplied: !!nextItem.penaltyApplied || !!previousItem.penaltyApplied,
      }
    }
    return previousItem
  })

  for (const item of nextRecords) {
    if (item.userId !== userId || previousIds.has(item.id as string))
      continue
    merged.push(item)
  }

  return merged
}

function mergeUsersForNonAdmin(previousValue: unknown, nextValue: unknown, userId: string) {
  if (!Array.isArray(previousValue) || !Array.isArray(nextValue))
    return previousValue

  return previousValue.map((previousUser) => {
    if (!isRecord(previousUser) || previousUser.id !== userId)
      return previousUser

    const nextUser = nextValue.find(item => isRecord(item) && item.id === userId)
    if (!isRecord(nextUser) || !isRecord(nextUser.profile))
      return previousUser

    return {
      ...previousUser,
      profile: {
        ...(isRecord(previousUser.profile) ? previousUser.profile : {}),
        displayName: nextUser.profile.displayName,
        email: nextUser.profile.email,
        bio: nextUser.profile.bio,
        selectedRepo: nextUser.profile.selectedRepo,
      },
    }
  })
}

function mergeOwnedApplicationsForNonAdmin(previousValue: unknown, nextValue: unknown, userId: string) {
  const merged = mergeScopedRecords(previousValue, nextValue, item => item.userId === userId)
  if (!Array.isArray(merged) || !Array.isArray(previousValue))
    return merged

  const previousById = new Map(previousValue
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string')
    .map(item => [item.id as string, item]))

  return merged.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string')
      return item

    const previous = previousById.get(item.id)
    if (!previous || previous.userId !== userId)
      return item

    return {
      ...item,
      userId: previous.userId,
      type: previous.type,
      status: previous.status,
      baseCost: previous.baseCost,
      cost: previous.cost,
      costCharged: previous.costCharged,
      rejectionReviewFee: previous.rejectionReviewFee,
      rejectionReviewFeeWaived: previous.rejectionReviewFeeWaived,
      rejectionFraudulent: previous.rejectionFraudulent,
      answer: previous.answer,
      reviewedAt: previous.reviewedAt,
      completedAt: previous.completedAt,
      aiReview: previous.aiReview,
      storageExtensionCost: previous.storageExtensionCost,
      expediteCost: previous.expediteCost,
      deliveryAssigneeId: previous.deliveryAssigneeId,
      deliveryClaimedAt: previous.deliveryClaimedAt,
      deliverySubmittedAt: previous.deliverySubmittedAt,
      deliveryReviewStatus: previous.deliveryReviewStatus,
      deliveryRewardPoints: previous.deliveryRewardPoints,
      deliveryRewardedAt: previous.deliveryRewardedAt,
      deliveryRewardedBy: previous.deliveryRewardedBy,
    }
  })
}

function mergeStudentVerificationsForNonAdmin(previousValue: unknown, nextValue: unknown, userId: string) {
  const merged = mergeScopedRecords(previousValue, nextValue, item => item.userId === userId)
  if (!Array.isArray(merged) || !Array.isArray(previousValue))
    return merged

  const previousById = new Map(previousValue
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string')
    .map(item => [item.id as string, item]))

  return merged.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string')
      return item

    const previous = previousById.get(item.id)
    if (!previous || previous.userId !== userId)
      return item

    const canSupplement = previous.status === 'needs_supplement' && item.status === 'pending'

    return {
      ...item,
      userId: previous.userId,
      status: canSupplement ? item.status : previous.status,
      reviewFee: previous.reviewFee,
      feeReturned: previous.feeReturned,
      reply: canSupplement ? undefined : previous.reply,
      reviewedAt: canSupplement ? undefined : previous.reviewedAt,
      educationEmailVerified: canSupplement ? item.educationEmailVerified : previous.educationEmailVerified,
      educationEmailVerifiedAt: canSupplement ? item.educationEmailVerifiedAt : previous.educationEmailVerifiedAt,
      educationEmailVerificationSource: canSupplement ? item.educationEmailVerificationSource : previous.educationEmailVerificationSource,
    }
  })
}

async function mergeClientWritableState<T extends Record<string, unknown>>(previousState: unknown, nextState: T, request: Request, env: WorkerEnv): Promise<T> {
  const userId = await requestUserId(request, env)
  if (!userId || isAdminUser(previousState, userId))
    return nextState

  const previousRecord = isRecord(previousState) ? previousState : {}
  return {
    ...previousRecord,
    users: mergeUsersForNonAdmin(previousRecord.users, nextState.users, userId),
    applications: mergeOwnedApplicationsForNonAdmin(previousRecord.applications, nextState.applications, userId),
    studentVerifications: mergeStudentVerificationsForNonAdmin(previousRecord.studentVerifications, nextState.studentVerifications, userId),
    educationEmailChallenges: mergeScopedRecords(previousRecord.educationEmailChallenges, nextState.educationEmailChallenges, item => item.userId === userId),
    coupons: mergeScopedRecords(previousRecord.coupons, nextState.coupons, item => item.userId === userId),
    dailyCheckIns: mergeScopedRecords(previousRecord.dailyCheckIns, nextState.dailyCheckIns, item => item.userId === userId),
    invitationBindings: mergeScopedRecords(previousRecord.invitationBindings, nextState.invitationBindings, item => item.inviteeUserId === userId || item.inviterUserId === userId),
    crowdReviews: mergeScopedRecords(previousRecord.crowdReviews, nextState.crowdReviews, item => item.reviewerId === userId),
    collaborationApplications: previousRecord.collaborationApplications,
    squarePosts: mergeScopedRecords(previousRecord.squarePosts, nextState.squarePosts, item => item.userId === userId),
    squareBoosts: mergeSquareBoostsForNonAdmin(previousRecord.squareBoosts, nextState.squareBoosts, userId),
    squareReports: mergeScopedRecords(previousRecord.squareReports, nextState.squareReports, item => item.reporterId === userId),
    transactions: previousRecord.transactions,
  } as unknown as T
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

export async function mergeSensitiveWelfareState<T extends Record<string, unknown>>(previousState: unknown, nextState: T, request: Request, env: WorkerEnv): Promise<T> {
  if (!isRecord(previousState) || !isRecord(nextState))
    return nextState

  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const nextUsers = Array.isArray(nextState.users)
    ? nextState.users.map((user) => {
        if (!isRecord(user))
          return user

        const previousUser = previousUsers.find(item => isRecord(item) && item.id === user.id)
        const previousPasswordHash = isRecord(previousUser) && typeof previousUser.passwordHash === 'string'
          ? previousUser.passwordHash
          : ''
        if (!previousPasswordHash)
          return user

        return {
          ...user,
          passwordHash: previousPasswordHash,
        }
      })
    : nextState.users

  const previousPolicy = isRecord(previousState.applicationPolicy) ? previousState.applicationPolicy : {}
  const nextPolicy = isRecord(nextState.applicationPolicy) ? nextState.applicationPolicy : previousPolicy
  const previousTurnstileSecretKey = typeof previousPolicy.turnstileSecretKey === 'string'
    ? previousPolicy.turnstileSecretKey.trim()
    : ''
  const nextTurnstileSecretKey = typeof nextPolicy.turnstileSecretKey === 'string'
    ? nextPolicy.turnstileSecretKey.trim()
    : ''

  if (nextTurnstileSecretKey && !isMaskedSecret(nextTurnstileSecretKey) && await canUpdateSensitiveState(previousState, request, env)) {
    return await mergeClientWritableState(previousState, {
      ...nextState,
      users: nextUsers,
      applicationPolicy: nextPolicy,
    }, request, env)
  }

  return await mergeClientWritableState(previousState, {
    ...nextState,
    users: nextUsers,
    applicationPolicy: {
      ...nextPolicy,
      turnstileSecretKey: previousTurnstileSecretKey,
    },
  } as T, request, env)
}

async function decodeStoredState(env: WorkerEnv, storedState: unknown) {
  if (!isEncryptedWelfareStateEnvelope(storedState))
    return storedState

  const secret = stateEncryptionSecret(env)
  if (!secret)
    throw new Error('WELFARE_STATE_SECRET_KEY 未配置，无法读取加密业务状态')

  return JSON.parse(await decryptSecret(storedState.payload, secret))
}

async function encodeStoredState(env: WorkerEnv, state: unknown) {
  const secret = stateEncryptionSecret(env)
  if (!secret)
    return state

  return {
    __encrypted: true,
    payload: await encryptSecret(JSON.stringify(state), secret),
    encryptedAt: new Date().toISOString(),
  } satisfies EncryptedWelfareStateEnvelope
}

export function shouldUseD1(env: WorkerEnv) {
  return !!env.LOCAL_DB && !env.HYPERDRIVE
}

export function getPool(env: WorkerEnv) {
  const connectionString = getConnectionString(env)
  if (!connectionString)
    throw new Error('Hyperdrive binding is required')

  if (!pool || poolKey !== connectionString) {
    poolKey = connectionString
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
      query_timeout: POSTGRES_TIMEOUT_MS,
      statement_timeout: POSTGRES_TIMEOUT_MS,
    })
  }

  return pool
}

async function runSchemaSetup(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_app_state (
          id text primary key,
          state text not null,
          updated_at text not null default current_timestamp,
          version integer not null default 1
        )
      `)
      .run()
    try {
      await env.LOCAL_DB!
        .prepare('alter table welfare_app_state add column version integer not null default 1')
        .run()
    }
    catch {
      // Some D1 runtimes do not support ADD COLUMN IF NOT EXISTS; duplicate-column is harmless here.
    }
    await ensureSnapshotSchema(env)
    return
  }

  await getPool(env).query(`
    create table if not exists welfare_app_state (
      id text primary key,
      state jsonb not null,
      version integer not null default 1,
      updated_at timestamptz not null default now()
    )
  `)
  await getPool(env).query('alter table welfare_app_state add column if not exists version integer not null default 1')
  await ensureSnapshotSchema(env)
}

async function ensureSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    const db = env.LOCAL_DB!
    const current = d1SchemaPromises.get(db)
    if (current)
      return current

    const next = runSchemaSetup(env).catch((error) => {
      if (d1SchemaPromises.get(db) === next)
        d1SchemaPromises.delete(db)
      throw error
    })
    d1SchemaPromises.set(db, next)
    return next
  }

  const key = `pg:${env.HYPERDRIVE?.connectionString ?? ''}`
  if (postgresSchemaPromise && postgresSchemaKey === key)
    return postgresSchemaPromise

  postgresSchemaKey = key
  postgresSchemaPromise = runSchemaSetup(env).catch((error) => {
    if (postgresSchemaKey === key)
      postgresSchemaPromise = undefined
    throw error
  })
  return postgresSchemaPromise
}

async function ensureSnapshotSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_applications (
          id text primary key,
          user_id text not null,
          type text not null,
          status text not null,
          title text not null,
          payload text not null,
          created_at text not null,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
      .run()
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists user_coupons (
          id text primary key,
          user_id text not null,
          name text not null,
          scope text,
          discount_type text,
          discount_rate real not null,
          discount_amount integer,
          payload text not null,
          created_at text not null,
          expires_at text,
          used_at text
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
      .run()
    return
  }

  await getPool(env).query(`
    create table if not exists welfare_applications (
      id text primary key,
      user_id text not null,
      type text not null,
      status text not null,
      title text not null,
      payload text not null,
      created_at text not null,
      updated_at text not null default current_timestamp
    )
  `)
  await getPool(env).query('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
  await getPool(env).query(`
    create table if not exists user_coupons (
      id text primary key,
      user_id text not null,
      name text not null,
      scope text,
      discount_type text,
      discount_rate real not null,
      discount_amount integer,
      payload text not null,
      created_at text not null,
      expires_at text,
      used_at text
    )
  `)
  await getPool(env).query('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
}

function normalizeStateVersion(value: unknown) {
  const version = Math.trunc(Number(value))
  return Number.isFinite(version) && version > 0 ? version : INITIAL_STATE_VERSION
}

export async function readWelfareStateRecord(env: WorkerEnv, options: ReadWelfareStateOptions = {}): Promise<WelfareStateRecord> {
  await ensureSchema(env)

  const record = shouldUseD1(env)
    ? await (async () => {
        const row = await env.LOCAL_DB!
          .prepare('select state, version from welfare_app_state where id = ?1')
          .bind(STATE_KEY)
          .first<{ state: string, version?: number }>()
        return {
          state: row?.state ? JSON.parse(row.state) : {},
          version: normalizeStateVersion(row?.version),
        }
      })()
    : await (async () => {
        const row = (await getPool(env).query<{ state: unknown, version?: number }>(
          'select state, version from welfare_app_state where id = $1',
          [STATE_KEY],
        )).rows[0]
        return {
          state: row?.state ?? {},
          version: normalizeStateVersion(row?.version),
        }
      })()

  const state = await decodeStoredState(env, record.state)
  if (options.syncPointBalances === 'all') {
    await syncUserPointBalancesFromLedger(env, state)
  }
  else if (options.syncPointBalances === 'current-user' && options.currentUserId) {
    await syncUserPointBalancesFromLedger(env, state, [options.currentUserId])
  }
  return {
    state: applyWelfareRetentionPolicy(state).state,
    version: record.version,
  }
}

export async function readWelfareState(env: WorkerEnv, options: ReadWelfareStateOptions = {}) {
  return (await readWelfareStateRecord(env, options)).state
}

async function currentStateVersion(env: WorkerEnv) {
  await ensureSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select version from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ version?: number }>()
    return row ? normalizeStateVersion(row.version) : undefined
  }

  const row = (await getPool(env).query<{ version?: number }>(
    'select version from welfare_app_state where id = $1',
    [STATE_KEY],
  )).rows[0]
  return row ? normalizeStateVersion(row.version) : undefined
}

async function assertExpectedStateVersion(env: WorkerEnv, expectedVersion?: number) {
  if (expectedVersion === undefined)
    return

  const currentVersion = await currentStateVersion(env)
  if (currentVersion !== undefined && currentVersion !== expectedVersion)
    throw new StateVersionConflictError()
}

function applicationSnapshotUpdatedAt(application: WelfareApplication) {
  return application.completedAt
    || application.reviewedAt
    || application.submittedAt
    || application.deliveryRewardedAt
    || application.deliverySubmittedAt
    || application.deliveryClaimedAt
    || application.createdAt
    || now()
}

function couponSnapshotDiscountRate(coupon: UserCoupon) {
  const rate = Number(coupon.discountRate ?? 1)
  return Number.isFinite(rate) ? rate : 1
}

function applicationSnapshotValues(application: WelfareApplication) {
  return [
    application.id,
    application.userId,
    application.type,
    application.status,
    application.title || '未命名申请',
    JSON.stringify(application),
    application.createdAt || now(),
    applicationSnapshotUpdatedAt(application),
  ]
}

function couponSnapshotValues(coupon: UserCoupon) {
  return [
    coupon.id,
    coupon.userId,
    coupon.name || '未命名优惠券',
    coupon.scope ?? null,
    coupon.discountType ?? 'rate',
    couponSnapshotDiscountRate(coupon),
    coupon.discountAmount ?? null,
    JSON.stringify(coupon),
    coupon.createdAt || now(),
    coupon.expiresAt ?? null,
    coupon.usedAt ?? null,
  ]
}

async function runD1Statements(env: WorkerEnv, statements: Array<ReturnType<D1Database['prepare']>>) {
  if (!statements.length)
    return

  const localDb = env.LOCAL_DB! as D1Database & {
    batch?: (items: Array<ReturnType<D1Database['prepare']>>) => Promise<unknown[]>
  }
  if (typeof localDb.batch === 'function') {
    await localDb.batch(statements)
    return
  }

  for (const statement of statements)
    await statement.run()
}

function postgresValuesPlaceholders(rowCount: number, columnCount: number) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const offset = rowIndex * columnCount
    return `(${Array.from({ length: columnCount }, (__, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`
  }).join(', ')
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size))
  return result
}

async function syncD1StateSnapshots(env: WorkerEnv, applications: WelfareApplication[], coupons: UserCoupon[], deletedApplicationIds: string[], deletedCouponIds: string[]) {
  const localDb = env.LOCAL_DB!
  await runD1Statements(env, [
    ...applications.map(application => localDb
      .prepare(`
        insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        on conflict (id)
        do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .bind(...applicationSnapshotValues(application))),
    ...coupons.map(coupon => localDb
      .prepare(`
        insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        on conflict (id)
        do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
      `)
      .bind(...couponSnapshotValues(coupon))),
    ...deletedApplicationIds.map(id => localDb
      .prepare('delete from welfare_applications where id = ?1')
      .bind(id)),
    ...deletedCouponIds.map(id => localDb
      .prepare('delete from user_coupons where id = ?1')
      .bind(id)),
  ])
}

async function syncPostgresStateSnapshots(env: WorkerEnv, applications: WelfareApplication[], coupons: UserCoupon[], deletedApplicationIds: string[], deletedCouponIds: string[]) {
  const pool = getPool(env)
  if (deletedApplicationIds.length)
    await pool.query('delete from welfare_applications where id = any($1)', [deletedApplicationIds])
  if (deletedCouponIds.length)
    await pool.query('delete from user_coupons where id = any($1)', [deletedCouponIds])

  for (const batch of chunks(applications, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
    const values = batch.flatMap(applicationSnapshotValues)
    await pool.query(
      `
        insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
        values ${postgresValuesPlaceholders(batch.length, 8)}
        on conflict (id)
        do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
      `,
      values,
    )
  }
  for (const batch of chunks(coupons, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
    const values = batch.flatMap(couponSnapshotValues)
    await pool.query(
      `
        insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
        values ${postgresValuesPlaceholders(batch.length, 11)}
        on conflict (id)
        do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
      `,
      values,
    )
  }
}

function snapshotItems<T extends { id: string }>(state: unknown, key: 'applications' | 'coupons') {
  return isRecord(state) && Array.isArray(state[key])
    ? state[key].filter((item): item is T => isRecord(item) && typeof item.id === 'string')
    : []
}

function changedSnapshotItems<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return nextItems

  const previousItems = snapshotItems<T>(previousState, key)
  const previousPayloadById = new Map(previousItems.map(item => [item.id, JSON.stringify(item)]))
  return nextItems.filter(item => previousPayloadById.get(item.id) !== JSON.stringify(item))
}

function deletedSnapshotIds<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return []

  const nextIds = new Set(nextItems.map(item => item.id))
  return snapshotItems<T>(previousState, key)
    .filter(item => !nextIds.has(item.id))
    .map(item => item.id)
}

async function syncStateSnapshots(env: WorkerEnv, state: unknown, previousState?: unknown) {
  if (!isRecord(state))
    return

  const allApplications = snapshotItems<WelfareApplication>(state, 'applications')
  const allCoupons = snapshotItems<UserCoupon>(state, 'coupons')
  const applications = previousState === undefined ? allApplications : changedSnapshotItems(previousState, allApplications, 'applications')
  const coupons = previousState === undefined ? allCoupons : changedSnapshotItems(previousState, allCoupons, 'coupons')
  const deletedApplicationIds = previousState === undefined ? [] : deletedSnapshotIds(previousState, allApplications, 'applications')
  const deletedCouponIds = previousState === undefined ? [] : deletedSnapshotIds(previousState, allCoupons, 'coupons')
  if (!applications.length && !coupons.length && !deletedApplicationIds.length && !deletedCouponIds.length)
    return

  if (shouldUseD1(env)) {
    await syncD1StateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds)
    return
  }

  await syncPostgresStateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds)
}

export async function writeWelfareState(env: WorkerEnv, state: unknown, options: WriteWelfareStateOptions = {}) {
  await ensureSchema(env)
  await assertExpectedStateVersion(env, options.expectedVersion)
  await backfillPointTransactionsFromState(env, state)
  const storedState = await encodeStoredState(env, state)
  const nextVersion = options.expectedVersion !== undefined
    ? options.expectedVersion + 1
    : (await currentStateVersion(env) ?? 0) + 1

  if (shouldUseD1(env)) {
    if (options.expectedVersion !== undefined) {
      const result = await env.LOCAL_DB!
        .prepare(`
          update welfare_app_state
          set state = ?2, updated_at = current_timestamp, version = ?3
          where id = ?1 and version = ?4
        `)
        .bind(STATE_KEY, JSON.stringify(storedState), nextVersion, options.expectedVersion)
        .run() as { meta?: { changes?: number } }
      if (!result.meta?.changes)
        throw new StateVersionConflictError()
    }
    else {
      await env.LOCAL_DB!
        .prepare(`
          insert into welfare_app_state (id, state, updated_at, version)
          values (?1, ?2, current_timestamp, ?3)
          on conflict (id)
          do update set state = excluded.state, updated_at = current_timestamp, version = excluded.version
        `)
        .bind(STATE_KEY, JSON.stringify(storedState), nextVersion)
        .run()
    }
    await syncStateSnapshots(env, state, options.previousState)
    return nextVersion
  }

  if (options.expectedVersion !== undefined) {
    const result = await getPool(env).query<{ version: number }>(
      `
        update welfare_app_state
        set state = $2::jsonb, updated_at = now(), version = version + 1
        where id = $1 and version = $3
        returning version
      `,
      [STATE_KEY, JSON.stringify(storedState), options.expectedVersion],
    )
    const version = result.rows[0]?.version
    if (!version)
      throw new StateVersionConflictError()
    await syncStateSnapshots(env, state, options.previousState)
    return normalizeStateVersion(version)
  }

  await getPool(env).query(
    `
      insert into welfare_app_state (id, state, updated_at, version)
      values ($1, $2::jsonb, now(), $3)
      on conflict (id)
      do update set state = excluded.state, updated_at = now(), version = excluded.version
    `,
    [STATE_KEY, JSON.stringify(storedState), nextVersion],
  )
  await syncStateSnapshots(env, state, options.previousState)
  return nextVersion
}

function sanitizeTransientStateTransactions(state: unknown) {
  if (isRecord(state) && Array.isArray(state.transactions))
    state.transactions = []
}

async function writeWelfareStateWithAtomicPointTransactions(
  env: WorkerEnv,
  state: unknown,
  pointTransactions: AtomicPointTransaction[],
  options: { expectedVersion: number, previousState?: unknown },
) {
  await ensureSchema(env)
  await ensurePointTransactionSchema(env)
  await assertExpectedStateVersion(env, options.expectedVersion)
  sanitizeTransientStateTransactions(state)
  const storedState = await encodeStoredState(env, state)
  const storedStateJson = JSON.stringify(storedState)
  const nextVersion = options.expectedVersion + 1

  if (shouldUseD1(env)) {
    const localDb = env.LOCAL_DB! as D1Database & {
      batch: (statements: Array<ReturnType<D1Database['prepare']>>) => Promise<Array<{ meta?: { changes?: number } }>>
    }
    const statements = [
      localDb
        .prepare(`
          update welfare_app_state
          set state = ?2, updated_at = current_timestamp, version = ?3
          where id = ?1 and version = ?4
        `)
        .bind(STATE_KEY, storedStateJson, nextVersion, options.expectedVersion),
      ...pointTransactions.map(tx =>
        localDb
          .prepare(`
            insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
            select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
            where exists (select 1 from welfare_app_state where id = ?9 and version = ?10 and state = ?11)
            on conflict (id) do nothing
          `)
          .bind(tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt, STATE_KEY, nextVersion, storedStateJson),
      ),
    ]
    const results = await localDb.batch(statements)
    if (!results[0]?.meta?.changes)
      throw new StateVersionConflictError()
    await syncStateSnapshots(env, state, options.previousState)
    return nextVersion
  }

  const client = await getPool(env).connect()
  try {
    await client.query('begin')
    const result = await client.query<{ version: number }>(
      `
        update welfare_app_state
        set state = $2::jsonb, updated_at = now(), version = version + 1
        where id = $1 and version = $3
        returning version
      `,
      [STATE_KEY, storedStateJson, options.expectedVersion],
    )
    const version = result.rows[0]?.version
    if (!version) {
      await client.query('rollback')
      throw new StateVersionConflictError()
    }

    for (const tx of pointTransactions) {
      await client.query(`
        insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do nothing
      `, [tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt])
    }

    await client.query('commit')
    await syncStateSnapshots(env, state, options.previousState)
    return normalizeStateVersion(version)
  }
  catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
  finally {
    client.release()
  }
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

  return json({
    error: error instanceof Error ? error.message : '服务端错误',
  }, 500)
}

export function assertStateShape(state: unknown): asserts state is Record<string, unknown> {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('state must be an object')

  const record = state as Record<string, unknown>
  for (const key of ['users', 'applications', 'studentVerifications', 'educationEmailChallenges', 'crowdReviews', 'collaborationApplications', 'squarePosts', 'squareBoosts', 'squareReports', 'transactions']) {
    if (record[key] !== undefined && !Array.isArray(record[key]))
      throw new Error(`${key} must be an array`)
  }

  if (record.oauth !== undefined && (!record.oauth || typeof record.oauth !== 'object' || Array.isArray(record.oauth)))
    throw new Error('oauth must be an object')
}

export function outOfScopeRecordLabel(state: Record<string, unknown>, userId: string) {
  const scopedCollections: Array<{
    key: string
    label: string
    belongsToUser: (item: Record<string, unknown>) => boolean
  }> = [
    { key: 'studentVerifications', label: '认证申请数据', belongsToUser: item => item.userId === userId },
    { key: 'educationEmailChallenges', label: '教育邮箱认证数据', belongsToUser: item => item.userId === userId },
    { key: 'coupons', label: '优惠券数据', belongsToUser: item => item.userId === userId },
    { key: 'dailyCheckIns', label: '签到数据', belongsToUser: item => item.userId === userId },
    { key: 'invitationBindings', label: '邀请绑定数据', belongsToUser: item => item.inviteeUserId === userId || item.inviterUserId === userId },
    { key: 'crowdReviews', label: '协作建议数据', belongsToUser: item => item.reviewerId === userId },
    { key: 'collaborationApplications', label: '协作申请数据', belongsToUser: item => item.userId === userId },
    { key: 'squareReports', label: '广场举报数据', belongsToUser: item => item.reporterId === userId },
    { key: 'transactions', label: '积分流水数据', belongsToUser: item => item.userId === userId },
  ]

  for (const collection of scopedCollections) {
    const value = state[collection.key]
    if (!Array.isArray(value))
      continue
    if (value.some(item => isRecord(item) && !collection.belongsToUser(item)))
      return collection.label
  }

  return ''
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

function formatWorkerDate(value?: string) {
  if (!value)
    return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function appendWorkerStudentSupplementNotes(existingNotes: string, supplementNotes: string, supplementedAt: string) {
  const previousNotes = existingNotes.trim() || '<p>（此前未填写材料说明）</p>'
  return `${previousNotes}<h3>补充资料（${formatWorkerDate(supplementedAt)}）</h3>${supplementNotes}`
}

function stateUsers(state: Partial<WelfareState>) {
  return Array.isArray(state.users) ? state.users : []
}

function stateApplications(state: Partial<WelfareState>) {
  return Array.isArray(state.applications) ? state.applications : []
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

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match)
    return undefined

  return Number(match[1]) * 60 + Number(match[2])
}

function isWithinOpenWindow(policy: { openStart: string, openEnd: string }, current = new Date()) {
  const start = timeToMinutes(policy.openStart)
  const end = timeToMinutes(policy.openEnd)
  if (start === undefined || end === undefined || start === end)
    return true

  const currentMinutes = current.getHours() * 60 + current.getMinutes()
  if (start < end)
    return currentMinutes >= start && currentMinutes <= end
  return currentMinutes >= start || currentMinutes <= end
}

function isActiveApplicationStatus(status: string) {
  return ['draft', 'reserved', 'pending_review', 'needs_supplement', 'processing', 'answered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(status)
}

function isActiveStudentStatus(status: string) {
  return ['pending', 'needs_supplement'].includes(status)
}

function activeRequestCountForState(state: Partial<WelfareState>, userId: string) {
  return stateApplications(state).filter(item => item.userId === userId && isActiveApplicationStatus(item.status)).length
    + (state.studentVerifications ?? []).filter(item => item.userId === userId && isActiveStudentStatus(item.status)).length
}

function recentSubmissionCooldownUntilForState(state: Partial<WelfareState>, userId: string, createdAt: string) {
  const cooldownMs = (state.applicationPolicy?.submitCooldownSeconds ?? 0) * 1000
  if (cooldownMs <= 0)
    return undefined

  const lastSubmittedAt = stateApplications(state)
    .filter(item => item.userId === userId && item.status !== 'draft')
    .map(item => new Date(item.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0]
  if (!lastSubmittedAt)
    return undefined

  const until = lastSubmittedAt + cooldownMs
  if (new Date(createdAt).getTime() < until)
    return new Date(until).toISOString()
}

function rejectionFeeWaiverBlockedUntilForState(state: Partial<WelfareState>, userId: string) {
  const currentTime = Date.now()
  return stateApplications(state)
    .filter(item => item.userId === userId && !!item.waiveRejectionReviewFeeBlockedUntil)
    .map(item => item.waiveRejectionReviewFeeBlockedUntil!)
    .filter((value) => {
      const time = new Date(value).getTime()
      return Number.isFinite(time) && time > currentTime
    })
    .sort()
    .at(-1)
}

function assertCanCreateRequestForState(state: Partial<WelfareState>, userId: string) {
  const systemConfig = state.systemConfig
  if (systemConfig && !systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)

  if (activeRequestCountForState(state, userId) >= MAX_ACTIVE_USER_REQUESTS)
    throw new Error(`一个用户最多只能同时创建 ${MAX_ACTIVE_USER_REQUESTS} 个待处理请求`)
}

function assertApplicationPolicyForState(state: Partial<WelfareState>, input: {
  userId: string
  type: SubmitApplicationPayload['type']
  title: string
  description: string
  createdAt: string
  powNonce?: string
  turnstileVerified?: boolean
}) {
  const systemConfig = state.systemConfig
  if (systemConfig && !systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)

  const policy = state.applicationPolicy
  const kindPolicy = policy?.categories?.[input.type]
  if (!policy || !kindPolicy)
    throw new Error('申请策略未配置')
  if (!kindPolicy.enabled)
    throw new Error(kindPolicy.closedReason || `${input.type.toUpperCase()} 申请暂未开放`)
  if (!isWithinOpenWindow(kindPolicy, new Date(input.createdAt)))
    throw new Error(`${input.type.toUpperCase()} 申请不在当前开放时间段`)

  const plainLength = richTextToPlainText(input.description).trim().length
  if (plainLength < policy.minDescriptionChars)
    throw new Error(`申请内容不得少于 ${policy.minDescriptionChars} 字`)

  const cooldownUntil = recentSubmissionCooldownUntilForState(state, input.userId, input.createdAt)
  if (cooldownUntil)
    throw new Error(`提交过于频繁，请在 ${cooldownUntil} 后再提交`)

  const today = localDateKey(input.createdAt)
  const sameDayApplications = stateApplications(state)
    .filter(item => item.type === input.type && item.status !== 'draft' && localDateKey(item.createdAt) === today)
  if (kindPolicy.dailyLimit > 0 && sameDayApplications.length >= kindPolicy.dailyLimit)
    throw new Error(`${input.type.toUpperCase()} 今日申请名额已满`)
  if (kindPolicy.perUserDailyLimit > 0 && sameDayApplications.filter(item => item.userId === input.userId).length >= kindPolicy.perUserDailyLimit)
    throw new Error(`你今日 ${input.type.toUpperCase()} 申请次数已达上限`)

  if (policy.turnstileEnabled && !input.turnstileVerified)
    throw new Error('请先完成人机验证')
  if (policy.powEnabled) {
    const challenge = applicationPowChallenge(input)
    if (!isValidApplicationPow(challenge, input.powNonce, policy.powDifficulty))
      throw new Error('PoW 校验未通过，请重新提交')
  }
}

function squareDiscountSnapshot(cost: number, shareToSquare: boolean) {
  if (!shareToSquare)
    return { cost, discountRate: 1, discountAmount: 0 }

  const payableCost = applyRateDiscount(cost, SQUARE_SHARE_DISCOUNT_RATE)
  return {
    cost: payableCost,
    discountRate: SQUARE_SHARE_DISCOUNT_RATE,
    discountAmount: Math.max(0, cost - payableCost),
  }
}

function applyCouponDiscount(cost: number, coupon?: UserCoupon) {
  if (!coupon)
    return { payableCost: cost, discountAmount: 0 }

  let discountAmount = 0
  if (coupon.discountType === 'fixed_points' || coupon.discountType === 'fixed_ldc') {
    discountAmount = coupon.discountAmount ?? 0
  }
  else {
    const payableCost = applyRateDiscount(cost, coupon.discountRate)
    discountAmount = Math.max(0, cost - payableCost)
  }

  if (coupon.maxDiscount)
    discountAmount = Math.min(discountAmount, coupon.maxDiscount)

  const payableCost = Math.max(0, cost - Math.min(cost, discountAmount))
  return {
    payableCost,
    discountAmount: Math.max(0, cost - payableCost),
  }
}

function availableResourceCoupon(state: Partial<WelfareState>, userId: string, couponId: string | undefined, cost: number, resourceTypes: ResourceType[], createdAt: string) {
  if (!couponId)
    return undefined

  const coupon = (state.coupons ?? []).find(item => item.id === couponId)
  if (!coupon || coupon.userId !== userId || coupon.usedAt)
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= new Date(createdAt).getTime())
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.scope && coupon.scope !== 'general' && coupon.scope !== 'resource')
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.minSpend && cost < coupon.minSpend)
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.resourceTypes?.length && !resourceTypes.some(type => coupon.resourceTypes?.includes(type)))
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  return coupon
}

function resourceCheckoutSnapshotForState(state: Partial<WelfareState>, userId: string, items: SubmitResourceApplicationPayload['resourceItems'], couponId: string | undefined, createdAt: string, shareToSquare = false) {
  const baseCost = items.reduce((sum, item) => sum + estimatedResourceItemCost(item), 0)
  const activityCost = items.reduce((sum, item) => sum + discountedResourceItemCost(item, createdAt), 0)
  const resourceTypes = Array.from(new Set(items.map(item => item.resourceType)))
  const coupon = availableResourceCoupon(state, userId, couponId, activityCost, resourceTypes, createdAt)
  const couponResult = applyCouponDiscount(activityCost, coupon)
  const squareResult = squareDiscountSnapshot(couponResult.payableCost, shareToSquare)
  return {
    baseCost,
    activityCost,
    cost: squareResult.cost,
    activityDiscountRate: baseCost > 0 ? activityCost / baseCost : 1,
    activityDiscountAmount: Math.max(0, baseCost - activityCost),
    coupon,
    couponDiscountAmount: couponResult.discountAmount,
    squareDiscountRate: squareResult.discountRate,
    squareDiscountAmount: squareResult.discountAmount,
  }
}

function assertResourceTypeCanApplyForState(state: Partial<WelfareState>, resourceType: ResourceType, user: User) {
  const config = RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === resourceType)
  if (!config)
    throw new Error('资源类型无效')
  const userLevel = buildUserLevelCard(user, {
    applications: stateApplications(state),
    studentVerifications: state.studentVerifications ?? [],
  })
  if (!canApplyResourceType(config, userLevel.priority))
    throw new Error(`${config.displayName} 暂不可申请`)
}

function buildResourceDescription(payload: SubmitResourceApplicationPayload) {
  return sanitizeWorkerRichText(payload.reason || payload.businessBackground)
}

function buildResourceTermsAcceptances(resourceTypes: ResourceType[], acceptedTermIds: SubmitResourceApplicationPayload['acceptedTermIds'], userId: string, acceptedAt: string) {
  const requiredTerms = termsForResourceTypes(resourceTypes)
  const accepted = new Set(acceptedTermIds)
  const missing = requiredTerms.filter(term => !accepted.has(term.id))
  if (missing.length)
    throw new Error(`请确认所有条款：${missing.map(term => term.title).join('、')}`)

  return requiredTerms.map(term => ({
    termId: term.id,
    version: term.version,
    acceptedBy: userId,
    acceptedAt,
  }))
}

function buildResourceSquarePost(application: WelfareApplication, payload: SubmitResourceApplicationPayload, actualResourceTypes: ResourceType[], squarePostId: string, createdAt: string): SquarePost {
  return {
    id: squarePostId,
    userId: application.userId,
    type: 'application_template',
    title: application.title,
    content: sanitizeWorkerRichText(payload.squarePostContent || payload.reason),
    applicationId: application.id,
    requestType: 'resource',
    template: {
      title: application.title,
      departmentId: payload.departmentId,
      projectId: payload.projectId,
      reason: payload.reason,
      businessBackground: payload.businessBackground,
      urgency: payload.urgency,
      expectedEffectiveAt: payload.expectedEffectiveAt,
      costCenter: payload.costCenter,
      ownerId: payload.ownerId,
      duration: payload.duration,
      selectedResourceTypes: actualResourceTypes,
      resourceItems: payload.resourceItems.map(item => ({
        resourceType: item.resourceType,
        resourceSubtype: item.resourceSubtype,
        payload: item.payload,
        requestedQuota: item.requestedQuota,
        requestedPermission: item.requestedPermission,
        duration: item.duration,
      })),
      acceptedTermIds: payload.acceptedTermIds,
    },
    createdAt,
    updatedAt: createdAt,
  }
}

function stateVersionPayload(version: number) {
  return { version }
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

function ensureApplications(state: Partial<WelfareState>) {
  state.applications ??= []
  return state.applications
}

function ensureSquarePosts(state: Partial<WelfareState>) {
  state.squarePosts ??= []
  return state.squarePosts
}

function ensureCoupons(state: Partial<WelfareState>) {
  state.coupons ??= []
  return state.coupons
}

function ensureDailyCheckIns(state: Partial<WelfareState>) {
  state.dailyCheckIns ??= []
  return state.dailyCheckIns
}

function ensureInvitationBindings(state: Partial<WelfareState>) {
  state.invitationBindings ??= []
  return state.invitationBindings
}

function ensureSquareBoosts(state: Partial<WelfareState>) {
  state.squareBoosts ??= []
  return state.squareBoosts
}

function ensureSquareReports(state: Partial<WelfareState>) {
  state.squareReports ??= []
  return state.squareReports
}

function ensureStudentVerifications(state: Partial<WelfareState>) {
  state.studentVerifications ??= []
  return state.studentVerifications
}

function normalizeInviteCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function createUserCouponFromRule(userId: string, source: UserCoupon['source'], template: Pick<NonNullable<WelfareState['couponTemplates']>[number], 'id' | 'name' | 'rule' | 'ttlDays'>, createdAt = now(), codeId?: string): UserCoupon {
  const ttlDays = Math.max(0, Math.min(3650, Math.trunc(Number(template.ttlDays ?? DAILY_CHECK_IN_COUPON_TTL_DAYS))))
  return {
    id: createId('coupon'),
    userId,
    name: template.name,
    discountRate: Math.max(0.01, Math.min(1, Number(template.rule.discountRate ?? 1))),
    source,
    scope: template.rule.scope,
    discountType: template.rule.discountType ?? 'rate',
    discountAmount: template.rule.discountAmount,
    resourceTypes: template.rule.resourceTypes,
    minSpend: template.rule.minSpend,
    maxDiscount: template.rule.maxDiscount,
    templateId: template.id,
    codeId,
    createdAt,
    expiresAt: ttlDays > 0 ? addDays(createdAt, ttlDays) : undefined,
  }
}

function createDailyCoupon(userId: string, source: UserCoupon['source'], discountRate: number, createdAt: string) {
  return {
    id: createId('coupon'),
    userId,
    name: source === 'daily_streak_7' ? '连续签到 7 天福利券' : '连续签到 3 天福利券',
    discountRate,
    source,
    scope: 'general',
    discountType: 'rate',
    createdAt,
    expiresAt: addDays(createdAt, DAILY_CHECK_IN_COUPON_TTL_DAYS),
  } satisfies UserCoupon
}

function normalizeVerificationType(value: unknown) {
  return value === 'frontline' ? 'frontline' : 'student'
}

function verificationTypeLabel(type: 'student' | 'frontline') {
  return type === 'frontline' ? '一线认证' : '学生认证'
}

function normalizeStudentEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function assertEducationEmail(value: string) {
  assertEducationEmailAddress(value)
}

function normalizeClientRequestId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : ''
}

async function studentVerificationIdForRequest(userId: string, clientRequestId: string) {
  if (!clientRequestId)
    return createId('stu')

  const digest = await sha256Hex(`student-verification:${userId}:${clientRequestId}`)
  return `stu_${digest.slice(0, 32)}`
}

function markWorkerEducationEmailVerified(verification: StudentVerification, verifiedAt: string, source: 'mail_auto' | 'admin_approved') {
  if (!verification.educationEmail)
    return

  verification.educationEmailVerified = true
  verification.educationEmailVerifiedAt ||= verifiedAt
  verification.educationEmailVerificationSource ||= source
}

function positiveStudentReviewFee(verification: StudentVerification) {
  const fee = Math.trunc(Number(verification.reviewFee ?? STUDENT_REVIEW_FEE))
  if (!Number.isFinite(fee) || fee <= 0)
    throw new Error('认证审核费无效')

  return fee
}

function latestEducationEmailChallengeForState(state: Partial<WelfareState>, userId: string, email: string) {
  return (state.educationEmailChallenges ?? [])
    .filter((item) => {
      if (item.userId !== userId || item.email !== email)
        return false
      const expiresAt = new Date(item.expiresAt).getTime()
      return Number.isFinite(expiresAt) && expiresAt > Date.now()
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

function assertVerifiedEducationEmailChallengeForState(challenge: EducationEmailChallenge | undefined, wantsVerified: boolean) {
  if (!wantsVerified)
    throw new Error('邮箱证明需要先通过收件 API 验证后才能提交')
  if (!challenge?.verifiedAt)
    throw new Error('邮箱证明尚未通过收件 API 验证，请先发送证明邮件并完成验证')
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
  if (totalAttachmentBytes(attachmentsFromPayload(payload.attachments)) > MAX_ATTACHMENT_BYTES)
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
      description: buildResourceDescription(payload),
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
    description: buildResourceDescription(payload),
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
      ensureSquarePosts(state).unshift(buildResourceSquarePost(application, payload, actualResourceTypes, squarePostId, createdAt))
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
  return commitCurrentUserAction(request, env, async (state, user, payload) => {
    const postId = typeof payload.postId === 'string' ? payload.postId : ''
    const post = ensureSquarePosts(state).find(item => item.id === postId)
    if (!post)
      throw new Error('广场内容不存在')
    if (post.userId === user.id)
      throw new Error('不能为自己的广场内容拼一刀')
    const boosts = ensureSquareBoosts(state)
    if (boosts.some(item => item.postId === postId && item.userId === user.id))
      throw new Error('你已经为该内容助力过')
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
    await appendTrustedPointTransaction(env, state, {
      id: transactionId('square_boost', boost.id),
      userId: user.id,
      delta: SQUARE_BOOST_REWARD_POINTS,
      type: 'grant',
      reason: '广场拼一刀助力奖励',
      refId: boost.id,
      createdAt,
    })
    return { boost }
  })
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
    if (!['needs_supplement', 'answered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持补充材料')
    if (['submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status) && application.type !== 'resource')
      throw new Error('只有资源工单支持该阶段补充材料')
    if (application.status === 'answered') {
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

function ensureCollaborationApplications(state: Partial<WelfareState>) {
  state.collaborationApplications ??= []
  return state.collaborationApplications
}

function safeAttachmentUrl(value: unknown) {
  if (typeof value !== 'string')
    return undefined
  const text = value.trim()
  if (!text)
    return undefined
  if (text.startsWith('/api/uploads/') || text.startsWith('/uploads/'))
    return text
  return undefined
}

function attachmentsFromPayload(value: unknown): AttachmentMeta[] {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const type = typeof item.type === 'string' ? item.type : 'application/octet-stream'
      return {
        id: typeof item.id === 'string' ? item.id : createId('att'),
        name: typeof item.name === 'string' ? item.name : '附件',
        size: Math.max(0, Math.trunc(Number(item.size || 0))),
        type,
        r2Key: typeof item.r2Key === 'string' ? item.r2Key : undefined,
        url: safeAttachmentUrl(item.url),
        dataUrl: type.startsWith('image/') && isImageDataUrl(item.dataUrl) ? item.dataUrl : undefined,
      }
    })
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
}

function totalAttachmentBytes(attachments: AttachmentMeta[]) {
  return attachments.reduce((sum, item) => sum + Math.max(0, Math.trunc(Number(item.size || 0))), 0)
}

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

function pushApplicationMessage(application: WelfareApplication, userId: string, type: ApplicationMessageType, content: string, attachments: AttachmentMeta[] = []) {
  application.messages ??= []
  application.messages.push({
    id: createId('msg'),
    applicationId: application.id,
    userId,
    type,
    content,
    attachments,
    createdAt: now(),
  })
}

function isDeliveryApplication(application: WelfareApplication) {
  return ['code', 'pro'].includes(application.type)
    && application.status === 'answered'
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
  const retained = applyWelfareRetentionPolicy(nextState).state
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
  const retained = applyWelfareRetentionPolicy(nextState).state
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

async function readCurrentUserApplicationSnapshots(env: WorkerEnv, userId: string) {
  await ensureSchema(env)
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare('select payload from welfare_applications where user_id = ?1 order by created_at desc, id desc')
      .bind(userId)
      .all<{ payload: string }>()
    return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
  }

  const result = await getPool(env).query<{ payload: string }>(
    'select payload from welfare_applications where user_id = $1 order by created_at desc, id desc',
    [userId],
  )
  return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
}

async function readCurrentUserCouponSnapshots(env: WorkerEnv, userId: string) {
  await ensureSchema(env)
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare('select payload from user_coupons where user_id = ?1 order by created_at desc, id desc')
      .bind(userId)
      .all<{ payload: string }>()
    return (result.results ?? []).map(row => JSON.parse(row.payload) as UserCoupon)
  }

  const result = await getPool(env).query<{ payload: string }>(
    'select payload from user_coupons where user_id = $1 order by created_at desc, id desc',
    [userId],
  )
  return result.rows.map(row => JSON.parse(row.payload) as UserCoupon)
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

  const snapshotApplications = await readCurrentUserApplicationSnapshots(env, userId)
  const applications = snapshotApplications.length
    ? snapshotApplications
    : sanitizeOwnedApplications(stateApplications(sourceState), userId)
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
  const { state, version } = await readWelfareStateRecord(env)
  const sourceState = state as Partial<WelfareState>
  const user = await authenticatedUser(request, env, sourceState)
  assertAdminUser(user)
  await syncUserPointBalancesFromLedger(env, sourceState)
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
  return json({
    applications: current.state.applications ?? [],
    crowdReviews: current.state.crowdReviews ?? [],
    users: current.state.users ?? [],
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

function adminTargetUser(state: Partial<WelfareState>, userId: unknown) {
  const user = stateUsers(state).find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')
  return user
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

function adminApplication(state: Partial<WelfareState>, applicationId: unknown) {
  const application = stateApplications(state).find(item => item.id === applicationId)
  if (!application)
    throw new Error('申请不存在')
  return application
}

function sanitizeMessageType(value: unknown): ApplicationMessageType {
  return value === 'comment' || value === 'supplement' || value === 'result_submission' || value === 'system' ? value : 'comment'
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
    item.rejectReason = note || undefined
    item.provisionStatus = ['approved', 'adjusted_approved'].includes(status) ? 'pending' : 'not_required'
    item.updatedAt = now()
    application.status = aggregateResourceApplicationStatusForWorker(application.resourceItems ?? [])
    if (['approved', 'partial_approved', 'rejected'].includes(application.status)) {
      application.reviewedAt = item.updatedAt
      application.completedAt = item.updatedAt
    }
    application.answer = `<p>资源申请审批已更新：${resourceTypeLabel(item.resourceType)} / ${item.resourceSubtype} / ${resourceApprovalStatusText(item.approvalStatus)}。</p>`
    return { applicationId: application.id, item }
  })
}

function aggregateResourceApplicationStatusForWorker(items: Pick<ApplicationItem, 'approvalStatus'>[]) {
  if (!items.length)
    return 'draft' as WelfareApplication['status']
  if (items.every(item => item.approvalStatus === 'rejected'))
    return 'rejected' as WelfareApplication['status']
  if (items.every(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus)))
    return 'approved' as WelfareApplication['status']
  if (items.some(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus)) && items.every(item => item.approvalStatus !== 'pending'))
    return 'partial_approved' as WelfareApplication['status']
  return 'in_review' as WelfareApplication['status']
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
    item.provisionStatus = 'completed'
    item.provisionNote = typeof payload.note === 'string' ? payload.note.trim() : undefined
    item.provisionCompletedAt = now()
    item.updatedAt = item.provisionCompletedAt
    return { applicationId: application.id, item }
  })
}

export async function answerAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, async (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')
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
    application.status = 'answered'
    application.answer = answer
    application.reviewedAt = reviewedAt
    application.processingStartedAt ??= reviewedAt
    pushApplicationMessage(application, admin.id, 'system', answer)
    return { applicationId: application.id }
  })
}

export async function rejectAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, async (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')
    const reason = sanitizeWorkerRichText(payload.reason)
    if (isRichTextEmpty(reason))
      throw new Error('请填写退回原因')
    const reviewedAt = now()
    const fraudulent = !!payload.fraudulent
    application.status = 'rejected'
    application.rejectionFraudulent = fraudulent
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
    application.answer = reason
    application.reviewedAt = reviewedAt
    pushApplicationMessage(application, admin.id, 'system', reason)
    return { applicationId: application.id }
  })
}

export async function completeAdminApplicationAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (application.status !== 'answered')
      throw new Error('只有已答复的申请可以标记完成')
    const completedAt = now()
    application.status = 'completed'
    application.completedAt = completedAt
    pushApplicationMessage(application, admin.id, 'system', '<p>管理员已确认所有结果，申请完成。</p>')
    return { applicationId: application.id }
  })
}

export async function requestAdminApplicationSupplementAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('只有审核中的申请可以请求补充材料')
    const content = sanitizeWorkerRichText(payload.content)
    if (isRichTextEmpty(content))
      throw new Error('请填写补充材料要求')
    application.status = 'needs_supplement'
    application.processingStartedAt ??= now()
    pushApplicationMessage(application, admin.id, 'system', content)
    return { applicationId: application.id }
  })
}

function appendWorkerApplicationMessage(application: WelfareApplication, user: User, payload: Record<string, unknown>) {
  const content = sanitizeWorkerRichText(payload.content)
  if (isRichTextEmpty(content))
    throw new Error('请输入消息内容')
  const attachments = attachmentsFromPayload(payload.attachments)
  if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
    throw new Error('附件总大小不能超过 200MB')
  pushApplicationMessage(application, user.id, sanitizeMessageType(payload.type), content, attachments)
  return { applicationId: application.id }
}

export async function addCurrentUserApplicationMessageAction(request: Request, env: WorkerEnv) {
  return commitCurrentUserAction(request, env, (state, user, payload) => {
    const application = stateApplications(state).find(item => item.id === payload.applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.userId !== user.id)
      throw new Error('只能回复自己的申请工单')
    if (!['pending_review', 'processing', 'needs_supplement', 'answered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持追加消息')
    if (payload.type === 'result_submission' || payload.type === 'system')
      throw new Error('用户不能提交管理员结果消息')
    return appendWorkerApplicationMessage(application, user, payload)
  })
}

export async function addAdminApplicationMessageAction(request: Request, env: WorkerEnv) {
  return commitAdminStateAction(request, env, (state, admin, payload) => {
    const application = adminApplication(state, payload.applicationId)
    return appendWorkerApplicationMessage(application, admin, payload)
  })
}

export async function reviewAdminStudentVerificationAction(request: Request, env: WorkerEnv) {
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

function normalizeWorkerCouponRule(input: Record<string, unknown>) {
  const scope: CouponScope = input.scope === 'recharge' || input.scope === 'general' ? input.scope : 'resource'
  const discountType: CouponDiscountType = input.discountType === 'fixed_points' || input.discountType === 'fixed_ldc' || input.discountType === 'rate'
    ? input.discountType
    : scope === 'recharge' ? 'fixed_ldc' : 'rate'
  const knownTypes = new Set(RESOURCE_TYPE_CONFIGS.map(item => item.resourceType))
  return {
    scope,
    discountType,
    discountRate: Math.max(0.01, Math.min(1, Number(input.discountRate || 1))),
    discountAmount: Math.max(0, Math.trunc(Number(input.discountAmount || 0))),
    resourceTypes: Array.isArray(input.resourceTypes) ? Array.from(new Set(input.resourceTypes.filter((item): item is ResourceType => knownTypes.has(item as ResourceType)))) : [],
    minSpend: Math.max(0, Math.trunc(Number(input.minSpend || 0))),
    maxDiscount: Math.max(0, Math.trunc(Number(input.maxDiscount || 0))),
  }
}

function createCouponCodeValue() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
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
      ttlDays: Math.max(0, Math.min(3650, Math.trunc(Number(payload.ttlDays ?? DAILY_CHECK_IN_COUPON_TTL_DAYS)))),
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
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')
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
  const { state, version } = await readWelfareStateRecord(env)
  const user = await authenticatedUser(request, env, state as Partial<WelfareState>)
  assertAdminUser(user)
  await syncUserPointBalancesFromLedger(env, state)
  return json({ state: clientVisibleWelfareState(state, user.id), currentUserId: user.id, version })
}
