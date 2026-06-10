<script setup lang="ts">
import type { OAuthProviderConfigView } from '~/composables/oauth'
import type { CreditTransaction, RequestKind, ResourceGovernanceQueueItem, StudentVerification, UserCoupon, WelfareApplication } from '~/composables/welfare'
import { FileUploader, TxButton, TxCard, TxCheckbox, TxDrawer, TxFlipOverlay, TxInput, TxNumberInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { buildResourceGovernanceSnapshot, formatBytes, formatDate, formatPoints, isGptProModel, MAX_ATTACHMENT_BYTES, normalizeVerificationType, resourceTypeLabel, verificationOrganizationLabel, verificationTypeLabel } from '~/composables/welfare'
import { adjustUserPointsAction, updateOauthConfigAction } from '~/composables/welfare-persistence'
import { ADMIN_TABS, adminTabKeyFromName, adminTabNameFromKey, useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from '../RichTextEditor.vue'
import RichTextView from '../RichTextView.vue'
import VerificationAttachmentGrid from '../VerificationAttachmentGrid.vue'

const {
  state,
  currentUser,
  isAdmin,
  reloadWelfareState,
  pointDrafts,
  userLevelCard,
  setUserCrowdReviewer,
  setUserSuspended,
  revokeUserStudentVerification,
  submitAdminStudentVerificationFromForm,
  resetAdminStudentVerificationForm,
  unbindUserGitHub,
  rechargeConfigForm,
  githubAppConfigForm,
  oauthConfigForm,
  oauthProviderConfigs,
  applicationPolicyConfigForm,
  adminStudentVerificationForm,
  adminStudentVerificationFiles,
  totalAdminStudentVerificationBytes,
  aiConfigForm,
  sub2ApiConfigForm,
  databaseProvisionConfigForm,
  educationMailConfigForm,
  notificationProviderConfigForm,
  siteBannerConfigForm,
  systemConfigForm,
  adminAnnouncementForm,
  adminAnnouncements,
  systemLogs,
  pointTransactions,
  pointTransactionSummary,
  activeAdminTab,
  pendingCollaborationApplications,
  pendingDeliveryReviewApplications,
  collaborationReviewDraftFor,
  deliveryReviewDraftFor,
  reviewCollaborationApplication,
  reviewDeliveryResult,
  updateResourceLifecycle,
  refreshRechargeConfig,
  persistRechargeConfig,
  refreshGitHubAppConfig,
  persistGitHubAppConfig,
  refreshOAuthProviderConfigs,
  persistOAuthProviderConfigs,
  persistApplicationPolicy,
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
  refreshNotificationProviderConfig,
  persistNotificationProviderConfig,
  authorizeFeishuMailProvider,
  sendProviderEmailTestMessage,
  generateNotificationVapidKeys,
  refreshSiteBannerConfig,
  persistSiteBannerConfig,
  refreshSystemConfigForm,
  persistSystemConfig,
  refreshAdminAnnouncements,
  refreshSystemLogs,
  refreshPointTransactions,
  sendAdminAnnouncement,
} = useWelfareUiState()

const { notify, runSafely } = useWelfareFeedback()
const route = useRoute()
const router = useRouter()

const ADMIN_TAB_QUERY_KEY = 'tab'

function currentRouteAdminTabKey() {
  const tab = route.query[ADMIN_TAB_QUERY_KEY]
  if (Array.isArray(tab))
    return tab[0] ?? undefined
  return tab ?? undefined
}

watch(
  () => route.query[ADMIN_TAB_QUERY_KEY],
  () => {
    const tabName = adminTabNameFromKey(currentRouteAdminTabKey())
    if (tabName && activeAdminTab.value !== tabName)
      activeAdminTab.value = tabName
  },
  { immediate: true },
)

watch(activeAdminTab, (tabName) => {
  if (route.path !== '/dashboard/admin')
    return

  const tabKey = adminTabKeyFromName(tabName)
  if (currentRouteAdminTabKey() === tabKey)
    return

  router.replace({
    path: route.path,
    query: {
      ...route.query,
      [ADMIN_TAB_QUERY_KEY]: tabKey,
    },
  })
})

interface ListFilterState {
  query: string
  from: string
  to: string
  page: number
  pageSize: number
}

interface AuditEvent {
  id: string
  time: string
  area: string
  action: string
  actor: string
  detail: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}

const ALL_FILTER = 'all'
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50]
const USER_DETAIL_LIMIT = 6
const USER_DRAWER_Z_INDEX = 120
const REQUEST_TYPE_ORDER: RequestKind[] = ['code', 'image', 'pro', 'resource']
const APPLICATION_POLICY_TYPES = REQUEST_TYPE_ORDER
const DAY_MS = 24 * 60 * 60 * 1000
const DASHBOARD_TREND_DAY_COUNT = 7
const DASHBOARD_TREND_WIDTH = 320
const DASHBOARD_TREND_HEIGHT = 128
const DASHBOARD_TREND_PADDING = 14
const DONE_APPLICATION_STATUSES = new Set(['answered', 'delivered', 'completed', 'closed', 'approved', 'partial_approved'])
const WAITING_APPLICATION_STATUSES = new Set(['reserved', 'pending_review', 'needs_supplement', 'submitted', 'pending_allocation'])
const PROCESSING_APPLICATION_STATUSES = new Set(['processing', 'in_review'])
const USER_DRAWER_TABS = {
  account: 'account',
  verification: 'verification',
  wallet: 'wallet',
  records: 'records',
} as const
type UserDrawerTab = typeof USER_DRAWER_TABS[keyof typeof USER_DRAWER_TABS]
type EditableOAuthProviderConfig = OAuthProviderConfigView & { clientSecret: string }

const LINUX_DO_OAUTH_PRESET: EditableOAuthProviderConfig = {
  id: 'linux-do',
  name: 'LINUX DO',
  logoUrl: '',
  enabled: true,
  configured: false,
  builtin: true,
  clientId: '',
  clientSecret: '',
  clientSecretMasked: '',
  callbackUrl: defaultOAuthCallbackUrl(),
  authorizeUrl: 'https://connect.linux.do/oauth2/authorize',
  tokenUrl: 'https://connect.linux.do/oauth2/token',
  userInfoUrl: 'https://connect.linux.do/api/user',
  issuerUrl: 'https://linux.do',
  scopes: '',
}

const isOAuthProviderDialogOpen = ref(false)
const isVapidRegenerateDialogOpen = ref(false)
const oauthProviderDialogMode = ref<'create' | 'edit'>('create')
const editingOAuthProviderId = ref('')
const oauthProviderDraft = reactive<EditableOAuthProviderConfig>({
  id: '',
  name: '',
  logoUrl: '',
  enabled: true,
  configured: false,
  builtin: false,
  clientId: '',
  clientSecret: '',
  clientSecretMasked: '',
  callbackUrl: '',
  authorizeUrl: '',
  tokenUrl: '',
  userInfoUrl: '',
  issuerUrl: '',
  scopes: 'openid profile email',
})

const applicationTypeText: Record<string, string> = {
  code: 'LLMApi 申请',
  image: 'Image 申请',
  pro: 'Pro 申请',
  resource: '资源申请',
}

const applicationStatusText: Record<string, string> = {
  draft: '草稿',
  reserved: '已提交',
  pending_review: '待审核',
  needs_supplement: '待补充资料',
  processing: '处理中',
  answered: '已答复',
  pending_allocation: '待分配资源',
  delivered: '已交付',
  completed: '已完成',
  closed: '已关闭',
  rejected: '已退回',
  submitted: '已提交',
  in_review: '资源审批中',
  approved: '已通过',
  partial_approved: '部分通过',
  cancelled: '已取消',
}

const studentStatusText: Record<string, string> = {
  pending: '待审核',
  needs_supplement: '待补充资料',
  approved: '已通过',
  rejected: '已退回',
  revoked: '已撤销',
}

const verificationTypeFilterOptions = [
  { value: ALL_FILTER, label: '全部认证' },
  { value: 'student', label: '学生认证' },
  { value: 'frontline', label: '一线认证' },
]

const transactionTypeText: Record<string, string> = {
  recharge: '充值',
  spend: '扣费',
  refund: '返还',
  adjustment: '调整',
  grant: '发放',
}

const dashboardActivityTypeText: Record<string, string> = {
  user: '用户',
  application: '申请',
  student: '认证申请',
  transaction: '积分',
}

const resourceLifecycleStatusText: Record<string, string> = {
  pending: '待审批',
  approved: '待发放',
  rejected: '已驳回',
  provisioning: '发放中',
  active: '使用中',
  renewal_requested: '续期审批中',
  expired: '已过期',
  reclaim_pending: '待回收',
  returned: '已归还',
  released: '已释放',
  closed: '已关闭',
}

const userRoleFilterOptions = [
  { value: ALL_FILTER, label: '全部角色' },
  { value: 'admin', label: '管理员' },
  { value: 'reviewer', label: '协作处理员' },
  { value: 'user', label: '普通用户' },
]

const userVerificationFilterOptions = [
  { value: ALL_FILTER, label: '全部认证' },
  { value: 'student', label: '学生已认证' },
  { value: 'github', label: 'GitHub 已授权' },
  { value: 'none', label: '未认证' },
]

const dashboardActivityTypeOptions = [
  { value: ALL_FILTER, label: '全部活动' },
  { value: 'user', label: '用户' },
  { value: 'application', label: '申请' },
  { value: 'student', label: '认证申请' },
  { value: 'transaction', label: '积分' },
]

const applicationTypeFilterOptions = [
  { value: ALL_FILTER, label: '全部类型' },
  { value: 'code', label: applicationTypeText.code },
  { value: 'image', label: applicationTypeText.image },
  { value: 'pro', label: applicationTypeText.pro },
  { value: 'resource', label: applicationTypeText.resource },
]

const applicationStatusFilterOptions = [
  { value: ALL_FILTER, label: '全部状态' },
  { value: 'reserved', label: applicationStatusText.reserved },
  { value: 'pending_review', label: applicationStatusText.pending_review },
  { value: 'needs_supplement', label: applicationStatusText.needs_supplement },
  { value: 'answered', label: applicationStatusText.answered },
  { value: 'pending_allocation', label: applicationStatusText.pending_allocation },
  { value: 'delivered', label: applicationStatusText.delivered },
  { value: 'completed', label: applicationStatusText.completed },
  { value: 'rejected', label: applicationStatusText.rejected },
]

const studentStatusFilterOptions = [
  { value: ALL_FILTER, label: '全部状态' },
  { value: 'pending', label: studentStatusText.pending },
  { value: 'needs_supplement', label: studentStatusText.needs_supplement },
  { value: 'approved', label: studentStatusText.approved },
  { value: 'rejected', label: studentStatusText.rejected },
  { value: 'revoked', label: studentStatusText.revoked },
]

const transactionTypeFilterOptions = [
  { value: ALL_FILTER, label: '全部类型' },
  { value: 'recharge', label: transactionTypeText.recharge },
  { value: 'spend', label: transactionTypeText.spend },
  { value: 'refund', label: transactionTypeText.refund },
  { value: 'adjustment', label: transactionTypeText.adjustment },
  { value: 'grant', label: transactionTypeText.grant },
]

const transactionDirectionFilterOptions = [
  { value: ALL_FILTER, label: '全部方向' },
  { value: 'in', label: '入账' },
  { value: 'out', label: '扣减' },
]

const bannerToneOptions = [
  { value: 'info', label: '提示' },
  { value: 'success', label: '成功' },
  { value: 'warning', label: '警示' },
] as const

const announcementChannelOptions = [
  { value: 'in_app', label: '站内' },
  { value: 'email', label: '邮件' },
  { value: 'feishu', label: '飞书' },
  { value: 'browser_push', label: '浏览器推送' },
] as const

const EMAIL_ADDRESS_PATTERN = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i

const auditAreaFilterOptions = [
  { value: ALL_FILTER, label: '全部模块' },
  { value: '用户', label: '用户' },
  { value: '积分', label: '积分' },
  { value: '申请', label: '申请' },
  { value: '认证申请', label: '认证申请' },
]

const userFilters = reactive({
  query: '',
  from: '',
  to: '',
  role: ALL_FILTER,
  verification: ALL_FILTER,
  page: 1,
  pageSize: 10,
})

const dashboardActivityFilters = reactive({
  query: '',
  from: '',
  to: '',
  type: ALL_FILTER,
  page: 1,
  pageSize: 10,
})

const applicationFilters = reactive({
  query: '',
  from: '',
  to: '',
  type: ALL_FILTER,
  status: ALL_FILTER,
  page: 1,
  pageSize: 10,
})

const studentFilters = reactive({
  query: '',
  from: '',
  to: '',
  verificationType: ALL_FILTER,
  status: ALL_FILTER,
  page: 1,
  pageSize: 10,
})

const transactionFilters = reactive({
  query: '',
  from: '',
  to: '',
  type: ALL_FILTER,
  direction: ALL_FILTER,
  page: 1,
  pageSize: 10,
})

const auditFilters = reactive({
  query: '',
  from: '',
  to: '',
  area: ALL_FILTER,
  page: 1,
  pageSize: 10,
})
const selectedUserId = ref('')
const isUserDrawerOpen = ref(false)
const userDrawerMode = ref<'detail' | 'points'>('detail')
const activeUserDrawerTab = ref<UserDrawerTab>(USER_DRAWER_TABS.account)
const pendingAdminUserAction = ref('')
const revokeStudentReason = ref('')
const selectedStudentVerificationId = ref('')
const isStudentVerificationDialogOpen = ref(false)
const studentVerificationDialogSource = ref<HTMLElement | null>(null)
const isUserStudentVerificationCreateOpen = ref(false)
const adminTransactions = computed(() => pointTransactions.value)
const feishuSenderMailboxOptions = computed(() => {
  const options = [
    {
      label: '用户邮箱',
      value: currentUser.value?.profile.email,
    },
    {
      label: '公告邮箱',
      value: notificationProviderConfigForm.resendFromEmail.match(EMAIL_ADDRESS_PATTERN)?.[0],
    },
  ].filter((item): item is { label: string, value: string } => !!item.value?.trim())

  return options.filter((item, index) => options.findIndex(option => option.value === item.value) === index)
})

function userDisplayName(userId: string) {
  return state.users.find(user => user.id === userId)?.profile.displayName ?? '未知用户'
}

function signedPoints(value: number) {
  return value > 0 ? `+${formatPoints(value)}` : formatPoints(value)
}

function couponDiscountText(rate: number) {
  return `${Number(rate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function couponStatusText(coupon: UserCoupon) {
  if (coupon.usedAt)
    return '已使用'
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now())
    return '已过期'
  return '可用'
}

function couponSourceText(source: string) {
  if (source === 'manual')
    return '管理员发放'
  if (source === 'daily_streak_7')
    return '连续签到 7 天'
  return '连续签到 3 天'
}

function couponStatusTone(coupon: UserCoupon) {
  if (coupon.usedAt)
    return 'info'
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now())
    return 'danger'
  return 'success'
}

function llmBudgetText(application: WelfareApplication) {
  if (!application.llmApiBudgetUsd)
    return '-'
  return isGptProModel(application.llmApiModelKey) ? `${application.llmApiBudgetUsd} 轮` : `$${application.llmApiBudgetUsd}`
}

function statusPillClass(status: string) {
  if (['answered', 'approved', 'delivered', 'completed', 'closed', 'success', 'active', 'released', 'returned'].includes(status))
    return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
  if (['pending_review', 'needs_supplement', 'processing', 'pending', 'reserved', 'warning', 'provisioning', 'renewal_requested', 'pending_allocation'].includes(status))
    return 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'
  if (['rejected', 'revoked', 'danger', 'error', 'expired', 'reclaim_pending'].includes(status))
    return 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-950/30'
  return 'text-slate-700 bg-slate-100 dark:text-slate-200 dark:bg-white/10'
}

function roleText(role: string) {
  if (role === 'admin')
    return '管理员'
  if (role === 'reviewer')
    return '协作处理员'
  return '普通用户'
}

function roleToneClass(role: string) {
  if (role === 'admin')
    return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
  if (role === 'reviewer')
    return 'text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30'
  return 'text-slate-700 bg-slate-100 dark:text-slate-200 dark:bg-white/10'
}

function accountStatusText(status?: string) {
  return status === 'suspended' ? '已封禁' : '正常'
}

function accountStatusToneClass(status?: string) {
  if (status === 'suspended')
    return 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-950/30'
  return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
}

function levelToneClass(tone: string) {
  if (tone === 'success')
    return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
  if (tone === 'warning')
    return 'text-violet-700 bg-violet-50 dark:text-violet-200 dark:bg-violet-950/30'
  return 'text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30'
}

function auditToneClass(tone: string) {
  if (tone === 'success')
    return 'text-emerald-700 bg-emerald-50 ring-emerald-200 dark:text-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-400/20'
  if (tone === 'warning')
    return 'text-amber-700 bg-amber-50 ring-amber-200 dark:text-amber-200 dark:bg-amber-950/30 dark:ring-amber-400/20'
  if (tone === 'danger')
    return 'text-rose-700 bg-rose-50 ring-rose-200 dark:text-rose-200 dark:bg-rose-950/30 dark:ring-rose-400/20'
  return 'text-slate-700 bg-slate-100 ring-slate-200 dark:text-slate-200 dark:bg-white/10 dark:ring-white/10'
}

function applicationTypeLabel(type: string) {
  return applicationTypeText[type] ?? type
}

function applicationStatusLabel(status: string) {
  return applicationStatusText[status] ?? status
}

function studentStatusLabel(status: string) {
  return studentStatusText[status] ?? status
}

function transactionTypeLabel(type: string) {
  return transactionTypeText[type] ?? type
}

function sumTransactions(rows: CreditTransaction[]) {
  return rows.reduce((sum, item) => sum + item.delta, 0)
}

function percentOf(value: number, total: number) {
  if (total <= 0)
    return 0
  return Math.round((value / total) * 100)
}

function barPercent(value: number, total: number) {
  if (value <= 0 || total <= 0)
    return 0
  return Math.max(7, percentOf(value, total))
}

function percentLabel(value: number, total: number) {
  return `${percentOf(value, total)}%`
}

function safeDateTime(value?: string) {
  if (!value)
    return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function shortDateLabel(time: number) {
  return new Date(time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function isWithinDay(value: string | undefined, dayStart: number) {
  const time = safeDateTime(value)
  return time >= dayStart && time < dayStart + DAY_MS
}

function lineChartPoint(value: number, maxValue: number, index: number, total: number) {
  const chartWidth = DASHBOARD_TREND_WIDTH - DASHBOARD_TREND_PADDING * 2
  const chartHeight = DASHBOARD_TREND_HEIGHT - DASHBOARD_TREND_PADDING * 2
  const x = DASHBOARD_TREND_PADDING + (total <= 1 ? 0 : (chartWidth / (total - 1)) * index)
  const y = DASHBOARD_TREND_PADDING + chartHeight - (maxValue <= 0 ? 0 : (value / maxValue) * chartHeight)
  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) }
}

function isApplicationRef(refId?: string) {
  return !!refId && state.applications.some(item => item.id === refId)
}

function isStudentRef(refId?: string) {
  return !!refId && state.studentVerifications.some(item => item.id === refId)
}

function isPipelineSpendTransaction(item: CreditTransaction) {
  return item.delta < 0 && (
    isApplicationRef(item.refId)
    || item.reason.includes('申请')
    || item.reason.includes('Pro')
    || item.reason.includes('延长申请存储')
  )
}

function linkedRecordTitle(item: CreditTransaction) {
  const application = state.applications.find(record => record.id === item.refId)
  if (application)
    return `${applicationTypeLabel(application.type)} · ${application.title}`

  const verification = state.studentVerifications.find(record => record.id === item.refId)
  if (verification)
    return `学生认证 · ${verification.category}`

  return item.refId || '无关联记录'
}

function formatOptionalDate(value?: string) {
  return value ? formatDate(value) : '未记录'
}

function dateInputTime(value: string, endOfDay = false) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day)
    return undefined

  const time = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
  return Number.isFinite(time) ? time : undefined
}

function isInDateRange(value: string | undefined, filters: Pick<ListFilterState, 'from' | 'to'>) {
  if (!filters.from && !filters.to)
    return true
  if (!value)
    return false

  const time = new Date(value).getTime()
  if (!Number.isFinite(time))
    return false

  const from = dateInputTime(filters.from)
  const to = dateInputTime(filters.to, true)
  return (from === undefined || time >= from) && (to === undefined || time <= to)
}

function matchesQuery(query: string, fields: Array<string | number | undefined | null>) {
  const keyword = query.trim().toLowerCase()
  if (!keyword)
    return true

  return fields.some(field => String(field ?? '').toLowerCase().includes(keyword))
}

function paginateRows<T>(rows: T[], filters: ListFilterState) {
  const pageSize = Number(filters.pageSize) || PAGE_SIZE_OPTIONS[1]
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Number(filters.page) || 1), totalPages)
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages,
    start,
    end,
  }
}

function resetBaseFilters(filters: ListFilterState) {
  filters.query = ''
  filters.from = ''
  filters.to = ''
  filters.page = 1
}

function previousPage(filters: ListFilterState) {
  filters.page = Math.max(1, filters.page - 1)
}

function nextPage(filters: ListFilterState, totalPages: number) {
  filters.page = Math.min(totalPages, filters.page + 1)
}

function resetUserFilters() {
  resetBaseFilters(userFilters)
  userFilters.role = ALL_FILTER
  userFilters.verification = ALL_FILTER
}

function resetDashboardActivityFilters() {
  resetBaseFilters(dashboardActivityFilters)
  dashboardActivityFilters.type = ALL_FILTER
}

function resetApplicationFilters() {
  resetBaseFilters(applicationFilters)
  applicationFilters.type = ALL_FILTER
  applicationFilters.status = ALL_FILTER
}

function resetStudentFilters() {
  resetBaseFilters(studentFilters)
  studentFilters.verificationType = ALL_FILTER
  studentFilters.status = ALL_FILTER
}

function resetTransactionFilters() {
  resetBaseFilters(transactionFilters)
  transactionFilters.type = ALL_FILTER
  transactionFilters.direction = ALL_FILTER
}

function resetAuditFilters() {
  resetBaseFilters(auditFilters)
  auditFilters.area = ALL_FILTER
}

function openUserDrawer(userId: string, mode: 'detail' | 'points' = 'detail') {
  selectedUserId.value = userId
  userDrawerMode.value = mode
  activeUserDrawerTab.value = mode === 'points' ? USER_DRAWER_TABS.wallet : USER_DRAWER_TABS.account
  pendingAdminUserAction.value = ''
  revokeStudentReason.value = ''
  isUserStudentVerificationCreateOpen.value = false
  isUserDrawerOpen.value = true
}

function closeUserDrawer() {
  isUserDrawerOpen.value = false
  pendingAdminUserAction.value = ''
  revokeStudentReason.value = ''
  isUserStudentVerificationCreateOpen.value = false
  closeStudentVerificationDialog()
}

function openStudentVerificationDialog(id: string, event: MouseEvent) {
  selectedStudentVerificationId.value = id
  studentVerificationDialogSource.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  isStudentVerificationDialogOpen.value = true
}

function closeStudentVerificationDialog() {
  isStudentVerificationDialogOpen.value = false
}

function handleStudentVerificationDialogClosed() {
  selectedStudentVerificationId.value = ''
  studentVerificationDialogSource.value = null
}

function openUserAudit(userId: string) {
  const user = state.users.find(item => item.id === userId)
  if (!user)
    return

  closeUserDrawer()
  selectedUserId.value = userId
  resetAuditFilters()
  auditFilters.query = user.profile.displayName
  activeAdminTab.value = ADMIN_TABS.audit
}

watch(
  () => [userFilters.query, userFilters.from, userFilters.to, userFilters.role, userFilters.verification, userFilters.pageSize],
  () => {
    userFilters.page = 1
  },
)

watch(
  () => [dashboardActivityFilters.query, dashboardActivityFilters.from, dashboardActivityFilters.to, dashboardActivityFilters.type, dashboardActivityFilters.pageSize],
  () => {
    dashboardActivityFilters.page = 1
  },
)

watch(
  () => [applicationFilters.query, applicationFilters.from, applicationFilters.to, applicationFilters.type, applicationFilters.status, applicationFilters.pageSize],
  () => {
    applicationFilters.page = 1
  },
)

watch(
  () => [studentFilters.query, studentFilters.from, studentFilters.to, studentFilters.verificationType, studentFilters.status, studentFilters.pageSize],
  () => {
    studentFilters.page = 1
  },
)

watch(
  () => [transactionFilters.query, transactionFilters.from, transactionFilters.to, transactionFilters.type, transactionFilters.direction, transactionFilters.pageSize],
  () => {
    transactionFilters.page = 1
  },
)

watch(
  () => [auditFilters.query, auditFilters.from, auditFilters.to, auditFilters.area, auditFilters.pageSize],
  () => {
    auditFilters.page = 1
  },
)

const allUserRows = computed(() => [...state.users]
  .sort((a, b) => {
    if (a.role !== b.role)
      return a.role === 'admin' ? -1 : 1
    const priorityDiff = userLevelCard(b.id).priority - userLevelCard(a.id).priority
    return priorityDiff || b.lastLoginAt.localeCompare(a.lastLoginAt)
  })
  .map((user) => {
    const applications = state.applications.filter(item => item.userId === user.id)
    const studentVerifications = state.studentVerifications.filter(item => item.userId === user.id)
    const transactions = adminTransactions.value.filter(item => item.userId === user.id)
    const spendTransactions = transactions.filter(item => item.delta < 0)
    const pipelineSpend = spendTransactions.filter(isPipelineSpendTransaction)
    const pointIncome = transactions.filter(item => item.delta > 0)
    const level = userLevelCard(user.id)
    const latestActivityAt = [
      user.lastLoginAt,
      ...applications.map(item => item.createdAt),
      ...studentVerifications.map(item => item.createdAt),
      ...transactions.map(item => item.createdAt),
    ].filter(Boolean).sort().at(-1) ?? user.createdAt

    return {
      user,
      level,
      applications: applications.length,
      studentVerifications: studentVerifications.length,
      transactions: transactions.length,
      pipelineSpend: Math.abs(sumTransactions(pipelineSpend)),
      totalSpend: Math.abs(sumTransactions(spendTransactions)),
      totalIncome: sumTransactions(pointIncome),
      latestActivityAt,
    }
  }))

const userRows = computed(() => allUserRows.value.filter((row) => {
  const roleMatched = userFilters.role === ALL_FILTER || row.user.role === userFilters.role
  const verificationMatched = userFilters.verification === ALL_FILTER
    || (userFilters.verification === 'student' && row.user.profile.studentVerified)
    || (userFilters.verification === 'github' && row.user.profile.githubAuthorized)
    || (userFilters.verification === 'none' && !row.user.profile.studentVerified && !row.user.profile.githubAuthorized)

  return roleMatched
    && verificationMatched
    && isInDateRange(row.user.createdAt, userFilters)
    && matchesQuery(userFilters.query, [
      row.user.profile.displayName,
      row.user.profile.email,
      row.user.profile.githubUsername,
      roleText(row.user.role),
      row.level.name,
      row.level.reasons.join(' '),
    ])
}))

const userPagination = computed(() => paginateRows(userRows.value, userFilters))

watch(
  () => state.users.some(user => user.id === selectedUserId.value),
  (exists) => {
    if (!selectedUserId.value || exists)
      return

    closeUserDrawer()
    selectedUserId.value = ''
  },
)

watch(selectedUserId, () => {
  pendingAdminUserAction.value = ''
})

const selectedUserDetail = computed(() => {
  const user = state.users.find(item => item.id === selectedUserId.value)
  if (!user)
    return undefined

  const applications = [...state.applications]
    .filter(item => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const studentVerifications = [...state.studentVerifications]
    .filter(item => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const transactions = [...adminTransactions.value]
    .filter(item => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const coupons = [...state.coupons]
    .filter(item => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const spendTransactions = transactions.filter(item => item.delta < 0)
  const incomeTransactions = transactions.filter(item => item.delta > 0)
  const pipelineSpend = spendTransactions.filter(isPipelineSpendTransaction)
  const studentSpend = spendTransactions.filter(item => isStudentRef(item.refId) || item.reason.includes('学生认证') || item.reason.includes('一线认证'))
  const rechargeIncome = incomeTransactions.filter(item => item.type === 'recharge')
  const manualAdjustments = transactions.filter(item => item.type === 'adjustment')
  const invitationBinding = state.invitationBindings.find(item => item.inviteeUserId === user.id)
  const invitationInviter = invitationBinding ? state.users.find(item => item.id === invitationBinding.inviterUserId) : undefined
  const inviteeBindings = state.invitationBindings.filter(item => item.inviterUserId === user.id)
  const latestRecords = [
    ...applications.map(item => ({
      id: `app-${item.id}`,
      kind: '申请',
      title: item.title,
      detail: `${applicationTypeLabel(item.type)} · ${applicationStatusLabel(item.status)} · ${formatPoints(item.cost)}`,
      tone: item.status,
      time: item.createdAt,
    })),
    ...studentVerifications.map(item => ({
      id: `student-${item.id}`,
      kind: verificationTypeLabel(item.verificationType),
      title: `${item.realName} · ${item.category}`,
      detail: `${verificationOrganizationLabel(item.verificationType)} ${item.school || '未填写'} · ${studentStatusLabel(item.status)} · 审核费 ${formatPoints(item.reviewFee)}`,
      tone: item.status,
      time: item.createdAt,
    })),
    ...transactions.map(item => ({
      id: `tx-${item.id}`,
      kind: '积分',
      title: transactionTypeLabel(item.type),
      detail: `${signedPoints(item.delta)} · ${item.reason}`,
      tone: item.delta < 0 ? 'warning' : 'success',
      time: item.createdAt,
    })),
  ].sort((a, b) => b.time.localeCompare(a.time))

  const applicationCounts = REQUEST_TYPE_ORDER.map(type => ({
    type,
    label: applicationTypeLabel(type),
    count: applications.filter(item => item.type === type).length,
    spend: Math.abs(sumTransactions(pipelineSpend.filter(item =>
      applications.some(application => application.id === item.refId && application.type === type),
    ))),
  }))

  return {
    user,
    level: userLevelCard(user.id),
    applications,
    studentVerifications,
    transactions,
    coupons,
    spendTransactions,
    pipelineSpend,
    latestRecords,
    applicationCounts,
    invitationBinding,
    invitationInviter,
    inviteeBindings,
    stats: {
      balance: user.points,
      totalIncome: sumTransactions(incomeTransactions),
      totalSpend: Math.abs(sumTransactions(spendTransactions)),
      pipelineSpend: Math.abs(sumTransactions(pipelineSpend)),
      studentSpend: Math.abs(sumTransactions(studentSpend)),
      rechargeIncome: sumTransactions(rechargeIncome),
      manualAdjustment: sumTransactions(manualAdjustments),
      applicationCount: applications.length,
      pendingApplications: applications.filter(item => ['pending_review', 'needs_supplement', 'processing', 'reserved'].includes(item.status)).length,
      rejectedApplications: applications.filter(item => item.status === 'rejected').length,
      studentCount: studentVerifications.length,
      approvedStudents: studentVerifications.filter(item => item.status === 'approved').length,
      transactionCount: transactions.length,
    },
  }
})

const selectedUserRecentApplications = computed<WelfareApplication[]>(() => selectedUserDetail.value?.applications.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedUserRecentStudents = computed<StudentVerification[]>(() => selectedUserDetail.value?.studentVerifications.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedStudentVerification = computed<StudentVerification | undefined>(() => selectedUserDetail.value?.studentVerifications.find(item => item.id === selectedStudentVerificationId.value))
const selectedUserRecentTransactions = computed<CreditTransaction[]>(() => selectedUserDetail.value?.transactions.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedUserRecentCoupons = computed<UserCoupon[]>(() => selectedUserDetail.value?.coupons.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedUserApprovedStudentVerification = computed<StudentVerification | undefined>(() => selectedUserDetail.value?.studentVerifications
  .filter(item => normalizeVerificationType(item.verificationType) === 'student' && item.status === 'approved')
  .sort((a, b) => (b.reviewedAt || b.createdAt).localeCompare(a.reviewedAt || a.createdAt))[0])

const selectedUserConsumptionRows = computed(() => selectedUserDetail.value?.spendTransactions.slice(0, USER_DETAIL_LIMIT).map(item => ({
  transaction: item,
  linkedTitle: linkedRecordTitle(item),
})) ?? [])

const selectedUserStatCards = computed(() => {
  const detail = selectedUserDetail.value
  if (!detail)
    return []

  return [
    {
      label: '可用积分',
      value: formatPoints(detail.stats.balance),
      note: `入账 ${formatPoints(detail.stats.totalIncome)} / 消耗 ${formatPoints(detail.stats.totalSpend)}`,
      icon: 'i-carbon-wallet',
    },
    {
      label: '流水线消耗',
      value: formatPoints(detail.stats.pipelineSpend),
      note: `申请 ${detail.stats.applicationCount} 次，处理中 ${detail.stats.pendingApplications} 次`,
      icon: 'i-carbon-flow',
    },
    {
      label: '认证记录',
      value: `${detail.stats.approvedStudents}/${detail.stats.studentCount}`,
      note: `学生${detail.user.profile.studentVerified ? '已认证' : '未认证'} / GitHub ${detail.user.profile.githubAuthorized ? '已授权' : '未授权'}`,
      icon: 'i-carbon-user-certification',
    },
    {
      label: '积分流水',
      value: detail.stats.transactionCount.toLocaleString('zh-CN'),
      note: `充值 ${formatPoints(detail.stats.rechargeIncome)} / 手动 ${signedPoints(detail.stats.manualAdjustment)}`,
      icon: 'i-carbon-chart-line-data',
    },
  ]
})

const dashboardMetricScope = computed(() => ({
  users: state.users.filter(item => isInDateRange(item.createdAt, dashboardActivityFilters)),
  applications: state.applications.filter(item => isInDateRange(item.createdAt, dashboardActivityFilters)),
  studentVerifications: state.studentVerifications.filter(item => isInDateRange(item.createdAt, dashboardActivityFilters)),
  transactions: adminTransactions.value.filter(item => isInDateRange(item.createdAt, dashboardActivityFilters)),
}))

const dashboardMetrics = computed(() => {
  const { users, applications, studentVerifications, transactions } = dashboardMetricScope.value
  const adminCount = users.filter(user => user.role === 'admin').length
  const pendingApplicationCount = applications.filter(item => ['pending_review', 'needs_supplement'].includes(item.status)).length
  const pendingStudentCount = studentVerifications.filter(item => ['pending', 'needs_supplement'].includes(item.status)).length
  const pointsBalance = users.reduce((sum, user) => sum + user.points, 0)
  const pointsIn = transactions.filter(item => item.delta > 0).reduce((sum, item) => sum + item.delta, 0)
  const pointsOut = Math.abs(transactions.filter(item => item.delta < 0).reduce((sum, item) => sum + item.delta, 0))

  return [
    {
      label: '用户总数',
      value: users.length.toLocaleString('zh-CN'),
      note: `${adminCount} 名管理员 / ${users.length - adminCount} 名普通用户`,
      icon: 'i-carbon-user-multiple',
    },
    {
      label: '待处理审核',
      value: (pendingApplicationCount + pendingStudentCount).toLocaleString('zh-CN'),
      note: `${pendingApplicationCount} 个申请 / ${pendingStudentCount} 个认证申请`,
      icon: 'i-carbon-review',
    },
    {
      label: '业务申请',
      value: applications.length.toLocaleString('zh-CN'),
      note: `${applications.filter(item => ['pending_review', 'needs_supplement'].includes(item.status)).length} 个待处理 / ${applications.filter(item => item.status === 'answered').length} 个已答复`,
      icon: 'i-carbon-data-table',
    },
    {
      label: '积分余额',
      value: formatPoints(pointsBalance),
      note: `累计发放 ${formatPoints(pointsIn)} / 累计扣除 ${formatPoints(pointsOut)}`,
      icon: 'i-carbon-chart-line-data',
    },
  ]
})

const dashboardActivityRows = computed(() => {
  const rows: Array<{
    id: string
    type: string
    title: string
    user: string
    detail: string
    tone: string
    createdAt: string
  }> = []

  for (const user of state.users) {
    rows.push({
      id: `dashboard-user-${user.id}`,
      type: 'user',
      title: '用户注册',
      user: user.profile.displayName,
      detail: `${user.profile.email} · ${roleText(user.role)}`,
      tone: user.role === 'admin' ? 'success' : 'info',
      createdAt: user.createdAt,
    })
  }

  for (const application of state.applications) {
    rows.push({
      id: `dashboard-application-${application.id}`,
      type: 'application',
      title: application.title,
      user: userDisplayName(application.userId),
      detail: `${applicationTypeText[application.type]} · ${applicationStatusText[application.status]}`,
      tone: application.status === 'rejected' ? 'danger' : ['pending_review', 'needs_supplement'].includes(application.status) ? 'warning' : 'success',
      createdAt: application.createdAt,
    })
  }

  for (const verification of state.studentVerifications) {
    rows.push({
      id: `dashboard-student-${verification.id}`,
      type: 'student',
      title: `${verificationTypeLabel(verification.verificationType)} · ${verification.category}`,
      user: userDisplayName(verification.userId),
      detail: `${verificationOrganizationLabel(verification.verificationType)} ${verification.school || '未填写'} · ${studentStatusText[verification.status]}`,
      tone: ['rejected', 'revoked'].includes(verification.status) ? 'danger' : ['pending', 'needs_supplement'].includes(verification.status) ? 'warning' : 'success',
      createdAt: verification.createdAt,
    })
  }

  for (const transaction of adminTransactions.value) {
    rows.push({
      id: `dashboard-transaction-${transaction.id}`,
      type: 'transaction',
      title: transactionTypeText[transaction.type] ?? transaction.type,
      user: userDisplayName(transaction.userId),
      detail: `${signedPoints(transaction.delta)} · ${transaction.reason}`,
      tone: transaction.delta < 0 ? 'warning' : 'success',
      createdAt: transaction.createdAt,
    })
  }

  return rows
    .filter(row => dashboardActivityFilters.type === ALL_FILTER || row.type === dashboardActivityFilters.type)
    .filter(row => isInDateRange(row.createdAt, dashboardActivityFilters))
    .filter(row => matchesQuery(dashboardActivityFilters.query, [
      dashboardActivityTypeText[row.type],
      row.title,
      row.user,
      row.detail,
    ]))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})

const dashboardActivityPagination = computed(() => paginateRows(dashboardActivityRows.value, dashboardActivityFilters))

const resourceGovernanceSnapshot = computed(() => buildResourceGovernanceSnapshot(state.applications))

const resourceGovernanceCards = computed(() => {
  const totals = resourceGovernanceSnapshot.value.totals
  return [
    {
      label: '使用中资源',
      value: totals.active.toLocaleString('zh-CN'),
      note: `${totals.renewalDue} 个 7 天内到期`,
      icon: 'i-carbon-play-filled-alt',
      tone: totals.renewalDue > 0 ? 'warning' : 'success',
    },
    {
      label: '待审批/发放',
      value: (totals.pendingApproval + totals.pendingProvision).toLocaleString('zh-CN'),
      note: `${totals.pendingApproval} 个待审批 / ${totals.pendingProvision} 个待发放`,
      icon: 'i-carbon-review',
      tone: totals.pendingApproval + totals.pendingProvision > 0 ? 'warning' : 'success',
    },
    {
      label: '过期资源',
      value: totals.expired.toLocaleString('zh-CN'),
      note: '需要管理员确认续期或进入回收队列',
      icon: 'i-carbon-time',
      tone: totals.expired > 0 ? 'danger' : 'success',
    },
    {
      label: '待回收资源',
      value: totals.reclaimPending.toLocaleString('zh-CN'),
      note: `已释放 ${totals.released} 个资源`,
      icon: 'i-carbon-clean',
      tone: totals.reclaimPending > 0 ? 'danger' : 'success',
    },
  ]
})

const resourceGovernanceRows = computed(() => [
  ...resourceGovernanceSnapshot.value.expiredItems,
  ...resourceGovernanceSnapshot.value.reclaimPendingItems,
  ...resourceGovernanceSnapshot.value.renewalDueItems,
  ...resourceGovernanceSnapshot.value.pendingApprovalItems,
  ...resourceGovernanceSnapshot.value.pendingProvisionItems,
].slice(0, 8))

function resourceGovernanceRowNote(row: ResourceGovernanceQueueItem) {
  const expiresAt = row.expiresAt ? `到期 ${formatDate(row.expiresAt)}` : '未设置到期时间'
  return `${resourceTypeLabel(row.resourceType)} / ${row.resourceSubtype} · ${row.approverGroup} · ${expiresAt}`
}

function updateResourceGovernanceRow(row: ResourceGovernanceQueueItem, action: 'queue_reclaim' | 'release' | 'return') {
  const actionText = action === 'queue_reclaim' ? '进入回收队列' : action === 'release' ? '标记释放' : '标记归还'
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await updateResourceLifecycle({
      applicationId: row.applicationId,
      itemId: row.itemId,
      action,
      note: `管理员已将资源${actionText}。`,
    })
  }, `资源已${actionText}`)
}

const dashboardApplicationTypeChart = computed(() => {
  const applications = dashboardMetricScope.value.applications
  const total = applications.length
  return REQUEST_TYPE_ORDER.map((type) => {
    const rows = applications.filter(item => item.type === type)
    return {
      key: type,
      label: applicationTypeLabel(type),
      value: rows.length,
      percent: percentLabel(rows.length, total),
      width: `${barPercent(rows.length, total)}%`,
      points: rows.reduce((sum, item) => sum + item.cost + (item.storageExtended ? item.storageExtensionCost : 0), 0),
    }
  })
})

const dashboardApplicationFunnel = computed(() => {
  const applications = dashboardMetricScope.value.applications
  const total = applications.length
  const done = applications.filter(item => DONE_APPLICATION_STATUSES.has(item.status)).length
  const rejected = applications.filter(item => item.status === 'rejected' || item.status === 'cancelled').length
  const rows = [
    { key: 'submitted', label: '已进入流程', value: total, tone: 'info' },
    { key: 'waiting', label: '待审核/补充', value: applications.filter(item => WAITING_APPLICATION_STATUSES.has(item.status)).length, tone: 'warning' },
    { key: 'processing', label: '处理中', value: applications.filter(item => PROCESSING_APPLICATION_STATUSES.has(item.status)).length, tone: 'info' },
    { key: 'done', label: '已交付/完成', value: done, tone: 'success' },
    { key: 'rejected', label: '退回/取消', value: rejected, tone: 'danger' },
  ]

  return rows.map(item => ({
    ...item,
    percent: percentLabel(item.value, total),
    width: `${barPercent(item.value, total)}%`,
  }))
})

const dashboardVerificationChart = computed(() => {
  const verifications = dashboardMetricScope.value.studentVerifications
  const total = verifications.length
  return studentStatusFilterOptions
    .filter(option => option.value !== ALL_FILTER)
    .map((option) => {
      const count = verifications.filter(item => item.status === option.value).length
      return {
        key: option.value,
        label: option.label.replace('全部', ''),
        value: count,
        percent: percentLabel(count, total),
        width: `${barPercent(count, total)}%`,
        tone: option.value,
      }
    })
})

const dashboardPointFlowChart = computed(() => {
  const transactions = dashboardMetricScope.value.transactions
  const income = transactions.filter(item => item.delta > 0).reduce((sum, item) => sum + item.delta, 0)
  const outcome = Math.abs(transactions.filter(item => item.delta < 0).reduce((sum, item) => sum + item.delta, 0))
  const maxValue = Math.max(income, outcome, 1)
  return [
    {
      key: 'income',
      label: '积分入账',
      value: income,
      text: formatPoints(income),
      width: `${barPercent(income, maxValue)}%`,
      tone: 'success',
    },
    {
      key: 'outcome',
      label: '积分消耗',
      value: outcome,
      text: formatPoints(outcome),
      width: `${barPercent(outcome, maxValue)}%`,
      tone: 'warning',
    },
  ]
})

const dashboardTrendRows = computed(() => {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const startTime = todayStart.getTime() - (DASHBOARD_TREND_DAY_COUNT - 1) * DAY_MS

  return Array.from({ length: DASHBOARD_TREND_DAY_COUNT }, (_, index) => {
    const dayStart = startTime + index * DAY_MS
    const applications = state.applications.filter(item => isWithinDay(item.createdAt, dayStart)).length
    const users = state.users.filter(item => isWithinDay(item.createdAt, dayStart)).length
    const verifications = state.studentVerifications.filter(item => isWithinDay(item.createdAt, dayStart)).length
    const pointFlow = adminTransactions.value
      .filter(item => isWithinDay(item.createdAt, dayStart))
      .reduce((sum, item) => sum + Math.abs(item.delta), 0)

    return {
      key: new Date(dayStart).toISOString(),
      label: shortDateLabel(dayStart),
      applications,
      users,
      verifications,
      pointFlow,
      total: applications + users + verifications,
    }
  })
})

const dashboardTrendMax = computed(() => Math.max(...dashboardTrendRows.value.map(item => item.total), 1))

const dashboardTrendPoints = computed(() => dashboardTrendRows.value
  .map((item, index) => lineChartPoint(item.total, dashboardTrendMax.value, index, dashboardTrendRows.value.length)))

const dashboardTrendPolyline = computed(() => dashboardTrendPoints.value
  .map(point => `${point.x},${point.y}`)
  .join(' '))

const dashboardTrendAreaPath = computed(() => {
  const points = dashboardTrendPoints.value
  if (!points.length)
    return ''
  const baseline = DASHBOARD_TREND_HEIGHT - DASHBOARD_TREND_PADDING
  const lastPoint = points[points.length - 1]
  return `M ${points[0].x} ${baseline} L ${points.map(point => `${point.x} ${point.y}`).join(' L ')} L ${lastPoint.x} ${baseline} Z`
})

const dashboardInsightCards = computed(() => {
  const { users, applications, studentVerifications, transactions } = dashboardMetricScope.value
  const doneApplications = applications.filter(item => DONE_APPLICATION_STATUSES.has(item.status)).length
  const verifiedUsers = users.filter(user => user.profile.studentVerified || user.profile.githubAuthorized).length
  const activeUsers = users.filter(user => applications.some(item => item.userId === user.id) || transactions.some(item => item.userId === user.id)).length
  const approvalRate = percentLabel(doneApplications, applications.length)
  const verificationRate = percentLabel(verifiedUsers, users.length)
  const pendingVerifications = studentVerifications.filter(item => ['pending', 'needs_supplement'].includes(item.status)).length

  return [
    {
      label: '申请完成率',
      value: approvalRate,
      note: `${doneApplications}/${applications.length} 个申请已交付或完成`,
      icon: 'i-carbon-checkmark-outline',
    },
    {
      label: '认证覆盖率',
      value: verificationRate,
      note: `${verifiedUsers}/${users.length} 位用户已有学生或 GitHub 认证`,
      icon: 'i-carbon-user-certification',
    },
    {
      label: '活跃用户',
      value: activeUsers.toLocaleString('zh-CN'),
      note: `有申请或积分流水的用户，占 ${percentLabel(activeUsers, users.length)}`,
      icon: 'i-carbon-chart-relationship',
    },
    {
      label: '认证待办',
      value: pendingVerifications.toLocaleString('zh-CN'),
      note: `认证队列压力：${percentLabel(pendingVerifications, studentVerifications.length)}`,
      icon: 'i-carbon-time',
    },
  ]
})

const dataGroups = computed(() => [
  {
    title: '公益申请',
    count: state.applications.length,
    note: `${state.applications.filter(item => ['pending_review', 'needs_supplement'].includes(item.status)).length} 个待处理，${state.applications.filter(item => item.status === 'rejected').length} 个已退回`,
  },
  {
    title: '认证申请',
    count: state.studentVerifications.length,
    note: `${state.studentVerifications.filter(item => ['pending', 'needs_supplement'].includes(item.status)).length} 个待处理，${state.studentVerifications.filter(item => item.status === 'approved').length} 个已通过`,
  },
  {
    title: '积分流水',
    count: adminTransactions.value.length,
    note: `${adminTransactions.value.filter(item => item.delta > 0).length} 条入账，${adminTransactions.value.filter(item => item.delta < 0).length} 条扣减`,
  },
])

const applicationRows = computed(() => [...state.applications]
  .filter(item => applicationFilters.type === ALL_FILTER || item.type === applicationFilters.type)
  .filter(item => applicationFilters.status === ALL_FILTER || item.status === applicationFilters.status)
  .filter(item => isInDateRange(item.createdAt, applicationFilters))
  .filter(item => matchesQuery(applicationFilters.query, [
    item.title,
    item.description,
    item.githubRepo,
    userDisplayName(item.userId),
    applicationTypeText[item.type],
    applicationStatusText[item.status],
  ]))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

const studentRows = computed(() => [...state.studentVerifications]
  .filter(item => studentFilters.verificationType === ALL_FILTER || item.verificationType === studentFilters.verificationType)
  .filter(item => studentFilters.status === ALL_FILTER || item.status === studentFilters.status)
  .filter(item => isInDateRange(item.createdAt, studentFilters))
  .filter(item => matchesQuery(studentFilters.query, [
    verificationTypeLabel(item.verificationType),
    item.realName,
    item.category,
    item.school,
    item.identity,
    item.grade,
    item.educationLevel,
    item.educationEmail,
    item.notes,
    userDisplayName(item.userId),
    studentStatusText[item.status],
  ]))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

const transactionRows = computed(() => [...adminTransactions.value]
  .filter(item => transactionFilters.type === ALL_FILTER || item.type === transactionFilters.type)
  .filter(item => transactionFilters.direction === ALL_FILTER || (transactionFilters.direction === 'in' ? item.delta > 0 : item.delta < 0))
  .filter(item => isInDateRange(item.createdAt, transactionFilters))
  .filter(item => matchesQuery(transactionFilters.query, [
    userDisplayName(item.userId),
    transactionTypeText[item.type],
    item.reason,
    item.refId,
    signedPoints(item.delta),
  ]))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

const applicationPagination = computed(() => paginateRows(applicationRows.value, applicationFilters))
const studentPagination = computed(() => paginateRows(studentRows.value, studentFilters))
const transactionPagination = computed(() => paginateRows(transactionRows.value, transactionFilters))

const auditEvents = computed(() => {
  const events: AuditEvent[] = []

  for (const user of state.users) {
    events.push({
      id: `user-created-${user.id}`,
      time: user.createdAt,
      area: '用户',
      action: '创建账户',
      actor: user.profile.displayName,
      detail: `${user.profile.email} · ${user.role === 'admin' ? '管理员' : '普通用户'}`,
      tone: user.role === 'admin' ? 'success' : 'info',
    })

    if (user.lastLoginAt && user.lastLoginAt !== user.createdAt) {
      events.push({
        id: `user-login-${user.id}-${user.lastLoginAt}`,
        time: user.lastLoginAt,
        area: '用户',
        action: '登录后台',
        actor: user.profile.displayName,
        detail: user.profile.email,
        tone: 'info',
      })
    }
  }

  for (const transaction of adminTransactions.value) {
    events.push({
      id: `tx-${transaction.id}`,
      time: transaction.createdAt,
      area: '积分',
      action: transactionTypeText[transaction.type] ?? transaction.type,
      actor: userDisplayName(transaction.userId),
      detail: `${signedPoints(transaction.delta)} · ${transaction.reason}`,
      tone: transaction.delta < 0 ? 'warning' : 'success',
    })
  }

  for (const application of state.applications) {
    events.push({
      id: `app-created-${application.id}`,
      time: application.createdAt,
      area: '申请',
      action: '提交申请',
      actor: userDisplayName(application.userId),
      detail: `${applicationTypeText[application.type]} · ${application.title} · ${applicationStatusText[application.status] ?? application.status}`,
      tone: ['pending_review', 'needs_supplement'].includes(application.status) ? 'warning' : 'info',
    })

    if (application.reviewedAt) {
      events.push({
        id: `app-reviewed-${application.id}`,
        time: application.reviewedAt,
        area: '申请',
        action: application.status === 'rejected' ? '退回申请' : '完成审核',
        actor: '管理员',
        detail: `${applicationTypeText[application.type]} · ${application.title}`,
        tone: application.status === 'rejected' ? 'danger' : 'success',
      })
    }
  }

  for (const verification of state.studentVerifications) {
    events.push({
      id: `student-created-${verification.id}`,
      time: verification.createdAt,
      area: '认证申请',
      action: '提交材料',
      actor: userDisplayName(verification.userId),
      detail: `${verificationTypeLabel(verification.verificationType)} · ${verification.category} · ${verificationOrganizationLabel(verification.verificationType)} ${verification.school || '未填写'} · ${studentStatusText[verification.status] ?? verification.status}`,
      tone: ['pending', 'needs_supplement'].includes(verification.status) ? 'warning' : 'info',
    })

    if (verification.reviewedAt) {
      events.push({
        id: `student-reviewed-${verification.id}`,
        time: verification.reviewedAt,
        area: '认证申请',
        action: verification.status === 'revoked' ? '撤销认证' : verification.status === 'rejected' ? '退回认证' : '通过认证',
        actor: '管理员',
        detail: `${verificationTypeLabel(verification.verificationType)} · ${verification.category} · ${userDisplayName(verification.userId)}`,
        tone: verification.status === 'rejected' ? 'danger' : 'success',
      })
    }
  }

  return events
    .sort((a, b) => b.time.localeCompare(a.time))
})

const filteredAuditEvents = computed(() => auditEvents.value
  .filter(event => auditFilters.area === ALL_FILTER || event.area === auditFilters.area)
  .filter(event => isInDateRange(event.time, auditFilters))
  .filter(event => matchesQuery(auditFilters.query, [
    event.area,
    event.action,
    event.actor,
    event.detail,
  ])))

const auditPagination = computed(() => paginateRows(filteredAuditEvents.value, auditFilters))

function saveOauthConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    if (!state.oauth.clientId.trim())
      throw new Error('请填写 OAuth Client ID')
    await updateOauthConfigAction({
      ...state.oauth,
      enabled: true,
    })
    await reloadWelfareState()
  }, 'OAuth 配置已启用')
}

function fillOauthFromGitHubApp() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    if (!githubAppConfigForm.clientId.trim())
      throw new Error('请先填写 GitHub App Client ID')

    await updateOauthConfigAction({
      provider: 'github',
      clientId: githubAppConfigForm.clientId,
      authorizeUrl: githubAppConfigForm.authorizeUrl,
      tokenUrl: githubAppConfigForm.tokenUrl,
      callbackUrl: githubAppConfigForm.callbackUrl,
      scopes: githubAppConfigForm.scopes,
      enabled: true,
    })
    await reloadWelfareState()
  }, '已同步 GitHub App 登录配置')
}

function onRefreshOAuthProviderConfigs() {
  runSafely(() => refreshOAuthProviderConfigs(), 'OAuth/OIDC 登录源已刷新')
}

function defaultOAuthCallbackUrl() {
  return typeof globalThis.location !== 'undefined' ? `${globalThis.location.origin}/api/oauth/callback` : '/api/oauth/callback'
}

function createLinuxDoOAuthPreset() {
  return {
    ...LINUX_DO_OAUTH_PRESET,
    callbackUrl: defaultOAuthCallbackUrl(),
  }
}

function resetOAuthProviderDraft(provider?: EditableOAuthProviderConfig) {
  Object.assign(oauthProviderDraft, provider
    ? {
        ...provider,
        clientSecret: '',
      }
    : {
        id: `provider-${oauthProviderConfigs.value.length + 1}`,
        name: 'OIDC 登录',
        logoUrl: '',
        enabled: true,
        configured: false,
        clientId: '',
        clientSecret: '',
        clientSecretMasked: '',
        callbackUrl: defaultOAuthCallbackUrl(),
        authorizeUrl: '',
        tokenUrl: '',
        userInfoUrl: '',
        issuerUrl: '',
        scopes: 'openid profile email',
      })
}

function openAddOAuthProviderDialog() {
  oauthProviderDialogMode.value = 'create'
  editingOAuthProviderId.value = ''
  resetOAuthProviderDraft()
  isOAuthProviderDialogOpen.value = true
}

function openLinuxDoOAuthProviderDialog() {
  const existing = oauthProviderConfigs.value.find(provider => provider.id === LINUX_DO_OAUTH_PRESET.id)
  oauthProviderDialogMode.value = existing ? 'edit' : 'create'
  editingOAuthProviderId.value = existing?.id ?? ''
  resetOAuthProviderDraft({
    ...createLinuxDoOAuthPreset(),
    ...existing,
    enabled: true,
    authorizeUrl: existing?.authorizeUrl || LINUX_DO_OAUTH_PRESET.authorizeUrl,
    tokenUrl: existing?.tokenUrl || LINUX_DO_OAUTH_PRESET.tokenUrl,
    userInfoUrl: existing?.userInfoUrl || LINUX_DO_OAUTH_PRESET.userInfoUrl,
    issuerUrl: existing?.issuerUrl || LINUX_DO_OAUTH_PRESET.issuerUrl,
  })
  isOAuthProviderDialogOpen.value = true
}

function openEditOAuthProviderDialog(provider: EditableOAuthProviderConfig) {
  oauthProviderDialogMode.value = 'edit'
  editingOAuthProviderId.value = provider.id
  resetOAuthProviderDraft(provider)
  isOAuthProviderDialogOpen.value = true
}

function closeOAuthProviderDialog() {
  isOAuthProviderDialogOpen.value = false
}

function oauthProviderPayloadFromDraft(): EditableOAuthProviderConfig {
  return {
    id: oauthProviderDraft.id.trim(),
    name: oauthProviderDraft.name.trim(),
    logoUrl: oauthProviderDraft.logoUrl.trim(),
    enabled: oauthProviderDraft.enabled,
    configured: oauthProviderDraft.configured,
    clientId: oauthProviderDraft.clientId.trim(),
    clientSecret: oauthProviderDraft.clientSecret,
    clientSecretMasked: oauthProviderDraft.clientSecretMasked,
    callbackUrl: oauthProviderDraft.callbackUrl.trim(),
    authorizeUrl: oauthProviderDraft.authorizeUrl.trim(),
    tokenUrl: oauthProviderDraft.tokenUrl.trim(),
    userInfoUrl: oauthProviderDraft.userInfoUrl.trim(),
    issuerUrl: oauthProviderDraft.issuerUrl.trim(),
    scopes: oauthProviderDraft.scopes.trim() || 'openid profile email',
  }
}

function saveOAuthProviderDialog() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    const next = oauthProviderPayloadFromDraft()
    if (!next.id)
      throw new Error('请填写登录源 ID')
    if (!next.name)
      throw new Error('请填写显示名称')

    const duplicated = oauthProviderConfigs.value.some(provider => provider.id !== editingOAuthProviderId.value && provider.id === next.id)
    if (duplicated)
      throw new Error(`登录源 ID 重复：${next.id}`)

    if (oauthProviderDialogMode.value === 'edit') {
      oauthProviderConfigs.value = oauthProviderConfigs.value.map(provider =>
        provider.id === editingOAuthProviderId.value ? next : provider,
      )
    }
    else {
      oauthProviderConfigs.value = [next, ...oauthProviderConfigs.value]
    }

    await persistOAuthProviderConfigs()
    closeOAuthProviderDialog()
  }, oauthProviderDialogMode.value === 'edit' ? '登录源已更新' : '登录源已添加')
}

function removeOAuthProvider(id: string) {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    oauthProviderConfigs.value = oauthProviderConfigs.value.filter(provider => provider.id !== id)
    await persistOAuthProviderConfigs()
  }, '登录源已移除')
}

function persistOAuthProviderListState() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistOAuthProviderConfigs()
  }, '登录源列表已保存')
}

function saveApplicationPolicyConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistApplicationPolicy()
  }, '申请策略已保存')
}

function onAdjustPoints(userId: string) {
  runSafely(async () => {
    await adjustUserPointsAction(userId, pointDrafts[userId] ?? 0, '后台积分充值 / 调整')
    await reloadWelfareState()
    await refreshPointTransactions({ limit: 200, scope: 'admin' })
  }, '积分已调整')
}

function onSubmitAdminStudentVerification() {
  runSafely(async () => {
    await submitAdminStudentVerificationFromForm()
  }, '已代用户提交认证材料')
}

function onToggleReviewer(userId: string, enabled: boolean) {
  runSafely(() => setUserCrowdReviewer(userId, enabled), enabled ? '已授予协作处理员权限' : '已收回协作处理员权限')
}

function onReviewCollaborationApplication(id: string, status: 'approved' | 'rejected') {
  runSafely(() => reviewCollaborationApplication(id, status), status === 'approved' ? '已开通协作处理员权限' : '已退回协作处理员申请')
}

function onReviewDeliveryResult(applicationId: string, approved: boolean) {
  runSafely(() => reviewDeliveryResult(applicationId, approved), approved ? '交付复核通过，奖励已发放' : '交付复核未通过，任务已重新开放')
}

function llmApiRegionLabel(region: string) {
  if (region === 'domestic')
    return '国内'
  if (region === 'global')
    return '国外'
  return '自定义'
}

function userActionKey(userId: string, action: string) {
  return `${userId}:${action}`
}

function confirmUserAction(userId: string, action: string) {
  const key = userActionKey(userId, action)
  if (pendingAdminUserAction.value === key)
    return true

  pendingAdminUserAction.value = key
  return false
}

function openUserStudentVerificationCreate(userId: string) {
  resetAdminStudentVerificationForm()
  adminStudentVerificationForm.userId = userId
  adminStudentVerificationForm.verificationType = 'student'
  adminStudentVerificationForm.category = '大学生'
  adminStudentVerificationForm.message = '请补充文本说明并上传材料；提交后会生成一条待审核认证记录。'
  pendingAdminUserAction.value = ''
  isUserStudentVerificationCreateOpen.value = true
}

function onSubmitUserStudentVerificationCreate() {
  runSafely(async () => {
    await submitAdminStudentVerificationFromForm()
    pendingAdminUserAction.value = ''
    isUserStudentVerificationCreateOpen.value = false
  }, '已新添加学生认证')
}

function onRevokeStudentVerification(userId: string) {
  if (!revokeStudentReason.value.trim()) {
    notify('请填写撤销学生认证原因')
    return
  }

  if (!confirmUserAction(userId, 'revoke-student'))
    return

  runSafely(async () => {
    await revokeUserStudentVerification(userId, revokeStudentReason.value)
    pendingAdminUserAction.value = ''
    revokeStudentReason.value = ''
  }, '学生认证已撤销')
}

function onUnbindGitHub(userId: string) {
  if (!confirmUserAction(userId, 'unbind-github'))
    return

  runSafely(async () => {
    await unbindUserGitHub(userId)
    pendingAdminUserAction.value = ''
  }, 'GitHub 认证已解绑')
}

function onToggleUserSuspended(userId: string, suspended: boolean) {
  const action = suspended ? 'suspend-user' : 'restore-user'
  if (!confirmUserAction(userId, action))
    return

  runSafely(async () => {
    await setUserSuspended(userId, suspended, '违反平台使用政策或资源使用协议')
    pendingAdminUserAction.value = ''
  }, suspended ? '用户已封禁' : '用户已解封')
}

function saveRechargeConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistRechargeConfig()
  }, '充值配置已保存')
}

function saveGitHubAppConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistGitHubAppConfig()
  }, 'GitHub App 配置已保存')
}

function saveAiProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistAiConfig()
  }, 'AI Provider 配置已保存')
}

function saveSub2ApiProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistSub2ApiConfig()
  }, 'Sub2API 配置已保存')
}

function testSub2ApiProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await verifySub2ApiConfig()
  }, 'Sub2API 连接测试通过')
}

function saveDatabaseProvisionProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistDatabaseProvisionConfig()
  }, '数据库自动发放配置已保存')
}

function testDatabaseProvisionProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await verifyDatabaseProvisionConfig()
  }, '数据库 root 连接测试通过')
}

function readOnePanelStatus() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await refreshOnePanelStatus()
  }, 'OnePanel 状态读取完成')
}

function saveEducationMailProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistEducationMailConfig()
  }, '教育邮箱收件配置已保存')
}

function testEducationMailProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await verifyEducationMailConfig()
  }, 'DoneMail 连接测试通过')
}

function syncEducationMailProviderMessages() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await syncEducationMailVerifications()
  }, '教育邮箱认证邮件已同步')
}

function saveNotificationProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistNotificationProviderConfig()
  }, '通知供应商配置已保存')
}

function authorizeFeishuProvider() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await authorizeFeishuMailProvider()
  }, '正在跳转飞书授权')
}

function sendFeishuProviderTest() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await sendProviderEmailTestMessage()
  }, '飞书邮件测试已发送')
}

function openVapidRegenerateDialog() {
  isVapidRegenerateDialogOpen.value = true
}

function closeVapidRegenerateDialog() {
  if (notificationProviderConfigForm.generatingVapid)
    return

  isVapidRegenerateDialogOpen.value = false
}

function generateVapidKeys(regenerate = false) {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await generateNotificationVapidKeys(regenerate)
    closeVapidRegenerateDialog()
  }, regenerate ? '浏览器 Push 密钥已重新生成' : '浏览器 Push 密钥已生成')
}

function saveSiteBannerConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistSiteBannerConfig()
  }, '顶部 Banner 已保存')
}

function saveSystemConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistSystemConfig()
  }, '系统开关已保存')
}

function publishAdminAnnouncement() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await sendAdminAnnouncement()
  }, '管理员通告已发送')
}

function reloadAdminAnnouncements() {
  runSafely(async () => {
    await refreshAdminAnnouncements()
    await refreshSystemLogs()
  }, '通告统计已刷新')
}

function reloadSystemLogs() {
  runSafely(() => refreshSystemLogs(), '系统日志已刷新')
}

function systemLogLevelText(level: string) {
  if (level === 'error')
    return '错误'
  if (level === 'warning')
    return '警告'
  if (level === 'success')
    return '成功'
  return '信息'
}

function systemLogDetailsText(details: Record<string, unknown>) {
  return JSON.stringify(details, null, 2)
}

function notificationChannelLabel(channel: string) {
  return announcementChannelOptions.find(item => item.value === channel)?.label ?? channel
}

function handleFeishuMailAuthCallbackMessage() {
  const status = typeof route.query.feishu_mail_auth === 'string' ? route.query.feishu_mail_auth : ''
  if (!status)
    return

  if (status === 'success') {
    notificationProviderConfigForm.message = '飞书邮箱授权成功，可以发送测试邮件了'
    notify('飞书邮箱授权成功')
  }
  else {
    const message = typeof route.query.message === 'string' ? route.query.message : '飞书邮箱授权失败'
    notificationProviderConfigForm.message = message
    notify(message)
  }

  const nextQuery = { ...route.query }
  delete nextQuery.feishu_mail_auth
  delete nextQuery.message
  router.replace({ query: nextQuery }).catch(() => {})
}

onMounted(() => {
  if (!isAdmin.value)
    return

  refreshSiteBannerConfig()
  refreshSystemConfigForm()
  refreshRechargeConfig().catch(() => {})
  refreshGitHubAppConfig().catch(() => {})
  refreshOAuthProviderConfigs().catch(() => {})
  refreshAiConfig().catch(() => {})
  refreshSub2ApiConfig().catch(() => {})
  refreshDatabaseProvisionConfig().catch(() => {})
  refreshEducationMailConfig().catch(() => {})
  refreshNotificationProviderConfig().then(handleFeishuMailAuthCallbackMessage).catch(() => {})
  refreshAdminAnnouncements().catch(() => {})
  refreshSystemLogs().catch(() => {})
  refreshPointTransactions({ limit: 200, scope: 'admin' }).catch(() => {})
})
</script>

<template>
  <section>
    <TxCard v-if="!isAdmin" class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            无权访问
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            当前账号不能查看管理员后台数据。
          </p>
        </div>
        <TxStatusBadge text="权限不足" status="warning" />
      </div>
    </TxCard>

    <TxCard v-else class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            管理员后台
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            管理员专属配置中心；审核队列已融合到对应业务页面，仅管理员可见。
          </p>
        </div>
        <TxStatusBadge :text="isAdmin ? '管理员在线' : '只读预览'" :status="isAdmin ? 'success' : 'warning'" />
      </div>

      <TxTabs
        v-model="activeAdminTab"
        class="admin-config-tabs admin-config-tabs--content-only mt-6"
        :default-value="ADMIN_TABS.dashboard"
        placement="top"
        indicator-variant="block"
        indicator-motion="glide"
        :content-padding="0"
        :content-scrollable="false"
        auto-height
        borderless
      >
        <TxTabItem :name="ADMIN_TABS.login" icon-class="i-carbon-login">
          <template #name>
            登录配置
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-settings" />
              OAuth 配置
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid">
                <span class="field-label">授权来源</span>
                <select v-model="state.oauth.provider" class="px-4 outline-none border border-black/10 rounded-2xl bg-white min-h-11 dark:border-white/10 dark:bg-[#151820]" :disabled="!isAdmin">
                  <option value="github">
                    GitHub
                  </option>
                  <option value="google">
                    Google
                  </option>
                  <option value="custom">
                    Custom
                  </option>
                </select>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">客户端 ID</span>
                <TxInput v-model="state.oauth.clientId" :disabled="!isAdmin" placeholder="OAuth 客户端 ID" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">授权地址</span>
                <TxInput v-model="state.oauth.authorizeUrl" :disabled="!isAdmin" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">回调地址</span>
                <TxInput v-model="state.oauth.callbackUrl" :disabled="!isAdmin" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <TxButton variant="primary" :disabled="!isAdmin" @click="saveOauthConfig">
                保存并启用 OAuth
              </TxButton>
              <TxButton variant="secondary" :disabled="!isAdmin" @click="fillOauthFromGitHubApp">
                从 GitHub App 同步
              </TxButton>
              <span class="text-xs text-slate-500 dark:text-slate-400">
                当前状态：{{ state.oauth.enabled ? '已启用' : '未启用' }}
              </span>
            </div>
          </div>

          <div class="mt-5 p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 mb-1 flex gap-2 items-center">
                  <span class="i-carbon-login" />
                  多 OAuth / OIDC 登录源
                </div>
                <p class="text-sm text-slate-500 leading-6 dark:text-slate-400">
                  Client Secret 保存到服务端配置；登录页只展示已启用且配置完整的登录源。
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <TxButton size="sm" variant="secondary" :disabled="!isAdmin || oauthConfigForm.loading" @click="onRefreshOAuthProviderConfigs">
                  刷新
                </TxButton>
                <TxButton size="sm" variant="secondary" :disabled="!isAdmin || oauthConfigForm.loading" @click="openLinuxDoOAuthProviderDialog">
                  添加 LINUX DO
                </TxButton>
                <TxButton size="sm" variant="secondary" :disabled="!isAdmin || oauthConfigForm.loading" @click="openAddOAuthProviderDialog">
                  添加登录源
                </TxButton>
              </div>
            </div>

            <div v-if="!oauthProviderConfigs.length" class="text-sm text-slate-500 mt-4 p-5 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
              暂无 OAuth/OIDC 登录源。
            </div>

            <div v-else class="admin-table mt-4">
              <div class="admin-table-row admin-table-head grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_120px_auto]">
                <span>登录源</span>
                <span>状态</span>
                <span>授权端点</span>
                <span>启用</span>
                <span>操作</span>
              </div>
              <div v-for="provider in oauthProviderConfigs" :key="provider.id" class="admin-table-row grid-cols-[minmax(0,1.2fr)_120px_minmax(0,1fr)_120px_auto]">
                <div class="flex gap-3 min-w-0 items-center">
                  <span class="oauth-provider-logo">
                    <img v-if="provider.logoUrl" :src="provider.logoUrl" :alt="provider.name">
                    <span v-else class="i-carbon-login" />
                  </span>
                  <div class="min-w-0">
                    <div class="fw-900 truncate">
                      {{ provider.name || provider.id }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ provider.id }} · {{ provider.scopes }}
                    </div>
                  </div>
                </div>
                <span class="admin-pill" :class="provider.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
                  {{ provider.configured ? '配置完整' : '待配置' }}
                </span>
                <span class="text-xs text-slate-500 truncate dark:text-slate-400">
                  {{ provider.authorizeUrl || '未填写 Authorize URL' }}
                </span>
                <div>
                  <label class="option-check compact">
                    <TxCheckbox v-model="provider.enabled" variant="checkmark" :disabled="!isAdmin || oauthConfigForm.loading" aria-label="启用登录源" @change="persistOAuthProviderListState" />
                    <span><b>{{ provider.enabled ? '启用' : '停用' }}</b></span>
                  </label>
                </div>
                <div class="flex gap-2 justify-end">
                  <TxButton size="sm" variant="secondary" :disabled="!isAdmin || oauthConfigForm.loading" @click="openEditOAuthProviderDialog(provider)">
                    编辑
                  </TxButton>
                  <TxButton size="sm" variant="danger" :disabled="!isAdmin || oauthConfigForm.loading" @click="removeOAuthProvider(provider.id)">
                    移除
                  </TxButton>
                </div>
              </div>
            </div>

            <div v-if="isOAuthProviderDialogOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeOAuthProviderDialog">
              <div class="dialog-panel max-h-[90vh] max-w-3xl w-full overflow-y-auto">
                <div class="flex gap-3 items-start justify-between">
                  <div>
                    <h3 class="text-2xl fw-900">
                      {{ oauthProviderDialogMode === 'edit' ? '编辑登录源' : '添加登录源' }}
                    </h3>
                    <p class="field-hint mt-2">
                      配置保存后会自动刷新登录源列表；Logo URL 会展示在登录页和后台列表。
                    </p>
                  </div>
                  <button class="icon-btn shrink-0" title="关闭" @click="closeOAuthProviderDialog">
                    <span class="i-carbon-close" />
                  </button>
                </div>

                <div class="mt-5 gap-4 grid lg:grid-cols-2">
                  <label class="gap-2 grid">
                    <span class="field-label">登录源 ID</span>
                    <TxInput v-model="oauthProviderDraft.id" :disabled="oauthProviderDialogMode === 'edit' || !isAdmin || oauthConfigForm.loading" placeholder="linux-do" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">显示名称</span>
                    <TxInput v-model="oauthProviderDraft.name" :disabled="!isAdmin || oauthConfigForm.loading" placeholder="Linux.do" />
                  </label>
                  <label class="gap-2 grid lg:col-span-2">
                    <span class="field-label">Logo URL</span>
                    <TxInput v-model="oauthProviderDraft.logoUrl" :disabled="!isAdmin || oauthConfigForm.loading" placeholder="https://example.com/logo.svg" />
                  </label>
                  <div class="flex gap-3 items-center lg:col-span-2">
                    <span class="oauth-provider-logo">
                      <img v-if="oauthProviderDraft.logoUrl" :src="oauthProviderDraft.logoUrl" :alt="oauthProviderDraft.name">
                      <span v-else class="i-carbon-login" />
                    </span>
                    <label class="option-check compact">
                      <TxCheckbox v-model="oauthProviderDraft.enabled" variant="checkmark" :disabled="!isAdmin || oauthConfigForm.loading" aria-label="启用登录源" />
                      <span><b>启用</b></span>
                    </label>
                  </div>
                  <label class="gap-2 grid">
                    <span class="field-label">Client ID</span>
                    <TxInput v-model="oauthProviderDraft.clientId" :disabled="!isAdmin || oauthConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Client Secret</span>
                    <TxInput v-model="oauthProviderDraft.clientSecret" type="password" :disabled="!isAdmin || oauthConfigForm.loading" :placeholder="oauthProviderDraft.clientSecretMasked || '保存到服务端配置'" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Callback URL</span>
                    <TxInput v-model="oauthProviderDraft.callbackUrl" :disabled="!isAdmin || oauthConfigForm.loading" placeholder="https://your-domain.com/api/oauth/callback" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Scopes</span>
                    <TxInput v-model="oauthProviderDraft.scopes" :disabled="!isAdmin || oauthConfigForm.loading" placeholder="openid profile email" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Authorize URL</span>
                    <TxInput v-model="oauthProviderDraft.authorizeUrl" :disabled="!isAdmin || oauthConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Token URL</span>
                    <TxInput v-model="oauthProviderDraft.tokenUrl" :disabled="!isAdmin || oauthConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">UserInfo URL</span>
                    <TxInput v-model="oauthProviderDraft.userInfoUrl" :disabled="!isAdmin || oauthConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Issuer URL（可选）</span>
                    <TxInput v-model="oauthProviderDraft.issuerUrl" :disabled="!isAdmin || oauthConfigForm.loading" />
                  </label>
                </div>

                <div class="mt-5 flex flex-wrap gap-3 justify-end">
                  <TxButton variant="ghost" @click="closeOAuthProviderDialog">
                    取消
                  </TxButton>
                  <TxButton variant="primary" :disabled="!isAdmin || oauthConfigForm.loading" @click="saveOAuthProviderDialog">
                    {{ oauthConfigForm.loading ? '保存中...' : oauthProviderDialogMode === 'edit' ? '保存修改' : '添加并刷新' }}
                  </TxButton>
                </div>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <span v-if="oauthConfigForm.message" class="text-xs text-slate-500 dark:text-slate-400">
                {{ oauthConfigForm.message }}
              </span>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.policy" icon-class="i-carbon-rule">
          <template #name>
            申请策略
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 mb-1 flex gap-2 items-center">
                  <span class="i-carbon-settings-adjust" />
                  系统开关
                </div>
                <p class="text-sm text-slate-500 leading-6 dark:text-slate-400">
                  快速开启或关闭站点、登录、注册、充值和认证入口；关闭后服务端也会拦截对应提交。
                </p>
              </div>
              <TxButton variant="primary" :disabled="!isAdmin || systemConfigForm.loading" @click="saveSystemConfig">
                {{ systemConfigForm.loading ? '保存中...' : '保存系统开关' }}
              </TxButton>
            </div>
            <div class="mt-5 gap-4 grid lg:grid-cols-2">
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.siteEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading" />
                <span><b>开启站点</b><small>关闭后普通页面和业务入口暂停，仅管理员可登录后台恢复。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.loginEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading || !systemConfigForm.siteEnabled" />
                <span><b>开启登录</b><small>关闭普通 OAuth 登录；管理员账号密码登录保留。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.registrationEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading || !systemConfigForm.siteEnabled" />
                <span><b>开启注册</b><small>关闭后新 OAuth 用户不能创建账号，已有用户仍可登录。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.rechargeEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading || !systemConfigForm.siteEnabled" />
                <span><b>开启充值</b><small>关闭用户充值入口和新充值订单创建。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.studentVerificationEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading || !systemConfigForm.siteEnabled" />
                <span><b>开启学生认证</b><small>控制学生认证材料提交和教育邮箱证明码生成。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="systemConfigForm.frontlineVerificationEnabled" variant="checkmark" :disabled="!isAdmin || systemConfigForm.loading || !systemConfigForm.siteEnabled" />
                <span><b>开启一线认证</b><small>控制一线认证材料提交。</small></span>
              </label>
            </div>
            <div class="mt-5 gap-4 grid md:grid-cols-2 xl:grid-cols-3">
              <label class="gap-2 grid">
                <span class="field-label">关站提示</span>
                <TxInput v-model="systemConfigForm.siteClosedReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="系统维护中，请稍后再试。" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">登录关闭提示</span>
                <TxInput v-model="systemConfigForm.loginClosedReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="登录入口维护中，请稍后再试。" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">注册关闭提示</span>
                <TxInput v-model="systemConfigForm.registrationClosedReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="新用户注册暂未开放。" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">充值关闭提示</span>
                <TxInput v-model="systemConfigForm.rechargeClosedReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="充值入口维护中，请稍后再试。" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">学生认证关闭提示</span>
                <TxInput v-model="systemConfigForm.studentVerificationReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="学生认证暂未开放。" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">一线认证关闭提示</span>
                <TxInput v-model="systemConfigForm.frontlineVerificationReason" :disabled="!isAdmin || systemConfigForm.loading" placeholder="一线认证暂未开放。" />
              </label>
            </div>
            <div v-if="systemConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              {{ systemConfigForm.message }}
            </div>
          </div>

          <div class="mt-5 p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 mb-1 flex gap-2 items-center">
                  <span class="i-carbon-rule" />
                  申请限额与反滥用
                </div>
                <p class="text-sm text-slate-500 leading-6 dark:text-slate-400">
                  最小字数、冷却、PoW、Turnstile 和各类目开放窗口会在提交前后同时校验。
                </p>
              </div>
              <TxButton variant="primary" :disabled="!isAdmin || applicationPolicyConfigForm.loading" @click="saveApplicationPolicyConfig">
                {{ applicationPolicyConfigForm.loading ? '保存中...' : '保存策略配置' }}
              </TxButton>
            </div>

            <div class="mt-5 gap-4 grid lg:grid-cols-3">
              <label class="gap-2 grid">
                <span class="field-label">申请最小字数</span>
                <TxNumberInput v-model="state.applicationPolicy.minDescriptionChars" :min="0" :max="5000" :step="10" :controls="false" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">提交冷却（秒）</span>
                <TxNumberInput v-model="state.applicationPolicy.submitCooldownSeconds" :min="0" :max="86400" :step="10" :controls="false" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">PoW 难度</span>
                <TxNumberInput v-model="state.applicationPolicy.powDifficulty" :min="1" :max="6" :step="1" :controls="false" :disabled="!isAdmin || applicationPolicyConfigForm.loading || !state.applicationPolicy.powEnabled" />
              </label>
            </div>

            <div class="mt-5 gap-4 grid lg:grid-cols-2">
              <label class="option-check">
                <TxCheckbox v-model="state.applicationPolicy.powEnabled" variant="checkmark" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
                <span><b>启用 PoW</b><small>用户提交时本地计算 nonce，用于增加压测成本。</small></span>
              </label>
              <label class="option-check">
                <TxCheckbox v-model="state.applicationPolicy.turnstileEnabled" variant="checkmark" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
                <span><b>启用 Turnstile</b><small>需要配置 Site Key 和 Secret Key，Secret Key 会保存到服务端状态。</small></span>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">Turnstile Site Key</span>
                <TxInput v-model="state.applicationPolicy.turnstileSiteKey" :disabled="!isAdmin || applicationPolicyConfigForm.loading || !state.applicationPolicy.turnstileEnabled" placeholder="0x4AAAA..." />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">Turnstile Secret Key</span>
                <TxInput v-model="applicationPolicyConfigForm.turnstileSecretKey" type="password" :disabled="!isAdmin || applicationPolicyConfigForm.loading || !state.applicationPolicy.turnstileEnabled" :placeholder="state.applicationPolicy.turnstileSecretKey || '0x4AAAA...'" />
              </label>
            </div>
          </div>

          <div class="mt-5 space-y-4">
            <div v-for="type in APPLICATION_POLICY_TYPES" :key="type" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div>
                  <div class="text-base fw-900">
                    {{ applicationTypeLabel(type) }}
                  </div>
                  <p class="field-hint mt-1">
                    每日总量、个人每日总量和开放时间段按本地日期计算。
                  </p>
                </div>
                <label class="option-check compact">
                  <TxCheckbox v-model="state.applicationPolicy.categories[type].enabled" variant="checkmark" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
                  <span><b>开放</b></span>
                </label>
              </div>
              <div class="mt-4 gap-4 grid md:grid-cols-2 xl:grid-cols-5">
                <label class="gap-2 grid">
                  <span class="field-label">每日总限额</span>
                  <TxNumberInput v-model="state.applicationPolicy.categories[type].dailyLimit" :min="0" :max="100000" :step="1" :controls="false" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">个人每日限额</span>
                  <TxNumberInput v-model="state.applicationPolicy.categories[type].perUserDailyLimit" :min="0" :max="100000" :step="1" :controls="false" :disabled="!isAdmin || applicationPolicyConfigForm.loading" />
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">开放开始</span>
                  <TxInput v-model="state.applicationPolicy.categories[type].openStart" :disabled="!isAdmin || applicationPolicyConfigForm.loading" placeholder="09:00" />
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">开放结束</span>
                  <TxInput v-model="state.applicationPolicy.categories[type].openEnd" :disabled="!isAdmin || applicationPolicyConfigForm.loading" placeholder="18:00" />
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">关闭原因</span>
                  <TxInput v-model="state.applicationPolicy.categories[type].closedReason" :disabled="!isAdmin || applicationPolicyConfigForm.loading" placeholder="维护中 / 名额暂停" />
                </label>
              </div>
            </div>
          </div>

          <div v-if="applicationPolicyConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
            {{ applicationPolicyConfigForm.message }}
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.github" icon-class="i-carbon-logo-github">
          <template #name>
            GitHub 应用
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-logo-github" />
              开源认证 GitHub App
            </div>
            <div class="text-sm mb-5 p-3 rounded-2xl" :class="githubAppConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
              {{ githubAppConfigForm.configured ? 'GitHub App 已配置，用户可发起 GitHub 授权并同步公开仓库。' : '尚未配置 GitHub App Client ID / Secret，开源认证只能显示未授权状态。' }}
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid">
                <span class="field-label">应用名称</span>
                <TxInput v-model="githubAppConfigForm.appName" :disabled="!isAdmin || githubAppConfigForm.loading" placeholder="Touch Great Welfare" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">应用短标识</span>
                <TxInput v-model="githubAppConfigForm.appSlug" :disabled="!isAdmin || githubAppConfigForm.loading" placeholder="touch-great-welfare" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">客户端 ID</span>
                <TxInput v-model="githubAppConfigForm.clientId" :disabled="!isAdmin || githubAppConfigForm.loading" placeholder="GitHub 应用客户端 ID" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">客户端密钥</span>
                <TxInput v-model="githubAppConfigForm.clientSecret" :disabled="!isAdmin || githubAppConfigForm.loading" type="password" :placeholder="githubAppConfigForm.clientSecretMasked || '保存到服务端配置'" />
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">回调地址</span>
                <TxInput v-model="githubAppConfigForm.callbackUrl" :disabled="!isAdmin || githubAppConfigForm.loading" placeholder="https://your-domain.com/api/github-app/callback" />
                <span class="field-hint">请把该地址填到 GitHub 应用的回调地址。</span>
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">授权范围</span>
                <TxInput v-model="githubAppConfigForm.scopes" :disabled="!isAdmin || githubAppConfigForm.loading" placeholder="read:user user:email public_repo" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">授权地址</span>
                <TxInput v-model="githubAppConfigForm.authorizeUrl" :disabled="!isAdmin || githubAppConfigForm.loading" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">令牌地址</span>
                <TxInput v-model="githubAppConfigForm.tokenUrl" :disabled="!isAdmin || githubAppConfigForm.loading" />
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">接口基础地址</span>
                <TxInput v-model="githubAppConfigForm.apiBaseUrl" :disabled="!isAdmin || githubAppConfigForm.loading" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="githubAppConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || githubAppConfigForm.loading" aria-label="启用 GitHub App 授权" />
                启用 GitHub App 授权
              </label>
              <TxButton variant="primary" :disabled="!isAdmin || githubAppConfigForm.loading" @click="saveGitHubAppConfig">
                {{ githubAppConfigForm.loading ? '读取 / 保存中...' : '保存 GitHub App 配置' }}
              </TxButton>
            </div>
            <div v-if="githubAppConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              <div>{{ githubAppConfigForm.message }}</div>
              <pre v-if="githubAppConfigForm.envPreview" class="mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(githubAppConfigForm.envPreview, null, 2) }}</pre>
            </div>
            <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
              用户在“开源认证”页点击授权后，会跳转 GitHub，同步 GitHub 用户名与公开仓库；提交公益申请时只有已授权用户才会获得“开源认证”标签。
              <br>
              GitHub 应用回调地址必须配置为：{{ githubAppConfigForm.callbackUrl }}
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.ai" icon-class="i-carbon-ai-status">
          <template #name>
            AI 配置
          </template>

          <TxTabs
            class="admin-config-tabs mt-4"
            default-value="ai-provider"
            placement="top"
            indicator-variant="block"
            indicator-motion="glide"
            :content-padding="0"
            :content-scrollable="false"
            auto-height
            borderless
          >
            <TxTabItem name="ai-provider" icon-class="i-carbon-ai-status">
              <template #name>
                AI Provider
              </template>

              <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
                <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
                  <span class="i-carbon-ai-status" />
                  AI Provider
                </div>
                <div class="text-sm mb-5 p-3 rounded-2xl" :class="aiConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
                  {{ aiConfigForm.configured ? `API Key 已配置：${aiConfigForm.apiKeyMasked}` : '尚未配置 OpenAI 兼容 API Key，AI 调用不可用。' }}
                </div>
                <p class="text-xs text-slate-500 leading-5 mb-5 dark:text-slate-400">
                  用户侧 NewAPI Key 管理复用这里的 NewAPI 管理 Key、管理地址、用户 ID、默认 TTL 与配额。
                </p>
                <div class="gap-5 grid lg:grid-cols-2">
                  <label class="gap-2 grid lg:col-span-2">
                    <span class="field-label">接口基础地址</span>
                    <TxInput v-model="aiConfigForm.baseUrl" :disabled="!isAdmin || aiConfigForm.loading" placeholder="https://api.openai.com/v1" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">OpenAI / 兼容 API Key</span>
                    <TxInput v-model="aiConfigForm.apiKey" :disabled="!isAdmin || aiConfigForm.loading" type="password" :placeholder="aiConfigForm.apiKeyMasked || '保存到服务端加密配置'" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">NewAPI 管理 Key</span>
                    <TxInput v-model="aiConfigForm.newapiKey" :disabled="!isAdmin || aiConfigForm.loading" type="password" :placeholder="aiConfigForm.newapiKeyMasked || '用于生成临时 Key，可选'" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">图片模型</span>
                    <TxInput v-model="aiConfigForm.imageModel" :disabled="!isAdmin || aiConfigForm.loading" placeholder="gpt-image-1.5 或 image2" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">申请审核模型</span>
                    <TxInput v-model="aiConfigForm.reviewModel" :disabled="!isAdmin || aiConfigForm.loading" placeholder="gpt-4.1-mini" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">NewAPI 管理地址</span>
                    <TxInput v-model="aiConfigForm.newapiManagementBaseUrl" :disabled="!isAdmin || aiConfigForm.loading" placeholder="默认复用接口基础地址" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">NewAPI 用户 ID</span>
                    <TxInput v-model="aiConfigForm.newapiUserId" :disabled="!isAdmin || aiConfigForm.loading" placeholder="可选" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">临时 Key TTL（分钟）</span>
                    <TxInput v-model="aiConfigForm.temporaryKeyTtlMinutes" type="number" :disabled="!isAdmin || aiConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">临时 Key 配额</span>
                    <TxInput v-model="aiConfigForm.temporaryKeyQuota" type="number" :disabled="!isAdmin || aiConfigForm.loading" />
                  </label>
                </div>

                <div class="mt-6 p-4 border border-indigo-200 rounded-3xl bg-indigo-50/70 dark:border-indigo-400/20 dark:bg-indigo-950/20">
                  <div class="flex flex-wrap gap-3 items-start justify-between">
                    <div>
                      <div class="text-sm text-indigo-950 fw-900 dark:text-indigo-100">
                        LLMApi 模型价格
                      </div>
                      <p class="field-hint mt-1">
                        用户侧暂开放 Codex / GPT PRO；ClaudeCode / Mimo 暂停选择。Codex 按 USD 额度配置，GPT PRO 复用额度字段表示对话轮次，默认 5 轮、7 天有效。
                      </p>
                    </div>
                    <span class="text-xs text-indigo-700 fw-800 px-3 py-1 rounded-full bg-white dark:text-indigo-200 dark:bg-white/10">
                      {{ aiConfigForm.llmApiModels.filter(model => model.enabled).length }} 个启用
                    </span>
                  </div>
                  <div class="mt-4 space-y-4">
                    <div v-for="model in aiConfigForm.llmApiModels" :key="model.key" class="p-4 border border-black/8 rounded-2xl bg-white dark:border-white/10 dark:bg-[#151820]">
                      <div class="flex flex-wrap gap-3 items-start justify-between">
                        <div>
                          <div class="text-sm fw-900">
                            {{ model.name }} · {{ model.provider }}
                          </div>
                          <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                            {{ llmApiRegionLabel(model.region) }}模型 · {{ model.description }}
                          </div>
                        </div>
                        <TxCheckbox v-model="model.enabled" variant="checkmark" :disabled="!isAdmin || aiConfigForm.loading" label="启用" />
                      </div>
                      <div class="mt-4 gap-3 grid md:grid-cols-3 xl:grid-cols-7">
                        <label class="gap-2 grid">
                          <span class="field-label">价格（积分/USD）</span>
                          <TxNumberInput v-model="model.pointsPerUsd" :min="1" :max="1000" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">{{ model.key === 'gpt-pro' ? '默认轮次' : '默认额度 USD' }}</span>
                          <TxNumberInput v-model="model.defaultBudgetUsd" :min="model.minBudgetUsd" :max="model.maxBudgetUsd" :step="10" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">{{ model.key === 'gpt-pro' ? '最小轮次' : '最小 USD' }}</span>
                          <TxNumberInput v-model="model.minBudgetUsd" :min="1" :max="model.maxBudgetUsd" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">{{ model.key === 'gpt-pro' ? '最大轮次' : '最大 USD' }}</span>
                          <TxNumberInput v-model="model.maxBudgetUsd" :min="model.minBudgetUsd" :max="100000" :step="10" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">IP / RPM</span>
                          <div class="gap-2 grid grid-cols-2">
                            <TxNumberInput v-model="model.ipLimit" :min="1" :max="50" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                            <TxNumberInput v-model="model.rpmLimit" :min="1" :max="1000" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                          </div>
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">默认 TPM</span>
                          <TxNumberInput v-model="model.tpmLimit" :min="1" :max="10000000" :step="1000" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">并发</span>
                          <TxNumberInput v-model="model.concurrencyLimit" :min="1" :max="100" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="mt-5 flex flex-wrap gap-3 items-center">
                  <label class="text-sm flex gap-2 items-center">
                    <TxCheckbox v-model="aiConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || aiConfigForm.loading" aria-label="启用 AI Provider" />
                    启用 AI Provider
                  </label>
                  <TxButton variant="primary" :disabled="!isAdmin || aiConfigForm.loading" @click="saveAiProviderConfig">
                    {{ aiConfigForm.loading ? '读取 / 保存中...' : '保存 AI 配置' }}
                  </TxButton>
                </div>
                <div v-if="aiConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
                  <div>{{ aiConfigForm.message }}</div>
                  <pre v-if="aiConfigForm.envPreview" class="mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(aiConfigForm.envPreview, null, 2) }}</pre>
                </div>
                <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
                  图片生成结果写入 AI_ASSETS R2；接口密钥保存到服务端加密配置。
                </div>
              </div>
            </TxTabItem>

            <TxTabItem name="database-provision" icon-class="i-carbon-data-base">
              <template #name>
                数据库发放
              </template>

              <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
                <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
                  <span class="i-carbon-data-base" />
                  数据库自动发放
                </div>
                <div class="text-sm mb-5 p-3 rounded-2xl" :class="databaseProvisionConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
                  {{ databaseProvisionConfigForm.configured ? '数据库 root 连接已配置，审批通过的 PostgreSQL 资源可自动创建库、角色和权限。' : '尚未配置数据库 root 连接，数据库资源审批后会转人工处理。' }}
                </div>
                <div class="gap-5 grid lg:grid-cols-2">
                  <label class="gap-2 grid lg:col-span-2">
                    <span class="field-label">PostgreSQL root 连接</span>
                    <TxInput v-model="databaseProvisionConfigForm.rootUrl" :disabled="!isAdmin || databaseProvisionConfigForm.loading" type="password" :placeholder="databaseProvisionConfigForm.rootUrlMasked || 'postgresql://root:password@host:5432/postgres'" />
                    <span class="field-hint">仅在 Worker 后端用于创建数据库、登录角色和授权；服务端加密保存。</span>
                    <label v-if="databaseProvisionConfigForm.rootUrlMasked" class="option-check compact">
                      <TxCheckbox v-model="databaseProvisionConfigForm.clearRootUrl" variant="checkmark" :disabled="!isAdmin || databaseProvisionConfigForm.loading || !!databaseProvisionConfigForm.rootUrl" aria-label="清空已保存的 PostgreSQL root 连接" />
                      <span><b>清空已保存 root 连接</b></span>
                    </label>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">默认有效期（天）</span>
                    <TxInput v-model="databaseProvisionConfigForm.defaultExpiresInDays" type="number" :disabled="!isAdmin || databaseProvisionConfigForm.loading" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">数据库命名前缀</span>
                    <TxInput v-model="databaseProvisionConfigForm.databasePrefix" :disabled="!isAdmin || databaseProvisionConfigForm.loading" placeholder="twg" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">OnePanel 地址</span>
                    <TxInput v-model="databaseProvisionConfigForm.onePanelBaseUrl" :disabled="!isAdmin || databaseProvisionConfigForm.loading" placeholder="https://panel.example.com" />
                    <span class="field-hint">用于读取 OnePanel 设备、系统和实时概览状态；不会执行写操作。</span>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">OnePanel API Key</span>
                    <TxInput v-model="databaseProvisionConfigForm.onePanelApiKey" :disabled="!isAdmin || databaseProvisionConfigForm.loading" type="password" :placeholder="databaseProvisionConfigForm.onePanelApiKeyMasked || 'op_...'" />
                    <label v-if="databaseProvisionConfigForm.onePanelApiKeyMasked" class="option-check compact">
                      <TxCheckbox v-model="databaseProvisionConfigForm.clearOnePanelApiKey" variant="checkmark" :disabled="!isAdmin || databaseProvisionConfigForm.loading || !!databaseProvisionConfigForm.onePanelApiKey" aria-label="清空已保存的 OnePanel API Key" />
                      <span><b>清空已保存 OnePanel Key</b></span>
                    </label>
                  </label>
                </div>
                <div class="mt-5 flex flex-wrap gap-3 items-center">
                  <label class="text-sm flex gap-2 items-center">
                    <TxCheckbox v-model="databaseProvisionConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || databaseProvisionConfigForm.loading" aria-label="启用数据库自动发放" />
                    启用数据库自动发放
                  </label>
                  <TxButton variant="primary" :disabled="!isAdmin || databaseProvisionConfigForm.loading" @click="saveDatabaseProvisionProviderConfig">
                    {{ databaseProvisionConfigForm.loading ? '读取 / 保存中...' : '保存数据库发放配置' }}
                  </TxButton>
                  <TxButton variant="secondary" :disabled="!isAdmin || databaseProvisionConfigForm.testing || databaseProvisionConfigForm.loading" @click="testDatabaseProvisionProviderConfig">
                    {{ databaseProvisionConfigForm.testing ? '测试中...' : '测试 root 连接' }}
                  </TxButton>
                  <TxButton variant="secondary" :disabled="!isAdmin || databaseProvisionConfigForm.checkingOnePanel || databaseProvisionConfigForm.loading" @click="readOnePanelStatus">
                    {{ databaseProvisionConfigForm.checkingOnePanel ? '读取中...' : '读取 OnePanel 状态' }}
                  </TxButton>
                </div>
                <div v-if="databaseProvisionConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
                  {{ databaseProvisionConfigForm.message }}
                </div>
                <div v-if="databaseProvisionConfigForm.onePanelStatusSnapshot" class="mt-5 space-y-3">
                  <div class="text-xs text-slate-500 dark:text-slate-400">
                    {{ databaseProvisionConfigForm.onePanelStatusSnapshot.baseUrl }} · {{ formatDate(databaseProvisionConfigForm.onePanelStatusSnapshot.checkedAt) }}
                  </div>
                  <div v-for="endpoint in databaseProvisionConfigForm.onePanelStatusSnapshot.endpoints" :key="endpoint.id" class="p-3 rounded-2xl bg-slate-50 dark:bg-white/5">
                    <div class="text-xs fw-900 flex flex-wrap gap-2 items-center">
                      <TxStatusBadge :text="endpoint.ok ? '可用' : '失败'" :status="endpoint.ok ? 'success' : 'danger'" size="sm" />
                      <span>{{ endpoint.label }}</span>
                      <span class="text-slate-500 dark:text-slate-400">{{ endpoint.method }} {{ endpoint.path }} · {{ endpoint.status || '网络错误' }}</span>
                    </div>
                    <div v-if="endpoint.error" class="text-xs text-red-600 mt-2 dark:text-red-200">
                      {{ endpoint.error }}
                    </div>
                    <pre class="text-xs leading-5 mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(endpoint.data, null, 2) }}</pre>
                  </div>
                </div>
                <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
                  当前自动发放仅支持 PostgreSQL；MySQL、Redis、MongoDB 和其他 OnePanel 托管资源会保留在人工处理队列中。
                </div>
              </div>
            </TxTabItem>

            <TxTabItem name="sub2api" icon-class="i-carbon-api-1">
              <template #name>
                Sub2API
              </template>

              <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
                <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
                  <span class="i-carbon-api-1" />
                  Sub2API 直连配置
                </div>
                <div class="text-sm mb-5 p-3 rounded-2xl" :class="sub2ApiConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
                  {{ sub2ApiConfigForm.configured ? 'Sub2API 已配置，用户可在资源申请通过后自动发放 API Key。' : '尚未配置 Sub2API 基础地址或 Admin API Key。' }}
                </div>
                <div class="gap-5 grid lg:grid-cols-2">
                  <label class="gap-2 grid lg:col-span-2">
                    <span class="field-label">Sub2API 基础地址</span>
                    <TxInput v-model="sub2ApiConfigForm.baseUrl" :disabled="!isAdmin || sub2ApiConfigForm.loading" placeholder="https://sub2api.example.com" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">Admin API Key</span>
                    <TxInput v-model="sub2ApiConfigForm.adminApiKey" :disabled="!isAdmin || sub2ApiConfigForm.loading" type="password" :placeholder="sub2ApiConfigForm.adminApiKeyMasked || 'admin-...' " />
                    <span class="field-hint">用于测试连接、拉取分组、查询/创建 Sub2API 用户，并通过 Admin API 创建/删除 API Key；服务端加密保存。</span>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">默认分组</span>
                    <select v-model="sub2ApiConfigForm.defaultGroupId" class="form-select" :disabled="!isAdmin || sub2ApiConfigForm.loading || !sub2ApiConfigForm.groups.length">
                      <option value="">
                        {{ sub2ApiConfigForm.groups.length ? '不指定分组' : '请先测试连接拉取分组' }}
                      </option>
                      <option v-for="group in sub2ApiConfigForm.groups" :key="group.id" :value="group.id">
                        {{ group.name }}（{{ group.id }}）
                      </option>
                    </select>
                    <span class="field-hint">点击“测试连接”后自动拉取 Sub2API 分组；额度、有效期和限额以资源申请表单为准。</span>
                  </label>
                </div>
                <div class="mt-5 flex flex-wrap gap-3 items-center">
                  <label class="text-sm flex gap-2 items-center">
                    <TxCheckbox v-model="sub2ApiConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || sub2ApiConfigForm.loading" aria-label="启用 Sub2API" />
                    启用 Sub2API
                  </label>
                  <TxButton variant="primary" :disabled="!isAdmin || sub2ApiConfigForm.loading" @click="saveSub2ApiProviderConfig">
                    {{ sub2ApiConfigForm.loading ? '读取 / 保存中...' : '保存 Sub2API 配置' }}
                  </TxButton>
                  <TxButton variant="secondary" :disabled="!isAdmin || sub2ApiConfigForm.testing || sub2ApiConfigForm.loading" @click="testSub2ApiProviderConfig">
                    {{ sub2ApiConfigForm.testing ? '测试中...' : '测试连接并拉取分组' }}
                  </TxButton>
                </div>
                <div v-if="sub2ApiConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
                  {{ sub2ApiConfigForm.message }}
                </div>
                <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
                  用户 API Key 生成后只展示一次明文；本项目仅保存哈希、脱敏值和 Sub2API Key ID。
                </div>
              </div>
            </TxTabItem>
          </TxTabs>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.educationMail" icon-class="i-carbon-email">
          <template #name>
            教育邮箱
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-email" />
              DoneMail 收件验证
            </div>
            <div class="text-sm mb-5 p-3 rounded-2xl" :class="educationMailConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
              {{ educationMailConfigForm.configured ? `DoneMail 已配置：${educationMailConfigForm.adminKeyMasked}` : '尚未配置 DoneMail API，学生认证邮件仍需人工核对。' }}
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">DoneMail API 基础地址</span>
                <TxInput v-model="educationMailConfigForm.baseUrl" :disabled="!isAdmin || educationMailConfigForm.loading" placeholder="https://sow.us.kg" />
                <span class="field-hint">后台会调用 /api/mails，并使用 X-Admin-Key 鉴权。</span>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">X-Admin-Key</span>
                <TxInput v-model="educationMailConfigForm.adminKey" :disabled="!isAdmin || educationMailConfigForm.loading" type="password" :placeholder="educationMailConfigForm.adminKeyMasked || 'DoneMail 公开 API 密钥'" />
                <span class="field-hint">仅保存在服务端加密配置中。</span>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">平台收件邮箱</span>
                <TxInput v-model="educationMailConfigForm.inboxAddress" :disabled="!isAdmin || educationMailConfigForm.loading" placeholder="welfare@tagzxia.com" />
                <span class="field-hint">用户教育邮箱认证模板会发往该收件箱。</span>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">同步回溯窗口（小时）</span>
                <TxInput v-model="educationMailConfigForm.lookbackHours" type="number" :disabled="!isAdmin || educationMailConfigForm.loading" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="educationMailConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || educationMailConfigForm.loading" aria-label="启用教育邮箱收件验证" />
                启用自动验证
              </label>
              <TxButton variant="primary" :disabled="!isAdmin || educationMailConfigForm.loading" @click="saveEducationMailProviderConfig">
                {{ educationMailConfigForm.loading ? '读取 / 保存中...' : '保存收件配置' }}
              </TxButton>
              <TxButton variant="secondary" :disabled="!isAdmin || educationMailConfigForm.testing || educationMailConfigForm.loading" @click="testEducationMailProviderConfig">
                {{ educationMailConfigForm.testing ? '测试中...' : '测试连接' }}
              </TxButton>
              <TxButton variant="secondary" :disabled="!isAdmin || educationMailConfigForm.syncing || educationMailConfigForm.loading" @click="syncEducationMailProviderMessages">
                {{ educationMailConfigForm.syncing ? '同步中...' : '同步待认证邮件' }}
              </TxButton>
            </div>
            <div v-if="educationMailConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              <div>{{ educationMailConfigForm.message }}</div>
              <div v-if="educationMailConfigForm.lastSync" class="mt-2">
                已匹配 {{ educationMailConfigForm.lastSync.verified }} / {{ educationMailConfigForm.lastSync.checked }} 个邮件认证码。
              </div>
            </div>
            <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
              自动验证只确认教育邮箱已按模板发送认证码；学生认证是否通过仍由管理员结合材料审核。
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.notifications" icon-class="i-carbon-notification">
          <template #name>
            通知配置
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-notification" />
              通知供应商
            </div>
            <div class="text-sm mb-5 p-3 rounded-2xl" :class="notificationProviderConfigForm.emailConfigured || notificationProviderConfigForm.pushConfigured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
              邮件：{{ notificationProviderConfigForm.emailConfigured ? '已配置' : '未配置' }}；飞书邮件：{{ notificationProviderConfigForm.feishuMailConfigured ? '已配置' : '未配置' }}；浏览器推送：{{ notificationProviderConfigForm.pushConfigured ? '已配置' : '未配置' }}。
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid">
                <span class="field-label">Resend API Key</span>
                <TxInput v-model="notificationProviderConfigForm.resendApiKey" :disabled="!isAdmin || notificationProviderConfigForm.loading" type="password" :placeholder="notificationProviderConfigForm.resendApiKeyMasked || '保存到服务端加密配置'" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">Resend 发件人</span>
                <TxInput v-model="notificationProviderConfigForm.resendFromEmail" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="Touch Great Welfare <notice@example.com>" />
              </label>
              <div class="p-4 border border-emerald-200 rounded-3xl bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-950/10 lg:col-span-2">
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div>
                    <div class="text-base fw-900 flex gap-2 items-center">
                      <span class="i-carbon-notification" />
                      浏览器 Push
                    </div>
                    <p class="text-xs text-slate-600 leading-5 mt-1 dark:text-slate-300">
                      VAPID 密钥由服务端自动生成并加密保存，无需手动填写。重新生成后，已订阅用户可能需要重新启用 Push。
                    </p>
                  </div>
                  <TxStatusBadge :text="notificationProviderConfigForm.pushConfigured ? '已配置' : '未配置'" :status="notificationProviderConfigForm.pushConfigured ? 'success' : 'warning'" size="sm" />
                </div>
                <div class="mt-4 p-3 rounded-2xl bg-white/75 dark:bg-white/8">
                  <div class="text-xs text-slate-500 fw-900 dark:text-slate-400">
                    Public Key
                  </div>
                  <div class="text-xs leading-5 mt-1 break-all dark:text-slate-200">
                    {{ notificationProviderConfigForm.vapidPublicKey || '生成后自动显示公钥，私钥不会暴露在页面。' }}
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-3 items-center">
                  <TxButton v-if="!notificationProviderConfigForm.pushConfigured" size="sm" variant="primary" :disabled="!isAdmin || notificationProviderConfigForm.generatingVapid" @click="generateVapidKeys(false)">
                    {{ notificationProviderConfigForm.generatingVapid ? '生成中...' : '生成 Push 密钥' }}
                  </TxButton>
                  <TxButton v-else size="sm" variant="secondary" :disabled="!isAdmin || notificationProviderConfigForm.generatingVapid" @click="openVapidRegenerateDialog">
                    {{ notificationProviderConfigForm.generatingVapid ? '重新生成中...' : '重新生成密钥' }}
                  </TxButton>
                </div>
              </div>
              <label class="text-sm flex gap-2 items-center lg:col-span-2">
                <TxCheckbox v-model="notificationProviderConfigForm.feishuMailEnabled" variant="checkmark" :disabled="!isAdmin || notificationProviderConfigForm.loading" aria-label="启用飞书邮件通知" />
                启用飞书邮件通知
              </label>
              <label class="gap-2 grid">
                <span class="field-label">飞书 App ID</span>
                <TxInput v-model="notificationProviderConfigForm.feishuAppId" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="cli_xxxxxx" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">飞书 App Secret</span>
                <TxInput v-model="notificationProviderConfigForm.feishuAppSecret" :disabled="!isAdmin || notificationProviderConfigForm.loading" type="password" :placeholder="notificationProviderConfigForm.feishuAppSecretMasked || '保存到服务端加密配置'" />
              </label>
              <div class="lg:col-span-2">
                <div class="flex flex-wrap gap-3 items-center">
                  <TxButton size="sm" variant="secondary" :disabled="!isAdmin || notificationProviderConfigForm.authorizingFeishu || !notificationProviderConfigForm.feishuAppId" @click="authorizeFeishuProvider">
                    {{ notificationProviderConfigForm.authorizingFeishu ? '跳转中...' : '授权飞书邮箱' }}
                  </TxButton>
                  <span v-if="notificationProviderConfigForm.feishuRefreshTokenMasked" class="text-emerald-700 fw-800 dark:text-emerald-300">已保存飞书邮箱授权</span>
                  <span v-else class="text-amber-700 fw-800 dark:text-amber-300">尚未授权邮箱账号</span>
                </div>
              </div>
              <label class="gap-2 grid">
                <span class="field-label">飞书发信邮箱</span>
                <TxInput v-model="notificationProviderConfigForm.feishuUserMailboxId" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="me 或 notice@example.com" />
                <div v-if="feishuSenderMailboxOptions.length" class="flex flex-wrap gap-2">
                  <TxButton
                    v-for="option in feishuSenderMailboxOptions"
                    :key="option.value"
                    size="sm"
                    variant="secondary"
                    :disabled="!isAdmin || notificationProviderConfigForm.loading"
                    @click="notificationProviderConfigForm.feishuUserMailboxId = option.value"
                  >
                    {{ option.label }}：{{ option.value }}
                  </TxButton>
                </div>
              </label>
              <label class="gap-2 grid">
                <span class="field-label">站点根地址</span>
                <TxInput v-model="notificationProviderConfigForm.feishuSiteBaseUrl" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="https://example.com" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">飞书每日限额</span>
                <TxNumberInput v-model="notificationProviderConfigForm.feishuDailyLimit" :disabled="!isAdmin || notificationProviderConfigForm.loading" :min="1" :max="400" />
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">飞书测试收件邮箱</span>
                <div class="gap-3 grid md:grid-cols-[minmax(0,1fr)_auto]">
                  <TxInput v-model="notificationProviderConfigForm.testEmailAddress" :disabled="!isAdmin || notificationProviderConfigForm.testingEmail" placeholder="user@example.com" />
                  <TxButton variant="secondary" :disabled="!isAdmin || notificationProviderConfigForm.testingEmail || !notificationProviderConfigForm.testEmailAddress" @click="sendFeishuProviderTest">
                    {{ notificationProviderConfigForm.testingEmail ? '发送中...' : '测试飞书邮件' }}
                  </TxButton>
                </div>
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <TxButton variant="primary" :disabled="!isAdmin || notificationProviderConfigForm.loading" @click="saveNotificationProviderConfig">
                {{ notificationProviderConfigForm.loading ? '读取 / 保存中...' : '保存通知配置' }}
              </TxButton>
            </div>
            <div v-if="notificationProviderConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              {{ notificationProviderConfigForm.message }}
            </div>
          </div>

          <div class="mt-5 p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-information" />
              顶部 Banner
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid">
                <span class="field-label">标题</span>
                <TxInput v-model="siteBannerConfigForm.title" :disabled="!isAdmin || siteBannerConfigForm.loading" placeholder="内测公告 / 推广宣传" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">展示样式</span>
                <select v-model="siteBannerConfigForm.tone" class="form-select admin-page-size" :disabled="!isAdmin || siteBannerConfigForm.loading">
                  <option v-for="option in bannerToneOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">内容</span>
                <textarea v-model="siteBannerConfigForm.body" class="form-textarea min-h-24" :disabled="!isAdmin || siteBannerConfigForm.loading" placeholder="当前处于内测阶段，部分资源按批次开放。" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="siteBannerConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || siteBannerConfigForm.loading" aria-label="启用顶部 Banner" />
                启用顶部 Banner
              </label>
              <TxButton variant="primary" :disabled="!isAdmin || siteBannerConfigForm.loading" @click="saveSiteBannerConfig">
                {{ siteBannerConfigForm.loading ? '保存中...' : '保存 Banner' }}
              </TxButton>
            </div>
            <div v-if="siteBannerConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              {{ siteBannerConfigForm.message }}
            </div>
          </div>

          <div class="mt-5 p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-notification-new" />
                  管理员通告
                </div>
                <p class="text-sm text-slate-500 leading-6 mt-1 dark:text-slate-400">
                  面向用户批量发送站内通告，可查看每个用户的已读状态。
                </p>
              </div>
              <TxButton variant="secondary" :disabled="!isAdmin || adminAnnouncementForm.loading" @click="reloadAdminAnnouncements">
                刷新统计
              </TxButton>
            </div>
            <div class="mt-5 gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">通告标题</span>
                <TxInput v-model="adminAnnouncementForm.title" :disabled="!isAdmin || adminAnnouncementForm.loading" placeholder="维护通知 / 资源开放提醒" />
              </label>
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">通告内容</span>
                <textarea v-model="adminAnnouncementForm.body" class="form-textarea min-h-28" :disabled="!isAdmin || adminAnnouncementForm.loading" placeholder="请输入要推送给所有用户的内容。" />
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-4 items-center">
              <label v-for="option in announcementChannelOptions" :key="option.value" class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="adminAnnouncementForm.channels[option.value]" variant="checkmark" :disabled="option.value === 'in_app' || !isAdmin || adminAnnouncementForm.loading" :aria-label="option.label" />
                {{ option.label }}
              </label>
            </div>
            <div class="mt-4 flex flex-wrap gap-4 items-center">
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="adminAnnouncementForm.forcePopup" variant="checkmark" :disabled="!isAdmin || adminAnnouncementForm.loading" aria-label="强制弹窗" />
                强制弹窗
              </label>
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="adminAnnouncementForm.forcePush" variant="checkmark" :disabled="!isAdmin || adminAnnouncementForm.loading" aria-label="强制推送" />
                强制推送
              </label>
              <TxButton variant="primary" :disabled="!isAdmin || adminAnnouncementForm.loading" @click="publishAdminAnnouncement">
                {{ adminAnnouncementForm.loading ? '发送中...' : '发送通告' }}
              </TxButton>
            </div>
            <div v-if="adminAnnouncementForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              {{ adminAnnouncementForm.message }}
            </div>

            <div class="admin-table mt-5">
              <div class="admin-table-row admin-announcement-grid admin-table-head">
                <span>通告</span>
                <span>渠道</span>
                <span>已读</span>
                <span>发送时间</span>
              </div>
              <div v-if="!adminAnnouncements.length" class="admin-empty">
                暂无管理员通告。
              </div>
              <div v-for="announcement in adminAnnouncements" :key="announcement.id" class="admin-table-row admin-announcement-grid">
                <div class="min-w-0">
                  <b class="block truncate">{{ announcement.title }}</b>
                  <span class="text-xs text-slate-500 line-clamp-2 dark:text-slate-400">{{ announcement.body }}</span>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span v-if="announcement.forcePopup" class="admin-pill text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30">强制弹窗</span>
                    <span v-if="announcement.forcePush" class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">强制推送</span>
                  </div>
                  <details class="mt-3">
                    <summary class="text-xs text-slate-500 cursor-pointer dark:text-slate-400">
                      查看用户已读明细
                    </summary>
                    <div class="admin-detail-list mt-2">
                      <div v-for="recipient in announcement.recipients" :key="recipient.notificationId">
                        <span>
                          {{ recipient.displayName }}
                          <small class="text-slate-400">· {{ recipient.email || recipient.userId }}</small>
                        </span>
                        <b :class="recipient.readAt ? 'text-emerald-600' : 'text-amber-600'">
                          {{ recipient.readAt ? `已读 ${formatDate(recipient.readAt)}` : '未读' }}
                        </b>
                      </div>
                    </div>
                  </details>
                </div>
                <span>{{ announcement.channels.map(notificationChannelLabel).join(' / ') }}</span>
                <span>{{ announcement.readCount }} / {{ announcement.totalCount }}</span>
                <span>{{ formatDate(announcement.createdAt) }}</span>
              </div>
            </div>
          </div>

          <div class="mt-5 p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-data-vis-4" />
                  系统日志
                </div>
                <p class="text-sm text-slate-500 leading-6 mt-1 dark:text-slate-400">
                  展示通知发送、通道投递、错误原因和耗时，便于排查发送慢或失败。
                </p>
              </div>
              <TxButton variant="secondary" :disabled="!isAdmin" @click="reloadSystemLogs">
                刷新日志
              </TxButton>
            </div>

            <div class="admin-table mt-5">
              <div class="admin-table-row admin-table-head grid-cols-[110px_130px_minmax(0,1fr)_110px_160px]">
                <span>级别</span>
                <span>模块 / 动作</span>
                <span>消息</span>
                <span>耗时</span>
                <span>时间</span>
              </div>
              <div v-if="!systemLogs.length" class="admin-empty">
                暂无系统日志。
              </div>
              <div v-for="log in systemLogs" :key="log.id" class="admin-table-row grid-cols-[110px_130px_minmax(0,1fr)_110px_160px]">
                <span class="admin-pill" :class="statusPillClass(log.level)">
                  {{ systemLogLevelText(log.level) }}
                </span>
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ log.module }}<br>{{ log.action }}
                </span>
                <div class="min-w-0">
                  <div class="fw-800">
                    {{ log.message }}
                  </div>
                  <details class="mt-2">
                    <summary class="text-xs text-slate-500 cursor-pointer dark:text-slate-400">
                      查看详情
                    </summary>
                    <pre class="text-xs mt-2 p-3 rounded-xl bg-slate-100 overflow-auto dark:bg-black/20">{{ systemLogDetailsText(log.details) }}</pre>
                  </details>
                </div>
                <span>{{ log.durationMs === undefined ? '-' : `${log.durationMs} ms` }}</span>
                <span>{{ formatDate(log.createdAt) }}</span>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.ldc" icon-class="i-carbon-wallet">
          <template #name>
            充值配置
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-wallet" />
              LINUX DO Credit 充值
            </div>
            <div class="text-sm mb-5 p-3 rounded-2xl" :class="rechargeConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
              {{ rechargeConfigForm.configured ? '商户配置已保存，充值可用。' : '尚未配置 PID / KEY，请在此保存。' }}
            </div>
            <div class="gap-5 grid lg:grid-cols-2">
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">网关地址</span>
                <TxInput v-model="rechargeConfigForm.gatewayBaseUrl" :disabled="!isAdmin || rechargeConfigForm.loading" placeholder="https://credit.linux.do/epay" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">商户 PID / 客户端 ID</span>
                <TxInput v-model="rechargeConfigForm.pid" :disabled="!isAdmin || rechargeConfigForm.loading" placeholder="LINUX DO Credit PID" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">商户 KEY / 客户端密钥</span>
                <TxInput v-model="rechargeConfigForm.key" :disabled="!isAdmin || rechargeConfigForm.loading" type="password" :placeholder="rechargeConfigForm.keyMasked || '保存到服务端配置'" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">LDC 兑换积分倍率</span>
                <TxInput v-model="rechargeConfigForm.pointsPerLdc" type="number" :disabled="!isAdmin || rechargeConfigForm.loading" placeholder="10" />
                <span class="field-hint">默认 1 LDC = 10 积分；充值订单按 LDC 支付，到账按该倍率换算。</span>
              </label>
            </div>
            <div class="mt-5 flex flex-wrap gap-3 items-center">
              <label class="text-sm flex gap-2 items-center">
                <TxCheckbox v-model="rechargeConfigForm.enabled" variant="checkmark" :disabled="!isAdmin || rechargeConfigForm.loading" aria-label="启用 LINUX DO Credit 充值" />
                启用 LINUX DO Credit 充值
              </label>
              <TxButton variant="primary" :disabled="!isAdmin || rechargeConfigForm.loading" @click="saveRechargeConfig">
                {{ rechargeConfigForm.loading ? '读取 / 保存中...' : '保存充值配置' }}
              </TxButton>
            </div>
            <div v-if="rechargeConfigForm.message" class="text-xs leading-5 mt-5 p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
              <div>{{ rechargeConfigForm.message }}</div>
              <pre v-if="rechargeConfigForm.envPreview" class="mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(rechargeConfigForm.envPreview, null, 2) }}</pre>
            </div>
            <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
              回调地址自动使用当前站点：/api/recharge/notify；回跳地址：/api/recharge/return。充值到账以异步通知验签为准。
              <br>
              当前倍率：1 LDC = {{ rechargeConfigForm.pointsPerLdc }} 积分。
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.users" icon-class="i-carbon-user-multiple">
          <template #name>
            用户管理
          </template>

          <div class="space-y-5">
            <div class="gap-5 grid xl:grid-cols-2">
              <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div>
                    <div class="text-lg fw-900 flex gap-2 items-center">
                      <span class="i-carbon-user-certification" />
                      协作处理员申请
                    </div>
                    <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                      审核通过后，用户将获得协作任务认领权限。
                    </p>
                  </div>
                  <span class="admin-pill" :class="statusPillClass('pending')">
                    {{ pendingCollaborationApplications.length }} 待审
                  </span>
                </div>
                <div class="mt-4 space-y-4">
                  <div v-if="!pendingCollaborationApplications.length" class="admin-empty">
                    暂无协作处理员申请
                  </div>
                  <div v-for="item in pendingCollaborationApplications" :key="item.id" class="admin-review-card">
                    <div class="flex flex-wrap gap-3 items-start justify-between">
                      <div>
                        <div class="fw-900">
                          {{ userDisplayName(item.userId) }}
                        </div>
                        <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                          {{ formatDate(item.createdAt) }} 提交
                        </div>
                      </div>
                      <span class="admin-pill" :class="statusPillClass(item.status)">
                        待审核
                      </span>
                    </div>
                    <RichTextView :content="item.reason" class="rich-text-preview mt-3" />
                    <RichTextEditor v-model="collaborationReviewDraftFor(item.id).reply" :min-height="110" class="mt-3" placeholder="管理员回复，可说明通过原因或退回建议" />
                    <div class="mt-3 flex flex-wrap gap-3 justify-end">
                      <TxButton size="sm" variant="secondary" @click="onReviewCollaborationApplication(item.id, 'rejected')">
                        退回
                      </TxButton>
                      <TxButton size="sm" variant="primary" @click="onReviewCollaborationApplication(item.id, 'approved')">
                        通过并授权
                      </TxButton>
                    </div>
                  </div>
                </div>
              </div>

              <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div>
                    <div class="text-lg fw-900 flex gap-2 items-center">
                      <span class="i-carbon-review" />
                      协作交付复核
                    </div>
                    <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                      复核通过时填写奖励积分，系统会写入积分流水并标记申请完成。
                    </p>
                  </div>
                  <span class="admin-pill" :class="statusPillClass('pending')">
                    {{ pendingDeliveryReviewApplications.length }} 待复核
                  </span>
                </div>
                <div class="mt-4 space-y-4">
                  <div v-if="!pendingDeliveryReviewApplications.length" class="admin-empty">
                    暂无待复核交付
                  </div>
                  <div v-for="item in pendingDeliveryReviewApplications" :key="item.id" class="admin-review-card">
                    <div class="flex flex-wrap gap-3 items-start justify-between">
                      <div class="min-w-0">
                        <div class="fw-900 truncate">
                          {{ item.title }}
                        </div>
                        <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                          {{ item.type.toUpperCase() }} · 协作处理员 {{ userDisplayName(item.deliveryAssigneeId || '') }} · {{ formatDate(item.deliverySubmittedAt) }}
                        </div>
                      </div>
                      <span class="admin-pill" :class="statusPillClass(item.deliveryReviewStatus || 'pending')">
                        待复核
                      </span>
                    </div>
                    <div v-for="message in (item.messages ?? []).filter(message => message.type === 'result_submission').slice(-1)" :key="message.id" class="mt-3">
                      <RichTextView :content="message.content" class="rich-text-preview" />
                    </div>
                    <div class="mt-3 gap-3 grid md:grid-cols-[150px_1fr]">
                      <label class="gap-2 grid">
                        <span class="field-label">奖励积分</span>
                        <TxInput v-model="deliveryReviewDraftFor(item.id).rewardPoints" type="number" placeholder="100" />
                      </label>
                      <label class="gap-2 grid">
                        <span class="field-label">复核说明</span>
                        <RichTextEditor v-model="deliveryReviewDraftFor(item.id).note" :min-height="100" placeholder="通过或退回原因，会写入申请沟通记录" />
                      </label>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-3 justify-end">
                      <TxButton size="sm" variant="secondary" @click="onReviewDeliveryResult(item.id, false)">
                        复核不通过
                      </TxButton>
                      <TxButton size="sm" variant="primary" @click="onReviewDeliveryResult(item.id, true)">
                        通过并发奖
                      </TxButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div>
                  <div class="text-lg fw-900 flex gap-2 items-center">
                    <span class="i-carbon-user-multiple" />
                    用户管理
                  </div>
                  <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                    汇总管理员与普通用户的账户、余额、认证和业务参与情况。
                  </p>
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ userPagination.total }} / {{ state.users.length }} 人
                </span>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="userFilters.query" placeholder="名称 / 邮箱 / GitHub / 等级" />
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">开始日期</span>
                  <input v-model="userFilters.from" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">结束日期</span>
                  <input v-model="userFilters.to" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">角色</span>
                  <select v-model="userFilters.role" class="form-select">
                    <option v-for="option in userRoleFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">认证</span>
                  <select v-model="userFilters.verification" class="form-select">
                    <option v-for="option in userVerificationFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <TxButton size="sm" variant="secondary" @click="resetUserFilters">
                  重置
                </TxButton>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-table-head admin-users-grid">
                  <span>用户</span>
                  <span>角色</span>
                  <span>等级</span>
                  <span>认证</span>
                  <span>业务</span>
                  <span>积分</span>
                  <span>最近登录</span>
                  <span>Actions</span>
                </div>
                <div v-if="!userRows.length" class="admin-empty">
                  暂无用户数据
                </div>
                <div
                  v-for="row in userPagination.rows"
                  :key="row.user.id"
                  class="admin-table-row admin-users-grid"
                >
                  <div class="min-w-0">
                    <div class="flex gap-2 min-w-0 items-center">
                      <span class="fw-800 truncate">{{ row.user.profile.displayName }}</span>
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ row.user.profile.email }}
                    </div>
                    <div v-if="row.user.profile.githubUsername" class="text-xs text-slate-500 truncate dark:text-slate-400">
                      @{{ row.user.profile.githubUsername }}
                    </div>
                  </div>
                  <div class="space-y-2">
                    <span class="admin-pill" :class="roleToneClass(row.user.role)">
                      {{ roleText(row.user.role) }}
                    </span>
                    <label v-if="row.user.role !== 'admin'" class="text-xs text-slate-500 flex gap-2 items-center dark:text-slate-400" @click.stop>
                      <TxCheckbox :model-value="row.user.role === 'reviewer'" variant="checkmark" :disabled="!isAdmin" aria-label="协作处理员" @change="value => onToggleReviewer(row.user.id, value)" />
                      协作处理员
                    </label>
                  </div>
                  <div class="text-xs text-slate-600 leading-5 dark:text-slate-300">
                    <span class="admin-pill" :class="levelToneClass(row.level.tone)">
                      {{ row.level.name }}
                    </span>
                    <div class="mt-1">
                      {{ row.level.score }}/{{ row.level.maxScore }} · 优先级 {{ row.level.priority }}
                    </div>
                    <div class="text-slate-500 dark:text-slate-400">
                      {{ row.level.reasons.slice(0, 3).join(' / ') }}
                    </div>
                  </div>
                  <div class="text-xs text-slate-600 leading-5 dark:text-slate-300">
                    <div>{{ row.user.profile.studentVerified ? '学生已认证' : '学生未认证' }}</div>
                    <div>{{ row.user.profile.githubAuthorized ? 'GitHub 已授权' : 'GitHub 未授权' }}</div>
                  </div>
                  <div class="text-xs text-slate-600 leading-5 dark:text-slate-300">
                    <div>申请 {{ row.applications }}</div>
                    <div>认证 {{ row.studentVerifications }} / 流水 {{ row.transactions }}</div>
                    <div>流水线消耗 {{ formatPoints(row.pipelineSpend) }}</div>
                  </div>
                  <div class="text-sm">
                    <div class="fw-900">
                      {{ formatPoints(row.user.points) }}
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      总消耗 {{ formatPoints(row.totalSpend) }}
                    </div>
                  </div>
                  <div class="text-xs text-slate-500 leading-5 dark:text-slate-400">
                    <div>{{ formatDate(row.user.lastLoginAt) }}</div>
                    <div>最近 {{ formatDate(row.latestActivityAt) }}</div>
                  </div>
                  <div class="admin-user-actions">
                    <TxButton size="sm" variant="secondary" @click="openUserDrawer(row.user.id, 'detail')">
                      编辑
                    </TxButton>
                    <TxButton size="sm" variant="secondary" @click="openUserDrawer(row.user.id, 'points')">
                      积分
                    </TxButton>
                    <TxButton size="sm" variant="secondary" @click="openUserAudit(row.user.id)">
                      审计
                    </TxButton>
                  </div>
                </div>
              </div>

              <div class="admin-pagination">
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  第 {{ userPagination.start }}-{{ userPagination.end }} 条 / 共 {{ userPagination.total }} 条
                </div>
                <div class="admin-pagination-controls">
                  <select v-model="userFilters.pageSize" class="form-select admin-page-size">
                    <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                      {{ size }} / 页
                    </option>
                  </select>
                  <TxButton size="sm" variant="secondary" :disabled="userPagination.page <= 1" @click="previousPage(userFilters)">
                    上一页
                  </TxButton>
                  <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                    {{ userPagination.page }} / {{ userPagination.totalPages }}
                  </span>
                  <TxButton size="sm" variant="secondary" :disabled="userPagination.page >= userPagination.totalPages" @click="nextPage(userFilters, userPagination.totalPages)">
                    下一页
                  </TxButton>
                </div>
              </div>
            </div>

            <TxDrawer
              v-model:visible="isUserDrawerOpen"
              class="admin-user-drawer-host"
              direction="right"
              size="min(1120px, 92vw)"
              title="编辑用户"
              :z-index="USER_DRAWER_Z_INDEX"
              mask-effect="blur"
              @close="closeUserDrawer"
            >
              <template v-if="selectedUserDetail" #header>
                <div class="admin-drawer-header">
                  <div class="min-w-0">
                    <div id="admin-user-drawer-title" class="text-lg fw-900 flex gap-2 items-center">
                      <span class="i-carbon-user-profile" />
                      {{ selectedUserDetail.user.profile.displayName }}
                    </div>
                    <div class="text-sm text-slate-500 leading-6 mt-2 break-all dark:text-slate-400">
                      {{ selectedUserDetail.user.profile.email }} · ID {{ selectedUserDetail.user.id }}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2 items-center">
                    <span class="admin-pill" :class="roleToneClass(selectedUserDetail.user.role)">
                      {{ roleText(selectedUserDetail.user.role) }}
                    </span>
                    <span class="admin-pill" :class="accountStatusToneClass(selectedUserDetail.user.accountStatus)">
                      {{ accountStatusText(selectedUserDetail.user.accountStatus) }}
                    </span>
                    <span class="admin-pill" :class="levelToneClass(selectedUserDetail.level.tone)">
                      {{ selectedUserDetail.level.name }}
                    </span>
                    <TxButton size="sm" variant="secondary" aria-label="关闭用户详情" @click="closeUserDrawer">
                      关闭
                    </TxButton>
                  </div>
                </div>
              </template>

              <template v-if="selectedUserDetail">
                <div class="admin-user-drawer-content">
                  <div class="admin-user-stat-grid">
                    <div v-for="item in selectedUserStatCards" :key="item.label" class="admin-metric">
                      <div class="flex gap-3 items-center justify-between">
                        <span class="text-sm text-slate-500 fw-800 dark:text-slate-400">{{ item.label }}</span>
                        <span class="text-xl" :class="item.icon" />
                      </div>
                      <div class="text-xl fw-900 mt-3">
                        {{ item.value }}
                      </div>
                      <div class="text-xs text-slate-500 leading-5 mt-2 dark:text-slate-400">
                        {{ item.note }}
                      </div>
                    </div>
                  </div>

                  <TxTabs
                    v-model="activeUserDrawerTab"
                    class="admin-user-drawer-tabs"
                    :default-value="activeUserDrawerTab"
                    placement="top"
                    indicator-variant="line"
                    indicator-motion="glide"
                    :content-padding="0"
                    :content-scrollable="false"
                    auto-height
                    borderless
                  >
                    <TxTabItem :name="USER_DRAWER_TABS.account" icon-class="i-carbon-identification">
                      <template #name>
                        账号
                      </template>

                      <section class="admin-detail-section">
                        <div class="admin-detail-title">
                          <span class="i-carbon-identification" />
                          账号信息
                        </div>
                        <div class="admin-detail-list mt-4">
                          <div>
                            <span>账号状态</span>
                            <b>{{ accountStatusText(selectedUserDetail.user.accountStatus) }}</b>
                          </div>
                          <div v-if="selectedUserDetail.user.accountStatus === 'suspended'">
                            <span>封禁原因</span>
                            <b>{{ selectedUserDetail.user.suspendedReason || '违反平台使用政策' }}</b>
                          </div>
                          <div v-if="selectedUserDetail.user.accountStatus === 'suspended'">
                            <span>封禁时间</span>
                            <b>{{ formatOptionalDate(selectedUserDetail.user.suspendedAt) }}</b>
                          </div>
                          <div>
                            <span>创建时间</span>
                            <b>{{ formatDate(selectedUserDetail.user.createdAt) }}</b>
                          </div>
                          <div>
                            <span>最近登录</span>
                            <b>{{ formatDate(selectedUserDetail.user.lastLoginAt) }}</b>
                          </div>
                          <div>
                            <span>GitHub 用户</span>
                            <b>{{ selectedUserDetail.user.profile.githubUsername || '未绑定' }}</b>
                          </div>
                          <div>
                            <span>GitHub 授权时间</span>
                            <b>{{ formatOptionalDate(selectedUserDetail.user.profile.githubAuthorizedAt) }}</b>
                          </div>
                          <div>
                            <span>默认仓库</span>
                            <b>{{ selectedUserDetail.user.profile.selectedRepo || '未选择' }}</b>
                          </div>
                          <div>
                            <span>公开仓库数量</span>
                            <b>{{ selectedUserDetail.user.profile.githubRepos?.length ?? 0 }}</b>
                          </div>
                          <div>
                            <span>邀请码</span>
                            <b>{{ selectedUserDetail.user.profile.inviteCode || '未生成' }}</b>
                          </div>
                          <div>
                            <span>邀请人</span>
                            <b>{{ selectedUserDetail.invitationInviter?.profile.displayName || '未绑定' }}</b>
                          </div>
                          <div>
                            <span>邀请绑定</span>
                            <b>{{ selectedUserDetail.inviteeBindings.length }} 个邀请 / {{ selectedUserDetail.inviteeBindings.filter(item => item.inviterVouchedAt || item.inviteeVouchedAt).length }} 个担保</b>
                          </div>
                        </div>
                        <div class="mt-4 flex flex-wrap gap-3 items-center">
                          <label v-if="selectedUserDetail.user.role !== 'admin'" class="admin-action-check">
                            <TxCheckbox :model-value="selectedUserDetail.user.role === 'reviewer'" variant="checkmark" :disabled="!isAdmin" aria-label="协作处理员权限" @change="value => selectedUserDetail && onToggleReviewer(selectedUserDetail.user.id, value)" />
                            协作处理员权限
                          </label>
                          <TxButton size="sm" variant="danger" :disabled="!isAdmin || !selectedUserDetail.user.profile.githubAuthorized" @click="onUnbindGitHub(selectedUserDetail.user.id)">
                            {{ pendingAdminUserAction === userActionKey(selectedUserDetail.user.id, 'unbind-github') ? '确认解绑' : '解绑 GitHub' }}
                          </TxButton>
                          <TxButton
                            v-if="selectedUserDetail.user.role !== 'admin'"
                            size="sm"
                            :variant="selectedUserDetail.user.accountStatus === 'suspended' ? 'secondary' : 'danger'"
                            :disabled="!isAdmin"
                            @click="onToggleUserSuspended(selectedUserDetail.user.id, selectedUserDetail.user.accountStatus !== 'suspended')"
                          >
                            {{
                              pendingAdminUserAction === userActionKey(
                                selectedUserDetail.user.id,
                                selectedUserDetail.user.accountStatus === 'suspended' ? 'restore-user' : 'suspend-user',
                              )
                                ? '确认执行'
                                : selectedUserDetail.user.accountStatus === 'suspended' ? '解除封禁' : '封禁用户'
                            }}
                          </TxButton>
                        </div>
                      </section>
                    </TxTabItem>

                    <TxTabItem :name="USER_DRAWER_TABS.verification" icon-class="i-carbon-user-certification">
                      <template #name>
                        认证
                      </template>

                      <div class="admin-user-account-grid">
                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-user-certification" />
                            学生认证
                          </div>
                          <div class="admin-detail-list mt-4">
                            <div>
                              <span>当前状态</span>
                              <b>{{ selectedUserDetail.user.profile.studentVerified ? '学生已认证' : '学生未认证' }}</b>
                            </div>
                            <div>
                              <span>已通过记录</span>
                              <b>{{ selectedUserApprovedStudentVerification ? selectedUserApprovedStudentVerification.category : '无' }}</b>
                            </div>
                            <div v-if="selectedUserApprovedStudentVerification">
                              <span>{{ verificationOrganizationLabel(selectedUserApprovedStudentVerification.verificationType) }}</span>
                              <b>{{ selectedUserApprovedStudentVerification.school || '-' }}</b>
                            </div>
                            <div v-if="selectedUserApprovedStudentVerification">
                              <span>审核时间</span>
                              <b>{{ formatOptionalDate(selectedUserApprovedStudentVerification.reviewedAt) }}</b>
                            </div>
                          </div>

                          <div v-if="selectedUserDetail.user.profile.studentVerified && selectedUserApprovedStudentVerification" class="mt-4 gap-3 grid">
                            <div class="field-label">
                              撤销原因
                            </div>
                            <RichTextEditor v-model="revokeStudentReason" :min-height="130" placeholder="填写撤销学生认证的原因，会保存到该认证记录的审核回复中。" />
                            <TxButton
                              size="sm"
                              variant="danger"
                              :disabled="!isAdmin"
                              @click="onRevokeStudentVerification(selectedUserDetail.user.id)"
                            >
                              {{ pendingAdminUserAction === userActionKey(selectedUserDetail.user.id, 'revoke-student') ? '确认撤销认证' : '撤销认证' }}
                            </TxButton>
                          </div>

                          <div v-else class="mt-4 gap-4 grid">
                            <div class="flex flex-wrap gap-3 items-center justify-between">
                              <p class="text-xs text-slate-500 leading-5 dark:text-slate-400">
                                标记学生认证会新添加一条待审核认证记录，管理员可补充说明和上传材料。
                              </p>
                              <TxButton
                                size="sm"
                                variant="secondary"
                                :disabled="!isAdmin || selectedUserDetail.user.profile.studentVerified"
                                @click="openUserStudentVerificationCreate(selectedUserDetail.user.id)"
                              >
                                {{ isUserStudentVerificationCreateOpen ? '正在新添加认证' : '新添加认证' }}
                              </TxButton>
                            </div>

                            <div v-if="isUserStudentVerificationCreateOpen" class="p-4 border border-blue-500/15 rounded-3xl bg-blue-50/60 gap-4 grid dark:border-blue-300/15 dark:bg-blue-950/20">
                              <div class="admin-filter-bar">
                                <label class="admin-filter-field">
                                  <span class="field-label">真实姓名</span>
                                  <TxInput v-model="adminStudentVerificationForm.realName" placeholder="用于人工复核" />
                                </label>
                                <label class="admin-filter-field">
                                  <span class="field-label">认证类目</span>
                                  <TxInput v-model="adminStudentVerificationForm.category" placeholder="大学生 / 研究生等" />
                                </label>
                                <label class="admin-filter-field">
                                  <span class="field-label">学校</span>
                                  <TxInput v-model="adminStudentVerificationForm.school" placeholder="学校名称" />
                                </label>
                                <label class="admin-filter-field">
                                  <span class="field-label">年级</span>
                                  <TxInput v-model="adminStudentVerificationForm.grade" placeholder="2026 级" />
                                </label>
                                <label class="admin-filter-field">
                                  <span class="field-label">学历/身份</span>
                                  <TxInput v-model="adminStudentVerificationForm.educationLevel" placeholder="本科 / 研究生等" />
                                </label>
                                <label class="admin-filter-field admin-filter-field--wide">
                                  <span class="field-label">教育邮箱</span>
                                  <TxInput v-model="adminStudentVerificationForm.educationEmail" type="email" placeholder="可选；填写后可标记管理员已核验" />
                                </label>
                                <label class="admin-filter-field">
                                  <span class="field-label">邮箱核验</span>
                                  <span class="text-sm flex gap-2 min-h-11 items-center">
                                    <TxCheckbox v-model="adminStudentVerificationForm.educationEmailVerified" variant="checkmark" aria-label="管理员已核验教育邮箱" />
                                    管理员已核验
                                  </span>
                                </label>
                              </div>

                              <label class="gap-2 grid">
                                <span class="field-label">材料说明</span>
                                <RichTextEditor v-model="adminStudentVerificationForm.notes" :min-height="160" placeholder="说明身份背景、材料清单和管理员新添加认证原因" />
                              </label>
                              <div class="gap-2 grid">
                                <div class="flex flex-wrap gap-2 items-center justify-between">
                                  <span class="field-label">证明材料</span>
                                  <span class="field-hint">{{ formatBytes(totalAdminStudentVerificationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
                                </div>
                                <FileUploader v-model="adminStudentVerificationFiles" :max="12" button-text="上传材料" drop-text="拖拽证明材料" hint-text="支持任意材料，总大小 200MB 内" />
                              </div>
                              <div class="flex flex-wrap gap-3 items-center justify-between">
                                <p class="text-xs text-slate-500 dark:text-slate-400">
                                  {{ adminStudentVerificationForm.message || '提交后记录会进入认证历史，等待管理员审核。' }}
                                </p>
                                <div class="flex flex-wrap gap-2">
                                  <TxButton size="sm" variant="ghost" :disabled="adminStudentVerificationForm.submitting" @click="isUserStudentVerificationCreateOpen = false">
                                    取消
                                  </TxButton>
                                  <TxButton size="sm" variant="primary" :disabled="adminStudentVerificationForm.submitting" @click="onSubmitUserStudentVerificationCreate">
                                    {{ adminStudentVerificationForm.submitting ? '提交中...' : '提交新认证' }}
                                  </TxButton>
                                </div>
                              </div>
                            </div>
                          </div>
                        </section>

                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-education" />
                            认证历史
                          </div>
                          <div class="mt-4 space-y-3">
                            <div v-if="!selectedUserRecentStudents.length" class="admin-empty">
                              暂无认证历史
                            </div>
                            <button
                              v-for="item in selectedUserRecentStudents"
                              :key="item.id"
                              type="button"
                              class="admin-history-row admin-history-row--button"
                              @click="openStudentVerificationDialog(item.id, $event)"
                            >
                              <span class="admin-pill" :class="statusPillClass(item.status)">{{ studentStatusLabel(item.status) }}</span>
                              <div class="text-left flex-1 min-w-0">
                                <div class="fw-900 truncate">
                                  {{ verificationTypeLabel(item.verificationType) }} · {{ item.category }}
                                </div>
                                <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                  {{ [item.school, item.grade, item.educationLevel].filter(Boolean).join(' · ') || '未填写学校信息' }}
                                </div>
                              </div>
                              <span class="text-xs text-slate-500 whitespace-nowrap dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                            </button>
                          </div>
                        </section>
                      </div>
                    </TxTabItem>

                    <TxTabItem :name="USER_DRAWER_TABS.wallet" icon-class="i-carbon-wallet">
                      <template #name>
                        积分权益
                      </template>

                      <div class="admin-user-account-grid">
                        <section class="admin-detail-section admin-points-editor" :class="{ 'is-highlighted': userDrawerMode === 'points' }">
                          <div class="flex flex-wrap gap-3 items-start justify-between">
                            <div>
                              <div class="admin-detail-title">
                                <span class="i-carbon-wallet" />
                                积分管理
                              </div>
                              <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                                为当前用户直接增加或扣减积分，正数入账，负数扣减。
                              </p>
                            </div>
                            <span class="admin-pill text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30">
                              当前 {{ formatPoints(selectedUserDetail.user.points) }}
                            </span>
                          </div>
                          <div class="admin-points-editor-grid mt-4">
                            <label class="gap-2 grid">
                              <span class="field-label">调整积分</span>
                              <TxInput v-model="pointDrafts[selectedUserDetail.user.id]" type="number" :disabled="!isAdmin" placeholder="+/-" />
                              <span class="field-hint">示例：100 增加积分，-50 扣减积分。</span>
                            </label>
                            <TxButton variant="primary" :disabled="!isAdmin" @click="onAdjustPoints(selectedUserDetail.user.id)">
                              应用调整
                            </TxButton>
                          </div>
                        </section>

                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-flow" />
                            流水线消耗
                          </div>
                          <div class="admin-consumption-bars mt-4">
                            <div v-for="item in selectedUserDetail.applicationCounts" :key="item.type" class="admin-consumption-bar">
                              <div class="flex gap-3 items-center justify-between">
                                <span>{{ item.label }}</span>
                                <b>{{ item.count }} 次 / {{ formatPoints(item.spend) }}</b>
                              </div>
                              <div class="admin-bar-track">
                                <span :style="{ width: `${selectedUserDetail.stats.pipelineSpend ? Math.round((item.spend / selectedUserDetail.stats.pipelineSpend) * 100) : 0}%` }" />
                              </div>
                            </div>
                          </div>
                          <div class="admin-detail-list mt-4">
                            <div>
                              <span>申请消耗</span>
                              <b>{{ formatPoints(selectedUserDetail.stats.pipelineSpend) }}</b>
                            </div>
                            <div>
                              <span>学生认证消耗</span>
                              <b>{{ formatPoints(selectedUserDetail.stats.studentSpend) }}</b>
                            </div>
                            <div>
                              <span>退回申请</span>
                              <b>{{ selectedUserDetail.stats.rejectedApplications }} 次</b>
                            </div>
                          </div>
                        </section>
                      </div>

                      <section class="admin-detail-section mt-5">
                        <div class="flex flex-wrap gap-3 items-start justify-between">
                          <div>
                            <div class="admin-detail-title">
                              <span class="i-carbon-percentage" />
                              优惠券管理
                            </div>
                            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                              创建券种、生成兑换码和统一发放请前往独立优惠券中心。
                            </p>
                          </div>
                          <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                            共 {{ selectedUserDetail.coupons.length }} 张
                          </span>
                        </div>
                        <div class="mt-4 p-4 rounded-2xl bg-slate-50 flex flex-wrap gap-3 items-center justify-between dark:bg-white/5">
                          <span class="text-sm text-slate-600 dark:text-slate-300">当前只展示最近发放和使用状态。</span>
                          <RouterLink class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30" to="/dashboard/coupons">
                            打开优惠券中心
                          </RouterLink>
                        </div>
                        <div class="mt-5 space-y-3">
                          <div v-if="!selectedUserRecentCoupons.length" class="admin-empty">
                            暂无优惠券记录
                          </div>
                          <div v-for="coupon in selectedUserRecentCoupons" :key="coupon.id" class="admin-history-row">
                            <span class="admin-pill" :class="statusPillClass(couponStatusTone(coupon))">
                              {{ couponStatusText(coupon) }}
                            </span>
                            <div class="flex-1 min-w-0">
                              <div class="fw-900 truncate">
                                {{ coupon.name }} · {{ couponDiscountText(coupon.discountRate) }}
                              </div>
                              <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                {{ couponSourceText(coupon.source) }} · {{ coupon.expiresAt ? `有效至 ${formatDate(coupon.expiresAt)}` : '长期有效' }}
                              </div>
                            </div>
                            <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(coupon.createdAt) }}</span>
                          </div>
                        </div>
                      </section>
                    </TxTabItem>

                    <TxTabItem :name="USER_DRAWER_TABS.records" icon-class="i-carbon-list">
                      <template #name>
                        使用记录
                      </template>

                      <section class="admin-detail-section">
                        <div class="admin-detail-title">
                          <span class="i-carbon-list" />
                          使用记录
                        </div>
                        <div class="mt-4 space-y-3">
                          <div v-if="!selectedUserDetail.latestRecords.length" class="admin-empty">
                            暂无使用记录
                          </div>
                          <div v-for="item in selectedUserDetail.latestRecords.slice(0, USER_DETAIL_LIMIT)" :key="item.id" class="admin-history-row">
                            <span class="admin-pill" :class="statusPillClass(item.tone)">{{ item.kind }}</span>
                            <div class="flex-1 min-w-0">
                              <div class="fw-900 truncate">
                                {{ item.title }}
                              </div>
                              <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                {{ item.detail }}
                              </div>
                            </div>
                            <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.time) }}</span>
                          </div>
                        </div>
                      </section>

                      <div class="admin-user-history-grid mt-5">
                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-document-attachment" />
                            申请历史
                          </div>
                          <div class="mt-4 space-y-3">
                            <div v-if="!selectedUserRecentApplications.length" class="admin-empty">
                              暂无申请历史
                            </div>
                            <div v-for="item in selectedUserRecentApplications" :key="item.id" class="admin-history-row">
                              <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">{{ applicationTypeLabel(item.type) }}</span>
                              <div class="flex-1 min-w-0">
                                <div class="fw-900 truncate">
                                  {{ item.title }}
                                </div>
                                <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                  {{ item.githubRepo || '未绑定仓库' }} · {{ formatPoints(item.cost) }}
                                </div>
                              </div>
                              <span class="admin-pill" :class="statusPillClass(item.status)">{{ applicationStatusLabel(item.status) }}</span>
                            </div>
                          </div>
                        </section>

                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-chart-line-data" />
                            消耗历史
                          </div>
                          <div class="mt-4 space-y-3">
                            <div v-if="!selectedUserConsumptionRows.length" class="admin-empty">
                              暂无消耗历史
                            </div>
                            <div v-for="item in selectedUserConsumptionRows" :key="item.transaction.id" class="admin-history-row">
                              <span class="text-amber-700 fw-900 dark:text-amber-200">{{ signedPoints(item.transaction.delta) }}</span>
                              <div class="flex-1 min-w-0">
                                <div class="fw-900 truncate">
                                  {{ item.transaction.reason }}
                                </div>
                                <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                  {{ item.linkedTitle }}
                                </div>
                              </div>
                              <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.transaction.createdAt) }}</span>
                            </div>
                          </div>
                        </section>

                        <section class="admin-detail-section">
                          <div class="admin-detail-title">
                            <span class="i-carbon-wallet" />
                            积分流水
                          </div>
                          <div class="mt-4 space-y-3">
                            <div v-if="!selectedUserRecentTransactions.length" class="admin-empty">
                              暂无积分流水
                            </div>
                            <div v-for="item in selectedUserRecentTransactions" :key="item.id" class="admin-history-row">
                              <span class="admin-pill" :class="statusPillClass(item.delta < 0 ? 'warning' : 'success')">
                                {{ transactionTypeLabel(item.type) }}
                              </span>
                              <div class="flex-1 min-w-0">
                                <div class="fw-900" :class="item.delta < 0 ? 'text-amber-700 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-200'">
                                  {{ signedPoints(item.delta) }}
                                </div>
                                <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                                  {{ item.reason }}
                                </div>
                              </div>
                              <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                            </div>
                          </div>
                        </section>
                      </div>
                    </TxTabItem>
                  </TxTabs>
                </div>
              </template>
            </TxDrawer>

            <Teleport to="body">
              <TxFlipOverlay
                v-if="selectedStudentVerification"
                v-model="isStudentVerificationDialogOpen"
                :source="studentVerificationDialogSource"
                :header="false"
                :mask-closable="true"
                :scrollable="true"
                mask-class="admin-verification-flip-mask"
                card-class="application-detail-flip-dialog admin-verification-flip-dialog"
                close-aria-label="关闭认证详情"
                surface="pure"
                @closed="handleStudentVerificationDialogClosed"
              >
                <section class="admin-verification-dialog">
                  <div class="admin-verification-dialog__header flex flex-wrap gap-4 items-start justify-between">
                    <div class="min-w-0">
                      <div class="flex flex-wrap gap-2 items-center">
                        <span class="verification-card__icon" :class="selectedStudentVerification.verificationType === 'frontline' ? 'i-carbon-campsite' : 'i-carbon-education'" />
                        <div class="min-w-0">
                          <h3 class="text-2xl fw-900 truncate">
                            {{ selectedStudentVerification.realName }} · {{ verificationTypeLabel(selectedStudentVerification.verificationType) }}
                          </h3>
                          <p class="text-sm text-slate-500 mt-1 dark:text-slate-400">
                            {{ selectedStudentVerification.category }} · {{ verificationOrganizationLabel(selectedStudentVerification.verificationType) }}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-2 items-center justify-end">
                      <span class="admin-pill" :class="statusPillClass(selectedStudentVerification.status)">
                        {{ studentStatusLabel(selectedStudentVerification.status) }}
                      </span>
                      <span class="admin-pill" :class="selectedStudentVerification.feeReturned ? statusPillClass('success') : statusPillClass('warning')">
                        {{ selectedStudentVerification.feeReturned ? '审核费已返还' : `审核费 ${formatPoints(selectedStudentVerification.reviewFee)}` }}
                      </span>
                      <TxButton size="sm" variant="ghost" @click="closeStudentVerificationDialog">
                        关闭
                      </TxButton>
                    </div>
                  </div>

                  <div class="gap-3 grid md:grid-cols-4">
                    <div class="application-detail-stat">
                      <span>提交时间</span>
                      <b>{{ formatDate(selectedStudentVerification.createdAt) }}</b>
                    </div>
                    <div class="application-detail-stat">
                      <span>审核时间</span>
                      <b>{{ formatOptionalDate(selectedStudentVerification.reviewedAt) }}</b>
                    </div>
                    <div class="application-detail-stat">
                      <span>附件</span>
                      <b>{{ selectedStudentVerification.attachments.length }} 个材料</b>
                    </div>
                    <div class="application-detail-stat">
                      <span>认证编号</span>
                      <b>{{ selectedStudentVerification.id }}</b>
                    </div>
                  </div>

                  <div class="gap-4 grid lg:grid-cols-[1fr_1fr]">
                    <section class="verification-detail-section">
                      <h3>认证信息</h3>
                      <dl class="verification-detail-list">
                        <div>
                          <dt>真实姓名</dt>
                          <dd>{{ selectedStudentVerification.realName || '-' }}</dd>
                        </div>
                        <div>
                          <dt>{{ verificationOrganizationLabel(selectedStudentVerification.verificationType) }}</dt>
                          <dd>{{ selectedStudentVerification.school || '-' }}</dd>
                        </div>
                        <div>
                          <dt>{{ selectedStudentVerification.verificationType === 'frontline' ? '服务周期' : '年级' }}</dt>
                          <dd>{{ selectedStudentVerification.grade || '-' }}</dd>
                        </div>
                        <div v-if="selectedStudentVerification.identity || selectedStudentVerification.educationLevel">
                          <dt>身份信息</dt>
                          <dd>{{ [selectedStudentVerification.identity, selectedStudentVerification.educationLevel].filter(Boolean).join(' · ') }}</dd>
                        </div>
                        <div v-if="selectedStudentVerification.educationEmail">
                          <dt>邮箱证明</dt>
                          <dd>{{ selectedStudentVerification.educationEmail }}{{ selectedStudentVerification.educationEmailVerified ? ' · 已验证' : '' }}</dd>
                        </div>
                      </dl>
                    </section>

                    <section class="verification-detail-section">
                      <h3>审核回复</h3>
                      <RichTextView :content="selectedStudentVerification.reply || '暂无审核回复。'" class="rich-text-preview" />
                    </section>
                  </div>

                  <section class="verification-detail-section">
                    <h3>材料说明</h3>
                    <RichTextView :content="selectedStudentVerification.notes || '暂无材料说明。'" class="rich-text-preview" />
                  </section>

                  <section class="verification-detail-section">
                    <h3>附件材料</h3>
                    <div v-if="!selectedStudentVerification.attachments.length" class="text-sm text-slate-500 mt-3 dark:text-slate-400">
                      暂无附件。
                    </div>
                    <VerificationAttachmentGrid v-else :files="selectedStudentVerification.attachments" />
                  </section>
                </section>
              </TxFlipOverlay>
            </Teleport>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.dashboard" icon-class="i-carbon-dashboard">
          <template #name>
            仪表盘数据
          </template>

          <div class="space-y-5">
            <div class="gap-4 grid sm:grid-cols-2 xl:grid-cols-4">
              <div v-for="metric in dashboardMetrics" :key="metric.label" class="admin-metric">
                <div class="flex gap-3 items-center justify-between">
                  <span class="text-sm text-slate-500 fw-800 dark:text-slate-400">{{ metric.label }}</span>
                  <span class="text-xl" :class="metric.icon" />
                </div>
                <div class="text-2xl fw-900 mt-3">
                  {{ metric.value }}
                </div>
                <div class="text-xs text-slate-500 leading-5 mt-2 dark:text-slate-400">
                  {{ metric.note }}
                </div>
              </div>
            </div>

            <div class="gap-4 grid sm:grid-cols-2 xl:grid-cols-4">
              <div v-for="insight in dashboardInsightCards" :key="insight.label" class="admin-insight-card">
                <div class="admin-insight-card__icon" :class="insight.icon" />
                <div class="min-w-0">
                  <span>{{ insight.label }}</span>
                  <b>{{ insight.value }}</b>
                  <p>{{ insight.note }}</p>
                </div>
              </div>
            </div>

            <section class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div>
                  <div class="text-lg fw-900 flex gap-2 items-center">
                    <span class="i-carbon-cloud-service-management" />
                    资源治理
                  </div>
                  <p class="text-sm text-slate-500 leading-6 mt-1 dark:text-slate-400">
                    汇总资源申请的审批、发放、续期、过期和回收队列，便于管理员快速发现异常占用。
                  </p>
                </div>
                <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                  {{ state.applications.filter(item => item.type === 'resource').length }} 个资源申请
                </span>
              </div>

              <div class="mt-5 gap-4 grid sm:grid-cols-2 xl:grid-cols-4">
                <div v-for="card in resourceGovernanceCards" :key="card.label" class="admin-metric">
                  <div class="flex gap-3 items-center justify-between">
                    <span class="text-sm text-slate-500 fw-800 dark:text-slate-400">{{ card.label }}</span>
                    <span class="text-xl" :class="card.icon" />
                  </div>
                  <div class="text-2xl fw-900 mt-3">
                    {{ card.value }}
                  </div>
                  <div class="text-xs leading-5 mt-2" :class="statusPillClass(card.tone)">
                    {{ card.note }}
                  </div>
                </div>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-table-head grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_120px_150px_160px]">
                  <span>资源</span>
                  <span>治理信息</span>
                  <span>状态</span>
                  <span>更新时间</span>
                  <span>操作</span>
                </div>
                <div v-if="!resourceGovernanceRows.length" class="text-sm text-slate-500 p-5 text-center border border-black/10 rounded-2xl border-dashed dark:text-slate-400 dark:border-white/10">
                  当前没有待处理资源治理事项。
                </div>
                <div v-for="row in resourceGovernanceRows" :key="`${row.applicationId}-${row.itemId}`" class="admin-table-row grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_120px_150px_160px]">
                  <div class="min-w-0">
                    <div class="fw-900 truncate">
                      {{ row.title }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ userDisplayName(row.userId) }}
                    </div>
                  </div>
                  <span class="text-xs text-slate-500 leading-5 dark:text-slate-400">
                    {{ resourceGovernanceRowNote(row) }}
                  </span>
                  <span class="admin-pill" :class="statusPillClass(row.status)">
                    {{ resourceLifecycleStatusText[row.status] ?? row.status }}
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    {{ formatDate(row.updatedAt) }}
                  </span>
                  <div class="flex flex-wrap gap-2 justify-end">
                    <TxButton v-if="row.status === 'expired'" size="sm" variant="secondary" :disabled="!isAdmin" @click="updateResourceGovernanceRow(row, 'queue_reclaim')">
                      进回收
                    </TxButton>
                    <TxButton v-if="row.status === 'reclaim_pending'" size="sm" variant="danger" :disabled="!isAdmin" @click="updateResourceGovernanceRow(row, 'release')">
                      标记释放
                    </TxButton>
                    <TxButton v-if="row.status === 'active'" size="sm" variant="secondary" :disabled="!isAdmin" @click="updateResourceGovernanceRow(row, 'return')">
                      标记归还
                    </TxButton>
                  </div>
                </div>
              </div>
            </section>

            <div class="dashboard-chart-grid">
              <section class="admin-chart-card admin-chart-card--wide">
                <div class="admin-chart-head">
                  <div>
                    <h3>近 7 天业务趋势</h3>
                    <p>统计用户注册、业务申请和认证申请的每日新增。</p>
                  </div>
                  <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                    {{ dashboardTrendRows.reduce((sum, item) => sum + item.total, 0) }} 条活动
                  </span>
                </div>
                <svg class="admin-line-chart" :viewBox="`0 0 ${DASHBOARD_TREND_WIDTH} ${DASHBOARD_TREND_HEIGHT}`" role="img" aria-label="近 7 天业务趋势图">
                  <path class="admin-line-chart__grid" :d="`M ${DASHBOARD_TREND_PADDING} ${DASHBOARD_TREND_HEIGHT - DASHBOARD_TREND_PADDING} H ${DASHBOARD_TREND_WIDTH - DASHBOARD_TREND_PADDING}`" />
                  <path class="admin-line-chart__area" :d="dashboardTrendAreaPath" />
                  <polyline class="admin-line-chart__line" :points="dashboardTrendPolyline" />
                  <circle v-for="(point, index) in dashboardTrendPoints" :key="dashboardTrendRows[index].key" class="admin-line-chart__dot" :cx="point.x" :cy="point.y" r="3.2" />
                </svg>
                <div class="admin-trend-labels">
                  <span v-for="day in dashboardTrendRows" :key="day.key">
                    <b>{{ day.total }}</b>
                    {{ day.label }}
                  </span>
                </div>
              </section>

              <section class="admin-chart-card">
                <div class="admin-chart-head">
                  <div>
                    <h3>申请类型分布</h3>
                    <p>按当前筛选范围统计业务申请类型。</p>
                  </div>
                </div>
                <div class="admin-bar-chart">
                  <div v-for="item in dashboardApplicationTypeChart" :key="item.key" class="admin-bar-chart__row">
                    <div class="admin-bar-chart__meta">
                      <span>{{ item.label }}</span>
                      <b>{{ item.value }} · {{ item.percent }}</b>
                    </div>
                    <div class="admin-bar-track">
                      <span :style="{ width: item.width }" />
                    </div>
                    <small>消耗 {{ formatPoints(item.points) }}</small>
                  </div>
                </div>
              </section>

              <section class="admin-chart-card">
                <div class="admin-chart-head">
                  <div>
                    <h3>审核处理漏斗</h3>
                    <p>展示申请从进入流程到完成/退回的分布。</p>
                  </div>
                </div>
                <div class="admin-funnel-chart">
                  <div v-for="item in dashboardApplicationFunnel" :key="item.key" class="admin-funnel-chart__row">
                    <span>{{ item.label }}</span>
                    <div class="admin-funnel-chart__bar">
                      <i :class="statusPillClass(item.tone)" :style="{ width: item.width }" />
                    </div>
                    <b>{{ item.value }} · {{ item.percent }}</b>
                  </div>
                </div>
              </section>

              <section class="admin-chart-card">
                <div class="admin-chart-head">
                  <div>
                    <h3>认证状态分析</h3>
                    <p>对学生/一线认证队列做状态拆分。</p>
                  </div>
                </div>
                <div class="admin-bar-chart">
                  <div v-for="item in dashboardVerificationChart" :key="item.key" class="admin-bar-chart__row">
                    <div class="admin-bar-chart__meta">
                      <span>{{ item.label }}</span>
                      <b>{{ item.value }} · {{ item.percent }}</b>
                    </div>
                    <div class="admin-bar-track">
                      <span :class="statusPillClass(item.tone)" :style="{ width: item.width }" />
                    </div>
                  </div>
                </div>
              </section>

              <section class="admin-chart-card">
                <div class="admin-chart-head">
                  <div>
                    <h3>积分流向</h3>
                    <p>对比当前范围内积分入账和消耗。</p>
                  </div>
                </div>
                <div class="admin-bar-chart admin-bar-chart--large">
                  <div v-for="item in dashboardPointFlowChart" :key="item.key" class="admin-bar-chart__row">
                    <div class="admin-bar-chart__meta">
                      <span>{{ item.label }}</span>
                      <b>{{ item.text }}</b>
                    </div>
                    <div class="admin-bar-track">
                      <span :class="statusPillClass(item.tone)" :style="{ width: item.width }" />
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-list" />
                  近期活动
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ dashboardActivityPagination.total }} 条
                </span>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="dashboardActivityFilters.query" placeholder="标题 / 用户 / 明细" />
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">开始日期</span>
                  <input v-model="dashboardActivityFilters.from" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">结束日期</span>
                  <input v-model="dashboardActivityFilters.to" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">活动类型</span>
                  <select v-model="dashboardActivityFilters.type" class="form-select">
                    <option v-for="option in dashboardActivityTypeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <TxButton size="sm" variant="secondary" @click="resetDashboardActivityFilters">
                  重置
                </TxButton>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-dashboard-activity-grid admin-table-head">
                  <span>类型</span>
                  <span>标题</span>
                  <span>用户</span>
                  <span>明细</span>
                  <span>时间</span>
                </div>
                <div v-if="!dashboardActivityRows.length" class="admin-empty">
                  暂无活动数据
                </div>
                <div v-for="item in dashboardActivityPagination.rows" :key="item.id" class="admin-table-row admin-dashboard-activity-grid">
                  <span class="admin-pill" :class="statusPillClass(item.tone)">
                    {{ dashboardActivityTypeText[item.type] }}
                  </span>
                  <span class="fw-800 truncate">{{ item.title }}</span>
                  <span class="text-sm truncate">{{ item.user }}</span>
                  <span class="text-sm text-slate-600 truncate dark:text-slate-300">{{ item.detail }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>

              <div class="admin-pagination">
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  第 {{ dashboardActivityPagination.start }}-{{ dashboardActivityPagination.end }} 条 / 共 {{ dashboardActivityPagination.total }} 条
                </div>
                <div class="admin-pagination-controls">
                  <select v-model="dashboardActivityFilters.pageSize" class="form-select admin-page-size">
                    <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                      {{ size }} / 页
                    </option>
                  </select>
                  <TxButton size="sm" variant="secondary" :disabled="dashboardActivityPagination.page <= 1" @click="previousPage(dashboardActivityFilters)">
                    上一页
                  </TxButton>
                  <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                    {{ dashboardActivityPagination.page }} / {{ dashboardActivityPagination.totalPages }}
                  </span>
                  <TxButton size="sm" variant="secondary" :disabled="dashboardActivityPagination.page >= dashboardActivityPagination.totalPages" @click="nextPage(dashboardActivityFilters, dashboardActivityPagination.totalPages)">
                    下一页
                  </TxButton>
                </div>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.data" icon-class="i-carbon-data-table">
          <template #name>
            业务数据管理
          </template>

          <div class="space-y-5">
            <div class="gap-4 grid lg:grid-cols-3">
              <div v-for="group in dataGroups" :key="group.title" class="admin-metric">
                <div class="text-sm text-slate-500 fw-800 dark:text-slate-400">
                  {{ group.title }}
                </div>
                <div class="text-2xl fw-900 mt-3">
                  {{ group.count.toLocaleString('zh-CN') }}
                </div>
                <div class="text-xs text-slate-500 leading-5 mt-2 dark:text-slate-400">
                  {{ group.note }}
                </div>
              </div>
            </div>

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-document-attachment" />
                  申请数据
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ applicationPagination.total }} / {{ state.applications.length }} 条
                </span>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="applicationFilters.query" placeholder="标题 / 用户 / 仓库 / 状态" />
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">开始日期</span>
                  <input v-model="applicationFilters.from" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">结束日期</span>
                  <input v-model="applicationFilters.to" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">类型</span>
                  <select v-model="applicationFilters.type" class="form-select">
                    <option v-for="option in applicationTypeFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">状态</span>
                  <select v-model="applicationFilters.status" class="form-select">
                    <option v-for="option in applicationStatusFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <TxButton size="sm" variant="secondary" @click="resetApplicationFilters">
                  重置
                </TxButton>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-app-grid admin-table-head">
                  <span>标题</span>
                  <span>用户</span>
                  <span>类型</span>
                  <span>状态</span>
                  <span>积分</span>
                  <span>创建时间</span>
                </div>
                <div v-if="!applicationRows.length" class="admin-empty">
                  暂无申请数据
                </div>
                <div v-for="item in applicationPagination.rows" :key="item.id" class="admin-table-row admin-app-grid">
                  <div class="min-w-0">
                    <div class="fw-800 truncate">
                      {{ item.title }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ item.githubRepo || '未绑定开源仓库' }}
                    </div>
                  </div>
                  <span class="text-sm truncate">{{ userDisplayName(item.userId) }}</span>
                  <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">{{ applicationTypeText[item.type] }}</span>
                  <span class="admin-pill" :class="statusPillClass(item.status)">{{ applicationStatusText[item.status] }}</span>
                  <span class="fw-800">
                    {{ formatPoints(item.cost) }}
                    <span v-if="item.storageExtended" class="text-xs text-slate-500 block dark:text-slate-400">存储 +{{ formatPoints(item.storageExtensionCost) }}</span>
                    <span v-if="item.status === 'rejected' && (!item.rejectionReviewFeeWaived || item.rejectionFraudulent)" class="text-xs text-rose-500 block">退回费 {{ formatPoints(item.rejectionReviewFee) }}</span>
                    <span v-if="item.rejectionReviewFeeWaived && !item.rejectionFraudulent" class="text-xs text-violet-500 block">免退回费</span>
                    <span v-if="item.rejectionFraudulent" class="text-xs text-red-600 block dark:text-red-300">造假限制</span>
                    <span v-if="item.type === 'code' && item.llmApiBudgetUsd" class="text-xs text-indigo-600 block dark:text-indigo-300">LLMApi {{ item.llmApiModelName }} {{ llmBudgetText(item) }} · RPM {{ item.llmApiRpmLimit }}</span>
                    <span v-if="item.llmApiRequiresExtendedReview" class="text-xs text-amber-600 block dark:text-amber-300">更长审核</span>
                  </span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>

              <div class="admin-pagination">
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  第 {{ applicationPagination.start }}-{{ applicationPagination.end }} 条 / 共 {{ applicationPagination.total }} 条
                </div>
                <div class="admin-pagination-controls">
                  <select v-model="applicationFilters.pageSize" class="form-select admin-page-size">
                    <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                      {{ size }} / 页
                    </option>
                  </select>
                  <TxButton size="sm" variant="secondary" :disabled="applicationPagination.page <= 1" @click="previousPage(applicationFilters)">
                    上一页
                  </TxButton>
                  <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                    {{ applicationPagination.page }} / {{ applicationPagination.totalPages }}
                  </span>
                  <TxButton size="sm" variant="secondary" :disabled="applicationPagination.page >= applicationPagination.totalPages" @click="nextPage(applicationFilters, applicationPagination.totalPages)">
                    下一页
                  </TxButton>
                </div>
              </div>
            </div>

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-education" />
                  认证申请数据
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ studentPagination.total }} / {{ state.studentVerifications.length }} 条
                </span>
              </div>

              <div class="mt-5 p-4 border border-blue-500/15 rounded-3xl bg-blue-50/60 dark:border-blue-300/15 dark:bg-blue-950/20">
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div>
                    <div class="text-base fw-900 flex gap-2 items-center">
                      <span class="i-carbon-user-follow" />
                      管理员代提交认证
                    </div>
                    <p class="text-xs text-slate-500 leading-5 mt-1 dark:text-slate-400">
                      选择用户并上传材料后，会生成一条待审核认证记录；该入口不扣除用户审核费。
                    </p>
                  </div>
                  <TxButton size="sm" variant="ghost" :disabled="adminStudentVerificationForm.submitting" @click="resetAdminStudentVerificationForm">
                    清空
                  </TxButton>
                </div>

                <div class="admin-filter-bar mt-4">
                  <label class="admin-filter-field admin-filter-field--wide">
                    <span class="field-label">用户</span>
                    <select v-model="adminStudentVerificationForm.userId" class="form-select">
                      <option value="">
                        请选择用户
                      </option>
                      <option v-for="user in state.users" :key="user.id" :value="user.id">
                        {{ user.profile.displayName || user.profile.email || user.id }} · {{ user.id }}
                      </option>
                    </select>
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">认证类型</span>
                    <select v-model="adminStudentVerificationForm.verificationType" class="form-select">
                      <option value="student">
                        学生认证
                      </option>
                      <option value="frontline">
                        一线认证
                      </option>
                    </select>
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">真实姓名</span>
                    <TxInput v-model="adminStudentVerificationForm.realName" placeholder="用于人工复核" />
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">认证类目</span>
                    <TxInput v-model="adminStudentVerificationForm.category" placeholder="大学生 / 公益一线等" />
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">学校/组织</span>
                    <TxInput v-model="adminStudentVerificationForm.school" placeholder="学校、单位或项目名称" />
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">年级/周期</span>
                    <TxInput v-model="adminStudentVerificationForm.grade" placeholder="2026 级 / 服务周期" />
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">学历/身份</span>
                    <TxInput v-model="adminStudentVerificationForm.educationLevel" placeholder="本科 / 志愿者等" />
                  </label>
                  <label class="admin-filter-field admin-filter-field--wide">
                    <span class="field-label">教育邮箱</span>
                    <TxInput v-model="adminStudentVerificationForm.educationEmail" type="email" placeholder="可选；填写后可标记管理员已核验" />
                  </label>
                  <label class="admin-filter-field">
                    <span class="field-label">邮箱核验</span>
                    <span class="text-sm flex gap-2 min-h-11 items-center">
                      <TxCheckbox v-model="adminStudentVerificationForm.educationEmailVerified" variant="checkmark" aria-label="管理员已核验教育邮箱" />
                      管理员已核验
                    </span>
                  </label>
                </div>

                <div class="mt-4 gap-3 grid">
                  <label class="gap-2 grid">
                    <span class="field-label">材料说明</span>
                    <RichTextEditor v-model="adminStudentVerificationForm.notes" :min-height="180" placeholder="说明身份背景、材料清单和管理员代提交原因" />
                  </label>
                  <div class="gap-2 grid">
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                      <span class="field-label">证明材料</span>
                      <span class="field-hint">{{ formatBytes(totalAdminStudentVerificationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
                    </div>
                    <FileUploader v-model="adminStudentVerificationFiles" :max="12" button-text="上传材料" drop-text="拖拽证明材料" hint-text="支持任意材料，总大小 200MB 内" />
                  </div>
                  <div class="flex flex-wrap gap-3 items-center justify-between">
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                      {{ adminStudentVerificationForm.message || '提交后记录会进入下方认证申请列表，等待管理员审核。' }}
                    </p>
                    <TxButton variant="primary" :disabled="adminStudentVerificationForm.submitting" @click="onSubmitAdminStudentVerification">
                      {{ adminStudentVerificationForm.submitting ? '提交中...' : '代用户提交认证' }}
                    </TxButton>
                  </div>
                </div>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="studentFilters.query" placeholder="认证类型 / 类目 / 组织 / 用户" />
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">开始日期</span>
                  <input v-model="studentFilters.from" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">结束日期</span>
                  <input v-model="studentFilters.to" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">认证类型</span>
                  <select v-model="studentFilters.verificationType" class="form-select">
                    <option v-for="option in verificationTypeFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">状态</span>
                  <select v-model="studentFilters.status" class="form-select">
                    <option v-for="option in studentStatusFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <TxButton size="sm" variant="secondary" @click="resetStudentFilters">
                  重置
                </TxButton>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-student-grid admin-table-head">
                  <span>类目</span>
                  <span>用户</span>
                  <span>组织</span>
                  <span>状态</span>
                  <span>审核费</span>
                  <span>创建时间</span>
                </div>
                <div v-if="!studentRows.length" class="admin-empty">
                  暂无认证申请数据
                </div>
                <div v-for="item in studentPagination.rows" :key="item.id" class="admin-table-row admin-student-grid">
                  <div class="min-w-0">
                    <div class="fw-800 truncate">
                      {{ item.realName }} · {{ verificationTypeLabel(item.verificationType) }} · {{ item.category }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ [item.grade, item.educationLevel].filter(Boolean).join(' · ') || '未填写补充身份' }}
                    </div>
                  </div>
                  <span class="text-sm truncate">{{ userDisplayName(item.userId) }}</span>
                  <span class="text-sm truncate">{{ verificationOrganizationLabel(item.verificationType) }}：{{ item.school || '未填写' }}</span>
                  <span class="admin-pill" :class="statusPillClass(item.status)">{{ studentStatusText[item.status] }}</span>
                  <span class="fw-800">{{ item.feeReturned ? '已返还' : formatPoints(item.reviewFee) }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>

              <div class="admin-pagination">
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  第 {{ studentPagination.start }}-{{ studentPagination.end }} 条 / 共 {{ studentPagination.total }} 条
                </div>
                <div class="admin-pagination-controls">
                  <select v-model="studentFilters.pageSize" class="form-select admin-page-size">
                    <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                      {{ size }} / 页
                    </option>
                  </select>
                  <TxButton size="sm" variant="secondary" :disabled="studentPagination.page <= 1" @click="previousPage(studentFilters)">
                    上一页
                  </TxButton>
                  <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                    {{ studentPagination.page }} / {{ studentPagination.totalPages }}
                  </span>
                  <TxButton size="sm" variant="secondary" :disabled="studentPagination.page >= studentPagination.totalPages" @click="nextPage(studentFilters, studentPagination.totalPages)">
                    下一页
                  </TxButton>
                </div>
              </div>
            </div>

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-chart-line-data" />
                  积分流水数据
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ transactionPagination.total }} / {{ pointTransactionSummary.count }} 条
                </span>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="transactionFilters.query" placeholder="用户 / 原因 / 类型 / 关联 ID" />
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">开始日期</span>
                  <input v-model="transactionFilters.from" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">结束日期</span>
                  <input v-model="transactionFilters.to" type="date" class="admin-date-input">
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">类型</span>
                  <select v-model="transactionFilters.type" class="form-select">
                    <option v-for="option in transactionTypeFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="admin-filter-field">
                  <span class="field-label">方向</span>
                  <select v-model="transactionFilters.direction" class="form-select">
                    <option v-for="option in transactionDirectionFilterOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <TxButton size="sm" variant="secondary" @click="resetTransactionFilters">
                  重置
                </TxButton>
              </div>

              <div class="admin-table mt-5">
                <div class="admin-table-row admin-tx-grid admin-table-head">
                  <span>用户</span>
                  <span>类型</span>
                  <span>积分变化</span>
                  <span>原因</span>
                  <span>时间</span>
                </div>
                <div v-if="!transactionRows.length" class="admin-empty">
                  暂无积分流水数据
                </div>
                <div v-for="item in transactionPagination.rows" :key="item.id" class="admin-table-row admin-tx-grid">
                  <span class="text-sm truncate">{{ userDisplayName(item.userId) }}</span>
                  <span class="admin-pill" :class="statusPillClass(item.delta < 0 ? 'warning' : 'success')">
                    {{ transactionTypeText[item.type] }}
                  </span>
                  <span class="fw-900" :class="item.delta < 0 ? 'text-amber-700 dark:text-amber-200' : 'text-emerald-700 dark:text-emerald-200'">
                    {{ signedPoints(item.delta) }}
                  </span>
                  <span class="text-sm text-slate-600 truncate dark:text-slate-300">{{ item.reason }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>

              <div class="admin-pagination">
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  第 {{ transactionPagination.start }}-{{ transactionPagination.end }} 条 / 共 {{ transactionPagination.total }} 条
                </div>
                <div class="admin-pagination-controls">
                  <select v-model="transactionFilters.pageSize" class="form-select admin-page-size">
                    <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                      {{ size }} / 页
                    </option>
                  </select>
                  <TxButton size="sm" variant="secondary" :disabled="transactionPagination.page <= 1" @click="previousPage(transactionFilters)">
                    上一页
                  </TxButton>
                  <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                    {{ transactionPagination.page }} / {{ transactionPagination.totalPages }}
                  </span>
                  <TxButton size="sm" variant="secondary" :disabled="transactionPagination.page >= transactionPagination.totalPages" @click="nextPage(transactionFilters, transactionPagination.totalPages)">
                    下一页
                  </TxButton>
                </div>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.audit" icon-class="i-carbon-cloud-auditing">
          <template #name>
            审计日志
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900 flex gap-2 items-center">
                  <span class="i-carbon-cloud-auditing" />
                  审计日志
                </div>
                <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                  按时间汇总用户、积分、申请与学生认证的关键事件，便于管理员追踪操作链路。
                </p>
              </div>
              <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                {{ auditPagination.total }} / {{ auditEvents.length }} 条
              </span>
            </div>

            <div class="admin-filter-bar mt-5">
              <label class="admin-filter-field admin-filter-field--wide">
                <span class="field-label">查询</span>
                <TxInput v-model="auditFilters.query" placeholder="模块 / 动作 / 用户 / 明细" />
              </label>
              <label class="admin-filter-field">
                <span class="field-label">开始日期</span>
                <input v-model="auditFilters.from" type="date" class="admin-date-input">
              </label>
              <label class="admin-filter-field">
                <span class="field-label">结束日期</span>
                <input v-model="auditFilters.to" type="date" class="admin-date-input">
              </label>
              <label class="admin-filter-field">
                <span class="field-label">模块</span>
                <select v-model="auditFilters.area" class="form-select">
                  <option v-for="option in auditAreaFilterOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <TxButton size="sm" variant="secondary" @click="resetAuditFilters">
                重置
              </TxButton>
            </div>

            <div class="mt-5 space-y-3">
              <div v-if="!filteredAuditEvents.length" class="admin-empty">
                暂无审计事件
              </div>
              <div v-for="event in auditPagination.rows" :key="event.id" class="audit-row">
                <div class="audit-dot" :class="auditToneClass(event.tone)" />
                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap gap-2 items-center">
                    <span class="admin-pill" :class="auditToneClass(event.tone)">{{ event.area }}</span>
                    <span class="fw-900">{{ event.action }}</span>
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(event.time) }}</span>
                  </div>
                  <div class="text-sm text-slate-600 leading-6 mt-1 dark:text-slate-300">
                    {{ event.actor }} · {{ event.detail }}
                  </div>
                </div>
              </div>
            </div>

            <div class="admin-pagination">
              <div class="text-xs text-slate-500 dark:text-slate-400">
                第 {{ auditPagination.start }}-{{ auditPagination.end }} 条 / 共 {{ auditPagination.total }} 条
              </div>
              <div class="admin-pagination-controls">
                <select v-model="auditFilters.pageSize" class="form-select admin-page-size">
                  <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                    {{ size }} / 页
                  </option>
                </select>
                <TxButton size="sm" variant="secondary" :disabled="auditPagination.page <= 1" @click="previousPage(auditFilters)">
                  上一页
                </TxButton>
                <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                  {{ auditPagination.page }} / {{ auditPagination.totalPages }}
                </span>
                <TxButton size="sm" variant="secondary" :disabled="auditPagination.page >= auditPagination.totalPages" @click="nextPage(auditFilters, auditPagination.totalPages)">
                  下一页
                </TxButton>
              </div>
            </div>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>

    <div v-if="isVapidRegenerateDialogOpen" class="admin-confirm-backdrop" @click.self="closeVapidRegenerateDialog">
      <div class="admin-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-vapid-regenerate-title">
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div>
            <h3 id="admin-vapid-regenerate-title" class="text-lg fw-950 m-0">
              重新生成 Push 密钥？
            </h3>
            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
              重新生成会替换现有 VAPID 公私钥，已订阅浏览器 Push 的用户可能需要重新启用 Push。
            </p>
          </div>
          <TxButton variant="ghost" size="sm" :disabled="notificationProviderConfigForm.generatingVapid" aria-label="取消重新生成 Push 密钥" @click="closeVapidRegenerateDialog">
            <span class="i-carbon-close" />
          </TxButton>
        </div>
        <div class="text-sm text-amber-800 mt-5 p-3 rounded-2xl bg-amber-50 dark:text-amber-100 dark:bg-amber-950/30">
          如果只是普通保存通知配置，请点击取消；只有确认要让用户重新订阅时才重新生成。
        </div>
        <div class="mt-5 flex flex-wrap gap-3 justify-end">
          <TxButton variant="secondary" :disabled="notificationProviderConfigForm.generatingVapid" @click="closeVapidRegenerateDialog">
            取消
          </TxButton>
          <TxButton variant="primary" :disabled="notificationProviderConfigForm.generatingVapid" @click="generateVapidKeys(true)">
            {{ notificationProviderConfigForm.generatingVapid ? '重新生成中...' : '确认重新生成' }}
          </TxButton>
        </div>
      </div>
    </div>
  </section>
</template>
