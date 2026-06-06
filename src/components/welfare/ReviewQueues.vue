<script setup lang="ts">
import { TxButton, TxCard, TxCheckbox, TxSelect, TxSelectItem, TxTag } from '@talex-touch/tuffex'
import { computed, onMounted } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { formatDate, formatPoints, formatRetentionExpiry, provisionStatusText, resourceApprovalStatusText, resourceTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const props = withDefaults(defineProps<{
  kind?: 'all' | 'pro' | 'student'
}>(), {
  kind: 'all',
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
  rejectStudentVerification,
  submitImageGenerationApplication,
  resourceReviewDraftFor,
  resourceProvisionDrafts,
  approveResourceItem,
  completeResourceProvision,
} = useWelfareUiState()

const { runSafely } = useWelfareFeedback()
const showPro = computed(() => props.kind === 'all' || props.kind === 'pro')
const showStudent = computed(() => props.kind === 'all' || props.kind === 'student')
const visibleReviewApplications = computed(() => {
  if (isAdmin.value)
    return pendingApplications.value

  return pendingApplications.value
    .filter(item => item.type === 'pro' && item.userId !== currentUser.value?.id)
})
const reviewDraftKey = 'welfare:review-drafts'
const crowdReviewDraftKey = 'welfare:crowd-review-drafts'

function onApproveApplication(id: string, type: string) {
  runSafely(async () => {
    if (type === 'image') {
      await submitImageGenerationApplication(id)
      delete reviewDrafts[id]
      delete rejectFraudulentDrafts[id]
      return
    }

    answerApplication(id, reviewDrafts[id] ?? '')
    delete reviewDrafts[id]
    delete rejectFraudulentDrafts[id]
  }, type === 'image' ? '图片申请已通过并开始生成' : '申请已通过并完成答复')
}

function onRejectApplication(id: string) {
  const fraudulent = !!rejectFraudulentDrafts[id]
  runSafely(() => {
    rejectApplicationWithOptions(id, reviewDrafts[id] ?? '材料不足或不符合公益支持范围。', { fraudulent })
    delete reviewDrafts[id]
  }, fraudulent ? '已退回申请并记录造假限制' : '已退回申请并按规则处理')
}

function onRequestSupplement(id: string) {
  runSafely(() => {
    requestApplicationSupplement(id, reviewDrafts[id] ?? '请补充项目背景、当前进展、希望支持的具体问题和必要链接。')
    delete reviewDrafts[id]
    delete rejectFraudulentDrafts[id]
  }, '已请求用户补充材料')
}

function onReviewResourceItem(applicationId: string, itemId: string) {
  runSafely(() => {
    approveResourceItem(applicationId, itemId)
  }, '资源明细审批结果已保存')
}

function onCompleteProvision(applicationId: string, itemId: string) {
  runSafely(() => {
    completeResourceProvision(applicationId, itemId)
  }, '人工开通结果已记录')
}

function aiReviewTone(status?: string) {
  if (status === 'approved')
    return { label: 'AI 建议通过', color: '#047857', background: 'rgba(16,185,129,.16)' }
  if (status === 'rejected')
    return { label: 'AI 建议退回', color: '#be123c', background: 'rgba(244,63,94,.14)' }
  if (status === 'failed')
    return { label: 'AI 审核失败', color: '#b45309', background: 'rgba(245,158,11,.16)' }
  if (status === 'needs_human')
    return { label: 'AI 建议人工复核', color: '#0369a1', background: 'rgba(14,165,233,.14)' }
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
  return { color: '#0369a1', background: 'rgba(14,165,233,.14)' }
}

function onSubmitCrowdReview(id: string) {
  runSafely(() => {
    submitCrowdReviewDraft(id)
  }, '众包审核建议已提交')
}

function onApproveStudent(id: string) {
  runSafely(() => {
    approveStudentVerification(id, reviewDrafts[id] ?? '认证通过，欢迎加入公益计划。')
    delete reviewDrafts[id]
  }, '学生认证已通过，审核积分已返还')
}

function onRejectStudent(id: string) {
  runSafely(() => {
    rejectStudentVerification(id, reviewDrafts[id] ?? '材料不足，请补充有效证明后再次申请。')
    delete reviewDrafts[id]
  }, '学生认证已退回，审核费不返还')
}

onMounted(() => {
  restoreLocalDraft(reviewDraftKey, reviewDrafts)
  persistLocalDraft(reviewDraftKey, reviewDrafts)
  restoreLocalDraft(crowdReviewDraftKey, crowdReviewDrafts)
  persistLocalDraft(crowdReviewDraftKey, crowdReviewDrafts)
})
</script>

<template>
  <div v-if="(isAdmin && (showPro || showStudent)) || (canCrowdReview && showPro)" class="gap-6 grid" :class="showPro && showStudent && isAdmin ? 'xl:grid-cols-2' : ''">
    <TxCard v-if="showPro && (isAdmin || canCrowdReview)" class="solid-panel" background="pure" :padding="22" :radius="28">
      <h3 class="text-2xl fw-900">
        {{ isAdmin ? '申请审核队列' : '众包审核建议' }}
      </h3>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        {{ isAdmin ? '所有申请创建时均已完成预扣；管理员通过时完成答复，退回时返还申请预扣后按规则处理。只有明确判定造假或不实包装时，才勾选造假限制。' : '众包审核只开放 Pro 申请的 AI 初审摘要、等级和基础元数据；最终通过或退回仍由管理员处理。' }}
      </p>
      <div class="mt-4 space-y-4">
        <div v-if="!visibleReviewApplications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无待审核申请
        </div>
        <div v-for="item in visibleReviewApplications" :key="item.id" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <div class="text-lg fw-900 truncate">
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
            <TxTag :label="`${item.type.toUpperCase()} ${item.cost}`" color="#7c2d12" background="rgba(251,146,60,.18)" />
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <TxTag :label="`${userLevelCard(item.userId).name} · P${userLevelCard(item.userId).priority}`" color="#4338ca" background="rgba(99,102,241,.14)" />
            <TxTag :label="aiReviewTone(item.aiReview?.status).label" :color="aiReviewTone(item.aiReview?.status).color" :background="aiReviewTone(item.aiReview?.status).background" />
            <TxTag v-if="item.storageExtended" label="存储 +7 天" color="#0f766e" background="rgba(45,212,191,.16)" />
            <TxTag v-if="item.rejectionReviewFeeWaived && item.rejectionFraudulent" label="造假仍扣手续费" color="#991b1b" background="rgba(248,113,113,.16)" />
            <TxTag v-else-if="item.rejectionReviewFeeWaived" label="退回免手续费" color="#7c3aed" background="rgba(167,139,250,.16)" />
            <TxTag v-else :label="`退回手续费 ${formatPoints(item.rejectionReviewFee)}`" color="#be123c" background="rgba(244,63,94,.12)" />
            <TxTag v-if="item.rejectionFraudulent" label="造假限制" color="#991b1b" background="rgba(248,113,113,.16)" />
            <TxTag v-if="item.type === 'code' && item.llmApiBudgetUsd" :label="`LLMApi ${item.llmApiModelName ?? ''} $${item.llmApiBudgetUsd}`" color="#4338ca" background="rgba(99,102,241,.14)" />
            <TxTag v-if="item.llmApiRequiresExtendedReview" label="更长审核" color="#b45309" background="rgba(245,158,11,.16)" />
          </div>
          <div v-if="isAdmin && item.type === 'code' && item.llmApiBudgetUsd" class="text-xs text-indigo-900 leading-5 mt-3 p-3 rounded-2xl bg-indigo-50 dark:text-indigo-100 dark:bg-indigo-950/30">
            LLMApi {{ item.llmApiModelName }}（{{ item.llmApiProvider }}）额度 ${{ item.llmApiBudgetUsd }}，已按 {{ item.llmApiPointRate }} 积分 = 1 美元预扣 {{ formatPoints(item.cost) }}。首次访问 IP 最多 {{ item.llmApiIpLimit }} 个；默认 RPM {{ item.llmApiRpmLimit }}；并发限制 {{ item.llmApiConcurrencyLimit }}。超出 IP 限制时需要管理员清除绑定。
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
            众包审核不展示申请正文、邮箱、附件清单和学生材料；请基于标题、AI 初审摘要、等级和公开标签给出建议。
          </div>
          <div v-if="isAdmin && item.type === 'resource'" class="mt-4 space-y-3">
            <div class="text-sm fw-900">
              资源明细逐项审批
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
              <pre class="text-xs mt-3 p-3 rounded-xl bg-white overflow-auto dark:bg-black/20">{{ JSON.stringify(resourceItem.payload, null, 2) }}</pre>

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
                  人工开通：{{ provisionStatusText(resourceItem.provisionStatus) }}
                </div>
                <div v-if="resourceItem.provisionStatus !== 'completed'" class="mt-2 gap-2 grid md:grid-cols-[1fr_auto]">
                  <RichTextEditor v-model="resourceProvisionDrafts[resourceItem.id]" :min-height="100" placeholder="记录开通结果、账号、备注或交付方式" />
                  <TxButton size="sm" variant="secondary" @click="onCompleteProvision(item.id, resourceItem.id)">
                    标记已开通
                  </TxButton>
                </div>
                <div v-else class="text-xs text-slate-500 mt-2 dark:text-slate-400">
                  {{ resourceItem.provisionNote || '已完成' }} · {{ formatDate(resourceItem.provisionCompletedAt) }}
                </div>
              </div>

              <div v-if="resourceItem.rejectReason" class="text-xs text-red-700 mt-2 dark:text-red-200">
                驳回原因：{{ resourceItem.rejectReason }}
              </div>
            </div>
          </div>
          <div v-if="item.githubRepo" class="text-sm mt-3 flex flex-wrap gap-2 items-center">
            <TxTag label="开源认证" color="#0369a1" background="rgba(14,165,233,.14)" />
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
          <RichTextEditor v-else-if="isAdmin && item.type !== 'resource'" v-model="reviewDrafts[item.id]" class="mt-4" :min-height="150" :placeholder="item.type === 'image' ? '给用户的审核说明：通过后将生成图片' : item.type === 'pro' ? '给用户的审核答复，或填写需要补充的具体材料' : '给用户的审核答复'" />
          <label v-if="isAdmin && item.type !== 'resource' && item.status !== 'needs_supplement'" class="option-check mt-4">
            <TxCheckbox v-model="rejectFraudulentDrafts[item.id]" variant="checkmark" aria-label="判定造假或不实包装" />
            <span>
              <b>判定造假或不实包装</b>
              <small>仅在确认存在虚构项目、冒用材料、AI 包装成本人经历、隐瞒关键事实等明显不实情况时勾选；退回后 7 天内不能提交同类申请。</small>
            </span>
          </label>
          <div v-if="isAdmin && item.type !== 'resource' && item.status !== 'needs_supplement'" class="mt-4 flex flex-wrap gap-3">
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
        </div>
      </div>
    </TxCard>

    <TxCard v-if="isAdmin && showStudent" class="solid-panel" background="pure" :padding="22" :radius="28">
      <h3 class="text-2xl fw-900">
        学生认证审核
      </h3>
      <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
        管理员可在此处理认证材料；通过后返还审核费，退回不返还。
      </p>
      <div class="mt-4 space-y-4">
        <div v-if="!pendingStudentVerifications.length" class="text-sm text-slate-500 p-8 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
          暂无待审核学生认证
        </div>
        <div v-for="item in pendingStudentVerifications" :key="item.id" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
          <div class="flex gap-3 items-start justify-between">
            <div>
              <div class="text-lg fw-900">
                {{ item.realName }} · {{ item.category }}
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ userName(item.userId) }} · {{ item.school || '未填写学校' }} · {{ item.attachments.length }} 个材料
              </div>
              <div class="text-xs text-slate-500 mt-1">
                云端记录预计保留至 {{ formatRetentionExpiry(item.createdAt) }}
              </div>
              <div v-if="item.grade || item.educationLevel || item.identity" class="text-xs text-slate-500 mt-1">
                {{ [item.grade, item.educationLevel, item.identity].filter(Boolean).join(' · ') }}
              </div>
              <div v-if="item.educationEmail" class="text-xs text-slate-500 mt-1">
                教育邮箱：{{ item.educationEmail }}
              </div>
            </div>
            <TxTag :label="`审核费 ${pricingSummary.studentReviewFee}`" color="#854d0e" background="rgba(250,204,21,.18)" />
          </div>
          <RichTextView :content="item.notes" class="rich-text-preview mt-3" />
          <RichTextEditor v-model="reviewDrafts[item.id]" class="mt-4" :min-height="150" :placeholder="`审核说明：通过会返还 ${pricingSummary.studentReviewFee} 积分，退回不返还`" />
          <div class="mt-4 flex flex-wrap gap-3">
            <TxButton variant="primary" @click="onApproveStudent(item.id)">
              通过并返还
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
