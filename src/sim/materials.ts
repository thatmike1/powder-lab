// Material IDs. Kept as a plain numeric map (not a TS enum) so we can use the
// raw numbers in the hot loop with zero overhead and no enum runtime object.
export const Mat = {
  EMPTY: 0,
  WALL: 1,
  SAND: 2,
  WATER: 3,
  STONE: 4,
  WOOD: 5,
  FIRE: 6,
  SMOKE: 7,
  STEAM: 8,
  OIL: 9,
  LAVA: 10,
  ACID: 11,
  PLANT: 12,
  GUNPOWDER: 13,
  ICE: 14,
  LIGHTNING: 15,
  METAL: 16,
  FILINGS: 17,
  // MAGNET is a pure tool, not a material: it never occupies a cell, it just
  // names a brush mode (like Eraser reuses EMPTY). Kept inside MAT_COUNT so the
  // property tables stay densely indexed, but it's intercepted before any paint.
  MAGNET: 18,
  GLASS: 19, // formed when sand melts under sustained lava heat
} as const

export type MatId = number
export const MAT_COUNT = 20

// Density drives displacement: a denser mover sinks through / swaps with a
// lighter *movable* cell. Static solids (wall, stone, wood, plant, ice) are
// immovable and never participate in density swaps.
export const density = new Float32Array(MAT_COUNT)
density[Mat.SAND] = 60
density[Mat.WATER] = 30
density[Mat.OIL] = 22
density[Mat.ACID] = 36
density[Mat.LAVA] = 90
density[Mat.GUNPOWDER] = 58
density[Mat.FILINGS] = 70 // iron — heavier than sand, sinks through water
density[Mat.FIRE] = 1
density[Mat.SMOKE] = 1
density[Mat.STEAM] = 1

// Per-material thermal conductivity (0 = perfect insulator, 1 = conducts like
// air). Drives the harmonic-mean face flow in Simulation.diffuse(): heat through
// the boundary between two cells is throttled by the *less* conductive one, so a
// cond-0 WALL is thermally inert with no special-case. Defaults to 1; only
// insulators and conductors deviate. GUNPOWDER must be listed — omitting it would
// default to 1.0 and let a powder pile conduct a flame freely into a chain
// detonation at its low ignition point. METAL/FILINGS conduct hard (a metal bar
// bridges a flame to its far side); stone/wood/glass insulate.
export const CONDUCT = new Float32Array(MAT_COUNT).fill(1)
CONDUCT[Mat.WALL] = 0
CONDUCT[Mat.STONE] = 0.12
CONDUCT[Mat.WOOD] = 0.15
CONDUCT[Mat.PLANT] = 0.15
CONDUCT[Mat.GLASS] = 0.2
CONDUCT[Mat.ICE] = 0.6
CONDUCT[Mat.SAND] = 0.4
CONDUCT[Mat.GUNPOWDER] = 0.4
CONDUCT[Mat.FIRE] = 0.5
CONDUCT[Mat.LAVA] = 0.6
CONDUCT[Mat.WATER] = 0.6
CONDUCT[Mat.OIL] = 0.6
CONDUCT[Mat.ACID] = 0.6
CONDUCT[Mat.METAL] = 0.9
CONDUCT[Mat.FILINGS] = 0.9
// EMPTY / SMOKE / STEAM / LIGHTNING keep the 1.0 default.

// Thermal tables in accelerated sandbox degrees. Water uses familiar 0/100
// boundaries; the sand fusion gate is scaled for visible glass-making in lava.
// Only fire, lava and lightning continuously emit. Ice and steam are seeded at
// spawn temperature and then exchange a finite amount of heat.
export const emitTemp = new Float32Array(MAT_COUNT)
emitTemp[Mat.FIRE] = 1500
emitTemp[Mat.LAVA] = 1100
emitTemp[Mat.ICE] = -40
emitTemp[Mat.STEAM] = 120
emitTemp[Mat.SMOKE] = 80
emitTemp[Mat.LIGHTNING] = 1800

export const ignitionPoint = new Float32Array(MAT_COUNT)
ignitionPoint[Mat.GUNPOWDER] = 120
ignitionPoint[Mat.OIL] = 150
ignitionPoint[Mat.PLANT] = 170
ignitionPoint[Mat.WOOD] = 220

export const meltPoint = new Float32Array(MAT_COUNT)
meltPoint[Mat.ICE] = 0
meltPoint[Mat.SAND] = 300
export const boilPoint = new Float32Array(MAT_COUNT)
boilPoint[Mat.WATER] = 100
export const freezePoint = new Float32Array(MAT_COUNT)
freezePoint[Mat.WATER] = -2 // small hysteresis avoids freeze/melt flicker
freezePoint[Mat.STEAM] = 90 // condense in cool air; pressure shifts this later

// Fuel ticks: finite, independent of the cosmetic fire lifespan.
export const FUEL = new Uint16Array(MAT_COUNT)
FUEL[Mat.WOOD] = 240
FUEL[Mat.OIL] = 180
FUEL[Mat.PLANT] = 90
FUEL[Mat.GUNPOWDER] = 32
FUEL[Mat.FIRE] = 100

// A "movable" cell can be displaced by density swaps (liquids + gases + fire).
// Powders are intentionally NOT movable-by-others, so water rests on sand etc.
const movable = new Uint8Array(MAT_COUNT)
for (const m of [Mat.WATER, Mat.OIL, Mat.ACID, Mat.LAVA, Mat.SMOKE, Mat.STEAM, Mat.FIRE])
  movable[m] = 1
export function isMovable(m: number): boolean {
  return movable[m] === 1
}

// Acid eats these; everything else (wall, liquids, gases) it ignores.
const dissolvable = new Uint8Array(MAT_COUNT)
for (const m of [
  Mat.SAND,
  Mat.STONE,
  Mat.WOOD,
  Mat.PLANT,
  Mat.ICE,
  Mat.GUNPOWDER,
  Mat.METAL,
  Mat.FILINGS,
  Mat.GLASS,
])
  dissolvable[m] = 1
export function isDissolvable(m: number): boolean {
  return dissolvable[m] === 1
}

// ---- UI palette metadata -------------------------------------------------
export interface MatMeta {
  id: number
  name: string
  rgb: [number, number, number] // swatch color
  cat: 'Tools' | 'Powders' | 'Liquids' | 'Solids' | 'Energy'
  key?: string // keyboard shortcut
}

export const PALETTE: MatMeta[] = [
  { id: Mat.EMPTY, name: 'Eraser', rgb: [30, 33, 38], cat: 'Tools', key: 'E' },
  { id: Mat.WALL, name: 'Wall', rgb: [120, 122, 130], cat: 'Tools', key: 'W' },
  { id: Mat.MAGNET, name: 'Magnet', rgb: [196, 72, 84], cat: 'Tools', key: 'N' },

  { id: Mat.SAND, name: 'Sand', rgb: [196, 180, 120], cat: 'Powders', key: '1' },
  { id: Mat.GUNPOWDER, name: 'Gunpowder', rgb: [70, 68, 78], cat: 'Powders', key: '2' },
  { id: Mat.FILINGS, name: 'Filings', rgb: [120, 122, 132], cat: 'Powders', key: 'I' },

  { id: Mat.WATER, name: 'Water', rgb: [54, 108, 200], cat: 'Liquids', key: '3' },
  { id: Mat.OIL, name: 'Oil', rgb: [78, 66, 44], cat: 'Liquids', key: '4' },
  { id: Mat.ACID, name: 'Acid', rgb: [120, 214, 70], cat: 'Liquids', key: '5' },
  { id: Mat.LAVA, name: 'Lava', rgb: [255, 110, 30], cat: 'Liquids', key: '6' },

  { id: Mat.STONE, name: 'Stone', rgb: [98, 98, 106], cat: 'Solids', key: '7' },
  { id: Mat.METAL, name: 'Metal', rgb: [158, 160, 172], cat: 'Solids', key: 'M' },
  { id: Mat.WOOD, name: 'Wood', rgb: [112, 74, 42], cat: 'Solids', key: '8' },
  { id: Mat.PLANT, name: 'Plant', rgb: [46, 160, 60], cat: 'Solids', key: '9' },
  { id: Mat.ICE, name: 'Ice', rgb: [170, 210, 235], cat: 'Solids', key: '0' },
  { id: Mat.GLASS, name: 'Glass', rgb: [200, 225, 235], cat: 'Solids', key: 'A' },

  { id: Mat.FIRE, name: 'Fire', rgb: [255, 150, 40], cat: 'Energy', key: 'F' },
  { id: Mat.LIGHTNING, name: 'Lightning', rgb: [190, 205, 255], cat: 'Energy', key: 'Z' },
  { id: Mat.SMOKE, name: 'Smoke', rgb: [90, 90, 96], cat: 'Energy', key: 'S' },
  { id: Mat.STEAM, name: 'Steam', rgb: [205, 210, 220], cat: 'Energy', key: 'T' },
]

export const CATEGORIES: MatMeta['cat'][] = ['Tools', 'Powders', 'Liquids', 'Solids', 'Energy']
