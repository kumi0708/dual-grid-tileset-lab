// Deterministic hashing & noise helpers (no dependencies, works in browser and Node).

/** Integer hash -> float in [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;
const fade = (t) => t * t * (3 - 2 * t);
const wrap = (a, p) => ((a % p) + p) % p;

/**
 * Value noise that is PERIODIC over one tile.
 * u, v are in tile units (0..1 covers one tile). px / py are the lattice
 * resolution per tile (integers), so noise(u, v) === noise(u + 1, v).
 * This is what makes every generated tile edge match every other tile edge.
 */
export function pnoise(u, v, px, seed, py = px) {
  const x = u * px, y = v * py;
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const x0 = wrap(xi, px), x1 = wrap(xi + 1, px);
  const y0 = wrap(yi, py), y1 = wrap(yi + 1, py);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

/** Fractal (fBm) version of pnoise. Still periodic over one tile. */
export function pfbm(u, v, p0, octaves, seed) {
  let sum = 0, norm = 0, amp = 0.5, p = p0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * pnoise(u, v, p, seed + i * 131);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Non-periodic world-space value noise (for map generation). */
export function wnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

export function wfbm(x, y, octaves, seed) {
  let sum = 0, norm = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * wnoise(x * f, y * f, seed + i * 71);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** 4x4 ordered-dither (Bayer) thresholds in (0, 1). */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
