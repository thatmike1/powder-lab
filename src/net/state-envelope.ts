// the base64 string carried by `setState` and by `joined.state`.
//
// the protocol doc calls this "a full serialized state, base64". it is, with a
// small client-side header in front of the `Simulation` bytes. three things the
// engine's own state cannot carry are needed to resume a ROOM rather than a
// simulation: the room tick (which runs off the server clock and keeps
// advancing while the room is paused, so it drifts away from the sim's own
// frame counter by exactly the number of paused ticks), whether the room was
// running when the state was taken, and the scene's lighting hint. the hint is
// here because a gallery scene is authored with a `light`/`darkness` look and
// several scenes only read at all under theirs; applying it locally on the
// picking client alone left every peer looking at a different picture. the
// relay never looks inside the string, so both endpoints agree on this shape
// and nothing else has to know.
//
// layout: 'P','E', version, u32 roomTick (LE), u8 running, u8 hasLook,
// u8 light, f64 darkness (LE), then the sim state. darkness is a float64 so a
// slider value round-trips exactly and the UI mirror never shows 0.20000000298.

const MAGIC0 = 0x50 // 'P'
const MAGIC1 = 0x45 // 'E'
const VERSION = 2
const HEADER = 18

/** a scene's authored look, shared so every peer renders the same picture */
export interface StateLook {
  light: boolean
  darkness: number
}

export interface StateEnvelope {
  roomTick: number
  running: boolean
  /** null when the state carries no look of its own and each client keeps its own */
  look: StateLook | null
  state: Uint8Array
}

/** base64 for a byte array, using the platform encoder both node and browsers have */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // chunked so a 270 kB state does not blow the argument limit of String.fromCharCode
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** inverse of {@link bytesToBase64}; returns null when the text is not base64 */
export function base64ToBytes(text: string): Uint8Array | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * wrap a serialized simulation state with the room clock context and base64 it.
 *
 * @param look the scene's authored lighting, or null/omitted to leave each
 * client's own render preferences alone (a desync correction carries no look).
 */
export function encodeStateEnvelope(
  roomTick: number,
  running: boolean,
  state: Uint8Array,
  look: StateLook | null = null,
): string {
  const out = new Uint8Array(HEADER + state.length)
  const view = new DataView(out.buffer)
  out[0] = MAGIC0
  out[1] = MAGIC1
  out[2] = VERSION
  view.setUint32(3, roomTick >>> 0, true)
  out[7] = running ? 1 : 0
  out[8] = look === null ? 0 : 1
  out[9] = look?.light ? 1 : 0
  view.setFloat64(10, look?.darkness ?? 0, true)
  out.set(state, HEADER)
  return bytesToBase64(out)
}

/** unwrap a string produced by {@link encodeStateEnvelope}, or null if it is not one */
export function decodeStateEnvelope(text: string): StateEnvelope | null {
  const bytes = base64ToBytes(text)
  if (bytes === null || bytes.length < HEADER) return null
  // a version mismatch is a peer on another build: reject it rather than read
  // its bytes at the wrong offsets and load a corrupt grid.
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1 || bytes[2] !== VERSION) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    roomTick: view.getUint32(3, true),
    running: bytes[7] === 1,
    look: bytes[8] === 1 ? { light: bytes[9] === 1, darkness: view.getFloat64(10, true) } : null,
    state: bytes.subarray(HEADER),
  }
}
