<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ApplicationPanel from '~/components/welfare/ApplicationPanel.vue'

const route = useRoute()
const isNestedRoute = computed(() => route.path !== '/dashboard/apply')
</script>

<template>
  <RouterView v-if="isNestedRoute" />
  <ApplicationPanel v-else />
</template>
