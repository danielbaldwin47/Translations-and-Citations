/*
 * Background service worker: message router between content scripts / options
 * page and the network + cache + rate-limit layers.
 *
 * Messages (C.MSG):
 *   GET_ENABLED_TRANSLATIONS -> what the panel may offer (translations, Church
 *                               languages, default, hasKey, …)
 *   GET_CHAPTER              -> one chapter as IR. api.bible: cache first,
 *                               rate-limited; a rejected key also drops the
 *                               cached version list. Every api.bible display,
 *                               a cache hit too, sends a FUMS usage report
 *                               (fums.js) with the token cached beside the
 *                               chapter; the reply carries neither the token
 *                               nor any script. `bundled` (the World English
 *                               Bible): read from the packaged files, no key,
 *                               limiter, cache or usage report
 *   LIST_BIBLES { key?, refresh? }
 *                            -> the versions on a key (default: the stored one).
 *                               Served from the cache when it holds that key's
 *                               list; `refresh` skips the cache (the options
 *                               page's explicit Connect). A `partial` list
 *                               (a copyright lookup failed) is passed on but
 *                               never cached. One refresh costs 1 + one call
 *                               per version (~39) against a monthly quota.
 *                               A list for a named `key` is the options page's
 *                               Connect: once it succeeds, the FUMS device id
 *                               exists (the click was the consent).
 *   OPEN_OPTIONS { section? } -> opens (or focuses) the options page; a section
 *                               from C.OPTIONS_SECTIONS is parked in
 *                               chrome.storage.session for the page to scroll to.
 *
 * Browser events: the toolbar icon sends TOGGLE_PANEL to the tab. It opens
 * the options page instead on a tab without our content script, and on a
 * Gospel Library page showing no chapter (the reply says `shown: false`); a
 * fresh install (reason `install`, never an update) opens Alma 5 in a new tab.
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
  './api.js',
  './fums.js'
);

const C = self.__BTX.const;
const SETTINGS = self.__BTX.settings;
const API = self.__BTX.api;
const CACHE = self.__BTX.cache;
const RATE = self.__BTX.rate;
const FUMS = self.__BTX.fums;

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
    noTranslationLineDismissed: s.noTranslationLineDismissed,
  };
}

async function handleListBibles(msg) {
  // The options page names the key it is connecting; with none, the stored key.
  const s = await SETTINGS.get();
  const key = msg.key || s.apiKey;
  const cached = msg.refresh ? null : await CACHE.getBibles(key);
  let result;
  if (cached) {
    result = { bibles: cached };
  } else {
    result = await API.listBibles(key);
    if (!result.error && result.bibles && !result.partial) await CACHE.setBibles(result.bibles, key);
  }
  // A Connect that succeeded (the options page named its key), cached or not.
  if (!result.error && msg.key) await FUMS.connected();
  return result;
}

async function handleGetChapter(msg) {
  const { provider, bibleId, chapterId } = msg;
  if (!provider || !bibleId || !chapterId) return { error: { code: C.ERR.UNKNOWN, message: 'Bad request' } };

  // The bundled Bible is read from the extension's own files: no key, no
  // rate limiter, no usage report, and nothing worth caching.
  if (provider === C.PROVIDER_BUNDLED) {
    const bundled = await API.fetchBundledChapter(bibleId, chapterId);
    return bundled.error ? bundled : bundled.payload;
  }

  // Cache first (does not count against rate limits). An api.bible chapter
  // is cached with its FUMS token, reported on every display.
  const cached = await CACHE.getChapter(provider, bibleId, chapterId);
  if (cached) return displayed(cached);

  const s = await SETTINGS.get();
  if (!s.apiKey) return { error: { code: C.ERR.NO_KEY, message: 'No API key set' } };
  const gate = await RATE.check();
  if (!gate.ok) {
    return { error: { code: C.ERR.RATE_LIMITED, message: gate.reason, retryAfterMs: gate.retryAfterMs } };
  }
  const result = await API.fetchApiBibleChapter(s.apiKey, bibleId, chapterId);
  await RATE.consume();
  // The stored key stopped working: its cached version list would still tell
  // the options page "Connected", so the page fetches afresh and says why.
  if (result.error && result.error.code === C.ERR.INVALID_KEY) await CACHE.dropBibles();

  if (result.error) return result;
  const entry = result.fumsToken ? Object.assign({}, result.payload, { fumsToken: result.fumsToken }) : result.payload;
  await CACHE.setChapter(provider, bibleId, chapterId, entry);
  return displayed(entry);
}

// A chapter on its way to the page: report its token, then hand back the
// chapter without it.
async function displayed(entry) {
  const { fumsToken, ...payload } = entry;
  if (fumsToken) await FUMS.report(fumsToken);
  return payload;
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
// The icon always does something visible. With no panel to toggle it opens the
// options page, where setup lives: a tab without our content script (another
// site, a Gospel Library tab opened before the extension loaded) has no
// receiving end, and a Gospel Library page with no chapter replies
// `shown: false`. A content script that simply doesn't reply, or replies
// without `shown` (an older one), is neither case.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: C.MSG.TOGGLE_PANEL }).then((reply) => {
    if (reply && reply.shown === false) chrome.runtime.openOptionsPage();
  }, (e) => {
    if (/receiving end does not exist|could not establish connection/i.test(String(e && e.message))) {
      chrome.runtime.openOptionsPage();
    }
  });
});

// ---- First install: open Alma 5, where the panel is already at work ----
// `install` only: an update, a browser update or a shared-module update opens nothing.
chrome.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === 'install') chrome.tabs.create({ url: C.FIRST_RUN_URL });
});
