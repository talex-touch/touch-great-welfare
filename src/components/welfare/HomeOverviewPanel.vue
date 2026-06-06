<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareStore } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const welfare = useWelfareStore()
const router = useRouter()

const {
  currentUser,
  currentUserApplications,
  currentUserLevelCard,
  pendingCount,
} = useWelfareUiState()

const handledApplications = computed(() => welfare.state.applications.filter(item => ['answered', 'completed', 'approved', 'partial_approved', 'closed'].includes(item.status)).length)
const totalTokenBudget = computed(() => welfare.state.applications
  .filter(item => item.type === 'code')
  .reduce((sum, item) => sum + ((item.llmApiBudgetUsd ?? 0) * 1000), 0))
const squarePostCount = computed(() => welfare.state.squarePosts.length)
const totalUsers = computed(() => welfare.state.users.length)
const mySpentPoints = computed(() => welfare.state.transactions
  .filter(item => item.userId === currentUser.value?.id && item.delta < 0)
  .reduce((sum, item) => sum + Math.abs(item.delta), 0))
const latestApplication = computed(() => currentUserApplications.value[0])
const currentLevel = computed(() => currentUserLevelCard.value)

const headlineStats = computed(() => [
  {
    label: '已处理申请',
    value: handledApplications.value,
    suffix: '个',
    hint: '已进入答复、完成或审批结束状态',
  },
  {
    label: '已消耗 tokens',
    value: totalTokenBudget.value,
    suffix: '',
    hint: '按现有 LLMApi 预算折算展示',
  },
  {
    label: '广场帖子',
    value: squarePostCount.value,
    suffix: '条',
    hint: '当前公开复用与评价内容',
  },
  {
    label: '平台用户',
    value: totalUsers.value,
    suffix: '人',
    hint: '已进入平台的账号总数',
  },
])

function goApply() {
  router.push('/dashboard/apply')
}

function goSquare() {
  router.push('/dashboard/square')
}

function goProfile() {
  router.push('/dashboard/profile')
}

function formatDate(value?: string) {
  if (!value)
    return '暂无'

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return '暂无'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel overflow-hidden" background="pure" shadow="soft" :padding="28" :radius="30">
      <div class="dashboard-home-hero gap-8 grid lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] lg:items-end">
        <div class="space-y-6">
          <div class="flex flex-wrap gap-3 items-center">
            <TxStatusBadge text="首页工作台" status="info" />
            <TxTag
              v-if="currentLevel"
              :label="currentLevel.name"
              color="#0f766e"
              background="rgba(45,212,191,.16)"
            />
            <TxTag
              v-if="pendingCount"
              :label="`待处理 ${pendingCount}`"
              color="#b45309"
              background="rgba(245,158,11,.18)"
            />
          </div>

          <div class="space-y-3">
            <h1 class="text-4xl fw-900 leading-tight tracking-tight md:text-5xl">
              主页直接看数据，
              <br>
              申请、广场、个人入口都在上面。
            </h1>
            <p class="text-base text-slate-500 leading-7 max-w-2xl dark:text-slate-400">
              把首屏压缩成一个简洁工作台，先看平台处理量、额度消耗和你自己的申请状态，再决定下一步操作。
            </p>
          </div>

          <div class="flex flex-wrap gap-3 items-center">
            <TxButton variant="primary" @click="goApply">
              <span class="i-carbon-document-attachment" />
              我的申请
            </TxButton>
            <TxButton variant="secondary" @click="goSquare">
              <span class="i-carbon-campsite" />
              去广场
            </TxButton>
            <TxButton variant="ghost" @click="goProfile">
              <span class="i-carbon-user-avatar" />
              个人信息
            </TxButton>
          </div>
        </div>

        <div class="dashboard-home-spotlight p-5 rounded-[28px] space-y-4">
          <div class="text-xs text-slate-500 fw-800 tracking-[0.2em] uppercase dark:text-slate-400">
            我的概览
          </div>
          <div class="gap-4 grid lg:grid-cols-1 sm:grid-cols-2">
            <div class="space-y-1">
              <div class="text-sm text-slate-500 dark:text-slate-400">
                当前余额
              </div>
              <div class="text-3xl fw-900 tracking-tight">
                <NumberFlow :value="currentUser?.points ?? 0" :format="{ useGrouping: true }" />
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-sm text-slate-500 dark:text-slate-400">
                累计消耗积分
              </div>
              <div class="text-3xl fw-900 tracking-tight">
                <NumberFlow :value="mySpentPoints" :format="{ useGrouping: true }" />
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-sm text-slate-500 dark:text-slate-400">
                我的申请数
              </div>
              <div class="text-3xl fw-900 tracking-tight">
                <NumberFlow :value="currentUserApplications.length" />
              </div>
            </div>
            <div class="space-y-1">
              <div class="text-sm text-slate-500 dark:text-slate-400">
                最新申请时间
              </div>
              <div class="text-lg fw-800">
                {{ formatDate(latestApplication?.createdAt) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TxCard>

    <div class="gap-4 grid md:grid-cols-2 xl:grid-cols-4">
      <TxCard
        v-for="item in headlineStats"
        :key="item.label"
        class="solid-panel"
        background="pure"
        shadow="soft"
        :padding="22"
        :radius="26"
      >
        <div class="space-y-3">
          <div class="text-sm text-slate-500 dark:text-slate-400">
            {{ item.label }}
          </div>
          <div class="text-4xl fw-900 tracking-tight">
            <NumberFlow :value="item.value" :format="{ useGrouping: true }" />
            <span v-if="item.suffix" class="text-base text-slate-400 ml-2">{{ item.suffix }}</span>
          </div>
          <p class="text-xs text-slate-400 leading-5 dark:text-slate-500">
            {{ item.hint }}
          </p>
        </div>
      </TxCard>
    </div>

    <div class="gap-4 grid lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div>
            <h2 class="text-2xl fw-900 tracking-tight">
              最近申请
            </h2>
            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
              首屏只保留最近一条，避免主页继续堆成列表页。
            </p>
          </div>
          <TxButton variant="ghost" @click="goApply">
            查看全部
          </TxButton>
        </div>

        <div v-if="latestApplication" class="mt-6 p-5 border border-black/8 rounded-[24px] bg-slate-50/80 space-y-3 dark:border-white/10 dark:bg-white/4">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="text-[11px] text-slate-600 fw-900 leading-5 px-2 rounded-md bg-white uppercase dark:text-slate-300 dark:bg-white/8">
              {{ latestApplication.type }}
            </span>
            <TxStatusBadge :text="latestApplication.status" status="warning" size="sm" />
          </div>
          <div class="text-xl fw-900 tracking-tight">
            {{ latestApplication.title }}
          </div>
          <div class="text-sm text-slate-500 leading-6 dark:text-slate-400">
            创建于 {{ formatDate(latestApplication.createdAt) }}，预扣 {{ latestApplication.cost }} 积分。
          </div>
        </div>
        <div v-else class="text-sm text-slate-500 mt-6 p-8 text-center border border-black/8 rounded-[24px] border-dashed dark:text-slate-400 dark:border-white/10">
          还没有申请记录，直接从“我的申请”开始即可。
        </div>
      </TxCard>

      <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
        <div class="space-y-4">
          <div>
            <h2 class="text-2xl fw-900 tracking-tight">
              现在适合做什么
            </h2>
            <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
              只保留三个高频动作，避免首页继续变成导航墙。
            </p>
          </div>

          <button class="home-action-row" type="button" @click="goApply">
            <span class="i-carbon-document-attachment text-lg" />
            <span class="text-left flex-1">
              <b class="text-sm fw-800 block">去申请</b>
              <small>提交新申请，查看审核流转</small>
            </span>
            <span class="i-carbon-chevron-right text-slate-400" />
          </button>

          <button class="home-action-row" type="button" @click="goSquare">
            <span class="i-carbon-campsite text-lg" />
            <span class="text-left flex-1">
              <b class="text-sm fw-800 block">看广场</b>
              <small>复用模板，查看公开评价与助力</small>
            </span>
            <span class="i-carbon-chevron-right text-slate-400" />
          </button>

          <button class="home-action-row" type="button" @click="goProfile">
            <span class="i-carbon-user-avatar text-lg" />
            <span class="text-left flex-1">
              <b class="text-sm fw-800 block">维护个人信息</b>
              <small>更新资料、绑定仓库、补充简介</small>
            </span>
            <span class="i-carbon-chevron-right text-slate-400" />
          </button>
        </div>
      </TxCard>
    </div>
  </section>
</template>

<style scoped>
.dashboard-home-hero {
  position: relative;
}

.dashboard-home-spotlight {
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.2), transparent 40%),
    linear-gradient(180deg, rgba(248, 250, 252, 0.95), rgba(241, 245, 249, 0.88));
  border: 1px solid rgba(15, 23, 42, 0.06);
}

.dark .dashboard-home-spotlight {
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.12), transparent 40%),
    linear-gradient(180deg, rgba(19, 23, 31, 0.96), rgba(15, 18, 24, 0.9));
  border-color: rgba(255, 255, 255, 0.08);
}

.home-action-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.125rem;
  border-radius: 1.25rem;
  background: rgba(248, 250, 252, 0.86);
  transition:
    background-color 0.18s ease,
    transform 0.18s ease;
}

.home-action-row:hover {
  background: rgba(241, 245, 249, 1);
  transform: translateX(2px);
}

.home-action-row small {
  display: block;
  margin-top: 0.2rem;
  color: rgb(100 116 139);
}

.dark .home-action-row {
  background: rgba(255, 255, 255, 0.04);
}

.dark .home-action-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.dark .home-action-row small {
  color: rgb(148 163 184);
}
</style>
