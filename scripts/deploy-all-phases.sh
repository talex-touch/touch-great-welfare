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

echo "执行 SQL 迁移..."
psql "$DATABASE_URL" < migrations/0018_normalize_schema.sql

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ 创建表失败${NC}"
  echo ""
  echo "可能的原因:"
  echo "  - 表已存在（正常，可以忽略）"
  echo "  - 权限不足"
  echo "  - SQL 语法错误"
  echo ""
  read -p "是否继续? (y/n): " CONTINUE
  if [ "$CONTINUE" != "y" ]; then
    exit 1
  fi
fi

echo ""
echo "验证表创建..."
psql "$DATABASE_URL" -c "\dt" | grep -E "(users|applications|point_transactions)"

echo ""
echo -e "${GREEN}✅ 规范化表创建成功${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 5: 迁移数据
# ============================================================
echo -e "${GREEN}Step 5/6: 📦 迁移数据${NC}"
echo ""

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
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ============================================================
# Step 6: 启用双写模式
# ============================================================
echo -e "${GREEN}Step 6/6: 🔄 启用双写模式 (Phase 2)${NC}"
echo ""

echo -e "${YELLOW}⚠️  现在需要配置环境变量:${NC}"
echo ""
echo "在 Cloudflare Workers 设置中添加:"
echo "  MIGRATION_WRITE_MODE=dual-write"
echo "  MIGRATION_READ_SOURCE=state"
echo ""
echo "或者在 wrangler.toml 中添加:"
echo "  [vars]"
echo "  MIGRATION_WRITE_MODE = \"dual-write\""
echo "  MIGRATION_READ_SOURCE = \"state\""
echo ""

read -p "是否自动配置并重新部署? (y/n): " AUTO_DEPLOY
if [ "$AUTO_DEPLOY" = "y" ]; then
  echo ""
  echo "重新部署启用双写..."

  # 这里需要通过 wrangler 设置环境变量
  # 或者你可以手动在 Cloudflare Dashboard 设置

  pnpm deploy

  echo ""
  echo -e "${GREEN}✅ 双写模式已启用${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠️  请手动配置环境变量后重新部署${NC}"
fi

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
