# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server at http://localhost:5173 (base path is "/" in dev)
npm run build      # tsc --noEmit (typecheck) THEN vite build -> dist/
npm run typecheck  # types only, no build
npm run preview    # serve the production build locally
```

There is no test suite and no linter configured. `npm run build` is the gate — it typechecks before building, so a green build means types are sound.

**Deployment is automatic.** Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages (https://thatmike1.github.io/powder-lab/). No manual deploy step.

## Committing

This is a fun personal project — **commit liberally without asking first.** When a change is contained and sensible, just commit it (one line, lowercase, prefixed `feat:`/`fix:`/`refactor:`/`chore:`). No need to surface "want me to commit?" prompts.

**Always commit beads changes silently.** When `bd` issue creation/updates dirty `.beads/issues.jsonl`, fold it into the related commit (or a `chore:` commit) automatically — don't ask, and don't report "N beads files modified".

**Never push** unless explicitly asked for that exact moment — pushing stays user-owned (it auto-deploys `main`).

## Architecture

This is a falling-sand cellular-automaton sandbox. The single most important design decision:

> **React owns the chrome; a plain imperative core owns the 60fps frame.**

React never touches a pixel and never re-renders during simulation. Understanding the boundary between these two worlds is the key to working here.

### The three layers

1. **`src/sim/Simulation.ts`** — the engine. A framework-agnostic class holding the grid as flat typed arrays (`cells`, `life`, `extra`, `stamp`), the cellular-automaton rules, all material reactions, the dirty-chunk scheduler, and the renderer. Has no knowledge of React.

2. **`src/useSimulation.ts`** — the bridge. One `useEffect` owns the `requestAnimationFrame` loop, pointer input, and keyboard shortcuts. **Per-frame config lives in a `useRef` (`cfg`), NOT in React state** — the loop reads `cfg.current` so changing brush/material/speed never triggers a re-render. React state (`ui`) is a *mirror* of that config, updated only so the toolbar can display it.

3. **`src/App.tsx`** — the UI shell (palette, canvas element, controls). Grid dimensions and scale (`W=200, H=150, SCALE=4`) are defined here and passed down.

`src/sim/materials.ts` is shared data: the `Mat` id map, property tables (`density`, `isMovable`, `isDissolvable`), and the `PALETTE`/`CATEGORIES` used to build the UI.

### How the simulation works (and the invariants you must preserve)

The grid is one cell per array slot, indexed `y * W + x`. Each `stepOnce()` increments `frame` and walks cells **bottom-to-top, alternating horizontal direction each frame** to avoid directional bias.

Three invariants make it correct — break any one and you get subtle, hard-to-spot bugs:

- **`stamp` prevents double-moves.** `stamp[i] === frame` means a cell was already processed/moved this frame and is skipped. Every `setCell` and `swap` writes the current `frame` into `stamp`. If you add a path that mutates a cell without stamping it, particles can move twice per frame.

- **`wake()` keeps the dirty-chunk scheduler honest.** The grid is divided into 16×16 chunks (`CS`). Only chunks flagged active get simulated; settled regions cost nothing. **Every time a cell changes, you MUST `wake()` it** (`setCell`/`swap` already do). `wake()` flags the cell's chunk *and* the chunks of all 8 neighbors for next frame — this is what lets a resting particle across a chunk boundary react when its neighbor changes. The #1 class of bug here is "material X stopped reacting": almost always a mutation that forgot to `wake()`, so the chunk fell asleep.

- **Density + `isMovable` drive displacement.** A denser mover sinks through / swaps with a lighter *movable* target (`tryMove` for falling, `tryRise` for gases). Powders are deliberately **not** `isMovable`, which is why liquids rest on top of sand instead of sinking through it. Static solids (wall/stone/wood/plant/ice) have no density entry and never swap.

### Rendering pipeline

`render()` writes one ARGB pixel per cell into an offscreen `ImageData` (`buf32`, a `Uint32` view), `putImageData`s it to a small offscreen canvas, then `drawImage`s that **scaled up with `imageSmoothingEnabled = false`** for crisp pixels. The glow/bloom is a second pass: emissive cells (fire, lava) are written to a parallel `glow32` buffer on a transparent background, then composited over the main canvas with `globalCompositeOperation = 'lighter'` and a CSS `blur()` filter. Color per cell comes from `colorOf()`, which adds per-cell noise (`extra`) for grain and animates fire/lava flicker using `frame`.

### Adding a new material — the checklist

1. Add an id to `Mat` in `materials.ts`.
2. Set `density[...]` and add to `isMovable`/`isDissolvable` sets if applicable.
3. Add a `case` in `Simulation.update()` dispatching to its behavior.
4. Add a branch in `Simulation.colorOf()`.
5. Add a `PALETTE` entry (name, swatch rgb, category, optional keyboard `key`).

### Deployment specifics

- `vite.config.ts` sets `base` to `/powder-lab/` **only for production builds** (`command === 'build'`); dev stays at `/`. If the repo is renamed, update this and the URLs in `index.html`'s Open Graph tags.
- The social-preview card is `public/og.png` (referenced by absolute URL in `index.html` OG/Twitter meta). GitHub's *repo* social preview (shown on github.com itself) has no API and must be uploaded manually in repo Settings.

## Design Context

The UI chrome's design direction is documented in **`PRODUCT.md`** (strategy: register, users,
personality, anti-references, principles) and **`DESIGN.md`** (visual system: tokens, type,
components, styling conventions). Read those before any chrome/UI work.

In one line: **pixel-native chrome** that shares the medium of the simulation (crisp, dithered,
hand-pixeled; warm-dark, accent follows the selected material), framed in a lifted desktop "window"
with a left material palette and a bottom control bar. Styling stays **plain CSS + a `:root` token
layer** (no framework); inline `style` is only for data-driven material colors and the live
`--accent` variable.

This direction is now implemented: `src/App.tsx` + `src/styles.css` are the reference of record
(tracked in `powder-lab-m86`). The pixel chrome is composed from `src/pixel-icons.tsx` (hand-pixeled
inline-SVG icon set) and `src/chip-styles.ts` (per-material tile textures). The `design-explorations/`
scratch folder that seeded the direction can be deleted.

## Roadmap / future ideas

Future ideas and feature work live in **bd (beads)** — see the *Powder Lab feature roadmap* epic (`bd list --parent powder-lab-kzf`). Run `bd ready` for what's actionable now. Don't maintain a roadmap list here; it drifts out of sync with the tracker.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. For workflow context and commands, prefer the **beads skill** — do not run `bd prime` (its session-close protocol pushes git and steers toward `bd remember`, both of which conflict with this project's prefs).

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- For command reference, use the beads skill (not `bd prime`)

**Architecture in one line:** issues live in a local Dolt DB; `.beads/issues.jsonl` is a git-tracked export kept in sync by the project git hooks. Commit `issues.jsonl` with related work; **do not push** unless explicitly asked.
<!-- END BEADS INTEGRATION -->

## Issue conventions (bd)

How we organize bd issues in this repo. Following these keeps the graph queryable — the point is that `bd query label:perf` or "what blocks this" return complete, trustworthy answers.

**Hierarchy — one level.** Epics are thematic buckets; everything else is a child issue. No epics-of-epics. If an issue sprouts sub-work, prefer a checklist in its acceptance criteria over nesting. Current epics:
- **Powder Lab feature roadmap** — user-facing features + engine work
- **DX & tooling** — developer-experience and maintenance chores

**Dependency types — one meaning each (don't blur them):**
- `parent-child` — structural grouping (epic → its issues)
- `blocks` — hard ordering; B can't start until A is done
- `discovered-from` — provenance; found while working on another issue
- `related` — soft "see also", no ordering

**Priority — be honest, not everything is P1:**
- **P0** critical/broken (rare) · **P1** next up / clear win · **P2** solid, real intent to do · **P3** ambitious/someday · **P4** parked (add a *"don't do until X"* note)

**Types used literally:** `feature` (user-facing) · `bug` (defect) · `chore` (maintenance/DX) · `task` (internal work) · `epic` (bucket).

**Labels — cross-cutting themes only, from this fixed set.** Never invent a label ad-hoc; add it to this list first. Types already cover bug/feature and epics cover grouping, so labels stay orthogonal.
- `dx` — tooling / developer-experience / CI
- `perf` — performance work

**Descriptions carry the context.** Each issue's description states **why** it matters, the **approach / where in code** (`file:line` when known), and **acceptance** (what "done" looks like) — so it's grabbable months later. `bd lint` flags thin ones.

**Keep `bd ready` a real menu.** Non-actionable work is either P4 or sits behind a `blocks` edge with the gate noted, so everything in `bd ready` is something you could actually start now.
