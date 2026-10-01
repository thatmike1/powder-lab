# Thermal simulation

Powder Lab uses an accelerated cellular model at 75 ticks/sec. Temperatures are
sandbox degrees: the water thresholds are familiar, but glass fusion is scaled
so a lava pool makes glass visibly. This is a toy rather than a calibrated fluid
solver. There is no real-world time/length mapping or oxygen chemistry.

Each tick consumes the previous chunk queue, conducts heat, moves/reacts
particles, shares gas pressure, and fractures weak enclosures. Any changing
particle, temperature or pressure wakes its chunk and neighboring chunk faces.
No wall clock, renderer setting or adaptive performance branch enters physics.

## Heat

Temperature is stored as Float32 **exact multiples of 1/16 degree**. Integer Q4
gradients and precomputed Q10 harmonic face conductivity drive a stable
four-neighbor Jacobi stencil. Ambient cooling goes toward 20, by at least one
quantum until it settles. Conducting metal bridges heat; stone/wood/glass slow
it; Wall is an ideal insulator. Particle swaps carry heat, latent energy and
fuel. Pressure stays in space.

Painted ice starts at -40 and has finite cold energy. Steam starts at 120.
Fire consumes finite fuel while emitting at 1500; lava is deliberately a
persistent 1100-degree reservoir so streams stay molten in air. Wet lava
solidifies into stone. Lightning briefly emits at 1800.

## Phases and combustion

Ice melts at 0, water freezes below -2 (hysteresis), boils at 100, and steam
condenses at 90. Neighbor pressure raises boiling and condensation thresholds.
Sand fuses to Glass at the scaled 300-degree gate. Each transition must absorb
or release latent energy, stored in a signed Q4 `phase` buffer. A partially
transitioned cell stays at its phase boundary; heat reversal consumes the
stored progress. Transformation preserves remaining temperature instead of
applying a fresh material's spawn temperature.

Steam retains its water mass until it condenses or reaches an open edge.
Wood, oil and plants ignite from temperature and their remaining fuel. Burning
wood/plants stay anchored; loose flames rise. Burning spends fuel and emits
heat/smoke; water or sufficiently low temperature quenches it. Gunpowder is
heat-sensitive, inert when wet, and injects heat/pressure when it explodes.

## Pressure

Unsigned integer gauge pressure ranges from 0 (atmosphere) to 4095. Boiling
injects expansion, hot steam continues expanding, and combustion produces gas.
A four-neighbor Jacobi pass exchanges pressure only through air/gases; closed
faces do not leak and open grid edges vent to zero. Very small pressure tails
snap to zero. Smoke trapped at appreciable pressure does not vanish by lifespan.

Glass (300), plants (200), ice (450), wood (600), stone (1600) and metal (3200)
have progressively stronger rupture thresholds. Wall is indestructible. A
rupture leaves a vent and throws a fragment into adjacent air. This local
pressure field approximates confinement/expansion; it does not solve gas volume,
compressible liquid flow or momentum.

## Lockstep and persistence

All stochastic rules use `src/sim/rng.ts`. The renderer consumes no randomness.
Full snapshots use little-endian state version 4: dimensions/tick/PRNG word;
`cells`, `life`, `extra`, both chunk queues, `stamp`, `heat`, `phase`, `fuel`,
`burnFrom`, and `pressure`. Scratch buffers are fully copied/rebuilt before use.
Old state versions are rejected with an actionable disconnect instead of
loading missing physics. Checksums cover every persistent field, including the
exact Q4 temperature, PRNG and chunk queues.
The legacy RLE scene format contains materials only and reseeds their spawn
state; it is separate from multiplayer snapshots.
