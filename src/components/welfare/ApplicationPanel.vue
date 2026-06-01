<script setup lang="ts">
import { TxButton, TxCard, TxFileUploader, TxInput, TxStatusBadge, TxTag, TxTextarea } from '@talex-touch/tuffex'
import { useWelfareFeedback } from '~/composables/feedback'
import {
  formatBytes,
  formatDate,
  MAX_ACTIVE_PRO_APPLICATIONS,
  MAX_ATTACHMENT_BYTES,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  currentUser,
  currentUserApplications,
  isAdmin,
  repoOptions,
  applicationForm,
  applicationFiles,
  applicationTypeCards,
  totalApplicationBytes,
  proActiveCount,
  canSubmitPro,
  selectedCost,
  submitApplication,
  resetApplicationFiles,
  statusText,
  statusTone,
  typeIcon,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function onSubmitApplication() {
  runSafely(() => {
    submitApplication({
      type: applicationForm.type,
      title: applicationForm.title,
      description: applicationForm.description,
      githubRepo: applicationForm.githubRepo,
      attachments: applicationFiles.value,
    })
    resetApplicationFiles()
  }, applicationForm.type === 'pro' ? 'Pro 申请已提交，等待管理员审核' : '申请已提交并扣除积分')
}
</script>

<template>
  <section class="gap-6 grid xl:grid-cols-[1fr_360px]">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            提交公益申请
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            Pro 支持附件、图片、文本等资料，总大小限制 200MB；一个用户同时最多 3 个待审核 Pro 申请。
          </p>
        </div>
        <TxStatusBadge :text="`余额 ${currentUser?.points ?? 0}`" status="info" />
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        请先登录后提交申请。
      </div>
      <div v-else-if="isAdmin" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        管理员账号用于审核，请切换普通用户提交申请。
      </div>
      <div v-else class="mt-6 space-y-6">
        <div class="gap-4 grid md:grid-cols-3">
          <button
            v-for="item in applicationTypeCards"
            :key="item.type"
            class="p-5 text-left border rounded-3xl transition"
            :class="applicationForm.type === item.type ? 'border-emerald-400 bg-emerald-50 shadow-lg shadow-emerald-500/10' : 'border-black/8 bg-white hover:border-slate-400 dark:border-white/10 dark:bg-[#151820]'"
            @click="applicationForm.type = item.type"
          >
            <div class="flex items-center justify-between">
              <span class="text-2xl" :class="item.icon" />
              <b>{{ item.cost }} 积分</b>
            </div>
            <div class="text-lg fw-900 mt-4">
              {{ item.title }}
            </div>
            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
              {{ item.desc }}
            </p>
          </button>
        </div>

        <div class="gap-5 grid md:grid-cols-2">
          <label class="gap-2 grid md:col-span-2">
            <span class="field-label">申请标题</span>
            <TxInput v-model="applicationForm.title" placeholder="描述你需要的公益支持" />
          </label>
          <label class="gap-2 grid md:col-span-2">
            <span class="field-label">详细说明</span>
            <TxTextarea v-model="applicationForm.description" :rows="6" :max-length="1200" show-count placeholder="请说明背景、用途、希望获得的帮助，以及公益属性。" />
          </label>
          <label class="gap-2 grid md:col-span-2">
            <span class="field-label">关联 GitHub 仓库</span>
            <select v-model="applicationForm.githubRepo" class="px-4 outline-none border border-black/10 rounded-2xl bg-white min-h-11 dark:border-white/10 dark:bg-[#151820]">
              <option value="">
                不关联仓库
              </option>
              <option v-for="repo in repoOptions" :key="repo" :value="repo">
                {{ repo }}
              </option>
            </select>
            <span class="field-hint">在个人信息里关联 GitHub 并选择仓库后，提交时会携带“开源认证”标签。</span>
          </label>
          <div class="md:col-span-2">
            <div class="mb-2 flex gap-3 items-center justify-between">
              <span class="field-label">附件 / 图片 / 文本资料</span>
              <span class="field-hint">{{ formatBytes(totalApplicationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
            </div>
            <TxFileUploader v-model="applicationFiles" :max="20" button-text="选择资料" drop-text="拖拽资料到这里" hint-text="总大小需控制在 200MB 内" />
          </div>
        </div>

        <div class="text-white p-5 rounded-3xl bg-slate-950 dark:text-slate-950 dark:bg-white">
          <div class="flex flex-wrap gap-3 items-center justify-between">
            <div>
              <div class="text-sm op70">
                本次规则
              </div>
              <div class="text-xl fw-900 mt-1">
                {{ applicationForm.type.toUpperCase() }} · {{ selectedCost }} 积分
              </div>
              <div class="text-xs mt-2 op70">
                <template v-if="applicationForm.type === 'pro'">
                  审核给出答复后才扣除；退回不扣除。当前待审核 Pro：{{ proActiveCount }}/{{ MAX_ACTIVE_PRO_APPLICATIONS }}。
                </template>
                <template v-else>
                  当前为预留入口，提交后立即扣除积分并进入记录。
                </template>
              </div>
            </div>
            <TxButton variant="primary" :disabled="applicationForm.type === 'pro' && !canSubmitPro" @click="onSubmitApplication">
              提交申请
            </TxButton>
          </div>
        </div>
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        我的申请
      </h3>
      <div class="mt-4 space-y-3">
        <div v-if="!currentUserApplications.length" class="text-sm text-slate-500 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无申请记录
        </div>
        <div v-for="item in currentUserApplications" :key="item.id" class="p-4 border border-black/8 rounded-2xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <div class="flex gap-2 items-center">
                <span :class="typeIcon(item.type)" />
                <b class="truncate">{{ item.title }}</b>
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ formatDate(item.createdAt) }} · {{ item.cost }} 积分
              </div>
            </div>
            <TxStatusBadge :text="statusText(item.status)" :status="statusTone(item.status)" size="sm" />
          </div>
          <div class="text-sm text-slate-600 leading-6 mt-3 line-clamp-3 dark:text-slate-300">
            {{ item.description }}
          </div>
          <div v-if="item.hasOpenSourceBadge" class="mt-3">
            <TxTag label="开源认证" color="#0369a1" background="rgba(14,165,233,.14)" />
          </div>
          <div v-if="item.answer" class="text-sm leading-6 mt-3 p-3 rounded-xl bg-slate-100 dark:bg-[#151820]">
            {{ item.answer }}
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
