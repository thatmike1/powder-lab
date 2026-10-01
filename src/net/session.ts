import { TickClock } from './clock'
import {
  CHECKSUM_INTERVAL_TICKS,
  type ClientMessage,
  CURSOR_INTERVAL_MS,
  type InputEvent,
  type MagnetEvent,
  type PaintEvent,
  type PeerId,
  type PeerInfo,
  parseServerMessage,
  type StampedInput,
} from './protocol'
import { InputScheduler } from './scheduler'
import { decodeStateEnvelope, encodeStateEnvelope, type StateLook } from './state-envelope'
import { type Connect, connectWebSocket, defaultRelayUrl, type Transport } from './transport'

/** a corrective state this soon after joining is the join handshake, not a desync */
const JOIN_GRACE_MS = 5_000

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** the slice of `Simulation` the netcode drives, structural so tests can fake it */
export interface SimLike {
  readonly tick: number
  paint(cx: number, cy: number, r: number, mat: number): void
  magnet(cx: number, cy: number, r: number, attract: boolean): void
  strike(x: number, y: number): void
  clear(): void
  step(times?: number): void
  serializeState(): Uint8Array
  loadState(bytes: Uint8Array): boolean
  checksum(): number
}

/** what the session needs from its host to drive a simulation it does not own */
export interface SessionHooks {
  /** the live simulation, read fresh each time because joining a room replaces it */
  getSim: () => SimLike | null
  /** build a new simulation on the room's seed and return it */
  reseed: (seed: number) => SimLike | null
  isRunning: () => boolean
  /** room-global pause arriving as an input; the host mirrors it into its UI */
  setRunning: (on: boolean) => void
  /**
   * a loaded scene brought its own lighting; the host adopts it so every peer
   * renders the same picture. only fired when the state carries a look.
   */
  setLook?: (look: StateLook) => void
  /** a full state was adopted, so anything derived from the grid is stale */
  onStateLoaded?: () => void
}

export interface NetSessionOptions {
  url?: string
  /** injected in tests to run a room with no sockets at all */
  connect?: Connect
  now?: () => number
  /** fired only on events the UI actually renders: status, room, peers, desyncs */
  onChange?: () => void
}

export interface PeerCursor {
  id: PeerId
  x: number
  y: number
  /** local timestamp of the last update, for fading a cursor that went quiet */
  at: number
}

/**
 * one client's half of the lockstep room: the socket, the tick clock, the input
 * queue and the resync machinery.
 *
 * the rule the whole thing exists to enforce is that inside a room NOTHING
 * touches the grid locally. a paint goes out as an input, comes back stamped
 * with the tick every peer applies it at, and only then reaches the simulation.
 *
 * it is deliberately not a React component and holds no React state: per-frame
 * work (advancing ticks) and per-cursor work happen here, and `onChange` fires
 * only for the handful of events a human sees.
 */
export class NetSession {
  private readonly url: string
  private readonly connect: Connect
  private readonly now: () => number
  private readonly onChange: () => void
  private readonly clock = new TickClock()
  private readonly scheduler = new InputScheduler()

  private transport: Transport | null = null
  private hooks: SessionHooks | null = null
  private pendingJoin: { room?: string; name: string } | null = null

  private statusValue: ConnectionStatus = 'disconnected'
  private roomValue: string | null = null
  private youValue: PeerId | null = null
  private peersValue: PeerInfo[] = []
  private errorValue: string | null = null
  private desyncsValue = 0
  private tick = 0
  private lastChecksumTick = -1
  private lastCursorAt = Number.NEGATIVE_INFINITY
  private joinedAt = Number.NEGATIVE_INFINITY

  /** live cursor positions, mutated in place — never mirrored into React state */
  readonly cursors = new Map<PeerId, PeerCursor>()
  private readonly cursorListeners = new Set<() => void>()

  constructor(options: NetSessionOptions = {}) {
    this.url = options.url ?? defaultRelayUrl()
    this.connect = options.connect ?? connectWebSocket
    this.now = options.now ?? (() => Date.now())
    this.onChange = options.onChange ?? (() => {})
  }

  // ---- host wiring ------------------------------------------------------

  attach(hooks: SessionHooks): void {
    this.hooks = hooks
  }

  detach(): void {
    this.hooks = null
  }

  // ---- read-only surface ------------------------------------------------

  get status(): ConnectionStatus {
    return this.statusValue
  }

  get connected(): boolean {
    return this.statusValue === 'connected'
  }

  get room(): string | null {
    return this.roomValue
  }

  get you(): PeerId | null {
    return this.youValue
  }

  get peers(): PeerInfo[] {
    return this.peersValue
  }

  get error(): string | null {
    return this.errorValue
  }

  /** how many times this client has been corrected by a server-pushed full state */
  get desyncs(): number {
    return this.desyncsValue
  }

  /** the room's shared clock: ticks since the room was created, paused ticks included */
  get roomTick(): number {
    return this.tick
  }

  /** inputs that arrived after their apply tick had passed; a lag symptom, not a desync */
  get lateInputs(): number {
    return this.scheduler.late
  }

  // ---- connection -------------------------------------------------------

  /** open a room; the server allocates the code and replies with `joined` */
  createRoom(name?: string): void {
    this.open(undefined, name)
  }

  /** join an existing room by its code */
  joinRoom(code: string, name?: string): void {
    this.open(code, name)
  }

  private open(room: string | undefined, name?: string): void {
    if (this.statusValue === 'connecting' || this.statusValue === 'connected') return
    this.errorValue = null
    this.pendingJoin = { room, name: name ?? 'anon' }
    this.setStatus('connecting')
    let openedEarly = false
    this.transport = this.connect(this.url, {
      // a transport that is already open calls this before `connect` returns,
      // so the join has to wait for the field assignment below.
      onOpen: () => {
        if (this.transport === null) openedEarly = true
        else this.handleOpen()
      },
      onMessage: (data) => this.handleMessage(data),
      onClose: (reason) => this.handleClose(reason),
      onError: (message) => this.handleError(message),
    })
    if (openedEarly) this.handleOpen()
  }

  /** leave the room and fall back to a purely local simulation */
  leave(): void {
    const transport = this.transport
    this.transport = null
    transport?.close()
    this.resetRoom()
    this.setStatus('disconnected')
  }

  private handleOpen(): void {
    const join = this.pendingJoin
    if (join === null) return
    this.send({ type: 'join', room: join.room, name: join.name })
  }

  private handleClose(reason: string): void {
    if (this.statusValue === 'disconnected' || (this.statusValue === 'error' && this.transport === null)) return
    this.transport = null
    this.resetRoom()
    // a drop mid-session is an error the user should see; a drop while dialling
    // is the room never having opened. either way the loop is single-player again.
    this.errorValue = reason
    this.setStatus('error')
  }

  private handleError(message: string): void {
    this.errorValue = message
    if (this.statusValue !== 'connected') this.setStatus('error')
    else this.onChange()
  }

  private resetRoom(): void {
    this.roomValue = null
    this.youValue = null
    this.peersValue = []
    this.pendingJoin = null
    this.scheduler.clear()
    this.clock.reset()
    this.cursors.clear()
    this.lastChecksumTick = -1
    this.notifyCursors()
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusValue = status
    this.onChange()
  }

  private send(msg: ClientMessage): void {
    this.transport?.send(JSON.stringify(msg))
  }

  // ---- outgoing ---------------------------------------------------------

  /**
   * put a grid mutation on the wire. it is NOT applied here: it comes back from
   * the relay stamped with the tick every peer, this one included, applies it at.
   */
  sendInput(event: InputEvent): boolean {
    // by design there is no local echo: points handed over here are lost if the
    // socket dies before the relay echoes them back, so a drop can eat up to
    // INPUT_DELAY worth of a stroke. that is inherent to lockstep without
    // rollback and is not a bug to chase.
    if (!this.connected) return false
    this.send({ type: 'input', event })
    return true
  }

  /** cosmetic cursor presence, throttled to ~10 Hz and never touching the grid */
  sendCursor(x: number, y: number): void {
    if (!this.connected) return
    const now = this.now()
    if (now - this.lastCursorAt < CURSOR_INTERVAL_MS) return
    this.lastCursorAt = now
    this.send({ type: 'cursor', x, y })
  }

  /** subscribe to peer cursor movement; returns the unsubscribe */
  subscribeCursors(listener: () => void): () => void {
    this.cursorListeners.add(listener)
    return () => {
      this.cursorListeners.delete(listener)
    }
  }

  private notifyCursors(): void {
    for (const listener of this.cursorListeners) listener()
  }

  /** the wire form of this client's full state, tagged with the room clock */
  serializeEnvelope(): string | null {
    const sim = this.hooks?.getSim() ?? null
    if (sim === null) return null
    return encodeStateEnvelope(this.tick, this.hooks?.isRunning() ?? true, sim.serializeState())
  }

  // ---- incoming ---------------------------------------------------------

  private handleMessage(data: string): void {
    const msg = parseServerMessage(data)
    if (msg === null) return
    const localNow = this.now()
    if (msg.type !== 'joined') this.clock.sample(msg.serverTime, localNow)
    switch (msg.type) {
      case 'joined': {
        this.roomValue = msg.room
        this.youValue = msg.you
        this.peersValue = msg.peers
        this.pendingJoin = null
        this.clock.start(msg.serverTime, msg.tick, localNow)
        this.joinedAt = localNow
        this.tick = msg.tick
        this.lastChecksumTick = -1
        this.scheduler.clear()
        // every peer runs the same seeded engine; a late joiner overwrites it
        // immediately with the room's cached state, whose PRNG word wins.
        this.hooks?.reseed(msg.seed)
        if (msg.state !== null && !this.adoptState(msg.state)) {
          this.rejectState()
          break
        }
        this.setStatus('connected')
        break
      }
      case 'input':
        this.scheduler.push({
          event: msg.event,
          applyTick: msg.applyTick,
          seq: msg.seq,
          from: msg.from,
        })
        break
      case 'peers':
        this.peersValue = msg.peers
        for (const id of [...this.cursors.keys()]) {
          if (!msg.peers.some((p) => p.id === id)) this.cursors.delete(id)
        }
        this.onChange()
        this.notifyCursors()
        break
      case 'cursor':
        this.cursors.set(msg.from, { id: msg.from, x: msg.x, y: msg.y, at: localNow })
        this.notifyCursors()
        break
      case 'stateRequest': {
        const state = this.serializeEnvelope()
        if (state !== null) this.send({ type: 'state', state })
        break
      }
      case 'error':
        this.handleError(msg.message)
        break
    }
  }

  // ---- the tick loop ----------------------------------------------------

  /**
   * advance the simulation toward the server's tick: fast-forward when behind,
   * do nothing when ahead. this replaces the free-running wall-clock accumulator
   * while in a room, because a client whose sim time is its own diverges by
   * definition. returns the number of ticks actually advanced.
   */
  advance(maxSteps: number): number {
    if (!this.connected || !this.clock.ready) return 0
    const target = this.clock.serverTick(this.now())
    let steps = 0
    while (this.connected && this.tick < target && steps < maxSteps) {
      const sim = this.hooks?.getSim() ?? null
      if (sim === null) return steps
      if (this.hooks?.isRunning() ?? true) sim.step(1)
      this.tick++
      steps++
      // the invariant every peer shares, and the one a resync relies on: at tick
      // T the sim has taken T steps and every input stamped applyTick <= T has
      // been applied. so inputs land after the step that carried us into T.
      this.applyDue()
      this.maybeChecksum()
    }
    this.scheduler.prune(this.tick)
    return steps
  }

  /** report a checksum for this tick, at the one point in the tick every peer shares */
  private maybeChecksum(): void {
    if (this.tick % CHECKSUM_INTERVAL_TICKS !== 0 || this.tick === this.lastChecksumTick) return
    const sim = this.hooks?.getSim() ?? null
    if (sim === null) return
    this.lastChecksumTick = this.tick
    this.send({ type: 'checksum', tick: this.tick, hash: sim.checksum() })
  }

  /** apply everything stamped for this tick, in seq order, and retain it for replay */
  private applyDue(): void {
    const due = this.scheduler.takeDue(this.tick)
    for (let i = 0; i < due.length; i++) {
      const input = due[i]
      const event = input.event
      if (event.type === 'setState' && event.reason !== 'load') {
        // a corrective state from the server: rewind, then replay. anything else
        // in this batch is newer than the rewind target, so it goes back in the
        // queue and gets applied again on the way forward.
        for (let j = i + 1; j < due.length; j++) this.scheduler.push(due[j])
        this.resync(event.state)
        return
      }
      this.applyEvent(input)
      if (!this.connected) return
      this.scheduler.remember(input)
    }
  }

  private applyEvent(input: StampedInput): void {
    const sim = this.hooks?.getSim() ?? null
    if (sim === null) return
    const event = input.event
    switch (event.type) {
      case 'paint':
      case 'magnet':
        applyPointEvent(sim, event)
        break
      case 'strike':
        sim.strike(event.x, event.y)
        break
      case 'clear':
        sim.clear()
        break
      case 'running':
        this.hooks?.setRunning(event.on)
        break
      case 'setState': {
        // a scene or preset load: everyone adopts the same bytes at this tick,
        // so the room clock is untouched and nothing is replayed. the scene's
        // authored lighting rides along in the envelope, because applying it
        // locally on the picking client alone left peers on a different picture.
        const envelope = decodeStateEnvelope(event.state)
        if (envelope !== null && sim.loadState(envelope.state)) {
          if (envelope.look !== null) this.hooks?.setLook?.(envelope.look)
          this.hooks?.onStateLoaded?.()
        } else this.rejectState()
        break
      }
    }
  }

  private rejectState(): void {
    const transport = this.transport
    this.transport = null
    transport?.close()
    this.resetRoom()
    this.errorValue = 'Room state is incompatible or damaged. Reload all peers to the same build and start a new room.'
    this.setStatus('error')
  }

  /**
   * adopt a corrective state and catch back up: load it, take its room tick as
   * ours, and put every retained input newer than that tick back in the queue so
   * the normal drain replays them while `advance` steps forward to the present.
   */
  private resync(state: string): void {
    if (!this.adoptState(state)) { this.rejectState(); return }
    // the server hands a joiner its first state through the same path, so a
    // correction in the first seconds of a room is the handshake, not a desync.
    if (this.now() - this.joinedAt > JOIN_GRACE_MS) this.desyncsValue++
    this.onChange()
  }

  /** load a state envelope, adopting its room tick and pause state */
  private adoptState(state: string): boolean {
    const envelope = decodeStateEnvelope(state)
    const sim = this.hooks?.getSim() ?? null
    if (envelope === null || sim === null) return false
    if (!sim.loadState(envelope.state)) return false
    this.tick = envelope.roomTick
    this.lastChecksumTick = -1
    this.hooks?.setRunning(envelope.running)
    if (envelope.look !== null) this.hooks?.setLook?.(envelope.look)
    this.scheduler.requeueAfter(envelope.roomTick)
    this.hooks?.onStateLoaded?.()
    return true
  }
}

/**
 * apply a batched paint or magnet event to a simulation: one call per point, in
 * order, honouring the per-segment brush and material when the event carries
 * segments. this is the ONLY place an event's points turn into grid calls, so
 * the lockstep path and the local fallback cannot drift apart.
 */
export function applyPointEvent(sim: SimLike, event: PaintEvent | MagnetEvent): void {
  const pts = event.pts
  const call =
    event.type === 'paint'
      ? (x: number, y: number, r: number, k: number | boolean) => sim.paint(x, y, r, k as number)
      : (x: number, y: number, r: number, k: number | boolean) => sim.magnet(x, y, r, k as boolean)
  const segs: Array<{ n: number; r: number; k: number | boolean }> =
    event.segs === undefined
      ? [
          {
            n: pts.length / 2,
            r: event.r,
            k: event.type === 'paint' ? event.mat : event.attract,
          },
        ]
      : event.segs.map((seg) => ({
          n: seg.n,
          r: seg.r,
          k: 'mat' in seg ? seg.mat : seg.attract,
        }))
  let p = 0
  for (const seg of segs) {
    for (let n = 0; n < seg.n && p + 1 < pts.length; n++, p += 2)
      call(pts[p], pts[p + 1], seg.r, seg.k)
  }
}
