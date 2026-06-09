import type { ApplicationItem, RequestStatus, ResourceProvisionStatus, WelfareApplication } from './core'
import { resourceApprovalStatusText, resourceTypeLabel } from './core'

export interface ResourceDisplayField {
  label: string
  value: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

export interface ResourceWorkflowStep {
  key: string
  label: string
  done: boolean
  active: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown) {
  if (typeof value === 'boolean')
    return value ? '是' : '否'
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  if (typeof value === 'string')
    return value.trim()
  return ''
}

function field(label: string, value: unknown, tone?: ResourceDisplayField['tone']): ResourceDisplayField | undefined {
  const normalized = text(value)
  return normalized ? { label, value: normalized, tone } : undefined
}

function yesNoField(label: string, value: unknown, warningWhenTrue = false): ResourceDisplayField {
  return {
    label,
    value: value ? '是' : '否',
    tone: value && warningWhenTrue ? 'warning' : 'default',
  }
}

function collect(fields: Array<ResourceDisplayField | undefined>) {
  return fields.filter((item): item is ResourceDisplayField => !!item)
}

function baseResourceFields(item: Pick<ApplicationItem, 'resourceType' | 'resourceSubtype' | 'requestedQuota' | 'requestedPermission' | 'duration' | 'approverGroup'>) {
  return collect([
    field('资源类型', resourceTypeLabel(item.resourceType)),
    field('资源规格', item.resourceSubtype),
    field('审批组', item.approverGroup),
    field('申请权限', item.requestedPermission),
    field('申请额度', item.requestedQuota),
    field('有效期', item.duration),
  ])
}

function databaseFields(payload: Record<string, unknown>) {
  return collect([
    field('数据库/实例名', payload.name),
    field('环境', payload.environment),
    field('权限级别', payload.permission),
    field('所属项目', payload.project),
    field('成本归属', payload.costCenter),
    field('负责人', payload.owner),
    yesNoField('涉及敏感数据', payload.sensitiveData, true),
    field('申请原因', payload.reason),
    field('操作范围', payload.operationScope),
    field('访问范围', payload.accessScope),
  ])
}

function llmFields(payload: Record<string, unknown>) {
  return collect([
    field('模型', payload.modelName || payload.model),
    field('额度/轮次', payload.budgetLimit),
    field('RPM 限制', payload.rpmLimit),
    field('TPM 限制', payload.tpmLimit),
    field('并发限制', payload.concurrencyLimit),
    field('速率模式', payload.rateLimitMode),
    field('IP 白名单', Array.isArray(payload.ipWhitelist) ? payload.ipWhitelist.join('、') : payload.ipWhitelist),
    field('IP 黑名单', Array.isArray(payload.ipBlacklist) ? payload.ipBlacklist.join('、') : payload.ipBlacklist),
    yesNoField('上传用户数据', payload.uploadsUserData || payload.uploadUserData, true),
    yesNoField('包含敏感信息', payload.containsSensitiveInfo || payload.containsPrivacy, true),
    field('日志保留', payload.logRetention),
  ])
}

function genericFields(payload: Record<string, unknown>) {
  return collect([
    field('资源名称', payload.name || payload.title),
    field('环境', payload.environment),
    field('数量', payload.quantity),
    field('权限级别', payload.permission),
    field('所属项目', payload.project),
    field('成本归属', payload.costCenter),
    field('负责人', payload.owner),
    field('申请原因', payload.reason),
    field('使用范围', payload.operationScope || payload.accessScope || payload.scope),
  ])
}

export function resourceItemPayloadFields(item: Pick<ApplicationItem, 'resourceType' | 'payload'>) {
  const payload = isRecord(item.payload) ? item.payload : {}
  if (item.resourceType === 'database')
    return databaseFields(payload)
  if (item.resourceType === 'llm_api_quota')
    return llmFields(payload)
  return genericFields(payload)
}

export function resourceItemApprovedFields(item: Pick<ApplicationItem, 'approvedPayload'>) {
  if (!isRecord(item.approvedPayload))
    return []
  return genericFields(item.approvedPayload)
}

export function resourceItemSummaryFields(item: Pick<ApplicationItem, 'resourceType' | 'resourceSubtype' | 'requestedQuota' | 'requestedPermission' | 'duration' | 'approverGroup' | 'payload'>) {
  return [...baseResourceFields(item), ...resourceItemPayloadFields(item)]
}

export function resourceProvisionStatusText(status?: ResourceProvisionStatus) {
  if (status === 'completed')
    return '结果已发放'
  if (status === 'pending')
    return '队列中'
  return '无需发放'
}

export function resourceTicketStatus(application: Pick<WelfareApplication, 'status' | 'resourceItems' | 'processingStartedAt' | 'reviewedAt'>) {
  const items = application.resourceItems ?? []
  const approvedItems = items.filter(item => ['approved', 'adjusted_approved'].includes(item.approvalStatus))
  if (application.status === 'closed' || application.status === 'completed')
    return { label: '已关闭', tone: 'info' as const }
  if (application.status === 'needs_supplement')
    return { label: '需补充材料', tone: 'warning' as const }
  if (['submitted', 'in_review', 'pending_review'].includes(application.status))
    return { label: '材料已提交', tone: 'warning' as const }
  if (!approvedItems.length && ['rejected', 'cancelled'].includes(application.status))
    return { label: '未通过', tone: 'danger' as const }
  if (approvedItems.some(item => item.provisionStatus === 'completed'))
    return { label: '已有结果', tone: 'success' as const }
  if (approvedItems.some(item => item.provisionStatus === 'pending'))
    return { label: application.processingStartedAt || application.reviewedAt ? '大模型处理中' : '队列中', tone: 'warning' as const }
  if (['approved', 'partial_approved'].includes(application.status))
    return { label: '待发放', tone: 'warning' as const }
  return { label: '审核中', tone: 'info' as const }
}

export function resourceTicketSteps(application: Pick<WelfareApplication, 'status' | 'resourceItems' | 'processingStartedAt' | 'reviewedAt'>): ResourceWorkflowStep[] {
  const status = resourceTicketStatus(application).label
  const resultReady = status === '已有结果' || status === '已关闭'
  const processing = status === '大模型处理中' || resultReady
  const queued = status === '队列中' || status === '待发放' || processing
  const materials = status !== '需补充材料'
  return [
    { key: 'materials_required', label: '材料提交', done: materials, active: status === '需补充材料' },
    { key: 'queued', label: '队列中', done: queued, active: status === '队列中' || status === '待发放' },
    { key: 'ai_processing', label: '处理中', done: processing, active: status === '大模型处理中' },
    { key: 'result_ready', label: '结果可见', done: resultReady, active: resultReady },
  ]
}

export function resourceTicketPrimaryText(application: Pick<WelfareApplication, 'status' | 'resourceItems' | 'projectId'>) {
  const project = application.projectId || '未填写项目'
  const resources = (application.resourceItems ?? [])
    .map(item => `${resourceTypeLabel(item.resourceType)} / ${item.resourceSubtype} / ${resourceApprovalStatusText(item.approvalStatus)}`)
    .join('；')
  return `${project}：${resources || '暂无资源明细'}`
}

export function resourceStatusAllowsDiscussion(status: RequestStatus) {
  return ['submitted', 'in_review', 'approved', 'partial_approved', 'needs_supplement', 'processing', 'answered', 'pending_allocation', 'delivered'].includes(status)
}
