import { describe, expect, it } from 'vitest'
import { shouldBuildSim } from './sim-lifetime'

describe('shouldBuildSim', () => {
  it('builds one on first mount', () => {
    expect(shouldBuildSim(false, null)).toBe(true)
  })

  it('rebuilds freely while single-player', () => {
    expect(shouldBuildSim(false, {})).toBe(true)
  })

  it('keeps a live room’s simulation if the mount effect re-runs', () => {
    expect(shouldBuildSim(true, {})).toBe(false)
  })

  it('still builds one if a room somehow has no simulation yet', () => {
    expect(shouldBuildSim(true, null)).toBe(true)
  })
})
