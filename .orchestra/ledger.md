# Orchestration Ledger — multiplayer powder-lab v1

BASELINE: 7f3c3a7b76dff93c6a9fc983c41d55978529e0aa | clean (0 porcelain lines) | 2026-09-02
BASELINE GATES: `npm test` 33/33 pass, `npm run build` clean

## Mode
Full (Agent tool + real shell). Codex not probed — not needed, no consent sought.
LEAD seat: Opus 5, frontier class.

## Architecture decision (conductor, pre-dispatch)
Deterministic lockstep over an input-relay server. Rationale: 200x150 grid at
75 Hz makes grid-delta streaming infeasible (megabytes/sec); input streaming is
tens of bytes per stroke. Cost is bit-determinism in the simulation. All 35
`Math.random()` call sites live in one file (`src/sim/Simulation.ts`), so the
refactor is contained. Spec written to `docs/multiplayer-protocol.md`; both the
server and the client implement that document.

## Plan
| id | task | class |
|----|------|-------|
| T1 | Determinism core: seeded PRNG, full-state serialize/load, tick counter, checksum | WORKHORSE (numeric care) |
| T2 | Relay server: rooms, tick clock, input stamping, snapshot store | WORKHORSE |
| T3 | Client netcode: transport, tick sync, input scheduling, desync recovery | WORKHORSE |
| T4 | Room UI: create/join, connection state, peer cursor overlay | WORKHORSE |

## Routing
- T1 → opus, high effort — determinism is subtle; a missed RNG site desyncs silently.
- T2 → opus, medium effort — well-specified server, spec-driven.
- T3 → opus, high effort — tick sync and scheduling are the run's hardest logic.
- T4 → opus, medium effort — UI against an interface T3 exports.
- Verifier → orchestra-verifier (inherit = Opus). Same model, independent context.
  Disclosure: blind-verified (same model, independent context), not cross-family.

## Waves
- Wave 1: T1 ∥ T2 — disjoint write sets, verified below.
- Wave 2: T3 — depends on T1 API and T2 protocol.
- Wave 3: T4 — depends on T3 exported hook surface.

## Write sets (disjointness check for wave 1)
- T1: `src/sim/Simulation.ts`, `src/sim/rng.ts`, `src/sim/state.ts`, `src/sim/determinism.test.ts`
- T2: `server/**`, `package.json`, `package-lock.json`, `vitest.config.ts`
- Overlap: none. `docs/multiplayer-protocol.md` is read-only for both (conductor-owned).

## Tasks
| id | state | owned paths | job |
|----|-------|-------------|-----|
| T1 | DISPATCHED | src/sim/{Simulation.ts,rng.ts,state.ts,determinism.test.ts} | T1-determinism |
| T2 | DISPATCHED | server/**, package.json, package-lock.json, vitest.config.ts | T2-relay |
| T3 | PENDING | src/net/**, src/useSimulation.ts | — |
| T4 | PENDING | src/App.tsx, src/styles.css, src/RoomBar.tsx | — |

## Attempts
| task | # | seat | ticket rev | outcome | checks | evidence | when |
|------|---|------|-----------|---------|--------|----------|------|
| T1 | 1 | opus/high | rev1 | dispatched | — | — | 2026-09-02 18:10 |
| T2 | 1 | opus/med | rev1 | dispatched | — | — | 2026-09-02 18:10 |

## Decisions
- 2026-09-02: lockstep over server-authoritative. Bandwidth forced it.
- 2026-09-02: room-global speed pinned to 1 and pause as an input event; a client
  stepping at a different speed diverges by construction.
- 2026-09-02: cursors are cosmetic, outside lockstep, rendered as a DOM overlay
  so no ticket needs to touch `Simulation.render`.
- 2026-09-02: v1 runs locally (`npm run server`). VPS deployment deferred.

## Scratch
`.orchestra/scratch/`
