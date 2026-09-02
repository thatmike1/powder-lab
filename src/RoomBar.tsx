import { useEffect, useRef, useState } from 'react'
import type { NetApi } from './net'
import { peerColor } from './peer-color'

/**
 * the query key that carries a join link. deliberately a query parameter and
 * not a hash fragment: scene sharing already owns the hash as "#s=...", and a
 * room link has to survive a scene being shared or loaded on top of it.
 */
const ROOM_PARAM = 'room'

const STATUS_LABEL: Record<NetApi['status'], string> = {
  disconnected: 'Solo',
  connecting: 'Dialling',
  connected: 'Live',
  error: 'Dropped',
}

// hand-pixeled on the same 8x8 grid as pixel-icons.tsx: two little heads.
function PeersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width={size}
      height={size}
      className="room-icon"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="2" height="2" />
      <rect x="0" y="4" width="4" height="3" />
      <rect x="5" y="2" width="2" height="2" />
      <rect x="4" y="5" width="4" height="2" />
    </svg>
  )
}

/** read the room code a join link put in the address bar, if there is one. */
function roomFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get(ROOM_PARAM)
  return code ? code.toUpperCase() : null
}

/** keep ?room= in step with the session, without disturbing the scene hash. */
function writeRoomToUrl(room: string | null): void {
  const url = new URL(location.href)
  if (room) url.searchParams.set(ROOM_PARAM, room)
  else url.searchParams.delete(ROOM_PARAM)
  history.replaceState(null, '', url)
}

interface RoomBarProps {
  net: NetApi
}

/**
 * the multiplayer control: a titlebar pill that reports connection state at a
 * glance and opens a panel for starting, joining and leaving a room.
 *
 * a dropped socket is terminal in v1, so the pill goes to a loud "dropped"
 * state rather than pretending the room is still there; the panel then shows
 * the reason from `net.error` and the user is explicitly back in single-player.
 */
export function RoomBar({ net }: RoomBarProps) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const autoJoined = useRef(false)

  const { status, room, peers, you, error, connected } = net

  // a join link joins on arrival, once, so a pasted URL just works.
  useEffect(() => {
    if (autoJoined.current) return
    autoJoined.current = true
    const fromUrl = roomFromUrl()
    if (fromUrl) net.joinRoom(fromUrl)
  }, [net])

  // the address bar mirrors the room so the current URL is always shareable. a
  // drop leaves the code in place on purpose — a refresh should rejoin rather
  // than lose the room — so only an explicit leave (below) clears it.
  useEffect(() => {
    if (room) writeRoomToUrl(room)
  }, [room])

  // close the panel on outside click or ESC, the way the gallery closes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = async (what: 'code' | 'link', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1200)
    } catch {
      // clipboard denied (insecure origin, permissions) — the code is on screen.
    }
  }

  const leaveRoom = () => {
    net.leave()
    writeRoomToUrl(null)
  }

  const joinTyped = () => {
    const trimmed = code.trim().toUpperCase()
    if (trimmed) net.joinRoom(trimmed, name.trim() || undefined)
  }

  const linkFor = (r: string) => {
    const url = new URL(location.href)
    url.searchParams.set(ROOM_PARAM, r)
    return url.toString()
  }

  return (
    <div className="room-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`room-open ${status}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={connected ? `In room ${room}` : 'Play together in a room'}
      >
        <span className="room-led" aria-hidden="true" />
        <PeersIcon />
        {connected && room ? room : STATUS_LABEL[status]}
      </button>

      {open && (
        <div className="room-pop" role="dialog" aria-label="Multiplayer room">
          <div className={`room-status ${status}`}>
            <span className="room-led" aria-hidden="true" />
            {status === 'connected' && `Connected — ${peers.length} in room`}
            {status === 'connecting' && 'Connecting to the relay…'}
            {status === 'disconnected' && 'Single-player. Nothing is shared.'}
            {status === 'error' && 'Disconnected. You are back in single-player.'}
          </div>

          {error && status !== 'connected' && <p className="room-error">{error}</p>}

          {connected && room ? (
            <>
              <span className="room-code">{room}</span>
              <div className="room-copy">
                <button type="button" className="room-btn" onClick={() => copy('code', room)}>
                  {copied === 'code' ? 'Copied' : 'Copy code'}
                </button>
                <button
                  type="button"
                  className="room-btn"
                  onClick={() => copy('link', linkFor(room))}
                >
                  {copied === 'link' ? 'Copied' : 'Copy link'}
                </button>
              </div>

              <ul className="peer-list">
                {peers.map((peer) => (
                  <li key={peer.id}>
                    <span className="peer-dot" style={{ background: peerColor(peer.id) }} />
                    <span className="peer-name">{peer.name}</span>
                    {peer.id === you && <span className="peer-you">you</span>}
                  </li>
                ))}
              </ul>

              <button type="button" className="room-btn wide" onClick={leaveRoom}>
                Leave room
              </button>
            </>
          ) : (
            <>
              <input
                className="room-input"
                value={name}
                maxLength={16}
                placeholder="your name (optional)"
                aria-label="Your name"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="button"
                className="room-btn wide primary"
                disabled={status === 'connecting'}
                onClick={() => net.createRoom(name.trim() || undefined)}
              >
                Start a room
              </button>
              <div className="room-join">
                <input
                  className="room-input code"
                  value={code}
                  maxLength={8}
                  placeholder="CODE"
                  aria-label="Room code"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') joinTyped()
                  }}
                />
                <button
                  type="button"
                  className="room-btn"
                  disabled={status === 'connecting' || code.trim() === ''}
                  onClick={joinTyped}
                >
                  Join
                </button>
              </div>
              {status === 'connecting' && (
                <button type="button" className="room-btn wide" onClick={leaveRoom}>
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
