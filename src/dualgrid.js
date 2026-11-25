// The dual-grid core: data grid -> corner masks -> layered tile draws.
// Pure logic: drawing is done through a `blit` callback so the same code
// runs in the browser (canvas.drawImage) and in Node (RGBA buffers for docs).

import { TILE, VARIANTS, atlasRect } from './tilegen.js';
import { hash2, wfbm } from './noise.js';

export class TileMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h);
  }
  /** Cells outside the map read as 0 (the base terrain: water). */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.cells[y * this.w + x];
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    if (this.cells[i] === v) return false;
    this.cells[i] = v;
    return true;
  }
  clone() {
    const m = new TileMap(this.w, this.h);
    m.cells.set(this.cells);
    return m;
  }
}

/**
 * The heart of the technique.
 * Render tile (rx, ry) sits on the CORNER shared by 4 data cells:
 *   (rx-1, ry-1) TL=1   (rx, ry-1) TR=2
 *   (rx-1, ry  ) BL=4   (rx, ry  ) BR=8
 * For a layered terrain stack, a corner is "filled" for layer L when cell >= L.
 */
export function cornerMask(map, rx, ry, layer) {
  let m = 0;
  if (map.get(rx - 1, ry - 1) >= layer) m |= 1;
  if (map.get(rx, ry - 1) >= layer) m |= 2;
  if (map.get(rx - 1, ry) >= layer) m |= 4;
  if (map.get(rx, ry) >= layer) m |= 8;
  return m;
}

/** Stable per-position variant pick (variant 0 is a bit more common). */
export function variantAt(rx, ry, layer) {
  const h = hash2(rx, ry, 900 + layer * 7);
  return h < 0.4 ? 0 : 1 + Math.floor(((h - 0.4) / 0.6) * (VARIANTS - 1));
}

/**
 * Render size: (w+1) x (h+1) tiles — one more than the data grid in each axis,
 * because render tiles also sit on the outer corners of the map.
 * Render tile (rx, ry) is drawn at pixel (rx*TILE, ry*TILE).
 * Data cell (x, y) therefore has its center at pixel ((x+1)*TILE, (y+1)*TILE).
 */
export function renderSize(map) {
  return { w: (map.w + 1) * TILE, h: (map.h + 1) * TILE };
}

/**
 * Draw terrain.
 * opts.mode: 'dual' (dual-grid autotiling) or 'raw' (one square per data cell)
 * opts.visible: boolean per layer
 * opts.tick: animation counter
 * blit(layer, sx, sy, dx, dy, w, h): copy a TILE-sized (or w/h-sized) region of the layer atlas.
 * Returns number of tile draws.
 */
export function renderTerrain(map, terrains, opts, blit) {
  const T = TILE;
  const tick = opts.tick || 0;
  const visible = opts.visible || terrains.map(() => true);
  const frameOf = (t) => (t.frames > 1 ? tick % t.frames : 0);
  let draws = 0;

  if (opts.mode === 'raw') {
    // Naive approach: water everywhere, then one full tile per data cell.
    for (let ry = 0; ry <= map.h; ry++)
      for (let rx = 0; rx <= map.w; rx++) {
        if (!visible[0]) continue;
        const r = atlasRect(15, variantAt(rx, ry, 0), frameOf(terrains[0]));
        blit(0, r.sx, r.sy, rx * T, ry * T, T, T);
        draws++;
      }
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        let L = map.get(x, y);
        while (L > 0 && !visible[L]) L--;
        if (L === 0) continue;
        const r = atlasRect(15, variantAt(x, y, L), frameOf(terrains[L]));
        blit(L, r.sx, r.sy, x * T + T / 2, y * T + T / 2, T, T);
        draws++;
      }
    return draws;
  }

  for (let ry = 0; ry <= map.h; ry++) {
    for (let rx = 0; rx <= map.w; rx++) {
      // Optimisation: every layer <= min(corners) has mask 15 (fully opaque),
      // so we can start from the highest such visible layer.
      const mn = Math.min(map.get(rx - 1, ry - 1), map.get(rx, ry - 1), map.get(rx - 1, ry), map.get(rx, ry));
      let start = 0;
      for (let L = mn; L >= 0; L--)
        if (visible[L]) {
          start = L;
          break;
        }
      for (let L = start; L < terrains.length; L++) {
        if (!visible[L]) continue;
        const t = terrains[L];
        const mask = t.base ? 15 : cornerMask(map, rx, ry, L);
        if (mask === 0) continue; // nothing of this layer touches this corner
        const r = atlasRect(mask, variantAt(rx, ry, L), frameOf(t));
        blit(L, r.sx, r.sy, rx * T, ry * T, T, T);
        draws++;
      }
    }
  }
  return draws;
}

// ------------------------------------------------------------ decorations

const DECOR = {
  forest: { sprites: ['tree0', 'tree1', 'tree2'], chance: 0.8, max: 2 },
  stone: { sprites: ['rock0', 'rock1'], chance: 0.35, max: 1 },
  snow: { sprites: ['pine0', 'pine1'], chance: 0.4, max: 1, interior: true },
  grass: { sprites: ['bush0'], chance: 0.07, max: 1, interior: true },
};

/** Decorations anchored on data-cell centers, sorted by y for correct overlap. */
export function decorations(map, terrains) {
  const out = [];
  const T = TILE;
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const L = map.get(x, y);
      const d = DECOR[terrains[L].id];
      if (!d) continue;
      const nb = [map.get(x - 1, y), map.get(x + 1, y), map.get(x, y - 1), map.get(x, y + 1)];
      const inner = nb.every((n) => n >= L);
      if (d.interior && !inner) continue;
      if (hash2(x, y, 4242) > d.chance) continue;
      const count = inner ? 1 + (hash2(x, y, 4343) < 0.5 ? 0 : d.max - 1) : 1;
      const spread = inner ? 7 : 2;
      for (let k = 0; k < count; k++) {
        const jx = (hash2(x, y, 10 + k) - 0.5) * 2 * spread;
        const jy = (hash2(x, y, 20 + k) - 0.5) * 2 * spread + (count > 1 ? (k ? 5 : -4) : 0);
        const sp = d.sprites[Math.floor(hash2(x, y, 30 + k) * d.sprites.length)];
        out.push({ sprite: sp, x: Math.round((x + 1) * T + jx), y: Math.round((y + 1) * T + jy + 6), layer: L });
      }
    }
  out.sort((a, b) => a.y - b.y);
  return out;
}

// ------------------------------------------------------------ map generation

/** Island-ish heightmap -> terrain indices. */
export function generateIsland(map, seed = 1) {
  const { w, h } = map;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w - 0.5, ny = (y + 0.5) / h - 0.5;
      const r = Math.hypot(nx * 1.0, ny * 1.2) * 2; // 0 center, ~1 edge
      let e = wfbm(x / 8, y / 8, 4, seed) * 1.2 - r * 0.8 + 0.2;
      const moist = wfbm(x / 6 + 40, y / 6, 3, seed + 5);
      let t = 0;
      if (e > 0.12) t = 1;
      if (e > 0.2) t = 2;
      if (t === 2 && moist > 0.6) t = 3;
      if (e > 0.45) t = 4;
      if (e > 0.57) t = 5;
      map.cells[y * w + x] = t;
    }
  return map;
}
