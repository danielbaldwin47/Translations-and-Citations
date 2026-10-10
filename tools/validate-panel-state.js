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
 * cards and errors show (setupCopy / besideCopy / errorCopy), the welcome's
 * due rule and steps table (welcomeDue, WELCOME_STEPS against CONTROL_NAMES,
 * one step at a time: welcomeStepView, where its card is drawn:
 * calloutPlacement), and a few
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
// enabled Church languages, the split layout, the stored mode, and this
// visit's mode click and dropdown pick. Each row is one reader's journey:
// chapters shown (setChapter: a new one, or the same one again after a
// settings change), mode clicks (selectMode), dropdown picks (selectText) and
// layout picks, each followed by what the reader sees — the
// effective mode, the body, the text the Translation tab is about — and the
// stored mode (`saved`).
const WEB = { id: 'engwebp', provider: 'bundled', offered: true };
const NIV = { id: 'niv', provider: 'apibible', offered: true };
const church = (lang, offered) => ({ id: 'church:' + lang, provider: 'church', lang, offered });
const failed = (row) => Object.assign(row, { failed: true }); // chapterOffer's mark: the check hit a network error
const engAsked = (offered) => Object.assign(church('eng', offered), { onRequest: true }); // English, unticked, on a page read in another language
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
  // The page's language with no pick naming one (B2): what the Translation
  // tab selects, only when that is a language.
  { name: 'John 3, no picks, Spanish on: the Bible in the panel, no page language', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, church('spa', true)], ['spa']) },
      { mode: 'translation', body: 'text', text: 'engwebp', page: null, pageNext: null, note: null }],
    [{ click: 'citations' }, { mode: 'citations', page: null, pageNext: null }],
  ] },
  { name: 'Alma 5, no picks, Spanish on, side by side: Spanish holds the page', init: {}, steps: [
    [{ chapter: chapter('bofm/alma/5', [church('spa', true)], ['spa']) }, { mode: 'citations', page: 'church:spa', pageNext: null }],
  ] },
  // A check that failed (network) offers the panel's text, for its error
  // card and Try again, never the page (B1).
  { name: 'Spanish\'s check failed: the panel tries Spanish, the next offering pick holds the page', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('bofm/alma/5', [failed(church('spa', true)), church('jpn', true)], ['spa', 'jpn'], { picks: ['church:spa', 'church:jpn'] }) },
      { mode: 'translation', body: 'text', text: 'church:spa', page: 'church:jpn', note: null }],
    [{ click: 'citations' }, { mode: 'citations', page: 'church:jpn' }],
    [{ chapter: chapter('bofm/alma/6', [failed(church('spa', true))], ['spa'], { picks: ['church:spa'] }) },
      { mode: 'citations', page: null, pageNext: null }],
  ] },
  // A dropdown pick of a language the check hasn't reached (B3): the loading
  // state while it asks, then, lacking the chapter, the text before it with
  // the missing-chapter line instead of a silent fallback.
  { name: 'Pohnpeian picked on D&C 84 while its check runs: loading, then Spanish with the missing-chapter line', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/84', [church('spa', true), church('pon', null)], ['spa', 'pon'], { picks: ['church:spa'], layout: 'panel' }) },
      { body: 'text', text: 'church:spa', note: null }],
    [{ pick: 'church:pon' }, { mode: 'translation', body: 'loading', note: null }],
    [{ chapter: chapter('dc-testament/dc/84', [church('spa', true), church('pon', false)], ['spa', 'pon'], { picks: ['church:pon', 'church:spa'], layout: 'panel' }) },
      { mode: 'translation', body: 'text', text: 'church:spa', note: 'missing-chapter', noteLang: 'pon' }],
    [{ click: 'citations' }, { mode: 'citations', note: null }],
    [{ click: 'translation' }, { mode: 'translation', text: 'church:spa', note: 'missing-chapter', noteLang: 'pon' }],
    [{ pick: 'church:spa' }, { body: 'text', text: 'church:spa', note: null }],
  ] },
  { name: 'the missing-chapter line is the visit\'s: the next chapter has none', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/84', [church('spa', true), church('pon', false)], ['spa', 'pon'], { picks: ['church:spa'] }) },
      { body: 'beside', text: 'church:spa', note: null }],
    [{ pick: 'church:pon' }, { body: 'beside', text: 'church:spa', note: 'missing-chapter', noteLang: 'pon' }],
    [{ chapter: chapter('dc-testament/dc/85', [church('spa', true), church('pon', false)], ['spa', 'pon'], { picks: ['church:pon', 'church:spa'] }) },
      { body: 'beside', text: 'church:spa', note: null }],
  ] },
  { name: 'a pick that lacks the chapter and leaves nothing: the no-translation line says it', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('dc-testament/dc/84', [church('pon', null)], ['pon'], { picks: [] }) }, { body: 'loading' }],
    [{ pick: 'church:pon' }, { body: 'loading' }],
    [{ chapter: chapter('dc-testament/dc/84', [church('pon', false)], ['pon'], { picks: ['church:pon'] }) },
      { mode: 'citations', note: 'no-translation', noteLang: 'pon' }],
  ] },
  // English on a page read in Spanish is on request (#119, churchText
  // textsFor): offered in the dropdown, but neither fetched nor set into the
  // page until the reader chooses it — a pick, or opening Translation where
  // it is the text the tab shows. That arrangement `chooses` it: content.js
  // remembers it (the pick memory) and arranges again, and from then on it is
  // any language's (split by the layout, beside card, In the panel).
  { name: 'Spanish Alma 5, nothing ticked: English waits in Citations, Translation chooses it', init: {}, steps: [
    [{ chapter: chapter('bofm/alma/5', [engAsked(null)], []) },
      { mode: 'citations', body: 'citations', page: null, pageNext: null, chooses: null }],
    [{ click: 'translation' }, { mode: 'translation', body: 'loading', page: null, pageNext: null, chooses: null }],
    [{ chapter: chapter('bofm/alma/5', [engAsked(true)], []) },
      { mode: 'translation', body: 'beside', text: 'church:eng', page: 'church:eng', chooses: 'church:eng' }],
    [{ chapter: chapter('bofm/alma/5', [engAsked(true)], [], { picks: ['church:eng'] }) },
      { mode: 'translation', body: 'beside', text: 'church:eng', page: 'church:eng', chooses: null }],
    [{ click: 'citations' }, { mode: 'citations', page: 'church:eng', chooses: null }],
  ] },
  { name: 'Spanish Alma 5, In the panel: Translation chooses English and shows it in the panel', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('bofm/alma/5', [engAsked(true)], [], { layout: 'panel' }) },
      { body: 'text', text: 'church:eng', page: null, chooses: 'church:eng' }],
    [{ chapter: chapter('bofm/alma/5', [engAsked(true)], [], { layout: 'panel', picks: ['church:eng'] }) },
      { body: 'text', text: 'church:eng', page: null, chooses: null }],
    [{ layout: 'columns' }, { body: 'beside', text: 'church:eng', page: 'church:eng', layout: 'columns' }],
  ] },
  { name: 'Spanish John 3, nothing ticked: the Bible shows, English waits in the dropdown', init: { mode: 'translation' }, steps: [
    [{ chapter: chapter('nt/john/3', [WEB, engAsked(null)], []) },
      { body: 'text', text: 'engwebp', page: null, pageNext: null, chooses: null }],
    [{ pick: 'church:eng' }, { body: 'loading', chooses: null }],
    [{ chapter: chapter('nt/john/3', [WEB, engAsked(true)], [], { picks: ['church:eng'] }) },
      { body: 'beside', text: 'church:eng', page: 'church:eng', chooses: null }],
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
    if (act.pick) {
      // A dropdown pick, as content.js applies it: remembered, then the
      // same chapter arranged again.
      P.selectText(s, act.pick);
      P.setChapter(s, Object.assign({ key: s.chapter }, s.facts, { picks: CT.rememberPick(s.facts.picks, act.pick) }));
    }
    if (act.layout) {
      // What content.js does with a layout pick: write the setting, remember
      // the row it names, and arrange the same chapter again.
      const pick = P.layoutChoice(P.arrangementOf(s), act.layout);
      const picks = pick ? CT.rememberPick(s.facts.picks, pick) : s.facts.picks;
      P.setChapter(s, Object.assign({ key: s.chapter }, s.facts, { layout: act.layout, picks }));
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

// ---- The welcome (GLOSSARY: Welcome) ----
// When it's due: on any panel shown while the synced flag says not seen, so a
// reader who closes the tab without Got it meets it again on the next chapter.
// Collapsing hides it without counting as seen; expanding brings it back.
console.log('welcomeDue:');
const ALMA_5 = { key: 'bofm/alma/5', texts: [], picks: [], languages: [] };
{
  const w = fresh(); // a fresh profile: welcomeSeen never written
  eq(P.welcomeDue(w), false, 'not due before a panel shows');
  P.setChapter(w, ALMA_5);
  eq(P.welcomeDue(w), true, 'a fresh profile: due on the first panel shown');
  P.setChapter(w, { key: 'bofm/alma/6', texts: [], picks: [], languages: [] });
  eq(P.welcomeDue(w), true, 'still due on the next chapter until Got it');
  w.collapsed = true;
  eq(P.welcomeDue(w), false, 'a collapsed panel shows no welcome');
  w.collapsed = false;
  eq(P.welcomeDue(w), true, '...and collapsing did not count as seen: expanding brings it back');
  eq(P.setWelcomeSeen(w, true), true, 'Got it changes the flag (the caller writes it)');
  eq(P.welcomeDue(w), false, 'not due after Got it');
  P.setChapter(w, ALMA_5);
  eq(P.welcomeDue(w), false, '...nor on a later chapter or reload');
  eq(P.setWelcomeSeen(w, true), false, 'a second Got it changes nothing');
  eq(P.setWelcomeSeen(w, false), true, '"Show the welcome again" writes the flag false');
  eq(P.welcomeDue(w), true, 'due again once the flag is written false');
}
eq(P.welcomeDue(fresh({ welcomeSeen: true })), false, 'a profile that pressed Got it (the synced flag) starts not due');
{
  const w = fresh({ welcomeSeen: true });
  P.setChapter(w, ALMA_5);
  eq(P.welcomeDue(w), false, '...on any chapter: a second computer does not repeat it');
}
for (const bad of ['true', 1, null, {}]) {
  const w = fresh({ welcomeSeen: bad });
  P.setChapter(w, ALMA_5);
  eq(P.welcomeDue(w), true, `a stored ${JSON.stringify(bad)} is not seen`);
}

// Where focus goes when the welcome appears, and across a collapse or an
// expand. A welcome opening in a tab the reader isn't looking at (each open
// tab when "Show the welcome again" writes the flag, a tab loading behind
// another) leaves focus where it is; only the tab in front takes it.
console.log('welcome focus:');
eq(P.welcomeTakesFocus({ hidden: false, focused: true }), true, 'the tab in front, its window focused: focus moves into the welcome');
eq(P.welcomeTakesFocus({ hidden: true, focused: false }), false, 'a background tab: focus stays where it is');
eq(P.welcomeTakesFocus({ hidden: false, focused: false }), false, '...and a visible tab in a window without focus (settings in front)');
eq(P.welcomeTakesFocus({}), false, '...nor when nothing is known');
{
  const w = fresh();
  P.setChapter(w, ALMA_5);
  w.collapsed = true;
  eq(P.focusOnToggle(w), 'tab', 'collapsing: focus lands on the tab');
  w.collapsed = false;
  eq(P.focusOnToggle(w), null, 'expanding with the welcome due: nothing here, the welcome takes focus when it opens');
  P.setWelcomeSeen(w, true);
  eq(P.focusOnToggle(w), 'collapse', 'expanding after Got it: focus lands on Collapse');
  // #102 C2: focus moves only for a keyboard activation. A mouse reopen left a
  // focus ring on Collapse, a control the reader never asked for.
  eq(P.focusOnToggle(w, true), 'collapse', 'expanding from the keyboard: focus lands on Collapse');
  eq(P.focusOnToggle(w, false), null, 'expanding with the mouse: focus stays where it is, no ring left on Collapse');
  w.collapsed = true;
  eq(P.focusOnToggle(w, true), 'tab', 'collapsing from the keyboard: focus lands on the tab');
  eq(P.focusOnToggle(w, false), null, 'collapsing with the mouse: no ring on the tab either');
  eq([P.byKeyboard({ detail: 0 }), P.byKeyboard({ detail: 1 }), P.byKeyboard({ detail: 2 }), P.byKeyboard(null)], [true, false, false, true],
    "a click with no click count is Enter or Space on the focused button; unknown counts as the keyboard, the safe side for a screen-reader user");
}

// The steps table: what the welcome says, one step at a time, each against
// the panel control it points at. Names come from the panel's own list of
// the controls it builds; the toolbar icon is no panel control, so the last
// step names it in words with the extension's icon drawn inline.
console.log('welcome steps:');
check(Array.isArray(P.CONTROL_NAMES) && P.CONTROL_NAMES.length > 0, 'the panel exports the names of the controls it builds');
eq(new Set(P.CONTROL_NAMES).size, P.CONTROL_NAMES.length, 'control names are unique');
for (const s of P.WELCOME_STEPS) {
  check(P.CONTROL_NAMES.includes(s.control), `step "${s.id}" points at a control the panel builds (${s.control})`);
}
eq(P.WELCOME_STEPS.map((s) => [s.id, s.control]), [
  ['citations', 'citations-tab'],
  ['translation', 'translation-tab'],
  ['settings', 'settings'],
  ['hide', 'collapse'],
], 'four steps, in tour order (what the panel opens on first, the way back last), against their controls');
// Every step's control shows in every mode and on every card, so no step
// ever points at nothing (A− / A+ and the toolbar's selects hide on a card).
check(P.WELCOME_STEPS.every((s) => ['translation-tab', 'citations-tab', 'settings', 'collapse'].includes(s.control)), 'every step points at a header control, which always shows');
eq(new Set(P.WELCOME_STEPS.map((s) => s.id)).size, P.WELCOME_STEPS.length, 'step ids are unique');
const sentences = (t) => t.split(/(?<=[.?])\s+/).filter(Boolean);
for (const s of P.WELCOME_STEPS) {
  check(typeof s.title === 'string' && s.title.length > 0 && s.title.length <= 40, `step "${s.id}" has a short title`);
  check(s.lines.length >= 1 && s.lines.length <= 3, `step "${s.id}" says three things at most`);
  // Plain words for readers of English as a second language: none of the
  // idioms first-run testers stumbled on.
  for (const l of s.lines) check(!/tuck|right beside|preferences|page itself/i.test(l.text), `step "${s.id}": no idioms ("${l.text.slice(0, 30)}…")`);
  for (const l of s.lines) {
    check(/[.?]$/.test(l.text) && sentences(l.text).length <= 2, `step "${s.id}": "${l.text.slice(0, 30)}…" is whole sentences, two at most`);
    check(sentences(l.text).every((x) => x.length <= 100), `step "${s.id}": every sentence is short (100 characters at most)`);
  }
}
const stepById = (id) => P.WELCOME_STEPS.find((s) => s.id === id) || { title: '', lines: [] };
const said = (id) => stepById(id).lines.map((l) => l.text).join(' ');
// The first step greets; the others are titled with what their control
// does, the tabs with the tabs' own names, so the ring and the card name the
// same thing.
eq(stepById('citations').title, P.WELCOME_COPY.title, 'the first step greets with the welcome\'s title');
check(/^Citations\b/.test(said('citations')), '...and its text names the tab it points at, first');
eq(stepById('translation').title, 'Translation', 'the Translation step is titled with the tab\'s name');
check(/Collapse/.test(said('hide')), 'the last step names the Collapse button: the ring is not read out');
// Spec A's model: Citations is where the panel opens (its step comes first),
// and a language you add reads on the page whatever the panel shows.
check(/talks/.test(said('citations')) && /each verse/.test(said('citations')), 'Citations: the talks that quote each verse');
check(/language/.test(said('translation')) && /Bible/.test(said('translation')), 'Translation: another language or Bible version');
check(/on the page/.test(said('translation')) && /verse by verse/.test(said('translation')), 'a language you add reads on the page, verse by verse (beside or under each, as the room allows)');
check(/the Bible in another version/.test(said('translation')), 'a Bible version only on the Bible');
check(/tab/.test(said('hide')) && /bring it back/.test(said('hide')), 'the last step: the tab at the window\'s edge brings the panel back');
check(/Translations & Citations icon \{icon\}/.test(said('hide')) && /top right of Chrome/.test(said('hide')), '...and so does the toolbar icon, named in words beside its picture, where to look');
check(stepById('hide').lines.slice(1).every((l) => l.tip === true) && !stepById('hide').lines[0].tip, '...as a smaller tip under the edge tab, the way back every reader has');
// A line draws the extension's icon inline, where its text marks it.
eq(P.lineParts({ text: 'The {icon} button hides it.' }), ['The ', { icon: true }, ' button hides it.'], 'lineParts: the marker becomes the icon, in place');
eq(P.lineParts({ text: 'Plain text.' }), ['Plain text.'], 'lineParts: a line with no marker is one text part');
check(stepById('hide').lines.some((l) => P.lineParts(l).some((x) => typeof x !== 'string')), 'the last step draws the toolbar icon');
check(P.WELCOME_STEPS.filter((s) => s.id !== 'hide').every((s) => s.lines.every((l) => !/\{icon\}/.test(l.text))), 'only the last step draws the icon');
check(typeof P.WELCOME_COPY.title === 'string' && P.WELCOME_COPY.title && P.WELCOME_COPY.gotIt === 'Got it', 'the welcome has a title and closes on Got it');
// Which lines show, from what the panel knows (`when`: facts the line needs;
// the pinning line needs { pinned: false }). A fact nobody has answered
// hides a `when` line, but the pinning line must show on an unknown answer:
// welcomeFactsFrom turns the worker's reply into the facts, an unknown one
// into "not pinned" (a pin suggested twice costs less than a needed one hidden).
const pinLine = stepById('hide').lines.find((l) => l.when);
check(pinLine && JSON.stringify(pinLine.when) === '{"pinned":false}', 'the pinning line needs { pinned: false }');
check(pinLine && /puzzle-piece icon/.test(pinLine.text) && /the pin next to Translations & Citations/.test(pinLine.text), 'the pinning line says how to pin to the toolbar, click by click');
const hideLines = (reply) => P.welcomeSteps(P.welcomeFactsFrom(reply)).find((s) => s.id === 'hide').lines.length;
eq(P.welcomeSteps(P.welcomeFactsFrom({ isOnToolbar: true })).map((s) => s.id), P.WELCOME_STEPS.map((s) => s.id), 'every step shows whatever the facts');
eq(hideLines({ isOnToolbar: false }), 3, 'icon not on the toolbar: the last step carries the pinning line');
eq(hideLines({ isOnToolbar: true }), 2, 'icon pinned: no pinning line');
for (const [what, reply] of [['null (API missing)', { isOnToolbar: null }], ['an empty reply', {}], ['no reply', undefined], ['an error reply', { error: { code: 'NETWORK' } }], ['a non-boolean', { isOnToolbar: 'yes' }]]) {
  eq(hideLines(reply), 3, `unknown answer, ${what}: the pinning line shows`);
}
{
  const table = [{ id: 'a', control: 'settings', title: 'A', lines: [{ text: 'A.' }, { text: 'Pin it.', when: { pinned: false } }] }];
  eq(P.welcomeSteps({ pinned: false }, table)[0].lines.length, 2, 'a line with `when` shows when every fact it names matches');
  eq(P.welcomeSteps({ pinned: true }, table)[0].lines.length, 1, '...not when one differs');
  eq(P.welcomeSteps({}, table)[0].lines.length, 1, '...nor when the fact is unknown (say nothing unsure)');
  eq(table[0].lines.length, 2, 'the table itself is left as it was');
}

// One step at a time: what the card shows at each step, and its buttons.
console.log('welcomeStepView:');
{
  const steps = P.welcomeSteps({ pinned: false });
  const v = (i) => P.welcomeStepView(steps, i);
  eq([v(0).step.id, v(0).position, v(0).back, v(0).skip, v(0).next, v(0).last],
    ['citations', '1 of 4', false, true, 'Next', false], 'step 1: no Back; Skip and Next');
  eq([v(2).step.id, v(2).position, v(2).back, v(2).skip, v(2).next],
    ['settings', '3 of 4', true, true, 'Next'], 'a middle step: Back, Skip and Next');
  eq([v(3).step.id, v(3).position, v(3).back, v(3).skip, v(3).next, v(3).last],
    ['hide', '4 of 4', true, false, 'Got it', true], 'the last step: Back and Got it, no Skip');
  eq([v(-1).index, v(9).index, v(undefined).index, v(1.5).index], [0, 3, 0, 0], 'an index out of range is held to the tour\'s ends');
}

// Where the step's card is drawn (#113): under the control it names, its
// caret aimed at the control's centre, and a ring round the control itself.
// All in the welcome layer's coordinates (the panel's box); `area` is the
// card's content box, so the card's left comes back relative to it. The
// shipped geometry: cards at most 300px wide, the caret at least 14px in
// from a card's edge, the ring 4px out from the control and never past the
// panel's edge.
console.log('calloutPlacement:');
{
  const at = (control, area, panel) => P.calloutPlacement({ control, area, panel });
  // 280px, the panel's narrowest: the area is 236px wide from x=22, so the
  // card is the area's width and only the caret moves.
  const NARROW = { width: 280, height: 700 };
  const NARROW_AREA = { left: 22, width: 236 };
  eq(at({ left: 10, top: 7, width: 80, height: 30 }, NARROW_AREA, NARROW),
    { card: { left: 0, width: 236 }, caret: 28, ring: { left: 6, top: 3, width: 88, height: 38 } },
    '280px, the Translation tab: a full-width card, the caret under the tab\'s centre, the tab ringed');
  eq(at({ left: 214, top: 7, width: 30, height: 30 }, NARROW_AREA, NARROW),
    { card: { left: 0, width: 236 }, caret: 207, ring: { left: 210, top: 3, width: 38, height: 38 } },
    '280px, Settings: the caret moves right under the gear');
  eq(at({ left: 222, top: 51, width: 56, height: 28 }, NARROW_AREA, NARROW),
    { card: { left: 0, width: 236 }, caret: 222, ring: { left: 218, top: 47, width: 62, height: 36 } },
    '280px, A− / A+ at the edge: the caret stops 14px in from the card\'s corner, the ring at the panel\'s edge');
  for (const none of [null, { left: 0, top: 0, width: 0, height: 0 }]) {
    eq(at(none, NARROW_AREA, NARROW), { card: { left: 0, width: 236 }, caret: null, ring: null },
      `280px, ${none ? 'a control not showing (no box)' : 'no control'}: a plain full-width card, no caret, no ring`);
  }
  // 900px, the widest: the card is 300px, placed under its control, kept
  // inside the area.
  const WIDE = { width: 900, height: 700 };
  const WIDE_AREA = { left: 22, width: 856 };
  eq(at({ left: 10, top: 7, width: 200, height: 30 }, WIDE_AREA, WIDE),
    { card: { left: 0, width: 300 }, caret: 88, ring: { left: 6, top: 3, width: 208, height: 38 } },
    '900px, the Translation tab: a 300px card held at the area\'s left edge, the caret under the tab');
  eq(at({ left: 210, top: 7, width: 200, height: 30 }, WIDE_AREA, WIDE).card, { left: 138, width: 300 },
    '900px, the Citations tab: the card centred under the tab');
  eq(at({ left: 210, top: 7, width: 200, height: 30 }, WIDE_AREA, WIDE).caret, 150, '...the caret at its middle');
  eq(at({ left: 834, top: 7, width: 30, height: 30 }, WIDE_AREA, WIDE),
    { card: { left: 556, width: 300 }, caret: 271, ring: { left: 830, top: 3, width: 38, height: 38 } },
    '900px, Settings: the card held at the area\'s right edge, the caret under the gear');
  eq(at(null, WIDE_AREA, WIDE), { card: { left: 0, width: 856 }, caret: null, ring: null },
    '900px, no control: a plain card across the area');
  // A tab from x=10.4 to 90.7: centre 50.55, so the caret at 28.55 from the
  // area's edge; the ring from 6.4 to 94.7.
  eq(at({ left: 10.4, top: 7.2, width: 80.3, height: 29.6 }, NARROW_AREA, NARROW),
    { card: { left: 0, width: 236 }, caret: 29, ring: { left: 6, top: 3, width: 89, height: 38 } },
    'measured fractions come back as whole pixels');
  // A short panel (the browser window squeezed): the A− / A+ stepper's
  // bottom sits 1px above the panel's bottom, so its ring stops at the edge.
  eq(at({ left: 222, top: 51, width: 56, height: 28 }, NARROW_AREA, { width: 280, height: 80 }).ring,
    { left: 218, top: 47, width: 62, height: 33 },
    'a control near the panel\'s bottom: the ring stops at the bottom edge too');
}
eq(P.unionRect([{ left: 212, top: 51, width: 28, height: 28 }, { left: 244, top: 51, width: 28, height: 28 }]),
  { left: 212, top: 51, width: 60, height: 28 }, 'unionRect: A− and A+ are one box');
eq(P.unionRect([{ left: 212, top: 51, width: 0, height: 0 }, { left: 244, top: 51, width: 28, height: 28 }]),
  { left: 244, top: 51, width: 28, height: 28 }, '...a button not showing adds nothing');
eq(P.unionRect([]), null, '...no nodes, no box');

// ---- What the Translation cards and errors say ----
// Copy rules the DOM shell renders verbatim: which heading, which action.
console.log('noteCopy:');
{
  // `row` is the language's dropdown row: { abbr: native name, name: English name }.
  const GIL = { abbr: 'Kiribati', name: 'Kiribati' };
  const SPA = { abbr: 'Español', name: 'Spanish' };
  const n = P.noteCopy({ kind: 'no-translation', row: GIL, chapter: 'Doctrine and Covenants 76' });
  eq(n.text, 'No Kiribati translation for Doctrine and Covenants 76.', 'the no-translation line names the language and the chapter');
  eq(n.view, 'citations', '...and sits above the citation list');
  eq(n.actions.map((a) => [a.id, a.label]), [['add', 'Add a language'], ['dismiss', '×']], '...with Add a language, then ×');
  check(typeof n.actions[1].title === 'string' && n.actions[1].title.length > 0, '...the × is named for assistive tech');
  eq(P.noteCopy({ kind: 'no-translation', row: SPA, chapter: 'Alma 5' }).text, 'No Spanish translation for Alma 5.',
    '...naming the language in English');
  const b = P.noteCopy({ kind: 'beside-page', row: SPA });
  eq([b.text, b.view], ['Español is beside the page text ·', 'translation'],
    'the beside-the-page line names the language on the page, above the Bible version in the panel');
  eq(b.actions.map((a) => [a.id, a.label]), [['change', 'Change']], '...with Change (the layout control, in its place) and no ×');
  eq(P.noteCopy({ kind: 'beside-page' }).text, 'A language is beside the page text ·', '...a missing name falls back to a plain sentence');
  eq(P.noteCopy(null), null, 'no note, no copy');
  eq(P.noteCopy({ kind: 'bogus' }), null, 'an unknown note kind has no copy');
  eq(P.noteCopy({ kind: 'no-translation' }).text, 'No translation for this chapter.', 'missing names fall back to a plain sentence');
  eq(P.noteCopy({ kind: 'beside-page', row: { abbr: '', name: 'English' } }).text, 'English is beside the page text ·',
    '...a language with no native name apart reads by its one name');
  const m = P.noteCopy({ kind: 'missing-chapter', row: { abbr: 'Pohnpei', name: 'Pohnpeian' }, chapter: 'Doctrine and Covenants 84' });
  eq([m.text, m.view, m.actions], ['No Pohnpeian translation for Doctrine and Covenants 84.', 'translation', []],
    'the missing-chapter line: the dropdown pick lacks the chapter, said once above the Translation tab, no buttons');
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
  // The fix the settings page names (#124), not the retired "check that you
  // copied all of it", with the dashboard one click away.
  const DASH = { text: 'Open your api.bible dashboard', href: 'https://api.bible/team' };
  eq(e('INVALID_KEY'), {
    message: 'api.bible didn’t accept your key.',
    hint: 'Copy it again from your api.bible dashboard and paste it in settings, or create a free account first.',
    action: 'settings',
    link: DASH,
  }, '...names both fixes, links the dashboard, and keeps Open settings');
  check(!/copied all of it/.test(JSON.stringify(e('INVALID_KEY'))), '...never the retired miscopy advice');
  eq(e('FORBIDDEN').message, 'NIV isn’t on your api.bible key yet.', 'an unlicensed version names the version, and says it can be added');
  eq(e('FORBIDDEN', { alternatives: true }).hint,
    'Add it in your api.bible dashboard: Plan, then Edit Plan, then Edit Bible Licenses. Or choose another translation from the menu at the top of the panel.',
    '...says where to add it, by the dashboard\'s own menus, and offers the menu by name only when it has something else');
  eq(e('FORBIDDEN').hint, 'Add it in your api.bible dashboard: Plan, then Edit Plan, then Edit Bible Licenses.', '...not when it has nothing else');
  check(e('FORBIDDEN').hint.indexOf(C.API_BIBLE_ADD_BIBLES) >= 0, '...the path is C.API_BIBLE_ADD_BIBLES, written once');
  eq([e('FORBIDDEN').action, e('FORBIDDEN').link], ['settings', DASH], '...with the dashboard link beside Open settings');
  eq(e('NOT_FOUND'), { message: 'NIV doesn’t include Psalm 23.', hint: '', action: null }, 'a missing api.bible chapter: no action to take');
  eq(e('NOT_FOUND', { church: true, name: 'Chinese, Simplified (Mandarin)', alternatives: true }),
    { message: 'Psalm 23 isn’t available in Chinese, Simplified (Mandarin).', hint: 'Choose another language from the menu at the top of the panel.', action: null },
    'a missing Church chapter names the language in English, and the menu by where it is');
  check(!Object.values(C.ERR).some((code) => / above\./.test(JSON.stringify(e(code, { alternatives: true, rate: { state: 'paused', until: '2026-11-01' }, others: { bundled: true, church: 1 } })))),
    'no card points "above": the menu is named');
  eq(e('NETWORK').action, 'retry', 'a network failure can be retried');
  eq(e('NETWORK', { church: true }).message, 'Couldn’t reach churchofjesuschrist.org.', '...and names the site that failed');
  eq(e('UNKNOWN'), { message: 'Something went wrong loading NIV.', hint: '', action: 'retry' }, 'anything else: retry');
  eq(e('NO_KEY').action, 'settings', 'a key removed under enabled versions points to settings');
  // The local limiter is the 30-second burst window only (no daily cap, #125):
  // a local refusal that reaches the card is a short wait that kept recurring.
  eq(e('RATE_LIMITED'), { message: 'api.bible is busy.', hint: 'Try again in a minute.', action: 'retry' },
    'a local rate limit with no wait left: busy, try again');
  check(!/today/i.test(JSON.stringify(e('RATE_LIMITED', { retryAfterMs: 5 * 3600 * 1000 }))), '...never "today’s allowance": there is no daily cap');
  eq(e('RATE_LIMITED', { remote: true }),
    { message: 'Your api.bible key has used its allowance for now.',
      hint: 'Chapters you read recently still open. Try again later. If you use this key on another computer too, api.bible’s monthly limit may be used up.',
      action: 'retry' },
    'api.bible refusing the key (a 429 with no short Retry-After): its allowance, what else it may be (the count is this computer\'s alone), and a Try again');
  eq(e('RATE_LIMITED', { remote: true, retryAfterMs: 30000 }).action, 'retry',
    '...also once its short waits have run out');
  eq(e('RATE_LIMITED', { retryAfterMs: 20000 }), { message: 'api.bible is busy.', hint: 'Try again in a minute.', action: 'retry' },
    'a short local wait that kept recurring: busy, try again');
  eq(C.ERR.RATE_LIMITED, 'RATE_LIMITED', "C.ERR.RATE_LIMITED is 'RATE_LIMITED'");

  // api.bible's month is used up (#125): the worker's attached state is
  // `paused`. The paused line takes the api.bible text's place; the other
  // texts stay in the dropdown above.
  const paused = { state: 'paused', month: '2026-10', until: '2026-11-01' };
  eq(P.pausedLine('2026-11-01'), 'api.bible’s free monthly limit is reached. Back on November 1.', 'the paused line, exactly');
  eq(P.pausedLine('2027-01-01'), 'api.bible’s free monthly limit is reached. Back on January 1.', '...dated Month D, the month in words');
  eq(P.pausedLine('2026-12-01'), 'api.bible’s free monthly limit is reached. Back on December 1.', '...December');
  eq(P.pausedLine(''), 'api.bible’s free monthly limit is reached.', 'no date known: the line without one');
  eq(P.pausedLine('soon'), 'api.bible’s free monthly limit is reached.', '...nor an unreadable one');
  // The hint names only what the dropdown offers that doesn't need api.bible
  // (`others`: the World English Bible, how many Church languages): every
  // api.bible translation is paused with the month, and the cache holds too
  // little to promise "chapters you've read".
  // The hint says what comes back on that day (the version, and the reader's
  // other api.bible translations when there are more: `others.apiBible`
  // counts the dropdown's api.bible rows, this one included), then what works
  // now and where to choose it.
  const pausedWith = (others) => e('RATE_LIMITED', { remote: true, rate: paused, alternatives: true, others });
  const MENU = 'from the menu at the top of the panel.';
  eq(pausedWith({ bundled: true, church: 2, apiBible: 3 }),
    { message: 'api.bible’s free monthly limit is reached. Back on November 1.',
      hint: `NIV and your other api.bible translations come back on that day. The World English Bible and your Church languages still work. Choose one ${MENU}`,
      action: null },
    'api.bible refusing in a paused month: the paused line, what comes back, what still works and where, no Try again');
  eq(pausedWith({ bundled: true, church: 1, apiBible: 1 }).hint,
    `NIV comes back on that day. The World English Bible and your Church language still work. Choose one ${MENU}`, '...one api.bible translation, one Church language');
  eq(pausedWith({ bundled: true, church: 0, apiBible: 2 }).hint,
    `NIV and your other api.bible translations come back on that day. The World English Bible still works. Choose it ${MENU}`, '...the World English Bible alone');
  eq(pausedWith({ bundled: false, church: 1 }).hint, `NIV comes back on that day. Your Church language still works. Choose it ${MENU}`, '...a Church language alone');
  eq(pausedWith({ bundled: false, church: 3 }).hint, `NIV comes back on that day. Your Church languages still work. Choose one ${MENU}`, '...Church languages alone');
  eq(pausedWith({ bundled: false, church: 0 }).hint, 'NIV comes back on that day.', '...nothing else offered: only what comes back');
  eq(e('RATE_LIMITED', { remote: true, rate: paused }).hint, 'NIV comes back on that day.', '...nor with no `others` known');
  eq(e('RATE_LIMITED', { remote: true, rate: paused, name: '' }).hint, 'This translation comes back on that day.', '...a version with no name still reads as a sentence');
  check(![{ bundled: true, church: 2 }, { bundled: false, church: 0 }].some((o) => /already read|still open/i.test(pausedWith(o).hint)),
    '...never promises chapters already read');
  check(!/\d{3}|NIV/.test(e('RATE_LIMITED', { remote: true, rate: paused }).message), '...the paused line: no version name, no call counts');
  check(!/\d{3}/.test(pausedWith({ bundled: true, church: 2, apiBible: 3 }).hint), '...nor call counts in the hint');
  eq(e('RATE_LIMITED', { remote: true, rate: { state: 'near', month: '2026-10' } }).message, 'Your api.bible key has used its allowance for now.',
    'a 429 that is not a pause stays the burst copy');

  // The near line (#126): once a calendar month, on an api.bible chapter whose
  // attached state is `near`. nearLine(rate, seenMonth) -> the text to show, or
  // '' for none; `seenMonth` is the 'YYYY-MM' the line was last shown (stored
  // on this computer), '' / undefined when never.
  const near = { state: 'near', month: '2026-10' };
  eq(P.nearLine(near, ''), 'You’re at about 80% of api.bible’s free monthly limit.', 'the near line, exactly (curly apostrophes)');
  eq(P.nearLine(near, undefined), 'You’re at about 80% of api.bible’s free monthly limit.', '...shown when nothing is stored');
  eq(P.nearLine(near, '2026-10'), '', 'not shown again the same month');
  eq(P.nearLine(near, '2026-09'), 'You’re at about 80% of api.bible’s free monthly limit.', 'shown again the next month');
  eq(P.nearLine({ state: 'near', month: '2027-01' }, '2026-12'), 'You’re at about 80% of api.bible’s free monthly limit.', '...across the new year');
  eq(P.nearLine({ state: 'ok', month: '2026-10' }, ''), '', 'ok: no line');
  eq(P.nearLine({ state: 'paused', month: '2026-10', until: '2026-11-01' }, ''), '', 'paused: the paused line speaks, not this one');
  eq(P.nearLine(undefined, ''), '', 'no state (the bundled Bible, a Church language): no line');
  eq(P.nearLine({ state: 'near' }, ''), '', 'near with no month to remember: no line');
  eq(P.nearLine({ state: 'near', month: 'soon' }, ''), '', '...nor an unreadable month');
  check(!/\d{3}|NIV|call/i.test(P.nearLine(near, '')), '...no version name, no call counts');
  // One copy for the panel and the options page (src/shared/rate-copy.js).
  const RC = require(path.join(ROOT, 'src/shared/rate-copy.js'));
  check(P.pausedLine === RC.pausedLine && P.nearLine === RC.nearLine, 'the panel\'s lines are the shared rate copy\'s, not a second copy');
  {
    const fs = require('fs');
    const panelSrc = fs.readFileSync(path.join(ROOT, 'src/content/panel.js'), 'utf8');
    const show = (panelSrc.match(/function showNearLine\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
    const mounted = show.indexOf('article.parentNode !== host');
    check(mounted > 0 && show.indexOf('nearSeen = ') > mounted && show.indexOf('storage.local.set') > mounted,
      'showNearLine marks the month seen only once the line is mounted (after the view check)');
    check(/\n\s*showNearLine\(host, article, st\.rate\);/.test(panelSrc) && !/st\.rate\.state === 'near'/.test(panelSrc),
      'renderContent hands the state to showNearLine, whose nearLine decides (no second guard)');
    const contentSrc = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
    check(/others: \{/.test(contentSrc), 'content.js tells the error card what else the dropdown offers (`others`)');
    check(/apiBible: texts\.filter\(\(t\) => t\.provider === C\.PROVIDER_APIBIBLE\)\.length/.test(contentSrc),
      '...and how many api.bible translations it has (what comes back on the paused line\'s day)');
    const renderErr = (panelSrc.match(/function renderError\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
    check(/if \(copy\.link\)/.test(renderErr) && /el\('a', 'btx-link btx-card-link', copy\.link\.text\)/.test(renderErr)
      && /\.href = copy\.link\.href/.test(renderErr) && /target = '_blank'/.test(renderErr) && /rel = 'noopener'/.test(renderErr) && !/innerHTML/.test(renderErr),
      'the error card renders its link as a text-only anchor to a new tab (safe DOM)');
    check(/labelled\(x, 'Dismiss this notice'\)/.test(show), 'the near line\'s × is named "Dismiss this notice"');
    const css = fs.readFileSync(path.join(ROOT, 'src/content/panel.css'), 'utf8');
    const xRule = (css.match(/#btx-root \.btx-note-x \{[^}]*\}/) || [''])[0];
    check(/min-width: 24px/.test(xRule) && /min-height: 24px/.test(xRule), 'every note\'s × is at least a 24px target');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts[0].js;
    check(js.indexOf('src/shared/rate-copy.js') >= 0 && js.indexOf('src/shared/rate-copy.js') < js.indexOf('src/content/panel.js'),
      'the manifest loads the shared rate copy before panel.js');
  }
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
  eq(P.retryWait(rl({ remote: true, retryAfterMs: 5000, rate: { state: 'paused', month: '2026-10', until: '2026-11-01' } }), 0), null,
    'a paused month is never retried by itself, whatever api.bible says to wait');
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

// ---- How a width drag ends ----
// The panel follows the pointer during a drag; only a release saves. A
// cancelled drag (pointercancel: a touch taken over by the browser, a lost
// capture) puts the panel back at the width it had when the drag began.
console.log('resizeEnd:');
eq(P.resizeEnd({ from: 380, at: 520, commit: true }), { width: 520, save: true }, 'a release keeps and saves the dragged width');
eq(P.resizeEnd({ from: 380, at: 520, commit: false }), { width: 380, save: false }, 'a cancel goes back to the width at pointer-down, saving nothing');

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
// The collapsed tab is the extension's own packaged icon (#141), not a
// drawn arrow: an <img> the tab holds, loaded through chrome.runtime.getURL,
// with the same words as its title and its accessible name. Its surface is
// the panel's (not the accent) so the icon's own teal tile reads in both
// themes: the accent is nearly the tile's colour in the light theme.
check(/const tab = labelled\(el\('button', 'btx-tab'\), 'Show Translations & Citations'\)/.test(panelSrc), 'the collapsed tab carries its words as title and aria-label together (labelled)');
check(/tab\.appendChild\(extensionIcon\('btx-tab-icon', 20\)\)/.test(panelSrc), 'the collapsed tab shows the extension\'s packaged icon, drawn at 20px, inside a tab as narrow as the site\'s Feedback tab');
eq([16, 20].map(P.iconFile), ['icons/icon-32.png', 'icons/icon-40.png'], 'an extension icon drawn at N px loads the 2N px file, sharp at 2x density');
check(!/icon\('expand'/.test(panelSrc), 'the tab no longer draws the expand arrow');
const tabRule = (fs.readFileSync(path.join(ROOT, 'src/content/panel.css'), 'utf8').match(/#btx-root \.btx-tab \{[^}]*\}/) || [''])[0];
check(/background:\s*var\(--btx-bg\)/.test(tabRule) && !/background:\s*var\(--btx-accent\)/.test(tabRule), 'the tab sits on the panel surface, so the icon\'s tile shows in the light and the dark theme');
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
check(/if \(arranged\.body === 'beside'\) \{[\s\S]*?syncSplit\(\);[\s\S]*?kind: 'beside'/.test(churchSrc),
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

// The welcome's DOM shell: the controls it may point at are the ones the
// panel builds, it is a labelled dialog of text nodes, Esc stops at it, and
// Got it is a settings write the panel handles itself.
const controlsLit = (panelSrcText.match(/const controls = \{([\s\S]*?)\};/) || ['', ''])[1];
eq((controlsLit.match(/'[a-z-]+'(?=:)|\b[a-z]+(?=:)/g) || []).map((k) => k.replace(/'/g, '')).sort(), P.CONTROL_NAMES.slice().sort(),
  'the shell maps exactly the exported control names to the nodes it built');
const welcomeSrc = (panelSrcText.match(/function buildWelcome\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/setAttribute\('role', 'dialog'\)/.test(welcomeSrc) && /setAttribute\('aria-labelledby', 'btx-welcome-title'\)/.test(welcomeSrc),
  'the welcome is a labelled dialog');
check(welcomeSrc && !/innerHTML/.test(welcomeSrc), 'the welcome is built from text nodes, never markup');
check(/addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Escape'\) e\.stopPropagation\(\); \}\)/.test(welcomeSrc),
  'Esc stops at the welcome: the talk reader\'s listener on #btx-root never sees it');
check(/welcomeSteps\(welcomeFacts\)/.test(welcomeSrc), 'the welcome is built from the facts the worker answered');
const stepSrc = (panelSrcText.match(/function fillStep\(i\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/welcomeStepView\(/.test(stepSrc) && /lineParts\(/.test(stepSrc) && !/innerHTML/.test(stepSrc), 'each step is drawn by the pure view, from text nodes');
check(/persist\(\{ welcomeSeen: true \}\)/.test(panelSrcText), 'Got it writes the flag through __BTX.settings');
const placeSrc = (panelSrcText.match(/function placeWelcome\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/calloutPlacement\(/.test(placeSrc) && /controlNodes\(/.test(placeSrc),
  'the shell places the card and ring by the pure rule, from the control\'s measured nodes');
const openSrc = (panelSrcText.match(/function openWelcome\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
const closeSrc = (panelSrcText.match(/function closeWelcome\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
const gotItSrc = (panelSrcText.match(/function onWelcomeDone\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/ui\.body\.inert = true/.test(openSrc) && /ui\.body\.inert = false/.test(closeSrc),
  'the body under the welcome is inert while it shows (Tab never reaches a hidden row; Esc never reaches a hidden talk), and not after');
check(/welcomeTakesFocus\(/.test(openSrc), 'the welcome takes focus only by the pure rule (a background tab keeps its focus)');
check(/welcome\.next\.focus\(/.test(openSrc), '...and gives it to Next: the first Tab stop is never Skip, which ends the tour');
check(openSrc.indexOf('fillStep(') !== -1 && openSrc.indexOf('fillStep(') < openSrc.indexOf('appendChild(welcome.layer)'),
  'the first step is filled before the welcome is in the page: the live region doesn\'t read it out over the dialog');
const nextSrc = (panelSrcText.match(/function onWelcomeNext\(\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/WELCOME_CLICK_GUARD_MS/.test(nextSrc), 'a click just after a step change is dropped: a double click never ends the tour');
check(/dimControls\(null\)/.test(closeSrc), 'closing the welcome undims every control');
check(gotItSrc && !/\.focus\(/.test(gotItSrc), 'Got it and Skip move focus once: closeWelcome does it, onWelcomeDone does not again');
check(/focusOnToggle\(state, keyboard\)/.test((panelSrcText.match(/function setCollapsed\([\s\S]*?\n {2}\}\n/) || [''])[0]),
  'a collapse or an expand puts focus where the pure rule says');
check(/PANEL_HANDLED_KEYS = \[[^\]]*'welcomeSeen'/.test(panelSrcText),
  'welcomeSeen is panel-handled: a write from another context shows or hides the welcome, no re-render');

// Focus the panel moves itself never scrolls (#137). A scrolling focus would
// be a second, unplanned writer of the body's scroll (writeBodyScroll is the
// one writer; a reveal goes through panel.scrollIntoView), and the page's
// scroll must never move for a panel action.
for (const file of ['src/content/panel.js', 'src/citations/cit-panel.js', 'src/citations/talk-view.js', 'src/citations/highlights.js']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const scrolling = [];
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    const calls = code.match(/\.focus\([^)]*\)/g) || [];
    for (const c of calls) if (c !== '.focus({ preventScroll: true })') scrolling.push(`${i + 1}: ${c}`);
  });
  eq(scrolling, [], `${file}: every focus the panel moves is .focus({ preventScroll: true })`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

