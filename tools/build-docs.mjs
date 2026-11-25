// Generates every image used by the README from the same source code the
// web demo runs. Usage: node tools/build-docs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERRAINS } from '../src/terrains.js';
import { TILE, generateAtlas, atlasRect, cornerField, terrainField, edgeData } from '../src/tilegen.js';
import { TileMap, renderTerrain, renderSize, decorations, generateIsland, cornerMask } from '../src/dualgrid.js';
import { buildSprites } from '../src/sprites.js';
import * as R from './raster.mjs';

const T = TILE;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/images');
fs.mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n);

console.time('atlases');
const atlases = TERRAINS.map((t) => generateAtlas(t));
console.timeEnd('atlases');
const sprites = buildSprites();
const BG = [13, 18, 32];
const WHITE = [255, 255, 255];
const ORANGE = [255, 179, 71];
const CYAN = [111, 211, 255];

/** Render a map to an RGBA image. */
function render(map, { mode = 'dual', tick = 0, visible, decor = true } = {}) {
  const sz = renderSize(map);
  const im = R.img(sz.w, sz.h, [0, 0, 0]);
  renderTerrain(map, TERRAINS, { mode, tick, visible }, (L, sx, sy, dx, dy, w, h) => R.blit(im, atlases[L], sx, sy, dx, dy, w, h));
  if (decor)
    for (const d of decorations(map, TERRAINS)) {
      if (visible && !visible[d.layer]) continue;
      const s = sprites[d.sprite];
      R.blit(im, { width: s.w, height: s.h, data: s.data }, 0, 0, d.x - s.ax, d.y - s.ay, s.w, s.h);
    }
  return im;
}
function mapFrom(rows) {
  const m = new TileMap(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => (m.cells[y * m.w + x] = c === '.' ? 0 : Number(c))));
  return m;
}
function frame(images, gap = 12, bg = BG) {
  const w = images.reduce((a, b) => a + b.width, 0) + gap * (images.length + 1);
  const h = Math.max(...images.map((i) => i.height)) + gap * 2;
  const im = R.img(w, h, bg);
  let x = gap;
  for (const i of images) {
    R.blit(im, i, 0, 0, x, gap, i.width, i.height);
    x += i.width + gap;
  }
  return im;
}
function tileImage(L, mask, variant = 0, fr = 0, withWater = true) {
  const im = R.img(T, T, [0, 0, 0, 0]);
  if (withWater) {
    const r0 = atlasRect(15, variant, fr % TERRAINS[0].frames);
    R.blit(im, atlases[0], r0.sx, r0.sy, 0, 0, T, T);
  }
  const r = atlasRect(mask, variant, fr % (TERRAINS[L].frames || 1));
  R.blit(im, atlases[L], r.sx, r.sy, 0, 0, T, T);
  return im;
}

// ------------------------------------------------------------- 1. hero (animated)
{
  const map = generateIsland(new TileMap(26, 14), 9);
  const frames = [];
  for (let f = 0; f < 8; f++) frames.push(render(map, { tick: f }));
  R.writeAPNG(out('hero.png'), frames, 140);
  R.writePNG(out('hero-2x.png'), R.scale(R.crop(frames[0], 192, 96, 448, 256), 2));
}

// ------------------------------------------------------------- 2. raw vs dual
{
  const map = mapFrom([
    '..........',
    '..1111....',
    '.122221...',
    '.1233321..',
    '.12333211.',
    '..1222221.',
    '...11111..',
    '..........',
  ]);
  const a = R.scale(render(map, { mode: 'raw', decor: false }), 2);
  const b = R.scale(render(map, { mode: 'dual', decor: false }), 2);
  R.writePNG(out('raw-vs-dual.png'), frame([a, b], 16));
}

// ------------------------------------------------------------- 3. the two grids + masks
{
  const map = mapFrom(['.....', '.22..', '.222.', '..2..', '.....']);
  const S = 4;
  const im = R.scale(render(map, { decor: false }), S);
  const TS = T * S;
  // render grid (orange, solid) at multiples of T
  for (let i = 0; i <= map.w + 1; i++) {
    R.vline(im, i * TS, 0, im.height - 1, ORANGE);
    R.vline(im, i * TS - 1, 0, im.height - 1, ORANGE);
  }
  for (let j = 0; j <= map.h + 1; j++) {
    R.hline(im, 0, im.width - 1, j * TS, ORANGE);
    R.hline(im, 0, im.width - 1, j * TS - 1, ORANGE);
  }
  // data grid (white, dashed) offset by half a tile
  for (let i = 0; i <= map.w; i++) R.vline(im, i * TS + TS / 2, TS / 2, map.h * TS + TS / 2, WHITE, 6);
  for (let j = 0; j <= map.h; j++) R.hline(im, TS / 2, map.w * TS + TS / 2, j * TS + TS / 2, WHITE, 6);
  // data cell centers: dot filled when painted
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++) {
      const on = map.get(x, y) >= 2;
      R.disc(im, (x + 1) * TS, (y + 1) * TS, 9, [20, 24, 36]);
      R.disc(im, (x + 1) * TS, (y + 1) * TS, 7, on ? ORANGE : [70, 80, 100]);
    }
  // mask numbers per render tile
  for (let ry = 0; ry <= map.h; ry++)
    for (let rx = 0; rx <= map.w; rx++) {
      const m = cornerMask(map, rx, ry, 2);
      const s = String(m);
      const w = R.textWidth(s, 4);
      const cx = rx * TS + TS / 2 - w / 2, cy = ry * TS + TS / 2 - 10;
      R.fillRect(im, cx - 6, cy - 6, w + 12, 32, [0, 0, 0, 150]);
      R.text(im, s, cx, cy, m === 0 ? [150, 160, 180] : m === 15 ? [159, 230, 160] : [255, 210, 122], 4);
    }
  R.writePNG(out('grids.png'), im);
}

// ------------------------------------------------------------- 4. mask table (16 cases)
{
  const S = 4, TS = T * S, pad = 18, lab = 36;
  const cols = 8;
  const im = R.img(cols * (TS + pad) + pad, 2 * (TS + pad + lab) + pad, BG);
  for (let m = 0; m < 16; m++) {
    const cx = pad + (m % cols) * (TS + pad), cy = pad + Math.floor(m / cols) * (TS + pad + lab);
    const t = R.scale(tileImage(2, m), S);
    R.blit(im, t, 0, 0, cx, cy, TS, TS);
    R.strokeRect(im, cx - 1, cy - 1, TS + 2, TS + 2, [42, 53, 82]);
    const corners = [
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 4],
      [1, 1, 8],
    ];
    for (const [i, j, b] of corners) {
      const x = cx + i * TS, y = cy + j * TS;
      R.disc(im, x, y, 9, [20, 24, 36]);
      R.disc(im, x, y, 7, m & b ? ORANGE : [70, 80, 100]);
    }
    const s = String(m);
    R.text(im, s, cx + TS / 2 - R.textWidth(s, 4) / 2, cy + TS + 12, WHITE, 4);
  }
  R.writePNG(out('mask-table.png'), im);
}

// ------------------------------------------------------------- 5. all atlases
{
  const sheets = TERRAINS.map((t, L) => {
    const sheet = R.img(4 * T + 3 * 2, 4 * T + 3 * 2, [0, 0, 0, 0]);
    for (let m = 0; m < 16; m++) {
      const tile = tileImage(L, m, 0, 0, !t.base);
      R.blit(sheet, tile, 0, 0, (m & 3) * (T + 2), (m >> 2) * (T + 2), T, T);
    }
    return R.scale(sheet, 2);
  });
  R.writePNG(out('atlases.png'), frame(sheets, 16));
  // raw atlas file of one terrain (as it exists in memory)
  R.writePNG(out('atlas-grass-raw.png'), atlases[2]);
}

// ------------------------------------------------------------- 6. variants: repetition vs variety
{
  const map = mapFrom(['........', '.222222.', '.222222.', '.222222.', '.222222.', '........']);
  const noVar = render(map, { decor: false });
  // re-render forcing variant 0
  const sz = renderSize(map);
  const im0 = R.img(sz.w, sz.h, [0, 0, 0]);
  renderTerrain(map, TERRAINS, { mode: 'dual' }, (L, sx, sy, dx, dy, w, h) => {
    const s = sx % (4 * T); // strip the variant offset -> always variant 0
    R.blit(im0, atlases[L], s, sy, dx, dy, w, h);
  });
  R.writePNG(out('variants.png'), frame([R.scale(im0, 2), R.scale(noVar, 2)], 16));
  // the four variants of mask 15 + mask 7 side by side
  const tiles = [];
  for (let v = 0; v < 4; v++) tiles.push(R.scale(tileImage(2, 15, v), 4));
  R.writePNG(out('variant-tiles.png'), frame(tiles, 12));
}

// ------------------------------------------------------------- 7. tile painting pipeline
{
  const L = 4; // stone: has lip, rim, shadow
  const t = TERRAINS[L];
  const mask = 1 | 2 | 4; // three corners filled -> inner corner
  const S = 6;
  const panel = (fn) => {
    const im = R.img(T, T, [0, 0, 0]);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) R.pset(im, x, y, fn(x, y));
    return R.scale(im, S);
  };
  const e = edgeData(t, mask, 0);
  const gray = (v) => {
    const g = Math.max(0, Math.min(255, v * 255));
    return [g, g, g];
  };
  const p1 = panel((x, y) => gray(cornerField(mask, (x + 0.5) / T, (y + 0.5) / T)));
  const p2 = panel((x, y) => gray(terrainField(t, mask, 0, x, y) + 0.5 + t.bias));
  const p3 = panel((x, y) => (e.f[y * T + x] > 0 ? [230, 230, 230] : [30, 34, 46]));
  const p4 = panel((x, y) => {
    const d = e.d[y * T + x];
    const band = Math.floor(Math.abs(d) / 2) % 2 === 0;
    if (d > 0) return band ? [255, 196, 102] : [214, 140, 52];
    return band ? [96, 170, 230] : [56, 110, 180];
  });
  const p5 = panel((x, y) => {
    const i = y * T + x, d = e.d[i], nx = e.nx[i], ny = e.ny[i];
    if (d <= 0) return -(nx * 0.45 + ny * 0.89) > 0.15 && d > -6 ? [70, 40, 120] : [30, 34, 46];
    if (d < 1.1) return [10, 10, 10];
    if (-ny > 0.25 && d < 1.1 + 8 * Math.min(1, (-ny - 0.25) * 2.2)) return [180, 90, 60];
    if (d < 2.6 && nx * 0.6 + ny * 0.8 > 0.35) return [255, 250, 200];
    return [120, 130, 150];
  });
  const p6 = R.scale(tileImage(L, mask), S);
  R.writePNG(out('pipeline.png'), frame([p1, p2, p3, p4, p5, p6], 14));
}

// ------------------------------------------------------------- 8. layer build-up
{
  const map = mapFrom([
    '............',
    '..11111111..',
    '.1222222221.',
    '.1233334421.',
    '.1233445521.',
    '.1223345421.',
    '..122222211.',
    '...111111...',
    '............',
  ]);
  const panels = [];
  for (let k = 0; k < TERRAINS.length; k++) {
    const visible = TERRAINS.map((_, i) => i <= k);
    panels.push(render(map, { visible }));
  }
  // two rows of three
  const row1 = frame(panels.slice(0, 3), 12);
  const row2 = frame(panels.slice(3), 12);
  const im = R.img(row1.width, row1.height + row2.height - 12, BG);
  R.blit(im, row1, 0, 0, 0, 0, row1.width, row1.height);
  R.blit(im, row2, 0, 0, 0, row1.height - 12, row2.width, row2.height);
  R.writePNG(out('layers.png'), im);
}

// ------------------------------------------------------------- 9. shoreline animation close-up
{
  const map = mapFrom(['......', '..11..', '.1221.', '.1221.', '..11..', '......']);
  const frames = [];
  for (let f = 0; f < 8; f++) frames.push(R.scale(render(map, { tick: f, decor: false }), 3));
  R.writeAPNG(out('shore.png'), frames, 150);
}

// ------------------------------------------------------------- 10. a single painted cell
{
  const map = mapFrom(['...', '.2.', '...']);
  const S = 5;
  const im = R.scale(render(map, { decor: false }), S);
  const TS = T * S;
  for (let i = 0; i <= 4; i++) {
    R.vline(im, i * TS, 0, im.height - 1, ORANGE);
    R.hline(im, 0, im.width - 1, i * TS, ORANGE);
  }
  R.strokeRect(im, TS + TS / 2, TS + TS / 2, TS, TS, WHITE, 3);
  for (const [rx, ry] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]) {
    const s = String(cornerMask(map, rx, ry, 2));
    R.text(im, s, rx * TS + 10, ry * TS + 10, ORANGE, 4, [0, 0, 0]);
  }
  R.writePNG(out('single-cell.png'), im);
}

// ------------------------------------------------------------- 11. sprites + favicon
{
  const sp = Object.values(sprites).map((s) => R.scale({ width: s.w, height: s.h, data: s.data }, 4));
  R.writePNG(out('sprites.png'), frame(sp, 14));
  R.writePNG(out('favicon.png'), tileImage(2, 6));
}

console.log('docs images written to', OUT);
