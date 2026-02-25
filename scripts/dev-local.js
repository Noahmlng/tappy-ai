import { spawn } from 'node:child_process'

const processes = [
  {
    name: 'gateway',
    color: '\x1b[36m',
    cmd: 'npm',
    args: ['run', 'dev:gateway', '--workspace', '@ai-network/ad-aggregation-platform'],
  },
  {
    name: 'dashboard',
    color: '\x1b[35m',
    cmd: 'npm',
    args: ['run', 'dev', '--workspace', '@ai-network/simulator-dashboard'],
  },
]

const reset = '\x1b[0m'
const children = []
let shuttingDown = false

function prefixLine(name, color, line) {
  if (!line) return ''
  return `${color}[${name}]${reset} ${line}`
}

function attachOutput(child, proc) {
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      console.log(prefixLine(proc.name, proc.color, line))
    }
  })

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      console.error(prefixLine(proc.name, proc.color, line))
    }
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL')
    }
    process.exit(code)
  }, 500)
}

for (const proc of processes) {
  const child = spawn(proc.cmd, proc.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  children.push(child)
  attachOutput(child, proc)

  child.on('exit', (code) => {
    if (shuttingDown) return
    const exitCode = Number.isInteger(code) ? code : 1
    console.error(prefixLine(proc.name, proc.color, `exited with code ${exitCode}`))
    shutdown(exitCode)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('Starting local stack: gateway + dashboard')
