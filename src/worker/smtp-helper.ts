/**
 * SMTP 邮件发送助手（用于 Cloudflare Workers 环境）
 *
 * 由于 Workers 不支持原生 SMTP，这里使用 Resend 的 SMTP 兼容 API
 * 或者可以配置为通过外部 SMTP 桥接服务
 */

import type { WorkerEnv } from './welfare-state'
import { fetchWithTimeout } from './auth'

interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName?: string
}

interface EmailContent {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * 通过 Resend API 发送邮件（使用 SMTP 配置）
 */
export async function sendSmtpEmail(
  config: SmtpConfig,
  content: EmailContent,
): Promise<string> {
  // 使用 Resend API（兼容 SMTP 配置）
  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${config.password}`, // SMTP 密码作为 API key
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromName
        ? `${config.fromName} <${config.fromEmail}>`
        : config.fromEmail,
      to: [content.to],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  })

  const result = await response.json().catch(() => ({})) as { id?: string, message?: string }
  if (!response.ok)
    throw new Error(result.message || `SMTP 邮件发送失败：${response.status}`)

  return result.id ?? ''
}
