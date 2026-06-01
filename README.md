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

## 校验

```bash
pnpm lint
pnpm typecheck
pnpm test -- --run
pnpm build
```

## Cloudflare Pages 部署

项目按静态 SPA 部署到 Cloudflare Pages：

- Pages 项目名：`touch-great-welfare`
- 构建命令：`pnpm run build`
- 输出目录：`dist`
- SPA 回退：`public/_redirects` 会随 Vite 构建复制到 `dist/_redirects`

本地首次接入真实 Cloudflare 环境：

```bash
pnpm exec wrangler login
pnpm run cf:whoami
pnpm run cf:project:create
```

脚本默认使用当前机器历史部署过的 Account ID：`4375ff26cc9f8d57b32af4a38f49b811`。如果要部署到其他账号，直接覆盖环境变量：

```bash
export CLOUDFLARE_ACCOUNT_ID="<your-account-id>"
pnpm run cf:project:create
```

CI 或无浏览器环境使用 API Token：

```bash
export CLOUDFLARE_ACCOUNT_ID="<your-account-id>"
export CLOUDFLARE_API_TOKEN="<pages-write-token>"
pnpm run deploy:cloudflare
```

部署：

```bash
pnpm run deploy:cloudflare
```

如果 `pnpm run cf:project:create` 或部署时报 `Authentication error [code: 10000]`，当前 Wrangler OAuth 没有目标 Account 的 Pages 写权限。重新执行 `pnpm exec wrangler login` 并确认授权到正确账号，或设置具备 Pages 写权限的 `CLOUDFLARE_API_TOKEN` 后再部署。

## 数据说明

当前是前端原型，演示数据保存在 `localStorage`：

```txt
touch-great-welfare:v1
```

页面底部提供“重置本地演示数据”。后续接入后端时，可将 `src/composables/welfare.ts` 中的本地状态与方法替换为真实 API。
