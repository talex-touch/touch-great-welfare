<script setup lang="ts">
import type { WelfareApplication } from '~/composables/welfare'
import { TxButton, TxCard, TxStatusBadge, TxTabItem, TxTabs, TxTag } from '@talex-touch/tuffex'
import { computed, ref } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const {
  currentUser,
  claimableDeliveryApplications,
  currentUserDeliveryApplications,
  deliveryResultDrafts,
  claimDeliveryApplication,
  cancelDeliveryClaim,
  submitDeliveryResult,
  statusText,
  userName,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const activeTab = ref('可认领')

const pendingReviewApplications = computed(() =>
  currentUserDeliveryApplications.value.filter(item => item.deliveryReviewStatus === 'pending_review'),
)

const inProgressApplications = computed(() =>
  currentUserDeliveryApplications.value.filter(item => item.deliveryReviewStatus !== 'pending_review'),
)

function deliveryTag(application: WelfareApplication) {
  if (application.deliveryReviewStatus === 'pending_review')
    return { text: '待管理员复核', status: 'warning' as const }
  if (application.deliveryReviewStatus === 'rejected')
    return { text: '复核未通过，可重新提交', status: 'danger' as const }
  return { text: application.deliveryAssigneeId ? '已认领' : '可认领', status: 'info' as const }
}

function onClaim(applicationId: string) {
  runSafely(() => claimDeliveryApplication(applicationId), '任务已认领')
}

function onCancel(applicationId: string) {
  runSafely(() => cancelDeliveryClaim(applicationId), '已取消认领')
}

function onSubmit(applicationId: string) {
  runSafely(() => submitDeliveryResult(applicationId), '交付结果已提交，等待管理员复核')
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            协作任务
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            认领已审核通过但尚未交付的 Codex / Pro 任务，提交结果后由管理员复核并发放奖励。
          </p>
        </div>
        <TxTag v-if="currentUser?.role === 'reviewer'" label="协作处理员" color="#047857" background="rgba(16,185,129,.16)" />
      </div>
    </TxCard>

    <TxCard v-if="currentUser?.role !== 'reviewer' && currentUser?.role !== 'admin'" class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
        当前账号还不是协作处理员，请先在个人中心提交申请。
      </div>
    </TxCard>

    <TxCard v-else class="solid-panel" background="pure" shadow="soft" :padding="0" :radius="28">
      <TxTabs v-model="activeTab" class="p-5">
        <TxTabItem name="可认领" icon-class="i-carbon-task-add">
          <template #name>
            可认领
          </template>
          <div class="mt-5 space-y-4">
            <div v-if="!claimableDeliveryApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
              暂无可认领任务
            </div>
            <div v-for="application in claimableDeliveryApplications" :key="application.id" class="collab-task-row">
              <div class="min-w-0">
                <div class="flex flex-wrap gap-2 items-center">
                  <h3 class="text-lg fw-900 truncate">
                    {{ application.title }}
                  </h3>
                  <TxStatusBadge :text="statusText(application.status)" status="info" size="sm" />
                </div>
                <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                  {{ application.type.toUpperCase() }} · {{ userName(application.userId) }} · {{ formatDate(application.reviewedAt) }} 通过
                </div>
                <RichTextView v-if="application.answer" :content="application.answer" class="rich-text-preview mt-3" />
              </div>
              <div class="flex flex-wrap gap-2 items-center justify-end">
                <TxTag :label="formatPoints(application.cost)" color="#7c2d12" background="rgba(251,146,60,.18)" />
                <TxButton variant="primary" size="sm" @click="onClaim(application.id)">
                  <span class="i-carbon-task-add" />
                  认领
                </TxButton>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem name="我的认领" icon-class="i-carbon-in-progress">
          <template #name>
            我的认领
          </template>
          <div class="mt-5 space-y-4">
            <div v-if="!inProgressApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
              暂无进行中的认领任务
            </div>
            <div v-for="application in inProgressApplications" :key="application.id" class="collab-task-row collab-task-row--stacked">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div class="min-w-0">
                  <h3 class="text-lg fw-900 truncate">
                    {{ application.title }}
                  </h3>
                  <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                    {{ application.type.toUpperCase() }} · 认领于 {{ formatDate(application.deliveryClaimedAt) }}
                  </div>
                </div>
                <TxStatusBadge :text="deliveryTag(application).text" :status="deliveryTag(application).status" size="sm" />
              </div>
              <RichTextEditor v-model="deliveryResultDrafts[application.id]" :min-height="150" class="mt-4" placeholder="填写开通结果、交付链接、必要说明或后续注意事项" />
              <div class="mt-4 flex flex-wrap gap-3 justify-end">
                <TxButton variant="secondary" size="sm" @click="onCancel(application.id)">
                  取消认领
                </TxButton>
                <TxButton variant="primary" size="sm" :disabled="!deliveryResultDrafts[application.id]?.trim()" @click="onSubmit(application.id)">
                  <span class="i-carbon-send" />
                  提交交付
                </TxButton>
              </div>
            </div>
          </div>
        </TxTabItem>

        <TxTabItem name="待复核" icon-class="i-carbon-review">
          <template #name>
            待复核
          </template>
          <div class="mt-5 space-y-4">
            <div v-if="!pendingReviewApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
              暂无等待管理员复核的任务
            </div>
            <div v-for="application in pendingReviewApplications" :key="application.id" class="collab-task-row">
              <div>
                <h3 class="text-lg fw-900">
                  {{ application.title }}
                </h3>
                <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                  {{ application.type.toUpperCase() }} · 提交于 {{ formatDate(application.deliverySubmittedAt) }}
                </div>
              </div>
              <TxStatusBadge text="待管理员复核" status="warning" size="sm" />
            </div>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </section>
</template>

<style scoped>
.collab-task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  padding: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgb(248 250 252);
}

.collab-task-row--stacked {
  display: block;
}

.dark .collab-task-row {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
}

@media (max-width: 720px) {
  .collab-task-row {
    grid-template-columns: 1fr;
  }
}
</style>
