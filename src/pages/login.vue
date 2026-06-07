<script setup lang="ts">
import AuthPanel from '~/components/welfare/AuthPanel.vue'
import PageShell from '~/components/welfare/PageShell.vue'
</script>

<template>
  <PageShell class="app-shell--login">
    <section class="mx-auto flex flex-1 max-w-sm w-full items-center">
      <AuthPanel />
    </section>
  </PageShell>
</template>
