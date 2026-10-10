#!/usr/bin/env node
/*
 * Build the Journal of Discourses (corpus J) talks from Wikisource text.
 *
 * Inputs (all cached build inputs, read offline):
 *   source-data/wikisource-jod.json   the Wikisource snapshot, pinned revisions
 *                                     (tools/fetch-jod-wikisource.js writes it)
 *   source-data/core.53.db, content.53.db
 *                                     the BYU DBs: which J talks exist, each cite's
 *                                     id and printed page, and BYU's talk HTML as an
 *                                     ALIGNMENT INPUT ONLY (where BYU put each cite
 *                                     in the words; no BYU text is written out)
 *   tools/jod-patches.json            the local patch file: the talks where BYU's copy
 *                                     and Wikisource's page are not the same printed
 *                                     item (see "Patch file")
 * Output (a cached build input for tools/build-citation-data.js, which
 * bundles it into the pack):
 *   source-data/jod-talks/talks/{talkId}.html   one talk's HTML
 *   source-data/jod-talks/talks.json            { [talkId]: { url, cites: { [citId]: { sn, a? } } } }
 *   source-data/jod-talks/provenance.json       { [talkId]: provenance row }
 *
 * Run (Node 22+, no npm install):
 *   node tools/fetch-jod-wikisource.js                       (network; once per refresh)
 *   node --experimental-sqlite tools/build-jod-talks.js      (offline)
 *   node --experimental-sqlite tools/build-citation-data.js  (bundles the result)
 *
 * Per talk:
 *   1. Join (joinTalk). A talk's key is (volume, start page): volume =
 *      floor(talkId / 10000), start page from BYU's `<title>JD v:p, …`. A
 *      Wikisource subpage matches on its volume and its first page break, else
 *      on the start of the range its volume page lists. Accepted only when the
 *      text gate passes: at least GATE of BYU's word 5-grams occur in the
 *      Wikisource text (after any patch). Words compare in alignment form
 *      (alignTokens: Liverpool spellings and split compounds as BYU's modern ones).
 *   2. Body. Paragraphs from blank lines; each `{{page break|N}}` (or
 *      `{{pagenum|N}}`, or a scan's page-number span) becomes an empty
 *      `<span class="jodPage" id="jdp-N">`; italics stay. A page that runs on
 *      past the end page its volume page lists into text BYU does not have is
 *      cut there (trimToRange). Contributor additions
 *      are dropped: the header's scan note, author links, categories,
 *      `{{similar}}`, `{{other versions}}`, and `{{SIC|printed|corrected}}`
 *      keeps the printed word.
 *   3. Markers. Each cite's `<span class="citation" id="{citId}"></span>` goes
 *      where BYU's sits, carried across by word alignment: it is placed only
 *      when the 4 words before BYU's span lie inside one exactly matching run
 *      of words. Otherwise the cite gets its printed page's anchor (`a: 'jdp-N'`).
 *   4. Snippet. Re-cut from the Wikisource text around the marker (or the
 *      aligned position nearest it), never from BYU's.
 *   5. Provenance. One row per talk: Wikisource title, revid, timestamp, sha1,
 *      the bundled file's SHA-256, page range, text-gate score, how each cite
 *      was placed, the scan pages' revids for a scan-backed page, and the patch
 *      it took, if any.
 *
 * Patch file (tools/jod-patches.json): a JSON array, one entry per talk whose
 * text gate fails because BYU's copy is not the printed item Wikisource's page
 * is. Each entry is one of
 *   { talkId, append: '<Wikisource title>', note }
 *       BYU files a separately printed item under this talk; the named
 *       Wikisource page is appended at its snapshot revision (its heading kept).
 *   { talkId, byuOnly: { from, to }, note }
 *       BYU's copy holds a passage the print does not (from phrase `from`
 *       through phrase `to`, BYU's words); it is left out of the text gate.
 *       Nothing is added; cites inside it fall back to their page.
 * `note` says what differs and how it was checked against the scan; it is
 * written into the talk's provenance row with the patch. The build fails when
 * a patch does not apply. Both 2026 entries were checked against the
 * archive.org scan's OCR: Wikisource follows the print in each.
 * A passage missing from Wikisource itself would need a third kind (a
 * transcription inserted with its own provenance); no talk needs one today.
 *
 * The pure core is exported for tools/validate-jod.js.
 */
'use strict';

const BUILD = require('./build-citation-data.js'); // decompressTalk
const { decodeEntities } = require('../src/citations/talk-source.js');

/* ---------------------------------------------------------------- wikitext */

// The index of the `}}` closing the template that opens at `start`, or -1.
function templateEnd(s, start) {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; i++; continue; }
    if (s[i] === '}' && s[i + 1] === '}') { depth--; i++; if (depth === 0) return i - 1; }
  }
  return -1;
}

// Split a template's inner text on the `|` that sit outside nested {{ }} and [[ ]].
function splitTopLevel(inner) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; continue; }
    if (inner[i] === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  out.push(cur);
  return out;
}

// Wiki links and external links as their visible text; categories gone.
function linkText(s) {
  return String(s)
    .replace(/\[\[\s*Category:[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1');
}

const plainLine = (s) => linkText(s).replace(/'{2,}/g, '').replace(/\s+/g, ' ').trim();

// The header template's fields and the page body after it.
function splitHeader(wikitext) {
  const s = String(wikitext || '');
  const m = /\{\{\s*header\b/i.exec(s);
  if (!m) return { fields: {}, body: s };
  const end = templateEnd(s, m.index);
  if (end < 0) return { fields: {}, body: s };
  const parts = splitTopLevel(s.slice(m.index + 2, end)).slice(1);
  const fields = {};
  for (const p of parts) {
    const eqAt = p.indexOf('=');
    if (eqAt < 0) continue;
    fields[p.slice(0, eqAt).trim().toLowerCase()] = p.slice(eqAt + 1).trim();
  }
  return { fields, body: s.slice(0, m.index) + s.slice(end + 2) };
}

// The printed heading: the header's section, without the volume link before it.
function headingOf(fields) {
  return plainLine(fields.section || '').replace(/^Volume \d+,\s*/i, '');
}

// The printed subtitle: the header's notes, without the contributor's
// "(Online document scan of …)" line.
function subtitleOf(fields) {
  return String(fields.notes || '').split('\n')
    .filter((line) => !/Online document scan/i.test(line))
    .map(plainLine).filter(Boolean).join(' ');
}

// Inline wikitext of the body as a stream of text and marks.
//   { text } | { page: N } | { em: true }   (em toggles italics)
const INLINE = new RegExp([
  String.raw`\{\{\s*(?:page break|pagenum)\s*\|\s*(\d+)\s*(?:\|[^{}]*)?\}\}`, // 1: page break
  String.raw`\{\{\s*page break\s*\|\s*(\d+)\s*\]?`, // 2: a page break whose braces were lost
  String.raw`\{\{\s*(?:sic|tooltip)\s*\|([^|{}]*)(?:\|[^{}]*)?\}\}`, // 3: printed word of a [sic] / tooltip
  String.raw`\{\{[^{}]*\}\}`, // any other template: a contributor addition
  String.raw`''`, // italics
].join('|'), 'gi');

function inlineStream(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[1] || m[2]) out.push({ page: Number(m[1] || m[2]) });
    else if (m[3] != null) out.push({ text: m[3] });
    else if (m[0] === "''") out.push({ em: true });
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// Paragraphs from a stream of text and marks, one array of items per
// paragraph; whitespace collapses, marks keep their character positions.
//   para { text, marks:[{ at, page } | { at, em:'open'|'close' }] }
function paragraphsFrom(blocks) {
  const paras = [];
  let carry = []; // marks of a paragraph with no text, moved to the next one
  for (const items of blocks) {
    let text = '';
    const marks = carry.map((m) => Object.assign({}, m, { at: 0 }));
    let inEm = false;
    for (const it of items) {
      if (it.text != null) {
        let t = it.text.replace(/\s+/g, ' ');
        if ((text === '' || text.endsWith(' ')) && t.startsWith(' ')) t = t.slice(1);
        text += t;
      } else if (it.page != null) {
        marks.push({ at: text.length, page: it.page });
      } else if (it.em) {
        inEm = !inEm;
        marks.push({ at: text.length, em: inEm ? 'open' : 'close' });
      }
    }
    if (inEm) marks.push({ at: text.length, em: 'close' });
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) { carry = marks.filter((m) => m.page != null); continue; }
    for (const m of marks) if (m.at > trimmed.length) m.at = trimmed.length;
    paras.push({ text: trimmed, marks: dropEmptyEm(marks) });
    carry = [];
  }
  if (carry.length && paras.length) {
    const lastPara = paras[paras.length - 1];
    for (const m of carry) lastPara.marks.push(Object.assign({}, m, { at: lastPara.text.length }));
  }
  return paras;
}

// An italic run with no text in it is no run.
function dropEmptyEm(marks) {
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const next = marks[i + 1];
    if (m.em === 'open' && next && next.em === 'close' && next.at === m.at) { i++; continue; }
    out.push(m);
  }
  return out;
}

// A Wikisource subpage's wikitext as a talk document:
//   { heading, subtitle, paras:[{ text, marks }] }
function wikiDoc(wikitext) {
  const { fields, body } = splitHeader(wikitext);
  const kept = String(body)
    .split('\n')
    .filter((line) => !/^\s*\*\s*\[\[/.test(line)) // a list of links to other discourses
    .join('\n');
  const blocks = linkText(kept).split(/\n[ \t]*\n/).map(inlineStream);
  return { heading: headingOf(fields), subtitle: subtitleOf(fields), paras: paragraphsFrom(blocks) };
}

// A scan-backed subpage (`<pages index=…>`) as a talk document: the heading
// from its own wikitext's header, the paragraphs from the rendered HTML of the
// transcluded Page-namespace pages (the snapshot's `scan.html`), whose
// page-number spans carry the printed page. Only the `prp-pages-output` block
// counts; the rendered header and navigation around it are contributor chrome.
function scanDoc(html, wikitext) {
  const { fields } = splitHeader(wikitext);
  const s = String(html || '');
  const at = s.indexOf('class="prp-pages-output"');
  const pages = at < 0 ? '' : s.slice(s.lastIndexOf('<', at));
  const asWikitext = pages
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<span\b[^>]*class="pagenum-inner[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<span\b[^>]*data-page-number="(\d+)"[^>]*>/gi, '{{page break|$1}}')
    .replace(/<\/?i\b[^>]*>/gi, "''")
    .replace(/<\/?(?:p|div|hr|br|h\d|li|ul|ol|table|tr|td)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  const blocks = decodeEntities(asWikitext).replace(/​/g, '').split(/\n[ \t]*\n/).map(inlineStream);
  return { heading: headingOf(fields), subtitle: subtitleOf(fields), paras: paragraphsFrom(blocks) };
}

// The printed pages a document runs over, ascending.
function pagesOf(doc) {
  const set = new Set();
  for (const p of doc.paras) for (const m of p.marks) if (m.page != null) set.add(m.page);
  return [...set].sort((a, b) => a - b);
}

// The page in force at character `at` of paragraph `pi`: the last page break
// at or before it, else the document's first page.
function pageAt(doc, pi, at) {
  let page = null;
  for (let i = 0; i <= pi && i < doc.paras.length; i++) {
    for (const m of doc.paras[i].marks) {
      if (m.page == null) continue;
      if (i < pi || m.at <= at) page = m.page;
    }
  }
  return page == null ? (pagesOf(doc)[0] || null) : page;
}

// The document with everything from page `endPage + 1` on removed: a
// Wikisource page that runs on into the next discourse is cut at the end page
// its volume page lists.
function cutAfterPage(doc, endPage) {
  const paras = [];
  for (const p of doc.paras) {
    const stop = p.marks.find((m) => m.page != null && m.page > endPage);
    if (!stop) { paras.push(p); continue; }
    const text = p.text.slice(0, stop.at).replace(/\s+$/, '');
    if (text) paras.push({ text, marks: p.marks.filter((m) => m.at < stop.at || (m.at === stop.at && m.em === 'close')) });
    break;
  }
  return Object.assign({}, doc, { paras });
}

// Page ranges a volume page lists for its discourses:
// `*[[/Salvation|Salvation]] by Brigham Young (1-6)` -> 'Salvation' => [1, 6].
function volumeRanges(volumeWikitext) {
  const out = new Map();
  for (const m of String(volumeWikitext || '').matchAll(/\[\[\/([^\]|]+)(?:\|[^\]]*)?\]\][^\n(]*\((\d+)\s*[-–]\s*(\d+)\)/g)) {
    out.set(m[1].trim(), [Number(m[2]), Number(m[3])]);
  }
  return out;
}

// The document with another Wikisource page's document after it: its printed
// heading and subtitle as heading paragraphs, then its paragraphs.
function appendDoc(doc, other) {
  const head = [];
  if (other.heading) head.push({ text: other.heading, marks: [], cls: 'jodHeading' });
  if (other.subtitle) head.push({ text: other.subtitle, marks: [], cls: 'jodSubtitle' });
  return Object.assign({}, doc, { paras: doc.paras.concat(head, other.paras) });
}

// The word range [from, to) of `words` running from the phrase `from` through
// the phrase `to` (both in alignment form), or null.
function phraseRange(words, from, to) {
  const seq = (s) => alignTokens(String(s).split(/\s+/).map((raw) => ({ raw, end: 0 }))).map((t) => t.n);
  const find = (needle, start) => {
    for (let i = start; i + needle.length <= words.length; i++) {
      if (needle.every((w, k) => words[i + k] === w)) return i;
    }
    return -1;
  };
  const a = seq(from);
  const b = seq(to);
  const i = a.length ? find(a, 0) : -1;
  const j = i < 0 || !b.length ? -1 : find(b, i);
  return j < 0 ? null : [i, j + b.length];
}

/* --------------------------------------------------------------- alignment */

// Words as alignment compares them, on both sides alike: case and
// punctuation aside, words split at dashes and hyphens, and the Liverpool
// printing's spellings in BYU's modern forms (the text itself is never
// changed; this is only how two copies are matched word for word).
const SPELLINGS = {
  fulness: 'fullness', vail: 'veil', vails: 'veils', melchisedec: 'melchizedek', melchisedek: 'melchizedek',
  kanyon: 'canyon', kanyons: 'canyons', byeword: 'byword', shew: 'show', shewed: 'showed', shewn: 'shown',
  shewing: 'showing', connexion: 'connection', connexions: 'connections',
};
// Two words BYU writes as one ("to day" -> "today").
const COMPOUNDS = new Set([
  'today', 'tomorrow', 'tonight', 'forever', 'cannot', 'everything', 'anything', 'something', 'everyone',
  'anyone', 'someone', 'everywhere', 'seashore', 'thunderstorm', 'byword', 'sometimes', 'anywhere',
]);
function canon(w) {
  const n = String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (SPELLINGS[n]) return SPELLINGS[n];
  return n
    .replace(/^(.{3,})our(s|ed|ing|able|ably|er|ers|ite|ites)?$/, '$1or$2') // labour, saviour, favourable
    .replace(/([aeiou])ll(ed|ing|er|ers|ous)$/, '$1l$2'); // travelled, marvellous
}

// [{ raw, end } | { cite }] -> [{ n, end } | { cite }]: words in their compared
// form, a word pair BYU joins merged into one (ending where its second half
// ends). A cite marker is never merged across.
function alignTokens(raw) {
  const out = [];
  for (const t of raw) {
    if (t.cite != null) { out.push(t); continue; }
    for (const part of String(t.raw).split(/[—–-]+/)) {
      const n = canon(part);
      if (!n) continue;
      const prev = out[out.length - 1];
      if (prev && prev.n != null && !prev.merged && COMPOUNDS.has(prev.n + n)) {
        prev.n = SPELLINGS[prev.n + n] || prev.n + n;
        prev.end = t.end;
        prev.merged = true;
        continue;
      }
      out.push({ n, end: t.end });
    }
  }
  for (const t of out) delete t.merged;
  return out;
}

// The document's words, each with its paragraph and the character offset just
// after it (where a marker following the word goes).
function docWords(doc) {
  const out = [];
  doc.paras.forEach((p, pi) => {
    const raw = [...p.text.matchAll(/\S+/g)].map((m) => ({ raw: m[0], end: m.index + m[0].length }));
    for (const t of alignTokens(raw)) out.push({ n: t.n, pi, end: t.end });
  });
  return out;
}

// BYU's J talk HTML read for alignment only: its start page (`<title>JD v:p`),
// the words of its body (its reference labels and page-break labels are BYU's
// insertions, not the discourse), and each citation span as the index of the
// word it precedes.
function byuWords(html) {
  const s = String(html || '');
  const t = /<title>\s*JD\s*\d+\s*:\s*(\d+)/i.exec(s);
  const at = s.indexOf('class="discourseBody"');
  const body = (at < 0 ? s : s.slice(s.lastIndexOf('<', at)))
    .replace(/<span class="citation" id="(\d+)"[^>]*>[\s\S]*?<\/span>/g, ' \u0001$1\u0001 ')
    .replace(/<div class="break[^"]*"[^>]*>[\s\S]*?<\/div>/g, ' ')
    .replace(/<\/?(?:div|p|br|h\d|li|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  const raw = decodeEntities(body).split(/\s+/).filter(Boolean).map((tok) => {
    const c = /^\u0001(\d+)\u0001$/.exec(tok);
    return c ? { cite: c[1] } : { raw: tok, end: 0 };
  });
  const words = [];
  const cites = [];
  for (const tok of alignTokens(raw)) {
    if (tok.cite != null) cites.push({ id: tok.cite, k: words.length });
    else words.push(tok.n);
  }
  return { startPage: t ? Number(t[1]) : null, words, cites };
}

// Exactly matching runs of words between `a` and `b`, as difflib's
// SequenceMatcher finds them (longest match first, then recursively either
// side; words more frequent than 1% of `b` cannot seed a match but extend one).
//   -> [{ a, b, size }] in order
function matchingBlocks(a, b) {
  const b2j = new Map();
  b.forEach((w, j) => { if (!b2j.has(w)) b2j.set(w, []); b2j.get(w).push(j); });
  if (b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [w, js] of b2j) if (js.length > ntest) b2j.delete(w);
  }
  function longest(alo, ahi, blo, bhi) {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return { a: besti, b: bestj, size: bestsize };
  }
  const found = [];
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const m = longest(alo, ahi, blo, bhi);
    if (!m.size) continue;
    found.push(m);
    if (alo < m.a && blo < m.b) queue.push([alo, m.a, blo, m.b]);
    if (m.a + m.size < ahi && m.b + m.size < bhi) queue.push([m.a + m.size, ahi, m.b + m.size, bhi]);
  }
  return found.sort((x, y) => x.a - y.a);
}

// The text gate: the share of BYU's word 5-grams that occur in the Wikisource
// words. A join is accepted at GATE or above.
const GATE = 0.9;
function overlap(byu, wiki) {
  const grams = (ws) => { const out = []; for (let i = 0; i + 5 <= ws.length; i++) out.push(ws.slice(i, i + 5).join(' ')); return out; };
  const have = new Set(grams(wiki));
  const want = grams(byu);
  if (!want.length) return 0;
  return want.filter((g) => have.has(g)).length / want.length;
}

// Where each BYU cite lands in the Wikisource words.
//   strict: the index of the Wikisource word the marker follows, when the
//           ALIGN_WORDS words before BYU's span lie inside one matching run; else null
//   loose:  the Wikisource word aligned nearest before BYU's span (for the
//           snippet of a cite that falls back to its page); else null
const ALIGN_WORDS = 4;
function placeCites(byuCites, blocks) {
  return byuCites.map(({ id, k }) => {
    let strict = null;
    let loose = null;
    const n = Math.min(ALIGN_WORDS, k);
    for (const blk of blocks) {
      if (blk.a > k - 1) break;
      const last = Math.min(k - 1, blk.a + blk.size - 1);
      loose = blk.b + (last - blk.a);
      if (n > 0 && blk.a <= k - n && k - 1 < blk.a + blk.size) strict = blk.b + (k - 1 - blk.a);
    }
    return { id, strict, loose };
  });
}

// The share of `words`' 5-grams that occur in `other` (1 when it has none).
function shareIn(words, other) {
  const grams = (ws) => { const out = []; for (let i = 0; i + 5 <= ws.length; i++) out.push(ws.slice(i, i + 5).join(' ')); return out; };
  const want = grams(words);
  if (!want.length) return 1;
  const have = new Set(grams(other));
  return want.filter((g) => have.has(g)).length / want.length;
}

// Cut the document at the end page its volume page lists, but only when what
// runs past that page is not the talk: a volume page's range is sometimes a
// page short (BYU's copy, the alignment input, has those pages too), while a
// Wikisource page that runs on into the next discourse has text BYU filed
// under another talk.
const RUN_ON_SHARE = 0.5;
function trimToRange(doc, range, byu) {
  if (!range) return doc;
  const pages = pagesOf(doc);
  if (!pages.length || pages[pages.length - 1] <= range[1]) return doc;
  const kept = cutAfterPage(doc, range[1]);
  const all = docWords(doc).map((w) => w.n);
  const tail = all.slice(docWords(kept).length);
  return shareIn(tail, byu.words) < RUN_ON_SHARE ? kept : doc;
}

// Pick the Wikisource page a BYU talk is, among one volume's subpages
//   entries [{ page, doc, range:[start,end]|null }]
// by (volume, start page), in two tiers, the second tried only when the first
// finds nothing: the page's first page break is BYU's start page ('first
// page'), else the volume page lists the page's range from BYU's start page
// ('listed range'; a page whose opening page break is missing). Within a
// tier the page whose text holds most of BYU's 5-grams wins, if it holds at
// least JOIN_SHARE of them (the text gate proper comes after any patch).
//   -> { page, doc, range, by } | null
const JOIN_SHARE = 0.5;
function joinTalk(entries, byu) {
  const first = (e) => { const m = e.doc.paras.flatMap((p) => p.marks).find((x) => x.page != null); return m ? m.page : null; };
  const tiers = [
    ['first page', (e) => first(e) === byu.startPage],
    ['listed range', (e) => !!e.range && e.range[0] === byu.startPage],
  ];
  for (const [by, fits] of tiers) {
    let best = null;
    for (const e of entries.filter(fits)) {
      const score = overlap(byu.words, docWords(e.doc).map((w) => w.n));
      if (score >= JOIN_SHARE && (!best || score > best.score)) best = { e, score };
    }
    if (best) return Object.assign({}, best.e, { by });
  }
  return null;
}

/* ----------------------------------------------------------------- snippet */

// A cite's snippet, cut from paragraph `text` around offset `pos` (just after
// the words the cite follows): from the start of the sentence holding those
// words, at most SNIPPET_MAX characters, ending at a sentence end where one
// fits. A cut mid-sentence shows "…". The text between the ellipses is a
// verbatim substring of the paragraph.
const SNIPPET_MAX = 200;
const SENTENCE_END = /[.!?]["”’)]*\s+/g;
function snippetAt(text, pos) {
  const s = String(text);
  if (s.length <= SNIPPET_MAX + 20) return s;
  let start = 0;
  for (const m of s.matchAll(SENTENCE_END)) {
    if (m.index + m[0].length > pos - 1) break;
    start = m.index + m[0].length;
  }
  let midStart = false;
  if (pos - start > SNIPPET_MAX) { start = s.indexOf(' ', pos - SNIPPET_MAX) + 1; midStart = true; }
  const limit = start + SNIPPET_MAX;
  let end = -1;
  for (const m of s.matchAll(SENTENCE_END)) {
    const e = m.index + m[0].length;
    if (m.index + 1 < pos) continue;
    if (e > limit + 1) break;
    end = e;
    break;
  }
  if (pos >= s.length - 1 || limit >= s.length) end = end < 0 ? s.length : end;
  let midEnd = false;
  if (end < 0) {
    const sp = s.lastIndexOf(' ', limit);
    end = sp > pos ? sp : pos;
    midEnd = true;
  }
  const body = s.slice(start, end).trim();
  return (midStart ? '…' : '') + body + (midEnd && end < s.length ? '…' : '');
}

/* ------------------------------------------------------------------ render */

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Order of events at one offset: close italics, page anchor, marker, open italics.
const EVENT_ORDER = { close: 0, page: 1, cite: 2, open: 3 };
const eventKind = (e) => (e.em ? e.em : e.page != null ? 'page' : 'cite');

// The bundled talk's HTML: the printed subtitle, then the paragraphs (ids
// jp-N, the stable blocks highlights anchor to), with empty page anchors
// (`jodPage`, id jdp-N) and empty citation markers (`citation`, id = citId).
// `markers`: [{ pi, at, id }]. The article's text is exactly the Wikisource
// text: nothing is added inside it.
function renderTalk(doc, markers, title) {
  const out = ['<!doctype html>', `<html><head><meta charset="utf-8"><title>${esc(title || doc.heading || '')}</title></head><body><article class="jodTalk">`];
  if (doc.subtitle) out.push(`<p class="jodSubtitle">${esc(doc.subtitle)}</p>`);
  let n = 0;
  doc.paras.forEach((p, pi) => {
    const events = p.marks.concat(markers.filter((m) => m.pi === pi).map((m) => ({ at: m.at, id: m.id })))
      .map((e, i) => ({ e, i }))
      .sort((x, y) => x.e.at - y.e.at || EVENT_ORDER[eventKind(x.e)] - EVENT_ORDER[eventKind(y.e)] || x.i - y.i)
      .map((x) => x.e);
    let html = '';
    let last = 0;
    for (const e of events) {
      html += esc(p.text.slice(last, e.at));
      last = e.at;
      if (e.em === 'open') html += '<i>';
      else if (e.em === 'close') html += '</i>';
      else if (e.page != null) html += `<span class="jodPage" id="jdp-${e.page}"></span>`;
      else html += `<span class="citation" id="${esc(e.id)}"></span>`;
    }
    html += esc(p.text.slice(last));
    out.push(p.cls ? `<p class="${p.cls}">${html}</p>` : `<p id="jp-${++n}">${html}</p>`);
  });
  out.push('</article></body></html>');
  return out.join('\n');
}

/* -------------------------------------------------------------------- talk */

// The permalink of a Wikisource page at one revision.
function permalink(title, revid) {
  const t = encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/');
  return `https://en.wikisource.org/w/index.php?title=${t}&oldid=${revid}`;
}

// The talk document a snapshot page reads as.
const docOf = (page) => (page.scan ? scanDoc(page.scan.html, page.wikitext) : wikiDoc(page.wikitext));

// Build one J talk.
//   { talkId, page (snapshot page), byuHtml, cites:[{ id, page }], range?:[start,end],
//     patches?:[patch], gate? }
//   -> { ok, html, cites:{ [citId]: { sn, a? } }, row (provenance) }
function buildTalk(opts) {
  const { page, byuHtml, cites } = opts;
  const gate = opts.gate == null ? GATE : opts.gate;
  const byu = byuWords(byuHtml);
  const whole = opts.doc || docOf(page);
  let doc = trimToRange(whole, opts.range, byu);
  const cut = doc !== whole ? opts.range[1] : null;
  const applied = [];
  let gateWords = byu.words;
  for (const patch of opts.patches || []) {
    if (patch.append && patch.page) {
      doc = appendDoc(doc, docOf(patch.page));
      const p = patch.page;
      applied.push({ kind: 'append', title: p.title, revid: p.revid, timestamp: p.timestamp, sha1: p.sha1, url: permalink(p.title, p.revid), note: patch.note });
    } else if (patch.byuOnly) {
      const r = phraseRange(gateWords, patch.byuOnly.from, patch.byuOnly.to);
      if (!r) continue;
      gateWords = gateWords.slice(0, r[0]).concat(gateWords.slice(r[1]));
      applied.push({ kind: 'byuOnly', from: patch.byuOnly.from, to: patch.byuOnly.to, words: r[1] - r[0], note: patch.note });
    }
  }
  const words = docWords(doc);
  const score = overlap(gateWords, words.map((w) => w.n));
  const pages = pagesOf(doc);
  const row = {
    title: page.title, revid: page.revid, timestamp: page.timestamp, sha1: page.sha1,
    url: permalink(page.title, page.revid),
    pages: [pages[0] || null, pages[pages.length - 1] || null],
    overlap: Math.round(score * 10000) / 10000,
  };
  if (opts.join) row.join = opts.join;
  if (cut != null) row.cut = cut;
  if (page.scan) row.scan = page.scan.pages.map((p) => ({ title: p.title, revid: p.revid }));
  if (applied.length) row.patch = applied;
  if (score < gate) return { ok: false, html: null, cites: {}, row };

  const pageOf = new Map(cites.map((c) => [String(c.id), c.page]));
  const placed = placeCites(byu.cites, matchingBlocks(byu.words, words.map((w) => w.n)));
  const markers = [];
  const out = {};
  let byMarker = 0;
  let byPage = 0;
  for (const c of placed) {
    if (!pageOf.has(c.id) || out[c.id]) continue;
    if (c.strict != null) {
      const w = words[c.strict];
      markers.push({ pi: w.pi, at: w.end, id: c.id });
      out[c.id] = { sn: snippetAt(doc.paras[w.pi].text, w.end) };
      byMarker++;
      continue;
    }
    const anchor = pageAnchor(pages, pageOf.get(c.id));
    const near = c.loose != null ? words[c.loose] : null;
    const onPage = near && pageAt(doc, near.pi, near.end) === anchor;
    out[c.id] = { sn: onPage ? snippetAt(doc.paras[near.pi].text, near.end) : pageSnippet(doc, anchor), a: `jdp-${anchor}` };
    byPage++;
  }
  // A cite BYU's copy has no span for still gets its page.
  for (const c of cites) {
    const id = String(c.id);
    if (out[id]) continue;
    const anchor = pageAnchor(pages, c.page);
    out[id] = { sn: pageSnippet(doc, anchor), a: `jdp-${anchor}` };
    byPage++;
  }
  const html = renderTalk(doc, markers, byu.startPage ? `JD ${Math.floor(opts.talkId / 10000)}:${byu.startPage}, ${doc.heading}` : doc.heading);
  row.placed = { marker: byMarker, page: byPage };
  row.hash = require('node:crypto').createHash('sha256').update(html).digest('hex');
  return { ok: true, html, cites: out, row };
}

// The page anchor a cite on printed page `p` falls back to: that page when the
// talk has it, else the nearest page before it, else the talk's first page.
function pageAnchor(pages, p) {
  if (pages.includes(p)) return p;
  const before = pages.filter((x) => x <= p);
  return before.length ? before[before.length - 1] : pages[0];
}

// The snippet for a page with no better position: the sentence the page starts in.
function pageSnippet(doc, page) {
  for (const p of doc.paras) {
    const m = p.marks.find((x) => x.page === page);
    if (m) return snippetAt(p.text, Math.min(p.text.length, m.at + 1));
  }
  return doc.paras.length ? snippetAt(doc.paras[0].text, 1) : '';
}

/* -------------------------------------------------------------------- main */

// The snapshot's subpages by volume, each with its document and the page
// range its volume page lists: { [volume]: [{ page, doc, range }] }.
function indexSnapshot(snapshot) {
  const ranges = new Map();
  const byVolume = {};
  for (const page of snapshot.pages) {
    const vm = /^Journal of Discourses\/Volume (\d+)(?:\/(.+))?$/.exec(page.title);
    if (vm && !vm[2]) for (const [sub, r] of volumeRanges(page.wikitext)) ranges.set(`${page.title}/${sub}`, r);
  }
  for (const page of snapshot.pages) {
    const vm = /^Journal of Discourses\/Volume (\d+)\/(.+)$/.exec(page.title);
    if (!vm) continue;
    (byVolume[vm[1]] = byVolume[vm[1]] || []).push({ page, doc: docOf(page), range: ranges.get(page.title) || null });
  }
  return byVolume;
}

function main() {
  const fs = require('fs');
  const path = require('path');
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const SRC = path.resolve(__dirname, '..', 'source-data');
  const SNAPSHOT = arg('--snapshot', path.join(SRC, 'wikisource-jod.json'));
  const CORE = arg('--core', path.join(SRC, 'core.53.db'));
  const CONTENT = arg('--content', path.join(SRC, 'content.53.db'));
  const PATCHES = arg('--patches', path.join(__dirname, 'jod-patches.json'));
  const OUT = arg('--out', path.join(SRC, 'jod-talks'));
  for (const f of [SNAPSHOT, CORE, CONTENT]) {
    if (!fs.existsSync(f)) { console.error(`ERROR: build input not found: ${f}`); process.exit(2); }
  }
  const { DatabaseSync } = require('node:sqlite');
  const core = new DatabaseSync(CORE, { readOnly: true });
  const content = new DatabaseSync(CONTENT, { readOnly: true });
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const patches = fs.existsSync(PATCHES) ? JSON.parse(fs.readFileSync(PATCHES, 'utf8')) : [];
  const byVolume = indexSnapshot(snapshot);
  const joinedTo = new Map(); // Wikisource title -> talkId, to catch one page joined twice

  const talks = core.prepare(`SELECT DISTINCT t.ID AS id FROM talk t JOIN citation c ON c.TalkID = t.ID WHERE t.Corpus = 'J' ORDER BY t.ID`).all();
  const citeStmt = core.prepare('SELECT ID AS id, Page AS page FROM citation WHERE TalkID = ? ORDER BY ID');
  const bodyStmt = content.prepare('SELECT Text FROM talkbody WHERE TalkID = ?');

  fs.rmSync(path.join(OUT, 'talks'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'talks'), { recursive: true });
  const index = {};
  const provenance = {};
  const failed = [];
  const byTitle = new Map(snapshot.pages.map((p) => [p.title, p]));
  let markers = 0;
  let anchors = 0;
  for (const { id } of talks) {
    const row = bodyStmt.get(id);
    const byuHtml = row && row.Text ? BUILD.decompressTalk(row.Text) : '';
    const byu = byuWords(byuHtml);
    const key = `${Math.floor(id / 10000)}:${byu.startPage}`;
    const joined = joinTalk(byVolume[Math.floor(id / 10000)] || [], byu);
    if (!joined) { failed.push(`${id}: no Wikisource page joins (volume:start page ${key})`); continue; }
    const { page } = joined;
    if (joinedTo.has(page.title)) { failed.push(`${id}: ${page.title} already joined talk ${joinedTo.get(page.title)}`); continue; }
    joinedTo.set(page.title, id);
    const mine = patches.filter((p) => Number(p.talkId) === id).map((p) => {
      if (!p.append) return p;
      if (joinedTo.has(p.append)) failed.push(`${id}: patch appends ${p.append}, already joined talk ${joinedTo.get(p.append)}`);
      joinedTo.set(p.append, id);
      return Object.assign({ page: byTitle.get(p.append) }, p);
    });
    const t = buildTalk({
      talkId: id, page, doc: joined.doc, byuHtml, range: joined.range, patches: mine, join: joined.by,
      cites: citeStmt.all(id).map((c) => ({ id: String(c.id), page: c.page })),
    });
    if (!t.ok) { failed.push(`${id}: text gate ${t.row.overlap} < ${GATE} (${page.title})`); continue; }
    if ((t.row.patch || []).length !== mine.length) failed.push(`${id}: a patch did not apply (an appended page missing, or a byuOnly phrase not found)`);
    fs.writeFileSync(path.join(OUT, 'talks', `${id}.html`), t.html);
    index[id] = { url: t.row.url, cites: t.cites };
    provenance[id] = t.row;
    markers += t.row.placed.marker;
    anchors += t.row.placed.page;
  }
  fs.writeFileSync(path.join(OUT, 'talks.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(OUT, 'provenance.json'), JSON.stringify({
    snapshot: { fetchedAt: snapshot.fetchedAt, api: snapshot.api },
    license: 'Public domain (published 1854–1886); transcription from English Wikisource',
    talks: provenance,
  }));
  const built = Object.keys(index).length;
  console.log(`Built ${built} of ${talks.length} J talks; cites placed by marker ${markers}, by page anchor ${anchors} ` +
    `(${(100 * markers / Math.max(1, markers + anchors)).toFixed(1)}% markers).`);
  if (failed.length) {
    console.error(`${failed.length} talk(s) not built:\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  }
  console.log(`Output: ${OUT}`);
}

if (require.main === module) main();

module.exports = {
  GATE, SNIPPET_MAX, ALIGN_WORDS,
  wikiDoc, scanDoc, pagesOf, splitHeader, cutAfterPage, trimToRange, joinTalk, volumeRanges, appendDoc,
  byuWords, docWords, matchingBlocks, overlap, placeCites, snippetAt, renderTalk, permalink, buildTalk,
};
