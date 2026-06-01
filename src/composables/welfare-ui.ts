import type { RequestKind } from './welfare'
import { computed, reactive, ref, watch } from 'vue'
import {
  MAX_ACTIVE_PRO_APPLICATIONS,
  REQUEST_COST,
  useWelfareDemo,
} from './welfare'

export interface UploadLikeFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

const demo = useWelfareDemo()

export const adminForm = reactive({
  displayName: '公益管理员',
  email: 'admin@welfare.dev',
})

export const loginForm = reactive({
  displayName: '开源同学',
  email: 'student@example.com',
})

export const profileForm = reactive({
  displayName: '',
  email: '',
  bio: '',
  githubUsername: '',
  selectedRepo: '',
})

export const rechargeForm = reactive({
  amount: 100,
})

export const applicationForm = reactive({
  type: 'pro' as RequestKind,
  title: '公益项目架构与实现支持',
  description: '希望获得面向校园公益项目的完整技术建议、代码审阅或架构答复。',
  githubRepo: '',
})

export const applicationFiles = ref<UploadLikeFile[]>([])

export const studentForm = reactive({
  category: '在校学生 / 开源贡献者',
  school: '示例大学',
  identity: '2026 级本科生',
  notes: '可上传学生证、录取通知、校园邮箱截图或其他能说明身份的资料。',
})

export const studentFiles = ref<UploadLikeFile[]>([])

export const reviewDrafts = reactive<Record<string, string>>({})
export const pointDrafts = reactive<Record<string, number>>({})
export const selectedSection = ref<'apply' | 'profile' | 'student' | 'admin'>('apply')

export const applicationTypeCards = [
  {
    type: 'code' as const,
    title: 'Code',
    icon: 'i-carbon-code',
    cost: REQUEST_COST.code,
    desc: '代码类申请预留入口，提交后立即扣除 1 积分。',
  },
  {
    type: 'image' as const,
    title: 'Image',
    icon: 'i-carbon-image',
    cost: REQUEST_COST.image,
    desc: '图片类申请预留入口，提交后立即扣除 10 积分。',
  },
  {
    type: 'pro' as const,
    title: 'Pro',
    icon: 'i-carbon-star',
    cost: REQUEST_COST.pro,
    desc: '复杂公益需求，管理员答复通过后才扣除 100 积分。',
  },
]

export function useWelfareUiState() {
  const repoOptions = computed(() => demo.mockGithubRepos(profileForm.githubUsername))
  const totalApplicationBytes = computed(() => applicationFiles.value.reduce((sum, file) => sum + file.size, 0))
  const totalStudentBytes = computed(() => studentFiles.value.reduce((sum, file) => sum + file.size, 0))
  const proActiveCount = computed(() => demo.currentUser.value ? demo.activeProCount(demo.currentUser.value.id) : 0)
  const canSubmitPro = computed(() => proActiveCount.value < MAX_ACTIVE_PRO_APPLICATIONS)
  const selectedCost = computed(() => REQUEST_COST[applicationForm.type])
  const heroProgress = computed(() => Math.min(100, Math.round((demo.state.users.length / 12) * 100) + 24))
  const pendingCount = computed(() => demo.pendingProApplications.value.length + demo.pendingStudentVerifications.value.length)
  const latestTransactions = computed(() => demo.state.transactions.slice(0, 8))

  function syncProfileForm() {
    if (!demo.currentUser.value)
      return

    profileForm.displayName = demo.currentUser.value.profile.displayName
    profileForm.email = demo.currentUser.value.profile.email
    profileForm.bio = demo.currentUser.value.profile.bio ?? ''
    profileForm.githubUsername = demo.currentUser.value.profile.githubUsername ?? ''
    profileForm.selectedRepo = demo.currentUser.value.profile.selectedRepo ?? ''
    applicationForm.githubRepo = profileForm.selectedRepo
  }

  watch(demo.currentUser, syncProfileForm, { immediate: true })
  watch(() => profileForm.githubUsername, () => {
    if (!repoOptions.value.includes(profileForm.selectedRepo))
      profileForm.selectedRepo = repoOptions.value[0] ?? ''
  })
  watch(() => profileForm.selectedRepo, (repo) => {
    applicationForm.githubRepo = repo
  })
  watch(() => applicationForm.type, (type) => {
    if (type === 'code') {
      applicationForm.title = '代码问题快速支持'
      applicationForm.description = '请预留代码申请处理流程，后续接入真实 Code 服务。'
    }
    if (type === 'image') {
      applicationForm.title = '图片公益物料支持'
      applicationForm.description = '请预留图片申请处理流程，后续接入真实 Image 服务。'
    }
    if (type === 'pro') {
      applicationForm.title = '公益项目架构与实现支持'
      applicationForm.description = '希望获得面向校园公益项目的完整技术建议、代码审阅或架构答复。'
    }
  })

  function statusText(status: string) {
    const map: Record<string, string> = {
      reserved: '预留',
      pending_review: '待审核',
      answered: '已答复',
      rejected: '已退回',
      pending: '待审核',
      approved: '已认证',
    }
    return map[status] ?? status
  }

  function statusTone(status: string) {
    if (['answered', 'approved'].includes(status))
      return 'success'
    if (['pending_review', 'pending'].includes(status))
      return 'warning'
    if (status === 'rejected')
      return 'danger'
    return 'info'
  }

  function typeIcon(type: RequestKind) {
    return type === 'code' ? 'i-carbon-code' : type === 'image' ? 'i-carbon-image' : 'i-carbon-star'
  }

  function resetApplicationFiles() {
    applicationFiles.value = []
  }

  function resetStudentFiles() {
    studentFiles.value = []
  }

  return {
    ...demo,
    adminForm,
    loginForm,
    profileForm,
    rechargeForm,
    applicationForm,
    applicationFiles,
    studentForm,
    studentFiles,
    reviewDrafts,
    pointDrafts,
    selectedSection,
    applicationTypeCards,
    repoOptions,
    totalApplicationBytes,
    totalStudentBytes,
    proActiveCount,
    canSubmitPro,
    selectedCost,
    heroProgress,
    pendingCount,
    latestTransactions,
    statusText,
    statusTone,
    typeIcon,
    resetApplicationFiles,
    resetStudentFiles,
  }
}
