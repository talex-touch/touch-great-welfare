import type { WorkerEnv } from './core'
import type { WelfareState } from '~/shared/welfare-types'
import { applyWelfareRetentionPolicy } from '../../shared/welfare-retention'
import { dispatchWelfareStateChangeNotifications } from '../notifications'
import { syncUserPointBalancesFromLedger } from '../points'
import {
  forbidden,
  isRecord,
  json,
  readPayload,
  readWelfareStateRecord,
  requestUserId,
  StateVersionConflictError,
  writeWelfareState,
} from './core'
import {
  assertStateShape,
  isAdminUser,
  mergeSensitiveWelfareState,
} from './legacy-state-compat'

function changedPointUserIds(previousState: Partial<WelfareState>, nextState: unknown) {
  if (!isRecord(nextState) || !Array.isArray(nextState.users))
    return []

  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const previousPointsByUserId = new Map(previousUsers.map(user => [user.id, user.points]))
  const userIds = new Set<string>()

  for (const user of nextState.users) {
    if (!isRecord(user) || typeof user.id !== 'string')
      continue

    const previousPoints = previousPointsByUserId.get(user.id)
    if (previousPoints !== undefined && user.points !== previousPoints)
      userIds.add(user.id)
  }

  return Array.from(userIds)
}

function preserveServerPointState(previousState: Partial<WelfareState>, nextState: unknown) {
  if (!isRecord(nextState))
    return

  nextState.transactions = []
  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const previousPointsByUserId = new Map(previousUsers.map(user => [user.id, user.points]))
  if (!Array.isArray(nextState.users))
    return

  for (const user of nextState.users) {
    if (!isRecord(user) || typeof user.id !== 'string')
      continue

    const points = previousPointsByUserId.get(user.id)
    if (points !== undefined)
      user.points = points
  }
}

export async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  if (env.ENABLE_LEGACY_STATE_WRITE !== 'true') {
    return json({
      code: 'LEGACY_STATE_WRITE_FROZEN',
      error: '旧版全量状态保存入口已冻结，请使用分段业务接口',
    }, 410)
  }

  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')
  const previousRecord = await readWelfareStateRecord(env)
  const previousState = previousRecord.state as Partial<WelfareState>
  const currentVersion = previousRecord.version
  if (!isAdminUser(previousState, userId))
    return forbidden('全量状态保存仅允许管理员使用')

  const payload = await readPayload(request) as { state?: unknown, version?: unknown }
  const expectedVersion = Math.trunc(Number(payload.version))
  if (!Number.isFinite(expectedVersion) || expectedVersion <= 0) {
    return json({
      code: 'STATE_VERSION_REQUIRED',
      error: '保存业务状态必须携带有效 version',
    }, 400)
  }
  if (expectedVersion !== currentVersion)
    throw new StateVersionConflictError()
  assertStateShape(payload.state)
  const statePayload = payload.state
  const pointUserIds = changedPointUserIds(previousState, statePayload)
  if (pointUserIds.length)
    await syncUserPointBalancesFromLedger(env, previousState, pointUserIds)

  const mergedSensitiveState = await mergeSensitiveWelfareState(previousState, statePayload, request, env)
  preserveServerPointState(previousState, mergedSensitiveState)
  const nextState = applyWelfareRetentionPolicy(mergedSensitiveState).state
  if (isRecord(nextState))
    delete nextState.currentUserId
  const nextVersion = await writeWelfareState(env, nextState, { expectedVersion })
  await dispatchWelfareStateChangeNotifications(env, previousState, nextState as Partial<WelfareState>)
  return json({ ok: true, version: nextVersion })
}
