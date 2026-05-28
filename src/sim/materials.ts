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
} as const

export type MatId = number
export const MAT_COUNT = 15

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
density[Mat.FIRE] = 1
density[Mat.SMOKE] = 1
density[Mat.STEAM] = 1

// A "movable" cell can be displaced by density swaps (liquids + gases + fire).
// Powders are intentionally NOT movable-by-others, so water rests on sand etc.
const movable = new Uint8Array(MAT_COUNT)
for (const m of [Mat.WATER, Mat.OIL, Mat.ACID, Mat.LAVA, Mat.SMOKE, Mat.STEAM, Mat.FIRE]) movable[m] = 1
export function isMovable(m: number): boolean {
  return movable[m] === 1
}

// Acid eats these; everything else (wall, liquids, gases) it ignores.
const dissolvable = new Uint8Array(MAT_COUNT)
for (const m of [Mat.SAND, Mat.STONE, Mat.WOOD, Mat.PLANT, Mat.ICE, Mat.GUNPOWDER]) dissolvable[m] = 1
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

  { id: Mat.SAND, name: 'Sand', rgb: [196, 180, 120], cat: 'Powders', key: '1' },
  { id: Mat.GUNPOWDER, name: 'Gunpowder', rgb: [70, 68, 78], cat: 'Powders', key: '2' },

  { id: Mat.WATER, name: 'Water', rgb: [54, 108, 200], cat: 'Liquids', key: '3' },
  { id: Mat.OIL, name: 'Oil', rgb: [78, 66, 44], cat: 'Liquids', key: '4' },
  { id: Mat.ACID, name: 'Acid', rgb: [120, 214, 70], cat: 'Liquids', key: '5' },
  { id: Mat.LAVA, name: 'Lava', rgb: [255, 110, 30], cat: 'Liquids', key: '6' },

  { id: Mat.STONE, name: 'Stone', rgb: [98, 98, 106], cat: 'Solids', key: '7' },
  { id: Mat.WOOD, name: 'Wood', rgb: [112, 74, 42], cat: 'Solids', key: '8' },
  { id: Mat.PLANT, name: 'Plant', rgb: [46, 160, 60], cat: 'Solids', key: '9' },
  { id: Mat.ICE, name: 'Ice', rgb: [170, 210, 235], cat: 'Solids', key: '0' },

  { id: Mat.FIRE, name: 'Fire', rgb: [255, 150, 40], cat: 'Energy', key: 'F' },
  { id: Mat.SMOKE, name: 'Smoke', rgb: [90, 90, 96], cat: 'Energy', key: 'S' },
  { id: Mat.STEAM, name: 'Steam', rgb: [205, 210, 220], cat: 'Energy', key: 'T' },
]

export const CATEGORIES: MatMeta['cat'][] = ['Tools', 'Powders', 'Liquids', 'Solids', 'Energy']
