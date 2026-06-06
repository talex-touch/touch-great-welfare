# Touch Great Welfare

基于 `antfu/vitesse-lite` 的公益积分申请网站，使用 Vue 3、Vite、UnoCSS 和 `@talex-touch/tuffex` 组件库构建。

## 已实现功能

- 首次访问创建管理员账号。
- 管理员后台配置 GitHub App，用于用户登录和开源认证。
- 用户通过 GitHub App 完成真实授权登录。
- 用户积分系统：LINUX DO Credit 充值接入、流水、管理员手动调整。
- Sub2API 接入：管理员后台配置 Sub2API 地址、Admin API Key 和数据库连接，用户可在个人信息页生成 / 删除网关 API Key。
- 申请类型全部采用预扣费制度，提交后立即预扣并进入 AI 初审 / 管理员审核：
  - `code`：Codex 额度申请，默认 10 美元，按 10 积分 = 1 美元预扣；用户可自行选择额度，单次最多 1000 美元。
  - `image`：原价 3200 积分，活动期 32 积分，预扣后等待审核，审核通过后调用 AI 图片生成接口。
  - `pro`：原价 12000 积分，活动期 120 积分，预扣后按 3 天处理；可额外预扣 1100 积分加速到 2 天。
- 限时活动：2026-06-01 至 2026-06-08 采用 0.1 折，即原价 1%，活动价会写入申请价格快照，活动结束后新申请恢复原价。
- Pro 成本模型：按 680 元/周/50 次、10 元 = 800 LDC、1 LDC = 10 积分估算，单次成本约 10880 积分，对外取整为 12000 积分。
- Pro 结束后可在数据保留期内追加同一上下文，基础追加价按 10880 积分；超过保留期需重新提交申请。
- Codex 申请超过 100 美元需要更长审核时间；访问限制以首次访问 IP 为准，默认最多 2 个 IP、RPM 2，并限制并发，超过 IP 限制后需要管理员清除绑定。
- 每个申请可勾选延长存储服务，额外保存 7 天并一并预扣 300 积分。
- 申请退回会返还申请预扣，再按规则处理 AI 审核手续费；用户可勾选认真填写承诺免除普通退回手续费，被拒绝后 3 天内不可再次勾选该承诺；若管理员判定存在造假或不实包装，7 天内不可提交同类申请。
- 申请支持文本、图片、附件等资料，前端限制总大小 200MB。
- 单个用户同时最多 5 个待处理请求，审核队列按用户等级和历史表现排序。
- 开源认证：用户通过 GitHub App 授权同步 GitHub 用户名和公开仓库，选择默认仓库后提交申请会携带“开源认证”标签。
- 学生认证：用户提交任意类目信息和材料，先扣 800 积分；审核通过后返还，退回不返还。
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
pnpm run build
```

## Cloudflare Workers 部署

项目部署为一个 Cloudflare Worker：

- `dist` 由 Workers Static Assets 托管。
- `/api/*` 通过 `run_worker_first` 优先进入 Worker 边缘函数。
- PostgreSQL 通过 Hyperdrive binding 连接，Worker 代码不直接暴露数据库连接串。
- 本地开发使用 D1 local 数据库，不依赖本机 PostgreSQL。
- `not_found_handling = single-page-application` 负责 SPA 回退。

### 常规上线流程

本仓库生产环境由 Cloudflare 侧 Git 集成自动部署。常规上线只需要提交并推送 `main`：

```bash
git push origin main
```

推送成功后不要再把 `wrangler whoami`、`wrangler login` 或 `pnpm run deploy` 当成必经步骤；这些命令只用于手动部署、Cloudflare 资源维护或排障。自动部署状态以 Cloudflare 控制台 / Git 集成为准。

### 手动 Cloudflare 操作

只有需要本机手动 dry-run、直接部署或创建 Cloudflare 资源时，才需要 Wrangler 登录：

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

手动部署：

```bash
pnpm run deploy
```

CI、无浏览器环境或手动部署使用 API Token：

```bash
export CLOUDFLARE_API_TOKEN="<workers-and-hyperdrive-token>"
pnpm run deploy
```

如果手动部署时报 `Authentication error [code: 10000]`，当前 Wrangler OAuth 或 API Token 没有目标账号的 Workers/Hyperdrive 写权限。常规上线不依赖本机 Wrangler 认证，优先确认 `main` 是否已推送并触发 Cloudflare 自动部署；只有明确要手动部署时，再重新执行 `pnpm exec wrangler login` 或设置具备对应权限的 `CLOUDFLARE_API_TOKEN`。

## 环境变量整理

本项目运行时变量只在 Worker 侧读取，前端没有自定义 `VITE_*` 暴露变量；`src/main.ts` 只使用 Vite 内置的 `BASE_URL`。

Cloudflare binding：

| 名称         | 环境        | 说明                                                                 |
| ------------ | ----------- | -------------------------------------------------------------------- |
| `LOCAL_DB`   | 本地        | D1 local 数据库 binding，由 `wrangler.jsonc` 配置。                  |
| `HYPERDRIVE` | 生产        | PostgreSQL Hyperdrive binding，由 `wrangler.production.jsonc` 配置。 |
| `AI_ASSETS`  | 本地 / 生产 | AI 图片结果 R2 bucket binding。                                      |

业务配置全部在管理员后台保存到服务端数据库，`wrangler.jsonc` / `wrangler.production.jsonc` 不再写业务 vars：

| 配置域          | 后台位置                 | 可配置内容                                                                       |
| --------------- | ------------------------ | -------------------------------------------------------------------------------- |
| GitHub App      | 管理员后台 / GitHub 应用 | enabled、App 名称、Client ID / Secret、Callback URL、OAuth 端点和 scopes。       |
| AI Provider     | 管理员后台 / AI 配置     | enabled、base URL、OpenAI 兼容 Key、NewAPI 管理 Key、模型、临时 Key TTL / 配额。 |
| Sub2API         | 管理员后台 / Sub2API     | enabled、Sub2API 地址、Admin API Key、PostgreSQL 连接、默认分组和 Key 限额。     |
| 通知供应商      | 管理员后台 / 通知配置    | Resend API Key / 发件人、VAPID public/private key、VAPID subject。               |
| LINUX DO Credit | 管理员后台 / 充值配置    | enabled、网关地址、PID、KEY、1 LDC 兑换积分倍率，默认 10。                       |

仍需要保留的 Worker Secret：

```bash
pnpm exec wrangler secret put NOTIFY_SECRET_KEY
```

`NOTIFY_SECRET_KEY` 是后台保存密钥类配置的加密根密钥，生产环境必须稳定保存；更换它会导致已保存的加密配置无法解密。

本地 `wrangler dev` 使用 `.dev.vars` 读取这个根密钥。复制 `.dev.vars.example` 后填入真实值即可：

```bash
cp .dev.vars.example .dev.vars
```

`.env.example` 只作为整理清单和本地工具变量参考；Worker 运行时以管理员后台数据库配置、`.dev.vars` / Worker Secret、Cloudflare binding 为准。

## GitHub App 开源认证配置

开源认证使用 GitHub App 的 OAuth 授权流程：

- 管理员后台 “GitHub App” 面板保存 Client ID / Client Secret、Callback URL 和 scopes。
- 用户在登录页或“开源认证”页点击 GitHub 授权，Worker 使用授权 code 换取 token。
- Worker 读取 `/user`、`/user/emails`、`/user/repos`，把 GitHub 用户名、公开仓库和授权状态写入服务端业务状态。
- 只有完成 GitHub App 授权且选择了关联仓库的申请，才会携带“开源认证”标签。

GitHub App 的 Callback URL 配置为：

```text
https://你的域名/api/github-app/callback
```

默认 scopes：

```text
read:user user:email public_repo
```

运行时只读取管理员后台保存的 GitHub App 配置，不再读取 `GITHUB_APP_*` 环境变量。

## LINUX DO Credit 充值配置

充值使用 LINUX DO Credit 的易支付兼容接口：

- 下单：`POST https://credit.linux.do/epay/pay/submit.php`
- 异步通知：`/api/recharge/notify`
- 用户回跳：`/api/recharge/return`

管理员后台的“LINUX DO Credit 充值”面板可以配置 PID / KEY 和兑换倍率并保存到服务端数据库。本地和生产配置均默认启用充值，但只有配置了商户信息后才可创建订单。默认兑换倍率为 `1 LDC = 10 积分`；订单按 LDC 支付，到账按倍率换算积分。

运行时只读取管理员后台保存的充值配置，不再读取 `LDC_*` 环境变量。

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
