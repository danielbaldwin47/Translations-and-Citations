#!/usr/bin/env node
/*
 * No-build sanity checks for src/content/church-text.js (__BTX.churchText),
 * the Church-language parallel text. Run:
 *   node tools/validate-church-text.js
 *
 * Covers the pure core: which texts a chapter offers and which one shows
 * (textsFor / pickText), which texts the chapter check found it in
 * (chapterOffer), where a chapter lives (chapterUri / apiUrl), and the
 * markup rule that turns the site's chapter HTML into translation IR
 * (chapterFrom). The fixtures are trimmed copies of real responses from
 * /study/api/v3/language-pages/type/content; a tiny parser below builds the
 * minimal node tree chapterFrom walks (the browser hands it DOMParser nodes).
 * The fetch shell (load) is not exercised here.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const T = require(path.join(ROOT, 'src/content/church-text.js'));

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

// ---- A minimal HTML -> node tree, for fixtures only -------------------------
// Well-formed fixture markup only: elements, attributes in double quotes, text,
// void <br>/<img>, and the handful of entities the fixtures use.
const VOID = { br: 1, img: 1, hr: 1 };
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}
function element(tagName, attrs) {
  return { nodeType: 1, tagName: tagName.toUpperCase(), childNodes: [], getAttribute: (n) => (n in attrs ? attrs[n] : null) };
}
function parse(html) {
  const root = element('body', {});
  const stack = [root];
  const re = /<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (stack.length > 1 && top.tagName === m[1].toUpperCase()) stack.pop();
      else throw new Error(`fixture: unbalanced </${m[1]}>`);
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
      const node = element(m[2], attrs);
      top.childNodes.push(node);
      if (!VOID[m[2]] && !/\/>$/.test(m[0])) stack.push(node);
    } else {
      top.childNodes.push({ nodeType: 3, nodeValue: decode(m[4]), childNodes: [] });
    }
  }
  if (stack.length !== 1) throw new Error('fixture: unclosed element');
  return root;
}
const chapter = (html, meta) => T.chapterFrom(parse(html), meta);

// ---- textsFor / pickText -----------------------------------------------------
console.log('textsFor:');
const NIV = { id: 'niv', name: 'New International Version', abbr: 'NIV', provider: C.PROVIDER_APIBIBLE };
const [L1, L2] = C.CHURCH_LANGUAGES.filter((l) => l.code !== 'eng'); // the pages below are English
let list = T.textsFor({ isBible: true, collection: 'nt', bibleRows: [NIV], languages: [L1.code, L2.code], pageLang: 'eng' });
eq(list.map((t) => t.id), ['niv', 'church:' + L1.code, 'church:' + L2.code],
  'a Bible chapter offers the api.bible versions first, then the Church languages');
eq(list[1], { id: 'church:' + L1.code, provider: 'church', lang: L1.code, abbr: L1.name === L1.english ? '' : L1.name, name: L1.english },
  'a Church row carries its language, native name and English name');
list = T.textsFor({ isBible: false, bibleRows: [NIV], languages: [L1.code], pageLang: 'eng' });
eq(list.map((t) => t.id), ['church:' + L1.code], 'a non-Bible chapter offers only the Church languages');
eq(T.textsFor({ isBible: false, bibleRows: [NIV], languages: [], pageLang: 'eng' }), [],
  'a non-Bible chapter with no Church language has nothing to show (the panel forces citations)');
eq(T.textsFor({ isBible: true, bibleRows: [], languages: [L1.code], pageLang: L1.code }).map((t) => t.id), ['church:eng'],
  "the page's own language is never offered beside itself");
{
  // A page read in another language offers English, unticked (#119), on
  // request: the reader didn't add it, so nothing fetches it or sets it into
  // the page until they choose it (pageLanguage, chapterOffer's `unchecked`).
  const spaPage = (languages, extra) => T.textsFor(Object.assign({ isBible: false, collection: 'bofm', languages, pageLang: 'spa' }, extra));
  eq(spaPage([]).map((t) => t.id), ['church:eng'], 'a Spanish page with no language ticked offers English');
  eq(spaPage([])[0], Object.assign({}, T.rowFor('eng'), { onRequest: true }), '...as a Church-language row on request');
  eq(spaPage(['eng'])[0], T.rowFor('eng'), '...English ticked (a value stored in settings) is an ordinary row');
  eq(spaPage(['spa', 'jpn']).map((t) => t.id), ['church:jpn', 'church:eng'],
    "...after the ticked languages, still leaving out the page's own (Spanish)");
  eq(spaPage(['eng', 'jpn']).map((t) => t.id), ['church:eng', 'church:jpn'], '...and never twice when English is ticked too');
  eq(T.textsFor({ isBible: true, collection: 'nt', bibleRows: [NIV], languages: ['jpn'], pageLang: 'spa' }).map((t) => t.id),
    ['niv', 'church:jpn', 'church:eng'], '...after the Bible versions on a Bible chapter');
  eq(T.textsFor({ isBible: false, collection: 'bofm', languages: ['jpn'], pageLang: 'eng' }).map((t) => t.id), ['church:jpn'],
    'an English page adds no English row');
  eq(T.textsFor({ isBible: false, collection: 'bofm', languages: ['jpn'] }).map((t) => t.id), ['church:jpn'],
    '...nor does a page whose language is not given (detect reads a missing lang as English)');
}
eq(T.textsFor({ isBible: true, bibleRows: [], languages: ['xxx', L1.code] }).map((t) => t.id), ['church:' + L1.code],
  'a code the table does not know is skipped, not rendered as a blank row');
eq(T.textsFor({}), [], 'no inputs, no texts');
const bofmOnly = C.CHURCH_LANGUAGES.find((l) => l.vols.join() === 'bofm');
const bibleOnly = C.CHURCH_LANGUAGES.find((l) => l.vols.indexOf('bofm') < 0);
check(bofmOnly && bibleOnly, 'the table has a Book-of-Mormon-only and a Bible-without-Book-of-Mormon language to test with');
if (bofmOnly && bibleOnly) {
  const both = [bofmOnly.code, bibleOnly.code];
  eq(T.textsFor({ isBible: true, collection: 'nt', languages: both }).map((t) => t.lang), [bibleOnly.code],
    'a language that has not published the New Testament is left out of a New Testament chapter');
  eq(T.textsFor({ isBible: false, collection: 'bofm', languages: both }).map((t) => t.lang), [bofmOnly.code],
    '...and one without the Book of Mormon out of a Book of Mormon chapter');
  eq(T.textsFor({ isBible: false, collection: 'dc-testament', languages: [bofmOnly.code] }), [],
    'a D&C chapter whose only enabled language lacks the D&C has nothing to show');
}
const ENG = C.CHURCH_LANGUAGES.find((l) => l.code === 'eng');
check(ENG, 'English is in the table (a reader of a non-English page can put English beside it)');
if (ENG) eq(T.rowFor('eng').abbr, '', 'English reads "English" in the dropdown, not "English — English"');

console.log('pickText:');
list = T.textsFor({ isBible: true, bibleRows: [NIV], languages: [L1.code], pageLang: 'eng' });
eq(T.pickText(list, ['church:' + L1.code, 'niv']), 'church:' + L1.code, 'the first preferred id on offer wins');
eq(T.pickText(list, ['gone', 'niv']), 'niv', 'a preference the list lacks falls through to the next');
eq(T.pickText(list, [null, '']), 'niv', 'no usable preference -> the first row');
const churchOnly = T.textsFor({ isBible: false, bibleRows: [NIV], languages: [L1.code], pageLang: 'eng' });
eq(T.pickText(churchOnly, ['niv', 'niv']), 'church:' + L1.code,
  'a Bible version preferred on a Book of Mormon chapter falls back to a Church language...');
eq(T.pickText(list, ['niv']), 'niv', '...and is still the pick back on a Bible chapter (the preference was not rewritten)');
eq(T.pickText([], ['niv']), null, 'an empty list picks nothing');

console.log('chapterOffer:');
{
  // Kiribati publishes the Doctrine and Covenants but not section 76; the
  // chapter check fetched it and found nothing there.
  const dc = T.textsFor({ isBible: false, collection: 'dc-testament', languages: ['gil', 'spa'], pageLang: 'eng' });
  const kirOnly = dc.filter((r) => r.lang === 'gil');
  const offer = (texts, results, preferredIds) => T.chapterOffer({ texts, results, preferredIds });
  const offered = (o) => o.texts.map((r) => [r.id, r.offered]);

  let o = offer(kirOnly, {}, []);
  eq([o.next, o.pick, o.translatable], ['gil', null, null], 'Kiribati alone, unchecked: check Kiribati; nothing is decided yet');
  eq(offered(o), [['church:gil', null]], '...and its row is marked not yet checked');
  o = offer(kirOnly, { gil: 'unavailable' }, []);
  eq([o.next, o.pick, o.translatable], [null, null, false], 'Kiribati lacks D&C 76: the chapter is not translatable');
  eq(offered(o), [['church:gil', false]], '...its row is marked not offered');

  const mru = ['church:gil', 'church:spa'];
  o = offer(dc, {}, mru);
  eq(o.next, 'gil', 'Kiribati and Español, Kiribati picked last: Kiribati is checked first (pick order)');
  o = offer(dc, { gil: 'unavailable' }, mru);
  eq([o.next, o.pick, o.translatable], ['spa', null, null], '...missing there, Español is checked next');
  o = offer(dc, { gil: 'unavailable', spa: 'found' }, mru);
  eq([o.next, o.pick, o.translatable], [null, 'church:spa', true], '...found there, Español shows');
  eq(offered(o), [['church:gil', false], ['church:spa', true]], '...each text marked offered or not');
  o = offer(dc, { spa: 'found' }, ['church:spa', 'church:gil']);
  eq([o.next, o.pick, o.translatable], [null, 'church:spa', true],
    'Español picked last and found: no need to check Kiribati at all');
  eq(offered(o), [['church:gil', null], ['church:spa', true]], '...Kiribati stays not yet checked');
  eq(o.unchecked, ['gil'], '...and is what the background check asks once the panel settles, so a dropdown row lacking the chapter drops out');
  o = offer(dc, { spa: 'found', gil: 'unavailable' }, ['church:spa', 'church:gil']);
  eq(o.unchecked, [], 'every language asked: nothing left for the background check');
  eq(offer(dc, { spa: 'found', gil: 'error' }, ['church:spa']).unchecked, [], 'a failed check is not asked again in the background (Try again asks)');
  o = offer(dc, { gil: 'error' }, mru);
  eq([o.next, o.pick, o.translatable], [null, 'church:gil', true],
    'a check that failed (network) counts as offered, so the panel says why it failed');
  eq(o.texts.map((r) => [r.id, r.offered, r.failed === true]), [['church:gil', true, true], ['church:spa', null, false]],
    '...and its row is marked failed, which the page\'s language reads (pageLanguage)');

  // A Bible chapter: the bundled Bible always offers it.
  const WEB = { id: C.BUNDLED_BIBLE.id, provider: C.BUNDLED_BIBLE.provider, abbr: 'WEB', name: 'World English Bible' };
  const john = T.textsFor({ isBible: true, collection: 'nt', bibleRows: [WEB], languages: ['spa'], pageLang: 'eng' });
  o = offer(john, {}, []);
  eq([o.next, o.pick, o.translatable], [null, WEB.id, true], 'John 3, the Bible preferred: no check at all');
  eq(offered(o), [[WEB.id, true], ['church:spa', null]], '...a Bible row is offered without a check');
  o = offer(john, {}, ['church:spa']);
  eq([o.next, o.pick, o.translatable], ['spa', null, true],
    'John 3, Español picked last: translatable already, but Español is checked before it can show');
  o = offer(john, { spa: 'unavailable' }, ['church:spa']);
  eq([o.next, o.pick], [null, WEB.id], '...and a missing Español falls back to the Bible');

  // English on a Spanish page is on request: the background check never
  // fetches it for the dropdown before the reader chooses it.
  const spaJohn = T.textsFor({ isBible: true, collection: 'nt', bibleRows: [WEB], languages: ['jpn'], pageLang: 'spa' });
  o = offer(spaJohn, {}, []);
  eq([o.pick, o.unchecked], [WEB.id, ['jpn']], 'Spanish John 3, the Bible shows: the background check asks Japanese, not English (never chosen)');
  o = offer(spaJohn, {}, ['church:eng']);
  eq(o.next, 'eng', '...English chosen: it is walked and checked like any language');
  o = offer(spaJohn, { eng: 'found' }, ['church:eng']);
  eq(o.unchecked, ['jpn'], '...and the rest are asked in the background');

  o = offer([], {}, ['church:spa']);
  eq([o.next, o.pick, o.translatable], [null, null, false], 'no texts at all: nothing to check, not translatable');
  o = T.chapterOffer({});
  eq([o.next, o.pick, o.translatable, o.texts, o.unchecked], [null, null, false, [], []], 'no inputs, nothing offered');
}

console.log('pageLanguage (the page\'s language, from the pick memory):');
{
  // The rows as the chapter check marks them: { id, provider, lang, offered }.
  const SPA = (offered) => Object.assign({}, T.rowFor('spa'), { offered });
  const JPN = (offered) => Object.assign({}, T.rowFor('jpn'), { offered });
  const NIV_ROW = (offered) => Object.assign({}, NIV, { offered });
  const page = (texts, picks, layout) => T.pageLanguage({ texts, picks, layout });

  eq(page([SPA(true)], ['church:spa'], 'columns'), { id: 'church:spa', next: null },
    'Alma 5, Español picked and found, side by side: Español holds the page');
  eq(page([SPA(true)], ['church:spa'], 'interlinear'), { id: 'church:spa', next: null }, '...under each verse too');
  eq(page([SPA(true)], ['church:spa'], 'panel'), { id: null, next: null }, '...in the panel: no page language, nothing to check');
  eq(page([SPA(true)], ['church:spa'], undefined), { id: null, next: null }, 'an unknown layout holds nothing');

  eq(page([NIV_ROW(true), SPA(true)], ['niv', 'church:spa'], 'columns'), { id: 'church:spa', next: null },
    'John 3, NIV picked last: Español still holds the page (a Bible version never does)');
  eq(page([NIV_ROW(true), SPA(null)], ['niv', 'church:spa'], 'columns'), { id: null, next: 'spa' },
    '...Español not checked yet: check it (the panel\'s NIV needed no check)');

  eq(page([SPA(true), JPN(true)], ['church:jpn', 'church:spa'], 'columns'), { id: 'church:jpn', next: null },
    'two languages found: the one picked last holds the page');
  eq(page([SPA(true), JPN(false)], ['church:jpn', 'church:spa'], 'columns'), { id: 'church:spa', next: null },
    'the next chapter lacks Japanese: Español, the next pick that offers it, takes its place');
  eq(page([SPA(null), JPN(false)], ['church:jpn', 'church:spa'], 'columns'), { id: null, next: 'spa' },
    '...Español not checked yet: check it next');
  eq(page([SPA(false), JPN(false)], ['church:jpn', 'church:spa'], 'columns'), { id: null, next: null },
    '...neither offers it: no page language');
  // No pick names a language that offers the chapter: the page holds what the
  // Translation tab would select (pickText's answer), only when that is a
  // Church language (B2).
  const WEB_OK = Object.assign({}, { id: C.BUNDLED_BIBLE.id, provider: C.BUNDLED_BIBLE.provider }, { offered: true });
  eq(page([SPA(true), JPN(true)], [], 'columns'), { id: 'church:spa', next: null },
    'Alma 5, no picks, two languages: the one the Translation tab selects (the first enabled) holds the page');
  eq(page([SPA(null)], [], 'columns'), { id: null, next: 'spa' }, '...not checked yet: check it');
  eq(page([WEB_OK, SPA(true)], [], 'columns'), { id: null, next: null },
    'John 3, no picks, Español on: the tab selects the Bible, so no page language (and no check)');
  eq(page([WEB_OK, SPA(true), JPN(false)], ['church:jpn'], 'columns'), { id: null, next: null },
    '...the only language picked lacks the chapter: still the Bible, no page language');
  eq(page([SPA(true), JPN(false)], ['niv', 'church:jpn'], 'columns'), { id: 'church:spa', next: null },
    'Alma 5, the picks name only NIV and a language lacking it: Español, the tab\'s selection, holds the page');
  eq(page(undefined, ['church:spa'], 'columns'), { id: null, next: null }, 'nothing known: no page language');

  // The language switch (GLOSSARY: Language switch): off names no page
  // language and asks for no check; on (or not given) answers as before.
  const shown = (on, texts, picks, layout) => T.pageLanguage({ texts, picks, layout, shown: on });
  eq(shown(false, [SPA(true)], ['church:spa'], 'columns'), { id: null, next: null }, 'switch off, Español found: no page language');
  eq(shown(false, [SPA(true)], ['church:spa'], 'interlinear'), { id: null, next: null }, '...under each verse too');
  eq(shown(false, [SPA(null)], ['church:spa'], 'columns'), { id: null, next: null }, '...Español not checked yet: no check for a hidden language');
  eq(shown(false, [WEB_OK, SPA(true)], [], 'columns'), { id: null, next: null }, '...John 3: nothing');
  eq(shown(true, [SPA(true)], ['church:spa'], 'columns'), { id: 'church:spa', next: null }, 'switch on: Español holds the page, as today');
  eq(shown(true, [SPA(null)], ['church:spa'], 'columns'), { id: null, next: 'spa' }, '...and an unchecked language is still asked');
  eq(shown(undefined, [SPA(true)], ['church:spa'], 'columns'), { id: 'church:spa', next: null }, 'switch not given: on');

  // A check that failed (network) offers the panel's text, for its error card
  // and Try again, but never the page: there is nothing to split in (B1).
  const FAILED = (row) => Object.assign(row, { failed: true });
  eq(page([FAILED(SPA(true)), JPN(true)], ['church:spa', 'church:jpn'], 'columns'), { id: 'church:jpn', next: null },
    'Español\'s check failed: Japanese, the next pick that offers the chapter, holds the page');
  eq(page([FAILED(SPA(true)), JPN(null)], ['church:spa', 'church:jpn'], 'columns'), { id: null, next: 'jpn' },
    '...Japanese not checked yet: check it next');
  eq(page([FAILED(SPA(true))], ['church:spa'], 'columns'), { id: null, next: null },
    '...no other pick: no page language');

  // A page read in Spanish (?lang=spa): textsFor's English row is on
  // request. Unchosen, it never holds the page, so nothing checks it either
  // (Citations fetches nothing the reader didn't add). Once the reader
  // chooses it (the pick memory), it holds the page by the same rules as a
  // ticked language (#119), and the split pairs the fetched English by
  // element id with the Spanish article.
  const onSpa = (languages, results, picks, extra) => {
    const texts = T.textsFor(Object.assign({ isBible: false, collection: 'bofm', languages, pageLang: 'spa' }, extra));
    return page(T.chapterOffer({ texts, results, preferredIds: picks }).texts, picks, 'columns');
  };
  eq(onSpa([], {}, []), { id: null, next: null }, 'Spanish Alma 5, nothing ticked, English never chosen: no page language, nothing to check');
  eq(onSpa([], { eng: 'found' }, []), { id: null, next: null }, '...even with its chapter known: offered, not shown unasked');
  eq(onSpa([], {}, ['church:eng']), { id: null, next: 'eng' }, 'English chosen (in the pick memory), not checked yet: check it');
  eq(onSpa([], { eng: 'found' }, ['church:eng']), { id: 'church:eng', next: null }, '...found: English holds the page, like a lone ticked language');
  eq(onSpa(['spa'], { eng: 'found' }, ['church:spa']), { id: null, next: null },
    'Español ticked and picked: on its own page English is offered, not set in unasked');
  eq(onSpa(['jpn'], { eng: 'found', jpn: 'found' }, ['church:jpn']), { id: 'church:jpn', next: null },
    'Japanese picked: Japanese holds the page, English stays in the dropdown');
  eq(onSpa(['jpn'], { eng: 'found', jpn: 'found' }, ['church:eng', 'church:jpn']), { id: 'church:eng', next: null },
    '...English picked since: English holds the page');
  eq(onSpa(['jpn'], { jpn: 'unavailable' }, ['church:jpn']), { id: null, next: null },
    '...Japanese lacking the chapter: English, never chosen, does not stand in for it');
  const WEB = { id: C.BUNDLED_BIBLE.id, provider: C.BUNDLED_BIBLE.provider };
  const john = { isBible: true, collection: 'nt', bibleRows: [WEB] };
  eq(onSpa([], { eng: 'found' }, [], john), { id: null, next: null },
    'Spanish John 3, no picks: the tab selects the Bible, so no page language');
  eq(onSpa([], { eng: 'found' }, ['church:eng'], john), { id: 'church:eng', next: null }, '...English picked: English holds the page');
}

console.log('mruFrom / rememberPick:');
eq(T.mruFrom('niv'), ['niv'], 'a single stored id (before the list existed) becomes a one-item list');
eq(T.mruFrom(['church:spa', 'niv', 'church:spa', '', 7]), ['church:spa', 'niv'], 'duplicates and non-ids are dropped');
eq(T.mruFrom(undefined), [], 'nothing stored, no preference');
eq(T.rememberPick(['niv', 'church:spa'], 'church:spa'), ['church:spa', 'niv'], 'a pick moves to the front');
eq(T.rememberPick('niv', 'church:jpn'), ['church:jpn', 'niv'], '...of a migrated single id too');
eq(T.rememberPick(['a', 'b', 'c', 'd', 'e', 'f'], 'g'), ['g', 'a', 'b', 'c', 'd', 'e'], `the list keeps the ${T.MRU_MAX} newest`);
eq(T.rememberPick(['niv'], ''), ['niv'], 'an empty pick changes nothing');
{
  // Spanish on Alma 5, then NIV on John 3: Alma 6 still opens in Spanish.
  const spa = C.CHURCH_LANGUAGES.find((l) => l.code === 'spa');
  const jpn = C.CHURCH_LANGUAGES.find((l) => l.code === 'jpn');
  const bofm = T.textsFor({ isBible: false, collection: 'bofm', languages: [jpn.code, spa.code], pageLang: 'eng' });
  const mru = T.rememberPick(T.rememberPick([], 'church:spa'), 'niv');
  eq(mru, ['niv', 'church:spa'], 'NIV picked after Spanish is the newest');
  eq(T.pickText(bofm, mru.concat('niv')), 'church:spa',
    'back on the Book of Mormon the newest pick it offers wins, not its first row');
}

console.log('rememberTicked (a tick in settings goes to the front):');
eq(T.rememberTicked(['niv'], [], ['spa']), ['church:spa', 'niv'], 'one tick goes in front of an earlier Bible pick');
eq(T.rememberTicked(['niv'], ['jpn'], ['jpn', 'spa']), ['church:spa', 'niv'], '...only the language newly on counts, not one already on');
eq(T.rememberTicked(['niv'], [], ['jpn', 'spa']), ['church:spa', 'church:jpn', 'niv'], 'two ticks at once: the last ticked is at the front');
eq(T.rememberTicked(['church:spa', 'niv'], ['spa'], []), ['church:spa', 'niv'], 'an untick leaves the list as it was');
eq(T.rememberTicked(['church:jpn', 'church:spa', 'niv'], ['jpn', 'spa'], ['jpn']), ['church:jpn', 'church:spa', 'niv'], '...order and all');
eq(T.rememberTicked(['church:jpn', 'church:spa', 'niv'], [], ['spa']), ['church:spa', 'church:jpn', 'niv'], 'a re-tick of a language already in the list moves it to the front, once');
eq(T.rememberTicked('niv', [], ['spa']), ['church:spa', 'niv'], '...a migrated single id included');
eq(T.rememberTicked(['niv'], ['spa'], ['spa']), ['niv'], 'no change to the languages, no change to the list');
eq(T.rememberTicked(['niv'], undefined, ['spa']), ['church:spa', 'niv'], 'nothing stored before counts as none on');
eq(T.rememberTicked(['niv'], [], ['spa', 'xx-nope']), ['church:spa', 'niv'], 'a code that is no Church language is not remembered');

console.log('labelFor:');
const SPA_ROW = T.rowFor('spa');
eq(T.labelFor(NIV, [NIV]), 'New International Version (NIV)', 'a Bible row reads "name (abbr)": a narrow dropdown cuts the abbreviation, not the name');
eq(T.labelFor({ id: 'x', abbr: '', name: 'Some Version', provider: C.PROVIDER_APIBIBLE }, []), 'Some Version', 'a Bible row with no abbreviation reads its name alone');
eq(T.labelFor({ id: 'x', abbr: 'Some Version', name: 'Some Version', provider: C.PROVIDER_APIBIBLE }, []), 'Some Version', '...and so does one whose abbreviation is its name');
eq(T.labelFor(SPA_ROW, [SPA_ROW]), 'Español — Spanish', 'a Church row reads "native name — English name"');
if (ENG) eq(T.labelFor(T.rowFor('eng'), []), 'English', 'English reads once');
// The short name: one language named on its own (the language row, the
// switch, the off and not-available cards, the Hide line), as labelFor leads.
eq(T.nameFor(SPA_ROW), 'Español', 'nameFor: a Church row by its native name');
eq(T.nameFor(T.rowFor('gil')), 'Kiribati', '...Kiribati by its own name, not "Kiribati (Gilbertese)"');
if (ENG) eq(T.nameFor(T.rowFor('eng')), 'English', '...English, whose native name is its English name');
eq(T.nameFor(null), '', '...no row, no name');
const WEBU = (id, extra) => Object.assign({ id, abbr: 'WEBU', name: 'World English Bible Updated', provider: C.PROVIDER_APIBIBLE }, extra);
const webus = [WEBU('72f4e6dc683324df-01'), WEBU('72f4e6dc683324df-02'), WEBU('72f4e6dc683324df-03')];
eq(webus.map((r) => T.labelFor(r, webus)), [
  'World English Bible Updated, 1 (WEBU)', 'World English Bible Updated, 2 (WEBU)', 'World English Bible Updated, 3 (WEBU)',
], 'identical rows saved before descriptions existed are told apart by their id edition, before the abbreviation: a narrow dropdown cuts the abbreviation, not what tells twins apart');
const described = [WEBU('x-01', { description: 'Ecumenical' }), WEBU('x-02', { description: 'Protestant' })];
eq(described.map((r) => T.labelFor(r, described)), [
  'World English Bible Updated, Ecumenical (WEBU)', 'World English Bible Updated, Protestant (WEBU)',
], "...and by api.bible's description when there is one");
const sameDesc = [WEBU('a', { description: 'Protestant' }), WEBU('b', { description: 'Protestant' })];
eq(sameDesc.map((r) => T.labelFor(r, sameDesc)), [
  'World English Bible Updated, 1 (WEBU)', 'World English Bible Updated, 2 (WEBU)',
], 'rows nothing else tells apart are numbered in list order');
const NOABBR = (id, extra) => Object.assign({ id, abbr: '', name: 'Some Version', provider: C.PROVIDER_APIBIBLE }, extra);
const noAbbr = [NOABBR('y-01', { description: 'Catholic' }), NOABBR('y-02')];
eq(noAbbr.map((r) => T.labelFor(r, noAbbr)), ['Some Version, Catholic', 'Some Version, 2'],
  'twins with no abbreviation carry the same ", disambiguator" at the end');
eq(T.labelFor(WEBU('x-01', { description: 'Protestant' }), [NIV]), 'World English Bible Updated (WEBU)',
  'a row with no twin carries no suffix, description or not');

// Twins from different providers are told apart by where they come from (#102 C1).
const WEB_BUILT = { id: 'bundled:engwebp', abbr: 'WEB', name: 'World English Bible', provider: C.PROVIDER_BUNDLED };
const WEB_API = { id: 'abc-01', abbr: 'WEB', name: 'World English Bible', provider: C.PROVIDER_APIBIBLE, description: 'Protestant' };
const webBoth = [WEB_BUILT, WEB_API];
eq(webBoth.map((r) => T.labelFor(r, webBoth)), ['World English Bible, built in (WEB)', 'World English Bible, api.bible (WEB)'],
  'the built-in World English Bible and the api.bible one are named by their source, not by a list-order number or a description');
eq(webBoth.slice().reverse().map((r) => T.labelFor(r, webBoth.slice().reverse())), ['World English Bible, api.bible (WEB)', 'World English Bible, built in (WEB)'],
  '...whichever way the list is ordered');
const webThree = [WEB_BUILT, WEB_API, Object.assign({}, WEB_API, { id: 'abc-02', description: 'Ecumenical' })];
eq(webThree.map((r) => T.labelFor(r, webThree)), [
  'World English Bible, built in (WEB)', 'World English Bible, api.bible, Protestant (WEB)', 'World English Bible, api.bible, Ecumenical (WEB)',
], 'twins from the same provider are still told apart by description, after the provider');
eq(T.labelFor(WEB_BUILT, [WEB_BUILT]), 'World English Bible (WEB)', 'no twin, no provider suffix');
eq(T.labelFor(WEB_API, [WEB_API, NIV]), 'World English Bible (WEB)', '...even for an api.bible row beside an unrelated version');

const WEB_ROW = { id: 'bundled:engwebp', abbr: 'WEB', name: 'World English Bible', provider: C.PROVIDER_BUNDLED || 'bundled' };
const JPN_ROW = T.rowFor('jpn');
console.log("bibleMenu / languageMenu (the Translation toolbar's two rows, #150):");
{
  const mixed = [WEB_ROW, SPA_ROW, NIV, JPN_ROW];
  eq(T.bibleMenu(mixed, { isBible: true }), [
    { id: 'bundled:engwebp', label: 'World English Bible (WEB)' },
    { id: 'niv', label: 'New International Version (NIV)' },
  ], 'the Bible menu holds the Bible rows only, in input order, as a flat list');
  eq(T.bibleMenu(mixed, { isBible: false }), [], 'off the Bible the Bible menu is empty');
  eq(T.bibleMenu([SPA_ROW], { isBible: true }), [], 'no Bible row, no Bible menu');
  eq(T.bibleMenu([WEB_BUILT, WEB_API], { isBible: true }).map((i) => i.label),
    ['World English Bible, built in (WEB)', 'World English Bible, api.bible (WEB)'],
    "labels are labelFor's, twins told apart as in the mixed dropdown");
  eq(T.languageMenu(mixed, { isBible: true }), [
    { id: 'church:spa', label: 'Español — Spanish' },
    { id: 'church:jpn', label: '日本語 — Japanese' },
  ], 'the language menu holds the Church rows only, in input order');
  eq(T.languageMenu(mixed, { isBible: false }), T.languageMenu(mixed, { isBible: true }),
    'the language menu reads the same on and off the Bible');
  eq(T.languageMenu([WEB_ROW, NIV], { isBible: true }), [], 'no Church row, no language menu');
  if (ENG) {
    const onRequest = T.textsFor({ isBible: false, bibleRows: [], languages: ['jpn'], pageLang: 'spa' });
    eq(T.languageMenu(onRequest, { isBible: false }).map((i) => i.id), ['church:jpn', 'church:eng'],
      'English offered on request on a page read in Spanish is a language row');
    eq(T.languageMenu(T.textsFor({ isBible: false, bibleRows: [], languages: ['spa', 'jpn'], pageLang: 'spa' }), { isBible: false }).map((i) => i.id),
      ['church:jpn', 'church:eng'], "the page's own language is not in the menu");
  }
  check(T.languageMenu(mixed).concat(T.bibleMenu(mixed, { isBible: true })).every((i) => Object.keys(i).sort().join() === 'id,label'),
    'neither menu carries a heading: every entry is an item {id, label}');
  eq(T.bibleMenu(), [], 'no list, an empty Bible menu');
  eq(T.languageMenu(), [], '...and an empty language menu');
  // The mixed dropdown's cases, carried to the two menus.
  eq(T.bibleMenu([WEB_ROW], { isBible: true }), [{ id: 'bundled:engwebp', label: 'World English Bible (WEB)' }],
    'Bible chapter, one Bible version: a one-row Bible menu');
  eq(T.languageMenu([SPA_ROW, JPN_ROW]), [
    { id: 'church:spa', label: 'Español — Spanish' },
    { id: 'church:jpn', label: '日本語 — Japanese' },
  ], 'off the Bible: the language rows, as they read today');
  // The version row's selection: the version showing when it is a Bible
  // row of the menu, else the newest Bible pick (a Church language in the
  // panel never blanks it).
  eq(T.versionRow(mixed, { isBible: true, showing: 'niv', picks: ['bundled:engwebp'] }),
    { menu: T.bibleMenu(mixed, { isBible: true }), selected: 'niv' }, 'the version row: the Bible menu at the version showing');
  eq(T.versionRow(mixed, { isBible: true, showing: 'church:spa', picks: ['church:spa', 'niv'] }).selected, 'niv',
    '...a Church language showing: the newest Bible pick');
  eq(T.versionRow(mixed, { isBible: true, showing: null, picks: [] }).selected, 'bundled:engwebp',
    '...no Bible pick: the first Bible row');
  eq(T.versionRow(mixed, { isBible: false, showing: 'church:spa', picks: ['niv'] }), { menu: [], selected: null },
    'off the Bible: no menu, nothing selected');
  eq(T.versionRow(mixed, { showing: 'niv' }), { menu: [], selected: null }, 'isBible missing reads as not the Bible');
  eq(T.textsFor({ bibleRows: [NIV], languages: [] }), [], 'textsFor: isBible missing reads as not the Bible (no Bible rows)');
  check(typeof T.menuFor === 'undefined', 'the mixed dropdown (menuFor) is retired: the two rows read the two menus (#154)');
}

console.log('languagesToAdd:');
{
  const bofmLangs = T.languagesToAdd({ collection: 'bofm', pageLang: 'eng', enabled: [] });
  check(bofmLangs.length > 50, 'a Book of Mormon chapter offers every language publishing the Book of Mormon');
  check(!bofmLangs.some((l) => l.code === 'eng'), "the page's own language is not offered");
  eq(bofmLangs.find((l) => l.code === 'spa'), { code: 'spa', label: 'Spanish — Español' },
    'each reads English name first, so type-ahead finds a language by the name an English reader knows');
  const english = bofmLangs.map((l) => C.CHURCH_LANGUAGES.find((c) => c.code === l.code).english);
  eq(english, english.slice().sort((a, b) => a.localeCompare(b, 'en')), 'one A–Z list by English name, not the table’s coverage groups');
  check(bofmLangs.every((l) => l.label.startsWith(C.CHURCH_LANGUAGES.find((c) => c.code === l.code).english)),
    'every label starts with the English name');
  const all = T.languagesToAdd({ collection: 'bofm', pageLang: 'spa', enabled: [] });
  eq(all.find((l) => l.code === 'eng'), { code: 'eng', label: 'English' }, 'a language named the same in English reads once');
  if (bofmOnly && bibleOnly) {
    const nt = T.languagesToAdd({ collection: 'nt', pageLang: 'eng', enabled: [] }).map((l) => l.code);
    check(nt.includes(bibleOnly.code) && !nt.includes(bofmOnly.code), 'a New Testament chapter offers only languages publishing the New Testament');
  }
  check(!T.languagesToAdd({ collection: 'bofm', pageLang: 'eng', enabled: ['spa'] }).some((l) => l.code === 'spa'),
    'a language already on is not offered again');
}

// ---- chapterUri / apiUrl -----------------------------------------------------
console.log('chapterUri / apiUrl:');
eq(T.chapterUri({ collection: 'dc-testament', ldsBook: 'dc', chapter: '76' }), '/scriptures/dc-testament/dc/76',
  'the uri is the reader path without /study');
eq(T.apiUrl('spa', '/scriptures/bofm/alma/5'),
  '/study/api/v3/language-pages/type/content?lang=spa&uri=%2Fscriptures%2Fbofm%2Falma%2F5',
  'the endpoint is same-origin and the uri is encoded');

// ---- chapterFrom: the markup rule ---------------------------------------------
console.log('chapterFrom (Spanish Alma 5 — header, verses, study notes):');
const ALMA5 = [
  '<header>',
  '<p class="intro" data-aid="1" id="intro1">Las palabras que Alma, el Sumo Sacerdote, proclamó al pueblo.</p>',
  '<p class="study-intro" data-aid="2" id="study_intro1">Comenzando con el capítulo 5.</p>',
  '<p class="title-number" data-aid="3" id="title_number1">Capítulo 5</p>',
  '<p class="study-summary" data-aid="4" id="study_summary1">Para lograr la salvación, los hombres deben arrepentirse. Aproximadamente 83 a.C.</p>',
  '</header>',
  '<div class="body-block">',
  '<p class="verse" data-aid="5" id="p1"><span class="verse-number">1 </span>Aconteció, pues, que Alma empezó a <a class="study-note-ref" href="#note1_a"><sup class="marker" data-value="a"></sup>proclamar</a> la palabra de <a class="study-note-ref" href="#note1_b"><sup class="marker" data-value="b"></sup>Dios</a> al pueblo.</p>',
  '<p class="verse" data-aid="6" id="p2"><span class="verse-number">2 </span><span class="para-mark">¶ </span>Y estas son las palabras.</p>',
  '</div>',
  '<footer class="study-notes"><ul class="marker"><li data-marker="1" id="note1_a"><p data-aid="7" id="note1_a_p1"><a class="scripture-ref" href="/study/x">Alma 4:19</a>.</p></li></ul></footer>',
].join('\n');
let ch = chapter(ALMA5, { title: 'Alma 5', pageAttributes: { 'data-bcp47-lang': 'es' } });
eq(ch.blocks.map((b) => b.type + ':' + (b.style || '')),
  ['para:intro', 'para:intro', 'heading:', 'para:summary', 'para:p', 'para:p'],
  'header paragraphs, the chapter heading, and the verses come out in page order');
eq(ch.blocks[2], { type: 'heading', text: 'Capítulo 5', id: 'title_number1' }, 'the title number is a heading');
eq(ch.blocks.map((b) => b.id), ['intro1', 'study_intro1', 'title_number1', 'study_summary1', 'p1', 'p2'],
  "every block keeps its element's id — the same in every language, which is what the page split pairs on");
eq(T.blockElements(parse(ALMA5)).map((el) => el.getAttribute('id')),
  ['intro1', 'study_intro1', 'title_number1', 'study_summary1', 'p1', 'p2'],
  "blockElements: the elements chapterFrom reads, in page order (the page split walks the English article with it) — the footer's notes aren't blocks");
eq(ch.blocks[4].runs, [
  { t: 'v', n: '1' },
  { t: 'txt', s: 'Aconteció, pues, que Alma empezó a proclamar la palabra de Dios al pueblo.' },
], 'a verse keeps its number and its words, and drops the footnote letters');
eq(ch.blocks[5].runs, [{ t: 'v', n: '2' }, { t: 'txt', s: 'Y estas son las palabras.' }], 'the ¶ mark is dropped');
eq(ch.verses, 2, 'verses counts the numbered verses only');
check(!JSON.stringify(ch.blocks).includes('Alma 4:19'), 'the study-notes footer is dropped whole');
eq([ch.title, ch.bcp47], ['Alma 5', 'es'], 'the title and BCP 47 language come from meta');

console.log('chapterFrom (Spanish Psalm 23 — poetry lines):');
ch = chapter([
  '<header><span class="page-break" data-page="906"></span>',
  '<p class="title-number" id="title_number1">Salmo 23</p>',
  '<p class="intro" id="intro1">Salmo de David.</p></header>',
  '<div class="body-block">',
  '<p class="verse contains-line" id="p2"><span class="verse-number">2 </span><span class="line">En lugares de delicados pastos me hará descansar;</span><span class="line">junto a aguas de reposo me pastoreará.</span></p>',
  '</div>',
].join(''));
eq(ch.blocks[2], { type: 'para', style: 'q1', runs: [
  { t: 'v', n: '2' },
  { t: 'txt', s: 'En lugares de delicados pastos me hará descansar;' },
  { t: 'br' },
  { t: 'txt', s: 'junto a aguas de reposo me pastoreará.' },
], id: 'p2' }, 'each poetry line after the first starts a new row, and the verse is styled as poetry');

console.log('chapterFrom (prose beside poetry lines):');
ch = chapter('<p class="verse contains-line" id="p46"><span class="verse-number">46</span> Entonces María dijo:<span class="line">Engrandece mi alma al Señor;</span><span class="line">y mi espíritu se regocija.</span></p>');
eq(ch.blocks[0].runs, [
  { t: 'v', n: '46' }, { t: 'txt', s: ' Entonces María dijo:' }, { t: 'br' },
  { t: 'txt', s: 'Engrandece mi alma al Señor;' }, { t: 'br' }, { t: 'txt', s: 'y mi espíritu se regocija.' },
], 'prose before the first line ends its row (Luke 1:46)');
ch = chapter('<p class="verse contains-line" id="p23"><span class="verse-number">23 </span><span class="line">y llamarás su nombre Emanuel,</span> <a class="study-note-ref" href="#n"><sup class="marker" data-value="a"></sup>que</a> interpretado es: Dios con nosotros.</p>');
eq(ch.blocks[0].runs.map((r) => r.t), ['v', 'txt', 'br', 'txt'],
  'a line opening the verse needs no break before it, and prose after the last line starts its own row (Matthew 1:23)');
eq(ch.blocks[0].runs[3].s.trim(), 'que interpretado es: Dios con nosotros.', '...with the words intact');

console.log('chapterFrom (Japanese — furigana):');
ch = chapter('<div class="body-block"><p class="verse" id="p1"><span class="verse-number">1　</span><ruby><rb>主</rb><rt>しゅ</rt></ruby>は わたしの<ruby><rb>牧者</rb><rt>ぼくしゃ</rt></ruby>。</p></div>');
eq(ch.blocks[0].runs, [
  { t: 'v', n: '1' },
  { t: 'ruby', s: '主', rt: 'しゅ' },
  { t: 'txt', s: 'は わたしの' },
  { t: 'ruby', s: '牧者', rt: 'ぼくしゃ' },
  { t: 'txt', s: '。' },
], 'ruby keeps its reading; a full-width space after the verse number is trimmed');

ch = chapter('<header><p class="title-number" id="title_number1">第<ruby><rb>1</rb><rt>いち</rt></ruby>章</p><p class="title-number" id="title_number2">第2章</p></header>');
eq(ch.blocks[0], { type: 'heading', text: '第1章', runs: [{ t: 'txt', s: '第' }, { t: 'ruby', s: '1', rt: 'いち' }, { t: 'txt', s: '章' }], id: 'title_number1' },
  'a heading with furigana keeps its readings as runs (text stays the plain fallback)');
eq(ch.blocks[1], { type: 'heading', text: '第2章', id: 'title_number2' }, 'a heading without furigana stays plain text');

console.log('chapterFrom (Psalm 119 — sections with headings):');
ch = chapter('<div class="body-block"><section id="sec_aleph1"><header><h2 id="title1"><span class="language">א</span> <span class="translit">ALEF</span></h2></header><p class="verse" id="p1"><span class="verse-number">1 </span>Bienaventurados.</p></section></div>');
eq(ch.blocks[0], { type: 'heading', text: 'א ALEF', id: 'title1' }, 'a section heading is flattened to its text');
eq(ch.verses, 1, '...and the verses inside the section are found');

console.log('chapterFrom (not a chapter):');
ch = chapter('<header><p class="title" id="title1">Secciones</p></header><ul><li><a href="/x">Sección 1</a></li></ul>');
eq(ch.verses, 0, 'a table-of-contents page has no verses (load reports it as NOT_FOUND)');
eq(chapter('').blocks, [], 'an empty body is no blocks, not a crash');
eq(T.chapterFrom(null, null), { blocks: [], verses: 0, title: '', bcp47: '', dir: '', uri: '' }, 'a missing body and meta are tolerated');

console.log('chapterFrom (ids decide, not classes):');
ch = chapter([
  '<header><h1 id="title1">The <br/><span class="dominant">Doctrine and Covenants</span></h1>',
  '<p class="subtitle" id="subtitle1">His Reign and Ministry</p></header>',
  '<div class="body-block">',
  '<p class="usx-qa" id="title2"><span class="language" lang="heb">ב</span> <span class="translit" lang="heb">Beth</span></p>',
  '<p class="usx-cd" id="study_summary2">Wherewithal shall a young man cleanse his way?</p>',
  '<p class="verse" id="p9"><span class="verse-number">9 </span>Wherewithal shall a young man cleanse his way?</p>',
  '</div>',
].join(''));
eq(ch.blocks.map((b) => b.type + ':' + (b.style || b.text)),
  ['heading:The Doctrine and Covenants', 'para:intro', 'heading:ב Beth', 'para:summary', 'para:p'],
  "English Psalm 119's p.usx-qa#title / p.usx-cd#study_summary are a heading and a summary, like Spanish h2/p.study-summary");

console.log('chapterFrom (text markers, native numerals, merged verses):');
ch = chapter('<div class="body-block"><p class="verse" id="p1"><span class="verse-number">1 </span><span class="marker">*)</span>Siehe, <a class="study-note-ref" href="#note3_a">yeniden<sup class="marker" data-value="r"></sup></a> ich.</p>' +
  '<p class="verse" id="p2"><span class="verse-number">١ </span>في البدء</p>' +
  '<p class="verse" data-eng-ref="3:1,3:2" id="p1.2"><span class="verse-number">1-2</span>Birlikte.</p></div>');
eq(ch.blocks[0].runs, [{ t: 'v', n: '1' }, { t: 'txt', s: 'Siehe, yeniden ich.' }],
  'a text marker (*) and a trailing footnote letter are both dropped');
eq(ch.blocks[1].runs[0], { t: 'v', n: '١' }, 'a verse number keeps its native digits');
eq(ch.blocks[2].runs[0], { t: 'v', n: '1-2' }, 'a merged verse keeps its range');

console.log('servesChapter:');
const one = '<p class="verse" id="p1"><span class="verse-number">1 </span>Texto</p>';
const URI = '/scriptures/ot/mal/4';
check(T.servesChapter(chapter(one, { pageAttributes: { 'data-uri': URI } }), URI), 'the chapter asked for, with verses, is served');
check(!T.servesChapter(chapter(one, { pageAttributes: { 'data-uri': '/scriptures/ot/mal/_contents' } }), URI),
  "a book's contents page answered in the chapter's place is not (German has no Malachi 4)");
check(!T.servesChapter(chapter('<p class="title" id="title1">Secciones</p>', { pageAttributes: { 'data-uri': '/scriptures/ot/_manifest' } }), URI),
  "a volume's contents page (a book the language lacks) is not");
const OD1 = '/scriptures/dc-testament/od/1';
const od = chapter('<header><p class="title-number" id="title_number1">Declaración Oficial 1</p></header>' +
  '<div class="body-block"><p class="salutation" id="p1">A quien corresponda:</p><p id="p2">Se han enviado a la prensa informes.</p></div>',
  { pageAttributes: { 'data-uri': OD1 } });
eq([od.verses, od.blocks.length], [0, 3], 'an Official Declaration has paragraphs but no verse numbers');
check(T.servesChapter(od, OD1), '...and is still the chapter asked for (its uri matches)');
check(!T.servesChapter(chapter('', { pageAttributes: { 'data-uri': URI } }), URI), 'a matching page with nothing in it is not');
check(T.servesChapter(chapter(one, {}), URI), 'a page that names no uri is judged by its verses...');
check(!T.servesChapter(chapter('<p id="p1">Texto</p>', {}), URI), '...so without a uri, no verses means no chapter');
check(!T.servesChapter(null, URI), 'nothing is not a chapter');

console.log('dirOf:');
eq(['ar', 'fa', 'ur', 'es', 'ja', 'zh-Hans', ''].map(T.dirOf), ['rtl', 'rtl', 'rtl', '', '', '', ''],
  'Arabic, Persian and Urdu read right to left; the site does not say so itself');
check(chapter('<p class="verse" id="p1"><span class="verse-number">1 </span><img src="x.png" />Texto</p>').blocks[0].runs
  .every((r) => r.t !== 'img'), 'an image inside a verse is dropped');

// ---- Wiring (greps: the DOM half can't run here) ---------------------------------
console.log('Wiring:');
const src = fs.readFileSync(path.join(ROOT, 'src/content/church-text.js'), 'utf8');
check(/credentials: 'omit'/.test(src), 'the chapter fetch omits credentials (like talk-source live talks)');
check(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'nothing fetched is ever inserted as HTML');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const js = manifest.content_scripts[0].js;
check(js.indexOf('src/content/church-text.js') >= 0, 'church-text.js is a content script');
check(js.indexOf('src/content/church-text.js') < js.indexOf('src/content/content.js'),
  '...loaded before the orchestrator that calls it');
const sanitize = fs.readFileSync(path.join(ROOT, 'src/content/sanitize.js'), 'utf8');
check(/run\.t === 'ruby'/.test(sanitize) && /run\.t === 'br'/.test(sanitize), 'the IR renderer knows ruby and br runs');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
