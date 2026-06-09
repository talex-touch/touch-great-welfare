-- ============================================
-- Migration 0018: 规范化数据库架构
-- 目标: 从单体 JSONB 迁移到规范化表结构
-- 日期: 2026-06-09
-- ============================================

-- ============================================
-- 辅助函数：自动更新 updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
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

  -- 积分（从 point_transactions 同步）
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

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_github ON users(github_username)
  WHERE github_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
  WHERE role != 'user';
CREATE INDEX IF NOT EXISTS idx_users_invitation_code ON users(invitation_code)
  WHERE invitation_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_student_verified ON users(student_verified)
  WHERE student_verified = TRUE;

-- 触发器：自动更新 updated_at
DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 申请表（规范化）
-- ============================================
CREATE TABLE IF NOT EXISTS applications (
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
  pricing_snapshot JSONB,

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

-- 申请表核心索引
CREATE INDEX IF NOT EXISTS idx_applications_user_created
  ON applications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_user_status
  ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_status_created
  ON applications(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_applications_type_status
  ON applications(type, status);

-- 管理员审核队列优化
CREATE INDEX IF NOT EXISTS idx_applications_pending_review
  ON applications(created_at ASC)
  WHERE status IN ('pending_review', 'needs_supplement');

-- AI 审核队列
CREATE INDEX IF NOT EXISTS idx_applications_ai_pending
  ON applications(created_at ASC)
  WHERE ai_review_status IS NULL AND status = 'pending_review';

-- 交付队列优化
CREATE INDEX IF NOT EXISTS idx_applications_delivery_available
  ON applications(created_at ASC)
  WHERE status IN ('answered', 'pending_allocation', 'delivered')
    AND delivery_rewarded_at IS NULL;

-- 过期清理索引
CREATE INDEX IF NOT EXISTS idx_applications_retention_expires
  ON applications(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;

-- 触发器
DROP TRIGGER IF EXISTS applications_updated_at ON applications;
CREATE TRIGGER applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 申请附件表
-- ============================================
CREATE TABLE IF NOT EXISTS application_attachments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,

  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  storage_key TEXT NOT NULL,

  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_attachments_application
  ON application_attachments(application_id);

-- ============================================
-- 申请消息表
-- ============================================
CREATE TABLE IF NOT EXISTS application_messages (
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

CREATE INDEX IF NOT EXISTS idx_application_messages_application
  ON application_messages(application_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_application_messages_sender
  ON application_messages(sender_user_id);

-- ============================================
-- 资源申请项表
-- ============================================
CREATE TABLE IF NOT EXISTS application_items (
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

CREATE INDEX IF NOT EXISTS idx_application_items_application
  ON application_items(application_id);
CREATE INDEX IF NOT EXISTS idx_application_items_status
  ON application_items(approval_status, provision_status);
CREATE INDEX IF NOT EXISTS idx_application_items_lifecycle_expires
  ON application_items(lifecycle_expires_at)
  WHERE lifecycle_expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS application_items_updated_at ON application_items;
CREATE TRIGGER application_items_updated_at
BEFORE UPDATE ON application_items
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 学生认证表
-- ============================================
CREATE TABLE IF NOT EXISTS student_verifications (
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

CREATE INDEX IF NOT EXISTS idx_student_verifications_user
  ON student_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_student_verifications_status
  ON student_verifications(status);
CREATE INDEX IF NOT EXISTS idx_student_verifications_pending
  ON student_verifications(created_at ASC)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS student_verifications_updated_at ON student_verifications;
CREATE TRIGGER student_verifications_updated_at
BEFORE UPDATE ON student_verifications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 教育邮箱认证挑战表
-- ============================================
CREATE TABLE IF NOT EXISTS education_email_challenges (
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

CREATE INDEX IF NOT EXISTS idx_education_email_challenges_user
  ON education_email_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_education_email_challenges_email
  ON education_email_challenges(email);
CREATE INDEX IF NOT EXISTS idx_education_email_challenges_code
  ON education_email_challenges(verification_code);
CREATE INDEX IF NOT EXISTS idx_education_email_challenges_expires
  ON education_email_challenges(expires_at)
  WHERE NOT verified;

-- ============================================
-- 优惠券模板表
-- ============================================
CREATE TABLE IF NOT EXISTS coupon_templates (
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

DROP TRIGGER IF EXISTS coupon_templates_updated_at ON coupon_templates;
CREATE TRIGGER coupon_templates_updated_at
BEFORE UPDATE ON coupon_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 优惠券码表
-- ============================================
CREATE TABLE IF NOT EXISTS coupon_codes (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,

  max_redemptions INTEGER DEFAULT 1,
  redemption_count INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_codes_code ON coupon_codes(code);
CREATE INDEX IF NOT EXISTS idx_coupon_codes_template ON coupon_codes(template_id);
CREATE INDEX IF NOT EXISTS idx_coupon_codes_active ON coupon_codes(expires_at)
  WHERE expires_at IS NULL OR expires_at > NOW();

-- ============================================
-- 用户优惠券表（兼容已有表）
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
CREATE TABLE IF NOT EXISTS daily_check_ins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  date_key TEXT NOT NULL,  -- YYYY-MM-DD 格式
  points INTEGER NOT NULL,
  streak INTEGER NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_check_ins_user_date
  ON daily_check_ins(user_id, date_key DESC);
CREATE INDEX IF NOT EXISTS idx_daily_check_ins_date
  ON daily_check_ins(date_key);

-- ============================================
-- 邀请绑定表
-- ============================================
CREATE TABLE IF NOT EXISTS invitation_bindings (
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

CREATE INDEX IF NOT EXISTS idx_invitation_bindings_inviter
  ON invitation_bindings(inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_bindings_invitee
  ON invitation_bindings(invitee_user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_bindings_code
  ON invitation_bindings(code);

-- ============================================
-- 广场帖子表
-- ============================================
CREATE TABLE IF NOT EXISTS square_posts (
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

CREATE INDEX IF NOT EXISTS idx_square_posts_type_created
  ON square_posts(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_square_posts_user
  ON square_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_square_posts_application
  ON square_posts(application_id);

DROP TRIGGER IF EXISTS square_posts_updated_at ON square_posts;
CREATE TRIGGER square_posts_updated_at
BEFORE UPDATE ON square_posts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 广场助力表
-- ============================================
CREATE TABLE IF NOT EXISTS square_boosts (
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

CREATE INDEX IF NOT EXISTS idx_square_boosts_post
  ON square_boosts(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_square_boosts_user
  ON square_boosts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_square_boosts_reported
  ON square_boosts(reported_at)
  WHERE reported_at IS NOT NULL;

-- ============================================
-- 广场举报表
-- ============================================
CREATE TABLE IF NOT EXISTS square_reports (
  id TEXT PRIMARY KEY,
  boost_id TEXT NOT NULL REFERENCES square_boosts(id) ON DELETE CASCADE,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  reason TEXT NOT NULL,

  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_square_reports_boost
  ON square_reports(boost_id);
CREATE INDEX IF NOT EXISTS idx_square_reports_reporter
  ON square_reports(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_square_reports_pending
  ON square_reports(created_at ASC)
  WHERE NOT reviewed;

-- ============================================
-- 协作申请表
-- ============================================
CREATE TABLE IF NOT EXISTS collaboration_applications (
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

CREATE INDEX IF NOT EXISTS idx_collaboration_applications_user
  ON collaboration_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_collaboration_applications_status
  ON collaboration_applications(status, created_at ASC);

-- ============================================
-- 众包审核表
-- ============================================
CREATE TABLE IF NOT EXISTS crowd_reviews (
  id TEXT PRIMARY KEY,
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  target_type TEXT NOT NULL CHECK (target_type IN ('pro_application')),
  target_id TEXT NOT NULL,

  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'needs_admin')),
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crowd_reviews_reviewer
  ON crowd_reviews(reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_crowd_reviews_target
  ON crowd_reviews(target_type, target_id);

-- ============================================
-- 系统配置表
-- ============================================
CREATE TABLE IF NOT EXISTS system_configs (
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
('oauth', '{}', 'OAuth 配置')
ON CONFLICT (key) DO NOTHING;

DROP TRIGGER IF EXISTS system_configs_updated_at ON system_configs;
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

-- ============================================
-- 完成
-- ============================================
-- Migration 0018 完成
-- 总计创建: 17 张表, 60+ 个索引, 8 个触发器
