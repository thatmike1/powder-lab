import { describe, expect, it } from 'vitest'
import { EMPTY_ROOM_GRACE_MS, MAX_PEERS_PER_ROOM, parseClientMessage } from '../src/protocol.ts'
import { RoomRegistry, sanitizeName } from '../src/registry.ts'

const T0 = 1_000_000

/** deterministic rng so generated codes and seeds are reproducible in tests */
function seededRng(): () => number {
  let x = 12345
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

function joinedMessage(registry: RoomRegistry, peerId: string, code: string | undefined) {
  const out = registry.join(peerId, code, 'anon', T0)
  const first = out[0].msg
  if (first.type !== 'joined') throw new Error(`expected joined, got ${first.type}`)
  return first
}

describe('RoomRegistry', () => {
  it('creates a room for an empty code and reuses it for the code it handed out', () => {
    const registry = new RoomRegistry(seededRng())
    const created = joinedMessage(registry, 'a', undefined)
    expect(registry.roomCount).toBe(1)
    const joined = joinedMessage(registry, 'b', created.room)
    expect(joined.room).toBe(created.room)
    expect(joined.seed).toBe(created.seed)
    expect(registry.roomCount).toBe(1)
  })

  it('accepts a lowercase code for an existing room', () => {
    const registry = new RoomRegistry(seededRng())
    const created = joinedMessage(registry, 'a', undefined)
    expect(joinedMessage(registry, 'b', created.room.toLowerCase()).room).toBe(created.room)
  })

  it('errors on an unknown code instead of silently creating', () => {
    const registry = new RoomRegistry(seededRng())
    const out = registry.join('a', 'ZZZZZZ', 'anon', T0)
    expect(out[0].msg).toMatchObject({ type: 'error' })
    expect(registry.roomCount).toBe(0)
  })

  it('errors on a malformed code', () => {
    const registry = new RoomRegistry(seededRng())
    expect(registry.join('a', 'oops!', 'anon', T0)[0].msg).toMatchObject({ type: 'error' })
  })

  it('refuses a join into a full room', () => {
    const registry = new RoomRegistry(seededRng())
    const created = joinedMessage(registry, 'p0', undefined)
    for (let i = 1; i < MAX_PEERS_PER_ROOM; i++) {
      joinedMessage(registry, `p${i}`, created.room)
    }
    const out = registry.join('overflow', created.room, 'anon', T0)
    expect(out[0].msg).toMatchObject({ type: 'error', message: 'room is full' })
  })

  it('refuses messages from a peer that has not joined', () => {
    const registry = new RoomRegistry(seededRng())
    const out = registry.handle('ghost', { type: 'input', event: { type: 'clear' } }, T0)
    expect(out[0].msg).toMatchObject({ type: 'error', message: 'join a room first' })
  })

  it('drops an empty room only after the grace period', () => {
    const registry = new RoomRegistry(seededRng())
    const created = joinedMessage(registry, 'a', undefined)
    registry.leave('a', T0)
    registry.maintain(T0 + EMPTY_ROOM_GRACE_MS - 1)
    expect(registry.room(created.room)).toBeDefined()
    registry.maintain(T0 + EMPTY_ROOM_GRACE_MS)
    expect(registry.room(created.room)).toBeUndefined()
  })

  it('gives every new room a distinct code', () => {
    const registry = new RoomRegistry()
    const codes = new Set<string>()
    for (let i = 0; i < 50; i++) codes.add(registry.createRoom(T0).code)
    expect(codes.size).toBe(50)
  })
})

describe('parseClientMessage', () => {
  it('rejects malformed json', () => {
    expect(parseClientMessage('{')).toEqual({ reason: 'malformed json' })
  })

  it('rejects a non-object frame', () => {
    expect(parseClientMessage('[1,2]')).toMatchObject({ reason: 'message must be an object' })
  })

  it('rejects an unknown type', () => {
    expect(parseClientMessage('{"type":"rm -rf"}')).toMatchObject({
      reason: 'unknown message type: rm -rf',
    })
  })

  it('rejects an input without a typed event', () => {
    expect(parseClientMessage('{"type":"input","event":7}')).toMatchObject({
      reason: 'input.event must be an object with a type',
    })
  })

  it('passes an input event through untouched', () => {
    const parsed = parseClientMessage('{"type":"input","event":{"type":"paint","x":3}}')
    expect(parsed).toEqual({ msg: { type: 'input', event: { type: 'paint', x: 3 } } })
  })
})

describe('sanitizeName', () => {
  it('falls back to anon and clamps length', () => {
    expect(sanitizeName(undefined)).toBe('anon')
    expect(sanitizeName('   ')).toBe('anon')
    expect(sanitizeName('x'.repeat(100))).toHaveLength(24)
  })
})
