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
gradients and precomputed Q10 harmonic face conductivity drive a four-neighbor
Jacobi stencil. Conducting metal bridges heat; stone/wood/glass slow it; Wall
is an ideal insulator; gases are poor conductors. Particle swaps carry heat,
latent energy and fuel. Pressure stays in space between gas cells; a gas/liquid
displacement carries the displaced gas volume's pressure into its new cell.

**Heat capacity.** A cell's net face energy becomes temperature through its
volumetric heat capacity (`HEAT_CAP`, air = 1): water and stone 3, metal and
glass 2.5, sand/wood 2. Air warms and sheds heat fast; a bath takes a while to
boil; a hot slab stores its heat. Capacities below 1 would destabilize the
explicit stencil.

**The room.** Open air is the world's heat sink: empty cells relax toward the
20-degree ambient by 1/60 of the gap per tick (smoke 1/80), and the top row is
open sky that vents gas heat quickly. Solids and liquids only lose a slow
1/1500 radiative trickle (at least one quantum, so integer tails still settle);
otherwise they cool by conducting into the air at their surface. A hot block
therefore cools from the outside in, its core glowing long after its skin, and
cold things warm from the air around them.

**Convection.** Across a vertical face between two fluids whose lower cell is
hotter, a fraction (`CONVECT`: gases 0.4, liquids 0.08) of the lower cell's
excess over ambient rises, and the upper cell's chill sinks. It is a single
flux per face that both cells compute identically, so it conserves energy and
stays lockstep-safe. It is donor-cell transport without a velocity field, so a
cell that received buoyant heat is clamped to its neighbors' temperature range:
air trapped under a ceiling pools up to its source's temperature, never above.
Fires, heaters and lava send a plume up instead of a round halo, and cold air
from a chiller sinks to the floor.
Painted ice starts at -40 and has finite cold energy. Steam starts at 120.
Fire consumes finite fuel while emitting at 1500; lava is deliberately a
persistent 1100-degree reservoir so streams stay molten in air. Wet lava or the
Cool brush solidifies it into stone. Lightning briefly emits at 1800. The new
stationary **Heater** (1200) and **Chiller** (-120) act as powered reservoirs;
conducting metal plates spread their heat/cold into a bath. They are intentionally
infinite sources, unlike ice and burning fuel.

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
wood/plants stay anchored, flare at 1500 while throwing short-lived loose flames
upward, then below 120 fuel die down to 600-degree embers that smoulder slowly
and throw no flames. Loose flames rise. Water or sufficiently low temperature
quenches fire: water falling onto a flame puts it out instead of swapping
places with it, and a quenched flame flashes the water it touches to steam. Gunpowder is
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

## Reading heat without the heat view

Rendering consumes no physics state beyond reading it. Solids and liquids above
430 degrees blend toward a black-body ramp (dull red, cherry, orange, yellow
white) and feed the bloom and lighting passes in proportion to their glow, so a
red-hot slab lights the room and visibly fades as it cools. Hot air shows as a
faint ember haze and cold air as a pale frost; matter below zero frosts over.

## Lockstep and persistence

All stochastic rules use `src/sim/rng.ts`. The renderer consumes no randomness.
Full snapshots use little-endian state version 4: dimensions/tick/PRNG word;
`cells`, `life`, `extra`, both chunk queues, `stamp`, `heat`, `phase`, `fuel`,
`burnFrom`, and `pressure`. Scratch buffers are fully copied/rebuilt before use.
Old state versions are rejected with an actionable disconnect instead of
loading missing physics. Checksums cover every persistent field, including the
exact Q4 temperature, PRNG and chunk queues.
The legacy RLE scene format contains materials only and reseeds their spawn
state; it is separate from multiplayer snapshots. Full `.powder` downloads
retain a live reaction exactly, including sleeping chunks.

The clock uses the largest signed `serverTime - localNow` sample in a rolling
window: the fastest packet has the least delay. Delayed full-state frames must
not pull one client's room clock behind its peers. Input assignment, ordering
and batching remain the same as before.

## Try it

Open **Gallery**, choose a scene, then press **Play**:

- **Hot & Cold:** a heater boils one bath while a chiller freezes the other.
  Press **H** for the temperature view; hover to read temperature and pressure.
- **Pressure Cooker:** heated water fills a glass vessel with steam and ruptures
  it. Erase part of the lid before starting to compare an open vent.
- **Glassworks:** lava fuses a bed of sand into glass. Paint **Cool** to leave a
  stone crust over it.
- **Campfire / Forest Fire:** flames lick upward, climb into what is above them,
  then die down to glowing embers. Press **H** to see the hot plume.
- **Anything hot:** paint Metal or Stone, hold **Heat** on it until it glows,
  then watch it fade from the edges in.

Paint **Heat** with **B**, **Cool** with **K**, **Heater** with **J** and
**Chiller** with **U**. Oil, wood, plants and gunpowder respond to heating;
water and cooling extinguish fire. Brushes apply while paused; phases react
when stepping resumes. Palette tooltips describe the new materials.

## Verification and budget

`pnpm test --maxWorkers=1 --minWorkers=1` includes a paired 4096-tick thermal
script that compares complete state bytes after every tick, render differences,
scratch-buffer poisoning and mid-reaction reloads. Additional tests cover phase
reversal, chunk borders, finite fuel, gas confinement/venting and network replay.
`pnpm run bench:sim --stress` measures CPU step cost for 200×150 cells, with
100 warmup and 400 measured ticks; rendering is outside those timings. The
75 Hz step budget is 13.33 ms. See `PROGRESS.md` for results on the shared ARM box.
