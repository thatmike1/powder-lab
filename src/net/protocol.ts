// client half of the wire protocol in docs/multiplayer-protocol.md. deliberately
// a standalone mirror of `server/src/protocol.ts` rather than an import: the
// server is a separate build (node, .ts extension imports) and the browser
// bundle must not drag it in. the two files are the same contract; keep them
// in step by hand.

/** one simulation tick, matching STEP_MS in useSimulation */
export const TICK_MS = 1000 / 75

/** ticks between server receipt of an input and the tick every client applies it at */
export const INPUT_DELAY = 10

/** how often a connected client reports a checksum */
export const CHECKSUM_INTERVAL_TICKS = 300

/** how many ticks of applied inputs are retained for a resync replay (~8 s) */
export const INPUT_LOG_TICKS = 600

/** cursors are cosmetic; this is the send cadence, not a simulation rate */
export const CURSOR_INTERVAL_MS = 100

export type PeerId = string

export type PeerInfo = { id: PeerId; name: string }

/** a stroke's sampled points, flattened as x0,y0,x1,y1,... and applied in order */
export type PaintEvent = { type: 'paint'; pts: number[]; r: number; mat: number }
export type MagnetEvent = { type: 'magnet'; x: number; y: number; r: number; attract: boolean }
export type StrikeEvent = { type: 'strike'; x: number; y: number }
export type ClearEvent = { type: 'clear' }
/**
 * a full state adopted by every peer at the same tick. `reason: 'load'` marks a
 * user-initiated scene/preset load, which is applied in place; a setState
 * without it came from the server's desync machinery and rewinds the receiver
 * to the state's own tick before replaying.
 */
export type SetStateEvent = { type: 'setState'; state: string; reason?: 'load' }
export type RunningEvent = { type: 'running'; on: boolean }

export type InputEvent =
  | PaintEvent
  | MagnetEvent
  | StrikeEvent
  | ClearEvent
  | SetStateEvent
  | RunningEvent

/** an input as the server stamped it: what to do, and exactly when everyone does it */
export type StampedInput = {
  event: InputEvent
  applyTick: number
  seq: number
  from: PeerId
}

export type ClientMessage =
  | { type: 'join'; room?: string; name?: string }
  | { type: 'input'; event: InputEvent }
  | { type: 'checksum'; tick: number; hash: number }
  | { type: 'state'; state: string }
  | { type: 'cursor'; x: number; y: number }

export type ServerMessage =
  | {
      type: 'joined'
      room: string
      you: PeerId
      seed: number
      tick: number
      serverTime: number
      state: string | null
      peers: PeerInfo[]
    }
  | {
      type: 'input'
      event: InputEvent
      applyTick: number
      seq: number
      from: PeerId
      serverTime: number
    }
  | { type: 'peers'; peers: PeerInfo[]; serverTime: number }
  | { type: 'cursor'; from: PeerId; x: number; y: number; serverTime: number }
  | { type: 'stateRequest'; serverTime: number }
  | { type: 'error'; message: string; serverTime: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * validate one relayed input event. events reach us from other clients through
 * a relay that never looks inside them, so this is the only place their shape
 * is checked before they touch the grid.
 */
export function parseInputEvent(raw: unknown): InputEvent | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'paint': {
      const pts = raw.pts
      if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0) return null
      if (!pts.every(num)) return null
      if (!num(raw.r) || !num(raw.mat)) return null
      return { type: 'paint', pts: pts as number[], r: raw.r, mat: raw.mat }
    }
    case 'magnet':
      if (!num(raw.x) || !num(raw.y) || !num(raw.r) || typeof raw.attract !== 'boolean') return null
      return { type: 'magnet', x: raw.x, y: raw.y, r: raw.r, attract: raw.attract }
    case 'strike':
      if (!num(raw.x) || !num(raw.y)) return null
      return { type: 'strike', x: raw.x, y: raw.y }
    case 'clear':
      return { type: 'clear' }
    case 'setState': {
      if (typeof raw.state !== 'string') return null
      return raw.reason === 'load'
        ? { type: 'setState', state: raw.state, reason: 'load' }
        : { type: 'setState', state: raw.state }
    }
    case 'running':
      if (typeof raw.on !== 'boolean') return null
      return { type: 'running', on: raw.on }
    default:
      return null
  }
}

/** parse one server frame, returning null for anything we cannot safely act on */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  switch (parsed.type) {
    case 'joined': {
      if (typeof parsed.room !== 'string' || typeof parsed.you !== 'string') return null
      if (!num(parsed.seed) || !num(parsed.tick) || !num(parsed.serverTime)) return null
      const state = parsed.state
      if (state !== null && typeof state !== 'string') return null
      return {
        type: 'joined',
        room: parsed.room,
        you: parsed.you,
        seed: parsed.seed,
        tick: parsed.tick,
        serverTime: parsed.serverTime,
        state,
        peers: parsePeers(parsed.peers),
      }
    }
    case 'input': {
      const event = parseInputEvent(parsed.event)
      if (event === null) return null
      if (!num(parsed.applyTick) || !num(parsed.seq) || !num(parsed.serverTime)) return null
      if (typeof parsed.from !== 'string') return null
      return {
        type: 'input',
        event,
        applyTick: parsed.applyTick,
        seq: parsed.seq,
        from: parsed.from,
        serverTime: parsed.serverTime,
      }
    }
    case 'peers':
      if (!num(parsed.serverTime)) return null
      return { type: 'peers', peers: parsePeers(parsed.peers), serverTime: parsed.serverTime }
    case 'cursor':
      if (typeof parsed.from !== 'string') return null
      if (!num(parsed.x) || !num(parsed.y) || !num(parsed.serverTime)) return null
      return {
        type: 'cursor',
        from: parsed.from,
        x: parsed.x,
        y: parsed.y,
        serverTime: parsed.serverTime,
      }
    case 'stateRequest':
      if (!num(parsed.serverTime)) return null
      return { type: 'stateRequest', serverTime: parsed.serverTime }
    case 'error':
      if (typeof parsed.message !== 'string' || !num(parsed.serverTime)) return null
      return { type: 'error', message: parsed.message, serverTime: parsed.serverTime }
    default:
      return null
  }
}

function parsePeers(raw: unknown): PeerInfo[] {
  if (!Array.isArray(raw)) return []
  const out: PeerInfo[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
    out.push({ id: entry.id, name: entry.name })
  }
  return out
}
