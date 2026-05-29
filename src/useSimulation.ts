import { useCallback, useEffect, useRef, useState } from 'react'
import { Mat, PALETTE } from './sim/materials'
import { Simulation } from './sim/Simulation'
import { decodeRLE, readSceneFromHash, sceneToHash } from './sim/scene'

export interface SimUiState {
  running: boolean
  material: number
  brush: number
  glow: boolean
  light: boolean
  darkness: number
  speed: number
  fps: number
  count: number
}

// Mutable config the render loop reads each frame WITHOUT triggering React
// re-renders. React state (below) is just a mirror for the UI to display.
interface Config {
  running: boolean
  material: number
  brush: number
  glow: boolean
  light: boolean
  darkness: number
  speed: number
}

export function useSimulation(W: number, H: number, scale: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const simRef = useRef<Simulation | null>(null)
  const cfg = useRef<Config>({
    running: true,
    material: Mat.SAND,
    brush: 4,
    glow: true,
    light: true,
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
    darkness: 0.55,
    speed: 1,
    fps: 0,
    count: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const sim = new Simulation(W, H)
    simRef.current = sim

    // hydrate from a shared "#s=..." link, if present. shared scenes start
    // paused so the viewer sees the exact saved arrangement before pressing play.
    const fromHash = readSceneFromHash()
    if (fromHash) {
      try {
        const { cells } = decodeRLE(fromHash)
        if (sim.restore(cells)) {
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
    const paintAt = (gx: number, gy: number) => {
      const c = cfg.current
      const mat = pointer.current.erase ? Mat.EMPTY : c.material
      sim.paint(gx, gy, c.brush, mat)
    }

    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {}
      const { gx, gy } = toGrid(e.clientX, e.clientY)
      pointer.current.down = true
      pointer.current.erase = e.button === 2 // right-click erases
      pointer.current.x = gx
      pointer.current.y = gy
      paintAt(gx, gy)
    }
    const onMove = (e: PointerEvent) => {
      if (!pointer.current.down) return
      const { gx, gy } = toGrid(e.clientX, e.clientY)
      // Interpolate so fast strokes don't leave gaps.
      const px = pointer.current.x,
        py = pointer.current.y
      const steps = Math.max(Math.abs(gx - px), Math.abs(gy - py))
      for (let s = 1; s <= steps; s++) {
        paintAt(Math.round(px + ((gx - px) * s) / steps), Math.round(py + ((gy - py) * s) / steps))
      }
      if (steps === 0) paintAt(gx, gy)
      pointer.current.x = gx
      pointer.current.y = gy
    }
    const onUp = (e: PointerEvent) => {
      pointer.current.down = false
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
    const loop = (now: number) => {
      const c = cfg.current
      if (c.running) sim.step(c.speed)
      // "Faucet": holding the pointer still keeps emitting (great for fluids/fire).
      if (pointer.current.down) paintAt(pointer.current.x, pointer.current.y)
      sim.render(ctx, scale, c.glow, c.light, c.darkness)
      frames++
      if (now - fpsT > 500) {
        const fps = Math.round((frames * 1000) / (now - fpsT))
        frames = 0
        fpsT = now
        setUi((u) => ({ ...u, fps, count: sim.count }))
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
      simRef.current = null
    }
  }, [W, H, scale])

  // ---- setters: update both the live config ref AND the UI mirror --------
  const setMaterial = useCallback((m: number) => {
    cfg.current.material = m
    setUi((u) => ({ ...u, material: m }))
  }, [])
  const setBrush = useCallback((b: number) => {
    cfg.current.brush = b
    setUi((u) => ({ ...u, brush: b }))
  }, [])
  const setSpeed = useCallback((s: number) => {
    cfg.current.speed = s
    setUi((u) => ({ ...u, speed: s }))
  }, [])
  const toggleRunning = useCallback(() => {
    cfg.current.running = !cfg.current.running
    setUi((u) => ({ ...u, running: cfg.current.running }))
  }, [])
  const toggleGlow = useCallback(() => {
    cfg.current.glow = !cfg.current.glow
    setUi((u) => ({ ...u, glow: cfg.current.glow }))
  }, [])
  const toggleLight = useCallback(() => {
    cfg.current.light = !cfg.current.light
    setUi((u) => ({ ...u, light: cfg.current.light }))
  }, [])
  const setDarkness = useCallback((d: number) => {
    cfg.current.darkness = d
    setUi((u) => ({ ...u, darkness: d }))
  }, [])
  const stepOnce = useCallback(() => simRef.current?.step(1), [])
  const clear = useCallback(() => simRef.current?.clear(), [])

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

  // load a .powder file, replacing the current grid (and pausing on success).
  const loadScene = useCallback(async (file: File) => {
    const sim = simRef.current
    if (!sim) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { W: sw, H: sh, cells } = decodeRLE(bytes)
      if (!sim.restore(cells)) {
        alert(`That scene is ${sw}×${sh}, but this board is ${sim.W}×${sim.H}.`)
        return
      }
      cfg.current.running = false
      setUi((u) => ({ ...u, running: false }))
    } catch {
      alert("Couldn't read that file — it doesn't look like a Powder Lab scene.")
    }
  }, [])

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
  }, [toggleRunning, clear, toggleGlow, toggleLight, setBrush, setMaterial])

  return {
    canvasRef,
    ui,
    setMaterial,
    setBrush,
    setSpeed,
    toggleRunning,
    toggleGlow,
    toggleLight,
    setDarkness,
    stepOnce,
    clear,
    shareScene,
    saveScene,
    loadScene,
  }
}
