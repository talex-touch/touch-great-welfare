export const DATA_RETENTION_DAYS = 7
export const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000

interface RetentionRecord {
  id?: unknown
  createdAt?: unknown
  retentionExpiresAt?: unknown
  retentionExpired?: unknown
}

interface RetentionState {
  applications?: unknown
  studentVerifications?: unknown
  transactions?: unknown
}

function isRetentionRecord(value: unknown): value is RetentionRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExpired(createdAt: unknown, referenceTime = Date.now()) {
  if (typeof createdAt !== 'string')
    return false

  const createdTime = new Date(createdAt).getTime()
  return Number.isFinite(createdTime) && referenceTime - createdTime > DATA_RETENTION_MS
}

function recordExpired(value: RetentionRecord, referenceTime = Date.now()) {
  if (typeof value.retentionExpiresAt === 'string') {
    const expiresTime = new Date(value.retentionExpiresAt).getTime()
    if (Number.isFinite(expiresTime))
      return referenceTime > expiresTime
  }

  return hasExpired(value.createdAt, referenceTime)
}

function recordId(value: RetentionRecord) {
  return typeof value.id === 'string' ? value.id : undefined
}

function scrubExpiredApplication(value: RetentionRecord) {
  const record = value as Record<string, unknown>
  return {
    ...record,
    description: '<p>申请详情已按保留策略自动清理。</p>',
    githubRepo: undefined,
    attachments: [],
    answer: undefined,
    messages: [],
    aiReview: undefined,
    resourceItems: [],
    termsAcceptances: [],
    reason: undefined,
    businessBackground: undefined,
    selectedResourceTypes: Array.isArray(record.selectedResourceTypes) ? record.selectedResourceTypes : undefined,
    retentionExpired: true,
    retentionExpiredAt: typeof record.retentionExpiresAt === 'string' ? record.retentionExpiresAt : new Date().toISOString(),
  }
}

export function applyWelfareRetentionPolicy<T extends RetentionState>(state: T) {
  const applications = Array.isArray(state.applications) ? state.applications : []
  const studentVerifications = Array.isArray(state.studentVerifications) ? state.studentVerifications : []
  const transactions = Array.isArray(state.transactions) ? state.transactions : []
  const referenceTime = Date.now()

  const expiredApplicationIds = new Set(
    applications
      .filter(isRetentionRecord)
      .filter(item => item.retentionExpired !== true)
      .filter(item => recordExpired(item, referenceTime))
      .map(recordId)
      .filter((id): id is string => !!id),
  )

  const retainedApplications = applications.map((item) => {
    if (!isRetentionRecord(item))
      return item

    const id = recordId(item)
    return id && expiredApplicationIds.has(id)
      ? scrubExpiredApplication(item)
      : item
  })
  const retainedStudentVerifications = studentVerifications
  const retainedTransactions = transactions

  const changed = expiredApplicationIds.size > 0
    || retainedStudentVerifications.length !== studentVerifications.length
    || retainedTransactions.length !== transactions.length

  if (Array.isArray(state.applications))
    state.applications = retainedApplications
  if (Array.isArray(state.studentVerifications))
    state.studentVerifications = retainedStudentVerifications
  if (Array.isArray(state.transactions))
    state.transactions = retainedTransactions

  return { state, changed }
}
