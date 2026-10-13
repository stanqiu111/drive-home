// Well-known chains along the road: how their signs (logos) and buildings look, so players
// recognise a Tim Hortons, a Petro-Canada or a Canadian Tire at a glance. brand-sites.js
// builds the buildings, canopies and signs from this table; world.js uses brandLook() for the
// wall colours of big boxes.
//
// Adding a brand: add an entry to BRANDS with
//   id     a short unique key
//   re     a regular expression, matched against the OpenStreetMap `brand` tag first, then
//          the business name
//   kind   fuel | food | cafe | bank | pharmacy | grocery | retail | hotel | car | service
//   c      colours (numbers): `main` (the brand colour), `fg` (text/logo on main) and any
//          others its drawings use
//   badge  (optional) draws the square logo: (g, w, h) => {} on a 2D canvas, filling the
//          whole cell (no transparency); without it a text badge is made from `word`
//   word   (optional) draws the wide sign (4:1); without it the badge is used
//   look   (optional) the building of a standalone restaurant, cafe or bank (see LOOKS)
//   fuel   (optional, gas stations) canopy, pump and kiosk colours (see FUEL_DEFAULT)
//   pylon  'tall' (pole sign at the road), 'low' (monument sign) or null
//   box    (optional) wall and accent band colours for its big-box store
// Simple brands only need `c` plus `text` (and optionally `font`): their signs are their name
// in their colours. Logos are simplified drawings, never downloaded images.

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BLACK = '"Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const SCRIPT = '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive';
const ROUND = '"Arial Rounded MT Bold", "Helvetica Rounded", "Helvetica Neue", Arial, sans-serif';
const COND = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const IMPACT = 'Impact, Haettenschweiler, "Arial Black", sans-serif';

export const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

// ---------- canvas helpers ----------
function txt(g, s, x, y, o = {}) {
  const { size = 40, font = SANS, weight = 'bold', style = '', color = '#fff', align = 'center', maxW = 1e9, stroke = null, lw = 0, base = 'middle', spacing = 0 } = o;
  let sz = size;
  const set = () => {
    g.font = `${style} ${weight} ${Math.round(sz)}px ${font}`;
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(spacing * sz)}px`;
  };
  set();
  const w = g.measureText(s).width;
  if (w > maxW) { sz *= maxW / w; set(); }
  g.textAlign = align;
  g.textBaseline = base;
  if (stroke) {
    g.lineJoin = 'round';
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.strokeText(s, x, y);
  }
  g.fillStyle = color;
  g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
function rr(g, x, y, w, h, r, fill, stroke, lw) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}
function ellipse(g, cx, cy, rx, ry, fill, stroke, lw) {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}
function poly(g, pts, fill, stroke, lw) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}
const bg = (g, w, h, col) => { g.fillStyle = col; g.fillRect(0, 0, w, h); };

// Canadian maple leaf (right half, unit size, y down), mirrored for the left.
const LEAF_R = [[0, -1], [0.13, -0.74], [0.27, -0.82], [0.2, -0.3], [0.38, -0.48], [0.44, -0.37], [0.72, -0.43], [0.62, -0.14], [0.7, -0.08], [0.38, 0.22], [0.44, 0.36], [0.06, 0.3], [0.07, 0.72], [0, 0.72]];
const LEAF = [...LEAF_R, ...LEAF_R.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
function leaf(g, cx, cy, s, fill, stroke, lw) {
  poly(g, LEAF.map(([x, y]) => [cx + x * s, cy + y * s]), fill, stroke, lw);
}
// Shell's scallop: a fan with a lobed top edge, red outline and ribs.
function pecten(g, cx, cy, s) {
  const lobes = 7;
  const pts = [[cx - 0.32 * s, cy + 0.7 * s], [cx - 0.62 * s, cy + 0.35 * s], [cx - 0.92 * s, cy + 0.02 * s]];
  for (let i = 0; i <= lobes * 4; i++) {
    const a = Math.PI + (i / (lobes * 4)) * Math.PI;
    const bump = 1 + 0.07 * Math.abs(Math.sin((i / 4) * Math.PI));
    pts.push([cx + Math.cos(a) * 0.92 * s * bump, cy + 0.02 * s + Math.sin(a) * 0.88 * s * bump]);
  }
  pts.push([cx + 0.92 * s, cy + 0.02 * s], [cx + 0.62 * s, cy + 0.35 * s], [cx + 0.32 * s, cy + 0.7 * s]);
  poly(g, pts, '#fbce07', '#dd1d21', s * 0.09);
  g.strokeStyle = '#dd1d21';
  g.lineWidth = s * 0.07;
  g.lineCap = 'round';
  for (let i = 1; i < lobes; i++) {
    const a = Math.PI + (i / lobes) * Math.PI;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 0.12 * s, cy + 0.6 * s);
    g.lineTo(cx + Math.cos(a) * 0.78 * s, cy + 0.02 * s + Math.sin(a) * 0.74 * s);
    g.stroke();
  }
  rr(g, cx - 0.4 * s, cy + 0.66 * s, 0.8 * s, 0.2 * s, 0.05 * s, '#dd1d21');
}
// The golden arches.
function arches(g, x, y, w, h, color) {
  g.strokeStyle = color;
  g.lineWidth = w * 0.13;
  g.lineCap = 'butt';
  g.beginPath();
  const b = y + h;
  const lw = w * 0.065;
  g.moveTo(x + lw, b);
  g.bezierCurveTo(x + lw, y - h * 0.08, x + w * 0.47, y - h * 0.08, x + w * 0.5, y + h * 0.58);
  g.bezierCurveTo(x + w * 0.53, y - h * 0.08, x + w - lw, y - h * 0.08, x + w - lw, b);
  g.stroke();
}
function star(g, cx, cy, r1, r2, n, fill, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  poly(g, pts, fill);
}
function checker(g, x, y, w, h, n, a, b) {
  const s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j * s < h; j++) { g.fillStyle = (i + j) % 2 ? b : a; g.fillRect(x + i * s, y + j * s, s + 0.5, Math.min(s, h - j * s) + 0.5); }
}

// ---------- generic sign makers ----------
// Wide sign: the name in the brand's colours.
function wordmark(text, o = {}) {
  return (g, w, h, c) => {
    bg(g, w, h, hex(o.bg ?? c.main));
    if (o.bar) { g.fillStyle = hex(o.bar); g.fillRect(0, h * 0.84, w, h * 0.16); }
    txt(g, text, w / 2, h * (o.bar ? 0.45 : 0.53), {
      size: h * (o.size ?? 0.6), font: o.font ?? SANS, weight: o.weight ?? 'bold', style: o.style ?? '', color: hex(o.fg ?? c.fg),
      maxW: w * 0.88, spacing: o.spacing ?? 0, stroke: o.stroke != null ? hex(o.stroke) : null, lw: h * 0.06,
    });
  };
}
// Square sign: the name in up to three lines.
function textBadge(text, o = {}) {
  return (g, w, h, c) => {
    bg(g, w, h, hex(o.bg ?? c.main));
    if (o.ring != null) rr(g, w * 0.05, h * 0.05, w * 0.9, h * 0.9, w * 0.1, null, hex(o.ring), w * 0.04);
    const words = text.split(o.split ?? ' ');
    const lines = [];
    for (const wd of words) {
      if (lines.length && (lines[lines.length - 1] + ' ' + wd).length <= (o.perLine ?? 9)) lines[lines.length - 1] += ` ${wd}`;
      else lines.push(wd);
    }
    const n = Math.min(3, lines.length);
    const lh = h * (n === 1 ? 0.36 : n === 2 ? 0.3 : 0.24);
    for (let i = 0; i < n; i++) {
      txt(g, lines[i], w / 2, h / 2 + (i - (n - 1) / 2) * lh * 1.12, { size: lh, font: o.font ?? SANS, weight: o.weight ?? 'bold', style: o.style ?? '', color: hex(o.fg ?? c.fg), maxW: w * 0.84 });
    }
  };
}
// Round emblem with a short text (car makers, banks).
function disc(text, o = {}) {
  return (g, w, h, c) => {
    bg(g, w, h, hex(o.bg ?? 0xffffff));
    ellipse(g, w / 2, h / 2, w * 0.42 * (o.sx ?? 1), h * 0.42, hex(o.disc ?? c.main), o.ring != null ? hex(o.ring) : null, w * 0.04);
    txt(g, text, w / 2, h / 2 + h * 0.02, { size: h * (o.size ?? 0.32), font: o.font ?? SANS, weight: 'bold', style: o.style ?? '', color: hex(o.fg ?? c.fg), maxW: w * 0.66 });
  };
}

// ---------- the brands ----------
// Gas stations: canopy fascia (top to bottom: `bands` as [colour, share of the fascia]),
// pumps, kiosk walls and band, and the price sign.
export const FUEL_DEFAULT = {
  bands: [[0xf2f2f0, 0.7], [0x5b6470, 0.3]], under: 0xf4f4f0, column: 0xe8e8e6, pumpBody: 0xe9e9e6, pumpHead: 0x5b6470,
  kioskWall: 0xe4e2dc, kioskBand: 0x5b6470, priceBody: 0x5b6470,
};

export const BRANDS = [
  // ----- gas -----
  {
    id: 'petrocan', re: /petro[- ]?can/i, kind: 'fuel', c: { main: 0xd71920, fg: 0xffffff, dark: 0x231f20 }, pylon: 'price',
    fuel: { bands: [[0xf5f5f3, 0.58], [0xd71920, 0.42]], column: 0xf2f2f0, pumpHead: 0xd71920, kioskWall: 0xeceae6, kioskBand: 0xd71920, priceBody: 0xd71920 },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      leaf(g, w / 2, h * 0.42, w * 0.34, '#d71920');
      txt(g, 'PETRO-CANADA', w / 2, h * 0.86, { size: h * 0.13, font: SANS, color: '#231f20', maxW: w * 0.9 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      leaf(g, h * 0.62, h * 0.5, h * 0.4, '#d71920');
      txt(g, 'PETRO-CANADA', h * 1.2 + (w - h * 1.2) / 2, h * 0.54, { size: h * 0.42, font: SANS, color: '#231f20', maxW: w - h * 1.4 });
    },
  },
  {
    id: 'shell', re: /^shell\b|\bshell$/i, kind: 'fuel', c: { main: 0xfbce07, fg: 0xdd1d21, red: 0xdd1d21 }, pylon: 'price',
    fuel: { bands: [[0xfbce07, 0.62], [0xdd1d21, 0.38]], column: 0xf2f2f0, pumpHead: 0xdd1d21, pumpBody: 0xf2f2f0, kioskWall: 0xe9e7e2, kioskBand: 0xfbce07, priceBody: 0xfbce07 },
    badge(g, w, h) { bg(g, w, h, '#ffffff'); pecten(g, w / 2, h * 0.5, w * 0.42); },
    word(g, w, h) {
      bg(g, w, h, '#fbce07');
      pecten(g, h * 0.62, h * 0.5, h * 0.4);
      txt(g, 'Shell', h * 1.2 + (w - h * 1.2) / 2, h * 0.53, { size: h * 0.62, font: SANS, color: '#dd1d21', maxW: w - h * 1.5 });
    },
  },
  {
    id: 'esso', re: /\besso\b/i, kind: 'fuel', c: { main: 0x0039a6, fg: 0xffffff, red: 0xe31837 }, pylon: 'price',
    fuel: { bands: [[0xf5f5f3, 0.6], [0xe31837, 0.08], [0x0039a6, 0.32]], column: 0xf2f2f0, pumpHead: 0x0039a6, kioskWall: 0xeceae6, kioskBand: 0x0039a6, priceBody: 0xffffff },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h / 2, w * 0.45, h * 0.3, '#ffffff', '#0039a6', w * 0.05);
      txt(g, 'Esso', w / 2, h * 0.52, { size: h * 0.3, font: BLACK, style: 'italic', color: '#e31837', maxW: w * 0.72 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h / 2, w * 0.3, h * 0.4, '#ffffff', '#0039a6', h * 0.08);
      txt(g, 'Esso', w / 2, h * 0.53, { size: h * 0.5, font: BLACK, style: 'italic', color: '#e31837', maxW: w * 0.5 });
    },
  },
  {
    id: 'husky', re: /\bhusky\b/i, kind: 'fuel', c: { main: 0xd6001c, fg: 0xffffff, blue: 0x0033a0 }, pylon: 'price',
    fuel: { bands: [[0xd6001c, 0.7], [0xffffff, 0.1], [0x0033a0, 0.2]], column: 0xf2f2f0, pumpHead: 0xd6001c, kioskWall: 0xeceae6, kioskBand: 0xd6001c, priceBody: 0xd6001c },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h * 0.42, w * 0.3, h * 0.3, '#0033a0');
      // A husky's head: ears, face and muzzle in white.
      poly(g, [[w * 0.36, h * 0.28], [w * 0.41, h * 0.18], [w * 0.45, h * 0.3], [w * 0.55, h * 0.3], [w * 0.59, h * 0.18], [w * 0.64, h * 0.28], [w * 0.62, h * 0.48], [w * 0.5, h * 0.6], [w * 0.38, h * 0.48]], '#ffffff');
      ellipse(g, w * 0.45, h * 0.38, w * 0.02, h * 0.02, '#0033a0');
      ellipse(g, w * 0.55, h * 0.38, w * 0.02, h * 0.02, '#0033a0');
      ellipse(g, w * 0.5, h * 0.52, w * 0.03, h * 0.025, '#231f20');
      txt(g, 'HUSKY', w / 2, h * 0.85, { size: h * 0.2, font: BLACK, style: 'italic', color: '#d6001c', maxW: w * 0.86 });
    },
    word: wordmark('HUSKY', { font: BLACK, style: 'italic', bar: 0x0033a0 }),
  },
  {
    id: 'chevron', re: /chevron/i, kind: 'fuel', c: { main: 0x0054a4, fg: 0xffffff, red: 0xe1251b }, pylon: 'price',
    fuel: { bands: [[0xf5f5f3, 0.55], [0x0054a4, 0.25], [0xe1251b, 0.2]], column: 0xf2f2f0, pumpHead: 0x0054a4, kioskWall: 0xeceae6, kioskBand: 0x0054a4, priceBody: 0xffffff },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[w * 0.2, h * 0.14], [w * 0.8, h * 0.14], [w * 0.8, h * 0.6], [w * 0.5, h * 0.78], [w * 0.2, h * 0.6]], '#ffffff', '#c8c8c8', w * 0.02);
      poly(g, [[w * 0.22, h * 0.2], [w * 0.5, h * 0.38], [w * 0.78, h * 0.2], [w * 0.78, h * 0.36], [w * 0.5, h * 0.54], [w * 0.22, h * 0.36]], '#0054a4');
      poly(g, [[w * 0.22, h * 0.42], [w * 0.5, h * 0.6], [w * 0.78, h * 0.42], [w * 0.78, h * 0.56], [w * 0.5, h * 0.74], [w * 0.22, h * 0.56]], '#e1251b');
      txt(g, 'Chevron', w / 2, h * 0.89, { size: h * 0.15, font: SANS, color: '#0054a4', maxW: w * 0.8 });
    },
  },
  {
    id: 'mobil', re: /\bmobil\b/i, kind: 'fuel', c: { main: 0x0038a8, fg: 0xffffff, red: 0xee1c25 }, pylon: 'price',
    fuel: { bands: [[0xf5f5f3, 0.62], [0x0038a8, 0.38]], pumpHead: 0x0038a8, kioskBand: 0x0038a8, priceBody: 0xffffff },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      txt(g, 'M', w * 0.3, h * 0.55, { size: h * 0.7, font: SANS, color: '#0038a8' });
      txt(g, 'o', w * 0.45, h * 0.58, { size: h * 0.7, font: SANS, color: '#ee1c25' });
      txt(g, 'bil', w * 0.64, h * 0.55, { size: h * 0.7, font: SANS, color: '#0038a8' });
    },
  },
  { id: 'coop', re: /\bco-?op\b|federated co/i, kind: 'fuel', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'price', text: 'CO-OP', font: BLACK,
    fuel: { bands: [[0xf5f5f3, 0.55], [0xd2232a, 0.45]], pumpHead: 0xd2232a, kioskBand: 0xd2232a, priceBody: 0xd2232a } },
  {
    id: 'seveneleven', re: /7-?eleven/i, kind: 'fuel', c: { main: 0x008163, fg: 0xffffff, orange: 0xf47321, red: 0xee2526 }, pylon: 'price',
    fuel: { bands: [[0xf5f5f3, 0.4], [0xf47321, 0.2], [0x008163, 0.2], [0xee2526, 0.2]], pumpHead: 0x008163, kioskWall: 0xf2f0ea, kioskBand: 0xf47321, kioskStripes: [0xf47321, 0x008163, 0xee2526], priceBody: 0xffffff },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      rr(g, w * 0.04, h * 0.04, w * 0.92, h * 0.92, w * 0.08, null, '#008163', w * 0.05);
      txt(g, '7', w / 2, h * 0.5, { size: h * 0.86, font: BLACK, color: '#f47321', stroke: '#ee2526', lw: w * 0.03 });
      txt(g, 'ELEVEn', w / 2, h * 0.53, { size: h * 0.2, font: BLACK, color: '#008163', maxW: w * 0.84, stroke: '#ffffff', lw: w * 0.03 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      g.fillStyle = '#f47321'; g.fillRect(0, h * 0.7, w, h * 0.1);
      g.fillStyle = '#008163'; g.fillRect(0, h * 0.8, w, h * 0.1);
      g.fillStyle = '#ee2526'; g.fillRect(0, h * 0.9, w, h * 0.1);
      txt(g, '7', w * 0.2, h * 0.38, { size: h * 0.7, font: BLACK, color: '#f47321', stroke: '#ee2526', lw: h * 0.04 });
      txt(g, 'ELEVEn', w * 0.6, h * 0.38, { size: h * 0.46, font: BLACK, color: '#008163', maxW: w * 0.6 });
    },
  },
  {
    id: 'circlek', re: /circle k/i, kind: 'fuel', c: { main: 0xda291c, fg: 0xffffff, orange: 0xf58025 }, pylon: 'price',
    fuel: { bands: [[0xda291c, 0.75], [0xf58025, 0.25]], pumpHead: 0xda291c, kioskBand: 0xda291c, kioskStripes: [0xf58025], priceBody: 0xda291c },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h / 2, w * 0.44, h * 0.44, '#da291c');
      ellipse(g, w / 2, h / 2, w * 0.33, h * 0.33, null, '#ffffff', w * 0.05);
      txt(g, 'K', w / 2, h * 0.53, { size: h * 0.42, font: BLACK, color: '#ffffff' });
      g.strokeStyle = '#f58025'; g.lineWidth = w * 0.05;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    },
    word(g, w, h) {
      bg(g, w, h, '#da291c');
      ellipse(g, h * 0.6, h / 2, h * 0.36, h * 0.36, null, '#ffffff', h * 0.07);
      txt(g, 'K', h * 0.6, h * 0.53, { size: h * 0.42, font: BLACK, color: '#ffffff' });
      txt(g, 'Circle K', h * 1.1 + (w - h * 1.1) / 2, h * 0.53, { size: h * 0.55, font: SANS, color: '#ffffff', maxW: w - h * 1.4 });
    },
  },
  { id: 'domo', re: /\bdomo\b/i, kind: 'fuel', c: { main: 0xe2231a, fg: 0xffffff, yellow: 0xffd200 }, pylon: 'price', text: 'DOMO', font: BLACK,
    fuel: { bands: [[0xe2231a, 0.7], [0xffd200, 0.3]], pumpHead: 0xe2231a, kioskBand: 0xe2231a, priceBody: 0xe2231a } },
  { id: 'fasgas', re: /fas ?gas/i, kind: 'fuel', c: { main: 0xf47b20, fg: 0xffffff, blue: 0x0b3d91 }, pylon: 'price', text: 'FAS GAS', font: BLACK,
    fuel: { bands: [[0xf47b20, 0.65], [0x0b3d91, 0.35]], pumpHead: 0xf47b20, kioskBand: 0xf47b20, priceBody: 0xf47b20 } },
  { id: 'centex', re: /centex/i, kind: 'fuel', c: { main: 0x003a70, fg: 0xffffff }, pylon: 'price', text: 'CENTEX', font: BLACK,
    fuel: { bands: [[0xf5f5f3, 0.6], [0x003a70, 0.4]], pumpHead: 0x003a70, kioskBand: 0x003a70, priceBody: 0x003a70 } },
  { id: 'costcogas', re: /^costco gas/i, kind: 'fuel', c: { main: 0xe31837, fg: 0xffffff, blue: 0x005daa }, pylon: 'price', text: 'COSTCO', font: BLACK,
    fuel: { bands: [[0xf5f5f3, 0.5], [0xe31837, 0.25], [0x005daa, 0.25]], pumpHead: 0xe31837, kioskBand: 0xe31837, priceBody: 0xe31837 } },

  // ----- fast food and coffee -----
  {
    id: 'tims', re: /tim horton/i, kind: 'cafe', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', look: 'tims',
    word: wordmark('Tim Hortons', { font: SCRIPT, weight: 'normal', size: 0.78 }),
    badge(g, w, h) {
      bg(g, w, h, '#c8102e');
      rr(g, w * 0.05, h * 0.05, w * 0.9, h * 0.9, w * 0.08, null, '#ffffff', w * 0.025);
      txt(g, 'Tim', w / 2, h * 0.36, { size: h * 0.36, font: SCRIPT, weight: 'normal', color: '#ffffff', maxW: w * 0.8 });
      txt(g, 'Hortons', w / 2, h * 0.66, { size: h * 0.34, font: SCRIPT, weight: 'normal', color: '#ffffff', maxW: w * 0.84 });
    },
  },
  {
    id: 'mcd', re: /mcdonald/i, kind: 'food', c: { main: 0xda291c, fg: 0xffbc0d, gold: 0xffbc0d, dark: 0x3c3d40 }, pylon: 'tall', look: 'mcd',
    badge(g, w, h) { bg(g, w, h, '#da291c'); arches(g, w * 0.14, h * 0.18, w * 0.72, h * 0.64, '#ffbc0d'); },
    word(g, w, h) {
      bg(g, w, h, '#3c3d40');
      arches(g, h * 0.18, h * 0.16, h * 0.86, h * 0.68, '#ffbc0d');
      txt(g, "McDonald's", h * 1.2 + (w - h * 1.2) / 2, h * 0.54, { size: h * 0.5, font: SANS, color: '#ffffff', maxW: w - h * 1.4 });
    },
  },
  {
    id: 'starbucks', re: /starbucks/i, kind: 'cafe', c: { main: 0x00704a, fg: 0xffffff }, pylon: null, look: 'starbucks',
    badge(g, w, h) {
      bg(g, w, h, '#1e3932');
      const cx = w / 2; const cy = h / 2;
      ellipse(g, cx, cy, w * 0.45, h * 0.45, '#00704a');
      ellipse(g, cx, cy, w * 0.4, h * 0.4, null, '#ffffff', w * 0.025);
      ellipse(g, cx, cy, w * 0.27, h * 0.27, '#ffffff');
      // The siren, simplified: crown, face, hair and twin tails.
      star(g, cx, cy - h * 0.15, w * 0.06, w * 0.028, 5, '#00704a');
      ellipse(g, cx, cy + h * 0.01, w * 0.075, h * 0.09, '#00704a');
      ellipse(g, cx, cy + h * 0.01, w * 0.05, h * 0.065, '#ffffff');
      g.strokeStyle = '#00704a'; g.lineWidth = w * 0.03; g.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + sgn * w * 0.09, cy - h * 0.05);
        g.quadraticCurveTo(cx + sgn * w * 0.2, cy + h * 0.06, cx + sgn * w * 0.12, cy + h * 0.2);
        g.stroke();
      }
      txt(g, 'STARBUCKS', cx, cy - h * 0.335, { size: h * 0.075, font: SANS, color: '#ffffff', maxW: w * 0.5 });
    },
    word(g, w, h) {
      bg(g, w, h, '#1e3932');
      ellipse(g, h * 0.55, h / 2, h * 0.42, h * 0.42, '#00704a');
      ellipse(g, h * 0.55, h / 2, h * 0.25, h * 0.25, '#ffffff');
      star(g, h * 0.55, h * 0.36, h * 0.06, h * 0.025, 5, '#00704a');
      ellipse(g, h * 0.55, h * 0.52, h * 0.07, h * 0.09, '#00704a');
      txt(g, 'STARBUCKS', h * 1.05 + (w - h * 1.05) / 2, h * 0.54, { size: h * 0.42, font: SANS, color: '#ffffff', maxW: w - h * 1.3, spacing: 0.08 });
    },
  },
  {
    id: 'aw', re: /^a ?& ?w\b|a&w restaurant/i, kind: 'food', c: { main: 0xf37021, fg: 0x4b2d19, brown: 0x4b2d19 }, pylon: 'tall', look: 'aw',
    badge(g, w, h) {
      bg(g, w, h, '#f37021');
      ellipse(g, w / 2, h / 2, w * 0.44, h * 0.36, '#4b2d19');
      ellipse(g, w / 2, h / 2, w * 0.4, h * 0.32, '#f37021');
      txt(g, 'A&W', w / 2, h * 0.53, { size: h * 0.3, font: BLACK, color: '#4b2d19', maxW: w * 0.72, stroke: '#ffffff', lw: w * 0.03 });
    },
    word(g, w, h) {
      bg(g, w, h, '#f37021');
      ellipse(g, w / 2, h / 2, w * 0.24, h * 0.42, '#4b2d19');
      ellipse(g, w / 2, h / 2, w * 0.215, h * 0.36, '#f37021');
      txt(g, 'A&W', w / 2, h * 0.54, { size: h * 0.5, font: BLACK, color: '#4b2d19', maxW: w * 0.38, stroke: '#ffffff', lw: h * 0.05 });
    },
  },
  {
    id: 'wendys', re: /\bwendy'?s\b/i, kind: 'food', c: { main: 0xe2203d, fg: 0xffffff }, pylon: 'tall', look: 'wendys',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      const cx = w / 2; const cy = h * 0.4;
      ellipse(g, cx - w * 0.2, cy + h * 0.05, w * 0.09, h * 0.12, '#e2203d');
      ellipse(g, cx + w * 0.2, cy + h * 0.05, w * 0.09, h * 0.12, '#e2203d');
      ellipse(g, cx, cy - h * 0.06, w * 0.19, h * 0.17, '#e2203d');
      ellipse(g, cx, cy + h * 0.03, w * 0.15, h * 0.16, '#f8d5b8');
      ellipse(g, cx - w * 0.05, cy + h * 0.02, w * 0.018, h * 0.022, '#2a3b8f');
      ellipse(g, cx + w * 0.05, cy + h * 0.02, w * 0.018, h * 0.022, '#2a3b8f');
      g.strokeStyle = '#c0392b'; g.lineWidth = w * 0.012;
      g.beginPath(); g.arc(cx, cy + h * 0.07, w * 0.05, 0.2, Math.PI - 0.2); g.stroke();
      txt(g, "Wendy's", cx, h * 0.83, { size: h * 0.22, font: SCRIPT, weight: 'normal', color: '#e2203d', maxW: w * 0.86 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      txt(g, "Wendy's", w / 2, h * 0.54, { size: h * 0.78, font: SCRIPT, weight: 'normal', color: '#e2203d', maxW: w * 0.86 });
    },
  },
  {
    id: 'kfc', re: /\bkfc\b|kentucky fried/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', look: 'kfc',
    badge(g, w, h) {
      bg(g, w, h, '#c8102e');
      const cx = w / 2; const cy = h * 0.4;
      ellipse(g, cx, cy, w * 0.24, h * 0.26, '#ffffff');
      ellipse(g, cx, cy - h * 0.01, w * 0.17, h * 0.2, '#f6d9c2');
      g.fillStyle = '#ffffff';
      g.beginPath(); g.moveTo(cx - w * 0.1, cy + h * 0.08); g.quadraticCurveTo(cx, cy + h * 0.3, cx + w * 0.1, cy + h * 0.08); g.fill();
      g.strokeStyle = '#1a1a1a'; g.lineWidth = w * 0.018;
      rr(g, cx - w * 0.13, cy - h * 0.05, w * 0.1, h * 0.06, w * 0.02, null, '#1a1a1a', w * 0.016);
      rr(g, cx + w * 0.03, cy - h * 0.05, w * 0.1, h * 0.06, w * 0.02, null, '#1a1a1a', w * 0.016);
      poly(g, [[cx - w * 0.08, cy + h * 0.25], [cx, cy + h * 0.29], [cx + w * 0.08, cy + h * 0.25], [cx + w * 0.08, cy + h * 0.33], [cx, cy + h * 0.29], [cx - w * 0.08, cy + h * 0.33]], '#1a1a1a');
      txt(g, 'KFC', cx, h * 0.86, { size: h * 0.22, font: BLACK, color: '#ffffff', maxW: w * 0.8 });
    },
    word(g, w, h) {
      bg(g, w, h, '#c8102e');
      txt(g, 'KFC', w / 2, h * 0.55, { size: h * 0.78, font: BLACK, color: '#ffffff', maxW: w * 0.6 });
    },
  },
  {
    id: 'tacobell', re: /taco bell/i, kind: 'food', c: { main: 0x702082, fg: 0xffffff, pink: 0xea4b9b }, pylon: 'tall', look: 'tacobell',
    badge(g, w, h) {
      bg(g, w, h, '#702082');
      const cx = w / 2; const cy = h * 0.42;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(cx - w * 0.27, cy + h * 0.2);
      g.quadraticCurveTo(cx - w * 0.17, cy + h * 0.12, cx - w * 0.15, cy - h * 0.06);
      g.quadraticCurveTo(cx - w * 0.13, cy - h * 0.26, cx, cy - h * 0.26);
      g.quadraticCurveTo(cx + w * 0.13, cy - h * 0.26, cx + w * 0.15, cy - h * 0.06);
      g.quadraticCurveTo(cx + w * 0.17, cy + h * 0.12, cx + w * 0.27, cy + h * 0.2);
      g.closePath();
      g.fill();
      ellipse(g, cx, cy + h * 0.24, w * 0.06, h * 0.045, '#ffffff');
      txt(g, 'TACO BELL', cx, h * 0.85, { size: h * 0.15, font: BLACK, color: '#ffffff', maxW: w * 0.86 });
    },
    word(g, w, h) {
      bg(g, w, h, '#702082');
      txt(g, 'TACO BELL', w / 2, h * 0.55, { size: h * 0.5, font: BLACK, color: '#ffffff', maxW: w * 0.84 });
    },
  },
  {
    id: 'subway', re: /\bsubway\b/i, kind: 'food', c: { main: 0x008c15, fg: 0xffc20e }, pylon: null, look: 'generic',
    word(g, w, h) {
      bg(g, w, h, '#008c15');
      txt(g, 'SUB', w * 0.5, h * 0.55, { size: h * 0.62, font: BLACK, style: 'italic', color: '#ffc20e', align: 'right' });
      txt(g, 'WAY', w * 0.5, h * 0.55, { size: h * 0.62, font: BLACK, style: 'italic', color: '#ffffff', align: 'left' });
    },
  },
  { id: 'popeyes', re: /popeyes/i, kind: 'food', c: { main: 0xf25600, fg: 0xffffff }, pylon: 'tall', look: 'popeyes', text: 'Popeyes', font: ROUND },
  {
    id: 'harveys', re: /\bharvey'?s\b/i, kind: 'food', c: { main: 0xd7282f, fg: 0xffffff, yellow: 0xffc72c }, pylon: 'tall', look: 'harveys',
    word(g, w, h) {
      bg(g, w, h, '#d7282f');
      txt(g, "Harvey's", w / 2, h * 0.48, { size: h * 0.66, font: SERIF, style: 'italic', color: '#ffffff', maxW: w * 0.84 });
      g.strokeStyle = '#ffc72c'; g.lineWidth = h * 0.07; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w * 0.2, h * 0.8); g.quadraticCurveTo(w * 0.5, h * 0.93, w * 0.8, h * 0.78); g.stroke();
    },
  },
  {
    id: 'dq', re: /dairy queen|^dq\b/i, kind: 'food', c: { main: 0xee3124, fg: 0xffffff, blue: 0x1d5daa }, pylon: 'tall', look: 'dq',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      g.fillStyle = '#ee3124';
      g.beginPath();
      g.moveTo(w * 0.05, h * 0.5);
      g.quadraticCurveTo(w * 0.5, h * 0.06, w * 0.95, h * 0.5);
      g.quadraticCurveTo(w * 0.5, h * 0.94, w * 0.05, h * 0.5);
      g.fill();
      txt(g, 'DQ', w / 2, h * 0.52, { size: h * 0.3, font: BLACK, style: 'italic', color: '#ffffff' });
    },
  },
  {
    id: 'bostonpizza', re: /boston pizza/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff, dark: 0x231f20 }, pylon: 'tall', look: 'bostonpizza',
    badge(g, w, h) {
      bg(g, w, h, '#231f20');
      ellipse(g, w / 2, h * 0.42, w * 0.28, h * 0.28, '#c8102e');
      txt(g, 'BP', w / 2, h * 0.44, { size: h * 0.3, font: SERIF, color: '#ffffff' });
      txt(g, 'Boston Pizza', w / 2, h * 0.85, { size: h * 0.14, font: SERIF, color: '#ffffff', maxW: w * 0.86 });
    },
    word: wordmark('Boston Pizza', { font: SERIF, bg: 0x231f20, fg: 0xffffff, bar: 0xc8102e }),
  },
  {
    id: 'fiveguys', re: /five guys/i, kind: 'food', c: { main: 0xd21033, fg: 0xffffff }, pylon: null, look: 'fiveguys',
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      checker(g, 0, 0, w, h * 0.16, 32, '#d21033', '#ffffff');
      checker(g, 0, h * 0.84, w, h * 0.16, 32, '#ffffff', '#d21033');
      txt(g, 'FIVE GUYS', w / 2, h * 0.53, { size: h * 0.5, font: BLACK, color: '#d21033', maxW: w * 0.86 });
    },
  },
  {
    id: 'bk', re: /burger king/i, kind: 'food', c: { main: 0xd62300, fg: 0xffffff, bun: 0xf5a623 }, pylon: 'tall', look: 'generic',
    badge(g, w, h) {
      bg(g, w, h, '#502314');
      g.fillStyle = '#f5a623';
      g.beginPath(); g.ellipse(w / 2, h * 0.36, w * 0.4, h * 0.22, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.ellipse(w / 2, h * 0.64, w * 0.4, h * 0.16, 0, 0, Math.PI); g.fill();
      txt(g, 'BURGER', w / 2, h * 0.43, { size: h * 0.13, font: BLACK, color: '#d62300', maxW: w * 0.8 });
      txt(g, 'KING', w / 2, h * 0.56, { size: h * 0.13, font: BLACK, color: '#d62300', maxW: w * 0.8 });
    },
  },
  {
    id: 'arbys', re: /\barby'?s\b/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', look: 'generic',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      g.fillStyle = '#d2232a';
      g.beginPath();
      g.moveTo(w * 0.1, h * 0.5); g.quadraticCurveTo(w * 0.2, h * 0.38, w * 0.3, h * 0.45);
      g.quadraticCurveTo(w * 0.3, h * 0.12, w * 0.5, h * 0.14); g.quadraticCurveTo(w * 0.7, h * 0.12, w * 0.7, h * 0.45);
      g.quadraticCurveTo(w * 0.8, h * 0.38, w * 0.9, h * 0.5); g.quadraticCurveTo(w * 0.5, h * 0.62, w * 0.1, h * 0.5);
      g.fill();
      txt(g, "Arby's", w / 2, h * 0.76, { size: h * 0.24, font: SCRIPT, weight: 'normal', color: '#d2232a', maxW: w * 0.84 });
    },
  },
  { id: 'carlsjr', re: /carl'?s jr/i, kind: 'food', c: { main: 0xffc72c, fg: 0xd2232a }, pylon: 'tall', look: 'generic', text: "Carl's Jr.", font: BLACK },
  { id: 'chipotle', re: /chipotle/i, kind: 'food', c: { main: 0xa81612, fg: 0xffffff }, pylon: null, look: 'generic', text: 'CHIPOTLE', font: SANS },
  {
    id: 'krispykreme', re: /krispy kreme/i, kind: 'food', c: { main: 0x00704a, fg: 0xffffff, red: 0xd2232a }, pylon: null, look: 'generic',
    word(g, w, h) {
      bg(g, w, h, '#00704a');
      ellipse(g, w / 2, h / 2, w * 0.36, h * 0.4, '#d2232a', '#ffffff', h * 0.05);
      txt(g, 'Krispy Kreme', w / 2, h * 0.53, { size: h * 0.46, font: SCRIPT, weight: 'normal', color: '#ffffff', maxW: w * 0.6 });
    },
  },
  { id: 'secondcup', re: /second cup/i, kind: 'cafe', c: { main: 0x5b1f2b, fg: 0xffffff }, pylon: null, look: 'generic', text: 'Second Cup', font: SERIF },
  { id: 'dennys', re: /\bdenny'?s\b/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffd200 }, pylon: 'tall', look: 'generic', text: "Denny's", font: SCRIPT, weight: 'normal' },
  {
    id: 'swisschalet', re: /swiss chalet/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', look: 'swisschalet',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[w * 0.12, h * 0.48], [w * 0.5, h * 0.14], [w * 0.88, h * 0.48], [w * 0.76, h * 0.48], [w * 0.5, h * 0.26], [w * 0.24, h * 0.48]], '#d2232a');
      txt(g, 'Swiss', w / 2, h * 0.62, { size: h * 0.18, font: SERIF, color: '#d2232a' });
      txt(g, 'Chalet', w / 2, h * 0.8, { size: h * 0.18, font: SERIF, color: '#d2232a' });
    },
  },
  { id: 'keg', re: /the keg\b/i, kind: 'food', c: { main: 0x231f20, fg: 0xffffff }, pylon: null, look: 'keg', text: 'THE KEG', font: SERIF },
  { id: 'olivegarden', re: /olive garden/i, kind: 'food', c: { main: 0x5c6f2b, fg: 0xffffff }, pylon: 'tall', look: 'tuscan', text: 'Olive Garden', font: SCRIPT, weight: 'normal' },
  { id: 'redlobster', re: /red lobster/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: 'Red Lobster', font: SCRIPT, weight: 'normal' },
  { id: 'ihop', re: /\bihop\b/i, kind: 'food', c: { main: 0x1b4f9c, fg: 0xffffff, red: 0xd2232a }, pylon: 'tall', look: 'ihop',
    word(g, w, h) { bg(g, w, h, '#1b4f9c'); txt(g, 'IHOP', w / 2, h * 0.5, { size: h * 0.66, font: ROUND, color: '#ffffff' }); g.strokeStyle = '#d2232a'; g.lineWidth = h * 0.08; g.lineCap = 'round'; g.beginPath(); g.moveTo(w * 0.36, h * 0.8); g.quadraticCurveTo(w * 0.5, h * 0.92, w * 0.64, h * 0.8); g.stroke(); } },
  { id: 'whitespot', re: /white spot/i, kind: 'food', c: { main: 0x00573f, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: 'White Spot', font: SCRIPT, weight: 'normal' },
  { id: 'pizza73', re: /pizza ?73/i, kind: 'food', c: { main: 0xf26522, fg: 0xffffff }, pylon: null, look: 'generic', text: 'PIZZA 73', font: BLACK },
  { id: 'pizzahut', re: /pizza hut/i, kind: 'food', c: { main: 0xee3124, fg: 0xffffff }, pylon: 'tall', look: 'pizzahut', text: 'Pizza Hut', font: SANS },
  { id: 'dominos', re: /domino'?s/i, kind: 'food', c: { main: 0x006491, fg: 0xffffff }, pylon: null, look: 'generic', text: "Domino's", font: BLACK },
  { id: 'mucho', re: /mucho burrito/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: null, look: 'generic', text: 'MUCHO BURRITO', font: BLACK },
  { id: 'fatburger', re: /fatburger/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'FATBURGER', font: BLACK },
  { id: 'osmows', re: /osmow/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: null, look: 'generic', text: "OSMOW'S", font: BLACK },
  { id: 'jollibee', re: /jollibee/i, kind: 'food', c: { main: 0xe31837, fg: 0xffd200 }, pylon: 'tall', look: 'generic', text: 'Jollibee', font: ROUND },
  { id: 'boosterjuice', re: /booster juice/i, kind: 'food', c: { main: 0xe2231a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'BOOSTER JUICE', font: BLACK },
  { id: 'quiznos', re: /quiznos/i, kind: 'food', c: { main: 0x00573f, fg: 0xffffff }, pylon: null, look: 'generic', text: 'QUIZNOS', font: BLACK },
  { id: 'mrsub', re: /mr\.? sub\b/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'Mr. Sub', font: BLACK },
  { id: 'freshii', re: /freshii/i, kind: 'food', c: { main: 0x6cb33f, fg: 0xffffff }, pylon: null, look: 'generic', text: 'freshii', font: ROUND },
  { id: 'chopped', re: /chopped leaf/i, kind: 'food', c: { main: 0x4a7c2a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'The Chopped Leaf', font: SANS },
  { id: 'panago', re: /panago/i, kind: 'food', c: { main: 0x006a4e, fg: 0xffffff }, pylon: null, look: 'generic', text: 'PANAGO', font: BLACK },
  { id: 'tacotime', re: /taco time/i, kind: 'food', c: { main: 0x00843d, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: 'TACO TIME', font: BLACK },
  { id: 'earls', re: /^earls\b/i, kind: 'food', c: { main: 0x1a1a1a, fg: 0xffffff }, pylon: null, look: 'keg', text: 'EARLS', font: SANS },
  { id: 'cora', re: /^cora\b/i, kind: 'food', c: { main: 0xffc20e, fg: 0x7a3e00 }, pylon: 'tall', look: 'generic', text: 'Cora', font: ROUND },
  { id: 'montanas', re: /montana'?s/i, kind: 'food', c: { main: 0x5b2a1a, fg: 0xffffff }, pylon: 'tall', look: 'keg', text: "Montana's", font: SERIF },
  { id: 'originaljoes', re: /original joe'?s/i, kind: 'food', c: { main: 0x1a1a1a, fg: 0xf7a823 }, pylon: null, look: 'keg', text: "ORIGINAL JOE'S", font: BLACK },
  { id: 'thaiexpress', re: /tha[iï] express/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'Thaï Express', font: SANS },
  { id: 'nyfries', re: /new york fries/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'NEW YORK FRIES', font: BLACK },
  { id: 'extremepita', re: /extreme pita/i, kind: 'food', c: { main: 0xe2231a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'EXTREME PITA', font: BLACK },
  { id: 'pitapit', re: /pita pit/i, kind: 'food', c: { main: 0x00843d, fg: 0xffffff }, pylon: null, look: 'generic', text: 'PITA PIT', font: BLACK },
  { id: 'firehouse', re: /firehouse subs/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: null, look: 'generic', text: 'FIREHOUSE SUBS', font: BLACK },
  { id: 'nandos', re: /nando'?s/i, kind: 'food', c: { main: 0x231f20, fg: 0xffffff }, pylon: null, look: 'generic', text: "NANDO'S", font: BLACK },
  { id: 'barburrito', re: /barburrito/i, kind: 'food', c: { main: 0x231f20, fg: 0xffc20e }, pylon: null, look: 'generic', text: 'BARBURRITO', font: BLACK },
  { id: 'goodearth', re: /good earth/i, kind: 'cafe', c: { main: 0x4a7c2a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'Good Earth', font: SERIF },
  { id: 'cobs', re: /cobs bread/i, kind: 'food', c: { main: 0x7a4b2a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'COBS Bread', font: SANS },
  { id: 'littlecaesars', re: /little caesars/i, kind: 'food', c: { main: 0xf26722, fg: 0xffffff }, pylon: null, look: 'generic', text: 'Little Caesars', font: BLACK },
  { id: 'marybrowns', re: /mary brown/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Mary Brown's", font: SCRIPT, weight: 'normal' },
  { id: 'edo', re: /^edo\b|edo japan/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'EDO JAPAN', font: BLACK },
  { id: 'humptys', re: /\bhumpty'?s\b/i, kind: 'food', c: { main: 0xf7a823, fg: 0x5b2a1a }, pylon: 'tall', look: 'generic', text: "Humpty's", font: ROUND },
  { id: 'rickys', re: /\bricky'?s\b/i, kind: 'food', c: { main: 0x5b2a1a, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Ricky's", font: SCRIPT, weight: 'normal' },
  { id: 'smittys', re: /\bsmitty'?s\b/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Smitty's", font: SCRIPT, weight: 'normal' },
  { id: 'cactusclub', re: /cactus club/i, kind: 'food', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, look: 'keg', text: 'CACTUS CLUB CAFE', font: SANS },
  { id: 'joey', re: /^joey\b/i, kind: 'food', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, look: 'keg', text: 'JOEY', font: SANS },
  { id: 'moxies', re: /moxie'?s/i, kind: 'food', c: { main: 0x8b1d41, fg: 0xffffff }, pylon: null, look: 'keg', text: "MOXIES", font: SANS },
  { id: 'browns', re: /browns socialhouse/i, kind: 'food', c: { main: 0x3e2a1e, fg: 0xffffff }, pylon: null, look: 'keg', text: 'BROWNS', font: SERIF },
  { id: 'eastsidemarios', re: /east side mario/i, kind: 'food', c: { main: 0x00843d, fg: 0xffffff }, pylon: 'tall', look: 'tuscan', text: "East Side Mario's", font: SERIF },
  { id: 'kelseys', re: /\bkelsey'?s\b/i, kind: 'food', c: { main: 0x1c1c1e, fg: 0xf7a823 }, pylon: 'tall', look: 'keg', text: "Kelseys", font: SERIF },
  { id: 'applebees', re: /applebee'?s/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Applebee's", font: SANS },
  { id: 'chilis', re: /\bchili'?s\b/i, kind: 'food', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Chili's", font: SANS },
  { id: 'opa', re: /^opa!?\b/i, kind: 'food', c: { main: 0x0067b1, fg: 0xffffff }, pylon: null, look: 'generic', text: 'OPA!', font: BLACK },
  { id: 'quesada', re: /quesada/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, look: 'generic', text: 'QUESADA', font: BLACK },
  { id: 'wingstop', re: /wingstop/i, kind: 'food', c: { main: 0x006a4e, fg: 0xffffff }, pylon: null, look: 'generic', text: 'WINGSTOP', font: BLACK },
  { id: 'churchs', re: /church'?s (texas )?chicken/i, kind: 'food', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', look: 'generic', text: "Church's Chicken", font: SANS },

  // ----- banks -----
  {
    id: 'td', re: /^td\b|td canada trust|toronto-dominion/i, kind: 'bank', c: { main: 0x008a3e, fg: 0xffffff }, pylon: 'low', look: 'bank',
    badge(g, w, h) {
      bg(g, w, h, '#008a3e');
      rr(g, w * 0.08, h * 0.08, w * 0.84, h * 0.84, w * 0.06, null, '#ffffff', w * 0.03);
      txt(g, 'TD', w / 2, h * 0.54, { size: h * 0.5, font: SERIF, color: '#ffffff' });
    },
    word(g, w, h) {
      bg(g, w, h, '#008a3e');
      rr(g, h * 0.15, h * 0.15, h * 0.7, h * 0.7, h * 0.06, null, '#ffffff', h * 0.05);
      txt(g, 'TD', h * 0.5, h * 0.54, { size: h * 0.42, font: SERIF, color: '#ffffff' });
      txt(g, 'TD Canada Trust', h + (w - h) / 2, h * 0.54, { size: h * 0.36, font: SANS, color: '#ffffff', maxW: w - h * 1.2 });
    },
  },
  {
    id: 'rbc', re: /\brbc\b|royal bank/i, kind: 'bank', c: { main: 0x005daa, fg: 0xffd200 }, pylon: 'low', look: 'bank',
    badge(g, w, h) {
      bg(g, w, h, '#005daa');
      ellipse(g, w / 2, h * 0.34, w * 0.18, h * 0.18, '#ffd200');
      ellipse(g, w / 2, h * 0.34, w * 0.12, h * 0.12, '#005daa');
      star(g, w / 2, h * 0.34, w * 0.09, w * 0.04, 5, '#ffd200');
      txt(g, 'RBC', w / 2, h * 0.74, { size: h * 0.3, font: BLACK, color: '#ffffff' });
    },
    word(g, w, h) {
      bg(g, w, h, '#005daa');
      ellipse(g, h * 0.55, h / 2, h * 0.32, h * 0.32, '#ffd200');
      txt(g, 'RBC', h * 0.55, h * 0.54, { size: h * 0.28, font: BLACK, color: '#005daa' });
      txt(g, 'RBC Royal Bank', h * 1.05 + (w - h * 1.05) / 2, h * 0.54, { size: h * 0.38, font: SANS, color: '#ffffff', maxW: w - h * 1.3 });
    },
  },
  {
    id: 'cibc', re: /\bcibc\b/i, kind: 'bank', c: { main: 0x8b1d41, fg: 0xffffff, red: 0xc41f3e }, pylon: 'low', look: 'bank',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[w * 0.3, h * 0.12], [w * 0.62, h * 0.12], [w * 0.5, h * 0.42], [w * 0.18, h * 0.42]], '#c41f3e');
      poly(g, [[w * 0.42, h * 0.12], [w * 0.8, h * 0.12], [w * 0.68, h * 0.42], [w * 0.3, h * 0.42]], '#8b1d41');
      txt(g, 'CIBC', w / 2, h * 0.7, { size: h * 0.3, font: SANS, color: '#8b1d41' });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[h * 0.3, h * 0.2], [h * 0.8, h * 0.2], [h * 0.62, h * 0.8], [h * 0.12, h * 0.8]], '#c41f3e');
      poly(g, [[h * 0.6, h * 0.2], [h * 1.1, h * 0.2], [h * 0.92, h * 0.8], [h * 0.42, h * 0.8]], '#8b1d41');
      txt(g, 'CIBC', h * 1.3 + (w - h * 1.3) / 2, h * 0.54, { size: h * 0.58, font: SANS, color: '#8b1d41', maxW: w - h * 1.5 });
    },
  },
  {
    id: 'scotia', re: /scotia/i, kind: 'bank', c: { main: 0xec111a, fg: 0xffffff }, pylon: 'low', look: 'bank',
    badge(g, w, h) {
      bg(g, w, h, '#ec111a');
      ellipse(g, w / 2, h * 0.42, w * 0.26, h * 0.26, '#ffffff');
      txt(g, 'S', w / 2, h * 0.44, { size: h * 0.36, font: SANS, color: '#ec111a' });
      txt(g, 'Scotiabank', w / 2, h * 0.84, { size: h * 0.14, font: SANS, color: '#ffffff', maxW: w * 0.86 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, h * 0.55, h / 2, h * 0.34, h * 0.34, '#ec111a');
      txt(g, 'S', h * 0.55, h * 0.53, { size: h * 0.44, font: SANS, color: '#ffffff' });
      txt(g, 'Scotiabank', h * 1.05 + (w - h * 1.05) / 2, h * 0.54, { size: h * 0.46, font: SANS, color: '#ec111a', maxW: w - h * 1.3 });
    },
  },
  {
    id: 'bmo', re: /\bbmo\b|bank of montreal/i, kind: 'bank', c: { main: 0x0079c1, fg: 0xffffff, red: 0xed1c24 }, pylon: 'low', look: 'bank',
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h * 0.42, w * 0.32, h * 0.32, '#0079c1');
      poly(g, [[w * 0.33, h * 0.56], [w * 0.33, h * 0.3], [w * 0.5, h * 0.44], [w * 0.67, h * 0.3], [w * 0.67, h * 0.56], [w * 0.6, h * 0.56], [w * 0.6, h * 0.42], [w * 0.5, h * 0.52], [w * 0.4, h * 0.42], [w * 0.4, h * 0.56]], '#ffffff');
      g.fillStyle = '#ed1c24'; g.fillRect(w * 0.33, h * 0.6, w * 0.34, h * 0.05);
      txt(g, 'BMO', w / 2, h * 0.87, { size: h * 0.17, font: SANS, color: '#0079c1' });
    },
    word: wordmark('BMO', { bg: 0x0079c1, fg: 0xffffff, bar: 0xed1c24, font: SANS }),
  },
  { id: 'atb', re: /\batb\b/i, kind: 'bank', c: { main: 0x00315f, fg: 0xffffff, orange: 0xf7941d }, pylon: 'low', look: 'bank', text: 'ATB', font: BLACK, sub: 0xf7941d },
  { id: 'servus', re: /servus/i, kind: 'bank', c: { main: 0x003a63, fg: 0xffffff, green: 0x8dc63f }, pylon: 'low', look: 'bank', text: 'servus', font: ROUND, sub: 0x8dc63f },
  { id: 'nationalbank', re: /national bank/i, kind: 'bank', c: { main: 0xe41c23, fg: 0xffffff }, pylon: 'low', look: 'bank', text: 'NATIONAL BANK', font: SANS },
  { id: 'tangerine', re: /tangerine/i, kind: 'bank', c: { main: 0xf28c28, fg: 0xffffff }, pylon: 'low', look: 'bank', text: 'Tangerine', font: ROUND },
  { id: 'hsbc', re: /\bhsbc\b/i, kind: 'bank', c: { main: 0xdb0011, fg: 0xffffff }, pylon: 'low', look: 'bank', text: 'HSBC', font: SANS },
  { id: 'canadapost', re: /canada post|postes canada/i, kind: 'service', c: { main: 0xda291c, fg: 0xffffff }, pylon: null, look: 'bank', text: 'CANADA POST', font: SANS },
  { id: 'edwardjones', re: /edward jones/i, kind: 'bank', c: { main: 0x1b4332, fg: 0xffd200 }, pylon: null, look: 'bank', text: 'EDWARD JONES', font: SERIF },
  { id: 'cwb', re: /canadian western bank|\bcwb\b/i, kind: 'bank', c: { main: 0x00539b, fg: 0xffffff }, pylon: 'low', look: 'bank', text: 'CWB', font: SANS },
  { id: 'connectfirst', re: /connect first/i, kind: 'bank', c: { main: 0x00843d, fg: 0xffffff }, pylon: 'low', look: 'bank', text: 'connect first', font: ROUND },

  // ----- pharmacies, grocery, big boxes -----
  {
    id: 'shoppers', re: /shoppers drug mart|^shoppers\b/i, kind: 'pharmacy', c: { main: 0xe31837, fg: 0xffffff }, pylon: 'tall', box: { wall: 0xe8e4dc, band: 0xe31837 },
    word(g, w, h) {
      bg(g, w, h, '#e31837');
      txt(g, 'SHOPPERS', w / 2, h * 0.4, { size: h * 0.48, font: SANS, color: '#ffffff', maxW: w * 0.86 });
      txt(g, 'DRUG MART', w / 2, h * 0.8, { size: h * 0.24, font: SANS, color: '#ffffff', maxW: w * 0.6, spacing: 0.2 });
    },
  },
  { id: 'rexall', re: /\brexall\b/i, kind: 'pharmacy', c: { main: 0x00539b, fg: 0xffffff }, pylon: 'tall', text: 'Rexall', font: SANS, box: { wall: 0xe6e4de, band: 0x00539b } },
  { id: 'londondrugs', re: /london drugs/i, kind: 'pharmacy', c: { main: 0x0057a8, fg: 0xffffff }, pylon: 'tall', text: 'LONDON DRUGS', font: SANS, box: { wall: 0xe2dfd8, band: 0x0057a8 } },
  { id: 'pharmasave', re: /pharmasave/i, kind: 'pharmacy', c: { main: 0x0067b1, fg: 0xffffff }, pylon: null, text: 'Pharmasave', font: SANS },
  {
    id: 'ct', re: /canadian tire/i, kind: 'retail', c: { main: 0xd71920, fg: 0xffffff, green: 0x00843d }, pylon: 'tall', box: { wall: 0xeeece6, band: 0xd71920 },
    fuel: { bands: [[0xf5f5f3, 0.55], [0xd71920, 0.45]], pumpHead: 0xd71920, kioskBand: 0xd71920, priceBody: 0xd71920 },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[w * 0.1, h * 0.14], [w * 0.9, h * 0.14], [w * 0.5, h * 0.86]], '#d71920');
      leaf(g, w * 0.5, h * 0.38, w * 0.15, '#00843d', '#ffffff', w * 0.02);
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      poly(g, [[h * 0.12, h * 0.14], [h * 1.02, h * 0.14], [h * 0.57, h * 0.88]], '#d71920');
      leaf(g, h * 0.57, h * 0.4, h * 0.17, '#00843d', '#ffffff', h * 0.025);
      txt(g, 'CANADIAN TIRE', h * 1.12 + (w - h * 1.12) / 2, h * 0.54, { size: h * 0.44, font: SANS, style: 'italic', color: '#d71920', maxW: w - h * 1.3 });
    },
  },
  {
    id: 'homedepot', re: /home depot/i, kind: 'retail', c: { main: 0xf96302, fg: 0xffffff }, pylon: 'tall', box: { wall: 0xe4dfd5, band: 0xf96302 },
    badge(g, w, h) {
      bg(g, w, h, '#f96302');
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-0.2);
      txt(g, 'THE', -w * 0.18, -h * 0.22, { size: h * 0.12, font: IMPACT, weight: 'normal', color: '#ffffff' });
      txt(g, 'HOME', 0, -h * 0.04, { size: h * 0.26, font: IMPACT, weight: 'normal', color: '#ffffff', maxW: w * 0.8 });
      txt(g, 'DEPOT', 0, h * 0.2, { size: h * 0.22, font: IMPACT, weight: 'normal', color: '#ffffff', maxW: w * 0.74 });
      g.restore();
    },
    word: wordmark('THE HOME DEPOT', { font: IMPACT, weight: 'normal', size: 0.62 }),
  },
  {
    id: 'ikea', re: /\bikea\b/i, kind: 'retail', c: { main: 0x0058a3, fg: 0xffdb00 }, pylon: 'tall', box: { wall: 0x0058a3, band: 0xffdb00 },
    word(g, w, h) {
      bg(g, w, h, '#0058a3');
      ellipse(g, w / 2, h / 2, w * 0.4, h * 0.38, '#ffdb00');
      txt(g, 'IKEA', w / 2, h * 0.53, { size: h * 0.54, font: SANS, color: '#0058a3', maxW: w * 0.6 });
    },
  },
  { id: 'staples', re: /\bstaples\b/i, kind: 'retail', c: { main: 0xcc0000, fg: 0xffffff }, pylon: 'tall', text: 'Staples', font: SANS, box: { wall: 0xe8e6e0, band: 0xcc0000 } },
  {
    id: 'bestbuy', re: /best buy/i, kind: 'retail', c: { main: 0x0046be, fg: 0xfff200 }, pylon: 'tall', box: { wall: 0x1d3f8f, band: 0x0046be },
    badge(g, w, h) {
      bg(g, w, h, '#0046be');
      poly(g, [[w * 0.1, h * 0.3], [w * 0.78, h * 0.3], [w * 0.92, h * 0.5], [w * 0.78, h * 0.7], [w * 0.1, h * 0.7]], '#fff200');
      ellipse(g, w * 0.8, h * 0.5, w * 0.025, h * 0.025, '#0046be');
      txt(g, 'BEST', w * 0.43, h * 0.42, { size: h * 0.16, font: BLACK, color: '#000000', maxW: w * 0.6 });
      txt(g, 'BUY', w * 0.43, h * 0.59, { size: h * 0.16, font: BLACK, color: '#000000', maxW: w * 0.6 });
    },
    word(g, w, h) {
      bg(g, w, h, '#0046be');
      poly(g, [[w * 0.12, h * 0.12], [w * 0.76, h * 0.12], [w * 0.88, h * 0.5], [w * 0.76, h * 0.88], [w * 0.12, h * 0.88]], '#fff200');
      ellipse(g, w * 0.79, h * 0.5, h * 0.06, h * 0.06, '#0046be');
      txt(g, 'BEST BUY', w * 0.44, h * 0.54, { size: h * 0.5, font: BLACK, color: '#000000', maxW: w * 0.58 });
    },
  },
  { id: 'petsmart', re: /petsmart/i, kind: 'retail', c: { main: 0xe2231a, fg: 0xffffff }, pylon: 'tall', text: 'PETSMART', font: BLACK, box: { wall: 0xe6e2da, band: 0xe2231a } },
  {
    id: 'superstore', re: /superstore|^loblaw/i, kind: 'grocery', c: { main: 0xffd200, fg: 0xe31837 }, pylon: 'tall', box: { wall: 0xeee4a8, band: 0xe31837, portal: 0xffc20e },
    word(g, w, h) {
      bg(g, w, h, '#ffd200');
      txt(g, 'Real Canadian', w / 2, h * 0.26, { size: h * 0.22, font: SANS, color: '#1c1c1e', maxW: w * 0.8 });
      txt(g, 'SUPERSTORE', w / 2, h * 0.66, { size: h * 0.5, font: BLACK, color: '#e31837', maxW: w * 0.9 });
    },
  },
  { id: 'saveon', re: /save-?on-?foods/i, kind: 'grocery', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'SAVE-ON-FOODS', font: BLACK, box: { wall: 0xe4e0d6, band: 0xd2232a } },
  {
    id: 'safeway', re: /safeway/i, kind: 'grocery', c: { main: 0xe2231a, fg: 0xffffff }, pylon: 'tall', box: { wall: 0xe6e2da, band: 0xe2231a },
    fuel: { bands: [[0xf5f5f3, 0.55], [0xe2231a, 0.45]], pumpHead: 0xe2231a, kioskBand: 0xe2231a, priceBody: 0xe2231a },
    badge(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, w / 2, h * 0.42, w * 0.3, h * 0.3, '#e2231a');
      txt(g, 'S', w / 2, h * 0.45, { size: h * 0.44, font: SERIF, style: 'italic', color: '#ffffff' });
      txt(g, 'SAFEWAY', w / 2, h * 0.85, { size: h * 0.15, font: SANS, color: '#e2231a', maxW: w * 0.8 });
    },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      ellipse(g, h * 0.55, h / 2, h * 0.36, h * 0.36, '#e2231a');
      txt(g, 'S', h * 0.55, h * 0.54, { size: h * 0.52, font: SERIF, style: 'italic', color: '#ffffff' });
      txt(g, 'SAFEWAY', h * 1.05 + (w - h * 1.05) / 2, h * 0.54, { size: h * 0.48, font: SANS, color: '#e2231a', maxW: w - h * 1.3 });
    },
  },
  { id: 'sobeys', re: /sobeys/i, kind: 'grocery', c: { main: 0x00843d, fg: 0xffffff }, pylon: 'tall', text: 'Sobeys', font: SANS, box: { wall: 0xe4e0d6, band: 0x00843d } },
  { id: 'nofrills', re: /no frills/i, kind: 'grocery', c: { main: 0xffd400, fg: 0x1c1c1e }, pylon: 'tall', text: 'no frills', font: BLACK, box: { wall: 0xf0e6a8, band: 0xffd400 } },
  {
    id: 'walmart', re: /wal-?mart/i, kind: 'retail', c: { main: 0x0071ce, fg: 0xffffff, spark: 0xffc220 }, pylon: 'tall', box: { wall: 0xe9e9e6, band: 0x0071ce },
    word(g, w, h) {
      bg(g, w, h, '#0071ce');
      txt(g, 'Walmart', w * 0.44, h * 0.55, { size: h * 0.6, font: SANS, color: '#ffffff', maxW: w * 0.66 });
      g.strokeStyle = '#ffc220'; g.lineWidth = h * 0.08; g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 2;
        g.beginPath();
        g.moveTo(w * 0.86 + Math.cos(a) * h * 0.12, h * 0.5 + Math.sin(a) * h * 0.12);
        g.lineTo(w * 0.86 + Math.cos(a) * h * 0.32, h * 0.5 + Math.sin(a) * h * 0.32);
        g.stroke();
      }
    },
  },
  { id: 'costco', re: /^costco\b/i, kind: 'retail', c: { main: 0xe31837, fg: 0xffffff, blue: 0x005daa }, pylon: 'tall', text: 'COSTCO', font: BLACK, sub: 0x005daa, box: { wall: 0xe6e3dc, band: 0xe31837 } },
  { id: 'dollarama', re: /dollarama/i, kind: 'retail', c: { main: 0x00a651, fg: 0xffe600 }, pylon: null, text: 'Dollarama', font: BLACK, box: { wall: 0xe4e2dc, band: 0x00a651 } },
  { id: 'dollartree', re: /dollar tree/i, kind: 'retail', c: { main: 0x00843d, fg: 0xffffff }, pylon: null, text: 'Dollar Tree', font: BLACK },
  { id: 'winners', re: /^winners\b/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall', text: 'WINNERS', font: SANS, sub: 0xd2232a },
  { id: 'homesense', re: /homesense/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'HomeSense', font: SANS },
  { id: 'marks', re: /^mark'?s\b/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: "Mark's", font: SANS },
  { id: 'michaels', re: /michaels/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: 'Michaels', font: SERIF },
  { id: 'toysrus', re: /toys ?r ?us/i, kind: 'retail', c: { main: 0xffffff, fg: 0x0047ab },
    word(g, w, h) {
      bg(g, w, h, '#ffffff');
      const cols = ['#e31837', '#ff9900', '#ffd200', '#00a651', '#0047ab', '#7b2d8e', '#e31837', '#ff9900'];
      const s = 'ToysRUs';
      for (let i = 0; i < s.length; i++) txt(g, s[i], w * (0.14 + i * 0.12), h * (0.5 + (i % 2 ? 0.06 : -0.04)), { size: h * 0.62, font: BLACK, color: cols[i] });
    }, pylon: 'tall' },
  { id: 'rona', re: /\brona\b/i, kind: 'retail', c: { main: 0x003da5, fg: 0xffffff }, pylon: 'tall', text: 'RONA', font: BLACK, box: { wall: 0xdcdcd8, band: 0x003da5 } },
  { id: 'homehardware', re: /home hardware/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'Home Hardware', font: SANS },
  { id: 'princessauto', re: /princess auto/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'PRINCESS AUTO', font: BLACK },
  { id: 'golftown', re: /golf town/i, kind: 'retail', c: { main: 0x00573f, fg: 0xffffff }, pylon: null, text: 'GOLF TOWN', font: BLACK },
  { id: 'petvalu', re: /pet valu/i, kind: 'retail', c: { main: 0x00843d, fg: 0xffffff }, pylon: null, text: 'Pet Valu', font: SANS },
  { id: 'thebrick', re: /^the brick\b/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'The Brick', font: SANS },
  { id: 'jysk', re: /\bjysk\b/i, kind: 'retail', c: { main: 0x143c8c, fg: 0xffffff }, pylon: null, text: 'JYSK', font: BLACK },
  { id: 'structube', re: /structube/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'structube', font: SANS },
  { id: 'sportchek', re: /sport ?chek/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: 'SPORT CHEK', font: BLACK },
  { id: 'indigo', re: /^indigo\b|chapters/i, kind: 'retail', c: { main: 0x8b1d41, fg: 0xffffff }, pylon: null, text: 'indigo', font: SERIF },
  { id: 'cineplex', re: /cineplex/i, kind: 'retail', c: { main: 0x0b3d91, fg: 0xffd200 }, pylon: 'tall', text: 'CINEPLEX', font: BLACK, box: { wall: 0x2a2d33, band: 0x0b3d91 } },
  { id: 'valuevillage', re: /value village/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffd200 }, pylon: null, text: 'VALUE VILLAGE', font: BLACK },
  { id: 'goodwill', re: /goodwill/i, kind: 'retail', c: { main: 0x0067b1, fg: 0xffffff }, pylon: null, text: 'goodwill', font: ROUND },
  { id: 'hmart', re: /^h ?mart\b/i, kind: 'grocery', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'H MART', font: BLACK },
  { id: 'tnt', re: /t ?& ?t supermarket/i, kind: 'grocery', c: { main: 0xe2231a, fg: 0xffffff }, pylon: 'tall', text: 'T&T', font: BLACK },
  { id: 'visions', re: /visions electronics/i, kind: 'retail', c: { main: 0x1c3f94, fg: 0xffffff }, pylon: null, text: 'VISIONS', font: BLACK, sub: 0xd2232a },
  { id: 'penningtons', re: /penningtons/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'PENNINGTONS', font: SANS },
  { id: 'davidsbridal', re: /david'?s bridal/i, kind: 'retail', c: { main: 0x5b2a5a, fg: 0xffffff }, pylon: null, text: "David's Bridal", font: SCRIPT, weight: 'normal' },
  { id: 'fabricland', re: /fabricland/i, kind: 'retail', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: 'FABRICLAND', font: BLACK },
  { id: 'sherwin', re: /sherwin-?williams/i, kind: 'retail', c: { main: 0x0b4ea2, fg: 0xffffff }, pylon: null, text: 'SHERWIN-WILLIAMS', font: SANS, sub: 0xd2232a },
  { id: 'benjaminmoore', re: /benjamin moore/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'Benjamin Moore', font: SERIF },
  { id: 'sleepcountry', re: /sleep country/i, kind: 'retail', c: { main: 0x003b71, fg: 0xffffff }, pylon: null, text: 'SLEEP COUNTRY', font: BLACK },
  { id: 'lowes', re: /\blowe'?s\b/i, kind: 'retail', c: { main: 0x004990, fg: 0xffffff }, pylon: 'tall', text: "LOWE'S", font: BLACK, box: { wall: 0xe4e2dc, band: 0x004990 } },
  { id: 'marshalls', re: /marshalls/i, kind: 'retail', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'Marshalls', font: SANS },
  { id: 'petland', re: /petland/i, kind: 'retail', c: { main: 0x00843d, fg: 0xffd200 }, pylon: null, text: 'PETLAND', font: BLACK },
  { id: 'leons', re: /\bleon'?s\b/i, kind: 'retail', c: { main: 0xffd200, fg: 0xd2232a }, pylon: 'tall', text: "LEON'S", font: BLACK },
  { id: 'ashley', re: /ashley (homestore|furniture)/i, kind: 'retail', c: { main: 0xf47b20, fg: 0xffffff }, pylon: null, text: 'Ashley', font: SANS },
  { id: 'oldnavy', re: /old navy/i, kind: 'retail', c: { main: 0x003b71, fg: 0xffffff }, pylon: null, text: 'OLD NAVY', font: BLACK },
  { id: 'liquordepot', re: /liquor depot/i, kind: 'retail', c: { main: 0x5b2a5a, fg: 0xffffff }, pylon: null, text: 'LIQUOR DEPOT', font: BLACK },
  { id: 'fountaintire', re: /fountain tire/i, kind: 'service', c: { main: 0x00539b, fg: 0xffd200 }, pylon: 'tall', text: 'FOUNTAIN TIRE', font: BLACK },
  { id: 'oktire', re: /^ok tire/i, kind: 'service', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'OK TIRE', font: BLACK },
  { id: 'shaw', re: /^shaw\b/i, kind: 'service', c: { main: 0x0082ca, fg: 0xffffff }, pylon: null, text: 'Shaw', font: SANS },
  { id: 'freedom', re: /freedom mobile/i, kind: 'service', c: { main: 0xf47b20, fg: 0xffffff }, pylon: null, text: 'freedom', font: ROUND },
  { id: 'koodo', re: /^koodo/i, kind: 'service', c: { main: 0x00a5a8, fg: 0xffffff }, pylon: null, text: 'koodo', font: ROUND },
  { id: 'telus', re: /\btelus\b/i, kind: 'service', c: { main: 0xffffff, fg: 0x4b286d, green: 0x66cc00 }, pylon: null,
    word(g, w, h) { bg(g, w, h, '#ffffff'); txt(g, 'TELUS', w * 0.56, h * 0.55, { size: h * 0.62, font: SANS, color: '#4b286d', maxW: w * 0.6 }); ellipse(g, w * 0.17, h * 0.5, h * 0.3, h * 0.3, '#66cc00'); ellipse(g, w * 0.17 + h * 0.12, h * 0.42, h * 0.24, h * 0.24, '#ffffff'); } },
  { id: 'bell', re: /^bell\b/i, kind: 'service', c: { main: 0x00549a, fg: 0xffffff }, pylon: null, text: 'Bell', font: SANS },
  { id: 'rogers', re: /^rogers\b/i, kind: 'service', c: { main: 0xda291c, fg: 0xffffff }, pylon: null, text: 'ROGERS', font: SANS },
  { id: 'kaltire', re: /kal tire/i, kind: 'service', c: { main: 0x003b71, fg: 0xffffff, red: 0xd2232a }, pylon: 'tall', text: 'KAL TIRE', font: BLACK, sub: 0xd2232a },
  { id: 'mrlube', re: /mr\.? lube/i, kind: 'service', c: { main: 0xd2232a, fg: 0xffffff, yellow: 0xffd200 }, pylon: 'tall', text: 'Mr. Lube', font: BLACK, sub: 0xffd200 },
  { id: 'jiffylube', re: /jiffy lube/i, kind: 'service', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'Jiffy Lube', font: BLACK, sub: 0x003da5 },
  { id: 'midas', re: /\bmidas\b/i, kind: 'service', c: { main: 0xffd200, fg: 0x1c1c1e }, pylon: 'tall', text: 'MIDAS', font: BLACK },
  { id: 'speedy', re: /speedy auto/i, kind: 'service', c: { main: 0xffd200, fg: 0x1c1c1e }, pylon: null, text: 'SPEEDY', font: BLACK },
  { id: 'enterprise', re: /^enterprise\b/i, kind: 'service', c: { main: 0x169a5a, fg: 0xffffff }, pylon: null, text: 'enterprise', font: SANS },
  { id: 'carstar', re: /carstar/i, kind: 'service', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: 'CARSTAR', font: BLACK },
  { id: 'partsource', re: /partsource/i, kind: 'service', c: { main: 0xd2232a, fg: 0xffffff }, pylon: null, text: 'PARTSOURCE', font: BLACK },
  { id: 'greatclips', re: /great clips/i, kind: 'service', c: { main: 0x00539b, fg: 0xffffff }, pylon: null, text: 'Great Clips', font: SANS },
  { id: 'goodlife', re: /goodlife/i, kind: 'service', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: null, text: 'GoodLife', font: SANS },

  // ----- hotels -----
  {
    id: 'holidayinnexpress', re: /holiday inn express/i, kind: 'hotel', c: { main: 0x0b3d91, fg: 0xffffff, green: 0x6cb33f }, pylon: 'tall', box: { band: 0x0b3d91 },
    word(g, w, h) { bg(g, w, h, '#ffffff'); txt(g, 'Holiday Inn', w * 0.45, h * 0.36, { size: h * 0.36, font: SANS, color: '#2c8c3c', maxW: w * 0.7 }); txt(g, 'EXPRESS', w * 0.45, h * 0.74, { size: h * 0.3, font: SANS, color: '#0b3d91', maxW: w * 0.6, spacing: 0.15 }); rr(g, w * 0.84, h * 0.18, h * 0.64, h * 0.64, h * 0.08, '#2c8c3c'); txt(g, 'H', w * 0.84 + h * 0.32, h * 0.52, { size: h * 0.48, font: SANS, color: '#ffffff' }); },
  },
  {
    id: 'holidayinn', re: /holiday inn/i, kind: 'hotel', c: { main: 0x2c8c3c, fg: 0xffffff }, pylon: 'tall', box: { band: 0x2c8c3c },
    word(g, w, h) { bg(g, w, h, '#ffffff'); txt(g, 'Holiday Inn', w * 0.44, h * 0.55, { size: h * 0.52, font: SANS, color: '#2c8c3c', maxW: w * 0.7 }); rr(g, w * 0.84, h * 0.18, h * 0.64, h * 0.64, h * 0.08, '#2c8c3c'); txt(g, 'H', w * 0.84 + h * 0.32, h * 0.52, { size: h * 0.48, font: SANS, color: '#ffffff' }); },
  },
  { id: 'bestwestern', re: /best western/i, kind: 'hotel', c: { main: 0x003c7f, fg: 0xffffff, yellow: 0xffc72c }, pylon: 'tall', text: 'BEST WESTERN', font: SANS, sub: 0xffc72c, box: { band: 0x003c7f } },
  { id: 'sandman', re: /sandman/i, kind: 'hotel', c: { main: 0xb3202a, fg: 0xffffff }, pylon: 'tall', text: 'Sandman', font: SERIF, style: 'italic', box: { band: 0xb3202a } },
  { id: 'hampton', re: /^hampton\b/i, kind: 'hotel', c: { main: 0x1f3c88, fg: 0xffffff }, pylon: 'tall', text: 'Hampton', font: SERIF, box: { band: 0x1f3c88 } },
  { id: 'fourpoints', re: /four points/i, kind: 'hotel', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall', text: 'FOUR POINTS', font: SANS, box: { band: 0x1c1c1e } },
  { id: 'super8', re: /super ?8/i, kind: 'hotel', c: { main: 0xffd200, fg: 0xd2232a }, pylon: 'tall', text: 'SUPER 8', font: BLACK, box: { band: 0xd2232a } },
  { id: 'travelodge', re: /travelodge/i, kind: 'hotel', c: { main: 0x00539b, fg: 0xffffff }, pylon: 'tall', text: 'Travelodge', font: SANS, box: { band: 0x00539b } },
  { id: 'ramada', re: /ramada/i, kind: 'hotel', c: { main: 0xc8102e, fg: 0xffffff }, pylon: 'tall', text: 'RAMADA', font: SERIF, box: { band: 0xc8102e } },
  { id: 'delta', re: /^delta\b/i, kind: 'hotel', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall', text: 'DELTA', font: SANS, box: { band: 0x1c1c1e } },
  { id: 'wyndham', re: /wyndham/i, kind: 'hotel', c: { main: 0x003b71, fg: 0xffffff }, pylon: 'tall', text: 'WYNDHAM', font: SERIF, box: { band: 0x003b71 } },
  { id: 'courtyard', re: /courtyard/i, kind: 'hotel', c: { main: 0x1f4e79, fg: 0xffffff }, pylon: 'tall', text: 'COURTYARD', font: SANS, box: { band: 0x1f4e79 } },
  { id: 'towneplace', re: /towneplace/i, kind: 'hotel', c: { main: 0x9e2a2b, fg: 0xffffff }, pylon: 'tall', text: 'TownePlace Suites', font: SANS, box: { band: 0x9e2a2b } },
  { id: 'coast', re: /^coast\b/i, kind: 'hotel', c: { main: 0x00539b, fg: 0xffffff }, pylon: 'tall', text: 'COAST HOTELS', font: SANS, box: { band: 0x00539b } },
  { id: 'home2', re: /home2/i, kind: 'hotel', c: { main: 0x6cb33f, fg: 0xffffff }, pylon: 'tall', text: 'Home2 Suites', font: SANS, box: { band: 0x6cb33f } },
  { id: 'comfort', re: /comfort inn/i, kind: 'hotel', c: { main: 0x003b71, fg: 0xffffff }, pylon: 'tall', text: 'Comfort Inn', font: SANS, sub: 0xf7941d, box: { band: 0x003b71 } },
  { id: 'daysinn', re: /days inn/i, kind: 'hotel', c: { main: 0x0067b1, fg: 0xffd200 }, pylon: 'tall', text: 'DAYS INN', font: BLACK, box: { band: 0x0067b1 } },
  { id: 'marriott', re: /marriott|residence inn|fairfield inn/i, kind: 'hotel', c: { main: 0x8b1d41, fg: 0xffffff }, pylon: 'tall', text: 'MARRIOTT', font: SERIF, box: { band: 0x8b1d41 } },
  { id: 'hilton', re: /hilton|doubletree|homewood suites/i, kind: 'hotel', c: { main: 0x104c97, fg: 0xffffff }, pylon: 'tall', text: 'HILTON', font: SERIF, box: { band: 0x104c97 } },
  { id: 'radisson', re: /radisson/i, kind: 'hotel', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall', text: 'RADISSON', font: SANS, box: { band: 0x1c1c1e } },
  { id: 'quality', re: /quality inn|econo lodge|comfort suites/i, kind: 'hotel', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'QUALITY INN', font: SANS, box: { band: 0xd2232a } },
  { id: 'motel6', re: /motel 6/i, kind: 'hotel', c: { main: 0xd2232a, fg: 0xffffff }, pylon: 'tall', text: 'MOTEL 6', font: BLACK, box: { band: 0x0067b1 } },
  { id: 'staybridge', re: /staybridge|candlewood/i, kind: 'hotel', c: { main: 0x00539b, fg: 0xffffff }, pylon: 'tall', text: 'STAYBRIDGE SUITES', font: SANS, box: { band: 0x00539b } },

  // ----- car dealers (badges are the maker's emblem) -----
  { id: 'lexus', re: /\blexus\b/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xd8d8d8 }, pylon: 'tall',
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); ellipse(g, w / 2, h * 0.42, w * 0.36, h * 0.26, null, '#d8d8d8', w * 0.035); poly(g, [[w * 0.36, h * 0.24], [w * 0.43, h * 0.24], [w * 0.4, h * 0.52], [w * 0.68, h * 0.52], [w * 0.64, h * 0.58], [w * 0.33, h * 0.58]], '#d8d8d8'); txt(g, 'LEXUS', w / 2, h * 0.85, { size: h * 0.15, font: SANS, color: '#d8d8d8', spacing: 0.3 }); } },
  { id: 'ford', re: /\bford\b/i, kind: 'car', c: { main: 0x003478, fg: 0xffffff }, pylon: 'tall',
    badge(g, w, h) { bg(g, w, h, '#ffffff'); ellipse(g, w / 2, h / 2, w * 0.46, h * 0.28, '#003478', '#c0c8d8', w * 0.02); txt(g, 'Ford', w / 2, h * 0.53, { size: h * 0.3, font: SCRIPT, weight: 'normal', color: '#ffffff', maxW: w * 0.7 }); } },
  { id: 'toyota', re: /toyota/i, kind: 'car', c: { main: 0xeb0a1e, fg: 0xffffff }, pylon: 'tall',
    badge(g, w, h) { bg(g, w, h, '#eb0a1e'); ellipse(g, w / 2, h * 0.42, w * 0.34, h * 0.24, null, '#ffffff', w * 0.035); ellipse(g, w / 2, h * 0.36, w * 0.2, h * 0.1, null, '#ffffff', w * 0.03); ellipse(g, w / 2, h * 0.47, w * 0.08, h * 0.19, null, '#ffffff', w * 0.03); txt(g, 'TOYOTA', w / 2, h * 0.84, { size: h * 0.14, font: SANS, color: '#ffffff', spacing: 0.2 }); } },
  { id: 'honda', re: /\bhonda\b/i, kind: 'car', c: { main: 0xcc0000, fg: 0xffffff }, pylon: 'tall', text: 'HONDA', font: SANS, badge: disc('H', { disc: 0xcc0000, fg: 0xffffff, size: 0.42 }) },
  { id: 'hyundai', re: /hyundai/i, kind: 'car', c: { main: 0x002c5f, fg: 0xffffff }, pylon: 'tall', text: 'HYUNDAI', font: SANS, badge: disc('H', { disc: 0x002c5f, fg: 0xffffff, sx: 1.3, style: 'italic', size: 0.42 }) },
  { id: 'kia', re: /\bkia\b/i, kind: 'car', c: { main: 0x05141f, fg: 0xffffff }, pylon: 'tall', text: 'KIA', font: BLACK, style: 'italic' },
  { id: 'nissan', re: /nissan/i, kind: 'car', c: { main: 0xc3002f, fg: 0xffffff }, pylon: 'tall', text: 'NISSAN', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); ellipse(g, w / 2, h / 2, w * 0.36, h * 0.36, null, '#d8d8d8', w * 0.04); g.fillStyle = '#d8d8d8'; g.fillRect(w * 0.08, h * 0.42, w * 0.84, h * 0.16); txt(g, 'NISSAN', w / 2, h * 0.51, { size: h * 0.12, font: SANS, color: '#1c1c1e', spacing: 0.2 }); } },
  { id: 'mazda', re: /mazda/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xd8d8d8 }, pylon: 'tall', text: 'MAZDA', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); ellipse(g, w / 2, h * 0.44, w * 0.36, h * 0.28, null, '#d8d8d8', w * 0.035); g.strokeStyle = '#d8d8d8'; g.lineWidth = w * 0.035; g.beginPath(); g.moveTo(w * 0.24, h * 0.56); g.quadraticCurveTo(w * 0.4, h * 0.2, w * 0.5, h * 0.5); g.quadraticCurveTo(w * 0.6, h * 0.2, w * 0.76, h * 0.56); g.stroke(); txt(g, 'MAZDA', w / 2, h * 0.86, { size: h * 0.13, font: SANS, color: '#d8d8d8', spacing: 0.25 }); } },
  { id: 'audi', re: /\baudi\b/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall',
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); for (let i = 0; i < 4; i++) ellipse(g, w * (0.23 + i * 0.18), h * 0.42, w * 0.12, w * 0.12, null, '#e0e0e0', w * 0.03); txt(g, 'Audi', w / 2, h * 0.78, { size: h * 0.16, font: SANS, color: '#ffffff' }); } },
  { id: 'volvo', re: /volvo/i, kind: 'car', c: { main: 0x003057, fg: 0xffffff }, pylon: 'tall',
    badge(g, w, h) { bg(g, w, h, '#ffffff'); ellipse(g, w / 2, h / 2, w * 0.34, h * 0.34, null, '#5a6a7a', w * 0.06); poly(g, [[w * 0.7, h * 0.18], [w * 0.86, h * 0.14], [w * 0.82, h * 0.3]], '#5a6a7a'); g.fillStyle = '#003057'; g.fillRect(w * 0.12, h * 0.43, w * 0.76, h * 0.14); txt(g, 'VOLVO', w / 2, h * 0.505, { size: h * 0.12, font: SERIF, color: '#ffffff', spacing: 0.15 }); } },
  { id: 'acura', re: /acura/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xd8d8d8 }, pylon: 'tall', text: 'ACURA', font: SANS, badge: disc('A', { disc: 0x1c1c1e, fg: 0xd8d8d8, ring: 0xd8d8d8, bg: 0x1c1c1e, size: 0.4 }) },
  { id: 'bentley', re: /bentley/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xd8d8d8 }, pylon: null, text: 'BENTLEY', font: SERIF, badge: disc('B', { disc: 0x1c1c1e, fg: 0xd8d8d8, ring: 0xd8d8d8, bg: 0x1c3a2a, size: 0.4, font: SERIF, sx: 0.7 }) },
  { id: 'chevrolet', re: /chevrolet|\bchev\b/i, kind: 'car', c: { main: 0xd6a335, fg: 0x1c1c1e }, pylon: 'tall', text: 'CHEVROLET', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); poly(g, [[w * 0.08, h * 0.42], [w * 0.36, h * 0.42], [w * 0.4, h * 0.3], [w * 0.6, h * 0.3], [w * 0.64, h * 0.42], [w * 0.92, h * 0.42], [w * 0.86, h * 0.58], [w * 0.64, h * 0.58], [w * 0.6, h * 0.7], [w * 0.4, h * 0.7], [w * 0.36, h * 0.58], [w * 0.14, h * 0.58]], '#d6a335', '#e8e8e8', w * 0.015); } },
  { id: 'gmc', re: /\bgmc\b|buick/i, kind: 'car', c: { main: 0xcc0000, fg: 0xffffff }, pylon: 'tall', text: 'GMC', font: BLACK },
  { id: 'dodge', re: /dodge|chrysler|\bram\b|jeep/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xffffff }, pylon: 'tall', text: 'CHRYSLER · JEEP · RAM', font: SANS },
  { id: 'subaru', re: /subaru/i, kind: 'car', c: { main: 0x013c74, fg: 0xffffff }, pylon: 'tall', text: 'SUBARU', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#ffffff'); ellipse(g, w / 2, h / 2, w * 0.44, h * 0.3, '#013c74', '#c0c8d8', w * 0.02); star(g, w * 0.36, h * 0.44, w * 0.08, w * 0.035, 6, '#ffffff'); for (const [x, y] of [[0.55, 0.38], [0.66, 0.46], [0.55, 0.56], [0.68, 0.6], [0.78, 0.5]]) star(g, w * x, h * y, w * 0.04, w * 0.018, 6, '#ffffff'); } },
  { id: 'vw', re: /volkswagen|\bvw\b/i, kind: 'car', c: { main: 0x001e50, fg: 0xffffff }, pylon: 'tall', text: 'VOLKSWAGEN', font: SANS, badge: disc('VW', { disc: 0x001e50, fg: 0xffffff, ring: 0xffffff, size: 0.36 }) },
  { id: 'bmw', re: /\bbmw\b/i, kind: 'car', c: { main: 0x0066b1, fg: 0xffffff }, pylon: 'tall', text: 'BMW', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#ffffff'); ellipse(g, w / 2, h / 2, w * 0.44, h * 0.44, '#1c1c1e'); for (let q = 0; q < 4; q++) { g.fillStyle = q % 2 ? '#ffffff' : '#0066b1'; g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, w * 0.28, (q * Math.PI) / 2 - Math.PI / 2, ((q + 1) * Math.PI) / 2 - Math.PI / 2); g.fill(); } txt(g, 'BMW', w / 2, h * 0.14, { size: h * 0.1, font: SANS, color: '#ffffff' }); } },
  { id: 'mercedes', re: /mercedes/i, kind: 'car', c: { main: 0x1c1c1e, fg: 0xd8d8d8 }, pylon: 'tall', text: 'MERCEDES-BENZ', font: SERIF,
    badge(g, w, h) { bg(g, w, h, '#1c1c1e'); ellipse(g, w / 2, h / 2, w * 0.38, h * 0.38, null, '#d8d8d8', w * 0.035); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; poly(g, [[w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * h * 0.36], [w / 2 + Math.cos(a + 1.3) * w * 0.05, h / 2 + Math.sin(a + 1.3) * h * 0.05], [w / 2 + Math.cos(a - 1.3) * w * 0.05, h / 2 + Math.sin(a - 1.3) * h * 0.05]], '#d8d8d8'); } } },
  { id: 'mitsubishi', re: /mitsubishi/i, kind: 'car', c: { main: 0xe60012, fg: 0xffffff }, pylon: 'tall', text: 'MITSUBISHI', font: SANS,
    badge(g, w, h) { bg(g, w, h, '#ffffff'); const d = (cx, cy, a) => poly(g, [0, 1, 2, 3].map((k) => { const t = a + (k * Math.PI) / 2; const r = k % 2 ? 0.06 : 0.16; return [w * (cx + Math.cos(t) * r), h * (cy + Math.sin(t) * r)]; }), '#e60012'); d(0.5, 0.3, Math.PI / 2); d(0.36, 0.55, Math.PI / 6); d(0.64, 0.55, -Math.PI / 6); } },
  { id: 'tesla', re: /\btesla\b/i, kind: 'car', c: { main: 0xcc0000, fg: 0xffffff }, pylon: null, text: 'TESLA', font: SANS, spacing: 0.3 },
];

// Building looks for standalone restaurants, cafes and banks (brand-sites.js draws them):
//   wall / wallCell   main walls (cells: white, brick, stone, wood, panel, stucco)
//   base / baseCell   the plinth (baseH metres)
//   band / bandCell   the fascia band along the top (bandH metres; cells: white, stripes, checker, wood)
//   mansard           colour of a sloped roof band instead of a flat fascia (Dairy Queen, IHOP)
//   tower             { col, cell, up (m above the roof), size (m), cap (hip-roof colour), logo: true }
//   trim              parapet cap colour; awning: colour of a canopy over the windows
//   arch              a band of this colour round the tower top (McDonald's yellow); stripe: a thin band colour
// Under the game's sunset light dark colours turn black, so dark facades are a shade lighter
// than the real ones.
export const LOOKS = {
  generic: { wall: 0xe6e0d4, wallCell: 'stucco', base: 0x8f877b, baseCell: 'stone', band: null, bandH: 1.2, trim: 0x5c5a56 },
  mcd: { wall: 0x77797d, wallCell: 'panel', base: 0x55575b, baseCell: 'white', band: 0x4b4d51, bandH: 0.9, trim: 0x4b4d51, tower: { col: 0x626468, cell: 'panel', up: 2.8, size: 4.6, logo: true }, arch: 0xffbc0d, awning: 0xe8e8e6 },
  tims: { wall: 0xe5d6bb, wallCell: 'stucco', base: 0x8e5a44, baseCell: 'brick', baseH: 1.2, band: 0x4e2c22, bandH: 1.0, trim: 0x3a2018, tower: { col: 0xe5d6bb, cell: 'stucco', up: 2.4, size: 4.4, logo: true, band: 0x4e2c22 }, awning: 0xc8102e },
  starbucks: { wall: 0x66605a, wallCell: 'panel', base: 0x47423d, baseCell: 'white', band: 0x3d3935, bandH: 0.8, trim: 0x3d3935, tower: { col: 0xa06a3a, cell: 'wood', up: 2.4, size: 4.2, logo: true } },
  aw: { wall: 0x7d5a44, wallCell: 'panel', base: 0x54392a, baseCell: 'white', band: 0xf37021, bandH: 1.0, trim: 0xf37021, tower: { col: 0xf37021, cell: 'white', up: 3.0, size: 4.4, logo: true } },
  wendys: { wall: 0xb9b2a6, wallCell: 'stone', base: 0x5d5a55, baseCell: 'white', band: 0x3d3b39, bandH: 1.0, trim: 0x3d3b39, tower: { col: 0xe2203d, cell: 'white', up: 3.0, size: 4.6, logo: true }, stripe: 0xe2203d },
  kfc: { wall: 0xc8102e, wallCell: 'panel', base: 0x8a0b20, baseCell: 'white', band: 0xffffff, bandCell: 'stripes', bandH: 1.4, trim: 0xffffff, awning: 0xc8102e },
  tacobell: { wall: 0xeae7e1, wallCell: 'stucco', base: 0x6f6a72, baseCell: 'white', band: 0x3b2244, bandH: 0.8, trim: 0x3b2244, tower: { col: 0x702082, cell: 'white', up: 3.4, size: 4.6, logo: true } },
  popeyes: { wall: 0xd9c4a8, wallCell: 'brick', base: 0x7a3b1e, baseCell: 'white', band: 0xf25600, bandH: 1.0, trim: 0xf25600, awning: 0xf25600, tower: { col: 0xd9c4a8, cell: 'brick', up: 2.4, size: 4.2, logo: true, band: 0xf25600 } },
  harveys: { wall: 0xece6dc, wallCell: 'stucco', base: 0x7a3a2a, baseCell: 'brick', band: 0xd7282f, bandH: 1.0, trim: 0xd7282f, stripe: 0xffc72c, tower: { col: 0xd7282f, cell: 'white', up: 2.6, size: 4.2, logo: true } },
  dq: { wall: 0xeee5d2, wallCell: 'stucco', base: 0x8a7f70, baseCell: 'stone', band: null, mansard: 0xee3124, bandH: 1.6, trim: 0xee3124 },
  bostonpizza: { wall: 0xe0cfae, wallCell: 'stucco', base: 0x9a8a72, baseCell: 'stone', baseH: 1.2, band: 0x5a3b2a, bandH: 0.7, trim: 0x5a3b2a, tower: { col: 0xd8c4a0, cell: 'stone', up: 3.6, size: 5.0, cap: 0xb4462e, logo: true }, awning: 0xc8102e },
  fiveguys: { wall: 0xf2f0ec, wallCell: 'white', base: 0xd21033, baseCell: 'white', band: 0xd21033, bandCell: 'checker', bandH: 1.0, trim: 0xd21033 },
  swisschalet: { wall: 0xf0ebe0, wallCell: 'stucco', base: 0x7a4a3a, baseCell: 'brick', band: null, mansard: 0xb3202a, bandH: 1.5, trim: 0xb3202a },
  keg: { wall: 0x8a7664, wallCell: 'stone', base: 0x5e5044, baseCell: 'stone', band: 0x3e3530, bandH: 1.0, trim: 0x3e3530 },
  tuscan: { wall: 0xe3c9a0, wallCell: 'stucco', base: 0x9a7a5a, baseCell: 'stone', band: null, mansard: 0xb4562e, bandH: 1.4, trim: 0xb4562e, tower: { col: 0xd8b88a, cell: 'stucco', up: 3.0, size: 5.0, cap: 0xb4562e, logo: true } },
  ihop: { wall: 0xf0ebe0, wallCell: 'stucco', base: 0x8a7f70, baseCell: 'stone', band: null, mansard: 0x1b4f9c, bandH: 2.0, trim: 0x1b4f9c },
  pizzahut: { wall: 0xd9c4a8, wallCell: 'brick', base: 0x7a3b1e, baseCell: 'white', band: null, mansard: 0xc8102e, bandH: 2.2, trim: 0xc8102e },
  bank: { wall: 0xe4e1da, wallCell: 'stone', base: 0x8f8a82, baseCell: 'stone', band: null, bandH: 1.3, trim: 0x55534f },
};

// ---------- lookup ----------
// A brand has a wide sign (`word`), a square one (`badge`) or both; brand-sites.js uses
// whichever fits and sizes the sign by its shape. Text-only brands get a wide sign.
for (const b of BRANDS) {
  b.c.fg ??= 0xffffff;
  if (!b.word && !b.badge) b.word = wordmark(b.text ?? b.id, { font: b.font, weight: b.weight, style: b.style, spacing: b.spacing, bar: b.sub });
  if (b.squareText) b.badge = textBadge(b.text ?? b.id, { font: b.font, weight: b.weight, style: b.style });
}
const cache = new Map();
export function brandByName(name) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);
  let hit = null;
  const first = String(name).split(';')[0].trim();
  for (const b of BRANDS) if (b.re.test(first)) { hit = b; break; }
  cache.set(name, hit);
  return hit;
}
// The brand of a footprint or tenant: its OSM brand tag first, then its name.
export const brandOf = (br, n) => brandByName(br) ?? brandByName(n);

// Wall and accent band colours for buildings drawn by world.js (big boxes, hotels), plus the
// few named buildings with a look of their own.
const NAME_LOOKS = [
  [/universiade|butterdome/i, { wall: 0xf2c230, band: 0xf2c230 }],
  [/ritchie mill|rossdale/i, { brick: true }],
];
// `store`: a single-storey chain store, drawn as a big box (tilt-up panels), not as shops
// with flats above; `hotel`: hotels get their brand colour as a band under the roof.
export function brandLook(b) {
  if (!b?.n && !b?.br) return null;
  for (const [re, v] of NAME_LOOKS) if (re.test(b.n ?? '')) return v;
  const brand = brandOf(b.br, b.n);
  if (!brand) return null;
  const store = brand.kind !== 'hotel' && b.h <= 95;
  return brand.box || store ? { ...brand.box, store, hotel: brand.kind === 'hotel' } : null;
}

// ---------- drawing a brand's signs into the atlas ----------
// Sizes of the two sign shapes in the atlas (pixels).
export const CELL_SIZE = { badge: [192, 192], word: [384, 96] };
export function drawBrandCell(brand, format, g, w, h) {
  const fn = format === 'badge' ? brand.badge : brand.word;
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  fn(g, w, h, brand.c);
  g.restore();
}
