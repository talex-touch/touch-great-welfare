<script setup lang="ts">
import type { ApplicationMessage } from '~/composables/welfare'
import { TxButton, TxCard } from '@talex-touch/tuffex'
import { computed, ref, watch } from 'vue'
import { formatBytes, formatDate, useWelfareStore } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const props = defineProps<{
  messages: ApplicationMessage[]
  applicationId: string
  applicationUserId: string
  applicationStatus: string
}>()

const emit = defineEmits<{
  send: [type: 'comment' | 'result_submission', content: string]
}>()

const welfare = useWelfareStore()
const { currentUser } = useWelfareUiState()

const newMessage = ref('')
const sending = ref(false)

const isActive = computed(() =>
  ['pending_review', 'processing', 'answered'].includes(props.applicationStatus))

const canPost = computed(() =>
  isActive.value && newMessage.value.trim().length > 0)

function userName(userId: string) {
  return welfare.state.users.find(u => u.id === userId)?.profile.displayName ?? '未知用户'
}

function isOwnMessage(msg: ApplicationMessage) {
  return msg.userId === currentUser.value?.id
}

function isAdminUser(userId: string) {
  return welfare.state.users.find(u => u.id === userId)?.role === 'admin'
}

function handleSend() {
  const content = newMessage.value.trim()
  if (!content || !isActive.value)
    return

  sending.value = true
  emit('send', 'comment', content)
  newMessage.value = ''
  sending.value = false
}

// Auto-scroll to bottom when new messages arrive
const threadEnd = ref<HTMLDivElement>()
watch(
  () => props.messages.length,
  () => {
    setTimeout(() => threadEnd.value?.scrollIntoView({ behavior: 'smooth' }), 50)
  },
)

const sortedMessages = computed(() =>
  [...props.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
)
</script>

<template>
  <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
    <h3 class="text-xl fw-900 mb-1">
      沟通记录
    </h3>
    <p class="text-sm text-slate-500 mb-5 dark:text-slate-400">
      申请人与管理员可以在此沟通，结果提交也会沉淀到此处。
    </p>

    <!-- Message timeline -->
    <div class="pr-1 max-h-[520px] overflow-y-auto space-y-4" :class="{ 'mb-4': isActive }">
      <div v-if="!sortedMessages.length" class="text-sm text-slate-400 py-8 text-center dark:text-slate-500">
        暂无沟通记录
      </div>

      <template v-for="msg in sortedMessages" :key="msg.id">
        <!-- System message -->
        <div v-if="msg.type === 'system'" class="flex justify-center">
          <div class="text-sm text-slate-600 px-4 py-2 rounded-2xl bg-slate-100 max-w-[70%] dark:text-slate-400 dark:bg-white/5">
            <div class="mb-1 flex gap-2 items-center">
              <span class="i-carbon-notification text-xs" />
              <span class="text-xs fw-700">系统通知</span>
              <span class="text-xs text-slate-400">{{ formatDate(msg.createdAt) }}</span>
            </div>
            <RichTextView :content="msg.content" />
          </div>
        </div>

        <!-- User/Admin message bubble -->
        <div v-else class="flex gap-3" :class="[isOwnMessage(msg) ? 'flex-row-reverse' : '']">
          <!-- Avatar -->
          <div
            class="text-xs fw-800 rounded-full flex shrink-0 h-8 w-8 items-center justify-center" :class="[
              isAdminUser(msg.userId) ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
            ]"
          >
            {{ isAdminUser(msg.userId) ? '管' : userName(msg.userId).charAt(0) }}
          </div>

          <div class="max-w-[70%]" :class="[isOwnMessage(msg) ? 'items-end' : '']">
            <!-- Meta -->
            <div class="text-xs mb-1 flex gap-2 items-center" :class="[isOwnMessage(msg) ? 'justify-end' : '']">
              <span class="fw-700">{{ userName(msg.userId) }}</span>
              <span v-if="isAdminUser(msg.userId)" class="text-[10px] text-amber-700 fw-700 px-1.5 py-0.5 rounded-full bg-amber-100 dark:text-amber-200 dark:bg-amber-900/30">
                管理员
              </span>
              <span class="text-slate-400">{{ formatDate(msg.createdAt) }}</span>
            </div>

            <!-- Bubble -->
            <div
              class="px-4 py-3 rounded-2xl" :class="[
                isOwnMessage(msg)
                  ? 'bg-blue-500 text-white rounded-tr-sm'
                  : 'bg-slate-100 dark:bg-white/5 rounded-tl-sm',
              ]"
            >
              <!-- Result submission badge -->
              <div v-if="msg.type === 'result_submission'" class="mb-2 flex gap-1.5 items-center">
                <span class="i-carbon-result text-xs" />
                <span class="text-[10px] fw-800 tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 uppercase">
                  结果提交
                </span>
              </div>

              <div :class="isOwnMessage(msg) ? '' : 'text-slate-700 dark:text-slate-300'">
                <RichTextView :content="msg.content" />
              </div>

              <!-- Attachments -->
              <div v-if="msg.attachments?.length" class="mt-3 space-y-1.5">
                <div
                  v-for="file in msg.attachments"
                  :key="file.id"
                  class="text-xs px-2.5 py-1.5 rounded-xl flex gap-2 items-center" :class="[
                    isOwnMessage(msg) ? 'bg-white/15' : 'bg-white dark:bg-black/10',
                  ]"
                >
                  <span class="i-carbon-attachment shrink-0" />
                  <span class="truncate">{{ file.name }}</span>
                  <span class="opacity-60 shrink-0">{{ formatBytes(file.size) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div ref="threadEnd" />
    </div>

    <!-- Input area -->
    <div v-if="isActive" class="pt-4 border-t border-black/8 dark:border-white/10">
      <RichTextEditor v-model="newMessage" placeholder="输入消息…" :min-height="80" />
      <div class="mt-3 flex gap-3 items-center justify-between">
        <span class="text-xs text-slate-400">支持富文本</span>
        <TxButton variant="primary" size="sm" :disabled="!canPost || sending" @click="handleSend">
          <span class="i-carbon-send" />
          发送
        </TxButton>
      </div>
    </div>

    <div v-else class="text-sm text-slate-400 pt-4 text-center border-t border-black/8 dark:text-slate-500 dark:border-white/10">
      当前状态不支持发送消息
    </div>
  </TxCard>
</template>
