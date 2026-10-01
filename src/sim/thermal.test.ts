import { describe, expect, it } from 'vitest'
import { Simulation } from './Simulation'
import { Mat } from './materials'
import { FACE, TEMP_SCALE } from './thermal'

describe('fixed-point thermal transport', () => {
  it('conducts symmetrically across a chunk border', () => {
    const s = new Simulation(32, 16, 8)
    s.paint(15, 8, 0, Mat.METAL)
    s.paint(16, 8, 0, Mat.METAL)
    s.heat[8 * 32 + 15] = 220
    s.step()
    expect(s.heat[8 * 32 + 16]).toBeGreaterThan(20)
    for (const t of s.heat) expect(Number.isInteger(t * TEMP_SCALE)).toBe(true)
    expect(FACE[16 * 20 + 4]).toBe(FACE[4 * 20 + 16])
  })

  it('carries the heat of a falling particle to its new cell', () => {
    const s = new Simulation(32, 16, 8)
    s.paint(8, 3, 0, Mat.SAND)
    s.heat[3 * 32 + 8] = 200
    s.step()
    expect(s.cells[4 * 32 + 8]).toBe(Mat.SAND)
    expect(s.heat[4 * 32 + 8]).toBeGreaterThan(100)
    expect(s.heat[3 * 32 + 8]).toBeLessThan(100)
  })

  it('wakes a sleeping neighbor when heat reaches a chunk edge', () => {
    const s = new Simulation(48, 16, 8)
    s.step(200)
    s.paint(15, 8, 0, Mat.FIRE)
    s.step(2)
    expect(s.heat[8 * 48 + 16]).toBeGreaterThan(20)
    const next = (s as unknown as { activeNext: Uint8Array }).activeNext
    expect(next[1]).toBe(1)
  })
})
