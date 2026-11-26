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
}

const MODE_LABELS: Record<ReadingMode, string> = {
  flow: 'Flow',
  rsvp: 'RSVP',
  bionic: 'Bionic'
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
  onHide
}: ToolbarProps): ReactElement {
  return (
    <div className="toolbar">
      <button onClick={onOpenFile} title="Open file (TXT, PDF, DOCX)">📂 Open file</button>
      <button onClick={onImportClipboard} title="Import clipboard (Ctrl+Alt+V / Ctrl+V)">📋 Import clipboard</button>
      <button onClick={onEdit} title="Edit text (Ctrl+E)">✏️ Edit</button>
      <button onClick={onTogglePrompt} title="Quick AI prompt (Ctrl+Alt+P)">✨ AI</button>
      <button
        onClick={onCycleMode}
        className={readingMode !== 'flow' ? 'active-mode' : ''}
        title="Cycle reading mode: Flow / RSVP / Bionic (Ctrl+Alt+M)"
      >
        ⚡ {MODE_LABELS[readingMode]}
      </button>
      <button
        onClick={onToggleLock}
        className={locked ? 'active-lock' : ''}
        title={locked ? 'Unlock teleprompter (Ctrl+Alt+L)' : 'Lock teleprompter on top & in place (Ctrl+Alt+L)'}
      >
        {locked ? '🔒 Locked' : '🔓 Lock'}
      </button>
      <button onClick={onSettings} title="Settings (Ctrl+Alt+S)">⚙️ Settings</button>
      <button onClick={onHide} title="Hide window (Ctrl+Alt+R)">👁 Hide</button>
    </div>
  )
}
