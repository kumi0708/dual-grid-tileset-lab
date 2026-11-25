// Minimal raster toolkit for Node: RGBA images, alpha blit, scaling, lines,
// a 3x5 pixel font, and PNG / APNG encoding (zlib only, no dependencies).

import zlib from 'node:zlib';
import fs from 'node:fs';

export function img(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill) for (let i = 0; i < w * h; i++) data.set([fill[0], fill[1], fill[2], fill[3] ?? 255], i * 4);
  return { width: w, height: h, data };
}

/** Alpha-composite src region onto dst. */
export function blit(dst, src, sx, sy, dx, dy, w, h, opacity = 1) {
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = ((sy + y) * src.width + sx + x) * 4;
      const a = (src.data[si + 3] / 255) * opacity;
      if (a <= 0) continue;
      const di = (ty * dst.width + tx) * 4;
      const da = dst.data[di + 3] / 255;
      const oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) dst.data[di + k] = (src.data[si + k] * a + dst.data[di + k] * da * (1 - a)) / (oa || 1);
      dst.data[di + 3] = oa * 255;
    }
  }
}

export function scale(src, s) {
  const out = img(src.width * s, src.height * s);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const si = (((y / s) | 0) * src.width + ((x / s) | 0)) * 4;
      const di = (y * out.width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  return out;
}

export function crop(src, x0, y0, w, h) {
  const out = img(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

export function pset(dst, x, y, c) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
  const i = (y * dst.width + x) * 4;
  const a = (c[3] ?? 255) / 255;
  for (let k = 0; k < 3; k++) dst.data[i + k] = c[k] * a + dst.data[i + k] * (1 - a);
  dst.data[i + 3] = Math.max(dst.data[i + 3], (c[3] ?? 255));
}

export function fillRect(dst, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pset(dst, x, y, c);
}

export function hline(dst, x0, x1, y, c, dash = 0) {
  for (let x = x0; x <= x1; x++) if (!dash || ((x / dash) | 0) % 2 === 0) pset(dst, x, y, c);
}
export function vline(dst, x, y0, y1, c, dash = 0) {
  for (let y = y0; y <= y1; y++) if (!dash || ((y / dash) | 0) % 2 === 0) pset(dst, x, y, c);
}
export function strokeRect(dst, x, y, w, h, c, t = 1) {
  for (let i = 0; i < t; i++) {
    hline(dst, x, x + w - 1, y + i, c);
    hline(dst, x, x + w - 1, y + h - 1 - i, c);
    vline(dst, x + i, y, y + h - 1, c);
    vline(dst, x + w - 1 - i, y, y + h - 1, c);
  }
}
export function disc(dst, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) pset(dst, x, y, c);
}

// 3x5 pixel font (digits + a few letters)
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '=': '000111000111000', '+': '000010111010000', ' ': '000000000000000', '|': '010010010010010',
  A: '010101111101101', B: '110101110101110', D: '110101101101110', L: '100100100100111', R: '110101110101101', T: '111010010010010',
  M: '101111111101101', S: '111100111001111', K: '101101110101101', W: '101101111111101', N: '101111111111101',
};
export function text(dst, str, x, y, c, s = 1, shadow = null) {
  if (shadow) text(dst, str, x + s, y + s, shadow, s);
  let cx = x;
  for (const ch of String(str)) {
    const g = FONT[ch] || FONT[' '];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy * 3 + gx] === '1') fillRect(dst, cx + gx * s, y + gy * s, s, s, c);
    cx += 4 * s;
  }
  return cx - x;
}
export const textWidth = (str, s = 1) => String(str).length * 4 * s - s;

// ------------------------------------------------------------- PNG / APNG
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function raw(im) {
  const rows = [];
  for (let y = 0; y < im.height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(im.data.buffer, im.data.byteOffset + y * im.width * 4, im.width * 4));
  }
  return zlib.deflateSync(Buffer.concat(rows), { level: 9 });
}
function ihdr(w, h) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = 8;
  b[9] = 6;
  return chunk('IHDR', b);
}
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function writePNG(path, im) {
  fs.writeFileSync(path, Buffer.concat([SIG, ihdr(im.width, im.height), chunk('IDAT', raw(im)), chunk('IEND', Buffer.alloc(0))]));
}

/** Animated PNG (all frames full-size). GitHub renders APNG animations in READMEs. */
export function writeAPNG(path, frames, delayMs = 120) {
  const { width, height } = frames[0];
  const parts = [SIG, ihdr(width, height)];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4);
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((f, i) => {
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0);
    fc.writeUInt32BE(width, 4);
    fc.writeUInt32BE(height, 8);
    fc.writeUInt32BE(0, 12);
    fc.writeUInt32BE(0, 16);
    fc.writeUInt16BE(delayMs, 20);
    fc.writeUInt16BE(1000, 22);
    fc[24] = 0;
    fc[25] = 0;
    parts.push(chunk('fcTL', fc));
    const z = raw(f);
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const sq = Buffer.alloc(4);
      sq.writeUInt32BE(seq++);
      parts.push(chunk('fdAT', Buffer.concat([sq, z])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  fs.writeFileSync(path, Buffer.concat(parts));
}
