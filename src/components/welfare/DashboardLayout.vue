<script setup lang="ts">
import { TxGradualBlur } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PageFooter from './PageFooter.vue'
import SideNav from './SideNav.vue'

const route = useRoute()
const isStandaloneInfoPage = computed(() => route.path.startsWith('/dashboard/square'))
const isApplyCreatePage = computed(() => route.path.startsWith('/dashboard/apply/create'))
const showFooter = computed(() => !isApplyCreatePage.value)
</script>

<template>
  <section class="dashboard-layout flex-1" :class="[isStandaloneInfoPage ? 'dashboard-layout--standalone' : 'dashboard-layout--with-sidebar', isApplyCreatePage ? 'dashboard-layout--apply-create' : '']">
    <SideNav v-if="!isStandaloneInfoPage" />
    <main class="dashboard-content min-w-0">
      <TxGradualBlur class="dashboard-content__blur" preset="page-header" position="top" target="parent" height="2.5rem" />
      <TxGradualBlur class="dashboard-content__blur" preset="page-footer" position="bottom" target="parent" height="2.5rem" />
      <div class="dashboard-content__inner">
        <RouterView />
        <PageFooter v-if="showFooter" class="dashboard-content__footer" />
      </div>
    </main>
  </section>
</template>
