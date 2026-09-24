#!/usr/bin/env node
/*
 * No-build sanity checks for the options form's pure core. Run:
 *   node tools/validate-options-form.js
 *
 * src/options/options.js exports the decisions the form makes that are not
 * about the DOM (the shell is skipped when `document` is undefined): which
 * versions lead the list and which are duplicates, which start checked, which
 * default wins, what an autosave may write, which controls a change arriving
 * from another context may repaint, the language search, and the status copy.
 * Those are the rules the stale-list and wrong-default bugs lived in.
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
eq(F.connectedText([]), 'Connected. Choose the translations to show in the panel.', 'connected with nothing on says what to do');
const bad = "api.bible didn't accept that key. Check that you copied all of it.";
eq(F.keyErrorText({ code: C.ERR.INVALID_KEY }), bad, 'a wrong key says so in plain words');
eq(F.keyErrorText({ code: C.ERR.FORBIDDEN }), bad, 'a 403 on the list is a key problem too');
eq(F.keyErrorText({ code: C.ERR.NETWORK, message: 'Failed to fetch' }), "Couldn't reach api.bible. Check your connection and try again.",
  'offline says to check the connection');
eq(F.keyErrorText({ code: C.ERR.RATE_LIMITED }), 'api.bible is busy. Try again in a minute.', 'rate-limited says to wait');
eq(F.keyErrorText({ code: C.ERR.UNKNOWN, message: 'HTTP 500' }), "Couldn't check the key (HTTP 500). Try again.",
  'anything else names what happened, never a bare error code');
eq(F.keyErrorText(undefined), "Couldn't check the key (no answer). Try again.", 'no response at all is still a sentence');
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
eq(F.groupSummary(groups[0]), 'All standard works · 2 languages', 'a group summary counts its languages');
eq(F.groupSummary(groups[1]), 'Bible and Book of Mormon · 1 language', 'and pluralizes');

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
  'commitPatch', 'connectedText', 'dedupeVersions', 'fillPlan', 'groupSummary', 'initialChecks', 'isAdded',
  'keyErrorText', 'languageGroups', 'matchesLanguage', 'moreLabel', 'offeredLanguages', 'patchLanded',
  'pickDefaultId', 'translationPatch', 'versionGroups', 'versionLabel', 'withStored',
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
check(/id="langFilter"/.test(html), 'the language list has a search box');
check(/for \(const group of |languageGroups\(offeredLanguages\(C\.CHURCH_LANGUAGES\)\)/.test(bodyOf('buildLanguageList')),
  'the checklist is built from the extension\'s own language table, minus English');
check(/buildLanguageList\(\);[\s\S]{0,80}fillForm\(\);/.test(bodyOf('init')),
  'init builds the Church-language checklist before the first fillForm, key or no key');
for (const name of ['connect', 'renderTranslations', 'refreshList']) {
  const body = bodyOf(name);
  check(body && !/buildLanguageList|churchLanguages/.test(body), `${name} never builds or touches the Church-language list`);
}
check(/span\.lang = lang\.tag/.test(bodyOf('nativeName')) && /span\.dir = 'auto'/.test(bodyOf('nativeName')),
  'native language names are tagged with their language and direction');

// No nested scroll boxes: every list grows the page instead.
check(!/max-height|overflow(-y)?:\s*(auto|scroll)/.test(css), 'options.css has no nested scroll box');
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

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
