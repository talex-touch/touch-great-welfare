export interface LdcEpayConfig {
  gatewayBaseUrl: string
  pid: string
  key: string
}

export type LdcSignParams = Record<string, string | number | undefined | null>

const DEFAULT_GATEWAY_BASE_URL = 'https://credit.linux.do/epay'

function normalizeGatewayBaseUrl(value?: string) {
  return (value?.trim() || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '')
}

export function createLdcEpayConfig(input: {
  gatewayBaseUrl?: string
  pid?: string
  key?: string
}): LdcEpayConfig {
  const pid = input.pid?.trim() ?? ''
  const key = input.key?.trim() ?? ''

  if (!pid || !key)
    throw new Error('LINUX DO Credit 商户配置缺失，请先在管理员后台配置 PID 和 KEY')

  return {
    gatewayBaseUrl: normalizeGatewayBaseUrl(input.gatewayBaseUrl),
    pid,
    key,
  }
}

export function isLdcEpayConfigured(input: {
  pid?: string
  key?: string
}) {
  return !!input.pid?.trim() && !!input.key?.trim()
}

function stringifySignValue(value: string | number | undefined | null) {
  if (value === undefined || value === null)
    return ''

  return String(value)
}

export function createEpaySign(params: LdcSignParams, secret: string) {
  const payload = Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && stringifySignValue(value) !== '')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${stringifySignValue(value)}`)
    .join('&')

  return md5(`${payload}${secret}`)
}

export function verifyEpaySign(params: LdcSignParams, secret: string) {
  const sign = stringifySignValue(params.sign).toLowerCase()
  if (!sign)
    return false

  return timingSafeEqual(sign, createEpaySign(params, secret))
}

export function formatLdcMoney(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error('请输入有效充值积分')

  const fixed = amount.toFixed(2)
  if (Number(fixed) !== amount)
    throw new Error('充值积分最多保留两位小数')

  return fixed
}

export function normalizeMoneyText(value: string | number) {
  const amount = Number(value)
  if (!Number.isFinite(amount))
    throw new Error('积分数量格式错误')

  return formatLdcMoney(amount)
}

export function buildEpaySubmitUrl(config: LdcEpayConfig) {
  return `${config.gatewayBaseUrl}/pay/submit.php`
}

export function buildEpayApiUrl(config: LdcEpayConfig) {
  return `${config.gatewayBaseUrl}/api.php`
}

export interface CreateEpayOrderInput {
  outTradeNo: string
  amount: string
  name: string
  notifyUrl: string
  returnUrl: string
}

export function createEpayOrderParams(config: LdcEpayConfig, input: CreateEpayOrderInput) {
  const params: Record<string, string> = {
    pid: config.pid,
    type: 'epay',
    out_trade_no: input.outTradeNo,
    name: input.name,
    money: input.amount,
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    sign_type: 'MD5',
  }

  params.sign = createEpaySign(params, config.key)
  return params
}

export function createEpayNotifyUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/recharge/notify`
}

export function createEpayReturnUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/recharge/return`
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length)
    return false

  let result = 0
  for (let i = 0; i < left.length; i += 1)
    result |= left.charCodeAt(i) ^ right.charCodeAt(i)

  return result === 0
}

// Compact MD5 implementation for Cloudflare Workers and browsers.
// It is used only for the LINUX DO Credit EasyPay-compatible signature.
function md5(input: string) {
  function rotateLeft(value: number, shift: number) {
    return (value << shift) | (value >>> (32 - shift))
  }

  function addUnsigned(left: number, right: number) {
    const leftLow = left & 0x40000000
    const rightLow = right & 0x40000000
    const leftHigh = left & 0x80000000
    const rightHigh = right & 0x80000000
    const result = (left & 0x3FFFFFFF) + (right & 0x3FFFFFFF)

    if (leftLow & rightLow)
      return result ^ 0x80000000 ^ leftHigh ^ rightHigh

    if (leftLow | rightLow) {
      if (result & 0x40000000)
        return result ^ 0xC0000000 ^ leftHigh ^ rightHigh

      return result ^ 0x40000000 ^ leftHigh ^ rightHigh
    }

    return result ^ leftHigh ^ rightHigh
  }

  function f(x: number, y: number, z: number) {
    return (x & y) | ((~x) & z)
  }

  function g(x: number, y: number, z: number) {
    return (x & z) | (y & (~z))
  }

  function h(x: number, y: number, z: number) {
    return x ^ y ^ z
  }

  function i(x: number, y: number, z: number) {
    return y ^ (x | (~z))
  }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, f(b, c, d)), addUnsigned(x, ac)), s), b)
  }

  function gg(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, g(b, c, d)), addUnsigned(x, ac)), s), b)
  }

  function hh(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, h(b, c, d)), addUnsigned(x, ac)), s), b)
  }

  function ii(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, i(b, c, d)), addUnsigned(x, ac)), s), b)
  }

  function convertToWordArray(value: string) {
    const bytes = new TextEncoder().encode(value)
    const messageLength = bytes.length
    const wordCount = (((messageLength + 8) >>> 6) + 1) * 16
    const words = Array.from({ length: wordCount }, () => 0)

    for (let byteIndex = 0; byteIndex < messageLength; byteIndex += 1)
      words[byteIndex >>> 2] |= bytes[byteIndex] << ((byteIndex % 4) * 8)

    words[messageLength >>> 2] |= 0x80 << ((messageLength % 4) * 8)
    words[wordCount - 2] = messageLength << 3
    words[wordCount - 1] = messageLength >>> 29

    return words
  }

  function wordToHex(value: number) {
    let hex = ''
    for (let count = 0; count <= 3; count += 1) {
      const byte = (value >>> (count * 8)) & 255
      hex += `0${byte.toString(16)}`.slice(-2)
    }
    return hex
  }

  const x = convertToWordArray(input)
  let a = 0x67452301
  let b = 0xEFCDAB89
  let c = 0x98BADCFE
  let d = 0x10325476

  for (let k = 0; k < x.length; k += 16) {
    const aa = a
    const bb = b
    const cc = c
    const dd = d

    a = ff(a, b, c, d, x[k + 0], 7, 0xD76AA478)
    d = ff(d, a, b, c, x[k + 1], 12, 0xE8C7B756)
    c = ff(c, d, a, b, x[k + 2], 17, 0x242070DB)
    b = ff(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE)
    a = ff(a, b, c, d, x[k + 4], 7, 0xF57C0FAF)
    d = ff(d, a, b, c, x[k + 5], 12, 0x4787C62A)
    c = ff(c, d, a, b, x[k + 6], 17, 0xA8304613)
    b = ff(b, c, d, a, x[k + 7], 22, 0xFD469501)
    a = ff(a, b, c, d, x[k + 8], 7, 0x698098D8)
    d = ff(d, a, b, c, x[k + 9], 12, 0x8B44F7AF)
    c = ff(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1)
    b = ff(b, c, d, a, x[k + 11], 22, 0x895CD7BE)
    a = ff(a, b, c, d, x[k + 12], 7, 0x6B901122)
    d = ff(d, a, b, c, x[k + 13], 12, 0xFD987193)
    c = ff(c, d, a, b, x[k + 14], 17, 0xA679438E)
    b = ff(b, c, d, a, x[k + 15], 22, 0x49B40821)

    a = gg(a, b, c, d, x[k + 1], 5, 0xF61E2562)
    d = gg(d, a, b, c, x[k + 6], 9, 0xC040B340)
    c = gg(c, d, a, b, x[k + 11], 14, 0x265E5A51)
    b = gg(b, c, d, a, x[k + 0], 20, 0xE9B6C7AA)
    a = gg(a, b, c, d, x[k + 5], 5, 0xD62F105D)
    d = gg(d, a, b, c, x[k + 10], 9, 0x02441453)
    c = gg(c, d, a, b, x[k + 15], 14, 0xD8A1E681)
    b = gg(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8)
    a = gg(a, b, c, d, x[k + 9], 5, 0x21E1CDE6)
    d = gg(d, a, b, c, x[k + 14], 9, 0xC33707D6)
    c = gg(c, d, a, b, x[k + 3], 14, 0xF4D50D87)
    b = gg(b, c, d, a, x[k + 8], 20, 0x455A14ED)
    a = gg(a, b, c, d, x[k + 13], 5, 0xA9E3E905)
    d = gg(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8)
    c = gg(c, d, a, b, x[k + 7], 14, 0x676F02D9)
    b = gg(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A)

    a = hh(a, b, c, d, x[k + 5], 4, 0xFFFA3942)
    d = hh(d, a, b, c, x[k + 8], 11, 0x8771F681)
    c = hh(c, d, a, b, x[k + 11], 16, 0x6D9D6122)
    b = hh(b, c, d, a, x[k + 14], 23, 0xFDE5380C)
    a = hh(a, b, c, d, x[k + 1], 4, 0xA4BEEA44)
    d = hh(d, a, b, c, x[k + 4], 11, 0x4BDECFA9)
    c = hh(c, d, a, b, x[k + 7], 16, 0xF6BB4B60)
    b = hh(b, c, d, a, x[k + 10], 23, 0xBEBFBC70)
    a = hh(a, b, c, d, x[k + 13], 4, 0x289B7EC6)
    d = hh(d, a, b, c, x[k + 0], 11, 0xEAA127FA)
    c = hh(c, d, a, b, x[k + 3], 16, 0xD4EF3085)
    b = hh(b, c, d, a, x[k + 6], 23, 0x04881D05)
    a = hh(a, b, c, d, x[k + 9], 4, 0xD9D4D039)
    d = hh(d, a, b, c, x[k + 12], 11, 0xE6DB99E5)
    c = hh(c, d, a, b, x[k + 15], 16, 0x1FA27CF8)
    b = hh(b, c, d, a, x[k + 2], 23, 0xC4AC5665)

    a = ii(a, b, c, d, x[k + 0], 6, 0xF4292244)
    d = ii(d, a, b, c, x[k + 7], 10, 0x432AFF97)
    c = ii(c, d, a, b, x[k + 14], 15, 0xAB9423A7)
    b = ii(b, c, d, a, x[k + 5], 21, 0xFC93A039)
    a = ii(a, b, c, d, x[k + 12], 6, 0x655B59C3)
    d = ii(d, a, b, c, x[k + 3], 10, 0x8F0CCC92)
    c = ii(c, d, a, b, x[k + 10], 15, 0xFFEFF47D)
    b = ii(b, c, d, a, x[k + 1], 21, 0x85845DD1)
    a = ii(a, b, c, d, x[k + 8], 6, 0x6FA87E4F)
    d = ii(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0)
    c = ii(c, d, a, b, x[k + 6], 15, 0xA3014314)
    b = ii(b, c, d, a, x[k + 13], 21, 0x4E0811A1)
    a = ii(a, b, c, d, x[k + 4], 6, 0xF7537E82)
    d = ii(d, a, b, c, x[k + 11], 10, 0xBD3AF235)
    c = ii(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB)
    b = ii(b, c, d, a, x[k + 9], 21, 0xEB86D391)

    a = addUnsigned(a, aa)
    b = addUnsigned(b, bb)
    c = addUnsigned(c, cc)
    d = addUnsigned(d, dd)
  }

  return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`.toLowerCase()
}
