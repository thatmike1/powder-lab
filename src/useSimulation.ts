import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyPointEvent,
  encodeStateEnvelope,
  MagnetBatcher,
  shouldBuildSim,
  StrokeBatcher,
  useNet,
} from './net'
import { Mat, PALETTE } from './sim/materials'
import { Simulation } from './sim/Simulation'
import { decodeRLE, readSceneFromHash, sceneToHash } from './sim/scene'

export interface SimUiState {
  running: boolean
  material: number
  brush: number
  glow: boolean
  light: boolean
  showTemp: boolean
  darkness: number
  speed: number
  fps: number
  count: number
  /** true inside a room, where speed is pinned to 1 and single-stepping is off */
  speedLocked: boolean
}

// Mutable config the render loop reads each frame WITHOUT triggering React
// re-renders. React state (below) is just a mirror for the UI to display.
interface Config {
  running: boolean
  material: number
  brush: number
  glow: boolean
  light: boolean
  showTemp: boolean
  darkness: number
  speed: number
}

// Catch-up clamp for the networked loop. Bigger than the local MAX_STEPS because
// a fresh joiner can legitimately be a few hundred ticks behind the room clock
// and has to sprint; still bounded so a hopeless client never freezes the tab.
const MAX_CATCHUP = 32

/**
 * a fresh seed per page load. the engine is seeded now (lockstep needs every
 * client drawing the same numbers), and a constant seed would make every visit
 * replay byte for byte. inside a room the server's seed replaces this one.
 */
function freshSeed(): number {
  const buf = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf)
  else buf[0] = Date.now() ^ ((Math.random() * 0xffffffff) | 0)
  return buf[0] >>> 0 || 1
}

export function useSimulation(W: number, H: number, scale: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const simRef = useRef<Simulation | null>(null)
  const seedRef = useRef<number>(freshSeed())
  const { session, net } = useNet()
  const cfg = useRef<Config>({
    running: true,
    material: Mat.SAND,
    brush: 4,
    glow: true,
    light: true,
    showTemp: false,
    darkness: 0.55,
    speed: 1,
  })

  // Pointer state, also outside React so the loop can read it for "faucet" mode.
  const pointer = useRef({ down: false, erase: false, x: 0, y: 0 })

  const [ui, setUi] = useState<SimUiState>({
    running: true,
    material: Mat.SAND,
    brush: 4,
    glow: true,
    light: true,
    showTemp: false,
    darkness: 0.55,
    speed: 1,
    fps: 0,
    count: 0,
    speedLocked: false,
  })

  // Batches a held stroke's per-frame samples into ~20 wire events a second.
  // Local painting never goes through it — see paintAt. If the socket has gone
  // away with points still buffered, they are applied locally instead of being
  // dropped, so a mid-stroke disconnect leaves no seam.
  const strokes = useMemo(
    () =>
      new StrokeBatcher({
        send: (event) => session.sendInput(event),
        fallback: (event) => {
          const sim = simRef.current
          if (sim) applyPointEvent(sim, event)
        },
      }),
    [session],
  )

  // The magnet gets the same treatment for a different reason: it is a force
  // applied once per sample, so throttling it without batching would make an
  // in-room pull weaker than an offline one.
  const magnets = useMemo(
    () =>
      new MagnetBatcher({
        send: (event) => session.sendInput(event),
        fallback: (event) => {
          const sim = simRef.current
          if (sim) applyPointEvent(sim, event)
        },
      }),
    [session],
  )

  // The netcode drives the simulation it does not own: it needs the live sim
  // (joining a room replaces it with one on the room's seed), the pause flag it
  // shares with everyone in the room, and a nudge when a full state lands.
  useEffect(() => {
    session.attach({
      getSim: () => simRef.current,
      reseed: (seed) => {
        seedRef.current = seed
        const sim = new Simulation(W, H, seed)
        simRef.current = sim
        return sim
      },
      isRunning: () => cfg.current.running,
      setRunning: (on) => {
        cfg.current.running = on
        setUi((u) => (u.running === on ? u : { ...u, running: on }))
      },
      onStateLoaded: () => {
        setUi((u) => ({ ...u, count: simRef.current?.count ?? u.count }))
      },
    })
    return () => session.detach()
  }, [session, W, H])

  // Speed is pinned to 1 inside a room: a client stepping faster than its peers
  // diverges by definition.
  useEffect(() => {
    if (!net.connected) return
    cfg.current.speed = 1
    setUi((u) => ({ ...u, speed: 1, speedLocked: true }))
    return () => setUi((u) => ({ ...u, speedLocked: false }))
  }, [net.connected])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    // the room owns the simulation while connected. this effect only ever runs
    // once today, but if a dependency change or a remount re-ran it inside a
    // room, building a fresh Simulation would silently drop this client out of
    // lockstep — so the live one is kept and the hash hydration below skipped.
    const fresh = shouldBuildSim(session.connected, simRef.current)
    if (fresh) simRef.current = new Simulation(W, H, seedRef.current)

    // hydrate from a shared "#s=..." link, if present. shared scenes start
    // paused so the viewer sees the exact saved arrangement before pressing play.
    const booted = simRef.current
    const fromHash = fresh && booted ? readSceneFromHash() : null
    if (fromHash && booted) {
      try {
        const { cells } = decodeRLE(fromHash)
        if (booted.restore(cells)) {
          cfg.current.running = false
          setUi((u) => ({ ...u, running: false }))
        }
      } catch {
        // malformed hash — just boot an empty board.
      }
    }

    const toGrid = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      // rect may differ from internal size if CSS scaled the canvas (responsive).
      const gx = Math.floor(((clientX - rect.left) / rect.width) * W)
      const gy = Math.floor(((clientY - rect.top) / rect.height) * H)
      return { gx, gy }
    }
    const paintAt = (gx: number, gy: number, now: number) => {
      const c = cfg.current
      const sim = simRef.current
      if (!sim) return
      // Magnet is a force tool, not a paint: left-drag attracts filings, right-
      // drag repels (so right-click does NOT erase while Magnet is selected).
      // Intercepted before the erase->EMPTY mapping below.
      if (c.material === Mat.MAGNET) {
        const attract = !pointer.current.erase
        // every sample reaches the grid either way: batched onto the wire in a
        // room, applied directly outside one. same call count, same force.
        if (session.connected) magnets.add(now, gx, gy, c.brush, attract)
        else sim.magnet(gx, gy, c.brush, attract)
        return
      }
      const mat = pointer.current.erase ? Mat.EMPTY : c.material
      // Lightning isn't paintable — it's a click-triggered strike (see onDown),
      // so skip it here or a held/dragged pointer would strobe bolts every frame.
      if (mat === Mat.LIGHTNING) return
      // In a room nothing touches the grid locally: the stroke goes out as an
      // input and comes back stamped with the tick every peer applies it at.
      if (session.connected) strokes.add(now, gx, gy, c.brush, mat)
      else sim.paint(gx, gy, c.brush, mat)
    }

    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {}
      const { gx, gy } = toGrid(e.clientX, e.clientY)
      const now = performance.now()
      pointer.current.down = true
      pointer.current.erase = e.button === 2 // right-click erases
      pointer.current.x = gx
      pointer.current.y = gy
      // one bolt per click; paintAt no-ops for lightning so drags don't re-strike
      if (!pointer.current.erase && cfg.current.material === Mat.LIGHTNING) {
        if (session.connected) session.sendInput({ type: 'strike', x: gx, y: gy })
        else simRef.current?.strike(gx, gy)
      } else {
        paintAt(gx, gy, now)
      }
    }
    const onMove = (e: PointerEvent) => {
      const { gx, gy } = toGrid(e.clientX, e.clientY)
      // presence is cosmetic and outside lockstep — throttled inside the session.
      session.sendCursor(gx, gy)
      if (!pointer.current.down) return
      const now = performance.now()
      // Interpolate so fast strokes don't leave gaps.
      const px = pointer.current.x,
        py = pointer.current.y
      const steps = Math.max(Math.abs(gx - px), Math.abs(gy - py))
      for (let s = 1; s <= steps; s++) {
        paintAt(
          Math.round(px + ((gx - px) * s) / steps),
          Math.round(py + ((gy - py) * s) / steps),
          now,
        )
      }
      if (steps === 0) paintAt(gx, gy, now)
      pointer.current.x = gx
      pointer.current.y = gy
    }
    const onUp = (e: PointerEvent) => {
      pointer.current.down = false
      const upAt = performance.now()
      strokes.flush(upAt)
      magnets.flush(upAt)
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {}
    }
    const onCtx = (e: Event) => e.preventDefault()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('contextmenu', onCtx)

    let raf = 0
    let frames = 0
    let fpsT = performance.now()
    // Fixed-timestep accumulator: the sim advances by real wall-clock time, not
    // by rendered frames, so a material falls at the same speed on a 60Hz panel
    // and a 120Hz one. We render every frame but only step the sim once per
    // STEP_MS of accumulated (speed-scaled) time.
    const STEP_MS = 1000 / 75 // one fixed sim tick = 1/75 s of sim time (baseline)
    const MAX_STEPS = 12 // spiral-of-death clamp; clears speed=6 (~7.5 ticks/frame)
    let last = performance.now()
    let acc = 0 // unconsumed sim-time, ms
    const loop = (now: number) => {
      const c = cfg.current
      let dt = now - last
      last = now
      if (dt > 250) dt = 250 // tab was backgrounded — don't replay the whole gap
      if (session.connected) {
        // In a room the clock is the server's, not this tab's: fast-forward when
        // behind, stall when ahead, and never step on our own accumulator.
        acc = 0
        session.advance(MAX_CATCHUP)
      } else if (c.running) {
        acc += dt * c.speed
        let steps = Math.floor(acc / STEP_MS)
        acc -= steps * STEP_MS
        if (steps > MAX_STEPS) {
          // too far behind — cap the catch-up and drop the backlog so we never spiral
          steps = MAX_STEPS
          acc = 0
        }
        if (steps > 0) simRef.current?.step(steps)
      }
      // "Faucet": holding the pointer still keeps emitting (great for fluids/fire).
      if (pointer.current.down) paintAt(pointer.current.x, pointer.current.y, now)
      strokes.poll(now)
      magnets.poll(now)
      // joining a room swaps the simulation, so read it back after the step.
      const sim = simRef.current
      if (sim) {
        // heatmap is a render-time flag on the sim, kept out of render()'s args.
        sim.setShowTemp(c.showTemp)
        sim.render(ctx, scale, c.glow, c.light, c.darkness)
      }
      frames++
      if (now - fpsT > 500) {
        const fps = Math.round((frames * 1000) / (now - fpsT))
        frames = 0
        fpsT = now
        setUi((u) => ({ ...u, fps, count: sim?.count ?? u.count }))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('contextmenu', onCtx)
      // dropping the sim here would take the room's with it; a live room keeps
      // stepping through the session's own hooks.
      if (!session.connected) simRef.current = null
    }
  }, [W, H, scale, session, strokes, magnets])

  // ---- setters: update both the live config ref AND the UI mirror --------
  const setMaterial = useCallback((m: number) => {
    cfg.current.material = m
    setUi((u) => ({ ...u, material: m }))
  }, [])
  const setBrush = useCallback((b: number) => {
    cfg.current.brush = b
    setUi((u) => ({ ...u, brush: b }))
  }, [])
  const setSpeed = useCallback(
    (s: number) => {
      // pinned inside a room; the control is disabled there anyway.
      if (session.connected) return
      cfg.current.speed = s
      setUi((u) => ({ ...u, speed: s }))
    },
    [session],
  )
  // Pause is room-global: it travels as an input and comes back for everyone.
  const toggleRunning = useCallback(() => {
    if (session.connected) {
      session.sendInput({ type: 'running', on: !cfg.current.running })
      return
    }
    cfg.current.running = !cfg.current.running
    setUi((u) => ({ ...u, running: cfg.current.running }))
  }, [session])
  const toggleGlow = useCallback(() => {
    cfg.current.glow = !cfg.current.glow
    setUi((u) => ({ ...u, glow: cfg.current.glow }))
  }, [])
  const toggleLight = useCallback(() => {
    cfg.current.light = !cfg.current.light
    setUi((u) => ({ ...u, light: cfg.current.light }))
  }, [])
  const toggleTemp = useCallback(() => {
    cfg.current.showTemp = !cfg.current.showTemp
    setUi((u) => ({ ...u, showTemp: cfg.current.showTemp }))
  }, [])
  const setDarkness = useCallback((d: number) => {
    cfg.current.darkness = d
    setUi((u) => ({ ...u, darkness: d }))
  }, [])
  // Single-stepping is local by definition, so it is unavailable in a room.
  const stepOnce = useCallback(() => {
    if (session.connected) return
    simRef.current?.step(1)
  }, [session])
  const clear = useCallback(() => {
    if (session.connected) session.sendInput({ type: 'clear' })
    else simRef.current?.clear()
  }, [session])

  // A room-wide scene swap: build the state everyone will adopt WITHOUT touching
  // the live grid, since the sender waits for the broadcast like every peer.
  const stateForCells = useCallback(
    (cells: Uint8Array): string | null => {
      const sim = simRef.current
      if (!sim) return null
      const scratch = new Simulation(W, H)
      if (!scratch.loadState(sim.serializeState())) return null
      if (!scratch.restore(cells)) return null
      return encodeStateEnvelope(session.roomTick, false, scratch.serializeState())
    },
    [session, W, H],
  )

  // serialize the grid into the URL hash and copy a shareable link. falls back
  // to leaving the hash in the address bar when the clipboard is unavailable.
  const shareScene = useCallback(async () => {
    const sim = simRef.current
    if (!sim) return
    const hash = sceneToHash(sim.snapshot())
    history.replaceState(null, '', hash)
    const url = location.origin + location.pathname + location.search + hash
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // no clipboard (non-secure context / denied) — the address bar now holds
      // the shareable URL for the user to copy manually.
    }
  }, [])

  // download the current scene as a raw-bytes .powder file.
  const saveScene = useCallback(() => {
    const sim = simRef.current
    if (!sim) return
    const blob = new Blob([sim.snapshot()], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'scene.powder'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // load a baked-in gallery scene: replace the grid, pause so the painting is
  // visible before play, drop any shared "#s=" hash so it can't fight the scene,
  // and adopt the scene's lighting hint so it looks its best on arrival.
  const loadPreset = useCallback(
    (cells: Uint8Array, opts?: { light?: boolean; darkness?: number }) => {
      const sim = simRef.current
      if (!sim) return
      // lighting is a local render preference, so it applies either way.
      const applyLook = () => {
        if (location.hash) history.replaceState(null, '', location.pathname + location.search)
        if (opts?.light !== undefined) cfg.current.light = opts.light
        if (opts?.darkness !== undefined) cfg.current.darkness = opts.darkness
        setUi((u) => ({ ...u, light: cfg.current.light, darkness: cfg.current.darkness }))
      }
      if (session.connected) {
        const state = stateForCells(cells)
        if (state === null) return
        session.sendInput({ type: 'setState', state, reason: 'load' })
        session.sendInput({ type: 'running', on: false })
        applyLook()
        return
      }
      if (!sim.restore(cells)) return
      cfg.current.running = false
      applyLook()
      setUi((u) => ({ ...u, running: false }))
    },
    [session, stateForCells],
  )

  // load a .powder file, replacing the current grid (and pausing on success).
  const loadScene = useCallback(
    async (file: File) => {
      const sim = simRef.current
      if (!sim) return
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { W: sw, H: sh, cells } = decodeRLE(bytes)
        if (cells.length !== sim.W * sim.H) {
          alert(`That scene is ${sw}×${sh}, but this board is ${sim.W}×${sim.H}.`)
          return
        }
        if (session.connected) {
          const state = stateForCells(cells)
          if (state === null) return
          session.sendInput({ type: 'setState', state, reason: 'load' })
          session.sendInput({ type: 'running', on: false })
          return
        }
        if (!sim.restore(cells)) return
        cfg.current.running = false
        setUi((u) => ({ ...u, running: false }))
      } catch {
        alert("Couldn't read that file — it doesn't look like a Powder Lab scene.")
      }
    },
    [session, stateForCells],
  )

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const k = e.key.toLowerCase()
      if (k === ' ') {
        e.preventDefault()
        toggleRunning()
        return
      }
      if (k === 'c') {
        clear()
        return
      }
      if (k === 'g') {
        toggleGlow()
        return
      }
      if (k === 'l') {
        toggleLight()
        return
      }
      if (k === 'h') {
        toggleTemp()
        return
      }
      if (k === '[') {
        setBrush(Math.max(1, cfg.current.brush - 1))
        return
      }
      if (k === ']') {
        setBrush(Math.min(40, cfg.current.brush + 1))
        return
      }
      const hit = PALETTE.find((p) => p.key?.toLowerCase() === k)
      if (hit) setMaterial(hit.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleRunning, clear, toggleGlow, toggleLight, toggleTemp, setBrush, setMaterial])

  return {
    canvasRef,
    ui,
    /** multiplayer surface for the UI: connection, room, peers, cursors */
    net,
    setMaterial,
    setBrush,
    setSpeed,
    toggleRunning,
    toggleGlow,
    toggleLight,
    toggleTemp,
    setDarkness,
    stepOnce,
    clear,
    shareScene,
    saveScene,
    loadScene,
    loadPreset,
  }
}
