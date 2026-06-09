<script setup lang="ts">
import type { AttachmentMeta } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxFlipOverlay, TxSelect, TxSelectItem, TxTag } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { educationEmailAdminRecommendationLabel, educationEmailReasonText, educationEmailUserLabel, educationEmailVerificationLabel, formatDate, formatPoints, formatRetentionExpiry, isGptProModel, resourceApprovalStatusText, resourceTypeLabel, verificationOrganizationLabel, verificationTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { resourceItemApprovedFields, resourceItemSummaryFields, resourceProvisionStatusText, resourceTicketStatus } from '~/composables/welfare/resource-display'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'
import VerificationAttachmentGrid from './VerificationAttachmentGrid.vue'

const props = withDefaults(defineProps<{
  kind?: 'all' | 'pro' | 'student'
  mode?: 'list' | 'dialog-only'
}>(), {
  kind: 'all',
  mode: 'list',
})

const {
  pricingSummary,
  isAdmin,
  canCrowdReview,
  currentUser,
  pendingApplications,
  pendingStudentVerifications,
  reviewDrafts,
  rejectFraudulentDrafts,
  crowdReviewDrafts,
  crowdReviewDraftFor,
  userName,
  userEmail,
  userLevelCard,
  crowdReviewsFor,
  submitCrowdReviewDraft,
  answerApplication,
  requestApplicationSupplement,
  rejectApplicationWithOptions,
  approveStudentVerification,
  requestStudentSupplement,
  rejectStudentVerification,
  submitImageGenerationApplication,
  resourceReviewDraftFor,
  resourceAutoProvisionMessage,
  provisionDraftFor,
  allocationDraftFor,
  approveResourceItem,
  completeResourceProvision,
  completeApplicationAllocation,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const showPro = computed(() => props.kind === 'all' || props.kind === 'pro')
const showStudent = computed(() => props.kind === 'all' || props.kind === 'student')
const canShowReviewQueues = computed(() => (isAdmin.value && (showPro.value || showStudent.value)) || (canCrowdReview.value && showPro.value))
const visibleReviewApplications = computed(() => {
  if (isAdmin.value)
    return pendingApplications.value

  return pendingApplications.value
    .filter(item => item.type === 'pro' && item.userId !== currentUser.value?.id)
})
const selectedReviewApplicationId = ref<string | undefined>()
const isReviewApplicationDialogOpen = ref(false)
const reviewApplicationDialogSource = ref<HTMLElement | null>(null)
const selectedReviewApplication = computed(() => visibleReviewApplications.value.find(item => item.id === selectedReviewApplicationId.value))
const reviewDraftKey = 'welfare:review-drafts'
const crowdReviewDraftKey = 'welfare:crowd-review-drafts'

function openReviewApplication(id: string, source: HTMLElement | null = null) {
  selectedReviewApplicationId.value = id
  reviewApplicationDialogSource.value = source
  isReviewApplicationDialogOpen.value = true
}

function openReviewApplicationDialog(id: string, event: MouseEvent) {
  openReviewApplication(id, event.currentTarget instanceof HTMLElement ? event.currentTarget : null)
}

defineExpose({
  openReviewApplication,
})

function closeReviewApplicationDialog() {
  isReviewApplicationDialogOpen.value = false
}

function handleReviewApplicationDialogClosed() {
  selectedReviewApplicationId.value = undefined
  reviewApplicationDialogSource.value = null
}

function onApproveApplication(id: string, type: string) {
  runSafely(async () => {
    if (type === 'image') {
      await submitImageGenerationApplication(id)
      delete reviewDrafts[id]
      delete rejectFraudulentDrafts[id]
      return
    }

    await answerApplication(id, reviewDrafts[id] ?? '')
    delete reviewDrafts[id]
    delete rejectFraudulentDrafts[id]
  }, type === 'image' ? '图片申请已通过并开始生成' : '申请已通过并完成答复')
}

function onRejectApplication(id: string) {
  const fraudulent = !!rejectFraudulentDrafts[id]
  runSafely(async () => {
    await rejectApplicationWithOptions(id, reviewDrafts[id] ?? '材料不足或不符合公益支持范围。', { fraudulent })
    delete reviewDrafts[id]
  }, fraudulent ? '已退回申请并记录造假限制' : '已退回申请并按规则处理')
}

function onRequestSupplement(id: string) {
  runSafely(async () => {
    await requestApplicationSupplement(id, reviewDrafts[id] ?? '请补充项目背景、当前进展、希望支持的具体问题和必要链接。')
    delete reviewDrafts[id]
    delete rejectFraudulentDrafts[id]
  }, '已请求用户补充材料')
}

function resourceItemAttachments(item: { payload: Record<string, any> }): AttachmentMeta[] {
  const attachments = Array.isArray(item.payload.attachments) ? item.payload.attachments : []
  return attachments.filter((file): file is AttachmentMeta => !!file
    && typeof file.id === 'string'
    && typeof file.name === 'string'
    && Number.isFinite(Number(file.size))
    && typeof file.type === 'string')
}

function onReviewResourceItem(applicationId: string, itemId: string) {
  runSafely(() => {
    return approveResourceItem(applicationId, itemId)
  }, '资源明细审批结果已保存')
}

function onCompleteProvision(applicationId: string, itemId: string) {
  runSafely(() => completeResourceProvision(applicationId, itemId), '人工开通结果已记录并已通知用户')
}

function onCompleteApplicationAllocation(applicationId: string) {
  runSafely(() => completeApplicationAllocation(applicationId), '资源分配结果已发送给用户')
}

function llmBudgetText(item: { llmApiModelKey?: string, llmApiBudgetUsd?: number }) {
  if (!item.llmApiBudgetUsd)
    return '-'
  return isGptProModel(item.llmApiModelKey) ? `${item.llmApiBudgetUsd} 轮` : `$${item.llmApiBudgetUsd}`
}

function llmPointRateText(item: { llmApiModelKey?: string, llmApiPointRate?: number }) {
  if (!item.llmApiPointRate)
    return '-'
  return isGptProModel(item.llmApiModelKey) ? `${formatPoints(item.llmApiPointRate)} / 轮` : `${item.llmApiPointRate} 积分 = 1 美元`
}

function aiReviewTone(status?: string) {
  if (status === 'approved')
    return { label: 'AI 建议通过', color: '#047857', background: 'rgba(16,185,129,.16)' }
  if (status === 'rejected')
    return { label: 'AI 建议退回', color: '#be123c', background: 'rgba(244,63,94,.14)' }
  if (status === 'failed')
    return { label: 'AI 审核失败', color: '#b45309', background: 'rgba(245,158,11,.16)' }
  if (status === 'needs_human')
    return { label: 'AI 建议人工复核', color: '#475569', background: 'rgba(100,116,139,.14)' }
  return { label: 'AI 审核中', color: '#475569', background: 'rgba(100,116,139,.14)' }
}

function crowdDecisionText(decision: string) {
  if (decision === 'approve')
    return '建议通过'
  if (decision === 'reject')
    return '建议退回'
  return '建议管理员复核'
}

function crowdDecisionTone(decision: string) {
  if (decision === 'approve')
    return { color: '#047857', background: 'rgba(16,185,129,.16)' }
  if (decision === 'reject')
    return { color: '#be123c', background: 'rgba(244,63,94,.14)' }
  return { color: '#475569', background: 'rgba(100,116,139,.14)' }
}

function onSubmitCrowdReview(id: string) {
  runSafely(() => submitCrowdReviewDraft(id), '协作建议已提交')
}

function onApproveStudent(id: string) {
  runSafely(async () => {
    await approveStudentVerification(id, reviewDrafts[id] ?? '认证通过，欢迎加入公益计划。')
    delete reviewDrafts[id]
  }, '认证申请已通过，审核积分已返还')
}

function studentSupplementDefaultReply(id: string) {
  const verification = pendingStudentVerifications.value.find(item => item.id === id)
  return verification?.verificationType === 'frontline'
    ? '材料不足，请补充组织/单位证明、服务记录或更清晰的一线工作材料后继续审核。'
    : '材料不足，请补充教育邮箱证明或更清晰的身份材料后继续审核。'
}

function onRequestStudentSupplement(id: string) {
  runSafely(async () => {
    await requestStudentSupplement(id, reviewDrafts[id] ?? studentSupplementDefaultReply(id))
    delete reviewDrafts[id]
  }, '已要求用户补充资料')
}

function onRejectStudent(id: string) {
  runSafely(async () => {
    await rejectStudentVerification(id, reviewDrafts[id] ?? '材料不足，请补充有效证明后再次申请。')
    delete reviewDrafts[id]
  }, '认证申请已退回，审核费不返还')
}

onMounted(() => {
  restoreLocalDraft(reviewDraftKey, reviewDrafts)
  persistLocalDraft(reviewDraftKey, reviewDrafts)
  restoreLocalDraft(crowdReviewDraftKey, crowdReviewDrafts)
  persistLocalDraft(crowdReviewDraftKey, crowdReviewDrafts)
})
</script>

<template>
  <div v-if="canShowReviewQueues" class="gap-6 grid" :class="[props.mode === 'dialog-only' ? 'review-queues--dialog-only' : '', showPro && showStudent && isAdmin ? 'xl:grid-cols-2' : '']">
    <TxCard v-if="showPro && (isAdmin || canCrowdReview)" class="solid-panel" background="pure" :padding="22" :radius="28">
      <h3 class="text-2xl fw-900">
        {{ isAdmin ? '申请审核队列' : '协作建议' }}
      </h3>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        {{ isAdmin ? '所有申请创建时均已完成预扣；管理员通过时完成答复，退回时返还申请预扣后按规则处理。只有明确判定造假或不实包装时，才勾选造假限制。' : '协作建议只开放 Pro 申请的 AI 初审摘要、等级和基础元数据；最终通过或退回仍由管理员处理。' }}
      </p>
      <div v-if="isAdmin && resourceAutoProvisionMessage" class="text-xs text-amber-900 leading-5 mt-4 p-3 rounded-2xl bg-amber-50 dark:text-amber-100 dark:bg-amber-950/30">
        <div class="fw-900">
          自动发放一次性凭据
        </div>
        <pre class="mt-2 whitespace-pre-wrap break-all">{{ resourceAutoProvisionMessage }}</pre>
      </div>
      <div class="mt-4 space-y-3">
        <div v-if="!visibleReviewApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无待审核申请
        </div>
        <button
          v-for="item in visibleReviewApplications"
          :key="item.id"
          type="button"
          class="review-queue-entry"
          @click="openReviewApplicationDialog(item.id, $event)"
        >
          <span class="review-queue-entry__main">
            <span class="review-queue-entry__title">{{ item.title }}</span>
            <span v-if="isAdmin" class="review-queue-entry__meta">
              {{ userName(item.userId) }} · {{ userEmail(item.userId) }} · {{ item.attachments.length }} 个附件
            </span>
            <span v-else class="review-queue-entry__meta">
              {{ userName(item.userId) }} · {{ item.type.toUpperCase() }} · {{ userLevelCard(item.userId).name }}
            </span>
            <span class="review-queue-entry__meta">
              云端记录预计保留至 {{ item.retentionExpiresAt ? formatDate(item.retentionExpiresAt) : formatRetentionExpiry(item.createdAt) }}
            </span>
          </span>
          <span class="review-queue-entry__tags">
            <TxTag :label="`${item.type.toUpperCase()} ${item.cost}`" color="#7c2d12" background="rgba(251,146,60,.18)" />
            <TxTag :label="aiReviewTone(item.aiReview?.status).label" :color="aiReviewTone(item.aiReview?.status).color" :background="aiReviewTone(item.aiReview?.status).background" />
            <span class="application-row-arrow i-carbon-chevron-right" aria-hidden="true" />
          </span>
        </button>
      </div>
    </TxCard>

    <Teleport to="body">
      <TxFlipOverlay
        v-if="selectedReviewApplicationId"
        v-model="isReviewApplicationDialogOpen"
        :source="reviewApplicationDialogSource"
        :header="false"
        :mask-closable="true"
        :scrollable="true"
        mask-class="application-detail-flip-mask"
        card-class="review-application-flip-dialog"
        close-aria-label="关闭审核详情"
        surface="pure"
        @closed="handleReviewApplicationDialogClosed"
      >
        <div v-if="selectedReviewApplication" class="review-application-dialog">
          <template v-for="item in [selectedReviewApplication]" :key="item.id">
            <div class="flex flex-wrap gap-4 items-start justify-between">
              <div class="min-w-0">
                <div class="text-2xl fw-900 truncate">
                  {{ item.title }}
                </div>
                <div v-if="isAdmin" class="text-xs text-slate-500 mt-1">
                  {{ userName(item.userId) }} · {{ userEmail(item.userId) }} · {{ item.attachments.length }} 个附件
                </div>
                <div v-else class="text-xs text-slate-500 mt-1">
                  {{ userName(item.userId) }} · {{ item.type.toUpperCase() }} · {{ userLevelCard(item.userId).name }}
                </div>
                <div class="text-xs text-slate-500 mt-1">
                  云端记录预计保留至 {{ item.retentionExpiresAt ? formatDate(item.retentionExpiresAt) : formatRetentionExpiry(item.createdAt) }}
                </div>
              </div>
              <div class="flex flex-wrap gap-2 items-center justify-end">
                <TxTag :label="`${item.type.toUpperCase()} ${item.cost}`" color="#7c2d12" background="rgba(251,146,60,.18)" />
                <TxButton size="sm" variant="ghost" @click="closeReviewApplicationDialog">
                  关闭
                </TxButton>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <TxTag :label="`${userLevelCard(item.userId).name} · P${userLevelCard(item.userId).priority}`" color="#475569" background="rgba(100,116,139,.14)" />
              <TxTag :label="aiReviewTone(item.aiReview?.status).label" :color="aiReviewTone(item.aiReview?.status).color" :background="aiReviewTone(item.aiReview?.status).background" />
              <TxTag v-if="item.storageExtended" label="存储 +7 天" color="#0f766e" background="rgba(45,212,191,.16)" />
              <TxTag v-if="item.rejectionReviewFeeWaived && item.rejectionFraudulent" label="造假仍扣手续费" color="#991b1b" background="rgba(248,113,113,.16)" />
              <TxTag v-else-if="item.rejectionReviewFeeWaived" label="退回免手续费" color="#7c3aed" background="rgba(167,139,250,.16)" />
              <TxTag v-else :label="`退回手续费 ${formatPoints(item.rejectionReviewFee)}`" color="#be123c" background="rgba(244,63,94,.12)" />
              <TxTag v-if="item.rejectionFraudulent" label="造假限制" color="#991b1b" background="rgba(248,113,113,.16)" />
              <TxTag v-if="item.type === 'code' && item.llmApiBudgetUsd" :label="`LLMApi ${item.llmApiModelName ?? ''} ${llmBudgetText(item)}`" color="#475569" background="rgba(100,116,139,.14)" />
              <TxTag v-if="item.llmApiRequiresExtendedReview" label="更长审核" color="#b45309" background="rgba(245,158,11,.16)" />
            </div>
            <div v-if="isAdmin && item.type === 'code' && item.llmApiBudgetUsd" class="text-xs text-indigo-900 leading-5 mt-3 p-3 rounded-2xl bg-indigo-50 dark:text-indigo-100 dark:bg-indigo-950/30">
              LLMApi {{ item.llmApiModelName }}（{{ item.llmApiProvider }}）{{ isGptProModel(item.llmApiModelKey) ? '对话' : '额度' }} {{ llmBudgetText(item) }}，已按 {{ llmPointRateText(item) }} 预扣 {{ formatPoints(item.cost) }}。首次访问 IP 最多 {{ item.llmApiIpLimit }} 个；默认 RPM {{ item.llmApiRpmLimit }}；并发限制 {{ item.llmApiConcurrencyLimit }}。超出 IP 限制时需要管理员清除绑定。
            </div>
            <div v-if="item.aiReview" class="text-xs leading-5 mt-3 p-3 rounded-2xl bg-slate-50 dark:bg-white/5">
              <div class="fw-800">
                {{ item.aiReview.summary }}
              </div>
              <div v-if="isAdmin && item.aiReview.reason" class="text-slate-500 mt-1 dark:text-slate-400">
                {{ item.aiReview.reason }}
              </div>
            </div>
            <RichTextView v-if="isAdmin" :content="item.description" class="rich-text-preview mt-3" />
            <div v-else class="text-xs text-slate-500 leading-5 mt-3 p-3 rounded-2xl bg-slate-50 dark:text-slate-400 dark:bg-white/5">
              协作建议不展示申请正文、邮箱、附件清单和学生材料；请基于标题、AI 初审摘要、等级和公开标签给出建议。
            </div>
            <div v-if="isAdmin && item.type === 'resource'" class="mt-4 space-y-3">
              <div class="flex flex-wrap gap-3 items-center justify-between">
                <div class="text-sm fw-900">
                  资源审核工单
                </div>
                <TxTag :label="resourceTicketStatus(item).label" :color="resourceTicketStatus(item).tone === 'danger' ? '#be123c' : resourceTicketStatus(item).tone === 'success' ? '#047857' : resourceTicketStatus(item).tone === 'warning' ? '#b45309' : '#0369a1'" background="rgba(100,116,139,.14)" />
              </div>
              <div class="text-xs text-slate-500 leading-5 p-3 rounded-2xl bg-slate-50 dark:text-slate-400 dark:bg-white/5">
                项目：{{ item.projectId || '未填写' }} · 成本归属：{{ item.costCenter || '未填写' }} · 期望生效：{{ item.expectedEffectiveAt || '-' }}
              </div>
              <div v-for="resourceItem in item.resourceItems ?? []" :key="resourceItem.id" class="p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
                <div class="flex flex-wrap gap-3 items-start justify-between">
                  <div>
                    <div class="fw-900">
                      {{ resourceTypeLabel(resourceItem.resourceType) }} · {{ resourceItem.resourceSubtype }}
                    </div>
                    <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
                      {{ resourceItem.approverGroup }} · 权限 {{ resourceItem.requestedPermission || '-' }} · 额度 {{ resourceItem.requestedQuota || '-' }} · 有效期 {{ resourceItem.duration || '-' }}
                    </div>
                  </div>
                  <TxTag :label="resourceApprovalStatusText(resourceItem.approvalStatus)" :color="resourceItem.approvalStatus === 'rejected' ? '#be123c' : resourceItem.approvalStatus === 'pending' ? '#b45309' : '#047857'" background="rgba(100,116,139,.14)" />
                </div>
                <div class="mt-3 gap-2 grid md:grid-cols-2 xl:grid-cols-3">
                  <div v-for="field in resourceItemSummaryFields(resourceItem)" :key="`${resourceItem.id}-${field.label}`" class="application-detail-stat">
                    <span>{{ field.label }}</span>
                    <b>{{ field.value }}</b>
                  </div>
                </div>
                <div v-if="resourceItemAttachments(resourceItem).length" class="mt-3 p-3 border border-black/8 rounded-2xl bg-white dark:border-white/10 dark:bg-black">
                  <div class="text-xs text-slate-500 fw-900 mb-2 dark:text-slate-400">
                    明细附件
                  </div>
                  <VerificationAttachmentGrid :files="resourceItemAttachments(resourceItem)" />
                </div>

                <div v-if="resourceItem.approvalStatus === 'pending'" class="mt-3 gap-3 grid md:grid-cols-[180px_1fr]">
                  <label class="gap-2 grid">
                    <span class="field-label">审批结果</span>
                    <TxSelect v-model="resourceReviewDraftFor(resourceItem.id).status" panel-background="pure">
                      <TxSelectItem value="approved" label="通过" />
                      <TxSelectItem value="adjusted_approved" label="调整后通过" />
                      <TxSelectItem value="rejected" label="驳回" />
                    </TxSelect>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">说明 / 驳回原因</span>
                    <RichTextEditor v-model="resourceReviewDraftFor(resourceItem.id).note" :min-height="110" placeholder="驳回时必填；通过可填写开通备注。" />
                  </label>
                  <label v-if="resourceReviewDraftFor(resourceItem.id).status === 'adjusted_approved'" class="gap-2 grid md:col-span-2">
                    <span class="field-label">批准后的额度/权限 JSON</span>
                    <textarea v-model="resourceReviewDraftFor(resourceItem.id).approvedPayloadText" class="form-textarea" rows="2" placeholder="{&quot;permission&quot;:&quot;readonly&quot;,&quot;duration&quot;:&quot;7 天&quot;}" />
                  </label>
                  <div class="md:col-span-2">
                    <TxButton size="sm" variant="primary" @click="onReviewResourceItem(item.id, resourceItem.id)">
                      保存审批结果
                    </TxButton>
                  </div>
                </div>

                <div v-else-if="['approved', 'adjusted_approved'].includes(resourceItem.approvalStatus)" class="mt-3 p-3 rounded-2xl bg-white dark:bg-black/20">
                  <div class="text-xs fw-900">
                    发放状态：{{ resourceProvisionStatusText(resourceItem.provisionStatus) }}
                  </div>
                  <div v-if="resourceItemApprovedFields(resourceItem).length" class="mt-2 gap-2 grid md:grid-cols-2">
                    <div v-for="field in resourceItemApprovedFields(resourceItem)" :key="`${resourceItem.id}-approved-${field.label}`" class="application-detail-stat">
                      <span>{{ field.label }}</span>
                      <b>{{ field.value }}</b>
                    </div>
                  </div>
                  <div v-if="resourceItem.provisionStatus !== 'completed'" class="mt-2 gap-3 grid md:grid-cols-2">
                    <label class="gap-2 grid">
                      <span class="field-label">资源名称</span>
                      <input v-model="provisionDraftFor(resourceItem.id).resourceName" class="form-input" placeholder="如 Codex API Key / 数据库账号">
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">资源类型</span>
                      <input v-model="provisionDraftFor(resourceItem.id).resourceType" class="form-input" placeholder="account / api_key / database / subscription">
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">访问地址</span>
                      <input v-model="provisionDraftFor(resourceItem.id).accessUrl" class="form-input" placeholder="控制台、订阅或连接地址">
                    </label>
                    <label class="gap-2 grid">
                      <span class="field-label">有效期</span>
                      <input v-model="provisionDraftFor(resourceItem.id).expiresAt" class="form-input" placeholder="如 2026-07-01 或按默认配置">
                    </label>
                    <label class="gap-2 grid md:col-span-2">
                      <span class="field-label">凭据 / 备注</span>
                      <textarea v-model="provisionDraftFor(resourceItem.id).credential" class="form-textarea" rows="3" placeholder="账号、Key、订阅链接或连接凭据；会发送给用户" />
                    </label>
                    <label class="gap-2 grid md:col-span-2">
                      <span class="field-label">补充说明</span>
                      <textarea v-model="provisionDraftFor(resourceItem.id).note" class="form-textarea" rows="2" placeholder="使用说明、限制或交付方式" />
                    </label>
                    <div class="md:col-span-2">
                      <TxButton size="sm" variant="secondary" @click="onCompleteProvision(item.id, resourceItem.id)">
                        提交并发送给用户
                      </TxButton>
                    </div>
                  </div>
                  <div v-else class="text-xs text-slate-500 mt-2 dark:text-slate-400">
                    {{ resourceItem.provisionNote || '已完成' }} · {{ formatDate(resourceItem.provisionCompletedAt) }}
                  </div>
                </div>

                <div v-if="resourceItem.rejectReason" class="text-xs text-red-700 mt-2 dark:text-red-200">
                  驳回原因：{{ resourceItem.rejectReason }}
                </div>
                <details class="text-xs text-slate-500 mt-3 dark:text-slate-400">
                  <summary class="fw-800 cursor-pointer">
                    调试原始数据
                  </summary>
                  <pre class="mt-2 p-3 rounded-xl bg-white overflow-auto dark:bg-black/20">{{ JSON.stringify({ payload: resourceItem.payload, approvedPayload: resourceItem.approvedPayload }, null, 2) }}</pre>
                </details>
              </div>
            </div>
            <div v-if="item.githubRepo" class="text-sm mt-3 flex flex-wrap gap-2 items-center">
              <TxTag label="开源认证" color="#475569" background="rgba(100,116,139,.14)" />
              <span v-if="isAdmin" class="text-slate-500">{{ item.githubRepo }}</span>
            </div>
            <div v-if="isAdmin && crowdReviewsFor('pro_application', item.id).length" class="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
              <div class="text-sm fw-900">
                众包建议
              </div>
              <div class="mt-3 space-y-3">
                <div v-for="review in crowdReviewsFor('pro_application', item.id)" :key="review.id" class="text-xs leading-5">
                  <div class="flex flex-wrap gap-2 items-center">
                    <TxTag :label="crowdDecisionText(review.decision)" :color="crowdDecisionTone(review.decision).color" :background="crowdDecisionTone(review.decision).background" />
                    <span class="text-slate-500 dark:text-slate-400">{{ userName(review.reviewerId) }} · {{ formatDate(review.createdAt) }}</span>
                  </div>
                  <RichTextView :content="review.note" class="rich-text-preview mt-2" />
                </div>
              </div>
            </div>
            <div v-if="isAdmin && item.status === 'needs_supplement'" class="text-amber-900 mt-4 p-4 rounded-2xl bg-amber-50 dark:text-amber-100 dark:bg-amber-950/20">
              <div class="text-sm fw-900 flex gap-2 items-center">
                <span class="i-carbon-time" />
                等待用户补充材料
              </div>
              <p class="text-xs leading-5 mt-2 opacity-80">
                用户提交补充后会自动回到待审核队列，补充内容会进入申请详情的协作线程。
              </p>
            </div>
            <div v-else-if="isAdmin && item.type !== 'resource' && item.status === 'pending_allocation'" class="mt-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20">
              <div class="text-sm fw-900">
                待分配资源
              </div>
              <p class="text-xs text-slate-500 leading-5 mt-1 dark:text-slate-400">
                自动发放不可用或未配置，请填写完整资源信息；提交后会通过现有消息渠道发送给用户。
              </p>
              <div class="mt-3 gap-3 grid md:grid-cols-2">
                <label class="gap-2 grid">
                  <span class="field-label">资源名称</span>
                  <input v-model="allocationDraftFor(item.id).resourceName" class="form-input" placeholder="如 Codex 订阅 / API Key">
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">资源类型</span>
                  <input v-model="allocationDraftFor(item.id).resourceType" class="form-input" placeholder="account / api_key / subscription">
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">访问地址</span>
                  <input v-model="allocationDraftFor(item.id).accessUrl" class="form-input" placeholder="订阅链接、控制台或登录地址">
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">有效期</span>
                  <input v-model="allocationDraftFor(item.id).expiresAt" class="form-input" placeholder="如 2026-07-01 或按默认配置">
                </label>
                <label class="gap-2 grid md:col-span-2">
                  <span class="field-label">凭据</span>
                  <textarea v-model="allocationDraftFor(item.id).credential" class="form-textarea" rows="3" placeholder="账号、Key、订阅链接或其他交付凭据；会发送给用户" />
                </label>
                <label class="gap-2 grid md:col-span-2">
                  <span class="field-label">使用说明</span>
                  <textarea v-model="allocationDraftFor(item.id).note" class="form-textarea" rows="2" placeholder="限制、注意事项、后续续期方式等" />
                </label>
              </div>
              <TxButton class="mt-4" size="sm" variant="primary" @click="onCompleteApplicationAllocation(item.id)">
                完成分配并发送给用户
              </TxButton>
            </div>
            <RichTextEditor v-else-if="isAdmin && item.type !== 'resource'" v-model="reviewDrafts[item.id]" class="mt-4" :min-height="150" :placeholder="item.type === 'image' ? '给用户的审核说明：通过后将生成图片' : item.type === 'pro' ? '给用户的审核答复，或填写需要补充的具体材料' : '给用户的审核答复'" />
            <label v-if="isAdmin && item.type !== 'resource' && item.status !== 'needs_supplement' && item.status !== 'pending_allocation'" class="option-check mt-4">
              <TxCheckbox v-model="rejectFraudulentDrafts[item.id]" variant="checkmark" aria-label="判定造假或不实包装" />
              <span>
                <b>判定造假或不实包装</b>
                <small>仅在确认存在虚构项目、冒用材料、AI 包装成本人经历、隐瞒关键事实等明显不实情况时勾选；退回后 7 天内不能提交同类申请。</small>
              </span>
            </label>
            <div v-if="isAdmin && item.type !== 'resource' && item.status !== 'needs_supplement' && item.status !== 'pending_allocation'" class="mt-4 flex flex-wrap gap-3">
              <TxButton variant="primary" @click="onApproveApplication(item.id, item.type)">
                {{ item.type === 'image' ? '通过并生成图片' : '通过并答复' }}
              </TxButton>
              <TxButton v-if="item.type === 'pro'" variant="secondary" @click="onRequestSupplement(item.id)">
                请求补充材料
              </TxButton>
              <TxButton variant="danger" @click="onRejectApplication(item.id)">
                退回
              </TxButton>
            </div>
            <div v-else-if="item.type === 'pro'" class="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
              <div class="text-sm fw-900">
                提交审核建议
              </div>
              <div class="mt-3 gap-3 grid md:grid-cols-[180px_1fr]">
                <label class="gap-2 grid">
                  <span class="field-label">建议结论</span>
                  <select v-model="crowdReviewDraftFor(item.id).decision" class="form-select">
                    <option value="needs_admin">
                      管理员复核
                    </option>
                    <option value="approve">
                      建议通过
                    </option>
                    <option value="reject">
                      建议退回
                    </option>
                  </select>
                </label>
                <div class="gap-2 grid">
                  <span class="field-label">建议说明</span>
                  <RichTextEditor v-model="crowdReviewDraftFor(item.id).note" :min-height="120" placeholder="仅填写审核判断依据；不要要求或记录邮箱、证件、附件原文等敏感材料。" />
                </div>
              </div>
              <TxButton class="mt-4" size="sm" variant="secondary" @click="onSubmitCrowdReview(item.id)">
                提交建议
              </TxButton>
            </div>
          </template>
        </div>
      </TxFlipOverlay>
    </Teleport>

    <TxCard v-if="isAdmin && showStudent" class="solid-panel" background="pure" :padding="22" :radius="28">
      <h3 class="text-2xl fw-900">
        认证申请审核
      </h3>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        管理员可在此处理认证材料；可先要求补充资料，通过后返还审核费，最终退回不返还。
      </p>
      <div class="mt-4 space-y-4">
        <div v-if="!pendingStudentVerifications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无待审核认证申请
        </div>
        <div v-for="item in pendingStudentVerifications" :key="item.id" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex gap-3 items-start justify-between">
            <div>
              <div class="text-lg fw-900">
                {{ item.realName }} · {{ verificationTypeLabel(item.verificationType) }} · {{ item.category }}
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ userName(item.userId) }} · {{ verificationOrganizationLabel(item.verificationType) }}：{{ item.school || '未填写' }} · {{ item.attachments.length }} 个材料
              </div>
              <div class="text-xs text-slate-500 mt-1">
                云端记录预计保留至 {{ formatRetentionExpiry(item.createdAt) }}
              </div>
              <div v-if="item.grade || item.educationLevel || item.identity" class="text-xs text-slate-500 mt-1">
                {{ [item.grade, item.educationLevel, item.identity].filter(Boolean).join(' · ') }}
              </div>
              <div v-if="item.verificationType !== 'frontline' && item.educationEmail" class="text-xs text-slate-500 mt-1">
                邮箱证明：{{ item.educationEmail }}
                <span v-if="item.educationEmailVerified" class="text-emerald-700 fw-800 ml-2 dark:text-emerald-300">{{ educationEmailVerificationLabel(item.educationEmailVerificationSource) }}</span>
              </div>
              <div v-if="item.verificationType !== 'frontline' && item.educationEmail" class="text-xs text-slate-500 mt-1">
                机构识别：{{ educationEmailUserLabel(item.educationEmail, !!item.educationEmailVerified) }} · 管理员建议：{{ educationEmailAdminRecommendationLabel(item.educationEmail) }} · {{ educationEmailReasonText(item.educationEmail) }}
              </div>
            </div>
            <TxTag :label="`审核费 ${pricingSummary.studentReviewFee}`" color="#854d0e" background="rgba(250,204,21,.18)" />
          </div>
          <RichTextView :content="item.notes" class="rich-text-preview mt-3" />
          <VerificationAttachmentGrid v-if="item.attachments.length" :files="item.attachments" />
          <RichTextEditor v-model="reviewDrafts[item.id]" class="mt-4" :min-height="150" :placeholder="`审核说明：可通过、要求补充资料或最终退回。通过会返还 ${pricingSummary.studentReviewFee} 积分，退回不返还`" />
          <div class="mt-4 flex flex-wrap gap-3">
            <TxButton variant="primary" @click="onApproveStudent(item.id)">
              通过并返还
            </TxButton>
            <TxButton variant="secondary" @click="onRequestStudentSupplement(item.id)">
              要求补充资料
            </TxButton>
            <TxButton variant="danger" @click="onRejectStudent(item.id)">
              退回
            </TxButton>
          </div>
        </div>
      </div>
    </TxCard>
  </div>
</template>
