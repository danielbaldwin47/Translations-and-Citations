#!/usr/bin/env node
/*
 * Build a citation data pack (ADR-0008) from the BYU "Scripture Citation
 * Index" app SQLite databases: a compact, web-fetchable dataset covering all
 * five standard works.
 *
 * The two app DBs are not shipped; place them in ./source-data/ (gitignored) —
 * which is the default location below. They also live in git/LFS history at the
 * commit that added them.
 *
 * Run (Node 22+, built-in SQLite + zlib — no npm install):
 *   node --experimental-sqlite tools/build-citation-data.js [--pack public|personal] [--inclusion E=all,J=all]
 *   (defaults: --pack public --core ./source-data/core.53.db --content ./source-data/content.53.db
 *    --out ./src/citations/data for public, ./src/citations/data-personal for personal)
 *
 * Pack mode: `public` builds the committed public pack, `personal` the
 * personal pack in its own directory (never committed). The mode picks the
 * corpora (PACK_CORPORA: the public pack has no T, the gated element), and
 * each corpus's descriptor entry (CORPORA) decides what the pack holds for it:
 * a snippet per cite when its excerpt is bundled, an excerpt character count
 * (excerptChars) when it is fetched, talk files only when its text is
 * bundled. G and E are references-only in both modes. The build rewrites the
 * pack's shards and talk files whole.
 *
 * --inclusion: the per-corpus inclusion rule, recorded in the descriptor.
 * Only `all` builds today; `verbatim` exits with an error until issue #72.
 *
 * Journal of Discourses (J) talk text, snippets, page anchors and source URLs
 * come from the Wikisource build, a cached input beside the DBs (--jod, default
 * ./source-data/jod-talks; make it with tools/fetch-jod-wikisource.js then
 * tools/build-jod-talks.js). No J text is taken from BYU's HTML; the pack gets
 * that build's provenance file as jod-provenance.json.
 *
 * Inspect the raw DBs first (recommended before a full build) to confirm the
 * real talk.URL formats and talk HTML markup:
 *   node --experimental-sqlite tools/build-citation-data.js --inspect
 *
 * Output layout (a talk id is BYU's numeric talk.ID; a derived talk's will be gc/YYYY/MM/{slug}):
 *   data/index.json            { builtAt, dbUpdated, pack, books:[{slug,fullName,bookId,citations}], counts }
 *                              pack = the pack descriptor (packDescriptor)
 *   data/sources.json          { [talkId]: { c, sp, ti, d, lbl, url? } }   // one entry per cited talk
 *   data/citations/{slug}.json { cites:{ [citId]:{t,v,sn?,a?,ec?} }, index:{ [chap]:{ [verse]:[citId,...] } } }
 *                              sn snippet (bundled excerpt), a paragraph anchor (G) or a J cite's
 *                              page anchor jdp-N, ec excerpt character count (fetched excerpt)
 *   data/talks/{talkId}.html.gz  gzipped talk HTML for corpora whose text is bundled (J, the
 *                              Wikisource build's HTML; T in the personal pack)
 *   data/jod-provenance.json   { snapshot, license, talks: { [talkId]: provenance row } }
 *                              (tools/build-jod-talks.js; checked by tools/validate-jod.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');
const BOOKS = require('../src/shared/books.js'); // { LDS_TO_USFM, BIBLE_NAMES, ... }

// ---- args ----
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PACK_OUT = {
  public: path.resolve(__dirname, '..', 'src', 'citations', 'data'),
  personal: path.resolve(__dirname, '..', 'src', 'citations', 'data-personal'),
};
const PACK = arg('--pack', 'public');
const CORE = arg('--core', path.resolve(__dirname, '..', 'source-data', 'core.53.db'));
const CONTENT = arg('--content', path.resolve(__dirname, '..', 'source-data', 'content.53.db'));
const OUT = arg('--out', PACK_OUT[PACK]);
const JOD = arg('--jod', path.resolve(__dirname, '..', 'source-data', 'jod-talks'));
const INSPECT = process.argv.includes('--inspect');

// ---- pack descriptor ----
// What each corpus is to the reader (GLOSSARY.md "Pack descriptor"); the
// reader learns every per-corpus fact from here and nowhere else:
//   sourceType  the panel's source-type group the corpus files under
//   text        where talk HTML comes from: 'bundled' (talks/{id}.html.gz),
//               'live-church' (the Church site), 'live-byu' (scriptures.byu.edu)
//   target      the corpus plan's scroll-target rule: 'anchor' | 'citationSpan' | 'bodyPassage'
//   excerpt     'bundled' (a snippet cut at build time) | 'fetched' (on visibility)
//   inclusion   the build's inclusion rule: 'all' | 'verbatim'
//   attribution where the bundled text is from, for the reader's byline:
//               'wikisource' (the source record's URL is the permalink at its revision)
// Key order is display order of source types (the reader groups in first-seen order).
// A corpus whose text is not bundled and whose excerpt is fetched is
// references-only (GLOSSARY.md): the pack holds no snippet and no talk file
// for it, only facts per cite — and, so a pending excerpt can reserve its
// size, each cite's excerpt character count. Conference talk text is
// copyrighted, so G and E are references-only in both packs.
const CORPORA = {
  G: { sourceType: 'General Conference', text: 'live-church', target: 'anchor', excerpt: 'fetched', inclusion: 'all' },
  E: { sourceType: 'General Conference', text: 'live-byu', target: 'citationSpan', excerpt: 'fetched', inclusion: 'all' },
  J: { sourceType: 'Journal of Discourses', text: 'bundled', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all', attribution: 'wikisource' },
  // The gated element (ADR-0008): personal pack only.
  T: { sourceType: 'Teachings of the Prophet Joseph Smith', text: 'bundled', target: 'bodyPassage', excerpt: 'bundled', inclusion: 'all' },
};
const PACK_CORPORA = { public: ['G', 'E', 'J'], personal: ['G', 'E', 'J', 'T'] };
const INCLUSION_RULES = ['all', 'verbatim'];

// The descriptor a pack mode writes, or null for an unknown mode.
//   facts: { vintage:'YYYY-MM', base:{ db, updated:'YYYY-MM-DD' }, derived:['YYYY-MM', …] }
//   inclusion: { [corpus]: 'all'|'verbatim' } (parseInclusion's rules); a corpus not named stays 'all'
function packDescriptor(mode, facts, inclusion) {
  const list = PACK_CORPORA[mode];
  if (!list) return null;
  const corpora = {};
  for (const c of list) {
    corpora[c] = Object.assign({}, CORPORA[c]);
    if (inclusion && inclusion[c]) corpora[c].inclusion = inclusion[c];
  }
  return { flavor: mode, vintage: facts.vintage, base: facts.base, derived: facts.derived, corpora };
}

// The --inclusion build input, 'E=verbatim,J=all' -> { rules: { E:'verbatim', J:'all' } },
// or { error } naming the bad pair. Absent -> no rules (every corpus 'all').
function parseInclusion(value) {
  const rules = {};
  if (value === undefined || value === '') return { rules };
  for (const pair of String(value).split(',')) {
    const [corpus, rule] = pair.split('=').map((s) => (s || '').trim());
    if (!(corpus in CORPORA)) return { error: `unknown corpus "${corpus}" in --inclusion ${value}` };
    if (!INCLUSION_RULES.includes(rule)) return { error: `--inclusion ${corpus} must be one of ${INCLUSION_RULES.join('|')} (got "${rule || ''}")` };
    rules[corpus] = rule;
  }
  return { rules };
}

// Whether a corpus ships talks/{talkId}.html.gz files.
function bundlesTalks(corpus) {
  return corpus.text === 'bundled';
}

// One cite's shard record, shaped by its corpus's descriptor entry:
//   facts { t, v, sn, a, ec } -> { t, v, sn? (bundled excerpt), a? (anchor), ec? (fetched excerpt's count) }
function citeRecord(corpus, facts) {
  const rec = { t: facts.t, v: facts.v };
  if (corpus.excerpt === 'bundled') rec.sn = facts.sn;
  if (facts.a) rec.a = facts.a; // G: paragraph anchor for a live deep-link; J: an unplaced cite's page anchor
  if (corpus.excerpt === 'fetched' && Number.isInteger(facts.ec)) rec.ec = facts.ec;
  return rec;
}

// The conference a session dated 'YYYY-MM' belongs to: months 1–6 are the
// April conference, 7–12 the October one (a session opening on 30 September,
// the women's session the week before). 'YYYY-04' | 'YYYY-10'.
function conferenceOf(d) {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
  if (!m) return '';
  return `${m[1]}-${Number(m[2]) <= 6 ? '04' : '10'}`;
}

// Volumes: 1=OT, 2=NT, 3=Book of Mormon, 4=D&C, 5=Pearl of Great Price.
const ALL_VOLUMES = new Set([1, 2, 3, 4, 5]);

// ---- helpers ----
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', ntilde: 'ñ', uacute: 'ú', iacute: 'í', oacute: 'ó', aacute: 'á', agrave: 'à', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
function decodeEntities(s) {
  if (!s) return '';
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, code.toLowerCase()) ? ENTITIES[code.toLowerCase()] : m;
  });
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function decompressTalk(buf) {
  // First 2 bytes are a custom header; standard zlib stream starts at byte 2.
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return zlib.inflateSync(bytes.subarray(2)).toString('utf8');
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj)); }

// ---- DB ----
function openDb(file) {
  if (!fs.existsSync(file)) {
    console.error(`ERROR: database not found: ${file}`);
    console.error('Deliver core_53.db / content_53.db to this session, then pass --core/--content.');
    process.exit(2);
  }
  const { DatabaseSync } = require('node:sqlite'); // here, so validators can require this file without the flag
  return new DatabaseSync(file, { readOnly: true });
}

// DB Abbr -> our slug for cases the normalization can't reach. D&C sections are
// stored with Abbr "sec" but the Church URL slug (and our map key) is "dc".
const ABBR_ALIAS = { sec: 'dc' };

// Build LDS slug -> book.ID for all standard works, matching on Abbr (normalized
// spaces→hyphens, e.g. '1 ne' → '1-ne') with an alias table and FullName fallback.
// Reuses the Bible + non-Bible name maps from books.js. 0-chapter front matter
// (title page, intros, witnesses, facsimiles) has no slug, so it is skipped.
function buildBookMap(core) {
  const mySlugs = new Set([
    ...Object.keys(BOOKS.LDS_TO_USFM),
    ...Object.keys(BOOKS.NON_BIBLE_NAMES),
  ]);
  const nameToSlug = {};
  for (const [slug, full] of Object.entries(BOOKS.BIBLE_NAMES)) nameToSlug[full.toLowerCase()] = slug;

  const rows = core.prepare('SELECT ID, Abbr, FullName, ParentBookID FROM book').all();
  const map = {}; // slug -> { bookId, fullName }
  const unmatched = [];
  for (const r of rows) {
    if (!ALL_VOLUMES.has(r.ParentBookID)) continue;
    const norm0 = String(r.Abbr || '').toLowerCase().trim().replace(/\s+/g, '-');
    const norm = ABBR_ALIAS[norm0] || norm0;
    const slug = mySlugs.has(r.Abbr) ? r.Abbr
      : mySlugs.has(norm) ? norm
      : nameToSlug[String(r.FullName || '').toLowerCase().trim()] || null;
    if (slug) map[slug] = { bookId: r.ID, fullName: BOOKS.bookFullName(slug) || r.FullName };
    else unmatched.push(`${r.ID}:${r.FullName} (Abbr=${r.Abbr})`);
  }
  if (unmatched.length) {
    // Most unmatched rows are intentionally-skipped front matter; log for review.
    console.warn(`Note: ${unmatched.length} book rows had no slug (front matter is expected):\n  ` + unmatched.join('\n  '));
  }
  return map;
}

// ---- corpus-specific bits (validate against --inspect output) ----

// Transform the stored talk.URL into a same-origin churchofjesuschrist.org study
// URL. Modern GC already stores the full church URL; older GC stores lds.org
// ensign paths. Returns null if not derivable (then the talk has no URL).
// The 30 April 2019 talks are stored as lds.org/study/ensign/2019/05/{session}/{slug}:
// their path already holds /study/ (so the plain transform doubled it, a 404),
// and the session path redirects to the conference page, while the site serves
// the talk at /study/ensign/2019/05/{slug} (all 30 checked October 6, 2026).
function toChurchUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (/churchofjesuschrist\.org\/study\//i.test(u)) {
    return u.replace(/^http:/, 'https:');
  }
  // http(s)://lds.org/study/ensign/{yyyy}/{mm}/{session}/{slug} -> …/study/ensign/{yyyy}/{mm}/{slug}
  const s = /^https?:\/\/(?:www\.)?lds\.org\/study\/(ensign\/\d{4}\/\d{2})\/[^/?#]+-session\/(.+)$/i.exec(u);
  if (s) return `https://www.churchofjesuschrist.org/study/${s[1]}/${s[2]}`;
  // http(s)://lds.org/{path}  ->  https://www.churchofjesuschrist.org/study/{path}
  const m = /^https?:\/\/(?:www\.)?lds\.org\/(?:study\/)?(.+)$/i.exec(u);
  if (m) return `https://www.churchofjesuschrist.org/study/${m[1]}`;
  return null;
}

// STPJS (Teachings of the Prophet Joseph Smith) bundles citations in a bottom
// footnote list (<div class="footnote">N. <span class="citation">…refs…</span>),
// while the body carries <span class="footRef">N</span> markers. Given a footnote
// number, return the body sentence that marker annotates (its referenced text)
// rather than the bare scripture-reference line.
// Build-time half of the body-passage rule; the reader states it again over the
// sanitized DOM (src/citations/talk-source.js). Change both together — see
// docs/adr/0006-stpjs-body-passage-stated-twice.md.
function stpjsBodyPassage(html, num) {
  const bodyEnd = html.indexOf('<div class="footnotes"');
  const body = bodyEnd >= 0 ? html.slice(0, bodyEnd) : html;
  const TOKEN = '~~FREF~~';
  let marked = body.replace(new RegExp(`<span class="footRef">\\s*${num}\\s*</span>`), TOKEN);
  // Drop the other in-body footnote markers so their numbers don't pollute the text.
  marked = marked.replace(/<span class="footRef">\s*\d+\s*<\/span>/g, '');
  const text = stripTags(marked);
  const idx = text.indexOf(TOKEN);
  if (idx < 0) return '';
  const start = Math.max(
    text.lastIndexOf('. ', idx), text.lastIndexOf('? ', idx),
    text.lastIndexOf('! ', idx), text.lastIndexOf('] ', idx)
  );
  let end = text.length;
  for (const p of ['. ', '? ', '! ']) { const k = text.indexOf(p, idx); if (k >= 0) end = Math.min(end, k + 1); }
  let sentence = text.slice(start >= 0 ? start + 1 : 0, end).replace(TOKEN, '').replace(/\s+/g, ' ').trim();
  if (sentence.length > 220) sentence = sentence.slice(0, 200).replace(/\s+\S*$/, '') + '…';
  return sentence;
}

// Locate a citation in the talk HTML by its citation.ID (the app marks each as
// <span class="citation" id="{citId}">…</span>), return the enclosing block's
// text as a snippet and, for modern GC, the paragraph anchor (e.g. "p21").
function extractCitation(html, citId) {
  if (!html) return { snippet: '', anchor: '' };
  const marker = `<span class="citation" id="${citId}"`;
  const i = html.indexOf(marker);
  if (i < 0) return { snippet: '', anchor: '' };
  // STPJS: the citation span sits inside a "<div class="footnote">N." list item —
  // prefer the body passage that footnote annotates over the reference line.
  const fnStart = html.lastIndexOf('<div class="footnote">', i);
  if (fnStart >= 0) {
    const numM = /<div class="footnote">\s*(\d+)\./.exec(html.slice(fnStart, fnStart + 60));
    if (numM) {
      const passage = stpjsBodyPassage(html, numM[1]);
      if (passage) return { snippet: passage, anchor: '' };
    }
  }
  // Enclosing block = nearest <p ...> or <div ...> opening before the span.
  const blockStart = Math.max(html.lastIndexOf('<p', i), html.lastIndexOf('<div', i), 0);
  const pEnd = html.indexOf('</p>', i);
  const dEnd = html.indexOf('</div>', i);
  let blockEnd = Math.min(pEnd < 0 ? Infinity : pEnd, dEnd < 0 ? Infinity : dEnd);
  if (!isFinite(blockEnd)) blockEnd = Math.min(html.length, i + 500);
  const block = html.slice(blockStart, blockEnd);
  let anchor = '';
  const uriM = /uri="[^"]*?\.(p\d+)"/.exec(block);
  if (uriM) anchor = uriM[1];
  let snippet = stripTags(block);
  if (snippet.length > 220) snippet = snippet.slice(0, 200).replace(/\s+\S*$/, '') + '…';
  return { snippet, anchor };
}

// BYU's insertions into a talk's prose: the reference label around each
// citation span (`ccontainer`, the span itself) and, in modern talks, the
// footnote BYU inlines at its marker (`sup.noteMarker`). The publishing site's
// paragraph has none of them.
const BYU_INSERTION = /^<(span|sup)\b[^>]*\bclass="(?:ccontainer\b[^"]*|citation|noteMarker)"/i;

// `html` with every BYU insertion removed, nested tags included.
function dropByuInsertions(html) {
  let out = '';
  let i = 0;
  const tag = /<(\/?)(span|sup)\b[^>]*>/gi;
  while (i < html.length) {
    tag.lastIndex = i;
    const m = tag.exec(html);
    if (!m) { out += html.slice(i); break; }
    out += html.slice(i, m.index);
    i = m.index + m[0].length;
    if (m[1] || !BYU_INSERTION.test(m[0])) { out += m[0]; continue; }
    // Skip to this element's own closing tag.
    const name = m[2].toLowerCase();
    const same = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
    same.lastIndex = i;
    let depth = 1;
    let n;
    while (depth && (n = same.exec(html))) depth += n[1] ? -1 : 1;
    i = n ? same.lastIndex : html.length;
  }
  return out;
}

// The excerpt character count of one cite (spec #69, "excerpt lengths"): the
// length of the text of the paragraph holding its citation span — the last
// <p or <div opening before the span to the first </p> or </div> after it,
// the prototype's paragraph rule — with BYU's insertions dropped, entities
// decoded and whitespace runs collapsed. A number only; no talk text ships.
// null when the talk or the span is missing (the reader then reserves three lines).
function excerptChars(html, citId) {
  if (!html) return null;
  const at = html.indexOf(`<span class="citation" id="${citId}"`);
  if (at < 0) return null;
  const open = Math.max(html.lastIndexOf('<p', at), html.lastIndexOf('<div', at));
  const closes = ['</p>', '</div>'].map((t) => html.indexOf(t, at)).filter((k) => k >= 0);
  if (open < 0 || !closes.length) return null;
  const block = html.slice(open, Math.min(...closes));
  // A paragraph that is nothing but a reference (a subtitle, a footnote) is
  // the talk's own text that BYU wrapped in its span: count the reference.
  const text = stripTags(dropByuInsertions(block)) || stripTags(block);
  return text ? text.length : null;
}

// Human label for a citation's source.
function sourceLabel(core, talk, cit) {
  if (talk.Corpus === 'G' || talk.Corpus === 'E') {
    const d = talk.Date || '';
    const y = d.slice(0, 4);
    const mo = d.slice(5, 7);
    const season = mo === '04' ? 'April' : mo === '10' ? 'October' : (mo ? mo : '');
    return `${season} ${y} General Conference`.trim();
  }
  if (talk.Corpus === 'J') {
    const vol = cit.Volume || '';
    const pg = cit.Page || '';
    return `Journal of Discourses${vol ? ' ' + vol : ''}${pg ? ':' + pg : ''}`;
  }
  if (talk.Corpus === 'T') {
    return `Teachings of the Prophet Joseph Smith${cit.Page ? ', p. ' + cit.Page : ''}`;
  }
  return '';
}

// ---- inspect ----
function inspect(core, content) {
  console.log('=== core tables ===');
  for (const t of core.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    let n = '?';
    try { n = core.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c; } catch (e) {}
    console.log(`  ${t.name}: ${n}`);
  }
  console.log('\n=== OT/NT books (volumes 1,2) — sample ===');
  for (const r of core.prepare('SELECT ID,Abbr,FullName,ParentBookID,NumChapters FROM book WHERE ParentBookID IN (1,2) ORDER BY ID').all().slice(0, 8)) {
    console.log(`  ${r.ID} ${r.Abbr} | ${r.FullName} | vol=${r.ParentBookID} chs=${r.NumChapters}`);
  }
  console.log('\n=== talk.URL samples per corpus ===');
  for (const corpus of ['E', 'G', 'J', 'T']) {
    const rows = core.prepare('SELECT ID,Corpus,Title,Date,URL FROM talk WHERE Corpus=? LIMIT 3').all(corpus);
    for (const r of rows) console.log(`  [${corpus}] id=${r.ID} date=${r.Date} url=${r.URL}\n        title=${r.Title}`);
    const g = rows[0];
    if (corpus === 'G' && g) console.log(`        -> church url: ${toChurchUrl(g.URL)}`);
  }
  console.log('\n=== sample talk HTML (first ~1200 chars) per corpus ===');
  for (const corpus of ['E', 'G', 'J', 'T']) {
    const row = core.prepare('SELECT ID FROM talk WHERE Corpus=? LIMIT 1').get(corpus);
    if (!row) continue;
    const body = content.prepare('SELECT Text FROM talkbody WHERE TalkID=?').get(row.ID);
    if (!body) { console.log(`  [${corpus}] talk ${row.ID}: no body`); continue; }
    let html;
    try { html = decompressTalk(body.Text); } catch (e) { console.log(`  [${corpus}] decompress failed: ${e.message}`); continue; }
    console.log(`\n  --- [${corpus}] talk ${row.ID} (${html.length} chars) ---`);
    console.log(html.slice(0, 1200).replace(/\n/g, '\n  '));
  }
}

// ---- build ----
function build(core, content, inclusion) {
  // The pack is rewritten whole: shards and talk files from an earlier build
  // (another mode, a corpus since dropped) must not survive into this one.
  for (const sub of ['citations', 'talks']) fs.rmSync(path.join(OUT, sub), { recursive: true, force: true });
  mkdirp(OUT);
  mkdirp(path.join(OUT, 'citations'));
  mkdirp(path.join(OUT, 'talks'));

  // The Journal of Discourses build (tools/build-jod-talks.js): talk HTML,
  // snippets, page anchors and permalinks from Wikisource.
  const jodIndex = path.join(JOD, 'talks.json');
  if (!fs.existsSync(jodIndex)) {
    console.error(`ERROR: no Journal of Discourses build at ${JOD}.`);
    console.error('Run tools/fetch-jod-wikisource.js (once) and tools/build-jod-talks.js first, or pass --jod.');
    process.exit(2);
  }
  const jod = JSON.parse(fs.readFileSync(jodIndex, 'utf8'));
  const jodTalk = (talkId) => {
    if (!jod[talkId]) { console.error(`ERROR: J talk ${talkId} is missing from the Wikisource build (${JOD}).`); process.exit(2); }
    return jod[talkId];
  };
  const jodCite = (talkId, citId) => jodTalk(talkId).cites[citId] || { sn: '' };

  // What each corpus is in this pack; a corpus it lacks is not built at all.
  const corpora = packDescriptor(PACK, {}, inclusion).corpora;

  const bookMap = buildBookMap(core);
  const slugs = Object.keys(bookMap);
  console.log(`Mapped ${slugs.length} standard-works books.`);

  const sources = {};        // talkId -> meta
  const talkHtmlCache = {};   // talkId -> decompressed html (for snippets/bundling)
  const bundledTalks = new Set();
  let totalCitations = 0;
  let skipped = 0;       // citation rows of corpora this pack lacks
  let uncounted = 0;     // fetched-excerpt cites whose span the talk HTML lacks
  const bookCounts = [];

  const getTalkHtml = (talkId) => {
    if (talkId in talkHtmlCache) return talkHtmlCache[talkId];
    const row = content.prepare('SELECT Text FROM talkbody WHERE TalkID=?').get(talkId);
    let html = null;
    if (row && row.Text) { try { html = decompressTalk(row.Text); } catch (e) { html = null; } }
    talkHtmlCache[talkId] = html;
    return html;
  };

  const rowStmt = core.prepare(`
    SELECT cv.Verse AS verse, c.ID AS citId, c.Chapter AS chapter, c.Verses AS verses,
           c.Page AS page, c.Volume AS volume,
           t.ID AS talkId, t.Corpus AS corpus, t.Title AS title, t.Date AS date, t.URL AS url,
           s.GivenNames AS given, s.LastNames AS last
    FROM citation_verse cv
    JOIN citation c ON cv.CitationID = c.ID
    JOIN talk t ON c.TalkID = t.ID
    LEFT JOIN speaker s ON t.SpeakerID = s.ID
    WHERE c.BookID = ?
    ORDER BY c.Chapter, cv.Verse, t.Date DESC
  `);

  for (const slug of slugs) {
    const book = bookMap[slug];
    const rows = rowStmt.all(book.bookId);
    const cites = {};            // citId -> { t, v, sn }
    const index = {};            // chapter -> verse -> [citId]
    let count = 0;

    for (const r of rows) {
      const corpus = corpora[r.corpus];
      if (!corpus) { skipped++; continue; } // not in this pack (the public pack's T)
      const ch = String(r.chapter);
      const vs = String(r.verse);
      (index[ch] = index[ch] || {});
      (index[ch][vs] = index[ch][vs] || []);
      if (!index[ch][vs].includes(r.citId)) index[ch][vs].push(r.citId);

      if (!(r.citId in cites)) {
        if (r.corpus === 'J') {
          // Journal of Discourses: the snippet and the page-anchor fallback come
          // from the Wikisource build, never from BYU's HTML.
          const jc = jodCite(r.talkId, r.citId);
          cites[r.citId] = citeRecord(corpus, { t: r.talkId, v: r.verses || vs, sn: jc.sn, a: jc.a });
        } else {
          const html = getTalkHtml(r.talkId);
          const { snippet, anchor } = extractCitation(html, r.citId);
          const ec = corpus.excerpt === 'fetched' ? excerptChars(html, r.citId) : null;
          if (corpus.excerpt === 'fetched' && ec === null) uncounted++;
          cites[r.citId] = citeRecord(corpus, { t: r.talkId, v: r.verses || vs, sn: snippet, a: anchor, ec });
        }
        count++;
      }

      if (!(r.talkId in sources)) {
        const url = corpus.text === 'live-church' ? toChurchUrl(r.url) : r.corpus === 'J' ? jodTalk(r.talkId).url : null;
        sources[r.talkId] = {
          c: r.corpus,
          sp: decodeEntities([r.given, r.last].filter(Boolean).join(' ')) || 'Unknown',
          ti: decodeEntities(r.title || ''),
          d: (r.date || '').slice(0, 7),
          lbl: sourceLabel(core, { Corpus: r.corpus, Date: r.date }, { Page: r.page, Volume: r.volume }),
        };
        if (url) sources[r.talkId].url = url; // G: live-fetch target; J: Wikisource permalink
      }

      // J talks are the Wikisource build's HTML.
      if (r.corpus === 'J') {
        if (!bundledTalks.has(r.talkId)) {
          const html = fs.readFileSync(path.join(JOD, 'talks', `${r.talkId}.html`));
          fs.writeFileSync(path.join(OUT, 'talks', `${r.talkId}.html.gz`), zlib.gzipSync(html));
          bundledTalks.add(r.talkId);
        }
        continue;
      }
      // Talk files only for a corpus whose text is bundled; a references-only
      // corpus ships none.
      if (bundlesTalks(corpus) && !bundledTalks.has(r.talkId)) {
        const html = getTalkHtml(r.talkId);
        if (html) {
          fs.writeFileSync(path.join(OUT, 'talks', `${r.talkId}.html.gz`), zlib.gzipSync(Buffer.from(html, 'utf8')));
          bundledTalks.add(r.talkId);
        }
      }
    }

    writeJSON(path.join(OUT, 'citations', `${slug}.json`), { book: slug, fullName: book.fullName, cites, index });
    totalCitations += count;
    bookCounts.push({ slug, fullName: book.fullName, bookId: book.bookId, citations: count });
    // free per-book html cache to bound memory
    for (const k of Object.keys(talkHtmlCache)) delete talkHtmlCache[k];
  }

  writeJSON(path.join(OUT, 'sources.json'), sources);
  fs.copyFileSync(path.join(JOD, 'provenance.json'), path.join(OUT, 'jod-provenance.json'));
  let dbUpdated = '';
  try { dbUpdated = String(core.prepare('SELECT * FROM updated LIMIT 1').get() && Object.values(core.prepare('SELECT * FROM updated LIMIT 1').get())[0] || ''); } catch (e) {}
  let vintage = '';
  for (const s of Object.values(sources)) {
    if (CORPORA[s.c] && CORPORA[s.c].sourceType === 'General Conference') {
      const conf = conferenceOf(s.d);
      if (conf > vintage) vintage = conf;
    }
  }
  const pack = packDescriptor(PACK, {
    vintage,
    base: { db: path.basename(CORE), updated: dbUpdated.slice(0, 10) },
    derived: [],
  }, inclusion);
  writeJSON(path.join(OUT, 'index.json'), {
    builtAt: new Date().toISOString(),
    dbUpdated,
    pack,
    books: bookCounts,
    counts: { books: slugs.length, citations: totalCitations, sources: Object.keys(sources).length, bundledTalks: bundledTalks.size },
  });

  console.log(`\nDone. ${totalCitations} citations across ${slugs.length} books; ${Object.keys(sources).length} sources; ${bundledTalks.size} bundled talks.`);
  console.log(`Pack: ${PACK} (vintage ${pack.vintage}; corpora ${Object.entries(pack.corpora).map(([c, e]) => `${c}:${e.inclusion}`).join(', ')})`);
  console.log(`Skipped ${skipped} citation rows of corpora this pack lacks; ${uncounted} fetched-excerpt cites have no count (span not in the talk HTML).`);
  console.log(`Output: ${OUT}`);
}

// Reused by tools/rederive-js-snippets.js (which has no DBs but the shipped talk
// HTML); decodeEntities and decompressTalk by tools/build-jod-talks.js; the
// pure rest by tools/validate-citations.js.
module.exports = {
  extractCitation, stpjsBodyPassage, decompressTalk, stripTags, decodeEntities, toChurchUrl, excerptChars,
  packDescriptor, parseInclusion, citeRecord, bundlesTalks, conferenceOf, PACK_CORPORA,
};

// ---- main ----
if (require.main === module) {
  if (!PACK_OUT[PACK]) {
    console.error(`ERROR: --pack must be one of ${Object.keys(PACK_OUT).join(', ')} (got ${PACK})`);
    process.exit(2);
  }
  const inclusion = parseInclusion(arg('--inclusion'));
  if (inclusion.error) {
    console.error(`ERROR: ${inclusion.error}`);
    process.exit(2);
  }
  // The verbatim matcher is a later ticket (#72); until it lands only 'all' builds.
  const unbuilt = Object.entries(inclusion.rules).filter(([, rule]) => rule !== 'all');
  if (unbuilt.length) {
    console.error(`ERROR: inclusion rule verbatim is not built yet (${unbuilt.map(([c]) => c).join(', ')}); see issue #72`);
    process.exit(2);
  }
  const core = openDb(CORE);
  const content = openDb(CONTENT);
  if (INSPECT) inspect(core, content);
  else build(core, content, inclusion.rules);
  core.close();
  content.close();
}
