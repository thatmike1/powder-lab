import {
  boilPoint,
  density,
  emitTemp,
  freezePoint,
  ignitionPoint,
  isDissolvable,
  isMovable,
  Mat,
  meltPoint,
} from './materials'
import { encodeRLE } from './scene'

const CS = 16 // chunk size (cells per side)

// ---- heat field tuning ---------------------------------------------------
const AMBIENT = 20 // resting temperature everything relaxes toward
const DIFFUSE = 0.2 // fraction of the neighbor gradient that flows per frame
// (stable for the 4-neighbor stencil: 4*DIFFUSE < 1). higher = heat reaches a
// neighbor in a single frame, so a brief flame contact can still ignite wood.
const EPS = 0.5 // heat delta below which a cell is "settled" and stops waking

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
  heat: Float32Array // temperature per cell; diffuses each frame (Eulerian)
  private heatNext: Float32Array // double buffer for Jacobi-style diffusion

  frame = 0
  count = 0
  emissive = 0 // fire/lava cell count this frame; lets render() skip glow passes
  private showTemp = false // debug heatmap: render heat as a blue->red ramp

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
  // Scratch canvas (1px per cell) for blurring the glow in SOURCE space.
  private blurCanvas: HTMLCanvasElement
  private blurCtx: CanvasRenderingContext2D

  constructor(W: number, H: number) {
    this.W = W
    this.H = H
    const n = W * H
    this.cells = new Uint8Array(n)
    this.life = new Uint8Array(n)
    this.extra = new Uint8Array(n)
    this.stamp = new Int32Array(n).fill(-1)
    this.heat = new Float32Array(n).fill(AMBIENT)
    this.heatNext = new Float32Array(n)
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
    this.blurCanvas = document.createElement('canvas')
    this.blurCanvas.width = W
    this.blurCanvas.height = H
    const blurCtx = this.blurCanvas.getContext('2d')
    if (!blurCtx) throw new Error('2d context unavailable for blur canvas')
    this.blurCtx = blurCtx
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
    else if (mat === Mat.LIGHTNING)
      this.life[i] = 5 + ((Math.random() * 5) | 0) // brief flash
    else this.life[i] = 0
  }

  /** Seed a freshly-set source cell (fire/lava/ice) at its emission temperature. */
  private assignSpawnHeat(i: number, mat: number): void {
    if (emitTemp[mat]) this.heat[i] = emitTemp[mat]
  }

  /** Set a cell to a material, refreshing its random seed + lifespan, and wake it. */
  private setCell(x: number, y: number, mat: number): void {
    const i = y * this.W + x
    this.cells[i] = mat
    this.extra[i] = (Math.random() * 256) | 0
    this.assignSpawnLife(i, mat)
    this.assignSpawnHeat(i, mat)
    this.stamp[i] = this.frame
    this.wake(x, y)
  }

  /**
   * Swap two cells (material + life + seed) and mark both touched + awake.
   * `heat` is deliberately NOT swapped: temperature is a property of *space*
   * (Eulerian field), not of the particle. A moving source re-asserts its
   * emission temperature at its new cell next frame, so this self-corrects.
   */
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

  /** materials a bolt arcs *through* (and superheats) instead of stopping at. */
  private isConductor(m: number): boolean {
    return m === Mat.WATER
  }

  /**
   * Deposit the bolt at one cell. Returns true if the cell stops the bolt.
   * Heat is injected regardless of material, so ignition/boil/melt all emerge
   * from the heat field: empty air becomes a visible LIGHTNING flash, conductors
   * (water) are superheated and passed through, and any other matter is the
   * strike point — heated, then the bolt terminates there.
   */
  private zap(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true
    const i = y * this.W + x
    const m = this.cells[i]
    if (this.heat[i] < emitTemp[Mat.LIGHTNING]) this.heat[i] = emitTemp[Mat.LIGHTNING]
    this.wake(x, y)
    if (m === Mat.EMPTY) {
      this.setCell(x, y, Mat.LIGHTNING) // re-seeds heat via assignSpawnHeat
      return false
    }
    return !this.isConductor(m) // conductors pass through; everything else stops
  }

  /**
   * Horizontal pull toward the nearest conductor a few rows below — this is what
   * makes a bolt bend toward a water pool rather than fall dead straight.
   * Returns -1 (pull left), +1 (pull right), or 0 (none in reach).
   */
  private conductorPull(x: number, y: number): number {
    const reach = 14
    for (let r = 1; r <= 4; r++) {
      const yy = y + r
      if (yy >= this.H) break
      for (let d = 1; d <= reach; d++) {
        if (this.isConductor(this.matAt(x - d, yy))) return -1
        if (this.isConductor(this.matAt(x + d, yy))) return 1
      }
    }
    return 0
  }

  /**
   * Walk a single jagged leader from (x,y): step mostly downward with horizontal
   * jitter, bend toward conductors, and occasionally fork a shorter child bolt.
   * Recurses for branches (depth-capped); each step writes via zap().
   */
  private bolt(x: number, y: number, depth: number, maxSteps: number): void {
    for (let steps = 0; steps < maxSteps; steps++) {
      if (this.zap(x, y)) return // hit ground / solid / edge
      if (y >= this.H - 1) return // reached the floor
      const pull = this.conductorPull(x, y)
      const jitter = Math.random() < 0.34 ? -1 : Math.random() < 0.5 ? 1 : 0
      let dx = jitter + pull
      dx = dx < -1 ? -1 : dx > 1 ? 1 : dx
      const dy = Math.random() < 0.82 ? 1 : 0
      const nx = x + dx
      let ny = y + dy
      if (nx === x && ny === y) ny = y + 1 // never stall in place
      // fork a child bolt sideways now and then for that branched look
      if (depth < 2 && Math.random() < 0.07) {
        this.bolt(x + (Math.random() < 0.5 ? -1 : 1), y + 1, depth + 1, maxSteps >> 1)
      }
      x = nx
      y = ny
    }
  }

  /**
   * Fire an instant lightning bolt from (sx,sy) — the public click-to-strike
   * entry point. The bolt and all its branches are traced synchronously; the
   * resulting LIGHTNING cells then flash and fade over the next few frames.
   */
  strike(sx: number, sy: number): void {
    if (sx < 0 || sy < 0 || sx >= this.W || sy >= this.H) return
    this.bolt(sx, sy, 0, this.H + 40)
  }

  clear(): void {
    this.cells.fill(Mat.EMPTY)
    this.life.fill(0)
    this.heat.fill(AMBIENT)
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
    this.heat.fill(AMBIENT)
    for (let i = 0; i < n; i++) {
      this.extra[i] = (Math.random() * 256) | 0
      // fire/smoke/steam need a lifespan or they'd die on the first frame.
      this.assignSpawnLife(i, this.cells[i])
      // re-seed source temperatures so fire/lava/ice load at the right heat.
      this.assignSpawnHeat(i, this.cells[i])
    }
    this.stamp.fill(-1)
    this.activeNext.fill(1)
    return true
  }

  step(times = 1): void {
    for (let t = 0; t < times; t++) this.stepOnce()
  }

  /** toggle the debug heatmap overlay (read by colorOf at render time). */
  setShowTemp(on: boolean): void {
    this.showTemp = on
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

    // Heat diffuses AFTER the material walk: sources deposit their temperature
    // for this frame (emission in updateFire/updateLava/ICE), then it spreads.
    this.diffuse()
  }

  /**
   * Jacobi-style heat diffusion over active chunks (read `heat`, write
   * `heatNext`, then swap). Jacobi (vs in-place) keeps the pass symmetric and
   * order-independent — unlike the material walk, heat must have no directional
   * bias. This pass only ever writes `heatNext`, never `cells`, so it moves no
   * particle and the `stamp` double-move contract is untouched.
   */
  private diffuse(): void {
    const { W, H, chunkW, chunkH, heat, heatNext } = this
    // full copy so cells in sleeping chunks carry their temperature forward
    // unchanged across the buffer swap (no stale/zero values when they wake).
    heatNext.set(heat)
    for (let cy = 0; cy < chunkH; cy++) {
      for (let cx = 0; cx < chunkW; cx++) {
        if (!this.active[cy * chunkW + cx]) continue
        const x0 = cx * CS,
          x1 = Math.min(x0 + CS, W)
        const y0 = cy * CS,
          y1 = Math.min(y0 + CS, H)
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * W + x
            const h = heat[i]
            // out-of-bounds neighbors read as AMBIENT (walls don't conduct in v1)
            const hUp = y > 0 ? heat[i - W] : AMBIENT
            const hDown = y < H - 1 ? heat[i + W] : AMBIENT
            const hLeft = x > 0 ? heat[i - 1] : AMBIENT
            const hRight = x < W - 1 ? heat[i + 1] : AMBIENT
            const next = h + DIFFUSE * (hUp + hDown + hLeft + hRight - 4 * h)
            heatNext[i] = next
            // re-arm this cell's chunk + neighbors while heat is still moving;
            // once everything settles within EPS, wakes stop and chunks sleep.
            if (next - h > EPS || h - next > EPS) this.wake(x, y)
          }
        }
      }
    }
    this.heat = heatNext
    this.heatNext = heat
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
        if (this.heat[i] >= ignitionPoint[Mat.GUNPOWDER]) {
          this.explode(x, y)
          return
        }
        this.updatePowder(x, y, m)
        return
      case Mat.WATER:
        this.updateWater(x, y, i, m)
        return
      case Mat.OIL:
        if (this.heat[i] >= ignitionPoint[Mat.OIL] && Math.random() < 0.3) {
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
      case Mat.LIGHTNING:
        this.updateLightning(x, y, i)
        return
      case Mat.SMOKE:
        this.updateGas(x, y, i)
        return
      case Mat.STEAM:
        this.updateSteam(x, y, i)
        return
      case Mat.WOOD:
        if (this.heat[i] >= ignitionPoint[Mat.WOOD] && Math.random() < 0.05)
          this.setCell(x, y, Mat.FIRE)
        return
      case Mat.PLANT:
        if (this.heat[i] >= ignitionPoint[Mat.PLANT] && Math.random() < 0.12) {
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

  /**
   * Water: heat-driven phase changes, then liquid movement. Flammables/sources
   * ignite emergently via the heat field, so water no longer special-cases its
   * neighbors — it reacts only to its own cell temperature.
   */
  private updateWater(x: number, y: number, i: number, m: number): void {
    if (this.heat[i] >= boilPoint[Mat.WATER] && Math.random() < 0.4) {
      this.setCell(x, y, Mat.STEAM) // boil -> steam (carries the hot temp up)
      return
    }
    if (this.heat[i] <= freezePoint[Mat.WATER]) {
      this.setCell(x, y, Mat.ICE) // cold-driven freeze (ice chills via diffusion)
      return
    }
    this.updateLiquid(x, y, m)
  }

  /**
   * Steam: rarely condenses back to water once cooled, otherwise rises & fades.
   * Condensation is intentionally a low-probability event: making it certain
   * turns a plume into a closed boil->rise->condense->rain->boil convection loop
   * (the "breathing cloud"). At ~2%/frame most steam dissipates via its lifespan
   * instead, so only a little water drizzles back and the loop never sustains.
   */
  private updateSteam(x: number, y: number, i: number): void {
    if (this.heat[i] <= freezePoint[Mat.STEAM] && Math.random() < 0.02) {
      this.setCell(x, y, Mat.WATER) // condense — occasional water-cycle close
      return
    }
    this.updateGas(x, y, i) // rises and fades by lifespan in updateGas
  }

  private updateFire(x: number, y: number, i: number): void {
    if (this.life[i] <= 0) {
      // Burn out into a puff of smoke most of the time.
      this.setCell(x, y, Math.random() < 0.6 ? Mat.SMOKE : Mat.EMPTY)
      return
    }
    this.life[i] -= 1 + ((Math.random() * 2) | 0)
    // re-assert emission temperature (diffusion bled it away last frame); this
    // is what ignites/boils/melts neighbors once it spreads into them.
    if (this.heat[i] < emitTemp[Mat.FIRE]) this.heat[i] = emitTemp[Mat.FIRE]
    this.wake(x, y)

    // Snuff: a flame sitting in heat below its own emission means a cold sink
    // (water boiling next to it) is winning — puff out to smoke sometimes.
    if (
      (this.matAt(x, y - 1) === Mat.WATER ||
        this.matAt(x, y + 1) === Mat.WATER ||
        this.matAt(x - 1, y) === Mat.WATER ||
        this.matAt(x + 1, y) === Mat.WATER) &&
      Math.random() < 0.25
    ) {
      this.setCell(x, y, Mat.SMOKE)
      return
    }

    // Flames lick upward.
    if (Math.random() < 0.5) {
      const first = Math.random() < 0.5 ? -1 : 1
      if (this.tryRise(x, y, x, y - 1, Mat.FIRE)) return
      if (this.tryRise(x, y, x + first, y - 1, Mat.FIRE)) return
    }
  }

  /**
   * Lightning doesn't move — it just flashes in place and dies fast. While
   * alive it keeps re-asserting strike heat into its cell so the air-path stays
   * scorching long enough to ignite/boil/melt what it passes, then vanishes.
   */
  private updateLightning(x: number, y: number, i: number): void {
    // compare BEFORE subtracting: life is a Uint8Array, so decrementing past 0
    // wraps to ~255 and the bolt cell would flash forever (and never let its
    // chunk sleep). its short lifespan lands on that boundary almost every time.
    const dec = 1 + ((Math.random() * 2) | 0)
    if (this.life[i] <= dec) {
      this.setCell(x, y, Mat.EMPTY)
      return
    }
    this.life[i] -= dec
    if (this.heat[i] < emitTemp[Mat.LIGHTNING]) this.heat[i] = emitTemp[Mat.LIGHTNING]
    this.wake(x, y)
  }

  /** active coolants (cold/wet matter) that can quench lava into a crust. */
  private isCoolant(m: number): boolean {
    return m === Mat.WATER || m === Mat.STEAM || m === Mat.ICE
  }
  /** true if any 4-neighbor is an active coolant. */
  private nearCoolant(x: number, y: number): boolean {
    return (
      this.isCoolant(this.matAt(x, y - 1)) ||
      this.isCoolant(this.matAt(x, y + 1)) ||
      this.isCoolant(this.matAt(x - 1, y)) ||
      this.isCoolant(this.matAt(x + 1, y))
    )
  }

  private updateLava(x: number, y: number): void {
    const i = y * this.W + x
    // Lava solidifies into a stone crust only where it is BOTH cold enough AND
    // touching a coolant (water/steam/ice). the coolant gate is the key to not
    // crusting in open air: pure temperature would also freeze lava surrounded
    // by air, because air is a colder sink than water, so a thin stream petrifies
    // mid-fall. requiring real coolant contact keeps airborne lava molten while
    // still forming a crust where it meets water. CHECKED BEFORE re-emission so
    // it tests the value last frame's diffusion left behind (re-asserting first
    // would pin heat to emitTemp and the test could never fire).
    // (a per-material heat conductivity would model this more cleanly — bd.)
    if (this.heat[i] <= freezePoint[Mat.LAVA] && this.nearCoolant(x, y)) {
      this.setCell(x, y, Mat.STONE)
      return
    }
    // re-assert emission so the pool stays molten and keeps heating neighbors.
    if (this.heat[i] < emitTemp[Mat.LAVA]) this.heat[i] = emitTemp[Mat.LAVA]
    this.wake(x, y) // keep lava pools shimmering / reactive

    // Viscous: only sometimes flow, and only sluggishly sideways.
    if (Math.random() < 0.6) {
      if (this.moveLava(x, y, x, y + 1)) return
      const first = Math.random() < 0.5 ? -1 : 1
      if (this.moveLava(x, y, x + first, y + 1)) return
      if (this.moveLava(x, y, x - first, y + 1)) return
      if (Math.random() < 0.3) {
        if (this.moveLava(x, y, x + first, y)) return
        if (this.moveLava(x, y, x - first, y)) return
      }
    }
  }

  /**
   * Move lava and carry its molten temperature to the destination. Heat is an
   * Eulerian field (swap leaves it in place), so a cell lava just flowed into
   * holds the *old* (cold) temperature — without this it would read below
   * freezePoint next frame and petrify mid-flow. Seeding the destination keeps
   * a flowing stream liquid; it only crusts once it stops and stays exposed.
   */
  private moveLava(x: number, y: number, tx: number, ty: number): boolean {
    if (!this.tryMove(x, y, tx, ty, Mat.LAVA)) return false
    const ti = ty * this.W + tx
    if (this.heat[ti] < emitTemp[Mat.LAVA]) this.heat[ti] = emitTemp[Mat.LAVA]
    this.wake(tx, ty)
    return true
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
    const i = y * this.W + x
    // Melt -> water. CHECKED BEFORE re-chilling, against last frame's diffused
    // value (mirrors lava): re-asserting the cold emission first would pin the
    // cell below meltPoint forever. Ice in ambient (20 < meltPoint 40) self-
    // cools and stays frozen; a hot neighbor (fire/lava) overwhelms it.
    if (this.heat[i] >= meltPoint[Mat.ICE] && Math.random() < 0.1) {
      this.setCell(x, y, Mat.WATER)
      return
    }
    // re-assert the cold emission so ice keeps chilling neighbors via diffusion;
    // this is what drives the emergent cold freezing of adjacent water.
    if (this.heat[i] > emitTemp[Mat.ICE]) this.heat[i] = emitTemp[Mat.ICE]
    this.wake(x, y)
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

  /**
   * Final on-screen color for a cell. Heat enters two ways: a debug heatmap
   * (blue->red ramp, ignores material) when `showTemp` is set, and otherwise an
   * always-on subtle warm tint on ordinary matter (fire/lava are already
   * saturated + animated, so they're left alone).
   */
  private colorOf(m: number, lf: number, ex: number, h: number): number {
    if (this.showTemp) return this.heatColor(h)
    const c = this.baseColor(m, lf, ex)
    if (m === Mat.FIRE || m === Mat.LAVA || m === Mat.LIGHTNING) return c
    return this.tint(c, h)
  }

  /** subtle warm shift: hotter pushes red up / blue down, colder the reverse. */
  private tint(c: number, h: number): number {
    let d = (h - AMBIENT) * 0.06
    if (d < -14) d = -14
    else if (d > 14) d = 14
    const r = c & 0xff
    const g = (c >> 8) & 0xff
    const b = (c >> 16) & 0xff
    return rgba(clamp(r + d), g, clamp(b - d))
  }

  /** debug heatmap ramp: cold -> blue, ambient -> white-ish, hot -> red. */
  private heatColor(h: number): number {
    const t = h < -60 ? 0 : h > 600 ? 1 : (h + 60) / 660
    const r = clamp(255 * Math.min(1, t * 2))
    const b = clamp(255 * Math.min(1, (1 - t) * 2))
    const g = clamp(255 * (1 - Math.abs(t - 0.5) * 2))
    return rgba(r, g, b)
  }

  private baseColor(m: number, lf: number, ex: number): number {
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
      case Mat.LIGHTNING: {
        // hot near-white core with a blue cast; fast per-cell flicker keeps the
        // bolt alive-looking across its few render frames. brighter while young.
        const t = lf > 6 ? 1 : lf / 6
        const f = ((ex + this.frame * 5) % 40) - 18
        return rgba(clamp(180 + ((40 * t) | 0) + f), clamp(200 + ((30 * t) | 0) + f), 255)
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
    const { W, H, cells, life, extra, heat, buf32, glow32 } = this
    const n = W * H
    let count = 0
    let emissive = 0
    for (let i = 0; i < n; i++) {
      const m = cells[i]
      if (m === Mat.EMPTY) {
        // in heatmap mode even empty space shows its temperature.
        buf32[i] = this.showTemp ? this.heatColor(heat[i]) : BG
        glow32[i] = 0
        continue
      }
      count++
      const c = this.colorOf(m, life[i], extra[i], heat[i])
      buf32[i] = c
      if (m === Mat.FIRE || m === Mat.LAVA || m === Mat.LIGHTNING) {
        glow32[i] = c
        emissive++
      } else {
        glow32[i] = 0
      }
    }
    this.count = count
    this.emissive = emissive
  }

  /**
   * blur the emissive buffer in SOURCE space (the small W×H glow canvas) and
   * composite it onto `ctx` upscaled. blurring 200×150 at radius/scale is ~16×
   * fewer pixels with a ¼-size kernel versus blurring the full-res canvas, and
   * matters because Firefox's canvas2D blur runs on the CPU (Chrome's is GPU).
   * the upscale uses bilinear smoothing so the small blur reads as a smooth
   * gradient rather than blocky cells.
   */
  private glowPass(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number,
    screenBlur: number,
    alpha: number,
  ): void {
    const { W, H, blurCtx, blurCanvas, glowCanvas } = this
    const radius = Math.max(0.5, screenBlur / scale)
    blurCtx.clearRect(0, 0, W, H)
    blurCtx.filter = `blur(${radius}px)`
    blurCtx.drawImage(glowCanvas, 0, 0)
    blurCtx.filter = 'none'
    ctx.globalAlpha = alpha
    ctx.drawImage(blurCanvas, 0, 0, w, h)
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

    // the additive glow passes draw from the emissive (fire/lava) buffer; with
    // nothing emissive there's nothing to flood, so skip uploading it entirely.
    const hasLight = this.emissive > 0
    if ((glow || light) && hasLight) this.glowCtx.putImageData(this.glowData, 0, 0)

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
      // a mid spread, and a far reach. radii are screen-space; glowPass scales
      // them down to source space.
      if (hasLight) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.imageSmoothingEnabled = true
        this.glowPass(ctx, w, h, scale, Math.max(2, scale), 0.9)
        this.glowPass(ctx, w, h, scale, scale * 6, 0.6)
        this.glowPass(ctx, w, h, scale, scale * 12, 0.4)
        ctx.restore()
      }
    }

    // bloom: tight additive halo on the source cores (independent of lighting).
    if (glow && hasLight) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.imageSmoothingEnabled = true
      this.glowPass(ctx, w, h, scale, Math.max(2, scale), 0.85)
      ctx.restore()
    }
  }
}
