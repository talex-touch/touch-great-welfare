import type { LlmApiModelPricing, LlmApiModelRegion, RequestKind, SystemConfig, SystemFeatureToggle } from './welfare-types'

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
export const ACTIVITY_DAYS = 15
export const ACTIVITY_START_AT = '2026-06-01T00:00:00+08:00'
export const ACTIVITY_END_AT = '2026-06-15T23:59:59.999+08:00'
export const ACTIVITY_NAME = '限时 0.1 折'
export const LLM_API_BUDGET_ACTIVITY_TIERS = [
  { minBudgetUsd: 500, discountRate: 1 },
  { minBudgetUsd: 300, discountRate: 0.07 },
  { minBudgetUsd: 100, discountRate: 0.05 },
] as const
export const PRO_BASE_COST = 600
export const PRO_PUBLIC_COST = 120
export const PRO_CONTEXT_APPEND_COST = 600
export const PRO_STANDARD_PROCESSING_HOURS = 72
export const PRO_EXPEDITED_PROCESSING_HOURS = 48
export const PRO_EXPEDITE_COST = 1100
export const GPT_PRO_MODEL_KEY = 'gpt-pro'
export const GPT_PRO_DEFAULT_ROUNDS = 5
export const GPT_PRO_MIN_ROUNDS = 1
export const GPT_PRO_MAX_ROUNDS = 50
export const GPT_PRO_ACTIVITY_DISCOUNT_RATE = 1
export const GPT_PRO_ACTIVITY_NAME = 'GPT PRO 轮次套餐'
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

function now() {
  return new Date().toISOString()
}

export function simplePowHash(value: string) {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isPromotionActive(referenceTime = now()) {
  const time = new Date(referenceTime).getTime()
  const start = new Date(ACTIVITY_START_AT).getTime()
  const end = new Date(ACTIVITY_END_AT).getTime()
  return Number.isFinite(time) && time >= start && time <= end
}

export function createUserInviteCode(userId: string) {
  return `TGW-${simplePowHash(userId).slice(0, 8).toUpperCase()}`
}

export function calculateActivityPrice(cost: number, referenceTime = now()) {
  if (!isPromotionActive(referenceTime))
    return cost

  return Math.max(1, Math.ceil(cost * ACTIVITY_DISCOUNT_RATE))
}

export function isGptProModel(modelOrKey?: Pick<LlmApiModelPricing, 'key'> | string) {
  const key = typeof modelOrKey === 'string' ? modelOrKey : modelOrKey?.key
  return key === GPT_PRO_MODEL_KEY
}

export function applyRateDiscount(cost: number, rate: number) {
  return Math.max(1, Math.ceil(cost * Math.max(0.01, Math.min(1, rate))))
}

export function normalizeLlmApiBudgetUsd(value: unknown, model: LlmApiModelPricing = DEFAULT_LLM_API_MODELS[0]) {
  const amount = Math.trunc(Number(value))
  if (!Number.isFinite(amount))
    return model.defaultBudgetUsd

  return Math.max(model.minBudgetUsd, Math.min(model.maxBudgetUsd, amount))
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
