import type {
  ApplicationItem,
  AttachmentMeta,
  CreditTransaction,
  CrowdReview,
  EducationEmailChallenge,
  InvitationBinding,
  SquareBoost,
  SquarePost,
  SquareReport,
  StudentVerification,
  User,
  WelfareApplication,
  WelfareState,
} from '~/composables/welfare'
import { Pool } from 'pg'
import {
  BASE_REQUEST_COST,
  calculateActivityPrice,
  calculateLlmApiBudgetActivityPrice,
  calculateLlmApiCostPoints,
  COLLABORATION_APPLICATION_MIN_REASON_CHARS,
  COLLABORATION_DELIVERY_REWARD_MAX,
  COLLABORATION_DELIVERY_REWARD_MIN,
  createUserInviteCode,
  DAILY_CHECK_IN_MAX_POINTS,
  MAX_ATTACHMENT_BYTES,
  PRO_EXPEDITE_COST,
  resolveSelectableLlmApiModel,
  SQUARE_BOOST_REPORT_PENALTY_POINTS,
  SQUARE_BOOST_REWARD_POINTS,
  SQUARE_MIN_DISCOUNT_RATE,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
} from '~/composables/welfare'
import { isRichTextEmpty, richTextToPlainText } from '~/utils/rich-text'
import { applyWelfareRetentionPolicy } from '../shared/welfare-retention'
import { base64UrlDecode, base64UrlEncode, decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { dispatchWelfareStateChangeNotifications } from './notifications'
import { appendPointTransaction, applyPointTransactionsFromClientState, backfillPointTransactionsFromState } from './points'
import { authenticatedUserId, clearSessionCookie, createSessionCookie } from './session'

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
}

const STATE_KEY = 'default'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MASKED_SECRET_MARKER = '****'
const ADMIN_LOGIN_MAX_FAILURES = 8
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000
const PASSWORD_PBKDF2_ITERATIONS = 210000

let pool: Pool | undefined
let poolKey = ''
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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function sanitizeUser(user: User): User {
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

function publicApplicationForDelivery(application: WelfareApplication): WelfareApplication {
  return {
    ...publicApplicationForReview(application),
    type: application.type,
    status: application.status,
    cost: application.cost,
    answer: application.answer,
    messages: application.messages?.filter(item => item.type === 'system' || item.type === 'result_submission') ?? [],
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
    .map(publicApplicationForDelivery)
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

async function requestUserId(request: Request, env: WorkerEnv) {
  return await authenticatedUserId(request, env)
}

async function canUpdateState(previousState: unknown, request: Request, env: WorkerEnv) {
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

function isAdminUser(previousState: unknown, userId: string) {
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

    return {
      ...item,
      userId: previous.userId,
      status: previous.status,
      reviewFee: previous.reviewFee,
      feeReturned: previous.feeReturned,
      reply: previous.reply,
      reviewedAt: previous.reviewedAt,
      educationEmailVerified: previous.educationEmailVerified,
      educationEmailVerifiedAt: previous.educationEmailVerifiedAt,
      educationEmailVerificationSource: previous.educationEmailVerificationSource,
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
  return `srv_${scope}_${refId.replace(/[^\w-]+/g, '_')}`
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

async function applyTrustedPointTransactionsFromState(env: WorkerEnv, previousState: unknown, nextState: unknown, userId: string) {
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

async function mergeSensitiveWelfareState<T extends Record<string, unknown>>(previousState: unknown, nextState: T, request: Request, env: WorkerEnv): Promise<T> {
  if (!isRecord(previousState) || !isRecord(nextState) || !isRecord(nextState.applicationPolicy))
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
  const previousTurnstileSecretKey = typeof previousPolicy.turnstileSecretKey === 'string'
    ? previousPolicy.turnstileSecretKey.trim()
    : ''
  const nextTurnstileSecretKey = typeof nextState.applicationPolicy.turnstileSecretKey === 'string'
    ? nextState.applicationPolicy.turnstileSecretKey.trim()
    : ''

  if (nextTurnstileSecretKey && !isMaskedSecret(nextTurnstileSecretKey) && await canUpdateSensitiveState(previousState, request, env)) {
    return await mergeClientWritableState(previousState, {
      ...nextState,
      users: nextUsers,
    }, request, env)
  }

  return await mergeClientWritableState(previousState, {
    ...nextState,
    users: nextUsers,
    applicationPolicy: {
      ...nextState.applicationPolicy,
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
    })
  }

  return pool
}

async function ensureSchema(env: WorkerEnv) {
  if (shouldUseD1(env))
    return

  await getPool(env).query(`
    create table if not exists welfare_app_state (
      id text primary key,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `)
}

export async function readWelfareState(env: WorkerEnv) {
  await ensureSchema(env)

  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select state from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ state: string }>()

    const state = await decodeStoredState(env, row?.state ? JSON.parse(row.state) : {})
    return applyWelfareRetentionPolicy(state).state
  }

  const result = await getPool(env).query(
    'select state from welfare_app_state where id = $1',
    [STATE_KEY],
  )

  const state = await decodeStoredState(env, result.rows[0]?.state ?? {})
  return applyWelfareRetentionPolicy(state).state
}

export async function writeWelfareState(env: WorkerEnv, state: unknown) {
  await ensureSchema(env)
  await backfillPointTransactionsFromState(env, state)
  const storedState = await encodeStoredState(env, state)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into welfare_app_state (id, state, updated_at)
        values (?1, ?2, current_timestamp)
        on conflict (id)
        do update set state = excluded.state, updated_at = current_timestamp
      `)
      .bind(STATE_KEY, JSON.stringify(storedState))
      .run()
    return
  }

  await getPool(env).query(
    `
      insert into welfare_app_state (id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set state = excluded.state, updated_at = now()
    `,
    [STATE_KEY, JSON.stringify(storedState)],
  )
}

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function forbidden(message = '需要管理员权限') {
  return json({ error: message }, 403)
}

function errorResponse(error: unknown) {
  return json({
    error: error instanceof Error ? error.message : '服务端错误',
  }, 500)
}

function assertStateShape(state: unknown): asserts state is Record<string, unknown> {
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

function outOfScopeRecordLabel(state: Record<string, unknown>, userId: string) {
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

async function readPayload(request: Request) {
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

function stateUsers(state: Partial<WelfareState>) {
  return Array.isArray(state.users) ? state.users : []
}

function stateApplications(state: Partial<WelfareState>) {
  return Array.isArray(state.applications) ? state.applications : []
}

async function authenticatedUser(request: Request, env: WorkerEnv, state: Partial<WelfareState>) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const user = stateUsers(state).find(item => item.id === userId)
  if (!user || user.accountStatus === 'suspended')
    throw new Error('请先登录')

  return user
}

function assertAdminUser(user: User) {
  if (user.role !== 'admin')
    throw new Error('需要管理员权限')
}

function assertReviewerUser(user: User) {
  if (user.role !== 'reviewer' && user.role !== 'admin')
    throw new Error('需要协作处理员权限')
}

function ensureCollaborationApplications(state: Partial<WelfareState>) {
  state.collaborationApplications ??= []
  return state.collaborationApplications
}

function attachmentsFromPayload(value: unknown): AttachmentMeta[] {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : createId('att'),
      name: typeof item.name === 'string' ? item.name : '附件',
      size: Math.max(0, Math.trunc(Number(item.size || 0))),
      type: typeof item.type === 'string' ? item.type : 'application/octet-stream',
    }))
}

function totalAttachmentBytes(attachments: AttachmentMeta[]) {
  return attachments.reduce((sum, item) => sum + Math.max(0, Math.trunc(Number(item.size || 0))), 0)
}

function cloneState<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

function pushApplicationMessage(application: WelfareApplication, userId: string, type: 'result_submission' | 'system', content: string, attachments: AttachmentMeta[] = []) {
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

async function commitActionState(env: WorkerEnv, previousState: Partial<WelfareState>, nextState: Partial<WelfareState>) {
  const retained = applyWelfareRetentionPolicy(nextState).state
  if (isRecord(retained))
    delete retained.currentUserId
  await writeWelfareState(env, retained)
  await dispatchWelfareStateChangeNotifications(env, previousState, retained)
  return retained
}

async function bootstrapAdmin(request: Request, env: WorkerEnv) {
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

async function loginAdmin(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
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
  await writeWelfareState(env, state)
  return json({ ok: true, userId: admin.id }, 200, {
    'set-cookie': await createSessionCookie(request, env, admin.id),
  })
}

async function submitCollaborationApplication(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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
  await commitActionState(env, originalState, previousState)
  return json({ ok: true, application })
}

async function reviewCollaborationApplication(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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

  await commitActionState(env, originalState, previousState)
  return json({ ok: true, application })
}

async function claimDeliveryApplication(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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

  await commitActionState(env, originalState, previousState)
  return json({ ok: true, applicationId: application.id })
}

async function cancelDeliveryClaim(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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

  await commitActionState(env, originalState, previousState)
  return json({ ok: true, applicationId: application.id })
}

async function submitDeliveryResult(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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

  await commitActionState(env, originalState, previousState)
  return json({ ok: true, applicationId: application.id })
}

async function reviewDeliveryResult(request: Request, env: WorkerEnv) {
  const previousState = await readWelfareState(env) as Partial<WelfareState>
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
    await commitActionState(env, originalState, previousState)
    return json({ ok: true, applicationId: application.id })
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
    userId: application.deliveryAssigneeId,
    delta: rewardPoints,
    type: 'grant',
    reason: `${application.type.toUpperCase()} 协作交付奖励`,
    refId: application.id,
    createdAt: reviewedAt,
  }, previousState)
  await commitActionState(env, originalState, previousState)
  return json({ ok: true, applicationId: application.id })
}

async function currentStateResponse(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env)
  const userId = await requestUserId(request, env)
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const user = userId ? users.find(item => isRecord(item) && item.id === userId) : undefined

  if (!user)
    return json({ state: publicBootstrapState(state) })

  return json({ state: clientVisibleWelfareState(state, userId), currentUserId: userId })
}

export async function handleWelfareStateRequest(request: Request, env: WorkerEnv) {
  try {
    if (request.method === 'GET')
      return currentStateResponse(request, env)

    if (request.method === 'POST') {
      const action = request.headers.get('x-welfare-action')?.trim()
      if (action === 'bootstrap-admin')
        return await bootstrapAdmin(request, env)
      if (action === 'login-admin')
        return await loginAdmin(request, env)
      if (action === 'logout')
        return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) })
      if (action === 'submit-collaboration-application')
        return await submitCollaborationApplication(request, env)
      if (action === 'review-collaboration-application')
        return await reviewCollaborationApplication(request, env)
      if (action === 'claim-delivery-application')
        return await claimDeliveryApplication(request, env)
      if (action === 'cancel-delivery-claim')
        return await cancelDeliveryClaim(request, env)
      if (action === 'submit-delivery-result')
        return await submitDeliveryResult(request, env)
      if (action === 'review-delivery-result')
        return await reviewDeliveryResult(request, env)
    }

    if (request.method === 'PUT') {
      const previousState = await readWelfareState(env)
      if (!await canUpdateState(previousState, request, env))
        throw new Error('请先登录')

      const payload = await readPayload(request)
      assertStateShape(payload.state)
      const userId = await requestUserId(request, env)
      if (userId && !isAdminUser(previousState, userId)) {
        const blockedLabel = outOfScopeRecordLabel(payload.state, userId)
        if (blockedLabel)
          return forbidden(`无权修改其他用户的${blockedLabel}`)
      }
      const mergedSensitiveState = await mergeSensitiveWelfareState(previousState, payload.state, request, env)
      if (userId && isAdminUser(previousState, userId))
        await applyPointTransactionsFromClientState(env, previousState, mergedSensitiveState)
      else if (userId)
        await applyTrustedPointTransactionsFromState(env, previousState, mergedSensitiveState, userId)
      const nextState = applyWelfareRetentionPolicy(mergedSensitiveState).state
      if (isRecord(nextState))
        delete nextState.currentUserId
      await writeWelfareState(env, nextState)
      await dispatchWelfareStateChangeNotifications(env, previousState, nextState)
      return json({ ok: true })
    }

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
