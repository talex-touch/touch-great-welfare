import type { EducationEmailChallenge, StudentVerification, WelfareState } from '~/shared/welfare-types'
import { assertEducationEmailAddress } from '~/shared/education-email'
import { STUDENT_REVIEW_FEE } from '~/shared/welfare-domain'
import { sha256Hex } from '../crypto'
import { stateUsers } from './users'

export type VerificationType = 'student' | 'frontline'

export function normalizeVerificationType(value: unknown): VerificationType {
  return value === 'frontline' ? 'frontline' : 'student'
}

export function verificationTypeLabel(type: VerificationType) {
  return type === 'frontline' ? '一线认证' : '学生认证'
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function ensureStudentVerifications(state: Partial<WelfareState>) {
  state.studentVerifications ??= []
  return state.studentVerifications
}

export function syncStudentVerifiedProfiles(state: Partial<WelfareState>) {
  const approvedStudentUserIds = new Set((Array.isArray(state.studentVerifications) ? state.studentVerifications : [])
    .filter(verification => normalizeVerificationType(verification.verificationType) === 'student' && verification.status === 'approved')
    .map(verification => verification.userId))

  for (const user of stateUsers(state)) {
    user.profile.studentVerified = approvedStudentUserIds.has(user.id)
  }

  return state
}

export function normalizeStudentEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function normalizeClientRequestId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : ''
}

export function assertEducationEmail(value: string) {
  assertEducationEmailAddress(value)
}

export async function studentVerificationIdForRequest(userId: string, clientRequestId: string) {
  if (!clientRequestId)
    return createId('stu')

  const digest = await sha256Hex(`student-verification:${userId}:${clientRequestId}`)
  return `stu_${digest.slice(0, 32)}`
}

export function markWorkerEducationEmailVerified(verification: StudentVerification, verifiedAt: string, source: 'mail_auto' | 'admin_approved') {
  if (!verification.educationEmail)
    return

  verification.educationEmailVerified = true
  verification.educationEmailVerifiedAt ||= verifiedAt
  verification.educationEmailVerificationSource ||= source
}

export function positiveStudentReviewFee(verification: StudentVerification) {
  const fee = Math.trunc(Number(verification.reviewFee ?? STUDENT_REVIEW_FEE))
  if (!Number.isFinite(fee) || fee <= 0)
    throw new Error('认证审核费无效')
  return fee
}

export function latestEducationEmailChallengeForState(state: Partial<WelfareState>, userId: string, email: string) {
  return (state.educationEmailChallenges ?? [])
    .filter((item) => {
      if (item.userId !== userId || item.email !== email)
        return false
      const expiresAt = new Date(item.expiresAt).getTime()
      return Number.isFinite(expiresAt) && expiresAt > Date.now()
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

export function assertVerifiedEducationEmailChallengeForState(challenge: EducationEmailChallenge | undefined, wantsVerified: boolean) {
  if (!wantsVerified)
    throw new Error('邮箱证明需要先通过收件 API 验证后才能提交')
  if (!challenge?.verifiedAt)
    throw new Error('邮箱证明尚未通过收件 API 验证，请先发送证明邮件并完成验证')
}

function formatWorkerDate(value?: string) {
  if (!value)
    return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function appendWorkerStudentSupplementNotes(existingNotes: string, supplementNotes: string, supplementedAt: string) {
  const previousNotes = existingNotes.trim() || '<p>（此前未填写材料说明）</p>'
  return `${previousNotes}<h3>补充资料（${formatWorkerDate(supplementedAt)}）</h3>${supplementNotes}`
}
