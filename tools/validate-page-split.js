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
const on = { visible: true, mode: 'translation', row: SPA, layout: 'columns' };
eq(P.wantsSplit(on), true, 'a Church language in Translation mode, laid out in the page, splits it');
eq(P.wantsSplit({ ...on, layout: 'interlinear' }), true, '...under each verse too');
eq(P.wantsSplit({ ...on, layout: 'panel' }), false, 'the panel layout never touches the page');
eq(P.wantsSplit({ ...on, mode: 'citations' }), false, 'Citations mode takes the split away');
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
check(P.rowRules(rows, 'columns', false).split('\n').every((l) => l.startsWith('html[data-btx-split="columns"] article#main ')),
  'every rule is scoped to a mounted split and to the site article');
eq(P.cssId('p1.2'), 'article#main [id="p1.2"]', 'merged-verse ids (Turkish p1.2) stay one attribute selector');
eq(P.cssId('a"b'), 'article#main [id="a\\"b"]', 'a quote in an id cannot break out of the selector');

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
check(/\+\+splitToken;\s*pageSplit\.hide\(\);/.test(content), 'a new chapter drops the split before anything else');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
