# JSONB → 规范化表映射关系

**创建日期**: 2026-06-09  
**目的**: 定义从 `welfare_app_state.state` JSONB 到规范化表的完整映射关系

---

## 1. state.users → users 表

| JSONB 字段 | 目标列 | 转换规则 | 注意事项 |
|-----------|--------|---------|---------|
| `users[].id` | `id` | 直接映射 | PRIMARY KEY |
| `users[].email` | `email` | 直接映射 | UNIQUE |
| `users[].passwordHash` | `password_hash` | 直接映射 | 敏感字段 |
| `users[].profile.displayName` | `display_name` | 提取嵌套 | 默认值: 'Unnamed User' |
| `users[].profile.avatar` | `avatar` | 提取嵌套 | 可为 NULL |
| `users[].profile.bio` | `bio` | 提取嵌套 | 可为 NULL |
| `users[].role` | `role` | 直接映射 | 默认值: 'user' |
| `users[].accountStatus` | `account_status` | 直接映射 | 默认值: 'active' |
| `users[].points` | `points` | ⚠️ 不迁移 | 从 point_transactions 计算 |
| `users[].profile.githubUsername` | `github_username` | 提取嵌套 | |
| `users[].profile.githubAuthorized` | `github_authorized` | 提取嵌套 | 默认值: FALSE |
| `users[].profile.selectedRepo` | `selected_repo` | 提取嵌套 | |
| `users[].profile.studentVerified` | `student_verified` | 提取嵌套 | 默认值: FALSE |
| `users[].profile.studentVerifiedAt` | `student_verified_at` | 提取嵌套 | TIMESTAMPTZ |
| `users[].invitationCode` | `invitation_code` | 直接映射 | UNIQUE |
| `users[].invitedByUserId` | `invited_by_user_id` | 直接映射 | FOREIGN KEY |
| `users[].createdAt` | `created_at` | 直接映射 | TIMESTAMPTZ |
| `users[].lastLoginAt` | `last_login_at` | 直接映射 | TIMESTAMPTZ |

### 特殊处理

**积分字段**:
```sql
-- ❌ 不要从 state.users[].points 迁移
-- ✅ 从 point_transactions 实时计算
UPDATE users 
SET points = (
  SELECT COALESCE(SUM(amount), 0) 
  FROM point_transactions 
  WHERE user_id = users.id
);
```

**不迁移的临时字段**:
- `users[].profile.githubRepos` - 按需从 GitHub API 获取
- `users[].activeRequestCount` - 通过 COUNT 查询计算

---

## 2. state.applications → applications 表 + 子表

### 2.1 主表映射

| JSONB 字段 | 目标列 | 转换规则 | 注意事项 |
|-----------|--------|---------|---------|
| `applications[].id` | `applications.id` | 直接映射 | PRIMARY KEY |
| `applications[].userId` | `applications.user_id` | 直接映射 | FOREIGN KEY |
| `applications[].type` | `applications.type` | 直接映射 | code/image/pro/resource |
| `applications[].status` | `applications.status` | 直接映射 | 18 种状态 |
| `applications[].title` | `applications.title` | 直接映射 | |
| `applications[].description` | `applications.description` | 直接映射 | |
| `applications[].baseCost` | `applications.base_cost` | 直接映射 | INTEGER |
| `applications[].cost` | `applications.cost` | 直接映射 | INTEGER |
| `applications[].costCharged` | `applications.cost_charged` | 直接映射 | BOOLEAN |
| `applications[].githubRepo` | `applications.github_repo` | 直接映射 | |
| `applications[].hasOpenSourceBadge` | `applications.has_open_source_badge` | 直接映射 | BOOLEAN |
| `applications[].storageExtended` | `applications.storage_extended` | 直接映射 | BOOLEAN |
| `applications[].retentionExpiresAt` | `applications.retention_expires_at` | 直接映射 | TIMESTAMPTZ |
| `applications[].createdAt` | `applications.created_at` | 直接映射 | TIMESTAMPTZ |
| `applications[].submittedAt` | `applications.submitted_at` | 直接映射 | TIMESTAMPTZ |
| `applications[].updatedAt` | `applications.updated_at` | 直接映射 | TIMESTAMPTZ |

### 2.2 附件 → application_attachments 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `applications[].attachments[].id` | `id` | 如无则生成 |
| `applications[].attachments[].name` | `file_name` | 直接映射 |
| `applications[].attachments[].size` | `file_size` | 直接映射 |
| `applications[].attachments[].type` | `mime_type` | 直接映射 |
| `applications[].attachments[].url` | `storage_key` | 提取存储键 |
| - | `application_id` | 父记录ID |

### 2.3 消息 → application_messages 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `applications[].messages[].id` | `id` | 如无则生成 |
| `applications[].messages[].senderId` | `sender_user_id` | 直接映射 |
| `applications[].messages[].type` | `type` | 直接映射 |
| `applications[].messages[].content` | `content` | 直接映射 |
| `applications[].messages[].attachments` | `attachments` | 保留 JSONB |
| `applications[].messages[].createdAt` | `created_at` | 直接映射 |
| - | `application_id` | 父记录ID |

### 2.4 资源项 → application_items 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `applications[].resourceItems[].id` | `id` | 如无则生成 |
| `applications[].resourceItems[].resourceType` | `resource_type` | 直接映射 |
| `applications[].resourceItems[].resourceSubtype` | `resource_subtype` | 直接映射 |
| `applications[].resourceItems[]` | `payload` | 整个对象作为 JSONB |
| `applications[].resourceItems[].approvalStatus` | `approval_status` | 直接映射 |
| `applications[].resourceItems[].provisionStatus` | `provision_status` | 直接映射 |
| - | `application_id` | 父记录ID |

---

## 3. state.studentVerifications → student_verifications 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `studentVerifications[].id` | `id` | 直接映射 |
| `studentVerifications[].userId` | `user_id` | 直接映射 |
| `studentVerifications[].status` | `status` | 直接映射 |
| `studentVerifications[].category` | `category` | 直接映射 |
| `studentVerifications[].notes` | `notes` | 直接映射 |
| `studentVerifications[].attachments` | `attachments` | 保留 JSONB |
| `studentVerifications[].reviewFee` | `review_fee` | 直接映射 |
| `studentVerifications[].feeReturned` | `fee_returned` | 直接映射 |
| `studentVerifications[].educationEmail` | `education_email` | 直接映射 |
| `studentVerifications[].educationEmailVerified` | `education_email_verified` | 直接映射 |
| `studentVerifications[].reply` | `reply` | 直接映射 |
| `studentVerifications[].reviewedAt` | `reviewed_at` | 直接映射 |
| `studentVerifications[].reviewedBy` | `reviewed_by` | 直接映射 |
| `studentVerifications[].createdAt` | `created_at` | 直接映射 |

---

## 4. state.coupons → user_coupons 表（已存在）

✅ 直接使用现有快照表 `user_coupons`（0013 migration）

---

## 5. state.dailyCheckIns → daily_check_ins 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `dailyCheckIns[].id` | `id` | 如无则生成 |
| `dailyCheckIns[].userId` | `user_id` | 直接映射 |
| `dailyCheckIns[].dateKey` | `date_key` | 直接映射 (YYYY-MM-DD) |
| `dailyCheckIns[].points` | `points` | 直接映射 |
| `dailyCheckIns[].streak` | `streak` | 直接映射 |
| `dailyCheckIns[].createdAt` | `created_at` | 直接映射 |

---

## 6. state.invitationBindings → invitation_bindings 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `invitationBindings[].id` | `id` | 如无则生成 |
| `invitationBindings[].code` | `code` | 直接映射 |
| `invitationBindings[].inviterUserId` | `inviter_user_id` | 直接映射 |
| `invitationBindings[].inviteeUserId` | `invitee_user_id` | 直接映射 |
| `invitationBindings[].vouched` | `vouched` | 直接映射 |
| `invitationBindings[].vouchedAt` | `vouched_at` | 直接映射 |
| `invitationBindings[].rewardGranted` | `reward_granted` | 直接映射 |
| `invitationBindings[].rewardGrantedAt` | `reward_granted_at` | 直接映射 |
| `invitationBindings[].createdAt` | `created_at` | 直接映射 |

---

## 7. state.squarePosts → square_posts 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `squarePosts[].id` | `id` | 直接映射 |
| `squarePosts[].userId` | `user_id` | 直接映射 |
| `squarePosts[].type` | `type` | 直接映射 |
| `squarePosts[].title` | `title` | 直接映射 |
| `squarePosts[].content` | `content` | 直接映射 |
| `squarePosts[].applicationId` | `application_id` | 直接映射 |
| `squarePosts[].template` | `template` | 保留 JSONB |
| `squarePosts[].createdAt` | `created_at` | 直接映射 |

---

## 8. state.squareBoosts → square_boosts 表

| JSONB 字段 | 目标列 | 转换规则 |
|-----------|--------|---------|
| `squareBoosts[].id` | `id` | 直接映射 |
| `squareBoosts[].postId` | `post_id` | 直接映射 |
| `squareBoosts[].userId` | `user_id` | 直接映射 |
| `squareBoosts[].mode` | `mode` | 直接映射 |
| `squareBoosts[].declaration` | `declaration` | 直接映射 |
| `squareBoosts[].pointsGranted` | `points_granted` | 直接映射 |
| `squareBoosts[].createdAt` | `created_at` | 直接映射 |

---

## 9. 复杂字段处理策略

### 9.1 JSONB 保留字段

某些复杂结构暂时保留为 JSONB：

| 表 | 字段 | 原因 |
|----|------|------|
| `applications` | `pricing_snapshot` | 定价快照，结构复杂且不查询 |
| `applications` | `ai_review_metadata` | AI 审核元数据 |
| `applications` | `llm_api_rate_limits` | 速率限制配置，结构灵活 |
| `applications` | `answer_attachments` | 答复附件列表 |
| `application_items` | `payload` | 资源配置详情，类型差异大 |
| `application_items` | `requested_quota` | 请求配额 |
| `application_items` | `provision_result` | 开通结果 |
| `application_messages` | `attachments` | 消息附件列表 |
| `student_verifications` | `attachments` | 认证材料附件 |
| `student_verifications` | `education_email_analysis` | 教育邮箱分析结果 |
| `square_posts` | `template` | 申请模板 |

### 9.2 数组字段处理

**一对多关系 → 子表**:
```typescript
// ❌ JSONB 数组
applications[].attachments: Attachment[]

// ✅ 子表
CREATE TABLE application_attachments (
  application_id TEXT REFERENCES applications(id),
  ...
)
```

**不持久化的数组**:
```typescript
// users[].profile.githubRepos
// ↓ 不存储，按需从 GitHub API 获取
```

### 9.3 计算字段

**不存储，通过查询计算**:

```sql
-- users[].points
SELECT COALESCE(SUM(amount), 0) 
FROM point_transactions 
WHERE user_id = $1;

-- users[].activeRequestCount
SELECT COUNT(*) 
FROM applications 
WHERE user_id = $1 
  AND status NOT IN ('completed', 'closed', 'rejected', 'cancelled');

-- squarePosts[].boostCount
SELECT COUNT(*) 
FROM square_boosts 
WHERE post_id = $1;
```

---

## 10. 数据完整性约束

### 10.1 外键约束

```sql
-- 用户相关
applications.user_id → users.id
student_verifications.user_id → users.id
daily_check_ins.user_id → users.id

-- 申请相关
application_attachments.application_id → applications.id
application_messages.application_id → applications.id
application_items.application_id → applications.id

-- 优惠券相关
coupon_codes.template_id → coupon_templates.id
user_coupons.user_id → users.id

-- 广场相关
square_posts.user_id → users.id
square_posts.application_id → applications.id (可为 NULL)
square_boosts.post_id → square_posts.id
square_boosts.user_id → users.id
```

### 10.2 唯一约束

```sql
users (email)
users (invitation_code)
coupon_codes (code)
daily_check_ins (user_id, date_key)
invitation_bindings (invitee_user_id)
square_boosts (post_id, user_id)
```

### 10.3 CHECK 约束

```sql
users.role IN ('user', 'admin', 'reviewer')
users.account_status IN ('active', 'suspended')
applications.type IN ('code', 'image', 'pro', 'resource')
applications.status IN (18 种状态)
student_verifications.status IN (5 种状态)
coupon_templates.discount_type IN ('rate', 'fixed_points', 'fixed_ldc')
```

---

## 11. 迁移验证清单

### 数据完整性检查

```sql
-- 1. 记录数量一致
SELECT COUNT(*) FROM users;
-- vs. jsonb_array_length(state->'users')

-- 2. 关键字段非空
SELECT COUNT(*) FROM users WHERE email IS NULL;
-- 应该为 0

-- 3. 外键完整性
SELECT COUNT(*) FROM applications a
LEFT JOIN users u ON a.user_id = u.id
WHERE u.id IS NULL;
-- 应该为 0

-- 4. 积分总额一致
SELECT user_id, SUM(amount) as total
FROM point_transactions
GROUP BY user_id
-- vs. state.users[].points

-- 5. 时间戳格式
SELECT COUNT(*) FROM users 
WHERE created_at IS NULL OR created_at > NOW();
-- 应该为 0
```

---

## 12. 不迁移的字段

### 临时字段
- `state.transactions` - 临时交易列表，每次加载清空
- `state.currentUserId` - 前端临时状态

### 计算字段
- `users[].points` - 从 point_transactions 计算
- `users[].activeRequestCount` - 查询计算
- `squarePosts[].boostCount` - 查询计算

### 运行时状态
- `users[].profile.githubRepos` - 按需从 API 获取
- 所有前端 UI 状态

---

**文档状态**: ✅ 完成  
**下一步**: 实现迁移脚本 (Task 1.3)
