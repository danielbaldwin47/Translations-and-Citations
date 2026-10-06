#!/usr/bin/env node
/*
 * RESEARCH SCRIPT (issue #61, go/no-go) — not part of the extension, the
 * build, or the checks. Measures what share of early General Conference (E)
 * and Journal of Discourses (J) cites in the bundled BYU index are verbatim
 * quotations of the cited verse(s), i.e. mechanically recoverable by text
 * matching, versus allusions that only BYU's editorial judgment links.
 * Findings in docs/research/cite-verbatim-share.md.
 *
 * Reuses the scripture parsers and tokenizer of tools/research-tpjs-index.js
 * (same four public-domain inputs, downloaded by hand into --scripture-dir;
 * see that script's header for the files).
 *
 * Usage: node tools/research-cite-verbatim.js --scripture-dir <dir> [--seed 7] [--after] [--control]
 *   --control score each cite against the wrong verses (v+7): chance-match baseline
 *   --after   also include up to 300 chars after the span (to the paragraph end)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const REPO = path.resolve(__dirname, '..');
const SDIR = path.resolve(arg('scripture-dir', path.join(REPO, 'source-data', 'scripture')));
const AFTER = process.argv.includes('--after');
const CONTROL = process.argv.includes('--control'); // score against verse v+7 of the same chapter (chance baseline)
let seed = +arg('seed', 7);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const R = require('./research-tpjs-index.js');
const { stripTags } = require(path.join(REPO, 'tools/build-citation-data.js'));
const BOOKS = require(path.join(REPO, 'src/shared/books.js'));
const BOM = ['1-ne', '2-ne', 'jacob', 'enos', 'jarom', 'omni', 'w-of-m', 'mosiah', 'alma', 'hel', '3-ne', '4-ne', 'morm', 'ether', 'moro'];
const volOf = (slug) => (BOOKS.LDS_TO_USFM[slug] ? 'Bible' : BOM.includes(slug) ? 'Book of Mormon' : 'D&C+PGP');

// --- scripture ---
const verseText = new Map(); // "slug|ch|v" -> tokens
for (const v of R.loadScripture(SDIR)) {
  const t = R.tokens(v.text);
  if (t.length >= 2) verseText.set(`${v.slug}|${v.ch}|${v.v}`, t);
}

// --- talk text around a cite ---
const talkCache = new Map();
function talkHtml(id) {
  if (!talkCache.has(id)) {
    const f = path.join(REPO, 'src/citations/data/talks', `${id}.html.gz`);
    talkCache.set(id, fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : null);
    if (talkCache.size > 200) talkCache.delete(talkCache.keys().next().value);
  }
  return talkCache.get(id);
}
const clean = (h) => stripTags(h
  .replace(/<span class="citation"[\s\S]*?<\/a><\/span>/g, ' ')      // other cites' reference labels
  .replace(/<div class="break pagebreak"[\s\S]*?<\/div>/g, ' ')      // JoD page markers
  .replace(/\[\s*p\.\s*\d+[a-z]?\]/g, ' '));
const PARA = /<p[\s>]|<div class="paragraph/g;
function windowFor(citId, talkId) {
  const h = talkHtml(talkId);
  if (!h) return null;
  const at = h.indexOf(`<span class="citation" id="${citId}"`);
  if (at < 0) return null;
  // paragraph start: last <p> / <div class="paragraph" before the span
  const lo = Math.max(0, at - 20000);
  let pStart = lo; let m; PARA.lastIndex = lo;
  const before = h.slice(0, at);
  while ((m = PARA.exec(before))) pStart = m.index;
  let text = clean(h.slice(pStart, at));
  text = text.slice(-600);
  if (AFTER) {
    const end = h.indexOf('</a></span>', at) + 11;
    PARA.lastIndex = end; const n = PARA.exec(h);
    text += ' ' + clean(h.slice(end, n ? n.index : end + 3000)).slice(0, 300);
  }
  return text;
}

// longest common contiguous token run
function longestRun(a, b) {
  let best = 0; let prev = new Uint16Array(b.length + 1); let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev]; cur.fill(0);
  }
  return best;
}
function classify(run, vlen) {
  if (run >= 8) return 'V';
  if (vlen < 8 && run >= Math.min(6, vlen) && vlen >= 3) return 'V'; // short verse quoted whole (or 6+ words of it)
  if (run >= 5) return 'N';
  return 'A';
}

// --- cites ---
const sources = require(path.join(REPO, 'src/citations/data/sources.json'));
const dir = path.join(REPO, 'src/citations/data/citations');
const stats = {}; // corpus -> vol -> {V,N,A,X}
const ex = { E: { A: [], V: [] }, J: { A: [], V: [] } };
const meta = { E: { snippet: 0, partial: 0, ocrNeighbour: 0, ocrA: 0, capped: 0 }, J: { snippet: 0, partial: 0, ocrNeighbour: 0, ocrA: 0, capped: 0 } };
for (const f of fs.readdirSync(dir).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const chOf = {};
  for (const [ch, vs] of Object.entries(d.index)) for (const ids of Object.values(vs)) for (const id of ids) chOf[id] = chOf[id] || +ch;
  for (const [id, c] of Object.entries(d.cites)) {
    const src = sources[String(c.t)];
    if (!src || (src.c !== 'E' && src.c !== 'J')) continue;
    const C = src.c; const slug = d.book; const ch = chOf[id]; const vol = volOf(slug);
    const s = ((stats[C] = stats[C] || {})[vol] = stats[C][vol] || { V: 0, N: 0, A: 0, X: 0 });
    let vs = R.verseList(c.v);
    if (CONTROL) vs = vs.map((v) => v + 7);
    if (vs.length > 10) { vs = vs.slice(0, 10); meta[C].capped++; }
    const parts = vs.map((v) => verseText.get(`${slug}|${ch}|${v}`));
    const present = parts.filter(Boolean);
    if (!ch || !present.length) { s.X++; continue; }
    if (present.length < parts.length) meta[C].partial++;
    const vt = [].concat(...present);
    let text = windowFor(id, c.t);
    if (text == null) { text = c.sn || ''; meta[C].snippet++; }
    const tt = R.tokens(text);
    const run = longestRun(tt, vt);
    const k = classify(run, vt.length);
    s[k]++;
    const key = `${slug} ${ch}:${c.v}`;
    if (k === 'A' || k === 'V') ex[C][k].push({ cit: id, talk: c.t, key, text });
    // OCR verse-attribution check (D&C/PGP): would a neighbouring verse make it verbatim?
    if (vol === 'D&C+PGP' && k !== 'V') {
      meta[C].ocrA++;
      const nb = [vs[0] - 1, vs[vs.length - 1] + 1].map((v) => verseText.get(`${slug}|${ch}|${v}`)).filter(Boolean);
      if (nb.some((t) => classify(longestRun(tt, t), t.length) === 'V')) meta[C].ocrNeighbour++;
    }
  }
}

const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');
const pick = (arr, n) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; };
for (const C of ['E', 'J']) {
  console.log(`\n${C === 'E' ? 'Early General Conference (E)' : 'Journal of Discourses (J)'}${AFTER ? '  [window: paragraph before + 300 chars after]' : ''}`);
  console.log('volume          judged  verbatim  near    allusion  excluded');
  const all = { V: 0, N: 0, A: 0, X: 0 };
  for (const vol of ['Bible', 'Book of Mormon', 'D&C+PGP']) {
    const s = stats[C][vol] || { V: 0, N: 0, A: 0, X: 0 };
    for (const k in all) all[k] += s[k];
    const j = s.V + s.N + s.A;
    console.log(`${vol.padEnd(15)} ${String(j).padStart(6)}  ${pct(s.V, j).padStart(8)}  ${pct(s.N, j).padStart(6)}  ${pct(s.A, j).padStart(8)}  ${String(s.X).padStart(8)}`);
  }
  const j = all.V + all.N + all.A;
  console.log(`${'all'.padEnd(15)} ${String(j).padStart(6)}  ${pct(all.V, j).padStart(8)}  ${pct(all.N, j).padStart(6)}  ${pct(all.A, j).padStart(8)}  ${String(all.X).padStart(8)}`);
  const m = meta[C];
  console.log(`  snippet fallback ${m.snippet}; partially-present ranges ${m.partial}; ranges capped at 10 ${m.capped}; D&C/PGP non-verbatim that turn verbatim on a +-1 neighbour verse: ${m.ocrNeighbour} of ${m.ocrA}`);
  for (const [k, n] of [['A', 6], ['V', 3]]) {
    console.log(`  ${k === 'A' ? 'ALLUSION' : 'VERBATIM'} examples:`);
    for (const e of pick(ex[C][k], n)) console.log(`    talk ${e.talk} cite ${e.cit} ${e.key}: ...${e.text.slice(-100)}`);
  }
}
