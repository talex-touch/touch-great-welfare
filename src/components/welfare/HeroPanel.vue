<script setup lang="ts">
import { TxCard, TxStep, TxSteps } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { DATA_RETENTION_DAYS } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  hasAdmin,
  currentUser,
  githubAppConfigForm,
} = useWelfareUiState()

const githubReady = computed(() => githubAppConfigForm.enabled && githubAppConfigForm.configured)
</script>

<template>
  <TxCard class="solid-panel overflow-hidden" background="pure" shadow="medium" :padding="28" :radius="32" inertial>
    <div class="flex flex-col gap-8">
      <div class="flex flex-wrap gap-5 items-center justify-between">
        <div class="px-4 py-3 rounded-3xl bg-[#F2F2F0] shadow-amber-500/12 shadow-lg">
          <img src="/brand/lockup.svg" alt="领益 Link Welfare" class="h-18 w-auto">
        </div>
        <div class="text-sm text-amber-800 px-3 py-1 border border-amber-400/35 rounded-full bg-amber-50 inline-flex gap-2 w-max items-center dark:text-amber-200 dark:bg-amber-400/10">
          <span class="rounded-full bg-[#FFB000] h-2 w-2" />
          GitHub App 登录 · 积分扣除 · 公益审核流
        </div>
      </div>
      <div>
        <h1 class="text-5xl fw-900 leading-[0.95] tracking-tight max-w-4xl md:text-7xl">
          领益 Link Welfare
        </h1>
        <p class="text-lg text-slate-600 leading-8 mt-6 max-w-2xl dark:text-slate-300">
          面向公益支持的积分申请与审核平台。管理员配置 GitHub App，用户完成授权后可充值积分、提交 LLMApi / Image / Pro 申请。
        </p>
        <p class="text-sm text-slate-500 leading-6 mt-4 max-w-2xl dark:text-slate-400">
          所有申请和认证信息均由用户自愿提交，云端记录默认保留 {{ DATA_RETENTION_DAYS }} 天；平台不会出售数据，涉密科研、合同材料、生产密钥和高敏个人信息请自行脱敏或不要提交。
        </p>
      </div>
      <TxSteps :active="hasAdmin ? githubReady ? currentUser ? 3 : 2 : 1 : 0" size="small">
        <TxStep title="初始化" description="首访创建管理员" />
        <TxStep title="GitHub App" description="后台配置授权" />
        <TxStep title="用户登录" description="资料与积分" />
        <TxStep title="提交申请" description="AI 初审 / 审核流转" />
      </TxSteps>
    </div>
  </TxCard>
</template>
