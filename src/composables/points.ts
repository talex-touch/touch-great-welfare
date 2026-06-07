import type { CreditTransaction, CreditTransactionType } from './welfare'

export interface PointTransactionSummary {
  income: number
  outcome: number
  count: number
}

export interface PointTransactionQuery {
  userId?: string
  type?: CreditTransactionType | 'all'
  direction?: 'income' | 'expense' | 'all'
  from?: string
  to?: string
  query?: string
  limit?: number
  cursor?: string
}

export interface PointTransactionListResult {
  rows: CreditTransaction[]
  nextCursor?: string
  summary: PointTransactionSummary
  balance: number
}

async function readErrorMessage(response: Response) {
  const text = await response.text()
  if (!text)
    return '积分流水接口请求失败'

  try {
    const payload = JSON.parse(text) as { error?: string }
    return payload.error || '积分流水接口请求失败'
  }
  catch {
    return text
  }
}

export async function loadPointTransactions(query: PointTransactionQuery = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== 'all')
      search.set(key, String(value))
  }

  const response = await fetch(`/api/points/transactions${search.size ? `?${search.toString()}` : ''}`, {
    headers: {
      'content-type': 'application/json',
    },
  })

  if (!response.ok)
    throw new Error(await readErrorMessage(response))

  return response.json() as Promise<PointTransactionListResult>
}
