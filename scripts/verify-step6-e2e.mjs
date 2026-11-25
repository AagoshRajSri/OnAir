import { spawn, execSync } from 'child_process'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_DIR = resolve(__dirname, '..')

const require = createRequire(join(REPO_DIR, 'package.json'))
const WebSocket = require('ws')

const SCRATCH_APPDATA = join(tmpdir(), `onair-e2e-${Date.now()}`)
const ONAIR_USERDATA = join(SCRATCH_APPDATA, 'onair')
const EXT_ID = 'step6verificationextension000001'
const TOKEN = randomBytes(32).toString('hex')
const PORT = 47821

await mkdir(ONAIR_USERDATA, { recursive: true })
await writeFile(
  join(ONAIR_USERDATA, 'settings.json'),
  JSON.stringify(
    {
      version: 1,
      bridgePort: PORT,
      bridgeToken: TOKEN,
      bridgeExtensionId: EXT_ID
    },
    null,
    2
  ),
  'utf-8'
)

const electronExe = resolve(REPO_DIR, 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, APPDATA: SCRATCH_APPDATA, FR_METRICS: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  electronExe,
  ['--no-sandbox', '--disable-gpu', `--user-data-dir=${ONAIR_USERDATA}`, REPO_DIR],
  {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  }
)

let stdoutLog = ''
let stderrLog = ''
let exitInfo = null
child.stdout.on('data', (d) => {
  stdoutLog += d.toString()
})
child.stderr.on('data', (d) => {
  stderrLog += d.toString()
})
child.on('exit', (code, signal) => {
  exitInfo = { code, signal }
})

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function connectWhenReady(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = await new Promise((res, rej) => {
        const client = new WebSocket(`ws://127.0.0.1:${PORT}`, {
          origin: `chrome-extension://${EXT_ID}`
        })
        client.once('open', () => res(client))
        client.once('error', rej)
      })
      return ws
    } catch {
      await sleep(150)
    }
  }
  throw new Error(
    `Timed out waiting for bridge on 127.0.0.1:${PORT}\nEXIT: ${JSON.stringify(exitInfo)}\nSTDOUT:\n${stdoutLog}\nSTDERR:\n${stderrLog}`
  )
}

try {
  const ws = await connectWhenReady()
  const netstatOut = execSync('netstat -ano | findstr 47821', { encoding: 'utf8' }).trim()
  console.log('=== NETSTAT ===')
  console.log(netstatOut)

  ws.send(JSON.stringify({ type: 'hello', token: TOKEN, provider: 'claude' }))
  await sleep(600)

  let accumulated = ''
  for (let i = 1; i <= 33; i++) {
    accumulated += (i > 1 ? ' ' : '') + `Streaming sentence number ${i}.`
    ws.send(
      JSON.stringify({
        type: 'content',
        id: 'step6-stream-1',
        seq: i,
        text: accumulated,
        final: i === 33,
        provider: 'claude',
        sentAt: performance.timeOrigin + performance.now()
      })
    )
    await sleep(60)
  }

  const csvPath = join(ONAIR_USERDATA, 'latency-results.csv')
  let rows = []
  const waitStart = Date.now()
  while (Date.now() - waitStart < 10000) {
    try {
      const csv = await readFile(csvPath, 'utf8')
      rows = csv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('bridge-transfer,'))
        .map((l) => Number.parseFloat(l.split(',')[2]))
        .filter((n) => Number.isFinite(n))
      if (rows.length >= 33) break
    } catch {
      /* waiting for csv */
    }
    await sleep(150)
  }

  ws.close()
  if (rows.length < 33) {
    throw new Error(`Expected 33 bridge-transfer rows, got ${rows.length}`)
  }

  const kept = rows.slice(3)
  const sorted = [...kept].sort((a, b) => a - b)
  const median = (sorted[14] + sorted[15]) / 2
  const p95 = sorted[Math.floor(sorted.length * 0.95) - 1]

  console.log('=== LATENCY (FR_METRICS=1) ===')
  console.log(`Total trials: ${rows.length}, Discarded: 3, Measured: ${kept.length}`)
  console.log(`All raw (ms): ${rows.map((x) => x.toFixed(3)).join(', ')}`)
  console.log(`Min: ${sorted[0].toFixed(3)} ms`)
  console.log(`Median: ${median.toFixed(3)} ms`)
  console.log(`P95: ${p95.toFixed(3)} ms`)
  console.log(`Max: ${sorted[sorted.length - 1].toFixed(3)} ms`)

  if (median >= 150) {
    throw new Error(`Median latency ${median.toFixed(3)} ms exceeded 150 ms target`)
  }
} finally {
  if (child.pid) {
    try {
      execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' })
    } catch {
      /* already exited */
    }
  }
  await sleep(300)
  await rm(SCRATCH_APPDATA, { recursive: true, force: true }).catch(() => {})
}

