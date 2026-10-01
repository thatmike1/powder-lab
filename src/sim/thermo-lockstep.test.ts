import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { applyPointEvent } from '../net/session'
import { Simulation } from './Simulation'
import { Mat } from './materials'
import { decodeState, STATE_VERSION } from './state'

const W = 64, H = 48
function inputs(s: Simulation, tick: number): void {
  if (tick % 512 === 0) {
    for (let y = 18; y <= 30; y++) for (let x = 10; x <= 22; x++) {
      if (x === 10 || x === 22 || y === 18 || y === 30) s.paint(x, y, 0, Mat.GLASS)
      else s.paint(x, y, 0, y > 25 ? Mat.WATER : Mat.EMPTY)
    }
    s.paint(46, 42, 4, Mat.WOOD)
    s.paint(46, 42, 0, Mat.FIRE)
    s.paint(36, 40, 3, Mat.OIL)
    s.paint(5, 43, 2, Mat.SAND)
    s.paint(58, 43, 2, Mat.LAVA)
    s.paint(30, 16, 2, Mat.SAND)
    for (let k = 0; k < 5; k++) s.paint(30, 16, 3, Mat.HEAT)
    s.paint(32, 36, 2, Mat.WATER)
    s.paint(32, 36, 2, Mat.COOL)
  }
  if (tick % 64 === 0) applyPointEvent(s, {
    type: 'paint', pts: [16, 28, 16, 28, 36, 40, 32, 36], r: 4, mat: Mat.HEAT,
    segs: [{ n: 3, r: 4, mat: Mat.HEAT }, { n: 1, r: 2, mat: Mat.COOL }],
  })
  if (tick % 197 === 0) s.strike(40, 1)
  if (tick % 251 === 0) { s.paint(5, 30, 2, Mat.GUNPOWDER); s.paint(5, 30, 2, Mat.HEAT) }
  if (tick % 139 === 0) { s.paint(50, 8, 2, Mat.FILINGS); s.magnet(46, 12, 8, true) }
}

describe('thermodynamic lockstep', () => {
  it('stays byte-identical after every tick for 4096 ticks, including live reloads and render differences', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('unseeded randomness') })
    try {
      const a = new Simulation(W, H, 0xabc123), b = new Simulation(W, H, 0xabc123)
      const seen = new Set<number>()
      let hadPressure = false, hadPhase = false, hadFuel = false
      const ctx = document.createElement('canvas').getContext('2d')!
      for (let tick = 0; tick < 4096; tick++) {
        inputs(a, tick); inputs(b, tick)
        if (tick > 0 && tick % 701 === 0) {
          expect(b.loadState(a.serializeState())).toBe(true)
          const scratch = b as unknown as { heatNext: Float32Array; pressureNext: Uint16Array }
          scratch.heatNext.fill(-1337); scratch.pressureNext.fill(4095)
        }
        a.step(); b.step()
        if (tick % 43 === 0) { b.setShowTemp((tick & 1) !== 0); b.render(ctx, 2, true, true, 0.5) }
        expect(Buffer.compare(a.serializeState(), b.serializeState()), `tick ${tick}`).toBe(0)
        for (const m of a.cells) seen.add(m)
        hadPressure ||= a.pressure.some(p => p > 100)
        hadPhase ||= a.phase.some(p => p !== 0)
        hadFuel ||= a.burnFrom.some(m => m === Mat.WOOD)
      }
      for (const m of [Mat.WATER, Mat.ICE, Mat.STEAM, Mat.GLASS, Mat.FIRE, Mat.SMOKE]) expect(seen.has(m), `material ${m}`).toBe(true)
      expect(hadPressure && hadPhase && hadFuel).toBe(true)
      expect(a.checksum()).toBe(b.checksum())
    } finally { random.mockRestore() }
  })

  it('round-trips every persistent field through an offset byte view during active reactions', () => {
    const a = new Simulation(W, H, 21)
    inputs(a, 0); a.step(3)
    const bytes = a.serializeState(), padded = new Uint8Array(bytes.length + 13)
    padded.set(bytes, 7)
    const state = decodeState(padded.subarray(7, 7 + bytes.length))
    expect(state.version).toBe(STATE_VERSION)
    for (const key of ['heat', 'phase', 'fuel', 'burnFrom', 'pressure', 'stamp', 'active', 'activeNext'] as const) expect(state[key].length).toBeGreaterThan(0)
    const b = new Simulation(W, H, 999)
    expect(b.loadState(padded.subarray(7, 7 + bytes.length))).toBe(true)
    expect(b.serializeState()).toEqual(bytes)
    for (let tick = 3; tick < 1200; tick++) { inputs(a, tick); inputs(b, tick); a.step(); b.step() }
    expect(Buffer.compare(a.serializeState(), b.serializeState())).toBe(0)
  })

  it('rejects incompatible, invalid or truncated states without mutating the live sim', () => {
    const s = new Simulation(W, H, 12)
    const original = s.serializeState()
    const badVersion = original.slice(); badVersion[2] = 1
    const badMat = original.slice(); badMat[19] = Mat.HEAT
    const badHeat = original.slice()
    const heatOffset = 19 + 3 * W * H + 2 * Math.ceil(W / 16) * Math.ceil(H / 16) + 4 * W * H
    new DataView(badHeat.buffer).setFloat32(heatOffset, NaN, true)
    for (const bytes of [badVersion, badMat, badHeat, original.slice(0, -1)]) {
      expect(s.loadState(bytes)).toBe(false)
      expect(s.serializeState()).toEqual(original)
    }
  })

  it('checksums one quantum of temperature and hidden fuel/pressure/chunk state', () => {
    const a = new Simulation(W, H, 5), b = new Simulation(W, H, 5)
    for (const change of [() => { b.heat[0] += 1 / 16 }, () => { b.fuel[0]++ }, () => { b.pressure[0]++ }, () => { b.phase[0]++ }, () => {
      (b as unknown as { activeNext: Uint8Array }).activeNext[0] ^= 1
    }]) {
      b.loadState(a.serializeState()); change()
      expect(b.checksum()).not.toBe(a.checksum())
    }
  })
})
