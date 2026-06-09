/**
 * Repository 工厂 - 统一创建和管理所有 Repository
 */

import type { Pool } from 'pg'
import type { WorkerEnv } from '~/composables/welfare'
import { UserRepository } from './user-repository'
import { ApplicationRepository } from './application-repository'
import { getMigrationConfig, setMigrationConfig } from './base'

export { setMigrationConfig, getMigrationConfig }
export type { MigrationConfig } from './base'

/**
 * Repository 容器
 */
export class RepositoryContainer {
  public users: UserRepository
  public applications: ApplicationRepository

  constructor(env: WorkerEnv, pool: Pool) {
    this.users = new UserRepository(env, pool)
    this.applications = new ApplicationRepository(env, pool)
  }
}

/**
 * 创建 Repository 容器
 */
export function createRepositories(env: WorkerEnv, pool: Pool): RepositoryContainer {
  return new RepositoryContainer(env, pool)
}

// 从环境变量读取迁移配置
export function loadMigrationConfigFromEnv(env: WorkerEnv) {
  // 可以通过环境变量覆盖配置
  // 例如：MIGRATION_WRITE_MODE=table-only
  //      MIGRATION_READ_SOURCE=table
  //      MIGRATION_CANARY_PERCENTAGE=50

  const writeMode = (env as any).MIGRATION_WRITE_MODE
  const readSource = (env as any).MIGRATION_READ_SOURCE
  const canaryPercentage = (env as any).MIGRATION_CANARY_PERCENTAGE

  if (writeMode || readSource || canaryPercentage) {
    setMigrationConfig({
      writeMode: writeMode ? { target: writeMode } : undefined,
      readMode: {
        source: readSource || 'state',
        canaryPercentage: canaryPercentage ? Number.parseInt(canaryPercentage, 10) : undefined,
      },
    })

    console.log('[Migration] Config loaded from env:', getMigrationConfig())
  }
}
