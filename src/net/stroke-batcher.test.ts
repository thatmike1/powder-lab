import { describe, expect, it } from 'vitest'
import type { PaintEvent } from './protocol'
import { FLUSH_MS, StrokeBatcher } from './stroke-batcher'

function collector() {
  const sent: PaintEvent[] = []
  const batcher = new StrokeBatcher({ send: (event) => sent.push(event) })
  return { sent, batcher }
}

describe('StrokeBatcher', () => {
  it('sends the first point of a stroke immediately', () => {
    const { sent, batcher } = collector()
    batcher.add(0, 1, 2, 4, 7)
    expect(sent).toEqual([{ type: 'paint', pts: [1, 2], r: 4, mat: 7 }])
  })

  it('coalesces a frame-rate stroke into one event per flush interval', () => {
    const { sent, batcher } = collector()
    // 60 Hz sampling for one second, the rate a held pointer paints at today
    for (let frame = 0; frame < 60; frame++) batcher.add(frame * 16.67, frame, frame, 4, 7)
    batcher.flush(1000)
    expect(sent.length).toBeLessThanOrEqual(21)
  })

  it('loses no sample: the points replay the stroke exactly', () => {
    const { sent, batcher } = collector()
    const drawn: number[] = []
    for (let frame = 0; frame < 60; frame++) {
      drawn.push(frame, frame * 2)
      batcher.add(frame * 16.67, frame, frame * 2, 4, 7)
    }
    batcher.flush(1000)
    const applied = sent.flatMap((event) => event.pts)
    expect(applied).toEqual(drawn)
  })

  it('flushes before the brush or material changes mid-stroke', () => {
    const { sent, batcher } = collector()
    batcher.add(0, 1, 1, 4, 7)
    batcher.add(1, 2, 2, 4, 7)
    batcher.add(2, 3, 3, 4, 9)
    expect(sent).toEqual([
      { type: 'paint', pts: [1, 1], r: 4, mat: 7 },
      { type: 'paint', pts: [2, 2], r: 4, mat: 7 },
    ])
    batcher.flush(3)
    expect(sent[2]).toEqual({ type: 'paint', pts: [3, 3], r: 4, mat: 9 })
  })

  it('emits nothing when there is nothing pending', () => {
    const { sent, batcher } = collector()
    batcher.poll(1000)
    batcher.flush(1000)
    expect(sent).toEqual([])
  })

  it('flushes a held-still faucet on the interval without new samples', () => {
    const { sent, batcher } = collector()
    batcher.add(0, 5, 5, 4, 7) // first point goes out at once
    batcher.add(1, 5, 5, 4, 7)
    batcher.poll(1 + FLUSH_MS / 2)
    expect(sent).toHaveLength(1)
    batcher.poll(1 + FLUSH_MS)
    expect(sent).toHaveLength(2)
  })

  it('drops the stroke on reset', () => {
    const { sent, batcher } = collector()
    batcher.add(0, 1, 1, 4, 7)
    batcher.add(1, 2, 2, 4, 7)
    batcher.reset()
    batcher.flush(1000)
    expect(sent).toHaveLength(1)
  })
})
