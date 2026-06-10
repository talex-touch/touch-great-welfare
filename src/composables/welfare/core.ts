import { computed, reactive, ref } from 'vue'
import {
  analyzeEducationEmail,
  assertEducationEmailAddress,
  educationEmailAdminRecommendationLabel,
  educationEmailAdminRecommendationTone,
  educationEmailReasonText,
  educationEmailUserLabel,
} from '~/shared/education-email'
import { applyWelfareRetentionPolicy, DATA_RETENTION_DAYS, DATA_RETENTION_MS } from '~/shared/welfare-retention'
import { isRichTextEmpty, richTextToPlainText, sanitizeRichText } from '~/utils/rich-text'
import { bootstrapAdmin, endSession, loadInitialWelfareState, loadLegacyWelfareState, loadWelfareState, loginAdmin as requestAdminLogin } from '../welfare-persistence'

export {
  analyzeEducationEmail,
  educationEmailAdminRecommendationLabel,
  educationEmailAdminRecommendationTone,
  educationEmailReasonText,
  educationEmailUserLabel,
}

export type UserRole = 'admin' | 'reviewer' | 'user'
export type RequestKind = 'code' | 'image' | 'pro' | 'resource'
export type RequestStatus = 'draft' | 'reserved' | 'pending_review' | 'needs_supplement' | 'processing' | 'answered' | 'pending_allocation' | 'delivered' | 'completed' | 'closed' | 'rejected' | 'submitted' | 'in_review' | 'approved' | 'partial_approved' | 'cancelled'
export type ApplicationMessageType = 'comment' | 'supplement' | 'result_submission' | 'system'
export type StudentStatus = 'pending' | 'needs_supplement' | 'approved' | 'rejected' | 'revoked'
export type VerificationType = 'student' | 'frontline'
export type EducationEmailVerificationSource = 'mail_auto' | 'user_confirmed_sent' | 'admin_approved'
export type CreditTransactionType = 'recharge' | 'spend' | 'refund' | 'adjustment' | 'grant'
export type AiReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_human' | 'failed'
export type CrowdReviewTargetType = 'pro_application'
export type CrowdReviewDecision = 'approve' | 'reject' | 'needs_admin'
export type CollaborationApplicationStatus = 'pending' | 'approved' | 'rejected'
export type DeliveryReviewStatus = 'pending_review' | 'approved' | 'rejected'
export type UserLevelKey = 'starter' | 'steady' | 'trusted' | 'priority' | 'guardian'
export type LlmApiModelRegion = 'domestic' | 'global' | 'custom'
export type SquarePostType = 'application_template' | 'review'
export type ResourceType = 'database' | 'llm_api_quota' | 'content_service' | 'media_publishing' | 'data_productivity' | 'quality_review' | 'git_repository' | 'cicd' | 'vpn' | 'ip_allowlist' | 'notification_channel' | 'identity_security' | 'server' | 'gpu' | 'k8s_namespace' | 'object_storage'
export type ResourceApprovalStatus = 'pending' | 'approved' | 'rejected' | 'adjusted_approved'
export type ResourceProvisionStatus = 'not_required' | 'pending' | 'completed'
export type ResourceLifecycleStatus = 'pending' | 'approved' | 'rejected' | 'provisioning' | 'active' | 'renewal_requested' | 'expired' | 'reclaim_pending' | 'returned' | 'released' | 'closed'
export type ResourceLifecycleAction = 'approve' | 'reject' | 'provision' | 'activate' | 'request_renewal' | 'approve_renewal' | 'reject_renewal' | 'mark_expired' | 'queue_reclaim' | 'return' | 'release' | 'close'
export type ResourceUrgency = 'normal' | 'urgent' | 'emergency'
export type ResourceTermId = 'general_resource_terms' | 'database_security_terms' | 'llm_api_compliance_terms' | 'creative_service_terms' | 'infrastructure_resource_terms'
export type ResourceAvailability = 'available' | 'level_required' | 'unavailable'
export type ResourcePoolCategoryId = 'database_and_cache' | 'ai_models' | 'content_services' | 'media_publishing' | 'data_productivity' | 'quality_review' | 'cloud_compute' | 'devops_delivery' | 'network_access' | 'notification_communication' | 'identity_security'

export interface LlmApiModelPricing {
  key: string
  name: string
  provider: string
  region: LlmApiModelRegion
  description: string
  enabled: boolean
  pointsPerUsd: number
  defaultBudgetUsd: number
  minBudgetUsd: number
  maxBudgetUsd: number
  ipLimit: number
  rpmLimit: number
  tpmLimit: number
  concurrencyLimit: number
}

export interface ResourceTermConfig {
  id: ResourceTermId
  title: string
  version: string
  content: string[]
}

export interface ResourceTypeConfig {
  resourceType: ResourceType
  displayName: string
  category: 'database' | 'llm' | 'service' | 'access' | 'compute'
  description: string
  icon: string
  enabled: boolean
  availability: ResourceAvailability
  minUserLevelPriority?: number
  unavailableReason?: string
  subtypes: string[]
  termsIds: ResourceTermId[]
  approverGroup: string
}

export interface ResourceTermAcceptance {
  termId: ResourceTermId
  version: string
  acceptedBy: string
  acceptedAt: string
}

export interface ResourcePoolItemConfig {
  id: string
  resourceType: ResourceType
  resourceSubtype: string
  label: string
  description: string
  info?: string
}

export interface ResourcePoolCategoryConfig {
  id: ResourcePoolCategoryId
  label: string
  description: string
  icon: string
  items: ResourcePoolItemConfig[]
}

export interface ResourceGovernanceQueueItem {
  applicationId: string
  itemId: string
  title: string
  resourceType: ResourceType
  resourceSubtype: string
  status: ResourceLifecycleStatus
  approverGroup: string
  ownerId?: string
  userId: string
  expiresAt?: string
  updatedAt: string
}

export interface ResourceGovernanceSnapshot {
  totals: {
    active: number
    pendingApproval: number
    pendingProvision: number
    renewalDue: number
    expired: number
    reclaimPending: number
    released: number
  }
  pendingApprovalItems: ResourceGovernanceQueueItem[]
  pendingProvisionItems: ResourceGovernanceQueueItem[]
  renewalDueItems: ResourceGovernanceQueueItem[]
  expiredItems: ResourceGovernanceQueueItem[]
  reclaimPendingItems: ResourceGovernanceQueueItem[]
}

export interface ApplicationItem {
  id: string
  applicationId: string
  resourceType: ResourceType
  resourceSubtype: string
  payload: Record<string, any>
  requestedQuota?: string
  requestedPermission?: string
  duration?: string
  approverGroup: string
  approvalStatus: ResourceApprovalStatus
  approvedPayload?: Record<string, any>
  rejectReason?: string
  provisionStatus?: ResourceProvisionStatus
  lifecycleStatus?: ResourceLifecycleStatus
  provisionPayload?: Record<string, any>
  provisionNote?: string
  provisionCompletedAt?: string
  activatedAt?: string
  expiresAt?: string
  renewalRequestedAt?: string
  renewalReviewedAt?: string
  returnedAt?: string
  releasedAt?: string
  closedAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserProfile {
  displayName: string
  email: string
  inviteCode?: string
  avatar?: string
  bio?: string
  githubUsername?: string
  githubId?: string
  selectedRepo?: string
  githubRepos?: string[]
  githubAuthorized?: boolean
  githubAuthorizedAt?: string
  oauthProviderId?: string
  oauthSubject?: string
  oauthUsername?: string
  oauthAuthorizedAt?: string
  studentVerified: boolean
}

export interface User {
  id: string
  role: UserRole
  profile: UserProfile
  points: number
  passwordHash?: string
  accountStatus: 'active' | 'suspended'
  suspendedReason?: string
  suspendedAt?: string
  suspendedBy?: string
  createdAt: string
  lastLoginAt: string
}

export interface OauthConfig {
  enabled: boolean
  provider: 'github' | 'google' | 'custom'
  clientId: string
  authorizeUrl: string
  tokenUrl: string
  callbackUrl: string
  scopes: string
}

export interface AttachmentMeta {
  id: string
  name: string
  size: number
  type: string
  r2Key?: string
  url?: string
  dataUrl?: string
}

export interface AiApplicationReview {
  status: AiReviewStatus
  summary: string
  risk: 'low' | 'medium' | 'high'
  reason?: string
  model?: string
  reviewedAt?: string
}

export interface WelfareApplication {
  id: string
  userId: string
  type: RequestKind
  parentApplicationId?: string
  title: string
  description: string
  githubRepo?: string
  hasOpenSourceBadge: boolean
  attachments: AttachmentMeta[]
  status: RequestStatus
  baseCost?: number
  cost: number
  costCharged: boolean
  couponId?: string
  couponName?: string
  couponDiscountRate?: number
  couponDiscountAmount?: number
  sharedToSquare?: boolean
  squarePostId?: string
  squareDiscountRate?: number
  squareDiscountAmount?: number
  pricingDiscountRate?: number
  pricingPromotionName?: string
  pricingPromotionEndsAt?: string
  pricingAppliedAt?: string
  aiReview?: AiApplicationReview
  aiReviewFeeRate: number
  rejectionReviewFee: number
  rejectionReviewFeeWaived: boolean
  rejectionFraudulent?: boolean
  waiveRejectionReviewFeeBlockedUntil?: string
  llmApiModelKey?: string
  llmApiModelName?: string
  llmApiProvider?: string
  llmApiBudgetUsd?: number
  llmApiPointRate?: number
  llmApiIpLimit?: number
  llmApiRpmLimit?: number
  llmApiTpmLimit?: number
  llmApiCustomRpmLimit?: number
  llmApiCustomTpmLimit?: number
  llmApiRateLimitChangeCost?: number
  llmApiConcurrencyLimit?: number
  llmApiRequiresExtendedReview?: boolean
  /** @deprecated use llmApiBudgetUsd */
  codexBudgetUsd?: number
  /** @deprecated use llmApiPointRate */
  codexPointRate?: number
  /** @deprecated use llmApiIpLimit */
  codexIpLimit?: number
  /** @deprecated use llmApiRpmLimit */
  codexRpmLimit?: number
  /** @deprecated use llmApiConcurrencyLimit */
  codexConcurrencyLimit?: number
  /** @deprecated use llmApiRequiresExtendedReview */
  codexRequiresExtendedReview?: boolean
  storageExtended: boolean
  storageExtensionCost: number
  retentionExpiresAt: string
  standardProcessingHours?: number
  processingDueAt?: string
  processingStartedAt?: string
  completedAt?: string
  expedited?: boolean
  expediteCost?: number
  contextAppendCost?: number
  contextAppendUntil?: string
  postApprovalSupplementLimit?: number
  postApprovalSupplementCount?: number
  cooldownUntil?: string
  answer?: string
  messages?: ApplicationMessage[]
  allocationPayload?: Record<string, any>
  allocationNote?: string
  allocationCompletedAt?: string
  deliveryAssigneeId?: string
  deliveryClaimedAt?: string
  deliverySubmittedAt?: string
  deliveryReviewStatus?: DeliveryReviewStatus
  deliveryRewardPoints?: number
  deliveryRewardedAt?: string
  deliveryRewardedBy?: string
  createdAt: string
  reviewedAt?: string
  /** Resource application platform fields. Present when type === 'resource'. */
  departmentId?: string
  projectId?: string
  reason?: string
  businessBackground?: string
  urgency?: ResourceUrgency
  expectedEffectiveAt?: string
  costCenter?: string
  ownerId?: string
  selectedResourceTypes?: ResourceType[]
  resourceItems?: ApplicationItem[]
  termsAcceptances?: ResourceTermAcceptance[]
  submittedAt?: string
}

export interface ApplicationMessage {
  id: string
  applicationId: string
  userId: string
  type: ApplicationMessageType
  content: string
  attachments: AttachmentMeta[]
  createdAt: string
}

export interface StudentVerification {
  id: string
  userId: string
  verificationType?: VerificationType
  realName: string
  category: string
  school?: string
  identity?: string
  grade?: string
  educationLevel?: string
  educationEmail?: string
  educationEmailVerified?: boolean
  educationEmailVerifiedAt?: string
  educationEmailVerificationSource?: EducationEmailVerificationSource
  educationEmailChallengeId?: string
  notes: string
  attachments: AttachmentMeta[]
  status: StudentStatus
  reviewFee: number
  feeReturned: boolean
  reply?: string
  supplementRequestedAt?: string
  supplementedAt?: string
  createdAt: string
  reviewedAt?: string
}

export interface EducationEmailChallenge {
  id: string
  userId: string
  email: string
  code: string
  subject: string
  body: string
  mailto: string
  expiresAt: string
  submittedAt?: string
  verifiedAt?: string
  createdAt: string
}

export type CouponSource = 'daily_streak_3' | 'daily_streak_7' | 'manual' | 'redemption_code' | 'bulk_grant'
export type CouponScope = 'resource' | 'recharge' | 'general'
export type CouponDiscountType = 'rate' | 'fixed_points' | 'fixed_ldc'
export type CouponUseTarget = 'resource_application' | 'recharge_order'

export interface CouponRule {
  scope: CouponScope
  discountType: CouponDiscountType
  discountRate?: number
  discountAmount?: number
  resourceTypes?: ResourceType[]
  minSpend?: number
  maxDiscount?: number
}

export interface CouponTemplate {
  id: string
  name: string
  description?: string
  enabled: boolean
  rule: CouponRule
  ttlDays: number
  totalGrantLimit?: number
  grantedCount: number
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export interface CouponRedemptionCode {
  id: string
  code: string
  templateId: string
  enabled: boolean
  maxRedemptions: number
  redeemedCount: number
  perUserLimit: number
  expiresAt?: string
  createdAt: string
  createdBy?: string
}

export interface CouponRedemptionRecord {
  id: string
  codeId: string
  templateId: string
  userId: string
  couponId: string
  redeemedAt: string
}

export interface UserCoupon {
  id: string
  userId: string
  name: string
  discountRate: number
  source: CouponSource
  scope?: CouponScope
  discountType?: CouponDiscountType
  discountAmount?: number
  resourceTypes?: ResourceType[]
  minSpend?: number
  maxDiscount?: number
  templateId?: string
  codeId?: string
  createdAt: string
  expiresAt?: string
  usedAt?: string
  usedFor?: CouponUseTarget
  usedRefId?: string
  usedApplicationId?: string
}

export interface DailyCheckIn {
  id: string
  userId: string
  dateKey: string
  points: number
  streak: number
  couponIds: string[]
  createdAt: string
}

export interface InvitationBinding {
  id: string
  inviterUserId: string
  inviteeUserId: string
  inviteCode: string
  createdAt: string
  inviterVouchedAt?: string
  inviteeVouchedAt?: string
}

export interface CrowdReview {
  id: string
  targetType: CrowdReviewTargetType
  targetId: string
  reviewerId: string
  decision: CrowdReviewDecision
  note: string
  createdAt: string
}

export interface CollaborationApplication {
  id: string
  userId: string
  reason: string
  status: CollaborationApplicationStatus
  reply?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
}

export interface SquarePost {
  id: string
  userId: string
  type: SquarePostType
  title: string
  content: string
  applicationId?: string
  requestType?: RequestKind
  template?: Partial<SubmitApplicationPayload & SubmitResourceApplicationPayload>
  penaltyCount?: number
  lastPenaltyAt?: string
  createdAt: string
  updatedAt: string
}

export interface SquareBoost {
  id: string
  postId: string
  userId: string
  mode?: 'boost' | 'post_approval_vote'
  declaration: string
  pointsGranted: number
  createdAt: string
  reportedAt?: string
  reportReason?: string
  reportedBy?: string
  penaltyApplied?: boolean
  cooldownUntil?: string
}

export interface SquareReport {
  id: string
  postId: string
  boostId: string
  reporterId: string
  reason: string
  createdAt: string
}

export interface CreditTransaction {
  id: string
  userId: string
  delta: number
  type: CreditTransactionType
  reason: string
  refId?: string
  balanceAfter?: number
  createdAt: string
}

export interface ApplicationKindPolicy {
  enabled: boolean
  dailyLimit: number
  perUserDailyLimit: number
  openStart: string
  openEnd: string
  closedReason?: string
}

export interface ApplicationPolicyConfig {
  minDescriptionChars: number
  submitCooldownSeconds: number
  powEnabled: boolean
  powDifficulty: number
  turnstileEnabled: boolean
  turnstileSiteKey: string
  turnstileSecretKey: string
  categories: Record<RequestKind, ApplicationKindPolicy>
}

export interface SiteBannerConfig {
  enabled: boolean
  title: string
  body: string
  tone: 'info' | 'success' | 'warning'
  updatedAt?: string
  updatedBy?: string
}

export interface SystemFeatureToggle {
  enabled: boolean
  reason?: string
}

export interface SystemConfig {
  siteEnabled: boolean
  siteClosedReason: string
  loginEnabled: boolean
  loginClosedReason: string
  registrationEnabled: boolean
  registrationClosedReason: string
  rechargeEnabled: boolean
  rechargeClosedReason: string
  verification: Record<VerificationType, SystemFeatureToggle>
  updatedAt?: string
  updatedBy?: string
}

export interface WelfareState {
  users: User[]
  currentUserId?: string
  oauth: OauthConfig
  applicationPolicy: ApplicationPolicyConfig
  siteBanner: SiteBannerConfig
  systemConfig: SystemConfig
  applications: WelfareApplication[]
  studentVerifications: StudentVerification[]
  educationEmailChallenges: EducationEmailChallenge[]
  couponTemplates: CouponTemplate[]
  couponCodes: CouponRedemptionCode[]
  couponRedemptions: CouponRedemptionRecord[]
  coupons: UserCoupon[]
  dailyCheckIns: DailyCheckIn[]
  invitationBindings: InvitationBinding[]
  crowdReviews: CrowdReview[]
  collaborationApplications: CollaborationApplication[]
  squarePosts: SquarePost[]
  squareBoosts: SquareBoost[]
  squareReports: SquareReport[]
  transactions: CreditTransaction[]
  createdAt: string
}

export interface VersionedWelfarePayload {
  version?: number
}

export interface PublicConfigDTO {
  siteBanner?: SiteBannerConfig
  systemConfig?: SystemConfig
  applicationPolicy?: Omit<ApplicationPolicyConfig, 'turnstileSecretKey'> & { turnstileSecretKey?: string }
  createdAt: string
}

export interface PublicBootstrapDTO extends PublicConfigDTO {
  hasAdmin: boolean
}

export interface SessionDTO {
  currentUser: User | null
}

export interface UserProfileDTO extends VersionedWelfarePayload {
  currentUser: User
  currentUserId: string
}

export interface UserApplicationsDTO extends VersionedWelfarePayload {
  applications: WelfareApplication[]
  users: User[]
}

export interface UserWalletDTO extends VersionedWelfarePayload {
  coupons: UserCoupon[]
  dailyCheckIns: DailyCheckIn[]
  invitationBindings: InvitationBinding[]
  transactions: CreditTransaction[]
  currentUserId: string
}

export interface UserVerificationDTO extends VersionedWelfarePayload {
  studentVerifications: StudentVerification[]
  educationEmailChallenges: EducationEmailChallenge[]
}

export interface SquareDTO extends VersionedWelfarePayload {
  squarePosts: SquarePost[]
  squareBoosts: SquareBoost[]
  squareReports: SquareReport[]
  applications: WelfareApplication[]
  users: User[]
}

export interface CollaborationDTO extends VersionedWelfarePayload {
  collaborationApplications: CollaborationApplication[]
  claimableDeliveryApplications: WelfareApplication[]
  currentUserDeliveryApplications: WelfareApplication[]
  pendingDeliveryReviewApplications: WelfareApplication[]
  crowdReviews: CrowdReview[]
}

export interface UserWelfareStateDTO extends VersionedWelfarePayload {
  state: Partial<WelfareState>
  currentUserId: string
}

export interface AdminWelfareStateDTO extends UserWelfareStateDTO {}

/** @deprecated Use domain DTOs and endpoints instead of full-state payloads. */
export interface LegacyFullWelfareStateDTO extends VersionedWelfarePayload {
  state: Partial<WelfareState>
  currentUserId?: string
}

interface FileLike {
  id?: string
  name: string
  size: number
  type: string
  r2Key?: string
  url?: string
  dataUrl?: string
}

export interface CreateAdminPayload {
  displayName: string
  email: string
  password: string
}

export interface LoginAdminPayload {
  email: string
  password: string
}

export interface SubmitApplicationPayload {
  type: RequestKind
  title: string
  description: string
  githubRepo?: string
  attachments?: FileLike[]
  extendStorage?: boolean
  expediteProcessing?: boolean
  waiveRejectionReviewFee?: boolean
  powNonce?: string
  turnstileVerified?: boolean
  shareToSquare?: boolean
  squarePostContent?: string
  llmApiModelKey?: string
  llmApiBudgetUsd?: number
  llmApiCustomRpmLimit?: number
  llmApiCustomTpmLimit?: number
  /** @deprecated use llmApiBudgetUsd */
  codexBudgetUsd?: number
}

export interface SubmitResourceApplicationPayload {
  title: string
  departmentId?: string
  projectId?: string
  reason: string
  businessBackground: string
  urgency: ResourceUrgency
  expectedEffectiveAt?: string
  costCenter?: string
  ownerId?: string
  duration?: string
  selectedResourceTypes: ResourceType[]
  resourceItems: Array<{
    id?: string
    resourceType: ResourceType
    resourceSubtype: string
    payload: Record<string, any>
    requestedQuota?: string
    requestedPermission?: string
    duration?: string
  }>
  acceptedTermIds: ResourceTermId[]
  couponId?: string
  attachments?: FileLike[]
  saveAsDraft?: boolean
  waiveRejectionReviewFee?: boolean
  powNonce?: string
  turnstileVerified?: boolean
  shareToSquare?: boolean
  squarePostContent?: string
}

export interface CreateSquarePostPayload {
  type: SquarePostType
  title: string
  content: string
  applicationId?: string
  shareTemplate?: boolean
}

export interface ReviewApplicationItemPayload {
  applicationId: string
  itemId: string
  status: Exclude<ResourceApprovalStatus, 'pending'>
  approvedPayload?: Record<string, any>
  rejectReason?: string
  note?: string
}

export interface CompleteProvisionPayload {
  applicationId: string
  itemId?: string
  note?: string
  resourceName?: string
  resourceType?: string
  accessUrl?: string
  credential?: string
  expiresAt?: string
}

export interface ResourceLifecycleActionPayload {
  applicationId: string
  itemId: string
  action: ResourceLifecycleAction
  note?: string
  expiresAt?: string
}

export interface AppendApplicationContextPayload {
  applicationId: string
  description: string
}

export interface SubmitStudentPayload {
  verificationId?: string
  clientRequestId?: string
  verificationType?: VerificationType
  realName: string
  category: string
  school?: string
  identity?: string
  grade?: string
  educationLevel?: string
  educationEmail?: string
  educationEmailChallengeId?: string
  educationEmailVerified?: boolean
  notes: string
  attachments?: FileLike[]
}

export interface RejectApplicationOptions {
  fraudulent?: boolean
}

export interface SubmitCollaborationApplicationPayload {
  reason: string
}

export interface ReviewCollaborationApplicationPayload {
  id: string
  status: Exclude<CollaborationApplicationStatus, 'pending'>
  reply?: string
}

export interface SubmitDeliveryPayload {
  applicationId: string
  content: string
  attachments?: FileLike[]
}

export interface ReviewDeliveryPayload {
  applicationId: string
  approved: boolean
  rewardPoints?: number
  note?: string
}

export interface UserReviewStats {
  submitted: number
  approved: number
  rejected: number
  pending: number
  studentApproved: number
  studentRejected: number
}

export function normalizeVerificationType(type?: string): VerificationType {
  return type === 'frontline' ? 'frontline' : 'student'
}

export function verificationTypeLabel(type?: string) {
  return normalizeVerificationType(type) === 'frontline' ? '一线认证' : '学生认证'
}

export function verificationOrganizationLabel(type?: string) {
  return normalizeVerificationType(type) === 'frontline' ? '组织 / 单位' : '学校'
}

export function educationEmailVerificationLabel(source?: EducationEmailVerificationSource) {
  if (source === 'admin_approved')
    return '管理员已核验'
  if (source === 'mail_auto')
    return '收件 API 已验证'
  return '已声明发送'
}

export interface UserLevelRule {
  key: UserLevelKey
  name: string
  minScore: number
  priority: number
  tone: 'info' | 'success' | 'warning'
  summary: string
}

export interface UserLevelCard extends UserLevelRule {
  score: number
  maxScore: number
  next?: UserLevelRule
  stats: UserReviewStats
  reasons: string[]
}

export interface ApplicationPolicyStatus {
  type: RequestKind
  enabled: boolean
  available: boolean
  reason: string
  descriptionLength: number
  minDescriptionChars: number
  descriptionOk: boolean
  cooldownUntil?: string
  dailyLimit: number
  dailyUsed: number
  dailyRemaining?: number
  perUserDailyLimit: number
  perUserDailyUsed: number
  perUserDailyRemaining?: number
  openWindowLabel: string
  powEnabled: boolean
  powDifficulty: number
  turnstileEnabled: boolean
  turnstileSiteKey: string
}

const USER_LEVEL_MAX_SCORE = 3000
const USER_LEVEL_APPROVAL_TIERS = [
  { count: 3, points: 12 },
  { count: 5, points: 7 },
  { count: 10, points: 4 },
] as const
const USER_LEVEL_OPEN_SOURCE_TIERS = [
  { count: 3, points: 4 },
  { count: 5, points: 3 },
] as const

export const USER_LEVEL_RULES: UserLevelRule[] = [
  {
    key: 'starter',
    name: 'L1 新芽',
    minScore: 0,
    priority: 1,
    tone: 'info',
    summary: '新用户或材料记录较少，按常规顺序处理。',
  },
  {
    key: 'steady',
    name: 'L2 稳定',
    minScore: 300,
    priority: 2,
    tone: 'info',
    summary: '已有稳定提交记录，进入略高优先级。',
  },
  {
    key: 'trusted',
    name: 'L3 可信',
    minScore: 850,
    priority: 3,
    tone: 'success',
    summary: '通过率和认证表现较好，优先进入审核视野。',
  },
  {
    key: 'priority',
    name: 'L4 优先',
    minScore: 1600,
    priority: 4,
    tone: 'success',
    summary: '持续贡献且退回较少，待审队列优先排序。',
  },
  {
    key: 'guardian',
    name: 'L5 共建',
    minScore: 2450,
    priority: 5,
    tone: 'warning',
    summary: '高可信共建用户，资源紧张时最高优先级。',
  },
]

export const REQUEST_COST: Record<RequestKind, number> = {
  code: 800,
  image: 1200,
  pro: 12000,
  resource: 0,
}

export const BASE_REQUEST_COST: Record<RequestKind, number> = {
  code: 800,
  image: 1200,
  pro: 12000,
  resource: 0,
}

export const ACTIVITY_DISCOUNT_RATE = 0.01
export const ACTIVITY_DAYS = 8
export const ACTIVITY_START_AT = '2026-06-01T00:00:00+08:00'
export const ACTIVITY_END_AT = '2026-06-09T00:00:00+08:00'
export const ACTIVITY_NAME = '限时 0.1 折'
export const LLM_API_BUDGET_ACTIVITY_TIERS = [
  { minBudgetUsd: 500, discountRate: 1 },
  { minBudgetUsd: 300, discountRate: 0.07 },
  { minBudgetUsd: 100, discountRate: 0.05 },
] as const
export const PRO_BASE_COST = 10880
export const PRO_PUBLIC_COST = BASE_REQUEST_COST.pro
export const PRO_CONTEXT_APPEND_COST = 10880
export const PRO_STANDARD_PROCESSING_HOURS = 72
export const PRO_EXPEDITED_PROCESSING_HOURS = 48
export const PRO_EXPEDITE_COST = 1100
export const GPT_PRO_MODEL_KEY = 'gpt-pro'
export const GPT_PRO_DEFAULT_ROUNDS = 5
export const GPT_PRO_MIN_ROUNDS = 1
export const GPT_PRO_MAX_ROUNDS = 50
export const GPT_PRO_ACTIVITY_DISCOUNT_RATE = 0.5
export const GPT_PRO_ACTIVITY_NAME = 'GPT PRO 限量五折'
export const GPT_PRO_DEFAULT_DURATION = '7 天'
export const LLM_API_DEFAULT_MODEL_KEY = 'codex'
export const LLM_API_ALLOWED_MODEL_KEYS = ['codex', 'gpt-pro', 'gpt-models', 'claude-code', 'deepseek', 'openai-image', 'seedance', 'gemini-image', 'mimo'] as const
export const LLM_API_SELECTABLE_MODEL_KEYS = ['codex', 'gpt-pro', 'gpt-models', 'claude-code', 'deepseek', 'openai-image', 'seedance', 'gemini-image'] as const
export const LLM_API_MODEL_COST_MULTIPLIERS: Record<typeof LLM_API_ALLOWED_MODEL_KEYS[number], number> = {
  'codex': 1,
  'gpt-pro': 20,
  'gpt-models': 1,
  'claude-code': 10,
  'deepseek': 0.2,
  'openai-image': 2,
  'seedance': 2.5,
  'gemini-image': 1.5,
  'mimo': 0.1,
}
export const RESOURCE_DEFAULT_DURATION = '申请通过之日起至次日凌晨三点'
export const RESOURCE_DURATION_EXTENSION_COST = 20000
export const LLM_API_EXTENDED_REVIEW_THRESHOLD_USD = 100
export const LLM_API_STANDARD_PROCESSING_HOURS = 24
export const LLM_API_EXTENDED_PROCESSING_HOURS = 72
export const DEFAULT_LLM_API_MODELS: LlmApiModelPricing[] = [
  {
    key: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    region: 'global',
    description: '适合代码生成、仓库理解和自动化任务。',
    enabled: true,
    pointsPerUsd: 10,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    tpmLimit: 10000,
    concurrencyLimit: 1,
  },
  {
    key: 'gpt-pro',
    name: 'GPT PRO',
    provider: 'OpenAI',
    region: 'global',
    description: '按对话轮次申请，默认 5 轮，默认有效期 7 天。',
    enabled: true,
    pointsPerUsd: PRO_PUBLIC_COST,
    defaultBudgetUsd: GPT_PRO_DEFAULT_ROUNDS,
    minBudgetUsd: GPT_PRO_MIN_ROUNDS,
    maxBudgetUsd: GPT_PRO_MAX_ROUNDS,
    ipLimit: 1,
    rpmLimit: 1,
    tpmLimit: 8000,
    concurrencyLimit: 1,
  },
  {
    key: 'gpt-models',
    name: 'GPT 模型',
    provider: 'OpenAI',
    region: 'global',
    description: '通用 GPT / o 系列模型额度，用于文本、推理、多模态和工具调用。',
    enabled: true,
    pointsPerUsd: 10,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    tpmLimit: 12000,
    concurrencyLimit: 1,
  },
  {
    key: 'claude-code',
    name: 'ClaudeCode',
    provider: 'Anthropic',
    region: 'global',
    description: '适合长上下文代码分析、重构和复杂推理。',
    enabled: true,
    pointsPerUsd: 100,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    tpmLimit: 10000,
    concurrencyLimit: 1,
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    provider: 'Domestic',
    region: 'domestic',
    description: 'DeepSeek API 模型池，覆盖通用对话和推理模式。',
    enabled: true,
    pointsPerUsd: 2,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 5,
    tpmLimit: 30000,
    concurrencyLimit: 2,
  },
  {
    key: 'openai-image',
    name: 'OpenAI 图像生成',
    provider: 'OpenAI',
    region: 'global',
    description: 'GPT Image 系列图像生成、编辑、海报素材和视觉资产额度。',
    enabled: true,
    pointsPerUsd: 20,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    tpmLimit: 10000,
    concurrencyLimit: 1,
  },
  {
    key: 'seedance',
    name: 'Seedance 视频生成',
    provider: 'ByteDance',
    region: 'domestic',
    description: '视频生成、短片、动效和多镜头素材额度。',
    enabled: true,
    pointsPerUsd: 25,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 1,
    rpmLimit: 1,
    tpmLimit: 8000,
    concurrencyLimit: 1,
  },
  {
    key: 'gemini-image',
    name: 'Gemini 图像生成',
    provider: 'Google',
    region: 'global',
    description: 'Gemini 图像生成和多模态创作能力池。',
    enabled: true,
    pointsPerUsd: 15,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    tpmLimit: 16000,
    concurrencyLimit: 1,
  },
  {
    key: 'mimo',
    name: 'Mimo',
    provider: 'Mimo',
    region: 'global',
    description: '适合轻量代码任务、快速原型和日常开发辅助。',
    enabled: false,
    pointsPerUsd: 1,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 3,
    tpmLimit: 12000,
    concurrencyLimit: 1,
  },
]
export const LLM_API_BUDGET_OPTIONS = [10, 100, 500, 1000] as const
export const RESOURCE_TERMS: ResourceTermConfig[] = [
  {
    id: 'general_resource_terms',
    title: '通用资源使用条款',
    version: '2026.06',
    content: [
      '仅将资源用于已说明的公益、研发、学习或开源目的，不得转借、倒卖、出租或挪作未审批用途。',
      '不得共享账号、密钥或临时权限；到期后应主动释放资源并删除不再需要的访问凭据。',
      '违反使用政策、提交虚假材料、滥用资源或造成安全风险时，平台可直接封禁账号且不退还任何已预扣或已消费积分。',
      '管理员可在后台基于审计记录封禁用户；被封禁用户不得继续提交申请、复用额度或参与广场互动。',
    ],
  },
  {
    id: 'database_security_terms',
    title: '数据库安全条款',
    version: '2026.06',
    content: [
      '遵循最小权限原则，不导出、不传播、不长期保存未授权数据。',
      '生产环境和敏感数据操作需保留操作范围说明，禁止绕过审批进行批量查询、复制、下载或外发。',
      '临时运维权限到期自动回收，异常查询、误操作、权限泄露或数据风险需立即停止并上报。',
      '因违规访问、泄露或滥用数据导致封禁的，相关预扣积分、已消费积分和审核费用均不退还。',
    ],
  },
  {
    id: 'llm_api_compliance_terms',
    title: '大模型 API 合规条款',
    version: '2026.06',
    content: [
      '不得向模型上传未脱敏的个人隐私、密钥、商业机密、未公开数据、受限代码或其他违反模型/平台使用政策的内容。',
      '额度、RPM、TPM、预算和有效期仅归属申请项目，禁止共享、倒卖、转租、代理滥用、绕过限流或用于未说明业务。',
      '平台按申请记录执行日志留存、脱敏、风控和审计；超额、异常消耗或高风险调用需由负责人说明。',
      '因违反模型供应商或平台使用政策导致账号、Key、项目或用户被封禁的，平台不退还任何积分，并可继续追溯处理关联账号。',
    ],
  },
  {
    id: 'creative_service_terms',
    title: '创作与发布服务条款',
    version: '2026.06',
    content: [
      '简历、文案、图片、视频、PPT、翻译和发布协助仅基于申请人提供的真实材料进行整理、润色、排版或合规发布，不保证录取、收益、曝光或平台审核结果。',
      '申请人需确认提交素材拥有合法使用权，不上传未授权肖像、商标、版权素材、隐私数据、商业机密或平台禁止传播的内容。',
      '涉及公开发布、社交平台、图片素材、视频素材或品牌物料时，需说明发布渠道、受众范围、版权归属、署名要求和下架联系人。',
      '因素材侵权、虚假包装、违规宣传、诱导营销或违反第三方平台政策造成下架、投诉、封禁或法律风险的，平台可拒绝交付并不退还已消耗积分。',
    ],
  },
  {
    id: 'infrastructure_resource_terms',
    title: '基础设施资源条款',
    version: '2026.06',
    content: [
      '服务器、GPU、K8s、对象存储、VPN、IP 白名单等资源仅用于申请项目。',
      '不得挖矿、转租、部署恶意程序、压测未授权系统、搭建违规代理或规避安全策略。',
      '资源到期或项目结束后应释放实例、命名空间、白名单、Bucket、临时凭据和其他持续计费资源。',
      '因违规部署、攻击、滥用网络、造成安全事件或违反云平台政策被封禁的，不退还任何积分，管理员可立即中止和回收资源。',
    ],
  },
]
export const RESOURCE_TYPE_CONFIGS: ResourceTypeConfig[] = [
  { resourceType: 'database', displayName: '数据库', category: 'database', description: 'MySQL / PostgreSQL / Redis / MongoDB / ClickHouse 等权限或实例访问。', icon: 'i-carbon-data-base', enabled: true, availability: 'available', subtypes: ['mysql', 'postgresql', 'redis', 'mongodb', 'clickhouse', 'elasticsearch', 'opensearch', 'meilisearch', 'sqlite', 'database_instance_access'], termsIds: ['database_security_terms'], approverGroup: 'DBA' },
  { resourceType: 'llm_api_quota', displayName: '大模型 API 额度', category: 'llm', description: 'Codex、Claude Code、GPT、DeepSeek、图像与视频生成额度。', icon: 'i-carbon-ai-status', enabled: true, availability: 'available', subtypes: ['codex', 'gpt-pro', 'gpt-models', 'claude-code', 'deepseek', 'openai-image', 'seedance', 'gemini-image'], termsIds: ['llm_api_compliance_terms'], approverGroup: 'AI 平台/成本负责人' },
  { resourceType: 'content_service', displayName: '内容与申请材料', category: 'service', description: '简历润色、申请材料、PPT、翻译、本地化和技术文档协作。', icon: 'i-carbon-document', enabled: true, availability: 'available', subtypes: ['resume_polish', 'cover_letter', 'interview_coaching', 'application_statement', 'ppt_deck', 'document_polish', 'translation_localization', 'technical_writing', 'prompt_workflow'], termsIds: ['creative_service_terms'], approverGroup: '内容服务/审核' },
  { resourceType: 'media_publishing', displayName: '图片与视频发布', category: 'service', description: '图片发布、海报、封面、短视频、社交平台发布和素材清理。', icon: 'i-carbon-image', enabled: true, availability: 'available', subtypes: ['image_publish', 'poster_design', 'social_post_publish', 'video_publish', 'thumbnail_cover', 'asset_cleanup', 'brand_asset', 'content_moderation'], termsIds: ['creative_service_terms'], approverGroup: '创作/运营' },
  { resourceType: 'data_productivity', displayName: '数据与效率工具', category: 'service', description: '数据分析、报表、埋点、问卷、表格自动化和反馈整理。', icon: 'i-carbon-chart-line', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['analytics_report', 'dashboard_build', 'event_tracking', 'survey_form', 'spreadsheet_automation', 'data_cleaning', 'seo_research', 'feedback_mining'], termsIds: ['creative_service_terms'], approverGroup: '数据/运营' },
  { resourceType: 'quality_review', displayName: '体验与质量审查', category: 'service', description: 'UI 走查、可访问性、性能、兼容性、发布清单和文案风险复核。', icon: 'i-carbon-task-complete', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['ui_review', 'accessibility_audit', 'performance_audit', 'browser_compatibility', 'release_checklist', 'copy_review', 'privacy_copy_check', 'incident_postmortem'], termsIds: ['creative_service_terms'], approverGroup: '质量/产品' },
  { resourceType: 'git_repository', displayName: 'Git 仓库权限', category: 'access', description: 'GitHub、GitLab、Gitee、部署密钥和机器人账号权限。', icon: 'i-carbon-logo-github', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['github', 'gitlab', 'gitee', 'codeberg', 'bitbucket', 'deploy_key', 'bot_account'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'cicd', displayName: 'CI/CD 权限', category: 'access', description: '流水线、Runner、部署、镜像仓库和发布通道权限。', icon: 'i-carbon-continuous-deployment', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['pipeline', 'runner', 'deployment', 'github_actions', 'gitlab_ci', 'docker_registry', 'release_channel'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'vpn', displayName: 'VPN', category: 'access', description: '个人、项目、堡垒机、零信任和临时内网访问权限。', icon: 'i-carbon-vpn', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['personal', 'project', 'site_to_site', 'bastion', 'zero_trust', 'temporary_access'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'ip_allowlist', displayName: 'IP 白名单', category: 'access', description: '办公、服务器、第三方、Webhook、API 网关和 CIDR 放行。', icon: 'i-carbon-firewall', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['office_ip', 'server_ip', 'third_party_ip', 'webhook_ip', 'api_gateway_ip', 'cidr'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'notification_channel', displayName: '通知与通信', category: 'access', description: '邮件、短信、Webhook、飞书、钉钉、企微和 Web Push 通知通道。', icon: 'i-carbon-notification', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['email', 'smtp', 'resend', 'sms', 'webhook', 'feishu', 'dingtalk', 'wecom', 'web_push', 'telegram_bot'], termsIds: ['infrastructure_resource_terms'], approverGroup: '通知/运维' },
  { resourceType: 'identity_security', displayName: '认证与安全', category: 'access', description: 'OAuth、OIDC、SSO、API Key、Service Account、密钥托管和 WAF 规则。', icon: 'i-carbon-security', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['oauth_app', 'oidc', 'saml_sso', 'api_key', 'service_account', 'secret_vault', 'turnstile', 'waf_rule', 'security_review', 'rbac_role'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/身份' },
  { resourceType: 'server', displayName: '云服务器', category: 'compute', description: '云主机、轻量实例、裸金属、竞价实例和 ARM 实例。', icon: 'i-carbon-server', enabled: true, availability: 'level_required', minUserLevelPriority: 3, unavailableReason: '平台等级 Lv3 开放', subtypes: ['ecs', 'vm', 'lightweight', 'bare_metal', 'spot', 'arm'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'gpu', displayName: 'GPU', category: 'compute', description: 'T4、L4、A10、A100、H100、H200 等 GPU 算力。', icon: 'i-carbon-machine-learning-model', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['nvidia_t4', 'nvidia_l4', 'nvidia_a10', 'nvidia_a100', 'nvidia_h100', 'nvidia_h200', 'other'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'k8s_namespace', displayName: 'K8s Namespace', category: 'compute', description: '命名空间、资源配额、GPU、PVC、Ingress 和 ServiceAccount。', icon: 'i-carbon-kubernetes', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['dev', 'test', 'staging', 'prod', 'gpu', 'pvc', 'ingress', 'service_account'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'object_storage', displayName: '对象存储', category: 'compute', description: 'Bucket、归档、公开素材、私有资产、备份和 CDN 源站。', icon: 'i-carbon-cloud-storage', enabled: true, availability: 'level_required', minUserLevelPriority: 3, unavailableReason: '平台等级 Lv3 开放', subtypes: ['bucket', 'archive', 'public_assets', 'private_assets', 'backup', 'cdn_origin'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
]
export const RESOURCE_POOL_CATEGORIES: ResourcePoolCategoryConfig[] = [
  {
    id: 'database_and_cache',
    label: '数据库与缓存',
    description: '按实例、库表或缓存访问方式选择所需资源。',
    icon: 'i-carbon-data-base',
    items: [
      { id: 'database:mysql', resourceType: 'database', resourceSubtype: 'mysql', label: 'MySQL', description: 'MySQL 实例、库表访问或只读分析权限。', info: '适用：业务库、报表库、只读分析、临时运维。' },
      { id: 'database:postgresql', resourceType: 'database', resourceSubtype: 'postgresql', label: 'PostgreSQL', description: 'PostgreSQL 业务库、报表库或只读访问。', info: '适用：PostgreSQL / PostGIS / TimescaleDB 相关访问。' },
      { id: 'database:redis', resourceType: 'database', resourceSubtype: 'redis', label: 'Redis', description: '缓存、队列和 KV 访问能力。', info: '适用：缓存、队列、Session、限流和 KV 数据排查。' },
      { id: 'database:mongodb', resourceType: 'database', resourceSubtype: 'mongodb', label: 'MongoDB', description: '文档数据库集合访问、索引和临时查询。', info: '适用：MongoDB 集合、索引、文档查询和只读分析。' },
      { id: 'database:clickhouse', resourceType: 'database', resourceSubtype: 'clickhouse', label: 'ClickHouse', description: 'OLAP、日志分析和宽表查询访问。', info: '适用：日志、指标、行为分析、聚合查询和宽表报表。' },
      { id: 'database:elasticsearch', resourceType: 'database', resourceSubtype: 'elasticsearch', label: 'Elasticsearch', description: '搜索索引、日志检索和聚合分析访问。', info: '适用：搜索索引、日志检索、聚合分析和排障查询。' },
      { id: 'database:opensearch', resourceType: 'database', resourceSubtype: 'opensearch', label: 'OpenSearch', description: '搜索与日志索引访问。', info: '适用：OpenSearch 索引、Dashboards 查询和日志检索。' },
      { id: 'database:meilisearch', resourceType: 'database', resourceSubtype: 'meilisearch', label: 'Meilisearch', description: '轻量搜索索引访问。', info: '适用：站内搜索、索引调试和搜索相关配置。' },
      { id: 'database:sqlite', resourceType: 'database', resourceSubtype: 'sqlite', label: 'SQLite', description: '本地或嵌入式数据库文件访问。', info: '适用：轻量应用、导入导出、离线分析和测试数据。' },
      { id: 'database:database_instance_access', resourceType: 'database', resourceSubtype: 'database_instance_access', label: '数据库实例访问', description: '跨类型数据库实例、连接串或临时账号访问。', info: '适用：未知或混合数据库类型的临时连接、白名单和账号权限。' },
    ],
  },
  {
    id: 'ai_models',
    label: 'AI 模型与生成能力',
    description: '按模型种类和额度池选择所需 AI 资源。',
    icon: 'i-carbon-ai-status',
    items: [
      { id: 'llm_api_quota:codex', resourceType: 'llm_api_quota', resourceSubtype: 'codex', label: 'Codex 套餐', description: '代码生成、重构、Agent 和自动化开发额度。', info: '支持：GPT-5.5、GPT-5.4、GPT-5.4 mini；兼容旧 Codex 模型按平台可用性开放。' },
      { id: 'llm_api_quota:claude-code', resourceType: 'llm_api_quota', resourceSubtype: 'claude-code', label: 'Claude Code 套餐', description: '长上下文代码分析、重构和复杂推理。', info: '支持：Claude Code 的 sonnet / opus / haiku 别名，以及可配置的完整 Claude 模型名。' },
      { id: 'llm_api_quota:gpt-models', resourceType: 'llm_api_quota', resourceSubtype: 'gpt-models', label: 'GPT 模型', description: '通用 GPT / o 系列文本、多模态和工具调用。', info: '支持：GPT-5.5、GPT-5.4、GPT-5.4 mini、GPT-5.4 nano 等通用文本、视觉和工具调用模型。' },
      { id: 'llm_api_quota:gpt-pro', resourceType: 'llm_api_quota', resourceSubtype: 'gpt-pro', label: 'GPT Pro', description: '高成本推理与深度协作对话轮次资源。', info: `默认 ${GPT_PRO_DEFAULT_ROUNDS} 轮 / ${GPT_PRO_DEFAULT_DURATION}，适合深度推理和长链路协作。` },
      { id: 'llm_api_quota:deepseek', resourceType: 'llm_api_quota', resourceSubtype: 'deepseek', label: 'DeepSeek', description: 'DeepSeek API 模型池，适合低成本通用对话和推理任务。', info: '支持：deepseek-v4-flash、deepseek-v4-pro；deepseek-chat / deepseek-reasoner 为兼容旧名。' },
      { id: 'llm_api_quota:openai-image', resourceType: 'llm_api_quota', resourceSubtype: 'openai-image', label: 'OpenAI 图像生成', description: '图片生成、编辑、素材与海报视觉资产。', info: '支持：GPT Image 2，以及平台仍开放的图像生成/编辑模型。' },
      { id: 'llm_api_quota:seedance', resourceType: 'llm_api_quota', resourceSubtype: 'seedance', label: 'Seedance 视频生成', description: '视频生成、短片、动效和多镜头素材。', info: '支持：Seedance 2.0；面向文本、图片、音频、视频多模态参考的视频生成与编辑。' },
      { id: 'llm_api_quota:gemini-image', resourceType: 'llm_api_quota', resourceSubtype: 'gemini-image', label: 'Gemini 图像生成', description: 'Gemini 图像生成和多模态创作能力池。', info: '支持：Gemini 3.1 Flash Image、Gemini 3 Pro Image、Gemini 2.5 Flash Image。' },
    ],
  },
  {
    id: 'content_services',
    label: '内容与申请材料',
    description: '按简历、申请材料、文档、PPT 和翻译需求选择服务。',
    icon: 'i-carbon-document',
    items: [
      { id: 'content_service:resume_polish', resourceType: 'content_service', resourceSubtype: 'resume_polish', label: '简历润色', description: '简历结构、措辞、项目表达和岗位匹配润色。', info: '适用：中文/英文简历、实习申请、校招、社招、项目经历重写；需提供真实经历和目标岗位。' },
      { id: 'content_service:cover_letter', resourceType: 'content_service', resourceSubtype: 'cover_letter', label: '求职信', description: 'Cover Letter、动机信和岗位匹配说明。', info: '适用：求职信、导师套磁、学校申请和项目自荐；不虚构经历、不承诺录取结果。' },
      { id: 'content_service:interview_coaching', resourceType: 'content_service', resourceSubtype: 'interview_coaching', label: '面试材料', description: '面试自我介绍、STAR 案例和问答脚本。', info: '适用：技术面、产品面、运营面、行为面和英文面试；需说明岗位、公司和面试阶段。' },
      { id: 'content_service:application_statement', resourceType: 'content_service', resourceSubtype: 'application_statement', label: '申请陈述', description: '奖学金、项目、活动、公益计划和学校申请材料。', info: '适用：个人陈述、项目申请、公益计划、奖学金材料；仅做真实材料整理和表达优化。' },
      { id: 'content_service:ppt_deck', resourceType: 'content_service', resourceSubtype: 'ppt_deck', label: 'PPT 方案', description: '路演、答辩、汇报和课程展示 PPT。', info: '适用：答辩、路演、汇报、课程展示和项目复盘；需提供主题、页数、受众和素材来源。' },
      { id: 'content_service:document_polish', resourceType: 'content_service', resourceSubtype: 'document_polish', label: '文档润色', description: '技术文档、README、方案、公告和说明文案润色。', info: '适用：README、PRD、设计说明、公告、邮件和帮助文档；保留事实边界和原始意图。' },
      { id: 'content_service:translation_localization', resourceType: 'content_service', resourceSubtype: 'translation_localization', label: '翻译本地化', description: '中英互译、术语统一和面向受众的本地化改写。', info: '适用：英文简历、产品文案、开源 README、邮件、字幕和说明文档；需说明目标语言和语气。' },
      { id: 'content_service:technical_writing', resourceType: 'content_service', resourceSubtype: 'technical_writing', label: '技术写作', description: '技术博客、教程、案例和发布说明。', info: '适用：技术博客、教程、案例复盘、Release Notes 和开发者文档；需提供代码、截图或事实材料。' },
      { id: 'content_service:prompt_workflow', resourceType: 'content_service', resourceSubtype: 'prompt_workflow', label: 'Prompt 工作流', description: 'Prompt、Agent 流程、模板和评测说明整理。', info: '适用：系统提示词、工作流模板、评测集、自动化说明；需说明输入、输出、限制和验收标准。' },
    ],
  },
  {
    id: 'media_publishing',
    label: '图片与视频发布',
    description: '按素材整理、图片发布、视频发布和社交分发选择服务。',
    icon: 'i-carbon-image',
    items: [
      { id: 'media_publishing:image_publish', resourceType: 'media_publishing', resourceSubtype: 'image_publish', label: '图片发布', description: '图片素材整理、压缩、命名、托管和发布协助。', info: '适用：公告图、活动图、作品图、截图和公开素材；需确认素材版权、发布渠道和可见范围。' },
      { id: 'media_publishing:poster_design', resourceType: 'media_publishing', resourceSubtype: 'poster_design', label: '海报物料', description: '活动海报、长图、封面和宣传图物料。', info: '适用：公益活动、课程、项目招募、发布公告；需提供尺寸、品牌要求、二维码和文案。' },
      { id: 'media_publishing:social_post_publish', resourceType: 'media_publishing', resourceSubtype: 'social_post_publish', label: '社媒发布', description: '社交平台图文发布、排版和发布前检查。', info: '适用：公众号、小红书、X、LinkedIn、社区帖和开源项目公告；需说明账号、发布时间和审核人。' },
      { id: 'media_publishing:video_publish', resourceType: 'media_publishing', resourceSubtype: 'video_publish', label: '视频发布', description: '短视频、演示视频、字幕和封面发布协助。', info: '适用：项目 Demo、课程片段、活动回顾、功能演示；需提供素材授权、字幕要求和目标平台。' },
      { id: 'media_publishing:thumbnail_cover', resourceType: 'media_publishing', resourceSubtype: 'thumbnail_cover', label: '封面缩略图', description: '视频、文章、课程和项目封面图整理。', info: '适用：YouTube、B 站、公众号、课程页、项目页封面；需说明比例、标题和视觉风格。' },
      { id: 'media_publishing:asset_cleanup', resourceType: 'media_publishing', resourceSubtype: 'asset_cleanup', label: '素材清理', description: '图片压缩、裁剪、去背景、格式转换和命名整理。', info: '适用：PNG/JPEG/WebP、透明底、批量裁剪、压缩和对象存储前整理；不处理侵权或隐私素材。' },
      { id: 'media_publishing:brand_asset', resourceType: 'media_publishing', resourceSubtype: 'brand_asset', label: '品牌素材', description: 'Logo、色板、图标、模板和公开素材包整理。', info: '适用：项目品牌包、开源 README 素材、赞助页素材和团队模板；需确认商标/版权归属。' },
      { id: 'media_publishing:content_moderation', resourceType: 'media_publishing', resourceSubtype: 'content_moderation', label: '发布审核', description: '发布前版权、隐私、敏感信息和平台规则检查。', info: '适用：公开图片、视频、文案、案例、截图；重点检查隐私、密钥、商标和未授权素材。' },
    ],
  },
  {
    id: 'data_productivity',
    label: '数据与效率工具',
    description: '按报表、埋点、问卷、自动化和数据整理选择服务。',
    icon: 'i-carbon-chart-line',
    items: [
      { id: 'data_productivity:analytics_report', resourceType: 'data_productivity', resourceSubtype: 'analytics_report', label: '数据分析报告', description: '运营、申请、活动和用户行为分析报告。', info: '适用：转化漏斗、留存、活动复盘、成本分析；需说明数据来源、口径和交付格式。' },
      { id: 'data_productivity:dashboard_build', resourceType: 'data_productivity', resourceSubtype: 'dashboard_build', label: '看板搭建', description: '指标看板、项目状态、资源消耗和审核进度视图。', info: '适用：内部运营看板、资源消耗、审核效率、用户增长；需说明指标定义和刷新频率。' },
      { id: 'data_productivity:event_tracking', resourceType: 'data_productivity', resourceSubtype: 'event_tracking', label: '埋点方案', description: '事件命名、属性、漏斗和埋点验收方案。', info: '适用：页面访问、按钮点击、申请流程、支付流程和发布转化；需说明产品流程。' },
      { id: 'data_productivity:survey_form', resourceType: 'data_productivity', resourceSubtype: 'survey_form', label: '问卷表单', description: '问卷、报名表、反馈表和自动汇总流程。', info: '适用：活动报名、用户调研、满意度、需求收集；需说明题型、隐私声明和导出方式。' },
      { id: 'data_productivity:spreadsheet_automation', resourceType: 'data_productivity', resourceSubtype: 'spreadsheet_automation', label: '表格自动化', description: '表格清洗、公式、导入导出和批量整理自动化。', info: '适用：Excel、CSV、Sheets、报名表和对账表；需提供样例数据和目标结果。' },
      { id: 'data_productivity:data_cleaning', resourceType: 'data_productivity', resourceSubtype: 'data_cleaning', label: '数据清洗', description: '去重、格式标准化、字段映射和质量检查。', info: '适用：名单、订单、申请表、日志和指标数据；敏感数据需脱敏后提交。' },
      { id: 'data_productivity:seo_research', resourceType: 'data_productivity', resourceSubtype: 'seo_research', label: 'SEO 研究', description: '关键词、标题结构、站点地图和搜索展示优化。', info: '适用：项目官网、文档站、博客、活动页；需提供站点 URL、目标受众和关键词方向。' },
      { id: 'data_productivity:feedback_mining', resourceType: 'data_productivity', resourceSubtype: 'feedback_mining', label: '反馈整理', description: '用户反馈、Issue、评论和客服记录聚类整理。', info: '适用：产品反馈、社区评论、Issue、问卷开放题；需脱敏并说明分类目标。' },
    ],
  },
  {
    id: 'quality_review',
    label: '体验与质量审查',
    description: '按 UI、可访问性、性能、兼容性和发布风险选择复核服务。',
    icon: 'i-carbon-task-complete',
    items: [
      { id: 'quality_review:ui_review', resourceType: 'quality_review', resourceSubtype: 'ui_review', label: 'UI 走查', description: '页面层级、布局、对齐、文案和交互走查。', info: '适用：申请页、详情页、运营页、表单和后台工具；需提供访问地址或截图。' },
      { id: 'quality_review:accessibility_audit', resourceType: 'quality_review', resourceSubtype: 'accessibility_audit', label: '可访问性审查', description: '键盘导航、语义、对比度和屏幕阅读器基础检查。', info: '适用：表单、弹窗、导航、数据表和发布页面；参考 WCAG 常见检查项。' },
      { id: 'quality_review:performance_audit', resourceType: 'quality_review', resourceSubtype: 'performance_audit', label: '性能审查', description: '加载、资源体积、交互延迟和关键路径检查。', info: '适用：前端页面、图片资源、脚本加载、移动端体验；需提供测试入口和目标设备。' },
      { id: 'quality_review:browser_compatibility', resourceType: 'quality_review', resourceSubtype: 'browser_compatibility', label: '兼容性测试', description: '浏览器、移动端、响应式和深浅色模式检查。', info: '适用：Chrome、Safari、Firefox、移动端、暗色模式；需说明目标浏览器矩阵。' },
      { id: 'quality_review:release_checklist', resourceType: 'quality_review', resourceSubtype: 'release_checklist', label: '发布清单', description: '发布前功能、数据、权限、监控和回滚项检查。', info: '适用：新功能上线、活动页发布、资源开放；需提供变更说明和回滚方式。' },
      { id: 'quality_review:copy_review', resourceType: 'quality_review', resourceSubtype: 'copy_review', label: '文案审查', description: '页面文案、提示、错误信息和操作语气检查。', info: '适用：按钮、表单、通知、弹窗、协议和帮助文档；关注准确性、歧义和误导表达。' },
      { id: 'quality_review:privacy_copy_check', resourceType: 'quality_review', resourceSubtype: 'privacy_copy_check', label: '隐私文案检查', description: '隐私提示、数据收集说明和用户授权文案检查。', info: '适用：登录、上传、通知订阅、数据导出；需说明数据字段、用途和保留周期。' },
      { id: 'quality_review:incident_postmortem', resourceType: 'quality_review', resourceSubtype: 'incident_postmortem', label: '复盘整理', description: '故障、投诉、发布事故和运营事件复盘文档。', info: '适用：事故时间线、影响范围、根因、改进项和负责人；不替代正式安全审计。' },
    ],
  },
  {
    id: 'cloud_compute',
    label: '云资源与算力',
    description: '按主机、GPU、K8s 与对象存储等基础设施能力选择。',
    icon: 'i-carbon-cloud-service-management',
    items: [
      { id: 'server:ecs', resourceType: 'server', resourceSubtype: 'ecs', label: '云服务器', description: '通用云主机、运行环境和基础算力。', info: '适用：ECS / VM / 云主机，需说明规格、区域、端口和用途。' },
      { id: 'server:lightweight', resourceType: 'server', resourceSubtype: 'lightweight', label: '轻量服务器', description: '轻量应用、Demo 和小型服务实例。', info: '适用：轻量应用、演示环境、低成本公益服务部署。' },
      { id: 'server:spot', resourceType: 'server', resourceSubtype: 'spot', label: '竞价实例', description: '可中断低成本计算实例。', info: '适用：批处理、离线任务、临时实验和可中断工作负载。' },
      { id: 'gpu:nvidia_t4', resourceType: 'gpu', resourceSubtype: 'nvidia_t4', label: 'GPU T4', description: 'T4 推理、轻量训练和视频处理。', info: '适用：轻量推理、转码、CV 实验和低成本 GPU 任务。' },
      { id: 'gpu:nvidia_l4', resourceType: 'gpu', resourceSubtype: 'nvidia_l4', label: 'GPU L4', description: 'L4 推理、图像和视频任务。', info: '适用：推理服务、视觉任务、视频生成或转码。' },
      { id: 'gpu:nvidia_a10', resourceType: 'gpu', resourceSubtype: 'nvidia_a10', label: 'GPU A10', description: 'A10 推理和中等规模训练。', info: '适用：中等规模模型实验、渲染、推理和图像任务。' },
      { id: 'gpu:nvidia_a100', resourceType: 'gpu', resourceSubtype: 'nvidia_a100', label: 'GPU A100', description: 'A100 大模型训练和高性能推理。', info: '适用：大模型训练、批量推理和高吞吐 GPU 任务。' },
      { id: 'gpu:nvidia_h100', resourceType: 'gpu', resourceSubtype: 'nvidia_h100', label: 'GPU H100', description: 'H100 高端训练和推理算力。', info: '适用：高性能训练、长上下文推理和高成本实验。' },
      { id: 'k8s_namespace:dev', resourceType: 'k8s_namespace', resourceSubtype: 'dev', label: 'K8s Namespace', description: '命名空间、资源配额和环境隔离。', info: '适用：dev / test / staging / prod 命名空间和配额申请。' },
      { id: 'k8s_namespace:ingress', resourceType: 'k8s_namespace', resourceSubtype: 'ingress', label: 'K8s Ingress', description: 'Ingress、域名路由和服务暴露。', info: '适用：服务入口、TLS、路径路由、灰度和内外网暴露。' },
      { id: 'k8s_namespace:pvc', resourceType: 'k8s_namespace', resourceSubtype: 'pvc', label: 'K8s PVC', description: '持久卷、挂载和存储配额。', info: '适用：状态服务、模型权重、缓存目录和持久化数据。' },
      { id: 'object_storage:bucket', resourceType: 'object_storage', resourceSubtype: 'bucket', label: '对象存储', description: 'Bucket、容量、权限与生命周期策略。', info: '适用：OSS / S3 Bucket、读写权限、生命周期和跨域配置。' },
      { id: 'object_storage:public_assets', resourceType: 'object_storage', resourceSubtype: 'public_assets', label: '公开素材桶', description: '公益项目静态资源和公开素材托管。', info: '适用：图片、下载文件、公开页面素材和 CDN 源站。' },
      { id: 'object_storage:backup', resourceType: 'object_storage', resourceSubtype: 'backup', label: '备份存储', description: '备份、归档和恢复材料存储。', info: '适用：数据库备份、日志归档、冷数据和恢复演练。' },
      { id: 'object_storage:cdn_origin', resourceType: 'object_storage', resourceSubtype: 'cdn_origin', label: 'CDN 源站', description: '对象存储作为 CDN 源站使用。', info: '适用：静态资源加速、缓存策略和访问控制。' },
    ],
  },
  {
    id: 'devops_delivery',
    label: 'DevOps 与交付',
    description: '按仓库、流水线与交付能力选择协作资源。',
    icon: 'i-carbon-continuous-deployment',
    items: [
      { id: 'git_repository:github', resourceType: 'git_repository', resourceSubtype: 'github', label: 'GitHub 仓库', description: 'GitHub 仓库只读、开发者或维护者权限。', info: '适用：仓库协作、Issue、Actions、Deploy Key 和组织权限。' },
      { id: 'git_repository:gitlab', resourceType: 'git_repository', resourceSubtype: 'gitlab', label: 'GitLab 仓库', description: 'GitLab 项目、Group 和 Runner 访问。', info: '适用：项目权限、Group 权限、MR、CI 和部署密钥。' },
      { id: 'git_repository:gitee', resourceType: 'git_repository', resourceSubtype: 'gitee', label: 'Gitee 仓库', description: 'Gitee 仓库协作权限。', info: '适用：国内仓库协作、只读、开发者和维护者权限。' },
      { id: 'git_repository:deploy_key', resourceType: 'git_repository', resourceSubtype: 'deploy_key', label: 'Deploy Key', description: '部署密钥、机器人账号和只读拉取权限。', info: '适用：自动部署、CI 拉取代码、只读密钥和密钥轮换。' },
      { id: 'cicd:pipeline', resourceType: 'cicd', resourceSubtype: 'pipeline', label: 'CI/CD 权限', description: '流水线执行、配置、部署权限。', info: '适用：流水线运行、变量、环境和发布权限。' },
      { id: 'cicd:github_actions', resourceType: 'cicd', resourceSubtype: 'github_actions', label: 'GitHub Actions', description: 'GitHub Actions 工作流、Secret 和部署权限。', info: '适用：workflow_dispatch、Secrets、Environments 和 Runner。' },
      { id: 'cicd:gitlab_ci', resourceType: 'cicd', resourceSubtype: 'gitlab_ci', label: 'GitLab CI', description: 'GitLab CI Runner、变量和部署权限。', info: '适用：CI/CD Variables、Runner、环境和部署任务。' },
      { id: 'cicd:docker_registry', resourceType: 'cicd', resourceSubtype: 'docker_registry', label: '镜像仓库', description: '镜像推拉、命名空间和制品权限。', info: '适用：Docker Registry、Harbor、GHCR、镜像推送和拉取。' },
      { id: 'cicd:release_channel', resourceType: 'cicd', resourceSubtype: 'release_channel', label: '发布通道', description: '灰度、正式发布和回滚通道权限。', info: '适用：灰度发布、正式发布、回滚和版本管理。' },
    ],
  },
  {
    id: 'network_access',
    label: '域名与网络',
    description: '按网络访问、白名单与安全边界选择权限。',
    icon: 'i-carbon-network-4',
    items: [
      { id: 'vpn:personal', resourceType: 'vpn', resourceSubtype: 'personal', label: '个人 VPN', description: '个人内网访问能力。', info: '适用：短期排查、内部系统访问和远程协作。' },
      { id: 'vpn:project', resourceType: 'vpn', resourceSubtype: 'project', label: '项目 VPN', description: '项目团队内网访问能力。', info: '适用：项目组多人访问、统一回收和范围限制。' },
      { id: 'vpn:bastion', resourceType: 'vpn', resourceSubtype: 'bastion', label: '堡垒机访问', description: '堡垒机、跳板机和审计访问。', info: '适用：服务器登录、命令审计、临时账号和最小权限。' },
      { id: 'vpn:zero_trust', resourceType: 'vpn', resourceSubtype: 'zero_trust', label: '零信任访问', description: '应用级访问、身份校验和策略放行。', info: '适用：Zero Trust、应用网关、身份策略和短期授权。' },
      { id: 'ip_allowlist:office_ip', resourceType: 'ip_allowlist', resourceSubtype: 'office_ip', label: '办公 IP 白名单', description: '办公网络来源 IP 放行。', info: '适用：办公室、学校、实验室或固定出口 IP。' },
      { id: 'ip_allowlist:server_ip', resourceType: 'ip_allowlist', resourceSubtype: 'server_ip', label: '服务器 IP 白名单', description: '云服务器或固定机器来源 IP 放行。', info: '适用：服务器访问数据库、API、对象存储或控制面。' },
      { id: 'ip_allowlist:third_party_ip', resourceType: 'ip_allowlist', resourceSubtype: 'third_party_ip', label: '第三方 IP 白名单', description: '合作方、供应商或外部系统来源 IP 放行。', info: '适用：第三方回调、供应商系统、外部集成和临时联调。' },
      { id: 'ip_allowlist:webhook_ip', resourceType: 'ip_allowlist', resourceSubtype: 'webhook_ip', label: 'Webhook IP 白名单', description: 'Webhook 回调来源 IP 放行。', info: '适用：GitHub、支付、通知、机器人和自动化回调。' },
      { id: 'ip_allowlist:api_gateway_ip', resourceType: 'ip_allowlist', resourceSubtype: 'api_gateway_ip', label: 'API 网关白名单', description: '网关、边缘节点或服务出口 IP 放行。', info: '适用：API Gateway、Cloudflare、边缘 Worker 和代理出口。' },
      { id: 'ip_allowlist:cidr', resourceType: 'ip_allowlist', resourceSubtype: 'cidr', label: 'CIDR 网段', description: '网段级白名单和安全边界配置。', info: '适用：VPC、学校网段、办公网段和专线网段。' },
    ],
  },
  {
    id: 'notification_communication',
    label: '通知与通信',
    description: '按邮件、短信、Webhook、IM 机器人与 Web Push 选择通知通道。',
    icon: 'i-carbon-notification',
    items: [
      { id: 'notification_channel:email', resourceType: 'notification_channel', resourceSubtype: 'email', label: '邮件通知', description: '系统邮件、审核通知和运营邮件通道。', info: '适用：申请进度、审核结果、管理员通知和用户触达；需说明发送对象、频率和退订策略。' },
      { id: 'notification_channel:smtp', resourceType: 'notification_channel', resourceSubtype: 'smtp', label: 'SMTP', description: 'SMTP 账号、发件域名和邮件中继。', info: '适用：自有域名发信、事务邮件、批量通知；需说明 SPF、DKIM、DMARC 和限流。' },
      { id: 'notification_channel:resend', resourceType: 'notification_channel', resourceSubtype: 'resend', label: 'Resend', description: 'Resend API Key、发件域名和模板权限。', info: '适用：事务邮件、模板邮件、Webhook 回执；需说明发件域名和日发送量。' },
      { id: 'notification_channel:sms', resourceType: 'notification_channel', resourceSubtype: 'sms', label: '短信通道', description: '短信验证码、通知短信和签名模板。', info: '适用：验证码、重要提醒和异常告警；需说明签名、模板、频率和接收人范围。' },
      { id: 'notification_channel:webhook', resourceType: 'notification_channel', resourceSubtype: 'webhook', label: 'Webhook', description: '回调地址、签名密钥和事件订阅。', info: '适用：申请事件、支付回调、CI 通知和第三方集成；需说明鉴权、重试和幂等策略。' },
      { id: 'notification_channel:feishu', resourceType: 'notification_channel', resourceSubtype: 'feishu', label: '飞书机器人', description: '飞书群机器人、Webhook 和应用消息。', info: '适用：群通知、审核提醒、告警同步；需说明群范围、消息类型和敏感信息脱敏。' },
      { id: 'notification_channel:dingtalk', resourceType: 'notification_channel', resourceSubtype: 'dingtalk', label: '钉钉机器人', description: '钉钉群机器人和工作通知。', info: '适用：团队通知、任务提醒和告警；需说明安全关键词、签名和发送频率。' },
      { id: 'notification_channel:wecom', resourceType: 'notification_channel', resourceSubtype: 'wecom', label: '企业微信机器人', description: '企业微信群机器人和应用消息。', info: '适用：企业微信群通知、审批提醒和状态同步；需说明接收群和数据脱敏。' },
      { id: 'notification_channel:web_push', resourceType: 'notification_channel', resourceSubtype: 'web_push', label: 'Web Push', description: '浏览器推送、VAPID 密钥和订阅管理。', info: '适用：站内通知、离线提醒和审核状态；需说明订阅授权、退订和频率控制。' },
      { id: 'notification_channel:telegram_bot', resourceType: 'notification_channel', resourceSubtype: 'telegram_bot', label: 'Telegram Bot', description: 'Telegram Bot Token、频道和私聊通知。', info: '适用：国际用户通知、机器人提醒和频道广播；需说明接收范围和隐私保护。' },
    ],
  },
  {
    id: 'identity_security',
    label: '认证与安全',
    description: '按登录认证、密钥、权限、风控和安全策略选择资源。',
    icon: 'i-carbon-security',
    items: [
      { id: 'identity_security:oauth_app', resourceType: 'identity_security', resourceSubtype: 'oauth_app', label: 'OAuth 应用', description: 'OAuth Client、回调地址和授权范围。', info: '适用：第三方登录、GitHub App、Linux.do 登录等；需说明回调域名、Scope 和用户数据范围。' },
      { id: 'identity_security:oidc', resourceType: 'identity_security', resourceSubtype: 'oidc', label: 'OIDC', description: 'OIDC Provider、Client 和 Token 配置。', info: '适用：统一登录、服务间身份、JWT 校验；需说明 issuer、audience、回调和密钥轮换。' },
      { id: 'identity_security:saml_sso', resourceType: 'identity_security', resourceSubtype: 'saml_sso', label: 'SAML SSO', description: 'SAML 单点登录、元数据和证书配置。', info: '适用：企业身份源、学校身份源和统一认证；需说明 IdP、SP、证书和属性映射。' },
      { id: 'identity_security:api_key', resourceType: 'identity_security', resourceSubtype: 'api_key', label: 'API Key', description: 'API Key、临时 Token 和访问密钥。', info: '适用：接口调用、临时授权和自动化任务；需说明权限范围、过期时间和存放方式。' },
      { id: 'identity_security:service_account', resourceType: 'identity_security', resourceSubtype: 'service_account', label: 'Service Account', description: '服务账号、机器人账号和最小权限角色。', info: '适用：CI、部署、后台任务和服务间调用；需说明负责人、权限边界和回收时间。' },
      { id: 'identity_security:secret_vault', resourceType: 'identity_security', resourceSubtype: 'secret_vault', label: '密钥托管', description: 'Secret Vault、加密变量和密钥轮换。', info: '适用：环境变量、API Key、数据库密码和部署密钥；需说明读写权限和轮换周期。' },
      { id: 'identity_security:turnstile', resourceType: 'identity_security', resourceSubtype: 'turnstile', label: 'Turnstile', description: '人机验证站点密钥和后端密钥。', info: '适用：登录、申请提交、防刷和反滥用；需说明域名、验证位置和失败处理。' },
      { id: 'identity_security:waf_rule', resourceType: 'identity_security', resourceSubtype: 'waf_rule', label: 'WAF 规则', description: 'Web 防火墙、Bot 防护和访问策略。', info: '适用：路径防护、Bot 拦截、速率限制和国家/地区策略；需说明影响范围和回滚方案。' },
      { id: 'identity_security:security_review', resourceType: 'identity_security', resourceSubtype: 'security_review', label: '安全复核', description: '权限、上线、数据和安全配置复核。', info: '适用：上线前检查、权限复核、敏感数据处理和风控确认；需提供变更说明。' },
      { id: 'identity_security:rbac_role', resourceType: 'identity_security', resourceSubtype: 'rbac_role', label: 'RBAC 角色', description: '角色、权限组和资源访问策略。', info: '适用：管理员、审核员、协作者和服务账号权限；需说明最小权限和有效期。' },
    ],
  },
]
export const CODEX_DEFAULT_BUDGET_USD = DEFAULT_LLM_API_MODELS[0].defaultBudgetUsd
export const CODEX_MIN_BUDGET_USD = DEFAULT_LLM_API_MODELS[0].minBudgetUsd
export const CODEX_MAX_BUDGET_USD = DEFAULT_LLM_API_MODELS[0].maxBudgetUsd
export const CODEX_EXTENDED_REVIEW_THRESHOLD_USD = LLM_API_EXTENDED_REVIEW_THRESHOLD_USD
export const CODEX_POINTS_PER_USD = DEFAULT_LLM_API_MODELS[0].pointsPerUsd
export const CODEX_IP_LIMIT = DEFAULT_LLM_API_MODELS[0].ipLimit
export const CODEX_DEFAULT_RPM_LIMIT = DEFAULT_LLM_API_MODELS[0].rpmLimit
export const CODEX_CONCURRENCY_LIMIT = DEFAULT_LLM_API_MODELS[0].concurrencyLimit
export const CODEX_STANDARD_PROCESSING_HOURS = LLM_API_STANDARD_PROCESSING_HOURS
export const CODEX_EXTENDED_PROCESSING_HOURS = LLM_API_EXTENDED_PROCESSING_HOURS
export const STUDENT_REVIEW_FEE = 300
export const STORAGE_EXTENSION_DAYS = 7
export const STORAGE_EXTENSION_COST = 300
export const REJECTION_REVIEW_FEE_RATE = 0.3
export const REJECTION_REVIEW_FEE_MIN = 1
export const REJECTION_REVIEW_FEE_MAX = 300
export const REJECTION_FEE_WAIVER_BLOCK_DAYS = 3
export const REJECTION_FRAUD_COOLDOWN_DAYS = 7
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
export const MAX_ACTIVE_USER_REQUESTS = 5
export const DEFAULT_MIN_APPLICATION_DESCRIPTION_CHARS = 50
export const DEFAULT_APPLICATION_SUBMIT_COOLDOWN_SECONDS = 60
export const EDUCATION_EMAIL_CHALLENGE_TTL_HOURS = 24 * 7
export const EDUCATION_EMAIL_REVIEW_INBOX = 'welfare@tagzxia.com'
export const DAILY_CHECK_IN_MAX_POINTS = 30
export const DAILY_CHECK_IN_COUPON_TTL_DAYS = 30
export const INVITATION_BIND_WINDOW_HOURS = 8
export const SQUARE_SHARE_DISCOUNT_RATE = 0.95
export const SQUARE_BOOST_DISCOUNT_STEP = 0.01
export const SQUARE_BOOSTS_PER_DISCOUNT_STEP = 3
export const SQUARE_MIN_DISCOUNT_RATE = 0.8
export const SQUARE_BOOST_REWARD_POINTS = 5
export const SQUARE_DAILY_BOOST_LIMIT = 10
export const SQUARE_BOOST_REPORT_PENALTY_POINTS = 10
export const SQUARE_BOOST_REPORT_COOLDOWN_DAYS = 3
export const COLLABORATION_APPLICATION_MIN_REASON_CHARS = 20
export const COLLABORATION_DELIVERY_REWARD_MIN = 1
export const COLLABORATION_DELIVERY_REWARD_MAX = 100000
export { DATA_RETENTION_DAYS }

const DEFAULT_KIND_POLICY: ApplicationKindPolicy = {
  enabled: true,
  dailyLimit: 100,
  perUserDailyLimit: 5,
  openStart: '',
  openEnd: '',
  closedReason: '',
}

export function defaultApplicationPolicy(): ApplicationPolicyConfig {
  return {
    minDescriptionChars: DEFAULT_MIN_APPLICATION_DESCRIPTION_CHARS,
    submitCooldownSeconds: DEFAULT_APPLICATION_SUBMIT_COOLDOWN_SECONDS,
    powEnabled: false,
    powDifficulty: 3,
    turnstileEnabled: false,
    turnstileSiteKey: '',
    turnstileSecretKey: '',
    categories: {
      code: { ...DEFAULT_KIND_POLICY, dailyLimit: 80, perUserDailyLimit: 3 },
      image: { ...DEFAULT_KIND_POLICY, dailyLimit: 40, perUserDailyLimit: 2 },
      pro: { ...DEFAULT_KIND_POLICY, dailyLimit: 30, perUserDailyLimit: 2 },
      resource: { ...DEFAULT_KIND_POLICY, dailyLimit: 30, perUserDailyLimit: 2 },
    },
  }
}

function now() {
  return new Date().toISOString()
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString()
}

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match)
    return undefined

  return Number(match[1]) * 60 + Number(match[2])
}

function isWithinOpenWindow(policy: ApplicationKindPolicy, current = new Date()) {
  const start = timeToMinutes(policy.openStart)
  const end = timeToMinutes(policy.openEnd)
  if (start === undefined || end === undefined || start === end)
    return true

  const currentMinutes = current.getHours() * 60 + current.getMinutes()
  if (start < end)
    return currentMinutes >= start && currentMinutes <= end
  return currentMinutes >= start || currentMinutes <= end
}

function applicationOpenWindowLabel(policy: ApplicationKindPolicy) {
  const start = timeToMinutes(policy.openStart)
  const end = timeToMinutes(policy.openEnd)
  if (start === undefined || end === undefined || start === end)
    return '全天开放'

  return `${policy.openStart} - ${policy.openEnd}`
}

function simplePowHash(value: string) {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function applicationPowChallenge(input: { userId: string, type: RequestKind, title: string, description: string }) {
  return `${input.userId}:${input.type}:${input.title.trim()}:${richTextToPlainText(input.description).trim()}`
}

export function isValidApplicationPow(challenge: string, nonce: string | undefined, difficulty: number) {
  const normalizedNonce = nonce?.trim() ?? ''
  if (!normalizedNonce)
    return false

  return simplePowHash(`${challenge}:${normalizedNonce}`).startsWith('0'.repeat(Math.max(1, Math.min(6, difficulty))))
}

export function solveApplicationPow(challenge: string, difficulty: number, maxIterations = 600000) {
  for (let index = 0; index < maxIterations; index += 1) {
    const nonce = String(index)
    if (isValidApplicationPow(challenge, nonce, difficulty))
      return nonce
  }
  throw new Error('PoW 计算失败，请稍后重试')
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function assertEducationEmail(value: string) {
  assertEducationEmailAddress(value)
}

function createEducationEmailCode() {
  const randomParts = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 10).toUpperCase())
  return `TGW-EDU-${Date.now().toString(36).toUpperCase()}-${randomParts.join('-')}`
}

export function createUserInviteCode(userId: string) {
  return `TGW-${simplePowHash(userId).slice(0, 8).toUpperCase()}`
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

export function rollDailyCheckInPoints(random = Math.random) {
  const value = Math.max(0, Math.min(0.999999, random()))
  return Math.max(1, Math.ceil(DAILY_CHECK_IN_MAX_POINTS * (1 - Math.sqrt(value))))
}

function isPromotionActive(referenceTime = now()) {
  const time = new Date(referenceTime).getTime()
  const start = new Date(ACTIVITY_START_AT).getTime()
  const end = new Date(ACTIVITY_END_AT).getTime()
  return Number.isFinite(time) && time >= start && time < end
}

export function calculateActivityPrice(cost: number, referenceTime = now()) {
  if (!isPromotionActive(referenceTime))
    return cost

  return Math.max(1, Math.ceil(cost * ACTIVITY_DISCOUNT_RATE))
}

export function llmApiBudgetActivityDiscountRate(budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  if (isGptProModel(model))
    return GPT_PRO_ACTIVITY_DISCOUNT_RATE

  const budget = normalizeLlmApiBudgetUsd(budgetUsd, model)
  const tier = LLM_API_BUDGET_ACTIVITY_TIERS.find(item => budget >= item.minBudgetUsd)
  return tier?.discountRate ?? ACTIVITY_DISCOUNT_RATE
}

export function calculateLlmApiBudgetActivityPrice(cost: number, budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0], referenceTime = now()) {
  if (!isPromotionActive(referenceTime))
    return cost

  if (isGptProModel(model))
    return applyRateDiscount(cost, GPT_PRO_ACTIVITY_DISCOUNT_RATE)

  return applyRateDiscount(cost, llmApiBudgetActivityDiscountRate(budgetUsd, model))
}

export function calculateSquareBoostDiscountRate(boostCount: number) {
  const steps = Math.floor(Math.max(0, boostCount) / SQUARE_BOOSTS_PER_DISCOUNT_STEP)
  return Math.max(SQUARE_MIN_DISCOUNT_RATE, SQUARE_SHARE_DISCOUNT_RATE - steps * SQUARE_BOOST_DISCOUNT_STEP)
}

export function applyRateDiscount(cost: number, rate: number) {
  return Math.max(1, Math.ceil(cost * Math.max(0.01, Math.min(1, rate))))
}

export function isGptProModel(modelOrKey?: Pick<LlmApiModelPricing, 'key'> | string) {
  const key = typeof modelOrKey === 'string' ? modelOrKey : modelOrKey?.key
  return key === GPT_PRO_MODEL_KEY
}

export function defaultLlmApiDuration(model: Pick<LlmApiModelPricing, 'key'> = DEFAULT_LLM_API_MODELS[0]) {
  return isGptProModel(model) ? GPT_PRO_DEFAULT_DURATION : RESOURCE_DEFAULT_DURATION
}

export function llmApiDurationExtensionCost(duration: string | undefined, model: Pick<LlmApiModelPricing, 'key'> = DEFAULT_LLM_API_MODELS[0]) {
  const normalized = duration || defaultLlmApiDuration(model)
  return normalized === defaultLlmApiDuration(model) ? 0 : RESOURCE_DURATION_EXTENSION_COST
}

export function buildPricingSnapshot(type: RequestKind, referenceTime = now()) {
  const baseCost = BASE_REQUEST_COST[type]
  const discountedCost = calculateActivityPrice(baseCost, referenceTime)
  const active = discountedCost !== baseCost
  return {
    baseCost,
    cost: discountedCost,
    discountRate: active ? ACTIVITY_DISCOUNT_RATE : 1,
    promotionName: active ? ACTIVITY_NAME : undefined,
    promotionEndsAt: active ? ACTIVITY_END_AT : undefined,
    appliedAt: referenceTime,
  }
}

export function calculateRejectionReviewFee(cost: number) {
  return Math.min(REJECTION_REVIEW_FEE_MAX, Math.max(REJECTION_REVIEW_FEE_MIN, Math.ceil(cost * REJECTION_REVIEW_FEE_RATE)))
}

export function calculateApplicationPrepaidCost(type: RequestKind, extendedStorage: boolean, expeditedProcessing = false, referenceTime = now()) {
  const pricing = buildPricingSnapshot(type, referenceTime)
  return pricing.cost
    + (extendedStorage ? STORAGE_EXTENSION_COST : 0)
    + (type === 'pro' && expeditedProcessing ? PRO_EXPEDITE_COST : 0)
}

export function normalizeLlmApiModelPricing(model: Partial<LlmApiModelPricing>): LlmApiModelPricing {
  const fallback = DEFAULT_LLM_API_MODELS[0]
  const pointsPerUsd = Math.max(1, Math.min(1000, Math.trunc(Number(model.pointsPerUsd || fallback.pointsPerUsd))))
  const minBudgetUsd = Math.max(1, Math.min(100000, Math.trunc(Number(model.minBudgetUsd || fallback.minBudgetUsd))))
  const maxBudgetUsd = Math.max(minBudgetUsd, Math.min(100000, Math.trunc(Number(model.maxBudgetUsd || fallback.maxBudgetUsd))))
  const defaultBudgetUsd = Math.max(minBudgetUsd, Math.min(maxBudgetUsd, Math.trunc(Number(model.defaultBudgetUsd || fallback.defaultBudgetUsd))))
  const region = ['domestic', 'global', 'custom'].includes(String(model.region)) ? model.region as LlmApiModelRegion : 'custom'

  return {
    key: String(model.key || fallback.key).trim() || fallback.key,
    name: String(model.name || fallback.name).trim() || fallback.name,
    provider: String(model.provider || fallback.provider).trim() || fallback.provider,
    region,
    description: String(model.description || '').trim() || fallback.description,
    enabled: model.enabled !== false,
    pointsPerUsd,
    defaultBudgetUsd,
    minBudgetUsd,
    maxBudgetUsd,
    ipLimit: Math.max(1, Math.min(50, Math.trunc(Number(model.ipLimit || fallback.ipLimit)))),
    rpmLimit: Math.max(1, Math.min(1000, Math.trunc(Number(model.rpmLimit || fallback.rpmLimit)))),
    tpmLimit: Math.max(1, Math.min(10_000_000, Math.trunc(Number(model.tpmLimit || fallback.tpmLimit || 10000)))),
    concurrencyLimit: Math.max(1, Math.min(100, Math.trunc(Number(model.concurrencyLimit || fallback.concurrencyLimit)))),
  }
}

export function normalizeLlmApiModelPricings(value: unknown): LlmApiModelPricing[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_LLM_API_MODELS
  const sourceByKey = new Map(source
    .filter((item): item is Partial<LlmApiModelPricing> => !!item && typeof item === 'object')
    .map(item => [String(item.key || '').trim(), item]))

  return DEFAULT_LLM_API_MODELS.map((fallback) => {
    const model = normalizeLlmApiModelPricing({ ...fallback, ...sourceByKey.get(fallback.key), key: fallback.key, name: fallback.name })
    return {
      ...model,
      pointsPerUsd: fallback.pointsPerUsd,
      provider: String(sourceByKey.get(fallback.key)?.provider || fallback.provider).trim() || fallback.provider,
      description: String(sourceByKey.get(fallback.key)?.description || fallback.description).trim() || fallback.description,
      region: sourceByKey.get(fallback.key)?.region && ['domestic', 'global', 'custom'].includes(String(sourceByKey.get(fallback.key)?.region)) ? sourceByKey.get(fallback.key)!.region as LlmApiModelRegion : fallback.region,
    }
  })
}

export function resolveLlmApiModel(modelKey?: string, models: readonly LlmApiModelPricing[] = DEFAULT_LLM_API_MODELS) {
  const enabledModels = normalizeLlmApiModelPricings(models).filter(item => item.enabled)
  return enabledModels.find(item => item.key === modelKey)
    ?? enabledModels.find(item => item.key === LLM_API_DEFAULT_MODEL_KEY)
    ?? enabledModels[0]
    ?? DEFAULT_LLM_API_MODELS[0]
}

export function isSelectableLlmApiModelKey(modelKey: string) {
  return LLM_API_SELECTABLE_MODEL_KEYS.includes(modelKey as typeof LLM_API_SELECTABLE_MODEL_KEYS[number])
}

export function resolveSelectableLlmApiModel(modelKey?: string, models: readonly LlmApiModelPricing[] = DEFAULT_LLM_API_MODELS) {
  const selectableModels = normalizeLlmApiModelPricings(models).filter(item => item.enabled && isSelectableLlmApiModelKey(item.key))
  return selectableModels.find(item => item.key === modelKey)
    ?? selectableModels.find(item => item.key === LLM_API_DEFAULT_MODEL_KEY)
    ?? selectableModels[0]
    ?? DEFAULT_LLM_API_MODELS[0]
}

export function normalizeLlmApiBudgetUsd(value: unknown, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  const amount = Math.trunc(Number(value))
  if (!Number.isFinite(amount))
    return model.defaultBudgetUsd

  return Math.max(model.minBudgetUsd, Math.min(model.maxBudgetUsd, amount))
}

export function calculateLlmApiBaseBudgetCostPoints(budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  const budget = normalizeLlmApiBudgetUsd(budgetUsd, model)
  if (budget <= 100)
    return Math.ceil(budget * 12)

  const over = budget - 100
  return Math.ceil(1200 + over * 15 + 3 * over ** 1.35)
}

export function calculateLlmApiCostPoints(budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  const budget = normalizeLlmApiBudgetUsd(budgetUsd, model)
  if (isGptProModel(model))
    return Math.ceil(budget * PRO_PUBLIC_COST)

  const multiplier = Math.max(0.1, model.pointsPerUsd / DEFAULT_LLM_API_MODELS[0].pointsPerUsd)
  const acceleratedCost = calculateLlmApiBaseBudgetCostPoints(budget, model) * multiplier
  return Math.max(Math.ceil(budget * 10), Math.ceil(acceleratedCost))
}

export function calculateLlmApiRateLimitChangeCost(newRPM: number, defaultRPM: number, newTPM: number, defaultTPM: number) {
  const rpmDiff = Math.abs(Math.trunc(Number(newRPM)) - Math.trunc(Number(defaultRPM)))
  const tpmDiff = Math.abs(Math.trunc(Number(newTPM)) - Math.trunc(Number(defaultTPM)))
  if (!rpmDiff && !tpmDiff)
    return 0

  return 10000 + rpmDiff * 200 + Math.ceil(tpmDiff / 1000) * 500
}

export function llmApiRequiresExtendedReview(budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  return normalizeLlmApiBudgetUsd(budgetUsd, model) > LLM_API_EXTENDED_REVIEW_THRESHOLD_USD
}

export function normalizeCodexBudgetUsd(value: unknown) {
  return normalizeLlmApiBudgetUsd(value, DEFAULT_LLM_API_MODELS[0])
}

export function calculateCodexCostPoints(budgetUsd: number) {
  return calculateLlmApiCostPoints(budgetUsd, DEFAULT_LLM_API_MODELS[0])
}

export function codexRequiresExtendedReview(budgetUsd: number) {
  return llmApiRequiresExtendedReview(budgetUsd, DEFAULT_LLM_API_MODELS[0])
}

export function createRetentionExpiresAt(createdAt: string, extended: boolean) {
  return addDays(createdAt, DATA_RETENTION_DAYS + (extended ? STORAGE_EXTENSION_DAYS : 0))
}

export function createProcessingDueAt(createdAt: string, type: RequestKind, expedited = false) {
  if (type === 'code')
    return addHours(createdAt, CODEX_STANDARD_PROCESSING_HOURS)

  if (type === 'resource')
    return addHours(createdAt, 72)

  if (type !== 'pro')
    return undefined

  return addHours(createdAt, expedited ? PRO_EXPEDITED_PROCESSING_HOURS : PRO_STANDARD_PROCESSING_HOURS)
}

export function createLlmApiProcessingDueAt(createdAt: string, budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  return addHours(createdAt, llmApiRequiresExtendedReview(budgetUsd, model) ? LLM_API_EXTENDED_PROCESSING_HOURS : LLM_API_STANDARD_PROCESSING_HOURS)
}

export function createCodexProcessingDueAt(createdAt: string, budgetUsd: number) {
  return createLlmApiProcessingDueAt(createdAt, budgetUsd, DEFAULT_LLM_API_MODELS[0])
}

export function createRejectionFeeWaiverBlockedUntil(reviewedAt: string) {
  return addDays(reviewedAt, REJECTION_FEE_WAIVER_BLOCK_DAYS)
}

export function createFraudRejectionCooldownUntil(reviewedAt: string) {
  return addDays(reviewedAt, REJECTION_FRAUD_COOLDOWN_DAYS)
}

function proPostApprovalSupplementLimit(application: Pick<WelfareApplication, 'type' | 'postApprovalSupplementLimit'>) {
  if (application.type !== 'pro')
    return undefined

  return application.postApprovalSupplementLimit ?? 1
}

function proPostApprovalSupplementCount(application: Pick<WelfareApplication, 'type' | 'postApprovalSupplementCount'>) {
  if (application.type !== 'pro')
    return undefined

  return application.postApprovalSupplementCount ?? 0
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createCouponCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

export function defaultOauth(): OauthConfig {
  return {
    enabled: false,
    provider: 'github',
    clientId: '',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    callbackUrl: `${globalThis.location?.origin ?? 'http://localhost:3333'}/auth/callback`,
    scopes: 'read:user user:email public_repo',
  }
}

export function defaultState(): WelfareState {
  return {
    users: [],
    oauth: defaultOauth(),
    applicationPolicy: defaultApplicationPolicy(),
    siteBanner: {
      enabled: false,
      title: '',
      body: '',
      tone: 'info',
    },
    systemConfig: defaultSystemConfig(),
    applications: [],
    studentVerifications: [],
    educationEmailChallenges: [],
    couponTemplates: [],
    couponCodes: [],
    couponRedemptions: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    collaborationApplications: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    createdAt: now(),
  }
}

function normalizeApplicationKindPolicy(input: Partial<ApplicationKindPolicy> | undefined, fallback: ApplicationKindPolicy): ApplicationKindPolicy {
  return {
    enabled: input?.enabled ?? fallback.enabled,
    dailyLimit: Math.max(0, Math.trunc(Number(input?.dailyLimit ?? fallback.dailyLimit))),
    perUserDailyLimit: Math.max(0, Math.trunc(Number(input?.perUserDailyLimit ?? fallback.perUserDailyLimit))),
    openStart: input?.openStart?.trim() ?? fallback.openStart,
    openEnd: input?.openEnd?.trim() ?? fallback.openEnd,
    closedReason: input?.closedReason?.trim() ?? fallback.closedReason,
  }
}

export function normalizeApplicationPolicy(input?: Partial<ApplicationPolicyConfig>): ApplicationPolicyConfig {
  const fallback = defaultApplicationPolicy()
  return {
    minDescriptionChars: Math.max(0, Math.trunc(Number(input?.minDescriptionChars ?? fallback.minDescriptionChars))),
    submitCooldownSeconds: Math.max(0, Math.trunc(Number(input?.submitCooldownSeconds ?? fallback.submitCooldownSeconds))),
    powEnabled: !!(input?.powEnabled ?? fallback.powEnabled),
    powDifficulty: Math.max(1, Math.min(6, Math.trunc(Number(input?.powDifficulty ?? fallback.powDifficulty)))),
    turnstileEnabled: !!(input?.turnstileEnabled ?? fallback.turnstileEnabled),
    turnstileSiteKey: input?.turnstileSiteKey?.trim() ?? fallback.turnstileSiteKey,
    turnstileSecretKey: input?.turnstileSecretKey?.trim() ?? fallback.turnstileSecretKey,
    categories: {
      code: normalizeApplicationKindPolicy(input?.categories?.code, fallback.categories.code),
      image: normalizeApplicationKindPolicy(input?.categories?.image, fallback.categories.image),
      pro: normalizeApplicationKindPolicy(input?.categories?.pro, fallback.categories.pro),
      resource: normalizeApplicationKindPolicy(input?.categories?.resource, fallback.categories.resource),
    },
  }
}

export function normalizeSiteBanner(input?: Partial<SiteBannerConfig>): SiteBannerConfig {
  const tone = ['info', 'success', 'warning'].includes(input?.tone ?? '') ? input!.tone! : 'info'
  return {
    enabled: !!input?.enabled,
    title: input?.title?.trim() ?? '',
    body: input?.body?.trim() ?? '',
    tone,
    updatedAt: input?.updatedAt,
    updatedBy: input?.updatedBy,
  }
}

export function defaultSystemConfig(): SystemConfig {
  return {
    siteEnabled: true,
    siteClosedReason: '系统维护中，请稍后再试。',
    loginEnabled: true,
    loginClosedReason: '登录入口维护中，请稍后再试。',
    registrationEnabled: true,
    registrationClosedReason: '新用户注册暂未开放。',
    rechargeEnabled: true,
    rechargeClosedReason: '充值入口维护中，请稍后再试。',
    verification: {
      student: { enabled: true, reason: '学生认证暂未开放。' },
      frontline: { enabled: true, reason: '一线认证暂未开放。' },
    },
  }
}

function normalizeSystemToggle(input: Partial<SystemFeatureToggle> | undefined, fallback: SystemFeatureToggle): SystemFeatureToggle {
  return {
    enabled: input?.enabled ?? fallback.enabled,
    reason: input?.reason?.trim() || fallback.reason,
  }
}

export function normalizeSystemConfig(input?: Partial<SystemConfig>): SystemConfig {
  const fallback = defaultSystemConfig()
  return {
    siteEnabled: input?.siteEnabled ?? fallback.siteEnabled,
    siteClosedReason: input?.siteClosedReason?.trim() || fallback.siteClosedReason,
    loginEnabled: input?.loginEnabled ?? fallback.loginEnabled,
    loginClosedReason: input?.loginClosedReason?.trim() || fallback.loginClosedReason,
    registrationEnabled: input?.registrationEnabled ?? fallback.registrationEnabled,
    registrationClosedReason: input?.registrationClosedReason?.trim() || fallback.registrationClosedReason,
    rechargeEnabled: input?.rechargeEnabled ?? fallback.rechargeEnabled,
    rechargeClosedReason: input?.rechargeClosedReason?.trim() || fallback.rechargeClosedReason,
    verification: {
      student: normalizeSystemToggle(input?.verification?.student, fallback.verification.student),
      frontline: normalizeSystemToggle(input?.verification?.frontline, fallback.verification.frontline),
    },
    updatedAt: input?.updatedAt,
    updatedBy: input?.updatedBy,
  }
}

function normalizeCouponScope(value: unknown): CouponScope {
  return value === 'resource' || value === 'recharge' || value === 'general' ? value : 'resource'
}

function normalizeCouponDiscountType(value: unknown, scope: CouponScope): CouponDiscountType {
  if (value === 'fixed_points' || value === 'fixed_ldc' || value === 'rate')
    return value
  return scope === 'recharge' ? 'fixed_ldc' : 'rate'
}

function normalizeCouponResourceTypes(value: unknown) {
  if (!Array.isArray(value))
    return []

  const known = new Set(RESOURCE_TYPE_CONFIGS.map(item => item.resourceType))
  return Array.from(new Set(value.filter((item): item is ResourceType => known.has(item as ResourceType))))
}

function normalizeCouponRule(input: Partial<CouponRule> | undefined): CouponRule {
  const scope = normalizeCouponScope(input?.scope)
  const discountType = normalizeCouponDiscountType(input?.discountType, scope)
  return {
    scope,
    discountType,
    discountRate: Math.max(0.01, Math.min(1, Number(input?.discountRate || 1))),
    discountAmount: Math.max(0, Math.trunc(Number(input?.discountAmount || 0))),
    resourceTypes: normalizeCouponResourceTypes(input?.resourceTypes),
    minSpend: Math.max(0, Math.trunc(Number(input?.minSpend || 0))),
    maxDiscount: Math.max(0, Math.trunc(Number(input?.maxDiscount || 0))),
  }
}

function normalizeState(input: Partial<WelfareState>): WelfareState {
  const fallback = defaultState()
  const normalized = {
    ...fallback,
    ...input,
    oauth: {
      ...fallback.oauth,
      ...input.oauth,
    },
    applicationPolicy: normalizeApplicationPolicy(input.applicationPolicy),
    siteBanner: normalizeSiteBanner(input.siteBanner),
    systemConfig: normalizeSystemConfig(input.systemConfig),
    users: input.users ?? [],
    applications: input.applications ?? [],
    studentVerifications: input.studentVerifications ?? [],
    educationEmailChallenges: input.educationEmailChallenges ?? [],
    couponTemplates: input.couponTemplates ?? [],
    couponCodes: input.couponCodes ?? [],
    couponRedemptions: input.couponRedemptions ?? [],
    coupons: input.coupons ?? [],
    dailyCheckIns: input.dailyCheckIns ?? [],
    invitationBindings: input.invitationBindings ?? [],
    crowdReviews: input.crowdReviews ?? [],
    collaborationApplications: input.collaborationApplications ?? [],
    squarePosts: input.squarePosts ?? [],
    squareBoosts: input.squareBoosts ?? [],
    squareReports: input.squareReports ?? [],
    transactions: input.transactions ?? [],
  }

  normalized.users = normalized.users.map(user => ({
    ...user,
    accountStatus: user.accountStatus === 'suspended' ? 'suspended' : 'active',
    suspendedReason: user.accountStatus === 'suspended' ? user.suspendedReason : undefined,
    suspendedAt: user.accountStatus === 'suspended' ? user.suspendedAt : undefined,
    suspendedBy: user.accountStatus === 'suspended' ? user.suspendedBy : undefined,
    profile: {
      ...user.profile,
      inviteCode: user.profile.inviteCode || createUserInviteCode(user.id),
    },
  }))

  normalized.applications = normalized.applications.map((application) => {
    const createdAt = application.createdAt || now()
    const baseCost = Number.isFinite(application.baseCost) ? application.baseCost! : BASE_REQUEST_COST[application.type]
    const llmApiModel = application.type === 'code'
      ? resolveLlmApiModel(application.llmApiModelKey ?? (application.codexBudgetUsd ? 'codex' : undefined))
      : undefined
    const llmApiBudgetUsd = application.type === 'code' && llmApiModel
      ? normalizeLlmApiBudgetUsd(application.llmApiBudgetUsd ?? application.codexBudgetUsd ?? llmApiModel.defaultBudgetUsd, llmApiModel)
      : undefined
    const llmApiCost = llmApiBudgetUsd && llmApiModel ? calculateLlmApiCostPoints(llmApiBudgetUsd, llmApiModel) : undefined
    const codexBudgetUsd = llmApiModel?.key === 'codex' ? llmApiBudgetUsd : undefined
    const cost = Number.isFinite(application.cost) ? application.cost : llmApiCost ?? calculateActivityPrice(baseCost, createdAt)
    const storageExtended = !!application.storageExtended
    const expedited = !!application.expedited
    const rejectionReviewFeeWaived = !!application.rejectionReviewFeeWaived
    const waiveRejectionReviewFeeBlockedUntil = application.waiveRejectionReviewFeeBlockedUntil
      ?? (application.status === 'rejected' && rejectionReviewFeeWaived && application.reviewedAt
        ? createRejectionFeeWaiverBlockedUntil(application.reviewedAt)
        : undefined)
    return {
      ...application,
      baseCost,
      cost,
      pricingDiscountRate: application.pricingDiscountRate ?? (cost < baseCost ? ACTIVITY_DISCOUNT_RATE : 1),
      pricingPromotionName: application.pricingPromotionName ?? (cost < baseCost ? ACTIVITY_NAME : undefined),
      pricingPromotionEndsAt: application.pricingPromotionEndsAt ?? (cost < baseCost ? ACTIVITY_END_AT : undefined),
      pricingAppliedAt: application.pricingAppliedAt ?? createdAt,
      aiReviewFeeRate: application.aiReviewFeeRate ?? REJECTION_REVIEW_FEE_RATE,
      rejectionReviewFee: application.rejectionReviewFee ?? calculateRejectionReviewFee(cost),
      rejectionReviewFeeWaived,
      rejectionFraudulent: !!application.rejectionFraudulent,
      waiveRejectionReviewFeeBlockedUntil,
      llmApiModelKey: llmApiModel?.key,
      llmApiModelName: application.llmApiModelName ?? llmApiModel?.name,
      llmApiProvider: application.llmApiProvider ?? llmApiModel?.provider,
      llmApiBudgetUsd,
      llmApiPointRate: application.llmApiPointRate ?? llmApiModel?.pointsPerUsd,
      llmApiIpLimit: application.llmApiIpLimit ?? llmApiModel?.ipLimit,
      llmApiRpmLimit: application.llmApiRpmLimit ?? llmApiModel?.rpmLimit,
      llmApiTpmLimit: application.llmApiTpmLimit ?? llmApiModel?.tpmLimit,
      llmApiCustomRpmLimit: application.llmApiCustomRpmLimit,
      llmApiCustomTpmLimit: application.llmApiCustomTpmLimit,
      llmApiRateLimitChangeCost: application.llmApiRateLimitChangeCost,
      llmApiConcurrencyLimit: application.llmApiConcurrencyLimit ?? llmApiModel?.concurrencyLimit,
      llmApiRequiresExtendedReview: application.llmApiRequiresExtendedReview ?? (llmApiBudgetUsd && llmApiModel ? llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel) : undefined),
      codexBudgetUsd,
      codexPointRate: llmApiModel?.key === 'codex' ? (application.codexPointRate ?? llmApiModel.pointsPerUsd) : undefined,
      codexIpLimit: llmApiModel?.key === 'codex' ? (application.codexIpLimit ?? llmApiModel.ipLimit) : undefined,
      codexRpmLimit: llmApiModel?.key === 'codex' ? (application.codexRpmLimit ?? llmApiModel.rpmLimit) : undefined,
      codexConcurrencyLimit: llmApiModel?.key === 'codex' ? (application.codexConcurrencyLimit ?? llmApiModel.concurrencyLimit) : undefined,
      codexRequiresExtendedReview: llmApiModel?.key === 'codex' && llmApiBudgetUsd ? (application.codexRequiresExtendedReview ?? llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel)) : undefined,
      storageExtended,
      storageExtensionCost: application.storageExtensionCost ?? (storageExtended ? STORAGE_EXTENSION_COST : 0),
      retentionExpiresAt: application.retentionExpiresAt ?? createRetentionExpiresAt(createdAt, storageExtended),
      standardProcessingHours: application.standardProcessingHours ?? (application.type === 'resource' ? 72 : application.type === 'pro' ? PRO_STANDARD_PROCESSING_HOURS : llmApiBudgetUsd && llmApiModel ? (llmApiRequiresExtendedReview(llmApiBudgetUsd, llmApiModel) ? LLM_API_EXTENDED_PROCESSING_HOURS : LLM_API_STANDARD_PROCESSING_HOURS) : undefined),
      processingDueAt: application.processingDueAt ?? (llmApiBudgetUsd && llmApiModel ? createLlmApiProcessingDueAt(createdAt, llmApiBudgetUsd, llmApiModel) : createProcessingDueAt(createdAt, application.type, expedited)),
      selectedResourceTypes: application.selectedResourceTypes ?? (application.type === 'resource' ? Array.from(new Set((application.resourceItems ?? []).map(item => item.resourceType))) : undefined),
      resourceItems: application.resourceItems?.map((item) => {
        const approvalStatus = item.approvalStatus || 'pending'
        const provisionStatus = item.provisionStatus || (['approved', 'adjusted_approved'].includes(approvalStatus) ? 'pending' : 'not_required')
        return {
          ...item,
          approverGroup: item.approverGroup || resourceTypeConfig(item.resourceType)?.approverGroup || '管理员',
          approvalStatus,
          provisionStatus,
          lifecycleStatus: item.lifecycleStatus ?? resolveResourceLifecycleStatus({ ...item, approvalStatus, provisionStatus }, createdAt),
          expiresAt: item.expiresAt ?? resourceItemExpiresAt(item),
          createdAt: item.createdAt || createdAt,
          updatedAt: item.updatedAt || item.createdAt || createdAt,
        }
      }),
      termsAcceptances: application.termsAcceptances ?? [],
      expedited,
      expediteCost: application.expediteCost ?? (application.type === 'pro' && expedited ? PRO_EXPEDITE_COST : 0),
      contextAppendCost: application.contextAppendCost ?? (application.type === 'pro' ? PRO_CONTEXT_APPEND_COST : undefined),
      contextAppendUntil: application.contextAppendUntil ?? application.retentionExpiresAt ?? createRetentionExpiresAt(createdAt, storageExtended),
      postApprovalSupplementLimit: proPostApprovalSupplementLimit(application),
      postApprovalSupplementCount: proPostApprovalSupplementCount(application),
      deliveryReviewStatus: ['pending_review', 'approved', 'rejected'].includes(application.deliveryReviewStatus ?? '')
        ? application.deliveryReviewStatus
        : undefined,
      deliveryRewardPoints: application.deliveryRewardPoints !== undefined
        ? Math.max(0, Math.trunc(Number(application.deliveryRewardPoints || 0)))
        : undefined,
    }
  })

  normalized.collaborationApplications = normalized.collaborationApplications.map((application) => {
    const status = ['pending', 'approved', 'rejected'].includes(application.status) ? application.status : 'pending'
    return {
      ...application,
      reason: sanitizeRichText(application.reason),
      status,
      reply: application.reply ? sanitizeRichText(application.reply) : undefined,
      createdAt: application.createdAt || now(),
    }
  })

  normalized.studentVerifications = normalized.studentVerifications.map(verification => ({
    ...verification,
    verificationType: normalizeVerificationType(verification.verificationType),
    realName: verification.realName?.trim() || '未填写姓名',
    educationEmail: verification.educationEmail ? normalizeEmail(verification.educationEmail) : undefined,
    educationEmailVerified: !!verification.educationEmailVerified,
    attachments: toAttachmentMeta(verification.attachments),
  }))

  normalized.educationEmailChallenges = normalized.educationEmailChallenges
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      email: normalizeEmail(item.email),
      subject: item.subject || 'Touch Great Welfare 教育邮箱认证',
      body: item.body || `认证码：${item.code}`,
      mailto: item.mailto || `mailto:${EDUCATION_EMAIL_REVIEW_INBOX}`,
    }))

  normalized.couponTemplates = normalized.couponTemplates
    .filter(item => item && typeof item === 'object')
    .map((item) => {
      const rule = normalizeCouponRule(item.rule)
      return {
        ...item,
        name: item.name?.trim() || '未命名优惠券',
        description: item.description?.trim() || undefined,
        enabled: item.enabled !== false,
        rule,
        ttlDays: Math.max(0, Math.min(3650, Math.trunc(Number(item.ttlDays ?? DAILY_CHECK_IN_COUPON_TTL_DAYS)))),
        totalGrantLimit: item.totalGrantLimit ? Math.max(1, Math.trunc(Number(item.totalGrantLimit))) : undefined,
        grantedCount: Math.max(0, Math.trunc(Number(item.grantedCount || 0))),
        createdAt: item.createdAt || now(),
        updatedAt: item.updatedAt || item.createdAt || now(),
      }
    })

  normalized.couponCodes = normalized.couponCodes
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      code: item.code?.trim().toUpperCase() || createCouponCode(),
      enabled: item.enabled !== false,
      maxRedemptions: Math.max(1, Math.trunc(Number(item.maxRedemptions || 1))),
      redeemedCount: Math.max(0, Math.trunc(Number(item.redeemedCount || 0))),
      perUserLimit: Math.max(1, Math.trunc(Number(item.perUserLimit || 1))),
      createdAt: item.createdAt || now(),
    }))

  normalized.couponRedemptions = normalized.couponRedemptions
    .filter(item => item && typeof item === 'object')

  normalized.coupons = normalized.coupons
    .filter(item => item && typeof item === 'object')
    .map((item) => {
      const scope = normalizeCouponScope(item.scope)
      const discountType = normalizeCouponDiscountType(item.discountType, scope)
      return {
        ...item,
        scope,
        discountType,
        discountRate: Math.max(0.01, Math.min(1, Number(item.discountRate || 1))),
        discountAmount: Math.max(0, Math.trunc(Number(item.discountAmount || 0))),
        resourceTypes: normalizeCouponResourceTypes(item.resourceTypes),
        minSpend: Math.max(0, Math.trunc(Number(item.minSpend || 0))),
        maxDiscount: Math.max(0, Math.trunc(Number(item.maxDiscount || 0))),
      }
    })

  normalized.dailyCheckIns = normalized.dailyCheckIns
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      couponIds: Array.isArray(item.couponIds) ? item.couponIds : [],
    }))

  normalized.invitationBindings = normalized.invitationBindings
    .filter(item => item && typeof item === 'object')

  normalized.squarePosts = normalized.squarePosts
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      type: item.type === 'review' ? 'review' : 'application_template',
      content: sanitizeRichText(item.content || ''),
      penaltyCount: Math.max(0, Math.trunc(Number(item.penaltyCount || 0))),
      updatedAt: item.updatedAt || item.createdAt || now(),
    }))

  normalized.squareBoosts = normalized.squareBoosts
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      mode: item.mode === 'post_approval_vote' ? 'post_approval_vote' : 'boost',
      pointsGranted: Math.max(0, Math.trunc(Number(item.pointsGranted || 0))),
      penaltyApplied: !!item.penaltyApplied,
    }))

  normalized.squareReports = normalized.squareReports
    .filter(item => item && typeof item === 'object')

  for (const post of normalized.squarePosts) {
    const penalizedBoosts = normalized.squareBoosts.filter(item => item.postId === post.id && item.penaltyApplied)
    post.penaltyCount = Math.max(post.penaltyCount || 0, penalizedBoosts.length)
    post.lastPenaltyAt = post.lastPenaltyAt || penalizedBoosts.map(item => item.reportedAt).filter(Boolean).sort().at(-1)
  }

  return applyWelfareRetentionPolicy(normalized).state
}

function assertCurrentUser(user?: User): asserts user is User {
  if (!user)
    throw new Error('请先通过 GitHub App 授权登录')
}

function assertUserActive(user?: User): asserts user is User {
  assertCurrentUser(user)
  if (user.accountStatus === 'suspended')
    throw new Error(user.suspendedReason ? `账号已被封禁：${user.suspendedReason}` : '账号已被封禁')
}

function assertAdmin(user?: User): asserts user is User {
  if (!user || user.role !== 'admin')
    throw new Error('需要管理员权限')
}

function assertCrowdReviewer(user?: User): asserts user is User {
  assertUserActive(user)
  if (!user || !['admin', 'reviewer'].includes(user.role))
    throw new Error('需要协作处理员权限')
}

function emptyUserReviewStats(): UserReviewStats {
  return {
    submitted: 0,
    approved: 0,
    rejected: 0,
    pending: 0,
    studentApproved: 0,
    studentRejected: 0,
  }
}

function userReviewStats(userId: string, source: Pick<WelfareState, 'applications' | 'studentVerifications'>): UserReviewStats {
  const stats = emptyUserReviewStats()

  for (const application of source.applications) {
    if (application.userId !== userId)
      continue

    stats.submitted += 1
    if (['answered', 'pending_allocation', 'delivered', 'completed', 'closed', 'approved', 'partial_approved'].includes(application.status))
      stats.approved += 1
    if (application.status === 'rejected')
      stats.rejected += 1
    if (['pending_review', 'needs_supplement', 'processing', 'submitted', 'in_review'].includes(application.status))
      stats.pending += 1
  }

  for (const verification of source.studentVerifications) {
    if (verification.userId !== userId)
      continue

    stats.submitted += 1
    if (verification.status === 'approved') {
      stats.approved += 1
      if (normalizeVerificationType(verification.verificationType) === 'student')
        stats.studentApproved += 1
    }
    if (verification.status === 'rejected' || verification.status === 'revoked') {
      stats.rejected += 1
      if (normalizeVerificationType(verification.verificationType) === 'student')
        stats.studentRejected += 1
    }
    if (verification.status === 'pending' || verification.status === 'needs_supplement')
      stats.pending += 1
  }

  return stats
}

function clampScore(value: number) {
  return Math.max(0, Math.min(USER_LEVEL_MAX_SCORE, Math.round(value)))
}

function tieredCountScore(count: number, tiers: readonly { count: number, points: number }[], tailPoints: number) {
  let remaining = Math.max(0, count)
  let score = 0

  for (const tier of tiers) {
    const used = Math.min(remaining, tier.count)
    score += used * tier.points
    remaining -= used

    if (!remaining)
      break
  }

  return score + remaining * tailPoints
}

export function buildUserLevelCard(user: User, source: Pick<WelfareState, 'applications' | 'studentVerifications'>): UserLevelCard {
  const stats = userReviewStats(user.id, source)
  const approvedApplications = source.applications.filter(item => item.userId === user.id && ['answered', 'pending_allocation', 'delivered', 'completed', 'closed'].includes(item.status))
  const openSourceApprovals = approvedApplications.filter(item => item.hasOpenSourceBadge).length
  const submittedSignal = Math.min(18, Math.floor(Math.sqrt(stats.submitted) * 4))
  const approvalSignal = tieredCountScore(approvedApplications.length, USER_LEVEL_APPROVAL_TIERS, 2)
  const openSourceSignal = Math.min(24, tieredCountScore(openSourceApprovals, USER_LEVEL_OPEN_SOURCE_TIERS, 1))
  const studentSignal = Math.min(12, stats.studentApproved * 6) + (user.profile.studentVerified ? 8 : 0)
  const accountSignal = (user.profile.githubAuthorized ? 6 : 0) + Math.min(8, Math.floor(Math.max(0, user.points) / 4000))
  const roleBoost = user.role === 'admin' ? 65 : user.role === 'reviewer' ? 20 : 0
  const score = clampScore(
    submittedSignal
    + approvalSignal
    + Math.min(5, stats.pending)
    + studentSignal
    + openSourceSignal
    + accountSignal
    + roleBoost
    - stats.rejected * 18
    - stats.studentRejected * 8,
  )
  const rule = [...USER_LEVEL_RULES]
    .reverse()
    .find(item => score >= item.minScore) ?? USER_LEVEL_RULES[0]
  const ruleIndex = USER_LEVEL_RULES.findIndex(item => item.key === rule.key)
  const next = USER_LEVEL_RULES[ruleIndex + 1]
  const reasons = [
    `提交 ${stats.submitted} 次`,
    `通过 ${stats.approved} 次`,
    `退回 ${stats.rejected} 次`,
  ]

  if (stats.pending)
    reasons.push(`待审 ${stats.pending} 次`)
  if (user.profile.studentVerified)
    reasons.push('学生认证')
  if (user.profile.githubAuthorized)
    reasons.push('GitHub 授权')
  if (user.role === 'reviewer')
    reasons.push('协作处理员')

  return {
    ...rule,
    score,
    maxScore: USER_LEVEL_MAX_SCORE,
    next,
    stats,
    reasons,
  }
}

function isImageAttachment(file: Pick<FileLike, 'type'>) {
  return file.type.startsWith('image/')
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
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

function toAttachmentMeta(files: FileLike[] = []): AttachmentMeta[] {
  return files.map(file => ({
    id: file.id ?? createId('att'),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    r2Key: file.r2Key,
    url: safeAttachmentUrl(file.url),
    dataUrl: isImageAttachment(file) && isImageDataUrl(file.dataUrl) ? file.dataUrl : undefined,
  }))
}

function totalBytes(files: FileLike[] = []) {
  return files.reduce((sum, file) => sum + file.size, 0)
}

function isFileLike(value: unknown): value is FileLike {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false

  const file = value as Partial<FileLike>
  return typeof file.name === 'string'
    && Number.isFinite(Number(file.size))
    && typeof file.type === 'string'
}

function fileLikesFromUnknown(value: unknown): FileLike[] {
  return Array.isArray(value) ? value.filter(isFileLike) : []
}

function resourceItemAttachmentFiles(items: SubmitResourceApplicationPayload['resourceItems'] = []) {
  return items.flatMap(item => fileLikesFromUnknown(item.payload.attachments))
}

export function resourceTypeConfig(resourceType: ResourceType) {
  return RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === resourceType)
}

export function resourceTypeLabel(resourceType: ResourceType) {
  return resourceTypeConfig(resourceType)?.displayName ?? resourceType
}

export function canApplyResourceType(config: ResourceTypeConfig, userLevelPriority = 0) {
  if (!config.enabled)
    return false
  if (config.availability === 'unavailable')
    return false
  if (config.availability === 'level_required')
    return userLevelPriority >= (config.minUserLevelPriority ?? 0)
  return true
}

export function resourceAvailabilityLabel(config: ResourceTypeConfig, userLevelPriority = 0) {
  if (canApplyResourceType(config, userLevelPriority))
    return ''
  return config.unavailableReason ?? (config.availability === 'level_required' ? `平台等级 Lv${config.minUserLevelPriority ?? 3} 开放` : '暂时不提供申请')
}

export function resourceApprovalStatusText(status: ResourceApprovalStatus) {
  const map: Record<ResourceApprovalStatus, string> = {
    pending: '待审批',
    approved: '已通过',
    rejected: '已驳回',
    adjusted_approved: '调整后通过',
  }
  return map[status]
}

export function provisionStatusText(status?: ResourceProvisionStatus) {
  const map: Record<ResourceProvisionStatus, string> = {
    not_required: '无需开通',
    pending: '待人工开通',
    completed: '已开通',
  }
  return map[status ?? 'not_required']
}

const RESOURCE_LIFECYCLE_TRANSITIONS: Record<ResourceLifecycleStatus, Partial<Record<ResourceLifecycleAction, ResourceLifecycleStatus>>> = {
  pending: { approve: 'approved', reject: 'rejected', close: 'closed' },
  approved: { provision: 'provisioning', activate: 'active', close: 'closed' },
  rejected: { close: 'closed' },
  provisioning: { activate: 'active', close: 'closed' },
  active: { request_renewal: 'renewal_requested', mark_expired: 'expired', return: 'returned', release: 'released', close: 'closed' },
  renewal_requested: { approve_renewal: 'active', reject_renewal: 'expired', return: 'returned', release: 'released', close: 'closed' },
  expired: { request_renewal: 'renewal_requested', queue_reclaim: 'reclaim_pending', return: 'returned', release: 'released', close: 'closed' },
  reclaim_pending: { request_renewal: 'renewal_requested', return: 'returned', release: 'released', close: 'closed' },
  returned: { close: 'closed' },
  released: { close: 'closed' },
  closed: {},
}

export function transitionResourceLifecycleStatus(status: ResourceLifecycleStatus, action: ResourceLifecycleAction) {
  const nextStatus = RESOURCE_LIFECYCLE_TRANSITIONS[status][action]
  if (!nextStatus)
    throw new Error(`资源状态 ${status} 不允许执行 ${action}`)
  return nextStatus
}

function resourceItemExpiresAt(item: Pick<ApplicationItem, 'expiresAt' | 'payload' | 'approvedPayload'>) {
  const value = item.expiresAt ?? item.approvedPayload?.expiresAt ?? item.payload?.expiresAt
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function normalizeOptionalIsoDate(value?: string) {
  const normalized = value?.trim()
  if (!normalized)
    return undefined
  if (!Number.isFinite(Date.parse(normalized)))
    throw new Error('资源到期时间不合法')
  return new Date(normalized).toISOString()
}

export function applyResourceLifecycleAction(item: ApplicationItem, payload: Pick<ResourceLifecycleActionPayload, 'action' | 'expiresAt'>, actedAt = now()) {
  const currentStatus = resolveResourceLifecycleStatus(item, actedAt)
  const nextStatus = transitionResourceLifecycleStatus(currentStatus, payload.action)
  item.lifecycleStatus = nextStatus
  if (payload.expiresAt)
    item.expiresAt = normalizeOptionalIsoDate(payload.expiresAt)
  if (payload.action === 'approve_renewal') {
    item.renewalReviewedAt = actedAt
    item.expiresAt = normalizeOptionalIsoDate(payload.expiresAt) ?? item.expiresAt
  }
  if (payload.action === 'request_renewal')
    item.renewalRequestedAt = actedAt
  if (payload.action === 'reject_renewal')
    item.renewalReviewedAt = actedAt
  if (payload.action === 'return')
    item.returnedAt = actedAt
  if (payload.action === 'release')
    item.releasedAt = actedAt
  if (payload.action === 'close')
    item.closedAt = actedAt
  if (payload.action === 'activate')
    item.activatedAt = actedAt
  item.updatedAt = actedAt
  return item
}

export function resolveResourceLifecycleStatus(item: Pick<ApplicationItem, 'approvalStatus' | 'provisionStatus' | 'lifecycleStatus' | 'expiresAt' | 'payload' | 'approvedPayload'>, referenceTime = now()): ResourceLifecycleStatus {
  if (item.lifecycleStatus && ['returned', 'released', 'closed', 'renewal_requested', 'reclaim_pending'].includes(item.lifecycleStatus))
    return item.lifecycleStatus
  if (item.approvalStatus === 'pending')
    return 'pending'
  if (item.approvalStatus === 'rejected')
    return 'rejected'
  if (item.provisionStatus === 'pending')
    return 'provisioning'
  if (['approved', 'adjusted_approved'].includes(item.approvalStatus)) {
    const expiresAt = resourceItemExpiresAt(item)
    if (expiresAt && Date.parse(expiresAt) < Date.parse(referenceTime))
      return 'expired'
    return item.provisionStatus === 'completed' ? 'active' : 'approved'
  }
  return item.lifecycleStatus ?? 'pending'
}

function resourceGovernanceQueueItem(application: WelfareApplication, item: ApplicationItem, status: ResourceLifecycleStatus, referenceTime: string): ResourceGovernanceQueueItem {
  return {
    applicationId: application.id,
    itemId: item.id,
    title: application.title,
    resourceType: item.resourceType,
    resourceSubtype: item.resourceSubtype,
    status,
    approverGroup: item.approverGroup,
    ownerId: application.ownerId,
    userId: application.userId,
    expiresAt: resourceItemExpiresAt(item),
    updatedAt: item.updatedAt || referenceTime,
  }
}

export function buildResourceGovernanceSnapshot(applications: WelfareApplication[], referenceTime = now(), renewalWindowDays = 7): ResourceGovernanceSnapshot {
  const snapshot: ResourceGovernanceSnapshot = {
    totals: {
      active: 0,
      pendingApproval: 0,
      pendingProvision: 0,
      renewalDue: 0,
      expired: 0,
      reclaimPending: 0,
      released: 0,
    },
    pendingApprovalItems: [],
    pendingProvisionItems: [],
    renewalDueItems: [],
    expiredItems: [],
    reclaimPendingItems: [],
  }
  const referenceMs = Date.parse(referenceTime)
  const renewalWindowMs = Math.max(0, renewalWindowDays) * 24 * 60 * 60 * 1000

  for (const application of applications) {
    if (application.type !== 'resource')
      continue

    for (const item of application.resourceItems ?? []) {
      const status = resolveResourceLifecycleStatus(item, referenceTime)
      const row = resourceGovernanceQueueItem(application, item, status, referenceTime)
      if (status === 'pending') {
        snapshot.totals.pendingApproval += 1
        snapshot.pendingApprovalItems.push(row)
      }
      else if (status === 'approved' || status === 'provisioning') {
        snapshot.totals.pendingProvision += 1
        snapshot.pendingProvisionItems.push(row)
      }
      else if (status === 'active') {
        snapshot.totals.active += 1
        const expiresAt = resourceItemExpiresAt(item)
        if (expiresAt && Date.parse(expiresAt) - referenceMs <= renewalWindowMs) {
          snapshot.totals.renewalDue += 1
          snapshot.renewalDueItems.push(row)
        }
      }
      else if (status === 'expired') {
        snapshot.totals.expired += 1
        snapshot.expiredItems.push(row)
      }
      else if (status === 'reclaim_pending') {
        snapshot.totals.reclaimPending += 1
        snapshot.reclaimPendingItems.push(row)
      }
      else if (status === 'released') {
        snapshot.totals.released += 1
      }
    }
  }

  return snapshot
}

export function termsForResourceTypes(resourceTypes: ResourceType[]) {
  const ids = new Set<ResourceTermId>(['general_resource_terms'])
  for (const resourceType of resourceTypes) {
    for (const termId of resourceTypeConfig(resourceType)?.termsIds ?? [])
      ids.add(termId)
  }
  return RESOURCE_TERMS.filter(term => ids.has(term.id))
}

export function aggregateResourceApplicationStatus(items: Pick<ApplicationItem, 'approvalStatus' | 'provisionStatus'>[], currentStatus?: RequestStatus) {
  if (!items.length)
    return 'draft' as RequestStatus
  if (items.some(item => item.approvalStatus === 'pending'))
    return 'in_review' as RequestStatus

  const approvedItems = items.filter(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus))
  const rejectedCount = items.filter(item => item.approvalStatus === 'rejected').length
  if (!approvedItems.length && rejectedCount === items.length)
    return 'rejected' as RequestStatus
  if (approvedItems.length && approvedItems.every(item => item.provisionStatus === 'completed'))
    return 'delivered' as RequestStatus
  if (approvedItems.length)
    return 'pending_allocation' as RequestStatus
  return currentStatus === 'partial_approved' ? 'partial_approved' as RequestStatus : 'rejected' as RequestStatus
}

function isActiveApplication(status: RequestStatus) {
  return ['reserved', 'pending_review', 'needs_supplement', 'processing', 'submitted', 'in_review', 'pending_allocation'].includes(status)
}

function isActiveStudentVerification(status: StudentStatus) {
  return status === 'pending' || status === 'needs_supplement'
}

function defaultApplicationRejectionAnswer(application: WelfareApplication, fraudulent: boolean) {
  const fee = application.rejectionReviewFee || calculateRejectionReviewFee(application.cost)
  if (application.rejectionReviewFeeWaived) {
    if (fraudulent) {
      return `申请已退回；你已选择认真填写承诺，但管理员判断材料存在造假或不实包装，本次仍扣除 ${fee} 积分（30%）AI 审核手续费。${REJECTION_FRAUD_COOLDOWN_DAYS} 天内不可再次提交同类申请，且 ${REJECTION_FEE_WAIVER_BLOCK_DAYS} 天内不能再次勾选认真填写承诺。`
    }

    return `申请已退回；你已选择认真填写承诺，本次免除 AI 审核手续费。${REJECTION_FEE_WAIVER_BLOCK_DAYS} 天内不能再次勾选认真填写承诺；仍可按规则提交同类申请。`
  }

  if (fraudulent)
    return `申请已退回，本次扣除 ${fee} 积分 AI 审核手续费。由于审核判断材料存在造假或不实包装，${REJECTION_FRAUD_COOLDOWN_DAYS} 天内不可再次提交同类申请。`

  return `申请已退回，本次扣除 ${fee} 积分 AI 审核手续费。`
}

function buildApplicationRejectionAnswer(application: WelfareApplication, reason: string, fraudulent: boolean) {
  const ruleNotice = defaultApplicationRejectionAnswer(application, fraudulent)
  if (!richTextToPlainText(reason))
    return ruleNotice

  return `${sanitizeRichText(reason)}<p>${ruleNotice}</p>`
}

function readString(payload: Record<string, unknown>, key: string) {
  return typeof payload[key] === 'string' ? payload[key].trim() : ''
}

function assertKnownResourceType(resourceType: ResourceType) {
  const config = resourceTypeConfig(resourceType)
  if (!config || !config.enabled)
    throw new Error(`资源类型不可用：${resourceType}`)
  return config
}

function resourceDurationExtensionCost(duration?: string) {
  return !duration || duration === RESOURCE_DEFAULT_DURATION ? 0 : RESOURCE_DURATION_EXTENSION_COST
}

function estimatedResourceItemCostParts(item: SubmitResourceApplicationPayload['resourceItems'][number], referenceTime = now()) {
  if (item.resourceType === 'llm_api_quota') {
    const model = resolveSelectableLlmApiModel(readString(item.payload, 'model'))
    const durationCost = llmApiDurationExtensionCost(item.duration || readString(item.payload, 'duration'), model)
    const budgetUsd = Number(item.payload.budgetLimit || model.defaultBudgetUsd)
    const budgetCost = calculateLlmApiCostPoints(budgetUsd, model)
    const rateCost = calculateLlmApiRateLimitChangeCost(Number(item.payload.rpmLimit || model.rpmLimit), model.rpmLimit, Number(item.payload.tpmLimit || model.tpmLimit), model.tpmLimit)
    return {
      base: budgetCost,
      rate: rateCost,
      duration: durationCost,
      original: budgetCost + rateCost + durationCost,
      discounted: calculateLlmApiBudgetActivityPrice(budgetCost, budgetUsd, model, referenceTime) + rateCost + durationCost,
    }
  }
  const durationCost = resourceDurationExtensionCost(item.duration || readString(item.payload, 'duration'))
  const base = item.resourceType === 'database'
    ? 1000 + (item.payload.sensitiveData ? 3000 : 0)
    : 800 * Math.max(1, Number(item.payload.quantity || 1))
  return {
    base,
    rate: 0,
    duration: durationCost,
    original: base + durationCost,
    discounted: calculateActivityPrice(base, referenceTime) + durationCost,
  }
}

export function estimatedResourceItemCost(item: SubmitResourceApplicationPayload['resourceItems'][number]) {
  return estimatedResourceItemCostParts(item).original
}

export function discountedResourceItemCost(item: SubmitResourceApplicationPayload['resourceItems'][number], referenceTime = now()) {
  return estimatedResourceItemCostParts(item, referenceTime).discounted
}

export function resourceActivityPromotionName(items: SubmitResourceApplicationPayload['resourceItems'], referenceTime = now()) {
  const names = new Set<string>()
  for (const item of items) {
    const parts = estimatedResourceItemCostParts(item, referenceTime)
    if (parts.discounted >= parts.original)
      continue

    const model = item.resourceType === 'llm_api_quota'
      ? resolveSelectableLlmApiModel(readString(item.payload, 'model'))
      : undefined
    names.add(isGptProModel(model) ? GPT_PRO_ACTIVITY_NAME : ACTIVITY_NAME)
  }
  return Array.from(names).join(' / ') || undefined
}

function validateResourceItemInput(item: SubmitResourceApplicationPayload['resourceItems'][number]) {
  const config = assertKnownResourceType(item.resourceType)
  if (!item.resourceSubtype || !config.subtypes.includes(item.resourceSubtype))
    throw new Error(`${config.displayName} 的资源子类型不合法`)

  if (item.resourceType === 'database') {
    const dbType = item.resourceSubtype
    if (!config.subtypes.includes(dbType))
      throw new Error('数据库类型不合法')
    if (!readString(item.payload, 'name'))
      throw new Error('请填写数据库实例/库名')
    if (!['dev', 'test', 'staging', 'prod'].includes(readString(item.payload, 'environment')))
      throw new Error('数据库环境不合法')
    if (!['readonly', 'readwrite', 'admin', 'temporary_ops'].includes(item.requestedPermission ?? readString(item.payload, 'permission')))
      throw new Error('数据库权限级别不合法')
    if (!readString(item.payload, 'operationScope'))
      throw new Error('请填写数据库操作范围说明')
  }

  if (item.resourceType === 'llm_api_quota') {
    const modelKey = readString(item.payload, 'model')
    if (!isSelectableLlmApiModelKey(modelKey))
      throw new Error('大模型类型不合法')
    const model = resolveSelectableLlmApiModel(modelKey)
    const budget = Number(item.payload.budgetLimit)
    if (isGptProModel(model)) {
      if (!Number.isFinite(budget) || budget < GPT_PRO_MIN_ROUNDS || budget > GPT_PRO_MAX_ROUNDS)
        throw new Error(`GPT PRO 对话轮次必须在 ${GPT_PRO_MIN_ROUNDS} 到 ${GPT_PRO_MAX_ROUNDS} 轮之间`)
    }
    else if (!Number.isFinite(budget) || budget < 10 || budget > 1000) {
      throw new Error('大模型 Token 额度必须在 $10 到 $1000 之间')
    }
    const rpm = Number(item.payload.rpmLimit)
    if (!Number.isFinite(rpm) || rpm <= 0)
      throw new Error('大模型 RPM 必须大于 0')
    const tpm = Number(item.payload.tpmLimit)
    if (!Number.isFinite(tpm) || tpm <= 0)
      throw new Error('大模型 TPM 必须大于 0')
    if (!readString(item.payload, 'usageScenario'))
      throw new Error('请填写大模型使用场景')
    item.payload.uploadsUserData = false
    item.payload.uploadUserData = false
    item.payload.containsSensitiveInfo = false
    item.payload.containsPrivacy = false
    item.payload.logRetention = 0
  }

  const itemModel = item.resourceType === 'llm_api_quota' ? resolveSelectableLlmApiModel(readString(item.payload, 'model')) : undefined
  const duration = item.duration?.trim() || readString(item.payload, 'duration') || (itemModel ? defaultLlmApiDuration(itemModel) : RESOURCE_DEFAULT_DURATION)
  item.duration = duration
  item.payload.duration = duration
  item.payload.durationExtensionCost = itemModel ? llmApiDurationExtensionCost(duration, itemModel) : resourceDurationExtensionCost(duration)
  const estimateParts = estimatedResourceItemCostParts(item)
  item.payload.estimatedCost = estimateParts.original
  item.payload.discountedEstimatedCost = estimateParts.discounted
  item.payload.discountableEstimatedCost = estimateParts.base
  item.payload.rateLimitChangeCost = estimateParts.rate

  if (['content_service', 'media_publishing', 'data_productivity', 'quality_review', 'git_repository', 'cicd', 'vpn', 'ip_allowlist', 'notification_channel', 'identity_security', 'server', 'gpu', 'k8s_namespace', 'object_storage'].includes(item.resourceType)) {
    if (!readString(item.payload, 'purpose'))
      throw new Error(`${config.displayName} 请填写访问范围或用途说明`)
  }
}

export function normalizeResourceItems(applicationId: string, items: SubmitResourceApplicationPayload['resourceItems'], createdAt: string, validate = true): ApplicationItem[] {
  return items.map((item) => {
    const config = assertKnownResourceType(item.resourceType)
    if (validate)
      validateResourceItemInput(item)
    const payload = {
      ...item.payload,
      attachments: toAttachmentMeta(fileLikesFromUnknown(item.payload.attachments)),
    }
    return {
      id: item.id ?? createId('item'),
      applicationId,
      resourceType: item.resourceType,
      resourceSubtype: item.resourceSubtype,
      payload,
      requestedQuota: item.requestedQuota?.trim() || undefined,
      requestedPermission: item.requestedPermission?.trim() || readString(item.payload, 'permission') || undefined,
      duration: item.duration?.trim() || readString(item.payload, 'duration') || undefined,
      approverGroup: config.approverGroup,
      approvalStatus: 'pending',
      provisionStatus: 'not_required',
      lifecycleStatus: 'pending',
      expiresAt: resourceItemExpiresAt({ ...item, approvedPayload: undefined }),
      createdAt,
      updatedAt: createdAt,
    }
  })
}

function buildResourceDescription(payload: SubmitResourceApplicationPayload) {
  return sanitizeRichText(payload.reason || payload.businessBackground)
}

function buildResourceTermsAcceptances(resourceTypes: ResourceType[], acceptedTermIds: ResourceTermId[], userId: string, acceptedAt: string) {
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

const state = reactive<WelfareState>(defaultState())
const isHydrated = ref(false)
const isFullStateLoaded = ref(false)

function assertResourceTypeCanApply(resourceType: ResourceType, userId: string) {
  const config = assertKnownResourceType(resourceType)
  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')
  const userLevel = buildUserLevelCard(user, state)
  if (!canApplyResourceType(config, userLevel.priority))
    throw new Error(`${config.displayName} ${resourceAvailabilityLabel(config, userLevel.priority)}`)
  return config
}
const persistenceError = ref('')
let hydratePromise: Promise<void> | undefined
let reloadPromise: Promise<void> | undefined
function applyRemoteState(storedState: Partial<WelfareState>, fullState: boolean) {
  Object.assign(state, normalizeState(storedState))
  persistenceError.value = ''
  isHydrated.value = true
  isFullStateLoaded.value = fullState
}

export function ensureWelfareStateLoaded() {
  if (isHydrated.value)
    return persistenceError.value ? Promise.reject(new Error(persistenceError.value)) : Promise.resolve()

  hydratePromise ??= loadInitialWelfareState()
    .then((storedState) => {
      applyRemoteState(storedState, false)
    })
    .catch((error) => {
      persistenceError.value = error instanceof Error ? error.message : '数据库状态加载失败'
      throw error
    })
    .finally(() => {
      if (!isHydrated.value)
        isHydrated.value = true
    })

  return hydratePromise
}

export async function reloadWelfareState(options: { initial?: boolean, legacy?: boolean } = {}) {
  reloadPromise ??= (async () => {
    const current = state.users.find(user => user.id === state.currentUserId)
    const loader = options.legacy ? loadLegacyWelfareState : loadWelfareState
    const storedState = options.initial || !current
      ? await loadInitialWelfareState()
      : await loader(current.role)
    applyRemoteState(storedState, !!current && !options.initial)
  })()
    .catch((error) => {
      persistenceError.value = error instanceof Error ? error.message : '数据库状态加载失败'
      throw error
    })
    .finally(() => {
      reloadPromise = undefined
    })

  return reloadPromise
}

if (typeof window !== 'undefined') {
  ensureWelfareStateLoaded().catch((error) => {
    console.error(error)
  })
}

function assertPersistenceReady() {
  if (!isHydrated.value)
    throw new Error('数据库状态加载中，请稍后再试')

  if (persistenceError.value)
    throw new Error(persistenceError.value)
}

export function useWelfareStore() {
  const hasAdmin = computed(() => state.users.some(user => user.role === 'admin'))
  const currentUser = computed(() => state.users.find(user => user.id === state.currentUserId))
  const currentUserLevelCard = computed(() => currentUser.value ? buildUserLevelCard(currentUser.value, state) : undefined)
  const currentUserApplications = computed(() => {
    if (!currentUser.value)
      return []

    return state.applications
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  const currentStudentVerifications = computed(() => {
    if (!currentUser.value)
      return []

    return state.studentVerifications
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  const currentUserCoupons = computed(() => {
    if (!currentUser.value)
      return []

    return state.coupons
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  const currentUserDailyCheckIns = computed(() => {
    if (!currentUser.value)
      return []

    return state.dailyCheckIns
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  })
  const currentUserInvitationBinding = computed(() => {
    if (!currentUser.value)
      return undefined

    return state.invitationBindings.find(item => item.inviteeUserId === currentUser.value?.id)
  })
  const currentUserInviteeBindings = computed(() => {
    if (!currentUser.value)
      return []

    return state.invitationBindings
      .filter(item => item.inviterUserId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })
  const isAdmin = computed(() => currentUser.value?.role === 'admin')
  const canCrowdReview = computed(() => currentUser.value?.role === 'admin' || currentUser.value?.role === 'reviewer')
  const compareReviewPriority = (left: { userId: string, createdAt: string }, right: { userId: string, createdAt: string }) => {
    const leftLevel = userLevelCard(left.userId)
    const rightLevel = userLevelCard(right.userId)
    const priorityDiff = rightLevel.priority - leftLevel.priority
    if (priorityDiff)
      return priorityDiff

    const scoreDiff = rightLevel.score - leftLevel.score
    return scoreDiff || right.createdAt.localeCompare(left.createdAt)
  }
  const pendingProApplications = computed(() => state.applications
    .filter(item => item.type === 'pro' && ['pending_review', 'needs_supplement', 'processing'].includes(item.status))
    .sort(compareReviewPriority))
  const pendingApplications = computed(() => state.applications
    .filter(item => ['pending_review', 'needs_supplement', 'processing', 'submitted', 'in_review', 'pending_allocation'].includes(item.status))
    .sort(compareReviewPriority))
  const pendingStudentVerifications = computed(() => state.studentVerifications
    .filter(item => item.status === 'pending' || item.status === 'needs_supplement')
    .sort(compareReviewPriority))
  const pendingCollaborationApplications = computed(() => state.collaborationApplications
    .filter(item => item.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const currentUserCollaborationApplication = computed(() => {
    if (!currentUser.value)
      return undefined

    return state.collaborationApplications
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  })
  const claimableDeliveryApplications = computed(() => state.applications
    .filter(item => canClaimDeliveryApplication(item, currentUser.value))
    .sort(compareReviewPriority))
  const currentUserDeliveryApplications = computed(() => {
    if (!currentUser.value)
      return []

    return state.applications
      .filter(item => item.deliveryAssigneeId === currentUser.value?.id && item.status !== 'completed')
      .sort((a, b) => (b.deliveryClaimedAt ?? b.createdAt).localeCompare(a.deliveryClaimedAt ?? a.createdAt))
  })
  const pendingDeliveryReviewApplications = computed(() => state.applications
    .filter(item => item.deliveryReviewStatus === 'pending_review')
    .sort((a, b) => (b.deliverySubmittedAt ?? b.createdAt).localeCompare(a.deliverySubmittedAt ?? a.createdAt)))
  const totalReservedApplications = computed(() => state.applications
    .filter(item => item.status === 'reserved')
    .length)
  const squarePosts = computed(() => state.squarePosts
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const currentUserSquareBoosts = computed(() => {
    if (!currentUser.value)
      return []

    return state.squareBoosts
      .filter(item => item.userId === currentUser.value?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  })

  function userName(userId: string) {
    return state.users.find(user => user.id === userId)?.profile.displayName ?? '未知用户'
  }

  function userEmail(userId: string) {
    return state.users.find(user => user.id === userId)?.profile.email ?? 'unknown@example.com'
  }

  function userLevelCard(userId: string) {
    const user = state.users.find(item => item.id === userId)
    if (!user) {
      return {
        ...USER_LEVEL_RULES[0],
        score: 0,
        maxScore: USER_LEVEL_MAX_SCORE,
        next: USER_LEVEL_RULES[1],
        stats: emptyUserReviewStats(),
        reasons: ['用户不存在'],
      }
    }

    return buildUserLevelCard(user, state)
  }

  function activeRequestCount(userId: string) {
    const applicationCount = state.applications.filter(item => item.userId === userId && isActiveApplication(item.status)).length
    const studentCount = state.studentVerifications.filter(item => item.userId === userId && isActiveStudentVerification(item.status)).length
    return applicationCount + studentCount
  }

  function recentSubmissionCooldownUntil(userId: string, createdAt: string) {
    const cooldownMs = state.applicationPolicy.submitCooldownSeconds * 1000
    if (cooldownMs <= 0)
      return undefined

    const lastSubmittedAt = state.applications
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

  function applicationPolicyStatus(type: RequestKind, options: { userId?: string, title?: string, description?: string, referenceAt?: string } = {}): ApplicationPolicyStatus {
    const referenceAt = options.referenceAt ?? now()
    const systemConfig = normalizeSystemConfig(state.systemConfig)
    const policy = state.applicationPolicy
    const kindPolicy = policy.categories[type]
    const userId = options.userId ?? currentUser.value?.id
    const descriptionLength = richTextToPlainText(options.description ?? '').trim().length
    const today = localDateKey(referenceAt)
    const sameDayApplications = state.applications
      .filter(item => item.type === type && item.status !== 'draft' && localDateKey(item.createdAt) === today)
    const perUserDailyUsed = userId ? sameDayApplications.filter(item => item.userId === userId).length : 0
    const cooldownUntil = userId ? recentSubmissionCooldownUntil(userId, referenceAt) : undefined
    const reasons: string[] = []

    if (!systemConfig.siteEnabled)
      reasons.push(systemConfig.siteClosedReason)
    if (!kindPolicy.enabled)
      reasons.push(kindPolicy.closedReason || `${type.toUpperCase()} 申请暂未开放`)
    if (!isWithinOpenWindow(kindPolicy, new Date(referenceAt)))
      reasons.push(`${type.toUpperCase()} 申请不在当前开放时间段`)
    if (cooldownUntil)
      reasons.push(`提交冷却中，${formatDate(cooldownUntil)} 后可再次提交`)
    if (kindPolicy.dailyLimit > 0 && sameDayApplications.length >= kindPolicy.dailyLimit)
      reasons.push(`${type.toUpperCase()} 今日申请名额已满`)
    if (kindPolicy.perUserDailyLimit > 0 && perUserDailyUsed >= kindPolicy.perUserDailyLimit)
      reasons.push(`你今日 ${type.toUpperCase()} 申请次数已达上限`)
    if (descriptionLength > 0 && descriptionLength < policy.minDescriptionChars)
      reasons.push(`申请内容不得少于 ${policy.minDescriptionChars} 字`)

    return {
      type,
      enabled: systemConfig.siteEnabled && kindPolicy.enabled,
      available: reasons.length === 0,
      reason: reasons[0] ?? '',
      descriptionLength,
      minDescriptionChars: policy.minDescriptionChars,
      descriptionOk: descriptionLength >= policy.minDescriptionChars,
      cooldownUntil,
      dailyLimit: kindPolicy.dailyLimit,
      dailyUsed: sameDayApplications.length,
      dailyRemaining: kindPolicy.dailyLimit > 0 ? Math.max(0, kindPolicy.dailyLimit - sameDayApplications.length) : undefined,
      perUserDailyLimit: kindPolicy.perUserDailyLimit,
      perUserDailyUsed,
      perUserDailyRemaining: kindPolicy.perUserDailyLimit > 0 ? Math.max(0, kindPolicy.perUserDailyLimit - perUserDailyUsed) : undefined,
      openWindowLabel: applicationOpenWindowLabel(kindPolicy),
      powEnabled: policy.powEnabled,
      powDifficulty: policy.powDifficulty,
      turnstileEnabled: policy.turnstileEnabled,
      turnstileSiteKey: policy.turnstileSiteKey,
    }
  }

  function assertApplicationPolicy(input: {
    userId: string
    type: RequestKind
    title: string
    description: string
    createdAt: string
    powNonce?: string
    turnstileVerified?: boolean
  }) {
    const systemConfig = normalizeSystemConfig(state.systemConfig)
    if (!systemConfig.siteEnabled)
      throw new Error(systemConfig.siteClosedReason)

    const policy = state.applicationPolicy
    const kindPolicy = policy.categories[input.type]
    if (!kindPolicy.enabled)
      throw new Error(kindPolicy.closedReason || `${input.type.toUpperCase()} 申请暂未开放`)
    if (!isWithinOpenWindow(kindPolicy, new Date(input.createdAt)))
      throw new Error(`${input.type.toUpperCase()} 申请不在当前开放时间段`)

    const plainLength = richTextToPlainText(input.description).trim().length
    if (plainLength < policy.minDescriptionChars)
      throw new Error(`申请内容不得少于 ${policy.minDescriptionChars} 字`)

    const cooldownUntil = recentSubmissionCooldownUntil(input.userId, input.createdAt)
    if (cooldownUntil)
      throw new Error(`提交过于频繁，请在 ${formatDate(cooldownUntil)} 后再提交`)

    const today = localDateKey(input.createdAt)
    const sameDayApplications = state.applications
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

  function assertCanCreateRequest(userId: string) {
    const systemConfig = normalizeSystemConfig(state.systemConfig)
    if (!systemConfig.siteEnabled)
      throw new Error(systemConfig.siteClosedReason)

    if (activeRequestCount(userId) >= MAX_ACTIVE_USER_REQUESTS)
      throw new Error(`一个用户最多只能同时创建 ${MAX_ACTIVE_USER_REQUESTS} 个待处理请求`)
  }

  function applicationCooldownUntil(userId: string, type: RequestKind) {
    const currentTime = Date.now()
    return state.applications
      .filter(item => item.userId === userId && item.type === type && !!item.rejectionFraudulent && !!item.cooldownUntil)
      .map(item => item.cooldownUntil!)
      .filter((value) => {
        const time = new Date(value).getTime()
        return Number.isFinite(time) && time > currentTime
      })
      .sort()
      .at(-1)
  }

  function rejectionFeeWaiverBlockedUntil(userId: string) {
    const currentTime = Date.now()
    return state.applications
      .filter(item => item.userId === userId && !!item.waiveRejectionReviewFeeBlockedUntil)
      .map(item => item.waiveRejectionReviewFeeBlockedUntil!)
      .filter((value) => {
        const time = new Date(value).getTime()
        return Number.isFinite(time) && time > currentTime
      })
      .sort()
      .at(-1)
  }

  function addTransaction(userId: string, delta: number, type: CreditTransactionType, reason: string, refId?: string, allowDebt = false) {
    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')

    const next = user.points + delta
    if (next < 0 && !allowDebt)
      throw new Error('积分不足')

    user.points = next
    state.transactions.unshift({
      id: createId('tx'),
      userId,
      delta,
      type,
      reason,
      refId,
      createdAt: now(),
    })
  }

  function isCouponAvailable(coupon: UserCoupon, userId: string, referenceTime = now()) {
    if (coupon.userId !== userId || coupon.usedAt)
      return false
    if (!coupon.expiresAt)
      return true
    const expiresAt = new Date(coupon.expiresAt).getTime()
    const currentTime = new Date(referenceTime).getTime()
    return Number.isFinite(expiresAt) && Number.isFinite(currentTime) && expiresAt > currentTime
  }

  function couponAppliesToResourceTypes(coupon: UserCoupon, resourceTypes: ResourceType[]) {
    if (coupon.scope !== 'resource' && coupon.scope !== 'general')
      return false
    if (!coupon.resourceTypes?.length)
      return true
    return resourceTypes.some(resourceType => coupon.resourceTypes?.includes(resourceType))
  }

  function couponAppliesToTarget(coupon: UserCoupon, target: CouponScope, cost: number, resourceTypes: ResourceType[] = []) {
    if (!isCouponAvailable(coupon, coupon.userId))
      return false
    if (coupon.minSpend && cost < coupon.minSpend)
      return false
    if (target === 'resource')
      return couponAppliesToResourceTypes(coupon, resourceTypes)
    if (target === 'recharge')
      return coupon.scope === 'recharge' || coupon.scope === 'general'
    return coupon.scope === 'general'
  }

  function availableCouponsForUser(userId: string, referenceTime = now()) {
    return state.coupons
      .filter(coupon => isCouponAvailable(coupon, userId, referenceTime))
      .sort((left, right) => left.discountRate - right.discountRate || left.createdAt.localeCompare(right.createdAt))
  }

  function availableCouponsForTarget(userId: string, target: CouponScope, cost = 0, resourceTypes: ResourceType[] = [], referenceTime = now()) {
    return state.coupons
      .filter(coupon => isCouponAvailable(coupon, userId, referenceTime))
      .filter(coupon => couponAppliesToTarget(coupon, target, cost, resourceTypes))
      .sort((left, right) => left.discountRate - right.discountRate || left.createdAt.localeCompare(right.createdAt))
  }

  function createCouponFromRule(userId: string, source: CouponSource, template: Pick<CouponTemplate, 'id' | 'name' | 'rule' | 'ttlDays'>, createdAt = now(), codeId?: string) {
    const coupon: UserCoupon = {
      id: createId('coupon'),
      userId,
      name: template.name,
      discountRate: template.rule.discountRate ?? 1,
      source,
      scope: template.rule.scope,
      discountType: template.rule.discountType,
      discountAmount: template.rule.discountAmount,
      resourceTypes: template.rule.resourceTypes,
      minSpend: template.rule.minSpend,
      maxDiscount: template.rule.maxDiscount,
      templateId: template.id,
      codeId,
      createdAt,
      expiresAt: template.ttlDays > 0 ? addDays(createdAt, template.ttlDays) : undefined,
    }
    state.coupons.unshift(coupon)
    return coupon
  }

  function createUserCoupon(userId: string, source: CouponSource, discountRate: number, createdAt = now(), name?: string, ttlDays = DAILY_CHECK_IN_COUPON_TTL_DAYS) {
    const rawDiscountRate = Number(discountRate)
    const normalizedDiscountRate = Number.isFinite(rawDiscountRate) ? Math.max(0.01, Math.min(1, rawDiscountRate)) : 1
    const couponName = name?.trim() || (normalizedDiscountRate <= 0.5 ? '连续签到 7 天五折券' : '连续签到 3 天八折券')
    const coupon: UserCoupon = {
      id: createId('coupon'),
      userId,
      name: couponName,
      discountRate: normalizedDiscountRate,
      source,
      createdAt,
      expiresAt: ttlDays > 0 ? addDays(createdAt, ttlDays) : undefined,
    }
    state.coupons.unshift(coupon)
    return coupon
  }

  function createCouponTemplate(payload: { name: string, description?: string, enabled?: boolean, rule: Partial<CouponRule>, ttlDays?: number, totalGrantLimit?: number }) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const name = payload.name.trim()
    if (!name)
      throw new Error('请填写优惠券名称')

    const rule = normalizeCouponRule(payload.rule)
    if (rule.discountType === 'rate' && (!rule.discountRate || rule.discountRate <= 0 || rule.discountRate > 1))
      throw new Error('折扣倍率需在 0.01 到 1 之间')
    if (rule.discountType !== 'rate' && !rule.discountAmount)
      throw new Error('固定抵扣金额需大于 0')

    const createdAt = now()
    const template: CouponTemplate = {
      id: createId('cpt'),
      name,
      description: payload.description?.trim() || undefined,
      enabled: payload.enabled !== false,
      rule,
      ttlDays: Math.max(0, Math.min(3650, Math.trunc(Number(payload.ttlDays ?? DAILY_CHECK_IN_COUPON_TTL_DAYS)))),
      totalGrantLimit: payload.totalGrantLimit ? Math.max(1, Math.trunc(Number(payload.totalGrantLimit))) : undefined,
      grantedCount: 0,
      createdAt,
      updatedAt: createdAt,
      createdBy: currentUser.value.id,
    }
    state.couponTemplates.unshift(template)
    return template
  }

  function updateCouponTemplate(templateId: string, payload: { name?: string, description?: string, enabled?: boolean, rule?: Partial<CouponRule>, ttlDays?: number, totalGrantLimit?: number }) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const template = state.couponTemplates.find(item => item.id === templateId)
    if (!template)
      throw new Error('优惠券模板不存在')

    if (payload.name !== undefined) {
      const name = payload.name.trim()
      if (!name)
        throw new Error('请填写优惠券名称')
      template.name = name
    }
    template.description = payload.description?.trim() || template.description
    template.enabled = payload.enabled ?? template.enabled
    if (payload.rule)
      template.rule = normalizeCouponRule({ ...template.rule, ...payload.rule })
    if (payload.ttlDays !== undefined)
      template.ttlDays = Math.max(0, Math.min(3650, Math.trunc(Number(payload.ttlDays))))
    if (payload.totalGrantLimit !== undefined)
      template.totalGrantLimit = payload.totalGrantLimit > 0 ? Math.max(1, Math.trunc(Number(payload.totalGrantLimit))) : undefined
    template.updatedAt = now()
    return template
  }

  function createCouponRedemptionCode(payload: { templateId: string, code?: string, maxRedemptions?: number, perUserLimit?: number, expiresAt?: string }) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const template = state.couponTemplates.find(item => item.id === payload.templateId)
    if (!template)
      throw new Error('优惠券模板不存在')

    const codeText = (payload.code?.trim() || createCouponCode()).toUpperCase()
    if (state.couponCodes.some(item => item.code === codeText))
      throw new Error('兑换码已存在')

    const code: CouponRedemptionCode = {
      id: createId('ccd'),
      code: codeText,
      templateId: template.id,
      enabled: true,
      maxRedemptions: Math.max(1, Math.trunc(Number(payload.maxRedemptions || 1))),
      redeemedCount: 0,
      perUserLimit: Math.max(1, Math.trunc(Number(payload.perUserLimit || 1))),
      expiresAt: payload.expiresAt || undefined,
      createdAt: now(),
      createdBy: currentUser.value.id,
    }
    state.couponCodes.unshift(code)
    return code
  }

  function redeemCouponCode(codeValue: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const codeText = codeValue.trim().toUpperCase()
    if (!codeText)
      throw new Error('请输入兑换码')

    const code = state.couponCodes.find(item => item.code === codeText)
    if (!code || !code.enabled)
      throw new Error('兑换码无效')
    if (code.expiresAt && new Date(code.expiresAt).getTime() <= Date.now())
      throw new Error('兑换码已过期')
    if (code.redeemedCount >= code.maxRedemptions)
      throw new Error('兑换码次数已用完')

    const template = state.couponTemplates.find(item => item.id === code.templateId)
    if (!template || !template.enabled)
      throw new Error('优惠券已停用')

    const userRedeemedCount = state.couponRedemptions.filter(item => item.codeId === code.id && item.userId === currentUser.value?.id).length
    if (userRedeemedCount >= code.perUserLimit)
      throw new Error('该兑换码已达到你的兑换上限')

    const coupon = createCouponFromRule(currentUser.value.id, 'redemption_code', template, now(), code.id)
    code.redeemedCount += 1
    template.grantedCount += 1
    state.couponRedemptions.unshift({
      id: createId('cdr'),
      codeId: code.id,
      templateId: template.id,
      userId: currentUser.value.id,
      couponId: coupon.id,
      redeemedAt: coupon.createdAt,
    })
    return coupon
  }

  function grantCouponFromTemplate(userIds: string[], templateId: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const template = state.couponTemplates.find(item => item.id === templateId)
    if (!template || !template.enabled)
      throw new Error('优惠券模板不存在或已停用')

    const uniqueUserIds = Array.from(new Set(userIds)).filter(userId => state.users.some(user => user.id === userId))
    if (!uniqueUserIds.length)
      throw new Error('请选择要发放的用户')
    if (template.totalGrantLimit && template.grantedCount + uniqueUserIds.length > template.totalGrantLimit)
      throw new Error('发放数量超过模板总发放上限')

    const createdAt = now()
    const coupons = uniqueUserIds.map(userId => createCouponFromRule(userId, 'bulk_grant', template, createdAt))
    template.grantedCount += coupons.length
    template.updatedAt = createdAt
    return coupons
  }

  function grantUserCoupon(userId: string, payload: { name?: string, discountRate: number, ttlDays?: number }) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')

    const discountRate = Number(payload.discountRate)
    if (!Number.isFinite(discountRate) || discountRate <= 0 || discountRate > 1)
      throw new Error('请输入 0.01 到 1 之间的优惠倍率')

    const ttlDays = payload.ttlDays === undefined
      ? DAILY_CHECK_IN_COUPON_TTL_DAYS
      : Math.trunc(Number(payload.ttlDays))
    if (!Number.isFinite(ttlDays) || ttlDays < 0 || ttlDays > 3650)
      throw new Error('有效期天数需在 0 到 3650 之间')

    return createUserCoupon(userId, 'manual', discountRate, now(), payload.name || '管理员手动发放优惠券', ttlDays)
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

  function resourceCheckoutSnapshot(userId: string, items: SubmitResourceApplicationPayload['resourceItems'], couponId: string | undefined, createdAt: string, shareToSquare = false) {
    const baseCost = items.reduce((sum, item) => sum + estimatedResourceItemCost(item), 0)
    const activityCost = items.reduce((sum, item) => sum + discountedResourceItemCost(item, createdAt), 0)
    const resourceTypes = Array.from(new Set(items.map(item => item.resourceType)))
    const coupon = couponId
      ? availableCouponsForTarget(userId, 'resource', activityCost, resourceTypes, createdAt).find(item => item.id === couponId)
      : undefined
    if (couponId && !coupon)
      throw new Error('优惠券不可用、不适用于当前资源或已过期')

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

  function publicResourceItemPayload(payload: Record<string, any>) {
    const { attachments: _attachments, ...publicPayload } = payload
    return publicPayload
  }

  function buildResourceSquarePost(application: WelfareApplication, payload: SubmitResourceApplicationPayload, actualResourceTypes: ResourceType[], squarePostId: string, createdAt: string): SquarePost {
    return {
      id: squarePostId,
      userId: application.userId,
      type: 'application_template',
      title: application.title,
      content: sanitizeRichText(payload.squarePostContent || payload.reason),
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
          payload: publicResourceItemPayload(item.payload),
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

  function squarePostBoosts(postId: string) {
    return state.squareBoosts
      .filter(item => item.postId === postId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function squarePostValidBoosts(postId: string) {
    return squarePostBoosts(postId).filter(item => (item.mode ?? 'boost') === 'boost' && !item.reportedAt)
  }

  function squarePostDiscountRate(postId: string) {
    return calculateSquareBoostDiscountRate(squarePostValidBoosts(postId).length)
  }

  function squarePostApplication(postId: string) {
    const post = state.squarePosts.find(item => item.id === postId)
    return post?.applicationId
      ? state.applications.find(item => item.id === post.applicationId)
      : undefined
  }

  function isSquarePostAfterApproval(postId: string) {
    const application = squarePostApplication(postId)
    return !!application && ['answered', 'pending_allocation', 'delivered', 'completed', 'closed', 'approved', 'partial_approved'].includes(application.status)
  }

  function squareBoostCooldownUntil(userId: string, referenceTime = now()) {
    const reference = new Date(referenceTime).getTime()
    return state.squareBoosts
      .filter(item => item.userId === userId && item.cooldownUntil)
      .map(item => item.cooldownUntil!)
      .filter((value) => {
        const time = new Date(value).getTime()
        return Number.isFinite(time) && Number.isFinite(reference) && time > reference
      })
      .sort()
      .at(-1)
  }

  function createSquarePost(payload: CreateSquarePostPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const title = payload.title.trim()
    const content = sanitizeRichText(payload.content)
    if (!title)
      throw new Error('请填写广场标题')
    if (isRichTextEmpty(content))
      throw new Error('请填写广场内容')

    const application = payload.applicationId
      ? state.applications.find(item => item.id === payload.applicationId && item.userId === currentUser.value?.id)
      : undefined
    if (payload.applicationId && !application)
      throw new Error('只能分享自己的申请记录')

    const createdAt = now()
    const post: SquarePost = {
      id: createId('square'),
      userId: currentUser.value.id,
      type: payload.type,
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
              payload: publicResourceItemPayload(item.payload),
              requestedQuota: item.requestedQuota,
              requestedPermission: item.requestedPermission,
              duration: item.duration,
            })),
          }
        : undefined,
      createdAt,
      updatedAt: createdAt,
    }
    state.squarePosts.unshift(post)
    return post
  }

  function boostSquarePost(postId: string, declaration: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const post = state.squarePosts.find(item => item.id === postId)
    if (!post)
      throw new Error('广场内容不存在')
    if (post.userId === currentUser.value.id)
      throw new Error('不能为自己的广场内容拼一刀')
    if (state.squareBoosts.some(item => item.postId === postId && item.userId === currentUser.value?.id))
      throw new Error('你已经为该内容助力过')
    const afterApproval = isSquarePostAfterApproval(postId)
    if (!afterApproval) {
      const cooldownUntil = squareBoostCooldownUntil(currentUser.value.id)
      if (cooldownUntil)
        throw new Error(`举报处罚冷却中，请在 ${formatDate(cooldownUntil)} 后再参与拼一刀`)
    }

    const createdAt = now()
    if (!afterApproval) {
      const dailyBoostCount = state.squareBoosts.filter(item =>
        item.userId === currentUser.value?.id
        && (item.mode ?? 'boost') === 'boost'
        && localDateKey(item.createdAt) === localDateKey(createdAt),
      ).length
      if (dailyBoostCount >= SQUARE_DAILY_BOOST_LIMIT)
        throw new Error(`今日助力机会已用完，每人每天最多 ${SQUARE_DAILY_BOOST_LIMIT} 次`)
    }

    const normalizedDeclaration = sanitizeRichText(declaration)
    if (richTextToPlainText(normalizedDeclaration).trim().length < 20)
      throw new Error(afterApproval ? '投票宣言至少 20 字，请说明为什么继续支持这个领域' : '助力宣言至少 20 字，请说明为什么支持这个领域')

    const boost: SquareBoost = {
      id: createId('boost'),
      postId,
      userId: currentUser.value.id,
      mode: afterApproval ? 'post_approval_vote' : 'boost',
      declaration: normalizedDeclaration,
      pointsGranted: afterApproval ? 0 : SQUARE_BOOST_REWARD_POINTS,
      createdAt,
    }
    state.squareBoosts.unshift(boost)
    if (!afterApproval)
      addTransaction(currentUser.value.id, SQUARE_BOOST_REWARD_POINTS, 'grant', '广场拼一刀助力奖励', boost.id)
    return boost
  }

  function reportSquareBoost(boostId: string, reason: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const boost = state.squareBoosts.find(item => item.id === boostId)
    if (!boost)
      throw new Error('助力记录不存在')
    if ((boost.mode ?? 'boost') === 'post_approval_vote')
      throw new Error('结束后助力投票不产生奖惩，不支持举报扣分')
    if (boost.userId === currentUser.value.id)
      throw new Error('不能举报自己的助力宣言')
    if (state.squareReports.some(item => item.boostId === boostId && item.reporterId === currentUser.value?.id))
      throw new Error('你已经举报过该助力宣言')
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 6)
      throw new Error('请说明举报理由')

    const createdAt = now()
    const cooldownUntil = addDays(createdAt, SQUARE_BOOST_REPORT_COOLDOWN_DAYS)
    const report: SquareReport = {
      id: createId('report'),
      postId: boost.postId,
      boostId,
      reporterId: currentUser.value.id,
      reason: normalizedReason,
      createdAt,
    }
    boost.reportedAt = createdAt
    boost.reportReason = normalizedReason
    boost.reportedBy = currentUser.value.id
    boost.cooldownUntil = cooldownUntil
    if (!boost.penaltyApplied) {
      addTransaction(boost.userId, -SQUARE_BOOST_REPORT_PENALTY_POINTS, 'spend', '广场助力被举报扣除积分', boost.id, true)
      boost.penaltyApplied = true
      const post = state.squarePosts.find(item => item.id === boost.postId)
      if (post) {
        post.penaltyCount = (post.penaltyCount || 0) + 1
        post.lastPenaltyAt = createdAt
        post.updatedAt = createdAt
      }
    }
    state.squareReports.unshift(report)
    return report
  }

  function checkInToday() {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const createdAt = now()
    const dateKey = localDateKey(new Date(createdAt))
    if (state.dailyCheckIns.some(item => item.userId === currentUser.value?.id && item.dateKey === dateKey))
      throw new Error('今日已签到')

    const lastCheckIn = state.dailyCheckIns
      .filter(item => item.userId === currentUser.value?.id && item.dateKey < dateKey)
      .sort((left, right) => right.dateKey.localeCompare(left.dateKey))[0]
    const streak = lastCheckIn?.dateKey === shiftDateKey(dateKey, -1) ? lastCheckIn.streak + 1 : 1
    const points = rollDailyCheckInPoints()
    const coupons: UserCoupon[] = []
    if (streak === 3)
      coupons.push(createUserCoupon(currentUser.value.id, 'daily_streak_3', 0.8, createdAt))
    if (streak > 0 && streak % 7 === 0)
      coupons.push(createUserCoupon(currentUser.value.id, 'daily_streak_7', 0.5, createdAt))

    const checkIn: DailyCheckIn = {
      id: createId('checkin'),
      userId: currentUser.value.id,
      dateKey,
      points,
      streak,
      couponIds: coupons.map(coupon => coupon.id),
      createdAt,
    }
    addTransaction(currentUser.value.id, points, 'grant', `每日签到奖励（连续 ${streak} 天）`, checkIn.id)
    state.dailyCheckIns.unshift(checkIn)
    return checkIn
  }

  function normalizeInviteCode(value: string) {
    return value.trim().toUpperCase()
  }

  function invitationBindDeadline(user: User) {
    return addHours(user.createdAt, INVITATION_BIND_WINDOW_HOURS)
  }

  function canBindInvitation(user: User, referenceTime = now()) {
    if (state.invitationBindings.some(item => item.inviteeUserId === user.id))
      return false

    const deadline = new Date(invitationBindDeadline(user)).getTime()
    const currentTime = new Date(referenceTime).getTime()
    return Number.isFinite(deadline) && Number.isFinite(currentTime) && currentTime <= deadline
  }

  function bindInvitationCode(code: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const normalizedCode = normalizeInviteCode(code)
    if (!normalizedCode)
      throw new Error('请填写邀请码')
    if (state.invitationBindings.some(item => item.inviteeUserId === currentUser.value?.id))
      throw new Error('你已经绑定过邀请人')
    if (!canBindInvitation(currentUser.value))
      throw new Error(`注册超过 ${INVITATION_BIND_WINDOW_HOURS} 小时，无法再绑定邀请人`)

    const inviter = state.users.find(user => normalizeInviteCode(user.profile.inviteCode || createUserInviteCode(user.id)) === normalizedCode)
    if (!inviter)
      throw new Error('邀请码不存在')
    if (inviter.id === currentUser.value.id)
      throw new Error('不能绑定自己的邀请码')

    const binding: InvitationBinding = {
      id: createId('invite'),
      inviterUserId: inviter.id,
      inviteeUserId: currentUser.value.id,
      inviteCode: normalizedCode,
      createdAt: now(),
    }
    state.invitationBindings.unshift(binding)
    return binding
  }

  function vouchInvitation(bindingId: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const binding = state.invitationBindings.find(item => item.id === bindingId)
    if (!binding)
      throw new Error('邀请关系不存在')
    const createdAt = now()
    if (binding.inviterUserId === currentUser.value.id) {
      binding.inviterVouchedAt = createdAt
      return binding
    }
    if (binding.inviteeUserId === currentUser.value.id) {
      binding.inviteeVouchedAt = createdAt
      return binding
    }
    throw new Error('只能为自己的邀请关系担保')
  }

  function chargeRejectionReviewFee(application: WelfareApplication) {
    const fee = application.rejectionReviewFee || calculateRejectionReviewFee(application.cost)
    addTransaction(application.userId, -fee, 'spend', '申请退回扣除 AI 审核手续费', application.id)
  }

  async function createAdmin(payload: CreateAdminPayload) {
    assertPersistenceReady()
    await bootstrapAdmin(payload)
    await reloadWelfareState()
  }

  async function loginAsAdmin(payload: LoginAdminPayload) {
    assertPersistenceReady()
    const result = await requestAdminLogin(payload)
    applyRemoteState({ ...(result.state ?? state), currentUserId: result.userId }, false)
  }

  async function logout() {
    assertPersistenceReady()
    await endSession()
    await reloadWelfareState({ initial: true })
  }

  function updateCurrentProfile(profile: Partial<UserProfile>) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    currentUser.value.profile = {
      ...currentUser.value.profile,
      ...profile,
    }
  }

  function submitApplication(payload: SubmitApplicationPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const title = payload.title.trim()
    const description = sanitizeRichText(payload.description)
    if (!title)
      throw new Error('请填写申请标题')
    if (isRichTextEmpty(description))
      throw new Error('请填写申请说明')
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')
    const cooldownUntil = applicationCooldownUntil(currentUser.value.id, payload.type)
    if (cooldownUntil)
      throw new Error(`同类申请限制中，请在 ${formatDate(cooldownUntil)} 后再提交`)
    const waiveBlockedUntil = rejectionFeeWaiverBlockedUntil(currentUser.value.id)
    if (payload.waiveRejectionReviewFee && waiveBlockedUntil)
      throw new Error(`认真填写承诺暂不可用，请在 ${formatDate(waiveBlockedUntil)} 后再勾选`)
    assertCanCreateRequest(currentUser.value.id)

    const createdAt = now()
    assertApplicationPolicy({
      userId: currentUser.value.id,
      type: payload.type,
      title,
      description,
      createdAt,
      powNonce: payload.powNonce,
      turnstileVerified: payload.turnstileVerified,
    })
    const pricing = buildPricingSnapshot(payload.type, createdAt)
    const llmApiModel = payload.type === 'code' ? resolveSelectableLlmApiModel(payload.llmApiModelKey ?? (payload.codexBudgetUsd ? 'codex' : undefined)) : undefined
    const llmApiBudgetUsd = payload.type === 'code' && llmApiModel ? normalizeLlmApiBudgetUsd(payload.llmApiBudgetUsd ?? payload.codexBudgetUsd, llmApiModel) : undefined
    const llmApiCustomRpmLimit = llmApiModel && payload.llmApiCustomRpmLimit !== undefined ? Math.max(1, Math.trunc(Number(payload.llmApiCustomRpmLimit))) : undefined
    const llmApiCustomTpmLimit = llmApiModel && payload.llmApiCustomTpmLimit !== undefined ? Math.max(1, Math.trunc(Number(payload.llmApiCustomTpmLimit))) : undefined
    const llmApiRateLimitChangeCost = llmApiModel ? calculateLlmApiRateLimitChangeCost(llmApiCustomRpmLimit ?? llmApiModel.rpmLimit, llmApiModel.rpmLimit, llmApiCustomTpmLimit ?? llmApiModel.tpmLimit, llmApiModel.tpmLimit) : 0
    const cost = llmApiBudgetUsd && llmApiModel ? calculateLlmApiCostPoints(llmApiBudgetUsd, llmApiModel) : pricing.cost
    const codexBudgetUsd = llmApiModel?.key === 'codex' ? llmApiBudgetUsd : undefined
    const storageExtended = payload.type !== 'code' && !!payload.extendStorage
    const storageExtensionCost = storageExtended ? STORAGE_EXTENSION_COST : 0
    const expedited = payload.type === 'pro' && !!payload.expediteProcessing
    const expediteCost = expedited ? PRO_EXPEDITE_COST : 0
    const rejectionReviewFeeWaived = payload.type !== 'code' && !!payload.waiveRejectionReviewFee
    const squareResult = squareDiscountSnapshot(cost, !!payload.shareToSquare)
    const prepaidCost = squareResult.cost + storageExtensionCost + expediteCost
    if (currentUser.value.points < prepaidCost)
      throw new Error(`积分不足，本次申请需要预扣 ${prepaidCost} 积分`)

    const applicationId = createId('app')
    const squarePostId = payload.shareToSquare ? createId('square') : undefined
    const application: WelfareApplication = {
      id: applicationId,
      userId: currentUser.value.id,
      type: payload.type,
      title,
      description,
      githubRepo: payload.githubRepo,
      hasOpenSourceBadge: !!payload.githubRepo && !!currentUser.value.profile.githubUsername && !!currentUser.value.profile.githubAuthorized,
      attachments: toAttachmentMeta(payload.attachments),
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
      codexBudgetUsd,
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
      processingDueAt: llmApiBudgetUsd && llmApiModel ? createLlmApiProcessingDueAt(createdAt, llmApiBudgetUsd, llmApiModel) : createProcessingDueAt(createdAt, payload.type, expedited),
      expedited,
      expediteCost,
      contextAppendCost: payload.type === 'pro' ? PRO_CONTEXT_APPEND_COST : undefined,
      contextAppendUntil: createRetentionExpiresAt(createdAt, storageExtended),
      postApprovalSupplementLimit: payload.type === 'pro' ? 1 : undefined,
      postApprovalSupplementCount: payload.type === 'pro' ? 0 : undefined,
      createdAt,
    }

    addTransaction(currentUser.value.id, -application.cost, 'spend', `${payload.type.toUpperCase()} 申请预扣`, application.id)
    if (storageExtended)
      addTransaction(currentUser.value.id, -storageExtensionCost, 'spend', '延长申请存储服务 7 天预扣', application.id)
    if (expediteCost)
      addTransaction(currentUser.value.id, -expediteCost, 'spend', 'Pro 处理加速预扣', application.id)

    if (payload.shareToSquare && squarePostId) {
      state.squarePosts.unshift({
        id: squarePostId,
        userId: currentUser.value.id,
        type: 'application_template',
        title,
        content: sanitizeRichText(payload.squarePostContent || description),
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

    state.applications.unshift(application)
    return application
  }

  function submitResourceApplication(payload: SubmitResourceApplicationPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const title = payload.title.trim()
    const resourceTypes = Array.from(new Set(payload.selectedResourceTypes))
    const createdAt = now()
    const isDraft = !!payload.saveAsDraft

    if (!title)
      throw new Error('请填写申请标题')
    if (!isDraft && !payload.reason.trim())
      throw new Error('请填写申请说明')
    if (!isDraft) {
      assertApplicationPolicy({
        userId: currentUser.value.id,
        type: 'resource',
        title,
        description: buildResourceDescription(payload),
        createdAt,
        powNonce: payload.powNonce,
        turnstileVerified: payload.turnstileVerified,
      })
    }
    if (totalBytes([...(payload.attachments ?? []), ...resourceItemAttachmentFiles(payload.resourceItems)]) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')
    if (!resourceTypes.length)
      throw new Error('请至少选择一种资源类型')
    for (const resourceType of resourceTypes)
      assertResourceTypeCanApply(resourceType, currentUser.value.id)
    for (const item of payload.resourceItems)
      assertResourceTypeCanApply(item.resourceType, currentUser.value.id)
    if (!payload.resourceItems.length)
      throw new Error('请至少添加一条资源明细')
    assertCanCreateRequest(currentUser.value.id)

    const applicationId = createId('app')
    const resourceItems = normalizeResourceItems(applicationId, payload.resourceItems, createdAt, !isDraft)
    const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
    const checkout = isDraft
      ? undefined
      : resourceCheckoutSnapshot(currentUser.value.id, payload.resourceItems, payload.couponId, createdAt, !!payload.shareToSquare)
    const promotionName = checkout && checkout.activityDiscountAmount > 0 ? resourceActivityPromotionName(payload.resourceItems, createdAt) : undefined
    if (checkout && currentUser.value.points < checkout.cost)
      throw new Error(`积分不足，本单需要预扣 ${checkout.cost} 积分`)
    const termsAcceptances = isDraft
      ? []
      : buildResourceTermsAcceptances(actualResourceTypes, payload.acceptedTermIds, currentUser.value.id, createdAt)
    const rejectionReviewFeeWaived = !!payload.waiveRejectionReviewFee
    const waiveBlockedUntil = rejectionReviewFeeWaived ? rejectionFeeWaiverBlockedUntil(currentUser.value.id) : ''
    if (rejectionReviewFeeWaived && waiveBlockedUntil)
      throw new Error(`认真填写承诺暂不可用，请在 ${formatDate(waiveBlockedUntil)} 后再勾选`)

    const squarePostId = !isDraft && payload.shareToSquare ? createId('square') : undefined
    const application: WelfareApplication = {
      id: applicationId,
      userId: currentUser.value.id,
      type: 'resource',
      title,
      description: buildResourceDescription(payload),
      hasOpenSourceBadge: false,
      attachments: toAttachmentMeta(payload.attachments),
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
      ownerId: payload.ownerId?.trim() || currentUser.value.id,
      selectedResourceTypes: actualResourceTypes,
      resourceItems,
      termsAcceptances,
      submittedAt: isDraft ? undefined : createdAt,
      createdAt,
    }

    if (!isDraft) {
      if (application.cost > 0)
        addTransaction(currentUser.value.id, -application.cost, 'spend', '资源申请订单预扣', application.id)
      if (checkout?.coupon) {
        checkout.coupon.usedAt = createdAt
        checkout.coupon.usedFor = 'resource_application'
        checkout.coupon.usedRefId = application.id
        checkout.coupon.usedApplicationId = application.id
      }
      if (squarePostId) {
        state.squarePosts.unshift(buildResourceSquarePost(application, payload, actualResourceTypes, squarePostId, createdAt))
      }
    }

    state.applications.unshift(application)
    return application
  }

  function updateResourceDraft(applicationId: string, payload: SubmitResourceApplicationPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application || application.type !== 'resource')
      throw new Error('资源申请不存在')
    if (application.userId !== currentUser.value.id)
      throw new Error('只能编辑自己的草稿')
    if (application.status !== 'draft')
      throw new Error('提交后申请内容不可修改')

    const title = payload.title.trim()
    const updatedAt = now()
    const resourceTypes = Array.from(new Set(payload.selectedResourceTypes))
    const isDraft = !!payload.saveAsDraft
    if (!title)
      throw new Error('请填写申请标题')
    if (!isDraft && !payload.reason.trim())
      throw new Error('请填写申请说明')
    if (!isDraft) {
      assertCanCreateRequest(currentUser.value.id)
      assertApplicationPolicy({
        userId: currentUser.value.id,
        type: 'resource',
        title,
        description: buildResourceDescription(payload),
        createdAt: updatedAt,
        powNonce: payload.powNonce,
        turnstileVerified: payload.turnstileVerified,
      })
    }
    if (totalBytes([...(payload.attachments ?? []), ...resourceItemAttachmentFiles(payload.resourceItems)]) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')
    if (!resourceTypes.length)
      throw new Error('请至少选择一种资源类型')
    for (const resourceType of resourceTypes)
      assertResourceTypeCanApply(resourceType, currentUser.value.id)
    for (const item of payload.resourceItems)
      assertResourceTypeCanApply(item.resourceType, currentUser.value.id)
    if (!payload.resourceItems.length)
      throw new Error('请至少添加一条资源明细')

    const resourceItems = normalizeResourceItems(application.id, payload.resourceItems, updatedAt, !isDraft)
    const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
    const checkout = isDraft
      ? undefined
      : resourceCheckoutSnapshot(currentUser.value.id, payload.resourceItems, payload.couponId, updatedAt, !!payload.shareToSquare)
    const promotionName = checkout && checkout.activityDiscountAmount > 0 ? resourceActivityPromotionName(payload.resourceItems, updatedAt) : undefined
    if (checkout && currentUser.value.points < checkout.cost)
      throw new Error(`积分不足，本单需要预扣 ${checkout.cost} 积分`)
    const rejectionReviewFeeWaived = !!payload.waiveRejectionReviewFee
    const waiveBlockedUntil = rejectionReviewFeeWaived ? rejectionFeeWaiverBlockedUntil(currentUser.value.id) : ''
    if (rejectionReviewFeeWaived && waiveBlockedUntil)
      throw new Error(`认真填写承诺暂不可用，请在 ${formatDate(waiveBlockedUntil)} 后再勾选`)
    const squarePostId = !isDraft && payload.shareToSquare ? createId('square') : undefined
    application.title = title
    application.description = buildResourceDescription(payload)
    application.attachments = toAttachmentMeta(payload.attachments)
    application.departmentId = payload.departmentId?.trim() || undefined
    application.projectId = payload.projectId?.trim() || undefined
    application.reason = payload.reason.trim()
    application.businessBackground = payload.businessBackground.trim()
    application.urgency = payload.urgency
    application.expectedEffectiveAt = payload.expectedEffectiveAt
    application.costCenter = payload.costCenter?.trim() || undefined
    application.ownerId = payload.ownerId?.trim() || currentUser.value.id
    application.rejectionReviewFeeWaived = rejectionReviewFeeWaived
    application.selectedResourceTypes = actualResourceTypes
    application.resourceItems = resourceItems
    if (!isDraft) {
      application.termsAcceptances = buildResourceTermsAcceptances(actualResourceTypes, payload.acceptedTermIds, currentUser.value.id, updatedAt)
      application.status = 'in_review'
      application.submittedAt = updatedAt
      application.baseCost = checkout?.baseCost ?? 0
      application.cost = checkout?.cost ?? 0
      application.costCharged = true
      application.couponId = checkout?.coupon?.id
      application.couponName = checkout?.coupon?.name
      application.couponDiscountRate = checkout?.coupon?.discountRate
      application.couponDiscountAmount = checkout?.couponDiscountAmount
      application.sharedToSquare = !!payload.shareToSquare
      application.squarePostId = squarePostId
      application.squareDiscountRate = checkout?.squareDiscountRate
      application.squareDiscountAmount = checkout?.squareDiscountAmount
      application.pricingDiscountRate = checkout?.activityDiscountRate ?? 1
      application.pricingPromotionName = promotionName
      application.pricingPromotionEndsAt = checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_END_AT : undefined
      application.pricingAppliedAt = updatedAt
      if (application.cost > 0)
        addTransaction(currentUser.value.id, -application.cost, 'spend', '资源申请订单预扣', application.id)
      if (checkout?.coupon) {
        checkout.coupon.usedAt = updatedAt
        checkout.coupon.usedFor = 'resource_application'
        checkout.coupon.usedRefId = application.id
        checkout.coupon.usedApplicationId = application.id
      }
      if (squarePostId)
        state.squarePosts.unshift(buildResourceSquarePost(application, payload, actualResourceTypes, squarePostId, updatedAt))
    }
    return application
  }

  function reviewApplicationItem(payload: ReviewApplicationItemPayload) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === payload.applicationId)
    if (!application || application.type !== 'resource')
      throw new Error('资源申请不存在')
    if (!['submitted', 'in_review'].includes(application.status))
      throw new Error('该申请不在审批中')

    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')
    if (item.approvalStatus !== 'pending')
      throw new Error('该资源明细已经审批')
    if (payload.status === 'rejected' && !payload.rejectReason?.trim())
      throw new Error('驳回资源明细时必须填写原因')
    if (payload.status === 'adjusted_approved' && !payload.approvedPayload)
      throw new Error('调整后通过必须填写批准后的额度/权限')

    item.approvalStatus = payload.status
    item.approvedPayload = payload.approvedPayload
    item.rejectReason = payload.rejectReason?.trim()
    item.provisionStatus = ['approved', 'adjusted_approved'].includes(payload.status) ? 'pending' : 'not_required'
    item.lifecycleStatus = payload.status === 'rejected' ? 'rejected' : 'provisioning'
    item.expiresAt = resourceItemExpiresAt(item)
    item.updatedAt = now()

    application.status = aggregateResourceApplicationStatus(application.resourceItems ?? [], application.status)
    if (['pending_allocation', 'delivered', 'approved', 'partial_approved', 'rejected'].includes(application.status)) {
      application.reviewedAt = item.updatedAt
      if (['delivered', 'rejected'].includes(application.status))
        application.completedAt = item.updatedAt
    }
    application.answer = `<p>资源申请审批已更新：${resourceTypeLabel(item.resourceType)} / ${item.resourceSubtype} / ${resourceApprovalStatusText(item.approvalStatus)}。</p>`
    return item
  }

  function normalizeManualProvisionPayload(payload: CompleteProvisionPayload) {
    const resourceName = payload.resourceName?.trim()
    const resourceType = payload.resourceType?.trim()
    const accessUrl = payload.accessUrl?.trim()
    const credential = payload.credential?.trim()
    const expiresAt = payload.expiresAt?.trim()
    const note = payload.note?.trim()
    if (!resourceName)
      throw new Error('请填写资源名称')
    if (!resourceType)
      throw new Error('请选择资源类型')
    if (!accessUrl && !credential)
      throw new Error('请至少填写访问地址或凭据')
    return {
      resourceName,
      resourceType,
      accessUrl,
      credential,
      expiresAt,
      note,
    }
  }

  function manualProvisionNote(payload: CompleteProvisionPayload, provisionPayload = normalizeManualProvisionPayload(payload)) {
    const parts = [
      `资源：${provisionPayload.resourceName}`,
      `类型：${provisionPayload.resourceType}`,
      provisionPayload.accessUrl ? `访问地址：${provisionPayload.accessUrl}` : '',
      provisionPayload.credential ? `凭据：${provisionPayload.credential}` : '',
      provisionPayload.expiresAt ? `有效期：${provisionPayload.expiresAt}` : '',
      provisionPayload.note ? `备注：${provisionPayload.note}` : '',
    ].filter(Boolean)
    return parts.join('\n')
  }

  function completeResourceProvision(payload: CompleteProvisionPayload) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === payload.applicationId)
    if (!application || application.type !== 'resource')
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
    item.provisionNote = manualProvisionNote(payload, provisionPayload)
    item.provisionCompletedAt = now()
    item.activatedAt = item.lifecycleStatus === 'active' ? item.provisionCompletedAt : item.activatedAt
    item.updatedAt = item.provisionCompletedAt
    application.status = aggregateResourceApplicationStatus(application.resourceItems ?? [], application.status)
    if (application.status === 'delivered')
      application.completedAt = item.provisionCompletedAt
    return item
  }

  function updateResourceLifecycle(payload: ResourceLifecycleActionPayload) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === payload.applicationId)
    if (!application || application.type !== 'resource')
      throw new Error('资源申请不存在')
    const item = application.resourceItems?.find(resourceItem => resourceItem.id === payload.itemId)
    if (!item)
      throw new Error('资源明细不存在')

    const updatedAt = now()
    applyResourceLifecycleAction(item, payload, updatedAt)
    if (payload.note?.trim()) {
      application.messages ??= []
      application.messages.push({
        id: createId('msg'),
        applicationId: application.id,
        userId: currentUser.value.id,
        type: 'system',
        content: sanitizeRichText(payload.note),
        attachments: [],
        createdAt: updatedAt,
      })
    }
    return item
  }

  function answerApplication(applicationId: string, answer: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')
    const normalizedAnswer = sanitizeRichText(answer)
    if (isRichTextEmpty(normalizedAnswer))
      throw new Error('请填写审核答复')

    if (!application.costCharged) {
      addTransaction(application.userId, -application.cost, 'spend', `${application.type.toUpperCase()} 申请历史补扣`, application.id)
      application.costCharged = true
    }

    const reviewedAt = now()
    application.status = 'pending_allocation'
    application.answer = normalizedAnswer
    application.reviewedAt = reviewedAt
    application.processingStartedAt ??= reviewedAt

    // 审核答复作为系统消息加入沟通记录
    if (!application.messages)
      application.messages = []
    application.messages.push({
      id: createId('msg'),
      applicationId: application.id,
      userId: currentUser.value.id,
      type: 'system',
      content: normalizedAnswer,
      attachments: [],
      createdAt: reviewedAt,
    })
  }

  function rejectApplication(applicationId: string, reason: string, options: RejectApplicationOptions = {}) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')

    const reviewedAt = now()
    const fraudulent = !!options.fraudulent
    application.status = 'rejected'
    application.rejectionFraudulent = fraudulent
    if (application.costCharged) {
      addTransaction(application.userId, application.cost, 'refund', `${application.type.toUpperCase()} 申请退回返还预扣`, application.id)
      application.costCharged = false
    }
    if (application.expediteCost) {
      addTransaction(application.userId, application.expediteCost, 'refund', 'Pro 处理加速退回返还', application.id)
      application.expediteCost = 0
    }

    if (fraudulent)
      application.cooldownUntil = createFraudRejectionCooldownUntil(reviewedAt)

    if (application.rejectionReviewFeeWaived) {
      application.waiveRejectionReviewFeeBlockedUntil = createRejectionFeeWaiverBlockedUntil(reviewedAt)
      if (fraudulent)
        chargeRejectionReviewFee(application)
      application.answer = buildApplicationRejectionAnswer(application, reason, fraudulent)
    }
    else {
      chargeRejectionReviewFee(application)
      application.answer = buildApplicationRejectionAnswer(application, reason, fraudulent)
    }
    application.reviewedAt = reviewedAt

    // 退回原因作为系统消息加入沟通记录
    if (!application.messages)
      application.messages = []
    application.messages.push({
      id: createId('msg'),
      applicationId: application.id,
      userId: currentUser.value.id,
      type: 'system',
      content: application.answer ?? buildApplicationRejectionAnswer(application, reason, fraudulent),
      attachments: [],
      createdAt: reviewedAt,
    })
  }

  function completeApplication(applicationId: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['answered', 'delivered'].includes(application.status))
      throw new Error('只有已答复或已交付的申请可以标记完成')

    const completedAt = now()
    application.status = 'completed'
    application.completedAt = completedAt

    if (!application.messages)
      application.messages = []
    application.messages.push({
      id: createId('msg'),
      applicationId: application.id,
      userId: currentUser.value.id,
      type: 'system',
      content: '<p>管理员已确认所有结果，申请完成。</p>',
      attachments: [],
      createdAt: completedAt,
    })
  }

  function pushApplicationMessage(application: WelfareApplication, type: ApplicationMessageType, content: string, attachments: FileLike[] = []) {
    if (!application.messages)
      application.messages = []

    application.messages.push({
      id: createId('msg'),
      applicationId: application.id,
      userId: currentUser.value!.id,
      type,
      content,
      attachments: toAttachmentMeta(attachments),
      createdAt: now(),
    })
  }

  function requestApplicationSupplement(applicationId: string, content: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('只有审核中的申请可以请求补充材料')

    const normalizedContent = sanitizeRichText(content)
    if (isRichTextEmpty(normalizedContent))
      throw new Error('请填写补充材料要求')

    application.status = 'needs_supplement'
    application.processingStartedAt ??= now()
    pushApplicationMessage(application, 'system', normalizedContent)
  }

  function submitApplicationSupplement(applicationId: string, content: string, attachments: FileLike[] = []) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.userId !== currentUser.value.id)
      throw new Error('只能补充自己的申请材料')
    if (!['needs_supplement', 'answered', 'pending_allocation', 'delivered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持补充材料')
    if (['submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status) && application.type !== 'resource')
      throw new Error('只有资源工单支持该阶段补充材料')
    if (['answered', 'pending_allocation', 'delivered'].includes(application.status)) {
      if (application.type !== 'pro')
        throw new Error('只有 Pro 申请通过后支持免费补充材料')
      const limit = proPostApprovalSupplementLimit(application) ?? 0
      const count = proPostApprovalSupplementCount(application) ?? 0
      if (count >= limit)
        throw new Error('本次 Pro 申请的免费补充次数已用完')
      application.postApprovalSupplementCount = count + 1
    }

    const normalizedContent = sanitizeRichText(content)
    if (isRichTextEmpty(normalizedContent))
      throw new Error('请填写补充材料内容')
    if (totalBytes(attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')

    pushApplicationMessage(application, 'supplement', normalizedContent, attachments)
    if (application.status === 'needs_supplement')
      application.status = application.type === 'resource' ? 'in_review' : 'pending_review'
  }

  function addApplicationMessage(applicationId: string, type: ApplicationMessageType, content: string, attachments: FileLike[] = []) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing', 'needs_supplement', 'answered', 'pending_allocation', 'delivered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(application.status))
      throw new Error('该申请状态不支持追加消息')
    if (application.userId !== currentUser.value.id && currentUser.value.role !== 'admin')
      throw new Error('只能回复自己的申请工单')
    if (type === 'result_submission' && currentUser.value.role !== 'admin')
      throw new Error('用户不能提交管理员结果消息')
    if (type === 'supplement') {
      submitApplicationSupplement(applicationId, content, attachments)
      return
    }

    const normalizedContent = sanitizeRichText(content)
    if (isRichTextEmpty(normalizedContent))
      throw new Error('请输入消息内容')
    if (totalBytes(attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')

    pushApplicationMessage(application, type, normalizedContent, attachments)
  }

  function submitApplicationResult(applicationId: string, content: string, attachments: FileLike[] = []) {
    addApplicationMessage(applicationId, 'result_submission', content, attachments)
  }

  function appendApplicationContext(payload: AppendApplicationContextPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const source = state.applications.find(item => item.id === payload.applicationId)
    if (!source || source.userId !== currentUser.value.id || source.type !== 'pro')
      throw new Error('Pro 申请不存在')
    if (!['answered', 'pending_allocation', 'delivered', 'completed', 'closed'].includes(source.status))
      throw new Error('该 Pro 申请尚未结束，暂不支持追加上下文')

    const currentTime = Date.now()
    const appendUntil = new Date(source.contextAppendUntil || source.retentionExpiresAt).getTime()
    if (!Number.isFinite(appendUntil) || currentTime > appendUntil)
      throw new Error('该 Pro 对话已超过可追加时间，请重新提交申请')

    const description = sanitizeRichText(payload.description)
    if (isRichTextEmpty(description))
      throw new Error('请填写追加上下文')

    const createdAt = now()
    const pricing = buildPricingSnapshot('pro', createdAt)
    const cost = calculateActivityPrice(PRO_CONTEXT_APPEND_COST, createdAt)
    if (currentUser.value.points < cost)
      throw new Error(`积分不足，本次追加需要预扣 ${cost} 积分`)

    const application: WelfareApplication = {
      id: createId('app'),
      parentApplicationId: source.id,
      userId: currentUser.value.id,
      type: 'pro',
      title: `${source.title} · 追加上下文`,
      description,
      githubRepo: source.githubRepo,
      hasOpenSourceBadge: source.hasOpenSourceBadge,
      attachments: [],
      status: 'pending_review',
      baseCost: PRO_CONTEXT_APPEND_COST,
      cost,
      costCharged: true,
      pricingDiscountRate: pricing.discountRate,
      pricingPromotionName: pricing.promotionName,
      pricingPromotionEndsAt: pricing.promotionEndsAt,
      pricingAppliedAt: pricing.appliedAt,
      aiReview: {
        status: 'pending',
        summary: '追加上下文排队中，管理员处理前会展示自动审核结果。',
        risk: 'medium',
      },
      aiReviewFeeRate: REJECTION_REVIEW_FEE_RATE,
      rejectionReviewFee: calculateRejectionReviewFee(cost),
      rejectionReviewFeeWaived: false,
      rejectionFraudulent: false,
      storageExtended: source.storageExtended,
      storageExtensionCost: 0,
      retentionExpiresAt: createRetentionExpiresAt(createdAt, source.storageExtended),
      standardProcessingHours: PRO_STANDARD_PROCESSING_HOURS,
      processingDueAt: createProcessingDueAt(createdAt, 'pro', false),
      expedited: false,
      expediteCost: 0,
      contextAppendCost: PRO_CONTEXT_APPEND_COST,
      contextAppendUntil: createRetentionExpiresAt(createdAt, source.storageExtended),
      createdAt,
    }

    addTransaction(currentUser.value.id, -cost, 'spend', 'Pro 追加上下文预扣', application.id)
    state.applications.unshift(application)
    return application
  }

  function answerProApplication(applicationId: string, answer: string) {
    answerApplication(applicationId, answer)
  }

  function rejectProApplication(applicationId: string, reason: string, options: RejectApplicationOptions = {}) {
    rejectApplication(applicationId, reason, options)
  }

  function latestEducationEmailChallenge(userId: string, email: string) {
    return state.educationEmailChallenges
      .filter((item) => {
        if (item.userId !== userId || item.email !== email)
          return false
        const expiresAt = new Date(item.expiresAt).getTime()
        return Number.isFinite(expiresAt) && expiresAt > Date.now()
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  }

  function markEducationEmailVerified(verification: StudentVerification, verifiedAt: string, source: EducationEmailVerificationSource) {
    if (!verification.educationEmail)
      return

    verification.educationEmailVerified = true
    verification.educationEmailVerifiedAt = verification.educationEmailVerifiedAt || verifiedAt
    verification.educationEmailVerificationSource = verification.educationEmailVerificationSource || source

    if (verification.educationEmailChallengeId) {
      const challenge = state.educationEmailChallenges.find(item => item.id === verification.educationEmailChallengeId)
      if (challenge) {
        challenge.submittedAt = challenge.submittedAt || verifiedAt
        challenge.verifiedAt = challenge.verifiedAt || verifiedAt
      }
    }
  }

  function assertVerifiedEducationEmailChallenge(challenge: EducationEmailChallenge | undefined, wantsVerified: boolean) {
    if (!wantsVerified)
      throw new Error('教育邮箱需要先通过收件 API 验证后才能提交')
    if (!challenge?.verifiedAt)
      throw new Error('教育邮箱尚未通过收件 API 验证，请先发送证明邮件并完成验证')
  }

  function createEducationEmailChallenge(email: string, realName = '') {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    assertVerificationEnabled('student')

    const normalizedEmail = normalizeEmail(email)
    assertEducationEmail(normalizedEmail)
    const emailProfile = analyzeEducationEmail(normalizedEmail)

    const createdAt = now()
    const code = createEducationEmailCode()
    const subject = `Touch Great Welfare 教育邮箱认证 ${code}`
    const body = [
      'Touch Great Welfare 学生认证邮件证明',
      '',
      `认证码：${code}`,
      `申请人姓名：${realName.trim() || '未填写'}`,
      `平台用户：${currentUser.value.profile.displayName || currentUser.value.profile.email}`,
      `平台用户 ID：${currentUser.value.id}`,
      `教育邮箱：${normalizedEmail}`,
      `机构识别：${emailProfile.categoryLabel}`,
      `管理员建议：${educationEmailAdminRecommendationLabel(emailProfile)}`,
      `识别依据：${emailProfile.reason}`,
      '',
      '我确认该邮件由本人从该邮箱发出，仅作为学生认证辅助证明，仍需平台人工复核。',
    ].join('\n')
    const challenge: EducationEmailChallenge = {
      id: createId('edu_email'),
      userId: currentUser.value.id,
      email: normalizedEmail,
      code,
      subject,
      body,
      mailto: `mailto:${EDUCATION_EMAIL_REVIEW_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      expiresAt: addHours(createdAt, EDUCATION_EMAIL_CHALLENGE_TTL_HOURS),
      createdAt,
    }
    state.educationEmailChallenges = state.educationEmailChallenges
      .filter((item) => {
        const expiresAt = new Date(item.expiresAt).getTime()
        return item.verifiedAt || (Number.isFinite(expiresAt) && expiresAt > Date.now())
      })
    state.educationEmailChallenges.unshift(challenge)
    return challenge
  }

  function submitStudentVerification(payload: SubmitStudentPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const verificationType = normalizeVerificationType(payload.verificationType)
    assertVerificationEnabled(verificationType)

    const realName = payload.realName.trim()
    if (!realName)
      throw new Error('请填写真实姓名')
    if (!payload.category.trim())
      throw new Error('请填写认证类目')
    const notes = sanitizeRichText(payload.notes)
    if (isRichTextEmpty(notes))
      throw new Error('请填写认证材料说明')
    const educationEmail = payload.educationEmail?.trim() ? normalizeEmail(payload.educationEmail) : undefined
    if (educationEmail)
      assertEducationEmail(educationEmail)
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')
    assertCanCreateRequest(currentUser.value.id)

    const emailChallenge = educationEmail
      ? state.educationEmailChallenges.find(item =>
        item.id === payload.educationEmailChallengeId
        && item.userId === currentUser.value?.id
        && item.email === educationEmail,
      ) ?? latestEducationEmailChallenge(currentUser.value.id, educationEmail)
      : undefined
    if (educationEmail)
      assertVerifiedEducationEmailChallenge(emailChallenge, !!payload.educationEmailVerified)
    const createdAt = now()

    const verification: StudentVerification = {
      id: createId('stu'),
      userId: currentUser.value.id,
      verificationType,
      realName,
      category: payload.category.trim(),
      school: payload.school?.trim(),
      identity: payload.identity?.trim(),
      grade: payload.grade?.trim(),
      educationLevel: payload.educationLevel?.trim(),
      educationEmail,
      educationEmailVerified: !!emailChallenge?.verifiedAt,
      educationEmailVerifiedAt: emailChallenge?.verifiedAt,
      educationEmailVerificationSource: emailChallenge?.verifiedAt ? 'mail_auto' : undefined,
      educationEmailChallengeId: emailChallenge?.id,
      notes,
      attachments: toAttachmentMeta(payload.attachments),
      status: 'pending',
      reviewFee: STUDENT_REVIEW_FEE,
      feeReturned: false,
      createdAt,
    }
    if (emailChallenge) {
      emailChallenge.submittedAt = verification.createdAt
    }

    addTransaction(currentUser.value.id, -STUDENT_REVIEW_FEE, 'spend', `${verificationTypeLabel(verificationType)}审核费`, verification.id)
    state.studentVerifications.unshift(verification)
  }

  function confirmEducationEmailChallengeSent(challengeId: string) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const challenge = state.educationEmailChallenges.find(item => item.id === challengeId && item.userId === currentUser.value?.id)
    if (!challenge)
      throw new Error('教育邮箱证明码不存在')

    challenge.submittedAt = challenge.submittedAt || now()

    return challenge
  }

  function appendStudentSupplementNotes(existingNotes: string, supplementNotes: string, supplementedAt: string) {
    const previousNotes = existingNotes.trim() || '<p>（此前未填写材料说明）</p>'
    return `${previousNotes}<h3>补充资料（${formatDate(supplementedAt)}）</h3>${supplementNotes}`
  }

  function supplementStudentVerification(payload: SubmitStudentPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    if (!payload.verificationId)
      throw new Error('认证申请不存在')

    const verification = state.studentVerifications.find(item => item.id === payload.verificationId && item.userId === currentUser.value?.id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'needs_supplement')
      throw new Error('该认证申请暂不需要补充资料')

    const verificationType = normalizeVerificationType(payload.verificationType ?? verification.verificationType)
    assertVerificationEnabled(verificationType)

    const realName = payload.realName.trim()
    if (!realName)
      throw new Error('请填写真实姓名')
    if (!payload.category.trim())
      throw new Error('请填写认证类目')

    const notes = sanitizeRichText(payload.notes)
    if (isRichTextEmpty(notes))
      throw new Error('请填写认证材料说明')

    const educationEmail = payload.educationEmail?.trim() ? normalizeEmail(payload.educationEmail) : undefined
    if (educationEmail)
      assertEducationEmail(educationEmail)

    const existingAttachments = verification.attachments ?? []
    const newAttachments = toAttachmentMeta(payload.attachments)
    if (totalBytes([...existingAttachments, ...newAttachments]) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')

    const emailChallenge = educationEmail
      ? state.educationEmailChallenges.find(item =>
        item.id === payload.educationEmailChallengeId
        && item.userId === currentUser.value?.id
        && item.email === educationEmail,
      ) ?? latestEducationEmailChallenge(currentUser.value.id, educationEmail)
      : undefined
    if (educationEmail)
      assertVerifiedEducationEmailChallenge(emailChallenge, !!payload.educationEmailVerified)

    const supplementedAt = now()
    verification.verificationType = verificationType
    verification.realName = realName
    verification.category = payload.category.trim()
    verification.school = payload.school?.trim()
    verification.identity = payload.identity?.trim()
    verification.grade = payload.grade?.trim()
    verification.educationLevel = payload.educationLevel?.trim()
    verification.educationEmail = educationEmail
    verification.educationEmailVerified = !!emailChallenge?.verifiedAt
    verification.educationEmailVerifiedAt = emailChallenge?.verifiedAt
    verification.educationEmailVerificationSource = emailChallenge?.verifiedAt ? 'mail_auto' : undefined
    verification.educationEmailChallengeId = emailChallenge?.id
    verification.notes = appendStudentSupplementNotes(verification.notes, notes, supplementedAt)
    verification.attachments = [...existingAttachments, ...newAttachments]
    verification.status = 'pending'
    verification.reply = undefined
    verification.supplementedAt = supplementedAt
    verification.reviewedAt = undefined

    if (emailChallenge) {
      emailChallenge.submittedAt = supplementedAt
    }
  }

  function approveStudentVerification(id: string, reply: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const verification = state.studentVerifications.find(item => item.id === id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'pending')
      throw new Error('该认证申请已经处理')

    verification.status = 'approved'
    verification.reply = richTextToPlainText(reply) ? sanitizeRichText(reply) : '认证通过，审核积分已返还。'
    verification.reviewedAt = now()
    verification.feeReturned = true
    markEducationEmailVerified(verification, verification.reviewedAt, 'admin_approved')
    addTransaction(verification.userId, verification.reviewFee, 'refund', `${verificationTypeLabel(verification.verificationType)}通过返还审核费`, verification.id)

    const user = state.users.find(item => item.id === verification.userId)
    if (user && normalizeVerificationType(verification.verificationType) === 'student')
      user.profile.studentVerified = true
  }

  function requestStudentSupplement(id: string, reason: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const verification = state.studentVerifications.find(item => item.id === id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'pending')
      throw new Error('该认证申请已经处理')

    verification.status = 'needs_supplement'
    verification.reply = richTextToPlainText(reason) ? sanitizeRichText(reason) : '材料不足，请补充有效证明后继续审核。'
    verification.reviewedAt = now()
    verification.supplementRequestedAt = verification.reviewedAt
  }

  function rejectStudentVerification(id: string, reason: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const verification = state.studentVerifications.find(item => item.id === id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'pending')
      throw new Error('该认证申请已经处理')

    verification.status = 'rejected'
    verification.reply = richTextToPlainText(reason) ? sanitizeRichText(reason) : '材料不足，审核费不返还。'
    verification.reviewedAt = now()
  }

  function revokeUserStudentVerification(userId: string, reason: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const plainReason = richTextToPlainText(reason).trim()
    if (!plainReason)
      throw new Error('请填写撤销学生认证原因')

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')

    const verification = [...state.studentVerifications]
      .filter(item => item.userId === userId && normalizeVerificationType(item.verificationType) === 'student' && item.status === 'approved')
      .sort((a, b) => (b.reviewedAt || b.createdAt).localeCompare(a.reviewedAt || a.createdAt))[0]

    if (!verification)
      throw new Error('没有可撤销的已通过学生认证')

    verification.status = 'revoked'
    verification.reply = `<p>管理员撤销认证。</p>${sanitizeRichText(reason)}`
    verification.reviewedAt = now()
    user.profile.studentVerified = false
  }

  function isDeliveryApplication(application: WelfareApplication) {
    return ['code', 'pro'].includes(application.type)
      && ['answered', 'pending_allocation', 'delivered'].includes(application.status)
      && !application.deliveryRewardedAt
  }

  function canClaimDeliveryApplication(application: WelfareApplication, user?: User) {
    return !!user
      && user.role === 'reviewer'
      && user.accountStatus !== 'suspended'
      && isDeliveryApplication(application)
      && !application.deliveryAssigneeId
      && application.userId !== user.id
  }

  function assertDeliveryApplicationCanSubmit(application: WelfareApplication, user: User) {
    if (!isDeliveryApplication(application))
      throw new Error('该申请不在可交付状态')
    if (application.deliveryAssigneeId !== user.id)
      throw new Error('只能处理自己认领的任务')
    if (application.deliveryReviewStatus === 'pending_review')
      throw new Error('交付结果正在等待管理员复核')
    if (application.deliveryRewardedAt)
      throw new Error('该任务已发放奖励')
  }

  function submitCollaborationApplication(payload: SubmitCollaborationApplicationPayload) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    if (currentUser.value.role === 'admin' || currentUser.value.role === 'reviewer')
      throw new Error('当前账号已经具备协作处理权限')

    const existingPending = state.collaborationApplications.find(item => item.userId === currentUser.value?.id && item.status === 'pending')
    if (existingPending)
      throw new Error('已有待审核的协作处理员申请')

    const reason = sanitizeRichText(payload.reason)
    if (richTextToPlainText(reason).length < COLLABORATION_APPLICATION_MIN_REASON_CHARS)
      throw new Error(`申请说明不得少于 ${COLLABORATION_APPLICATION_MIN_REASON_CHARS} 字`)

    const application: CollaborationApplication = {
      id: createId('coa'),
      userId: currentUser.value.id,
      reason,
      status: 'pending',
      createdAt: now(),
    }
    state.collaborationApplications.unshift(application)
    return application
  }

  function reviewCollaborationApplication(payload: ReviewCollaborationApplicationPayload) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.collaborationApplications.find(item => item.id === payload.id)
    if (!application)
      throw new Error('协作处理员申请不存在')
    if (application.status !== 'pending')
      throw new Error('该协作处理员申请已经处理')

    const reply = payload.reply ? sanitizeRichText(payload.reply) : ''
    application.status = payload.status
    application.reply = reply || (payload.status === 'approved' ? '申请已通过，已开通协作处理员权限。' : '申请未通过，请完善资料后再试。')
    application.reviewedBy = currentUser.value.id
    application.reviewedAt = now()

    if (payload.status === 'approved') {
      const user = state.users.find(item => item.id === application.userId)
      if (!user)
        throw new Error('申请用户不存在')
      if (user.role !== 'admin')
        user.role = 'reviewer'
    }
    return application
  }

  function claimDeliveryApplication(applicationId: string) {
    assertPersistenceReady()
    assertCrowdReviewer(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!canClaimDeliveryApplication(application, currentUser.value))
      throw new Error('该任务当前不可认领')

    application.deliveryAssigneeId = currentUser.value.id
    application.deliveryClaimedAt = now()
    application.deliveryReviewStatus = undefined
    return application
  }

  function cancelDeliveryClaim(applicationId: string) {
    assertPersistenceReady()
    assertCrowdReviewer(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.deliveryAssigneeId !== currentUser.value.id && currentUser.value.role !== 'admin')
      throw new Error('只能取消自己认领的任务')
    if (application.deliveryReviewStatus === 'pending_review')
      throw new Error('交付结果正在复核，不能取消认领')
    if (application.deliveryRewardedAt)
      throw new Error('该任务已发放奖励')

    application.deliveryAssigneeId = undefined
    application.deliveryClaimedAt = undefined
    application.deliverySubmittedAt = undefined
    application.deliveryReviewStatus = undefined
    return application
  }

  function submitDeliveryResult(payload: SubmitDeliveryPayload) {
    assertPersistenceReady()
    assertCrowdReviewer(currentUser.value)

    const application = state.applications.find(item => item.id === payload.applicationId)
    if (!application)
      throw new Error('申请不存在')
    assertDeliveryApplicationCanSubmit(application, currentUser.value)

    const content = sanitizeRichText(payload.content)
    if (isRichTextEmpty(content))
      throw new Error('请填写交付结果')
    if (totalBytes(payload.attachments ?? []) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')

    pushApplicationMessage(application, 'result_submission', content, payload.attachments ?? [])
    application.deliverySubmittedAt = now()
    application.deliveryReviewStatus = 'pending_review'
    return application
  }

  function reviewDeliveryResult(payload: ReviewDeliveryPayload) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const application = state.applications.find(item => item.id === payload.applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (application.deliveryReviewStatus !== 'pending_review')
      throw new Error('该任务没有待复核的交付结果')
    if (!application.deliveryAssigneeId)
      throw new Error('该任务没有协作处理员')
    if (application.deliveryRewardedAt)
      throw new Error('该任务已发放奖励')

    const reviewedAt = now()
    const note = payload.note ? sanitizeRichText(payload.note) : ''
    if (!payload.approved) {
      application.deliveryAssigneeId = undefined
      application.deliveryClaimedAt = undefined
      application.deliverySubmittedAt = undefined
      application.deliveryReviewStatus = 'rejected'
      pushApplicationMessage(application, 'system', note || '<p>管理员复核未通过，任务已重新开放认领。</p>')
      return application
    }

    const rewardPoints = Math.trunc(Number(payload.rewardPoints))
    if (!Number.isFinite(rewardPoints) || rewardPoints < COLLABORATION_DELIVERY_REWARD_MIN || rewardPoints > COLLABORATION_DELIVERY_REWARD_MAX)
      throw new Error(`奖励积分必须是 ${COLLABORATION_DELIVERY_REWARD_MIN} 到 ${COLLABORATION_DELIVERY_REWARD_MAX} 的整数`)

    application.deliveryReviewStatus = 'approved'
    application.deliveryRewardPoints = rewardPoints
    application.deliveryRewardedAt = reviewedAt
    application.deliveryRewardedBy = currentUser.value.id
    application.status = 'completed'
    application.completedAt = reviewedAt
    addTransaction(application.deliveryAssigneeId, rewardPoints, 'grant', `${application.type.toUpperCase()} 协作交付奖励`, application.id)
    pushApplicationMessage(application, 'system', note || `<p>管理员已复核通过协作交付，发放 ${rewardPoints} 积分奖励。</p>`)
    return application
  }

  function crowdReviewsFor(targetType: CrowdReviewTargetType, targetId: string) {
    return state.crowdReviews
      .filter(item => item.targetType === targetType && item.targetId === targetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function submitCrowdReview(targetType: CrowdReviewTargetType, targetId: string, decision: CrowdReviewDecision, note: string) {
    assertPersistenceReady()
    assertCrowdReviewer(currentUser.value)

    if (targetType !== 'pro_application')
      throw new Error('协作建议当前只开放 Pro 申请摘要')

    const application = state.applications.find(item => item.id === targetId && item.type === 'pro')
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing'].includes(application.status))
      throw new Error('该申请已经处理')
    if (application.userId === currentUser.value.id)
      throw new Error('不能审核自己的申请')
    if (!['approve', 'reject', 'needs_admin'].includes(decision))
      throw new Error('请选择有效的审核建议')

    const normalizedNote = sanitizeRichText(note)
    if (isRichTextEmpty(normalizedNote))
      throw new Error('请填写协作建议')

    const existing = state.crowdReviews.find(item =>
      item.targetType === targetType
      && item.targetId === targetId
      && item.reviewerId === currentUser.value?.id,
    )

    if (existing) {
      existing.decision = decision
      existing.note = normalizedNote
      existing.createdAt = now()
      return existing
    }

    const review: CrowdReview = {
      id: createId('crv'),
      targetType,
      targetId,
      reviewerId: currentUser.value.id,
      decision,
      note: normalizedNote,
      createdAt: now(),
    }
    state.crowdReviews.unshift(review)
    return review
  }

  function setUserCrowdReviewer(userId: string, enabled: boolean) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')
    if (user.role === 'admin')
      throw new Error('管理员角色不能在此切换')

    user.role = enabled ? 'reviewer' : 'user'
  }

  function setUserSuspended(userId: string, suspended: boolean, reason = '') {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')
    if (user.role === 'admin')
      throw new Error('管理员账号不能封禁')
    if (user.id === currentUser.value.id)
      throw new Error('不能封禁当前管理员账号')

    if (suspended) {
      user.accountStatus = 'suspended'
      user.suspendedReason = reason.trim() || '违反平台使用政策'
      user.suspendedAt = now()
      user.suspendedBy = currentUser.value.id
      return
    }

    user.accountStatus = 'active'
    user.suspendedReason = undefined
    user.suspendedAt = undefined
    user.suspendedBy = undefined
  }

  function setUserStudentVerified(userId: string, verified: boolean) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')

    user.profile.studentVerified = verified
  }

  function unbindUserGitHub(userId: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    const user = state.users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')
    if (!user.profile.githubAuthorized && !user.profile.githubUsername && !user.profile.githubId)
      throw new Error('该用户没有可解绑的 GitHub 认证')

    user.profile.githubAuthorized = false
    user.profile.githubAuthorizedAt = undefined
    user.profile.githubId = undefined
    user.profile.githubUsername = undefined
    user.profile.selectedRepo = ''
    user.profile.githubRepos = []
  }

  function assertVerificationEnabled(type: VerificationType) {
    const systemConfig = normalizeSystemConfig(state.systemConfig)
    if (!systemConfig.siteEnabled)
      throw new Error(systemConfig.siteClosedReason)

    const verification = systemConfig.verification[type]
    if (!verification.enabled)
      throw new Error(verification.reason || `${verificationTypeLabel(type)}暂未开放`)
  }

  function adjustUserPoints(userId: string, amount: number, reason: string) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    if (!Number.isFinite(amount) || amount === 0)
      throw new Error('请输入非零积分调整值')

    addTransaction(userId, Math.trunc(amount), 'adjustment', reason.trim() || '管理员手动调整')
  }

  function updateSiteBanner(payload: Partial<SiteBannerConfig>) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    state.siteBanner = normalizeSiteBanner({
      ...state.siteBanner,
      ...payload,
      updatedAt: now(),
      updatedBy: currentUser.value.id,
    })
  }

  function updateSystemConfig(payload: Partial<SystemConfig>) {
    assertPersistenceReady()
    assertAdmin(currentUser.value)

    state.systemConfig = normalizeSystemConfig({
      ...state.systemConfig,
      ...payload,
      verification: {
        ...state.systemConfig.verification,
        ...payload.verification,
      },
      updatedAt: now(),
      updatedBy: currentUser.value.id,
    })
  }

  return {
    state,
    isHydrated,
    isFullStateLoaded,
    persistenceError,
    hasAdmin,
    currentUser,
    currentUserLevelCard,
    currentUserApplications,
    currentStudentVerifications,
    currentUserCoupons,
    currentUserDailyCheckIns,
    currentUserInvitationBinding,
    currentUserInviteeBindings,
    squarePosts,
    currentUserSquareBoosts,
    isAdmin,
    canCrowdReview,
    pendingApplications,
    pendingProApplications,
    pendingStudentVerifications,
    pendingCollaborationApplications,
    currentUserCollaborationApplication,
    claimableDeliveryApplications,
    currentUserDeliveryApplications,
    pendingDeliveryReviewApplications,
    totalReservedApplications,
    activeRequestCount,
    applicationPolicyStatus,
    recentSubmissionCooldownUntil,
    applicationCooldownUntil,
    rejectionFeeWaiverBlockedUntil,
    userName,
    userEmail,
    userLevelCard,
    availableCouponsForUser,
    availableCouponsForTarget,
    createCouponFromRule,
    createCouponTemplate,
    updateCouponTemplate,
    createCouponRedemptionCode,
    redeemCouponCode,
    grantCouponFromTemplate,
    squarePostBoosts,
    squarePostValidBoosts,
    squarePostDiscountRate,
    isSquarePostAfterApproval,
    squareBoostCooldownUntil,
    checkInToday,
    invitationBindDeadline,
    canBindInvitation,
    bindInvitationCode,
    vouchInvitation,
    createAdmin,
    loginAsAdmin,
    logout,
    updateCurrentProfile,
    submitApplication,
    submitResourceApplication,
    updateResourceDraft,
    reviewApplicationItem,
    completeResourceProvision,
    updateResourceLifecycle,
    appendApplicationContext,
    answerApplication,
    rejectApplication,
    completeApplication,
    requestApplicationSupplement,
    submitApplicationSupplement,
    addApplicationMessage,
    submitApplicationResult,
    answerProApplication,
    rejectProApplication,
    createEducationEmailChallenge,
    confirmEducationEmailChallengeSent,
    submitStudentVerification,
    supplementStudentVerification,
    approveStudentVerification,
    requestStudentSupplement,
    rejectStudentVerification,
    submitCollaborationApplication,
    reviewCollaborationApplication,
    claimDeliveryApplication,
    cancelDeliveryClaim,
    submitDeliveryResult,
    reviewDeliveryResult,
    canClaimDeliveryApplication,
    createSquarePost,
    boostSquarePost,
    reportSquareBoost,
    crowdReviewsFor,
    submitCrowdReview,
    setUserCrowdReviewer,
    setUserSuspended,
    setUserStudentVerified,
    revokeUserStudentVerification,
    unbindUserGitHub,
    adjustUserPoints,
    grantUserCoupon,
    updateSiteBanner,
    updateSystemConfig,
    ensureWelfareStateLoaded,
    reloadWelfareState,
    assertPersistenceReady,
  }
}

export function useSessionStore() {
  const welfare = useWelfareStore()
  return {
    isHydrated: welfare.isHydrated,
    isFullStateLoaded: welfare.isFullStateLoaded,
    persistenceError: welfare.persistenceError,
    hasAdmin: welfare.hasAdmin,
    currentUser: welfare.currentUser,
    currentUserLevelCard: welfare.currentUserLevelCard,
    isAdmin: welfare.isAdmin,
    createAdmin: welfare.createAdmin,
    loginAsAdmin: welfare.loginAsAdmin,
    logout: welfare.logout,
    updateCurrentProfile: welfare.updateCurrentProfile,
    ensureWelfareStateLoaded: welfare.ensureWelfareStateLoaded,
    reloadWelfareState: welfare.reloadWelfareState,
    assertPersistenceReady: welfare.assertPersistenceReady,
  }
}

export function useApplicationStore() {
  const welfare = useWelfareStore()
  return {
    state: welfare.state,
    currentUserApplications: welfare.currentUserApplications,
    pendingApplications: welfare.pendingApplications,
    pendingProApplications: welfare.pendingProApplications,
    claimableDeliveryApplications: welfare.claimableDeliveryApplications,
    currentUserDeliveryApplications: welfare.currentUserDeliveryApplications,
    pendingDeliveryReviewApplications: welfare.pendingDeliveryReviewApplications,
    totalReservedApplications: welfare.totalReservedApplications,
    applicationPolicyStatus: welfare.applicationPolicyStatus,
    activeRequestCount: welfare.activeRequestCount,
    submitApplication: welfare.submitApplication,
    submitResourceApplication: welfare.submitResourceApplication,
    updateResourceDraft: welfare.updateResourceDraft,
    reviewApplicationItem: welfare.reviewApplicationItem,
    completeResourceProvision: welfare.completeResourceProvision,
    updateResourceLifecycle: welfare.updateResourceLifecycle,
    appendApplicationContext: welfare.appendApplicationContext,
    answerApplication: welfare.answerApplication,
    rejectApplication: welfare.rejectApplication,
    completeApplication: welfare.completeApplication,
    requestApplicationSupplement: welfare.requestApplicationSupplement,
    submitApplicationSupplement: welfare.submitApplicationSupplement,
    addApplicationMessage: welfare.addApplicationMessage,
    submitApplicationResult: welfare.submitApplicationResult,
    answerProApplication: welfare.answerProApplication,
    rejectProApplication: welfare.rejectProApplication,
  }
}

export function useWalletStore() {
  const welfare = useWelfareStore()
  return {
    currentUserCoupons: welfare.currentUserCoupons,
    currentUserDailyCheckIns: welfare.currentUserDailyCheckIns,
    currentUserInvitationBinding: welfare.currentUserInvitationBinding,
    currentUserInviteeBindings: welfare.currentUserInviteeBindings,
    availableCouponsForUser: welfare.availableCouponsForUser,
    availableCouponsForTarget: welfare.availableCouponsForTarget,
    checkInToday: welfare.checkInToday,
    bindInvitationCode: welfare.bindInvitationCode,
    vouchInvitation: welfare.vouchInvitation,
    redeemCouponCode: welfare.redeemCouponCode,
    grantUserCoupon: welfare.grantUserCoupon,
    adjustUserPoints: welfare.adjustUserPoints,
  }
}

export function useVerificationStore() {
  const welfare = useWelfareStore()
  return {
    currentStudentVerifications: welfare.currentStudentVerifications,
    pendingStudentVerifications: welfare.pendingStudentVerifications,
    createEducationEmailChallenge: welfare.createEducationEmailChallenge,
    confirmEducationEmailChallengeSent: welfare.confirmEducationEmailChallengeSent,
    submitStudentVerification: welfare.submitStudentVerification,
    supplementStudentVerification: welfare.supplementStudentVerification,
    approveStudentVerification: welfare.approveStudentVerification,
    requestStudentSupplement: welfare.requestStudentSupplement,
    rejectStudentVerification: welfare.rejectStudentVerification,
    revokeUserStudentVerification: welfare.revokeUserStudentVerification,
    setUserStudentVerified: welfare.setUserStudentVerified,
  }
}

export function useSquareStore() {
  const welfare = useWelfareStore()
  return {
    squarePosts: welfare.squarePosts,
    currentUserSquareBoosts: welfare.currentUserSquareBoosts,
    squarePostBoosts: welfare.squarePostBoosts,
    squarePostValidBoosts: welfare.squarePostValidBoosts,
    squarePostDiscountRate: welfare.squarePostDiscountRate,
    isSquarePostAfterApproval: welfare.isSquarePostAfterApproval,
    squareBoostCooldownUntil: welfare.squareBoostCooldownUntil,
    createSquarePost: welfare.createSquarePost,
    boostSquarePost: welfare.boostSquarePost,
    reportSquareBoost: welfare.reportSquareBoost,
  }
}

export function useAdminWelfareStore() {
  const welfare = useWelfareStore()
  return {
    state: welfare.state,
    isAdmin: welfare.isAdmin,
    pendingCollaborationApplications: welfare.pendingCollaborationApplications,
    currentUserCollaborationApplication: welfare.currentUserCollaborationApplication,
    canCrowdReview: welfare.canCrowdReview,
    crowdReviewsFor: welfare.crowdReviewsFor,
    submitCrowdReview: welfare.submitCrowdReview,
    submitCollaborationApplication: welfare.submitCollaborationApplication,
    reviewCollaborationApplication: welfare.reviewCollaborationApplication,
    claimDeliveryApplication: welfare.claimDeliveryApplication,
    cancelDeliveryClaim: welfare.cancelDeliveryClaim,
    submitDeliveryResult: welfare.submitDeliveryResult,
    reviewDeliveryResult: welfare.reviewDeliveryResult,
    canClaimDeliveryApplication: welfare.canClaimDeliveryApplication,
    setUserCrowdReviewer: welfare.setUserCrowdReviewer,
    setUserSuspended: welfare.setUserSuspended,
    unbindUserGitHub: welfare.unbindUserGitHub,
    updateSiteBanner: welfare.updateSiteBanner,
    updateSystemConfig: welfare.updateSystemConfig,
    createCouponTemplate: welfare.createCouponTemplate,
    updateCouponTemplate: welfare.updateCouponTemplate,
    createCouponRedemptionCode: welfare.createCouponRedemptionCode,
    grantCouponFromTemplate: welfare.grantCouponFromTemplate,
  }
}

export function formatPoints(value: number) {
  return `${value.toLocaleString('zh-CN')} 积分`
}

export function formatBytes(value: number) {
  if (value < 1024)
    return `${value} B`

  const kb = value / 1024
  if (kb < 1024)
    return `${kb.toFixed(1)} KB`

  return `${(kb / 1024).toFixed(1)} MB`
}

export function formatDate(value?: string) {
  if (!value)
    return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatRetentionExpiry(createdAt?: string) {
  if (!createdAt)
    return '-'

  const createdTime = new Date(createdAt).getTime()
  if (!Number.isFinite(createdTime))
    return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdTime + DATA_RETENTION_MS))
}
