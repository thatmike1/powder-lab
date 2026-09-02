import { describe, expect, it } from 'vitest'
import { Mat } from '../sim/materials'
import { Simulation } from '../sim/Simulation'
import type { MagnetEvent } from './protocol'
import { applyPointEvent } from './session'
import { MagnetBatcher } from './stroke-batcher'

const W = 40
const H = 30
const FRAME_MS = 1000 / 60
// a short pull: long enough to move the pile, short enough that it has not yet
// reached the pointer and saturated, which is where a strength difference shows
const FRAMES = 10

/** a settled pile of filings on the left, with the pointer pulling from the right */
function pile(): Simulation {
  const sim = new Simulation(W, H)
  for (let x = 6; x < 12; x++) for (let y = 26; y < 29; y++) sim.paint(x, y, 0, Mat.FILINGS)
  for (let i = 0; i < 30; i++) sim.step()
  return sim
}

/** centre of mass of the filings along x, the thing a pull moves */
function comX(sim: Simulation): number {
  let sum = 0
  let n = 0
  for (let k = 0; k < W * H; k++) {
    if (sim.cells[k] === Mat.FILINGS) {
      sum += k % W
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

/** offline: every sampled frame applies the force directly */
function offlinePull(): number {
  const sim = pile()
  const before = comX(sim)
  for (let frame = 0; frame < FRAMES; frame++) {
    sim.step()
    sim.magnet(22, 28, 18, true)
  }
  return comX(sim) - before
}

/** in a room: samples batch onto the wire and apply in order at the flush tick */
function batchedPull(): { moved: number; events: number } {
  const sim = pile()
  const before = comX(sim)
  const queue: MagnetEvent[] = []
  const batcher = new MagnetBatcher({
    send: (event) => {
      queue.push(event)
      return true
    },
  })
  let events = 0
  for (let frame = 0; frame < FRAMES; frame++) {
    sim.step()
    const now = frame * FRAME_MS
    batcher.add(now, 22, 28, 18, true)
    batcher.poll(now)
    while (queue.length > 0) {
      const event = queue.shift()
      if (event) applyPointEvent(sim, event)
      events++
    }
  }
  batcher.flush(FRAMES * FRAME_MS)
  while (queue.length > 0) {
    const event = queue.shift()
    if (event) applyPointEvent(sim, event)
    events++
  }
  return { moved: comX(sim) - before, events }
}

/** the regression: one sample per flush interval, the rest thrown away */
function throttledPull(): number {
  const sim = pile()
  const before = comX(sim)
  let last = Number.NEGATIVE_INFINITY
  for (let frame = 0; frame < FRAMES; frame++) {
    sim.step()
    const now = frame * FRAME_MS
    if (now - last < 50) continue
    last = now
    sim.magnet(22, 28, 18, true)
  }
  return comX(sim) - before
}

describe('magnet pull strength', () => {
  it('pulls as hard in a room as it does offline', () => {
    const offline = offlinePull()
    const batched = batchedPull()
    expect(offline).toBeGreaterThan(1)
    // same number of magnet() calls, same order — only the grouping differs
    expect(Math.abs(batched.moved - offline)).toBeLessThan(offline * 0.1)
    expect(batched.events).toBeLessThanOrEqual(Math.ceil((FRAMES * FRAME_MS) / 50) + 1)
  })

  it('is markedly weaker when samples are throttled instead of batched', () => {
    // this is what the old throttle did, and why batching had to replace it
    expect(throttledPull()).toBeLessThan(offlinePull() * 0.6)
  })
})
