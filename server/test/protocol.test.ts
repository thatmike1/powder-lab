import { describe, expect, it } from 'vitest'
import { exceedsMessageByteCap, MAX_MESSAGE_BYTES, parseClientMessage } from '../src/protocol.ts'

describe('exceedsMessageByteCap', () => {
  it('measures bytes, not utf-16 code units', () => {
    expect(exceedsMessageByteCap('€'.repeat(MAX_MESSAGE_BYTES / 2))).toBe(true)
    expect(exceedsMessageByteCap('a'.repeat(MAX_MESSAGE_BYTES))).toBe(false)
    expect(exceedsMessageByteCap('a'.repeat(MAX_MESSAGE_BYTES + 1))).toBe(true)
  })
})

describe('parseClientMessage size cap', () => {
  it('rejects a frame that is under the cap in code units but over it in bytes', () => {
    // three bytes per code unit, so this is ~1.5x the cap in bytes and 0.5x in length
    const oversized = '€'.repeat(Math.floor(MAX_MESSAGE_BYTES / 2))
    expect(oversized.length).toBeLessThan(MAX_MESSAGE_BYTES)
    expect(parseClientMessage(oversized)).toEqual({ reason: 'message too large' })
  })

  it('accepts a normal frame', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'cursor', x: 1, y: 2 }))).toEqual({
      msg: { type: 'cursor', x: 1, y: 2 },
    })
  })
})
