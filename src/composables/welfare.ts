import { computed, reactive, watch } from 'vue'

export type UserRole = 'admin' | 'user'
export type RequestKind = 'code' | 'image' | 'pro'
export type RequestStatus = 'reserved' | 'pending_review' | 'answered' | 'rejected'
export type StudentStatus = 'pending' | 'approved' | 'rejected'
export type CreditTransactionType = 'recharge' | 'spend' | 'refund' | 'adjustment' | 'grant'

export interface UserProfile {
  displayName: string
  email: string
  avatar?: string
  bio?: string
  githubUsername?: string
  selectedRepo?: string
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

export interface WelfareApplication {
  id: string
  userId: string
  type: RequestKind
  title: string
  description: string
  githubRepo?: string
  hasOpenSourceBadge: boolean
  attachments: AttachmentMeta[]
  status: RequestStatus
  cost: number
  costCharged: boolean
  answer?: string
  createdAt: string
  reviewedAt?: string
}

export interface StudentVerification {
  id: string
  userId: string
  category: string
  school?: string
  identity?: string
  notes: string
  attachments: AttachmentMeta[]
  status: StudentStatus
  reviewFee: number
  feeReturned: boolean
  reply?: string
  createdAt: string
  reviewedAt?: string
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

interface WelfareState {
  users: User[]
  currentUserId?: string
  oauth: OauthConfig
  applications: WelfareApplication[]
  studentVerifications: StudentVerification[]
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

export interface MockLoginPayload {
  displayName: string
  email: string
}

export interface SubmitApplicationPayload {
  type: RequestKind
  title: string
  description: string
  githubRepo?: string
  attachments?: FileLike[]
}

export interface SubmitStudentPayload {
  category: string
  school?: string
  identity?: string
  notes: string
  attachments?: FileLike[]
}

const STORAGE_KEY = 'touch-great-welfare:v1'

export const REQUEST_COST: Record<RequestKind, number> = {
  code: 1,
  image: 10,
  pro: 100,
}

export const STUDENT_REVIEW_FEE = 10
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
export const MAX_ACTIVE_PRO_APPLICATIONS = 3

function now() {
  return new Date().toISOString()
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
    transactions: [],
    createdAt: now(),
  }
}

function normalizeState(input: Partial<WelfareState>): WelfareState {
  const fallback = defaultState()
  return {
    ...fallback,
    ...input,
    oauth: {
      ...fallback.oauth,
      ...input.oauth,
    },
    users: input.users ?? [],
    applications: input.applications ?? [],
    studentVerifications: input.studentVerifications ?? [],
    transactions: input.transactions ?? [],
  }
}

function loadState(): WelfareState {
  if (typeof window === 'undefined')
    return defaultState()

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw)
    return defaultState()

  try {
    return normalizeState(JSON.parse(raw) as Partial<WelfareState>)
  }
  catch {
    return defaultState()
  }
}

function saveState(state: WelfareState) {
  if (typeof window === 'undefined')
    return

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function assertCurrentUser(user?: User): asserts user is User {
  if (!user)
    throw new Error('请先通过 OAuth 登录')
}

function assertAdmin(user?: User): asserts user is User {
  if (!user || user.role !== 'admin')
    throw new Error('需要管理员权限')
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

const state = reactive<WelfareState>(loadState())

watch(
  state,
  value => saveState(value),
  { deep: true },
)

export function useWelfareDemo() {
  const hasAdmin = computed(() => state.users.some(user => user.role === 'admin'))
  const currentUser = computed(() => state.users.find(user => user.id === state.currentUserId))
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
  const oauthReady = computed(() => state.oauth.enabled && !!state.oauth.clientId.trim())
  const pendingProApplications = computed(() => state.applications
    .filter(item => item.type === 'pro' && item.status === 'pending_review')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const pendingStudentVerifications = computed(() => state.studentVerifications
    .filter(item => item.status === 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const totalReservedApplications = computed(() => state.applications
    .filter(item => item.status === 'reserved')
    .length)

  function userName(userId: string) {
    return state.users.find(user => user.id === userId)?.profile.displayName ?? '未知用户'
  }

  function userEmail(userId: string) {
    return state.users.find(user => user.id === userId)?.profile.email ?? 'unknown@example.com'
  }

  function activeProCount(userId: string) {
    return state.applications.filter(item => item.userId === userId && item.type === 'pro' && item.status === 'pending_review').length
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

  function createAdmin(payload: CreateAdminPayload) {
    if (hasAdmin.value)
      throw new Error('管理员已经创建')

    const admin: User = {
      id: createId('admin'),
      role: 'admin',
      profile: {
        displayName: payload.displayName.trim() || '公益管理员',
        email: payload.email.trim() || 'admin@example.com',
        studentVerified: false,
      },
      points: 1000,
      createdAt: now(),
      lastLoginAt: now(),
    }

    state.users.push(admin)
    state.currentUserId = admin.id
    state.transactions.unshift({
      id: createId('tx'),
      userId: admin.id,
      delta: 1000,
      type: 'grant',
      reason: '首次创建管理员初始化积分',
      createdAt: now(),
    })
  }

  function loginAsAdmin() {
    const admin = state.users.find(user => user.role === 'admin')
    if (!admin)
      throw new Error('尚未创建管理员')

    admin.lastLoginAt = now()
    state.currentUserId = admin.id
  }

  function mockOauthLogin(payload: MockLoginPayload) {
    if (!oauthReady.value)
      throw new Error('OAuth 尚未启用，请先由管理员配置 Client ID')

    const email = payload.email.trim().toLowerCase()
    if (!email)
      throw new Error('请输入邮箱')

    let user = state.users.find(item => item.profile.email.toLowerCase() === email)
    if (!user) {
      user = {
        id: createId('user'),
        role: 'user',
        profile: {
          displayName: payload.displayName.trim() || email.split('@')[0] || '公益用户',
          email,
          avatar: `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(email)}`,
          studentVerified: false,
        },
        points: 120,
        createdAt: now(),
        lastLoginAt: now(),
      }
      state.users.push(user)
      state.transactions.unshift({
        id: createId('tx'),
        userId: user.id,
        delta: 120,
        type: 'grant',
        reason: 'OAuth 首次登录体验积分',
        createdAt: now(),
      })
    }
    else {
      user.lastLoginAt = now()
    }

    state.currentUserId = user.id
  }

  function logout() {
    state.currentUserId = undefined
  }

  function updateCurrentProfile(profile: Partial<UserProfile>) {
    assertCurrentUser(currentUser.value)
    currentUser.value.profile = {
      ...currentUser.value.profile,
      ...profile,
    }
  }

  function mockGithubRepos(username: string) {
    const handle = username.trim().replace(/^@/, '')
    if (!handle)
      return []

    return [
      `${handle}/public-good-kit`,
      `${handle}/campus-helper`,
      `${handle}/open-welfare-tools`,
      `${handle}/awesome-accessibility`,
    ]
  }

  function rechargeCurrentUser(amount: number) {
    assertCurrentUser(currentUser.value)
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error('请输入有效充值积分')

    addTransaction(currentUser.value.id, Math.floor(amount), 'recharge', '充值接口预留：手动模拟到账')
  }

  function submitApplication(payload: SubmitApplicationPayload) {
    assertCurrentUser(currentUser.value)
    if (currentUser.value.role === 'admin')
      throw new Error('请使用普通用户账号提交申请')

    const title = payload.title.trim()
    const description = payload.description.trim()
    if (!title)
      throw new Error('请填写申请标题')
    if (!description)
      throw new Error('请填写申请说明')
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('附件总大小不能超过 200MB')
    if (payload.type === 'pro' && activeProCount(currentUser.value.id) >= MAX_ACTIVE_PRO_APPLICATIONS)
      throw new Error('一个用户同时最多只能有 3 个 Pro 申请待审核')

    const cost = REQUEST_COST[payload.type]
    const shouldChargeNow = payload.type !== 'pro'
    const application: WelfareApplication = {
      id: createId('app'),
      userId: currentUser.value.id,
      type: payload.type,
      title,
      description,
      githubRepo: payload.githubRepo,
      hasOpenSourceBadge: !!payload.githubRepo && !!currentUser.value.profile.githubUsername,
      attachments: toAttachmentMeta(payload.attachments),
      status: payload.type === 'pro' ? 'pending_review' : 'reserved',
      cost,
      costCharged: false,
      createdAt: now(),
    }

    if (shouldChargeNow) {
      addTransaction(currentUser.value.id, -cost, 'spend', `${payload.type.toUpperCase()} 申请预留扣除`, application.id)
      application.costCharged = true
    }

    state.applications.unshift(application)
  }

  function answerProApplication(applicationId: string, answer: string) {
    assertAdmin(currentUser.value)
    const application = state.applications.find(item => item.id === applicationId)
    if (!application || application.type !== 'pro')
      throw new Error('申请不存在')
    if (application.status !== 'pending_review')
      throw new Error('该申请已经处理')
    if (!answer.trim())
      throw new Error('请填写审核答复')

    addTransaction(application.userId, -REQUEST_COST.pro, 'spend', 'Pro 申请审核通过后扣除', application.id)
    application.status = 'answered'
    application.answer = answer.trim()
    application.costCharged = true
    application.reviewedAt = now()
  }

  function rejectProApplication(applicationId: string, reason: string) {
    assertAdmin(currentUser.value)
    const application = state.applications.find(item => item.id === applicationId)
    if (!application || application.type !== 'pro')
      throw new Error('申请不存在')
    if (application.status !== 'pending_review')
      throw new Error('该申请已经处理')

    application.status = 'rejected'
    application.answer = reason.trim() || '申请已退回，本次不扣除积分。'
    application.costCharged = false
    application.reviewedAt = now()
  }

  function submitStudentVerification(payload: SubmitStudentPayload) {
    assertCurrentUser(currentUser.value)
    if (currentUser.value.role === 'admin')
      throw new Error('请使用普通用户账号申请学生认证')
    if (!payload.category.trim())
      throw new Error('请填写认证类目')
    if (!payload.notes.trim())
      throw new Error('请填写认证材料说明')
    if (totalBytes(payload.attachments) > MAX_ATTACHMENT_BYTES)
      throw new Error('材料附件总大小不能超过 200MB')

    const verification: StudentVerification = {
      id: createId('stu'),
      userId: currentUser.value.id,
      category: payload.category.trim(),
      school: payload.school?.trim(),
      identity: payload.identity?.trim(),
      notes: payload.notes.trim(),
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
    assertAdmin(currentUser.value)
    const verification = state.studentVerifications.find(item => item.id === id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'pending')
      throw new Error('该认证申请已经处理')

    verification.status = 'approved'
    verification.reply = reply.trim() || '认证通过，审核积分已返还。'
    verification.reviewedAt = now()
    verification.feeReturned = true
    addTransaction(verification.userId, verification.reviewFee, 'refund', '学生认证通过返还审核费', verification.id)

    const user = state.users.find(item => item.id === verification.userId)
    if (user)
      user.profile.studentVerified = true
  }

  function rejectStudentVerification(id: string, reason: string) {
    assertAdmin(currentUser.value)
    const verification = state.studentVerifications.find(item => item.id === id)
    if (!verification)
      throw new Error('认证申请不存在')
    if (verification.status !== 'pending')
      throw new Error('该认证申请已经处理')

    verification.status = 'rejected'
    verification.reply = reason.trim() || '材料不足，审核费不返还。'
    verification.reviewedAt = now()
  }

  function adjustUserPoints(userId: string, amount: number, reason: string) {
    assertAdmin(currentUser.value)
    if (!Number.isFinite(amount) || amount === 0)
      throw new Error('请输入非零积分调整值')

    addTransaction(userId, Math.trunc(amount), 'adjustment', reason.trim() || '管理员手动调整')
  }

  function resetDemo() {
    if (typeof window !== 'undefined')
      window.localStorage.removeItem(STORAGE_KEY)

    Object.assign(state, defaultState())
  }

  return {
    state,
    hasAdmin,
    currentUser,
    currentUserApplications,
    currentStudentVerifications,
    isAdmin,
    oauthReady,
    pendingProApplications,
    pendingStudentVerifications,
    totalReservedApplications,
    activeProCount,
    userName,
    userEmail,
    createAdmin,
    loginAsAdmin,
    mockOauthLogin,
    logout,
    updateCurrentProfile,
    mockGithubRepos,
    rechargeCurrentUser,
    submitApplication,
    answerProApplication,
    rejectProApplication,
    submitStudentVerification,
    approveStudentVerification,
    rejectStudentVerification,
    adjustUserPoints,
    resetDemo,
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
