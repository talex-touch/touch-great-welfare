<script setup lang="ts">
import type { ApplicationMessage } from '~/composables/welfare'
import type { UploadLikeFile } from '~/composables/welfare-ui'
import { TxButton, TxCard, TxStatusBadge } from '@talex-touch/tuffex'
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
  applicationType: string
  postApprovalSupplementLimit?: number
  postApprovalSupplementCount?: number
}>()

const emit = defineEmits<{
  send: [type: 'comment' | 'supplement' | 'result_submission', content: string, attachments: UploadLikeFile[]]
}>()

const welfare = useWelfareStore()
const { currentUser } = useWelfareUiState()

const newMessage = ref('')
const messageFiles = ref<UploadLikeFile[]>([])
const sending = ref(false)

const isActive = computed(() =>
  ['pending_review', 'needs_supplement', 'processing', 'answered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(props.applicationStatus))

const remainingFreeSupplements = computed(() =>
  Math.max(0, (props.postApprovalSupplementLimit ?? 0) - (props.postApprovalSupplementCount ?? 0)))

const shouldSendSupplement = computed(() =>
  props.applicationStatus === 'needs_supplement'
  || (props.applicationType === 'pro' && props.applicationStatus === 'answered' && remainingFreeSupplements.value > 0))

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

function handleSelectFiles(event: Event) {
  const input = event.target instanceof HTMLInputElement ? event.target : undefined
  const files = Array.from(input?.files ?? [])
  messageFiles.value = [
    ...messageFiles.value,
    ...files.map(file => ({
      id: `msg_file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      file,
    })),
  ]
  if (input)
    input.value = ''
}

function removeMessageFile(id: string) {
  messageFiles.value = messageFiles.value.filter(file => file.id !== id)
}

function handleSend() {
  const content = newMessage.value.trim()
  if (!content || !isActive.value)
    return

  sending.value = true
  emit('send', shouldSendSupplement.value ? 'supplement' : 'comment', content, [...messageFiles.value])
  newMessage.value = ''
  messageFiles.value = []
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

const pipelineSteps = computed(() => {
  const status = props.applicationStatus
  return [
    { key: 'pending_review', label: '提交审核', done: ['pending_review', 'submitted', 'in_review', 'needs_supplement', 'processing', 'answered', 'approved', 'partial_approved', 'completed'].includes(status), active: status === 'pending_review' || status === 'submitted' || status === 'in_review' },
    { key: 'needs_supplement', label: '补充材料', done: ['processing', 'answered', 'approved', 'partial_approved', 'completed'].includes(status), active: status === 'needs_supplement' },
    { key: 'answered', label: '通过答复', done: ['answered', 'approved', 'partial_approved', 'completed'].includes(status), active: status === 'answered' || status === 'approved' || status === 'partial_approved' },
    { key: 'completed', label: '完成归档', done: status === 'completed', active: status === 'completed' },
  ]
})

const inputPlaceholder = computed(() => {
  if (props.applicationStatus === 'needs_supplement')
    return '按管理员要求补充材料、说明或链接…'
  if (props.applicationType === 'pro' && props.applicationStatus === 'answered' && remainingFreeSupplements.value > 0)
    return '补充一次通过后的材料或回复，本次不扣积分…'
  return '输入消息…'
})
</script>

<template>
  <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
    <div class="mb-5 flex flex-wrap gap-3 items-start justify-between">
      <div>
        <h3 class="text-xl fw-900 mb-1">
          协作线程
        </h3>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          审核、补充材料、交付结果都会沉淀在同一条时间线中。
        </p>
      </div>
      <TxStatusBadge
        v-if="applicationType === 'pro'"
        :text="`免费补充 ${remainingFreeSupplements}/${postApprovalSupplementLimit ?? 0}`"
        status="info"
      />
    </div>

    <div class="mb-5 gap-2 grid md:grid-cols-4">
      <div
        v-for="step in pipelineSteps"
        :key="step.key"
        class="text-sm px-3 py-2 border rounded-2xl flex gap-2 items-center" :class="[
          step.active
            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/20 dark:text-amber-100'
            : step.done
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-950/10 dark:text-emerald-100'
              : 'border-black/8 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
        ]"
      >
        <span :class="step.done ? 'i-carbon-checkmark-outline' : step.active ? 'i-carbon-time' : 'i-carbon-circle-dash'" />
        <span class="fw-800">{{ step.label }}</span>
      </div>
    </div>

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
              <div v-if="msg.type === 'result_submission' || msg.type === 'supplement'" class="mb-2 flex gap-1.5 items-center">
                <span :class="msg.type === 'supplement' ? 'i-carbon-document-add text-xs' : 'i-carbon-result text-xs'" />
                <span class="text-[10px] fw-800 tracking-wider px-1.5 py-0.5 rounded-full bg-white/20 uppercase">
                  {{ msg.type === 'supplement' ? '补充材料' : '结果提交' }}
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
      <RichTextEditor v-model="newMessage" :placeholder="inputPlaceholder" :min-height="96" />
      <div v-if="messageFiles.length" class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="file in messageFiles"
          :key="file.id"
          type="button"
          class="text-xs px-2.5 py-1.5 rounded-xl bg-slate-100 flex gap-2 items-center dark:bg-white/5"
          @click="removeMessageFile(file.id)"
        >
          <span class="i-carbon-attachment shrink-0" />
          <span class="max-w-[180px] truncate">{{ file.name }}</span>
          <span class="opacity-60 shrink-0">{{ formatBytes(file.size) }}</span>
          <span class="i-carbon-close shrink-0" />
        </button>
      </div>
      <div class="mt-3 flex gap-3 items-center justify-between">
        <span class="text-xs text-slate-400">
          {{ shouldSendSupplement ? '将作为补充材料提交并进入审核时间线' : '支持富文本和附件' }}
        </span>
        <div class="flex gap-2 items-center">
          <label class="text-xs px-3 py-1.5 rounded-xl bg-slate-100 cursor-pointer dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10">
            <input class="hidden" type="file" multiple @change="handleSelectFiles">
            <span class="i-carbon-attachment mr-1 align-middle" />
            附件
          </label>
          <TxButton variant="primary" size="sm" :disabled="!canPost || sending" @click="handleSend">
            <span class="i-carbon-send" />
            {{ shouldSendSupplement ? '提交补充' : '发送' }}
          </TxButton>
        </div>
      </div>
    </div>

    <div v-else class="text-sm text-slate-400 pt-4 text-center border-t border-black/8 dark:text-slate-500 dark:border-white/10">
      当前状态不支持发送消息
    </div>
  </TxCard>
</template>
