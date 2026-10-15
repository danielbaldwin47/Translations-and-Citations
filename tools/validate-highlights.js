#!/usr/bin/env node
/*
 * No-build sanity checks for the highlight module's pure cores
 * (src/citations/highlights.js, __BTX.highlights). Run:
 *   node tools/validate-highlights.js
 *
 * A keyboard reader removes a highlight by Tab to it, then Enter. Two rules
 * make that path, and both are checked here:
 *
 *   tabStops   which of a talk's mark spans is a Tab stop. A highlight is cut
 *              into one span per text node it covers (a link, an emphasis or
 *              a paragraph break inside it splits it), so one highlight can be
 *              many spans; it must still be one Tab stop, or a long highlight
 *              makes the talk tedious to Tab through.
 *   opensMenu  which key on a focused mark opens its Remove action: Enter or
 *              Space, as on any button, and nothing with a modifier held.
 *
 * Also stopFromCaret (where Tab from the caret goes) and menuTop (the action
 * menu sits above the selection when there is room, so it never covers the
 * text it acts on).
 *
 * What a browser shows (caret-browsing selection, the menu, focus moves) is
 * not checked here. Exits non-zero on any failure.
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const H = require(path.join(ROOT, 'src/citations/highlights.js'));

let failures = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

// ---- tabStops ----
eq(H.tabStops([]), [], 'a talk without highlights has no Tab stops');
eq(H.tabStops(['a']), [true], 'a one-span highlight is one Tab stop');
eq(H.tabStops(['a', 'a', 'a', 'a']), [true, false, false, false],
  'a highlight cut into four spans (links, emphasis, paragraphs) is still one Tab stop, its first');
eq(H.tabStops(['a', 'a', 'b', 'b', 'c']), [true, false, true, false, true],
  'three highlights are three Tab stops, in reading order');
eq(H.tabStops(['a', 'b', 'a']), [true, true, false],
  'a highlight nested around another still stops once, at its first span');

// ---- opensMenu ----
const key = (k, mods) => Object.assign({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, mods);
eq(H.opensMenu(key('Enter')), true, 'Enter on a focused mark opens Remove');
eq(H.opensMenu(key(' ')), true, 'Space on a focused mark opens Remove, as on a button');
eq(H.opensMenu(key('Tab')), false, 'Tab moves on past a mark');
eq(H.opensMenu(key('ArrowRight', { shiftKey: true })), false, 'Shift+arrow keeps selecting through a mark');
eq(H.opensMenu(key('Enter', { ctrlKey: true })), false, 'Ctrl+Enter is not a plain Enter');
eq(H.opensMenu(key('Enter', { shiftKey: true })), false, 'Shift+Enter is not a plain Enter');
eq(H.opensMenu(key(' ', { altKey: true })), false, 'Alt+Space is not a plain Space');
eq(H.opensMenu(key('Enter', { metaKey: true })), false, 'Meta+Enter is not a plain Enter');

// ---- stopFromCaret ----
// Each Tab stop in the talk view, in document order, as the side of the caret
// its start lies on: -1 before, 0 at it, 1 after.
eq(H.stopFromCaret([-1, -1, 1, 1], false), 2, 'Tab from the caret goes to the first stop after it');
eq(H.stopFromCaret([-1, -1, 1, 1], true), 1, 'Shift+Tab from the caret goes to the last stop before it');
eq(H.stopFromCaret([-1, 0, 1], false), 1, 'a stop that starts at the caret is the next one');
eq(H.stopFromCaret([-1, 0, 1], true), 0, 'a stop that starts at the caret is not behind it');
eq(H.stopFromCaret([-1, -1], false), -1, 'no stop after the caret: none (Tab leaves the talk)');
eq(H.stopFromCaret([1, 1], true), -1, 'no stop before the caret: none');
eq(H.stopFromCaret([], false), -1, 'no stops at all: none');

// ---- menuTop ----
// Where the action menu goes (viewport y of its top), given the selection's
// rect, the menu's height, and the band it may use: below the reader's
// sticky header (minTop) and above the window's bottom (maxBottom).
const sel = (top, bottom) => ({ top, bottom });
const band = { menuH: 36, minTop: 150, maxBottom: 892 };
eq(H.menuTop(Object.assign({ rect: sel(400, 420) }, band)), 400 - 6 - 36,
  'room above: the menu sits above the selection, clear of the text it acts on');
eq(H.menuTop(Object.assign({ rect: sel(180, 200) }, band)), 200 + 6,
  'no room under the header: below the selection');
eq(H.menuTop(Object.assign({ rect: sel(150 + 6 + 36, 220) }, band)), 150,
  'exactly room above: above');
eq(H.menuTop(Object.assign({ rect: sel(160, 880) }, band)), 892 - 36,
  'a selection filling the band: the menu keeps to the band\'s bottom');
eq(H.menuTop({ rect: sel(400, 420), menuH: 36 }), 400 - 6 - 36, 'no band given: the window from 8px down');

if (failures) {
  console.error(`validate-highlights: ${failures} failure(s)`);
  process.exit(1);
}
console.log('validate-highlights: ok');
