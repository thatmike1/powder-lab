import { useEffect, useMemo, useRef } from 'react'
import { CloseIcon } from './pixel-icons'
import { Mat } from './sim/materials'
import { PRESETS, type Preset } from './sim/presets'

// thumbnail colors per material — a flat readout of the grid, close to how the
// board paints each material so a card reads like a tiny screenshot. EMPTY uses
// the board's near-black so thumbnails sit on the same ground as the canvas.
const BG: [number, number, number] = [10, 10, 12]
const THUMB: Record<number, [number, number, number]> = {
  [Mat.WALL]: [120, 122, 130],
  [Mat.SAND]: [196, 180, 120],
  [Mat.WATER]: [54, 108, 200],
  [Mat.STONE]: [98, 98, 106],
  [Mat.WOOD]: [112, 74, 42],
  [Mat.FIRE]: [255, 156, 48],
  [Mat.SMOKE]: [92, 92, 98],
  [Mat.STEAM]: [205, 210, 220],
  [Mat.OIL]: [78, 66, 44],
  [Mat.LAVA]: [255, 126, 42],
  [Mat.ACID]: [128, 222, 78],
  [Mat.PLANT]: [46, 160, 60],
  [Mat.GUNPOWDER]: [70, 68, 78],
  [Mat.ICE]: [176, 216, 240],
  [Mat.LIGHTNING]: [200, 214, 255],
  [Mat.METAL]: [168, 170, 182],
  [Mat.FILINGS]: [120, 122, 132],
  [Mat.GLASS]: [196, 222, 234],
}

/** rasterize a preset's grid to a data-URL once, so cards are plain <img>s. */
function renderThumb(preset: Preset, W: number, H: number): string {
  const cells = preset.build(W, H)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(W, H)
  const d = img.data
  for (let i = 0; i < cells.length; i++) {
    const [r, g, b] = THUMB[cells[i]] ?? BG
    const o = i << 2
    d[o] = r
    d[o + 1] = g
    d[o + 2] = b
    d[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

const GROUPS: { key: Preset['group']; title: string }[] = [
  { key: 'contraption', title: 'Contraptions' },
  { key: 'painting', title: 'Paintings' },
]

interface GalleryProps {
  open: boolean
  onClose: () => void
  /** load a scene's grid with its preferred lighting. */
  onPick: (cells: Uint8Array, light: { light: boolean; darkness: number }) => void
  W: number
  H: number
}

/**
 * a slide-out drawer of ready-made scenes. it shares the pixel-native chrome:
 * hard bevels, marching accent marquee on the focused card, dithered nothing —
 * the thumbnails carry the color. picking a scene loads it (paused) and closes.
 */
export function Gallery({ open, onClose, onPick, W, H }: GalleryProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // remember what to return focus to when the drawer closes.
  const returnFocus = useRef<HTMLElement | null>(null)

  // thumbnails are deterministic; build them once for the lifetime of the app.
  const thumbs = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of PRESETS) map.set(p.id, renderThumb(p, W, H))
    return map
  }, [W, H])

  // manage focus + keep the off-screen drawer out of the tab order while closed.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    panel.inert = !open
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null
      // focus the first card so keyboard users land inside the drawer.
      // preventScroll: the panel is mid-transform, and a focus-driven
      // scrollIntoView would yank the whole window and stutter the slide-in.
      const first = panel.querySelector<HTMLElement>('.scene-card')
      first?.focus({ preventScroll: true })
    } else {
      returnFocus.current?.focus({ preventScroll: true })
    }
  }, [open])

  // ESC to close; Tab cycles within the drawer (a light focus trap).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = panel.querySelectorAll<HTMLElement>(
        'button, a, input, [tabindex]:not([tabindex="-1"])',
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pick = (p: Preset) => {
    onPick(p.build(W, H), p.light)
    onClose()
  }

  return (
    <>
      <button
        type="button"
        className={`drawer-scrim${open ? ' open' : ''}`}
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Scene gallery"
      >
        <header className="drawer-head">
          <h2 className="drawer-title">GALLERY</h2>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close gallery"
          >
            <CloseIcon size={14} />
          </button>
        </header>
        <p className="drawer-sub">
          load a scene, then hit <b>play</b> to bring it to life
        </p>

        <div className="drawer-scroll">
          {GROUPS.map((group) => {
            const items = PRESETS.filter((p) => p.group === group.key)
            return (
              <section key={group.key} className="scene-group">
                <div className="scene-ghead">
                  {group.title}
                  <span className="scene-count">{items.length}</span>
                </div>
                <div className="scene-grid">
                  {items.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="scene-card"
                      onClick={() => pick(p)}
                      title={p.blurb}
                    >
                      <span className="scene-thumb">
                        <img src={thumbs.get(p.id)} alt={`${p.name} scene preview`} />
                        <span className="scene-tag">{p.tag}</span>
                      </span>
                      <span className="scene-name">{p.name}</span>
                      <span className="scene-blurb">{p.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}
