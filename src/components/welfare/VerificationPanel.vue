<script setup lang="ts">
import type { StudentVerification, VerificationType } from '~/composables/welfare'
import { TxButton, TxCard, TxInput, TxStatusBadge, TxTabItem, TxTabs, TxTag } from '@talex-touch/tuffex'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { educationEmailVerificationLabel, formatDate, formatRetentionExpiry, STUDENT_REVIEW_FEE, verificationOrganizationLabel, verificationTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'
import VerificationAttachmentGrid from './VerificationAttachmentGrid.vue'

const {
  state,
  currentUser,
  currentStudentVerifications,
  isAdmin,
  pricingSummary,
  reviewDrafts,
  statusText,
  statusTone,
  userName,
  profileForm,
  githubAppConfigForm,
  systemConfig,
  approveStudentVerification,
  requestStudentSupplement,
  rejectStudentVerification,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const activeSection = ref<'mine' | 'review'>('mine')
const activeAdminTab = ref<'pending' | 'history'>('pending')
const selectedVerificationId = ref('')
const ALL_FILTER = 'all'
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50]
const pendingFilters = reactive({
  query: '',
  from: '',
  to: '',
  verificationType: ALL_FILTER,
  status: ALL_FILTER,
  material: ALL_FILTER,
  page: 1,
  pageSize: 10,
})
const studentApproved = computed(() => !!currentUser.value?.profile.studentVerified)
const frontlineApproved = computed(() => currentStudentVerifications.value.some(item => item.verificationType === 'frontline' && item.status === 'approved'))
const openSourceConfigured = computed(() => !!currentUser.value?.profile.githubAuthorized && !!profileForm.githubUsername && !!profileForm.selectedRepo)
const sortedStudentVerifications = computed(() => [...state.studentVerifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const pendingStudentVerifications = computed(() => sortedStudentVerifications.value.filter(item => item.status === 'pending' || item.status === 'needs_supplement'))
const filteredPendingStudentVerifications = computed(() => pendingStudentVerifications.value
  .filter(item => pendingFilters.verificationType === ALL_FILTER || (item.verificationType ?? 'student') === pendingFilters.verificationType)
  .filter(item => pendingFilters.status === ALL_FILTER || item.status === pendingFilters.status)
  .filter(item => pendingFilters.material === ALL_FILTER || (
    pendingFilters.material === 'with_attachment'
      ? item.attachments.length > 0
      : pendingFilters.material === 'without_attachment'
        ? item.attachments.length === 0
        : item.educationEmailVerified
  ))
  .filter(item => isInDateRange(item.createdAt, pendingFilters))
  .filter(item => matchesQuery(pendingFilters.query, [
    item.realName,
    userName(item.userId),
    item.category,
    item.school,
    item.identity,
    item.grade,
    item.educationLevel,
    item.educationEmail,
    item.notes,
    verificationTypeLabel(item.verificationType),
    verificationOrganizationLabel(item.verificationType),
    verificationStatusText(item.status),
  ])))
const pendingPagination = computed(() => paginateRows(filteredPendingStudentVerifications.value, pendingFilters))
const selectedVerification = computed(() => sortedStudentVerifications.value.find(item => item.id === selectedVerificationId.value))

watch(isAdmin, (canReview) => {
  if (!canReview && activeSection.value === 'review')
    activeSection.value = 'mine'
})

watch(
  () => [pendingFilters.query, pendingFilters.from, pendingFilters.to, pendingFilters.verificationType, pendingFilters.status, pendingFilters.material, pendingFilters.pageSize],
  () => {
    pendingFilters.page = 1
  },
)

function latestVerification(type: VerificationType) {
  return currentStudentVerifications.value.find(item => (item.verificationType ?? 'student') === type)
}

function verificationStatusText(status: string) {
  return status === 'pending' ? '处理中' : statusText(status)
}

function dateInputTime(value: string, endOfDay = false) {
  if (!value)
    return undefined

  const time = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime()
  return Number.isNaN(time) ? undefined : time
}

function isInDateRange(value: string, filters: { from: string, to: string }) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time))
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

function paginateRows<T>(rows: T[], filters: { page: number, pageSize: number }) {
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
    totalPages,
    start,
    end,
  }
}

function previousPendingPage() {
  pendingFilters.page = Math.max(1, pendingFilters.page - 1)
}

function nextPendingPage() {
  pendingFilters.page = Math.min(pendingPagination.value.totalPages, pendingFilters.page + 1)
}

function resetPendingFilters() {
  pendingFilters.query = ''
  pendingFilters.from = ''
  pendingFilters.to = ''
  pendingFilters.verificationType = ALL_FILTER
  pendingFilters.status = ALL_FILTER
  pendingFilters.material = ALL_FILTER
  pendingFilters.page = 1
}

function verificationCardState(type: VerificationType, approved: boolean) {
  const verification = latestVerification(type)
  const config = systemConfig.value
  const toggle = config.verification[type]
  const isOpen = config.siteEnabled && toggle.enabled

  if (verification) {
    return {
      verification,
      statusText: verificationStatusText(verification.status),
      statusTone: statusTone(verification.status),
      actionText: verification.status === 'pending' ? '查看进度' : verification.status === 'needs_supplement' ? '补充资料' : verification.status === 'revoked' ? '查看原因' : verification.status === 'rejected' ? '查看回复' : '查看详情',
      meta: verification.status === 'pending'
        ? `${formatDate(verification.createdAt)} 提交，等待审核回复`
        : verification.status === 'needs_supplement'
          ? `${verification.reviewedAt ? formatDate(verification.reviewedAt) : formatDate(verification.createdAt)} 需要补充资料`
          : verification.reviewedAt
            ? `${formatDate(verification.reviewedAt)} 已回复`
            : `${formatDate(verification.createdAt)} 提交`,
      disabled: false,
    }
  }

  return {
    verification: undefined,
    statusText: approved ? '已认证' : isOpen ? '可申请' : '已关闭',
    statusTone: approved ? 'success' : isOpen ? 'available' : 'danger',
    actionText: isOpen ? '提交材料' : '暂不开放',
    meta: approved ? '认证记录已生效' : isOpen ? '尚未提交材料' : (toggle.reason || `${verificationTypeLabel(type)}暂未开放`),
    disabled: !isOpen,
  }
}

const verificationCards = computed(() => [
  {
    key: 'frontline',
    title: '一线认证',
    icon: 'i-carbon-campsite',
    description: '基层帮扶、乡村振兴、支教、驻村、公益一线相关工作人员。',
    ...verificationCardState('frontline', frontlineApproved.value),
    tags: ['基层帮扶', '乡村振兴', '支教服务'],
  },
  {
    key: 'openSource',
    title: '开源认证',
    icon: 'i-carbon-logo-github',
    description: '通过 GitHub App 授权并选择默认公开仓库，申请时携带开源标签。',
    statusText: openSourceConfigured.value ? '已配置' : githubAppConfigForm.enabled ? '待授权' : '未启用',
    statusTone: openSourceConfigured.value ? 'success' : githubAppConfigForm.enabled ? 'warning' : 'danger',
    actionText: '去授权',
    meta: openSourceConfigured.value ? `已选择 ${profileForm.selectedRepo}` : githubAppConfigForm.enabled ? '等待 GitHub App 授权' : '管理员尚未启用 GitHub App',
    verification: undefined as StudentVerification | undefined,
    disabled: false,
    tags: ['GitHub App', '公开仓库'],
  },
  {
    key: 'student',
    title: '学生认证',
    icon: 'i-carbon-education',
    description: '在读学生、科研人员、教师等教育相关身份材料审核。',
    ...verificationCardState('student', studentApproved.value),
    tags: [`审核费 ${STUDENT_REVIEW_FEE}`, '通过返还'],
  },
] as const)

function setActiveSection(section: 'mine' | 'review') {
  activeSection.value = section
}

function goCard(key: string) {
  if (key === 'openSource') {
    router.push('/dashboard/open-source')
    return
  }

  const card = verificationCards.value.find(item => item.key === key)
  if (card?.disabled)
    return

  if (card?.verification) {
    router.push(`/dashboard/student/${card.verification.id}`)
    return
  }

  router.push({
    path: '/dashboard/student/create',
    query: { type: key },
  })
}

function openVerificationDrawer(id: string) {
  selectedVerificationId.value = id
}

function closeVerificationDrawer() {
  selectedVerificationId.value = ''
}

function studentSupplementDefaultReply(verification: StudentVerification) {
  return verification.verificationType === 'frontline'
    ? '材料不足，请补充组织/单位证明、服务记录或更清晰的一线工作材料后继续审核。'
    : '材料不足，请补充教育邮箱证明或更清晰的身份材料后继续审核。'
}

function onApproveStudent(id: string) {
  runSafely(async () => {
    await approveStudentVerification(id, reviewDrafts[id] ?? '认证通过，欢迎加入公益计划。')
    delete reviewDrafts[id]
    closeVerificationDrawer()
  }, '认证申请已通过，审核积分已返还')
}

function onRequestStudentSupplement(id: string) {
  runSafely(async () => {
    const verification = sortedStudentVerifications.value.find(item => item.id === id)
    await requestStudentSupplement(id, reviewDrafts[id] ?? (verification ? studentSupplementDefaultReply(verification) : '材料不足，请补充有效证明后继续审核。'))
    delete reviewDrafts[id]
    closeVerificationDrawer()
  }, '已要求用户补充资料')
}

function onRejectStudent(id: string) {
  runSafely(async () => {
    await rejectStudentVerification(id, reviewDrafts[id] ?? '材料不足，请补充有效证明后再次申请。')
    delete reviewDrafts[id]
    closeVerificationDrawer()
  }, '认证申请已退回，审核费不返还')
}
</script>

<template>
  <section class="verification-dashboard application-dashboard space-y-6">
    <div v-if="isAdmin" class="application-dashboard__hero">
      <div class="min-w-0">
        <div class="application-dashboard__tabs" role="tablist" aria-label="认证页面切换">
          <button
            type="button"
            :class="{ 'is-active': activeSection === 'mine' }"
            @click="setActiveSection('mine')"
          >
            我的认证
          </button>
          <button
            type="button"
            :class="{ 'is-active': activeSection === 'review' }"
            @click="setActiveSection('review')"
          >
            审核队列
          </button>
        </div>
      </div>
    </div>

    <div v-if="!currentUser" class="p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
      登录后可以提交认证申请。
    </div>

    <template v-else>
      <div v-show="activeSection === 'mine'" class="verification-entry-list">
        <div class="verification-submit-warning">
          认证是可选辅助材料。未完成学生认证、一线认证或开源认证也可以正常提交申请；管理员会结合申请内容、材料完整度和资源余量综合判断。
        </div>
        <div
          v-for="card in verificationCards"
          :key="card.key"
          class="verification-card"
          :class="[`verification-card--${card.key}`, { 'is-disabled': card.disabled }]"
          role="button"
          :tabindex="card.disabled ? -1 : 0"
          @click="goCard(card.key)"
          @keydown.enter.prevent="goCard(card.key)"
          @keydown.space.prevent="goCard(card.key)"
        >
          <div class="verification-card__content">
            <div class="verification-card__copy">
              <h3>{{ card.title }}</h3>
              <p>{{ card.description }}</p>
            </div>
            <div class="verification-card__footer">
              <span>{{ card.meta || (card.key === 'frontline' ? verificationTypeLabel('frontline') : card.title) }}</span>
              <TxButton size="sm" variant="secondary" :disabled="card.disabled">
                {{ card.actionText }}
              </TxButton>
            </div>
          </div>
          <div class="verification-card__media" aria-hidden="true" />
        </div>
      </div>

      <TxCard v-if="isAdmin" v-show="activeSection === 'review'" class="solid-panel verification-admin-panel" background="pure" shadow="soft" :padding="0" :radius="28">
        <TxTabs
          v-model="activeAdminTab"
          default-value="pending"
          placement="top"
          indicator-variant="line"
          indicator-motion="glide"
          :content-padding="0"
          :content-scrollable="false"
          auto-height
          borderless
        >
          <TxTabItem name="pending" icon-class="i-carbon-time">
            <template #name>
              待处理
            </template>

            <div class="verification-admin-head">
              <div>
                <h3>待处理认证</h3>
                <p>点击记录查看材料详情，可通过、要求补充资料或最终退回。</p>
              </div>
              <TxStatusBadge :text="`${pendingStudentVerifications.length} 条待处理`" :status="pendingStudentVerifications.length ? 'warning' : 'success'" size="sm" />
            </div>
            <div class="verification-admin-tools">
              <label class="admin-filter-field admin-filter-field--wide">
                <span class="field-label">搜索</span>
                <TxInput v-model="pendingFilters.query" placeholder="姓名 / 用户 / 学校 / 邮箱 / 材料说明" prefix-icon="i-carbon-search" />
              </label>
              <label class="admin-filter-field">
                <span class="field-label">开始日期</span>
                <input v-model="pendingFilters.from" type="date" class="admin-date-input">
              </label>
              <label class="admin-filter-field">
                <span class="field-label">结束日期</span>
                <input v-model="pendingFilters.to" type="date" class="admin-date-input">
              </label>
              <label class="admin-filter-field">
                <span class="field-label">认证类型</span>
                <select v-model="pendingFilters.verificationType" class="form-select">
                  <option :value="ALL_FILTER">
                    全部类型
                  </option>
                  <option value="student">
                    学生认证
                  </option>
                  <option value="frontline">
                    一线认证
                  </option>
                </select>
              </label>
              <label class="admin-filter-field">
                <span class="field-label">状态</span>
                <select v-model="pendingFilters.status" class="form-select">
                  <option :value="ALL_FILTER">
                    全部状态
                  </option>
                  <option value="pending">
                    待审核
                  </option>
                  <option value="needs_supplement">
                    待补充资料
                  </option>
                </select>
              </label>
              <label class="admin-filter-field">
                <span class="field-label">材料</span>
                <select v-model="pendingFilters.material" class="form-select">
                  <option :value="ALL_FILTER">
                    全部材料
                  </option>
                  <option value="with_attachment">
                    有附件
                  </option>
                  <option value="without_attachment">
                    无附件
                  </option>
                  <option value="email_verified">
                    邮箱已验证
                  </option>
                </select>
              </label>
              <TxButton size="sm" variant="secondary" @click="resetPendingFilters">
                重置
              </TxButton>
            </div>
            <div class="verification-admin-list">
              <div v-if="!pendingPagination.rows.length" class="verification-admin-empty">
                {{ pendingStudentVerifications.length ? '暂无匹配的待处理认证申请' : '暂无待处理认证申请' }}
              </div>
              <button
                v-for="item in pendingPagination.rows"
                :key="item.id"
                class="verification-admin-row"
                type="button"
                @click="openVerificationDrawer(item.id)"
              >
                <span>
                  <b>{{ item.realName }} · {{ verificationTypeLabel(item.verificationType) }}</b>
                  <small>{{ userName(item.userId) }} · {{ item.category }} · {{ verificationOrganizationLabel(item.verificationType) }}：{{ item.school || '未填写' }}</small>
                </span>
                <span class="verification-admin-row__meta">
                  <TxStatusBadge :text="verificationStatusText(item.status)" :status="statusTone(item.status)" size="sm" />
                  <small>{{ formatDate(item.createdAt) }}</small>
                </span>
              </button>
            </div>
            <div class="verification-admin-pagination admin-pagination">
              <div class="text-xs text-slate-500 dark:text-slate-400">
                第 {{ pendingPagination.start }}-{{ pendingPagination.end }} 条 / 共 {{ pendingPagination.total }} 条
              </div>
              <div class="admin-pagination-controls">
                <select v-model="pendingFilters.pageSize" class="form-select admin-page-size">
                  <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">
                    {{ size }} / 页
                  </option>
                </select>
                <TxButton size="sm" variant="secondary" :disabled="pendingPagination.page <= 1" @click="previousPendingPage">
                  上一页
                </TxButton>
                <span class="text-xs text-slate-500 fw-800 dark:text-slate-400">
                  {{ pendingPagination.page }} / {{ pendingPagination.totalPages }}
                </span>
                <TxButton size="sm" variant="secondary" :disabled="pendingPagination.page >= pendingPagination.totalPages" @click="nextPendingPage">
                  下一页
                </TxButton>
              </div>
            </div>
          </TxTabItem>

          <TxTabItem name="history" icon-class="i-carbon-list-boxes">
            <template #name>
              申请历史
            </template>

            <div class="verification-admin-head">
              <div>
                <h3>认证申请历史</h3>
                <p>按提交时间倒序查看所有认证记录，点击记录打开详情。</p>
              </div>
              <TxStatusBadge :text="`${sortedStudentVerifications.length} 条记录`" status="info" size="sm" />
            </div>
            <div class="verification-admin-list">
              <div v-if="!sortedStudentVerifications.length" class="verification-admin-empty">
                暂无认证申请历史
              </div>
              <button
                v-for="item in sortedStudentVerifications"
                :key="item.id"
                class="verification-admin-row"
                type="button"
                @click="openVerificationDrawer(item.id)"
              >
                <span>
                  <b>{{ item.realName }} · {{ verificationTypeLabel(item.verificationType) }}</b>
                  <small>{{ userName(item.userId) }} · {{ item.category }} · {{ verificationOrganizationLabel(item.verificationType) }}：{{ item.school || '未填写' }}</small>
                </span>
                <span class="verification-admin-row__meta">
                  <TxStatusBadge :text="verificationStatusText(item.status)" :status="statusTone(item.status)" size="sm" />
                  <small>{{ item.reviewedAt ? `${formatDate(item.reviewedAt)} 回复` : `${formatDate(item.createdAt)} 提交` }}</small>
                </span>
              </button>
            </div>
          </TxTabItem>
        </TxTabs>
      </TxCard>
    </template>

    <Teleport to="body">
      <Transition name="admin-drawer">
        <div v-if="selectedVerification" class="admin-drawer-shell" @click.self="closeVerificationDrawer">
          <aside class="admin-user-drawer verification-review-drawer" role="dialog" aria-modal="true" aria-labelledby="verification-review-drawer-title">
            <div class="admin-drawer-header">
              <div class="min-w-0">
                <div id="verification-review-drawer-title" class="text-lg fw-900 flex gap-2 items-center">
                  <span :class="selectedVerification.verificationType === 'frontline' ? 'i-carbon-campsite' : 'i-carbon-education'" />
                  {{ selectedVerification.realName }} · {{ verificationTypeLabel(selectedVerification.verificationType) }}
                </div>
                <div class="text-sm text-slate-500 leading-6 mt-2 break-all dark:text-slate-400">
                  {{ userName(selectedVerification.userId) }} · {{ selectedVerification.category }} · {{ formatDate(selectedVerification.createdAt) }} 提交
                </div>
              </div>
              <div class="flex flex-wrap gap-2 items-center">
                <TxStatusBadge :text="verificationStatusText(selectedVerification.status)" :status="statusTone(selectedVerification.status)" />
                <TxButton size="sm" variant="secondary" aria-label="关闭认证详情" @click="closeVerificationDrawer">
                  关闭
                </TxButton>
              </div>
            </div>

            <div class="verification-review-grid mt-5">
              <div class="application-detail-stat">
                <span>{{ verificationOrganizationLabel(selectedVerification.verificationType) }}</span>
                <b>{{ selectedVerification.school || '-' }}</b>
              </div>
              <div class="application-detail-stat">
                <span>{{ selectedVerification.verificationType === 'frontline' ? '服务周期' : '年级' }}</span>
                <b>{{ selectedVerification.grade || '-' }}</b>
              </div>
              <div class="application-detail-stat">
                <span>审核费</span>
                <b>{{ selectedVerification.reviewFee || pricingSummary.studentReviewFee }} 积分</b>
              </div>
              <div class="application-detail-stat">
                <span>云端保留至</span>
                <b>{{ formatRetentionExpiry(selectedVerification.createdAt) }}</b>
              </div>
            </div>

            <section class="verification-detail-section mt-5">
              <h3>认证信息</h3>
              <div class="verification-review-tags">
                <TxTag :label="selectedVerification.identity || '未填身份'" color="#334155" background="rgba(100,116,139,.12)" />
                <TxTag v-if="selectedVerification.educationLevel" :label="selectedVerification.educationLevel" color="#315244" background="rgba(49,82,68,.12)" />
                <TxTag v-if="selectedVerification.educationEmail" :label="selectedVerification.educationEmail" color="#0369a1" background="rgba(14,165,233,.14)" />
                <TxTag v-if="selectedVerification.educationEmailVerified" :label="educationEmailVerificationLabel(selectedVerification.educationEmailVerificationSource)" color="#047857" background="rgba(16,185,129,.14)" />
                <TxTag :label="`${selectedVerification.attachments.length} 个材料`" color="#854d0e" background="rgba(250,204,21,.18)" />
              </div>
            </section>

            <section class="verification-detail-section mt-4">
              <h3>材料说明</h3>
              <RichTextView :content="selectedVerification.notes" class="rich-text-preview" />
            </section>

            <section class="verification-detail-section mt-4">
              <h3>附件材料</h3>
              <div v-if="!selectedVerification.attachments.length" class="text-sm text-slate-500 mt-3 dark:text-slate-400">
                暂无附件。
              </div>
              <VerificationAttachmentGrid v-else :files="selectedVerification.attachments" />
            </section>

            <section class="verification-detail-section mt-4">
              <h3>{{ selectedVerification.status === 'pending' ? '审核意见' : '审核回复' }}</h3>
              <RichTextEditor
                v-if="selectedVerification.status === 'pending'"
                v-model="reviewDrafts[selectedVerification.id]"
                :min-height="150"
                :placeholder="`审核说明：可通过、要求补充资料或最终退回。通过会返还 ${pricingSummary.studentReviewFee} 积分，退回不返还`"
              />
              <RichTextView v-else :content="selectedVerification.reply || '暂无回复。'" class="rich-text-preview" />
              <div v-if="selectedVerification.status === 'pending'" class="mt-4 flex flex-wrap gap-3">
                <TxButton variant="primary" @click="onApproveStudent(selectedVerification.id)">
                  通过并返还
                </TxButton>
                <TxButton variant="secondary" @click="onRequestStudentSupplement(selectedVerification.id)">
                  要求补充资料
                </TxButton>
                <TxButton variant="danger" @click="onRejectStudent(selectedVerification.id)">
                  退回
                </TxButton>
              </div>
            </section>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>
