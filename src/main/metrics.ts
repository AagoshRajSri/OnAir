import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { MetricsMarkPayload } from '../shared/types'

const METRICS_ENABLED = process.env['FR_METRICS'] === '1'
const outputPath = join(app.getPath('userData'), 'latency-results.csv')

class Metrics {
  private starts = new Map<string, number>()
  private trials = new Map<string, number>()
  private initialized = false

  async init(): Promise<void> {
    if (!METRICS_ENABLED || this.initialized) return
    this.initialized = true
    try {
      await fs.access(outputPath)
    } catch {
      await fs.writeFile(outputPath, 'metric,trial,milliseconds\n', 'utf-8')
    }
  }

  now(): number {
    return performance.timeOrigin + performance.now()
  }

  start(metric: string, timeMs = this.now()): void {
    if (!METRICS_ENABLED) return
    this.starts.set(metric, timeMs)
  }

  end(metric: string, timeMs = this.now()): void {
    if (!METRICS_ENABLED) return
    const startMs = this.starts.get(metric)
    if (startMs === undefined) return
    this.starts.delete(metric)
    this.record(metric, timeMs - startMs).catch(console.error)
  }

  handleMark(payload: MetricsMarkPayload): void {
    if (!METRICS_ENABLED) return
    if (payload.phase === 'start') {
      this.start(payload.metric, payload.timeMs)
    } else if (payload.phase === 'end') {
      this.end(payload.metric, payload.timeMs)
    } else {
      this.record(payload.metric, payload.timeMs).catch(console.error)
    }
  }

  async record(metric: string, milliseconds: number): Promise<void> {
    if (!METRICS_ENABLED) return
    await this.init()
    const trial = (this.trials.get(metric) ?? 0) + 1
    this.trials.set(metric, trial)
    await fs.appendFile(outputPath, `${metric},${trial},${milliseconds.toFixed(3)}\n`, 'utf-8')
  }
}

export const metrics = new Metrics()
