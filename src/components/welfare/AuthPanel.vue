<script setup lang="ts">
import { TxAvatar, TxButton, TxCard, TxInput, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'

const router = useRouter()

const {
  hasAdmin,
  currentUser,
  isAdmin,
  oauthReady,
  adminForm,
  loginForm,
  rechargeForm,
  selectedSection,
  createAdmin,
  loginAsAdmin,
  mockOauthLogin,
  rechargeCurrentUser,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function onCreateAdmin() {
  runSafely(() => createAdmin(adminForm), '管理员已创建，已进入后台')
}

function onOauthLogin() {
  runSafely(() => mockOauthLogin(loginForm), 'OAuth 登录成功')
}

function onLoginAsAdmin() {
  runSafely(() => loginAsAdmin(), '已切换到管理员')
}

function onRecharge() {
  runSafely(() => rechargeCurrentUser(rechargeForm.amount), '积分充值已模拟到账')
}

function goDashboard(section: 'admin' | 'apply' | 'profile') {
  selectedSection.value = section
  router.push(`/dashboard/${section}`)
}
</script>

<template>
  <TxCard class="solid-panel" background="pure" shadow="medium" :padding="24" :radius="32">
    <div v-if="!hasAdmin" class="space-y-5">
      <div>
        <div class="text-2xl fw-900">
          首次访问：创建管理员
        </div>
        <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
          系统检测到没有管理员。第一个访问者需要创建后台账号，后续可配置 OAuth 与审核队列。
        </p>
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
        <div class="flex gap-3 items-center justify-between">
          <div class="text-2xl fw-900">
            OAuth 登录入口
          </div>
          <TxStatusBadge :text="oauthReady ? '已配置' : '未配置'" :status="oauthReady ? 'success' : 'warning'" />
        </div>
        <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
          当前为前端原型：OAuth 按钮会模拟授权登录。真实环境只需把此处替换为后端授权跳转。
        </p>
      </div>
      <div v-if="!oauthReady" class="text-sm text-amber-800 leading-6 p-4 border border-amber-400/30 rounded-2xl bg-amber-50 dark:text-amber-200">
        请先使用管理员进入后台配置 OAuth Client ID，普通用户才能登录。
      </div>
      <label class="gap-2 grid">
        <span class="field-label">显示名称</span>
        <TxInput v-model="loginForm.displayName" placeholder="你的名字" />
      </label>
      <label class="gap-2 grid">
        <span class="field-label">邮箱</span>
        <TxInput v-model="loginForm.email" type="email" placeholder="you@example.com" />
      </label>
      <div class="gap-3 grid sm:grid-cols-2">
        <TxButton block variant="primary" :disabled="!oauthReady" @click="onOauthLogin">
          <span class="i-carbon-logo-github" />
          使用 OAuth 登录
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
          Code 1 / Image 10 / Pro 审核通过后 100；学生认证审核扣 10，成功返还。
        </div>
      </div>
      <div v-if="!isAdmin" class="gap-3 grid sm:grid-cols-[1fr_auto]">
        <TxInput v-model="rechargeForm.amount" type="number" placeholder="充值积分" />
        <TxButton variant="primary" @click="onRecharge">
          充值预留
        </TxButton>
      </div>
      <div class="gap-3 grid sm:grid-cols-2">
        <TxButton block variant="secondary" @click="goDashboard(isAdmin ? 'admin' : 'apply')">
          {{ isAdmin ? '进入审核后台' : '提交公益申请' }}
        </TxButton>
        <TxButton block variant="ghost" @click="goDashboard('profile')">
          完善个人信息
        </TxButton>
      </div>
    </div>
  </TxCard>
</template>
