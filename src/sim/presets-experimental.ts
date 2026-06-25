// the gallery's EXPERIMENTAL shelf: wilder, more chaotic scenes — steam blasts,
// chain detonations, dissolving structures, generative pixel art that avalanches
// or marbles when you press play. authored as a batch and curated for ones that
// actually do something spectacular; a little jank is on-brand here.
//
// these reuse the same drawing toolkit as the core scene pack (see presets.ts).

import { Mat } from './materials'
import { DRAMA, FLAT, NIGHT, Painter, type Preset } from './presets'

// ---------------------------------------------------------------------------
// reactive chaos — erupts, ignites, dissolves.
// ---------------------------------------------------------------------------

/** molten slugs suspended in a sealed water tank — they plunge and steam-blast. */
function buildSteamBomb(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(133, Mat.STONE)
  p.speckle(0, 134, W - 1, H - 1, Mat.SAND, 0.18)
  // a sealed glass tank, brimful of water.
  p.frame(55, 28, 145, 132, Mat.GLASS, 3)
  p.rect(59, 32, 141, 129, Mat.WATER)
  // lava (density 90) plunges through water (30) the moment you unpause, boiling
  // a column of water into a violent steam blast on the way down.
  p.disc(100, 50, 13, Mat.LAVA)
  p.disc(78, 60, 8, Mat.LAVA)
  p.disc(122, 58, 8, Mat.LAVA)
  p.speckle(64, 40, 136, 48, Mat.LAVA, 0.05)
  return p.g
}

/** a bench of gunpowder kegs on one fat master fuse — light it, lose all of it. */
function buildBombFactory(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(127, Mat.STONE)
  p.speckle(0, 130, W - 1, H - 1, Mat.GUNPOWDER, 0.05)
  // a fat 5px master fuse running the length of the bench.
  p.rect(20, 122, 185, 126, Mat.GUNPOWDER)
  // four open-bottomed wood kegs packed with powder, standing on the fuse.
  for (const cx of [40, 82, 126, 168]) {
    const top = 96
    const bottom = 121
    p.rect(cx - 11, top, cx - 10, bottom, Mat.WOOD)
    p.rect(cx + 10, top, cx + 11, bottom, Mat.WOOD)
    p.rect(cx - 11, top, cx + 11, top + 1, Mat.WOOD)
    p.rect(cx - 9, top + 2, cx + 9, bottom, Mat.GUNPOWDER)
    p.rect(cx - 1, top - 4, cx + 1, top, Mat.GUNPOWDER) // a menacing riser
  }
  // the lit end.
  p.rect(15, 120, 19, 126, Mat.WOOD)
  p.disc(22, 124, 2, Mat.FIRE)
  return p.g
}

/** an acid downpour eating a little stone-and-wood house at its own uneven pace. */
function buildAcidRain(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(138, Mat.STONE)
  // a tower-house of mixed materials — acid eats each at a different rate.
  p.frame(68, 78, 132, 137, Mat.STONE, 3)
  p.rect(71, 106, 129, 108, Mat.WOOD)
  p.rect(71, 122, 129, 124, Mat.WOOD)
  p.rect(95, 124, 105, 134, Mat.WOOD)
  p.rect(78, 88, 87, 100, Mat.GLASS)
  p.rect(113, 88, 122, 100, Mat.GLASS)
  p.rect(68, 74, 132, 77, Mat.PLANT)
  p.speckle(70, 70, 130, 73, Mat.PLANT, 0.5)
  // the downpour: a high cloud plus a closer band so the first drops bite fast.
  p.speckle(40, 10, 160, 26, Mat.ACID, 0.45)
  p.speckle(52, 52, 148, 66, Mat.ACID, 0.4)
  return p.g
}

/** two oil tanks linked by a pipe; a spark walks the slick from one to the other. */
function buildRefineryFire(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(133, Mat.STONE)
  // tank A.
  p.rect(30, 66, 31, 132, Mat.METAL)
  p.rect(69, 66, 70, 132, Mat.METAL)
  p.rect(30, 131, 70, 132, Mat.METAL)
  p.rect(32, 69, 68, 130, Mat.OIL)
  // tank B (taller).
  p.rect(130, 56, 131, 132, Mat.METAL)
  p.rect(169, 56, 170, 132, Mat.METAL)
  p.rect(130, 131, 170, 132, Mat.METAL)
  p.rect(132, 59, 168, 130, Mat.OIL)
  // an oil-filled cross-pipe between them.
  p.rect(70, 100, 130, 100, Mat.METAL)
  p.rect(70, 106, 130, 106, Mat.METAL)
  p.rect(70, 101, 130, 105, Mat.OIL)
  // a leaked slick across the deck — fire walks it tank to tank.
  p.rect(72, 129, 128, 131, Mat.OIL)
  p.speckle(20, 128, 180, 131, Mat.OIL, 0.2)
  // ignition sparks on both oil surfaces + a hanging haze.
  p.disc(50, 70, 2, Mat.FIRE)
  p.disc(150, 60, 2, Mat.FIRE)
  p.speckle(20, 6, 180, 36, Mat.SMOKE, 0.04)
  return p.g
}

// ---------------------------------------------------------------------------
// machines & contraptions.
// ---------------------------------------------------------------------------

/** a hopper rains powder through a staggered peg field into sorting bins. */
function buildPlinko(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.rect(20, 10, 22, 145, Mat.WALL)
  p.rect(178, 10, 180, 145, Mat.WALL)
  p.rect(20, 145, 180, 147, Mat.WALL)
  // a funnel necking down to a central drop slot.
  p.line(22, 12, 94, 40, Mat.WALL, 1)
  p.line(178, 12, 106, 40, Mat.WALL, 1)
  // the charge: sand with a vein of heavier filings.
  p.rect(30, 12, 170, 36, Mat.SAND)
  p.rect(78, 12, 122, 24, Mat.FILINGS)
  // staggered peg field.
  for (let row = 0; row < 6; row++) {
    const py = 54 + row * 12
    const off = (row % 2) * 7
    for (let px = 34 + off; px <= 166; px += 14) p.disc(px, py, 1, Mat.METAL)
  }
  // collection bins.
  for (let bx = 44; bx < 176; bx += 24) p.rect(bx, 126, bx + 1, 145, Mat.WALL)
  return p.g
}

/** a high tank spouts water down a zigzag cascade past a mill wheel into a basin. */
function buildCascade(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.rect(8, 140, 192, 143, Mat.STONE)
  p.rect(8, 100, 10, 143, Mat.STONE)
  p.rect(190, 100, 192, 143, Mat.STONE)
  // elevated reservoir with a spout gap on its lower-right.
  p.rect(16, 14, 18, 48, Mat.STONE)
  p.rect(16, 46, 60, 48, Mat.STONE)
  p.rect(58, 14, 60, 39, Mat.STONE)
  p.rect(19, 16, 57, 45, Mat.WATER)
  // staggered ramps tipping the stream down.
  p.line(60, 50, 120, 72, Mat.STONE, 1)
  p.line(170, 86, 70, 108, Mat.STONE, 1)
  p.line(50, 120, 152, 136, Mat.STONE, 1)
  // a wooden mill wheel in the cascade's path.
  const wx = 150
  const wy = 92
  const r = 13
  p.line(wx - r, wy, wx + r, wy, Mat.WOOD, 0)
  p.line(wx, wy - r, wx, wy + r, Mat.WOOD, 0)
  p.line(wx - 9, wy - 9, wx + 9, wy + 9, Mat.WOOD, 0)
  p.line(wx - 9, wy + 9, wx + 9, wy - 9, Mat.WOOD, 0)
  p.disc(wx, wy, 2, Mat.WOOD)
  return p.g
}

/** a stone boiler: lava heats a water column and jets steam up a narrow vent. */
function buildGeyser(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.floor(140, Mat.STONE)
  p.cone(100, 28, 140, 60, Mat.STONE)
  // carve the vent chute.
  p.rect(96, 28, 104, 123, Mat.EMPTY)
  // a molten chamber at the base feeds the chute above.
  p.rect(82, 125, 118, 138, Mat.LAVA)
  p.rect(96, 70, 104, 124, Mat.WATER)
  // a side reservoir keeping it fed.
  p.rect(60, 44, 62, 70, Mat.STONE)
  p.rect(62, 68, 96, 70, Mat.STONE)
  p.rect(63, 46, 95, 67, Mat.WATER)
  // a head of steam for an instant first eruption.
  p.speckle(96, 30, 104, 68, Mat.STEAM, 0.3)
  return p.g
}

/** a hopper feeds gunpowder down ramps into a lava furnace wired to a buried fuse. */
function buildConveyor(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  p.rect(8, 144, 192, 146, Mat.STONE)
  p.rect(6, 16, 8, 146, Mat.STONE)
  p.rect(192, 16, 194, 146, Mat.STONE)
  p.rect(20, 16, 52, 28, Mat.GUNPOWDER)
  // zigzag conveyor ramps.
  p.line(16, 32, 122, 52, Mat.STONE, 1)
  p.line(184, 66, 58, 86, Mat.STONE, 1)
  p.line(40, 100, 152, 120, Mat.STONE, 1)
  // the furnace: a lava pit.
  p.rect(150, 118, 152, 143, Mat.STONE)
  p.rect(152, 124, 190, 142, Mat.LAVA)
  // a thick buried fuse back to a powder cache.
  p.line(152, 140, 42, 140, Mat.GUNPOWDER, 2)
  p.rect(18, 128, 42, 142, Mat.GUNPOWDER)
  return p.g
}

// ---------------------------------------------------------------------------
// trippy / abstract — gorgeous frozen, satisfying in motion.
// ---------------------------------------------------------------------------

/** a three-armed lava spiral on black; blooms under glow, slumps into a pool. */
function buildLavaSpiral(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W / 2
  const cy = H / 2
  const R = 72
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      if (r > R) continue
      const a = Math.atan2(dy, dx)
      const v = Math.sin(3 * a + r * 0.3)
      if (v > 0.42) p.set(x, y, Mat.LAVA)
      else if (v > 0.2) p.set(x, y, Mat.STONE)
    }
  }
  p.disc(Math.round(cx), Math.round(cy), 8, Mat.LAVA)
  p.speckle(
    Math.round(cx - R),
    Math.round(cy - R),
    Math.round(cx + R),
    Math.round(cy + R),
    Mat.FIRE,
    0.012,
  )
  return p.g
}

/** a tidy diagonal mosaic of powders behind glass pipes — it avalanches on play. */
function buildMosaicCollapse(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  // ONLY falling powders — no static tiles wedged in, or the grid never moves.
  // the three densities (filings 70 > sand 60 > gunpowder 58) also sort a little
  // as the columns slump.
  const mats = [Mat.SAND, Mat.GUNPOWDER, Mat.FILINGS]
  const tile = 8
  // a SPARSE checkerboard — powder tiles with empty tiles between them. a packed
  // grid just translates straight down; the gaps are what let each block tumble
  // and the whole thing collapse into grainy dunes.
  let n = 0
  for (let ty = 0; ty * tile < H - 12; ty++) {
    for (let tx = 0; tx * tile < W; tx++) {
      if ((tx + ty) % 2 !== 0) continue // leave the alternating tiles empty
      const m = mats[n++ % mats.length]
      const x0 = tx * tile
      const y0 = ty * tile
      p.rect(x0, y0, x0 + tile - 1, y0 + tile - 1, m)
    }
  }
  // a few glass dividers split it into bins so it settles as a run of dunes.
  for (let gx = 40; gx < W - 4; gx += 44) p.rect(gx, 0, gx + 1, H - 1, Mat.GLASS)
  p.rect(0, 0, 2, H - 1, Mat.WALL)
  p.rect(W - 3, 0, W - 1, H - 1, Mat.WALL)
  p.floor(H - 3, Mat.WALL)
  return p.g
}

/** wavy liquid bands stacked heavy-on-light so they invert and marble together. */
function buildMarbleBands(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const x0 = 10
  const x1 = W - 11
  const top = 8
  const bot = H - 6
  const bands = [Mat.ACID, Mat.WATER, Mat.OIL, Mat.WATER, Mat.ACID, Mat.OIL]
  const bh = (bot - top) / bands.length
  for (let y = top; y <= bot; y++) {
    for (let x = x0; x <= x1; x++) {
      const yy = y + Math.round(3 * Math.sin(x * 0.13) + 2 * Math.sin(x * 0.31))
      const b = Math.min(bands.length - 1, Math.max(0, Math.floor((yy - top) / bh)))
      p.set(x, y, bands[b])
    }
  }
  p.speckle(x0, top, x1, Math.round(top + (bot - top) / 2), Mat.SAND, 0.02)
  // glass tank.
  p.rect(x0 - 2, top, x0 - 1, bot + 2, Mat.GLASS)
  p.rect(x1 + 1, top, x1 + 2, bot + 2, Mat.GLASS)
  p.rect(x0 - 2, bot + 1, x1 + 2, bot + 2, Mat.GLASS)
  return p.g
}

/** a pixel galaxy — twin lava arms in dark dust over a starfield, blazing core. */
function buildGalaxy(W: number, H: number): Uint8Array {
  const p = new Painter(W, H)
  const cx = W / 2
  const cy = H / 2
  const R = 88
  p.speckle(0, 0, W - 1, H - 1, Mat.ICE, 0.01)
  p.speckle(0, 0, W - 1, H - 1, Mat.GLASS, 0.005)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx
      const dy = (y - cy) * 1.25
      const r = Math.hypot(dx, dy)
      if (r > R) continue
      const a = Math.atan2(dy, dx)
      const fade = 1 - r / R
      const v = Math.sin(2 * a + r * 0.16)
      if (v > 0.78 - fade * 0.3) p.set(x, y, Mat.LAVA)
      else if (v > 0.5) p.set(x, y, Mat.GUNPOWDER)
    }
  }
  p.disc(Math.round(cx), Math.round(cy), 10, Mat.LAVA)
  p.disc(Math.round(cx), Math.round(cy), 4, Mat.FIRE)
  return p.g
}

// ---------------------------------------------------------------------------
// the experimental catalogue.
// ---------------------------------------------------------------------------

export const EXPERIMENTAL: Preset[] = [
  {
    id: 'steam-bomb',
    name: 'Steam Bomb',
    tag: 'BLAST',
    blurb: 'molten slugs plunge into a sealed tank — boom',
    group: 'experimental',
    light: DRAMA,
    build: buildSteamBomb,
  },
  {
    id: 'bomb-factory',
    name: 'Bomb Factory',
    tag: 'DETONATE',
    blurb: 'light one fuse, lose the whole bench',
    group: 'experimental',
    light: NIGHT,
    build: buildBombFactory,
  },
  {
    id: 'acid-rain',
    name: 'Acid Rain',
    tag: 'DISSOLVE',
    blurb: 'watch the little house melt into nothing',
    group: 'experimental',
    light: FLAT,
    build: buildAcidRain,
  },
  {
    id: 'refinery-fire',
    name: 'Refinery Fire',
    tag: 'INFERNO',
    blurb: 'two oil tanks, one spark, zero survivors',
    group: 'experimental',
    light: NIGHT,
    build: buildRefineryFire,
  },
  {
    id: 'plinko-sorter',
    name: 'Plinko Sorter',
    tag: 'POWDER',
    blurb: 'rain the sand, watch it pinball into the bins',
    group: 'experimental',
    light: FLAT,
    build: buildPlinko,
  },
  {
    id: 'cascade-mill',
    name: 'Cascade Mill',
    tag: 'WATER',
    blurb: 'pop the spout and the whole staircase runs wet',
    group: 'experimental',
    light: FLAT,
    build: buildCascade,
  },
  {
    id: 'steam-geyser',
    name: 'Steam Geyser',
    tag: 'BOILER',
    blurb: 'lava under water, steam out the top — stand back',
    group: 'experimental',
    light: DRAMA,
    build: buildGeyser,
  },
  {
    id: 'powder-conveyor',
    name: 'Powder Line',
    tag: 'KABOOM',
    blurb: 'gunpowder rides the ramps into the furnace',
    group: 'experimental',
    light: DRAMA,
    build: buildConveyor,
  },
  {
    id: 'lava-spiral',
    name: 'Lava Spiral',
    tag: 'GLOW',
    blurb: 'three burning arms wind into a molten core',
    group: 'experimental',
    light: DRAMA,
    build: buildLavaSpiral,
  },
  {
    id: 'mosaic-collapse',
    name: 'Mosaic Collapse',
    tag: 'AVALANCHE',
    blurb: 'a tidy tile grid that slides into dunes on play',
    group: 'experimental',
    light: FLAT,
    build: buildMosaicCollapse,
  },
  {
    id: 'marble-bands',
    name: 'Marble Bands',
    tag: 'MARBLE',
    blurb: 'wavy liquid layers churn and bleed together',
    group: 'experimental',
    light: FLAT,
    build: buildMarbleBands,
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    tag: 'COSMIC',
    blurb: 'spiral arms and a blazing core over a starfield',
    group: 'experimental',
    light: NIGHT,
    build: buildGalaxy,
  },
]
