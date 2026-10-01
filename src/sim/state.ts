import { Mat, MAT_COUNT } from './materials'
import { MIN_TEMP, MAX_TEMP, TEMP_SCALE } from './thermal'

// full simulation state (de)serialization: the pure bytes layer behind
// `Simulation.serializeState` / `loadState`. Deliberately separate from
// `scene.ts` — the RLE scene format carries `cells` only, which is fine for a
// shareable URL and wrong for a late joiner, whose `life`, `extra`, `heat`,
// chunk activity and PRNG cursor must match the peers bit for bit or the
// lockstep simulation diverges within a few ticks.
//
// Layout (little-endian throughout, no compression):
//   0  u8   magic 'P'
//   1  u8   magic 'S'
//   2  u8   version
//   3  u16  W
//   5  u16  H
//   7  u32  tick
//   11 u32  rng state word
//   15 u32  chunk count (length of the activity arrays)
//   19 ...  cells[n], life[n], extra[n], active[c], activeNext[c],
//           stamp[n] as i32, heat[n] as Q4 f32 degrees, phase[n] as i16, fuel[n] as u16, burnFrom[n] as u8, pressure[n] as u16

const MAGIC0 = 0x50 // 'P'
const MAGIC1 = 0x53 // 'S'
export const STATE_VERSION = 4
const VERSION = STATE_VERSION
const HEADER = 19

/** thrown when bytes aren't a recognizable full simulation state. */
export class StateFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateFormatError'
  }
}

export interface SimState {
  W: number
  H: number
  tick: number
  rngState: number
  cells: Uint8Array
  life: Uint8Array
  extra: Uint8Array
  active: Uint8Array
  activeNext: Uint8Array
  stamp: Int32Array
  heat: Float32Array
  phase: Int16Array
  fuel: Uint16Array
  burnFrom: Uint8Array
  pressure: Uint16Array
}

export interface DecodedState extends SimState {
  version: number
}

/** total byte length a state of this size encodes to. */
function byteLength(n: number, c: number): number {
  return HEADER + 3 * n + 2 * c + 4 * n + 4 * n + 2 * n + 3 * n + 2 * n
}

function validateShape(W: number, H: number, c: number): void {
  if (
    !Number.isInteger(W) ||
    !Number.isInteger(H) ||
    W < 1 ||
    H < 1 ||
    W > 65535 ||
    H > 65535 ||
    W * H > 1_000_000
  ) {
    throw new StateFormatError('invalid state dimensions')
  }
  if (c !== Math.ceil(W / 16) * Math.ceil(H / 16)) throw new StateFormatError('invalid chunk count')
}

function validMaterial(m: number): boolean {
  return m < MAT_COUNT && m !== Mat.MAGNET && m !== Mat.HEAT && m !== Mat.COOL
}

/**
 * encode a full simulation state as a straight byte dump behind a small header.
 * every multi-byte field is written explicitly little-endian so two clients on
 * different machines produce identical bytes.
 */
export function encodeState(state: SimState): Uint8Array<ArrayBuffer> {
  const {
    W,
    H,
    cells,
    life,
    extra,
    active,
    activeNext,
    stamp,
    heat,
    phase,
    fuel,
    burnFrom,
    pressure,
  } = state
  const n = W * H
  const c = active.length
  validateShape(W, H, c)
  if (cells.length !== n || life.length !== n || extra.length !== n) {
    throw new StateFormatError('cell array length does not match W*H')
  }
  if (
    stamp.length !== n ||
    heat.length !== n ||
    phase.length !== n ||
    fuel.length !== n ||
    burnFrom.length !== n ||
    pressure.length !== n
  ) {
    throw new StateFormatError('stamp/heat length does not match W*H')
  }
  if (activeNext.length !== c) {
    throw new StateFormatError('activity arrays differ in length')
  }

  const out = new Uint8Array(byteLength(n, c))
  const view = new DataView(out.buffer)
  out[0] = MAGIC0
  out[1] = MAGIC1
  out[2] = VERSION
  view.setUint16(3, W, true)
  view.setUint16(5, H, true)
  view.setUint32(7, state.tick >>> 0, true)
  view.setUint32(11, state.rngState >>> 0, true)
  view.setUint32(15, c, true)

  let p = HEADER
  out.set(cells, p)
  p += n
  out.set(life, p)
  p += n
  out.set(extra, p)
  p += n
  out.set(active, p)
  p += c
  out.set(activeNext, p)
  p += c
  for (let i = 0; i < n; i++) view.setInt32(p + i * 4, stamp[i], true)
  p += n * 4
  for (let i = 0; i < n; i++) view.setFloat32(p + i * 4, heat[i], true)
  p += n * 4
  for (let i = 0; i < n; i++) view.setInt16(p + i * 2, phase[i], true)
  p += n * 2
  for (let i = 0; i < n; i++) view.setUint16(p + i * 2, fuel[i], true)
  p += n * 2
  out.set(burnFrom, p)
  p += n
  for (let i = 0; i < n; i++) view.setUint16(p + i * 2, pressure[i], true)
  return out
}

/** decode bytes produced by {@link encodeState}. throws on anything malformed. */
export function decodeState(bytes: Uint8Array): DecodedState {
  if (bytes.length < HEADER || bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) {
    throw new StateFormatError('not a powder state (bad magic)')
  }
  const version = bytes[2]
  if (version !== VERSION) {
    throw new StateFormatError(`unsupported state version ${version}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const W = view.getUint16(3, true)
  const H = view.getUint16(5, true)
  const tick = view.getUint32(7, true)
  const rngState = view.getUint32(11, true)
  const c = view.getUint32(15, true)
  validateShape(W, H, c)
  const n = W * H
  if (bytes.length !== byteLength(n, c)) {
    throw new StateFormatError('state length does not match its declared size')
  }

  let p = HEADER
  const take = (len: number): Uint8Array => {
    const a = bytes.slice(p, p + len)
    p += len
    return a
  }
  const cells = take(n)
  const life = take(n)
  const extra = take(n)
  const active = take(c)
  const activeNext = take(c)
  const stamp = new Int32Array(n)
  for (let i = 0; i < n; i++) stamp[i] = view.getInt32(p + i * 4, true)
  p += n * 4
  const heat = new Float32Array(n)
  for (let i = 0; i < n; i++) heat[i] = view.getFloat32(p + i * 4, true)

  p += n * 4
  const phase = new Int16Array(n)
  for (let i = 0; i < n; i++) phase[i] = view.getInt16(p + i * 2, true)

  p += n * 2
  const fuel = new Uint16Array(n)
  for (let i = 0; i < n; i++) fuel[i] = view.getUint16(p + i * 2, true)
  p += n * 2
  const burnFrom = take(n)
  const pressure = new Uint16Array(n)
  for (let i = 0; i < n; i++) pressure[i] = view.getUint16(p + i * 2, true)

  if (cells.some((m) => !validMaterial(m)) || burnFrom.some((m) => !validMaterial(m))) {
    throw new StateFormatError('invalid material in state')
  }
  if (active.some((a) => a > 1) || activeNext.some((a) => a > 1))
    throw new StateFormatError('invalid activity flag')
  for (let i = 0; i < n; i++) {
    if (
      !Number.isFinite(heat[i]) ||
      heat[i] < MIN_TEMP ||
      heat[i] > MAX_TEMP ||
      !Number.isInteger(heat[i] * TEMP_SCALE)
    ) {
      throw new StateFormatError('temperature is outside the Q4 range')
    }
    if (pressure[i] > 4095) throw new StateFormatError('pressure exceeds cap')
  }
  return {
    version,
    W,
    H,
    tick,
    rngState,
    cells,
    life,
    extra,
    active,
    activeNext,
    stamp,
    heat,
    phase,
    fuel,
    burnFrom,
    pressure,
  }
}
