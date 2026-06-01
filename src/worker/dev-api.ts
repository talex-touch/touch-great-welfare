import type { IncomingMessage, ServerResponse } from 'node:http'

export async function handleDevWelfareStateRequest(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 501
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({
    error: '本地开发请使用 pnpm dev 启动 Cloudflare D1 模拟环境',
  }))
}
