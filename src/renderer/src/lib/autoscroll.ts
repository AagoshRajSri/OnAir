// lib/autoscroll.ts — RAF-based auto-scroll with optional Section 9 Smoothness metrics

export type SmoothnessCallback = (avgFps: number, over33Pct: number) => void

let scrollMetricsEnabled = false

export function setScrollMetricsEnabled(enabled: boolean): void {
  scrollMetricsEnabled = enabled
}

export function isMetricsTrackingEnabled(): boolean {
  return scrollMetricsEnabled
}

export class AutoScroller {
  private rafId: number | null = null
  private pos = 0
  private lastTimestamp = 0
  private container: HTMLElement | null = null
  private onEnd: (() => void) | null = null
  private onSmoothness: SmoothnessCallback | null = null
  private frameDeltas: number[] = []
  private elapsedMs = 0
  public speed = 60 // px/s

  start(
    container: HTMLElement,
    speed: number,
    onEnd: () => void,
    onSmoothness?: SmoothnessCallback
  ): void {
    this.stop()
    this.container = container
    this.speed = speed
    this.onEnd = onEnd
    this.onSmoothness = onSmoothness ?? null
    this.pos = container.scrollTop
    this.lastTimestamp = performance.now()
    this.frameDeltas = []
    this.elapsedMs = 0
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.frameDeltas = []
    this.elapsedMs = 0
  }

  isRunning(): boolean {
    return this.rafId !== null
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  private tick = (timestamp: number): void => {
    if (!this.container) return

    const deltaMs = timestamp - this.lastTimestamp
    const deltaSec = deltaMs / 1000
    this.lastTimestamp = timestamp

    if (scrollMetricsEnabled && deltaMs > 0) {
      this.frameDeltas.push(deltaMs)
      this.elapsedMs += deltaMs

      if (this.elapsedMs >= 10_000 && this.frameDeltas.length > 0) {
        const totalFrames = this.frameDeltas.length
        const avgFps = (totalFrames * 1000) / this.elapsedMs
        const over33Count = this.frameDeltas.filter((d) => d > 33).length
        const over33Pct = (over33Count / totalFrames) * 100

        this.onSmoothness?.(avgFps, over33Pct)
        this.frameDeltas = []
        this.elapsedMs = 0
      }
    }

    // Sync if user scrolled manually (> 2px deviation)
    const currentScroll = this.container.scrollTop
    const deviation = Math.abs(currentScroll - this.pos)
    if (deviation > 2) {
      this.pos = currentScroll
    }

    this.pos += this.speed * deltaSec
    this.container.scrollTop = this.pos

    const maxScroll = this.container.scrollHeight - this.container.clientHeight
    if (this.pos >= maxScroll - 1) {
      this.stop()
      this.onEnd?.()
      return
    }

    this.rafId = requestAnimationFrame(this.tick)
  }
}
