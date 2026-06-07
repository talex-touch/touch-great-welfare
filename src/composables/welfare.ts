import { computed, reactive, ref, watch } from 'vue'
import { applyWelfareRetentionPolicy, DATA_RETENTION_DAYS, DATA_RETENTION_MS } from '~/shared/welfare-retention'
import { isRichTextEmpty, richTextToPlainText, sanitizeRichText } from '~/utils/rich-text'
import { bootstrapAdmin, endSession, loadWelfareState, loginAdmin as requestAdminLogin, saveWelfareState } from './welfare-persistence'

export type UserRole = 'admin' | 'reviewer' | 'user'
export type RequestKind = 'code' | 'image' | 'pro' | 'resource'
export type RequestStatus = 'draft' | 'reserved' | 'pending_review' | 'needs_supplement' | 'processing' | 'answered' | 'completed' | 'closed' | 'rejected' | 'submitted' | 'in_review' | 'approved' | 'partial_approved' | 'cancelled'
export type ApplicationMessageType = 'comment' | 'supplement' | 'result_submission' | 'system'
export type StudentStatus = 'pending' | 'approved' | 'rejected'
export type VerificationType = 'student' | 'frontline'
export type CreditTransactionType = 'recharge' | 'spend' | 'refund' | 'adjustment' | 'grant'
export type AiReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_human' | 'failed'
export type CrowdReviewTargetType = 'pro_application'
export type CrowdReviewDecision = 'approve' | 'reject' | 'needs_admin'
export type UserLevelKey = 'starter' | 'steady' | 'trusted' | 'priority' | 'guardian'
export type LlmApiModelRegion = 'domestic' | 'global' | 'custom'
export type SquarePostType = 'application_template' | 'review'
export type ResourceType = 'database' | 'llm_api_quota' | 'git_repository' | 'cicd' | 'vpn' | 'ip_allowlist' | 'server' | 'gpu' | 'k8s_namespace' | 'object_storage'
export type ResourceApprovalStatus = 'pending' | 'approved' | 'rejected' | 'adjusted_approved'
export type ResourceProvisionStatus = 'not_required' | 'pending' | 'completed'
export type ResourceUrgency = 'normal' | 'urgent' | 'emergency'
export type ResourceTermId = 'general_resource_terms' | 'database_security_terms' | 'llm_api_compliance_terms' | 'infrastructure_resource_terms'
export type ResourceAvailability = 'available' | 'level_required' | 'unavailable'

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
  category: 'database' | 'llm' | 'access' | 'compute'
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
  provisionNote?: string
  provisionCompletedAt?: string
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
  educationEmailChallengeId?: string
  notes: string
  attachments: AttachmentMeta[]
  status: StudentStatus
  reviewFee: number
  feeReturned: boolean
  reply?: string
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

export type CouponSource = 'daily_streak_3' | 'daily_streak_7' | 'manual'

export interface UserCoupon {
  id: string
  userId: string
  name: string
  discountRate: number
  source: CouponSource
  createdAt: string
  expiresAt?: string
  usedAt?: string
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

export interface WelfareState {
  users: User[]
  currentUserId?: string
  oauth: OauthConfig
  applicationPolicy: ApplicationPolicyConfig
  siteBanner: SiteBannerConfig
  applications: WelfareApplication[]
  studentVerifications: StudentVerification[]
  educationEmailChallenges: EducationEmailChallenge[]
  coupons: UserCoupon[]
  dailyCheckIns: DailyCheckIn[]
  invitationBindings: InvitationBinding[]
  crowdReviews: CrowdReview[]
  squarePosts: SquarePost[]
  squareBoosts: SquareBoost[]
  squareReports: SquareReport[]
  transactions: CreditTransaction[]
  createdAt: string
}

interface FileLike {
  id?: string
  name: string
  size: number
  type: string
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
}

export interface CompleteProvisionPayload {
  applicationId: string
  itemId: string
  note?: string
}

export interface AppendApplicationContextPayload {
  applicationId: string
  description: string
}

export interface SubmitStudentPayload {
  verificationType?: VerificationType
  realName: string
  category: string
  school?: string
  identity?: string
  grade?: string
  educationLevel?: string
  educationEmail?: string
  educationEmailChallengeId?: string
  notes: string
  attachments?: FileLike[]
}

export interface RejectApplicationOptions {
  fraudulent?: boolean
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

const SAVE_DEBOUNCE_MS = 250
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
export const ACTIVITY_DAYS = 7
export const ACTIVITY_START_AT = '2026-06-01T00:00:00.000Z'
export const ACTIVITY_END_AT = '2026-06-08T00:00:00.000Z'
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
export const LLM_API_DEFAULT_MODEL_KEY = 'codex'
export const LLM_API_ALLOWED_MODEL_KEYS = ['codex', 'gpt-pro', 'claude-code', 'mimo'] as const
export const LLM_API_SELECTABLE_MODEL_KEYS = ['codex', 'gpt-pro'] as const
export const LLM_API_MODEL_COST_MULTIPLIERS: Record<typeof LLM_API_ALLOWED_MODEL_KEYS[number], number> = {
  'codex': 1,
  'gpt-pro': 20,
  'claude-code': 10,
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
    description: '适合高质量复杂推理、长任务、关键代码改造和高成本模型调用。',
    enabled: true,
    pointsPerUsd: 200,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 1,
    rpmLimit: 1,
    tpmLimit: 8000,
    concurrencyLimit: 1,
  },
  {
    key: 'claude-code',
    name: 'ClaudeCode',
    provider: 'Anthropic',
    region: 'global',
    description: '适合长上下文代码分析、重构和复杂推理。',
    enabled: false,
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
  { resourceType: 'database', displayName: '数据库', category: 'database', description: 'MySQL / PostgreSQL / Redis 权限或实例访问。', icon: 'i-carbon-data-base', enabled: true, availability: 'available', subtypes: ['mysql', 'postgresql', 'redis'], termsIds: ['database_security_terms'], approverGroup: 'DBA' },
  { resourceType: 'llm_api_quota', displayName: '大模型 API 额度', category: 'llm', description: 'Codex、GPT PRO 二选一额度；ClaudeCode、Mimo 暂停开放。', icon: 'i-carbon-ai-status', enabled: true, availability: 'available', subtypes: ['codex', 'gpt-pro'], termsIds: ['llm_api_compliance_terms'], approverGroup: 'AI 平台/成本负责人' },
  { resourceType: 'git_repository', displayName: 'Git 仓库权限', category: 'access', description: '代码仓库只读、开发者、维护者权限。', icon: 'i-carbon-logo-github', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['gitlab', 'github', 'gitee'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'cicd', displayName: 'CI/CD 权限', category: 'access', description: '流水线执行、配置、部署权限。', icon: 'i-carbon-continuous-deployment', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['pipeline', 'runner', 'deployment'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'vpn', displayName: 'VPN', category: 'access', description: '内网访问 VPN 权限。', icon: 'i-carbon-vpn', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['personal', 'project'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'ip_allowlist', displayName: 'IP 白名单', category: 'access', description: '办公、服务器或第三方访问白名单。', icon: 'i-carbon-firewall', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['office_ip', 'server_ip', 'third_party_ip'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'server', displayName: '云服务器', category: 'compute', description: '云主机规格、数量、环境和成本归属。', icon: 'i-carbon-server', enabled: true, availability: 'level_required', minUserLevelPriority: 3, unavailableReason: '平台等级 Lv3 开放', subtypes: ['ecs', 'vm'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'gpu', displayName: 'GPU', category: 'compute', description: 'GPU 卡型、数量、时长和用途。', icon: 'i-carbon-machine-learning-model', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['nvidia_t4', 'nvidia_a10', 'nvidia_a100', 'other'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'k8s_namespace', displayName: 'K8s Namespace', category: 'compute', description: '命名空间、资源配额、环境和访问范围。', icon: 'i-carbon-kubernetes', enabled: true, availability: 'unavailable', unavailableReason: '暂时不提供申请', subtypes: ['dev', 'test', 'staging', 'prod'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'object_storage', displayName: '对象存储', category: 'compute', description: 'Bucket、容量、权限和生命周期。', icon: 'i-carbon-cloud-storage', enabled: true, availability: 'level_required', minUserLevelPriority: 3, unavailableReason: '平台等级 Lv3 开放', subtypes: ['bucket', 'archive', 'public_assets'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
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
export const STUDENT_REVIEW_FEE = 800
export const STORAGE_EXTENSION_DAYS = 7
export const STORAGE_EXTENSION_COST = 300
export const REJECTION_REVIEW_FEE_RATE = 0.3
export const REJECTION_REVIEW_FEE_MIN = 300
export const REJECTION_REVIEW_FEE_MAX = 800
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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/.test(value)
}

function isEducationEmail(value: string) {
  const domain = value.split('@')[1]?.toLowerCase() ?? ''
  return domain.endsWith('.edu')
    || domain.includes('.edu.')
    || domain.endsWith('.ac')
    || domain.includes('.ac.')
}

function assertEducationEmail(value: string) {
  if (!isValidEmail(value))
    throw new Error('请填写有效的教育邮箱')
  if (!isEducationEmail(value))
    throw new Error('请填写学校或教育机构邮箱')
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
  const budget = normalizeLlmApiBudgetUsd(budgetUsd, model)
  const tier = LLM_API_BUDGET_ACTIVITY_TIERS.find(item => budget >= item.minBudgetUsd)
  return tier?.discountRate ?? ACTIVITY_DISCOUNT_RATE
}

export function calculateLlmApiBudgetActivityPrice(cost: number, budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0], referenceTime = now()) {
  if (!isPromotionActive(referenceTime))
    return cost

  return applyRateDiscount(cost, llmApiBudgetActivityDiscountRate(budgetUsd, model))
}

export function calculateSquareBoostDiscountRate(boostCount: number) {
  const steps = Math.floor(Math.max(0, boostCount) / SQUARE_BOOSTS_PER_DISCOUNT_STEP)
  return Math.max(SQUARE_MIN_DISCOUNT_RATE, SQUARE_SHARE_DISCOUNT_RATE - steps * SQUARE_BOOST_DISCOUNT_STEP)
}

export function applyRateDiscount(cost: number, rate: number) {
  return Math.max(1, Math.ceil(cost * Math.max(0.01, Math.min(1, rate))))
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

function defaultOauth(): OauthConfig {
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

function defaultState(): WelfareState {
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
    applications: [],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
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
    users: input.users ?? [],
    applications: input.applications ?? [],
    studentVerifications: input.studentVerifications ?? [],
    educationEmailChallenges: input.educationEmailChallenges ?? [],
    coupons: input.coupons ?? [],
    dailyCheckIns: input.dailyCheckIns ?? [],
    invitationBindings: input.invitationBindings ?? [],
    crowdReviews: input.crowdReviews ?? [],
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
      resourceItems: application.resourceItems?.map(item => ({
        ...item,
        approverGroup: item.approverGroup || resourceTypeConfig(item.resourceType)?.approverGroup || '管理员',
        approvalStatus: item.approvalStatus || 'pending',
        provisionStatus: item.provisionStatus || (['approved', 'adjusted_approved'].includes(item.approvalStatus) ? 'pending' : 'not_required'),
        createdAt: item.createdAt || createdAt,
        updatedAt: item.updatedAt || item.createdAt || createdAt,
      })),
      termsAcceptances: application.termsAcceptances ?? [],
      expedited,
      expediteCost: application.expediteCost ?? (application.type === 'pro' && expedited ? PRO_EXPEDITE_COST : 0),
      contextAppendCost: application.contextAppendCost ?? (application.type === 'pro' ? PRO_CONTEXT_APPEND_COST : undefined),
      contextAppendUntil: application.contextAppendUntil ?? application.retentionExpiresAt ?? createRetentionExpiresAt(createdAt, storageExtended),
      postApprovalSupplementLimit: proPostApprovalSupplementLimit(application),
      postApprovalSupplementCount: proPostApprovalSupplementCount(application),
    }
  })

  normalized.studentVerifications = normalized.studentVerifications.map(verification => ({
    ...verification,
    verificationType: normalizeVerificationType(verification.verificationType),
    realName: verification.realName?.trim() || '未填写姓名',
    educationEmail: verification.educationEmail ? normalizeEmail(verification.educationEmail) : undefined,
    educationEmailVerified: !!verification.educationEmailVerified,
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

  normalized.coupons = normalized.coupons
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      ...item,
      discountRate: Math.max(0.01, Math.min(1, Number(item.discountRate || 1))),
    }))

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
    throw new Error('需要众包审核权限')
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
    if (['answered', 'completed', 'closed', 'approved', 'partial_approved'].includes(application.status))
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
    if (verification.status === 'rejected') {
      stats.rejected += 1
      if (normalizeVerificationType(verification.verificationType) === 'student')
        stats.studentRejected += 1
    }
    if (verification.status === 'pending')
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
  const approvedApplications = source.applications.filter(item => item.userId === user.id && ['answered', 'completed', 'closed'].includes(item.status))
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
    reasons.push('众包审核员')

  return {
    ...rule,
    score,
    maxScore: USER_LEVEL_MAX_SCORE,
    next,
    stats,
    reasons,
  }
}

function toAttachmentMeta(files: FileLike[] = []): AttachmentMeta[] {
  return files.map(file => ({
    id: file.id ?? createId('att'),
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  }))
}

function totalBytes(files: FileLike[] = []) {
  return files.reduce((sum, file) => sum + file.size, 0)
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

export function termsForResourceTypes(resourceTypes: ResourceType[]) {
  const ids = new Set<ResourceTermId>(['general_resource_terms'])
  for (const resourceType of resourceTypes) {
    for (const termId of resourceTypeConfig(resourceType)?.termsIds ?? [])
      ids.add(termId)
  }
  return RESOURCE_TERMS.filter(term => ids.has(term.id))
}

export function aggregateResourceApplicationStatus(items: Pick<ApplicationItem, 'approvalStatus'>[]) {
  if (!items.length)
    return 'draft' as RequestStatus
  if (items.some(item => item.approvalStatus === 'pending'))
    return 'in_review' as RequestStatus

  const approvedCount = items.filter(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus)).length
  const rejectedCount = items.filter(item => item.approvalStatus === 'rejected').length
  if (approvedCount === items.length)
    return 'approved' as RequestStatus
  if (rejectedCount === items.length)
    return 'rejected' as RequestStatus
  return 'partial_approved' as RequestStatus
}

function isActiveApplication(status: RequestStatus) {
  return ['reserved', 'pending_review', 'needs_supplement', 'processing', 'submitted', 'in_review'].includes(status)
}

function isActiveStudentVerification(status: StudentStatus) {
  return status === 'pending'
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
  const durationCost = resourceDurationExtensionCost(item.duration || readString(item.payload, 'duration'))
  if (item.resourceType === 'llm_api_quota') {
    const model = resolveSelectableLlmApiModel(readString(item.payload, 'model'))
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

function estimatedResourceItemCost(item: SubmitResourceApplicationPayload['resourceItems'][number]) {
  return estimatedResourceItemCostParts(item).original
}

function discountedResourceItemCost(item: SubmitResourceApplicationPayload['resourceItems'][number], referenceTime = now()) {
  return estimatedResourceItemCostParts(item, referenceTime).discounted
}

function validateResourceItemInput(item: SubmitResourceApplicationPayload['resourceItems'][number]) {
  const config = assertKnownResourceType(item.resourceType)
  if (!item.resourceSubtype || !config.subtypes.includes(item.resourceSubtype))
    throw new Error(`${config.displayName} 的资源子类型不合法`)

  if (item.resourceType === 'database') {
    const dbType = item.resourceSubtype
    if (!['mysql', 'postgresql', 'redis'].includes(dbType))
      throw new Error('数据库类型必须是 MySQL、PostgreSQL 或 Redis')
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
      throw new Error('大模型只能选择 Codex 或 GPT PRO')
    const budget = Number(item.payload.budgetLimit)
    if (!Number.isFinite(budget) || budget < 10 || budget > 1000)
      throw new Error('大模型 Token 额度必须在 $10 到 $1000 之间')
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

  const duration = item.duration?.trim() || readString(item.payload, 'duration') || RESOURCE_DEFAULT_DURATION
  item.duration = duration
  item.payload.duration = duration
  item.payload.durationExtensionCost = resourceDurationExtensionCost(duration)
  const estimateParts = estimatedResourceItemCostParts(item)
  item.payload.estimatedCost = estimateParts.original
  item.payload.discountedEstimatedCost = estimateParts.discounted
  item.payload.discountableEstimatedCost = estimateParts.base
  item.payload.rateLimitChangeCost = estimateParts.rate

  if (['git_repository', 'cicd', 'vpn', 'ip_allowlist', 'server', 'gpu', 'k8s_namespace', 'object_storage'].includes(item.resourceType)) {
    if (!readString(item.payload, 'purpose'))
      throw new Error(`${config.displayName} 请填写访问范围或用途说明`)
  }
}

function normalizeResourceItems(applicationId: string, items: SubmitResourceApplicationPayload['resourceItems'], createdAt: string, validate = true): ApplicationItem[] {
  return items.map((item) => {
    const config = assertKnownResourceType(item.resourceType)
    if (validate)
      validateResourceItemInput(item)
    return {
      id: item.id ?? createId('item'),
      applicationId,
      resourceType: item.resourceType,
      resourceSubtype: item.resourceSubtype,
      payload: { ...item.payload },
      requestedQuota: item.requestedQuota?.trim() || undefined,
      requestedPermission: item.requestedPermission?.trim() || readString(item.payload, 'permission') || undefined,
      duration: item.duration?.trim() || readString(item.payload, 'duration') || undefined,
      approverGroup: config.approverGroup,
      approvalStatus: 'pending',
      provisionStatus: 'not_required',
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
let saveTimer: ReturnType<typeof setTimeout> | undefined

watch(
  state,
  (value) => {
    if (!isHydrated.value)
      return

    if (saveTimer)
      clearTimeout(saveTimer)

    saveTimer = setTimeout(() => {
      saveWelfareState(value)
        .then(() => {
          persistenceError.value = ''
        })
        .catch((error) => {
          persistenceError.value = error instanceof Error ? error.message : '数据库状态保存失败'
          console.error(error)
        })
    }, SAVE_DEBOUNCE_MS)
  },
  { deep: true },
)

export function ensureWelfareStateLoaded() {
  if (isHydrated.value)
    return persistenceError.value ? Promise.reject(new Error(persistenceError.value)) : Promise.resolve()

  hydratePromise ??= loadWelfareState()
    .then((storedState) => {
      Object.assign(state, normalizeState(storedState))
      persistenceError.value = ''
    })
    .catch((error) => {
      persistenceError.value = error instanceof Error ? error.message : '数据库状态加载失败'
      throw error
    })
    .finally(() => {
      isHydrated.value = true
    })

  return hydratePromise
}

export async function reloadWelfareState() {
  const storedState = await loadWelfareState()
  Object.assign(state, normalizeState(storedState))
  persistenceError.value = ''
  isHydrated.value = true
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
    .filter(item => ['pending_review', 'needs_supplement', 'processing', 'submitted', 'in_review'].includes(item.status))
    .sort(compareReviewPriority))
  const pendingStudentVerifications = computed(() => state.studentVerifications
    .filter(item => item.status === 'pending')
    .sort(compareReviewPriority))
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
      enabled: kindPolicy.enabled,
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

  function availableCouponsForUser(userId: string, referenceTime = now()) {
    return state.coupons
      .filter(coupon => isCouponAvailable(coupon, userId, referenceTime))
      .sort((left, right) => left.discountRate - right.discountRate || left.createdAt.localeCompare(right.createdAt))
  }

  function createUserCoupon(userId: string, source: CouponSource, discountRate: number, createdAt = now()) {
    const name = discountRate <= 0.5 ? '连续签到 7 天五折券' : '连续签到 3 天八折券'
    const coupon: UserCoupon = {
      id: createId('coupon'),
      userId,
      name,
      discountRate,
      source,
      createdAt,
      expiresAt: addDays(createdAt, DAILY_CHECK_IN_COUPON_TTL_DAYS),
    }
    state.coupons.unshift(coupon)
    return coupon
  }

  function applyCouponDiscount(cost: number, coupon?: UserCoupon) {
    if (!coupon)
      return { payableCost: cost, discountAmount: 0 }

    const payableCost = applyRateDiscount(cost, coupon.discountRate)
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
    const coupon = couponId
      ? availableCouponsForUser(userId, createdAt).find(item => item.id === couponId)
      : undefined
    if (couponId && !coupon)
      throw new Error('优惠券不可用或已过期')

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
    return !!application && ['answered', 'completed', 'closed', 'approved', 'partial_approved'].includes(application.status)
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
    await requestAdminLogin(payload)
    await reloadWelfareState()
  }

  async function logout() {
    assertPersistenceReady()
    await endSession()
    await reloadWelfareState()
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
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
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
    if (checkout && currentUser.value.points < checkout.cost)
      throw new Error(`积分不足，本单需要预扣 ${checkout.cost} 积分`)
    const termsAcceptances = isDraft
      ? []
      : buildResourceTermsAcceptances(actualResourceTypes, payload.acceptedTermIds, currentUser.value.id, createdAt)

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
      pricingPromotionName: checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_NAME : undefined,
      pricingPromotionEndsAt: checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_END_AT : undefined,
      pricingAppliedAt: createdAt,
      aiReviewFeeRate: REJECTION_REVIEW_FEE_RATE,
      rejectionReviewFee: 0,
      rejectionReviewFeeWaived: true,
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

    const updatedAt = now()
    const resourceTypes = Array.from(new Set(payload.selectedResourceTypes))
    if (!resourceTypes.length)
      throw new Error('请至少选择一种资源类型')
    for (const resourceType of resourceTypes)
      assertResourceTypeCanApply(resourceType, currentUser.value.id)
    for (const item of payload.resourceItems)
      assertResourceTypeCanApply(item.resourceType, currentUser.value.id)
    if (!payload.resourceItems.length)
      throw new Error('请至少添加一条资源明细')

    const isDraft = !!payload.saveAsDraft
    const resourceItems = normalizeResourceItems(application.id, payload.resourceItems, updatedAt, !isDraft)
    const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
    const checkout = isDraft
      ? undefined
      : resourceCheckoutSnapshot(currentUser.value.id, payload.resourceItems, payload.couponId, updatedAt, !!payload.shareToSquare)
    if (checkout && currentUser.value.points < checkout.cost)
      throw new Error(`积分不足，本单需要预扣 ${checkout.cost} 积分`)
    const squarePostId = !isDraft && payload.shareToSquare ? createId('square') : undefined
    application.title = payload.title.trim()
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
      application.pricingPromotionName = checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_NAME : undefined
      application.pricingPromotionEndsAt = checkout && checkout.activityDiscountAmount > 0 ? ACTIVITY_END_AT : undefined
      application.pricingAppliedAt = updatedAt
      if (application.cost > 0)
        addTransaction(currentUser.value.id, -application.cost, 'spend', '资源申请订单预扣', application.id)
      if (checkout?.coupon) {
        checkout.coupon.usedAt = updatedAt
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
    item.updatedAt = now()

    application.status = aggregateResourceApplicationStatus(application.resourceItems ?? [])
    if (['approved', 'partial_approved', 'rejected'].includes(application.status)) {
      application.reviewedAt = item.updatedAt
      application.completedAt = item.updatedAt
    }
    application.answer = `<p>资源申请审批已更新：${resourceTypeLabel(item.resourceType)} / ${item.resourceSubtype} / ${resourceApprovalStatusText(item.approvalStatus)}。</p>`
    return item
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

    item.provisionStatus = 'completed'
    item.provisionNote = payload.note?.trim()
    item.provisionCompletedAt = now()
    item.updatedAt = item.provisionCompletedAt
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
    application.status = 'answered'
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
    if (application.status !== 'answered')
      throw new Error('只有已答复的申请可以标记完成')

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
    if (!['needs_supplement', 'answered'].includes(application.status))
      throw new Error('该申请状态不支持补充材料')
    if (application.status === 'answered') {
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
      application.status = 'pending_review'
  }

  function addApplicationMessage(applicationId: string, type: ApplicationMessageType, content: string, attachments: FileLike[] = []) {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing', 'needs_supplement', 'answered'].includes(application.status))
      throw new Error('该申请状态不支持追加消息')
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
    if (!['answered', 'completed', 'closed'].includes(source.status))
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

  function createEducationEmailChallenge(email: string, realName = '') {
    assertPersistenceReady()
    assertUserActive(currentUser.value)

    const normalizedEmail = normalizeEmail(email)
    assertEducationEmail(normalizedEmail)

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
      '',
      '我确认该邮件由本人从教育/学校邮箱发出，仅作为学生认证辅助证明，仍需平台人工复核。',
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
      educationEmailVerified: false,
      educationEmailVerifiedAt: undefined,
      educationEmailChallengeId: emailChallenge?.id,
      notes,
      attachments: toAttachmentMeta(payload.attachments),
      status: 'pending',
      reviewFee: STUDENT_REVIEW_FEE,
      feeReturned: false,
      createdAt: now(),
    }
    if (emailChallenge)
      emailChallenge.submittedAt = verification.createdAt

    addTransaction(currentUser.value.id, -STUDENT_REVIEW_FEE, 'spend', `${verificationTypeLabel(verificationType)}审核费`, verification.id)
    state.studentVerifications.unshift(verification)
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
    addTransaction(verification.userId, verification.reviewFee, 'refund', `${verificationTypeLabel(verification.verificationType)}通过返还审核费`, verification.id)

    const user = state.users.find(item => item.id === verification.userId)
    if (user && normalizeVerificationType(verification.verificationType) === 'student')
      user.profile.studentVerified = true
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

  function crowdReviewsFor(targetType: CrowdReviewTargetType, targetId: string) {
    return state.crowdReviews
      .filter(item => item.targetType === targetType && item.targetId === targetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function submitCrowdReview(targetType: CrowdReviewTargetType, targetId: string, decision: CrowdReviewDecision, note: string) {
    assertPersistenceReady()
    assertCrowdReviewer(currentUser.value)

    if (targetType !== 'pro_application')
      throw new Error('众包审核当前只开放 Pro 申请摘要')

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
      throw new Error('请填写众包审核建议')

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

  return {
    state,
    isHydrated,
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
    submitStudentVerification,
    approveStudentVerification,
    rejectStudentVerification,
    createSquarePost,
    boostSquarePost,
    reportSquareBoost,
    crowdReviewsFor,
    submitCrowdReview,
    setUserCrowdReviewer,
    setUserSuspended,
    setUserStudentVerified,
    unbindUserGitHub,
    adjustUserPoints,
    updateSiteBanner,
    ensureWelfareStateLoaded,
    reloadWelfareState,
    assertPersistenceReady,
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
