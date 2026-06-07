<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'
import PageFooter from './PageFooter.vue'
import SiteHeader from './SiteHeader.vue'

const route = useRoute()
const { persistenceError, activeSiteBanner } = useWelfareUiState()
const { toastMessage } = useWelfareFeedback()
const isDashboardShell = computed(() => route.path.startsWith('/dashboard'))
const showFooter = computed(() => !isDashboardShell.value && !route.path.startsWith('/dashboard/apply/create'))
</script>

<template>
  <div class="app-shell flex flex-col min-h-screen relative" :class="[activeSiteBanner ? 'app-shell--with-banner' : '', isDashboardShell ? 'app-shell--dashboard' : '']">
    <SiteHeader />

    <div
      class="app-main w-full relative z-10"
      :class="isDashboardShell ? 'app-main--dashboard flex flex-col' : 'mx-auto px-2 pb-6 pt-2 flex flex-col max-w-7xl lg:px-3'"
    >
      <div
        v-if="persistenceError"
        class="text-sm text-rose-900 leading-6 mb-2 p-2 border border-rose-400/30 rounded-xl bg-rose-50 dark:text-rose-200 dark:bg-rose-950/30"
        :class="isDashboardShell ? 'mx-4 mt-3' : ''"
      >
        数据库状态加载失败：{{ persistenceError }}
      </div>

      <div class="app-main__body flex flex-1 flex-col">
        <slot />
      </div>

      <PageFooter v-if="showFooter" class="mt-4" />
    </div>

    <Transition name="fade">
      <div v-if="toastMessage" class="text-sm text-white px-3 py-2 rounded-full bg-slate-950 max-w-[calc(100vw-2rem)] shadow-2xl bottom-3 left-1/2 fixed z-50 dark:text-slate-950 dark:bg-white -translate-x-1/2">
        {{ toastMessage }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: all 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
