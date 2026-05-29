import { useSimulation } from './useSimulation'
import { CATEGORIES, PALETTE } from './sim/materials'

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
              drag to draw · right-click to erase · space = pause · C = clear
            </span>
          </div>
        </main>
      </div>

      <footer className="controls">
        <button className="ctl primary" onClick={toggleRunning}>
          {ui.running ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="ctl" onClick={stepOnce} disabled={ui.running}>
          ⏭ Step
        </button>
        <button className="ctl" onClick={clear}>
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

        <button className={`ctl toggle${ui.glow ? ' on' : ''}`} onClick={toggleGlow}>
          ✨ Glow {ui.glow ? 'on' : 'off'}
        </button>
      </footer>
    </div>
  )
}
