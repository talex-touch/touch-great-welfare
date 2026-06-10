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

> ⚠️ 执行前先确认 D1 migration 与迁移脚本/读取代码的 schema 契约一致。

### Step 4: 暂缓启用双写 🔄

当前 Repository 双写仍是原型路径，生产 API 尚未统一接入。不要仅通过 Cloudflare Dashboard 添加 `MIGRATION_WRITE_MODE` / `MIGRATION_READ_SOURCE` 来启用双写；请先完成 DEPLOYMENT_GUIDE.md 中的生产路径对齐检查。

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
