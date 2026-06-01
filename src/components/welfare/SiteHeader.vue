<script setup lang="ts">
import { TxButton } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toggleDark } from '~/composables/dark'
import { useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()
const router = useRouter()
const { currentUser, selectedSection, logout } = useWelfareUiState()

const navItems = [
  { key: 'apply', path: '/dashboard/apply', label: '申请' },
  { key: 'profile', path: '/dashboard/profile', label: '资料' },
  { key: 'student', path: '/dashboard/student', label: '学生认证' },
  { key: 'admin', path: '/dashboard/admin', label: '后台' },
] as const

const headerNavItems = computed(() => navItems.map(item => ({
  ...item,
  active: route.path === item.path,
})))

function goHeaderNav(item: typeof navItems[number]) {
  selectedSection.value = item.key
  router.push(item.path)
}

function onLogout() {
  const redirect = route.path.startsWith('/dashboard') ? route.fullPath : undefined
  logout()
  router.push({
    path: '/login',
    query: redirect ? { redirect } : undefined,
  })
}
</script>

<template>
  <header class="border-b border-black/6 bg-[#f7f5ef]/78 top-0 sticky z-20 backdrop-blur-2xl dark:border-white/8 dark:bg-[#06070a]/72">
    <div class="mx-auto px-5 py-4 flex max-w-7xl items-center justify-between lg:px-8">
      <div class="flex gap-3 items-center">
        <div class="text-emerald-300 rounded-2xl bg-slate-950 flex h-10 w-10 shadow-emerald-500/20 shadow-xl items-center justify-center dark:text-slate-950 dark:bg-white">
          <span class="i-carbon-security text-xl" />
        </div>
        <div>
          <div class="text-base fw-800 tracking-tight">
            Touch Great Welfare
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400">
            公益积分申请平台 · Vitesse Lite
          </div>
        </div>
      </div>

      <nav class="gap-2 hidden items-center md:flex">
        <button
          v-for="item in headerNavItems"
          :key="item.key"
          class="text-sm px-4 py-2 rounded-full transition"
          :class="item.active ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'"
          @click="goHeaderNav(item)"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="flex gap-2 items-center">
        <button class="icon-btn" title="Toggle dark" @click="toggleDark()">
          <span class="i-carbon-sun dark:i-carbon-moon" />
        </button>
        <TxButton v-if="currentUser" size="sm" variant="ghost" @click="onLogout">
          退出
        </TxButton>
      </div>
    </div>
  </header>
</template>
