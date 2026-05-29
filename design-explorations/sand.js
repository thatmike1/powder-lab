// shared minimal falling-sand animation for the design explorations.
// NOT the real engine — just enough motion + glow that every mock feels alive,
// so the only thing differing between lanes is the chrome around it.
//
// contract: each lane page includes this file, then calls
//   mountSand(document.getElementById('sim'))
// the canvas is sized internally to 160x120 (4:3); scale it up with CSS and
// `image-rendering: pixelated` for crisp pixels. emissive cells (fire/lava)
// glow on their own; lanes can add CSS bloom on top.
;(() => {
  const EMPTY = 0
  const SAND = 1
  const WATER = 2
  const LAVA = 3
  const FIRE = 4
  const STONE = 5
  const WALL = 6

  // real Powder Lab swatch colors so the sim reads as the actual app
  const COLORS = {
    [SAND]: [196, 180, 120],
    [WATER]: [54, 108, 200],
    [LAVA]: [255, 110, 30],
    [FIRE]: [255, 150, 40],
    [STONE]: [98, 98, 106],
    [WALL]: [120, 122, 130],
  }

  function mountSand(canvas) {
    const W = 160
    const H = 120
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(W, H)
    const buf = new Uint32Array(img.data.buffer)
    const cells = new Uint8Array(W * H)
    const life = new Uint8Array(W * H)
    let frame = 0

    const idx = (x, y) => y * W + x
    const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H

    function seed() {
      cells.fill(0)
      life.fill(0)
      // floor
      for (let x = 0; x < W; x++) {
        cells[idx(x, H - 1)] = WALL
        cells[idx(x, H - 2)] = WALL
      }
      // a stone ledge for powders to pile on
      const ly = Math.floor(H * 0.6)
      for (let x = Math.floor(W * 0.12); x < Math.floor(W * 0.46); x++) cells[idx(x, ly)] = STONE
      // lava pool, bottom-right
      for (let y = H - 6; y < H - 2; y++)
        for (let x = Math.floor(W * 0.58); x < Math.floor(W * 0.92); x++) cells[idx(x, y)] = LAVA
    }

    function spawn() {
      if (frame % 2 === 0) {
        const x = Math.floor(W * 0.27)
        if (cells[idx(x, 2)] === EMPTY) cells[idx(x, 2)] = SAND
      }
      if (frame % 3 === 0) {
        const x = Math.floor(W * 0.5)
        if (cells[idx(x, 2)] === EMPTY) cells[idx(x, 2)] = WATER
      }
      // fire licks up off the lava
      if (frame % 4 === 0) {
        const x = Math.floor(W * 0.6 + (frame % 11))
        const y = H - 7
        if (inb(x, y) && cells[idx(x, y)] === EMPTY) {
          cells[idx(x, y)] = FIRE
          life[idx(x, y)] = 22 + (frame % 16)
        }
      }
    }

    function step() {
      const dir = frame % 2 ? 1 : -1
      for (let y = H - 2; y >= 0; y--) {
        for (let k = 0; k < W; k++) {
          const x = dir > 0 ? k : W - 1 - k
          const i = idx(x, y)
          const m = cells[i]
          if (m === EMPTY || m === STONE || m === WALL) continue

          if (m === FIRE) {
            if (--life[i] <= 0) {
              cells[i] = EMPTY
              continue
            }
            const up = idx(x, y - 1)
            if (y > 0 && cells[up] === EMPTY && Math.random() < 0.72) {
              cells[up] = FIRE
              life[up] = life[i]
              cells[i] = EMPTY
            }
            continue
          }

          const below = idx(x, y + 1)
          if (y + 1 < H && cells[below] === EMPTY) {
            cells[below] = m
            cells[i] = EMPTY
            continue
          }
          // sand sinks through water
          if (m === SAND && y + 1 < H && cells[below] === WATER) {
            cells[below] = SAND
            cells[i] = WATER
            continue
          }
          // diagonal slide
          const d = Math.random() < 0.5 ? -1 : 1
          let moved = false
          for (const dx of [d, -d]) {
            const nx = x + dx
            if (inb(nx, y + 1) && cells[idx(nx, y + 1)] === EMPTY) {
              cells[idx(nx, y + 1)] = m
              cells[i] = EMPTY
              moved = true
              break
            }
          }
          if (moved) continue
          // liquids spread sideways
          if (m === WATER || m === LAVA) {
            for (const dx of [d, -d]) {
              const nx = x + dx
              if (inb(nx, y) && cells[idx(nx, y)] === EMPTY) {
                cells[idx(nx, y)] = m
                cells[i] = EMPTY
                break
              }
            }
          }
        }
      }
    }

    function render() {
      for (let i = 0; i < W * H; i++) {
        const m = cells[i]
        let r = 9
        let g = 11
        let b = 16 // background tint (lanes paint over the element bg anyway)
        if (m) {
          if (m === FIRE) {
            const f = 0.6 + Math.random() * 0.4
            r = 255 * f
            g = (120 + Math.random() * 60) * f
            b = 20 * f
          } else if (m === LAVA) {
            const f = 0.85 + Math.sin((frame + i) * 0.08) * 0.15
            r = 255 * f
            g = 110 * f
            b = 30 * f
          } else {
            const c = COLORS[m]
            const n = (((i * 2654435761) >>> 0) % 24) - 12
            r = c[0] + n
            g = c[1] + n
            b = c[2] + n
          }
        }
        buf[i] = (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)
      }
      ctx.putImageData(img, 0, 0)
    }

    seed()
    function loop() {
      frame++
      spawn()
      step()
      render()
      if (frame % 760 === 0) seed() // never let it fully settle
      requestAnimationFrame(loop)
    }
    loop()
  }

  window.mountSand = mountSand
})()
