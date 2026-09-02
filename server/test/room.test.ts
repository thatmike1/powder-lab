import { describe, expect, it } from 'vitest'
import {
  CURSOR_BURST,
  CURSOR_RATE_PER_SEC,
  INPUT_DELAY,
  type Outbound,
  type ServerMessage,
  STATE_REFRESH_MS,
  STATE_REQUEST_TIMEOUT_MS,
  TICK_MS,
} from '../src/protocol.ts'
import { Room } from '../src/room.ts'

const T0 = 1_000_000

function room(): Room {
  return new Room('AB2CD3', 42, T0)
}

function messages<T extends ServerMessage['type']>(out: Outbound[], type: T) {
  return out.filter((o) => o.msg.type === type)
}

describe('Room tick clock', () => {
  it('derives the tick from wall clock and t0', () => {
    const r = room()
    expect(r.tickAt(T0)).toBe(0)
    expect(r.tickAt(T0 + TICK_MS * 74.9)).toBe(74)
    expect(r.tickAt(T0 + 1000)).toBe(75)
  })
})

describe('Room roster', () => {
  it('replies joined to the newcomer and peers to everyone', () => {
    const r = room()
    const first = r.join('a', 'ada', T0)
    expect(first[0].to).toEqual(['a'])
    expect(first[0].msg).toMatchObject({ type: 'joined', room: 'AB2CD3', you: 'a', seed: 42 })
    expect(first[1]).toMatchObject({ to: ['a'], msg: { type: 'peers' } })

    const second = r.join('b', 'bo', T0 + 5)
    const peers = messages(second, 'peers')[0]
    expect(peers.to.sort()).toEqual(['a', 'b'])
    expect(r.peerList()).toEqual([
      { id: 'a', name: 'ada' },
      { id: 'b', name: 'bo' },
    ])
  })

  it('makes the oldest peer the authority and hands it over on leave', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0 + 5)
    expect(r.authority()).toBe('a')
    const out = r.leave('a', T0 + 10)
    expect(r.authority()).toBe('b')
    expect(messages(out, 'peers')[0].to).toEqual(['b'])
  })

  it('marks itself empty when the last peer leaves', () => {
    const r = room()
    r.join('a', 'ada', T0)
    expect(r.emptySince).toBeNull()
    expect(r.leave('a', T0 + 10)).toEqual([])
    expect(r.emptySince).toBe(T0 + 10)
  })
})

describe('Room input stamping', () => {
  it('stamps applyTick with the input delay and broadcasts to the sender too', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    const now = T0 + 1000
    const out = r.input('a', { type: 'paint', x: 1, y: 2, r: 3, mat: 4 }, now)
    expect(out).toHaveLength(1)
    expect(out[0].to.sort()).toEqual(['a', 'b'])
    expect(out[0].msg).toMatchObject({
      type: 'input',
      from: 'a',
      applyTick: 75 + INPUT_DELAY,
      seq: 1,
      event: { type: 'paint', x: 1, y: 2, r: 3, mat: 4 },
    })
  })

  it('assigns a room-monotonic seq across peers', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    const seqs = [
      r.input('a', { type: 'strike' }, T0)[0].msg,
      r.input('b', { type: 'strike' }, T0)[0].msg,
      r.input('a', { type: 'clear' }, T0)[0].msg,
    ].map((m) => (m.type === 'input' ? m.seq : -1))
    expect(seqs).toEqual([1, 2, 3])
  })

  it('ignores inputs from peers that are not in the room', () => {
    const r = room()
    r.join('a', 'ada', T0)
    expect(r.input('ghost', { type: 'clear' }, T0)).toEqual([])
  })
})

describe('Room cursor relay', () => {
  it('sends cursors to the other peers untouched, outside the tick system', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    const out = r.cursor('a', 12, 34, T0 + 7)
    expect(out).toHaveLength(1)
    expect(out[0].to).toEqual(['b'])
    expect(out[0].msg).toEqual({ type: 'cursor', from: 'a', x: 12, y: 34, serverTime: T0 + 7 })
  })

  it('is a no-op when nobody else is listening', () => {
    const r = room()
    r.join('a', 'ada', T0)
    expect(r.cursor('a', 1, 2, T0)).toEqual([])
  })
})

describe('Room checksums', () => {
  it('stays quiet while peers agree', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    expect(r.checksum('a', 300, 111, T0)).toEqual([])
    expect(r.checksum('b', 300, 111, T0)).toEqual([])
  })

  it('asks the oldest peer for state when hashes disagree', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    // settle the state request that the join itself issued
    r.state('a', 'INIT', T0)
    r.checksum('a', 300, 111, T0)
    const out = r.checksum('b', 300, 222, T0 + 1)
    expect(out).toEqual([{ to: ['a'], msg: { type: 'stateRequest', serverTime: T0 + 1 } }])
  })

  it('resyncs only the disagreeing peer, as a setState input', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    r.join('c', 'cy', T0)
    r.state('a', 'INIT', T0)
    r.checksum('a', 300, 111, T0)
    r.checksum('b', 300, 222, T0)
    r.checksum('c', 300, 111, T0)
    const out = r.state('a', 'BLOB', T0 + 20)
    expect(out).toHaveLength(1)
    expect(out[0].to).toEqual(['b'])
    expect(out[0].msg).toMatchObject({
      type: 'input',
      from: 'a',
      event: { type: 'setState', state: 'BLOB' },
    })
  })

  it('does not treat different ticks as a disagreement', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    r.checksum('a', 300, 111, T0)
    expect(r.checksum('b', 600, 222, T0)).toEqual([])
  })
})

describe('Room state authority', () => {
  it('rejects state from a peer that is not the authority', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    const out = r.state('b', 'BLOB', T0)
    expect(out[0].msg).toMatchObject({ type: 'error' })
    expect(r.cachedState()).toBeNull()
  })

  it('caches the authority state and serves it to late joiners', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.state('a', 'BLOB', T0 + 5)
    const out = r.join('b', 'bo', T0 + 10)
    expect(out[0].msg).toMatchObject({ type: 'joined', state: 'BLOB' })
    // and the joiner is queued for a fresh state so it never runs on a stale cache
    expect(messages(out, 'stateRequest')[0].to).toEqual(['a'])
    const refreshed = r.state('a', 'FRESH', T0 + 20)
    expect(refreshed[0].to).toEqual(['b'])
    expect(refreshed[0].msg).toMatchObject({ event: { type: 'setState', state: 'FRESH' } })
  })

  it('refreshes the cached state from the authority on a timer', () => {
    const r = room()
    r.join('a', 'ada', T0)
    expect(r.maintain(T0 + 1000)).toEqual([])
    const out = r.maintain(T0 + 11_000)
    expect(out).toEqual([{ to: ['a'], msg: { type: 'stateRequest', serverTime: T0 + 11_000 } }])
  })
})

describe('Room resync recovery', () => {
  it('retries a state request the authority never answered', () => {
    const r = room()
    r.join('a', 'ada', T0)
    // the join queues b for a resync and issues the first request
    expect(messages(r.join('b', 'bo', T0), 'stateRequest')[0].to).toEqual(['a'])
    // still in flight, so nothing new goes out
    expect(r.maintain(T0 + STATE_REQUEST_TIMEOUT_MS - 1)).toEqual([])
    const retry = r.maintain(T0 + STATE_REQUEST_TIMEOUT_MS)
    expect(retry).toEqual([
      { to: ['a'], msg: { type: 'stateRequest', serverTime: T0 + STATE_REQUEST_TIMEOUT_MS } },
    ])
  })

  it('re-asks the peer that inherits authority when the old one leaves', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0 + 1)
    r.join('c', 'cy', T0 + 2)
    // c is waiting on a state from a, which then disconnects
    const out = r.leave('a', T0 + 3)
    expect(messages(out, 'stateRequest')[0]).toEqual({
      to: ['b'],
      msg: { type: 'stateRequest', serverTime: T0 + 3 },
    })
    // and b, now the authority, can serve c
    expect(r.state('b', 'BLOB', T0 + 4)[0].to).toEqual(['c'])
  })

  it('drains pendingResync once the state is delivered', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    r.state('a', 'BLOB', T0 + 1)
    // nothing is owed any more, so the retry path stays quiet until the refresh timer
    expect(r.maintain(T0 + STATE_REQUEST_TIMEOUT_MS + 1)).toEqual([])
    expect(r.maintain(T0 + STATE_REFRESH_MS + 2)).toHaveLength(1)
  })

  it('resyncs a mismatch reported while an earlier request is still in flight', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    r.join('c', 'cy', T0)
    // the joins left a request in flight; a genuine mismatch arrives inside its window
    r.checksum('a', 300, 111, T0 + 1)
    r.checksum('c', 300, 111, T0 + 1)
    expect(r.checksum('b', 300, 222, T0 + 1)).toEqual([])
    // the request is retried on timeout and b is still owed the state
    expect(messages(r.maintain(T0 + STATE_REQUEST_TIMEOUT_MS), 'stateRequest')[0].to).toEqual(['a'])
    const delivered = r.state('a', 'BLOB', T0 + STATE_REQUEST_TIMEOUT_MS + 1)
    expect(delivered[0].to.sort()).toEqual(['b', 'c'])
  })

  it('drops a peer from the resync queue once it becomes the authority', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    r.leave('a', T0 + 1)
    // b inherited authority, so it is nobody's resync target any more
    expect(r.maintain(T0 + STATE_REQUEST_TIMEOUT_MS)).toEqual([])
  })
})

describe('Room cursor rate limit', () => {
  it('drops cursor frames past the burst allowance and refills over time', () => {
    const r = room()
    r.join('a', 'ada', T0)
    r.join('b', 'bo', T0)
    for (let i = 0; i < CURSOR_BURST; i++) {
      expect(r.cursor('a', i, i, T0)).toHaveLength(1)
    }
    expect(r.cursor('a', 9, 9, T0)).toEqual([])
    // one token is worth 1000 / CURSOR_RATE_PER_SEC ms
    expect(r.cursor('a', 9, 9, T0 + 1000 / CURSOR_RATE_PER_SEC)).toHaveLength(1)
    // a peer's flood never starves another peer
    expect(r.cursor('b', 1, 1, T0)).toHaveLength(1)
  })
})
