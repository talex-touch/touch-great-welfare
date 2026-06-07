import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const configPath = resolve('wrangler.production.jsonc')
const config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')))
const hyperdrive = Array.isArray(config.hyperdrive)
  ? config.hyperdrive.find(item => item?.binding === 'HYPERDRIVE')
  : undefined
const id = typeof hyperdrive?.id === 'string' ? hyperdrive.id.trim() : ''

if (!id || id === 'replace-with-hyperdrive-id') {
  console.error('wrangler.production.jsonc hyperdrive[HYPERDRIVE].id 仍是空值或占位符')
  process.exit(1)
}
