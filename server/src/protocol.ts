// wire protocol for the powder-lab relay, implementing docs/multiplayer-protocol.md.
// the server never interprets simulation semantics: input events and full-state
// blobs are opaque payloads it stamps, orders, relays and stores.

/** one simulation tick, matching STEP_MS in src/useSimulation.ts */
export const TICK_MS = 1000 / 75

/** ticks between server receipt of an input and the tick every client applies it at */
export const INPUT_DELAY = 10

/** hard cap on peers in a single room */
export const MAX_PEERS_PER_ROOM = 8

/** largest client frame we will even try to parse */
export const MAX_MESSAGE_BYTES = 4_000_000

/** how long an empty room lingers before it is dropped */
export const EMPTY_ROOM_GRACE_MS = 60_000

/** how often the authority is asked for a fresh full state */
export const STATE_REFRESH_MS = 10_000

/** how long an unanswered state request blocks further requests */
export const STATE_REQUEST_TIMEOUT_MS = 5_000

/** sustained cursor frames per second a peer may relay before excess is dropped */
export const CURSOR_RATE_PER_SEC = 20

/** cursor frames a peer may burst above the sustained rate */
export const CURSOR_BURST = 5

/** how many distinct ticks of checksum reports are retained per room */
export const CHECKSUM_TICK_HISTORY = 32

export type PeerId = string

/** an input event, opaque to the server beyond having a `type` tag */
export type InputEvent = { type: string; [key: string]: unknown }

export type PeerInfo = { id: PeerId; name: string }

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

/** a message plus the exact peers it goes to; the socket shell only has to deliver it */
export type Outbound = { to: PeerId[]; msg: ServerMessage }

/** helper for the single-recipient error reply used all over the room logic */
export function errorTo(id: PeerId, message: string, now: number): Outbound {
  return { to: [id], msg: { type: 'error', message, serverTime: now } }
}

/**
 * whether a frame is over the byte cap. utf-8 spends one to three bytes per
 * utf-16 code unit, so the two length bounds settle every ordinary frame and
 * only the ambiguous middle is actually encoded and measured.
 */
export function exceedsMessageByteCap(raw: string): boolean {
  if (raw.length > MAX_MESSAGE_BYTES) return true
  if (raw.length * 3 <= MAX_MESSAGE_BYTES) return false
  return new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * parse and structurally validate one client frame. returns the message, or a
 * reason string when the frame is unusable. this checks shape only, never
 * simulation meaning.
 */
export function parseClientMessage(raw: string): { msg: ClientMessage } | { reason: string } {
  if (exceedsMessageByteCap(raw)) return { reason: 'message too large' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { reason: 'malformed json' }
  }
  if (!isRecord(parsed)) return { reason: 'message must be an object' }
  const type = parsed.type
  switch (type) {
    case 'join': {
      const room = parsed.room
      const name = parsed.name
      if (room !== undefined && typeof room !== 'string')
        return { reason: 'join.room must be a string' }
      if (name !== undefined && typeof name !== 'string')
        return { reason: 'join.name must be a string' }
      return { msg: { type: 'join', room, name } }
    }
    case 'input': {
      const event = parsed.event
      if (!isRecord(event) || typeof event.type !== 'string') {
        return { reason: 'input.event must be an object with a type' }
      }
      return { msg: { type: 'input', event: event as InputEvent } }
    }
    case 'checksum': {
      if (!Number.isFinite(parsed.tick) || !Number.isFinite(parsed.hash)) {
        return { reason: 'checksum needs numeric tick and hash' }
      }
      return { msg: { type: 'checksum', tick: parsed.tick as number, hash: parsed.hash as number } }
    }
    case 'state': {
      if (typeof parsed.state !== 'string') return { reason: 'state must be a base64 string' }
      return { msg: { type: 'state', state: parsed.state } }
    }
    case 'cursor': {
      if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
        return { reason: 'cursor needs numeric x and y' }
      }
      return { msg: { type: 'cursor', x: parsed.x as number, y: parsed.y as number } }
    }
    default:
      return { reason: `unknown message type: ${String(type)}` }
  }
}
