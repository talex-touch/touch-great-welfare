# core.ts 拆分计划

**当前状态**: 4893 行，84 个导出函数  
**目标**: 拆分为 10-15 个模块，每个模块 < 500 行

---

## 📦 拆分策略

### 模块划分原则
1. **按业务领域分组**（用户、申请、认证等）
2. **按层次分组**（数据访问、业务逻辑、API 处理）
3. **每个文件 < 500 行**
4. **清晰的依赖关系**

---

## 🗂️ 目标模块结构

```
src/worker/welfare/
├── core/
│   ├── index.ts                      # 导出所有公共 API
│   ├── types.ts                      # 类型定义
│   ├── config.ts                     # 配置和常量
│   │
│   ├── database/
│   │   ├── connection.ts             # 数据库连接管理
│   │   ├── schema.ts                 # Schema 初始化
│   │   └── state-io.ts               # State 读写（JSONB）
│   │
│   ├── utils/
│   │   ├── crypto.ts                 # 加密解密
│   │   ├── validation.ts             # 数据验证
│   │   ├── sanitization.ts           # 数据清理
│   │   └── helpers.ts                # 通用工具
│   │
│   ├── domain/
│   │   ├── users/
│   │   │   ├── user-actions.ts       # 用户操作
│   │   │   ├── user-queries.ts       # 用户查询
│   │   │   └── user-validators.ts    # 用户验证
│   │   │
│   │   ├── applications/
│   │   │   ├── application-actions.ts
│   │   │   ├── application-queries.ts
│   │   │   ├── application-validators.ts
│   │   │   └── application-pricing.ts
│   │   │
│   │   ├── verifications/
│   │   │   ├── student-verification-actions.ts
│   │   │   └── education-email-actions.ts
│   │   │
│   │   ├── points/
│   │   │   ├── point-transactions.ts
│   │   │   └── point-sync.ts
│   │   │
│   │   ├── coupons/
│   │   │   ├── coupon-actions.ts
│   │   │   └── coupon-queries.ts
│   │   │
│   │   ├── square/
│   │   │   ├── square-post-actions.ts
│   │   │   └── square-boost-actions.ts
│   │   │
│   │   └── collaboration/
│   │       └── collaboration-actions.ts
│   │
│   └── api/
│       ├── response-builders.ts       # API 响应构建
│       └── request-handlers.ts        # 请求处理
│
├── perf-monitor.ts                    # 性能监控（已有）
└── router.ts                          # 路由（已有）
```

---

## 📋 迁移步骤

### Phase 1: 提取基础设施（数据库、工具）

**新建文件**:
1. `core/database/connection.ts` - 连接管理
   - `getConnectionString()`
   - `shouldUseD1()`
   - `getPool()`
   
2. `core/database/schema.ts` - Schema 初始化
   - `ensureSchema()`
   - `runSchemaSetup()`
   
3. `core/database/state-io.ts` - State 读写
   - `readWelfareStateRecord()`
   - `writeWelfareState()`
   - `encodeStoredState()`
   - `decodeStoredState()`

4. `core/utils/crypto.ts` - 加密
   - `stateEncryptionSecret()`
   - 加密相关函数

5. `core/utils/sanitization.ts` - 数据清理
   - `sanitizeUser()`
   - `publicUser()`
   - `sanitizeOwnedApplications()`
   - 等所有 sanitize/public 函数

6. `core/utils/validation.ts` - 验证
   - `isRecord()`
   - `assertStateShape()`
   - 等验证函数

7. `core/utils/helpers.ts` - 通用工具
   - `logWelfarePerf()`
   - `createId()`
   - 等工具函数

### Phase 2: 提取业务逻辑

8. `core/domain/users/user-actions.ts`
   - `updateCurrentProfileAction()`
   - `adjustAdminUserPointsAction()`
   - 等用户操作

9. `core/domain/applications/application-actions.ts`
   - `submitApplicationAction()`
   - `answerAdminApplicationAction()`
   - `completeAdminApplicationAction()`
   - 等申请操作

10. `core/domain/verifications/student-verification-actions.ts`
    - `submitStudentVerificationAction()`
    - `reviewAdminStudentVerificationAction()`
    - 等认证操作

11. `core/domain/points/point-transactions.ts`
    - `appendPointTransaction()`
    - `syncUserPointBalancesFromLedger()`
    - 等积分操作

12. `core/domain/coupons/coupon-actions.ts`
    - `redeemCouponCodeAction()`
    - `createAdminCouponCodeAction()`
    - 等优惠券操作

13. `core/domain/square/square-post-actions.ts`
    - `createSquarePostAction()`
    - `boostSquarePostAction()`
    - 等广场操作

### Phase 3: 提取 API 层

14. `core/api/response-builders.ts`
    - `currentUserStateResponse()`
    - `adminStateResponse()`
    - `bootstrapResponse()`
    - 等响应构建

15. `core/index.ts` - 总导出文件
    - 重新导出所有公共 API

---

## ⚠️ 注意事项

### 循环依赖问题
- 使用 `index.ts` 统一导出
- 避免模块间直接引用
- 使用依赖注入模式

### 向后兼容
- 保持所有导出 API 不变
- `core.ts` 最终变成 `core/index.ts`
- 现有导入路径继续工作

### 测试策略
- 每拆分一个模块，运行测试
- 确保类型检查通过
- 确保所有导入正确

---

## 🎯 预期结果

**拆分前**:
```
src/worker/welfare/core.ts          4893 行
```

**拆分后**:
```
src/worker/welfare/core/
├── index.ts                          ~100 行（重新导出）
├── types.ts                          ~200 行
├── config.ts                         ~50 行
├── database/
│   ├── connection.ts                 ~100 行
│   ├── schema.ts                     ~150 行
│   └── state-io.ts                   ~200 行
├── utils/
│   ├── crypto.ts                     ~80 行
│   ├── sanitization.ts               ~300 行
│   ├── validation.ts                 ~150 行
│   └── helpers.ts                    ~100 行
├── domain/
│   ├── users/user-actions.ts         ~400 行
│   ├── applications/
│   │   ├── application-actions.ts    ~600 行
│   │   └── application-validators.ts ~200 行
│   ├── verifications/
│   │   └── verification-actions.ts   ~400 行
│   ├── points/point-transactions.ts  ~300 行
│   ├── coupons/coupon-actions.ts     ~200 行
│   └── square/square-actions.ts      ~300 行
└── api/response-builders.ts          ~400 行

总计: ~3830 行（压缩了 ~1000 行重复代码）
15 个模块，平均每个 ~250 行
```

---

**状态**: 📋 计划完成，准备执行
