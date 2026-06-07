<script setup lang="ts">
import type { CreditTransaction, CreditTransactionType } from '~/composables/welfare'
import { TxButton, TxCard, TxInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate } from '~/composables/welfare'
import { pricingSummary, RECHARGE_MAX_LDC, RECHARGE_MIN_LDC, useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()

const {
  currentUser,
  rechargeForm,
  rechargeFeatureEnabled,
  systemConfig,
  latestTransactions,
  currentUserCoupons,
  currentUserDailyCheckIns,
  todayCheckIn,
  currentCheckInStreak,
  checkInToday,
  lastRechargeStatus,
  startRecharge,
  refreshRechargeStatus,
  refreshPointTransactions,
  reloadWelfareState,
} = useWelfareUiState()

const { runSafely, notify } = useWelfareFeedback()

const WALLET_TABS = {
  checkIn: '每日签到',
  coupons: '优惠券',
  transactions: '积分流水',
} as const

const RECHARGE_DEFAULT_LDC = 100

const activeWalletTab = ref(WALLET_TABS.transactions)
const isRechargeDialogOpen = ref(false)
const isPricingDialogOpen = ref(false)

const transactionTypeText: Record<CreditTransactionType, string> = {
  recharge: '充值到账',
  spend: '消费',
  refund: '返还',
  adjustment: '调整',
  grant: '系统奖励',
}

const transactionTypeClass: Record<CreditTransactionType, string> = {
  recharge: 'wallet-chip--blue',
  spend: 'wallet-chip--red',
  refund: 'wallet-chip--violet',
  adjustment: 'wallet-chip--amber',
  grant: 'wallet-chip--green',
}

const walletStats = computed(() => {
  const income = latestTransactions.value
    .filter(item => item.delta > 0)
    .reduce((sum, item) => sum + item.delta, 0)
  const outcome = latestTransactions.value
    .filter(item => item.delta < 0)
    .reduce((sum, item) => sum + Math.abs(item.delta), 0)

  return {
    income,
    outcome,
    count: latestTransactions.value.length,
  }
})

const rechargePreviewPoints = computed(() => {
  const amount = Number(rechargeForm.amount)
  if (!Number.isFinite(amount) || amount <= 0)
    return 0

  return Math.trunc(amount * 10)
})

const isRechargeAmountValid = computed(() => {
  const amount = Number(rechargeForm.amount)
  return Number.isInteger(amount) && amount >= RECHARGE_MIN_LDC && amount <= RECHARGE_MAX_LDC
})
const rechargeClosedReason = computed(() => !systemConfig.value.siteEnabled ? systemConfig.value.siteClosedReason : systemConfig.value.rechargeClosedReason)

function openRechargeDialog() {
  if (!rechargeFeatureEnabled.value)
    return

  if (!isRechargeAmountValid.value)
    rechargeForm.amount = RECHARGE_DEFAULT_LDC

  isRechargeDialogOpen.value = true
}

function closeRechargeDialog() {
  if (rechargeForm.loading)
    return

  isRechargeDialogOpen.value = false
}

function openPricingDialog() {
  isPricingDialogOpen.value = true
}

function closePricingDialog() {
  isPricingDialogOpen.value = false
}

function recharge() {
  runSafely(async () => {
    if (!isRechargeAmountValid.value)
      throw new Error(`单次充值金额需在 ${RECHARGE_MIN_LDC}-${RECHARGE_MAX_LDC} LDC 之间`)

    await startRecharge()
  }, '正在跳转到 LINUX DO Credit')
}

function dailyCheckIn() {
  runSafely(async () => {
    const result = await checkInToday()
    notify(`签到成功：+${result.points} 积分，连续 ${result.streak} 天`)
  }, '签到已完成')
}

function couponDiscountText(rate: number) {
  return `${Number(rate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function couponStatusText(coupon: { usedAt?: string, expiresAt?: string }) {
  if (coupon.usedAt)
    return '已使用'
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now())
    return '已过期'
  return '可用'
}

function couponStatusClass(coupon: { usedAt?: string, expiresAt?: string }) {
  if (coupon.usedAt)
    return 'wallet-chip--slate'
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now())
    return 'wallet-chip--red'
  return 'wallet-chip--green'
}

function signedDelta(tx: CreditTransaction) {
  return `${tx.delta > 0 ? '+' : ''}${tx.delta.toLocaleString('zh-CN')}`
}

function transactionBalance(tx: CreditTransaction, index: number) {
  if (typeof tx.balanceAfter === 'number')
    return Math.max(0, tx.balanceAfter).toLocaleString('zh-CN')

  const laterDelta = latestTransactions.value
    .slice(0, index)
    .reduce((sum, item) => sum + item.delta, 0)
  const balance = (currentUser.value?.points ?? 0) - laterDelta

  return Math.max(0, balance).toLocaleString('zh-CN')
}

onMounted(async () => {
  await runSafely(async () => {
    await refreshPointTransactions()
  }, '积分流水已刷新')

  const outTradeNo = typeof route.query.recharge === 'string' ? route.query.recharge : ''
  if (!outTradeNo)
    return

  await runSafely(async () => {
    const status = await refreshRechargeStatus(outTradeNo)
    if (status.status === 'succeeded') {
      await reloadWelfareState()
      await refreshPointTransactions()
      notify(`充值已到账：+${status.creditedPoints} 积分`)
      return
    }

    notify(`充值订单 ${status.status}，如已完成请稍后刷新钱包`)
  }, '充值状态已刷新')
})
</script>

<template>
  <section class="wallet-page">
    <TxCard class="wallet-card wallet-card--hero" background="pure" shadow="soft" :padding="0" :radius="14">
      <div class="wallet-hero-head">
        <div>
          <h2 class="wallet-title">
            私人钱包
          </h2>
          <p class="wallet-subtitle">
            查看个人积分余额和交易记录。
          </p>
        </div>
        <TxStatusBadge :text="`余额 ${(currentUser?.points ?? 0).toLocaleString('zh-CN')} 积分`" status="info" />
      </div>

      <div v-if="!currentUser" class="wallet-empty wallet-empty--hero">
        登录后可查看私人钱包。
      </div>

      <div v-else class="wallet-balance-panel">
        <div class="wallet-balance-main">
          <span class="wallet-overline">可用积分</span>
          <strong>{{ currentUser.points.toLocaleString('zh-CN') }}</strong>
          <button class="wallet-rule-link" type="button" @click="openPricingDialog">
            查看计费规则
            <span class="i-carbon-chevron-right" />
          </button>
        </div>

        <div class="wallet-recharge-panel">
          <TxButton class="wallet-recharge-button" variant="primary" :disabled="rechargeForm.loading || !rechargeFeatureEnabled" @click="openRechargeDialog">
            {{ rechargeForm.loading ? '创建订单中...' : rechargeFeatureEnabled ? '充值' : '充值关闭' }}
          </TxButton>
          <span class="wallet-recharge-rate">{{ rechargeFeatureEnabled ? '限时倍率 1:10' : rechargeClosedReason }}</span>
        </div>
      </div>
    </TxCard>

    <TxCard id="wallet-transactions" class="wallet-card wallet-card--tabs" background="pure" shadow="soft" :padding="0" :radius="14">
      <TxTabs
        v-model="activeWalletTab"
        class="wallet-tabs"
        :default-value="WALLET_TABS.transactions"
        placement="top"
        indicator-variant="line"
        indicator-motion="glide"
        :content-padding="0"
        :content-scrollable="false"
        auto-height
        borderless
      >
        <TxTabItem :name="WALLET_TABS.checkIn" icon-class="i-carbon-calendar">
          <template #name>
            每日签到
          </template>

          <div class="wallet-tab-content wallet-checkin-grid">
            <div class="wallet-checkin-card wallet-checkin-card--primary">
              <div>
                <span class="wallet-overline">今日福利</span>
                <h3>{{ todayCheckIn ? `已签到 +${todayCheckIn.points}` : '今日还未签到' }}</h3>
                <p>每天随机获得 1-30 积分，高积分概率更低。</p>
              </div>
              <TxButton variant="primary" :disabled="!!todayCheckIn" @click="dailyCheckIn">
                {{ todayCheckIn ? '今日已签到' : '立即签到' }}
              </TxButton>
            </div>
            <div class="wallet-checkin-card">
              <span class="wallet-overline">连续签到</span>
              <strong>{{ currentCheckInStreak }} 天</strong>
              <p>连续 3 天得八折券，连续 7 天得五折券。</p>
            </div>
            <div class="wallet-checkin-card">
              <span class="wallet-overline">近期待遇</span>
              <strong>{{ currentUserDailyCheckIns.length }} 次</strong>
              <p>本页保留最近签到记录，方便核对奖励发放。</p>
            </div>
          </div>

          <div class="wallet-list wallet-list--checkin">
            <div v-if="!currentUserDailyCheckIns.length" class="wallet-empty">
              暂无签到记录
            </div>
            <div v-for="item in currentUserDailyCheckIns.slice(0, 6)" :key="item.id" class="wallet-list-row wallet-list-row--compact">
              <div>
                <span class="wallet-row-title">{{ item.dateKey }}</span>
                <small>连续 {{ item.streak }} 天</small>
              </div>
              <strong class="wallet-delta wallet-delta--positive">+{{ item.points }}</strong>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="WALLET_TABS.coupons" icon-class="i-carbon-percentage">
          <template #name>
            优惠券
          </template>

          <div class="wallet-tab-content wallet-coupon-grid">
            <div v-if="!currentUserCoupons.length" class="wallet-empty wallet-empty--wide">
              暂无优惠券
            </div>
            <div v-for="coupon in currentUserCoupons" :key="coupon.id" class="wallet-coupon-card">
              <div class="wallet-coupon-top">
                <div>
                  <span class="wallet-overline">{{ couponDiscountText(coupon.discountRate) }}</span>
                  <h3>{{ coupon.name }}</h3>
                </div>
                <span class="wallet-chip" :class="couponStatusClass(coupon)">
                  {{ couponStatusText(coupon) }}
                </span>
              </div>
              <p>{{ coupon.expiresAt ? `有效至 ${formatDate(coupon.expiresAt)}` : '长期有效' }}</p>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="WALLET_TABS.transactions" icon-class="i-carbon-wallet">
          <template #name>
            积分流水
          </template>

          <div class="wallet-toolbar">
            <div class="wallet-filter-group">
              <button type="button" class="wallet-filter-button">
                全部类型
                <span class="i-carbon-chevron-down" />
              </button>
              <button type="button" class="wallet-filter-button wallet-filter-button--date">
                开始日期
                <span>→</span>
                结束日期
                <span class="i-carbon-calendar" />
              </button>
            </div>
            <button type="button" class="wallet-export-button">
              <span class="i-carbon-download" />
              导出记录
            </button>
          </div>

          <div class="wallet-stat-strip">
            <div>
              <span>近期收入</span>
              <strong>+{{ walletStats.income.toLocaleString('zh-CN') }}</strong>
            </div>
            <div>
              <span>近期消费</span>
              <strong>-{{ walletStats.outcome.toLocaleString('zh-CN') }}</strong>
            </div>
            <div>
              <span>流水条数</span>
              <strong>{{ walletStats.count }}</strong>
            </div>
          </div>

          <div class="wallet-table">
            <div class="wallet-table-row wallet-table-head">
              <span>时间</span>
              <span>类型</span>
              <span>描述</span>
              <span>积分变动</span>
              <span>余额</span>
            </div>
            <div v-if="!latestTransactions.length" class="wallet-empty wallet-empty--wide">
              暂无流水
            </div>
            <div v-for="(tx, index) in latestTransactions" :key="tx.id" class="wallet-table-row">
              <span class="wallet-time">{{ formatDate(tx.createdAt) }}</span>
              <span>
                <span class="wallet-chip" :class="transactionTypeClass[tx.type]">
                  {{ transactionTypeText[tx.type] }}
                </span>
              </span>
              <span class="wallet-description">{{ tx.reason }}</span>
              <strong class="wallet-delta" :class="tx.delta > 0 ? 'wallet-delta--positive' : 'wallet-delta--negative'">
                {{ signedDelta(tx) }}
              </strong>
              <strong class="wallet-balance-value">{{ transactionBalance(tx, index) }}</strong>
            </div>
          </div>

          <div class="wallet-more-row">
            <span>查看更多流水</span>
            <span class="i-carbon-chevron-down" />
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </section>

  <Teleport to="body">
    <Transition name="dialog-shell">
      <div v-if="isRechargeDialogOpen" class="wallet-dialog-backdrop" @click.self="closeRechargeDialog">
        <div class="wallet-dialog dialog-surface" role="dialog" aria-modal="true" aria-labelledby="wallet-recharge-title">
          <div class="wallet-dialog-head">
            <div>
              <h3 id="wallet-recharge-title">
                充值 LINUX DO Credit
              </h3>
              <p>填写本次充值金额，创建订单后会跳转到 LINUX DO Credit。</p>
            </div>
            <TxButton variant="ghost" size="sm" aria-label="关闭充值弹窗" :disabled="rechargeForm.loading" @click="closeRechargeDialog">
              <span class="i-carbon-close" />
            </TxButton>
          </div>

          <div class="wallet-dialog-body">
            <label class="wallet-dialog-field">
              <span class="wallet-section-label">充值金额（LDC）</span>
              <TxInput
                v-model="rechargeForm.amount"
                type="number"
                :min="RECHARGE_MIN_LDC"
                :max="RECHARGE_MAX_LDC"
                step="1"
                placeholder="1-1000"
              />
            </label>

            <p class="wallet-form-hint">
              {{ rechargePreviewPoints ? `预计到账约 ${rechargePreviewPoints.toLocaleString('zh-CN')} 积分` : '充值到账以异步通知验签为准' }}
            </p>

            <p class="wallet-dialog-rule">
              单次充值最少 {{ RECHARGE_MIN_LDC }} LDC，最多 {{ RECHARGE_MAX_LDC }} LDC。退款请联系管理员提交工单。
            </p>

            <div v-if="rechargeForm.statusMessage" class="wallet-status-line">
              {{ rechargeForm.statusMessage }}
            </div>
            <div v-if="lastRechargeStatus" class="wallet-status-line wallet-status-line--strong">
              最近充值订单：{{ lastRechargeStatus.outTradeNo }} · {{ lastRechargeStatus.status }} · +{{ lastRechargeStatus.creditedPoints }}
            </div>
          </div>

          <div class="wallet-dialog-actions">
            <TxButton variant="secondary" :disabled="rechargeForm.loading" @click="closeRechargeDialog">
              取消
            </TxButton>
            <TxButton variant="primary" :disabled="rechargeForm.loading || !isRechargeAmountValid || !rechargeFeatureEnabled" @click="recharge">
              {{ rechargeForm.loading ? '创建订单中...' : '确认充值' }}
            </TxButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="dialog-shell">
      <div v-if="isPricingDialogOpen" class="wallet-dialog-backdrop" @click.self="closePricingDialog">
        <div class="wallet-dialog wallet-dialog--pricing dialog-surface" role="dialog" aria-modal="true" aria-labelledby="wallet-pricing-title">
          <div class="wallet-dialog-head">
            <div>
              <h3 id="wallet-pricing-title">
                计费规则
              </h3>
              <p>公益申请采用预扣费制度，提交前请确认积分余额。</p>
            </div>
            <TxButton variant="ghost" size="sm" aria-label="关闭计费规则弹窗" @click="closePricingDialog">
              <span class="i-carbon-close" />
            </TxButton>
          </div>

          <div class="wallet-dialog-body">
            <div class="wallet-pricing-list">
              <div>
                <span>预扣费</span>
                <strong>所有公益申请均采用预扣费制度。</strong>
              </div>
              <div>
                <span>活动价格</span>
                <strong>{{ pricingSummary.activityName }} 至 {{ formatDate(pricingSummary.activityEndsAt) }}：Image {{ pricingSummary.currentRequestCost.image }} / Pro {{ pricingSummary.currentRequestCost.pro }}。</strong>
              </div>
              <div>
                <span>LLMApi</span>
                <strong>仅可选 Codex / GPT PRO；GPT PRO 按对话轮次申请，默认 5 轮、7 天有效，延长有效期需额外消耗积分。</strong>
              </div>
              <div>
                <span>学生认证</span>
                <strong>审核扣 {{ pricingSummary.studentReviewFee }}，成功返还。</strong>
              </div>
            </div>
          </div>

          <div class="wallet-dialog-actions">
            <TxButton variant="primary" @click="closePricingDialog">
              我知道了
            </TxButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wallet-page {
  display: grid;
  gap: 0.45rem;
  font-size: 14px;
}

.wallet-card {
  overflow: hidden;
  border: 1px solid rgba(99, 102, 241, 0.1);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.wallet-hero-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 1rem 1.15rem 0.7rem;
}

.wallet-title {
  margin: 0;
  color: #0f172a;
  font-size: 1.35rem;
  font-weight: 950;
  letter-spacing: -0.03em;
}

.wallet-subtitle {
  margin: 0.2rem 0 0;
  color: #718096;
  font-size: 14px;
  font-weight: 700;
}

.wallet-balance-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 0.9rem;
  margin: 0.45rem 1.15rem 1.15rem;
  padding: 1rem 1.1rem;
  border: 1px solid rgba(79, 70, 229, 0.1);
  border-radius: 18px;
  background:
    radial-gradient(circle at 92% 8%, rgba(59, 130, 246, 0.2), transparent 36%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(239, 246, 255, 0.92));
}

.wallet-overline,
.wallet-section-label {
  color: #1e2a4a;
  font-size: 14px;
  font-weight: 900;
}

.wallet-balance-main strong {
  display: block;
  margin-top: 0.15rem;
  color: #111a44;
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 950;
  line-height: 0.9;
  letter-spacing: -0.05em;
}

.wallet-rule-link {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  margin-top: 0.45rem;
  padding: 0;
  border: 0;
  color: #1d4ed8;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-weight: 900;
  text-decoration: none;
}

.wallet-recharge-panel {
  align-self: center;
  justify-self: end;
  display: grid;
  gap: 0.25rem;
  width: min(100%, 7.5rem);
}

.wallet-recharge-button {
  width: 100%;
  border-color: rgba(37, 99, 235, 0.72);
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #0f766e);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.2);
}

.wallet-recharge-rate {
  color: #0f766e;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
}

.wallet-form-hint,
.wallet-status-line {
  margin: 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.wallet-status-line {
  padding: 0.25rem 0.5rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
}

.wallet-status-line--strong {
  color: #4338ca;
  background: rgba(224, 231, 255, 0.7);
}

.wallet-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
  background: rgba(15, 23, 42, 0.46);
  backdrop-filter: blur(8px);
}

.wallet-dialog {
  width: min(100%, 28rem);
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  padding: 0.65rem;
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

.wallet-dialog--pricing {
  width: min(100%, 34rem);
}

.wallet-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.wallet-dialog-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 1.1rem;
  font-weight: 950;
  letter-spacing: -0.02em;
}

.wallet-dialog-head p {
  margin: 0.2rem 0 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.wallet-dialog-body {
  display: grid;
  gap: 0.4rem;
  margin-top: 0.6rem;
}

.wallet-dialog-field {
  display: grid;
  gap: 0.25rem;
}

.wallet-dialog-rule {
  margin: 0;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(79, 70, 229, 0.12);
  border-radius: 10px;
  color: #3730a3;
  background: rgba(238, 242, 255, 0.86);
  font-size: 14px;
  font-weight: 850;
  line-height: 1.4;
}

.wallet-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
  margin-top: 0.65rem;
}

.wallet-pricing-list {
  display: grid;
  gap: 0.35rem;
}

.wallet-pricing-list > div {
  display: grid;
  gap: 0.15rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.86);
}

.wallet-pricing-list span {
  color: #64748b;
  font-size: 14px;
  font-weight: 900;
}

.wallet-pricing-list strong {
  color: #1e2a4a;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
}

.wallet-dialog :deep(.tx-button) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border-radius: 10px;
  font-size: 14px;
}

.wallet-dialog :deep(.tx-input) {
  min-height: 2rem;
  border-radius: 10px;
  font-size: 14px;
}

.wallet-dialog :deep(.tx-input__inner) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  font-size: 14px;
}

.wallet-tabs :deep(.tx-tabs__nav) {
  margin: 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.wallet-tabs :deep(.tx-tabs__nav-bar) {
  padding: 0 0.5rem;
  background: transparent;
}

.wallet-tabs :deep(.tx-tab-item) {
  min-height: 2.2rem;
  margin: 0 0.35rem 0 0;
  padding: 0.25rem 0.5rem;
  color: #64748b;
  font-size: 14px;
  font-weight: 900;
}

.wallet-tabs :deep(.tx-tab-item.is-active) {
  color: #3730a3;
}

.wallet-tab-content,
.wallet-toolbar,
.wallet-table,
.wallet-stat-strip,
.wallet-list {
  margin: 0.45rem 0.6rem 0;
}

.wallet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
}

.wallet-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.wallet-filter-button,
.wallet-export-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.78);
  cursor: default;
  font: inherit;
  font-size: 14px;
  font-weight: 850;
}

.wallet-filter-button--date {
  min-width: 11rem;
}

.wallet-stat-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.wallet-stat-strip > div {
  padding: 0.35rem 0.5rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.84);
}

.wallet-stat-strip span {
  display: block;
  color: #94a3b8;
  font-size: 14px;
  font-weight: 850;
}

.wallet-stat-strip strong {
  display: block;
  margin-top: 0.1rem;
  color: #111a44;
  font-size: 1rem;
  font-weight: 950;
}

.wallet-table {
  overflow-x: auto;
}

.wallet-table-row {
  display: grid;
  grid-template-columns:
    minmax(6.5rem, 1fr)
    minmax(5rem, 0.7fr)
    minmax(14rem, 2fr)
    minmax(5rem, 0.75fr)
    minmax(5rem, 0.75fr);
  align-items: center;
  gap: 0.35rem;
  min-width: 620px;
  padding: 0.35rem 0.25rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
  color: #475569;
  font-size: 14px;
  font-weight: 800;
}

.wallet-table-head {
  padding-top: 0;
  color: #94a3b8;
  font-size: 14px;
  font-weight: 900;
}

.wallet-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 950;
  white-space: nowrap;
}

.wallet-chip--blue {
  color: #4f46e5;
  background: #e0e7ff;
}

.wallet-chip--green {
  color: #059669;
  background: #d1fae5;
}

.wallet-chip--red {
  color: #e11d48;
  background: #ffe4e6;
}

.wallet-chip--violet {
  color: #7c3aed;
  background: #ede9fe;
}

.wallet-chip--amber {
  color: #b45309;
  background: #fef3c7;
}

.wallet-chip--slate {
  color: #64748b;
  background: #e2e8f0;
}

.wallet-description {
  color: #334155;
}

.wallet-delta,
.wallet-balance-value {
  color: #34405f;
  font-weight: 950;
}

.wallet-delta--positive {
  color: #22c55e;
}

.wallet-delta--negative {
  color: #f43f5e;
}

.wallet-more-row {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin: 0.4rem 0 0.6rem 50%;
  color: #475569;
  font-size: 14px;
  font-weight: 900;
  transform: translateX(-50%);
}

.wallet-checkin-grid,
.wallet-coupon-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.wallet-coupon-grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-bottom: 0.6rem;
}

.wallet-checkin-card,
.wallet-coupon-card {
  padding: 0.35rem 0.5rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.88);
}

.wallet-checkin-card--primary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  grid-column: span 1;
  background: linear-gradient(135deg, #eef2ff, #f8fafc);
}

.wallet-checkin-card h3,
.wallet-coupon-card h3 {
  margin: 0.15rem 0 0;
  color: #111a44;
  font-size: 1rem;
  font-weight: 950;
}

.wallet-checkin-card strong {
  display: block;
  margin-top: 0.15rem;
  color: #111a44;
  font-size: 1.15rem;
  font-weight: 950;
}

.wallet-checkin-card p,
.wallet-coupon-card p {
  margin: 0.2rem 0 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.wallet-list {
  margin-bottom: 0.6rem;
}

.wallet-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
}

.wallet-row-title {
  display: block;
  color: #334155;
  font-weight: 900;
}

.wallet-list-row small {
  color: #94a3b8;
  font-weight: 750;
}

.wallet-coupon-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.35rem;
}

.wallet-empty {
  padding: 0.5rem;
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: 12px;
  color: #64748b;
  text-align: center;
  font-size: 14px;
  font-weight: 850;
}

.wallet-empty--hero {
  margin: 0.35rem 0.75rem 0.75rem;
}

.wallet-empty--wide {
  grid-column: 1 / -1;
  margin: 0.35rem 0 0.6rem;
}

.wallet-page :deep(.tx-button) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border-radius: 10px;
  font-size: 14px;
}

.wallet-page :deep(.tx-button .tx-button__inner) {
  gap: 0.25rem;
}

.wallet-page :deep(.tx-input) {
  min-height: 2rem;
  border-radius: 10px;
  font-size: 14px;
}

.wallet-page :deep(.tx-input__inner) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  font-size: 14px;
}

.wallet-page :deep(.tx-status-badge) {
  min-height: 1.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 14px;
}

.dark .wallet-card {
  border-color: rgba(56, 189, 248, 0.32);
  background: rgba(18, 18, 20, 0.98);
  box-shadow:
    0 0 0 1px rgba(59, 130, 246, 0.08),
    0 14px 34px rgba(0, 0, 0, 0.34);
}

.dark .wallet-title,
.dark .wallet-balance-main strong,
.dark .wallet-stat-strip strong,
.dark .wallet-checkin-card h3,
.dark .wallet-coupon-card h3,
.dark .wallet-checkin-card strong {
  color: #f8fafc;
}

.dark .wallet-subtitle,
.dark .wallet-form-hint,
.dark .wallet-dialog-head p,
.dark .wallet-checkin-card p,
.dark .wallet-coupon-card p {
  color: #b6c2d3;
}

.dark .wallet-balance-panel {
  border-color: rgba(96, 165, 250, 0.24);
  background:
    radial-gradient(circle at 94% 0%, rgba(96, 165, 250, 0.28), transparent 34%),
    linear-gradient(135deg, rgba(8, 18, 38, 0.98), rgba(28, 39, 75, 0.96));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.dark .wallet-description,
.dark .wallet-row-title {
  color: #cbd5e1;
}

.dark .wallet-overline,
.dark .wallet-section-label {
  color: #dbeafe;
}

.dark .wallet-rule-link {
  color: #60a5fa;
}

.dark .wallet-recharge-button {
  border-color: rgba(147, 197, 253, 0.78);
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #0284c7);
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.32);
}

.dark .wallet-recharge-rate {
  color: #7dd3fc;
}

.dark .wallet-filter-button,
.dark .wallet-export-button,
.dark .wallet-status-line,
.dark .wallet-stat-strip > div,
.dark .wallet-checkin-card,
.dark .wallet-coupon-card {
  border-color: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.06);
}

.dark .wallet-dialog {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
}

.dark .wallet-dialog-head h3 {
  color: #f8fafc;
}

.dark .wallet-dialog-rule {
  border-color: rgba(129, 140, 248, 0.22);
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.12);
}

.dark .wallet-pricing-list > div {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
}

.dark .wallet-pricing-list span {
  color: #94a3b8;
}

.dark .wallet-pricing-list strong {
  color: #e2e8f0;
}

.dark .wallet-tabs :deep(.tx-tabs__nav) {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.dark .wallet-table-row,
.dark .wallet-list-row {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.dark .wallet-empty {
  border-color: rgba(255, 255, 255, 0.16);
  color: #94a3b8;
}

@media (max-width: 960px) {
  .wallet-balance-panel {
    grid-template-columns: 1fr;
  }

  .wallet-checkin-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .wallet-hero-head {
    padding: 0.85rem 0.85rem 0.55rem;
  }

  .wallet-balance-panel {
    margin: 0.35rem 0.85rem 0.85rem;
    padding: 0.85rem;
  }

  .wallet-stat-strip {
    grid-template-columns: 1fr;
  }

  .wallet-recharge-panel {
    justify-self: stretch;
    width: 100%;
  }

  .wallet-tabs :deep(.tx-tabs__nav-bar) {
    padding: 0 0.35rem;
    overflow-x: auto;
  }

  .wallet-toolbar,
  .wallet-tab-content,
  .wallet-table,
  .wallet-stat-strip,
  .wallet-list {
    margin-right: 0.5rem;
    margin-left: 0.5rem;
  }

  .wallet-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .wallet-filter-button,
  .wallet-export-button,
  .wallet-filter-button--date {
    width: 100%;
    min-width: 0;
  }
}
</style>
