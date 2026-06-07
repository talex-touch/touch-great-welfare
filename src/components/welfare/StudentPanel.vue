<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge } from '@talex-touch/tuffex'
import { useRouter } from 'vue-router'
import {
  formatDate,
  formatRetentionExpiry,
  STUDENT_REVIEW_FEE,
  verificationOrganizationLabel,
  verificationTypeLabel,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import ReviewQueues from './ReviewQueues.vue'
import RichTextView from './RichTextView.vue'

const {
  currentUser,
  currentStudentVerifications,
  statusText,
  statusTone,
} = useWelfareUiState()

const router = useRouter()

function goCreateStudentVerification() {
  router.push('/dashboard/verification')
}

function verificationStatusText(status: string) {
  return status === 'pending' ? '处理中' : statusText(status)
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            认证申请
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            学生认证和一线认证只用于提高申请通过率和审核优先级，不是提交资源申请的前置条件。为了避免反复无效审核，每次审核先扣 {{ STUDENT_REVIEW_FEE }} 积分；成功后返还。
          </p>
        </div>
        <div class="flex flex-wrap gap-3 items-center">
          <TxStatusBadge :text="currentUser?.profile.studentVerified ? '学生已认证' : '待认证'" :status="currentUser?.profile.studentVerified ? 'success' : 'warning'" />
          <TxButton variant="primary" :disabled="!currentUser" @click="goCreateStudentVerification">
            <span class="i-carbon-add" />
            选择认证
          </TxButton>
        </div>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可以申请认证。
      </div>
      <div v-else class="mt-6">
        <div v-if="!currentStudentVerifications.length" class="text-sm text-slate-500 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无认证申请
        </div>
        <div v-else class="border border-black/8 rounded-3xl overflow-hidden dark:border-white/10">
          <div class="text-xs text-slate-500 fw-800 px-5 py-3 bg-slate-50 gap-4 grid-cols-[1fr_140px_130px] hidden dark:text-slate-400 dark:bg-white/5 md:grid">
            <span>认证内容</span>
            <span>审核费</span>
            <span class="text-right">状态</span>
          </div>
          <div
            v-for="item in currentStudentVerifications"
            :key="item.id"
            class="px-5 py-4 border-t border-black/8 gap-3 grid transition dark:border-white/10 hover:bg-slate-50 md:grid-cols-[1fr_140px_130px] md:items-center dark:hover:bg-white/5"
            role="button"
            tabindex="0"
            @click="router.push(`/dashboard/student/${item.id}`)"
            @keydown.enter.prevent="router.push(`/dashboard/student/${item.id}`)"
            @keydown.space.prevent="router.push(`/dashboard/student/${item.id}`)"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <b>{{ item.realName }} · {{ verificationTypeLabel(item.verificationType) }} · {{ item.category }}</b>
                <span v-if="item.school" class="text-xs text-slate-500">{{ verificationOrganizationLabel(item.verificationType) }}：{{ item.school }}</span>
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ formatDate(item.createdAt) }}
              </div>
              <div class="text-xs text-slate-500 mt-1">
                云端记录预计保留至 {{ formatRetentionExpiry(item.createdAt) }}
              </div>
              <div v-if="item.grade || item.educationLevel || item.identity" class="text-xs text-slate-500 mt-1">
                {{ [item.grade, item.educationLevel, item.identity].filter(Boolean).join(' · ') }}
              </div>
              <div v-if="item.verificationType !== 'frontline' && item.educationEmail" class="text-xs text-slate-500 mt-1">
                教育邮箱：{{ item.educationEmail }}
              </div>
            </div>
            <div class="text-sm text-slate-600 dark:text-slate-300">
              {{ item.reviewFee }} 积分
            </div>
            <div class="md:text-right">
              <TxStatusBadge :text="verificationStatusText(item.status)" :status="statusTone(item.status)" size="sm" />
            </div>
            <div v-if="item.reply" class="text-sm leading-6 p-3 rounded-xl bg-slate-100 dark:bg-[#151820] md:col-span-3">
              {{ item.reply }}
            </div>
            <RichTextView :content="item.notes" class="rich-text-preview md:col-span-3" />
          </div>
        </div>
      </div>
    </TxCard>

    <ReviewQueues kind="student" />
  </section>
</template>
