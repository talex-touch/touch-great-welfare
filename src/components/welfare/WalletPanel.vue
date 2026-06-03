<script setup lang="ts">
import { TxButton, TxCard, TxInput, TxStatusBadge } from '@talex-touch/tuffex'
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints } from '~/composables/welfare'
import { pricingSummary, useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'

const route = useRoute()

const {
  currentUser,
  rechargeForm,
  latestTransactions,
  lastRechargeStatus,
  startRecharge,
  refreshRechargeStatus,
  reloadWelfareState,
} = useWelfareUiState()

const { runSafely, notify } = useWelfareFeedback()

function recharge() {
  runSafely(() => startRecharge(), '正在跳转到 LINUX DO Credit')
}

onMounted(async () => {
  const outTradeNo = typeof route.query.recharge === 'string' ? route.query.recharge : ''
  if (!outTradeNo)
    return

  await runSafely(async () => {
    const status = await refreshRechargeStatus(outTradeNo)
    if (status.status === 'succeeded') {
      await reloadWelfareState()
      notify(`充值已到账：+${status.creditedPoints} 积分`)
      return
    }

    notify(`充值订单 ${status.status}，如已完成请稍后刷新钱包`)
  }, '充值状态已刷新')
})
</script>

<template>
  <section class="gap-6 grid xl:grid-cols-[1fr_360px]">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            私人钱包
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看个人积分余额和近期流水。
          </p>
        </div>
        <TxStatusBadge :text="`余额 ${currentUser?.points ?? 0}`" status="info" />
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可查看私人钱包。
      </div>
      <div v-else class="mt-6 space-y-6">
        <DataNotice mode="compact" title="钱包与流水提示" />
        <div class="text-white p-6 rounded-3xl bg-slate-950 dark:text-slate-950 dark:bg-white">
          <div class="text-sm op70">
            可用积分
          </div>
          <div class="text-5xl fw-900 mt-2">
            {{ currentUser.points.toLocaleString('zh-CN') }}
          </div>
          <div class="text-xs mt-3 op70">
            所有公益申请均采用预扣费制度：LLMApi 可选 Codex、ClaudeCode 及国内外模型，不同模型价格由管理员配置；超过 $100 需要更长审核，且没有延长存储服务。{{ pricingSummary.activityName }} 至 {{ formatDate(pricingSummary.activityEndsAt) }}：Image {{ pricingSummary.currentRequestCost.image }} / Pro {{ pricingSummary.currentRequestCost.pro }}。Pro 原价 {{ pricingSummary.requestCost.pro.toLocaleString('zh-CN') }}，3 天处理，加速 {{ pricingSummary.proExpediteCost }} 积分到 2 天；学生认证审核扣 {{ pricingSummary.studentReviewFee }}，成功返还。
          </div>
        </div>
        <div class="gap-3 grid sm:grid-cols-[1fr_auto]">
          <TxInput v-model="rechargeForm.amount" type="number" placeholder="充值 LDC 数量" />
          <TxButton variant="primary" :disabled="rechargeForm.loading" @click="recharge">
            {{ rechargeForm.loading ? '创建订单中...' : 'LINUX DO Credit 充值' }}
          </TxButton>
        </div>
        <div v-if="rechargeForm.statusMessage" class="text-xs text-slate-500 dark:text-slate-400">
          {{ rechargeForm.statusMessage }}
        </div>
        <div v-if="lastRechargeStatus" class="text-xs p-3 rounded-2xl bg-slate-100 dark:bg-white/10">
          最近充值订单：{{ lastRechargeStatus.outTradeNo }} · {{ lastRechargeStatus.status }} · +{{ lastRechargeStatus.creditedPoints }}
        </div>
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        积分流水
      </h3>
      <div class="mt-4 space-y-3">
        <div v-if="!latestTransactions.length" class="text-sm text-slate-500 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无流水
        </div>
        <div v-for="tx in latestTransactions" :key="tx.id" class="p-4 rounded-2xl bg-white flex gap-4 items-start justify-between dark:bg-[#151820]">
          <div>
            <div class="text-sm fw-800">
              {{ tx.reason }}
            </div>
            <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
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
