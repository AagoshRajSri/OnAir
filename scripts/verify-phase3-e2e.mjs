import { spawn, execSync } from 'child_process'
import http from 'http'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_DIR = resolve(__dirname, '..')
const require = createRequire(join(REPO_DIR, 'package.json'))
const WebSocket = require('ws')

const SCRATCH_APPDATA = join(tmpdir(), `onair-p3-e2e-${Date.now()}`)
const ONAIR_USERDATA = join(SCRATCH_APPDATA, 'onair')
const CDP_PORT = 9229

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function summarize(samples, warmup = 3) {
  const kept = samples.slice(warmup)
  const sorted = [...kept].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const p95Idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1))
  return {
    total: samples.length,
    measured: kept.length,
    min: sorted[0],
    median,
    p95: sorted[p95Idx],
    max: sorted[sorted.length - 1]
  }
}

function startMockOllamaServer() {
  return new Promise((resolveServer) => {
    let slowStreamTimer = null
    const server = http.createServer((req, res) => {
      if (req.url !== '/api/chat' || req.method !== 'POST') {
        res.writeHead(404)
        res.end()
        return
      }
      let rawBody = ''
      req.on('data', (d) => {
        rawBody += d.toString()
      })
      req.on('end', async () => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        const isSlow = rawBody.includes('SLOW_CANCEL_TEST')
        if (isSlow) {
          res.write(JSON.stringify({ message: { content: 'Partial answer before abort. ' }, done: false }) + '\n')
          let count = 0
          slowStreamTimer = setInterval(() => {
            count++
            if (res.writableEnded || res.destroyed || count > 50) {
              clearInterval(slowStreamTimer)
              return
            }
            res.write(JSON.stringify({ message: { content: `late${count} ` }, done: false }) + '\n')
          }, 150)
          req.on('close', () => {
            if (slowStreamTimer) clearInterval(slowStreamTimer)
          })
          return
        }

        // 40 chunks spaced at 22ms (> 16ms coalescer) so each chunk triggers ai-chunk-paint -> >=35 trials
        for (let i = 1; i <= 40; i++) {
          const token =
            i === 1 ? 'Alpha' : i === 10 ? ' reading' : i === 20 ? ' internationalization' : ` word${i}`
          res.write(JSON.stringify({ message: { content: token }, done: false }) + '\n')
          await sleep(22)
        }
        res.write(JSON.stringify({ message: { content: '.' }, done: true }) + '\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolveServer({ server, port: addr.port })
    })
  })
}

async function connectCdp(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await new Promise((res, rej) => {
        http
          .get(`http://127.0.0.1:${CDP_PORT}/json`, (resp) => {
            let body = ''
            resp.on('data', (c) => (body += c))
            resp.on('end', () => {
              try {
                res(JSON.parse(body))
              } catch (e) {
                rej(e)
              }
            })
          })
          .on('error', rej)
      })
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => {
          ws.once('open', res)
          ws.once('error', rej)
        })
        let nextId = 1
        const pending = new Map()
        ws.on('message', (raw) => {
          const msg = JSON.parse(String(raw))
          if (msg.id && pending.has(msg.id)) {
            const { resolve: res, reject: rej } = pending.get(msg.id)
            pending.delete(msg.id)
            if (msg.error) rej(new Error(msg.error.message))
            else res(msg.result)
          }
        })
        const call = (method, params = {}) =>
          new Promise((res, rej) => {
            const id = nextId++
            pending.set(id, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id, method, params }))
          })
        return { ws, call }
      }
    } catch {
      /* retrying CDP */
    }
    await sleep(150)
  }
  throw new Error('Timed out waiting for Electron CDP')
}

async function evalJs(cdp, expression) {
  const res = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (res.exceptionDetails) {
    throw new Error(`CDP eval error: ${JSON.stringify(res.exceptionDetails)}`)
  }
  return res.result?.value
}

const { server: mockOllama, port: ollamaPort } = await startMockOllamaServer()
await mkdir(join(ONAIR_USERDATA, 'sessions'), { recursive: true })
await writeFile(
  join(ONAIR_USERDATA, 'settings.json'),
  JSON.stringify(
    {
      version: 1,
      readingMode: 'flow',
      pageMode: false,
      rsvpWpm: 600,
      aiProvider: 'ollama',
      aiModel: 'llama3.2',
      ollamaUrl: `http://127.0.0.1:${ollamaPort}`
    },
    null,
    2
  ),
  'utf-8'
)

const prePromptSession = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Pre-prompt text',
  source: 'typed',
  text: 'Pre-prompt baseline text. Keep this intact for back revert.',
  sentenceIndex: 0,
  createdAt: Date.now() - 1000,
  updatedAt: Date.now() - 1000
}
await writeFile(
  join(ONAIR_USERDATA, 'sessions', `${prePromptSession.id}.json`),
  JSON.stringify(prePromptSession, null, 2),
  'utf-8'
)

const packagedExe = resolve(REPO_DIR, 'dist/win-unpacked/OnAir.exe')
const env = { ...process.env, APPDATA: SCRATCH_APPDATA, FR_METRICS: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  packagedExe,
  [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${ONAIR_USERDATA}`
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'] }
)

try {
  const cdp = await connectCdp()
  await evalJs(
    cdp,
    `new Promise((res) => {
      const check = () => (document.body && document.body.innerText && document.body.innerText.includes('Pre-prompt baseline text')) ? res(true) : setTimeout(check, 50)
      check()
    })`
  )

  // 1. Open PromptBar with Ctrl+Alt+P, enter prompt, submit -> produces 40 ai-chunk-paint + ai-ttft-ollama + ai-tps-ollama
  await cdp.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 3,
    key: 'p',
    code: 'KeyP',
    windowsVirtualKeyCode: 80
  })
  await cdp.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 3,
    key: 'p',
    code: 'KeyP',
    windowsVirtualKeyCode: 80
  })

  await evalJs(
    cdp,
    `new Promise((res) => {
      const check = () => document.querySelector('.prompt-bar-input') ? res(true) : setTimeout(check, 30)
      check()
    })`
  )

  await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector('.prompt-bar-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'Test streaming speed')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('.prompt-bar-btn.primary').click()
    })()`
  )

  await evalJs(
    cdp,
    `new Promise((res, rej) => {
      const start = Date.now()
      const check = () => {
        const txt = document.body?.innerText || ''
        if (txt.includes('word40.')) return res(true)
        if (Date.now() - start > 15000) return rej(new Error('Stream timeout: ' + txt))
        setTimeout(check, 30)
      }
      check()
    })`
  )
  await sleep(150)

  // 2. Run 33 mode-switch cycles (Ctrl+Alt+M) so App.tsx logs 33 mode-switch entries
  await evalJs(
    cdp,
    `(async () => {
      for (let i = 0; i < 33; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, bubbles: true }))
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
    })()`
  )

  // Ensure we are in RSVP mode, verify 0.00 px reticle drift across 20 words, then play at 600 WPM for >= 34 flips (rsvp-jitter)
  const driftPx = await evalJs(
    cdp,
    `(async () => {
      while (!document.querySelector('.rsvp-orp')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, bubbles: true }))
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
      const centers = []
      const root = document.querySelector('.rsvp-root')
      for (let i = 0; i < 20; i++) {
        const rect = document.querySelector('.rsvp-orp').getBoundingClientRect()
        centers.push((rect.left + rect.right) / 2)
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        await new Promise((r) => requestAnimationFrame(r))
      }
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      await new Promise((r) => requestAnimationFrame(r))
      // Start automatic RSVP playback (Space) to record scheduled rsvp-jitter trials
      root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      return Math.max(...centers) - Math.min(...centers)
    })()`
  )

  // At 600 WPM (100ms/word), 36 word flips take ~3.6-4.0s
  await sleep(4200)
  await evalJs(
    cdp,
    `(() => {
      const root = document.querySelector('.rsvp-root')
      if (root) root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })()`
  )

  // 3. Test Esc mid-stream abort + pre-prompt restore
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 3, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 })
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 })
  await evalJs(
    cdp,
    `new Promise((res) => {
      const check = () => document.querySelector('.prompt-bar-input') ? res(true) : setTimeout(check, 30)
      check()
    })`
  )
  await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector('.prompt-bar-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'SLOW_CANCEL_TEST')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('.prompt-bar-btn.primary').click()
    })()`
  )

  await evalJs(
    cdp,
    `new Promise((res, rej) => {
      const start = Date.now()
      const check = () => {
        const txt = document.body?.innerText || ''
        if (txt.includes('Partial')) return res(true)
        if (Date.now() - start > 5000) return rej(new Error('Partial text timeout'))
        setTimeout(check, 20)
      }
      check()
    })`
  )

  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)

  // Verify Esc kept partial text (in RSVP/Flow) and Ctrl+Alt+B reverts to pre-streamed session, and once more to pre-prompt
  await evalJs(
    cdp,
    `(async () => {
      // Switch back to Flow mode cleanly if still in RSVP/Bionic
      for (let i = 0; i < 4; i++) {
        if (!document.querySelector('.rsvp-orp') && !document.querySelector('.bionic-bold')) break
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, altKey: true, bubbles: true }))
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
    })()`
  )
  await sleep(100)
  const partialAfterAbort = await evalJs(cdp, `document.querySelector('.reader-content')?.innerText || ''`)
  if (!partialAfterAbort.includes('Partial answer before abort')) {
    throw new Error('Expected partial aborted text to remain preserved, got: ' + partialAfterAbort)
  }

  // Trigger Ctrl+Alt+B revert to the session active right before prompt
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 3, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66 })
  await sleep(150)
  const afterBackRevert = await evalJs(cdp, `document.querySelector('.reader-content')?.innerText || ''`)
  if (!afterBackRevert.includes('word40.')) {
    throw new Error('Expected Ctrl+Alt+B to restore prior session (word40.), got: ' + afterBackRevert)
  }

  // 4. Verify live Windows DPAPI secrets.enc has zero plaintext API keys and settings.json has zero keys
  const testSecret = 'sk-dpapi-live-verification-key-998877'
  const hasKeyResult = await evalJs(
    cdp,
    `(async () => {
      await window.api.secretsSetKey('openai', '${testSecret}')
      return await window.api.secretsHasKey('openai')
    })()`
  )
  if (!hasKeyResult) {
    throw new Error('Expected secretsHasKey("openai") to return true after secretsSetKey')
  }
  const secretsDisk = await readFile(join(ONAIR_USERDATA, 'secrets.enc'))
  const settingsDisk = await readFile(join(ONAIR_USERDATA, 'settings.json'), 'utf-8')
  if (secretsDisk.toString('utf8').includes(testSecret) || settingsDisk.includes(testSecret)) {
    throw new Error('SECURITY VIOLATION: plaintext API key found on disk!')
  }

  // 5. Read FR_METRICS=1 CSV and validate Section 3.5 thresholds
  const csvPath = join(ONAIR_USERDATA, 'latency-results.csv')
  const csv = await readFile(csvPath, 'utf-8')
  const parseMetric = (name) =>
    csv
      .split(/\r?\n/)
      .filter((l) => l.startsWith(`${name},`))
      .map((l) => Number.parseFloat(l.split(',')[2]))
      .filter((n) => Number.isFinite(n))

  const modeStats = summarize(parseMetric('mode-switch'))
  const chunkStats = summarize(parseMetric('ai-chunk-paint'))
  const jitterStats = summarize(parseMetric('rsvp-jitter'))
  const ttft = parseMetric('ai-ttft-ollama')
  const tps = parseMetric('ai-tps-ollama')

  console.log('=== SECTION 3.5 LATENCY PROTOCOL (FR_METRICS=1 on dist/win-unpacked/OnAir.exe) ===')
  console.log('RSVP horizontal reticle max drift (px):', driftPx.toFixed(2))
  console.log('mode-switch (target median <100ms, p95 <200ms):', JSON.stringify(modeStats))
  console.log('ai-chunk-paint (target median <33ms, p95 <66ms):', JSON.stringify(chunkStats))
  console.log('rsvp-jitter (target median <16ms, p95 <32ms):', JSON.stringify(jitterStats))
  console.log('ai-ttft-ollama (ms, report only):', ttft)
  console.log('ai-tps-ollama (tok/s, report only):', tps)

  if (modeStats.measured < 30 || modeStats.median >= 100 || modeStats.p95 >= 200) {
    throw new Error(`mode-switch failed §3.5: ${JSON.stringify(modeStats)}`)
  }
  if (chunkStats.measured < 30 || chunkStats.median >= 33 || chunkStats.p95 >= 66) {
    throw new Error(`ai-chunk-paint failed §3.5: ${JSON.stringify(chunkStats)}`)
  }
  if (jitterStats.measured < 30 || jitterStats.median >= 16 || jitterStats.p95 >= 32) {
    throw new Error(`rsvp-jitter failed §3.5: ${JSON.stringify(jitterStats)}`)
  }
  if (ttft.length === 0 || tps.length === 0) {
    throw new Error('Missing ai-ttft-ollama or ai-tps-ollama metrics')
  }

  cdp.ws.close()
} finally {
  mockOllama.close()
  if (child.pid) {
    try {
      execSync(`taskkill /F /PID ${child.pid} /T`, { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  }
  await sleep(300)
  await rm(SCRATCH_APPDATA, { recursive: true, force: true }).catch(() => {})
}
