<script setup lang="ts">
import type { CreditTransaction, RequestKind, StudentVerification, WelfareApplication } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxInput, TxNumberInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints } from '~/composables/welfare'
import { ADMIN_TABS, useWelfareUiState } from '~/composables/welfare-ui'

const {
  state,
  isAdmin,
  pointDrafts,
  userLevelCard,
  setUserCrowdReviewer,
  setUserStudentVerified,
  unbindUserGitHub,
  rechargeConfigForm,
  githubAppConfigForm,
  aiConfigForm,
  notificationProviderConfigForm,
  activeAdminTab,
  adjustUserPoints,
  refreshRechargeConfig,
  persistRechargeConfig,
  refreshGitHubAppConfig,
  persistGitHubAppConfig,
  refreshAiConfig,
  persistAiConfig,
  refreshNotificationProviderConfig,
  persistNotificationProviderConfig,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

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
const REQUEST_TYPE_ORDER: RequestKind[] = ['code', 'image', 'pro']

const applicationTypeText: Record<string, string> = {
  code: 'LLMApi 申请',
  image: 'Image 申请',
  pro: 'Pro 申请',
}

const applicationStatusText: Record<string, string> = {
  draft: '草稿',
  reserved: '已提交',
  pending_review: '待审核',
  processing: '处理中',
  answered: '已答复',
  completed: '已完成',
  closed: '已关闭',
  rejected: '已退回',
}

const studentStatusText: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已退回',
}

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
  student: '学生认证',
  transaction: '积分',
}

const userRoleFilterOptions = [
  { value: ALL_FILTER, label: '全部角色' },
  { value: 'admin', label: '管理员' },
  { value: 'reviewer', label: '众包审核' },
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
  { value: 'student', label: '学生认证' },
  { value: 'transaction', label: '积分' },
]

const applicationTypeFilterOptions = [
  { value: ALL_FILTER, label: '全部类型' },
  { value: 'code', label: applicationTypeText.code },
  { value: 'image', label: applicationTypeText.image },
  { value: 'pro', label: applicationTypeText.pro },
]

const applicationStatusFilterOptions = [
  { value: ALL_FILTER, label: '全部状态' },
  { value: 'reserved', label: applicationStatusText.reserved },
  { value: 'pending_review', label: applicationStatusText.pending_review },
  { value: 'answered', label: applicationStatusText.answered },
  { value: 'rejected', label: applicationStatusText.rejected },
]

const studentStatusFilterOptions = [
  { value: ALL_FILTER, label: '全部状态' },
  { value: 'pending', label: studentStatusText.pending },
  { value: 'approved', label: studentStatusText.approved },
  { value: 'rejected', label: studentStatusText.rejected },
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

const auditAreaFilterOptions = [
  { value: ALL_FILTER, label: '全部模块' },
  { value: '用户', label: '用户' },
  { value: '积分', label: '积分' },
  { value: '申请', label: '申请' },
  { value: '学生认证', label: '学生认证' },
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
const pendingAdminUserAction = ref('')

function userDisplayName(userId: string) {
  return state.users.find(user => user.id === userId)?.profile.displayName ?? '未知用户'
}

function signedPoints(value: number) {
  return value > 0 ? `+${formatPoints(value)}` : formatPoints(value)
}

function statusPillClass(status: string) {
  if (['answered', 'approved', 'completed', 'closed', 'success'].includes(status))
    return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
  if (['pending_review', 'processing', 'pending', 'reserved', 'warning'].includes(status))
    return 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'
  if (['rejected', 'danger'].includes(status))
    return 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-950/30'
  return 'text-slate-700 bg-slate-100 dark:text-slate-200 dark:bg-white/10'
}

function roleText(role: string) {
  if (role === 'admin')
    return '管理员'
  if (role === 'reviewer')
    return '众包审核'
  return '普通用户'
}

function roleToneClass(role: string) {
  if (role === 'admin')
    return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30'
  if (role === 'reviewer')
    return 'text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30'
  return 'text-slate-700 bg-slate-100 dark:text-slate-200 dark:bg-white/10'
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
  () => [studentFilters.query, studentFilters.from, studentFilters.to, studentFilters.status, studentFilters.pageSize],
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
    const transactions = state.transactions.filter(item => item.userId === user.id)
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
  userRows,
  (rows) => {
    if (selectedUserId.value && rows.some(row => row.user.id === selectedUserId.value))
      return

    selectedUserId.value = rows[0]?.user.id ?? ''
  },
  { immediate: true },
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
  const transactions = [...state.transactions]
    .filter(item => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const spendTransactions = transactions.filter(item => item.delta < 0)
  const incomeTransactions = transactions.filter(item => item.delta > 0)
  const pipelineSpend = spendTransactions.filter(isPipelineSpendTransaction)
  const studentSpend = spendTransactions.filter(item => isStudentRef(item.refId) || item.reason.includes('学生认证'))
  const rechargeIncome = incomeTransactions.filter(item => item.type === 'recharge')
  const manualAdjustments = transactions.filter(item => item.type === 'adjustment')
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
      kind: '认证',
      title: item.category,
      detail: `${item.school || '未填写学校'} · ${studentStatusLabel(item.status)} · 审核费 ${formatPoints(item.reviewFee)}`,
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
    spendTransactions,
    pipelineSpend,
    latestRecords,
    applicationCounts,
    stats: {
      balance: user.points,
      totalIncome: sumTransactions(incomeTransactions),
      totalSpend: Math.abs(sumTransactions(spendTransactions)),
      pipelineSpend: Math.abs(sumTransactions(pipelineSpend)),
      studentSpend: Math.abs(sumTransactions(studentSpend)),
      rechargeIncome: sumTransactions(rechargeIncome),
      manualAdjustment: sumTransactions(manualAdjustments),
      applicationCount: applications.length,
      pendingApplications: applications.filter(item => ['pending_review', 'processing', 'reserved'].includes(item.status)).length,
      rejectedApplications: applications.filter(item => item.status === 'rejected').length,
      studentCount: studentVerifications.length,
      approvedStudents: studentVerifications.filter(item => item.status === 'approved').length,
      transactionCount: transactions.length,
    },
  }
})

const selectedUserRecentApplications = computed<WelfareApplication[]>(() => selectedUserDetail.value?.applications.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedUserRecentStudents = computed<StudentVerification[]>(() => selectedUserDetail.value?.studentVerifications.slice(0, USER_DETAIL_LIMIT) ?? [])
const selectedUserRecentTransactions = computed<CreditTransaction[]>(() => selectedUserDetail.value?.transactions.slice(0, USER_DETAIL_LIMIT) ?? [])

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
  transactions: state.transactions.filter(item => isInDateRange(item.createdAt, dashboardActivityFilters)),
}))

const dashboardMetrics = computed(() => {
  const { users, applications, studentVerifications, transactions } = dashboardMetricScope.value
  const adminCount = users.filter(user => user.role === 'admin').length
  const pendingApplicationCount = applications.filter(item => item.status === 'pending_review').length
  const pendingStudentCount = studentVerifications.filter(item => item.status === 'pending').length
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
      note: `${pendingApplicationCount} 个申请 / ${pendingStudentCount} 个学生认证`,
      icon: 'i-carbon-review',
    },
    {
      label: '业务申请',
      value: applications.length.toLocaleString('zh-CN'),
      note: `${applications.filter(item => item.status === 'pending_review').length} 个待审核 / ${applications.filter(item => item.status === 'answered').length} 个已答复`,
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
      tone: application.status === 'rejected' ? 'danger' : application.status === 'pending_review' ? 'warning' : 'success',
      createdAt: application.createdAt,
    })
  }

  for (const verification of state.studentVerifications) {
    rows.push({
      id: `dashboard-student-${verification.id}`,
      type: 'student',
      title: verification.category,
      user: userDisplayName(verification.userId),
      detail: `${verification.school || '未填写学校'} · ${studentStatusText[verification.status]}`,
      tone: verification.status === 'rejected' ? 'danger' : verification.status === 'pending' ? 'warning' : 'success',
      createdAt: verification.createdAt,
    })
  }

  for (const transaction of state.transactions) {
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

const dashboardConfigRows = computed(() => [
  {
    name: 'OAuth 登录',
    status: state.oauth.enabled ? '已启用' : '未启用',
    detail: `${state.oauth.provider.toUpperCase()} · ${state.oauth.clientId || '未填写 Client ID'}`,
    tone: state.oauth.enabled ? 'success' : 'warning',
  },
  {
    name: 'GitHub 应用',
    status: githubAppConfigForm.configured ? '已配置' : '未配置',
    detail: githubAppConfigForm.appName || githubAppConfigForm.callbackUrl,
    tone: githubAppConfigForm.configured ? 'success' : 'warning',
  },
  {
    name: 'AI Provider',
    status: aiConfigForm.configured ? '已配置' : '未配置',
    detail: `${aiConfigForm.baseUrl} · 图片 ${aiConfigForm.imageModel} · 审核 ${aiConfigForm.reviewModel}`,
    tone: aiConfigForm.configured ? 'success' : 'warning',
  },
  {
    name: '通知供应商',
    status: notificationProviderConfigForm.emailConfigured || notificationProviderConfigForm.pushConfigured ? '已配置' : '未配置',
    detail: `邮件 ${notificationProviderConfigForm.emailConfigured ? '可用' : '未配置'} · 推送 ${notificationProviderConfigForm.pushConfigured ? '可用' : '未配置'}`,
    tone: notificationProviderConfigForm.emailConfigured || notificationProviderConfigForm.pushConfigured ? 'success' : 'warning',
  },
  {
    name: 'LINUX DO Credit',
    status: rechargeConfigForm.configured ? '已配置' : '未配置',
    detail: rechargeConfigForm.gatewayBaseUrl,
    tone: rechargeConfigForm.configured ? 'success' : 'warning',
  },
])

const dataGroups = computed(() => [
  {
    title: '公益申请',
    count: state.applications.length,
    note: `${state.applications.filter(item => item.status === 'pending_review').length} 个待审核，${state.applications.filter(item => item.status === 'rejected').length} 个已退回`,
  },
  {
    title: '学生认证',
    count: state.studentVerifications.length,
    note: `${state.studentVerifications.filter(item => item.status === 'pending').length} 个待审核，${state.studentVerifications.filter(item => item.status === 'approved').length} 个已通过`,
  },
  {
    title: '积分流水',
    count: state.transactions.length,
    note: `${state.transactions.filter(item => item.delta > 0).length} 条入账，${state.transactions.filter(item => item.delta < 0).length} 条扣减`,
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
  .filter(item => studentFilters.status === ALL_FILTER || item.status === studentFilters.status)
  .filter(item => isInDateRange(item.createdAt, studentFilters))
  .filter(item => matchesQuery(studentFilters.query, [
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

const transactionRows = computed(() => [...state.transactions]
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

  for (const transaction of state.transactions) {
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
      tone: application.status === 'pending_review' ? 'warning' : 'info',
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
      area: '学生认证',
      action: '提交材料',
      actor: userDisplayName(verification.userId),
      detail: `${verification.category} · ${verification.school || '未填写学校'} · ${studentStatusText[verification.status] ?? verification.status}`,
      tone: verification.status === 'pending' ? 'warning' : 'info',
    })

    if (verification.reviewedAt) {
      events.push({
        id: `student-reviewed-${verification.id}`,
        time: verification.reviewedAt,
        area: '学生认证',
        action: verification.status === 'rejected' ? '退回认证' : '通过认证',
        actor: '管理员',
        detail: `${verification.category} · ${userDisplayName(verification.userId)}`,
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
  runSafely(() => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    if (!state.oauth.clientId.trim())
      throw new Error('请填写 OAuth Client ID')
    state.oauth.enabled = true
  }, 'OAuth 配置已启用')
}

function fillOauthFromGitHubApp() {
  runSafely(() => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    if (!githubAppConfigForm.clientId.trim())
      throw new Error('请先填写 GitHub App Client ID')

    state.oauth.provider = 'github'
    state.oauth.clientId = githubAppConfigForm.clientId
    state.oauth.authorizeUrl = githubAppConfigForm.authorizeUrl
    state.oauth.tokenUrl = githubAppConfigForm.tokenUrl
    state.oauth.callbackUrl = githubAppConfigForm.callbackUrl
    state.oauth.scopes = githubAppConfigForm.scopes
    state.oauth.enabled = true
  }, '已同步 GitHub App 登录配置')
}

function onAdjustPoints(userId: string) {
  runSafely(() => adjustUserPoints(userId, pointDrafts[userId] ?? 0, '后台积分充值 / 调整'), '积分已调整')
}

function onToggleReviewer(userId: string, enabled: boolean) {
  runSafely(() => setUserCrowdReviewer(userId, enabled), enabled ? '已授予众包审核权限' : '已收回众包审核权限')
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

function onToggleStudentVerified(userId: string, verified: boolean) {
  const action = verified ? 'verify-student' : 'unbind-student'
  if (!confirmUserAction(userId, action))
    return

  runSafely(() => {
    setUserStudentVerified(userId, verified)
    pendingAdminUserAction.value = ''
  }, verified ? '已标记学生认证' : '已解绑学生认证')
}

function onUnbindGitHub(userId: string) {
  if (!confirmUserAction(userId, 'unbind-github'))
    return

  runSafely(() => {
    unbindUserGitHub(userId)
    pendingAdminUserAction.value = ''
  }, 'GitHub 认证已解绑')
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

function saveNotificationProviderConfig() {
  runSafely(async () => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    await persistNotificationProviderConfig()
  }, '通知供应商配置已保存')
}

onMounted(() => {
  refreshRechargeConfig().catch(() => {})
  refreshGitHubAppConfig().catch(() => {})
  refreshAiConfig().catch(() => {})
  refreshNotificationProviderConfig().catch(() => {})
})
</script>

<template>
  <section>
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
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
        :default-value="ADMIN_TABS.login"
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

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-ai-status" />
              AI Provider
            </div>
            <div class="text-sm mb-5 p-3 rounded-2xl" :class="aiConfigForm.configured ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
              {{ aiConfigForm.configured ? `API Key 已配置：${aiConfigForm.apiKeyMasked}` : '尚未配置 OpenAI 兼容 API Key，AI 调用不可用。' }}
            </div>
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
                    用户可选择 Codex、ClaudeCode 和其他国内外模型；这里配置每个模型的价格、额度、IP、RPM 与并发限制。
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
                  <div class="mt-4 gap-3 grid md:grid-cols-3 xl:grid-cols-6">
                    <label class="gap-2 grid">
                      <span class="field-label">价格（积分/USD）</span>
                      <TxNumberInput v-model="model.pointsPerUsd" :min="1" :max="1000" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">默认额度 USD</span>
                      <TxNumberInput v-model="model.defaultBudgetUsd" :min="model.minBudgetUsd" :max="model.maxBudgetUsd" :step="10" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">最小 USD</span>
                      <TxNumberInput v-model="model.minBudgetUsd" :min="1" :max="model.maxBudgetUsd" :step="1" :controls="false" :disabled="!isAdmin || aiConfigForm.loading" />
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">最大 USD</span>
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
              图片生成结果写入 AI_ASSETS R2；接口密钥保存到服务端加密配置，环境变量仅作为旧部署兜底。
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
              邮件：{{ notificationProviderConfigForm.emailConfigured ? '已配置' : '未配置' }}；浏览器推送：{{ notificationProviderConfigForm.pushConfigured ? '已配置' : '未配置' }}。
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
              <label class="gap-2 grid lg:col-span-2">
                <span class="field-label">VAPID Public Key</span>
                <TxInput v-model="notificationProviderConfigForm.vapidPublicKey" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="Web Push 公钥" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">VAPID Private Key</span>
                <TxInput v-model="notificationProviderConfigForm.vapidPrivateKey" :disabled="!isAdmin || notificationProviderConfigForm.loading" type="password" :placeholder="notificationProviderConfigForm.vapidPrivateKeyMasked || '保存到服务端加密配置'" />
              </label>
              <label class="gap-2 grid">
                <span class="field-label">VAPID Subject</span>
                <TxInput v-model="notificationProviderConfigForm.vapidSubject" :disabled="!isAdmin || notificationProviderConfigForm.loading" placeholder="mailto:admin@example.com" />
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
            <div class="text-xs text-slate-500 leading-5 mt-4 dark:text-slate-400">
              飞书 Webhook 仍由用户通知设置保存；这里仅配置全局邮件和浏览器推送供应商。
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
              <br>
              环境变量仅作为旧部署 fallback；新配置以这里保存的服务端配置为准。
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="ADMIN_TABS.users" icon-class="i-carbon-user-multiple">
          <template #name>
            用户管理
          </template>

          <div class="space-y-5">
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
                </div>
                <div v-if="!userRows.length" class="admin-empty">
                  暂无用户数据
                </div>
                <div
                  v-for="row in userPagination.rows"
                  :key="row.user.id"
                  role="button"
                  tabindex="0"
                  class="admin-table-row admin-users-grid admin-user-row"
                  :class="{ 'is-selected': row.user.id === selectedUserId }"
                  @click="selectedUserId = row.user.id"
                  @keydown.enter="selectedUserId = row.user.id"
                  @keydown.space.prevent="selectedUserId = row.user.id"
                >
                  <div class="min-w-0">
                    <div class="flex gap-2 min-w-0 items-center">
                      <span class="fw-800 truncate">{{ row.user.profile.displayName }}</span>
                      <span v-if="row.user.id === selectedUserId" class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                        已选中
                      </span>
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
                      <TxCheckbox :model-value="row.user.role === 'reviewer'" variant="checkmark" :disabled="!isAdmin" aria-label="众包审核" @change="value => onToggleReviewer(row.user.id, value)" />
                      众包审核
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

            <div v-if="selectedUserDetail" class="admin-user-detail">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="min-w-0">
                  <div class="text-lg fw-900 flex gap-2 items-center">
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
                  <span class="admin-pill" :class="levelToneClass(selectedUserDetail.level.tone)">
                    {{ selectedUserDetail.level.name }}
                  </span>
                </div>
              </div>

              <div class="admin-user-stat-grid mt-5">
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

              <div class="admin-user-account-grid mt-5">
                <section class="admin-detail-section">
                  <div class="admin-detail-title">
                    <span class="i-carbon-identification" />
                    账号与认证
                  </div>
                  <div class="admin-detail-list mt-4">
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
                  </div>
                  <div class="mt-4 flex flex-wrap gap-3 items-center">
                    <label v-if="selectedUserDetail.user.role !== 'admin'" class="admin-action-check">
                      <TxCheckbox :model-value="selectedUserDetail.user.role === 'reviewer'" variant="checkmark" :disabled="!isAdmin" aria-label="众包审核权限" @change="value => selectedUserDetail && onToggleReviewer(selectedUserDetail.user.id, value)" />
                      众包审核权限
                    </label>
                    <TxButton
                      size="sm"
                      variant="secondary"
                      :disabled="!isAdmin"
                      @click="onToggleStudentVerified(selectedUserDetail.user.id, !selectedUserDetail.user.profile.studentVerified)"
                    >
                      {{
                        pendingAdminUserAction === userActionKey(
                          selectedUserDetail.user.id,
                          selectedUserDetail.user.profile.studentVerified ? 'unbind-student' : 'verify-student',
                        )
                          ? '确认执行'
                          : selectedUserDetail.user.profile.studentVerified ? '解绑学生认证' : '标记学生认证'
                      }}
                    </TxButton>
                    <TxButton size="sm" variant="danger" :disabled="!isAdmin || !selectedUserDetail.user.profile.githubAuthorized" @click="onUnbindGitHub(selectedUserDetail.user.id)">
                      {{ pendingAdminUserAction === userActionKey(selectedUserDetail.user.id, 'unbind-github') ? '确认解绑' : '解绑 GitHub' }}
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

              <div class="admin-detail-section mt-5">
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
              </div>

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
                    <span class="i-carbon-education" />
                    认证历史
                  </div>
                  <div class="mt-4 space-y-3">
                    <div v-if="!selectedUserRecentStudents.length" class="admin-empty">
                      暂无认证历史
                    </div>
                    <div v-for="item in selectedUserRecentStudents" :key="item.id" class="admin-history-row">
                      <span class="admin-pill" :class="statusPillClass(item.status)">{{ studentStatusLabel(item.status) }}</span>
                      <div class="flex-1 min-w-0">
                        <div class="fw-900 truncate">
                          {{ item.category }}
                        </div>
                        <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                          {{ [item.school, item.grade, item.educationLevel].filter(Boolean).join(' · ') || '未填写学校信息' }}
                        </div>
                      </div>
                      <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(item.createdAt) }}</span>
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
            </div>
            <div v-else class="admin-empty">
              请选择一个用户查看详细信息
            </div>
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

            <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
                <span class="i-carbon-dashboard" />
                系统配置状态
              </div>
              <div class="gap-3 grid lg:grid-cols-2">
                <div v-for="item in dashboardConfigRows" :key="item.name" class="p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
                  <div class="flex gap-3 items-center justify-between">
                    <span class="fw-900">{{ item.name }}</span>
                    <span class="admin-pill" :class="statusPillClass(item.tone)">
                      {{ item.status }}
                    </span>
                  </div>
                  <div class="text-xs text-slate-500 leading-5 mt-2 break-all dark:text-slate-400">
                    {{ item.detail }}
                  </div>
                </div>
              </div>
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
                    <span v-if="item.type === 'code' && item.llmApiBudgetUsd" class="text-xs text-indigo-600 block dark:text-indigo-300">LLMApi {{ item.llmApiModelName }} ${{ item.llmApiBudgetUsd }} · RPM {{ item.llmApiRpmLimit }}</span>
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
                  学生认证数据
                </div>
                <span class="text-xs fw-800 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                  {{ studentPagination.total }} / {{ state.studentVerifications.length }} 条
                </span>
              </div>

              <div class="admin-filter-bar mt-5">
                <label class="admin-filter-field admin-filter-field--wide">
                  <span class="field-label">查询</span>
                  <TxInput v-model="studentFilters.query" placeholder="类目 / 学校 / 用户 / 学历" />
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
                  <span>学校</span>
                  <span>状态</span>
                  <span>审核费</span>
                  <span>创建时间</span>
                </div>
                <div v-if="!studentRows.length" class="admin-empty">
                  暂无学生认证数据
                </div>
                <div v-for="item in studentPagination.rows" :key="item.id" class="admin-table-row admin-student-grid">
                  <div class="min-w-0">
                    <div class="fw-800 truncate">
                      {{ item.category }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ [item.grade, item.educationLevel].filter(Boolean).join(' · ') || '未填写年级学历' }}
                    </div>
                  </div>
                  <span class="text-sm truncate">{{ userDisplayName(item.userId) }}</span>
                  <span class="text-sm truncate">{{ item.school || '未填写' }}</span>
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
                  {{ transactionPagination.total }} / {{ state.transactions.length }} 条
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

        <TxTabItem :name="ADMIN_TABS.points" icon-class="i-carbon-chart-line-data">
          <template #name>
            积分管理
          </template>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
              <span class="i-carbon-wallet" />
              积分系统
            </div>
            <div class="space-y-3">
              <div v-for="user in state.users" :key="user.id" class="p-4 rounded-2xl bg-slate-100 gap-3 grid dark:bg-[#151820] sm:grid-cols-[1fr_120px_auto] sm:items-center">
                <div class="min-w-0">
                  <div class="fw-800 truncate">
                    {{ user.profile.displayName }}
                  </div>
                  <div class="text-xs text-slate-500 truncate">
                    {{ user.profile.email }} · {{ formatPoints(user.points) }}
                  </div>
                </div>
                <TxInput v-model="pointDrafts[user.id]" type="number" :disabled="!isAdmin" placeholder="+/-" />
                <TxButton size="sm" variant="secondary" :disabled="!isAdmin" @click="onAdjustPoints(user.id)">
                  调整
                </TxButton>
              </div>
            </div>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </section>
</template>
