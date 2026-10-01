import { describe, expect, it } from 'vitest'
import { Simulation } from './Simulation'
import { Mat } from './materials'

function vessel(shell: number, vent = false) {
  const s = new Simulation(40, 30, 8)
  for (let y = 10; y <= 18; y++) for (let x = 12; x <= 20; x++) {
    if (x === 12 || x === 20 || y === 10 || y === 18) s.paint(x, y, 0, shell)
    else s.paint(x, y, 0, Mat.STEAM)
  }
  if (vent) for (let x = 13; x < 20; x++) s.paint(x, 10, 0, Mat.EMPTY)
  return s
}

describe('gas pressure', () => {
  it('breaks a sealed glass boiler and leaves indestructible walls intact', () => {
    const s = vessel(Mat.GLASS)
    const before = s.cells.filter(m => m === Mat.GLASS).length
    s.step(10)
    expect(s.cells.filter(m => m === Mat.GLASS).length).toBeLessThan(before)
    const w = vessel(Mat.WALL), walls = w.cells.filter(m => m === Mat.WALL).length
    w.step(100)
    expect(w.cells.filter(m => m === Mat.WALL).length).toBe(walls)
  })

  it('lets open steam vent while a sealed vessel accumulates pressure', () => {
    const sealed = vessel(Mat.WALL), open = vessel(Mat.WALL, true)
    for (let t = 0; t < 120; t++) {
      for (const s of [sealed, open]) {
        for (let i = 0; i < s.cells.length; i++) if (s.cells[i] === Mat.STEAM) s.heat[i] = 160
        s.step()
      }
    }
    expect(Math.max(...sealed.pressure)).toBeGreaterThan(Math.max(...open.pressure) * 2)
  })

  it('pressurizes a burning sealed pocket', () => {
    const s = vessel(Mat.WALL)
    for (let y = 11; y < 18; y++) for (let x = 13; x < 20; x++) s.paint(x, y, 0, Mat.EMPTY)
    s.pressure.fill(0)
    s.paint(16, 14, 2, Mat.FIRE)
    s.step(20)
    expect(Math.max(...s.pressure)).toBeGreaterThan(100)
  })

  it('bursts glass when enclosed liquid boils into expanding steam', () => {
    const s = vessel(Mat.GLASS)
    for (let y = 11; y < 18; y++) for (let x = 13; x < 20; x++) {
      s.paint(x, y, 0, Mat.WATER)
      s.heat[y * s.W + x] = 400
    }
    const glass = s.cells.filter(m => m === Mat.GLASS).length
    let steam = false
    for (let t = 0; t < 20; t++) { s.step(); steam ||= s.cells.includes(Mat.STEAM) }
    expect(steam).toBe(true)
    expect(s.cells.filter(m => m === Mat.GLASS).length).toBeLessThan(glass)
  })

  it('round-trips live pressure and continues byte-identically', () => {
    const a = vessel(Mat.WALL)
    a.step(3)
    expect(Math.max(...a.pressure)).toBeGreaterThan(0)
    const b = new Simulation(40, 30, 77)
    expect(b.loadState(a.serializeState())).toBe(true)
    a.step(250); b.step(250)
    expect(b.serializeState()).toEqual(a.serializeState())
  })
})
