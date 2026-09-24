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

// ---- withStored: a cached list never hides a stored version ----
console.log('withStored:');
eq(ids(F.withStored([NIV, NKJV], [NIV, { id: 'nasb', abbr: 'NASB', name: 'NASB' }])), ['niv', 'nkjv', 'nasb'],
  'a stored version missing from the (possibly day-old) list rides along at the end');
eq(ids(F.withStored([NIV], undefined)), ['niv'], 'no stored list adds nothing');

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
eq(kc({ keyState: 'checking' }), { connect: false, recheck: false }, 'while checking: neither');
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
eq(F.yoursNote({ partial: true, yours: 3 }), 'Couldn’t check which translations are yours. Try Connect again later.',
  'a partial list owns up to its guess, whatever it guessed');
eq(F.yoursNote({ partial: true, yours: 0 }), F.yoursNote({ partial: true, yours: 3 }),
  'a partial list never claims the key has no copyrighted translations');
check(/^This key has no NIV, NKJV or other copyrighted translations yet\. .*Check for new translations/.test(F.yoursNote({ partial: false, yours: 0 })),
  'an empty "yours" says how to fill it, through the button that refetches (Connect rests on a connected key)');
eq(F.yoursNote({ partial: false, yours: 2 }), '', 'a full list with versions in "yours" needs no note');
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

// ---- the DOM shell stays out of Node ----
console.log('Shell:');
eq(Object.keys(F).sort(), [
  'commitPatch', 'connectedText', 'dedupeVersions', 'failedWrites', 'fillPlan', 'groupCount', 'initialChecks', 'isAdded',
  'keyControls', 'keyErrorText', 'languageGroups', 'matchesLanguage', 'mergeVersions', 'moreLabel', 'offeredLanguages',
  'patchLanded', 'pickDefaultId', 'stableGroups', 'translationPatch', 'versionGroups', 'versionLabel', 'withStored',
  'yoursNote',
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
check(/if \(!els\.connectKey\.disabled\) connect\(true\)/.test(shell), 'Enter in the key field rests with Connect (no refetch of the connected key)');
check(/keyControls\(/.test(bodyOf('updateConnect')) && /els\.recheckKey\.hidden = !c\.recheck/.test(bodyOf('updateConnect')),
  'Connect and "Check for new translations" follow keyControls');
check(/recheckKey\.addEventListener\('click', \(\) => connect\(true\)\)/.test(shell) && /id="recheckKey"[^>]*>Check for new translations</.test(html),
  '"Check for new translations" is the explicit refresh');
check(/stableGroups\(shown, available/.test(bodyOf('renderTranslations')), 'a redraw keeps rows where they were (stableGroups)');
check(/anyAge: true/.test(bodyOf('cachedList')) && /const cached = await cachedList\(\);[\s\S]*showStoredList\(cached\);\s*fillForm\(\);/.test(bodyOf('init')),
  'the first fill draws the stored rows plus the worker\'s cached list, however old');
check(/fillForm\(\);[\s\S]*reveal\(\);[\s\S]*listRefresh = refreshList\(\)/.test(bodyOf('init')) && /init\(\)\.finally\(reveal\)/.test(shell)
  && /body:not\(\[data-ready\]\) \{ visibility: hidden; \}/.test(css),
  'the page stays hidden until the first fill (and is revealed even if init fails)');
check(/<script src="\.\.\/background\/cache\.js"><\/script>\s*(<!--[^>]*-->\s*)?<script src="options\.js">/.test(html)
  || /cache\.js"><\/script>\s*<script src="options\.js">/.test(html),
  'the options page loads the worker\'s cache module before its own script');
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
  scrollSync: 'scrollSync', actOnNonEngOnly: 'showOnOtherLanguages', sidebarWidth: 'sidebarWidth', fontScale: 'fontScale',
};
for (const [key, id] of Object.entries(CONTROL)) {
  check(new RegExp(`key: '${key}'`).test(fieldsTable), `${key} is a FIELDS row (so the autosave writes it and fillForm repaints it)`);
  check(new RegExp(`id="${id}"`).test(html), `${key} has a control on the options page (#${id})`);
}
check(/key: 'actOnNonEngOnly',[\s\S]*?read: \(\) => !els\.showOnOtherLanguages\.checked/.test(fieldsTable),
  '"Also show on pages in other languages" is actOnNonEngOnly, inverted');
// Retired settings: the panel owns the citation layout, and the rest are gone.
for (const key of ['citationView', 'citationSourceMark', 'showCitationToggle', 'scrollToSnippet']) {
  check(!new RegExp(key).test(src) && !new RegExp(key).test(html), `${key} is not on the options page`);
}
check(!/id="save"|Save settings/.test(html), 'there is no Save button — every change saves itself');
check(/id="saveStatus"[^>]*role="status"/.test(html), 'the autosave status is announced (role=status)');

// Card ids are the deep-link sections, in order.
const cardIds = [...html.matchAll(/<section class="card" id="([^"]+)"/g)].map((m) => m[1]);
eq(cardIds, C.OPTIONS_SECTIONS, 'the cards are the deep-link sections, in order');
check(/id="reading"[\s\S]*id="scrollSync"/.test(html) && /id="reading"[\s\S]*id="fontScale"/.test(html),
  'scroll sync and text size sit in the Reading card');
check(/id="languages"[\s\S]*id="churchLanguages"[\s\S]*id="reading"/.test(html),
  'the Church-language checklist sits in its own card');
check(/chrome\.storage\.session\.get\(C\.OPTIONS_FOCUS_KEY\)/.test(bodyOf('takeFocusRequest'))
  && /chrome\.storage\.session\.remove\(C\.OPTIONS_FOCUS_KEY\)/.test(bodyOf('takeFocusRequest')),
  'a deep link is read and cleared from session storage');
check(/area === 'session' && changes\[C\.OPTIONS_FOCUS_KEY\]/.test(shell),
  'an already-open page follows a new deep link');

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
check(/for \(const group of |languageGroups\(offeredLanguages\(C\.CHURCH_LANGUAGES\)\)/.test(bodyOf('buildLanguageList')),
  'the checklist is built from the extension\'s own language table, minus English');
check(/buildLanguageList\(\);[\s\S]{0,80}fillForm\(\);/.test(bodyOf('init')),
  'init builds the Church-language checklist before the first fillForm, key or no key');
for (const name of ['connect', 'renderTranslations', 'refreshList']) {
  const body = bodyOf(name);
  check(body && !/buildLanguageList|churchLanguages/.test(body), `${name} never builds or touches the Church-language list`);
}
check(/groupCount\(g\.group, filtering \? n : null\)/.test(bodyOf('applyLanguageFilter')),
  'a search updates each group\'s count to the languages it leaves in view');
check(/aria-labelledby', summary\.id/.test(bodyOf('buildLanguageList')) && /aria-labelledby="moreSummary"/.test(html),
  'every <details> group is named by its summary');
check(/\.summary-count \{ white-space: nowrap; \}/.test(css), 'a wrapping group label keeps "· 69 languages" on one line');
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
