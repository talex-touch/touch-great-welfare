# 🚀 Cloudflare 部署指南

**数据库**: Cloudflare D1 (LOCAL_DB)  
**环境**: Cloudflare Workers

---

## 📋 快速开始

### Step 1: 备份 D1 🔒

```bash
mkdir -p backups
wrangler d1 export LOCAL_DB --output=backups/backup_$(date +%Y%m%d).sql
```

### Step 2: 部署 Phase 0 ⚡

```bash
pnpm test && pnpm build && pnpm deploy
```

### Step 3: 创建表 🏗️

```bash
wrangler d1 migrations apply LOCAL_DB
```

### Step 4: 启用双写 🔄

在 Cloudflare Dashboard:
- Settings → Variables
- 添加: `MIGRATION_WRITE_MODE` = `dual-write`
- 添加: `MIGRATION_READ_SOURCE` = `state`

### Step 5: 监控 📊

```bash
wrangler tail --format pretty
```

---

## 🚨 回滚

```bash
wrangler rollback
```

---

**详细步骤**: 见 DEPLOYMENT_GUIDE.md
