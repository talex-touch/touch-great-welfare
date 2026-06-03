<script setup lang="ts">
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatBytes, formatDate, formatPoints, provisionStatusText, resourceApprovalStatusText, resourceTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextView from './RichTextView.vue'

const route = useRoute()
const router = useRouter()

const {
  state,
  currentUser,
  isAdmin,
  statusText,
  statusTone,
  typeIcon,
  userName,
} = useWelfareUiState()

const applicationId = computed(() => {
  const raw = (route.params as Record<string, string | string[] | undefined>).id
  return Array.isArray(raw) ? raw[0] : String(raw ?? '')
})

const application = computed(() => state.applications.find((item) => {
  if (item.id !== applicationId.value)
    return false

  return isAdmin.value || item.userId === currentUser.value?.id
}))

const prepaidStateText = computed(() => {
  if (!application.value)
    return '-'

  return application.value.costCharged ? '申请积分已预扣' : '申请积分已返还'
})

const prepaidStateTone = computed(() => application.value?.costCharged ? 'warning' : 'info')

function backToList() {
  router.push('/dashboard/apply')
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            申请详情
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看单个申请的预扣、审核、答复和材料记录。
          </p>
        </div>
        <TxButton variant="ghost" @click="backToList">
          返回列表
        </TxButton>
      </div>

      <div v-if="!application" class="mt-6 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
        申请不存在，或你没有权限查看该申请。
      </div>

      <div v-else class="mt-6 space-y-6">
        <div class="p-5 border border-black/8 rounded-3xl bg-slate-50 dark:border-white/10 dark:bg-white/5">
          <div class="flex flex-wrap gap-4 items-start justify-between">
            <div class="min-w-0">
              <div class="flex gap-2 items-center">
                <span :class="typeIcon(application.type)" />
                <h3 class="text-2xl fw-900 truncate">
                  {{ application.title }}
                </h3>
              </div>
              <div class="text-sm text-slate-500 mt-2 dark:text-slate-400">
                {{ formatDate(application.createdAt) }} 创建
                <template v-if="isAdmin">
                  · {{ userName(application.userId) }}
                </template>
              </div>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <TxStatusBadge :text="statusText(application.status)" :status="statusTone(application.status)" />
              <TxStatusBadge :text="prepaidStateText" :status="prepaidStateTone" />
            </div>
          </div>

          <div class="mt-5 gap-3 grid md:grid-cols-2 xl:grid-cols-4">
            <div class="application-detail-stat">
              <span>类型</span>
              <b>{{ application.type.toUpperCase() }}</b>
            </div>
            <div class="application-detail-stat">
              <span>申请预扣</span>
              <b>{{ formatPoints(application.cost) }}</b>
            </div>
            <div class="application-detail-stat">
              <span>云端保留至</span>
              <b>{{ formatDate(application.retentionExpiresAt) }}</b>
            </div>
            <div class="application-detail-stat">
              <span>处理截止</span>
              <b>{{ formatDate(application.processingDueAt) }}</b>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <TxTag v-if="application.pricingPromotionName" :label="application.pricingPromotionName" color="#7c2d12" background="rgba(251,146,60,.18)" />
            <TxTag v-if="application.hasOpenSourceBadge" label="开源认证" color="#0369a1" background="rgba(14,165,233,.14)" />
            <TxTag v-if="application.storageExtended" :label="`存储 +7 天 · ${formatPoints(application.storageExtensionCost)}`" color="#0f766e" background="rgba(45,212,191,.16)" />
            <TxTag v-if="application.expedited" :label="`加速处理 · ${formatPoints(application.expediteCost || 0)}`" color="#854d0e" background="rgba(250,204,21,.18)" />
            <TxTag v-if="application.rejectionReviewFeeWaived && application.rejectionFraudulent" label="认真承诺但造假仍扣手续费" color="#991b1b" background="rgba(248,113,113,.16)" />
            <TxTag v-else-if="application.rejectionReviewFeeWaived" label="认真填写承诺" color="#7c3aed" background="rgba(167,139,250,.16)" />
            <TxTag v-if="application.rejectionFraudulent" label="造假限制" color="#991b1b" background="rgba(248,113,113,.16)" />
            <TxTag v-else-if="!application.rejectionReviewFeeWaived" :label="`退回手续费 ${formatPoints(application.rejectionReviewFee)}`" color="#be123c" background="rgba(244,63,94,.12)" />
          </div>

          <div v-if="application.githubRepo" class="text-sm text-slate-500 mt-4 break-all dark:text-slate-400">
            关联仓库：{{ application.githubRepo }}
          </div>
        </div>

        <div v-if="application.type === 'code'" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            LLMApi 额度
          </h3>
          <div class="mt-4 gap-3 grid md:grid-cols-5">
            <div class="application-detail-stat">
              <span>模型</span>
              <b>{{ application.llmApiModelName ?? '-' }}</b>
            </div>
            <div class="application-detail-stat">
              <span>额度</span>
              <b>${{ application.llmApiBudgetUsd ?? '-' }}</b>
            </div>
            <div class="application-detail-stat">
              <span>换算</span>
              <b>{{ application.llmApiPointRate ?? '-' }} 积分 / 美元</b>
            </div>
            <div class="application-detail-stat">
              <span>IP 限制</span>
              <b>{{ application.llmApiIpLimit ?? '-' }} 个</b>
            </div>
            <div class="application-detail-stat">
              <span>RPM / 并发</span>
              <b>{{ application.llmApiRpmLimit ?? '-' }} / {{ application.llmApiConcurrencyLimit ?? '-' }}</b>
            </div>
          </div>
        </div>

        <div v-if="application.type === 'resource'" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            资源明细与逐项审批
          </h3>
          <div class="mt-4 gap-4 grid md:grid-cols-2">
            <div class="application-detail-stat">
              <span>项目/系统</span>
              <b>{{ application.projectId || '-' }}</b>
            </div>
            <div class="application-detail-stat">
              <span>成本归属</span>
              <b>{{ application.costCenter || '-' }}</b>
            </div>
            <div class="application-detail-stat">
              <span>紧急程度</span>
              <b>{{ application.urgency || '-' }}</b>
            </div>
            <div class="application-detail-stat">
              <span>期望生效</span>
              <b>{{ application.expectedEffectiveAt || '-' }}</b>
            </div>
          </div>
          <div class="mt-4 space-y-3">
            <div v-for="item in application.resourceItems ?? []" :key="item.id" class="p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
              <div class="flex flex-wrap gap-3 items-start justify-between">
                <div>
                  <div class="fw-900">
                    {{ resourceTypeLabel(item.resourceType) }} · {{ item.resourceSubtype }}
                  </div>
                  <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                    审批组：{{ item.approverGroup }} · 权限：{{ item.requestedPermission || '-' }} · 额度：{{ item.requestedQuota || '-' }} · 有效期：{{ item.duration || '-' }}
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <TxStatusBadge :text="resourceApprovalStatusText(item.approvalStatus)" :status="item.approvalStatus === 'rejected' ? 'danger' : item.approvalStatus === 'pending' ? 'warning' : 'success'" size="sm" />
                  <TxStatusBadge :text="provisionStatusText(item.provisionStatus)" :status="item.provisionStatus === 'completed' ? 'success' : item.provisionStatus === 'pending' ? 'warning' : 'info'" size="sm" />
                </div>
              </div>
              <pre class="text-xs mt-3 p-3 rounded-xl bg-white overflow-auto dark:bg-black/20">{{ JSON.stringify(item.payload, null, 2) }}</pre>
              <div v-if="item.approvedPayload" class="text-xs text-emerald-900 mt-2 p-3 rounded-xl bg-emerald-50 dark:text-emerald-100 dark:bg-emerald-950/30">
                批准内容：{{ JSON.stringify(item.approvedPayload) }}
              </div>
              <div v-if="item.rejectReason" class="text-xs text-red-900 mt-2 p-3 rounded-xl bg-red-50 dark:text-red-100 dark:bg-red-950/30">
                驳回原因：{{ item.rejectReason }}
              </div>
              <div v-if="item.provisionNote" class="text-xs text-slate-500 mt-2 dark:text-slate-400">
                开通备注：{{ item.provisionNote }} · {{ formatDate(item.provisionCompletedAt) }}
              </div>
            </div>
          </div>
          <div v-if="application.termsAcceptances?.length" class="text-xs text-slate-500 mt-4 dark:text-slate-400">
            已确认条款：{{ application.termsAcceptances.map(term => `${term.termId}@${term.version}`).join('、') }}
          </div>
        </div>

        <div v-if="application.aiReview" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            AI 初审
          </h3>
          <div class="text-sm text-slate-600 leading-6 mt-3 dark:text-slate-300">
            <b>{{ application.aiReview.summary }}</b>
            <p v-if="application.aiReview.reason" class="mt-2">
              {{ application.aiReview.reason }}
            </p>
          </div>
        </div>

        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            申请说明
          </h3>
          <RichTextView :content="application.description" class="mt-3" />
        </div>

        <div v-if="application.answer" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            审核答复
          </h3>
          <RichTextView :content="application.answer" class="mt-3" />
        </div>

        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            附件材料
          </h3>
          <div v-if="!application.attachments.length" class="text-sm text-slate-500 mt-3 dark:text-slate-400">
            暂无附件。
          </div>
          <div v-else class="mt-3 space-y-2">
            <div v-for="file in application.attachments" :key="file.id" class="p-3 rounded-2xl bg-slate-50 flex flex-wrap gap-3 items-center justify-between dark:bg-white/5">
              <span class="fw-800 break-all">{{ file.name }}</span>
              <span class="text-sm text-slate-500 dark:text-slate-400">{{ formatBytes(file.size) }} · {{ file.type }}</span>
            </div>
          </div>
        </div>
      </div>
    </TxCard>
  </section>
</template>
