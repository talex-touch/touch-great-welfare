<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareUiState } from '~/composables/welfare-ui'

const router = useRouter()
const { isNotificationDrawerOpen, selectedSection, refreshNotifications } = useWelfareUiState()

onMounted(() => {
  selectedSection.value = 'notifications'
  isNotificationDrawerOpen.value = true
  refreshNotifications().catch(() => {})
  router.replace('/dashboard/profile')
})
</script>

<template>
  <div />
</template>
