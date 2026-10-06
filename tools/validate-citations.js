#!/usr/bin/env node
/*
 * Sanity-check the generated citation data packs and cit-data.js's pure core.
 * Run: node tools/validate-citations.js   (after build-citation-data.js)
 *
 * Covers src/citations/cit-data.js (the pack probe, chapterIndex, citedVerses)
 * and the pack descriptor tools/build-citation-data.js writes: its pure
 * packDescriptor in both pack modes, and the descriptor in each pack on disk
 * (the committed public pack always, the personal pack when its directory
 * exists). Then, over the public pack: the index covers every standard-works
 * book; every shard's index references resolve to a cite; every cite's talk
 * exists in sources.json; live-GC URLs are church-study URLs; url-less talks
 * have a .html.gz file; and, through chapterIndex, every verse the panel shows
 * a cite under is one its `v` lists (the clip that hides the build's stray
 * index rows; the stray rows themselves are counted as a warning until a
 * rebuild clears them).
 * Exits non-zero on failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'src', 'citations', 'data');
const citData = require(path.join(ROOT, 'src', 'citations', 'cit-data.js'));
const build = require(path.join(ROOT, 'tools', 'build-citation-data.js'));
let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const eq = (a, b, msg) => check(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));

if (!fs.existsSync(DATA)) {
  console.error(`No data dir at ${DATA}. Run build-citation-data.js first.`);
  process.exit(1);
}

console.log('chapterIndex (fixtures):');
{
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

// The footnote locator takes the k-th matching link, where k is the cite's
// rank by cite id among the talk's cites of the same reference in the chapter.
console.log('refRanks (fixtures):');
{
  const cites = {
    900: { t: 1, v: '33' }, 120: { t: 1, v: '33' }, 45: { t: 1, v: '33' },
    46: { t: 1, v: '1-3,14' }, 47: { t: 1, v: '14,1-3' },
    48: { t: 2, v: '33' }, 49: { t: 1, v: '34', a: 'p4' },
  };
  deep(citData.refRanks(['900', '120', '45', '46', '47', '48', '49'], cites),
    { 45: 1, 46: 1, 47: 2, 48: 1, 49: 1, 120: 2, 900: 3 },
    'ranked by numeric cite id within one talk and one verse set; other talks rank apart');
  deep(citData.refRanks(['45', 'gone'], cites), { 45: 1 }, 'an id with no cite record gets no rank');
}

async function probeChecks() {
  console.log('Pack probe (fixtures):');
  const PERSONAL = { pack: { flavor: 'personal' } };
  const PUBLIC = { pack: { flavor: 'public' } };
  const probing = (present) => {
    const asked = [];
    const probe = async (dir) => { asked.push(dir); return present[dir] || null; };
    return { asked, probe };
  };
  deep(citData.PACK_DIRS, ['src/citations/data-personal/', 'src/citations/data/'],
    'the personal pack is probed before the public one');
  const [personalDir, publicDir] = citData.PACK_DIRS;

  let p = probing({ [personalDir]: PERSONAL, [publicDir]: PUBLIC });
  let got = await citData.pickPack(p.probe);
  check(got && got.dir === personalDir && got.descriptor.flavor === 'personal', 'with the personal pack present, it is the one read');
  deep(p.asked, [personalDir], 'the public pack is not read when the personal one answers');

  p = probing({ [publicDir]: PUBLIC });
  got = await citData.pickPack(p.probe);
  check(got && got.dir === publicDir && got.descriptor.flavor === 'public', 'with the personal pack absent, the public one is read');
  deep(p.asked, [personalDir, publicDir], 'the personal directory is probed first');

  p = probing({ [personalDir]: { books: [] }, [publicDir]: PUBLIC });
  got = await citData.pickPack(p.probe);
  check(got && got.dir === publicDir, 'an index without a descriptor is no pack');

  got = await citData.pickPack(probing({}).probe);
  check(got === null, 'no pack at all reads as null');
}

// The values each field of a descriptor's corpus entry may take (spec #69,
// "Flavors and the pack descriptor").
const CORPUS_FIELDS = {
  text: ['bundled', 'live-church', 'live-byu'],
  target: ['anchor', 'citationSpan', 'bodyPassage'],
  excerpt: ['bundled', 'fetched'],
  inclusion: ['all', 'verbatim'],
};
const CONFERENCE = /^\d{4}-(04|10)$/;

// The shape every descriptor has, whatever its flavor.
function checkDescriptorShape(d, where) {
  check(d && typeof d === 'object', `${where}: has a descriptor`);
  if (!d) return;
  check(CONFERENCE.test(d.vintage), `${where}: vintage is a conference, YYYY-04 or YYYY-10 (${d.vintage})`);
  check(d.base && d.base.db === 'core.53.db' && /^\d{4}-\d{2}-\d{2}$/.test(d.base.updated),
    `${where}: base stamp names the BYU database and its update date (${JSON.stringify(d.base)})`);
  check(Array.isArray(d.derived) && d.derived.every((c) => CONFERENCE.test(c)),
    `${where}: derived lists conferences (${JSON.stringify(d.derived)})`);
  const corpora = d.corpora || {};
  check(Object.keys(corpora).length > 0, `${where}: lists corpora`);
  for (const [c, e] of Object.entries(corpora)) {
    check(typeof e.sourceType === 'string' && e.sourceType.length > 0, `${where}: ${c} names its source type`);
    for (const [field, allowed] of Object.entries(CORPUS_FIELDS)) {
      check(allowed.includes(e[field]), `${where}: ${c}.${field} is one of ${allowed.join('|')} (${e[field]})`);
    }
  }
}

function descriptorChecks(publicIndex, sources) {
  console.log('Pack descriptor (build, both modes):');
  const facts = { vintage: '2026-04', base: { db: 'core.53.db', updated: '2026-05-18' }, derived: [] };
  const pub = build.packDescriptor('public', facts);
  const per = build.packDescriptor('personal', facts);
  checkDescriptorShape(pub, 'public mode');
  checkDescriptorShape(per, 'personal mode');
  eq(pub && pub.flavor, 'public', 'public mode writes flavor public');
  eq(per && per.flavor, 'personal', 'personal mode writes flavor personal');
  if (pub && per) {
    deep(Object.keys(pub.corpora), ['G', 'E', 'J'], 'the public pack lists no T corpus');
    deep(Object.keys(per.corpora), ['G', 'E', 'J', 'T'], 'the personal pack lists the T corpus');
    eq(per.corpora.T && per.corpora.T.target, 'bodyPassage', 'STPJS targets the body passage');
    deep({ G: per.corpora.G, E: per.corpora.E, J: per.corpora.J }, pub.corpora,
      'the two modes agree on every corpus but T');
    deep([pub.vintage, pub.base, pub.derived], [facts.vintage, facts.base, facts.derived],
      'vintage, base stamp and derived conferences are written as given');
  }
  eq(build.packDescriptor('nonsense', facts), null, 'an unknown pack mode writes no descriptor');
  eq(build.conferenceOf('2026-04'), '2026-04', 'an April session belongs to the April conference');
  eq(build.conferenceOf('2023-09'), '2023-10', 'a September session belongs to the October conference');
  eq(build.conferenceOf('2016-03'), '2016-04', 'a March session belongs to the April conference');

  console.log('Pack descriptor (public pack on disk):');
  const d = publicIndex.pack;
  checkDescriptorShape(d, 'public pack');
  if (!d) return;
  eq(d.flavor, 'public', 'the committed pack is the public one');
  check(!('T' in (d.corpora || {})), 'the public pack lists no T corpus');
  // The vintage is the latest conference any General Conference talk belongs to.
  let latest = '';
  for (const s of Object.values(sources)) {
    const entry = d.corpora[s.c];
    if (!entry || entry.sourceType !== 'General Conference' || !s.d) continue;
    const conf = build.conferenceOf(s.d);
    if (conf > latest) latest = conf;
  }
  eq(d.vintage, latest, 'the vintage is the latest conference in the pack');

  const personalIndex = path.join(ROOT, citData.PACK_DIRS[0], 'index.json');
  if (fs.existsSync(personalIndex)) {
    console.log('Pack descriptor (personal pack on disk):');
    const pd = JSON.parse(fs.readFileSync(personalIndex, 'utf8')).pack;
    checkDescriptorShape(pd, 'personal pack');
    eq(pd && pd.flavor, 'personal', 'the personal pack says so');
    eq(pd && pd.vintage, d.vintage, 'both packs carry the same vintage');
  }
}

function packChecks() {
  const index = readJSON('index.json');
  const sources = readJSON('sources.json');
  descriptorChecks(index, sources);

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
          // file must exist.
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
}

probeChecks()
  .catch((e) => { check(false, 'pack probe threw: ' + e.message); })
  .then(packChecks);
