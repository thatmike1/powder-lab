import { useEffect, useRef } from 'react'
import type { NetApi, PeerId } from './net'
import { peerColor } from './peer-color'

// a cursor holds full strength this long after its last update, then fades out
// over the remainder. a peer that stopped moving should not linger forever, and
// a peer that went quiet should not look like it is still pointing somewhere.
const HOLD_MS = 2500
const FADE_MS = 2500

interface CursorOverlayProps {
  net: NetApi
  /** grid width in cells, for mapping cursor coordinates to percentages */
  W: number
  /** grid height in cells */
  H: number
}

/**
 * peer cursors as a DOM layer above the canvas. purely cosmetic: it reads the
 * session's live cursor Map inside its own animation frame and writes straight
 * to element styles, so no per-frame data ever reaches React state and nothing
 * here can touch the simulation. a missing or stale cursor simply does not draw.
 */
export function CursorOverlay({ net, W, H }: CursorOverlayProps) {
  const { cursors, subscribeCursors, connected, you } = net
  const nodes = useRef(new Map<PeerId, HTMLDivElement>())

  useEffect(() => {
    if (!connected) return
    let raf = 0

    const paint = () => {
      let alive = false
      for (const [id, node] of nodes.current) {
        const cursor = cursors.get(id)
        const age = cursor ? Date.now() - cursor.at : Number.POSITIVE_INFINITY
        if (!cursor || age > HOLD_MS + FADE_MS) {
          node.style.opacity = '0'
          node.style.visibility = 'hidden'
          continue
        }
        alive = true
        node.style.visibility = 'visible'
        node.style.opacity = String(age <= HOLD_MS ? 1 : 1 - (age - HOLD_MS) / FADE_MS)
        // percentages rather than pixels: the canvas is responsive and this
        // layer is exactly its box, so the mapping survives any scale.
        node.style.left = `${((cursor.x + 0.5) / W) * 100}%`
        node.style.top = `${((cursor.y + 0.5) / H) * 100}%`
      }
      // nothing left to animate — idle out and wait for the next cursor packet.
      raf = alive ? requestAnimationFrame(paint) : 0
    }

    const kick = () => {
      if (raf === 0) raf = requestAnimationFrame(paint)
    }

    kick()
    const unsubscribe = subscribeCursors(kick)
    return () => {
      unsubscribe()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [connected, cursors, subscribeCursors, W, H])

  if (!connected) return null

  return (
    <div className="cursor-layer" aria-hidden="true">
      {net.peers
        .filter((peer) => peer.id !== you)
        .map((peer) => (
          <div
            key={peer.id}
            className="peer-cursor"
            style={{ color: peerColor(peer.id), visibility: 'hidden', opacity: 0 }}
            ref={(node) => {
              if (node) nodes.current.set(peer.id, node)
              else nodes.current.delete(peer.id)
            }}
          >
            <span className="pc-dot" />
            <span className="pc-name">{peer.name}</span>
          </div>
        ))}
    </div>
  )
}
