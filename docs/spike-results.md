# Phase 2 Step 1 — Live Provider DOM Spike Results

Date: 2026-11-25  
Gate Status: **Logged (Step 1 Complete)**  
Environment: Signed-in desktop Google Chrome (`127.0.0.1:9222`), live microphone voice test per provider.

## Summary Table

| Provider | Voice Text? | Exact Origin | Message Selector | Streaming Indicator | Notes |
|---|---|---|---|---|---|
| **ChatGPT** | **Yes** | `https://chatgpt.com` | `[data-markdown-text-style="assistant-message"]` (inside `[data-content-search-unit-key$=":assistant"]` / `[data-response-body]`) | Active while `[data-markdown-text-style="assistant-message"][data-markdown-animated]` is present (and `[data-talvt-turn-state="in_progress"]` / `[data-sidebar-indicator="working"]`); finalized (`final: true`) when `data-markdown-animated` is removed and `[data-response-body]` + `[data-chatgpt-selection-message-id]` receive the message UUID | Live reply text renders in the chat thread (`region[aria-label="Conversation"]`) during native voice mode (`Start Voice`). Selecting `[data-markdown-text-style="assistant-message"]` avoids the sibling `h4[data-conversation-role="assistant"]` (`"ChatGPT said:"`) and turn action buttons. Note: hashed CSS classes (`MarkdownRoot-*`, `Paragraph-*`) are **not** used. Also emits `div[role="status"][aria-live="polite"]` with `"Response complete"`. Fixture: [`extension/tests/fixtures/chatgpt.html`](../extension/tests/fixtures/chatgpt.html). |
| **Claude** | **Yes** | `https://claude.ai` | `[data-testid="assistant-message"] [data-cds="Prose"] .standard-markdown` (or `[data-testid="assistant-message"]` excluding `.sr-only` & `[data-testid="message-actions"]`) | `data-is-streaming="true"` and `data-busy=""` on `[data-testid="assistant-message"]` (plus `data-perf-row-streaming="true"` on `[data-testid="transcript-row"]` and `aria-label="Currently streaming message"` on `[role="article"]`); finalized (`final: true`) when `data-is-streaming="false"`, `data-busy` removed, and `data-perf-row-streaming="false"` | Native voice mode (`button[aria-label="Use voice mode"]`) renders word-by-word tokens (`<span data-spoken="false">`) live in the transcript DOM. Must exclude `<h3 class="sr-only">Claude responded: ...</h3>` and `[data-testid="message-actions"]` when extracting reply text. Fixture: [`extension/tests/fixtures/claude.html`](../extension/tests/fixtures/claude.html). |
| **Gemini** | **No** | `https://gemini.google.com` | N/A (clipboard-only) | N/A (clipboard-only) | Signed-in desktop web UI (`https://gemini.google.com/app?pli=1`) has **no native live Voice Mode** — only `button "Dictate (^⇧D)"` (speech-to-text into the prompt box). Per Step 1 gate rules, Gemini stays **clipboard-only** (no provider adapter / host permission added for voice mode). |

---

## Manifest & Adapter Gate Decisions

- **`host_permissions` (only `Yes` / `Partial` providers)**:
  - `https://chatgpt.com/*`
  - `https://claude.ai/*`
  - *(Gemini excluded from provider extension adapters; remains clipboard-only via Phase 1 OnAir workflow.)*

## Detailed DOM Observations

### 1. ChatGPT (`https://chatgpt.com`)
- **Voice Entry Control**: `button[aria-label="Start Voice"]` (`data-composer-voice-start="true"`).
- **Turn Container**:
  - Outer assistant unit: `div[data-content-search-unit-key$=":assistant"][data-chatgpt-search-unit-key$=":assistant"]` (holds sibling `h4[data-conversation-role="assistant"]` `"ChatGPT said:"`).
  - Response wrapper: `div[data-response-body="<uuid>"]` (null/absent until streaming finishes) -> `div[data-chatgpt-selection-message-id="<uuid>"]`.
  - Text body (stable selector): `[data-markdown-text-style="assistant-message"]`.
- **Streaming Lifecycle Observed**:
  1. Turn begins: `[data-talvt-turn-state]` flips `"complete"` -> `"in_progress"`; `[data-sidebar-indicator]` becomes `"working"`; `[data-markdown-text-style="assistant-message"]` carries `data-markdown-animated=""`.
  2. Turn completes (`final: true`): `data-markdown-animated` is removed from `[data-markdown-text-style="assistant-message"]`, `data-response-body` and `data-chatgpt-selection-message-id` are set to the message UUID, `data-sidebar-indicator` clears, and the polite live status updates to `"Response complete"`.

### 2. Claude (`https://claude.ai`)
- **Voice Entry Control**: `button[aria-label="Use voice mode"]` (switches to `aria-label="Stop"` during active voice turn; `[data-cds="ChatComposer"]` toggles `data-busy="true"`).
- **Turn Container**:
  - Outer row: `[data-testid="transcript-row"][data-perf-row="assistant"]` (`data-last-message="true"` on latest turn).
  - Assistant message root: `[data-cds="AssistantMessage"][data-testid="assistant-message"]`.
  - Accessible heading to ignore: `<h3 data-find-omitted="" class="sr-only select-none">Claude responded: ...</h3>`.
  - Reply prose container: `[data-cds="Prose"] .standard-markdown` (contains `<p>` with `<span data-spoken="false">` word tokens during voice mode).
  - Action bar to ignore: `[data-testid="message-actions"]`.
- **Streaming Lifecycle Observed**:
  1. Turn begins: `[data-testid="assistant-message"]` is added with `data-is-streaming="true"` and `data-busy=""`; row has `data-perf-row-streaming="true"`; `[role="article"]` has `aria-label="Currently streaming message"`.
  2. Turn completes (`final: true`): `data-is-streaming` transitions `"true"` -> `"false"`, `data-busy` is removed, `data-perf-row-streaming` transitions `"true"` -> `"false"`, `aria-label` updates to `"Message N of N"`, and `[data-testid="message-actions"]` mounts.

### 3. Gemini (`https://gemini.google.com`)
- Confirmed on signed-in desktop Chrome (`https://gemini.google.com/app?pli=1`): only `Dictate (^⇧D)` is available in the composer; no native live voice mode exists on desktop web. Marked **`No`** -> clipboard-only.

