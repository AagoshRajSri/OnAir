import type { ReactElement } from 'react'

interface ToolbarProps {
  onOpenFile: () => void
  onImportClipboard: () => void
  onEdit: () => void
  onSettings: () => void
  onHide: () => void
}

export default function Toolbar({
  onOpenFile,
  onImportClipboard,
  onEdit,
  onSettings,
  onHide
}: ToolbarProps): ReactElement {
  return (
    <div className="toolbar">
      <button onClick={onOpenFile} title="Open file (TXT, PDF, DOCX)">📂 Open file</button>
      <button onClick={onImportClipboard} title="Import clipboard (Ctrl+Alt+V)">📋 Import clipboard</button>
      <button onClick={onEdit} title="Edit (Ctrl+E)">✏️ Edit</button>
      <button onClick={onSettings} title="Settings (Ctrl+Alt+S)">⚙️ Settings</button>
      <button onClick={onHide} title="Hide window">👁 Hide</button>
    </div>
  )
}
