#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const BOOKS = require(path.join(ROOT, 'src/shared/books.js'));
const CT = require(path.join(ROOT, 'src/content/church-text.js'));
const P = require(path.join(ROOT, 'src/content/panel.js'));
const CONTENT = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
const DETECT = fs.readFileSync(path.join(ROOT, 'src/content/detect.js'), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

function reader({ deferSettings = false, deferSelection = false } = {}) {
  const state = P.createState({ mode: 'translation' });
  const paints = [];
  const settingsReads = [];
  const selectionReads = [];
  const chapterReads = new Map();
  const loaded = new Map();
  let visible = false;
  let navigate;
  let handlers;
  const location = { pathname: '/study/scriptures/bofm/alma/5', search: '?lang=eng', hash: '' };
  const enabled = {
    translations: [], churchLanguages: ['spa'], churchLanguageLayout: 'panel',
    churchLanguageShown: true, defaultId: '', hasKey: false,
  };
  const panel = {
    HANDLED_KEYS: [], init: async (callbacks) => { handlers = callbacks; }, getRootEl: () => null,
    showChapter: (chapter) => {
      P.setChapter(state, chapter);
      visible = true;
      paints.push({ kind: 'chapter', key: chapter.key });
    },
    hide: () => { visible = false; paints.push({ kind: 'hide' }); },
    arrangement: (facts) => facts ? P.arrangement({ ...state, ...facts }) : P.arrangementOf(state),
    arrange: (facts) => {
      P.setChapter(state, { ...facts, key: state.chapter });
      return P.arrangementOf(state);
    },
    effectiveMode: () => P.effectiveMode(state), citationView: () => 'source',
    languageRow: () => ({}), populateTranslations: () => {}, setNote: () => {},
    showView: (spec) => spec.render({}), showTranslation: (view) => paints.push(view),
  };
  const churchText = {
    ...CT,
    checkKey: (parsed, lang) => `${lang}|${CT.chapterUri(parsed)}`,
    checkResults: (parsed, langs) => Object.fromEntries(langs.filter((lang) =>
      loaded.has(churchText.checkKey(parsed, lang))).map((lang) => [lang, 'found'])),
    load: (parsed, lang) => {
      const key = churchText.checkKey(parsed, lang);
      if (loaded.has(key)) return Promise.resolve(loaded.get(key));
      if (!chapterReads.has(key)) {
        let complete;
        const promise = new Promise((resolve) => { complete = resolve; });
        chapterReads.set(key, {
          promise,
          resolve: () => {
            const result = { blocks: [{ type: 'para', runs: [{ t: 'txt', s: `Spanish ${parsed.chapter}` }] }], bcp47: 'es' };
            loaded.set(key, result);
            chapterReads.delete(key);
            complete(result);
          },
        });
      }
      return chapterReads.get(key).promise;
    },
  };
  const sandbox = {
    __BTX: {
      const: C, books: BOOKS, settings: { subscribe: () => {}, patch: () => {} },
      panel, churchText, citPanel: { render: () => {} }, talkView: {},
      theme: { mirror: () => ({ refresh: () => {} }) },
      pageSplit: { start: () => {}, hide: () => {}, wantsSplit: () => false },
    },
    location, URLSearchParams, document: { getElementById: () => null },
    window: { addEventListener: () => {} }, setTimeout, clearTimeout,
    chrome: {
      runtime: {
        sendMessage: (message, callback) => {
          assert.equal(message.type, C.MSG.GET_ENABLED_TRANSLATIONS);
          if (deferSettings) settingsReads.push(() => callback(enabled));
          else callback(enabled);
        },
        onMessage: { addListener: () => {} },
      },
      storage: {
        local: {
          get: (key, callback) => {
            if (deferSelection) selectionReads.push(() => callback({}));
            else callback({});
          },
          set: (value, callback) => callback(),
        },
        onChanged: { addListener: () => {} },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(DETECT, sandbox);
  sandbox.__BTX.detect.setupNavigation = (callback) => { navigate = callback; };
  vm.runInContext(CONTENT, sandbox);
  return {
    paints, settingsReads, selectionReads, chapterReads,
    visible: () => visible, chapter: () => state.chapter,
    renderMode: () => handlers.renderMode(),
    go: (pathname, hash = '') => {
      location.pathname = pathname;
      location.hash = hash;
      return navigate();
    },
    finishChapter: async (chapter = '5') => {
      const pending = chapterReads.get(`spa|/scriptures/bofm/alma/${chapter}`);
      assert.ok(pending, `Alma ${chapter} has a pending language request`);
      pending.resolve();
      await flush();
    },
  };
}

const ALMA5 = '/study/scriptures/bofm/alma/5';
const ALMA6 = '/study/scriptures/bofm/alma/6';
const NON_CHAPTER = '/study/general-conference/2026/10';

for (const anchorEvent of [false, true]) {
  test(`language chapter finishes${anchorEvent ? ' after a same-chapter verse anchor' : ' without navigation'}`, async () => {
    const r = reader();
    await flush();
    assert.equal(r.paints.at(-1).kind, 'loading');
    if (anchorEvent) await r.go(ALMA5, '#p3');
    await r.finishChapter();
    assert.equal(r.paints.at(-1).kind, 'content');
    assert.equal(r.paints.at(-1).blocks[0].runs[0].s, 'Spanish 5');
    assert.equal(r.paints.filter((view) => view.kind === 'chapter').length, 1);
  });
}

for (const pause of ['settings', 'selection']) {
  test(`leaving while ${pause} loads keeps the panel hidden`, async () => {
    const r = reader({ deferSettings: pause === 'settings', deferSelection: pause === 'selection' });
    await flush();
    await r.go(NON_CHAPTER);
    assert.equal(r.visible(), false);
    const pending = pause === 'settings' ? r.settingsReads : r.selectionReads;
    assert.equal(pending.length, 1);
    pending.shift()();
    await flush();
    assert.equal(r.visible(), false);
    assert.equal(r.paints.filter((view) => view.kind === 'chapter').length, 0);
    assert.equal(r.chapterReads.size, 0);
  });
}

for (const pause of ['settings', 'selection']) {
  test(`new chapter wins while ${pause} from the old chapter loads`, async () => {
    const r = reader({ deferSettings: pause === 'settings', deferSelection: pause === 'selection' });
    await flush();
    const navigation = r.go(ALMA6);
    await flush();
    const pending = pause === 'settings' ? r.settingsReads : r.selectionReads;
    if (pause === 'settings') {
      assert.equal(pending.length, 2);
      pending.pop()();
      await flush();
      pending.shift()();
    } else {
      assert.equal(pending.length, 1);
      pending.shift()();
    }
    await flush();
    await r.finishChapter('6');
    await navigation;
    assert.equal(r.chapter(), 'bofm/alma/6/eng');
    assert.deepEqual(r.paints.filter((view) => view.kind === 'chapter').map((view) => view.key), ['bofm/alma/6/eng']);
    assert.equal(r.paints.at(-1).blocks[0].runs[0].s, 'Spanish 6');
  });
}

for (const pause of ['settings', 'selection']) {
  test(`leaving during a mode render's ${pause} read cancels that render`, async () => {
    const r = reader({ deferSettings: pause === 'settings', deferSelection: pause === 'selection' });
    await flush();
    r.renderMode();
    await flush();
    await r.go(NON_CHAPTER);
    const pending = pause === 'settings' ? r.settingsReads : r.selectionReads;
    assert.equal(pending.length, pause === 'settings' ? 2 : 1);
    while (pending.length) pending.shift()();
    await flush();
    assert.equal(r.visible(), false);
    assert.equal(r.paints.at(-1).kind, 'hide');
    assert.equal(r.chapterReads.size, 0);
  });
}

test('leaving while a language check loads keeps the panel hidden', async () => {
  const r = reader();
  await flush();
  await r.go(NON_CHAPTER);
  await r.finishChapter();
  assert.equal(r.visible(), false);
  assert.equal(r.paints.at(-1).kind, 'hide');
});
