// lib/autoscroll.ts — RAF-based auto-scroll
export class AutoScroller {
  private rafId: number | null = null
  private pos = 0
  private lastTimestamp = 0
  private container: HTMLElement | null = null
  private onEnd: (() => void) | null = null
  public speed = 60 // px/s

  start(container: HTMLElement, speed: number, onEnd: () => void): void {
    this.stop()
    this.container = container
    this.speed = speed
    this.onEnd = onEnd
    this.pos = container.scrollTop
    this.lastTimestamp = performance.now()
    this.tick(this.lastTimestamp)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  isRunning(): boolean {
    return this.rafId !== null
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  private tick = (timestamp: number): void => {
    if (!this.container) return

    const delta = (timestamp - this.lastTimestamp) / 1000
    this.lastTimestamp = timestamp

    // Sync if user scrolled manually (> 2px deviation)
    const currentScroll = this.container.scrollTop
    const deviation = Math.abs(currentScroll - this.pos)
    if (deviation > 2) {
      this.pos = currentScroll
    }

    this.pos += this.speed * delta
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
