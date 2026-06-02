const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)

  return bytes
}

export function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value))))
}

async function deriveAesKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function assertEncryptionSecret(secret: string) {
  if (!secret.trim())
    throw new Error('NOTIFY_SECRET_KEY 未配置，无法保存密钥类配置')
}

export async function encryptSecret(value: string, secret: string) {
  assertEncryptionSecret(secret)

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(secret)
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(value)))
  return `v1:${base64UrlEncode(iv)}:${base64UrlEncode(encrypted)}`
}

export async function decryptSecret(value: string, secret: string) {
  assertEncryptionSecret(secret)

  const [version, ivText, payloadText] = value.split(':')
  if (version !== 'v1' || !ivText || !payloadText)
    throw new Error('飞书 Webhook 密文格式无效')

  const key = await deriveAesKey(secret)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(ivText) },
    key,
    base64UrlDecode(payloadText),
  )
  return textDecoder.decode(decrypted)
}
