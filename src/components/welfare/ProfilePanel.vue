<script setup lang="ts">
import { TxButton, TxCard, TxInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { formatDate } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { richTextToPlainText } from '~/utils/rich-text'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const {
  currentUser,
  currentUserLevelCard,
  profileForm,
  invitationForm,
  currentUserInviteCode,
  currentUserInvitationBinding,
  currentUserInviter,
  currentUserInvitees,
  currentUserInvitationBindDeadline,
  canBindCurrentUserInvitation,
  updateCurrentProfile,
  bindInvitationCode,
  vouchInvitation,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const profileDraftKey = 'welfare:profile-draft'
const PROFILE_TABS = {
  invitation: '邀请担保',
  loginHistory: '登录历史',
} as const
const isProfileDialogOpen = ref(false)
const activeProfileTab = ref(PROFILE_TABS.invitation)
let stopProfileDraft: (() => void) | undefined

const userInitial = computed(() => currentUser.value?.profile.displayName.slice(0, 1).toUpperCase() ?? '?')
const roleText = computed(() => {
  if (currentUser.value?.role === 'admin')
    return '管理员'
  if (currentUser.value?.role === 'reviewer')
    return '众包审核'
  return '用户'
})
const levelProgress = computed(() => {
  if (!currentUserLevelCard.value)
    return 0

  return Math.min(100, Math.round((currentUserLevelCard.value.score / currentUserLevelCard.value.maxScore) * 100))
})
const profileBioText = computed(() => richTextToPlainText(currentUser.value?.profile.bio ?? ''))
const hasProfileBio = computed(() => !!profileBioText.value)
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

function openProfileDialog() {
  if (!currentUser.value)
    return

  restoreLocalDraft(profileDraftKey, profileForm)
  isProfileDialogOpen.value = true
}

function closeProfileDialog() {
  isProfileDialogOpen.value = false
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeProfileDialog()
}

onMounted(() => {
  restoreLocalDraft(profileDraftKey, profileForm)
  stopProfileDraft = persistLocalDraft(profileDraftKey, profileForm)
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  stopProfileDraft?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="profile-page">
    <TxCard class="profile-card profile-card--hero" background="pure" shadow="soft" :padding="0" :radius="14">
      <div class="profile-hero-head">
        <div>
          <h2 class="profile-title">
            个人中心
          </h2>
          <p class="profile-subtitle">
            资料、登录身份和信任等级聚合展示，点击资料区域可编辑基础信息。
          </p>
        </div>
        <TxButton variant="primary" :disabled="!currentUser" @click="openProfileDialog">
          <span class="i-carbon-edit" />
          编辑资料
        </TxButton>
      </div>

      <div v-if="!currentUser" class="profile-empty profile-empty--hero">
        登录后可查看和编辑个人资料。
      </div>
      <div v-else class="profile-overview">
        <button
          class="profile-user-button"
          @click="openProfileDialog"
        >
          <span class="profile-avatar">
            <img v-if="currentUser.profile.avatar" :src="currentUser.profile.avatar" :alt="currentUser.profile.displayName" class="h-full w-full object-cover">
            <span v-else>{{ userInitial }}</span>
          </span>
          <span class="profile-user-copy">
            <span class="profile-user-name-row">
              <span class="profile-user-name">{{ currentUser.profile.displayName }}</span>
              <TxStatusBadge :text="roleText" :status="currentUser.role === 'admin' ? 'success' : 'info'" size="sm" />
            </span>
            <span class="profile-user-email">
              {{ currentUser.profile.email }}
            </span>
            <span v-if="hasProfileBio" class="profile-user-bio">
              {{ profileBioText }}
            </span>
            <span v-else class="profile-user-bio profile-user-bio--empty">
              暂未填写个人简介。
            </span>
          </span>
        </button>

        <div class="profile-trust-panel">
          <div class="profile-panel-head">
            <div>
              <h3>
                信任等级
              </h3>
              <p>
                审核优先级参考通过记录、认证状态和退回情况。
              </p>
            </div>
            <TxStatusBadge v-if="currentUserLevelCard" :text="currentUserLevelCard.name" :status="currentUserLevelCard.tone === 'warning' ? 'warning' : currentUserLevelCard.tone" size="sm" />
          </div>

          <div v-if="!currentUserLevelCard" class="profile-empty">
            登录后显示信任等级。
          </div>
          <div v-else class="profile-trust-body">
            <div class="profile-trust-score-row">
              <div class="profile-trust-score">
                {{ currentUserLevelCard.score }}
                <span>/ {{ currentUserLevelCard.maxScore }}</span>
              </div>
              <div class="profile-trust-priority">
                <div>
                  优先级
                </div>
                <strong>
                  {{ currentUserLevelCard.priority }}
                </strong>
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
    </TxCard>

    <TxCard class="profile-card profile-card--tabs" background="pure" shadow="soft" :padding="0" :radius="14">
      <TxTabs
        v-model="activeProfileTab"
        class="profile-tabs"
        :default-value="PROFILE_TABS.invitation"
        placement="top"
        indicator-variant="line"
        indicator-motion="glide"
        :content-padding="0"
        :content-scrollable="false"
        auto-height
        borderless
      >
        <TxTabItem :name="PROFILE_TABS.invitation" icon-class="i-carbon-user-multiple">
          <template #name>
            邀请担保
          </template>

          <div class="profile-tab-head">
            <div>
              <h3>邀请与担保</h3>
              <p>注册后 8 小时内可绑定邀请人；绑定后双方可互相担保，关系会长期用于审核复盘。</p>
            </div>
            <TxStatusBadge :text="currentUserInvitationBinding ? '已绑定' : canBindCurrentUserInvitation ? '可绑定' : '已过期'" :status="currentUserInvitationBinding ? 'success' : canBindCurrentUserInvitation ? 'info' : 'warning'" size="sm" />
          </div>

          <div v-if="!currentUser" class="profile-empty">
            登录后可查看邀请码。
          </div>
          <div v-else class="profile-tab-body">
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
                <div class="profile-hint">
                  邀请他人注册后，对方需在 8 小时内绑定该邀请码。
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

            <div>
              <div class="profile-table-title-row">
                <div class="profile-section-label">
                  我邀请的人
                </div>
                <span>{{ currentUserInvitees.length }} 个绑定</span>
              </div>
              <div class="admin-table profile-table">
                <div class="admin-table-row admin-table-head grid-cols-[minmax(0,1.2fr)_160px_160px_auto]">
                  <span>用户</span>
                  <span>绑定时间</span>
                  <span>担保状态</span>
                  <span>操作</span>
                </div>
                <div v-if="!currentUserInvitees.length" class="admin-empty">
                  暂无邀请绑定
                </div>
                <div v-for="item in currentUserInvitees" :key="item.binding.id" class="admin-table-row grid-cols-[minmax(0,1.2fr)_160px_160px_auto]">
                  <div class="min-w-0">
                    <div class="fw-800 truncate">
                      {{ item.user?.profile.displayName || item.binding.inviteeUserId }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ item.user?.profile.email || '未知邮箱' }}
                    </div>
                  </div>
                  <span>{{ formatDate(item.binding.createdAt) }}</span>
                  <span>{{ invitationGuaranteeText(item.binding) }}</span>
                  <TxButton size="sm" variant="secondary" :disabled="!!item.binding.inviterVouchedAt" @click="vouch(item.binding.id)">
                    {{ item.binding.inviterVouchedAt ? '已担保' : '为 TA 担保' }}
                  </TxButton>
                </div>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem :name="PROFILE_TABS.loginHistory" icon-class="i-carbon-time">
          <template #name>
            登录历史
          </template>

          <div class="profile-tab-head">
            <div>
              <h3>登录历史</h3>
              <p>展示最近登录、账号创建和第三方授权记录。</p>
            </div>
            <TxStatusBadge :text="`${loginHistoryRows.length} 条记录`" status="info" size="sm" />
          </div>

          <div class="profile-tab-body">
            <div v-if="!currentUser" class="profile-empty">
              登录后可查看登录历史。
            </div>
            <div v-else class="profile-history-list">
              <div v-for="row in loginHistoryRows" :key="row.id" class="profile-history-row">
                <div>
                  <span class="profile-row-title">{{ row.title }}</span>
                  <small>{{ row.detail }}</small>
                </div>
                <strong>{{ formatDate(row.at) }}</strong>
              </div>
            </div>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>

    <Teleport to="body">
      <Transition name="dialog-shell">
        <div v-if="isProfileDialogOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeProfileDialog">
          <div class="dialog-surface solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-3xl w-full overflow-auto">
            <div class="flex gap-4 items-start justify-between">
              <div>
                <h3 class="text-2xl fw-900 tracking-tight">
                  编辑个人信息
                </h3>
                <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                  保存后会更新公开展示资料；草稿会临时保存在本地浏览器。
                </p>
              </div>
              <button class="icon-btn shrink-0" title="关闭" @click="closeProfileDialog">
                <span class="i-carbon-close" />
              </button>
            </div>

            <div class="mt-6 gap-5 grid md:grid-cols-2">
              <div class="md:col-span-2">
                <DataNotice mode="compact" title="个人资料保存提示" />
              </div>
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
                <RichTextEditor v-model="profileForm.bio" :min-height="180" placeholder="你的公益方向、技能栈、所在组织等" />
                <span class="field-hint">个人简介请避免填写身份证号、住址、生产密钥、未公开课题或其他无法公开处理的信息。</span>
              </label>
              <div v-if="profileForm.bio" class="md:col-span-2">
                <div class="field-label mb-2">
                  简介预览
                </div>
                <div class="p-4 border border-black/8 rounded-2xl bg-white dark:border-white/10 dark:bg-[#151820]">
                  <RichTextView :content="profileForm.bio" />
                </div>
              </div>
              <div class="flex flex-wrap gap-3 justify-end md:col-span-2">
                <TxButton variant="ghost" @click="closeProfileDialog">
                  取消
                </TxButton>
                <TxButton variant="primary" @click="saveProfile">
                  保存个人信息
                </TxButton>
              </div>
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
  gap: 0.45rem;
  font-size: 14px;
}

.profile-card {
  overflow: hidden;
  border: 1px solid rgba(99, 102, 241, 0.1);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.profile-hero-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 1rem 1.15rem 0.7rem;
}

.profile-title {
  margin: 0;
  color: #0f172a;
  font-size: 1.35rem;
  font-weight: 950;
  letter-spacing: 0;
}

.profile-subtitle {
  margin: 0.2rem 0 0;
  color: #718096;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.profile-overview {
  display: grid;
  gap: 0.75rem;
  margin: 0.45rem 1.15rem 1.15rem;
}

.profile-user-button,
.profile-trust-panel,
.profile-split-panel,
.profile-history-row {
  border: 1px solid rgba(99, 102, 241, 0.1);
  border-radius: 12px;
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
  width: 4rem;
  height: 4rem;
  overflow: hidden;
  border-radius: 14px;
  color: #ffffff;
  background: #1d1d1f;
  font-size: 1.3rem;
  font-weight: 900;
}

.profile-user-copy {
  min-width: 0;
}

.profile-user-name-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.profile-user-name {
  min-width: 0;
  overflow: hidden;
  color: #111827;
  font-size: 1.05rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-user-email,
.profile-user-bio,
.profile-hint,
.profile-trust-reasons,
.profile-trust-next,
.profile-tab-head p,
.profile-table-title-row span {
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.profile-user-email {
  display: block;
  margin-top: 0.12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-user-bio {
  display: -webkit-box;
  margin-top: 0.55rem;
  overflow: hidden;
  color: #475569;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.profile-user-bio--empty {
  color: #94a3b8;
}

.profile-trust-panel {
  padding: 0.75rem;
}

.profile-panel-head,
.profile-trust-score-row,
.profile-tab-head,
.profile-inviter-row,
.profile-table-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.profile-panel-head h3,
.profile-tab-head h3 {
  margin: 0;
  color: #111827;
  font-size: 1rem;
  font-weight: 950;
}

.profile-panel-head p {
  margin: 0.15rem 0 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
}

.profile-trust-body {
  margin-top: 0.55rem;
}

.profile-trust-score {
  color: #111a44;
  font-size: 2.45rem;
  font-weight: 950;
  line-height: 0.95;
}

.profile-trust-score span {
  color: #64748b;
  font-size: 1rem;
  font-weight: 850;
}

.profile-trust-priority {
  color: #64748b;
  font-size: 14px;
  font-weight: 800;
  text-align: right;
}

.profile-trust-priority strong {
  display: block;
  margin-top: 0.05rem;
  color: #111a44;
  font-size: 1.25rem;
  font-weight: 950;
}

.profile-progress {
  height: 0.45rem;
  margin-top: 0.55rem;
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
  margin-top: 0.55rem;
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

.profile-tabs :deep(.tx-tabs__nav) {
  margin: 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.profile-tabs :deep(.tx-tabs__nav-bar) {
  padding: 0 0.5rem;
  background: transparent;
}

.profile-tabs :deep(.tx-tab-item) {
  min-height: 2.2rem;
  margin: 0 0.35rem 0 0;
  padding: 0.25rem 0.5rem;
  color: #64748b;
  font-size: 14px;
  font-weight: 900;
}

.profile-tabs :deep(.tx-tab-item.is-active) {
  color: #3730a3;
}

.profile-tab-head,
.profile-tab-body {
  margin: 0.45rem 0.6rem 0;
}

.profile-tab-body {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 0.6rem;
}

.profile-tab-head h3 {
  font-size: 1.05rem;
}

.profile-tab-head p {
  margin: 0.15rem 0 0;
}

.profile-split-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
}

.profile-split-panel > div {
  min-width: 0;
  padding: 0.65rem;
}

.profile-split-panel > div + div {
  border-left: 1px solid rgba(99, 102, 241, 0.1);
}

.profile-section-label {
  display: block;
  color: #1e2a4a;
  font-size: 14px;
  font-weight: 900;
}

.profile-inline-form,
.profile-bind-group {
  display: grid;
  gap: 0.3rem;
}

.profile-inline-form {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  margin-top: 0.35rem;
}

.profile-inviter-row,
.profile-bind-group {
  margin-top: 0.35rem;
}

.profile-row-title {
  color: #1e293b;
  font-size: 14px;
  font-weight: 900;
}

.profile-warning {
  padding: 0.35rem 0.5rem;
  border-radius: 10px;
  color: #92400e;
  background: #fef3c7;
  font-size: 14px;
  font-weight: 850;
  line-height: 1.35;
}

.profile-table-title-row {
  align-items: center;
}

.profile-table {
  margin-top: 0.35rem;
  overflow-x: auto;
}

.profile-history-list {
  display: grid;
  gap: 0.35rem;
}

.profile-history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
}

.profile-history-row small {
  display: block;
  margin-top: 0.1rem;
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
  padding: 0.5rem;
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: 12px;
  color: #64748b;
  text-align: center;
  font-size: 14px;
  font-weight: 850;
}

.profile-empty--hero {
  margin: 0.35rem 0.75rem 0.75rem;
}

.profile-page :deep(.tx-button) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  border-radius: 10px;
  font-size: 14px;
}

.profile-page :deep(.tx-button .tx-button__inner) {
  gap: 0.25rem;
}

.profile-page :deep(.tx-input) {
  min-height: 2rem;
  border-radius: 10px;
  font-size: 14px;
}

.profile-page :deep(.tx-input__inner) {
  min-height: 2rem;
  padding: 0.25rem 0.5rem;
  font-size: 14px;
}

.profile-page :deep(.tx-status-badge) {
  min-height: 1.35rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 14px;
}

.dark .profile-card {
  border-color: rgba(56, 189, 248, 0.32);
  background: rgba(18, 18, 20, 0.98);
  box-shadow:
    0 0 0 1px rgba(59, 130, 246, 0.08),
    0 14px 34px rgba(0, 0, 0, 0.34);
}

.dark .profile-title,
.dark .profile-user-name,
.dark .profile-panel-head h3,
.dark .profile-tab-head h3,
.dark .profile-trust-score,
.dark .profile-trust-priority strong,
.dark .profile-trust-summary,
.dark .profile-row-title,
.dark .profile-history-row strong,
.dark .profile-trust-next b {
  color: #f8fafc;
}

.dark .profile-subtitle,
.dark .profile-user-email,
.dark .profile-hint,
.dark .profile-panel-head p,
.dark .profile-tab-head p,
.dark .profile-trust-reasons,
.dark .profile-trust-next,
.dark .profile-table-title-row span {
  color: #b6c2d3;
}

.dark .profile-user-button,
.dark .profile-trust-panel,
.dark .profile-split-panel,
.dark .profile-history-row {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
}

.dark .profile-user-button:hover,
.dark .profile-user-button:focus-visible {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(30, 41, 59, 0.82);
}

.dark .profile-section-label {
  color: #dbeafe;
}

.dark .profile-user-bio,
.dark .profile-history-row small,
.dark .profile-trust-score span,
.dark .profile-trust-priority {
  color: #94a3b8;
}

.dark .profile-progress {
  background: rgba(255, 255, 255, 0.1);
}

.dark .profile-tabs :deep(.tx-tabs__nav) {
  border-bottom-color: rgba(255, 255, 255, 0.08);
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

@media (max-width: 960px) {
  .profile-overview,
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
}

@media (max-width: 720px) {
  .profile-hero-head {
    padding: 0.85rem 0.85rem 0.55rem;
  }

  .profile-overview {
    margin: 0.35rem 0.85rem 0.85rem;
  }

  .profile-tabs :deep(.tx-tabs__nav-bar) {
    padding: 0 0.35rem;
    overflow-x: auto;
  }

  .profile-tab-head,
  .profile-tab-body {
    margin-right: 0.5rem;
    margin-left: 0.5rem;
  }

  .profile-tab-head,
  .profile-inviter-row {
    align-items: stretch;
    flex-direction: column;
  }

  .profile-inline-form {
    grid-template-columns: 1fr;
  }

  .profile-inline-form :deep(.tx-button) {
    width: 100%;
  }
}
</style>
