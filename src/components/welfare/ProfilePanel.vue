<script setup lang="ts">
import { TxButton, TxCard, TxInput, TxStatusBadge, TxTextarea } from '@talex-touch/tuffex'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  currentUser,
  repoOptions,
  profileForm,
  latestTransactions,
  updateCurrentProfile,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function saveProfile() {
  runSafely(() => updateCurrentProfile({
    displayName: profileForm.displayName,
    email: profileForm.email,
    bio: profileForm.bio,
    githubUsername: profileForm.githubUsername,
    selectedRepo: profileForm.selectedRepo,
  }), '个人信息已更新')
}
</script>

<template>
  <section class="gap-6 grid xl:grid-cols-[1fr_360px]">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <h2 class="text-3xl fw-900 tracking-tight">
        个人信息与开源认证
      </h2>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        用户可以编辑资料、关联 GitHub 并选择仓库。后续提交申请时会自动携带开源认证标签。
      </p>
      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可编辑个人资料。
      </div>
      <div v-else class="mt-6 gap-5 grid md:grid-cols-2">
        <label class="gap-2 grid">
          <span class="field-label">显示名称</span>
          <TxInput v-model="profileForm.displayName" />
        </label>
        <label class="gap-2 grid">
          <span class="field-label">邮箱</span>
          <TxInput v-model="profileForm.email" type="email" />
        </label>
        <label class="gap-2 grid md:col-span-2">
          <span class="field-label">个人简介</span>
          <TxTextarea v-model="profileForm.bio" :rows="4" placeholder="你的公益方向、技能栈、所在组织等" />
        </label>
        <label class="gap-2 grid">
          <span class="field-label">GitHub 用户名</span>
          <TxInput v-model="profileForm.githubUsername" placeholder="talex-touch">
            <template #prefix>
              <span class="i-carbon-logo-github" />
            </template>
          </TxInput>
        </label>
        <label class="gap-2 grid">
          <span class="field-label">默认关联仓库</span>
          <select v-model="profileForm.selectedRepo" class="px-4 outline-none border border-black/10 rounded-2xl bg-white min-h-11 dark:border-white/10 dark:bg-[#151820]">
            <option value="">
              暂不选择
            </option>
            <option v-for="repo in repoOptions" :key="repo" :value="repo">
              {{ repo }}
            </option>
          </select>
        </label>
        <div class="p-5 rounded-3xl bg-slate-100 flex flex-wrap gap-3 items-center justify-between dark:bg-[#151820] md:col-span-2">
          <div>
            <div class="fw-900">
              开源认证标签
            </div>
            <div class="text-sm text-slate-500 mt-1 dark:text-slate-400">
              已关联 GitHub 与仓库后，申请会显示“开源认证”。
            </div>
          </div>
          <TxStatusBadge :text="profileForm.githubUsername && profileForm.selectedRepo ? '可携带' : '未完成'" :status="profileForm.githubUsername && profileForm.selectedRepo ? 'success' : 'warning'" />
        </div>
        <div class="md:col-span-2">
          <TxButton variant="primary" @click="saveProfile">
            保存个人信息
          </TxButton>
        </div>
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        积分流水
      </h3>
      <div class="mt-4 space-y-3">
        <div v-if="!latestTransactions.length" class="text-sm text-slate-500">
          暂无流水
        </div>
        <div v-for="tx in latestTransactions" :key="tx.id" class="p-4 rounded-2xl bg-white flex gap-4 items-start justify-between dark:bg-[#151820]">
          <div>
            <div class="text-sm fw-800">
              {{ tx.reason }}
            </div>
            <div class="text-xs text-slate-500 mt-1">
              {{ formatDate(tx.createdAt) }} · {{ formatPoints(Math.abs(tx.delta)) }}
            </div>
          </div>
          <div class="fw-900" :class="tx.delta > 0 ? 'text-emerald-600' : 'text-rose-500'">
            {{ tx.delta > 0 ? '+' : '' }}{{ tx.delta }}
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
