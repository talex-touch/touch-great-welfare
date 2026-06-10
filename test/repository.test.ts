/**
 * Repository 层单元测试
 */

import type { Pool } from 'pg'
import type { User, WelfareApplication, WorkerEnv } from '../src/composables/welfare'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationRepository } from '../src/worker/welfare/core/repository/application-repository'
import { getMigrationConfig, setMigrationConfig } from '../src/worker/welfare/core/repository/base'
import { UserRepository } from '../src/worker/welfare/core/repository/user-repository'

// Mock Pool
function createMockPool() {
  const mockQuery = vi.fn()
  const mockConnect = vi.fn().mockResolvedValue({
    query: mockQuery,
    release: vi.fn(),
  })

  return {
    query: mockQuery,
    connect: mockConnect,
  } as unknown as Pool
}

// Mock Env
function createMockEnv(): WorkerEnv {
  return {
    HYPERDRIVE: {
      connectionString: 'postgresql://test',
    },
  } as unknown as WorkerEnv
}

describe('userRepository', () => {
  let userRepo: UserRepository
  let mockPool: Pool
  let mockEnv: WorkerEnv

  beforeEach(() => {
    mockPool = createMockPool()
    mockEnv = createMockEnv()
    userRepo = new UserRepository(mockEnv, mockPool)

    // 重置配置
    setMigrationConfig({
      writeMode: { target: 'state-only' },
      readMode: { source: 'state' },
      validation: { enabled: false, logMismatches: false },
    })
  })

  describe('readFromState', () => {
    it('should read user from state by id', () => {
      const state = {
        users: [
          { id: 'user1', email: 'test1@example.com', profile: { displayName: 'User 1' } },
          { id: 'user2', email: 'test2@example.com', profile: { displayName: 'User 2' } },
        ],
      }

      const user = userRepo.readFromState(state, 'user1')

      expect(user).toEqual({
        id: 'user1',
        email: 'test1@example.com',
        profile: { displayName: 'User 1' },
      })
    })

    it('should return null if user not found', () => {
      const state = { users: [] }
      const user = userRepo.readFromState(state, 'nonexistent')
      expect(user).toBeNull()
    })

    it('should return null if state.users is not an array', () => {
      const state = { users: null }
      const user = userRepo.readFromState(state, 'user1')
      expect(user).toBeNull()
    })
  })

  describe('writeToState', () => {
    it('should add new user to state', () => {
      const state = { users: [] }
      const user: User = {
        id: 'user1',
        email: 'test@example.com',
        role: 'user',
        accountStatus: 'active',
        points: 0,
        profile: {
          displayName: 'Test User',
          email: 'test@example.com',
        },
        createdAt: '2024-01-01T00:00:00Z',
      }

      userRepo.writeToState(state, user)

      expect(state.users).toHaveLength(1)
      expect(state.users[0]).toEqual(user)
    })

    it('should update existing user in state', () => {
      const state = {
        users: [
          {
            id: 'user1',
            email: 'old@example.com',
            profile: { displayName: 'Old Name' },
          },
        ],
      }

      const updatedUser: User = {
        id: 'user1',
        email: 'new@example.com',
        role: 'user',
        accountStatus: 'active',
        points: 100,
        profile: {
          displayName: 'New Name',
          email: 'new@example.com',
        },
        createdAt: '2024-01-01T00:00:00Z',
      }

      userRepo.writeToState(state, updatedUser)

      expect(state.users).toHaveLength(1)
      expect(state.users[0]).toEqual(updatedUser)
    })
  })

  describe('readFromTable', () => {
    it('should read user from table', async () => {
      const mockRow = {
        id: 'user1',
        email: 'test@example.com',
        password_hash: 'hash',
        display_name: 'Test User',
        avatar: null,
        bio: null,
        role: 'user',
        account_status: 'active',
        points: 100,
        github_username: null,
        github_authorized: false,
        selected_repo: null,
        student_verified: false,
        student_verified_at: null,
        invitation_code: null,
        invited_by_user_id: null,
        created_at: '2024-01-01T00:00:00Z',
        last_login_at: null,
      }

      vi.mocked(mockPool.query).mockResolvedValue({
        rows: [mockRow],
      } as any)

      const user = await userRepo.readFromTable('user1')

      expect(user).toMatchObject({
        id: 'user1',
        passwordHash: 'hash',
        role: 'user',
        accountStatus: 'active',
        points: 100,
        profile: {
          displayName: 'Test User',
          email: 'test@example.com',
          githubAuthorized: false,
          studentVerified: false,
        },
        createdAt: '2024-01-01T00:00:00Z',
        lastLoginAt: '2024-01-01T00:00:00Z',
      })

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE id = $1',
        ['user1'],
      )
    })

    it('should return null if user not in table', async () => {
      vi.mocked(mockPool.query).mockResolvedValue({ rows: [] } as any)

      const user = await userRepo.readFromTable('nonexistent')

      expect(user).toBeNull()
    })
  })

  describe('write with dual-write mode', () => {
    it('should write to both state and table in dual-write mode', async () => {
      setMigrationConfig({
        writeMode: { target: 'dual-write' },
      })

      const state = { users: [] }
      const user: User = {
        id: 'user1',
        email: 'test@example.com',
        role: 'user',
        accountStatus: 'active',
        points: 0,
        profile: {
          displayName: 'Test User',
          email: 'test@example.com',
        },
        createdAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(mockPool.query).mockResolvedValue({ rows: [] } as any)

      await userRepo.write(state, user)

      // Should write to state
      expect(state.users).toHaveLength(1)
      expect(state.users[0]).toEqual(user)

      // Should write to table
      expect(mockPool.query).toHaveBeenCalled()
    })

    it('should not fail if table write fails in dual-write mode', async () => {
      setMigrationConfig({
        writeMode: { target: 'dual-write' },
      })

      const state = { users: [] }
      const user: User = {
        id: 'user1',
        email: 'test@example.com',
        role: 'user',
        accountStatus: 'active',
        points: 0,
        profile: {
          displayName: 'Test User',
          email: 'test@example.com',
        },
        createdAt: '2024-01-01T00:00:00Z',
      }

      // Mock table write failure
      vi.mocked(mockPool.query).mockRejectedValue(new Error('DB Error'))

      // Should not throw
      await expect(userRepo.write(state, user)).resolves.not.toThrow()

      // State should still be updated
      expect(state.users).toHaveLength(1)
    })
  })
})

describe('applicationRepository', () => {
  let appRepo: ApplicationRepository
  let mockPool: Pool
  let mockEnv: WorkerEnv

  beforeEach(() => {
    mockPool = createMockPool()
    mockEnv = createMockEnv()
    appRepo = new ApplicationRepository(mockEnv, mockPool)

    setMigrationConfig({
      writeMode: { target: 'state-only' },
      readMode: { source: 'state' },
      validation: { enabled: false, logMismatches: false },
    })
  })

  describe('readFromState', () => {
    it('should read application from state', () => {
      const state = {
        applications: [
          {
            id: 'app1',
            userId: 'user1',
            type: 'code',
            status: 'pending_review',
            title: 'Test Application',
          },
        ],
      }

      const app = appRepo.readFromState(state, 'app1')

      expect(app).toEqual({
        id: 'app1',
        userId: 'user1',
        type: 'code',
        status: 'pending_review',
        title: 'Test Application',
      })
    })
  })

  describe('writeToState', () => {
    it('should add new application to state', () => {
      const state = { applications: [] }
      const app: WelfareApplication = {
        id: 'app1',
        userId: 'user1',
        type: 'code',
        status: 'draft',
        title: 'Test',
        description: 'Test description',
        baseCost: 100,
        cost: 100,
        costCharged: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      appRepo.writeToState(state, app)

      expect(state.applications).toHaveLength(1)
      expect(state.applications[0]).toEqual(app)
    })
  })

  describe('findByUserId', () => {
    it('should find applications by user id', async () => {
      vi.mocked(mockPool.query)
        .mockResolvedValueOnce({
          rows: [{ id: 'app1' }, { id: 'app2' }],
        } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'app1',
            user_id: 'user1',
            type: 'code',
            status: 'completed',
            title: 'App 1',
            description: 'Description 1',
            base_cost: 100,
            cost: 100,
            cost_charged: true,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          }],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any) // attachments
        .mockResolvedValueOnce({ rows: [] } as any) // messages
        .mockResolvedValueOnce({ rows: [] } as any) // items
        .mockResolvedValueOnce({
          rows: [{
            id: 'app2',
            user_id: 'user1',
            type: 'image',
            status: 'pending_review',
            title: 'App 2',
            description: 'Description 2',
            base_cost: 200,
            cost: 200,
            cost_charged: false,
            created_at: '2024-01-02',
            updated_at: '2024-01-02',
          }],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any) // attachments
        .mockResolvedValueOnce({ rows: [] } as any) // messages
        .mockResolvedValueOnce({ rows: [] } as any) // items

      const apps = await appRepo.findByUserId('user1', 10)

      expect(apps).toHaveLength(2)
      expect(apps[0].id).toBe('app1')
      expect(apps[1].id).toBe('app2')
    })
  })
})

describe('migration Config', () => {
  it('should update migration config', () => {
    setMigrationConfig({
      writeMode: { target: 'dual-write' },
      readMode: { source: 'canary', canaryPercentage: 50 },
    })

    const config = getMigrationConfig()

    expect(config.writeMode.target).toBe('dual-write')
    expect(config.readMode.source).toBe('canary')
    expect(config.readMode.canaryPercentage).toBe(50)
  })

  it('should merge partial config', () => {
    setMigrationConfig({
      writeMode: { target: 'dual-write' },
    })

    setMigrationConfig({
      readMode: { source: 'table' },
    })

    const config = getMigrationConfig()

    expect(config.writeMode.target).toBe('dual-write')
    expect(config.readMode.source).toBe('table')
  })
})
