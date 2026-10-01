# Thermodynamics checkpoint — feat/thermo

## Assessment (before implementation)

Read README.md, PRODUCT.md, DESIGN.md, docs/multiplayer-protocol.md, src/sim,
and the client event/scheduler/snapshot paths. The baseline has 140 passing tests
in 16 files; type-check and production build pass. Installed only the locked
repo dependencies (one node_modules). No services or configuration outside the
repo have been changed.

The existing engine already has Float32 temperatures, harmonic conductivity,
ambient cooling, heat-dependent ignition and phase thresholds, oil/lava/powder,
and a render-only Temp toggle. It still treats heat as stationary space during
particle movement; ice is an infinite cold source; steam usually expires rather
than condensing; fuel is replaced outright by fire; pressure is absent. Flame
lifespans can underflow their Uint8 counter. Full-state v1 includes the seeded
PRNG, stamps and BOTH chunk queues. The tiny RLE scene format carries materials
only. Networked tools must pass through ordered, batched input broadcasts.

The grid is 200×150 at 75 ticks/sec: 13.33 ms for a tick, with rendering needing
headroom. A local Node/tsx benchmark uses the test canvas shims, seed 42, 100
warmup + 400 measured steps, with idle, all-lava, forced-active mixed slabs and
the first gallery contraption. Benchmark results below are CPU step cost only,
not browser rendering; shared-server scheduling adds occasional outliers.

Baseline on this shared ARM server (ms/step):

| Scene | Mean | Median | p95 | Active chunks |
| --- | ---: | ---: | ---: | ---: |
| Idle | 0.058 | 0.010 | 0.012 | 0 |
| Full lava | 19.128 | 17.284 | 38.698 | 130 |
| Mixed slabs, forced active | 9.234 | 8.679 | 17.458 | 130 forced |
| First contraption | 0.402 | 0.329 | 0.961 | 12 |

The fully active baseline already exceeds budget here. The nine-iteration
`wake()` per cell and repeated harmonic-mean division are optimization targets.
A previous run during tests measured lava at 14.607 ms mean, so host load is
significant; report distributions and the same harness again at unit 7.

## Plan and status

0. **Complete:** assess, baseline tests/build and benchmark; commit this plan.
1. **Complete:** fixed-point temperature operations, neighbour conduction, ambient
   cooling, material heat transport, correct thermal chunk waking.
2. **Pending:** temperature-led ice/water/steam/glass transitions with latent heat;
   keep thermal state across transitions and serialize new phase progress.
3. **Pending:** temperature ignition, finite fuel, smoke and heat, quenching;
   serialize fuel and prevent counter underflow.
4. **Pending:** integer gas pressure, expansion from boiling/combustion, venting,
   material strength and ruptures; pressure in snapshots and checksums.
5. **Pending:** readable heat view/legend and heat/cool brushes using the existing
   batched lockstep paint path; tools never become cell materials.
6. **Pending:** thousands-of-ticks paired simulations, ongoing byte equality,
   live mid-reaction snapshot continuation, chunk borders, network replay.
7. **Pending:** repeat identical benchmark, optimize active passes and conduction;
   record timing and practical budget limits, no timing-based simulation branches.
8. **Pending:** tune reactions, showcase the existing oil/lava/gunpowder plus
   useful thermal materials and gallery contraptions; browser visual check.

Each unit is also tracked under beads epic powder-lab-t7i. Before every commit:
`npm run typecheck`, single-worker Vitest, and `npm run build`. Update this file
and push feat/thermo after every unit. Main must never be pushed. User's explicit
branch/push/checkpoint instructions override generated bd-prime text claiming no
remote exists (origin is configured).

## Implementation decisions

- Use exact binary fixed-point temperatures (1/16 degree) and integer flux math;
  retain the public temperature array's degree units for rendering and inspection.
- Scratch buffers are rebuilt before use. Any persistent phase/fuel/pressure
  arrays must be serialized; both chunk queues remain byte-exact on load.
- Thermal physics is an accelerated cellular model for a toy, not a fluid solver.
  Material thresholds and latent heat will be documented alongside their tuning.
- Heat view is cosmetic and may differ per client; thermal brushes are inputs.
- Test and benchmark jobs run with one worker; browser checks use cached Chromium.

## Next

Implement unit 2. Unit 1: Q4 temperatures and integer face flux; conduct before
movement, advect heat with particles, precomputed harmonic conductivity, cheaper
chunk waking. Minimum one-quantum ambient cooling prevents an integer tail from
keeping chunks awake forever. Retuned fire emission/wood ignition for the changed
transport. Added border/transport/wake regressions. 143 tests pass in 17 files;
type-check and production build pass. No new persistent state in unit 1.
