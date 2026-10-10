/*
 * Pure view-model for Citations mode: chapter data in, descriptors out. No DOM.
 *
 *   citData.chapterData(slug, chapter)  ->  buildView(data, opts)  ->  cit-panel
 *
 * Owns every rule about what the list says and how it is arranged: which cites
 * anchor at which verse, one row per talk, the corpus -> source-type bucketing
 * (read from the pack descriptor in data.pack: its corpora's `sourceType`
 * values, in its order; a corpus it lacks has no group, row or count), the
 * footer line from the pack vintage (vintageLine, also the options page's About card),
 * both citation-layout orderings, which groups start open, snippet cleaning and
 * quoting, every label (summary, counts, verse, range, screen-reader), and the
 * filter / collapse-all state transitions (the toolbar's words, FILTER_COPY, its
 * verse-query grammar, verseQuery, the "incl. v. 27" note a range row shows
 * under one, matchNote, and the other-chapter no-results line,
 * otherChapterQuery / otherChapterLine). It also owns the talk reader's
 * heading (talkHeading: title, byline, verse chip). cit-panel is a thin adapter from
 * these descriptors to elements, which keeps this module reachable from Node
 * (tools/validate-cit-view-model.js). The adapter owns only copy that depends
 * on no data: the loading line, the Clear filter button and the verse text
 * read from the page.
 *
 * A **talk** is one citing sermon/discourse (entry.talkId); a cite is one
 * passage of it. Every count and every list shows talks: a talk that cites the
 * chapter three times is one row that opens at its earliest cite (byFirstVerse)
 * and carries the union of the verses it cites.
 *
 * Descriptor tree (uids are stable within one built view-model, so the adapter
 * can map element <-> descriptor and the toolbar can key its state off them):
 *
 *   viewModel { layout, empty, emptyText, summary, talks, showTools, groups,
 *               focusUid, footer, footerTitle, chapter, fullName }   chapter: opts.chapter as a string (verseQuery's chapter prefix);
 *               fullName: the book's name ("John"), for the other-chapter no-results line;
 *               footer: "Citations through April 2026", or null;
 *               footerTitle: its hover text, "Includes talks through the April 2026 general conference", or null
 *   group { uid, kind:'verse'|'sourceType', key, verse, label, title, a11yLabel,
 *           count, countClass, open, focus, queryOnly, children:[group], rows:[row] }
 *           queryOnly: By verse only; the group holds query-only rows alone, so it
 *           counts 0 and shows only under a verse query (verseGroups)
 *           title: a source-type header's hover text, the descriptor's `sourceNote`
 *           for its source type ("Sermons by early Church leaders, published 1854–1886");
 *           null on a verse header and when the pack carries no note
 *   row   { uid, citId, talkId, speaker, rangeLabel, rangeTitle, sub, snippet, footnote, a11yLabel,
 *           search, verses, queryOnly, entry }   verses: what a verse query matches, ascending: the
 *           talk's in-chapter verses (By verse: the group's verse alone, see rowDesc);
 *           queryOnly: By verse only; a talk that runs through the group's verse without
 *           being listed there, shown only under a verse query naming that verse;
 *           rangeTitle: the badge's hover text ("Cites verses 1 to 5"), null with no badge
 *           footnote: { text: "in a footnote", title } when the row's cite is flagged
 *           (entry.inFootnote), else null; text ends the talk line ("· in a footnote") and
 *           a11yLabel, title is its hover text
 *
 * By verse fills group.children (verse -> source-type group -> rows); by
 * source hangs rows straight off one group per source type. Only groups are
 * collapsible; rows never are. `row.snippet` is the row's excerpt source
 * (excerptSource: display-ready text for a bundled corpus, a fetch marker
 * for a fetched one); `row.entry` is the representative cite the talk
 * reader opens and the excerpt is fetched for.
 *
 * IIFE -> __BTX.citVM (+ module.exports for the Node validator).
 */
(function (root) {
  'use strict';

  // Source-type buckets come from the pack descriptor (data.pack): one per
  // distinct `sourceType` among its corpora, in the order the descriptor first
  // names each (E and G both say "General Conference"). A corpus the
  // descriptor lacks is in no bucket, so its cites never reach the list.
  // `note` is the descriptor's `sourceNote` (one per source type, null when the
  // pack carries none: the hover text of the type's header).
  // `key` is the source type as a slug and names the bucket's hue
  // (btx-grp-{key} in citations.css, which designs a hue per source type the
  // packs carry; another source type shows no strip).
  const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function sourceTypesOf(pack) {
    const types = [];
    const corpora = (pack && pack.corpora) || {};
    for (const [corpus, entry] of Object.entries(corpora)) {
      const label = entry && entry.sourceType;
      if (!label) continue;
      let t = types.find((x) => x.label === label);
      if (!t) types.push(t = { key: slugOf(label), label, note: null, corpora: [], fetched: [] });
      // One note per source type; the first corpus that states one supplies it.
      if (!t.note && typeof entry.sourceNote === 'string' && entry.sourceNote) t.note = entry.sourceNote;
      t.corpora.push(corpus);
      if (entry.excerpt === 'fetched') t.fetched.push(corpus);
    }
    return types;
  }

  // The vintage as the reader reads it: '2026-04' -> "Citations through April 2026".
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  // The pack's vintage as words, '2026-04' -> "April 2026"; null without one.
  function vintageWords(pack) {
    const m = /^(\d{4})-(\d{2})$/.exec(String((pack && pack.vintage) || ''));
    const month = m && MONTHS[Number(m[2]) - 1];
    return month ? `${month} ${m[1]}` : null;
  }

  function vintageLine(pack) {
    const when = vintageWords(pack);
    return when ? `Citations through ${when}` : null;
  }

  // What hovering the footer says, in plain words: "Includes talks through the
  // April 2026 general conference". Null with no vintage, like vintageLine.
  function vintageTitle(pack) {
    const when = vintageWords(pack);
    return when ? `Includes talks through the ${when} general conference` : null;
  }

  // Below this many talks the filter box and Collapse all are noise.
  const TOOLS_MIN_TALKS = 4;

  // --- pure helpers --------------------------------------------------------

  // An ascending verse list split into its contiguous runs:
  // [3,4,5,10,11] -> [[3,4,5],[10,11]]. The one run walk: formatVerses,
  // anchorVerses and runAt all read it.
  function verseRuns(vs) {
    const runs = [];
    for (const v of vs || []) {
      const last = runs[runs.length - 1];
      if (last && v === last[last.length - 1] + 1) last.push(v);
      else runs.push([v]);
    }
    return runs;
  }

  // Collapse an ascending list of verse numbers into runs: [3..10] -> "3–10",
  // [24,45,46] -> "24, 45–46".
  function formatVerses(vs) {
    return verseRuns(vs)
      .map((r) => (r.length === 1 ? String(r[0]) : `${r[0]}–${r[r.length - 1]}`))
      .join(', ');
  }

  // The index files a chapter's closing note as verse 1000 (Oliver Cowdery's
  // note after Joseph Smith—History 1; one cite each on Malachi 4 and
  // Revelation 22). It is no verse, so every label names it "Note", and it
  // sorts after the verses.
  const NOTE_VERSE = 1000;
  const isNote = (v) => v >= NOTE_VERSE;
  const splitNote = (vs) => {
    const verses = (vs || []).filter((v) => !isNote(v));
    return { verses, note: verses.length < (vs || []).length };
  };

  // "v. 16", "vv. 3–5, 10", "Note", "vv. 1–2, note".
  function verseLabel(vs) {
    const { verses, note } = splitNote(vs);
    if (!verses.length && note) return 'Note';
    return (verses.length > 1 ? 'vv. ' : 'v. ') + formatVerses(verses) + (note ? ', note' : '');
  }

  // The same range spelled for a screen reader: "verses 3 to 5, 10".
  function spokenVerses(vs) {
    const { verses, note } = splitNote(vs);
    if (!verses.length && note) return 'the note';
    return (verses.length > 1 ? 'verses ' : 'verse ') + formatVerses(verses).replace(/–/g, ' to ')
      + (note ? ', and the note' : '');
  }

  // What hovering a row's range badge says: "Cites verse 5", "Cites verses 1 to 5",
  // "Cites the note" (spokenVerses' words, so the screen reader and the hover agree).
  const citesTitle = (vs) => 'Cites ' + spokenVerses(vs);

  // A by-verse group's name.
  const groupLabel = (v) => (isNote(v) ? 'Note' : `Verse ${v}`);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // First verse of each contiguous range in an ascending verse list, so a cite
  // shows once per range it cites: [3,4,5,10,11] -> [3,10]; [24,45,46] -> [24,45].
  function anchorVerses(vs) {
    return verseRuns(vs).map((r) => r[0]);
  }

  // The run of an ascending verse list that starts at anchor v, the verses a
  // cite is listed for under Verse v: runAt([3,4,5,10,11], 10) -> [10,11];
  // [] when v is not an anchor of vs.
  function runAt(vs, v) {
    return verseRuns(vs).find((r) => r[0] === v) || [];
  }

  // The uid of verse v's group in the by-verse layout, so the adapter can find
  // it (markVerse) without knowing how uids are spelled.
  const verseUid = (v) => `v:${v}`;

  // The source label with a General Conference session named the way the
  // Church names it. The build spells most sessions "April 2019 General
  // Conference"; a few hundred arrive as the month a session began ("09 2023",
  // "03 2016"), which is the April or October conference that held it: a
  // conference opening on 30 September, the women's session the week before,
  // a leadership meeting in February, all published in that conference's
  // issue. So months 1–6 read April and 7–12 read October.
  function sourceLabel(s) {
    const lbl = s.lbl || '';
    if (s.c !== 'G' && s.c !== 'E') return lbl;
    return lbl.replace(/^(\d{2}) (\d{4})\b/, (m, mo, y) => {
      const n = Number(mo);
      return n >= 1 && n <= 12 ? `${n <= 6 ? 'April' : 'October'} ${y}` : m;
    });
  }

  // Shorten the source label by dropping the part the group already conveys
  // ("October 2025 General Conference" -> "October 2025"). Journal of
  // Discourses stores volume:page, which reads like a scripture reference in a
  // list full of them, so it is spelled out: "26:278" -> "vol. 26, p. 278".
  function shortLabel(s) {
    const lbl = sourceLabel(s);
    let out = lbl;
    if (s.c === 'G' || s.c === 'E') {
      out = lbl.replace(/\s*General Conference\s*$/i, '').trim();
    } else if (s.c === 'J') {
      out = lbl.replace(/^Journal of Discourses\s*/i, '').trim();
      out = jodPlace(out) || out;
    } else if (s.c === 'T') out = lbl.replace(/^Teachings of the Prophet Joseph Smith,?\s*/i, '').trim();
    return out || s.d || '';
  }

  // "26:278" -> "vol. 26, p. 278"; null for anything else.
  function jodPlace(volPage) {
    const m = /^(\d+):(\d+)$/.exec(volPage);
    return m ? `vol. ${m[1]}, p. ${m[2]}` : null;
  }

  // The source label whole, as the talk reader's byline states it: sessions
  // named as in the list, and a Journal of Discourses place spelled the same
  // way the list spells it ("Journal of Discourses, vol. 26, p. 306").
  function longLabel(s) {
    const lbl = sourceLabel(s);
    if (s.c !== 'J') return lbl;
    const m = /^Journal of Discourses\s*(\S.*)$/i.exec(lbl);
    const place = m && jodPlace(m[1].trim());
    return place ? `Journal of Discourses, ${place}` : lbl;
  }

  // A talk's title as plain text. A few titles carry the markup of an
  // italicised word ("<em>We</em> Are The Church…"); every surface that shows
  // or searches a title reads it through here.
  const titleOf = (s) => String(s.ti || '').replace(/<\/?[a-z][^>]*>/gi, '').trim();

  // --- snippet cleaning ------------------------------------------------------
  // Snippets are the talk paragraph's text as the build stripped it, so they
  // carry the BYU markup's debris. Each pattern is anchored on its exact shape
  // so real bracketed text in a talk ("[that is upon Jesus Christ]") survives:
  //   [ p. 279a]                   Journal of Discourses page break
  //   6 [ Moroni 7:47 ]            a closed footnote after its number
  //   14 [See Matt. 17:21 Mark 9:29  an unclosed "See" footnote: its scripture
  //                                references, which end where prose resumes
  //                                (or where the build's cut ends the snippet,
  //                                as early as "8 [ See…")
  //   16 [Scriptures give…         an unclosed prose footnote: only the marker
  //                                goes, since nothing marks where it ends
  // and the unbracketed debris:
  //   life.” 25 John 3:16          after a sentence ends (. ! ? or a closing
  //                                quote): a live-GC note's marker, then its
  //                                references, whatever follows
  //   follows. John 3:19 D&C 20:14  after a sentence ends: a reference BYU
  //                                inserted (Journal of Discourses, early
  //                                General Conference), only when a new
  //                                sentence, a quote or the end follows
  //                                ("…” 2 Nephi 2:25 teaches" may be the
  //                                talk's own words), or one the cut left
  //                                half-written ("” 2 Ne.…")
  //   His children See, for example,  a note whose marker was lost: capital
  //                                "See" right after a lowercase word
  //   266 Prev Next STPJS 266      the Teachings page header, at the start
  // A bare reference needs chapter:verse ("John 3:16", not "Psalm 23"), so a
  // name and a number in prose ("Brigham Young 1") never reads as one. Its
  // book is NAME, stricter than a bracketed note's BOOK: one word ("Isa.",
  // "D&C", "JS—H") or a multi-word book's own shape ("Doctrine and
  // Covenants", "Joseph Smith—History", "Words of Mormon", "A of F"), so the
  // prose before an inserted reference stays ("The Zion of God. D&C 58:7",
  // "Amen D&C 56:19", "In Abraham 4:18 Abr. 4:18").
  const NUMS = String.raw`\d+(?:[–-]\d+)?(?:,\s?\d+(?:[–-]\d+)?)*`;
  const BOOK = String.raw`(?:[1-4]\s)?[A-Z][A-Za-z&.]*(?:(?:\s|—)(?:of|and|the|[A-Z][A-Za-z&.]*))*`;
  const REF = String.raw`${BOOK}\s\d+(?::${NUMS})?(?:\s\d+:${NUMS})*`;
  // A reference list the build's 200-character cut left half-written ("Mosiah…").
  const CUT_REF = String.raw`\s*(?:${BOOK}|[1-4])[\s\d:,–-]*(?=…$)`;
  const NAME = String.raw`(?:[1-4]\s)?(?:Doctrine and Covenants|Joseph Smith—[A-Z][a-z]+|` +
    String.raw`[A-Z][A-Za-z&]*(?:—[A-Z]|\sof\s[A-Z][A-Za-z]*)?\.?)`;
  // NAME as the cut may leave it ("Doctrine and…", "Words of…"); prose the
  // cut ended ("In the Garden of…") is not one.
  const CUT_NAME = String.raw`(?:[1-4]\s)?(?:Doctrine(?: and(?: Covenants)?)?|Joseph(?: Smith(?:—[A-Za-z]*)?)?|` +
    String.raw`[A-Z][A-Za-z&]*(?:—[A-Z]?|\sof(?:\s[A-Z][A-Za-z]*)?)?\.?)`;
  const CUT_VREF = String.raw`\s*(?:${CUT_NAME}|[1-4])[\s\d:,–-]*(?=…$)`;
  const VREF = String.raw`${NAME}\s\d+:${NUMS}(?:\s\d+:${NUMS})*`;
  const SEE = String.raw`[Ss]ee(?:,? for example,| also)?`;
  // A run of references, as a note lists them: "James 2:23 see also 2 Chr.
  // 20:7 Isa. 41:8", "1 Cor. 3:16 see also 6:19", "… see also verse 19".
  const RUN = String.raw`${VREF}(?:[;,]?\s+(?:${SEE}\s+)?(?:${VREF}|\d+:${NUMS}|verses?\s${NUMS}))*\.?(?:${CUT_VREF})?`;
  // A footnote marker for certain: 5–999, or 1–4 before a numbered book
  // ("14 1 Cor. 15:22") or before a book no number belongs to ("4 Helaman").
  // 1–4 before a book that takes one ("1 Cor.", "3 Nephi") may be the book's.
  const NUMBERED = String.raw`(?:Sam|K(?:in)?gs|Chr|Cor|Th|Tim|Pet|J(?:oh)?n|Ne)`;
  const MARKER = String.raw`(?:[5-9]|\d{2,3}|[1-4](?=\s[1-4]\s)|[1-4](?!\s${NUMBERED}))`;
  const SENTENCE_END = String.raw`(?<=[.!?”"’])`;
  // A reference the build's cut ended right after a sentence: "” 2 Ne.…",
  // "” Deut. 28:25, 37,…" (a bare "Then…" is prose, so a book needs its
  // number before or after it).
  const CUT_END = String.raw`(?:[1-4]\s[A-Z][A-Za-z]*\.?|${NAME}\s\d+:[\d:,–\s-]*)(?=…$)`;
  const RE = {
    pageAtEnd: /\s*\[\s*p\.\s*\d+[ab]?\s*\]\s*$/,
    page: /\s*\[\s*p\.\s*\d+[ab]?\s*\]\s*/g,
    closedNote: /\s\d{1,3}\s?\[[^[\]]*\]/g,
    seeNote: new RegExp(String.raw`(?:\s\d{1,3})?\s?\[\s*[Ss]ee(?:\s+(?:also\s+)?` +
      String.raw`(?:${REF}(?:[;,]?\s+(?:see also\s+)?${REF})*\.?(?:${CUT_REF})?|${CUT_REF})|(?=…$))(?:\s*\])?`, 'g'),
    noteMark: /\s\d{1,3}\s?\[\s*(?![^[\]]*\])/g,
    markedNote: new RegExp(String.raw`${SENTENCE_END}\s+${MARKER}\s(?:${SEE}\s)?(?:${RUN}|${CUT_VREF})`, 'g'),
    insertedRef: new RegExp(String.raw`${SENTENCE_END}\s+(?:[1-4]\s)?(?:${SEE}\s)?` +
      String.raw`(?:${RUN}(?=\s+[A-Z“"‘(]|\s*…?$)|${CUT_END})`, 'g'),
    lostMarkerNote: new RegExp(String.raw`(?<=[a-z])\sSee(?:,? for example,| also)?\s${RUN}`, 'g'),
    stpjsHeader: /^\s*\d+\s+Prev\s+Next\s+STPJS\s+\d+\s*/,
  };

  // A page break at the very end means the passage runs on overleaf, so it
  // becomes "…"; a passage that starts mid-sentence (lowercase) gets a leading
  // "…" inside any opening quote mark.
  function cleanSnippet(raw) {
    let t = String(raw || '');
    t = t.replace(RE.stpjsHeader, '');
    t = t.replace(RE.pageAtEnd, '…').replace(RE.page, ' ');
    t = t.replace(RE.closedNote, ' ').replace(RE.seeNote, ' ').replace(RE.noteMark, ' ');
    t = t.replace(RE.markedNote, ' ').replace(RE.insertedRef, ' ').replace(RE.lostMarkerNote, ' ');
    t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])(?=\s|$)/g, '$1').trim();
    t = t.replace(/([\p{L}\p{N},;:])\s+…$/u, '$1…');
    t = t.replace(/^([“"‘'])\s+/, '$1');
    const m = /^([“"‘']?)(\p{Ll})/u.exec(t);
    if (m) t = m[1] + '…' + t.slice(m[1].length);
    return t;
  }

  // Quote a cleaned snippet for display, unless it already opens on a quote
  // mark (a talk quoting scripture): wrapping that doubles the mark.
  function quoteSnippet(text) {
    if (!text) return '';
    return /^[“"‘']/.test(text) ? text : `“${text}”`;
  }

  // --- excerpt source ---------------------------------------------------------
  // A row's excerpt, per the descriptor's `excerpt` for its corpus:
  //   { text }               bundled: the cleaned, quoted snippet
  //   { fetch: true, chars } fetched: the talk source fetches the paragraph
  //                          when the row comes into view; `chars` is how many
  //                          characters of filler hold its place (the cite's
  //                          excerpt count plus the two quote marks), null to
  //                          reserve the full three lines
  //   null                   no excerpt (a bundled cite with no snippet)
  const QUOTE_MARKS = 2;
  function excerptSource(entry, fetched) {
    if (fetched) {
      const n = entry.excerptChars;
      return { fetch: true, chars: Number.isFinite(n) && n > 0 ? n + QUOTE_MARKS : null };
    }
    const text = quoteSnippet(cleanSnippet(entry.snippet));
    return text ? { text } : null;
  }

  // A fetched paragraph's text as the row shows it: whitespace collapsed,
  // quoted like a snippet. The build counted the same text (excerpt count),
  // so nothing else is cut or cleaned here; the three-line clamp is CSS.
  // null for blank text (the row then keeps its reference line only).
  function excerptText(raw) {
    const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    return t ? quoteSnippet(t) : null;
  }

  // --- ordering --------------------------------------------------------------

  // Newest-first by source date ("YYYY-MM"); undated entries sort last.
  function byDateDesc(a, b) {
    const da = (a.source || {}).d || '';
    const db = (b.source || {}).d || '';
    if (da === db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? 1 : -1;
  }

  // By first cited in-chapter verse, lowest at the top. versesInChapter is
  // ascending, so [0] is the first verse of the (possibly ranged) cite; ties
  // fall through to the rest of the range, then newest-first for identical ranges.
  function byFirstVerse(a, b) {
    const va = a.versesInChapter || [];
    const vb = b.versesInChapter || [];
    const n = Math.min(va.length, vb.length);
    for (let i = 0; i < n; i++) {
      if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    if (va.length !== vb.length) return va.length - vb.length;
    return byDateDesc(a, b);
  }

  const corpusOf = (entry) => (entry.source || {}).c;

  // The chapter data with every cite of a corpus outside `types` removed, and
  // any verse left with no cite gone.
  function restrictTo(data, types) {
    const known = new Set(types.flatMap((t) => t.corpora));
    const entries = {};
    for (const [id, e] of Object.entries(data.entries)) if (known.has(corpusOf(e))) entries[id] = e;
    const byVerse = {};
    for (const v of data.verseOrder) {
      const ids = (data.byVerse[v] || []).filter((id) => id in entries);
      if (ids.length) byVerse[v] = ids;
    }
    return Object.assign({}, data, {
      entries, byVerse,
      verseOrder: data.verseOrder.filter((v) => byVerse[v]),
      uniqueTotal: Object.keys(entries).length,
    });
  }

  const talkIdOf = (entry) => entry.talkId || entry.citId;

  // One record per talk, in first-seen order of the earliest cite: the
  // representative cite (the one the reader opens), the sorted union of every
  // cite's in-chapter verses, and all the cites (for the filter haystack).
  function byTalk(entries) {
    const talks = new Map();
    for (const e of entries.slice().sort(byFirstVerse)) {
      const id = talkIdOf(e);
      const t = talks.get(id);
      if (t) t.cites.push(e);
      else talks.set(id, { entry: e, cites: [e] });
    }
    return Array.from(talks.values(), (t) => {
      const verses = new Set();
      for (const c of t.cites) for (const v of c.versesInChapter || []) verses.add(v);
      return { entry: t.entry, cites: t.cites, verses: Array.from(verses).sort((a, b) => a - b) };
    });
  }

  // Newest talk first; stable, so equal dates keep byTalk's first-verse order.
  const newestFirst = (talks) => talks.slice().sort((a, b) => byDateDesc(a.entry, b.entry));

  // --- descriptors ---------------------------------------------------------

  // What a row's talk line adds when its cite (the one the row opens) sits in
  // one of the talk's notes, which is why the excerpt may be about something
  // else: the words after "title · month year", and their hover text. The
  // build's `fn` flag (entry.inFootnote) decides.
  const FOOTNOTE_LABEL = 'in a footnote';
  const FOOTNOTE_TITLE = 'The verse is cited in a footnote; the excerpt is the paragraph the note belongs to.';

  // verses.badged: the verses to badge, or null for no badge. verses.listed:
  // the verses this row stands for, which a verse query matches (row.verses):
  // the talk's verses in By source; in By verse the group's verse alone, so
  // a verse query shows a talk under the verses it names and nowhere else.
  // verses.queryOnly: a By verse row of a talk whose cites only run through
  // the group's verse, shown under a verse query alone (verseGroups).
  // The filter haystack holds snippet text only for a bundled corpus: a
  // fetched excerpt depends on what has scrolled into view, and filtering
  // must not.
  function rowDesc(talk, type, uidPrefix, i, verses) {
    const { badged, listed, queryOnly } = verses;
    const entry = talk.entry;
    const s = entry.source || {};
    const where = shortLabel(s);
    const speaker = s.sp || 'Unknown speaker';
    const title = titleOf(s);
    const fetched = type.fetched.includes(corpusOf(entry));
    const footnote = entry.inFootnote === true ? { text: FOOTNOTE_LABEL, title: FOOTNOTE_TITLE } : null;
    const haystack = [s.sp, title, s.lbl, where]
      .concat(fetched ? [] : talk.cites.map((c) => cleanSnippet(c.snippet)));
    return {
      uid: `${uidPrefix}/${i}:${entry.citId}`,
      citId: entry.citId,
      talkId: talkIdOf(entry),
      speaker,
      rangeLabel: badged ? verseLabel(badged) : null,
      rangeTitle: badged ? citesTitle(badged) : null,
      sub: [title, where].filter(Boolean).join(' · ') || null,
      snippet: excerptSource(entry, fetched),
      footnote,
      a11yLabel: [speaker, title, where, badged && spokenVerses(badged), footnote && footnote.text].filter(Boolean).join(', '),
      search: haystack.filter(Boolean).join(' ').toLowerCase(),
      verses: listed,
      queryOnly: queryOnly === true,
      entry,
    };
  }

  const talkCount = (n) => plural(n, 'talk', 'talks');

  function groupDesc(fields) {
    const g = Object.assign({
      uid: '', kind: 'verse', key: '', verse: null, label: '', title: null, count: 0, countClass: null,
      open: false, focus: false, queryOnly: false, children: [], rows: [],
    }, fields);
    g.a11yLabel = groupA11yLabel(g, g.count);
    return g;
  }

  function groupA11yLabel(group, count) {
    return `${group.label}, ${talkCount(count)}`;
  }

  // Layout 'verse': verse -> source-type group -> one row per talk. A spanning
  // cite is listed at each of its anchor verses, badged with its full coverage
  // (e.g. "vv. 3–6, 10–11"). Source-type groups start open, so one click on a
  // verse shows its talks; they stay collapsible for skipping past a long one.
  // Each group also carries, as query-only rows, the talks whose cites run
  // through its verse without being listed there (a "vv. 1–31" cite under
  // Verse 27), newest first among the rest: a verse query shows them, so the
  // queried verse's group holds every talk that takes it in. A verse only a
  // run takes in gets a query-only group. Query-only rows and groups count
  // nothing and never take the focus verse.
  function verseGroups(data, types, focusVerse) {
    const groups = [];
    for (const v of data.verseOrder) {
      const all = (data.byVerse[v] || []).map((id) => data.entries[id]).filter(Boolean);
      const listed = all.filter((e) => anchorVerses(e.versesInChapter).includes(v));
      const listedTalks = new Set(listed.map(talkIdOf));
      const through = all.filter((e) => !listedTalks.has(talkIdOf(e)));
      if (!all.length) continue;

      const uid = verseUid(v);
      const children = [];
      let count = 0;
      for (const t of types) {
        const ofType = (es) => byTalk(es.filter((e) => t.corpora.includes(corpusOf(e))));
        const own = ofType(listed);
        const extra = ofType(through).map((talk) => Object.assign(talk, { queryOnly: true }));
        if (!own.length && !extra.length) continue;
        count += own.length;
        const childUid = `${uid}/${t.key}`;
        children.push(groupDesc({
          uid: childUid,
          kind: 'sourceType',
          key: t.key,
          label: t.label,
          title: t.note,
          count: own.length,
          countClass: `btx-grp-${t.key}`,
          open: true,
          queryOnly: !own.length,
          rows: newestFirst(own.concat(extra)).map((talk, i) => rowDesc(talk, t, childUid, i, {
            badged: talk.verses.length > 1 ? talk.verses : null,
            listed: [v],
            queryOnly: talk.queryOnly,
          })),
        }));
      }

      const focus = count > 0 && focusVerse != null && String(v) === String(focusVerse);
      groups.push(groupDesc({
        uid, kind: 'verse', key: String(v), verse: v, label: groupLabel(v),
        count, open: focus, focus, queryOnly: count === 0, children,
      }));
    }
    return groups;
  }

  // Layout 'source': one row per talk, grouped by source type, newest first,
  // each badged with every verse of the chapter it cites.
  function sourceGroups(data, types) {
    const all = Object.values(data.entries);
    const groups = [];
    for (const t of types) {
      const talks = newestFirst(byTalk(all.filter((e) => t.corpora.includes(corpusOf(e)))));
      if (!talks.length) continue;
      const uid = `s:${t.key}`;
      groups.push(groupDesc({
        uid, kind: 'sourceType', key: t.key, label: t.label, title: t.note,
        count: talks.length, countClass: `btx-grp-${t.key}`,
        rows: talks.map((talk, i) => rowDesc(talk, t, uid, i, { badged: talk.verses, listed: talk.verses })),
      }));
    }
    return groups;
  }

  function eachGroup(groups, fn) {
    for (const g of groups) {
      fn(g);
      for (const c of g.children) fn(c);
    }
  }

  const summaryLine = (n) => `${talkCount(n)} ${n === 1 ? 'cites' : 'cite'} this chapter`;

  // Why a chapter shows no talks. A book whose shard indexes no chapter at all
  // (the Official Declarations) is a gap in the index, not a book nobody cites.
  function emptyText(data, opts) {
    if (!data) return 'No citation data for this book.';
    if (data.bookIndexed === false) {
      return `The citation index has no entries for ${data.bookName || opts.fullName || 'this book'}.`;
    }
    return `No talks cite ${`${opts.fullName || ''} ${opts.chapter}`.trim()}.`;
  }

  // opts: { view: 'verse'|'source', fullName, chapter, focusVerse }
  // data: citData.chapterData(...) — null when the book has no shard; its
  //   `pack` (the pack descriptor) decides which source types exist and the
  //   footer line. Cites of a corpus the descriptor lacks are dropped first,
  //   so they count nowhere and no group, row or verse exists for them.
  function buildView(data, opts) {
    opts = opts || {};
    // Callers pass the layout through from the settings; the fallback matches
    // that schema's default ('source') rather than inventing a second one.
    const layout = opts.view === 'verse' ? 'verse' : 'source';
    const footer = data ? vintageLine(data.pack) : null;
    const footerTitle = data ? vintageTitle(data.pack) : null;
    const types = sourceTypesOf(data && data.pack);
    if (data) data = restrictTo(data, types);

    if (!data || !data.verseOrder.length || data.uniqueTotal === 0) {
      return {
        layout, empty: true,
        emptyText: emptyText(data, opts),
        summary: null, talks: 0, showTools: false, groups: [], focusUid: null, footer, footerTitle,
      };
    }

    const talks = new Set(Object.values(data.entries).map(talkIdOf)).size;
    // Groups start collapsed, whatever the chapter's size: opening a group is
    // the reader's act, and it is what starts a fetched excerpt (spec #69).
    // Only three things open on their own: the focus verse's group here, the
    // source-type groups inside a verse group (verseGroups), and the groups a
    // typed filter matches (filterPlan).
    const groups = layout === 'source' ? sourceGroups(data, types) : verseGroups(data, types, opts.focusVerse);
    const focused = groups.find((g) => g.focus);

    return {
      layout,
      empty: false,
      emptyText: null,
      summary: summaryLine(talks),
      talks,
      showTools: talks >= TOOLS_MIN_TALKS,
      groups,
      focusUid: focused ? focused.uid : null,
      footer, footerTitle,
      chapter: opts.chapter != null ? String(opts.chapter) : null,
      fullName: opts.fullName || null,
    };
  }

  // --- verse queries ---------------------------------------------------------

  // The toolbar's words. The filter also matches source labels and bundled
  // snippets, but a reader looks for a speaker, a title or a verse. The label
  // drops the ellipsis a screen reader would speak. `collapse` is the button's
  // one label, which also sizes its slot while it is hidden (collapseLabel).
  const FILTER_COPY = {
    placeholder: 'Filter by speaker, title or verse…',
    label: 'Filter by speaker, title or verse',
    collapse: 'Collapse all',
  };

  // A filter text made only of verse tokens is a verse query: verseQuery
  // returns its verses, ascending, and filterPlan matches each row by the
  // verses its range badge reads (row.verses). Anything else returns null and
  // is matched as text, so a title with a number ("Doctrine and Covenants 76")
  // is still found by its words. Case and spacing don't matter. Tokens:
  //   "v", "v.", "vv.", "verse", "verses"   optional, before any number
  //   "14:27"     a chapter prefix; counts only when it names this chapter
  //               (on John 15 "14:27" is text: a Journal of Discourses place)
  //   "27-29"     a range, with - – or —; a backwards range reads forwards;
  //               both ends may carry the chapter ("14:27-14:29")
  //   "27, 29"    a list, separated by commas, semicolons or spaces
  // Edges, chosen for the reader:
  //   - "27-" and "27," (mid-keystroke) keep verse 27, so the list doesn't
  //     flash to text matches between "27" and "27-29";
  //   - a verse is 1–999: "2006" is a year and "0" no verse, so either
  //     makes the whole query text ("27 2006" too);
  //   - "v" or "14:" alone holds no verse, so it is text.
  const isVerseNumber = (n) => n >= 1 && n < NOTE_VERSE;
  const VERSE_ITEM = /^(?:(\d+):)?(\d+)(?:-(?:(?:(\d+):)?(\d+))?)?$/;

  function verseQuery(text, chapter) {
    const t = String(text || '').trim().toLowerCase()
      .replace(/(^|[\s,;])(?:verses?|vv?)\.?\s*(?=\d)/g, '$1')
      .replace(/\s*[-–—]\s*/g, '-');
    const items = t.split(/[\s,;]+/).filter(Boolean);
    if (!items.length) return null;
    const verses = new Set();
    const ch = Number(chapter);
    for (const item of items) {
      const m = VERSE_ITEM.exec(item);
      if (!m) return null;
      if ((m[1] != null && Number(m[1]) !== ch) || (m[3] != null && Number(m[3]) !== ch)) return null;
      const a = Number(m[2]);
      const b = m[4] != null ? Number(m[4]) : a;
      if (!isVerseNumber(a) || !isVerseNumber(b)) return null;
      for (let v = Math.min(a, b); v <= Math.max(a, b); v++) verses.add(v);
    }
    return Array.from(verses).sort((x, y) => x - y);
  }

  // A filter text that is a verse query for another chapter ("15:27" on John
  // 14, every chapter prefix naming that one chapter): { chapter, verses },
  // else null. filterPlan asks only when nothing matched it as text.
  function otherChapterQuery(text, chapter) {
    const m = /(\d+)\s*:/.exec(String(text || ''));
    if (!m || Number(m[1]) === Number(chapter)) return null;
    const verses = verseQuery(text, m[1]);
    return verses ? { chapter: Number(m[1]), verses } : null;
  }

  // Its no-results line: why, and a verse number to type instead, one a talk
  // here cites: the first verse asked for that one does, else the chapter's
  // first cited verse. "15:27 isn't in John 14. Type a verse number, like 27."
  function otherChapterLine(viewModel, ref) {
    const cited = new Set();
    for (const row of allRows(viewModel)) for (const v of row.verses) if (isVerseNumber(v)) cited.add(v);
    const tryVerse = ref.verses.find((v) => cited.has(v)) || Math.min.apply(null, Array.from(cited));
    const here = [viewModel.fullName, viewModel.chapter].filter(Boolean).join(' ') || 'this chapter';
    return `${ref.chapter}:${formatVerses(ref.verses)} isn’t in ${here}.`
      + (Number.isFinite(tryVerse) ? ` Type a verse number, like ${tryVerse}.` : '');
  }

  // --- toolbar state -------------------------------------------------------
  // The filter box and Collapse all run on a plain state object —
  // { open: {uid:bool}, preFilterOpen: {uid:bool}|null } — and the adapter
  // mirrors each plan onto the <details> elements. Plans are computed, not
  // applied, so the transitions (which groups hide, which open, what the counts
  // and summary say, what a cleared filter restores) are checkable without a
  // document.

  function initialState(viewModel) {
    const open = {};
    eachGroup(viewModel.groups, (g) => { open[g.uid] = g.open; });
    return { open, preFilterOpen: null };
  }

  function rowsOf(group) {
    return group.rows.concat(group.children.reduce((acc, c) => acc.concat(c.rows), []));
  }

  // Why a By source row matched a verse query, when its badge reads more than
  // was asked for ("vv. 1–31" for "27"): the verses it matched, shown beside
  // the badge ("incl. v. 27") and added to the row's screen-reader name.
  // Null when every verse the row cites was asked for.
  function matchNote(row, verses) {
    const hit = row.verses.filter((v) => verses.includes(v));
    if (hit.length === row.verses.length) return null;
    return { text: 'incl. ' + verseLabel(hit), a11yLabel: `${row.a11yLabel}, including ${spokenVerses(hit)}` };
  }

  // Hides rows that miss the query (a verse query matches a row's verses, any
  // other text its search haystack) and groups left with no visible row, opens
  // the survivors, and — on the transition into filtering — captures the open
  // state so clearing the box can restore it. Every plan also carries what the
  // chrome shows for it: per-group counts and screen-reader labels (visible
  // talks), the summary line, the no-results line, the button label, and
  // matchNotes ({ [row uid]: matchNote }, By source under a verse query).
  // Query-only rows show under a verse query alone.
  function filterPlan(viewModel, query, state) {
    const shown = String(query || '').trim();
    const q = shown.toLowerCase();
    const filtering = q.length > 0;
    const hidden = {};
    const open = {};
    const counts = {};
    const a11y = {};
    const matched = new Set();
    const verses = filtering ? verseQuery(shown, viewModel.chapter) : null;
    const matches = verses
      ? (row) => row.verses.some((v) => verses.includes(v))
      : (row) => !row.queryOnly && row.search.includes(q);

    const matchNotes = {};
    for (const row of allRows(viewModel)) {
      const hit = filtering ? matches(row) : !row.queryOnly;
      hidden[row.uid] = !hit;
      if (hit) matched.add(row.talkId);
      const note = hit && verses && viewModel.layout === 'source' && matchNote(row, verses);
      if (note) matchNotes[row.uid] = note;
    }

    const preFilterOpen = filtering
      ? (state.preFilterOpen || Object.assign({}, state.open))
      : null;

    eachGroup(viewModel.groups, (g) => {
      const visible = rowsOf(g).filter((r) => !hidden[r.uid]).length;
      counts[g.uid] = filtering ? visible : g.count;
      a11y[g.uid] = groupA11yLabel(g, counts[g.uid]);
      hidden[g.uid] = visible === 0;
      if (filtering) open[g.uid] = visible > 0 ? true : state.open[g.uid];
      else open[g.uid] = state.preFilterOpen ? state.preFilterOpen[g.uid] : state.open[g.uid];
    });

    const anyMatch = matched.size > 0;
    const elsewhere = !filtering || anyMatch || verses ? null : otherChapterQuery(shown, viewModel.chapter);
    const noResults = !filtering || anyMatch ? null
      : verses ? `No talks cite ${verses.length > 1 ? 'verses' : 'verse'} ${formatVerses(verses)}.`
        : elsewhere ? otherChapterLine(viewModel, elsewhere)
          : `No talks match “${shown}”.`;
    const plan = {
      filtering, anyMatch, hidden, open, preFilterOpen, counts, a11y, matchNotes,
      summary: filtering
        ? `${matched.size} of ${talkCount(viewModel.talks)} ${matched.size === 1 ? 'matches' : 'match'}`
        : viewModel.summary,
      // With no matches the no-results line says it on screen; the summary
      // still speaks its count to a screen reader, out of sight.
      summaryShown: !noResults,
      noResults,
    };
    plan.collapseLabel = collapseLabel(viewModel, { open }, hidden);
    return plan;
  }

  // Fold a plan back into the state the adapter carries between interactions.
  function applyPlan(state, plan) {
    return {
      open: Object.assign({}, state.open, plan.open),
      preFilterOpen: 'preFilterOpen' in plan ? plan.preFilterOpen : state.preFilterOpen,
    };
  }

  // Collapse all folds the visible top-level groups (verses, or source types
  // in by source) and leaves nested source-type groups as they are, so
  // re-opening a verse still shows its talks. There is no Expand all: nobody
  // reads a whole chapter's worth of rows, and the filter opens every match.
  const visibleTop = (viewModel, hidden) =>
    viewModel.groups.filter((g) => !hidden || !hidden[g.uid]);

  function collapseAllPlan(viewModel, state, hidden) {
    const open = {};
    for (const g of visibleTop(viewModel, hidden)) open[g.uid] = false;
    return { open };
  }

  // The button's label, or null to hide it when there is nothing to collapse
  // (hidden, it keeps its slot, so the filter box beside it never jumps).
  function collapseLabel(viewModel, state, hidden) {
    return visibleTop(viewModel, hidden).some((g) => state.open[g.uid]) ? FILTER_COPY.collapse : null;
  }

  // Every citation row in the tree, in display order. The adapter uses it to
  // walk what a plan hides; the corpus tables, comparators and label helpers
  // above stay module-private — they are reachable through buildView.
  function allRows(viewModel) {
    const rows = [];
    for (const g of viewModel.groups) rows.push.apply(rows, rowsOf(g));
    return rows;
  }

  // --- talk reader heading ---------------------------------------------------

  // The source's "January 1853" when its date is a real "YYYY-MM" and the
  // label does not already hold the year; '' otherwise. One rule for every
  // corpus: a General Conference label names its conference, so it never
  // repeats; a Journal of Discourses label carries only volume and page.
  function missingDate(s, lbl) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s.d || ''));
    const month = m && MONTHS[Number(m[2]) - 1];
    return month && !String(lbl).includes(m[1]) ? `${month} ${m[1]}` : '';
  }

  // What the talk reader's header and byline say for one cite:
  //   title      the talk's title as plain text; Teachings of the Prophet
  //              Joseph Smith has none, so its page label ("…Joseph Smith,
  //              p. 264") stands in
  //   speaker    byline line 1 (null when unknown)
  //   where      byline line 2: the source label whole (longLabel), unless it
  //              is already the title, then " · " and the source's month and
  //              year when the label lacks that year ("Journal of Discourses,
  //              vol. 1, p. 3 · January 1853"); null when both are absent
  //   chip       the cited verses ("vv. 1–5", "Note") and their spoken form for
  //              the button that re-reveals the cited passage
  function talkHeading(source, versesInChapter) {
    const s = source || {};
    const lbl = longLabel(s);
    const title = titleOf(s) || lbl || 'Untitled talk';
    const vs = versesInChapter && versesInChapter.length ? versesInChapter : null;
    return {
      title,
      speaker: s.sp || null,
      where: [lbl && lbl !== title ? lbl : '', missingDate(s, lbl)].filter(Boolean).join(' · ') || null,
      chip: {
        text: vs ? verseLabel(vs) : 'Cited passage',
        a11yLabel: 'Go to the cited passage' + (vs ? ', ' + spokenVerses(vs) : ''),
      },
    };
  }

  const VM = {
    verseRuns, formatVerses, verseLabel, anchorVerses, vintageLine, vintageTitle, cleanSnippet, quoteSnippet, excerptText, verseUid,
    buildView, talkHeading, verseQuery,
    FILTER_COPY, initialState, filterPlan, applyPlan, collapseAllPlan, collapseLabel, allRows,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VM;
  root.__BTX = Object.assign(root.__BTX || {}, { citVM: VM });
})(typeof globalThis !== 'undefined' ? globalThis : this);
