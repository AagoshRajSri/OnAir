import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir()
  }
}))

import { Metrics, parseMaxTrials } from '../src/main/metrics'

describe('Metrics trial persistence across restarts', () => {
  let tempDir: string
  let csvPath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'onair-metrics-'))
    csvPath = join(tempDir, 'latency-results.csv')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('parseMaxTrials extracts max trial per metric', () => {
    const csv = [
      'metric,trial,milliseconds',
      'show-window,1,12.345',
      'show-window,2,10.000',
      'theme-switch,1,5.500',
      'show-window,5,11.111'
    ].join('\n')

    const parsed = parseMaxTrials(csv)
    expect(parsed.get('show-window')).toBe(5)
    expect(parsed.get('theme-switch')).toBe(1)
  })

  it('continues trial numbers across restarts without resetting to 1', async () => {
    const run1 = new Metrics(true, csvPath)
    await run1.record('show-window', 21.5)
    await run1.record('show-window', 19.2)
    await run1.record('theme-switch', 8.1)

    // Simulate app restart with a fresh Metrics instance
    const run2 = new Metrics(true, csvPath)
    await run2.record('show-window', 18.4)
    await run2.record('theme-switch', 7.9)
    await run2.record('clipboard-transfer', 42.0)

    const content = await fs.readFile(csvPath, 'utf-8')
    const lines = content.trim().split(/\r?\n/)
    expect(lines).toEqual([
      'metric,trial,milliseconds',
      'show-window,1,21.500',
      'show-window,2,19.200',
      'theme-switch,1,8.100',
      'show-window,3,18.400',
      'theme-switch,2,7.900',
      'clipboard-transfer,1,42.000'
    ])
  })

  it('does nothing when disabled', async () => {
    const disabled = new Metrics(false, csvPath)
    await disabled.record('show-window', 10)
    await expect(fs.access(csvPath)).rejects.toThrow()
  })
})
