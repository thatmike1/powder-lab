import { describe, expect, it } from 'vitest'
import { Simulation } from './Simulation'
import { Mat } from './materials'
import { PRESETS } from './presets'

function scene(id: string) {
  const s = new Simulation(200, 150, 7)
  expect(s.restore(PRESETS.find((p) => p.id === id)!.build(200, 150))).toBe(true)
  return s
}

describe('playable thermal showcases', () => {
  it('the pressure cooker produces steam and fractures its glass', () => {
    const s = scene('pressure-cooker'),
      glass = s.cells.filter((m) => m === Mat.GLASS).length
    let steam = false,
      pressure = false
    for (let t = 0; t < 400; t++) {
      s.step()
      steam ||= s.cells.includes(Mat.STEAM)
      pressure ||= s.pressure.some((p) => p > 100)
      if (steam && pressure && s.cells.filter((m) => m === Mat.GLASS).length < glass) break
    }
    expect(steam && pressure).toBe(true)
    expect(s.cells.filter((m) => m === Mat.GLASS).length).toBeLessThan(glass)
  })

  it('the paired baths show boiling and freezing from powered sources', () => {
    const s = scene('hot-cold')
    let steam = false,
      ice = false
    for (let t = 0; t < 300; t++) {
      s.step()
      steam ||= s.cells.includes(Mat.STEAM)
      ice ||= s.cells.includes(Mat.ICE)
      if (steam && ice) break
    }
    expect(steam && ice).toBe(true)
    expect(s.cells.includes(Mat.HEATER) && s.cells.includes(Mat.COOLER)).toBe(true)
  })

  it('glassworks fuses sand and lets cooled lava solidify', () => {
    const s = scene('glassworks')
    for (let t = 0; t < 400 && !s.cells.includes(Mat.GLASS); t++) s.step()
    expect(s.cells.includes(Mat.GLASS)).toBe(true)
    const i = s.cells.indexOf(Mat.LAVA)
    s.paint(i % s.W, (i / s.W) | 0, 2, Mat.COOL)
    s.step()
    expect(s.cells.includes(Mat.STONE)).toBe(true)
  })
})
