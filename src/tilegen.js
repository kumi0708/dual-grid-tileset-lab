// Procedural generator for dual-grid tile atlases.
//
// Every dual-grid tile is defined by 4 corner bits. We turn those 4 bits into a
// continuous scalar field over the tile, add tile-periodic noise, threshold it,
// and derive a pixel-space signed distance to the edge. Terrain "shaders" then
// use that distance + edge normal to paint outlines, cliffs, rims, foam, shadows.

import { pfbm, smooth, clamp01, BAYER4 } from './noise.js';

export const TILE = 32;
export const VARIANTS = 4;

// Corner bit values (same convention as the SpriteCook article):
//   1 = top-left, 2 = top-right, 4 = bottom-left, 8 = bottom-right
export const BIT_TL = 1, BIT_TR = 2, BIT_BL = 4, BIT_BR = 8;

/** Smoothed bilinear blend of the 4 corner bits. 1 at a filled corner, 0 at an empty one. */
export function cornerField(mask, u, v) {
  const su = smooth(u), sv = smooth(v);
  const tl = mask & 1, tr = (mask >> 1) & 1, bl = (mask >> 2) & 1, br = (mask >> 3) & 1;
  return tl * (1 - su) * (1 - sv) + tr * su * (1 - sv) + bl * (1 - su) * sv + br * su * sv;
}

/**
 * Window that is 0 on every tile edge and 1 in the middle.
 * Noise multiplied by it can differ between tile variants without breaking seams.
 */
export function edgeWindow(u, v) {
  return Math.sin(Math.PI * clamp01(u)) * Math.sin(Math.PI * clamp01(v));
}

/** Variant-aware periodic texture noise: shared on edges, unique in the interior. */
export function vtex(u, v, p, oct, seed, variant, mix = 0.8) {
  const base = pfbm(u, v, p, oct, seed);
  if (!variant) return base;
  const w = edgeWindow(u, v) * mix;
  return base * (1 - w) + pfbm(u, v, p, oct, seed + 1013 * variant) * w;
}

function shapeNoise(t, u, v, variant) {
  return (vtex(u, v, t.shapeP, 3, t.seed, variant, 1.0) - 0.5) * t.noiseAmp;
}

/** Signed field: > 0 inside the terrain, < 0 outside, 0 on the edge. */
export function terrainField(t, mask, variant, px, py) {
  const u = (px + 0.5) / TILE, v = (py + 0.5) / TILE;
  const base = t.base ? 1 : cornerField(mask, u, v);
  return base + shapeNoise(t, u, v, variant) - (0.5 + t.bias);
}

/** Field + signed pixel distance + inward normal for one pixel. */
export function sampleEdge(t, mask, variant, px, py) {
  const f = terrainField(t, mask, variant, px, py);
  if (t.base) return { f, d: 99, nx: 0, ny: 0 };
  const gx = (terrainField(t, mask, variant, px + 1, py) - terrainField(t, mask, variant, px - 1, py)) * 0.5;
  const gy = (terrainField(t, mask, variant, px, py + 1) - terrainField(t, mask, variant, px, py - 1)) * 0.5;
  const gl = Math.hypot(gx, gy) + 1e-6;
  let d = f / gl; // first-order distance to the f = 0 contour, in pixels
  if (d > 60) d = 60;
  if (d < -60) d = -60;
  return { f, d, nx: gx / gl, ny: gy / gl };
}

const R = 10; // margin (px) sampled around each tile

/**
 * 8SSEDT (two-pass sequential Euclidean distance transform).
 * For every cell, finds the offset (vx, vy) to the nearest seed cell.
 */
function edt(seed, N) {
  const INF = 1e4;
  const vx = new Float32Array(N * N), vy = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) vx[i] = vy[i] = seed[i] ? 0 : INF;
  const len2 = (i) => vx[i] * vx[i] + vy[i] * vy[i];
  const tryN = (i, x, y, dx, dy) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) return;
    const j = ny * N + nx;
    const cx = vx[j] + dx, cy = vy[j] + dy;
    if (cx * cx + cy * cy < len2(i)) {
      vx[i] = cx;
      vy[i] = cy;
    }
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      tryN(i, x, y, -1, 0);
      tryN(i, x, y, 0, -1);
      tryN(i, x, y, -1, -1);
      tryN(i, x, y, 1, -1);
    }
    for (let x = N - 1; x >= 0; x--) tryN(y * N + x, x, y, 1, 0);
  }
  for (let y = N - 1; y >= 0; y--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x;
      tryN(i, x, y, 1, 0);
      tryN(i, x, y, 0, 1);
      tryN(i, x, y, 1, 1);
      tryN(i, x, y, -1, 1);
    }
    for (let x = 0; x < N; x++) tryN(y * N + x, x, y, -1, 0);
  }
  return { vx, vy };
}

/**
 * Precompute field, signed distance and edge normal for every pixel of one (mask, variant).
 *
 * The field is sampled on a grid extended by R pixels around the tile. Outside the
 * tile the corner blend is clamped (its derivative is 0 at the edge thanks to the
 * smoothstep) and the noise is tile-periodic, so the extension closely matches what
 * the neighbouring tile really contains. A Euclidean distance transform then gives,
 * for every pixel, the vector to the nearest pixel of opposite sign: a true pixel
 * distance (not the noisy f/|grad f| estimate) and a robust inward normal.
 * The result is reused by every animation frame.
 */
export function edgeData(t, mask, variant) {
  const n = TILE * TILE;
  const d = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), f = new Float32Array(n);
  if (t.base) {
    d.fill(99);
    return { f, d, nx, ny };
  }
  const N = TILE + 2 * R;
  const F = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) F[y * N + x] = terrainField(t, mask, variant, x - R, y - R);
  const inside = new Uint8Array(N * N), outside = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) (F[i] > 0 ? inside : outside)[i] = 1;
  const toOut = edt(outside, N); // for inside pixels: nearest outside pixel
  const toIn = edt(inside, N); // for outside pixels: nearest inside pixel
  for (let py = 0; py < TILE; py++)
    for (let px = 0; px < TILE; px++) {
      const i = py * TILE + px, g = (py + R) * N + px + R;
      const isIn = F[g] > 0;
      f[i] = F[g];
      const V = isIn ? toOut : toIn;
      const ox = V.vx[g], oy = V.vy[g];
      const l = Math.hypot(ox, oy);
      if (l > 5e3) {
        d[i] = isIn ? 60 : -60;
        continue;
      }
      const dist = Math.max(l - 0.5, 0.5);
      d[i] = isIn ? dist : -dist;
      // inward normal: away from the edge when inside, toward it when outside
      const sgn = isIn ? -1 : 1;
      nx[i] = (sgn * ox) / l;
      ny[i] = (sgn * oy) / l;
    }
  return { f, d, nx, ny };
}

/** Paint one tile into an RGBA buffer at (ox, oy). */
export function paintTile(t, mask, variant, frame, buf, bufW, ox, oy, edge = edgeData(t, mask, variant)) {
  const frames = t.frames || 1;
  const ctx = { u: 0, v: 0, px: 0, py: 0, d: 0, nx: 0, ny: 0, f: 0, bayer: 0, phase: frame / frames, frame, frames, variant, mask };
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const k = py * TILE + px;
      ctx.u = (px + 0.5) / TILE;
      ctx.v = (py + 0.5) / TILE;
      ctx.px = px;
      ctx.py = py;
      ctx.d = edge.d[k];
      ctx.f = edge.f[k];
      ctx.nx = edge.nx[k];
      ctx.ny = edge.ny[k];
      ctx.bayer = BAYER4[(py & 3) * 4 + (px & 3)];
      const c = t.shade(ctx);
      const i = ((oy + py) * bufW + ox + px) * 4;
      if (c) {
        buf[i] = c[0];
        buf[i + 1] = c[1];
        buf[i + 2] = c[2];
        buf[i + 3] = c.length > 3 ? c[3] : 255;
      } else {
        buf[i + 3] = 0;
      }
    }
  }
}

/**
 * Atlas layout:
 *   x = (variant * 4 + mask % 4) * TILE
 *   y = (frame   * 4 + mask / 4) * TILE
 * i.e. one 4x4 block (indexed directly by mask) per variant, one row of blocks per frame.
 */
export function atlasRect(mask, variant, frame) {
  return { sx: (variant * 4 + (mask & 3)) * TILE, sy: (frame * 4 + (mask >> 2)) * TILE };
}

export function generateAtlas(t, variants = VARIANTS) {
  const frames = t.frames || 1;
  const width = variants * 4 * TILE;
  const height = frames * 4 * TILE;
  const data = new Uint8ClampedArray(width * height * 4);
  const cache = [];
  for (let f = 0; f < frames; f++) {
    for (let v = 0; v < variants; v++) {
      if (t.base) {
        // Base terrain covers everything: one tile, copied into all 16 mask slots.
        const r15 = atlasRect(15, v, f);
        paintTile(t, 15, v, f, data, width, r15.sx, r15.sy);
        for (let m = 0; m < 15; m++) {
          const r = atlasRect(m, v, f);
          for (let y = 0; y < TILE; y++) {
            const src = ((r15.sy + y) * width + r15.sx) * 4;
            data.copyWithin(((r.sy + y) * width + r.sx) * 4, src, src + TILE * 4);
          }
        }
        continue;
      }
      for (let m = 0; m < 16; m++) {
        const r = atlasRect(m, v, f);
        const key = m + v * 16;
        if (!cache[key]) cache[key] = edgeData(t, m, v);
        paintTile(t, m, v, f, data, width, r.sx, r.sy, cache[key]);
      }
    }
  }
  return { width, height, data, variants, frames };
}
