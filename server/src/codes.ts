// room codes: four to six characters from an alphabet with no visually
// ambiguous glyphs (no O/0, no I/1).

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const ROOM_CODE_LENGTH = 6

/** true when a string could be a room code at all, before any registry lookup */
export function isValidRoomCode(code: string): boolean {
  if (code.length < 4 || code.length > 6) return false
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false
  return true
}

/** normalize user-typed input (case and surrounding whitespace) into a code */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase()
}

/** generate one room code from an injectable rng, so tests can be deterministic */
export function generateRoomCode(rng: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.min(
      ROOM_CODE_ALPHABET.length - 1,
      Math.floor(rng() * ROOM_CODE_ALPHABET.length),
    )
    out += ROOM_CODE_ALPHABET[idx]
  }
  return out
}
