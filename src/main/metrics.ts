import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { MetricsMarkPayload } from '../shared/types'

export const isMetricsEnabled = process.env['FR_METRICS'] === '1'

/** Parse an existing CSV file and return the highest trial number seen per metric. */
export function parseMaxTrials(csv: string): Map<string, number> {
  const maxTrials = new Map<string, number>()
  const lines = csv.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 2) continue
    const metric = parts[0]
    const trial = Number.parseInt(parts[1], 10)
    if (metric && Number.isFinite(trial) && trial > (maxTrials.get(metric) ?? 0)) {
      maxTrials.set(metric, trial)
    }
  }
  return maxTrials
}

export class Metrics {
  private starts = new Map<string, number>()
  private trials = new Map<string, number>()
  private initPromise: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private enabled: boolean
  private outputPath: string | null

  constructor(enabled = isMetricsEnabled, outputPath: string | null = null) {
    this.enabled = enabled
    this.outputPath = outputPath
  }

  private getOutputPath(): string {
    if (!this.outputPath) {
      this.outputPath = join(app.getPath('userData'), 'latency-results.csv')
    }
    return this.outputPath
  }

  async init(): Promise<void> {
    if (!this.enabled) return
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const filePath = this.getOutputPath()
        try {
          const existing = await fs.readFile(filePath, 'utf-8')
          if (existing.trim().length === 0) {
            await fs.writeFile(filePath, 'metric,trial,milliseconds\n', 'utf-8')
          } else {
            this.trials = parseMaxTrials(existing)
            if (!existing.endsWith('\n')) {
              await fs.appendFile(filePath, '\n', 'utf-8')
            }
          }
        } catch {
          await fs.writeFile(filePath, 'metric,trial,milliseconds\n', 'utf-8')
        }
      })()
    }
    return this.initPromise
  }

  now(): number {
    return performance.timeOrigin + performance.now()
  }

  start(metric: string, timeMs = this.now()): void {
    if (!this.enabled) return
    this.starts.set(metric, timeMs)
  }

  end(metric: string, timeMs = this.now()): void {
    if (!this.enabled) return
    const startMs = this.starts.get(metric)
    if (startMs === undefined) return
    this.starts.delete(metric)
    this.record(metric, timeMs - startMs).catch(console.error)
  }

  handleMark(payload: MetricsMarkPayload): void {
    if (!this.enabled) return
    if (payload.phase === 'start') {
      this.start(payload.metric, payload.timeMs)
    } else if (payload.phase === 'end') {
      this.end(payload.metric, payload.timeMs)
    } else {
      this.record(payload.metric, payload.timeMs).catch(console.error)
    }
  }

  async record(metric: string, milliseconds: number): Promise<void> {
    if (!this.enabled) return
    this.writeQueue = this.writeQueue.then(async () => {
      await this.init()
      const trial = (this.trials.get(metric) ?? 0) + 1
      this.trials.set(metric, trial)
      await fs.appendFile(
        this.getOutputPath(),
        `${metric},${trial},${milliseconds.toFixed(3)}\n`,
        'utf-8'
      )
    })
    return this.writeQueue
  }
}

export const metrics = new Metrics()
