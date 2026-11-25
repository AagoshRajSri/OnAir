# OnAir — Floating Reader Companion (Phase 1)

**OnAir** is a lightweight Windows desktop companion that displays any text in a floating, freely resizable, always-on-top window with Word-style reading controls.

---

## Features

- **Floating Frameless Reader**:
  - Always on top (`screen-saver` level)
  - Non-transparent window (ensures smooth Windows OS native resizing down to minimum floor)
  - 12 px drag strip with position locking support
  - 28 px auto-hiding toolbar on hover (visible when height ≥ 100 px)
  - Native Windows right-click context menu
  - Window size presets: Column (360×640), Compact (400×400), Wide (900×360)
  - Auto-remembers position and dimensions across restarts (with multi-monitor disconnected fallback)

- **Typography & Themes**:
  - CSS-variable driven styling with no text re-rendering
  - Font size (8–200 px), weight (400/700), line height (1.0–3.0), letter spacing (-2–10 px), padding (0–64 px), text alignment
  - Fonts: Segoe UI, Arial, Calibri, Cambria, Consolas, Georgia, Times New Roman, Verdana, or custom installed fonts
  - `Ctrl + Mouse Wheel` changes font size by 2 per notch
  - 6 High-Contrast WCAG-compliant presets (> 11:1 contrast): Obsidian (default), Midnight, Forest, Warm Charcoal, OLED Black, Slate, plus user Custom colors

- **Reading & Navigation**:
  - Native `Intl.Segmenter` sentence parsing into `<span data-i="n">`
  - Active sentence highlighted with 15% text color background and centered via `scrollIntoView`
  - Keyboard navigation: Arrow keys (sentence / paragraph), Home/End, Space (pause/resume auto-scroll)
  - `requestAnimationFrame` continuous auto-scroll (10–400 px/s, default 60 px/s) with manual scroll sync and end notification

- **Input & File Imports**:
  - In-place Edit mode (`Ctrl+E`, `Ctrl+Enter` to save, `Esc` to cancel)
  - Hotkey clipboard import (`Ctrl+Alt+V`)
  - Optional clipboard watcher (500 ms polling with indicator dot on drag strip)
  - Drag-and-drop file and text import
  - Supported file formats: `.txt` (UTF-8 with BOM, UTF-16 LE/BE, Windows-1252), `.pdf` (selectable text via pdfjs-dist legacy), and `.docx` (via mammoth)
  - Automatic text normalization (CRLF/CR → LF, NUL removal, trailing whitespace stripping, newline collapsing)

- **History & Sessions**:
  - Sessions stored as plain JSON in `app.getPath('userData')/sessions/`
  - Back shortcut (`Ctrl+Alt+B`) toggles between current and previous session
  - Auto-prunes sessions older than 7 days, capping history at the 20 newest sessions

---

## Security Model

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- All preload APIs are strictly exposed via `contextBridge` (`window.api`).
- No external network calls, remote content, or API keys in Phase 1.
- Content protection / capture-hiding APIs are **never** called, ensuring the window remains visible in screen shares and recordings.

---

## Known Limitations

1. **Full-Screen Slide and Video-Call Overlays**:
   - Applications that enter Direct3D exclusive full-screen mode (such as PowerPoint full-screen slideshows or exclusive Zoom/Teams screens) take exclusive control over the display adapter surface. Although OnAir runs with `alwaysOnTop: true ('screen-saver')`, exclusive full-screen software may cover the floating reader window. Run presentations in windowed or borderless mode for simultaneous viewing.
2. **Password Managers & Clipboard Monitoring**:
   - When clipboard monitoring is enabled, OnAir checks for the Windows format `ExcludeClipboardContentFromMonitorProcessing` before importing. However, because format registration varies among password manager clients, it is recommended to keep clipboard monitoring disabled when handling sensitive passwords.
3. **Scanned PDFs**:
   - PDFs with fewer than 20 non-whitespace characters are detected as scanned documents and trigger a notification indicating that OCR is planned for a subsequent phase.

---

## Development & Testing

### Prerequisites
- Node.js LTS (v22.x)
- Windows 10 (22H2) or Windows 11 64-bit

### Running the App
```bash
# Start development mode
npm run dev

# Run all unit tests
npm test

# Run TypeScript type check
npm run typecheck

# Build production bundle
npm run build

# Package Windows NSIS Installer (dist/)
npm run build:win
```

### Latency Measurement Protocol (§9)
To run the automated latency benchmark:
```powershell
$env:FR_METRICS="1"
npm start
```
Timestamps and durations are recorded to `latency-results.csv` in the app's `userData` folder.

---

## Phase 1 Benchmark Report

### Clipboard Transfer Performance

Measured the end-to-end latency from clipboard hotkey activation (`Ctrl + Alt + V`) to content rendering in the Electron application.

| Metric | Result |
|---|---:|
| Number of trials | 226 |
| Average latency | 14.474 ms |
| Median latency | 14.445 ms |
| P95 latency | 24.333 ms |
| Minimum latency | 2.689 ms |
| Maximum latency | 38.611 ms |

**Measurement methodology:** Instrumented the Electron main process and renderer using high-resolution performance timestamps. The completion marker is recorded after two consecutive animation frames.

**Result:** Median clipboard-to-render latency of approximately 14.45 ms across 226 trials.

