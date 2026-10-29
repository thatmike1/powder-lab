import { describe, expect, it } from 'vitest'
import { Mat } from './materials'
import { Simulation } from './Simulation'

// Behavior regressions for transport, finite cold energy, condensation and density.

const W = 40
const H = 30
const idx = (x: number, y: number) => y * W + x
const fresh = () => new Simulation(W, H)

function countMat(s: Simulation, mat: number): number {
  let c = 0
  for (let k = 0; k < W * H; k++) if (s.cells[k] === mat) c++
  return c
}

/** mean y of all cells of `mat` (centre of mass vertically), or -1 if none. */
function meanY(s: Simulation, mat: number): number {
  let sum = 0
  let n = 0
  for (let k = 0; k < W * H; k++) {
    if (s.cells[k] === mat) {
      sum += (k / W) | 0
      n++
    }
  }
  return n ? sum / n : -1
}

/** y of the (single) cell of `mat`, or -1. */
function firstY(s: Simulation, mat: number): number {
  for (let k = 0; k < W * H; k++) if (s.cells[k] === mat) return (k / W) | 0
  return -1
}

function stepUntil(s: Simulation, max: number, predicate: () => boolean): boolean {
  for (let i = 0; i < max; i++) {
    s.step()
    if (predicate()) return true
  }
  return false
}

describe('heat transport and ambient cooling', () => {
  it('a stone wall insulates wood from a lava pool behind it', () => {
    const s = fresh()
    // a two-cell wall rising well above the pool: a single cell against an
    // endless 1100-degree reservoir passes enough heat to char wood eventually,
    // and hot air spilling over a wall's top may legitimately light it too.
    for (let y = 1; y < 8; y++) for (let x = 12; x <= 13; x++) s.paint(x, y, 0, Mat.STONE)
    // contain the reservoir, so the lava cannot drain away and pool under the wood.
    for (let x = 7; x <= 14; x++) s.paint(x, 22, 0, Mat.WALL)
    for (let y = 8; y < 22; y++) s.paint(7, y, 0, Mat.WALL)
    for (let y = 8; y < 22; y++) {
      for (let x = 8; x < 12; x++) s.paint(x, y, 0, Mat.LAVA) // reservoir
      for (let x = 12; x <= 13; x++) s.paint(x, y, 0, Mat.STONE) // insulating wall
      s.paint(14, y, 0, Mat.WOOD) // protected wood, behind the wall
    }
    const woodBefore = countMat(s, Mat.WOOD)
    for (let i = 0; i < 200; i++) s.step()
    expect(countMat(s, Mat.WOOD)).toBeGreaterThan(woodBefore - 2)
    expect(s.heat[idx(14, 15)]).toBeLessThan(ignitionFloor())
  })

  it('a hot mass holds its heat and cools from the outside in', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.paint(x, y, 0, Mat.STONE)
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.heat[idx(x, y)] = 600
    for (let i = 0; i < 150; i++) s.step()
    const core = s.heat[idx(20, 15)],
      corner = s.heat[idx(18, 13)]
    expect(core).toBeGreaterThan(300) // stone stores heat; the room does not drain its core
    expect(corner).toBeLessThan(core - 200) // the exposed surface cools first
    for (let i = 0; i < 1350; i++) s.step()
    expect(s.heat[idx(20, 15)]).toBeLessThan(40) // and it does reach the room
  })

  it('a lava pool sends its heat up as a plume, not sideways', () => {
    const s = fresh()
    for (let y = 8; y <= 21; y++) {
      s.paint(16, y, 0, Mat.WALL)
      s.paint(24, y, 0, Mat.WALL)
    }
    for (let x = 16; x <= 24; x++) s.paint(x, 21, 0, Mat.WALL) // floor
    for (let x = 17; x <= 23; x++) for (let y = 16; y <= 20; y++) s.paint(x, y, 0, Mat.LAVA)
    for (let i = 0; i < 200; i++) s.step()
    expect(s.heat[idx(20, 7)]).toBeGreaterThan(80) // 9 cells above the pool: the plume
    expect(s.heat[idx(10, 15)]).toBeLessThan(30) // beside the vessel: room air
    expect(Math.max(...s.heat)).toBeLessThanOrEqual(1100) // nothing hotter than the source
  })
})

/** the lowest ignition point in play (gunpowder 120) — a clean "cool enough not
 * to ignite anything" ceiling, used by the insulation target. */
function ignitionFloor(): number {
  return 120
}

describe('heat-field realism — conduction (metal bridges, stone insulates)', () => {
  it('metal conducts heat along a bar while stone insulates', () => {
    const farHeat = (mat: number): number => {
      const s = fresh()
      for (let x = 15; x <= 22; x++) s.paint(x, 15, 0, mat)
      for (let i = 0; i < 150; i++) {
        s.heat[idx(15, 15)] = 600 // re-pin the hot end each frame
        s.step()
      }
      return s.heat[idx(19, 15)] // 4 cells in from the hot end
    }
    const metal = farHeat(Mat.METAL)
    const stone = farHeat(Mat.STONE)
    expect(metal).toBeGreaterThan(40) // metal bridges the heat down the bar
    expect(stone).toBeLessThan(30) // stone barely passes it — near ambient
    expect(metal).toBeGreaterThan(stone)
  })
})

describe('thermal thresholds — guardrails', () => {
  it('ice transfers a finite chill to its neighbor and warms up', () => {
    const s = fresh()
    s.paint(20, 15, 0, Mat.ICE)
    s.step(3)
    expect(s.heat[idx(21, 15)]).toBeLessThan(20)
    s.step(200)
    expect(s.heat[idx(21, 15)]).toBe(20)
  })
})

describe('reaction regressions', () => {
  it('a fire body submerged in water is quenched quickly', () => {
    const s = fresh()
    for (let x = 14; x < 27; x++) for (let y = 9; y < 22; y++) s.paint(x, y, 0, Mat.WATER)
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) s.paint(20 + dx, 15 + dy, 0, Mat.FIRE)
    expect(stepUntil(s, 20, () => countMat(s, Mat.FIRE) === 0)).toBe(true)
  })

  it('gunpowder surrounded by water does not detonate when heated', () => {
    const s = fresh()
    s.paint(20, 15, 0, Mat.GUNPOWDER)
    s.paint(19, 15, 0, Mat.WATER)
    s.paint(21, 15, 0, Mat.WATER)
    s.paint(20, 14, 0, Mat.WATER)
    s.paint(20, 16, 0, Mat.WATER)
    s.heat[idx(20, 15)] = 200 // well past gunpowder's 120 ignition point
    s.step()
    expect(s.cells[idx(20, 15)]).toBe(Mat.GUNPOWDER) // wet: still inert
  })

  it('steam cools and condenses in ambient air, retaining water mass', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.paint(x, y, 0, Mat.STEAM)
    for (let i = 0; i < 150; i++) s.step()
    expect(countMat(s, Mat.WATER)).toBe(25)
    expect(countMat(s, Mat.STEAM)).toBe(0)
  })

  it('sand under a lava pool melts to glass', () => {
    const s = fresh()
    for (let y = 10; y <= 22; y++) {
      s.paint(13, y, 0, Mat.WALL)
      s.paint(27, y, 0, Mat.WALL)
    }
    for (let x = 13; x <= 27; x++) s.paint(x, 22, 0, Mat.WALL) // floor
    for (let x = 14; x <= 26; x++) for (let y = 18; y <= 21; y++) s.paint(x, y, 0, Mat.SAND) // bed
    for (let x = 14; x <= 26; x++) for (let y = 12; y <= 16; y++) s.paint(x, y, 0, Mat.LAVA) // pool
    for (let i = 0; i < 400; i++) s.step()
    expect(countMat(s, Mat.GLASS)).toBeGreaterThan(0)
  })
})

describe('guardrails — density (must stay green while tuning)', () => {
  it('three liquids layer by density (oil < water < acid)', () => {
    const s = fresh()
    for (let x = 14; x <= 26; x++) s.paint(x, 24, 0, Mat.WALL)
    for (let y = 10; y <= 24; y++) {
      s.paint(14, y, 0, Mat.WALL)
      s.paint(26, y, 0, Mat.WALL)
    }
    for (let x = 15; x < 26; x++) {
      for (let y = 11; y < 15; y++) s.paint(x, y, 0, Mat.ACID)
      for (let y = 15; y < 18; y++) s.paint(x, y, 0, Mat.WATER)
      for (let y = 18; y < 23; y++) s.paint(x, y, 0, Mat.OIL)
    }
    for (let i = 0; i < 400; i++) s.step()
    expect(meanY(s, Mat.OIL)).toBeLessThan(meanY(s, Mat.WATER))
    expect(meanY(s, Mat.WATER)).toBeLessThan(meanY(s, Mat.ACID))
  })

  it('powders do not sink through each other (sand rests on gunpowder)', () => {
    const s = fresh()
    for (let y = 21; y <= 25; y++) {
      s.paint(19, y, 0, Mat.WALL)
      s.paint(21, y, 0, Mat.WALL)
    }
    s.paint(20, 25, 0, Mat.WALL) // floor
    s.paint(20, 22, 0, Mat.SAND) // sand above...
    s.paint(20, 23, 0, Mat.GUNPOWDER) // ...gunpowder
    for (let i = 0; i < 60; i++) s.step()
    expect(firstY(s, Mat.SAND)).toBeLessThan(firstY(s, Mat.GUNPOWDER))
  })
})
