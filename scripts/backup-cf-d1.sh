#!/usr/bin/env bash

# Cloudflare D1 数据库备份脚本

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🔒 Cloudflare D1 数据库备份${NC}"
echo ""

# 检查 wrangler
if ! command -v wrangler &> /dev/null; then
  echo -e "${RED}❌ 错误: wrangler 未安装${NC}"
  echo "请先安装: npm install -g wrangler"
  exit 1
fi

# 生成备份文件名
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
BACKUP_FILE="$BACKUP_DIR/d1_backup_$TIMESTAMP.sql"

mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}📊 备份信息:${NC}"
echo "  时间: $TIMESTAMP"
echo "  目标: $BACKUP_FILE"
echo ""

# 导出 D1 数据库
echo -e "${YELLOW}⏳ 导出 D1 数据库...${NC}"

# 使用 wrangler d1 export
if wrangler d1 export LOCAL_DB --output="$BACKUP_FILE" 2>/dev/null; then
  echo -e "${GREEN}✅ D1 备份完成!${NC}"
else
  echo -e "${YELLOW}⚠️  D1 导出失败，尝试直接从 welfare_app_state 导出...${NC}"
  
  # 备用方案：导出关键数据
  wrangler d1 execute LOCAL_DB --command="SELECT * FROM welfare_app_state;" > "$BACKUP_FILE"
fi

# 显示备份信息
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo ""
echo -e "${GREEN}📦 备份文件:${NC}"
echo "  路径: $BACKUP_FILE"
echo "  大小: $FILE_SIZE"
echo ""

# 额外：导出为 JSON
JSON_BACKUP="$BACKUP_DIR/d1_state_$TIMESTAMP.json"
echo -e "${YELLOW}📄 导出 JSON 格式...${NC}"
wrangler d1 execute LOCAL_DB --command="SELECT state FROM welfare_app_state WHERE id='default';" --json > "$JSON_BACKUP"

echo -e "${GREEN}✅ JSON 备份完成: $JSON_BACKUP${NC}"
echo ""

echo -e "${GREEN}🎉 备份完成！${NC}"
echo ""
echo -e "${YELLOW}💾 恢复方法:${NC}"
echo "  wrangler d1 execute LOCAL_DB --file=$BACKUP_FILE"
echo ""
