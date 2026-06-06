import type { TemporaryKeyView } from './ai'
import type { GitHubAppConfigView, SaveGitHubAppConfigResult } from './github-app'
import type { OAuthProviderConfigView, PublicOAuthProvider } from './oauth'
import type { RechargeConfigView, RechargeStatusResult, SaveRechargeConfigResult } from './recharge'
import type { Sub2ApiKeyView } from './sub2api'
import type { ApplicationMessageType, CrowdReviewDecision, RejectApplicationOptions, RequestKind, ResourceApprovalStatus, ResourceTermId, ResourceType } from './welfare'
import { computed, reactive, ref, watch } from 'vue'
import { STUDENT_SCHOOL_SUGGESTIONS } from '~/data/student-schools'
import { createApplicationReview, createImageJob, createTemporaryAiKey, deleteTemporaryAiKey, loadAiConfig, loadTemporaryAiKeys, saveAiConfig } from './ai'
import { createGitHubAuthorization, loadGitHubAppConfig, saveGitHubAppConfig } from './github-app'
import {
  loadNotificationProviderConfig,
  loadNotifications,
  loadNotificationSettings,
  loadPushPublicKey,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationProviderConfig,
  saveNotificationSettings,
  savePushSubscription,
  urlBase64ToUint8Array,
} from './notifications'
import { createOAuthAuthorization, loadOAuthProviderConfigs, loadOAuthProviders, saveOAuthProviderConfigs } from './oauth'
import { createRechargeOrder, loadRechargeConfig, loadRechargeStatus, saveRechargeConfig } from './recharge'
import { createSub2ApiKey, deleteSub2ApiKey, loadSub2ApiConfig, loadSub2ApiKeys, saveSub2ApiConfig, testSub2ApiConfig } from './sub2api'
import { verifyTurnstileToken } from './turnstile'
import {
  ACTIVITY_DISCOUNT_RATE,
  ACTIVITY_END_AT,
  ACTIVITY_NAME,
  applicationPowChallenge,
  calculateActivityPrice,
  calculateApplicationPrepaidCost,
  calculateLlmApiCostPoints,
  calculateLlmApiRateLimitChangeCost,
  DEFAULT_LLM_API_MODELS,
  EDUCATION_EMAIL_REVIEW_INBOX,
  LLM_API_BUDGET_OPTIONS,
  LLM_API_DEFAULT_MODEL_KEY,
  LLM_API_EXTENDED_PROCESSING_HOURS,
  LLM_API_EXTENDED_REVIEW_THRESHOLD_USD,
  LLM_API_STANDARD_PROCESSING_HOURS,
  llmApiRequiresExtendedReview,
  MAX_ACTIVE_USER_REQUESTS,
  normalizeApplicationPolicy,
  normalizeLlmApiBudgetUsd,
  normalizeLlmApiModelPricings,
  PRO_EXPEDITE_COST,
  PRO_EXPEDITED_PROCESSING_HOURS,
  PRO_STANDARD_PROCESSING_HOURS,
  REQUEST_COST,
  resolveLlmApiModel,
  RESOURCE_DEFAULT_DURATION,
  RESOURCE_TERMS,
  RESOURCE_TYPE_CONFIGS,
  solveApplicationPow,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
  termsForResourceTypes,
  useWelfareStore,
} from './welfare'
import { saveWelfareState } from './welfare-persistence'

export interface UploadLikeFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

const welfare = useWelfareStore()

export const adminForm = reactive({
  displayName: '公益管理员',
  email: 'admin@welfare.dev',
})

export const profileForm = reactive({
  displayName: '',
  email: '',
  bio: '',
  githubUsername: '',
  selectedRepo: '',
})

export const invitationForm = reactive({
  code: '',
  message: '',
})

export const rechargeForm = reactive({
  amount: 100,
  loading: false,
  statusMessage: '',
})

export const rechargeConfigForm = reactive({
  enabled: true,
  gatewayBaseUrl: 'https://credit.linux.do/epay',
  pid: '',
  key: '',
  keyMasked: '',
  pointsPerLdc: 10,
  configured: false,
  loading: false,
  message: '',
  envPreview: null as SaveRechargeConfigResult['env'] | null,
})

export const githubAppConfigForm = reactive({
  enabled: true,
  appName: '',
  appSlug: '',
  clientId: '',
  clientSecret: '',
  clientSecretMasked: '',
  callbackUrl: typeof globalThis.location !== 'undefined' ? `${globalThis.location.origin}/api/github-app/callback` : '/api/github-app/callback',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  apiBaseUrl: 'https://api.github.com',
  scopes: 'read:user user:email public_repo',
  configured: false,
  loading: false,
  message: '',
  envPreview: null as SaveGitHubAppConfigResult['env'] | null,
})

export const githubAuthorizationForm = reactive({
  loading: false,
  message: '',
})

export const oauthConfigForm = reactive({
  loading: false,
  message: '',
})
export const oauthProviderConfigs = ref<Array<OAuthProviderConfigView & { clientSecret: string }>>([])
export const publicOAuthProviders = ref<PublicOAuthProvider[]>([])
export const oauthLoginForm = reactive({
  loadingProviderId: '',
  message: '',
})

export const aiConfigForm = reactive({
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  imageModel: 'gpt-image-1.5',
  reviewModel: 'gpt-4.1-mini',
  apiKey: '',
  apiKeyMasked: '',
  newapiKey: '',
  newapiKeyMasked: '',
  newapiManagementBaseUrl: '',
  newapiUserId: '',
  temporaryKeyTtlMinutes: 60,
  temporaryKeyQuota: 100,
  llmApiModels: DEFAULT_LLM_API_MODELS.map(model => ({ ...model })),
  configured: false,
  loading: false,
  message: '',
  envPreview: null as Record<string, string> | null,
})

export const temporaryAiKey = ref('')
export const temporaryAiKeyExpiresAt = ref('')
export const temporaryAiKeyForm = reactive({
  name: 'Touch Great Welfare NewAPI Key',
  ttlMinutes: 60,
  quota: 100,
  configured: false,
  loading: false,
  message: '',
})
export const temporaryAiKeys = ref<TemporaryKeyView[]>([])
export const generatedTemporaryAiKey = ref('')

export const sub2ApiConfigForm = reactive({
  enabled: true,
  baseUrl: '',
  adminApiKey: '',
  adminApiKeyMasked: '',
  databaseUrl: '',
  databaseUrlMasked: '',
  defaultGroupId: '' as number | string,
  defaultQuotaUsd: 10,
  defaultExpiresInDays: 30,
  defaultRateLimit5h: 0,
  defaultRateLimit1d: 0,
  defaultRateLimit7d: 0,
  configured: false,
  loading: false,
  testing: false,
  message: '',
})

export const sub2ApiKeyForm = reactive({
  name: 'Touch Great Welfare API Key',
  quotaUsd: 10,
  expiresInDays: 30,
  groupId: '' as number | string,
  rateLimit5h: 0,
  rateLimit1d: 0,
  rateLimit7d: 0,
  loading: false,
  message: '',
})

export const sub2ApiKeys = ref<Sub2ApiKeyView[]>([])
export const generatedSub2ApiKey = ref('')

export const notificationSettingsForm = reactive({
  emailEnabled: false,
  emailAddress: '',
  feishuEnabled: false,
  feishuWebhookUrl: '',
  feishuWebhookMasked: '',
  browserPushEnabled: false,
  pushSubscriptionCount: 0,
  loading: false,
  permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
})

export const notificationProviderConfigForm = reactive({
  resendApiKey: '',
  resendApiKeyMasked: '',
  resendFromEmail: 'Touch Great Welfare <notice@example.com>',
  vapidPublicKey: '',
  vapidPrivateKey: '',
  vapidPrivateKeyMasked: '',
  vapidSubject: 'mailto:admin@example.com',
  emailConfigured: false,
  pushConfigured: false,
  loading: false,
  message: '',
})

export const notificationList = ref<Awaited<ReturnType<typeof loadNotifications>>['notifications']>([])
export const unreadNotificationCount = ref(0)
export const notificationsLoading = ref(false)

export const applicationSecurityForm = reactive({
  powNonce: '',
  powStatus: 'idle' as 'idle' | 'computing' | 'ready',
  turnstileToken: '',
  turnstileVerified: false,
  message: '',
})

export const applicationPolicyConfigForm = reactive({
  loading: false,
  message: '',
})

export const applicationForm = reactive({
  type: 'code' as RequestKind,
  title: 'LLMApi 额度申请',
  description: '<p>希望获得公益项目所需的大模型 API 额度。</p>',
  githubRepo: '',
  extendStorage: false,
  expediteProcessing: false,
  waiveRejectionReviewFee: false,
  llmApiModelKey: LLM_API_DEFAULT_MODEL_KEY,
  llmApiBudgetUsd: DEFAULT_LLM_API_MODELS[0].defaultBudgetUsd,
  llmApiCustomRpmLimit: DEFAULT_LLM_API_MODELS[0].rpmLimit,
  llmApiCustomTpmLimit: DEFAULT_LLM_API_MODELS[0].tpmLimit,
})

export const resourceApplicationForm = reactive({
  title: '资源申请',
  departmentId: '',
  projectId: '',
  reason: '',
  businessBackground: '',
  urgency: 'normal' as 'normal' | 'urgent' | 'emergency',
  expectedEffectiveAt: '',
  costCenter: '',
  ownerId: '',
  duration: RESOURCE_DEFAULT_DURATION,
  selectedResourceTypes: ['database'] as ResourceType[],
  acceptedTermIds: [] as ResourceTermId[],
  selectedCouponId: '',
})

export const resourceApplicationItems = ref<Array<{
  id: string
  resourceType: ResourceType
  resourceSubtype: string
  payload: Record<string, any>
  requestedQuota?: string
  requestedPermission?: string
  duration?: string
}>>([])

export const resourceReviewDrafts = reactive<Record<string, {
  status: Exclude<ResourceApprovalStatus, 'pending'>
  note: string
  approvedPayloadText: string
}>>({})

export const resourceProvisionDrafts = reactive<Record<string, string>>({})

export const applicationFiles = ref<UploadLikeFile[]>([])

export const studentForm = reactive({
  realName: '',
  category: '大学生',
  school: '北京大学',
  grade: '2026 级',
  educationLevel: '本科',
  identity: '',
  educationEmail: '',
  notes: '<h3>身份说明</h3><ul><li>2026 级本科生</li><li>已上传学生证或录取通知截图</li></ul><h3>材料清单</h3><ul><li>学生证照片</li><li>校园邮箱截图</li></ul>',
})

export const educationEmailVerificationForm = reactive({
  code: '',
  challengeId: '',
  subject: '',
  body: '',
  mailto: '',
  sentTo: '',
  expiresAt: '',
  loading: false,
  verified: false,
  message: '',
})

export const studentCategoryOptions = [
  '高中生',
  '大学生',
  '研究生',
  '博士生',
  '科研工作者',
  '教师',
  '其他',
] as const

export const studentGradeOptions = [
  '高一',
  '高二',
  '高三',
  '大一',
  '大二',
  '大三',
  '大四',
  '研一',
  '研二',
  '研三',
  '博一',
  '博二',
  '博三',
  '2026 级',
  '2025 级',
  '2024 级',
  '2023 级',
] as const

export const studentEducationLevelOptions = [
  '保密',
  '高中',
  '专科',
  '本科',
  '硕士',
  '博士',
  '博士后',
] as const

export const studentFiles = ref<UploadLikeFile[]>([])

export const reviewDrafts = reactive<Record<string, string>>({})
export const supplementDrafts = reactive<Record<string, string>>({})
export const rejectFraudulentDrafts = reactive<Record<string, boolean>>({})
export const crowdReviewDrafts = reactive<Record<string, {
  decision: CrowdReviewDecision
  note: string
}>>({})
export const pointDrafts = reactive<Record<string, number>>({})
export const selectedSection = ref<'apply' | 'student' | 'openSource' | 'notifications' | 'notificationSettings' | 'profile' | 'wallet' | 'admin'>('apply')
export const ADMIN_TABS = {
  login: '登录配置',
  policy: '申请策略',
  github: 'GitHub 应用',
  ai: 'AI 配置',
  sub2api: 'Sub2API',
  notifications: '通知配置',
  ldc: '充值配置',
  users: '用户管理',
  dashboard: '仪表盘数据',
  data: '业务数据管理',
  audit: '审计日志',
  points: '积分管理',
} as const
export const adminTabItems = [
  { key: 'login', name: ADMIN_TABS.login, icon: 'i-carbon-login' },
  { key: 'policy', name: ADMIN_TABS.policy, icon: 'i-carbon-rule' },
  { key: 'github', name: ADMIN_TABS.github, icon: 'i-carbon-logo-github' },
  { key: 'ai', name: ADMIN_TABS.ai, icon: 'i-carbon-ai-status' },
  { key: 'sub2api', name: ADMIN_TABS.sub2api, icon: 'i-carbon-api-1' },
  { key: 'notifications', name: ADMIN_TABS.notifications, icon: 'i-carbon-notification' },
  { key: 'ldc', name: ADMIN_TABS.ldc, icon: 'i-carbon-wallet' },
  { key: 'users', name: ADMIN_TABS.users, icon: 'i-carbon-user-multiple' },
  { key: 'dashboard', name: ADMIN_TABS.dashboard, icon: 'i-carbon-dashboard' },
  { key: 'data', name: ADMIN_TABS.data, icon: 'i-carbon-data-table' },
  { key: 'audit', name: ADMIN_TABS.audit, icon: 'i-carbon-cloud-auditing' },
  { key: 'points', name: ADMIN_TABS.points, icon: 'i-carbon-chart-line-data' },
] as const
export const activeAdminTab = ref<(typeof ADMIN_TABS)[keyof typeof ADMIN_TABS]>(ADMIN_TABS.login)
export const lastRechargeStatus = ref<RechargeStatusResult | null>(null)

export const pricingSummary = {
  activityName: ACTIVITY_NAME,
  activityDiscountRate: ACTIVITY_DISCOUNT_RATE,
  activityEndsAt: ACTIVITY_END_AT,
  requestCost: REQUEST_COST,
  currentRequestCost: {
    code: DEFAULT_LLM_API_MODELS[0].defaultBudgetUsd * DEFAULT_LLM_API_MODELS[0].pointsPerUsd,
    image: calculateActivityPrice(REQUEST_COST.image),
    pro: calculateActivityPrice(REQUEST_COST.pro),
  },
  storageExtensionCost: STORAGE_EXTENSION_COST,
  studentReviewFee: STUDENT_REVIEW_FEE,
  proExpediteCost: PRO_EXPEDITE_COST,
  proStandardProcessingHours: PRO_STANDARD_PROCESSING_HOURS,
  proExpeditedProcessingHours: PRO_EXPEDITED_PROCESSING_HOURS,
}

export const llmApiBudgetOptions = LLM_API_BUDGET_OPTIONS
export const codexBudgetOptions = llmApiBudgetOptions
export const llmApiReviewLimits = {
  extendedReviewThresholdUsd: LLM_API_EXTENDED_REVIEW_THRESHOLD_USD,
  standardProcessingHours: LLM_API_STANDARD_PROCESSING_HOURS,
  extendedProcessingHours: LLM_API_EXTENDED_PROCESSING_HOURS,
} as const
export const codexAccessLimits = {
  minBudgetUsd: DEFAULT_LLM_API_MODELS[0].minBudgetUsd,
  maxBudgetUsd: DEFAULT_LLM_API_MODELS[0].maxBudgetUsd,
  pointsPerUsd: DEFAULT_LLM_API_MODELS[0].pointsPerUsd,
  extendedReviewThresholdUsd: LLM_API_EXTENDED_REVIEW_THRESHOLD_USD,
  standardProcessingHours: LLM_API_STANDARD_PROCESSING_HOURS,
  extendedProcessingHours: LLM_API_EXTENDED_PROCESSING_HOURS,
  ipLimit: DEFAULT_LLM_API_MODELS[0].ipLimit,
  rpmLimit: DEFAULT_LLM_API_MODELS[0].rpmLimit,
  concurrencyLimit: DEFAULT_LLM_API_MODELS[0].concurrencyLimit,
} as const

export function useWelfareUiState() {
  const repoOptions = computed(() => welfare.currentUser.value?.profile.githubRepos ?? [])
  const totalApplicationBytes = computed(() => applicationFiles.value.reduce((sum, file) => sum + file.size, 0))
  const totalStudentBytes = computed(() => studentFiles.value.reduce((sum, file) => sum + file.size, 0))
  const activeRequestCount = computed(() => welfare.currentUser.value ? welfare.activeRequestCount(welfare.currentUser.value.id) : 0)
  const canCreateRequest = computed(() => activeRequestCount.value < MAX_ACTIVE_USER_REQUESTS)
  const enabledLlmApiModels = computed(() => aiConfigForm.llmApiModels.filter(item => item.enabled))
  const selectedLlmApiModel = computed(() => resolveLlmApiModel(applicationForm.llmApiModelKey, aiConfigForm.llmApiModels))
  const selectedLlmApiBudgetUsd = computed(() => normalizeLlmApiBudgetUsd(applicationForm.llmApiBudgetUsd, selectedLlmApiModel.value))
  const selectedCodexBudgetUsd = selectedLlmApiBudgetUsd
  const selectedLlmApiRateLimitChangeCost = computed(() => calculateLlmApiRateLimitChangeCost(applicationForm.llmApiCustomRpmLimit, selectedLlmApiModel.value.rpmLimit, applicationForm.llmApiCustomTpmLimit, selectedLlmApiModel.value.tpmLimit))
  const selectedCost = computed(() => applicationForm.type === 'code' ? calculateLlmApiCostPoints(selectedLlmApiBudgetUsd.value, selectedLlmApiModel.value) : calculateActivityPrice(REQUEST_COST[applicationForm.type]))
  const selectedPrepaidCost = computed(() => {
    if (applicationForm.type === 'code')
      return selectedCost.value

    return calculateApplicationPrepaidCost(applicationForm.type, applicationForm.extendStorage, applicationForm.expediteProcessing)
  })
  const selectedLlmApiRequiresExtendedReview = computed(() => applicationForm.type === 'code' && llmApiRequiresExtendedReview(selectedLlmApiBudgetUsd.value, selectedLlmApiModel.value))
  const selectedCodexRequiresExtendedReview = selectedLlmApiRequiresExtendedReview
  const resourceTypeConfigs = computed(() => RESOURCE_TYPE_CONFIGS.filter(item => item.enabled))
  const selectedResourceTerms = computed(() => termsForResourceTypes(resourceApplicationForm.selectedResourceTypes))
  const heroProgress = computed(() => Math.min(100, Math.round((welfare.state.users.length / 12) * 100) + 24))
  const pendingCount = computed(() => welfare.pendingApplications.value.length + welfare.pendingStudentVerifications.value.length)
  const latestTransactions = computed(() => {
    if (!welfare.currentUser.value)
      return []

    return welfare.state.transactions
      .filter(item => item.userId === welfare.currentUser.value?.id)
      .slice(0, 8)
  })
  const currentUserCoupons = computed(() => welfare.currentUserCoupons.value)
  const availableCurrentUserCoupons = computed(() => {
    const user = welfare.currentUser.value
    return user ? welfare.availableCouponsForUser(user.id) : []
  })
  const currentUserDailyCheckIns = computed(() => welfare.currentUserDailyCheckIns.value)
  const currentUserInviteCode = computed(() => welfare.currentUser.value?.profile.inviteCode ?? '')
  const currentUserInvitationBinding = computed(() => welfare.currentUserInvitationBinding.value)
  const currentUserInviter = computed(() => {
    const binding = currentUserInvitationBinding.value
    return binding ? welfare.state.users.find(user => user.id === binding.inviterUserId) : undefined
  })
  const currentUserInvitees = computed(() => welfare.currentUserInviteeBindings.value.map(binding => ({
    binding,
    user: welfare.state.users.find(user => user.id === binding.inviteeUserId),
  })))
  const currentUserInvitationBindDeadline = computed(() => welfare.currentUser.value ? welfare.invitationBindDeadline(welfare.currentUser.value) : '')
  const canBindCurrentUserInvitation = computed(() => welfare.currentUser.value ? welfare.canBindInvitation(welfare.currentUser.value) : false)
  const todayCheckIn = computed(() => {
    const today = new Date()
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    return currentUserDailyCheckIns.value.find(item => item.dateKey === dateKey)
  })
  const currentCheckInStreak = computed(() => currentUserDailyCheckIns.value[0]?.streak ?? 0)
  const selectedApplicationPolicyStatus = computed(() => welfare.applicationPolicyStatus(applicationForm.type, {
    userId: welfare.currentUser.value?.id,
    title: applicationForm.title,
    description: applicationForm.description,
  }))
  const resourceApplicationPolicyStatus = computed(() => welfare.applicationPolicyStatus('resource', {
    userId: welfare.currentUser.value?.id,
    title: resourceApplicationForm.title,
    description: resourceApplicationForm.reason || resourceApplicationForm.businessBackground,
  }))

  function syncProfileForm() {
    if (!welfare.currentUser.value)
      return

    profileForm.displayName = welfare.currentUser.value.profile.displayName
    profileForm.email = welfare.currentUser.value.profile.email
    profileForm.bio = welfare.currentUser.value.profile.bio ?? ''
    profileForm.githubUsername = welfare.currentUser.value.profile.githubUsername ?? ''
    profileForm.selectedRepo = welfare.currentUser.value.profile.selectedRepo ?? ''
    applicationForm.githubRepo = welfare.currentUser.value.profile.githubAuthorized ? profileForm.selectedRepo : ''
  }

  watch(welfare.currentUser, syncProfileForm, { immediate: true })
  watch(() => profileForm.githubUsername, () => {
    if (!repoOptions.value.includes(profileForm.selectedRepo))
      profileForm.selectedRepo = repoOptions.value[0] ?? ''
  })
  watch(() => profileForm.selectedRepo, (repo) => {
    applicationForm.githubRepo = repo
  })
  watch(() => applicationForm.type, (type) => {
    if (type === 'code') {
      const model = selectedLlmApiModel.value
      applicationForm.title = 'LLMApi 额度申请'
      applicationForm.description = '<p>请说明需要使用 LLMApi 的项目、预计用途、模型选择、仓库上下文和希望获得的额度。</p>'
      applicationForm.llmApiBudgetUsd = model.defaultBudgetUsd
      applicationForm.llmApiCustomRpmLimit = model.rpmLimit
      applicationForm.llmApiCustomTpmLimit = model.tpmLimit
    }
    if (type === 'image') {
      applicationForm.title = '图片公益物料支持'
      applicationForm.description = '<p>请描述公益图片物料的用途、风格和必要约束。</p>'
    }
    if (type === 'pro') {
      applicationForm.title = '公益项目架构与实现支持'
      applicationForm.description = '<p>希望获得面向校园公益项目的完整技术建议、代码审阅或架构答复。</p>'
    }
    if (type === 'resource') {
      applicationForm.title = '资源申请'
      applicationForm.description = '<p>请按资源类型填写申请材料，并在提交前确认自动合并的条款。</p>'
    }
    applicationForm.waiveRejectionReviewFee = false
    resetApplicationSecurity()
  })
  watch(() => studentForm.educationEmail, () => {
    educationEmailVerificationForm.code = ''
    educationEmailVerificationForm.challengeId = ''
    educationEmailVerificationForm.subject = ''
    educationEmailVerificationForm.body = ''
    educationEmailVerificationForm.mailto = ''
    educationEmailVerificationForm.sentTo = ''
    educationEmailVerificationForm.expiresAt = ''
    educationEmailVerificationForm.verified = false
    educationEmailVerificationForm.message = ''
  })

  function statusText(status: string) {
    const map: Record<string, string> = {
      reserved: '已提交',
      pending_review: '待审核',
      needs_supplement: '待补充材料',
      processing: '处理中',
      answered: '已答复',
      completed: '已结束',
      closed: '已关闭',
      rejected: '已退回',
      submitted: '已提交',
      in_review: '资源审批中',
      approved: '已通过',
      partial_approved: '部分通过',
      cancelled: '已取消',
      draft: '草稿',
      pending: '待审核',
    }
    return map[status] ?? status
  }

  function statusTone(status: string) {
    if (['completed', 'closed', 'approved'].includes(status))
      return 'success'
    if (status === 'answered')
      return 'info'
    if (status === 'partial_approved')
      return 'info'
    if (['pending_review', 'needs_supplement', 'processing', 'pending', 'submitted', 'in_review', 'draft'].includes(status))
      return 'warning'
    if (['rejected', 'cancelled'].includes(status))
      return 'danger'
    return 'info'
  }

  function typeIcon(type: RequestKind) {
    if (type === 'resource')
      return 'i-carbon-assembly-cluster'
    return type === 'code' ? 'i-carbon-code' : type === 'image' ? 'i-carbon-image' : 'i-carbon-star'
  }

  function resetApplicationFiles() {
    applicationFiles.value = []
  }

  function resetApplicationSecurity() {
    applicationSecurityForm.powNonce = ''
    applicationSecurityForm.powStatus = 'idle'
    applicationSecurityForm.turnstileToken = ''
    applicationSecurityForm.turnstileVerified = false
    applicationSecurityForm.message = ''
  }

  function setApplicationTurnstileToken(token: string) {
    applicationSecurityForm.turnstileToken = token
    applicationSecurityForm.turnstileVerified = false
  }

  async function prepareApplicationSecurity(input: { type: RequestKind, title: string, description: string }) {
    const user = welfare.currentUser.value
    if (!user)
      throw new Error('请先登录')

    const policy = welfare.state.applicationPolicy
    const proof: { powNonce?: string, turnstileVerified?: boolean } = {}

    if (policy.powEnabled) {
      applicationSecurityForm.powStatus = 'computing'
      applicationSecurityForm.message = '正在计算提交 PoW...'
      const challenge = applicationPowChallenge({
        userId: user.id,
        type: input.type,
        title: input.title,
        description: input.description,
      })
      proof.powNonce = solveApplicationPow(challenge, policy.powDifficulty)
      applicationSecurityForm.powNonce = proof.powNonce
      applicationSecurityForm.powStatus = 'ready'
    }

    if (policy.turnstileEnabled) {
      if (!applicationSecurityForm.turnstileToken)
        throw new Error('请先完成人机验证')

      applicationSecurityForm.message = '正在校验 Turnstile...'
      await verifyTurnstileToken(user.id, applicationSecurityForm.turnstileToken)
      applicationSecurityForm.turnstileVerified = true
      proof.turnstileVerified = true
    }
    else {
      proof.turnstileVerified = true
    }

    applicationSecurityForm.message = policy.powEnabled || policy.turnstileEnabled ? '提交安全校验已完成' : ''
    return proof
  }

  function defaultLlmApiPayload() {
    const model = resolveLlmApiModel(LLM_API_DEFAULT_MODEL_KEY, aiConfigForm.llmApiModels)
    return {
      model: model.key,
      modelName: model.name,
      budgetLimit: model.defaultBudgetUsd,
      rpmLimit: model.rpmLimit,
      tpmLimit: model.tpmLimit,
      defaultRpmLimit: model.rpmLimit,
      defaultTpmLimit: model.tpmLimit,
      rateLimitMode: 'default',
      duration: RESOURCE_DEFAULT_DURATION,
      usageScenario: '',
      uploadsUserData: false,
      uploadUserData: false,
      containsSensitiveInfo: false,
      containsPrivacy: false,
      logRetention: 0,
    }
  }

  function defaultResourcePayload(resourceType: ResourceType): Record<string, any> {
    if (resourceType === 'database') {
      return {
        name: '',
        environment: 'dev',
        permission: 'readonly',
        sensitiveData: false,
        reason: '',
        operationScope: '',
        duration: RESOURCE_DEFAULT_DURATION,
      }
    }
    if (resourceType === 'llm_api_quota')
      return defaultLlmApiPayload()
    return {
      specification: '',
      quantity: 1,
      environment: 'dev',
      project: resourceApplicationForm.projectId,
      costCenter: resourceApplicationForm.costCenter,
      owner: resourceApplicationForm.ownerId,
      duration: RESOURCE_DEFAULT_DURATION,
      accessScope: '',
      purpose: '',
    }
  }

  function addResourceApplicationItem(resourceType: ResourceType) {
    const config = RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === resourceType)
    if (!config)
      throw new Error('资源类型不存在')
    if (!resourceApplicationForm.selectedResourceTypes.includes(resourceType))
      resourceApplicationForm.selectedResourceTypes.push(resourceType)

    const payload: Record<string, any> = defaultResourcePayload(resourceType)
    resourceApplicationItems.value.push({
      id: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      resourceType,
      resourceSubtype: config.subtypes[0],
      payload,
      requestedPermission: typeof payload.permission === 'string' ? payload.permission : undefined,
      requestedQuota: resourceType === 'llm_api_quota' ? `$${payload.budgetLimit}` : undefined,
      duration: typeof payload.duration === 'string' ? payload.duration : undefined,
    })
  }

  function removeResourceApplicationItem(id: string) {
    resourceApplicationItems.value = resourceApplicationItems.value.filter(item => item.id !== id)
  }

  function ensureSelectedResourceItems() {
    for (const resourceType of resourceApplicationForm.selectedResourceTypes) {
      if (!resourceApplicationItems.value.some(item => item.resourceType === resourceType))
        addResourceApplicationItem(resourceType)
    }
    resourceApplicationItems.value = resourceApplicationItems.value.filter(item => resourceApplicationForm.selectedResourceTypes.includes(item.resourceType))
  }

  function syncResourceAcceptedTerms() {
    const required = selectedResourceTerms.value.map(term => term.id)
    resourceApplicationForm.acceptedTermIds = resourceApplicationForm.acceptedTermIds.filter(id => required.includes(id))
  }

  function resetResourceApplicationForm() {
    resourceApplicationForm.title = '资源申请'
    resourceApplicationForm.departmentId = ''
    resourceApplicationForm.projectId = ''
    resourceApplicationForm.reason = ''
    resourceApplicationForm.businessBackground = ''
    resourceApplicationForm.urgency = 'normal'
    resourceApplicationForm.expectedEffectiveAt = ''
    resourceApplicationForm.costCenter = ''
    resourceApplicationForm.ownerId = welfare.currentUser.value?.id ?? ''
    resourceApplicationForm.duration = RESOURCE_DEFAULT_DURATION
    resourceApplicationForm.selectedResourceTypes = ['database']
    resourceApplicationForm.acceptedTermIds = []
    resourceApplicationForm.selectedCouponId = ''
    resourceApplicationItems.value = []
    addResourceApplicationItem('database')
  }

  async function submitResourceApplication(saveAsDraft = false) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    ensureSelectedResourceItems()
    if (!saveAsDraft && resourceApplicationForm.acceptedTermIds.length !== selectedResourceTerms.value.length)
      throw new Error('请确认所有自动合并的条款')

    const security = saveAsDraft
      ? {}
      : await prepareApplicationSecurity({
          type: 'resource',
          title: resourceApplicationForm.title,
          description: resourceApplicationForm.reason || resourceApplicationForm.businessBackground,
        })

    welfare.submitResourceApplication({
      title: resourceApplicationForm.title,
      departmentId: resourceApplicationForm.departmentId,
      projectId: resourceApplicationForm.projectId,
      reason: resourceApplicationForm.reason,
      businessBackground: resourceApplicationForm.reason,
      urgency: resourceApplicationForm.urgency,
      expectedEffectiveAt: resourceApplicationForm.expectedEffectiveAt,
      costCenter: resourceApplicationForm.costCenter,
      ownerId: resourceApplicationForm.ownerId || welfare.currentUser.value.id,
      duration: resourceApplicationForm.duration,
      selectedResourceTypes: resourceApplicationForm.selectedResourceTypes,
      resourceItems: resourceApplicationItems.value,
      acceptedTermIds: resourceApplicationForm.acceptedTermIds,
      couponId: saveAsDraft ? undefined : resourceApplicationForm.selectedCouponId || undefined,
      attachments: applicationFiles.value,
      saveAsDraft,
      ...security,
    })
    await saveWelfareState(welfare.state)
    await welfare.reloadWelfareState()
  }

  function resourceReviewDraftFor(itemId: string) {
    resourceReviewDrafts[itemId] ??= {
      status: 'approved',
      note: '',
      approvedPayloadText: '{}',
    }
    return resourceReviewDrafts[itemId]
  }

  function approveResourceItem(applicationId: string, itemId: string) {
    const draft = resourceReviewDraftFor(itemId)
    let approvedPayload: Record<string, unknown> | undefined
    if (draft.status === 'adjusted_approved') {
      try {
        approvedPayload = JSON.parse(draft.approvedPayloadText || '{}') as Record<string, any>
      }
      catch {
        throw new Error('调整后通过的批准内容必须是合法 JSON')
      }
    }
    welfare.reviewApplicationItem({
      applicationId,
      itemId,
      status: draft.status,
      approvedPayload,
      rejectReason: draft.note,
    })
    delete resourceReviewDrafts[itemId]
  }

  function completeResourceProvision(applicationId: string, itemId: string) {
    welfare.completeResourceProvision({
      applicationId,
      itemId,
      note: resourceProvisionDrafts[itemId],
    })
    delete resourceProvisionDrafts[itemId]
  }

  watch(() => resourceApplicationForm.selectedResourceTypes.slice(), () => {
    ensureSelectedResourceItems()
    syncResourceAcceptedTerms()
  }, { immediate: true })

  function resetStudentFiles() {
    studentFiles.value = []
  }

  function applyEducationEmailChallenge(challenge: ReturnType<typeof welfare.createEducationEmailChallenge>) {
    educationEmailVerificationForm.challengeId = challenge.id
    educationEmailVerificationForm.code = challenge.code
    educationEmailVerificationForm.subject = challenge.subject
    educationEmailVerificationForm.body = challenge.body
    educationEmailVerificationForm.mailto = challenge.mailto
    educationEmailVerificationForm.sentTo = challenge.email
    educationEmailVerificationForm.expiresAt = challenge.expiresAt
    educationEmailVerificationForm.verified = false
    educationEmailVerificationForm.message = `请使用该教育邮箱向 ${EDUCATION_EMAIL_REVIEW_INBOX} 发送邮件，管理员会人工复核`
  }

  async function generateEducationEmailChallenge() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    educationEmailVerificationForm.loading = true
    educationEmailVerificationForm.message = ''
    try {
      const challenge = welfare.createEducationEmailChallenge(studentForm.educationEmail, studentForm.realName)
      applyEducationEmailChallenge(challenge)
      await saveWelfareState(welfare.state)
    }
    finally {
      educationEmailVerificationForm.loading = false
    }
  }

  async function ensureEducationEmailChallenge() {
    if (educationEmailVerificationForm.challengeId && educationEmailVerificationForm.body)
      return

    await generateEducationEmailChallenge()
  }

  async function copyEducationEmailTemplate() {
    await ensureEducationEmailChallenge()
    const text = `${educationEmailVerificationForm.subject}\n\n${educationEmailVerificationForm.body}`
    if (!globalThis.navigator?.clipboard)
      throw new Error('当前浏览器不支持剪贴板复制')
    await globalThis.navigator.clipboard.writeText(text)
    educationEmailVerificationForm.message = '邮件模板已复制，请使用教育邮箱发送到平台收件箱'
  }

  async function openEducationEmailClient() {
    await ensureEducationEmailChallenge()
    globalThis.location.href = educationEmailVerificationForm.mailto
    educationEmailVerificationForm.message = '已打开系统邮件客户端，请确认发件邮箱为你的教育邮箱'
  }

  async function persistApplicationPolicy() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    applicationPolicyConfigForm.loading = true
    applicationPolicyConfigForm.message = ''
    try {
      welfare.state.applicationPolicy = normalizeApplicationPolicy(welfare.state.applicationPolicy)
      await saveWelfareState(welfare.state)
      applicationPolicyConfigForm.message = '申请策略配置已保存'
    }
    finally {
      applicationPolicyConfigForm.loading = false
    }
  }

  function crowdReviewDraftFor(applicationId: string) {
    crowdReviewDrafts[applicationId] ??= {
      decision: 'needs_admin',
      note: '',
    }
    return crowdReviewDrafts[applicationId]
  }

  function submitCrowdReviewDraft(applicationId: string) {
    const draft = crowdReviewDraftFor(applicationId)
    const review = welfare.submitCrowdReview('pro_application', applicationId, draft.decision, draft.note)
    delete crowdReviewDrafts[applicationId]
    return review
  }

  function rejectApplicationWithOptions(applicationId: string, reason: string, options: RejectApplicationOptions = {}) {
    welfare.rejectApplication(applicationId, reason, options)
    delete rejectFraudulentDrafts[applicationId]
  }

  function completeApplication(applicationId: string) {
    welfare.completeApplication(applicationId)
  }

  function requestApplicationSupplement(applicationId: string, content: string) {
    welfare.requestApplicationSupplement(applicationId, content)
  }

  function submitApplicationSupplement(applicationId: string, content: string, attachments: UploadLikeFile[] = []) {
    welfare.submitApplicationSupplement(applicationId, content, attachments)
  }

  function addApplicationMessage(applicationId: string, type: ApplicationMessageType, content: string, attachments: UploadLikeFile[] = []) {
    welfare.addApplicationMessage(applicationId, type, content, attachments)
  }

  function submitApplicationResult(applicationId: string, content: string, attachments: UploadLikeFile[] = []) {
    welfare.submitApplicationResult(applicationId, content, attachments)
  }

  function applyRechargeConfig(config: RechargeConfigView) {
    rechargeConfigForm.enabled = config.enabled
    rechargeConfigForm.gatewayBaseUrl = config.gatewayBaseUrl
    rechargeConfigForm.pid = config.pid
    rechargeConfigForm.key = ''
    rechargeConfigForm.keyMasked = config.keyMasked
    rechargeConfigForm.pointsPerLdc = config.pointsPerLdc
    rechargeConfigForm.configured = config.configured
  }

  function applyGitHubAppConfig(config: GitHubAppConfigView) {
    githubAppConfigForm.enabled = config.enabled
    githubAppConfigForm.appName = config.appName
    githubAppConfigForm.appSlug = config.appSlug
    githubAppConfigForm.clientId = config.clientId
    githubAppConfigForm.clientSecret = ''
    githubAppConfigForm.clientSecretMasked = config.clientSecretMasked
    githubAppConfigForm.callbackUrl = config.callbackUrl
    githubAppConfigForm.authorizeUrl = config.authorizeUrl
    githubAppConfigForm.tokenUrl = config.tokenUrl
    githubAppConfigForm.apiBaseUrl = config.apiBaseUrl
    githubAppConfigForm.scopes = config.scopes
    githubAppConfigForm.configured = config.configured
  }

  async function refreshRechargeConfig() {
    rechargeConfigForm.loading = true
    try {
      const config = await loadRechargeConfig()
      applyRechargeConfig(config)
    }
    finally {
      rechargeConfigForm.loading = false
    }
  }

  async function persistRechargeConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    rechargeConfigForm.loading = true
    rechargeConfigForm.message = ''
    rechargeConfigForm.envPreview = null
    try {
      const result = await saveRechargeConfig({
        enabled: rechargeConfigForm.enabled,
        gatewayBaseUrl: rechargeConfigForm.gatewayBaseUrl,
        pid: rechargeConfigForm.pid,
        key: rechargeConfigForm.key,
        pointsPerLdc: rechargeConfigForm.pointsPerLdc,
      }, welfare.currentUser.value.id)
      rechargeConfigForm.message = result.message
      rechargeConfigForm.envPreview = result.env
    }
    finally {
      rechargeConfigForm.loading = false
    }
  }

  async function refreshGitHubAppConfig() {
    githubAppConfigForm.loading = true
    try {
      const config = await loadGitHubAppConfig()
      applyGitHubAppConfig(config)
    }
    finally {
      githubAppConfigForm.loading = false
    }
  }

  async function persistGitHubAppConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    githubAppConfigForm.loading = true
    githubAppConfigForm.message = ''
    githubAppConfigForm.envPreview = null
    try {
      const result = await saveGitHubAppConfig({
        enabled: githubAppConfigForm.enabled,
        appName: githubAppConfigForm.appName,
        appSlug: githubAppConfigForm.appSlug,
        clientId: githubAppConfigForm.clientId,
        clientSecret: githubAppConfigForm.clientSecret,
        callbackUrl: githubAppConfigForm.callbackUrl,
        authorizeUrl: githubAppConfigForm.authorizeUrl,
        tokenUrl: githubAppConfigForm.tokenUrl,
        apiBaseUrl: githubAppConfigForm.apiBaseUrl,
        scopes: githubAppConfigForm.scopes,
      }, welfare.currentUser.value.id)
      githubAppConfigForm.message = result.message
      githubAppConfigForm.envPreview = result.env
    }
    finally {
      githubAppConfigForm.loading = false
    }
  }

  async function startGitHubAuthorization() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录后再授权 GitHub')

    githubAuthorizationForm.loading = true
    githubAuthorizationForm.message = '正在创建 GitHub App 授权链接...'
    try {
      const result = await createGitHubAuthorization('/dashboard/open-source', welfare.currentUser.value.id, 'connect')
      githubAuthorizationForm.message = '即将跳转到 GitHub 授权页...'
      globalThis.location.href = result.authorizeUrl
    }
    finally {
      githubAuthorizationForm.loading = false
    }
  }

  async function startGitHubLogin(redirect = '/dashboard/apply') {
    githubAuthorizationForm.loading = true
    githubAuthorizationForm.message = '正在创建 GitHub App 登录链接...'
    try {
      const result = await createGitHubAuthorization(redirect, undefined, 'login')
      githubAuthorizationForm.message = '即将跳转到 GitHub 授权页...'
      globalThis.location.href = result.authorizeUrl
    }
    finally {
      githubAuthorizationForm.loading = false
    }
  }

  function applyOAuthProviderConfigs(providers: OAuthProviderConfigView[]) {
    oauthProviderConfigs.value = providers.map(provider => ({
      ...provider,
      clientSecret: '',
    }))
  }

  async function refreshOAuthProviders() {
    const result = await loadOAuthProviders()
    publicOAuthProviders.value = result.providers
  }

  async function refreshOAuthProviderConfigs() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    oauthConfigForm.loading = true
    try {
      const result = await loadOAuthProviderConfigs(welfare.currentUser.value.id)
      applyOAuthProviderConfigs(result.providers)
    }
    finally {
      oauthConfigForm.loading = false
    }
  }

  function addOAuthProviderConfig() {
    oauthProviderConfigs.value.push({
      id: `provider-${oauthProviderConfigs.value.length + 1}`,
      name: 'OIDC 登录',
      enabled: true,
      configured: false,
      clientId: '',
      clientSecret: '',
      clientSecretMasked: '',
      callbackUrl: typeof globalThis.location !== 'undefined' ? `${globalThis.location.origin}/api/oauth/callback` : '/api/oauth/callback',
      authorizeUrl: '',
      tokenUrl: '',
      userInfoUrl: '',
      issuerUrl: '',
      scopes: 'openid profile email',
    })
  }

  function removeOAuthProviderConfig(id: string) {
    oauthProviderConfigs.value = oauthProviderConfigs.value.filter(provider => provider.id !== id)
  }

  async function persistOAuthProviderConfigs() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    oauthConfigForm.loading = true
    oauthConfigForm.message = ''
    try {
      const result = await saveOAuthProviderConfigs(oauthProviderConfigs.value.map(provider => ({
        id: provider.id,
        enabled: provider.enabled,
        name: provider.name,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        callbackUrl: provider.callbackUrl,
        authorizeUrl: provider.authorizeUrl,
        tokenUrl: provider.tokenUrl,
        userInfoUrl: provider.userInfoUrl,
        issuerUrl: provider.issuerUrl,
        scopes: provider.scopes,
      })), welfare.currentUser.value.id)
      applyOAuthProviderConfigs(result.providers)
      oauthConfigForm.message = 'OAuth/OIDC 登录源配置已保存'
      await refreshOAuthProviders()
    }
    finally {
      oauthConfigForm.loading = false
    }
  }

  async function startOAuthLogin(providerId: string, redirect = '/dashboard/apply') {
    oauthLoginForm.loadingProviderId = providerId
    oauthLoginForm.message = '正在创建 OAuth 登录链接...'
    try {
      const result = await createOAuthAuthorization(providerId, redirect)
      oauthLoginForm.message = '即将跳转到授权页...'
      globalThis.location.href = result.authorizeUrl
    }
    finally {
      oauthLoginForm.loadingProviderId = ''
    }
  }

  function applyAiConfig(config: Awaited<ReturnType<typeof loadAiConfig>>) {
    aiConfigForm.enabled = config.enabled
    aiConfigForm.baseUrl = config.baseUrl
    aiConfigForm.imageModel = config.imageModel
    aiConfigForm.reviewModel = config.reviewModel
    aiConfigForm.apiKey = ''
    aiConfigForm.apiKeyMasked = config.apiKeyMasked
    aiConfigForm.newapiKey = ''
    aiConfigForm.newapiKeyMasked = config.newapiKeyMasked
    aiConfigForm.newapiManagementBaseUrl = config.newapiManagementBaseUrl
    aiConfigForm.newapiUserId = config.newapiUserId
    aiConfigForm.temporaryKeyTtlMinutes = config.temporaryKeyTtlMinutes
    aiConfigForm.temporaryKeyQuota = config.temporaryKeyQuota
    aiConfigForm.llmApiModels = normalizeLlmApiModelPricings(config.llmApiModels)
    aiConfigForm.configured = config.configured
    aiConfigForm.envPreview = config.env
  }

  async function refreshAiConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    aiConfigForm.loading = true
    try {
      applyAiConfig(await loadAiConfig(welfare.currentUser.value.id))
    }
    finally {
      aiConfigForm.loading = false
    }
  }

  async function persistAiConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    aiConfigForm.loading = true
    aiConfigForm.message = ''
    try {
      const result = await saveAiConfig(welfare.currentUser.value.id, {
        enabled: aiConfigForm.enabled,
        baseUrl: aiConfigForm.baseUrl,
        imageModel: aiConfigForm.imageModel,
        reviewModel: aiConfigForm.reviewModel,
        apiKey: aiConfigForm.apiKey,
        newapiKey: aiConfigForm.newapiKey,
        newapiManagementBaseUrl: aiConfigForm.newapiManagementBaseUrl,
        newapiUserId: aiConfigForm.newapiUserId,
        temporaryKeyTtlMinutes: aiConfigForm.temporaryKeyTtlMinutes,
        temporaryKeyQuota: aiConfigForm.temporaryKeyQuota,
        llmApiModels: aiConfigForm.llmApiModels,
      })
      applyAiConfig(result)
      aiConfigForm.message = 'AI Provider 配置已保存'
    }
    finally {
      aiConfigForm.loading = false
    }
  }

  function applySub2ApiConfig(config: Awaited<ReturnType<typeof loadSub2ApiConfig>>) {
    sub2ApiConfigForm.enabled = config.enabled
    sub2ApiConfigForm.baseUrl = config.baseUrl
    sub2ApiConfigForm.adminApiKey = ''
    sub2ApiConfigForm.adminApiKeyMasked = config.adminApiKeyMasked
    sub2ApiConfigForm.databaseUrl = ''
    sub2ApiConfigForm.databaseUrlMasked = config.databaseUrlMasked
    sub2ApiConfigForm.defaultGroupId = config.defaultGroupId ?? ''
    sub2ApiConfigForm.defaultQuotaUsd = config.defaultQuotaUsd
    sub2ApiConfigForm.defaultExpiresInDays = config.defaultExpiresInDays
    sub2ApiConfigForm.defaultRateLimit5h = config.defaultRateLimit5h
    sub2ApiConfigForm.defaultRateLimit1d = config.defaultRateLimit1d
    sub2ApiConfigForm.defaultRateLimit7d = config.defaultRateLimit7d
    sub2ApiConfigForm.configured = config.configured

    sub2ApiKeyForm.quotaUsd = config.defaultQuotaUsd
    sub2ApiKeyForm.expiresInDays = config.defaultExpiresInDays
    sub2ApiKeyForm.groupId = config.defaultGroupId ?? ''
    sub2ApiKeyForm.rateLimit5h = config.defaultRateLimit5h
    sub2ApiKeyForm.rateLimit1d = config.defaultRateLimit1d
    sub2ApiKeyForm.rateLimit7d = config.defaultRateLimit7d
  }

  async function refreshSub2ApiConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    sub2ApiConfigForm.loading = true
    try {
      applySub2ApiConfig(await loadSub2ApiConfig(welfare.currentUser.value.id))
    }
    finally {
      sub2ApiConfigForm.loading = false
    }
  }

  async function persistSub2ApiConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    sub2ApiConfigForm.loading = true
    sub2ApiConfigForm.message = ''
    try {
      const result = await saveSub2ApiConfig(welfare.currentUser.value.id, {
        enabled: sub2ApiConfigForm.enabled,
        baseUrl: sub2ApiConfigForm.baseUrl,
        adminApiKey: sub2ApiConfigForm.adminApiKey,
        databaseUrl: sub2ApiConfigForm.databaseUrl,
        defaultGroupId: sub2ApiConfigForm.defaultGroupId,
        defaultQuotaUsd: Number(sub2ApiConfigForm.defaultQuotaUsd),
        defaultExpiresInDays: Number(sub2ApiConfigForm.defaultExpiresInDays),
        defaultRateLimit5h: Number(sub2ApiConfigForm.defaultRateLimit5h),
        defaultRateLimit1d: Number(sub2ApiConfigForm.defaultRateLimit1d),
        defaultRateLimit7d: Number(sub2ApiConfigForm.defaultRateLimit7d),
      })
      applySub2ApiConfig(result)
      sub2ApiConfigForm.message = 'Sub2API 配置已保存'
    }
    finally {
      sub2ApiConfigForm.loading = false
    }
  }

  async function verifySub2ApiConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    sub2ApiConfigForm.testing = true
    sub2ApiConfigForm.message = ''
    try {
      await testSub2ApiConfig(welfare.currentUser.value.id)
      sub2ApiConfigForm.message = 'Sub2API 连接测试通过'
    }
    finally {
      sub2ApiConfigForm.testing = false
    }
  }

  async function refreshSub2ApiKeys() {
    if (!welfare.currentUser.value)
      return

    sub2ApiKeyForm.loading = true
    try {
      const result = await loadSub2ApiKeys(welfare.currentUser.value.id)
      sub2ApiKeys.value = result.keys
      applySub2ApiConfig(result.config)
    }
    finally {
      sub2ApiKeyForm.loading = false
    }
  }

  async function generateSub2ApiKey() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    generatedSub2ApiKey.value = ''
    sub2ApiKeyForm.loading = true
    sub2ApiKeyForm.message = ''
    try {
      const result = await createSub2ApiKey(welfare.currentUser.value.id, {
        name: sub2ApiKeyForm.name,
        quotaUsd: Number(sub2ApiKeyForm.quotaUsd),
        expiresInDays: Number(sub2ApiKeyForm.expiresInDays),
        groupId: sub2ApiKeyForm.groupId,
        rateLimit5h: Number(sub2ApiKeyForm.rateLimit5h),
        rateLimit1d: Number(sub2ApiKeyForm.rateLimit1d),
        rateLimit7d: Number(sub2ApiKeyForm.rateLimit7d),
      })
      generatedSub2ApiKey.value = result.key
      sub2ApiKeyForm.message = 'Sub2API Key 已生成'
      await refreshSub2ApiKeys()
    }
    finally {
      sub2ApiKeyForm.loading = false
    }
  }

  async function revokeSub2ApiKey(keyId: string) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    sub2ApiKeyForm.loading = true
    sub2ApiKeyForm.message = ''
    try {
      await deleteSub2ApiKey(welfare.currentUser.value.id, keyId)
      sub2ApiKeyForm.message = 'Sub2API Key 已删除'
      await refreshSub2ApiKeys()
    }
    finally {
      sub2ApiKeyForm.loading = false
    }
  }

  function applyTemporaryAiKeyConfig(config: Awaited<ReturnType<typeof loadTemporaryAiKeys>>['config']) {
    temporaryAiKeyForm.configured = config.enabled && config.configured
    temporaryAiKeyForm.ttlMinutes = config.temporaryKeyTtlMinutes
    temporaryAiKeyForm.quota = config.temporaryKeyQuota
  }

  async function refreshTemporaryAiKeys() {
    if (!welfare.currentUser.value)
      return

    temporaryAiKeyForm.loading = true
    try {
      const result = await loadTemporaryAiKeys(welfare.currentUser.value.id)
      temporaryAiKeys.value = result.keys
      applyTemporaryAiKeyConfig(result.config)
    }
    finally {
      temporaryAiKeyForm.loading = false
    }
  }

  async function generateTemporaryAiKey() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    generatedTemporaryAiKey.value = ''
    temporaryAiKey.value = ''
    temporaryAiKeyExpiresAt.value = ''
    temporaryAiKeyForm.loading = true
    temporaryAiKeyForm.message = ''
    try {
      const result = await createTemporaryAiKey(welfare.currentUser.value.id, {
        name: temporaryAiKeyForm.name,
        ttlMinutes: Number(temporaryAiKeyForm.ttlMinutes),
        quota: Number(temporaryAiKeyForm.quota),
      })
      generatedTemporaryAiKey.value = result.key
      temporaryAiKey.value = result.key
      temporaryAiKeyExpiresAt.value = result.expiresAt
      temporaryAiKeyForm.message = 'NewAPI Key 已生成'
      await refreshTemporaryAiKeys()
    }
    finally {
      temporaryAiKeyForm.loading = false
    }
  }

  async function revokeTemporaryAiKey(keyId: string) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    temporaryAiKeyForm.loading = true
    temporaryAiKeyForm.message = ''
    try {
      await deleteTemporaryAiKey(welfare.currentUser.value.id, keyId)
      temporaryAiKeyForm.message = 'NewAPI Key 已删除'
      await refreshTemporaryAiKeys()
    }
    finally {
      temporaryAiKeyForm.loading = false
    }
  }

  function applyNotificationProviderConfig(config: Awaited<ReturnType<typeof loadNotificationProviderConfig>>) {
    notificationProviderConfigForm.resendApiKey = ''
    notificationProviderConfigForm.resendApiKeyMasked = config.resendApiKeyMasked
    notificationProviderConfigForm.resendFromEmail = config.resendFromEmail
    notificationProviderConfigForm.vapidPublicKey = config.vapidPublicKey
    notificationProviderConfigForm.vapidPrivateKey = ''
    notificationProviderConfigForm.vapidPrivateKeyMasked = config.vapidPrivateKeyMasked
    notificationProviderConfigForm.vapidSubject = config.vapidSubject
    notificationProviderConfigForm.emailConfigured = config.configured.email
    notificationProviderConfigForm.pushConfigured = config.configured.push
  }

  async function refreshNotificationProviderConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    notificationProviderConfigForm.loading = true
    try {
      applyNotificationProviderConfig(await loadNotificationProviderConfig(welfare.currentUser.value.id))
    }
    finally {
      notificationProviderConfigForm.loading = false
    }
  }

  async function persistNotificationProviderConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.loading = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await saveNotificationProviderConfig(welfare.currentUser.value.id, {
        resendApiKey: notificationProviderConfigForm.resendApiKey,
        resendFromEmail: notificationProviderConfigForm.resendFromEmail,
        vapidPublicKey: notificationProviderConfigForm.vapidPublicKey,
        vapidPrivateKey: notificationProviderConfigForm.vapidPrivateKey,
        vapidSubject: notificationProviderConfigForm.vapidSubject,
      })
      applyNotificationProviderConfig(result)
      notificationProviderConfigForm.message = '通知供应商配置已保存'
    }
    finally {
      notificationProviderConfigForm.loading = false
    }
  }

  async function submitImageGenerationApplication(applicationId?: string) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    const security = applicationId
      ? {}
      : await prepareApplicationSecurity({
          type: 'image',
          title: applicationForm.title,
          description: applicationForm.description,
        })
    const application = applicationId
      ? welfare.state.applications.find(item => item.id === applicationId)
      : welfare.submitApplication({
          type: 'image',
          title: applicationForm.title,
          description: applicationForm.description,
          githubRepo: applicationForm.githubRepo,
          attachments: applicationFiles.value,
          extendStorage: applicationForm.extendStorage,
          expediteProcessing: applicationForm.expediteProcessing,
          waiveRejectionReviewFee: applicationForm.waiveRejectionReviewFee,
          llmApiModelKey: applicationForm.llmApiModelKey,
          llmApiBudgetUsd: applicationForm.llmApiBudgetUsd,
          llmApiCustomRpmLimit: applicationForm.llmApiCustomRpmLimit,
          llmApiCustomTpmLimit: applicationForm.llmApiCustomTpmLimit,
          ...security,
        })
    if (!application || application.type !== 'image')
      throw new Error('图片申请不存在')

    await saveWelfareState(welfare.state)
    try {
      await createImageJob(welfare.currentUser.value.id, application.description, application.id)
      resetApplicationFiles()
    }
    finally {
      await welfare.reloadWelfareState()
    }
  }

  async function submitApplicationWithAiReview() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    const security = await prepareApplicationSecurity({
      type: applicationForm.type,
      title: applicationForm.title,
      description: applicationForm.description,
    })
    const application = welfare.submitApplication({
      type: applicationForm.type,
      title: applicationForm.title,
      description: applicationForm.description,
      githubRepo: applicationForm.githubRepo,
      attachments: applicationFiles.value,
      extendStorage: applicationForm.extendStorage,
      expediteProcessing: applicationForm.expediteProcessing,
      waiveRejectionReviewFee: applicationForm.waiveRejectionReviewFee,
      llmApiModelKey: applicationForm.llmApiModelKey,
      llmApiBudgetUsd: applicationForm.llmApiBudgetUsd,
      llmApiCustomRpmLimit: applicationForm.llmApiCustomRpmLimit,
      llmApiCustomTpmLimit: applicationForm.llmApiCustomTpmLimit,
      ...security,
    })
    await saveWelfareState(welfare.state)
    try {
      await createApplicationReview(welfare.currentUser.value.id, application.id)
      resetApplicationFiles()
    }
    finally {
      await welfare.reloadWelfareState()
    }
  }

  function applyNotificationSettings(settings: Awaited<ReturnType<typeof loadNotificationSettings>>) {
    notificationSettingsForm.emailEnabled = settings.emailEnabled
    notificationSettingsForm.emailAddress = settings.emailAddress
    notificationSettingsForm.feishuEnabled = settings.feishuEnabled
    notificationSettingsForm.feishuWebhookMasked = settings.feishuWebhookMasked
    notificationSettingsForm.feishuWebhookUrl = ''
    notificationSettingsForm.browserPushEnabled = settings.browserPushEnabled
    notificationSettingsForm.pushSubscriptionCount = settings.pushSubscriptionCount
  }

  async function refreshNotifications() {
    if (!welfare.currentUser.value)
      return

    notificationsLoading.value = true
    try {
      const result = await loadNotifications(welfare.currentUser.value.id)
      notificationList.value = result.notifications
      unreadNotificationCount.value = result.unreadCount
    }
    finally {
      notificationsLoading.value = false
    }
  }

  async function refreshNotificationSettings() {
    if (!welfare.currentUser.value)
      return

    notificationSettingsForm.loading = true
    try {
      applyNotificationSettings(await loadNotificationSettings(welfare.currentUser.value.id))
      notificationSettingsForm.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    }
    finally {
      notificationSettingsForm.loading = false
    }
  }

  async function persistNotificationSettings() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    notificationSettingsForm.loading = true
    try {
      applyNotificationSettings(await saveNotificationSettings(welfare.currentUser.value.id, {
        emailEnabled: notificationSettingsForm.emailEnabled,
        emailAddress: notificationSettingsForm.emailAddress,
        feishuEnabled: notificationSettingsForm.feishuEnabled,
        feishuWebhookUrl: notificationSettingsForm.feishuWebhookUrl,
        browserPushEnabled: notificationSettingsForm.browserPushEnabled,
      }))
    }
    finally {
      notificationSettingsForm.loading = false
    }
  }

  async function enableBrowserPush() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    if (!('serviceWorker' in navigator) || !('PushManager' in window))
      throw new Error('当前浏览器不支持 Push 通知')

    const pushConfig = await loadPushPublicKey()
    if (!pushConfig.configured || !pushConfig.publicKey)
      throw new Error('服务端尚未配置 VAPID Key')

    const permission = await Notification.requestPermission()
    notificationSettingsForm.permission = permission
    if (permission !== 'granted')
      throw new Error('浏览器通知权限未授权')

    const registration = await navigator.serviceWorker.register('/notification-sw.js')
    const existing = await registration.pushManager.getSubscription()
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey),
    })
    applyNotificationSettings(await savePushSubscription(
      welfare.currentUser.value.id,
      subscription.toJSON() as {
        endpoint: string
        keys: { p256dh: string, auth: string }
      },
    ))
  }

  async function readNotification(id: string) {
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    await markNotificationRead(welfare.currentUser.value.id, id)
    await refreshNotifications()
  }

  async function readAllNotifications() {
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    await markAllNotificationsRead(welfare.currentUser.value.id)
    await refreshNotifications()
  }

  async function startRecharge() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录后再充值')

    const amount = Number(rechargeForm.amount)
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error('当前积分充值仅支持正整数')

    rechargeForm.loading = true
    rechargeForm.statusMessage = '正在创建 LINUX DO Credit 充值订单...'
    try {
      const result = await createRechargeOrder(amount, welfare.currentUser.value.id)
      rechargeForm.statusMessage = '订单已创建，正在跳转到 LINUX DO Credit...'
      globalThis.location.href = result.redirectUrl
    }
    finally {
      rechargeForm.loading = false
    }
  }

  async function refreshRechargeStatus(outTradeNo: string) {
    const status = await loadRechargeStatus(outTradeNo)
    lastRechargeStatus.value = status
    return status
  }

  async function checkInToday() {
    const result = welfare.checkInToday()
    await saveWelfareState(welfare.state)
    await welfare.reloadWelfareState()
    return result
  }

  async function bindInvitationCode() {
    const result = welfare.bindInvitationCode(invitationForm.code)
    invitationForm.code = ''
    invitationForm.message = '邀请关系已绑定'
    await saveWelfareState(welfare.state)
    await welfare.reloadWelfareState()
    return result
  }

  async function vouchInvitation(bindingId: string) {
    const result = welfare.vouchInvitation(bindingId)
    invitationForm.message = '担保状态已更新'
    await saveWelfareState(welfare.state)
    await welfare.reloadWelfareState()
    return result
  }

  return {
    ...welfare,
    adminForm,
    profileForm,
    invitationForm,
    rechargeForm,
    rechargeConfigForm,
    githubAppConfigForm,
    githubAuthorizationForm,
    oauthConfigForm,
    oauthProviderConfigs,
    publicOAuthProviders,
    oauthLoginForm,
    aiConfigForm,
    sub2ApiConfigForm,
    sub2ApiKeyForm,
    sub2ApiKeys,
    generatedSub2ApiKey,
    notificationProviderConfigForm,
    temporaryAiKey,
    temporaryAiKeyExpiresAt,
    temporaryAiKeyForm,
    temporaryAiKeys,
    generatedTemporaryAiKey,
    notificationSettingsForm,
    notificationList,
    unreadNotificationCount,
    notificationsLoading,
    applicationSecurityForm,
    applicationPolicyConfigForm,
    lastRechargeStatus,
    applicationForm,
    resourceApplicationForm,
    resourceApplicationItems,
    resourceReviewDrafts,
    resourceProvisionDrafts,
    applicationFiles,
    studentForm,
    educationEmailVerificationForm,
    studentFiles,
    studentCategoryOptions,
    studentEducationLevelOptions,
    studentGradeOptions,
    studentSchoolSuggestions: STUDENT_SCHOOL_SUGGESTIONS,
    reviewDrafts,
    supplementDrafts,
    rejectFraudulentDrafts,
    crowdReviewDrafts,
    pointDrafts,
    selectedSection,
    activeAdminTab,
    adminTabItems,
    resourceTypeConfigs,
    resourceTerms: RESOURCE_TERMS,
    selectedResourceTerms,
    selectedApplicationPolicyStatus,
    resourceApplicationPolicyStatus,
    pricingSummary,
    llmApiBudgetOptions,
    llmApiReviewLimits,
    codexBudgetOptions,
    codexAccessLimits,
    enabledLlmApiModels,
    selectedLlmApiModel,
    repoOptions,
    totalApplicationBytes,
    totalStudentBytes,
    activeRequestCount,
    canCreateRequest,
    selectedCost,
    selectedPrepaidCost,
    selectedLlmApiBudgetUsd,
    selectedLlmApiRateLimitChangeCost,
    selectedLlmApiRequiresExtendedReview,
    selectedCodexBudgetUsd,
    selectedCodexRequiresExtendedReview,
    heroProgress,
    pendingCount,
    latestTransactions,
    currentUserCoupons,
    availableCurrentUserCoupons,
    currentUserDailyCheckIns,
    currentUserInviteCode,
    currentUserInvitationBinding,
    currentUserInviter,
    currentUserInvitees,
    currentUserInvitationBindDeadline,
    canBindCurrentUserInvitation,
    todayCheckIn,
    currentCheckInStreak,
    statusText,
    statusTone,
    typeIcon,
    resetApplicationSecurity,
    setApplicationTurnstileToken,
    prepareApplicationSecurity,
    resetApplicationFiles,
    addResourceApplicationItem,
    removeResourceApplicationItem,
    ensureSelectedResourceItems,
    resetResourceApplicationForm,
    submitResourceApplication,
    resourceReviewDraftFor,
    approveResourceItem,
    completeResourceProvision,
    resetStudentFiles,
    generateEducationEmailChallenge,
    copyEducationEmailTemplate,
    openEducationEmailClient,
    checkInToday,
    bindInvitationCode,
    vouchInvitation,
    persistApplicationPolicy,
    crowdReviewDraftFor,
    submitCrowdReviewDraft,
    rejectApplicationWithOptions,
    completeApplication,
    requestApplicationSupplement,
    submitApplicationSupplement,
    addApplicationMessage,
    submitApplicationResult,
    refreshRechargeConfig,
    persistRechargeConfig,
    refreshGitHubAppConfig,
    persistGitHubAppConfig,
    startGitHubAuthorization,
    startGitHubLogin,
    refreshOAuthProviders,
    refreshOAuthProviderConfigs,
    addOAuthProviderConfig,
    removeOAuthProviderConfig,
    persistOAuthProviderConfigs,
    startOAuthLogin,
    refreshAiConfig,
    persistAiConfig,
    refreshSub2ApiConfig,
    persistSub2ApiConfig,
    verifySub2ApiConfig,
    refreshSub2ApiKeys,
    generateSub2ApiKey,
    revokeSub2ApiKey,
    refreshTemporaryAiKeys,
    revokeTemporaryAiKey,
    refreshNotificationProviderConfig,
    persistNotificationProviderConfig,
    generateTemporaryAiKey,
    submitImageGenerationApplication,
    submitApplicationWithAiReview,
    refreshNotifications,
    refreshNotificationSettings,
    persistNotificationSettings,
    enableBrowserPush,
    readNotification,
    readAllNotifications,
    startRecharge,
    refreshRechargeStatus,
  }
}
