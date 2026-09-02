// seeded pseudo-random source for the simulation. deterministic lockstep
// multiplayer means every client must draw the SAME sequence of numbers in the
// same order, so nothing in the engine may call the global random source — all
// randomness comes from one instance of this, whose whole state is a single uint32 word
// that travels inside a serialized simulation state.

/** default seed used when a Simulation is constructed without an explicit one. */
export const DEFAULT_SEED = 0x9e3779b9

/**
 * mulberry32: a 32-bit state, 32-bit output PRNG. chosen because its entire
 * state is one uint32 (trivial to serialize and compare across clients) and it
 * uses only integer ops, so it produces identical bits on every JS engine —
 * float accumulation would not.
 */
export class Rng {
  private s: number

  constructor(seed: number = DEFAULT_SEED) {
    this.s = seed >>> 0
  }

  /** next float in [0, 1), the drop-in replacement for the global random source. */
  next(): number {
    return this.nextUint32() / 4294967296
  }

  /** next raw uint32 draw. */
  nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }

  /** the complete generator state as one uint32 word. */
  getState(): number {
    return this.s >>> 0
  }

  /** restore a state word captured by {@link getState}. */
  setState(state: number): void {
    this.s = state >>> 0
  }
}
