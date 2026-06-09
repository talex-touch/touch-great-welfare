# 数据库架构迁移详细执行计划

**项目**: Touch Great Welfare  
**目标**: 从单体 JSONB 架构迁移到规范化表结构  
**总工期**: 4-6 周  
**风险等级**: 🔴 HIGH（涉及核心数据）

---

## 📋 执行摘要

### 迁移目标

将当前的单体 JSONB 存储架构：
```sql
-- ❌ 当前架构
CREATE TABLE welfare_app_state (
  id TEXT PRIMARY KEY,
  state JSONB NOT NULL  -- 包含所有业务数据
);
```

迁移到规范化表结构：
```sql
-- ✅ 目标架构
CREATE TABLE users (...);
CREATE TABLE applications (...);
CREATE TABLE application_items (...);
CREATE TABLE student_verifications (...);
CREATE TABLE coupons (...);
-- ... 等 15+ 张表
```

### 关键策略

- ✅ **零停机迁移**：使用双写模式
- ✅ **可回滚**：保留 JSONB 作为 fallback
- ✅ **灰度切换**：逐步切换读取源
- ✅ **数据一致性**：自动校验工具

### 预期收益

| 指标 | 迁移前 | 迁移后 | 改善 |
|------|--------|--------|------|
| P95 响应时间 | 10-15s | 0.5-1s | **90%+ ⬇️** |
| 超时率 | 50% | <0.1% | **99%+ ⬇️** |
| 并发能力 | 10 req/s | 500+ req/s | **50x ⬆️** |
| 可扩展性 | 100 用户 | 10,000+ 用户 | **100x ⬆️** |
| 查询效率 | 全表扫描 | 索引查询 | **1000x ⬆️** |

---

## 🚀 Phase 0: 紧急止血（1-2 天）

**目标**: 立即降低超时率，为后续迁移争取时间

### Task 0.1: 修复全量积分同步 ⏱️ 30 分钟

**优先级**: 🔴 P0 - 立即执行

**文件**: `src/worker/welfare/router.ts`

**修改点 1** - 行 109:
```typescript
// ❌ 修改前
async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const previousRecord = await readWelfareStateRecord(env, { 
    syncPointBalances: 'all'  // ← 删除这个！
  })
```

```typescript
// ✅ 修改后
async function legacyFullStateSave(request: Request, env: WorkerEnv) {
  const userId = await requestUserId(request, env)
  if (!userId)
    throw new Error('请先登录')
  
  const previousRecord = await readWelfareStateRecord(env, { 
    syncPointBalances: 'current-user',  // ← 只同步当前用户
    currentUserId: userId
  })
```

**修改点 2** - 查找其他调用:
```bash
# 查找所有 syncPointBalances: 'all' 的位置
grep -rn "syncPointBalances.*all" src/worker/
```

**验证**:
```bash
# 1. 类型检查
pnpm typecheck

# 2. 运行测试
pnpm test

# 3. 本地测试
pnpm dev
# 访问管理员后台，保存配置，观察响应时间
```

**预期效果**: 
- 管理员操作耗时：10-20s → 2-5s
- 超时率：50% → 15-20%

---

### Task 0.2: 优化数据库连接池 ⏱️ 15 分钟

**文件**: `src/worker/welfare/core.ts`

**修改点** - 行 1092-1098:
```typescript
// ❌ 修改前
pool = new Pool({
  connectionString,
  connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
  query_timeout: POSTGRES_TIMEOUT_MS,
  statement_timeout: POSTGRES_TIMEOUT_MS,
})
```

```typescript
// ✅ 修改后
pool = new Pool({
  connectionString,
  max: 20,                              // 最大连接数
  min: 2,                               // 最小连接数（预热）
  idleTimeoutMillis: 30000,             // 空闲超时 30s
  connectionTimeoutMillis: 15000,       // 连接超时 15s（放宽）
  query_timeout: 20000,                 // 查询超时 20s
  statement_timeout: 20000,             // 语句超时 20s
  allowExitOnIdle: false,               // 保持连接池活跃
})
```

**验证**:
```bash
pnpm typecheck && pnpm test
```

---

### Task 0.3: 添加性能监控日志 ⏱️ 2 小时

**目标**: 找到真实瓶颈点

**新文件**: `src/worker/welfare/perf-monitor.ts`

```typescript
interface PerfEntry {
  operation: string
  startTime: number
  duration?: number
  metadata?: Record<string, unknown>
}

const perfStack: PerfEntry[] = []

export function perfStart(operation: string, metadata?: Record<string, unknown>) {
  perfStack.push({
    operation,
    startTime: Date.now(),
    metadata,
  })
}

export function perfEnd(operation: string) {
  const entry = perfStack.findLast(e => e.operation === operation && !e.duration)
  if (!entry)
    return
  
  entry.duration = Date.now() - entry.startTime
  
  // 记录慢操作（超过 1 秒）
  if (entry.duration > 1000) {
    console.warn(`[PERF SLOW] ${operation}: ${entry.duration}ms`, entry.metadata)
  } else {
    console.log(`[PERF] ${operation}: ${entry.duration}ms`)
  }
}

export function perfWrap<T>(operation: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
  perfStart(operation, metadata)
  return fn().finally(() => perfEnd(operation))
}
```

**应用到关键函数** - `src/worker/welfare/core.ts`:

```typescript
import { perfEnd, perfStart, perfWrap } from './perf-monitor'

export async function readWelfareStateRecord(env: WorkerEnv, options: ReadWelfareStateOptions = {}): Promise<WelfareStateRecord> {
  perfStart('readWelfareStateRecord', { syncMode: options.syncPointBalances })
  
  try {
    perfStart('ensureSchema')
    await ensureSchema(env)
    perfEnd('ensureSchema')
    
    perfStart('dbRead')
    const record = shouldUseD1(env) ? /* ... */ : /* ... */
    perfEnd('dbRead')
    
    perfStart('decodeState')
    const state = await decodeStoredState(env, record.state)
    perfEnd('decodeState')
    
    if (options.syncPointBalances === 'all') {
      await perfWrap('syncPointBalances_ALL', () => 
        syncUserPointBalancesFromLedger(env, state)
      )
    } else if (options.syncPointBalances === 'current-user' && options.currentUserId) {
      await perfWrap('syncPointBalances_CURRENT', () =>
        syncUserPointBalancesFromLedger(env, state, [options.currentUserId!])
      )
    }
    
    return { state, version: record.version }
  } finally {
    perfEnd('readWelfareStateRecord')
  }
}
```

**验证**:
- 部署到 dev 环境
- 触发各种操作
- 查看 Cloudflare Workers 日志
- 记录最慢的 5 个操作

---

### Task 0.4: 调整前端超时策略 ⏱️ 30 分钟

**文件**: `src/composables/welfare-api/core.ts`

**修改** - 行 6-8:
```typescript
// ❌ 修改前
const STATE_REQUEST_TIMEOUT_MS = 10000

async function requestState<T>(path = STATE_ENDPOINT, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STATE_REQUEST_TIMEOUT_MS)
  // ...
}
```

```typescript
// ✅ 修改后
const TIMEOUT_CONFIG = {
  default: 15000,           // 普通请求 15s
  read: 15000,              // 读取操作 15s
  write: 30000,             // 写入操作 30s
  adminSave: 30000,         // 管理员保存 30s
  applicationSubmit: 20000, // 申请提交 20s
}

async function requestState<T>(
  path = STATE_ENDPOINT, 
  init?: RequestInit & { timeout?: number }
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(), 
    init?.timeout || TIMEOUT_CONFIG.default
  )
  // ...
}

// 应用到具体函数
export async function saveWelfareState(state: WelfareState, userId?: string) {
  const result = await requestState<{ ok: true, version?: number }>(STATE_ENDPOINT, {
    method: 'PUT',
    timeout: TIMEOUT_CONFIG.adminSave,  // ← 使用更长超时
    headers: userId ? { 'x-welfare-user-id': userId } : undefined,
    body: JSON.stringify({ state, version: currentWelfareStateVersion }),
  })
  // ...
}
```

---

### Phase 0 验收标准

- [ ] 修改已提交到 Git
- [ ] 类型检查通过
- [ ] 测试通过
- [ ] 部署到生产环境
- [ ] 超时率 < 15%
- [ ] P95 响应时间 < 8s
- [ ] 性能日志已收集至少 100 个请求样本

---

## 📊 Phase 1: 数据模型设计与验证（3-5 天）

**目标**: 设计完整的数据库 schema 并验证可行性

### Task 1.1: 设计规范化表结构 ⏱️ 1 天

**新文件**: `migrations/0018_normalize_schema.sql`

**核心表设计**:

```sql
-- ============================================
-- 用户表
-- ============================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  
  -- 个人信息
  display_name TEXT NOT NULL,
  avatar TEXT,
  bio TEXT,
  
  -- 角色和状态
  role TEXT NOT NULL DEFAULT 'user' 
    CHECK (role IN ('user', 'admin', 'reviewer')),
  account_status TEXT NOT NULL DEFAULT 'active' 
    CHECK (account_status IN ('active', 'suspended')),
  
  -- 积分
  points INTEGER NOT NULL DEFAULT 0,
  points_updated_at TIMESTAMPTZ,
  
  -- GitHub 认证
  github_username TEXT,
  github_authorized BOOLEAN DEFAULT FALSE,
  selected_repo TEXT,
  github_repos_synced_at TIMESTAMPTZ,
  
  -- 学生认证
  student_verified BOOLEAN DEFAULT FALSE,
  student_verified_at TIMESTAMPTZ,
  student_verification_source TEXT,
  
  -- 用户等级
  user_level TEXT DEFAULT 'starter',
  user_level_updated_at TIMESTAMPTZ,
  
  -- 邀请码
  invitation_code TEXT UNIQUE,
  invited_by_user_id TEXT REFERENCES users(id),
  
  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github ON users(github_username) 
  WHERE github_username IS NOT NULL;
CREATE INDEX idx_users_role ON users(role) 
  WHERE role != 'user';
CREATE INDEX idx_users_invitation_code ON users(invitation_code) 
  WHERE invitation_code IS NOT NULL;
CREATE INDEX idx_users_invited_by ON users(invited_by_user_id) 
  WHERE invited_by_user_id IS NOT NULL;

-- 触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

**其他表设计** 继续在下一个chunk...


**继续 Task 1.1 - 应用表设计**:

```sql
-- ============================================
-- 申请表
-- ============================================
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 基本信息
  type TEXT NOT NULL CHECK (type IN ('code', 'image', 'pro', 'resource')),
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'reserved', 'pending_review', 'needs_supplement', 
    'processing', 'answered', 'submitted', 'in_review', 
    'approved', 'partial_approved', 'pending_allocation', 
    'rejected', 'completed', 'cancelled', 'closed', 'delivered'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- 成本和定价
  base_cost INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  cost_charged BOOLEAN NOT NULL DEFAULT FALSE,
  pricing_snapshot JSONB,  -- 保存定价快照（活动价等）
  
  -- AI 审核
  ai_review_status TEXT,
  ai_review_summary TEXT,
  ai_review_risk TEXT,
  ai_review_score NUMERIC(3, 2),
  ai_review_fee_rate NUMERIC(5, 4),
  ai_reviewed_at TIMESTAMPTZ,
  
  -- 人工审核
  reviewed_at TIMESTAMPTZ,
  reviewer_user_id TEXT REFERENCES users(id),
  
  -- 拒绝相关
  rejection_reason TEXT,
  rejection_review_fee INTEGER DEFAULT 0,
  rejection_review_fee_waived BOOLEAN DEFAULT FALSE,
  rejection_fraudulent BOOLEAN DEFAULT FALSE,
  rejection_cooldown_until TIMESTAMPTZ,
  waive_rejection_review_fee_blocked_until TIMESTAMPTZ,
  
  -- GitHub 开源认证
  github_repo TEXT,
  has_open_source_badge BOOLEAN DEFAULT FALSE,
  
  -- 存储和处理
  storage_extended BOOLEAN DEFAULT FALSE,
  storage_extension_cost INTEGER DEFAULT 0,
  retention_expires_at TIMESTAMPTZ,
  expedited BOOLEAN DEFAULT FALSE,
  expedite_cost INTEGER DEFAULT 0,
  processing_due_at TIMESTAMPTZ,
  
  -- LLM API 特有字段
  llm_api_model_key TEXT,
  llm_api_budget_usd NUMERIC(10, 2),
  llm_api_access_ips TEXT[],
  llm_api_rate_limits JSONB,
  
  -- 答复和完成
  answer TEXT,
  answer_attachments JSONB,
  completed_at TIMESTAMPTZ,
  
  -- 交付相关（code/pro）
  delivery_assignee_id TEXT REFERENCES users(id),
  delivery_claimed_at TIMESTAMPTZ,
  delivery_submitted_at TIMESTAMPTZ,
  delivery_review_status TEXT,
  delivery_reward_points INTEGER,
  delivery_rewarded_at TIMESTAMPTZ,
  delivery_rewarded_by TEXT REFERENCES users(id),
  
  -- 优惠券
  applied_coupon_id TEXT,
  coupon_discount_amount INTEGER DEFAULT 0,
  
  -- PoW 和 Turnstile
  pow_nonce TEXT,
  turnstile_verified BOOLEAN DEFAULT FALSE,
  
  -- 广场分享
  shared_to_square BOOLEAN DEFAULT FALSE,
  square_discount_rate NUMERIC(5, 4),
  
  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 核心索引
CREATE INDEX idx_applications_user_created 
  ON applications(user_id, created_at DESC);
CREATE INDEX idx_applications_user_status 
  ON applications(user_id, status);
CREATE INDEX idx_applications_status_created 
  ON applications(status, created_at ASC);
CREATE INDEX idx_applications_type_status 
  ON applications(type, status);

-- 管理员审核队列优化
CREATE INDEX idx_applications_pending_review 
  ON applications(created_at ASC) 
  WHERE status IN ('pending_review', 'needs_supplement');

-- AI 审核队列
CREATE INDEX idx_applications_ai_pending 
  ON applications(created_at ASC) 
  WHERE ai_review_status IS NULL AND status = 'pending_review';

-- 交付队列优化
CREATE INDEX idx_applications_delivery_available 
  ON applications(created_at ASC) 
  WHERE status IN ('answered', 'pending_allocation', 'delivered') 
    AND delivery_rewarded_at IS NULL;

-- 过期清理索引
CREATE INDEX idx_applications_retention_expires 
  ON applications(retention_expires_at) 
  WHERE retention_expires_at IS NOT NULL;

-- 触发器
CREATE TRIGGER applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

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
  
  type TEXT NOT NULL CHECK (type IN (
    'system', 'user_question', 'admin_answer', 
    'supplement_request', 'result_submission', 'comment'
  )),
  content TEXT NOT NULL,
  attachments JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_messages_application 
  ON application_messages(application_id, created_at ASC);
CREATE INDEX idx_application_messages_sender 
  ON application_messages(sender_user_id);

-- ============================================
-- 资源申请项表
-- ============================================
CREATE TABLE application_items (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  
  resource_type TEXT NOT NULL,
  resource_subtype TEXT,
  payload JSONB NOT NULL,
  
  approver_group TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'adjusted_approved')),
  provision_status TEXT NOT NULL DEFAULT 'not_required' 
    CHECK (provision_status IN ('not_required', 'pending', 'provisioned', 'failed')),
  
  -- 请求的配额和权限
  requested_quota JSONB,
  requested_permission JSONB,
  duration TEXT,
  
  -- 审批
  approved_at TIMESTAMPTZ,
  approved_by TEXT REFERENCES users(id),
  approval_note TEXT,
  
  -- 开通
  provisioned_at TIMESTAMPTZ,
  provision_result JSONB,
  provision_error TEXT,
  
  -- 生命周期
  lifecycle_status TEXT,
  lifecycle_expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_items_application 
  ON application_items(application_id);
CREATE INDEX idx_application_items_status 
  ON application_items(approval_status, provision_status);
CREATE INDEX idx_application_items_lifecycle_expires 
  ON application_items(lifecycle_expires_at) 
  WHERE lifecycle_expires_at IS NOT NULL;

CREATE TRIGGER application_items_updated_at
BEFORE UPDATE ON application_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 学生认证表
-- ============================================
CREATE TABLE student_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'needs_supplement', 'approved', 'rejected', 'revoked')),
  
  -- 材料
  category TEXT NOT NULL,
  notes TEXT,
  attachments JSONB,
  
  -- 费用
  review_fee INTEGER NOT NULL DEFAULT 800,
  fee_returned BOOLEAN DEFAULT FALSE,
  
  -- 教育邮箱认证
  education_email TEXT,
  education_email_verified BOOLEAN DEFAULT FALSE,
  education_email_verified_at TIMESTAMPTZ,
  education_email_verification_source TEXT,
  education_email_analysis JSONB,
  
  -- 审核结果
  reply TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),
  
  -- 撤销
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT REFERENCES users(id),
  revoke_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_student_verifications_user 
  ON student_verifications(user_id);
CREATE INDEX idx_student_verifications_status 
  ON student_verifications(status);
CREATE INDEX idx_student_verifications_pending 
  ON student_verifications(created_at ASC) 
  WHERE status = 'pending';

CREATE TRIGGER student_verifications_updated_at
BEFORE UPDATE ON student_verifications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 教育邮箱认证挑战表
-- ============================================
CREATE TABLE education_email_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  email TEXT NOT NULL,
  real_name TEXT,
  verification_code TEXT NOT NULL,
  
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_education_email_challenges_user 
  ON education_email_challenges(user_id);
CREATE INDEX idx_education_email_challenges_email 
  ON education_email_challenges(email);
CREATE INDEX idx_education_email_challenges_code 
  ON education_email_challenges(verification_code);
CREATE INDEX idx_education_email_challenges_expires 
  ON education_email_challenges(expires_at) 
  WHERE NOT verified;
```

**继续下一部分...**

-- ============================================
-- 优惠券模板表
-- ============================================
CREATE TABLE coupon_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  
  -- 适用范围
  scope TEXT CHECK (scope IN ('general', 'code', 'image', 'pro', 'resource')),
  applicable_resource_types TEXT[],
  
  -- 折扣规则
  discount_type TEXT NOT NULL CHECK (discount_type IN ('rate', 'fixed_points', 'fixed_ldc')),
  discount_rate NUMERIC(5, 4),
  discount_amount INTEGER,
  max_discount INTEGER,
  min_spend INTEGER,
  
  -- 限制
  ttl_days INTEGER,
  total_grant_limit INTEGER,
  total_granted INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER coupon_templates_updated_at
BEFORE UPDATE ON coupon_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

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
CREATE INDEX idx_coupon_codes_active ON coupon_codes(expires_at) 
  WHERE expires_at IS NULL OR expires_at > NOW();

-- ============================================
-- 用户优惠券表（已有，保持兼容）
-- ============================================
-- user_coupons 表在 0013 migration 已创建
-- 这里只需确保索引完整

CREATE INDEX IF NOT EXISTS idx_user_coupons_user_valid 
  ON user_coupons(user_id, expires_at) 
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_coupons_scope 
  ON user_coupons(user_id, scope) 
  WHERE used_at IS NULL;

-- ============================================
-- 签到记录表
-- ============================================
CREATE TABLE daily_check_ins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  date_key TEXT NOT NULL,  -- YYYY-MM-DD 格式
  points INTEGER NOT NULL,
  streak INTEGER NOT NULL DEFAULT 1,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, date_key)
);

CREATE INDEX idx_daily_check_ins_user_date 
  ON daily_check_ins(user_id, date_key DESC);
CREATE INDEX idx_daily_check_ins_date 
  ON daily_check_ins(date_key);

-- ============================================
-- 邀请绑定表
-- ============================================
CREATE TABLE invitation_bindings (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  vouched BOOLEAN DEFAULT FALSE,
  vouched_at TIMESTAMPTZ,
  
  reward_granted BOOLEAN DEFAULT FALSE,
  reward_granted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(invitee_user_id)  -- 每个用户只能绑定一次
);

CREATE INDEX idx_invitation_bindings_inviter 
  ON invitation_bindings(inviter_user_id);
CREATE INDEX idx_invitation_bindings_invitee 
  ON invitation_bindings(invitee_user_id);
CREATE INDEX idx_invitation_bindings_code 
  ON invitation_bindings(code);

-- ============================================
-- 广场帖子表
-- ============================================
CREATE TABLE square_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  type TEXT NOT NULL CHECK (type IN ('share', 'request')),
  title TEXT NOT NULL,
  content TEXT,
  
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  request_type TEXT,
  template JSONB,
  
  penalty_count INTEGER DEFAULT 0,
  last_penalty_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_posts_type_created 
  ON square_posts(type, created_at DESC);
CREATE INDEX idx_square_posts_user 
  ON square_posts(user_id, created_at DESC);
CREATE INDEX idx_square_posts_application 
  ON square_posts(application_id);

CREATE TRIGGER square_posts_updated_at
BEFORE UPDATE ON square_posts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

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

CREATE INDEX idx_square_boosts_post 
  ON square_boosts(post_id, created_at DESC);
CREATE INDEX idx_square_boosts_user 
  ON square_boosts(user_id, created_at DESC);
CREATE INDEX idx_square_boosts_reported 
  ON square_boosts(reported_at) 
  WHERE reported_at IS NOT NULL;

-- ============================================
-- 广场举报表
-- ============================================
CREATE TABLE square_reports (
  id TEXT PRIMARY KEY,
  boost_id TEXT NOT NULL REFERENCES square_boosts(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  reason TEXT NOT NULL,
  
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_square_reports_boost 
  ON square_reports(boost_id);
CREATE INDEX idx_square_reports_reporter 
  ON square_reports(reporter_user_id);
CREATE INDEX idx_square_reports_pending 
  ON square_reports(created_at ASC) 
  WHERE NOT reviewed;

-- ============================================
-- 协作申请表
-- ============================================
CREATE TABLE collaboration_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  
  reply TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collaboration_applications_user 
  ON collaboration_applications(user_id);
CREATE INDEX idx_collaboration_applications_status 
  ON collaboration_applications(status, created_at ASC);

-- ============================================
-- 众包审核表
-- ============================================
CREATE TABLE crowd_reviews (
  id TEXT PRIMARY KEY,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  target_type TEXT NOT NULL CHECK (target_type IN ('pro_application')),
  target_id TEXT NOT NULL,
  
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'needs_admin')),
  note TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crowd_reviews_reviewer 
  ON crowd_reviews(reviewer_user_id);
CREATE INDEX idx_crowd_reviews_target 
  ON crowd_reviews(target_type, target_id);

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

-- 预填充核心配置
INSERT INTO system_configs (key, value, description) VALUES
('site', '{"enabled": true, "closedReason": ""}', '站点开关'),
('application_policy', '{}', '申请策略配置'),
('site_banner', '{}', '站点横幅配置'),
('oauth', '{}', 'OAuth 配置');

CREATE TRIGGER system_configs_updated_at
BEFORE UPDATE ON system_configs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 积分流水表（已有，确保索引）
-- ============================================
-- point_transactions 在 0009 migration 已创建
-- 确保索引完整

CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created 
  ON point_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_transactions_ref 
  ON point_transactions(ref_id) 
  WHERE ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_point_transactions_type 
  ON point_transactions(type, created_at DESC);
```

**验收标准**:
- [ ] SQL 语法验证通过
- [ ] 在测试数据库执行成功
- [ ] 生成 ERD 图（使用 dbdiagram.io 或类似工具）
- [ ] 团队 Review schema 设计

---

### Task 1.2: 数据映射分析 ⏱️ 4 小时

**目标**: 分析 JSONB state 到规范化表的映射关系

**新文件**: `docs/DATA_MAPPING.md`

```markdown
# JSONB → 规范化表映射关系

## 1. state.users → users 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `users[].id` | `id` | 直接映射 |
| `users[].email` | `email` | 直接映射 |
| `users[].passwordHash` | `password_hash` | 直接映射 |
| `users[].profile.displayName` | `display_name` | 提取嵌套 |
| `users[].profile.avatar` | `avatar` | 提取嵌套 |
| `users[].profile.bio` | `bio` | 提取嵌套 |
| `users[].role` | `role` | 直接映射 |
| `users[].points` | `points` | ⚠️ 不迁移，从 point_transactions 计算 |
| `users[].profile.githubUsername` | `github_username` | 提取嵌套 |
| `users[].profile.studentVerified` | `student_verified` | 提取嵌套 |
| `users[].createdAt` | `created_at` | 直接映射 |
| `users[].lastLoginAt` | `last_login_at` | 直接映射 |

## 2. state.applications → applications 表 + application_items 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `applications[].id` | `applications.id` | 直接映射 |
| `applications[].userId` | `applications.user_id` | 直接映射 |
| `applications[].type` | `applications.type` | 直接映射 |
| `applications[].status` | `applications.status` | 直接映射 |
| `applications[].title` | `applications.title` | 直接映射 |
| `applications[].description` | `applications.description` | 直接映射 |
| `applications[].attachments[]` | `application_attachments.*` | 拆分到子表 |
| `applications[].messages[]` | `application_messages.*` | 拆分到子表 |
| `applications[].resourceItems[]` | `application_items.*` | 拆分到子表（resource 类型） |

## 3. state.studentVerifications → student_verifications 表

... (详细映射)

## 4. state.coupons → user_coupons 表（已存在）

直接使用现有快照表 `user_coupons`

## 5. 复杂字段处理

### 5.1 JSONB 保留字段

某些复杂结构暂时保留为 JSONB：

- `applications.pricing_snapshot` - 定价快照
- `applications.ai_review_metadata` - AI 审核元数据
- `applications.llm_api_rate_limits` - 速率限制配置
- `application_items.payload` - 资源配置详情
- `square_posts.template` - 申请模板

### 5.2 数组字段处理

- `applications.attachments` → `application_attachments` 表（一对多）
- `applications.messages` → `application_messages` 表（一对多）
- `users.github_repos` → 不持久化，按需从 GitHub API 获取

### 5.3 计算字段

- `users.points` - 不存储在 users 表，从 point_transactions 实时计算
- `users.activeRequestCount` - 不存储，通过 COUNT 查询
- `applications.boostCount` - 不存储，通过 COUNT 查询
```

**验收标准**:
- [ ] 所有 state 字段都有明确的迁移目标
- [ ] 识别出不需要迁移的临时字段
- [ ] 识别出需要特殊处理的字段

---

### Task 1.3: 编写数据迁移脚本（初版）⏱️ 1 天

**目标**: 创建从 JSONB 到规范化表的迁移脚本

**新文件**: `scripts/migrate-jsonb-to-normalized.ts`

```typescript
/**
 * 数据迁移脚本：JSONB state → 规范化表
 * 
 * 使用方法:
 *   pnpm tsx scripts/migrate-jsonb-to-normalized.ts --dry-run
 *   pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute
 */

import { Pool } from 'pg'
import process from 'node:process'

const DATABASE_URL = process.env.DATABASE_URL || process.env.HYPERDRIVE_URL
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL not set')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })
const isDryRun = process.argv.includes('--dry-run')

interface MigrationStats {
  users: number
  applications: number
  applicationAttachments: number
  applicationMessages: number
  applicationItems: number
  studentVerifications: number
  errors: Array<{ table: string, id: string, error: string }>
}

const stats: MigrationStats = {
  users: 0,
  applications: 0,
  applicationAttachments: 0,
  applicationMessages: 0,
  applicationItems: 0,
  studentVerifications: 0,
  errors: [],
}

async function main() {
  console.log(`🚀 Starting migration (${isDryRun ? 'DRY RUN' : 'EXECUTE'})...`)
  
  // 1. 读取 JSONB state
  console.log('\n📖 Reading JSONB state...')
  const stateRow = await pool.query(
    `SELECT state FROM welfare_app_state WHERE id = 'default'`
  )
  
  if (!stateRow.rows[0]) {
    console.error('❌ No state found!')
    process.exit(1)
  }
  
  const state = stateRow.rows[0].state as any
  console.log(`✅ State loaded (${JSON.stringify(state).length} bytes)`)
  
  if (isDryRun) {
    await pool.query('BEGIN')
  }
  
  try {
    // 2. 迁移 users
    await migrateUsers(state.users || [])
    
    // 3. 迁移 applications（及其子表）
    await migrateApplications(state.applications || [])
    
    // 4. 迁移 student_verifications
    await migrateStudentVerifications(state.studentVerifications || [])
    
    // 5. 迁移其他表...
    await migrateOtherTables(state)
    
    if (isDryRun) {
      await pool.query('ROLLBACK')
      console.log('\n🔄 Dry run complete - changes rolled back')
    } else {
      await pool.query('COMMIT')
      console.log('\n✅ Migration complete - changes committed')
    }
    
    printStats()
  } catch (error) {
    if (isDryRun) {
      await pool.query('ROLLBACK')
    }
    console.error('\n❌ Migration failed:', error)
    printStats()
    process.exit(1)
  } finally {
    await pool.end()
  }
}

async function migrateUsers(users: any[]) {
  console.log(`\n👥 Migrating ${users.length} users...`)
  
  for (const user of users) {
    try {
      await pool.query(`
        INSERT INTO users (
          id, email, password_hash, display_name, avatar, bio,
          role, account_status, points, 
          github_username, github_authorized, selected_repo,
          student_verified, student_verified_at,
          invitation_code, invited_by_user_id,
          created_at, last_login_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12,
          $13, $14,
          $15, $16,
          $17, $18
        )
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          updated_at = NOW()
      `, [
        user.id,
        user.email || user.profile?.email,
        user.passwordHash,
        user.profile?.displayName || 'Unnamed User',
        user.profile?.avatar,
        user.profile?.bio,
        user.role || 'user',
        user.accountStatus || 'active',
        0,  // points 从 point_transactions 计算，这里先设为 0
        user.profile?.githubUsername,
        user.profile?.githubAuthorized || false,
        user.profile?.selectedRepo,
        user.profile?.studentVerified || false,
        user.profile?.studentVerifiedAt,
        user.invitationCode,
        user.invitedByUserId,
        user.createdAt || new Date().toISOString(),
        user.lastLoginAt,
      ])
      
      stats.users++
    } catch (error) {
      stats.errors.push({
        table: 'users',
        id: user.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate user ${user.id}:`, error)
    }
  }
  
  console.log(`  ✅ Migrated ${stats.users} users`)
}

async function migrateApplications(applications: any[]) {
  console.log(`\n📝 Migrating ${applications.length} applications...`)
  
  for (const app of applications) {
    try {
      // 迁移主表
      await pool.query(`
        INSERT INTO applications (
          id, user_id, type, status, title, description,
          base_cost, cost, cost_charged,
          github_repo, has_open_source_badge,
          storage_extended, retention_expires_at,
          created_at, submitted_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11,
          $12, $13,
          $14, $15, $16
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        app.id,
        app.userId,
        app.type,
        app.status,
        app.title,
        app.description,
        app.baseCost || 0,
        app.cost || 0,
        app.costCharged || false,
        app.githubRepo,
        app.hasOpenSourceBadge || false,
        app.storageExtended || false,
        app.retentionExpiresAt,
        app.createdAt || new Date().toISOString(),
        app.submittedAt,
        app.updatedAt || app.createdAt || new Date().toISOString(),
      ])
      
      stats.applications++
      
      // 迁移附件
      if (app.attachments?.length) {
        for (const attachment of app.attachments) {
          await pool.query(`
            INSERT INTO application_attachments (
              id, application_id, file_name, file_size, mime_type, storage_key
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            attachment.id || `${app.id}_att_${Date.now()}`,
            app.id,
            attachment.name,
            attachment.size,
            attachment.type,
            attachment.storageKey || attachment.url,
          ])
          stats.applicationAttachments++
        }
      }
      
      // 迁移消息
      if (app.messages?.length) {
        for (const message of app.messages) {
          await pool.query(`
            INSERT INTO application_messages (
              id, application_id, sender_user_id, type, content, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [
            message.id || `${app.id}_msg_${Date.now()}`,
            app.id,
            message.senderId,
            message.type || 'system',
            message.content,
            message.createdAt || new Date().toISOString(),
          ])
          stats.applicationMessages++
        }
      }
      
      // 迁移 resource items
      if (app.type === 'resource' && app.resourceItems?.length) {
        for (const item of app.resourceItems) {
          await pool.query(`
            INSERT INTO application_items (
              id, application_id, resource_type, resource_subtype,
              payload, approver_group, approval_status, provision_status,
              created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
          `, [
            item.id || `${app.id}_item_${Date.now()}`,
            app.id,
            item.resourceType,
            item.resourceSubtype,
            JSON.stringify(item),
            item.approverGroup || '管理员',
            item.approvalStatus || 'pending',
            item.provisionStatus || 'not_required',
            item.createdAt || new Date().toISOString(),
          ])
          stats.applicationItems++
        }
      }
    } catch (error) {
      stats.errors.push({
        table: 'applications',
        id: app.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate application ${app.id}:`, error)
    }
  }
  
  console.log(`  ✅ Migrated ${stats.applications} applications`)
  console.log(`     ├─ ${stats.applicationAttachments} attachments`)
  console.log(`     ├─ ${stats.applicationMessages} messages`)
  console.log(`     └─ ${stats.applicationItems} resource items`)
}

async function migrateStudentVerifications(verifications: any[]) {
  console.log(`\n🎓 Migrating ${verifications.length} student verifications...`)
  
  for (const verif of verifications) {
    try {
      await pool.query(`
        INSERT INTO student_verifications (
          id, user_id, status, category, notes,
          review_fee, fee_returned,
          education_email_verified, education_email_verified_at,
          reply, reviewed_at, reviewed_by,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7,
          $8, $9,
          $10, $11, $12,
          $13
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = NOW()
      `, [
        verif.id,
        verif.userId,
        verif.status,
        verif.category || '学生',
        verif.notes,
        verif.reviewFee || 800,
        verif.feeReturned || false,
        verif.educationEmailVerified || false,
        verif.educationEmailVerifiedAt,
        verif.reply,
        verif.reviewedAt,
        verif.reviewedBy,
        verif.createdAt || new Date().toISOString(),
      ])
      
      stats.studentVerifications++
    } catch (error) {
      stats.errors.push({
        table: 'student_verifications',
        id: verif.id,
        error: String(error),
      })
      console.error(`  ❌ Failed to migrate verification ${verif.id}:`, error)
    }
  }
  
  console.log(`  ✅ Migrated ${stats.studentVerifications} verifications`)
}

async function migrateOtherTables(state: any) {
  // 迁移其他表...
  console.log('\n📦 Migrating other tables...')
  // TODO: daily_check_ins, invitation_bindings, square_posts, etc.
}

function printStats() {
  console.log('\n📊 Migration Statistics:')
  console.log(`  Users:                  ${stats.users}`)
  console.log(`  Applications:           ${stats.applications}`)
  console.log(`  - Attachments:          ${stats.applicationAttachments}`)
  console.log(`  - Messages:             ${stats.applicationMessages}`)
  console.log(`  - Resource Items:       ${stats.applicationItems}`)
  console.log(`  Student Verifications:  ${stats.studentVerifications}`)
  console.log(`  Errors:                 ${stats.errors.length}`)
  
  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:')
    stats.errors.forEach(err => {
      console.log(`  - ${err.table}/${err.id}: ${err.error}`)
    })
  }
}

main().catch(console.error)
```

**验证**:
```bash
# 1. Dry run（不实际执行，只检查）
DATABASE_URL="postgresql://..." pnpm tsx scripts/migrate-jsonb-to-normalized.ts --dry-run

# 2. 在测试环境执行
DATABASE_URL="postgresql://test-db..." pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute

# 3. 验证数据
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM applications;"
```

**验收标准**:
- [ ] Dry run 模式正常运行
- [ ] 测试数据库迁移成功
- [ ] 数据完整性检查通过（数量一致）
- [ ] 关键字段值正确（抽查 10 条记录）

---

## ⚙️ Phase 2: 实现双写层（1 周）

**目标**: 同时写入 JSONB 和规范化表，确保数据一致性

继续在下一部分...

### Task 2.1: 创建数据访问抽象层 ⏱️ 2 天

**目标**: 创建统一的数据访问接口，支持双写

**新文件**: `src/worker/welfare/repositories/base-repository.ts`

```typescript
/**
 * 基础仓库接口
 * 所有业务实体的数据访问都通过 Repository 进行
 */

export interface WriteMode {
  target: 'state-only' | 'table-only' | 'dual-write'  // 写入目标
  syncToSnapshot?: boolean  // 是否同步到快照表
}

export interface ReadMode {
  source: 'state' | 'table' | 'canary'  // 读取源
  canaryPercentage?: number  // 灰度百分比（0-100）
}

export interface RepositoryContext {
  env: WorkerEnv
  writeMode: WriteMode
  readMode: ReadMode
}

/**
 * 全局配置：控制双写和读取策略
 * 
 * 迁移阶段：
 * - Phase 2.1-2.2: { write: 'dual-write', read: 'state' }  // 双写，从 state 读
 * - Phase 3.1: { write: 'dual-write', read: 'canary-10' }   // 10% 从表读
 * - Phase 3.2: { write: 'dual-write', read: 'canary-50' }   // 50% 从表读
 * - Phase 3.3: { write: 'dual-write', read: 'table' }       // 100% 从表读
 * - Phase 4: { write: 'table-only', read: 'table' }         // 停止写 state
 */
export const MIGRATION_CONFIG: {
  writeMode: WriteMode
  readMode: ReadMode
} = {
  writeMode: {
    target: 'dual-write',  // ← 改这里控制写入
    syncToSnapshot: true,
  },
  readMode: {
    source: 'state',       // ← 改这里控制读取
    canaryPercentage: 0,
  },
}

export function createRepositoryContext(env: WorkerEnv): RepositoryContext {
  return {
    env,
    writeMode: MIGRATION_CONFIG.writeMode,
    readMode: MIGRATION_CONFIG.readMode,
  }
}
```

**新文件**: `src/worker/welfare/repositories/user-repository.ts`

```typescript
import type { User } from '~/composables/welfare'
import type { RepositoryContext } from './base-repository'
import { readWelfareState, writeWelfareState } from '../core'
import { getPool, shouldUseD1 } from '../database'

export class UserRepository {
  constructor(private ctx: RepositoryContext) {}
  
  /**
   * 根据 ID 获取用户
   */
  async findById(userId: string): Promise<User | null> {
    const { source, canaryPercentage } = this.ctx.readMode
    
    // 决定读取源
    const useTable = source === 'table' 
      || (source === 'canary' && Math.random() * 100 < (canaryPercentage || 0))
    
    if (useTable) {
      console.log(`[REPO] Read user ${userId} from TABLE`)
      return await this._readFromTable(userId)
    } else {
      console.log(`[REPO] Read user ${userId} from STATE`)
      return await this._readFromState(userId)
    }
  }
  
  /**
   * 创建或更新用户
   */
  async save(user: User): Promise<void> {
    const { target } = this.ctx.writeMode
    
    if (target === 'state-only' || target === 'dual-write') {
      console.log(`[REPO] Write user ${user.id} to STATE`)
      await this._writeToState(user)
    }
    
    if (target === 'table-only' || target === 'dual-write') {
      console.log(`[REPO] Write user ${user.id} to TABLE`)
      await this._writeToTable(user)
    }
  }
  
  /**
   * 批量获取用户
   */
  async findByIds(userIds: string[]): Promise<User[]> {
    const { source } = this.ctx.readMode
    const useTable = source === 'table'
    
    if (useTable) {
      return await this._batchReadFromTable(userIds)
    } else {
      return await this._batchReadFromState(userIds)
    }
  }
  
  // ============================================
  // Private: 从 state 读写
  // ============================================
  
  private async _readFromState(userId: string): Promise<User | null> {
    const state = await readWelfareState(this.ctx.env)
    return state.users?.find(u => u.id === userId) || null
  }
  
  private async _batchReadFromState(userIds: string[]): Promise<User[]> {
    const state = await readWelfareState(this.ctx.env)
    return state.users?.filter(u => userIds.includes(u.id)) || []
  }
  
  private async _writeToState(user: User): Promise<void> {
    const state = await readWelfareState(this.ctx.env)
    
    if (!state.users)
      state.users = []
    
    const index = state.users.findIndex(u => u.id === user.id)
    if (index >= 0) {
      state.users[index] = user
    } else {
      state.users.push(user)
    }
    
    await writeWelfareState(this.ctx.env, state)
  }
  
  // ============================================
  // Private: 从表读写
  // ============================================
  
  private async _readFromTable(userId: string): Promise<User | null> {
    if (shouldUseD1(this.ctx.env)) {
      const result = await this.ctx.env.LOCAL_DB!
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .bind(userId)
        .first<any>()
      
      return result ? this._mapRowToUser(result) : null
    }
    
    const result = await getPool(this.ctx.env).query<any>(
      `SELECT * FROM users WHERE id = $1`,
      [userId]
    )
    
    return result.rows[0] ? this._mapRowToUser(result.rows[0]) : null
  }
  
  private async _batchReadFromTable(userIds: string[]): Promise<User[]> {
    if (!userIds.length)
      return []
    
    if (shouldUseD1(this.ctx.env)) {
      const placeholders = userIds.map(() => '?').join(',')
      const result = await this.ctx.env.LOCAL_DB!
        .prepare(`SELECT * FROM users WHERE id IN (${placeholders})`)
        .bind(...userIds)
        .all<any>()
      
      return result.results.map(row => this._mapRowToUser(row))
    }
    
    const result = await getPool(this.ctx.env).query<any>(
      `SELECT * FROM users WHERE id = ANY($1)`,
      [userIds]
    )
    
    return result.rows.map(row => this._mapRowToUser(row))
  }
  
  private async _writeToTable(user: User): Promise<void> {
    const row = this._mapUserToRow(user)
    
    if (shouldUseD1(this.ctx.env)) {
      await this.ctx.env.LOCAL_DB!
        .prepare(`
          INSERT INTO users (
            id, email, password_hash, display_name, avatar, bio,
            role, account_status, points,
            github_username, github_authorized, selected_repo,
            student_verified, student_verified_at,
            invitation_code, invited_by_user_id,
            created_at, last_login_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?
          )
          ON CONFLICT (id) DO UPDATE SET
            email = excluded.email,
            display_name = excluded.display_name,
            role = excluded.role,
            updated_at = excluded.updated_at
        `)
        .bind(...Object.values(row))
        .run()
    } else {
      await getPool(this.ctx.env).query(`
        INSERT INTO users (
          id, email, password_hash, display_name, avatar, bio,
          role, account_status, points,
          github_username, github_authorized, selected_repo,
          student_verified, student_verified_at,
          invitation_code, invited_by_user_id,
          created_at, last_login_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12,
          $13, $14,
          $15, $16,
          $17, $18, $19
        )
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
      `, Object.values(row))
    }
  }
  
  // ============================================
  // Private: 映射转换
  // ============================================
  
  private _mapRowToUser(row: any): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      profile: {
        displayName: row.display_name,
        avatar: row.avatar,
        bio: row.bio,
        githubUsername: row.github_username,
        githubAuthorized: row.github_authorized,
        selectedRepo: row.selected_repo,
        studentVerified: row.student_verified,
        studentVerifiedAt: row.student_verified_at,
      },
      role: row.role,
      accountStatus: row.account_status,
      points: row.points,
      invitationCode: row.invitation_code,
      invitedByUserId: row.invited_by_user_id,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    }
  }
  
  private _mapUserToRow(user: User): any[] {
    return [
      user.id,
      user.email,
      user.passwordHash,
      user.profile?.displayName || 'Unnamed',
      user.profile?.avatar,
      user.profile?.bio,
      user.role || 'user',
      user.accountStatus || 'active',
      user.points || 0,
      user.profile?.githubUsername,
      user.profile?.githubAuthorized || false,
      user.profile?.selectedRepo,
      user.profile?.studentVerified || false,
      user.profile?.studentVerifiedAt,
      user.invitationCode,
      user.invitedByUserId,
      user.createdAt || new Date().toISOString(),
      user.lastLoginAt,
      new Date().toISOString(),  // updated_at
    ]
  }
}
```

**类似地创建**:
- `application-repository.ts` - 申请仓库
- `student-verification-repository.ts` - 认证仓库
- `coupon-repository.ts` - 优惠券仓库

**验收标准**:
- [ ] 所有 Repository 类实现完成
- [ ] 双写逻辑正确
- [ ] 单元测试通过

---

### Task 2.2: 重构业务逻辑使用 Repository ⏱️ 3 天

**目标**: 逐步将直接操作 state 的代码改为使用 Repository

**示例重构** - `src/worker/welfare/core.ts`:

```typescript
// ❌ 重构前：直接操作 state
export async function getUserById(env: WorkerEnv, userId: string): Promise<User | null> {
  const state = await readWelfareState(env)
  return state.users?.find(u => u.id === userId) || null
}

export async function updateUser(env: WorkerEnv, user: User): Promise<void> {
  const state = await readWelfareState(env)
  const index = state.users?.findIndex(u => u.id === user.id) ?? -1
  if (index >= 0) {
    state.users![index] = user
  } else {
    if (!state.users) state.users = []
    state.users.push(user)
  }
  await writeWelfareState(env, state)
}
```

```typescript
// ✅ 重构后：使用 Repository
import { createRepositoryContext, UserRepository } from './repositories'

export async function getUserById(env: WorkerEnv, userId: string): Promise<User | null> {
  const ctx = createRepositoryContext(env)
  const userRepo = new UserRepository(ctx)
  return await userRepo.findById(userId)
}

export async function updateUser(env: WorkerEnv, user: User): Promise<void> {
  const ctx = createRepositoryContext(env)
  const userRepo = new UserRepository(ctx)
  await userRepo.save(user)
}
```

**重构范围**:
1. 用户相关函数（约 15 个）
2. 申请相关函数（约 30 个）
3. 认证相关函数（约 10 个）
4. 其他业务函数（约 20 个）

**重构策略**:
- 优先重构高频接口（登录、申请提交、列表查询）
- 每次重构一个模块
- 重构后立即测试
- 逐步提交，不要一次改太多

**验收标准**:
- [ ] 所有直接操作 state 的代码已改为 Repository
- [ ] 测试通过
- [ ] 性能无明显退化（< 5%）

---

### Task 2.3: 数据一致性验证工具 ⏱️ 1 天

**目标**: 自动检查 state 和表数据的一致性

**新文件**: `scripts/validate-data-consistency.ts`

```typescript
/**
 * 数据一致性验证工具
 * 
 * 使用方法:
 *   pnpm tsx scripts/validate-data-consistency.ts --sample 100
 *   pnpm tsx scripts/validate-data-consistency.ts --full
 */

import { Pool } from 'pg'
import process from 'node:process'

const DATABASE_URL = process.env.DATABASE_URL!
const pool = new Pool({ connectionString: DATABASE_URL })

interface ValidationResult {
  entity: string
  total: number
  checked: number
  consistent: number
  inconsistencies: Array<{
    id: string
    field: string
    stateValue: any
    tableValue: any
  }>
}

async function main() {
  const sampleSize = process.argv.includes('--full') 
    ? Infinity 
    : Number(process.argv[process.argv.indexOf('--sample') + 1] || 100)
  
  console.log(`🔍 Validating data consistency (sample: ${sampleSize})...`)
  
  // 读取 state
  const stateRow = await pool.query(`SELECT state FROM welfare_app_state WHERE id = 'default'`)
  const state = stateRow.rows[0]?.state as any
  
  const results: ValidationResult[] = []
  
  // 验证 users
  results.push(await validateUsers(state.users || [], sampleSize))
  
  // 验证 applications
  results.push(await validateApplications(state.applications || [], sampleSize))
  
  // 验证 student_verifications
  results.push(await validateStudentVerifications(state.studentVerifications || [], sampleSize))
  
  // 打印报告
  printReport(results)
  
  await pool.end()
  
  // 如果有不一致，退出码为 1
  const hasInconsistencies = results.some(r => r.inconsistencies.length > 0)
  process.exit(hasInconsistencies ? 1 : 0)
}

async function validateUsers(stateUsers: any[], sampleSize: number): Promise<ValidationResult> {
  const result: ValidationResult = {
    entity: 'users',
    total: stateUsers.length,
    checked: 0,
    consistent: 0,
    inconsistencies: [],
  }
  
  const sample = stateUsers.slice(0, Math.min(sampleSize, stateUsers.length))
  
  for (const stateUser of sample) {
    result.checked++
    
    const tableRow = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [stateUser.id]
    )
    
    if (!tableRow.rows[0]) {
      result.inconsistencies.push({
        id: stateUser.id,
        field: '_existence',
        stateValue: 'exists',
        tableValue: 'missing',
      })
      continue
    }
    
    const tableUser = tableRow.rows[0]
    
    // 比较关键字段
    const checks = [
      { field: 'email', state: stateUser.email, table: tableUser.email },
      { field: 'role', state: stateUser.role, table: tableUser.role },
      { field: 'display_name', state: stateUser.profile?.displayName, table: tableUser.display_name },
    ]
    
    let isConsistent = true
    for (const check of checks) {
      if (check.state !== check.table) {
        result.inconsistencies.push({
          id: stateUser.id,
          field: check.field,
          stateValue: check.state,
          tableValue: check.table,
        })
        isConsistent = false
      }
    }
    
    if (isConsistent) {
      result.consistent++
    }
  }
  
  return result
}

async function validateApplications(stateApps: any[], sampleSize: number): Promise<ValidationResult> {
  // 类似 validateUsers
  // ...
  return { entity: 'applications', total: 0, checked: 0, consistent: 0, inconsistencies: [] }
}

async function validateStudentVerifications(stateVerifs: any[], sampleSize: number): Promise<ValidationResult> {
  // 类似 validateUsers
  // ...
  return { entity: 'student_verifications', total: 0, checked: 0, consistent: 0, inconsistencies: [] }
}

function printReport(results: ValidationResult[]) {
  console.log('\n📊 Data Consistency Report\n')
  
  for (const result of results) {
    const rate = result.checked > 0 
      ? ((result.consistent / result.checked) * 100).toFixed(1) 
      : '0.0'
    
    const status = result.inconsistencies.length === 0 ? '✅' : '❌'
    
    console.log(`${status} ${result.entity}`)
    console.log(`  Total:         ${result.total}`)
    console.log(`  Checked:       ${result.checked}`)
    console.log(`  Consistent:    ${result.consistent} (${rate}%)`)
    console.log(`  Inconsistent:  ${result.inconsistencies.length}`)
    
    if (result.inconsistencies.length > 0) {
      console.log(`\n  Inconsistencies:`)
      result.inconsistencies.slice(0, 5).forEach(inc => {
        console.log(`    - ${inc.id}.${inc.field}:`)
        console.log(`      State: ${JSON.stringify(inc.stateValue)}`)
        console.log(`      Table: ${JSON.stringify(inc.tableValue)}`)
      })
      if (result.inconsistencies.length > 5) {
        console.log(`    ... and ${result.inconsistencies.length - 5} more`)
      }
    }
    
    console.log()
  }
  
  const totalInconsistencies = results.reduce((sum, r) => sum + r.inconsistencies.length, 0)
  if (totalInconsistencies === 0) {
    console.log('✅ All data is consistent!')
  } else {
    console.log(`❌ Found ${totalInconsistencies} inconsistencies`)
  }
}

main().catch(console.error)
```

**设置 CI 自动检查**:

```yaml
# .github/workflows/data-consistency.yml
name: Data Consistency Check

on:
  schedule:
    - cron: '0 */6 * * *'  # 每 6 小时检查一次
  workflow_dispatch:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm tsx scripts/validate-data-consistency.ts --sample 100
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
      
      - name: Notify on failure
        if: failure()
        run: |
          # 发送告警到 Slack/企业微信/飞书
          curl -X POST $WEBHOOK_URL \
            -H 'Content-Type: application/json' \
            -d '{"text": "⚠️ 数据一致性检查失败！"}'
```

**验收标准**:
- [ ] 脚本可以正常运行
- [ ] 检测出已知的不一致问题
- [ ] CI 自动检查已设置

---

## 🔄 Phase 3: 灰度切换读取（2 周）

**目标**: 逐步将读取从 state 切换到规范化表

### Task 3.1: 10% 灰度切换 ⏱️ 3 天

**修改**: `src/worker/welfare/repositories/base-repository.ts`

```typescript
export const MIGRATION_CONFIG: {
  writeMode: WriteMode
  readMode: ReadMode
} = {
  writeMode: {
    target: 'dual-write',  // 保持双写
    syncToSnapshot: true,
  },
  readMode: {
    source: 'canary',      // ← 改为灰度模式
    canaryPercentage: 10,  // ← 10% 流量
  },
}
```

**监控指标**:
```typescript
// 新文件: src/worker/welfare/monitoring.ts

export interface ReadMetrics {
  source: 'state' | 'table'
  operation: string
  duration: number
  success: boolean
  error?: string
}

export function recordReadMetric(metric: ReadMetrics) {
  // 记录到 Cloudflare Analytics 或自定义指标
  console.log(`[METRIC] ${JSON.stringify(metric)}`)
}
```

**观察期**: 3 天
- 监控错误率
- 监控响应时间
- 数据一致性验证

**回滚条件**:
- 错误率 > 1%
- 响应时间增加 > 20%
- 数据不一致 > 0.1%

**验收标准**:
- [ ] 10% 流量从表读取
- [ ] 错误率 < 0.1%
- [ ] P95 响应时间改善 > 50%

---

### Task 3.2: 50% 灰度切换 ⏱️ 3 天

```typescript
// ← 改为 50%
canaryPercentage: 50
```

**验收标准**: 同 Task 3.1

---

### Task 3.3: 100% 切换到表 ⏱️ 3 天

```typescript
readMode: {
  source: 'table',       // ← 100% 从表读
  canaryPercentage: 0,
}
```

**验收标准**:
- [ ] 100% 流量从表读取
- [ ] 错误率 < 0.01%
- [ ] P95 响应时间 < 1s
- [ ] 连续运行 72 小时无问题

---

## 🎯 Phase 4: 停止双写，完全迁移（1 周）

### Task 4.1: 停止写入 state ⏱️ 1 天

```typescript
export const MIGRATION_CONFIG = {
  writeMode: {
    target: 'table-only',  // ← 停止写 state
    syncToSnapshot: false,
  },
  readMode: {
    source: 'table',
    canaryPercentage: 0,
  },
}
```

**验证**:
- 观察 1 天
- 确认业务正常

---

### Task 4.2: 归档 welfare_app_state 表 ⏱️ 2 天

```sql
-- 1. 重命名表（保留备份）
ALTER TABLE welfare_app_state 
RENAME TO welfare_app_state_archived_20260609;

-- 2. 添加备注
COMMENT ON TABLE welfare_app_state_archived_20260609 
IS '已迁移到规范化表，此表仅作备份保留 90 天';

-- 3. 移除触发器和约束
-- ...

-- 4. 90 天后删除
-- DROP TABLE welfare_app_state_archived_20260609;
```

---

### Task 4.3: 清理代码 ⏱️ 2 天

1. 删除 Repository 中的双写逻辑
2. 删除 `readWelfareState` / `writeWelfareState` 函数
3. 删除 `MIGRATION_CONFIG`
4. 更新文档

---

## 📊 总体时间表

| 阶段 | 任务 | 工期 | 依赖 |
|------|------|------|------|
| **Phase 0** | 紧急止血 | 1-2 天 | - |
| **Phase 1** | 数据模型设计 | 3-5 天 | Phase 0 |
| **Phase 2** | 双写层实现 | 1 周 | Phase 1 |
| **Phase 3** | 灰度切换 | 2 周 | Phase 2 |
| **Phase 4** | 完全迁移 | 1 周 | Phase 3 |
| **总计** | | **4-6 周** | |

---

## ⚠️ 风险与应对

### 风险 1: 数据不一致

**概率**: 中  
**影响**: 高

**应对**:
- 双写模式确保数据不丢
- 自动一致性检查（每 6 小时）
- 保留 state 备份至少 90 天
- 快速回滚机制

### 风险 2: 性能退化

**概率**: 低  
**影响**: 中

**应对**:
- 灰度切换，出问题立即回滚
- 每个阶段都有性能验证
- 索引优化（Task 1.1）

### 风险 3: 业务中断

**概率**: 低  
**影响**: 高

**应对**:
- 零停机迁移策略
- 双写期间任何一方失败不影响业务
- 快速回滚（< 5 分钟）

---

## ✅ 验收标准

### 迁移完成标准

- [ ] 所有业务数据已迁移到规范化表
- [ ] 数据一致性 100%
- [ ] 100% 流量从规范化表读写
- [ ] P95 响应时间 < 1s
- [ ] 超时率 < 0.1%
- [ ] 并发能力 > 200 req/s
- [ ] 连续运行 7 天无问题
- [ ] welfare_app_state 表已归档
- [ ] 代码已清理
- [ ] 文档已更新

---

## 📞 执行检查清单

### Week 1: Phase 0 + Phase 1

- [ ] Day 1: Phase 0 紧急修复并部署
- [ ] Day 2-3: 设计 schema 并 review
- [ ] Day 4: 数据映射分析
- [ ] Day 5: 编写迁移脚本（初版）

### Week 2: Phase 2

- [ ] Day 1-2: 创建 Repository 层
- [ ] Day 3-5: 重构业务逻辑
- [ ] Day 6: 数据一致性工具
- [ ] Day 7: 测试和验证

### Week 3-4: Phase 3

- [ ] Week 3 Day 1-3: 10% 灰度
- [ ] Week 3 Day 4-6: 50% 灰度
- [ ] Week 3 Day 7: 观察期
- [ ] Week 4 Day 1-3: 100% 切换
- [ ] Week 4 Day 4-7: 稳定性验证

### Week 5: Phase 4

- [ ] Day 1: 停止双写
- [ ] Day 2-3: 观察期
- [ ] Day 4: 归档旧表
- [ ] Day 5-7: 代码清理和文档

---

**最后更新**: 2026-06-09  
**状态**: ✅ 计划完成，待审批执行
