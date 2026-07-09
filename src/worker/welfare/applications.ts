import type {
  ApplicationMessageType,
  AttachmentMeta,
  ResourceLifecycleAction,
  ResourceType,
  SubmitApplicationPayload,
  SubmitResourceApplicationPayload,
  User,
  WelfareApplication,
  WelfareState,
} from '~/shared/welfare-types'
import {
  applicationPowChallenge,
  buildUserLevelCard,
  canApplyResourceType,
  isValidApplicationPow,
  resourceTypeConfigForPolicy,
  termsForResourceTypes,
} from '~/composables/welfare'
import { MAX_ACTIVE_USER_REQUESTS, MAX_ATTACHMENT_BYTES } from '~/shared/welfare-domain'
import { isRichTextEmpty, richTextToPlainText } from '~/utils/rich-text'

export function stateApplications(state: Partial<WelfareState>) {
  return Array.isArray(state.applications) ? state.applications : []
}

export function ensureApplications(state: Partial<WelfareState>) {
  state.applications ??= []
  return state.applications
}

export function adminApplication(state: Partial<WelfareState>, applicationId: unknown) {
  const application = stateApplications(state).find(item => item.id === applicationId)
  if (!application)
    throw new Error('申请不存在')
  return application
}

export function sanitizeMessageType(value: unknown): ApplicationMessageType {
  return value === 'comment' || value === 'supplement' || value === 'result_submission' || value === 'system' ? value : 'comment'
}

export function sanitizeResourceLifecycleAction(value: unknown): ResourceLifecycleAction {
  const actions: ResourceLifecycleAction[] = ['approve', 'reject', 'provision', 'activate', 'request_renewal', 'approve_renewal', 'reject_renewal', 'mark_expired', 'queue_reclaim', 'return', 'release', 'close']
  if (actions.includes(value as ResourceLifecycleAction))
    return value as ResourceLifecycleAction
  throw new Error('资源生命周期动作无效')
}

export function buildResourceDescription(payload: SubmitResourceApplicationPayload, sanitizeRichText: (value: unknown) => string) {
  return sanitizeRichText(payload.reason || payload.businessBackground)
}

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function timeToMinutes(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match)
    return undefined

  return Number(match[1]) * 60 + Number(match[2])
}

function isWithinOpenWindow(policy: { openStart: string, openEnd: string }, current = new Date()) {
  const start = timeToMinutes(policy.openStart)
  const end = timeToMinutes(policy.openEnd)
  if (start === undefined || end === undefined || start === end)
    return true

  const currentMinutes = current.getHours() * 60 + current.getMinutes()
  if (start < end)
    return currentMinutes >= start && currentMinutes <= end
  return currentMinutes >= start || currentMinutes <= end
}

function isActiveApplicationStatus(status: string) {
  return ['draft', 'reserved', 'pending_review', 'needs_supplement', 'processing', 'answered', 'submitted', 'in_review', 'approved', 'partial_approved', 'pending_allocation'].includes(status)
}

function isActiveStudentStatus(status: string) {
  return ['pending', 'needs_supplement'].includes(status)
}

function activeRequestCountForState(state: Partial<WelfareState>, userId: string) {
  return stateApplications(state).filter(item => item.userId === userId && isActiveApplicationStatus(item.status)).length
    + (state.studentVerifications ?? []).filter(item => item.userId === userId && isActiveStudentStatus(item.status)).length
}

function recentSubmissionCooldownUntilForState(state: Partial<WelfareState>, userId: string, createdAt: string) {
  const cooldownMs = (state.applicationPolicy?.submitCooldownSeconds ?? 0) * 1000
  if (cooldownMs <= 0)
    return undefined

  const lastSubmittedAt = stateApplications(state)
    .filter(item => item.userId === userId && item.status !== 'draft')
    .map(item => new Date(item.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0]
  if (!lastSubmittedAt)
    return undefined

  const until = lastSubmittedAt + cooldownMs
  if (new Date(createdAt).getTime() < until)
    return new Date(until).toISOString()
}

export function rejectionFeeWaiverBlockedUntilForState(state: Partial<WelfareState>, userId: string) {
  const currentTime = Date.now()
  return stateApplications(state)
    .filter(item => item.userId === userId && !!item.waiveRejectionReviewFeeBlockedUntil)
    .map(item => item.waiveRejectionReviewFeeBlockedUntil!)
    .filter((value) => {
      const time = new Date(value).getTime()
      return Number.isFinite(time) && time > currentTime
    })
    .sort()
    .at(-1)
}

export function assertCanCreateRequestForState(state: Partial<WelfareState>, userId: string) {
  const systemConfig = state.systemConfig
  if (systemConfig && !systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)

  if (activeRequestCountForState(state, userId) >= MAX_ACTIVE_USER_REQUESTS)
    throw new Error(`一个用户最多只能同时创建 ${MAX_ACTIVE_USER_REQUESTS} 个待处理请求`)
}

export function assertApplicationPolicyForState(state: Partial<WelfareState>, input: {
  userId: string
  type: SubmitApplicationPayload['type']
  title: string
  description: string
  createdAt: string
  powNonce?: string
  turnstileVerified?: boolean
}) {
  const systemConfig = state.systemConfig
  if (systemConfig && !systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)

  const policy = state.applicationPolicy
  const kindPolicy = policy?.categories?.[input.type]
  if (!policy || !kindPolicy)
    throw new Error('申请策略未配置')
  if (!kindPolicy.enabled)
    throw new Error(kindPolicy.closedReason || `${input.type.toUpperCase()} 申请暂未开放`)
  if (!isWithinOpenWindow(kindPolicy, new Date(input.createdAt)))
    throw new Error(`${input.type.toUpperCase()} 申请不在当前开放时间段`)

  const plainLength = richTextToPlainText(input.description).trim().length
  if (plainLength < policy.minDescriptionChars)
    throw new Error(`申请内容不得少于 ${policy.minDescriptionChars} 字`)

  const cooldownUntil = recentSubmissionCooldownUntilForState(state, input.userId, input.createdAt)
  if (cooldownUntil)
    throw new Error(`提交过于频繁，请在 ${cooldownUntil} 后再提交`)

  const today = localDateKey(input.createdAt)
  const sameDayApplications = stateApplications(state)
    .filter(item => item.type === input.type && item.status !== 'draft' && localDateKey(item.createdAt) === today)
  if (kindPolicy.dailyLimit > 0 && sameDayApplications.length >= kindPolicy.dailyLimit)
    throw new Error(`${input.type.toUpperCase()} 今日申请名额已满`)
  if (kindPolicy.perUserDailyLimit > 0 && sameDayApplications.filter(item => item.userId === input.userId).length >= kindPolicy.perUserDailyLimit)
    throw new Error(`你今日 ${input.type.toUpperCase()} 申请次数已达上限`)

  if (policy.turnstileEnabled && !input.turnstileVerified)
    throw new Error('请先完成人机验证')
  if (policy.powEnabled) {
    const challenge = applicationPowChallenge(input)
    if (!isValidApplicationPow(challenge, input.powNonce, policy.powDifficulty))
      throw new Error('PoW 校验未通过，请重新提交')
  }
}

export function assertResourceTypeCanApplyForState(state: Partial<WelfareState>, resourceType: ResourceType, user: User) {
  const config = resourceTypeConfigForPolicy(resourceType, state.applicationPolicy)
  if (!config)
    throw new Error('资源类型无效')
  const userLevel = buildUserLevelCard(user, {
    applications: stateApplications(state),
    studentVerifications: state.studentVerifications ?? [],
  })
  if (!canApplyResourceType(config, userLevel.priority))
    throw new Error(config.unavailableReason || `${config.displayName} 暂不可申请`)
}

export function buildResourceTermsAcceptances(resourceTypes: ResourceType[], acceptedTermIds: SubmitResourceApplicationPayload['acceptedTermIds'], userId: string, acceptedAt: string) {
  const requiredTerms = termsForResourceTypes(resourceTypes)
  const accepted = new Set(acceptedTermIds)
  const missing = requiredTerms.filter(term => !accepted.has(term.id))
  if (missing.length)
    throw new Error(`请确认所有条款：${missing.map(term => term.title).join('、')}`)

  return requiredTerms.map(term => ({
    termId: term.id,
    version: term.version,
    acceptedBy: userId,
    acceptedAt,
  }))
}

function safeAttachmentUrl(value: unknown) {
  if (typeof value !== 'string')
    return undefined
  const text = value.trim()
  if (!text)
    return undefined
  if (text.startsWith('/api/uploads/') || text.startsWith('/uploads/'))
    return text
  return undefined
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
}

export function attachmentsFromPayload(value: unknown): AttachmentMeta[] {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const type = typeof item.type === 'string' ? item.type : 'application/octet-stream'
      return {
        id: typeof item.id === 'string' ? item.id : `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: typeof item.name === 'string' ? item.name : '附件',
        size: Math.max(0, Math.trunc(Number(item.size || 0))),
        type,
        r2Key: typeof item.r2Key === 'string' ? item.r2Key : undefined,
        url: safeAttachmentUrl(item.url),
        dataUrl: type.startsWith('image/') && isImageDataUrl(item.dataUrl) ? item.dataUrl : undefined,
      } satisfies AttachmentMeta
    })
}

export function totalAttachmentBytes(attachments: AttachmentMeta[]) {
  return attachments.reduce((sum, item) => sum + Math.max(0, Math.trunc(Number(item.size || 0))), 0)
}

function resourceItemAttachmentsFromPayload(items: SubmitResourceApplicationPayload['resourceItems'] = []) {
  return items.flatMap(item => attachmentsFromPayload(item.payload?.attachments))
}

export function totalResourceApplicationAttachmentBytes(payload: Pick<SubmitResourceApplicationPayload, 'attachments' | 'resourceItems'>) {
  return totalAttachmentBytes([
    ...attachmentsFromPayload(payload.attachments),
    ...resourceItemAttachmentsFromPayload(payload.resourceItems),
  ])
}

export function pushApplicationMessage(application: WelfareApplication, userId: string, type: ApplicationMessageType, content: string, attachments: AttachmentMeta[] = []) {
  application.messages ??= []
  application.messages.push({
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    applicationId: application.id,
    userId,
    type,
    content,
    attachments,
    createdAt: new Date().toISOString(),
  })
}

function stringPayloadField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeManualProvisionPayload(payload: Record<string, unknown>) {
  const resourceName = stringPayloadField(payload, 'resourceName')
  const resourceType = stringPayloadField(payload, 'resourceType')
  const accessUrl = stringPayloadField(payload, 'accessUrl')
  const credential = stringPayloadField(payload, 'credential')
  const expiresAt = stringPayloadField(payload, 'expiresAt')
  const note = stringPayloadField(payload, 'note')
  if (!resourceName)
    throw new Error('请填写资源名称')
  if (!resourceType)
    throw new Error('请选择资源类型')
  if (!accessUrl && !credential)
    throw new Error('请至少填写访问地址或凭据')
  return {
    resourceName,
    resourceType,
    accessUrl,
    credential,
    expiresAt,
    note,
  }
}

export function manualProvisionNote(provisionPayload: ReturnType<typeof normalizeManualProvisionPayload>) {
  const parts = [
    `资源：${provisionPayload.resourceName}`,
    `类型：${provisionPayload.resourceType}`,
    provisionPayload.accessUrl ? `访问地址：${provisionPayload.accessUrl}` : '',
    provisionPayload.credential ? `凭据：${provisionPayload.credential}` : '',
    provisionPayload.expiresAt ? `有效期：${provisionPayload.expiresAt}` : '',
    provisionPayload.note ? `备注：${provisionPayload.note}` : '',
  ].filter(Boolean)
  return parts.join('\n')
}

export function appendWorkerApplicationMessage(
  application: WelfareApplication,
  user: Pick<User, 'id'>,
  payload: Record<string, unknown>,
  sanitizeRichText: (value: unknown) => string,
) {
  const content = sanitizeRichText(payload.content)
  if (isRichTextEmpty(content))
    throw new Error('请输入消息内容')
  const attachments = attachmentsFromPayload(payload.attachments)
  if (totalAttachmentBytes(attachments) > MAX_ATTACHMENT_BYTES)
    throw new Error('附件总大小不能超过 200MB')
  pushApplicationMessage(application, user.id, sanitizeMessageType(payload.type), content, attachments)
  return { applicationId: application.id }
}
