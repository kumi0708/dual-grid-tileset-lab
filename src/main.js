import { TERRAINS } from './terrains.js';
import { TILE, generateAtlas, atlasRect } from './tilegen.js';
import { TileMap, cornerMask, renderTerrain, renderSize, decorations, generateIsland, variantAt } from './dualgrid.js';
import { buildSprites } from './sprites.js';
import { STRINGS } from './i18n.js';

const T = TILE;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  lang: params.get('lang') === 'en' ? 'en' : 'ja',
  mode: 'dual',
  brush: 2,
  size: 1,
  variant: 0,
  hover: null, // { ox, oy } in offscreen pixels
  painting: 0, // 0 none, 1 paint, 2 erase
  dirty: true,
  tick: 0,
  draws: 0,
  visible: TERRAINS.map(() => true),
};

const map = generateIsland(new TileMap(34, 20), 3);
const size = renderSize(map);

// ------------------------------------------------------------------ assets
let atlases = [];
let sprites = {};

function toCanvas(w, h, data) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return c;
}

// ------------------------------------------------------------------ canvases
const view = $('view');
const vctx = view.getContext('2d');
const off = document.createElement('canvas');
off.width = size.w;
off.height = size.h;
const octx = off.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = $('stage').clientWidth;
  const h = Math.round((w * size.h) / size.w);
  view.style.height = h + 'px';
  view.width = Math.round(w * dpr);
  view.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ render
function renderOffscreen() {
  octx.clearRect(0, 0, off.width, off.height);
  state.draws = renderTerrain(map, TERRAINS, { mode: state.mode, visible: state.visible, tick: state.tick }, (L, sx, sy, dx, dy, w, h) =>
    octx.drawImage(atlases[L], sx, sy, w, h, dx, dy, w, h)
  );
  if ($('optDecor').checked) {
    for (const d of decorations(map, TERRAINS)) {
      if (!state.visible[d.layer]) continue;
      const s = sprites[d.sprite];
      octx.drawImage(s.canvas, d.x - s.ax, d.y - s.ay);
    }
  }
  $('stats').textContent = STRINGS[state.lang].stats(state.draws, map.w, map.h);
}

function present() {
  const k = view.width / off.width;
  vctx.imageSmoothingEnabled = false;
  vctx.drawImage(off, 0, 0, view.width, view.height);
  const dpr = window.devicePixelRatio || 1;

  if ($('optData').checked) {
    vctx.strokeStyle = 'rgba(255,255,255,0.55)';
    vctx.lineWidth = 1 * dpr;
    vctx.setLineDash([4 * dpr, 3 * dpr]);
    vctx.beginPath();
    for (let x = 0; x <= map.w; x++) {
      const X = Math.round((x * T + T / 2) * k) + 0.5;
      vctx.moveTo(X, (T / 2) * k);
      vctx.lineTo(X, (map.h * T + T / 2) * k);
    }
    for (let y = 0; y <= map.h; y++) {
      const Y = Math.round((y * T + T / 2) * k) + 0.5;
      vctx.moveTo((T / 2) * k, Y);
      vctx.lineTo((map.w * T + T / 2) * k, Y);
    }
    vctx.stroke();
    vctx.setLineDash([]);
  }
  if ($('optRender').checked) {
    vctx.strokeStyle = 'rgba(255,179,71,0.8)';
    vctx.lineWidth = 1 * dpr;
    vctx.beginPath();
    for (let x = 0; x <= map.w + 1; x++) {
      const X = Math.round(x * T * k) + 0.5;
      vctx.moveTo(X, 0);
      vctx.lineTo(X, view.height);
    }
    for (let y = 0; y <= map.h + 1; y++) {
      const Y = Math.round(y * T * k) + 0.5;
      vctx.moveTo(0, Y);
      vctx.lineTo(view.width, Y);
    }
    vctx.stroke();
  }
  const L = inspectLayer();
  if ($('optMask').checked && state.mode === 'dual') {
    vctx.font = `${Math.max(9, Math.round(T * k * 0.34))}px ui-monospace, Menlo, monospace`;
    vctx.textAlign = 'center';
    vctx.textBaseline = 'middle';
    for (let ry = 0; ry <= map.h; ry++)
      for (let rx = 0; rx <= map.w; rx++) {
        const m = cornerMask(map, rx, ry, L);
        if (m === 0) continue;
        const cx = (rx + 0.5) * T * k, cy = (ry + 0.5) * T * k;
        vctx.fillStyle = 'rgba(0,0,0,0.55)';
        vctx.fillRect(cx - T * k * 0.26, cy - T * k * 0.2, T * k * 0.52, T * k * 0.4);
        vctx.fillStyle = m === 15 ? '#9fe6a0' : '#ffd27a';
        vctx.fillText(String(m), cx, cy + 1);
      }
  }

  if (state.hover) {
    const { ox, oy } = state.hover;
    // brush footprint (data cells)
    const cx = Math.floor((ox - T / 2) / T), cy = Math.floor((oy - T / 2) / T);
    const o = Math.floor((state.size - 1) / 2);
    vctx.strokeStyle = 'rgba(255,255,255,0.9)';
    vctx.lineWidth = 2 * dpr;
    vctx.strokeRect(((cx - o) * T + T / 2) * k, ((cy - o) * T + T / 2) * k, state.size * T * k, state.size * T * k);

    if ($('optInspect').checked && state.mode === 'dual') {
      const rx = Math.floor(ox / T), ry = Math.floor(oy / T);
      vctx.strokeStyle = '#ffb347';
      vctx.lineWidth = 3 * dpr;
      vctx.strokeRect(rx * T * k, ry * T * k, T * k, T * k);
      const corners = [
        [rx - 1, ry - 1, 1],
        [rx, ry - 1, 2],
        [rx - 1, ry, 4],
        [rx, ry, 8],
      ];
      for (const [x, y, bit] of corners) {
        const px = (x + 1) * T * k, py = (y + 1) * T * k;
        const on = map.get(x, y) >= L;
        vctx.beginPath();
        vctx.arc(px, py, 6 * dpr, 0, Math.PI * 2);
        vctx.fillStyle = on ? '#ffb347' : 'rgba(10,14,25,0.85)';
        vctx.fill();
        vctx.strokeStyle = '#fff';
        vctx.lineWidth = 1.5 * dpr;
        vctx.stroke();
      }
      updateInspector(rx, ry, L);
    }
  }
}

function inspectLayer() {
  return state.brush === 0 ? 2 : state.brush;
}

// ------------------------------------------------------------------ inspector + atlas view
let lastInspect = '';
function updateInspector(rx, ry, L) {
  const S = STRINGS[state.lang];
  const m = cornerMask(map, rx, ry, L);
  const key = `${rx},${ry},${L},${m},${state.lang},${state.tick % 8}`;
  if (key === lastInspect) return;
  lastInspect = key;
  const t = TERRAINS[L];
  const bits = [1, 2, 4, 8];
  const lines = [`${S.layerOf(t.name[state.lang])} · render (${rx}, ${ry})`, ''];
  for (const b of bits) lines.push(`${m & b ? '■' : '□'} ${String(b).padStart(1)}  ${S.corner[b]}`);
  lines.push('', `mask = ${bits.filter((b) => m & b).join(' + ') || '0'} = ${m}`);
  $('inspectText').textContent = lines.join('\n');

  // corner diagram
  const c = $('inspectCorners').getContext('2d');
  c.clearRect(0, 0, 132, 132);
  const coords = [
    [rx - 1, ry - 1, 0, 0, 1],
    [rx, ry - 1, 1, 0, 2],
    [rx - 1, ry, 0, 1, 4],
    [rx, ry, 1, 1, 8],
  ];
  for (const [x, y, i, j, b] of coords) {
    const v = map.get(x, y);
    c.fillStyle = TERRAINS[v].swatch;
    c.fillRect(6 + i * 62, 6 + j * 62, 58, 58);
    c.fillStyle = v >= L ? 'rgba(255,179,71,0.95)' : 'rgba(0,0,0,0.55)';
    c.fillRect(6 + i * 62 + 4, 6 + j * 62 + 4, 22, 18);
    c.fillStyle = v >= L ? '#1a1205' : '#9aa';
    c.font = 'bold 13px ui-monospace, Menlo, monospace';
    c.fillText(String(b), 6 + i * 62 + 10, 6 + j * 62 + 18);
  }
  c.strokeStyle = '#ffb347';
  c.lineWidth = 3;
  c.strokeRect(37, 37, 58, 58);
  // zoomed atlas tile
  const tc = $('inspectTile').getContext('2d');
  tc.imageSmoothingEnabled = false;
  tc.clearRect(0, 0, 128, 128);
  const frame = (tt) => (tt.frames > 1 ? state.tick % tt.frames : 0);
  // composite every layer exactly like the renderer does for this render tile
  TERRAINS.forEach((tt, k) => {
    if (!state.visible[k]) return;
    const mk = tt.base ? 15 : cornerMask(map, rx, ry, k);
    if (!mk) return;
    const rr = atlasRect(mk, variantAt(rx, ry, k), frame(tt));
    tc.globalAlpha = k === L || k === 0 ? 1 : 0.9;
    tc.drawImage(atlases[k], rr.sx, rr.sy, T, T, 0, 0, 128, 128);
  });
  tc.globalAlpha = 1;
  drawAtlasView(m);
}

let atlasHighlight = -1;
function drawAtlasView(highlight = atlasHighlight) {
  atlasHighlight = highlight;
  const L = inspectLayer();
  const c = $('atlasView').getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#0b0f1b';
  c.fillRect(0, 0, 276, 276);
  const t = TERRAINS[L];
  const fr = t.frames > 1 ? state.tick % t.frames : 0;
  for (let m = 0; m < 16; m++) {
    const x = 4 + (m & 3) * 68, y = 4 + (m >> 2) * 68;
    const rw = atlasRect(15, state.variant, TERRAINS[0].frames > 1 ? state.tick % TERRAINS[0].frames : 0);
    c.drawImage(atlases[0], rw.sx, rw.sy, T, T, x, y, 64, 64);
    const r = atlasRect(m, state.variant, fr);
    c.drawImage(atlases[L], r.sx, r.sy, T, T, x, y, 64, 64);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(x, y, 20, 15);
    c.fillStyle = '#fff';
    c.font = '11px ui-monospace, Menlo, monospace';
    c.fillText(String(m), x + 3, y + 11);
    if (m === highlight) {
      c.strokeStyle = '#ffb347';
      c.lineWidth = 3;
      c.strokeRect(x + 1.5, y + 1.5, 61, 61);
    }
  }
}

// ------------------------------------------------------------------ input
function toOff(e) {
  const r = view.getBoundingClientRect();
  return { ox: ((e.clientX - r.left) / r.width) * off.width, oy: ((e.clientY - r.top) / r.height) * off.height };
}
function paintAt(p, erase) {
  const cx = Math.floor((p.ox - T / 2) / T), cy = Math.floor((p.oy - T / 2) / T);
  const o = Math.floor((state.size - 1) / 2);
  const v = erase ? 0 : state.brush;
  for (let y = cy - o; y < cy - o + state.size; y++) for (let x = cx - o; x < cx - o + state.size; x++) if (map.set(x, y, v)) state.dirty = true;
}
view.addEventListener('contextmenu', (e) => e.preventDefault());
view.addEventListener('pointerdown', (e) => {
  view.setPointerCapture(e.pointerId);
  state.painting = e.button === 2 || e.shiftKey ? 2 : 1;
  state.hover = toOff(e);
  paintAt(state.hover, state.painting === 2);
});
view.addEventListener('pointermove', (e) => {
  const prev = state.hover;
  state.hover = toOff(e);
  if (!state.painting) return;
  if (!prev) return paintAt(state.hover, state.painting === 2);
  // interpolate so fast strokes don't skip cells
  const steps = Math.max(1, Math.ceil(Math.hypot(state.hover.ox - prev.ox, state.hover.oy - prev.oy) / (T / 3)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    paintAt({ ox: prev.ox + (state.hover.ox - prev.ox) * t, oy: prev.oy + (state.hover.oy - prev.oy) * t }, state.painting === 2);
  }
});
view.addEventListener('pointerup', () => (state.painting = 0));
view.addEventListener('pointerleave', () => {
  if (!state.painting) state.hover = null;
});
window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= TERRAINS.length) selectBrush(n - 1);
});

function selectBrush(i) {
  state.brush = i;
  document.querySelectorAll('#palette button').forEach((b, j) => b.classList.toggle('on', j === i));
  lastInspect = '';
  drawAtlasView(-1);
}

function buildPalette() {
  const p = $('palette');
  p.innerHTML = '';
  TERRAINS.forEach((t, i) => {
    const b = document.createElement('button');
    const c = document.createElement('canvas');
    c.width = c.height = T;
    const cx = c.getContext('2d');
    const r0 = atlasRect(15, 0, 0);
    cx.drawImage(atlases[0], r0.sx, r0.sy, T, T, 0, 0, T, T);
    const r = atlasRect(15, 0, 0);
    cx.drawImage(atlases[i], r.sx, r.sy, T, T, 0, 0, T, T);
    b.append(c);
    const s = document.createElement('span');
    s.innerHTML = `${t.name[state.lang]} <kbd>${i + 1}</kbd>`;
    b.append(s);
    b.onclick = () => selectBrush(i);
    if (i === state.brush) b.classList.add('on');
    p.append(b);
  });
  const lay = $('layers');
  lay.innerHTML = '';
  TERRAINS.forEach((t, i) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" ${state.visible[i] ? 'checked' : ''}/> <i class="sw" style="background:${t.swatch}"></i> ${i}: ${t.name[state.lang]}`;
    l.querySelector('input').onchange = (e) => {
      state.visible[i] = e.target.checked;
      state.dirty = true;
    };
    lay.append(l);
  });
}

function applyLang() {
  const S = STRINGS[state.lang];
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = S[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  $('lang').textContent = state.lang === 'ja' ? 'EN' : '日本語';
  $('readmeLink').href = 'https://github.com/kumi0708/dual-grid-tileset-lab' + (state.lang === 'en' ? '/blob/main/README.en.md' : '#readme');
  if (atlases.length) buildPalette();
  lastInspect = '';
  state.dirty = true;
}

$('lang').onclick = () => {
  state.lang = state.lang === 'ja' ? 'en' : 'ja';
  applyLang();
};
document.querySelectorAll('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    state.dirty = true;
  })
);
document.querySelectorAll('#brush button').forEach((b) =>
  b.addEventListener('click', () => {
    state.size = Number(b.dataset.size);
    document.querySelectorAll('#brush button').forEach((x) => x.classList.toggle('on', x === b));
  })
);
document.querySelectorAll('#variant button').forEach((b) =>
  b.addEventListener('click', () => {
    state.variant = Number(b.dataset.v);
    document.querySelectorAll('#variant button').forEach((x) => x.classList.toggle('on', x === b));
    drawAtlasView();
  })
);
['optDecor'].forEach((id) => ($(id).onchange = () => (state.dirty = true)));
let seed = 3;
$('random').onclick = () => {
  generateIsland(map, ++seed);
  state.dirty = true;
};
$('clear').onclick = () => {
  map.cells.fill(0);
  state.dirty = true;
};
$('download').onclick = () => {
  const L = inspectLayer();
  const a = document.createElement('a');
  a.download = `dualgrid-${TERRAINS[L].id}-atlas.png`;
  a.href = atlases[L].toDataURL('image/png');
  a.click();
};

// ------------------------------------------------------------------ loop
let lastTick = 0;
function loop(now) {
  if ($('optAnim').checked && now - lastTick > 150) {
    lastTick = now;
    state.tick++;
    state.dirty = true;
  }
  if (state.dirty) {
    renderOffscreen();
    state.dirty = false;
    drawAtlasView();
  }
  present();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ boot
applyLang();
resize();
setTimeout(() => {
  const t0 = performance.now();
  atlases = TERRAINS.map((t) => {
    const a = generateAtlas(t);
    return toCanvas(a.width, a.height, a.data);
  });
  const sp = buildSprites();
  for (const k in sp) sprites[k] = { ...sp[k], canvas: toCanvas(sp[k].w, sp[k].h, sp[k].data) };
  console.log(`atlases generated in ${(performance.now() - t0).toFixed(0)} ms`);
  // URL params (handy for screenshots): ?overlay=data,render,mask&hover=12,8&brush=4&mode=raw
  for (const o of (params.get('overlay') || '').split(',')) {
    const id = { data: 'optData', render: 'optRender', mask: 'optMask' }[o];
    if (id) $(id).checked = true;
  }
  if (params.get('brush')) state.brush = Number(params.get('brush'));
  if (params.get('mode') === 'raw') document.querySelector('[data-mode="raw"]').click();
  if (params.get('hover')) {
    const [hx, hy] = params.get('hover').split(',').map(Number);
    state.hover = { ox: (hx + 0.5) * T, oy: (hy + 0.5) * T };
  }
  buildPalette();
  $('loading').classList.add('hide');
  resize();
  requestAnimationFrame(loop);
}, 30);
