import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectWebSocket, defaultRelayUrl, type TransportHandlers } from './transport'

/** A controlled socket boundary; no connection to the real relay is opened. */
class SocketDouble extends EventTarget {
  static readonly OPEN = 1
  static instances: SocketDouble[] = []
  readyState = 0
  send = vi.fn()
  close = vi.fn()

  constructor(readonly url: string) {
    super()
    SocketDouble.instances.push(this)
  }

  emit(type: string, fields: Record<string, unknown> = {}) {
    this.dispatchEvent(Object.assign(new Event(type), fields))
  }
}

function connected() {
  const handlers: TransportHandlers = {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  }
  const transport = connectWebSocket('wss://relay.test/room', handlers)
  const socket = SocketDouble.instances[0]
  return { transport, socket, handlers }
}

beforeEach(() => {
  SocketDouble.instances = []
  vi.stubGlobal('WebSocket', SocketDouble)
  vi.stubEnv('VITE_RELAY_URL', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('browser transport boundary', () => {
  it('opens the requested URL and notifies the session when the handshake completes', () => {
    const { socket, handlers } = connected()
    expect(socket.url).toBe('wss://relay.test/room')
    expect(handlers.onOpen).not.toHaveBeenCalled()
    socket.emit('open')
    expect(handlers.onOpen).toHaveBeenCalledOnce()
  })

  it('delivers text frames without altering their contents or order', () => {
    const { socket, handlers } = connected()
    socket.emit('message', { data: '{"type":"joined"}' })
    socket.emit('message', { data: 'second\nframe' })
    expect(handlers.onMessage).toHaveBeenNthCalledWith(1, '{"type":"joined"}')
    expect(handlers.onMessage).toHaveBeenNthCalledWith(2, 'second\nframe')
    expect(handlers.onMessage).toHaveBeenCalledTimes(2)
  })

  it('ignores binary frames rather than feeding them to the JSON protocol parser', () => {
    const { socket, handlers } = connected()
    socket.emit('message', { data: new ArrayBuffer(4) })
    socket.emit('message', { data: new Blob(['binary']) })
    expect(handlers.onMessage).not.toHaveBeenCalled()
  })

  it('preserves the relay close reason so the session can explain a disconnect', () => {
    const { socket, handlers } = connected()
    socket.emit('close', { reason: 'room expired' })
    expect(handlers.onClose).toHaveBeenCalledWith('room expired')
    expect(handlers.onClose).toHaveBeenCalledOnce()
  })

  it('provides a readable reason when the socket closes without one', () => {
    const { socket, handlers } = connected()
    socket.emit('close', { reason: '' })
    expect(handlers.onClose).toHaveBeenCalledWith('connection closed')
    expect(handlers.onClose).toHaveBeenCalledOnce()
  })

  it('turns the opaque socket error event into a usable connection error', () => {
    const { socket, handlers } = connected()
    socket.emit('error')
    expect(handlers.onError).toHaveBeenCalledWith('connection failed')
    expect(handlers.onError).toHaveBeenCalledOnce()
  })

  it('sends only while the socket is open and drops writes during other states', () => {
    const { socket, transport } = connected()
    transport.send('connecting')
    socket.readyState = 1
    transport.send('live')
    socket.readyState = 2
    transport.send('closing')
    socket.readyState = 3
    transport.send('closed')
    expect(socket.send).toHaveBeenCalledWith('live')
    expect(socket.send).toHaveBeenCalledOnce()
  })

  it('closes its own socket when the caller leaves the room', () => {
    const { socket, transport } = connected()
    transport.close()
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('reads current socket readiness rather than retaining an earlier open state', () => {
    const { socket, transport } = connected()
    expect(transport.open).toBe(false)
    socket.readyState = 1
    expect(transport.open).toBe(true)
    socket.readyState = 2
    expect(transport.open).toBe(false)
    socket.readyState = 3
    expect(transport.open).toBe(false)
  })
})

describe('relay address selection', () => {
  it('uses a secure WebSocket beside an HTTPS page', () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'powder.test', port: '443' })
    expect(defaultRelayUrl()).toBe('wss://powder.test:8787')
  })

  it('uses the relay port and hostname beside a plain HTTP development page', () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'dev.test', port: '5173' })
    expect(defaultRelayUrl()).toBe('ws://dev.test:8787')
  })

  it('has a localhost fallback outside a browser', () => {
    vi.stubGlobal('location', undefined)
    expect(defaultRelayUrl()).toBe('ws://localhost:8787')
  })
})
