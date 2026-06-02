import type { IncomingMessage, ServerResponse } from 'node:http'

function sendDevApiNotice(res: ServerResponse) {
  res.statusCode = 501
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({
    error: '本地开发请使用 pnpm dev 启动 Cloudflare D1 本地数据库环境',
  }))
}

export async function handleDevWelfareStateRequest(_req: IncomingMessage, res: ServerResponse) {
  sendDevApiNotice(res)
}

export async function handleDevGitHubAppRequest(_req: IncomingMessage, res: ServerResponse) {
  sendDevApiNotice(res)
}
