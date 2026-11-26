# OnAir — Floating Reader Companion

**OnAir** is a lightweight Windows desktop companion that displays any text in a floating, freely resizable, always-on-top window with Word-style reading controls, instant clipboard transfer, and a secure local WebSocket bridge for live browser streaming.

---

## Features

### Floating Frameless Reader (Phase 1)
- **Always on top**: Runs at `screen-saver` level so it stays visible while reading and researching.
- **Non-transparent solid surface**: Ensures smooth Windows OS native resizing down to the minimum floor without GPU compositing lag.
- **Drag & position controls**: 12 px top drag strip with dedicated position locking (`Ctrl+L` / toolbar toggle).
- **Auto-hiding toolbar**: 28 px auto-hiding toolbar on hover (revealed when window height ≥ 100 px).
- **Native Windows context menu**: Standard right-click menu with Cut, Copy, Paste, and Reading actions.
- **Window size presets**: Column (360×640), Compact (400×400), Wide (900×360).
- **State persistence**: Remembers window position and dimensions across restarts with multi-monitor disconnected safety fallbacks.

### Typography & High-Contrast Themes
- **Zero re-render styling**: High-performance CSS custom properties power instant theme and font changes without DOM thrashing.
- **Customizable typography**: Font size (8–200 px), weight (400/700), line height (1.0–3.0), letter spacing (-2–10 px), padding (0–64 px), and text alignment.
- **System & custom fonts**: Segoe UI, Arial, Calibri, Cambria, Consolas, Georgia, Times New Roman, Verdana, or any locally installed font.
- **Direct font scaling**: `Ctrl + Mouse Wheel` increments or decrements font size by 2 px per notch.
- **6 WCAG AAA high-contrast presets** (> 11:1 contrast ratio):
  - **Obsidian** (default dark)
  - **Midnight** (deep navy)
  - **Forest** (calming dark green)
  - **Warm Charcoal** (soft sepia dark)
  - **OLED Black** (pure black, > 18:1 contrast)
  - **Slate** (cool graphite)
  - Plus full user **Custom** foreground and background colors.

### Reading & Sentence Navigation
- **Intl.Segmenter sentence engine**: Splits text into numbered sentence spans (`<span data-i="n">`).
- **Active focus highlighting**: Currently active sentence is highlighted with 15% text color background tint and kept centered via auto-scrolling.
- **Keyboard navigation**:
  - `↑` / `↓` / `←` / `→`: Navigate sentence-by-sentence or jump paragraphs.
  - `Home` / `End`: Jump to document beginning or end.
  - `Space`: Toggle continuous auto-scroll.
  - `[` / `]`: Adjust auto-scroll speed.
- **Continuous auto-scrolling**: `requestAnimationFrame`-driven smooth scrolling (10–400 px/s, default 60 px/s) with manual scroll interception and end-of-text notification.
- **Page mode**: Optional statement-by-statement presentation mode for focused, distraction-free reading.

### Input, Clipboard & File Importers
- **In-place edit mode**: Edit text directly with `Ctrl+E`, save with `Ctrl+Enter`, or discard with `Esc`.
- **Global clipboard hotkey**: `Ctrl+Alt+V` instantly imports clipboard content into a new session.
- **Clipboard watcher**: Optional 500 ms polling watcher with visual indicator dot on the drag strip.
- **Drag-and-drop import**: Drop plain text or supported document files straight onto the window.
- **Supported file formats**:
  - `.txt`: Automatic encoding detection for UTF-8 (with or without BOM), UTF-16 LE/BE, and Windows-1252.
  - `.pdf`: Fast text extraction via `pdfjs-dist` (scanned PDFs with < 20 characters trigger an OCR notification).
  - `.docx`: Paragraph-preserved text extraction via `mammoth`.
- **Text normalization**: Automatic newline normalization (CRLF/CR → LF), trailing whitespace stripping, and 3+ blank line collapsing.

### Localhost Browser Bridge & Extension (Phase 2)
- **Local WebSocket Bridge**:
  - Main process binds strictly to `127.0.0.1:47821` (never `0.0.0.0`).
  - Strict `Origin` header check verifies connections originate from `chrome-extension://<bridgeExtensionId>`.
  - Constant-time 64-char hex pairing token comparison (`crypto.timingSafeEqual`) eliminates timing attack oracles.
  - Rejection with WebSocket close code **`1008`** (Policy Violation) for invalid tokens, bad origins, unconfigured extension IDs, or non-hello initial frames.
  - Strict monotonic packet sequencing (`seq`) drops out-of-order and duplicated frames.
  - Automatic `ping`/`pong` keepalive (20 s interval) prevents Manifest V3 background service worker termination.
  - Graceful `EADDRINUSE` handling: surfaces an informative error state in Settings without crashing the app.
- **Chrome Extension (Manifest V3)**:
  - Bundled via esbuild into `extension/dist/`.
  - Least-privilege permissions: only `["contextMenus", "storage"]` (no cookies, history, tabs, or `<all_urls>`).
  - Scoped `host_permissions` strictly for validated providers (`https://chatgpt.com/*`, `https://claude.ai/*`).
  - DOM `MutationObserver` with 50 ms leading + trailing throttle so streaming updates render smoothly and the final response chunk is never dropped.
  - Automatic streaming state detection with a 1,500 ms idle finalization fallback.
  - Universal right-click **"Send to reader"** context menu (`contexts: ["selection"]`) allows sending highlighted text from any website without requiring elevated permissions.
  - Per-tab mirroring toggle stored in `chrome.storage.session`.
- **In-Place Dynamic Streaming**:
  - Updates matching active `bridgeId` replace text in-place, preserving user `scrollTop` and clamping `sentenceIndex` dynamically if text length shrinks.
  - New bridge IDs automatically create clean separate sessions.
- **Settings UI**:
  - Dedicated Browser Bridge section displaying live bridge status (`Listening (47821 · 1 active)` / `Port in use`), editable port, Extension ID input, and a copyable/regenerable 64-char pairing token.

### Speed Engine & Streaming AI Pipeline (Phase 3)
- **Reading Modes (`Ctrl+Alt+M` to cycle)**:
  - **Flow**: Default smooth paragraph & sentence navigation.
  - **RSVP**: Rapid Serial Visual Presentation with Optimal Recognition Point (ORP) accent character locked to a fixed horizontal center reticle (zero horizontal jitter), 150–1,000 WPM (step 25, default 350 WPM), and punctuation pause multipliers (`, ; :` 1.5×, `. ! ?` 2.2×, `\n\n` 2.8×). Keyboard controls: `Space` play/pause, `Left`/`Right` step 1 word (`Shift` steps 10 words), `Up`/`Down` ±25 WPM.
  - **Bionic**: Configurable prefix-bolded fixation scanning (20–70%, default 40%).
- **Direct Main-Process AI Streaming (`src/main/ai/`)**:
  - Native Node `fetch` SSE & Ollama NDJSON streaming with zero vendor SDK bloat and a 15-second connection timeout.
  - Supports **Local Ollama** (`http://127.0.0.1:11434` / `localhost`, zero API key) plus **OpenAI**, **Anthropic**, **Gemini**, and **Groq**.
  - 16 ms (~60 Hz) leading + trailing chunk coalescer prevents React render thrashing during 300+ tok/s bursts.
- **Quick-Prompt Bar (`Ctrl+Alt+P`)**:
  - Inline prompt input + 1-click transform chips (**Summarize**, **Bullets**, **Simplify**) operating on the active session.
  - Streams directly into a new session (`flow`, `rsvp`, or `bionic`) while preserving the pre-prompt session for instant `Ctrl+Alt+B` revert.
  - `Esc` or **Stop** cancels the `AbortController` immediately and saves any partial output as a valid session.
- **DPAPI Encrypted Key Storage (`src/main/secrets.ts`)**:
  - Cloud API keys are encrypted at rest via Electron `safeStorage` (Windows DPAPI) in `userData/secrets.enc`. Write-only inputs in **AI & Speed Engine** Settings display `"Saved (encrypted)"` + **Clear** without ever reading raw keys back into the renderer.

---

## Security Architecture

| Boundary | Policy | Implementation |
|---|---|---|
| **Renderer Sandbox** | Fully isolated | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Preload Bridge** | Typed IPC only | APIs strictly exposed via `contextBridge` (`window.api`); zero raw IPC channels exposed |
| **Network Binding** | Loopback only | WebSocket server bound strictly to `127.0.0.1` (never `0.0.0.0`) |
| **Extension Auth** | Timing-safe check | Pairing token validated via `crypto.timingSafeEqual`; Origin validated to exact extension ID |
| **Attack Rejection** | Fast fail | WebSocket code `1008` issued immediately on auth failure, origin mismatch, or invalid handshake |
| **Extension Scope** | Least privilege | Manifest V3 permissions restricted to `["contextMenus", "storage"]`; no wildcards or broad hosts |
| **AI Network Boundary** | Main process only | All HTTP/SSE/NDJSON requests execute solely in `src/main/ai/`; renderer & preload stay 100% offline |
| **API Key Storage** | DPAPI encrypted | Secrets encrypted at rest in `userData/secrets.enc` via `safeStorage`; renderer only queries `secretsHasKey` boolean |
| **Screen Capture** | Always visible | Content protection / capture-hiding APIs are **never** used; window remains visible in screen shares |

---

## Development & Testing

### Prerequisites
- Node.js LTS (v22.x)
- Windows 10 (22H2) or Windows 11 64-bit

### Running the App
```bash
# Start desktop app in development mode
npm run dev

# Run TypeScript type check across all targets (app, node, extension)
npm run typecheck

# Run full Vitest test suite (82 tests)
npm test

# Build production bundles
npm run build

# Package Windows NSIS Installer (dist/OnAir Setup 1.0.0.exe)
npm run build:win
```

### Building the Chrome Extension
```bash
# Bundle extension into extension/dist/
node extension/build.mjs
```
Then in Chrome:
1. Navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `extension/dist/`.
4. Copy the generated Extension ID into **OnAir Settings $\rightarrow$ Browser Bridge $\rightarrow$ Chrome Extension ID**.

---

## Benchmarks & Performance Reports

### 1. Clipboard Transfer Performance (Phase 1)
Measured end-to-end latency from global clipboard hotkey activation (`Ctrl + Alt + V`) to double-`requestAnimationFrame` content rendering in the Electron window.

| Metric | Result |
|---|---:|
| Number of trials | 226 |
| **Median latency** | **14.445 ms** |
| Average latency | 14.474 ms |
| P95 latency | 24.333 ms |
| Minimum latency | 2.689 ms |
| Maximum latency | 38.611 ms |

---

### 2. Localhost Bridge & Streaming Performance (Phase 2)
Measured end-to-end latency from local WebSocket frame arrival through the Electron main bridge, IPC relay, and React renderer to completion of two consecutive animation frames (`FR_METRICS=1`).

- **Protocol**: Local WebSocket over `ws://127.0.0.1:47821`
- **Payload**: Incremental streaming sentences mimicking live AI response chunks
- **Automated harness**: `scripts/verify-step6-e2e.mjs`
- **Target**: Median < 150 ms

| Metric | Result | Target | Margin |
|---|---:|---:|---:|
| Total trials | 33 | — | — |
| Discarded warmup trials | 3 | — | — |
| Measured trials | 30 | — | — |
| **Median latency** | **16.821 ms** | **< 150 ms** | **8.9× faster** |
| P95 latency | 33.484 ms | < 250 ms | 7.5× faster |
| Minimum latency | 0.784 ms | — | — |
| Maximum latency | 33.837 ms | — | — |

---

### 3. Speed Engine & Streaming AI Performance (Phase 3)
Measured directly on the packaged Electron build (`dist/win-unpacked/OnAir.exe`) via `scripts/verify-phase3-e2e.mjs` with `FR_METRICS=1` (33+ trials per local metric, first 3 warm-up trials discarded), strictly separating AI network latency from local renderer paint timing.

| Metric | Category | Trials (Measured) | Median | P95 | Target (Median / P95) |
|---|---|---:|---:|---:|---|
| `mode-switch` | Local | 36 (33) | **36.8 ms** | **39.5 ms** | < 100 ms / < 200 ms |
| `ai-chunk-paint` | Local | 42 (39) | **25.6 ms** | **32.4 ms** | < 33 ms / < 66 ms |
| `rsvp-jitter` | Local | 39 (36) | **7.8 ms** | **18.1 ms** | < 16 ms / < 32 ms |
| `ai-ttft-<provider>` | AI / Network | 2 | 50.87 / 3.39 ms | — | Report only (separated) |
| `ai-tps-<provider>` | AI / Network | 2 | 32.99 / 38.87 tok/s | — | Report only (separated) |
| RSVP reticle center drift | Visual | 20 words | **0.00 px** | — | 0 px |

---

## Test Coverage Summary

OnAir maintains **82 automated tests across 12 test suites** (100% passing):

1. **`tests/normalize.test.ts`** (10 tests): CRLF/CR normalization, NUL stripping, trailing whitespace trimming, newline collapsing, edit mode constraints.
2. **`tests/storage.test.ts`** (8 tests): Session history pruning, 7-day retention limit, 20-session cap, sort order integrity, default settings.
3. **`tests/themes.test.ts`** (4 tests): WCAG AAA contrast ratio mathematical verification for all presets (Obsidian, Slate, OLED Black $\ge 18:1$).
4. **`tests/metrics.test.ts`** (3 tests): Trial counter persistence across restarts, metric file parsing, disabled state handling.
5. **`tests/sentences.test.ts`** (11 tests): `Intl.Segmenter` splitting, paragraph indexing, directional paragraph navigation, sentence clamping on text shrinkage.
6. **`tests/bridge.test.ts`** (6 tests): Port & token generation, timing-safe auth, close code 1008 rejection cases, seq ordering, ping/pong, EADDRINUSE resilience.
7. **`tests/importers.test.ts`** (8 tests): UTF-8 BOM, Windows-1252, selectable PDF extraction, scanned PDF detection, DOCX extraction, oversized file rejection (>10 MB).
8. **`extension/tests/providers.test.ts`** (10 tests): ChatGPT & Claude DOM adapters against HTML fixtures, streaming indicator detection, 50 ms leading/trailing throttle controller, 1500 ms idle finalization fallback.
9. **`tests/secrets.test.ts`** (6 tests): Phase 3 default contracts, DPAPI `safeStorage` round-trip, zero plaintext on disk (`secrets.enc`), unavailability refusal, multi-provider deletion.
10. **`tests/rsvp.test.ts`** (5 tests): ORP index buckets (`1..14+`), punctuation-aware lossless splitting, pause multipliers (`1.5×`, `2.2×`, `2.8×`), 300 WPM timing accuracy (50 words in 10 s).
11. **`tests/bionic.test.ts`** (4 tests): Prefix length calculation, strength clamping, lossless reconstruction across newlines/punctuation.
12. **`tests/sse-parser.test.ts`** (7 tests): Split multi-byte UTF-8 / TCP chunk boundaries, `[DONE]` & provider SSE/NDJSON parsers, 16 ms coalescing, HTTP 401/429 error toasts, mid-stream `AbortController` cancellation, localhost-only Ollama URL validation.
