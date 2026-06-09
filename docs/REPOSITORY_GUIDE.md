# Repository 层使用指南

**创建日期**: 2026-06-09  
**状态**: ✅ 完成

---

## 📚 概述

Repository 层是数据访问的统一抽象，核心功能：

1. **双写模式**: 同时写入 JSONB state 和规范化表
2. **灰度切换**: 支持逐步将读取从 state 切换到 table
3. **一致性验证**: 自动对比两边数据，记录差异

---

## 🚀 快速开始

### 1. 基本使用

```typescript
import { getPool } from './core/database/connection'
import { createRepositories, setMigrationConfig } from './core/repository'

// 创建 Repository 容器
const pool = getPool(env)
const repos = createRepositories(env, pool)

// 读取用户
const user = await repos.users.read(state, userId, currentUserId)

// 写入用户（自动双写）
await repos.users.write(state, updatedUser)

// 读取申请
const application = await repos.applications.read(state, appId, userId)

// 写入申请（自动双写）
await repos.applications.write(state, updatedApplication)
```

---

## ⚙️ 配置迁移模式

### Phase 2: 双写 + 从 State 读取（默认）

```typescript
setMigrationConfig({
  writeMode: { target: 'dual-write' },  // 双写
  readMode: { source: 'state' },        // 从 state 读
  validation: {
    enabled: true,
    logMismatches: true,
  },
})
```

### Phase 3.1: 10% 灰度读取表

```typescript
setMigrationConfig({
  writeMode: { target: 'dual-write' },
  readMode: {
    source: 'canary',
    canaryPercentage: 10,  // 10% 流量从表读取
  },
})
```

### Phase 3.2: 50% 灰度

```typescript
setMigrationConfig({
  readMode: {
    source: 'canary',
    canaryPercentage: 50,  // 50% 流量
  },
})
```

### Phase 3.3: 100% 读取表

```typescript
setMigrationConfig({
  writeMode: { target: 'dual-write' },
  readMode: { source: 'table' },  // 全部从表读取
})
```

### Phase 4: 只写表

```typescript
setMigrationConfig({
  writeMode: { target: 'table-only' },  // 停止双写
  readMode: { source: 'table' },
})
```

---

## 🔧 环境变量配置

可以通过环境变量动态配置：

```bash
# Cloudflare Workers 环境变量
MIGRATION_WRITE_MODE=dual-write
MIGRATION_READ_SOURCE=canary
MIGRATION_CANARY_PERCENTAGE=10
```

代码中加载：

```typescript
import { loadMigrationConfigFromEnv } from './core/repository'

// 在应用启动时加载
loadMigrationConfigFromEnv(env)
```

---

## 📊 灰度策略

### 基于用户 ID 的一致性哈希

灰度切换使用用户 ID 哈希，确保：
- ✅ 同一用户总是走同一个分支（state 或 table）
- ✅ 分流比例稳定
- ✅ 便于问题排查

```typescript
// 内部实现（BaseRepository）
function shouldReadFromTable(userId: string): boolean {
  const hash = userId.split('').reduce((sum, char) => 
    sum + char.charCodeAt(0), 0
  ) % 100
  return hash < canaryPercentage
}
```

---

## 🧪 一致性验证

### 自动对比

当同时从 state 和 table 读取时，自动对比数据：

```typescript
// 启用验证
setMigrationConfig({
  validation: {
    enabled: true,
    logMismatches: true,
  },
})

// 不一致会自动记录
// [Repository] Data mismatch for UserRepository:user123
// State: {"id":"user123","points":1000}
// Table: {"id":"user123","points":1050}
```

### 手动验证脚本

```typescript
// scripts/validate-consistency.ts
import { createRepositories } from './core/repository'

async function validateUser(userId: string) {
  const repos = createRepositories(env, pool)
  
  const stateUser = repos.users.readFromState(state, userId)
  const tableUser = await repos.users.readFromTable(userId)
  
  if (JSON.stringify(stateUser) !== JSON.stringify(tableUser)) {
    console.error(`Mismatch: ${userId}`)
  }
}
```

---

## 🎯 迁移路径

### 阶段 1: 实现双写（当前）

```typescript
// 修改前：直接操作 state
state.users.push(newUser)

// 修改后：使用 Repository
await repos.users.write(state, newUser)  // 自动双写
```

### 阶段 2: 灰度读取

```typescript
// 10% 用户从表读取
setMigrationConfig({
  readMode: { source: 'canary', canaryPercentage: 10 },
})

// 观察 3 天，无问题则提升到 50%
setMigrationConfig({
  readMode: { source: 'canary', canaryPercentage: 50 },
})

// 再观察 3 天，无问题则 100%
setMigrationConfig({
  readMode: { source: 'table' },
})
```

### 阶段 3: 停止双写

```typescript
setMigrationConfig({
  writeMode: { target: 'table-only' },
  readMode: { source: 'table' },
})

// 归档 welfare_app_state
// ALTER TABLE welfare_app_state RENAME TO welfare_app_state_archived;
```

---

## 🔍 调试和监控

### 查看当前配置

```typescript
import { getMigrationConfig } from './core/repository'

console.log(getMigrationConfig())
// {
//   writeMode: { target: 'dual-write' },
//   readMode: { source: 'canary', canaryPercentage: 10 },
//   validation: { enabled: true, logMismatches: true }
// }
```

### 监控双写成功率

```typescript
// 在 Repository.write() 中
try {
  await this.writeToTable(entity)
  console.log('[Repository] Dual-write success')
} catch (error) {
  console.error('[Repository] Dual-write failed:', error)
  // 记录失败，但不影响 state 写入
}
```

### 监控灰度流量

```typescript
// 在 Repository.read() 中
const useTable = shouldReadFromTable(userId)
console.log(`[Repository] User ${userId} reads from ${useTable ? 'table' : 'state'}`)
```

---

## ⚠️ 注意事项

### 1. 双写失败处理

双写失败**不会**导致请求失败，但会记录错误：

```typescript
// 写入顺序：先 state，后 table
this.writeToState(state, entity)  // 成功
await this.writeToTable(entity)   // 失败 → 仅记录日志
```

**原因**: 保证 state 写入成功，系统继续可用。

**后续**: 通过一致性验证脚本修复差异。

### 2. 灰度读取 Fallback

从表读取失败时，自动回退到 state：

```typescript
try {
  return await this.readFromTable(id)
} catch (error) {
  console.error('Read from table failed, fallback to state')
  return this.readFromState(state, id)
}
```

### 3. 性能考虑

- **双写延迟**: 约 10-50ms
- **表读取延迟**: 约 5-20ms（有索引）
- **State 读取延迟**: 0ms（内存）

**建议**: 先灰度 10%，观察 P95/P99 延迟。

---

## 📈 预期效果

| 阶段 | 配置 | 效果 |
|------|------|------|
| Phase 2 | dual-write + state | 数据双写，读取无变化 |
| Phase 3.1 | dual-write + 10% table | 10% 用户验证新架构 |
| Phase 3.2 | dual-write + 50% table | 一半流量切换 |
| Phase 3.3 | dual-write + 100% table | 全量切换，state 作为备份 |
| Phase 4 | table-only | 完全迁移，归档 state |

---

## 🎉 总结

Repository 层实现了：

✅ **零停机迁移** - 无需停机维护  
✅ **灰度切换** - 逐步验证，降低风险  
✅ **自动一致性检查** - 及时发现问题  
✅ **简单易用** - 只需修改少量代码  

**下一步**: Task #11 - 重构业务逻辑使用 Repository
