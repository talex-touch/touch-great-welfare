<script setup lang="ts">
import { TxButton, TxCard } from '@talex-touch/tuffex'
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
        <div class="flex flex-wrap gap-3 items-center justify-end">
          <span
            class="text-sm fw-800 px-3 py-1.5 rounded-full flex gap-2 items-center"
            :class="unreadNotificationCount ? 'text-amber-700 bg-amber-50 ring-1 ring-amber-200 dark:text-amber-200 dark:bg-amber-400/10 dark:ring-amber-300/20' : 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 dark:text-emerald-200 dark:bg-emerald-400/10 dark:ring-emerald-300/20'"
          >
            <span class="rounded-full h-2 w-2" :class="unreadNotificationCount ? 'bg-amber-400' : 'bg-emerald-400'" />
            {{ unreadNotificationCount ? `未读 ${unreadNotificationCount}` : '无未读' }}
          </span>
          <TxButton variant="secondary" :disabled="!currentUser || !unreadNotificationCount" @click="onReadAll">
            全部标为已读
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
          class="notification-row px-5 py-4 border-t border-black/8 gap-4 grid first:border-t-0 dark:border-white/10 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
          :class="item.readAt ? 'is-read' : 'is-unread'"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <b>{{ item.title }}</b>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ notificationEventText(item.event) }}</span>
              <span v-if="!item.readAt" class="notification-row__badge">
                未读
              </span>
            </div>
            <div class="text-sm text-slate-600 leading-6 mt-1 dark:text-slate-300">
              {{ item.body }}
            </div>
            <div class="text-xs text-slate-500 mt-2">
              {{ formatDate(item.createdAt) }}
            </div>
          </div>
          <div class="flex gap-2 items-center md:justify-end">
            <span v-if="item.readAt" class="text-xs text-slate-400 fw-800 px-3 py-1 rounded-full bg-slate-100 dark:text-slate-500 dark:bg-white/6">
              已读
            </span>
            <TxButton v-else size="sm" variant="secondary" @click="onRead(item.id)">
              标为已读
            </TxButton>
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>

<style scoped>
.notification-row {
  transition:
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.notification-row.is-unread {
  background: rgba(240, 253, 250, 0.86);
  box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.72);
}

.notification-row.is-read {
  background: transparent;
}

.notification-row__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  color: #b45309;
  background: rgba(251, 191, 36, 0.14);
  font-size: 0.72rem;
  font-weight: 900;
}

.dark .notification-row.is-unread {
  background: rgba(20, 184, 166, 0.1);
  box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.45);
}

.dark .notification-row__badge {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.14);
}
</style>
