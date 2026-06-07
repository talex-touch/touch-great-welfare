<script setup lang="ts">
import type { RequestKind, WelfareApplication } from '~/composables/welfare'
import { TxButton, TxCard, TxFlipOverlay, TxStatusBadge } from '@talex-touch/tuffex'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatDate, formatPoints } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { richTextToPlainText } from '~/utils/rich-text'
import ApplicationDetailPanel from './ApplicationDetailPanel.vue'
import ReviewQueues from './ReviewQueues.vue'

const {
  currentUser,
  currentUserApplications,
  pendingApplications,
  isAdmin,
  canCrowdReview,
  statusText,
  statusTone,
  typeIcon,
  userEmail,
  userLevelCard,
} = useWelfareUiState()

const router = useRouter()
const activeSection = ref<'mine' | 'review'>('mine')
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
const isApplicationDialogOpen = ref(false)
const applicationDialogSource = ref<HTMLElement | null>(null)

interface ApplicationRow {
  item: WelfareApplication
  description: string
  type: string
  email: string
  date: string
  tags: Array<{ label: string, tone: string }>
}

const typeText: Record<RequestKind, string> = {
  code: 'LLMAPI',
  image: 'IMAGE',
  pro: 'PRO',
  resource: 'RESOURCE',
}

const finishedStatuses = ['answered', 'completed', 'closed', 'approved', 'partial_approved']
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
const showReviewSection = computed(() => isAdmin.value || canCrowdReview.value)

watch(showReviewSection, (canShowReview) => {
  if (!canShowReview && activeSection.value === 'review')
    activeSection.value = 'mine'
})

function goCreateApplication() {
  router.push('/dashboard/apply/create')
}

function editApplicationDraft(id: string) {
  router.push(`/dashboard/apply/create?draft=${encodeURIComponent(id)}`)
}

function openApplicationDialog(id: string, event: MouseEvent) {
  selectedApplicationId.value = id
  applicationDialogSource.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  isApplicationDialogOpen.value = true
}

function closeApplicationDialog() {
  isApplicationDialogOpen.value = false
}

function handleApplicationDialogClosed() {
  selectedApplicationId.value = undefined
  applicationDialogSource.value = null
}

function setActiveSection(section: 'mine' | 'review') {
  activeSection.value = section
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
  return {
    item,
    description: plainDescription(item.description),
    type: typeLabel(item.type),
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
    <div v-if="showReviewSection" class="application-dashboard__hero">
      <div class="min-w-0">
        <div class="application-dashboard__tabs" role="tablist" aria-label="申请列表切换">
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
      <TxCard v-show="activeSection === 'mine'" class="solid-panel application-list-panel" background="pure" shadow="soft" :padding="0" :radius="22">
        <div class="application-list-panel__header">
          <div class="application-section-title">
            <h3>资源申请历史</h3>
            <span>共 {{ filteredMineApplications.length }} 条</span>
          </div>
          <div class="application-filter-bar">
            <label class="application-search">
              <span class="i-carbon-search" aria-hidden="true" />
              <input v-model="mineSearch" type="search" placeholder="搜索申请标题、资源或描述">
            </label>
            <select v-model="mineStatus" class="application-select" aria-label="我的申请状态">
              <option value="all">
                全部状态
              </option>
              <option value="pending_review">
                待审核
              </option>
              <option value="draft">
                草稿
              </option>
              <option value="in_review">
                资源审批中
              </option>
              <option value="answered">
                已答复
              </option>
              <option value="completed">
                已结束
              </option>
              <option value="rejected">
                已退回
              </option>
            </select>
            <select v-model="mineSort" class="application-select" aria-label="我的申请排序">
              <option value="latest">
                最新申请
              </option>
              <option value="oldest">
                最早申请
              </option>
            </select>
            <label class="application-checkbox">
              <input v-model="mineOnlyUnfinished" type="checkbox">
              <span>仅看未完成</span>
            </label>
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
            @click="openApplicationDialog(row.item.id, $event)"
          >
            <span class="application-cell-title">
              <b>
                {{ row.item.title }}
              </b>
              <small>{{ row.description }}</small>
              <span v-if="row.tags.length" class="application-row-tags">
                <em v-for="tag in row.tags" :key="tag.label" :class="`application-row-tag application-row-tag--${tag.tone}`">{{ tag.label }}</em>
              </span>
            </span>
            <span>
              <i :class="typeIcon(row.item.type)" aria-hidden="true" />
              <strong class="application-type-tag">{{ row.type }}</strong>
            </span>
            <span>
              <TxStatusBadge :text="statusText(row.item.status)" :status="statusTone(row.item.status)" size="sm" />
            </span>
            <span>消耗 {{ formatPoints(row.item.cost) }}</span>
            <span>{{ row.email }}</span>
            <span>{{ row.date }}</span>
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
            <label class="application-search">
              <span class="i-carbon-search" aria-hidden="true" />
              <input v-model="reviewSearch" type="search" placeholder="搜索申请标题或申请人">
            </label>
            <select v-model="reviewStatus" class="application-select" aria-label="审核队列状态">
              <option value="all">
                全部状态
              </option>
              <option value="pending_review">
                待审核
              </option>
              <option value="needs_supplement">
                待补充材料
              </option>
              <option value="processing">
                处理中
              </option>
              <option value="submitted">
                已提交
              </option>
              <option value="in_review">
                资源审批中
              </option>
            </select>
            <select v-model="reviewPriority" class="application-select" aria-label="审核优先级">
              <option value="all">
                优先级
              </option>
              <option value="high">
                高
              </option>
              <option value="medium">
                中
              </option>
              <option value="low">
                低
              </option>
            </select>
            <label class="application-checkbox">
              <input v-model="reviewOnlyUnhandled" type="checkbox">
              <span>仅看未处理</span>
            </label>
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
            @click="openApplicationDialog(row.item.id, $event)"
          >
            <span class="application-cell-title">
              <b>{{ row.item.title }}</b>
              <small>{{ row.description }}</small>
              <span v-if="row.tags.length" class="application-row-tags">
                <em v-for="tag in row.tags" :key="tag.label" :class="`application-row-tag application-row-tag--${tag.tone}`">{{ tag.label }}</em>
              </span>
            </span>
            <span>
              <i :class="typeIcon(row.item.type)" aria-hidden="true" />
              <strong class="application-type-tag">{{ row.type }}</strong>
            </span>
            <span>
              <TxStatusBadge :text="statusText(row.item.status)" :status="statusTone(row.item.status)" size="sm" />
            </span>
            <span :class="priorityClass(row.item)">{{ priorityLabel(row.item) }}</span>
            <span>{{ row.email }}</span>
            <span>{{ row.date }}</span>
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

      <ReviewQueues v-if="showReviewSection && activeSection === 'review'" kind="pro" />
    </template>

    <Teleport to="body">
      <TxFlipOverlay
        v-if="selectedApplicationId"
        v-model="isApplicationDialogOpen"
        :source="applicationDialogSource"
        :header="false"
        :mask-closable="true"
        :scrollable="true"
        mask-class="application-detail-flip-mask"
        card-class="application-detail-flip-dialog"
        close-aria-label="关闭申请详情"
        surface="pure"
        @closed="handleApplicationDialogClosed"
      >
        <ApplicationDetailPanel :application-id="selectedApplicationId" drawer @close="closeApplicationDialog" />
      </TxFlipOverlay>
    </Teleport>
  </section>
</template>
