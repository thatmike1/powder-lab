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

## Roadmap / future ideas

Not commitments — pick whatever's fun. Two orderings below: one by how much each idea improves the codebase, one by how much it'd make a viewer go "whoa."

### By architectural leverage

- **🌡️ Heat field.** Add a parallel temperature grid that diffuses each frame. Replace the hard-coded "touches fire/lava" ignition checks with real thresholds (ignition point, melting point, freezing point). This is the highest-leverage change — it turns a pile of special cases into one unified physical model and makes ice/steam/lava behavior emergent rather than scripted.
- **💨 Pressure & velocity.** Give fluids a velocity field so water sloshes and gases pressurize/equalize, instead of the current one-cell-per-frame spread. Bigger lift; pairs well with the heat field.
- **🖼️ Image import.** Drop a PNG and rasterize it into colored sand that falls — map pixel luminance/hue to materials. Cheap to build, very shareable.
- **💾 Save / load / share scenes.** Serialize the `cells` grid (RLE-compress it) into a URL hash or a downloadable file. Enables a "scene gallery."
- **🧪 Material editor.** Surface the property tables (`density`, flammability, reactions) as live UI so users can invent materials without touching code. Requires generalizing the hard-coded `update()` cases into a data-driven reaction table first.
- **🌐 GPU backend.** Move the grid to a fragment/compute shader (ping-pong textures) to push from ~30k cells to millions. Largest rewrite; would replace `Simulation.step()` entirely while keeping the React/material layers.
- **⚙️ Perf headroom.** The render loop currently scans every cell each frame in `writeImage()` even when chunks are asleep — a render-side dirty-rect pass would mirror the sim-side chunk culling. Also worth profiling the per-frame `Math.random()` volume in hot paths.
- **🏷️ Polish.** Bump the GitHub Actions to Node 24 before the June 2026 deprecation.

### By flashiness (pure wow-factor)

Ranked by jaw-drop-per-screenshot, roughly descending.

- **💡 Dynamic lighting.** Make fire and lava actually *cast light* — a screen-space radial glow that brightens nearby cells so a cave of stone flickers orange as lava flows past. This is the single biggest "whoa" for the least structural change: it's a second additive render pass on top of the existing `glow32` buffer, no simulation changes needed. Turns the toy into something that looks like a game.
- **⚡ Lightning / electricity.** A material that arcs between conductive cells (metal, water) along a jagged path, branching and flickering. Electricity is inherently dramatic — instant motion in an otherwise gravity-paced world. Pairs with the heat field (arcs ignite, boil, melt).
- **🌐 GPU backend → millions of particles.** Move the grid to ping-pong shader textures. The wow here is pure scale: a full-screen 4K storm of swirling powder at 120fps. Biggest rewrite on the list, but the most show-stopping demo.
- **💥 Velocity-based explosions.** Right now gunpowder flashes in place. Give the blast real momentum so it hurls sand, water, and debris outward in an arc that rains back down. Explosions are the screenshot money-shot; adding throw makes them feel physical.
- **🎬 Clip export.** One button that records the canvas to a GIF/WebM. Doesn't change the sim at all, but it's a force-multiplier for *every* other flashy feature — it's how the cool moments actually leave your screen and end up shared.
- **🖼️ Image-drop reveal.** Drag in a photo and watch it rain down as colored sand, then dissolve/burn it. The reveal-then-destroy arc is satisfying and very shareable.
- **🔊 Reactive audio.** Sizzle when water hits lava, a low boom on explosions, a crackle for fire scaled by how much is burning. Flashy for the ears — cheap to add with the Web Audio API, disproportionately immersive.
- **🌊 Sloshing fluids.** With a velocity field (see leverage list), water gains momentum — waves slap walls and splash. Less of an instant screenshot, more of a "wait, is this real water?" when you interact with it.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
