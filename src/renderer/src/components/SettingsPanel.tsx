import { useEffect, useState, type ReactElement } from 'react'
import type { Settings, Session, ThemeId, ShortcutId } from '../../../shared/types'
import { THEME_PRESETS } from '../lib/themes'

interface SettingsPanelProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onSelectSession: (id: string) => Promise<void>
  onDeleteSession: (id: string) => void
  onClearSessions: () => void
  showToast: (msg: string) => void
}

const FONT_OPTIONS = [
  'Segoe UI',
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Georgia',
  'Times New Roman',
  'Verdana'
]

const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  toggleWindow: 'Show / Hide',
  importClipboard: 'Import clipboard',
  fontUp: 'Font size +2',
  fontDown: 'Font size -2',
  nextSentence: 'Next sentence',
  prevSentence: 'Previous sentence',
  toggleScroll: 'Start / Pause scroll',
  toggleLock: 'Lock position',
  back: 'Back',
  openSettings: 'Open settings'
}

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

export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  onSelectSession,
  onDeleteSession,
  onClearSessions,
  showToast
}: SettingsPanelProps): ReactElement {
  const [sessions, setSessions] = useState<Session[]>([])
  const [conflicts, setConflicts] = useState<ShortcutId[]>([])
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const isCustomFont = !FONT_OPTIONS.includes(settings.fontFamily)

  useEffect(() => {
    window.api.sessionsList().then(setSessions)
    window.api.shortcutsConflicts().then(setConflicts)
  }, [settings.shortcuts])

  const applySizePreset = async (preset: 'Column' | 'Compact' | 'Wide'): Promise<void> => {
    await window.api.windowApply({ sizePreset: preset })
  }

  const handleShortcutKeyDown = (id: ShortcutId, e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()

    if (e.key === 'Escape') {
      setRecordingId(null)
      return
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return

    if (!e.ctrlKey && !e.altKey) {
      showToast('Shortcut must include Ctrl or Alt.')
      return
    }

    const accel = keyEventToAccelerator(e)
    if (!accel) return

    const duplicate = (Object.entries(settings.shortcuts) as [ShortcutId, string][]).find(
      ([otherId, otherAccel]) => otherId !== id && otherAccel.toLowerCase() === accel.toLowerCase()
    )
    if (duplicate) {
      showToast('Shortcut already assigned to another action.')
      return
    }

    setRecordingId(null)
    onChange({
      shortcuts: {
        ...settings.shortcuts,
        [id]: accel
      }
    })
  }

  const handleThemeSelect = (t: (typeof THEME_PRESETS)[number]): void => {
    const t0 = performance.timeOrigin + performance.now()
    onChange({ theme: t.id as ThemeId, bgColor: t.bg, textColor: t.text })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t1 = performance.timeOrigin + performance.now()
        window.api.metricsMark({ metric: 'theme-switch', phase: 'duration', timeMs: t1 - t0 })
      })
    })
  }

  const handleSessionClick = async (id: string): Promise<void> => {
    const t0 = performance.timeOrigin + performance.now()
    await onSelectSession(id)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t1 = performance.timeOrigin + performance.now()
        window.api.metricsMark({ metric: 'session-switch', phase: 'duration', timeMs: t1 - t0 })
      })
    })
    onClose()
  }

  return (
    <div
      className="settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Settings</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* Typography */}
        <div className="section">
          <h2>Typography</h2>

          <div className="row">
            <span>Font size: {settings.fontSize}px</span>
            <input
              type="range"
              min={8}
              max={200}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              style={{ width: 120 }}
            />
          </div>

          <div className="row">
            <span>Weight</span>
            <select
              value={settings.fontWeight}
              onChange={(e) => onChange({ fontWeight: Number(e.target.value) as 400 | 700 })}
            >
              <option value={400}>Regular (400)</option>
              <option value={700}>Bold (700)</option>
            </select>
          </div>

          <div className="row">
            <span>Line height: {settings.lineHeight.toFixed(2)}</span>
            <input
              type="range"
              min={1.0}
              max={3.0}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
              style={{ width: 120 }}
            />
          </div>

          <div className="row">
            <span>Letter spacing: {settings.letterSpacing}px</span>
            <input
              type="range"
              min={-2}
              max={10}
              step={0.5}
              value={settings.letterSpacing}
              onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
              style={{ width: 120 }}
            />
          </div>

          <div className="row">
            <span>Padding: {settings.padding}px</span>
            <input
              type="range"
              min={0}
              max={64}
              step={2}
              value={settings.padding}
              onChange={(e) => onChange({ padding: Number(e.target.value) })}
              style={{ width: 120 }}
            />
          </div>

          <div className="row">
            <span>Align</span>
            <select
              value={settings.textAlign}
              onChange={(e) => onChange({ textAlign: e.target.value as Settings['textAlign'] })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </select>
          </div>

          <div className="row">
            <span>Font</span>
            <select
              value={isCustomFont ? 'custom' : settings.fontFamily}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  onChange({ fontFamily: '' })
                } else {
                  onChange({ fontFamily: e.target.value })
                }
              }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              <option value="custom">Custom font...</option>
            </select>
          </div>

          {isCustomFont && (
            <div className="row">
              <span>Custom font name</span>
              <input
                type="text"
                value={settings.fontFamily}
                onChange={(e) => onChange({ fontFamily: e.target.value })}
                placeholder="Installed font name"
                style={{ width: 120 }}
              />
            </div>
          )}
        </div>

        {/* Themes */}
        <div className="section">
          <h2>Theme</h2>
          {THEME_PRESETS.map((t) => (
            <label
              key={t.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={settings.theme === t.id}
                onChange={() => handleThemeSelect(t)}
              />
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  background: t.bg,
                  border: `2px solid ${t.text}`,
                  flexShrink: 0
                }}
              />
              {t.label}
            </label>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name="theme"
              value="custom"
              checked={settings.theme === 'custom'}
              onChange={() => onChange({ theme: 'custom' })}
            />
            Custom
          </label>

          {settings.theme === 'custom' && (
            <div style={{ marginLeft: 20, marginTop: 4 }}>
              <div className="row">
                <span>Background color</span>
                <input
                  type="color"
                  value={settings.bgColor}
                  onChange={(e) => onChange({ bgColor: e.target.value })}
                />
              </div>
              <div className="row">
                <span>Text color</span>
                <input
                  type="color"
                  value={settings.textColor}
                  onChange={(e) => onChange({ textColor: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Window controls */}
        <div className="section">
          <h2>Window</h2>

          <div className="row">
            <span>Opacity: {Math.round(settings.opacity * 100)}%</span>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.05}
              value={settings.opacity}
              onChange={(e) => {
                const op = Number(e.target.value)
                onChange({ opacity: op })
                window.api.windowApply({ opacity: op })
              }}
              style={{ width: 120 }}
            />
          </div>

          <div className="row">
            <span>Always on top</span>
            <input
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(e) => {
                const val = e.target.checked
                onChange({ alwaysOnTop: val })
                window.api.windowApply({ alwaysOnTop: val })
              }}
            />
          </div>

          <div className="row">
            <span>Lock position & keep on top</span>
            <input
              type="checkbox"
              checked={settings.locked}
              onChange={(e) => {
                const val = e.target.checked
                onChange({ locked: val, alwaysOnTop: val })
                window.api.windowApply({ locked: val, alwaysOnTop: val })
              }}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <span style={{ opacity: 0.6, fontSize: 11 }}>Presets (size only)</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <button
                onClick={() => applySizePreset('Column')}
                style={{
                  background: '#2a2d35',
                  border: 'none',
                  color: '#e6e8ec',
                  cursor: 'pointer',
                  borderRadius: 3,
                  padding: '3px 8px',
                  fontSize: 11
                }}
              >
                Column (360×640)
              </button>
              <button
                onClick={() => applySizePreset('Compact')}
                style={{
                  background: '#2a2d35',
                  border: 'none',
                  color: '#e6e8ec',
                  cursor: 'pointer',
                  borderRadius: 3,
                  padding: '3px 8px',
                  fontSize: 11
                }}
              >
                Compact (400×400)
              </button>
              <button
                onClick={() => applySizePreset('Wide')}
                style={{
                  background: '#2a2d35',
                  border: 'none',
                  color: '#e6e8ec',
                  cursor: 'pointer',
                  borderRadius: 3,
                  padding: '3px 8px',
                  fontSize: 11
                }}
              >
                Wide (900×360)
              </button>
            </div>
          </div>
        </div>

        {/* Reading & Auto-scroll */}
        <div className="section">
          <h2>Reading & Auto-scroll</h2>
          <div className="row">
            <span>Page-by-page view</span>
            <input
              type="checkbox"
              checked={settings.pageMode}
              onChange={(e) => onChange({ pageMode: e.target.checked })}
            />
          </div>
          <div style={{ opacity: 0.65, fontSize: 10, marginBottom: 8, lineHeight: 1.3 }}>
            Show one statement per page using ← / → arrows. Turn off for continuous scrolling.
          </div>
          <div className="row">
            <span>Speed: {settings.autoScrollSpeed} px/s</span>
            <input
              type="range"
              min={10}
              max={400}
              step={10}
              value={settings.autoScrollSpeed}
              onChange={(e) => onChange({ autoScrollSpeed: Number(e.target.value) })}
              style={{ width: 120 }}
            />
          </div>
        </div>

        {/* Clipboard */}
        <div className="section">
          <h2>Clipboard</h2>
          <div className="row">
            <span>Monitor clipboard</span>
            <input
              type="checkbox"
              checked={settings.clipboardWatch}
              onChange={(e) => onChange({ clipboardWatch: e.target.checked })}
            />
          </div>
          <div style={{ opacity: 0.65, fontSize: 10, marginBottom: 6, lineHeight: 1.3 }}>
            The watcher may import copied passwords; leave it off when using a password manager.
          </div>
          {settings.clipboardWatch && (
            <div className="row">
              <span>Save watched to history</span>
              <input
                type="checkbox"
                checked={settings.saveWatchedToHistory}
                onChange={(e) => onChange({ saveWatchedToHistory: e.target.checked })}
              />
            </div>
          )}
        </div>

        {/* Shortcuts */}
        <div className="section">
          <h2>Global Shortcuts</h2>
          {(Object.keys(SHORTCUT_LABELS) as ShortcutId[]).map((id) => {
            const hasConflict = conflicts.includes(id)
            const isRecording = recordingId === id
            return (
              <div key={id} style={{ marginBottom: 6 }}>
                <div className="row" style={{ marginBottom: 2 }}>
                  <span style={{ fontSize: 11 }}>{SHORTCUT_LABELS[id]}</span>
                  <button
                    onClick={() => setRecordingId(isRecording ? null : id)}
                    onKeyDown={(e) => {
                      if (isRecording) handleShortcutKeyDown(id, e)
                    }}
                    style={{
                      background: isRecording ? '#384b68' : '#2a2d35',
                      border: '1px solid #3a3d48',
                      color: '#e6e8ec',
                      cursor: 'pointer',
                      borderRadius: 3,
                      padding: '2px 6px',
                      fontSize: 10
                    }}
                  >
                    {isRecording ? 'Press keys…' : settings.shortcuts[id]}
                  </button>
                </div>
                {hasConflict && (
                  <div style={{ color: '#ff8a65', fontSize: 10, textAlign: 'right' }}>
                    In use by another app
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* History */}
        <div className="section">
          <h2>History (Last 20)</h2>
          {sessions.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>No saved texts.</div>}
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 11
              }}
            >
              <button
                onClick={() => handleSessionClick(s.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e6e8ec',
                  cursor: 'pointer',
                  textAlign: 'left',
                  flex: 1,
                  padding: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={`${s.title} (${new Date(s.updatedAt).toLocaleString()})`}
              >
                {s.title} · {new Date(s.updatedAt).toLocaleDateString()}
              </button>
              <button
                onClick={async () => {
                  await window.api.sessionDelete(s.id)
                  setSessions((prev) => prev.filter((item) => item.id !== s.id))
                  onDeleteSession(s.id)
                }}
                title="Delete session"
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '0 4px'
                }}
              >
                ✕
              </button>
            </div>
          ))}

          {sessions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{
                    background: '#3a1a1a',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    borderRadius: 3,
                    padding: '4px 10px',
                    fontSize: 11,
                    width: '100%'
                  }}
                >
                  Clear All
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: 11, marginBottom: 6 }}>Delete all saved texts?</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={async () => {
                        await window.api.sessionsClear()
                        setSessions([])
                        setConfirmClear(false)
                        onClearSessions()
                      }}
                      style={{
                        background: '#ff4444',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        borderRadius: 3,
                        padding: '3px 10px',
                        fontSize: 11,
                        flex: 1
                      }}
                    >
                      Delete All
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      style={{
                        background: '#2a2d35',
                        border: 'none',
                        color: '#e6e8ec',
                        cursor: 'pointer',
                        borderRadius: 3,
                        padding: '3px 10px',
                        fontSize: 11,
                        flex: 1
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
