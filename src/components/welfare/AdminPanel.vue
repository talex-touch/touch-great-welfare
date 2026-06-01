<script setup lang="ts">
import { TxButton, TxCard, TxInput, TxStatusBadge, TxTag, TxTextarea } from '@talex-touch/tuffex'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatPoints } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  state,
  isAdmin,
  pendingProApplications,
  pendingStudentVerifications,
  reviewDrafts,
  pointDrafts,
  userName,
  userEmail,
  answerProApplication,
  rejectProApplication,
  approveStudentVerification,
  rejectStudentVerification,
  adjustUserPoints,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function saveOauthConfig() {
  runSafely(() => {
    if (!isAdmin.value)
      throw new Error('需要管理员权限')
    if (!state.oauth.clientId.trim())
      throw new Error('请填写 OAuth Client ID')
    state.oauth.enabled = true
  }, 'OAuth 配置已启用')
}

function onApprovePro(id: string) {
  runSafely(() => answerProApplication(id, reviewDrafts[id] ?? ''), '已答复 Pro 申请并扣除用户积分')
}

function onRejectPro(id: string) {
  runSafely(() => rejectProApplication(id, reviewDrafts[id] ?? '材料不足或不符合公益支持范围。'), '已退回 Pro 申请，本次不扣积分')
}

function onApproveStudent(id: string) {
  runSafely(() => approveStudentVerification(id, reviewDrafts[id] ?? '认证通过，欢迎加入公益计划。'), '学生认证已通过，审核积分已返还')
}

function onRejectStudent(id: string) {
  runSafely(() => rejectStudentVerification(id, reviewDrafts[id] ?? '材料不足，请补充有效证明后再次申请。'), '学生认证已退回，审核费不返还')
}

function onAdjustPoints(userId: string) {
  runSafely(() => adjustUserPoints(userId, pointDrafts[userId] ?? 0, '后台积分充值 / 调整预留'), '积分已调整')
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            管理员后台
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            配置 OAuth、审核 Pro、审核学生认证，并预留积分充值 / 调整入口。
          </p>
        </div>
        <TxStatusBadge :text="isAdmin ? '管理员在线' : '只读预览'" :status="isAdmin ? 'success' : 'warning'" />
      </div>

      <div class="mt-6 gap-5 grid lg:grid-cols-2">
        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
            <span class="i-carbon-settings" />
            OAuth 配置
          </div>
          <div class="space-y-4">
            <label class="gap-2 grid">
              <span class="field-label">Provider</span>
              <select v-model="state.oauth.provider" class="px-4 outline-none border border-black/10 rounded-2xl bg-white min-h-11 dark:border-white/10 dark:bg-[#151820]" :disabled="!isAdmin">
                <option value="github">
                  GitHub
                </option>
                <option value="google">
                  Google
                </option>
                <option value="custom">
                  Custom
                </option>
              </select>
            </label>
            <label class="gap-2 grid">
              <span class="field-label">Client ID</span>
              <TxInput v-model="state.oauth.clientId" :disabled="!isAdmin" placeholder="OAuth Client ID" />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">Authorize URL</span>
              <TxInput v-model="state.oauth.authorizeUrl" :disabled="!isAdmin" />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">Callback URL</span>
              <TxInput v-model="state.oauth.callbackUrl" :disabled="!isAdmin" />
            </label>
            <TxButton variant="primary" :disabled="!isAdmin" @click="saveOauthConfig">
              保存并启用 OAuth
            </TxButton>
          </div>
        </div>

        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="text-lg fw-900 mb-4 flex gap-2 items-center">
            <span class="i-carbon-wallet" />
            积分系统预留
          </div>
          <div class="space-y-3">
            <div v-for="user in state.users" :key="user.id" class="p-4 rounded-2xl bg-slate-100 gap-3 grid dark:bg-[#151820] sm:grid-cols-[1fr_120px_auto] sm:items-center">
              <div class="min-w-0">
                <div class="fw-800 truncate">
                  {{ user.profile.displayName }}
                </div>
                <div class="text-xs text-slate-500 truncate">
                  {{ user.profile.email }} · {{ formatPoints(user.points) }}
                </div>
              </div>
              <TxInput v-model="pointDrafts[user.id]" type="number" :disabled="!isAdmin" placeholder="+/-" />
              <TxButton size="sm" variant="secondary" :disabled="!isAdmin" @click="onAdjustPoints(user.id)">
                调整
              </TxButton>
            </div>
          </div>
        </div>
      </div>
    </TxCard>

    <div class="gap-6 grid xl:grid-cols-2">
      <TxCard class="solid-panel" background="pure" :padding="22" :radius="28">
        <h3 class="text-2xl fw-900">
          Pro 审核队列
        </h3>
        <div class="mt-4 space-y-4">
          <div v-if="!pendingProApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
            暂无待审核 Pro 申请
          </div>
          <div v-for="item in pendingProApplications" :key="item.id" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex gap-3 items-start justify-between">
              <div class="min-w-0">
                <div class="text-lg fw-900 truncate">
                  {{ item.title }}
                </div>
                <div class="text-xs text-slate-500 mt-1">
                  {{ userName(item.userId) }} · {{ userEmail(item.userId) }} · {{ item.attachments.length }} 个附件
                </div>
              </div>
              <TxTag label="Pro 100" color="#7c2d12" background="rgba(251,146,60,.18)" />
            </div>
            <p class="text-sm text-slate-600 leading-6 mt-3 dark:text-slate-300">
              {{ item.description }}
            </p>
            <div v-if="item.githubRepo" class="text-sm mt-3 flex flex-wrap gap-2 items-center">
              <TxTag label="开源认证" color="#0369a1" background="rgba(14,165,233,.14)" />
              <span class="text-slate-500">{{ item.githubRepo }}</span>
            </div>
            <TxTextarea v-model="reviewDrafts[item.id]" class="mt-4" :rows="4" placeholder="给用户的审核答复：通过后将扣除 100 积分" />
            <div class="mt-4 flex flex-wrap gap-3">
              <TxButton variant="primary" :disabled="!isAdmin" @click="onApprovePro(item.id)">
                通过并答复
              </TxButton>
              <TxButton variant="danger" :disabled="!isAdmin" @click="onRejectPro(item.id)">
                退回不扣费
              </TxButton>
            </div>
          </div>
        </div>
      </TxCard>

      <TxCard class="solid-panel" background="pure" :padding="22" :radius="28">
        <h3 class="text-2xl fw-900">
          学生认证审核
        </h3>
        <div class="mt-4 space-y-4">
          <div v-if="!pendingStudentVerifications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
            暂无待审核学生认证
          </div>
          <div v-for="item in pendingStudentVerifications" :key="item.id" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex gap-3 items-start justify-between">
              <div>
                <div class="text-lg fw-900">
                  {{ item.category }}
                </div>
                <div class="text-xs text-slate-500 mt-1">
                  {{ userName(item.userId) }} · {{ item.school || '未填写学校' }} · {{ item.attachments.length }} 个材料
                </div>
              </div>
              <TxTag label="审核费 10" color="#854d0e" background="rgba(250,204,21,.18)" />
            </div>
            <p class="text-sm text-slate-600 leading-6 mt-3 dark:text-slate-300">
              {{ item.notes }}
            </p>
            <TxTextarea v-model="reviewDrafts[item.id]" class="mt-4" :rows="4" placeholder="审核说明：通过会返还 10 积分，退回不返还" />
            <div class="mt-4 flex flex-wrap gap-3">
              <TxButton variant="primary" :disabled="!isAdmin" @click="onApproveStudent(item.id)">
                通过并返还
              </TxButton>
              <TxButton variant="danger" :disabled="!isAdmin" @click="onRejectStudent(item.id)">
                退回
              </TxButton>
            </div>
          </div>
        </div>
      </TxCard>
    </div>
  </section>
</template>
