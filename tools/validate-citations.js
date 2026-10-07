#!/usr/bin/env node
/*
 * Sanity-check the generated citation data packs and cit-data.js's pure core.
 * Run: node tools/validate-citations.js   (after build-citation-data.js)
 *
 * Covers src/citations/cit-data.js (the pack probe, chapterIndex, citedVerses,
 * refRanks, chapterData over a stub pack) and tools/build-citation-data.js's
 * pure core (toChurchUrl, excerptChars, packDescriptor in both modes,
 * parseInclusion, citeRecord) on fixtures.
 *
 * Then every pack on disk — the committed public pack always, the personal
 * pack when its directory exists — is checked against its own descriptor
 * (spec #69 checks A1, A2, A26): a references-only corpus (excerpt fetched,
 * text not bundled) has no snippet on any cite and no talk file; every cite
 * of a fetched-excerpt corpus carries an excerpt character count; a bundled
 * corpus has a talk file for every url-less source; every source's corpus is
 * in the descriptor, and the public pack lists no gated corpus; base talks
 * keep the ids in tools/fixtures/base-talk-ids.json; talk URLs are Church
 * study URLs; through chapterIndex, every verse the panel shows a cite under
 * is one its `v` lists (stray index rows are a warning until a rebuild skips
 * them). With both packs present, they carry the same vintage.
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

// The build's URL transform (toChurchUrl), on the stored talk.URL forms.
console.log('Church URL transform (fixtures):');
{
  eq(build.toChurchUrl('http://lds.org/ensign/1971/06/out-of-the-darkness?lang=eng'),
    'https://www.churchofjesuschrist.org/study/ensign/1971/06/out-of-the-darkness?lang=eng',
    'an lds.org ensign path moves under /study/');
  eq(build.toChurchUrl('https://www.churchofjesuschrist.org/study/ensign/2019/11/11holland?lang=eng'),
    'https://www.churchofjesuschrist.org/study/ensign/2019/11/11holland?lang=eng',
    'a Church study URL is kept');
  // April 2019 is stored as lds.org/study/…/{session}/{slug}: the plain
  // transform doubles /study/ and the session path redirects to the
  // conference page; the site serves the talk at /study/ensign/2019/05/{slug}.
  eq(build.toChurchUrl('https://www.lds.org/study/ensign/2019/05/saturday-morning-session/11soares?lang=eng'),
    'https://www.churchofjesuschrist.org/study/ensign/2019/05/11soares?lang=eng',
    'an April 2019 lds.org/study URL loses the doubled /study/ and its session segment');
  eq(build.toChurchUrl('https://www.lds.org/study/ensign/2019/05/sunday-afternoon-session/57nelson?lang=eng'),
    'https://www.churchofjesuschrist.org/study/ensign/2019/05/57nelson?lang=eng',
    'every April 2019 session is repaired the same way');
  eq(build.toChurchUrl(''), null, 'no stored URL gives none');
}

// The excerpt character count (excerptChars): the length of the text of the
// paragraph holding the cite, as the publishing site shows it, so BYU's
// citation labels and footnote insertions are not counted.
console.log('Excerpt character count (fixtures):');
{
  const label = (id, ref) => `<span class="citation" id="${id}"><a href="javascript:void(0)" onclick="sx(this, ${id})"> </a>` +
    `<a href="javascript:void(0)" onclick="gs(${id})">${ref}</a></span>`;
  const modern = '<p data-aid="146038909" id="p2">This last year has been one for the record books.</p>\n' +
    '<p data-aid="146038910" id="p3">He said, “I will show [you] that I am able to do mine own work.”' +
    '<sup class="noteMarker"><a href="#note1">1</a><span class="footnote">[<span class="note-p">' +
    `<span class="ccontainer rdot">${label(137180, '2 Nephi 27:21')}</span></span>]</span></sup></p>\n<p id="p4">Often.</p>`;
  eq(build.excerptChars(modern, 137180), 'He said, “I will show [you] that I am able to do mine own work.”'.length,
    'a modern paragraph counts without BYU\'s footnote marker and label');
  const inline = '<p uri="/ensign/1971/06/out-of-the-darkness.p21" class="">“the only true and living church upon the face of the whole earth.” ' +
    `<span class="ccontainer lparen rdotparen">${label(15674, 'D&amp;C 1:30')}</span></p>`;
  eq(build.excerptChars(inline, 15674), '“the only true and living church upon the face of the whole earth.”'.length,
    'an inline label is not counted');
  const early = '</p><p>\nFor you shall live by every word that proceedeth forth\nfrom the mouth of God\n' +
    `<span class="ccontainer lparen rparendot">${label(11779, 'D&amp;C 84:32-44')}</span>\n</p><p>\nThere is much more.</p>`;
  eq(build.excerptChars(early, 11779), 'For you shall live by every word that proceedeth forth from the mouth of God'.length,
    'an early-conference paragraph counts with its line breaks as single spaces and no label');
  const two = `<p>Faith &amp; works <span class="ccontainer">${label(9, 'James 2:17')}</span> and grace ` +
    `<span class="ccontainer">${label(10, 'Eph. 2:8')}</span></p>`;
  eq(build.excerptChars(two, 10), 'Faith & works and grace'.length,
    'every label in the paragraph is dropped, and an entity counts as one character');
  // A subtitle that is only a reference: the talk's own text, which BYU
  // wrapped in its citation span (2019–2026 talks, a footnote that is only a reference).
  const subtitle = `<h1>Title</h1> <p class="subtitle" data-aid="171130208" id="p_nGsCY"><span class="ccontainer lparen rparen">${label(145619, 'Doctrine and Covenants 6:36')}</span></p>`;
  eq(build.excerptChars(subtitle, 145619), 'Doctrine and Covenants 6:36'.length,
    'a paragraph that is only a reference counts the reference');
  eq(build.excerptChars(two, 11), null, 'a cite whose span is not in the talk has no count');
  eq(build.excerptChars(null, 9), null, 'a talk with no HTML gives no count');
}

// chapterData over an in-memory pack (stubbed chrome.runtime and fetch): a
// derived talk's string id and a cite's excerpt count reach the entry as-is.
async function chapterDataChecks() {
  console.log('chapterData (stub pack):');
  const pack = {
    'src/citations/data/index.json': { pack: { flavor: 'public', corpora: { G: { sourceType: 'General Conference' } } } },
    'src/citations/data/citations/alma.json': {
      fullName: 'Alma',
      cites: { 900001: { t: 'gc/2026/10/12holland', v: '14', ec: 312 }, 15674: { t: 2000, v: '14', a: 'p21', ec: 88 } },
      index: { 5: { 14: [900001, 15674] } },
    },
    'src/citations/data/sources.json': { 'gc/2026/10/12holland': { c: 'G', d: '2026-10' }, 2000: { c: 'G', d: '1971-04' } },
  };
  const saved = { chrome: global.chrome, fetch: global.fetch };
  global.chrome = { runtime: { getURL: (p) => p } };
  global.fetch = async (url) => (url in pack
    ? { ok: true, json: async () => pack[url] }
    : { ok: false, status: 404, json: async () => null });
  try {
    const data = await citData.chapterData('alma', 5);
    const derived = data && data.entries[900001];
    const base = data && data.entries[15674];
    eq(derived && derived.talkId, 'gc/2026/10/12holland', 'a derived talk keeps its string id');
    eq(derived && derived.source.d, '2026-10', 'a string talk id finds its source');
    eq(derived && derived.excerptChars, 312, 'the cite\'s excerpt character count reaches the entry');
    eq(base && base.talkId, 2000, 'a base talk keeps its numeric id');
    deep(base && [base.anchor, base.excerptChars, base.snippet], ['p21', 88, undefined], 'a references-only cite has an anchor and a count, no snippet');
  } finally {
    global.chrome = saved.chrome;
    global.fetch = saved.fetch;
  }
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

function descriptorChecks() {
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
    // Conference talk text is copyrighted: both conference corpora are
    // references-only, fetched live with fetched excerpts; J and T bundle.
    deep(['G', 'E'].map((c) => [pub.corpora[c].text, pub.corpora[c].excerpt]),
      [['live-church', 'fetched'], ['live-byu', 'fetched']], 'G and E are references-only, text and excerpt fetched');
    deep([pub.corpora.J.text, pub.corpora.J.excerpt, per.corpora.T.text, per.corpora.T.excerpt],
      ['bundled', 'bundled', 'bundled', 'bundled'], 'J and T bundle their text and snippets');
    deep(Object.values(pub.corpora).map((e) => e.inclusion), ['all', 'all', 'all'], 'with no inclusion input every corpus records all');
  }
  eq(build.packDescriptor('nonsense', facts), null, 'an unknown pack mode writes no descriptor');

  console.log('Inclusion rule input (fixtures):');
  {
    const ruled = build.packDescriptor('public', facts, { E: 'verbatim' });
    deep(ruled && Object.values(ruled.corpora).map((e) => e.inclusion), ['all', 'verbatim', 'all'],
      'a per-corpus inclusion rule is recorded in that corpus\'s entry, the rest stay all');
    deep(build.parseInclusion(undefined), { rules: {} }, 'no --inclusion means every corpus all');
    deep(build.parseInclusion('E=verbatim,J=all'), { rules: { E: 'verbatim', J: 'all' } }, 'corpus=rule pairs, comma separated');
    check(build.parseInclusion('E=sometimes').error, 'an unknown rule is an error');
    check(build.parseInclusion('X=all').error, 'an unknown corpus is an error');
    check(build.parseInclusion('E').error, 'a pair without a rule is an error');
  }

  console.log('Cite records per corpus (fixtures):');
  {
    const facts1 = { t: 8494, v: '21', sn: 'He said, “I will show”', a: 'p3', ec: 64 };
    deep(build.citeRecord(pub.corpora.G, facts1), { t: 8494, v: '21', a: 'p3', ec: 64 },
      'a references-only cite keeps its anchor and count, never a snippet');
    deep(build.citeRecord(pub.corpora.E, { t: 2, v: '32-44', sn: 'For you shall live', a: '', ec: null }), { t: 2, v: '32-44' },
      'a references-only cite with no count and no anchor carries neither');
    deep(build.citeRecord(pub.corpora.J, { t: 5000, v: '14', sn: 'Brethren, I rejoice', a: '', ec: 19 }), { t: 5000, v: '14', sn: 'Brethren, I rejoice' },
      'a bundled-excerpt cite keeps its snippet and needs no count');
    deep([pub.corpora.G, pub.corpora.E, pub.corpora.J, per.corpora.T].map(build.bundlesTalks), [false, false, true, true],
      'talk files are written only for corpora whose text is bundled');
  }
  eq(build.conferenceOf('2026-04'), '2026-04', 'an April session belongs to the April conference');
  eq(build.conferenceOf('2023-09'), '2023-10', 'a September session belongs to the October conference');
  eq(build.conferenceOf('2016-03'), '2016-04', 'a March session belongs to the April conference');
}

// Talk ids (spec #69 check A26). A base talk keeps the decimal BYU id the
// pack had before the public pack (tools/fixtures/base-talk-ids.json, frozen),
// with the same corpus and month; a derived talk's id is its Church slug,
// gc/YYYY/MM/{slug}. Shards may carry a base id as a number.
const BASE_IDS = (() => {
  const { talks } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'base-talk-ids.json'), 'utf8'));
  const out = new Map();
  for (const [key, ids] of Object.entries(talks)) for (const id of ids) out.set(String(id), key);
  return out;
})();
const DERIVED_ID = /^gc\/\d{4}\/(04|05|10|11)\/[a-z0-9-]+$/;

// The corpora only the personal pack lists: its gated elements.
const GATED = build.PACK_CORPORA.personal.filter((c) => !build.PACK_CORPORA.public.includes(c));

// Every check of one pack on disk, driven by its own descriptor.
function checkPack(dir, expectFlavor) {
  const DATA = path.join(ROOT, dir);
  const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
  const index = readJSON('index.json');
  const sources = readJSON('sources.json');
  const where = `${expectFlavor} pack`;

  console.log(`Pack descriptor (${where} on disk):`);
  const d = index.pack;
  checkDescriptorShape(d, where);
  if (!d) return null;
  eq(d.flavor, expectFlavor, `${where}: its descriptor names its flavor`);
  const corpora = d.corpora || {};
  if (expectFlavor === 'public') {
    deep(GATED.filter((c) => c in corpora), [], 'the public pack lists no gated corpus');
  }
  // The vintage is the latest conference any General Conference talk belongs to.
  let latest = '';
  for (const s of Object.values(sources)) {
    const entry = corpora[s.c];
    if (!entry || entry.sourceType !== 'General Conference' || !s.d) continue;
    const conf = build.conferenceOf(s.d);
    if (conf > latest) latest = conf;
  }
  eq(d.vintage, latest, `${where}: the vintage is the latest conference in the pack`);

  console.log(`Index / sources (${where}):`);
  check(index.counts && index.counts.books === index.books.length, `counts.books matches books[] (${index.counts && index.counts.books} vs ${index.books.length})`);
  check(index.counts && index.counts.books >= 88, `index covers all standard works, >= 88 books (got ${index.counts && index.counts.books})`);
  check(index.counts.citations > 100000, `citation count is sane (${index.counts.citations})`);
  check(Object.keys(sources).length > 1000, `sources populated (${Object.keys(sources).length})`);
  const foreign = Object.entries(sources).filter(([, s]) => !(s.c in corpora));
  check(foreign.length === 0, `${where}: every source's corpus is in the descriptor ` +
    `(${foreign.length} not, e.g. ${foreign.slice(0, 3).map(([id, s]) => `${id}:${s.c}`).join(', ')})`);
  let badIds = 0;
  const badIdSamples = [];
  for (const [id, s] of Object.entries(sources)) {
    const base = BASE_IDS.get(id);
    const ok = base ? base === `${s.c}|${s.d}` : (s.c === 'G' && DERIVED_ID.test(id));
    if (!ok) { badIds++; if (badIdSamples.length < 3) badIdSamples.push(`${id} (${s.c}|${s.d}, fixture ${base || 'none'})`); }
  }
  check(badIds === 0, `${where}: base talks keep today's ids, derived talks carry gc/YYYY/MM/slug ids ` +
    `(${badIds} not: ${badIdSamples.join('; ')})`);

  console.log(`Shards (${where}):`);
  let totalCites = 0;
  let badUrls = 0;
  const snippets = {};      // references-only corpus -> cites carrying a snippet
  const uncounted = {};     // talk of a fetched-excerpt corpus -> its cites with no count
  const counted = new Set(); // talks of a fetched-excerpt corpus with a counted cite
  const cited = new Set();
  for (const b of index.books) {
    const shard = readJSON(`citations/${b.slug}.json`);
    for (const [citId, c] of Object.entries(shard.cites)) {
      const src = sources[c.t];
      if (!src) { check(false, `${b.slug} cite ${citId} -> talk ${c.t} not in sources`); continue; }
      cited.add(String(c.t));
      const entry = corpora[src.c];
      if (!entry) continue; // reported above, per source
      if (entry.excerpt === 'fetched') {
        if ('sn' in c) snippets[src.c] = (snippets[src.c] || 0) + 1;
        if (Number.isInteger(c.ec) && c.ec > 0) counted.add(String(c.t));
        else (uncounted[String(c.t)] = uncounted[String(c.t)] || []).push(citId);
      }
    }
    // every indexed citId resolves to a cite
    for (const ch of Object.keys(shard.index)) {
      for (const v of Object.keys(shard.index[ch])) {
        for (const citId of shard.index[ch][v]) {
          if (!shard.cites[citId]) { check(false, `${b.slug} ${ch}:${v} citId ${citId} missing from cites`); continue; }
          totalCites++;
        }
      }
    }
  }
  check(totalCites > 50000, `walked citations (${totalCites})`);
  deep(snippets, {}, `${where}: no cite of a references-only corpus carries a snippet (count per corpus)`);
  // A cite has no count only when BYU's copy of its talk carries no citation
  // span to measure from, so no cite of that talk has one (talk 2723, 1975).
  const unmeasured = Object.keys(uncounted).filter((t) => !counted.has(t));
  const partly = Object.keys(uncounted).filter((t) => counted.has(t));
  check(partly.length === 0, `${where}: every cite of a fetched-excerpt corpus carries an excerpt character count ` +
    `(missing in ${partly.length} talks, e.g. ${partly.slice(0, 3).map((t) => `talk ${t}: cites ${uncounted[t].slice(0, 3).join(',')}`).join('; ')})`);
  check(unmeasured.length <= 1, `${where}: at most one talk has no citation span to measure from (${unmeasured.join(', ')})`);
  if (unmeasured.length) {
    console.log(`  note: talk(s) ${unmeasured.join(', ')} have no excerpt counts (BYU's copy has no citation spans); their rows reserve three lines`);
  }
  for (const [id, s] of Object.entries(sources)) {
    if (s.url && !/^https:\/\/www\.churchofjesuschrist\.org\/study\/(?!study\/)/.test(s.url)) badUrls++;
    check(cited.has(id), `${where}: source ${id} is cited by some cite`);
  }
  check(badUrls === 0, `${where}: every talk URL is a Church study URL with a single /study/ (${badUrls} bad)`);

  console.log(`Talk files (${where}):`);
  const files = fs.existsSync(path.join(DATA, 'talks')) ? fs.readdirSync(path.join(DATA, 'talks')) : [];
  const stray = {};
  const fileIds = new Set();
  for (const f of files) {
    const id = f.replace(/\.html\.gz$/, '');
    fileIds.add(id);
    const s = sources[id];
    const why = !s ? 'no source' : !(s.c in corpora) ? `corpus ${s.c} not in the pack` : !build.bundlesTalks(corpora[s.c]) ? `corpus ${s.c} is not bundled` : '';
    if (why) stray[why] = (stray[why] || 0) + 1;
  }
  deep(stray, {}, `${where}: talk files exist only for sources of corpora whose text is bundled (strays by reason)`);
  let missing = 0;
  for (const [id, s] of Object.entries(sources)) {
    if (corpora[s.c] && build.bundlesTalks(corpora[s.c]) && !s.url && !fileIds.has(id)) missing++;
  }
  check(missing === 0, `${where}: a bundled corpus has a talk file for every url-less source (${missing} missing)`);
  eq(index.counts.bundledTalks, files.length, `${where}: counts.bundledTalks matches the talk files`);

  // What the panel shows: each cite only under verses its own `v` lists. A cite
  // whose index span and `v` share no verse keeps its index span (the clip's
  // fallback); those are listed, not failed.
  console.log(`Verse spans (${where}, as chapterData shows them):`);
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
          const citedVs = citData.citedVerses(c.v);
          if (spanOf[id].some((s) => citedVs.has(s))) {
            if (!citedVs.has(v)) outside++;
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
  console.log(`  ${where}: ${totalCites} citations, ${Object.keys(sources).length} sources, ${files.length} talk files.`);
  return d;
}

function packChecks() {
  descriptorChecks();
  const [personalDir, publicDir] = citData.PACK_DIRS;
  const pub = checkPack(publicDir, 'public');
  if (fs.existsSync(path.join(ROOT, personalDir, 'index.json'))) {
    const per = checkPack(personalDir, 'personal');
    console.log('Both packs:');
    eq(per && per.vintage, pub && pub.vintage, 'both packs carry the same vintage');
  }
  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nAll checks passed.');
}

probeChecks()
  .catch((e) => { check(false, 'pack probe threw: ' + e.message); })
  .then(chapterDataChecks)
  .catch((e) => { check(false, 'chapterData threw: ' + e.message); })
  .then(packChecks);
