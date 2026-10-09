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
 *   - `update` writes the welcome seen (`welcomeSeen`, #112), keeping every
 *     other setting; `install` leaves it unseen;
 *   - a chapter is requested with `fums-version=3`;
 *   - every display sends GET https://fums.api.bible/f3?t=…&sId=…[&dId=…],
 *     a cache hit too, with the token stored beside the cached chapter;
 *   - no device id exists until a successful Connect (LIST_BIBLES naming a
 *     key); after it, every report carries the same one, kept across worker
 *     restarts, while the session id is new per worker lifetime;
 *   - the reply to the content script carries no FUMS script text or token,
 *     and the content script injects no script;
 *   - the bundled World English Bible (provider `bundled`, #78) is offered and
 *     served on a fresh profile with no key, from the packaged files only: no
 *     api.bible call, no report, nothing cached.
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

function boot(disk, net) {
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
      action: { onClicked: { addListener() {} } },
      tabs: { sendMessage: async () => ({}), create: async (props) => { tabs.push(props); return {}; } },
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
      if (/\/chapters\//.test(url)) return response(200, o.chapter || CHAPTER);
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
