import { describe, expect, it } from 'vitest'
import { Mat } from './materials'
import { Simulation } from './Simulation'

// engine-level tests for the heat field: phase changes are driven purely by the
// per-cell temperature crossing material thresholds, so each test paints a
// scenario, steps the sim, and asserts on the raw `cells`/`heat` arrays.

const W = 40
const H = 30
const idx = (x: number, y: number) => y * W + x
const fresh = () => new Simulation(W, H)

/** count cells of a given material across the grid. */
function countMat(s: Simulation, mat: number): number {
  let c = 0
  for (let k = 0; k < W * H; k++) if (s.cells[k] === mat) c++
  return c
}

/** step until `predicate` holds (returns true) or `max` frames elapse. */
function stepUntil(s: Simulation, max: number, predicate: () => boolean): boolean {
  for (let i = 0; i < max; i++) {
    s.step()
    if (predicate()) return true
  }
  return false
}

/** read the private active-chunk queue without widening the public API. */
function activeChunkCount(s: Simulation): number {
  const next = (s as unknown as { activeNext: Uint8Array }).activeNext
  let c = 0
  for (let k = 0; k < next.length; k++) if (next[k]) c++
  return c
}

describe('heat field — diffusion & ambient', () => {
  it('relaxes to ambient (~20) when there are no sources', () => {
    const s = fresh()
    s.paint(20, 15, 0, Mat.SAND)
    for (let i = 0; i < 50; i++) s.step()
    let maxDev = 0
    for (let i = 0; i < W * H; i++) maxDev = Math.max(maxDev, Math.abs(s.heat[i] - 20))
    expect(maxDev).toBeLessThan(0.5)
  })

  it('makes fire hot and diffuses heat to neighbors', () => {
    const s = fresh()
    // a 3x3 block: the center flame is boxed in by fire so it can't randomly
    // rise away, keeping this deterministic (a single flame's heat varies with
    // whether it happened to drift that frame).
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) s.paint(20 + dx, 15 + dy, 0, Mat.FIRE)
    s.step()
    s.step()
    expect(s.heat[idx(20, 15)]).toBeGreaterThan(600)
    expect(s.heat[idx(22, 15)]).toBeGreaterThan(25) // heat reached past the block edge
  })
})

describe('heat field — ignition (flammables)', () => {
  it('burns across a wood slab from a single embedded flame', () => {
    const s = fresh()
    // 3-thick slab so the flame can't simply rise away into open air
    for (let x = 8; x < 32; x++) for (let y = 14; y < 17; y++) s.paint(x, y, 0, Mat.WOOD)
    s.paint(9, 15, 0, Mat.FIRE)
    let maxBurnX = 9
    for (let i = 0; i < 600; i++) {
      s.step()
      for (let x = 11; x < 32; x++) {
        const m = s.cells[idx(x, 15)]
        if ((m === Mat.FIRE || m === Mat.EMPTY || m === Mat.SMOKE) && x > maxBurnX) maxBurnX = x
      }
    }
    // fire should have propagated well past the seed cell
    expect(maxBurnX).toBeGreaterThanOrEqual(14)
  })
})

describe('heat field — water cycle', () => {
  it('boils water to steam near fire', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 14; y < 17; y++) s.paint(x, y, 0, Mat.WATER)
    s.paint(20, 17, 0, Mat.FIRE)
    s.paint(20, 18, 0, Mat.FIRE)
    expect(stepUntil(s, 200, () => countMat(s, Mat.STEAM) > 0)).toBe(true)
  })

  it('produces steam from a boiling column (condensation precondition)', () => {
    const s = fresh()
    for (let y = 5; y < 25; y++) s.paint(20, y, 0, Mat.WATER)
    s.paint(20, 25, 0, Mat.FIRE)
    s.paint(20, 26, 0, Mat.FIRE)
    expect(stepUntil(s, 800, () => countMat(s, Mat.STEAM) > 0)).toBe(true)
  })
})

describe('heat field — ice (melt & freeze)', () => {
  it('keeps ice frozen at rest (ambient 20 < meltPoint 40)', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 14; y < 17; y++) s.paint(x, y, 0, Mat.ICE)
    for (let i = 0; i < 200; i++) s.step()
    expect(countMat(s, Mat.ICE)).toBeGreaterThanOrEqual(14)
  })

  it('melts ice to water when surrounded by fire', () => {
    const s = fresh()
    s.paint(20, 15, 0, Mat.ICE)
    s.paint(21, 15, 0, Mat.FIRE)
    s.paint(19, 15, 0, Mat.FIRE)
    s.paint(20, 14, 0, Mat.FIRE)
    expect(stepUntil(s, 300, () => s.cells[idx(20, 15)] === Mat.WATER)).toBe(true)
  })

  it('grows by cold-freezing nearby water', () => {
    const s = fresh()
    for (let x = 10; x < 30; x++) for (let y = 18; y < 25; y++) s.paint(x, y, 0, Mat.WATER)
    for (let x = 19; x < 21; x++) for (let y = 20; y < 22; y++) s.paint(x, y, 0, Mat.ICE)
    const start = countMat(s, Mat.ICE)
    for (let i = 0; i < 600; i++) s.step()
    expect(countMat(s, Mat.ICE)).toBeGreaterThan(start)
  })
})

describe('heat field — lava (cool & persist)', () => {
  it('forms stone when quenched by water', () => {
    const s = fresh()
    for (let x = 10; x < 30; x++) for (let y = 16; y < 24; y++) s.paint(x, y, 0, Mat.WATER)
    for (let x = 18; x < 22; x++) for (let y = 10; y < 13; y++) s.paint(x, y, 0, Mat.LAVA)
    expect(stepUntil(s, 500, () => countMat(s, Mat.STONE) > 0)).toBe(true)
  })

  it('does NOT crust in open air (no coolant contact)', () => {
    const s = fresh()
    // a lava cell dropped down an empty column should reach the bottom molten,
    // never turning to stone mid-fall (air is not a coolant).
    s.paint(20, 2, 0, Mat.LAVA)
    for (let i = 0; i < 300; i++) s.step()
    expect(countMat(s, Mat.STONE)).toBe(0)
    expect(countMat(s, Mat.LAVA)).toBeGreaterThan(0)
  })

  it('keeps a contained pool interior molten', () => {
    const s = fresh()
    for (let x = 10; x <= 30; x++) s.paint(x, 25, 0, Mat.WALL)
    for (let y = 12; y <= 25; y++) {
      s.paint(10, y, 0, Mat.WALL)
      s.paint(30, y, 0, Mat.WALL)
    }
    for (let x = 12; x < 29; x++) for (let y = 14; y < 24; y++) s.paint(x, y, 0, Mat.LAVA)
    for (let i = 0; i < 60; i++) s.step()
    expect(s.cells[idx(20, 20)]).toBe(Mat.LAVA)
  })
})

describe('heat field — chunk culling', () => {
  it('lets chunks sleep once heat settles (idle cost returns to ~0)', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 12; y < 15; y++) s.paint(x, y, 0, Mat.SAND)
    for (let i = 0; i < 200; i++) s.step()
    expect(activeChunkCount(s)).toBe(0)
  })

  it('keeps a live source region awake', () => {
    const s = fresh()
    s.paint(20, 15, 1, Mat.LAVA)
    for (let i = 0; i < 50; i++) s.step()
    expect(activeChunkCount(s)).toBeGreaterThan(0)
  })
})
