import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Session,
  type ThemeId,
  type ShortcutId,
  type BridgeStatus,
  type AIProviderId
} from '../../../shared/types'
import { THEME_PRESETS } from '../lib/themes'

/* ─── Constants ───────────────────────────────────────────────────────────── */
const CLOUD_PROVIDERS: AIProviderId[] = ['openai', 'anthropic', 'gemini', 'groq']

const DEFAULT_MODELS_BY_PROVIDER: Record<AIProviderId, string> = {
  ollama: 'llama3.2',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
  groq: 'openai/gpt-oss-120b'
}

const FONT_OPTIONS = [
  'Segoe UI',
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Georgia',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Impact'
]

const FONT_WEIGHT_OPTIONS = [
  { value: 100, label: 'Thin (100)' },
  { value: 200, label: 'Extra Light (200)' },
  { value: 300, label: 'Light (300)' },
  { value: 400, label: 'Regular (400)' },
  { value: 500, label: 'Medium (500)' },
  { value: 600, label: 'Semi Bold (600)' },
  { value: 700, label: 'Bold (700)' },
  { value: 800, label: 'Extra Bold (800)' },
  { value: 900, label: 'Black (900)' }
]

const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  toggleWindow: 'Show / Hide window',
  importClipboard: 'Import clipboard',
  fontUp: 'Font size +2',
  fontDown: 'Font size −2',
  nextSentence: 'Next answer',
  prevSentence: 'Previous answer',
  toggleScroll: 'Start / Pause scroll',
  toggleLock: 'Lock on screen',
  back: 'Back to previous',
  openSettings: 'Open settings',
  openPrompt: 'Quick AI prompt',
  cycleMode: 'Cycle reading mode'
}

const TABS = [
  { id: 'appearance', label: 'Look' },
  { id: 'reading', label: 'Read' },
  { id: 'window', label: 'Window' },
  { id: 'ai', label: 'AI' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'shortcuts', label: 'Keys' },
  { id: 'history', label: 'History' }
] as const

type TabId = (typeof TABS)[number]['id']

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function keyEventToAccelerator(e: React.KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null
  if (!e.ctrlKey && !e.altKey) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function Toggle({
  checked,
  onChange,
  id
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
}): ReactElement {
  return (
    <label className="sp-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="sp-toggle-track">
        <div className="sp-toggle-thumb" />
      </div>
    </label>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): ReactElement {
  return (
    <>
      <div className="sp-row">
        <span className="sp-label">{label}</span>
        {children}
      </div>
      {hint && <p className="sp-hint">{hint}</p>}
    </>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}): ReactElement {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="sp-row" style={{ marginBottom: 4 }}>
        <span className="sp-label">{label}</span>
        <span className="sp-value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        className="sp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <div className="sp-color-row">
      <span className="sp-label">{label}</span>
      <div className="sp-color-preview" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => {
            setDraft(e.target.value)
            onChange(e.target.value)
          }}
        />
      </div>
      <input
        type="text"
        className="sp-input"
        value={draft}
        maxLength={7}
        style={{ width: 76, fontFamily: 'var(--ui-font-mono)', fontSize: 10 }}
        onChange={(e) => {
          const v = e.target.value
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
            setDraft(v)
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
          }
        }}
        onBlur={() => setDraft(value)}
      />
    </div>
  )
}

/* ─── Main component ──────────────────────────────────────────────────────── */
interface SettingsPanelProps {
  settings: Settings
  bridgeStatus: BridgeStatus
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onSelectSession: (id: string) => Promise<void>
  onDeleteSession: (id: string) => void
  onClearSessions: () => void
  showToast: (msg: string) => void
}

export default function SettingsPanel({
  settings,
  bridgeStatus,
  onChange,
  onClose,
  onSelectSession,
  onDeleteSession,
  onClearSessions,
  showToast
}: SettingsPanelProps): ReactElement {
  const [tab, setTab] = useState<TabId>('appearance')
  const [sessions, setSessions] = useState<Session[]>([])
  const [conflicts, setConflicts] = useState<ShortcutId[]>([])
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [portDraft, setPortDraft] = useState(String(settings.bridgePort))
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [hasKeyMap, setHasKeyMap] = useState<Partial<Record<AIProviderId, boolean>>>({})
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const isCustomFont = !FONT_OPTIONS.includes(settings.fontFamily)
  const recordingRef = useRef(recordingId)
  recordingRef.current = recordingId

  useEffect(() => {
    setPortDraft(String(settings.bridgePort))
  }, [settings.bridgePort])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      CLOUD_PROVIDERS.map(async (p) => [p, await window.api.secretsHasKey(p)] as const)
    ).then((entries) => {
      if (cancelled) return
      const next: Partial<Record<AIProviderId, boolean>> = {}
      for (const [p, present] of entries) next[p] = present
      setHasKeyMap(next)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    window.api.sessionsList().then(setSessions)
    window.api.shortcutsConflicts().then(setConflicts)
  }, [settings.shortcuts])

  const handleFetchModels = async (quiet = false): Promise<void> => {
    setLoadingModels(true)
    try {
      const models = await window.api.aiListModels(settings.aiProvider, settings.ollamaUrl)
      setAvailableModels(models)
      if (!quiet) {
        showToast(models.length > 0 ? `Loaded ${models.length} models.` : 'No models returned.')
      }
      if (models.length > 0 && !models.includes(settings.aiModel)) {
        const preferred = models.includes(DEFAULT_MODELS_BY_PROVIDER[settings.aiProvider])
          ? DEFAULT_MODELS_BY_PROVIDER[settings.aiProvider]
          : models[0]
        onChange({ aiModel: preferred })
      }
    } catch (err: unknown) {
      setAvailableModels([])
      if (!quiet) {
        showToast((err as Error).message || 'Could not load models.')
      }
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    setAvailableModels([])
    if (tab !== 'ai') return
    if (settings.aiProvider === 'ollama' || hasKeyMap[settings.aiProvider]) {
      void handleFetchModels(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, settings.aiProvider, hasKeyMap[settings.aiProvider]])

  /* ── Handlers ─────────────────────────────────────────────── */
  const handleProviderChange = (nextProvider: AIProviderId): void => {
    const knownDefaults = new Set([...Object.values(DEFAULT_MODELS_BY_PROVIDER), 'llama-3.3-70b-versatile'])
    const nextModel =
      !settings.aiModel.trim() || knownDefaults.has(settings.aiModel.trim())
        ? DEFAULT_MODELS_BY_PROVIDER[nextProvider]
        : settings.aiModel
    setApiKeyDraft('')
    onChange({ aiProvider: nextProvider, aiModel: nextModel })
  }

  const handleSaveApiKey = async (): Promise<void> => {
    const trimmed = apiKeyDraft.trim()
    if (!trimmed || settings.aiProvider === 'ollama') return
    try {
      await window.api.secretsSetKey(settings.aiProvider, trimmed)
      setApiKeyDraft('')
      setHasKeyMap((prev) => ({ ...prev, [settings.aiProvider]: true }))
      showToast(`${settings.aiProvider} API key saved (encrypted).`)
      void handleFetchModels(true)
    } catch (err: unknown) {
      showToast((err as Error).message || 'Failed to save encrypted API key.')
    }
  }

  const handleClearApiKey = async (): Promise<void> => {
    if (settings.aiProvider === 'ollama') return
    await window.api.secretsDeleteKey(settings.aiProvider)
    setApiKeyDraft('')
    setHasKeyMap((prev) => ({ ...prev, [settings.aiProvider]: false }))
    showToast(`${settings.aiProvider} API key cleared.`)
  }

  const commitBridgePort = (): void => {
    const parsed = Number.parseInt(portDraft, 10)
    if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
      setPortDraft(String(settings.bridgePort))
      showToast('Port must be 1024–65535.')
      return
    }
    if (parsed !== settings.bridgePort) onChange({ bridgePort: parsed })
  }

  const handleShortcutKeyDown = (id: ShortcutId, e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { setRecordingId(null); return }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
    if (!e.ctrlKey && !e.altKey) { showToast('Shortcut must include Ctrl or Alt.'); return }
    const accel = keyEventToAccelerator(e)
    if (!accel) return
    const dup = (Object.entries(settings.shortcuts) as [ShortcutId, string][]).find(
      ([oid, oa]) => oid !== id && oa.toLowerCase() === accel.toLowerCase()
    )
    if (dup) { showToast('Shortcut already assigned to another action.'); return }
    setRecordingId(null)
    onChange({ shortcuts: { ...settings.shortcuts, [id]: accel } })
  }

  const handleThemeSelect = (t: (typeof THEME_PRESETS)[number]): void => {
    const t0 = performance.timeOrigin + performance.now()
    onChange({ theme: t.id as ThemeId, bgColor: t.bg, textColor: t.text })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.api.metricsMark({ metric: 'theme-switch', phase: 'duration', timeMs: (performance.timeOrigin + performance.now()) - t0 })
    }))
  }

  const handleSessionClick = async (id: string): Promise<void> => {
    const t0 = performance.timeOrigin + performance.now()
    await onSelectSession(id)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.api.metricsMark({ metric: 'session-switch', phase: 'duration', timeMs: (performance.timeOrigin + performance.now()) - t0 })
    }))
    onClose()
  }

  /* ── Tab content ──────────────────────────────────────────── */
  const renderAppearance = (): ReactElement => (
    <>
      {/* ── Themes ── */}
      <p className="sp-section-title">Theme</p>
      <div className="sp-theme-grid">
        {THEME_PRESETS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`sp-theme-swatch${settings.theme === t.id ? ' active' : ''}`}
            onClick={() => handleThemeSelect(t)}
            title={t.label}
          >
            <div className="sp-swatch-circle">
              <div className="sp-swatch-half left" style={{ background: t.bg }} />
              <div className="sp-swatch-half right" style={{ background: t.text }} />
            </div>
            <span className="sp-swatch-label">{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`sp-theme-swatch${settings.theme === 'custom' ? ' active' : ''}`}
          onClick={() => onChange({ theme: 'custom' })}
          title="Custom"
        >
          <div className="sp-swatch-circle" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
          <span className="sp-swatch-label">Custom</span>
        </button>
      </div>

      {settings.theme === 'custom' && (
        <>
          <ColorRow label="Background" value={settings.bgColor} onChange={(v) => onChange({ bgColor: v })} />
          <ColorRow label="Text color" value={settings.textColor} onChange={(v) => onChange({ textColor: v })} />
        </>
      )}

      {/* ── Typography ── */}
      <p className="sp-section-title">Typography</p>

      <Row label="Font">
        <select
          className="sp-select"
          value={isCustomFont ? 'custom' : settings.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value === 'custom' ? '' : e.target.value })}
        >
          {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value="custom">Custom font…</option>
        </select>
      </Row>

      {isCustomFont && (
        <Row label="Custom font name">
          <input
            type="text"
            className="sp-input"
            value={settings.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value })}
            placeholder="Installed font name"
            style={{ width: 140 }}
          />
        </Row>
      )}

      <Row label="Weight">
        <select
          className="sp-select"
          value={settings.fontWeight}
          onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
        >
          {FONT_WEIGHT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Row>

      <Row label="Alignment">
        <select
          className="sp-select"
          value={settings.textAlign}
          onChange={(e) => onChange({ textAlign: e.target.value as Settings['textAlign'] })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
          <option value="justify">Justify</option>
        </select>
      </Row>

      <SliderRow label="Font size" value={settings.fontSize} min={8} max={200} step={1}
        format={(v) => `${v}px`} onChange={(v) => onChange({ fontSize: v })} />
      <SliderRow label="Line height" value={settings.lineHeight} min={1.0} max={3.0} step={0.05}
        format={(v) => v.toFixed(2)} onChange={(v) => onChange({ lineHeight: v })} />
      <SliderRow label="Letter spacing" value={settings.letterSpacing} min={-2} max={10} step={0.5}
        format={(v) => `${v}px`} onChange={(v) => onChange({ letterSpacing: v })} />
      <SliderRow label="Padding" value={settings.padding} min={0} max={80} step={2}
        format={(v) => `${v}px`} onChange={(v) => onChange({ padding: v })} />

      {/* ── Glow / Shadow ── */}
      <p className="sp-section-title">Text Glow / Shadow</p>
      <Row label="Enable text shadow">
        <Toggle checked={settings.textShadow} onChange={(v) => onChange({ textShadow: v })} />
      </Row>
      {settings.textShadow && (
        <>
          <ColorRow label="Shadow color" value={settings.textShadowColor}
            onChange={(v) => onChange({ textShadowColor: v })} />
          <SliderRow label="Blur radius" value={settings.textShadowBlur} min={0} max={32} step={1}
            format={(v) => `${v}px`} onChange={(v) => onChange({ textShadowBlur: v })} />
        </>
      )}

      {/* ── Layout & Display ── */}
      <p className="sp-section-title">Stage &amp; Optics</p>
      <Row
        label="Responsive stage scaling"
        hint="Dynamically enlarges text on wide screens while keeping >= 3 vertical lines, and scales cleanly down in compact panes."
      >
        <Toggle checked={settings.responsiveScale} onChange={(v) => onChange({ responsiveScale: v })} />
      </Row>
      <Row label="Column width" hint="Constrains reading width on wide screens. 0 = full width.">
        <select
          className="sp-select"
          value={
            [0, 480, 640, 800, 1024].includes(settings.maxContentWidth)
              ? String(settings.maxContentWidth)
              : 'custom'
          }
          onChange={(e) => {
            const v = e.target.value
            onChange({ maxContentWidth: v === 'custom' ? 720 : Number(v) })
          }}
        >
          <option value="0">Full width</option>
          <option value="480">Narrow (480px)</option>
          <option value="640">Medium (640px)</option>
          <option value="800">Wide (800px)</option>
          <option value="1024">Stage (1024px)</option>
          {![0, 480, 640, 800, 1024].includes(settings.maxContentWidth) && (
            <option value="custom">Custom ({settings.maxContentWidth}px)</option>
          )}
        </select>
      </Row>
      {settings.maxContentWidth > 0 && (
        <SliderRow label="Custom width" value={settings.maxContentWidth} min={320} max={1400} step={20}
          format={(v) => `${v}px`} onChange={(v) => onChange({ maxContentWidth: v })} />
      )}
      <Row label="Show scrollbar">
        <Toggle checked={settings.showScrollbar} onChange={(v) => onChange({ showScrollbar: v })} />
      </Row>
      <Row label="Mirror horizontally" hint="Flips text left-to-right for glass beam-splitter teleprompters.">
        <Toggle checked={settings.mirrorX} onChange={(v) => onChange({ mirrorX: v })} />
      </Row>
      <Row label="Mirror vertically" hint="Flips text top-to-bottom for inverted teleprompter rigs.">
        <Toggle checked={settings.mirrorY} onChange={(v) => onChange({ mirrorY: v })} />
      </Row>

      {/* ── UI Chrome ── */}
      <p className="sp-section-title">UI Chrome</p>
      <ColorRow label="Accent color" value={settings.uiAccentColor}
        onChange={(v) => onChange({ uiAccentColor: v })} />
      <ColorRow label="Chrome surface" value={settings.uiSurfaceColor}
        onChange={(v) => onChange({ uiSurfaceColor: v })} />
      <Row label="Show chrome borders">
        <Toggle checked={settings.showChromeBorder} onChange={(v) => onChange({ showChromeBorder: v })} />
      </Row>
      <Row label="Transition speed">
        <select
          className="sp-select"
          value={settings.uiTransitionSpeed}
          onChange={(e) => onChange({ uiTransitionSpeed: e.target.value as Settings['uiTransitionSpeed'] })}
        >
          <option value="none">None (instant)</option>
          <option value="fast">Fast (60ms)</option>
          <option value="normal">Normal (120ms)</option>
          <option value="slow">Slow (250ms)</option>
        </select>
      </Row>

      <div className="sp-divider" />
      <button
        type="button"
        className="sp-btn"
        style={{ width: '100%' }}
        onClick={() => {
          const {
            bridgePort: _bp,
            bridgeToken: _bt,
            bridgeExtensionId: _be,
            bounds: _b,
            shortcuts: _sc,
            ...visualAndReadingDefaults
          } = DEFAULT_SETTINGS
          onChange(visualAndReadingDefaults)
          window.api.windowApply({
            opacity: DEFAULT_SETTINGS.opacity,
            locked: DEFAULT_SETTINGS.locked,
            alwaysOnTop: DEFAULT_SETTINGS.alwaysOnTop
          })
          showToast('Appearance & reading settings reset to defaults.')
        }}
      >
        Reset look &amp; reading to defaults
      </button>
    </>
  )

  const renderReading = (): ReactElement => (
    <>
      <p className="sp-section-title">Reading Mode</p>
      <Row label="Mode">
        <select
          className="sp-select"
          value={settings.readingMode}
          onChange={(e) => onChange({ readingMode: e.target.value as Settings['readingMode'] })}
        >
          <option value="flow">Flow (continuous)</option>
          <option value="rsvp">RSVP (speed reader)</option>
          <option value="bionic">Bionic (prefix bold)</option>
        </select>
      </Row>
      <Row label="Page-by-page view" hint="One sentence per screen. Use ← → to navigate.">
        <Toggle checked={settings.pageMode} onChange={(v) => onChange({ pageMode: v })} />
      </Row>
      <Row label="Reading guide band" hint="Highlights your camera-aligned eye-line across the stage in Flow and Bionic modes.">
        <Toggle checked={settings.readingGuide} onChange={(v) => onChange({ readingGuide: v })} />
      </Row>
      <Row label="Peripheral edge fade" hint="Softens overflowing top/bottom boundaries to reduce visual crowding.">
        <Toggle checked={settings.edgeFade} onChange={(v) => onChange({ edgeFade: v })} />
      </Row>
      <Row label="Smart PDF / copy reflow" hint="Unwraps broken mid-clause line breaks while preserving headings, bullets, and Key: Value rows.">
        <Toggle checked={settings.smartReflow} onChange={(v) => onChange({ smartReflow: v })} />
      </Row>

      <p className="sp-section-title">RSVP</p>
      <SliderRow label="RSVP speed" value={settings.rsvpWpm} min={150} max={1000} step={25}
        format={(v) => `${v} WPM`} onChange={(v) => onChange({ rsvpWpm: v })} />
      <ColorRow label="Focal letter (ORP)" value={settings.rsvpOrpColor}
        onChange={(v) => onChange({ rsvpOrpColor: v })} />

      <p className="sp-section-title">Bionic</p>
      <SliderRow label="Bionic strength" value={settings.bionicStrength} min={0.2} max={0.7} step={0.05}
        format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ bionicStrength: v })} />

      <p className="sp-section-title">Teleprompter Scroll</p>
      <SliderRow label="Scroll speed" value={settings.autoScrollSpeed} min={10} max={400} step={10}
        format={(v) => `${v} px/s`} onChange={(v) => onChange({ autoScrollSpeed: v })} />
      <Row
        label="Auto-scroll on LLM stream"
        hint="Automatically starts scrolling the moment an AI answer starts streaming."
      >
        <Toggle
          checked={settings.autoScrollOnStream}
          onChange={(v) => onChange({ autoScrollOnStream: v })}
        />
      </Row>
      <Row label="Pause scroll on hover" hint="Temporarily pauses scrolling while your pointer rests over the script.">
        <Toggle checked={settings.pauseScrollOnHover} onChange={(v) => onChange({ pauseScrollOnHover: v })} />
      </Row>
      <Row label="Loop at end" hint="Continuously restarts from the top after reaching the end.">
        <Toggle checked={settings.autoScrollLoop} onChange={(v) => onChange({ autoScrollLoop: v })} />
      </Row>
      <Row label="Hide cursor while playing" hint="Hides mouse cursor over the stage during playback and streaming.">
        <Toggle checked={settings.cursorHideOnPlay} onChange={(v) => onChange({ cursorHideOnPlay: v })} />
      </Row>

      <p className="sp-section-title">Startup, Tabs &amp; Clipboard</p>
      <Row label="Open last pasted item on startup" hint="Checked: reopens your last script when OnAir opens. Unchecked: starts with a new tab.">
        <input
          type="checkbox"
          className="sp-checkbox"
          checked={settings.openLastSessionOnStartup}
          onChange={(e) => onChange({ openLastSessionOnStartup: e.target.checked })}
        />
      </Row>
      <Row label="Open imports in new tab" hint="When off, pasted or opened files replace the active tab.">
        <Toggle checked={settings.openInNewTab} onChange={(v) => onChange({ openInNewTab: v })} />
      </Row>
      <Row label="Monitor clipboard" hint="Automatically imports text you copy. Avoid when using a password manager.">
        <Toggle checked={settings.clipboardWatch} onChange={(v) => onChange({ clipboardWatch: v })} />
      </Row>
      {settings.clipboardWatch && (
        <Row label="Save watched to history">
          <Toggle checked={settings.saveWatchedToHistory} onChange={(v) => onChange({ saveWatchedToHistory: v })} />
        </Row>
      )}

      <p className="sp-section-title">History</p>
      <Row label="Keep history for" hint="Sessions older than this are pruned. 0 = keep forever.">
        <select
          className="sp-select"
          value={settings.sessionPruneAgeDays}
          onChange={(e) => onChange({ sessionPruneAgeDays: Number(e.target.value) })}
        >
          <option value={0}>Forever</option>
          <option value={1}>1 day</option>
          <option value={3}>3 days</option>
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </Row>
    </>
  )

  const renderWindow = (): ReactElement => (
    <>
      <p className="sp-section-title">Window Behavior</p>
      <SliderRow label="Opacity" value={settings.opacity} min={0.3} max={1.0} step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => { onChange({ opacity: v }); window.api.windowApply({ opacity: v }) }} />

      <Row label="Toolbar visibility">
        <select
          className="sp-select"
          value={settings.toolbarMode}
          onChange={(e) => onChange({ toolbarMode: e.target.value as Settings['toolbarMode'] })}
        >
          <option value="hover">Show on hover</option>
          <option value="always">Always visible</option>
          <option value="minimal">Hidden (right-click menu)</option>
        </select>
      </Row>

      <Row label="Always on top">
        <Toggle checked={settings.alwaysOnTop} onChange={(v) => {
          onChange({ alwaysOnTop: v }); window.api.windowApply({ alwaysOnTop: v || settings.locked })
        }} />
      </Row>

      <Row
        label="Always open at camera top-center"
        hint="On every launch, opens centered at the top edge below your camera instead of your last position."
      >
        <Toggle
          checked={settings.alwaysOpenAtTopCenter}
          onChange={(v) => {
            onChange({ alwaysOpenAtTopCenter: v })
            if (v) window.api.windowApply({ snapTopCenter: true })
          }}
        />
      </Row>

      <Row label="Default camera position" hint="Moves OnAir right under your webcam at the top center of the screen.">
        <button
          type="button"
          className="sp-btn"
          onClick={() => window.api.windowApply({ snapTopCenter: true })}
        >
          Snap to top-center
        </button>
      </Row>

      <Row label="Lock on screen" hint="Keeps OnAir pinned on top until closed or toggled with the shortcut, while keeping drag, resize, and drop active.">
        <Toggle checked={settings.locked} onChange={(v) => {
          onChange({ locked: v }); window.api.windowApply({ locked: v, alwaysOnTop: v || settings.alwaysOnTop })
        }} />
      </Row>

      <Row label="Minimize on focus loss" hint="Automatically minimizes when clicking outside an unlocked window.">
        <Toggle checked={settings.minimizeOnBlur} onChange={(v) => onChange({ minimizeOnBlur: v })} />
      </Row>

      <p className="sp-section-title">Size Presets</p>
      <div className="sp-chip-row">
        {(['Column', 'Compact', 'Wide', 'Stage'] as const).map((p) => (
          <button key={p} type="button" className="sp-chip"
            onClick={() => window.api.windowApply({ sizePreset: p })}>
            {p === 'Column' ? 'Column  360×640'
              : p === 'Compact' ? 'Compact  400×400'
              : p === 'Wide' ? 'Wide  900×360'
              : 'Stage  1280×720'}
          </button>
        ))}
      </div>
    </>
  )

  const renderAI = (): ReactElement => (
    <>
      <p className="sp-section-title">AI Provider</p>
      <Row label="Provider">
        <select
          className="sp-select"
          value={settings.aiProvider}
          onChange={(e) => handleProviderChange(e.target.value as AIProviderId)}
        >
          <option value="ollama">Ollama (Local)</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          <option value="groq">Groq</option>
        </select>
      </Row>

      <Row label="Model">
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            className="sp-input"
            list="sp-ai-models"
            value={settings.aiModel}
            onChange={(e) => onChange({ aiModel: e.target.value })}
            placeholder={DEFAULT_MODELS_BY_PROVIDER[settings.aiProvider]}
            style={{ width: 136 }}
          />
          <button
            type="button"
            className="sp-btn"
            onClick={() => void handleFetchModels(false)}
            disabled={loadingModels}
            title="Fetch available models from provider"
            style={{ padding: '3px 7px' }}
          >
            {loadingModels ? '…' : '↻'}
          </button>
        </div>
      </Row>
      <datalist id="sp-ai-models">
        {availableModels.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {availableModels.length > 0 && (
        <Row label="Available">
          <select
            className="sp-select"
            value={availableModels.includes(settings.aiModel) ? settings.aiModel : ''}
            onChange={(e) => {
              if (e.target.value) onChange({ aiModel: e.target.value })
            }}
            style={{ width: 168 }}
          >
            <option value="" disabled>Select fetched model…</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Row>
      )}

      {settings.aiProvider === 'ollama' ? (
        <Row label="Ollama URL">
          <input
            type="text"
            className="sp-input"
            value={settings.ollamaUrl}
            onChange={(e) => onChange({ ollamaUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434"
            style={{ width: 150 }}
          />
        </Row>
      ) : (
        <>
          <p className="sp-section-title">API Key — {settings.aiProvider}</p>
          <div className="sp-row" style={{ marginBottom: 6 }}>
            <span className="sp-label">Status</span>
            <span style={{ fontSize: 10, color: hasKeyMap[settings.aiProvider] ? '#4ade80' : 'var(--ui-text-dim)' }}>
              {hasKeyMap[settings.aiProvider] ? '✓ Saved (encrypted)' : 'Not set'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
            <input
              type="password"
              className="sp-input"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveApiKey() }}
              placeholder={hasKeyMap[settings.aiProvider] ? 'Enter new key to replace…' : 'Paste API key…'}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" className="sp-btn accent" onClick={() => void handleSaveApiKey()}
              disabled={!apiKeyDraft.trim()}>Save</button>
            {hasKeyMap[settings.aiProvider] && (
              <button type="button" className="sp-btn danger" onClick={() => void handleClearApiKey()}>Clear</button>
            )}
          </div>
        </>
      )}
    </>
  )

  const renderBridge = (): ReactElement => {
    const stateClass = bridgeStatus.state === 'listening' ? 'ok'
      : bridgeStatus.state === 'error' ? 'err' : 'off'
    const stateLabel = bridgeStatus.state === 'listening'
      ? `Listening :${bridgeStatus.port}${bridgeStatus.connectedClients > 0 ? ` · ${bridgeStatus.connectedClients} active` : ''}`
      : bridgeStatus.state === 'error'
        ? bridgeStatus.error || 'Error'
        : 'Stopped'

    return (
      <>
        <p className="sp-section-title">Status</p>
        <div className="sp-row" style={{ marginBottom: 10 }}>
          <span className={`sp-status-badge ${stateClass}`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%',
              background: stateClass === 'ok' ? '#4ade80' : stateClass === 'err' ? '#f87171' : '#52525b',
              flexShrink: 0 }} />
            {stateLabel}
          </span>
        </div>

        <p className="sp-section-title">Configuration</p>
        <Row label="Port (127.0.0.1)">
          <input
            type="number" className="sp-input" min={1024} max={65535}
            value={portDraft}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={commitBridgePort}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitBridgePort(); (e.target as HTMLInputElement).blur() } }}
            style={{ width: 88 }}
          />
        </Row>

        <Row label="Chrome Extension ID">
          <input
            type="text" className="sp-input"
            value={settings.bridgeExtensionId}
            placeholder="Extension ID"
            onChange={(e) => onChange({ bridgeExtensionId: e.target.value.trim() })}
            style={{ width: 140 }}
          />
        </Row>
        <Row
          label="Start fresh (new answers only)"
          hint="On: starts empty when opening OnAir or toggling mirroring, streaming only answers sent afterward. Off: immediately syncs the latest existing reply."
        >
          <Toggle
            checked={settings.bridgeStreamOnlyNew}
            onChange={(v) => onChange({ bridgeStreamOnlyNew: v })}
          />
        </Row>

        <p className="sp-section-title">Pairing Token</p>
        <input
          type="text" className="sp-input" readOnly
          value={settings.bridgeToken}
          aria-label="Pairing token"
          onFocus={(e) => e.target.select()}
          style={{ width: '100%', fontFamily: 'var(--ui-font-mono)', fontSize: 10, marginBottom: 6 }}
        />
        <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
          <button type="button" className="sp-btn" style={{ flex: 1 }}
            onClick={async () => {
              try { await navigator.clipboard.writeText(settings.bridgeToken); showToast('Token copied.') }
              catch { showToast('Select token text to copy.') }
            }}>Copy token</button>
          <button type="button" className="sp-btn" style={{ flex: 1 }}
            onClick={async () => { await window.api.bridgeTokenRegenerate(); showToast('Token regenerated.') }}>
            Regenerate</button>
        </div>
        <p className="sp-hint">
          Listens on 127.0.0.1 only. Each mirrored answer opens a new tab in OnAir; connections require matching Extension ID + token.
        </p>
      </>
    )
  }

  const renderShortcuts = (): ReactElement => (
    <>
      <p className="sp-section-title">Global Shortcuts</p>
      {(Object.keys(SHORTCUT_LABELS) as ShortcutId[]).map((id) => {
        const hasConflict = conflicts.includes(id)
        const isRecording = recordingId === id
        return (
          <div key={id} style={{ marginBottom: 8 }}>
            <div className="sp-row">
              <span className="sp-label" style={{ fontSize: 11 }}>{SHORTCUT_LABELS[id]}</span>
              <button
                type="button"
                className={`sp-shortcut-btn${isRecording ? ' recording' : ''}`}
                onClick={() => setRecordingId(isRecording ? null : id)}
                onKeyDown={(e) => { if (isRecording) handleShortcutKeyDown(id, e) }}
              >
                {isRecording ? 'Press keys…' : settings.shortcuts[id]}
              </button>
            </div>
            {hasConflict && <p className="sp-conflict">⚠ In use by another app</p>}
          </div>
        )
      })}
    </>
  )

  const renderHistory = (): ReactElement => (
    <>
      <p className="sp-section-title">Saved Texts (last 20)</p>
      {sessions.length === 0 && (
        <p style={{ color: 'var(--ui-text-dim)', fontSize: 11, fontFamily: 'var(--ui-font)' }}>No saved texts yet.</p>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="sp-history-item">
          <button
            type="button"
            className="sp-history-title"
            onClick={() => void handleSessionClick(s.id)}
            title={`${s.title} · ${new Date(s.updatedAt).toLocaleString()}`}
          >
            {s.title}
          </button>
          <span className="sp-history-date">{new Date(s.updatedAt).toLocaleDateString()}</span>
          <button
            type="button"
            className="sp-history-del"
            aria-label="Delete"
            onClick={async () => {
              await window.api.sessionDelete(s.id)
              setSessions((prev) => prev.filter((item) => item.id !== s.id))
              onDeleteSession(s.id)
            }}
          >
            ×
          </button>
        </div>
      ))}

      {sessions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="sp-divider" />
          {!confirmClear ? (
            <button type="button" className="sp-btn danger" style={{ width: '100%', marginTop: 8 }}
              onClick={() => setConfirmClear(true)}>
              Clear all history
            </button>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--ui-font)', fontSize: 11, color: 'var(--ui-text-muted)', marginBottom: 8 }}>
                Delete all saved texts?
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="sp-btn danger" style={{ flex: 1 }}
                  onClick={async () => {
                    await window.api.sessionsClear()
                    setSessions([])
                    setConfirmClear(false)
                    onClearSessions()
                  }}>Delete All</button>
                <button type="button" className="sp-btn" style={{ flex: 1 }}
                  onClick={() => setConfirmClear(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  const TAB_CONTENT: Record<TabId, () => ReactElement> = {
    appearance: renderAppearance,
    reading: renderReading,
    window: renderWindow,
    ai: renderAI,
    bridge: renderBridge,
    shortcuts: renderShortcuts,
    history: renderHistory
  }

  return (
    <div
      className="settings-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--ui-font)', fontWeight: 600, fontSize: 12, color: 'var(--ui-text)' }}>
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--ui-text-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px' }}
          >
            ✕
          </button>
        </div>

        {/* Tab nav */}
        <div
          className="sp-nav"
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY
            }
          }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`sp-nav-btn${tab === id ? ' active' : ''}`}
              onClick={(e) => {
                setTab(id)
                e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {TAB_CONTENT[tab]()}
      </div>
    </div>
  )
}
