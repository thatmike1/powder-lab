import type { CSSProperties } from 'react'
import { Mat } from './sim/materials'

// per-material tile "chip" textures, lifted from the approved pixel-native mock
// (design-explorations/10-hybrid.html). each is a few pixels of grain / banding
// / glow built ONLY from hard-stop gradients — no blur — so the swatch reads as
// the same crisp medium as the simulation. this is the one sanctioned use of
// data-driven inline style (material color), per DESIGN.md.
//
// texture vocabulary by category:
//   powders / gases -> two-tone radial dot dither
//   liquids         -> horizontal band; lava glows via checker
//   solids          -> 1px grid (stone/wall) · vertical grain (wood) · checker (ice)
//   tools           -> eraser = transparency checker, wall = grid

/** dot dither: dark dots on one phase, light dots on the other. */
const dots = (base: string, dark: string, light: string): CSSProperties => ({
  backgroundColor: base,
  backgroundImage: `radial-gradient(${dark} 1px, transparent 1px), radial-gradient(${light} 1px, transparent 1px)`,
  backgroundSize: '4px 4px',
  backgroundPosition: '0 0, 2px 2px',
})

/** horizontal liquid band. */
const band = (base: string, dark: string): CSSProperties => ({
  backgroundColor: base,
  backgroundImage: `linear-gradient(0deg, ${dark} 50%, transparent 50%)`,
  backgroundSize: '6px 4px',
})

/** 1px crosshatch grid (stone / wall). */
const grid = (base: string, dark: string, light: string): CSSProperties => ({
  backgroundColor: base,
  backgroundImage: `linear-gradient(0deg, ${dark} 1px, transparent 1px), linear-gradient(90deg, ${light} 1px, transparent 1px)`,
  backgroundSize: '6px 6px',
})

/** two-phase checker (eraser / ice / lava glow). */
const checker = (base: string, a: string, b: string, size = 6): CSSProperties => ({
  backgroundColor: base,
  backgroundImage: `linear-gradient(45deg, ${a} 25%, transparent 25% 75%, ${a} 75%), linear-gradient(45deg, ${b} 25%, transparent 25% 75%, ${b} 75%)`,
  backgroundSize: `${size}px ${size}px`,
  backgroundPosition: `0 0, ${size / 2}px ${size / 2}px`,
})

export const CHIP_STYLES: Record<number, CSSProperties> = {
  [Mat.EMPTY]: checker('rgb(30,33,38)', 'rgb(48,52,58)', 'rgb(48,52,58)'),
  [Mat.WALL]: grid('rgb(120,122,130)', 'rgb(96,98,106)', 'rgb(140,142,150)'),
  // magnet: red poles with steel banding — reads as a horseshoe magnet's stripe.
  [Mat.MAGNET]: band('rgb(196,72,84)', 'rgb(150,40,52)'),

  [Mat.SAND]: dots('rgb(196,180,120)', 'rgb(168,152,94)', 'rgb(216,202,150)'),
  [Mat.GUNPOWDER]: dots('rgb(70,68,78)', 'rgb(40,38,46)', 'rgb(108,106,116)'),
  [Mat.FILINGS]: dots('rgb(120,122,132)', 'rgb(80,82,92)', 'rgb(154,156,166)'),

  [Mat.WATER]: band('rgb(54,108,200)', 'rgb(38,84,170)'),
  [Mat.OIL]: band('rgb(78,66,44)', 'rgb(60,50,32)'),
  [Mat.ACID]: dots('rgb(120,214,70)', 'rgb(96,180,52)', 'rgb(150,238,100)'),
  [Mat.LAVA]: checker('rgb(180,70,20)', 'rgb(255,180,80)', 'rgb(255,110,30)'),

  [Mat.STONE]: grid('rgb(98,98,106)', 'rgb(78,78,86)', 'rgb(118,118,126)'),
  [Mat.METAL]: grid('rgb(158,160,172)', 'rgb(120,122,134)', 'rgb(196,198,210)'),
  [Mat.WOOD]: {
    backgroundColor: 'rgb(112,74,42)',
    backgroundImage: 'linear-gradient(90deg, rgb(92,60,34) 50%, transparent 50%)',
    backgroundSize: '3px 6px',
  },
  [Mat.PLANT]: dots('rgb(46,160,60)', 'rgb(30,128,42)', 'rgb(70,200,84)'),
  [Mat.ICE]: checker('rgb(170,210,235)', 'rgb(150,190,220)', 'rgb(200,230,250)'),
  // glass: pale pane with a soft diagonal sheen — lighter, smoother than ice.
  [Mat.GLASS]: checker('rgb(200,225,235)', 'rgb(182,210,222)', 'rgb(224,240,248)'),

  [Mat.FIRE]: {
    backgroundColor: 'rgb(200,100,20)',
    backgroundImage:
      'linear-gradient(0deg, rgb(255,200,80) 33%, transparent 33% 66%, rgb(255,110,30) 66%)',
    backgroundSize: '6px 9px',
  },
  [Mat.LIGHTNING]: checker('rgb(120,150,230)', 'rgb(235,245,255)', 'rgb(150,180,255)'),
  [Mat.SMOKE]: dots('rgb(90,90,96)', 'rgb(72,72,78)', 'rgb(108,108,114)'),
  [Mat.STEAM]: dots('rgb(205,210,220)', 'rgb(185,190,200)', 'rgb(225,230,240)'),
}
