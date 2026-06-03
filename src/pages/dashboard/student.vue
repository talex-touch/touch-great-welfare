<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StudentPanel from '~/components/welfare/StudentPanel.vue'

const route = useRoute()
const isCreateRoute = computed(() => route.path === '/dashboard/student/create')
</script>

<template>
  <RouterView v-if="isCreateRoute" />
  <StudentPanel v-else />
</template>
