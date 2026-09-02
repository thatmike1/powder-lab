import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PeerId, PeerInfo } from './protocol'
import {
  type ConnectionStatus,
  NetSession,
  type NetSessionOptions,
  type PeerCursor,
} from './session'

/**
 * everything the UI needs to render multiplayer, and nothing it does not.
 *
 * the fields here re-render on connection, roster and desync changes only.
 * `cursors` is deliberately NOT one of them: it is the session's live map,
 * mutated in place at ~10 Hz per peer, so read it inside your own animation
 * frame (subscribe with `subscribeCursors` if you want to know when it moved)
 * rather than copying it into React state.
 */
export interface NetApi {
  status: ConnectionStatus
  connected: boolean
  /** room code once joined, e.g. "K7QF" */
  room: string | null
  /** this client's peer id, matching one entry of `peers` */
  you: PeerId | null
  peers: PeerInfo[]
  /** last connection or server error, kept after a drop so the UI can show why */
  error: string | null
  /** how many times a server-pushed full state has corrected this client */
  desyncs: number
  /** live peer cursors in grid coordinates; a stable Map, mutated in place */
  cursors: Map<PeerId, PeerCursor>
  createRoom: (name?: string) => void
  joinRoom: (code: string, name?: string) => void
  leave: () => void
  /** broadcast your own cursor in grid coordinates; throttled internally */
  sendCursor: (x: number, y: number) => void
  subscribeCursors: (listener: () => void) => () => void
}

/**
 * owns one {@link NetSession} for the lifetime of the component and mirrors its
 * coarse state into React. returns the session too, for the simulation loop.
 */
export function useNet(options: NetSessionOptions = {}): { session: NetSession; net: NetApi } {
  const [version, setVersion] = useState(0)
  const sessionRef = useRef<NetSession | null>(null)
  if (sessionRef.current === null) {
    sessionRef.current = new NetSession({
      ...options,
      onChange: () => setVersion((v) => v + 1),
    })
  }
  const session = sessionRef.current

  useEffect(() => {
    return () => session.leave()
  }, [session])

  const createRoom = useCallback((name?: string) => session.createRoom(name), [session])
  const joinRoom = useCallback(
    (code: string, name?: string) => session.joinRoom(code, name),
    [session],
  )
  const leave = useCallback(() => session.leave(), [session])
  const sendCursor = useCallback((x: number, y: number) => session.sendCursor(x, y), [session])
  const subscribeCursors = useCallback(
    (listener: () => void) => session.subscribeCursors(listener),
    [session],
  )

  const net = useMemo<NetApi>(() => {
    // the session mutates in place, so `version` is the only thing that can say
    // one of these fields changed. reading it here is what makes it a dependency.
    void version
    return {
      status: session.status,
      connected: session.connected,
      room: session.room,
      you: session.you,
      peers: session.peers,
      error: session.error,
      desyncs: session.desyncs,
      cursors: session.cursors,
      createRoom,
      joinRoom,
      leave,
      sendCursor,
      subscribeCursors,
    }
  }, [session, version, createRoom, joinRoom, leave, sendCursor, subscribeCursors])

  return { session, net }
}
