import '../test/setup.ts'
import { performance } from 'node:perf_hooks'
import { Simulation } from '../src/sim/Simulation.ts'
import { Mat } from '../src/sim/materials.ts'
import { PRESETS } from '../src/sim/presets.ts'
const W = 200,
  H = 150
function measure(
  name: string,
  make: () => Simulation,
  force = false,
  prepare?: (s: Simulation) => void,
) {
  const s = make()
  const samples: number[] = []
  for (let k = 0; k < 500; k++) {
    if (force) (s as unknown as { activeNext: Uint8Array }).activeNext.fill(1)
    prepare?.(s)
    const t = performance.now()
    s.step()
    const dt = performance.now() - t
    if (k >= 100) samples.push(dt)
  }
  samples.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      name,
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
      p50: samples[200],
      p95: samples[380],
      p99: samples[396],
      forcedActive: force,
      activeNext: (s as unknown as { activeNext: Uint8Array }).activeNext.reduce(
        (a, b) => a + b,
        0,
      ),
      hash: s.checksum(),
    }),
  )
}
measure('idle', () => {
  const s = new Simulation(W, H, 42)
  s.step(200)
  return s
})
measure('full-lava', () => {
  const s = new Simulation(W, H, 42)
  s.restore(new Uint8Array(W * H).fill(Mat.LAVA))
  return s
})
measure(
  'full-mixed-forced-active',
  () => {
    const s = new Simulation(W, H, 42)
    const cells = new Uint8Array(W * H)
    const mats = [Mat.SAND, Mat.WATER, Mat.OIL, Mat.ICE, Mat.WOOD, Mat.LAVA, Mat.STEAM, Mat.METAL]
    for (let i = 0; i < cells.length; i++) cells[i] = mats[((i % W) / 25) | 0]
    s.restore(cells)
    return s
  },
  true,
)
measure('gallery-first-contraption', () => {
  const s = new Simulation(W, H, 42)
  s.restore(PRESETS.find((p) => p.id === 'hourglass')!.build(W, H))
  return s
})

if (process.argv.includes('--stress')) {
  measure(
    'full-sealed-hot-steam',
    () => {
      const s = new Simulation(W, H, 42),
        cells = new Uint8Array(W * H).fill(Mat.STEAM)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) cells[y * W + x] = Mat.WALL
      s.restore(cells)
      return s
    },
    true,
    (s) => s.heat.fill(160),
  )
  measure(
    'full-burning-fuel',
    () => {
      const s = new Simulation(W, H, 42)
      s.restore(new Uint8Array(W * H).fill(Mat.FIRE))
      return s
    },
    true,
    (s) => {
      s.cells.fill(Mat.FIRE)
      s.fuel.fill(240)
      s.burnFrom.fill(Mat.WOOD)
    },
  )
}
