<script setup lang="ts">
import type { SquarePost } from '~/composables/welfare'
import { TxButton, TxCard, TxInput, TxSelect, TxSelectItem, TxStatusBadge } from '@talex-touch/tuffex'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { formatDate, formatPoints, SQUARE_BOOST_DISCOUNT_STEP, SQUARE_BOOST_REPORT_COOLDOWN_DAYS, SQUARE_BOOST_REPORT_PENALTY_POINTS, SQUARE_BOOST_REWARD_POINTS, SQUARE_BOOSTS_PER_DISCOUNT_STEP, SQUARE_DAILY_BOOST_LIMIT, SQUARE_MIN_DISCOUNT_RATE, SQUARE_SHARE_DISCOUNT_RATE } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const router = useRouter()
const { runSafely } = useWelfareFeedback()

const {
  state,
  currentUser,
  currentUserApplications,
  resourceApplicationForm,
  resourceApplicationItems,
  squarePosts,
  squarePostForm,
  squareBoostDrafts,
  squareReportDrafts,
  userName,
  typeIcon,
  squarePostBoosts,
  squarePostValidBoosts,
  squarePostDiscountRate,
  isSquarePostAfterApproval,
  createSquarePost,
  boostSquarePost,
  reportSquareBoost,
} = useWelfareUiState()

const squarePostDraftKey = 'welfare:square-post-draft'
const isSquarePostDialogOpen = ref(false)
const activeBoostPostId = ref('')
let stopPersistSquareDraft: (() => void) | undefined
const squareBoostHelpText = `助力需要发布至少 20 字宣言；成功后获得 ${SQUARE_BOOST_REWARD_POINTS} 积分。每人每天最多 ${SQUARE_DAILY_BOOST_LIMIT} 次助力机会。被举报后扣除 ${SQUARE_BOOST_REPORT_PENALTY_POINTS} 积分，并且 ${SQUARE_BOOST_REPORT_COOLDOWN_DAYS} 天不可继续参与拼一刀。`

const shareableApplications = computed(() => currentUserApplications.value.filter(item => item.status !== 'draft'))
const isSquarePostLinkedToApplication = computed(() => !!squarePostForm.applicationId)
const activeBoostPost = computed(() => squarePosts.value.find(post => post.id === activeBoostPostId.value))
const publishButtonText = computed(() => {
  if (isSquarePostLinkedToApplication.value)
    return '分享领域拼一刀'
  return squarePostForm.postType === 'application_template' ? '发布模板帖' : '发布评价帖'
})

onMounted(() => {
  restoreLocalDraft(squarePostDraftKey, squarePostForm)
  stopPersistSquareDraft = persistLocalDraft(squarePostDraftKey, squarePostForm)
})

onUnmounted(() => {
  stopPersistSquareDraft?.()
})

function openSquarePostDialog() {
  isSquarePostDialogOpen.value = true
}

function closeSquarePostDialog() {
  isSquarePostDialogOpen.value = false
}

function openBoostDialog(post: SquarePost) {
  activeBoostPostId.value = post.id
}

function closeBoostDialog() {
  activeBoostPostId.value = ''
}

function discountText(rate: number) {
  return `${Number(rate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function boostCount(postId: string) {
  return squarePostValidBoosts(postId).length
}

function boostProgress(postId: string) {
  const maxDiscountSteps = Math.round((SQUARE_SHARE_DISCOUNT_RATE - SQUARE_MIN_DISCOUNT_RATE) / SQUARE_BOOST_DISCOUNT_STEP)
  const maxBoostCount = Math.max(1, maxDiscountSteps * SQUARE_BOOSTS_PER_DISCOUNT_STEP)
  return Math.min(100, Math.round((boostCount(postId) / maxBoostCount) * 100))
}

function boostSupporters(postId: string) {
  return squarePostValidBoosts(postId).slice(0, 8)
}

function userInitial(userId: string) {
  return userName(userId).slice(0, 1).toUpperCase()
}

function postApplication(post: SquarePost) {
  return post.applicationId ? state.applications.find(item => item.id === post.applicationId) : undefined
}

function isLinkedSquarePost(post: SquarePost) {
  return !!post.applicationId
}

function postStateText(post: SquarePost) {
  if (!isLinkedSquarePost(post))
    return post.type === 'application_template' ? '模板帖' : '评价帖'

  return isSquarePostAfterApproval(post.id) ? '已结束' : '拼一刀助力'
}

function postStateHint(post: SquarePost) {
  if (!isLinkedSquarePost(post))
    return post.type === 'application_template' ? '独立模板帖，用于分享可复用的申请思路或材料结构。' : '独立评价帖，用于记录申请体验、补充建议或公开反馈。'

  return isSquarePostAfterApproval(post.id)
    ? '关联申请已通过，帖子继续开放留言和投票；此时不再发放助力奖励，也不会因为举报产生扣分或冷却处罚。'
    : `助力需要发布至少 20 字宣言；助力成功获得 ${SQUARE_BOOST_REWARD_POINTS} 积分。`
}

function shouldShowPostStateBadge(post: SquarePost) {
  return !isLinkedSquarePost(post) || isSquarePostAfterApproval(post.id)
}

function boostActionText(post: SquarePost) {
  return isSquarePostAfterApproval(post.id) ? '投票' : `助力 +${SQUARE_BOOST_REWARD_POINTS}`
}

function canUseTemplate(post: SquarePost) {
  return !isLinkedSquarePost(post) && post.type === 'application_template' && post.requestType === 'resource' && !!post.template
}

function publishPost() {
  runSafely(async () => {
    await createSquarePost()
    clearLocalDraft(squarePostDraftKey)
    closeSquarePostDialog()
  }, '已发布到广场')
}

function boost(postId: string) {
  runSafely(async () => {
    await boostSquarePost(postId)
    closeBoostDialog()
  }, isSquarePostAfterApproval(postId) ? '投票成功，已记录为结束后助力投票' : `助力成功，已获得 ${SQUARE_BOOST_REWARD_POINTS} 积分`)
}

function report(boostId: string) {
  runSafely(async () => {
    await reportSquareBoost(boostId)
  }, '举报已提交，违规助力已处理')
}

function useTemplate(post: SquarePost) {
  if (post.requestType !== 'resource' || !post.template)
    return

  resourceApplicationForm.title = post.template.title || '资源申请'
  resourceApplicationForm.reason = post.template.reason || post.template.description || post.content
  resourceApplicationForm.businessBackground = post.template.businessBackground || post.template.reason || ''
  resourceApplicationForm.urgency = post.template.urgency || 'normal'
  resourceApplicationForm.expectedEffectiveAt = post.template.expectedEffectiveAt || ''
  resourceApplicationForm.costCenter = post.template.costCenter || ''
  resourceApplicationForm.ownerId = currentUser.value?.id ?? ''
  resourceApplicationForm.duration = post.template.duration || resourceApplicationForm.duration
  resourceApplicationForm.selectedResourceTypes = post.template.selectedResourceTypes?.length ? [...post.template.selectedResourceTypes] : ['database']
  resourceApplicationForm.acceptedTermIds = []
  resourceApplicationForm.selectedCouponId = ''
  resourceApplicationForm.shareToSquare = false
  resourceApplicationForm.squarePostContent = ''
  resourceApplicationItems.value = (post.template.resourceItems ?? []).map((item, index) => ({
    id: `tpl_${Date.now().toString(36)}_${index}`,
    resourceType: item.resourceType,
    resourceSubtype: item.resourceSubtype,
    payload: { ...item.payload },
    requestedQuota: item.requestedQuota,
    requestedPermission: item.requestedPermission,
    duration: item.duration,
  }))
  router.push('/dashboard/apply/create')
}
</script>

<template>
  <section class="mx-auto max-w-5xl space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            广场
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            复用申请模板，查看公开评价，并为值得支持的方向拼一刀。
          </p>
        </div>
        <TxButton variant="primary" @click="openSquarePostDialog">
          <span class="i-carbon-add-alt" />
          发布
        </TxButton>
      </div>
    </TxCard>

    <div v-if="!squarePosts.length" class="text-sm text-slate-500 p-10 text-center border border-black/10 rounded-3xl border-dashed dark:border-white/10">
      暂无广场内容
    </div>

    <article v-for="post in squarePosts" :key="post.id" class="square-post">
      <div class="flex flex-wrap gap-3 items-start justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <span :class="typeIcon(post.requestType || 'resource')" />
            <h3 class="text-xl fw-900 truncate">
              {{ post.title }}
            </h3>
          </div>
          <div class="text-xs text-slate-500 mt-1 dark:text-slate-400">
            {{ userName(post.userId) }} · {{ formatDate(post.createdAt) }}
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <span v-if="shouldShowPostStateBadge(post)" :title="postStateHint(post)">
            <TxStatusBadge :text="postStateText(post)" :status="isSquarePostAfterApproval(post.id) ? 'info' : 'warning'" size="sm" />
          </span>
          <TxStatusBadge v-if="isLinkedSquarePost(post) && !isSquarePostAfterApproval(post.id)" class="square-discount-badge" :text="`${discountText(squarePostDiscountRate(post.id))}`" status="success" size="sm" />
          <TxStatusBadge v-if="post.penaltyCount" :text="`处罚 ${post.penaltyCount} 次`" status="danger" size="sm" />
        </div>
      </div>

      <RichTextView :content="post.content" class="rich-text-preview mt-4 line-clamp-3" />

      <div v-if="postApplication(post)" class="mt-4 p-3 rounded-2xl bg-slate-50 dark:bg-white/5">
        <div class="text-sm fw-900">
          关联记录：{{ postApplication(post)?.title }}
        </div>
        <div v-if="!isSquarePostAfterApproval(post.id)" class="text-xs text-slate-500 mt-1 dark:text-slate-400">
          {{ postApplication(post)?.type.toUpperCase() }} · {{ formatPoints(postApplication(post)?.cost || 0) }}
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        <TxButton v-if="canUseTemplate(post)" size="sm" variant="primary" @click="useTemplate(post)">
          套用模板
        </TxButton>
      </div>

      <div v-if="isLinkedSquarePost(post) && !isSquarePostAfterApproval(post.id)" class="mt-5 pt-4 border-t border-black/8 dark:border-white/10">
        <div class="square-boost-panel">
          <div class="square-boost-main">
            <div class="flex flex-wrap gap-2 items-center">
              <b>拼一刀助力</b>
              <span class="square-boost-info" :aria-label="squareBoostHelpText" :data-tooltip="squareBoostHelpText" tabindex="0">
                <span class="i-carbon-information" />
              </span>
            </div>
            <div class="square-boost-progress" :title="`当前 ${discountText(squarePostDiscountRate(post.id))}，最低 ${discountText(SQUARE_MIN_DISCOUNT_RATE)}`">
              <span :style="{ width: `${boostProgress(post.id)}%` }" />
            </div>
            <div class="square-boost-summary">
              <span>有效助力 {{ boostCount(post.id) }} 人</span>
              <span>每 {{ SQUARE_BOOSTS_PER_DISCOUNT_STEP }} 人递减 {{ Number(SQUARE_BOOST_DISCOUNT_STEP * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) }} 折</span>
              <span>最低 {{ discountText(SQUARE_MIN_DISCOUNT_RATE) }}</span>
            </div>
            <div class="square-supporters" :title="boostSupporters(post.id).length ? '最近支持这个领域的人' : '暂时还没有人支持这个领域'">
              <span v-for="boostItem in boostSupporters(post.id)" :key="boostItem.id" class="square-supporter-avatar" :title="userName(boostItem.userId)">
                {{ userInitial(boostItem.userId) }}
              </span>
              <span v-if="!boostSupporters(post.id).length" class="square-supporter-empty">
                暂无支持者
              </span>
              <span v-else-if="boostCount(post.id) > boostSupporters(post.id).length" class="square-supporter-more">
                +{{ boostCount(post.id) - boostSupporters(post.id).length }}
              </span>
            </div>
          </div>
          <TxButton v-if="currentUser && post.userId !== currentUser.id" variant="secondary" @click="openBoostDialog(post)">
            <span class="i-carbon-thumbs-up" />
            助力
          </TxButton>
        </div>
        <div class="mt-3 space-y-2">
          <div v-for="boostItem in squarePostBoosts(post.id).slice(0, 5)" :key="boostItem.id" class="square-boost-row">
            <div class="min-w-0">
              <div class="text-sm fw-800">
                {{ userName(boostItem.userId) }}
                <span v-if="boostItem.mode === 'post_approval_vote'" class="text-sky-600 dark:text-sky-300">结束后投票</span>
                <span v-if="boostItem.reportedAt" class="text-rose-600 dark:text-rose-300">已举报</span>
              </div>
              <RichTextView :content="boostItem.declaration" class="rich-text-preview text-sm mt-1" />
            </div>
            <div v-if="currentUser && boostItem.userId !== currentUser.id && !boostItem.reportedAt && boostItem.mode !== 'post_approval_vote'" class="square-report-box">
              <TxInput v-model="squareReportDrafts[boostItem.id]" placeholder="举报理由" />
              <TxButton size="sm" variant="danger" @click="report(boostItem.id)">
                举报
              </TxButton>
            </div>
          </div>
        </div>
      </div>
    </article>
  </section>

  <Teleport to="body">
    <Transition name="dialog-shell">
      <div v-if="isSquarePostDialogOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeSquarePostDialog">
        <div class="dialog-surface solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-3xl w-full overflow-auto">
          <div class="flex gap-4 items-start justify-between">
            <div>
              <h3 class="text-2xl fw-900 tracking-tight">
                发布到广场
              </h3>
              <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                可发布独立模板帖、评价帖；关联申请时会进入分享领域拼一刀。
              </p>
            </div>
            <TxButton variant="ghost" size="sm" aria-label="关闭发布弹窗" @click="closeSquarePostDialog">
              <span class="i-carbon-close" />
            </TxButton>
          </div>

          <div v-if="!currentUser" class="text-sm text-slate-500 mt-6 p-5 text-center border border-black/10 rounded-2xl border-dashed dark:border-white/10">
            登录后可发布广场内容。
          </div>
          <div v-else class="mt-6 space-y-4">
            <label class="gap-2 grid">
              <span class="field-label">标题</span>
              <TxInput v-model="squarePostForm.title" placeholder="例如：校园公益 Bot 资源模板" />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">关联申请</span>
              <TxSelect v-model="squarePostForm.applicationId" panel-background="pure">
                <TxSelectItem value="" label="不关联申请" />
                <TxSelectItem v-for="item in shareableApplications" :key="item.id" :value="item.id" :label="`${item.title} · ${item.type.toUpperCase()}`" />
              </TxSelect>
            </label>
            <label v-if="!isSquarePostLinkedToApplication" class="gap-2 grid">
              <span class="field-label">发布类型</span>
              <TxSelect v-model="squarePostForm.postType" panel-background="pure">
                <TxSelectItem value="review" label="评价帖" />
                <TxSelectItem value="application_template" label="模板帖" />
              </TxSelect>
            </label>
            <div v-else class="option-check">
              <span class="i-carbon-checkmark-filled text-teal-600 mt-0.5" />
              <span>
                <b>分享领域拼一刀</b>
                <small>关联申请会进入领域助力流，其他用户可为这个方向助力或在结束后投票。</small>
              </span>
            </div>
            <label class="gap-2 grid">
              <span class="field-label">内容</span>
              <RichTextEditor v-model="squarePostForm.content" :min-height="220" :placeholder="isSquarePostLinkedToApplication ? '说明为什么这个领域值得支持，或补充项目背景' : squarePostForm.postType === 'application_template' ? '整理可复用的申请模板、用途说明或材料结构' : '评价申请体验、公开反馈或补充建议'" />
            </label>
            <div class="pt-2 flex flex-wrap gap-3 justify-end">
              <TxButton variant="secondary" @click="closeSquarePostDialog">
                取消
              </TxButton>
              <TxButton variant="primary" @click="publishPost">
                {{ publishButtonText }}
              </TxButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="dialog-shell">
      <div v-if="activeBoostPost" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeBoostDialog">
        <div class="dialog-surface solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-2xl w-full overflow-auto">
          <div class="flex gap-4 items-start justify-between">
            <div>
              <h3 class="text-2xl fw-900 tracking-tight">
                助力这个领域
              </h3>
              <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
                写下至少 20 字宣言，成功后获得 {{ SQUARE_BOOST_REWARD_POINTS }} 积分；每人每天最多 {{ SQUARE_DAILY_BOOST_LIMIT }} 次助力机会。
              </p>
            </div>
            <TxButton variant="ghost" size="sm" aria-label="关闭助力弹窗" @click="closeBoostDialog">
              <span class="i-carbon-close" />
            </TxButton>
          </div>

          <div class="mt-5 p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
            <div class="text-sm fw-900">
              {{ activeBoostPost.title }}
            </div>
            <div class="square-boost-summary mt-2">
              <span>有效助力 {{ boostCount(activeBoostPost.id) }} 人</span>
              <span>当前 {{ discountText(squarePostDiscountRate(activeBoostPost.id)) }}</span>
              <span>最低 {{ discountText(SQUARE_MIN_DISCOUNT_RATE) }}</span>
            </div>
          </div>

          <label class="mt-5 gap-2 grid">
            <span class="field-label">助力宣言</span>
            <RichTextEditor v-model="squareBoostDrafts[activeBoostPost.id]" :min-height="180" placeholder="说明为什么支持这个领域，至少 20 字" />
          </label>

          <div class="pt-5 flex flex-wrap gap-3 justify-end">
            <TxButton variant="secondary" @click="closeBoostDialog">
              取消
            </TxButton>
            <TxButton variant="primary" @click="boost(activeBoostPost.id)">
              {{ boostActionText(activeBoostPost) }}
            </TxButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
