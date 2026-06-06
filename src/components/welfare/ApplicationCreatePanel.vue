<script setup lang="ts">
import type { ResourceTermId, ResourceType } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxDatePicker, TxFileUploader, TxInput, TxNumberInput, TxSelect, TxSelectItem, TxSlider, TxStep, TxSteps } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { ACTIVITY_NAME, calculateActivityPrice, calculateLlmApiCostPoints, calculateLlmApiRateLimitChangeCost, canApplyResourceType, formatBytes, LLM_API_MODEL_COST_MULTIPLIERS, MAX_ACTIVE_USER_REQUESTS, MAX_ATTACHMENT_BYTES, RESOURCE_DEFAULT_DURATION, RESOURCE_DURATION_EXTENSION_COST } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import TurnstileChallenge from './TurnstileChallenge.vue'

const {
  currentUser,
  applicationSecurityForm,
  applicationFiles,
  resourceApplicationForm,
  resourceApplicationItems,
  resourceTypeConfigs,
  selectedResourceTerms,
  resourceApplicationPolicyStatus,
  totalApplicationBytes,
  activeRequestCount,
  canCreateRequest,
  enabledLlmApiModels,
  userLevelCard,
  submitResourceApplication,
  addResourceApplicationItem,
  removeResourceApplicationItem,
  ensureSelectedResourceItems,
  resetResourceApplicationForm,
  resetApplicationFiles,
  resetApplicationSecurity,
  setApplicationTurnstileToken,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const currentStep = ref<'types' | 'materials' | 'terms'>('types')
const expectedDatePickerVisible = ref(false)
const applicationDraftKey = 'welfare:resource-application-draft'
const activeStep = computed(() => currentStep.value === 'types' ? 0 : currentStep.value === 'materials' ? 1 : 2)
const currentUserLevelPriority = computed(() => currentUser.value ? userLevelCard(currentUser.value.id).priority : 0)
const visibleResourceTypeConfigs = computed(() => resourceTypeConfigs.value.filter(config => isResourceTypeAvailable(config.resourceType)))
const groupedResourceItems = computed(() => resourceApplicationForm.selectedResourceTypes.map(resourceType => ({
  config: resourceTypeConfigs.value.find(item => item.resourceType === resourceType),
  items: resourceApplicationItems.value.filter(item => item.resourceType === resourceType),
})).filter(group => group.config))

const databasePermissionOptions = [
  { value: 'readonly', label: '只读' },
  { value: 'readwrite', label: '读写' },
  { value: 'admin', label: '管理员' },
  { value: 'temporary_ops', label: '临时运维' },
]
const environmentOptions = ['dev', 'test', 'staging', 'prod']
const urgencyOptions = [
  { value: 'normal', label: '普通' },
  { value: 'urgent', label: '紧急' },
  { value: 'emergency', label: '应急' },
]
const llmBudgetMarks = [10, 100, 500, 1000]
const durationOptions = [
  { value: RESOURCE_DEFAULT_DURATION, label: RESOURCE_DEFAULT_DURATION },
  { value: '7 天', label: '延长至 7 天' },
  { value: '30 天', label: '延长至 30 天' },
]

function formatUsd(value: number) {
  return `$${Number(value || 0).toLocaleString('en-US')}`
}

interface ResourceDraftItem {
  resourceType: ResourceType
  payload: Record<string, any>
  requestedQuota?: string
  resourceSubtype?: string
  duration?: string
}

function llmModelForItem(item: { payload: Record<string, any> }) {
  return enabledLlmApiModels.value.find(model => model.key === item.payload.model)
    ?? enabledLlmApiModels.value[0]
}

function sanitizeLlmItem(item: ResourceDraftItem) {
  const model = llmModelForItem(item)
  if (!model)
    return

  if (item.payload.model !== model.key)
    item.payload.model = model.key
  item.resourceSubtype = model.key
  item.payload.modelName = model.name
  item.payload.budgetLimit = Math.max(model.minBudgetUsd, Math.min(model.maxBudgetUsd, Number(item.payload.budgetLimit || model.defaultBudgetUsd)))
  item.payload.rpmLimit = Math.max(1, Math.trunc(Number(item.payload.rpmLimit || model.rpmLimit)))
  item.payload.tpmLimit = Math.max(1, Math.trunc(Number(item.payload.tpmLimit || model.tpmLimit)))
  item.payload.defaultRpmLimit = model.rpmLimit
  item.payload.defaultTpmLimit = model.tpmLimit
  item.payload.uploadsUserData = false
  item.payload.uploadUserData = false
  item.payload.containsSensitiveInfo = false
  item.payload.containsPrivacy = false
  item.payload.logRetention = 0
  item.payload.duration = item.payload.duration || RESOURCE_DEFAULT_DURATION
  item.requestedQuota = formatUsd(item.payload.budgetLimit)
  item.duration = item.payload.duration
}

function onLlmModelChange(item: ResourceDraftItem) {
  const model = llmModelForItem(item)
  if (!model)
    return

  item.payload.model = model.key
  item.resourceSubtype = model.key
  item.payload.modelName = model.name
  item.payload.budgetLimit = model.defaultBudgetUsd
  item.payload.rpmLimit = model.rpmLimit
  item.payload.tpmLimit = model.tpmLimit
  item.payload.defaultRpmLimit = model.rpmLimit
  item.payload.defaultTpmLimit = model.tpmLimit
  item.payload.duration = item.payload.duration || RESOURCE_DEFAULT_DURATION
  item.requestedQuota = formatUsd(model.defaultBudgetUsd)
  item.duration = item.payload.duration
}

function sanitizeResourceDurations() {
  for (const item of resourceApplicationItems.value) {
    const duration = item.duration || item.payload.duration || RESOURCE_DEFAULT_DURATION
    item.duration = duration
    item.payload.duration = duration
    item.payload.durationExtensionCost = itemDurationExtensionCost(item)
    item.payload.estimatedCost = itemUndiscountedEstimate(item)
    item.payload.discountedEstimatedCost = itemDiscountedEstimate(item)
  }
}

function sanitizeLlmItems() {
  for (const item of resourceApplicationItems.value) {
    if (item.resourceType === 'llm_api_quota')
      sanitizeLlmItem(item)
  }
}

function itemDurationExtensionCost(item: { duration?: string, payload: Record<string, any> }) {
  const duration = item.duration || item.payload.duration || RESOURCE_DEFAULT_DURATION
  return duration === RESOURCE_DEFAULT_DURATION ? 0 : RESOURCE_DURATION_EXTENSION_COST
}

function formatPoints(value: number) {
  return `${Math.ceil(value).toLocaleString('zh-CN')} 积分`
}

function itemModelMultiplier(item: { payload: Record<string, any> }) {
  const modelKey = String(item.payload.model || '') as keyof typeof LLM_API_MODEL_COST_MULTIPLIERS
  return LLM_API_MODEL_COST_MULTIPLIERS[modelKey] ?? 1
}

function itemBaseEstimate(item: { resourceType: ResourceType, payload: Record<string, any>, duration?: string }) {
  if (item.resourceType === 'llm_api_quota') {
    const model = llmModelForItem(item)
    return model ? calculateLlmApiCostPoints(Number(item.payload.budgetLimit || 10), model) : Number(item.payload.budgetLimit || 10) * 10 * itemModelMultiplier(item)
  }
  if (item.resourceType === 'database')
    return 1000 + (item.payload.sensitiveData ? 3000 : 0)
  return 800 * Math.max(1, Number(item.payload.quantity || 1))
}

function itemEstimateParts(item: { resourceType: ResourceType, payload: Record<string, any>, duration?: string }) {
  const base = itemBaseEstimate(item)
  const discountBase = calculateActivityPrice(base)
  const rate = llmRateChangeCost(item)
  const duration = itemDurationExtensionCost(item)
  return {
    base,
    discountBase,
    rate,
    duration,
    original: base + rate + duration,
    discounted: discountBase + rate + duration,
    savings: Math.max(0, base - discountBase),
  }
}

function itemUndiscountedEstimate(item: ResourceDraftItem) {
  return itemBaseEstimate(item) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
}

function itemDiscountedEstimate(item: ResourceDraftItem) {
  return calculateActivityPrice(itemBaseEstimate(item)) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
}

const totalUndiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemUndiscountedEstimate(item), 0))
const totalDiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemDiscountedEstimate(item), 0))
const totalDiscountSavings = computed(() => Math.max(0, totalUndiscountedEstimate.value - totalDiscountedEstimate.value))
const isResourceSubmissionBlocked = computed(() =>
  !canCreateRequest.value
  || resourceApplicationForm.acceptedTermIds.length !== selectedResourceTerms.value.length
  || !resourceApplicationPolicyStatus.value.available
  || !resourceApplicationPolicyStatus.value.descriptionOk
  || (resourceApplicationPolicyStatus.value.turnstileEnabled && !applicationSecurityForm.turnstileToken),
)

function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

function todayYmd() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function splitDateTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/)
  return {
    date: match?.[1] || '',
    time: match?.[2] || '',
  }
}

function joinDateTime(date: string, time: string) {
  if (!date)
    return ''

  return time ? `${date} ${time}` : date
}

const expectedDateValue = computed({
  get: () => splitDateTime(resourceApplicationForm.expectedEffectiveAt).date,
  set: (date: string) => {
    resourceApplicationForm.expectedEffectiveAt = joinDateTime(date, splitDateTime(resourceApplicationForm.expectedEffectiveAt).time)
  },
})
const expectedTimeValue = computed({
  get: () => splitDateTime(resourceApplicationForm.expectedEffectiveAt).time,
  set: (time: string) => {
    resourceApplicationForm.expectedEffectiveAt = joinDateTime(expectedDateValue.value || todayYmd(), time)
  },
})

function openExpectedDatePicker() {
  expectedDatePickerVisible.value = true
}

function llmRateChangeCost(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  if (!model)
    return 0

  return calculateLlmApiRateLimitChangeCost(
    Number(item.payload.rpmLimit || model.rpmLimit),
    Number(item.payload.defaultRpmLimit || model.rpmLimit),
    Number(item.payload.tpmLimit || model.tpmLimit),
    Number(item.payload.defaultTpmLimit || model.tpmLimit),
  )
}

function resourceConfig(resourceType: ResourceType) {
  return resourceTypeConfigs.value.find(item => item.resourceType === resourceType)
}

function isSelectedResourceType(resourceType: ResourceType) {
  return resourceApplicationForm.selectedResourceTypes.includes(resourceType)
}

function isResourceTypeAvailable(resourceType: ResourceType) {
  const config = resourceConfig(resourceType)
  return !!config && canApplyResourceType(config, currentUserLevelPriority.value)
}

function sanitizeSelectedResourceTypes() {
  const allowed = resourceApplicationForm.selectedResourceTypes.filter(isResourceTypeAvailable)
  resourceApplicationForm.selectedResourceTypes = allowed.length ? allowed : ['database']
  resourceApplicationItems.value = resourceApplicationItems.value.filter(item => isResourceTypeAvailable(item.resourceType))
  ensureSelectedResourceItems()
}

function toggleResourceType(resourceType: ResourceType) {
  if (!isResourceTypeAvailable(resourceType))
    return
  const exists = isSelectedResourceType(resourceType)
  if (exists && resourceApplicationForm.selectedResourceTypes.length === 1)
    return
  resourceApplicationForm.selectedResourceTypes = exists
    ? resourceApplicationForm.selectedResourceTypes.filter(item => item !== resourceType)
    : [...resourceApplicationForm.selectedResourceTypes, resourceType]
  ensureSelectedResourceItems()
}

function nextToMaterials() {
  sanitizeSelectedResourceTypes()
  currentStep.value = 'materials'
}

function nextToTerms() {
  ensureSelectedResourceItems()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  currentStep.value = 'terms'
}

function hasAcceptedTerm(termId: ResourceTermId) {
  return resourceApplicationForm.acceptedTermIds.includes(termId)
}

function toggleTerm(termId: ResourceTermId) {
  resourceApplicationForm.acceptedTermIds = hasAcceptedTerm(termId)
    ? resourceApplicationForm.acceptedTermIds.filter(item => item !== termId)
    : [...resourceApplicationForm.acceptedTermIds, termId]
}

function cancelCreate() {
  router.push('/dashboard/apply')
}

function onSaveDraft() {
  runSafely(async () => {
    sanitizeResourceDurations()
    sanitizeLlmItems()
    await submitResourceApplication(true)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '草稿已保存')
}

function onSubmitResourceApplication() {
  runSafely(async () => {
    sanitizeResourceDurations()
    sanitizeLlmItems()
    await submitResourceApplication(false)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '资源申请已提交，等待各审批组逐项审批')
}

onMounted(() => {
  resetResourceApplicationForm()
  resetApplicationSecurity()
  restoreLocalDraft(applicationDraftKey, resourceApplicationForm)
  sanitizeSelectedResourceTypes()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  persistLocalDraft(applicationDraftKey, resourceApplicationForm)
})
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            资源申请
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            先多选资源类型，再按类型填写材料，最后自动合并条款并提交。支持草稿、一单多资源、逐项审批和人工开通。
          </p>
        </div>
        <TxButton variant="ghost" @click="cancelCreate">
          返回列表
        </TxButton>
      </div>

      <TxSteps :active="activeStep" class="mt-6" size="small">
        <TxStep title="选择类型" description="可多选资源" />
        <TxStep title="填写材料" description="分组添加明细" />
        <TxStep title="确认条款" description="自动合并条款" />
      </TxSteps>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        请先登录后提交申请。
      </div>

      <div v-else class="mt-6 space-y-6">
        <template v-if="currentStep === 'types'">
          <DataNotice mode="compact" title="申请提交与免责确认" timing="before" />
          <div class="gap-2 grid md:grid-cols-3 xl:grid-cols-4">
            <button
              v-for="config in visibleResourceTypeConfigs"
              :key="config.resourceType"
              type="button"
              class="p-2.5 text-left border rounded-2xl transition relative overflow-hidden"
              :class="isSelectedResourceType(config.resourceType) ? 'border-emerald-400 bg-emerald-50 shadow-md shadow-emerald-500/10 dark:bg-emerald-500/10' : 'border-black/8 bg-white hover:border-slate-400 dark:border-white/10 dark:bg-[#151820]'"
              @click="toggleResourceType(config.resourceType)"
            >
              <div class="flex gap-2 items-center justify-between">
                <span class="text-lg" :class="config.icon" />
                <span class="text-[10px] text-slate-500 fw-800">{{ config.approverGroup }}</span>
              </div>
              <div class="text-sm fw-900 mt-2">
                {{ config.displayName }}
              </div>
              <p class="text-xs text-slate-500 leading-4 mt-1 dark:text-slate-400">
                {{ config.description }}
              </p>
            </button>
          </div>

          <div class="flex flex-wrap gap-3 items-center justify-end">
            <span class="text-sm text-slate-500 dark:text-slate-400">已选 {{ resourceApplicationForm.selectedResourceTypes.length }} 类资源</span>
            <TxButton variant="primary" size="lg" @click="nextToMaterials">
              下一步：填写材料
            </TxButton>
          </div>
        </template>

        <template v-else-if="currentStep === 'materials'">
          <div class="gap-5 grid md:grid-cols-2">
            <label class="gap-2 grid md:col-span-2">
              <span class="field-label">申请标题</span>
              <TxInput v-model="resourceApplicationForm.title" placeholder="例如：客服 Agent 数据库 + 大模型 + GPU 申请" />
            </label>
            <label class="gap-2 grid md:col-span-2">
              <span class="field-label">申请说明</span>
              <RichTextEditor
                v-model="resourceApplicationForm.reason"
                :min-height="280"
                placeholder="请说明申请原因、业务背景、影响范围、公益/研发目标。可粘贴百度网盘等外链；图片建议作为下方附件上传。"
              />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">紧急程度</span>
              <TxSelect v-model="resourceApplicationForm.urgency" panel-background="pure">
                <TxSelectItem v-for="item in urgencyOptions" :key="item.value" :value="item.value" :label="item.label" />
              </TxSelect>
            </label>
            <div class="gap-2 grid">
              <span class="field-label">期望生效时间</span>
              <div class="gap-2 grid grid-cols-[1fr_110px]">
                <TxInput :model-value="expectedDateValue" readonly placeholder="选择日期" @focus="openExpectedDatePicker" @click="openExpectedDatePicker" />
                <input v-model="expectedTimeValue" class="form-time-input" type="time">
              </div>
              <TxDatePicker v-model="expectedDateValue" v-model:visible="expectedDatePickerVisible" title="选择期望生效日期" confirm-text="确定" cancel-text="取消" />
            </div>
            <div class="gap-2 grid md:col-span-2">
              <span class="field-label">默认有效期</span>
              <div class="rate-default-card">
                {{ RESOURCE_DEFAULT_DURATION }}，每个资源明细可单独延长；延长会消耗大量积分。
              </div>
            </div>
          </div>

          <div class="space-y-5">
            <div v-for="group in groupedResourceItems" :key="group.config!.resourceType" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <h3 class="text-xl fw-900">
                    {{ group.config!.displayName }}
                  </h3>
                  <p class="field-hint mt-1">
                    审批组：{{ group.config!.approverGroup }}
                  </p>
                </div>
                <TxButton size="sm" variant="secondary" @click="addResourceApplicationItem(group.config!.resourceType)">
                  添加明细
                </TxButton>
              </div>

              <div class="mt-4 space-y-4">
                <div v-for="item in group.items" :key="item.id" class="p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
                  <div class="flex flex-wrap gap-3 items-center justify-between">
                    <b>资源明细</b>
                    <TxButton size="sm" variant="danger" @click="removeResourceApplicationItem(item.id)">
                      删除
                    </TxButton>
                  </div>

                  <div class="mt-4 gap-4 grid md:grid-cols-2">
                    <label v-if="item.resourceType !== 'llm_api_quota'" class="gap-2 grid">
                      <span class="field-label">子类型</span>
                      <TxSelect v-model="item.resourceSubtype" panel-background="pure">
                        <TxSelectItem v-for="subtype in group.config!.subtypes" :key="subtype" :value="subtype" :label="subtype" />
                      </TxSelect>
                    </label>

                    <template v-if="item.resourceType === 'database'">
                      <label class="gap-2 grid"><span class="field-label">实例/库名</span><TxInput v-model="item.payload.name" placeholder="orders_prod / cache_user" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">权限级别</span><TxSelect v-model="item.requestedPermission" panel-background="pure"><TxSelectItem v-for="option in databasePermissionOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <label class="option-check md:col-span-2"><TxCheckbox v-model="item.payload.sensitiveData" variant="checkmark" /><span><b>涉及敏感数据</b><small>生产库、用户信息或受限数据需勾选。</small></span></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">申请原因</span><RichTextEditor v-model="item.payload.reason" :min-height="120" placeholder="说明申请原因" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">操作范围说明</span><RichTextEditor v-model="item.payload.operationScope" :min-height="120" placeholder="读取哪些表、执行哪些操作、是否需要变更数据" /></label>
                    </template>

                    <template v-else-if="item.resourceType === 'llm_api_quota'">
                      <label class="gap-2 grid"><span class="field-label">大模型</span><TxSelect v-model="item.payload.model" panel-background="pure" @update:model-value="onLlmModelChange(item)"><TxSelectItem v-for="model in enabledLlmApiModels" :key="model.key" :value="model.key" :label="`${model.name} · 倍率 ×${LLM_API_MODEL_COST_MULTIPLIERS[model.key as keyof typeof LLM_API_MODEL_COST_MULTIPLIERS] ?? 1}`" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <div class="gap-2 grid">
                        <span class="field-label">默认 RPM / TPM</span><div class="rate-default-card">
                          默认 RPM {{ llmModelForItem(item)?.rpmLimit ?? '-' }} · 默认 TPM {{ llmModelForItem(item)?.tpmLimit ?? '-' }}
                        </div>
                      </div>
                      <label class="gap-2 grid"><span class="field-label">RPM</span><TxNumberInput v-model="item.payload.rpmLimit" :min="1" :max="1000" :step="1" :controls="false" /></label>
                      <label class="gap-2 grid"><span class="field-label">TPM</span><TxNumberInput v-model="item.payload.tpmLimit" :min="1" :max="10000000" :step="1000" :controls="false" /></label>
                      <div v-if="llmRateChangeCost(item)" class="rate-warning md:col-span-2">
                        <b>修改 RPM / TPM 会消耗大量积分：约 {{ llmRateChangeCost(item).toLocaleString('zh-CN') }} 积分</b><span>该消耗不享受任何折扣；请谨慎调整，费用很高很高。最终实际扣费以后端结算为准。</span>
                      </div>
                      <div class="gap-3 grid md:col-span-2">
                        <div class="flex flex-wrap gap-3 items-center justify-between">
                          <span class="field-label">Token 额度</span><b>{{ formatUsd(item.payload.budgetLimit) }}</b>
                        </div><TxSlider v-model="item.payload.budgetLimit" :min="10" :max="1000" :step="10" :show-value="false" :format-value="formatUsd" /><div class="quota-marks">
                          <span v-for="mark in llmBudgetMarks" :key="mark">{{ formatUsd(mark) }}</span>
                        </div><p v-if="item.payload.budgetLimit > 100" class="field-hint text-amber-600 dark:text-amber-300">
                          超过 $100 的额度申请需要更长时间审核
                        </p>
                      </div>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">使用场景</span><RichTextEditor v-model="item.payload.usageScenario" :min-height="140" placeholder="说明项目用途、调用场景、预估消耗和收益" /></label>
                    </template>

                    <template v-else>
                      <label class="gap-2 grid"><span class="field-label">规格</span><TxInput v-model="item.payload.specification" placeholder="规格、权限级别、容量或配额" /></label>
                      <label class="gap-2 grid"><span class="field-label">数量</span><TxNumberInput v-model="item.payload.quantity" :min="1" :step="1" :controls="false" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <label class="gap-2 grid"><span class="field-label">项目</span><TxInput v-model="item.payload.project" /></label>
                      <label class="gap-2 grid"><span class="field-label">成本归属</span><TxInput v-model="item.payload.costCenter" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">访问范围或用途说明</span><RichTextEditor v-model="item.payload.purpose" :min-height="120" placeholder="说明访问范围、用途和必要性" /></label>
                    </template>
                  </div>
                  <div class="resource-estimate-card mt-4">
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                      <b>本项预估资源</b>
                      <span>{{ formatPoints(itemEstimateParts(item).discounted) }}</span>
                    </div>
                    <div class="text-xs mt-2 gap-2 grid md:grid-cols-4">
                      <span>基础：{{ formatPoints(itemEstimateParts(item).base) }}</span>
                      <span v-if="itemEstimateParts(item).rate">RPM/TPM：{{ formatPoints(itemEstimateParts(item).rate) }}</span>
                      <span v-if="itemEstimateParts(item).duration">有效期延长：{{ formatPoints(itemEstimateParts(item).duration) }}</span>
                      <span v-if="itemEstimateParts(item).savings">{{ ACTIVITY_NAME }} 优惠：-{{ formatPoints(itemEstimateParts(item).savings) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="mb-2 flex gap-3 items-center justify-between">
              <span class="field-label">Markdown 附件 / 图片</span>
              <span class="field-hint">{{ formatBytes(totalApplicationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
            </div>
            <TxFileUploader v-model="applicationFiles" :max="20" button-text="上传附件" drop-text="图片和补充材料都拖拽到这里" hint-text="图片、Markdown 附件和补充材料都上传到这里；全部文件总大小不超过 200MB。也可在申请说明里填写百度网盘等外链。" />
            <p class="field-hint mt-2">
              支持把截图、说明文档、Markdown 文件等统一作为附件上传；如文件过大或已在网盘，可在上方 Markdown 说明中放链接。
            </p>
          </div>

          <div class="flex flex-wrap gap-3 justify-between">
            <TxButton variant="secondary" @click="onSaveDraft">
              保存草稿
            </TxButton>
            <div class="flex gap-3">
              <TxButton variant="ghost" @click="currentStep = 'types'">
                上一步
              </TxButton>
              <TxButton variant="primary" @click="nextToTerms">
                下一步：确认条款
              </TxButton>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <h3 class="text-xl fw-900">
              自动合并条款
            </h3>
            <p class="field-hint mt-1">
              系统根据本单资源类型合并通用、数据库、大模型和基础设施条款；提交时记录条款 ID、版本、同意人和时间。
            </p>
            <div class="mt-4 space-y-3">
              <label v-for="term in selectedResourceTerms" :key="term.id" class="option-check">
                <TxCheckbox :model-value="hasAcceptedTerm(term.id)" variant="checkmark" @change="toggleTerm(term.id)" />
                <span>
                  <b>{{ term.title }} · v{{ term.version }}</b>
                  <small>{{ term.content.join('；') }}</small>
                </span>
              </label>
            </div>
          </div>

          <div class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <h3 class="text-xl fw-900">
                  提交策略
                </h3>
                <p class="field-hint mt-1">
                  {{ resourceApplicationPolicyStatus.reason || '当前资源申请开放' }}
                </p>
              </div>
              <span class="text-xs fw-900 px-3 py-1 rounded-full" :class="resourceApplicationPolicyStatus.available && resourceApplicationPolicyStatus.descriptionOk ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/30'">
                {{ resourceApplicationPolicyStatus.descriptionLength }}/{{ resourceApplicationPolicyStatus.minDescriptionChars }} 字
              </span>
            </div>
            <div class="mt-4 gap-3 grid md:grid-cols-4">
              <div class="summary-stat light">
                <span>开放时间</span>
                <b>{{ resourceApplicationPolicyStatus.openWindowLabel }}</b>
              </div>
              <div class="summary-stat light">
                <span>今日剩余</span>
                <b>{{ resourceApplicationPolicyStatus.dailyRemaining ?? '不限' }}</b>
              </div>
              <div class="summary-stat light">
                <span>个人剩余</span>
                <b>{{ resourceApplicationPolicyStatus.perUserDailyRemaining ?? '不限' }}</b>
              </div>
              <div class="summary-stat light">
                <span>提交校验</span>
                <b>{{ [resourceApplicationPolicyStatus.powEnabled ? `PoW ${resourceApplicationPolicyStatus.powDifficulty}` : '', resourceApplicationPolicyStatus.turnstileEnabled ? 'Turnstile' : ''].filter(Boolean).join(' / ') || '基础校验' }}</b>
              </div>
            </div>
            <TurnstileChallenge
              v-if="resourceApplicationPolicyStatus.turnstileEnabled && resourceApplicationPolicyStatus.turnstileSiteKey"
              class="mt-4"
              :site-key="resourceApplicationPolicyStatus.turnstileSiteKey"
              @verified="setApplicationTurnstileToken"
              @expired="setApplicationTurnstileToken('')"
            />
            <p v-if="applicationSecurityForm.message" class="field-hint mt-3">
              {{ applicationSecurityForm.message }}
            </p>
          </div>

          <div class="text-white p-5 rounded-3xl bg-slate-950 dark:text-slate-950 dark:bg-white">
            <div class="text-sm op70">
              提交摘要
            </div>
            <div class="text-xl fw-900 mt-1">
              {{ resourceApplicationForm.title }} · {{ resourceApplicationItems.length }} 条资源明细
            </div>
            <div class="mt-4 gap-3 grid md:grid-cols-3">
              <div class="summary-stat">
                <span>累计预估积分消耗</span>
                <b>{{ formatPoints(totalUndiscountedEstimate) }}</b>
              </div>
              <div class="summary-stat">
                <span>{{ ACTIVITY_NAME }} 后价格</span>
                <b>{{ formatPoints(totalDiscountedEstimate) }}</b>
              </div>
              <div class="summary-stat">
                <span>限时优惠节省</span>
                <b>{{ formatPoints(totalDiscountSavings) }}</b>
              </div>
            </div>
            <div class="text-xs mt-3 op70">
              每项资源已单独展示预估；RPM/TPM 修改和有效期延长不享受折扣，费用很高。提交后申请内容锁定；审批人只能逐项通过、驳回或调整后通过。
            </div>
          </div>

          <div class="flex flex-wrap gap-3 justify-between">
            <TxButton variant="secondary" @click="onSaveDraft">
              保存草稿
            </TxButton>
            <div class="flex gap-3">
              <TxButton variant="ghost" @click="currentStep = 'materials'">
                上一步
              </TxButton>
              <TxButton variant="primary" :disabled="isResourceSubmissionBlocked" @click="onSubmitResourceApplication">
                提交资源申请
              </TxButton>
            </div>
          </div>
          <p class="field-hint text-right">
            当前待处理请求：{{ activeRequestCount }}/{{ MAX_ACTIVE_USER_REQUESTS }}
          </p>
        </template>
      </div>
    </TxCard>
  </section>
</template>
