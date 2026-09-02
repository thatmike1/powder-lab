import type { PaintEvent } from './protocol'

/** flush cadence: 20 paint events per second rather than one per rendered frame */
export const FLUSH_MS = 50

/** hard cap on points in one event, so a long drag cannot grow an unbounded frame */
export const MAX_POINTS = 512

export interface StrokeBatcherOptions {
  send: (event: PaintEvent) => void
  flushMs?: number
  maxPoints?: number
}

/**
 * coalesces a held pointer's per-frame paint samples into ~20 events a second.
 *
 * no sample is dropped: the points ride along in one flat list and are applied
 * one at a time in order at the far end, so the stroke — including the faucet
 * behaviour of a pointer held still — is identical to painting locally every
 * frame. brush size and material changes force a flush, because one event
 * carries a single `r` and `mat`.
 */
export class StrokeBatcher {
  private readonly send: (event: PaintEvent) => void
  private readonly flushMs: number
  private readonly maxPoints: number
  private pts: number[] = []
  private r = 0
  private mat = -1
  private lastFlush = Number.NEGATIVE_INFINITY

  constructor(options: StrokeBatcherOptions) {
    this.send = options.send
    this.flushMs = options.flushMs ?? FLUSH_MS
    this.maxPoints = options.maxPoints ?? MAX_POINTS
  }

  /** add one sampled point; may emit an event immediately */
  add(now: number, x: number, y: number, r: number, mat: number): void {
    if (this.pts.length > 0 && (r !== this.r || mat !== this.mat)) this.flush(now)
    this.r = r
    this.mat = mat
    this.pts.push(x, y)
    // the first point of a stroke goes out at once so the stroke starts on time;
    // everything after it waits out the flush interval.
    if (this.pts.length / 2 >= this.maxPoints || now - this.lastFlush >= this.flushMs) {
      this.flush(now)
    }
  }

  /** emit whatever has accumulated, if the flush interval has elapsed */
  poll(now: number): void {
    if (this.pts.length > 0 && now - this.lastFlush >= this.flushMs) this.flush(now)
  }

  /** emit whatever has accumulated right now (pointer up, tool change, leaving a room) */
  flush(now: number): void {
    if (this.pts.length === 0) return
    const pts = this.pts
    this.pts = []
    this.lastFlush = now
    this.send({ type: 'paint', pts, r: this.r, mat: this.mat })
  }

  /** discard without sending; used when the socket drops mid-stroke */
  reset(): void {
    this.pts = []
    this.mat = -1
    this.lastFlush = Number.NEGATIVE_INFINITY
  }

  get pendingPoints(): number {
    return this.pts.length / 2
  }
}
