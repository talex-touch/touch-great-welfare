import type { WorkerEnv } from './env'
import { requestUserId } from './auth'
import { isRecord } from './records'
import { isMaskedSecret } from './secrets'

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
