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

const configPath = resolve('wrangler.production.jsonc')
const config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')))

const hyperdrive = Array.isArray(config.hyperdrive)
  ? config.hyperdrive.find(item => item?.binding === 'HYPERDRIVE')
  : undefined
const hyperdriveId = textValue(hyperdrive?.id)
if (hyperdrive && isPlaceholder(hyperdriveId)) {
  console.error('wrangler.production.jsonc hyperdrive[HYPERDRIVE].id 仍是空值或占位符')
  process.exit(1)
}

const localDb = Array.isArray(config.d1_databases)
  ? config.d1_databases.find(item => item?.binding === 'LOCAL_DB')
  : undefined
const localDbId = textValue(localDb?.database_id)
if (!hyperdriveId && isPlaceholder(localDbId)) {
  console.error('wrangler.production.jsonc 需要有效的 HYPERDRIVE 或 LOCAL_DB 生产绑定')
  process.exit(1)
}

const queueProducers = Array.isArray(config.queues?.producers) ? config.queues.producers : []
const asyncProducer = queueProducers.find(item => item?.binding === 'ASYNC_JOBS')
const asyncQueueName = textValue(asyncProducer?.queue)
if (isPlaceholder(asyncQueueName)) {
  console.error('wrangler.production.jsonc 需要有效的 queues.producers[ASYNC_JOBS].queue')
  process.exit(1)
}

const queueConsumers = Array.isArray(config.queues?.consumers) ? config.queues.consumers : []
if (!queueConsumers.some(item => textValue(item?.queue) === asyncQueueName)) {
  console.error('wrangler.production.jsonc 需要为 ASYNC_JOBS 队列配置 consumer')
  process.exit(1)
}
