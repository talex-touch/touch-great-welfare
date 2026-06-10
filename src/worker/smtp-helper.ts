/**
 * SMTP 邮件发送助手（用于 Cloudflare Workers TCP socket 环境）
 */

import { connect } from 'cloudflare:sockets'

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

interface SmtpSocket {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  opened: Promise<unknown>
  closed: Promise<unknown>
  close: () => void | Promise<void>
  startTls?: () => SmtpSocket
}

interface SmtpResponse {
  code: number
  lines: string[]
  message: string
}

const SMTP_TIMEOUT_MS = 15000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64Utf8(value: string) {
  const bytes = encoder.encode(value)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') || ''
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value))
    return value
  return `=?UTF-8?B?${base64Utf8(value)}?=`
}

function formatAddress(email: string, name?: string) {
  const normalizedEmail = email.trim()
  const normalizedName = name?.trim()
  if (!normalizedName)
    return `<${normalizedEmail}>`
  return `${encodeHeader(normalizedName)} <${normalizedEmail}>`
}

function dotStuff(message: string) {
  return message
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map(line => line.startsWith('.') ? `.${line}` : line)
    .join('\r\n')
}

function buildMimeMessage(config: SmtpConfig, content: EmailContent) {
  const boundary = `tgfw-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
  const messageIdHost = config.fromEmail.split('@')[1] || config.host
  const textBody = wrapBase64(base64Utf8(content.text))
  const htmlBody = wrapBase64(base64Utf8(content.html))

  return [
    `Date: ${new Date().toUTCString()}`,
    `From: ${formatAddress(config.fromEmail, config.fromName)}`,
    `To: ${formatAddress(content.to)}`,
    `Subject: ${encodeHeader(content.subject)}`,
    `Message-ID: <${globalThis.crypto?.randomUUID?.() || Date.now()}@${messageIdHost}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    textBody,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBody,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}超时`)), SMTP_TIMEOUT_MS)
      }),
    ])
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

async function connectSmtpSocket(config: SmtpConfig): Promise<SmtpSocket> {
  const implicitTls = config.port === 465
  const socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: implicitTls ? 'on' : 'starttls' },
  )
  await withTimeout(socket.opened, 'SMTP 连接')
  return socket
}

class SmtpSession {
  private buffer = ''
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>

  constructor(private socket: SmtpSocket) {
    this.reader = socket.readable.getReader()
    this.writer = socket.writable.getWriter()
  }

  async close() {
    try {
      this.reader.releaseLock()
      this.writer.releaseLock()
    }
    catch {
      // Ignore cleanup errors from already closed streams.
    }
    await this.socket.close()
  }

  async startTls() {
    if (!this.socket.startTls)
      throw new Error('当前运行环境不支持 SMTP STARTTLS')

    this.reader.releaseLock()
    this.writer.releaseLock()
    this.buffer = ''
    this.socket = this.socket.startTls()
    await withTimeout(this.socket.opened, 'SMTP TLS 握手')
    this.reader = this.socket.readable.getReader()
    this.writer = this.socket.writable.getWriter()
  }

  async command(command: string, expectedCodes: number[]) {
    await this.write(`${command}\r\n`)
    return this.readResponse(expectedCodes)
  }

  async writeRaw(content: string) {
    await this.write(content)
  }

  async readResponse(expectedCodes?: number[]) {
    const lines: string[] = []
    let code = 0

    while (true) {
      const line = await this.readLine()
      lines.push(line)
      const match = /^(\d{3})([ -]?)/.exec(line)
      if (match) {
        code = Number(match[1])
        if (match[2] !== '-')
          break
      }
    }

    const response: SmtpResponse = {
      code,
      lines,
      message: lines.map(line => line.slice(4)).join(' ').trim(),
    }

    if (expectedCodes && !expectedCodes.includes(code))
      throw new Error(`SMTP 响应异常：${lines.join(' | ')}`)

    return response
  }

  private async write(content: string) {
    await withTimeout(this.writer.write(encoder.encode(content)), 'SMTP 写入')
  }

  private async readLine(): Promise<string> {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n')
      if (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '')
        this.buffer = this.buffer.slice(newlineIndex + 1)
        return line
      }

      const chunk = await withTimeout(this.reader.read(), 'SMTP 读取')
      if (chunk.done)
        throw new Error('SMTP 连接已关闭')
      this.buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
}

function supportsCapability(response: SmtpResponse, capability: string) {
  const normalizedCapability = capability.toUpperCase()
  return response.lines.some(line => line.slice(4).trim().toUpperCase().startsWith(normalizedCapability))
}

async function sayHello(session: SmtpSession, host: string) {
  const hostname = host.includes('.') ? host : 'localhost'
  return session.command(`EHLO ${hostname}`, [250]).catch(() => session.command(`HELO ${hostname}`, [250]))
}

async function authenticate(session: SmtpSession, config: SmtpConfig) {
  if (!config.username.trim())
    throw new Error('SMTP 邮箱通知未配置用户名')

  await session.command('AUTH LOGIN', [334])
  await session.command(base64Utf8(config.username), [334])
  await session.command(base64Utf8(config.password), [235])
}

/**
 * 使用真实 SMTP 协议发送邮件。
 */
export async function sendSmtpEmail(
  config: SmtpConfig,
  content: EmailContent,
): Promise<string> {
  const session = new SmtpSession(await connectSmtpSocket(config))
  try {
    await session.readResponse([220])
    const hello = await sayHello(session, config.host)

    if (config.port !== 465) {
      if (!supportsCapability(hello, 'STARTTLS'))
        throw new Error('SMTP 服务器未提供 STARTTLS，无法安全发送认证信息')
      await session.command('STARTTLS', [220])
      await session.startTls()
      await sayHello(session, config.host)
    }

    await authenticate(session, config)
    await session.command(`MAIL FROM:<${config.fromEmail}>`, [250])
    await session.command(`RCPT TO:<${content.to}>`, [250, 251])
    await session.command('DATA', [354])
    const message = dotStuff(buildMimeMessage(config, content))
    await session.writeRaw(`${message}\r\n.\r\n`)
    const accepted = await session.readResponse([250])
    await session.command('QUIT', [221]).catch(() => undefined)
    return accepted.message || 'SMTP accepted'
  }
  finally {
    await session.close().catch(() => undefined)
  }
}
