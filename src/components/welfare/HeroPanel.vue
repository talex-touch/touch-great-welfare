<script setup lang="ts">
import { TxCard, TxProgressBar, TxStatCard, TxStep, TxSteps } from '@talex-touch/tuffex'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  state,
  hasAdmin,
  currentUser,
  oauthReady,
  totalReservedApplications,
  heroProgress,
  pendingCount,
} = useWelfareUiState()
</script>

<template>
  <TxCard class="solid-panel overflow-hidden" background="pure" shadow="medium" :padding="28" :radius="32" inertial>
    <div class="flex flex-col gap-8">
      <div class="text-sm text-emerald-700 px-3 py-1 border border-emerald-400/30 rounded-full bg-emerald-50 inline-flex gap-2 w-max items-center dark:text-emerald-200">
        <span class="rounded-full bg-emerald-400 h-2 w-2" />
        OAuth 登录 · 积分扣除 · 公益审核流
      </div>
      <div>
        <h1 class="text-5xl fw-900 leading-[0.95] tracking-tight max-w-4xl md:text-7xl">
          让公益支持更克制、更透明、更高级。
        </h1>
        <p class="text-lg text-slate-600 leading-8 mt-6 max-w-2xl dark:text-slate-300">
          首次访问创建管理员，后台配置 OAuth；普通用户登录后可充值积分、提交 Code / Image / Pro 申请。Pro 与学生认证进入审核队列，审核规则和扣费时机清晰可追踪。
        </p>
      </div>
      <TxSteps :active="hasAdmin ? oauthReady ? currentUser ? 3 : 2 : 1 : 0" size="small">
        <TxStep title="初始化" description="首访创建管理员" />
        <TxStep title="OAuth" description="后台配置授权" />
        <TxStep title="用户登录" description="资料与积分" />
        <TxStep title="提交申请" description="自动或审核扣费" />
      </TxSteps>
      <div class="gap-3 grid sm:grid-cols-3">
        <TxStatCard label="注册用户" :value="state.users.length" icon-class="i-carbon-user-avatar" meta="首个用户为管理员" />
        <TxStatCard label="待审核" :value="pendingCount" icon-class="i-carbon-review" meta="Pro + 学生认证" />
        <TxStatCard label="预留申请" :value="totalReservedApplications" icon-class="i-carbon-dashboard" meta="Code / Image 入口" />
      </div>
      <TxProgressBar :percentage="heroProgress" height="8px" color="#34d399" />
    </div>
  </TxCard>
</template>
