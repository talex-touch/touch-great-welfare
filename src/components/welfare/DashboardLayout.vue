<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SideNav from './SideNav.vue'

const route = useRoute()
const isStandaloneInfoPage = computed(() => route.path.startsWith('/dashboard/square'))
</script>

<template>
  <section class="dashboard-layout flex-1" :class="isStandaloneInfoPage ? 'dashboard-layout--standalone' : 'dashboard-layout--with-sidebar'">
    <SideNav v-if="!isStandaloneInfoPage" />
    <main class="dashboard-content min-w-0 space-y-2">
      <RouterView />
    </main>
  </section>
</template>
