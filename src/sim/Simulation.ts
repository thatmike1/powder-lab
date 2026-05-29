import { density, isDissolvable, isMovable, Mat } from './materials'
import { encodeRLE } from './scene'

const CS = 16 // chunk size (cells per side)

// Background color (matches the canvas frame in CSS).
const BG_R = 16,
  BG_G = 18,
  BG_B = 22
const A = 0xff000000

function rgba(r: number, g: number, b: number): number {
  // Pack into the little-endian RGBA layout expected by Uint32 -> ImageData.
  return (A | (b << 16) | (g << 8) | r) >>> 0
}
function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
function shade(r: number, g: number, b: number, v: number): number {
  return rgba(clamp(r + v), clamp(g + v), clamp(b + v))
}
// Blend a color toward the background by factor t (1 = full color, 0 = bg).
function blendBg(r: number, g: number, b: number, t: number): number {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t
  return rgba(
    clamp(BG_R + (r - BG_R) * tt),
    clamp(BG_G + (g - BG_G) * tt),
    clamp(BG_B + (b - BG_B) * tt),
  )
}

const BG = rgba(BG_R, BG_G, BG_B)

export class Simulation {
  readonly W: number
  readonly H: number

  cells: Uint8Array // material id per cell
  life: Uint8Array // generic per-cell counter (fire/smoke/steam lifespan)
  extra: Uint8Array // per-cell random seed for color dithering / flicker
  stamp: Int32Array // last frame a cell was touched (prevents double-moves)

  frame = 0
  count = 0

  // Dirty-chunk scheduler: only chunks flagged active get simulated.
  readonly chunkW: number
  readonly chunkH: number
  private active: Uint8Array
  private activeNext: Uint8Array

  // Offscreen pixel buffers (1px per cell), blitted scaled to the visible canvas.
  private imageData: ImageData
  private buf32: Uint32Array
  private glowData: ImageData
  private glow32: Uint32Array
  private off: HTMLCanvasElement
  private offCtx: CanvasRenderingContext2D
  private glowCanvas: HTMLCanvasElement
  private glowCtx: CanvasRenderingContext2D

  constructor(W: number, H: number) {
    this.W = W
    this.H = H
    const n = W * H
    this.cells = new Uint8Array(n)
    this.life = new Uint8Array(n)
    this.extra = new Uint8Array(n)
    this.stamp = new Int32Array(n).fill(-1)
    for (let i = 0; i < n; i++) this.extra[i] = (Math.random() * 256) | 0

    this.chunkW = Math.ceil(W / CS)
    this.chunkH = Math.ceil(H / CS)
    this.active = new Uint8Array(this.chunkW * this.chunkH)
    // Start with everything queued so the first frame simulates the whole grid.
    this.activeNext = new Uint8Array(this.chunkW * this.chunkH).fill(1)

    this.imageData = new ImageData(W, H)
    this.buf32 = new Uint32Array(this.imageData.data.buffer)
    this.glowData = new ImageData(W, H)
    this.glow32 = new Uint32Array(this.glowData.data.buffer)

    this.off = document.createElement('canvas')
    this.off.width = W
    this.off.height = H
    const offCtx = this.off.getContext('2d')
    if (!offCtx) throw new Error('2d context unavailable for offscreen canvas')
    this.offCtx = offCtx
    this.glowCanvas = document.createElement('canvas')
    this.glowCanvas.width = W
    this.glowCanvas.height = H
    const glowCtx = this.glowCanvas.getContext('2d')
    if (!glowCtx) throw new Error('2d context unavailable for glow canvas')
    this.glowCtx = glowCtx
  }

  // ---- low-level cell ops ------------------------------------------------

  private matAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return Mat.WALL // treat edges as wall
    return this.cells[y * this.W + x]
  }

  /** Wake the chunk of (x,y) and any neighbor chunk a 3x3 neighbor lands in. */
  private wake(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= this.H) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= this.W) continue
        this.activeNext[((ny / CS) | 0) * this.chunkW + ((nx / CS) | 0)] = 1
      }
    }
  }

  private assignSpawnLife(i: number, mat: number): void {
    if (mat === Mat.FIRE) this.life[i] = 90 + ((Math.random() * 50) | 0)
    else if (mat === Mat.SMOKE) this.life[i] = 90 + ((Math.random() * 100) | 0)
    else if (mat === Mat.STEAM) this.life[i] = Math.min(255, 130 + ((Math.random() * 120) | 0))
    else this.life[i] = 0
  }

  /** Set a cell to a material, refreshing its random seed + lifespan, and wake it. */
  private setCell(x: number, y: number, mat: number): void {
    const i = y * this.W + x
    this.cells[i] = mat
    this.extra[i] = (Math.random() * 256) | 0
    this.assignSpawnLife(i, mat)
    this.stamp[i] = this.frame
    this.wake(x, y)
  }

  /** Swap two cells (material + life + seed) and mark both touched + awake. */
  private swap(x1: number, y1: number, x2: number, y2: number): void {
    const i1 = y1 * this.W + x1
    const i2 = y2 * this.W + x2
    const c = this.cells[i1]
    this.cells[i1] = this.cells[i2]
    this.cells[i2] = c
    const l = this.life[i1]
    this.life[i1] = this.life[i2]
    this.life[i2] = l
    const e = this.extra[i1]
    this.extra[i1] = this.extra[i2]
    this.extra[i2] = e
    this.stamp[i1] = this.frame
    this.stamp[i2] = this.frame
    this.wake(x1, y1)
    this.wake(x2, y2)
  }

  // ---- public API --------------------------------------------------------

  /** Paint a filled circle of `mat` (EMPTY = erase) centered at grid (cx,cy). */
  paint(cx: number, cy: number, r: number, mat: number): void {
    const r2 = r * r
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue
        const x = cx + dx,
          y = cy + dy
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue
        // Don't overwrite indestructible walls unless we're erasing.
        if (mat !== Mat.EMPTY && this.cells[y * this.W + x] === Mat.WALL) continue
        this.setCell(x, y, mat)
      }
    }
  }

  clear(): void {
    this.cells.fill(Mat.EMPTY)
    this.life.fill(0)
    this.activeNext.fill(1)
  }

  /** serialize the current grid (materials only) to a compact byte stream. */
  snapshot(): Uint8Array<ArrayBuffer> {
    return encodeRLE(this.cells, this.W, this.H)
  }

  /**
   * replace the grid with a previously decoded `cells` array. returns false on
   * a dimension mismatch (caller should surface a friendly error) and leaves
   * the grid untouched. on success it re-establishes the sim invariants:
   * lifespan materials are re-seeded, the color seed is regenerated, no cell is
   * stamped, and every chunk is woken so the restored scene actually simulates.
   */
  restore(cells: Uint8Array): boolean {
    const n = this.W * this.H
    if (cells.length !== n) return false
    this.cells.set(cells)
    this.life.fill(0)
    for (let i = 0; i < n; i++) {
      this.extra[i] = (Math.random() * 256) | 0
      // fire/smoke/steam need a lifespan or they'd die on the first frame.
      this.assignSpawnLife(i, this.cells[i])
    }
    this.stamp.fill(-1)
    this.activeNext.fill(1)
    return true
  }

  step(times = 1): void {
    for (let t = 0; t < times; t++) this.stepOnce()
  }

  private stepOnce(): void {
    this.frame++
    // Consume the queue built last frame; start a fresh one.
    const tmp = this.active
    this.active = this.activeNext
    this.activeNext = tmp
    this.activeNext.fill(0)

    const { W, H, chunkW, chunkH } = this
    const dir = this.frame & 1 ? 1 : -1 // alternate horizontal scan to kill bias

    for (let cy = chunkH - 1; cy >= 0; cy--) {
      for (let cx = 0; cx < chunkW; cx++) {
        if (!this.active[cy * chunkW + cx]) continue
        const x0 = cx * CS,
          x1 = Math.min(x0 + CS, W)
        const y0 = cy * CS,
          y1 = Math.min(y0 + CS, H)
        for (let y = y1 - 1; y >= y0; y--) {
          if (dir > 0) for (let x = x0; x < x1; x++) this.update(x, y)
          else for (let x = x1 - 1; x >= x0; x--) this.update(x, y)
        }
      }
    }
  }

  // ---- per-cell update dispatch -----------------------------------------

  private update(x: number, y: number): void {
    const i = y * this.W + x
    if (this.stamp[i] === this.frame) return // already moved/handled this frame
    const m = this.cells[i]
    switch (m) {
      case Mat.EMPTY:
      case Mat.WALL:
      case Mat.STONE:
        return
      case Mat.SAND:
        this.updatePowder(x, y, m)
        return
      case Mat.GUNPOWDER:
        if (this.touchesHot(x, y)) {
          this.explode(x, y)
          return
        }
        this.updatePowder(x, y, m)
        return
      case Mat.WATER:
        this.updateLiquid(x, y, m)
        return
      case Mat.OIL:
        if (this.touchesHot(x, y) && Math.random() < 0.3) {
          this.setCell(x, y, Mat.FIRE)
          return
        }
        this.updateLiquid(x, y, m)
        return
      case Mat.ACID:
        this.updateAcid(x, y)
        return
      case Mat.LAVA:
        this.updateLava(x, y)
        return
      case Mat.FIRE:
        this.updateFire(x, y, i)
        return
      case Mat.SMOKE:
        this.updateGas(x, y, i)
        return
      case Mat.STEAM:
        this.updateGas(x, y, i)
        return
      case Mat.WOOD:
        if (this.touchesHot(x, y) && Math.random() < 0.05) this.setCell(x, y, Mat.FIRE)
        return
      case Mat.PLANT:
        if (this.touchesHot(x, y) && Math.random() < 0.12) {
          this.setCell(x, y, Mat.FIRE)
          return
        }
        this.growPlant(x, y)
        return
      case Mat.ICE:
        this.updateIce(x, y)
        return
    }
  }

  // ---- movement primitives ----------------------------------------------

  /** Move (x,y) into (tx,ty) if empty, or swap if target is a lighter movable. */
  private tryMove(x: number, y: number, tx: number, ty: number, m: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return false
    const tm = this.cells[ty * this.W + tx]
    if (tm === Mat.EMPTY) {
      this.swap(x, y, tx, ty)
      return true
    }
    if (isMovable(tm) && density[m] > density[tm]) {
      this.swap(x, y, tx, ty)
      return true
    }
    return false
  }

  /** Like tryMove, but for rising gases: swap upward through denser movables. */
  private tryRise(x: number, y: number, tx: number, ty: number, m: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return false
    const tm = this.cells[ty * this.W + tx]
    if (tm === Mat.EMPTY) {
      this.swap(x, y, tx, ty)
      return true
    }
    if (isMovable(tm) && density[tm] > density[m]) {
      this.swap(x, y, tx, ty)
      return true
    }
    return false
  }

  private updatePowder(x: number, y: number, m: number): void {
    if (this.tryMove(x, y, x, y + 1, m)) return
    const first = Math.random() < 0.5 ? -1 : 1
    if (this.tryMove(x, y, x + first, y + 1, m)) return
    if (this.tryMove(x, y, x - first, y + 1, m)) return
  }

  private updateLiquid(x: number, y: number, m: number): void {
    if (this.tryMove(x, y, x, y + 1, m)) return
    const first = Math.random() < 0.5 ? -1 : 1
    if (this.tryMove(x, y, x + first, y + 1, m)) return
    if (this.tryMove(x, y, x - first, y + 1, m)) return
    // Horizontal spread to seek its own level.
    if (this.tryMove(x, y, x + first, y, m)) return
    if (this.tryMove(x, y, x - first, y, m)) return
  }

  private updateGas(x: number, y: number, i: number): void {
    if (this.life[i] <= 0) {
      this.setCell(x, y, Mat.EMPTY)
      return
    }
    this.life[i]--
    this.wake(x, y) // stay awake while alive (so it keeps fading even if stuck)
    const m = this.cells[i]
    const first = Math.random() < 0.5 ? -1 : 1
    if (this.tryRise(x, y, x, y - 1, m)) return
    if (this.tryRise(x, y, x + first, y - 1, m)) return
    if (this.tryRise(x, y, x - first, y - 1, m)) return
    if (this.tryRise(x, y, x + first, y, m)) return
    if (this.tryRise(x, y, x - first, y, m)) return
  }

  // ---- reactive materials ------------------------------------------------

  private touchesHot(x: number, y: number): boolean {
    return (
      this.isHot(this.matAt(x, y - 1)) ||
      this.isHot(this.matAt(x, y + 1)) ||
      this.isHot(this.matAt(x - 1, y)) ||
      this.isHot(this.matAt(x + 1, y))
    )
  }
  private isHot(m: number): boolean {
    return m === Mat.FIRE || m === Mat.LAVA
  }

  /** Fire/lava ignite flammable neighbors; gunpowder detonates. */
  private ignite(x: number, y: number): void {
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
      const nm = this.cells[ny * this.W + nx]
      if (nm === Mat.WOOD) {
        if (Math.random() < 0.05) this.setCell(nx, ny, Mat.FIRE)
      } else if (nm === Mat.OIL) {
        if (Math.random() < 0.25) this.setCell(nx, ny, Mat.FIRE)
      } else if (nm === Mat.PLANT) {
        if (Math.random() < 0.12) this.setCell(nx, ny, Mat.FIRE)
      } else if (nm === Mat.GUNPOWDER) this.explode(nx, ny)
    }
  }

  private updateFire(x: number, y: number, i: number): void {
    if (this.life[i] <= 0) {
      // Burn out into a puff of smoke most of the time.
      this.setCell(x, y, Math.random() < 0.6 ? Mat.SMOKE : Mat.EMPTY)
      return
    }
    this.life[i] -= 1 + ((Math.random() * 2) | 0)
    this.wake(x, y)

    // Douse: water neighbors sizzle into steam and snuff the flame.
    let doused = false
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
      if (this.cells[ny * this.W + nx] === Mat.WATER) {
        if (Math.random() < 0.3) this.setCell(nx, ny, Mat.STEAM)
        doused = true
      }
    }
    if (doused && Math.random() < 0.5) {
      this.setCell(x, y, Mat.SMOKE)
      return
    }

    this.ignite(x, y)

    // Flames lick upward.
    if (Math.random() < 0.5) {
      const first = Math.random() < 0.5 ? -1 : 1
      if (this.tryRise(x, y, x, y - 1, Mat.FIRE)) return
      if (this.tryRise(x, y, x + first, y - 1, Mat.FIRE)) return
    }
  }

  private updateLava(x: number, y: number): void {
    // Lava + water -> stone (+ steam where the water was).
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
      if (this.cells[ny * this.W + nx] === Mat.WATER) {
        this.setCell(nx, ny, Mat.STEAM)
        this.setCell(x, y, Mat.STONE)
        return
      }
    }
    this.ignite(x, y)
    this.wake(x, y) // keep lava pools shimmering / reactive

    // Viscous: only sometimes flow, and only sluggishly sideways.
    if (Math.random() < 0.6) {
      if (this.tryMove(x, y, x, y + 1, Mat.LAVA)) return
      const first = Math.random() < 0.5 ? -1 : 1
      if (this.tryMove(x, y, x + first, y + 1, Mat.LAVA)) return
      if (this.tryMove(x, y, x - first, y + 1, Mat.LAVA)) return
      if (Math.random() < 0.3) {
        if (this.tryMove(x, y, x + first, y, Mat.LAVA)) return
        if (this.tryMove(x, y, x - first, y, Mat.LAVA)) return
      }
    }
  }

  private updateAcid(x: number, y: number): void {
    const dirs = [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
      if (isDissolvable(this.cells[ny * this.W + nx]) && Math.random() < 0.25) {
        this.setCell(nx, ny, Mat.EMPTY)
        if (Math.random() < 0.4) {
          this.setCell(x, y, Mat.SMOKE)
          return
        } // acid spent
        break
      }
    }
    this.updateLiquid(x, y, Mat.ACID)
  }

  private growPlant(x: number, y: number): void {
    if (Math.random() > 0.012) return
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]
    for (const [dx, dy] of dirs) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
      if (this.cells[ny * this.W + nx] === Mat.WATER) {
        this.setCell(nx, ny, Mat.PLANT)
        return
      }
    }
  }

  private updateIce(x: number, y: number): void {
    if (this.touchesHot(x, y) && Math.random() < 0.1) {
      this.setCell(x, y, Mat.WATER)
      return
    }
    // Occasionally freeze adjacent water.
    if (Math.random() < 0.004) {
      const dirs = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]
      for (const [dx, dy] of dirs) {
        const nx = x + dx,
          ny = y + dy
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
        if (this.cells[ny * this.W + nx] === Mat.WATER) {
          this.setCell(nx, ny, Mat.ICE)
          return
        }
      }
    }
  }

  private explode(x: number, y: number): void {
    const R = 5
    const R2 = R * R
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R2) continue
        const nx = x + dx,
          ny = y + dy
        if (nx < 0 || ny < 0 || nx >= this.W || ny >= this.H) continue
        if (this.cells[ny * this.W + nx] === Mat.WALL) continue // walls survive
        this.setCell(nx, ny, Math.random() < 0.7 ? Mat.FIRE : Mat.EMPTY)
      }
    }
  }

  // ---- rendering ---------------------------------------------------------

  private colorOf(m: number, lf: number, ex: number): number {
    switch (m) {
      case Mat.WALL:
        return shade(120, 122, 130, (ex % 16) - 8)
      case Mat.SAND:
        return shade(196, 180, 120, (ex % 40) - 14)
      case Mat.WATER:
        return shade(48, 104, 200, (ex % 18) - 8)
      case Mat.STONE:
        return shade(94, 94, 102, (ex % 28) - 14)
      case Mat.WOOD:
        return shade(112, 74, 42, (ex % 32) - 14)
      case Mat.OIL:
        return shade(60, 52, 38, (ex % 16) - 8)
      case Mat.ACID:
        return shade(120, 214, 70, (ex % 34) - 14)
      case Mat.PLANT:
        return shade(46, 156, 58, (ex % 54) - 22)
      case Mat.ICE:
        return shade(168, 208, 234, (ex % 20) - 10)
      case Mat.GUNPOWDER:
        return shade(64, 62, 70, (ex % 28) - 14)
      case Mat.FIRE: {
        const t = lf > 120 ? 1 : lf / 120
        const f = ((ex + this.frame * 3) % 36) - 16 // animated flicker
        return rgba(clamp(255 + (f >> 1)), clamp(70 + ((160 * t) | 0) + f), clamp((40 * t * t) | 0))
      }
      case Mat.LAVA: {
        const f = ((ex + this.frame * 2) % 44) - 18
        return shade(255, 110, 30, f)
      }
      case Mat.SMOKE: {
        const t = lf / 180
        const g = 50 + ((40 * t) | 0)
        return blendBg(g, g, g + 4, Math.max(0.15, t))
      }
      case Mat.STEAM: {
        const t = lf / 250
        return blendBg(205, 210, 220, Math.max(0.35, t))
      }
    }
    return rgba(255, 0, 255) // should never happen — magenta = bug
  }

  private writeImage(): void {
    const { W, H, cells, life, extra, buf32, glow32 } = this
    const n = W * H
    let count = 0
    for (let i = 0; i < n; i++) {
      const m = cells[i]
      if (m === Mat.EMPTY) {
        buf32[i] = BG
        glow32[i] = 0
        continue
      }
      count++
      const c = this.colorOf(m, life[i], extra[i])
      buf32[i] = c
      glow32[i] = m === Mat.FIRE || m === Mat.LAVA ? c : 0
    }
    this.count = count
  }

  render(
    ctx: CanvasRenderingContext2D,
    scale: number,
    glow: boolean,
    light: boolean,
    darkness: number,
  ): void {
    this.writeImage()
    this.offCtx.putImageData(this.imageData, 0, 0)
    ctx.imageSmoothingEnabled = false
    const w = this.W * scale,
      h = this.H * scale
    ctx.drawImage(this.off, 0, 0, w, h)

    // both the bloom and lighting passes draw from the emissive (fire/lava)
    // buffer, so upload it once if either is on.
    if (glow || light) this.glowCtx.putImageData(this.glowData, 0, 0)

    // dynamic lighting: dim the whole scene toward black, then flood additive
    // radiance from emissive cells so light sources reveal their surroundings.
    if (light) {
      if (darkness > 0) {
        ctx.save()
        ctx.globalCompositeOperation = 'multiply'
        const v = Math.round(255 * (1 - darkness))
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(0, 0, w, h)
        ctx.restore()
      }
      // stacked blur radii approximate a long-tailed falloff: a tight hot core
      // (also keeps sources bright after the multiply-darken when bloom is off),
      // a mid spread, and a far reach.
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const passes = [
        { blur: Math.max(2, scale), alpha: 0.9 },
        { blur: scale * 6, alpha: 0.6 },
        { blur: scale * 12, alpha: 0.4 },
      ]
      for (const p of passes) {
        ctx.globalAlpha = p.alpha
        ctx.filter = `blur(${p.blur}px)`
        ctx.drawImage(this.glowCanvas, 0, 0, w, h)
      }
      ctx.restore()
    }

    // bloom: tight additive halo on the source cores (independent of lighting).
    if (glow) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.filter = `blur(${Math.max(2, scale)}px)`
      ctx.globalAlpha = 0.85
      ctx.drawImage(this.glowCanvas, 0, 0, w, h)
      ctx.restore()
    }
  }
}
