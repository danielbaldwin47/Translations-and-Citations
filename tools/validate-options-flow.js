#!/usr/bin/env node
/*
 * Options-page workflows with the production scripts, a small DOM and controlled
 * Chrome callbacks. Run: node tools/validate-options-flow.js
 * The fixture defers provider replies and storage completions, then checks the
 * visible key/status and saved settings. No API requests or browser dependency.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { parseHtml } = require('./mini-dom.js');
const ROOT = path.resolve(__dirname, '..');
const C = require('../src/shared/constants.js');
const S = require('../src/shared/settings.js');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const bible = { id: 'niv-test', name: 'New International Version', abbr: 'NIV', copyright: 'Copyright', provider: C.PROVIDER_APIBIBLE };

async function options() {
  const document = parseHtml(fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8'));
  const decorated = new WeakSet();
  function decorate(n) {
    if (decorated.has(n)) return n;
    decorated.add(n);
    const events = new Map();
    n.style = {}; n.dataset = {};
    n.addEventListener = (type, fn) => { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); };
    n.dispatch = (type) => { for (const fn of events.get(type) || []) fn({ target: n, type, preventDefault() {} }); };
    n.focus = () => { document.activeElement = n; };
    n.click = () => { if (!n.disabled) n.dispatch('click'); };
    n.replaceChildren = (...nodes) => { n.textContent = ''; n.append(...nodes); };
    n.contains = (target) => { for (let p = target; p; p = p.parentNode) if (p === n) return true; return false; };
    const getClassList = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(n), 'classList').get;
    Object.defineProperty(n, 'classList', { get() { const c = getClassList.call(n); c.toggle = (cls, on) => (on ? c.add(cls) : c.remove(cls)); return c; } });
    for (const key of ['type', 'id']) Object.defineProperty(n, key, { get: () => n.getAttribute(key) || '', set: (v) => n.setAttribute(key, v) });
    for (const key of ['checked', 'disabled', 'hidden']) Object.defineProperty(n, key, { get: () => n.hasAttribute(key), set: (v) => v ? n.setAttribute(key, '') : n.removeAttribute(key) });
    Object.defineProperty(n, 'value', { get: () => n.getAttribute('value') ?? (n.tagName === 'SELECT' ? n.children[0]?.value || '' : ''), set: (v) => n.setAttribute('value', String(v)) });
    n.scrollIntoView = () => {};
    for (const child of n.children) decorate(child);
    return n;
  }
  decorate(document.documentElement);
  const create = document.createElement.bind(document);
  document.createElement = (tag) => decorate(create(tag));
  document.getElementById = (id) => document.querySelector('#' + id);
  document.activeElement = document.body;
  const store = { sync: {}, local: {}, session: {} };
  const requests = [], writes = [], listeners = [], timers = new Map();
  let clock = 0, timerId = 0, hold = false;
  const deferred = [];
  const runtime = { getManifest: () => ({ version: '1.0.0' }), sendMessage: (message, callback) => requests.push({ message, callback }) };
  const area = (name) => ({
    get(keys, cb) {
      const all = store[name];
      const data = keys == null ? { ...all } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in all).map((k) => [k, all[k]]));
      if (cb) { queueMicrotask(() => cb(structuredClone(data))); return; }
      return Promise.resolve(structuredClone(data));
    },
    set(values, cb) {
      const complete = (fail = false) => {
        if (!fail) {
          const changes = {};
          for (const [k, v] of Object.entries(values)) { changes[k] = { oldValue: store[name][k], newValue: structuredClone(v) }; store[name][k] = structuredClone(v); }
          writes.push({ name, values: structuredClone(values) });
          listeners.forEach((fn) => fn(changes, name));
        }
        runtime.lastError = fail ? { message: 'Test storage refused' } : null;
        if (cb) cb();
        runtime.lastError = null;
      };
      if (hold && name === 'sync') deferred.push(complete); else queueMicrotask(complete);
      return Promise.resolve();
    },
    remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[name][k]; return Promise.resolve(); },
  });
  const sandbox = {
    document, location: { hash: '' }, window: { addEventListener() {} },
    chrome: { runtime, storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: { addListener: (fn) => listeners.push(fn) } } },
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, getComputedStyle: () => ({ marginTop: '0px' }),
    __BTX: { const: C, rateCopy: require('../src/shared/rate-copy.js'), churchText: require('../src/content/church-text.js'), citVM: require('../src/citations/cit-view-model.js'), citData: { loadPack: async () => ({ descriptor: null }) }, cache: { getBibles: async () => [] } },
  };
  vm.createContext(sandbox);
  for (const file of ['src/shared/settings.js', 'src/options/options.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  await flush();
  assert(document.body.hasAttribute('data-ready'));
  const el = (id) => document.getElementById(id);
  const edit = (key, change = false) => { el('apiKey').value = key; el('apiKey').dispatch('input'); if (change) el('apiKey').dispatch('change'); };
  const advance = async (ms = 700) => {
    clock += ms;
    for (;;) {
      const due = [...timers].find(([, t]) => t.at <= clock);
      if (!due) break;
      timers.delete(due[0]); due[1].fn(); await flush();
    }
    await flush();
  };
  return {
    edit, advance, requests, deferred, writes,
    connect: (key) => { edit(key); el('connectKey').click(); },
    reply: (index, result = { bibles: [bible] }) => requests[index].callback(result),
    holdWrites: () => { hold = true; }, releaseWrites: () => { hold = false; },
    saved: () => store.sync[C.SETTINGS_KEY] || S.defaults(),
    field: () => el('apiKey').value, status: () => el('keyStatus').textContent,
    connectEnabled: () => !el('connectKey').disabled, saveStatus: () => el('saveStatus').textContent,
  };
}

test('unchanged Connect saves its key and displays Connected', async () => {
  const o = await options(); o.connect('key-A'); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, 'key-A'); assert.match(o.status(), /Connected/);
});
test('input normalizing to the same key keeps its pending Connect', async () => {
  const o = await options(); o.connect('key-A'); o.edit(' key-A '); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, 'key-A'); assert.match(o.status(), /Connected/);
});
test('editing a pending key discards its successful response', async () => {
  const o = await options(); o.connect('key-A'); o.edit('key-B'); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, ''); assert.equal(o.field(), 'key-B'); assert.doesNotMatch(o.status(), /Connected/); assert(o.connectEnabled());
});
test('clearing a pending key discards its successful response', async () => {
  const o = await options(); o.connect('key-A'); o.edit('', true); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, ''); assert.equal(o.field(), ''); assert.equal(o.status(), '');
});
test('an older failure cannot replace the newer key status', async () => {
  const o = await options(); o.connect('key-A'); o.edit('key-B'); o.reply(0, { error: { code: C.ERR.INVALID_KEY } }); await o.advance();
  assert.equal(o.field(), 'key-B'); assert.equal(o.status(), ''); assert(o.connectEnabled());
});
test('a newer Connect owns storage and status when the older reply arrives last', async () => {
  const o = await options(); o.connect('key-A'); o.connect('key-B');
  assert.equal(o.requests.length, 2); o.reply(1); await o.advance(); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, 'key-B'); assert.equal(o.field(), 'key-B'); assert.match(o.status(), /Connected/);
});
test('clearing during a pending successful save persists the cleared field', async () => {
  const o = await options(); o.holdWrites(); o.connect('key-A'); o.reply(0); await o.advance();
  assert.equal(o.deferred.length, 1); o.edit('', true); o.releaseWrites(); o.deferred.shift()(); await o.advance();
  assert.equal(o.saved().apiKey, ''); assert.equal(o.field(), ''); assert.equal(o.status(), '');
});
test('editing during a pending successful save keeps the fresh field pending', async () => {
  const o = await options(); o.holdWrites(); o.connect('key-A'); o.reply(0); await o.advance();
  o.edit('key-B'); o.releaseWrites(); o.deferred.shift()(); await o.advance();
  assert.equal(o.saved().apiKey, 'key-A'); assert.equal(o.field(), 'key-B'); assert.doesNotMatch(o.status(), /Connected/); assert(o.connectEnabled());
});
test('failed Connect save rolls back and offers retry', async () => {
  const o = await options(); o.holdWrites(); o.connect('key-A'); o.reply(0); await o.advance();
  o.deferred.shift()(true); await o.advance();
  assert.equal(o.saved().apiKey, ''); assert.equal(o.field(), ''); assert.doesNotMatch(o.status(), /Connected/); assert.match(o.saveStatus(), /Try again/);
});
test('a refused older save preserves input typed while it was pending', async () => {
  const o = await options(); o.holdWrites(); o.connect('key-A'); o.reply(0); await o.advance();
  o.edit('key-B'); o.deferred.shift()(true); await o.advance();
  assert.equal(o.saved().apiKey, ''); assert.equal(o.field(), 'key-B'); assert.doesNotMatch(o.status(), /Connected/); assert(o.connectEnabled());
});
test('editing away and back during an auto-try tries the key again', async () => {
  const o = await options(); o.edit('key-A', true); await o.advance();
  assert.equal(o.requests.length, 1); o.edit('key-B'); o.edit('key-A', true); await o.advance();
  assert.equal(o.requests.length, 2); o.reply(0); await o.advance();
  assert.equal(o.saved().apiKey, ''); o.reply(1); await o.advance();
  assert.equal(o.saved().apiKey, 'key-A'); assert.match(o.status(), /Connected/);
});
