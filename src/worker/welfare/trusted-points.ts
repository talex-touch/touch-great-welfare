import type { WorkerEnv } from './env'
import {
  calculateLlmApiCostPoints,
  resolveSelectableLlmApiModel,
} from '~/composables/welfare'
import {
  BASE_REQUEST_COST,
  calculateActivityPrice,
  calculateLlmApiBudgetActivityPrice,
  DAILY_CHECK_IN_MAX_POINTS,
  PRO_EXPEDITE_COST,
  SQUARE_BOOST_REPORT_PENALTY_POINTS,
  SQUARE_BOOST_REWARD_POINTS,
  SQUARE_MIN_DISCOUNT_RATE,
  STORAGE_EXTENSION_COST,
  STUDENT_REVIEW_FEE,
} from '~/shared/welfare-domain'
import { appendPointTransaction, ensurePointTransactionSchema, pointTransactionId } from '../points'
import { getPool, shouldUseD1 } from './connection'
import { isRecord } from './records'

function now() {
  return new Date().toISOString()
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string') : []
}

function recordMap(value: unknown) {
  return new Map(arrayRecords(value).map(item => [item.id as string, item]))
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = Number(record[key])
  return Number.isFinite(value) ? value : fallback
}

function boolField(record: Record<string, unknown>, key: string) {
  return record[key] === true || record[key] === 1 || record[key] === '1'
}

function expectedApplicationBaseCost(application: Record<string, unknown>) {
  const type = typeof application.type === 'string' ? application.type : ''
  const createdAt = typeof application.createdAt === 'string' ? application.createdAt : now()
  if (type === 'code' && application.llmApiBudgetUsd !== undefined) {
    const model = resolveSelectableLlmApiModel(typeof application.llmApiModelKey === 'string' ? application.llmApiModelKey : undefined)
    const budgetUsd = numberField(application, 'llmApiBudgetUsd', model.defaultBudgetUsd)
    return calculateLlmApiBudgetActivityPrice(calculateLlmApiCostPoints(budgetUsd, model), budgetUsd, model, createdAt)
  }
  if (type === 'code' || type === 'image' || type === 'pro')
    return calculateActivityPrice(BASE_REQUEST_COST[type], createdAt)
  return 0
}

function assertTrustedNewApplication(application: Record<string, unknown>, userId: string) {
  if (application.userId !== userId)
    throw new Error('无权提交其他用户的申请')

  const type = typeof application.type === 'string' ? application.type : ''
  const status = typeof application.status === 'string' ? application.status : ''
  if (!['code', 'image', 'pro', 'resource'].includes(type))
    throw new Error('申请类型无效')
  if (type === 'resource' && !['draft', 'in_review'].includes(status))
    throw new Error('资源申请初始状态无效')
  if (type !== 'resource' && status !== 'pending_review')
    throw new Error('申请初始状态无效')

  const cost = numberField(application, 'cost')
  const isDraft = type === 'resource' && status === 'draft'
  if (isDraft)
    return

  if (!boolField(application, 'costCharged'))
    throw new Error('申请必须由服务端记录预扣费')
  if (cost < 0)
    throw new Error('申请费用无效')

  const minimumBaseCost = Math.floor(expectedApplicationBaseCost(application) * SQUARE_MIN_DISCOUNT_RATE)
  if (minimumBaseCost > 0 && cost < minimumBaseCost)
    throw new Error('申请费用低于服务端规则')
}

export async function appendTrustedPointTransaction(env: WorkerEnv, state: unknown, input: Parameters<typeof appendPointTransaction>[1]) {
  await appendPointTransaction(env, input, state)
}

export async function hasPointTransaction(env: WorkerEnv, id: string) {
  await ensurePointTransactionSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select id from point_transactions where id = ?1')
      .bind(id)
      .first<{ id: string }>()
    return !!row
  }

  const result = await getPool(env).query<{ id: string }>('select id from point_transactions where id = $1', [id])
  return !!result.rows[0]
}

export async function applyTrustedPointTransactionsFromState(env: WorkerEnv, previousState: unknown, nextState: unknown, userId: string) {
  if (!isRecord(previousState) || !isRecord(nextState))
    return

  const previousApplications = recordMap(previousState.applications)
  for (const application of arrayRecords(nextState.applications)) {
    if (application.userId !== userId)
      continue

    const previousApplication = previousApplications.get(application.id as string)
    if (previousApplication) {
      if (previousApplication.status !== 'draft' || application.type !== 'resource' || application.status !== 'in_review' || application.costCharged !== true)
        continue
    }
    else {
      assertTrustedNewApplication(application, userId)
      if (application.type === 'resource' && application.status === 'draft')
        continue
    }

    const applicationId = application.id as string
    const cost = Math.trunc(numberField(application, 'cost'))
    if (cost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: pointTransactionId('application_cost', applicationId),
        userId,
        delta: -cost,
        type: 'spend',
        reason: `${String(application.type || '申请').toUpperCase()} 申请预扣`,
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }

    const storageExtensionCost = Math.trunc(numberField(application, 'storageExtensionCost', boolField(application, 'storageExtended') ? STORAGE_EXTENSION_COST : 0))
    if (storageExtensionCost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: pointTransactionId('storage_extension', applicationId),
        userId,
        delta: -storageExtensionCost,
        type: 'spend',
        reason: '延长申请存储服务 7 天预扣',
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }

    const expediteCost = Math.trunc(numberField(application, 'expediteCost', boolField(application, 'expedited') ? PRO_EXPEDITE_COST : 0))
    if (expediteCost > 0) {
      await appendTrustedPointTransaction(env, previousState, {
        id: pointTransactionId('expedite', applicationId),
        userId,
        delta: -expediteCost,
        type: 'spend',
        reason: 'Pro 处理加速预扣',
        refId: applicationId,
        createdAt: typeof application.createdAt === 'string' ? application.createdAt : now(),
      })
    }
  }

  const previousVerifications = recordMap(previousState.studentVerifications)
  for (const verification of arrayRecords(nextState.studentVerifications)) {
    if (previousVerifications.has(verification.id as string) || verification.userId !== userId)
      continue
    if (verification.status !== 'pending' || boolField(verification, 'feeReturned'))
      throw new Error('认证申请状态无效')

    const verificationId = verification.id as string
    const reviewFee = Math.trunc(numberField(verification, 'reviewFee', STUDENT_REVIEW_FEE))
    if (reviewFee !== STUDENT_REVIEW_FEE)
      throw new Error('认证审核费无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: pointTransactionId('student_review', verificationId),
      userId,
      delta: -STUDENT_REVIEW_FEE,
      type: 'spend',
      reason: '认证审核费',
      refId: verificationId,
      createdAt: typeof verification.createdAt === 'string' ? verification.createdAt : now(),
    })
  }

  const previousCheckIns = recordMap(previousState.dailyCheckIns)
  for (const checkIn of arrayRecords(nextState.dailyCheckIns)) {
    if (previousCheckIns.has(checkIn.id as string) || checkIn.userId !== userId)
      continue
    const points = Math.trunc(numberField(checkIn, 'points'))
    if (points < 1 || points > DAILY_CHECK_IN_MAX_POINTS)
      throw new Error('签到奖励积分无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: pointTransactionId('daily_checkin', checkIn.id as string),
      userId,
      delta: points,
      type: 'grant',
      reason: `每日签到奖励（连续 ${Math.max(1, Math.trunc(numberField(checkIn, 'streak', 1)))} 天）`,
      refId: checkIn.id as string,
      createdAt: typeof checkIn.createdAt === 'string' ? checkIn.createdAt : now(),
    })
  }

  const previousBoosts = recordMap(previousState.squareBoosts)
  for (const boost of arrayRecords(nextState.squareBoosts)) {
    if (previousBoosts.has(boost.id as string) || boost.userId !== userId)
      continue
    const mode = typeof boost.mode === 'string' ? boost.mode : 'boost'
    const pointsGranted = Math.trunc(numberField(boost, 'pointsGranted'))
    if (mode === 'post_approval_vote') {
      if (pointsGranted !== 0)
        throw new Error('结束后助力投票不能发放积分')
      continue
    }
    if (pointsGranted !== SQUARE_BOOST_REWARD_POINTS)
      throw new Error('助力奖励积分无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: pointTransactionId('square_boost', boost.id as string),
      userId,
      delta: SQUARE_BOOST_REWARD_POINTS,
      type: 'grant',
      reason: '广场拼一刀助力奖励',
      refId: boost.id as string,
      createdAt: typeof boost.createdAt === 'string' ? boost.createdAt : now(),
    })
  }

  const previousReports = recordMap(previousState.squareReports)
  const previousBoostById = recordMap(previousState.squareBoosts)
  const nextBoostById = recordMap(nextState.squareBoosts)
  for (const report of arrayRecords(nextState.squareReports)) {
    if (previousReports.has(report.id as string) || report.reporterId !== userId)
      continue
    const boostId = typeof report.boostId === 'string' ? report.boostId : ''
    const previousBoost = previousBoostById.get(boostId)
    const nextBoost = nextBoostById.get(boostId)
    if (!previousBoost || !nextBoost || previousBoost.penaltyApplied === true || nextBoost.penaltyApplied !== true || nextBoost.reportedBy !== userId)
      throw new Error('举报扣分状态无效')
    const targetUserId = typeof previousBoost.userId === 'string' ? previousBoost.userId : ''
    if (!targetUserId || targetUserId === userId)
      throw new Error('举报目标无效')

    await appendTrustedPointTransaction(env, previousState, {
      id: pointTransactionId('square_report_penalty', boostId),
      userId: targetUserId,
      delta: -SQUARE_BOOST_REPORT_PENALTY_POINTS,
      type: 'spend',
      reason: '广场助力被举报扣除积分',
      refId: boostId,
      createdAt: typeof report.createdAt === 'string' ? report.createdAt : now(),
      allowDebt: true,
    })
  }

  const previousUsers = arrayRecords(previousState.users)
  const pointsByUser = new Map(previousUsers.map(user => [user.id as string, user.points]))
  if (Array.isArray(nextState.users)) {
    for (const user of nextState.users) {
      if (isRecord(user) && typeof user.id === 'string' && pointsByUser.has(user.id))
        user.points = pointsByUser.get(user.id)
    }
  }
  nextState.transactions = []
}
