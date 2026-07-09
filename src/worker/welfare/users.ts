import type {
  ApplicationItem,
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
} from '~/shared/welfare-types'
import { isRecord } from './records'
import { maskSecret } from './secrets'

export function ensureDailyCheckIns(state: { dailyCheckIns?: unknown }) {
  state.dailyCheckIns ??= []
  return state.dailyCheckIns as NonNullable<import('~/shared/welfare-types').WelfareState['dailyCheckIns']>
}

export function ensureInvitationBindings(state: { invitationBindings?: unknown }) {
  state.invitationBindings ??= []
  return state.invitationBindings as NonNullable<import('~/shared/welfare-types').WelfareState['invitationBindings']>
}

export function ensureCollaborationApplications(state: { collaborationApplications?: unknown }) {
  state.collaborationApplications ??= []
  return state.collaborationApplications as NonNullable<import('~/shared/welfare-types').WelfareState['collaborationApplications']>
}

export function stateUsers(state: { users?: unknown }) {
  return Array.isArray(state.users) ? state.users as User[] : []
}

export function adminTargetUser(state: { users?: unknown }, userId: unknown) {
  const user = stateUsers(state).find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')
  return user
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

export function userVisibleFromIds(users: User[], userIds: Iterable<string>, currentUserId: string) {
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

export function sanitizeOwnedApplications(applications: WelfareApplication[], currentUserId: string) {
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
      && ['answered', 'pending_allocation', 'delivered'].includes(item.status)
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

export function clientVisibleWelfareState(state: unknown, currentUserId = '') {
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

export function publicBootstrapState(state: unknown) {
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

export function publicBootstrapPayload(state: unknown) {
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const hasAdmin = users.some(user => isRecord(user) && user.role === 'admin')
  return {
    hasAdmin,
    siteBanner: isRecord(state) ? state.siteBanner : undefined,
    systemConfig: isRecord(state) ? state.systemConfig : undefined,
    createdAt: isRecord(state) && typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString(),
  }
}
