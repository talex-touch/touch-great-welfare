<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { STUDENT_REVIEW_FEE, verificationTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  currentUser,
  currentStudentVerifications,
  profileForm,
  githubAppConfigForm,
} = useWelfareUiState()

const router = useRouter()
const studentApproved = computed(() => !!currentUser.value?.profile.studentVerified)
const frontlineApproved = computed(() => currentStudentVerifications.value.some(item => item.verificationType === 'frontline' && item.status === 'approved'))
const openSourceConfigured = computed(() => !!currentUser.value?.profile.githubAuthorized && !!profileForm.githubUsername && !!profileForm.selectedRepo)

const verificationCards = computed(() => [
  {
    key: 'student',
    title: '学生认证',
    icon: 'i-carbon-education',
    description: '在读学生、科研人员、教师等教育相关身份材料审核。',
    statusText: studentApproved.value ? '已认证' : '可申请',
    statusTone: studentApproved.value ? 'success' : 'info',
    actionText: '提交材料',
    tags: [`审核费 ${STUDENT_REVIEW_FEE}`, '通过返还'],
  },
  {
    key: 'frontline',
    title: '一线认证',
    icon: 'i-carbon-campsite',
    description: '基层帮扶、乡村振兴、支教、驻村、公益一线相关工作人员。',
    statusText: frontlineApproved.value ? '已通过' : '可申请',
    statusTone: frontlineApproved.value ? 'success' : 'info',
    actionText: '提交材料',
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
    tags: ['GitHub App', '公开仓库'],
  },
] as const)

function goCard(key: string) {
  if (key === 'openSource') {
    router.push('/dashboard/open-source')
    return
  }

  router.push({
    path: '/dashboard/student/create',
    query: { type: key },
  })
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
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
            <TxStatusBadge :text="card.statusText" :status="card.statusTone" size="sm" />
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
            <TxTag v-for="tag in card.tags" :key="tag" :label="tag" color="#0369a1" background="rgba(14,165,233,.14)" />
          </div>
          <div class="mt-6 flex items-center justify-between">
            <span class="text-xs text-slate-500 dark:text-slate-400">
              {{ card.key === 'frontline' ? verificationTypeLabel('frontline') : card.title }}
            </span>
            <TxButton size="sm" variant="secondary">
              {{ card.actionText }}
            </TxButton>
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
