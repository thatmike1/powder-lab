import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import { MAX_MESSAGE_BYTES, type Outbound, type PeerId, parseClientMessage } from './protocol.ts'
import { RoomRegistry } from './registry.ts'

/** how often rooms are swept for state refreshes and expiry */
const MAINTENANCE_MS = 1_000

/** how often peers are pinged; a peer that misses one whole interval is evicted */
const HEARTBEAT_MS = 30_000

export type RelayServer = {
  wss: WebSocketServer
  registry: RoomRegistry
  /** actual listening port, useful when the server was started on port 0 */
  port: () => number
  close: () => Promise<void>
}

/**
 * start the relay. the socket layer is a thin shell: it assigns peer ids, parses
 * frames, hands them to the pure registry and delivers whatever comes back.
 */
export function startRelay(
  port = Number(process.env.PORT ?? 8787),
  heartbeatMs = HEARTBEAT_MS,
): RelayServer {
  const wss = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES })
  const registry = new RoomRegistry()
  const sockets = new Map<PeerId, WebSocket>()
  /** peers that have answered a ping since the last heartbeat sweep */
  const alive = new Set<PeerId>()

  const deliver = (outbound: Outbound[]): void => {
    for (const { to, msg } of outbound) {
      const frame = JSON.stringify(msg)
      for (const id of to) {
        const socket = sockets.get(id)
        if (socket?.readyState === WebSocket.OPEN) socket.send(frame)
      }
    }
  }

  wss.on('connection', (socket) => {
    const peerId = randomUUID().slice(0, 8)
    sockets.set(peerId, socket)
    alive.add(peerId)
    socket.on('pong', () => {
      alive.add(peerId)
    })

    socket.on('message', (data: RawData, isBinary: boolean) => {
      const now = Date.now()
      if (isBinary) {
        deliver([
          { to: [peerId], msg: { type: 'error', message: 'expected text', serverTime: now } },
        ])
        return
      }
      const parsed = parseClientMessage(data.toString())
      if ('reason' in parsed) {
        deliver([{ to: [peerId], msg: { type: 'error', message: parsed.reason, serverTime: now } }])
        return
      }
      deliver(registry.handle(peerId, parsed.msg, now))
    })

    socket.on('close', () => {
      sockets.delete(peerId)
      alive.delete(peerId)
      deliver(registry.leave(peerId, Date.now()))
    })

    socket.on('error', () => {
      socket.terminate()
    })
  })

  const timer = setInterval(() => deliver(registry.maintain(Date.now())), MAINTENANCE_MS)

  // a half-open socket never fires 'close', so its peer would sit in the roster
  // forever, possibly holding room authority. ping every peer and evict the ones
  // that did not answer the previous ping.
  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const [id, socket] of sockets) {
      if (!alive.has(id)) {
        sockets.delete(id)
        deliver(registry.leave(id, now))
        socket.terminate()
        continue
      }
      alive.delete(id)
      socket.ping()
    }
  }, heartbeatMs)

  return {
    wss,
    registry,
    port: () => {
      const address = wss.address()
      return typeof address === 'object' && address !== null ? address.port : port
    },
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer)
        clearInterval(heartbeat)
        for (const socket of sockets.values()) socket.terminate()
        wss.close(() => resolve())
      }),
  }
}

// started directly (npm run server) rather than imported by a test
const entry = process.argv[1]
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const relay = startRelay()
  relay.wss.on('listening', () => {
    console.log(`powder-lab relay listening on ws://localhost:${relay.port()}`)
  })
}
