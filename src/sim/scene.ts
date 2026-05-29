// scene (de)serialization: the pure bytes/encoding layer for save/load/share.
// Knows nothing about the Simulation or React — it turns a flat `cells` grid
// into a compact byte stream (and back), plus the base64url / URL-hash plumbing
// that makes a scene fit in a shareable link.

const MAGIC0 = 0x50 // 'P'
const MAGIC1 = 0x4c // 'L'
const VERSION = 1
const HASH_KEY = 's' // scenes live at location.hash = "#s=<base64url>"

/** thrown when bytes aren't a recognizable powder scene. */
export class SceneFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SceneFormatError'
  }
}

export interface DecodedScene {
  version: number
  W: number
  H: number
  cells: Uint8Array
}

/**
 * encode a flat material grid as run-length pairs behind a small header.
 * the grid is mostly long EMPTY runs, so this collapses tens of thousands of
 * cells to a tiny payload. run counts use LEB128 varints, so a run is
 * 1 material byte + 1..N length bytes.
 */
export function encodeRLE(cells: Uint8Array, W: number, H: number): Uint8Array<ArrayBuffer> {
  const out: number[] = [
    MAGIC0,
    MAGIC1,
    VERSION,
    W & 0xff,
    (W >> 8) & 0xff,
    H & 0xff,
    (H >> 8) & 0xff,
  ]
  const n = cells.length
  let i = 0
  while (i < n) {
    const mat = cells[i]
    let run = 1
    while (i + run < n && cells[i + run] === mat) run++
    out.push(mat)
    // LEB128: 7 bits per byte, high bit set while more bytes follow.
    let v = run
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80)
      v >>>= 7
    }
    out.push(v)
    i += run
  }
  return Uint8Array.from(out)
}

/** decode bytes produced by {@link encodeRLE} back into a flat grid. */
export function decodeRLE(bytes: Uint8Array): DecodedScene {
  if (bytes.length < 7 || bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) {
    throw new SceneFormatError('not a powder scene (bad magic)')
  }
  const version = bytes[2]
  if (version !== VERSION) {
    throw new SceneFormatError(`unsupported scene version ${version}`)
  }
  const W = bytes[3] | (bytes[4] << 8)
  const H = bytes[5] | (bytes[6] << 8)
  const cells = new Uint8Array(W * H)
  let p = 7
  let out = 0
  while (p < bytes.length) {
    const mat = bytes[p++]
    // read a LEB128 varint run length.
    let run = 0
    let shift = 0
    while (true) {
      if (p >= bytes.length) throw new SceneFormatError('truncated run length')
      const b = bytes[p++]
      run |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    if (out + run > cells.length) throw new SceneFormatError('run overflows grid')
    cells.fill(mat, out, out + run)
    out += run
  }
  if (out !== cells.length) throw new SceneFormatError('scene shorter than its declared size')
  return { version, W, H, cells }
}

/** pack raw bytes into a URL-safe base64url string (no +, /, or = padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** inverse of {@link bytesToBase64Url}. throws SceneFormatError on garbage. */
export function base64UrlToBytes(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    throw new SceneFormatError('scene data is not valid base64')
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** build the "#s=<base64url>" hash fragment for a snapshot. */
export function sceneToHash(bytes: Uint8Array): string {
  return `#${HASH_KEY}=${bytesToBase64Url(bytes)}`
}

/**
 * read a scene out of the current location.hash, or null if there isn't one.
 * swallows malformed hashes (returns null) so a junk URL just boots empty.
 */
export function readSceneFromHash(): Uint8Array | null {
  const hash = location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const data = params.get(HASH_KEY)
  if (!data) return null
  try {
    return base64UrlToBytes(data)
  } catch {
    return null
  }
}
