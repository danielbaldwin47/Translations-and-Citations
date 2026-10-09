#!/usr/bin/env node
/*
 * No-build sanity checks for the options form's pure core. Run:
 *   node tools/validate-options-form.js
 *
 * src/options/options.js exports the decisions the form makes that are not
 * about the DOM (the shell is skipped when `document` is undefined): which
 * versions lead the list and which are duplicates, which start checked, which
 * default wins, where a refreshed list's rows go, what an autosave may write
 * and retry, which controls a change arriving from another context may
 * repaint, when Connect rests, the language search, and the status copy.
 * Those are the rules the stale-list and wrong-default bugs lived in.
 *
 * It also checks where the in-product disclosures (C.DISCLOSURE) sit: beside
 * Connect and beside adding a Church language, on this page and on the
 * panel's setup card (src/content/panel.js setupCopy / renderSetup).
 *
 * It also covers the worker's side of what the page is told
 * (src/background/api.js, loaded in Node against a stubbed fetch): a
 * `partial` version list, and a 429's `remote` flag and Retry-After wait.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'src/options/options.js'));
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const S = require(path.join(ROOT, 'src/shared/settings.js'));

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}
const ids = (rows) => rows.map((t) => t.id);

// Rows shaped like api.bible's, copyright lines as the live list returns them.
const ARR = 'Copyright © 2011 by Biblica, Inc. All rights reserved worldwide.';
const NIRV = { id: 'nirv', abbr: 'NIrV', name: "New International Reader's Version", description: 'Holy Bible', copyright: ARR };
const NIV = { id: 'niv', abbr: 'NIV', name: 'New International Version', description: 'Holy Bible', copyright: ARR };
const NKJV = { id: 'nkjv', abbr: 'NKJV', name: 'New King James Version', description: '', copyright: 'Copyright© 1982, Thomas Nelson. All rights reserved.' };
const KJV = { id: 'kjv', abbr: 'KJV', name: 'King James Version', description: 'Protestant', copyright: 'PUBLIC DOMAIN' };
const WEBU = 'No copyright, but "World English Bible" is a Trademark of eBible.org';
const WEBU1 = { id: 'webu-01', abbr: 'WEBU', name: 'World English Bible Updated', description: 'Ecumenical', copyright: WEBU };
const WEBU2 = { id: 'webu-02', abbr: 'WEBU', name: 'World English Bible Updated', description: 'Protestant', copyright: WEBU };
const WEBU3 = { id: 'webu-03', abbr: 'WEBU', name: 'World English Bible Updated', description: 'Catholic', copyright: WEBU };
const OKE = { id: 'oke', abbr: 'OKE', name: 'Targum Onkelos Etheridge', description: 'common', copyright: 'J. W. Etheridge, The Targums of Onkelos (London, 1862).' };
const KEY_LIST = [NIRV, NIV, NKJV, OKE, KJV, WEBU1, WEBU2, WEBU3];

// ---- isAdded / versionGroups / dedupeVersions: what leads the list ----
console.log('versionGroups:');
check(F.isAdded(NIV) && F.isAdded(NKJV), '"All rights reserved" marks a version the reader added to the key');
check(!F.isAdded(KJV) && !F.isAdded(WEBU1) && !F.isAdded(OKE), 'public-domain, "No copyright" and bare citations are the free tier');
check(!F.isAdded({ id: 'x' }), 'a row with no copyright is not "added"');
// A partial list: rows the worker couldn't look up carry no copyright.
const bare = (r) => Object.assign({}, r, { copyright: '' });
check(!F.isAdded(bare(NIV)), 'a full list: no copyright, not added');
check(F.isAdded(bare(NIV), true) && F.isAdded(bare(NIRV), true) && F.isAdded(bare(NKJV), true),
  'a partial list: a bare NIV, NIrV or NKJV counts as added (C.DEFAULT_ABBRS or NIrV)');
check(!F.isAdded(bare(OKE), true) && !F.isAdded(bare(WEBU1), true), 'a partial list: other bare rows stay free');
check(!F.isAdded(KJV, true), 'a partial list: a row whose copyright was looked up is still judged by it');

eq(ids(F.dedupeVersions([WEBU1, WEBU2, WEBU3])), ['webu-02'],
  'one row per abbreviation + name, preferring the Protestant edition');
eq(ids(F.dedupeVersions([WEBU1, WEBU2, WEBU3], ['webu-03'])), ['webu-03'],
  'an edition the reader has on outranks the Protestant one');
eq(ids(F.dedupeVersions([WEBU1, WEBU2, WEBU3], ['webu-01', 'webu-02'])), ['webu-02'],
  'among editions they have on, the Protestant one');
eq(ids(F.dedupeVersions([{ id: 'a', abbr: 'BSB', name: 'Berean' }, { id: 'b', abbr: 'BSB', name: 'Berean' }])), ['a'],
  'no Protestant edition and none on: the first listed');
eq(ids(F.dedupeVersions([NIV, NKJV])), ['niv', 'nkjv'], 'distinct versions are all kept, in list order');

const g = F.versionGroups(KEY_LIST, []);
eq([ids(g.yours), ids(g.more)], [['nirv', 'niv', 'nkjv'], ['oke', 'kjv', 'webu-02']],
  'the versions added to the key lead; the free ones wait under "more", deduped');
const gOn = F.versionGroups(KEY_LIST, ['niv', 'oke']);
eq([ids(gOn.yours), ids(gOn.more)], [['nirv', 'niv', 'nkjv', 'oke'], ['kjv', 'webu-02']],
  'a free version the reader has on leads too, so everything the panel offers is in view');
eq(F.versionGroups([], []), { yours: [], more: [] }, 'no list, no groups');
const PARTIAL_LIST = [bare(NIRV), NIV, bare(NKJV), bare(OKE), KJV];
const gPart = F.versionGroups(PARTIAL_LIST, [], true);
eq([ids(gPart.yours), ids(gPart.more)], [['nirv', 'niv', 'nkjv'], ['oke', 'kjv']],
  'a partial list still leads with the versions a reader adds, by abbreviation');

// ---- stableGroups: a refreshed list never reshuffles the screen ----
console.log('stableGroups:');
const SHOWN = { yours: ['niv', 'nkjv', 'oke'], more: ['kjv', 'webu-02'] };
const sg = F.stableGroups(SHOWN, [NIRV, NIV, NKJV, OKE, KJV, WEBU1, WEBU2, WEBU3], ['niv', 'nkjv']);
eq([ids(sg.yours), ids(sg.more)], [['niv', 'nkjv', 'oke'], ['kjv', 'webu-02', 'nirv']],
  'rows keep their group and place (OKE stays with yours though now off); a new row, even an added one, joins the end of "more"');
const sgGone = F.stableGroups(SHOWN, [NIV, OKE, KJV], ['niv']);
eq([ids(sgGone.yours), ids(sgGone.more)], [['niv', 'oke'], ['kjv']], 'a row the list no longer has drops out, the rest stay put');
eq(F.stableGroups(null, KEY_LIST, ['oke']), F.versionGroups(KEY_LIST, ['oke']), 'nothing on screen yet: versionGroups decides');
eq(F.stableGroups({ yours: [], more: [] }, PARTIAL_LIST, [], true), gPart, 'an empty screen groups afresh, guesses and all');

// ---- mergeVersions: a refresh keeps copyrights it couldn't look up ----
console.log('mergeVersions:');
eq(F.mergeVersions([NIV, KJV], [bare(NIV), KJV, NKJV]), [NIV, KJV, NKJV],
  'a row the refresh left bare takes the copyright the screen had; the rest are the refresh\'s');
eq(F.mergeVersions([], [bare(NIV)]), [bare(NIV)], 'nothing known: the refresh as it came');
eq(F.mergeVersions([NIV], undefined), [], 'no refresh rows: no rows');

// ---- listGuesses: a partial answer guesses only where it still must ----
console.log('listGuesses:');
check(F.listGuesses([bare(NIV), KJV], true), 'a partial list with a row still bare has to guess');
check(!F.listGuesses(F.mergeVersions([NIV, KJV], [bare(NIV), KJV]), true),
  'a partial recheck of a known list: every copyright is back, nothing is a guess (rows stay in their groups)');
check(!F.listGuesses([bare(NIV)], false), 'a full list never guesses, bare rows and all (they are simply free)');
check(!F.listGuesses([], true), 'no rows, no guess');

// ---- withStored: a cached list never hides a stored version ----
console.log('withStored:');
eq(ids(F.withStored([NIV, NKJV], [NIV, { id: 'nasb', abbr: 'NASB', name: 'NASB' }])), ['niv', 'nkjv', 'nasb'],
  'a stored version missing from the (possibly day-old) list rides along at the end');
eq(ids(F.withStored([NIV], undefined)), ['niv'], 'no stored list adds nothing');
eq(ids(F.withStored([NIV], [NIV, { id: 'engwebp', abbr: 'WEB', name: 'World English Bible', provider: 'bundled' }])), ['niv'],
  'the bundled World English Bible is not an api.bible version: it never joins the checklist');

// ---- initialChecks: which versions start checked when a key connects ----
console.log('initialChecks:');
eq(F.initialChecks(KEY_LIST, [], true), ['nirv', 'niv', 'nkjv'],
  'first connect: exactly the versions added to the key, none of the free ones');
eq(F.initialChecks(KEY_LIST, [NKJV], false), ['nkjv'], 'the stored key: its stored selection decides');
eq(F.initialChecks(KEY_LIST, [], false), [],
  'the stored key with nothing on stays that way (the reader turned everything off)');
eq(F.initialChecks(KEY_LIST, [NKJV, { id: 'gone' }], true), ['nkjv'],
  'a new key keeps whatever of the stored selection it also has');
eq(F.initialChecks(KEY_LIST, [{ id: 'esv' }], true), ['nirv', 'niv', 'nkjv'],
  'a new key sharing nothing with the stored selection starts from its added versions');
eq(F.initialChecks([], [NIV], true), [], 'no versions -> nothing checked');
eq(F.initialChecks([NIV, NKJV], [NKJV, NIV], false), ['niv', 'nkjv'], 'checks come back in list order');
eq(F.initialChecks(PARTIAL_LIST, [], true, true), ['nirv', 'niv', 'nkjv'],
  'first connect on a partial list: the versions a reader adds are checked, not none');
eq(F.initialChecks(PARTIAL_LIST, [], true, false), ['niv'], 'the same list read as full checks only what says "All rights reserved"');

// ---- pickDefaultId: which default survives ----
console.log('pickDefaultId:');
eq(C.DEFAULT_ABBRS[0], 'NIV', 'NIV is the preferred default');
eq(F.pickDefaultId([NIV, NKJV], 'nkjv'), 'nkjv', 'a wanted id that is enabled wins');
eq(F.pickDefaultId([NIRV, NIV, NKJV], ''), 'niv', 'no wanted id: NIV over NIrV, which merely sorts first');
eq(F.pickDefaultId([NIRV, NKJV], 'esv'), 'nkjv', 'a wanted id that is not enabled: the next preferred abbreviation');
eq(F.pickDefaultId([NIRV, OKE], ''), 'nirv', 'nothing preferred on: the first enabled');
eq(F.pickDefaultId([], 'niv'), '', 'nothing enabled -> no default');
eq(F.pickDefaultId([NIV], undefined), 'niv', 'an undefined wanted id is not a crash');

// ---- translationPatch: what a write may say about the list ----
console.log('translationPatch:');
eq(F.translationPatch({ versionsLoaded: false, enabled: [], defaultId: '' }), {},
  'no list on screen writes nothing (the stored list is not wiped)');
eq(F.translationPatch({ versionsLoaded: false, enabled: [NIV], defaultId: 'niv' }), {},
  'even with checkboxes on screen, an unloaded list writes nothing');
eq(F.translationPatch({ versionsLoaded: true, enabled: [NIV, NKJV], defaultId: 'nkjv' }),
  { enabledTranslations: [NIV, NKJV], defaultTranslationId: 'nkjv' },
  'a loaded list writes both keys');
eq(F.translationPatch({ versionsLoaded: true, enabled: [NIRV, NIV], defaultId: 'esv' }),
  { enabledTranslations: [NIRV, NIV], defaultTranslationId: 'niv' },
  'a default that is no longer enabled is repaired to the preferred one, not saved');
eq(F.translationPatch({ versionsLoaded: true, enabled: [], defaultId: 'niv' }),
  { enabledTranslations: [], defaultTranslationId: '' },
  'turning every translation off saves an empty list');

// ---- commitPatch: what one autosave writes ----
console.log('commitPatch:');
const LOADED = { versionsLoaded: true, enabled: [NIV, NKJV], defaultId: 'nkjv' };
eq(F.commitPatch({ keys: ['sidebarWidth'], values: { sidebarWidth: '520' }, list: LOADED }), { sidebarWidth: '520' },
  'a single field writes just that field');
eq(F.commitPatch({ keys: ['scrollSync', 'churchLanguages'], values: { scrollSync: false, churchLanguages: ['spa'], fontScale: 1.2 }, list: LOADED }),
  { scrollSync: false, churchLanguages: ['spa'] },
  'several queued fields write together, and only the ones named');
eq(F.commitPatch({ keys: ['enabledTranslations'], values: {}, list: LOADED }),
  { enabledTranslations: [NIV, NKJV], defaultTranslationId: 'nkjv' },
  'a checkbox in the list writes the list and its default through translationPatch');
eq(F.commitPatch({ keys: ['defaultTranslationId'], values: { defaultTranslationId: 'x' }, list: LOADED }),
  { enabledTranslations: [NIV, NKJV], defaultTranslationId: 'nkjv' },
  'the default select writes through translationPatch too, never its raw value');
eq(F.commitPatch({ keys: ['enabledTranslations'], values: {}, list: { versionsLoaded: false, enabled: [], defaultId: '' } }), {},
  'the list guard holds under autosave: nothing on screen, nothing written');
eq(F.commitPatch({ keys: ['fontScale'], values: {}, list: LOADED }), {}, 'a key with no value read writes nothing');

// ---- patchLanded: did the write stick? ----
console.log('patchLanded:');
const before = S.normalize({ sidebarWidth: 380, scrollSync: true });
const after = S.normalize({ sidebarWidth: 520, scrollSync: true });
check(F.patchLanded(after, { sidebarWidth: '520' }, S.normalize), 'the returned settings hold the (normalized) value -> landed');
check(!F.patchLanded(before, { sidebarWidth: '520' }, S.normalize),
  'a failed write resolves with the old settings -> not landed');
check(F.patchLanded(before, { scrollSync: true }, S.normalize), 'rewriting the value already stored has landed');
check(F.patchLanded(before, { notASetting: 1 }, S.normalize), 'a key the schema drops is not held against the write');
const fatNiv = Object.assign({}, NIV, { provider: 'api.bible' });
check(F.patchLanded(S.normalize({ enabledTranslations: [fatNiv] }), { enabledTranslations: [fatNiv] }, S.normalize),
  'a list written with copyrights landed once storage holds it slim');

// ---- failedWrites: what "Try again" sends ----
console.log('failedWrites:');
const f1 = F.failedWrites(null, { enabledTranslations: [NIV], defaultTranslationId: 'niv' }, ['enabledTranslations', 'defaultTranslationId']);
eq(f1, { partial: { enabledTranslations: [NIV], defaultTranslationId: 'niv' }, keys: ['enabledTranslations', 'defaultTranslationId'] },
  'the first failure is kept whole');
const f2 = F.failedWrites(f1, { churchLanguages: ['spa'] }, ['churchLanguages']);
eq(f2.keys, ['enabledTranslations', 'defaultTranslationId', 'churchLanguages'], 'a later failure adds its keys (a union, not the last one)');
eq(Object.keys(f2.partial), ['enabledTranslations', 'defaultTranslationId', 'churchLanguages'], '...and its values');
const f3 = F.failedWrites(f2, { enabledTranslations: [NIV, NKJV], defaultTranslationId: 'niv' }, ['enabledTranslations', 'defaultTranslationId']);
eq(f3.partial.enabledTranslations, [NIV, NKJV], 'the same key failing again keeps the value last asked for');
eq(f3.keys.length, 3, 'without naming the key twice');

// ---- keyControls: when Connect rests ----
console.log('keyControls:');
const kc = (o) => F.keyControls(Object.assign({ field: 'k1', storedKey: 'k1', keyState: 'connected', partial: false }, o));
eq(kc({}), { connect: false, recheck: true },
  'the connected key: Connect rests (a refetch costs ~39 calls); "Check for new translations" offers the refresh');
eq(kc({ partial: true }), { connect: true, recheck: true }, 'the connected key with a partial list: Connect is offered again, as the note says');
eq(kc({ field: 'k2' }), { connect: true, recheck: false }, 'another key in the field: Connect');
eq(kc({ storedKey: '' , keyState: 'none' }), { connect: true, recheck: false }, 'a first key: Connect');
eq(kc({ field: '' }), { connect: false, recheck: false }, 'an empty field: nothing to connect');
eq(kc({ keyState: 'checking' }), { connect: false, recheck: false }, 'while checking a key with nothing listed yet: neither');
eq(kc({ keyState: 'checking', listed: true }), { connect: false, recheck: true },
  'while the connected key\'s list is rechecked: "Check for new translations" stays (a keyboard reader on it keeps focus)');
eq(kc({ field: 'k2', keyState: 'checking', listed: true }), { connect: false, recheck: false }, 'while another key is checked: neither');
eq(kc({ field: 'k1', keyState: 'error' }), { connect: true, recheck: false }, 'the stored key after an error: Connect retries it');

// ---- fillPlan: what an incoming change is allowed to repaint ----
console.log('fillPlan:');
const FIELD_KEYS = ['apiKey', 'scrollSync', 'sidebarWidth'];
const plan = (changed, dirty) => F.fillPlan({ fieldKeys: FIELD_KEYS, changed, dirty: new Set(dirty) });

eq(plan(null, []), { fields: FIELD_KEYS, relist: true, reselect: false },
  'the initial fill (no `changed`) paints every field and the list');
eq(plan(['scrollSync'], []), { fields: ['scrollSync'], relist: false, reselect: false },
  'a single-value change repaints only that control');
eq(plan(['enabledTranslations'], []), { fields: [], relist: true, reselect: false },
  'an external list change repaints the list');
eq(plan(['defaultTranslationId'], []), { fields: [], relist: false, reselect: true },
  'an external default change repaints just the select');
eq(plan(['enabledTranslations', 'defaultTranslationId'], []),
  { fields: [], relist: true, reselect: false },
  'a relist rebuilds the select too, so reselect is not asked for as well');
eq(plan(['panelMode', 'panelCollapsed'], []), { fields: [], relist: false, reselect: false },
  'settings this form does not edit repaint nothing');

// Changes on screen and not yet written outrank a change arriving from elsewhere.
eq(plan(['sidebarWidth'], ['sidebarWidth']), { fields: [], relist: false, reselect: false },
  'a slider mid-drag is left alone');
eq(plan(['enabledTranslations'], ['enabledTranslations']), { fields: [], relist: false, reselect: false },
  'checkboxes waiting to be written are left alone');
eq(plan(['defaultTranslationId'], ['defaultTranslationId']), { fields: [], relist: false, reselect: false },
  'a default waiting to be written is left alone');
eq(plan(['enabledTranslations'], ['defaultTranslationId']), { fields: [], relist: false, reselect: false },
  'a relist would rebuild the dirty select, so it waits too');
eq(plan(null, ['scrollSync', 'enabledTranslations']),
  { fields: FIELD_KEYS, relist: true, reselect: false },
  'the initial fill predates any edit, so dirt does not hold it back');

// ---- copy ----
console.log('Copy:');
eq(F.versionLabel(NIV), 'NIV — New International Version', 'a version reads "abbreviation — name"');
eq(F.versionLabel({ id: 'x', abbr: '', name: 'Solo' }), 'Solo', 'no abbreviation: the name alone');
eq(F.moreLabel(23), '23 more free translations', 'the "more" summary counts');
eq(F.moreLabel(1), '1 more free translation', 'and pluralizes');
eq(F.connectedText([NIV, NKJV, NIRV]), 'Connected — 3 translations: NIV, NKJV, NIrV', 'connected, with what the panel offers');
eq(F.connectedText([NIV]), 'Connected — 1 translation: NIV', 'one translation is singular');
eq(F.connectedText([NIV, NKJV, NIRV, OKE, KJV]), 'Connected — 5 translations: NIV, NKJV, NIrV, OKE, KJV', 'up to five are named');
eq(F.connectedText([NIV, NKJV, NIRV, OKE, KJV, WEBU1]), 'Connected — 6 translations', 'more than five are counted, so the line stays a line');
eq(F.connectedText([]), 'Connected. Choose the translations to show in the panel.', 'connected with nothing on says what to do');
// api.bible's own pages, as verified on 2026-10-09 (spec #101): the free
// account, and the dashboard that holds the key and the Bibles on it.
eq(C.API_BIBLE_PAGES, { signUp: 'https://api.bible/sign-up', dashboard: 'https://api.bible/team' },
  'api.bible\'s sign-up and dashboard addresses, with no redirect');
// yoursNote is linked text: strings, and { text, href } for a link.
eq(F.yoursNote({ partial: true, yours: 3 }), ['Couldn’t check which translations are yours. Try Connect again later.'],
  'a partial list owns up to its guess, whatever it guessed');
eq(F.yoursNote({ partial: true, yours: 0 }), F.yoursNote({ partial: true, yours: 3 }),
  'a partial list never claims the key has no copyrighted translations');
eq(F.yoursNote({ partial: false, yours: 0 }), [
  'This key has no NIV, NKJV or other copyrighted translations yet. Add them in your ',
  { text: 'api.bible dashboard', href: 'https://api.bible/team' },
  ' (Plan, then Edit Plan, then Edit Bible Licenses), then choose Check for new translations — or turn on a free one below.',
], 'an empty "yours" links the dashboard, names the path there, and refills through the button that refetches (Connect rests on a connected key)');
eq(F.yoursNote({ partial: false, yours: 2 }), [], 'a full list with versions in "yours" needs no note');
const bad = 'api.bible didn’t accept that key. Check that you copied all of it.';
eq(F.keyErrorText({ code: C.ERR.INVALID_KEY }), bad, 'a wrong key says so in plain words');
eq(F.keyErrorText({ code: C.ERR.FORBIDDEN }), bad, 'a 403 on the list is a key problem too');
eq(F.keyErrorText({ code: C.ERR.NETWORK, message: 'Failed to fetch' }), 'Couldn’t reach api.bible. Check your connection and try again.',
  'offline says to check the connection');
eq(F.keyErrorText({ code: C.ERR.RATE_LIMITED }), 'api.bible is busy. Try again in a minute.', 'rate-limited says to wait');
eq(F.keyErrorText({ code: C.ERR.UNKNOWN, message: 'HTTP 500' }), 'Couldn’t check the key (HTTP 500). Try again.',
  'anything else names what happened, never a bare error code');
eq(F.keyErrorText(undefined), 'Couldn’t check the key (no answer). Try again.', 'no response at all is still a sentence');
for (const code of Object.values(C.ERR)) {
  check(!/^[A-Z_]+$/.test(F.keyErrorText({ code })) && !new RegExp(`^Error: `).test(F.keyErrorText({ code })),
    `${code} reads as a sentence`);
}

// ---- Church languages ----
console.log('Church languages:');
const offered = F.offeredLanguages(C.CHURCH_LANGUAGES);
check(!offered.some((l) => l.code === 'eng'), 'English is not offered (the reader is already in English)');
eq(offered.length, C.CHURCH_LANGUAGES.length - 1, 'every other language is');

const ALL5 = ['ot', 'nt', 'bofm', 'dc-testament', 'pgp'];
const groups = F.languageGroups([
  { code: 'spa', vols: ALL5 }, { code: 'ara', vols: ['ot', 'nt', 'bofm'] }, { code: 'jpn', vols: ALL5 },
  { code: 'tgl', vols: ['bofm', 'dc-testament', 'pgp'] }, { code: 'mya', vols: ['bofm'] }, { code: 'meu', vols: ['ot', 'nt'] },
  { code: 'ssw', vols: ['bofm', 'dc-testament'] },
]);
eq(groups.map((x) => [x.label, x.langs.map((l) => l.code)]), [
  ['All standard works', ['spa', 'jpn']],
  ['Bible and Book of Mormon', ['ara']],
  ['Book of Mormon, Doctrine and Covenants and Pearl of Great Price', ['tgl']],
  ['Book of Mormon', ['mya']],
  ['Bible', ['meu']],
  ['Book of Mormon and Doctrine and Covenants', ['ssw']],
], 'languages group by what they publish, in first-seen order, keeping table order inside a group');
eq(F.languageGroups(undefined), [], 'no table, no groups');
eq(F.languageGroups(offered).reduce((n, x) => n + x.langs.length, 0), offered.length,
  'every offered language lands in exactly one group');
eq(F.groupCount(groups[0]), '2 languages', 'a group summary counts its languages');
eq(F.groupCount(groups[1]), '1 language', 'and pluralizes');
eq(F.groupCount(groups[0], 1), '1 of 2 languages', 'while searching, it counts the matches left in view');
eq(F.groupCount(groups[0], 2), '2 languages', 'a search that leaves the whole group reads as no search');
eq(F.groupCount(groups[0], null), '2 languages', 'no search: the plain count');
check(F.languageGroups(offered).every((x) => !/&/.test(x.label)), 'group labels name books in full ("Doctrine and Covenants", never "D&C")');

// The list the reader sees: "Your languages" on top, then the coverage groups
// without them, each row carrying its match against the search.
const list = (enabled, q) => F.languageList(offered, enabled, q);
const codesOf = (section) => section.rows.map((r) => r.lang.code);
const noneEnabled = list([], '');
eq(noneEnabled.map((x) => x.label), F.languageGroups(offered).map((x) => x.label),
  'with none enabled there is no "Your languages" section, only the coverage groups');
check(noneEnabled.every((x) => !x.yours), 'and no section is the reader\'s own');
eq(noneEnabled.map(codesOf), F.languageGroups(offered).map((x) => x.langs.map((l) => l.code)),
  'the coverage groups are today\'s, unchanged');
const tableOrder = offered.map((l) => l.code);
const picked = ['jpn', 'spa', 'tgl'].filter((c) => tableOrder.indexOf(c) >= 0);
const withYours = list(['tgl', 'spa', 'jpn'], '');
eq(withYours[0].label, 'Your languages', '"Your languages" comes first');
check(withYours[0].yours === true && withYours.slice(1).every((x) => !x.yours), 'and only it is the reader\'s own');
eq(codesOf(withYours[0]), tableOrder.filter((c) => picked.indexOf(c) >= 0),
  '"Your languages" holds exactly the enabled languages, in table order (not the order they were ticked)');
check(withYours.slice(1).every((x) => codesOf(x).every((c) => picked.indexOf(c) < 0)),
  'enabled languages leave their coverage groups');
eq(withYours.slice(1).reduce((n, x) => n + x.rows.length, 0), offered.length - picked.length,
  'every other language is still in exactly one coverage group');
eq(withYours.slice(1).map((x) => x.label), F.languageGroups(offered.filter((l) => picked.indexOf(l.code) < 0)).map((x) => x.label),
  'a coverage group left empty by the move is gone, the others keep their order');
eq(list(['xx-not-a-language'], '').map((x) => x.label), noneEnabled.map((x) => x.label), 'a code the table lacks enables nothing');
eq(list(undefined, undefined).map((x) => x.label), noneEnabled.map((x) => x.label), 'no enabled list, no search: the plain groups');
eq(F.languageList(undefined, ['spa'], ''), [], 'no table, no list');
// Unticking: the language is back in its own coverage group.
const spaGroup = noneEnabled.find((x) => codesOf(x).indexOf('spa') >= 0).label;
const afterTick = list(['spa'], '');
eq(codesOf(afterTick[0]), ['spa'], 'ticking Español puts it under "Your languages"');
check(!afterTick.slice(1).some((x) => codesOf(x).indexOf('spa') >= 0), 'and out of its coverage group');
const afterUntick = list([], '');
check(codesOf(afterUntick.find((x) => x.label === spaGroup)).indexOf('spa') >= 0, 'unticking it sends it back to its coverage group');
// The search runs over both parts.
const found = list(['spa', 'jpn'], 'espanol');
eq(found[0].rows.map((r) => [r.lang.code, r.hit]), [['jpn', false], ['spa', true]].sort((a, b) => tableOrder.indexOf(a[0]) - tableOrder.indexOf(b[0])),
  'a search matches rows under "Your languages"');
check(found.slice(1).every((x) => x.rows.every((r) => !r.hit)), 'and a language outside it is a miss');
const foundBoth = list(['spa'], 'portu');
check(foundBoth[0].rows.every((r) => !r.hit) && foundBoth.slice(1).some((x) => x.rows.some((r) => r.lang.code === 'por' && r.hit)),
  'a search matches rows in the coverage groups too, at once');
eq(foundBoth[0].shown, 0, 'a section counts the rows its search leaves in view');
eq(foundBoth.reduce((n, x) => n + x.shown, 0), foundBoth.reduce((n, x) => n + x.rows.filter((r) => r.hit).length, 0), 'shown is the count of hits');
check(list(['spa'], '').every((x) => x.shown === x.rows.length && x.rows.every((r) => r.hit)), 'no search: every row is a hit');
eq(F.groupCount(withYours[0], withYours[0].shown), plural1(withYours[0].rows.length), 'the section\'s count reads like a group\'s');

// A tick during a search: the search clears and focus follows the language to
// its new place (tester 16).
const tick = (before, after, q) => F.languageTick(offered, before, after, q);
const jpnTick = tick([], ['jpn'], 'jap');
eq(jpnTick.search, '', 'ticking 日本語 during a search answers an empty search');
eq(jpnTick.focus, 'jpn', 'and focus stays on 日本語');
eq(jpnTick.place, { yours: true, label: 'Your languages' }, 'whose new place is under "Your languages"');
eq(tick(['spa'], ['spa', 'jpn'], 'jap').place, { yours: true, label: 'Your languages' }, 'also when "Your languages" already holds others');
const spaUntick = tick(['spa'], [], 'esp');
eq(spaUntick.search, '', 'unticking during a search clears it too');
eq(spaUntick.focus, 'spa', 'focus follows the language');
eq(spaUntick.place, { yours: false, label: spaGroup }, 'back to its own coverage group');
eq(spaUntick.openGroup, spaGroup, 'and that group is opened, so the checkbox itself keeps focus');
eq(jpnTick.openGroup, null, 'a tick needs no group opened ("Your languages" is always open)');
eq(tick(['spa', 'jpn'], ['spa'], '').place.label, F.languageList(offered, ['spa'], '').find((x) => codesOf(x).indexOf('jpn') >= 0).label,
  'with no search, an untick still names the language\'s coverage group');
eq(tick([], ['jpn'], '').search, '', 'a tick with no search leaves the search empty');
eq(tick([], ['jpn'], '  ').search, '', 'a blank search is cleared to empty');
const same = tick(['spa'], ['spa'], 'esp');
eq([same.search, same.focus, same.place, same.openGroup], ['esp', null, null, null],
  'a change event that leaves the enabled set as it was keeps the search and moves nothing');
eq(tick(['spa'], ['spa'], '').search, '', 'no change, no search: still empty');
eq(tick(['spa', 'jpn'], ['spa', 'jpn'], 'x').search, 'x', 'the enabled set compares as a set, not by order');
eq(tick(['spa', 'jpn'], ['jpn', 'spa'], 'x').focus, null, 'a reorder alone is no tick');
eq(tick([], ['xx-not-a-language'], 'jap'), { search: 'jap', focus: null, place: null, openGroup: null },
  'a code the table lacks changes nothing the reader can see');
eq(tick(undefined, ['jpn'], 'jap').focus, 'jpn', 'no earlier set counts as none enabled');
check(!list(['spa'], '').some((x) => /common|popular|featured|suggested/i.test(x.label)),
  'no featured group exists: no language is set above another');
function plural1(n) { return n === 1 ? '1 language' : `${n} languages`; }

const lang = (code) => C.CHURCH_LANGUAGES.find((l) => l.code === code);
check(F.matchesLanguage(lang('spa'), 'espanol'), 'the search ignores accents (espanol finds Español)');
check(F.matchesLanguage(lang('spa'), 'SPAN'), 'and case, and matches the English name');
check(F.matchesLanguage(lang('por'), 'port'), 'a prefix finds Português');
check(F.matchesLanguage(lang('jpn'), '日本'), 'the native script finds 日本語');
check(F.matchesLanguage(lang('kek'), 'qeqchi'), 'apostrophes and modifier letters are ignored (qeqchi finds Q’eqchi’)');
check(F.matchesLanguage(lang('haw'), 'olelo'), 'ʻokina and macrons are ignored (olelo finds ʻŌlelo Hawaiʻi)');
check(F.matchesLanguage(lang('tgl'), 'tgl'), 'the code matches');
check(F.matchesLanguage(lang('tgl'), '  '), 'an empty search matches everything');
check(!F.matchesLanguage(lang('spa'), 'xyz'), 'a miss is a miss');
check(C.CHURCH_LANGUAGES.every((l) => /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/.test(l.tag || '')),
  'every Church language carries a BCP 47 tag for marking up its own name');
eq(['jpn', 'zhs', 'zho', 'yue', 'kor'].map((c) => lang(c).tag), ['ja', 'zh-Hans', 'zh-Hant', 'yue-Hant', 'ko'],
  'CJK names are tagged so the browser picks the right glyphs');

// ---- aboutCopy: the About card (spec #69, A10, A28) ----
// What the card says, as text: version, pack vintage, source lines, links.
console.log('aboutCopy:');
const BYU_LINE = 'Citation data compiled with reference to the BYU Scripture Citation Index. '
  + 'Not affiliated with or endorsed by BYU or The Church of Jesus Christ of Latter-day Saints.';
const JOD_LINE = 'Journal of Discourses text: Wikisource, public domain';
// ebible.org's copyright page for the engwebp edition, word for word.
const WEB_LINE = 'The World English Bible is in the Public Domain. That means that it is not copyrighted. '
  + 'However, "World English Bible" is a Trademark of eBible.org.';
const about = F.aboutCopy({ version: '1.0.0', pack: { flavor: 'public', vintage: '2026-10' } });
eq(about.version, 'Version 1.0.0', 'the version line names the manifest version');
eq(about.vintage, 'Citations through October 2026', 'the pack vintage reads as the Citations footer does');
eq(F.aboutCopy({ version: '1.0.0', pack: null }).vintage, null, 'no pack found: no vintage line');
eq(F.aboutCopy({ version: '1.0.0', pack: { vintage: 'soon' } }).vintage, null, 'an unreadable vintage: no vintage line');
eq(about.sources, [BYU_LINE, JOD_LINE, WEB_LINE],
  'the source lines: BYU compiled source with the not-affiliated line, Wikisource, the World English Bible wording');
eq(about.links.map((l) => l.label), ['Support'], 'the card\'s links row is Support (the policy sits in "Your data")');
check(about.links.every((l) => /^https:\/\/\S+$/.test(l.href)), 'the links are https URLs');
eq(about.links[0].href, 'https://github.com/danielbaldwin47/Translations-and-Citations/issues',
  'support defaults to the repository\'s issues (owner decision, spec #69 Further Notes)');

// "Your data" (#128): three short lists from C.ABOUT.yourData, then the policy
// with its address as the link's text. A site line leads with what it is for;
// its hostnames follow.
const yours = about.yourData;
eq(yours.title, 'Your data', 'the section is headed "Your data"');
eq(yours.lists.map((l) => l.head), ['On this computer', 'Synced through your Chrome account', 'Sites it contacts'],
  'three lists: on this computer, synced, sites');
eq(yours.lists, [C.ABOUT.yourData.local, C.ABOUT.yourData.synced, C.ABOUT.yourData.sites].map((l) => ({
  head: l.head, items: l.items.map((i) => (typeof i === 'string' ? { text: i, hosts: [] } : i)),
})), 'every list renders from C.ABOUT.yourData, in order; a plain line has no hostnames');
const [localList, syncedList, sitesList] = yours.lists;
const listText = (l) => l.items.map((i) => i.text).join(' | ');
for (const [what, re] of [['highlights', /highlight/i], ['cached chapters', /chapters/i], ['the cached version list', /list of translations/i],
  ['the usage report\'s device id', /\bid\b[\s\S]*usage report/i], ['the monthly count', /this month/i], ['the pick memory', /picked/i]]) {
  check(re.test(listText(localList)), `"On this computer" names ${what}`);
}
check(/settings/i.test(listText(syncedList)) && /api\.bible key/.test(listText(syncedList)) && /languages/i.test(listText(syncedList)),
  '"Synced" names the settings, the api.bible key and the languages');
eq(sitesList.items.map((i) => i.hosts), [['www.churchofjesuschrist.org'], ['scriptures.byu.edu'], ['rest.api.bible', 'fums.api.bible']],
  'the sites, by full hostname, Church site first');
check(sitesList.items.every((i) => i.text && i.hosts.every((h) => i.text.indexOf(h) < 0)),
  'each site line leads with a plain description; its hostnames are shown beside it, not in it');
check(/only once you connect a key/i.test(sitesList.items[2].text), 'api.bible is contacted only once you connect a key');
check(yours.lists.every((l) => l.items.every((i) => i.text.length <= 100)), 'every line is short (100 characters at most)');
eq(yours.policy.href, C.ABOUT.privacyUrl, 'the section ends with the privacy policy');
eq(yours.policy.text, C.ABOUT.privacyUrl.replace(/^https:\/\//, ''), 'the policy link\'s text is its address');
check(/privacy policy/i.test(yours.policy.label), 'the address is labelled as the privacy policy');
const settingKeys = Object.keys(S.defaults());
check(!Object.keys(about).some((k) => settingKeys.indexOf(k) >= 0), 'nothing the About card shows is a setting');

// "Show the welcome again" (#115): the one control on the About card. Its write
// is the welcome-seen flag false; the welcome then shows by its ordinary due rule.
eq(F.WELCOME_AGAIN.label, 'Show the welcome again', 'the About card\'s button reads "Show the welcome again"');
eq(F.WELCOME_AGAIN.patch, { welcomeSeen: false }, '...and its write is the welcome-seen flag false, nothing else');
check(settingKeys.indexOf('welcomeSeen') >= 0 && S.normalize(F.WELCOME_AGAIN.patch).welcomeSeen === false,
  '...a key __BTX.settings owns, which its normalizer keeps false');
// All or nothing: its own line under the button says which half failed, and
// pressing the button again is the retry (both halves, in order). It never
// joins the page's "Couldn't save" retry, which would re-send the flag alone.
eq(F.welcomeAgainError({ saved: false }), 'Couldn’t show the welcome. Try again.',
  'the flag didn\'t save: the line says the welcome didn\'t come (no tab was asked for)');
eq(F.welcomeAgainError({ saved: true, reply: { ok: true } }), null, 'saved and the tab opened: no line');
for (const reply of [{ error: { code: 'UNKNOWN', message: 'x' } }, null, undefined, {}]) {
  eq(F.welcomeAgainError({ saved: true, reply }), 'Couldn’t open the welcome tab. Try again.',
    `saved but the worker answered ${JSON.stringify(reply)}: the line says the tab didn't open`);
}

// ---- the DOM shell stays out of Node ----
console.log('Shell:');
eq(Object.keys(F).sort(), [
  'aboutCopy', 'commitPatch', 'connectedText', 'dedupeVersions', 'failedWrites', 'fillPlan', 'groupCount', 'initialChecks', 'isAdded',
  'keyControls', 'keyErrorText', 'languageGroups', 'languageList', 'languageTick', 'listGuesses', 'matchesLanguage', 'mergeVersions', 'moreLabel', 'offeredLanguages',
  'patchLanded', 'pickDefaultId', 'stableGroups', 'translationPatch', 'versionGroups', 'versionLabel', 'welcomeAgainError', 'withStored',
  'WELCOME_AGAIN', 'yoursNote',
].sort(), 'requiring the page in Node exposes the pure core and nothing else');

// ---- the shell actually uses the core ----
// Greps, because the DOM half can't run here — each one guards an invariant a
// past bug broke, not a spelling.
console.log('Wiring:');
// Normalise line endings: a Windows checkout (autocrlf) hands us CRLF and the
// body regexes below anchor on LF.
const src = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/options/options.css'), 'utf8');
const shell = src.slice(src.indexOf('// ---- DOM shell'));
const bodyOf = (name) => (shell.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n {2}\\}\\n`)) || [''])[0];

check(/SETTINGS\.patch\(/.test(bodyOf('write')), 'write() is where the form reaches storage');
check((shell.match(/SETTINGS\.(patch|replace)\(/g) || []).length === 1 && !/SETTINGS\.replace\(/.test(shell),
  'the form writes in exactly one place, with patch (never replace: the panel\'s own keys must survive)');
check(/commitPatch\(\{ keys, values, list: listState\(\) \}\)/.test(bodyOf('flush')),
  'each autosave builds its write with commitPatch');
check(/translationPatch\(listState\(\)\)/.test(bodyOf('connect')),
  'a connected key is saved together with its list, through translationPatch');
check(!/enabledTranslations:/.test(shell), 'the shell never writes the translation list directly');
check(/if \(res\.error\) \{[\s\S]*?return;\n {4}\}/.test(bodyOf('connect')) && !/write\(/.test((bodyOf('connect').match(/if \(res\.error\) \{[\s\S]*?return;\n {4}\}/) || [''])[0]),
  'a failed connect writes nothing');
check(/patchLanded\(/.test(bodyOf('write')), 'a write checks it landed before saying "Saved"');
check(/failed = failedWrites\(failed, partial, keys\)/.test(bodyOf('write')) && /adopt\(keys\)/.test(bodyOf('write')),
  'a write that fails joins the retry and puts its controls back to what storage holds');
check(/if \(failed\) \{ failed = null; hideSaveError\(\); \}/.test(bodyOf('write'))
  && /if \(failed\) \{ failed = null; hideSaveError\(\); \}/.test((shell.match(/SETTINGS\.subscribe\([\s\S]*?\n {4}\}\);/) || [''])[0]),
  'the error retires after a write that lands or a change adopted from elsewhere');
check(/write\(f\.partial, f\.keys\)/.test(bodyOf('showSaveError')), '"Try again" re-sends every failed write, not the controls (which show storage again)');
check(/pagehide', flush/.test(shell), 'a pending write still lands when the tab closes');

const refreshBody = bodyOf('refreshDefaultOptions');
check(refreshBody, 'refreshDefaultOptions is still a top-level function of the shell');
check(!/=\s*els\.defaultTranslation\.value/.test(refreshBody),
  'refreshDefaultOptions never reads back the control it is about to rebuild');
check(/els\.defaultTranslation\.value = pickDefaultId\(/.test(refreshBody),
  'the preselected default comes from pickDefaultId');
check(/els\.defaultRow\.hidden = checked\.length < 2/.test(refreshBody),
  'the default select shows only when there is a choice to make');
check(/fillPlan\(/.test(bodyOf('fillForm')), 'the live refresh asks fillPlan what to repaint');
check(/SETTINGS\.subscribe\(/.test(shell), 'the page adopts changes made elsewhere');
check(!/write\(/.test(bodyOf('refreshList')),
  'refreshing the list on open writes nothing (a cached list can be a day old)');
check(/type: C\.MSG\.LIST_BIBLES, key, refresh: !!explicit/.test(bodyOf('connect')),
  'Connect fetches the list afresh; an automatic try may take the cache');
check(/await write\(partial, \['apiKey'\][\s\S]*\n {4}updateConnect\(\);/.test(bodyOf('connect')),
  'once a connect saves its key, Connect rests and "Check for new translations" shows');
check((bodyOf('connect').match(/settleKeyFocus\(from\)/g) || []).length === 2 && /const from = document\.activeElement/.test(bodyOf('connect')),
  'a connect that disables the button pressed puts keyboard focus back on the key row, on success and on error');
check(/listed: versionsLoaded/.test(bodyOf('updateConnect')), '"Check for new translations" knows whether a list is on screen');
check(/if \(!els\.connectKey\.disabled\) connect\(true\)/.test(shell), 'Enter in the key field rests with Connect (no refetch of the connected key)');
check(/keyControls\(/.test(bodyOf('updateConnect')) && /els\.recheckKey\.hidden = !c\.recheck/.test(bodyOf('updateConnect')),
  'Connect and "Check for new translations" follow keyControls');
check(/recheckKey\.addEventListener\('click', \(\) => \{ if \(keyState !== 'checking'\) connect\(true\); \}\)/.test(shell) && /id="recheckKey"[^>]*>Check for new translations</.test(html),
  '"Check for new translations" is the explicit refresh');
check(/stableGroups\(shown, available/.test(bodyOf('renderTranslations')), 'a redraw keeps rows where they were (stableGroups)');
check(/available = stored \? mergeVersions\(available, res\.bibles\)/.test(bodyOf('connect'))
  && /listPartial = listGuesses\(available, res\.partial\)/.test(bodyOf('connect')),
  'rechecking the stored key keeps the copyrights on screen, so failed lookups don\'t move known rows');
check(/listPartial = listGuesses\(merged, res\.partial\)/.test(bodyOf('refreshList')),
  'a refresh on open guesses only where the cached list can\'t fill a copyright');
check(/anyAge: true/.test(bodyOf('cachedList')) && /const cached = await cachedList\(\);[\s\S]*showStoredList\(cached\);\s*fillForm\(\);/.test(bodyOf('init')),
  'the first fill draws the stored rows plus the worker\'s cached list, however old');
check(/fillForm\(\);[\s\S]*reveal\(\);[\s\S]*listRefresh = refreshList\(\)/.test(bodyOf('init')) && /init\(\)\.finally\(reveal\)/.test(shell)
  && /body:not\(\[data-ready\]\) \{ visibility: hidden; \}/.test(css),
  'the page stays hidden until the first fill (and is revealed even if init fails)');
check(/<script src="\.\.\/background\/cache\.js"><\/script>\s*(<!--[^>]*-->\s*)?<script src="options\.js">/.test(html)
  || /cache\.js"><\/script>\s*<script src="options\.js">/.test(html),
  'the options page loads the worker\'s cache module before its own script');
// A ticked language leads the pick memory (#105): one key in C, one rule in church text.
check(/church-text\.js"><\/script>[\s\S]*<script src="options\.js">/.test(html)
  && /constants\.js"><\/script>[\s\S]*church-text\.js"/.test(html),
  'the options page loads church text after the constants and before its own script');
check(typeof C.SELECTION_KEY === 'string' && !/btxSelectedTranslation/.test(src)
  && !/btxSelectedTranslation/.test(fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8')),
  'the pick memory\'s storage key is named once, in C.SELECTION_KEY');
check(/CHURCH\.rememberTicked\(picks, before, after\)/.test(bodyOf('rememberTicks'))
  && /rememberTicks\(settings\.churchLanguages, values\.churchLanguages\)[\s\S]*return write\(/.test(bodyOf('flush'))
  && !/SELECTION_KEY\]: (?!picks)/.test(src),
  'a Church-language autosave writes the pick memory through church text\'s rememberTicked, before the setting');
check(/again\.focus\(/.test(bodyOf('renderTranslations')),
  'rebuilding the list puts focus back on the row that had it (a refresh must not drop a keyboard reader)');
check(/listRefresh\.then\(/.test(bodyOf('focusSection')) && /listRefresh = refreshList\(\)/.test(bodyOf('init')),
  'a deep link to `bible` waits for the list refresh before choosing the key field or the list');
const worker = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
check(/code === C\.ERR\.INVALID_KEY\) await CACHE\.dropBibles\(\)/.test(worker),
  'the worker drops the cached version list once api.bible rejects the stored key (else the page says "Connected")');

// ---- the worker's side: what the page and panel are told ----
console.log('Worker (api.js, service-worker.js):');
const API = require(path.join(ROOT, 'src/background/api.js'));
const NOW = Date.parse('2026-09-24T12:00:00Z');
eq(API.retryAfterMs('120', NOW), 120000, 'Retry-After in seconds');
eq(API.retryAfterMs(' 7 ', NOW), 7000, 'with stray spaces');
eq(API.retryAfterMs('Thu, 24 Sep 2026 12:00:30 GMT', NOW), 30000, 'Retry-After as an HTTP date');
eq(API.retryAfterMs('Thu, 24 Sep 2026 11:00:00 GMT', NOW), 0, 'a date already past is no wait');
eq(API.retryAfterMs('soon', NOW), undefined, 'an unreadable header names no wait');
eq(API.retryAfterMs(null, NOW), undefined, 'no header names no wait');
eq(API.retryAfterMs('-5', NOW), undefined, 'a negative number is not delta-seconds');
const response = (status, headers, body) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (n) => (headers || {})[n.toLowerCase()] || null },
  json: async () => body,
});

const workerSrc = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
check(/!result\.error && result\.bibles && !result\.partial\) await CACHE\.setBibles/.test(workerSrc),
  'the worker never caches a partial version list');
check(/reply && reply\.shown === false\) chrome\.runtime\.openOptionsPage\(\)/.test(workerSrc),
  'the toolbar icon opens the options page when the tab shows no chapter');
eq(C.BIBLES_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'the version list is cached for a week (a refresh costs ~39 calls of a monthly quota)');

async function workerChecks() {
  const e429 = await API.errorFor(response(429, { 'retry-after': '30' }));
  eq(e429.error, { code: C.ERR.RATE_LIMITED, message: 'HTTP 429', remote: true, retryAfterMs: 30000 },
    'a 429 from api.bible is RATE_LIMITED, marked remote, with the wait it named');
  const bare429 = await API.errorFor(response(429, {}));
  check(bare429.error.remote === true && !('retryAfterMs' in bare429.error), 'a 429 with no Retry-After names no wait');
  eq((await API.errorFor(response(403, {}, { message: 'Invalid API key' }))).error.code, C.ERR.INVALID_KEY, 'a 403 "Invalid API key" is INVALID_KEY');
  check(!('remote' in (await API.errorFor(response(500, {}))).error), 'only a 429 is marked remote');

  // listBibles against a stubbed fetch: the list, then one lookup per version.
  const LIST = { data: [
    { id: 'niv', name: 'New International Version', abbreviationLocal: 'NIV', description: 'Holy Bible' },
    { id: 'kjv', name: 'King James', abbreviationLocal: 'KJV', description: 'Protestant' },
  ] };
  const realFetch = global.fetch;
  const stub = (failId) => async (url) => {
    if (/\/bibles\?language=eng$/.test(url)) return response(200, {}, LIST);
    const id = decodeURIComponent(url.split('/').pop());
    if (id === failId) return response(429, {});
    return response(200, {}, { data: { copyright: `${id} copyright` } });
  };
  global.fetch = stub(null);
  const full = await API.listBibles('key');
  check(!full.partial && full.bibles.every((b) => b.copyright), 'every copyright looked up: a full list, no `partial`');
  global.fetch = stub('kjv');
  const part = await API.listBibles('key');
  check(part.partial === true, 'a failed copyright lookup flags the list `partial`');
  eq(part.bibles.map((b) => b.copyright), ['niv copyright', ''], 'the rows it did look up keep their copyrights');
  global.fetch = async () => { throw new Error('offline'); };
  const offline = await API.listBibles('key');
  eq(offline.error && offline.error.code, C.ERR.NETWORK, 'no list at all is an error, not a partial list');
  global.fetch = realFetch;
}

// Every single-value setting this form edits belongs in FIELDS — that table is
// what makes the autosave and fillForm (and so the dirty flag) agree about it.
const fieldsTable = (shell.match(/const FIELDS = \[[\s\S]*?\n {2}\];/) || [''])[0];
check(fieldsTable, 'FIELDS is still one literal table in the shell');
const CONTROL = {
  apiKey: 'apiKey', churchLanguages: 'churchLanguages', churchLanguageLayout: 'churchLanguageLayout',
  scrollSync: 'scrollSync', sidebarWidth: 'sidebarWidth', fontScale: 'fontScale',
};
for (const [key, id] of Object.entries(CONTROL)) {
  check(new RegExp(`key: '${key}'`).test(fieldsTable), `${key} is a FIELDS row (so the autosave writes it and fillForm repaints it)`);
  check(new RegExp(`id="${id}"`).test(html), `${key} has a control on the options page (#${id})`);
}
// Retired settings: the panel owns the citation layout, and the rest are gone.
for (const key of ['citationView', 'citationSourceMark', 'showCitationToggle', 'scrollToSnippet', 'actOnNonEngOnly']) {
  check(!new RegExp(key).test(src) && !new RegExp(key).test(html), `${key} is not on the options page`);
}
check(!/showOnOtherLanguages|pages in other languages/.test(src + html),
  'the "Also show on pages in other languages" row is gone (the panel shows on every chapter page)');
check(!/id="save"|Save settings/.test(html), 'there is no Save button — every change saves itself');
check(/id="saveStatus"[^>]*role="status"/.test(html), 'the autosave status is announced (role=status)');

// Card ids are the deep-link sections, in order.
const cardIds = [...html.matchAll(/<section class="card" id="([^"]+)"/g)].map((m) => m[1]);
eq(cardIds, C.OPTIONS_SECTIONS, 'the cards are the deep-link sections, in order');
eq(cardIds, ['languages', 'bible', 'reading', 'about'],
  'the cards run Church languages, Bible translations, Reading, About (the setup that needs no key comes first)');
check(/id="reading"[\s\S]*id="scrollSync"/.test(html) && /id="reading"[\s\S]*id="fontScale"/.test(html),
  'scroll sync and text size sit in the Reading card');
check(/id="languages"[\s\S]*id="churchLanguages"[\s\S]*id="reading"/.test(html),
  'the Church-language checklist sits in its own card');

// The About card (spec #69): the fourth section, text and links only, so it
// adds nothing the autosave could write.
eq(C.OPTIONS_SECTIONS, ['languages', 'bible', 'reading', 'about'], 'About is the fourth section; the ids are the same four');
const aboutCard = (html.match(/<section class="card" id="about"[\s\S]*?<\/section>/) || [''])[0];
check(aboutCard, 'the About card is on the page');
check(!/<(input|select|textarea)\b|contenteditable/i.test(aboutCard), 'the About card has no form field');
eq([...aboutCard.matchAll(/<button\b[^>]*>/g)].length, 1, 'the About card has one button');
check(/<button id="welcomeAgain" type="button"[^>]*>Show the welcome again<\/button>/.test(aboutCard),
  'the About card\'s button is "Show the welcome again"');
const welcomeAgainBody = bodyOf('showWelcomeAgain');
check(/write\(WELCOME_AGAIN\.patch,/.test(welcomeAgainBody), 'pressing it writes the flag through write() (one SETTINGS.patch)');
check(/C\.MSG\.OPEN_WELCOME/.test(welcomeAgainBody), 'then asks the worker to open the Alma 5 tab (C.MSG.OPEN_WELCOME)');
check(welcomeAgainBody.indexOf('write(') >= 0 && welcomeAgainBody.indexOf('write(') < welcomeAgainBody.indexOf('OPEN_WELCOME'),
  'the flag is written before the tab is asked for, so the new tab sees the welcome due');
check(/write\(WELCOME_AGAIN\.patch, \[\], true, true\)/.test(welcomeAgainBody),
  'its write stands alone: a failure never joins `failed`, so the page\'s Try again cannot re-send the flag without the tab');
check(/if \(!alone\)/.test(bodyOf('write')) && /failed = failedWrites/.test(bodyOf('write')),
  'write() keeps an alone write out of the generic retry');
check(/welcomeAgainError\(/.test(welcomeAgainBody) && /els\.welcomeAgainStatus/.test(welcomeAgainBody),
  'a failed save or a failed open is said under the button, never silent');
check(/<p id="welcomeAgainStatus"[^>]*role="status"/.test(aboutCard), 'the About card has the button\'s status line, announced');
check(/getElementById|\$\('welcomeAgain'\)|welcomeAgain:/.test(shell) && /showWelcomeAgain/.test(bodyOf('init')),
  'init wires the button');
check(!/els\.about/.test(fieldsTable), 'no FIELDS row reads or writes the About card');
const renderAboutBody = bodyOf('renderAbout');
check(/aboutCopy\(\{ version: chrome\.runtime\.getManifest\(\)\.version, pack \}\)/.test(renderAboutBody),
  'the card shows the running manifest\'s version through aboutCopy');
check(/citData\.loadPack\(\)/.test(renderAboutBody), 'the vintage comes from the pack the reader loads (personal first, then public)');
check(!/queueCommit|write\(|dirty|SETTINGS/.test(renderAboutBody), 'rendering the About card touches no setting');
check(/<div id="aboutData"[^>]*>\s*<h3 id="aboutDataHead"/.test(aboutCard), 'the About card holds the "Your data" section, under its heading');
check(/copy\.yourData/.test(renderAboutBody) && /els\.aboutData/.test(renderAboutBody), 'renderAbout draws "Your data" from aboutCopy');
check(!/innerHTML/.test(renderAboutBody), 'the About card is drawn as text (no innerHTML)');
check(/renderAbout\(\)/.test(bodyOf('init')), 'init renders the About card');
check(/cit-data\.js"><\/script>\s*<script src="\.\.\/citations\/cit-view-model\.js"><\/script>[\s\S]*<script src="options\.js">/.test(html),
  'the options page loads the pack loader and the view-model (vintageLine) before its own script');
check(/if \(section === 'about'\) return;/.test(bodyOf('focusSection')), 'a deep link to About scrolls to it and moves no focus');
check(/chrome\.storage\.session\.get\(C\.OPTIONS_FOCUS_KEY\)/.test(bodyOf('takeFocusRequest'))
  && /chrome\.storage\.session\.remove\(C\.OPTIONS_FOCUS_KEY\)/.test(bodyOf('takeFocusRequest')),
  'a deep link is read and cleared from session storage');
check(/area === 'session' && changes\[C\.OPTIONS_FOCUS_KEY\]/.test(shell),
  'an already-open page follows a new deep link');

// ---- Disclosures (spec #69, A29): the click beside each sentence is the consent ----
// Four places: beside Connect and beside adding a language, on this page and
// on the panel's setup card. One wording, C.DISCLOSURE.
console.log('Disclosures:');
eq(C.DISCLOSURE.apiBible, 'Connecting sends the chapters you open, your key, and an anonymous usage report to API.Bible.',
  'the api.bible sentence is the spec\'s wording');
eq(C.DISCLOSURE.churchLanguage, 'Fetches that language’s chapter from churchofjesuschrist.org.',
  'the Church-language sentence is the spec\'s wording (curly apostrophe)');
const textOf = (id) => ((html.match(new RegExp(`<p[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</p>`)) || [])[1] || '').replace(/\s+/g, ' ').trim();
const cardOf = (id) => (html.match(new RegExp(`<section class="card" id="${id}"[\\s\\S]*?</section>`)) || [''])[0];
eq(textOf('keyDisclosure'), C.DISCLOSURE.apiBible, 'settings: the api.bible sentence is on the page');
check(/id="connectKey"[^>]*>Connect<\/button>\s*<\/div>\s*(<!--[\s\S]*?-->\s*)?<p[^>]*\bid="keyDisclosure"/.test(cardOf('bible')),
  'settings: the api.bible sentence sits directly under the row holding Connect');
check(/id="connectKey"[^>]*aria-describedby="keyDisclosure"/.test(html), 'settings: Connect is described by the sentence');
eq(textOf('languagesDisclosure'), C.DISCLOSURE.churchLanguage, 'settings: the Church-language sentence is on the page');
check(/id="languagesDisclosure"[\s\S]*id="churchLanguages"/.test(cardOf('languages')),
  'settings: the Church-language sentence sits in the Church languages card, above the checklist that adds one');
const P = require(path.join(ROOT, 'src/content/panel.js'));
for (const bible of ['nokey', 'noversions']) {
  eq(P.setupCopy({ chapter: 'John 3', bible }).bible.disclosure, C.DISCLOSURE.apiBible,
    `setup card: the api.bible path (${bible}) carries the api.bible sentence`);
}
eq(P.setupCopy({ chapter: 'Alma 5', bible: null }).languagesDisclosure, C.DISCLOSURE.churchLanguage,
  'setup card: the language picker carries the Church-language sentence');
const panelSrc = fs.readFileSync(path.join(ROOT, 'src/content/panel.js'), 'utf8').replace(/\r\n/g, '\n');
const renderSetupSrc = (panelSrc.match(/function renderSetup\([^)]*\) \{[\s\S]*?\n {2}\}\n/) || [''])[0];
check(/languagePicker\(copy, langs\)\);\s*block\.appendChild\(el\('p', '[^']+', copy\.languagesDisclosure\)\)/.test(renderSetupSrc),
  'setup card: the Church-language sentence renders right under the picker with Add');
check(/copy\.bible\.button[^\n]*\n\s*block\.appendChild\(el\('p', '[^']+', copy\.bible\.disclosure\)\)/.test(renderSetupSrc),
  'setup card: the api.bible sentence renders right under its button');

// ---- api.bible setup (spec #101, #123): no account to NIV showing ----
console.log('api.bible setup:');
{
  const card = cardOf('bible');
  const setup = (card.match(/<div class="hint setup" id="bibleSetup">([\s\S]*?)<\/div>/) || [])[1] || '';
  const words = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const steps = [...((setup.match(/<ol[^>]*>([\s\S]*?)<\/ol>/) || [])[1] || '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  check(card.indexOf('id="bibleSetup"') >= 0 && card.indexOf('id="bibleSetup"') < card.indexOf('id="apiKey"'),
    'the setup steps sit above the key field they end in');
  eq(steps.map(words), [
    'Create a free account at api.bible. Sign-up asks about your app, such as what it’s for and how many people use it, and your organisation.',
    'Pick up to 3 Bibles, such as NIV, on the free plan.',
    'Copy the key from the top right of your api.bible dashboard, and paste it below.',
  ], 'three numbered steps, in order');
  check(/<a href="https:\/\/api\.bible\/sign-up"[^>]*>Create a free account<\/a>/.test(steps[0] || ''), 'step 1 links api.bible\'s sign-up page');
  check(/<a href="https:\/\/api\.bible\/team"[^>]*>api\.bible dashboard<\/a>/.test(steps[2] || ''), 'step 3 links the dashboard');
  check(/Plan, then Edit Plan, then Edit Bible Licenses/.test(words(setup.replace(/<ol[\s\S]*<\/ol>/, '')))
    && /<a href="https:\/\/api\.bible\/team"/.test(setup.replace(/<ol[\s\S]*<\/ol>/, '')),
    'the add-later path names the dashboard\'s menus and links the dashboard');
  const links = setup.match(/<a\b[^>]*>/g) || [];
  check(links.length >= 3 && links.every((a) => /target="_blank"/.test(a) && /rel="noopener"/.test(a)),
    'every setup link opens in a new tab with noopener');
  check(links.every((a) => /href="https:\/\/api\.bible\/(sign-up|team)"/.test(a)), 'every setup link goes straight to api.bible\'s current pages');
  // Reader-facing copy names the site api.bible; only the API host may say scripture.
  for (const rel of ['src/options/options.html', 'src/options/options.js', 'src/content/panel.js', 'src/content/content.js']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    check(!/(?<!api\.)scripture\.api\.bible/.test(text), `${rel} never names scripture.api.bible to the reader`);
  }
  check(/yoursNote\(\{[^)]*\}\);\s*\n\s*linkedText\(els\.yoursNote, note\)/.test(src), 'the note renders through linkedText');
  check(/n\.textContent = text/.test(bodyOf('el')) && /createTextNode/.test(bodyOf('linkedText')) && !/innerHTML/.test(bodyOf('linkedText')),
    'linked text is built from text nodes and anchors, never innerHTML');
}

// The language search must not live inside the churchLanguages FIELDS node, or
// typing in it would mark the setting dirty.
check(/<div id="churchLanguages"[^>]*><\/div>/.test(html), 'the churchLanguages container starts empty (only checkboxes go in)');

// Accessibility: sliders speak the value the page shows; a hint is its
// input's description, not part of its name.
check(/setAttribute\('aria-valuetext', pct\(v\)\)/.test(bodyOf('showFontScale')), 'Text size is announced as the percentage on screen');
check(/setAttribute\('aria-valuetext', `\$\{v\} pixels`\)/.test(bodyOf('showWidth')), 'Panel width is announced in pixels');
check(/live: showFontScale,/.test(fieldsTable) && /showFontScale\(v\)/.test(fieldsTable) && /live: showWidth,/.test(fieldsTable) && /showWidth\(v\)/.test(fieldsTable),
  'both sliders set it while dragging and when a value is adopted');
for (const m of html.matchAll(/<label class="check[^"]*">([\s\S]*?)<\/label>/g)) {
  const hint = m[1].match(/<span class="hint" id="([^"]+)"([^>]*)>/);
  if (!hint) continue;
  check(/aria-hidden="true"/.test(hint[2]) && new RegExp(`aria-describedby="${hint[1]}"`).test(m[1]),
    `hint #${hint[1]} describes its input and is kept out of the label's name`);
}
check(!/<label class="check[^"]*">(?:(?!<\/label>)[\s\S])*<span class="hint"(?![^>]*aria-hidden)/.test(html), 'no hint inside a label is part of its name');

// Vocabulary shared with the panel's beside card, and curly apostrophes.
const layoutLabels = [...html.matchAll(/value="(columns|interlinear|panel)"[^>]*\/>\s*<span>([^<]+)/g)].map((m) => [m[1], m[2]]);
eq(layoutLabels, [['columns', 'Side by side'], ['interlinear', 'Under each verse'], ['panel', 'In the panel']],
  'the layouts read Side by side · Under each verse · In the panel (the panel\'s words)');
check(/id="columnsHint"[^>]*>When there’s room; otherwise under each verse\.</.test(html), 'Side by side says when it gives way');
const htmlText = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
check(!/[A-Za-z]'[A-Za-z]/.test(htmlText), 'the page\'s copy uses curly apostrophes (’)');
const jsStrings = [...shell.replace(/^\s*\/\/.*$/gm, '').matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]);
check(!jsStrings.some((t) => /[A-Za-z]'[A-Za-z]|n't\b/.test(t)), 'the script\'s copy uses curly apostrophes too');
check(/id="langFilter"/.test(html), 'the language list has a search box');
check(/languageList\(offeredLanguages\(C\.CHURCH_LANGUAGES\), checkedLanguages\(\), q\)/.test(bodyOf('renderLanguageList')),
  'the checklist is laid out by the pure languageList from the extension\'s own language table (minus English), the ticked languages and the search');
check(/renderLanguageList\(\)/.test(fieldsTable + bodyOf('init')) && /renderLanguageList/.test(bodyOf('checkLanguages')),
  'a tick, an adopted setting and the search each lay the list out again');
check(/languageTick\(offeredLanguages\(C\.CHURCH_LANGUAGES\), ticked, now, els\.langFilter\.value\)/.test(bodyOf('onLanguageTick'))
  && /els\.langFilter\.value = tick\.search/.test(bodyOf('onLanguageTick'))
  && /f\.key === 'churchLanguages'\) onLanguageTick\(\)/.test(bodyOf('init')),
  'a tick or untick asks the pure languageTick, clears the search it answers, and the checklist\'s change handler runs it');
check(/renderLanguageList\(tick\.focus\)/.test(bodyOf('onLanguageTick')) && /focusCode = code \|\|/.test(bodyOf('renderLanguageList')),
  'the language the tick named gets the focus in its new place');
check(/buildLanguageList\(\);[\s\S]{0,80}fillForm\(\);/.test(bodyOf('init')),
  'init builds the Church-language checklist before the first fillForm, key or no key');
for (const name of ['connect', 'renderTranslations', 'refreshList']) {
  const body = bodyOf(name);
  check(body && !/buildLanguageList|churchLanguages/.test(body), `${name} never builds or touches the Church-language list`);
}
check(/groupCount\(section, filtering \? section\.shown : null\)/.test(bodyOf('renderLanguageList')),
  'a search updates each section\'s count to the languages it leaves in view');
check(/aria-labelledby', summary\.id/.test(bodyOf('renderLanguageList')) && /aria-labelledby="moreSummary"/.test(html),
  'every <details> group is named by its summary');
check(/\.summary-count \{ white-space: nowrap; \}/.test(css), 'a wrapping group label keeps "· 69 languages" on one line');
check(/el\('span', 'summary-text', `\$\{section\.label\}\\u00a0`\)/.test(bodyOf('renderLanguageList')),
  'the label\'s last word joins its count with a no-break space, so a wrapped line never starts with the dot');
check(/span\.lang = lang\.tag/.test(bodyOf('nativeName')) && /span\.dir = 'auto'/.test(bodyOf('nativeName')),
  'native language names are tagged with their language and direction');

// No nested scroll boxes: every list grows the page instead.
check(!/max-height|overflow(-y)?:\s*(auto|scroll)/.test(css), 'options.css has no nested scroll box');
check(!/(\.status|\.save-status)(:empty)?\s*\{[^}]*display:\s*none/.test(css),
  'the live regions (key status, autosave toast) are never display:none, so their messages are announced');
check(!/\.save-status\.show \{[^}]*pointer-events: auto/.test(css) && /\.save-status\.show\.error \{ pointer-events: auto; \}/.test(css),
  'the Saved toast lets clicks through to the form; only the error (Try again) takes them');
check(/--on-accent/.test(css) && /button\.primary \{[^}]*color: var\(--on-accent\)/.test(css),
  'text on the accent uses --on-accent (readable in dark mode)');
check(/accent-color: var\(--accent\)/.test(css), 'checkboxes, radios and sliders take the page accent');

// Both sliders take their range from the settings module, so the bounds live in
// exactly one place.
check(!/id="fontScale"[^>]*\b(min|max|step)=/.test(html),
  'the text-size slider does not hardcode its range (set from the settings module)');
check(/els\.fontScale\.min = String\(SETTINGS\.FONT_SCALE_MIN\)/.test(src)
  && /els\.fontScale\.max = String\(SETTINGS\.FONT_SCALE_MAX\)/.test(src)
  && /els\.fontScale\.step = String\(SETTINGS\.FONT_SCALE_STEP\)/.test(src),
  'the text-size slider range comes from the settings module at init');

workerChecks().then(() => {
  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}, (e) => {
  console.error(e);
  process.exit(1);
});
