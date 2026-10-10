#!/usr/bin/env node
/*
 * Exercise the pure citation view-model. Run: node tools/validate-cit-view-model.js
 *
 * The view-model turns chapterData into descriptors (verse groups, source-type
 * groups, one row per talk) with no DOM involved, so the list's rules are
 * checkable here: anchor-verse dedup, one row per talk, both citation-layout
 * orderings, which groups start open, snippet cleaning and quoting, the
 * excerpt source per corpus and the filter haystack, every label
 * (summary, counts, verse, range, screen-reader, empty state), plain-text
 * titles, the filter / collapse-all state transitions, verse queries (the
 * grammar and how a plan matches them), and the talk reader's
 * heading.
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
// The list as it shows with no query: the tree without its query-only groups
// and rows (By verse's talks that only run through a verse; see verseGroups).
const listed = (view) => Object.assign({}, view, {
  groups: view.groups.filter((g) => !g.queryOnly).map((g) => Object.assign({}, g, {
    rows: g.rows.filter((r) => !r.queryOnly),
    children: g.children.filter((c) => !c.queryOnly)
      .map((c) => Object.assign({}, c, { rows: c.rows.filter((r) => !r.queryOnly) })),
  })),
});

// --- fixtures -------------------------------------------------------------
// Pack descriptors as the build writes them for each pack mode
// (tools/build-citation-data.js packDescriptor): the public pack lists no T.
const CORPORA = {
  G: { sourceType: 'General Conference', text: 'live-church', target: 'anchor', excerpt: 'bundled', inclusion: 'all' },
  E: { sourceType: 'General Conference', text: 'live-byu', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all' },
  J: { sourceType: 'Journal of Discourses', text: 'bundled', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all' },
};
const PACK_FACTS = { vintage: '2026-04', base: { db: 'core.53.db', updated: '2026-05-18' }, derived: [] };
const PUBLIC = Object.assign({ flavor: 'public', corpora: CORPORA }, PACK_FACTS);
const PERSONAL = Object.assign({ flavor: 'personal', corpora: Object.assign({}, CORPORA, {
  T: { sourceType: 'Teachings of the Prophet Joseph Smith', text: 'bundled', target: 'bodyPassage', excerpt: 'bundled', inclusion: 'all' },
}) }, PACK_FACTS);

// Shape mirrors citData.chapterData: entries keyed by citId, each carrying its
// talk and in-chapter verse span, plus a verse -> citId index and the pack
// descriptor (the personal one unless a test names another).
function makeData(cites, pack) {
  const byVerse = {};
  const entries = {};
  for (const c of cites) {
    entries[c.citId] = {
      citId: c.citId,
      talkId: c.talkId || 't-' + c.citId,
      versesInChapter: c.verses,
      snippet: c.snippet || '',
      excerptChars: c.excerptChars,
      inFootnote: c.inFootnote,
      source: c.source,
    };
    for (const v of c.verses) (byVerse[v] = byVerse[v] || []).push(c.citId);
  }
  const verseOrder = Object.keys(byVerse).map(Number).sort((a, b) => a - b);
  return { verseOrder, byVerse, entries, uniqueTotal: cites.length, pack: pack || PERSONAL };
}

// Labels in the shipped sources.json shapes.
const gc = (sp, ti, d) => ({ c: 'G', sp, ti, d, lbl: `${d} General Conference` });
const jod = (sp, ti, d, lbl) => ({ c: 'J', sp, ti, d, lbl: lbl || 'Journal of Discourses 4:12' });
const tpjs = (sp, ti, d) => ({ c: 'T', sp, ti, d, lbl: 'Teachings of the Prophet Joseph Smith, p. 2' });

// Ten one-cite talks far from the verses under test, so a fixture has the
// talk counts of a busy chapter (summary, toolbar, by-source chip).
const FILLER = Array.from({ length: 10 }, (_, i) =>
  ({ citId: 'f' + i, verses: [40 + i], source: gc('Filler', 'Pad', '1990-04'), snippet: 'padding' }));

const OPTS = { view: 'verse', fullName: 'John', chapter: 3 };
const SRC = { view: 'source', fullName: 'John', chapter: 3 };

// --- pure helpers ---------------------------------------------------------
console.log('Helpers:');
deep(VM.verseRuns([3, 4, 5, 10, 11]), [[3, 4, 5], [10, 11]], 'verseRuns splits an ascending list into contiguous runs');
deep(VM.verseRuns([24, 45, 46]), [[24], [45, 46]], 'verseRuns on a gap');
deep(VM.verseRuns([]), [], 'verseRuns of an empty span');
deep(VM.verseRuns(undefined), [], 'verseRuns of no span');
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
// The index files a chapter's closing note (JS—H 1) as verse 1000.
eq(VM.verseLabel([1000]), 'Note', 'the note is labelled Note, not v. 1000');
eq(VM.verseLabel([1, 2, 1000]), 'vv. 1–2, note', 'verses and the note');
eq(VM.verseLabel([5, 1000]), 'v. 5, note', 'one verse and the note');

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
eq(VM.cleanSnippet('He overcame the sting of physical and spiritual death, 8 [ See…'),
  'He overcame the sting of physical and spiritual death,…', 'a footnote cut off right after "See" goes');
eq(VM.cleanSnippet('though to us it may seem otherwise. (See…'),
  '…though to us it may seem otherwise. (See…', 'the talk\'s own "(See…" is text, not a footnote');
eq(VM.cleanSnippet('faithful obedience. 16 [Scriptures give encouragement to'),
  '…faithful obedience. Scriptures give encouragement to', 'an unclosed prose footnote loses only its marker');
eq(VM.cleanSnippet('the “seeketh-not-her-own” [see 1 Cor. 13:5 kind of'),
  '…the “seeketh-not-her-own” kind of', 'an inline "[see …" reference goes');
eq(VM.cleanSnippet('upon me [that is upon Jesus Christ], he shall'),
  '…upon me [that is upon Jesus Christ], he shall', 'editorial brackets in the talk survive');
eq(VM.cleanSnippet('a still small voice 1 Kgs. 19:12 [Laughter]. Before'),
  '…a still small voice 1 Kgs. 19:12 [Laughter]. Before', 'a bracket after a verse number is not a footnote');
eq(VM.cleanSnippet('  Hope   comes of faith  .'), 'Hope comes of faith.', 'whitespace collapses, no space before punctuation');
// Unbracketed debris, each only after a sentence ends.
eq(VM.cleanSnippet('and have everlasting life.” 25 John 3:16'),
  '…and have everlasting life.”', 'a live-GC note marker and its reference after a closing quote go');
eq(VM.cleanSnippet('“I that speak unto thee am he.” 8 John 4:26 He demonstrated'),
  '“I that speak unto thee am he.” He demonstrated', 'the note goes up to the prose that resumes');
eq(VM.cleanSnippet('a “Friend of God.” 30 James 2:23 see also 2 Chr. 20:7 Isa. 41:8 Long ago'),
  '…a “Friend of God.” Long ago', 'a note’s whole run of references goes, see also and all');
eq(VM.cleanSnippet('which temple ye are.” 5 1 Corinthians 3:16–17 see also verse 19'),
  '…which temple ye are.”', 'a marker before a numbered book, and a bare "verse 19"');
eq(VM.cleanSnippet('“yielding [our] hearts unto God” 4 Helaman 3:35 and “[receiving] his image'),
  '“…yielding [our] hearts unto God” and “[receiving] his image', 'a 1–4 before a book no number belongs to is a marker');
eq(VM.cleanSnippet('I would ask, can ye feel so now?” 14 Alma…'),
  'I would ask, can ye feel so now?” …', 'a note the cut ended at its book goes');
eq(VM.cleanSnippet('“opposition in all things” 2 Nephi 2:11 is not a flaw'),
  '“…opposition in all things” 2 Nephi 2:11 is not a flaw', 'a 1–4 before a numbered book mid-sentence is the book’s');
eq(VM.cleanSnippet('“come unto Christ” 34 Jacob 1:7 Omni 1:26 Moroni 10:30, 32 D&C 20:59 can also be extended'),
  '“…come unto Christ” can also be extended', 'a certain marker goes even mid-sentence');
eq(VM.cleanSnippet('prepared for this mortal life. 15 [See Doctrine and Covenants 49:17 138 Moses 3:5 6:36'),
  '…prepared for this mortal life.', 'the references a "[See" note left behind go too');
eq(VM.cleanSnippet('266 Prev Next STPJS 266 Enoch was a man'),
  'Enoch was a man', 'the Teachings page header goes');
eq(VM.cleanSnippet('111 Prev Next STPJS 111 the time for the first two'),
  '…the time for the first two', 'and a passage it leaves mid-sentence gets its "…"');
eq(VM.cleanSnippet('light, and condemnation follows. John 3:19 D&C 20:14-15'),
  '…light, and condemnation follows.', 'references BYU inserted between sentences go');
eq(VM.cleanSnippet('meek and lowly of heart. Matt. 11:29 We must confess'),
  '…meek and lowly of heart. We must confess', 'an inserted reference before a new sentence goes');
eq(VM.cleanSnippet('from such turn away” 2 Timothy 3:5 I repeat'),
  '…from such turn away” I repeat', 'an inserted reference after a closing quote goes');
eq(VM.cleanSnippet('there is a God in Israel.” 1 Sam. 17:44–46'),
  '…there is a God in Israel.”', 'an inserted reference at the end goes');
eq(VM.cleanSnippet('for tomorrow we die” 2 Ne.…'),
  '…for tomorrow we die” …', 'an inserted reference the cut left half-written goes');
eq(VM.cleanSnippet('unto the other” Deut. 28:25, 37,…'),
  '…unto the other” …', 'so does one cut inside its verse list');
eq(VM.cleanSnippet('strengthen your family by example. In 1…'),
  '…strengthen your family by example. In 1…', 'a sentence the cut ended is prose, not a reference');
eq(VM.cleanSnippet('His children See, for example, Matthew 28:19–20 Ephesians 4:11–13 Jacob 5:61–62…'),
  'His children…', 'a note whose marker was lost goes by its capital "See"');
eq(VM.cleanSnippet('“Touch not mine anointed,” 1 Chr. 16:22 saith the Lord.'),
  '“Touch not mine anointed,” 1 Chr. 16:22 saith the Lord.', 'a reference mid-sentence stays: it may be the talk’s own');
eq(VM.cleanSnippet('“He is love.” 2 Nephi 2:25 teaches that'),
  '“He is love.” 2 Nephi 2:25 teaches that', 'a sentence that goes on after a reference keeps it');
eq(VM.cleanSnippet('It was so. Brigham Young 1 Then he spoke'),
  'It was so. Brigham Young 1 Then he spoke', 'a name and a number are no reference');
eq(VM.cleanSnippet('eternal judgment (see John 5:29). Then'),
  '…eternal judgment (see John 5:29). Then', 'a talk’s own "(see …)" stays');
// A bare reference's book is one word or a multi-word book's own shape, so
// the prose before an inserted reference is never read as its book.
eq(VM.cleanSnippet('What is it? The Zion of God. D&C 58:7 What does it mean?'),
  'What is it? The Zion of God. What does it mean?', 'an answer ending in a period is prose, not a book');
eq(VM.cleanSnippet('his name was Newel K. Whitney. D&C 72:8 Was he merely'),
  '…his name was Newel K. Whitney. Was he merely', 'so is a name before an inserted reference');
eq(VM.cleanSnippet('for ever. Amen. D&C 64:29, 33–43'), '…for ever. Amen.', 'so is "Amen."');
eq(VM.cleanSnippet('Even so. Amen D&C 56:19-20'),
  'Even so. Amen D&C 56:19-20', 'a word before a reference keeps both (the reference is mid-sentence)');
eq(VM.cleanSnippet('very clear. In Doctrine and Covenants 68:25 D&C 68:25 we read'),
  '…very clear. In Doctrine and Covenants 68:25 D&C 68:25 we read', 'the talk’s own "In Doctrine and Covenants…" stays');
eq(VM.cleanSnippet('“Ye are bought with a price” 1 Cor. 7:23 In the Garden of…'),
  '“Ye are bought with a price” In the Garden of…', 'prose the cut ended is no half-written reference');
eq(VM.cleanSnippet('a great calm.” 8 Mark 4:39 Ever the Master…'),
  '…a great calm.” Ever the Master…', 'nor after a note’s references');
eq(VM.cleanSnippet('in your heart.” 13 Doctrine and…'), '…in your heart.” …', 'a multi-word book the cut left half-written goes');
eq(VM.cleanSnippet('praiseworthy.” 1 A of F 1:13 The First'),
  '…praiseworthy.” The First', 'an "X of Y" book is one book');
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
  const full = VM.buildView(data, OPTS);
  const view = listed(full);

  eq(view.layout, 'verse', 'layout is by verse');
  eq(view.empty, false, 'not empty');
  // Anchor-verse dedup: cite "a" spans 3–5 but anchors only at 3, so verse 5
  // (mid-range, nothing else on it) yields no listed verse group; it and
  // verse 4 carry "a" only as a query-only row.
  deep(full.groups.slice(0, 4).map((g) => [g.label, g.queryOnly]),
    [['Verse 3', false], ['Verse 4', false], ['Verse 5', true], ['Verse 16', false]], 'verse 5 is a query-only group');
  deep(full.groups[1].children.map((c) => [c.key, c.queryOnly, c.rows.map((r) => [r.citId, r.queryOnly])]),
    [['general-conference', true, [['a', true]]], ['journal-of-discourses', false, [['b', false]]]],
    'verse 4 lists its own cite and carries the spanning one query-only, in a query-only source-type group');
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
  eq(v3.children[0].countClass, 'btx-grp-general-conference', 'source-type chip class: the sourceType as a slug, no per-label table');

  eq(allGroups(view).filter((g) => g.kind === 'sourceType').every((g) => g.open), true,
    'source-type groups start open, so opening a verse shows its talks');
  eq(v3.open, false, 'verse groups start collapsed');

  // Range badge only on spanning cites.
  eq(v3.children[0].rows[0].rangeLabel, 'vv. 3–5', 'spanning cite carries its range label');
  eq(v4.children[0].rows[0].rangeLabel, null, 'single-verse cite has no range label');
  eq(v3.children[0].rows[0].rangeTitle, 'Cites verses 3 to 5', 'the range badge explains itself');
  eq(v4.children[0].rows[0].rangeTitle, null, 'no badge, no badge title');

  // Row descriptor content.
  const row = v3.children[0].rows[0];
  eq(row.speaker, 'Nelson', 'row speaker');
  eq(row.sub, 'Born Again · 2020-04', 'sub line drops the redundant "General Conference"');
  eq(row.snippet.text, '“…water and spirit”', 'snippet is cleaned and quoted for display');
  eq(row.a11yLabel, 'Nelson, Born Again, 2020-04, verses 3 to 5', 'row names speaker, talk and range for a screen reader');
  eq(row.search, 'nelson born again 2020-04 general conference 2020-04 …water and spirit', 'filter haystack is lowercased');
  eq(row.entry, data.entries.a, 'row keeps its entry for the talk reader');
  eq(row.talkId, 't-a', 'row names its talk');

  const jodRow = v4.children[0].rows[0];
  eq(jodRow.sub, 'On Rebirth · vol. 26, p. 278', 'Journal of Discourses volume:page is spelled out');
  eq(jodRow.a11yLabel, 'Young, On Rebirth, vol. 26, p. 278', 'no range in the label of a single-verse row');
}

{
  // A few titles carry an italicised word's markup; every surface shows text.
  const src = gc('Reyna I. Aburto', '<em>We</em> Are The Church of Jesus Christ', '2022-04');
  const row = VM.buildView(makeData([{ citId: 'a', verses: [3], source: src }]), OPTS).groups[0].children[0].rows[0];
  eq(row.sub, 'We Are The Church of Jesus Christ · 2022-04', 'the row’s title line drops the tags');
  eq(row.a11yLabel, 'Reyna I. Aburto, We Are The Church of Jesus Christ, 2022-04', 'so does its screen-reader label');
  check(!/[<>]/.test(row.search) && row.search.includes('we are the church'), 'and the filter haystack');
  eq(VM.talkHeading(src, [3]).title, 'We Are The Church of Jesus Christ', 'and the talk reader’s title');
  eq(VM.talkHeading(gc('Hugh B. Brown', '<b>This</b> Gospel…Not <b>A</b> Gospel', '1958-04'), [1]).title,
    'This Gospel…Not A Gospel', 'every tag in a title goes');
}

{
  // The note (verse 1000) is its own group, after the verses, named "Note".
  const data = makeData([
    { citId: 'a', verses: [5], source: gc('A', 'T', '2020-04') },
    { citId: 'n', verses: [1000], source: gc('Cowdery', 'Note', '1990-04') },
  ]);
  const view = VM.buildView(data, OPTS);
  deep(view.groups.map((g) => g.label), ['Verse 5', 'Note'], 'the note group is named Note and comes last');
  eq(view.groups[1].a11yLabel, 'Note, 1 talk', 'and names itself that way to a screen reader');
  eq(VM.buildView(data, SRC).groups[0].rows.find((r) => r.citId === 'n').rangeLabel, 'Note',
    'a by-source row that cites the note is badged Note');
  eq(VM.buildView(data, SRC).groups[0].rows.find((r) => r.citId === 'n').rangeTitle, 'Cites the note',
    'and the Note badge says what the note is');
  eq(VM.buildView(data, SRC).groups[0].rows.find((r) => r.citId === 'n').a11yLabel,
    'Cowdery, Note, 1990-04, the note', 'and says so to a screen reader');
}

{
  // A cite covering two contiguous ranges anchors twice: it is listed under
  // verse 3 and again under verse 10, each time badged with its full coverage,
  // and the two rows must not collide on one uid.
  const data = makeData([
    { citId: 'a', verses: [3, 4, 5, 10, 11], source: gc('Holland', 'Born of Water', '2015-04') },
    { citId: 'b', verses: [10], source: gc('Bednar', 'Converted', '2019-10') },
  ]);
  const full = VM.buildView(data, OPTS);
  const view = listed(full);
  deep(view.groups.map((g) => g.label), ['Verse 3', 'Verse 10'], 'one verse group per anchor verse');
  deep(view.groups[0].children[0].rows.map((r) => r.citId), ['a'], 'first range anchors at v3');
  deep(view.groups[1].children[0].rows.map((r) => r.citId), ['b', 'a'], 'second range anchors at v10, newest talk first');
  eq(view.groups[0].children[0].rows[0].rangeLabel, 'vv. 3–5, 10–11', 'both anchors badge full coverage');
  eq(view.groups[1].children[0].rows[1].rangeLabel, 'vv. 3–5, 10–11', 'including the second one');
  eq(view.groups[0].count, 1, 'v3 chip counts only what anchors there');
  eq(view.groups[1].count, 2, 'v10 chip counts both');

  const rowUids = VM.allRows(full).map((r) => r.uid);
  eq(new Set(rowUids).size, rowUids.length, 'every row uid is distinct, query-only rows too');
  eq(new Set(allGroups(full).map((g) => g.uid)).size, allGroups(full).length, 'group uids are unique');
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
  deep(g.children.map((c) => c.key), ['general-conference', 'journal-of-discourses', 'teachings-of-the-prophet-joseph-smith'], 'source-type groups keep their fixed order');
  deep(g.children.map((c) => c.count), [1, 1, 1], 'per-source-type counts');
  eq(g.children[2].rows[0].sub, 'p. 2', 'an untitled Teachings row shows its page');

  // Sessions the build labels by the month they began belong to that
  // spring's or autumn's conference (Ensign May / November issue).
  const session = (lbl) => VM.buildView(makeData([{ citId: 'w', verses: [1],
    source: { c: 'G', sp: 'Monson', ti: 'Courage', d: '2009-03', lbl } }]), OPTS).groups[0].children[0].rows[0].sub;
  eq(session('03 2009 General Conference'), 'Courage · April 2009', 'a March session is the April conference');
  eq(session('02 1990 General Conference'), 'Courage · April 1990', 'so is a February meeting');
  eq(session('09 2023 General Conference'), 'Courage · October 2023', 'a September session is the October conference');
  eq(session('11 1980 General Conference'), 'Courage · October 1980', 'so is a November one');
  eq(session('October 2023 General Conference'), 'Courage · October 2023', 'a named session is left as it is');
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
  deep(view.groups.map((g) => g.key), ['general-conference', 'journal-of-discourses'], 'only non-empty source-type groups, in order');
  deep(view.groups[0].rows.slice(0, 3).map((r) => r.citId), ['a', 'c', 'b'], 'talks order newest first');
  eq(view.groups[0].children.length, 0, 'by-source groups hold rows directly');
  eq(view.groups[0].rows[1].rangeLabel, 'vv. 3–4', 'every by-source row is range-labelled');
  eq(view.groups[0].rows[0].rangeLabel, 'v. 16', 'single-verse row is labelled too');
  eq(view.groups[0].rows[0].rangeTitle, 'Cites verse 16', 'a single verse: "Cites verse 16"');
  eq(view.groups[0].rows[1].rangeTitle, 'Cites verses 3 to 4', 'a range: "Cites verses 3 to 4"');
  eq(view.groups[0].count, 13, 'source-type chip counts its talks');
  eq(view.groups[0].a11yLabel, 'General Conference, 13 talks', 'source-type screen-reader label');
  eq(view.groups[0].open, false, 'by-source groups start collapsed');
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
  eq(rows[1].snippet.text, '“…first passage”', 'the snippet is the earliest cite’s');
  eq(rows[1].sub, 'The New Birth, Etc. · vol. 14, p. 321', 'Journal of Discourses location is spelled out');
  eq(view.groups[0].count, 3, 'the group counts talks');
  eq(view.talks, 3, 'the view counts talks');
  eq(view.summary, '3 talks cite this chapter', 'summary counts talks, not cites');
}

// --- summary line + toolbar gate -----------------------------------------
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
  const four = makeData([3, 4, 5, 6].map((v) => ({ citId: 'c' + v, verses: [v], source: gc('S', 'T', '2020-04') })));
  eq(VM.buildView(four, OPTS).showTools, true, 'toolbar shown from 4 talks');
}

// Groups start collapsed (spec #69 A19): opening a group is the reader's act,
// and it is what starts a fetched excerpt. Three things still open on their
// own: the focus verse's group on first build, groups a typed filter matches
// (Toolbar state below), and the source-type groups inside a verse group, so
// the click on the verse is the trigger.
console.log('Open rules:');
{
  const three = makeData([
    { citId: 'a', verses: [3], source: gc('A', 'T', '2020-04') },
    { citId: 'b', verses: [4], source: jod('B', 'T', '1857-07') },
    { citId: 'c', verses: [5], source: gc('C', 'T', '2020-04') },
  ]);
  const byVerse = VM.buildView(three, OPTS);
  eq(byVerse.groups.some((g) => g.open), false, 'a small chapter starts collapsed, by verse');
  eq(allGroups(byVerse).filter((g) => g.kind === 'sourceType').every((g) => g.open), true,
    'source-type groups inside a verse start open, so the verse click shows its talks');
  eq(VM.buildView(three, SRC).groups.some((g) => g.open), false, 'a small chapter starts collapsed, by source');
  eq(byVerse.focusUid, null, 'no focus verse, no focus group');

  const one = makeData([{ citId: 'a', verses: [16], source: gc('A', 'T', '2020-04') }]);
  eq(VM.buildView(one, SRC).groups[0].open, false, 'even a one-talk chapter starts collapsed');

  const focused = VM.buildView(three, Object.assign({}, OPTS, { focusVerse: 4 }));
  deep(focused.groups.filter((g) => g.open).map((g) => g.verse), [4], 'only the focus verse opens on a small chapter');
  eq(VM.buildView(three, Object.assign({}, SRC, { focusVerse: 4 })).groups.some((g) => g.open), false,
    'by source there is no verse group, so a focus verse opens nothing');

  // Filtering opens what matches, on a small chapter too.
  const plan = VM.filterPlan(byVerse, 'journal', VM.initialState(byVerse));
  eq(plan.open[byVerse.groups[1].uid], true, 'a filter match opens its verse group');
  eq(plan.open[byVerse.groups[0].uid], false, 'a group with no match stays closed');
}

// --- source types from the pack descriptor --------------------------------
console.log('Source types from the descriptor:');
{
  const cites = [
    { citId: 'g', verses: [16], source: gc('Oaks', 'C', '2021-10') },
    { citId: 'j', verses: [16], source: jod('Young', 'A', '1857-07') },
    { citId: 't', verses: [16], source: tpjs('Smith', '', '') },
    { citId: 't2', verses: [20], source: tpjs('Smith', '', '') },
  ];
  const personal = VM.buildView(makeData(cites, PERSONAL), OPTS);
  deep(personal.groups[0].children.map((c) => c.label),
    ['General Conference', 'Journal of Discourses', 'Teachings of the Prophet Joseph Smith'],
    'the personal pack shows the TPJS source type');

  const pub = makeData(cites, PUBLIC);
  for (const view of [VM.buildView(pub, OPTS), VM.buildView(pub, SRC)]) {
    const labels = allGroups(view).map((g) => g.label);
    check(!labels.includes('Teachings of the Prophet Joseph Smith'), `${view.layout}: the public pack has no TPJS group`);
    check(VM.allRows(view).every((r) => r.entry.source.c !== 'T'), `${view.layout}: and no TPJS row`);
    eq(view.talks, 2, `${view.layout}: a corpus the descriptor lacks counts no talks`);
    eq(view.summary, '2 talks cite this chapter', `${view.layout}: nor does the summary`);
  }
  deep(VM.buildView(pub, OPTS).groups.map((g) => g.label), ['Verse 16'],
    'a verse cited only by a missing corpus has no group');
  deep(VM.buildView(pub, SRC).groups.map((g) => g.key), ['general-conference', 'journal-of-discourses'], 'by source: one group per source type the pack lists');

  const onlyT = VM.buildView(makeData([cites[2]], PUBLIC), OPTS);
  eq(onlyT.empty, true, 'a chapter cited only by a missing corpus is empty');
  eq(onlyT.emptyText, 'No talks cite John 3.', 'and says no talk cites it');

  // Source types are the descriptor's sourceType values, in its order.
  const reordered = { flavor: 'public', corpora: { J: CORPORA.J, G: CORPORA.G, E: CORPORA.E } };
  deep(VM.buildView(makeData(cites, reordered), SRC).groups.map((g) => g.label),
    ['Journal of Discourses', 'General Conference'], 'groups follow the descriptor\'s order');
  const renamed = { flavor: 'public', corpora: { G: Object.assign({}, CORPORA.G, { sourceType: 'Conference Talks' }) } };
  const rg = VM.buildView(makeData(cites, renamed), SRC).groups;
  deep(rg.map((g) => g.label), ['Conference Talks'], 'a group is labelled with the descriptor\'s sourceType');
  eq(rg[0].countClass, 'btx-grp-conference-talks', 'a new source type gets its own chip class');
  eq(VM.buildView(makeData([cites[0]], null), OPTS).groups.length, 1, '(fixture: makeData defaults to the personal pack)');
  eq(VM.buildView(Object.assign(makeData([cites[0]]), { pack: undefined }), OPTS).empty, true,
    'with no descriptor no corpus exists');
}

// --- footnote label -----------------------------------------------------------
// A cite the build flagged `fn` (entry.inFootnote) sits in one of the talk's
// notes, so its excerpt can be about something else; the row's talk line says
// so ("· in a footnote"), its hover says why, and its accessible name ends with it.
console.log('Footnote label:');
{
  const data = makeData([
    { citId: 'fn', verses: [7], source: gc('Cook', 'Zoram', '2025-10'), inFootnote: true, excerptChars: 90 },
    { citId: 'body', verses: [7], source: gc('Nelson', 'Born Again', '2020-04'), excerptChars: 90 },
    { citId: 'old', verses: [7], source: jod('Young', 'On Rebirth', '1885-04'), snippet: 'born of water' },
  ]);
  const rows = VM.allRows(VM.buildView(data, SRC));
  const rowOf = (id) => rows.find((r) => r.citId === id);
  deep(rowOf('fn').footnote, {
    text: 'in a footnote',
    title: 'The verse is cited in a footnote; the excerpt is the paragraph the note belongs to.',
  }, 'a flagged cite’s row carries the fragment for its talk line, and its hover text');
  eq(rowOf('fn').sub, 'Zoram · 2025-10', 'the talk line itself is unchanged (the fragment follows it)');
  eq(rowOf('fn').a11yLabel, 'Cook, Zoram, 2025-10, verse 7, in a footnote', 'and its screen-reader name ends with it');
  eq(rowOf('body').footnote, null, 'an unflagged row carries none');
  eq(rowOf('body').a11yLabel, 'Nelson, Born Again, 2020-04, verse 7', 'and its screen-reader name is unchanged');
  eq(rowOf('old').footnote, null, 'a cite with no flag (a corpus that cannot carry one) shows none');
  const ranged = makeData([{ citId: 'r', verses: [3, 4, 5], source: gc('Nelson', 'Born Again', '2020-04'), inFootnote: true }]);
  eq(VM.allRows(VM.buildView(ranged, SRC))[0].a11yLabel, 'Nelson, Born Again, 2020-04, verses 3 to 5, in a footnote',
    'after the verse range when the row has one');
}

// --- excerpt source per corpus ---------------------------------------------
// A row's excerpt comes from where the descriptor says (`excerpt`): a bundled
// corpus hands over display-ready text, a fetched one a fetch marker with the
// characters to reserve; the filter haystack holds snippet text only for
// bundled corpora, so filtering never depends on what has scrolled into view.
console.log('Excerpt source:');
{
  const FETCHED = Object.assign({}, PUBLIC, { corpora: Object.assign({}, CORPORA, {
    G: Object.assign({}, CORPORA.G, { excerpt: 'fetched' }),
    E: Object.assign({}, CORPORA.E, { excerpt: 'fetched' }),
  }) });
  const data = makeData([
    { citId: 'g', verses: [3], source: gc('Nelson', 'Born Again', '2020-04'), excerptChars: 120, snippet: 'stale bundled words' },
    { citId: 'e', verses: [4], source: { c: 'E', sp: 'Clark', ti: 'Faith', d: '1950-04', lbl: '1950-04 General Conference' } },
    { citId: 'j', verses: [5], source: jod('Young', 'On Rebirth', '1885-04'), snippet: 'born of water' },
  ], FETCHED);
  const rows = VM.allRows(VM.buildView(data, SRC));
  const rowOf = (id) => rows.find((r) => r.citId === id);
  deep(rowOf('g').snippet, { fetch: true, chars: 122 }, 'a fetched corpus reserves its count plus the two quote marks');
  deep(rowOf('e').snippet, { fetch: true, chars: null }, 'a cite with no count reserves three lines');
  deep(rowOf('j').snippet, { text: '“…born of water”' }, 'a bundled corpus hands over display-ready text');
  check(!rowOf('g').search.includes('stale'), 'a fetched corpus keeps snippet text out of the filter haystack');
  check(rowOf('g').search.includes('nelson') && rowOf('g').search.includes('born again'), 'speaker and title still filter it');
  check(rowOf('j').search.includes('born of water'), 'a bundled corpus filters on its snippet');
  eq(VM.filterPlan(VM.buildView(data, SRC), 'stale', VM.initialState(VM.buildView(data, SRC))).noResults != null, true,
    'so a fetched row never matches on excerpt words');

  const none = VM.allRows(VM.buildView(makeData([{ citId: 'x', verses: [1], source: jod('A', 'B', '1880-01') }], FETCHED), SRC))[0];
  eq(none.snippet, null, 'a bundled cite with no snippet has no excerpt');

  eq(VM.excerptText('  Faith  is\n a principle  of power. '), '“Faith is a principle of power.”', 'fetched text is collapsed and quoted');
  eq(VM.excerptText('“Come, follow me,” He said.'), '“Come, follow me,” He said.', 'text opening on a quote is not quoted twice');
  eq(VM.excerptText('   '), null, 'blank fetched text is no excerpt');
}

// --- footer: the pack vintage ----------------------------------------------
console.log('Footer:');
{
  const data = makeData([{ citId: 'a', verses: [3], source: gc('A', 'T', '2020-04') }], PUBLIC);
  eq(VM.buildView(data, OPTS).footer, 'Citations through April 2026', 'the footer names the vintage\'s conference');
  eq(VM.buildView(data, SRC).footer, 'Citations through April 2026', 'in both layouts');
  const oct = Object.assign({}, PUBLIC, { vintage: '2025-10' });
  eq(VM.buildView(makeData([], oct), OPTS).footer, 'Citations through October 2025', 'an empty chapter still shows it');
  eq(VM.buildView(null, OPTS).footer, null, 'no data, no footer');
  eq(VM.buildView(data, OPTS).footerTitle, 'Includes talks through the April 2026 general conference',
    'the footer explains its vintage');
  eq(VM.buildView(makeData([], oct), OPTS).footerTitle, 'Includes talks through the October 2025 general conference',
    'an empty chapter explains it too');
  eq(VM.buildView(null, OPTS).footerTitle, null, 'no data, no footer title');
  eq(VM.buildView(makeData([], Object.assign({}, PUBLIC, { vintage: '' })), OPTS).footer, null, 'no vintage, no footer');
  eq(VM.buildView(makeData([], Object.assign({}, PUBLIC, { vintage: '' })), OPTS).footerTitle, null, 'no vintage, no footer title');
  const bad = VM.buildView(makeData([], Object.assign({}, PUBLIC, { vintage: '2026-13' })), OPTS);
  deep([bad.footer, bad.footerTitle], [null, null], 'a vintage with no such month: neither footer nor title');
}

// --- source-type notes: hover text on a source-type header -------------------
console.log('Source-type notes:');
{
  const GC_NOTE = 'Talks from the Church\u2019s general conferences';
  const JD_NOTE = 'Sermons by early Church leaders, published 1854\u20131886';
  const noted = Object.assign({}, PUBLIC, { corpora: {
    G: Object.assign({}, CORPORA.G, { sourceNote: GC_NOTE }),
    E: Object.assign({}, CORPORA.E, { sourceNote: GC_NOTE }),
    J: Object.assign({}, CORPORA.J, { sourceNote: JD_NOTE }),
  } });
  const cites = [
    { citId: 'g', verses: [3], source: gc('A', 'T', '2020-04') },
    { citId: 'j', verses: [3], source: jod('B', 'T', '1870-01') },
  ];
  const titles = (view) => allGroups(view).filter((g) => g.kind === 'sourceType').map((g) => [g.label, g.title]);

  const verse = VM.buildView(makeData(cites, noted), OPTS);
  deep(titles(verse), [['General Conference', GC_NOTE], ['Journal of Discourses', JD_NOTE]],
    'each source-type header is titled by its descriptor note (verse layout)');
  deep(titles(VM.buildView(makeData(cites, noted), SRC)), [['General Conference', GC_NOTE], ['Journal of Discourses', JD_NOTE]],
    'and in the by-source layout');
  eq(verse.groups[0].title, null, 'a verse header has no title');
  eq(verse.groups[0].a11yLabel, 'Verse 3, 2 talks', 'the note never changes the group\u2019s screen-reader label');

  deep(titles(VM.buildView(makeData(cites, PUBLIC), OPTS)).map((t) => t[1]), [null, null],
    'a descriptor without notes gives no title');
  const partial = Object.assign({}, PUBLIC, { corpora: Object.assign({}, CORPORA, {
    J: Object.assign({}, CORPORA.J, { sourceNote: JD_NOTE }) }) });
  deep(titles(VM.buildView(makeData(cites, partial), OPTS)).map((t) => t[1]), [null, JD_NOTE],
    'a source type without a note has no title while another has one');
  const blank = Object.assign({}, PUBLIC, { corpora: Object.assign({}, CORPORA, {
    G: Object.assign({}, CORPORA.G, { sourceNote: '' }) }) });
  eq(titles(VM.buildView(makeData(cites, blank), OPTS))[0][1], null, 'an empty note is no title');
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

  // A shard that indexes no chapter at all (the Official Declarations) is a
  // gap in the index, not a book no talk cites.
  const gap = VM.buildView({ verseOrder: [], byVerse: {}, entries: {}, uniqueTotal: 0,
    bookIndexed: false, bookName: 'Official Declarations' }, { view: 'verse', fullName: 'Official Declaration', chapter: 1 });
  eq(gap.emptyText, 'The citation index has no entries for Official Declarations.', 'an unindexed book says the index has nothing');
  eq(VM.buildView({ verseOrder: [], byVerse: {}, entries: {}, uniqueTotal: 0, bookIndexed: true, bookName: 'Esther' },
    { view: 'verse', fullName: 'Esther', chapter: 1 }).emptyText, 'No talks cite Esther 1.', 'an indexed book with an empty chapter');
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
  eq(plan2.summaryShown, false, 'with no matches only the no-results line shows (the summary stays for screen readers)');
  eq(plan.summaryShown, true, 'with matches the summary shows');
  eq(idle.summaryShown, true, 'and without a query');
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

// --- verse queries ----------------------------------------------------------
console.log('Verse queries:');
{
  deep(VM.verseQuery('27', '14'), [27], 'a bare number is a verse');
  deep(VM.verseQuery('v27', '14'), [27], 'v27');
  deep(VM.verseQuery('v. 27', '14'), [27], 'v. 27');
  deep(VM.verseQuery('V.27', '14'), [27], 'V.27, any case');
  deep(VM.verseQuery('14:27', '14'), [27], 'a chapter prefix naming this chapter');
  eq(VM.verseQuery('14:27', '15'), null, 'a chapter prefix naming another chapter is text');
  deep(VM.verseQuery('27-29', '14'), [27, 28, 29], 'a range with a hyphen');
  deep(VM.verseQuery('27–29', '14'), [27, 28, 29], 'a range with an en dash');
  deep(VM.verseQuery('27, 29', '14'), [27, 29], 'a comma list');
  deep(VM.verseQuery('27 29', '14'), [27, 29], 'a space list');
  deep(VM.verseQuery('vv. 1-2, 14:27 – 28; 30', '14'), [1, 2, 27, 28, 30], 'every form together');
  deep(VM.verseQuery('verse 27', '14'), [27], 'the word verse');
  deep(VM.verseQuery('v27, v29', '14'), [27, 29], 'a v on each item');
  deep(VM.verseQuery('29-27', '14'), [27, 28, 29], 'a range typed backwards');
  deep(VM.verseQuery('14:27-14:29', '14'), [27, 28, 29], 'a chapter prefix on both ends');
  eq(VM.verseQuery('14:27-15:2', '14'), null, 'a range into another chapter is text');
  // Mid-keystroke forms keep the verses typed so far, so the list doesn't
  // flash to text matches between "27" and "27-29".
  deep(VM.verseQuery('27-', '14'), [27], 'a dangling dash');
  deep(VM.verseQuery('27,', '14'), [27], 'a dangling comma');
  // Years and pages are four digits; no chapter has a verse 0 or 1000.
  eq(VM.verseQuery('2006', '14'), null, 'a year is text');
  eq(VM.verseQuery('0', '14'), null, 'zero is text');
  eq(VM.verseQuery('27 2006', '14'), null, 'one non-verse makes the whole query text');
  eq(VM.verseQuery('Doctrine and Covenants 76', '14'), null, 'a title with a number is text');
  eq(VM.verseQuery('3 Nephi', '14'), null, 'a number and a word is text');
  eq(VM.verseQuery('v', '14'), null, 'a lone v is text');
  eq(VM.verseQuery('14:', '14'), null, 'a chapter with no verse is text');
  eq(VM.verseQuery('   ', '14'), null, 'blank is no query');

  // John 14: Rasband cites verse 27 alone, Holland cites 25–27 (one row,
  // anchored at 25 in By verse), Oaks cites 29, Young 3.
  const data = makeData([
    { citId: 'a', verses: [27], source: gc('Rasband', 'Love Like Jesus', '2025-10'), snippet: 'my peace I give' },
    { citId: 'b', verses: [25, 26, 27], source: gc('Holland', 'The Comforter', '2018-04'), snippet: 'peace I leave' },
    { citId: 'c', verses: [29], source: gc('Oaks', 'Doctrine and Covenants 76', '2005-10'), snippet: 'when it is come' },
    { citId: 'd', verses: [3], source: jod('Young', 'Mansions', '1857-07', 'Journal of Discourses 14:27'), snippet: 'a place for you' },
  ].concat(FILLER));
  const bySource = VM.buildView(data, { view: 'source', fullName: 'John', chapter: '14' });
  const plan = (view, q) => VM.filterPlan(view, q, VM.initialState(view));

  for (const q of ['27', 'v27', 'v. 27', '14:27']) {
    deep(visibleRowIds(bySource, plan(bySource, q)), ['a', 'b'], `By source, "${q}": the talks citing verse 27, a range among them`);
  }
  for (const q of ['27-29', '27–29', '27, 29', '27 29']) {
    deep(visibleRowIds(bySource, plan(bySource, q)), ['a', 'b', 'c'], `By source, "${q}"`);
  }
  eq(plan(bySource, '27').summary, '2 of 14 talks match', 'a verse query counts matching talks');
  deep(visibleRowIds(bySource, plan(bySource, 'covenants 76')), ['c'], 'a number in a title is found by its words');
  // A row whose badge reads more verses than were asked for says which of
  // them matched, beside the badge, and to a screen reader.
  const p27 = plan(bySource, '27');
  const rowOf = (view, id) => VM.allRows(view).find((r) => r.citId === id);
  deep(p27.matchNotes[rowOf(bySource, 'b').uid], { text: 'incl. v. 27', a11yLabel: 'Holland, The Comforter, 2018-04, verses 25 to 27, including verse 27' },
    'By source, "27": the 25–27 row names the verse it matched');
  eq(p27.matchNotes[rowOf(bySource, 'a').uid], undefined, 'a row citing just the verse asked for needs no note');
  eq(plan(bySource, '27-29').matchNotes[rowOf(bySource, 'b').uid].text, 'incl. v. 27', 'only the verses the row takes in');
  eq(plan(bySource, '25-27').matchNotes[rowOf(bySource, 'b').uid], undefined, 'a row inside the query needs none');
  eq(plan(bySource, '26-29').matchNotes[rowOf(bySource, 'b').uid].text, 'incl. vv. 26–27', 'several matched verses');
  deep(plan(bySource, '').matchNotes, {}, 'no query, no notes');
  deep(plan(bySource, 'holland').matchNotes, {}, 'a text query, no notes');
  deep(VM.filterPlan(VM.buildView(data, { view: 'verse', fullName: 'John', chapter: '14' }), '27', VM.initialState(bySource)).matchNotes, {},
    'By verse names the verse in its group header instead');

  const onJohn15 = VM.buildView(data, { view: 'source', fullName: 'John', chapter: '15' });
  deep(visibleRowIds(onJohn15, plan(onJohn15, '14:27')), ['d'], 'on John 15, "14:27" is text (a Journal of Discourses place)');

  // By verse: a verse query shows the queried verses' groups and no other,
  // each opened and holding every talk whose cites take in that verse:
  // Holland's 25–27 row is listed under Verse 25, and under the query it
  // shows under Verse 27 too, newest first among the rest. Both layouts
  // count the same talks.
  const byVerse = VM.buildView(data, { view: 'verse', fullName: 'John', chapter: '14' });
  const state = VM.initialState(byVerse);
  state.open['v:3'] = true; // the reader opened verse 3 by hand
  const v27 = VM.filterPlan(byVerse, '27', state);
  const shownGroups = (view, p) => view.groups.filter((g) => !p.hidden[g.uid]).map((g) => g.uid);
  deep(shownGroups(byVerse, v27), ['v:27'], 'By verse, "27": Verse 27 alone, not Verse 25 where the 25–27 run starts');
  deep(visibleRowIds(byVerse, v27), ['a', 'b'], 'holding both talks, newest first, the range among them');
  check(byVerse.groups.every((g) => v27.hidden[g.uid] || v27.open[g.uid]), 'and it opens');
  eq(v27.open['v:3'], true, 'a hidden group keeps its open state');
  eq(v27.summary, plan(bySource, '27').summary, 'both layouts count the same talks');
  eq(v27.counts['v:27'], 2, 'the group counts every talk it shows');
  deep(shownGroups(byVerse, plan(byVerse, '25-29')), ['v:25', 'v:26', 'v:27', 'v:29'],
    'a range query shows each queried verse a talk takes in, in order (26 only through the 25–27 run)');
  deep(visibleRowIds(byVerse, plan(byVerse, '26')), ['b'], 'a verse only a range takes in gets a group of its own under the query');

  // Without a verse query the list is today's: each talk listed at the verse
  // its run starts at; the range's other verses add no group, row or count.
  eq(byVerse.groups.find((g) => g.uid === 'v:26').queryOnly, true, 'a verse only a range takes in is a query-only group');
  eq(byVerse.groups.find((g) => g.uid === 'v:26').count, 0, 'which counts nothing');
  const idle = plan(byVerse, '');
  eq(idle.hidden['v:26'], true, 'and hides with no query');
  deep(visibleRowIds(byVerse, idle).filter((id) => id === 'b'), ['b'], 'the range row shows once, at Verse 25');
  eq(idle.counts['v:27'], 1, 'Verse 27 counts its own talk');
  deep(visibleRowIds(byVerse, plan(byVerse, 'holland')), ['b'], 'a text query finds the range row once');
  deep(shownGroups(byVerse, plan(byVerse, 'holland')), ['v:25'], 'where it starts');
  eq(VM.buildView(data, { view: 'verse', fullName: 'John', chapter: '14', focusVerse: 26 }).focusUid, null,
    'a query-only group never takes the focus verse');

  // A cite of verses 3 and 27 is listed under Verse 3 and again under Verse
  // 27; a "27" query shows it once, where verse 27 is.
  const split = makeData([
    { citId: 'u', verses: [3, 27], source: gc('Uchtdorf', 'Strength of Youth', '2022-10') },
    { citId: 'w', verses: [1, 2, 3], source: gc('Gong', 'Eastertide', '2026-04') },
  ].concat(FILLER));
  const splitView = VM.buildView(split, { view: 'verse', fullName: 'John', chapter: '14' });
  const u27 = VM.filterPlan(splitView, '27', VM.initialState(splitView));
  deep(shownGroups(splitView, u27), ['v:27'], 'a talk shows under the verse the query names');
  eq(u27.summary, '1 of 12 talks matches', 'counted once');
  const u3 = VM.filterPlan(splitView, '3', VM.initialState(splitView));
  deep(shownGroups(splitView, u3), ['v:3'], 'verse 3: one group');
  deep(visibleRowIds(splitView, u3), ['w', 'u'], 'holding the 3 run and the 1–3 run, newest first');
  eq(u3.summary, '2 of 12 talks match', 'both talks counted');

  // A verse no talk cites: the no-results line names the verse.
  const none = VM.filterPlan(byVerse, '28', state);
  eq(none.anyMatch, false, 'nothing cites verse 28 on its own');
  eq(none.noResults, 'No talks cite verse 28.', 'the no-results line names the verse');
  eq(none.summary, '0 of 14 talks match', 'and the count says none');
  eq(VM.filterPlan(byVerse, '30-31', state).noResults, 'No talks cite verses 30–31.', 'or the verses');

  // A reference to another chapter that matches nothing as text says why,
  // and names a verse to type that has talks here.
  for (const view of [byVerse, bySource]) {
    eq(plan(view, '15:27').noResults, '15:27 isn’t in John 14. Type a verse number, like 27.',
      `${view.layout}: another chapter's verse, with this chapter's own verse 27 to try`);
    eq(plan(view, ' 15:27 - 29 ').noResults, '15:27–29 isn’t in John 14. Type a verse number, like 27.', `${view.layout}: a range of them`);
    eq(plan(view, '15:28').noResults, '15:28 isn’t in John 14. Type a verse number, like 3.',
      `${view.layout}: no talk here cites verse 28, so the first cited verse is offered`);
  }
  eq(plan(bySource, '15:27, 14:3').noResults, 'No talks match “15:27, 14:3”.', 'two chapters at once is plain text');
  deep(visibleRowIds(onJohn15, plan(onJohn15, '14:27')), ['d'], 'a reference that matches as text keeps its matches');
  eq(plan(onJohn15, '14:27').noResults, null, 'and has no no-results line');

  // Clearing restores the open state from before the verse query.
  const cleared = VM.filterPlan(byVerse, '', VM.applyPlan(state, v27));
  eq(cleared.open['v:3'], true, 'the hand-opened group stays open');
  eq(cleared.open['v:27'], false, 'a group the verse query opened closes again');
  eq(cleared.preFilterOpen, null, 'the capture is released');

  // The box says what it searches; the label drops the ellipsis a screen reader would speak.
  eq(VM.FILTER_COPY.placeholder, 'Filter by speaker, title or verse…', 'the placeholder names verses');
  eq(VM.FILTER_COPY.label, 'Filter by speaker, title or verse', 'and the accessible label');
}

// --- talk reader heading ---------------------------------------------------
console.log('Talk heading:');
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

  eq(VM.talkHeading({ c: 'G', sp: 'A', ti: 'T', lbl: '09 2023 General Conference' }, [1]).where,
    'October 2023 General Conference', 'the byline names a session as the list does');
  eq(VM.talkHeading(jod('Moses Thatcher', 'Discourse', '1885-04', 'Journal of Discourses 26:306'), [5]).where,
    'Journal of Discourses, vol. 26, p. 306 · April 1885', 'the byline spells a Journal of Discourses place as the list does');
  eq(VM.talkHeading(jod('X', 'Y', '1885-04', 'Journal of Discourses'), [5]).where,
    'Journal of Discourses · April 1885', 'a label with no volume:page is left as it is');
  // The date: a label that lacks it gains month and year.
  eq(VM.talkHeading(jod('Brigham Young', 'Salvation.', '1853-01', 'Journal of Discourses 1:3'), [5]).where,
    'Journal of Discourses, vol. 1, p. 3 · January 1853', 'a Journal of Discourses heading gains its month and year');
  eq(VM.talkHeading(gc('David L. Buckner', 'T', 'October 2024'), [1]).where,
    'October 2024 General Conference', 'a conference label that holds the year is unchanged');
  eq(VM.talkHeading({ c: 'G', sp: 'A', ti: 'T', d: '2023-10', lbl: '09 2023 General Conference' }, [1]).where,
    'October 2023 General Conference', 'a session label that holds the year is unchanged');
  eq(VM.talkHeading({ c: 'J', sp: 'A', ti: 'T', lbl: 'Journal of Discourses 4:12' }, [1]).where,
    'Journal of Discourses, vol. 4, p. 12', 'a source with no date gains nothing');
  eq(VM.talkHeading({ c: 'J', sp: 'A', ti: 'T', d: '1853', lbl: 'Journal of Discourses 4:12' }, [1]).where,
    'Journal of Discourses, vol. 4, p. 12', 'nor does one whose date has no month');
  eq(VM.talkHeading({ c: 'J', sp: 'A', ti: 'T', d: '1853-13', lbl: 'Journal of Discourses 4:12' }, [1]).where,
    'Journal of Discourses, vol. 4, p. 12', 'nor one whose month is not a month');
  eq(VM.talkHeading({ c: 'J', sp: 'A', ti: '', d: '1853-01', lbl: 'Journal of Discourses 4:12' }, [1]).where,
    'January 1853', 'a label that stands in as the title is not repeated; the date still follows');
  const note = VM.talkHeading(gc('Oliver Cowdery', 'T', '1990-04'), [1000]);
  eq(note.chip.text, 'Note', 'a chip for the note says Note');
  eq(note.chip.a11yLabel, 'Go to the cited passage, the note', 'and its spoken form');

  const bare = VM.talkHeading({}, []);
  eq(bare.title, 'Untitled talk', 'no title and no label');
  eq(bare.speaker, null, 'no speaker line when the speaker is unknown');
  eq(bare.chip.text, 'Cited passage', 'a cite without verses still gets a chip');
  eq(bare.chip.a11yLabel, 'Go to the cited passage', 'with a plain label');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
