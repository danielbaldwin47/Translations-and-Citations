/*
 * The quotation matcher behind inclusion rule `verbatim` (GLOSSARY.md
 * "Inclusion rule"; spec #69, "Build"; issue #72). Productionized from the
 * research tools on `research/cite-verbatim-share` and
 * `research/tpjs-independent-index`. Used by tools/build-citation-data.js;
 * checked by tools/validate-verbatim-matcher.js.
 *
 * Interface:
 *   loadScripture(dir) -> verses          the four public-domain inputs (Inputs, below), parsed
 *                                         by parseGutenberg (KJV, BoM) and parseOcr (1920s scans)
 *   scriptureIndex(verses) -> index       six-word shingles over each chapter's word stream
 *   verbatimCites(html, cites, index) -> Set of cite ids the matcher re-derives
 *     html   one talk's HTML (BYU's content database, citation spans in place)
 *     cites  [{ id, slug, ch, verses:[v, …] }] that talk's cites
 *
 * How a cite is re-derived, in two steps that keep BYU's data out of the
 * matching:
 *   1. Quotations. The talk's text, with every BYU insertion removed (citation
 *      spans and their labels, footnote markers, Journal of Discourses page and
 *      column markers), is matched against public-domain scripture alone: a
 *      quotation is a run of consecutive words, SHINGLE (six) or more long,
 *      that a chapter's text also holds in the same order, found through
 *      six-word shingles. Runs stop at paragraph ends and chapter ends.
 *   2. The join. A cite is re-derived when one quotation puts MIN_RUN or more
 *      of its words (all of them, when the cited verses hold fewer, but never
 *      under SHINGLE) inside the cite's own verses and inside the cite's window:
 *      the text of its paragraph up to its citation span, at most WINDOW
 *      characters back. These thresholds are the research measurement's
 *      (docs/research/cite-verbatim-share.md on that branch: 58.5% of early
 *      conference cites verbatim, 15.0% of Journal of Discourses); the build
 *      re-derives 58.1% and 14.9% (October 2026, BYU base 2026-05-18).
 * A cite whose verses the inputs lack (D&C 137-138 and the Official
 * Declarations postdate the 1923 D&C; OCR drops about 4% of D&C verse numbers)
 * is never re-derived.
 *
 * Inputs: the four public-domain scripture texts (KJV, Book of Mormon, 1923
 * D&C, 1929 PGP) in source-data/scripture/; their download recipe and hashes
 * are in tools/build-citation-data.js's header. The thresholds above were
 * measured on those copies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SHINGLE = 6;   // words per shingle
const MIN_RUN = 8;   // words a quotation must share with the cited verses
const WINDOW = 600;  // characters of the paragraph before the span that count

// ---- words ----
const SPELL = { shew: 'show', shewed: 'showed', sheweth: 'showeth', shewn: 'shown', shewing: 'showing', ancle: 'ankle', stablish: 'establish' };
// Lowercase letter runs with apostrophes dropped, KJV spellings mapped; each
// word with the character offset it starts at.
function words(text) {
  const out = [];
  const re = /[a-z’'`ʼ]+/gi;
  let m;
  while ((m = re.exec(text))) {
    const w = m[0].toLowerCase().replace(/[’'`ʼ]/g, '');
    if (w) out.push({ w: SPELL[w] || w, at: m.index });
  }
  return out;
}

// ---- scripture inputs ----
const BOOKS = require('../src/shared/books.js');
// The reader's entity decoding and BYU-insertion rule (talk-source).
const { decodeEntities, dropByuInsertions } = require('../src/citations/talk-source.js');
const OT_NT = Object.keys(BOOKS.LDS_TO_USFM); // canonical KJV order
const BOM = ['1-ne', '2-ne', 'jacob', 'enos', 'jarom', 'omni', 'w-of-m', 'mosiah', 'alma', 'hel', '3-ne', '4-ne', 'morm', 'ether', 'moro'];

// A Gutenberg text with inline "c:v " markers; a 1:1 marker opens the next
// book of `order`. -> [{ slug, ch, v, text }]. Throws when the book count is off.
function parseGutenberg(text, order) {
  let t = String(text);
  t = t.slice(t.indexOf('*** START'), t.indexOf('*** END'));
  t = t.split('\n').filter((l) => !/^\S.* Chapter \d+\s*$/.test(l)).join('\n');
  const re = /(?:^|\s)(\d+):(\d+)\s/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ ch: +m[1], v: +m[2], start: m.index, end: re.lastIndex });
  const verses = [];
  let b = -1;
  for (let i = 0; i < marks.length; i++) {
    const k = marks[i];
    if (k.ch === 1 && k.v === 1) b++;
    if (b < 0) continue;
    const body = t.slice(k.end, i + 1 < marks.length ? marks[i + 1].start : t.length);
    // A book's title line sits before the next book's 1:1: drop the trailing heading.
    const clean = i + 1 < marks.length && marks[i + 1].ch === 1 && marks[i + 1].v === 1
      ? body.replace(/\n\s*\n[^\n]*\S[^\n]*\s*$/, '') : body;
    verses.push({ slug: order[b], ch: k.ch, v: k.v, text: clean.replace(/\s+/g, ' ').trim() });
  }
  if (b + 1 !== order.length) throw new Error(`Gutenberg text: found ${b + 1} books, expected ${order.length}`);
  return verses;
}

// A line of an OCR scan that is not verse text: facsimile captions, footnote
// keys ("a, 20:46"), reference-only lines, running heads.
function looksLikeApparatus(line) {
  const l = line.trim();
  if (!l) return true;
  if (/^(?:Fig(?:ure)?s?\.?\s*\d|A FACSIMILE|EXPLANATION OF)/.test(l)) return true;
  if (/^[a-z]{1,2}[,.]\s/.test(l) && /\d/.test(l)) return true;
  const digits = (l.match(/\d/g) || []).length;
  const ws = (l.match(/[A-Za-z]{3,}/g) || []).filter((w) => !/^(see|sec|ver|chap|ch)$/i.test(w));
  if (digits >= 2 && ws.length < 4) return true;
  if (/^[\d\s.,_—–-]*[A-Z][A-Z ,.&;:'’\d-]+$/.test(l) && l === l.toUpperCase() && l.length < 60) return true;
  return false;
}

// An OCR'd 1920s printing: chapter headings by regex, verse lines "N. text".
// A verse-number line counts when N is new in the chapter and lies within
// [last-8, last+3] (two-column OCR sometimes swaps column order).
//   segments [{ slug, from, to (line numbers), chapter: RegExp, firstChapter, open? }]
//   open: the range starts inside chapter 1 (no heading before it).
function parseOcr(text, segments) {
  const lines = String(text).split('\n');
  const verses = [];
  for (const seg of segments) {
    let ch = seg.open ? seg.firstChapter : seg.firstChapter - 1;
    let cur = null;
    let seen = new Set();
    let last = 0;
    let buf = [];
    const flush = () => {
      if (cur) cur.text = buf.join('\n').replace(/-\s*\n\s*(?=[a-z])/g, '').replace(/\s+/g, ' ').trim();
      buf = [];
    };
    for (let i = seg.from; i < seg.to; i++) {
      const line = lines[i];
      if (seg.chapter.test(line)) {
        flush(); cur = null; ch++; seen = new Set(); last = 0; continue;
      }
      const vm = /^\s*(\d{1,3})[.,]\s+(.*)$/.exec(line);
      if (vm && ch >= seg.firstChapter) {
        const n = +vm[1];
        if (!seen.has(n) && n >= last - 8 && n <= last + 3 && n >= 1) {
          flush();
          seen.add(n); last = Math.max(last, n);
          cur = { slug: seg.slug, ch, v: n, text: '' };
          verses.push(cur);
          buf.push(vm[2]);
          continue;
        }
      }
      if (cur && !looksLikeApparatus(line)) buf.push(line);
    }
    flush();
  }
  return verses;
}

function lineOf(lines, re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error(`scripture input: no line matches ${re}`);
}

// The four inputs in dir (kjv.txt, bom.txt, dc1923.txt, pgp1929.txt; see the
// header) -> verses in book order. Throws naming a missing file.
function loadScripture(dir) {
  const read = (f) => {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) throw new Error(`scripture input missing: ${p} (download recipe in the header of tools/build-citation-data.js)`);
    return fs.readFileSync(p, 'utf8');
  };
  const kjv = parseGutenberg(read('kjv.txt'), OT_NT);
  const bom = parseGutenberg(read('bom.txt'), BOM);
  const dcText = read('dc1923.txt');
  const dcLines = dcText.split('\n');
  const dc = parseOcr(dcText, [{ slug: 'dc', from: lineOf(dcLines, /^SECTION\s/), to: lineOf(dcLines, /^OFFICIAL DECLARATION/), chapter: /^SECTION\s/, firstChapter: 1 }]);
  const pText = read('pgp1929.txt');
  const pLines = pText.split('\n');
  const mosesAt = lineOf(pLines, /^CHAPTER 1\./);
  const abrAt = lineOf(pLines, /^THE BOOK OF ABRAHAM/, mosesAt);
  const jsAt = lineOf(pLines, /^WRITINGS OF JOSEPH SMITH/, abrAt);
  const aofAt = lineOf(pLines, /^THE ARTICLES OF FAITH/, jsAt);
  // Writings of Joseph Smith 1 (JS—Matthew) then 2 (JS—History): split where verse 1 restarts.
  let jsHAt = -1;
  for (let i = jsAt, ones = 0; i < aofAt; i++) if (/^\s*1[.,]\s/.test(pLines[i]) && ++ones === 2) { jsHAt = i; break; }
  const none = /^\u0000$/;
  return [
    ...kjv, ...bom, ...dc,
    ...parseOcr(pText, [{ slug: 'moses', from: mosesAt, to: abrAt, chapter: /^CHAPTER \d/, firstChapter: 1 }]),
    ...parseOcr(pText, [{ slug: 'abr', from: abrAt, to: jsAt, chapter: /^CHAPTER \d/, firstChapter: 1 }]),
    ...parseOcr(pText, [{ slug: 'js-m', from: jsAt + 1, to: jsHAt, chapter: none, firstChapter: 1, open: true }]),
    ...parseOcr(pText, [{ slug: 'js-h', from: jsHAt, to: aofAt, chapter: none, firstChapter: 1, open: true }]),
    ...parseOcr(pText, [{ slug: 'a-of-f', from: aofAt + 1, to: aofAt + 90, chapter: none, firstChapter: 1, open: true }]).filter((v) => v.v <= 13),
  ];
}

// ---- scripture index ----
// verses [{ slug, ch, v, text }] -> the index verbatimCites reads: one word
// stream over every chapter (a break between chapters), each word's chapter
// and verse, and the stream positions where each six-word shingle starts.
function scriptureIndex(verses) {
  const vocab = new Map();
  const ids = [];
  const verseOf = [];
  const chapterOf = []; // index into chapters
  const chapters = [];  // 'slug|ch'
  const chapterAt = new Map();
  for (const v of verses) { // book order: a chapter's verses are consecutive
    const key = `${v.slug}|${v.ch}`;
    if (!chapterAt.has(key)) {
      chapterAt.set(key, chapters.length);
      chapters.push(key);
      ids.push(-1); verseOf.push(0); chapterOf.push(-1); // chapter break
    }
    const c = chapterAt.get(key);
    for (const { w } of words(v.text)) {
      if (!vocab.has(w)) vocab.set(w, vocab.size);
      ids.push(vocab.get(w)); verseOf.push(v.v); chapterOf.push(c);
    }
  }
  const stream = Int32Array.from(ids);
  const shingles = new Map();
  for (let p = 0; p + SHINGLE <= stream.length; p++) {
    const key = shingleKey(stream, p);
    if (key === null) continue;
    const at = shingles.get(key);
    if (at === undefined) shingles.set(key, p);
    else if (typeof at === 'number') shingles.set(key, [at, p]);
    else at.push(p);
  }
  // Words per verse, for the threshold of a short cited text.
  const verseWords = new Map();
  for (let p = 0; p < stream.length; p++) {
    if (stream[p] < 0) continue;
    const k = `${chapters[chapterOf[p]]}|${verseOf[p]}`;
    verseWords.set(k, (verseWords.get(k) || 0) + 1);
  }
  return { vocab, stream, verseOf: Int32Array.from(verseOf), chapterOf: Int32Array.from(chapterOf), chapters, shingles, verseWords };
}

// A shingle's map key (its word ids as characters), or null across a break.
function shingleKey(stream, p) {
  let key = '';
  for (let k = 0; k < SHINGLE; k++) {
    const id = stream[p + k];
    if (id < 0) return null;
    key += String.fromCharCode(id & 0xffff, id >>> 16);
  }
  return key;
}

// ---- talk ----
// The talk's prose without BYU's insertions (the reference label around each
// citation span, the modern footnote marker, the Journal of Discourses
// page/column markers and line-end hyphens), as text with '\n' at paragraph
// ends, and the offset in that text where each citation span stood.
function talkText(html) {
  let h = String(html || '');
  const body = h.search(/<body[\s>]/i);
  if (body >= 0) h = h.slice(body);
  h = h.replace(/<div class="hyphen">-<\/div>/g, '')
    .replace(/<div class="break[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<span class="citation" id="(\d+)"/g, '\u0001$1\u0002$&');
  h = dropInsertions(h).replace(/\s+/g, ' ');
  h = h.replace(/<\/?(?:p|div|h\d|li|ul|ol|br|tr|td|table|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  h = decodeEntities(h);
  const citeAt = new Map();
  let text = '';
  let last = 0;
  const marks = /\u0001(\d+)\u0002/g;
  let m;
  while ((m = marks.exec(h))) {
    text += h.slice(last, m.index);
    citeAt.set(m[1], text.length);
    last = marks.lastIndex;
  }
  text += h.slice(last);
  return { text, citeAt };
}

// html with every BYU insertion element removed (talk-source's
// dropByuInsertions, the rule the reader's excerpt and the build's count use);
// the \u0001id\u0002 marks of spans nested inside one (a ccontainer wraps its
// citation) stay in its place.
function dropInsertions(html) {
  return dropByuInsertions(html, (inner) => (inner.match(/\u0001\d+\u0002/g) || []).join(''));
}

// ---- matching ----
// Every quotation in text: a maximal run of SHINGLE or more consecutive words
// that one chapter of the index holds in the same order. Each is
// { chapter:'slug|ch', at:[char offset per word], verses:[verse per word] }.
// Reads nothing but the text and the index.
function quotations(text, index) {
  const ws = words(text);
  // Paragraph ends break runs: a word after a '\n' starts a new segment.
  const ids = new Int32Array(ws.length);
  const para = new Int32Array(ws.length);
  let p = 0;
  let nl = text.indexOf('\n');
  for (let i = 0; i < ws.length; i++) {
    while (nl >= 0 && nl < ws[i].at) { p++; nl = text.indexOf('\n', nl + 1); }
    para[i] = p;
    const id = index.vocab.get(ws[i].w);
    ids[i] = id === undefined ? -1 : id;
  }
  const out = [];
  let open = new Map(); // stream offset s - i -> run start in talk words
  const emit = (diag, start, endExcl) => {
    const len = endExcl - start + SHINGLE - 1;
    const s0 = start + diag;
    out.push({
      chapter: index.chapters[index.chapterOf[s0]],
      at: ws.slice(start, start + len).map((x) => x.at),
      verses: Array.from(index.verseOf.subarray(s0, s0 + len)),
    });
  };
  for (let i = 0; i + SHINGLE <= ws.length; i++) {
    const next = new Map();
    let key = null;
    if (para[i] === para[i + SHINGLE - 1]) key = shingleKey(ids, i);
    const hits = key === null ? undefined : index.shingles.get(key);
    if (hits !== undefined) {
      for (const s of typeof hits === 'number' ? [hits] : hits) {
        const diag = s - i;
        next.set(diag, open.has(diag) ? open.get(diag) : i);
      }
    }
    for (const [diag, start] of open) if (!next.has(diag)) emit(diag, start, i);
    open = next;
  }
  for (const [diag, start] of open) emit(diag, start, Math.max(0, ws.length - SHINGLE + 1));
  return out;
}

// The cite ids of one talk the matcher re-derives (see the header).
function verbatimCites(html, cites, index) {
  const { text, citeAt } = talkText(html);
  const quotes = quotations(text, index);
  const kept = new Set();
  for (const c of cites) {
    const at = citeAt.get(String(c.id));
    if (at === undefined) continue;
    const chapter = `${c.slug}|${c.ch}`;
    const verses = new Set(c.verses.map(Number));
    let cited = 0;
    for (const v of verses) cited += index.verseWords.get(`${chapter}|${v}`) || 0;
    if (!cited) continue;
    const need = Math.max(SHINGLE, Math.min(MIN_RUN, cited));
    const paraStart = text.lastIndexOf('\n', at - 1) + 1;
    const from = Math.max(paraStart, at - WINDOW);
    for (const q of quotes) {
      if (q.chapter !== chapter) continue;
      let n = 0;
      for (let k = 0; k < q.at.length; k++) if (q.at[k] >= from && q.at[k] < at && verses.has(q.verses[k])) n++;
      if (n >= need) { kept.add(c.id); break; }
    }
  }
  return kept;
}

module.exports = { SHINGLE, MIN_RUN, WINDOW, parseGutenberg, parseOcr, loadScripture, scriptureIndex, verbatimCites };
