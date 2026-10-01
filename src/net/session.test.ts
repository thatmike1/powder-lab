import { describe, expect, it } from 'vitest'
import { Mat } from '../sim/materials'
import { Simulation } from '../sim/Simulation'
import { INPUT_DELAY, type PeerId, TICK_MS } from './protocol'
import { NetSession } from './session'
import { encodeStateEnvelope, type StateLook } from './state-envelope'
import type { Connect, TransportHandlers } from './transport'

const W = 40
const H = 30
const SEED = 0x1234_5678

/**
 * the relay's semantics with no sockets and no wall clock: stamp inputs with
 * `serverTick + INPUT_DELAY` and a room-monotonic seq, broadcast to everyone
 * including the sender. mirrors server/src/room.ts closely enough to test the
 * client half against it.
 */
class FakeRelay {
  joinedState: string | null = null
  now = 100_000
  readonly t0 = 100_000
  private seq = 0
  private nextId = 0
  private readonly peers = new Map<PeerId, TransportHandlers>()
  readonly checksums: { from: PeerId; tick: number; hash: number }[] = []

  tick(): number {
    return Math.floor((this.now - this.t0) / TICK_MS)
  }

  connect: Connect = (_url, handlers) => {
    const id = `p${this.nextId++}`
    this.peers.set(id, handlers)
    handlers.onOpen()
    return {
      send: (data: string) => this.receive(id, data),
      close: () => {
        this.peers.delete(id)
      },
      get open() {
        return true
      },
    }
  }

  private deliver(to: PeerId[], msg: unknown): void {
    const frame = JSON.stringify(msg)
    for (const id of to) this.peers.get(id)?.onMessage(frame)
  }

  private receive(from: PeerId, data: string): void {
    const msg = JSON.parse(data)
    switch (msg.type) {
      case 'join':
        this.deliver([from], {
          type: 'joined',
          room: 'TEST',
          you: from,
          seed: SEED,
          tick: this.tick(),
          serverTime: this.now,
          state: this.joinedState,
          peers: [...this.peers.keys()].map((id) => ({ id, name: id })),
        })
        break
      case 'input':
        this.deliver([...this.peers.keys()], {
          type: 'input',
          event: msg.event,
          applyTick: this.tick() + INPUT_DELAY,
          seq: ++this.seq,
          from,
          serverTime: this.now,
        })
        break
      case 'checksum':
        this.checksums.push({ from, tick: msg.tick, hash: msg.hash })
        break
    }
  }

  /** the desync path: a corrective full state aimed at one peer only */
  pushSetState(to: PeerId, state: string, from: PeerId): void {
    this.deliver([to], {
      type: 'input',
      event: { type: 'setState', state },
      applyTick: this.tick() + INPUT_DELAY,
      seq: ++this.seq,
      from,
      serverTime: this.now,
    })
  }
}

function makePeer(relay: FakeRelay) {
  let sim: Simulation | null = null
  const state: { running: boolean; loads: number; look: StateLook } = {
    running: true,
    loads: 0,
    // the host's live render config; a scene's look overwrites it on every peer
    look: { light: true, darkness: 0.55 },
  }
  const session = new NetSession({
    url: 'ws://fake',
    connect: relay.connect,
    now: () => relay.now,
  })
  session.attach({
    getSim: () => sim,
    reseed: (seed) => {
      sim = new Simulation(W, H, seed)
      return sim
    },
    isRunning: () => state.running,
    setRunning: (on) => {
      state.running = on
    },
    setLook: (look) => {
      state.look = { ...look }
    },
    onStateLoaded: () => {
      state.loads++
    },
  })
  session.createRoom('peer')
  return {
    session,
    state,
    sim: (): Simulation => {
      if (sim === null) throw new Error('no simulation')
      return sim
    },
  }
}

type Peer = ReturnType<typeof makePeer>

/** non-empty cells; `Simulation.count` is only refreshed by render(), which tests never call */
function filled(sim: Simulation): number {
  let n = 0
  for (const cell of sim.cells) if (cell !== Mat.EMPTY) n++
  return n
}

/** run the relay clock forward in 16 ms frames, advancing every peer each frame */
function run(relay: FakeRelay, peers: Peer[], ms: number): void {
  const end = relay.now + ms
  while (relay.now < end) {
    relay.now = Math.min(end, relay.now + 16)
    for (const peer of peers) peer.session.advance(100)
  }
}

describe('NetSession', () => {
  it('joins a room and adopts the room seed', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    expect(a.session.status).toBe('connected')
    expect(a.session.room).toBe('TEST')
    expect(a.session.you).toBe('p0')
    // the fresh sim is the room's, not the one the host booted with
    expect(a.sim().tick).toBe(0)
  })

  it('never applies its own input before the broadcast comes back', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    a.session.sendInput({ type: 'paint', pts: [10, 10], r: 3, mat: Mat.SAND })
    expect(filled(a.sim())).toBe(0)
    // still nothing a few ticks in, because applyTick is INPUT_DELAY away
    run(relay, [a], TICK_MS * 4)
    expect(filled(a.sim())).toBe(0)
    run(relay, [a], TICK_MS * INPUT_DELAY)
    expect(filled(a.sim())).toBeGreaterThan(0)
  })

  it('keeps two peers bit-identical through a stroke', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    const b = makePeer(relay)
    const peers = [a, b]

    run(relay, peers, 200)
    a.session.sendInput({ type: 'paint', pts: [10, 5, 11, 5, 12, 5], r: 3, mat: Mat.SAND })
    run(relay, peers, 200)
    b.session.sendInput({ type: 'paint', pts: [20, 5], r: 4, mat: Mat.WATER })
    a.session.sendInput({ type: 'strike', x: 30, y: 4 })
    run(relay, peers, 1500)

    expect(a.session.roomTick).toBe(b.session.roomTick)
    expect(filled(a.sim())).toBeGreaterThan(0)
    expect(a.sim().checksum()).toBe(b.sim().checksum())
  })

  it('gives every peer the scene look when one of them loads a preset', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    const b = makePeer(relay)
    const peers = [a, b]
    run(relay, peers, 200)

    // exactly what useSimulation's loadPreset does inside a room: build the
    // scene state off the live one, tag it with the gallery scene's authored
    // look, and broadcast. the picking client applies nothing locally.
    const scratch = new Simulation(W, H)
    scratch.loadState(a.sim().serializeState())
    const cells = new Uint8Array(W * H)
    for (let i = 0; i < 100; i++) cells[i] = Mat.SAND
    scratch.restore(cells)
    const look: StateLook = { light: false, darkness: 0.2 }
    const state = encodeStateEnvelope(a.session.roomTick, false, scratch.serializeState(), look)
    a.session.sendInput({ type: 'setState', state, reason: 'load' })
    a.session.sendInput({ type: 'running', on: false })
    run(relay, peers, 500)

    // the grid agrees (this already held) AND so does the picture
    expect(a.sim().checksum()).toBe(b.sim().checksum())
    expect(filled(a.sim())).toBe(100)
    expect(a.state.look).toEqual(look)
    expect(b.state.look).toEqual(look)
  })

  it('leaves each peer its own look when a corrective state carries none', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    const b = makePeer(relay)
    const peers = [a, b]
    run(relay, peers, 200)
    b.state.look = { light: false, darkness: 0.9 }
    const state = a.session.serializeEnvelope()
    expect(state).not.toBeNull()
    relay.pushSetState('p1', state as string, 'p0')
    run(relay, peers, 500)
    expect(b.state.look).toEqual({ light: false, darkness: 0.9 })
  })

  it('pauses the room for everyone through a running input', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    const b = makePeer(relay)
    const peers = [a, b]
    a.session.sendInput({ type: 'running', on: false })
    run(relay, peers, 500)
    expect(a.state.running).toBe(false)
    expect(b.state.running).toBe(false)
    const frozen = a.sim().tick
    // the room clock keeps running while the simulation does not
    run(relay, peers, 500)
    expect(a.sim().tick).toBe(frozen)
    expect(a.session.roomTick).toBeGreaterThan(frozen)
    expect(a.sim().checksum()).toBe(b.sim().checksum())
  })

  it('reports a checksum on the interval', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    run(relay, [a], TICK_MS * 320)
    expect(relay.checksums.length).toBeGreaterThan(0)
    expect(relay.checksums[0].tick % 300).toBe(0)
  })

  it('recovers from a desync by loading a state and replaying the input log', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    const b = makePeer(relay)
    const peers = [a, b]

    run(relay, peers, 300)
    // past the join grace, so the correction below is counted as a real desync
    relay.now += 6_000
    run(relay, peers, 300)

    // the authority answers a state request HERE; by the time the corrective
    // state reaches the straggler it is several hundred ticks in the past.
    const state = a.session.serializeEnvelope()
    expect(state).not.toBeNull()
    const staleTick = a.session.roomTick

    // ordinary inputs keep flowing in the window that will have to be replayed
    a.session.sendInput({ type: 'paint', pts: [10, 5, 11, 5], r: 4, mat: Mat.SAND })
    run(relay, peers, 300)
    b.session.sendInput({ type: 'paint', pts: [24, 5], r: 3, mat: Mat.WATER })
    run(relay, peers, 600)
    expect(a.session.roomTick).toBeGreaterThan(staleTick + 20)
    expect(a.sim().checksum()).toBe(b.sim().checksum())

    // corrupt b out of band, the way a real divergence shows up
    b.sim().paint(25, 20, 2, Mat.STONE)
    expect(a.sim().checksum()).not.toBe(b.sim().checksum())

    relay.pushSetState('p1', state as string, 'p0')
    run(relay, peers, 1000)

    expect(b.session.desyncs).toBe(1)
    expect(a.session.roomTick).toBe(b.session.roomTick)
    expect(b.sim().checksum()).toBe(a.sim().checksum())
  })

  it('thermal strokes wait for broadcast, work while paused, and replay on resync', () => {
    const relay = new FakeRelay(), a = makePeer(relay), b = makePeer(relay), peers = [a, b]
    a.session.sendInput({ type: 'running', on: false })
    run(relay, peers, 200)
    const before = a.sim().serializeState()
    a.session.sendInput({ type: 'paint', pts: [16, 15, 16, 15], r: 3, mat: Mat.HEAT })
    expect(a.sim().serializeState()).toEqual(before)
    run(relay, peers, 200)
    expect(a.sim().heat[15 * W + 16]).toBe(340)
    expect(a.sim().serializeState()).toEqual(b.sim().serializeState())
    const stale = a.session.serializeEnvelope()!
    b.session.sendInput({ type: 'paint', pts: [16, 15], r: 2, mat: Mat.COOL })
    run(relay, peers, 200)
    b.sim().paint(4, 4, 1, Mat.WOOD)
    relay.pushSetState('p1', stale, 'p0')
    run(relay, peers, 300)
    expect(b.sim().serializeState()).toEqual(a.sim().serializeState())
  })

  it('a late joiner adopts live thermal pressure and resumes exactly', () => {
    const relay = new FakeRelay(), a = makePeer(relay)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) {
      a.sim().paint(x, y, 0, x === 10 || x === 19 || y === 10 || y === 19 ? Mat.WALL : Mat.STEAM)
    }
    run(relay, [a], 40)
    expect(a.sim().pressure.some(p => p > 0)).toBe(true)
    relay.joinedState = a.session.serializeEnvelope()
    const b = makePeer(relay)
    expect(b.sim().serializeState()).toEqual(a.sim().serializeState())
    a.session.sendInput({ type: 'paint', pts: [15, 16], r: 3, mat: Mat.HEAT })
    run(relay, [a, b], 1500)
    expect(b.sim().serializeState()).toEqual(a.sim().serializeState())
  })

  it('disconnects with an actionable error instead of running an incompatible snapshot', () => {
    const relay = new FakeRelay(), a = makePeer(relay)
    const bytes = a.sim().serializeState(); bytes[2] = 1
    const bad = encodeStateEnvelope(a.session.roomTick, true, bytes)
    relay.pushSetState('p0', bad, 'p0')
    run(relay, [a], 500)
    expect(a.session.status).toBe('error')
    expect(a.session.connected).toBe(false)
    expect(a.session.error).toContain('same build')
    relay.joinedState = bad
    const b = makePeer(relay)
    expect(b.session.status).toBe('error')
    expect(b.session.error).toContain('same build')
  })

  it('goes back to single player when the socket drops', () => {
    const relay = new FakeRelay()
    const a = makePeer(relay)
    a.session.leave()
    expect(a.session.connected).toBe(false)
    expect(a.session.room).toBeNull()
    // a stale input is a no-op rather than a local edit
    expect(a.session.sendInput({ type: 'clear' })).toBe(false)
    relay.now += 10_000
    expect(a.session.advance(100)).toBe(0)
  })
})
