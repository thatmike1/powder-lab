import { type StampedInput, INPUT_LOG_TICKS } from './protocol'

/**
 * holds relayed inputs until the tick the server told everyone to apply them at,
 * and keeps the recent past for a resync replay.
 *
 * two orderings matter. inputs come out in ascending `applyTick`, and within one
 * tick in ascending `seq`, because that is the only thing making two clients
 * resolve concurrent strokes identically. `seq` gaps are normal — a targeted
 * setState consumes a room sequence number that healthy peers never see — so
 * nothing here treats the sequence as a completeness check.
 */
export class InputScheduler {
  /** stamped but not yet applied, sorted lazily on drain */
  private pending: StampedInput[] = []
  /** applied and retained, so a resync can replay past the state it rewinds to */
  private log: StampedInput[] = []
  private dirty = false
  private lateCount = 0

  /** accept a stamped input from the relay */
  push(input: StampedInput): void {
    this.pending.push(input)
    this.dirty = true
  }

  /**
   * remove and return every input due at or before `tick`, in apply order. an
   * input whose tick has already passed is returned too (applying it late is
   * strictly better than dropping it) and counted in {@link late}.
   */
  takeDue(tick: number): StampedInput[] {
    if (this.pending.length === 0) return []
    if (this.dirty) {
      this.pending.sort((a, b) => a.applyTick - b.applyTick || a.seq - b.seq)
      this.dirty = false
    }
    let cut = 0
    while (cut < this.pending.length && this.pending[cut].applyTick <= tick) cut++
    if (cut === 0) return []
    const due = this.pending.splice(0, cut)
    for (const input of due) {
      if (input.applyTick < tick) this.lateCount++
    }
    return due
  }

  /** retain an applied input so a later rewind can replay it */
  remember(input: StampedInput): void {
    this.log.push(input)
  }

  /**
   * move every retained input newer than `tick` back into the pending queue.
   * this is the replay half of a resync: rewind the clock, then let the normal
   * drain apply the same events again on the way back to the present.
   */
  requeueAfter(tick: number): number {
    const keep: StampedInput[] = []
    let moved = 0
    for (const input of this.log) {
      if (input.applyTick > tick) {
        this.pending.push(input)
        this.dirty = true
        moved++
      } else {
        keep.push(input)
      }
    }
    this.log = keep
    return moved
  }

  /** drop retained inputs older than the replay window ending at `tick` */
  prune(tick: number): void {
    const oldest = tick - INPUT_LOG_TICKS
    if (this.log.length === 0 || this.log[0].applyTick > oldest) return
    this.log = this.log.filter((input) => input.applyTick > oldest)
  }

  /** inputs that arrived after their apply tick had already passed */
  get late(): number {
    return this.lateCount
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get logCount(): number {
    return this.log.length
  }

  clear(): void {
    this.pending = []
    this.log = []
    this.dirty = false
  }
}
