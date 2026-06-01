<script setup lang="ts">
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'
import SiteHeader from './SiteHeader.vue'

const { resetDemo } = useWelfareUiState()
const { toastMessage } = useWelfareFeedback()
</script>

<template>
  <div class="app-shell min-h-screen relative">
    <SiteHeader />

    <div class="mx-auto px-5 pb-18 pt-8 max-w-7xl relative z-10 lg:px-8">
      <slot />

      <footer class="text-sm text-slate-500 mt-12 pt-6 border-t border-black/8 flex flex-wrap gap-4 items-center justify-between dark:text-slate-400 dark:border-white/10">
        <div>Built with antfu/vitesse-lite, Vue 3, UnoCSS and @talex-touch/tuffex.</div>
        <div class="flex gap-3 items-center">
          <button class="underline underline-offset-4" @click="resetDemo">
            重置本地演示数据
          </button>
          <a class="underline underline-offset-4" href="https://github.com/antfu-collective/vitesse-lite" target="_blank" rel="noreferrer">Vitesse Lite</a>
        </div>
      </footer>
    </div>

    <Transition name="fade">
      <div v-if="toastMessage" class="text-sm text-white px-5 py-3 rounded-full bg-slate-950 max-w-[calc(100vw-2rem)] shadow-2xl bottom-6 left-1/2 fixed z-50 dark:text-slate-950 dark:bg-white -translate-x-1/2">
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
