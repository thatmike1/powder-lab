// the base64 string carried by `setState` and by `joined.state`.
//
// the protocol doc calls this "a full serialized state, base64". it is, with a
// small client-side header in front of the `Simulation` bytes. two things the
// engine's own state cannot carry are needed to resume a ROOM rather than a
// simulation: the room tick (which runs off the server clock and keeps
// advancing while the room is paused, so it drifts away from the sim's own
// frame counter by exactly the number of paused ticks) and whether the room was
// running when the state was taken. the relay never looks inside the string, so
// both endpoints agree on this shape and nothing else has to know.
//
// layout: 'P','E', version, u32 roomTick (LE), u8 running, then the sim state.

const MAGIC0 = 0x50 // 'P'
const MAGIC1 = 0x45 // 'E'
const VERSION = 1
const HEADER = 8

export interface StateEnvelope {
  roomTick: number
  running: boolean
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

/** wrap a serialized simulation state with the room clock context and base64 it */
export function encodeStateEnvelope(roomTick: number, running: boolean, state: Uint8Array): string {
  const out = new Uint8Array(HEADER + state.length)
  const view = new DataView(out.buffer)
  out[0] = MAGIC0
  out[1] = MAGIC1
  out[2] = VERSION
  view.setUint32(3, roomTick >>> 0, true)
  out[7] = running ? 1 : 0
  out.set(state, HEADER)
  return bytesToBase64(out)
}

/** unwrap a string produced by {@link encodeStateEnvelope}, or null if it is not one */
export function decodeStateEnvelope(text: string): StateEnvelope | null {
  const bytes = base64ToBytes(text)
  if (bytes === null || bytes.length < HEADER) return null
  if (bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1 || bytes[2] !== VERSION) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    roomTick: view.getUint32(3, true),
    running: bytes[7] === 1,
    state: bytes.subarray(HEADER),
  }
}
