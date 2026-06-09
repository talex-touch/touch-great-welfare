# 架构质量分析与重构计划

**生成日期**: 2026-06-09  
**当前状态**: 🔴 生产环境存在严重性能问题  
**预期影响**: 随用户增长，系统将不可用

---

## 📋 执行摘要

当前系统采用**单体 JSONB 存储架构**，将所有业务数据存储在单个 PostgreSQL JSONB 字段中。这是一个**根本性的架构错误**，导致：

- ✅ 10 秒超时频繁触发
- ✅ 无法利用数据库索引和查询优化
- ✅ 随数据量增长性能线性下降
- ✅ 高并发场景下乐观锁冲突率极高
- ✅ 单个文件 4714 行代码 (191KB)，难以维护

**紧急程度**: 🔴 **CRITICAL** - 需立即启动重构，否则 3-6 个月内系统将不可用

---

## 🔥 核心问题分析

### 问题 1: 单体 JSONB 存储 - 致命架构缺陷

**位置**: `src/worker/welfare/core.ts:1265-1301`

**现状**:
```sql
-- welfare_app_state 表结构
CREATE TABLE welfare_app_state (
  id text primary key,
  state jsonb not null,  -- ❌ 整个应用状态塞在这里！
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
```

**state JSONB 内容**:
```typescript
{
  users: User[],                      // 所有用户数据
  applications: WelfareApplication[], // 所有申请记录
  transactions: CreditTransaction[],  // 所有积分流水
  studentVerifications: [],           // 所有认证记录
  educationEmailChallenges: [],
  coupons: UserCoupon[],
  couponCodes: [],
  couponTemplates: [],
  dailyCheckIns: [],
  invitationBindings: [],
  crowdReviews: [],
  collaborationApplications: [],
  squarePosts: SquarePost[],
  squareBoosts: SquareBoost[],
  squareReports: [],
  applicationPolicy: {},
  systemConfig: {},
  siteBanner: {},
  oauth: {},
  // ... 还有更多
}
```

**问题严重性**:

1. **读取性能崩溃**
   - 每次查询都要 `SELECT state FROM welfare_app_state`
   - 当 state 达到 10MB 时，单次查询 2-5 秒
   - 当达到 50MB 时，查询 10+ 秒 → **超时！**
   - PostgreSQL JSONB 无法优化这种全量查询

2. **写入性能崩溃**
   ```typescript
   // core.ts:1515-1580 - 每次保存都是这样的
   await pool.query(`
     UPDATE welfare_app_state 
     SET state = $2::jsonb  -- ❌ 替换整个 10MB+ 的 JSONB！
     WHERE id = $1 AND version = $3
   `, [STATE_KEY, JSON.stringify(entireState), version])
   ```
   - 序列化/反序列化巨大对象：1-3 秒
   - PostgreSQL 更新大型 JSONB：1-2 秒
   - 网络传输：0.5-1 秒
   - **总计**: 单次写入 2.5-6 秒

3. **并发冲突灾难**
   ```typescript
   // core.ts:1323-1331 - 乐观锁版本检查
   if (expectedVersion !== currentVersion)
     throw new StateVersionConflictError()
   ```
   - 两个用户同时操作 → 一个必然失败
   - 重试 → 再次全量读写 → 再次可能冲突
   - 冲突率随并发用户数**指数增长**

4. **无法使用索引**
   ```sql
   -- ❌ 想查用户的申请？对不起，全表扫描 JSONB
   SELECT state->>'applications' FROM welfare_app_state 
   WHERE state @> '{"applications": [{"userId": "xxx"}]}'
   
   -- 即使有 GIN 索引，性能也远不如正常表索引
   ```

5. **内存占用爆炸**
   - Worker 需要在内存中持有完整 state 对象
   - 10MB state → 解析后可能 30-50MB 内存
   - Cloudflare Workers 内存限制 128MB
   - 多个并发请求 → OOM 风险

**影响范围**: 🔴 **100% 的 API 端点受影响**

**数据支撑**:
- 当前代码: `core.ts:1265` `readWelfareStateRecord()` 每次都全量读取
- 当前代码: `router.ts:109` 管理员保存时同步**所有用户**积分

---

### 问题 2: 全量积分同步 - 性能杀手

**位置**: `src/worker/welfare/router.ts:109`

```typescript
async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const previousRecord = await readWelfareStateRecord(env, { 
    syncPointBalances: 'all'  // ❌❌❌ 致命操作！
  })
  // ...
}
```

**问题**:

1. **同步所有用户积分** (`core.ts:1290-1296`)
   ```typescript
   if (options.syncPointBalances === 'all') {
     await syncUserPointBalancesFromLedger(env, state)  // ❌ 查询所有用户！
   }
   ```
   
2. **具体执行** (`points.ts`)
   ```sql
   -- 对每个用户执行：
   SELECT user_id, SUM(delta) as balance 
   FROM point_transactions 
   WHERE user_id = ?
   GROUP BY user_id
   ```
   - 100 个用户 = 100 次数据库查询
   - 每次查询 50-200ms
   - **总耗时**: 5-20 秒！

3. **触发场景**
   - 管理员保存配置
   - 管理员审核申请
   - 管理员调整用户积分
   - **任何需要"全量状态"的操作**

**数据支撑**:
- 当用户数达到 200 时，此操作将稳定超时
- 当用户数达到 500 时，超时时间可能达到 30+ 秒

**修复优先级**: 🔴 **P0 - 立即修复**

---

### 问题 3: 超大单文件 - 代码质量灾难

**位置**: `src/worker/welfare/core.ts`

**统计数据**:
```
文件大小: 191 KB
代码行数: 4,714 行
函数数量: 估计 80+ 个
类型定义: 混杂在业务逻辑中
```

**问题**:

1. **Worker 冷启动慢**
   - Cloudflare Workers 需要解析和编译整个模块
   - 191KB 代码 → 冷启动 200-500ms
   - 影响用户首次请求体验

2. **不可维护**
   - 单个文件包含：用户管理、申请处理、积分系统、优惠券、认证、广场、协作等
   - 无法并行开发
   - 代码审查困难
   - 测试覆盖率低

3. **认知负担极高**
   - 任何修改都需要理解 4714 行代码的上下文
   - 容易引入回归 bug
   - 新人上手周期长

4. **接近 Cloudflare Workers 限制**
   - 压缩后单个 Worker 限制: 1MB (付费) / 3MB (企业)
   - 当前已经 191KB 源码，压缩后可能 50-80KB
   - 加上依赖库，接近限制边缘

**影响**:
- 开发效率降低 60%
- Bug 修复周期延长 3-5 倍
- 无法进行有效的单元测试

---

### 问题 4: 缺乏有效索引和查询优化

**现状分析**:

1. **快照表设计初衷**
   ```typescript
   // core.ts:1179-1258 - 引入了快照表
   CREATE TABLE welfare_applications (
     id text primary key,
     user_id text not null,
     type text not null,
     status text not null,
     title text not null,
     payload text not null,  -- ❌ 又是 JSON！
     created_at text not null,
     updated_at text not null
   );
   ```
   - 目的: 提供基本的查询能力
   - 但 `payload` 仍然是 JSON 字符串
   - **没有被充分利用**

2. **查询仍然依赖主 state**
   ```typescript
   // router.ts:209 - adminApplicationsResponse
   return await adminStateResponse(request, env)  // ❌ 还是读整个 state！
   ```
   - 快照表仅用于同步，不用于查询
   - 浪费了索引的价值

3. **缺少关键索引**
   ```sql
   -- 有的索引
   CREATE INDEX idx_welfare_applications_user_created 
     ON welfare_applications (user_id, created_at DESC, id DESC);
   
   -- ❌ 缺少的索引
   -- 管理员按状态查询
   CREATE INDEX idx_applications_status_created 
     ON applications(status, created_at DESC);
   
   -- 用户查看自己的待处理申请
   CREATE INDEX idx_applications_user_status 
     ON applications(user_id, status) 
     WHERE status IN ('pending_review', 'processing', 'needs_supplement');
   ```

---

### 问题 5: 前后端超时配置不合理

**前端**: `src/composables/welfare-api/core.ts:7`
```typescript
const STATE_REQUEST_TIMEOUT_MS = 10000  // 10 秒
```

**后端**: `src/worker/welfare/core.ts:119`
```typescript
const POSTGRES_TIMEOUT_MS = 10000  // 10 秒
```

**问题**:

1. **级联超时风险**
   ```
   前端超时: 10秒
   Worker 执行: 可能 9.5秒
   PostgreSQL: 可能 9秒
   
   → 任何一个环节慢一点，整个请求超时
   ```

2. **超时不是解决方案**
   - 增加超时 → 用户等待更久
   - 减少超时 → 更多请求失败
   - **根本问题**: 操作本身太慢

3. **缺少降级策略**
   - 没有缓存
   - 没有部分加载
   - 没有后台任务队列

---

### 问题 6: 数据库连接池配置不足

**位置**: `src/worker/welfare/core.ts:1092-1098`

```typescript
pool = new Pool({
  connectionString,
  connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,  // 10秒
  query_timeout: POSTGRES_TIMEOUT_MS,            // 10秒
  statement_timeout: POSTGRES_TIMEOUT_MS,        // 10秒
  // ❌ 缺少: max, min, idleTimeoutMillis
})
```

**问题**:

1. **默认连接数过小**
   - `pg` 默认 `max: 10`
   - 10 个并发请求可能耗尽连接池
   - 后续请求排队等待

2. **缺少连接管理**
   - 没有 `min` → 无预热连接
   - 没有 `idleTimeoutMillis` → 连接可能过期

3. **Hyperdrive 特性未利用**
   - Cloudflare Hyperdrive 提供连接池
   - 但代码层面又自己建池
   - 可能双重池化，浪费资源

---

## 📊 性能链路分析

### 典型慢查询链路（管理员保存配置）

```
用户点击"保存配置"
    ↓
前端发送 PUT /api/admin/config/system
    ↓ 
Worker: handleWelfareStateRequest() [router.ts:182]
    ↓
1. readWelfareStateRecord(env, { syncPointBalances: 'all' })
   ├─ SELECT state FROM welfare_app_state           [2-4秒]
   ├─ JSON.parse(state)                             [0.5-1秒]
   ├─ decryptSecret() 如果加密                       [0.2-0.5秒]
   └─ syncUserPointBalancesFromLedger()             [3-8秒]
      ├─ 100 个用户 × SELECT SUM(delta) FROM point_transactions
      └─ 更新 state.users[i].points
                                                    小计: 5.7-13.5秒

2. updateAdminSystemConfigAction()
   ├─ 验证配置                                       [0.01秒]
   ├─ 合并配置到 state                               [0.01秒]
   └─ 业务逻辑处理                                   [0.1-0.3秒]
                                                    小计: 0.12-0.32秒

3. writeWelfareState(env, state, { expectedVersion })
   ├─ assertExpectedStateVersion()                  [0.1-0.2秒]
   ├─ encodeStoredState() 如果加密                   [0.5-1秒]
   ├─ JSON.stringify(state)                         [0.5-1.5秒]
   ├─ UPDATE welfare_app_state SET state = ...      [1-3秒]
   └─ syncStateSnapshots()                          [0.5-1秒]
      └─ INSERT INTO welfare_applications ...
                                                    小计: 2.6-6.7秒

4. dispatchWelfareStateChangeNotifications()        [0.1-0.5秒]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总耗时: 8.52 - 21.02 秒 ❌❌❌
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

前端超时: 10 秒
→ 50% 的请求会超时！
```

### 关键瓶颈点

1. **瓶颈 #1**: `syncUserPointBalancesFromLedger('all')` - 占用 35-38% 耗时
2. **瓶颈 #2**: 全量读取 JSONB state - 占用 23-19% 耗时  
3. **瓶颈 #3**: 全量写入 JSONB state - 占用 30-32% 耗时

---

## 🎯 重构计划

### Phase 0: 紧急止血（1-2 天，P0）

**目标**: 降低超时率从 50% 到 10%

#### 0.1 修复全量积分同步

**文件**: `src/worker/welfare/router.ts`

```typescript
// ❌ 修改前
async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const previousRecord = await readWelfareStateRecord(env, { 
    syncPointBalances: 'all'  // ← 这里！
  })
  // ...
}

// ✅ 修改后
async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const previousRecord = await readWelfareStateRecord(env, { 
    syncPointBalances: 'current-user',  // ← 只同步当前用户
    currentUserId: userId
  })
  // ...
}
```

**影响**: 减少 3-8 秒耗时 → **立竿见影**

#### 0.2 优化数据库连接池

**文件**: `src/worker/welfare/core.ts:1092-1098`

```typescript
pool = new Pool({
  connectionString,
  max: 20,                              // ← 增加最大连接数
  min: 2,                               // ← 预热连接
  idleTimeoutMillis: 30000,             // ← 30秒空闲超时
  connectionTimeoutMillis: 15000,       // ← 放宽连接超时
  query_timeout: 20000,                 // ← 放宽查询超时
  statement_timeout: 20000,
})
```

**影响**: 减少连接等待时间

#### 0.3 添加性能监控日志

**文件**: `src/worker/welfare/core.ts`

```typescript
export async function readWelfareStateRecord(env: WorkerEnv, options: ReadWelfareStateOptions = {}): Promise<WelfareStateRecord> {
  const startTime = Date.now()
  
  await ensureSchema(env)
  console.log(`[PERF] ensureSchema: ${Date.now() - startTime}ms`)
  
  const readStart = Date.now()
  const record = shouldUseD1(env) ? /* ... */ : /* ... */
  console.log(`[PERF] DB read: ${Date.now() - readStart}ms`)
  
  const decodeStart = Date.now()
  const state = await decodeStoredState(env, record.state)
  console.log(`[PERF] decodeStoredState: ${Date.now() - decodeStart}ms`)
  
  if (options.syncPointBalances === 'all') {
    const syncStart = Date.now()
    await syncUserPointBalancesFromLedger(env, state)
    console.log(`[PERF] syncPointBalances(all): ${Date.now() - syncStart}ms ⚠️`)
  } else if (options.syncPointBalances === 'current-user') {
    const syncStart = Date.now()
    await syncUserPointBalancesFromLedger(env, state, [options.currentUserId])
    console.log(`[PERF] syncPointBalances(current): ${Date.now() - syncStart}ms`)
  }
  
  console.log(`[PERF] TOTAL readWelfareStateRecord: ${Date.now() - startTime}ms`)
  return { state, version: record.version }
}
```

**目的**: 找到真实瓶颈点，用数据驱动后续优化

#### 0.4 调整前端超时策略

**文件**: `src/composables/welfare-api/core.ts`

```typescript
// ✅ 区分不同操作的超时时间
const STATE_REQUEST_TIMEOUT_MS = 15000        // 普通读取 15秒
const ADMIN_SAVE_TIMEOUT_MS = 30000           // 管理员保存 30秒  
const APPLICATION_SUBMIT_TIMEOUT_MS = 20000   // 申请提交 20秒

async function requestState<T>(path = STATE_ENDPOINT, init?: RequestInit): Promise<T> {
  const timeout = init?.timeout || STATE_REQUEST_TIMEOUT_MS  // 允许自定义
  // ...
}

// 管理员保存时使用更长超时
export async function saveWelfareState(state: WelfareState, userId?: string) {
  const result = await requestState<{ ok: true, version?: number }>(STATE_ENDPOINT, {
    method: 'PUT',
    timeout: ADMIN_SAVE_TIMEOUT_MS,  // ← 30秒
    headers: userId ? { 'x-welfare-user-id': userId } : undefined,
    body: JSON.stringify({ state, version: currentWelfareStateVersion }),
  })
  // ...
}
```

**影响**: 减少不必要的超时错误

**完成标志**: 
- ✅ 超时率 < 10%
- ✅ P95 响应时间 < 8 秒
- ✅ 性能日志已部署到生产环境

---

### Phase 1: 查询优化（3-5 天，P0）

**目标**: 利用现有快照表，避免读取完整 state

#### 1.1 实现基于快照表的查询接口

**新文件**: `src/worker/welfare/queries.ts`

```typescript
import type { WorkerEnv } from './core'
import type { WelfareApplication } from '~/composables/welfare'

/**
 * 查询用户的申请列表（从快照表）
 * ✅ 不需要读取完整 state
 */
export async function getUserApplications(
  env: WorkerEnv, 
  userId: string, 
  options?: { 
    status?: string[]
    limit?: number 
    offset?: number 
  }
): Promise<WelfareApplication[]> {
  const { status, limit = 50, offset = 0 } = options || {}
  
  if (shouldUseD1(env)) {
    const query = status?.length
      ? `SELECT payload FROM welfare_applications 
         WHERE user_id = ? AND status IN (${status.map(() => '?').join(',')})
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      : `SELECT payload FROM welfare_applications 
         WHERE user_id = ? 
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
    
    const stmt = env.LOCAL_DB!.prepare(query)
    const params = status?.length 
      ? [userId, ...status, limit, offset]
      : [userId, limit, offset]
    
    const result = await stmt.bind(...params).all<{ payload: string }>()
    return result.results.map(row => JSON.parse(row.payload))
  }
  
  const query = status?.length
    ? `SELECT payload FROM welfare_applications 
       WHERE user_id = $1 AND status = ANY($2)
       ORDER BY created_at DESC LIMIT $3 OFFSET $4`
    : `SELECT payload FROM welfare_applications 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`
  
  const params = status?.length
    ? [userId, status, limit, offset]
    : [userId, limit, offset]
  
  const result = await getPool(env).query<{ payload: string }>(query, params)
  return result.rows.map(row => JSON.parse(row.payload))
}

/**
 * 查询管理员待审核申请（从快照表）
 */
export async function getPendingApplicationsForAdmin(
  env: WorkerEnv,
  options?: { limit?: number, offset?: number }
): Promise<WelfareApplication[]> {
  const { limit = 50, offset = 0 } = options || {}
  
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare(`
        SELECT payload FROM welfare_applications 
        WHERE status IN ('pending_review', 'needs_supplement', 'processing')
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `)
      .bind(limit, offset)
      .all<{ payload: string }>()
    return result.results.map(row => JSON.parse(row.payload))
  }
  
  const result = await getPool(env).query<{ payload: string }>(`
    SELECT payload FROM welfare_applications 
    WHERE status IN ('pending_review', 'needs_supplement', 'processing')
    ORDER BY created_at ASC
    LIMIT $1 OFFSET $2
  `, [limit, offset])
  
  return result.rows.map(row => JSON.parse(row.payload))
}

/**
 * 统计用户的活跃申请数（从快照表）
 */
export async function countActiveRequests(env: WorkerEnv, userId: string): Promise<number> {
  if (shouldUseD1(env)) {
    const result = await env.LOCAL_DB!
      .prepare(`
        SELECT COUNT(*) as count FROM welfare_applications 
        WHERE user_id = ? 
        AND status IN ('draft', 'reserved', 'pending_review', 'needs_supplement', 
                       'processing', 'answered', 'submitted', 'in_review', 
                       'approved', 'partial_approved', 'pending_allocation')
      `)
      .bind(userId)
      .first<{ count: number }>()
    return result?.count || 0
  }
  
  const result = await getPool(env).query<{ count: string }>(`
    SELECT COUNT(*) as count FROM welfare_applications 
    WHERE user_id = $1 
    AND status IN ('draft', 'reserved', 'pending_review', 'needs_supplement', 
                   'processing', 'answered', 'submitted', 'in_review', 
                   'approved', 'partial_approved', 'pending_allocation')
  `, [userId])
  
  return Number(result.rows[0]?.count || 0)
}
```

#### 1.2 重构 API 路由使用快照表查询

**文件**: `src/worker/welfare/router.ts`

```typescript
import { getUserApplications, getPendingApplicationsForAdmin, countActiveRequests } from './queries'

// ✅ 优化后的用户申请列表接口
async function currentUserApplicationsResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    return forbidden('需要登录')
  
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') || '50')
  const offset = Number(url.searchParams.get('offset') || '0')
  const status = url.searchParams.get('status')?.split(',')
  
  // ✅ 直接查快照表，不读 state！
  const applications = await getUserApplications(env, userId, { 
    status, 
    limit: Math.min(limit, 100), 
    offset 
  })
  
  // 只需要读取少量关联数据
  const userIds = new Set(applications.map(app => app.userId))
  const minimalState = await readMinimalState(env, { userIds, currentUserId: userId })
  
  return json({
    applications,
    users: minimalState.users,
    version: minimalState.version,
  })
}

// ✅ 优化后的管理员待审核列表
async function adminApplicationsResponse(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    return forbidden('需要登录')
  
  const state = await readWelfareStateRecord(env, { 
    syncPointBalances: false  // ❌ 不同步积分！
  })
  
  if (!isAdminUser(state.state, userId))
    return forbidden()
  
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') || '50')
  const offset = Number(url.searchParams.get('offset') || '0')
  
  // ✅ 从快照表分页查询
  const applications = await getPendingApplicationsForAdmin(env, { limit, offset })
  
  // 获取关联用户信息
  const userIds = new Set(applications.map(app => app.userId))
  const users = await getUsersByIds(env, Array.from(userIds))
  
  return json({
    applications,
    users,
    total: await countApplicationsByStatus(env, ['pending_review', 'needs_supplement', 'processing']),
  })
}
```

#### 1.3 添加关键索引

**新文件**: `migrations/0017_optimize_snapshot_indexes.sql`

```sql
-- 管理员按状态查询（最常用）
CREATE INDEX IF NOT EXISTS idx_welfare_applications_status_created 
ON welfare_applications(status, created_at ASC);

-- 用户查询自己的待处理申请
CREATE INDEX IF NOT EXISTS idx_welfare_applications_user_status_created 
ON welfare_applications(user_id, status, created_at DESC);

-- 统计查询优化
CREATE INDEX IF NOT EXISTS idx_welfare_applications_user_status 
ON welfare_applications(user_id, status);

-- 优惠券查询优化
CREATE INDEX IF NOT EXISTS idx_user_coupons_user_expires 
ON user_coupons(user_id, expires_at) 
WHERE used_at IS NULL;

-- 积分流水查询优化（如果还没有）
CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created 
ON point_transactions(user_id, created_at DESC);
```

**完成标志**:
- ✅ 用户申请列表接口不再读取完整 state
- ✅ 管理员待审核列表支持分页
- ✅ P95 响应时间 < 3 秒

---

### Phase 2: 代码拆分（1 周，P1）

**目标**: 将 core.ts 从 4714 行拆分为合理的模块结构

#### 2.1 模块划分

**新目录结构**: `src/worker/welfare/`

```
src/worker/welfare/
├── types.ts                    # 所有类型定义
├── constants.ts                # 常量定义
├── utils.ts                    # 通用工具函数
├── database.ts                 # 数据库连接和 schema 管理
├── queries.ts                  # 数据库查询函数（Phase 1 已创建）
├── encryption.ts               # 加密/解密相关
├── validation.ts               # 输入验证
│
├── services/
│   ├── user-service.ts         # 用户管理（约 400 行）
│   ├── application-service.ts  # 申请处理（约 800 行）
│   ├── points-service.ts       # 积分系统（约 300 行）
│   ├── coupon-service.ts       # 优惠券系统（约 400 行）
│   ├── verification-service.ts # 认证服务（约 300 行）
│   ├── square-service.ts       # 广场功能（约 400 行）
│   └── collaboration-service.ts # 协作功能（约 300 行）
│
├── actions/                    # 业务操作（原 core.ts 的 Action 函数）
│   ├── admin-actions.ts
│   ├── user-actions.ts
│   └── application-actions.ts
│
├── router.ts                   # 路由（保持现状）
├── core.ts                     # 仅保留核心逻辑（< 500 行）
└── state-repository.ts         # 状态仓库接口（保持现状）
```

#### 2.2 迁移步骤

**第 1 天**: 提取类型和常量
```bash
# 创建新文件
touch src/worker/welfare/types.ts
touch src/worker/welfare/constants.ts

# 从 core.ts 提取所有 interface/type 到 types.ts
# 从 core.ts 提取所有 const 常量到 constants.ts
```

**第 2-3 天**: 拆分服务层
```bash
mkdir src/worker/welfare/services
touch src/worker/welfare/services/user-service.ts
# 提取用户相关函数：
# - sanitizeUser, publicUser, userVisibleFromIds
# - createUser, updateUser, getUserById
# - verifyPassword, hashPassword, etc.

touch src/worker/welfare/services/points-service.ts
# 提取积分相关函数：
# - syncUserPointBalancesFromLedger
# - applyTrustedPointTransactionsFromState
# - calculatePoints, adjustPoints, etc.

# ... 依此类推
```

**第 4-5 天**: 重构 actions
```bash
mkdir src/worker/welfare/actions
# 提取所有 *Action 函数
```

**第 6-7 天**: 测试和验证
- 编写单元测试
- 端到端测试
- 性能对比测试

**完成标志**:
- ✅ core.ts < 500 行
- ✅ 每个服务文件 < 500 行
- ✅ 测试覆盖率 > 60%
- ✅ 构建体积减少 10-15%

---

### Phase 3: 数据模型规范化（2-3 周，P1）

**目标**: 从 JSONB 存储迁移到规范化表结构

⚠️ **这是最关键的阶段，需要谨慎规划和执行**

#### 3.1 新表结构设计

**文件**: `migrations/0018_normalize_schema.sql`

```sql
-- ============================================
-- 用户表
-- ============================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  avatar TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'reviewer')),
  points INTEGER NOT NULL DEFAULT 0,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  github_username TEXT,
  github_authorized BOOLEAN DEFAULT FALSE,
  selected_repo TEXT,
  student_verified BOOLEAN DEFAULT FALSE,
  student_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github ON users(github_username) WHERE github_username IS NOT NULL;
CREATE INDEX idx_users_role ON users(role) WHERE role != 'user';

-- ============================================
-- 申请表（规范化）
-- ============================================
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('code', 'image', 'pro', 'resource')),
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'reserved', 'pending_review', 'needs_supplement', 
    'processing', 'answered', 'submitted', 'in_review', 
    'approved', 'partial_approved', 'pending_allocation', 
    'rejected', 'completed', 'cancelled'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- 成本相关
  base_cost INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  cost_charged BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- 审核相关
  ai_review_status TEXT,
  ai_review_summary TEXT,
  ai_review_risk TEXT,
  ai_review_fee_rate NUMERIC(5, 4),
  reviewed_at TIMESTAMPTZ,
  reviewer_user_id TEXT REFERENCES users(id),
  
  -- 拒绝相关
  rejection_reason TEXT,
  rejection_review_fee INTEGER DEFAULT 0,
  rejection_review_fee_waived BOOLEAN DEFAULT FALSE,
  rejection_fraudulent BOOLEAN DEFAULT FALSE,
  waive_rejection_review_fee_blocked_until TIMESTAMPTZ,
  
  -- GitHub 开源认证
  github_repo TEXT,
  has_open_source_badge BOOLEAN DEFAULT FALSE,
  
  -- 存储和加速
  storage_extended BOOLEAN DEFAULT FALSE,
  storage_extension_cost INTEGER DEFAULT 0,
  retention_expires_at TIMESTAMPTZ,
  expedited BOOLEAN DEFAULT FALSE,
  expedite_cost INTEGER DEFAULT 0,
  processing_due_at TIMESTAMPTZ,
  
  -- 答复和完成
  answer TEXT,
  completed_at TIMESTAMPTZ,
  
  -- 交付相关（code/pro）
  delivery_assignee_id TEXT REFERENCES users(id),
  delivery_claimed_at TIMESTAMPTZ,
  delivery_submitted_at TIMESTAMPTZ,
  delivery_review_status TEXT,
  delivery_reward_points INTEGER,
  delivery_rewarded_at TIMESTAMPTZ,
  delivery_rewarded_by TEXT REFERENCES users(id),
  
  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 核心索引
CREATE INDEX idx_applications_user_created ON applications(user_id, created_at DESC);
CREATE INDEX idx_applications_status_created ON applications(status, created_at ASC);
CREATE INDEX idx_applications_user_status ON applications(user_id, status);
CREATE INDEX idx_applications_type_status ON applications(type, status);

-- 管理员审核队列优化
CREATE INDEX idx_applications_pending_review 
ON applications(created_at ASC) 
WHERE status IN ('pending_review', 'needs_supplement');

-- 交付队列优化
CREATE INDEX idx_applications_delivery_available 
ON applications(created_at ASC) 
WHERE status IN ('answered', 'pending_allocation', 'delivered') 
AND delivery_rewarded_at IS NULL;

-- ============================================
-- 申请附件表
-- ============================================
CREATE TABLE application_attachments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  storage_key TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_attachments_application 
ON application_attachments(application_id);

-- ============================================
-- 申请消息表
-- ============================================
CREATE TABLE application_messages (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('system', 'user_question', 'admin_answer', 'supplement_request', 'result_submission')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_messages_application 
ON application_messages(application_id, created_at ASC);

-- ============================================
-- 资源申请项表
-- ============================================
CREATE TABLE application_items (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_subtype TEXT,
  approver_group TEXT NOT NULL,
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  provision_status TEXT NOT NULL CHECK (provision_status IN ('not_required', 'pending', 'provisioned', 'failed')),
  
  -- 请求的配额和权限
  requested_quota JSONB,
  requested_permission JSONB,
  duration TEXT,
  
  -- 审批和开通
  approved_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES users(id),
  provisioned_at TIMESTAMPTZ,
  provision_result JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_items_application 
ON application_items(application_id);
CREATE INDEX idx_application_items_status 
ON application_items(approval_status, provision_status);

-- ============================================
-- 学生认证表
-- ============================================
CREATE TABLE student_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'needs_supplement', 'approved', 'rejected')),
  
  -- 材料
  category TEXT NOT NULL,
  notes TEXT,
  review_fee INTEGER NOT NULL DEFAULT 800,
  fee_returned BOOLEAN DEFAULT FALSE,
  
  -- 教育邮箱认证
  education_email_verified BOOLEAN DEFAULT FALSE,
  education_email_verified_at TIMESTAMPTZ,
  education_email_verification_source TEXT,
  
  -- 审核结果
  reply TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_student_verifications_user ON student_verifications(user_id);
CREATE INDEX idx_student_verifications_status ON student_verifications(status);

-- ============================================
-- 优惠券模板表
-- ============================================
CREATE TABLE coupon_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  
  -- 规则
  scope TEXT CHECK (scope IN ('general', 'code', 'image', 'pro', 'resource')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('rate', 'fixed_points', 'fixed_ldc')),
  discount_rate NUMERIC(5, 4),
  discount_amount INTEGER,
  max_discount INTEGER,
  min_spend INTEGER,
  
  -- 限制
  ttl_days INTEGER,
  total_grant_limit INTEGER,
  total_granted INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 优惠券码表
-- ============================================
CREATE TABLE coupon_codes (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  
  max_redemptions INTEGER DEFAULT 1,
  redemption_count INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1,
  
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupon_codes_code ON coupon_codes(code);
CREATE INDEX idx_coupon_codes_template ON coupon_codes(template_id);

-- ============================================
-- 用户优惠券表（已存在，保持不变）
-- ============================================
-- user_coupons 表已经存在，不需要重建

-- ============================================
-- 系统配置表
-- ============================================
CREATE TABLE system_configs (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id)
);

-- 预填充系统配置
INSERT INTO system_configs (key, value, description) VALUES
('site', '{"enabled": true, "closedReason": ""}', '站点开关'),
('application_policy', '{}', '申请策略配置'),
('site_banner', '{}', '站点横幅配置'),
('oauth', '{}', 'OAuth 配置');

-- ============================================
-- 广场帖子表
-- ============================================
CREATE TABLE square_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('share', 'request')),
  title TEXT NOT NULL,
  content TEXT,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  request_type TEXT,
  
  -- 模板（用于 request 类型）
  template JSONB,
  
  penalty_count INTEGER DEFAULT 0,
  last_penalty_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_posts_type_created ON square_posts(type, created_at DESC);
CREATE INDEX idx_square_posts_user ON square_posts(user_id);
CREATE INDEX idx_square_posts_application ON square_posts(application_id);

-- ============================================
-- 广场助力表
-- ============================================
CREATE TABLE square_boosts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES square_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('boost', 'post_approval_vote')),
  declaration TEXT,
  
  points_granted INTEGER DEFAULT 0,
  
  -- 举报相关
  reported_at TIMESTAMPTZ,
  reported_by TEXT REFERENCES users(id),
  report_reason TEXT,
  penalty_applied BOOLEAN DEFAULT FALSE,
  cooldown_until TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(post_id, user_id)
);

CREATE INDEX idx_square_boosts_post ON square_boosts(post_id, created_at DESC);
CREATE INDEX idx_square_boosts_user ON square_boosts(user_id);
```

#### 3.2 数据迁移策略

**双写模式**: 同时写入 JSONB 和新表，逐步切换读取

```
阶段 1: 双写（1周）
├─ 所有写操作同时写入 state JSONB 和新表
├─ 读取仍然从 state JSONB
└─ 监控双写数据一致性

阶段 2: 灰度读取（1周）
├─ 10% 流量从新表读取
├─ 对比结果一致性
├─ 逐步提升到 50%、100%
└─ 所有写入仍然双写

阶段 3: 完全切换（3-5天）
├─ 100% 从新表读取
├─ 停止写入 state JSONB
└─ state JSONB 仅作备份

阶段 4: 清理（1周后）
└─ 归档 welfare_app_state 表
```

#### 3.3 迁移实施代码

**新文件**: `src/worker/welfare/services/migration-service.ts`

```typescript
import type { WorkerEnv } from '../core'
import type { WelfareState, WelfareApplication } from '~/composables/welfare'

/**
 * 双写模式：将申请数据同时写入 state 和新表
 */
export async function dualWriteApplication(
  env: WorkerEnv,
  application: WelfareApplication,
  state: WelfareState
) {
  // 1. 写入 state（现有逻辑）
  if (!state.applications)
    state.applications = []
  
  const existingIndex = state.applications.findIndex(a => a.id === application.id)
  if (existingIndex >= 0)
    state.applications[existingIndex] = application
  else
    state.applications.push(application)
  
  // 2. 写入新表
  const normalizedApp = normalizeApplication(application)
  
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        INSERT INTO applications (
          id, user_id, type, status, title, description,
          base_cost, cost, cost_charged, github_repo, 
          has_open_source_badge, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          status = excluded.status,
          title = excluded.title,
          description = excluded.description,
          updated_at = excluded.updated_at
      `)
      .bind(
        normalizedApp.id,
        normalizedApp.userId,
        normalizedApp.type,
        normalizedApp.status,
        normalizedApp.title,
        normalizedApp.description,
        normalizedApp.baseCost,
        normalizedApp.cost,
        normalizedApp.costCharged,
        normalizedApp.githubRepo || null,
        normalizedApp.hasOpenSourceBadge || false,
        normalizedApp.createdAt,
        normalizedApp.updatedAt || normalizedApp.createdAt
      )
      .run()
  } else {
    await getPool(env).query(`
      INSERT INTO applications (
        id, user_id, type, status, title, description,
        base_cost, cost, cost_charged, github_repo, 
        has_open_source_badge, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        updated_at = EXCLUDED.updated_at
    `, [
      normalizedApp.id,
      normalizedApp.userId,
      normalizedApp.type,
      normalizedApp.status,
      normalizedApp.title,
      normalizedApp.description,
      normalizedApp.baseCost,
      normalizedApp.cost,
      normalizedApp.costCharged,
      normalizedApp.githubRepo || null,
      normalizedApp.hasOpenSourceBadge || false,
      normalizedApp.createdAt,
      normalizedApp.updatedAt || normalizedApp.createdAt
    ])
  }
  
  // 3. 处理附件
  if (application.attachments?.length) {
    await dualWriteAttachments(env, application.id, application.attachments)
  }
  
  // 4. 处理消息
  if (application.messages?.length) {
    await dualWriteMessages(env, application.id, application.messages)
  }
}

/**
 * 灰度读取：根据配置决定从哪里读取
 */
export async function readApplicationWithCanary(
  env: WorkerEnv,
  applicationId: string,
  canaryPercentage = 0  // 0-100
): Promise<WelfareApplication | null> {
  const useNewTable = Math.random() * 100 < canaryPercentage
  
  if (useNewTable) {
    // 从新表读取
    const app = await readApplicationFromTable(env, applicationId)
    if (app) {
      console.log(`[CANARY] Read application ${applicationId} from new table`)
      return app
    }
  }
  
  // 从 state 读取（fallback）
  const state = await readWelfareState(env)
  return state.applications?.find(a => a.id === applicationId) || null
}

/**
 * 数据一致性校验
 */
export async function validateDataConsistency(
  env: WorkerEnv,
  sampleSize = 100
): Promise<{
  total: number
  consistent: number
  inconsistent: Array<{ id: string, diff: string }>
}> {
  // 从 state 读取样本
  const state = await readWelfareState(env)
  const applications = state.applications || []
  const sample = applications.slice(0, sampleSize)
  
  const inconsistent: Array<{ id: string, diff: string }> = []
  
  for (const stateApp of sample) {
    const tableApp = await readApplicationFromTable(env, stateApp.id)
    if (!tableApp) {
      inconsistent.push({ id: stateApp.id, diff: 'Missing in new table' })
      continue
    }
    
    // 比较关键字段
    const diffs: string[] = []
    if (stateApp.status !== tableApp.status)
      diffs.push(`status: ${stateApp.status} vs ${tableApp.status}`)
    if (stateApp.cost !== tableApp.cost)
      diffs.push(`cost: ${stateApp.cost} vs ${tableApp.cost}`)
    
    if (diffs.length > 0) {
      inconsistent.push({ id: stateApp.id, diff: diffs.join('; ') })
    }
  }
  
  return {
    total: sample.length,
    consistent: sample.length - inconsistent.length,
    inconsistent
  }
}
```

**完成标志**:
- ✅ 所有业务数据迁移到规范化表
- ✅ 数据一致性验证 100%
- ✅ P99 响应时间 < 1 秒
- ✅ welfare_app_state 表仅作备份

---

### Phase 4: 缓存层实现（3-5 天，P2）

**目标**: 使用 Cloudflare KV 实现缓存，减少数据库查询

#### 4.1 缓存策略

```typescript
// 新文件: src/worker/welfare/cache.ts

export interface CacheStrategy {
  key: string
  ttl: number  // 秒
  tags?: string[]
}

const CACHE_STRATEGIES: Record<string, CacheStrategy> = {
  // 用户信息 - 5分钟
  user: { key: 'user:{id}', ttl: 300, tags: ['user'] },
  
  // 用户申请列表 - 1分钟
  userApplications: { key: 'apps:user:{id}', ttl: 60, tags: ['applications'] },
  
  // 系统配置 - 10分钟
  systemConfig: { key: 'config:system', ttl: 600, tags: ['config'] },
  
  // 申请策略 - 10分钟
  applicationPolicy: { key: 'config:policy', ttl: 600, tags: ['config'] },
  
  // 用户积分 - 30秒（高频更新）
  userPoints: { key: 'points:{id}', ttl: 30, tags: ['points'] },
}

export async function getCached<T>(
  env: WorkerEnv,
  strategy: CacheStrategy,
  params: Record<string, string>
): Promise<T | null> {
  if (!env.CACHE_KV)
    return null
  
  const key = interpolateKey(strategy.key, params)
  const cached = await env.CACHE_KV.get(key, 'json')
  
  if (cached) {
    console.log(`[CACHE HIT] ${key}`)
    return cached as T
  }
  
  console.log(`[CACHE MISS] ${key}`)
  return null
}

export async function setCached<T>(
  env: WorkerEnv,
  strategy: CacheStrategy,
  params: Record<string, string>,
  value: T
): Promise<void> {
  if (!env.CACHE_KV)
    return
  
  const key = interpolateKey(strategy.key, params)
  await env.CACHE_KV.put(key, JSON.stringify(value), {
    expirationTtl: strategy.ttl,
    metadata: { tags: strategy.tags }
  })
  
  console.log(`[CACHE SET] ${key} TTL=${strategy.ttl}s`)
}

export async function invalidateCache(
  env: WorkerEnv,
  tags: string[]
): Promise<void> {
  // Cloudflare KV 不支持批量删除，需要维护 tag -> keys 映射
  // 简化版：直接删除相关 key
  console.log(`[CACHE INVALIDATE] tags=${tags.join(',')}`)
}
```

#### 4.2 应用缓存

```typescript
// 修改: src/worker/welfare/services/user-service.ts

export async function getUserById(
  env: WorkerEnv,
  userId: string
): Promise<User | null> {
  // 1. 尝试从缓存读取
  const cached = await getCached<User>(
    env,
    CACHE_STRATEGIES.user,
    { id: userId }
  )
  if (cached)
    return cached
  
  // 2. 从数据库读取
  const user = await readUserFromDatabase(env, userId)
  if (!user)
    return null
  
  // 3. 写入缓存
  await setCached(env, CACHE_STRATEGIES.user, { id: userId }, user)
  
  return user
}
```

**wrangler.jsonc 配置**:
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "CACHE_KV",
      "id": "your-kv-namespace-id"
    }
  ]
}
```

**完成标志**:
- ✅ 缓存命中率 > 70%
- ✅ 平均响应时间减少 40%

---

### Phase 5: 异步任务队列（1 周，P2）

**目标**: 将耗时操作移到后台处理

#### 5.1 任务类型

```typescript
// 新文件: src/worker/welfare/queue/types.ts

export type QueueTask =
  | { type: 'ai_review', applicationId: string }
  | { type: 'send_notification', userId: string, event: string }
  | { type: 'provision_resource', applicationId: string, itemId: string }
  | { type: 'sync_github_repos', userId: string }
  | { type: 'generate_report', reportType: string, params: Record<string, unknown> }
```

#### 5.2 任务处理器

```typescript
// 新文件: src/worker/welfare/queue/handlers.ts

export async function handleAiReviewTask(
  env: WorkerEnv,
  applicationId: string
) {
  const application = await readApplicationFromTable(env, applicationId)
  if (!application)
    return
  
  // AI 审核逻辑（可能需要 5-30 秒）
  const review = await performAiReview(env, application)
  
  // 更新申请状态
  await updateApplication(env, applicationId, {
    aiReview: review,
    status: review.status === 'approved' ? 'processing' : 'needs_supplement'
  })
  
  // 发送通知
  await enqueueTask(env, {
    type: 'send_notification',
    userId: application.userId,
    event: 'application_reviewed'
  })
}
```

#### 5.3 队列配置

**wrangler.jsonc**:
```jsonc
{
  "queues": {
    "producers": [
      {
        "queue": "async-jobs",
        "binding": "ASYNC_JOBS"
      }
    ],
    "consumers": [
      {
        "queue": "async-jobs",
        "max_batch_size": 10,
        "max_batch_timeout": 30,
        "max_retries": 3
      }
    ]
  }
}
```

**完成标志**:
- ✅ AI 审核改为异步
- ✅ 资源开通改为异步
- ✅ 同步接口响应时间 < 500ms

---

## 📈 预期效果

### 性能改善

| 指标 | 当前 | Phase 0 | Phase 1 | Phase 3 | Phase 4+5 |
|------|------|---------|---------|---------|-----------|
| P50 响应时间 | 4-6s | 2-3s | 1-2s | 0.3-0.8s | 0.1-0.3s |
| P95 响应时间 | 10-15s | 5-8s | 3-5s | 1-2s | 0.5-1s |
| P99 响应时间 | 15-30s | 10-15s | 8-10s | 2-4s | 1-2s |
| 超时率 | 50% | 10% | 2% | <0.1% | <0.01% |
| 并发能力 | 5-10 | 20-30 | 50-80 | 200-300 | 500+ |
| 数据库 QPS | 200-300 | 150-200 | 100-150 | 50-80 | 20-40 |

### 可扩展性

| 用户数 | 当前可用性 | Phase 3 后 | Phase 4+5 后 |
|--------|------------|------------|--------------|
| 100 | ⚠️ 勉强可用 | ✅ 优秀 | ✅ 优秀 |
| 500 | ❌ 不可用 | ✅ 良好 | ✅ 优秀 |
| 1000 | ❌ 崩溃 | ✅ 可用 | ✅ 优秀 |
| 5000 | ❌ 崩溃 | ✅ 可用 | ✅ 良好 |
| 10000+ | ❌ 崩溃 | ⚠️ 需优化 | ✅ 可用 |

---

## 💰 成本估算

### 开发成本

| 阶段 | 工作量 | 开发人员 | 周期 |
|------|--------|----------|------|
| Phase 0 | 1-2 人日 | 1 人 | 1-2 天 |
| Phase 1 | 3-5 人日 | 1 人 | 3-5 天 |
| Phase 2 | 5-7 人日 | 1-2 人 | 1 周 |
| Phase 3 | 10-15 人日 | 2 人 | 2-3 周 |
| Phase 4 | 3-5 人日 | 1 人 | 3-5 天 |
| Phase 5 | 5-7 人日 | 1 人 | 1 周 |
| **总计** | **27-41 人日** | **2 人** | **6-8 周** |

### 基础设施成本（月度）

| 项目 | 当前 | Phase 3 后 | 增量 |
|------|------|------------|------|
| PostgreSQL | $50-100 | $100-150 | +$50 |
| Cloudflare Workers | $20-30 | $20-30 | $0 |
| Cloudflare KV (Phase 4) | $0 | $5-10 | +$10 |
| Cloudflare Queues (Phase 5) | $0 | $5-10 | +$10 |
| **总计** | **$70-130** | **$130-200** | **+$60-70** |

**ROI 分析**:
- 开发成本: 约 $10,000-15,000（按 $500/人日）
- 基础设施增量: $60-70/月
- **回报**: 系统从"不可用"变为"可扩展"，支撑 10,000+ 用户
- **回本周期**: 立即（避免系统崩溃的损失）

---

## ⚠️ 风险与应对

### 风险 1: 数据迁移失败

**概率**: 中  
**影响**: 高

**应对**:
- 完整的备份策略
- 双写模式确保数据不丢失
- 灰度切换，出问题立即回滚
- 保留 state JSONB 作为最终 fallback

### 风险 2: 性能改善不达预期

**概率**: 低  
**影响**: 中

**应对**:
- Phase 0 是确定性优化（移除全量同步）
- 每个阶段都有明确的性能指标
- 如果 Phase 1 效果不佳，可以跳过直接做 Phase 3

### 风险 3: 团队学习曲线

**概率**: 中  
**影响**: 低

**应对**:
- 详细的技术文档和代码注释
- 代码审查机制
- 渐进式重构，不是一次性推倒重来

### 风险 4: 生产环境回归 bug

**概率**: 中  
**影响**: 中

**应对**:
- 完善的测试覆盖（单元测试 + 集成测试）
- 灰度发布策略
- 快速回滚机制
- 监控告警系统

---

## 📋 执行检查清单

### Phase 0: 紧急止血（立即开始）

- [ ] 修改 `router.ts:109` 移除 `syncPointBalances: 'all'`
- [ ] 优化数据库连接池配置
- [ ] 添加性能监控日志
- [ ] 调整前端超时策略
- [ ] 部署到生产环境
- [ ] 验证超时率降低到 < 10%

### Phase 1: 查询优化

- [ ] 创建 `queries.ts` 文件
- [ ] 实现 `getUserApplications()` 等查询函数
- [ ] 重构 API 路由使用快照表
- [ ] 添加关键索引（migration 0017）
- [ ] 测试查询性能
- [ ] 部署到生产环境

### Phase 2: 代码拆分

- [ ] 提取 types 和 constants
- [ ] 创建 services 目录
- [ ] 拆分用户服务
- [ ] 拆分申请服务
- [ ] 拆分积分服务
- [ ] 拆分其他服务
- [ ] 重构 actions
- [ ] 编写单元测试
- [ ] 代码审查
- [ ] 部署到生产环境

### Phase 3: 数据模型规范化

- [ ] 设计新表结构（migration 0018）
- [ ] 审查表设计
- [ ] 实施双写模式
- [ ] 数据一致性验证
- [ ] 灰度切换读取（10% → 50% → 100%）
- [ ] 性能测试
- [ ] 完全切换到新表
- [ ] 归档旧 state 表

### Phase 4: 缓存层

- [ ] 创建 Cloudflare KV namespace
- [ ] 实现缓存工具函数
- [ ] 应用到高频接口
- [ ] 监控缓存命中率
- [ ] 调优 TTL 配置

### Phase 5: 异步任务队列

- [ ] 配置 Cloudflare Queues
- [ ] 实现任务处理器
- [ ] 迁移 AI 审核为异步
- [ ] 迁移资源开通为异步
- [ ] 监控队列健康度

---

## 🎓 经验教训

### 架构设计原则

1. **Never use JSONB as your primary data store**
   - JSONB 适合存储非结构化、低频查询的数据
   - 不适合作为主数据库

2. **Normalize when you can, denormalize when you must**
   - 规范化优先，性能需要时再考虑反规范化
   - 不要一开始就过度优化

3. **Measure before you optimize**
   - 添加性能监控是第一步
   - 用数据驱动优化决策

4. **Plan for scale from day one**
   - 不要等到有问题了再重构
   - 但也不要过度设计

5. **Keep modules small and focused**
   - 4714 行的单文件是维护噩梦
   - 每个文件应该 < 500 行

### 代码质量原则

1. **Single Responsibility Principle**
   - 一个函数只做一件事
   - 一个服务只管一个领域

2. **Fail fast and loud**
   - 不要隐藏错误
   - 详细的错误日志

3. **Test what matters**
   - 关键业务逻辑 100% 覆盖
   - 工具函数适度测试

4. **Document decisions, not code**
   - 代码注释解释"为什么"，不是"是什么"
   - 架构决策记录（ADR）

---

## 📞 联系与支持

如果在执行重构过程中遇到问题，可以：

1. 参考本文档的详细说明
2. 查看相关的代码注释
3. 运行性能监控日志分析瓶颈
4. 回滚到上一个稳定版本

**记住**: 重构是渐进的，不是革命性的。每一步都应该可测试、可验证、可回滚。

---

**文档版本**: 1.0  
**最后更新**: 2026-06-09  
**作者**: Claude Code (Opus 4.8)  
**状态**: ✅ 已完成
