import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { Settings, Session, ThemeId } from '../shared/types'
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

// ─── Atomic write ──────────────────────────────────────────────
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, data, 'utf-8')
  await fs.rename(tmp, filePath)
}

// ─── Settings ─────────────────────────────────────────────────
let cachedSettings: Settings | null = null
let settingsDebounce: ReturnType<typeof setTimeout> | null = null

function clampSettings(s: Settings): Settings {
  s.fontSize = Math.max(8, Math.min(200, Math.round(Number(s.fontSize) || 28)))
  s.lineHeight = Math.max(1.0, Math.min(3.0, Number(s.lineHeight) || 1.5))
  s.letterSpacing = Math.max(-2, Math.min(10, Number(s.letterSpacing) || 0))
  s.padding = Math.max(0, Math.min(64, Math.round(Number(s.padding) ?? 16)))
  s.opacity = Math.max(0.3, Math.min(1.0, Number(s.opacity) || 1.0))
  s.autoScrollSpeed = Math.max(10, Math.min(400, Math.round(Number(s.autoScrollSpeed) || 60)))
  if (!VALID_THEMES.has(s.theme)) {
    s.theme = 'obsidian'
  }
  return s
}

export async function loadSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings
  const settingsPath = getSettingsPath()
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
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
    cachedSettings = {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts }
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20

export async function pruneSessions(): Promise<void> {
  await ensureSessionsDir()
  const sessionsDir = getSessionsDir()
  let sessions = await listSessions()
  const cutoff = Date.now() - SEVEN_DAYS_MS

  // Delete older than 7 days
  const toDelete = sessions.filter((s) => s.updatedAt < cutoff)
  for (const s of toDelete) {
    try {
      await fs.unlink(join(sessionsDir, `${s.id}.json`))
    } catch {
      /* ignore */
    }
  }

  sessions = sessions.filter((s) => s.updatedAt >= cutoff)

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
