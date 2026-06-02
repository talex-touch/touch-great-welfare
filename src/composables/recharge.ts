export interface RechargeConfigView {
  enabled: boolean
  configured: boolean
  gatewayBaseUrl: string
  pid: string
  keyMasked: string
  pointsPerLdc: number
  paymentType: 'epay'
  source?: 'env' | 'admin' | 'empty'
}

export interface SaveRechargeConfigPayload {
  enabled: boolean
  gatewayBaseUrl: string
  pid: string
  key: string
  pointsPerLdc: number
}

export interface SaveRechargeConfigResult {
  ok: true
  message: string
  env: Record<string, string>
}

export interface CreateRechargeResult {
  outTradeNo: string
  redirectUrl: string
  status: 'pending'
}

export interface RechargeStatusResult {
  outTradeNo: string
  amount: string
  creditedPoints: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  tradeNo?: string
  createdAt?: string
  paidAt?: string
}

async function readErrorMessage(response: Response) {
  const fallback = '充值接口请求失败'
  const text = await response.text()
  if (!text)
    return fallback

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || fallback
  }
  catch {
    return text
  }
}

async function requestRecharge<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  return response.json() as Promise<T>
}

export function loadRechargeConfig() {
  return requestRecharge<RechargeConfigView>('/api/recharge/config')
}

export function saveRechargeConfig(payload: SaveRechargeConfigPayload, adminUserId: string) {
  return requestRecharge<SaveRechargeConfigResult>('/api/recharge/config', {
    method: 'PUT',
    headers: {
      'x-welfare-user-id': adminUserId,
    },
    body: JSON.stringify(payload),
  })
}

export function createRechargeOrder(amount: number, userId: string) {
  return requestRecharge<CreateRechargeResult>('/api/recharge/create', {
    method: 'POST',
    headers: {
      'x-welfare-user-id': userId,
    },
    body: JSON.stringify({ amount, userId }),
  })
}

export function loadRechargeStatus(outTradeNo: string) {
  return requestRecharge<RechargeStatusResult>(`/api/recharge/status?out_trade_no=${encodeURIComponent(outTradeNo)}`)
}
