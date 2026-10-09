#!/usr/bin/env node
/*
 * No-build sanity checks for the panel's pure state core. Run:
 *   node tools/validate-panel-state.js
 *
 * src/content/panel.js exports its state machine for Node (the DOM shell is
 * skipped when `document` is undefined). These checks pin down the toggle
 * semantics that used to live scattered in content.js callbacks: what a mode
 * click saves, when the citation-layout toggle acts, and the arrangement —
 * what the panel body shows for a chapter, its texts, the stored mode and
 * this visit's click, as table-driven journeys — plus the view host's caching rules, which used to be the
 * orchestrator's citCache/transCache bookkeeping, the copy the Translation
 * cards and errors show (setupCopy / besideCopy / errorCopy), and a few
 * DOM-shell and orchestrator rules read from the source (toggle state and
 * aria-pressed move together; icons are built from nodes; the talk view is
 * cached; the citation-list hooks are guarded).
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = require(path.join(ROOT, 'src/content/panel.js'));
const CT = require(path.join(ROOT, 'src/content/church-text.js'));

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

function fresh(init) {
  return P.createState(init || {});
}

// ---- createState ----
console.log('createState:');
let s = fresh();
eq(s.mode, 'citations', 'mode defaults to citations');
eq(s.citationView, 'source', 'citationView defaults to source');
eq(s.collapsed, false, 'collapsed defaults to false');

s = fresh({ mode: 'citations', citationView: 'verse', collapsed: true });
eq(s.mode, 'citations', 'persisted mode is adopted');
eq(s.citationView, 'verse', 'persisted citationView is adopted');
eq(s.collapsed, true, 'persisted collapsed is adopted');

s = fresh({ mode: 'nonsense', citationView: 42, collapsed: 'yes' });
eq(s.mode, 'citations', 'garbage mode falls back to citations');
eq(s.citationView, 'source', 'garbage citationView falls back to source');
eq(s.collapsed, false, 'garbage collapsed falls back to false');

// ---- The arrangement ----
// What the panel body shows and which mode a click saves, from the chapter's
// texts (each offered or not: chapterOffer's rows), the pick memory, the
// enabled Church languages, the split layout, the stored mode and this
// visit's mode click. Each row is one reader's journey: chapters shown
// (setChapter: a new one, or the same one again after a settings change) and
// mode clicks (selectMode), each followed by what the reader sees — the
// effective mode, the body, the text the Translation tab is about — and the
// stored mode (`saved`).
const WEB = { id: 'engwebp', provider: 'bundled', offered: true };
const NIV = { id: 'niv', provider: 'apibible', offered: true };
const church = (lang, offered) => ({ id: 'church:' + lang, provider: 'church', lang, offered });
// A chapter as content.js describes it to the panel.
const chapter = (key, texts, languages, more) => Object.assign({ key, texts, picks: [], languages, layout: 'columns' }, more);
const MOSIAH3 = chapter('bofm/mosiah/3', [], []); // no Church language on: nothing offers it
const MOSIAH4 = chapter('bofm/mosiah/4', [], []);
const JOHN3 = chapter('nt/john/3', [WEB], []); // the bundled Bible offers every Bible chapter
const DC76_GIL = chapter('dc-testament/dc/76', [church('gil', false)], ['gil']); // Kiribati on, lacking the chapter
const DC77_GIL = chapter('dc-testament/dc/77', [church('gil', false)], ['gil']);
const ALMA5_SPA = chapter('bofm/alma/5', [church('spa', true)], ['spa']);
const ALMA5_NONE = chapter('bofm/alma/5', [], []); // the only language unticked

const ARRANGEMENT_CASES = [
  { name: 'a fresh install opens on Citations', init: {}, steps: [
    [{ chapter: ALMA5_SPA }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ chapter: JOHN3 }, { mode: 'citations', body: 'citations', saved: 'citations' }],
  ] },
  { name: 'Mosiah 3 -> Mosiah 4 after a Translation click with no language on: the setup card on both', init: {}, steps: [
    [{ chapter: MOSIAH3 }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ chapter: MOSIAH4 }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ chapter: MOSIAH3 }, { mode: 'translation', body: 'setup', saved: 'translation' }], // the back button
  ] },
  { name: 'a Citations click on an untranslatable chapter, then a Bible chapter: Citations', init: { mode: 'translation' }, steps: [
    [{ chapter: MOSIAH3 }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ chapter: JOHN3 }, { mode: 'citations', body: 'citations', saved: 'citations' }],
  ] },
  { name: 'unticking the only language while in Translation: the setup card', init: { mode: 'translation' }, steps: [
    [{ chapter: ALMA5_SPA }, { mode: 'translation', body: 'beside', text: 'church:spa', saved: 'translation' }],
    [{ chapter: ALMA5_NONE }, { mode: 'translation', body: 'setup', text: null, saved: 'translation' }],
  ] },
  { name: 'a Translation click on an untranslatable chapter with languages on: the setup card for the visit, translation saved', init: {}, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ chapter: DC76_GIL }, { mode: 'translation', body: 'setup', saved: 'translation' }], // a settings change re-renders it
  ] },
  { name: 'the next chapter, with no click, shows Citations', init: {}, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ chapter: DC77_GIL }, { mode: 'citations', body: 'citations', saved: 'translation' }],
  ] },
  { name: 'a language added from the setup card shows the chapter in it once the check finds it', init: {}, steps: [
    [{ chapter: MOSIAH3 }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'setup', saved: 'translation' }],
    [{ chapter: chapter('bofm/mosiah/3', [church('spa', null)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'translation', body: 'loading', saved: 'translation' }],
    [{ chapter: chapter('bofm/mosiah/3', [church('spa', true)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'translation', body: 'beside', text: 'church:spa', saved: 'translation' }],
  ] },
  { name: 'saved Translation, some text offers the chapter: the latest pick it offers, in the page or the panel', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv'] }) },
      { mode: 'translation', body: 'text', text: 'niv', saved: 'translation' }],
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['church:spa', 'niv'] }) },
      { mode: 'translation', body: 'beside', text: 'church:spa', saved: 'translation' }],
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['church:spa'], layout: 'panel' }) },
      { mode: 'translation', body: 'text', text: 'church:spa', saved: 'translation' }],
    [{ chapter: chapter('bofm/alma/5', [church('spa', false), church('jpn', true)], ['spa', 'jpn'], { picks: ['church:spa'] }) },
      { mode: 'translation', body: 'beside', text: 'church:jpn', saved: 'translation' }],
  ] },
  { name: 'the chapter check still asking: Translation shows its loading state, never Citations first', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', null)], ['gil']) }, { mode: 'translation', body: 'loading', saved: 'translation' }],
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', saved: 'translation' }],
    [{ chapter: chapter('bofm/alma/5', [church('spa', true), church('jpn', null)], ['spa', 'jpn'], { picks: ['church:spa'] }) },
      { mode: 'translation', body: 'beside', text: 'church:spa', saved: 'translation' }],
    [{ chapter: chapter('bofm/alma/6', [church('spa', true), church('jpn', null)], ['spa', 'jpn'], { picks: ['church:jpn'] }) },
      { mode: 'translation', body: 'loading', saved: 'translation' }],
  ] },
  { name: 'saved Citations while the check asks: Citations at once, a Translation click waits for it', init: {}, steps: [
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', null)], ['gil']) }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'loading', saved: 'translation' }],
  ] },
  { name: 'a click on a translatable chapter is saved like any other', init: { mode: 'translation' }, steps: [
    [{ chapter: JOHN3 }, { mode: 'translation', body: 'text', text: 'engwebp', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', text: null, saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'text', text: 'engwebp', saved: 'translation' }],
  ] },
  { name: 'Citations clicked where saved Translation already shows Citations: saved, nothing else moves', init: { mode: 'translation' }, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', saved: 'citations' }],
    [{ chapter: chapter('bofm/alma/5', [church('gil', true)], ['gil']) }, { mode: 'citations', body: 'citations', saved: 'citations' }],
  ] },
  { name: 'the no-translation line: saved Translation, languages on, none offering the chapter -> Citations naming the language', init: { mode: 'translation' }, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'gil', saved: 'translation' }],
    [{ chapter: DC77_GIL }, { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'gil', saved: 'translation' }],
    [{ chapter: ALMA5_SPA }, { mode: 'translation', body: 'beside', note: null, noteLang: null, saved: 'translation' }],
  ] },
  { name: 'the no-translation line, dismissed: Citations, no line', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', false)], ['gil'], { dismissed: true }) },
      { mode: 'citations', body: 'citations', note: null, noteLang: null, saved: 'translation' }],
  ] },
  { name: 'the no-translation line names the most recently picked enabled language', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', false), church('jpn', false)], ['gil', 'jpn'], { picks: ['church:jpn', 'church:gil'] }) },
      { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'jpn', saved: 'translation' }],
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', false), church('jpn', false)], ['gil', 'jpn'], { picks: ['church:spa', 'engwebp', 'church:gil', 'church:jpn'] }) },
      { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'gil', saved: 'translation' }], // spa is no longer enabled; a Bible row is not a language
    [{ chapter: chapter('dc-testament/dc/76', [church('gil', false), church('jpn', false)], ['gil', 'jpn'], { picks: ['engwebp'] }) },
      { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'gil', saved: 'translation' }], // none picked: the first enabled
  ] },
  { name: 'the no-translation line never shows with Citations saved', init: {}, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', note: null, noteLang: null, saved: 'citations' }],
  ] },
  { name: 'the no-translation line never shows on a Bible chapter (the bundled Bible always offers one)', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, church('gil', false)], ['gil']) }, { mode: 'translation', body: 'text', note: null, text: 'engwebp', saved: 'translation' }],
  ] },
  { name: 'Add a language on the line: the setup card for the visit, no line; the next chapter has the line again', init: { mode: 'translation' }, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', note: 'no-translation', saved: 'translation' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'setup', note: null, saved: 'translation' }],
    [{ chapter: DC77_GIL }, { mode: 'citations', body: 'citations', note: 'no-translation', noteLang: 'gil', saved: 'translation' }],
  ] },
  { name: 'a Citations click where the line shows: saved, the line goes with the choice', init: { mode: 'translation' }, steps: [
    [{ chapter: DC76_GIL }, { mode: 'citations', body: 'citations', note: 'no-translation', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', note: null, saved: 'citations' }],
  ] },
  // The page's language (#109): the first Church language in pick order that
  // offers the chapter, while the split layout is in-page — whatever the
  // panel shows. `pageNext` is the language the chapter check must ask first.
  { name: 'Spanish picked, side by side, mode Citations: the page holds Spanish', init: {}, steps: [
    [{ chapter: chapter('bofm/alma/5', [church('spa', true)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'citations', body: 'citations', page: 'church:spa', pageNext: null, saved: 'citations' }],
  ] },
  { name: 'Spanish side by side, then a Citations click: Spanish stays on the page', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('bofm/alma/5', [church('spa', true)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'translation', body: 'beside', text: 'church:spa', page: 'church:spa', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', text: null, page: 'church:spa', saved: 'citations' }],
    [{ click: 'translation' }, { mode: 'translation', body: 'beside', text: 'church:spa', page: 'church:spa', saved: 'translation' }],
  ] },
  { name: 'layout panel: no page language, in either mode', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('bofm/alma/5', [church('spa', true)], ['spa'], { picks: ['church:spa'], layout: 'panel' }) },
      { mode: 'translation', body: 'text', text: 'church:spa', page: null, pageNext: null, saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', page: null, pageNext: null, saved: 'citations' }],
  ] },
  { name: 'Citations, the page\'s language not checked yet: Citations at once, the check asks for it', init: {}, steps: [
    [{ chapter: chapter('bofm/alma/5', [church('spa', null)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'citations', body: 'citations', page: null, pageNext: 'spa', saved: 'citations' }],
    [{ chapter: chapter('bofm/alma/5', [church('spa', true)], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'citations', body: 'citations', page: 'church:spa', pageNext: null, saved: 'citations' }],
  ] },
  { name: 'the next chapter lacks the page\'s language: the next offering pick holds the page, or none', init: {}, steps: [
    [{ chapter: chapter('dc-testament/dc/83', [church('pon', true), church('spa', true)], ['pon', 'spa'], { picks: ['church:pon', 'church:spa'] }) },
      { mode: 'citations', page: 'church:pon', pageNext: null }],
    [{ chapter: chapter('dc-testament/dc/84', [church('pon', false), church('spa', null)], ['pon', 'spa'], { picks: ['church:pon', 'church:spa'] }) },
      { mode: 'citations', page: null, pageNext: 'spa' }],
    [{ chapter: chapter('dc-testament/dc/84', [church('pon', false), church('spa', true)], ['pon', 'spa'], { picks: ['church:pon', 'church:spa'] }) },
      { mode: 'citations', page: 'church:spa', pageNext: null }],
    [{ chapter: chapter('dc-testament/dc/84', [church('pon', false)], ['pon'], { picks: ['church:pon'] }) },
      { mode: 'citations', page: null, pageNext: null }],
  ] },
  // A Bible version beside the page's language (#110): John 3 can show the
  // site's KJV, Spanish split into the page and NIV in the panel.
  { name: 'John 3, Spanish on the page, NIV selected: NIV plus the beside-the-page line', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv', 'church:spa'] }) },
      { mode: 'translation', body: 'text', text: 'niv', page: 'church:spa', note: 'beside-page', noteLang: 'spa', saved: 'translation' }],
    [{ click: 'citations' }, { mode: 'citations', body: 'citations', page: 'church:spa', note: null, noteLang: null }],
  ] },
  // The line's Change opens the layout control in its place; each pick there
  // is a layout step (layoutChoice, applied as content.js applies it).
  { name: '"In the panel" from the line: layout panel, Spanish selected, no page language', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv', 'church:spa'] }) },
      { body: 'text', text: 'niv', page: 'church:spa', note: 'beside-page' }],
    [{ layout: 'panel' }, { mode: 'translation', body: 'text', text: 'church:spa', page: null, note: null, layout: 'panel', saved: 'translation' }],
  ] },
  { name: 'Under each verse from the line: the page keeps Spanish, NIV and the line stay', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv', 'church:spa'] }) },
      { body: 'text', text: 'niv', page: 'church:spa', note: 'beside-page' }],
    [{ layout: 'interlinear' }, { body: 'text', text: 'niv', page: 'church:spa', note: 'beside-page', layout: 'interlinear' }],
  ] },
  { name: '"In the panel" from the beside card: Spanish moves into the panel', init: { mode: 'translation' }, steps: [
    [{ chapter: ALMA5_SPA }, { body: 'beside', text: 'church:spa', page: 'church:spa' }],
    [{ layout: 'panel' }, { body: 'text', text: 'church:spa', page: null, layout: 'panel' }],
    [{ layout: 'columns' }, { body: 'beside', text: 'church:spa', page: 'church:spa', layout: 'columns' }],
  ] },
  { name: 'John 3, Spanish selected while it holds the page: the beside card, no line', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['church:spa', 'niv'] }) },
      { mode: 'translation', body: 'beside', text: 'church:spa', page: 'church:spa', note: null, noteLang: null, saved: 'translation' }],
  ] },
  { name: 'John 3, Spanish read in the panel, NIV selected: NIV, no line (nothing is on the page)', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv', 'church:spa'], layout: 'panel' }) },
      { mode: 'translation', body: 'text', text: 'niv', page: null, note: null, noteLang: null }],
  ] },
  { name: 'John 3, NIV selected, Spanish not checked yet: NIV shows at once, the check asks for the page', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', null)], ['spa'], { picks: ['niv', 'church:spa'] }) },
      { mode: 'translation', body: 'text', text: 'niv', page: null, pageNext: 'spa', note: null, saved: 'translation' }],
    [{ chapter: chapter('nt/john/3', [WEB, NIV, church('spa', true)], ['spa'], { picks: ['niv', 'church:spa'] }) },
      { mode: 'translation', body: 'text', text: 'niv', page: 'church:spa', note: 'beside-page', noteLang: 'spa' }],
  ] },
  { name: 'before any chapter: the stored mode, Translation as its loading state', init: { mode: 'translation' }, steps: [
    [{}, { mode: 'translation', body: 'loading', saved: 'translation' }],
  ] },
];

console.log('arrangement:');
for (const c of ARRANGEMENT_CASES) {
  s = fresh(c.init);
  c.steps.forEach(([act, want], i) => {
    if (act.chapter) P.setChapter(s, act.chapter);
    if (act.click) P.selectMode(s, act.click);
    if (act.layout) {
      // What content.js does with a layout pick: write the setting, remember
      // the row it names, and arrange the same chapter again.
      const w = P.layoutChoice(P.arrangementOf(s), act.layout);
      const picks = w.pick ? CT.rememberPick(s.facts.picks, w.pick) : s.facts.picks;
      P.setChapter(s, Object.assign({ key: s.chapter }, s.facts, { layout: w.layout, picks }));
    }
    const a = P.arrangementOf(s);
    const got = {};
    for (const k of Object.keys(want)) got[k] = k === 'saved' ? s.mode : k === 'layout' ? s.facts.layout : a[k];
    eq(got, want, `${c.name} (step ${i + 1})`);
  });
}

// What a click saves, and what the shell is told.
const DC76_FACTS = { texts: [church('gil', false)], picks: [], languages: ['gil'], layout: 'columns' };
eq(P.arrangement(Object.assign({ mode: 'citations', click: 'translation' }, DC76_FACTS)).saves, 'translation',
  'a Translation click saves translation');
eq(P.arrangement(Object.assign({ mode: 'translation', click: 'translation' }, DC76_FACTS)).saves, null,
  '...and nothing once translation is what is stored');
eq(P.arrangement(Object.assign({ mode: 'translation', click: null }, DC76_FACTS)).saves, null, 'no click saves nothing');
s = fresh();
P.setChapter(s, DC76_GIL);
eq(P.selectMode(s, 'translation'), true, 'selectMode: true when the mode showing changed (content re-renders)');
eq(P.selectMode(s, 'translation'), false, '...a repeat click changes nothing');
s = fresh({ mode: 'translation' });
P.setChapter(s, DC76_GIL);
eq([P.selectMode(s, 'citations'), s.mode], [false, 'citations'], 'a click can save without changing what shows');
eq(P.selectMode(s, 'bogus'), false, 'a garbage mode click cannot corrupt state');
eq(s.mode, 'citations', '...the stored mode is untouched');
eq(P.effectiveMode(s), P.arrangementOf(s).mode, 'effectiveMode is the arrangement\'s mode');
s = fresh();
P.setChapter(s, DC76_GIL);
P.selectMode(s, 'translation');
P.setChapter(s, { texts: [church('gil', false)], languages: ['gil'] });
eq(P.effectiveMode(s), 'citations', 'a chapter with no key counts as a new one (the visit\'s click does not leak)');

// ---- selectCitationView ----
console.log('selectCitationView:');
s = fresh({ mode: 'citations', citationView: 'source' });
eq(P.selectCitationView(s, 'verse'), true, 'switching layout in citations mode reports a change');
eq(s.citationView, 'verse', '...and lands on the new layout');
eq(P.selectCitationView(s, 'verse'), false, 're-selecting the current layout is a no-op');

s = fresh({ mode: 'translation', citationView: 'source' });
P.setChapter(s, JOHN3);
eq(P.selectCitationView(s, 'verse'), false, 'the layout toggle only acts while citations are showing');
eq(s.citationView, 'source', '...and the stored layout is untouched');

s = fresh({ mode: 'translation', citationView: 'source' });
P.setChapter(s, DC76_GIL);
eq(P.selectCitationView(s, 'verse'), true, 'Citations shown under a stored Translation count as citations showing');
P.selectMode(s, 'translation');
eq(P.selectCitationView(s, 'source'), false, "...but not while the visit's click shows the setup card");

// ---- sameChapter ----
// A settings change, or the chapter check settling, re-shows the chapter
// showing; the views it cached stay valid. They depend on the chapter, not on
// which texts offer it.
console.log('sameChapter:');
s = fresh();
P.setChapter(s, JOHN3);
eq(P.sameChapter(s, JOHN3), true, 'the same chapter again');
eq(P.sameChapter(s, chapter('nt/john/3', [], [])), true, '...whatever now offers it');
eq(P.sameChapter(s, chapter('nt/john/4', [WEB], [])), false, 'another chapter');
eq(P.sameChapter(fresh(), JOHN3), false, 'a panel that has shown nothing yet');
eq(P.sameChapter(s, null), false, 'no chapter at all');

// ---- View host ----
// The DOM node is opaque to the core, so `{ name, key }` stands in for one.
// `show` is what the shell's showView does around selectView: on a rebuild it
// attaches a container, runs the render, and settles the entry. `produced`
// mirrors the shell's "the render left something in the container" test.
function show(v, name, key, opts) {
  const o = opts || {};
  const r = P.selectView(v, name, key, o.cache);
  if (r.action === 'build') {
    r.entry.node = { name, key };
    if (o.mark !== undefined) P.keepView(v, o.mark); // what the view said while rendering
    P.settleView(r.entry, o.produced !== false);
  }
  return r;
}

console.log('view host:');
let v = P.createViews();
eq(v.active, null, 'a fresh host has nothing mounted');

let r = show(v, 'citations', 'john/3::source');
eq(r.action, 'build', 'the first request for a view builds it');
eq(v.active, 'citations', '...and mounts it');

P.saveViewScroll(v, 420);
r = show(v, 'translation', 'john/3::niv');
eq(r.action, 'build', 'another name is another view');
eq(v.entries.citations.scrollTop, 420, "...and the outgoing view's scroll was recorded");

P.saveViewScroll(v, 90);
r = show(v, 'citations', 'john/3::source');
eq(r.action, 'restore', 'coming back to the same content re-mounts it');
eq(r.entry.scrollTop, 420, '...at the scroll offset it was left at');
// Translation records its offset like everyone else — it is being page-driven
// that stops the number being *read*, not written (see scroll ownership below).
eq(v.entries.translation.scrollTop, 90, '...and so was the page-driven view, harmlessly');

v = P.createViews();
show(v, 'citations', 'john/3::source');
r = show(v, 'citations', 'john/3::verse');
eq(r.action, 'build', 'a different key rebuilds instead of re-mounting');
r = show(v, 'citations', 'john/3::source');
eq(r.action, 'build', '...and the superseded body is gone (one slot per name)');

// The talk reader is cached like the rest: a trip to Translation and back
// re-mounts the same talk at the offset it was left at. (A click on a row is a
// fresh open: the orchestrator numbers it into the key, so it always builds.)
v = P.createViews();
show(v, 'talk', 'talk-1#c9', { produced: true });
P.saveViewScroll(v, 3200);
show(v, 'translation', 'john/3::niv');
r = show(v, 'talk', 'talk-1#c9');
eq(r.action, 'restore', 'the talk that was open comes back');
eq(r.entry.scrollTop, 3200, '...where it was left');

// cache:false — a view that must be rebuilt every time.
v = P.createViews();
show(v, 'talk', 'talk-1#c9', { cache: false });
r = show(v, 'talk', 'talk-1#c9', { cache: false });
eq(r.action, 'build', 'an uncacheable view is rebuilt even for the same key');

// A body earns its slot. What a view says while rendering wins over the
// host's default, so a spinner or an error is never re-mounted in place of a
// retry — and a render that bailed out after an await caches nothing at all.
v = P.createViews();
show(v, 'translation', 'john/3::niv', { mark: false });
r = show(v, 'translation', 'john/3::niv');
eq(r.action, 'build', 'a view that marked itself not-worth-keeping is rebuilt');

v = P.createViews();
show(v, 'translation', 'john/3::niv', { mark: true, produced: false });
r = show(v, 'translation', 'john/3::niv');
eq(r.action, 'restore', 'a view that marked itself worth keeping is re-mounted');

v = P.createViews();
show(v, 'translation', 'john/3::niv', { produced: false });
r = show(v, 'translation', 'john/3::niv');
eq(r.action, 'build', 'a render that painted nothing leaves no cached body');

v = P.createViews();
show(v, 'citations', 'john/3::source', { produced: true });
r = show(v, 'citations', 'john/3::source');
eq(r.action, 'restore', 'a render that finished and painted earns its slot');

P.keepView(P.createViews(), true); // no mounted view -> no throw
check(true, 'keepView with nothing mounted is a no-op');

// dropViews — a new chapter invalidates everything at once.
v = P.createViews();
show(v, 'citations', 'john/3::source');
show(v, 'translation', 'john/3::niv');
P.dropViews(v);
eq(v.active, null, 'dropping views unmounts');
eq(show(v, 'citations', 'john/3::source').action, 'build', '...and nothing survives to re-mount');

// The same chapter shown again (a settings change: the options page saves on
// every click) keeps the list and the talk — only Translation's inputs moved.
eq(P.SAME_CHAPTER_VIEWS, ['citations', 'talk'], 'a same-chapter re-render keeps Citations and the talk');
v = P.createViews();
show(v, 'citations', 'john/3::source', { produced: true });
P.saveViewScroll(v, 800);
show(v, 'talk', 'talk-1#c9#1', { produced: true });
P.saveViewScroll(v, 2400);
show(v, 'translation', 'john/3::niv', { mark: true });
P.dropViews(v, P.SAME_CHAPTER_VIEWS);
eq(v.active, null, 'the dropped Translation view is no longer the mounted one');
r = show(v, 'talk', 'talk-1#c9#1');
eq([r.action, r.entry.scrollTop], ['restore', 2400], 'the open talk survives, at its scroll');
r = show(v, 'citations', 'john/3::source');
eq([r.action, r.entry.scrollTop], ['restore', 800], 'the list survives, at its scroll');
eq(show(v, 'translation', 'john/3::niv').action, 'build', '...while Translation is rebuilt from the new settings');
v = P.createViews();
show(v, 'citations', 'john/3::source', { produced: true });
P.dropViews(v, P.SAME_CHAPTER_VIEWS);
eq(v.active, 'citations', 'a kept view that was mounted stays the mounted one');

// Scroll bookkeeping is defensive: garbage never becomes a scroll offset.
v = P.createViews();
show(v, 'citations', 'k');
P.saveViewScroll(v, -30);
eq(v.entries.citations.scrollTop, 0, 'a negative scroll clamps to the top');
P.saveViewScroll(v, undefined);
eq(v.entries.citations.scrollTop, 0, 'a missing scroll reads as the top');

// ---- Who owns a view's scroll position ----
// Translation mirrors the page, so it must not also save/restore an offset —
// the two would fight over the same body on every page scroll.
console.log('scroll ownership:');
eq(P.viewRestoresScroll('citations'), true, 'citations owns its scroll position');
eq(P.viewRestoresScroll('talk'), true, 'the talk reader owns its scroll position');
eq(P.viewRestoresScroll('translation'), false, 'translation is page-driven, so it does not restore');
eq(P.viewRestoresScroll(null), true, 'an unknown view defaults to owning its scroll');

// With scroll-sync switched off there is no page-driven view at all: nothing
// else is going to place the Translation body, so it must save and restore its
// own offset like every other view.
eq(P.viewRestoresScroll('translation', false), true, 'sync off -> translation owns its scroll too');
eq(P.viewRestoresScroll('translation', true), false, 'sync on -> translation is page-driven again');
eq(P.viewRestoresScroll('citations', false), true, 'sync off changes nothing for citations');

// Recording is unconditional; only *restoring* is a matter of ownership. A
// page-synced view that recorded nothing would come back to the top of the
// chapter if the setting took the page away from it while the view was cached.
v = P.createViews();
show(v, 'translation', 'john/3::niv');
P.saveViewScroll(v, 500);
eq(v.entries.translation.scrollTop, 500, 'even a page-synced view records where it was left');

// The ordering that made this necessary: read Translation with sync on, detour
// to Citations, turn the setting off, come back. The offset recorded on the way
// out is what the view now owns — a 0 there would jump the reader to the top.
v = P.createViews();
show(v, 'translation', 'john/3::niv');
P.saveViewScroll(v, 400); // leaving Translation while it was still page-synced
show(v, 'citations', 'john/3::source');
P.saveViewScroll(v, 120);
r = show(v, 'translation', 'john/3::niv');
eq(r.action, 'restore', 'Translation re-mounts across the detour');
eq(P.viewRestoresScroll('translation', false), true, '...and with sync now off it owns its scroll');
eq(r.entry.scrollTop, 400, '...so it comes back where the reader was, not to the top');

v = P.createViews();
show(v, 'citations', 'john/3::source');
P.saveViewScroll(v, 500);
show(v, 'translation', 'john/3::niv');
P.saveViewScroll(v, 800); // the page-synced view's own scroll must not leak
r = show(v, 'citations', 'john/3::source');
eq(r.action, 'restore', 'citations still re-mounts across a translation detour');
eq(r.entry.scrollTop, 500, '...at its own saved offset, untouched by scroll-sync');

// ---- When scroll-sync runs at all ----
// Four inputs, all of which can move independently; the panel re-asserts this
// predicate after each of them and nowhere else.
console.log('wantsScrollSync:');
const syncable = { visible: true, scrollSync: true };
eq(P.wantsScrollSync(fresh({ mode: 'translation' }), syncable), true, 'a visible, expanded Translation view syncs');
eq(P.wantsScrollSync(fresh(), { visible: false, scrollSync: true }), false, 'a hidden panel does not sync');
eq(P.wantsScrollSync(fresh({ collapsed: true }), syncable), false, 'a collapsed panel does not sync');
eq(P.wantsScrollSync(fresh({ mode: 'citations' }), syncable), false, 'citations mode does not sync');
eq(P.wantsScrollSync(fresh(), { visible: true, scrollSync: false }), false, 'the setting switches it off outright');
const untranslatable = fresh({ mode: 'translation' });
P.setChapter(untranslatable, DC76_GIL);
eq(P.wantsScrollSync(untranslatable, syncable), false, 'Citations shown under a stored Translation does not sync');
P.selectMode(untranslatable, 'translation');
eq(P.wantsScrollSync(untranslatable, syncable), true, "the visit's click shows Translation (the setup card), so it syncs");
// Defensive: a missing flag must not read as "on" for visibility, nor as "off"
// for the setting (the panel asks before its first settings read resolves).
eq(P.wantsScrollSync(fresh(), {}), false, 'no visibility means no sync');
eq(P.wantsScrollSync(fresh({ mode: 'translation' }), { visible: true }), true, 'an unknown setting reads as its default (on)');

// ---- Damped scroll step ----
// The body eases toward a target instead of teleporting. Frame-rate
// independent: the same elapsed time must cover the same distance whether the
// display runs at 60Hz or 120Hz.
console.log('scrollStep:');
const TAU = 90;
check(P.scrollStep(0, 1000, 16, TAU) > 0, 'a step moves toward the target');
check(P.scrollStep(0, 1000, 16, TAU) < 1000, '...without arriving in one frame');
check(P.scrollStep(1000, 0, 16, TAU) < 1000, 'a step moves downward too');
check(P.scrollStep(1000, 0, 16, TAU) > 0, '...without overshooting past the target');

const oneBigFrame = P.scrollStep(0, 1000, 16, TAU);
const twoHalfFrames = P.scrollStep(P.scrollStep(0, 1000, 8, TAU), 1000, 8, TAU);
check(Math.abs(oneBigFrame - twoHalfFrames) < 1, 'one 16ms frame covers what two 8ms frames do (frame-rate independent)');

let pos = 0;
for (let i = 0; i < 600; i++) pos = P.scrollStep(pos, 1000, 16, TAU);
check(Math.abs(1000 - pos) < 0.5, 'the chase converges on its target');

check(P.scrollStep(0, 1000, 16, 0) === 1000, 'a non-positive tau means no easing — land on the target');
// A duplicate or backwards rAF timestamp must not be read as "arrive now":
// no time has passed, so nothing moves. Teleporting here would be the snap.
check(P.scrollStep(0, 1000, 0, TAU) === 0, 'a zero-length frame holds position');
check(P.scrollStep(400, 1000, -5, TAU) === 400, 'a backwards timestamp holds position');
check(P.scrollStep(250, 250, 16, TAU) === 250, 'a step toward where we already are stays put');
check(P.scrollStep(undefined, 400, 16, TAU) >= 0, 'garbage input cannot produce a negative position');

// ---- Ramp-in ----
// A re-alignment must have a visible beginning: an exponential chase is
// fastest on its first frame, which reads as being thrown. The ramp scales the
// first fraction of a second so the move accelerates in, then eases out.
console.log('easeRamp:');
const RAMP = 260;
eq(P.easeRamp(0, RAMP), 0, 'the move starts from a standstill');
check(P.easeRamp(RAMP, RAMP) === 1, 'the ramp is fully open once it has elapsed');
check(P.easeRamp(RAMP * 5, RAMP) === 1, '...and stays open after that');
check(P.easeRamp(RAMP / 2, RAMP) > 0.4 && P.easeRamp(RAMP / 2, RAMP) < 0.6, 'halfway through the ramp is about half open');
check(P.easeRamp(RAMP * 0.1, RAMP) < 0.1, 'it opens slowly at first (smoothstep, no corner)');
check(P.easeRamp(100, 0) === 1, 'no ramp configured means fully open');
check(P.easeRamp(-50, RAMP) === 0, 'a negative elapsed cannot open the ramp');

// The ramp only slows the early frames; it must never stop the move arriving.
let ramped = 0;
for (let i = 0; i < 600; i++) ramped = P.scrollStep(ramped, 1000, 16, TAU, P.easeRamp(i * 16, RAMP));
check(Math.abs(1000 - ramped) < 0.5, 'a ramped chase still converges');
check(P.scrollStep(0, 1000, 16, TAU, 0) === 0, 'a fully closed ramp holds position');
check(P.scrollStep(0, 1000, 16, TAU, 1) === P.scrollStep(0, 1000, 16, TAU), 'a fully open ramp is the plain chase');
const early = P.scrollStep(0, 1000, 16, TAU, P.easeRamp(0, RAMP));
const later = P.scrollStep(0, 1000, 16, TAU, P.easeRamp(RAMP, RAMP));
check(early < later, 'the first frame moves less than a frame at full speed');

// ---- When a re-alignment is over ----
// Getting this wrong strands the panel in "re-aligning" forever, and every
// later page scroll takes the eased path instead of tracking 1:1.
console.log('realignmentDone:');
const LIM = P.SCROLL_LIMITS; // the shipped policy, not a copy of it
const AFTER = LIM.stallAfterMs + 1;
function done(distance, moved, elapsed) {
  return P.realignmentDone({ distance, moved, elapsed }, LIM);
}
check(done(0.4, 2, AFTER) === true, 'inside the settle threshold is arrived');
check(done(-0.4, 2, AFTER) === true, '...approaching from either side');
check(done(50, 3, AFTER) === false, 'still far away and still moving: keep going');
check(done(50, 0, AFTER) === true, 'far away but no longer moving at all: the browser rounded us to a stop');
check(done(50, 0.5, AFTER) === false, 'inching along is not a stall — a step shrinks with the distance left');
check(done(50, null, 0) === false, 'the first frame has not moved yet — that is not a stall');
// The ramp deliberately makes the opening frames nearly still. Reading that as
// a stall would cancel every re-alignment on frame one — the bug this guards.
check(done(50, 0, 0) === false, 'a motionless frame during ramp-in is the ramp working, not a stall');
check(done(50, 0, LIM.stallAfterMs - 1) === false, '...right up to the end of the ramp window');
check(done(50, 0, AFTER) === true, '...and only counts once the ramp is open');
check(done(50, 3, LIM.maxMs) === true, 'past the cap, stop chasing whatever the distance');
check(done(50, 3, LIM.maxMs - 1) === false, '...but not one frame before it');

// ---- Scrolling on while the panel is still re-aligning ----
// The page's own movement is the panel's to mirror 1:1; only the detach gap
// eases. Carrying the body by the page's delta is what keeps the two apart —
// without it the chase trails a target that runs away from it, and the panel
// floats along behind the page for as long as the user keeps scrolling.
console.log('carryScroll:');
const MAXPX = 1000;
eq(P.carryScroll(200, 500, 560, MAXPX), 260, "the body moves exactly as far as the page's target did");
eq(P.carryScroll(560 - 300, 500, 560, MAXPX) - (560 - 300), 60, 'and the gap it is closing survives the carry untouched');
eq(P.carryScroll(200, 500, 440, MAXPX), 140, 'scrolling back up carries the same way');
eq(P.carryScroll(20, 500, 400, MAXPX), 0, 'a carry past the top clamps at the top');
eq(P.carryScroll(980, 500, 600, MAXPX), MAXPX, '...and past the bottom at the bottom');
eq(P.carryScroll(300, 500, 500, MAXPX), 300, 'a target that did not move moves nothing');

// The truth table above cannot see the frame-to-frame behaviour, which is
// where the real bug lived. Run the actual loop with the shipped constants.
//   round   store whole pixels, as the browser really does
//   page    px the page scrolls every frame, mid-re-alignment. The shell
//           carries the body along by that much and moves the mark `moved` is
//           measured from, so the gap — and only the gap — is what eases
//   max     the body's scrollable range, so a carry can hit the end of it
function realign(distance, opts) {
  const o = opts || {};
  const round = o.round === true;
  const page = Number(o.page) || 0;
  const max = o.max === undefined ? Infinity : o.max;
  let target = distance;
  let pos = 0;
  let wasAt = null;
  let started = null;
  let frames = 0;
  for (let ts = 0; ts < 20000; ts += 16) {
    if (started === null) started = ts;
    const moved = wasAt === null ? null : pos - wasAt;
    const elapsed = ts - started;
    if (P.realignmentDone({ distance: target - pos, moved, elapsed }, LIM)) {
      return { frames, ms: elapsed, snapped: Math.abs(target - pos) };
    }
    wasAt = pos;
    const ramp = P.easeRamp(elapsed, P.SCROLL_RAMP_MS);
    pos = P.floorStep(pos, P.scrollStep(pos, target, 16, P.SCROLL_TAU_MS, ramp), target, P.SCROLL_MIN_STEP_PX);
    if (round) pos = Math.round(pos); // what the browser actually stores
    if (page) {
      // The page's target is bounded by the body's own range, exactly as
      // `fraction * panelDenom` is in the shell.
      const next = Math.min(max, target + page);
      const at = pos;
      pos = P.carryScroll(at, target, next, max);
      wasAt += pos - at; // the carry was the page's travel, not the chase's
      target = next;
    }
    frames++;
  }
  return { frames, ms: 20000, snapped: Math.abs(target - pos), ranAway: true };
}

for (const d of [50, 300, 1000]) {
  const r = realign(d);
  check(!r.ranAway, `a ${d}px re-alignment terminates`);
  check(r.frames > 3, `a ${d}px re-alignment actually animates (${r.frames} frames, not an instant snap)`);
  check(r.ms < LIM.maxMs, `a ${d}px re-alignment finishes well inside the cap (${Math.round(r.ms)}ms)`);
  check(r.snapped <= LIM.settlePx, `a ${d}px re-alignment arrives rather than jumping the last stretch`);
  const rounded = realign(d, { round: true });
  check(!rounded.ranAway, `a ${d}px re-alignment terminates even when the browser rounds scrollTop`);
  check(rounded.frames > 3, `...and still animates (${rounded.frames} frames)`);
}

// Now the same loop with the user scrolling the page all the way through the
// re-alignment. The carry is what makes this indistinguishable from the still
// case: the panel matches the page 1:1 the whole time and the gap closes on its
// own schedule. Get it wrong and the panel trails the page — by roughly
// tau x velocity — until the scrolling stops.
for (const speed of [8, 40]) {
  const still = realign(300);
  const scrolling = realign(300, { page: speed });
  check(!scrolling.ranAway, `re-aligning while the page scrolls on at ${speed}px/frame still terminates`);
  eq(scrolling.frames, still.frames, `...in the same ${still.frames} frames as a still page — scrolling on cannot prolong it`);
  check(scrolling.snapped <= LIM.settlePx, '...and it arrives rather than trailing the page');
  // Whole-pixel rounding is what strands a chase, and a page scroll used to
  // blind the stall test that catches it: the carry moved the body every frame,
  // so "how far did the chase get" was never measured.
  const rounded = realign(300, { page: speed, round: true });
  check(!rounded.ranAway, `...and terminates too when the browser rounds scrollTop (${rounded.frames} frames)`);
  check(rounded.snapped <= LIM.settlePx, '...arriving rather than being cut off by the cap');
}

// The body can run out of room mid-carry (already at the bottom, page still
// scrolling). The gap then closes against the end of the range instead.
const atBottom = realign(300, { page: 40, max: 300 });
check(!atBottom.ranAway, 'a re-alignment whose carry hits the end of the body still terminates');
check(atBottom.snapped <= LIM.settlePx, '...and still arrives rather than jumping the last stretch');

// ---- Where a revealed target lands ----
// Opening a citation used to park the target at the very top of the panel, so
// the sentence leading into it was above the fold. The rule places it near the
// vertical middle instead — expressed as a fraction of the visible body, so it
// holds at any panel width or window height — and both clamp cases (a target
// too near the top or the bottom of the content to be centered) are intended
// behaviour, not an accident of clamping.
console.log('revealTop:');
const VIEW = 800;
const MAX = 5000;
function reveal(targetTop, opts) {
  return P.revealTop(Object.assign({ targetTop, viewportH: VIEW, maxScroll: MAX }, opts || {}));
}
const middle = reveal(2000);
check(2000 - middle > VIEW * 0.25, 'a revealed target has room above it for the paragraph leading in');
check(2000 - middle < VIEW * 0.6, '...and still sits near the middle rather than the bottom');
eq(reveal(2000), 2000 - VIEW * P.SCROLL_REVEAL_FRACTION, 'the gap above the target is a fraction of the visible body');
// The same target in a taller panel keeps the same *proportion*, not the same
// pixel count — the whole reason this is not a magic number.
eq(P.revealTop({ targetTop: 2000, viewportH: 1600, maxScroll: MAX }), 2000 - 1600 * P.SCROLL_REVEAL_FRACTION,
  'a taller panel leaves proportionally more context above');

// Clamp cases: "as close as possible", never a failure and never a bounce.
eq(reveal(10), 0, 'a target too near the top of the content scrolls to the top');
eq(reveal(0), 0, '...including the very first thing in the view');
eq(reveal(MAX + 500), MAX, 'a target near the end scrolls to the bottom, where it is still visible');
check(reveal(MAX) <= MAX, 'no destination past the end of the scrollable range');
eq(P.revealTop({ targetTop: 500, viewportH: VIEW, maxScroll: 0 }), 0, 'an unscrollable body stays at the top');

// The talk reader's sticky header covers the top of the body. Centering clears
// it on any ordinary panel, but that must be a floor in the rule rather than a
// happy accident of the numbers.
const HEAD = 64;
check(2000 - reveal(2000, { clearTop: HEAD }) >= HEAD, 'a centered target clears the sticky header');
eq(reveal(2000, { clearTop: HEAD }), reveal(2000), '...without the header changing where centering puts it');
// A panel shorter than about twice the header: centering would tuck the target
// under it, so the floor takes over.
const short = P.revealTop({ targetTop: 2000, viewportH: 100, maxScroll: MAX, clearTop: HEAD });
check(2000 - short >= HEAD, 'in a short panel the target is still pushed clear of the header');
check(2000 - short > 100 * P.SCROLL_REVEAL_FRACTION, '...which is further down than centering alone would put it');
// Degenerate: a panel shorter than its own header. Keeping the target on
// screen outranks keeping it clear, so the floor gives way — landing it *at*
// the bottom edge would be the same as not showing it.
const tiny = P.revealTop({ targetTop: 2000, viewportH: 40, maxScroll: MAX, clearTop: HEAD });
check(2000 - tiny < 40, 'a panel shorter than its header still keeps the target inside the body');
// The one case the floor cannot honour: no scroll position lifts content that
// is already above the fold, so the top clamp wins and the panel goes to the
// top rather than inventing a negative scroll.
eq(P.revealTop({ targetTop: 20, viewportH: VIEW, maxScroll: MAX, clearTop: HEAD }), 0,
  'a target inside the top clamp scrolls to the top — no scroll position can clear it');

// Garbage in cannot produce a garbage scroll position.
check(P.revealTop({}) === 0, 'a placement with nothing to measure is the top');
check(P.revealTop({ targetTop: -500, viewportH: VIEW, maxScroll: MAX }) === 0, 'a negative target clamps to the top');
check(P.revealTop({ targetTop: 2000, viewportH: -10, maxScroll: MAX }) === 2000, 'a nonsense viewport leaves no gap rather than a negative one');

// ---- The header's text-size stepper ----
// One rule serves both jobs the A− / A+ buttons need: where a step lands, and
// whether a button is spent. `null` means "this direction changes nothing" —
// the caller disables that button and writes no setting, so a click at the end
// of the range is not a storage write that normalizes back to the same number.
// The grid comes from __BTX.settings (the owner of the clamp); this only walks
// the bounds it is handed.
console.log('stepFontScale:');
const SCALE = { min: 0.7, max: 1.6, step: 0.1 };
function step(scale, dir) { return P.stepFontScale(scale, dir, SCALE); }
eq(step(1, 1), 1.1, 'a step up moves one grid notch');
eq(step(1, -1), 0.9, 'a step down moves one grid notch');
// 0.7 + 0.1 = 0.7999999999999999 in floats. An un-rounded result would not
// compare equal to the same value written by the options slider, and every
// step would look like a change to `diff`.
eq(step(0.7, 1), 0.8, 'a step lands on a clean grid value, not float dust');
eq(step(0.8, 1), 0.9, '...at every notch');
eq(step(1.5, 1), 1.6, 'the last step reaches the maximum exactly');
eq(step(1.6, 1), null, 'at the maximum there is nowhere up to go');
eq(step(0.7, -1), null, 'at the minimum there is nowhere down to go');
eq(step(1.55, 1), 1.6, 'a step that would overshoot clamps to the end instead');
eq(step(0.75, -1), 0.7, '...at the low end too');
eq(step(1, 0), null, 'a step of no direction is not a step');
for (const bad of [null, undefined, NaN, 'big', {}]) {
  eq(step(bad, 1), null, `a ${String(bad)} scale steps nowhere`);
}
// Walking the whole range from either end terminates on the grid — the
// disabled state is reachable, and no notch is skipped.
let walk = SCALE.min;
let notches = 0;
for (let next = step(walk, 1); next !== null; next = step(walk, 1)) {
  walk = next;
  if (++notches > 100) break;
}
eq(walk, SCALE.max, 'stepping up from the minimum ends at the maximum');
eq(notches, Math.round((SCALE.max - SCALE.min) / SCALE.step), 'the walk hits every notch on the grid, once');

// ---- What the Translation cards and errors say ----
// Copy rules the DOM shell renders verbatim: which heading, which action.
console.log('noteCopy:');
{
  const n = P.noteCopy({ kind: 'no-translation', language: 'Kiribati', chapter: 'Doctrine and Covenants 76' });
  eq(n.text, 'No Kiribati translation for Doctrine and Covenants 76.', 'the no-translation line names the language and the chapter');
  eq(n.view, 'citations', '...and sits above the citation list');
  eq(n.actions.map((a) => [a.id, a.label]), [['add', 'Add a language'], ['dismiss', '×']], '...with Add a language, then ×');
  check(typeof n.actions[1].title === 'string' && n.actions[1].title.length > 0, '...the × is named for assistive tech');
  const b = P.noteCopy({ kind: 'beside-page', language: 'Español' });
  eq([b.text, b.view], ['Español is beside the page text ·', 'translation'],
    'the beside-the-page line names the language on the page, above the Bible version in the panel');
  eq(b.actions.map((a) => [a.id, a.label]), [['change', 'Change']], '...with Change (the layout control, in its place) and no ×');
  eq(P.noteCopy({ kind: 'beside-page' }).text, 'A language is beside the page text ·', '...a missing name falls back to a plain sentence');
  eq(P.noteCopy(null), null, 'no note, no copy');
  eq(P.noteCopy({ kind: 'bogus' }), null, 'an unknown note kind has no copy');
  eq(P.noteCopy({ kind: 'no-translation' }).text, 'No translation for this chapter.', 'missing names fall back to a plain sentence');
}

console.log('setupCopy:');
{
  const bible = P.setupCopy({ chapter: 'John 3', bible: 'nokey' });
  eq(bible.heading, 'Read John 3 in another translation or language', 'a Bible chapter offers translations and languages');
  // The World English Bible ships with the extension, so api.bible is the
  // way to *more* translations, not the way to any.
  eq(bible.bible, {
    text: 'More Bible translations, such as NIV and NKJV, need a free api.bible key.', button: 'Set up more translations',
    disclosure: 'Connecting sends the chapters you open, your key, and an anonymous usage report to API.Bible.',
  }, 'no key yet: the api.bible block offers more translations, sets them up, and says what connecting sends');
  eq(P.setupCopy({ chapter: 'John 3', bible: 'noversions' }).bible.text, 'Turn on more Bible translations from your api.bible key.',
    'a key but no version on: the block offers turning on more');
  eq(P.setupCopy({ chapter: 'John 3', bible: 'noversions' }).bible.button, 'Choose Bible translations',
    'a key but nothing turned on: the button goes to choosing');
  const bofm = P.setupCopy({ chapter: 'Alma 5', bible: null });
  eq(bofm.heading, 'Read Alma 5 in another language', 'off the Bible only languages are offered');
  eq(bofm.bible, null, '...and there is no api.bible block');
  eq(bofm.talks, 'See the talks that cite Alma 5', 'the talks link names the chapter');
  eq(bofm.languages, 'Choose a Church language…', 'the language picker prompts for a choice');
  eq(bofm.add, 'Add', '...which the Add button commits (choosing alone writes nothing)');
}

console.log('besideCopy:');
{
  const b = (o) => P.besideCopy(Object.assign({ name: 'Spanish' }, o));
  const WIDEN = 'Collapse panel for wider columns';
  eq(b({ layout: 'columns', effective: 'columns' }),
    { status: 'Spanish is shown side by side.', note: '', collapse: WIDEN, pressed: 'columns' }, 'columns that fit: side by side, and collapsing widens them');
  eq(b({ layout: 'columns', effective: 'interlinear', collapseFits: true }),
    { status: 'Spanish is shown under each verse.', note: 'Collapse the panel for side by side.', collapse: WIDEN, pressed: 'interlinear' },
    'columns asked for but not fitting: the card says what the page really shows, and what would make room');
  eq(b({ layout: 'columns', effective: 'interlinear', collapseFits: false }),
    { status: 'Spanish is shown under each verse.', note: 'Not enough room for side by side.', collapse: null, pressed: 'interlinear' },
    '...where collapsing would not make room either: only that there is not enough room, and no collapse button');
  eq(b({ layout: 'interlinear', effective: 'interlinear' }),
    { status: 'Spanish is shown under each verse.', note: '', collapse: null, pressed: 'interlinear' }, 'under each verse: nothing to widen');
  eq(b({ layout: 'columns', effective: null }).status, 'Spanish is shown side by side.',
    'before the split has mounted, the card states what was asked for');
  eq(b({ layout: 'interlinear', effective: 'columns' }).status, 'Spanish is shown side by side.',
    'the effective layout wins over the setting');
  // The narrow window's bottom sheet covers the page the text is in, and no
  // collapse makes room for columns there.
  eq(b({ layout: 'columns', effective: 'interlinear', collapseFits: false, sheet: true }),
    { status: 'Spanish is shown under each verse.', note: '', collapse: 'Hide panel', pressed: 'interlinear' },
    'in the bottom sheet: no room note nothing can fix, and the offer is to hide the panel');
  eq(b({ layout: 'columns', effective: 'interlinear', collapseFits: false, sheet: true, nudged: true }).note, 'Not enough room for side by side.',
    '...but a click on Side by side there is answered: there is no room, and collapsing would not give it');
  eq(b({ layout: 'interlinear', effective: 'interlinear', sheet: true }).collapse, 'Hide panel',
    '...whatever the layout');
  // The pressed segment is the layout the page shows, not the setting.
  eq(b({ layout: 'columns', effective: null }).pressed, 'columns', 'before the split has mounted, the setting is pressed');
  eq(b({ layout: 'interlinear', effective: 'columns' }).pressed, 'columns', 'the effective layout is pressed, whatever the setting');
  eq(P.pressedLayout('columns', 'interlinear'), 'interlinear', 'pressedLayout: columns wanted, none fits: Under each verse');
  eq(P.pressedLayout('columns', 'columns'), 'columns', '...room: Side by side');
  eq(P.pressedLayout('columns', null), 'columns', '...not measured yet: the setting');
  eq(P.pressedLayout('panel', 'interlinear'), 'panel', 'In the panel is never overridden by a split fit');
  // What a click on a segment does. The setting is what a pick is compared
  // with, never the pressed (effective) layout.
  const click = (layout, effective, value) => P.layoutClick({ layout, effective, value });
  eq(click('columns', 'interlinear', 'columns'), 'explain',
    'Side by side while it has no room: the setting stays, the reader is told what would make room');
  eq(click('columns', 'interlinear', 'interlinear'), 'write',
    'Under each verse (pressed, but not the setting) is written: the preference changes');
  eq(click('columns', 'columns', 'columns'), 'none', 'the pressed setting again: nothing');
  eq(click('columns', null, 'columns'), 'none', '...also before the split has mounted');
  eq(click('interlinear', 'interlinear', 'columns'), 'write', 'Side by side from Under each verse: written');
  eq(click('columns', 'interlinear', 'panel'), 'write', 'In the panel: written');
  // The room note alone, for the line's Change control (it has no status text).
  eq(P.roomHint({ layout: 'columns', effective: 'interlinear', collapseFits: true }), 'Collapse the panel for side by side.',
    'roomHint: collapsing makes room');
  eq(P.roomHint({ layout: 'columns', effective: 'interlinear', collapseFits: false }), 'Not enough room for side by side.',
    '...it would not');
  eq(P.roomHint({ layout: 'columns', effective: 'columns', collapseFits: true }), '', '...no hint where columns fit');
  eq(P.roomHint({ layout: 'interlinear', effective: 'interlinear', collapseFits: true }), '', '...or where they were not asked for');
  // One vocabulary for the layouts, on the card and on the options page.
  eq(P.LAYOUTS, [['columns', 'Side by side'], ['interlinear', 'Under each verse'], ['panel', 'In the panel']],
    'the layouts are named Side by side, Under each verse, In the panel');
}

console.log('errorCopy:');
{
  const C = require(path.join(ROOT, 'src/shared/constants.js'));
  const e = (code, o) => P.errorCopy(Object.assign({ code, name: 'NIV', chapter: 'Psalm 23' }, o));
  // The copy keys on C.ERR's values; they must stay the strings the core names.
  for (const k of ['NO_KEY', 'INVALID_KEY', 'FORBIDDEN', 'NOT_FOUND', 'NETWORK', 'UNKNOWN']) eq(C.ERR[k], k, `C.ERR.${k} is '${k}'`);
  eq(e('INVALID_KEY').action, 'settings', 'a rejected key points to settings');
  eq(e('INVALID_KEY').message, 'api.bible didn’t accept your key.', '...in plain words, not a licensing problem');
  eq(e('FORBIDDEN').message, 'NIV isn’t included with your api.bible key.', 'an unlicensed version names the version');
  eq(e('FORBIDDEN', { alternatives: true }).hint, 'Add it at scripture.api.bible, or choose another translation above.',
    '...and offers the dropdown only when it has something else');
  eq(e('FORBIDDEN').hint, 'Add it at scripture.api.bible.', '...not when it has nothing else');
  eq(e('NOT_FOUND'), { message: 'NIV doesn’t include Psalm 23.', hint: '', action: null }, 'a missing api.bible chapter: no action to take');
  eq(e('NOT_FOUND', { church: true, name: 'Chinese, Simplified (Mandarin)', alternatives: true }),
    { message: 'Psalm 23 isn’t available in Chinese, Simplified (Mandarin).', hint: 'Choose another language above.', action: null },
    'a missing Church chapter names the language in English');
  eq(e('NETWORK').action, 'retry', 'a network failure can be retried');
  eq(e('NETWORK', { church: true }).message, 'Couldn’t reach churchofjesuschrist.org.', '...and names the site that failed');
  eq(e('UNKNOWN'), { message: 'Something went wrong loading NIV.', hint: '', action: 'retry' }, 'anything else: retry');
  eq(e('NO_KEY').action, 'settings', 'a key removed under enabled versions points to settings');
  eq(e('RATE_LIMITED').action, null, 'the daily api.bible allowance used up: nothing to do but wait for tomorrow');
  eq(e('RATE_LIMITED', { retryAfterMs: 5 * 3600 * 1000 }).message, 'You’ve used today’s api.bible allowance.',
    "the local daily cap (a wait until midnight) is today's allowance");
  eq(e('RATE_LIMITED', { remote: true }),
    { message: 'Your api.bible key has used its allowance for now.', hint: 'Chapters you’ve already read still open. Try again later.', action: 'retry' },
    'api.bible refusing the key (a 429 with no short Retry-After): its allowance, and a Try again');
  eq(e('RATE_LIMITED', { remote: true, retryAfterMs: 30000 }).action, 'retry',
    '...also once its short waits have run out');
  eq(e('RATE_LIMITED', { retryAfterMs: 20000 }), { message: 'api.bible is busy.', hint: 'Try again in a minute.', action: 'retry' },
    'a short local wait that kept recurring: busy, try again');
  eq(C.ERR.RATE_LIMITED, 'RATE_LIMITED', "C.ERR.RATE_LIMITED is 'RATE_LIMITED'");
}

// ---- When a rate-limited load retries by itself ----
// Every retry spends the reader's api.bible allowance, so only a short, stated
// wait is waited out, and only a few times in a row.
console.log('retryWait:');
{
  const rl = (o) => Object.assign({ code: 'RATE_LIMITED' }, o);
  eq(P.retryWait(rl({ retryAfterMs: 12000 }), 0), 12000, 'the local 30-second window: wait what it says');
  eq(P.retryWait(rl({ retryAfterMs: 200 }), 0), 1000, '...never less than a second');
  eq(P.retryWait(rl({ retryAfterMs: 1500.2 }), 0), 1501, '...in whole milliseconds');
  eq(P.retryWait(rl({ retryAfterMs: P.RETRY_MAX_WAIT_MS }), 0), P.RETRY_MAX_WAIT_MS, 'a wait of exactly the maximum is still waited out');
  eq(P.retryWait(rl({ retryAfterMs: 30000, remote: true }), 0), 30000, "api.bible's own short Retry-After is honoured");
  eq(P.retryWait(rl({ remote: true }), 0), null, 'a 429 with no Retry-After stops at the error card (it used to retry every 2 s forever)');
  eq(P.retryWait(rl({ retryAfterMs: 0 }), 0), null, '...so does a zero wait');
  eq(P.retryWait(rl({ retryAfterMs: 'soon' }), 0), null, '...or one that is not a number');
  eq(P.retryWait(rl({ retryAfterMs: P.RETRY_MAX_WAIT_MS + 1 }), 0), null, 'a longer wait (the daily cap) stops at the error card');
  eq(P.RETRY_MAX, 3, 'three automatic retries in a row at most');
  eq([0, 1, 2, 3].map((n) => P.retryWait(rl({ retryAfterMs: 5000 }), n)), [5000, 5000, 5000, null],
    '...the fourth stops at the error card');
  eq(P.retryWait({ code: 'NETWORK', retryAfterMs: 5000 }, 0), null, 'only a rate limit is waited out');
  eq(P.retryWait(null, 0), null, 'no error, no retry');
}

// ---- Telling our own scroll from the user's ----
// The panel must never fight the user for the body. Every write records where
// it left the body; a 'scroll' event that doesn't match that is the user's, and
// it detaches the panel from the page until the next re-alignment.
console.log('isForeignScroll:');
check(P.isForeignScroll(300, 300) === false, "the position we just wrote is our own scroll, not the user's");
check(P.isForeignScroll(300.4, 300) === false, 'sub-pixel rounding by the browser is still our own scroll');
check(P.isForeignScroll(340, 300) === true, 'a jump away from what we wrote is the user scrolling');
check(P.isForeignScroll(260, 300) === true, '...in either direction');
check(P.isForeignScroll(0, null) === true, 'a scroll before we have written anything is the user');
check(P.isForeignScroll(0, undefined) === true, '...however that unwritten state is spelled');

// ---- Keeping the reader's place through a text-size change ----
console.log('keptScrollTop:');
eq(P.keptScrollTop({ scrollTop: 14669, before: 366, after: 3665, maxScroll: 90000 }), 17968,
  'text above grew: the body moves down with the passage, so it stays 366px down');
eq(P.keptScrollTop({ scrollTop: 5000, before: 300, after: 120, maxScroll: 90000 }), 4820, 'text above shrank: the body moves up');
eq(P.keptScrollTop({ scrollTop: 100, before: 300, after: 50, maxScroll: 9000 }), 0, '...never past the top');
eq(P.keptScrollTop({ scrollTop: 8900, before: 100, after: 400, maxScroll: 9000 }), 9000, '...or the bottom');
eq(P.keptScrollTop({ scrollTop: 700, before: 200, after: 200, maxScroll: 9000 }), 700, 'nothing moved: the body stays');

// ---- Where the panel's top sits ----
// The site lays its header out for the width it measured; one laid out while
// the panel was away runs under the panel once it opens, until the site
// re-lays it out. The panel starts below it meanwhile.
console.log('panelTop:');
eq(P.panelTop({ reserve: 380, overflows: true, bottom: 112.6 }), 113, 'a header running under the open panel: the panel starts below it');
eq(P.panelTop({ reserve: 380, overflows: true, bottom: 40 }), 40, '...following it as the page scrolls it away');
eq(P.panelTop({ reserve: 380, overflows: true, bottom: -300 }), 0, '...up to the top once it has gone');
eq(P.panelTop({ reserve: 380, overflows: false, bottom: 113 }), 0, 'a header that fits beside the panel: the panel starts at the top');
eq(P.panelTop({ reserve: 0, overflows: true, bottom: 113 }), 0, 'no page reserve (collapsed, hidden, the bottom sheet): nothing to clear');
eq(P.panelTop(undefined), 0, 'nothing known: the top');

// ---- DOM shell contracts ----
// Rules the shell keeps that a Node run cannot execute, read from the source.
console.log('DOM shell:');
const fs = require('fs');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/content/panel.js'), 'utf8');
const bodyOf = (name) => (panelSrc.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n {2}\\}\\n`)) || [''])[0];
// A toggle's pressed state is written in the same call as its look, so a
// screen reader and the eye can never disagree about which mode is on.
check(/classList\.toggle\('btx-active', on\)[\s\S]{0,80}setAttribute\('aria-pressed'/.test(bodyOf('setPressed')),
  'setPressed writes the active look and aria-pressed together');
for (const name of ['applyModeUI', 'applyCitationViewUI']) {
  const body = bodyOf(name);
  check(body && /setPressed\(/.test(body) && !/btx-active/.test(body), `${name} sets toggle state only through setPressed`);
}
// Icons are built node by node (safe rendering: no markup strings).
check(!/\.innerHTML\s*=/.test(panelSrc), 'panel.js never assigns innerHTML');
check(/createElementNS\(SVG_NS/.test(panelSrc), 'icons are built with createElementNS');
// One way to put the panel away: Collapse (and the toolbar icon, which
// toggles the same persisted state). There is no second, unpersisted "close".
check(!/onClose|btx-close|userClosed/.test(panelSrc), 'the panel has no close control besides Collapse');
// The cards are the only Translation states that hide the stepper, and a
// card never outlives its view.
check(/function mountView\(entry\) \{[\s\S]*?setCard\(null\)/.test(panelSrc), 'mounting any view clears the card flag');
check(/keepView\(views, kind === 'content'\)/.test(panelSrc), 'only a finished chapter earns a cache slot; every card and state re-renders');
// While the panel starts below the site's header band (panelTop), the strip
// above it is filled, not left as an empty block (#89): beneath the band's
// overflowing controls, sized to the page reserve, gone once the top is 0.
const cap = bodyOf('paintTopCap');
check(/paintTopCap\(top\);/.test(bodyOf('updatePanelTop')), 'every panelTop decision repaints the cap above the panel');
check(/if \(!top\) \{[\s\S]*?topCap\.remove\(\)/.test(cap), 'top 0 leaves no cap behind');
check(/position: fixed; top: 0; right: 0; z-index: 0; pointer-events: none;/.test(cap) && /document\.body\.appendChild\(topCap\)/.test(cap),
  "the cap sits outside #btx-root, beneath the site's header, and never takes a click");
check(/topCap\.style\.width = pageReserve \+ 'px';/.test(cap) && /topCap\.style\.height = top \+ 'px';/.test(cap),
  'the cap covers the page reserve from the window top to the panel top');

// The layout control presses the layout the page shows and judges a click by
// the setting (#88): both hosts (the beside card, the line's Change) pass the
// split's fit, and the open control is restated in place, never rebuilt.
const lc = bodyOf('layoutControl');
check(/pressedLayout\(current\(\), effective\(\)\)/.test(lc) && /layoutClick\(\{ layout: current\(\), effective: effective\(\), value \}\)/.test(lc),
  'layoutControl presses by pressedLayout and judges a click by layoutClick against the setting');
check(/effective: \(\) => card\.effective/.test(bodyOf('buildBeside')) && /effective: \(\) => splitFit\.effective/.test(bodyOf('openNoteLayouts')),
  'the beside card and the line\'s Change control both give the control the split fit');
check(/function updateBeside[\s\S]*?pressNote\(\)/.test(panelSrc) && /splitFit\.effective = c\.effective/.test(bodyOf('updateBeside')),
  'a fit reported by the page split reaches the open Change control too, even with no beside card on screen');
check(!/refocusLayout = true/.test(bodyOf('pressNote')) && /pressNote\(\);\s*refocusLayout = false/.test(panelSrc),
  'restating the open Change control keeps its node (and so keyboard focus)');

// Orchestrator wiring for the talk reader and the citation list.
const contentSrc = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
const openTalkSrc = (contentSrc.match(/function openTalk\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(openTalkSrc && !/cache:\s*false/.test(openTalkSrc), 'the talk view is cached, so it re-mounts where it was left');
check(/if \(openEntry\) return openTalk\(openEntry\);/.test(contentSrc),
  'Citations coming back re-opens the talk that was open, under its stored key');
check(/onOpenTalk: \(entry\) => openTalk\(entry, \{ fresh: true \}\)/.test(contentSrc) && /#\$\{\+\+talkOpens\}/.test(contentSrc),
  'a click on a citation row is a fresh open: its key is numbered, so it builds, reveals the cite and focuses Back');
// The verse being read is read from the chapter being rendered only: right
// after an in-app navigation the site still shows the previous article.
const articleSrc = (contentSrc.match(/function chapterArticle\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/getAttribute\('data-uri'\) !== churchText\.chapterUri\(current\)/.test(articleSrc),
  'chapterArticle ignores an article that is not the chapter being rendered');
for (const fn of ['readingParagraph', 'splitAnchor']) {
  const src = (contentSrc.match(new RegExp(`function ${fn}\\(\\) \\{[\\s\\S]*?\\n {2}\\}\\n`)) || [''])[0];
  check(/const article = chapterArticle\(\);/.test(src), `${fn} reads only the chapter being rendered`);
}
// ...and read before the split comes or goes, which reflows the page.
check(/const paragraph = readingParagraph\(\);\s*syncSplit\(\{ anchor: splitAnchor\(\) \}\)/.test(contentSrc),
  'Citations reads the verse being read before the split comes or goes, which keeps the paragraph on screen in place');
check(/typeof citPanel\.revealVerse === 'function'/.test(contentSrc), 'citPanel.revealVerse is called only where it exists');
// The retry rule is the panel's pure retryWait, not a copy of it here.
check(/panel\.retryWait\(error, retries\.n\)/.test(contentSrc) && !/MAX_WAIT_MS/.test(contentSrc),
  'the orchestrator asks retryWait whether to wait, and counts the retries it made');
check(/const key = `\$\{citKey\(parsed\)\}::\$\{view\}`;/.test(contentSrc),
  'the citations key is chapter + layout only (the reading verse only marks a re-mounted list)');
check(/typeof citPanel\.refocus === 'function'/.test(contentSrc) && /typeof citPanel\.markVerse === 'function'/.test(contentSrc),
  'the citation list hooks are called only where they exist');
// The beside card claims the text is on the page, so whatever shows it asks
// for the split too: after a Try again the split's own earlier load may have
// failed.
const churchSrc = (contentSrc.match(/async function loadChurchChapter\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/if \(panel\.arrangement\(\)\.body === 'beside'\) \{[\s\S]*?syncSplit\(\);[\s\S]*?kind: 'beside'/.test(churchSrc),
  'the beside card is never shown without asking for the page split');
// The orchestrator holds no mode rule: it describes the chapter to the
// arrangement and applies the answer.
check(/panel\.showChapter\(Object\.assign\(\{ key \}, factsFor\(/.test(contentSrc) && /panel\.arrange\(factsFor\(/.test(contentSrc),
  'content.js hands the arrangement its facts when a chapter shows and when one of them moves');
check(!/translatable:|\.pick\b/.test(contentSrc), 'content.js decides neither translatability nor the pick: the arrangement does');
// A pick made before the stored picks were read is written after them, not
// over them (the setup card can add a language on a tab that never read them).
const rememberSrc = (contentSrc.match(/function remember\(id\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/loadSelection\(\)\.then\([\s\S]*?storage\.local\.set/.test(rememberSrc),
  'a remembered pick is stored only once the older picks are merged in');
// The no-translation line: the arrangement decides, content.js names it for
// the panel's note slot, and the dismissal is a setting written through
// __BTX.settings (never storage directly).
check(/dismissed: e\.noTranslationLineDismissed === true/.test(contentSrc),
  'content.js hands the arrangement the dismissal setting');
check(/SETTINGS\.patch\(\{ noTranslationLineDismissed: true \}\)/.test(contentSrc),
  'the × writes the dismissal through __BTX.settings');
check(/const out = renderModeBody\(opts\);\s*applyNote\(\);/.test(contentSrc),
  'every mode render restates the note (a render with none clears it)');
const panelSrcText = fs.readFileSync(path.join(ROOT, 'src/content/panel.js'), 'utf8');
check(!/innerHTML/.test((panelSrcText.match(/function buildNote[\s\S]*?\n {2}\}\n/) || [''])[0]),
  'the note is built from text nodes, never markup');
check(!/PANEL_HANDLED_KEYS = \[[^\]]*noTranslationLineDismissed/.test(panelSrcText),
  'the dismissal is not a panel-handled key: another computer\'s × re-renders the chapter');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

