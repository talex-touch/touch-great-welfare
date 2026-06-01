<script setup lang="ts">
import SideNav from './SideNav.vue'
</script>

<template>
  <section class="mt-6 gap-6 grid lg:grid-cols-[260px_1fr]">
    <SideNav />

    <main class="min-w-0 space-y-6">
      <RouterView />
    </main>
  </section>
</template>
