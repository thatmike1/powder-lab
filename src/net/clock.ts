import { TICK_MS } from './protocol'

/** how many offset samples the minimum filter looks back over */
export const CLOCK_WINDOW = 32

/**
 * estimates the server's tick from the local clock.
 *
 * every server frame carries the wall clock at which it was sent, so one sample
 * is `serverTime - localNow`, which overshoots by exactly the one-way network
 * delay. taking the MINIMUM over a window rather than an average is the standard
 * fix: the smallest sample is the one that travelled fastest, so it carries the
 * least delay, and a burst of slow frames cannot drag the estimate along with it.
 */
export class TickClock {
  private readonly samples: number[] = []
  /** server-clock ms at room tick 0 */
  private epoch = 0
  private started = false

  /** anchor the clock from a `joined` frame, which pairs a server time with its tick */
  start(serverTime: number, tick: number, localNow: number): void {
    this.samples.length = 0
    this.epoch = serverTime - tick * TICK_MS
    this.started = true
    this.sample(serverTime, localNow)
  }

  /** feed the `serverTime` of any received frame */
  sample(serverTime: number, localNow: number): void {
    this.samples.push(serverTime - localNow)
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift()
  }

  get ready(): boolean {
    return this.started && this.samples.length > 0
  }

  /** local-to-server clock offset in ms, minimum-filtered over the window */
  get offset(): number {
    let best = 0
    for (let i = 0; i < this.samples.length; i++) {
      if (i === 0 || this.samples[i] < best) best = this.samples[i]
    }
    return best
  }

  /** the server's wall clock as of `localNow` */
  serverNow(localNow: number): number {
    return localNow + this.offset
  }

  /** the tick the room is on right now, per the estimated server clock */
  serverTick(localNow: number): number {
    return Math.floor((this.serverNow(localNow) - this.epoch) / TICK_MS)
  }

  reset(): void {
    this.samples.length = 0
    this.started = false
    this.epoch = 0
  }
}
