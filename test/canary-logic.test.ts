/**
 * 灰度切换逻辑测试
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { setMigrationConfig, shouldReadFromTable } from '../src/worker/welfare/core/repository/base'

describe('canary Logic', () => {
  beforeEach(() => {
    // 重置到默认配置
    setMigrationConfig({
      readMode: { source: 'state' },
    })
  })

  describe('shouldReadFromTable', () => {
    it('should return false when source is state', () => {
      setMigrationConfig({
        readMode: { source: 'state' },
      })

      expect(shouldReadFromTable('user1')).toBe(false)
      expect(shouldReadFromTable('user2')).toBe(false)
    })

    it('should return true when source is table', () => {
      setMigrationConfig({
        readMode: { source: 'table' },
      })

      expect(shouldReadFromTable('user1')).toBe(true)
      expect(shouldReadFromTable('user2')).toBe(true)
    })

    it('should return false when canary percentage is 0', () => {
      setMigrationConfig({
        readMode: {
          source: 'canary',
          canaryPercentage: 0,
        },
      })

      expect(shouldReadFromTable('user1')).toBe(false)
      expect(shouldReadFromTable('user2')).toBe(false)
    })

    it('should return true when canary percentage is 100', () => {
      setMigrationConfig({
        readMode: {
          source: 'canary',
          canaryPercentage: 100,
        },
      })

      expect(shouldReadFromTable('user1')).toBe(true)
      expect(shouldReadFromTable('user2')).toBe(true)
    })

    it('should distribute users consistently with canary percentage', () => {
      setMigrationConfig({
        readMode: {
          source: 'canary',
          canaryPercentage: 50,
        },
      })

      // 同一个用户 ID 应该总是返回相同的结果
      const result1 = shouldReadFromTable('user123')
      const result2 = shouldReadFromTable('user123')
      expect(result1).toBe(result2)

      // 测试多个用户
      const userIds = Array.from({ length: 100 }, (_, i) => `user${i}`)
      const tableReads = userIds.filter(id => shouldReadFromTable(id))

      // 大约 50% 应该从表读取（允许 ±20% 误差）
      const percentage = (tableReads.length / userIds.length) * 100
      expect(percentage).toBeGreaterThan(30)
      expect(percentage).toBeLessThan(70)
    })

    it('should have consistent hash for same user id', () => {
      setMigrationConfig({
        readMode: {
          source: 'canary',
          canaryPercentage: 25,
        },
      })

      // 多次调用应该返回相同结果
      const userId = 'consistent-user-123'
      const results = Array.from({ length: 10 }, () => shouldReadFromTable(userId))

      // 所有结果应该相同
      expect(new Set(results).size).toBe(1)
    })
  })
})

describe('canary Distribution', () => {
  it('should distribute users evenly with 10% canary', () => {
    setMigrationConfig({
      readMode: {
        source: 'canary',
        canaryPercentage: 10,
      },
    })

    const userIds = Array.from({ length: 1000 }, (_, i) => `user${i}`)
    const tableReads = userIds.filter(id => shouldReadFromTable(id))
    const percentage = (tableReads.length / userIds.length) * 100

    // 应该接近 10%（允许 ±5% 误差）
    expect(percentage).toBeGreaterThan(5)
    expect(percentage).toBeLessThan(15)
  })

  it('should distribute users evenly with 50% canary', () => {
    setMigrationConfig({
      readMode: {
        source: 'canary',
        canaryPercentage: 50,
      },
    })

    const userIds = Array.from({ length: 1000 }, (_, i) => `user${i}`)
    const tableReads = userIds.filter(id => shouldReadFromTable(id))
    const percentage = (tableReads.length / userIds.length) * 100

    // 应该接近 50%（允许 ±10% 误差）
    expect(percentage).toBeGreaterThan(40)
    expect(percentage).toBeLessThan(60)
  })

  it('should handle edge case user ids', () => {
    setMigrationConfig({
      readMode: {
        source: 'canary',
        canaryPercentage: 50,
      },
    })

    // 边缘情况
    expect(() => shouldReadFromTable('')).not.toThrow()
    expect(() => shouldReadFromTable('a')).not.toThrow()
    expect(() => shouldReadFromTable('very-long-user-id-with-special-chars-123!@#$%')).not.toThrow()
  })
})
