#!/usr/bin/env node
/*
 * Sanity-check the generated citation data packs and cit-data.js's pure core.
 * Run: node tools/validate-citations.js   (after build-citation-data.js)
 *
 * Covers src/citations/cit-data.js (the pack probe and its Store stamp, chapterIndex, citedVerses,
 * refRanks, chapterData over a stub pack) and tools/build-citation-data.js's
 * pure core (toChurchUrl, excerptChars, packDescriptor in both modes,
 * parseInclusion, citeRecord) on fixtures.
 *
 * Then every pack on disk — the committed public pack always, the personal
 * pack when its directory exists, or only the pack in --dir <path> (a scratch
 * build, e.g. the public pack under inclusion rule verbatim) — is checked
 * against its own descriptor
 * (spec #69 checks A1, A2, A26): a references-only corpus (excerpt fetched,
 * text not bundled) has no snippet on any cite and no talk file; every cite
 * of a fetched-excerpt corpus carries an excerpt character count; a bundled
 * corpus has a talk file for every source; every source's corpus is
 * in the descriptor, and the public pack lists no gated corpus; base talks
 * keep the ids in tools/fixtures/base-talk-ids.json; a corpus under
 * inclusion rule verbatim keeps fewer cites, so the pack-size floors drop;
 * talk URLs are Church study URLs, except a Wikisource-attributed corpus's
 * (J), which are Wikisource permalinks (the J corpus in depth:
 * tools/validate-jod.js); through chapterIndex, every verse the panel shows a cite under
 * is one its `v` lists (stray index rows are a warning until a rebuild skips
 * them). With both packs present, they carry the same vintage.
 * Exits non-zero on failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'src', 'citations', 'data');
const DIR_ARG = (() => { const i = process.argv.indexOf('--dir'); return i >= 0 ? process.argv[i + 1] : null; })();
const citData = require(path.join(ROOT, 'src', 'citations', 'cit-data.js'));
const build = require(path.join(ROOT, 'tools', 'build-citation-data.js'));
const derive = require(path.join(ROOT, 'tools', 'derive-conference.js'));
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

// The excerpt character count (excerptChars): the length of the text the
// cite's row will show (spec #69 A18), so it depends on where the corpus's
// text comes from (the descriptor's `text`):
//   live-church  the Church page's paragraph, predicted from BYU's copy: the
//                in-text reference kept with the punctuation BYU moved into
//                its label's classes, BYU's inlined footnote (noteMarker)
//                dropped whole — the Church page draws its marker number from
//                data-value, so the number is not in the row's text either
//   live-byu     BYU's own paragraph as the reader shows it: talk-source's
//                paragraphText, the same function, so BYU's labels drop
console.log('Excerpt character count (fixtures):');
{
  const TS = require(path.join(ROOT, 'src', 'citations', 'talk-source.js'));
  const label = (id, ref) => `<span class="citation" id="${id}"><a href="javascript:void(0)" onclick="sx(this, ${id})">  </a>` +
    `<a href="javascript:void(0)" onclick="gs(${id})">${ref}</a></span>`;
  const modern = '<p data-aid="146038909" id="p2">This last year has been one for the record books.</p>\n' +
    '<p data-aid="146038910" id="p3">He said, “I will show [you] that I am able to do mine own work.”' +
    '<sup class="noteMarker"><a href="#note1">1</a><span class="footnote">[<span class="note-p">' +
    `<span class="ccontainer rdot">${label(137180, '2 Nephi 27:21')}</span></span>]</span></sup></p>\n<p id="p4">Often.</p>`;
  eq(build.excerptChars(modern, 137180, 'live-church'), 'He said, “I will show [you] that I am able to do mine own work.”'.length,
    'a modern paragraph counts without BYU\'s inlined footnote, its marker number included');
  const inline = '<p uri="/ensign/1971/06/out-of-the-darkness.p21" class="">“the only true and living church upon the face of the whole earth.” ' +
    `<span class="ccontainer lparen rdotparen">${label(15674, 'D&amp;C 1:30')}</span></p>`;
  eq(build.excerptChars(inline, 15674, 'live-church'), '“the only true and living church upon the face of the whole earth.” (D&C 1:30.)'.length,
    'an in-text reference counts as the Church page prints it, punctuation included');
  const early = '</p><p>\nFor you shall live by every word that proceedeth forth\nfrom the mouth of God\n' +
    `<span class="ccontainer lparen rparendot">${label(11779, 'D&amp;C 84:32-44')}</span>\n</p><p>\nThere is much more.</p>`;
  eq(build.excerptChars(early, 11779, 'live-byu'), 'For you shall live by every word that proceedeth forth from the mouth of God'.length,
    'an early-conference paragraph counts with its line breaks as single spaces and no label');
  eq(build.excerptChars(early, 11779, 'live-byu'), TS.paragraphText(early, '11779').length,
    'a BYU-fetched count is the reader\'s own excerpt text');
  const two = `<p>Faith &amp; works <span class="ccontainer">${label(9, 'James 2:17')}</span> and grace ` +
    `<span class="ccontainer">${label(10, 'Eph. 2:8')}</span></p>`;
  eq(build.excerptChars(two, 10, 'live-byu'), 'Faith & works and grace'.length,
    'BYU-fetched: every label in the paragraph is dropped, and an entity counts as one character');
  eq(build.excerptChars(two, 10, 'live-church'), 'Faith & works James 2:17 and grace Eph. 2:8'.length,
    'Church: every in-text reference counts, without BYU\'s spacer');
  // A subtitle that is only a reference: the talk's own text, which BYU
  // wrapped in its citation span (2019–2026 talks); the Church page prints it in parentheses.
  const subtitle = `<h1>Title</h1> <p class="subtitle" data-aid="171130208" id="p_nGsCY"><span class="ccontainer lparen rparen">${label(145619, 'Doctrine and Covenants 6:36')}</span></p>`;
  eq(build.excerptChars(subtitle, 145619, 'live-church'), '(Doctrine and Covenants 6:36)'.length,
    'a paragraph that is only a reference counts the reference');
  eq(build.excerptChars(subtitle, 145619, 'live-byu'), 'Doctrine and Covenants 6:36'.length,
    'BYU-fetched, a paragraph that is only a reference shows the reference');
  eq(build.excerptChars(two, 11, 'live-church'), null, 'a cite whose span is not in the talk has no count');
  eq(build.excerptChars(null, 9, 'live-byu'), null, 'a talk with no HTML gives no count');
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

  // The Store stamp (issue #90): the Store zip asks for the public pack alone.
  deep(citData.packDirs({ storeZip: true }), ['src/citations/data/'], 'a Store stamp probes the public pack alone');
  deep(citData.packDirs({ storeZip: false }), citData.PACK_DIRS, 'a repo stamp probes both packs');
  deep(citData.packDirs(null), citData.PACK_DIRS, 'a missing or unreadable stamp probes both packs');
  deep(citData.STORE_STAMP, { storeZip: true }, 'the stamp the Store zip ships reads as a Store stamp');
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, citData.STAMP_PATH), 'utf8'));
  deep(citData.packDirs(committed), citData.PACK_DIRS, `the committed ${citData.STAMP_PATH} probes both packs`);

  let p = probing({ [personalDir]: PERSONAL, [publicDir]: PUBLIC });
  let got = await citData.pickPack(p.probe, citData.packDirs({ storeZip: true }));
  check(got && got.dir === publicDir && got.descriptor.flavor === 'public', 'under the Store stamp, the public pack is read');
  deep(p.asked, [publicDir], 'under the Store stamp, the personal directory is never asked');

  p = probing({ [personalDir]: PERSONAL, [publicDir]: PUBLIC });
  got = await citData.pickPack(p.probe);
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
const CHURCH_STUDY = /^https:\/\/www\.churchofjesuschrist\.org\/study\/(?!study\/)/;
const WIKISOURCE_PERMALINK = /^https:\/\/en\.wikisource\.org\/w\/index\.php\?title=[^&]+&oldid=\d+$/;

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
  console.log('Derived cites from conference inputs (fixtures):');
  {
    const input = {
      conference: '2026-10', source: 'church',
      talks: [
        { id: 'gc/2026/10/12gong', url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/10/12gong?lang=eng',
          sp: 'Gerrit W. Gong', ti: 'A Title', d: '2026-10', lbl: 'October 2026 General Conference', rev: '1',
          cites: [
            { id: 20261000001, book: 'moses', chapter: 1, v: '39', a: 'p_oTBi9', ec: 127 },
            { id: 20261000002, book: 'dc', chapter: 132, v: '7,18-19', a: 'p_d5rju', ec: 369 },
            { id: 20261000003, book: 'nowhere', chapter: 1, v: '1', a: 'p_x', ec: 5 },
          ] },
        { id: 'gc/2026/10/31sustaining', url: 'u', sp: 'S', ti: 'T', d: '2026-10', lbl: 'October 2026 General Conference', rev: '1', cites: [] },
      ],
    };
    const base = { updated: '2026-05-18', conferences: new Set(['2026-04', '2025-10']) };
    const got = build.derivedCites([input], pub.corpora.G, { books: new Set(['moses', 'dc']), base });
    deep(got.errors, [], 'a conference newer than the base stamp derives without error');
    deep(got.conferences, ['2026-10'], 'the derived conferences are listed');
    deep(got.sources, { 'gc/2026/10/12gong': { c: 'G', sp: 'Gerrit W. Gong', ti: 'A Title', d: '2026-10', lbl: 'October 2026 General Conference',
      url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/10/12gong?lang=eng' } },
    'a talk with cites becomes a G source under its derived id; a talk with none adds no source');
    deep(got.shards.dc, { cites: { 20261000002: { t: 'gc/2026/10/12gong', v: '7,18-19', a: 'p_d5rju', ec: 369 } },
      index: { 132: { 7: [20261000002], 18: [20261000002], 19: [20261000002] } } },
    'a derived cite is a references-only record with its anchor and count, filed under each verse it names');
    check(!('nowhere' in got.shards), 'a cite into a book the pack lacks is dropped');
    const covered = build.derivedCites([Object.assign({}, input, { conference: '2026-04' })], pub.corpora.G, { books: new Set(['moses']), base });
    check(covered.errors.length === 1 && /2026-04/.test(covered.errors[0]), `a conference the base covers is refused (${covered.errors})`);
    const old = build.derivedCites([Object.assign({}, input, { conference: '2025-04' })], pub.corpora.G,
      { books: new Set(['moses']), base: { updated: '2026-05-18', conferences: new Set() } });
    check(old.errors.length === 1, 'a conference older than the base stamp is refused even when the base has no talk of it');
  }
  console.log('Diff report (fixtures):');
  {
    const before = {
      sources: { 1: { c: 'G' }, 2: { c: 'G' }, 3: { c: 'J' } },
      shards: [{ cites: { 10: { t: 1 }, 11: { t: 2 }, 12: { t: 3 } } }, { cites: { 13: { t: 1 } } }],
    };
    const after = {
      sources: { 1: { c: 'G' }, 3: { c: 'J' }, 'gc/2026/10/12gong': { c: 'G' }, 'gc/2026/10/11a': { c: 'G' } },
      shards: [{ cites: { 10: { t: 1 }, 12: { t: 3 }, 20261000001: { t: 'gc/2026/10/12gong' } } },
        { cites: { 13: { t: 1 }, 20261000002: { t: 'gc/2026/10/11a' }, 20261000003: { t: 'gc/2026/10/11a' } } }],
    };
    const descriptor = { flavor: 'public', vintage: '2026-10', base: { db: 'core.53.db', updated: '2026-05-18' }, derived: ['2026-10'] };
    eq(build.diffReport(build.tallyPack(before), build.tallyPack(after), descriptor, '2026-04'), [
      '### Pack diff: public pack',
      '',
      'Vintage 2026-04 -> 2026-10. Base: core.53.db, updated 2026-05-18. Derived conferences: 2026-10.',
      '',
      '| Corpus | Talks before | Talks after | Added | Removed | Cites before | Cites after |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      '| G | 2 | 3 | 2 | 1 | 3 | 5 |',
      '| J | 1 | 1 | 0 | 0 | 1 | 1 |',
      '',
      'Added (G): gc/2026/10/11a, gc/2026/10/12gong',
      'Removed (G): 2',
    ].join('\n'), 'talks added and removed and cites before and after, per corpus, with the base stamp and derived conferences');
    eq(build.diffReport(build.tallyPack(null), build.tallyPack(after), descriptor, '').split('\n')[2],
      'Vintage (none) -> 2026-10. Base: core.53.db, updated 2026-05-18. Derived conferences: 2026-10.', 'a first build reports from nothing');
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
  const DATA = path.resolve(ROOT, dir);
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
  // Under verbatim, early conference keeps about 58% of its cites and the
  // Journal of Discourses about 15% (issue #72), about 79k of 126k in all.
  const verbatim = Object.values(corpora).some((e) => e.inclusion === 'verbatim');
  const floor = verbatim ? { citations: 60000, walked: 40000 } : { citations: 100000, walked: 50000 };
  check(index.counts && index.counts.books === index.books.length, `counts.books matches books[] (${index.counts && index.counts.books} vs ${index.books.length})`);
  check(index.counts && index.counts.books >= 88, `index covers all standard works, >= 88 books (got ${index.counts && index.counts.books})`);
  check(index.counts.citations > floor.citations, `citation count is sane, over ${floor.citations} (${index.counts.citations})`);
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

  // Derived cites (spec #69 check A4): a derived talk is any talk not in the
  // base; its conference is newer than the base stamp, the base has no talk of
  // it, and the descriptor lists it; every listed conference has derived
  // talks; a derived talk's id is the slug of its own Church URL (A26).
  console.log(`Derived conferences (${where}):`);
  const baseConfs = new Set();
  const derivedConfs = {};
  let badDerivedIds = 0;
  for (const [id, s] of Object.entries(sources)) {
    if (BASE_IDS.has(id)) { if (s.d) baseConfs.add(build.conferenceOf(s.d)); continue; }
    const conf = build.conferenceOf(s.d);
    derivedConfs[conf] = (derivedConfs[conf] || 0) + 1;
    if (derive.derivedTalkId(s.url) !== id || !id.startsWith(`gc/${conf.replace('-', '/')}/`)) badDerivedIds++;
  }
  const listed = d.derived || [];
  const stamp = String(d.base && d.base.updated || '').slice(0, 7);
  deep(Object.keys(derivedConfs).sort(), listed.slice().sort(), `${where}: the descriptor's derived conferences are exactly those of its derived talks`);
  const early = listed.filter((c) => !(c > stamp) || baseConfs.has(c));
  deep(early, [], `${where}: derived conferences are newer than the base stamp (${d.base && d.base.updated}) and the base has no talk of them`);
  eq(badDerivedIds, 0, `${where}: each derived talk's id is its Church URL's slug, gc/YYYY/MM/{slug}, in its own conference`);

  console.log(`Shards (${where}):`);
  let totalCites = 0;
  let badUrls = 0;
  const snippets = {};      // references-only corpus -> cites carrying a snippet
  const uncounted = {};     // talk of a fetched-excerpt corpus -> its cites with no count
  const counted = new Set(); // talks of a fetched-excerpt corpus with a counted cite
  const cited = new Set();
  const unanchored = [];     // derived cites with no paragraph anchor
  for (const b of index.books) {
    const shard = readJSON(`citations/${b.slug}.json`);
    for (const [citId, c] of Object.entries(shard.cites)) {
      const src = sources[c.t];
      if (!src) { check(false, `${b.slug} cite ${citId} -> talk ${c.t} not in sources`); continue; }
      cited.add(String(c.t));
      if (!BASE_IDS.has(String(c.t)) && !c.a) unanchored.push(citId);
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
  check(totalCites > floor.walked, `walked citations, over ${floor.walked} (${totalCites})`);
  deep(unanchored.slice(0, 5), [], `${where}: every derived cite carries its paragraph anchor (${unanchored.length} do not)`);
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
    const credited = corpora[s.c] && corpora[s.c].attribution === 'wikisource';
    if (s.url && !(credited ? WIKISOURCE_PERMALINK : CHURCH_STUDY).test(s.url)) badUrls++;
    check(cited.has(id), `${where}: source ${id} is cited by some cite`);
  }
  check(badUrls === 0, `${where}: every talk URL is a Church study URL with a single /study/, ` +
    `or a Wikisource-attributed corpus's permalink (${badUrls} bad)`);

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
    if (corpora[s.c] && build.bundlesTalks(corpora[s.c]) && !fileIds.has(id)) missing++;
  }
  check(missing === 0, `${where}: a bundled corpus has a talk file for every source (${missing} missing)`);
  eq(index.counts.bundledTalks, files.length, `${where}: counts.bundledTalks matches the talk files`);

  // The Wikisource provenance ships for exactly the talks the pack ships: a
  // row per Wikisource-attributed talk, and none for a talk the inclusion
  // rule left out.
  const provFile = path.join(DATA, 'jod-provenance.json');
  const attributed = Object.keys(sources).filter((id) => corpora[sources[id].c] && corpora[sources[id].c].attribution === 'wikisource');
  if (attributed.length || fs.existsSync(provFile)) {
    const rows = fs.existsSync(provFile) ? Object.keys(JSON.parse(fs.readFileSync(provFile, 'utf8')).talks || {}) : [];
    const shipped = new Set(attributed);
    const listed = new Set(rows);
    const unshipped = rows.filter((id) => !shipped.has(id));
    const unlisted = attributed.filter((id) => !listed.has(id));
    check(!unshipped.length && !unlisted.length, `${where}: jod-provenance.json has a row for every shipped Wikisource talk and no other ` +
      `(${unshipped.length} rows for talks not in the pack, e.g. ${unshipped.slice(0, 3).join(', ')}; ${unlisted.length} talks without a row)`);
  }

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
  if (DIR_ARG) {
    const index = JSON.parse(fs.readFileSync(path.resolve(DIR_ARG, 'index.json'), 'utf8'));
    checkPack(DIR_ARG, index.pack && index.pack.flavor);
    if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
    console.log('\nAll checks passed.');
    return;
  }
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
