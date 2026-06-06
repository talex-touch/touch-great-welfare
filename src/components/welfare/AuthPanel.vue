<script setup lang="ts">
import { TxAvatar, TxButton, TxCheckbox, TxInput, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { pricingSummary, useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'

const route = useRoute()
const router = useRouter()
const isBootstrapRoute = computed(() => route.path === '/init')
const redirectPath = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect !== 'string' || !redirect.startsWith('/'))
    return undefined

  if (redirect.startsWith('//') || redirect.startsWith('/login') || redirect.startsWith('/init'))
    return undefined

  return redirect
})

const {
  hasAdmin,
  currentUser,
  isAdmin,
  githubAppConfigForm,
  publicOAuthProviders,
  oauthLoginForm,
  adminForm,
  selectedSection,
  createAdmin,
  loginAsAdmin,
  startGitHubLogin,
  startOAuthLogin,
  refreshGitHubAppConfig,
  refreshOAuthProviders,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const isUserConsentDialogOpen = ref(false)
const hasUserConsent = ref(false)
const pendingLoginSource = ref<{ type: 'github' | 'oauth', providerId?: string, label: string }>({
  type: 'github',
  label: 'GitHub App',
})
const githubLoginReady = computed(() => githubAppConfigForm.enabled && githubAppConfigForm.configured)
const loginSourceCount = computed(() => publicOAuthProviders.value.length + (githubLoginReady.value ? 1 : 0))

function onCreateAdmin() {
  runSafely(() => {
    createAdmin(adminForm)
    router.push(redirectPath.value ?? '/dashboard/admin')
  }, '管理员已创建，已进入后台')
}

function onOauthLogin(source = pendingLoginSource.value) {
  runSafely(async () => {
    if (source.type === 'oauth' && source.providerId) {
      await startOAuthLogin(source.providerId, redirectPath.value ?? '/dashboard/apply')
      return
    }
    await startGitHubLogin(redirectPath.value ?? '/dashboard/apply')
  }, `正在跳转 ${source.label} 授权`)
}

function openUserConsentDialog(source: { type: 'github' | 'oauth', providerId?: string, label: string }) {
  pendingLoginSource.value = source
  hasUserConsent.value = false
  isUserConsentDialogOpen.value = true
}

function closeUserConsentDialog() {
  isUserConsentDialogOpen.value = false
}

function confirmOauthLogin() {
  if (!hasUserConsent.value)
    return

  closeUserConsentDialog()
  onOauthLogin()
}

function onLoginAsAdmin() {
  runSafely(() => {
    loginAsAdmin()
    router.push(redirectPath.value ?? '/dashboard/admin')
  }, '已切换到管理员')
}

function goDashboard(section: 'admin' | 'apply' | 'profile' | 'wallet') {
  selectedSection.value = section
  router.push(`/dashboard/${section}`)
}

onMounted(() => {
  refreshGitHubAppConfig().catch(() => {})
  refreshOAuthProviders().catch(() => {})
})
</script>

<template>
  <div class="w-full">
    <div v-if="!hasAdmin" class="space-y-5">
      <div>
        <div class="text-2xl fw-900">
          首次访问：创建管理员
        </div>
      </div>
      <label class="gap-2 grid">
        <span class="field-label">管理员名称</span>
        <TxInput v-model="adminForm.displayName" placeholder="公益管理员" />
      </label>
      <label class="gap-2 grid">
        <span class="field-label">管理员邮箱</span>
        <TxInput v-model="adminForm.email" type="email" placeholder="admin@example.com" />
      </label>
      <TxButton block variant="primary" size="lg" @click="onCreateAdmin">
        创建管理员
      </TxButton>
    </div>

    <div v-else-if="!currentUser" class="space-y-5">
      <div>
        <TxStatusBadge v-if="isBootstrapRoute" text="已完成初始化" status="success" class="mb-3" />
        <div class="flex gap-3 items-center justify-between">
          <div class="text-2xl fw-900">
            账号登录
          </div>
          <TxStatusBadge :text="loginSourceCount ? `${loginSourceCount} 个登录源` : '未配置'" :status="loginSourceCount ? 'success' : 'warning'" />
        </div>
        <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
          系统已创建管理员账号；请从这里登录，/init 仅用于首次初始化。
        </p>
      </div>
      <div v-if="!loginSourceCount" class="text-sm text-amber-800 leading-6 p-4 border border-amber-400/30 rounded-2xl bg-amber-50 dark:text-amber-200">
        请先使用管理员进入后台配置 GitHub App 或 OAuth/OIDC 登录源，普通用户才能授权登录。
      </div>
      <DataNotice mode="compact" title="注册登录前请确认" />
      <div class="gap-3 grid sm:grid-cols-2">
        <TxButton block variant="primary" :disabled="!githubLoginReady" @click="openUserConsentDialog({ type: 'github', label: 'GitHub App' })">
          <span class="i-carbon-logo-github" />
          GitHub App 授权登录
        </TxButton>
        <TxButton
          v-for="provider in publicOAuthProviders"
          :key="provider.id"
          block
          variant="secondary"
          :disabled="!!oauthLoginForm.loadingProviderId"
          @click="openUserConsentDialog({ type: 'oauth', providerId: provider.id, label: provider.name })"
        >
          <span class="i-carbon-login" />
          {{ provider.name }}
        </TxButton>
        <TxButton block variant="secondary" @click="onLoginAsAdmin">
          管理员后台
        </TxButton>
      </div>
    </div>

    <div v-else class="space-y-5">
      <div class="flex gap-4 items-start">
        <TxAvatar :name="currentUser.profile.displayName" :src="currentUser.profile.avatar" size="large" status="online" />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <div class="text-2xl fw-900 truncate">
              {{ currentUser.profile.displayName }}
            </div>
            <TxTag v-if="currentUser.role === 'admin'" label="Admin" color="#0f172a" background="rgba(52,211,153,.22)" />
            <TxTag v-if="currentUser.profile.studentVerified" label="学生认证" color="#047857" background="rgba(16,185,129,.14)" />
          </div>
          <div class="text-sm text-slate-500 mt-1 truncate dark:text-slate-400">
            {{ currentUser.profile.email }}
          </div>
        </div>
      </div>
      <div class="text-white p-5 rounded-3xl bg-slate-950 dark:text-slate-950 dark:bg-white">
        <div class="text-sm op70">
          可用积分
        </div>
        <div class="text-4xl fw-900 mt-1">
          {{ currentUser.points.toLocaleString('zh-CN') }}
        </div>
        <div class="text-xs mt-3 op70">
          LLMApi 仅可选 Codex / ClaudeCode / Mimo；{{ pricingSummary.activityName }}：Image {{ pricingSummary.currentRequestCost.image }} / Pro {{ pricingSummary.currentRequestCost.pro }}；学生认证审核扣 {{ pricingSummary.studentReviewFee }}，成功返还。
        </div>
      </div>
      <div class="gap-3 grid sm:grid-cols-2">
        <TxButton block variant="secondary" @click="goDashboard('apply')">
          提交公益申请
        </TxButton>
        <TxButton block variant="ghost" @click="goDashboard('profile')">
          完善个人信息
        </TxButton>
      </div>
      <TxButton v-if="!isAdmin" block variant="ghost" @click="goDashboard('wallet')">
        私人钱包
      </TxButton>
    </div>

    <Teleport to="body">
      <Transition name="dialog-shell">
        <div v-if="isUserConsentDialogOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeUserConsentDialog">
          <div class="dialog-surface solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-3xl w-full overflow-auto">
            <div class="flex gap-4 items-start justify-between">
              <div>
                <h3 class="text-2xl fw-900 tracking-tight">
                  注册登录确认
                </h3>
                <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                  首次 {{ pendingLoginSource.label }} 授权会创建账号并同步公开资料；再次登录会更新最后登录时间。
                </p>
              </div>
              <button class="icon-btn shrink-0" title="关闭" @click="closeUserConsentDialog">
                <span class="i-carbon-close" />
              </button>
            </div>

            <div class="mt-6 space-y-5">
              <DataNotice mode="full" title="注册、登录与数据处理免责说明" />
              <label class="consent-check">
                <TxCheckbox v-model="hasUserConsent" variant="checkmark" aria-label="同意注册登录与数据处理免责说明" />
                <span>我确认以上信息均由我自愿提供，并理解确认登录即视为同意云端保存、7 天保留、免费服务限制和保密材料自理等说明。</span>
              </label>
              <div class="flex flex-wrap gap-3 justify-end">
                <TxButton variant="ghost" @click="closeUserConsentDialog">
                  取消
                </TxButton>
                <TxButton variant="primary" :disabled="!hasUserConsent" @click="confirmOauthLogin">
                  确认并跳转 {{ pendingLoginSource.label }}
                </TxButton>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
