// the gallery's scene library: hand-authored pixel-art "paintings" and
// "contraptions" assembled from the simulation's own materials. each preset
// draws into a flat material grid (the same `cells` array `Simulation.restore`
// expects), so picking one in the gallery just hands those bytes to restore().
//
// two kinds live here:
//   - contraptions: built to come alive the moment you press play (sand drains,
//     lava erupts, a fuse burns to a powder keg). the lighting hint leans dark
//     so glow reads.
//   - paintings: still pixel art that looks good frozen (a lava heart, an oak,
//     an aquarium). the lighting hint turns Light off so flat material color
//     shows at full strength on the black board.

import { Mat } from './materials'
import { Rng } from './rng'

/** lighting the board should adopt when a scene loads (so each scene looks its best). */
export interface SceneLight {
  /** master Light toggle. paintings want it off (full color); glow scenes want it on. */
  light: boolean
  /** ambient darkness 0..1, only meaningful while Light is on. */
  darkness: number
}

export interface Preset {
  id: string
  name: string
  /** short verb/vibe label shown on the card (POUR, ERUPT, GLOW, CALM…). */
  tag: string
  /** one playful line of description. */
  blurb: string
  /** which shelf of the gallery it sits on. */
  group: 'contraption' | 'painting' | 'experimental'
  /** lighting the board adopts on load. */
  light: SceneLight
  /** paint the scene into a fresh W×H material grid and return it. */
  build(W: number, H: number): Uint8Array
}

// lighting presets, named so the scene table reads cleanly. exported so the
// experimental scene pack can share the same vocabulary.
export const DRAMA: SceneLight = { light: true, darkness: 0.62 } // glow-forward, dim room
export const NIGHT: SceneLight = { light: true, darkness: 0.74 } // darker, for firelight
export const FLAT: SceneLight = { light: false, darkness: 0.55 } // full material color

// ---------------------------------------------------------------------------
// drawing surface: a tiny imperative painter over the flat grid. all geometry
// is integer pixels; bounds are clamped so a scene can never write out of range.
// ---------------------------------------------------------------------------

export class Painter {
  readonly g: Uint8Array
  private rng: Rng

  constructor(
    readonly W: number,
    readonly H: number,
    seed = 1,
  ) {
    this.g = new Uint8Array(W * H)
    this.rng = new Rng(seed)
  }

  private rnd(): number {
    return this.rng.next()
  }

  set(x: number, y: number, m: number): void {
    x |= 0
    y |= 0
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return
    this.g[y * this.W + x] = m
  }

  /** filled rectangle, inclusive of both corners. */
  rect(x0: number, y0: number, x1: number, y1: number, m: number): void {
    if (x1 < x0) [x0, x1] = [x1, x0]
    if (y1 < y0) [y0, y1] = [y1, y0]
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, m)
  }

  /** rectangle outline of thickness t. */
  frame(x0: number, y0: number, x1: number, y1: number, m: number, t = 1): void {
    this.rect(x0, y0, x1, y0 + t - 1, m)
    this.rect(x0, y1 - t + 1, x1, y1, m)
    this.rect(x0, y0, x0 + t - 1, y1, m)
    this.rect(x1 - t + 1, y0, x1, y1, m)
  }

  /** filled disc of radius r. */
  disc(cx: number, cy: number, r: number, m: number): void {
    const r2 = r * r
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) this.set(cx + x, cy + y, m)
  }

  /** upper half of a disc — a dome/cap (mushroom tops, hills). */
  dome(cx: number, cy: number, r: number, m: number): void {
    const r2 = r * r
    for (let y = -r; y <= 0; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) this.set(cx + x, cy + y, m)
  }

  /** thick line via Bresenham, stamping a (2t+1) square at each step. */
  line(x0: number, y0: number, x1: number, y1: number, m: number, t = 0): void {
    x0 |= 0
    y0 |= 0
    x1 |= 0
    y1 |= 0
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      if (t <= 0) this.set(x0, y0, m)
      else this.rect(x0 - t, y0 - t, x0 + t, y0 + t, m)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  /** filled isosceles triangle from apex down to a flat base at y=baseY. */
  cone(apexX: number, apexY: number, baseY: number, baseHalf: number, m: number): void {
    const span = baseY - apexY
    if (span <= 0) return
    for (let y = apexY; y <= baseY; y++) {
      const hw = Math.round((baseHalf * (y - apexY)) / span)
      this.rect(apexX - hw, y, apexX + hw, y, m)
    }
  }

  /** scatter material into a box at the given probability — grain, embers, stars. */
  speckle(x0: number, y0: number, x1: number, y1: number, m: number, p: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (this.rnd() < p) this.set(x, y, m)
  }

  /**
   * stamp a string-grid sprite. each char maps to a material via `legend`;
   * chars absent from the legend (typically '.') are left transparent. `scale`
   * blows each source pixel up to a scale×scale block.
   */
  sprite(ox: number, oy: number, rows: string[], legend: Record<string, number>, scale = 1): void {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const m = legend[rows[r][c]]
        if (m == null) continue
        this.rect(
          ox + c * scale,
          oy + r * scale,
          ox + c * scale + scale - 1,
          oy + r * scale + scale - 1,
          m,
        )
      }
    }
  }

  /** flood the bottom rows from y down to the floor. */
  floor(y: number, m: number): void {
    this.rect(0, y, this.W - 1, this.H - 1, m)
  }
}

// shorthand so the scene table stays readable.
const {
  WALL,
  SAND,
  WATER,
  STONE,
  WOOD,
  FIRE,
  SMOKE,
  OIL,
  LAVA,
  ACID,
  PLANT,
  GUNPOWDER,
  ICE,
  METAL,
  GLASS,
} = Mat

// ---------------------------------------------------------------------------
// CONTRAPTIONS — built to do something the instant you hit play.
// ---------------------------------------------------------------------------

/** an hourglass: sand fills the top bulb and sifts through a narrow glass neck. */
function buildHourglass(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  const top = 22
  const bot = 128
  const neck = (top + bot) >> 1
  const bulb = 46 // half-width at the wide ends
  const gap = 3 // half-width of the neck opening

  // glass walls of both bulbs, traced edge by edge.
  for (let y = top; y <= bot; y++) {
    const t = y <= neck ? (y - top) / (neck - top) : (bot - y) / (bot - neck)
    const hw = Math.round(gap + (bulb - gap) * (1 - t))
    p.set(cx - hw, y, GLASS)
    p.set(cx - hw - 1, y, GLASS)
    p.set(cx + hw, y, GLASS)
    p.set(cx + hw + 1, y, GLASS)
    // sand fills the upper bulb interior, leaving a little headroom.
    if (y > top + 4 && y < neck - 1) p.rect(cx - hw + 1, y, cx + hw - 1, y, SAND)
  }

  // wooden frame: caps top and bottom, posts down each side, a little stand.
  p.rect(cx - bulb - 4, top - 4, cx + bulb + 4, top - 1, WOOD)
  p.rect(cx - bulb - 4, bot + 1, cx + bulb + 4, bot + 4, WOOD)
  p.rect(cx - bulb - 4, top - 4, cx - bulb - 1, bot + 4, WOOD)
  p.rect(cx + bulb + 1, top - 4, cx + bulb + 4, bot + 4, WOOD)
  p.cone(cx, bot + 4, H - 1, bulb + 14, WOOD)
  return p.g
}

/** a volcano: a stone cone with a molten core and a lava streak down one flank. */
function buildVolcano(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  const baseY = 126
  p.floor(baseY, STONE)
  p.speckle(0, baseY, W - 1, H - 1, GUNPOWDER, 0.04) // dark mineral grain in the ground
  // the cone.
  p.cone(cx, 42, baseY, 58, STONE)
  // molten conduit + a crater pool at the summit.
  p.rect(cx - 4, 64, cx + 4, baseY, LAVA)
  p.rect(cx - 9, 44, cx + 9, 52, LAVA)
  // a lava flow already creeping down the right flank (it spreads on play).
  p.line(cx + 8, 50, cx + 46, 118, LAVA, 1)
  p.speckle(cx - 9, 40, cx + 9, 46, FIRE, 0.25) // a lick of fire at the mouth
  p.speckle(cx - 14, 30, cx + 14, 42, SMOKE, 0.06) // a wisp of smoke
  return p.g
}

/** a waterfall pouring off a mossy stone cliff into a basin below. */
function buildWaterfall(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  // a tall stone cliff on the left; its shelf top is at y=52.
  p.rect(0, 52, 54, H - 1, STONE)
  // a back wall taller than the shelf, damming the reservoir on the left.
  p.rect(0, 28, 8, 52, STONE)
  // the reservoir sits on the shelf with its right side OPEN — so on play it
  // tips over the cliff's edge and cascades down into the basin below.
  p.rect(9, 32, 52, 51, WATER)
  // moss on the rim and down the cliff face.
  p.rect(0, 26, 8, 27, PLANT)
  p.speckle(0, 52, 54, 60, PLANT, 0.16)
  // the catch basin: a stone floor with a tall right wall to hold the pool.
  p.floor(132, STONE)
  p.rect(150, 100, 158, 131, STONE)
  p.rect(55, 116, 150, 131, WATER) // a starting pool the fall keeps feeding
  return p.g
}

/** a campfire: crossed logs around a flame, ringed with stones, under a night sky. */
function buildCampfire(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  p.speckle(0, 6, W - 1, 60, ICE, 0.006) // faint stars
  p.floor(140, SAND)
  // ring of hearth stones.
  for (const dx of [-30, -20, 20, 30]) p.disc(cx + dx, 138, 4, STONE)
  // crossed logs (a little teepee) plus a base log.
  p.line(cx - 22, 139, cx + 16, 118, WOOD, 1)
  p.line(cx + 22, 139, cx - 16, 118, WOOD, 1)
  p.line(cx - 24, 136, cx + 24, 136, WOOD, 1)
  // the flame, hottest at the core.
  p.disc(cx, 130, 6, FIRE)
  p.speckle(cx - 10, 120, cx + 10, 136, FIRE, 0.45)
  p.speckle(cx - 8, 104, cx + 8, 120, SMOKE, 0.12)
  return p.g
}

/** a powder keg: a lit fuse snaking down to barrels packed with gunpowder. */
function buildPowderKeg(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(142, STONE)
  // two barrels: wood staves packed with gunpowder.
  const barrel = (x0: number, x1: number, y0: number) => {
    p.frame(x0, y0, x1, 141, WOOD, 2)
    p.rect(x0 + 2, y0 + 2, x1 - 2, 139, GUNPOWDER)
    p.rect(x0, y0 + ((141 - y0) >> 1), x1, y0 + ((141 - y0) >> 1) + 1, WOOD) // belly band
  }
  barrel(118, 150, 110)
  barrel(155, 182, 116)
  // the fuse: a fat powder trail snaking up to a spark. it has to be a few cells
  // thick — a 1px fuse loses heat to the cooling field faster than it ignites,
  // so the flame fizzles instead of racing down it.
  p.line(134, 110, 110, 78, GUNPOWDER, 2)
  p.line(110, 78, 70, 66, GUNPOWDER, 2)
  p.line(70, 66, 48, 50, GUNPOWDER, 2)
  // the spark, sitting right on the end of the fuse.
  p.disc(48, 50, 3, FIRE)
  p.speckle(42, 44, 54, 56, FIRE, 0.4)
  return p.g
}

/** an acid tank: a stone idol dissolving in a glass vat of acid. */
function buildAcidTank(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  // glass vat, open at the top.
  p.rect(54, 45, 56, 142, GLASS)
  p.rect(144, 45, 146, 142, GLASS)
  p.rect(54, 140, 146, 142, GLASS)
  // the acid bath.
  p.rect(57, 92, 143, 139, ACID)
  p.speckle(57, 92, 143, 95, ACID, 0.5) // a fizzing surface
  // the idol: a pillar with a head, standing in the acid.
  p.rect(cx - 5, 66, cx + 5, 139, STONE)
  p.disc(cx, 60, 8, STONE)
  p.rect(cx - 9, 60, cx + 9, 64, STONE) // shoulders
  return p.g
}

/** a forest fire: a stand of trees with the canopy already alight on one end. */
function buildForestFire(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(137, SAND)
  p.rect(0, 132, W - 1, 137, PLANT) // grass line
  p.speckle(0, 130, W - 1, 132, PLANT, 0.4)
  const tree = (x: number, onFire: boolean) => {
    p.rect(x - 2, 96, x + 2, 134, WOOD)
    p.disc(x, 88, 18, PLANT)
    if (onFire) {
      p.disc(x, 88, 10, FIRE)
      p.speckle(x - 18, 72, x + 18, 96, FIRE, 0.35)
      p.speckle(x - 14, 56, x + 14, 74, SMOKE, 0.12)
    }
  }
  const xs = [36, 70, 104, 138, 172]
  xs.forEach((x, i) => tree(x, i === xs.length - 1)) // the rightmost is ablaze
  return p.g
}

/** a lava lamp: molten blobs suspended in a tall glass tube on a metal base. */
function buildLavaLamp(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  p.rect(cx - 22, 138, cx + 22, 146, METAL) // base
  p.rect(cx - 20, 22, cx + 20, 26, METAL) // cap
  // glass tube.
  p.rect(cx - 18, 24, cx - 16, 138, GLASS)
  p.rect(cx + 16, 24, cx + 18, 138, GLASS)
  p.rect(cx - 18, 136, cx + 18, 138, GLASS)
  // suspended blobs of lava.
  p.disc(cx, 46, 8, LAVA)
  p.disc(cx - 6, 74, 6, LAVA)
  p.disc(cx + 7, 98, 7, LAVA)
  p.disc(cx - 3, 124, 7, LAVA)
  return p.g
}

/** a sieve of staggered shelves; a reservoir of sand cascades down through it. */
function buildSandMaze(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  // a funnel box: side walls + floor, open at the top.
  p.rect(28, 14, 30, H - 4, WALL)
  p.rect(W - 30, 14, W - 28, H - 4, WALL)
  p.rect(28, H - 6, W - 28, H - 4, WALL)
  // a hopper of sand up top, waiting to be released.
  p.rect(72, 16, 128, 46, SAND)
  // angled ramps, not flat shelves: sand slides down each and tips off the low
  // end into the next, zigzagging its way to the floor (flat shelves just let it
  // settle into static layers).
  p.line(31, 58, 144, 92, WALL, 1) // tips off the right
  p.line(W - 31, 104, 56, 138, WALL, 1) // tips off the left
  return p.g
}

// ---------------------------------------------------------------------------
// PAINTINGS — still pixel art, meant to look good frozen on the black board.
// ---------------------------------------------------------------------------

const HEART = [
  '.XXX...XXX.',
  'XXXXX.XXXXX',
  'XXXXXXXXXXX',
  'XXXXXXXXXXX',
  'XXXXXXXXXXX',
  '.XXXXXXXXX.',
  '..XXXXXXX..',
  '...XXXXX...',
  '....XXX....',
  '.....X.....',
]

/** a molten heart that glows in the dark (and slumps into a puddle on play). */
function buildHeart(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const scale = 8
  const w = HEART[0].length * scale
  const h = HEART.length * scale
  p.sprite((W - w) >> 1, ((H - h) >> 1) - 6, HEART, { X: LAVA }, scale)
  return p.g
}

/** a broad oak: a gnarled trunk under a lush, layered canopy. */
function buildOak(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W >> 1
  p.rect(0, 138, W - 1, 142, PLANT) // grass
  p.floor(143, SAND)
  // trunk, wider at the roots.
  p.rect(cx - 8, 96, cx + 8, 140, WOOD)
  p.rect(cx - 5, 68, cx + 5, 96, WOOD)
  p.line(cx, 138, cx - 16, 142, WOOD, 1) // roots
  p.line(cx, 138, cx + 16, 142, WOOD, 1)
  // branches reaching into the canopy.
  p.line(cx, 80, cx - 24, 58, WOOD, 1)
  p.line(cx, 74, cx + 26, 60, WOOD, 1)
  p.line(cx, 66, cx, 48, WOOD, 1)
  // canopy: overlapping discs for a billowy crown.
  for (const [dx, dy, r] of [
    [0, -2, 30],
    [-24, 8, 20],
    [26, 6, 21],
    [-4, -22, 22],
    [-40, 2, 13],
    [38, -2, 14],
  ])
    p.disc(cx + dx, 44 + dy, r, PLANT)
  return p.g
}

/** an aquarium: a glass tank with sand, seaweed, a chest and two drifting fish. */
function buildAquarium(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.frame(28, 28, W - 28, 142, GLASS, 3)
  p.rect(31, 28, W - 31, 30, 0) // open the top edge
  p.rect(31, 45, W - 31, 139, WATER)
  p.rect(31, 128, W - 31, 139, SAND) // sand bed
  // pebbles + a sunken metal chest.
  p.disc(60, 130, 5, STONE)
  p.disc(150, 131, 6, STONE)
  p.rect(92, 118, 116, 130, METAL)
  p.rect(92, 116, 116, 118, WOOD)
  // seaweed, gently waving.
  for (const base of [50, 100, 145]) {
    let x = base
    for (let y = 128; y > 70; y -= 2) {
      p.rect(x - 1, y, x + 1, y, PLANT)
      x += (y >> 2) % 2 === 0 ? 1 : -1 // a slow zigzag
    }
  }
  // two little fish drifting mid-water.
  const fish = ['.XXX', 'XXXXX', '.XXX']
  p.sprite(66, 78, fish, { X: WOOD }, 2)
  p.sprite(132, 96, fish, { X: STONE }, 2)
  return p.g
}

/** a layered mountain vista: snow peaks, a pine treeline, a still lake. */
function buildMountains(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  // two stone peaks with snow caps.
  p.cone(60, 24, 116, 58, STONE)
  p.cone(146, 40, 116, 50, STONE)
  p.cone(60, 24, 44, 16, ICE)
  p.cone(146, 40, 56, 14, ICE)
  // a pine treeline across the midground.
  for (let x = 12; x < W - 8; x += 18) {
    const baseY = 116
    p.rect(x - 1, baseY - 4, x + 1, baseY, WOOD)
    p.cone(x, baseY - 22, baseY - 4, 8, PLANT)
  }
  // the lake and its shore.
  p.rect(0, 122, W - 1, 142, WATER)
  p.floor(143, SAND)
  p.rect(0, 120, 14, 142, STONE) // bank
  p.rect(W - 14, 120, W - 1, 142, STONE)
  return p.g
}

/** an ice cave: glittering stalactites and stalagmites around a frozen pool. */
function buildIceCave(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.rect(0, 0, W - 1, 18, STONE) // ceiling
  p.floor(132, STONE) // floor
  p.rect(0, 0, 12, H - 1, STONE) // walls
  p.rect(W - 12, 0, W - 1, H - 1, STONE)
  // stalactites hanging, stalagmites rising.
  for (const [x, len] of [
    [40, 26],
    [78, 18],
    [120, 30],
    [160, 20],
  ])
    p.cone(x, 18 + len, 18, 6, ICE) // (apex below, base at ceiling) -> spike down
  for (const [x, len] of [
    [56, 22],
    [104, 16],
    [150, 24],
  ]) {
    // a spike rising from the floor: cone with apex up.
    for (let y = 132; y > 132 - len; y--) {
      const hw = Math.round((6 * (132 - y)) / len)
      p.rect(x - (6 - hw), y, x + (6 - hw), y, ICE)
    }
  }
  // a frozen pool set into the floor, rimmed with ice.
  p.rect(70, 124, 130, 131, STONE)
  p.rect(72, 126, 128, 131, WATER)
  p.rect(72, 124, 128, 125, ICE)
  p.speckle(13, 19, W - 13, 130, ICE, 0.004) // drifting glints
  return p.g
}

const PL = ['PPPP..L...', 'P..P..L...', 'PPPP..L...', 'P.....L...', 'P.....LLLL']

/** the Powder Lab monogram in brushed metal over a molten underline. */
function buildMonogram(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const scale = 9
  const w = PL[0].length * scale
  const h = PL.length * scale
  const ox = (W - w) >> 1
  const oy = ((H - h) >> 1) - 8
  p.sprite(ox, oy, PL, { P: METAL, L: METAL }, scale)
  // a glowing lava bar beneath the letters.
  p.rect(ox, oy + h + 8, ox + w - 1, oy + h + 12, LAVA)
  return p.g
}

/** a grove of toadstools — green-capped, spotted, sprouting from the grass. */
function buildMushrooms(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.rect(0, 138, W - 1, 142, PLANT)
  p.floor(143, SAND)
  const shroom = (x: number, capR: number, stemTop: number) => {
    p.rect(x - 3, stemTop, x + 3, 140, WOOD) // stem
    p.dome(x, stemTop, capR, PLANT) // cap
    p.rect(x - capR, stemTop, x + capR, stemTop + 1, PLANT) // squared cap brim
    // a few pale spots on the cap.
    p.set(x - Math.floor(capR / 2), stemTop - Math.floor(capR / 2), GLASS)
    p.set(x + Math.floor(capR / 2), stemTop - Math.floor(capR / 3), GLASS)
    p.set(x, stemTop - capR + 2, GLASS)
  }
  shroom(W >> 1, 24, 110)
  shroom((W >> 1) - 44, 15, 122)
  shroom((W >> 1) + 42, 18, 118)
  return p.g
}

// Thermal contraptions use relative coordinates to fit different board sizes.
function buildPressureCooker(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const x0 = (W * 0.3) | 0,
    x1 = (W * 0.7) | 0
  const top = (H * 0.3) | 0,
    bottom = (H * 0.78) | 0
  p.frame(x0, top, x1, bottom, Mat.GLASS)
  p.rect(x0 + 1, bottom - 15, x1 - 1, bottom - 3, Mat.WATER)
  p.rect(x0 + 1, bottom - 2, x1 - 1, bottom - 1, Mat.METAL)
  p.rect(x0, bottom + 1, x1, bottom + 3, Mat.HEATER)
  // Short conducting feet carry heat around the glass floor into the plate.
  p.rect(x0 + 4, bottom, x0 + 8, bottom, Mat.METAL)
  p.rect(x1 - 8, bottom, x1 - 4, bottom, Mat.METAL)
  p.rect(0, H - 3, W - 1, H - 1, Mat.WALL)
  return p.g
}

function buildHotCold(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const top = (H * 0.4) | 0,
    bottom = (H * 0.8) | 0
  for (const [left, right, source] of [
    [0.1, 0.43, Mat.HEATER],
    [0.57, 0.9, Mat.COOLER],
  ]) {
    const x0 = (W * left) | 0,
      x1 = (W * right) | 0
    p.frame(x0, top, x1, bottom, Mat.WALL)
    p.rect(x0 + 1, top, x1 - 1, top, Mat.EMPTY)
    p.rect(x0 + 1, bottom - 18, x1 - 1, bottom - 3, Mat.WATER)
    p.rect(x0 + 1, bottom - 2, x1 - 1, bottom - 1, Mat.METAL)
    p.rect(x0 + 1, bottom, x1 - 1, bottom, source)
  }
  return p.g
}

function buildGlassworks(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const x0 = (W * 0.25) | 0,
    x1 = (W * 0.75) | 0,
    bottom = (H * 0.85) | 0
  p.frame(x0, (H * 0.38) | 0, x1, bottom, Mat.WALL)
  p.rect(x0 + 1, (H * 0.38) | 0, x1 - 1, (H * 0.38) | 0, Mat.EMPTY)
  p.rect(x0 + 1, bottom - 15, x1 - 1, bottom - 1, Mat.SAND)
  p.rect(x0 + 1, bottom - 36, x1 - 1, bottom - 17, Mat.LAVA)
  return p.g
}

// ---------------------------------------------------------------------------
// the catalogue.
// ---------------------------------------------------------------------------

export const PRESETS: Preset[] = [
  {
    id: 'pressure-cooker',
    name: 'Pressure Cooker',
    tag: 'BURST',
    blurb: 'a glass boiler pops; erase its lid to vent the steam',
    group: 'contraption',
    light: FLAT,
    build: buildPressureCooker,
  },
  {
    id: 'hot-cold',
    name: 'Hot & Cold',
    tag: 'PHASE',
    blurb: 'one bath boils while the other freezes; try heat view',
    group: 'contraption',
    light: FLAT,
    build: buildHotCold,
  },
  {
    id: 'glassworks',
    name: 'Glassworks',
    tag: 'FUSE',
    blurb: 'molten lava fuses a sand bed into pale glass',
    group: 'contraption',
    light: DRAMA,
    build: buildGlassworks,
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    tag: 'POUR',
    blurb: 'sand sifts grain by grain through the neck',
    group: 'contraption',
    light: FLAT,
    build: buildHourglass,
  },
  {
    id: 'volcano',
    name: 'Volcano',
    tag: 'ERUPT',
    blurb: 'a molten core that spills down the slope',
    group: 'contraption',
    light: DRAMA,
    build: buildVolcano,
  },
  {
    id: 'waterfall',
    name: 'Waterfall',
    tag: 'FLOW',
    blurb: 'water tips off a mossy cliff into the pool',
    group: 'contraption',
    light: FLAT,
    build: buildWaterfall,
  },
  {
    id: 'campfire',
    name: 'Campfire',
    tag: 'BURN',
    blurb: 'crossed logs catch and smoke curls upward',
    group: 'contraption',
    light: NIGHT,
    build: buildCampfire,
  },
  {
    id: 'powder-keg',
    name: 'Powder Keg',
    tag: 'BOOM',
    blurb: 'a lit fuse races down to the barrels',
    group: 'contraption',
    light: DRAMA,
    build: buildPowderKeg,
  },
  {
    id: 'acid-tank',
    name: 'Acid Tank',
    tag: 'MELT',
    blurb: 'an idol slowly dissolves in the vat',
    group: 'contraption',
    light: FLAT,
    build: buildAcidTank,
  },
  {
    id: 'forest-fire',
    name: 'Forest Fire',
    tag: 'SPREAD',
    blurb: 'flame leaps from crown to crown',
    group: 'contraption',
    light: FLAT,
    build: buildForestFire,
  },
  {
    id: 'lava-lamp',
    name: 'Lava Lamp',
    tag: 'DRIP',
    blurb: 'molten blobs glow and slide down the glass',
    group: 'contraption',
    light: DRAMA,
    build: buildLavaLamp,
  },
  {
    id: 'sand-sieve',
    name: 'Sand Sieve',
    tag: 'CASCADE',
    blurb: 'a reservoir zigzags down a stack of shelves',
    group: 'contraption',
    light: FLAT,
    build: buildSandMaze,
  },
  {
    id: 'heart',
    name: 'Molten Heart',
    tag: 'GLOW',
    blurb: 'glows in the dark — and melts when you press play',
    group: 'painting',
    light: NIGHT,
    build: buildHeart,
  },
  {
    id: 'oak',
    name: 'Old Oak',
    tag: 'CALM',
    blurb: 'a broad tree with a billowing crown',
    group: 'painting',
    light: FLAT,
    build: buildOak,
  },
  {
    id: 'aquarium',
    name: 'Aquarium',
    tag: 'CALM',
    blurb: 'seaweed, a sunken chest, two drifting fish',
    group: 'painting',
    light: FLAT,
    build: buildAquarium,
  },
  {
    id: 'mountains',
    name: 'Mountains',
    tag: 'VISTA',
    blurb: 'snow peaks above a pine line and a still lake',
    group: 'painting',
    light: FLAT,
    build: buildMountains,
  },
  {
    id: 'ice-cave',
    name: 'Ice Cave',
    tag: 'FROST',
    blurb: 'stalactites glitter over a frozen pool',
    group: 'painting',
    light: FLAT,
    build: buildIceCave,
  },
  {
    id: 'monogram',
    name: 'Powder Lab',
    tag: 'BRAND',
    blurb: 'the monogram in metal over molten light',
    group: 'painting',
    light: DRAMA,
    build: buildMonogram,
  },
  {
    id: 'mushrooms',
    name: 'Toadstools',
    tag: 'WHIMSY',
    blurb: 'a little grove of spotted caps',
    group: 'painting',
    light: FLAT,
    build: buildMushrooms,
  },
]
