# Touch Great Welfare

基于 `antfu/vitesse-lite` 的公益积分申请网站原型，使用 Vue 3、Vite、UnoCSS 和 `@talex-touch/tuffex` 组件库构建。

## 已实现功能

- 首次访问创建管理员账号。
- 管理员后台配置 OAuth（当前为前端模拟登录，预留真实授权跳转）。
- 用户通过 OAuth 模拟登录。
- 用户积分系统：充值预留、流水、管理员手动调整。
- 申请类型：
  - `code`：1 积分，预留入口，提交即扣除。
  - `image`：10 积分，预留入口，提交即扣除。
  - `pro`：100 积分，提交后进入审核；管理员给出答复通过后才扣除，退回不扣除。
- Pro 申请支持文本、图片、附件等资料，前端限制总大小 200MB。
- 单个用户同时最多 3 个待审核 Pro 申请。
- 用户个人资料编辑，支持关联 GitHub 用户名并选择仓库；提交时携带“开源认证”标签。
- 学生认证：用户提交任意类目信息和材料，先扣 10 积分；审核通过后返还，退回不返还。
- 简约高级的玻璃拟态界面，主要 UI 使用 `@talex-touch/tuffex`。

## 开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会先构建前端、应用本地 D1 migration，再启动 `wrangler dev`。本地业务数据写入 Cloudflare D1 local store，不需要本机 PostgreSQL。

## 校验

```bash
pnpm run check
pnpm build
pnpm run build && pnpm exec wrangler deploy --config wrangler.production.jsonc --dry-run
```

## Cloudflare Workers 部署

项目部署为一个 Cloudflare Worker：

- `dist` 由 Workers Static Assets 托管。
- `/api/*` 通过 `run_worker_first` 优先进入 Worker 边缘函数。
- PostgreSQL 通过 Hyperdrive binding 连接，Worker 代码不直接暴露数据库连接串。
- 本地开发使用 D1 local 模拟数据库，不依赖本机 PostgreSQL。
- `not_found_handling = single-page-application` 负责 SPA 回退。

本地首次接入真实 Cloudflare 环境：

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami
```

创建 Hyperdrive：

```bash
export DATABASE_URL="postgresql://user:password@host:5432/touch_great_welfare"
pnpm exec wrangler hyperdrive create touch-great-welfare-db --connection-string "$DATABASE_URL"
```

把命令输出里的 Hyperdrive ID 写入 `wrangler.production.jsonc` 的 `hyperdrive[0].id`。远端配置 dry-run：

```bash
pnpm run build && pnpm exec wrangler deploy --config wrangler.production.jsonc --dry-run
```

部署：

```bash
pnpm run deploy
```

CI 或无浏览器环境使用 API Token：

```bash
export CLOUDFLARE_API_TOKEN="<workers-and-hyperdrive-token>"
pnpm run deploy
```

如果部署时报 `Authentication error [code: 10000]`，当前 Wrangler OAuth 或 API Token 没有目标账号的 Workers/Hyperdrive 写权限。重新执行 `pnpm exec wrangler login` 并确认授权到正确账号，或设置具备对应权限的 `CLOUDFLARE_API_TOKEN` 后再部署。

## 数据说明

业务数据不再保存在浏览器本地存储。前端通过 `/api/welfare-state` 读取和保存 PostgreSQL 中的 `welfare_app_state` 表：

```sql
create table if not exists welfare_app_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

生产环境需要配置 Hyperdrive binding。本地开发使用 `LOCAL_DB` D1 binding。如果数据库不可用，页面会显示数据库错误，业务写操作不会落到浏览器本地存储。
