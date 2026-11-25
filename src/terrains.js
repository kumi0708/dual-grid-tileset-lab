// Terrain definitions: palette + per-pixel "shader" used by the tile generator.
// Terrains are ordered by elevation. Layer i is drawn where corner value >= i.

import { pfbm, pnoise, hash2 } from './noise.js';
import { vtex } from './tilegen.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pal = (...hs) => hs.map(hex);

/** Pick a palette entry from t in [0,1] with ordered dithering between neighbours. */
function ramp(cols, t, bayer, dither = 0.9) {
  let i = Math.floor(t * cols.length + (bayer - 0.5) * dither);
  if (i < 0) i = 0;
  if (i >= cols.length) i = cols.length - 1;
  return cols[i];
}

// Light comes from the top-left. "facing" > 0 means this edge faces the light.
const facing = (c) => c.nx * 0.6 + c.ny * 0.8;
// > 0 when the edge is on the bottom side of the shape (front face in 3/4 view).
const front = (c) => -c.ny;

/** Generic raised-terrain shader: outline, front lip (cliff), lit rim, cast shadow, surface. */
function landShader(o) {
  return (c) => {
    if (c.d <= 0) {
      if (o.outside) {
        const r = o.outside(c);
        if (r) return r;
      }
      if (o.shadow && c.d > -o.shadow) {
        // Shadow falls to the bottom-right: the edge's inward normal points up-left.
        const s = -(c.nx * 0.45 + c.ny * 0.89);
        if (s > 0.15) {
          const k = (1 + c.d / o.shadow) * Math.min(1, s * 1.6);
          if (c.bayer < k) return o.shadowColor || [8, 16, 40, 85];
        }
      }
      return null;
    }
    if (c.d < 1.1) return o.outline;
    const fr = front(c);
    if (o.lip && fr > 0.25) {
      const w = o.lip * Math.min(1, (fr - 0.25) * 2.2);
      if (c.d < 1.1 + w) return o.lipShade(c, (c.d - 1.1) / Math.max(w, 1e-3));
      if (c.d < 2.1 + w) return o.lipTop || o.rim;
    }
    if (c.d < 2.6 && facing(c) > 0.35) return o.rim;
    return o.surface(c);
  };
}

/** Small decorative marks on an 8px grid (tufts, pebbles, flowers). Never crosses tile edges. */
function gridMark(c, seed, chance) {
  const gx = c.px >> 3, gy = c.py >> 3;
  const h = hash2(gx, gy, seed + c.variant * 17);
  if (h > chance) return null;
  const ox = 2 + Math.floor(hash2(gx, gy, seed + 1 + c.variant * 17) * 4);
  const oy = 2 + Math.floor(hash2(gx, gy, seed + 2 + c.variant * 17) * 4);
  return { dx: (c.px & 7) - ox, dy: (c.py & 7) - oy, h: h / chance, k: hash2(gx, gy, seed + 3) };
}

// ---------------------------------------------------------------- palettes
const WATER = pal('#102a5c', '#163a78', '#1d4d93', '#2563ad', '#2f7ac4', '#3d92d6');
const SAND = pal('#c99a5e', '#d8ad6c', '#e5c181', '#f0d699', '#f8e7b8');
const SAND_WET = pal('#9c7548', '#ae8655', '#bf9762');
const GRASS = pal('#2c6a32', '#367d37', '#43923d', '#56a845', '#6dbe4f', '#8ad05c');
const DIRT = pal('#4a2e1d', '#5e3b24', '#74492c', '#8a5a36');
const FOREST = pal('#173f26', '#1e4f2d', '#275f34', '#31703c', '#3d8044');
const STONE = pal('#4f5663', '#5f6774', '#717a87', '#848e9b', '#9aa3af', '#b3bbc5');
const CLIFF = pal('#2a2e37', '#343943', '#3f4550', '#4b525e');
const SNOW = pal('#b9cbe3', '#cddbee', '#dfe9f6', '#eef4fb', '#ffffff');
const ICE = pal('#7d97bf', '#8fa9cf', '#a3bbdc');

export const TERRAINS = [
  // ------------------------------------------------------------ 0: water (base)
  {
    id: 'water',
    name: { ja: '水', en: 'Water' },
    base: true,
    bias: 0,
    noiseAmp: 0,
    shapeP: 2,
    seed: 11,
    frames: 8,
    swatch: '#2563ad',
    shade(c) {
      const ph = c.phase;
      // Calm, low-contrast body: strong patterns would reveal the 32px tile period.
      const n = vtex(c.u, c.v, 2, 3, 101, c.variant, 0.9);
      const sh = pnoise(c.u + ph, c.v + ph, 2, 202); // slow drifting shimmer (loops: shifts 1 tile per cycle)
      let t = 0.42 + (n - 0.5) * 0.22 + (sh - 0.5) * 0.2;
      // Wavelets: short highlight strokes on an 8px grid that grow and fade over time.
      const m = gridMark(c, 303, 0.45);
      if (m) {
        const life = (m.k + ph) % 1;
        const len = Math.round(Math.sin(life * Math.PI) * 2.2);
        if (len > 0 && m.dy === 0 && Math.abs(m.dx) <= len) return Math.abs(m.dx) === len ? WATER[4] : [120, 190, 236];
        if (len > 1 && m.dy === 1 && Math.abs(m.dx) < len) return WATER[1];
      }
      if (hash2(c.px, c.py, 7 + c.frame + c.variant * 31) > 0.997) return [230, 248, 255];
      return ramp(WATER, t, c.bayer);
    },
  },
  // ------------------------------------------------------------ 1: sand
  {
    id: 'sand',
    name: { ja: '砂浜', en: 'Sand' },
    bias: 0,
    noiseAmp: 0.5,
    shapeP: 3,
    seed: 21,
    frames: 8,
    swatch: '#e5c181',
    shade: landShader({
      outline: hex('#8a6a42'),
      rim: hex('#fbedc6'),
      outside(c) {
        const k = -c.d; // distance into the water, px
        if (k > 9) return null;
        const ph = c.phase * Math.PI * 2;
        // A foam band that breathes in and out with the animation phase.
        const wob = pnoise(c.u, c.v, 4, 77);
        const pos = 3.2 + 2.0 * Math.sin(ph + wob * 4.0);
        const fn = pnoise(c.u + c.phase, c.v, 8, 88);
        if (Math.abs(k - pos) < 0.8 && fn > 0.35) return [236, 250, 255, 235];
        if (k < 1.4) return [226, 246, 252, 215];
        if (k < 4.5) return [120, 214, 224, 120];
        if (c.bayer < 1 - (k - 4.5) / 4.5) return [110, 200, 220, 80];
        return null;
      },
      lip: 0,
      surface(c) {
        if (c.d < 4) return ramp(SAND_WET, (c.d - 1) / 3, c.bayer);
        const n = vtex(c.u, c.v, 4, 3, 404, c.variant);
        const rip = Math.sin((c.v * 4 + c.u * 1 + n * 0.8) * Math.PI * 2) * 0.12;
        const m = gridMark(c, 505, 0.25);
        if (m && ((m.dx === 0 && m.dy === 0) || (m.dx === 1 && m.dy === 0))) return m.k > 0.5 ? hex('#fff6dc') : hex('#b88f5c');
        return ramp(SAND, 0.15 + n * 0.8 + rip, c.bayer);
      },
    }),
  },
  // ------------------------------------------------------------ 2: grass
  {
    id: 'grass',
    name: { ja: '草原', en: 'Grass' },
    bias: 0.05,
    noiseAmp: 0.45,
    shapeP: 3,
    seed: 31,
    swatch: '#56a845',
    shade: landShader({
      outline: hex('#1b3f1f'),
      rim: hex('#a3df6e'),
      lipTop: hex('#9bd767'),
      lip: 4,
      lipShade: (c, t) => ramp(DIRT, 0.9 - t * 0.9 + (pnoise(c.u, c.v, 16, 616, 4) - 0.5) * 0.5, c.bayer),
      shadow: 4,
      surface(c) {
        const n = vtex(c.u, c.v, 4, 3, 606, c.variant);
        const m = gridMark(c, 707, 0.55);
        if (m) {
          // grass tuft: light tip, dark base
          if (m.h < 0.12 && m.dx === 0 && m.dy === 0) return [hex('#f2f2f2'), hex('#ffd84a'), hex('#ff7fa8'), hex('#b9a0ff')][Math.floor(m.k * 4)];
          if (m.h < 0.12 && Math.abs(m.dx) + Math.abs(m.dy) === 1) return m.k < 0.5 ? hex('#fff3a8') : hex('#f7f7ff');
          if (m.dx === 0 && m.dy === -1) return GRASS[5];
          if ((m.dx === -1 || m.dx === 1) && m.dy === 0) return GRASS[4];
          if (m.dx >= -1 && m.dx <= 1 && m.dy === 1) return GRASS[1];
        }
        return ramp(GRASS, 0.12 + n * 0.85, c.bayer);
      },
    }),
  },
  // ------------------------------------------------------------ 3: forest
  {
    id: 'forest',
    name: { ja: '森', en: 'Forest' },
    bias: 0.08,
    noiseAmp: 0.5,
    shapeP: 4,
    seed: 41,
    swatch: '#275f34',
    shade: landShader({
      outline: hex('#0d2617'),
      rim: hex('#4f9a4f'),
      lip: 3,
      lipShade: (c, t) => ramp(DIRT, 0.6 - t * 0.6, c.bayer),
      shadow: 5,
      surface(c) {
        const n = vtex(c.u, c.v, 4, 3, 808, c.variant);
        const m = gridMark(c, 909, 0.5);
        if (m && m.dx >= 0 && m.dx <= 1 && m.dy === 0) return m.k < 0.5 ? hex('#7a5a2c') : hex('#4c8a3f');
        return ramp(FOREST, 0.1 + n * 0.9, c.bayer);
      },
    }),
  },
  // ------------------------------------------------------------ 4: stone / highland
  {
    id: 'stone',
    name: { ja: '岩山', en: 'Stone' },
    bias: 0.06,
    noiseAmp: 0.55,
    shapeP: 3,
    seed: 51,
    swatch: '#848e9b',
    shade: landShader({
      outline: hex('#1c1f25'),
      rim: hex('#cfd5dc'),
      lipTop: hex('#c3cad2'),
      lip: 8,
      // cliff face: vertical striations (high frequency in u, low in v)
      lipShade: (c, t) => ramp(CLIFF, 0.85 - t * 0.5 + (pnoise(c.u, c.v, 16, 1212, 2) - 0.5) * 0.9, c.bayer),
      shadow: 6,
      surface(c) {
        const n = vtex(c.u, c.v, 3, 4, 1111, c.variant);
        const r = Math.abs(vtex(c.u, c.v, 4, 2, 1313, c.variant) - 0.5);
        if (r < 0.018) return CLIFF[1];
        if (r < 0.034) return STONE[0];
        const m = gridMark(c, 1414, 0.3);
        if (m && m.dx >= 0 && m.dx <= 1 && m.dy >= 0 && m.dy <= 1) return m.dy === 0 ? STONE[5] : STONE[1];
        return ramp(STONE, 0.1 + n * 0.85, c.bayer);
      },
    }),
  },
  // ------------------------------------------------------------ 5: snow
  {
    id: 'snow',
    name: { ja: '雪原', en: 'Snow' },
    bias: 0.1,
    noiseAmp: 0.45,
    shapeP: 3,
    seed: 61,
    swatch: '#eef4fb',
    shade: landShader({
      outline: hex('#5a6e8f'),
      rim: hex('#ffffff'),
      lip: 4,
      lipShade: (c, t) => ramp(ICE, 0.9 - t * 0.9, c.bayer),
      shadow: 4,
      shadowColor: [20, 40, 90, 70],
      surface(c) {
        const n = vtex(c.u, c.v, 3, 3, 1515, c.variant);
        if (hash2(c.px, c.py, 1616 + c.variant) > 0.985) return [255, 255, 255];
        return ramp(SNOW, 0.2 + n * 0.85, c.bayer);
      },
    }),
  },
];
