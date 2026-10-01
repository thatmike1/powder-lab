import { describe, expect, it } from 'vitest'
import { Mat } from '../sim/materials'
import { Simulation } from '../sim/Simulation'
import { applyPointEvent } from './session'
import { StrokeBatcher } from './stroke-batcher'

describe('thermal brush lockstep path', () => {
  it('batches heat/cool/material changes without losing samples or storing tool IDs', () => {
    const a = new Simulation(32, 24, 4),
      b = new Simulation(32, 24, 4)
    const batches: Parameters<typeof applyPointEvent>[1][] = []
    const batcher = new StrokeBatcher({
      send: (e) => {
        batches.push(e)
        return true
      },
    })
    const mats = [Mat.WATER, Mat.HEAT, Mat.HEAT, Mat.COOL, Mat.HEAT]
    mats.forEach((m, i) => {
      a.paint(10, 10, 2, m)
      batcher.add(i * 5, 10, 10, 2, m)
    })
    batcher.flush(50)
    expect(batches.length).toBe(2)
    for (const e of batches) applyPointEvent(b, e)
    expect(b.serializeState()).toEqual(a.serializeState())
    expect(b.cells.includes(Mat.HEAT) || b.cells.includes(Mat.COOL)).toBe(false)
    a.step(100)
    b.step(100)
    expect(b.serializeState()).toEqual(a.serializeState())
  })

  it('wakes settled cold/warm material, caps temperatures and preserves walls', () => {
    const s = new Simulation(32, 24, 4)
    s.paint(10, 10, 0, Mat.METAL)
    s.paint(11, 10, 0, Mat.WALL)
    s.step(200)
    for (let k = 0; k < 100; k++) s.paint(10, 10, 2, Mat.HEAT)
    expect(s.heat[10 * 32 + 10]).toBe(2400)
    expect(s.heat[10 * 32 + 11]).toBe(20)
    s.paint(10, 10, 2, Mat.COOL)
    s.paint(10, 10, 2, Mat.COOL)
    expect(s.heat[10 * 32 + 10]).toBe(-160)
    s.step()
    expect(s.heat[10 * 32 + 10]).toBeGreaterThan(-160)
  })

  it('cools a lava particle into stone without requiring water contact', () => {
    const s = new Simulation(32, 24, 4)
    s.paint(10, 10, 0, Mat.LAVA)
    s.paint(10, 10, 0, Mat.COOL)
    s.step()
    expect(s.cells[10 * 32 + 10]).toBe(Mat.STONE)
  })
})
