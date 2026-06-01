<script setup lang="ts">
import { FileUploader, TxButton, TxCard, TxInput, TxStatusBadge, TxTextarea } from '@talex-touch/tuffex'
import { useWelfareFeedback } from '~/composables/feedback'
import {
  formatBytes,
  formatDate,
  MAX_ATTACHMENT_BYTES,
  STUDENT_REVIEW_FEE,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  currentUser,
  currentStudentVerifications,
  isAdmin,
  studentForm,
  studentFiles,
  totalStudentBytes,
  submitStudentVerification,
  resetStudentFiles,
  statusText,
  statusTone,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function onSubmitStudentVerification() {
  runSafely(() => {
    submitStudentVerification({
      ...studentForm,
      attachments: studentFiles.value,
    })
    resetStudentFiles()
  }, '学生认证已提交，审核将先扣除 10 积分')
}
</script>

<template>
  <section class="gap-6 grid xl:grid-cols-[1fr_360px]">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            学生认证
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            用户可提交任意类目信息与材料等待审核。为了避免反复无效审核，每次审核先扣 {{ STUDENT_REVIEW_FEE }} 积分；成功后返还。
          </p>
        </div>
        <TxStatusBadge :text="currentUser?.profile.studentVerified ? '已认证' : '未认证'" :status="currentUser?.profile.studentVerified ? 'success' : 'warning'" />
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可以申请学生认证。
      </div>
      <div v-else-if="isAdmin" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        管理员请在后台审核学生认证。
      </div>
      <div v-else class="mt-6 gap-5 grid md:grid-cols-2">
        <label class="gap-2 grid">
          <span class="field-label">认证类目</span>
          <TxInput v-model="studentForm.category" placeholder="学生 / 社团 / 开源贡献者" />
        </label>
        <label class="gap-2 grid">
          <span class="field-label">学校 / 组织</span>
          <TxInput v-model="studentForm.school" placeholder="可选" />
        </label>
        <label class="gap-2 grid md:col-span-2">
          <span class="field-label">身份信息</span>
          <TxInput v-model="studentForm.identity" placeholder="年级、专业、校园邮箱等，可选" />
        </label>
        <label class="gap-2 grid md:col-span-2">
          <span class="field-label">材料说明</span>
          <TxTextarea v-model="studentForm.notes" :rows="5" placeholder="说明你提交的材料，以及希望证明的身份。" />
        </label>
        <div class="md:col-span-2">
          <div class="mb-2 flex gap-3 items-center justify-between">
            <span class="field-label">证明材料</span>
            <span class="field-hint">{{ formatBytes(totalStudentBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
          </div>
          <FileUploader v-model="studentFiles" :max="12" button-text="上传材料" drop-text="拖拽证明材料" hint-text="支持任意材料，总大小 200MB 内" />
        </div>
        <div class="text-sm text-amber-800 leading-6 p-5 border border-amber-400/25 rounded-3xl bg-amber-50 dark:text-amber-200 md:col-span-2">
          提交后会立即扣除 {{ STUDENT_REVIEW_FEE }} 积分作为审核费；如果审核通过，系统自动返还这 {{ STUDENT_REVIEW_FEE }} 积分。
        </div>
        <div class="md:col-span-2">
          <TxButton variant="primary" @click="onSubmitStudentVerification">
            提交学生认证
          </TxButton>
        </div>
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        认证记录
      </h3>
      <div class="mt-4 space-y-3">
        <div v-if="!currentStudentVerifications.length" class="text-sm text-slate-500 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无认证申请
        </div>
        <div v-for="item in currentStudentVerifications" :key="item.id" class="p-4 border border-black/8 rounded-2xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex gap-3 items-start justify-between">
            <div>
              <b>{{ item.category }}</b>
              <div class="text-xs text-slate-500 mt-1">
                {{ formatDate(item.createdAt) }} · 审核费 {{ item.reviewFee }}
              </div>
            </div>
            <TxStatusBadge :text="statusText(item.status)" :status="statusTone(item.status)" size="sm" />
          </div>
          <p class="text-sm text-slate-600 leading-6 mt-3 dark:text-slate-300">
            {{ item.notes }}
          </p>
          <div v-if="item.reply" class="text-sm leading-6 mt-3 p-3 rounded-xl bg-slate-100 dark:bg-[#151820]">
            {{ item.reply }}
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
