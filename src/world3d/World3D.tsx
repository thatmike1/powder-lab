import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'
import { Mat, PALETTE } from '../sim/materials'
import { Simulation } from '../sim/Simulation'

// grid + render scale, mirrored from App.tsx. the offscreen canvas the sim draws
// into is W*SCALE × H*SCALE; that canvas becomes a WebGL texture.
const W = 200
const H = 150
const SCALE = 4

// the sim "screen" in world units. 200×150 is a 4:3 panel.
const PANEL_W = 6
const PANEL_H = PANEL_W * (H / W)

/**
 * first-person 3d prototype: the powder-lab sim lives as a glowing panel on a
 * wall, and you walk around the room (WASD + mouse-look) and paint into it by
 * looking at it and clicking. the simulation engine is reused unchanged — only
 * the loop + input shell that useSimulation provides for 2d is reimplemented
 * here, the one difference being that "where am I painting" comes from a raycast
 * through the crosshair instead of a css-rect calculation.
 */
export default function World3D() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [material, setMaterial] = useState<number>(Mat.SAND)
  const [locked, setLocked] = useState(false)
  const matRef = useRef(material)
  matRef.current = material

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ---- the simulation + its offscreen render target ---------------------
    const sim = new Simulation(W, H)
    const simCanvas = document.createElement('canvas')
    simCanvas.width = W * SCALE
    simCanvas.height = H * SCALE
    const simCtx = simCanvas.getContext('2d', { alpha: false })
    if (!simCtx) throw new Error('2d context unavailable for sim canvas')

    // seed a little something so the panel isn't blank on entry.
    sim.paint(60, 30, 14, Mat.SAND)
    sim.paint(140, 30, 14, Mat.WATER)
    sim.paint(100, 20, 8, Mat.LAVA)

    // ---- three.js scene ---------------------------------------------------
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0d12)
    scene.fog = new THREE.Fog(0x0b0d12, 8, 26)

    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 1.7, 4)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    mount.appendChild(renderer.domElement)

    // ---- room: floor + walls ---------------------------------------------
    const ROOM = 20
    const WALL_H = 8
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 1 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat)
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e28,
      roughness: 1,
      side: THREE.DoubleSide,
    })
    const mkWall = (x: number, z: number, ry: number) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, WALL_H), wallMat)
      w.position.set(x, WALL_H / 2, z)
      w.rotation.y = ry
      scene.add(w)
    }
    mkWall(0, -ROOM / 2, 0)
    mkWall(0, ROOM / 2, Math.PI)
    mkWall(-ROOM / 2, 0, Math.PI / 2)
    mkWall(ROOM / 2, 0, -Math.PI / 2)

    // ---- the sim panel (a glowing screen on the back wall) ----------------
    const tex = new THREE.CanvasTexture(simCanvas)
    tex.colorSpace = THREE.SRGBColorSpace
    // crisp pixels — same intent as the 2d renderer's imageSmoothingEnabled=false.
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true

    const panelMat = new THREE.MeshBasicMaterial({ map: tex }) // unlit: the sim provides its own light/glow
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), panelMat)
    const PANEL_Z = -ROOM / 2 + 0.05
    panel.position.set(0, 2.6, PANEL_Z)
    scene.add(panel)

    // a translucent "glass tank" shell + emissive frame around the panel.
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_W + 0.4, PANEL_H + 0.4, 0.3),
      new THREE.MeshPhysicalMaterial({
        color: 0x88aaff,
        transmission: 0.9,
        transparent: true,
        opacity: 0.15,
        roughness: 0.1,
        metalness: 0,
      }),
    )
    glass.position.set(0, 2.6, PANEL_Z - 0.16)
    scene.add(glass)

    // ---- lighting ---------------------------------------------------------
    scene.add(new THREE.AmbientLight(0x404858, 1.2))
    // the panel casts a soft glow into the room.
    const panelLight = new THREE.PointLight(0xffd0a0, 8, 18, 2)
    panelLight.position.set(0, 2.6, PANEL_Z + 1.5)
    scene.add(panelLight)

    // ---- first-person controls -------------------------------------------
    const controls = new PointerLockControls(camera, renderer.domElement)
    const onLock = () => setLocked(true)
    const onUnlock = () => setLocked(false)
    controls.addEventListener('lock', onLock)
    controls.addEventListener('unlock', onUnlock)
    const onCanvasClick = () => {
      if (!controls.isLocked) controls.lock()
    }
    renderer.domElement.addEventListener('click', onCanvasClick)

    // WASD movement state.
    const keys = { f: false, b: false, l: false, r: false }
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
          keys.f = true
          break
        case 'KeyS':
          keys.b = true
          break
        case 'KeyA':
          keys.l = true
          break
        case 'KeyD':
          keys.r = true
          break
      }
      // material hotkeys reuse the 2d palette bindings (s=sand, w=water, ...).
      const hit = PALETTE.find((p) => p.key && p.key.toLowerCase() === e.key.toLowerCase())
      if (hit) setMaterial(hit.id)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
          keys.f = false
          break
        case 'KeyS':
          keys.b = false
          break
        case 'KeyA':
          keys.l = false
          break
        case 'KeyD':
          keys.r = false
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // ---- painting via raycast through the crosshair -----------------------
    const raycaster = new THREE.Raycaster()
    const CENTER = new THREE.Vector2(0, 0)
    let painting = false
    let erasing = false
    let lastCell: { x: number; y: number } | null = null
    const onMouseDown = (e: MouseEvent) => {
      if (!controls.isLocked) return
      painting = true
      erasing = e.button === 2
      lastCell = null
    }
    const onMouseUp = () => {
      painting = false
      lastCell = null
    }
    const onCtxMenu = (e: Event) => e.preventDefault()
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('contextmenu', onCtxMenu)

    /** map a panel uv hit to grid coords and paint, interpolating from the last. */
    const paintFromUV = (u: number, v: number) => {
      const gx = Math.floor(u * W)
      // texture is upright (flipY default true): uv.v=1 is panel-top = sim row 0.
      const gy = Math.floor((1 - v) * H)
      const mat = erasing ? Mat.EMPTY : matRef.current
      const brush = 4
      if (lastCell) {
        const steps = Math.max(Math.abs(gx - lastCell.x), Math.abs(gy - lastCell.y))
        for (let s = 1; s <= steps; s++) {
          sim.paint(
            Math.round(lastCell.x + ((gx - lastCell.x) * s) / steps),
            Math.round(lastCell.y + ((gy - lastCell.y) * s) / steps),
            brush,
            mat,
          )
        }
        if (steps === 0) sim.paint(gx, gy, brush, mat)
      } else {
        sim.paint(gx, gy, brush, mat)
      }
      lastCell = { x: gx, y: gy }
    }

    // ---- the frame loop ---------------------------------------------------
    // fixed-timestep sim advance, mirrored from useSimulation, so the physics
    // run at the same speed regardless of display refresh rate.
    const STEP_MS = 1000 / 75
    const MAX_STEPS = 12
    const SPEED = 1
    const MOVE = 4 // metres/sec
    const HALF = ROOM / 2 - 0.6

    let raf = 0
    let last = performance.now()
    let acc = 0
    const fwd = new THREE.Vector3()
    const loop = (now: number) => {
      let dt = now - last
      last = now
      if (dt > 250) dt = 250

      // movement
      const sec = dt / 1000
      if (controls.isLocked) {
        if (keys.f) controls.moveForward(MOVE * sec)
        if (keys.b) controls.moveForward(-MOVE * sec)
        if (keys.r) controls.moveRight(MOVE * sec)
        if (keys.l) controls.moveRight(-MOVE * sec)
        camera.position.x = Math.max(-HALF, Math.min(HALF, camera.position.x))
        camera.position.z = Math.max(-HALF, Math.min(HALF, camera.position.z))
        camera.position.y = 1.7
      }
      void fwd

      // advance the sim
      acc += dt * SPEED
      let steps = Math.floor(acc / STEP_MS)
      acc -= steps * STEP_MS
      if (steps > MAX_STEPS) {
        steps = MAX_STEPS
        acc = 0
      }
      if (steps > 0) sim.step(steps)

      // paint where the crosshair points
      if (painting && controls.isLocked) {
        raycaster.setFromCamera(CENTER, camera)
        const hit = raycaster.intersectObject(panel, false)[0]
        if (hit?.uv) paintFromUV(hit.uv.x, hit.uv.y)
        else lastCell = null
      }

      // render the sim into its canvas, then push it to the gpu texture
      sim.render(simCtx, SCALE, true, true, 0.45)
      tex.needsUpdate = true

      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- resize -----------------------------------------------------------
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', onResize)

    // ---- teardown ---------------------------------------------------------
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onCtxMenu)
      window.removeEventListener('resize', onResize)
      controls.removeEventListener('lock', onLock)
      controls.removeEventListener('unlock', onUnlock)
      renderer.domElement.removeEventListener('click', onCanvasClick)
      controls.dispose()
      renderer.dispose()
      tex.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [])

  const matName = PALETTE.find((p) => p.id === material)?.name ?? 'material'

  return (
    <div ref={mountRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {/* crosshair */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          width: 6,
          height: 6,
          marginLeft: -3,
          marginTop: -3,
          borderRadius: '50%',
          background: '#fff',
          mixBlendMode: 'difference',
          pointerEvents: 'none',
        }}
      />
      {/* hud */}
      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          font: '13px ui-monospace, monospace',
          color: '#cdd3df',
          lineHeight: 1.6,
          pointerEvents: 'none',
          textShadow: '0 1px 2px #000',
        }}
      >
        <div>
          material: <b style={{ color: '#ffd0a0' }}>{matName}</b> — press s/w/o/f/… to switch
        </div>
        <div>WASD move · mouse look · click+hold to paint · right-click erase</div>
      </div>
      {/* click-to-start overlay */}
      {!locked && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(8,10,15,0.6)',
            color: '#e8ecf4',
            font: '600 18px ui-monospace, monospace',
            cursor: 'pointer',
            pointerEvents: 'none',
          }}
        >
          click to enter — WASD + mouse · look at the tank and click to paint
        </div>
      )}
    </div>
  )
}
