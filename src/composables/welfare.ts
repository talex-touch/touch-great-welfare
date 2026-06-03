import { computed, reactive, ref, watch } from 'vue'
import { applyWelfareRetentionPolicy, DATA_RETENTION_DAYS, DATA_RETENTION_MS } from '~/shared/welfare-retention'
import { isRichTextEmpty, richTextToPlainText, sanitizeRichText } from '~/utils/rich-text'
import { loadWelfareState, saveWelfareState } from './welfare-persistence'

export type UserRole = 'admin' | 'reviewer' | 'user'
export type RequestKind = 'code' | 'image' | 'pro' | 'resource'
export type RequestStatus = 'draft' | 'reserved' | 'pending_review' | 'processing' | 'answered' | 'completed' | 'closed' | 'rejected' | 'submitted' | 'in_review' | 'approved' | 'partial_approved' | 'cancelled'
export type ApplicationMessageType = 'comment' | 'result_submission' | 'system'
export type StudentStatus = 'pending' | 'approved' | 'rejected'
export type CreditTransactionType = 'recharge' | 'spend' | 'refund' | 'adjustment' | 'grant'
export type AiReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs_human' | 'failed'
export type CrowdReviewTargetType = 'pro_application'
export type CrowdReviewDecision = 'approve' | 'reject' | 'needs_admin'
export type UserLevelKey = 'starter' | 'steady' | 'trusted' | 'priority' | 'guardian'
export type LlmApiModelRegion = 'domestic' | 'global' | 'custom'
export type ResourceType = 'database' | 'llm_api_quota' | 'git_repository' | 'cicd' | 'vpn' | 'ip_allowlist' | 'server' | 'gpu' | 'k8s_namespace' | 'object_storage'
export type ResourceApprovalStatus = 'pending' | 'approved' | 'rejected' | 'adjusted_approved'
export type ResourceProvisionStatus = 'not_required' | 'pending' | 'completed'
export type ResourceUrgency = 'normal' | 'urgent' | 'emergency'
export type ResourceTermId = 'general_resource_terms' | 'database_security_terms' | 'llm_api_compliance_terms' | 'infrastructure_resource_terms'

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
  avatar?: string
  bio?: string
  githubUsername?: string
  githubId?: string
  selectedRepo?: string
  githubRepos?: string[]
  githubAuthorized?: boolean
  githubAuthorizedAt?: string
  studentVerified: boolean
}

export interface User {
  id: string
  role: UserRole
  profile: UserProfile
  points: number
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
  category: string
  school?: string
  identity?: string
  grade?: string
  educationLevel?: string
  educationEmail?: string
  notes: string
  attachments: AttachmentMeta[]
  status: StudentStatus
  reviewFee: number
  feeReturned: boolean
  reply?: string
  createdAt: string
  reviewedAt?: string
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

export interface CreditTransaction {
  id: string
  userId: string
  delta: number
  type: CreditTransactionType
  reason: string
  refId?: string
  createdAt: string
}

export interface WelfareState {
  users: User[]
  currentUserId?: string
  oauth: OauthConfig
  applications: WelfareApplication[]
  studentVerifications: StudentVerification[]
  crowdReviews: CrowdReview[]
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
  llmApiModelKey?: string
  llmApiBudgetUsd?: number
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
  attachments?: FileLike[]
  saveAsDraft?: boolean
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
  category: string
  school?: string
  identity?: string
  grade?: string
  educationLevel?: string
  educationEmail?: string
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
  image: 3200,
  pro: 12000,
  resource: 0,
}

export const BASE_REQUEST_COST: Record<RequestKind, number> = {
  code: 800,
  image: 3200,
  pro: 12000,
  resource: 0,
}

export const ACTIVITY_DISCOUNT_RATE = 0.01
export const ACTIVITY_DAYS = 7
export const ACTIVITY_START_AT = '2026-06-01T00:00:00.000Z'
export const ACTIVITY_END_AT = '2026-06-08T00:00:00.000Z'
export const ACTIVITY_NAME = '限时 0.1 折'
export const PRO_BASE_COST = 10880
export const PRO_PUBLIC_COST = BASE_REQUEST_COST.pro
export const PRO_CONTEXT_APPEND_COST = 10880
export const PRO_STANDARD_PROCESSING_HOURS = 72
export const PRO_EXPEDITED_PROCESSING_HOURS = 48
export const PRO_EXPEDITE_COST = 1100
export const LLM_API_DEFAULT_MODEL_KEY = 'codex'
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
    concurrencyLimit: 1,
  },
  {
    key: 'claude-code',
    name: 'ClaudeCode',
    provider: 'Anthropic',
    region: 'global',
    description: '适合长上下文代码分析、重构和复杂推理。',
    enabled: true,
    pointsPerUsd: 12,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 2,
    concurrencyLimit: 1,
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    provider: 'DeepSeek',
    region: 'domestic',
    description: '国内模型通道，适合通用代码问答与较低成本场景。',
    enabled: true,
    pointsPerUsd: 6,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 3,
    concurrencyLimit: 1,
  },
  {
    key: 'qwen',
    name: 'Qwen',
    provider: 'Alibaba Cloud',
    region: 'domestic',
    description: '国内模型通道，适合中文材料理解与代码辅助。',
    enabled: true,
    pointsPerUsd: 5,
    defaultBudgetUsd: 10,
    minBudgetUsd: 10,
    maxBudgetUsd: 1000,
    ipLimit: 2,
    rpmLimit: 3,
    concurrencyLimit: 1,
  },
]
export const LLM_API_BUDGET_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const
export const RESOURCE_TERMS: ResourceTermConfig[] = [
  {
    id: 'general_resource_terms',
    title: '通用资源使用条款',
    version: '2026.06',
    content: ['仅将资源用于已说明的公益/研发目的。', '不得共享账号、密钥或临时权限；到期后应主动释放资源。', '若用途、负责人或成本归属变化，应重新提交或补充申请。'],
  },
  {
    id: 'database_security_terms',
    title: '数据库安全条款',
    version: '2026.06',
    content: ['遵循最小权限原则，不导出、不传播未授权数据。', '生产环境和敏感数据操作需保留操作范围说明。', '临时运维权限到期自动回收，异常操作需及时上报。'],
  },
  {
    id: 'llm_api_compliance_terms',
    title: '大模型 API 合规条款',
    version: '2026.06',
    content: ['不得向模型上传未脱敏的个人隐私、密钥、商业机密或受限代码。', '额度和预算归属申请项目，超额或滥用需由负责人说明。', '按申请记录执行日志留存、脱敏和审计要求。'],
  },
  {
    id: 'infrastructure_resource_terms',
    title: '基础设施资源条款',
    version: '2026.06',
    content: ['服务器、GPU、K8s、对象存储等资源仅用于申请场景。', '禁止挖矿、转租、压测未授权系统或绕过安全策略。', '资源到期应及时释放，产生费用计入申请成本归属。'],
  },
]
export const RESOURCE_TYPE_CONFIGS: ResourceTypeConfig[] = [
  { resourceType: 'database', displayName: '数据库', category: 'database', description: 'MySQL / PostgreSQL / Redis 权限或实例访问。', icon: 'i-carbon-data-base', enabled: true, subtypes: ['mysql', 'postgresql', 'redis'], termsIds: ['database_security_terms'], approverGroup: 'DBA' },
  { resourceType: 'llm_api_quota', displayName: '大模型 API 额度', category: 'llm', description: 'OpenAI、Anthropic、Gemini、DeepSeek、通义等 API 额度。', icon: 'i-carbon-ai-status', enabled: true, subtypes: ['openai', 'anthropic', 'google_gemini', 'deepseek', 'qwen', 'doubao', 'zhipu', 'moonshot', 'minimax'], termsIds: ['llm_api_compliance_terms'], approverGroup: 'AI 平台/成本负责人' },
  { resourceType: 'git_repository', displayName: 'Git 仓库权限', category: 'access', description: '代码仓库只读、开发者、维护者权限。', icon: 'i-carbon-logo-github', enabled: true, subtypes: ['gitlab', 'github', 'gitee'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'cicd', displayName: 'CI/CD 权限', category: 'access', description: '流水线执行、配置、部署权限。', icon: 'i-carbon-continuous-deployment', enabled: true, subtypes: ['pipeline', 'runner', 'deployment'], termsIds: ['infrastructure_resource_terms'], approverGroup: 'DevOps' },
  { resourceType: 'vpn', displayName: 'VPN', category: 'access', description: '内网访问 VPN 权限。', icon: 'i-carbon-vpn', enabled: true, subtypes: ['personal', 'project'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'ip_allowlist', displayName: 'IP 白名单', category: 'access', description: '办公、服务器或第三方访问白名单。', icon: 'i-carbon-firewall', enabled: true, subtypes: ['office_ip', 'server_ip', 'third_party_ip'], termsIds: ['infrastructure_resource_terms'], approverGroup: '安全/运维' },
  { resourceType: 'server', displayName: '云服务器', category: 'compute', description: '云主机规格、数量、环境和成本归属。', icon: 'i-carbon-server', enabled: true, subtypes: ['ecs', 'vm'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'gpu', displayName: 'GPU', category: 'compute', description: 'GPU 卡型、数量、时长和用途。', icon: 'i-carbon-machine-learning-model', enabled: true, subtypes: ['nvidia_t4', 'nvidia_a10', 'nvidia_a100', 'other'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'k8s_namespace', displayName: 'K8s Namespace', category: 'compute', description: '命名空间、资源配额、环境和访问范围。', icon: 'i-carbon-kubernetes', enabled: true, subtypes: ['dev', 'test', 'staging', 'prod'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
  { resourceType: 'object_storage', displayName: '对象存储', category: 'compute', description: 'Bucket、容量、权限和生命周期。', icon: 'i-carbon-cloud-storage', enabled: true, subtypes: ['bucket', 'archive', 'public_assets'], termsIds: ['infrastructure_resource_terms'], approverGroup: '基础设施' },
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
export { DATA_RETENTION_DAYS }

function now() {
  return new Date().toISOString()
}

function addDays(value: string, days: number) {
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString()
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
    concurrencyLimit: Math.max(1, Math.min(100, Math.trunc(Number(model.concurrencyLimit || fallback.concurrencyLimit)))),
  }
}

export function normalizeLlmApiModelPricings(value: unknown): LlmApiModelPricing[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_LLM_API_MODELS
  const seen = new Set<string>()
  const normalized: LlmApiModelPricing[] = []

  for (const item of source) {
    if (!item || typeof item !== 'object')
      continue

    const model = normalizeLlmApiModelPricing(item as Partial<LlmApiModelPricing>)
    if (seen.has(model.key))
      continue

    seen.add(model.key)
    normalized.push(model)
  }

  return normalized.length ? normalized : DEFAULT_LLM_API_MODELS.map(item => ({ ...item }))
}

export function resolveLlmApiModel(modelKey?: string, models: readonly LlmApiModelPricing[] = DEFAULT_LLM_API_MODELS) {
  const enabledModels = models.filter(item => item.enabled)
  return enabledModels.find(item => item.key === modelKey)
    ?? enabledModels.find(item => item.key === LLM_API_DEFAULT_MODEL_KEY)
    ?? enabledModels[0]
    ?? DEFAULT_LLM_API_MODELS[0]
}

export function normalizeLlmApiBudgetUsd(value: unknown, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  const amount = Math.trunc(Number(value))
  if (!Number.isFinite(amount))
    return model.defaultBudgetUsd

  return Math.max(model.minBudgetUsd, Math.min(model.maxBudgetUsd, amount))
}

export function calculateLlmApiCostPoints(budgetUsd: number, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  return normalizeLlmApiBudgetUsd(budgetUsd, model) * model.pointsPerUsd
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
    applications: [],
    studentVerifications: [],
    crowdReviews: [],
    transactions: [],
    createdAt: now(),
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
    users: input.users ?? [],
    applications: input.applications ?? [],
    studentVerifications: input.studentVerifications ?? [],
    crowdReviews: input.crowdReviews ?? [],
    transactions: input.transactions ?? [],
  }

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
    }
  })

  return applyWelfareRetentionPolicy(normalized).state
}

function assertCurrentUser(user?: User): asserts user is User {
  if (!user)
    throw new Error('请先通过 GitHub App 授权登录')
}

function assertAdmin(user?: User): asserts user is User {
  if (!user || user.role !== 'admin')
    throw new Error('需要管理员权限')
}

function assertCrowdReviewer(user?: User): asserts user is User {
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
    if (['pending_review', 'processing', 'submitted', 'in_review'].includes(application.status))
      stats.pending += 1
  }

  for (const verification of source.studentVerifications) {
    if (verification.userId !== userId)
      continue

    stats.submitted += 1
    if (verification.status === 'approved') {
      stats.approved += 1
      stats.studentApproved += 1
    }
    if (verification.status === 'rejected') {
      stats.rejected += 1
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
  return ['reserved', 'pending_review', 'processing', 'submitted', 'in_review'].includes(status)
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
    if (!readString(item.payload, 'model'))
      throw new Error('请填写大模型模型/模型族')
    const monthlyTokens = Number(item.payload.monthlyTokens)
    if (!Number.isFinite(monthlyTokens) || monthlyTokens <= 0)
      throw new Error('大模型月 Token 额度必须大于 0')
    const budget = Number(item.payload.budgetLimit)
    if (!Number.isFinite(budget) || budget < 0)
      throw new Error('大模型预算上限不合法')
    if (!readString(item.payload, 'usageScenario'))
      throw new Error('请填写大模型使用场景')
  }

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
  return [
    `<p>${sanitizeRichText(payload.businessBackground || payload.reason)}</p>`,
    `<p><strong>申请原因：</strong>${sanitizeRichText(payload.reason)}</p>`,
    payload.costCenter ? `<p><strong>成本归属：</strong>${sanitizeRichText(payload.costCenter)}</p>` : '',
  ].filter(Boolean).join('')
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
    .filter(item => item.type === 'pro' && ['pending_review', 'processing'].includes(item.status))
    .sort(compareReviewPriority))
  const pendingApplications = computed(() => state.applications
    .filter(item => ['pending_review', 'processing', 'submitted', 'in_review'].includes(item.status))
    .sort(compareReviewPriority))
  const pendingStudentVerifications = computed(() => state.studentVerifications
    .filter(item => item.status === 'pending')
    .sort(compareReviewPriority))
  const totalReservedApplications = computed(() => state.applications
    .filter(item => item.status === 'reserved')
    .length)

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

  function addTransaction(userId: string, delta: number, type: CreditTransactionType, reason: string, refId?: string) {
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
      type,
      reason,
      refId,
      createdAt: now(),
    })
  }

  function chargeRejectionReviewFee(application: WelfareApplication) {
    const fee = application.rejectionReviewFee || calculateRejectionReviewFee(application.cost)
    addTransaction(application.userId, -fee, 'spend', '申请退回扣除 AI 审核手续费', application.id)
  }

  function createAdmin(payload: CreateAdminPayload) {
    assertPersistenceReady()

    if (hasAdmin.value)
      throw new Error('管理员已经创建')

    const admin: User = {
      id: createId('admin'),
      role: 'admin',
      profile: {
        displayName: payload.displayName.trim() || '公益管理员',
        email: payload.email.trim() || 'admin@example.com',
        githubAuthorized: false,
        studentVerified: false,
      },
      points: 100000,
      createdAt: now(),
      lastLoginAt: now(),
    }

    state.users.push(admin)
    state.currentUserId = admin.id
    state.transactions.unshift({
      id: createId('tx'),
      userId: admin.id,
      delta: 100000,
      type: 'grant',
      reason: '首次创建管理员初始化积分',
      createdAt: now(),
    })
  }

  function loginAsAdmin() {
    assertPersistenceReady()

    const admin = state.users.find(user => user.role === 'admin')
    if (!admin)
      throw new Error('尚未创建管理员')

    admin.lastLoginAt = now()
    state.currentUserId = admin.id
  }

  function logout() {
    assertPersistenceReady()

    state.currentUserId = undefined
  }

  function updateCurrentProfile(profile: Partial<UserProfile>) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

    currentUser.value.profile = {
      ...currentUser.value.profile,
      ...profile,
    }
  }

  function submitApplication(payload: SubmitApplicationPayload) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

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
    const pricing = buildPricingSnapshot(payload.type, createdAt)
    const llmApiModel = payload.type === 'code' ? resolveLlmApiModel(payload.llmApiModelKey ?? (payload.codexBudgetUsd ? 'codex' : undefined)) : undefined
    const llmApiBudgetUsd = payload.type === 'code' && llmApiModel ? normalizeLlmApiBudgetUsd(payload.llmApiBudgetUsd ?? payload.codexBudgetUsd, llmApiModel) : undefined
    const cost = llmApiBudgetUsd && llmApiModel ? calculateLlmApiCostPoints(llmApiBudgetUsd, llmApiModel) : pricing.cost
    const codexBudgetUsd = llmApiModel?.key === 'codex' ? llmApiBudgetUsd : undefined
    const storageExtended = payload.type !== 'code' && !!payload.extendStorage
    const storageExtensionCost = storageExtended ? STORAGE_EXTENSION_COST : 0
    const expedited = payload.type === 'pro' && !!payload.expediteProcessing
    const expediteCost = expedited ? PRO_EXPEDITE_COST : 0
    const rejectionReviewFeeWaived = payload.type !== 'code' && !!payload.waiveRejectionReviewFee
    const prepaidCost = cost + storageExtensionCost + expediteCost
    if (currentUser.value.points < prepaidCost)
      throw new Error(`积分不足，本次申请需要预扣 ${prepaidCost} 积分`)

    const application: WelfareApplication = {
      id: createId('app'),
      userId: currentUser.value.id,
      type: payload.type,
      title,
      description,
      githubRepo: payload.githubRepo,
      hasOpenSourceBadge: !!payload.githubRepo && !!currentUser.value.profile.githubUsername && !!currentUser.value.profile.githubAuthorized,
      attachments: toAttachmentMeta(payload.attachments),
      status: 'pending_review',
      baseCost: llmApiBudgetUsd ? cost : pricing.baseCost,
      cost,
      costCharged: true,
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
      rejectionReviewFee: calculateRejectionReviewFee(cost),
      rejectionReviewFeeWaived,
      rejectionFraudulent: false,
      llmApiModelKey: llmApiModel?.key,
      llmApiModelName: llmApiModel?.name,
      llmApiProvider: llmApiModel?.provider,
      llmApiBudgetUsd,
      llmApiPointRate: llmApiModel?.pointsPerUsd,
      llmApiIpLimit: llmApiModel?.ipLimit,
      llmApiRpmLimit: llmApiModel?.rpmLimit,
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
      createdAt,
    }

    addTransaction(currentUser.value.id, -cost, 'spend', `${payload.type.toUpperCase()} 申请预扣`, application.id)
    if (storageExtended)
      addTransaction(currentUser.value.id, -storageExtensionCost, 'spend', '延长申请存储服务 7 天预扣', application.id)
    if (expediteCost)
      addTransaction(currentUser.value.id, -expediteCost, 'spend', 'Pro 处理加速预扣', application.id)

    state.applications.unshift(application)
    return application
  }

  function submitResourceApplication(payload: SubmitResourceApplicationPayload) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

    const title = payload.title.trim()
    const resourceTypes = Array.from(new Set(payload.selectedResourceTypes))
    const createdAt = now()
    const isDraft = !!payload.saveAsDraft

    if (!title)
      throw new Error('请填写申请标题')
    if (!isDraft && !payload.reason.trim())
      throw new Error('请填写申请原因')
    if (!isDraft && !payload.businessBackground.trim())
      throw new Error('请填写业务背景')
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')
    if (!resourceTypes.length)
      throw new Error('请至少选择一种资源类型')
    for (const resourceType of resourceTypes)
      assertKnownResourceType(resourceType)
    if (!payload.resourceItems.length)
      throw new Error('请至少添加一条资源明细')
    assertCanCreateRequest(currentUser.value.id)

    const applicationId = createId('app')
    const resourceItems = normalizeResourceItems(applicationId, payload.resourceItems, createdAt, !isDraft)
    const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
    const termsAcceptances = isDraft
      ? []
      : buildResourceTermsAcceptances(actualResourceTypes, payload.acceptedTermIds, currentUser.value.id, createdAt)

    const application: WelfareApplication = {
      id: applicationId,
      userId: currentUser.value.id,
      type: 'resource',
      title,
      description: buildResourceDescription(payload),
      hasOpenSourceBadge: false,
      attachments: toAttachmentMeta(payload.attachments),
      status: isDraft ? 'draft' : 'in_review',
      baseCost: 0,
      cost: 0,
      costCharged: false,
      pricingDiscountRate: 1,
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

    state.applications.unshift(application)
    return application
  }

  function updateResourceDraft(applicationId: string, payload: SubmitResourceApplicationPayload) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

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
    if (!payload.resourceItems.length)
      throw new Error('请至少添加一条资源明细')

    const isDraft = !!payload.saveAsDraft
    const resourceItems = normalizeResourceItems(application.id, payload.resourceItems, updatedAt, !isDraft)
    const actualResourceTypes = Array.from(new Set(resourceItems.map(item => item.resourceType)))
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

  function addApplicationMessage(applicationId: string, type: ApplicationMessageType, content: string, attachments: FileLike[] = []) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

    const application = state.applications.find(item => item.id === applicationId)
    if (!application)
      throw new Error('申请不存在')
    if (!['pending_review', 'processing', 'answered'].includes(application.status))
      throw new Error('该申请状态不支持追加消息')

    const normalizedContent = sanitizeRichText(content)
    if (isRichTextEmpty(normalizedContent))
      throw new Error('请输入消息内容')
    if (totalBytes(attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')

    if (!application.messages)
      application.messages = []

    application.messages.push({
      id: createId('msg'),
      applicationId: application.id,
      userId: currentUser.value.id,
      type,
      content: normalizedContent,
      attachments: toAttachmentMeta(attachments),
      createdAt: now(),
    })
  }

  function submitApplicationResult(applicationId: string, content: string, attachments: FileLike[] = []) {
    addApplicationMessage(applicationId, 'result_submission', content, attachments)
  }

  function appendApplicationContext(payload: AppendApplicationContextPayload) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

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

  function submitStudentVerification(payload: SubmitStudentPayload) {
    assertPersistenceReady()
    assertCurrentUser(currentUser.value)

    if (!payload.category.trim())
      throw new Error('请填写认证类目')
    const notes = sanitizeRichText(payload.notes)
    if (isRichTextEmpty(notes))
      throw new Error('请填写认证材料说明')
    if (payload.educationEmail?.trim() && !/^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/.test(payload.educationEmail.trim()))
      throw new Error('请填写有效的教育邮箱')
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')
    assertCanCreateRequest(currentUser.value.id)

    const verification: StudentVerification = {
      id: createId('stu'),
      userId: currentUser.value.id,
      category: payload.category.trim(),
      school: payload.school?.trim(),
      identity: payload.identity?.trim(),
      grade: payload.grade?.trim(),
      educationLevel: payload.educationLevel?.trim(),
      educationEmail: payload.educationEmail?.trim(),
      notes,
      attachments: toAttachmentMeta(payload.attachments),
      status: 'pending',
      reviewFee: STUDENT_REVIEW_FEE,
      feeReturned: false,
      createdAt: now(),
    }

    addTransaction(currentUser.value.id, -STUDENT_REVIEW_FEE, 'spend', '学生认证审核费', verification.id)
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
    addTransaction(verification.userId, verification.reviewFee, 'refund', '学生认证通过返还审核费', verification.id)

    const user = state.users.find(item => item.id === verification.userId)
    if (user)
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

  return {
    state,
    isHydrated,
    persistenceError,
    hasAdmin,
    currentUser,
    currentUserLevelCard,
    currentUserApplications,
    currentStudentVerifications,
    isAdmin,
    canCrowdReview,
    pendingApplications,
    pendingProApplications,
    pendingStudentVerifications,
    totalReservedApplications,
    activeRequestCount,
    applicationCooldownUntil,
    rejectionFeeWaiverBlockedUntil,
    userName,
    userEmail,
    userLevelCard,
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
    addApplicationMessage,
    submitApplicationResult,
    answerProApplication,
    rejectProApplication,
    submitStudentVerification,
    approveStudentVerification,
    rejectStudentVerification,
    crowdReviewsFor,
    submitCrowdReview,
    setUserCrowdReviewer,
    setUserStudentVerified,
    unbindUserGitHub,
    adjustUserPoints,
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
