<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SideNav from './SideNav.vue'

const route = useRoute()
const isStandaloneInfoPage = computed(() => route.path.startsWith('/dashboard/square'))
</script>

<template>
  <section class="mt-1 flex-1 gap-2 grid" :class="isStandaloneInfoPage ? '' : 'lg:grid-cols-[260px_minmax(0,1fr)]'">
    <SideNav v-if="!isStandaloneInfoPage" />
    <main class="dashboard-content min-w-0 space-y-2">
      <RouterView />
    </main>
  </section>
</template>
