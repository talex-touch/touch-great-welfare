<script setup lang="ts">
import type { RequestKind, WelfareApplication } from '~/composables/welfare'
import { TxButton, TxCard, TxStatusBadge } from '@talex-touch/tuffex'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatDate } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import { richTextToPlainText } from '~/utils/rich-text'
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

interface ApplicationRow {
  item: WelfareApplication
  description: string
  type: string
  email: string
  date: string
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

function goCreateApplication() {
  router.push('/dashboard/apply/create')
}

function goApplicationDetail(id: string) {
  router.push(`/dashboard/apply/${id}`)
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
  }
}
</script>

<template>
  <section class="application-dashboard space-y-6">
    <div class="application-dashboard__hero">
      <div class="min-w-0">
        <h2 class="application-dashboard__title">
          我的申请与审核
        </h2>
        <p class="application-dashboard__subtitle">
          查看和管理您的资源申请及审核任务，及时跟进处理进度。
        </p>
        <div class="application-dashboard__tabs" role="tablist" aria-label="申请列表切换">
          <button
            type="button"
            :class="{ 'is-active': activeSection === 'mine' }"
            @click="setActiveSection('mine')"
          >
            我的申请
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
      <div class="application-dashboard__stats">
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
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <TxStatusBadge :text="`余额 ${currentUser.points}`" status="info" />
        <TxButton variant="primary" @click="goCreateApplication">
          <span class="i-carbon-add" />
          新的申请
        </TxButton>
      </div>

      <TxCard v-show="activeSection === 'mine'" class="solid-panel application-list-panel" background="pure" shadow="soft" :padding="0" :radius="22">
        <div class="application-list-panel__header">
          <div class="application-section-title">
            <h3>我的申请</h3>
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
            @click="goApplicationDetail(row.item.id)"
          >
            <span class="application-cell-title">
              <b>
                {{ row.item.title }}
                <em v-if="row.item.storageExtended">置顶</em>
              </b>
              <small>{{ row.description }}</small>
            </span>
            <span>
              <i :class="typeIcon(row.item.type)" aria-hidden="true" />
              <strong class="application-type-tag">{{ row.type }}</strong>
            </span>
            <span>
              <TxStatusBadge :text="statusText(row.item.status)" :status="statusTone(row.item.status)" size="sm" />
            </span>
            <span>消耗 {{ row.item.cost }} 积分</span>
            <span>{{ row.email }}</span>
            <span>{{ row.date }}</span>
            <span class="application-row-arrow i-carbon-chevron-right" aria-hidden="true" />
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
            @click="goApplicationDetail(row.item.id)"
          >
            <span class="application-cell-title">
              <b>{{ row.item.title }}</b>
              <small>{{ row.description }}</small>
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
  </section>
</template>
