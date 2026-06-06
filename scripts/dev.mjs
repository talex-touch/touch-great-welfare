import { spawn } from 'node:child_process'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const children = new Set()
let shuttingDown = false
let apiProcess
let viteProcess

function run(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  children.add(child)
  child.on('error', (error) => {
    children.delete(child)
    if (!shuttingDown) {
      console.error(`[dev] failed to start ${label}: ${error.message}`)
      shutdown(1)
    }
  })
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (!shuttingDown && code && code !== 0) {
      console.error(`[dev] ${label} exited with code ${code}${signal ? ` (${signal})` : ''}`)
      shutdown(code)
    }
  })

  return child
}

function pipe(child, label, onData) {
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      process.stdout.write(chunk)
      onData?.(chunk.toString())
    })
  }
}

function startVite() {
  if (viteProcess)
    return

  viteProcess = run('vite', ['--host', '0.0.0.0', '--port', '3333'], 'vite')
  pipe(viteProcess, 'vite')
}

function startWorkerApi() {
  apiProcess = run('wrangler', ['dev', '--config', 'wrangler.local.jsonc', '--port', '8787'], 'worker api')
  pipe(apiProcess, 'worker api', (text) => {
    if (text.includes('Ready on'))
      startVite()
  })
}

function shutdown(code = 0) {
  if (shuttingDown)
    return

  shuttingDown = true
  for (const child of children)
    child.kill()

  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const migrationProcess = run('wrangler', ['d1', 'migrations', 'apply', 'touch-great-welfare-local', '--local', '--config', 'wrangler.local.jsonc'], 'd1 migrations')
pipe(migrationProcess, 'd1 migrations')
migrationProcess.on('exit', (code) => {
  if (!shuttingDown && code === 0)
    startWorkerApi()
})
