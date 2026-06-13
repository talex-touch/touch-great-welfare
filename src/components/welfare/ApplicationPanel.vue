<script setup lang="ts">
import type { ApplicationItem, RequestKind, ResourceType, WelfareApplication } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxDrawer, TxSearchInput, TxSelect, TxSelectItem, TxStatusBadge } from '@talex-touch/tuffex'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, formatPoints, resourceTypeLabel } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { resourceItemSummaryFields } from '~/composables/welfare/resource-display'
import { richTextToPlainText } from '~/utils/rich-text'
import ApplicationDetailPanel from './ApplicationDetailPanel.vue'
import ReviewQueues from './ReviewQueues.vue'

const {
  state,
  currentUser,
  currentUserApplications,
  pendingApplications,
  isAdmin,
  canCrowdReview,
  statusText,
  statusTone,
  typeIcon,
  userName,
  userEmail,
  userLevelCard,
  reloadWelfareState,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const activeSection = ref<'overview' | 'mine' | 'review'>('overview')
const mineSearch = ref('')
const mineStatus = ref('all')
const mineSort = ref('latest')
const mineOnlyUnfinished = ref(false)
const reviewSearch = ref('')
const reviewStatus = ref('all')
const reviewPriority = ref('all')
const reviewOnlyUnhandled = ref(false)
const mineExpanded = ref(false)
const reviewExpanded = ref(false)
const selectedApplicationId = ref<string | undefined>()
const isApplicationDrawerOpen = ref(false)
const reviewQueues = ref<ReviewQueuesExpose | null>(null)

interface ApplicationRow {
  item: WelfareApplication
  title: string
  description: string
  type: string
  typeIcon: string
  typeClass: string
  resourceItems: ResourceRowItem[]
  applicant: ApplicantRowInfo
  email: string
  date: string
  tags: Array<{ label: string, tone: string }>
}

interface ResourceRowItem {
  title: string
  fields: Array<{ label: string, value: string }>
}

interface ApplicantRowInfo {
  name: string
  email: string
  avatar?: string
  initial: string
  role: string
  level: string
  points: string
  bio: string
}

interface GrantedResourceCard {
  id: string
  applicationId: string
  title: string
  subtitle: string
  kind: 'api-key' | 'database' | 'machine' | 'network' | 'reply' | 'generic'
  icon: string
  tone: string
  status: string
  statusTone: 'success' | 'warning' | 'info'
  primaryLabel: string
  primaryValue: string
  fields: Array<{ label: string, value: string }>
  note?: string
  date?: string
}

interface ReviewQueuesExpose {
  openReviewApplication: (id: string, source?: HTMLElement | null) => void
}

const typeText: Record<RequestKind, string> = {
  code: 'LLMAPI',
  image: 'IMAGE',
  pro: 'PRO',
  resource: 'RESOURCE',
}

const finishedStatuses = ['answered', 'delivered', 'completed', 'closed', 'approved', 'partial_approved']
const pendingStatuses = ['pending_review', 'needs_supplement', 'processing', 'pending', 'submitted', 'in_review', 'draft']
const visibleReviewApplications = computed(() => {
  if (isAdmin.value)
    return pendingApplications.value

  if (!canCrowdReview.value)
    return []

  return pendingApplications.value
    .filter(item => item.type === 'pro' && item.userId !== currentUser.value?.id)
})

const answeredCount = computed(() => currentUserApplications.value
  .filter(item => finishedStatuses.includes(item.status))
  .length)
const highPriorityCount = computed(() => visibleReviewApplications.value
  .filter(item => userLevelCard(item.userId).priority >= 4)
  .length)
const stats = computed(() => [
  {
    label: '申请中',
    value: currentUserApplications.value.filter(item => pendingStatuses.includes(item.status)).length,
    icon: 'i-carbon-document-add',
    tone: 'blue',
  },
  {
    label: '已答复',
    value: answeredCount.value,
    icon: 'i-carbon-user-multiple',
    tone: 'green',
  },
  {
    label: '待审核',
    value: visibleReviewApplications.value.length,
    icon: 'i-carbon-time',
    tone: 'indigo',
  },
  {
    label: '高优先级',
    value: highPriorityCount.value,
    icon: 'i-carbon-fire',
    tone: 'red',
  },
])

const filteredMineApplications = computed(() => {
  const keyword = mineSearch.value.trim().toLowerCase()
  return currentUserApplications.value
    .filter(item => matchesKeyword(item, keyword, [userEmail(item.userId)]))
    .filter(item => mineStatus.value === 'all' || item.status === mineStatus.value)
    .filter(item => !mineOnlyUnfinished.value || !finishedStatuses.includes(item.status))
    .slice()
    .sort((left, right) => mineSort.value === 'oldest'
      ? left.createdAt.localeCompare(right.createdAt)
      : right.createdAt.localeCompare(left.createdAt))
})

const filteredReviewApplications = computed(() => {
  const keyword = reviewSearch.value.trim().toLowerCase()
  return visibleReviewApplications.value
    .filter(item => matchesKeyword(item, keyword, [userEmail(item.userId)]))
    .filter(item => reviewStatus.value === 'all' || item.status === reviewStatus.value)
    .filter(item => matchesPriority(item, reviewPriority.value))
    .filter(item => !reviewOnlyUnhandled.value || pendingStatuses.includes(item.status))
})

const visibleMineApplications = computed(() => mineExpanded.value ? filteredMineApplications.value : filteredMineApplications.value.slice(0, 5))
const visibleReviewApplicationsRows = computed(() => reviewExpanded.value ? filteredReviewApplications.value : filteredReviewApplications.value.slice(0, 5))
const visibleMineRows = computed(() => visibleMineApplications.value.map(toApplicationRow))
const visibleReviewRows = computed(() => visibleReviewApplicationsRows.value.map(toApplicationRow))
const grantedResourceCards = computed(() => currentUserApplications.value.flatMap(application => [
  ...resourceProvisionCards(application),
  ...applicationAllocationCards(application),
  ...applicationReplyCards(application),
  ...applicationMessageCards(application),
]).sort((left, right) => (right.date ?? '').localeCompare(left.date ?? '')))
const showReviewSection = computed(() => isAdmin.value || canCrowdReview.value)

watch(showReviewSection, (canShowReview) => {
  if (!canShowReview && activeSection.value === 'review')
    activeSection.value = 'overview'
})

function goCreateApplication() {
  router.push('/dashboard/apply/create')
}

function editApplicationDraft(id: string) {
  router.push(`/dashboard/apply/create?draft=${encodeURIComponent(id)}`)
}

function openApplicationDrawer(id: string) {
  selectedApplicationId.value = id
  isApplicationDrawerOpen.value = true
}

function openReviewApplicationDialog(id: string, event: MouseEvent) {
  reviewQueues.value?.openReviewApplication(id, event.currentTarget instanceof HTMLElement ? event.currentTarget : null)
}

function refreshReviewQueue() {
  runSafely(() => reloadWelfareState(), '待审核队列已刷新')
}

function closeApplicationDrawer() {
  isApplicationDrawerOpen.value = false
}

function setActiveSection(section: 'overview' | 'mine' | 'review') {
  activeSection.value = section
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function payloadText(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key]
  if (typeof value === 'string')
    return value.trim()
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return ''
}

function compactFields(fields: Array<{ label: string, value?: string }>) {
  return fields
    .filter((field): field is { label: string, value: string } => !!field.value)
    .slice(0, 5)
}

function grantedResourceKind(resourceType?: ResourceType, payload?: Record<string, unknown>): GrantedResourceCard['kind'] {
  const normalizedType = payloadText(payload, 'resourceType').toLowerCase()
  if (resourceType === 'llm_api_quota' || ['newapi', 'apikey', 'api_key', 'api-key', 'api key'].some(value => normalizedType.includes(value)))
    return 'api-key'
  if (resourceType === 'database' || ['database', 'db', 'postgres', 'postgresql', 'mysql', 'redis', 'mongodb'].some(value => normalizedType === value || normalizedType.includes(value)))
    return 'database'
  if ((resourceType && ['server', 'gpu', 'k8s_namespace'].includes(resourceType)) || ['server', 'machine', 'vm', 'gpu', 'k8s', 'namespace'].some(value => normalizedType === value || normalizedType.includes(value)))
    return 'machine'
  if ((resourceType && ['vpn', 'ip_allowlist'].includes(resourceType)) || ['vpn', 'ip_allowlist', 'ip-allowlist', 'allowlist', 'whitelist', 'network'].some(value => normalizedType === value || normalizedType.includes(value)))
    return 'network'
  return 'generic'
}

function grantedResourceMeta(kind: GrantedResourceCard['kind']) {
  const meta: Record<GrantedResourceCard['kind'], Pick<GrantedResourceCard, 'icon' | 'tone' | 'primaryLabel'>> = {
    'api-key': { icon: 'i-carbon-api-1', tone: 'violet', primaryLabel: '凭据 / Key' },
    'database': { icon: 'i-carbon-data-base', tone: 'cyan', primaryLabel: '数据库 / 实例' },
    'machine': { icon: 'i-carbon-server-rack', tone: 'emerald', primaryLabel: '机器 / 命名空间' },
    'network': { icon: 'i-carbon-network-4', tone: 'blue', primaryLabel: '网络 / IP' },
    'reply': { icon: 'i-carbon-chat', tone: 'amber', primaryLabel: '答复摘要' },
    'generic': { icon: 'i-carbon-cube', tone: 'slate', primaryLabel: '资源' },
  }
  return meta[kind]
}

function provisionPayload(item: ApplicationItem) {
  return isRecord(item.provisionPayload) ? item.provisionPayload : undefined
}

function resourceProvisionCards(application: WelfareApplication): GrantedResourceCard[] {
  return (application.resourceItems ?? [])
    .filter(item => item.provisionStatus === 'completed' && provisionPayload(item))
    .map((item) => {
      const payload = provisionPayload(item)
      const kind = grantedResourceKind(item.resourceType, payload)
      const meta = grantedResourceMeta(kind)
      const resourceName = payloadText(payload, 'resourceName') || `${resourceTypeLabel(item.resourceType)} · ${item.resourceSubtype}`
      const credential = payloadText(payload, 'credential')
      const accessUrl = payloadText(payload, 'accessUrl')
      return {
        id: `${application.id}-${item.id}`,
        applicationId: application.id,
        title: resourceName,
        subtitle: `${application.title} · ${resourceTypeLabel(item.resourceType)}`,
        kind,
        icon: meta.icon,
        tone: meta.tone,
        status: '已获得',
        statusTone: 'success',
        primaryLabel: meta.primaryLabel,
        primaryValue: credential || accessUrl || resourceName,
        fields: compactFields([
          { label: '访问地址', value: accessUrl },
          { label: '凭据', value: credential },
          { label: '资源规格', value: item.resourceSubtype },
          { label: '权限', value: item.requestedPermission || payloadText(payload, 'permission') },
          { label: '有效期', value: payloadText(payload, 'expiresAt') || item.expiresAt },
          { label: '项目', value: application.projectId },
        ]),
        note: payloadText(payload, 'note') || item.provisionNote,
        date: item.provisionCompletedAt || item.updatedAt,
      }
    })
}

function applicationAllocationCards(application: WelfareApplication): GrantedResourceCard[] {
  const payload = isRecord(application.allocationPayload) ? application.allocationPayload : undefined
  if (!payload)
    return []

  const kind = grantedResourceKind(application.type === 'code' ? 'llm_api_quota' : undefined, payload)
  const meta = grantedResourceMeta(kind)
  const credential = payloadText(payload, 'credential')
  const accessUrl = payloadText(payload, 'accessUrl')
  const resourceName = payloadText(payload, 'resourceName') || application.title
  return [{
    id: `${application.id}-allocation`,
    applicationId: application.id,
    title: resourceName,
    subtitle: application.type === 'code' ? 'LLMApi 自动发放' : application.title,
    kind,
    icon: meta.icon,
    tone: meta.tone,
    status: '已发放',
    statusTone: 'success',
    primaryLabel: meta.primaryLabel,
    primaryValue: credential || accessUrl || resourceName,
    fields: compactFields([
      { label: '访问地址', value: accessUrl },
      { label: '凭据', value: credential },
      { label: '资源类型', value: payloadText(payload, 'resourceType') },
      { label: '有效期', value: payloadText(payload, 'expiresAt') },
      { label: '模型', value: application.llmApiModelName },
    ]),
    note: payloadText(payload, 'note') || application.allocationNote,
    date: application.allocationCompletedAt || application.completedAt,
  }]
}

function applicationReplyCards(application: WelfareApplication): GrantedResourceCard[] {
  if (!application.answer || !finishedStatuses.includes(application.status))
    return []

  const meta = grantedResourceMeta('reply')
  return [{
    id: `${application.id}-answer`,
    applicationId: application.id,
    title: application.title,
    subtitle: `${typeLabel(application.type)} · ${statusText(application.status)}`,
    kind: 'reply',
    icon: meta.icon,
    tone: meta.tone,
    status: statusText(application.status),
    statusTone: 'info',
    primaryLabel: meta.primaryLabel,
    primaryValue: plainDescription(application.answer),
    fields: compactFields([
      { label: '类型', value: typeLabel(application.type) },
      { label: '消耗', value: formatPoints(application.cost) },
      { label: '完成时间', value: formatDate(application.completedAt || application.reviewedAt) },
    ]),
    date: application.completedAt || application.reviewedAt || application.createdAt,
  }]
}

function applicationMessageCards(application: WelfareApplication): GrantedResourceCard[] {
  const meta = grantedResourceMeta('reply')
  return (application.messages ?? [])
    .filter(message => message.type === 'result_submission')
    .map(message => ({
      id: `${application.id}-${message.id}`,
      applicationId: application.id,
      title: application.title,
      subtitle: `协作线程回复 · ${userName(message.userId)}`,
      kind: 'reply',
      icon: meta.icon,
      tone: meta.tone,
      status: '结果回复',
      statusTone: 'info',
      primaryLabel: meta.primaryLabel,
      primaryValue: plainDescription(message.content),
      fields: compactFields([
        { label: '回复人', value: userName(message.userId) },
        { label: '类型', value: typeLabel(application.type) },
        { label: '回复时间', value: formatDate(message.createdAt) },
      ]),
      date: message.createdAt,
    }))
}

function matchesKeyword(item: WelfareApplication, keyword: string, extraFields: string[] = []) {
  if (!keyword)
    return true

  return [
    item.title,
    plainDescription(item.description),
    item.type,
    statusText(item.status),
    ...extraFields,
  ].some(value => value.toLowerCase().includes(keyword))
}

function matchesPriority(item: WelfareApplication, value: string) {
  if (value === 'all')
    return true

  const priority = userLevelCard(item.userId).priority
  if (value === 'high')
    return priority >= 4
  if (value === 'medium')
    return priority === 3
  return priority <= 2
}

function plainDescription(content: string) {
  return richTextToPlainText(content).replace(/\s+/g, ' ').trim() || '暂无说明'
}

function typeLabel(type: RequestKind) {
  return typeText[type] ?? type.toUpperCase()
}

function resourceModelLabel(value?: string) {
  const model = String(value || '').trim()
  if (!model)
    return ''
  if (model.toLowerCase() === 'codex')
    return 'OpenAI Codex'
  if (model.toLowerCase() === 'claude-code')
    return 'Claude Code'
  return model
}

function resourceModelIcon(value?: string) {
  const model = String(value || '').toLowerCase()
  if (model.includes('claude'))
    return 'i-carbon-ai-status-complete'
  if (model.includes('codex') || model.includes('openai') || model.includes('gpt'))
    return 'i-carbon-ai-results-high'
  return 'i-carbon-cube'
}

function resourceModelClass(value?: string) {
  const model = String(value || '').toLowerCase()
  if (model.includes('claude'))
    return 'text-orange-700 bg-orange-50 ring-orange-200 dark:text-orange-200 dark:bg-orange-950/30 dark:ring-orange-400/20'
  if (model.includes('codex') || model.includes('openai') || model.includes('gpt'))
    return 'text-emerald-700 bg-emerald-50 ring-emerald-200 dark:text-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-400/20'
  return 'text-sky-700 bg-sky-50 ring-sky-200 dark:text-sky-200 dark:bg-sky-950/30 dark:ring-sky-400/20'
}

function primaryResourceItem(application: WelfareApplication) {
  return application.type === 'resource' ? application.resourceItems?.[0] : undefined
}

function resourceItemModel(item?: ApplicationItem) {
  return String(item?.resourceSubtype || item?.approvedPayload?.model || item?.payload?.model || '').trim()
}

function applicationRowTitle(item: WelfareApplication) {
  const resourceItem = primaryResourceItem(item)
  if (!resourceItem)
    return item.title
  const model = resourceItemModel(resourceItem)
  return model ? `${resourceTypeLabel(resourceItem.resourceType)} · ${model}` : resourceTypeLabel(resourceItem.resourceType)
}

function applicationRowDescription(item: WelfareApplication) {
  const resourceItem = primaryResourceItem(item)
  if (!resourceItem)
    return plainDescription(item.description)
  return [resourceItem.requestedQuota ? `申请额度 ${resourceItem.requestedQuota}` : '', resourceItem.duration ? `有效期 ${resourceItem.duration}` : '', resourceItem.approverGroup ? `审批组 ${resourceItem.approverGroup}` : '']
    .filter(Boolean)
    .join(' · ') || resourceFallbackText(item.resourceItems ?? [])
}

function applicationRowType(item: WelfareApplication) {
  const model = resourceItemModel(primaryResourceItem(item))
  return model ? resourceModelLabel(model) : typeLabel(item.type)
}

function applicationRowTypeIcon(item: WelfareApplication) {
  const model = resourceItemModel(primaryResourceItem(item))
  return model ? resourceModelIcon(model) : typeIcon(item.type)
}

function applicationRowTypeClass(item: WelfareApplication) {
  const model = resourceItemModel(primaryResourceItem(item))
  return model ? resourceModelClass(model) : 'text-sky-700 bg-sky-50 ring-sky-200 dark:text-sky-200 dark:bg-sky-950/30 dark:ring-sky-400/20'
}

function resourceRowItems(item: WelfareApplication): ResourceRowItem[] {
  return (item.resourceItems ?? []).map(resourceItem => ({
    title: `${resourceTypeLabel(resourceItem.resourceType)} · ${resourceItem.resourceSubtype}`,
    fields: resourceItemSummaryFields(resourceItem).slice(2, 7),
  }))
}

function resourceFallbackText(items: ApplicationItem[]) {
  if (!items.length)
    return '暂无资源明细'
  return items.map(item => `${resourceTypeLabel(item.resourceType)} · ${item.resourceSubtype}`).join('；')
}

function applicantRowInfo(userId: string): ApplicantRowInfo {
  const user = state.users.find(item => item.id === userId)
  const level = userLevelCard(userId)
  const name = user?.profile.displayName || userName(userId)
  const email = user?.profile.email || userEmail(userId)

  return {
    name,
    email,
    avatar: user?.profile.avatar,
    initial: name.trim().slice(0, 1).toUpperCase() || '用',
    role: user?.role === 'admin' ? '管理员' : user?.role === 'reviewer' ? '协作处理员' : '用户',
    level: level.name,
    points: formatPoints(user?.points ?? 0),
    bio: user?.profile.bio?.trim() || '暂无简介',
  }
}

function priorityLabel(item: WelfareApplication) {
  const priority = userLevelCard(item.userId).priority
  if (priority >= 4)
    return '高'
  if (priority === 3)
    return '中'
  return '低'
}

function priorityClass(item: WelfareApplication) {
  const priority = userLevelCard(item.userId).priority
  if (priority >= 4)
    return 'application-priority application-priority--high'
  if (priority === 3)
    return 'application-priority application-priority--medium'
  return 'application-priority application-priority--low'
}

function toApplicationRow(item: WelfareApplication): ApplicationRow {
  const resourceItems = item.type === 'resource' ? resourceRowItems(item) : []

  return {
    item,
    title: applicationRowTitle(item),
    description: applicationRowDescription(item),
    type: applicationRowType(item),
    typeIcon: applicationRowTypeIcon(item),
    typeClass: applicationRowTypeClass(item),
    resourceItems,
    applicant: applicantRowInfo(item.userId),
    email: userEmail(item.userId),
    date: formatDate(item.createdAt),
    tags: applicationRowTags(item),
  }
}

function applicationRowTags(item: WelfareApplication) {
  const tags: Array<{ label: string, tone: string }> = []
  if (item.pricingPromotionName)
    tags.push({ label: item.pricingPromotionName, tone: 'amber' })
  if (item.couponDiscountAmount)
    tags.push({ label: `优惠券 -${formatPoints(item.couponDiscountAmount)}`, tone: 'emerald' })
  if (item.squareDiscountAmount)
    tags.push({ label: `广场 -${formatPoints(item.squareDiscountAmount)}`, tone: 'blue' })
  if (item.rejectionReviewFeeWaived && item.rejectionFraudulent)
    tags.push({ label: '认真承诺但造假仍扣费', tone: 'rose' })
  else if (item.rejectionReviewFeeWaived)
    tags.push({ label: '认真填写承诺', tone: 'violet' })
  else if (item.type !== 'resource')
    tags.push({ label: `退回手续费 ${formatPoints(item.rejectionReviewFee)}`, tone: 'slate' })
  if (item.storageExtended)
    tags.push({ label: `存储 +${formatPoints(item.storageExtensionCost)}`, tone: 'teal' })
  if (item.expedited)
    tags.push({ label: `加速 +${formatPoints(item.expediteCost || 0)}`, tone: 'amber' })
  return tags
}
</script>

<template>
  <section class="application-dashboard space-y-6">
    <div v-if="currentUser" class="application-dashboard__hero">
      <div class="min-w-0">
        <div class="application-dashboard__tabs" :class="{ 'application-dashboard__tabs--three': showReviewSection }" role="tablist" aria-label="申请列表切换">
          <button
            type="button"
            :class="{ 'is-active': activeSection === 'overview' }"
            @click="setActiveSection('overview')"
          >
            资源总览
          </button>
          <button
            type="button"
            :class="{ 'is-active': activeSection === 'mine' }"
            @click="setActiveSection('mine')"
          >
            资源申请历史
          </button>
          <button
            v-if="showReviewSection"
            type="button"
            :class="{ 'is-active': activeSection === 'review' }"
            @click="setActiveSection('review')"
          >
            待审核队列
          </button>
        </div>
      </div>
      <div v-if="showReviewSection && activeSection === 'review'" class="application-dashboard__stats">
        <div v-for="item in stats" :key="item.label" class="application-stat-card">
          <div>
            <span>{{ item.label }}</span>
            <b :class="item.tone === 'red' ? 'text-red-600 dark:text-red-300' : ''">{{ item.value }}</b>
          </div>
          <i :class="[item.icon, `application-stat-card__icon application-stat-card__icon--${item.tone}`]" aria-hidden="true" />
        </div>
      </div>
    </div>

    <div v-if="!currentUser" class="p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
      请先登录后提交申请。
    </div>

    <template v-else>
      <TxCard v-show="activeSection === 'overview'" class="solid-panel application-list-panel" background="pure" shadow="soft" :padding="0" :radius="22">
        <div class="application-list-panel__header">
          <div class="application-section-title">
            <h3>资源总览</h3>
            <span>共 {{ grantedResourceCards.length }} 项</span>
          </div>
        </div>

        <div v-if="!grantedResourceCards.length" class="application-empty">
          暂无已获得资源。资源发放、API Key、机器/IP、数据库和申请答复会自动聚合到这里。
        </div>
        <div v-else class="resource-overview-grid">
          <button
            v-for="card in grantedResourceCards"
            :key="card.id"
            type="button"
            class="resource-overview-card"
            :class="[`resource-overview-card--${card.kind}`, `resource-overview-card--${card.tone}`]"
            @click="openApplicationDrawer(card.applicationId)"
          >
            <span class="resource-overview-card__topline">
              <span class="resource-overview-card__icon" :class="card.icon" aria-hidden="true" />
              <span class="resource-overview-card__status" :class="`resource-overview-card__status--${card.statusTone}`">{{ card.status }}</span>
            </span>
            <span class="resource-overview-card__body">
              <strong>{{ card.title }}</strong>
              <small>{{ card.subtitle }}</small>
            </span>
            <span class="resource-overview-card__primary">
              <em>{{ card.primaryLabel }}</em>
              <b>{{ card.primaryValue }}</b>
            </span>
            <span v-if="card.fields.length" class="resource-overview-card__fields">
              <span v-for="field in card.fields" :key="`${card.id}-${field.label}`">
                <em>{{ field.label }}</em>
                <b>{{ field.value }}</b>
              </span>
            </span>
            <span v-if="card.note" class="resource-overview-card__note">{{ card.note }}</span>
            <span class="resource-overview-card__footer">
              <span>{{ formatDate(card.date) }}</span>
              <span class="i-carbon-chevron-right" aria-hidden="true" />
            </span>
          </button>
        </div>
      </TxCard>

      <TxCard v-show="activeSection === 'mine'" class="solid-panel application-list-panel" background="pure" shadow="soft" :padding="0" :radius="22">
        <div class="application-list-panel__header">
          <div class="application-section-title">
            <h3>资源申请历史</h3>
            <span>共 {{ filteredMineApplications.length }} 条</span>
          </div>
          <div class="application-filter-bar">
            <TxSearchInput v-model="mineSearch" class="w-full max-lg:col-span-full" placeholder="搜索申请标题、资源或描述" clearable />
            <TxSelect v-model="mineStatus" aria-label="我的申请状态" panel-background="pure">
              <TxSelectItem value="all" label="全部状态" />
              <TxSelectItem value="pending_review" label="待审核" />
              <TxSelectItem value="draft" label="草稿" />
              <TxSelectItem value="in_review" label="资源审批中" />
              <TxSelectItem value="answered" label="已答复" />
              <TxSelectItem value="completed" label="已结束" />
              <TxSelectItem value="rejected" label="已退回" />
            </TxSelect>
            <TxSelect v-model="mineSort" aria-label="我的申请排序" panel-background="pure">
              <TxSelectItem value="latest" label="最新申请" />
              <TxSelectItem value="oldest" label="最早申请" />
            </TxSelect>
            <TxCheckbox v-model="mineOnlyUnfinished" variant="checkmark" label="仅看未完成" />
            <TxButton class="application-create-button" variant="primary" @click="goCreateApplication">
              <span class="i-carbon-add" />
              新建申请
            </TxButton>
          </div>
        </div>

        <div v-if="!filteredMineApplications.length" class="application-empty">
          暂无申请记录
        </div>
        <div v-else class="application-table">
          <div class="application-table__head application-table__row--mine">
            <span>申请内容</span>
            <span>类型</span>
            <span>状态</span>
            <span>资源 / 分值</span>
            <span>申请人</span>
            <span>申请时间</span>
            <span />
          </div>
          <button
            v-for="row in visibleMineRows"
            :key="row.item.id"
            type="button"
            class="application-table__row application-table__row--mine"
            @click="openApplicationDrawer(row.item.id)"
          >
            <span class="application-cell-title">
              <b>
                {{ row.title }}
              </b>
              <small>{{ row.description }}</small>
              <span v-if="row.tags.length" class="application-row-tags">
                <em v-for="tag in row.tags" :key="tag.label" :class="`application-row-tag application-row-tag--${tag.tone}`">{{ tag.label }}</em>
              </span>
            </span>
            <span class="px-3 py-1 rounded-full inline-flex gap-2 ring-1 items-center" :class="row.typeClass">
              <i :class="row.typeIcon" aria-hidden="true" />
              <strong class="application-type-tag">{{ row.type }}</strong>
            </span>
            <span>
              <TxStatusBadge :text="statusText(row.item.status)" :status="statusTone(row.item.status)" size="sm" />
            </span>
            <span>消耗 {{ formatPoints(row.item.cost) }}</span>
            <span class="application-table__truncate" :title="row.email">{{ row.email }}</span>
            <span class="application-table__truncate" :title="row.date">{{ row.date }}</span>
            <span>
              <TxButton
                v-if="row.item.status === 'draft' && row.item.type === 'resource'"
                size="sm"
                variant="secondary"
                @click.stop="editApplicationDraft(row.item.id)"
              >
                编辑草稿
              </TxButton>
              <i v-else class="application-row-arrow i-carbon-chevron-right" aria-hidden="true" />
            </span>
          </button>
          <button
            v-if="filteredMineApplications.length > 5"
            type="button"
            class="application-table__more"
            @click="mineExpanded = !mineExpanded"
          >
            {{ mineExpanded ? '收起申请' : '查看全部申请' }}
            <span :class="mineExpanded ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'" aria-hidden="true" />
          </button>
        </div>
      </TxCard>

      <TxCard v-if="showReviewSection" v-show="activeSection === 'review'" class="solid-panel application-list-panel" background="pure" shadow="soft" :padding="0" :radius="22">
        <div class="application-list-panel__header">
          <div class="application-section-title">
            <h3>待审核队列</h3>
            <span>共 {{ filteredReviewApplications.length }} 条</span>
          </div>
          <div class="application-filter-bar">
            <TxSearchInput v-model="reviewSearch" class="w-full max-lg:col-span-full" placeholder="搜索申请标题或申请人" clearable />
            <TxSelect v-model="reviewStatus" aria-label="审核队列状态" panel-background="pure">
              <TxSelectItem value="all" label="全部状态" />
              <TxSelectItem value="pending_review" label="待审核" />
              <TxSelectItem value="needs_supplement" label="待补充资料" />
              <TxSelectItem value="processing" label="处理中" />
              <TxSelectItem value="submitted" label="已提交" />
              <TxSelectItem value="in_review" label="资源审批中" />
            </TxSelect>
            <TxSelect v-model="reviewPriority" aria-label="审核优先级" panel-background="pure">
              <TxSelectItem value="all" label="优先级" />
              <TxSelectItem value="high" label="高" />
              <TxSelectItem value="medium" label="中" />
              <TxSelectItem value="low" label="低" />
            </TxSelect>
            <TxCheckbox v-model="reviewOnlyUnhandled" variant="checkmark" label="仅看未处理" />
            <TxButton class="application-refresh-button" variant="secondary" @click="refreshReviewQueue">
              <span class="i-carbon-renew" aria-hidden="true" />
              刷新
            </TxButton>
          </div>
        </div>

        <div v-if="!filteredReviewApplications.length" class="application-empty">
          暂无待审核申请
        </div>
        <div v-else class="application-table">
          <div class="application-table__head application-table__row--review">
            <span>申请内容</span>
            <span>类型</span>
            <span>状态</span>
            <span>优先级</span>
            <span>申请人</span>
            <span>申请时间</span>
            <span />
          </div>
          <button
            v-for="row in visibleReviewRows"
            :key="row.item.id"
            type="button"
            class="application-table__row application-table__row--review"
            @click="openReviewApplicationDialog(row.item.id, $event)"
          >
            <span class="application-cell-title">
              <b>{{ row.title }}</b>
              <small>{{ row.description }}</small>
              <span v-if="row.tags.length" class="application-row-tags">
                <em v-for="tag in row.tags" :key="tag.label" :class="`application-row-tag application-row-tag--${tag.tone}`">{{ tag.label }}</em>
              </span>
            </span>
            <span class="px-3 py-1 rounded-full inline-flex gap-2 ring-1 items-center" :class="row.typeClass">
              <i :class="row.typeIcon" aria-hidden="true" />
              <strong class="application-type-tag">{{ row.type }}</strong>
            </span>
            <span>
              <TxStatusBadge :text="statusText(row.item.status)" :status="statusTone(row.item.status)" size="sm" />
            </span>
            <span :class="priorityClass(row.item)">{{ priorityLabel(row.item) }}</span>
            <span class="application-applicant">
              <span class="application-applicant__avatar">
                <img v-if="row.applicant.avatar" :src="row.applicant.avatar" :alt="row.applicant.name">
                <span v-else>{{ row.applicant.initial }}</span>
              </span>
              <span class="application-applicant__name">{{ row.applicant.name }}</span>
              <span class="application-applicant__popover">
                <strong>{{ row.applicant.name }}</strong>
                <small>{{ row.applicant.email }}</small>
                <em>{{ row.applicant.role }} · {{ row.applicant.level }} · {{ row.applicant.points }} 积分</em>
                <span>{{ row.applicant.bio }}</span>
              </span>
            </span>
            <span class="application-table__truncate" :title="row.date">{{ row.date }}</span>
            <span class="application-row-arrow i-carbon-chevron-right" aria-hidden="true" />
          </button>
          <button
            v-if="filteredReviewApplications.length > 5"
            type="button"
            class="application-table__more"
            @click="reviewExpanded = !reviewExpanded"
          >
            {{ reviewExpanded ? '收起待审核' : '查看全部待审核' }}
            <span :class="reviewExpanded ? 'i-carbon-chevron-up' : 'i-carbon-chevron-down'" aria-hidden="true" />
          </button>
        </div>
      </TxCard>

      <ReviewQueues v-if="showReviewSection && activeSection === 'review'" ref="reviewQueues" kind="pro" mode="dialog-only" />
    </template>

    <TxDrawer
      v-if="selectedApplicationId"
      v-model:visible="isApplicationDrawerOpen"
      class="application-detail-drawer-host"
      direction="right"
      size="min(1120px, 96vw)"
      title="申请详情"
      :z-index="130"
      mask-effect="blur"
      @close="closeApplicationDrawer"
    >
      <ApplicationDetailPanel :application-id="selectedApplicationId" drawer @close="closeApplicationDrawer" />
    </TxDrawer>
  </section>
</template>
