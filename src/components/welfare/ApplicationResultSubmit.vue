<script setup lang="ts">
import type { ApplicationMessage } from '~/composables/welfare'
import { TxButton, TxCard, TxStatusBadge } from '@talex-touch/tuffex'
import { computed, ref } from 'vue'
import { formatDate } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const props = defineProps<{
  messages: ApplicationMessage[]
  applicationStatus: string
}>()

const emit = defineEmits<{
  submitResult: [content: string]
  complete: []
}>()

const { isAdmin } = useWelfareUiState()

const resultContent = ref('')
const submitting = ref(false)

const resultMessages = computed(() =>
  props.messages.filter(m => m.type === 'result_submission'),
)

const showSubmitForm = computed(() =>
  props.applicationStatus === 'answered',
)

function handleSubmitResult() {
  const content = resultContent.value.trim()
  if (!content)
    return

  submitting.value = true
  emit('submitResult', content)
  resultContent.value = ''
  submitting.value = false
}
</script>

<template>
  <TxCard v-if="showSubmitForm || resultMessages.length" class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
    <div class="mb-1 flex flex-wrap gap-3 items-start justify-between">
      <div>
        <h3 class="text-xl fw-900 flex gap-2 items-center">
          <span class="i-carbon-result" />
          结果提交
        </h3>
        <p class="text-sm text-slate-500 mt-1 dark:text-slate-400">
          申请已通过，请在此提交开通/交付的结果。可能需要多次提交直至全部完成。
        </p>
      </div>
      <TxStatusBadge
        v-if="resultMessages.length"
        :text="`已提交 ${resultMessages.length} 次`"
        status="info"
      />
    </div>

    <!-- Submitted results history -->
    <div v-if="resultMessages.length" class="mt-4 space-y-3">
      <div
        v-for="msg in resultMessages"
        :key="msg.id"
        class="p-4 border border-emerald-200 rounded-2xl bg-emerald-50/50 dark:border-emerald-400/20 dark:bg-emerald-950/10"
      >
        <div class="text-xs text-emerald-700 mb-2 flex gap-2 items-center dark:text-emerald-300">
          <span class="i-carbon-checkmark-outline" />
          <span class="fw-700">{{ formatDate(msg.createdAt) }}</span>
          <span class="text-emerald-400">· 第 {{ resultMessages.indexOf(msg) + 1 }} 次提交</span>
        </div>
        <RichTextView :content="msg.content" class="text-sm" />
      </div>
    </div>

    <!-- Submit form -->
    <div v-if="showSubmitForm" class="mt-5 pt-5 border-t border-black/8 dark:border-white/10">
      <RichTextEditor v-model="resultContent" placeholder="描述本次提交的交付物、开通状态或相关链接…" :min-height="150" />
      <div class="mt-4 flex flex-wrap gap-3 items-center justify-between">
        <span class="text-xs text-slate-400">
          结果会沉淀到沟通记录中，方便回溯
        </span>
        <div class="flex gap-3 items-center">
          <TxButton
            v-if="isAdmin && resultMessages.length > 0"
            variant="secondary"
            size="sm"
            @click="emit('complete')"
          >
            <span class="i-carbon-checkmark" />
            标记为已完成
          </TxButton>
          <TxButton
            variant="primary"
            size="sm"
            :disabled="!resultContent.trim() || submitting"
            @click="handleSubmitResult"
          >
            <span class="i-carbon-send" />
            提交结果
          </TxButton>
        </div>
      </div>
    </div>
  </TxCard>
</template>
