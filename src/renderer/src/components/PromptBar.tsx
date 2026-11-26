import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AIProviderId, AITransformKind } from '../../../shared/types'

interface PromptBarProps {
  hasContextText: boolean
  isStreaming: boolean
  provider: AIProviderId
  model: string
  onSubmitPrompt: (prompt: string, transform?: AITransformKind) => void
  onAbort: () => void
  onClose: () => void
}

const TRANSFORM_CHIPS: Array<{ kind: AITransformKind; label: string }> = [
  { kind: 'summarize', label: 'Summarize' },
  { kind: 'bullets', label: 'Bullets' },
  { kind: 'simplify', label: 'Simplify' }
]

export default function PromptBar({
  hasContextText,
  isStreaming,
  provider,
  model,
  onSubmitPrompt,
  onAbort,
  onClose
}: PromptBarProps): ReactElement {
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault()
    if (isStreaming) return
    const trimmed = prompt.trim()
    if (!trimmed) return
    onSubmitPrompt(trimmed)
    setPrompt('')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (isStreaming) {
        onAbort()
      } else {
        onClose()
      }
    }
  }

  return (
    <div className="prompt-bar" onKeyDown={handleKeyDown}>
      <form className="prompt-bar-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="prompt-bar-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isStreaming
              ? 'Streaming response... Press Esc to stop'
              : hasContextText
                ? 'Ask AI about active text or enter a prompt...'
                : 'Ask AI anything... (Enter to stream)'
          }
          disabled={isStreaming}
          aria-label="Quick AI prompt"
        />
        {isStreaming ? (
          <button
            type="button"
            className="prompt-bar-btn stop"
            onClick={onAbort}
            title="Stop streaming (Esc)"
          >
            ■ Stop
          </button>
        ) : (
          <button
            type="submit"
            className="prompt-bar-btn primary"
            disabled={!prompt.trim()}
            title="Run prompt (Enter)"
          >
            Run ↵
          </button>
        )}
        <button
          type="button"
          className="prompt-bar-btn"
          onClick={isStreaming ? onAbort : onClose}
          title={isStreaming ? 'Stop stream (Esc)' : 'Close (Esc)'}
          aria-label="Close prompt bar"
        >
          ×
        </button>
      </form>

      <div className="prompt-bar-footer">
        <div className="prompt-bar-chips">
          {TRANSFORM_CHIPS.map((chip) => (
            <button
              key={chip.kind}
              type="button"
              className="prompt-chip"
              disabled={!hasContextText || isStreaming}
              title={
                hasContextText
                  ? `${chip.label} active session text`
                  : 'Load or paste text first to transform'
              }
              onClick={() => onSubmitPrompt(prompt.trim(), chip.kind)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <span className="prompt-bar-meta" title="Active AI provider and model (change in Settings)">
          {provider} · {model}
        </span>
      </div>
    </div>
  )
}

