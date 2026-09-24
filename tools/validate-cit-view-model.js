#!/usr/bin/env node
/*
 * Exercise the pure citation view-model. Run: node tools/validate-cit-view-model.js
 *
 * The view-model turns chapterData into descriptors (verse groups, source-type
 * groups, one row per talk) with no DOM involved, so the list's rules are
 * checkable here: anchor-verse dedup, one row per talk, both citation-layout
 * orderings, which groups start open, snippet cleaning and quoting, every label
 * (summary, counts, verse, range, screen-reader), the filter / collapse-all
 * state transitions, and the talk reader's heading.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const path = require('path');
const VM = require(path.resolve(__dirname, '..', 'src', 'citations', 'cit-view-model.js'));

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
const eq = (a, b, msg) => check(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Every collapsible group in the tree (verse groups plus their source-type
// groups), and the cites still showing under a plan — the panel walks the same
// two shapes when it mirrors a plan onto the DOM.
const allGroups = (view) => view.groups.reduce((acc, g) => acc.concat([g], g.children), []);
const visibleRowIds = (view, plan) =>
  VM.allRows(view).filter((r) => !plan.hidden[r.uid]).map((r) => r.citId);

// --- fixtures -------------------------------------------------------------
// Shape mirrors citData.chapterData: entries keyed by citId, each carrying its
// talk and in-chapter verse span, plus a verse -> citId index.
function makeData(cites) {
  const byVerse = {};
  const entries = {};
  for (const c of cites) {
    entries[c.citId] = {
      citId: c.citId,
      talkId: c.talkId || 't-' + c.citId,
      versesInChapter: c.verses,
      snippet: c.snippet || '',
      source: c.source,
    };
    for (const v of c.verses) (byVerse[v] = byVerse[v] || []).push(c.citId);
  }
  const verseOrder = Object.keys(byVerse).map(Number).sort((a, b) => a - b);
  return { verseOrder, byVerse, entries, uniqueTotal: cites.length };
}

// Labels in the shipped sources.json shapes.
const gc = (sp, ti, d) => ({ c: 'G', sp, ti, d, lbl: `${d} General Conference` });
const jod = (sp, ti, d, lbl) => ({ c: 'J', sp, ti, d, lbl: lbl || 'Journal of Discourses 4:12' });
const tpjs = (sp, ti, d) => ({ c: 'T', sp, ti, d, lbl: 'Teachings of the Prophet Joseph Smith, p. 2' });

// Ten one-cite talks far from the verses under test, so a fixture passes the
// open-everything threshold (12 talks) and its groups start collapsed.
const FILLER = Array.from({ length: 10 }, (_, i) =>
  ({ citId: 'f' + i, verses: [40 + i], source: gc('Filler', 'Pad', '1990-04'), snippet: 'padding' }));

const OPTS = { view: 'verse', fullName: 'John', chapter: 3 };
const SRC = { view: 'source', fullName: 'John', chapter: 3 };

// --- pure helpers ---------------------------------------------------------
console.log('Helpers:');
deep(VM.anchorVerses([3, 4, 5, 10, 11]), [3, 10], 'anchorVerses splits contiguous ranges');
deep(VM.anchorVerses([24, 45, 46]), [24, 45], 'anchorVerses on a gap');
deep(VM.anchorVerses([16]), [16], 'anchorVerses of a single verse');
deep(VM.anchorVerses([]), [], 'anchorVerses of an empty span');

eq(VM.formatVerses([3, 4, 5, 6, 7, 8, 9, 10]), '3–10', 'formatVerses collapses a run');
eq(VM.formatVerses([24, 45, 46]), '24, 45–46', 'formatVerses mixes singles and runs');
eq(VM.formatVerses([]), '', 'formatVerses of nothing');
eq(VM.verseLabel([16]), 'v. 16', 'verseLabel singular');
eq(VM.verseLabel([3, 4]), 'vv. 3–4', 'verseLabel plural');
eq(VM.verseLabel([3, 4, 5, 6, 10, 11]), 'vv. 3–6, 10–11', 'verseLabel of a split range');
eq(VM.verseUid(16), 'v:16', 'verseUid names the by-verse group');

// --- snippet cleaning -------------------------------------------------------
// Each case is a shape found in the shipped data (tools/build-citation-data.js
// strips the talk paragraph, BYU markup and all).
console.log('Snippets:');
eq(VM.cleanSnippet('[ p. 316b] phet and Revelator, he was filled'),
  '…phet and Revelator, he was filled', 'leading JoD page break goes; a mid-word start gets "…"');
eq(VM.cleanSnippet('“[ p. 279a] some sign of pity'),
  '“…some sign of pity', 'the "…" goes inside an opening quote');
eq(VM.cleanSnippet('you will find [ p. 344b]'),
  '…you will find…', 'a trailing page break means the passage runs on');
eq(VM.cleanSnippet('From the east, Ps. 107:2-3 [ p. 75a] and the west'),
  'From the east, Ps. 107:2-3 and the west', 'a mid-passage page break goes');
eq(VM.cleanSnippet('I pray. 6 [ See Moses 6:34 see also 2 Nephi 26:33 ] His way is plain.'),
  'I pray. His way is plain.', 'a closed footnote goes whole');
eq(VM.cleanSnippet('“He is love.” 24 [ 1 John 4:8 ] As John wrote'),
  '“He is love.” As John wrote', 'a closed bare-reference footnote goes whole');
eq(VM.cleanSnippet('Two are better than one, 1 [See Eccl. 4:9 as our Father confirmed'),
  'Two are better than one, as our Father confirmed', 'an unclosed See footnote loses only its references');
eq(VM.cleanSnippet('The sweet power of prayer. 14 [See Matt. 17:21 Mark 9:29 1 Cor. 7:5 Mosiah 27:22–23 3 Ne. 27:1 D&C 88:76 It is'),
  'The sweet power of prayer. It is', 'a run of references goes up to the prose');
eq(VM.cleanSnippet('Satan wants us miserable. 31 [See 2 Ne. 2:17–18, 27 He would'),
  'Satan wants us miserable. He would', 'verse lists with commas are one reference');
eq(VM.cleanSnippet('on the third day, 2 [ See Isaiah 53:7 1 Nephi 11:21, 33 13:40 Mosiah…'),
  '…on the third day,…', 'a reference list cut off at the end goes too');
eq(VM.cleanSnippet('never slumbers. 16 [ See Psalm…'),
  '…never slumbers. …', 'a footnote cut off at its first reference goes');
eq(VM.cleanSnippet('faithful obedience. 16 [Scriptures give encouragement to'),
  '…faithful obedience. Scriptures give encouragement to', 'an unclosed prose footnote loses only its marker');
eq(VM.cleanSnippet('the “seeketh-not-her-own” [see 1 Cor. 13:5 kind of'),
  '…the “seeketh-not-her-own” kind of', 'an inline "[see …" reference goes');
eq(VM.cleanSnippet('upon me [that is upon Jesus Christ], he shall'),
  '…upon me [that is upon Jesus Christ], he shall', 'editorial brackets in the talk survive');
eq(VM.cleanSnippet('a still small voice 1 Kgs. 19:12 [Laughter]. Before'),
  '…a still small voice 1 Kgs. 19:12 [Laughter]. Before', 'a bracket after a verse number is not a footnote');
eq(VM.cleanSnippet('  Hope   comes of faith  .'), 'Hope comes of faith.', 'whitespace collapses, no space before punctuation');
eq(VM.cleanSnippet(''), '', 'empty stays empty');
eq(VM.quoteSnippet('Born again'), '“Born again”', 'plain text is quoted');
eq(VM.quoteSnippet('“Verily,” he said'), '“Verily,” he said', 'text already opening on a quote is not quoted twice');
eq(VM.quoteSnippet('"... no man can say'), '"... no man can say', 'a straight opening quote counts too');
eq(VM.quoteSnippet(''), '', 'no snippet, no quote marks');

// --- by-verse layout ------------------------------------------------------
console.log('By-verse layout:');
{
  const data = makeData([
    { citId: 'a', verses: [3, 4, 5], source: gc('Nelson', 'Born Again', '2020-04'), snippet: 'water and spirit' },
    { citId: 'b', verses: [4], source: jod('Young', 'On Rebirth', '1857-07', 'Journal of Discourses 26:278') },
    { citId: 'c', verses: [16], source: gc('Oaks', 'God So Loved', '2021-10') },
  ].concat(FILLER));
  const view = VM.buildView(data, OPTS);

  eq(view.layout, 'verse', 'layout is by verse');
  eq(view.empty, false, 'not empty');
  // Anchor-verse dedup: cite "a" spans 3–5 but anchors only at 3, so verse 5
  // (mid-range, nothing else on it) yields no verse group at all.
  deep(view.groups.slice(0, 3).map((g) => g.label), ['Verse 3', 'Verse 4', 'Verse 16'],
    'a "Verse {v}" group per verse with an anchored cite');
  deep(view.groups.slice(0, 3).map((g) => g.verse), [3, 4, 16], 'verse groups carry their verse');

  const v3 = view.groups[0], v4 = view.groups[1];
  deep(v3.children.flatMap((c) => c.rows.map((r) => r.citId)), ['a'], 'v3 holds the spanning cite');
  deep(v4.children.flatMap((c) => c.rows.map((r) => r.citId)), ['b'], 'v4 holds only its own cite, not the spanning one');

  eq(v3.count, 1, 'verse chip counts talks');
  eq(v3.a11yLabel, 'Verse 3, 1 talk', 'verse group names itself for a screen reader');
  eq(v3.children[0].label, 'General Conference', 'source-type group label');
  eq(v3.children[0].a11yLabel, 'General Conference, 1 talk', 'source-type group screen-reader label');
  eq(v3.children[0].countClass, 'btx-grp-gc', 'source-type chip class');

  eq(allGroups(view).filter((g) => g.kind === 'sourceType').every((g) => g.open), true,
    'source-type groups start open, so opening a verse shows its talks');
  eq(v3.open, false, 'verse groups start collapsed on a chapter with many talks');

  // Range badge only on spanning cites.
  eq(v3.children[0].rows[0].rangeLabel, 'vv. 3–5', 'spanning cite carries its range label');
  eq(v4.children[0].rows[0].rangeLabel, null, 'single-verse cite has no range label');

  // Row descriptor content.
  const row = v3.children[0].rows[0];
  eq(row.speaker, 'Nelson', 'row speaker');
  eq(row.sub, 'Born Again · 2020-04', 'sub line drops the redundant "General Conference"');
  eq(row.snippet, '“…water and spirit”', 'snippet is cleaned and quoted for display');
  eq(row.a11yLabel, 'Nelson, Born Again, 2020-04, verses 3 to 5', 'row names speaker, talk and range for a screen reader');
  eq(row.search, 'nelson born again 2020-04 general conference 2020-04 …water and spirit', 'filter haystack is lowercased');
  eq(row.entry, data.entries.a, 'row keeps its entry for the talk reader');
  eq(row.talkId, 't-a', 'row names its talk');

  const jodRow = v4.children[0].rows[0];
  eq(jodRow.sub, 'On Rebirth · vol. 26, p. 278', 'Journal of Discourses volume:page is spelled out');
  eq(jodRow.a11yLabel, 'Young, On Rebirth, vol. 26, p. 278', 'no range in the label of a single-verse row');
}

{
  // A cite covering two contiguous ranges anchors twice: it is listed under
  // verse 3 and again under verse 10, each time badged with its full coverage,
  // and the two rows must not collide on one uid.
  const data = makeData([
    { citId: 'a', verses: [3, 4, 5, 10, 11], source: gc('Holland', 'Born of Water', '2015-04') },
    { citId: 'b', verses: [10], source: gc('Bednar', 'Converted', '2019-10') },
  ]);
  const view = VM.buildView(data, OPTS);
  deep(view.groups.map((g) => g.label), ['Verse 3', 'Verse 10'], 'one verse group per anchor verse');
  deep(view.groups[0].children[0].rows.map((r) => r.citId), ['a'], 'first range anchors at v3');
  deep(view.groups[1].children[0].rows.map((r) => r.citId), ['b', 'a'], 'second range anchors at v10, newest talk first');
  eq(view.groups[0].children[0].rows[0].rangeLabel, 'vv. 3–5, 10–11', 'both anchors badge full coverage');
  eq(view.groups[1].children[0].rows[1].rangeLabel, 'vv. 3–5, 10–11', 'including the second one');
  eq(view.groups[0].count, 1, 'v3 chip counts only what anchors there');
  eq(view.groups[1].count, 2, 'v10 chip counts both');

  const rowUids = VM.allRows(view).map((r) => r.uid);
  eq(new Set(rowUids).size, rowUids.length, 'the twice-anchored cite gets two distinct row uids');
  eq(new Set(allGroups(view).map((g) => g.uid)).size, allGroups(view).length, 'group uids are unique');
}

{
  // Two cites of one talk on the same verse are one row: the earliest cite
  // represents it and the badge covers both.
  const talk = gc('Cannon', 'The New Birth', '1990-10');
  const data = makeData([
    { citId: 'x2', talkId: 'T1', verses: [16, 17], source: talk, snippet: 'second' },
    { citId: 'x1', talkId: 'T1', verses: [16], source: talk, snippet: 'first' },
    { citId: 'y', verses: [16], source: gc('Oaks', 'C', '2021-10') },
  ]);
  const g = VM.buildView(data, OPTS).groups[0];
  eq(g.count, 2, 'verse chip counts two talks, not three cites');
  deep(g.children[0].rows.map((r) => r.talkId), ['t-y', 'T1'], 'one row per talk, newest first');
  const merged = g.children[0].rows[1];
  eq(merged.citId, 'x1', 'the earliest cite opens the talk');
  eq(merged.rangeLabel, 'vv. 16–17', 'the badge covers every verse the talk cites here');
  check(merged.search.includes('first') && merged.search.includes('second'), 'the filter matches any of its passages');
}

{
  // Source-type groups in GC/JoD/TPJS order, each with its own count.
  const data = makeData([
    { citId: 'a', verses: [16], source: jod('Young', 'A', '1857-07') },
    { citId: 'b', verses: [16], source: tpjs('Smith', '', '') },
    { citId: 'c', verses: [16], source: gc('Oaks', 'C', '2021-10') },
  ]);
  const g = VM.buildView(data, OPTS).groups[0];
  eq(g.count, 3, 'verse chip counts all three');
  deep(g.children.map((c) => c.key), ['gc', 'jod', 'tpjs'], 'source-type groups keep their fixed order');
  deep(g.children.map((c) => c.count), [1, 1, 1], 'per-source-type counts');
  eq(g.children[2].rows[0].sub, 'p. 2', 'an untitled Teachings row shows its page');

  const session = makeData([{ citId: 'w', verses: [1], source: { c: 'G', sp: 'Monson', ti: 'Courage', d: '2009-03', lbl: '03 2009 General Conference' } }]);
  eq(VM.buildView(session, OPTS).groups[0].children[0].rows[0].sub, 'Courage · March 2009',
    'a session the build labels by month number gets its month name');
}

{
  // focusVerse opens and marks its verse group.
  const data = makeData([
    { citId: 'a', verses: [3], source: gc('A', 'T', '2020-04') },
    { citId: 'b', verses: [16], source: gc('B', 'T', '2020-04') },
    { citId: 'e', verses: [20], source: gc('E', 'T', '2020-04') },
  ].concat(FILLER));
  const view = VM.buildView(data, Object.assign({}, OPTS, { focusVerse: 16 }));
  const [v3, v16] = view.groups;
  eq(v16.open, true, 'focus verse group starts open');
  eq(v16.focus, true, 'focus verse group is marked');
  eq(v3.focus, false, 'other verse groups are not');
  eq(v3.open, false, 'other verse groups stay collapsed');
  eq(view.focusUid, v16.uid, 'view names the focus group');
}

// --- by-source layout -----------------------------------------------------
console.log('By-source layout:');
{
  const data = makeData([
    { citId: 'a', verses: [16], source: gc('Late', 'T', '2021-10') },
    { citId: 'b', verses: [3, 4], source: gc('Early', 'T', '1999-04') },
    { citId: 'c', verses: [3, 4], source: gc('Newer', 'T', '2015-04') },
    { citId: 'd', verses: [5], source: jod('Young', 'T', '1857-07') },
  ].concat(FILLER));
  const view = VM.buildView(data, SRC);

  eq(view.layout, 'source', 'layout is by source');
  deep(view.groups.map((g) => g.key), ['gc', 'jod'], 'only non-empty source-type groups, in order');
  deep(view.groups[0].rows.slice(0, 3).map((r) => r.citId), ['a', 'c', 'b'], 'talks order newest first');
  eq(view.groups[0].children.length, 0, 'by-source groups hold rows directly');
  eq(view.groups[0].rows[1].rangeLabel, 'vv. 3–4', 'every by-source row is range-labelled');
  eq(view.groups[0].rows[0].rangeLabel, 'v. 16', 'single-verse row is labelled too');
  eq(view.groups[0].count, 13, 'source-type chip counts its talks');
  eq(view.groups[0].a11yLabel, 'General Conference, 13 talks', 'source-type screen-reader label');
  eq(view.groups[0].open, false, 'by-source groups start collapsed on a chapter with many talks');
}

{
  // One row per talk: the 17-cite Journal of Discourses sermon is one row.
  const talk = jod('Cannon', 'The New Birth, Etc.', '1871-05', 'Journal of Discourses 14:321');
  const data = makeData([
    { citId: 'k3', talkId: 'J1', verses: [5], source: talk, snippet: 'third passage' },
    { citId: 'k1', talkId: 'J1', verses: [3, 4], source: talk, snippet: 'first passage' },
    { citId: 'k2', talkId: 'J1', verses: [7], source: talk, snippet: 'second passage' },
    { citId: 'u', verses: [2], source: jod('Taylor', 'Design of God', '1884-03') },
    { citId: 'undated', verses: [1], source: jod('Anon', 'Undated', '') },
  ]);
  const view = VM.buildView(data, SRC);
  const rows = view.groups[0].rows;
  deep(rows.map((r) => r.talkId), ['t-u', 'J1', 't-undated'], 'one row per talk, newest first, undated last');
  eq(rows[1].citId, 'k1', 'the merged row opens at the earliest cite');
  eq(rows[1].rangeLabel, 'vv. 3–5, 7', 'the badge is the union of every cite');
  eq(rows[1].snippet, '“…first passage”', 'the snippet is the earliest cite’s');
  eq(rows[1].sub, 'The New Birth, Etc. · vol. 14, p. 321', 'Journal of Discourses location is spelled out');
  eq(view.groups[0].count, 3, 'the group counts talks');
  eq(view.talks, 3, 'the view counts talks');
  eq(view.summary, '3 talks cite this chapter', 'summary counts talks, not cites');
}

// --- summary line + open rules + toolbar gate ----------------------------
console.log('Summary line:');
{
  const one = makeData([{ citId: 'a', verses: [16], source: gc('A', 'T', '2020-04') }]);
  eq(VM.buildView(one, OPTS).summary, '1 talk cites this chapter', 'singular, by verse');
  eq(VM.buildView(one, SRC).summary, '1 talk cites this chapter', 'singular, by source');

  const three = makeData([
    { citId: 'a', verses: [3], source: gc('A', 'T', '2020-04') },
    { citId: 'b', verses: [4], source: gc('B', 'T', '2020-04') },
    { citId: 'c', verses: [5], source: gc('C', 'T', '2020-04') },
  ]);
  eq(VM.buildView(three, OPTS).summary, '3 talks cite this chapter', 'plural, by verse');
  eq(VM.buildView(three, SRC).summary, '3 talks cite this chapter', 'plural, by source');
  eq(VM.buildView(three, OPTS).showTools, false, 'toolbar hidden below 4 talks');
  eq(allGroups(VM.buildView(three, OPTS)).every((g) => g.open), true, 'a small chapter opens everything, by verse');
  eq(VM.buildView(three, SRC).groups.every((g) => g.open), true, 'a small chapter opens everything, by source');

  const four = makeData([3, 4, 5, 6].map((v) => ({ citId: 'c' + v, verses: [v], source: gc('S', 'T', '2020-04') })));
  eq(VM.buildView(four, OPTS).showTools, true, 'toolbar shown from 4 talks');

  const twelve = makeData(Array.from({ length: 12 }, (_, i) => ({ citId: 'c' + i, verses: [i + 1], source: gc('S', 'T', '2020-04') })));
  eq(VM.buildView(twelve, OPTS).groups.every((g) => g.open), true, '12 talks still open everything');
  const thirteen = makeData(Array.from({ length: 13 }, (_, i) => ({ citId: 'c' + i, verses: [i + 1], source: gc('S', 'T', '2020-04') })));
  eq(VM.buildView(thirteen, OPTS).groups.some((g) => g.open), false, '13 talks start collapsed');

  // The same talk citing twice counts once toward the threshold.
  const repeat = makeData(Array.from({ length: 13 }, (_, i) =>
    ({ citId: 'c' + i, talkId: i < 2 ? 'same' : undefined, verses: [i + 1], source: gc('S', 'T', '2020-04') })));
  eq(VM.buildView(repeat, OPTS).talks, 12, 'talks are counted once each');
  eq(VM.buildView(repeat, OPTS).groups.every((g) => g.open), true, 'the open-everything threshold counts talks');
}

console.log('Empty states:');
{
  const none = VM.buildView(null, OPTS);
  eq(none.empty, true, 'null data is empty');
  eq(none.emptyText, 'No citation data for this book.', 'no shard for the book');
  deep(none.groups, [], 'no groups');

  const zero = VM.buildView({ verseOrder: [], byVerse: {}, entries: {}, uniqueTotal: 0 }, OPTS);
  eq(zero.empty, true, 'zero cites is empty');
  eq(zero.emptyText, 'No talks cite John 3.', 'chapter with no citing talks');
  eq(zero.summary, null, 'no summary line when empty');
}

// --- filter + collapse-all ------------------------------------------------
console.log('Toolbar state:');
{
  const data = makeData([
    { citId: 'a', verses: [3], source: gc('Nelson', 'Born Again', '2020-04'), snippet: 'water and spirit' },
    { citId: 'b', verses: [4], source: jod('Young', 'On Rebirth', '1857-07'), snippet: 'the new birth' },
    { citId: 'c', verses: [16], source: gc('Oaks', 'God So Loved', '2021-10'), snippet: 'only begotten' },
    { citId: 'd', verses: [17], source: gc('Nelson', 'Condemn Not', '2019-10'), snippet: 'to save the world' },
  ].concat(FILLER));
  const view = VM.buildView(data, OPTS);
  const state = VM.initialState(view);

  eq(allGroups(view).length, 28, 'fourteen verse groups plus one source-type group each');
  eq(Object.keys(state.open).length, 28, 'initial open state covers every collapsible group');
  eq(state.preFilterOpen, null, 'no captured state before filtering');
  eq(VM.collapseLabel(view, state), null, 'nothing open -> no Collapse all button');

  const idle = VM.filterPlan(view, '', state);
  eq(idle.summary, '14 talks cite this chapter', 'an empty query shows the plain summary');
  eq(idle.counts[view.groups[0].uid], 1, 'an empty query shows the full counts');
  eq(idle.noResults, null, 'an empty query has no no-results line');

  // The user opens verse 3 by hand.
  const v3 = view.groups[0];
  state.open[v3.uid] = true;
  eq(VM.collapseLabel(view, state), 'Collapse all', 'an open verse -> Collapse all shows');

  // Filtering: non-matching rows and now-empty groups hide; survivors open.
  const plan = VM.filterPlan(view, 'Nelson ', state);
  eq(plan.filtering, true, 'a non-empty query filters');
  eq(plan.anyMatch, true, 'nelson matches');
  deep(visibleRowIds(view, plan), ['a', 'd'], 'only Nelson rows survive');
  eq(plan.hidden[view.groups[1].uid], true, 'the verse group with no surviving row hides');
  eq(plan.hidden[view.groups[0].uid], false, 'the verse group with a survivor stays');
  eq(plan.open[view.groups[3].uid], true, 'surviving groups open so matches are visible');
  eq(plan.preFilterOpen[v3.uid], true, 'pre-filter open state is captured');
  eq(plan.preFilterOpen[view.groups[1].uid], false, 'including the closed groups');
  eq(plan.collapseLabel, 'Collapse all', 'matches are open, so they can be collapsed');
  eq(plan.summary, '2 of 14 talks match', 'the summary counts matching talks');
  eq(plan.counts[view.groups[0].uid], 1, 'group counts show visible talks');
  eq(plan.counts[view.groups[1].uid], 0, 'a hidden group counts zero');
  eq(plan.a11y[view.groups[3].uid], 'Verse 17, 1 talk', 'screen-reader labels follow the visible count');
  eq(plan.noResults, null, 'matches -> no no-results line');

  const one = VM.filterPlan(view, 'oaks', state);
  eq(one.summary, '1 of 14 talks matches', 'a single match reads singular');

  // A second keystroke keeps the originally captured state, not the filtered one.
  const state2 = VM.applyPlan(state, plan);
  const plan2 = VM.filterPlan(view, 'nelsonx', state2);
  eq(plan2.anyMatch, false, 'no row matches');
  deep(visibleRowIds(view, plan2), [], 'nothing visible');
  eq(plan2.preFilterOpen[v3.uid], true, 'the first capture is not overwritten by filtered opens');
  eq(plan2.summary, '0 of 14 talks match', 'the summary says nothing matched');
  eq(plan2.noResults, 'No talks match “nelsonx”.', 'the no-results line quotes the query');
  eq(plan2.collapseLabel, null, 'nothing visible -> no Collapse all button');

  // Clearing restores the pre-filter open state and drops the capture.
  const plan3 = VM.filterPlan(view, '', VM.applyPlan(state2, plan2));
  eq(plan3.filtering, false, 'empty query stops filtering');
  eq(plan3.open[v3.uid], true, 'the hand-opened group stays open');
  eq(plan3.open[view.groups[3].uid], false, 'groups opened only by the filter close again');
  eq(plan3.preFilterOpen, null, 'the capture is released');
  deep(visibleRowIds(view, plan3).slice(0, 4), ['a', 'b', 'c', 'd'], 'all rows visible again');
  eq(plan3.counts[view.groups[0].uid], view.groups[0].count, 'full counts come back');

  // Collapse all folds visible top-level groups and leaves nested ones alone.
  const cleared = VM.applyPlan(state2, plan3);
  const filtered = VM.applyPlan(cleared, VM.filterPlan(view, 'nelson', cleared));
  const collapse = VM.collapseAllPlan(view, filtered, VM.filterPlan(view, 'nelson', cleared).hidden);
  deep(Object.keys(collapse.open), [view.groups[0].uid, view.groups[3].uid], 'only the visible verse groups fold');
  eq(Object.values(collapse.open).some(Boolean), false, 'and they all close');
  const after = VM.applyPlan(filtered, collapse);
  eq(after.open[view.groups[0].children[0].uid], true, 'a nested source-type group stays open for next time');
  eq(VM.collapseLabel(view, after), null, 'all folded -> the button hides');
}

// --- talk reader heading ---------------------------------------------------
{
  const h = VM.talkHeading(gc('David L. Buckner', '“Ye Are My Friends”', 'October 2024'), [1, 2, 3, 4, 5]);
  eq(h.title, '“Ye Are My Friends”', 'a talk heading is titled by the talk');
  eq(h.speaker, 'David L. Buckner', 'the speaker opens the byline');
  eq(h.where, 'October 2024 General Conference', 'the source label closes the byline');
  eq(h.chip.text, 'vv. 1–5', 'the chip names the cited verses');
  eq(h.chip.a11yLabel, 'Go to the cited passage, verses 1 to 5', 'and says what it does');

  // Every TPJS source ships an empty title.
  const t = VM.talkHeading({ c: 'T', sp: 'Joseph Smith, Jr.', ti: '', lbl: 'Teachings of the Prophet Joseph Smith, p. 264' }, [5]);
  eq(t.title, 'Teachings of the Prophet Joseph Smith, p. 264', 'TPJS is titled by its page label');
  eq(t.where, null, 'so the byline does not repeat it');
  eq(t.chip.text, 'v. 5', 'a one-verse chip');

  const bare = VM.talkHeading({}, []);
  eq(bare.title, 'Untitled talk', 'no title and no label');
  eq(bare.speaker, null, 'no speaker line when the speaker is unknown');
  eq(bare.chip.text, 'Cited passage', 'a cite without verses still gets a chip');
  eq(bare.chip.a11yLabel, 'Go to the cited passage', 'with a plain label');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
