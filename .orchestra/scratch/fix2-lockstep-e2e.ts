// two real clients over real sockets against the relay, checked for lockstep.
// run as a temporary vitest file (it needs the ImageData shim in test/setup.ts).
import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { Mat } from '../../src/sim/materials'
import { Simulation } from '../../src/sim/Simulation'
import { NetSession, type Connect } from '../../src/net'
import { MagnetBatcher, StrokeBatcher } from '../../src/net/stroke-batcher'

const URL = 'ws://127.0.0.1:8899'
const W = 200
const H = 150

const connect: Connect = (url, handlers) => {
  const socket = new WebSocket(url)
  socket.on('open', () => handlers.onOpen())
  socket.on('message', (data: Buffer) => handlers.onMessage(data.toString()))
  socket.on('close', () => handlers.onClose('closed'))
  socket.on('error', (err: Error) => handlers.onError(err.message))
  return {
    send: (data: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    },
    close: () => socket.close(),
    get open() {
      return socket.readyState === WebSocket.OPEN
    },
  }
}

function client(label: string) {
  let sim: Simulation | null = null
  let running = true
  const session = new NetSession({ url: URL, connect })
  session.attach({
    getSim: () => sim,
    reseed: (seed) => {
      sim = new Simulation(W, H, seed)
      return sim
    },
    isRunning: () => running,
    setRunning: (on) => {
      running = on
    },
  })
  const seen = new Map<number, number>()
  const strokes = new StrokeBatcher({ send: (e) => session.sendInput(e) })
  const magnets = new MagnetBatcher({ send: (e) => session.sendInput(e) })
  return {
    label,
    session,
    seen,
    strokes,
    magnets,
    get sim() {
      return sim
    },
    get running() {
      return running
    },
    tickOnce(now: number) {
      session.advance(64)
      strokes.poll(now)
      magnets.poll(now)
      if (sim && session.connected) seen.set(session.roomTick, sim.checksum())
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** non-empty cells; `Simulation.count` only refreshes on render, which we never call */
function filled(sim: Simulation | null): number {
  if (sim === null) return 0
  let n = 0
  for (let k = 0; k < sim.cells.length; k++) if (sim.cells[k] !== Mat.EMPTY) n++
  return n
}

it('two clients stay in lockstep', async () => {
  const a = client('A')
  const b = client('B')
  let stop = false
  const pump = (async () => {
    while (!stop) {
      const now = Date.now()
      a.tickOnce(now)
      b.tickOnce(now)
      await sleep(8)
    }
  })()

  a.session.createRoom('alice')
  for (let i = 0; i < 200 && a.session.room === null; i++) await sleep(20)
  expect(a.session.room).not.toBeNull()
  b.session.joinRoom(a.session.room as string, 'bob')
  for (let i = 0; i < 200 && !b.session.connected; i++) await sleep(20)
  expect(b.session.connected).toBe(true)
  await sleep(300)

  // both paint, mashing the material mid-stroke (the finding-2 adversarial case)
  for (let f = 0; f < 60; f++) {
    const now = Date.now()
    a.strokes.add(now, 40 + f, 20, 4, f % 5 === 0 ? Mat.SAND : Mat.WATER)
    b.strokes.add(now, 120 - f, 25, 3, f % 3 === 0 ? Mat.STONE : Mat.SAND)
    await sleep(16)
  }
  a.strokes.flush(Date.now())
  b.strokes.flush(Date.now())
  await sleep(400)

  // both magnet
  for (let f = 0; f < 40; f++) {
    const now = Date.now()
    a.magnets.add(now, 60, 60, 10, true)
    b.magnets.add(now, 100, 60, 8, false)
    await sleep(16)
  }
  a.magnets.flush(Date.now())
  b.magnets.flush(Date.now())
  await sleep(400)

  // pause from A, unpause from B
  a.session.sendInput({ type: 'running', on: false })
  await sleep(600)
  expect(a.running).toBe(false)
  expect(b.running).toBe(false)
  b.session.sendInput({ type: 'running', on: true })
  await sleep(600)
  expect(a.running).toBe(true)
  expect(b.running).toBe(true)

  await sleep(1000)
  stop = true
  await pump

  let common = 0
  let mismatch = 0
  for (const [tick, hash] of a.seen) {
    const other = b.seen.get(tick)
    if (other === undefined) continue
    common++
    if (other !== hash) mismatch++
  }
  console.log(
    `[lockstep] compared ticks=${common} mismatches=${mismatch} ` +
      `A.tick=${a.session.roomTick} B.tick=${b.session.roomTick} ` +
      `A.checksum=${a.sim?.checksum()} B.checksum=${b.sim?.checksum()} ` +
      `desyncs A=${a.session.desyncs} B=${b.session.desyncs} ` +
      `late A=${a.session.lateInputs} B=${b.session.lateInputs} ` +
      `cells A=${filled(a.sim)} B=${filled(b.sim)}`,
  )
  expect(common).toBeGreaterThan(100)
  expect(mismatch).toBe(0)
  expect(a.session.desyncs).toBe(0)
  expect(b.session.desyncs).toBe(0)
  expect(a.sim?.checksum()).toBe(b.sim?.checksum())
  expect(filled(a.sim)).toBeGreaterThan(100)

  a.session.leave()
  b.session.leave()
}, 60_000)
