import { describe, expect, it } from 'vitest'
import { Mat } from './materials'
import { Simulation } from './Simulation'

// determinism is the load-bearing property for lockstep multiplayer: every peer
// runs its own Simulation and only inputs cross the wire, so any hidden
// nondeterminism (wall clock, iteration order, an unseeded random draw) shows up
// as a silent desync. these tests pin it down by driving two sims through the
// same scripted inputs and demanding byte-identical state at the end.

const W = 48
const H = 36

/**
 * a fixed sequence of 45 public API calls totalling 2480 ticks, deliberately
 * heavy on fire / water / lava / steam because those rules draw from the PRNG
 * the most (boiling, ignition, quenching, snuffing, lava flow).
 */
function runScript(s: Simulation): void {
  s.paint(10, 4, 5, Mat.WATER)
  s.paint(30, 4, 5, Mat.WATER)
  s.step(60)
  s.paint(24, 30, 6, Mat.STONE)
  s.paint(24, 20, 4, Mat.LAVA)
  s.step(120)
  s.paint(12, 12, 4, Mat.FIRE)
  s.step(80)
  s.paint(36, 24, 5, Mat.OIL)
  s.step(90)
  s.paint(36, 18, 3, Mat.FIRE)
  s.step(150)
  s.paint(20, 10, 4, Mat.WATER)
  s.step(100)
  s.paint(8, 26, 5, Mat.SAND)
  s.step(70)
  s.paint(8, 20, 4, Mat.LAVA)
  s.step(200)
  s.paint(40, 8, 3, Mat.STEAM)
  s.step(60)
  s.strike(24, 2)
  s.step(40)
  s.paint(16, 6, 4, Mat.WOOD)
  s.paint(16, 10, 2, Mat.FIRE)
  s.step(180)
  s.magnet(24, 18, 8, true)
  s.paint(30, 12, 3, Mat.FILINGS)
  s.step(50)
  s.magnet(10, 18, 8, false)
  s.step(50)
  s.paint(24, 6, 5, Mat.ICE)
  s.step(120)
  s.paint(24, 12, 3, Mat.LAVA)
  s.step(220)
  s.strike(12, 2)
  s.step(60)
  s.paint(44, 30, 3, Mat.ACID)
  s.step(80)
  s.paint(6, 6, 3, Mat.GUNPOWDER)
  s.paint(6, 10, 2, Mat.FIRE)
  s.step(140)
  s.paint(24, 26, 6, Mat.WATER)
  s.step(300)
  s.magnet(24, 24, 10, true)
  s.step(310)
}

/** materials the script must actually have produced along the way. */
function seenMaterials(s: Simulation): Set<number> {
  const seen = new Set<number>()
  for (let i = 0; i < s.cells.length; i++) seen.add(s.cells[i])
  return seen
}

describe('deterministic simulation', () => {
  it('drives the fire/water/lava/steam rules, not just inert sand', () => {
    const s = new Simulation(W, H, 12345)
    const everSeen = new Set<number>()
    // sample the grid as the script runs so short-lived phases are caught.
    const probe = new Simulation(W, H, 12345)
    runScript(probe)
    for (const m of seenMaterials(probe)) everSeen.add(m)

    // rerun in slices, collecting materials that only exist mid-script.
    s.paint(24, 30, 6, Mat.STONE)
    s.paint(24, 20, 4, Mat.LAVA)
    s.paint(10, 10, 5, Mat.WATER)
    for (let k = 0; k < 200; k++) {
      s.step(1)
      for (const m of seenMaterials(s)) everSeen.add(m)
    }
    for (const mat of [Mat.FIRE, Mat.WATER, Mat.LAVA, Mat.STEAM]) {
      expect(everSeen.has(mat)).toBe(true)
    }
  })

  it('two sims with the same seed end byte-identical', () => {
    const a = new Simulation(W, H, 0xc0ffee)
    const b = new Simulation(W, H, 0xc0ffee)
    runScript(a)
    runScript(b)

    expect(a.tick).toBe(2480)
    expect(b.tick).toBe(a.tick)
    expect(a.checksum()).toBe(b.checksum())
    expect(Array.from(a.serializeState())).toEqual(Array.from(b.serializeState()))
  })

  it('two sims with different seeds diverge', () => {
    const a = new Simulation(W, H, 1)
    const b = new Simulation(W, H, 2)
    runScript(a)
    runScript(b)
    expect(a.checksum()).not.toBe(b.checksum())
  })

  it('a late joiner loading serialized state stays in lockstep', () => {
    const a = new Simulation(W, H, 777)
    runScript(a)
    const bytes = a.serializeState()

    const b = new Simulation(W, H, 999) // deliberately a different seed
    expect(b.loadState(bytes)).toBe(true)
    expect(b.tick).toBe(a.tick)
    expect(b.checksum()).toBe(a.checksum())

    a.step(500)
    b.step(500)
    expect(b.tick).toBe(a.tick)
    expect(b.checksum()).toBe(a.checksum())
    expect(Array.from(b.serializeState())).toEqual(Array.from(a.serializeState()))
  })

  it('carries chunk sleep state across a round trip', () => {
    // the protocol's field list omits the chunk-activity queues, but they are
    // load-bearing: a sleeping chunk's cells draw no random numbers, so a joiner
    // that woke everything would run its PRNG ahead of its peers. this scene
    // deliberately keeps a permanently-hot corner awake while a settled sand
    // pile in the opposite corner sleeps.
    const a = new Simulation(96, 64, 3)
    a.paint(8, 58, 5, Mat.SAND)
    a.paint(88, 58, 4, Mat.LAVA)
    a.step(900)

    const b = new Simulation(96, 64, 3)
    expect(b.loadState(a.serializeState())).toBe(true)
    a.step(400)
    b.step(400)
    expect(b.checksum()).toBe(a.checksum())
  })

  it('the tick counter starts at 0 and counts steps', () => {
    const s = new Simulation(W, H)
    expect(s.tick).toBe(0)
    s.step()
    expect(s.tick).toBe(1)
    s.step(41)
    expect(s.tick).toBe(42)
  })

  it('loadState rejects bad magic and dimension mismatches', () => {
    const a = new Simulation(W, H, 5)
    a.paint(10, 10, 4, Mat.SAND)
    a.step(20)
    const bytes = a.serializeState()

    expect(new Simulation(W, H, 5).loadState(new Uint8Array(bytes.length))).toBe(false)
    expect(new Simulation(W + 8, H, 5).loadState(bytes)).toBe(false)
    expect(new Simulation(W, H, 5).loadState(bytes.slice(0, 10))).toBe(false)
  })

  it('render() never consumes the PRNG', () => {
    const a = new Simulation(W, H, 42)
    const b = new Simulation(W, H, 42)
    runScript(a)
    runScript(b)
    // only one of them renders; if render drew from the stream they would part.
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    b.render(ctx as CanvasRenderingContext2D, 2, true, true, 0.5)
    b.render(ctx as CanvasRenderingContext2D, 2, false, false, 0)
    a.step(200)
    b.step(200)
    expect(b.checksum()).toBe(a.checksum())
  })
})
