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

  root.style.setProperty('--font-size', `${settings.fontSize}px`)
  root.style.setProperty('--font-weight', `${settings.fontWeight}`)
  root.style.setProperty('--line-height', `${settings.lineHeight}`)
  root.style.setProperty('--letter-spacing', `${settings.letterSpacing}px`)
  root.style.setProperty('--padding', `${settings.padding}px`)
  root.style.setProperty('--text-align', settings.textAlign)
  root.style.setProperty('--bg-color', colors.bg)
  root.style.setProperty('--text-color', colors.text)
  root.style.setProperty('--font-family', buildFontFamily(settings.fontFamily))

  document.body.style.backgroundColor = colors.bg
  document.body.style.color = colors.text
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
