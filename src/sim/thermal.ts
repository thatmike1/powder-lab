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
