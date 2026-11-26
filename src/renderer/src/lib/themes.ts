// lib/themes.ts — All theme definitions and CSS variable application
import type { ThemeId, Settings } from '../../../shared/types'

export interface ThemePreset {
  id: ThemeId
  label: string
  bg: string
  text: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'obsidian', label: 'Obsidian', bg: '#0f1115', text: '#e6e8ec' },
  { id: 'midnight', label: 'Midnight', bg: '#0b1220', text: '#dbe4ff' },
  { id: 'forest', label: 'Forest', bg: '#0f1a14', text: '#d8ecd9' },
  { id: 'warm-charcoal', label: 'Warm Charcoal', bg: '#1c1917', text: '#f1e9dd' },
  { id: 'oled-black', label: 'OLED Black', bg: '#000000', text: '#f2f2f2' },
  { id: 'slate', label: 'Slate', bg: '#1e293b', text: '#e2e8f0' }
]

export function getThemeColors(themeId: ThemeId, currentBg: string, currentText: string): { bg: string; text: string } {
  if (themeId === 'custom') {
    return { bg: currentBg, text: currentText }
  }
  const preset = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0]
  return { bg: preset.bg, text: preset.text }
}

/** Sanitize font family name: delete " ; { } \ and format as "<chosen>", "Segoe UI", sans-serif */
export function buildFontFamily(fontName: string): string {
  const safe = fontName.replace(/["';{}\\]/g, '').trim()
  return `"${safe}", "Segoe UI", sans-serif`
}

/** Apply all CSS variables to document.documentElement without re-rendering */
export function applySettingsToDOM(settings: Settings): void {
  const root = document.documentElement
  const colors = getThemeColors(settings.theme, settings.bgColor, settings.textColor)

  // ── Presentation stage typography ───────────────────────────
  root.style.setProperty('--font-size', `${settings.fontSize}px`)
  root.style.setProperty('--font-weight', `${settings.fontWeight}`)
  root.style.setProperty('--line-height', `${settings.lineHeight}`)
  root.style.setProperty('--letter-spacing', `${settings.letterSpacing}px`)
  root.style.setProperty('--padding', `${settings.padding}px`)
  root.style.setProperty('--text-align', settings.textAlign)
  root.style.setProperty('--bg-color', colors.bg)
  root.style.setProperty('--text-color', colors.text)
  root.style.setProperty('--font-family', buildFontFamily(settings.fontFamily))
  root.style.setProperty('--max-content-width', settings.maxContentWidth > 0 ? `${settings.maxContentWidth}px` : 'none')
  const sx = settings.mirrorX ? -1 : 1
  const sy = settings.mirrorY ? -1 : 1
  root.style.setProperty('--stage-transform', sx === 1 && sy === 1 ? 'none' : `scale(${sx}, ${sy})`)
  root.style.setProperty('--rsvp-orp-color', settings.rsvpOrpColor || '#ff5252')

  // ── Text shadow / glow ───────────────────────────────────────
  if (settings.textShadow) {
    const blur = settings.textShadowBlur ?? 8
    const color = settings.textShadowColor ?? '#ffffff'
    root.style.setProperty('--text-shadow', `0 0 ${blur}px ${color}`)
  } else {
    root.style.setProperty('--text-shadow', 'none')
  }

  // ── UI chrome tokens ─────────────────────────────────────────
  const accent = settings.uiAccentColor ?? '#f59e0b'
  root.style.setProperty('--ui-accent', accent)
  // Derive a dim version of the accent (20% opacity)
  root.style.setProperty('--ui-accent-dim', `${accent}33`)

  const surface = settings.uiSurfaceColor ?? '#0d0d0d'
  root.style.setProperty('--ui-surface', surface)
  // surface-2 is a slightly lighter lift
  root.style.setProperty('--ui-surface-2', lighten(surface, 0.04))

  // Chrome borders
  root.style.setProperty('--ui-border', settings.showChromeBorder ? 'rgba(255,255,255,0.07)' : 'transparent')
  root.style.setProperty('--ui-border-hover', settings.showChromeBorder ? 'rgba(255,255,255,0.14)' : 'transparent')

  // Transition speed
  const speeds: Record<string, string> = {
    none:   '0ms linear',
    fast:   '60ms cubic-bezier(0.4,0,0.2,1)',
    normal: '120ms cubic-bezier(0.4,0,0.2,1)',
    slow:   '250ms cubic-bezier(0.4,0,0.2,1)'
  }
  root.style.setProperty('--ui-transition', speeds[settings.uiTransitionSpeed ?? 'normal'] ?? speeds['normal'])
  root.style.setProperty('--win-opacity', String(Math.max(0.3, Math.min(1, settings.opacity ?? 1))))

  document.body.style.backgroundColor = 'transparent'
  document.body.style.color = colors.text
}

/** Lighten a hex color by adding a small amount to each channel */
function lighten(hex: string, amount: number): string {
  const c = hex.replace('#', '').padEnd(6, '0')
  const r = Math.min(255, parseInt(c.slice(0, 2), 16) + Math.round(amount * 255))
  const g = Math.min(255, parseInt(c.slice(2, 4), 16) + Math.round(amount * 255))
  const b = Math.min(255, parseInt(c.slice(4, 6), 16) + Math.round(amount * 255))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Relative luminance per WCAG 2.1 */
function relativeLuminance(hex: string): number {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  const toLinear = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/** WCAG contrast ratio between two hex colors */
export function contrastRatio(bg: string, text: string): number {
  const L1 = relativeLuminance(bg)
  const L2 = relativeLuminance(text)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}
