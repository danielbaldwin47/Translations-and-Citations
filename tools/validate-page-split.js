#!/usr/bin/env node
/*
 * No-build sanity checks for src/content/page-split.js (__BTX.pageSplit), the
 * Church-language text split into the site's reading column. Run:
 *   node tools/validate-page-split.js
 *
 * Covers the pure core — when the page splits at all, how wide the column may
 * grow, when columns give way to interlinear, which translated blocks ride
 * with which pair, and the room each pair is given — plus the wiring that
 * keeps the split inside ADR-0007 (a layer, id rules, one <html> attribute;
 * never the site's nodes). The DOM shell is not exercised here.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const P = require(path.join(ROOT, 'src/content/page-split.js'));

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

// ---- wantsSplit ----
console.log('wantsSplit:');
const SPA = { id: 'church:spa', provider: 'church', lang: 'spa' };
const NIV = { id: 'niv', provider: 'api.bible' };
// `row` is the page's language (the arrangement's `page`), whatever the panel shows.
const on = { visible: true, row: SPA, layout: 'columns' };
eq(P.wantsSplit(on), true, 'a page language laid out in the page splits it');
eq(P.wantsSplit({ ...on, layout: 'interlinear' }), true, '...under each verse too');
eq(P.wantsSplit({ ...on, layout: 'panel' }), false, 'the panel layout never touches the page');
eq(P.wantsSplit({ ...on, mode: 'citations' }), true, 'the mode is no input: the split stays on the page in Citations');
eq(P.wantsSplit({ ...on, row: NIV }), false, 'an api.bible version stays in the panel');
eq(P.wantsSplit({ ...on, row: null }), false, 'no row, no split');
eq(P.wantsSplit({ ...on, visible: false }), false, 'no chapter shown (or one the language preference hides) means no split');
eq(P.wantsSplit({ ...on, visible: undefined }), false, 'visibility must be explicit');
eq(P.wantsSplit({ ...on, layout: undefined }), false, 'an unknown layout does not split');

// ---- fitWidth / effectiveLayout ----
console.log('fitWidth / effectiveLayout:');
// The live site at 1400px: navigation open to x=320, panel reserve from 1005.
eq(P.fitWidth({ center: 662, left: 320, right: 1005, max: 1240 }), 660, 'fits between the navigation and the panel');
eq(P.fitWidth({ center: 860, left: 320, right: 1400, max: 1240 }), 1056, 'panel collapsed: the whole reading area');
eq(P.fitWidth({ center: 960, left: 0, right: 1920, max: 1240 }), 1240, 'never wider than the cap');
eq(P.fitWidth({ center: 100, left: 300, right: 400, max: 1240 }), 0, 'an impossible fit is zero, not negative');
eq(P.readingRight({ width: 1600, reserve: 380 }), 1220, 'panel open: the reading area ends at its page reserve');
eq(P.readingRight({ width: 1600, reserve: 0 }), 1600 - P.FLOAT_GUTTER_PX, "panel collapsed: short of the site's floating buttons");
// The live site at 1600px, panel collapsed, navigation open: the column
// centred at 960 used to reach 1580 and ran under the audio button (~1503).
// Collapsing the panel: its reserve comes back and the column re-centres.
// The live site at 1600px with the navigation docked (x 320) and the panel
// open (reserve 380): the column centres at 770.
eq(P.collapseFits({ center: 770, left: 320, width: 1600, reserve: 380, pad: 104, max: 1240 }), true,
  'a wide window: collapsing leaves room for columns');
// 1100px, the navigation overlaying the page up to x 320, panel open: the
// column centres at 360, and even collapsed it would be about 436 wide.
eq(P.collapseFits({ center: 360, left: 320, width: 1100, reserve: 380, pad: 104, max: 1240 }), false,
  'a narrow window: collapsing would not make room, so it is not offered');
eq(P.collapseFits({ center: 960, left: 0, width: 1920, reserve: 0, pad: 104, max: 1240 }), false,
  'no reserve (collapsed already, or the bottom sheet): nothing to hand back');
check(960 + P.fitWidth({ center: 960, left: 320, right: P.readingRight({ width: 1600, reserve: 0 }), max: 1240 }) / 2 <= 1600 - P.FLOAT_GUTTER_PX,
  "a collapsed panel's widened columns stop short of the floating buttons");
eq(P.effectiveLayout('columns', 1056 - 104), 'columns', 'a wide area gets columns');
eq(P.effectiveLayout('columns', 660 - 104), 'interlinear', 'too narrow for two readable columns -> under each verse');
eq(P.effectiveLayout('columns', 2 * P.MIN_COLUMN_PX + P.GAP_PX), 'columns', 'exactly the minimum still gets columns');
eq(P.effectiveLayout('columns', 2 * P.MIN_COLUMN_PX + P.GAP_PX - 1), 'interlinear', '...a pixel less does not');
eq(P.effectiveLayout('interlinear', 5000), 'interlinear', 'interlinear stays interlinear however wide');

// ---- groupRows ----
console.log('groupRows:');
const has = (set) => (id) => set.includes(id);
eq(P.groupRows(['title_number1', 'p1', 'p2'], has(['title_number1', 'p1', 'p2'])),
  [{ id: 'title_number1', tail: [] }, { id: 'p1', tail: [] }, { id: 'p2', tail: [] }], 'every block with a partner is its own row');
eq(P.groupRows(['p18', 'p19', 'p20', 'p21'], has(['p18', 'p19'])),
  [{ id: 'p18', tail: [] }, { id: 'p19', tail: ['p20', 'p21'] }],
  'blocks with no English partner ride under the pair before them (French Psalm 51 has 21 verses to English 19)');
eq(P.groupRows(['study_intro1', 'p1', 'p2'], has(['p1', 'p2'])),
  [{ id: 'p1', tail: ['study_intro1'] }, { id: 'p2', tail: [] }], 'leading unpaired blocks join the first pair');
eq(P.groupRows(['p1', 'p2'], has([])), [], 'nothing paired (the page not rendered yet), nothing placed');

// ---- hideLineCopy ----
// The Hide line heading the split: the language's own name, then Hide.
console.log('hideLineCopy:');
const SPA_ROW = { id: 'church:spa', provider: 'church', lang: 'spa', abbr: 'Español', name: 'Spanish' };
eq(P.hideLineCopy(SPA_ROW), { language: 'Español', text: 'Español ·', button: 'Hide', label: 'Hide Español' },
  'names the language as the page shows it ("Español"), then the Hide button');
eq(P.hideLineCopy({ id: 'church:eng', provider: 'church', lang: 'eng', abbr: '', name: 'English' }).text, 'English ·',
  'a language whose own name is its English name (no abbr) is named by that name');
eq(P.hideLineCopy({ id: 'church:x', provider: 'church' }), { language: '', text: 'Translation on the page ·', button: 'Hide', label: 'Hide the translation' },
  'a row with no name falls back to a plain sentence');
eq(P.hideLineCopy(null).button, 'Hide', 'no row at all still reads');

// ---- rowRules ----
console.log('rowRules:');
const rows = [{ id: 'p1', eng: 90, tr: 120.4, mb: 16 }, { id: 'p2', eng: 150, tr: 100, mb: 16 }];
const cols = P.rowRules(rows, 'columns', false);
check(/\[id="p1"\] \{ width: calc\(50% - 14px\) !important; box-sizing: border-box !important; min-height: 121px !important; \}/.test(cols),
  'columns: a longer translation makes its English partner that tall, so the next pair starts level');
check(/\[id="p2"\] \{ width: calc\(50% - 14px\) !important; box-sizing: border-box !important; \}/.test(cols),
  'columns: a longer English verse needs nothing — the space under the translation is left open');
check(!/min-height/.test(P.rowRules(rows, 'columns', true)), 'columns, measuring: width only, so a pair can shrink back');
eq(P.rowRules(rows, 'interlinear', true), '', 'interlinear, measuring: no rules at all');
check(/\[id="p1"\] \{ margin-bottom: 147px !important; \}/.test(P.rowRules(rows, 'interlinear', false)),
  'interlinear: room under the English = its margin + the translation + a gap');
// An English block the translation has no block for (Japanese Daniel 1 has no
// chapter summary) keeps to the English column instead of running across both.
eq(P.soloIds(['title1', 'title_number1', 'study_summary1', 'p1', ''], ['title1', 'title_number1', 'p1']),
  ['study_summary1'], 'soloIds: English blocks with no pair, in page order; id-less ones cannot be styled');
eq(P.soloIds(['p1', 'p2'], ['p1', 'p2']), [], 'soloIds: every English block paired, none solo');
eq(P.soloIds(['title1', 'p1'], []), ['title1', 'p1'], 'soloIds: nothing paired, every English block keeps to its column');
check(/\[id="study_summary1"\] \{ width: calc\(50% - 14px\) !important; box-sizing: border-box !important; \}/.test(P.rowRules(rows, 'columns', false, ['study_summary1'])),
  'columns: a solo English block gets the column width and no min-height');
check(/\[id="study_summary1"\] \{ width/.test(P.rowRules(rows, 'columns', true, ['study_summary1'])),
  'columns, measuring: the solo width holds while measuring too, so nothing jumps between passes');
check(!/study_summary1/.test(P.rowRules(rows, 'interlinear', false, ['study_summary1'])),
  'interlinear: a solo English block is left alone (no gap for a translation that is not there)');
// The Hide line heads the split: the first pair's English is moved down by
// the line's room (its own margin + the line + a gap), so both sides of the
// first row still start level, under the line.
const head = { id: 'intro1', px: 62.2 };
check(/html\[data-btx-split="columns"\] article#main \[id="intro1"\] \{ margin-top: 63px !important; \}/.test(P.rowRules(rows, 'columns', false, [], head)),
  'columns: the first pair is moved down by the Hide line\'s room');
check(/html\[data-btx-split="interlinear"\] article#main \[id="intro1"\] \{ margin-top: 63px !important; \}/.test(P.rowRules(rows, 'interlinear', false, [], head)),
  'interlinear: the same room above the first pair');
check(!/margin-top/.test(P.rowRules(rows, 'columns', true, [], head)) && !/margin-top/.test(P.rowRules(rows, 'interlinear', true, [], head)),
  'measuring: no room for the line, so the site\'s own margin is what gets measured');
check(!/margin-top/.test(P.rowRules(rows, 'columns', false)), 'no line, no room');
check(P.rowRules(rows, 'columns', false, ['study_summary1'], head).split('\n').every((l) => l.startsWith('html[data-btx-split="columns"] article#main ')),
  'every rule is scoped to a mounted split and to the site article');
eq(P.cssId('p1.2'), 'article#main [id="p1.2"]', 'merged-verse ids (Turkish p1.2) stay one attribute selector');
eq(P.cssId('a"b'), 'article#main [id="a\\"b"]', 'a quote in an id cannot break out of the selector');

// ---- moved ----
// The site moves the reading column without resizing anything the observers
// watch (a footnote opening slides it left; the drawer closing widens the room
// beside it), so the watch refits when the column moved since the last fit.
console.log('moved:');
const fitted = { left: 332, width: 876, areaLeft: 319, areaRight: 1220 };
eq(P.moved(fitted, { ...fitted, left: 172 }), true, 'the footnote panel opened: the column slid left at the same width');
eq(P.moved(fitted, { ...fitted, areaRight: 900 }), true, '...and the room on the right ends at the footnote panel');
eq(P.moved(fitted, { ...fitted, areaLeft: 0 }), true, 'the navigation drawer closed: more room on the left');
eq(P.moved(fitted, { ...fitted, width: 1196 }), true, 'the column changed width');
eq(P.moved(fitted, { ...fitted, left: 332.4, width: 876.6 }), false, 'sub-pixel jitter is not a move');
eq(P.moved(fitted, { ...fitted }), false, 'nothing moved: nothing to refit');
eq(P.moved(null, fitted), true, 'never fitted: fit');
eq(P.moved(fitted, null), true, 'the column is gone: fit (it finds nothing and stays interlinear)');
eq(P.moved(null, null), false, 'no column before or now');

// ---- readingEdges ----
// Where the visible reading area starts and ends, from what lies under a probe
// just inside each edge. It must read the site's state only, never the layout
// the module applied last: the reading column carries the site's floating
// annotation toolbar just left of its text, so columns pushed it against the
// screen edge, the probe took it for a docked drawer, the room shrank, the
// split fell back to interlinear, the toolbar moved away, and round it went
// several times a second (#97).
console.log('readingEdges:');
// Stacks are what elementsFromPoint returns, topmost first.
const holder = (left, right) => ({ left, right, holdsColumn: true });
const SITE = [holder(0, 805), holder(0, 805), holder(0, 1185)];
const toolbar = { left: 4, right: 44, inColumn: true };
// The live site at 1200px, panel open (reserve 380, scrollbar 15).
const area = { width: 1185, reserve: 380 };
const asColumns = P.readingEdges({ ...area, leftStack: [toolbar, { ...toolbar }, ...SITE], rightStack: SITE });
const asInterlinear = P.readingEdges({ ...area, leftStack: SITE, rightStack: SITE });
eq(asColumns, asInterlinear, "the same site state reads the same edges whether the module's columns rule is on or off");
eq(asInterlinear, { left: 0, right: 805 }, 'nothing docked: the area runs from the page edge to the panel reserve');
const drawer = { left: 0, right: 320 };
eq(P.readingEdges({ ...area, leftStack: [drawer, ...SITE], rightStack: SITE }).left, 320, 'the navigation drawer docked on the left narrows the area');
eq(P.readingEdges({ ...area, leftStack: [toolbar, drawer, ...SITE], rightStack: SITE }).left, 320, '...even with the reading column\'s toolbar drawn over it');
eq(P.readingEdges({ ...area, leftStack: [...SITE, drawer], rightStack: SITE }).left, 0, 'nothing beneath what holds the reading column counts');
// The live site at 1440px with the panel at 900 (page 525 wide): the docked
// drawer (x 0-320) reaches past the middle of so narrow an area, and is still
// docked (#89).
const narrow = { width: 1425, reserve: 900 };
eq(P.readingEdges({ ...narrow, leftStack: [{ left: 1, right: 304 }, drawer, holder(0, 640)], rightStack: [holder(0, 525)] }).left, 320,
  'a docked drawer wider than half a narrow area still narrows it (#89)');
// Below about 1200px the site's drawer is a modal: it overlays the page above
// a scrim spanning the whole page. The page beneath is not laid out around it.
const scrim = { left: 0, right: 449 };
eq(P.readingEdges({ width: 1009, reserve: 560, leftStack: [drawer, scrim, toolbar, holder(0, 640)], rightStack: [scrim, holder(0, 640)] }), { left: 0, right: 449 },
  "a drawer over a scrim spanning the page is the site's modal: nothing is docked");
eq(P.readingEdges({ ...area, leftStack: [{ left: 0, right: 805 }, ...SITE], rightStack: SITE }).left, 0, 'a box spanning the whole area is not docked');
const footnotes = { left: 560, right: 805 };
eq(P.readingEdges({ ...area, leftStack: SITE, rightStack: [footnotes, ...SITE] }).right, 560, "the site's footnote panel ends the area where it starts");
eq(P.readingEdges({ ...area, leftStack: SITE, rightStack: [{ left: 560, right: 805, ours: true }, footnotes, ...SITE] }).right, 805,
  'the probe stops at our own panel');
eq(P.readingEdges({ width: 1385, reserve: 0, leftStack: SITE, rightStack: SITE }).right, 1385 - P.FLOAT_GUTTER_PX,
  'panel collapsed: the area ends short of the floating buttons (readingRight)');
// The fit rule (#89) moves section#content, and its toolbar and text with it:
// the reading area must not move with them, or the fit would feed its own
// input as the split's columns once did (#97). Each pair is the same site
// state probed with the fit's rule off (the site's own column) and on (the
// fitted box), each stack as elementsFromPoint returns it there.
{
  // 1024px window, drawer closed, panel 640: the site holds the column 0-640
  // under the panel; fitted it is 0-369 with 34px padding, which brings the
  // column's toolbar (8px left of the text) under the left probe.
  const sized = { width: 1009, reserve: 640 };
  const page = holder(0, 1009);
  const off = P.readingEdges({ ...sized,
    leftStack: [holder(0, 640), page],
    rightStack: [{ left: 64, right: 576, inColumn: true }, holder(0, 640), page] });
  const on = P.readingEdges({ ...sized,
    leftStack: [{ left: -14, right: 26, inColumn: true }, holder(0, 369), page],
    rightStack: [holder(0, 369), page] });
  eq(on, off, "1024px, panel 640: the same reading area with the fit's rule on or off");
  eq(off, { left: 0, right: 369 }, '...the page edge to the panel');
  // 1440px window, drawer docked, panel 640: the site's column 232.5-872.5
  // runs under the drawer and the panel; fitted it is 320-785.
  const docked = { width: 1425, reserve: 640 };
  const dock = [{ left: 1, right: 304 }, drawer];
  const offDocked = P.readingEdges({ ...docked,
    leftStack: [...dock, holder(0, 1425)],
    rightStack: [{ left: 296.5, right: 808.5, inColumn: true }, holder(232.5, 872.5), holder(0, 1425)] });
  const onDocked = P.readingEdges({ ...docked,
    leftStack: [...dock, holder(0, 1425)],
    rightStack: [holder(320, 785), holder(0, 1425)] }); // x 781 is in the fitted column's padding
  eq(onDocked, offDocked, "1440px, drawer docked, panel 640: the same reading area with the fit's rule on or off");
  eq(offDocked, { left: 320, right: 785 }, '...from the drawer to the panel');
}

// ---- fitColumn ----
// The fit rule (#89): where the site's reading column goes in the visible
// reading area. With the panel open, a column whose text would run under the
// docked drawer or the panel narrows into the area; one that already fits is
// left exactly as the site laid it out (no box, so no rule). The split's
// columns widen it as before.
console.log('fitColumn:');
const GEN = { padLeft: 64, padRight: 64 }; // section#content's own padding on ot/gen/1
// The live site, 1440px window, Scriptures drawer docked (x 0-320), panel 640.
eq(P.fitColumn({ layout: null, area: { left: 320, right: 785 }, column: { left: 232.5, right: 872.5, ...GEN }, width: 1425, reserve: 640 }),
  { effective: null, collapseFits: false, box: { left: 320, width: 465, padLeft: 64, padRight: 64 } },
  "clipped on both sides: the column takes the area between the drawer and the panel, keeping the site's padding (its gutter holds the annotation toolbar and media icons)");
// 1024px window, drawer closed, panel 640: with the site's padding the text
// would be 241px wide, under a readable measure, so the padding gives way.
eq(P.fitColumn({ layout: null, area: { left: 0, right: 369 }, column: { left: 0, right: 640, ...GEN }, width: 1009, reserve: 640 }).box,
  { left: 0, width: 369, padLeft: 34, padRight: 34 }, 'too narrow for the padding and a readable measure: the padding gives way first');
// 1440px window, drawer docked, panel 900: 205px between the drawer and the panel.
eq(P.fitColumn({ layout: null, area: { left: 320, right: 525 }, column: { left: 160, right: 800, ...GEN }, width: 1425, reserve: 900 }).box,
  { left: 320, width: 205, padLeft: P.FIT_PAD_PX, padRight: P.FIT_PAD_PX }, '...down to FIT_PAD_PX, then the text narrows');
// 1024px window, drawer closed, panel 560: the site's grid keeps the column 640 wide.
eq(P.fitColumn({ layout: null, area: { left: 0, right: 449 }, column: { left: 0, right: 640, ...GEN }, width: 1009, reserve: 560 }).box,
  { left: 0, width: 449, padLeft: 64, padRight: 64 }, 'clipped by the panel alone: the column ends where the panel starts');
eq(P.fitColumn({ layout: null, area: { left: 0, right: 1045 }, column: { left: 202.5, right: 842.5, ...GEN }, width: 1425, reserve: 380 }).box,
  null, "text already inside the area: no box, the site's own layout");
eq(P.fitColumn({ layout: null, area: { left: 0, right: 1353 }, column: { left: 1300, right: 1940, ...GEN }, width: 1425, reserve: 0 }).box,
  null, 'panel collapsed (no page reserve): never narrowed, the site lays itself out for the window');
eq(P.fitColumn({ layout: 'interlinear', area: { left: 0, right: 449 }, column: { left: 0, right: 640, ...GEN }, width: 1009, reserve: 560 }),
  { effective: 'interlinear', collapseFits: false, box: { left: 0, width: 449, padLeft: 64, padRight: 64 } },
  'under each verse: the split lays out inside the fitted column');
// 1600px window, drawer docked, panel 380: the column centred at 770.
eq(P.fitColumn({ layout: 'columns', area: { left: 320, right: 1220 }, column: { left: 450, right: 1090, ...GEN }, width: 1600, reserve: 380 }),
  { effective: 'columns', collapseFits: true, box: { left: 332, width: 876, padLeft: 40, padRight: 64 } },
  'side by side: the column widens around its centre to the area, as before');
eq(P.fitColumn({ layout: 'columns', area: { left: 320, right: 785 }, column: { left: 232.5, right: 872.5, ...GEN }, width: 1425, reserve: 640 }),
  { effective: 'interlinear', collapseFits: true, box: { left: 320, width: 465, padLeft: 64, padRight: 64 } },
  'side by side with no room: under each verse, in the fitted column');
// The width matrix (#89's acceptance), measured on the live site on ot/gen/1
// (2026-10-09): 1024px and 1440px windows, the Scriptures drawer open and
// closed, the panel 280-900px wide and collapsed. Each row is the page's width,
// the panel's page reserve, the reading area (readingEdges) and
// section#content as the site laid it out (64px padding a side). Below about
// 1200px the open drawer is the site's modal, so the area does not start
// after it. Every row runs with no split, under each verse, and side by side.
//   [window, drawer, panel, width, reserve, areaLeft, areaRight, columnLeft, columnRight]
const MATRIX = [
  [1024, true, 280, 1009, 280, 0, 729, 44.5, 684.5],
  [1024, true, 380, 1009, 380, 0, 629, 0, 640],
  [1024, true, 480, 1009, 480, 0, 529, 0, 640],
  [1024, true, 560, 1009, 560, 0, 449, 0, 640],
  [1024, true, 640, 1009, 640, 0, 369, 0, 640],
  [1024, true, 720, 1009, 720, 0, 289, 0, 640],
  [1024, true, 800, 1009, 800, 0, 209, 0, 640],
  [1024, true, 900, 1009, 900, 0, 109, 0, 640],
  [1024, true, 'collapsed', 1009, 0, 0, 937, 184.5, 824.5],
  [1024, false, 280, 1009, 280, 0, 729, 44.5, 684.5],
  [1024, false, 380, 1009, 380, 0, 592, 0, 640],
  [1024, false, 480, 1009, 480, 0, 529, 0, 640],
  [1024, false, 560, 1009, 560, 0, 449, 0, 640],
  [1024, false, 640, 1009, 640, 0, 369, 0, 640],
  [1024, false, 720, 1009, 720, 0, 289, 0, 640],
  [1024, false, 800, 1009, 800, 0, 209, 0, 640],
  [1024, false, 900, 1009, 900, 0, 109, 0, 640],
  [1024, false, 'collapsed', 1009, 0, 0, 937, 184.5, 824.5],
  [1440, true, 280, 1425, 280, 320, 1145, 412.5, 1052.5],
  [1440, true, 380, 1425, 380, 320, 1045, 362.5, 1002.5],
  [1440, true, 480, 1425, 480, 320, 945, 312.5, 952.5],
  [1440, true, 560, 1425, 560, 320, 865, 272.5, 912.5],
  [1440, true, 640, 1425, 640, 320, 785, 232.5, 872.5],
  [1440, true, 720, 1425, 720, 320, 705, 192.5, 832.5],
  [1440, true, 800, 1425, 800, 320, 592, 160, 800],
  [1440, true, 900, 1425, 900, 320, 525, 160, 800],
  [1440, true, 'collapsed', 1425, 0, 320, 1353, 552.5, 1192.5],
  [1440, false, 280, 1425, 280, 0, 1145, 252.5, 892.5],
  [1440, false, 380, 1425, 380, 0, 1045, 202.5, 842.5],
  [1440, false, 480, 1425, 480, 0, 945, 152.5, 792.5],
  [1440, false, 560, 1425, 560, 0, 865, 112.5, 752.5],
  [1440, false, 640, 1425, 640, 0, 785, 72.5, 712.5],
  [1440, false, 720, 1425, 720, 0, 705, 32.5, 672.5],
  [1440, false, 800, 1425, 800, 0, 592, 0, 640],
  [1440, false, 900, 1425, 900, 0, 525, 0, 640],
  [1440, false, 'collapsed', 1425, 0, 0, 1353, 392.5, 1032.5],
];
let fittedRows = 0;
for (const [win, drawerOpen, panel, width, reserve, aL, aR, cL, cR] of MATRIX) {
  const name = `${win}px, drawer ${drawerOpen ? 'open' : 'closed'}, panel ${panel}`;
  const column = { left: cL, right: cR, ...GEN };
  const area = { left: aL, right: aR };
  const siteText = [cL + GEN.padLeft, cR - GEN.padRight];
  const siteFits = siteText[0] >= aL && siteText[1] <= aR;
  const plain = P.fitColumn({ layout: null, area, column, width, reserve });
  for (const layout of [null, 'interlinear', 'columns']) {
    const { effective, box } = P.fitColumn({ layout, area, column, width, reserve });
    const text = box ? [box.left + box.padLeft, box.left + box.width - box.padRight] : siteText;
    check(text[0] >= aL && text[1] <= aR && text[1] > text[0], `${name}, split ${layout}: no verse text clipped (text ${text}, area ${aL}-${aR})`);
    if (effective !== 'columns') {
      eq(box, plain.box, `${name}, split ${layout}: the split lays out in the same fitted column as no split`);
    }
  }
  eq(plain.box === null, siteFits || reserve === 0, `${name}: the site's own layout exactly when its text already fits, or the panel is collapsed`);
  if (plain.box) fittedRows++;
}
check(fittedRows >= 10, `the matrix exercises the fit (${fittedRows} rows fitted)`);
// The same matrix with the chapter arrows' 56px gutter (#102 C3): with the
// panel open, no row leaves text under an arrow unless the area is so narrow
// that the gutter gave way to MIN_TEXT_PX of text, and the text never narrows
// below what the area allows.
let clearRows = 0;
for (const [win, drawerOpen, panel, width, reserve, aL, aR, cL, cR] of MATRIX) {
  if (!(reserve > 0)) continue;
  const name = `${win}px, drawer ${drawerOpen ? 'open' : 'closed'}, panel ${panel}, arrows`;
  const column = { left: cL, right: cR, ...GEN };
  const { box } = P.fitColumn({ layout: null, area: { left: aL, right: aR }, column, width, reserve, gutter: 56 });
  const text = box ? [box.left + box.padLeft, box.left + box.width - box.padRight] : [cL + GEN.padLeft, cR - GEN.padRight];
  check(text[0] >= aL && text[1] <= aR, `${name}: no verse text clipped (text ${text}, area ${aL}-${aR})`);
  if (aR - aL - 112 >= P.MIN_TEXT_PX) {
    check(text[0] >= aL + 56 && text[1] <= aR - 56, `${name}: text ${text} clear of the arrows' gutter in ${aL}-${aR}`);
    clearRows++;
  } else {
    check(text[1] - text[0] >= Math.min(P.MIN_TEXT_PX, aR - aL - 32), `${name}: too narrow for the gutter, the gutter gives way (text ${text[1] - text[0]}px)`);
  }
}
check(clearRows >= 20, `the arrows' matrix exercises the gutter (${clearRows} rows)`);

// The site's ‹ › chapter arrows (#102 C3): sticky 8px inside the visible
// reading area's edges, 40px wide, so the text keeps their gutter clear. The
// shell measures them; arrowGutter turns their rects into one px figure.
console.log('arrowGutter / fitColumn with the arrows:');
const AREA_545 = { left: 320, right: 880 }; // 1440px window, drawer docked, panel 545 (measured live on nt/john/3)
const ARROWS = [{ left: 328, right: 368 }, { left: 832, right: 872 }];
eq(P.arrowGutter(AREA_545, ARROWS), 56, "the arrows' real width and offset (8 + 40) plus a breathing gap, the same on both sides");
eq(P.arrowGutter(AREA_545, [ARROWS[1]]), 56, 'one arrow alone (the first chapter of a book) keeps the same gutter, so the column does not shift from chapter to chapter');
eq(P.arrowGutter(AREA_545, [{ left: 322, right: 350 }, ARROWS[1]]), 56, 'the wider side decides');
eq(P.arrowGutter(AREA_545, []), 0, 'no arrows (a narrow window shows none): no gutter');
eq(P.arrowGutter(AREA_545, [{ left: 600, right: 640 }]), 0, 'a sticky control that is not at an edge is not an arrow');
const GUT = P.arrowGutter(AREA_545, ARROWS);
const john545 = P.fitColumn({ layout: null, area: AREA_545, column: { left: 280, right: 920, ...GEN }, width: 1425, reserve: 545, gutter: GUT });
check(john545.box && john545.box.left + john545.box.padLeft >= ARROWS[0].right && john545.box.left + john545.box.width - john545.box.padRight <= ARROWS[1].left,
  `John 3 at 545px: the site's text (344-856) ran under the arrows; the fitted text clears them (box ${JSON.stringify(john545.box)})`);
eq(P.fitColumn({ layout: null, area: AREA_545, column: { left: 320, right: 880, padLeft: 24, padRight: 24 }, width: 1425, reserve: 545, gutter: GUT }).box,
  { left: 320, width: 560, padLeft: 56, padRight: 56 }, "text inside the area but under the arrows: still a box, its padding the gutter");
eq(P.fitColumn({ layout: null, area: AREA_545, column: { left: 320, right: 880, ...GEN }, width: 1425, reserve: 545, gutter: GUT }).box,
  null, 'text already clear of the arrows: no box');
eq(P.fitColumn({ layout: null, area: { left: 0, right: 369 }, column: { left: 0, right: 640, ...GEN }, width: 1009, reserve: 640, gutter: 56 }).box,
  { left: 0, width: 369, padLeft: 56, padRight: 56 }, 'narrow: the padding gives way only down to the gutter, the text narrows instead (257px)');
eq(P.fitColumn({ layout: null, area: { left: 320, right: 525 }, column: { left: 160, right: 800, ...GEN }, width: 1425, reserve: 900, gutter: 56 }).box,
  { left: 320, width: 205, padLeft: P.FIT_PAD_PX, padRight: P.FIT_PAD_PX },
  'so little room that the text would be under MIN_TEXT_PX: the gutter gives way, to FIT_PAD_PX, before the text becomes unreadable');
eq(P.fitColumn({ layout: null, area: AREA_545, column: { left: 280, right: 920, ...GEN }, width: 1425, reserve: 0, gutter: GUT }).box,
  null, 'panel collapsed: the site lays itself out for the window, arrows far from the text');
eq(P.fitColumn({ layout: 'interlinear', area: AREA_545, column: { left: 280, right: 920, ...GEN }, width: 1425, reserve: 545, gutter: GUT }).box,
  john545.box, 'under each verse: the same fitted column as no split');

// The rule that places the box. The column's container is translated right by
// half the drawer (x 160) and wider than the page; the rule places the column
// from the container's left edge, whatever the site's own margins were.
const rule = P.fitRule({ left: 320, width: 465, padLeft: 16, padRight: 16 }, 160);
check(/^section#content \{[^}]*\}$/.test(rule), 'one rule, selecting the reading column by id (ADR-0005, ADR-0007)');
check(/margin-left: 160px !important; margin-right: auto !important;/.test(rule), 'the column starts at the box: 320 - 160 into its container');
check(/ width: 465px !important;/.test(rule) && /min-width: 0 !important;/.test(rule) && /max-width: none !important;/.test(rule),
  "the box's width holds against the site's own min-width (272px) and max-width (640px)");
check(/box-sizing: border-box !important;/.test(rule) && /padding-left: 16px !important; padding-right: 16px !important;/.test(rule),
  'the box includes its padding');
eq(P.fitRule(null, 160), '', 'no box, no rule');

// ---- Wiring (greps: the DOM half can't run here) ----
console.log('Wiring (ADR-0007):');
const src = fs.readFileSync(path.join(ROOT, 'src/content/page-split.js'), 'utf8').replace(/\r\n/g, '\n');
const shell = src.slice(src.indexOf('// ---- DOM shell'));
check(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'nothing is ever inserted as HTML');
check(/renderBlocks\(\[block\]\)/.test(shell), 'translated blocks are built by the IR renderer (text nodes only)');
check((shell.match(/\.appendChild\(/g) || []).length === (shell.match(/(layer|node|head)\.appendChild\(|s\.layer\.appendChild\(|article\.appendChild\(s\.layer\)/g) || []).length,
  'the shell appends only to its own layer, its own items, <head> (its styles) and article#main (the layer itself)');
check(!/partner\.(style|setAttribute|classList|appendChild|remove)|row\.partner\.(style|setAttribute|classList)/.test(shell),
  "the site's elements are read (getComputedStyle, rects), never written");
check(/getAttribute\('data-uri'\) === s\.uri/.test(shell), 'it mounts only once the site shows the chapter it loaded');
check(/readingRight\(\{ width, reserve \}\)/.test(shell), 'the reading area ends where the pure rule says');
check(/readingEdges\(\{ width, reserve, leftStack: stack\(4\), rightStack: stack\(edge - 4\) \}\)/.test(shell)
  && /inColumn: n !== section && section\.contains\(n\)/.test(shell),
  "the shell probes both edges through readingEdges, marking what sits inside the reading column (#97)");
check(/effective !== s\.effective \|\| roomier !== s\.collapseFits\)[\s\S]{0,300}s\.onLayout\(\{ effective, collapseFits: roomier \}\)/.test(shell),
  'the layout callback fires where what fits changes, and only there');
const css = fs.readFileSync(path.join(ROOT, 'src/content/page-split.css'), 'utf8');
const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
check(selectors.every((sel) => sel.split(',').every((one) => /^(html\[data-btx-split[^\]]*\]|\.btx-split-)/.test(one.trim()))),
  'page-split.css only styles a mounted split or its own layer');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const cs = manifest.content_scripts[0];
check(cs.js.indexOf('src/content/page-split.js') > cs.js.indexOf('src/content/church-text.js')
  && cs.js.indexOf('src/content/page-split.js') < cs.js.indexOf('src/content/content.js'),
  'page-split.js loads after church-text.js and before the orchestrator');
check(cs.css.includes('src/content/page-split.css'), 'page-split.css is a content stylesheet');
check(!cs.js.some((f) => /prototype/.test(f)), 'no prototype ships in the manifest');
const content = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
check(/pageSplit\.wantsSplit\(/.test(content), 'the orchestrator asks the pure rule whether to split');
check(/function hideLine\([\s\S]*?hideLineCopy\(s\.row\)[\s\S]*?textContent = copy\.text[\s\S]*?textContent = copy\.button/.test(shell),
  'the Hide line is built from hideLineCopy, as text');
check(/if \(typeof s\.onHide === 'function'\) s\.layer\.appendChild\(s\.line = hideLine\(/.test(shell),
  'the Hide line is the first item of the layer, drawn only when show() was given onHide');
check(!/churchLanguageShown|SETTINGS|__BTX\.settings|chrome\.storage/.test(src), 'the reading layer writes no setting: Hide only calls onHide');
check(/onHide: \(\) => setLanguageShown\(false, \{ anchor: splitAnchor\(\) \}\)/.test(content)
  && /function setLanguageShown\(on, \{ anchor \} = \{\}\) \{[\s\S]*?SETTINGS\.patch\(\{ churchLanguageShown: shown \}\)[\s\S]*?syncSplit\(\{ anchor: anchor \|\| splitAnchor\(\) \}\)/.test(content),
  'the orchestrator\'s onHide turns the switch off through __BTX.settings, and the split goes keeping the top paragraph');
const syncSrc = (content.match(/async function syncSplit\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/panel\.arrangement\(\)/.test(syncSrc) && !/effectiveMode|activeId/.test(syncSrc),
  'the split follows the arrangement\'s page language, never the mode or the panel\'s text');
check(/\+\+splitToken;\s*pageSplit\.hide\(\);/.test(content), 'a new chapter drops the split before anything else');
check((shell.match(/if \(moved\(geo, geometry\(\)\)\) schedule\(\);/g) || []).length === 2 && /layout\(\);\s*geo = geometry\(\);/.test(shell),
  'both watches (split and fit) refit when the column moved since the last fit, measured after the fit\'s own writes');
// The fit (#89): the same rule with or without a split, measured from the
// site's own column, and nothing left once no box is wanted.
check(/fitStyle\.disabled = true;[\s\S]{0,400}fitColumn\(\{ layout: split \? split\.layout : null, area, column, width: area\.width, reserve: area\.reserve, gutter: area\.gutter \}\)[\s\S]{0,200}fitStyle\.disabled = false;/.test(shell),
  'the fit measures the column with its own rule switched off, and asks fitColumn with or without a split');
check(/if \(fitStyle && !css\) \{ fitStyle\.remove\(\); fitStyle = null; \}/.test(shell),
  'no box, no rule: the style element goes with it');
check(/unmount\(\);\s*s = null;\s*refresh\(\);\s*keepAt\(anchor, keep\);/.test(shell),
  'hiding the split refits the column without it, in the same reflow the anchor is kept through');
check(/new ResizeObserver\(schedule\)\.observe\(document\.documentElement\);/.test(shell),
  'the fit follows the page reserve: the panel opening, collapsing or resizing resizes <html>');
check(/pageSplit\.start\(\);/.test(content), 'the orchestrator starts the reading layer once');
// The reader's place survives the split coming and going: the anchor is
// measured before the reflow and the page scrolled by its shift after.
check(/BLOCKS\(article\)\.filter\(\(el\) => !s\.layer\.contains\(el\)\)/.test(shell)
  && /soloIds\(english, rows\.map\(\(row\) => row\.id\)\)/.test(shell),
  'solo English blocks: the translation\'s block rule walks the article (its own layer excluded), minus every pair');
check(/rowRules\(rows, s\.effective, true, solo\)/.test(shell) && /rowRules\(measured, s\.effective, false, solo, head\)/.test(shell),
  '...and both passes give them the column width, so nothing jumps between measuring and placing');
check(/const keep = topIn\(s\.article, anchor\);[\s\S]*?unmount\(\);[\s\S]*?keepAt\(anchor, keep\);/.test(shell),
  'hiding keeps the anchor in place across the unmount');
check(/const keep = topIn\(article, anchor\);[\s\S]*?refresh\(\);\s*keepAt\(anchor, keep\);/.test(shell),
  "the first mount keeps show's anchor in place across its first layout");
check(/s\.anchor = null;/.test(shell), '...once: a re-mount is the site\'s new article');
check(/hide\(\{ anchor: opts\.anchor \}\);/.test(shell), 'a split replaced by another key keeps the anchor through its removal too');
check(/function keepAt\(anchor, top\) \{[\s\S]*?window\.scrollBy\(/.test(shell), 'keepAt scrolls the page by the shift');
check(/anchor,\s*\n\s*\/\/ What actually fits/.test(content) && /syncSplit\(\{ anchor: splitAnchor\(\) \}\)/.test(content),
  'the orchestrator hands the split the paragraph at the top of the screen when it shows it');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
