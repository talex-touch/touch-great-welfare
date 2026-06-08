<script setup lang="ts">
import type { NotificationEvent } from '~/shared/notifications'
import { TxButton, TxCard } from '@talex-touch/tuffex'
import { onMounted } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { notificationEventText } from '~/shared/notifications'

defineProps<{
  embedded?: boolean
}>()

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

function notificationEventClass(event: NotificationEvent) {
  if (event.startsWith('student_')) {
    if (event.includes('rejected') || event.includes('revoked'))
      return 'is-danger'
    if (event.includes('needs_supplement'))
      return 'is-warning'
    if (event.includes('approved'))
      return 'is-success'
    return 'is-student'
  }
  if (event.startsWith('application_')) {
    if (event.includes('rejected'))
      return 'is-danger'
    if (event.includes('needs_supplement'))
      return 'is-warning'
    if (event.includes('answered'))
      return 'is-success'
    return 'is-application'
  }
  if (event === 'ai_image_succeeded')
    return 'is-success'
  if (event === 'ai_image_failed')
    return 'is-danger'
  if (event === 'admin_announcement')
    return 'is-announcement'
  if (event === 'email_test')
    return 'is-email'
  return 'is-info'
}

onMounted(() => {
  refreshNotifications().catch(() => {})
})
</script>

<template>
  <section class="space-y-6" :class="embedded ? 'notification-panel--embedded' : ''">
    <component :is="embedded ? 'div' : TxCard" class="notification-panel" :class="embedded ? '' : 'solid-panel'" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="notification-panel__head">
        <div>
          <h2 class="notification-panel__title">
            消息中心
          </h2>
          <p class="notification-panel__subtitle">
            申请、认证和图片任务的状态通知会保留在这里。
          </p>
        </div>
        <div class="notification-panel__actions">
          <span
            class="notification-panel__status"
            :class="unreadNotificationCount ? 'is-warning' : 'is-success'"
          >
            <span class="rounded-full h-2 w-2" :class="unreadNotificationCount ? 'bg-amber-400' : 'bg-emerald-400'" />
            {{ unreadNotificationCount ? `未读 ${unreadNotificationCount}` : '无未读' }}
          </span>
          <TxButton variant="secondary" :disabled="!currentUser || !unreadNotificationCount" @click="onReadAll">
            全部标为已读
          </TxButton>
        </div>
      </div>

      <div v-if="!currentUser" class="notification-panel__empty">
        登录后可查看消息。
      </div>
      <div v-else-if="notificationsLoading" class="text-sm text-slate-500 mt-6">
        正在加载消息...
      </div>
      <div v-else-if="!notificationList.length" class="notification-panel__empty">
        暂无消息
      </div>
      <div v-else class="notification-list">
        <div
          v-for="item in notificationList"
          :key="item.id"
          class="notification-row"
          :class="item.readAt ? 'is-read' : 'is-unread'"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <b>{{ item.title }}</b>
              <span class="notification-row__event" :class="notificationEventClass(item.event)">{{ notificationEventText(item.event) }}</span>
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
          <div class="notification-row__actions">
            <span v-if="item.readAt" class="text-xs text-slate-400 fw-800 px-3 py-1 rounded-full bg-slate-100 dark:text-slate-500 dark:bg-white/6">
              已读
            </span>
            <TxButton v-else size="sm" variant="secondary" @click="onRead(item.id)">
              标为已读
            </TxButton>
          </div>
        </div>
      </div>
    </component>
  </section>
</template>

<style scoped>
.notification-panel--embedded {
  height: 100%;
}

.notification-panel {
  min-width: 0;
}

.notification-panel--embedded .notification-panel {
  height: 100%;
}

.notification-panel__head {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.notification-panel__title {
  font-size: 1.65rem;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.notification-panel__subtitle {
  margin-top: 0.5rem;
  color: #64748b;
  font-size: 0.86rem;
  line-height: 1.65;
}

.notification-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: flex-end;
}

.notification-panel__status {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.38rem 0.8rem;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 900;
}

.notification-panel__status.is-warning {
  color: #b45309;
  background: #fffbeb;
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.42);
}

.notification-panel__status.is-success {
  color: #047857;
  background: #ecfdf5;
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.25);
}

.notification-panel__empty {
  margin-top: 1.5rem;
  padding: 2.2rem 1rem;
  border: 1px dashed rgba(15, 23, 42, 0.14);
  border-radius: 24px;
  color: #64748b;
  font-size: 0.9rem;
  text-align: center;
}

.notification-list {
  overflow: hidden;
  margin-top: 1.5rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 24px;
}

.notification-row {
  display: grid;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  transition:
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.notification-row:first-child {
  border-top: 0;
}

.notification-row__actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

@media (min-width: 768px) {
  .notification-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .notification-row__actions {
    justify-content: flex-end;
  }
}

.notification-row.is-unread {
  background: rgba(240, 253, 250, 0.86);
  box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.72);
}

.notification-row.is-read {
  background: transparent;
}

.notification-row__event,
.notification-row__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 900;
}

.notification-row__event {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.14);
  box-shadow: inset 0 0 0 1px rgba(14, 165, 233, 0.16);
}

.notification-row__event.is-student {
  color: #6d28d9;
  background: rgba(139, 92, 246, 0.14);
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.18);
}

.notification-row__event.is-application {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.13);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.16);
}

.notification-row__event.is-success {
  color: #047857;
  background: rgba(16, 185, 129, 0.14);
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.18);
}

.notification-row__event.is-warning {
  color: #b45309;
  background: rgba(251, 191, 36, 0.16);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.2);
}

.notification-row__event.is-danger {
  color: #be123c;
  background: rgba(244, 63, 94, 0.13);
  box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.18);
}

.notification-row__event.is-announcement {
  color: #7c3aed;
  background: rgba(168, 85, 247, 0.14);
  box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.18);
}

.notification-row__event.is-email {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.14);
  box-shadow: inset 0 0 0 1px rgba(20, 184, 166, 0.18);
}

.notification-row__badge {
  color: #b45309;
  background: rgba(251, 191, 36, 0.14);
}

.dark .notification-panel__subtitle {
  color: #94a3b8;
}

.dark .notification-panel__status.is-warning {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.14);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.22);
}

.dark .notification-panel__status.is-success {
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.12);
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.2);
}

.dark .notification-panel__empty,
.dark .notification-list,
.dark .notification-row {
  border-color: rgba(255, 255, 255, 0.1);
}

.dark .notification-panel__empty {
  color: #94a3b8;
}

.dark .notification-row.is-unread {
  background: rgba(20, 184, 166, 0.1);
  box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.45);
}

.dark .notification-row__event {
  color: #7dd3fc;
  background: rgba(14, 165, 233, 0.14);
  box-shadow: inset 0 0 0 1px rgba(14, 165, 233, 0.2);
}

.dark .notification-row__event.is-student {
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.16);
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.22);
}

.dark .notification-row__event.is-application {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.16);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.22);
}

.dark .notification-row__event.is-success {
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.14);
  box-shadow: inset 0 0 0 1px rgba(16, 185, 129, 0.22);
}

.dark .notification-row__event.is-warning {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.16);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.22);
}

.dark .notification-row__event.is-danger {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.16);
  box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.22);
}

.dark .notification-row__event.is-announcement {
  color: #d8b4fe;
  background: rgba(168, 85, 247, 0.16);
  box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.22);
}

.dark .notification-row__event.is-email {
  color: #99f6e4;
  background: rgba(20, 184, 166, 0.16);
  box-shadow: inset 0 0 0 1px rgba(20, 184, 166, 0.22);
}

.dark .notification-row__badge {
  color: #fde68a;
  background: rgba(251, 191, 36, 0.14);
}
</style>
