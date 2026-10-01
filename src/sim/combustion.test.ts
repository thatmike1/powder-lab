import { describe, expect, it } from 'vitest'
import { Simulation } from './Simulation'
import { FUEL, Mat } from './materials'

describe('finite combustion', () => {
  it('ignites hot wood, burns in place, consumes fuel and produces smoke', () => {
    const s = new Simulation(32, 24, 4),
      i = 12 * 32 + 16
    s.paint(16, 12, 0, Mat.WOOD)
    for (let t = 0; t < 20 && s.cells[i] !== Mat.FIRE; t++) {
      s.heat[i] = 600
      s.step()
    }
    expect(s.cells[i]).toBe(Mat.FIRE)
    expect(s.fuel[i]).toBe(FUEL[Mat.WOOD])
    s.step(20)
    expect(s.cells[i]).toBe(Mat.FIRE)
    expect(s.fuel[i]).toBeLessThan(FUEL[Mat.WOOD])
    expect(s.heat[i]).toBeGreaterThan(1000)
    let smoke = false
    for (let t = 0; t < 300; t++) {
      s.step()
      smoke ||= s.cells.includes(Mat.SMOKE)
    }
    expect(smoke).toBe(true)
    expect(s.cells.includes(Mat.FIRE)).toBe(false)
    expect(s.fuel[i]).toBe(0)
  })

  it('does not wrap the last tick of a painted flame into another lifetime', () => {
    const s = new Simulation(16, 16, 9)
    s.paint(8, 8, 0, Mat.FIRE)
    s.fuel[8 * 16 + 8] = 1
    s.step(3)
    expect(s.cells.includes(Mat.FIRE)).toBe(false)
  })

  it('restores partially spent solid fuel and resumes the same burn', () => {
    const a = new Simulation(32, 24, 4)
    a.paint(16, 12, 2, Mat.WOOD)
    a.paint(16, 12, 0, Mat.FIRE)
    a.step(30)
    const b = new Simulation(32, 24, 91)
    expect(b.loadState(a.serializeState())).toBe(true)
    a.step(400)
    b.step(400)
    expect(b.serializeState()).toEqual(a.serializeState())
  })
})
