import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.', getAppPath: () => '.' },
  BrowserWindow: vi.fn(),
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } }) },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: vi.fn() }
}))

import { computeTopCenterBounds } from '../src/main/window'

describe('Camera top-center default placement (computeTopCenterBounds)', () => {
  it('centers the visible teleprompter card horizontally at top edge of workArea', () => {
    const bounds = computeTopCenterBounds({ x: 0, y: 0, width: 1920, height: 1032 }, 520, 280)
    expect(bounds.y).toBe(0)
    expect(bounds.width).toBe(520)
    expect(bounds.height).toBe(280)
    // Visible card spans [x + 38, x + width - 6] -> center must match 960
    const visibleCenterX = bounds.x + 38 + (bounds.width - 44) / 2
    expect(visibleCenterX).toBe(960)
  })

  it('respects secondary monitor workArea offset and clamps wide windows inside workArea', () => {
    const bounds = computeTopCenterBounds({ x: 1920, y: 40, width: 800, height: 600 }, 900, 320)
    expect(bounds.x).toBe(1920)
    expect(bounds.y).toBe(40)
    expect(bounds.width).toBe(900)
  })
})

