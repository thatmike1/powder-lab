import { type CSSProperties, type ReactNode, useRef } from 'react'
import { CHIP_STYLES } from './chip-styles'
import {
  BrushIcon,
  ClearIcon,
  LoadIcon,
  PauseIcon,
  PlayIcon,
  SaveIcon,
  ShareIcon,
  StepIcon,
} from './pixel-icons'
import { CATEGORIES, PALETTE } from './sim/materials'
import { useSimulation } from './useSimulation'

// Grid resolution and on-screen scale. 200x150 cells @ 4px = an 800x600 canvas.
const W = 200
const H = 150
const SCALE = 4

const DEFAULT_ACCENT: [number, number, number] = [255, 110, 30] // lava

/**
 * derive the three accent CSS vars from a material's swatch rgb. this is the
 * signature move: the whole chrome re-tints to whatever you are painting with.
 * the return is cast to CSSProperties because CSS custom properties (`--accent`)
 * are not part of the typed style surface.
 */
function accentVars([r, g, b]: [number, number, number]): CSSProperties {
  const dk = (c: number) => Math.round(c * 0.55)
  const lt = (c: number) => Math.round(c + (255 - c) * 0.5)
  return {
    '--accent': `rgb(${r},${g},${b})`,
    '--accent-dk': `rgb(${dk(r)},${dk(g)},${dk(b)})`,
    '--accent-lt': `rgb(${lt(r)},${lt(g)},${lt(b)})`,
  } as CSSProperties
}

/** a lit pixel toggle switch (Glow / Light / Temp). */
function Toggle({
  label,
  on,
  onClick,
  title,
}: {
  label: string
  on: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      className={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={onClick}
      title={title}
    >
      <span className="led" aria-hidden="true" />
      <span className="tname">{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}

/**
 * a stepped/notched meter slider. the lit `<i>` bars are decorative; a
 * visually-hidden native range input laid over them owns the actual
 * drag/keyboard interaction so the control stays accessible.
 */
function Meter({
  icon,
  label,
  value,
  min,
  max,
  segments,
  lit,
  displayValue,
  onChange,
  speed = false,
  disabled = false,
  scaleLo,
  scaleHi,
  note,
}: {
  icon?: ReactNode
  label: string
  value: number
  min: number
  max: number
  segments: number
  lit: number
  displayValue: string
  onChange: (v: number) => void
  speed?: boolean
  disabled?: boolean
  scaleLo?: string
  scaleHi?: string
  note?: string
}) {
  return (
    <div className={`meter${disabled ? ' disabled' : ''}`}>
      <div className="meter-head">
        <span className="lbl">
          {icon}
          {label}
        </span>
        <span className="val">{displayValue}</span>
      </div>
      <div className="bars-wrap">
        <div className={`bars${speed ? ' speed' : ''}`} aria-hidden="true">
          {Array.from({ length: segments }, (_, k) => (
            <i key={k} className={k < lit ? 'on' : undefined} />
          ))}
        </div>
        <input
          className="bars-input"
          type="range"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="scale">
        {note ? (
          <span className="disabled-note">{note}</span>
        ) : (
          <>
            <span>{scaleLo}</span>
            <span>{scaleHi}</span>
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const {
    canvasRef,
    ui,
    setMaterial,
    setBrush,
    setSpeed,
    toggleRunning,
    toggleGlow,
    toggleLight,
    toggleTemp,
    setDarkness,
    stepOnce,
    clear,
    shareScene,
    saveScene,
    loadScene,
  } = useSimulation(W, H, SCALE)

  const fileRef = useRef<HTMLInputElement | null>(null)

  const activeRgb = PALETTE.find((p) => p.id === ui.material)?.rgb ?? DEFAULT_ACCENT
  const darknessPct = Math.round(ui.darkness * 100)

  return (
    <div className="app" style={accentVars(activeRgb)}>
      {/* ---- titlebar: wordmark + scene actions ---- */}
      <div className="titlebar">
        <span className="wordmark">
          POWDER&nbsp;<b>LAB</b>
        </span>
        <div className="winctl">
          <button
            type="button"
            onClick={shareScene}
            title="Copy a shareable link"
            aria-label="share"
          >
            <ShareIcon size={14} />
          </button>
          <button type="button" onClick={saveScene} title="Download as .powder" aria-label="save">
            <SaveIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Open a .powder file"
            aria-label="load"
          >
            <LoadIcon size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".powder"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadScene(file)
              e.target.value = '' // allow re-loading the same file
            }}
          />
        </div>
      </div>

      {/* ---- body: material rail | stage ---- */}
      <div className="body">
        <aside className="rail">
          {CATEGORIES.map((cat) => (
            <section key={cat} className="group">
              <div className="ghead">{cat}</div>
              <div className="swatch-grid">
                {PALETTE.filter((p) => p.cat === cat).map((p) => {
                  const active = ui.material === p.id
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={`tile${active ? ' active' : ''}`}
                      onClick={() => setMaterial(p.id)}
                      title={`${p.name}${p.key ? ` (${p.key})` : ''}`}
                      aria-pressed={active}
                    >
                      <span className="chip" style={CHIP_STYLES[p.id]} />
                      <span className="meta">
                        <span className="mname">{p.name}</span>
                        {p.key && <kbd>{p.key}</kbd>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </aside>

        <section className="stage">
          <div className="mat">
            <div className="hud">
              <span className="stat fps">
                <b>{ui.fps}</b> FPS
              </span>
              <span className="stat">
                <b>{ui.count.toLocaleString()}</b> PARTICLES
              </span>
            </div>

            <div className="canvas-frame">
              <canvas ref={canvasRef} width={W * SCALE} height={H * SCALE} className="sim" />
            </div>

            <p className="hint">
              drag to draw &middot; <b>right-click</b> to erase &middot; <b>space</b> pause &middot;{' '}
              <b>C</b> clear &middot; <b>G</b> glow &middot; <b>L</b> light &middot; <b>H</b>{' '}
              heatmap
            </p>
          </div>

          {/* ---- bottom control bar ---- */}
          <div className="toolbar">
            <div className="cluster">
              <button type="button" className="btn primary" onClick={toggleRunning}>
                {ui.running ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                {ui.running ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="btn icon-only"
                onClick={stepOnce}
                disabled={ui.running}
                title="Step one frame"
                aria-label="step"
              >
                <StepIcon size={18} />
              </button>
              <button type="button" className="btn" onClick={clear} title="Clear canvas">
                <ClearIcon size={18} />
                Clear
              </button>
            </div>

            <div className="divider" />

            <Meter
              icon={<BrushIcon size={12} />}
              label="Brush"
              value={ui.brush}
              min={1}
              max={40}
              segments={20}
              lit={Math.round(ui.brush / 2)}
              displayValue={String(ui.brush)}
              onChange={setBrush}
              scaleLo="1"
              scaleHi="40"
            />

            <Meter
              label="Speed"
              value={ui.speed}
              min={1}
              max={6}
              segments={6}
              lit={ui.speed}
              displayValue={`${ui.speed}×`}
              onChange={setSpeed}
              speed
              scaleLo="1×"
              scaleHi="6×"
            />

            <div className="divider" />

            <Toggle
              label="Glow"
              on={ui.glow}
              onClick={toggleGlow}
              title={`Glow ${ui.glow ? 'on' : 'off'}`}
            />
            <Toggle
              label="Light"
              on={ui.light}
              onClick={toggleLight}
              title={`Light ${ui.light ? 'on' : 'off'}`}
            />
            <Toggle
              label="Temp"
              on={ui.showTemp}
              onClick={toggleTemp}
              title={`Heatmap ${ui.showTemp ? 'on' : 'off'}`}
            />

            <Meter
              label="Darkness"
              value={darknessPct}
              min={0}
              max={100}
              segments={20}
              lit={Math.round(darknessPct / 5)}
              displayValue={String(darknessPct)}
              onChange={(v) => setDarkness(v / 100)}
              disabled={!ui.light}
              scaleLo="0"
              scaleHi="100"
              note={ui.light ? undefined : '— requires Light: ON'}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
