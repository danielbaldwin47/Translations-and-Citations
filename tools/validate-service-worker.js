#!/usr/bin/env node
/*
 * No-build checks for the service worker's api.bible usage reporting (FUMS).
 * Run:
 *   node tools/validate-service-worker.js
 *
 * Covers src/background/service-worker.js and src/background/fums.js, driven
 * from the outside: the real worker file runs in a Node vm with its
 * importScripts, chrome.storage and fetch stubbed, and the checks send it
 * messages through its onMessage router and read what it fetched.
 *
 * What it holds (spec #69, A12; #111):
 *   - `install` opens Alma 5 in a new tab and not the settings page; any other
 *     onInstalled reason opens nothing;
 *   - OPEN_WELCOME (the About card's "Show the welcome again", #115) opens that
 *     same Alma 5 tab, through the code install uses;
 *   - `update` writes the welcome seen (`welcomeSeen`, #112), keeping every
 *     other setting; `install` leaves it unseen;
 *   - a chapter is requested with `fums-version=3`;
 *   - every display sends GET https://fums.api.bible/f3?t=…&sId=…[&dId=…],
 *     a cache hit too, with the token stored beside the cached chapter;
 *   - no device id exists until a successful Connect (LIST_BIBLES naming a
 *     key); after it, every report carries the same one, kept across worker
 *     restarts, while the session id is new per worker lifetime;
 *   - GET_TOOLBAR_PIN answers `isOnToolbar` from chrome.action.getUserSettings
 *     (the welcome's pinning line, #114), and null when the API is missing,
 *     throws or says nothing;
 *   - the reply to the content script carries no FUMS script text or token,
 *     and the content script injects no script;
 *   - the bundled World English Bible (provider `bundled`, #78) is offered and
 *     served on a fresh profile with no key, from the packaged files only: no
 *     api.bible call, no report, nothing cached.
 *   - the monthly count (ratelimit.js, #125): calls counted per calendar
 *     month (cache hits not, a Connect's lookups too), rolling over on the 1st;
 *     the pure rateState is near from 4,000 and paused only after api.bible's
 *     429 at or past 5,000, until the 1st of next month; no call refused on
 *     the count; the 15-in-30-seconds window unchanged; every api.bible
 *     chapter answer carries the state as `rate`.
 *
 * Exits non-zero on any failure so it can gate a commit.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const S_NORM = require(path.join(ROOT, 'src/shared/settings.js')).normalize;

let failures = 0;
function check(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); failures++; }
}
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { console.error(`  ✗ ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); failures++; }
}

// ---- A worker in a box -----------------------------------------------------
// `disk` is chrome.storage.local and .sync, shared between boots, so a second
// boot of the worker is the same device after a restart.
function storageArea(store) {
  const pick = (keys) => {
    if (keys == null) return Object.assign({}, store);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of list) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
    return out;
  };
  const done = (cb, v) => { if (typeof cb === 'function') cb(v); return Promise.resolve(v); };
  return {
    get: (keys, cb) => done(cb, pick(keys)),
    set: (obj, cb) => { for (const k of Object.keys(obj)) store[k] = JSON.parse(JSON.stringify(obj[k])); return done(cb); },
    remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; return done(cb); },
  };
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body };
}

const CHAPTER = {
  data: {
    reference: 'John 3',
    copyright: 'NIV copyright line',
    content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [
      { type: 'tag', name: 'verse', attrs: { number: '1' }, items: [{ type: 'text', text: '1' }] },
      { type: 'text', text: 'Now there was a Pharisee…' },
    ] }],
  },
  meta: { fumsToken: 'TOKEN-1' },
};
const LIST = { data: [{ id: 'niv', name: 'New International Version', abbreviationLocal: 'NIV', description: 'Holy Bible' }] };

function boot(disk, net, action, tabsApi) {
  const listeners = [];
  const installed = [];
  const tabs = [];
  const opened = []; // openOptionsPage calls
  const ctx = {
    console,
    URL, URLSearchParams, setTimeout, clearTimeout, Promise,
    crypto: require('crypto').webcrypto,
    chrome: {
      storage: {
        local: storageArea(disk.local),
        sync: storageArea(disk.sync),
        session: storageArea({}),
        onChanged: { addListener() {} },
      },
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onInstalled: { addListener: (fn) => installed.push(fn) },
        openOptionsPage: async () => { opened.push(1); },
      },
      action: Object.assign({ onClicked: { addListener() {} } }, action || {}),
      tabs: Object.assign({ sendMessage: async () => ({}), create: async (props) => { tabs.push(props); return {}; } }, tabsApi || {}),
    },
    fetch: async (url) => {
      url = String(url);
      net.calls.push(url);
      return net.answer(url);
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  const dir = path.join(ROOT, 'src/background');
  ctx.importScripts = (...files) => {
    for (const f of files) {
      const file = path.resolve(dir, f);
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    }
  };
  const file = path.join(dir, 'service-worker.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const send = (msg) => new Promise((resolve) => {
    const async = listeners.some((fn) => fn(msg, {}, resolve) === true);
    if (!async) resolve(undefined);
  });
  const install = (reason) => { for (const fn of installed) fn({ reason }); };
  return { send, install, tabs, opened };
}

// The api.bible side: a chapter with its token, a version list, or a refusal.
function apiBible(opts) {
  const o = opts || {};
  const calls = [];
  return {
    calls,
    answer(url) {
      if (url.startsWith('https://fums.api.bible/')) return response(200, {});
      if (/\/bibles\?language=eng$/.test(url)) {
        return o.badKey ? response(403, { message: 'Invalid API key' }) : response(200, LIST);
      }
      if (/\/chapters\//.test(url)) return o.chapterStatus ? response(o.chapterStatus, {}) : response(200, o.chapter || CHAPTER);
      if (/\/bibles\/[^/]+$/.test(url)) return response(200, { data: { copyright: 'All rights reserved.' } });
      return response(404, {});
    },
    chapters: () => calls.filter((u) => /\/chapters\//.test(u)),
    reports: () => calls.filter((u) => u.startsWith('https://fums.api.bible/')).map((u) => new URL(u)),
  };
}

const freshDisk = () => ({
  local: {},
  sync: { [C.SETTINGS_KEY]: { apiKey: 'KEY', enabledTranslations: [{ id: 'niv', abbr: 'NIV', name: 'New International Version', provider: C.PROVIDER_APIBIBLE }], defaultTranslationId: 'niv' } },
});
const GET_JOHN_3 = { type: C.MSG.GET_CHAPTER, provider: C.PROVIDER_APIBIBLE, bibleId: 'niv', chapterId: 'JHN.3', ldsBook: 'john', chapter: 3 };
const CONNECT = { type: C.MSG.LIST_BIBLES, key: 'KEY', refresh: true };
const flush = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  console.log('FUMS reporting (service-worker.js, fums.js):');

  // ---- before Connect: reports, but no device id ----
  {
    const disk = freshDisk();
    const net = apiBible();
    const w = boot(disk, net);

    const first = await w.send(GET_JOHN_3);
    await flush();
    check(first && Array.isArray(first.blocks) && first.blocks.length === 1, 'a fresh fetch answers with the chapter');
    eq(net.chapters().length, 1, 'a fresh display fetches the chapter once');
    check(net.chapters().every((u) => new URL(u).searchParams.get('fums-version') === '3'), 'the chapter is requested with fums-version=3');
    const r1 = net.reports();
    eq(r1.length, 1, 'a fresh fetch sends one usage report');
    if (r1[0]) {
      eq(r1[0].origin + r1[0].pathname, 'https://fums.api.bible/f3', 'the report goes to the FUMS f3 endpoint');
      eq(r1[0].searchParams.getAll('t'), ['TOKEN-1'], 'the report carries the response\'s token');
      check(!!r1[0].searchParams.get('sId'), 'the report carries a session id');
      check(!r1[0].searchParams.has('dId'), 'before Connect the report carries no device id');
    }
    check(!('fums' in first) && !('fumsToken' in first), 'the reply carries no FUMS script text or token');

    const again = await w.send(GET_JOHN_3);
    await flush();
    eq(net.chapters().length, 1, 'a second display is a cache hit (no chapter fetch)');
    check(again && JSON.stringify(again.blocks) === JSON.stringify(first.blocks), 'the cache hit answers with the same chapter');
    const r2 = net.reports();
    eq(r2.length, 2, 'a cache hit sends a usage report too');
    if (r2[1]) {
      eq(r2[1].searchParams.getAll('t'), ['TOKEN-1'], 'the cache hit reports the token stored with the cached chapter');
      eq(r2[1].searchParams.get('sId'), r2[0].searchParams.get('sId'), 'one worker lifetime keeps one session id');
      check(!r2[1].searchParams.has('dId'), 'a cache hit before Connect carries no device id');
    }
    check(!('fums' in again) && !('fumsToken' in again), 'the cache hit\'s reply carries no FUMS token');
  }

  // ---- a failed Connect creates no device id ----
  {
    const disk = freshDisk();
    const net = apiBible({ badKey: true });
    const w = boot(disk, net);
    const listed = await w.send(CONNECT);
    check(listed && listed.error, 'a rejected key fails to connect');
    await w.send(GET_JOHN_3);
    await flush();
    const r = net.reports();
    check(r.length === 1 && !r[0].searchParams.has('dId'), 'a failed Connect leaves the reports without a device id');
  }

  // ---- after a successful Connect: one device id, kept across restarts ----
  {
    const disk = freshDisk();
    const net = apiBible();
    const w = boot(disk, net);
    const listed = await w.send(CONNECT);
    check(listed && Array.isArray(listed.bibles), 'Connect lists the key\'s versions');
    await w.send(GET_JOHN_3);
    await w.send(GET_JOHN_3);
    await flush();
    const r = net.reports();
    eq(r.length, 2, 'after Connect, a fresh fetch and a cache hit each report');
    const dId = r[0] && r[0].searchParams.get('dId');
    check(!!dId, 'after Connect the report carries a device id');
    check(r[1] && r[1].searchParams.get('dId') === dId, 'the cache hit carries the same device id');

    // Connecting again does not mint a new device.
    await w.send(CONNECT);
    await w.send(GET_JOHN_3);
    await flush();
    eq(net.reports()[2] && net.reports()[2].searchParams.get('dId'), dId, 'a later Connect keeps the device id');

    // The worker restarts: same device, new session; the stored token is still reported.
    const net2 = apiBible();
    const w2 = boot(disk, net2);
    await w2.send(GET_JOHN_3);
    await flush();
    eq(net2.chapters().length, 0, 'after a restart the chapter is still a cache hit');
    const r2 = net2.reports();
    eq(r2.length, 1, 'after a restart the cache hit reports');
    if (r2[0]) {
      eq(r2[0].searchParams.getAll('t'), ['TOKEN-1'], 'the stored token survives the restart');
      eq(r2[0].searchParams.get('dId'), dId, 'the device id survives a worker restart');
      check(r2[0].searchParams.get('sId') && r2[0].searchParams.get('sId') !== r[0].searchParams.get('sId'),
        'a new worker lifetime has a new session id');
    }
    check(!JSON.stringify(disk.sync).includes(dId), 'the device id is never written to sync storage');
  }

  // ---- a chapter with no token reports nothing ----
  {
    const disk = freshDisk();
    const net = apiBible({ chapter: Object.assign({}, CHAPTER, { meta: {} }) });
    const w = boot(disk, net);
    const res = await w.send(GET_JOHN_3);
    await w.send(GET_JOHN_3);
    await flush();
    check(res && Array.isArray(res.blocks), 'a chapter without a token still displays');
    eq(net.reports().length, 0, 'no token, no report');
  }

  // ---- the bundled World English Bible: no key, no network, no report ----
  {
    const disk = { local: {}, sync: {} }; // a fresh profile: no key, no settings
    const calls = [];
    const net = {
      calls,
      // The packaged files, by their path inside the extension.
      answer(url) {
        const file = path.join(ROOT, url);
        if (/^https?:/.test(url) || !fs.existsSync(file)) return response(404, {});
        return response(200, JSON.parse(fs.readFileSync(file, 'utf8')));
      },
    };
    const w = boot(disk, net);
    const enabled = await w.send({ type: C.MSG.GET_ENABLED_TRANSLATIONS });
    eq(enabled && enabled.translations.map((t) => [t.id, t.provider]), [[C.BUNDLED_BIBLE.id, C.PROVIDER_BUNDLED]],
      'a fresh profile offers the World English Bible');
    eq(enabled && enabled.defaultId, C.BUNDLED_BIBLE.id, '...as the default translation');
    const GET_WEB = { type: C.MSG.GET_CHAPTER, provider: C.PROVIDER_BUNDLED, bibleId: C.BUNDLED_BIBLE.id, chapterId: 'JHN.3', ldsBook: 'john', chapter: 3 };
    const web = await w.send(GET_WEB);
    await w.send(GET_WEB);
    await flush();
    check(web && Array.isArray(web.blocks) && web.blocks.length > 0, 'John 3 in the World English Bible displays with no key');
    eq(web && web.copyright, C.BUNDLED_BIBLE.copyright, '...under the ebible.org public-domain line');
    check(calls.length > 0 && calls.every((u) => u.startsWith(C.BUNDLED_BIBLE.dir + '/')), 'it reads only the packaged files: no api.bible call, no usage report');
    eq(Object.keys(disk.local), [], 'nothing is cached or counted against the rate limit');
  }

  // ---- install opens Alma 5 in Gospel Library, not the settings page (#111) ----
  {
    const ALMA_5 = 'https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/5?lang=eng';
    const w = boot({ local: {}, sync: {} }, apiBible());
    w.install('install');
    await flush();
    eq(w.tabs.map((t) => t.url), [ALMA_5], 'install opens one new tab at Alma 5 in English');
    eq(w.opened.length, 0, 'install does not open the settings page');

    for (const reason of ['update', 'chrome_update', 'shared_module_update']) {
      const u = boot({ local: {}, sync: {} }, apiBible());
      u.install(reason);
      await flush();
      check(u.tabs.length === 0 && u.opened.length === 0, `"${reason}" opens no tab and no settings page`);
    }
  }

  // ---- a tab that won't open is no unhandled rejection (#111) ----
  // chrome.tabs.create can reject (a policy, a closing browser): install's
  // own call has no one to answer, so the worker catches it; OPEN_WELCOME
  // answers with the error, which the options page says under its button.
  {
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    const warn = console.warn;
    const warned = [];
    console.warn = (...a) => warned.push(a.join(' '));
    const refuse = { create: async () => { throw new Error('Tabs cannot be edited right now'); } };
    boot({ local: {}, sync: {} }, apiBible(), undefined, refuse).install('install');
    const reply = await boot({ local: {}, sync: {} }, apiBible(), undefined, refuse).send({ type: C.MSG.OPEN_WELCOME });
    await flush();
    await new Promise((r) => setImmediate(r));
    process.removeListener('unhandledRejection', onUnhandled);
    console.warn = warn;
    eq(unhandled.length, 0, 'install whose tab is refused leaves no unhandled rejection');
    check(warned.some((w) => /welcome tab/.test(w)), '...it is logged instead');
    check(reply && reply.error && reply.ok !== true, 'OPEN_WELCOME whose tab is refused answers with an error, not ok');
  }

  // ---- OPEN_WELCOME opens the same Alma 5 tab install does (#115) ----
  {
    const w = boot({ local: {}, sync: {} }, apiBible());
    eq(C.MSG.OPEN_WELCOME, 'OPEN_WELCOME', 'the message type lives in C.MSG');
    const reply = await w.send({ type: C.MSG.OPEN_WELCOME });
    await flush();
    eq(w.tabs.map((t) => t.url), [C.FIRST_RUN_URL], 'OPEN_WELCOME creates one tab at Alma 5 in English, the URL install opens');
    eq(reply && reply.ok, true, '...and answers ok');
    eq(w.opened.length, 0, '...without opening the settings page');
    const inst = boot({ local: {}, sync: {} }, apiBible());
    inst.install('install');
    await flush();
    eq(inst.tabs.map((t) => t.url), w.tabs.map((t) => t.url), 'install and OPEN_WELCOME open the same tab');
  }

  // ---- an update never greets: it marks the welcome seen (#112) ----
  // A profile from before the welcome has no flag, which reads as not seen; the
  // update writes it true through __BTX.settings. A fresh install leaves it
  // false, so Alma 5 opens with the welcome up.
  {
    const seen = (disk) => S_NORM(disk.sync[C.SETTINGS_KEY]).welcomeSeen;
    const old = { local: {}, sync: { [C.SETTINGS_KEY]: { panelMode: 'translation', churchLanguages: ['spa'] } } };
    const u = boot(old, apiBible());
    u.install('update');
    await flush();
    eq(seen(old), true, 'update writes the welcome seen');
    eq(S_NORM(old.sync[C.SETTINGS_KEY]).churchLanguages, ['spa'], '...and keeps the reader\'s other settings');
    eq(old.sync[C.SETTINGS_KEY].panelMode, 'translation', '...the stored mode included');

    const fresh = { local: {}, sync: {} };
    const i = boot(fresh, apiBible());
    i.install('install');
    await flush();
    eq(seen(fresh), false, 'install leaves the welcome unseen');
  }

  // ---- the welcome's pinning line: is the icon on the toolbar? (#114) ----
  // Content scripts can't call chrome.action.getUserSettings; the worker does,
  // and answers { isOnToolbar } — null when it can't tell (old Chrome without
  // the API, or an error), which the panel treats as "not pinned".
  {
    const ask = (action) => boot({ local: {}, sync: {} }, apiBible(), action).send({ type: C.MSG.GET_TOOLBAR_PIN });
    check(typeof C.MSG.GET_TOOLBAR_PIN === 'string' && C.MSG.GET_TOOLBAR_PIN, 'the message type lives in C.MSG');
    eq(await ask({ getUserSettings: async () => ({ isOnToolbar: false }) }), { isOnToolbar: false }, 'icon not on the toolbar: answers isOnToolbar false');
    eq(await ask({ getUserSettings: async () => ({ isOnToolbar: true }) }), { isOnToolbar: true }, 'icon pinned: answers isOnToolbar true');
    eq(await ask(undefined), { isOnToolbar: null }, 'getUserSettings missing (old Chrome): answers unknown');
    eq(await ask({ getUserSettings: async () => { throw new Error('boom'); } }), { isOnToolbar: null }, 'getUserSettings throws: answers unknown');
    eq(await ask({ getUserSettings: async () => ({}) }), { isOnToolbar: null }, 'getUserSettings answers without isOnToolbar: unknown');
  }

  // ---- the monthly count and its state (#125) ----
  // api.bible's free plan allows 5,000 calls a month. The worker counts this
  // browser's api.bible calls per calendar month and turns the count, the
  // date and api.bible's last answer into a state it attaches to every
  // api.bible chapter answer. It never refuses a call on that count: only
  // api.bible's own 429, at or past the free plan's limit, pauses anything.
  console.log('Monthly count (ratelimit.js):');
  let R = null;
  try { R = require(path.join(ROOT, 'src/background/ratelimit.js')); } catch (e) { R = null; }
  check(R && typeof R.rateState === 'function', 'ratelimit.js exports its pure rule to Node (module.exports)');
  if (R && typeof R.rateState === 'function') {
    const oct9 = new Date(2026, 9, 9, 14, 0);
    const lastMinute = new Date(2026, 9, 31, 23, 59, 59);
    const nov1 = new Date(2026, 10, 1, 0, 0, 1);
    const dec31 = new Date(2026, 11, 31, 12, 0);
    const rec = (count, limited, month) => ({ month: month || '2026-10', count, limited: !!limited });

    eq(R.monthOf(oct9), '2026-10', 'the month is the calendar month');
    eq(R.monthOf(lastMinute), '2026-10', '...through the last minute of its last day');
    eq(R.monthOf(nov1), '2026-11', '...and the next one starts on the 1st');
    eq(R.rateState(rec(4500), lastMinute), { state: 'near', month: '2026-10' }, '4,500 calls on October 31: near');
    eq(R.rateState(rec(4500), nov1), { state: 'ok', month: '2026-11' }, 'the count rolls over on the 1st: ok again');
    eq(R.rateState(rec(5200, true), nov1), { state: 'ok', month: '2026-11' }, '...a pause ends with its month');
    eq(R.rateState(null, oct9), { state: 'ok', month: '2026-10' }, 'nothing counted yet: ok');

    eq(R.rateState(rec(3999), oct9).state, 'ok', 'below about 80% of 5,000: ok');
    eq(R.rateState(rec(4000), oct9).state, 'near', 'from 4,000 (80% of 5,000): near');
    eq(R.rateState(rec(5000), oct9).state, 'near', 'at the limit with api.bible still answering: near, not paused');
    eq(R.rateState(rec(50000), oct9).state, 'near', '...at 50,000 too (a paid plan is never cut short)');

    eq(R.rateState(rec(5000, true), oct9), { state: 'paused', month: '2026-10', until: '2026-11-01' },
      'a 429 at the limit: paused until the 1st of next month');
    eq(R.rateState(rec(6000, true, '2026-12'), dec31).until, '2027-01-01', '...December pauses until January 1 of the next year');
    eq(R.rateState(rec(4999, true), oct9).state, 'near', 'a 429 below the limit is not a pause (burst handling)');
    eq(R.rateState(rec(10, true), oct9).state, 'ok', '...nor far below it');
  }

  // The worker's side: the count on disk, the state on the answer.
  {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const firstOfNext = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
    const KEY = C.RATE_MONTH_KEY;
    check(typeof KEY === 'string' && KEY.length > 0, 'the monthly count has its storage key in C');
    const seeded = (count, limited) => {
      const disk = freshDisk();
      if (count != null) disk.local[KEY] = { month, count, limited: !!limited };
      return disk;
    };
    const chapterOf = (n) => Object.assign({}, GET_JOHN_3, { chapterId: `JHN.${n}`, chapter: n });

    // A fresh profile: the first call starts the month's count.
    {
      const disk = seeded(null);
      const net = apiBible();
      const w = boot(disk, net);
      const first = await w.send(GET_JOHN_3);
      eq(disk.local[KEY] && disk.local[KEY].count, 1, 'a chapter fetched from api.bible counts one call this month');
      eq(disk.local[KEY] && disk.local[KEY].month, month, '...under this month');
      eq(first && first.rate, { state: 'ok', month }, 'the chapter answer carries the state: ok');
      const again = await w.send(GET_JOHN_3);
      eq(disk.local[KEY].count, 1, 'a cache hit does not count');
      eq(again && again.rate, { state: 'ok', month }, '...and carries the state too');
      check(!Object.keys(disk.local).some((k) => /^btxRateDaily::/.test(k)), 'no daily counter is written');
      await w.send(CONNECT);
      eq(disk.local[KEY].count, 3, 'a Connect counts its calls too (the list, then one lookup per version)');
    }

    // Last month's count does not carry over.
    {
      const disk = freshDisk();
      disk.local[KEY] = { month: '1999-12', count: 4999, limited: true };
      const w = boot(disk, apiBible());
      const res = await w.send(GET_JOHN_3);
      eq(disk.local[KEY], { month, count: 1, limited: false }, 'a new month starts the count again');
      eq(res && res.rate && res.rate.state, 'ok', '...and its state is ok');
    }

    // No call is refused on the count alone.
    for (const count of [4000, 5000, 50000]) {
      const disk = seeded(count);
      const net = apiBible();
      const w = boot(disk, net);
      const res = await w.send(GET_JOHN_3);
      eq(net.chapters().length, 1, `at ${count} calls this month the chapter is still fetched`);
      check(res && Array.isArray(res.blocks), '...and shown');
      eq(res && res.rate, { state: 'near', month }, '...with the state near');
      eq(disk.local[KEY].count, count + 1, '...counted');
    }

    // api.bible refuses at the limit: paused, until the 1st of next month.
    {
      const disk = seeded(4999);
      const w = boot(disk, apiBible({ chapterStatus: 429 }));
      const res = await w.send(GET_JOHN_3);
      eq(res && res.error && [res.error.code, res.error.remote], [C.ERR.RATE_LIMITED, true], 'a 429 at the limit is api.bible refusing');
      eq(res && res.rate, { state: 'paused', month, until: firstOfNext }, '...and the state is paused until the 1st of next month');
      // Still asked again: only api.bible's answer decides.
      const net2 = apiBible();
      const w2 = boot(disk, net2);
      const after = await w2.send(chapterOf(4));
      eq(net2.chapters().length, 1, 'while paused, the next chapter still asks api.bible');
      eq(after && after.rate && after.rate.state, 'near', '...and an answer from api.bible ends the pause');
      check(after && Array.isArray(after.blocks), '...showing the chapter');
    }
    {
      const disk = seeded(5000);
      await boot(disk, apiBible()).send(GET_JOHN_3); // fetched and cached
      const w2 = boot(disk, apiBible({ chapterStatus: 429 }));
      const refused = await w2.send(chapterOf(5));
      eq(refused && refused.rate && refused.rate.state, 'paused', 'api.bible refusing past the limit pauses');
      const cached = await w2.send(GET_JOHN_3);
      check(cached && Array.isArray(cached.blocks), 'while paused, a chapter already read still opens');
      eq(cached && cached.rate && cached.rate.state, 'paused', '...its answer carries the pause');
    }

    // A 429 below the limit stays burst handling.
    {
      const disk = seeded(100);
      const w = boot(disk, apiBible({ chapterStatus: 429 }));
      const res = await w.send(GET_JOHN_3);
      eq(res && res.error && res.error.code, C.ERR.RATE_LIMITED, 'a 429 below the limit is still RATE_LIMITED');
      eq(res && res.rate && res.rate.state, 'ok', '...but not a pause');
    }

    // The burst window is unchanged: 15 calls in 30 seconds, then a short wait.
    {
      const disk = seeded(0);
      const net = apiBible();
      const w = boot(disk, net);
      for (let n = 1; n <= C.RATE_WINDOW_MAX; n++) await w.send(chapterOf(n));
      eq(net.chapters().length, 15, '15 chapters in a row are fetched');
      const sixteenth = await w.send(chapterOf(16));
      eq(net.chapters().length, 15, 'the 16th within 30 seconds is not');
      eq(sixteenth && sixteenth.error && sixteenth.error.code, C.ERR.RATE_LIMITED, '...it is rate-limited');
      check(sixteenth && sixteenth.error && !sixteenth.error.remote && sixteenth.error.retryAfterMs > 0
        && sixteenth.error.retryAfterMs <= C.RATE_WINDOW_MS + 50, '...by the local window, with a wait of at most 30 seconds');
      eq(sixteenth && sixteenth.rate && sixteenth.rate.state, 'ok', '...carrying the state');
      eq(disk.local[KEY].count, 15, 'a call the window held back is not counted');
      eq([C.RATE_WINDOW_MS, C.RATE_WINDOW_MAX], [30000, 15], 'the window stays 15 calls in 30 seconds');
      check(!('RATE_DAILY_MAX' in C) && !('RATE_DAILY_PREFIX' in C), 'the daily cap is gone');
    }
  }

  // ---- the page gets no script; the manifest lets the worker reach FUMS ----
  const content = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
  check(!/fums/i.test(content), 'the content script has no FUMS code');
  check(!/createElement\(\s*['"]script['"]\s*\)/.test(content), 'the content script creates no <script> element');
  const api = fs.readFileSync(path.join(ROOT, 'src/background/api.js'), 'utf8');
  check(!/fumsJs/.test(api), 'the worker no longer reads or returns FUMS script text');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  check(manifest.host_permissions.includes('https://fums.api.bible/*'), 'the FUMS host is a host permission');

  // ---- fums.js follows the module pattern: Node can require its pure half ----
  let fums = null;
  try { fums = require(path.join(ROOT, 'src/background/fums.js')); } catch (e) { fums = null; }
  check(fums && typeof fums.reportUrl === 'function', 'fums.js exports its API to Node (module.exports)');
  if (fums && typeof fums.reportUrl === 'function') {
    eq(fums.reportUrl('T', null, 'S'), `${C.FUMS_BASE}/f3?t=T&sId=S`, 'reportUrl: no device id, no dId');
    eq(fums.reportUrl('T', 'D', 'S'), `${C.FUMS_BASE}/f3?t=T&dId=D&sId=S`, 'reportUrl: the device id before the session id');
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All service-worker checks passed.');
}

run().catch((e) => { console.error(e); process.exit(1); });
