import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlaceholder(value) {
  return !value || value.startsWith('replace-with-') || value === 'local-only'
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function objectEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : []
}

const configPath = resolve('wrangler.production.jsonc')
const config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')))

const hyperdrive = Array.isArray(config.hyperdrive)
  ? config.hyperdrive.find(item => item?.binding === 'HYPERDRIVE')
  : undefined
const hyperdriveId = textValue(process.env.HYPERDRIVE_ID) || textValue(hyperdrive?.id)
if (isPlaceholder(hyperdriveId))
  fail('wrangler.production.jsonc 生产环境必须配置有效的 hyperdrive[HYPERDRIVE].id')

const localDb = Array.isArray(config.d1_databases)
  ? config.d1_databases.find(item => item?.binding === 'LOCAL_DB')
  : undefined
if (localDb)
  fail('wrangler.production.jsonc 不应配置 LOCAL_DB；生产数据源必须通过 HYPERDRIVE 连接 PostgreSQL')

const unsafeVars = new Map([
  ['USE_NORMALIZED_TABLES', 'true'],
  ['ALLOW_UNSTABLE_NORMALIZED_READS', 'true'],
  ['ENABLE_TEMP_ADMIN_ENDPOINTS', 'true'],
  ['ENABLE_LEGACY_STATE_WRITE', 'true'],
])
for (const [key, value] of objectEntries(config.vars)) {
  if (unsafeVars.get(key) === String(value).trim().toLowerCase())
    fail(`wrangler.production.jsonc 禁止在生产开启 ${key}=${value}`)
}

const queueProducers = Array.isArray(config.queues?.producers) ? config.queues.producers : []
const asyncProducer = queueProducers.find(item => item?.binding === 'ASYNC_JOBS')
const asyncQueueName = textValue(asyncProducer?.queue)
if (isPlaceholder(asyncQueueName))
  fail('wrangler.production.jsonc 需要有效的 queues.producers[ASYNC_JOBS].queue')

const queueConsumers = Array.isArray(config.queues?.consumers) ? config.queues.consumers : []
if (!queueConsumers.some(item => textValue(item?.queue) === asyncQueueName))
  fail('wrangler.production.jsonc 需要为 ASYNC_JOBS 队列配置 consumer')
