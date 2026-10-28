import { CONDUCT, CONVECT, HEAT_CAP, MAT_COUNT } from './materials'

// Q4 degrees: Float32 can represent every value in this bounded range exactly.
// Physics uses integer gradients and fluxes; rendering reads degrees directly.
export const TEMP_SCALE = 16
export const AMBIENT = 20
export const MIN_TEMP = -160
export const MAX_TEMP = 2400

export function quantizeTemp(degrees: number): number {
  return Math.max(MIN_TEMP, Math.min(MAX_TEMP, Math.round(degrees * TEMP_SCALE) / TEMP_SCALE))
}

// Harmonic face conductance, Q10. Precomputed from integer conductivity so the
// hot loop needs no divisions by material properties and no float accumulation.
export const FACE = new Uint16Array(MAT_COUNT * MAT_COUNT)
for (let a = 0; a < MAT_COUNT; a++) {
  for (let b = 0; b < MAT_COUNT; b++) {
    const ca = Math.round(CONDUCT[a] * 1024)
    const cb = Math.round(CONDUCT[b] * 1024)
    FACE[a * MAT_COUNT + b] = ca + cb === 0 ? 0 : Math.trunc((2 * ca * cb) / (ca + cb))
  }
}

// buoyant transport between two fluids, in the same /8192 units as a face
// flux: the fraction of a rising cell's excess heat carried up per tick. The
// face rule in Simulation.buoyant() keeps it an antisymmetric flux.
export const RISE = new Uint16Array(MAT_COUNT * MAT_COUNT)
for (let a = 0; a < MAT_COUNT; a++)
  for (let b = 0; b < MAT_COUNT; b++)
    RISE[a * MAT_COUNT + b] = Math.round(Math.min(CONVECT[a], CONVECT[b]) * 8192)

// inverse heat capacity, Q8: a cell's temperature moves by its net energy flow
// times CAP_Q / 256. Air is 256 (capacity 1); denser matter changes slower.
export const CAP_Q = new Uint16Array(MAT_COUNT)
for (let m = 0; m < MAT_COUNT; m++) CAP_Q[m] = Math.round(256 / HEAT_CAP[m])

// Render-only one-degree lookup: no per-pixel arrays or interpolation. The
// authoritative field retains all Q4 precision; this changes no physics.
export const HEAT_COLORS = new Uint32Array(MAX_TEMP - MIN_TEMP + 1)
const stops = [-160, 0, 20, 100, 400, 1100, 2400]
const colors = [
  [45, 85, 220],
  [90, 180, 220],
  [24, 26, 32],
  [180, 95, 35],
  [240, 50, 24],
  [255, 180, 45],
  [255, 245, 220],
]
let stop = 0
for (let temperature = MIN_TEMP; temperature <= MAX_TEMP; temperature++) {
  while (stop < stops.length - 2 && temperature > stops[stop + 1]) stop++
  const t = (temperature - stops[stop]) / (stops[stop + 1] - stops[stop])
  const a = colors[stop],
    b = colors[stop + 1]
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const blue = Math.round(a[2] + (b[2] - a[2]) * t)
  HEAT_COLORS[temperature - MIN_TEMP] = (0xff000000 | (blue << 16) | (g << 8) | r) >>> 0
}

/** render-only index into the one-degree lookup tables. */
export function degreeIndex(h: number): number {
  const d = Math.round(h)
  return (d < MIN_TEMP ? MIN_TEMP : d > MAX_TEMP ? MAX_TEMP : d) - MIN_TEMP
}

function ramp(
  at: number[],
  rgbw: number[][],
  write: (index: number, r: number, g: number, b: number, w: number) => void,
): void {
  let k = 0
  for (let temperature = MIN_TEMP; temperature <= MAX_TEMP; temperature++) {
    while (k < at.length - 2 && temperature > at[k + 1]) k++
    const t = Math.max(0, Math.min(1, (temperature - at[k]) / (at[k + 1] - at[k])))
    const a = rgbw[k],
      b = rgbw[k + 1]
    const mix = (c: number) => a[c] + (b[c] - a[c]) * t
    write(temperature - MIN_TEMP, mix(0), mix(1), mix(2), mix(3))
  }
}

// incandescence: matter hotter than GLOW_START blends its own color toward a
// black-body-ish ramp (dull red, cherry, orange, yellow-white) and feeds the
// bloom/light passes, so hot slabs visibly glow and fade as they cool.
export const GLOW_START = 430
export const INCAN_RGB = new Uint32Array(MAX_TEMP - MIN_TEMP + 1)
export const INCAN_W = new Uint16Array(MAX_TEMP - MIN_TEMP + 1) // 0..256 blend weight
export const INCAN_LIGHT = new Uint32Array(MAX_TEMP - MIN_TEMP + 1) // emitted light
ramp(
  [MIN_TEMP, GLOW_START, 520, 650, 800, 1000, 1300, MAX_TEMP],
  [
    [120, 20, 8, 0],
    [120, 20, 8, 0],
    [160, 26, 10, 0.4],
    [205, 48, 14, 0.62],
    [240, 92, 22, 0.8],
    [255, 150, 48, 0.92],
    [255, 215, 120, 1],
    [255, 250, 230, 1],
  ],
  (i, r, g, b, w) => {
    INCAN_RGB[i] = (0xff000000 | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0
    INCAN_W[i] = Math.round(w * 256)
    // light output grows faster than the color blend: a dull red slab barely
    // lights the room, a yellow one floods it.
    const l = w * w
    INCAN_LIGHT[i] =
      (0xff000000 |
        (Math.round(b * l) << 16) |
        (Math.round(g * l) << 8) |
        Math.round(r * l)) >>>
      0
  },
)

// air color in the normal view: hot air shows as a faint ember haze and cold
// air as a pale frost, so plumes and chill read without the heat view. The
// background color must match Simulation's canvas background.
export const HAZE = new Uint32Array(MAX_TEMP - MIN_TEMP + 1)
ramp(
  [MIN_TEMP, -40, 6, 34, 45, 200, 600, 1200, MAX_TEMP],
  [
    [120, 180, 255, 0.22],
    [120, 180, 255, 0.14],
    [120, 180, 255, 0],
    [255, 120, 40, 0],
    [255, 120, 40, 0.04],
    [255, 110, 40, 0.17],
    [255, 120, 40, 0.3],
    [255, 160, 70, 0.38],
    [255, 200, 120, 0.42],
  ],
  (i, r, g, b, w) => {
    const mix = (c: number, bg: number) => Math.round(bg + (c - bg) * w)
    HAZE[i] = (0xff000000 | (mix(b, 22) << 16) | (mix(g, 18) << 8) | mix(r, 16)) >>> 0
  },
)
