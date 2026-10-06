#!/usr/bin/env node
/*
 * RESEARCH SCRIPT (issue #63) — not part of the extension, the build, or the
 * checks. It measures what an independent TPJS index recovers from the
 * public-domain 1938 text alone; findings in
 * docs/research/tpjs-independent-index.md.
 *
 * Inputs:
 *   - TPJS pages: src/citations/data/talks/27xxxx.html.gz (the 371 `T` sources),
 *     stripped of Galbraith's apparatus (footnote list + footRef markers) here.
 *   - Public-domain scripture text, downloaded by hand into --scripture-dir:
 *       kjv.txt     Project Gutenberg eBook #10 (King James Version)
 *       bom.txt     Project Gutenberg eBook #17 (The Book of Mormon)
 *       dc1923.txt  archive.org doctrinecovenant0000jose_n3n7 (D&C, 1923 printing) _djvu.txt
 *       pgp1929.txt archive.org pearlofgreatpric0000jose_d8d6 (PGP, 1929 printing) _djvu.txt
 *   - Galbraith's `T` cites (src/citations/data/citations/*.json) are read ONLY
 *     to score coverage; nothing from them feeds the extraction.
 *
 * Usage:
 *   node tools/research-tpjs-index.js --scripture-dir <dir> --out <dir> [--n 7] [--maxdf 3] [--minrun 8]
 *   node tools/research-tpjs-index.js --scripture-dir <dir> --out <dir> --sweep
 *
 * Writes <out>/explicit.json, <out>/quotes.json, <out>/summary.json, and
 * <out>/sample-*.txt listings for the hand check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const { stripTags } = require('./build-citation-data.js');
const BOOKS = require('../src/shared/books.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes('--' + name);

// ---------- text normalisation ----------
const SPELL = { shew: 'show', shewed: 'showed', sheweth: 'showeth', shewn: 'shown', shewing: 'showing', ancle: 'ankle', stablish: 'establish' };
function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’'`ʼ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => SPELL[t] || t);
}

// ---------- TPJS pages (apparatus stripped) ----------
function loadTpjs() {
  const sources = require('../src/citations/data/sources.json');
  const ids = Object.keys(sources).filter((k) => sources[k].c === 'T').sort();
  return ids.map((id) => {
    let h = zlib.gunzipSync(fs.readFileSync(`${ROOT}/src/citations/data/talks/${id}.html.gz`)).toString('utf8');
    // Galbraith: the per-page footnote list and the in-body footRef markers.
    h = h.replace(/<div class="footnotes">[\s\S]*?(?=<div class="textFootnotes">|<\/div><\/div><\/body>)/, '');
    h = h.replace(/<span class="footRef">[^<]*<\/span>/g, '');
    // BYU's page chrome (prev/next, "STPJS N").
    h = h.replace(/<div class="pageNum">[\s\S]*?STPJS \d+<\/div>/, '');
    return { page: +id - 270000, text: stripTags(h) };
  });
}

// ---------- scripture corpora ----------
const OT_NT = Object.keys(BOOKS.LDS_TO_USFM); // canonical KJV order
const BOM = ['1-ne', '2-ne', 'jacob', 'enos', 'jarom', 'omni', 'w-of-m', 'mosiah', 'alma', 'hel', '3-ne', '4-ne', 'morm', 'ether', 'moro'];

// Gutenberg texts with inline "c:v " markers; a "1:1" marker opens the next book.
function parseGutenberg(file, order) {
  let t = fs.readFileSync(file, 'utf8');
  t = t.slice(t.indexOf('*** START'), t.indexOf('*** END'));
  t = t.split('\n').filter((l) => !/^\S.* Chapter \d+\s*$/.test(l)).join('\n');
  const re = /(?:^|\s)(\d+):(\d+)\s/g;
  const marks = [];
  let m;
  while ((m = re.exec(t))) marks.push({ ch: +m[1], v: +m[2], start: m.index, end: re.lastIndex });
  const verses = []; // {slug, ch, v, text}
  let b = -1;
  for (let i = 0; i < marks.length; i++) {
    const k = marks[i];
    if (k.ch === 1 && k.v === 1) b++;
    if (b < 0) continue;
    const text = t.slice(k.end, i + 1 < marks.length ? marks[i + 1].start : t.length);
    verses.push({ slug: order[b], ch: k.ch, v: k.v, text: text.replace(/\s+/g, ' ').trim() });
  }
  if (b + 1 !== order.length) throw new Error(`${file}: found ${b + 1} books, expected ${order.length}`);
  return verses;
}

// OCR'd 1920s editions: chapter headings by regex, verse lines "N. text".
// A verse-number line is accepted when N is not yet seen in the chapter and
// lies within [last-8, last+3] (two-column OCR sometimes swaps column order).
function looksLikeApparatus(line) {
  const l = line.trim();
  if (!l) return true;
  if (/^(?:Fig(?:ure)?s?\.?\s*\d|A FACSIMILE|EXPLANATION OF)/.test(l)) return true; // Abraham facsimile captions
  if (/^[a-z]{1,2}[,.]\s/.test(l) && /\d/.test(l)) return true; // footnote key "a, 20:46"
  const digits = (l.match(/\d/g) || []).length;
  const words = (l.match(/[A-Za-z]{3,}/g) || []).filter((w) => !/^(see|sec|ver|chap|ch)$/i.test(w));
  if (digits >= 2 && words.length < 4) return true;
  if (/^[\d\s.,_—–-]*[A-Z][A-Z ,.&;:'’\d-]+$/.test(l) && l === l.toUpperCase() && l.length < 60) return true; // running heads
  return false;
}
function parseOcr(file, segments) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const verses = [];
  for (const seg of segments) {
    let ch = seg.open ? seg.firstChapter : seg.firstChapter - 1; // open: the range starts inside chapter 1
    let cur = null;
    let seen = new Set();
    let last = 0;
    let skipping = false;
    let buf = [];
    const flush = () => {
      if (cur) cur.text = buf.join('\n').replace(/-\s*\n\s*(?=[a-z])/g, '').replace(/\s+/g, ' ').trim();
      buf = [];
    };
    for (let i = seg.from; i < seg.to; i++) {
      const line = lines[i];
      if (seg.skipStart && seg.skipStart.test(line)) { skipping = true; continue; }
      if (seg.chapter.test(line)) {
        flush(); cur = null; skipping = false; ch++; seen = new Set(); last = 0; continue;
      }
      if (skipping) continue;
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
function lineOf(file, re, from = 0) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error(`${file}: no line matches ${re}`);
}
function loadScripture(dir) {
  const kjv = parseGutenberg(path.join(dir, 'kjv.txt'), OT_NT);
  const bom = parseGutenberg(path.join(dir, 'bom.txt'), BOM);
  const dcF = path.join(dir, 'dc1923.txt');
  const dcStart = lineOf(dcF, /^SECTION\s/);
  const dcEnd = lineOf(dcF, /^OFFICIAL DECLARATION/);
  const dc = parseOcr(dcF, [{ slug: 'dc', from: dcStart, to: dcEnd, chapter: /^SECTION\s/, firstChapter: 1 }]);
  const pF = path.join(dir, 'pgp1929.txt');
  const mosesAt = lineOf(pF, /^CHAPTER 1\./);
  const abrAt = lineOf(pF, /^THE BOOK OF ABRAHAM/, mosesAt);
  const jsAt = lineOf(pF, /^WRITINGS OF JOSEPH SMITH/, abrAt);
  const aofAt = lineOf(pF, /^THE ARTICLES OF FAITH/, jsAt);
  const pgp = [
    ...parseOcr(pF, [{ slug: 'moses', from: mosesAt, to: abrAt, chapter: /^CHAPTER \d/, firstChapter: 1 }]),
    ...parseOcr(pF, [{ slug: 'abr', from: abrAt, to: jsAt, chapter: /^CHAPTER \d/, firstChapter: 1 }]),
  ];
  // Writings of Joseph Smith 1 (JS—Matthew) then 2 (JS—History): split where verse 1 restarts.
  const jsLines = fs.readFileSync(pF, 'utf8').split('\n');
  let jsHAt = -1;
  for (let i = jsAt, ones = 0; i < aofAt; i++) if (/^\s*1[.,]\s/.test(jsLines[i]) && ++ones === 2) { jsHAt = i; break; }
  const none = /^\u0000$/;
  const jsm = parseOcr(pF, [{ slug: 'js-m', from: jsAt + 1, to: jsHAt, chapter: none, firstChapter: 1, open: true }]);
  const jsh = parseOcr(pF, [{ slug: 'js-h', from: jsHAt, to: aofAt, chapter: none, firstChapter: 1, open: true }]);
  const aof = parseOcr(pF, [{ slug: 'a-of-f', from: aofAt + 1, to: aofAt + 90, chapter: none, firstChapter: 1, open: true }]).filter((v) => v.v <= 13);
  return [...kjv, ...bom, ...dc, ...pgp, ...jsm, ...jsh, ...aof];
}

// ---------- explicit references ----------
const ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, last: -1 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
function ordinal(s) {
  s = String(s).toLowerCase().trim();
  let h = /^one hundred and (.+)$/.exec(s);
  if (h) { const r = ordinal(h[1]); return r ? 100 + r : null; }
  let m = /^(\d+)(?:st|nd|rd|th|d)?$/.exec(s);
  if (m) return +m[1];
  if (s in ORD_WORDS) return ORD_WORDS[s];
  m = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-?(\w+)$/.exec(s);
  if (m && m[2] in ORD_WORDS) return TENS[m[1]] + ORD_WORDS[m[2]];
  const tens = s.replace(/ieth$/, 'y');
  if (tens in TENS) return TENS[tens];
  return null;
}
const ORD = '(?:\\d+(?:st|nd|rd|th|d)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|(?:twent|thirt|fort|fift|sixt|sevent|eight|ninet)(?:y-\\w+|ieth)|last)';

// Book name forms -> slug. Numbered books take a prefix (1, 1st, First, I).
const NAMES = [
  ['gen', 'Genesis|Gen\\.'], ['ex', 'Exodus|Exod?\\.'], ['lev', 'Leviticus|Lev\\.'], ['num', 'Numbers|Num\\.'], ['deut', 'Deuteronomy|Deut\\.'],
  ['josh', 'Joshua|Josh\\.'], ['judg', 'Judges|Judg\\.'], ['ruth', 'Ruth'], ['job', 'Job'], ['ps', 'Psalms?|Ps\\.|Psa\\.'], ['prov', 'Proverbs|Prov\\.'],
  ['eccl', 'Ecclesiastes|Eccl?\\.'], ['song', 'Song of Solomon'], ['isa', 'Isaiah|Isa\\.'], ['jer', 'Jeremiah|Jer\\.'], ['lam', 'Lamentations|Lam\\.'],
  ['ezek', 'Ezekiel|Ezek\\.'], ['dan', 'Daniel|Dan\\.'], ['hosea', 'Hosea|Hos\\.'], ['joel', 'Joel'], ['amos', 'Amos'], ['obad', 'Obadiah'], ['jonah', 'Jonah'],
  ['micah', 'Micah|Mic\\.'], ['nahum', 'Nahum'], ['hab', 'Habakkuk|Hab\\.'], ['zeph', 'Zephaniah|Zeph\\.'], ['hag', 'Haggai'], ['zech', 'Zechariah|Zech\\.'], ['mal', 'Malachi|Mal\\.'],
  ['ezra', 'Ezra'], ['neh', 'Nehemiah|Neh\\.'], ['esth', 'Esther'],
  ['matt', 'Matthew|Matt?\\.|St\\.? Matthew'], ['mark', 'Mark'], ['luke', 'Luke'], ['john', 'John|St\\.? John'], ['acts', 'Acts'], ['rom', 'Romans|Rom\\.'],
  ['gal', 'Galatians|Gal\\.'], ['eph', 'Ephesians|Eph\\.'], ['philip', 'Philippians|Phil\\.'], ['col', 'Colossians|Col\\.'], ['titus', 'Titus'], ['philem', 'Philemon'],
  ['heb', 'Hebrews|Heb\\.'], ['james', 'James|Jas\\.'], ['jude', 'Jude'], ['rev', 'Revelations?|Rev\\.'],
  ['mosiah', 'Mosiah'], ['alma', 'Alma'], ['hel', 'Helaman|Hel\\.'], ['ether', 'Ether'], ['moro', 'Moroni|Moro\\.'], ['morm', 'Mormon'], ['jacob', 'Jacob'], ['enos', 'Enos'], ['omni', 'Omni'],
  ['moses', 'Moses'], ['abr', 'Abraham|Abr\\.'],
];
const NUMBERED = [
  ['sam', 'Samuel|Sam\\.', 2], ['kgs', 'Kings|Kgs\\.', 2], ['chr', 'Chronicles|Chron\\.', 2], ['cor', 'Corinthians|Cor\\.', 2], ['thes', 'Thessalonians|Thess?\\.', 2],
  ['tim', 'Timothy|Tim\\.', 2], ['pet', 'Peter|Pet\\.', 2], ['jn', 'John|Jno\\.', 3], ['ne', 'Nephi|Ne\\.', 4],
];
const PREFIX = { 1: '(?:1st|1|I|First)', 2: '(?:2nd|2d|2|II|Second)', 3: '(?:3rd|3d|3|III|Third)', 4: '(?:4th|4|IV|Fourth)' };
// A name that is also a person is accepted only with a chapter:verse (or ORD chapter) after it.
const PERSON = new Set(['moses', 'abr', 'alma', 'jacob', 'moro', 'morm', 'ether', 'hel', 'mosiah', 'enos', 'omni', 'job', 'daniel', 'john', 'mark', 'luke', 'james', 'jude', 'dan', 'ruth', 'joel', 'amos', 'jonah', 'ezra']);
function bookAlternatives() {
  const alts = [];
  for (const [n, pat, max] of NUMBERED) {
    for (let k = 1; k <= max; k++) {
      const slug = n === 'ne' ? `${k}-ne` : n === 'jn' ? `${k}-jn` : `${k}-${n}`;
      alts.push({ slug, re: `${PREFIX[k]}\\s*(?:Epistle\\s+(?:of|to\\s+the)\\s+)?(?:${pat})` });
    }
  }
  for (const [slug, pat] of NAMES) alts.push({ slug, re: `(?:${pat})` });
  return alts;
}
const ALTS = bookAlternatives();
const BOOK_RE = ALTS.map((a, i) => `(?<b${i}>${a.re})`).join('|');
function bookOf(groups) { for (let i = 0; i < ALTS.length; i++) if (groups['b' + i]) return ALTS[i].slug; return null; }

function verseList(s) {
  // "25, 26", "1–3, 14", "15th, 16th, 17th, 18th", "1st and 2nd"
  const out = [];
  for (const part of String(s).split(/,|\band\b/)) {
    const m = /(\w+)\s*(?:[-–—]|to(?: the)?)\s*(\w+)/.exec(part.trim());
    if (m) { const a = ordinal(m[1]), b = ordinal(m[2]); if (a && b && b >= a && b - a < 60) for (let v = a; v <= b; v++) out.push(v); continue; }
    const v = ordinal(part.trim().replace(/\s*verses?$/, ''));
    if (v) out.push(v);
  }
  return out;
}

function explicitRefs(pages, chapterCount, verseCount = {}) {
  const found = [];
  const VNUM = '\\d{1,3}(?!\\d|\\s*:\\s*\\d)(?:\\s*(?:[-–—]|,|and)\\s*\\d{1,3}(?!\\d|\\s*:\\s*\\d))*';
  const VORD = `${ORD}(?:\\s*(?:,|and|[-–—]|to(?: the)?)\\s*${ORD})*`;
  const patterns = [
    // Book ch:v   ("Rev. 22:17", "Romans 11:25, 26", "Revelation, 19:10th verse", "Sec. 93:29")
    { form: 'book ch:v', re: new RegExp(`(?:${BOOK_RE}),?\\s+(?:\\(\\s*|chapt?\\.\\s*)?(?<ch>\\d+)\\s*:\\s*(?<vs>${VNUM})(?:th)?`, 'g') },
    { form: 'D&C sec ch:v', re: new RegExp(`(?<dc>Sec(?:tion|\\.)|D\\.?\\s*(?:&|and)\\s*C\\.?|Doc(?:trine|\\.)\\s*(?:&|and)\\s*Cov(?:enants|\\.)(?:,?\\s*Sec(?:tion|\\.))?)\\s*(?<ch>\\d+)\\s*:\\s*(?<vs>${VNUM})`, 'g') },
    // the ORD verse of [the] ORD chapter of Book
    { form: 'ORD verse of ORD chapter of book', re: new RegExp(`(?<vs>${VORD})\\s+verses?\\s+of\\s+(?:the\\s+)?(?<ch>${ORD})\\s+chapter\\s+of\\s+(?:the\\s+)?(?:(?:Gospel|Epistle|Book)\\s+(?:of|according to|to the)\\s+)?(?:St\\.\\s*)?(?:${BOOK_RE})`, 'gi') },
    // the ORD chapter of Book[, ORD (and ORD) verses]
    { form: 'ORD chapter of book', re: new RegExp(`(?<ch>${ORD})\\s+chapter\\s+of\\s+(?:the\\s+)?(?:(?:His\\s+)?(?:Gospel|Epistle|Book)\\s+(?:of|according to|to the)\\s+)?(?:St\\.\\s*)?(?:${BOOK_RE})(?:’s account)?(?:,?\\s+(?:(?:from\\s+)?the\\s+)?(?<vs>${VORD})\\s+verses?)?`, 'gi') },
    // Book, ORD chapter[, ORD verse(s)]  ("Mark, 16th chapter, 15th, 16th verses", "1 Peter, 3rd chap. 19th verse")
    { form: 'book ORD chapter', re: new RegExp(`(?:${BOOK_RE}),?\\s+(?<ch>${ORD})\\s+chap(?:ter|\\.)(?:,?\\s+(?:(?:from\\s+)?the\\s+)?(?<vs>${VORD})\\s+(?:to\\s+last\\s+)?verses?)?`, 'g') },
    // "the fiftieth Psalm, from the first to the fifth verse inclusive", "the one hundred and second Psalm"
    { form: 'ORD Psalm', re: new RegExp(`(?<ch>(?:one\\s+hundred\\s+and\\s+)?${ORD})\\s+(?<b${ALTS.findIndex((a) => a.slug === 'ps')}>Psalm)(?:,\\s+from\\s+the\\s+(?<vs>${ORD}\\s+to\\s+the\\s+${ORD})\\s+verses?)?`, 'gi') },
    // the ORD section of the Doctrine and Covenants[, v-v]
    { form: 'ORD section of D&C', re: new RegExp(`(?<ch>${ORD})\\s+section\\s+of\\s+the\\s+(?<dc>Doctrine\\s+and\\s+Covenants)(?:,\\s*(?<vs>${VNUM}))?`, 'gi') },
    // Doctrine and Covenants, Section 124, 127, 128 and 132 / Sec. 76 (chapter only)
    { form: 'D&C section list', re: new RegExp(`(?<dc>Doc(?:trine|\\.)\\s*(?:&|and)\\s*Cov(?:enants|\\.)|D\\.?\\s*(?:&|and)\\s*C\\.?),?\\s*(?:Sec(?:tion|s?\\.)s?)\\s*(?<chs>\\d+(?:\\s*(?:,|and)\\s*\\d+)*)(?![\\d]|\\s*:\\s*\\d)`, 'gi') },
    // "See Isaiah 11;" (chapter only, after "see")
    { form: 'see book ch', re: new RegExp(`\\b[Ss]ee\\s+(?:${BOOK_RE})\\s+(?<ch>\\d{1,3})(?=\\s*[;,.)\\]])(?!\\s*[:\\d])`, 'g') },
    // Book ch (chapter only), bracketed or parenthesised: "(see Rev. 5)", "[2 Peter 1.]"
    { form: 'book ch (bracketed)', re: new RegExp(`[(\\[]\\s*(?:see\\s+)?(?:${BOOK_RE}),?\\s+(?<ch>\\d+)\\.?\\s*[)\\]]`, 'g') },
  ];
  for (const { page, text } of pages) {
    const taken = []; // [start,end) spans already claimed by an earlier, more specific pattern
    for (const p of patterns) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        if (taken.some(([a, b]) => s < b && e > a)) continue;
        const g = m.groups;
        const slug = g.dc ? 'dc' : bookOf(g);
        if (!slug) continue;
        const chs = g.chs ? g.chs.split(/\s*(?:,|and)\s*/).map(Number) : [ordinal(g.ch)];
        // A person name ("Moses", "Alma", "John") counts only as part of a ch:v or an ORD-chapter form.
        if (PERSON.has(slug) && /\(bracketed\)|^see book ch$/.test(p.form)) continue;
        for (let ch of chs) {
          if (ch === -1) ch = chapterCount[slug] || null; // "the last chapter of Revelation"
          if (!ch) continue;
          let verses = g.vs ? verseList(g.vs) : [];
          const toLast = g.vs && /(\w+)\s+to\s+(?:the\s+)?last/.exec(g.vs);
          if (toLast) { // "16th to last verses"
            verses = [];
            for (let v = ordinal(toLast[1]); v <= (verseCount[`${slug}|${ch}`] || 0); v++) verses.push(v);
          }
          found.push({ page, form: p.form, slug, ch, verses, raw: m[0].replace(/\s+/g, ' '), ctx: text.slice(Math.max(0, s - 80), Math.min(text.length, e + 80)) });
        }
        let end = e;
        if (p.form === 'book ch:v' || p.form === 'D&C sec ch:v') {
          // continuation list after a ch:v: "D. and C. 5:18-19, 29:8-10, 101:23-25"
          const cont = new RegExp(`^\\s*[,;]\\s*(?:and\\s+)?(\\d{1,3})\\s*:\\s*(${VNUM})`);
          let c;
          while ((c = cont.exec(text.slice(end)))) {
            found.push({ page, form: p.form + ' (continued)', slug, ch: +c[1], verses: verseList(c[2]), raw: c[0].trim(), ctx: text.slice(Math.max(0, s - 80), Math.min(text.length, end + c[0].length + 80)) });
            end += c[0].length;
          }
        }
        taken.push([s, end]);
      }
    }
  }
  return found;
}

// ---------- quotation matching ----------
// Word rarity across scripture verses: idf(w) = log10(N / verses containing w).
function buildIdf(verses) {
  const df = new Map();
  for (const v of verses) for (const w of new Set(tokens(v.text))) df.set(w, (df.get(w) || 0) + 1);
  const N = verses.length;
  const idf = new Map();
  for (const [w, c] of df) idf.set(w, Math.log10(N / c));
  return (w) => (idf.has(w) ? idf.get(w) : Math.log10(N));
}
// Specificity of a matched run: summed rarity of its distinct words. Stock
// phrases ("of the kingdom of god and") score low; named or unusual wording high.
function specificity(words, idf) {
  let s = 0;
  for (const w of new Set(words.split(' '))) s += idf(w);
  return +s.toFixed(2);
}
// Parallel passages (Isaiah in 2 Nephi, Matthew 5-7 in 3 Nephi, Mark 16 in
// Mormon 9, Malachi 4 in D&C): when a non-Bible verse's matched span is mostly
// covered by Bible verses matched on the same page, keep only the Bible verses.
function resolveParallels(quotes) {
  const isBible = (q) => !!BOOKS.LDS_TO_USFM[q.slug];
  const byPage = new Map();
  for (const q of quotes) { let a = byPage.get(q.page); if (!a) byPage.set(q.page, (a = [])); a.push(q); }
  const out = [];
  for (const qs of byPage.values()) {
    const bible = new Set();
    for (const q of qs) if (isBible(q)) for (let i = q.start; i < q.start + q.len; i++) bible.add(i);
    const kept = qs.filter((q) => {
      if (isBible(q)) return true;
      let c = 0; for (let i = q.start; i < q.start + q.len; i++) if (bible.has(i)) c++;
      return c / q.len < 0.8;
    });
    // Same words in two verses (synoptic parallels, repeated wording within a
    // chapter): a verse whose span is 80% inside a strictly longer match of
    // another verse is the weaker reading; drop it. Equal runs both stay.
    for (const q of kept) {
      const dominated = kept.some((o) => o !== q && o.len > q.len &&
        Math.min(o.start + o.len, q.start + q.len) - Math.max(o.start, q.start) >= 0.8 * q.len);
      if (!dominated) out.push(q);
    }
  }
  return out;
}

// Corpus formulas: the same short run recurring on many TPJS pages is the
// compilation's own stock wording ("Church of Jesus Christ of Latter-day
// Saints", "the gift of the Holy Ghost by the laying on of hands"), not a cite.
function dropFormulas(quotes, minPages = 4, maxLen = 11) {
  const pagesOf = new Map();
  for (const q of quotes) { let s = pagesOf.get(q.words); if (!s) pagesOf.set(q.words, (s = new Set())); s.add(q.page); }
  return quotes.filter((q) => !(q.len <= maxLen && pagesOf.get(q.words).size >= minPages));
}

function buildIndex(verses, n) {
  const idx = new Map(); // shingle -> Set(verseKey)
  for (const v of verses) {
    const key = `${v.slug} ${v.ch}:${v.v}`;
    const t = tokens(v.text);
    for (let i = 0; i + n <= t.length; i++) {
      const sh = t.slice(i, i + n).join(' ');
      let s = idx.get(sh);
      if (!s) idx.set(sh, (s = new Set()));
      s.add(key);
    }
  }
  return idx;
}
function matchPages(pages, idx, n, maxdf, minrun, idf, minspec = 0) {
  const out = [];
  for (const { page, text } of pages) {
    const t = tokens(text);
    const pos = new Map(); // verseKey -> positions
    for (let i = 0; i + n <= t.length; i++) {
      const s = idx.get(t.slice(i, i + n).join(' '));
      if (!s || s.size > maxdf) continue;
      for (const k of s) { let a = pos.get(k); if (!a) pos.set(k, (a = [])); a.push(i); }
    }
    for (const [key, ps] of pos) {
      // maximal runs of consecutive shingle positions; keep the longest
      let best = null;
      for (let j = 0; j < ps.length;) {
        let k = j; while (k + 1 < ps.length && ps[k + 1] === ps[k] + 1) k++;
        const len = ps[k] - ps[j] + n;
        if (!best || len > best.len) best = { start: ps[j], len };
        j = k + 1;
      }
      if (best.len >= minrun) {
        const [slug, cv] = key.split(' ');
        const [ch, v] = cv.split(':').map(Number);
        const words = t.slice(best.start, best.start + best.len).join(' ');
        const spec = specificity(words, idf);
        if (spec >= minspec) out.push({ page, slug, ch, v, len: best.len, start: best.start, spec, words });
      }
    }
  }
  return out;
}

// ---------- coverage against the yardstick ----------
function loadYardstick() {
  const sources = require('../src/citations/data/sources.json');
  const dir = `${ROOT}/src/citations/data/citations`;
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    const chOf = {};
    for (const [ch, vs] of Object.entries(d.index)) for (const ids of Object.values(vs)) for (const id of ids) chOf[id] = chOf[id] || +ch;
    for (const [id, c] of Object.entries(d.cites)) {
      const src = sources[String(c.t)];
      if (!src || src.c !== 'T') continue;
      out.push({ id, page: c.t - 270000, slug: d.book, ch: chOf[id], verses: verseList(c.v) });
    }
  }
  return out;
}
function coverage(yard, verseHits, chapterHits) {
  let verse = 0, chapter = 0;
  for (const y of yard) {
    if (y.verses.some((v) => verseHits.has(`${y.page}|${y.slug}|${y.ch}|${v}`))) verse++;
    if (chapterHits.has(`${y.page}|${y.slug}|${y.ch}`)) chapter++;
  }
  return { verse, chapter, of: yard.length };
}
function hitSets(explicit, quotes) {
  const verseHits = new Set(), chapterHits = new Set();
  for (const r of explicit || []) {
    chapterHits.add(`${r.page}|${r.slug}|${r.ch}`);
    for (const v of r.verses) if (v > 0) verseHits.add(`${r.page}|${r.slug}|${r.ch}|${v}`);
  }
  for (const q of quotes || []) {
    chapterHits.add(`${q.page}|${q.slug}|${q.ch}`);
    verseHits.add(`${q.page}|${q.slug}|${q.ch}|${q.v}`);
  }
  return { verseHits, chapterHits };
}
// A Galbraith verse key exists for a page/verse pair?
function yardVerseSet(yard) {
  const s = new Set();
  for (const y of yard) for (const v of y.verses) s.add(`${y.page}|${y.slug}|${y.ch}|${v}`);
  return s;
}

// ---------- main ----------
function main() {
  const dir = arg('scripture-dir');
  const out = arg('out');
  if (!dir || !out) { console.error('usage: --scripture-dir <dir> --out <dir> [--n 7 --maxdf 3 --minrun 8] [--sweep]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const pages = loadTpjs();
  const verses = loadScripture(dir);
  const yard = loadYardstick();
  const yardVerses = yardVerseSet(yard);

  // Corpus check: how many Galbraith-cited (book, ch, v) keys does each parsed corpus hold text for?
  const have = new Set(verses.filter((v) => tokens(v.text).length >= 3).map((v) => `${v.slug}|${v.ch}|${v.v}`));
  const corpusCheck = {};
  for (const y of yard) for (const v of y.verses) {
    const vol = BOOKS.LDS_TO_USFM[y.slug] ? 'KJV' : BOM.includes(y.slug) ? 'BoM' : y.slug === 'dc' ? 'D&C' : 'PGP';
    const c = corpusCheck[vol] || (corpusCheck[vol] = { cited: 0, present: 0, missing: [] });
    c.cited++;
    if (have.has(`${y.slug}|${y.ch}|${v}`)) c.present++; else if (c.missing.length < 40) c.missing.push(`${y.slug} ${y.ch}:${v}`);
  }
  const perVol = {};
  for (const v of verses) {
    const vol = BOOKS.LDS_TO_USFM[v.slug] ? 'KJV' : BOM.includes(v.slug) ? 'BoM' : v.slug === 'dc' ? 'D&C' : 'PGP';
    perVol[vol] = (perVol[vol] || 0) + 1;
  }

  const chapterCount = {};
  for (const v of verses) chapterCount[v.slug] = Math.max(chapterCount[v.slug] || 0, v.ch);
  const verseExists = new Set(verses.map((v) => `${v.slug}|${v.ch}|${v.v}`));
  const verseCount = {};
  for (const v of verses) verseCount[`${v.slug}|${v.ch}`] = Math.max(verseCount[`${v.slug}|${v.ch}`] || 0, v.v);
  const explicit = explicitRefs(pages, chapterCount, verseCount).map((r) => Object.assign(r, {
    exists: r.verses.length ? r.verses.filter((v) => v > 0).every((v) => verseExists.has(`${r.slug}|${r.ch}|${v}`)) : (chapterCount[r.slug] || 0) >= r.ch,
  }));
  const vt = new Map(verses.map((v) => [`${v.slug}|${v.ch}|${v.v}`, tokens(v.text)]));
  const pageTok = new Map(pages.map((p) => [p.page, ' ' + tokens(p.text).join(' ') + ' ']));
  for (const r of explicit) {
    const pt = pageTok.get(r.page);
    const vs = r.verses.length ? r.verses : [...vt.keys()].filter((k) => k.startsWith(`${r.slug}|${r.ch}|`)).map((k) => +k.split('|')[2]);
    r.supported = vs.some((v) => { const t = vt.get(`${r.slug}|${r.ch}|${v}`) || []; for (let i = 0; i + 5 <= t.length; i++) if (pt.includes(' ' + t.slice(i, i + 5).join(' ') + ' ')) return true; return false; });
  }
  fs.writeFileSync(`${out}/explicit.json`, JSON.stringify(explicit, null, 1));

  const wordCount = pages.reduce((a, p) => a + tokens(p.text).length, 0);
  const summary = { pages: pages.length, tpjsWords: wordCount, scriptureVerses: perVol, corpusCheck: Object.fromEntries(Object.entries(corpusCheck).map(([k, c]) => [k, { cited: c.cited, present: c.present, missingSample: c.missing.slice(0, 15) }])), yardstick: yard.length };
  summary.explicit = {
    refs: explicit.length,
    verseLevelRefs: explicit.filter((r) => r.verses.length).length,
    chapterOnlyRefs: explicit.filter((r) => !r.verses.length).length,
    quotedOnPage: explicit.filter((r) => r.supported).length,
    pageVersePairs: hitSets(explicit, []).verseHits.size,
    pageChapterPairs: hitSets(explicit, []).chapterHits.size,
    byForm: explicit.reduce((a, r) => ((a[r.form] = (a[r.form] || 0) + 1), a), {}),
    coverage: coverage(yard, ...Object.values(hitSets(explicit, []))),
  };

  const idf = buildIdf(verses);
  const runs = has('sweep')
    ? [5, 6, 7, 8].flatMap((n) => [3, 10].flatMap((df) => [n, n + 2].flatMap((minrun) => [0, 4, 6, 8].flatMap((minspec) => [false, true].map((par) => ({ n, maxdf: df, minrun, minspec, parallels: par, formulas: par }))))))
    : [{ n: +arg('n', 6), maxdf: +arg('maxdf', 3), minrun: +arg('minrun', 8), minspec: +arg('minspec', 6), parallels: !has('no-parallels'), formulas: !has('no-formulas') }];
  const sweep = [];
  const idxCache = {};
  let quotes = null;
  for (const r of runs) {
    const idx = idxCache[r.n] || (idxCache[r.n] = buildIndex(verses, r.n));
    let q = matchPages(pages, idx, r.n, r.maxdf, r.minrun, idf, r.minspec);
    if (r.parallels) q = resolveParallels(q);
    if (r.formulas) q = dropFormulas(q);
    const pairs = new Set(q.map((x) => `${x.page}|${x.slug}|${x.ch}|${x.v}`));
    const inYard = [...pairs].filter((k) => yardVerses.has(k)).length;
    const hs = hitSets([], q);
    const un = hitSets(explicit, q);
    sweep.push({ ...r, pageVersePairs: pairs.size, alsoInGalbraith: inYard, coverage: coverage(yard, hs.verseHits, hs.chapterHits), unionPairs: un.verseHits.size, unionCoverage: coverage(yard, un.verseHits, un.chapterHits) });
    quotes = q;
  }
  summary.sweep = sweep;
  if (!has('sweep')) {
    fs.writeFileSync(`${out}/quotes.json`, JSON.stringify(quotes, null, 1));
    const vtext = new Map(verses.map((v) => [`${v.slug} ${v.ch}:${v.v}`, v.text]));
    const pageText = new Map(pages.map((p) => [p.page, p.text]));
    // Hand-check sample: seeded shuffle, stratified by run length.
    let seed = 63;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const shuffled = quotes.map((q) => [rnd(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    // --marginal-to <quotes.json>: sample only matches absent from an earlier (stricter) run.
    const base = arg('marginal-to') ? new Set(JSON.parse(fs.readFileSync(arg('marginal-to'), 'utf8')).map((q) => `${q.page}|${q.slug}|${q.ch}|${q.v}`)) : null;
    const pool = base ? shuffled.filter((q) => !base.has(`${q.page}|${q.slug}|${q.ch}|${q.v}`)) : shuffled;
    if (base) summary.marginalPairs = pool.length;
    const sample = pool.slice(0, +arg('sample', 60));
    const lines = sample.map((q, i) => {
      const yardHit = yardVerses.has(`${q.page}|${q.slug}|${q.ch}|${q.v}`);
      return `#${i + 1} p.${q.page} -> ${q.slug} ${q.ch}:${q.v}  run=${q.len} words  spec=${q.spec}  galbraith=${yardHit ? 'yes' : 'no'}\n  MATCH: ${q.words}\n  VERSE: ${(vtext.get(`${q.slug} ${q.ch}:${q.v}`) || '').slice(0, 400)}\n  PAGE:  …${locate(pageText.get(q.page), q.words)}…\n`;
    });
    fs.writeFileSync(`${out}/sample-quotes.txt`, lines.join('\n'));
    fs.writeFileSync(`${out}/sample-explicit.txt`, explicit.map((r, i) => `#${i + 1} p.${r.page} [${r.form}] "${r.raw}" -> ${r.slug} ${r.ch}${r.verses.length ? ':' + r.verses.join(',') : ''} exists=${r.exists} quoted-on-page=${r.supported}\n  …${r.ctx}…\n`).join('\n'));
    const hs = hitSets(explicit, quotes);
    summary.quotes = sweep[0];
    summary.union = { pageVersePairs: hs.verseHits.size, pageChapterPairs: hs.chapterHits.size, coverage: coverage(yard, hs.verseHits, hs.chapterHits) };
    const vol = (s) => (BOOKS.LDS_TO_USFM[s] ? 'KJV' : BOM.includes(s) ? 'BoM' : s === 'dc' ? 'D&C' : 'PGP');
    summary.quotesByVolume = quotes.reduce((a, q) => ((a[vol(q.slug)] = (a[vol(q.slug)] || 0) + 1), a), {});
    summary.yardByVolume = yard.reduce((a, y) => ((a[vol(y.slug)] = (a[vol(y.slug)] || 0) + 1), a), {});
    const cov = { verse: {}, chapter: {} };
    for (const y of yard) {
      const k = vol(y.slug);
      if (y.verses.some((v) => hs.verseHits.has(`${y.page}|${y.slug}|${y.ch}|${v}`))) cov.verse[k] = (cov.verse[k] || 0) + 1;
    }
    summary.unionCoverageByVolume = cov.verse;
    // Pages reachable from at least one verse.
    summary.pagesWithCite = { union: new Set([...hs.verseHits].map((k) => k.split('|')[0])).size, galbraith: new Set(yard.map((y) => y.page)).size, of: pages.length };
    // Same text: TPJS pages that carry a revelation canonized later (Liberty Jail letter = D&C 121-123; Nauvoo instructions = D&C 130-131).
    summary.sameTextPairs = quotes.filter((q) => q.slug === 'dc' && [121, 122, 123, 130, 131].includes(q.ch)).length;
    // Quotation events: overlapping or adjacent spans on one page.
    let events = 0;
    const byPage = new Map();
    for (const q of quotes) { let a = byPage.get(q.page); if (!a) byPage.set(q.page, (a = [])); a.push([q.start, q.start + q.len]); }
    for (const spans of byPage.values()) { spans.sort((a, b) => a[0] - b[0]); let end = -1; for (const [a, b] of spans) { if (a > end + 3) events++; end = Math.max(end, b); } }
    summary.quotationEvents = events;
    // Ceiling: Galbraith cites whose verse shares ANY k-word run with the page (no filters).
    // What verbatim matching could ever reach; the rest are allusions or topical links.
    const vtok = new Map(verses.map((v) => [`${v.slug}|${v.ch}|${v.v}`, tokens(v.text)]));
    const ptok = new Map(pages.map((p) => [p.page, ' ' + tokens(p.text).join(' ') + ' ']));
    summary.galbraithCeiling = {};
    for (const k of [4, 5, 6, 8]) {
      let hit = 0;
      for (const y of yard) {
        const pt = ptok.get(y.page);
        if (y.verses.some((v) => { const t = vtok.get(`${y.slug}|${y.ch}|${v}`) || []; for (let i = 0; i + k <= t.length; i++) if (pt.includes(' ' + t.slice(i, i + k).join(' ') + ' ')) return true; return false; })) hit++;
      }
      summary.galbraithCeiling[`shares${k}words`] = hit;
    }
  }
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
function locate(text, words) {
  // map the matched token run back to the page text for display
  const first = words.split(' ').slice(0, 3).join('\\W+');
  const m = new RegExp(first, 'i').exec(text.replace(/[’'`]/g, ''));
  const t = text.replace(/[’'`]/g, '');
  if (!m) return '(not located)';
  return t.slice(Math.max(0, m.index - 120), Math.min(t.length, m.index + words.length + 120));
}

if (require.main === module) main();
module.exports = { dropFormulas, buildIdf, specificity, resolveParallels, tokens, ordinal, verseList, explicitRefs, buildIndex, matchPages, loadTpjs, loadScripture, loadYardstick };
