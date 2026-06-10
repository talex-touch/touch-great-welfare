import type { ProvisionApplicationRewardResult, TemporaryKeyView } from '../ai'
import type { EducationMailSyncResult } from '../education-mail'
import type { GitHubAppConfigView, SaveGitHubAppConfigResult } from '../github-app'
import type { OAuthProviderConfigView, PublicOAuthProvider } from '../oauth'
import type { RechargeConfigView, RechargeStatusResult, SaveRechargeConfigResult } from '../recharge'
import type { Sub2ApiGroupView, Sub2ApiKeyView } from '../sub2api'
import type { ApplicationMessageType, CouponDiscountType, CouponScope, CrowdReviewDecision, RejectApplicationOptions, RequestKind, ResourceApprovalStatus, ResourceLifecycleActionPayload, ResourceTermId, ResourceType, SquarePostType, StudentVerification, UserProfile, VerificationType, WelfareApplication } from '../welfare'
import type { NotificationChannel, SystemLogItem } from '~/shared/notifications'
import { computed, reactive, ref, watch } from 'vue'
import { STUDENT_SCHOOL_SUGGESTIONS } from '~/data/student-schools'
import { createApplicationReview, createImageJob, createTemporaryAiKey, deleteTemporaryAiKey, loadAiConfig, loadTemporaryAiKeys, provisionApplicationReward, saveAiConfig } from '../ai'
import { subscribeBrowserPush, unsubscribeBrowserPush } from '../browser-push'
import { loadDatabaseProvisionConfig, loadOnePanelStatus, saveDatabaseProvisionConfig, testDatabaseProvisionConfig } from '../database-provisioning'
import { loadEducationMailConfig, saveEducationMailConfig, syncEducationMailChallenges, testEducationMailConfig, verifyEducationMailChallenge } from '../education-mail'
import { createGitHubAuthorization, loadGitHubAppConfig, saveGitHubAppConfig } from '../github-app'
import {
  createAdminAnnouncement,
  createFeishuMailAuthorization,
  deletePushSubscription,
  generateVapidKeys,
  loadAdminAnnouncements,
  loadFeishuMailboxes,
  loadNotificationProviderConfig,
  loadNotifications,
  loadNotificationSettings,
  loadPushPublicKey,
  loadSystemLogs,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationProviderConfig,
  saveNotificationSettings,
  savePushSubscription,
  sendEmailTest as sendEmailTestRequest,
  sendProviderEmailTest,
} from '../notifications'
import { createOAuthAuthorization, loadOAuthProviderConfigs, loadOAuthProviders, saveOAuthProviderConfigs } from '../oauth'
import { loadPointTransactions } from '../points'
import { createRechargeOrder, loadRechargeConfig, loadRechargeStatus, saveRechargeConfig } from '../recharge'
import { createSub2ApiKey, deleteSub2ApiKey, loadSub2ApiConfig, loadSub2ApiKeys, saveSub2ApiConfig, testSub2ApiConfig } from '../sub2api'
import { verifyTurnstileToken } from '../turnstile'
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
  defaultLlmApiDuration,
  EDUCATION_EMAIL_REVIEW_INBOX,
  educationEmailAdminRecommendationLabel,
  educationEmailUserLabel,
  LLM_API_BUDGET_OPTIONS,
  LLM_API_DEFAULT_MODEL_KEY,
  LLM_API_EXTENDED_PROCESSING_HOURS,
  LLM_API_EXTENDED_REVIEW_THRESHOLD_USD,
  LLM_API_SELECTABLE_MODEL_KEYS,
  LLM_API_STANDARD_PROCESSING_HOURS,
  llmApiRequiresExtendedReview,
  MAX_ACTIVE_USER_REQUESTS,
  normalizeApplicationPolicy,
  normalizeLlmApiBudgetUsd,
  normalizeLlmApiModelPricings,
  normalizeSystemConfig,
  PRO_EXPEDITE_COST,
  PRO_EXPEDITED_PROCESSING_HOURS,
  PRO_STANDARD_PROCESSING_HOURS,
  REQUEST_COST,
  resolveSelectableLlmApiModel,
  RESOURCE_DEFAULT_DURATION,
  RESOURCE_TERMS,
  RESOURCE_TYPE_CONFIGS,
  solveApplicationPow,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
  termsForResourceTypes,
  useWelfareStore,
} from '../welfare'
import {
  addApplicationMessageAction,
  answerApplicationAction,
  bindInvitationCodeAction,
  boostSquarePostAction,
  cancelDeliveryClaimAction,
  checkInTodayAction,
  claimDeliveryApplicationAction,
  completeApplicationAction,
  completeApplicationAllocationAction,
  completeResourceProvisionAction,
  createCouponCodeAction,
  createCouponTemplateAction,
  createEducationEmailChallengeAction,
  createSquarePostAction,
  grantCouponsAction,
  redeemCouponCodeAction,
  rejectApplicationAction,
  reportSquareBoostAction,
  requestApplicationSupplementAdminAction,
  requestResourceLifecycleAction,
  reviewApplicationItemAction,
  reviewCollaborationApplicationAction,
  reviewDeliveryResultAction,
  reviewStudentVerificationAction,
  revokeUserStudentVerificationAction,
  setUserCrowdReviewerAction,
  setUserStudentVerifiedAction,
  setUserSuspendedAction,
  submitAdminStudentVerificationAction,
  submitApplicationCommand,
  submitApplicationSupplementAction,
  submitCollaborationApplicationAction,
  submitCrowdReviewAction,
  submitDeliveryResultAction,
  submitStudentVerificationAction,
  supplementStudentVerificationAction,
  unbindUserGitHubAction,
  updateApplicationPolicyAction,
  updateCurrentProfileAction,
  updateResourceLifecycleAction,
  updateSiteBannerAction,
  updateSystemConfigAction,
  vouchInvitationAction,
} from '../welfare-persistence'

function formatEmailDeliveryAttempt(attempt: { providerLabel: string, status: string, message: string }) {
  const statusText = attempt.status === 'sent' ? '成功' : attempt.status === 'skipped' ? '跳过' : '失败'
  return `${attempt.providerLabel} ${statusText}（${attempt.message || '未返回详情'}）`
}

export interface UploadLikeFile {
  id: string
  name: string
  size: number
  type: string
  file: File
  r2Key?: string
  url?: string
  dataUrl?: string
}

interface UploadableAttachment {
  id?: string
  name: string
  size: number
  type: string
  file?: File
  r2Key?: string
  url?: string
  dataUrl?: string
}

const welfare = useWelfareStore()

async function readUploadError(response: Response) {
  const text = await response.text()
  if (!text)
    return '图片上传失败'

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || '图片上传失败'
  }
  catch {
    return text
  }
}

async function uploadImageToR2<T extends UploadableAttachment>(file: T) {
  const sourceFile = 'file' in file && file.file instanceof File ? file.file : undefined
  if (!file.type.startsWith('image/') || file.r2Key || file.url || !sourceFile)
    return file

  const response = await fetch('/api/uploads/images', {
    method: 'POST',
    headers: {
      'content-type': file.type,
      'x-file-name': encodeURIComponent(file.name),
    },
    body: sourceFile,
    credentials: 'same-origin',
  })
  if (!response.ok)
    throw new Error(await readUploadError(response))

  const result = await response.json() as Pick<UploadLikeFile, 'id' | 'name' | 'size' | 'type' | 'r2Key' | 'url'>
  return {
    ...file,
    ...result,
  }
}

async function withUploadedImages<T extends { attachments?: UploadableAttachment[] }>(payload: T): Promise<T> {
  return {
    ...payload,
    attachments: await Promise.all((payload.attachments ?? []).map(uploadImageToR2)),
  }
}

function isUploadableAttachment(value: unknown): value is UploadableAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false

  const file = value as Partial<UploadableAttachment>
  return typeof file.name === 'string'
    && Number.isFinite(Number(file.size))
    && typeof file.type === 'string'
}

function uploadableAttachments(value: unknown): UploadableAttachment[] {
  return Array.isArray(value) ? value.filter(isUploadableAttachment) : []
}

function attachmentBytes(value: unknown) {
  return uploadableAttachments(value).reduce((sum, file) => sum + Math.max(0, Math.trunc(Number(file.size || 0))), 0)
}

async function withUploadedResourceImages<T extends { attachments?: UploadableAttachment[], resourceItems: Array<{ payload: Record<string, any> }> }>(payload: T): Promise<T> {
  const uploadedPayload = await withUploadedImages(payload)
  const resourceItems = await Promise.all(uploadedPayload.resourceItems.map(async item => ({
    ...item,
    payload: {
      ...item.payload,
      attachments: await Promise.all(uploadableAttachments(item.payload.attachments).map(uploadImageToR2)),
    },
  })))

  return {
    ...uploadedPayload,
    resourceItems,
  } as T
}

async function uploadAttachmentImages(files: UploadLikeFile[] = []) {
  return Promise.all(files.map(uploadImageToR2))
}

export const adminForm = reactive({
  displayName: '公益管理员',
  email: 'admin@welfare.dev',
  password: '',
})

export const adminLoginForm = reactive({
  email: '',
  password: '',
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

export const couponRedeemForm = reactive({
  code: '',
  message: '',
})

export const couponTemplateForm = reactive({
  name: '资源通用八折券',
  description: '',
  scope: 'resource' as CouponScope,
  discountType: 'rate' as CouponDiscountType,
  discountFold: 8,
  discountAmount: 100,
  resourceTypes: [] as ResourceType[],
  minSpend: 0,
  maxDiscount: 0,
  ttlDays: 30,
  totalGrantLimit: 0,
})

export const couponCodeForm = reactive({
  templateId: '',
  code: '',
  maxRedemptions: 1,
  perUserLimit: 1,
  expiresAt: '',
})

export const couponGrantForm = reactive({
  templateId: '',
  userIds: [] as string[],
})

export const rechargeForm = reactive({
  amount: 100,
  selectedCouponId: '',
  loading: false,
  statusMessage: '',
})

export const RECHARGE_MIN_LDC = 1
export const RECHARGE_MAX_LDC = 1000

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
  groups: [] as Sub2ApiGroupView[],
  configured: false,
  loading: false,
  testing: false,
  message: '',
})

export const databaseProvisionConfigForm = reactive({
  enabled: true,
  rootUrl: '',
  clearRootUrl: false,
  rootUrlMasked: '',
  defaultExpiresInDays: 30,
  databasePrefix: 'twg',
  onePanelBaseUrl: '',
  onePanelApiKey: '',
  clearOnePanelApiKey: false,
  onePanelApiKeyMasked: '',
  onePanelStatus: '',
  onePanelStatusSnapshot: null as Awaited<ReturnType<typeof loadOnePanelStatus>> | null,
  configured: false,
  loading: false,
  testing: false,
  checkingOnePanel: false,
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

export const educationMailConfigForm = reactive({
  enabled: true,
  baseUrl: '',
  adminKey: '',
  adminKeyMasked: '',
  inboxAddress: EDUCATION_EMAIL_REVIEW_INBOX,
  lookbackHours: 168,
  configured: false,
  loading: false,
  testing: false,
  syncing: false,
  message: '',
  lastSync: null as EducationMailSyncResult | null,
})

export const notificationSettingsForm = reactive({
  emailEnabled: false,
  emailAddress: '',
  feishuEnabled: false,
  feishuWebhookUrl: '',
  feishuWebhookMasked: '',
  browserPushEnabled: false,
  pushSubscriptionCount: 0,
  loading: false,
  emailTesting: false,
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
  feishuMailEnabled: false,
  feishuAppId: '',
  feishuAppSecret: '',
  feishuAppSecretMasked: '',
  feishuUserAccessToken: '',
  feishuUserAccessTokenMasked: '',
  feishuRefreshToken: '',
  feishuRefreshTokenMasked: '',
  feishuAccessTokenExpiresAt: '',
  feishuRefreshTokenExpiresAt: '',
  feishuUserMailboxId: 'me',
  feishuSiteBaseUrl: '',
  feishuDailyLimit: 400,
  feishuMailboxOptions: [] as Awaited<ReturnType<typeof loadFeishuMailboxes>>['mailboxes'],
  feishuMailboxesLoading: false,
  testEmailAddress: '',
  testingEmail: false,
  authorizingFeishu: false,
  emailConfigured: false,
  pushConfigured: false,
  feishuMailConfigured: false,
  loading: false,
  generatingVapid: false,
  message: '',
})

export const siteBannerConfigForm = reactive({
  enabled: false,
  title: '',
  body: '',
  tone: 'info' as 'info' | 'success' | 'warning',
  loading: false,
  message: '',
})

export const systemConfigForm = reactive({
  siteEnabled: true,
  siteClosedReason: '系统维护中，请稍后再试。',
  loginEnabled: true,
  loginClosedReason: '登录入口维护中，请稍后再试。',
  registrationEnabled: true,
  registrationClosedReason: '新用户注册暂未开放。',
  rechargeEnabled: true,
  rechargeClosedReason: '充值入口维护中，请稍后再试。',
  studentVerificationEnabled: true,
  studentVerificationReason: '学生认证暂未开放。',
  frontlineVerificationEnabled: true,
  frontlineVerificationReason: '一线认证暂未开放。',
  loading: false,
  message: '',
})

export const adminAnnouncementForm = reactive({
  title: '',
  body: '',
  channels: {
    in_app: true,
    email: false,
    feishu: false,
    browser_push: false,
  } as Record<NotificationChannel, boolean>,
  forcePopup: false,
  forcePush: false,
  loading: false,
  message: '',
})

export const adminAnnouncements = ref<Awaited<ReturnType<typeof loadAdminAnnouncements>>['announcements']>([])
export const systemLogs = ref<SystemLogItem[]>([])

export const notificationList = ref<Awaited<ReturnType<typeof loadNotifications>>['notifications']>([])
export const unreadNotificationCount = ref(0)
export const notificationsLoading = ref(false)
export const isNotificationDrawerOpen = ref(false)

export const applicationSecurityForm = reactive({
  powNonce: '',
  powStatus: 'idle' as 'idle' | 'computing' | 'ready',
  turnstileToken: '',
  turnstileVerified: false,
  message: '',
})

export const applicationPolicyConfigForm = reactive({
  turnstileSecretKey: '',
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
  waiveRejectionReviewFee: false,
  selectedCouponId: '',
  shareToSquare: false,
  squarePostContent: '',
})

export const squarePostForm = reactive({
  postType: 'review' as SquarePostType,
  title: '',
  content: '',
  applicationId: '',
  shareTemplate: true,
})

export const squareBoostDrafts = reactive<Record<string, string>>({})
export const squareReportDrafts = reactive<Record<string, string>>({})

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

export const resourceProvisionDrafts = reactive<Record<string, ProvisionDraft>>({})
export const applicationAllocationDrafts = reactive<Record<string, ProvisionDraft>>({})
export const resourceAutoProvisionMessage = ref('')

interface ProvisionDraft {
  resourceName: string
  resourceType: string
  accessUrl: string
  credential: string
  expiresAt: string
  note: string
}

export const applicationFiles = ref<UploadLikeFile[]>([])

const defaultStudentNotes = '<h3>身份说明</h3><ul><li>2026 级本科生</li><li>已上传学生证或录取通知截图</li></ul><h3>材料清单</h3><ul><li>学生证照片</li><li>校园邮箱截图</li></ul>'
const defaultFrontlineNotes = '<h3>身份说明</h3><ul><li>乡村振兴或公益一线相关工作人员</li><li>已上传单位证明、服务证明或项目材料</li></ul><h3>材料清单</h3><ul><li>组织/单位证明</li><li>服务记录或项目截图</li></ul>'

export const studentForm = reactive({
  verificationType: 'student' as VerificationType,
  realName: '',
  category: '大学生',
  school: '北京大学',
  grade: '2026 级',
  educationLevel: '本科',
  identity: '',
  educationEmail: '',
  notes: defaultStudentNotes,
})

export const adminStudentVerificationForm = reactive({
  userId: '',
  verificationType: 'student' as VerificationType,
  realName: '',
  category: '大学生',
  school: '',
  grade: '',
  educationLevel: '',
  identity: '',
  educationEmail: '',
  educationEmailVerified: false,
  notes: defaultStudentNotes,
  submitting: false,
  message: '',
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
  verifying: false,
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

export const verificationTypeOptions = [
  { value: 'student', label: '学生认证', description: '面向在读学生、科研人员、教师等教育相关身份。' },
  { value: 'frontline', label: '一线认证', description: '面向基层帮扶、乡村振兴、支教、驻村和公益一线工作人员。' },
] as const

export const frontlineCategoryOptions = [
  '基层帮扶',
  '乡村振兴',
  '支教服务',
  '驻村工作',
  '公益一线',
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
export const adminStudentVerificationFiles = ref<UploadLikeFile[]>([])

export const reviewDrafts = reactive<Record<string, string>>({})
export const supplementDrafts = reactive<Record<string, string>>({})
export const rejectFraudulentDrafts = reactive<Record<string, boolean>>({})
export const crowdReviewDrafts = reactive<Record<string, {
  decision: CrowdReviewDecision
  note: string
}>>({})
export const collaborationApplicationForm = reactive({
  reason: '',
  loading: false,
  message: '',
})
export const collaborationReviewDrafts = reactive<Record<string, {
  reply: string
}>>({})
export const deliveryResultDrafts = reactive<Record<string, string>>({})
export const deliveryReviewDrafts = reactive<Record<string, {
  approved: boolean
  rewardPoints: number
  note: string
}>>({})
export const pointDrafts = reactive<Record<string, number>>({})
export const selectedSection = ref<'home' | 'apply' | 'square' | 'verification' | 'student' | 'openSource' | 'notifications' | 'notificationSettings' | 'profile' | 'wallet' | 'collaboration' | 'admin'>('home')
export const ADMIN_TABS = {
  login: '登录配置',
  policy: '申请策略',
  github: 'GitHub 应用',
  ai: 'AI 配置',
  educationMail: '教育邮箱',
  notifications: '通知配置',
  ldc: '充值配置',
  users: '用户管理',
  dashboard: '仪表盘数据',
  data: '业务数据管理',
  audit: '审计日志',
} as const

export type AdminTabKey = keyof typeof ADMIN_TABS
export type AdminTabName = (typeof ADMIN_TABS)[AdminTabKey]

export const adminTabItems = [
  { key: 'dashboard', name: ADMIN_TABS.dashboard, icon: 'i-carbon-dashboard' },
  { key: 'data', name: ADMIN_TABS.data, icon: 'i-carbon-data-table' },
  { key: 'users', name: ADMIN_TABS.users, icon: 'i-carbon-user-multiple' },
  { key: 'audit', name: ADMIN_TABS.audit, icon: 'i-carbon-cloud-auditing' },
  { key: 'policy', name: ADMIN_TABS.policy, icon: 'i-carbon-rule' },
  { key: 'login', name: ADMIN_TABS.login, icon: 'i-carbon-login' },
  { key: 'github', name: ADMIN_TABS.github, icon: 'i-carbon-logo-github' },
  { key: 'ai', name: ADMIN_TABS.ai, icon: 'i-carbon-ai-status' },
  { key: 'educationMail', name: ADMIN_TABS.educationMail, icon: 'i-carbon-email' },
  { key: 'notifications', name: ADMIN_TABS.notifications, icon: 'i-carbon-notification' },
  { key: 'ldc', name: ADMIN_TABS.ldc, icon: 'i-carbon-wallet' },
] as const

export function adminTabNameFromKey(tabKey?: string): AdminTabName | undefined {
  return adminTabItems.find(item => item.key === tabKey)?.name
}

export function adminTabKeyFromName(tabName: AdminTabName): AdminTabKey {
  return adminTabItems.find(item => item.name === tabName)?.key ?? 'dashboard'
}

export const activeAdminTab = ref<AdminTabName>(ADMIN_TABS.dashboard)
export const lastRechargeStatus = ref<RechargeStatusResult | null>(null)
export const pointTransactions = ref<Awaited<ReturnType<typeof loadPointTransactions>>['rows']>([])
export const pointTransactionSummary = reactive({
  income: 0,
  outcome: 0,
  count: 0,
  balance: 0,
  balanceUserId: '',
  loading: false,
  message: '',
})

export const currentUserPointBalance = computed(() => {
  const user = welfare.currentUser.value
  if (!user)
    return 0

  return pointTransactionSummary.balanceUserId === user.id
    ? pointTransactionSummary.balance
    : user.points
})

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
  const activeSiteBanner = computed(() => {
    const banner = welfare.state.siteBanner
    const config = normalizeSystemConfig(welfare.state.systemConfig)
    if (!config.siteEnabled) {
      return {
        enabled: true,
        title: banner.title || '系统维护',
        body: config.siteClosedReason,
        tone: 'warning' as const,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      }
    }
    return banner.enabled && (banner.title || banner.body) ? banner : undefined
  })
  const systemConfig = computed(() => normalizeSystemConfig(welfare.state.systemConfig))
  const loginFeatureEnabled = computed(() => systemConfig.value.siteEnabled && systemConfig.value.loginEnabled)
  const registrationFeatureEnabled = computed(() => systemConfig.value.siteEnabled && systemConfig.value.registrationEnabled)
  const rechargeFeatureEnabled = computed(() => systemConfig.value.siteEnabled && systemConfig.value.rechargeEnabled)
  const totalApplicationBytes = computed(() => applicationFiles.value.reduce((sum, file) => sum + file.size, 0)
    + resourceApplicationItems.value.reduce((sum, item) => sum + attachmentBytes(item.payload.attachments), 0))
  const totalStudentBytes = computed(() => studentFiles.value.reduce((sum, file) => sum + file.size, 0))
  const totalAdminStudentVerificationBytes = computed(() => adminStudentVerificationFiles.value.reduce((sum, file) => sum + file.size, 0))
  const activeRequestCount = computed(() => welfare.currentUser.value ? welfare.activeRequestCount(welfare.currentUser.value.id) : 0)
  const canCreateRequest = computed(() => activeRequestCount.value < MAX_ACTIVE_USER_REQUESTS)
  const enabledLlmApiModels = computed(() => aiConfigForm.llmApiModels.filter(item => item.enabled))
  const selectableLlmApiModels = computed(() => aiConfigForm.llmApiModels.filter(item => item.enabled && (LLM_API_SELECTABLE_MODEL_KEYS as readonly string[]).includes(item.key)))
  const selectedLlmApiModel = computed(() => resolveSelectableLlmApiModel(applicationForm.llmApiModelKey, aiConfigForm.llmApiModels))
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
  const latestTransactions = computed(() => pointTransactions.value.slice(0, 8))
  const currentUserPointBalanceText = computed(() => currentUserPointBalance.value.toLocaleString('zh-CN'))
  const hasCurrentUserPointBalance = (cost: number) => currentUserPointBalance.value >= cost
  const currentUserCoupons = computed(() => welfare.currentUserCoupons.value)
  const availableCurrentUserCoupons = computed(() => {
    const user = welfare.currentUser.value
    return user ? welfare.availableCouponsForUser(user.id) : []
  })
  const availableResourceCoupons = computed(() => {
    const user = welfare.currentUser.value
    return user ? welfare.availableCouponsForTarget(user.id, 'resource', 0, resourceApplicationForm.selectedResourceTypes) : []
  })
  const availableRechargeCoupons = computed(() => {
    const user = welfare.currentUser.value
    const amount = Number(rechargeForm.amount)
    return user ? welfare.availableCouponsForTarget(user.id, 'recharge', Number.isFinite(amount) ? amount : 0) : []
  })
  const couponTemplates = computed(() => welfare.state.couponTemplates)
  const couponCodes = computed(() => welfare.state.couponCodes)
  const couponRedemptions = computed(() => welfare.state.couponRedemptions)
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
  const currentUserRejectionFeeWaiverBlockedUntil = computed(() =>
    welfare.currentUser.value ? welfare.rejectionFeeWaiverBlockedUntil(welfare.currentUser.value.id) : '',
  )
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

  function syncApplicationLlmApiModel(resetLimits = false) {
    const model = selectedLlmApiModel.value
    const modelChanged = applicationForm.llmApiModelKey !== model.key
    if (modelChanged)
      applicationForm.llmApiModelKey = model.key

    if (modelChanged || resetLimits) {
      applicationForm.llmApiBudgetUsd = model.defaultBudgetUsd
      applicationForm.llmApiCustomRpmLimit = model.rpmLimit
      applicationForm.llmApiCustomTpmLimit = model.tpmLimit
      return
    }

    applicationForm.llmApiBudgetUsd = normalizeLlmApiBudgetUsd(applicationForm.llmApiBudgetUsd, model)
  }

  watch(welfare.currentUser, syncProfileForm, { immediate: true })
  watch(() => applicationForm.llmApiModelKey, () => syncApplicationLlmApiModel(true), { immediate: true })
  watch(selectableLlmApiModels, () => syncApplicationLlmApiModel(true))
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
  watch(() => studentForm.verificationType, (type) => {
    if (type === 'frontline') {
      if ((studentCategoryOptions as readonly string[]).includes(studentForm.category))
        studentForm.category = frontlineCategoryOptions[0]
      if (studentForm.school === '北京大学')
        studentForm.school = ''
      if (studentForm.grade === '2026 级')
        studentForm.grade = ''
      if (studentForm.educationLevel === '本科')
        studentForm.educationLevel = ''
      if (studentForm.notes === defaultStudentNotes)
        studentForm.notes = defaultFrontlineNotes
      return
    }

    if ((frontlineCategoryOptions as readonly string[]).includes(studentForm.category))
      studentForm.category = '大学生'
    if (!studentForm.school)
      studentForm.school = '北京大学'
    if (!studentForm.grade)
      studentForm.grade = '2026 级'
    if (!studentForm.educationLevel)
      studentForm.educationLevel = '本科'
    if (studentForm.notes === defaultFrontlineNotes)
      studentForm.notes = defaultStudentNotes
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
    educationEmailVerificationForm.verifying = false
    educationEmailVerificationForm.message = ''
  })

  function resetEducationEmailVerificationForm() {
    educationEmailVerificationForm.code = ''
    educationEmailVerificationForm.challengeId = ''
    educationEmailVerificationForm.subject = ''
    educationEmailVerificationForm.body = ''
    educationEmailVerificationForm.mailto = ''
    educationEmailVerificationForm.sentTo = ''
    educationEmailVerificationForm.expiresAt = ''
    educationEmailVerificationForm.verified = false
    educationEmailVerificationForm.verifying = false
    educationEmailVerificationForm.message = ''
  }

  function fillStudentFormFromVerification(verification: StudentVerification) {
    studentForm.verificationType = verification.verificationType ?? 'student'
    studentForm.realName = verification.realName
    studentForm.category = verification.category
    studentForm.school = verification.school ?? ''
    studentForm.identity = verification.identity ?? ''
    studentForm.grade = verification.grade ?? ''
    studentForm.educationLevel = verification.educationLevel ?? ''
    studentForm.educationEmail = verification.educationEmail ?? ''
    studentForm.notes = verification.notes
    resetEducationEmailVerificationForm()
    const challenge = verification.educationEmailChallengeId
      ? welfare.state.educationEmailChallenges.find(item => item.id === verification.educationEmailChallengeId)
      : undefined
    if (verification.educationEmail && verification.educationEmailVerified && challenge?.verifiedAt) {
      educationEmailVerificationForm.challengeId = challenge.id
      educationEmailVerificationForm.code = challenge.code
      educationEmailVerificationForm.subject = challenge.subject
      educationEmailVerificationForm.body = challenge.body
      educationEmailVerificationForm.mailto = challenge.mailto
      educationEmailVerificationForm.sentTo = challenge.email
      educationEmailVerificationForm.expiresAt = challenge.expiresAt
      educationEmailVerificationForm.verified = true
      educationEmailVerificationForm.message = `${educationEmailUserLabel(challenge.email, true)}；管理员建议：${educationEmailAdminRecommendationLabel(challenge.email)}`
    }
  }

  function statusText(status: string) {
    const map: Record<string, string> = {
      reserved: '已提交',
      pending_review: '待审核',
      needs_supplement: '待补充资料',
      processing: '处理中',
      answered: '已答复',
      pending_allocation: '待分配资源',
      delivered: '已交付',
      completed: '已结束',
      closed: '已关闭',
      rejected: '已退回',
      submitted: '已提交',
      in_review: '资源审批中',
      approved: '已通过',
      revoked: '已撤销',
      partial_approved: '部分通过',
      cancelled: '已取消',
      draft: '草稿',
      pending: '待审核',
    }
    return map[status] ?? status
  }

  function statusTone(status: string) {
    if (['completed', 'closed', 'approved', 'delivered'].includes(status))
      return 'success'
    if (status === 'pending_allocation')
      return 'warning'
    if (status === 'answered')
      return 'info'
    if (status === 'partial_approved')
      return 'info'
    if (['pending_review', 'needs_supplement', 'processing', 'pending', 'submitted', 'in_review', 'draft'].includes(status))
      return 'warning'
    if (['rejected', 'revoked', 'cancelled'].includes(status))
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

  function defaultLlmApiPayload(modelKey?: string) {
    const model = resolveSelectableLlmApiModel(modelKey ?? LLM_API_DEFAULT_MODEL_KEY, aiConfigForm.llmApiModels)
    return {
      model: model.key,
      modelName: model.name,
      budgetLimit: model.defaultBudgetUsd,
      rpmLimit: model.rpmLimit,
      tpmLimit: model.tpmLimit,
      defaultRpmLimit: model.rpmLimit,
      defaultTpmLimit: model.tpmLimit,
      rateLimitMode: 'default',
      duration: defaultLlmApiDuration(model),
      usageScenario: '',
      uploadsUserData: false,
      uploadUserData: false,
      containsSensitiveInfo: false,
      containsPrivacy: false,
      logRetention: 0,
      attachments: [],
    }
  }

  function defaultResourcePayload(resourceType: ResourceType, resourceSubtype?: string): Record<string, any> {
    if (resourceType === 'database') {
      return {
        name: '',
        environment: 'dev',
        permission: 'readonly',
        sensitiveData: false,
        reason: '',
        operationScope: '',
        duration: RESOURCE_DEFAULT_DURATION,
        attachments: [],
      }
    }
    if (resourceType === 'llm_api_quota')
      return defaultLlmApiPayload(resourceSubtype)
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
      attachments: [],
    }
  }

  function syncSelectedResourceTypesFromItems() {
    resourceApplicationForm.selectedResourceTypes = Array.from(new Set(resourceApplicationItems.value.map(item => item.resourceType)))
  }

  function addResourceApplicationItem(resourceType: ResourceType, options: { resourceSubtype?: string } = {}) {
    const config = RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === resourceType)
    if (!config)
      throw new Error('资源类型不存在')
    if (!resourceApplicationForm.selectedResourceTypes.includes(resourceType))
      resourceApplicationForm.selectedResourceTypes.push(resourceType)

    const resourceSubtype = options.resourceSubtype && config.subtypes.includes(options.resourceSubtype)
      ? options.resourceSubtype
      : config.subtypes[0]
    const payload: Record<string, any> = defaultResourcePayload(resourceType, resourceSubtype)
    resourceApplicationItems.value.push({
      id: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      resourceType,
      resourceSubtype,
      payload,
      requestedPermission: typeof payload.permission === 'string' ? payload.permission : undefined,
      requestedQuota: resourceType === 'llm_api_quota' ? `$${payload.budgetLimit}` : undefined,
      duration: typeof payload.duration === 'string' ? payload.duration : undefined,
    })
  }

  function removeResourceApplicationItem(id: string) {
    resourceApplicationItems.value = resourceApplicationItems.value.filter(item => item.id !== id)
    syncSelectedResourceTypesFromItems()
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
    resourceApplicationForm.waiveRejectionReviewFee = false
    resourceApplicationForm.selectedCouponId = ''
    resourceApplicationForm.shareToSquare = false
    resourceApplicationForm.squarePostContent = ''
    resourceApplicationItems.value = []
    addResourceApplicationItem('database')
  }

  function fillResourceApplicationFormFromDraft(application: WelfareApplication) {
    if (application.type !== 'resource' || application.status !== 'draft')
      throw new Error('只能编辑资源申请草稿')

    resourceApplicationForm.title = application.title
    resourceApplicationForm.departmentId = application.departmentId ?? ''
    resourceApplicationForm.projectId = application.projectId ?? ''
    resourceApplicationForm.reason = application.reason ?? application.description
    resourceApplicationForm.businessBackground = application.businessBackground ?? ''
    resourceApplicationForm.urgency = application.urgency ?? 'normal'
    resourceApplicationForm.expectedEffectiveAt = application.expectedEffectiveAt ?? ''
    resourceApplicationForm.costCenter = application.costCenter ?? ''
    resourceApplicationForm.ownerId = application.ownerId ?? welfare.currentUser.value?.id ?? ''
    resourceApplicationForm.duration = RESOURCE_DEFAULT_DURATION
    resourceApplicationForm.selectedResourceTypes = [...(application.selectedResourceTypes?.length ? application.selectedResourceTypes : ['database' as ResourceType])]
    resourceApplicationForm.acceptedTermIds = application.termsAcceptances?.map(item => item.termId) ?? []
    resourceApplicationForm.waiveRejectionReviewFee = !!application.rejectionReviewFeeWaived
    resourceApplicationForm.selectedCouponId = ''
    resourceApplicationForm.shareToSquare = false
    resourceApplicationForm.squarePostContent = ''
    const legacyApplicationFiles = application.attachments.map(item => ({ ...item }))
    resourceApplicationItems.value = (application.resourceItems ?? []).map(item => ({
      id: item.id,
      resourceType: item.resourceType,
      resourceSubtype: item.resourceSubtype,
      payload: {
        ...item.payload,
        attachments: uploadableAttachments(item.payload.attachments).map(file => ({ ...file })),
      },
      requestedQuota: item.requestedQuota,
      requestedPermission: item.requestedPermission,
      duration: item.duration,
    }))
    applicationFiles.value = []
    ensureSelectedResourceItems()
    if (legacyApplicationFiles.length && resourceApplicationItems.value[0]) {
      resourceApplicationItems.value[0].payload.attachments = [
        ...uploadableAttachments(resourceApplicationItems.value[0].payload.attachments),
        ...legacyApplicationFiles,
      ]
    }
  }

  function resourceApplicationPayload(saveAsDraft: boolean, security: Record<string, unknown> = {}) {
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    return {
      title: resourceApplicationForm.title,
      departmentId: resourceApplicationForm.departmentId,
      projectId: resourceApplicationForm.projectId,
      reason: resourceApplicationForm.reason,
      businessBackground: resourceApplicationForm.businessBackground,
      urgency: resourceApplicationForm.urgency,
      expectedEffectiveAt: resourceApplicationForm.expectedEffectiveAt,
      costCenter: resourceApplicationForm.costCenter,
      ownerId: resourceApplicationForm.ownerId || welfare.currentUser.value.id,
      duration: resourceApplicationForm.duration,
      selectedResourceTypes: resourceApplicationForm.selectedResourceTypes,
      resourceItems: resourceApplicationItems.value.map(item => ({
        ...item,
        payload: {
          ...item.payload,
          attachments: uploadableAttachments(item.payload.attachments),
        },
      })),
      acceptedTermIds: resourceApplicationForm.acceptedTermIds,
      waiveRejectionReviewFee: resourceApplicationForm.waiveRejectionReviewFee,
      couponId: saveAsDraft ? undefined : resourceApplicationForm.selectedCouponId || undefined,
      attachments: applicationFiles.value,
      saveAsDraft,
      shareToSquare: !saveAsDraft && resourceApplicationForm.shareToSquare,
      squarePostContent: resourceApplicationForm.squarePostContent,
      ...security,
    }
  }

  async function submitResourceApplication(saveAsDraft = false) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    await refreshCurrentUserPointBalance()
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

    await submitApplicationCommand({
      type: 'resource',
      ...await withUploadedResourceImages(resourceApplicationPayload(saveAsDraft, security)),
    })
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
  }

  async function updateResourceDraft(applicationId: string, saveAsDraft = false) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    await refreshCurrentUserPointBalance()
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

    await submitApplicationCommand({
      type: 'resource',
      applicationId,
      ...await withUploadedResourceImages(resourceApplicationPayload(saveAsDraft, security)),
    })
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
  }

  function resourceReviewDraftFor(itemId: string) {
    resourceReviewDrafts[itemId] ??= {
      status: 'approved',
      note: '',
      approvedPayloadText: '{}',
    }
    return resourceReviewDrafts[itemId]
  }

  function autoProvisionMessage(result: ProvisionApplicationRewardResult) {
    if (result.status === 'pending')
      return result.itemId ? `资源 ${result.itemId} 已进入后台自动发放队列，请稍后刷新查看结果。` : '自动发放已进入后台队列，请稍后刷新查看结果。'

    if (result.status === 'pending_manual')
      return `自动发放失败，已转入待人工分配：${result.error}`

    if (result.status === 'skipped')
      return result.reason ? `已进入待人工分配：${result.reason}` : '已进入待人工分配。'

    if (result.status === 'provisioned' && result.provider === 'newapi')
      return `NewAPI 自动发放：${result.key.name}\nKey: ${result.key.key}\n有效期：${result.key.expiresAt}`

    if (result.status !== 'provisioned' || result.provider !== 'resource')
      return ''

    const lines: string[] = []
    for (const item of result.items) {
      if (item.provider === 'database') {
        if (item.database.password) {
          lines.push([
            `数据库资源 ${item.itemId}`,
            `连接串：${item.database.connectionUrl || item.database.connectionUrlMasked}`,
            `用户名：${item.database.username}`,
            `密码：${item.database.password}`,
            `有效期：${item.database.expiresAt || '按默认配置'}`,
          ].join('\n'))
        }
        continue
      }

      if (!item.key.key) {
        lines.push([
          `Sub2API 资源 ${item.itemId}`,
          `已复用现有绑定：${item.key.keyMasked}`,
          `额度：$${item.key.quotaUsd}`,
          `有效期：${item.key.expiresAt || '按默认配置'}`,
        ].join('\n'))
        continue
      }

      lines.push([
        `Sub2API 资源 ${item.itemId}`,
        `Key: ${item.key.key}`,
        `额度：$${item.key.quotaUsd}`,
        `有效期：${item.key.expiresAt || '按默认配置'}`,
      ].join('\n'))
    }

    if (result.failures?.length)
      lines.push(`待人工处理：${result.failures.map(item => `${item.itemId}（${item.error}）`).join('；')}`)

    return lines.join('\n\n')
  }

  function applyAutoProvisionMessage(result: ProvisionApplicationRewardResult) {
    const message = autoProvisionMessage(result)
    if (!message)
      return

    resourceAutoProvisionMessage.value = message
    if (message.includes('数据库资源'))
      databaseProvisionConfigForm.message = message
    if (message.includes('Sub2API 资源') || message.includes('后台自动发放队列'))
      sub2ApiKeyForm.message = message
    if (message.includes('NewAPI 自动发放')) {
      temporaryAiKey.value = result.status === 'provisioned' && result.provider === 'newapi' ? result.key.key : temporaryAiKey.value
      temporaryAiKeyExpiresAt.value = result.status === 'provisioned' && result.provider === 'newapi' ? result.key.expiresAt : temporaryAiKeyExpiresAt.value
    }
  }

  async function approveResourceItem(applicationId: string, itemId: string) {
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
    await reviewApplicationItemAction({
      applicationId,
      itemId,
      status: draft.status,
      approvedPayload,
      note: draft.note,
    })
    delete resourceReviewDrafts[itemId]
    let provisionResult: ProvisionApplicationRewardResult | undefined
    if (['approved', 'adjusted_approved'].includes(draft.status)) {
      provisionResult = await provisionApplicationReward(welfare.currentUser.value!.id, applicationId, itemId)
      applyAutoProvisionMessage(provisionResult)
    }
    await welfare.reloadWelfareState()
  }

  function emptyProvisionDraft(): ProvisionDraft {
    return {
      resourceName: '',
      resourceType: 'account',
      accessUrl: '',
      credential: '',
      expiresAt: '',
      note: '',
    }
  }

  function provisionDraftFor(itemId: string) {
    resourceProvisionDrafts[itemId] ??= emptyProvisionDraft()
    return resourceProvisionDrafts[itemId]
  }

  function allocationDraftFor(applicationId: string) {
    applicationAllocationDrafts[applicationId] ??= emptyProvisionDraft()
    return applicationAllocationDrafts[applicationId]
  }

  async function completeResourceProvision(applicationId: string, itemId: string) {
    await completeResourceProvisionAction({
      applicationId,
      itemId,
      ...provisionDraftFor(itemId),
    })
    delete resourceProvisionDrafts[itemId]
    await welfare.reloadWelfareState()
  }

  async function completeApplicationAllocation(applicationId: string) {
    await completeApplicationAllocationAction({
      applicationId,
      ...allocationDraftFor(applicationId),
    })
    delete applicationAllocationDrafts[applicationId]
    await welfare.reloadWelfareState()
  }

  async function updateResourceLifecycle(payload: ResourceLifecycleActionPayload) {
    await updateResourceLifecycleAction(payload)
    await welfare.reloadWelfareState()
  }

  async function requestResourceLifecycle(payload: ResourceLifecycleActionPayload) {
    await requestResourceLifecycleAction(payload)
    await welfare.reloadWelfareState()
  }

  watch(() => resourceApplicationForm.selectedResourceTypes.slice(), () => {
    ensureSelectedResourceItems()
    syncResourceAcceptedTerms()
  }, { immediate: true })

  function resetStudentFiles() {
    studentFiles.value = []
  }

  function resetAdminStudentVerificationForm() {
    adminStudentVerificationForm.userId = ''
    adminStudentVerificationForm.verificationType = 'student'
    adminStudentVerificationForm.realName = ''
    adminStudentVerificationForm.category = '大学生'
    adminStudentVerificationForm.school = ''
    adminStudentVerificationForm.grade = ''
    adminStudentVerificationForm.educationLevel = ''
    adminStudentVerificationForm.identity = ''
    adminStudentVerificationForm.educationEmail = ''
    adminStudentVerificationForm.educationEmailVerified = false
    adminStudentVerificationForm.notes = defaultStudentNotes
    adminStudentVerificationForm.message = ''
    adminStudentVerificationFiles.value = []
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
    educationEmailVerificationForm.message = `${educationEmailUserLabel(challenge.email)}；管理员建议：${educationEmailAdminRecommendationLabel(challenge.email)}。请使用该邮箱向 ${EDUCATION_EMAIL_REVIEW_INBOX} 发送邮件，管理员会人工复核`
  }

  async function generateEducationEmailChallenge() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    educationEmailVerificationForm.loading = true
    educationEmailVerificationForm.message = ''
    try {
      const result = await createEducationEmailChallengeAction(studentForm.educationEmail, studentForm.realName)
      applyEducationEmailChallenge(result.challenge)
      await welfare.reloadWelfareState()
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

  async function confirmEducationEmailSent() {
    await ensureEducationEmailChallenge()
    const userId = welfare.currentUser.value?.id
    if (!userId)
      throw new Error('请先登录')

    educationEmailVerificationForm.verifying = true
    educationEmailVerificationForm.message = '正在通过收件 API 验证教育邮箱邮件...'
    try {
      const result = await verifyEducationMailChallenge(userId, educationEmailVerificationForm.challengeId)
      if (!result.verified) {
        educationEmailVerificationForm.verified = false
        educationEmailVerificationForm.message = '暂未在平台收件箱匹配到该教育邮箱发送的证明码，请确认发件邮箱和邮件内容后重试'
        throw new Error(educationEmailVerificationForm.message)
      }

      await welfare.reloadWelfareState()
      educationEmailVerificationForm.verified = true
      educationEmailVerificationForm.message = `${educationEmailUserLabel(result.email, true)}；管理员建议：${educationEmailAdminRecommendationLabel(result.email)}，仍会结合材料审核`
      return result
    }
    finally {
      educationEmailVerificationForm.verifying = false
    }
  }

  function refreshSystemConfigForm() {
    const config = normalizeSystemConfig(welfare.state.systemConfig)
    systemConfigForm.siteEnabled = config.siteEnabled
    systemConfigForm.siteClosedReason = config.siteClosedReason
    systemConfigForm.loginEnabled = config.loginEnabled
    systemConfigForm.loginClosedReason = config.loginClosedReason
    systemConfigForm.registrationEnabled = config.registrationEnabled
    systemConfigForm.registrationClosedReason = config.registrationClosedReason
    systemConfigForm.rechargeEnabled = config.rechargeEnabled
    systemConfigForm.rechargeClosedReason = config.rechargeClosedReason
    systemConfigForm.studentVerificationEnabled = config.verification.student.enabled
    systemConfigForm.studentVerificationReason = config.verification.student.reason ?? ''
    systemConfigForm.frontlineVerificationEnabled = config.verification.frontline.enabled
    systemConfigForm.frontlineVerificationReason = config.verification.frontline.reason ?? ''
  }

  async function persistSystemConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    systemConfigForm.loading = true
    systemConfigForm.message = ''
    try {
      await updateSystemConfigAction({
        siteEnabled: systemConfigForm.siteEnabled,
        siteClosedReason: systemConfigForm.siteClosedReason,
        loginEnabled: systemConfigForm.loginEnabled,
        loginClosedReason: systemConfigForm.loginClosedReason,
        registrationEnabled: systemConfigForm.registrationEnabled,
        registrationClosedReason: systemConfigForm.registrationClosedReason,
        rechargeEnabled: systemConfigForm.rechargeEnabled,
        rechargeClosedReason: systemConfigForm.rechargeClosedReason,
        verification: {
          student: {
            enabled: systemConfigForm.studentVerificationEnabled,
            reason: systemConfigForm.studentVerificationReason,
          },
          frontline: {
            enabled: systemConfigForm.frontlineVerificationEnabled,
            reason: systemConfigForm.frontlineVerificationReason,
          },
        },
      })
      await welfare.reloadWelfareState()
      refreshSystemConfigForm()
      systemConfigForm.message = '系统开关已保存'
    }
    finally {
      systemConfigForm.loading = false
    }
  }

  async function persistApplicationPolicy() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    applicationPolicyConfigForm.loading = true
    applicationPolicyConfigForm.message = ''
    try {
      const applicationPolicy = normalizeApplicationPolicy(welfare.state.applicationPolicy)
      const turnstileSecretKey = applicationPolicyConfigForm.turnstileSecretKey.trim()
      if (turnstileSecretKey)
        applicationPolicy.turnstileSecretKey = turnstileSecretKey

      await updateApplicationPolicyAction(applicationPolicy)
      await welfare.reloadWelfareState()
      applicationPolicyConfigForm.turnstileSecretKey = ''
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

  async function submitCrowdReviewDraft(applicationId: string) {
    const draft = crowdReviewDraftFor(applicationId)
    await submitCrowdReviewAction('pro_application', applicationId, draft.decision, draft.note)
    delete crowdReviewDrafts[applicationId]
    await welfare.reloadWelfareState()
  }

  function collaborationReviewDraftFor(applicationId: string) {
    collaborationReviewDrafts[applicationId] ??= {
      reply: '',
    }
    return collaborationReviewDrafts[applicationId]
  }

  function deliveryReviewDraftFor(applicationId: string) {
    deliveryReviewDrafts[applicationId] ??= {
      approved: true,
      rewardPoints: 100,
      note: '',
    }
    return deliveryReviewDrafts[applicationId]
  }

  async function submitCollaborationApplicationFromForm() {
    collaborationApplicationForm.loading = true
    collaborationApplicationForm.message = ''
    try {
      await submitCollaborationApplicationAction({
        reason: collaborationApplicationForm.reason,
      })
      collaborationApplicationForm.reason = ''
      collaborationApplicationForm.message = '协作处理员申请已提交'
      await welfare.reloadWelfareState()
    }
    finally {
      collaborationApplicationForm.loading = false
    }
  }

  async function reviewCollaborationApplication(id: string, status: 'approved' | 'rejected') {
    const draft = collaborationReviewDraftFor(id)
    await reviewCollaborationApplicationAction({
      id,
      status,
      reply: draft.reply,
    })
    delete collaborationReviewDrafts[id]
    await welfare.reloadWelfareState()
  }

  async function claimDeliveryApplication(applicationId: string) {
    await claimDeliveryApplicationAction(applicationId)
    await welfare.reloadWelfareState()
  }

  async function cancelDeliveryClaim(applicationId: string) {
    await cancelDeliveryClaimAction(applicationId)
    delete deliveryResultDrafts[applicationId]
    await welfare.reloadWelfareState()
  }

  async function submitDeliveryResult(applicationId: string) {
    await submitDeliveryResultAction({
      applicationId,
      content: deliveryResultDrafts[applicationId] || '',
      attachments: [],
    })
    delete deliveryResultDrafts[applicationId]
    await welfare.reloadWelfareState()
  }

  async function reviewDeliveryResult(applicationId: string, approved: boolean) {
    const draft = deliveryReviewDraftFor(applicationId)
    await reviewDeliveryResultAction({
      applicationId,
      approved,
      rewardPoints: draft.rewardPoints,
      note: draft.note,
    })
    delete deliveryReviewDrafts[applicationId]
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
  }

  async function rejectApplicationWithOptions(applicationId: string, reason: string, options: RejectApplicationOptions = {}) {
    await rejectApplicationAction(applicationId, reason, options)
    delete rejectFraudulentDrafts[applicationId]
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
  }

  async function answerApplication(applicationId: string, answer: string) {
    await answerApplicationAction(applicationId, answer)
    const provisionResult = await provisionApplicationReward(welfare.currentUser.value!.id, applicationId)
    applyAutoProvisionMessage(provisionResult)
    if (provisionResult.status !== 'pending') {
      await welfare.reloadWelfareState()
      await refreshPointTransactions()
    }
  }

  async function completeApplication(applicationId: string) {
    await completeApplicationAction(applicationId)
    await welfare.reloadWelfareState()
  }

  async function requestApplicationSupplement(applicationId: string, content: string) {
    await requestApplicationSupplementAdminAction(applicationId, content)
    await welfare.reloadWelfareState()
  }

  async function submitApplicationSupplement(applicationId: string, content: string, attachments: UploadLikeFile[] = []) {
    await submitApplicationSupplementAction(applicationId, content, await uploadAttachmentImages(attachments))
    await welfare.reloadWelfareState()
  }

  async function addApplicationMessage(applicationId: string, type: ApplicationMessageType, content: string, attachments: UploadLikeFile[] = []) {
    await addApplicationMessageAction(applicationId, type, content, await uploadAttachmentImages(attachments), welfare.isAdmin.value)
    await welfare.reloadWelfareState()
  }

  async function submitApplicationResult(applicationId: string, content: string, attachments: UploadLikeFile[] = []) {
    await addApplicationMessageAction(applicationId, 'result_submission', content, await uploadAttachmentImages(attachments), welfare.isAdmin.value)
    await welfare.reloadWelfareState()
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
      logoUrl: '',
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
        logoUrl: provider.logoUrl,
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
    const config = systemConfig.value
    if (!config.siteEnabled)
      throw new Error(config.siteClosedReason)
    if (!config.loginEnabled)
      throw new Error(config.loginClosedReason)

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
      const result = await testSub2ApiConfig(welfare.currentUser.value.id, {
        enabled: sub2ApiConfigForm.enabled,
        baseUrl: sub2ApiConfigForm.baseUrl,
        adminApiKey: sub2ApiConfigForm.adminApiKey,
        defaultGroupId: sub2ApiConfigForm.defaultGroupId,
        defaultQuotaUsd: Number(sub2ApiConfigForm.defaultQuotaUsd),
        defaultExpiresInDays: Number(sub2ApiConfigForm.defaultExpiresInDays),
        defaultRateLimit5h: Number(sub2ApiConfigForm.defaultRateLimit5h),
        defaultRateLimit1d: Number(sub2ApiConfigForm.defaultRateLimit1d),
        defaultRateLimit7d: Number(sub2ApiConfigForm.defaultRateLimit7d),
      })
      sub2ApiConfigForm.groups = result.groups
      sub2ApiConfigForm.message = result.groups.length ? `Sub2API 连接测试通过，已拉取 ${result.groups.length} 个分组` : 'Sub2API 连接测试通过，未返回可选分组'
    }
    finally {
      sub2ApiConfigForm.testing = false
    }
  }

  function applyDatabaseProvisionConfig(config: Awaited<ReturnType<typeof loadDatabaseProvisionConfig>>) {
    databaseProvisionConfigForm.enabled = config.enabled
    databaseProvisionConfigForm.rootUrl = ''
    databaseProvisionConfigForm.clearRootUrl = false
    databaseProvisionConfigForm.rootUrlMasked = config.rootUrlMasked
    databaseProvisionConfigForm.defaultExpiresInDays = config.defaultExpiresInDays
    databaseProvisionConfigForm.databasePrefix = config.databasePrefix
    databaseProvisionConfigForm.onePanelBaseUrl = config.onePanelBaseUrl
    databaseProvisionConfigForm.onePanelApiKey = ''
    databaseProvisionConfigForm.clearOnePanelApiKey = false
    databaseProvisionConfigForm.onePanelApiKeyMasked = config.onePanelApiKeyMasked
    databaseProvisionConfigForm.configured = config.configured
  }

  async function refreshDatabaseProvisionConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    databaseProvisionConfigForm.loading = true
    try {
      applyDatabaseProvisionConfig(await loadDatabaseProvisionConfig(welfare.currentUser.value.id))
    }
    finally {
      databaseProvisionConfigForm.loading = false
    }
  }

  async function persistDatabaseProvisionConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    databaseProvisionConfigForm.loading = true
    databaseProvisionConfigForm.message = ''
    try {
      const result = await saveDatabaseProvisionConfig(welfare.currentUser.value.id, {
        enabled: databaseProvisionConfigForm.enabled,
        rootUrl: databaseProvisionConfigForm.rootUrl,
        clearRootUrl: databaseProvisionConfigForm.clearRootUrl,
        defaultExpiresInDays: Number(databaseProvisionConfigForm.defaultExpiresInDays),
        databasePrefix: databaseProvisionConfigForm.databasePrefix,
        onePanelBaseUrl: databaseProvisionConfigForm.onePanelBaseUrl,
        onePanelApiKey: databaseProvisionConfigForm.onePanelApiKey,
        clearOnePanelApiKey: databaseProvisionConfigForm.clearOnePanelApiKey,
      })
      applyDatabaseProvisionConfig(result)
      databaseProvisionConfigForm.message = '数据库自动发放配置已保存'
    }
    finally {
      databaseProvisionConfigForm.loading = false
    }
  }

  async function verifyDatabaseProvisionConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    databaseProvisionConfigForm.testing = true
    databaseProvisionConfigForm.message = ''
    try {
      await testDatabaseProvisionConfig(welfare.currentUser.value.id)
      databaseProvisionConfigForm.message = '数据库 root 连接测试通过'
    }
    finally {
      databaseProvisionConfigForm.testing = false
    }
  }

  async function refreshOnePanelStatus() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    databaseProvisionConfigForm.checkingOnePanel = true
    databaseProvisionConfigForm.onePanelStatus = ''
    databaseProvisionConfigForm.onePanelStatusSnapshot = null
    try {
      const snapshot = await loadOnePanelStatus(welfare.currentUser.value.id)
      databaseProvisionConfigForm.onePanelStatusSnapshot = snapshot
      const okCount = snapshot.endpoints.filter(item => item.ok).length
      databaseProvisionConfigForm.onePanelStatus = `OnePanel 状态读取完成：${okCount}/${snapshot.endpoints.length} 个端点可用`
      databaseProvisionConfigForm.message = databaseProvisionConfigForm.onePanelStatus
    }
    finally {
      databaseProvisionConfigForm.checkingOnePanel = false
    }
  }

  function applyEducationMailConfig(config: Awaited<ReturnType<typeof loadEducationMailConfig>>) {
    educationMailConfigForm.enabled = config.enabled
    educationMailConfigForm.baseUrl = config.baseUrl
    educationMailConfigForm.adminKey = ''
    educationMailConfigForm.adminKeyMasked = config.adminKeyMasked
    educationMailConfigForm.inboxAddress = config.inboxAddress
    educationMailConfigForm.lookbackHours = config.lookbackHours
    educationMailConfigForm.configured = config.configured
  }

  async function refreshEducationMailConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    educationMailConfigForm.loading = true
    try {
      applyEducationMailConfig(await loadEducationMailConfig(welfare.currentUser.value.id))
    }
    finally {
      educationMailConfigForm.loading = false
    }
  }

  async function persistEducationMailConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    educationMailConfigForm.loading = true
    educationMailConfigForm.message = ''
    try {
      const result = await saveEducationMailConfig(welfare.currentUser.value.id, {
        enabled: educationMailConfigForm.enabled,
        baseUrl: educationMailConfigForm.baseUrl,
        adminKey: educationMailConfigForm.adminKey,
        inboxAddress: educationMailConfigForm.inboxAddress,
        lookbackHours: Number(educationMailConfigForm.lookbackHours),
      })
      applyEducationMailConfig(result)
      educationMailConfigForm.message = '教育邮箱收件配置已保存'
    }
    finally {
      educationMailConfigForm.loading = false
    }
  }

  async function verifyEducationMailConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    educationMailConfigForm.testing = true
    educationMailConfigForm.message = ''
    try {
      await testEducationMailConfig(welfare.currentUser.value.id)
      educationMailConfigForm.message = 'DoneMail 连接测试通过'
    }
    finally {
      educationMailConfigForm.testing = false
    }
  }

  async function syncEducationMailVerifications() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    educationMailConfigForm.syncing = true
    educationMailConfigForm.message = ''
    try {
      const result = await syncEducationMailChallenges(welfare.currentUser.value.id)
      educationMailConfigForm.lastSync = result
      educationMailConfigForm.message = `已检查 ${result.checked} 个待验证邮件，自动确认 ${result.verified} 个`
      if (result.verified)
        await welfare.reloadWelfareState()
    }
    finally {
      educationMailConfigForm.syncing = false
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
    notificationProviderConfigForm.feishuMailEnabled = config.feishuMailEnabled
    notificationProviderConfigForm.feishuAppId = config.feishuAppId
    notificationProviderConfigForm.feishuAppSecret = ''
    notificationProviderConfigForm.feishuAppSecretMasked = config.feishuAppSecretMasked
    notificationProviderConfigForm.feishuUserAccessToken = ''
    notificationProviderConfigForm.feishuUserAccessTokenMasked = config.feishuUserAccessTokenMasked
    notificationProviderConfigForm.feishuRefreshToken = ''
    notificationProviderConfigForm.feishuRefreshTokenMasked = config.feishuRefreshTokenMasked
    notificationProviderConfigForm.feishuAccessTokenExpiresAt = config.feishuAccessTokenExpiresAt || ''
    notificationProviderConfigForm.feishuRefreshTokenExpiresAt = config.feishuRefreshTokenExpiresAt || ''
    notificationProviderConfigForm.feishuUserMailboxId = config.feishuUserMailboxId
    notificationProviderConfigForm.feishuSiteBaseUrl = config.feishuSiteBaseUrl
    notificationProviderConfigForm.feishuDailyLimit = config.feishuDailyLimit
    notificationProviderConfigForm.emailConfigured = config.configured.email
    notificationProviderConfigForm.pushConfigured = config.configured.push
    notificationProviderConfigForm.feishuMailConfigured = config.configured.feishuMail
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

  function notificationProviderConfigPayload() {
    return {
      resendApiKey: notificationProviderConfigForm.resendApiKey,
      resendFromEmail: notificationProviderConfigForm.resendFromEmail,
      vapidPublicKey: notificationProviderConfigForm.vapidPublicKey,
      vapidPrivateKey: notificationProviderConfigForm.vapidPrivateKey,
      vapidSubject: notificationProviderConfigForm.vapidSubject,
      feishuMailEnabled: notificationProviderConfigForm.feishuMailEnabled,
      feishuAppId: notificationProviderConfigForm.feishuAppId,
      feishuAppSecret: notificationProviderConfigForm.feishuAppSecret,
      feishuUserMailboxId: notificationProviderConfigForm.feishuUserMailboxId,
      feishuSiteBaseUrl: notificationProviderConfigForm.feishuSiteBaseUrl,
      feishuDailyLimit: Number(notificationProviderConfigForm.feishuDailyLimit),
    }
  }

  async function persistNotificationProviderConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.loading = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await saveNotificationProviderConfig(welfare.currentUser.value.id, notificationProviderConfigPayload())
      applyNotificationProviderConfig(result)
      notificationProviderConfigForm.message = '通知供应商配置已保存'
    }
    finally {
      notificationProviderConfigForm.loading = false
    }
  }

  async function authorizeFeishuMailProvider() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.authorizingFeishu = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await createFeishuMailAuthorization(welfare.currentUser.value.id, {
        redirect: typeof globalThis.location !== 'undefined' ? `${globalThis.location.pathname}${globalThis.location.search}` : '/dashboard/admin',
        providerConfig: notificationProviderConfigPayload(),
      })
      notificationProviderConfigForm.message = '正在跳转到飞书授权页'
      if (typeof globalThis.location !== 'undefined')
        globalThis.location.href = result.authorizationUrl
    }
    finally {
      notificationProviderConfigForm.authorizingFeishu = false
    }
  }

  async function refreshFeishuMailboxOptions() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.feishuMailboxesLoading = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await loadFeishuMailboxes(welfare.currentUser.value.id, {
        providerConfig: notificationProviderConfigPayload(),
      })
      notificationProviderConfigForm.feishuMailboxOptions = result.mailboxes
      notificationProviderConfigForm.message = result.mailboxes.length
        ? `已读取 ${result.mailboxes.length} 个飞书发信邮箱`
        : '未从飞书读取到可用发信邮箱'
    }
    finally {
      notificationProviderConfigForm.feishuMailboxesLoading = false
    }
  }

  async function sendProviderEmailTestMessage() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.testingEmail = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await sendProviderEmailTest(welfare.currentUser.value.id, {
        emailAddress: notificationProviderConfigForm.testEmailAddress,
        provider: 'feishu_mail',
        free: true,
        providerConfig: notificationProviderConfigPayload(),
      })
      notificationProviderConfigForm.testEmailAddress = result.emailAddress
      notificationProviderConfigForm.message = `飞书邮件测试已发送到 ${result.emailAddress}：${result.deliveryAttempts.map(formatEmailDeliveryAttempt).join('；')}`
      await refreshSystemLogs()
    }
    finally {
      notificationProviderConfigForm.testingEmail = false
    }
  }

  async function generateNotificationVapidKeys(regenerate = false) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    notificationProviderConfigForm.generatingVapid = true
    notificationProviderConfigForm.message = ''
    try {
      const result = await generateVapidKeys(welfare.currentUser.value.id, regenerate)
      notificationProviderConfigForm.vapidPublicKey = result.vapidPublicKey
      notificationProviderConfigForm.vapidPrivateKey = ''
      notificationProviderConfigForm.vapidPrivateKeyMasked = result.vapidPrivateKeyMasked
      notificationProviderConfigForm.vapidSubject = result.vapidSubject
      notificationProviderConfigForm.emailConfigured = result.configured.email
      notificationProviderConfigForm.pushConfigured = result.configured.push
      notificationProviderConfigForm.feishuMailConfigured = result.configured.feishuMail
      notificationProviderConfigForm.message = result.regenerated ? '浏览器 Push 密钥已重新生成' : '浏览器 Push 密钥已生成'
    }
    finally {
      notificationProviderConfigForm.generatingVapid = false
    }
  }

  function refreshSiteBannerConfig() {
    siteBannerConfigForm.enabled = welfare.state.siteBanner.enabled
    siteBannerConfigForm.title = welfare.state.siteBanner.title
    siteBannerConfigForm.body = welfare.state.siteBanner.body
    siteBannerConfigForm.tone = welfare.state.siteBanner.tone
  }

  async function persistSiteBannerConfig() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    siteBannerConfigForm.loading = true
    siteBannerConfigForm.message = ''
    try {
      await updateSiteBannerAction({
        enabled: siteBannerConfigForm.enabled,
        title: siteBannerConfigForm.title,
        body: siteBannerConfigForm.body,
        tone: siteBannerConfigForm.tone,
      })
      await welfare.reloadWelfareState()
      refreshSiteBannerConfig()
      siteBannerConfigForm.message = '顶部 Banner 已保存'
    }
    finally {
      siteBannerConfigForm.loading = false
    }
  }

  async function refreshAdminAnnouncements() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    adminAnnouncementForm.loading = true
    try {
      adminAnnouncements.value = (await loadAdminAnnouncements(welfare.currentUser.value.id)).announcements
    }
    finally {
      adminAnnouncementForm.loading = false
    }
  }

  async function refreshSystemLogs(limit = 100) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      return

    systemLogs.value = (await loadSystemLogs(welfare.currentUser.value.id, limit)).logs
  }

  async function sendAdminAnnouncement() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value || welfare.currentUser.value.role !== 'admin')
      throw new Error('需要管理员权限')

    const channels = Object.entries(adminAnnouncementForm.channels)
      .filter(([, enabled]) => enabled)
      .map(([channel]) => channel as NotificationChannel)

    adminAnnouncementForm.loading = true
    adminAnnouncementForm.message = ''
    try {
      adminAnnouncements.value = (await createAdminAnnouncement(welfare.currentUser.value.id, {
        title: adminAnnouncementForm.title,
        body: adminAnnouncementForm.body,
        channels,
        forcePopup: adminAnnouncementForm.forcePopup,
        forcePush: adminAnnouncementForm.forcePush,
      })).announcements
      adminAnnouncementForm.title = ''
      adminAnnouncementForm.body = ''
      adminAnnouncementForm.message = '管理员通告已发送'
      await refreshNotifications()
      await refreshSystemLogs()
    }
    finally {
      await refreshSystemLogs().catch(() => {})
      adminAnnouncementForm.loading = false
    }
  }

  async function submitImageGenerationApplication(applicationId?: string) {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    if (!applicationId)
      await refreshCurrentUserPointBalance()

    const security = applicationId
      ? {}
      : await prepareApplicationSecurity({
          type: 'image',
          title: applicationForm.title,
          description: applicationForm.description,
        })
    const payload: Parameters<typeof welfare.submitApplication>[0] = {
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
    }
    const application = applicationId
      ? welfare.state.applications.find(item => item.id === applicationId)
      : undefined
    const commandResult = applicationId
      ? undefined
      : await submitApplicationCommand(await withUploadedImages(payload))
    const targetApplicationId = application?.id ?? commandResult?.applicationId
    if (!targetApplicationId)
      throw new Error('图片申请不存在')
    if (application && application.type !== 'image')
      throw new Error('图片申请不存在')
    try {
      const result = await createImageJob(welfare.currentUser.value.id, application?.description ?? payload.description, targetApplicationId)
      applicationSecurityForm.message = result.status === 'pending'
        ? '图片生成已进入后台队列，请稍后刷新任务状态。'
        : '图片生成已完成'
      resetApplicationFiles()
      if (result.status !== 'pending') {
        await welfare.reloadWelfareState()
        await refreshPointTransactions()
      }
    }
    catch (error) {
      await welfare.reloadWelfareState()
      await refreshPointTransactions()
      throw error
    }
  }

  async function submitApplicationWithAiReview() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    await refreshCurrentUserPointBalance()

    const security = await prepareApplicationSecurity({
      type: applicationForm.type,
      title: applicationForm.title,
      description: applicationForm.description,
    })
    const payload: Parameters<typeof welfare.submitApplication>[0] = {
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
    }
    const application = await submitApplicationCommand(await withUploadedImages(payload))
    try {
      await createApplicationReview(welfare.currentUser.value.id, application.applicationId)
      resetApplicationFiles()
    }
    finally {
      await welfare.reloadWelfareState()
      await refreshPointTransactions()
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

  async function sendNotificationEmailTest() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    notificationSettingsForm.emailTesting = true
    try {
      const result = await sendEmailTestRequest(welfare.currentUser.value.id, {
        emailAddress: notificationSettingsForm.emailAddress,
      })
      notificationSettingsForm.emailAddress = result.emailAddress
      await Promise.all([
        refreshCurrentUserPointBalance(),
        refreshNotifications(),
      ])
    }
    finally {
      notificationSettingsForm.emailTesting = false
    }
  }

  async function enableBrowserPush() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')
    const pushConfig = await loadPushPublicKey()
    if (!pushConfig.configured || !pushConfig.publicKey)
      throw new Error('服务端尚未配置 VAPID Key')

    const result = await subscribeBrowserPush(pushConfig.publicKey)
    notificationSettingsForm.permission = result.permission
    applyNotificationSettings(await savePushSubscription(
      welfare.currentUser.value.id,
      result.subscription,
    ))
  }

  async function disableBrowserPush() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    const endpoint = await unsubscribeBrowserPush()
    applyNotificationSettings(await deletePushSubscription(welfare.currentUser.value.id, endpoint))
    notificationSettingsForm.permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  }

  async function clearFeishuWebhook() {
    welfare.assertPersistenceReady()
    if (!welfare.currentUser.value)
      throw new Error('请先登录')

    applyNotificationSettings(await saveNotificationSettings(welfare.currentUser.value.id, {
      emailEnabled: notificationSettingsForm.emailEnabled,
      emailAddress: notificationSettingsForm.emailAddress,
      feishuEnabled: false,
      clearFeishuWebhook: true,
      browserPushEnabled: notificationSettingsForm.browserPushEnabled,
    }))
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
    const config = systemConfig.value
    if (!config.siteEnabled)
      throw new Error(config.siteClosedReason)
    if (!config.rechargeEnabled)
      throw new Error(config.rechargeClosedReason)
    if (!welfare.currentUser.value)
      throw new Error('请先登录后再充值')

    const amount = Number(rechargeForm.amount)
    if (!Number.isInteger(amount) || amount <= 0)
      throw new Error('当前积分充值仅支持正整数')
    if (amount < RECHARGE_MIN_LDC || amount > RECHARGE_MAX_LDC)
      throw new Error(`单次充值金额需在 ${RECHARGE_MIN_LDC}-${RECHARGE_MAX_LDC} LDC 之间`)

    rechargeForm.loading = true
    rechargeForm.statusMessage = '正在创建 LINUX DO Credit 充值订单...'
    try {
      const result = await createRechargeOrder(amount, welfare.currentUser.value.id, rechargeForm.selectedCouponId || undefined)
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

  async function refreshCurrentUserPointBalance() {
    const user = welfare.currentUser.value
    if (!user)
      return 0

    await welfare.reloadWelfareState({ legacy: true })
    const refreshedUser = welfare.currentUser.value
    if (!refreshedUser)
      return 0

    pointTransactionSummary.balance = refreshedUser.points
    pointTransactionSummary.balanceUserId = refreshedUser.id
    return refreshedUser.points
  }

  async function refreshPointTransactions(options: Parameters<typeof loadPointTransactions>[0] & { scope?: 'current' | 'admin', reloadState?: boolean } = {}) {
    const user = welfare.currentUser.value
    if (!user)
      return

    const { scope = 'current', reloadState = true, ...query } = options
    const shouldLoadAllPages = scope === 'admin'
    pointTransactionSummary.loading = true
    pointTransactionSummary.message = ''
    try {
      const firstResult = await loadPointTransactions({
        limit: 200,
        ...query,
        userId: scope === 'current' ? user.id : query.userId,
      })
      const rows = [...firstResult.rows]
      let nextCursor = firstResult.nextCursor
      if (shouldLoadAllPages) {
        while (nextCursor) {
          const nextResult = await loadPointTransactions({
            limit: 200,
            ...query,
            cursor: nextCursor,
            userId: query.userId,
          })
          rows.push(...nextResult.rows)
          nextCursor = nextResult.nextCursor
        }
      }

      pointTransactions.value = rows
      pointTransactionSummary.income = firstResult.summary.income
      pointTransactionSummary.outcome = firstResult.summary.outcome
      pointTransactionSummary.count = firstResult.summary.count
      if (scope === 'current') {
        pointTransactionSummary.balance = firstResult.balance
        pointTransactionSummary.balanceUserId = user.id
        if (reloadState)
          await welfare.reloadWelfareState()
      }
    }
    catch (error) {
      pointTransactionSummary.message = error instanceof Error ? error.message : '积分流水加载失败'
      throw error
    }
    finally {
      pointTransactionSummary.loading = false
    }
  }

  async function checkInToday() {
    const result = await checkInTodayAction()
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
    if (!result.checkIn)
      throw new Error('签到结果为空')
    return result.checkIn
  }

  async function bindInvitationCode() {
    const result = await bindInvitationCodeAction(invitationForm.code)
    invitationForm.code = ''
    invitationForm.message = '邀请关系已绑定'
    await welfare.reloadWelfareState()
    return result
  }

  async function vouchInvitation(bindingId: string) {
    const result = await vouchInvitationAction(bindingId)
    invitationForm.message = '担保状态已更新'
    await welfare.reloadWelfareState()
    return result
  }

  async function redeemCouponCodeFromForm() {
    const result = await redeemCouponCodeAction(couponRedeemForm.code)
    couponRedeemForm.code = ''
    couponRedeemForm.message = result.coupon?.name ? `已兑换：${result.coupon.name}` : '兑换成功'
    await welfare.reloadWelfareState()
    if (!result.coupon)
      throw new Error('优惠券兑换结果为空')
    return result.coupon
  }

  async function createCouponTemplateFromForm() {
    const result = await createCouponTemplateAction({
      name: couponTemplateForm.name,
      description: couponTemplateForm.description,
      enabled: true,
      ttlDays: Number(couponTemplateForm.ttlDays),
      totalGrantLimit: Number(couponTemplateForm.totalGrantLimit) || undefined,
      rule: {
        scope: couponTemplateForm.scope,
        discountType: couponTemplateForm.discountType,
        discountRate: Number(couponTemplateForm.discountFold) / 10,
        discountAmount: Number(couponTemplateForm.discountAmount),
        resourceTypes: couponTemplateForm.resourceTypes,
        minSpend: Number(couponTemplateForm.minSpend),
        maxDiscount: Number(couponTemplateForm.maxDiscount),
      },
    })
    if (!result.template)
      throw new Error('优惠券模板创建结果为空')
    couponCodeForm.templateId = result.template.id
    couponGrantForm.templateId = result.template.id
    await welfare.reloadWelfareState()
    return result.template
  }

  async function createCouponCodeFromForm() {
    const result = await createCouponCodeAction({
      templateId: couponCodeForm.templateId,
      code: couponCodeForm.code || undefined,
      maxRedemptions: Number(couponCodeForm.maxRedemptions),
      perUserLimit: Number(couponCodeForm.perUserLimit),
      expiresAt: couponCodeForm.expiresAt || undefined,
    })
    couponCodeForm.code = ''
    await welfare.reloadWelfareState()
    if (!result.code)
      throw new Error('兑换码创建结果为空')
    return result.code
  }

  async function grantCouponFromTemplateForm() {
    const result = await grantCouponsAction(couponGrantForm.userIds, couponGrantForm.templateId)
    couponGrantForm.userIds = []
    await welfare.reloadWelfareState()
    return result.coupons ?? []
  }

  async function createSquarePost() {
    const postType = squarePostForm.applicationId ? 'application_template' : squarePostForm.postType
    const result = await createSquarePostAction({
      type: postType,
      title: squarePostForm.title,
      content: squarePostForm.content,
      applicationId: squarePostForm.applicationId || undefined,
      shareTemplate: postType === 'application_template',
    })
    squarePostForm.postType = 'review'
    squarePostForm.title = ''
    squarePostForm.content = ''
    squarePostForm.applicationId = ''
    squarePostForm.shareTemplate = true
    await welfare.reloadWelfareState()
    if (!result.post)
      throw new Error('广场内容创建结果为空')
    return result.post
  }

  async function boostSquarePost(postId: string) {
    const result = await boostSquarePostAction(postId, squareBoostDrafts[postId] || '')
    delete squareBoostDrafts[postId]
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
    return result
  }

  async function reportSquareBoost(boostId: string) {
    const result = await reportSquareBoostAction(boostId, squareReportDrafts[boostId] || '')
    delete squareReportDrafts[boostId]
    await welfare.reloadWelfareState()
    await refreshPointTransactions()
    return result
  }

  function recordBackgroundRefreshError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback
    pointTransactionSummary.message = message
    console.error(error)
  }

  function refreshStateInBackground() {
    void welfare.reloadWelfareState().catch(error => recordBackgroundRefreshError(error, '状态刷新失败'))
  }

  function refreshStateAndPointsInBackground() {
    void Promise.allSettled([
      welfare.reloadWelfareState(),
      refreshPointTransactions({ reloadState: false }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected')
          recordBackgroundRefreshError(result.reason, '积分流水刷新失败')
      }
    })
  }

  async function submitStudentVerification(payload: Parameters<typeof welfare.submitStudentVerification>[0]) {
    await submitStudentVerificationAction(await withUploadedImages(payload))
    refreshStateAndPointsInBackground()
  }

  async function supplementStudentVerification(payload: Parameters<typeof welfare.supplementStudentVerification>[0]) {
    await supplementStudentVerificationAction(await withUploadedImages(payload))
    refreshStateInBackground()
  }

  async function submitAdminStudentVerificationFromForm() {
    if (!adminStudentVerificationForm.userId)
      throw new Error('请选择用户')

    adminStudentVerificationForm.submitting = true
    adminStudentVerificationForm.message = ''
    try {
      await submitAdminStudentVerificationAction(await withUploadedImages({
        userId: adminStudentVerificationForm.userId,
        verificationType: adminStudentVerificationForm.verificationType,
        realName: adminStudentVerificationForm.realName,
        category: adminStudentVerificationForm.category,
        school: adminStudentVerificationForm.school,
        identity: adminStudentVerificationForm.identity,
        grade: adminStudentVerificationForm.grade,
        educationLevel: adminStudentVerificationForm.educationLevel,
        educationEmail: adminStudentVerificationForm.educationEmail,
        educationEmailVerified: adminStudentVerificationForm.educationEmailVerified,
        notes: adminStudentVerificationForm.notes,
        attachments: adminStudentVerificationFiles.value,
      }))
      adminStudentVerificationForm.message = '已代用户提交认证，等待审核处理'
      resetAdminStudentVerificationForm()
      await welfare.reloadWelfareState()
    }
    finally {
      adminStudentVerificationForm.submitting = false
    }
  }

  async function approveStudentVerification(id: string, reply: string) {
    await reviewStudentVerificationAction(id, 'approved', reply)
    refreshStateAndPointsInBackground()
  }

  async function requestStudentSupplement(id: string, reason: string) {
    await reviewStudentVerificationAction(id, 'needs_supplement', reason)
    refreshStateInBackground()
  }

  async function rejectStudentVerification(id: string, reason: string) {
    await reviewStudentVerificationAction(id, 'rejected', reason)
    refreshStateAndPointsInBackground()
  }

  async function persistStateAndReload() {
    await welfare.reloadWelfareState()
  }

  async function updateCurrentProfile(profile: Partial<UserProfile>) {
    await updateCurrentProfileAction(profile)
    await welfare.reloadWelfareState()
  }

  async function setUserCrowdReviewer(userId: string, enabled: boolean) {
    await setUserCrowdReviewerAction(userId, enabled)
    await persistStateAndReload()
  }

  async function setUserSuspended(userId: string, suspended: boolean, reason = '') {
    await setUserSuspendedAction(userId, suspended, reason)
    await persistStateAndReload()
  }

  async function setUserStudentVerified(userId: string, verified: boolean) {
    await setUserStudentVerifiedAction(userId, verified)
    await persistStateAndReload()
  }

  async function revokeUserStudentVerification(userId: string, reason: string) {
    await revokeUserStudentVerificationAction(userId, reason)
    await persistStateAndReload()
  }

  async function unbindUserGitHub(userId: string) {
    await unbindUserGitHubAction(userId)
    await persistStateAndReload()
  }

  return {
    ...welfare,
    updateCurrentProfile,
    setUserCrowdReviewer,
    setUserSuspended,
    setUserStudentVerified,
    revokeUserStudentVerification,
    unbindUserGitHub,
    adminForm,
    adminLoginForm,
    profileForm,
    invitationForm,
    couponRedeemForm,
    couponTemplateForm,
    couponCodeForm,
    couponGrantForm,
    rechargeForm,
    rechargeConfigForm,
    pointTransactions,
    pointTransactionSummary,
    currentUserPointBalance,
    currentUserPointBalanceText,
    hasCurrentUserPointBalance,
    githubAppConfigForm,
    githubAuthorizationForm,
    oauthConfigForm,
    oauthProviderConfigs,
    publicOAuthProviders,
    oauthLoginForm,
    aiConfigForm,
    sub2ApiConfigForm,
    databaseProvisionConfigForm,
    sub2ApiKeyForm,
    sub2ApiKeys,
    generatedSub2ApiKey,
    educationMailConfigForm,
    notificationProviderConfigForm,
    siteBannerConfigForm,
    systemConfigForm,
    activeSiteBanner,
    systemConfig,
    loginFeatureEnabled,
    registrationFeatureEnabled,
    rechargeFeatureEnabled,
    adminAnnouncementForm,
    adminAnnouncements,
    systemLogs,
    temporaryAiKey,
    temporaryAiKeyExpiresAt,
    temporaryAiKeyForm,
    temporaryAiKeys,
    generatedTemporaryAiKey,
    notificationSettingsForm,
    notificationList,
    unreadNotificationCount,
    notificationsLoading,
    isNotificationDrawerOpen,
    applicationSecurityForm,
    applicationPolicyConfigForm,
    lastRechargeStatus,
    applicationForm,
    resourceApplicationForm,
    squarePostForm,
    squareBoostDrafts,
    squareReportDrafts,
    resourceApplicationItems,
    resourceReviewDrafts,
    resourceProvisionDrafts,
    applicationAllocationDrafts,
    resourceAutoProvisionMessage,
    applicationFiles,
    studentForm,
    adminStudentVerificationForm,
    educationEmailVerificationForm,
    studentFiles,
    adminStudentVerificationFiles,
    verificationTypeOptions,
    frontlineCategoryOptions,
    studentCategoryOptions,
    studentEducationLevelOptions,
    studentGradeOptions,
    studentSchoolSuggestions: STUDENT_SCHOOL_SUGGESTIONS,
    reviewDrafts,
    supplementDrafts,
    rejectFraudulentDrafts,
    crowdReviewDrafts,
    collaborationApplicationForm,
    collaborationReviewDrafts,
    deliveryResultDrafts,
    deliveryReviewDrafts,
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
    selectableLlmApiModels,
    selectedLlmApiModel,
    repoOptions,
    totalApplicationBytes,
    totalStudentBytes,
    totalAdminStudentVerificationBytes,
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
    availableResourceCoupons,
    availableRechargeCoupons,
    couponTemplates,
    couponCodes,
    couponRedemptions,
    currentUserRejectionFeeWaiverBlockedUntil,
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
    fillStudentFormFromVerification,
    resetEducationEmailVerificationForm,
    typeIcon,
    resetApplicationSecurity,
    setApplicationTurnstileToken,
    prepareApplicationSecurity,
    resetApplicationFiles,
    addResourceApplicationItem,
    removeResourceApplicationItem,
    ensureSelectedResourceItems,
    resetResourceApplicationForm,
    fillResourceApplicationFormFromDraft,
    submitResourceApplication,
    updateResourceDraft,
    resourceReviewDraftFor,
    provisionDraftFor,
    allocationDraftFor,
    approveResourceItem,
    completeResourceProvision,
    completeApplicationAllocation,
    requestResourceLifecycle,
    updateResourceLifecycle,
    resetStudentFiles,
    resetAdminStudentVerificationForm,
    submitStudentVerification,
    supplementStudentVerification,
    submitAdminStudentVerificationFromForm,
    approveStudentVerification,
    requestStudentSupplement,
    rejectStudentVerification,
    generateEducationEmailChallenge,
    copyEducationEmailTemplate,
    openEducationEmailClient,
    confirmEducationEmailSent,
    checkInToday,
    bindInvitationCode,
    vouchInvitation,
    redeemCouponCodeFromForm,
    createCouponTemplateFromForm,
    createCouponCodeFromForm,
    grantCouponFromTemplateForm,
    refreshSystemConfigForm,
    persistSystemConfig,
    persistApplicationPolicy,
    crowdReviewDraftFor,
    submitCrowdReviewDraft,
    collaborationReviewDraftFor,
    deliveryReviewDraftFor,
    submitCollaborationApplicationFromForm,
    reviewCollaborationApplication,
    claimDeliveryApplication,
    cancelDeliveryClaim,
    submitDeliveryResult,
    reviewDeliveryResult,
    rejectApplicationWithOptions,
    answerApplication,
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
    refreshDatabaseProvisionConfig,
    persistDatabaseProvisionConfig,
    verifyDatabaseProvisionConfig,
    refreshOnePanelStatus,
    refreshEducationMailConfig,
    persistEducationMailConfig,
    verifyEducationMailConfig,
    syncEducationMailVerifications,
    refreshSub2ApiKeys,
    generateSub2ApiKey,
    revokeSub2ApiKey,
    refreshTemporaryAiKeys,
    revokeTemporaryAiKey,
    refreshNotificationProviderConfig,
    persistNotificationProviderConfig,
    authorizeFeishuMailProvider,
    refreshFeishuMailboxOptions,
    sendProviderEmailTestMessage,
    generateNotificationVapidKeys,
    refreshSiteBannerConfig,
    persistSiteBannerConfig,
    refreshAdminAnnouncements,
    refreshSystemLogs,
    sendAdminAnnouncement,
    generateTemporaryAiKey,
    submitImageGenerationApplication,
    submitApplicationWithAiReview,
    refreshCurrentUserPointBalance,
    refreshNotifications,
    refreshNotificationSettings,
    persistNotificationSettings,
    sendNotificationEmailTest,
    enableBrowserPush,
    disableBrowserPush,
    clearFeishuWebhook,
    readNotification,
    readAllNotifications,
    startRecharge,
    refreshRechargeStatus,
    refreshPointTransactions,
    createSquarePost,
    boostSquarePost,
    reportSquareBoost,
  }
}
