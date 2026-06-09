<script setup lang="ts">
import { TxButton, TxCard, TxCheckbox, TxInput, TxStatusBadge } from '@talex-touch/tuffex'
import { onMounted } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  currentUser,
  notificationSettingsForm,
  refreshNotificationSettings,
  persistNotificationSettings,
  enableBrowserPush,
  disableBrowserPush,
  clearFeishuWebhook,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()

function saveNotifications() {
  runSafely(() => persistNotificationSettings(), '通知设置已保存')
}

function startBrowserPush() {
  runSafely(() => enableBrowserPush(), '浏览器 Push 已启用')
}

function stopBrowserPush() {
  runSafely(() => disableBrowserPush(), '浏览器 Push 已关闭')
}

function clearFeishu() {
  runSafely(() => clearFeishuWebhook(), '飞书 Webhook 已清除')
}

onMounted(() => {
  refreshNotificationSettings().catch(() => {})
})
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            通知设置
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            配置邮箱、飞书和浏览器 Push，站内消息始终开启。
          </p>
        </div>
        <TxStatusBadge :text="`Push ${notificationSettingsForm.pushSubscriptionCount}`" status="info" size="sm" />
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可配置通知。
      </div>
      <div v-else class="mt-6 space-y-5">
        <div class="gap-5 grid lg:grid-cols-3">
          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <label class="text-sm fw-800 flex gap-2 items-center">
              <TxCheckbox v-model="notificationSettingsForm.emailEnabled" variant="checkmark" aria-label="邮箱通知" />
              邮箱通知
            </label>
            <p class="text-xs text-slate-500 leading-5 mt-2">
              发送成功后扣 5 积分；余额不足时跳过邮箱。
            </p>
            <TxInput v-model="notificationSettingsForm.emailAddress" class="mt-4" type="email" placeholder="you@example.com" />
          </div>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <label class="text-sm fw-800 flex gap-2 items-center">
              <TxCheckbox v-model="notificationSettingsForm.feishuEnabled" variant="checkmark" aria-label="飞书通知" />
              飞书通知
            </label>
            <p class="text-xs text-slate-500 leading-5 mt-2">
              使用个人飞书机器人 Webhook；已保存值只显示脱敏文本。
            </p>
            <TxInput v-model="notificationSettingsForm.feishuWebhookUrl" class="mt-4" type="password" :placeholder="notificationSettingsForm.feishuWebhookMasked || 'https://open.feishu.cn/open-apis/bot/v2/hook/...'" />
            <TxButton v-if="notificationSettingsForm.feishuWebhookMasked" class="mt-3" size="sm" variant="secondary" @click="clearFeishu">
              清除 Webhook
            </TxButton>
          </div>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <label class="text-sm fw-800 flex gap-2 items-center">
              <TxCheckbox v-model="notificationSettingsForm.browserPushEnabled" variant="checkmark" aria-label="浏览器 Push" />
              浏览器 Push
            </label>
            <p class="text-xs text-slate-500 leading-5 mt-2">
              当前权限：{{ notificationSettingsForm.permission }}；需要服务端 VAPID Key。
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <TxButton size="sm" variant="secondary" @click="startBrowserPush">
                注册 Push
              </TxButton>
              <TxButton v-if="notificationSettingsForm.browserPushEnabled || notificationSettingsForm.pushSubscriptionCount" size="sm" variant="secondary" @click="stopBrowserPush">
                关闭 Push
              </TxButton>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-3 items-center justify-between">
          <p class="text-xs text-slate-500 leading-5 dark:text-slate-400">
            保存后新通知会按配置同步发送；站内消息不受这些开关影响。
          </p>
          <TxButton variant="primary" :disabled="notificationSettingsForm.loading" @click="saveNotifications">
            {{ notificationSettingsForm.loading ? '保存中...' : '保存通知设置' }}
          </TxButton>
        </div>
      </div>
    </TxCard>
  </section>
</template>
