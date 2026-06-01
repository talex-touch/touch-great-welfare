<script setup lang="ts">
import AuthPanel from '~/components/welfare/AuthPanel.vue'
import DashboardLayout from '~/components/welfare/DashboardLayout.vue'
import HeroPanel from '~/components/welfare/HeroPanel.vue'
import PageShell from '~/components/welfare/PageShell.vue'
import { useWelfareUiState } from '~/composables/welfare-ui'

const { hasAdmin } = useWelfareUiState()
</script>

<template>
  <PageShell>
    <section class="gap-6 grid lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
      <HeroPanel />
      <AuthPanel />
    </section>

    <DashboardLayout v-if="hasAdmin" />
  </PageShell>
</template>
