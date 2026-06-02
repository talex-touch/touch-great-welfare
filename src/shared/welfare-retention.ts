export const DATA_RETENTION_DAYS = 7
export const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000

interface RetentionRecord {
  id?: unknown
  createdAt?: unknown
  retentionExpiresAt?: unknown
}

interface RetentionTransaction extends RetentionRecord {
  refId?: unknown
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

function refId(value: RetentionTransaction) {
  return typeof value.refId === 'string' ? value.refId : undefined
}

export function applyWelfareRetentionPolicy<T extends RetentionState>(state: T) {
  const applications = Array.isArray(state.applications) ? state.applications : []
  const studentVerifications = Array.isArray(state.studentVerifications) ? state.studentVerifications : []
  const transactions = Array.isArray(state.transactions) ? state.transactions : []
  const referenceTime = Date.now()

  const expiredApplicationIds = new Set(
    applications
      .filter(isRetentionRecord)
      .filter(item => recordExpired(item, referenceTime))
      .map(recordId)
      .filter((id): id is string => !!id),
  )
  const expiredStudentVerificationIds = new Set(
    studentVerifications
      .filter(isRetentionRecord)
      .filter(item => hasExpired(item.createdAt, referenceTime))
      .map(recordId)
      .filter((id): id is string => !!id),
  )

  const retainedApplications = applications.filter((item) => {
    if (!isRetentionRecord(item))
      return true

    const id = recordId(item)
    return !id || !expiredApplicationIds.has(id)
  })
  const retainedStudentVerifications = studentVerifications.filter((item) => {
    if (!isRetentionRecord(item))
      return true

    const id = recordId(item)
    return !id || !expiredStudentVerificationIds.has(id)
  })
  const retainedTransactions = transactions.filter((item) => {
    if (!isRetentionRecord(item))
      return true
    if (hasExpired(item.createdAt, referenceTime))
      return false

    const id = refId(item)
    return !id || (!expiredApplicationIds.has(id) && !expiredStudentVerificationIds.has(id))
  })

  const changed = retainedApplications.length !== applications.length
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
