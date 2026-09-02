import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { type RelayServer, startRelay } from '../src/index.ts'
import { INPUT_DELAY } from '../src/protocol.ts'

/** a fake client: sends json, buffers everything the server sends back */
class FakeClient {
  private readonly socket: WebSocket
  private readonly inbox: Record<string, unknown>[] = []
  private readonly waiters: { type: string; resolve: (msg: Record<string, unknown>) => void }[] = []

  constructor(port: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`)
    this.socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>
      const waiter = this.waiters.findIndex((w) => w.type === msg.type)
      if (waiter >= 0) {
        const [w] = this.waiters.splice(waiter, 1)
        w.resolve(msg)
        return
      }
      this.inbox.push(msg)
    })
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve())
      this.socket.once('error', reject)
    })
  }

  send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg))
  }

  /** send a frame verbatim, to exercise the parser's rejection paths */
  sendRaw(frame: string): void {
    this.socket.send(frame)
  }

  /** resolve with the next (or already buffered) message of this type */
  next(type: string): Promise<Record<string, unknown>> {
    const buffered = this.inbox.findIndex((m) => m.type === type)
    if (buffered >= 0) return Promise.resolve(this.inbox.splice(buffered, 1)[0])
    return new Promise((resolve) => this.waiters.push({ type, resolve }))
  }

  close(): void {
    this.socket.close()
  }
}

describe('relay end to end', () => {
  let relay: RelayServer

  beforeAll(async () => {
    relay = startRelay(0)
    await new Promise<void>((resolve) => relay.wss.once('listening', () => resolve()))
  })

  afterAll(async () => {
    await relay.close()
  })

  it('carries a stamped input between two real clients', async () => {
    const a = new FakeClient(relay.port())
    await a.open()
    a.send({ type: 'join', name: 'ada' })
    const joinedA = await a.next('joined')
    expect(typeof joinedA.room).toBe('string')

    const b = new FakeClient(relay.port())
    await b.open()
    b.send({ type: 'join', room: joinedA.room, name: 'bo' })
    const joinedB = await b.next('joined')
    expect(joinedB.room).toBe(joinedA.room)
    expect(joinedB.seed).toBe(joinedA.seed)

    b.send({ type: 'input', event: { type: 'paint', x: 10, y: 20, r: 3, mat: 2 } })
    const onA = await a.next('input')
    const onB = await b.next('input')
    expect(onA.event).toEqual({ type: 'paint', x: 10, y: 20, r: 3, mat: 2 })
    expect(onA).toEqual(onB)
    expect(onA.from).toBe(joinedB.you)
    expect(onA.seq).toBe(1)
    expect(onA.applyTick as number).toBeGreaterThanOrEqual((joinedB.tick as number) + INPUT_DELAY)

    // the cursor relay reaches the other peer and carries no tick
    b.send({ type: 'cursor', x: 4, y: 5 })
    const cursor = await a.next('cursor')
    expect(cursor).toMatchObject({ from: joinedB.you, x: 4, y: 5 })
    expect(cursor.applyTick).toBeUndefined()

    a.close()
    b.close()
  })

  it('gives a late joiner the authority state', async () => {
    const a = new FakeClient(relay.port())
    await a.open()
    a.send({ type: 'join', name: 'ada' })
    const joinedA = await a.next('joined')
    expect(joinedA.state).toBeNull()

    // b joins: the server asks a (the oldest peer) for a fresh full state and
    // forwards it to b as a setState input
    const b = new FakeClient(relay.port())
    await b.open()
    b.send({ type: 'join', room: joinedA.room, name: 'bo' })
    await b.next('joined')
    await a.next('stateRequest')
    a.send({ type: 'state', state: 'QkxPQg==' })
    const resync = await b.next('input')
    expect(resync.event).toEqual({ type: 'setState', state: 'QkxPQg==' })

    // and the next joiner gets that state straight out of the cache
    const c = new FakeClient(relay.port())
    await c.open()
    c.send({ type: 'join', room: joinedA.room, name: 'cy' })
    const joinedC = await c.next('joined')
    expect(joinedC.state).toBe('QkxPQg==')
    expect((joinedC.peers as unknown[]).length).toBe(3)

    a.close()
    b.close()
    c.close()
  })

  it('errors on an unknown room and on garbage frames', async () => {
    const a = new FakeClient(relay.port())
    await a.open()
    a.send({ type: 'join', room: 'ZZZZZZ' })
    expect((await a.next('error')).message).toBe('no such room: ZZZZZZ')
    a.sendRaw('not json at all')
    expect((await a.next('error')).message).toBe('malformed json')
    a.close()
  })

  it('refuses state from a peer that is not the authority', async () => {
    const a = new FakeClient(relay.port())
    await a.open()
    a.send({ type: 'join', name: 'ada' })
    const joinedA = await a.next('joined')
    const b = new FakeClient(relay.port())
    await b.open()
    b.send({ type: 'join', room: joinedA.room, name: 'bo' })
    await b.next('joined')
    b.send({ type: 'state', state: 'QkxPQg==' })
    expect((await b.next('error')).message).toBe('only the room authority may supply state')
    a.close()
    b.close()
  })
})
