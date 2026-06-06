<script setup lang="ts">
import { computed, ref } from 'vue'
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

const textareaRef = ref<HTMLTextAreaElement>()
const previewHtml = computed(() => markdownToSafeHtml(props.modelValue))
const textareaStyle = computed(() => ({
  minHeight: `${props.minHeight}px`,
}))

function clipboardImageFiles(event: ClipboardEvent) {
  return Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file)
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result || '')))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function updateValue(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

async function onPaste(event: ClipboardEvent) {
  const imageFiles = clipboardImageFiles(event)
  if (!imageFiles.length)
    return

  event.preventDefault()
  const textarea = textareaRef.value
  const start = textarea?.selectionStart ?? props.modelValue.length
  const end = textarea?.selectionEnd ?? start
  const markdown = (await Promise.all(imageFiles.map(fileToDataUrl)))
    .map((src, index) => `![粘贴图片 ${index + 1}](${src})`)
    .join('\n\n')
  const nextValue = `${props.modelValue.slice(0, start)}${markdown}${props.modelValue.slice(end)}`
  emit('update:modelValue', nextValue)
}
</script>

<template>
  <div class="markdown-editor-shell">
    <div class="markdown-editor-pane">
      <div class="markdown-editor-heading">
        Markdown 编辑
      </div>
      <textarea
        ref="textareaRef"
        class="form-textarea markdown-editor-textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :style="textareaStyle"
        @input="updateValue"
        @paste="onPaste"
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
