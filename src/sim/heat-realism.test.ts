import { describe, expect, it } from 'vitest'
import { Mat } from './materials'
import { Simulation } from './Simulation'

// CHARACTERIZATION SUITE for the heat-field + reaction realism pass.
//
// These tests encode the DESIRED steady states from the interaction review — not
// today's behavior. The targets that the current engine does NOT yet meet are
// written with `it.fails(...)`: vitest asserts the test currently FAILS, so this
// file stays green on `npm test` while documenting exactly what's broken.
//
// The feedback loop: when a fix lands and the behavior becomes correct, that
// `it.fails` test starts PASSING, which makes vitest report it as failing
// ("expected to fail but passed"). That's the signal to flip `it.fails` -> `it`.
// So a red line here == still-broken; a "failed to fail" == newly fixed, lock it.
//
// Guardrails for already-correct behavior live as plain `it(...)` here and in
// Simulation.test.ts (lava-never-crusts-in-air, ice-persists, water-cycle,
// chunk-sleep, ambient-relaxation, lone-flame-spreads are already covered there).

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

// ===========================================================================
// HEAT-FIELD TARGETS — the three owner-reported symptoms. RED until the
// coordinated heat rewrite (conductivity table + cooling term + lower DIFFUSE).
// ===========================================================================

describe('heat-field realism — targets (RED until the heat rewrite)', () => {
  // SYMPTOM #3: heat conducts through stone as if it were not there.
  // Desired: a stone wall insulates, so wood behind it does not ignite from a
  // lava pool on the far side. Today stone conducts like air and the wood cooks.
  it('a stone wall insulates wood from a lava pool behind it', () => {
    const s = fresh()
    for (let y = 8; y < 22; y++) {
      for (let x = 8; x < 12; x++) s.paint(x, y, 0, Mat.LAVA) // reservoir
      s.paint(12, y, 0, Mat.STONE) // 1-cell insulating wall
      s.paint(13, y, 0, Mat.WOOD) // protected wood, one cell behind the wall
    }
    const woodBefore = countMat(s, Mat.WOOD)
    for (let i = 0; i < 200; i++) s.step()
    // insulated: nearly all the wood survives, and the far face stays cool.
    expect(countMat(s, Mat.WOOD)).toBeGreaterThan(woodBefore - 2)
    expect(s.heat[idx(13, 15)]).toBeLessThan(ignitionFloor())
  })

  // SYMPTOM #2: interior hot pockets linger because the only heat sink is the
  // grid boundary. Desired: a lone 600-degree mass actively cools toward ambient.
  it('a lone hot mass cools toward ambient within 150 frames', () => {
    const s = fresh()
    // STONE so the mass does not fall (Eulerian heat stays put); override heat.
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.paint(x, y, 0, Mat.STONE)
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.heat[idx(x, y)] = 600
    for (let i = 0; i < 150; i++) s.step()
    expect(s.heat[idx(20, 15)]).toBeLessThan(40)
  })

  // SYMPTOM #1: heat permeates too far. A pinned lava pool superheats its whole
  // surroundings — measured 378 degrees a full 9 cells past the pool edge, since
  // the field neither attenuates with distance nor decays. Desired: a cooling
  // term + lower DIFFUSE keep the halo tight — far cells return to near ambient
  // while the cell right beside the pool stays hot.
  it('a lava pool keeps its heat halo local', () => {
    const s = fresh()
    // Lava is runny: a bare floor lets it spread across the whole width, which
    // would drag the source right up to any "far" cell. So PIN it in an
    // open-topped basin (side + bottom walls) and measure the halo decaying up
    // the open-air column above the pool — a genuinely stationary hot source.
    for (let y = 8; y <= 21; y++) {
      s.paint(16, y, 0, Mat.WALL)
      s.paint(24, y, 0, Mat.WALL)
    }
    for (let x = 16; x <= 24; x++) s.paint(x, 21, 0, Mat.WALL) // floor
    for (let x = 17; x <= 23; x++) for (let y = 16; y <= 20; y++) s.paint(x, y, 0, Mat.LAVA)
    for (let i = 0; i < 200; i++) s.step()
    expect(s.heat[idx(20, 7)]).toBeLessThan(50) // 9 cells above the pool: near ambient
    expect(s.heat[idx(20, 15)]).toBeGreaterThan(100) // 1 cell above the pool: still hot
  })
})

/** the lowest ignition point in play (gunpowder 120) — a clean "cool enough not
 * to ignite anything" ceiling, used by the insulation target. */
function ignitionFloor(): number {
  return 120
}

// ===========================================================================
// CONDUCTION — the flip side of insulation. The new CONDUCT table makes METAL a
// thermal bridge (0.9) and STONE an insulator (0.12), so the same scenario gives
// opposite results by material. Fully deterministic (no RNG in the heat path).
// ===========================================================================

describe('heat-field realism — conduction (metal bridges, stone insulates)', () => {
  it('metal conducts heat along a bar while stone insulates', () => {
    // pin one end of an 8-cell bar hot, then read 4 cells in. A 1-thick bar
    // bleeds heat to the surrounding air, so neither end stays scorching — but
    // metal carries the heat measurably further down the bar than stone does.
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

// ===========================================================================
// THERMAL THRESHOLD TARGETS — single-contact margins. RED until knob re-derive.
// ===========================================================================

describe('thermal thresholds — guardrails', () => {
  // REVIEW #9 flagged the lone-ice single-contact ceiling as landing exactly on
  // water's freezePoint (0). Calibration showed it actually drives the neighbor
  // BELOW 0 in practice — so this is a GUARDRAIL, not a target: ice stays cold
  // enough to freeze an adjacent cell, and the cooling term must not erode that.
  // (Lowering emitTemp[ICE] for extra margin remains an optional robustness nudge.)
  it('a single ice cell chills its neighbor below freezing', () => {
    const s = fresh()
    s.paint(20, 15, 0, Mat.ICE)
    for (let i = 0; i < 80; i++) s.step()
    expect(s.heat[idx(21, 15)]).toBeLessThan(0)
  })
})

// ===========================================================================
// REACTION TARGETS — independent fixes (snuff / wet gunpowder / glass / steam).
// ===========================================================================

describe('reaction realism — targets', () => {
  // REVIEW #6: a flame submerged in water should be QUENCHED fast — but snuff is
  // a probabilistic check for WATER only, and the fire boils its neighbors to
  // steam, so a fire body lingers ~60 frames and only dies by burnout (measured:
  // 13 of 25 cells still burning at frame 60). Desired: water quenches it quickly.
  it('a fire body submerged in water is quenched quickly', () => {
    const s = fresh()
    for (let x = 14; x < 27; x++) for (let y = 9; y < 22; y++) s.paint(x, y, 0, Mat.WATER)
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) s.paint(20 + dx, 15 + dy, 0, Mat.FIRE)
    expect(stepUntil(s, 20, () => countMat(s, Mat.FIRE) === 0)).toBe(true)
  })

  // REVIEW #7: wet gunpowder still detonates — water adjacency gives no shield.
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

  // REVIEW #11: steam condenses en masse in plain ambient air because its
  // condense threshold (40) sits above ambient (20). Desired: ambient steam
  // dissipates by lifespan instead of raining back down.
  it('steam in plain ambient air does not mass-condense to water', () => {
    const s = fresh()
    for (let x = 18; x < 23; x++) for (let y = 13; y < 18; y++) s.paint(x, y, 0, Mat.STEAM)
    for (let i = 0; i < 150; i++) s.step()
    expect(countMat(s, Mat.WATER)).toBeLessThan(3)
  })

  // REVIEW #8: lava + sand should make glass — the most-expected falling-sand
  // reaction. A sand cell touching a lava POOL reaches ~340 (a single contact
  // only ~198), so it crosses meltPoint[SAND] and fuses to GLASS at the contact
  // surface. Pinned in a basin so the lava stays seated on the sand bed.
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

// ===========================================================================
// NEW GUARDRAILS — already-correct invariants the tuning loop must not break.
// ===========================================================================

describe('guardrails — density (must stay green while tuning)', () => {
  // density OIL 22 < WATER 30 < ACID 36 must sort to oil-on-water-on-acid even
  // when poured inverted. Heat-field changes must never disturb displacement.
  it('three liquids layer by density (oil < water < acid)', () => {
    const s = fresh()
    // U-shaped basin so nothing drains off-grid.
    for (let x = 14; x <= 26; x++) s.paint(x, 24, 0, Mat.WALL)
    for (let y = 10; y <= 24; y++) {
      s.paint(14, y, 0, Mat.WALL)
      s.paint(26, y, 0, Mat.WALL)
    }
    // pour INVERTED (heaviest on top) and let density flip them.
    for (let x = 15; x < 26; x++) {
      for (let y = 11; y < 15; y++) s.paint(x, y, 0, Mat.ACID)
      for (let y = 15; y < 18; y++) s.paint(x, y, 0, Mat.WATER)
      for (let y = 18; y < 23; y++) s.paint(x, y, 0, Mat.OIL)
    }
    for (let i = 0; i < 400; i++) s.step()
    expect(meanY(s, Mat.OIL)).toBeLessThan(meanY(s, Mat.WATER))
    expect(meanY(s, Mat.WATER)).toBeLessThan(meanY(s, Mat.ACID))
  })

  // powders are intentionally NOT movable-by-others, so a denser powder never
  // sinks THROUGH a lighter one — sand stays atop gunpowder, no interleaving.
  it('powders do not sink through each other (sand rests on gunpowder)', () => {
    const s = fresh()
    // a 1-wide walled well so the powders stack instead of sliding off diagonally.
    for (let y = 21; y <= 25; y++) {
      s.paint(19, y, 0, Mat.WALL)
      s.paint(21, y, 0, Mat.WALL)
    }
    s.paint(20, 25, 0, Mat.WALL) // floor
    s.paint(20, 22, 0, Mat.SAND) // sand above...
    s.paint(20, 23, 0, Mat.GUNPOWDER) // ...gunpowder
    for (let i = 0; i < 60; i++) s.step()
    // they settle in painted order: sand stays the higher cell, never sinks through.
    expect(firstY(s, Mat.SAND)).toBeLessThan(firstY(s, Mat.GUNPOWDER))
  })
})
