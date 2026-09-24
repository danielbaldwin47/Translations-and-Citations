#!/usr/bin/env node
/*
 * Sanity-check the generated citation dataset under src/citations/data/.
 * Run: node tools/validate-citations.js   (after build-citation-data.js)
 *
 * Verifies: index covers 66 books; every shard's index references resolve to a
 * cite; every cite's talk exists in sources.json; live-GC URLs are church-study
 * URLs; bundled (non-live) talks have a .html.gz file; and, through
 * cit-data.js's own chapterIndex, every verse the panel shows a cite under is
 * one its `v` lists (the clip that hides the build's stray index rows; the
 * stray rows themselves are counted as a warning until a rebuild clears them).
 * Exits non-zero on failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'src', 'citations', 'data');
const citData = require(path.resolve(__dirname, '..', 'src', 'citations', 'cit-data.js'));
let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));

if (!fs.existsSync(DATA)) {
  console.error(`No data dir at ${DATA}. Run build-citation-data.js first.`);
  process.exit(1);
}

console.log('chapterIndex (fixtures):');
{
  const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  deep([...citData.citedVerses('5')], [5], 'citedVerses: one verse');
  deep([...citData.citedVerses('16-17')], [16, 17], 'citedVerses: a range');
  deep([...citData.citedVerses('1,4')], [1, 4], 'citedVerses: a list');
  deep([...citData.citedVerses('2-5,9')], [2, 3, 4, 5, 9], 'citedVerses: a range and a verse');
  deep([...citData.citedVerses('')], [], 'citedVerses: nothing');

  // John 3 as shipped: a cite of v. 5 filed under every verse 1–38, one of
  // vv. 16–17 filed under 16, 17 and 42–44 too, and one whose v shares no
  // verse with where the index filed it.
  const chap = {};
  for (let v = 1; v <= 38; v++) chap[v] = ['holmes'];
  chap[16] = ['holmes', 'dennis'];
  chap[17] = ['holmes', 'dennis'];
  chap[42] = ['dennis']; chap[43] = ['dennis']; chap[44] = ['dennis'];
  chap[20] = ['holmes', 'odd'];
  const cites = { holmes: { v: '5' }, dennis: { v: '16-17' }, odd: { v: '8' } };
  const r = citData.chapterIndex(chap, cites);
  deep(r.spanOf.holmes, [5], 'a cite is clipped to the verse its v lists');
  deep(r.spanOf.dennis, [16, 17], 'a range cite keeps only its range');
  deep(r.spanOf.odd, [20], 'a clip that leaves nothing keeps the index span');
  deep(r.verseOrder, [5, 16, 17, 20], 'verses left with no cite drop out');
  deep(r.byVerse[16], ['dennis'], 'a verse lists only the cites that cite it');
  check(!(42 in r.byVerse), 'a verse past the chapter\'s end is gone');
}

const index = readJSON('index.json');
const sources = readJSON('sources.json');

console.log('Index / sources:');
check(index.counts && index.counts.books === index.books.length, `counts.books matches books[] (${index.counts && index.counts.books} vs ${index.books.length})`);
check(index.counts && index.counts.books >= 88, `index covers all standard works, >= 88 books (got ${index.counts && index.counts.books})`);
check(index.counts.citations > 100000, `citation count is sane (${index.counts.citations})`);
check(Object.keys(sources).length > 1000, `sources populated (${Object.keys(sources).length})`);

console.log('Shards:');
let totalCites = 0;
let bundledMissing = 0;
let badUrls = 0;
const bundledChecked = new Set();
for (const b of index.books) {
  const shard = readJSON(`citations/${b.slug}.json`);
  // every indexed citId resolves to a cite, and its talk exists in sources
  for (const ch of Object.keys(shard.index)) {
    for (const v of Object.keys(shard.index[ch])) {
      for (const citId of shard.index[ch][v]) {
        const c = shard.cites[citId];
        if (!c) { check(false, `${b.slug} ${ch}:${v} citId ${citId} missing from cites`); continue; }
        const src = sources[c.t];
        if (!src) { check(false, `${b.slug} cite ${citId} -> talk ${c.t} not in sources`); continue; }
        totalCites++;
        // For live GC the url must be a church study URL; otherwise a bundled
        // file must exist. Spot-check a bounded number to keep this fast.
        if (src.url) {
          if (!/^https:\/\/www\.churchofjesuschrist\.org\/study\//.test(src.url)) badUrls++;
        } else if (!bundledChecked.has(c.t)) {
          bundledChecked.add(c.t);
          if (!fs.existsSync(path.join(DATA, 'talks', `${c.t}.html.gz`))) bundledMissing++;
        }
      }
    }
  }
}
check(totalCites > 50000, `walked citations (${totalCites})`);

// What the panel shows: each cite only under verses its own `v` lists. A cite
// whose index span and `v` share no verse keeps its index span (the clip's
// fallback); those are listed, not failed.
console.log('Verse spans (as chapterData shows them):');
let strayRows = 0;
let outside = 0;
let emptyKeys = 0;
const fallbacks = [];
for (const b of index.books) {
  const shard = readJSON(`citations/${b.slug}.json`);
  for (const ch of Object.keys(shard.index)) {
    const chap = shard.index[ch];
    for (const v of Object.keys(chap)) {
      for (const id of chap[v]) {
        if (shard.cites[id] && !citData.citedVerses(shard.cites[id].v).has(Number(v))) strayRows++;
      }
    }
    const { verseOrder, byVerse, spanOf } = citData.chapterIndex(chap, shard.cites);
    for (const v of verseOrder) {
      if (!byVerse[v] || !byVerse[v].length) { emptyKeys++; continue; }
      for (const id of byVerse[v]) {
        const c = shard.cites[id];
        if (!c) continue;
        const cited = citData.citedVerses(c.v);
        if (spanOf[id].some((s) => cited.has(s))) {
          if (!cited.has(v)) outside++;
        } else if (!fallbacks.some((f) => f.id === id)) {
          fallbacks.push({ id, where: `${b.slug} ${ch}:${spanOf[id].join(',')}`, v: c.v });
        }
      }
    }
  }
}
check(outside === 0, `every shown verse lies inside its cite's v (${outside} outside)`);
check(emptyKeys === 0, `no verse shows with no cite (${emptyKeys} empty)`);
if (fallbacks.length) {
  console.log(`  note: ${fallbacks.length} cite(s) share no verse with their v; shown at the index's span: ` +
    fallbacks.map((f) => `${f.where} (v=${f.v}, cite ${f.id})`).join('; '));
}
if (strayRows) {
  console.log(`  warning: ${strayRows} index row(s) file a cite under a verse outside its v ` +
    '(build-citation-data.js; hidden by the clip, cleared by a rebuild that skips them)');
}
check(badUrls === 0, `all live-GC URLs are church study URLs (${badUrls} bad)`);
check(bundledMissing === 0, `all bundled talks have a .html.gz (${bundledMissing} missing)`);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log(`\nAll checks passed. ${totalCites} citations, ${Object.keys(sources).length} sources, ${bundledChecked.size} bundled talks verified.`);
