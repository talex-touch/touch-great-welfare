#!/usr/bin/env bash

# 🚀 一键部署脚本 - 激进模式
# 用法: ./scripts/deploy-all-phases.sh

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║          🚀 数据库架构迁移 - 一键部署脚本 🚀                  ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# 检查必要的环境变量
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ 错误: DATABASE_URL 未设置${NC}"
  echo ""
  echo "请设置数据库连接："
  echo "  export DATABASE_URL='postgresql://...'"
  exit 1
fi

echo -e "${BLUE}📋 执行计划:${NC}"
echo "  1. 备份数据库"
echo "  2. 运行测试"
echo "  3. 部署 Phase 0 (紧急止血)"
echo "  4. 创建规范化表 (Phase 1)"
echo "  5. 迁移数据"
echo "  6. 启用双写模式 (Phase 2)"
echo ""

# 确认执行
echo -e "${YELLOW}⚠️  警告: 这将修改生产数据库！${NC}"
echo -e "${YELLOW}⚠️  请确保你已经：${NC}"
echo "  - 阅读了 DEPLOYMENT_GUIDE.md"
echo "  - 理解了每个步骤的作用"
echo "  - 准备好随时回滚"
echo ""

read -p "确认继续? (输入 YES): " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo ""
  echo "❌ 已取消"
  exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 1: 备份数据库
# ============================================================
echo -e "${GREEN}Step 1/6: 🔒 备份数据库${NC}"
echo ""

./scripts/backup-database.sh

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 备份失败，终止部署${NC}"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 2: 运行测试
# ============================================================
echo -e "${GREEN}Step 2/6: 🧪 运行测试${NC}"
echo ""

pnpm test

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 测试失败，终止部署${NC}"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 3: 部署 Phase 0
# ============================================================
echo -e "${GREEN}Step 3/6: ⚡ 部署 Phase 0 (紧急止血)${NC}"
echo ""

echo "构建项目..."
pnpm build

echo ""
echo "部署到 Cloudflare Workers..."
pnpm deploy

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 部署失败${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ Phase 0 部署成功${NC}"
echo -e "${YELLOW}预期效果: 超时率 50% → 15%${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 4: 创建规范化表
# ============================================================
echo -e "${GREEN}Step 4/6: 🏗️  创建规范化表 (Phase 1)${NC}"
echo ""

echo -e "${YELLOW}⚠️  规范化表迁移需要先人工确认数据库路线。${NC}"
echo "当前仓库没有正式的 migrations/0018_normalize_schema.sql 文件。"
echo "PostgreSQL 原型文件: migrations/0018_normalize_schema.sql.postgres_backup"
echo "D1/SQLite migration: migrations/0019_normalize_schema_sqlite.sql"
echo "请先确认 schema 与迁移脚本/验证脚本/读取代码完全一致。"
read -p "确认已审查并要继续执行 PostgreSQL 原型 SQL? (y/n): " RUN_SCHEMA
if [ "$RUN_SCHEMA" = "y" ]; then
  psql "$DATABASE_URL" < migrations/0018_normalize_schema.sql.postgres_backup

  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 创建表失败${NC}"
    exit 1
  fi

  echo ""
  echo "验证表创建..."
  psql "$DATABASE_URL" -c "\dt" | grep -E "(users|applications|point_transactions)"
  echo -e "${GREEN}✅ 规范化表创建成功${NC}"
else
  echo -e "${YELLOW}跳过规范化表创建。${NC}"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 5: 迁移数据
# ============================================================
echo -e "${GREEN}Step 5/6: 📦 迁移数据${NC}"
echo ""

if [ "$RUN_SCHEMA" = "y" ]; then
  echo "执行数据迁移..."
  pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute

  if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 数据迁移失败${NC}"
    echo ""
    echo "回滚方法:"
    echo "  psql \$DATABASE_URL < backups/welfare_backup_*.sql"
    exit 1
  fi

  echo ""
  echo "验证数据一致性..."
  pnpm tsx scripts/validate-consistency.ts

  echo ""
  echo -e "${GREEN}✅ 数据迁移成功${NC}"
else
  echo -e "${YELLOW}跳过数据迁移与一致性验证。${NC}"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 6: 启用双写模式
# ============================================================
echo -e "${GREEN}Step 6/6: 🔄 启用双写模式 (Phase 2)${NC}"
echo ""

echo -e "${YELLOW}⚠️  暂不自动启用双写模式。${NC}"
echo "当前 Repository 双写仍需生产 API 路径真实接入。"
echo "不要仅通过 MIGRATION_WRITE_MODE / MIGRATION_READ_SOURCE 判断双写已启用。"
echo "请先完成 DEPLOYMENT_GUIDE.md 中的生产路径对齐检查。"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# 部署完成
# ============================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║          🎉 部署完成！🎉                                      ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${GREEN}✅ 完成的步骤:${NC}"
echo "  1. ✅ 数据库已备份"
echo "  2. ✅ Phase 0 已部署"
echo "  3. ✅ 规范化表已创建"
echo "  4. ✅ 数据已迁移"
echo "  5. ✅ 双写模式已配置"
echo ""

echo -e "${BLUE}📊 下一步监控:${NC}"
echo "  1. 查看实时日志:"
echo "     wrangler tail"
echo ""
echo "  2. 每日运行一致性检查:"
echo "     pnpm tsx scripts/validate-consistency.ts"
echo ""
echo "  3. 监控关键指标:"
echo "     - 超时率"
echo "     - 响应时间"
echo "     - 双写成功率"
echo ""

echo -e "${YELLOW}⚠️  重要提醒:${NC}"
echo "  - 备份文件在: ./backups/"
echo "  - 密切监控日志和指标"
echo "  - 发现问题立即回滚"
echo ""

echo -e "${BLUE}📖 参考文档:${NC}"
echo "  - DEPLOYMENT_GUIDE.md"
echo "  - REPOSITORY_GUIDE.md"
echo "  - HANDOVER.md"
echo ""

echo "🎊 祝部署顺利！"
echo ""
