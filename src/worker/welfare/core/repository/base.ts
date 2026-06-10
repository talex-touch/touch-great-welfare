/**
 * Repository 抽象层 - 数据访问统一接口
 *
 * 核心功能：
 * 1. 支持双写模式（JSONB + 规范化表）
 * 2. 支持灰度切换读取源
 * 3. 数据一致性保证
 */

import type { Pool } from 'pg'
import type { WorkerEnv } from '../../core'

// 迁移配置
export interface MigrationConfig {
  writeMode: {
    target: 'state-only' | 'dual-write' | 'table-only'
  }
  readMode: {
    source: 'state' | 'table' | 'canary'
    canaryPercentage?: number // 0-100，灰度读取比例
  }
  validation: {
    enabled: boolean // 是否启用一致性验证
    logMismatches: boolean // 是否记录不一致
  }
}

// 默认配置：Phase 2 初期状态
export const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
  writeMode: {
    target: 'dual-write', // 同时写 state 和 table
  },
  readMode: {
    source: 'state', // 仍从 state 读取
  },
  validation: {
    enabled: true,
    logMismatches: true,
  },
}

// 全局配置（可通过环境变量覆盖）
let currentConfig: MigrationConfig = { ...DEFAULT_MIGRATION_CONFIG }

export function setMigrationConfig(config: Partial<MigrationConfig>) {
  currentConfig = {
    ...currentConfig,
    ...config,
    writeMode: config.writeMode ? { ...currentConfig.writeMode, ...config.writeMode } : currentConfig.writeMode,
    readMode: config.readMode ? { ...currentConfig.readMode, ...config.readMode } : currentConfig.readMode,
    validation: config.validation ? { ...currentConfig.validation, ...config.validation } : currentConfig.validation,
  }
}

export function getMigrationConfig(): MigrationConfig {
  return currentConfig
}

function stableHashBucket(value: string) {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 100
}

// 灰度决策：根据 userId 决定是否从表读取
export function shouldReadFromTable(userId: string): boolean {
  const config = currentConfig.readMode

  if (config.source === 'table')
    return true
  if (config.source === 'state')
    return false

  // Canary 模式：根据 userId 哈希决定
  const percentage = config.canaryPercentage || 0
  if (percentage <= 0)
    return false
  if (percentage >= 100)
    return true

  return stableHashBucket(userId) < percentage
}

// Repository 基类
export abstract class BaseRepository<T> {
  protected env: WorkerEnv
  protected pool: Pool

  constructor(env: WorkerEnv, pool: Pool) {
    this.env = env
    this.pool = pool
  }

  // 子类需要实现的方法
  abstract readFromState(state: any, id: string): T | null
  abstract writeToState(state: any, entity: T): void
  abstract readFromTable(id: string): Promise<T | null>
  abstract writeToTable(entity: T): Promise<void>

  // 统一的读取接口
  async read(state: any, id: string, userId?: string): Promise<T | null> {
    const config = getMigrationConfig()

    // 决定读取源
    const useTable = userId ? shouldReadFromTable(userId) : false

    if (useTable) {
      try {
        const result = await this.readFromTable(id)

        // 如果启用验证，对比两边数据
        if (config.validation.enabled) {
          const stateResult = this.readFromState(state, id)
          this.validateConsistency(id, stateResult, result)
        }

        return result
      }
      catch (error) {
        console.error(`[Repository] Read from table failed, fallback to state:`, error)
        return this.readFromState(state, id)
      }
    }

    return this.readFromState(state, id)
  }

  // 统一的写入接口
  async write(state: any, entity: T): Promise<void> {
    const config = getMigrationConfig()

    switch (config.writeMode.target) {
      case 'state-only':
        this.writeToState(state, entity)
        break

      case 'table-only':
        await this.writeToTable(entity)
        break

      case 'dual-write':
        // 双写：先写 state，再写 table
        this.writeToState(state, entity)
        try {
          await this.writeToTable(entity)
        }
        catch (error) {
          console.error(`[Repository] Dual-write to table failed:`, error)
          // 不抛出错误，保证 state 写入成功
        }
        break
    }
  }

  // 数据一致性验证
  protected validateConsistency(id: string, stateData: T | null, tableData: T | null) {
    const config = getMigrationConfig()
    if (!config.validation.logMismatches)
      return

    // 简单对比：JSON 序列化后比较
    const stateJson = JSON.stringify(stateData)
    const tableJson = JSON.stringify(tableData)

    if (stateJson !== tableJson) {
      console.warn(
        `[Repository] Data mismatch for ${this.constructor.name}:${id}`,
        `\nState: ${stateJson.slice(0, 100)}...`,
        `\nTable: ${tableJson.slice(0, 100)}...`,
      )
    }
  }
}
