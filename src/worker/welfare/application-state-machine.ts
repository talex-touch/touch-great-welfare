import type { ApplicationItem, ResourceApprovalStatus, WelfareApplication } from '~/shared/welfare-types'

type ApplicationStatus = WelfareApplication['status']

const ORDINARY_REVIEW_STATUSES = new Set<ApplicationStatus>(['pending_review', 'processing'])
const RESOURCE_REVIEW_DECISIONS = new Set<ResourceApprovalStatus>(['approved', 'adjusted_approved', 'rejected'])

interface ResourceItemReviewDecision {
  status: ResourceApprovalStatus
  approvedPayload?: Record<string, unknown>
  note: string
}

interface ResourceProvisionCompletion {
  lifecycleStatus: NonNullable<ApplicationItem['lifecycleStatus']>
  payload: Record<string, unknown>
  note: string
}

export function aggregateResourceApplicationStatusForReview(
  items: Pick<ApplicationItem, 'approvalStatus' | 'provisionStatus'>[],
  currentStatus?: ApplicationStatus,
): ApplicationStatus {
  if (!items.length)
    return 'draft'
  if (items.some(item => item.approvalStatus === 'pending'))
    return 'in_review'

  const approvedItems = items.filter(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus))
  const rejectedCount = items.filter(item => item.approvalStatus === 'rejected').length
  if (!approvedItems.length && rejectedCount === items.length)
    return 'rejected'
  if (approvedItems.length && approvedItems.every(item => item.provisionStatus === 'completed'))
    return 'delivered'
  if (approvedItems.length)
    return 'pending_allocation'
  return currentStatus === 'partial_approved' ? 'partial_approved' : 'rejected'
}

export function isOrdinaryReviewPendingStatus(status: ApplicationStatus) {
  return ORDINARY_REVIEW_STATUSES.has(status)
}

export function assertCanAnswerApplication(status: ApplicationStatus) {
  if (!isOrdinaryReviewPendingStatus(status))
    throw new Error('该申请已经处理')
}

export function assertCanRejectApplication(status: ApplicationStatus) {
  if (!isOrdinaryReviewPendingStatus(status))
    throw new Error('该申请已经处理')
}

export function assertCanRequestApplicationSupplement(status: ApplicationStatus) {
  if (!isOrdinaryReviewPendingStatus(status))
    throw new Error('只有审核中的申请可以请求补充材料')
}

export function assertCanCompleteApplication(status: ApplicationStatus) {
  if (!['answered', 'delivered'].includes(status))
    throw new Error('只有已答复或已交付的申请可以标记完成')
}

export function assertResourceApplication(application: Pick<WelfareApplication, 'type'>) {
  if (application.type !== 'resource')
    throw new Error('资源申请不存在')
}

export function assertCanReviewResourceApplication(application: Pick<WelfareApplication, 'type' | 'status'>) {
  assertResourceApplication(application)
  if (!['submitted', 'in_review'].includes(application.status))
    throw new Error('该申请不在审批中')
}

export function transitionApplicationAnswered(
  application: Pick<WelfareApplication, 'status' | 'answer' | 'reviewedAt' | 'processingStartedAt'>,
  answer: string,
  reviewedAt: string,
) {
  application.status = 'pending_allocation'
  application.answer = answer
  application.reviewedAt = reviewedAt
  application.processingStartedAt ??= reviewedAt
}

export function transitionApplicationRejected(
  application: Pick<WelfareApplication, 'status' | 'answer' | 'reviewedAt' | 'rejectionFraudulent'>,
  reason: string,
  reviewedAt: string,
  fraudulent: boolean,
) {
  application.status = 'rejected'
  application.rejectionFraudulent = fraudulent
  application.answer = reason
  application.reviewedAt = reviewedAt
}

export function transitionApplicationCompleted(
  application: Pick<WelfareApplication, 'status' | 'completedAt'>,
  completedAt: string,
) {
  application.status = 'completed'
  application.completedAt = completedAt
}

export function transitionApplicationSupplementRequested(
  application: Pick<WelfareApplication, 'status' | 'processingStartedAt'>,
  requestedAt: string,
) {
  application.status = 'needs_supplement'
  application.processingStartedAt ??= requestedAt
}

export function transitionResourceItemReviewed(
  application: WelfareApplication,
  item: ApplicationItem,
  decision: ResourceItemReviewDecision,
  reviewedAt: string,
  answer: string,
) {
  assertCanReviewResourceApplication(application)
  if (item.approvalStatus !== 'pending')
    throw new Error('该资源明细已经审批')
  if (!RESOURCE_REVIEW_DECISIONS.has(decision.status))
    throw new Error('审批状态无效')
  if (decision.status === 'rejected' && !decision.note)
    throw new Error('驳回资源明细时必须填写原因')
  if (decision.status === 'adjusted_approved' && !decision.approvedPayload)
    throw new Error('调整后通过必须填写批准后的额度/权限')

  item.approvalStatus = decision.status
  item.approvedPayload = decision.approvedPayload
  item.rejectReason = decision.status === 'rejected' ? decision.note : undefined
  item.provisionStatus = ['approved', 'adjusted_approved'].includes(decision.status) ? 'pending' : 'not_required'
  item.lifecycleStatus = decision.status === 'rejected' ? 'rejected' : 'provisioning'
  item.expiresAt = item.expiresAt
    ?? (typeof decision.approvedPayload?.expiresAt === 'string' ? decision.approvedPayload.expiresAt : undefined)
    ?? (typeof item.payload.expiresAt === 'string' ? item.payload.expiresAt : undefined)
  item.updatedAt = reviewedAt

  application.status = aggregateResourceApplicationStatusForReview(application.resourceItems ?? [], application.status)
  if (['pending_allocation', 'delivered', 'approved', 'partial_approved', 'rejected'].includes(application.status)) {
    application.reviewedAt = reviewedAt
    if (['delivered', 'rejected'].includes(application.status))
      application.completedAt = reviewedAt
  }
  application.answer = answer
}

export function transitionResourceProvisionCompleted(
  application: WelfareApplication,
  item: ApplicationItem,
  completion: ResourceProvisionCompletion,
  completedAt: string,
) {
  assertResourceApplication(application)
  if (!['approved', 'adjusted_approved'].includes(item.approvalStatus))
    throw new Error('只有通过的资源明细需要开通')

  item.provisionStatus = 'completed'
  item.lifecycleStatus = completion.lifecycleStatus
  item.provisionPayload = completion.payload
  item.provisionNote = completion.note
  item.provisionCompletedAt = completedAt
  item.activatedAt = item.lifecycleStatus === 'active' ? completedAt : item.activatedAt
  item.updatedAt = completedAt

  application.status = aggregateResourceApplicationStatusForReview(application.resourceItems ?? [], application.status)
  if (application.status === 'delivered')
    application.completedAt = completedAt
}

export function transitionApplicationAllocationCompleted(
  application: WelfareApplication,
  allocationPayload: Record<string, unknown>,
  allocationNote: string,
  completedAt: string,
) {
  if (application.status !== 'pending_allocation')
    throw new Error('只有待分配资源的申请可以完成发放')

  application.status = 'delivered'
  application.allocationPayload = allocationPayload
  application.allocationNote = allocationNote
  application.allocationCompletedAt = completedAt
  application.completedAt = completedAt
}
