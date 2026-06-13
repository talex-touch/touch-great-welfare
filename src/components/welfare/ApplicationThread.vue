<script setup lang="ts">
import type { ApplicationMessage } from '~/composables/welfare'
import type { UploadLikeFile } from '~/composables/welfare-ui'
import { TxButton, TxFileUploader, TxStatusBadge, TxStep, TxSteps, TxTag, TxTextarea, TxTimeline, TxTimelineItem } from '@talex-touch/tuffex'
import { computed, ref, watch } from 'vue'
import { formatBytes, formatDate, useWelfareStore } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
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
  ['pending_review', 'needs_supplement', 'processing', 'answered', 'pending_allocation', 'delivered', 'submitted', 'in_review', 'approved', 'partial_approved'].includes(props.applicationStatus))

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

function messageTitle(msg: ApplicationMessage) {
  if (msg.type === 'system')
    return '系统通知'
  return `${isAdminUser(msg.userId) ? '管理员' : userName(msg.userId)}${isOwnMessage(msg) ? '（我）' : ''}`
}

function messageIcon(msg: ApplicationMessage) {
  if (msg.type === 'system')
    return 'notification'
  if (msg.type === 'supplement')
    return 'document-add'
  if (msg.type === 'result_submission')
    return 'result'
  return 'chat'
}

function messageColor(msg: ApplicationMessage) {
  if (msg.type === 'system')
    return 'default'
  if (msg.type === 'supplement')
    return 'warning'
  if (msg.type === 'result_submission')
    return 'success'
  return isOwnMessage(msg) ? 'primary' : 'default'
}

function messageTypeLabel(type: ApplicationMessage['type']) {
  if (type === 'supplement')
    return '补充材料'
  if (type === 'result_submission')
    return '结果提交'
  if (type === 'system')
    return '系统通知'
  return '消息'
}

function isAdminUser(userId: string) {
  return welfare.state.users.find(u => u.id === userId)?.role === 'admin'
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

const pipelineSteps = [
  { key: 'pending_review', label: '提交审核', description: '已进入队列' },
  { key: 'needs_supplement', label: '补充材料', description: '按需追加信息' },
  { key: 'answered', label: '通过答复', description: '审核处理结果' },
  { key: 'completed', label: '完成归档', description: '流程已结束' },
]

const activePipelineStep = computed(() => {
  const status = props.applicationStatus
  if (status === 'needs_supplement')
    return 1
  if (['answered', 'pending_allocation', 'delivered', 'approved', 'partial_approved'].includes(status))
    return 2
  if (status === 'completed')
    return 3
  return 0
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
  <section class="pt-1 gap-3 grid">
    <div class="flex flex-wrap gap-2 items-center justify-between">
      <div>
        <h3 class="text-base fw-900">
          协作线程
        </h3>
        <p class="text-xs text-slate-500 mt-1 dark:text-slate-400">
          审核、补充材料、交付结果沉淀在同一时间线中。
        </p>
      </div>
      <TxStatusBadge
        v-if="applicationType === 'pro'"
        :text="`免费补充 ${remainingFreeSupplements}/${postApprovalSupplementLimit ?? 0}`"
        status="info"
        size="sm"
      />
    </div>

    <TxSteps :active="activePipelineStep" size="small">
      <TxStep
        v-for="step in pipelineSteps"
        :key="step.key"
        :title="step.label"
        :description="step.description"
        :clickable="false"
      />
    </TxSteps>

    <div class="pr-1 max-h-[300px] overflow-y-auto">
      <div v-if="!sortedMessages.length" class="text-xs text-slate-400 py-4 text-center dark:text-slate-500">
        暂无沟通记录
      </div>

      <TxTimeline v-else>
        <TxTimelineItem
          v-for="msg in sortedMessages"
          :key="msg.id"
          :title="messageTitle(msg)"
          :time="formatDate(msg.createdAt)"
          :icon="messageIcon(msg)"
          :color="messageColor(msg)"
          :active="isOwnMessage(msg)"
        >
          <div class="gap-2 grid">
            <div class="flex flex-wrap gap-2 items-center">
              <TxTag :label="messageTypeLabel(msg.type)" size="sm" color="#475569" background="rgba(100,116,139,.12)" />
              <TxTag v-if="isAdminUser(msg.userId)" label="管理员" size="sm" color="#92400e" background="rgba(251,191,36,.18)" />
            </div>
            <RichTextView :content="msg.content" />
            <div v-if="msg.attachments?.length" class="flex flex-wrap gap-2">
              <TxTag
                v-for="file in msg.attachments"
                :key="file.id"
                :label="`${file.name} · ${formatBytes(file.size)}`"
                icon="attachment"
                size="sm"
                color="#475569"
                background="rgba(100,116,139,.12)"
              />
            </div>
          </div>
        </TxTimelineItem>
      </TxTimeline>

      <div ref="threadEnd" />
    </div>

    <div v-if="isActive" class="pt-3 border-t border-black/8 gap-2 grid dark:border-white/10">
      <TxTextarea v-model="newMessage" :placeholder="inputPlaceholder" :rows="3" resize="vertical" />
      <TxFileUploader
        v-model="messageFiles"
        :max="8"
        button-text="添加附件"
        drop-text="拖拽附件到这里"
        hint-text="可选，随消息一起提交。"
      />
      <div class="flex gap-3 items-center justify-between">
        <span class="text-xs text-slate-400">
          {{ shouldSendSupplement ? '将作为补充材料提交' : '支持文本和附件' }}
        </span>
        <TxButton variant="primary" size="sm" :disabled="!canPost || sending" @click="handleSend">
          <span class="i-carbon-send" />
          {{ shouldSendSupplement ? '提交补充' : '发送' }}
        </TxButton>
      </div>
    </div>

    <div v-else class="text-xs text-slate-400 pt-3 text-center border-t border-black/8 dark:text-slate-500 dark:border-white/10">
      当前状态不支持发送消息
    </div>
  </section>
</template>
