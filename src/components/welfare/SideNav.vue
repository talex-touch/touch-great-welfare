<script setup lang="ts">
import { TxCard } from '@talex-touch/tuffex'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()
const router = useRouter()
const { selectedSection, unreadNotificationCount, activeAdminTab, adminTabItems } = useWelfareUiState()

const navItems = [
  { key: 'apply', path: '/dashboard/apply', icon: 'i-carbon-document-attachment', label: '我的申请' },
  { key: 'student', path: '/dashboard/student', icon: 'i-carbon-education', label: '学生认证' },
  { key: 'openSource', path: '/dashboard/open-source', icon: 'i-carbon-logo-github', label: '开源认证' },
  { key: 'notifications', path: '/dashboard/notifications', icon: 'i-carbon-notification', label: '消息中心' },
  { key: 'notificationSettings', path: '/dashboard/notification-settings', icon: 'i-carbon-settings-adjust', label: '通知设置' },
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人信息' },
  { key: 'wallet', path: '/dashboard/wallet', icon: 'i-carbon-wallet', label: '私人钱包' },
  { key: 'admin', path: '/dashboard/admin', icon: 'i-carbon-settings', label: '管理后台' },
] as const

function go(item: typeof navItems[number]) {
  selectedSection.value = item.key
  router.push(item.path)
}

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function selectAdminTab(tab: typeof adminTabItems[number]) {
  activeAdminTab.value = tab.name
  selectedSection.value = 'admin'
  if (!isActive('/dashboard/admin'))
    router.push('/dashboard/admin')
}
</script>

<template>
  <aside class="space-y-3 lg:self-start lg:top-24 lg:sticky">
    <TxCard class="solid-panel" background="pure" :padding="10" :radius="26">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="text-sm fw-700 px-4 py-3 text-left rounded-2xl flex gap-3 w-full transition items-center"
        :class="isActive(item.path) ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'"
        @click="go(item)"
      >
        <span :class="item.icon" />
        <span class="flex-1">{{ item.label }}</span>
        <span v-if="item.key === 'notifications' && unreadNotificationCount" class="text-xs text-slate-950 px-2 py-0.5 rounded-full bg-emerald-400">
          {{ unreadNotificationCount }}
        </span>
      </button>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="10" :radius="26">
      <div class="text-xs text-slate-400 fw-900 tracking-widest px-3 py-2 uppercase dark:text-slate-500">
        管理员 Nav
      </div>
      <button
        v-for="tab in adminTabItems"
        :key="tab.key"
        class="text-sm fw-800 px-4 py-3 text-left rounded-2xl flex gap-3 w-full transition items-center"
        :class="activeAdminTab === tab.name && isActive('/dashboard/admin') ? 'bg-slate-100 text-slate-950 dark:bg-white/12 dark:text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'"
        @click="selectAdminTab(tab)"
      >
        <span :class="tab.icon" />
        <span class="flex-1 truncate">{{ tab.name }}</span>
        <span v-if="activeAdminTab === tab.name && isActive('/dashboard/admin')" class="i-carbon-chevron-right text-xs" />
      </button>
    </TxCard>
  </aside>
</template>
