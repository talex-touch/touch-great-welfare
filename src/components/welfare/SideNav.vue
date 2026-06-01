<script setup lang="ts">
import { TxCard } from '@talex-touch/tuffex'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareUiState } from '~/composables/welfare-ui'

const route = useRoute()
const router = useRouter()
const { selectedSection } = useWelfareUiState()

const navItems = [
  { key: 'apply', path: '/dashboard/apply', icon: 'i-carbon-document-attachment', label: '提交申请' },
  { key: 'profile', path: '/dashboard/profile', icon: 'i-carbon-user-avatar', label: '个人信息' },
  { key: 'student', path: '/dashboard/student', icon: 'i-carbon-education', label: '学生认证' },
  { key: 'admin', path: '/dashboard/admin', icon: 'i-carbon-settings', label: '管理员后台' },
] as const

function go(item: typeof navItems[number]) {
  selectedSection.value = item.key
  router.push(item.path)
}
</script>

<template>
  <aside class="space-y-3">
    <TxCard class="solid-panel" background="pure" :padding="10" :radius="26">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="text-sm fw-700 px-4 py-3 text-left rounded-2xl flex gap-3 w-full transition items-center"
        :class="route.path === item.path ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'"
        @click="go(item)"
      >
        <span :class="item.icon" />
        {{ item.label }}
      </button>
    </TxCard>

    <TxCard class="solid-panel" background="pure" :padding="18" :radius="26">
      <div class="text-sm fw-800">
        扣费规则
      </div>
      <div class="text-sm text-slate-600 mt-4 space-y-3 dark:text-slate-300">
        <div class="flex justify-between">
          <span>Code</span><b>1</b>
        </div>
        <div class="flex justify-between">
          <span>Image</span><b>10</b>
        </div>
        <div class="flex justify-between">
          <span>Pro</span><b>100</b>
        </div>
        <div class="pt-3 border-t border-black/8 dark:border-white/10">
          学生认证每次审核先扣 10 积分；认证成功后返还，退回不返还。
        </div>
      </div>
    </TxCard>
  </aside>
</template>
