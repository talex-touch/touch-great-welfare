<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()
const router = useRouter()
const { selectedSection, activeAdminTab, adminTabItems, isAdmin, currentUser } = useWelfareUiState()

interface NavItem {
  key: 'apply' | 'verification' | 'collaboration' | 'profile'
  path: string
  icon: string
  label: string
  roleRequired?: boolean
}

const navItems: readonly NavItem[] = [
  { key: 'apply', path: '/dashboard/apply', icon: 'i-carbon-document-attachment', label: '资源中心' },
  { key: 'verification', path: '/dashboard/verification', icon: 'i-carbon-certificate', label: '认证申请' },
  { key: 'collaboration', path: '/dashboard/collaboration', icon: 'i-carbon-task-add', label: '协作任务', roleRequired: true },
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人中心' },
] as const

const visibleNavItems = computed(() => navItems.filter(item => !item.roleRequired || currentUser.value?.role === 'reviewer' || isAdmin.value))

function go(item: typeof visibleNavItems.value[number]) {
  selectedSection.value = item.key
  router.push(item.path)
}

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

function selectAdminTab(tab: typeof adminTabItems[number]) {
  activeAdminTab.value = tab.name
  selectedSection.value = 'admin'
  router.push({
    path: '/dashboard/admin',
    query: { tab: tab.key },
  })
}
</script>

<template>
  <aside class="cms-side-nav">
    <div class="cms-side-nav__scroll">
      <div class="cms-side-nav__section">
        <button
          v-for="item in visibleNavItems"
          :key="item.key"
          class="cms-side-nav__item"
          :class="isActive(item.path) ? 'is-active' : ''"
          @click="go(item)"
        >
          <span class="cms-side-nav__icon" :class="item.icon" />
          <span class="flex-1">{{ item.label }}</span>
        </button>
      </div>

      <div v-if="isAdmin" class="cms-side-nav__section">
        <div class="cms-side-nav__label">
          管理员 NAV
        </div>
        <button
          class="cms-side-nav__item cms-side-nav__item--admin"
          :class="isActive('/dashboard/coupons') ? 'is-active' : ''"
          @click="router.push('/dashboard/coupons')"
        >
          <span class="cms-side-nav__icon i-carbon-percentage" />
          <span class="flex-1 truncate">优惠券中心</span>
        </button>
        <button
          v-for="tab in adminTabItems"
          :key="tab.key"
          class="cms-side-nav__item cms-side-nav__item--admin"
          :class="activeAdminTab === tab.name && isActive('/dashboard/admin') ? 'is-active-sub' : ''"
          @click="selectAdminTab(tab)"
        >
          <span class="cms-side-nav__icon" :class="tab.icon" />
          <span class="flex-1 truncate">{{ tab.name }}</span>
          <span v-if="activeAdminTab === tab.name && isActive('/dashboard/admin')" class="i-carbon-chevron-right text-xs" />
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.cms-side-nav {
  width: 248px;
}

.cms-side-nav__scroll {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px 12px;
}

.cms-side-nav__section {
  display: grid;
  gap: 4px;
  margin-bottom: 18px;
}

.cms-side-nav__label {
  padding: 8px 10px;
  color: rgb(148 163 184);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cms-side-nav__item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  gap: 11px;
  padding: 0 12px;
  border-radius: 11px;
  color: rgb(71 85 105);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  transition: 0.18s ease;
}

.cms-side-nav__item:hover {
  color: rgb(4 120 87);
  background: rgb(236 253 245);
}

.cms-side-nav__item.is-active {
  border-radius: 16px;
  color: rgb(4 120 87);
  background: linear-gradient(90deg, rgba(220, 252, 231, 0.96), rgba(236, 253, 245, 0.72));
  box-shadow: none;
}

.cms-side-nav__item.is-active-sub {
  border-radius: 16px;
  color: rgb(4 120 87);
  background: rgb(236 253 245);
}

.cms-side-nav__icon {
  display: grid;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  place-items: center;
  font-size: 18px;
  opacity: 0.9;
}

.dark .cms-side-nav__label {
  color: rgb(148 163 184);
}

.dark .cms-side-nav__item {
  color: rgb(203 213 225);
}

.dark .cms-side-nav__item:hover,
.dark .cms-side-nav__item.is-active-sub {
  color: rgb(134 239 172);
  background: rgba(16, 185, 129, 0.12);
}

.dark .cms-side-nav__item.is-active {
  color: rgb(187 247 208);
  background: linear-gradient(90deg, rgba(6, 78, 59, 0.55), rgba(16, 185, 129, 0.12));
  box-shadow: none;
}

@media (min-width: 1024px) {
  .cms-side-nav {
    position: sticky;
    top: var(--cms-header-height);
    height: calc(100vh - var(--cms-header-height));
    min-height: 0;
    z-index: 30;
    border-right: 1px solid rgb(229 231 235);
    background: rgba(255, 255, 255, 0.86);
    backdrop-filter: blur(18px);
  }

  .cms-side-nav__scroll {
    height: 100%;
    overflow-y: auto;
  }

  .dark .cms-side-nav {
    border-right-color: rgba(255, 255, 255, 0.08);
    background: rgba(12, 13, 16, 0.9);
  }
}

@media (max-width: 1023px) {
  .cms-side-nav {
    width: 100%;
  }

  .cms-side-nav__scroll {
    padding: 16px 12px;
  }
}
</style>
