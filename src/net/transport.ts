// the socket seam. everything above this file is pure logic driven by a clock
// and a message stream, which is what lets the tests run a whole room without a
// server (see session.test.ts).

export interface TransportHandlers {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: (reason: string) => void
  onError: (message: string) => void
}

export interface Transport {
  send(data: string): void
  close(): void
  readonly open: boolean
}

/** opens a transport for a url and wires it to the handlers */
export type Connect = (url: string, handlers: TransportHandlers) => Transport

/** the real thing: a browser WebSocket, no library */
export const connectWebSocket: Connect = (url, handlers) => {
  const socket = new WebSocket(url)
  socket.addEventListener('open', () => handlers.onOpen())
  socket.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') handlers.onMessage(event.data)
  })
  socket.addEventListener('close', (event: CloseEvent) => {
    handlers.onClose(event.reason || 'connection closed')
  })
  socket.addEventListener('error', () => handlers.onError('connection failed'))
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

/**
 * where the relay lives. `VITE_RELAY_URL` wins; otherwise assume the relay runs
 * beside whatever served the page, on its default port.
 */
export function defaultRelayUrl(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_RELAY_URL?: string } }).env
  const configured = env?.VITE_RELAY_URL
  if (configured) return configured
  if (typeof location === 'undefined') return 'ws://localhost:8787'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.hostname}:8787`
}
