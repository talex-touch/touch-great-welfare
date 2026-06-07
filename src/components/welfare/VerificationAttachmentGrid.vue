<script setup lang="ts">
import type { AttachmentMeta } from '~/composables/welfare'
import { computed, ref } from 'vue'
import { formatBytes } from '~/composables/welfare'

const props = defineProps<{
  files: AttachmentMeta[]
}>()

const selectedFile = ref<AttachmentMeta | null>(null)

const gridClass = computed(() => {
  const count = props.files.length
  if (count === 1)
    return 'verification-attachment-grid--single'
  if (count === 2 || count === 4)
    return 'verification-attachment-grid--pairs'
  return 'verification-attachment-grid--nine'
})

function isPreviewableImage(file: AttachmentMeta) {
  return file.type.startsWith('image/') && !!(file.url || file.dataUrl)
}

function previewSource(file: AttachmentMeta) {
  return file.url || file.dataUrl || ''
}

function openPreview(file: AttachmentMeta) {
  selectedFile.value = file
}

function closePreview() {
  selectedFile.value = null
}
</script>

<template>
  <div class="verification-attachment-grid" :class="gridClass">
    <button
      v-for="file in files"
      :key="file.id"
      class="verification-attachment-tile"
      type="button"
      :aria-label="`预览材料 ${file.name}`"
      @click="openPreview(file)"
    >
      <img v-if="isPreviewableImage(file)" :src="previewSource(file)" :alt="file.name" loading="lazy">
      <span v-else class="verification-attachment-placeholder">
        <span class="i-carbon-image" />
        <small>{{ file.type || '未知类型' }}</small>
      </span>
      <span class="verification-attachment-name">{{ file.name }}</span>
    </button>
  </div>

  <Teleport to="body">
    <Transition name="dialog-shell">
      <div v-if="selectedFile" class="verification-attachment-preview-backdrop" @click.self="closePreview">
        <div class="verification-attachment-preview dialog-surface" role="dialog" aria-modal="true" aria-labelledby="verification-attachment-preview-title">
          <div class="verification-attachment-preview__head">
            <div class="min-w-0">
              <h3 id="verification-attachment-preview-title">
                {{ selectedFile.name }}
              </h3>
              <p>{{ formatBytes(selectedFile.size) }} · {{ selectedFile.type || '未知类型' }}</p>
            </div>
            <button type="button" aria-label="关闭预览" @click="closePreview">
              <span class="i-carbon-close" />
            </button>
          </div>
          <div class="verification-attachment-preview__body">
            <img v-if="isPreviewableImage(selectedFile)" :src="previewSource(selectedFile)" :alt="selectedFile.name">
            <div v-else class="verification-attachment-preview__empty">
              <span class="i-carbon-document-attachment" />
              <b>该材料不是可直接预览的图片</b>
              <small>已保留文件名、大小和类型信息。</small>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
