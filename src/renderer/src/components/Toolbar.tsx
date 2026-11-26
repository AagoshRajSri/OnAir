import type { ReactElement } from 'react'
import type { ReadingMode } from '../../../shared/types'

interface ToolbarProps {
  locked: boolean
  readingMode: ReadingMode
  onCycleMode: () => void
  onTogglePrompt: () => void
  onOpenFile: () => void
  onImportClipboard: () => void
  onEdit: () => void
  onToggleLock: () => void
  onSettings: () => void
  onHide: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

const MODE_LABELS: Record<ReadingMode, string> = {
  flow: 'Flow',
  rsvp: 'RSVP',
  bionic: 'Bionic'
}

/* ── SVG icons (inline, no external dep) ─────────────────────────────────── */

function IconFolder(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M1.5 4.5A1 1 0 0 1 2.5 3.5h3.293a1 1 0 0 1 .707.293L7.5 4.793A1 1 0 0 0 8.207 5H13.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V4.5z" />
    </svg>
  )
}

function IconClipboard(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="4.5" y="2.5" width="7" height="11" rx="1" />
      <path d="M6 2.5A1.5 1.5 0 0 1 7.5 1h1A1.5 1.5 0 0 1 10 2.5" />
      <path d="M6 7h4M6 9.5h3" strokeLinecap="round" />
    </svg>
  )
}

function IconEdit(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z" />
      <path d="M2 14h12" strokeLinecap="round" />
    </svg>
  )
}

function IconSparkles(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1l1.09 3.41L12.5 5.5l-3.41 1.09L8 10 6.91 6.59 3.5 5.5l3.41-1.09L8 1zM3 10l.73 2.27L6 13l-2.27.73L3 16l-.73-2.27L0 13l2.27-.73L3 10zM13 1l.55 1.72L15.27 3.27 13.55 3.82 13 5.54l-.55-1.72L10.73 3.27l1.72-.55L13 1z" />
    </svg>
  )
}

function IconMode({ mode }: { mode: ReadingMode }): ReactElement {
  if (mode === 'rsvp') {
    return (
      <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="8" cy="8" r="6" />
        <line x1="8" y1="5" x2="8" y2="8" />
        <line x1="8" y1="8" x2="10.5" y2="9.5" />
      </svg>
    )
  }
  if (mode === 'bionic') {
    return (
      <svg className="tb-icon" viewBox="0 0 16 16" fill="currentColor">
        <text x="1" y="12" fontFamily="serif" fontSize="11" fontWeight="900">B</text>
        <text x="8" y="12" fontFamily="serif" fontSize="11" fontWeight="300">i</text>
      </svg>
    )
  }
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M2 4h12M2 8h9M2 12h11" />
    </svg>
  )
}

function IconLock({ locked }: { locked: boolean }): ReactElement {
  return locked ? (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="3.5" y="7" width="9" height="7.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  ) : (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="3.5" y="7" width="9" height="7.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" />
    </svg>
  )
}

function IconSettings(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2" />
      <path
        strokeLinejoin="round"
        d="M8 1.5v1.1M8 13.4v1.1M1.5 8h1.1M13.4 8h1.1
           M3.4 3.4l.78.78M11.82 11.82l.78.78
           M3.4 12.6l.78-.78M11.82 4.18l.78-.78"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconEye(): ReactElement {
  return (
    <svg className="tb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  )
}

export default function Toolbar({
  locked,
  readingMode,
  onCycleMode,
  onTogglePrompt,
  onOpenFile,
  onImportClipboard,
  onEdit,
  onToggleLock,
  onSettings,
  onHide,
  onMinimize,
  onToggleMaximize,
  onClose
}: ToolbarProps): ReactElement {
  return (
    <div className="toolbar">
      <button onClick={onOpenFile} title="Open file  Ctrl+O">
        <IconFolder />
        <span className="tb-label">Open</span>
      </button>

      <button onClick={onImportClipboard} title="Import clipboard  Ctrl+Alt+V">
        <IconClipboard />
        <span className="tb-label">Paste</span>
      </button>

      <button onClick={onEdit} title="Edit text  Ctrl+E">
        <IconEdit />
        <span className="tb-label">Edit</span>
      </button>

      <button onClick={onTogglePrompt} title="Quick AI prompt  Ctrl+Alt+P">
        <IconSparkles />
        <span className="tb-label">AI</span>
      </button>

      <div className="tb-sep" />

      <button
        onClick={onCycleMode}
        className={readingMode !== 'flow' ? 'active-mode' : ''}
        title="Cycle reading mode: Flow / RSVP / Bionic  Ctrl+Alt+M"
      >
        <IconMode mode={readingMode} />
        <span className="tb-label">{MODE_LABELS[readingMode]}</span>
      </button>

      <button
        onClick={onToggleLock}
        className={locked ? 'active-lock' : ''}
        title={locked ? 'Unlock from screen  Ctrl+Alt+L' : 'Lock on screen  Ctrl+Alt+L'}
      >
        <IconLock locked={locked} />
        <span className="tb-label">{locked ? 'Locked' : 'Lock'}</span>
      </button>

      <div className="tb-sep" />

      <button onClick={onSettings} title="Settings  Ctrl+Alt+S">
        <IconSettings />
        <span className="tb-label">Settings</span>
      </button>

      <button onClick={onHide} title="Hide window  Ctrl+Alt+R">
        <IconEye />
        <span className="tb-label">Hide</span>
      </button>

      <div className="tb-spacer" />

      <div className="tb-win-controls">
        <button type="button" className="tb-win-btn" onClick={onMinimize} title="Minimize" aria-label="Minimize window">
          ─
        </button>
        <button type="button" className="tb-win-btn" onClick={onToggleMaximize} title="Maximize / Restore" aria-label="Maximize or restore window">
          □
        </button>
        <button type="button" className="tb-win-btn tb-win-close" onClick={onClose} title="Close" aria-label="Close window">
          ✕
        </button>
      </div>
    </div>
  )
}
