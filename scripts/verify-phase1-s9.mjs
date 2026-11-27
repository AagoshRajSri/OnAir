/**
 * Phase 1 §9 Latency, Smoothness & Memory Verification Harness
 *
 * Runs against the installed Windows build (%LOCALAPPDATA%\Programs\OnAir\OnAir.exe)
 * with FR_METRICS=1 (33 trials per metric, discarding the first 3 warm-up trials).
 *
 * Methodology note (CDP IPC vs. synthetic WM_HOTKEY):
 * Synthetic Win32 keybd_event calls from non-interactive shells do not reliably cross
 * Windows UIPI / desktop isolation into Chromium's OS-level RegisterHotKey loop. To keep
 * automated runs deterministic without stray global keystrokes, this harness triggers:
 *   - show-window: window.api.windowApply({ hidden: true / false }) via CDP
 *   - clipboard-transfer / content-display: OS Clipboard.SetText + window.api.clipboardImport()
 * Call paths differ slightly prior to metrics.start() (IPC handler vs. WM_HOTKEY dispatch in
 * src/main/shortcuts.ts) and omit OS global-hotkey queue latency, then converge on the exact
 * same win.show() -> win.on('show') (separate from cold startup ready-to-show) and
 * importFromClipboard() -> double-rAF measurement code paths.
 */
import { spawn, execSync } from 'child_process'
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises'
import http from 'http'
import os from 'os'
import { join, resolve } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_DIR = resolve(__dirname, '..')
const require = createRequire(join(REPO_DIR, 'package.json'))
const WebSocket = require('ws')

const CDP_PORT = 9231
const TRIALS = 33
const WARMUP = 3

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function summarize(samples, warmup = WARMUP) {
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

function makeText(targetChars, prefix = '') {
  const unit = 'OnAir floating reader latency protocol benchmark sentence for measurement. '
  const raw = prefix + unit.repeat(Math.ceil((targetChars + 100) / unit.length))
  return raw.slice(0, targetChars).trimEnd()
}

async function resolveTargetExe() {
  const localAppData = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local')
  const installedExe = join(localAppData, 'Programs', 'OnAir', 'OnAir.exe')
  try {
    await access(installedExe)
    return { path: installedExe, kind: 'installed' }
  } catch {
    const unpackedExe = resolve(REPO_DIR, 'dist', 'win-unpacked', 'OnAir.exe')
    await access(unpackedExe)
    return { path: unpackedExe, kind: 'win-unpacked' }
  }
}

function getHardwareSpecs() {
  const psScript = `
$ProgressPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed
$cs = Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory
$osInfo = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name.Trim() })
@{
  cpuName = $cpu.Name.Trim()
  cores = $cpu.NumberOfCores
  logicalProcessors = $cpu.NumberOfLogicalProcessors
  maxClockMhz = $cpu.MaxClockSpeed
  ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
  osCaption = $osInfo.Caption.Trim()
  osVersion = $osInfo.Version
  osBuild = $osInfo.BuildNumber
  osArch = $osInfo.OSArchitecture
  gpuName = if ($gpus.Count -gt 0) { $gpus -join ' / ' } else { 'Unknown' }
} | ConvertTo-Json -Compress
`
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
  const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf8' }).trim()
  return JSON.parse(out)
}

function measureTreeMemoryMb(rootPid) {
  const psScript = `
$ProgressPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
$seen = New-Object 'System.Collections.Generic.HashSet[int]'
$queue = New-Object 'System.Collections.Generic.Queue[int]'
[void]$seen.Add(${rootPid})
$queue.Enqueue(${rootPid})
while ($queue.Count -gt 0) {
  $curr = $queue.Dequeue()
  foreach ($p in $procs) {
    if ($p.ParentProcessId -eq $curr -and -not $seen.Contains([int]$p.ProcessId)) {
      [void]$seen.Add([int]$p.ProcessId)
      $queue.Enqueue([int]$p.ProcessId)
    }
  }
}
$tree = @($procs | Where-Object { $seen.Contains([int]$_.ProcessId) })
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Select-Object IDProcess, WorkingSetPrivate
$privWsByPid = @{}
foreach ($pf in $perf) { $privWsByPid[[int]$pf.IDProcess] = [double]$pf.WorkingSetPrivate }
$wsSum = ($tree | Measure-Object -Property WorkingSetSize -Sum).Sum
$privSum = ($tree | Measure-Object -Property PrivatePageCount -Sum).Sum
$privWsSum = 0.0
foreach ($p in $tree) {
  if ($privWsByPid.ContainsKey([int]$p.ProcessId)) {
    $privWsSum += $privWsByPid[[int]$p.ProcessId]
  }
}
@{
  processCount = $tree.Count
  taskManagerMemoryMb = [math]::Round($privWsSum / 1MB, 2)
  workingSetTotalMb = [math]::Round($wsSum / 1MB, 2)
  privateBytesMb = [math]::Round($privSum / 1MB, 2)
} | ConvertTo-Json -Compress
`
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
  const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf8' }).trim()
  return JSON.parse(out)
}

function startClipboardHelper() {
  const helperScript = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ($line -eq 'EXIT') { break }
  if ($line.StartsWith('CLIP:')) {
    $b64 = $line.Substring(5)
    $txt = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
    [System.Windows.Forms.Clipboard]::SetText($txt)
    [Console]::Out.WriteLine('OK')
  }
  [Console]::Out.Flush()
}
`
  const encoded = Buffer.from(helperScript, 'utf16le').toString('base64')
  const ps = spawn('powershell', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  ps.stderr.on('data', (d) => {
    const s = d.toString().trim()
    if (s) console.error('[ClipboardHelper stderr]', s)
  })
  let pendingResolve = null
  let buf = ''
  ps.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    const idx = buf.indexOf('\n')
    if (idx !== -1 && pendingResolve) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      const r = pendingResolve
      pendingResolve = null
      r(line)
    }
  })
  const setClipboard = (text) =>
    new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (pendingResolve) {
          pendingResolve = null
          rej(new Error('Clipboard helper timeout'))
        }
      }, 10000)
      pendingResolve = (val) => {
        clearTimeout(timer)
        res(val)
      }
      ps.stdin.write('CLIP:' + Buffer.from(text, 'utf8').toString('base64') + '\n')
    })

  return {
    setClipboard,
    close: () => {
      try {
        ps.stdin.write('EXIT\n')
      } catch {
        /* ignore */
      }
      ps.kill()
    }
  }
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
            if (msg.error) rej(new Error(JSON.stringify(msg.error)))
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
      /* retry */
    }
    await sleep(150)
  }
  throw new Error('Timed out waiting for CDP target')
}

async function evalJs(cdp, expression, timeoutMs = 15000) {
  let timer
  const evalPromise = cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  const res = await Promise.race([
    evalPromise,
    new Promise((_, rej) => {
      timer = setTimeout(
        () => rej(new Error(`CDP evalJs timeout after ${timeoutMs}ms: ${expression.slice(0, 120)}`)),
        timeoutMs
      )
    })
  ]).finally(() => clearTimeout(timer))
  if (res.exceptionDetails) {
    throw new Error(`CDP eval error: ${JSON.stringify(res.exceptionDetails)}`)
  }
  return res.result?.value
}

async function readCsvMetrics(csvPath) {
  try {
    const csv = await readFile(csvPath, 'utf-8')
    const map = new Map()
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const [metric, , msStr] = trimmed.split(',')
      const ms = Number.parseFloat(msStr)
      if (!metric || !Number.isFinite(ms)) continue
      if (!map.has(metric)) map.set(metric, [])
      map.get(metric).push(ms)
    }
    return map
  } catch {
    return new Map()
  }
}

async function waitForMetricCount(csvPath, metricName, targetCount, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const map = await readCsvMetrics(csvPath)
    const arr = map.get(metricName) || []
    if (arr.length >= targetCount) return arr
    await sleep(25)
  }
  const map = await readCsvMetrics(csvPath)
  const arr = map.get(metricName) || []
  throw new Error(`Timed out waiting for ${metricName} count >= ${targetCount} (got ${arr.length})`)
}

const target = await resolveTargetExe()
const hw = getHardwareSpecs()

try {
  execSync('taskkill /F /IM OnAir.exe /T', { stdio: 'ignore' })
  await sleep(500)
} catch {
  /* none running */
}

// ── PHASE A: Latency Protocol on installed build (FR_METRICS=1) ──
const scratchAppData = join(os.tmpdir(), `onair-s9-bench-${Date.now()}`)
const benchUserData = join(scratchAppData, 'onair')
const sessionsDir = join(benchUserData, 'sessions')
await mkdir(sessionsDir, { recursive: true })

await writeFile(
  join(benchUserData, 'settings.json'),
  JSON.stringify(
    {
      version: 1,
      toolbarMode: 'always',
      autoScrollSpeed: 200,
      autoScrollLoop: false,
      openInNewTab: false,
      clipboardWatch: false,
      openLastSessionOnStartup: false
    },
    null,
    2
  ),
  'utf-8'
)

const helper = startClipboardHelper()
const benchEnv = { ...process.env, APPDATA: scratchAppData, FR_METRICS: '1' }
delete benchEnv.ELECTRON_RUN_AS_NODE

const benchChild = spawn(
  target.path,
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${benchUserData}`],
  { env: benchEnv, stdio: ['ignore', 'pipe', 'pipe'] }
)
benchChild.stderr.on('data', (d) => {
  const s = d.toString().trim()
  if (s && !s.includes('DevTools listening')) console.error('[OnAir stderr]', s)
})

const csvPath = join(benchUserData, 'latency-results.csv')
let displayInfo
let benchResults

try {
  const cdp = await connectCdp()
  console.log('[S9] CDP connected')
  displayInfo = await evalJs(
    cdp,
    `({ dpr: window.devicePixelRatio, screenW: window.screen.width, screenH: window.screen.height })`
  )
  await sleep(400)

  // 1) Clipboard transfer & Content display (~1,000 chars x 33 trials)
  console.log('[S9] Running 1k clipboard/content trials...')
  for (let i = 1; i <= TRIALS; i++) {
    const sample1k = makeText(1000, `Trial-1k-${i}. `)
    await helper.setClipboard(sample1k)
    await evalJs(cdp, `window.api.clipboardImport()`)
    await waitForMetricCount(csvPath, 'clipboard-transfer', i)
    await waitForMetricCount(csvPath, 'content-display', i)
  }

  // 2) Clipboard transfer & Content display (~50,000 chars x 33 trials)
  console.log('[S9] Running 50k clipboard/content trials...')
  for (let i = 1; i <= TRIALS; i++) {
    const sample50k = makeText(50000, `Trial-50k-${i}. `)
    await helper.setClipboard(sample50k)
    await evalJs(cdp, `window.api.clipboardImport()`)
    await waitForMetricCount(csvPath, 'clipboard-transfer', TRIALS + i)
    await waitForMetricCount(csvPath, 'content-display', TRIALS + i)
  }

  // 3) Smoothness (10s of auto-scroll at speed 200 on loaded 50,000-char text)
  console.log('[S9] Running 10s smoothness test...')
  const scrollCheck = await evalJs(
    cdp,
    `(() => {
      const c = document.querySelector('.reader-container')
      if (!c) return { ok: false, reason: 'missing .reader-container' }
      c.scrollTop = 0
      return { ok: c.scrollHeight - c.clientHeight > 3000, scrollRange: c.scrollHeight - c.clientHeight }
    })()`
  )
  if (!scrollCheck.ok) {
    throw new Error(`Insufficient scroll range for 10s smoothness test: ${JSON.stringify(scrollCheck)}`)
  }
  await evalJs(cdp, `document.querySelector('.reader-nav-right button')?.click()`)
  await waitForMetricCount(csvPath, 'smoothness-avg-fps', 1, 16000)
  await waitForMetricCount(csvPath, 'smoothness-over33ms-pct', 1, 5000)
  await evalJs(cdp, `document.querySelector('.reader-nav-right button')?.click()`)
  await sleep(150)

  // 4) Show-window (33 trials: hide -> show triggers metrics.start/end('show-window'))
  console.log('[S9] Running show-window trials...')
  for (let i = 1; i <= TRIALS; i++) {
    await evalJs(cdp, `window.api.windowApply({ hidden: true })`)
    await sleep(100)
    await evalJs(cdp, `window.api.windowApply({ hidden: false })`)
    await waitForMetricCount(csvPath, 'show-window', i)
    await sleep(50)
  }

  // 5) Theme switch (33 trials via Settings swatch clicks while 50k text is rendered)
  console.log('[S9] Running theme-switch trials...')
  await evalJs(cdp, `document.querySelector('button[title^="Settings"]')?.click()`)
  await evalJs(
    cdp,
    `new Promise((res) => {
      const check = () => document.querySelector('.sp-theme-swatch') ? res(true) : setTimeout(check, 20)
      check()
    })`
  )
  for (let i = 1; i <= TRIALS; i++) {
    const swatchIdx = i % 6
    await evalJs(cdp, `document.querySelectorAll('.sp-theme-swatch')[${swatchIdx}]?.click()`)
    await waitForMetricCount(csvPath, 'theme-switch', i)
  }
  await evalJs(cdp, `document.querySelector('.settings-overlay')?.click()`)
  await evalJs(
    cdp,
    `new Promise((res) => {
      const check = () => !document.querySelector('.settings-panel') ? res(true) : setTimeout(check, 10)
      check()
    })`
  )

  // 6) Session switch (~100,000 chars x 33 trials via Settings -> History row clicks)
  console.log('[S9] Running 100k session-switch trials...')
  const text100kA = makeText(100000, 'Session-100K-Alpha. ')
  const text100kB = makeText(100000, 'Session-100K-Beta. ')
  const now = Date.now() + 10000
  await writeFile(
    join(sessionsDir, 's100k-a.json'),
    JSON.stringify({
      id: 's100k-a',
      title: 'Session-100K-Alpha',
      source: 'typed',
      text: text100kA,
      sentenceIndex: 0,
      createdAt: now,
      updatedAt: now + 2
    }),
    'utf-8'
  )
  await writeFile(
    join(sessionsDir, 's100k-b.json'),
    JSON.stringify({
      id: 's100k-b',
      title: 'Session-100K-Beta',
      source: 'typed',
      text: text100kB,
      sentenceIndex: 0,
      createdAt: now,
      updatedAt: now + 1
    }),
    'utf-8'
  )

  for (let i = 1; i <= TRIALS; i++) {
    await evalJs(cdp, `document.querySelector('button[title^="Settings"]')?.click()`)
    await evalJs(
      cdp,
      `new Promise((res) => {
        const check = () => document.querySelector('.sp-nav-btn') ? res(true) : setTimeout(check, 15)
        check()
      })`
    )
    await evalJs(
      cdp,
      `Array.from(document.querySelectorAll('.sp-nav-btn')).find((b) => b.textContent?.trim() === 'History')?.click()`
    )
    const targetTitle = i % 2 === 1 ? 'Session-100K-Beta' : 'Session-100K-Alpha'
    await evalJs(
      cdp,
      `new Promise((res, rej) => {
        const start = Date.now()
        const check = () => {
          const btn = Array.from(document.querySelectorAll('.sp-history-title')).find((b) => b.textContent?.trim() === '${targetTitle}')
          if (btn) { btn.click(); return res(true) }
          if (Date.now() - start > 5000) return rej(new Error('Missing history row ${targetTitle}'))
          setTimeout(check, 15)
        }
        check()
      })`
    )
    await waitForMetricCount(csvPath, 'session-switch', i)
    await evalJs(
      cdp,
      `new Promise((res) => {
        const check = () => !document.querySelector('.settings-panel') ? res(true) : setTimeout(check, 10)
        check()
      })`
    )
  }

  const allMetrics = await readCsvMetrics(csvPath)
  const clipAll = allMetrics.get('clipboard-transfer') || []
  const contentAll = allMetrics.get('content-display') || []
  benchResults = {
    showWindow: summarize(allMetrics.get('show-window') || []),
    clipboardTransfer1k: summarize(clipAll.slice(0, TRIALS)),
    clipboardTransfer50k: summarize(clipAll.slice(TRIALS, TRIALS * 2)),
    contentDisplay1k: summarize(contentAll.slice(0, TRIALS)),
    contentDisplay50k: summarize(contentAll.slice(TRIALS, TRIALS * 2)),
    themeSwitch: summarize(allMetrics.get('theme-switch') || []),
    sessionSwitch100k: summarize(allMetrics.get('session-switch') || []),
    smoothnessAvgFps: (allMetrics.get('smoothness-avg-fps') || []).slice(-1)[0],
    smoothnessOver33MsPct: (allMetrics.get('smoothness-over33ms-pct') || []).slice(-1)[0]
  }

  cdp.ws.close()
} finally {
  helper.close()
  if (benchChild.pid) {
    try {
      execSync(`taskkill /F /PID ${benchChild.pid} /T`, { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  }
  await sleep(400)
  await rm(scratchAppData, { recursive: true, force: true }).catch(() => {})
}

// ── PHASE B: Idle Memory (60s after start, no input, clean launch without CDP/flags) ──
console.log('[S9] Running 60s idle memory check...')
const idleScratch = join(os.tmpdir(), `onair-s9-idle-${Date.now()}`)
const idleUserData = join(idleScratch, 'onair')
await mkdir(idleUserData, { recursive: true })
await writeFile(
  join(idleUserData, 'settings.json'),
  JSON.stringify({ version: 1, clipboardWatch: false }, null, 2),
  'utf-8'
)

let idleStats
const idleEnv = { ...process.env, APPDATA: idleScratch }
delete idleEnv.ELECTRON_RUN_AS_NODE
const idleChild = spawn(target.path, [`--user-data-dir=${idleUserData}`], {
  env: idleEnv,
  stdio: 'ignore'
})
try {
  await sleep(60_500)
  idleStats = measureTreeMemoryMb(idleChild.pid)
} finally {
  if (idleChild.pid) {
    try {
      execSync(`taskkill /F /PID ${idleChild.pid} /T`, { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  }
  await sleep(400)
  await rm(idleScratch, { recursive: true, force: true }).catch(() => {})
}

const report = {
  binary: target,
  hardware: {
    ...hw,
    primaryDisplayLogical: `${displayInfo.screenW}x${displayInfo.screenH}`,
    dpiScale: `${Math.round(displayInfo.dpr * 100)}%`
  },
  metrics: {
    ...benchResults,
    idleMemory: idleStats
  }
}

console.log('=== PHASE 1 SECTION 9 FULL BENCHMARK REPORT ===')
console.log(JSON.stringify(report, null, 2))

const m = report.metrics
if (m.showWindow.median >= 300) throw new Error(`show-window failed target (<300ms): ${m.showWindow.median}`)
if (m.clipboardTransfer1k.median >= 200 || m.clipboardTransfer50k.median >= 200) {
  throw new Error('clipboard-transfer failed target (<200ms)')
}
if (m.contentDisplay1k.median >= 100 || m.contentDisplay50k.median >= 100) {
  throw new Error('content-display failed target (<100ms)')
}
if (m.themeSwitch.median >= 100) throw new Error(`theme-switch failed target (<100ms): ${m.themeSwitch.median}`)
if (m.sessionSwitch100k.median >= 300) throw new Error(`session-switch failed target (<300ms): ${m.sessionSwitch100k.median}`)
if (m.smoothnessAvgFps < 55 || m.smoothnessOver33MsPct > 1) {
  throw new Error(`smoothness failed target (>=55 FPS, <=1% over 33ms): ${m.smoothnessAvgFps} fps, ${m.smoothnessOver33MsPct}%`)
}
if (m.idleMemory.taskManagerMemoryMb >= 250) {
  throw new Error(
    `idle memory (Task Manager WorkingSetPrivate) failed proposed target (<250MB): ${m.idleMemory.taskManagerMemoryMb} MB`
  )
}
