import { describe, expect, it } from 'vitest'
import { bytesToBase64, decodeStateEnvelope, encodeStateEnvelope } from './state-envelope'

const STATE = new Uint8Array([1, 2, 3, 250])

describe('state envelope', () => {
  it('round-trips the room clock and pause flag', () => {
    const env = decodeStateEnvelope(encodeStateEnvelope(4242, true, STATE))
    expect(env).not.toBeNull()
    expect(env?.roomTick).toBe(4242)
    expect(env?.running).toBe(true)
    expect([...(env?.state ?? [])]).toEqual([...STATE])
  })

  it('carries no look unless one is given', () => {
    expect(decodeStateEnvelope(encodeStateEnvelope(0, false, STATE))?.look).toBeNull()
  })

  it('round-trips a scene look', () => {
    const env = decodeStateEnvelope(
      encodeStateEnvelope(7, false, STATE, { light: false, darkness: 0.25 }),
    )
    expect(env?.look).toEqual({ light: false, darkness: 0.25 })
  })

  it('rejects an envelope from another protocol version', () => {
    const bytes = new Uint8Array(20)
    bytes[0] = 0x50
    bytes[1] = 0x45
    bytes[2] = 1 // the v1 header, whose fields sit at different offsets
    expect(decodeStateEnvelope(bytesToBase64(bytes))).toBeNull()
  })

  it('rejects text that is not an envelope at all', () => {
    expect(decodeStateEnvelope('not base64 ***')).toBeNull()
    expect(decodeStateEnvelope(bytesToBase64(new Uint8Array(3)))).toBeNull()
  })
})
