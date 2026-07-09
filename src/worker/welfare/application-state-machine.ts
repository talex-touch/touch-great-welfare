import type { ApplicationItem, WelfareApplication } from '~/shared/welfare-types'

type ApplicationStatus = WelfareApplication['status']

const ORDINARY_REVIEW_STATUSES = new Set<ApplicationStatus>(['pending_review', 'processing'])

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
