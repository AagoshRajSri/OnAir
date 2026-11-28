import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.', getAppPath: () => '.' },
  BrowserWindow: vi.fn(),
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } }) },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() }
}))

import { computeTopCenterBounds, resolveDefaultBounds } from '../src/main/window'

describe('Camera top-center default placement (computeTopCenterBounds & resolveDefaultBounds)', () => {
  it('centers the visible teleprompter card horizontally and attaches flush to top edge of workArea', () => {
    const bounds = computeTopCenterBounds({ x: 0, y: 0, width: 1920, height: 1032 }, 380, 180)
    expect(bounds.y).toBe(-6)
    expect(bounds.width).toBe(380)
    expect(bounds.height).toBe(180)
    // Visible card spans [x + 38, x + width - 6] -> center must match 960
    const visibleCenterX = bounds.x + 38 + (bounds.width - 44) / 2
    expect(visibleCenterX).toBe(960)
  })

  it('respects secondary monitor workArea offset and clamps wide windows inside workArea', () => {
    const bounds = computeTopCenterBounds({ x: 1920, y: 40, width: 800, height: 600 }, 900, 320)
    expect(bounds.x).toBe(1920)
    expect(bounds.y).toBe(34)
    expect(bounds.width).toBe(900)
  })

  it('uses custom defaultBounds when set and falls back to built-in camera top-center when null', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1032 }
    expect(resolveDefaultBounds(null, wa)).toEqual({
      x: 754,
      y: -6,
      width: 380,
      height: 180
    })
    expect(resolveDefaultBounds({ x: 661, y: -8, width: 182, height: 116 }, wa)).toEqual({
      x: 661,
      y: -8,
      width: 182,
      height: 116
    })
  })
})

