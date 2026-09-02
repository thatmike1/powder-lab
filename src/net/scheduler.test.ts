import { describe, expect, it } from 'vitest'
import { INPUT_LOG_TICKS, type InputEvent, type StampedInput } from './protocol'
import { InputScheduler } from './scheduler'

const strike = (x: number): InputEvent => ({ type: 'strike', x, y: 0 })

function input(applyTick: number, seq: number, x = seq): StampedInput {
  return { event: strike(x), applyTick, seq, from: 'peer' }
}

const xs = (inputs: StampedInput[]): number[] =>
  inputs.map((i) => (i.event.type === 'strike' ? i.event.x : -1))

describe('InputScheduler', () => {
  it('holds an input until its apply tick', () => {
    const s = new InputScheduler()
    s.push(input(100, 1))
    expect(s.takeDue(99)).toEqual([])
    expect(s.pendingCount).toBe(1)
    expect(s.takeDue(100)).toHaveLength(1)
    expect(s.pendingCount).toBe(0)
  })

  it('orders by apply tick, then by seq inside a tick', () => {
    const s = new InputScheduler()
    s.push(input(101, 9, 9))
    s.push(input(100, 7, 7))
    s.push(input(100, 3, 3))
    s.push(input(100, 5, 5))
    expect(xs(s.takeDue(100))).toEqual([3, 5, 7])
    expect(xs(s.takeDue(101))).toEqual([9])
  })

  it('applies an input that arrived after its tick and counts it as late', () => {
    const s = new InputScheduler()
    s.push(input(100, 1))
    expect(s.takeDue(105)).toHaveLength(1)
    expect(s.late).toBe(1)
  })

  it('does not treat a seq gap as missing input', () => {
    const s = new InputScheduler()
    // a targeted setState consumed seq 2 in another peer's stream
    s.push(input(100, 1, 1))
    s.push(input(100, 3, 3))
    expect(xs(s.takeDue(100))).toEqual([1, 3])
  })

  it('replays remembered inputs newer than the rewind target, and only those', () => {
    const s = new InputScheduler()
    for (const seq of [1, 2, 3]) s.push(input(90 + seq * 10, seq, seq))
    for (const applied of s.takeDue(120)) s.remember(applied)
    expect(s.logCount).toBe(3)

    expect(s.requeueAfter(110)).toBe(1)
    expect(s.logCount).toBe(2)
    expect(xs(s.takeDue(120))).toEqual([3])
  })

  it('drops remembered inputs older than the replay window', () => {
    const s = new InputScheduler()
    s.push(input(10, 1))
    s.push(input(10 + INPUT_LOG_TICKS + 50, 2))
    for (const applied of s.takeDue(10 + INPUT_LOG_TICKS + 50)) s.remember(applied)
    s.prune(10 + INPUT_LOG_TICKS + 50)
    expect(s.logCount).toBe(1)
  })
})
