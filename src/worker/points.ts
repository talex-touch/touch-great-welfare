import type { WorkerEnv } from './welfare-state'
import type { CreditTransaction, CreditTransactionType, WelfareState } from '~/composables/welfare'
import { authenticatedUserId } from './session'
import { getPool, readWelfareState, readWelfareStateRecord, shouldUseD1, writeWelfareState } from './welfare-state'

interface PointTransactionRow {
  id: string
  user_id: string
  delta: number
  type: CreditTransactionType
  reason: string
  ref_id?: string | null
  balance_after: number
  created_at: string
}

interface PointTransactionInput {
  id?: string
  userId: string
  delta: number
  type: CreditTransactionType
  reason: string
  refId?: string
  createdAt?: string
  allowDebt?: boolean
}

interface PointTransactionQuery {
  currentUserId: string
  isAdmin: boolean
  userId?: string
  type?: string
  direction?: string
  from?: string
  to?: string
  query?: string
  limit?: number
  cursor?: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const BALANCE_QUERY_CHUNK_SIZE = 100

let pointSchemaKey = ''
let pointSchemaPromise: Promise<void> | undefined

function now() {
  return new Date().toISOString()
}

function createTransactionId() {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })
}

function errorResponse(error: unknown, status = 500) {
  return json({ error: error instanceof Error ? error.message : '服务端错误' }, status)
}

function forbidden(message = '需要管理员权限') {
  return json({ error: message }, 403)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLimit(value: unknown) {
  const limit = Math.trunc(Number(value))
  if (!Number.isFinite(limit) || limit <= 0)
    return DEFAULT_LIMIT

  return Math.min(MAX_LIMIT, limit)
}

function normalizeTransaction(input: CreditTransaction): CreditTransaction {
  return {
    id: input.id,
    userId: input.userId,
    delta: Math.trunc(Number(input.delta)),
    type: input.type,
    reason: input.reason,
    refId: input.refId,
    createdAt: input.createdAt || now(),
    balanceAfter: input.balanceAfter,
  }
}

function transactionFromRow(row: PointTransactionRow): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    delta: row.delta,
    type: row.type,
    reason: row.reason,
    refId: row.ref_id || undefined,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
  }
}

function stateUsers(state: unknown) {
  return isRecord(state) && Array.isArray(state.users) ? state.users : []
}

function stateTransactions(state: unknown): CreditTransaction[] {
  return isRecord(state) && Array.isArray(state.transactions)
    ? state.transactions.filter((item): item is CreditTransaction => isRecord(item) && typeof item.id === 'string')
    : []
}

function sanitizeStateWithoutTransactions<T>(state: T): T {
  if (isRecord(state)) {
    const record = state as Record<string, unknown>
    if (Array.isArray(record.transactions))
      record.transactions = []
  }

  return state
}

async function transactionExists(env: WorkerEnv, id: string) {
  await ensurePointTransactionSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select id from point_transactions where id = ?1')
      .bind(id)
      .first<{ id: string }>()
    return !!row
  }

  const result = await getPool(env).query<{ id: string }>(
    'select id from point_transactions where id = $1',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

async function latestBalanceForUser(env: WorkerEnv, userId: string) {
  return (await latestBalancesForUsers(env, [userId])).get(userId)
}

async function currentBalanceForUser(env: WorkerEnv, users: Array<{ id: string, points: number }>, userId: string) {
  const ledgerBalance = await latestBalanceForUser(env, userId)
  if (ledgerBalance !== undefined)
    return ledgerBalance

  return users.find(item => item.id === userId)?.points ?? 0
}

async function latestBalancesForUsers(env: WorkerEnv, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.map(id => id.trim()).filter(Boolean)))
  const balances = new Map<string, number>()
  if (!uniqueUserIds.length)
    return balances

  await ensurePointTransactionSchema(env)

  for (let index = 0; index < uniqueUserIds.length; index += BALANCE_QUERY_CHUNK_SIZE) {
    const chunk = uniqueUserIds.slice(index, index + BALANCE_QUERY_CHUNK_SIZE)
    const placeholders = chunk.map((_, chunkIndex) => shouldUseD1(env) ? '?' : `$${chunkIndex + 1}`).join(', ')
    const sql = `
      select user_id, balance_after
      from (
        select
          user_id,
          balance_after,
          row_number() over (partition by user_id order by created_at desc, id desc) as row_number
        from point_transactions
        where user_id in (${placeholders})
      )
      where row_number = 1
    `

    if (shouldUseD1(env)) {
      const result = await env.LOCAL_DB!
        .prepare(sql)
        .bind(...chunk)
        .all<{ user_id: string, balance_after: number }>()
      for (const row of result.results ?? [])
        balances.set(row.user_id, Number(row.balance_after))
      continue
    }

    const result = await getPool(env).query<{ user_id: string, balance_after: number }>(sql, chunk)
    for (const row of result.rows)
      balances.set(row.user_id, Number(row.balance_after))
  }

  return balances
}

async function insertPointTransaction(env: WorkerEnv, tx: Required<Omit<CreditTransaction, 'balanceAfter'>> & { balanceAfter: number }) {
  await ensurePointTransactionSchema(env)
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        on conflict (id) do nothing
      `)
      .bind(tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt)
      .run()
    return
  }

  await getPool(env).query(`
    insert into point_transactions (id, user_id, delta, type, reason, ref_id, balance_after, created_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (id) do nothing
  `, [tx.id, tx.userId, tx.delta, tx.type, tx.reason, tx.refId || null, tx.balanceAfter, tx.createdAt])
}

export async function ensurePointTransactionSchema(env: WorkerEnv) {
  const key = shouldUseD1(env) ? 'd1' : `pg:${env.HYPERDRIVE?.connectionString ?? ''}`
  if (pointSchemaPromise && pointSchemaKey === key)
    return pointSchemaPromise

  pointSchemaKey = key
  pointSchemaPromise = (async () => {
    if (shouldUseD1(env)) {
      await env.LOCAL_DB!
        .prepare(`
          create table if not exists point_transactions (
            id text primary key,
            user_id text not null,
            delta integer not null,
            type text not null,
            reason text not null,
            ref_id text,
            balance_after integer not null,
            created_at text not null default current_timestamp
          )
        `)
        .run()
      await env.LOCAL_DB!
        .prepare('create index if not exists idx_point_transactions_user_created on point_transactions (user_id, created_at desc, id desc)')
        .run()
      await env.LOCAL_DB!
        .prepare('create index if not exists idx_point_transactions_type on point_transactions (type)')
        .run()
      await env.LOCAL_DB!
        .prepare('create index if not exists idx_point_transactions_ref on point_transactions (ref_id)')
        .run()
      return
    }

    const pool = getPool(env)
    await pool.query(`
      create table if not exists point_transactions (
        id text primary key,
        user_id text not null,
        delta integer not null,
        type text not null,
        reason text not null,
        ref_id text,
        balance_after integer not null,
        created_at timestamptz not null default now()
      )
    `)
    await pool.query('create index if not exists idx_point_transactions_user_created on point_transactions (user_id, created_at desc, id desc)')
    await pool.query('create index if not exists idx_point_transactions_type on point_transactions (type)')
    await pool.query('create index if not exists idx_point_transactions_ref on point_transactions (ref_id)')
  })().catch((error) => {
    if (pointSchemaKey === key)
      pointSchemaPromise = undefined
    throw error
  })

  return pointSchemaPromise
}

export async function backfillPointTransactionsFromState(env: WorkerEnv, state: unknown) {
  await ensurePointTransactionSchema(env)
  const transactions = stateTransactions(state)
  if (!transactions.length) {
    sanitizeStateWithoutTransactions(state)
    return false
  }

  const byUser = new Map<string, CreditTransaction[]>()
  for (const tx of transactions) {
    if (!Number.isFinite(Number(tx.delta)) || !tx.userId)
      continue

    const rows = byUser.get(tx.userId) ?? []
    rows.push(normalizeTransaction(tx))
    byUser.set(tx.userId, rows)
  }

  for (const [userId, rows] of byUser) {
    let balance = await latestBalanceForUser(env, userId)
    if (balance === undefined) {
      const users = stateUsers(state)
      const user = users.find(item => isRecord(item) && item.id === userId)
      const currentPoints = isRecord(user) ? Number(user.points) : 0
      const totalDelta = rows.reduce((sum, item) => sum + item.delta, 0)
      balance = (Number.isFinite(currentPoints) ? currentPoints : 0) - totalDelta
    }

    for (const tx of rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      if (await transactionExists(env, tx.id))
        continue

      balance += tx.delta
      await insertPointTransaction(env, {
        id: tx.id,
        userId: tx.userId,
        delta: tx.delta,
        type: tx.type,
        reason: tx.reason,
        refId: tx.refId || '',
        balanceAfter: balance,
        createdAt: tx.createdAt,
      })
    }
  }

  sanitizeStateWithoutTransactions(state)
  return true
}

export async function applyPointTransactionsFromClientState(env: WorkerEnv, previousState: unknown, nextState: unknown) {
  const previousIds = new Set(stateTransactions(previousState).map(item => item.id))
  const clientTransactions = stateTransactions(nextState)
  if (!clientTransactions.length) {
    sanitizeStateWithoutTransactions(nextState)
    return
  }

  for (const tx of clientTransactions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (previousIds.has(tx.id) || await transactionExists(env, tx.id))
      continue

    await appendPointTransaction(env, {
      id: tx.id,
      userId: tx.userId,
      delta: tx.delta,
      type: tx.type,
      reason: tx.reason,
      refId: tx.refId,
      createdAt: tx.createdAt,
    }, previousState)
  }

  const previousUsers = stateUsers(previousState)
  const nextUsers = stateUsers(nextState)
  for (const nextUser of nextUsers) {
    if (!isRecord(nextUser) || typeof nextUser.id !== 'string')
      continue

    const previousUser = previousUsers.find(item => isRecord(item) && item.id === nextUser.id)
    if (isRecord(previousUser))
      nextUser.points = previousUser.points
  }

  sanitizeStateWithoutTransactions(nextState)
}

export async function appendPointTransaction(env: WorkerEnv, input: PointTransactionInput, stateOverride?: unknown) {
  await ensurePointTransactionSchema(env)
  const record = stateOverride === undefined ? await readWelfareStateRecord(env) : undefined
  const state = (stateOverride ?? record?.state) as Partial<WelfareState>
  const users = stateUsers(state)
  const user = users.find(item => isRecord(item) && item.id === input.userId)
  if (!isRecord(user))
    throw new Error('用户不存在')

  const delta = Math.trunc(Number(input.delta))
  if (!Number.isFinite(delta) || delta === 0)
    throw new Error('积分变动必须是非零整数')

  const currentPoints = Number(user.points)
  const currentBalance = Number.isFinite(currentPoints) ? currentPoints : 0
  const txId = input.id || createTransactionId()
  if (input.id && await transactionExists(env, input.id)) {
    return {
      id: txId,
      userId: input.userId,
      delta,
      type: input.type,
      reason: input.reason.trim() || '积分变动',
      refId: input.refId || undefined,
      balanceAfter: currentBalance,
      createdAt: input.createdAt || now(),
    } satisfies CreditTransaction
  }

  const balanceAfter = currentBalance + delta
  if (balanceAfter < 0 && !input.allowDebt)
    throw new Error('积分不足')

  const tx = {
    id: txId,
    userId: input.userId,
    delta,
    type: input.type,
    reason: input.reason.trim() || '积分变动',
    refId: input.refId || '',
    balanceAfter,
    createdAt: input.createdAt || now(),
  }

  user.points = balanceAfter
  await insertPointTransaction(env, tx)

  if (stateOverride === undefined)
    await writeWelfareState(env, state, { expectedVersion: record!.version })

  return {
    ...tx,
    refId: tx.refId || undefined,
  } satisfies CreditTransaction
}

async function queryPointTransactions(env: WorkerEnv, query: PointTransactionQuery) {
  await ensurePointTransactionSchema(env)
  const targetUserId = query.isAdmin ? query.userId?.trim() : query.currentUserId
  const limit = normalizeLimit(query.limit)
  const conditions: string[] = []
  const values: unknown[] = []

  function addCondition(sql: string, value: unknown) {
    values.push(value)
    const index = values.length
    conditions.push(sql.replaceAll('?', shouldUseD1(env) ? '?' : `$${index}`))
  }

  if (targetUserId)
    addCondition('user_id = ?', targetUserId)
  if (query.type && query.type !== 'all')
    addCondition('type = ?', query.type)
  if (query.direction === 'income' || query.direction === 'in')
    conditions.push('delta > 0')
  if (query.direction === 'expense' || query.direction === 'out')
    conditions.push('delta < 0')
  if (query.from)
    addCondition('created_at >= ?', query.from)
  if (query.to)
    addCondition('created_at <= ?', query.to)
  if (query.cursor)
    addCondition('created_at < ?', query.cursor)
  if (query.query) {
    const keyword = `%${query.query.toLowerCase()}%`
    values.push(keyword, keyword, keyword)
    if (shouldUseD1(env)) {
      conditions.push('(lower(reason) like ? or lower(type) like ? or lower(coalesce(ref_id, \'\')) like ?)')
    }
    else {
      const start = values.length - 2
      conditions.push(`(lower(reason) like $${start} or lower(type) like $${start + 1} or lower(coalesce(ref_id, '')) like $${start + 2})`)
    }
  }

  const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : ''
  const summarySql = `
    select
      coalesce(sum(case when delta > 0 then delta else 0 end), 0) as income,
      coalesce(sum(case when delta < 0 then -delta else 0 end), 0) as outcome,
      count(*) as count
    from point_transactions
    ${whereSql}
  `
  const listSql = `
    select * from point_transactions
    ${whereSql}
    order by created_at desc, id desc
    limit ${limit + 1}
  `

  if (shouldUseD1(env)) {
    const summary = await env.LOCAL_DB!
      .prepare(summarySql)
      .bind(...values)
      .first<{ income: number, outcome: number, count: number }>()
    const result = await env.LOCAL_DB!
      .prepare(listSql)
      .bind(...values)
      .all<PointTransactionRow>()
    const rows = (result.results ?? []).map(transactionFromRow)
    const visibleRows = rows.slice(0, limit)
    return {
      rows: visibleRows,
      nextCursor: rows.length > limit ? visibleRows.at(-1)?.createdAt : undefined,
      summary: {
        income: Number(summary?.income ?? 0),
        outcome: Number(summary?.outcome ?? 0),
        count: Number(summary?.count ?? 0),
      },
    }
  }

  const pool = getPool(env)
  const [summaryResult, listResult] = await Promise.all([
    pool.query<{ income: string, outcome: string, count: string }>(summarySql, values),
    pool.query<PointTransactionRow>(listSql, values),
  ])
  const rows = listResult.rows.map(transactionFromRow)
  const visibleRows = rows.slice(0, limit)
  const summary = summaryResult.rows[0]
  return {
    rows: visibleRows,
    nextCursor: rows.length > limit ? visibleRows.at(-1)?.createdAt : undefined,
    summary: {
      income: Number(summary?.income ?? 0),
      outcome: Number(summary?.outcome ?? 0),
      count: Number(summary?.count ?? 0),
    },
  }
}

export async function pointTransactionExistsByRef(env: WorkerEnv, type: CreditTransactionType, refId: string) {
  await ensurePointTransactionSchema(env)
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select id from point_transactions where type = ?1 and ref_id = ?2 limit 1')
      .bind(type, refId)
      .first<{ id: string }>()
    return !!row
  }

  const result = await getPool(env).query<{ id: string }>(
    'select id from point_transactions where type = $1 and ref_id = $2 limit 1',
    [type, refId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function syncUserPointBalancesFromLedger(env: WorkerEnv, state: unknown, userIds?: string[]) {
  const users = stateUsers(state)
  const allowedUserIds = userIds?.length ? new Set(userIds) : undefined
  const targetUsers = users.filter((user): user is Record<string, unknown> =>
    isRecord(user)
    && typeof user.id === 'string'
    && (!allowedUserIds || allowedUserIds.has(user.id)),
  )
  const latestBalances = await latestBalancesForUsers(env, targetUsers.map(user => user.id as string))
  let changed = false

  for (const user of targetUsers) {
    const ledgerBalance = latestBalances.get(user.id as string)
    if (ledgerBalance === undefined)
      continue

    const currentPoints = Number(user.points)
    if (Number.isFinite(currentPoints) && currentPoints === ledgerBalance)
      continue

    user.points = ledgerBalance
    changed = true
  }

  return changed
}

export async function handlePointRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    if (url.pathname !== '/api/points/transactions' || request.method !== 'GET')
      return json({ error: 'Method Not Allowed' }, 405)

    const state = await readWelfareState(env) as Partial<WelfareState>
    const users = Array.isArray(state.users) ? state.users : []
    const userId = await authenticatedUserId(request, env)
    if (!userId)
      throw new Error('请先登录')

    const user = users.find(item => item.id === userId)
    if (!user)
      throw new Error('用户不存在')

    const requestedUserId = url.searchParams.get('userId')?.trim() || ''
    if (user.role !== 'admin' && requestedUserId && requestedUserId !== user.id)
      return forbidden('无权读取其他用户的积分流水')

    const result = await queryPointTransactions(env, {
      currentUserId: user.id,
      isAdmin: user.role === 'admin',
      userId: requestedUserId || undefined,
      type: url.searchParams.get('type') || undefined,
      direction: url.searchParams.get('direction') || undefined,
      from: url.searchParams.get('from') || undefined,
      to: url.searchParams.get('to') || undefined,
      query: url.searchParams.get('query') || undefined,
      limit: Number(url.searchParams.get('limit') || 0),
      cursor: url.searchParams.get('cursor') || undefined,
    })

    const targetUserId = user.role === 'admin' ? requestedUserId : user.id
    let balance: number
    if (targetUserId) {
      balance = await currentBalanceForUser(env, users, targetUserId)
    }
    else {
      const latestBalances = await latestBalancesForUsers(env, users.map(item => item.id))
      balance = users.reduce((sum, user) => {
        const currentPoints = Number(user.points)
        return sum + (latestBalances.get(user.id) ?? (Number.isFinite(currentPoints) ? currentPoints : 0))
      }, 0)
    }
    return json({
      ...result,
      balance,
    })
  }
  catch (error) {
    return errorResponse(error)
  }
}
