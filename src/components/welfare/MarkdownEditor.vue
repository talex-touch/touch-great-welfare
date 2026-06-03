<script setup lang="ts">
import { computed } from 'vue'
import { markdownToSafeHtml } from '~/utils/markdown'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  minHeight?: number
}>(), {
  placeholder: '请输入 Markdown 内容',
  minHeight: 260,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const previewHtml = computed(() => markdownToSafeHtml(props.modelValue))
const textareaStyle = computed(() => ({
  minHeight: `${props.minHeight}px`,
}))

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="markdown-editor-shell">
    <div class="markdown-editor-pane">
      <div class="markdown-editor-heading">
        Markdown 编辑
      </div>
      <textarea
        class="form-textarea markdown-editor-textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :style="textareaStyle"
        @input="updateValue"
      />
    </div>
    <div class="markdown-preview-pane">
      <div class="markdown-editor-heading">
        预览
      </div>
      <div class="student-markdown-preview">
        <div v-if="previewHtml" class="markdown-body" v-html="previewHtml" />
        <div v-else class="field-hint">
          支持标题、列表、引用、加粗、链接和图片链接。
        </div>
      </div>
    </div>
  </div>
</template>
