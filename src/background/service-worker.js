/*
 * Background service worker: message router between content scripts / options
 * page and the network + cache + rate-limit layers.
 *
 * Messages (C.MSG):
 *   GET_ENABLED_TRANSLATIONS -> what the panel may offer (translations, Church
 *                               languages, default, hasKey, …)
 *   GET_CHAPTER              -> one chapter as IR, cache first, rate-limited
 *   LIST_BIBLES { key?, refresh? }
 *                            -> the versions on a key (default: the stored one).
 *                               Served from the cache when it holds that key's
 *                               list; `refresh` skips the cache (the options
 *                               page's explicit Connect).
 *   OPEN_OPTIONS { section? } -> opens (or focuses) the options page; a section
 *                               from C.OPTIONS_SECTIONS is parked in
 *                               chrome.storage.session for the page to scroll to.
 *
 * Browser events: the toolbar icon sends TOGGLE_PANEL to the tab, and opens
 * the options page on a tab without our content script; a fresh install opens
 * the options page.
 *
 * Classic (non-module) worker so a single IIFE authoring style works everywhere;
 * dependencies are pulled in with importScripts in dependency order.
 */
'use strict';

importScripts(
  '../shared/constants.js',
  '../shared/settings.js',
  '../shared/books.js',
  './cache.js',
  './ratelimit.js',
  './api.js'
);

const C = self.__BTX.const;
const SETTINGS = self.__BTX.settings;
const API = self.__BTX.api;
const CACHE = self.__BTX.cache;
const RATE = self.__BTX.rate;

// Settings (schema, normalization, caching, invalidation) are owned by
// __BTX.settings — this worker is just one of its adapters.

// ---- Handlers ----
async function handleGetEnabledTranslations() {
  const s = await SETTINGS.get();
  return {
    translations: s.enabledTranslations,
    churchLanguages: s.churchLanguages,
    churchLanguageLayout: s.churchLanguageLayout,
    defaultId: s.defaultTranslationId,
    provider: s.provider,
    hasKey: !!s.apiKey,
    actOnNonEngOnly: s.actOnNonEngOnly,
  };
}

async function handleListBibles(msg) {
  // The options page names the key it is connecting; with none, the stored key.
  const s = await SETTINGS.get();
  const key = msg.key || s.apiKey;
  if (!msg.refresh) {
    const cached = await CACHE.getBibles(key);
    if (cached) return { bibles: cached };
  }
  const result = await API.listBibles(key);
  if (!result.error && result.bibles) await CACHE.setBibles(result.bibles, key);
  return result;
}

async function handleGetChapter(msg) {
  const { provider, bibleId, chapterId, ldsBook, chapter } = msg;
  if (!provider || !bibleId || !chapterId) return { error: { code: C.ERR.UNKNOWN, message: 'Bad request' } };

  // Cache first (does not count against rate limits).
  const cached = await CACHE.getChapter(provider, bibleId, chapterId);
  if (cached) return cached;

  const s = await SETTINGS.get();

  let result;
  if (provider === C.PROVIDER_BIBLEAPI) {
    result = await API.fetchBibleApiChapter(bibleId, ldsBook, chapter);
  } else {
    if (!s.apiKey) return { error: { code: C.ERR.NO_KEY, message: 'No API key set' } };
    const gate = await RATE.check();
    if (!gate.ok) {
      return { error: { code: C.ERR.RATE_LIMITED, message: gate.reason, retryAfterMs: gate.retryAfterMs } };
    }
    result = await API.fetchApiBibleChapter(s.apiKey, bibleId, chapterId);
    await RATE.consume();
  }

  if (result.error) return result;
  await CACHE.setChapter(provider, bibleId, chapterId, result.payload);
  // Forward FUMS only on a fresh fetch (cache hits return above without it).
  return Object.assign({}, result.payload, { fums: result.fums || null });
}

// openOptionsPage reuses an open options tab, which then learns the section
// through storage.session's change event rather than a reload.
async function openOptions(section) {
  if (C.OPTIONS_SECTIONS.indexOf(section) >= 0) {
    try { await chrome.storage.session.set({ [C.OPTIONS_FOCUS_KEY]: section }); } catch (e) { /* page opens at the top */ }
  }
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

// ---- Message router ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  let promise;
  switch (msg.type) {
    case C.MSG.GET_ENABLED_TRANSLATIONS:
      promise = handleGetEnabledTranslations();
      break;
    case C.MSG.GET_CHAPTER:
      promise = handleGetChapter(msg);
      break;
    case C.MSG.LIST_BIBLES:
      promise = handleListBibles(msg);
      break;
    case C.MSG.OPEN_OPTIONS:
      promise = openOptions(msg.section);
      break;
    default:
      return false;
  }
  promise
    .then((res) => sendResponse(res))
    .catch((e) => sendResponse({ error: { code: C.ERR.UNKNOWN, message: String(e) } }));
  return true; // async response
});

// ---- Toolbar icon: show or collapse the panel on this tab ----
// A tab without our content script (another site, a Gospel Library tab opened
// before the extension loaded) has no receiving end; the icon then opens the
// options page, where setup lives. A content script that simply doesn't reply
// is not that case, so only "no receiving end" counts.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: C.MSG.TOGGLE_PANEL }).catch((e) => {
    if (/receiving end does not exist|could not establish connection/i.test(String(e && e.message))) {
      chrome.runtime.openOptionsPage();
    }
  });
});

// ---- First install: open the options page (what works, and where to start) ----
chrome.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === 'install') chrome.runtime.openOptionsPage();
});
