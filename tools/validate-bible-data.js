#!/usr/bin/env node
/*
 * Checks the bundled World English Bible (src/bible/engwebp/, written by
 * tools/build-bible-data.js) and the worker path that serves it (the
 * `bundled` provider, __BTX.api.fetchBundledChapter). Run:
 *   node tools/validate-bible-data.js
 *
 *  1. index.json records the archive the bundle came from (its SHA-256, the
 *     download date, the URL) and lists the 66 Bible books, one IR file each.
 *  2. Every chapter is well-formed IR (api.js's shape) with its verses in
 *     order, and known passages read as the World English Bible prints them:
 *     words of Jesus marked, Psalm 23 in poetry lines under its title.
 *  3. Unaltered text (spec A9, the condition of the name "World English
 *     Bible"): when the archive is in source-data/, its hash matches the index
 *     and every chapter's plain text equals the USFM's text with markup
 *     stripped. The stripping here is deliberately not the converter's: a
 *     crude regex pass over the raw chapter, so a converter bug can't hide in
 *     a shared rule. Without the archive this check is skipped and says so.
 *  4. The worker path: fetchBundledChapter, against a fetch that reads the
 *     packaged files from disk, serves a chapter with the public-domain line,
 *     needs no key, and touches nothing outside the bundle.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const BOOKS = require(path.join(ROOT, 'src/shared/books.js'));
const API = require(path.join(ROOT, 'src/background/api.js'));
const BUILD = require(path.join(ROOT, 'tools/build-bible-data.js'));

const DIR = path.join(ROOT, C.BUNDLED_BIBLE.dir);
const ARCHIVE = path.join(ROOT, 'source-data', 'engwebp_usfm.zip');

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

const USFM = Object.values(BOOKS.LDS_TO_USFM);

// ---- 1. Index ----
console.log('Index:');
const indexPath = path.join(DIR, 'index.json');
check(fs.existsSync(indexPath), `${C.BUNDLED_BIBLE.dir}/index.json exists (run node tools/build-bible-data.js)`);
if (!fs.existsSync(indexPath)) finish();
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
check(/^[0-9a-f]{64}$/.test(index.sha256 || ''), 'the index records the archive\'s SHA-256');
check(/^\d{4}-\d{2}-\d{2}$/.test(index.downloaded || ''), 'the index records the download date (YYYY-MM-DD)');
eq(index.source, 'https://ebible.org/Scriptures/engwebp_usfm.zip', 'the index names the ebible.org engwebp USFM archive');
eq(index.id, C.BUNDLED_BIBLE.id, 'the index is the bundled Bible\'s');
eq(Object.keys(index.books || {}).sort(), USFM.slice().sort(), 'the index lists exactly the 66 Bible books');
const onDisk = fs.readdirSync(DIR).filter((f) => f !== 'index.json').sort();
eq(onDisk, USFM.map((u) => `${u}.json`).sort(), 'one IR file per book, nothing else');

// ---- 2. IR shape ----
console.log('IR:');
const bookData = {};
for (const u of USFM) {
  const file = path.join(DIR, `${u}.json`);
  if (!fs.existsSync(file)) continue;
  bookData[u] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

function plainOf(blocks) {
  const parts = [];
  for (const b of blocks) {
    if (b.type === 'heading') parts.push(b.text);
    else for (const r of b.runs) parts.push(r.t === 'v' ? ` [v${r.n}] ` : r.s);
    parts.push(' ');
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

let chapters = 0;
for (const u of Object.keys(bookData)) {
  const d = bookData[u];
  eq(d.book, u, `${u}.json names its book`);
  const nums = Object.keys(d.chapters || {}).map(Number);
  eq(nums.length, index.books[u], `${u}: the index's chapter count matches the file`);
  eq(nums, nums.slice().sort((a, b) => a - b).map((n, i) => i + 1), `${u}: chapters run 1..n`);
  for (const n of nums) {
    chapters++;
    const blocks = d.chapters[n];
    const where = `${u} ${n}`;
    check(Array.isArray(blocks) && blocks.length > 0, `${where} has blocks`);
    let last = 0;
    let shapeOk = true;
    for (const b of blocks || []) {
      if (b.type === 'heading') { shapeOk = shapeOk && typeof b.text === 'string' && b.text.trim() !== ''; continue; }
      shapeOk = shapeOk && b.type === 'para' && typeof b.style === 'string' && Array.isArray(b.runs) && b.runs.length > 0;
      for (const r of b.runs || []) {
        if (r.t === 'v') {
          const v = Number(r.n);
          check(v === last + 1 || (v > last && v - last < 4), `${where}: verse ${r.n} follows ${last}`);
          last = v;
        } else {
          shapeOk = shapeOk && r.t === 'txt' && typeof r.s === 'string' && r.s !== '' && typeof r.wj === 'boolean';
        }
      }
    }
    check(shapeOk, `${where}: every block is a heading or a para of verse/text runs`);
    check(last > 0, `${where} has verses`);
    check(!/\\|\|strong=/.test(JSON.stringify(blocks)), `${where}: no USFM markup or Strong's tags left`);
  }
}
eq(chapters, 1189, 'the 66 books hold 1,189 chapters');

// Known passages, as the World English Bible prints them.
if (bookData.JHN) {
  const jn3 = bookData.JHN.chapters[3];
  const v16 = plainOf(jn3).split('[v16]')[1].split('[v17]')[0].trim();
  eq(v16, 'For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.',
    'John 3:16 reads as printed, its footnote gone');
  const runsOf16 = [];
  let in16 = false;
  for (const b of jn3) for (const r of b.runs || []) {
    if (r.t === 'v') in16 = r.n === '16';
    else if (in16) runsOf16.push(r);
  }
  check(runsOf16.length > 0 && runsOf16.every((r) => r.wj), 'John 3:16 is marked as words of Jesus');
  const v1 = plainOf(jn3).split('[v1]')[1].split('[v2]')[0].trim();
  check(jn3.every((b) => b.type !== 'para' || b.runs.every((r) => r.t === 'v' || !r.wj || !v1.includes(r.s))),
    'narration (John 3:1) is not marked as words of Jesus');
}
if (bookData.PSA) {
  const ps23 = bookData.PSA.chapters[23];
  eq(ps23[0], { type: 'heading', text: 'A Psalm by David.' }, 'Psalm 23 opens with its title as a heading');
  eq(ps23.slice(1, 3).map((b) => b.style), ['q1', 'q2'], 'Psalm 23 is poetry lines (q1, q2)');
  eq(plainOf([ps23[1], ps23[2]]), '[v1] The LORD is my shepherd; I shall lack nothing.', 'Psalm 23:1 reads as printed, over two lines');
}

// ---- 3. Unaltered text (A9) ----
console.log('Unaltered text:');
// The USFM's text with markup stripped: notes and cross-references out,
// Strong's attributes out, every marker out, verse numbers as [vN].
function strippedUsfm(raw) {
  return raw
    .replace(/\\f .*?\\f\*/gs, '')
    .replace(/\\x .*?\\x\*/gs, '')
    .replace(/\|[^\\]*(?=\\\+?w\*)/g, '')
    .replace(/\\v (\S+) ?/g, ' [v$1] ')
    .replace(/\\\+?[a-z]+[0-9]*\*/g, '')
    .replace(/\\\+?[a-z]+[0-9]*(?: |(?=\s)|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function chaptersOfUsfm(text) {
  const out = {};
  const parts = text.split(/^\\c (\d+)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}
if (!fs.existsSync(ARCHIVE)) {
  console.log(`  (skipped: no archive at source-data/engwebp_usfm.zip — download ${index.source} there to run it)`);
} else {
  const buf = fs.readFileSync(ARCHIVE);
  eq(crypto.createHash('sha256').update(buf).digest('hex'), index.sha256, 'the archive in source-data is the one the bundle was built from');
  const files = BUILD.readZip(buf);
  let compared = 0;
  let differ = 0;
  for (const u of USFM) {
    const name = Object.keys(files).find((f) => new RegExp(`^\\d+-${u}engwebp\\.usfm$`).test(f));
    check(!!name, `the archive has ${u}`);
    if (!name || !bookData[u]) continue;
    const usfm = chaptersOfUsfm(files[name].toString('utf8'));
    eq(Object.keys(usfm).length, Object.keys(bookData[u].chapters).length, `${u}: same chapter count as the USFM`);
    for (const n of Object.keys(usfm)) {
      compared++;
      const want = strippedUsfm(usfm[n]);
      const got = plainOf(bookData[u].chapters[n] || []);
      if (want !== got) {
        differ++;
        if (differ <= 5) {
          let i = 0;
          while (i < want.length && want[i] === got[i]) i++;
          console.error(`  ✗ ${u} ${n} differs at ${i}: USFM "…${want.slice(Math.max(0, i - 30), i + 40)}…" bundle "…${got.slice(Math.max(0, i - 30), i + 40)}…"`);
        }
      }
    }
  }
  check(differ === 0, `every chapter's plain text equals the USFM's (${differ} of ${compared} differ)`);
  if (!differ) console.log(`  ${compared} of ${compared} chapters equal the USFM text`);
}

// ---- 4. The worker path ----
console.log('Worker path (bundled provider):');
async function workerChecks() {
  const realFetch = global.fetch;
  const asked = [];
  // The worker fetches packaged files by extension URL; in Node, the path
  // relative to the repo root stands in for it.
  global.fetch = async (url) => {
    asked.push(url);
    const file = path.join(ROOT, url);
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  try {
    const res = await API.fetchBundledChapter(C.BUNDLED_BIBLE.id, 'JHN.3');
    check(res && res.payload && !res.error, 'John 3 is served from the bundle');
    if (res && res.payload) {
      eq(res.payload.blocks, bookData.JHN.chapters[3], '...as the bundle\'s IR for that chapter');
      eq(res.payload.copyright, C.BUNDLED_BIBLE.copyright, '...with the ebible.org public-domain line as its copyright');
      check(/public domain/i.test(res.payload.copyright) && /World English Bible/.test(res.payload.copyright), 'the copyright line is the public-domain wording');
      eq(res.payload.reference, 'John 3', '...and a reference');
      check(!('fums' in res), 'a bundled chapter carries no usage report');
    }
    const ps = await API.fetchBundledChapter(C.BUNDLED_BIBLE.id, 'PSA.23');
    eq(ps.payload && ps.payload.reference, 'Psalms 23', 'Psalm 23 is served too');
    eq((await API.fetchBundledChapter(C.BUNDLED_BIBLE.id, 'JHN.99')).error.code, C.ERR.NOT_FOUND, 'a chapter the book lacks is NOT_FOUND');
    eq((await API.fetchBundledChapter('other', 'JHN.3')).error.code, C.ERR.NOT_FOUND, 'a bundled id that does not ship is NOT_FOUND');
    eq((await API.fetchBundledChapter(C.BUNDLED_BIBLE.id, 'XYZ.1')).error.code, C.ERR.NOT_FOUND, 'an unknown book is NOT_FOUND');
    check(asked.length > 0 && asked.every((u) => u.startsWith(C.BUNDLED_BIBLE.dir + '/')), 'it reads only the packaged bundle (no network)');
  } finally {
    global.fetch = realFetch;
  }
}

function finish() {
  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
}

workerChecks().then(finish, (e) => { console.error(e); process.exit(1); });
