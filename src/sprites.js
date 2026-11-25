// Procedurally painted decoration sprites (trees, pines, boulders, bushes).
// Each sprite is an RGBA buffer with an anchor at its bottom-center ("feet").

import { hash2, pnoise, BAYER4 } from './noise.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function makeSprite(w, h, ax, ay) {
  return { w, h, ax, ay, data: new Uint8ClampedArray(w * h * 4) };
}
function put(s, x, y, c, a = 255) {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  s.data[i] = c[0];
  s.data[i + 1] = c[1];
  s.data[i + 2] = c[2];
  s.data[i + 3] = a;
}
function ramp(cols, t, b) {
  let i = Math.floor(t * cols.length + (b - 0.5) * 0.9);
  return cols[Math.max(0, Math.min(cols.length - 1, i))];
}
function shadowEllipse(s, cx, cy, rx, ry) {
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy < 1) put(s, x, y, [8, 18, 30], 90);
    }
}

/**
 * Paint a lumpy blob made of circles: outline, lit from top-left, dithered.
 * field(x,y) = max_i (r_i - |p - c_i|)
 */
function blob(s, circles, cols, outline, seed, opts = {}) {
  const f = (x, y) => {
    let best = -1e9, bc = null;
    for (const c of circles) {
      const v = c[2] - Math.hypot(x - c[0], y - c[1]);
      if (v > best) (best = v), (bc = c);
    }
    return [best, bc];
  };
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const [v, c] = f(x + 0.5, y + 0.5);
      if (v <= 0) continue;
      if (v < 1.05) {
        put(s, x, y, outline);
        continue;
      }
      const nx = (x + 0.5 - c[0]) / c[2], ny = (y + 0.5 - c[1]) / c[2];
      let t = 0.55 - (nx * 0.55 + ny * 0.75) * 0.55;
      t += (pnoise(x / 16, y / 16, 4, seed) - 0.5) * (opts.noise ?? 0.6);
      if (opts.leaf) {
        // leaf clusters: small bright arcs
        const h = hash2(x >> 2, y >> 2, seed + 9);
        if (h > 0.82 && (x & 3) === 1 && (y & 3) === 1) t += 0.35;
      }
      put(s, x, y, ramp(cols, t, BAYER4[(y & 3) * 4 + (x & 3)]));
    }
}

function rect(s, x0, y0, w, h, colFn) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(s, x, y, colFn(x - x0, y - y0));
}

// -------------------------------------------------------------------------

function makeTree(seed) {
  const s = makeSprite(28, 34, 14, 31);
  shadowEllipse(s, 15, 31, 10, 3.2);
  const bark = [hex('#3b2414'), hex('#5a3820'), hex('#7a4f2c')];
  rect(s, 12, 21, 4, 10, (x) => (x === 0 ? bark[0] : x === 3 ? bark[0] : x === 1 ? bark[2] : bark[1]));
  const j = (k) => (hash2(seed, k, 3) - 0.5) * 3;
  const circles = [
    [14 + j(1), 11 + j(2), 9.5],
    [8 + j(3), 16 + j(4), 6.5],
    [20 + j(5), 16 + j(6), 6.5],
    [14 + j(7), 18, 6.5],
  ];
  blob(s, circles, ['#14381f', '#1c4d29', '#256235', '#307741', '#3f8e4c', '#5aa85a'].map(hex), hex('#0a1f12'), 40 + seed, { leaf: true });
  return s;
}

function makePine(seed) {
  const s = makeSprite(22, 34, 11, 31);
  shadowEllipse(s, 12, 31, 8, 2.6);
  rect(s, 10, 26, 3, 5, (x) => (x === 1 ? hex('#6b4426') : hex('#3b2414')));
  const greens = ['#0f2f23', '#16402e', '#1f553b', '#2a6a48'].map(hex);
  const snow = ['#c6d6ec', '#e2ecf8', '#ffffff'].map(hex);
  const tiers = [
    [4, 13, 7],
    [10, 19, 9],
    [16, 27, 11],
  ];
  for (const [top, bottom, half] of tiers) {
    for (let y = top; y < bottom; y++) {
      const t = (y - top) / (bottom - top);
      const hw = Math.round(1 + t * (half - 1));
      for (let x = 11 - hw; x <= 11 + hw; x++) {
        const edge = x === 11 - hw || x === 11 + hw || y === bottom - 1;
        if (edge) {
          put(s, x, y, hex('#081a12'));
          continue;
        }
        const side = (x - 11) / hw;
        const b = BAYER4[(y & 3) * 4 + (x & 3)];
        // snow sits on the upper part of each tier
        if (t < 0.45 - side * 0.15 + (hash2(x, y, seed) - 0.5) * 0.2) put(s, x, y, ramp(snow, 0.8 - side * 0.5, b));
        else put(s, x, y, ramp(greens, 0.7 - side * 0.45 - t * 0.3, b));
      }
    }
  }
  return s;
}

function makeBoulder(seed) {
  const s = makeSprite(18, 14, 9, 12);
  shadowEllipse(s, 10, 12, 8, 2.2);
  const j = (k) => (hash2(seed, k, 5) - 0.5) * 2;
  blob(
    s,
    [
      [8 + j(1), 7, 5.5],
      [11 + j(2), 8 + j(3), 4.5],
    ],
    ['#3a3f48', '#4f5663', '#666e7b', '#7f8894', '#9aa3ae', '#c2c9d1'].map(hex),
    hex('#16181d'),
    70 + seed,
    { noise: 0.4 }
  );
  return s;
}

function makeBush(seed) {
  const s = makeSprite(16, 13, 8, 11);
  shadowEllipse(s, 9, 11, 7, 2);
  blob(
    s,
    [
      [5.5, 7, 4],
      [10.5, 7, 4],
      [8, 4.8, 4],
    ],
    ['#1f5a2a', '#2a7334', '#378a3f', '#4aa34b', '#69bd5a'].map(hex),
    hex('#11301a'),
    90 + seed,
    { leaf: true }
  );
  // berries
  for (let k = 0; k < 3; k++) {
    const x = 4 + Math.floor(hash2(seed, k, 8) * 8), y = 4 + Math.floor(hash2(seed, k, 9) * 4);
    put(s, x, y, hex('#e4384f'));
  }
  return s;
}

export function buildSprites() {
  return {
    tree0: makeTree(1),
    tree1: makeTree(2),
    tree2: makeTree(3),
    pine0: makePine(1),
    pine1: makePine(2),
    rock0: makeBoulder(1),
    rock1: makeBoulder(2),
    bush0: makeBush(1),
  };
}
