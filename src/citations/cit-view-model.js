/*
 * Pure view-model for Citations mode: chapter data in, descriptors out. No DOM.
 *
 *   citData.chapterData(slug, chapter)  ->  buildView(data, opts)  ->  cit-panel
 *
 * Owns every rule about what the list says and how it is arranged: which cites
 * anchor at which verse, one row per talk, the corpus -> source-type bucketing,
 * both citation-layout orderings, which groups start open, snippet cleaning and
 * quoting, every label (summary, counts, verse, range, screen-reader), and the
 * filter / collapse-all state transitions. It also owns the talk reader's
 * heading (talkHeading: title, byline, verse chip). cit-panel is a thin adapter from
 * these descriptors to elements, which keeps this module reachable from Node
 * (tools/validate-cit-view-model.js). The adapter owns only copy that depends
 * on no data: the loading line, the filter placeholder, the Clear filter
 * button and the page-read verse excerpt.
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
 *               focusUid }
 *   group { uid, kind:'verse'|'sourceType', key, verse, label, a11yLabel,
 *           count, countClass, open, focus, children:[group], rows:[row] }
 *   row   { uid, citId, talkId, speaker, rangeLabel, sub, snippet, a11yLabel,
 *           search, entry }
 *
 * By verse fills group.children (verse -> source-type group -> rows); by
 * source hangs rows straight off one group per source type. Only groups are
 * collapsible; rows never are. `row.snippet` is display-ready (cleaned and
 * quoted); `row.entry` is the representative cite the talk reader opens.
 *
 * IIFE -> __BTX.citVM (+ module.exports for the Node validator).
 */
(function (root) {
  'use strict';

  // Source-type buckets, in display order. E and G both count as General
  // Conference.
  const SOURCE_TYPES = [
    { key: 'gc', label: 'General Conference', corpora: ['G', 'E'] },
    { key: 'jod', label: 'Journal of Discourses', corpora: ['J'] },
    { key: 'tpjs', label: 'Teachings of the Prophet Joseph Smith', corpora: ['T'] },
  ];

  // Up to this many talks on a chapter, every group starts open: the whole
  // list fits on a screen or two, so making the reader click is pure cost.
  const OPEN_ALL_MAX_TALKS = 12;
  // Below this many talks the filter box and Collapse all are noise.
  const TOOLS_MIN_TALKS = 4;

  // --- pure helpers --------------------------------------------------------

  // Collapse an ascending list of verse numbers into runs: [3..10] -> "3–10",
  // [24,45,46] -> "24, 45–46".
  function formatVerses(vs) {
    if (!vs || !vs.length) return '';
    const parts = [];
    let start = vs[0], prev = vs[0];
    for (let i = 1; i <= vs.length; i++) {
      const cur = vs[i];
      if (cur === prev + 1) { prev = cur; continue; }
      parts.push(start === prev ? String(start) : `${start}–${prev}`);
      start = cur; prev = cur;
    }
    return parts.join(', ');
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

  // A by-verse group's name.
  const groupLabel = (v) => (isNote(v) ? 'Note' : `Verse ${v}`);

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // First verse of each contiguous range in an ascending verse list, so a cite
  // shows once per range it cites: [3,4,5,10,11] -> [3,10]; [24,45,46] -> [24,45].
  function anchorVerses(vs) {
    const anchors = [];
    if (!vs) return anchors;
    for (let i = 0; i < vs.length; i++) {
      if (i === 0 || vs[i] !== vs[i - 1] + 1) anchors.push(vs[i]);
    }
    return anchors;
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

  const sourceTypeOf = (entry) =>
    SOURCE_TYPES.find((g) => g.corpora.includes((entry.source || {}).c));

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

  // rangeVerses: the verses to badge, or null for no badge.
  function rowDesc(talk, uidPrefix, i, rangeVerses) {
    const entry = talk.entry;
    const s = entry.source || {};
    const where = shortLabel(s);
    const speaker = s.sp || 'Unknown speaker';
    const title = titleOf(s);
    const snippet = cleanSnippet(entry.snippet);
    const haystack = [s.sp, title, s.lbl, where].concat(talk.cites.map((c) => cleanSnippet(c.snippet)));
    return {
      uid: `${uidPrefix}/${i}:${entry.citId}`,
      citId: entry.citId,
      talkId: talkIdOf(entry),
      speaker,
      rangeLabel: rangeVerses ? verseLabel(rangeVerses) : null,
      sub: [title, where].filter(Boolean).join(' · ') || null,
      snippet: quoteSnippet(snippet),
      a11yLabel: [speaker, title, where, rangeVerses && spokenVerses(rangeVerses)].filter(Boolean).join(', '),
      search: haystack.filter(Boolean).join(' ').toLowerCase(),
      entry,
    };
  }

  const talkCount = (n) => plural(n, 'talk', 'talks');

  function groupDesc(fields) {
    const g = Object.assign({
      uid: '', kind: 'verse', key: '', verse: null, label: '', count: 0, countClass: null,
      open: false, focus: false, children: [], rows: [],
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
  function verseGroups(data, focusVerse) {
    const groups = [];
    for (const v of data.verseOrder) {
      const entries = (data.byVerse[v] || [])
        .map((id) => data.entries[id])
        .filter((e) => e && anchorVerses(e.versesInChapter).includes(v));
      if (!entries.length) continue;

      const uid = verseUid(v);
      const focus = focusVerse != null && String(v) === String(focusVerse);
      const children = [];
      let count = 0;
      for (const t of SOURCE_TYPES) {
        const talks = newestFirst(byTalk(entries.filter((e) => sourceTypeOf(e) === t)));
        if (!talks.length) continue;
        count += talks.length;
        const childUid = `${uid}/${t.key}`;
        children.push(groupDesc({
          uid: childUid,
          kind: 'sourceType',
          key: t.key,
          label: t.label,
          count: talks.length,
          countClass: `btx-grp-${t.key}`,
          open: true,
          rows: talks.map((talk, i) => rowDesc(talk, childUid, i, talk.verses.length > 1 ? talk.verses : null)),
        }));
      }

      groups.push(groupDesc({
        uid, kind: 'verse', key: String(v), verse: v, label: groupLabel(v),
        count, open: focus, focus, children,
      }));
    }
    return groups;
  }

  // Layout 'source': one row per talk, grouped by source type, newest first,
  // each badged with every verse of the chapter it cites.
  function sourceGroups(data) {
    const all = Object.values(data.entries);
    const groups = [];
    for (const t of SOURCE_TYPES) {
      const talks = newestFirst(byTalk(all.filter((e) => sourceTypeOf(e) === t)));
      if (!talks.length) continue;
      const uid = `s:${t.key}`;
      groups.push(groupDesc({
        uid, kind: 'sourceType', key: t.key, label: t.label,
        count: talks.length, countClass: `btx-grp-${t.key}`,
        rows: talks.map((talk, i) => rowDesc(talk, uid, i, talk.verses)),
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
  // data: citData.chapterData(...) — null when the book has no shard.
  function buildView(data, opts) {
    opts = opts || {};
    // Callers pass the layout through from the settings; the fallback matches
    // that schema's default ('source') rather than inventing a second one.
    const layout = opts.view === 'verse' ? 'verse' : 'source';

    if (!data || !data.verseOrder.length || data.uniqueTotal === 0) {
      return {
        layout, empty: true,
        emptyText: emptyText(data, opts),
        summary: null, talks: 0, showTools: false, groups: [], focusUid: null,
      };
    }

    const talks = new Set(Object.values(data.entries).map(talkIdOf)).size;
    const groups = layout === 'source' ? sourceGroups(data) : verseGroups(data, opts.focusVerse);
    if (talks <= OPEN_ALL_MAX_TALKS) eachGroup(groups, (g) => { g.open = true; });
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
    };
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

  // Hides rows that miss the query and groups left with no visible row, opens
  // the survivors, and — on the transition into filtering — captures the open
  // state so clearing the box can restore it. Every plan also carries what the
  // chrome shows for it: per-group counts and screen-reader labels (visible
  // talks), the summary line, the no-results line, and the button label.
  function filterPlan(viewModel, query, state) {
    const shown = String(query || '').trim();
    const q = shown.toLowerCase();
    const filtering = q.length > 0;
    const hidden = {};
    const open = {};
    const counts = {};
    const a11y = {};
    const matched = new Set();

    for (const row of allRows(viewModel)) {
      const hit = !filtering || row.search.includes(q);
      hidden[row.uid] = !hit;
      if (hit) matched.add(row.talkId);
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
    const noResults = filtering && !anyMatch ? `No talks match “${shown}”.` : null;
    const plan = {
      filtering, anyMatch, hidden, open, preFilterOpen, counts, a11y,
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

  // The button's label, or null to hide it when there is nothing to collapse.
  function collapseLabel(viewModel, state, hidden) {
    return visibleTop(viewModel, hidden).some((g) => state.open[g.uid]) ? 'Collapse all' : null;
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

  // What the talk reader's header and byline say for one cite:
  //   title      the talk's title as plain text; Teachings of the Prophet
  //              Joseph Smith has none, so its page label ("…Joseph Smith,
  //              p. 264") stands in
  //   speaker    byline line 1 (null when unknown)
  //   where      byline line 2: the source label whole (longLabel), unless it
  //              is already the title
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
      where: lbl && lbl !== title ? lbl : null,
      chip: {
        text: vs ? verseLabel(vs) : 'Cited passage',
        a11yLabel: 'Go to the cited passage' + (vs ? ', ' + spokenVerses(vs) : ''),
      },
    };
  }

  const VM = {
    formatVerses, verseLabel, anchorVerses, cleanSnippet, quoteSnippet, verseUid,
    buildView, talkHeading,
    initialState, filterPlan, applyPlan, collapseAllPlan, collapseLabel, allRows,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VM;
  root.__BTX = Object.assign(root.__BTX || {}, { citVM: VM });
})(typeof globalThis !== 'undefined' ? globalThis : this);
