import type { WorkerEnv } from './env'
import type { UserCoupon, WelfareApplication } from '~/shared/welfare-types'
import { getPool, shouldUseD1 } from './connection'
import { isRecord } from './records'

const SNAPSHOT_STATE_KEY = 'default'
const POSTGRES_SNAPSHOT_BATCH_SIZE = 200

let postgresSnapshotSchemaKey = ''
let postgresSnapshotSchemaPromise: Promise<void> | undefined
const d1SnapshotSchemaPromises = new WeakMap<D1Database, Promise<void>>()

export interface WelfareSnapshotRecord<T> {
  items: T[]
  stateVersion?: number
}

function now() {
  return new Date().toISOString()
}

async function runSnapshotSchemaSetup(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_applications (
          id text primary key,
          user_id text not null,
          type text not null,
          status text not null,
          title text not null,
          payload text not null,
          created_at text not null,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_status_created on welfare_applications (status, created_at asc, id asc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_welfare_applications_user_status_created on welfare_applications (user_id, status, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists user_coupons (
          id text primary key,
          user_id text not null,
          name text not null,
          scope text,
          discount_type text,
          discount_rate real not null,
          discount_amount integer,
          payload text not null,
          created_at text not null,
          expires_at text,
          used_at text
        )
      `)
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
      .run()
    await env.LOCAL_DB!
      .prepare('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
      .run()
    await env.LOCAL_DB!
      .prepare(`
        create table if not exists welfare_snapshot_metadata (
          id text primary key,
          state_version integer not null,
          updated_at text not null default current_timestamp
        )
      `)
      .run()
    return
  }

  await getPool(env).query(`
    create table if not exists welfare_applications (
      id text primary key,
      user_id text not null,
      type text not null,
      status text not null,
      title text not null,
      payload text not null,
      created_at text not null,
      updated_at text not null default current_timestamp
    )
  `)
  await getPool(env).query('create index if not exists idx_welfare_applications_user_created on welfare_applications (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_welfare_applications_status on welfare_applications (status)')
  await getPool(env).query('create index if not exists idx_welfare_applications_status_created on welfare_applications (status, created_at asc, id asc)')
  await getPool(env).query('create index if not exists idx_welfare_applications_user_status_created on welfare_applications (user_id, status, created_at desc, id desc)')
  await getPool(env).query(`
    create table if not exists user_coupons (
      id text primary key,
      user_id text not null,
      name text not null,
      scope text,
      discount_type text,
      discount_rate real not null,
      discount_amount integer,
      payload text not null,
      created_at text not null,
      expires_at text,
      used_at text
    )
  `)
  await getPool(env).query('create index if not exists idx_user_coupons_user_created on user_coupons (user_id, created_at desc, id desc)')
  await getPool(env).query('create index if not exists idx_user_coupons_user_used on user_coupons (user_id, used_at)')
  await getPool(env).query(`
    create table if not exists welfare_snapshot_metadata (
      id text primary key,
      state_version bigint not null,
      updated_at timestamptz not null default now()
    )
  `)
}

export async function ensureSnapshotSchema(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    const db = env.LOCAL_DB!
    const current = d1SnapshotSchemaPromises.get(db)
    if (current)
      return current

    const next = runSnapshotSchemaSetup(env).catch((error) => {
      if (d1SnapshotSchemaPromises.get(db) === next)
        d1SnapshotSchemaPromises.delete(db)
      throw error
    })
    d1SnapshotSchemaPromises.set(db, next)
    return next
  }

  const key = `pg:${env.HYPERDRIVE?.connectionString ?? ''}`
  if (postgresSnapshotSchemaPromise && postgresSnapshotSchemaKey === key)
    return postgresSnapshotSchemaPromise

  postgresSnapshotSchemaKey = key
  postgresSnapshotSchemaPromise = runSnapshotSchemaSetup(env).catch((error) => {
    if (postgresSnapshotSchemaKey === key)
      postgresSnapshotSchemaPromise = undefined
    throw error
  })
  return postgresSnapshotSchemaPromise
}

function normalizeOptionalStateVersion(value: unknown) {
  const version = Math.trunc(Number(value))
  return Number.isFinite(version) && version > 0 ? version : undefined
}

async function storedSnapshotStateVersion(env: WorkerEnv) {
  if (shouldUseD1(env)) {
    const row = await env.LOCAL_DB!
      .prepare('select state_version from welfare_snapshot_metadata where id = ?1')
      .bind(SNAPSHOT_STATE_KEY)
      .first<{ state_version?: number }>()
    return normalizeOptionalStateVersion(row?.state_version)
  }

  const row = (await getPool(env).query<{ state_version?: number }>(
    'select state_version from welfare_snapshot_metadata where id = $1',
    [SNAPSHOT_STATE_KEY],
  )).rows[0]
  return normalizeOptionalStateVersion(row?.state_version)
}

export async function readSnapshotStateVersion(env: WorkerEnv) {
  await ensureSnapshotSchema(env)
  return storedSnapshotStateVersion(env)
}

async function readConsistentSnapshot<T>(env: WorkerEnv, readItems: () => Promise<T[]>): Promise<WelfareSnapshotRecord<T>> {
  await ensureSnapshotSchema(env)
  const versionBefore = await storedSnapshotStateVersion(env)
  if (versionBefore === undefined)
    return { items: [] }

  let items: T[]
  try {
    items = await readItems()
  }
  catch {
    return { items: [] }
  }
  const versionAfter = await storedSnapshotStateVersion(env)
  return {
    items,
    stateVersion: versionBefore === versionAfter ? versionAfter : undefined,
  }
}

export async function readCurrentUserApplicationSnapshots(env: WorkerEnv, userId: string, options: { status?: string[], limit?: number, offset?: number } = {}) {
  const status = options.status?.filter(Boolean) ?? []
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  return readConsistentSnapshot(env, async () => {
    if (shouldUseD1(env)) {
      const statusClause = status.length ? ` and status in (${status.map(() => '?').join(', ')})` : ''
      const result = await env.LOCAL_DB!
        .prepare(`select payload from welfare_applications where user_id = ?${statusClause} order by created_at desc, id desc limit ? offset ?`)
        .bind(userId, ...status, limit, offset)
        .all<{ payload: string }>()
      return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
    }

    const result = status.length
      ? await getPool(env).query<{ payload: string }>(
          'select payload from welfare_applications where user_id = $1 and status = any($2) order by created_at desc, id desc limit $3 offset $4',
          [userId, status, limit, offset],
        )
      : await getPool(env).query<{ payload: string }>(
          'select payload from welfare_applications where user_id = $1 order by created_at desc, id desc limit $2 offset $3',
          [userId, limit, offset],
        )
    return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
  })
}

export async function readAdminApplicationSnapshots(env: WorkerEnv, options: { status?: string[], limit?: number, offset?: number } = {}) {
  const status = options.status?.filter(Boolean) ?? []
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0

  return readConsistentSnapshot(env, async () => {
    if (shouldUseD1(env)) {
      const statusClause = status.length ? ` where status in (${status.map(() => '?').join(', ')})` : ''
      const result = await env.LOCAL_DB!
        .prepare(`select payload from welfare_applications${statusClause} order by created_at desc, id desc limit ? offset ?`)
        .bind(...status, limit, offset)
        .all<{ payload: string }>()
      return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
    }

    const result = status.length
      ? await getPool(env).query<{ payload: string }>(
          'select payload from welfare_applications where status = any($1) order by created_at desc, id desc limit $2 offset $3',
          [status, limit, offset],
        )
      : await getPool(env).query<{ payload: string }>(
          'select payload from welfare_applications order by created_at desc, id desc limit $1 offset $2',
          [limit, offset],
        )
    return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
  })
}

export async function readCurrentUserCouponSnapshots(env: WorkerEnv, userId: string) {
  return readConsistentSnapshot(env, async () => {
    if (shouldUseD1(env)) {
      const result = await env.LOCAL_DB!
        .prepare('select payload from user_coupons where user_id = ?1 order by created_at desc, id desc')
        .bind(userId)
        .all<{ payload: string }>()
      return (result.results ?? []).map(row => JSON.parse(row.payload) as UserCoupon)
    }

    const result = await getPool(env).query<{ payload: string }>(
      'select payload from user_coupons where user_id = $1 order by created_at desc, id desc',
      [userId],
    )
    return result.rows.map(row => JSON.parse(row.payload) as UserCoupon)
  })
}

export async function readAllApplicationSnapshots(env: WorkerEnv) {
  return readConsistentSnapshot(env, async () => {
    if (shouldUseD1(env)) {
      const result = await env.LOCAL_DB!
        .prepare('select payload from welfare_applications order by created_at desc, id desc')
        .all<{ payload: string }>()
      return (result.results ?? []).map(row => JSON.parse(row.payload) as WelfareApplication)
    }

    const result = await getPool(env).query<{ payload: string }>(
      'select payload from welfare_applications order by created_at desc, id desc',
    )
    return result.rows.map(row => JSON.parse(row.payload) as WelfareApplication)
  })
}

export async function readAllCouponSnapshots(env: WorkerEnv) {
  return readConsistentSnapshot(env, async () => {
    if (shouldUseD1(env)) {
      const result = await env.LOCAL_DB!
        .prepare('select payload from user_coupons order by created_at desc, id desc')
        .all<{ payload: string }>()
      return (result.results ?? []).map(row => JSON.parse(row.payload) as UserCoupon)
    }

    const result = await getPool(env).query<{ payload: string }>(
      'select payload from user_coupons order by created_at desc, id desc',
    )
    return result.rows.map(row => JSON.parse(row.payload) as UserCoupon)
  })
}

function applicationSnapshotUpdatedAt(application: WelfareApplication) {
  return application.completedAt
    || application.reviewedAt
    || application.submittedAt
    || application.deliveryRewardedAt
    || application.deliverySubmittedAt
    || application.deliveryClaimedAt
    || application.createdAt
    || now()
}

function couponSnapshotDiscountRate(coupon: UserCoupon) {
  const rate = Number(coupon.discountRate ?? 1)
  return Number.isFinite(rate) ? rate : 1
}

function applicationSnapshotValues(application: WelfareApplication) {
  return [
    application.id,
    application.userId,
    application.type,
    application.status,
    application.title || '未命名申请',
    JSON.stringify(application),
    application.createdAt || now(),
    applicationSnapshotUpdatedAt(application),
  ]
}

function couponSnapshotValues(coupon: UserCoupon) {
  return [
    coupon.id,
    coupon.userId,
    coupon.name || '未命名优惠券',
    coupon.scope ?? null,
    coupon.discountType ?? 'rate',
    couponSnapshotDiscountRate(coupon),
    coupon.discountAmount ?? null,
    JSON.stringify(coupon),
    coupon.createdAt || now(),
    coupon.expiresAt ?? null,
    coupon.usedAt ?? null,
  ]
}

async function runD1Statements(env: WorkerEnv, statements: Array<ReturnType<D1Database['prepare']>>) {
  if (!statements.length)
    return

  const localDb = env.LOCAL_DB! as D1Database & {
    batch?: (items: Array<ReturnType<D1Database['prepare']>>) => Promise<unknown[]>
  }
  if (typeof localDb.batch === 'function') {
    await localDb.batch(statements)
    return
  }

  for (const statement of statements)
    await statement.run()
}

function postgresValuesPlaceholders(rowCount: number, columnCount: number) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const offset = rowIndex * columnCount
    return `(${Array.from({ length: columnCount }, (__, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`
  }).join(', ')
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size))
  return result
}

async function syncD1StateSnapshots(
  env: WorkerEnv,
  applications: WelfareApplication[],
  coupons: UserCoupon[],
  deletedApplicationIds: string[],
  deletedCouponIds: string[],
  stateVersion: number,
  rebuild: boolean,
) {
  const localDb = env.LOCAL_DB!
  await runD1Statements(env, [
    ...(rebuild
      ? [
          localDb.prepare('delete from welfare_applications'),
          localDb.prepare('delete from user_coupons'),
        ]
      : []),
    ...applications.map(application => localDb
      .prepare(`
        insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        on conflict (id)
        do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
      `)
      .bind(...applicationSnapshotValues(application))),
    ...coupons.map(coupon => localDb
      .prepare(`
        insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        on conflict (id)
        do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
      `)
      .bind(...couponSnapshotValues(coupon))),
    ...deletedApplicationIds.map(id => localDb
      .prepare('delete from welfare_applications where id = ?1')
      .bind(id)),
    ...deletedCouponIds.map(id => localDb
      .prepare('delete from user_coupons where id = ?1')
      .bind(id)),
    localDb
      .prepare(`
        insert into welfare_snapshot_metadata (id, state_version, updated_at)
        values (?1, ?2, current_timestamp)
        on conflict (id)
        do update set state_version = excluded.state_version, updated_at = current_timestamp
      `)
      .bind(SNAPSHOT_STATE_KEY, stateVersion),
  ])
}

async function syncPostgresStateSnapshots(
  env: WorkerEnv,
  applications: WelfareApplication[],
  coupons: UserCoupon[],
  deletedApplicationIds: string[],
  deletedCouponIds: string[],
  stateVersion: number,
  rebuild: boolean,
) {
  const client = await getPool(env).connect()
  try {
    await client.query('begin')
    if (rebuild) {
      await client.query('delete from welfare_applications')
      await client.query('delete from user_coupons')
    }
    else {
      if (deletedApplicationIds.length)
        await client.query('delete from welfare_applications where id = any($1)', [deletedApplicationIds])
      if (deletedCouponIds.length)
        await client.query('delete from user_coupons where id = any($1)', [deletedCouponIds])
    }

    for (const batch of chunks(applications, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
      const values = batch.flatMap(applicationSnapshotValues)
      await client.query(
        `
          insert into welfare_applications (id, user_id, type, status, title, payload, created_at, updated_at)
          values ${postgresValuesPlaceholders(batch.length, 8)}
          on conflict (id)
          do update set user_id = excluded.user_id, type = excluded.type, status = excluded.status, title = excluded.title, payload = excluded.payload, updated_at = excluded.updated_at
        `,
        values,
      )
    }
    for (const batch of chunks(coupons, POSTGRES_SNAPSHOT_BATCH_SIZE)) {
      const values = batch.flatMap(couponSnapshotValues)
      await client.query(
        `
          insert into user_coupons (id, user_id, name, scope, discount_type, discount_rate, discount_amount, payload, created_at, expires_at, used_at)
          values ${postgresValuesPlaceholders(batch.length, 11)}
          on conflict (id)
          do update set user_id = excluded.user_id, name = excluded.name, scope = excluded.scope, discount_type = excluded.discount_type, discount_rate = excluded.discount_rate, discount_amount = excluded.discount_amount, payload = excluded.payload, expires_at = excluded.expires_at, used_at = excluded.used_at
        `,
        values,
      )
    }
    await client.query(
      `
        insert into welfare_snapshot_metadata (id, state_version, updated_at)
        values ($1, $2, now())
        on conflict (id)
        do update set state_version = excluded.state_version, updated_at = now()
      `,
      [SNAPSHOT_STATE_KEY, stateVersion],
    )
    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
  finally {
    client.release()
  }
}

function snapshotItems<T extends { id: string }>(state: unknown, key: 'applications' | 'coupons') {
  return isRecord(state) && Array.isArray(state[key])
    ? state[key].filter((item): item is T => isRecord(item) && typeof item.id === 'string')
    : []
}

function changedSnapshotItems<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return nextItems

  const previousItems = snapshotItems<T>(previousState, key)
  const previousPayloadById = new Map(previousItems.map(item => [item.id, JSON.stringify(item)]))
  return nextItems.filter(item => previousPayloadById.get(item.id) !== JSON.stringify(item))
}

function deletedSnapshotIds<T extends { id: string }>(previousState: unknown, nextItems: T[], key: 'applications' | 'coupons') {
  if (!isRecord(previousState))
    return []

  const nextIds = new Set(nextItems.map(item => item.id))
  return snapshotItems<T>(previousState, key)
    .filter(item => !nextIds.has(item.id))
    .map(item => item.id)
}

async function readStoredSnapshotsForSync(env: WorkerEnv, expectedVersion: number) {
  const versionBefore = await storedSnapshotStateVersion(env)
  if (versionBefore !== expectedVersion)
    return undefined

  const applications = shouldUseD1(env)
    ? (await env.LOCAL_DB!
        .prepare('select id, payload from welfare_applications')
        .all<{ id: string, payload: string }>()).results ?? []
    : (await getPool(env).query<{ id: string, payload: string }>('select id, payload from welfare_applications')).rows
  const coupons = shouldUseD1(env)
    ? (await env.LOCAL_DB!
        .prepare('select id, payload from user_coupons')
        .all<{ id: string, payload: string }>()).results ?? []
    : (await getPool(env).query<{ id: string, payload: string }>('select id, payload from user_coupons')).rows
  const versionAfter = await storedSnapshotStateVersion(env)
  if (versionAfter !== expectedVersion)
    return undefined

  try {
    const parsedApplications = applications.map((row) => {
      const application = JSON.parse(row.payload) as WelfareApplication
      if (!isRecord(application) || application.id !== row.id)
        throw new Error('invalid application snapshot')
      return application
    })
    const parsedCoupons = coupons.map((row) => {
      const coupon = JSON.parse(row.payload) as UserCoupon
      if (!isRecord(coupon) || coupon.id !== row.id)
        throw new Error('invalid coupon snapshot')
      return coupon
    })
    return {
      applications: parsedApplications,
      coupons: parsedCoupons,
    }
  }
  catch {
    return undefined
  }
}

export async function syncStateSnapshots(env: WorkerEnv, state: unknown, stateVersion: number) {
  if (!isRecord(state))
    return

  await ensureSnapshotSchema(env)
  const allApplications = snapshotItems<WelfareApplication>(state, 'applications')
  const allCoupons = snapshotItems<UserCoupon>(state, 'coupons')
  const storedSnapshots = await readStoredSnapshotsForSync(env, stateVersion - 1)
  const rebuild = storedSnapshots === undefined
  const applications = rebuild ? allApplications : changedSnapshotItems(storedSnapshots, allApplications, 'applications')
  const coupons = rebuild ? allCoupons : changedSnapshotItems(storedSnapshots, allCoupons, 'coupons')
  const deletedApplicationIds = rebuild ? [] : deletedSnapshotIds(storedSnapshots, allApplications, 'applications')
  const deletedCouponIds = rebuild ? [] : deletedSnapshotIds(storedSnapshots, allCoupons, 'coupons')

  if (shouldUseD1(env)) {
    await syncD1StateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds, stateVersion, rebuild)
    return
  }

  await syncPostgresStateSnapshots(env, applications, coupons, deletedApplicationIds, deletedCouponIds, stateVersion, rebuild)
}
