import { describe, expect, it } from 'vitest'
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../src/codes.ts'

describe('room codes', () => {
  it('uses an unambiguous alphabet', () => {
    for (const ch of 'O0I1') expect(ROOM_CODE_ALPHABET).not.toContain(ch)
  })

  it('generates codes inside the 4-6 character window', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(ROOM_CODE_LENGTH)
      expect(isValidRoomCode(code)).toBe(true)
    }
  })

  it('is deterministic under an injected rng', () => {
    const first = generateRoomCode(() => 0)
    const last = generateRoomCode(() => 0.999999)
    expect(first).toBe(ROOM_CODE_ALPHABET[0].repeat(ROOM_CODE_LENGTH))
    expect(last).toBe(ROOM_CODE_ALPHABET[ROOM_CODE_ALPHABET.length - 1].repeat(ROOM_CODE_LENGTH))
  })

  it('rejects codes outside the window or alphabet', () => {
    expect(isValidRoomCode('ABC')).toBe(false)
    expect(isValidRoomCode('ABCDEFG')).toBe(false)
    expect(isValidRoomCode('ABCD0')).toBe(false)
    expect(isValidRoomCode('ABCD')).toBe(true)
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeRoomCode('  ab2d ')).toBe('AB2D')
  })
})
