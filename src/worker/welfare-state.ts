import type { User, WelfareState } from '~/composables/welfare'
import { Pool } from 'pg'
import { createUserInviteCode } from '~/composables/welfare'
import { applyWelfareRetentionPolicy } from '../shared/welfare-retention'
import { base64UrlEncode, decryptSecret, encryptSecret, sha256Hex } from './crypto'
import { dispatchWelfareStateChangeNotifications } from './notifications'
import { applyPointTransactionsFromClientState, backfillPointTransactionsFromState } from './points'
import { authenticatedUserId, clearSessionCookie, createSessionCookie } from './session'

export interface WorkerEnv {
  LOCAL_DB?: D1Database
  AI_ASSETS?: R2Bucket
  HYPERDRIVE?: {
    connectionString: string
  }
  NOTIFY_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  WELFARE_STATE_SECRET_KEY?: string
}

const STATE_KEY = 'default'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MASKED_SECRET_MARKER = '****'

let pool: Pool | undefined
let poolKey = ''

interface EncryptedWelfareStateEnvelope {
  __encrypted: true
  payload: string
  encryptedAt: string
}

function getConnectionString(env: WorkerEnv) {
  return env.HYPERDRIVE?.connectionString
}

function stateEncryptionSecret(env: WorkerEnv) {
  return env.WELFARE_STATE_SECRET_KEY?.trim() || env.NOTIFY_SECRET_KEY?.trim() || ''
}

function isEncryptedWelfareStateEnvelope(value: unknown): value is EncryptedWelfareStateEnvelope {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).__encrypted === true
    && typeof (value as Record<string, unknown>).payload === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function maskSecret(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text)
    return ''
  if (text.length <= 8)
    return MASKED_SECRET_MARKER
  return `${text.slice(0, 4)}${MASKED_SECRET_MARKER}${text.slice(-4)}`
}

function isMaskedSecret(value: unknown) {
  return typeof value === 'string' && value.includes(MASKED_SECRET_MARKER)
}

function sanitizeUser(user: User): User {
  const { passwordHash: _passwordHash, ...visibleUser } = user
  return visibleUser
}

function clientVisibleWelfareState(state: unknown, currentUserId = '') {
  if (!isRecord(state))
    return state

  const applicationPolicy = isRecord(state.applicationPolicy)
    ? {
        ...state.applicationPolicy,
        turnstileSecretKey: maskSecret(state.applicationPolicy.turnstileSecretKey),
      }
    : state.applicationPolicy

  return {
    ...state,
    currentUserId: currentUserId || undefined,
    users: Array.isArray(state.users) ? state.users.map(user => isRecord(user) ? sanitizeUser(user as unknown as User) : user) : state.users,
    applicationPolicy,
  }
}

function publicBootstrapState(state: unknown) {
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const hasAdmin = users.some(user => isRecord(user) && user.role === 'admin')
  return {
    users: hasAdmin
      ? [{
          id: 'admin-present',
          role: 'admin',
          profile: {
            displayName: '管理员',
            email: '',
            studentVerified: false,
          },
          points: 0,
          accountStatus: 'active',
          createdAt: '',
          lastLoginAt: '',
        }]
      : [],
    createdAt: isRecord(state) && typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString(),
  }
}

async function requestUserId(request: Request, env: WorkerEnv) {
  return await authenticatedUserId(request, env)
}

async function canUpdateState(previousState: unknown, request: Request, env: WorkerEnv) {
  if (!isRecord(previousState))
    return false

  const userId = await requestUserId(request, env)
  if (!userId)
    return false

  const users = Array.isArray(previousState.users) ? previousState.users : []
  return users.some(item => isRecord(item) && item.id === userId && item.accountStatus !== 'suspended')
}

async function canUpdateSensitiveState(previousState: unknown, request: Request, env: WorkerEnv) {
  if (!isRecord(previousState))
    return false

  const userId = await requestUserId(request, env)
  if (!userId)
    return false

  const users = Array.isArray(previousState.users) ? previousState.users : []
  const user = users.find(item => isRecord(item) && item.id === userId)
  return isRecord(user) && user.role === 'admin'
}

async function mergeSensitiveWelfareState<T extends Record<string, unknown>>(previousState: unknown, nextState: T, request: Request, env: WorkerEnv): Promise<T> {
  if (!isRecord(previousState) || !isRecord(nextState) || !isRecord(nextState.applicationPolicy))
    return nextState

  const previousUsers = Array.isArray(previousState.users) ? previousState.users : []
  const nextUsers = Array.isArray(nextState.users)
    ? nextState.users.map((user) => {
        if (!isRecord(user))
          return user

        const previousUser = previousUsers.find(item => isRecord(item) && item.id === user.id)
        const previousPasswordHash = isRecord(previousUser) && typeof previousUser.passwordHash === 'string'
          ? previousUser.passwordHash
          : ''
        if (!previousPasswordHash)
          return user

        return {
          ...user,
          passwordHash: previousPasswordHash,
        }
      })
    : nextState.users

  const previousPolicy = isRecord(previousState.applicationPolicy) ? previousState.applicationPolicy : {}
  const previousTurnstileSecretKey = typeof previousPolicy.turnstileSecretKey === 'string'
    ? previousPolicy.turnstileSecretKey.trim()
    : ''
  const nextTurnstileSecretKey = typeof nextState.applicationPolicy.turnstileSecretKey === 'string'
    ? nextState.applicationPolicy.turnstileSecretKey.trim()
    : ''

  if (nextTurnstileSecretKey && !isMaskedSecret(nextTurnstileSecretKey) && await canUpdateSensitiveState(previousState, request, env)) {
    return {
      ...nextState,
      users: nextUsers,
    }
  }

  return {
    ...nextState,
    users: nextUsers,
    applicationPolicy: {
      ...nextState.applicationPolicy,
      turnstileSecretKey: previousTurnstileSecretKey,
    },
  } as T
}

async function decodeStoredState(env: WorkerEnv, storedState: unknown) {
  if (!isEncryptedWelfareStateEnvelope(storedState))
    return storedState

  const secret = stateEncryptionSecret(env)
  if (!secret)
    throw new Error('WELFARE_STATE_SECRET_KEY 未配置，无法读取加密业务状态')

  return JSON.parse(await decryptSecret(storedState.payload, secret))
}

async function encodeStoredState(env: WorkerEnv, state: unknown) {
  const secret = stateEncryptionSecret(env)
  if (!secret)
    return state

  return {
    __encrypted: true,
    payload: await encryptSecret(JSON.stringify(state), secret),
    encryptedAt: new Date().toISOString(),
  } satisfies EncryptedWelfareStateEnvelope
}

export function shouldUseD1(env: WorkerEnv) {
  return !!env.LOCAL_DB && !env.HYPERDRIVE
}

export function getPool(env: WorkerEnv) {
  const connectionString = getConnectionString(env)
  if (!connectionString)
    throw new Error('Hyperdrive binding is required')

  if (!pool || poolKey !== connectionString) {
    poolKey = connectionString
    pool = new Pool({
      connectionString,
    })
  }

  return pool
}

async function ensureSchema(env: WorkerEnv) {
  if (shouldUseD1(env))
    return

  await getPool(env).query(`
    create table if not exists welfare_app_state (
      id text primary key,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `)
}

export async function readWelfareState(env: WorkerEnv) {
  await ensureSchema(env)

  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select state from welfare_app_state where id = ?1')
      .bind(STATE_KEY)
      .first<{ state: string }>()

    const state = await decodeStoredState(env, row?.state ? JSON.parse(row.state) : {})
    const backfilled = await backfillPointTransactionsFromState(env, state)
    const result = applyWelfareRetentionPolicy(state)
    if (result.changed || backfilled)
      await writeWelfareState(env, result.state)

    return result.state
  }

  const result = await getPool(env).query(
    'select state from welfare_app_state where id = $1',
    [STATE_KEY],
  )

  const state = await decodeStoredState(env, result.rows[0]?.state ?? {})
  const backfilled = await backfillPointTransactionsFromState(env, state)
  const retentionResult = applyWelfareRetentionPolicy(state)
  if (retentionResult.changed || backfilled)
    await writeWelfareState(env, retentionResult.state)

  return retentionResult.state
}

export async function writeWelfareState(env: WorkerEnv, state: unknown) {
  await ensureSchema(env)
  await backfillPointTransactionsFromState(env, state)
  const storedState = await encodeStoredState(env, state)

  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        insert into welfare_app_state (id, state, updated_at)
        values (?1, ?2, current_timestamp)
        on conflict (id)
        do update set state = excluded.state, updated_at = current_timestamp
      `)
      .bind(STATE_KEY, JSON.stringify(storedState))
      .run()
    return
  }

  await getPool(env).query(
    `
      insert into welfare_app_state (id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set state = excluded.state, updated_at = now()
    `,
    [STATE_KEY, JSON.stringify(storedState)],
  )
}

function json(payload: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

function errorResponse(error: unknown) {
  return json({
    error: error instanceof Error ? error.message : '服务端错误',
  }, 500)
}

function assertStateShape(state: unknown): asserts state is Record<string, unknown> {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new Error('state must be an object')

  const record = state as Record<string, unknown>
  for (const key of ['users', 'applications', 'studentVerifications', 'educationEmailChallenges', 'crowdReviews', 'squarePosts', 'squareBoosts', 'squareReports', 'transactions']) {
    if (record[key] !== undefined && !Array.isArray(record[key]))
      throw new Error(`${key} must be an array`)
  }

  if (record.oauth !== undefined && (!record.oauth || typeof record.oauth !== 'object' || Array.isArray(record.oauth)))
    throw new Error('oauth must be an object')
}

async function readPayload(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw new Error('请求体过大')

  return JSON.parse(text || '{}') as { state?: unknown }
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function now() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function randomSalt() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
}

async function hashPassword(password: string, salt = randomSalt()) {
  return `v1:${salt}:${await sha256Hex(`${salt}:${password}`)}`
}

async function verifyPassword(password: string, storedHash: unknown) {
  if (typeof storedHash !== 'string')
    return false

  const [version, salt, expected] = storedHash.split(':')
  if (version !== 'v1' || !salt || !expected)
    return false

  return await hashPassword(password, salt) === storedHash
}

function assertPassword(value: unknown) {
  const password = typeof value === 'string' ? value : ''
  if (password.length < 8)
    throw new Error('管理员密码至少 8 位')

  return password
}

async function bootstrapAdmin(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  const users = Array.isArray(state.users) ? state.users : []
  if (users.some(user => user.role === 'admin'))
    throw new Error('管理员已经创建')

  const payload = await readPayload(request) as { displayName?: string, email?: string, password?: string }
  const email = normalizeEmail(payload.email)
  if (!email)
    throw new Error('请填写管理员邮箱')

  const password = assertPassword(payload.password)
  const adminId = createId('admin')
  const admin: User = {
    id: adminId,
    role: 'admin',
    profile: {
      displayName: payload.displayName?.trim() || '公益管理员',
      email,
      inviteCode: createUserInviteCode(adminId),
      githubAuthorized: false,
      studentVerified: false,
    },
    points: 0,
    passwordHash: await hashPassword(password),
    accountStatus: 'active',
    createdAt: now(),
    lastLoginAt: now(),
  }

  const nextState = {
    ...state,
    users: [admin],
    currentUserId: undefined,
    applications: [],
    studentVerifications: [],
    educationEmailChallenges: [],
    coupons: [],
    dailyCheckIns: [],
    invitationBindings: [],
    crowdReviews: [],
    squarePosts: [],
    squareBoosts: [],
    squareReports: [],
    transactions: [],
    createdAt: state.createdAt || now(),
  }
  await writeWelfareState(env, nextState)
  return json({ ok: true })
}

async function loginAdmin(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env) as Partial<WelfareState>
  const users = Array.isArray(state.users) ? state.users : []
  const payload = await readPayload(request) as { email?: string, password?: string }
  const email = normalizeEmail(payload.email)
  const admin = users.find(user => user.role === 'admin' && normalizeEmail(user.profile.email) === email)
  if (!admin || !await verifyPassword(typeof payload.password === 'string' ? payload.password : '', admin.passwordHash))
    throw new Error('管理员账号或密码错误')

  admin.lastLoginAt = now()
  delete state.currentUserId
  await writeWelfareState(env, state)
  return json({ ok: true, userId: admin.id }, 200, {
    'set-cookie': await createSessionCookie(request, env, admin.id),
  })
}

async function currentStateResponse(request: Request, env: WorkerEnv) {
  const state = await readWelfareState(env)
  const userId = await requestUserId(request, env)
  const users = isRecord(state) && Array.isArray(state.users) ? state.users : []
  const user = userId ? users.find(item => isRecord(item) && item.id === userId) : undefined

  if (!user)
    return json({ state: publicBootstrapState(state) })

  return json({ state: clientVisibleWelfareState(state, userId), currentUserId: userId })
}

export async function handleWelfareStateRequest(request: Request, env: WorkerEnv) {
  try {
    if (request.method === 'GET')
      return currentStateResponse(request, env)

    if (request.method === 'POST') {
      const action = request.headers.get('x-welfare-action')?.trim()
      if (action === 'bootstrap-admin')
        return await bootstrapAdmin(request, env)
      if (action === 'login-admin')
        return await loginAdmin(request, env)
      if (action === 'logout')
        return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(request) })
    }

    if (request.method === 'PUT') {
      const previousState = await readWelfareState(env)
      if (!await canUpdateState(previousState, request, env))
        throw new Error('请先登录')

      const payload = await readPayload(request)
      assertStateShape(payload.state)
      const mergedSensitiveState = await mergeSensitiveWelfareState(previousState, payload.state, request, env)
      await applyPointTransactionsFromClientState(env, previousState, mergedSensitiveState)
      const nextState = applyWelfareRetentionPolicy(mergedSensitiveState).state
      if (isRecord(nextState))
        delete nextState.currentUserId
      await writeWelfareState(env, nextState)
      await dispatchWelfareStateChangeNotifications(env, previousState, nextState)
      return json({ ok: true })
    }

    return json({ error: 'Method Not Allowed' }, 405)
  }
  catch (error) {
    return errorResponse(error)
  }
}
