<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toggleDark } from '~/composables/dark'
import { useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()
const router = useRouter()
const { currentUser, logout, unreadNotificationCount, refreshNotifications, selectedSection } = useWelfareUiState()
const isUserMenuOpen = ref(false)
const userMenuNavItems = [
  { key: 'apply', path: '/dashboard/apply', icon: 'i-carbon-document-attachment', label: '我的申请' },
  { key: 'wallet', path: '/dashboard/wallet', icon: 'i-carbon-wallet', label: '钱包充值' },
  { key: 'openSource', path: '/dashboard/open-source', icon: 'i-carbon-logo-github', label: '开源认证' },
] as const
const accountMenuNavItems = [
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人信息' },
  { key: 'notifications', path: '/dashboard/notifications', icon: 'i-carbon-notification', label: '消息中心' },
  { key: 'notificationSettings', path: '/dashboard/notification-settings', icon: 'i-carbon-settings', label: '通知设置' },
] as const
const adminMenuNavItems = [
  { key: 'admin', path: '/dashboard/admin', icon: 'i-carbon-data-center', label: '管理员后台' },
] as const
const userInitial = computed(() => currentUser.value?.profile.displayName.slice(0, 1).toUpperCase() ?? '?')
const userRoleText = computed(() => {
  if (currentUser.value?.role === 'admin')
    return '管理员'
  if (currentUser.value?.role === 'reviewer')
    return '众包审核'
  return '用户'
})

function toggleUserMenu() {
  isUserMenuOpen.value = !isUserMenuOpen.value
}

function closeUserMenu() {
  isUserMenuOpen.value = false
}

function goNotifications() {
  closeUserMenu()
  router.push('/dashboard/notifications')
}

function goUserMenuItem(item: (typeof userMenuNavItems)[number] | (typeof accountMenuNavItems)[number] | (typeof adminMenuNavItems)[number]) {
  selectedSection.value = item.key
  closeUserMenu()
  router.push(item.path)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeUserMenu()
}

function onLogout() {
  const redirect = route.path.startsWith('/dashboard') ? route.fullPath : undefined
  closeUserMenu()
  logout()
  router.push({
    path: '/login',
    query: redirect ? { redirect } : undefined,
  })
}

watch(() => route.fullPath, closeUserMenu)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  refreshNotifications().catch(() => {})
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <header class="border-b border-black/6 bg-[#f7f5ef]/78 top-0 sticky z-40 backdrop-blur-2xl dark:border-white/8 dark:bg-[#06070a]/72">
    <div class="mx-auto px-5 py-4 flex max-w-7xl items-center justify-between lg:px-8">
      <RouterLink class="flex gap-3 min-w-0 items-center" to="/">
        <span class="rounded-2xl bg-[#F2F2F0] flex h-11 w-11 shadow-amber-500/16 shadow-lg items-center justify-center overflow-hidden sm:hidden">
          <img src="/brand/icon.svg" alt="领益 Link Welfare" class="h-10 w-10">
        </span>
        <span class="px-3 py-2 rounded-2xl bg-[#F2F2F0] hidden shadow-amber-500/12 shadow-lg sm:flex">
          <img src="/brand/lockup.svg" alt="领益 Link Welfare" class="h-10 w-auto">
        </span>
        <span class="min-w-0 hidden md:grid">
          <span class="text-xs text-slate-500 dark:text-slate-400">
            公益积分申请平台
          </span>
        </span>
      </RouterLink>

      <div class="flex gap-2 items-center">
        <button class="icon-btn" title="Toggle dark" @click="toggleDark()">
          <span class="i-carbon-sun dark:i-carbon-moon" />
        </button>
        <button v-if="currentUser" class="icon-btn relative" title="消息中心" @click="goNotifications">
          <span class="i-carbon-notification" />
          <span v-if="unreadNotificationCount" class="text-[10px] text-slate-950 fw-900 px-1 rounded-full bg-emerald-300 flex h-4 min-w-4 items-center justify-center absolute -right-1 -top-1">
            {{ unreadNotificationCount }}
          </span>
        </button>
        <div v-if="currentUser" class="relative">
          <button class="px-2 py-1 rounded-2xl flex gap-3 transition items-center hover:bg-slate-100 dark:hover:bg-white/10" @click="toggleUserMenu">
            <div class="text-right gap-1 hidden justify-items-end sm:grid">
              <div class="text-sm fw-800 leading-5 max-w-36 truncate">
                {{ currentUser.profile.displayName }}
              </div>
              <span class="text-xs text-sky-600 px-2 py-1 border border-sky-300 rounded-full bg-sky-50 dark:text-sky-200 dark:border-sky-400/35 dark:bg-sky-400/10">
                余额 {{ currentUser.points.toLocaleString('zh-CN') }}
              </span>
            </div>
            <span class="text-xs text-sky-600 px-2 py-1 border border-sky-300 rounded-full bg-sky-50 dark:text-sky-200 dark:border-sky-400/35 dark:bg-sky-400/10 sm:hidden">
              余额 {{ currentUser.points.toLocaleString('zh-CN') }}
            </span>
            <span class="text-sm text-white rounded-full bg-slate-950 flex h-9 w-9 shadow-lg items-center justify-center overflow-hidden dark:text-slate-950 dark:bg-white">
              <img v-if="currentUser.profile.avatar" :src="currentUser.profile.avatar" :alt="currentUser.profile.displayName" class="h-full w-full object-cover">
              <span v-else>{{ userInitial }}</span>
            </span>
          </button>

          <Transition name="popover-pop">
            <div v-if="isUserMenuOpen" class="p-2 border border-black/8 rounded-2xl bg-white w-64 shadow-2xl shadow-slate-900/12 right-0 top-13 absolute z-50 dark:border-white/10 dark:bg-[#101216]">
              <div class="px-3 py-3 border-b border-black/8 dark:border-white/10">
                <div class="text-sm fw-900">
                  {{ currentUser.profile.displayName }}
                </div>
                <div class="text-xs text-slate-500 mt-1 truncate dark:text-slate-400">
                  {{ currentUser.profile.email }}
                </div>
                <div class="mt-3 flex gap-2 items-center">
                  <span class="text-xs text-emerald-700 px-2 py-1 rounded-full bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-400/10">{{ userRoleText }}</span>
                  <span class="text-xs text-sky-700 px-2 py-1 rounded-full bg-sky-50 dark:text-sky-200 dark:bg-sky-400/10">余额 {{ currentUser.points.toLocaleString('zh-CN') }}</span>
                </div>
              </div>
              <div class="py-1 border-b border-black/8 dark:border-white/10">
                <button
                  v-for="item in userMenuNavItems"
                  :key="item.key"
                  class="text-sm fw-800 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10"
                  :class="route.path === item.path || route.path.startsWith(`${item.path}/`) ? 'text-slate-950 bg-slate-100 dark:text-white dark:bg-white/10' : 'text-slate-700 dark:text-slate-200'"
                  @click="goUserMenuItem(item)"
                >
                  <span :class="item.icon" />
                  {{ item.label }}
                </button>
              </div>
              <div class="py-1 border-b border-black/8 dark:border-white/10">
                <button
                  v-for="item in accountMenuNavItems"
                  :key="item.key"
                  class="text-sm fw-800 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10"
                  :class="route.path === item.path || route.path.startsWith(`${item.path}/`) ? 'text-slate-950 bg-slate-100 dark:text-white dark:bg-white/10' : 'text-slate-700 dark:text-slate-200'"
                  @click="goUserMenuItem(item)"
                >
                  <span :class="item.icon" />
                  {{ item.label }}
                  <span v-if="item.key === 'notifications' && unreadNotificationCount" class="text-[10px] text-slate-950 fw-900 ml-auto px-1 rounded-full bg-emerald-300 flex h-4 min-w-4 items-center justify-center">
                    {{ unreadNotificationCount }}
                  </span>
                </button>
              </div>
              <div v-if="currentUser.role === 'admin'" class="py-1 border-b border-black/8 dark:border-white/10">
                <button
                  v-for="item in adminMenuNavItems"
                  :key="item.key"
                  class="text-sm fw-800 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10"
                  :class="route.path === item.path || route.path.startsWith(`${item.path}/`) ? 'text-slate-950 bg-slate-100 dark:text-white dark:bg-white/10' : 'text-slate-700 dark:text-slate-200'"
                  @click="goUserMenuItem(item)"
                >
                  <span :class="item.icon" />
                  {{ item.label }}
                </button>
              </div>
              <button class="text-sm fw-800 mt-1 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10" @click="onLogout">
                <span class="i-carbon-logout" />
                退出登录
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </header>

  <Teleport to="body">
    <button v-if="isUserMenuOpen" class="bg-transparent cursor-default inset-0 fixed z-30" aria-label="关闭用户菜单" @click="closeUserMenu" />
  </Teleport>
</template>
