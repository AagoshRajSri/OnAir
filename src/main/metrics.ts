import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const METRICS_ENABLED = process.env['FR_METRICS'] === '1'
const outputPath = join(app.getPath('userData'), 'latency-results.csv')

class Metrics {
  private marks: Map<string, number> = new Map()
  private initialized = false

  async init(): Promise<void> {
    if (!METRICS_ENABLED || this.initialized) return
    this.initialized = true
    try {
      await fs.access(outputPath)
    } catch {
      await fs.writeFile(outputPath, 'label,start_ms,end_ms,duration_ms\n', 'utf-8')
    }
  }

  mark(label: string): void {
    if (!METRICS_ENABLED) return
    const now = performance.now()
    if (this.marks.has(label)) {
      const start = this.marks.get(label)!
      const duration = now - start
      this.marks.delete(label)
      this.record(label, start, now, duration).catch(console.error)
    } else {
      this.marks.set(label, now)
    }
  }

  private async record(
    label: string,
    start: number,
    end: number,
    duration: number
  ): Promise<void> {
    await fs.appendFile(
      outputPath,
      `${label},${start.toFixed(2)},${end.toFixed(2)},${duration.toFixed(2)}\n`,
      'utf-8'
    )
  }
}

export const metrics = new Metrics()

