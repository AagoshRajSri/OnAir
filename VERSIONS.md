# OnAir — Version Record

All installed package versions are recorded here per the build spec.

## Environment

| Tool | Version |
|------|---------|
| Node.js | v22.13.1 |
| Git | 2.55.0.windows.5 |
| npm | (bundled with Node 22.13.1) |
| OS | Windows 10/11 64-bit |

## Runtime Dependencies

| Package | Version | Reason |
|---------|---------|--------|
| electron | 45.5.0 | Latest stable Electron (upgraded from 36.4.0 to fix Windows transparent/frameless titlebar leak) |
| react | 19.1.0 | UI framework per spec |
| react-dom | 19.1.0 | React DOM renderer |
| pdfjs-dist | 4.9.155 | PDF text extraction (spec §6.3) |
| mammoth | 1.9.0 | DOCX text extraction (spec §6.4) |
| ws | 8.23.0 | Localhost WebSocket bridge for Phase 2 browser extension |

## Dev Dependencies

| Package | Version | Reason |
|---------|---------|--------|
| electron-vite | 3.1.0 | Vite-based build tool for Electron |
| electron-builder | 26.0.12 | Windows installer packaging (M7) |
| vite | 6.3.5 | Bundler (via electron-vite) |
| @vitejs/plugin-react | 4.4.1 | React fast-refresh and JSX transform |
| typescript | 5.8.3 | TypeScript compiler |
| @types/react | 19.1.0 | React type definitions |
| @types/react-dom | 19.1.0 | ReactDOM type definitions |
| @types/node | 22.14.0 | Node.js type definitions |
| @types/ws | 8.18.2 | Localhost WebSocket bridge for Phase 2 browser extension |
| @types/chrome | 0.3.8 | Chrome Extension Manifest V3 API types (Phase 2) |
| jsdom | 29.1.1 | DOM parsing for Chrome extension provider selector tests (Phase 2) |
| @types/jsdom | 30.0.0 | JSDOM type definitions for extension tests (Phase 2) |
| @electron-toolkit/tsconfig | 1.0.1 | Base tsconfig presets |
| @electron-toolkit/eslint-config-ts | 3.0.0 | ESLint config |
| @electron-toolkit/eslint-config-prettier | 3.0.0 | Prettier integration |
| eslint | 9.23.0 | Linting |
| eslint-plugin-react-hooks | 5.2.0 | React hooks rules |
| vitest | 3.2.4 | Unit test runner (spec §1.2) |

## Extra Package Rationale

- **Phase 1**: All packages above (except Phase 2 additions) are required by the Phase 1 Build Spec §1.2 (`eslint.config.mjs` wires `@electron-toolkit/eslint-config-ts`, `@electron-toolkit/eslint-config-prettier`, and `eslint-plugin-react-hooks` for ESLint v9 flat config).
- **Phase 2**: Added `ws` (`8.23.0`) and `@types/ws` (`8.18.2`) — Localhost WebSocket bridge for Phase 2 Chrome extension (`extension/build.mjs` bundles MV3 with esbuild already included via Vite).
- **Phase 3**: Zero new runtime or dev packages — Speed Engine (RSVP/Bionic), SSE/Ollama streaming (`fetch`), and DPAPI encryption (`safeStorage`) use built-in Electron/Node primitives.

## Milestone Log

| Milestone | Status | Date |
|-----------|--------|------|
| M1 Scaffold (`ad77b64`) | ✅ done | 2026-11-25 |
| M2 Reader Window | ✅ done | 2026-11-26 |
| M3 Text Rendering & Themes | ✅ done | 2026-11-26 |
| M4 Input & Clipboard | ✅ done | 2026-11-26 |
| M5 File Import & Normalization | ✅ done | 2026-11-26 |
| M6 Navigation & Sessions | ✅ done | 2026-11-26 |
| M7 Package & Verify (`3d52d78`, `e319242`) | ✅ done | 2026-11-26 |
| Phase 2 Localhost Bridge & Chrome Extension (`d31ec55`, `00ac56d`) | ✅ done | 2026-11-27 |
| Phase 3 Speed Engine & Streaming AI (`b2b0e7d`) | ✅ done | 2026-11-27 |
| Strict Sign-Off Hygiene & Full §9 Benchmarks (`eslint`, `PDFDocumentProxy`, 87 tests) | ✅ done | 2026-11-27 |

