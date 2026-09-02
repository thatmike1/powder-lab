import {
  CHECKSUM_TICK_HISTORY,
  errorTo,
  INPUT_DELAY,
  type InputEvent,
  MAX_PEERS_PER_ROOM,
  type Outbound,
  type PeerId,
  type PeerInfo,
  STATE_REFRESH_MS,
  STATE_REQUEST_TIMEOUT_MS,
  TICK_MS,
} from './protocol.ts'

type PeerRecord = { id: PeerId; name: string; joinOrder: number }

/**
 * one room's pure logic: tick clock, peer roster, input stamping and ordering,
 * checksum comparison and the full-state cache for late joiners. it owns no
 * sockets — every method returns the messages the shell should deliver.
 */
export class Room {
  private readonly peers = new Map<PeerId, PeerRecord>()
  private joinCounter = 0
  private seq = 0
  /** tick -> reported hash per peer, pruned to the newest CHECKSUM_TICK_HISTORY ticks */
  private readonly checksums = new Map<number, Map<PeerId, number>>()
  /** peers waiting for a corrective full state */
  private readonly pendingResync = new Set<PeerId>()
  private stateRequestedAt: number | null = null
  private lastStateRefresh: number
  private latestState: string | null = null

  /** wall clock at which the room became empty, or null while it has peers */
  emptySince: number | null

  constructor(
    readonly code: string,
    readonly seed: number,
    readonly t0: number,
  ) {
    this.emptySince = t0
    this.lastStateRefresh = t0
  }

  /** the authoritative tick for a wall-clock instant */
  tickAt(now: number): number {
    return Math.floor((now - this.t0) / TICK_MS)
  }

  get size(): number {
    return this.peers.size
  }

  isFull(): boolean {
    return this.peers.size >= MAX_PEERS_PER_ROOM
  }

  has(id: PeerId): boolean {
    return this.peers.has(id)
  }

  /** the oldest peer still present, which acts as the state authority */
  authority(): PeerId | null {
    let best: PeerRecord | null = null
    for (const peer of this.peers.values()) {
      if (best === null || peer.joinOrder < best.joinOrder) best = peer
    }
    return best?.id ?? null
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => ({ id: p.id, name: p.name }))
  }

  /** cached full state served to late joiners, or null before the first one arrives */
  cachedState(): string | null {
    return this.latestState
  }

  private everyone(): PeerId[] {
    return [...this.peers.keys()]
  }

  /** ask the authority for a fresh full state, unless a request is already in flight */
  private requestState(now: number): Outbound[] {
    if (this.stateRequestedAt !== null && now - this.stateRequestedAt < STATE_REQUEST_TIMEOUT_MS) {
      return []
    }
    const auth = this.authority()
    if (auth === null) return []
    this.stateRequestedAt = now
    return [{ to: [auth], msg: { type: 'stateRequest', serverTime: now } }]
  }

  /** admit a peer, replying with `joined` and telling the room about the new roster */
  join(id: PeerId, name: string, now: number): Outbound[] {
    const hadPeers = this.peers.size > 0
    this.peers.set(id, { id, name, joinOrder: this.joinCounter++ })
    this.emptySince = null
    const out: Outbound[] = [
      {
        to: [id],
        msg: {
          type: 'joined',
          room: this.code,
          you: id,
          seed: this.seed,
          tick: this.tickAt(now),
          serverTime: now,
          state: this.latestState,
          peers: this.peerList(),
        },
      },
      { to: this.everyone(), msg: { type: 'peers', peers: this.peerList(), serverTime: now } },
    ]
    // the cached state can be up to STATE_REFRESH_MS stale, so pull a fresh one
    // and push it to the joiner through the same path a desync resync uses.
    if (hadPeers) {
      this.pendingResync.add(id)
      out.push(...this.requestState(now))
    }
    return out
  }

  /** remove a peer and announce the new roster to whoever is left */
  leave(id: PeerId, now: number): Outbound[] {
    if (!this.peers.delete(id)) return []
    this.pendingResync.delete(id)
    for (const byPeer of this.checksums.values()) byPeer.delete(id)
    if (this.peers.size === 0) {
      this.emptySince = now
      this.stateRequestedAt = null
      return []
    }
    return [
      { to: this.everyone(), msg: { type: 'peers', peers: this.peerList(), serverTime: now } },
    ]
  }

  /** stamp an input with its apply tick and room-monotonic seq, then broadcast it to everyone */
  input(id: PeerId, event: InputEvent, now: number): Outbound[] {
    if (!this.peers.has(id)) return []
    return [
      {
        to: this.everyone(),
        msg: {
          type: 'input',
          event,
          applyTick: this.tickAt(now) + INPUT_DELAY,
          seq: ++this.seq,
          from: id,
          serverTime: now,
        },
      },
    ]
  }

  /** relay a cosmetic cursor to the other peers, outside the tick system entirely */
  cursor(id: PeerId, x: number, y: number, now: number): Outbound[] {
    if (!this.peers.has(id)) return []
    const others = this.everyone().filter((p) => p !== id)
    if (others.length === 0) return []
    return [{ to: others, msg: { type: 'cursor', from: id, x, y, serverTime: now } }]
  }

  /**
   * record a checksum report and, when peers disagree about the same tick, ask
   * the authority for a fresh full state to resync the minority.
   */
  checksum(id: PeerId, tick: number, hash: number, now: number): Outbound[] {
    if (!this.peers.has(id)) return []
    let byPeer = this.checksums.get(tick)
    if (byPeer === undefined) {
      byPeer = new Map()
      this.checksums.set(tick, byPeer)
      this.pruneChecksums()
    }
    byPeer.set(id, hash)
    const disagreeing = this.disagreeingPeers(byPeer)
    if (disagreeing.length === 0) return []
    for (const peer of disagreeing) this.pendingResync.add(peer)
    return this.requestState(now)
  }

  /** peers whose reported hash differs from the reference, never including the authority */
  private disagreeingPeers(byPeer: Map<PeerId, number>): PeerId[] {
    if (new Set(byPeer.values()).size < 2) return []
    const auth = this.authority()
    const reference =
      auth !== null && byPeer.has(auth) ? (byPeer.get(auth) as number) : majorityHash(byPeer)
    const out: PeerId[] = []
    for (const [peer, hash] of byPeer) {
      if (hash === reference || peer === auth) continue
      out.push(peer)
    }
    return out
  }

  private pruneChecksums(): void {
    if (this.checksums.size <= CHECKSUM_TICK_HISTORY) return
    const ticks = [...this.checksums.keys()].sort((a, b) => a - b)
    for (const tick of ticks.slice(0, ticks.length - CHECKSUM_TICK_HISTORY)) {
      this.checksums.delete(tick)
    }
  }

  /**
   * accept a full state from the authority: cache it for late joiners and push it
   * as a `setState` input to every peer waiting on a resync.
   */
  state(id: PeerId, state: string, now: number): Outbound[] {
    const auth = this.authority()
    if (auth === null || id !== auth) {
      return [errorTo(id, 'only the room authority may supply state', now)]
    }
    this.latestState = state
    this.stateRequestedAt = null
    this.lastStateRefresh = now
    const targets = [...this.pendingResync].filter((peer) => this.peers.has(peer))
    this.pendingResync.clear()
    if (targets.length === 0) return []
    return [
      {
        to: targets,
        msg: {
          type: 'input',
          event: { type: 'setState', state },
          applyTick: this.tickAt(now) + INPUT_DELAY,
          seq: ++this.seq,
          from: id,
          serverTime: now,
        },
      },
    ]
  }

  /** periodic upkeep: refresh the cached state from the authority every ~10s */
  maintain(now: number): Outbound[] {
    if (this.peers.size === 0) return []
    if (now - this.lastStateRefresh < STATE_REFRESH_MS) return []
    const out = this.requestState(now)
    if (out.length > 0) this.lastStateRefresh = now
    return out
  }
}

/** most frequently reported hash, ties broken by first insertion order */
function majorityHash(byPeer: Map<PeerId, number>): number {
  const counts = new Map<number, number>()
  let best = 0
  let bestCount = -1
  for (const hash of byPeer.values()) {
    const count = (counts.get(hash) ?? 0) + 1
    counts.set(hash, count)
    if (count > bestCount) {
      best = hash
      bestCount = count
    }
  }
  return best
}
