import type { WorkerEnv } from './welfare-state'
import type { UserCoupon, WelfareState } from '~/composables/welfare'
import { normalizeSystemConfig } from '~/composables/welfare'
import { assertSafeExternalUrl, normalizeUrlBase } from './auth'
import { decryptSecret, encryptSecret } from './crypto'
import {
  buildEpaySubmitUrl,
  createEpayNotifyUrl,
  createEpayOrderParams,
  createEpayReturnUrl,
  createLdcEpayConfig,
  formatLdcMoney,
  isLdcEpayConfigured,
  normalizeMoneyText,
  verifyEpaySign,
} from './ldc-credit'
import { appendPointTransaction, pointTransactionExistsByRef } from './points'
import { authenticatedUserId } from './session'
import { getPool, readWelfareState, shouldUseD1, writeWelfareState } from './welfare-state'

interface RechargeOrder {
  out_trade_no: string
  user_id: string
  amount: string
  credited_points: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  ldc_trade_no?: string | null
  payment_type: 'epay'
  order_name: string
  notify_payload?: string | null
  created_at?: string
  paid_at?: string | null
  updated_at?: string
}

interface RechargeMerchantConfig {
  id: string
  enabled: number | boolean
  gateway_base_url: string
  pid: string
  key?: string | null
  key_encrypted?: string | null
  points_per_ldc?: number | null
}

interface RechargeConfigPayload {
  gatewayBaseUrl?: string
  pid?: string
  key?: string
  enabled?: boolean
  pointsPerLdc?: number
}

interface RechargeCreatePayload {
  amount?: number
  userId?: string
  couponId?: string
}

const ORDER_PREFIX = 'TGW'
const MAX_JSON_BYTES = 64 * 1024
const DEFAULT_POINTS_PER_LDC = 10

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })
}

function text(payload: string, status = 200) {
  return new Response(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function errorResponse(error: unknown, status = 500) {
  return json({ error: error instanceof Error ? error.message : '服务端错误' }, status)
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function getRuntimeBaseUrl(request: Request) {
  return getRequestOrigin(request)
}

function encryptionSecret(env: WorkerEnv) {
  return env.NOTIFY_SECRET_KEY ?? ''
}

async function decryptOptionalSecret(value: string | null | undefined, env: WorkerEnv) {
  if (!value)
    return ''
  try {
    return await decryptSecret(value, encryptionSecret(env))
  }
  catch {
    return ''
  }
}

async function resolveStoredRechargeKey(stored: RechargeMerchantConfig | null | undefined, env: WorkerEnv) {
  return await decryptOptionalSecret(stored?.key_encrypted, env) || stored?.key || ''
}

async function getStoredRechargeConfig(env: WorkerEnv) {
  await ensureRechargeSchema(env)

  if (shouldUseD1(env)) {
    return await env.LOCAL_DB!
      .prepare('select * from recharge_merchant_config where id = ?1')
      .bind('default')
      .first<RechargeMerchantConfig>()
  }

  const result = await getPool(env).query<RechargeMerchantConfig>(
    'select * from recharge_merchant_config where id = $1',
    ['default'],
  )
  return result.rows[0] ?? null
}

async function upsertStoredRechargeConfig(env: WorkerEnv, payload: Required<RechargeConfigPayload>) {
  await ensureRechargeSchema(env)
  const gatewayBaseUrl = normalizeUrlBase(payload.gatewayBaseUrl)
  const keyEncrypted = await encryptSecret(payload.key, encryptionSecret(env))

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into recharge_merchant_config (id, enabled, gateway_base_url, pid, key, key_encrypted, points_per_ldc, updated_at)
        values ('default', ?1, ?2, ?3, '', ?4, ?5, current_timestamp)
        on conflict (id)
        do update set enabled = excluded.enabled, gateway_base_url = excluded.gateway_base_url, pid = excluded.pid, key = '', key_encrypted = excluded.key_encrypted, points_per_ldc = excluded.points_per_ldc, updated_at = current_timestamp
      `)
      .bind(payload.enabled ? 1 : 0, gatewayBaseUrl, payload.pid, keyEncrypted, payload.pointsPerLdc)
      .run()
    return
  }

  await getPool(env).query(`
    insert into recharge_merchant_config (id, enabled, gateway_base_url, pid, key, key_encrypted, points_per_ldc, updated_at)
    values ('default', $1, $2, $3, '', $4, $5, now())
    on conflict (id)
    do update set enabled = excluded.enabled, gateway_base_url = excluded.gateway_base_url, pid = excluded.pid, key = '', key_encrypted = excluded.key_encrypted, points_per_ldc = excluded.points_per_ldc, updated_at = now()
  `, [payload.enabled, gatewayBaseUrl, payload.pid, keyEncrypted, payload.pointsPerLdc])
}

function normalizePointsPerLdc(value: unknown) {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0)
    return DEFAULT_POINTS_PER_LDC

  return Math.max(1, Math.min(1000, Math.trunc(rate)))
}

function isRechargeCouponAvailable(coupon: UserCoupon, userId: string) {
  if (coupon.userId !== userId || coupon.usedAt)
    return false
  if (coupon.scope !== 'recharge' && coupon.scope !== 'general')
    return false
  if (!coupon.expiresAt)
    return true
  const expiresAt = new Date(coupon.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function applyRechargeCouponDiscount(amount: number, coupon?: UserCoupon) {
  if (!coupon)
    return { payableAmount: amount, discountAmount: 0 }

  if (coupon.minSpend && amount < coupon.minSpend)
    throw new Error('该充值优惠券未达到最低使用金额')

  let discountAmount = 0
  if (coupon.discountType === 'rate')
    discountAmount = Math.max(0, amount - Math.max(0.01, Math.ceil(amount * coupon.discountRate * 100) / 100))
  else
    discountAmount = coupon.discountAmount ?? 0

  if (coupon.maxDiscount)
    discountAmount = Math.min(discountAmount, coupon.maxDiscount)

  const payableAmount = Math.max(0.01, Math.ceil((amount - Math.min(amount, discountAmount)) * 100) / 100)
  return {
    payableAmount,
    discountAmount: Math.max(0, amount - payableAmount),
  }
}

async function getEffectiveRechargeSettings(env: WorkerEnv) {
  const stored = await getStoredRechargeConfig(env)
  return {
    enabled: stored
      ? !!stored.enabled
      : false,
    gatewayBaseUrl: normalizeUrlBase(stored?.gateway_base_url || 'https://credit.linux.do/epay'),
    pid: stored?.pid || '',
    key: await resolveStoredRechargeKey(stored, env),
    pointsPerLdc: normalizePointsPerLdc(stored?.points_per_ldc),
    source: stored ? 'admin' : 'empty',
  }
}

async function getLdcConfig(env: WorkerEnv) {
  const settings = await getEffectiveRechargeSettings(env)
  if (!settings.enabled)
    throw new Error('LINUX DO Credit 充值当前未启用，请在管理员后台启用')

  return createLdcEpayConfig({
    gatewayBaseUrl: settings.gatewayBaseUrl,
    pid: settings.pid,
    key: settings.key,
  })
}

function maskSecret(value?: string) {
  const text = value?.trim() ?? ''
  if (!text)
    return ''
  if (text.length <= 8)
    return '••••'
  return `${text.slice(0, 4)}••••${text.slice(-4)}`
}

async function readJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_JSON_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as T
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  }
  finally {
    clearTimeout(timer)
  }
}

async function ensureRechargeSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists recharge_orders (
          out_trade_no text primary key,
          user_id text not null,
          amount text not null,
          credited_points integer not null,
          status text not null,
          ldc_trade_no text,
          payment_type text not null default 'epay',
          order_name text not null,
          notify_payload text,
          created_at text not null default current_timestamp,
          paid_at text,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists recharge_merchant_config (
          id text primary key,
          enabled integer not null default 0,
          gateway_base_url text not null,
          pid text not null,
          key text not null,
          key_encrypted text,
          points_per_ldc integer not null default 10,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('alter table recharge_merchant_config add column key_encrypted text')
      .run()
      .catch(() => {})
    await env.LOCAL_DB!
      .prepare('alter table recharge_merchant_config add column points_per_ldc integer not null default 10')
      .run()
      .catch(() => {})
    return
  }

  const pool = getPool(env)
  await pool.query(`
    create table if not exists recharge_orders (
      out_trade_no text primary key,
      user_id text not null,
      amount text not null,
      credited_points integer not null,
      status text not null,
      ldc_trade_no text,
      payment_type text not null default 'epay',
      order_name text not null,
      notify_payload text,
      created_at timestamptz not null default now(),
      paid_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query(`
    create table if not exists recharge_merchant_config (
      id text primary key,
      enabled boolean not null default false,
      gateway_base_url text not null,
      pid text not null,
      key text not null,
      key_encrypted text,
      points_per_ldc integer not null default 10,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `)
  await pool.query('alter table recharge_merchant_config add column if not exists key_encrypted text')
  await pool.query('alter table recharge_merchant_config add column if not exists points_per_ldc integer not null default 10')
}

async function createOrder(env: WorkerEnv, order: RechargeOrder) {
  await ensureRechargeSchema(env)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into recharge_orders (
          out_trade_no, user_id, amount, credited_points, status, payment_type, order_name, updated_at
        ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, current_timestamp)
      `)
      .bind(
        order.out_trade_no,
        order.user_id,
        order.amount,
        order.credited_points,
        order.status,
        order.payment_type,
        order.order_name,
      )
      .run()
    return
  }

  await getPool(env).query(`
    insert into recharge_orders (
      out_trade_no, user_id, amount, credited_points, status, payment_type, order_name, updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, now())
  `, [
    order.out_trade_no,
    order.user_id,
    order.amount,
    order.credited_points,
    order.status,
    order.payment_type,
    order.order_name,
  ])
}

async function getOrder(env: WorkerEnv, outTradeNo: string) {
  await ensureRechargeSchema(env)

  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select * from recharge_orders where out_trade_no = ?1')
      .bind(outTradeNo)
      .first<RechargeOrder>()
    return row
  }

  const result = await getPool(env).query<RechargeOrder>(
    'select * from recharge_orders where out_trade_no = $1',
    [outTradeNo],
  )
  return result.rows[0] ?? null
}

async function markOrderSucceeded(env: WorkerEnv, outTradeNo: string, tradeNo: string, notifyPayload: Record<string, string>) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        update recharge_orders
        set status = 'succeeded', ldc_trade_no = ?2, notify_payload = ?3, paid_at = current_timestamp, updated_at = current_timestamp
        where out_trade_no = ?1 and status = 'pending'
      `)
      .bind(outTradeNo, tradeNo, JSON.stringify(notifyPayload))
      .run()
    return
  }

  await getPool(env).query(`
    update recharge_orders
    set status = 'succeeded', ldc_trade_no = $2, notify_payload = $3, paid_at = now(), updated_at = now()
    where out_trade_no = $1 and status = 'pending'
  `, [outTradeNo, tradeNo, JSON.stringify(notifyPayload)])
}

function rechargeTransactionId(outTradeNo: string) {
  return `srv_recharge_${outTradeNo.replace(/[^\w-]+/g, '_')}`
}

function createOutTradeNo() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.random().toString(36).slice(2, 10).toUpperCase()
  return `${ORDER_PREFIX}_${date}_${Date.now().toString(36).toUpperCase()}_${random}`
}

function assertWelfareState(input: Partial<WelfareState>): asserts input is WelfareState {
  if (!Array.isArray(input.users))
    throw new Error('用户状态未初始化')
  if (!Array.isArray(input.transactions))
    throw new Error('积分流水状态未初始化')
}

async function getCurrentUserId(request: Request, env: WorkerEnv) {
  const userId = await authenticatedUserId(request, env)
  if (!userId)
    throw new Error('请先登录后再充值')

  return userId
}

async function getCurrentUser(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)

  const userId = await authenticatedUserId(request, env)
  if (!userId)
    throw new Error('请先登录')

  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('用户不存在')

  return user
}

async function assertAdminRequest(request: Request, env: WorkerEnv) {
  const user = await getCurrentUser(request, env)
  if (user.role !== 'admin')
    throw new Error('需要管理员权限')
  return user
}

async function creditRechargeOrder(env: WorkerEnv, order: RechargeOrder, notifyPayload: Record<string, string>) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)

  const user = state.users.find(item => item.id === order.user_id)
  if (!user)
    throw new Error('充值订单对应的用户不存在')

  const alreadyCredited = await pointTransactionExistsByRef(env, 'recharge', order.out_trade_no)
  if (!alreadyCredited) {
    await appendPointTransaction(env, {
      id: rechargeTransactionId(order.out_trade_no),
      userId: user.id,
      delta: order.credited_points,
      type: 'recharge',
      reason: `LINUX DO Credit 充值到账 ${order.amount} LDC`,
      refId: order.out_trade_no,
    }, state)
    await writeWelfareState(env, state)
  }

  await markOrderSucceeded(env, order.out_trade_no, notifyPayload.trade_no ?? '', notifyPayload)
}

async function handleRechargeConfig(request: Request, env: WorkerEnv) {
  if (request.method === 'GET') {
    const settings = await getEffectiveRechargeSettings(env)
    const userId = await authenticatedUserId(request, env)
    const state = await readWelfareState(env) as Partial<WelfareState>
    assertWelfareState(state)
    const user = state.users.find(item => item.id === userId)
    const isAdmin = user?.role === 'admin'
    return json({
      enabled: settings.enabled,
      configured: isLdcEpayConfigured({ pid: settings.pid, key: settings.key }),
      gatewayBaseUrl: isAdmin ? settings.gatewayBaseUrl : '',
      pid: isAdmin ? settings.pid : '',
      keyMasked: isAdmin ? maskSecret(settings.key) : '',
      pointsPerLdc: settings.pointsPerLdc,
      paymentType: 'epay',
      source: settings.source,
    })
  }

  if (request.method === 'PUT') {
    await assertAdminRequest(request, env)
    const payload = await readJson<RechargeConfigPayload>(request)
    const previous = await getEffectiveRechargeSettings(env)
    const config = {
      enabled: payload.enabled !== false,
      gatewayBaseUrl: payload.gatewayBaseUrl?.trim() || previous.gatewayBaseUrl || 'https://credit.linux.do/epay',
      pid: payload.pid?.trim() || previous.pid,
      key: payload.key?.trim() || previous.key,
      pointsPerLdc: normalizePointsPerLdc(payload.pointsPerLdc ?? previous.pointsPerLdc),
    }

    if (!config.pid)
      throw new Error('请填写 LINUX DO Credit PID / Client ID')
    if (!config.key)
      throw new Error('请填写 LINUX DO Credit KEY / Client Secret')

    await upsertStoredRechargeConfig(env, config)

    return json({
      ok: true,
      message: '充值配置已保存到服务端配置。',
      env: {},
    })
  }

  return json({ error: 'Method Not Allowed' }, 405)
}

async function handleRechargeCreate(request: Request, env: WorkerEnv) {
  if (request.method !== 'POST')
    return json({ error: 'Method Not Allowed' }, 405)

  const payload = await readJson<RechargeCreatePayload>(request)
  const amount = Number(payload.amount)
  if (!Number.isInteger(amount))
    throw new Error('当前积分充值仅支持整数')

  const config = await getLdcConfig(env)
  const settings = await getEffectiveRechargeSettings(env)
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)
  const systemConfig = normalizeSystemConfig(state.systemConfig)
  if (!systemConfig.siteEnabled)
    throw new Error(systemConfig.siteClosedReason)
  if (!systemConfig.rechargeEnabled)
    throw new Error(systemConfig.rechargeClosedReason)

  const userId = await getCurrentUserId(request, env)
  const user = state.users.find(item => item.id === userId)
  if (!user)
    throw new Error('请先登录后再充值')

  const coupon = payload.couponId
    ? state.coupons.find(item => item.id === payload.couponId)
    : undefined
  if (payload.couponId && (!coupon || !isRechargeCouponAvailable(coupon, user.id)))
    throw new Error('充值优惠券不可用或已过期')

  const rechargeDiscount = applyRechargeCouponDiscount(amount, coupon)
  const amountText = formatLdcMoney(rechargeDiscount.payableAmount)
  const outTradeNo = createOutTradeNo()
  const orderName = rechargeDiscount.discountAmount > 0
    ? `Touch Great Welfare 积分充值 ${formatLdcMoney(amount)}（优惠 ${formatLdcMoney(rechargeDiscount.discountAmount)} LDC）`
    : `Touch Great Welfare 积分充值 ${amountText}`
  const creditedPoints = amount * settings.pointsPerLdc
  const baseUrl = getRuntimeBaseUrl(request)
  const notifyUrl = createEpayNotifyUrl(baseUrl)
  const returnUrl = createEpayReturnUrl(baseUrl)

  if (notifyUrl.length > 100 || returnUrl.length > 100)
    throw new Error('当前站点域名过长，超过 LINUX DO Credit 回调地址长度限制')

  const order: RechargeOrder = {
    out_trade_no: outTradeNo,
    user_id: user.id,
    amount: amountText,
    credited_points: creditedPoints,
    status: 'pending',
    payment_type: 'epay',
    order_name: orderName,
  }

  await createOrder(env, order)
  if (coupon) {
    coupon.usedAt = new Date().toISOString()
    coupon.usedFor = 'recharge_order'
    coupon.usedRefId = outTradeNo
    await writeWelfareState(env, state)
  }

  const params = createEpayOrderParams(config, {
    outTradeNo,
    amount: amountText,
    name: orderName,
    notifyUrl,
    returnUrl,
  })

  let response: Response
  try {
    response = await fetchWithTimeout(assertSafeExternalUrl(buildEpaySubmitUrl(config)).toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
      redirect: 'manual',
    })
  }
  catch (error) {
    throw new Error(error instanceof Error ? `LINUX DO Credit 请求失败：${error.message}` : 'LINUX DO Credit 请求失败')
  }

  const location = response.headers.get('location')
  if (location) {
    return json({
      outTradeNo,
      redirectUrl: new URL(location, config.gatewayBaseUrl).toString(),
      status: 'pending',
    })
  }

  const responseText = await response.text()
  let errorMessage = responseText.trim()

  try {
    const payload = JSON.parse(responseText) as { error_msg?: string }
    errorMessage = payload.error_msg || errorMessage
  }
  catch {}

  if (!errorMessage)
    errorMessage = 'LINUX DO Credit 创建充值订单失败'
  if (errorMessage.startsWith('<'))
    errorMessage = 'LINUX DO Credit 返回了 HTML 页面，可能被安全验证拦截或商户配置不正确'

  throw new Error(errorMessage)
}

async function handleRechargeNotify(request: Request, env: WorkerEnv) {
  if (request.method !== 'GET')
    return text('fail', 405)

  try {
    const config = await getLdcConfig(env)
    const url = new URL(request.url)
    const payload = Object.fromEntries(url.searchParams.entries())

    if (payload.pid !== config.pid)
      throw new Error('pid 不匹配')
    if (payload.type !== 'epay')
      throw new Error('支付类型不匹配')
    if (payload.trade_status !== 'TRADE_SUCCESS')
      throw new Error('交易状态不是成功')
    if (!verifyEpaySign(payload, config.key))
      throw new Error('签名验证失败')

    const outTradeNo = payload.out_trade_no
    if (!outTradeNo)
      throw new Error('缺少 out_trade_no')

    const order = await getOrder(env, outTradeNo)
    if (!order)
      throw new Error('本地充值订单不存在')

    if (order.status === 'succeeded')
      return text('success')

    if (order.status !== 'pending')
      throw new Error('订单状态不允许到账')

    const notifyAmount = normalizeMoneyText(payload.money ?? '')
    if (notifyAmount !== order.amount)
      throw new Error('回调金额和本地订单金额不一致')

    await creditRechargeOrder(env, order, payload)
    return text('success')
  }
  catch (error) {
    console.error('LINUX DO Credit notify failed', error)
    return text('fail', 400)
  }
}

async function handleRechargeReturn(request: Request) {
  const url = new URL(request.url)
  const outTradeNo = url.searchParams.get('out_trade_no') || url.searchParams.get('trade_no') || ''
  const redirectUrl = new URL('/dashboard/profile', url.origin)
  if (outTradeNo)
    redirectUrl.searchParams.set('recharge', outTradeNo)

  return Response.redirect(redirectUrl.toString(), 302)
}

async function handleRechargeStatus(request: Request, env: WorkerEnv) {
  if (request.method !== 'GET')
    return json({ error: 'Method Not Allowed' }, 405)

  const url = new URL(request.url)
  const outTradeNo = url.searchParams.get('out_trade_no')?.trim()
  if (!outTradeNo)
    throw new Error('缺少 out_trade_no')

  const order = await getOrder(env, outTradeNo)
  if (!order)
    return json({ error: '充值订单不存在' }, 404)

  const user = await getCurrentUser(request, env)
  if (user.role !== 'admin' && order.user_id !== user.id)
    return json({ error: '无权读取该充值订单' }, 403)

  return json({
    outTradeNo: order.out_trade_no,
    amount: order.amount,
    creditedPoints: order.credited_points,
    status: order.status,
    tradeNo: order.ldc_trade_no,
    createdAt: order.created_at,
    paidAt: order.paid_at,
  })
}

export async function handleRechargeRequest(request: Request, env: WorkerEnv) {
  const url = new URL(request.url)

  try {
    if (url.pathname === '/api/recharge/config')
      return await handleRechargeConfig(request, env)
    if (url.pathname === '/api/recharge/create')
      return await handleRechargeCreate(request, env)
    if (url.pathname === '/api/recharge/notify')
      return await handleRechargeNotify(request, env)
    if (url.pathname === '/api/recharge/return')
      return await handleRechargeReturn(request)
    if (url.pathname === '/api/recharge/status')
      return await handleRechargeStatus(request, env)

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}
