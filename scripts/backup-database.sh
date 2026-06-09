#!/usr/bin/env bash

# 数据库备份脚本
# 用法: ./scripts/backup-database.sh

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🔒 数据库备份脚本${NC}"
echo ""

# 检查环境变量
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ 错误: DATABASE_URL 环境变量未设置${NC}"
  echo ""
  echo "请设置 DATABASE_URL:"
  echo "  export DATABASE_URL='postgresql://user:pass@host:port/dbname'"
  exit 1
fi

# 生成备份文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
BACKUP_FILE="$BACKUP_DIR/welfare_backup_$TIMESTAMP.sql"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}📊 备份信息:${NC}"
echo "  时间: $TIMESTAMP"
echo "  目标: $BACKUP_FILE"
echo ""

# 开始备份
echo -e "${YELLOW}⏳ 开始备份...${NC}"

# 使用 pg_dump 备份
# --clean: 生成清理命令
# --if-exists: 如果对象存在才清理
# --no-owner: 不设置对象所有者
# --no-acl: 不导出权限
if pg_dump "$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  > "$BACKUP_FILE"; then

  echo -e "${GREEN}✅ 备份完成!${NC}"
  echo ""

  # 显示备份文件信息
  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo -e "${GREEN}📦 备份文件信息:${NC}"
  echo "  路径: $BACKUP_FILE"
  echo "  大小: $FILE_SIZE"
  echo ""

  # 验证备份文件
  LINE_COUNT=$(wc -l < "$BACKUP_FILE")
  echo -e "${YELLOW}🔍 快速验证:${NC}"
  echo "  行数: $LINE_COUNT"

  # 检查关键表
  if grep -q "welfare_app_state" "$BACKUP_FILE"; then
    echo "  ✅ 包含 welfare_app_state 表"
  else
    echo -e "  ${RED}⚠️  未找到 welfare_app_state 表${NC}"
  fi

  if grep -q "point_transactions" "$BACKUP_FILE"; then
    echo "  ✅ 包含 point_transactions 表"
  else
    echo "  ⚠️  未找到 point_transactions 表（可能还没创建）"
  fi

  echo ""
  echo -e "${GREEN}🎉 备份成功！${NC}"
  echo ""
  echo -e "${YELLOW}💾 恢复方法:${NC}"
  echo "  psql \$DATABASE_URL < $BACKUP_FILE"
  echo ""
  echo -e "${YELLOW}⚠️  重要提示:${NC}"
  echo "  1. 请妥善保存备份文件"
  echo "  2. 建议上传到云存储（S3/OSS/云盘）"
  echo "  3. 在执行任何操作前，先测试恢复流程"
  echo ""

else
  echo -e "${RED}❌ 备份失败!${NC}"
  echo ""
  echo "请检查:"
  echo "  1. DATABASE_URL 是否正确"
  echo "  2. 网络连接是否正常"
  echo "  3. 数据库权限是否足够"
  exit 1
fi
