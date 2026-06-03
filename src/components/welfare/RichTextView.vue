<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeRichText } from '~/utils/rich-text'

const props = defineProps<{
  content?: string
}>()

const safeContent = computed(() => sanitizeRichText(props.content ?? ''))
</script>

<template>
  <div class="rich-text-view" v-html="safeContent" />
</template>
