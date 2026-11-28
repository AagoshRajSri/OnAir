import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { randomBytes } from 'crypto'
import type { Settings, Session, ThemeId, ReadingMode, AIProviderId } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

function getUserDataPath(): string {
  return app.getPath('userData')
}

function getSettingsPath(): string {
  return join(getUserDataPath(), 'settings.json')
}

function getSessionsDir(): string {
  return join(getUserDataPath(), 'sessions')
}

const VALID_THEMES: Set<ThemeId> = new Set([
  'obsidian',
  'midnight',
  'forest',
  'warm-charcoal',
  'oled-black',
  'slate',
  'custom'
])

const VALID_READING_MODES: Set<ReadingMode> = new Set(['flow', 'rsvp', 'bionic'])

const VALID_AI_PROVIDERS: Set<AIProviderId> = new Set([
  'ollama',
  'openai',
  'anthropic',
  'gemini',
  'groq'
])

// ─── Atomic write ──────────────────────────────────────────────
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, data, 'utf-8')
  await fs.rename(tmp, filePath)
}

// ─── Settings ─────────────────────────────────────────────────
let cachedSettings: Settings | null = null
let settingsDebounce: ReturnType<typeof setTimeout> | null = null

function isValidBridgeToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token)
}

function clampNum(val: unknown, min: number, max: number, fallback: number, round = false): number {
  const n = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(n)) return fallback
  const bounded = Math.max(min, Math.min(max, n))
  return round ? Math.round(bounded) : bounded
}

function clampHex(val: unknown, fallback: string): string {
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback
}

const VALID_TEXT_ALIGNS = new Set<Settings['textAlign']>(['left', 'center', 'right', 'justify'])
const VALID_TOOLBAR_MODES = new Set<Settings['toolbarMode']>(['hover', 'always', 'minimal'])
const VALID_TRANSITIONS = new Set<Settings['uiTransitionSpeed']>(['none', 'fast', 'normal', 'slow'])

function clampSettings(s: Settings): Settings {
  s.fontSize = clampNum(s.fontSize, 8, 200, 28, true)
  const rawWeight = clampNum(s.fontWeight, 100, 900, 400, true)
  s.fontWeight = Math.max(100, Math.min(900, Math.round(rawWeight / 100) * 100))
  s.lineHeight = clampNum(s.lineHeight, 1.0, 3.0, 1.5)
  s.letterSpacing = clampNum(s.letterSpacing, -2, 10, 0)
  s.padding = clampNum(s.padding, 0, 80, 16, true)
  if (!VALID_TEXT_ALIGNS.has(s.textAlign)) s.textAlign = 'left'
  s.textColor = clampHex(s.textColor, '#e6e8ec')
  s.bgColor = clampHex(s.bgColor, '#0f1115')
  s.opacity = clampNum(s.opacity, 0.3, 1.0, 1.0)
  s.autoScrollSpeed = clampNum(s.autoScrollSpeed, 10, 400, 60, true)
  s.bridgePort = clampNum(s.bridgePort, 1024, 65535, 47821, true)
  s.bridgeExtensionId = typeof s.bridgeExtensionId === 'string' ? s.bridgeExtensionId.trim() : ''
  // New fields with safe defaults
  s.textShadow = Boolean(s.textShadow)
  s.textShadowColor = clampHex(s.textShadowColor, '#ffffff')
  s.textShadowBlur = clampNum(s.textShadowBlur, 0, 32, 8, true)
  const rawMaxW = clampNum(s.maxContentWidth, 0, 1400, 0, true)
  s.maxContentWidth = rawMaxW <= 0 ? 0 : Math.max(320, Math.min(1400, rawMaxW))
  s.mirrorX = Boolean(s.mirrorX)
  s.mirrorY = Boolean(s.mirrorY)
  s.readingGuide = s.readingGuide !== false
  s.responsiveScale = s.responsiveScale !== false
  s.smartReflow = s.smartReflow !== false
  s.edgeFade = s.edgeFade !== false
  s.uiAccentColor = clampHex(s.uiAccentColor, '#f59e0b')
  s.uiSurfaceColor = clampHex(s.uiSurfaceColor, '#0d0d0d')
  s.showChromeBorder = s.showChromeBorder !== false
  s.showScrollbar = s.showScrollbar !== false
  if (!VALID_TOOLBAR_MODES.has(s.toolbarMode)) s.toolbarMode = 'hover'
  if (!VALID_TRANSITIONS.has(s.uiTransitionSpeed)) s.uiTransitionSpeed = 'normal'
  s.minimizeOnBlur = Boolean(s.minimizeOnBlur)
  s.cursorHideOnPlay = Boolean(s.cursorHideOnPlay)
  s.autoScrollOnStream = s.autoScrollOnStream !== false
  s.pauseScrollOnHover = Boolean(s.pauseScrollOnHover)
  s.autoScrollLoop = Boolean(s.autoScrollLoop)
  s.openLastSessionOnStartup = Boolean(s.openLastSessionOnStartup)
  s.openInNewTab = s.openInNewTab !== false
  s.bridgeStreamOnlyNew = s.bridgeStreamOnlyNew !== false
  s.rsvpOrpColor = clampHex(s.rsvpOrpColor, '#ff5252')
  s.sessionPruneAgeDays = clampNum(s.sessionPruneAgeDays, 0, 90, 7, true)
  if (!isValidBridgeToken(s.bridgeToken)) {
    s.bridgeToken = randomBytes(32).toString('hex')
  }
  if (!VALID_THEMES.has(s.theme)) {
    s.theme = 'obsidian'
  }
  if (!VALID_READING_MODES.has(s.readingMode)) {
    s.readingMode = 'flow'
  }
  const rawWpm = clampNum(s.rsvpWpm, 150, 1000, 350, true)
  s.rsvpWpm = Math.round(rawWpm / 25) * 25
  s.bionicStrength = clampNum(s.bionicStrength, 0.2, 0.7, 0.4)
  if (!VALID_AI_PROVIDERS.has(s.aiProvider)) {
    s.aiProvider = 'ollama'
  }
  const rawModel = typeof s.aiModel === 'string' && s.aiModel.trim() ? s.aiModel.trim() : 'llama3.2'
  // Migrate retired Groq default model so existing installs don't hit 404
  s.aiModel = s.aiProvider === 'groq' && rawModel === 'llama-3.3-70b-versatile'
    ? 'openai/gpt-oss-120b'
    : rawModel
  s.ollamaUrl =
    typeof s.ollamaUrl === 'string' && s.ollamaUrl.trim()
      ? s.ollamaUrl.trim().replace(/\/+$/, '')
      : 'http://127.0.0.1:11434'
  return s
}

export async function loadSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings
  const settingsPath = getSettingsPath()
  let needsPersist = false
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    needsPersist = !isValidBridgeToken(parsed.bridgeToken)
    cachedSettings = clampSettings({
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...(parsed.shortcuts ?? {})
      }
    })
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      const corrupt = join(getUserDataPath(), `settings.corrupt-${Date.now()}.json`)
      try {
        await fs.rename(settingsPath, corrupt)
      } catch {
        /* ignore */
      }
    }
    needsPersist = true
    cachedSettings = clampSettings({
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts }
    })
  }
  if (needsPersist) {
    try {
      await fs.mkdir(getUserDataPath(), { recursive: true })
      await atomicWrite(settingsPath, JSON.stringify(cachedSettings, null, 2))
    } catch {
      /* ignore write error on restricted startup */
    }
  }
  return cachedSettings
}

export async function saveSettings(s: Settings): Promise<void> {
  cachedSettings = clampSettings(s)
  const settingsPath = getSettingsPath()
  if (settingsDebounce) clearTimeout(settingsDebounce)
  return new Promise((resolve) => {
    settingsDebounce = setTimeout(async () => {
      if (cachedSettings) {
        await atomicWrite(settingsPath, JSON.stringify(cachedSettings, null, 2))
      }
      resolve()
    }, 200)
  })
}

// ─── Sessions ─────────────────────────────────────────────────
async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(getSessionsDir(), { recursive: true })
}

export async function listSessions(): Promise<Session[]> {
  await ensureSessionsDir()
  const sessionsDir = getSessionsDir()
  let files: string[]
  try {
    files = await fs.readdir(sessionsDir)
  } catch {
    return []
  }
  const sessions: Session[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(join(sessionsDir, f), 'utf-8')
      sessions.push(JSON.parse(raw) as Session)
    } catch {
      /* A session file that cannot be parsed is skipped and left in place */
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  return sessions
}

export async function loadSession(id: string): Promise<Session | null> {
  await ensureSessionsDir()
  try {
    const raw = await fs.readFile(join(getSessionsDir(), `${id}.json`), 'utf-8')
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir()
  await atomicWrite(join(getSessionsDir(), `${session.id}.json`), JSON.stringify(session, null, 2))
}

export async function deleteSession(id: string): Promise<void> {
  await ensureSessionsDir()
  try {
    await fs.unlink(join(getSessionsDir(), `${id}.json`))
  } catch {
    /* ignore */
  }
}

export async function clearSessions(): Promise<void> {
  await ensureSessionsDir()
  const sessionsDir = getSessionsDir()
  const files = await fs.readdir(sessionsDir)
  await Promise.all(
    files.filter((f) => f.endsWith('.json')).map((f) => fs.unlink(join(sessionsDir, f)).catch(() => {}))
  )
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20

export async function pruneSessions(): Promise<void> {
  await ensureSessionsDir()
  const sessionsDir = getSessionsDir()
  const settings = await loadSettings()
  let sessions = await listSessions()

  if (settings.sessionPruneAgeDays > 0) {
    const cutoff = Date.now() - settings.sessionPruneAgeDays * DAY_MS
    const toDelete = sessions.filter((s) => s.updatedAt < cutoff)
    for (const s of toDelete) {
      try {
        await fs.unlink(join(sessionsDir, `${s.id}.json`))
      } catch {
        /* ignore */
      }
    }
    sessions = sessions.filter((s) => s.updatedAt >= cutoff)
  }

  // Keep newest 20
  if (sessions.length > MAX_SESSIONS) {
    const overflow = sessions.slice(MAX_SESSIONS)
    for (const s of overflow) {
      try {
        await fs.unlink(join(sessionsDir, `${s.id}.json`))
      } catch {
        /* ignore */
      }
    }
  }
}
