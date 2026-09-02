import { describe, expect, it } from 'vitest'
import { parseInputEvent } from './protocol'

describe('parseInputEvent', () => {
  it('accepts a single-segment paint', () => {
    expect(parseInputEvent({ type: 'paint', pts: [1, 2, 3, 4], r: 4, mat: 7 })).toEqual({
      type: 'paint',
      pts: [1, 2, 3, 4],
      r: 4,
      mat: 7,
    })
  })

  it('accepts a segmented paint whose counts match the points', () => {
    const raw = {
      type: 'paint',
      pts: [1, 1, 2, 2, 3, 3],
      r: 4,
      mat: 7,
      segs: [
        { n: 2, r: 4, mat: 7 },
        { n: 1, r: 6, mat: 9 },
      ],
    }
    expect(parseInputEvent(raw)).toEqual(raw)
  })

  it('rejects segments that do not partition the points', () => {
    const raw = {
      type: 'paint',
      pts: [1, 1, 2, 2],
      r: 4,
      mat: 7,
      segs: [{ n: 3, r: 4, mat: 7 }],
    }
    expect(parseInputEvent(raw)).toBeNull()
  })

  it('rejects a segment missing its material', () => {
    const raw = { type: 'paint', pts: [1, 1], r: 4, mat: 7, segs: [{ n: 1, r: 4 }] }
    expect(parseInputEvent(raw)).toBeNull()
  })

  it('accepts a magnet point list', () => {
    expect(parseInputEvent({ type: 'magnet', pts: [5, 6, 7, 8], r: 8, attract: true })).toEqual({
      type: 'magnet',
      pts: [5, 6, 7, 8],
      r: 8,
      attract: true,
    })
  })

  it('accepts a segmented magnet', () => {
    const raw = {
      type: 'magnet',
      pts: [5, 6, 7, 8],
      r: 8,
      attract: true,
      segs: [
        { n: 1, r: 8, attract: true },
        { n: 1, r: 12, attract: false },
      ],
    }
    expect(parseInputEvent(raw)).toEqual(raw)
  })

  it('rejects the old single-point magnet shape', () => {
    expect(parseInputEvent({ type: 'magnet', x: 5, y: 6, r: 8, attract: true })).toBeNull()
  })
})
