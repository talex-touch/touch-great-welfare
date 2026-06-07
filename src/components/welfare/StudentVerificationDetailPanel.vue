<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  educationEmailVerificationLabel,
  formatDate,
  formatRetentionExpiry,
  verificationOrganizationLabel,
  verificationTypeLabel,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextView from './RichTextView.vue'
import VerificationAttachmentGrid from './VerificationAttachmentGrid.vue'

const route = useRoute()
const router = useRouter()

const {
  state,
  currentUser,
  isAdmin,
  statusText,
  statusTone,
  userName,
} = useWelfareUiState()

const verificationId = computed(() => {
  const raw = (route.params as Record<string, string | string[] | undefined>).id
  return Array.isArray(raw) ? raw[0] : String(raw ?? '')
})

const verification = computed(() => state.studentVerifications.find((item) => {
  if (item.id !== verificationId.value)
    return false

  return isAdmin.value || item.userId === currentUser.value?.id
}))

const elapsedText = computed(() => {
  if (!verification.value)
    return '-'

  const end = verification.value.reviewedAt ? new Date(verification.value.reviewedAt).getTime() : Date.now()
  const start = new Date(verification.value.createdAt).getTime()
  const elapsed = Math.max(0, end - start)
  const minutes = Math.floor(elapsed / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days} 天 ${hours % 24} 小时`
  if (hours > 0)
    return `${hours} 小时 ${minutes % 60} 分钟`
  return `${Math.max(1, minutes)} 分钟`
})

const replyText = computed(() => {
  if (!verification.value)
    return ''
  if (verification.value.reply)
    return verification.value.reply
  return verification.value.status === 'pending' ? '暂未回复，管理员处理后会在这里显示审核意见。' : '暂无回复。'
})

const verificationStatusText = computed(() => {
  if (!verification.value)
    return '-'

  return verification.value.status === 'pending' ? '处理中' : statusText(verification.value.status)
})

const progressSteps = computed(() => {
  const status = verification.value?.status
  return [
    {
      key: 'submitted',
      label: '提交申请',
      description: verification.value ? formatDate(verification.value.createdAt) : '-',
      done: !!verification.value,
      active: false,
    },
    {
      key: 'reviewing',
      label: '人工审核',
      description: status === 'pending' ? '处理中，等待管理员回复' : '已完成审核',
      done: status !== undefined,
      active: status === 'pending',
    },
    {
      key: 'replied',
      label: '审核回复',
      description: verification.value?.reviewedAt ? formatDate(verification.value.reviewedAt) : '尚未回复',
      done: status === 'approved' || status === 'rejected' || status === 'revoked' || status === 'needs_supplement',
      active: status === 'approved' || status === 'rejected' || status === 'revoked' || status === 'needs_supplement',
    },
  ]
})

function backToVerification() {
  router.push('/dashboard/verification')
}

function reapply() {
  if (!verification.value)
    return

  router.push({
    path: '/dashboard/student/create',
    query: { type: verification.value.verificationType ?? 'student' },
  })
}

function supplement() {
  if (!verification.value)
    return

  router.push({
    path: '/dashboard/student/create',
    query: {
      type: verification.value.verificationType ?? 'student',
      edit: verification.value.id,
    },
  })
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            认证进度
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看认证申请的提交时间、处理时长、审核回复和材料记录。
          </p>
        </div>
        <TxButton variant="ghost" @click="backToVerification">
          返回认证
        </TxButton>
      </div>

      <div v-if="!verification" class="mt-6 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
        认证申请不存在，或你没有权限查看该申请。
      </div>

      <div v-else class="mt-6 space-y-6">
        <div class="verification-progress-header">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="verification-card__icon" :class="verification.verificationType === 'frontline' ? 'i-carbon-campsite' : 'i-carbon-education'" />
              <div class="min-w-0">
                <h3 class="text-2xl fw-900 truncate">
                  {{ verification.realName }} · {{ verificationTypeLabel(verification.verificationType) }}
                </h3>
                <div class="text-sm text-slate-500 mt-1 dark:text-slate-400">
                  {{ verification.category }}
                  <template v-if="isAdmin">
                    · {{ userName(verification.userId) }}
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <TxStatusBadge :text="verificationStatusText" :status="statusTone(verification.status)" />
            <TxTag
              :label="verification.feeReturned ? '审核费已返还' : `审核费 ${verification.reviewFee}`"
              :color="verification.feeReturned ? '#047857' : '#854d0e'"
              :background="verification.feeReturned ? 'rgba(16,185,129,.14)' : 'rgba(250,204,21,.18)'"
            />
          </div>
        </div>

        <div class="gap-3 grid md:grid-cols-4">
          <div class="application-detail-stat">
            <span>提交时间</span>
            <b>{{ formatDate(verification.createdAt) }}</b>
          </div>
          <div class="application-detail-stat">
            <span>{{ verification.reviewedAt ? '处理用时' : '已等待' }}</span>
            <b>{{ elapsedText }}</b>
          </div>
          <div class="application-detail-stat">
            <span>审核回复</span>
            <b>{{ verification.reply ? '已回复' : '未回复' }}</b>
          </div>
          <div class="application-detail-stat">
            <span>云端保留至</span>
            <b>{{ formatRetentionExpiry(verification.createdAt) }}</b>
          </div>
        </div>

        <div class="verification-progress-steps">
          <div
            v-for="step in progressSteps"
            :key="step.key"
            class="verification-progress-step"
            :class="{ 'is-active': step.active, 'is-done': step.done && !step.active }"
          >
            <span :class="step.active ? 'i-carbon-time' : step.done ? 'i-carbon-checkmark-outline' : 'i-carbon-circle-dash'" />
            <div>
              <b>{{ step.label }}</b>
              <small>{{ step.description }}</small>
            </div>
          </div>
        </div>

        <div class="gap-4 grid lg:grid-cols-[1fr_1fr]">
          <div class="verification-detail-section">
            <h3>审核回复</h3>
            <RichTextView :content="replyText" class="rich-text-preview" />
            <div v-if="verification.status === 'needs_supplement'" class="mt-4">
              <TxButton variant="primary" @click="supplement">
                补充资料
              </TxButton>
            </div>
            <div v-else-if="verification.status === 'rejected' || verification.status === 'revoked'" class="mt-4">
              <TxButton variant="secondary" @click="reapply">
                重新提交
              </TxButton>
            </div>
          </div>

          <div class="verification-detail-section">
            <h3>认证信息</h3>
            <dl class="verification-detail-list">
              <div>
                <dt>{{ verificationOrganizationLabel(verification.verificationType) }}</dt>
                <dd>{{ verification.school || '-' }}</dd>
              </div>
              <div>
                <dt>{{ verification.verificationType === 'frontline' ? '服务周期' : '年级' }}</dt>
                <dd>{{ verification.grade || '-' }}</dd>
              </div>
              <div v-if="verification.identity || verification.educationLevel">
                <dt>身份信息</dt>
                <dd>{{ [verification.identity, verification.educationLevel].filter(Boolean).join(' · ') }}</dd>
              </div>
              <div v-if="verification.verificationType !== 'frontline' && verification.educationEmail">
                <dt>教育邮箱</dt>
                <dd>
                  {{ verification.educationEmail }}
                  <span v-if="verification.educationEmailVerified" class="text-emerald-700 fw-800 ml-2 dark:text-emerald-300">{{ educationEmailVerificationLabel(verification.educationEmailVerificationSource) }}</span>
                </dd>
              </div>
              <div>
                <dt>附件</dt>
                <dd>{{ verification.attachments.length }} 个材料</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="verification-detail-section">
          <h3>材料说明</h3>
          <RichTextView :content="verification.notes" class="rich-text-preview" />
        </div>

        <div class="verification-detail-section">
          <h3>附件材料</h3>
          <div v-if="!verification.attachments.length" class="text-sm text-slate-500 mt-3 dark:text-slate-400">
            暂无附件。
          </div>
          <VerificationAttachmentGrid v-else :files="verification.attachments" />
        </div>
      </div>
    </TxCard>
  </section>
</template>
