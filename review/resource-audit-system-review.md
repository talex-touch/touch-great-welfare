# 资源审核与发放系统 Review

## P0

暂无已确认 P0。

## P1

### 附件信任边界不足

- **范围**：`src/worker/welfare/core.ts`、`src/components/welfare/VerificationAttachmentGrid.vue`、申请/认证/消息附件上传链路。
- **问题**：附件元数据来自客户端，若直接信任 `url`、`r2Key`、`size`、`type`，可能导致审核员加载第三方跟踪图、伪造大小绕过限制，或引用不属于当前用户的对象。
- **已处理**：`attachmentsFromPayload` 已禁止任意外链，只保留同源上传路径或图片 `dataUrl`。
- **建议**：继续把附件改成服务端签名上传完成后的绑定记录，校验 MIME、真实大小、R2 key 归属、下载鉴权和过期策略。
- **验证**：补恶意外链、伪造 `size=0`、非本人 `r2Key`、超大附件、非白名单 MIME 用例。

### 自动发放幂等与外部副作用

- **范围**：`src/worker/ai.ts`、`src/worker/database-provisioning.ts`、`src/worker/sub2api.ts`。
- **问题**：自动发放会先调用外部系统再写业务状态；若多个请求并发基于旧快照发放，可能产生重复 key、重复额度或重复数据库权限。
- **现状**：数据库发放已通过 active 唯一索引和 PostgreSQL advisory lock 降低重复创建风险；仍需统一所有 provider 的幂等键。
- **建议**：为每个资源项引入 provider 侧 `provisionId = applicationId:itemId`，外部调用前后都记录 pending/provisioning/provisioned/failed 状态，失败可重试但不可重复发放。
- **验证**：并发触发两次发放，应只产生一个外部资源和一条 active binding；状态冲突重试应复用已有结果。

### 全量状态接口性能风险

- **范围**：`src/worker/welfare/core.ts` 的 state response、`src/composables/welfare-ui/core.ts`、管理员工作台列表。
- **问题**：多个页面依赖全量 `WelfareState`，随着用户、申请、消息和附件增长，列表页会重复过滤/排序/渲染大对象。
- **建议**：拆分分页接口：我的申请、管理员待办、资源工单、消息线程、附件元数据；列表只返回摘要字段，详情按 id 拉取。
- **验证**：构造 1 万申请、10 万消息、每条多附件，列表首屏响应和渲染保持在目标阈值内。

### 巨型模块维护风险

- **范围**：`src/worker/welfare/core.ts`、`src/composables/welfare/core.ts`、`src/composables/welfare-ui/core.ts`。
- **问题**：状态机、权限、资源审批、认证、积分、广场、发放等逻辑集中在巨型文件，容易产生状态白名单遗漏和跨模块回归。
- **建议**：逐步收敛为 `resource-ticket`、`resource-display`、`resource-provisioning`、`attachments`、`application-state-machine` 模块，先抽纯函数和测试，再迁移副作用。
- **验证**：每次抽取后跑单元测试、类型检查和关键流程回归。

## P2

### Raw JSON 审核体验

- **范围**：资源申请详情与审核队列。
- **问题**：管理员直接看 JSON 容易漏审字段，用户也难以理解审批结果。
- **已处理**：资源详情和审核弹窗已改为类型化字段卡片，原始 JSON 仅保留为管理员调试折叠区。
- **建议**：继续为每种 `ResourceType` 增加专属展示/表单 schema，逐步替换通用字段兜底。
- **验证**：每类资源均有摘要、申请字段、审批字段、结果字段快照测试。

### 工单状态分散

- **范围**：资源申请状态、逐项审批状态、发放状态、消息线程。
- **问题**：资源工单状态由多个字段隐式组合，前后端容易出现文案和权限不一致。
- **已处理**：前端新增资源工单状态派生和流程步骤展示。
- **建议**：后续将状态机抽成共享纯函数，并在后端复用同一组状态转换规则。
- **验证**：覆盖 `materials_required -> queued -> claimed/processing -> result_ready` 以及 `needs_more_info/closed/failed_retryable`。

### 附件下载与清理策略不完整

- **范围**：上传、预览、消息附件、认证附件。
- **问题**：缺少统一下载鉴权、文件类型白名单、过期清理和附件归属索引。
- **建议**：附件表/对象元数据记录 owner、applicationId、messageId、expiresAt、checksum；下载走鉴权代理或短签名 URL。
- **验证**：用户不能下载他人附件；过期附件不可访问；管理员仍可按权限查看审核材料。

### 数据库隔离后续增强

- **范围**：`src/worker/database-provisioning.ts`。
- **现状**：已按每申请资源项创建独立 PostgreSQL database 和 role，凭据可返回给用户侧结果。
- **建议**：增加回收/禁用任务、密码重置、连接串再次查看策略、权限降级、审计日志；Docker/容器隔离作为后续高隔离选项。
- **验证**：到期后 role 失效；管理员可重试失败发放；重复发放复用已有 binding。
