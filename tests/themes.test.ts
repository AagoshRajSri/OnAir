import { describe, it, expect } from 'vitest'
import { THEME_PRESETS, contrastRatio } from '../src/renderer/src/lib/themes'

describe('Theme contrast ratios', () => {
  it('every preset theme has contrast ratio >= 7:1', () => {
    for (const theme of THEME_PRESETS) {
      const ratio = contrastRatio(theme.bg, theme.text)
      expect(ratio, `${theme.label} (${theme.bg}/${theme.text})`).toBeGreaterThanOrEqual(7)
    }
  })

  it('Obsidian meets spec (>= 11:1)', () => {
    const obsidian = THEME_PRESETS.find(t => t.id === 'obsidian')!
    const ratio = contrastRatio(obsidian.bg, obsidian.text)
    expect(ratio).toBeGreaterThanOrEqual(11)
  })

  it('Slate meets spec (>= 11:1)', () => {
    const slate = THEME_PRESETS.find(t => t.id === 'slate')!
    const ratio = contrastRatio(slate.bg, slate.text)
    expect(ratio).toBeGreaterThanOrEqual(11)
  })

  it('OLED Black is highest contrast (>= 18:1)', () => {
    const oled = THEME_PRESETS.find(t => t.id === 'oled-black')!
    const ratio = contrastRatio(oled.bg, oled.text)
    expect(ratio).toBeGreaterThanOrEqual(18)
  })
})
