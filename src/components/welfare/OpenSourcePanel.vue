<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge, TxStep, TxSteps, TxTag } from '@talex-touch/tuffex'
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'

const {
  currentUser,
  repoOptions,
  profileForm,
  githubAppConfigForm,
  githubAuthorizationForm,
  updateCurrentProfile,
  refreshGitHubAppConfig,
  startGitHubAuthorization,
} = useWelfareUiState()

const route = useRoute()
const router = useRouter()
const { notify, runSafely } = useWelfareFeedback()
const isGithubAuthorized = computed(() => !!currentUser.value?.profile.githubAuthorized && !!profileForm.githubUsername)
const hasOpenSourceProfile = computed(() => isGithubAuthorized.value && !!profileForm.selectedRepo)
const configuredRepoOptions = computed(() => currentUser.value?.profile.githubRepos?.length ? currentUser.value.profile.githubRepos : repoOptions.value)
const activeStep = computed(() => {
  if (!githubAppConfigForm.configured || !githubAppConfigForm.enabled)
    return 0
  if (!isGithubAuthorized.value)
    return 1
  if (!profileForm.selectedRepo)
    return 2
  return 3
})
const authorizationStatusText = computed(() => {
  if (!currentUser.value)
    return '未登录'
  if (!githubAppConfigForm.configured || !githubAppConfigForm.enabled)
    return '未启用'
  return isGithubAuthorized.value ? '已授权' : '待授权'
})
const authorizationStatusTone = computed(() => {
  if (hasOpenSourceProfile.value)
    return 'success'
  if (!githubAppConfigForm.configured || !githubAppConfigForm.enabled)
    return 'warning'
  return 'info'
})

function authorizeGitHub() {
  runSafely(async () => {
    await startGitHubAuthorization()
  }, '正在跳转 GitHub 授权')
}

function saveDefaultRepo() {
  runSafely(async () => {
    if (!isGithubAuthorized.value)
      throw new Error('请先完成 GitHub App 授权')
    await updateCurrentProfile({
      selectedRepo: profileForm.selectedRepo,
    })
  }, '默认仓库已更新')
}

onMounted(() => {
  refreshGitHubAppConfig().catch(() => {})

  if (route.query.github_auth === 'success') {
    notify('GitHub 授权成功，已同步公开仓库')
    router.replace({ query: { ...route.query, github_auth: undefined } })
  }

  if (route.query.github_auth === 'error') {
    notify(typeof route.query.message === 'string' ? route.query.message : 'GitHub 授权失败')
    router.replace({ query: { ...route.query, github_auth: undefined, message: undefined } })
  }
})
</script>

<template>
  <section>
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            开源认证
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            通过后台配置的 GitHub App 授权账号并同步公开仓库，提交申请时携带开源认证标签；该标签只提高通过率，不是申请门槛。
          </p>
        </div>
        <div class="flex flex-wrap gap-3 items-center">
          <TxStatusBadge :text="authorizationStatusText" :status="authorizationStatusTone" />
          <TxButton variant="primary" :disabled="!currentUser || !githubAppConfigForm.enabled || !githubAppConfigForm.configured || githubAuthorizationForm.loading" @click="authorizeGitHub">
            <span class="i-carbon-logo-github" />
            {{ githubAuthorizationForm.loading ? '授权中...' : isGithubAuthorized ? '重新授权' : '授权 GitHub' }}
          </TxButton>
        </div>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可发起 GitHub App 授权。
      </div>
      <div v-else class="mt-6 space-y-5">
        <TxSteps :active="activeStep" size="small">
          <TxStep title="后台配置" description="启用 GitHub App" />
          <TxStep title="账号授权" description="跳转 GitHub 确认" />
          <TxStep title="默认仓库" description="选择公开仓库" />
          <TxStep title="申请带标" description="提交时携带认证" />
        </TxSteps>

        <DataNotice mode="compact" title="开源认证数据提示" />

        <div class="verification-submit-warning">
          开源认证是可选辅助信息。未授权 GitHub 或未选择仓库也可以正常提交申请；管理员会结合申请说明、附件和资源余量综合审核。
        </div>

        <div v-if="!githubAppConfigForm.configured || !githubAppConfigForm.enabled" class="text-sm text-amber-700 leading-6 p-6 border border-amber-400/30 rounded-2xl bg-amber-50 dark:text-amber-200 dark:bg-amber-950/20">
          管理员尚未启用 GitHub App。请先在管理后台填写 GitHub App Client ID / Secret，并将 Callback URL 配置到 GitHub App。
        </div>
        <div v-else-if="!hasOpenSourceProfile" class="text-sm text-slate-500 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无开源认证。点击“授权 GitHub”跳转到 GitHub 完成授权后，会自动同步公开仓库。
        </div>
        <div v-else class="border border-black/8 rounded-3xl overflow-hidden dark:border-white/10">
          <div class="text-xs text-slate-500 fw-800 px-5 py-3 bg-slate-50 gap-4 grid-cols-[1fr_180px_130px] hidden dark:text-slate-400 dark:bg-white/5 md:grid">
            <span>认证内容</span>
            <span>默认仓库</span>
            <span class="text-right">状态</span>
          </div>
          <div class="px-5 py-4 border-t border-black/8 gap-3 grid transition dark:border-white/10 hover:bg-slate-50 md:grid-cols-[1fr_180px_130px] md:items-center dark:hover:bg-white/5">
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="i-carbon-logo-github" />
                <b>{{ profileForm.githubUsername }}</b>
                <TxTag label="GitHub App 已授权" color="#0369a1" background="rgba(14,165,233,.14)" />
              </div>
              <div class="text-xs text-slate-500 mt-1">
                提交申请时会自动携带开源认证标签。
              </div>
            </div>
            <div class="text-sm text-slate-600 break-all dark:text-slate-300">
              {{ profileForm.selectedRepo }}
            </div>
            <div class="md:text-right">
              <TxStatusBadge text="已配置" status="success" size="sm" />
            </div>
          </div>
        </div>

        <div class="p-5 border border-black/8 rounded-3xl bg-slate-50 dark:border-white/10 dark:bg-white/5">
          <div class="flex flex-wrap gap-4 items-end justify-between">
            <label class="flex-1 gap-2 grid min-w-[220px]">
              <span class="field-label">默认关联仓库</span>
              <select v-model="profileForm.selectedRepo" class="px-4 outline-none border border-black/10 rounded-2xl bg-white min-h-11 dark:border-white/10 dark:bg-[#151820]" :disabled="!isGithubAuthorized">
                <option value="">
                  暂不选择
                </option>
                <option v-for="repo in configuredRepoOptions" :key="repo" :value="repo">
                  {{ repo }}
                </option>
              </select>
              <span class="field-hint">仓库列表来自 GitHub App 授权同步的公开仓库；请勿关联私有、涉密或未授权讨论的仓库。</span>
            </label>
            <TxButton variant="secondary" :disabled="!isGithubAuthorized" @click="saveDefaultRepo">
              保存默认仓库
            </TxButton>
          </div>
          <div v-if="githubAuthorizationForm.message" class="text-xs text-slate-500 mt-3 dark:text-slate-400">
            {{ githubAuthorizationForm.message }}
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
