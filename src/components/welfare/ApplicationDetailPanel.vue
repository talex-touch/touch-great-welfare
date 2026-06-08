<script setup lang="ts">
import type { UploadLikeFile } from '~/composables/welfare-ui'
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints, isGptProModel, resourceApprovalStatusText, resourceTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { resourceItemApprovedFields, resourceItemSummaryFields, resourceProvisionStatusText, resourceTicketStatus, resourceTicketSteps } from '~/composables/welfare/resource-display'
import ApplicationResultSubmit from './ApplicationResultSubmit.vue'
import ApplicationThread from './ApplicationThread.vue'
import RichTextView from './RichTextView.vue'
import VerificationAttachmentGrid from './VerificationAttachmentGrid.vue'

const props = withDefaults(defineProps<{
  applicationId?: string
  drawer?: boolean
}>(), {
  applicationId: undefined,
  drawer: false,
})

const emit = defineEmits<{
  close: []
}>()

const route = useRoute()
const router = useRouter()
const { runSafely } = useWelfareFeedback()

const {
  state,
  currentUser,
  isAdmin,
  canCrowdReview,
  statusText,
  statusTone,
  typeIcon,
  userName,
  completeApplication,
  addApplicationMessage,
} = useWelfareUiState()

const applicationId = computed(() => {
  if (props.applicationId)
    return props.applicationId

  const raw = (route.params as Record<string, string | string[] | undefined>).id
  return Array.isArray(raw) ? raw[0] : String(raw ?? '')
})

const application = computed(() => state.applications.find((item) => {
  if (item.id !== applicationId.value)
    return false

  return isAdmin.value
    || item.userId === currentUser.value?.id
    || (canCrowdReview.value && item.type === 'pro' && item.userId !== currentUser.value?.id)
    || (currentUser.value?.role === 'reviewer' && ['code', 'pro'].includes(item.type) && item.status === 'answered' && (!item.deliveryAssigneeId || item.deliveryAssigneeId === currentUser.value.id))
}))

const messages = computed(() => application.value?.messages ?? [])

const llmBudgetText = computed(() => {
  if (!application.value?.llmApiBudgetUsd)
    return '-'
  return isGptProModel(application.value.llmApiModelKey)
    ? `${application.value.llmApiBudgetUsd} 轮`
    : `$${application.value.llmApiBudgetUsd}`
})

const llmPointRateText = computed(() => {
  if (!application.value?.llmApiPointRate)
    return '-'
  return isGptProModel(application.value.llmApiModelKey)
    ? `${formatPoints(application.value.llmApiPointRate)} / 轮`
    : `${application.value.llmApiPointRate} 积分 / 美元`
})

const prepaidStateText = computed(() => {
  if (!application.value)
    return '-'

  return application.value.costCharged ? '申请积分已预扣' : '申请积分已返还'
})

const prepaidStateTone = computed(() => application.value?.costCharged ? 'warning' : 'info')
const resourceTicket = computed(() => application.value?.type === 'resource' ? resourceTicketStatus(application.value) : undefined)
const resourceSteps = computed(() => application.value?.type === 'resource' ? resourceTicketSteps(application.value) : [])

function backToList() {
  if (props.drawer) {
    emit('close')
    return
  }

  router.push('/dashboard/apply')
}

function editDraft() {
  if (!application.value || application.value.type !== 'resource' || application.value.status !== 'draft')
    return

  if (props.drawer)
    emit('close')
  router.push(`/dashboard/apply/create?draft=${encodeURIComponent(application.value.id)}`)
}

function handleSendMessage(type: 'comment' | 'supplement' | 'result_submission', content: string, attachments: UploadLikeFile[] = []) {
  if (!application.value)
    return

  runSafely(async () => {
    await addApplicationMessage(applicationId.value, type, content, attachments)
  }, type === 'result_submission' ? '结果已提交' : '消息已发送')
}

function handleSubmitResult(content: string) {
  handleSendMessage('result_submission', content)
}

function handleComplete() {
  if (!application.value || !isAdmin.value)
    return

  runSafely(() => completeApplication(applicationId.value), '申请已标记为完成')
}
</script>

<template>
  <section class="space-y-6" :class="{ 'application-detail-panel--drawer': drawer }">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            申请详情
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            查看申请的预扣、审核、沟通记录和结果提交。
          </p>
        </div>
        <TxButton variant="ghost" @click="backToList">
          {{ drawer ? '关闭' : '返回列表' }}
        </TxButton>
      </div>

      <div v-if="!application" class="mt-6 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
        申请不存在，或你没有权限查看该申请。
      </div>

      <div v-else class="mt-6 space-y-6">
        <!-- Application header -->
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
              <TxButton
                v-if="application.type === 'resource' && application.status === 'draft' && application.userId === currentUser?.id"
                size="sm"
                variant="secondary"
                @click="editDraft"
              >
                编辑草稿
              </TxButton>
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
            <div v-if="application.type === 'pro'" class="application-detail-stat">
              <span>通过后免费补充</span>
              <b>{{ Math.max(0, (application.postApprovalSupplementLimit ?? 0) - (application.postApprovalSupplementCount ?? 0)) }}/{{ application.postApprovalSupplementLimit ?? 0 }} 次</b>
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

        <!-- LLMApi details -->
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
              <span>{{ isGptProModel(application.llmApiModelKey) ? '对话轮次' : '额度' }}</span>
              <b>{{ llmBudgetText }}</b>
            </div>
            <div class="application-detail-stat">
              <span>换算</span>
              <b>{{ llmPointRateText }}</b>
            </div>
            <div class="application-detail-stat">
              <span>IP 限制</span>
              <b>{{ application.llmApiIpLimit ?? '-' }} 个</b>
            </div>
            <div class="application-detail-stat">
              <span>默认 RPM / TPM</span>
              <b>{{ application.llmApiRpmLimit ?? '-' }} / {{ application.llmApiTpmLimit ?? '-' }}</b>
            </div>
          </div>
          <div v-if="application.llmApiRateLimitChangeCost" class="rate-warning mt-4">
            <b>RPM / TPM 已申请改为 {{ application.llmApiCustomRpmLimit ?? application.llmApiRpmLimit }} / {{ application.llmApiCustomTpmLimit ?? application.llmApiTpmLimit }}，预估额外消耗 {{ formatPoints(application.llmApiRateLimitChangeCost) }}</b>
            <span>该消耗不享受折扣，最终以接口返回或后端结算为准。</span>
          </div>
        </div>

        <!-- Resource details -->
        <div v-if="application.type === 'resource'" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex flex-wrap gap-3 items-start justify-between">
            <div>
              <h3 class="text-xl fw-900">
                我的资源审核工单
              </h3>
              <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                展示项目、资源、材料、队列、处理和结果发放进度。
              </p>
            </div>
            <TxStatusBadge v-if="resourceTicket" :text="resourceTicket.label" :status="resourceTicket.tone" />
          </div>

          <div class="mt-4 gap-2 grid md:grid-cols-4">
            <div
              v-for="step in resourceSteps"
              :key="step.key"
              class="text-sm px-3 py-2 border rounded-2xl flex gap-2 items-center" :class="[
                step.active
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/20 dark:text-amber-100'
                  : step.done
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-950/10 dark:text-emerald-100'
                    : 'border-black/8 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400',
              ]"
            >
              <span :class="step.done ? 'i-carbon-checkmark-outline' : step.active ? 'i-carbon-time' : 'i-carbon-circle-dash'" />
              <span class="fw-800">{{ step.label }}</span>
            </div>
          </div>

          <div class="mt-4 gap-4 grid md:grid-cols-2 xl:grid-cols-4">
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
                  <TxStatusBadge :text="resourceProvisionStatusText(item.provisionStatus)" :status="item.provisionStatus === 'completed' ? 'success' : item.provisionStatus === 'pending' ? 'warning' : 'info'" size="sm" />
                </div>
              </div>
              <div class="mt-3 gap-2 grid md:grid-cols-2 xl:grid-cols-3">
                <div v-for="field in resourceItemSummaryFields(item)" :key="`${item.id}-${field.label}`" class="application-detail-stat">
                  <span>{{ field.label }}</span>
                  <b>{{ field.value }}</b>
                </div>
              </div>
              <div v-if="resourceItemApprovedFields(item).length" class="mt-3 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30">
                <div class="text-xs text-emerald-900 fw-900 dark:text-emerald-100">
                  批准内容
                </div>
                <div class="mt-2 gap-2 grid md:grid-cols-2">
                  <div v-for="field in resourceItemApprovedFields(item)" :key="`${item.id}-approved-${field.label}`" class="application-detail-stat">
                    <span>{{ field.label }}</span>
                    <b>{{ field.value }}</b>
                  </div>
                </div>
              </div>
              <div v-if="item.rejectReason" class="text-xs text-red-900 mt-2 p-3 rounded-xl bg-red-50 dark:text-red-100 dark:bg-red-950/30">
                驳回原因：{{ item.rejectReason }}
              </div>
              <div v-if="item.provisionNote" class="text-xs text-slate-500 mt-2 dark:text-slate-400">
                开通备注：{{ item.provisionNote }} · {{ formatDate(item.provisionCompletedAt) }}
              </div>
              <details v-if="isAdmin" class="text-xs text-slate-500 mt-3 dark:text-slate-400">
                <summary class="fw-800 cursor-pointer">
                  管理员调试原始数据
                </summary>
                <pre class="mt-2 p-3 rounded-xl bg-white overflow-auto dark:bg-black/20">{{ JSON.stringify({ payload: item.payload, approvedPayload: item.approvedPayload }, null, 2) }}</pre>
              </details>
            </div>
          </div>
          <div v-if="application.termsAcceptances?.length" class="text-xs text-slate-500 mt-4 dark:text-slate-400">
            已确认条款：{{ application.termsAcceptances.map(term => `${term.termId}@${term.version}`).join('、') }}
          </div>
        </div>

        <!-- AI Review -->
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

        <!-- Application description -->
        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            申请说明
          </h3>
          <RichTextView :content="application.description" class="mt-3" />
        </div>

        <!-- Attachments -->
        <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <h3 class="text-xl fw-900">
            附件材料
          </h3>
          <div v-if="!application.attachments.length" class="text-sm text-slate-500 mt-3 dark:text-slate-400">
            暂无附件。
          </div>
          <VerificationAttachmentGrid v-else :files="application.attachments" />
        </div>

        <!-- ===== NEW: Communication Thread ===== -->
        <ApplicationThread
          :messages="messages"
          :application-id="applicationId"
          :application-user-id="application.userId"
          :application-status="application.status"
          :application-type="application.type"
          :post-approval-supplement-limit="application.postApprovalSupplementLimit"
          :post-approval-supplement-count="application.postApprovalSupplementCount"
          @send="handleSendMessage"
        />

        <!-- ===== NEW: Result Submission ===== -->
        <ApplicationResultSubmit
          :messages="messages"
          :application-status="application.status"
          @submit-result="handleSubmitResult"
          @complete="handleComplete"
        />
      </div>
    </TxCard>
  </section>
</template>
