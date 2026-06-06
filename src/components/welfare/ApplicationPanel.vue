<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { useRouter } from 'vue-router'
import { resourceTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import ReviewQueues from './ReviewQueues.vue'
import RichTextView from './RichTextView.vue'

const {
  currentUser,
  currentUserApplications,
  statusText,
  statusTone,
  typeIcon,
} = useWelfareUiState()

const router = useRouter()

function goCreateApplication() {
  router.push('/dashboard/apply/create')
}

function goApplicationDetail(id: string) {
  router.push(`/dashboard/apply/${id}`)
}

function formatApplicationDateTime(value?: string) {
  if (!value)
    return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(/\//, ' ')
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            我的申请
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看申请记录，或提交新的公益申请。
          </p>
        </div>
        <div class="flex flex-wrap gap-3 items-center">
          <TxStatusBadge :text="`余额 ${currentUser?.points ?? 0}`" status="info" />
          <TxButton variant="primary" :disabled="!currentUser" @click="goCreateApplication">
            <span class="i-carbon-add" />
            新的申请
          </TxButton>
        </div>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        请先登录后提交申请。
      </div>
      <div v-else class="mt-6">
        <div v-if="!currentUserApplications.length" class="text-sm text-slate-500 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
          暂无申请记录
        </div>
        <div v-else class="border border-black/8 rounded-3xl overflow-hidden dark:border-white/10">
          <div class="text-xs text-slate-500 fw-800 px-5 py-3 bg-slate-50 gap-4 grid-cols-[1fr_2rem] hidden dark:text-slate-400 dark:bg-white/5 md:grid">
            <span>申请内容</span>
            <span />
          </div>
          <button
            v-for="item in currentUserApplications"
            :key="item.id"
            type="button"
            class="application-list-row px-5 py-4 border-t border-black/8 gap-3 grid transition dark:border-white/10 hover:bg-slate-50 md:grid-cols-[1fr_2rem] md:items-center dark:hover:bg-white/5"
            @click="goApplicationDetail(item.id)"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="text-[11px] text-slate-600 fw-900 leading-5 px-2 rounded-md bg-slate-100 uppercase dark:text-slate-300 dark:bg-white/8">
                  {{ item.type }}
                </span>
                <span :class="typeIcon(item.type)" />
                <b class="truncate">{{ item.title }}</b>
                <TxStatusBadge :text="statusText(item.status)" :status="statusTone(item.status)" size="sm" />
              </div>
              <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center dark:text-slate-400">
                <span>{{ formatApplicationDateTime(item.createdAt) }} - {{ formatApplicationDateTime(item.retentionExpiresAt) }}</span>
                <span
                  class="i-carbon-information text-slate-400"
                  :title="`云端记录预计保留至 ${formatApplicationDateTime(item.retentionExpiresAt)}`"
                  aria-label="云端记录保留说明"
                />
                <span class="text-slate-300 dark:text-slate-600">|</span>
                <span>消耗 {{ item.cost }} 积分</span>
              </div>
              <RichTextView :content="item.description" class="rich-text-preview mt-2 line-clamp-3" />
              <div class="mt-2 flex flex-wrap gap-2">
                <TxTag v-if="item.hasOpenSourceBadge" label="开源认证" color="#0369a1" background="rgba(14,165,233,.14)" />
                <TxTag v-if="item.storageExtended" label="存储 +7 天" color="#0f766e" background="rgba(45,212,191,.16)" />
                <TxTag v-if="item.rejectionReviewFeeWaived && item.rejectionFraudulent" label="造假仍扣手续费" color="#991b1b" background="rgba(248,113,113,.16)" />
                <TxTag v-else-if="item.rejectionReviewFeeWaived" label="退回免手续费" color="#7c3aed" background="rgba(167,139,250,.16)" />
                <TxTag v-if="item.rejectionFraudulent" label="造假限制" color="#991b1b" background="rgba(248,113,113,.16)" />
                <TxTag v-if="item.type === 'code' && item.llmApiBudgetUsd" :label="`LLMApi ${item.llmApiModelName ?? ''} $${item.llmApiBudgetUsd}`" color="#4338ca" background="rgba(99,102,241,.14)" />
                <TxTag v-if="item.type === 'resource'" :label="`${item.resourceItems?.length ?? 0} 条资源`" color="#047857" background="rgba(16,185,129,.14)" />
                <TxTag v-for="resourceType in item.selectedResourceTypes ?? []" :key="resourceType" :label="resourceTypeLabel(resourceType)" color="#0369a1" background="rgba(14,165,233,.14)" />
                <TxTag v-if="item.llmApiRequiresExtendedReview" label="更长审核" color="#b45309" background="rgba(245,158,11,.16)" />
              </div>
            </div>
            <div class="flex gap-2 items-center md:justify-end">
              <span class="i-carbon-chevron-right text-slate-400" />
            </div>
            <div v-if="item.answer" class="p-3 rounded-xl bg-slate-100 dark:bg-[#151820] md:col-span-2">
              <RichTextView :content="item.answer" class="rich-text-preview" />
            </div>
          </button>
        </div>
      </div>
    </TxCard>

    <ReviewQueues kind="pro" />
  </section>
</template>
