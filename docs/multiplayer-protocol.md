# Multiplayer protocol (v1)

Authored by the orchestration conductor before implementation. Both the relay
server and the client netcode implement THIS document. Where an implementation
detail is unspecified here, prefer the simplest thing that satisfies the stated
invariant, and note it in your report.

## Model: deterministic lockstep

Every client runs an identical `Simulation` seeded identically. The only thing
on the wire is **input events**, each stamped with the tick at which every
client applies it. Nobody ships grid deltas.

The reason: the grid is 200x150 = 30,000 cells stepping at 75 Hz. Streaming
changed cells is megabytes per second in an active scene. Streaming inputs is a
few dozen bytes per paint stroke.

The cost: the simulation must be bit-deterministic. All randomness comes from a
single seeded PRNG stream advanced identically on every client, and every
mutation reaches the grid through a broadcast input event. There is no such
thing as a local-only edit inside a room.

## Tick clock

- `TICK_MS = 1000 / 75` — one simulation tick. This matches the existing
  `STEP_MS` fixed-timestep constant in `src/useSimulation.ts`.
- A room has a creation timestamp `t0` (server wall clock, ms).
- `serverTick = floor((serverNow - t0) / TICK_MS)`.
- The server is authoritative for tick assignment. Clients estimate the server
  clock offset from the handshake and from `serverTime` echoed on every message,
  smoothed; they never assign apply-ticks themselves.
- `INPUT_DELAY = 10` ticks (~133 ms). The server assigns
  `applyTick = serverTick + INPUT_DELAY` to every input it accepts and
  broadcasts it to all peers **including the sender**. A client never applies
  its own input locally ahead of the broadcast; it waits, so all peers apply the
  same event at the same tick. Local paint feedback before that tick, if any,
  is a rendering hint only and must not touch the grid.
- Speed is pinned to 1 inside a room. Per-client speed control is disabled while
  connected, because a client stepping faster diverges by definition.
- Pause is room-global and travels as an input event.

## Input events (the only grid mutations)

Every one of these corresponds to an existing `Simulation` public method, and
all of them must be routed through the network layer while in a room:

| type      | payload                          | Simulation call            |
|-----------|----------------------------------|----------------------------|
| `paint`   | `{pts: [x0,y0,x1,y1,...], r, mat}` | `paint(x, y, r, mat)` per point, in order |
| `magnet`  | `{pts: [x0,y0,x1,y1,...], r, attract}` | `magnet(x, y, r, attract)` per point, in order |
| `strike`  | `{x, y}`                         | `strike(x, y)`             |
| `clear`   | `{}`                             | `clear()`                  |
| `setState`| `{state: base64}`                | `loadState(bytes)`         |
| `running` | `{on}`                           | room-global pause          |

`setState` carries a **full serialized state** (see below), not the RLE scene
format. It is what a preset load, a `.powder` file load, and a desync resync all
send. Loading a scene inside a room is therefore a room-wide event.

`paint` and `magnet` both carry a flat list of points rather than a single one. A held pointer
emits a stroke every rendered frame, and one message per frame per client is
about 60 per second of pure overhead. The client coalesces a stroke's sampled
points into one event and sends at most ~20 events per second; the points still
apply one at a time, in order, so the stroke looks identical. The server does not
parse event payloads, so this shape costs it nothing.

`magnet` needs the same treatment for a different reason: it is a force applied
per sample, so throttling it to 20 events per second without batching makes the
in-room magnet pull about a third as hard as the offline one. Batching the
samples keeps the force identical on both sides of a connection.

The client also prefixes the opaque `state` blob with its own small header
carrying the room tick and the pause flag, because pause separates the room
clock from the simulation clock (the room tick must keep following the server,
or the resume input's `applyTick` is never reached and the room deadlocks) and
the simulation's own bytes only know the simulation tick. The server never looks
inside the blob, so this costs it nothing either.

Ordering: the server stamps a monotonically increasing sequence number on every
input. Events sharing an `applyTick` are applied in ascending `seq` order on
every client, so concurrent strokes resolve identically everywhere.

## Full state serialization

The existing `snapshot()` / RLE format carries `cells` only. That is enough for
a shareable URL and **not** enough for a late joiner, because two clients whose
`life`, `extra`, `heat` and PRNG cursor differ will diverge within a few ticks.

Full state must carry, in one byte stream with its own magic and version:

- `W`, `H`
- `cells` (Uint8Array), `life` (Uint8Array), `extra` (Uint8Array)
- `heat` (Float32Array)
- `stamp` (Int32Array)
- `active` and `activeNext` (Uint8Array, the chunk-activity queues)
- the PRNG state word
- the current `tick`

The chunk-activity queues are load-bearing and easy to miss. Cells inside a
sleeping chunk draw no random numbers, so a joiner that woke every chunk on load
would run its PRNG ahead of its peers and desync. `heatNext` is correctly absent:
`diffuse()` opens with a full `heatNext.set(heat)`, so it carries nothing across
a tick.

Compression beyond a straight byte dump is optional for v1. A 200x150 grid
encodes to roughly 270 kB uncompressed, ~360 kB base64 — cheap enough to send on
join, expensive enough that it should never be sent on a timer.

## Checksums and desync

- Every 300 ticks (~4 s) a client sends `{type: "checksum", tick, hash}`.
- `hash` is FNV-1a 32-bit over `cells`, `life`, `extra`, and `heat` quantized as
  `Math.round(heat * 4) | 0`, in that order.
- The server compares hashes reported for the same tick. On mismatch it requests
  a fresh full state from the **oldest peer in the room** (the authority) and
  forwards it to the disagreeing client as a `setState` input.
- A `setState` carries the tick the state was serialized at, which is in the past
  by the time it arrives. The recovering client therefore loads the state, sets
  its tick to the state's tick, and **replays from its own retained input log**
  every input with `applyTick` greater than that tick, stepping forward to the
  current tick. Every client keeps a few seconds of applied inputs for exactly
  this. Because `INPUT_DELAY` broadcasts inputs ahead of when they apply, a
  connected client always holds the inputs it needs; the server keeps no history.
- A targeted `setState` still consumes a room `seq`, so healthy peers see a gap
  in the sequence. `seq` is an ordering key, never a completeness check.
- The server also keeps the most recent full state it has seen, refreshed by the
  authority every ~10 s, and serves it to late joiners.

## Wire messages

JSON over WebSocket for v1. Binary payloads (full state) travel base64-encoded
inside the JSON.

Client to server:

- `{type: "join", room, name}` — `room` empty or absent means "create one"
- `{type: "input", event}` — `event` is one of the input events above, unstamped
- `{type: "checksum", tick, hash}`
- `{type: "state", state}` — authority answering a state request
- `{type: "cursor", x, y}` — cosmetic, see below

Server to client:

- `{type: "joined", room, you, seed, tick, serverTime, state, peers}`
- `{type: "input", event, applyTick, seq, from}`
- `{type: "peers", peers}` — on any join or leave
- `{type: "cursor", from, x, y}`
- `{type: "stateRequest"}` — sent only to the authority
- `{type: "error", message}`

`seed` is fixed per room at creation and never changes; a client that joins
mid-session gets both the seed and a full state, and the state's PRNG word wins.

## Cursor presence

Cursors are **cosmetic and outside lockstep**. They are relayed at about 10 Hz,
carry no tick, are never applied to the grid, and are rendered as a DOM overlay
above the canvas rather than inside `Simulation.render`. A dropped cursor packet
must never affect simulation state.

## Room codes

Four to six characters from an unambiguous alphabet (no O/0, I/1). Rooms live in
server memory only; an empty room is dropped after a grace period.

## Explicitly out of scope for v1

Persistence across server restarts, authentication, rollback netcode, per-user
undo, spectator mode, and any deployment concern beyond running locally.
