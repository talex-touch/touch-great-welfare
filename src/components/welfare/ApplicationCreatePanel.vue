<script setup lang="ts">
import type { ResourceTermId, ResourceType } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxFileUploader, TxInput, TxNumberInput, TxSelect, TxSelectItem, TxStep, TxSteps } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { canApplyResourceType, formatBytes, MAX_ACTIVE_USER_REQUESTS, MAX_ATTACHMENT_BYTES } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import MarkdownEditor from './MarkdownEditor.vue'

const {
  currentUser,
  applicationFiles,
  resourceApplicationForm,
  resourceApplicationItems,
  resourceTypeConfigs,
  selectedResourceTerms,
  totalApplicationBytes,
  activeRequestCount,
  canCreateRequest,
  userLevelCard,
  submitResourceApplication,
  addResourceApplicationItem,
  removeResourceApplicationItem,
  ensureSelectedResourceItems,
  resetResourceApplicationForm,
  resetApplicationFiles,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const currentStep = ref<'types' | 'materials' | 'terms'>('types')
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
    await submitResourceApplication(true)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '草稿已保存')
}

function onSubmitResourceApplication() {
  runSafely(async () => {
    await submitResourceApplication(false)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '资源申请已提交，等待各审批组逐项审批')
}

onMounted(() => {
  resetResourceApplicationForm()
  restoreLocalDraft(applicationDraftKey, resourceApplicationForm)
  sanitizeSelectedResourceTypes()
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
              <MarkdownEditor
                v-model="resourceApplicationForm.reason"
                :min-height="280"
                placeholder="请用 Markdown 说明申请原因、业务背景、影响范围、公益/研发目标。可粘贴百度网盘等外链，例如：[补充材料](https://pan.baidu.com/...)；图片建议作为下方附件上传。"
              />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">紧急程度</span>
              <TxSelect v-model="resourceApplicationForm.urgency" panel-background="pure">
                <TxSelectItem v-for="item in urgencyOptions" :key="item.value" :value="item.value" :label="item.label" />
              </TxSelect>
            </label>
            <label class="gap-2 grid">
              <span class="field-label">期望生效时间</span>
              <TxInput v-model="resourceApplicationForm.expectedEffectiveAt" placeholder="例如：2026-06-10 10:00" />
            </label>
            <label class="gap-2 grid md:col-span-2">
              <span class="field-label">默认有效期</span>
              <TxInput v-model="resourceApplicationForm.duration" placeholder="例如：7 天 / 30 天 / 长期" />
            </label>
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
                    <label class="gap-2 grid">
                      <span class="field-label">子类型</span>
                      <TxSelect v-model="item.resourceSubtype" panel-background="pure">
                        <TxSelectItem v-for="subtype in group.config!.subtypes" :key="subtype" :value="subtype" :label="subtype" />
                      </TxSelect>
                    </label>

                    <template v-if="item.resourceType === 'database'">
                      <label class="gap-2 grid"><span class="field-label">实例/库名</span><TxInput v-model="item.payload.name" placeholder="orders_prod / cache_user" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">权限级别</span><TxSelect v-model="item.requestedPermission" panel-background="pure"><TxSelectItem v-for="option in databasePermissionOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxInput v-model="item.duration" /></label>
                      <label class="option-check md:col-span-2"><TxCheckbox v-model="item.payload.sensitiveData" variant="checkmark" /><span><b>涉及敏感数据</b><small>生产库、用户信息或受限数据需勾选。</small></span></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">申请原因</span><textarea v-model="item.payload.reason" class="form-textarea" rows="2" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">操作范围说明</span><textarea v-model="item.payload.operationScope" class="form-textarea" rows="2" placeholder="读取哪些表、执行哪些操作、是否需要变更数据" /></label>
                    </template>

                    <template v-else-if="item.resourceType === 'llm_api_quota'">
                      <label class="gap-2 grid"><span class="field-label">模型/模型族</span><TxInput v-model="item.payload.model" placeholder="gpt-4.1-mini / deepseek-chat" /></label>
                      <label class="gap-2 grid"><span class="field-label">月 Token 额度</span><TxNumberInput v-model="item.payload.monthlyTokens" :min="1" :step="100000" :controls="false" /></label>
                      <label class="gap-2 grid"><span class="field-label">RPM/TPM 或并发</span><TxInput v-model="item.payload.rateLimit" /></label>
                      <label class="gap-2 grid"><span class="field-label">预算上限</span><TxNumberInput v-model="item.payload.budgetLimit" :min="0" :step="10" :controls="false" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">使用场景</span><textarea v-model="item.payload.usageScenario" class="form-textarea" rows="2" /></label>
                      <label class="option-check"><TxCheckbox v-model="item.payload.uploadsUserData" variant="checkmark" /><span><b>上传用户数据</b><small>如需上传，应说明脱敏方式。</small></span></label>
                      <label class="option-check"><TxCheckbox v-model="item.payload.containsSensitiveInfo" variant="checkmark" /><span><b>包含隐私/代码/商业机密</b><small>勾选后审批会重点关注合规。</small></span></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">日志留存/脱敏要求</span><TxInput v-model="item.payload.logRetention" /></label>
                    </template>

                    <template v-else>
                      <label class="gap-2 grid"><span class="field-label">规格</span><TxInput v-model="item.payload.specification" placeholder="规格、权限级别、容量或配额" /></label>
                      <label class="gap-2 grid"><span class="field-label">数量</span><TxNumberInput v-model="item.payload.quantity" :min="1" :step="1" :controls="false" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxInput v-model="item.duration" /></label>
                      <label class="gap-2 grid"><span class="field-label">项目</span><TxInput v-model="item.payload.project" /></label>
                      <label class="gap-2 grid"><span class="field-label">成本归属</span><TxInput v-model="item.payload.costCenter" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">访问范围或用途说明</span><textarea v-model="item.payload.purpose" class="form-textarea" rows="2" /></label>
                    </template>
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

          <div class="text-white p-5 rounded-3xl bg-slate-950 dark:text-slate-950 dark:bg-white">
            <div class="text-sm op70">
              提交摘要
            </div>
            <div class="text-xl fw-900 mt-1">
              {{ resourceApplicationForm.title }} · {{ resourceApplicationItems.length }} 条资源明细
            </div>
            <div class="text-xs mt-2 op70">
              提交后申请内容锁定；审批人只能逐项通过、驳回或调整后通过。已通过资源会进入待人工开通。
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
              <TxButton variant="primary" :disabled="!canCreateRequest || resourceApplicationForm.acceptedTermIds.length !== selectedResourceTerms.length" @click="onSubmitResourceApplication">
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
