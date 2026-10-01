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
2. **Complete:** temperature-led ice/water/steam/glass transitions with latent heat;
   keep thermal state across transitions and serialize new phase progress.
3. **Complete:** temperature ignition, finite fuel, smoke and heat, quenching;
   serialize fuel and prevent counter underflow.
4. **Complete:** integer gas pressure, expansion from boiling/combustion, venting,
   material strength and ruptures; pressure in snapshots and checksums.
5. **Complete:** readable heat view/legend and heat/cool brushes using the existing
   batched lockstep paint path; tools never become cell materials.
6. **Complete:** thousands-of-ticks paired simulations, ongoing byte equality,
   live mid-reaction snapshot continuation, chunk borders, network replay.
7. **Complete:** repeat identical benchmark, optimize active passes and conduction;
   record timing and practical budget limits, no timing-based simulation branches.
8. **Complete:** tuned reactions, powered Heater/Chiller materials, thermal
   gallery contraptions, desktop/mobile visual checks and actual relay parity.

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

All nine units are implemented and verified. Finish unit-8 checkpoint/push and
the final summary; no further physics implementation is required.

Unit 1: Q4 temperatures and integer face flux; conduct before
movement, advect heat with particles, precomputed harmonic conductivity, cheaper
chunk waking. Minimum one-quantum ambient cooling prevents an integer tail from
keeping chunks awake forever. Retuned fire emission/wood ignition for the changed
transport. Added border/transport/wake regressions. 143 tests pass in 17 files;
type-check and production build pass. No new persistent state in unit 1.

Unit 2: temperature-led phase transitions now absorb/release signed Q4 latent
energy. The phase buffer is serialized in state v2 and covered by checksums.
Ice is finite cold matter and melts at 0; water freezes at -2, boils at 100;
steam condenses at 90, preserves water mass and escapes only at open edges.
Sand fuses at the sandbox's scaled 300-degree gate. Reactions preserve remaining
temperature instead of re-seeding the target material. Tests intentionally
replace old infinite-ice/no-condensation assumptions. 146 tests pass in 18 files;
type-check and production build pass. Added partial-transition snapshot and
sealed-steam lifetime checks.

Unit 3: finite Uint16 fuel plus the burning material's origin are serialized in
state v3, moved with particles and checksummed. Ignited wood/plants remain
anchored, consuming fuel while emitting heat and smoke; loose flames rise.
Water/cooling quenches flames; the final fuel tick saturates at zero instead of
wrapping a Uint8 lifespan. Added ignition/consumption/smoke, last-fuel and active
burn snapshot tests. 149 tests pass in 19 files; type-check/build pass.

Unit 4: integer pressure exchanges through air/gases, vents at open grid edges,
and remains in sealed regions. Boiling/combustion/gunpowder inject expansion;
pressure shifts water thresholds. Material strengths drive visible rupture and
debris, with indestructible Wall preserved. Spatial pressure is serialized in
state v4 and checksummed; its scratch buffer is rebuilt each pass. Added sealed
vs vented, boiling glass rupture, fire pressure, wall immunity and pressure
snapshot continuation checks. 154 tests pass in 20 files; type-check/build pass.
The model and approximations are documented in docs/thermodynamics.md.

Unit 5: Heat (B) and Cool (K) are intercepted paint IDs, never cell materials;
they use the existing point/segment batcher and broadcast/replay path. Added
caps/wall immunity, batched parity and cool-lava regressions. Heat view (H) now
has a dark ambient ramp, material tint, temperature legend and hover temperature/
pressure readout. Full-state .powder saves retain physics; legacy layout files
still load and compact shared URLs remain layouts (UI explains the reset).
Removed the unseeded fallback draw in page seeding. 157 tests pass in 21 files;
type-check/build pass with lockfile dependencies restored. Cached Chromium
verified desktop/mobile heat controls and a 180-degree brush readout without
page errors; fixed narrow layout clipping and bounded palette height. The
browser and temporary dev server are stopped.

Unit 6: a 4,096-tick paired test compares complete serialized bytes after EVERY
tick, with scripted new physics, thermal brush segments, lightning/magnet,
repeated reloads, asymmetric heat-view rendering and poisoned scratch buffers.
A second live snapshot continues 1,197 ticks; state decoding rejects malformed
materials, Q4 temperatures, chunk shapes and older versions atomically. Exact
checksums now cover all persistent state. Network regressions cover no local
thermal echo, paused strokes, pressure late join, replay and incompatible-state
disconnect. 164 tests pass in 22 files; type-check/build pass.

Extra engine check: Node and cached Chromium ran identical 2,000-tick thermal
scripts and produced the same 31,141 bytes, SHA-256
`7752aa103d69b07a69c70f332e1d095790bf6ed1f4538ff29671c82b304cfa25`.
The temporary browser/server have been stopped.

Unit 7: repeatable `npm run bench:sim -- --stress` uses the same baseline sizes,
seed, warmup and samples, plus continuously heated sealed steam and replenished
burning fuel. Fast corner-aware chunk waking, precomputed conductivity and
integer passes preserve before/after benchmark checksums. Heat-view rendering
uses a 10 kB lookup instead of per-pixel allocations and bypasses bloom/darkness.
Added a corner wake regression; 165 tests/type-check/build pass.

Final unit-7 CPU measurements on this shared server (ms per 200×150 step):

| Scene | Mean | Median | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Idle | 0.020 | 0.008 | 0.018 | 0.049 |
| Full lava | 8.007 | 7.109 | 11.025 | 24.244 |
| Mixed, forced active | 5.497 | 5.067 | 7.470 | 13.744 |
| First contraption | 0.677 | 0.544 | 1.693 | 2.803 |
| Sealed hot steam, full active | 7.236 | 6.759 | 8.990 | 15.807 |
| Burning fuel, full active | 6.127 | 5.554 | 8.066 | 12.126 |

Mean/median/p95 fit the 13.33 ms tick budget, with normal gallery/idle scenes
leaving ample render headroom. Occasional p99 host scheduling pauses exceed a
tick; these are CPU step timings, not a claim about end-to-end rendering FPS.
An earlier isolated full-lava run measured 7.211 mean/7.144 median/7.490 p95,
illustrating the server's load variance.

Unit 8: added stationary Heater (J, 1200°) and Chiller (U, -120°), material hints,
and three playable presets: Hot & Cold, Pressure Cooker and Glassworks. Existing
oil/lava/gunpowder remain useful reaction materials. Preset randomness now uses
the engine's Rng implementation. The hourglass benchmark is selected by ID so
new gallery entries do not change its fixture. Rising bubbles now carry gas
pressure when they displace water, fixing pressure loss in the real boiler;
gas/gas pressure remains spatial. Added bubble and full-size preset regressions.
Updated stale characterization comments without removing their tests.

Actual two-browser testing against an isolated local relay caught an existing
clock-filter sign error: delayed full-state frames were selected as the fastest
sample, pulling a client's room clock behind. The filter now chooses the largest
signed offset, with delayed-arrival/negative-skew regressions. Paused preset,
Heat and Cool inputs produce byte-identical downloaded states; live checksum
pairs match at ticks 600, 900, 1200 and 1500. The relay and browsers are stopped.

Cached Chromium visually verified the boiling/freezing heat view, glass rupture,
material controls and mobile gallery/heat view. Fixed intrinsic thumbnail width
overflow and bounded the mobile drawer height. A live 540,279-byte `.powder`
download/import/download round trip is byte-identical, with no page errors.
Final Node/Chromium 2,000-tick parity is 31,141 identical bytes, SHA-256
`e763a5317bf93f0e43e063bd71592c24dfa41228af475f1f72bbbd59b425ed5a`.
The long paired test also paints both new powered sources.

Final gate: **170 tests in 23 files pass**, one worker; frontend/server type-check
and production build pass. Final CPU benchmark, same 200×150 harness (ms/step):

| Scene | Mean | Median | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Idle | 0.031 | 0.009 | 0.051 | 0.747 |
| Full lava | 5.861 | 5.771 | 6.303 | 7.868 |
| Mixed, forced active | 5.024 | 4.846 | 5.353 | 12.396 |
| Hourglass | 0.523 | 0.522 | 0.631 | 0.706 |
| Sealed hot steam, full active | 7.147 | 6.607 | 10.062 | 13.971 |
| Burning fuel, full active | 5.398 | 5.297 | 5.876 | 8.014 |

All mean/median/p95 costs fit the 13.33 ms budget. Host-load variance remains;
these numbers measure simulation CPU cost, excluding rendering.

Beads uses the git-compatible origin remote under `refs/dolt/data`. Its git
subprocess needs the same SSH command as this checkout (the machine's default
key is read-only), so sync succeeded with:
`GIT_SSH_COMMAND="$(git config --get core.sshCommand) -o BatchMode=yes" bd dolt push`.
No credentials or configuration outside the repo were changed.
