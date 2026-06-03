<script setup lang="ts">
import { TxButton, TxCard, TxInput, TxStatusBadge } from '@talex-touch/tuffex'
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
  temporaryAiKey,
  temporaryAiKeyExpiresAt,
  updateCurrentProfile,
  generateTemporaryAiKey,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const profileDraftKey = 'welfare:profile-draft'
const isProfileDialogOpen = ref(false)
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

function createTemporaryKey() {
  runSafely(() => generateTemporaryAiKey(), '临时 API Key 已生成')
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
  <section class="gap-6 grid xl:grid-cols-[minmax(0,1fr)_380px]">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            个人信息
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看资料概览，点击卡片后编辑显示名称、邮箱和个人简介。
          </p>
        </div>
        <TxButton variant="primary" :disabled="!currentUser" @click="openProfileDialog">
          <span class="i-carbon-edit" />
          编辑资料
        </TxButton>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可查看和编辑个人资料。
      </div>
      <button
        v-else
        class="mt-6 p-5 text-left border border-black/8 rounded-3xl bg-white gap-5 grid w-full transition dark:border-white/10 hover:border-amber-400/60 dark:bg-[#151820] sm:grid-cols-[auto_1fr] hover:shadow-amber-500/8 hover:shadow-lg"
        @click="openProfileDialog"
      >
        <span class="text-2xl text-white rounded-3xl bg-[#1D1D1F] flex h-18 w-18 items-center justify-center overflow-hidden">
          <img v-if="currentUser.profile.avatar" :src="currentUser.profile.avatar" :alt="currentUser.profile.displayName" class="h-full w-full object-cover">
          <span v-else>{{ userInitial }}</span>
        </span>
        <span class="min-w-0">
          <span class="flex flex-wrap gap-2 items-center">
            <span class="text-2xl fw-900 truncate">{{ currentUser.profile.displayName }}</span>
            <TxStatusBadge :text="roleText" :status="currentUser.role === 'admin' ? 'success' : 'info'" size="sm" />
          </span>
          <span class="text-sm text-slate-500 mt-1 block truncate dark:text-slate-400">
            {{ currentUser.profile.email }}
          </span>
          <span v-if="hasProfileBio" class="text-sm text-slate-600 leading-6 mt-4 block line-clamp-3 dark:text-slate-300">
            {{ profileBioText }}
          </span>
          <span v-else class="text-sm text-slate-500 leading-6 mt-4 block dark:text-slate-400">
            暂未填写个人简介。
          </span>
          <span class="text-xs text-amber-700 fw-800 mt-4 inline-flex gap-2 items-center dark:text-amber-300">
            <span class="i-carbon-edit" />
            点击编辑资料
          </span>
        </span>
      </button>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="22" :radius="28">
      <div class="flex gap-3 items-start justify-between">
        <div>
          <h3 class="text-xl fw-900">
            信任卡片等级
          </h3>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            审核优先级会参考通过记录、认证状态和退回情况。
          </p>
        </div>
        <TxStatusBadge v-if="currentUserLevelCard" :text="currentUserLevelCard.name" :status="currentUserLevelCard.tone === 'warning' ? 'warning' : currentUserLevelCard.tone" size="sm" />
      </div>

      <div v-if="!currentUserLevelCard" class="text-slate-500 mt-6 p-6 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
        登录后显示信任等级。
      </div>
      <div v-else class="mt-6">
        <div class="text-5xl fw-900 tracking-tight">
          {{ currentUserLevelCard.score }}
          <span class="text-lg text-slate-500 fw-800">/ {{ currentUserLevelCard.maxScore }}</span>
        </div>
        <div class="mt-4 rounded-full bg-slate-100 h-3 overflow-hidden dark:bg-white/10">
          <div class="rounded-full bg-[#FFB000] h-full" :style="{ width: `${levelProgress}%` }" />
        </div>
        <div class="mt-4 p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-400/10">
          <div class="text-sm fw-900">
            {{ currentUserLevelCard.summary }}
          </div>
          <div class="text-xs text-slate-600 leading-5 mt-2 dark:text-slate-300">
            {{ currentUserLevelCard.reasons.join(' / ') }}
          </div>
        </div>
        <div class="mt-4 gap-3 grid grid-cols-2">
          <div class="p-3 rounded-2xl bg-white dark:bg-[#151820]">
            <div class="text-xs text-slate-500">
              优先级
            </div>
            <div class="text-2xl fw-900 mt-1">
              {{ currentUserLevelCard.priority }}
            </div>
          </div>
          <div class="p-3 rounded-2xl bg-white dark:bg-[#151820]">
            <div class="text-xs text-slate-500">
              下一等级
            </div>
            <div class="text-sm fw-900 mt-2">
              {{ currentUserLevelCard.next?.name ?? '已达最高' }}
            </div>
          </div>
        </div>
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        账号状态
      </h3>
      <div class="mt-4 p-4 rounded-2xl bg-white flex gap-4 items-start justify-between dark:bg-[#151820]">
        <div>
          <div class="text-sm fw-800">
            登录身份
          </div>
          <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
            {{ currentUser?.profile.email ?? '未登录' }}
          </div>
        </div>
        <TxStatusBadge :text="roleText" :status="currentUser?.role === 'admin' ? 'success' : 'info'" size="sm" />
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="20" :radius="28">
      <h3 class="text-xl fw-900">
        临时 API Key
      </h3>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        用于短时调用 NewAPI 映射能力，Key 只展示一次。
      </p>
      <TxButton class="mt-4" variant="secondary" :disabled="!currentUser" @click="createTemporaryKey">
        生成临时 Key
      </TxButton>
      <div v-if="temporaryAiKey" class="text-xs leading-5 mt-4 p-3 rounded-2xl bg-slate-100 break-all dark:bg-white/10">
        <div class="fw-800">
          {{ temporaryAiKey }}
        </div>
        <div class="text-slate-500 mt-2">
          过期时间：{{ formatDate(temporaryAiKeyExpiresAt) }}
        </div>
      </div>
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
