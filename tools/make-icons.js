#!/usr/bin/env node
/*
 * Generates the extension icons (icons/icon-{16,32,48,128}.png) with only
 * Node's built-in zlib. Re-run after changing the art:
 *   node tools/make-icons.js
 *
 * The mark: a teal rounded tile holding an open book — two pages for the
 * chapter and its translation, a quotation mark on the right page for the
 * talks that cite it.
 *
 * Art is described as shapes in the tile's own 0..1 space and rasterised with
 * 8×8 supersampling, so edges are anti-aliased at every size. Each size has
 * its own padding (Chrome's guideline: 96px of art in the 128px icon) and its
 * own level of detail; 16px is hand-placed pixels, since at that size a
 * sampled slope or quote mark only blurs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'icons');

// Per size: transparent padding around the tile (px), and what to draw.
const SIZES = [
  { size: 16, pad: 0, detail: 'pixels' },
  { size: 32, pad: 1, detail: 'quote' },
  { size: 48, pad: 3, detail: 'full' },
  { size: 128, pad: 16, detail: 'full' },
];

// Palette (RGB).
const TILE_TOP = [0x0a, 0x7c, 0xa4];
const TILE_BOTTOM = [0x00, 0x52, 0x70];
const PAGE = [0xff, 0xff, 0xff];
const LINE = [0xa9, 0xcd, 0xdb];
const INK = [0x00, 0x61, 0x84];

const TILE_RADIUS = 0.22; // of the tile's side

// ---- PNG encoding ----

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Shapes, in tile space (0..1, y down) ----

function inRoundedSquare(x, y, r) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// The open book: each page is a quadrilateral whose top and bottom edges dip
// toward the spine, the way an open book's pages curve into the binding.
const BOOK = { outer: 0.17, spineGap: 0.035, top: 0.27, bottom: 0.71, dip: 0.055 };

function pageAt(x, y) {
  const d = Math.abs(x - 0.5);
  if (d < BOOK.spineGap || d > 0.5 - BOOK.outer) return null;
  const t = 1 - (d - BOOK.spineGap) / (0.5 - BOOK.outer - BOOK.spineGap); // 0 at the outer edge, 1 at the spine
  const dip = BOOK.dip * t * t;
  if (y < BOOK.top + dip || y > BOOK.bottom + dip) return null;
  return { side: x < 0.5 ? 'left' : 'right', t, dip };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

// One "99"-style closing quote glyph: a round head with a tail curling down-left.
function inQuoteGlyph(x, y, cx, cy, r) {
  if (Math.hypot(x - cx, y - cy) <= r) return true;
  return distToSegment(x, y, cx + r * 0.72, cy + r * 0.2, cx - r * 0.55, cy + r * 1.9) <= r * 0.42;
}

function inQuote(x, y) {
  const r = 0.062;
  const cy = 0.44;
  return inQuoteGlyph(x, y, 0.625, cy, r) || inQuoteGlyph(x, y, 0.765, cy, r);
}

// Text lines on the left page, following the page's dip.
function onLine(x, y, page, lines) {
  if (page.side !== 'left') return false;
  const d = Math.abs(x - 0.5);
  if (d < BOOK.spineGap + 0.05 || d > 0.5 - BOOK.outer - 0.045) return false;
  const inner = y - page.dip;
  return lines.some(([ly, len]) => {
    if (d < 0.5 - BOOK.outer - 0.045 - len) return false;
    return Math.abs(inner - ly) < 0.021;
  });
}

const LINES_FULL = [[0.38, 0.24], [0.47, 0.24], [0.56, 0.24], [0.65, 0.16]];
const LINES_QUOTE = [[0.40, 0.24], [0.53, 0.24], [0.66, 0.16]];

function colorAt(x, y, detail) {
  if (!inRoundedSquare(x, y, TILE_RADIUS)) return null;
  const tile = TILE_TOP.map((c, i) => Math.round(c + (TILE_BOTTOM[i] - c) * y));
  const page = pageAt(x, y);
  if (!page) return tile;
  if (page.side === 'right' && inQuote(x, y)) return INK;
  if (onLine(x, y, page, detail === 'full' ? LINES_FULL : LINES_QUOTE)) return LINE;
  return PAGE;
}

// ---- 16px: hand-placed pages over a sampled tile ----
// 'W' page, 'L' text line, 'Q' quote ink, '.' tile. The inner two columns of
// each page sit one row lower, so the pages still read as an open book.
const PAGES_16 = [
  '................',
  '................',
  '................',
  '................',
  '..WWW......WWW..',
  '..WWWWW..WWWWW..',
  '..WLLLW..WQWQW..',
  '..WWWWW..WQWQW..',
  '..WLLLW..WWWWW..',
  '..WWWWW..WWWWW..',
  '..WLLWW..WWWWW..',
  '..WWWWW..WWWWW..',
  '.....WW..WW.....',
  '................',
  '................',
  '................',
];
const PIXEL_16 = { W: PAGE, L: LINE, Q: INK };

// ---- Rasterise ----

const SS = 8; // samples per pixel per axis

function render({ size, pad, detail }) {
  const rgba = Buffer.alloc(size * size * 4);
  const span = size - 2 * pad;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - pad) / span;
          const y = (py + (sy + 0.5) / SS - pad) / span;
          let c = colorAt(x, y, detail);
          if (c && detail === 'pixels') {
            c = PIXEL_16[PAGES_16[py][px]] || TILE_TOP.map((v, i) => Math.round(v + (TILE_BOTTOM[i] - v) * y));
          }
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((255 * a) / (SS * SS));
      }
    }
  }
  return rgba;
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
for (const spec of SIZES) {
  const png = encodePng(spec.size, render(spec));
  fs.writeFileSync(path.join(OUT, `icon-${spec.size}.png`), png);
  console.log(`wrote icons/icon-${spec.size}.png (${png.length} bytes)`);
}
