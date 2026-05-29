// generates a hand-composed Powder Lab scene and prints shareable links.
// mirrors src/sim/scene.ts encoding (RLE + base64url) so the output drops
// straight into the app's "#s=" hash. run: node scripts/make-scene.mjs

const W = 200
const H = 150

const M = {
  EMPTY: 0, WALL: 1, SAND: 2, WATER: 3, STONE: 4, WOOD: 5, FIRE: 6,
  SMOKE: 7, STEAM: 8, OIL: 9, LAVA: 10, ACID: 11, PLANT: 12, GUNPOWDER: 13, ICE: 14,
}

const cells = new Uint8Array(W * H)
const idx = (x, y) => y * W + x
const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H
const set = (x, y, m) => { if (inb(x, y)) cells[idx(x, y)] = m }
const get = (x, y) => (inb(x, y) ? cells[idx(x, y)] : -1)

function rect(x0, y0, x1, y1, m) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, m)
}
function disc(cx, cy, r, m, prob = 1) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r && (prob >= 1 || rnd() < prob)) set(x, y, m)
    }
}

// seeded LCG so the generated link is stable across runs.
let seed = 20260530
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

// ----------------------------------------------------------------------------
// composition: a glowing volcano above a calm lake, framed by a dark cavern.
// left: a small tree on a hill beside a blue lake. center-right: a stone
// volcano with a molten crater, a lava stream down its flank, an ember/smoke
// plume, and steam where the lava nears the water.
// ----------------------------------------------------------------------------

const G0 = 120          // base ground level
const APEX_X = 138      // volcano centre
const APEX_Y = 30       // crater rim height
const SLOPE = (G0 - APEX_Y) / 56

// surface height of the solid terrain at column x (smaller y = higher).
function terrainTop(x) {
  // volcano cone
  let top = Math.round(APEX_Y + SLOPE * Math.abs(x - APEX_X))
  top = Math.min(G0, top)
  // gentle left hill where the tree sits
  if (x < 26) top = Math.min(top, 112 - Math.round(6 * Math.cos((x / 26) * Math.PI)))
  // lake basin: smooth bowl dipping below the waterline
  if (x >= 24 && x <= 78) {
    const t = (x - 51) / 27 // -1..1 across the bowl
    const bowl = 132 + Math.round(14 * (1 - t * t))
    top = Math.max(top, bowl)
  }
  return top
}

// 1) fill solid terrain (stone) with a thin dirt/sand crust on the surface.
for (let x = 0; x < W; x++) {
  const top = terrainTop(x)
  for (let y = top; y < H; y++) {
    // a little jagged grain on the very surface
    if (y === top && rnd() < 0.25) continue
    set(x, y, M.STONE)
  }
}

// 2) the lake — water poured into the basin up to the waterline.
const WATER_LEVEL = 126
for (let x = 22; x <= 80; x++) {
  for (let y = WATER_LEVEL; y < H; y++) {
    if (get(x, y) === M.EMPTY) set(x, y, M.WATER)
  }
}
// sandy beach on the lake's right shore and lakebed lip
for (let x = 70; x <= 92; x++) {
  const top = terrainTop(x)
  for (let y = top; y < top + 4; y++) if (get(x, y) === M.STONE) set(x, y, M.SAND)
}
// a soft sand bar under the shallows
for (let x = 60; x <= 80; x++) {
  for (let y = 138; y < H; y++) if (get(x, y) === M.WATER && rnd() < 0.5) set(x, y, M.SAND)
}

// 3) carve a CONCAVE crater bowl and pool lava inside it (not a tower).
//    lop the stone tip, hollow a parabolic bowl, then flood lava to a flat
//    surface so it reads as molten lava sitting in a depression. the right
//    rim sits lower than the left, giving the lava a natural spillway.
const CR = 13          // crater half-width
const LAVA_TOP = 42    // flat lava surface level inside the bowl
let spillX = APEX_X + CR - 2
for (let dx = -CR; dx <= CR; dx++) {
  const x = APEX_X + dx
  const t = dx / CR
  const rimY = Math.round(36 + (dx > 0 ? 8 * t : 1.5 * -t)) // right rim lower
  const floorY = Math.round(64 - (64 - rimY) * t * t)       // parabolic bowl
  for (let y = APEX_Y - 6; y < rimY; y++) set(x, y, M.EMPTY) // lop the tip
  for (let y = rimY; y <= floorY; y++) set(x, y, M.EMPTY)    // hollow the bowl
  for (let y = Math.max(LAVA_TOP, rimY); y <= floorY; y++) set(x, y, M.LAVA)
}

// 4) lava overflowing the right rim, wandering down the flank to a pool.
let sx = spillX
let sy = LAVA_TOP + 1
while (sy < 119 && sx < W - 3) {
  sy += 1
  if (rnd() < 0.5) sx += 1
  if (rnd() < 0.14) sx += 1
  const surf = terrainTop(sx)
  if (sy < surf - 1) sy = surf - 1 // hug the cone surface as it descends
  const w = 1 + Math.floor((sy - LAVA_TOP) / 30)
  for (let k = -w; k <= w; k++) if (rnd() < 0.92) set(sx + k, sy, M.LAVA)
  if (rnd() < 0.18) set(sx + (rnd() < 0.5 ? -w - 1 : w + 1), sy, M.LAVA) // spatter
}
// glowing pool where the stream lands at the foot of the flank
disc(sx, sy + 3, 11, M.LAVA)
rect(sx - 13, sy, Math.min(W - 1, sx + 13), sy + 9, M.LAVA)

// 5) ember plume + smoke column rising from the crater.
for (let i = 0; i < 55; i++) {
  const y = LAVA_TOP - 1 - Math.floor(rnd() * 9) // hug the lava surface
  const x = APEX_X + Math.round((rnd() - 0.5) * 16)
  if (get(x, y) === M.EMPTY) set(x, y, M.FIRE)
}
for (let y = APEX_Y - 4; y > 3; y -= 1) {
  const drift = Math.round((APEX_Y - y) * 0.4)       // plume leans on the wind
  const spread = 3 + Math.floor((APEX_Y - y) * 0.22) // and widens as it rises
  for (let k = 0; k < 5; k++) {
    const x = APEX_X - drift + Math.round((rnd() - 0.5) * spread * 2)
    if (rnd() < 0.82 && get(x, y) === M.EMPTY) set(x, y, M.SMOKE)
  }
}

// 6) steam where the lava flank pool meets the cooler air above the beach.
for (let i = 0; i < 70; i++) {
  const x = 176 + Math.round((rnd() - 0.5) * 22)
  const y = 112 - Math.floor(rnd() * 16)
  if (get(x, y) === M.EMPTY) set(x, y, M.STEAM)
}

// 7) the tree on the left hill: a wood trunk with a leafy plant canopy.
const treeX = 12
const groundAtTree = terrainTop(treeX)
rect(treeX - 1, groundAtTree - 18, treeX + 1, groundAtTree - 1, M.WOOD) // trunk
// a couple of branches
rect(treeX + 1, groundAtTree - 12, treeX + 4, groundAtTree - 11, M.WOOD)
rect(treeX - 4, groundAtTree - 15, treeX - 1, groundAtTree - 14, M.WOOD)
disc(treeX, groundAtTree - 22, 9, M.PLANT, 0.92)   // canopy
disc(treeX + 6, groundAtTree - 18, 5, M.PLANT, 0.9)
disc(treeX - 6, groundAtTree - 17, 4, M.PLANT, 0.9)

// 8) frost/ice accents: a frozen rim on the shaded left shore for cool contrast.
for (let x = 20; x <= 30; x++) {
  for (let y = WATER_LEVEL - 1; y <= WATER_LEVEL + 1; y++) {
    if (get(x, y) === M.WATER && rnd() < 0.8) set(x, y, M.ICE)
  }
}
disc(26, 124, 3, M.ICE, 0.8)

// 9) SAND — a wind-piled dune draped over the volcano's foot, a smaller mound
//    on the lake's far shore, and a thin sand-fall pouring in from above
//    (powder caught mid-stream; it rains onto the dune the moment you press play).
//    drape: lay sand from a smooth hill line down until it meets solid ground,
//    never burying the water.
function drape(xc, halfW, peakY, baseY) {
  for (let x = xc - halfW; x <= xc + halfW; x++) {
    const t = (x - xc) / halfW
    const topY = Math.round(peakY + (baseY - peakY) * t * t)
    for (let y = topY; y <= baseY; y++) {
      const c = get(x, y)
      if (c === M.WATER || c === M.ICE) break
      if (c === M.EMPTY || c === M.STONE) set(x, y, M.SAND)
    }
  }
}
drape(98, 26, 99, 124)  // main dune banked against the volcano
drape(150, 15, 112, 123) // talus mound on the right shoulder

// the sand-fall: a rocky overhang at the top edge with sand spilling off its
// lip in a gently wavering column onto the dune below.
rect(82, 0, 95, 3, M.STONE)        // outcrop hanging from the ceiling
rect(85, 3, 92, 4, M.SAND)         // sand perched on the lip, about to pour
for (let y = 5; y < 96; y++) {
  const x = 88 + Math.round(Math.sin(y * 0.22) * 1.5)
  for (let k = 0; k < 2; k++) if (get(x + k, y) === M.EMPTY) set(x + k, y, M.SAND)
  if (rnd() < 0.3 && get(x - 1, y) === M.EMPTY) set(x - 1, y, M.SAND)
}

// ----------------------------------------------------------------------------
// encode exactly like src/sim/scene.ts (RLE + LEB128, PL header, base64url).
// ----------------------------------------------------------------------------
function encodeRLE(cells, W, H) {
  const out = [0x50, 0x4c, 1, W & 0xff, (W >> 8) & 0xff, H & 0xff, (H >> 8) & 0xff]
  const n = cells.length
  let i = 0
  while (i < n) {
    const mat = cells[i]
    let run = 1
    while (i + run < n && cells[i + run] === mat) run++
    out.push(mat)
    let v = run
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7 }
    out.push(v)
    i += run
  }
  return Uint8Array.from(out)
}
function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const hash = '#s=' + bytesToBase64Url(encodeRLE(cells, W, H))
console.log('HASH_LEN', hash.length)
console.log('LOCAL  http://localhost:5173/' + hash)
console.log('LIVE   https://thatmike1.github.io/powder-lab/' + hash)
console.log(hash)
