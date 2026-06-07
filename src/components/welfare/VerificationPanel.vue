<script setup lang="ts">
import type { StudentVerification, VerificationType } from '~/composables/welfare'
import { TxButton, TxCard, TxStatusBadge, TxTabItem, TxTabs, TxTag } from '@talex-touch/tuffex'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatRetentionExpiry, STUDENT_REVIEW_FEE, verificationOrganizationLabel, verificationTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

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
  approveStudentVerification,
  rejectStudentVerification,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const activeAdminTab = ref<'pending' | 'history'>('pending')
const selectedVerificationId = ref('')
const studentApproved = computed(() => !!currentUser.value?.profile.studentVerified)
const frontlineApproved = computed(() => currentStudentVerifications.value.some(item => item.verificationType === 'frontline' && item.status === 'approved'))
const openSourceConfigured = computed(() => !!currentUser.value?.profile.githubAuthorized && !!profileForm.githubUsername && !!profileForm.selectedRepo)
const sortedStudentVerifications = computed(() => [...state.studentVerifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const pendingStudentVerifications = computed(() => sortedStudentVerifications.value.filter(item => item.status === 'pending'))
const selectedVerification = computed(() => sortedStudentVerifications.value.find(item => item.id === selectedVerificationId.value))

function latestVerification(type: VerificationType) {
  return currentStudentVerifications.value.find(item => (item.verificationType ?? 'student') === type)
}

function verificationStatusText(status: string) {
  return status === 'pending' ? '处理中' : statusText(status)
}

function verificationCardState(type: VerificationType, approved: boolean) {
  const verification = latestVerification(type)

  if (verification) {
    return {
      verification,
      statusText: verificationStatusText(verification.status),
      statusTone: statusTone(verification.status),
      actionText: verification.status === 'pending' ? '查看进度' : verification.status === 'rejected' ? '查看回复' : '查看详情',
      meta: verification.status === 'pending'
        ? `${formatDate(verification.createdAt)} 提交，等待审核回复`
        : verification.reviewedAt
          ? `${formatDate(verification.reviewedAt)} 已回复`
          : `${formatDate(verification.createdAt)} 提交`,
    }
  }

  return {
    verification: undefined,
    statusText: approved ? '已认证' : '可申请',
    statusTone: approved ? 'success' : 'available',
    actionText: '提交材料',
    meta: approved ? '认证记录已生效' : '尚未提交材料',
  }
}

const verificationCards = computed(() => [
  {
    key: 'student',
    title: '学生认证',
    icon: 'i-carbon-education',
    description: '在读学生、科研人员、教师等教育相关身份材料审核。',
    ...verificationCardState('student', studentApproved.value),
    tags: [`审核费 ${STUDENT_REVIEW_FEE}`, '通过返还'],
  },
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
    tags: ['GitHub App', '公开仓库'],
  },
] as const)

function goCard(key: string) {
  if (key === 'openSource') {
    router.push('/dashboard/open-source')
    return
  }

  const card = verificationCards.value.find(item => item.key === key)
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

function onApproveStudent(id: string) {
  runSafely(async () => {
    await approveStudentVerification(id, reviewDrafts[id] ?? '认证通过，欢迎加入公益计划。')
    delete reviewDrafts[id]
    closeVerificationDrawer()
  }, '认证申请已通过，审核积分已返还')
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
  <section class="space-y-6">
    <TxCard class="solid-panel verification-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            认证申请
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            选择需要提交或维护的认证类型；材料类认证共用人工审核和审核费返还规则。
          </p>
        </div>
        <TxStatusBadge :text="currentUser ? '已登录' : '未登录'" :status="currentUser ? 'success' : 'warning'" />
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可以提交认证申请。
      </div>

      <div v-else class="mt-6 gap-4 grid lg:grid-cols-3">
        <div
          v-for="card in verificationCards"
          :key="card.key"
          class="verification-card"
          role="button"
          tabindex="0"
          @click="goCard(card.key)"
          @keydown.enter.prevent="goCard(card.key)"
          @keydown.space.prevent="goCard(card.key)"
        >
          <div class="flex gap-3 items-start justify-between">
            <span class="verification-card__icon" :class="card.icon" />
            <span class="verification-status" :class="`verification-status--${card.statusTone}`">
              {{ card.statusText }}
            </span>
          </div>
          <div class="mt-5">
            <h3 class="text-xl fw-900">
              {{ card.title }}
            </h3>
            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
              {{ card.description }}
            </p>
          </div>
          <div class="mt-5 flex flex-wrap gap-2">
            <span v-for="tag in card.tags" :key="tag" class="verification-tag">
              {{ tag }}
            </span>
          </div>
          <div class="mt-6 flex items-center justify-between">
            <span class="text-xs text-slate-500 pr-3 min-w-0 dark:text-slate-400">
              {{ card.meta || (card.key === 'frontline' ? verificationTypeLabel('frontline') : card.title) }}
            </span>
            <TxButton size="sm" variant="secondary">
              {{ card.actionText }}
            </TxButton>
          </div>
        </div>
      </div>
    </TxCard>

    <TxCard v-if="isAdmin" class="solid-panel verification-admin-panel" background="pure" shadow="soft" :padding="0" :radius="28">
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
              <p>点击记录查看材料详情，可直接通过或退回申请。</p>
            </div>
            <TxStatusBadge :text="`${pendingStudentVerifications.length} 条待处理`" :status="pendingStudentVerifications.length ? 'warning' : 'success'" size="sm" />
          </div>
          <div class="verification-admin-list">
            <div v-if="!pendingStudentVerifications.length" class="verification-admin-empty">
              暂无待处理认证申请
            </div>
            <button
              v-for="item in pendingStudentVerifications"
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
                <TxStatusBadge text="处理中" :status="statusTone(item.status)" size="sm" />
                <small>{{ formatDate(item.createdAt) }}</small>
              </span>
            </button>
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
                <TxTag :label="`${selectedVerification.attachments.length} 个材料`" color="#854d0e" background="rgba(250,204,21,.18)" />
              </div>
            </section>

            <section class="verification-detail-section mt-4">
              <h3>材料说明</h3>
              <RichTextView :content="selectedVerification.notes" class="rich-text-preview" />
            </section>

            <section class="verification-detail-section mt-4">
              <h3>{{ selectedVerification.status === 'pending' ? '审核意见' : '审核回复' }}</h3>
              <RichTextEditor
                v-if="selectedVerification.status === 'pending'"
                v-model="reviewDrafts[selectedVerification.id]"
                :min-height="150"
                :placeholder="`审核说明：通过会返还 ${pricingSummary.studentReviewFee} 积分，退回不返还`"
              />
              <RichTextView v-else :content="selectedVerification.reply || '暂无回复。'" class="rich-text-preview" />
              <div v-if="selectedVerification.status === 'pending'" class="mt-4 flex flex-wrap gap-3">
                <TxButton variant="primary" @click="onApproveStudent(selectedVerification.id)">
                  通过并返还
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
