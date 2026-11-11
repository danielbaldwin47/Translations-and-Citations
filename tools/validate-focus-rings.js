#!/usr/bin/env node
/*
 * No-build sanity checks for the panel's keyboard-focus ring, which lives in
 * src/content/panel.css (the one shared rule) and src/citations/citations.css
 * (the inset overrides). Run:
 *   node tools/validate-focus-rings.js
 *
 * A keyboard reader must always see where focus is. That holds by one shared
 * `:focus-visible` rule over every interactive element kind, so these checks
 * pin the rule and the ways it can silently stop covering a control:
 *   - the shared rule names every interactive kind the panel builds
 *     (buttons, the dropdown, the filter, links, group headers, role=button
 *     rows) and draws a visible outline;
 *   - the rule stays low-specificity (`:where`), so an override that only moves
 *     the ring needs no specificity fight;
 *   - the ring's width and offset are defined once, as `--btx-ring-w` and
 *     `--btx-ring-offset` on `#btx-root`, and a ring drawn without
 *     `:focus-visible` (a keyboard-focused highlight) reads the same two;
 *   - no control turns its ring off: `outline: none` is allowed only on the two
 *     containers that take focus from a click or from code (tabindex -1);
 *   - a control that sits where an outer ring is cut off or lost (inside the
 *     `overflow: clip` citation cards, the body's own scroll box, the collapsed
 *     tab on the window's edge) draws it inset.
 *
 * What a browser shows (the ring on a real Tab through every mode, in light and
 * dark) is not checked here. Exits non-zero on any failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const PANEL = strip(read('src/content/panel.css'));
const CIT = strip(read('src/citations/citations.css'));
const ALL = PANEL + '\n' + CIT;

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}

// Split a selector list on the commas outside parentheses (`:where(a, b)`).
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

// Every rule as { selectors: [...], body }.
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selectors: splitSelectors(m[1]), body: m[2] });
  }
  return out;
}
const ALL_RULES = rules(ALL);
const focusRulesFor = (needle) =>
  ALL_RULES.filter((r) => r.selectors.some((s) => s.includes(':focus-visible') && s.includes(needle)));

// ---- The shared rule ----
const shared = ALL_RULES.find((r) => r.selectors.length === 1 && r.selectors[0].startsWith('#btx-root :where('));
check(shared, 'panel.css has the shared `#btx-root :where(...):focus-visible` rule');
if (shared) {
  const sel = shared.selectors[0];
  check(sel.endsWith(':focus-visible'), 'the shared rule is :focus-visible (a mouse click shows no ring)');
  for (const kind of ['button', 'select', 'input', 'a', 'summary', "[role='button']"]) {
    check(new RegExp('[(,\\s]' + kind.replace(/[[\]]/g, '\\$&') + '[,)]').test(sel), `the shared rule covers ${kind}`);
  }
  check(/outline:\s*var\(--btx-ring-w\) solid var\(--btx-accent\)/.test(shared.body), 'the shared ring is --btx-ring-w in the accent');
  check(/outline-offset:\s*var\(--btx-ring-offset\)/.test(shared.body), 'the shared ring sits --btx-ring-offset outside the control');
}

// ---- The ring's size, defined once ----
const rootRule = ALL_RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === '#btx-root' && /--btx-ring-w/.test(r.body));
check(rootRule && /--btx-ring-w:\s*2px/.test(rootRule.body), '#btx-root defines --btx-ring-w: 2px');
check(rootRule && /--btx-ring-offset:\s*1px/.test(rootRule.body), '#btx-root defines --btx-ring-offset: 1px');
const hlRing = ALL_RULES.find((r) => r.selectors.includes('#btx-root .btx-hl.btx-hl-focus'));
check(hlRing && /outline:\s*var\(--btx-ring-w\) solid var\(--btx-accent\)/.test(hlRing.body)
  && /outline-offset:\s*var\(--btx-ring-offset\)/.test(hlRing.body),
  "a keyboard-focused highlight draws the shared ring from the same two properties");
for (const r of ALL_RULES) {
  if (!r.selectors.some((x) => x.includes(':focus-visible'))) continue;
  check(!/outline:\s*\d+px/.test(r.body), `${r.selectors.join(', ')} spells its ring width as var(--btx-ring-w), not a literal`);
}

// ---- No control turns its ring off ----
const ALLOWED_OFF = new Set(['#btx-root .btx-talk-view:focus', '#btx-root .btx-welcome-dialog:focus']);
for (const r of ALL_RULES) {
  if (!/outline:\s*(none|0)\b/.test(r.body)) continue;
  for (const s of r.selectors) {
    check(ALLOWED_OFF.has(s), `${s} turns its outline off (only the tabindex -1 containers may)`);
  }
}

// ---- Inset where an outer ring would be lost ----
function offsetOf(needle) {
  const found = focusRulesFor(needle).map((r) => /outline-offset:\s*(-?\d+)px/.exec(r.body)).filter(Boolean);
  return found.length ? Number(found[found.length - 1][1]) : null;
}
for (const needle of ['summary.btx-cit-vhead', 'summary.btx-cit-chead', '.btx-cit:', '.btx-body:', '.btx-tab:']) {
  const o = offsetOf(needle);
  check(o !== null && o < 0, `${needle.replace(/:$/, '')} draws its focus ring inset (outline-offset < 0)`);
}

// ---- Citation cards clip, so nothing inside may rely on an outer ring ----
check(/\.btx-cit-vgroup\s*\{[^}]*overflow:\s*clip/.test(CIT), 'the citation cards still clip (this check assumes it)');

if (failures) {
  console.error(`\n${failures} focus-ring check(s) failed`);
  process.exit(1);
}
console.log('focus rings: all checks pass');
