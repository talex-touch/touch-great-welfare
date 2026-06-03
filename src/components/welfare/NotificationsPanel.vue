<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge } from '@talex-touch/tuffex'
import { onMounted } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { notificationEventText } from '~/shared/notifications'

const {
  currentUser,
  notificationList,
  notificationsLoading,
  unreadNotificationCount,
  refreshNotifications,
  readNotification,
  readAllNotifications,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function onRead(id: string) {
  runSafely(() => readNotification(id), '消息已标记为已读')
}

function onReadAll() {
  runSafely(() => readAllNotifications(), '所有消息已标记为已读')
}

onMounted(() => {
  refreshNotifications().catch(() => {})
})
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            消息中心
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            申请、认证和图片任务的状态通知会保留在这里。
          </p>
        </div>
        <div class="flex gap-3 items-center">
          <TxStatusBadge :text="`未读 ${unreadNotificationCount}`" :status="unreadNotificationCount ? 'warning' : 'success'" />
          <TxButton variant="secondary" :disabled="!currentUser || !unreadNotificationCount" @click="onReadAll">
            全部已读
          </TxButton>
        </div>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可查看消息。
      </div>
      <div v-else-if="notificationsLoading" class="text-sm text-slate-500 mt-6">
        正在加载消息...
      </div>
      <div v-else-if="!notificationList.length" class="text-sm text-slate-500 mt-6 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
        暂无消息
      </div>
      <div v-else class="mt-6 border border-black/8 rounded-3xl overflow-hidden dark:border-white/10">
        <div
          v-for="item in notificationList"
          :key="item.id"
          class="px-5 py-4 border-t border-black/8 gap-4 grid first:border-t-0 dark:border-white/10 md:grid-cols-[1fr_120px_auto] md:items-center"
          :class="item.readAt ? 'bg-transparent' : 'bg-emerald-50/70 dark:bg-emerald-400/8'"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <b>{{ item.title }}</b>
              <span class="text-xs text-slate-500">{{ notificationEventText(item.event) }}</span>
            </div>
            <div class="text-sm text-slate-600 leading-6 mt-1 dark:text-slate-300">
              {{ item.body }}
            </div>
            <div class="text-xs text-slate-500 mt-2">
              {{ formatDate(item.createdAt) }}
            </div>
          </div>
          <TxStatusBadge :text="item.readAt ? '已读' : '未读'" :status="item.readAt ? 'info' : 'warning'" size="sm" />
          <TxButton size="sm" variant="secondary" :disabled="!!item.readAt" @click="onRead(item.id)">
            标记已读
          </TxButton>
        </div>
      </div>
    </TxCard>
  </section>
</template>
