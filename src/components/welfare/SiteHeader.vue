<script setup lang="ts">
import { TxDrawer } from '@talex-touch/tuffex'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toggleDark } from '~/composables/dark'
import { useWelfareUiState } from '~/composables/welfare-ui'
import NotificationsPanel from './NotificationsPanel.vue'

const route = useRoute()
const router = useRouter()
const {
  currentUser,
  currentUserPointBalanceText,
  logout,
  activeSiteBanner,
  notificationList,
  unreadNotificationCount,
  refreshNotifications,
  readNotification,
  selectedSection,
  isNotificationDrawerOpen,
} = useWelfareUiState()
const isUserMenuOpen = ref(false)
const dismissedForcedAnnouncementIds = ref<Set<string>>(new Set())
const topNavItems = [
  { key: 'home', path: '/', icon: 'i-carbon-home', label: '首页' },
  { key: 'square', path: '/dashboard/square', icon: 'i-carbon-campsite', label: '广场' },
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人中心' },
] as const
const accountMenuNavItems = [
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人中心' },
  { key: 'apply', path: '/dashboard/apply', icon: 'i-carbon-document-attachment', label: '我的申请' },
  { key: 'notifications', path: '/dashboard/notifications', icon: 'i-carbon-notification', label: '消息中心' },
  { key: 'verification', path: '/dashboard/verification', icon: 'i-carbon-certificate', label: '认证申请' },
] as const
const adminMenuNavItems = [
  { key: 'admin', path: '/dashboard/admin', icon: 'i-carbon-data-center', label: '管理员后台' },
] as const
const userInitial = computed(() => currentUser.value?.profile.displayName.slice(0, 1).toUpperCase() ?? '?')
const userRoleText = computed(() => {
  if (currentUser.value?.role === 'admin')
    return '管理员'
  if (currentUser.value?.role === 'reviewer')
    return '协作处理员'
  return '用户'
})
const forcedAnnouncement = computed(() => notificationList.value.find((item) => {
  if (item.event !== 'admin_announcement' || item.readAt || dismissedForcedAnnouncementIds.value.has(item.id))
    return false
  return item.data.forcePopup === true
}))

const bannerToneClass = computed(() => {
  if (activeSiteBanner.value?.tone === 'success')
    return 'site-banner--success'
  if (activeSiteBanner.value?.tone === 'warning')
    return 'site-banner--warning'
  return 'site-banner--info'
})

function toggleUserMenu() {
  isUserMenuOpen.value = !isUserMenuOpen.value
}

function closeUserMenu() {
  isUserMenuOpen.value = false
}

function openNotificationDrawer() {
  selectedSection.value = 'notifications'
  closeUserMenu()
  isNotificationDrawerOpen.value = true
  refreshNotifications().catch(() => {})
}

function isActivePath(path: string) {
  if (path === '/')
    return route.path === '/'
  return route.path === path || route.path.startsWith(`${path}/`)
}

function goTopNavItem(item: (typeof topNavItems)[number]) {
  selectedSection.value = item.key
  router.push(item.path)
}

function goUserMenuItem(item: (typeof accountMenuNavItems)[number] | (typeof adminMenuNavItems)[number]) {
  selectedSection.value = item.key
  closeUserMenu()
  router.push(item.path)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeUserMenu()
}

async function onLogout() {
  const redirect = route.path.startsWith('/dashboard') ? route.fullPath : undefined
  closeUserMenu()
  await logout()
  router.push({
    path: '/login',
    query: redirect ? { redirect } : undefined,
  })
}

function dismissForcedAnnouncement() {
  if (!forcedAnnouncement.value)
    return

  const next = new Set(dismissedForcedAnnouncementIds.value)
  next.add(forcedAnnouncement.value.id)
  dismissedForcedAnnouncementIds.value = next
}

function readForcedAnnouncement() {
  if (!forcedAnnouncement.value)
    return

  readNotification(forcedAnnouncement.value.id).catch(() => {})
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
  <div class="site-chrome">
    <div v-if="activeSiteBanner" class="site-banner" :class="bannerToneClass">
      <div class="site-banner__inner mx-auto px-5 max-w-7xl lg:px-8">
        <span class="i-carbon-information site-banner__icon" />
        <div class="min-w-0">
          <b v-if="activeSiteBanner.title">{{ activeSiteBanner.title }}</b>
          <span>{{ activeSiteBanner.body }}</span>
        </div>
      </div>
    </div>

    <header class="site-header border-b border-black/6 bg-[#f7f5ef]/78 backdrop-blur-2xl dark:border-white/8 dark:bg-[#06070a]/72">
      <div class="header-shell px-5 items-center lg:px-8">
        <div class="header-shell__left">
          <RouterLink class="header-brand" to="/">
            <img src="/brand/icon.svg" alt="领益 Link Welfare" class="h-10 w-10">
            <span class="header-brand__name">领益</span>
          </RouterLink>
        </div>

        <div class="header-shell__center">
          <nav v-if="currentUser" class="header-top-nav hidden items-center md:flex">
            <button
              v-for="item in topNavItems"
              :key="item.key"
              class="header-top-nav__item"
              :class="isActivePath(item.path) ? 'is-active' : ''"
              @click="goTopNavItem(item)"
            >
              <span :class="item.icon" />
              {{ item.label }}
            </button>
          </nav>
        </div>

        <div class="header-shell__right flex items-center justify-end">
          <template v-if="currentUser">
            <button class="header-balance-pill" type="button" title="查看钱包余额" @click="router.push('/dashboard/wallet')">
              <span class="i-carbon-favorite header-balance-pill__icon" aria-hidden="true" />
              <span class="header-balance-pill__label">余额</span>
              <span class="header-balance-pill__value">{{ currentUserPointBalanceText }}</span>
            </button>

            <span class="header-action-separator" aria-hidden="true" />

            <button class="header-notification-btn" title="消息中心" @click="openNotificationDrawer">
              <span class="i-carbon-notification" aria-hidden="true" />
              <span v-if="unreadNotificationCount" class="header-notification-btn__dot" aria-hidden="true" />
              <span class="sr-only">{{ unreadNotificationCount ? `有 ${unreadNotificationCount} 条未读消息` : '消息中心' }}</span>
            </button>

            <div class="relative">
              <button class="header-user-trigger" type="button" @click="toggleUserMenu">
                <span class="header-user-trigger__avatar">
                  <img v-if="currentUser.profile.avatar" :src="currentUser.profile.avatar" :alt="currentUser.profile.displayName" class="h-full w-full object-cover">
                  <span v-else>{{ userInitial }}</span>
                </span>
                <span class="header-user-trigger__name">{{ currentUser.profile.displayName }}</span>
                <span class="i-carbon-chevron-down header-user-trigger__chevron" aria-hidden="true" />
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
                      <span class="text-xs text-sky-700 px-2 py-1 rounded-full bg-sky-50 dark:text-sky-200 dark:bg-sky-400/10">余额 {{ currentUserPointBalanceText }}</span>
                    </div>
                  </div>
                  <div class="py-1 border-b border-black/8 dark:border-white/10">
                    <button
                      v-for="item in accountMenuNavItems"
                      :key="item.key"
                      class="text-sm fw-800 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10"
                      :class="isActivePath(item.path) ? 'text-slate-950 bg-slate-100 dark:text-white dark:bg-white/10' : 'text-slate-700 dark:text-slate-200'"
                      @click="item.key === 'notifications' ? openNotificationDrawer() : goUserMenuItem(item)"
                    >
                      <span :class="item.icon" />
                      {{ item.label }}
                      <span v-if="item.key === 'notifications' && unreadNotificationCount" class="text-[10px] text-slate-950 fw-900 ml-auto px-1 rounded-full bg-emerald-300 flex h-4 min-w-4 items-center justify-center">
                        {{ unreadNotificationCount }}
                      </span>
                    </button>
                  </div>
                  <button class="text-sm fw-800 mt-1 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10" @click="toggleDark()">
                    <span class="i-carbon-sun dark:i-carbon-moon" />
                    切换主题
                  </button>
                  <div v-if="currentUser.role === 'admin'" class="py-1 border-b border-black/8 dark:border-white/10">
                    <button
                      v-for="item in adminMenuNavItems"
                      :key="item.key"
                      class="text-sm fw-800 px-3 py-3 text-left rounded-xl flex gap-2 w-full transition items-center hover:bg-slate-100 dark:hover:bg-white/10"
                      :class="isActivePath(item.path) ? 'text-slate-950 bg-slate-100 dark:text-white dark:bg-white/10' : 'text-slate-700 dark:text-slate-200'"
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
          </template>

          <template v-else>
            <button class="icon-btn" title="Toggle dark" @click="toggleDark()">
              <span class="i-carbon-sun dark:i-carbon-moon" />
            </button>
            <button class="text-sm fw-800 px-4 py-2 border border-black/8 rounded-2xl transition dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10" @click="router.push('/login')">
              登录
            </button>
          </template>
        </div>
      </div>
    </header>
  </div>
  <div class="site-chrome-spacer" :class="activeSiteBanner ? 'site-chrome-spacer--with-banner' : ''" aria-hidden="true" />

  <Teleport to="body">
    <button v-if="isUserMenuOpen" class="bg-transparent cursor-default inset-0 fixed z-30" aria-label="关闭用户菜单" @click="closeUserMenu" />
  </Teleport>

  <TxDrawer
    v-model:visible="isNotificationDrawerOpen"
    class="notification-drawer-host"
    direction="right"
    size="min(520px, 94vw)"
    title="消息中心"
    mask-effect="blur"
  >
    <NotificationsPanel embedded />
  </TxDrawer>

  <Teleport to="body">
    <div v-if="forcedAnnouncement" class="announcement-modal">
      <div class="announcement-modal__dialog">
        <div class="flex gap-3 items-start justify-between">
          <div>
            <div class="text-xs text-slate-500 fw-900 mb-2 dark:text-slate-400">
              管理员通告
            </div>
            <h3 class="text-2xl fw-900 leading-tight">
              {{ forcedAnnouncement.title }}
            </h3>
          </div>
          <button class="icon-btn" aria-label="关闭通告弹窗" @click="dismissForcedAnnouncement">
            <span class="i-carbon-close" />
          </button>
        </div>
        <p class="text-sm text-slate-600 leading-7 mt-4 whitespace-pre-wrap dark:text-slate-300">
          {{ forcedAnnouncement.body }}
        </p>
        <div class="mt-5 flex flex-wrap gap-3 justify-end">
          <button class="text-sm text-white fw-900 px-4 py-2 rounded-2xl bg-slate-950 dark:text-slate-950 dark:bg-white" @click="readForcedAnnouncement">
            已读
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.site-chrome {
  position: fixed;
  inset: 0 0 auto;
  z-index: 60;
}

.site-chrome-spacer {
  height: 72px;
  flex: 0 0 auto;
}

.site-chrome-spacer--with-banner {
  height: 116px;
}

.site-banner {
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.site-banner__inner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 44px;
  font-size: 0.875rem;
  line-height: 1.5;
}

.site-banner__inner b {
  margin-right: 0.45rem;
  font-weight: 900;
}

.site-banner__icon {
  flex: 0 0 auto;
}

.site-banner--info {
  color: #075985;
  background: #e0f2fe;
}

.site-banner--success {
  color: #047857;
  background: #d1fae5;
}

.site-banner--warning {
  color: #92400e;
  background: #fef3c7;
}

.announcement-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(12px);
}

.announcement-modal__dialog {
  width: min(100%, 560px);
  padding: 1.35rem;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.2);
}

.site-header {
  width: 100%;
}

.header-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 1rem;
  height: 72px;
  max-height: 72px;
  width: 100%;
}

.header-shell__left {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
}

.header-shell__center {
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-shell__right {
  gap: 0.78rem;
  min-width: 0;
}

.header-balance-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  height: 30px;
  padding: 0 0.78rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  color: rgb(75 85 99);
  background: transparent;
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    color 0.18s ease;
}

.header-balance-pill:hover {
  transform: none;
  border-color: rgba(251, 191, 36, 0.34);
  background: transparent;
  box-shadow: none;
}

.header-balance-pill__icon {
  color: rgb(75 85 99);
  font-size: 1rem;
}

.header-balance-pill__label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.header-balance-pill__value {
  margin-left: 0.02rem;
  color: #f59e0b;
  font-size: 0.86rem;
  font-weight: 900;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.header-action-separator {
  width: 1px;
  height: 22px;
  background: rgba(148, 163, 184, 0.28);
}

.header-notification-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: rgb(75 85 99);
  font-size: 1.05rem;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.header-notification-btn:hover {
  color: rgb(15 23 42);
  background: rgba(148, 163, 184, 0.12);
  transform: translateY(-1px);
}

.header-notification-btn__dot {
  position: absolute;
  top: 0.24rem;
  right: 0.24rem;
  width: 0.48rem;
  height: 0.48rem;
  border: 1px solid rgba(255, 255, 255, 0.96);
  border-radius: 999px;
  background: #fbbf24;
  box-shadow: 0 2px 7px rgba(245, 158, 11, 0.36);
}

.header-user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.12rem 0.05rem 0.12rem 0.12rem;
  border-radius: 999px;
  color: rgb(15 23 42);
  transition:
    background-color 0.18s ease,
    transform 0.18s ease;
}

.header-user-trigger:hover {
  background: rgba(148, 163, 184, 0.1);
  transform: translateY(-1px);
}

.header-user-trigger__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.86);
  border-radius: 999px;
  color: white;
  font-size: 0.78rem;
  font-weight: 900;
  background: rgb(148 163 184);
  box-shadow:
    0 6px 14px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.header-user-trigger__name {
  max-width: 8rem;
  overflow: hidden;
  color: rgb(15 23 42);
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-user-trigger__chevron {
  flex: 0 0 auto;
  color: rgb(148 163 184);
  font-size: 0.95rem;
}

.dark .header-balance-pill {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgb(203 213 225);
  background: transparent;
  box-shadow: none;
}

.dark .header-balance-pill:hover {
  border-color: rgba(251, 191, 36, 0.28);
  background: transparent;
  box-shadow: none;
}

.dark .header-balance-pill__icon,
.dark .header-notification-btn {
  color: rgb(203 213 225);
}

.dark .header-action-separator {
  background: rgba(255, 255, 255, 0.12);
}

.dark .header-notification-btn:hover,
.dark .header-user-trigger:hover {
  color: white;
  background: rgba(255, 255, 255, 0.08);
}

.dark .header-notification-btn__dot {
  border-color: rgba(6, 7, 10, 0.95);
}

.dark .header-user-trigger,
.dark .header-user-trigger__name {
  color: white;
}

.dark .header-user-trigger__avatar {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgb(100 116 139);
  box-shadow:
    0 6px 14px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.header-brand {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.65rem;
  min-width: 0;
  color: rgb(15 23 42);
  text-decoration: none;
}

.header-brand__name {
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', serif;
  font-size: 1.34rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.header-top-nav {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
}

.header-top-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 800;
  color: rgb(71 85 105);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.header-top-nav__item:hover {
  background: rgba(148, 163, 184, 0.12);
}

.header-top-nav__item.is-active {
  background: rgb(15 23 42);
  color: white;
}

.dark .header-top-nav {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.dark .header-top-nav__item {
  color: rgb(203 213 225);
}

.dark .header-top-nav__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.dark .header-top-nav__item.is-active {
  background: white;
  color: rgb(15 23 42);
}

.dark .header-brand {
  color: white;
}

.dark .site-banner--info {
  color: #bae6fd;
  background: #082f49;
}

.dark .site-banner--success {
  color: #a7f3d0;
  background: #064e3b;
}

.dark .site-banner--warning {
  color: #fde68a;
  background: #78350f;
}

.dark .announcement-modal__dialog {
  border-color: rgba(255, 255, 255, 0.1);
  background: #101216;
}

@media (max-width: 767px) {
  .site-chrome-spacer {
    height: 64px;
  }

  .site-chrome-spacer--with-banner {
    height: 108px;
  }

  .header-shell {
    grid-template-columns: minmax(0, 1fr) auto;
    height: 64px;
    max-height: 64px;
  }

  .header-shell__center {
    display: none;
  }

  .header-shell__right {
    gap: 0.42rem;
  }

  .header-balance-pill {
    gap: 0.28rem;
    height: 28px;
    padding: 0 0.62rem;
  }

  .header-balance-pill__label {
    display: none;
  }

  .header-balance-pill__icon {
    font-size: 0.92rem;
  }

  .header-balance-pill__value {
    font-size: 0.78rem;
  }

  .header-action-separator {
    display: none;
  }

  .header-notification-btn {
    width: 28px;
    height: 28px;
    font-size: 1rem;
  }

  .header-user-trigger {
    gap: 0.35rem;
    padding: 0.18rem;
  }

  .header-user-trigger__avatar {
    width: 28px;
    height: 28px;
  }

  .header-user-trigger__name {
    display: none;
  }

  .header-user-trigger__chevron {
    font-size: 1rem;
  }

  .header-brand__name {
    font-size: 1.18rem;
  }
}
</style>
