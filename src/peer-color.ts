import type { PeerId } from './net'

// peers need a colour that is the same in every tab without the server sending
// one, so it is derived from the id. FNV-1a over the id, folded to a hue.
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * a stable, distinct chroma-matched colour for a peer id. identical in every
 * client because it is a pure function of the id the relay handed out.
 */
export function peerColor(id: PeerId): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // golden-ratio stride keeps neighbouring ids far apart on the wheel.
  const hue = (Math.abs(hash) * 137.508) % 360
  return `oklch(0.8 0.16 ${hue.toFixed(1)})`
}
