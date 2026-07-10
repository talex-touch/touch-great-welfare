import type { WorkerEnv } from './env'
import type { User, WelfareState } from '~/shared/welfare-types'
import { authenticatedUserId } from '../session'
import { stateUsers } from './users'

export type { WorkerEnv } from './env'
export { sanitizeUser } from './users'

export async function requestUserId(request: Request, env: WorkerEnv) {
  return await authenticatedUserId(request, env)
}

export async function requireRequestUserId(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')
  return userId
}

export async function authenticatedUser(request: Request, env: WorkerEnv, state: Partial<WelfareState>) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const user = stateUsers(state).find(item => item.id === userId)
  if (!user || user.accountStatus === 'suspended')
    throw new Error('请先登录')

  return user
}

export function assertAdminUser(user: User) {
  if (user.role !== 'admin')
    throw new Error('需要管理员权限')
}
