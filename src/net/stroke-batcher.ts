import type { MagnetEvent, PaintEvent } from './protocol'

/** flush cadence: 20 events per second rather than one per rendered frame */
export const FLUSH_MS = 50

/** hard cap on points in one event, so a long drag cannot grow an unbounded frame */
export const MAX_POINTS = 512

export interface PointBatcherOptions<E> {
  /** put the event on the wire; false means the socket is gone */
  send: (event: E) => boolean
  /**
   * applied locally when `send` reports the socket is gone. without it a stroke
   * in flight when the connection drops is silently lost, leaving a seam.
   */
  fallback?: (event: E) => void
  flushMs?: number
  maxPoints?: number
}

/** one run of consecutive points sharing a brush size and a tool value */
interface Segment<K> {
  n: number
  r: number
  k: K
}

/**
 * coalesces a held pointer's per-frame samples into a bounded number of events.
 *
 * no sample is dropped and nothing reorders: the points ride along in one flat
 * list and are applied one at a time in order at the far end, so the stroke —
 * including the faucet behaviour of a pointer held still — is identical to
 * acting on the grid locally every frame.
 *
 * the outbound event rate is capped by the flush interval and the point cap
 * ALONE. changing brush or material mid-drag starts a new segment inside the
 * pending event rather than forcing it out, so mashing keys during a stroke
 * cannot lift the event rate above the cap.
 */
abstract class PointBatcher<K, E> {
  private readonly sendEvent: (event: E) => boolean
  private readonly fallback: ((event: E) => void) | null
  private readonly flushMs: number
  private readonly maxPoints: number
  private pts: number[] = []
  private segs: Segment<K>[] = []
  private lastFlush = Number.NEGATIVE_INFINITY

  constructor(options: PointBatcherOptions<E>) {
    this.sendEvent = options.send
    this.fallback = options.fallback ?? null
    this.flushMs = options.flushMs ?? FLUSH_MS
    this.maxPoints = options.maxPoints ?? MAX_POINTS
  }

  /** add one sampled point; may emit an event immediately */
  add(now: number, x: number, y: number, r: number, k: K): void {
    const tail = this.segs.length > 0 ? this.segs[this.segs.length - 1] : null
    if (tail !== null && tail.r === r && tail.k === k) tail.n++
    else this.segs.push({ n: 1, r, k })
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
    const event = this.build(this.pts, this.segs)
    this.pts = []
    this.segs = []
    this.lastFlush = now
    // a dead socket must not eat the points: hand them to the local fallback so
    // the stroke continues single-player exactly where it left off.
    if (!this.sendEvent(event)) this.fallback?.(event)
  }

  /** discard without sending or applying; only for a deliberate abandon */
  reset(): void {
    this.pts = []
    this.segs = []
    this.lastFlush = Number.NEGATIVE_INFINITY
  }

  get pendingPoints(): number {
    return this.pts.length / 2
  }

  /** build the wire event for a completed batch */
  protected abstract build(pts: number[], segs: Segment<K>[]): E
}

/** batches paint samples into `paint` events */
export class StrokeBatcher extends PointBatcher<number, PaintEvent> {
  protected build(pts: number[], segs: Segment<number>[]): PaintEvent {
    const head = segs[0]
    if (segs.length === 1) return { type: 'paint', pts, r: head.r, mat: head.k }
    return {
      type: 'paint',
      pts,
      r: head.r,
      mat: head.k,
      segs: segs.map((seg) => ({ n: seg.n, r: seg.r, mat: seg.k })),
    }
  }
}

/**
 * batches magnet samples into `magnet` events.
 *
 * the magnet is a force applied once per sample, so throttling it without
 * batching would make an in-room pull weaker than an offline one. batching
 * keeps the call count — and therefore the force — identical on both sides.
 */
export class MagnetBatcher extends PointBatcher<boolean, MagnetEvent> {
  protected build(pts: number[], segs: Segment<boolean>[]): MagnetEvent {
    const head = segs[0]
    if (segs.length === 1) return { type: 'magnet', pts, r: head.r, attract: head.k }
    return {
      type: 'magnet',
      pts,
      r: head.r,
      attract: head.k,
      segs: segs.map((seg) => ({ n: seg.n, r: seg.r, attract: seg.k })),
    }
  }
}
