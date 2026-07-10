import type { WorkerEnv } from './env'
import type { ReadWelfareStateOptions } from './state-store'
import type { WelfareState } from '~/shared/welfare-types'
import { readAllApplicationSnapshots, readAllCouponSnapshots } from './state-snapshots'
import { readWelfareStateRecord } from './state-store'

export async function readWelfareStateFromTables(env: WorkerEnv, options: ReadWelfareStateOptions = {}) {
  const record = await readWelfareStateRecord(env, options)
  const state = { ...(record.state as Partial<WelfareState>) }
  const [applications, coupons] = await Promise.all([
    readAllApplicationSnapshots(env),
    readAllCouponSnapshots(env),
  ])

  if (applications.stateVersion === record.version)
    state.applications = applications.items
  if (coupons.stateVersion === record.version)
    state.coupons = coupons.items

  return state
}
