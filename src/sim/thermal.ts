import { CONDUCT, MAT_COUNT } from './materials'

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
