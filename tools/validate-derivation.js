#!/usr/bin/env node
/*
 * Checks tools/derive-conference.js's pure core (the derivation run, spec #69
 * "Build"): what a conference's talk pages yield as derived cites, on
 * invented fixtures shaped like the Church content endpoint's JSON and like a
 * talk page saved from a browser. No network, no Church text.
 * Run: node tools/validate-derivation.js. Exits non-zero on failure.
 */
'use strict';

const derive = require('./derive-conference.js');

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}\n      got  ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// Verse counts the fixtures need (the real run reads them from the BYU base).
const VERSES = { 'moses 1': 42, 'job 38': 41, 'dc 76': 119, '3-ne 11': 41, '3-ne 12': 48, '3-ne 13': 34, 'matt 27': 66, 'alma 32': 43, 'alma 33': 23, 'heb 2': 18 };
const verseCount = (book, chapter) => VERSES[`${book} ${chapter}`] || null;

// An invented talk in the content endpoint's JSON shape: body HTML with
// note-ref markers, footnotes as a separate map with the marker paragraph's pid.
function apiTalk(body, notes, extra) {
  const footnotes = {};
  notes.forEach((text, i) => {
    const id = `note${i + 1}`;
    footnotes[id] = { id, marker: `${i + 1}.`, pid: '', text, referenceUris: [] };
  });
  return Object.assign({
    uri: '/general-conference/2030/10/12smith',
    meta: { title: 'An Invented Talk', pageAttributes: { 'data-uri': '/general-conference/2030/10/12smith', 'data-aid-version': '3', 'data-content-type': 'general-conference-talk' } },
    content: {
      body: '<header><h1 data-aid="1" id="title1">An Invented Talk</h1><div class="byline"><p class="author-name" data-aid="2" id="author1">By Elder John Q. Smith</p></div></header>' +
        `<div class="body-block">${body}</div>`,
      footnotes,
    },
  }, extra || {});
}
const marker = (n) => `<a class="note-ref" href="#note${n}"><sup class="marker" data-value="${n}"></sup></a>`;
const link = (path, id, label) => `<a class="scripture-ref" href="/study/scriptures/${path}?lang=eng${id ? `&amp;id=${id}#${id.split(/[-,]/)[0]}` : ''}">${label}</a>`;

console.log('Footnote links (fixtures):');
{
  const talk = apiTalk(
    `<p data-aid="10" id="p_aaa">Opening words.</p><p data-aid="11" id="p_bbb">His work and glory${marker(1)} is our return.</p>`,
    [`<p data-aid="90" id="p_n1">See ${link('pgp/moses/1', 'p39', 'Moses 1:39')}.</p>`]);
  deep(derive.deriveTalk(derive.pageFromApi(talk), { verseCount }).cites,
    [{ book: 'moses', chapter: 1, v: '39', a: 'p_bbb', ec: 'His work and glory is our return.'.length }],
    'a footnote link is a cite at the paragraph holding the note\'s marker, counted from that paragraph\'s text');
}

console.log('Body links, chapter links, books the pack lacks (fixtures):');
{
  const talk = apiTalk(
    `<p data-aid="10" id="p_aaa">As ${link('ot/job/38', 'p7', 'Job 38:7')} says, and ${link('nt/matt/27', '', 'Matthew 27')}.</p>` +
    `<p data-aid="11" id="p_bbb">He ministered.${marker(1)} Also ${link('jst/jst-matt/1', 'p4', 'Joseph Smith Translation, Matthew 1:4')}.</p>`,
    [`<p data-aid="90" id="p_n1">See ${link('bofm/3-ne/11', '', '3 Nephi 11–13')}; ${link('dc-testament/dc/76', 'p39-p43', 'Doctrine and Covenants 76:39–43')}; ` +
      `${link('dc-testament/dc/76', 'p39-p43', 'Doctrine and Covenants 76:39–43')}.</p>`]);
  const a = 'As Job 38:7 says, and Matthew 27.'.length;
  const b = 'He ministered. Also Joseph Smith Translation, Matthew 1:4.'.length;
  deep(derive.deriveTalk(derive.pageFromApi(talk), { verseCount }).cites, [
    { book: 'job', chapter: 38, v: '7', a: 'p_aaa', ec: a },
    { book: 'matt', chapter: 27, v: '1-66', a: 'p_aaa', ec: a },
    { book: '3-ne', chapter: 11, v: '1-41', a: 'p_bbb', ec: b },
    { book: '3-ne', chapter: 12, v: '1-48', a: 'p_bbb', ec: b },
    { book: '3-ne', chapter: 13, v: '1-34', a: 'p_bbb', ec: b },
    { book: 'dc', chapter: 76, v: '39-43', a: 'p_bbb', ec: b },
  ], 'body links sit at their paragraph; a chapter link is the whole chapter, every chapter of a span its label names; ' +
    'a Joseph Smith Translation link is ignored; the same reference twice at one paragraph is one cite');
}

console.log('Plain-text references in footnote text (fixtures):');
{
  const talk = apiTalk(
    `<p data-aid="10" id="p_aaa">First${marker(1)} and second${marker(2)}.</p>` +
    `<p data-aid="11" id="p_bbb">Third${marker(3)}, unlinked in prose: Alma 32:21.</p>`,
    [
      '<p data-aid="90" id="p_n1">Hebrews 2:10, New International Reader’s Version; Joseph Smith Translation, Matthew 27:54.</p>',
      `<p data-aid="91" id="p_n2">${link('bofm/alma/32', 'p21', 'Alma 32:21')}, ${link('bofm/alma/32', 'p27', '27')}; see Alma 32:21, 27.</p>`,
      '<p data-aid="92" id="p_n3">See 3 Nephi 12–13; Alma 32:42–33:1; Doctrine and Covenants 76:22, 24; D&amp;C 76:5; Psalm 23.</p>',
    ]);
  const a = 'First and second.'.length;
  const b = 'Third, unlinked in prose: Alma 32:21.'.length;
  deep(derive.deriveTalk(derive.pageFromApi(talk), { verseCount: (bk, c) => verseCount(bk, c) || (bk === 'ps' && c === 23 ? 6 : null) }).cites, [
    { book: 'alma', chapter: 32, v: '21', a: 'p_aaa', ec: a },
    { book: 'alma', chapter: 32, v: '27', a: 'p_aaa', ec: a },
    { book: 'heb', chapter: 2, v: '10', a: 'p_aaa', ec: a },
    { book: 'matt', chapter: 27, v: '54', a: 'p_aaa', ec: a },
    { book: '3-ne', chapter: 12, v: '1-48', a: 'p_bbb', ec: b },
    { book: '3-ne', chapter: 13, v: '1-34', a: 'p_bbb', ec: b },
    { book: 'alma', chapter: 32, v: '42-43', a: 'p_bbb', ec: b },
    { book: 'alma', chapter: 33, v: '1', a: 'p_bbb', ec: b },
    { book: 'dc', chapter: 76, v: '22,24', a: 'p_bbb', ec: b },
    { book: 'dc', chapter: 76, v: '5', a: 'p_bbb', ec: b },
    { book: 'ps', chapter: 23, v: '1-6', a: 'p_bbb', ec: b },
  ], 'footnote text names other versions, the Joseph Smith Translation\'s Bible verse, chapter spans and cross-chapter ranges; ' +
    'text a link already covers adds nothing; prose in the body is not read for references');
}

// The same invented talk as a page saved from a browser: one article, the
// page's JSON state in a script, markers with data-scroll-id, notes in a footer list.
const SAVED = `<!DOCTYPE html><html><head><title>An Invented Talk</title>
<script>window.__INITIAL_STATE__ = {"x":"<p data-aid=\\"99\\" id=\\"p_zzz\\"><a class=\\"scripture-ref\\" href=\\"/study/scriptures/ot/gen/1\\">Genesis 1</a></p>"}</script></head>
<body><article data-aid="5" data-aid-version="3" data-content-type="general-conference-talk" data-uri="/general-conference/2030/10/12smith" id="main">
<header><h1 data-aid="1" id="title1">An Invented Talk</h1><div class="byline"><p class="author-name" data-aid="2" id="author1">By Elder John Q. Smith</p></div></header>
<div class="body-block"><p data-aid="10" id="p_aaa">Opening words with ${link('ot/job/38', 'p7', 'Job 38:7')}.</p>
<p data-aid="11" id="p_bbb">His work and glory<a class="note-ref" href="/study/general-conference/2030/10/12smith?lang=eng#note1" data-scroll-id="note1"><sup class="marker" data-value="1"></sup></a> is our return.</p></div>
<footer class="notes"><ol><li data-marker="1." id="note1" data-full-marker="1."><p data-aid="90" id="p_n1">See ${link('pgp/moses/1', 'p39', 'Moses 1:39')}.</p></li></ol></footer>
</article></body></html>`;

{
  const talk = apiTalk(`<p data-aid="10" id="p_aaa">One${marker(1)}.</p>`,
    ['<p data-aid="90" id="p_n1">Job 38:7, 99; Job 99:1; Moses 1:39–45.</p>']);
  deep(derive.deriveTalk(derive.pageFromApi(talk), { verseCount }).cites.map((c) => `${c.book} ${c.chapter}:${c.v}`),
    ['job 38:7', 'moses 1:39-42'], 'a chapter the book lacks is no cite, and verses past a chapter\'s end are dropped');
}

console.log('Talk records, endpoint JSON and saved page (fixtures):');
{
  const api = apiTalk(
    `<p data-aid="10" id="p_aaa">Opening words with ${link('ot/job/38', 'p7', 'Job 38:7')}.</p><p data-aid="11" id="p_bbb">His work and glory${marker(1)} is our return.</p>`,
    [`<p data-aid="90" id="p_n1">See ${link('pgp/moses/1', 'p39', 'Moses 1:39')}.</p>`]);
  const want = {
    id: 'gc/2030/10/12smith',
    url: 'https://www.churchofjesuschrist.org/study/general-conference/2030/10/12smith?lang=eng',
    sp: 'John Q. Smith', ti: 'An Invented Talk', d: '2030-10', lbl: 'October 2030 General Conference', rev: '3',
    cites: [
      { book: 'job', chapter: 38, v: '7', a: 'p_aaa', ec: 'Opening words with Job 38:7.'.length },
      { book: 'moses', chapter: 1, v: '39', a: 'p_bbb', ec: 'His work and glory is our return.'.length },
    ],
  };
  deep(derive.talkRecord(derive.pageFromApi(api), '2030-10', { verseCount }), want,
    'the endpoint\'s JSON gives the talk\'s id from its Church slug, its facts and its cites');
  deep(derive.talkRecord(SAVED, '2030-10', { verseCount }), want,
    'a saved page gives the same record; the page\'s script state is not read');
  deep(derive.talkRecord(SAVED, '2031-04', { verseCount }), null, 'a page of another conference gives no record');
  deep(derive.talkRecord(SAVED.replace('general-conference-talk', 'general-conference'), '2030-10', { verseCount }), null,
    'a page that is not a talk (a session, the conference) gives no record');
  deep(derive.talkRecord(SAVED.replace('By Elder John Q. Smith', 'Presented by President Jane Roe'), '2030-10', { verseCount }).sp,
    'Jane Roe', 'a byline loses "By", "Presented by" and the calling');
}

console.log('Talk list and conference input (fixtures):');
{
  const tile = (path) => `<li><a href="/study/general-conference/2030/10/${path}?lang=eng" class="list-tile"><p class="title">x</p></a></li>`;
  const confBody = `<nav class="manifest"><ul class="doc-map">${tile('saturday-morning-session')}${tile('11jones')}${tile('12smith')}` +
    `${tile('saturday-afternoon-session')}${tile('21roe')}${tile('11jones')}</ul></nav>` +
    '<a href="/study/general-conference/2030/04/11older?lang=eng">older</a><a href="/study/scriptures/ot/gen/1?lang=eng">Genesis 1</a>';
  deep(derive.talkList(confBody, '2030-10'),
    ['/general-conference/2030/10/11jones', '/general-conference/2030/10/12smith', '/general-conference/2030/10/21roe'],
    'the conference page lists its talks once each, in order, without session pages or other conferences');

  const rec = (id, cites) => ({ id, url: '', sp: 'S', ti: 'T', d: '2030-10', lbl: 'October 2030 General Conference', rev: '1', cites });
  const c = (book, v) => ({ book, chapter: 1, v, a: 'p_1', ec: 10 });
  const talks = [rec('gc/2030/10/21roe', [c('gen', '1')]), rec('gc/2030/10/11jones', [c('gen', '2'), c('ex', '3')]), rec('gc/2030/10/12smith', [])];
  const input = derive.conferenceInput('2030-10', talks, 'church');
  deep(input.talks.map((t) => [t.id, t.cites.map((x) => x.id)]), [
    ['gc/2030/10/11jones', [20301000001, 20301000002]],
    ['gc/2030/10/12smith', []],
    ['gc/2030/10/21roe', [20301000003]],
  ], 'talks sort by id and cites are numbered from the conference, YYYYMM followed by a five-digit sequence');
  deep([input.conference, input.source], ['2030-10', 'church'], 'the input names its conference and how its pages were read');
  deep(derive.conferenceInput('2030-10', talks.slice().reverse(), 'church'), input,
    'the same pages in any order give the same input (a re-run replaces the conference whole)');
  check(!/"(?:text|body|html|snippet)"/.test(JSON.stringify(input)), 'the input holds no text field');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
