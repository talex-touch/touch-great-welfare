# 🚀 部署指南

**项目**: Touch Great Welfare - 数据库架构迁移  
**版本**: Phase 0-2  
**状态**: ✅ Phase 0 可部署；Phase 2 需完成生产路径对齐后再启用

---

## 📋 部署前检查清单

### ✅ 代码准备

- [x] Phase 0: 紧急止血代码
- [x] Phase 1: 数据库 Schema 原型 (`0018_normalize_schema.sql.postgres_backup` / `0019_normalize_schema_sqlite.sql`)
- [x] Phase 2: Repository 抽象层原型
- [x] 数据迁移脚本原型
- [x] 一致性验证工具原型
- [ ] 生产数据库目标确认（D1 或 Hyperdrive/PostgreSQL）
- [ ] 生产 API 路径真实接入 Repository / D1 双写
- [x] 单元测试（25+ 测试用例）

### ✅ 文档准备

- [x] 完整技术文档（12 份，15,000+ 行）
- [x] 迁移计划（MIGRATION_PLAN.md）
- [x] 使用指南（REPOSITORY_GUIDE.md）
- [x] 测试指南（TESTING_GUIDE.md）

---

## 🎯 部署步骤

### Phase 0: 紧急止血（立即部署）

**目标**: 降低超时率 50% → 15%

#### 1. 本地验证

```bash
# 运行测试
pnpm test

# 构建
pnpm build

# 本地验证
pnpm dev
```

#### 2. 部署到生产

```bash
# 部署
pnpm deploy

# 或使用 Wrangler
wrangler deploy
```

#### 3. 验证效果

```bash
# 监控日志
wrangler tail

# 关注指标:
# - [welfare:perf:SLOW] 消息数量
# - [welfare:perf:WARN] 消息数量
# - 请求响应时间
```

**预期效果**:
- ✅ 超时率: 50% → 15%
- ✅ 管理员操作: 10-20s → 2-5s
- ✅ 无功能回归

---

### Phase 1: 创建规范化表（测试环境）

**目标**: 创建规范化表并验证 schema 契约

> ⚠️ 当前仓库没有 `migrations/0018_normalize_schema.sql` 正式文件；PostgreSQL 版本保存在 `migrations/0018_normalize_schema.sql.postgres_backup`，D1/SQLite 版本为 `migrations/0019_normalize_schema_sqlite.sql`。执行前必须先确认生产数据库目标，并确保迁移脚本、验证脚本、读取代码与所选 schema 列名一致。

#### 1. 备份数据库

```bash
# 备份生产数据库
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# 验证备份
psql $DATABASE_URL < backup_*.sql --dry-run
```

#### 2. 在测试环境执行

```bash
# 连接测试数据库
export DATABASE_URL="postgresql://test-db-url"

# PostgreSQL/Hyperdrive 路线（需先恢复并审查正式 SQL 文件）
psql $DATABASE_URL < migrations/0018_normalize_schema.sql.postgres_backup

# D1 路线
wrangler d1 migrations apply <database-name> --local --config wrangler.local.jsonc

# 验证表创建
psql $DATABASE_URL -c "\dt" # PostgreSQL
```

#### 3. 执行数据迁移（Dry-run）

```bash
# Dry-run 模式（不提交）
DATABASE_URL="$TEST_DATABASE_URL" \
  pnpm tsx scripts/migrate-jsonb-to-normalized.ts --dry-run

# 查看输出，确认无错误
```

#### 4. 执行数据迁移（正式）

```bash
# 正式执行
DATABASE_URL="$TEST_DATABASE_URL" \
  pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute

# 输出示例:
# ✅ Migrated 150 users
# ✅ Migrated 340 applications
# ✅ Migrated 89 student verifications
# ✅ Synced 150 user points
# 🎉 Migration complete!
```

#### 5. 验证数据一致性

```bash
# 运行一致性检查
DATABASE_URL="$TEST_DATABASE_URL" \
  pnpm tsx scripts/validate-consistency.ts

# 预期输出:
# ✅ All data is consistent!
```

---

### Phase 2: 启用双写模式（生产环境，暂缓）

**目标**: 同时写入 JSONB 和规范化表

> ⚠️ 暂缓直接启用。当前 Repository 主要基于 `pg.Pool` / Hyperdrive，生产 API 入口尚未统一接入 Repository 配置；仅设置 `MIGRATION_WRITE_MODE` 不会自动让现有业务路径进入双写。

#### 1. 在生产环境创建表

```bash
# ⚠️ 重要：先在生产环境备份
pg_dump $PROD_DATABASE_URL > prod_backup_$(date +%Y%m%d).sql

# PostgreSQL/Hyperdrive 路线（需先确认采用该路线）
psql $PROD_DATABASE_URL < migrations/0018_normalize_schema.sql.postgres_backup

# D1 路线应通过 wrangler d1 migrations apply 执行 SQLite migration
```

#### 2. 迁移生产数据

```bash
# Dry-run
DATABASE_URL="$PROD_DATABASE_URL" \
  pnpm tsx scripts/migrate-jsonb-to-normalized.ts --dry-run

# 确认无误后，正式执行
DATABASE_URL="$PROD_DATABASE_URL" \
  pnpm tsx scripts/migrate-jsonb-to-normalized.ts --execute
```

#### 3. 配置双写模式

暂不建议在生产配置 `MIGRATION_WRITE_MODE` / `MIGRATION_READ_SOURCE` 作为启用双写的依据。启用前必须满足：

- 生产 API 写路径已真实调用 Repository 或 D1 双写层。
- `loadMigrationConfigFromEnv(env)` 已在对应生产入口被调用。
- 所选数据库 schema 与迁移脚本、验证脚本、读取代码完全一致。
- 已有回滚策略：关闭双写并回退到 JSONB state。

#### 4. 部署启用双写

```bash
# 部署
pnpm deploy

# 监控
wrangler tail
```

#### 5. 验证双写成功

```bash
# 监控日志，查找真实生产写路径的双写日志。
# 注意：当前 Repository 原型只会在接入后的路径打印 [Repository] 日志。

# 每日运行一致性检查
DATABASE_URL="$PROD_DATABASE_URL" \
  pnpm tsx scripts/validate-consistency.ts
```

---

## ⏰ 定时任务设置

### 每日一致性检查

#### 方式 A: Cron（Linux/Mac）

```bash
# 编辑 crontab
crontab -e

# 添加任务（每天凌晨 3 点）
0 3 * * * cd /path/to/project && \
  DATABASE_URL="..." pnpm tsx scripts/validate-consistency.ts >> /var/log/consistency.log 2>&1
```

#### 方式 B: Cloudflare Workers Cron

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * *"]
```

```typescript
// 在 Worker 中处理
export default {
  async scheduled(event, env, ctx) {
    // 运行一致性检查
    const result = await validateConsistency(env)
    
    if (result.mismatches.length > 0) {
      // 发送告警
      await sendAlert(result)
    }
  }
}
```

#### 方式 C: GitHub Actions

```yaml
# .github/workflows/daily-check.yml
name: Daily Consistency Check

on:
  schedule:
    - cron: '0 3 * * *'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: pnpm install
      - run: pnpm tsx scripts/validate-consistency.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

## 📊 监控指标

### 关键指标

**性能指标**:
- P50/P95/P99 响应时间
- 超时率
- 请求成功率

**双写指标**:
- 双写成功率
- 双写延迟（P95/P99）
- 数据不一致数量

**业务指标**:
- 用户注册成功率
- 申请提交成功率
- 管理员操作完成率

### 监控工具

#### Cloudflare Analytics

```typescript
// 在 Worker 中添加
async function handleRequest(request: Request, env: Env) {
  const startTime = Date.now()
  
  try {
    const response = await processRequest(request, env)
    
    // 记录性能
    const duration = Date.now() - startTime
    env.METRICS?.writeDataPoint({
      blobs: ['welfare_request'],
      doubles: [duration],
      indexes: [request.url],
    })
    
    return response
  } catch (error) {
    // 记录错误
    env.METRICS?.writeDataPoint({
      blobs: ['welfare_error'],
      indexes: [error.message],
    })
    throw error
  }
}
```

#### 日志聚合

```bash
# 使用 wrangler tail 实时查看
wrangler tail --format pretty

# 导出日志到文件
wrangler tail > logs_$(date +%Y%m%d).log
```

---

## 🚨 回滚计划

### 场景 1: Phase 0 导致问题

**症状**: 新的超时/错误

**回滚**:
```bash
# 回滚到上一个版本
git revert HEAD
pnpm deploy

# 或使用 Wrangler 回滚
wrangler rollback
```

---

### 场景 2: 双写导致性能问题

**症状**: 响应时间显著增加

**回滚**:
```bash
# 方式 A: 环境变量
# 将 MIGRATION_WRITE_MODE 改为 state-only
MIGRATION_WRITE_MODE=state-only

# 方式 B: 代码回滚
git revert <dual-write-commit>
pnpm deploy
```

---

### 场景 3: 数据不一致严重

**症状**: 验证工具报告大量不一致

**处理**:
```bash
# 1. 停止双写
MIGRATION_WRITE_MODE=state-only

# 2. 运行修复
DATABASE_URL="..." \
  pnpm tsx scripts/validate-consistency.ts --fix

# 3. 重新验证
DATABASE_URL="..." \
  pnpm tsx scripts/validate-consistency.ts

# 4. 确认无误后，重新启用双写
MIGRATION_WRITE_MODE=dual-write
```

---

## ✅ 验收标准

### Phase 0 验收

- [ ] 超时率 < 20%
- [ ] P95 响应时间 < 8s
- [ ] 无功能回归
- [ ] 日志无严重错误

### Phase 1 验收（测试环境）

- [ ] 17 张表创建成功
- [ ] 数据迁移 100% 成功
- [ ] 一致性检查通过
- [ ] 索引创建成功

### Phase 2 验收（生产环境）

- [ ] 双写成功率 > 99.9%
- [ ] 响应时间增加 < 100ms
- [ ] 一致性检查 100% 通过
- [ ] 无数据丢失

---

## 📞 支持和帮助

### 遇到问题？

1. **查看文档**:
   - `MIGRATION_PLAN.md` - 完整计划
   - `REPOSITORY_GUIDE.md` - 使用指南
   - `TROUBLESHOOTING.md` - 故障排除（待创建）

2. **运行诊断**:
   ```bash
   # 一致性检查
   pnpm tsx scripts/validate-consistency.ts
   
   # 查看日志
   wrangler tail
   ```

3. **回滚**:
   - 参考上面的回滚计划
   - 优先保证系统可用性

---

## 🎉 部署成功检查

部署完成后，验证以下内容：

### Phase 0
- [ ] 应用可正常访问
- [ ] 用户可正常登录
- [ ] 申请可正常提交
- [ ] 管理员可正常操作
- [ ] 超时率显著下降

### Phase 2  
- [ ] 新增用户同时写入 state 和 table
- [ ] 新增申请同时写入 state 和 table
- [ ] 一致性检查无问题
- [ ] 日志显示 "Dual-write success"

---

**部署指南版本**: 1.0  
**更新日期**: 2026-06-09  
**状态**: ✅ 就绪
