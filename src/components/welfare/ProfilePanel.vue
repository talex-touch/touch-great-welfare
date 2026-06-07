<script setup lang="ts">
import type { CreditTransaction, CreditTransactionType } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { formatDate } from '~/composables/welfare'
import { pricingSummary, RECHARGE_MAX_LDC, RECHARGE_MIN_LDC, useWelfareUiState } from '~/composables/welfare-ui'
import { richTextToPlainText } from '~/utils/rich-text'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const route = useRoute()

const {
  currentUser,
  currentUserLevelCard,
  profileForm,
  invitationForm,
  rechargeForm,
  rechargeFeatureEnabled,
  availableRechargeCoupons,
  systemConfig,
  collaborationApplicationForm,
  currentUserCollaborationApplication,
  notificationSettingsForm,
  pointTransactions,
  latestTransactions,
  currentUserInviteCode,
  currentUserInvitationBinding,
  currentUserInviter,
  currentUserInvitees,
  currentUserInvitationBindDeadline,
  canBindCurrentUserInvitation,
  updateCurrentProfile,
  bindInvitationCode,
  vouchInvitation,
  refreshNotificationSettings,
  persistNotificationSettings,
  enableBrowserPush,
  refreshPointTransactions,
  startRecharge,
  submitCollaborationApplicationFromForm,
  refreshRechargeStatus,
  reloadWelfareState,
  lastRechargeStatus,
} = useWelfareUiState()

const { runSafely, notify } = useWelfareFeedback()
const profileDraftKey = 'welfare:profile-draft'
const RECHARGE_DEFAULT_LDC = 100
const PROFILE_TABS = {
  system: '系统设置',
  transactions: '积分流水',
  invitation: '邀请担保',
  loginHistory: '登录历史',
} as const
const MEMBER_CARD_ASSETS = [
  {
    key: 'starter',
    title: '萌芽会员',
    image: '/member-cards/seed-member.png',
  },
  {
    key: 'steady',
    title: '成长会员',
    image: '/member-cards/growth-member.png',
  },
  {
    key: 'trusted',
    title: '曙光会员',
    image: '/member-cards/aurora-member.png',
  },
  {
    key: 'priority',
    title: '守望会员',
    image: '/member-cards/guardian-member.png',
  },
  {
    key: 'guardian',
    title: '大树守护会员',
    image: '/member-cards/tree-guardian-member.png',
  },
] as const
const isProfileDialogOpen = ref(false)
const isRechargeDialogOpen = ref(false)
const isPricingDialogOpen = ref(false)
const isAllTransactionsVisible = ref(false)
const activeProfileTab = ref(PROFILE_TABS.system)
const activeMemberCardIndex = ref(0)
let stopProfileDraft: (() => void) | undefined
let memberCardTimer: ReturnType<typeof setInterval> | undefined

const userInitial = computed(() => currentUser.value?.profile.displayName.slice(0, 1).toUpperCase() ?? '?')
const roleText = computed(() => {
  if (currentUser.value?.role === 'admin')
    return '管理员'
  if (currentUser.value?.role === 'reviewer')
    return '协作处理员'
  return '用户'
})
const collaborationApplicationStatus = computed(() => {
  if (currentUser.value?.role === 'reviewer' || currentUser.value?.role === 'admin')
    return { text: '已开通', status: 'success' as const }
  if (currentUserCollaborationApplication.value?.status === 'pending')
    return { text: '审核中', status: 'warning' as const }
  if (currentUserCollaborationApplication.value?.status === 'rejected')
    return { text: '未通过', status: 'danger' as const }
  return { text: '未申请', status: 'info' as const }
})
const levelProgress = computed(() => {
  if (!currentUserLevelCard.value)
    return 0

  return Math.min(100, Math.round((currentUserLevelCard.value.score / currentUserLevelCard.value.maxScore) * 100))
})
const profileBioText = computed(() => richTextToPlainText(currentUser.value?.profile.bio ?? ''))
const hasProfileBio = computed(() => !!profileBioText.value)
const currentMemberCardIndex = computed(() => {
  const key = currentUserLevelCard.value?.key ?? 'starter'
  const index = MEMBER_CARD_ASSETS.findIndex(item => item.key === key)
  return index >= 0 ? index : 0
})
const activeMemberCard = computed(() => MEMBER_CARD_ASSETS[activeMemberCardIndex.value] ?? MEMBER_CARD_ASSETS[0])
const visibleTransactions = computed(() => isAllTransactionsVisible.value ? pointTransactions.value : pointTransactions.value.slice(0, 5))
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
const loginHistoryRows = computed(() => {
  if (!currentUser.value)
    return []

  const profile = currentUser.value.profile
  const rows = [
    {
      id: 'last-login',
      title: '最近登录',
      detail: profile.oauthUsername
        ? `OAuth / ${profile.oauthUsername}`
        : profile.githubUsername
          ? `GitHub / ${profile.githubUsername}`
          : '平台账号登录',
      at: currentUser.value.lastLoginAt,
    },
    {
      id: 'created',
      title: '账号创建',
      detail: '初始注册记录',
      at: currentUser.value.createdAt,
    },
  ]

  if (profile.oauthAuthorizedAt) {
    rows.push({
      id: 'oauth-authorized',
      title: 'OAuth 授权',
      detail: profile.oauthProviderId || 'OAuth/OIDC',
      at: profile.oauthAuthorizedAt,
    })
  }

  if (profile.githubAuthorizedAt) {
    rows.push({
      id: 'github-authorized',
      title: 'GitHub 授权',
      detail: profile.githubUsername ? `@${profile.githubUsername}` : 'GitHub',
      at: profile.githubAuthorizedAt,
    })
  }

  return rows
})

const transactionTypeText: Record<CreditTransactionType, string> = {
  recharge: '充值到账',
  spend: '消费',
  refund: '返还',
  adjustment: '调整',
  grant: '系统奖励',
}

const transactionTypeClass: Record<CreditTransactionType, string> = {
  recharge: 'profile-chip--blue',
  spend: 'profile-chip--red',
  refund: 'profile-chip--violet',
  adjustment: 'profile-chip--amber',
  grant: 'profile-chip--green',
}

function openProfileDialog() {
  if (!currentUser.value)
    return

  restoreLocalDraft(profileDraftKey, profileForm)
  isProfileDialogOpen.value = true
}

function closeProfileDialog() {
  isProfileDialogOpen.value = false
}

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

function selectMemberCard(index: number) {
  activeMemberCardIndex.value = index
}

function showPreviousMemberCard() {
  activeMemberCardIndex.value = (activeMemberCardIndex.value + MEMBER_CARD_ASSETS.length - 1) % MEMBER_CARD_ASSETS.length
}

function showNextMemberCard() {
  activeMemberCardIndex.value = (activeMemberCardIndex.value + 1) % MEMBER_CARD_ASSETS.length
}

function saveProfile() {
  runSafely(() => {
    updateCurrentProfile({
      displayName: profileForm.displayName,
      email: profileForm.email,
      bio: profileForm.bio,
    })
    clearLocalDraft(profileDraftKey)
    closeProfileDialog()
  }, '个人信息已更新')
}

function saveNotifications() {
  runSafely(() => persistNotificationSettings(), '通知设置已保存')
}

function submitCollaborationApplication() {
  runSafely(() => submitCollaborationApplicationFromForm(), '协作处理员申请已提交')
}

function startBrowserPush() {
  runSafely(() => enableBrowserPush(), '浏览器 Push 已启用')
}

function couponDiscountText(coupon: { discountType?: string, discountRate: number, discountAmount?: number }) {
  if (coupon.discountType === 'fixed_ldc')
    return `抵扣 ${coupon.discountAmount ?? 0} LDC`
  if (coupon.discountType === 'fixed_points')
    return `抵扣 ${coupon.discountAmount ?? 0} 积分`
  return `${Number(coupon.discountRate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function recharge() {
  runSafely(async () => {
    if (!isRechargeAmountValid.value)
      throw new Error(`单次充值金额需在 ${RECHARGE_MIN_LDC}-${RECHARGE_MAX_LDC} LDC 之间`)

    await startRecharge()
  }, '正在跳转到 LINUX DO Credit')
}

function toggleTransactions() {
  if (isAllTransactionsVisible.value) {
    isAllTransactionsVisible.value = false
    return
  }

  runSafely(async () => {
    await refreshPointTransactions()
    isAllTransactionsVisible.value = true
  }, '积分流水已刷新')
}

function copyInviteCode() {
  runSafely(async () => {
    if (!currentUserInviteCode.value)
      throw new Error('邀请码不存在')
    if (!globalThis.navigator?.clipboard)
      throw new Error('当前浏览器不支持剪贴板复制')
    await globalThis.navigator.clipboard.writeText(currentUserInviteCode.value)
  }, '邀请码已复制')
}

function bindInvite() {
  runSafely(async () => {
    await bindInvitationCode()
  }, '邀请关系已绑定')
}

function vouch(bindingId: string) {
  runSafely(async () => {
    await vouchInvitation(bindingId)
  }, '担保状态已更新')
}

function invitationGuaranteeText(binding: { inviterVouchedAt?: string, inviteeVouchedAt?: string }) {
  if (binding.inviterVouchedAt && binding.inviteeVouchedAt)
    return '双方已担保'
  if (binding.inviterVouchedAt)
    return '邀请人已担保'
  if (binding.inviteeVouchedAt)
    return '被邀请人已担保'
  return '待担保'
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

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape')
    return

  closeProfileDialog()
  closeRechargeDialog()
  closePricingDialog()
}

watch(currentMemberCardIndex, (index) => {
  activeMemberCardIndex.value = index
}, { immediate: true })

onMounted(async () => {
  restoreLocalDraft(profileDraftKey, profileForm)
  stopProfileDraft = persistLocalDraft(profileDraftKey, profileForm)
  window.addEventListener('keydown', onKeydown)
  memberCardTimer = setInterval(showNextMemberCard, 5200)

  await Promise.all([
    refreshPointTransactions(),
    refreshNotificationSettings(),
  ]).catch(() => {})

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

    notify(`充值订单 ${status.status}，如已完成请稍后刷新个人中心`)
  }, '充值状态已刷新')
})

onUnmounted(() => {
  stopProfileDraft?.()
  if (memberCardTimer)
    clearInterval(memberCardTimer)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="profile-page">
    <div class="profile-page-head">
      <div>
        <h2 class="profile-title">
          个人中心
        </h2>
        <p class="profile-subtitle">
          管理您的账户、钱包与通知设置，查看积分与交易记录。
        </p>
      </div>
    </div>

    <div v-if="!currentUser" class="profile-empty profile-empty--hero">
      登录后可查看个人中心。
    </div>

    <template v-else>
      <TxCard class="profile-card profile-card--overview" background="pure" shadow="soft" :padding="0" :radius="14">
        <div class="profile-overview-grid">
          <div class="profile-account-column">
            <button class="profile-user-button" @click="openProfileDialog">
              <span class="profile-avatar">
                <img v-if="currentUser.profile.avatar" :src="currentUser.profile.avatar" :alt="currentUser.profile.displayName" class="h-full w-full object-cover">
                <span v-else>{{ userInitial }}</span>
              </span>
              <span class="profile-user-copy">
                <span class="profile-user-name-row">
                  <span class="profile-user-name">{{ currentUser.profile.displayName }}</span>
                  <TxStatusBadge :text="roleText" :status="currentUser.role === 'admin' ? 'success' : 'info'" size="sm" />
                </span>
                <span class="profile-user-email">{{ currentUser.profile.email }}</span>
                <span v-if="hasProfileBio" class="profile-user-bio">{{ profileBioText }}</span>
                <span v-else class="profile-user-bio profile-user-bio--empty">暂未填写个人简介。</span>
              </span>
            </button>

            <div class="profile-trust-panel">
              <div class="profile-panel-head">
                <div>
                  <h3>信任等级</h3>
                  <p>审核优先级参考通过记录、认证状态和退回情况。</p>
                </div>
                <TxStatusBadge v-if="currentUserLevelCard" :text="currentUserLevelCard.name" :status="currentUserLevelCard.tone === 'warning' ? 'warning' : currentUserLevelCard.tone" size="sm" />
              </div>

              <div v-if="!currentUserLevelCard" class="profile-empty">
                暂无信任等级。
              </div>
              <div v-else class="profile-trust-body">
                <div class="profile-trust-score-row">
                  <div class="profile-trust-score">
                    {{ currentUserLevelCard.score }}<span>/ {{ currentUserLevelCard.maxScore }}</span>
                  </div>
                  <div class="profile-trust-meta">
                    <div>
                      <span>等级</span>
                      <strong>{{ currentUserLevelCard.name }}</strong>
                    </div>
                    <div>
                      <span>优先级</span>
                      <strong>{{ currentUserLevelCard.priority }}</strong>
                    </div>
                  </div>
                </div>
                <div class="profile-progress">
                  <div :style="{ width: `${levelProgress}%` }" />
                </div>
                <div class="profile-trust-summary">
                  {{ currentUserLevelCard.summary }}
                </div>
                <div class="profile-trust-reasons">
                  {{ currentUserLevelCard.reasons.join(' / ') }}
                </div>
                <div class="profile-trust-next">
                  下一等级：<b>{{ currentUserLevelCard.next?.name ?? '已达最高' }}</b>
                </div>
              </div>
            </div>
          </div>

          <div class="profile-wallet-panel">
            <div class="profile-member-carousel" :aria-label="`会员卡轮播：${activeMemberCard.title}`">
              <div class="profile-member-carousel-track">
                <button class="profile-carousel-arrow profile-carousel-arrow--prev" type="button" aria-label="上一张会员卡" @click="showPreviousMemberCard">
                  <span class="i-carbon-chevron-left" />
                </button>
                <div class="profile-member-card-stage">
                  <img :src="activeMemberCard.image" :alt="activeMemberCard.title" loading="lazy">
                </div>
                <button class="profile-carousel-arrow profile-carousel-arrow--next" type="button" aria-label="下一张会员卡" @click="showNextMemberCard">
                  <span class="i-carbon-chevron-right" />
                </button>
              </div>
              <div class="profile-member-carousel-dots" role="tablist" aria-label="会员卡等级">
                <button
                  v-for="(card, index) in MEMBER_CARD_ASSETS"
                  :key="card.key"
                  type="button"
                  :class="[index === activeMemberCardIndex ? 'is-active' : '', index === currentMemberCardIndex ? 'is-current' : '']"
                  :aria-label="`查看${card.title}`"
                  @click="selectMemberCard(index)"
                >
                  <span />
                  <small>{{ card.title }}</small>
                </button>
              </div>
            </div>

            <div class="profile-wallet-main">
              <div>
                <span class="profile-overline">可用积分</span>
                <strong>{{ currentUser.points.toLocaleString('zh-CN') }}</strong>
                <button class="profile-rule-link" type="button" @click="openPricingDialog">
                  查看计费规则
                  <span class="i-carbon-chevron-right" />
                </button>
              </div>
              <div class="profile-recharge-panel">
                <TxButton class="profile-recharge-button" variant="primary" :disabled="rechargeForm.loading || !rechargeFeatureEnabled" @click="openRechargeDialog">
                  {{ rechargeForm.loading ? '创建订单中...' : rechargeFeatureEnabled ? '充值' : '充值关闭' }}
                </TxButton>
                <span>{{ rechargeFeatureEnabled ? '限时倍率 1:10' : rechargeClosedReason }}</span>
              </div>
            </div>

            <div class="profile-wallet-stats">
              <div>
                <span>最近收入</span>
                <strong>+{{ walletStats.income.toLocaleString('zh-CN') }}</strong>
              </div>
              <div>
                <span>最近消费</span>
                <strong>-{{ walletStats.outcome.toLocaleString('zh-CN') }}</strong>
              </div>
              <div>
                <span>流水条数</span>
                <strong>{{ walletStats.count }}</strong>
              </div>
            </div>
          </div>
        </div>
      </TxCard>

      <TxCard class="profile-card profile-card--tabs" background="pure" shadow="soft" :padding="0" :radius="14">
        <TxTabs
          v-model="activeProfileTab"
          class="profile-tabs"
          :default-value="PROFILE_TABS.system"
          placement="top"
          indicator-variant="line"
          indicator-motion="glide"
          :content-padding="0"
          :content-scrollable="false"
          auto-height
          borderless
        >
          <TxTabItem :name="PROFILE_TABS.system" icon-class="i-carbon-settings">
            <template #name>
              系统设置
            </template>
            <div class="profile-card-head">
              <div>
                <h3>通知与账户设置</h3>
                <p>配置通知方式与账户安全，确保您不会错过重要信息。</p>
              </div>
              <TxButton variant="secondary" size="sm" :disabled="notificationSettingsForm.loading" @click="saveNotifications">
                <span class="i-carbon-send" />
                {{ notificationSettingsForm.loading ? '保存中...' : '保存设置' }}
              </TxButton>
            </div>

            <div class="profile-settings-grid">
              <div class="profile-setting-card">
                <label class="profile-setting-title">
                  <TxCheckbox v-model="notificationSettingsForm.emailEnabled" variant="checkmark" aria-label="邮箱通知" />
                  <span class="i-carbon-email profile-setting-icon profile-setting-icon--email" />
                  邮箱通知
                </label>
                <p>发送成功后扣 5 积分；余额不足时跳过邮箱。</p>
                <div class="profile-setting-action">
                  <TxInput v-model="notificationSettingsForm.emailAddress" type="email" placeholder="you@example.com" />
                  <TxStatusBadge :text="notificationSettingsForm.emailEnabled ? '已启用' : '未启用'" :status="notificationSettingsForm.emailEnabled ? 'success' : 'warning'" size="sm" />
                </div>
              </div>

              <div class="profile-setting-card">
                <label class="profile-setting-title">
                  <TxCheckbox v-model="notificationSettingsForm.feishuEnabled" variant="checkmark" aria-label="飞书通知" />
                  <span class="i-carbon-send profile-setting-icon profile-setting-icon--feishu" />
                  飞书通知
                </label>
                <p>使用个人飞书机器人 Webhook，已保存值只显示脱敏文本。</p>
                <div class="profile-setting-action">
                  <TxInput v-model="notificationSettingsForm.feishuWebhookUrl" type="password" :placeholder="notificationSettingsForm.feishuWebhookMasked || 'https://open.feishu.cn/open-apis/bot/...'" />
                  <TxStatusBadge :text="notificationSettingsForm.feishuEnabled ? '已启用' : '未启用'" :status="notificationSettingsForm.feishuEnabled ? 'success' : 'warning'" size="sm" />
                </div>
              </div>

              <div class="profile-setting-card">
                <label class="profile-setting-title">
                  <TxCheckbox v-model="notificationSettingsForm.browserPushEnabled" variant="checkmark" aria-label="浏览器 Push" />
                  <span class="i-carbon-notification profile-setting-icon" />
                  浏览器 Push
                </label>
                <p>当前权限：{{ notificationSettingsForm.permission }}；需要服务端 VAPID Key。</p>
                <div class="profile-setting-action">
                  <TxStatusBadge :text="notificationSettingsForm.browserPushEnabled ? '已启用' : '未启用'" :status="notificationSettingsForm.browserPushEnabled ? 'success' : 'warning'" size="sm" />
                  <TxButton size="sm" variant="secondary" @click="startBrowserPush">
                    注册 Push
                  </TxButton>
                </div>
              </div>

              <div class="profile-setting-card profile-setting-card--profile">
                <div class="profile-setting-title">
                  <span class="i-carbon-user profile-setting-icon" />
                  编辑资料
                </div>
                <p>管理基本信息与安全偏好。</p>
                <TxButton size="sm" variant="secondary" @click="openProfileDialog">
                  编辑资料
                </TxButton>
              </div>

              <div class="profile-setting-card profile-setting-card--profile">
                <div class="profile-setting-title">
                  <span class="i-carbon-task-add profile-setting-icon" />
                  协作处理员
                </div>
                <p>通过后可认领已审核通过的 Codex / Pro 交付任务，完成后由管理员复核奖励。</p>
                <div class="profile-setting-action">
                  <TxStatusBadge :text="collaborationApplicationStatus.text" :status="collaborationApplicationStatus.status" size="sm" />
                </div>
                <div v-if="currentUser?.role !== 'reviewer' && currentUser?.role !== 'admin'" class="mt-3 gap-3 grid">
                  <RichTextEditor v-model="collaborationApplicationForm.reason" :min-height="120" placeholder="说明你的可协作方向、技术栈、可处理任务类型和时间安排" />
                  <TxButton size="sm" variant="primary" :disabled="collaborationApplicationForm.loading || currentUserCollaborationApplication?.status === 'pending'" @click="submitCollaborationApplication">
                    {{ collaborationApplicationForm.loading ? '提交中...' : currentUserCollaborationApplication?.status === 'pending' ? '等待审核' : '提交申请' }}
                  </TxButton>
                </div>
                <RichTextView v-if="currentUserCollaborationApplication?.reply" :content="currentUserCollaborationApplication.reply" class="rich-text-preview mt-3" />
              </div>
            </div>
          </TxTabItem>

          <TxTabItem :name="PROFILE_TABS.transactions" icon-class="i-carbon-wallet">
            <template #name>
              积分流水
            </template>
            <div class="profile-card-head profile-card-head--compact">
              <div>
                <h3>{{ isAllTransactionsVisible ? '积分流水' : '积分流水（最近 5 条）' }}</h3>
              </div>
              <TxButton size="sm" variant="secondary" @click="toggleTransactions">
                {{ isAllTransactionsVisible ? '收起' : '查看全部' }}
              </TxButton>
            </div>

            <div class="profile-table">
              <div class="profile-table-row profile-table-head">
                <span>时间</span>
                <span>类型</span>
                <span>描述</span>
                <span>积分变动</span>
                <span>余额</span>
              </div>
              <div v-if="!visibleTransactions.length" class="profile-empty profile-empty--wide">
                暂无流水
              </div>
              <div v-for="(tx, index) in visibleTransactions" :key="tx.id" class="profile-table-row">
                <span class="profile-time">{{ formatDate(tx.createdAt) }}</span>
                <span>
                  <span class="profile-chip" :class="transactionTypeClass[tx.type]">
                    {{ transactionTypeText[tx.type] }}
                  </span>
                </span>
                <span class="profile-description">{{ tx.reason }}</span>
                <strong class="profile-delta" :class="tx.delta > 0 ? 'profile-delta--positive' : 'profile-delta--negative'">
                  {{ signedDelta(tx) }}
                </strong>
                <strong class="profile-balance-value">{{ transactionBalance(tx, index) }}</strong>
              </div>
            </div>
          </TxTabItem>

          <TxTabItem :name="PROFILE_TABS.invitation" icon-class="i-carbon-user-multiple">
            <template #name>
              邀请担保
            </template>
            <div class="profile-card-head profile-card-head--compact">
              <div>
                <h3>邀请与担保</h3>
                <p>注册后 8 小时内可绑定邀请人；绑定后双方可互相担保。</p>
              </div>
              <TxStatusBadge :text="currentUserInvitationBinding ? '已绑定' : canBindCurrentUserInvitation ? '可绑定' : '已过期'" :status="currentUserInvitationBinding ? 'success' : canBindCurrentUserInvitation ? 'info' : 'warning'" size="sm" />
            </div>

            <div class="profile-invite-body">
              <div class="profile-split-panel">
                <div>
                  <div class="profile-section-label">
                    我的邀请码
                  </div>
                  <div class="profile-inline-form">
                    <TxInput :model-value="currentUserInviteCode" readonly />
                    <TxButton variant="secondary" @click="copyInviteCode">
                      复制
                    </TxButton>
                  </div>
                </div>

                <div>
                  <div class="profile-section-label">
                    我的邀请人
                  </div>
                  <div v-if="currentUserInvitationBinding" class="profile-inviter-row">
                    <div>
                      <div class="profile-row-title">
                        {{ currentUserInviter?.profile.displayName || currentUserInvitationBinding.inviterUserId }}
                      </div>
                      <div class="profile-hint">
                        {{ invitationGuaranteeText(currentUserInvitationBinding) }} · {{ formatDate(currentUserInvitationBinding.createdAt) }}
                      </div>
                    </div>
                    <TxButton size="sm" variant="secondary" :disabled="!!currentUserInvitationBinding.inviteeVouchedAt" @click="vouch(currentUserInvitationBinding.id)">
                      {{ currentUserInvitationBinding.inviteeVouchedAt ? '已担保' : '为邀请人担保' }}
                    </TxButton>
                  </div>
                  <div v-else class="profile-bind-group">
                    <div class="profile-hint">
                      绑定截止：{{ currentUserInvitationBindDeadline ? formatDate(currentUserInvitationBindDeadline) : '未登录' }}
                    </div>
                    <div v-if="canBindCurrentUserInvitation" class="profile-inline-form">
                      <TxInput v-model="invitationForm.code" placeholder="输入邀请人的邀请码" />
                      <TxButton variant="primary" @click="bindInvite">
                        绑定
                      </TxButton>
                    </div>
                    <div v-else class="profile-warning">
                      注册已超过 8 小时，不能再补绑邀请人。
                    </div>
                  </div>
                  <div v-if="invitationForm.message" class="profile-hint">
                    {{ invitationForm.message }}
                  </div>
                </div>
              </div>

              <div class="profile-invitees-box">
                <div class="profile-table-title-row">
                  <div class="profile-section-label">
                    我邀请的人
                  </div>
                  <span>{{ currentUserInvitees.length }} 个绑定</span>
                </div>
                <div v-if="!currentUserInvitees.length" class="profile-empty">
                  暂无邀请绑定
                </div>
                <div v-for="item in currentUserInvitees.slice(0, 3)" :key="item.binding.id" class="profile-invitee-row">
                  <div class="min-w-0">
                    <div class="profile-row-title truncate">
                      {{ item.user?.profile.displayName || item.binding.inviteeUserId }}
                    </div>
                    <div class="profile-hint truncate">
                      {{ item.user?.profile.email || '未知邮箱' }} · {{ invitationGuaranteeText(item.binding) }}
                    </div>
                  </div>
                  <TxButton size="sm" variant="secondary" :disabled="!!item.binding.inviterVouchedAt" @click="vouch(item.binding.id)">
                    {{ item.binding.inviterVouchedAt ? '已担保' : '担保' }}
                  </TxButton>
                </div>
              </div>
            </div>
          </TxTabItem>

          <TxTabItem :name="PROFILE_TABS.loginHistory" icon-class="i-carbon-time">
            <template #name>
              登录历史
            </template>
            <div class="profile-card-head profile-card-head--compact">
              <div>
                <h3>登录历史</h3>
                <p>展示最近登录、账号创建和第三方授权记录。</p>
              </div>
              <TxStatusBadge :text="`${loginHistoryRows.length} 条记录`" status="info" size="sm" />
            </div>
            <div class="profile-history-list">
              <div v-for="row in loginHistoryRows" :key="row.id" class="profile-history-row">
                <div>
                  <span class="profile-row-title">{{ row.title }}</span>
                  <small>{{ row.detail }}</small>
                </div>
                <strong>{{ formatDate(row.at) }}</strong>
              </div>
            </div>
          </TxTabItem>
        </TxTabs>
      </TxCard>
    </template>

    <Teleport to="body">
      <Transition name="dialog-shell">
        <div v-if="isProfileDialogOpen" class="profile-dialog-backdrop" @click.self="closeProfileDialog">
          <div class="profile-dialog dialog-surface" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
            <div class="profile-dialog-head">
              <div>
                <h3 id="profile-edit-title">
                  编辑个人信息
                </h3>
                <p>保存后会更新公开展示资料；草稿会临时保存在本地浏览器。</p>
              </div>
              <button class="icon-btn shrink-0" title="关闭" @click="closeProfileDialog">
                <span class="i-carbon-close" />
              </button>
            </div>

            <div class="profile-dialog-body profile-edit-grid">
              <div class="md:col-span-2">
                <DataNotice mode="compact" title="个人资料保存提示" />
              </div>
              <label class="profile-dialog-field">
                <span class="profile-section-label">显示名称</span>
                <TxInput v-model="profileForm.displayName" />
              </label>
              <label class="profile-dialog-field">
                <span class="profile-section-label">邮箱</span>
                <TxInput v-model="profileForm.email" type="email" />
              </label>
              <label class="profile-dialog-field md:col-span-2">
                <span class="profile-section-label">个人简介</span>
                <RichTextEditor v-model="profileForm.bio" :min-height="180" placeholder="你的公益方向、技能栈、所在组织等" />
                <span class="profile-hint">个人简介请避免填写身份证号、住址、生产密钥、未公开课题或其他无法公开处理的信息。</span>
              </label>
              <div v-if="profileForm.bio" class="md:col-span-2">
                <div class="profile-section-label mb-2">
                  简介预览
                </div>
                <div class="profile-preview-box">
                  <RichTextView :content="profileForm.bio" />
                </div>
              </div>
            </div>

            <div class="profile-dialog-actions">
              <TxButton variant="ghost" @click="closeProfileDialog">
                取消
              </TxButton>
              <TxButton variant="primary" @click="saveProfile">
                保存个人信息
              </TxButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="dialog-shell">
        <div v-if="isRechargeDialogOpen" class="profile-dialog-backdrop" @click.self="closeRechargeDialog">
          <div class="profile-dialog profile-dialog--recharge dialog-surface" role="dialog" aria-modal="true" aria-labelledby="profile-recharge-title">
            <div class="profile-dialog-head">
              <div>
                <h3 id="profile-recharge-title">
                  充值 LINUX DO Credit
                </h3>
                <p>填写本次充值金额，创建订单后会跳转到 LINUX DO Credit。</p>
              </div>
              <TxButton variant="ghost" size="sm" aria-label="关闭充值弹窗" :disabled="rechargeForm.loading" @click="closeRechargeDialog">
                <span class="i-carbon-close" />
              </TxButton>
            </div>

            <div class="profile-dialog-body">
              <label class="profile-dialog-field">
                <span class="profile-section-label">充值金额（LDC）</span>
                <TxInput
                  v-model="rechargeForm.amount"
                  type="number"
                  :min="RECHARGE_MIN_LDC"
                  :max="RECHARGE_MAX_LDC"
                  step="1"
                  placeholder="1-1000"
                />
              </label>

              <label v-if="availableRechargeCoupons.length" class="profile-dialog-field">
                <span class="profile-section-label">充值优惠券</span>
                <select v-model="rechargeForm.selectedCouponId" class="form-select">
                  <option value="">
                    不使用优惠券
                  </option>
                  <option v-for="coupon in availableRechargeCoupons" :key="coupon.id" :value="coupon.id">
                    {{ coupon.name }} · {{ couponDiscountText(coupon) }}
                  </option>
                </select>
              </label>

              <p class="profile-form-hint">
                {{ rechargePreviewPoints ? `预计到账约 ${rechargePreviewPoints.toLocaleString('zh-CN')} 积分，优惠券仅抵扣实付 LDC` : '充值到账以异步通知验签为准' }}
              </p>

              <p class="profile-dialog-rule">
                单次充值最少 {{ RECHARGE_MIN_LDC }} LDC，最多 {{ RECHARGE_MAX_LDC }} LDC。退款请联系管理员提交工单。
              </p>

              <div v-if="rechargeForm.statusMessage" class="profile-status-line">
                {{ rechargeForm.statusMessage }}
              </div>
              <div v-if="lastRechargeStatus" class="profile-status-line profile-status-line--strong">
                最近充值订单：{{ lastRechargeStatus.outTradeNo }} · {{ lastRechargeStatus.status }} · +{{ lastRechargeStatus.creditedPoints }}
              </div>
            </div>

            <div class="profile-dialog-actions">
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
        <div v-if="isPricingDialogOpen" class="profile-dialog-backdrop" @click.self="closePricingDialog">
          <div class="profile-dialog profile-dialog--pricing dialog-surface" role="dialog" aria-modal="true" aria-labelledby="profile-pricing-title">
            <div class="profile-dialog-head">
              <div>
                <h3 id="profile-pricing-title">
                  计费规则
                </h3>
                <p>公益申请采用预扣费制度，提交前请确认积分余额。</p>
              </div>
              <TxButton variant="ghost" size="sm" aria-label="关闭计费规则弹窗" @click="closePricingDialog">
                <span class="i-carbon-close" />
              </TxButton>
            </div>

            <div class="profile-dialog-body">
              <div class="profile-pricing-list">
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

            <div class="profile-dialog-actions">
              <TxButton variant="primary" @click="closePricingDialog">
                我知道了
              </TxButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.profile-page {
  display: grid;
  gap: 0.75rem;
  font-size: 14px;
}

.profile-page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.15rem 0.15rem 0;
}

.profile-title {
  margin: 0;
  color: #0f172a;
  font-size: 1.7rem;
  font-weight: 950;
  line-height: 1.1;
  letter-spacing: -0.04em;
}

.profile-subtitle {
  margin: 0.3rem 0 0;
  color: #718096;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.45;
}

.profile-card {
  overflow: hidden;
  border: 1px solid rgba(99, 102, 241, 0.1);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.profile-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 1rem;
  padding: 1rem;
}

.profile-account-column {
  display: grid;
  gap: 0.7rem;
}

.profile-user-button,
.profile-trust-panel,
.profile-setting-card,
.profile-split-panel,
.profile-invitees-box,
.profile-history-row {
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.88);
}

.profile-user-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color 160ms ease,
    background 160ms ease;
}

.profile-user-button:hover,
.profile-user-button:focus-visible {
  border-color: rgba(37, 99, 235, 0.36);
  background: rgba(239, 246, 255, 0.9);
  outline: none;
}

.profile-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 4.25rem;
  height: 4.25rem;
  overflow: hidden;
  border-radius: 16px;
  color: #ffffff;
  background: #111827;
  font-size: 1.45rem;
  font-weight: 900;
}

.profile-user-copy {
  min-width: 0;
}

.profile-user-name-row,
.profile-panel-head,
.profile-trust-score-row,
.profile-card-head,
.profile-inviter-row,
.profile-table-title-row,
.profile-setting-action {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
}

.profile-user-name-row {
  align-items: center;
  justify-content: flex-start;
}

.profile-user-name {
  min-width: 0;
  overflow: hidden;
  color: #111827;
  font-size: 1.15rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-user-email,
.profile-user-bio,
.profile-hint,
.profile-trust-reasons,
.profile-trust-next,
.profile-card-head p,
.profile-table-title-row span,
.profile-setting-card p,
.profile-form-hint,
.profile-status-line {
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.profile-user-email {
  display: block;
  margin-top: 0.16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-user-bio {
  display: -webkit-box;
  margin-top: 0.5rem;
  overflow: hidden;
  color: #475569;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.profile-user-bio--empty {
  color: #94a3b8;
}

.profile-trust-panel,
.profile-invite-body,
.profile-history-list {
  padding: 0.8rem;
}

.profile-panel-head h3,
.profile-card-head h3 {
  margin: 0;
  color: #111827;
  font-size: 1rem;
  font-weight: 950;
}

.profile-panel-head p,
.profile-card-head p {
  margin: 0.15rem 0 0;
}

.profile-trust-body {
  margin-top: 0.65rem;
}

.profile-trust-score {
  color: #111a44;
  font-size: 2.55rem;
  font-weight: 950;
  line-height: 0.95;
  letter-spacing: -0.05em;
}

.profile-trust-score span {
  color: #64748b;
  font-size: 1rem;
  font-weight: 850;
  letter-spacing: 0;
}

.profile-trust-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
  min-width: 16rem;
}

.profile-trust-meta > div {
  padding: 0.45rem 0.55rem;
  border-left: 1px solid rgba(99, 102, 241, 0.12);
}

.profile-trust-meta span {
  display: block;
  color: #94a3b8;
  font-weight: 850;
}

.profile-trust-meta strong {
  display: block;
  margin-top: 0.15rem;
  color: #111a44;
  font-size: 1.2rem;
  font-weight: 950;
}

.profile-progress {
  height: 0.48rem;
  margin-top: 0.6rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
}

.profile-progress > div {
  height: 100%;
  border-radius: inherit;
  background: #ffb000;
}

.profile-trust-summary {
  margin-top: 0.6rem;
  color: #111827;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.35;
}

.profile-trust-reasons,
.profile-trust-next {
  margin-top: 0.25rem;
}

.profile-trust-next b {
  color: #1e293b;
}

.profile-wallet-panel {
  display: grid;
  align-content: space-between;
  gap: 0.9rem;
  min-height: 100%;
  padding: 1rem 1.1rem;
  border: 1px solid rgba(79, 70, 229, 0.1);
  border-radius: 18px;
  background:
    radial-gradient(circle at 92% 8%, rgba(59, 130, 246, 0.2), transparent 36%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(239, 246, 255, 0.92));
}

.profile-member-carousel {
  display: grid;
  gap: 0.5rem;
}

.profile-member-carousel-track {
  position: relative;
  display: grid;
  align-items: center;
}

.profile-member-card-stage {
  overflow: hidden;
  border-radius: 18px;
}

.profile-member-card-stage img {
  display: block;
  width: 100%;
  aspect-ratio: 1.86 / 1;
  object-fit: contain;
  filter: drop-shadow(0 16px 28px rgba(15, 23, 42, 0.12));
}

.profile-carousel-arrow {
  position: absolute;
  z-index: 2;
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(99, 102, 241, 0.14);
  border-radius: 999px;
  color: #1e293b;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.profile-carousel-arrow--prev {
  left: 0.45rem;
}

.profile-carousel-arrow--next {
  right: 0.45rem;
}

.profile-member-carousel-dots {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.3rem;
}

.profile-member-carousel-dots button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.45rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 999px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.55);
  font: inherit;
  font-size: 12px;
  font-weight: 850;
}

.profile-member-carousel-dots button > span {
  width: 0.38rem;
  height: 0.38rem;
  border-radius: 999px;
  background: #cbd5e1;
}

.profile-member-carousel-dots button.is-active {
  border-color: rgba(37, 99, 235, 0.28);
  color: #1d4ed8;
  background: rgba(239, 246, 255, 0.88);
}

.profile-member-carousel-dots button.is-active > span {
  background: #2563eb;
}

.profile-member-carousel-dots button.is-current {
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.28);
}

.profile-wallet-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.profile-overline,
.profile-section-label {
  color: #1e2a4a;
  font-size: 14px;
  font-weight: 900;
}

.profile-wallet-main strong {
  display: block;
  margin-top: 0.15rem;
  color: #111a44;
  font-size: clamp(2.5rem, 5.2vw, 3.6rem);
  font-weight: 950;
  line-height: 0.9;
  letter-spacing: -0.06em;
}

.profile-rule-link {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  margin-top: 0.5rem;
  padding: 0;
  border: 0;
  color: #1d4ed8;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-weight: 900;
}

.profile-recharge-panel {
  display: grid;
  gap: 0.3rem;
  width: min(100%, 7.5rem);
}

.profile-recharge-button {
  width: 100%;
  border-color: rgba(37, 99, 235, 0.72);
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #0f766e);
  box-shadow: 0 10px 24px rgba(37, 99, 235, 0.2);
}

.profile-recharge-panel span {
  color: #0f766e;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
  text-align: center;
}

.profile-wallet-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.profile-wallet-stats > div {
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.62);
}

.profile-wallet-stats span {
  display: block;
  color: #64748b;
  font-weight: 850;
}

.profile-wallet-stats strong {
  display: block;
  margin-top: 0.25rem;
  color: #111a44;
  font-size: 1.15rem;
  font-weight: 950;
}

.profile-card-head {
  padding: 0.9rem 1rem 0.6rem;
}

.profile-card-head--compact {
  align-items: center;
}

.profile-tabs :deep(.tx-tabs__nav) {
  margin: 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.profile-tabs :deep(.tx-tabs__nav-bar) {
  padding: 0 0.6rem;
  background: transparent;
}

.profile-tabs :deep(.tx-tab-item) {
  min-height: 2.4rem;
  margin: 0 0.35rem 0 0;
  padding: 0.3rem 0.6rem;
  color: #64748b;
  font-size: 14px;
  font-weight: 900;
}

.profile-tabs :deep(.tx-tab-item.is-active) {
  color: #3730a3;
}

.profile-tabs .profile-card-head {
  padding-top: 0.8rem;
}

.profile-settings-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0 1rem 1rem;
}

.profile-setting-card {
  display: grid;
  align-content: start;
  gap: 0.55rem;
  padding: 0.8rem;
}

.profile-setting-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: #1e293b;
  font-size: 14px;
  font-weight: 950;
}

.profile-setting-icon {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 10px;
  color: #2563eb;
  background: #ffffff;
  font-size: 1.15rem;
}

.profile-setting-icon--email {
  color: #3b82f6;
}

.profile-setting-icon--feishu {
  color: #1d4ed8;
}

.profile-setting-action {
  align-items: center;
  margin-top: auto;
}

.profile-setting-action :deep(.tx-input) {
  flex: 1 1 auto;
  min-width: 0;
}

.profile-table {
  margin: 0 1rem 1rem;
  overflow-x: auto;
  border: 1px solid rgba(99, 102, 241, 0.08);
  border-radius: 14px;
}

.profile-table-row {
  display: grid;
  grid-template-columns:
    minmax(6.5rem, 1fr)
    minmax(5rem, 0.8fr)
    minmax(12rem, 2fr)
    minmax(5rem, 0.75fr)
    minmax(5rem, 0.75fr);
  align-items: center;
  gap: 0.35rem;
  min-width: 640px;
  padding: 0.5rem 0.7rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
  color: #475569;
  font-size: 14px;
  font-weight: 800;
}

.profile-table-row:last-child {
  border-bottom: 0;
}

.profile-table-head {
  color: #94a3b8;
  background: rgba(248, 250, 252, 0.84);
  font-size: 14px;
  font-weight: 900;
}

.profile-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 950;
  white-space: nowrap;
}

.profile-chip--blue {
  color: #4f46e5;
  background: #e0e7ff;
}

.profile-chip--green {
  color: #059669;
  background: #d1fae5;
}

.profile-chip--red {
  color: #e11d48;
  background: #ffe4e6;
}

.profile-chip--violet {
  color: #7c3aed;
  background: #ede9fe;
}

.profile-chip--amber {
  color: #b45309;
  background: #fef3c7;
}

.profile-description {
  color: #334155;
}

.profile-delta,
.profile-balance-value {
  color: #34405f;
  font-weight: 950;
}

.profile-delta--positive {
  color: #22c55e;
}

.profile-delta--negative {
  color: #f43f5e;
}

.profile-invite-body {
  display: grid;
  gap: 0.7rem;
  padding-top: 0.1rem;
}

.profile-split-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
}

.profile-split-panel > div {
  min-width: 0;
  padding: 0.7rem;
}

.profile-split-panel > div + div {
  border-left: 1px solid rgba(99, 102, 241, 0.1);
}

.profile-inline-form,
.profile-bind-group {
  display: grid;
  gap: 0.35rem;
}

.profile-inline-form {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  margin-top: 0.4rem;
}

.profile-inviter-row,
.profile-bind-group {
  margin-top: 0.4rem;
}

.profile-row-title {
  color: #1e293b;
  font-size: 14px;
  font-weight: 900;
}

.profile-warning {
  padding: 0.45rem 0.55rem;
  border-radius: 10px;
  color: #92400e;
  background: #fef3c7;
  font-size: 14px;
  font-weight: 850;
  line-height: 1.35;
}

.profile-invitees-box {
  padding: 0.7rem;
}

.profile-invitee-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
}

.profile-invitee-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.profile-history-list {
  display: grid;
  gap: 0.4rem;
  padding-top: 0.1rem;
}

.profile-history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
}

.profile-history-row small {
  display: block;
  margin-top: 0.12rem;
  color: #94a3b8;
  font-size: 14px;
  font-weight: 750;
}

.profile-history-row strong {
  color: #334155;
  font-size: 14px;
  font-weight: 900;
  text-align: right;
  white-space: nowrap;
}

.profile-empty {
  padding: 0.65rem;
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: 12px;
  color: #64748b;
  text-align: center;
  font-size: 14px;
  font-weight: 850;
}

.profile-empty--hero {
  margin: 0.4rem 0;
}

.profile-empty--wide {
  margin: 0.7rem;
}

.profile-dialog-backdrop {
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

.profile-dialog {
  width: min(100%, 46rem);
  max-height: calc(100vh - 1.5rem);
  overflow: auto;
  padding: 0.85rem;
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

.profile-dialog--recharge {
  width: min(100%, 28rem);
}

.profile-dialog--pricing {
  width: min(100%, 34rem);
}

.profile-dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.profile-dialog-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 1.25rem;
  font-weight: 950;
  letter-spacing: -0.02em;
}

.profile-dialog-head p {
  margin: 0.2rem 0 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.profile-dialog-body {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.75rem;
}

.profile-edit-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.profile-dialog-field {
  display: grid;
  gap: 0.25rem;
}

.profile-preview-box {
  padding: 0.7rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.86);
}

.profile-dialog-rule {
  margin: 0;
  padding: 0.45rem 0.55rem;
  border: 1px solid rgba(79, 70, 229, 0.12);
  border-radius: 10px;
  color: #3730a3;
  background: rgba(238, 242, 255, 0.86);
  font-size: 14px;
  font-weight: 850;
  line-height: 1.4;
}

.profile-status-line {
  padding: 0.35rem 0.55rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
}

.profile-status-line--strong {
  color: #4338ca;
  background: rgba(224, 231, 255, 0.7);
}

.profile-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
  margin-top: 0.75rem;
}

.profile-pricing-list {
  display: grid;
  gap: 0.45rem;
}

.profile-pricing-list > div {
  display: grid;
  gap: 0.15rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.86);
}

.profile-pricing-list span {
  color: #64748b;
  font-size: 14px;
  font-weight: 900;
}

.profile-pricing-list strong {
  color: #1e2a4a;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
}

.profile-page :deep(.tx-button),
.profile-dialog :deep(.tx-button) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border-radius: 10px;
  font-size: 14px;
}

.profile-page :deep(.tx-button .tx-button__inner),
.profile-dialog :deep(.tx-button .tx-button__inner) {
  gap: 0.25rem;
}

.profile-page :deep(.tx-input),
.profile-dialog :deep(.tx-input) {
  min-height: 2rem;
  border-radius: 10px;
  font-size: 14px;
}

.profile-page :deep(.tx-input__inner),
.profile-dialog :deep(.tx-input__inner) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  font-size: 14px;
}

.profile-page :deep(.tx-status-badge),
.profile-dialog :deep(.tx-status-badge) {
  min-height: 1.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 14px;
}

.dark .profile-card,
.dark .profile-dialog {
  border-color: rgba(56, 189, 248, 0.32);
  background: rgba(18, 18, 20, 0.98);
  box-shadow:
    0 0 0 1px rgba(59, 130, 246, 0.08),
    0 14px 34px rgba(0, 0, 0, 0.34);
}

.dark .profile-title,
.dark .profile-user-name,
.dark .profile-panel-head h3,
.dark .profile-card-head h3,
.dark .profile-trust-score,
.dark .profile-trust-meta strong,
.dark .profile-trust-summary,
.dark .profile-row-title,
.dark .profile-history-row strong,
.dark .profile-trust-next b,
.dark .profile-wallet-main strong,
.dark .profile-wallet-stats strong,
.dark .profile-dialog-head h3,
.dark .profile-setting-title {
  color: #f8fafc;
}

.dark .profile-subtitle,
.dark .profile-user-email,
.dark .profile-hint,
.dark .profile-panel-head p,
.dark .profile-card-head p,
.dark .profile-trust-reasons,
.dark .profile-trust-next,
.dark .profile-table-title-row span,
.dark .profile-setting-card p,
.dark .profile-form-hint,
.dark .profile-status-line,
.dark .profile-dialog-head p {
  color: #b6c2d3;
}

.dark .profile-user-button,
.dark .profile-trust-panel,
.dark .profile-setting-card,
.dark .profile-split-panel,
.dark .profile-invitees-box,
.dark .profile-history-row,
.dark .profile-preview-box,
.dark .profile-pricing-list > div {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
}

.dark .profile-user-button:hover,
.dark .profile-user-button:focus-visible {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(30, 41, 59, 0.82);
}

.dark .profile-wallet-panel {
  border-color: rgba(96, 165, 250, 0.24);
  background:
    radial-gradient(circle at 94% 0%, rgba(96, 165, 250, 0.28), transparent 34%),
    linear-gradient(135deg, rgba(8, 18, 38, 0.98), rgba(28, 39, 75, 0.96));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.dark .profile-member-card-stage img {
  filter: drop-shadow(0 18px 34px rgba(0, 0, 0, 0.3));
}

.dark .profile-carousel-arrow,
.dark .profile-member-carousel-dots button {
  border-color: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.6);
}

.dark .profile-member-carousel-dots button.is-active {
  border-color: rgba(96, 165, 250, 0.36);
  color: #bfdbfe;
  background: rgba(30, 64, 175, 0.32);
}

.dark .profile-wallet-stats > div,
.dark .profile-table,
.dark .profile-setting-icon {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
}

.dark .profile-description,
.dark .profile-balance-value,
.dark .profile-pricing-list strong {
  color: #cbd5e1;
}

.dark .profile-overline,
.dark .profile-section-label {
  color: #dbeafe;
}

.dark .profile-rule-link {
  color: #60a5fa;
}

.dark .profile-recharge-button {
  border-color: rgba(147, 197, 253, 0.78);
  color: #ffffff;
  background: linear-gradient(135deg, #2563eb, #0284c7);
  box-shadow: 0 12px 26px rgba(37, 99, 235, 0.32);
}

.dark .profile-recharge-panel span {
  color: #7dd3fc;
}

.dark .profile-table-row,
.dark .profile-invitee-row {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.dark .profile-table-head {
  background: rgba(255, 255, 255, 0.04);
}

.dark .profile-tabs :deep(.tx-tabs__nav) {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.dark .profile-tabs :deep(.tx-tab-item) {
  color: #b6c2d3;
}

.dark .profile-tabs :deep(.tx-tab-item.is-active) {
  color: #bfdbfe;
}

.dark .profile-split-panel > div + div {
  border-left-color: rgba(255, 255, 255, 0.1);
}

.dark .profile-empty {
  border-color: rgba(255, 255, 255, 0.16);
  color: #94a3b8;
}

.dark .profile-warning {
  color: #fde68a;
  background: rgba(146, 64, 14, 0.24);
}

.dark .profile-dialog-rule {
  border-color: rgba(129, 140, 248, 0.22);
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.12);
}

.dark .profile-status-line--strong {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.14);
}

@media (max-width: 1180px) {
  .profile-settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .profile-overview-grid,
  .profile-split-panel {
    grid-template-columns: 1fr;
  }

  .profile-split-panel > div + div {
    border-top: 1px solid rgba(99, 102, 241, 0.1);
    border-left: 0;
  }

  .dark .profile-split-panel > div + div {
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .profile-wallet-panel {
    min-height: auto;
  }
}

@media (max-width: 720px) {
  .profile-page-head {
    padding: 0;
  }

  .profile-title {
    font-size: 1.45rem;
  }

  .profile-overview-grid,
  .profile-card-head,
  .profile-settings-grid,
  .profile-invite-body,
  .profile-history-list {
    padding-right: 0.75rem;
    padding-left: 0.75rem;
  }

  .profile-tabs :deep(.tx-tabs__nav-bar) {
    padding-right: 0.35rem;
    padding-left: 0.35rem;
    overflow-x: auto;
  }

  .profile-overview-grid,
  .profile-card-head,
  .profile-settings-grid,
  .profile-invite-body,
  .profile-history-list {
    padding-right: 0.75rem;
    padding-left: 0.75rem;
  }

  .profile-card-head,
  .profile-wallet-main,
  .profile-trust-score-row,
  .profile-inviter-row,
  .profile-setting-action {
    align-items: stretch;
    flex-direction: column;
  }

  .profile-settings-grid,
  .profile-trust-meta,
  .profile-wallet-stats,
  .profile-edit-grid {
    grid-template-columns: 1fr;
  }

  .profile-recharge-panel {
    width: 100%;
  }

  .profile-inline-form {
    grid-template-columns: 1fr;
  }

  .profile-inline-form :deep(.tx-button),
  .profile-setting-action :deep(.tx-button) {
    width: 100%;
  }

  .profile-history-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
