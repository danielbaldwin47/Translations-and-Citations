/*
 * Pure view-model for Citations mode: chapter data in, descriptors out. No DOM.
 *
 *   citData.chapterData(slug, chapter)  ->  buildView(data, opts)  ->  cit-panel
 *
 * Owns every rule about what the list says and how it is arranged: which cites
 * anchor at which verse, one row per talk, the corpus -> source-type bucketing,
 * both citation-layout orderings, which groups start open, snippet cleaning and
 * quoting, every label (summary, counts, verse, range, screen-reader), and the
 * filter / collapse-all state transitions. cit-panel is a thin adapter from
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

  function verseLabel(vs) {
    return (vs && vs.length > 1 ? 'vv. ' : 'v. ') + formatVerses(vs);
  }

  // The same range spelled for a screen reader: "verses 3 to 5, 10".
  function spokenVerses(vs) {
    return (vs.length > 1 ? 'verses ' : 'verse ') + formatVerses(vs).replace(/–/g, ' to ');
  }

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

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  // Shorten the source label by dropping the part the group already conveys
  // ("October 2025 General Conference" -> "October 2025"). The build spells
  // only April and October; other sessions arrive as "09 2019" and get their
  // month name. Journal of Discourses stores volume:page, which reads like a
  // scripture reference in a list full of them, so it is spelled out:
  // "26:278" -> "vol. 26, p. 278".
  function shortLabel(s) {
    const lbl = s.lbl || '';
    let out = lbl;
    if (s.c === 'G' || s.c === 'E') {
      out = lbl.replace(/\s*General Conference\s*$/i, '').trim()
        .replace(/^(\d{2}) (\d{4})$/, (m, mo, y) => (MONTHS[Number(mo) - 1] ? `${MONTHS[Number(mo) - 1]} ${y}` : m));
    } else if (s.c === 'J') {
      out = lbl.replace(/^Journal of Discourses\s*/i, '').trim();
      const m = /^(\d+):(\d+)$/.exec(out);
      if (m) out = `vol. ${m[1]}, p. ${m[2]}`;
    } else if (s.c === 'T') out = lbl.replace(/^Teachings of the Prophet Joseph Smith,?\s*/i, '').trim();
    return out || s.d || '';
  }

  // --- snippet cleaning ------------------------------------------------------
  // Snippets are the talk paragraph's text as the build stripped it, so they
  // carry the BYU markup's debris. Each pattern is anchored on its exact shape
  // so real bracketed text in a talk ("[that is upon Jesus Christ]") survives:
  //   [ p. 279a]                   Journal of Discourses page break
  //   6 [ Moroni 7:47 ]            a closed footnote after its number
  //   14 [See Matt. 17:21 Mark 9:29  an unclosed "See" footnote: its scripture
  //                                references, which end where prose resumes
  //   16 [Scriptures give…         an unclosed prose footnote: only the marker
  //                                goes, since nothing marks where it ends
  const NUMS = String.raw`\d+(?:[–-]\d+)?(?:,\s?\d+(?:[–-]\d+)?)*`;
  const BOOK = String.raw`(?:[1-4]\s)?[A-Z][A-Za-z&.]*(?:(?:\s|—)(?:of|and|the|[A-Z][A-Za-z&.]*))*`;
  const REF = String.raw`${BOOK}\s\d+(?::${NUMS})?(?:\s\d+:${NUMS})*`;
  // A reference list the build's 200-character cut left half-written ("Mosiah…").
  const CUT_REF = String.raw`\s*(?:${BOOK}|[1-4])[\s\d:,–-]*(?=…$)`;
  const RE = {
    pageAtEnd: /\s*\[\s*p\.\s*\d+[ab]?\s*\]\s*$/,
    page: /\s*\[\s*p\.\s*\d+[ab]?\s*\]\s*/g,
    closedNote: /\s\d{1,3}\s?\[[^[\]]*\]/g,
    seeNote: new RegExp(String.raw`(?:\s\d{1,3})?\s?\[\s*[Ss]ee\s+(?:also\s+)?` +
      String.raw`(?:${REF}(?:[;,]?\s+(?:see also\s+)?${REF})*\.?(?:${CUT_REF})?|${CUT_REF})(?:\s*\])?`, 'g'),
    noteMark: /\s\d{1,3}\s?\[\s*(?![^[\]]*\])/g,
  };

  // A page break at the very end means the passage runs on overleaf, so it
  // becomes "…"; a passage that starts mid-sentence (lowercase) gets a leading
  // "…" inside any opening quote mark.
  function cleanSnippet(raw) {
    let t = String(raw || '');
    t = t.replace(RE.pageAtEnd, '…').replace(RE.page, ' ');
    t = t.replace(RE.closedNote, ' ').replace(RE.seeNote, ' ').replace(RE.noteMark, ' ');
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
    const snippet = cleanSnippet(entry.snippet);
    const haystack = [s.sp, s.ti, s.lbl, where].concat(talk.cites.map((c) => cleanSnippet(c.snippet)));
    return {
      uid: `${uidPrefix}/${i}:${entry.citId}`,
      citId: entry.citId,
      talkId: talkIdOf(entry),
      speaker,
      rangeLabel: rangeVerses ? verseLabel(rangeVerses) : null,
      sub: [s.ti, where].filter(Boolean).join(' · ') || null,
      snippet: quoteSnippet(snippet),
      a11yLabel: [speaker, s.ti, where, rangeVerses && spokenVerses(rangeVerses)].filter(Boolean).join(', '),
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
        uid, kind: 'verse', key: String(v), verse: v, label: `Verse ${v}`,
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

  // opts: { view: 'verse'|'source', fullName, chapter, focusVerse }
  // data: citData.chapterData(...) — null when the book has no shard.
  function buildView(data, opts) {
    opts = opts || {};
    // Callers pass the layout through from the settings; the fallback matches
    // that schema's default ('source') rather than inventing a second one.
    const layout = opts.view === 'verse' ? 'verse' : 'source';
    const where = `${opts.fullName || ''} ${opts.chapter}`.trim();

    if (!data || !data.verseOrder.length || data.uniqueTotal === 0) {
      return {
        layout, empty: true,
        emptyText: !data ? 'No citation data for this book.' : `No talks cite ${where}.`.trim(),
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
    const plan = {
      filtering, anyMatch, hidden, open, preFilterOpen, counts, a11y,
      summary: filtering
        ? `${matched.size} of ${talkCount(viewModel.talks)} ${matched.size === 1 ? 'matches' : 'match'}`
        : viewModel.summary,
      noResults: filtering && !anyMatch ? `No talks match “${shown}”.` : null,
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

  const VM = {
    formatVerses, verseLabel, anchorVerses, cleanSnippet, quoteSnippet, verseUid,
    buildView,
    initialState, filterPlan, applyPlan, collapseAllPlan, collapseLabel, allRows,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VM;
  root.__BTX = Object.assign(root.__BTX || {}, { citVM: VM });
})(typeof globalThis !== 'undefined' ? globalThis : this);
