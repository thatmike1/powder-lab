# Design

The visual system for Powder Lab's chrome. The direction is **pixel-native**: the interface is
built from the same crisp material as the simulation. It reads as a loving pixel-art application (a
paint tool crossed with a handheld game) framed inside a lifted desktop "window." Reference points:
Aseprite / Deluxe Paint (the workbench), Noita (in-world atmosphere), PICO-8 / Playdate (the
control craft). The approved reference mock is `design-explorations/10-hybrid.html`.

## Theme

Dark, and specifically **warm dark**. Every neutral is tinted toward a warm hue (~60 OKLCH), not
slate-blue. The scene: someone tinkering in a dim room, the bright full-color simulation glowing
inside a calm, recessive chrome that gets out of its way. The chrome is never pure black; the
canvas is the only thing allowed to be vivid.

## Color

All neutrals are warm (hue 60), low-chroma. The accent is **the selected material's own color**,
which means the UI re-tints itself to whatever you are painting with. The reference/default accent
is Lava orange.

Neutral ramp (OKLCH):

| Token         | Value                  | Use                                            |
| ------------- | ---------------------- | ---------------------------------------------- |
| `--ground-d`  | `oklch(0.12 0.010 60)` | desktop behind the window; deepest recess      |
| `--ground`    | `oklch(0.18 0.012 60)` | window body / app background                    |
| `--panel`     | `oklch(0.24 0.012 60)` | sidebar + control-bar surfaces                  |
| `--raised`    | `oklch(0.285 0.013 60)`| tiles, buttons (rest)                           |
| `--raised-2`  | `oklch(0.32 0.013 60)` | hover / secondary raised                        |
| `--raised-3`  | `oklch(0.36 0.013 60)` | top of the stack                                |
| `--hairline`  | `oklch(0.34 0.014 60)` | 1px dividers and borders                        |
| `--text`      | `oklch(0.91 0.012 85)` | primary text/icons                              |
| `--muted`     | `oklch(0.66 0.012 75)` | labels, secondary text                          |
| `--dim`       | `oklch(0.46 0.012 70)` | disabled / tertiary                             |

Depth helpers: `--shadow oklch(0.10 0.01 60)`, `--inset-hi oklch(0.40 0.013 60)` (bevel light edge),
`--inset-lo oklch(0.14 0.01 60)` (bevel dark edge).

Accent (follows the active material; reference = Lava):

| Token         | Value             | Use                                |
| ------------- | ----------------- | ---------------------------------- |
| `--accent`    | `rgb(255,110,30)` | active state, primary button, focus|
| `--accent-dk` | `rgb(150,58,12)`  | accent shadow / pressed            |
| `--accent-lt` | `rgb(255,170,90)` | accent highlight / lit edge        |

Material palette (the source of truth lives in `src/sim/materials.ts`; these are the swatch RGBs):
Sand `196,180,120` · Gunpowder `70,68,78` · Water `54,108,200` · Oil `78,66,44` ·
Acid `120,214,70` · Lava `255,110,30` · Stone `98,98,106` · Wood `112,74,42` · Plant `46,160,60` ·
Ice `170,210,235` · Fire `255,150,40` · Smoke `90,90,96` · Steam `205,210,220` ·
Wall `120,122,130` · Eraser `30,33,38`. These doubles as the brand palette: the UI speaks in
material color.

## Typography

Pixel/bitmap type for identity and labels; a crisp mono for live values. Loaded from Google Fonts.

- **Press Start 2P** — the wordmark only (it is wide; never set body text in it).
- **Silkscreen** — section labels, control labels, key badges, the pixel-UI voice.
- **JetBrains Mono** — numeric values, HUD readouts (fps, particle count, slider values). Tabular.

Hierarchy comes from scale + the pixel/mono contrast, not many sizes. Keep labels short and
uppercase-friendly. Body/value text must stay legible (do not shrink the pixel fonts past comfort).

## Spacing & grid

Base unit `--px: 4px`, matching the simulation's cell scale. **All** sizing and spacing is integer
multiples of it (4 / 8 / 12 / 16 / 24 / 32). The whole UI snaps to this grid; nothing sits at a
half-pixel. Vary spacing for rhythm rather than padding everything equally.

## Depth & elevation

Depth is a signature here, but it is **pixel depth**, never soft shadow.

- Hard pixel bevels: a light edge (top-left, `--inset-hi`) and a dark edge (bottom-right,
  `--inset-lo`), built from zero-blur `box-shadow` / `inset` rings.
- Drop shadows are hard offset blocks only: `box-shadow: Npx Npx 0 var(--shadow)` (blur radius
  always `0`). The lifted window casts one.
- **Banned:** any `blur(`, `backdrop-filter`, non-zero shadow blur radius, `border-radius > 2px`,
  and smooth gradient fills/fades. Corners are square or notched 1 to 2px.

## Texture, light & "glow"

The simulation already emits real glow. The chrome must not fake it with blur.

- Emissive emphasis (active material, lit toggles, firelight on a tile) is **dithered**: hard-edged
  checkerboard / Bayer patterns, denser near the source and sparser outward. Built from hard-stop
  `linear-gradient` background patterns, never `filter: blur`.
- Material swatches are small **textured tiles** (a few pixels of grain/banding/glow per material),
  not flat dots. Each tile has a 1px pixel inset highlight.
- The canvas sits on a classic transparency **checkerboard mat** (the paint-tool tell).

## Iconography

Hand-pixeled, inline SVG, no icon library and no emoji. Each icon is `<rect>` blocks on an 8x8 or
16x16 grid with `shape-rendering: crispEdges`. Set: play, pause, step, clear, brush, eraser, wall.
Icons inherit `currentColor` so they re-tint with the accent.

## Components

- **Window frame** — the app lives in a fake desktop window: a titlebar with the `POWDER LAB`
  wordmark and decorative window controls, the whole window lifted off a darker desktop with a hard
  pixel drop-shadow. The framing is intentional: it makes a modest canvas on a large screen feel
  deliberate rather than lost.
- **Material sidebar (left)** — the palette: textured tiles grouped by category (Tools, Powders,
  Liquids, Solids, Energy) with a Silkscreen label and a pixel `kbd` key badge. The active tile
  wears a pixel selection marquee in the accent.
- **Canvas stage (center)** — the big star, on the checker mat. HUD readouts (`fps`, `particles`)
  as small lit chips near the top; the interaction hint as a quiet line beneath.
- **Bottom control bar** — full width: Play/Pause (primary, accent-filled), Step, Clear as pixel-
  icon buttons; Brush and Speed as **stepped/notched meter sliders** with a square pixel thumb;
  Glow and Light as **lit pixel toggle switches**; Darkness as a slider, visibly dimmed/disabled
  while Light is off.

## Motion

Crisp and minimal. Transitions are short and ease-out; no bounce, no elastic, no animating layout
properties. Selection marquees may march, lit toggles may flick. All decorative chrome motion must
respect `prefers-reduced-motion`. The simulation's own animation is content, not chrome.

## System & conventions (styling architecture)

Powder Lab is a single-view app with no UI framework, and it should stay that way.

- **Plain CSS with a token layer.** Keep one stylesheet (`src/styles.css`) whose `:root` holds the
  tokens above as CSS custom properties. No CSS-in-JS, no Tailwind, no styling dependency; they
  would be overkill here and fight the lean, no-build-step ethos.
- **Inline `style` only for data-driven values.** The one legitimate use is material color (swatch
  fills) and the live accent. Set `--accent` from the selected material in JS (one variable on a
  root element) so the entire chrome re-tints to the chosen material for free. Everything else is
  class-based CSS.
- **The `--px: 4px` grid is the contract.** New chrome composes from the tokens and the grid; it
  does not introduce ad-hoc colors, soft shadows, or rounded corners.
