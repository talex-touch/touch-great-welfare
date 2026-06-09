-- ============================================
-- Migration 0019: 规范化数据库架构 (SQLite 版本)
-- 目标: 从单体 JSONB 迁移到规范化表结构
-- 日期: 2026-06-09
-- 适用于: Cloudflare D1 (SQLite)
-- ============================================

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
  role TEXT NOT NULL DEFAULT 'user',
  account_status TEXT NOT NULL DEFAULT 'active',

  -- 积分
  points INTEGER NOT NULL DEFAULT 0,
  points_updated_at TEXT,

  -- GitHub 认证
  github_username TEXT,
  github_authorized INTEGER DEFAULT 0,
  selected_repo TEXT,

  -- 学生认证
  student_verified INTEGER DEFAULT 0,
  student_verified_at TEXT,

  -- 邀请
  invitation_code TEXT UNIQUE,
  invited_by_user_id TEXT,

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_invitation_code ON users(invitation_code);

-- ============================================
-- 积分交易表
-- ============================================
CREATE TABLE IF NOT EXISTS point_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  
  type TEXT NOT NULL,
  reason TEXT,
  
  application_id TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_user_id ON point_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_created_at ON point_transactions(created_at);

-- ============================================
-- 申请表
-- ============================================
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  
  title TEXT NOT NULL,
  description TEXT,
  
  base_cost INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  cost_charged INTEGER DEFAULT 0,
  cost_charged_at TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  completed_at TEXT,
  
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_type ON applications(type);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at DESC);

-- ============================================
-- 学生认证记录
-- ============================================
CREATE TABLE IF NOT EXISTS student_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  
  education_email TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  
  code_sent TEXT,
  code_expires_at TEXT,
  
  verified_at TEXT,
  verification_source TEXT,
  
  balance INTEGER NOT NULL DEFAULT 0,
  last_awarded_at TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_student_verifications_user_id ON student_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_student_verifications_email ON student_verifications(education_email);

-- ============================================
-- 申请附件表
-- ============================================
CREATE TABLE IF NOT EXISTS application_attachments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  
  url TEXT NOT NULL,
  filename TEXT,
  file_type TEXT,
  file_size INTEGER,
  
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_application_attachments_application_id ON application_attachments(application_id);

-- ============================================
-- 申请消息表
-- ============================================
CREATE TABLE IF NOT EXISTS application_messages (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  
  author_id TEXT NOT NULL,
  author_role TEXT NOT NULL,
  
  content TEXT NOT NULL,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_application_messages_application_id ON application_messages(application_id);
CREATE INDEX IF NOT EXISTS idx_application_messages_created_at ON application_messages(created_at);
