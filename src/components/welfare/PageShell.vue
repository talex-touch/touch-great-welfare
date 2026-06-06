<script setup lang="ts">
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'
import SiteHeader from './SiteHeader.vue'

const { persistenceError } = useWelfareUiState()
const { toastMessage } = useWelfareFeedback()
</script>

<template>
  <div class="app-shell flex flex-col min-h-screen relative">
    <SiteHeader />

    <div class="app-main mx-auto px-2 pb-6 pt-2 flex flex-col max-w-7xl w-full relative z-10 lg:px-3">
      <div v-if="persistenceError" class="text-sm text-rose-900 leading-6 mb-2 p-2 border border-rose-400/30 rounded-xl bg-rose-50 dark:text-rose-200 dark:bg-rose-950/30">
        数据库状态加载失败：{{ persistenceError }}
      </div>

      <div class="flex flex-1 flex-col">
        <slot />
      </div>

      <footer class="text-sm text-slate-500 mt-4 pt-2 border-t border-black/8 flex flex-wrap gap-2 items-center justify-between dark:text-slate-400 dark:border-white/10">
        <div class="flex gap-2 items-center">
          <span>Powered by <a class="underline underline-offset-4" href="https://blog.tagzxia.com" target="_blank" rel="noreferrer">TaGzxia</a>.</span>
          <span>Built with <a class="underline underline-offset-4" href="https://github.com/talex-touch/tuffex" target="_blank" rel="noreferrer">tuffex</a>.</span>
        </div>
        <div>Link Welfare Copyright 2026</div>
      </footer>
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
