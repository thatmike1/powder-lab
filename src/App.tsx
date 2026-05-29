import { CATEGORIES, PALETTE } from './sim/materials'
import { useSimulation } from './useSimulation'

// Grid resolution and on-screen scale. 200x150 cells @ 4px = an 800x600 canvas.
const W = 200
const H = 150
const SCALE = 4

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
    setDarkness,
    stepOnce,
    clear,
  } = useSimulation(W, H, SCALE)

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Powder Lab <span className="flask">⚗️</span>
        </h1>
        <p className="tagline">a falling-sand sandbox — paint materials, watch them react</p>
      </header>

      <div className="layout">
        <aside className="sidebar">
          {CATEGORIES.map((cat) => (
            <section key={cat} className="group">
              <h2>{cat}</h2>
              <div className="swatches">
                {PALETTE.filter((p) => p.cat === cat).map((p) => {
                  const active = ui.material === p.id
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={`swatch${active ? ' active' : ''}`}
                      onClick={() => setMaterial(p.id)}
                      title={`${p.name}${p.key ? ` (${p.key})` : ''}`}
                    >
                      <span
                        className="dot"
                        style={{ background: `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})` }}
                      />
                      <span className="label">{p.name}</span>
                      {p.key && <kbd>{p.key}</kbd>}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </aside>

        <main className="stage">
          <canvas ref={canvasRef} width={W * SCALE} height={H * SCALE} className="sim" />
          <div className="hud">
            <span>{ui.fps} fps</span>
            <span>{ui.count.toLocaleString()} particles</span>
            <span className="hint">
              drag to draw · right-click to erase · space = pause · C = clear · G = glow · L = light
            </span>
          </div>
        </main>
      </div>

      <footer className="controls">
        <button type="button" className="ctl primary" onClick={toggleRunning}>
          {ui.running ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className="ctl" onClick={stepOnce} disabled={ui.running}>
          ⏭ Step
        </button>
        <button type="button" className="ctl" onClick={clear}>
          🗑 Clear
        </button>

        <label className="slider">
          Brush
          <input
            type="range"
            min={1}
            max={40}
            value={ui.brush}
            onChange={(e) => setBrush(Number(e.target.value))}
          />
          <span className="val">{ui.brush}</span>
        </label>

        <label className="slider">
          Speed
          <input
            type="range"
            min={1}
            max={6}
            value={ui.speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span className="val">{ui.speed}×</span>
        </label>

        <button type="button" className={`ctl toggle${ui.glow ? ' on' : ''}`} onClick={toggleGlow}>
          ✨ Glow {ui.glow ? 'on' : 'off'}
        </button>

        <button
          type="button"
          className={`ctl toggle${ui.light ? ' on' : ''}`}
          onClick={toggleLight}
        >
          💡 Light {ui.light ? 'on' : 'off'}
        </button>

        <label className="slider">
          Darkness
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(ui.darkness * 100)}
            disabled={!ui.light}
            onChange={(e) => setDarkness(Number(e.target.value) / 100)}
          />
          <span className="val">{Math.round(ui.darkness * 100)}</span>
        </label>
      </footer>
    </div>
  )
}
