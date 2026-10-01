import { describe, expect, it } from 'vitest'
import { Simulation } from './Simulation'
import { Mat } from './materials'

describe('latent heat and phase snapshots', () => {
  function chamber() {
    const s = new Simulation(32, 16, 4)
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) s.paint(x, y, 0, Mat.WALL)
    s.paint(6, 6, 0, Mat.EMPTY)
    return s
  }

  it('absorbs boiling heat at the boundary instead of flashing on a single crossing', () => {
    const s = chamber(), i = 6 * 32 + 6
    s.paint(6, 6, 0, Mat.WATER)
    s.heat[i] = 110
    s.step()
    expect(s.cells[i]).toBe(Mat.WATER)
    expect(s.phase[i]).toBeGreaterThan(0)
    expect(s.heat[i]).toBe(100)
    s.heat[i] = 220
    s.step()
    expect(s.cells[i]).toBe(Mat.STEAM)
    expect(s.heat[i]).toBeGreaterThanOrEqual(100)
    expect(s.phase[i]).toBe(0)
  })

  it('round-trips a partially melting cell and resumes exactly', () => {
    const a = chamber(), i = 6 * 32 + 6
    a.paint(6, 6, 0, Mat.ICE)
    a.heat[i] = 15
    a.step()
    expect(a.phase[i]).toBeGreaterThan(0)
    const b = new Simulation(32, 16, 999)
    expect(b.loadState(a.serializeState())).toBe(true)
    expect(b.serializeState()).toEqual(a.serializeState())
    a.step(200); b.step(200)
    expect(b.serializeState()).toEqual(a.serializeState())
    expect(a.cells[i]).toBe(Mat.WATER)
  })

  it('keeps sealed hot steam instead of deleting it by lifespan', () => {
    const s = chamber(), i = 6 * 32 + 6
    s.paint(6, 6, 0, Mat.STEAM)
    for (let tick = 0; tick < 500; tick++) { s.heat[i] = 120; s.step() }
    expect(s.cells[i]).toBe(Mat.STEAM)
  })
})
