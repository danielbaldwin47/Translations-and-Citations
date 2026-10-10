#!/usr/bin/env node
/*
 * Derivation run (spec #69 "Build"; GLOSSARY.md "Derivation run", "Derived
 * cite"): one General Conference's talk pages -> the cached input that
 * tools/build-citation-data.js turns into derived cites. Run once per
 * conference newer than the BYU base (the pack-refresh checklist,
 * docs/agents/pack-refresh.md).
 *
 *   node --experimental-sqlite tools/derive-conference.js 2026-10
 *   node --experimental-sqlite tools/derive-conference.js 2026-10 --from-dir ~/saved/2026-10
 *   options: --out DIR (default source-data/derived), --core DB (default
 *   source-data/core.53.db; read for chapter verse counts only), --scripture DIR
 *   (default source-data/scripture; the public-domain texts the footnote-cite
 *   rule reads, recipe in tools/build-citation-data.js's header; a missing
 *   one stops the run before any request)
 *
 * Fetch etiquette (the go/no-go's derivation-fetch conditions, issue #61):
 *   - Single conference: the conference page and that conference's talks,
 *     nothing else — about 40 requests per run.
 *   - One request at a time, with a PAUSE_MS pause before every request after
 *     the first.
 *   - One fixed, plain user agent (USER_AGENT), the same on every request.
 *   - The endpoint is the Church content endpoint the site's own page loads
 *     (/study/api/v3/language-pages/type/content?lang=eng&uri=…).
 * Saved-pages mode (--from-dir): no network at all. The owner opens each
 * talk in a browser and saves the page (.html) into one directory; the tool
 * reads every .html there and keeps the talks of the named conference. This
 * is the fallback that stays inside the letter of the Church's terms; both
 * modes yield the same input for the same pages.
 *
 * No Church text is kept: responses live in memory for the run; the output
 * holds per talk its derived id (gc/YYYY/MM/{slug}), URL, speaker, title,
 * conference, label and revision (bibliographic facts), and per cite its
 * verse reference in the shard's form, the paragraph anchor, the excerpt
 * character count, whether it sits in a note and the footnote flag. Idempotent per conference: a run rewrites that
 * conference's file whole, and the same pages give the same file.
 *
 * Output: {out}/gc-YYYY-MM.json
 *   { conference:'YYYY-MM', source:'church'|'saved-pages',
 *     talks:[{ id, url, sp, ti, d, lbl, rev, cites:[{ id, book, chapter, v, a, ec, note?, fn? }] }] }
 *
 * Derivation rules (measured in issue #64): scripture links in body
 * paragraphs and in footnotes; plain-text references in footnote text (other
 * versions, the Joseph Smith Translation's Bible verse); chapter spans and
 * ranges that run into the next chapter. A cite sits at its paragraph anchor:
 * the body paragraph holding the link, or for a footnote the paragraph
 * holding the note's first marker. Links into books the pack lacks (jst-*,
 * study helps) and chapters the book lacks are ignored. The same reference
 * twice at one anchor is one cite, the first in reading order (a body link
 * before a note's). Body prose is not read for references.
 *
 * Notes and footnote cites: a cite whose reference was found in one of the
 * page's notes (a link in a note, or a note's plain text) is `note: true`;
 * it is also `fn: true`, the shard's flag, when it is a footnote cite
 * (GLOSSARY.md "Footnote cite"; tools/footnote-cite.js states the rule, the
 * same one the build applies to BYU's cites). The rule reads the note and the
 * text of its marker's paragraph, so it runs here, while the page is in
 * memory: the file keeps no text to run it on later. A body link's cite has
 * neither key, never false. A file written before `note` existed carries
 * `fn` on every cite in a note, until the conference is derived again.
 * The pure core is exported for tools/validate-derivation.js.
 *
 * The page reading is the reader's (src/citations/talk-source.js, required
 * here): its tag scanner (scanTalk), entity decoding, verse-id parsing and
 * scripture-link parsing (scriptureLink). Where a link's chapter span covers
 * more than its chapter, the derivation applies linkChapters' 'derive' rule,
 * the footnote locator its 'locate' rule; talk-source states both together.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const BOOKS = require('../src/shared/books.js');

// ---- talk HTML ----

// The reader's talk-page reading, shared (talk-source's "HTML scanning").
const { decodeEntities, attrsOf, textOf, withoutRawText, scanTalk, scriptureLink, linkChapters, replaceElements } =
  require('../src/citations/talk-source.js');
const footnoteRule = require('./footnote-cite.js');

// The content endpoint's JSON -> one talk page as HTML: the body, then each
// footnote as <li id="noteN"> (the shape a saved page has).
function pageFromApi(json) {
  const c = (json && json.content) || {};
  const notes = Array.isArray(c.footnotes) ? c.footnotes : Object.values(c.footnotes || {});
  const items = notes.map((n) => `<li id="${n.id}">${n.text || ''}</li>`).join('');
  const page = (json && json.meta && json.meta.pageAttributes) || {};
  const attr = (k) => String(page[k] == null ? '' : page[k]).replace(/[&"<>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<article data-uri="${attr('data-uri')}" data-aid-version="${attr('data-aid-version')}" data-content-type="${attr('data-content-type')}">` +
    `${c.body || ''}<footer class="notes"><ol>${items}</ol></footer></article>`;
}

const ORIGIN = 'https://www.churchofjesuschrist.org';
const MONTHS = { '04': 'April', '10': 'October' };

// A talk's Church path -> its derived talk id (spec #69: talk ids never
// change; a derived talk's is its Church slug): '/general-conference/2026/10/12gong'
// or a full study URL -> 'gc/2026/10/12gong'; null for anything else.
function derivedTalkId(uriOrUrl) {
  let path;
  try { path = new URL(String(uriOrUrl || ''), ORIGIN).pathname; } catch (e) { return null; }
  const m = /^(?:\/study)?\/general-conference\/(\d{4})\/(\d{2})\/([a-z0-9-]+)\/?$/.exec(path);
  return m ? `gc/${m[1]}/${m[2]}/${m[3]}` : null;
}

// The speaker as the pack names them: the byline without "By" and the calling.
function speakerOf(byline) {
  return textOf(byline)
    .replace(/^(?:presented\s+)?by\s+/i, '')
    .replace(/^(?:elder|president|sister|brother|bishop)\s+/i, '') || 'Unknown';
}

// One talk page (a saved page, or pageFromApi's) -> the conference input's
// talk record, or null when the page is not a talk of `conference` ('YYYY-MM').
//   { id, url, sp, ti, d, lbl, rev, cites:[{ book, chapter, v, a, ec }] }
function talkRecord(html, conference, ctx) {
  const page = withoutRawText(html);
  const art = /<article\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(page);
  const attrs = art ? attrsOf(art[1]) : {};
  const [y, mo] = String(conference).split('-');
  const uri = attrs['data-uri'] || '';
  if (attrs['data-content-type'] !== 'general-conference-talk' || !uri.startsWith(`/general-conference/${y}/${mo}/`)) return null;
  const id = derivedTalkId(uri);
  if (!id) return null;
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(page);
  const by = /<p\b[^>]*class="[^"]*\bauthor-name\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(page);
  return {
    id,
    url: `${ORIGIN}/study${uri}?lang=eng`,
    sp: by ? speakerOf(by[1]) : 'Unknown',
    ti: h1 ? textOf(h1[1]) : '',
    d: `${y}-${mo}`,
    lbl: `${MONTHS[mo] || mo} ${y} General Conference`,
    rev: attrs['data-aid-version'] || '',
    cites: deriveTalk(page, ctx).cites,
  };
}

// One pass over a talk page (talk-source's scanTalk): body paragraphs' text
// by id, each note's first marker paragraph, every scripture link with where
// it sits, and each footnote's text.
function scan(html) {
  const { text, paras, notes, markerAt, links } = scanTalk(html);
  const paraText = {};
  for (const [id, p] of Object.entries(paras)) paraText[id] = textOf(text.slice(p.start, p.end));
  const noteText = {};
  for (const [id, n] of Object.entries(notes)) noteText[id] = textOf(text.slice(n.start, n.end).replace(/<[^>]*>/g, ' '));
  const paraOfNote = {};
  for (const [id, at] of Object.entries(markerAt)) paraOfNote[id] = at.para;
  return { paraText, markerAt: paraOfNote, links, noteText, page: { text, paras, notes, markerAt } };
}

// A paragraph slice's text as the footnote-cite rule reads it: note markers
// and scripture-link labels dropped, as the build drops BYU's labels.
const isLabelOrMarker = (open) => /^<a\b[^>]*class="[^"]*\b(?:note-ref|scripture-ref)\b/i.test(open);
const bodyText = (html) => textOf(replaceElements(html, isLabelOrMarker));

// Whether a link's references include the cite r (same chapter, a verse in common).
function linkHits(href, label, r) {
  return linkRefs(href, label).some((x) => x.book === r.book && x.chapter === r.chapter &&
    (!x.verses || !r.verses || x.verses.some((v) => r.verses.includes(v))));
}

// The footnote-cite rule's verdict (tools/footnote-cite.js) for cite r found
// in note `note`: the note as parts, each scripture link own when it names
// the cite, and the text of the marker's paragraph before and after the
// marker. Decided here, while the page is in memory: the input keeps no text.
function isFootnoteCite(page, note, r, verses, footnotes) {
  const refs = [];
  const n = page.notes[note];
  const marked = replaceElements(page.text.slice(n.start, n.end), (o) => /^<a\b[^>]*class="[^"]*\bscripture-ref\b/i.test(o), (open, inner) => {
    refs.push({ own: linkHits(decodeEntities(attrsOf(open.slice(2, -1)).href || ''), inner, r), label: textOf(inner) });
    return ` ⟦${refs.length - 1}⟧ `;
  });
  const parts = textOf(marked).split(/(⟦\d+⟧)/).filter(Boolean).map((p) => (/^⟦\d+⟧$/.test(p) ? refs[Number(p.slice(1, -1))] : p));
  const at = page.markerAt[note];
  const para = page.paras[at.para];
  return footnoteRule.footnoteCite({
    note: parts, before: bodyText(page.text.slice(para.start, at.pos)), after: bodyText(page.text.slice(at.pos, para.end)),
    slug: r.book, ch: r.chapter, verses,
  }, footnotes).fn;
}

// Sorted verse numbers -> the shard's form, '1-3,14'.
function verseForm(list) {
  const parts = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(j > i ? `${list[i]}-${list[j]}` : String(list[i]));
    i = j + 1;
  }
  return parts.join(',');
}

// A scripture link -> [{ book, chapter, verses:[...] | null (whole chapter) }]
// for a book the pack carries, else [] (the Joseph Smith Translation, the
// Topical Guide). A chapter link whose label ends in a chapter span starting
// at its chapter ("3 Nephi 11–26") is every chapter of the span
// (linkChapters' 'derive' rule).
function linkRefs(href, label) {
  const t = scriptureLink(href, label);
  if (!t || !BOOKS.isKnownBook(t.volume, t.book)) return [];
  if (t.verses) return [{ book: t.book, chapter: t.chapter, verses: t.verses }];
  const [from, to] = linkChapters(t, 'derive');
  const out = [];
  for (let c = from; c <= to; c++) out.push({ book: t.book, chapter: c, verses: null });
  return out;
}

// Book names a footnote's plain text may use -> slug: every full name the
// pack's books carry, plus the short forms talks print.
const NAME_TO_SLUG = (() => {
  const out = {};
  for (const names of [BOOKS.BIBLE_NAMES, BOOKS.NON_BIBLE_NAMES]) {
    for (const [slug, name] of Object.entries(names)) out[name.toLowerCase()] = slug;
  }
  Object.assign(out, {
    psalm: 'ps', 'd&c': 'dc', 'doctrine & covenants': 'dc',
    'joseph smith-history': 'js-h', 'joseph smith-matthew': 'js-m',
  });
  return out;
})();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = Object.keys(NAME_TO_SLUG).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
// name chapter, then a chapter span (–D), or :verses — each verse item a
// verse or range, a range may run into the next chapter (32:42–33:1); a
// comma item is a verse only when no capitalized word follows (", 1 Nephi").
const VERSE_ITEM = '\\d+(?:\\s*[–—-]\\s*\\d+(?::\\d+)?)?';
const TEXT_REF = new RegExp(
  `(?:^|[^A-Za-z&])(${NAME_RE})\\s+(\\d+)(?:\\s*[–—-]\\s*(\\d+)(?!\\s*:)|:(${VERSE_ITEM}(?:\\s*,\\s*${VERSE_ITEM}(?!\\s+[A-Z]))*))?`,
  'gi');

// Plain text -> [{ book, chapter, verses:[...] | null }].
function textRefs(text, verseCount) {
  const out = [];
  TEXT_REF.lastIndex = 0;
  for (let m; (m = TEXT_REF.exec(text));) {
    const book = NAME_TO_SLUG[m[1].toLowerCase().replace(/—/g, '-')] || NAME_TO_SLUG[m[1].toLowerCase()];
    const chapter = Number(m[2]);
    if (!book) continue;
    if (m[3]) { // chapter span
      const to = Number(m[3]);
      for (let c = chapter; c <= to && to - chapter < 200; c++) out.push({ book, chapter: c, verses: null });
      continue;
    }
    if (!m[4]) { out.push({ book, chapter, verses: null }); continue; }
    const here = new Set();
    const next = [];        // a range running into the next chapter: { chapter, verses }
    for (const item of m[4].split(',')) {
      const r = /^\s*(\d+)(?:\s*[–—-]\s*(\d+)(?::(\d+))?)?\s*$/.exec(item);
      if (!r) continue;
      const from = Number(r[1]);
      const to = r[3] ? verseCount(book, chapter) || from : r[2] ? Number(r[2]) : from;
      for (let v = from; v <= to && v - from < 500; v++) here.add(v);
      if (r[3]) next.push({ book, chapter: Number(r[2]), verses: Array.from({ length: Number(r[3]) }, (_, k) => k + 1) });
    }
    if (here.size) out.push({ book, chapter, verses: [...here].sort((a, b) => a - b) });
    out.push(...next);
  }
  return out;
}

// One talk page -> { cites: [{ book, chapter, v, a, ec, note?, fn? }] } in reading order.
//   note  true when the reference was found in one of the page's notes (a link
//         in a note, or a note's plain text); absent for a body link, never false
//   fn    true when that cite is a footnote cite (tools/footnote-cite.js); absent otherwise
//   ctx.verseCount(book, chapter) -> the chapter's verse count (whole-chapter cites)
//   ctx.footnotes  footnote-cite.js's footnoteContext over the scripture inputs
function deriveTalk(html, ctx) {
  if (!ctx.footnotes) throw new Error('deriveTalk needs ctx.footnotes (footnote-cite.js footnoteContext) to decide fn');
  const { paraText, markerAt, links, noteText, page } = scan(html);
  const cites = [];
  const seen = new Set();
  // A chapter the book lacks is no cite; verses past its end are dropped.
  const add = (r, a, note) => {
    const n = ctx.verseCount(r.book, r.chapter);
    if (!n) return;
    const verses = r.verses ? r.verses.filter((x) => x >= 1 && x <= n) : null;
    if (verses && !verses.length) return;
    const v = verses ? verseForm(verses) : `1-${n}`;
    const key = `${a} ${r.book} ${r.chapter}:${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    const cite = { book: r.book, chapter: r.chapter, v, a, ec: paraText[a].length };
    if (note) {
      cite.note = true;
      if (isFootnoteCite(page, note, r, verses || Array.from({ length: n }, (_, k) => k + 1), ctx.footnotes)) cite.fn = true;
    }
    cites.push(cite);
  };
  const linked = {};         // 'anchor book chapter' -> Set of verses, or true (whole chapter)
  for (const l of links) {
    const a = l.note ? markerAt[l.note] : l.para;
    if (!a) continue;
    for (const r of linkRefs(l.href, l.label)) {
      add(r, a, l.note);
      const k = `${a} ${r.book} ${r.chapter}`;
      if (!r.verses) linked[k] = true;
      else if (linked[k] !== true) { linked[k] = linked[k] || new Set(); r.verses.forEach((v) => linked[k].add(v)); }
    }
  }
  // Footnote text: references a link of the same note's paragraph does not
  // already cover (other versions, the Joseph Smith Translation, unlinked spans).
  for (const [note, text] of Object.entries(noteText)) {
    const a = markerAt[note];
    if (!a) continue;
    for (const r of textRefs(text, ctx.verseCount)) {
      const have = linked[`${a} ${r.book} ${r.chapter}`];
      if (have === true || (have && r.verses && r.verses.every((v) => have.has(v)))) continue;
      add(r, a, note);
    }
  }
  return { cites };
}

// The conference page's body -> its talks' Church paths, in page order, once
// each; session pages and links outside the conference are not talks.
function talkList(confHtml, conference) {
  const [y, mo] = String(conference).split('-');
  const out = [];
  for (const m of String(confHtml || '').matchAll(/href="([^"]+)"/g)) {
    let path;
    try { path = new URL(decodeEntities(m[1]), ORIGIN).pathname.replace(/^\/study/, ''); } catch (e) { continue; }
    const t = new RegExp(`^/general-conference/${y}/${mo}/([a-z0-9-]+)$`).exec(path);
    if (t && !/-session$/.test(t[1]) && !out.includes(path)) out.push(path);
  }
  return out;
}

// Talk records -> the conference's cached input, the same whatever order the
// pages were read in: talks sorted by id, each cite numbered
// YYYYMM·NNNNN (20261000001…), which no BYU citation id (six digits at most)
// or other conference can reach. `source`: 'church' (the content endpoint) or
// 'saved-pages' (--from-dir).
function conferenceInput(conference, records, source) {
  const base = Number(String(conference).replace('-', '')) * 100000;
  let seq = 0;
  const talks = records.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((t) => Object.assign({}, t, {
    cites: t.cites.map((c) => Object.assign({ id: base + ++seq }, c)),
  }));
  return { conference, source, talks };
}

module.exports = { pageFromApi, deriveTalk, talkRecord, derivedTalkId, talkList, conferenceInput };

// ---- run ----

const PAUSE_MS = 5000;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130';
const CONTENT_API = `${ORIGIN}/study/api/v3/language-pages/type/content?lang=eng&uri=`;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// slug -> chapter -> verse count, from the BYU base's scripture table
// (verse 1000, a chapter's closing note, is not a verse).
function verseCounter(coreFile) {
  if (!fs.existsSync(coreFile)) throw new Error(`database not found: ${coreFile} (verse counts come from it)`);
  const { DatabaseSync } = require('node:sqlite');
  const { buildBookMap } = require('./build-citation-data.js');
  const core = new DatabaseSync(coreFile, { readOnly: true });
  const counts = {};
  const stmt = core.prepare('SELECT Chapter AS c, MAX(Verse) AS n FROM scripture WHERE BookID = ? AND Verse < 1000 GROUP BY Chapter');
  for (const [slug, b] of Object.entries(buildBookMap(core))) {
    counts[slug] = {};
    for (const r of stmt.all(b.bookId)) counts[slug][r.c] = r.n;
  }
  core.close();
  return (book, chapter) => (counts[book] && counts[book][chapter]) || null;
}

// One request at a time: a pause before every request but the first.
let requests = 0;
async function getJson(uri) {
  if (requests++) await sleep(PAUSE_MS);
  const res = await fetch(CONTENT_API + encodeURIComponent(uri).replace(/%2F/g, '/'), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${uri}`);
  return res.json();
}

async function fromChurch(conference, ctx) {
  const [y, mo] = conference.split('-');
  const conf = await getJson(`/general-conference/${y}/${mo}`);
  const uris = talkList(conf && conf.content && conf.content.body, conference);
  if (!uris.length) throw new Error(`the conference page lists no talks for ${conference}`);
  console.log(`${conference}: ${uris.length} talks listed; fetching one at a time, ${PAUSE_MS / 1000}s apart.`);
  const records = [];
  for (const uri of uris) {
    const rec = talkRecord(pageFromApi(await getJson(uri)), conference, ctx);
    if (rec) records.push(rec);
    console.log(`  ${uri}: ${rec ? `${rec.cites.length} cites` : 'not a talk page, skipped'}`);
  }
  return records;
}

function fromDir(dir, conference, ctx) {
  const records = [];
  const seen = new Set();
  let skipped = 0;
  for (const f of fs.readdirSync(dir).filter((n) => /\.html?$/i.test(n)).sort()) {
    const rec = talkRecord(fs.readFileSync(path.join(dir, f), 'utf8'), conference, ctx);
    if (!rec || seen.has(rec.id)) { skipped++; continue; }
    seen.add(rec.id);
    records.push(rec);
    console.log(`  ${f}: ${rec.id}, ${rec.cites.length} cites`);
  }
  console.log(`${conference}: ${records.length} talk pages read from ${dir}; ${skipped} other files skipped.`);
  return records;
}

async function main() {
  const conference = process.argv[2];
  if (!/^\d{4}-(04|10)$/.test(conference || '')) {
    console.error('usage: node --experimental-sqlite tools/derive-conference.js YYYY-04|YYYY-10 [--from-dir DIR] [--out DIR] [--core DB] [--scripture DIR]');
    process.exit(2);
  }
  const root = path.resolve(__dirname, '..');
  const out = arg('--out', path.join(root, 'source-data', 'derived'));
  const dir = arg('--from-dir');
  const scripture = arg('--scripture', path.join(root, 'source-data', 'scripture'));
  const ctx = {
    verseCount: verseCounter(arg('--core', path.join(root, 'source-data', 'core.53.db'))),
    footnotes: footnoteRule.footnoteContext(require('./verbatim-matcher.js').loadScripture(scripture)),
  };
  const records = dir ? fromDir(dir, conference, ctx) : await fromChurch(conference, ctx);
  if (!records.length) throw new Error(`no talk of ${conference} was read; nothing written`);
  const input = conferenceInput(conference, records, dir ? 'saved-pages' : 'church');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `gc-${conference}.json`);
  fs.writeFileSync(file, JSON.stringify(input, null, 1) + '\n');
  const all = input.talks.flatMap((t) => t.cites);
  console.log(`Wrote ${file}: ${input.talks.length} talks, ${all.length} derived cites ` +
    `(${all.filter((c) => c.note).length} in a note, ${all.filter((c) => c.fn).length} footnote cites).`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`ERROR: ${e.message}`);
    if (/^scripture input/.test(e.message)) console.error('The footnote-cite rule reads these public-domain texts to decide each note cite\'s fn.');
    process.exit(1);
  });
}
