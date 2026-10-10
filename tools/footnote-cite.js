/*
 * The footnote-cite rule (GLOSSARY.md "Footnote cite"; spec #102): whether a
 * cite that sits in a note of its talk earns the shard's flag `fn`, so its
 * row says "Cited in a footnote". One pure rule for both producers of G cites:
 * tools/build-citation-data.js (BYU's talk HTML) and
 * tools/derive-conference.js (the Church's talk page, at fetch time). Each
 * caller reads its own markup into the facts below; this file reads no HTML.
 * Checked by tools/validate-footnote-cite.js.
 *
 * Interface:
 *   footnoteContext(verses) -> ctx       verses: verbatim-matcher's loadScripture output;
 *                                        ctx holds the matcher's index, each verse's text
 *                                        and the idf of every content-word stem
 *   footnoteCite(facts, ctx) -> { fn, shape, quoted, ov }
 *     facts.note    the cite's note as parts: strings, and { own, label } for each
 *                   scripture reference (own: it is this cite's reference)
 *     facts.before  the paragraph's text before the note's marker, as the
 *                   reader sees it with every reference label and note marker dropped
 *     facts.after   the paragraph's text after the marker, the same way
 *     facts.slug, facts.ch, facts.verses   the cite's book, chapter and verse numbers
 *   noteShape(note) -> 'bare' | 'see' | 'also' | 'prose'
 *   stem(word), MAX_OVERLAP, QUOTE_RUN
 *
 * The rule: fn when all three hold (the caller has already found the cite
 * in a note).
 *   1. The note is more than a bare reference (shape not 'bare'): the cite
 *      is governed by "See", "see also", "compare" or "cf.", or the note
 *      holds other words. A bare reference names a quotation's source.
 *   2. The paragraph does not quote the verse (quoted false): no quotation
 *      the verbatim matcher joins to the cite before the marker
 *      (tools/verbatim-matcher.js quotedAt), and no run of QUOTE_RUN or more
 *      words shared with the verse, one of them a content word, closing at a
 *      quotation mark just before the marker.
 *   3. The paragraph's overlap with the cited verses (ov) is under
 *      MAX_OVERLAP: the idf-weighted sum over the distinct content-word stems
 *      both hold, idf over the scripture inputs' verses.
 * The thresholds come from a blind judgment of about 100 rows
 * (footnote-label-design, spec #102): the rule labels about 39% of
 * 2018–2026 G rows, and every clearly puzzling row judged. A verse the
 * inputs lack (D&C 137–138, the Official Declarations) has no overlap and
 * no quotation, so its note cite leans toward the flag, which stays true:
 * the cite is in a note.
 */
'use strict';

const M = require('./verbatim-matcher.js');

const MAX_OVERLAP = 16; // ov at or over this: the paragraph echoes the verse
const QUOTE_RUN = 3;    // words of the verse closing at a quotation mark that count as quoting it
const QUOTE_WINDOW = M.WINDOW; // characters before the marker read for a closing quotation

// Words the overlap ignores; the quotation run needs one word outside STOP_RUN.
// STOP's last line holds common words that name no topic, which the
// calibration's cruder stemmer happened to drop and the threshold was set
// without ("holy" beside "Ghost", "see", "only").
const STOP_RUN = new Set(('the of and to a in that is it be he his him they them their i we our us you your for with as by on at ' +
  'from this which unto but not all shall will was were are have hath had who whom also or if so do did an my me thee thou thy ye o').split(' '));
const STOP = new Set([...STOP_RUN, ...('there these those then than when what into upon out up one may can let even yea behold now ' +
  'came pass come say said saith things thing because therefore wherefore more no nor own same such over before after its being ' +
  'been am has her she any every great made make day ' +
  'holy only see need use').split(' ')]);

// A word's stem: plurals first (weaknesses -> weakness, families -> family),
// then the verb endings the King James text and talks share (giveth, gives,
// giving -> giv), then -ly and a final e. An ending comes off only when three
// letters stay ("seed" keeps its -ed).
function stem(word) {
  let w = String(word).toLowerCase();
  const cut = (n) => (w.length - n >= 3 ? w.slice(0, -n) : w);
  if (/sses$/.test(w)) w = w.slice(0, -2);
  else if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/[^su]s$/.test(w)) w = cut(1);
  const verb = /(?:edst|eth|est|ing|ed)$/.exec(w);
  if (verb) w = cut(verb[0].length);
  if (/ly$/.test(w)) w = cut(2);
  if (/e$/.test(w)) w = cut(1);
  return w;
}

// Distinct content-word stems of a text.
function stems(text) {
  const out = new Set();
  for (const { w } of M.words(text)) {
    if (w.length <= 2 || STOP.has(w)) continue;
    const s = stem(w);
    if (s.length > 2) out.add(s);
  }
  return out;
}

function footnoteContext(verses) {
  const text = new Map();
  const df = new Map();
  for (const v of verses) {
    text.set(`${v.slug}|${v.ch}|${v.v}`, v.text);
    for (const s of stems(v.text)) df.set(s, (df.get(s) || 0) + 1);
  }
  const idf = new Map();
  for (const [s, n] of df) idf.set(s, Math.log(verses.length / (1 + n)));
  return { index: M.scriptureIndex(verses), text, idf, verseCount: verses.length };
}

// The note's shape for its own reference (the rule's part 1). The keyword
// governing the cite is the last of "see also", "see", "compare", "cf.",
// "also" before its reference, within its sentence; words left once the
// references and those keywords are gone make the note prose.
function noteShape(note) {
  let s = '';
  let ownAt = -1;
  for (const p of note) {
    if (typeof p === 'string') { s += p; continue; }
    if (p.own && ownAt < 0) ownAt = s.length;
    s += `⟦${p.label || ''}⟧`;
  }
  const prefix = ownAt >= 0 ? s.slice(0, ownAt) : s;
  const sentence = prefix.split(/(?<=[.!?])\s+(?=[A-Z])/).pop();
  const kws = [...sentence.matchAll(/\b(see also|see|compare|cf\.?|also)\b/gi)];
  const k = kws.length ? kws[kws.length - 1][1].toLowerCase() : '';
  const gov = !k ? 'none' : k === 'see' ? 'see' : 'also';
  const residue = s.replace(/⟦[^⟧]*⟧/g, ' ')
    .replace(/\b(see also|see|also|compare|cf\.?|and|or|e\.g\.|for example)\b/gi, ' ')
    .replace(/[\s;,.:()[\]—–-]+/g, '');
  return residue ? 'prose' : gov === 'none' ? 'bare' : gov;
}

// The longest run of consecutive words a and b share that holds a word outside STOP_RUN.
function longestRun(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best && a.slice(i - prev[j], i).some((w) => !STOP_RUN.has(w))) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

function footnoteCite(facts, ctx) {
  const before = String(facts.before || '');
  const after = String(facts.after || '');
  const verseText = facts.verses.map((v) => ctx.text.get(`${facts.slug}|${facts.ch}|${v}`) || '').join(' ');
  const shape = noteShape(facts.note || []);
  // 2. quoted: the matcher's join at the marker, or a short run closing at a quotation mark.
  const win = before.slice(-QUOTE_WINDOW);
  const quoted = M.quotedAt(before, before.length, facts, ctx.index) ||
    (/[”"]\s*[.,;:!?]?\s*$/.test(win) && verseText !== '' &&
      longestRun(M.words(win).map((x) => x.w), M.words(verseText).map((x) => x.w)) >= QUOTE_RUN);
  // 3. overlap
  const para = stems(`${before} ${after}`);
  let ov = 0;
  for (const s of stems(verseText)) if (para.has(s)) ov += ctx.idf.get(s) || 0;
  ov = Math.round(ov * 10) / 10;
  return { fn: shape !== 'bare' && !quoted && ov < MAX_OVERLAP, shape, quoted, ov };
}

module.exports = { MAX_OVERLAP, QUOTE_RUN, stem, noteShape, footnoteContext, footnoteCite };
