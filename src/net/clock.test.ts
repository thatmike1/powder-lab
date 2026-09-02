import { describe, expect, it } from 'vitest'
import { CLOCK_WINDOW, TickClock } from './clock'
import { TICK_MS } from './protocol'

describe('TickClock', () => {
  it('is not ready before a joined frame anchors it', () => {
    const clock = new TickClock()
    expect(clock.ready).toBe(false)
    clock.start(10_000, 100, 5_000)
    expect(clock.ready).toBe(true)
  })

  it('reads the room tick straight back from the joined frame', () => {
    const clock = new TickClock()
    clock.start(10_000, 750, 10_000)
    expect(clock.serverTick(10_000)).toBe(750)
    // one tick of local time later, one tick further on
    expect(clock.serverTick(10_000 + TICK_MS)).toBe(751)
  })

  it('carries a constant local clock skew through to the tick estimate', () => {
    const clock = new TickClock()
    // the local clock runs 5 s behind the server's
    clock.start(10_000, 750, 5_000)
    expect(clock.offset).toBe(5_000)
    expect(clock.serverTick(5_000)).toBe(750)
    expect(clock.serverTick(5_000 + 100 * TICK_MS)).toBe(850)
  })

  it('takes the minimum sample so a slow frame cannot drag the estimate', () => {
    const clock = new TickClock()
    clock.start(10_000, 750, 10_000) // offset sample 0
    clock.sample(11_000, 10_800) // 200 ms of extra delay in this frame
    clock.sample(12_000, 11_900) // 100 ms
    expect(clock.offset).toBe(0)
    expect(clock.serverTick(10_000)).toBe(750)
  })

  it('follows the clock once every stale sample has left the window', () => {
    const clock = new TickClock()
    clock.start(10_000, 0, 10_000)
    for (let i = 1; i <= CLOCK_WINDOW; i++) clock.sample(10_000 + i + 40, 10_000 + i)
    expect(clock.offset).toBe(40)
  })

  it('forgets everything on reset', () => {
    const clock = new TickClock()
    clock.start(10_000, 750, 10_000)
    clock.reset()
    expect(clock.ready).toBe(false)
  })
})
