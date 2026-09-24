/*
 * Chapter + bibles-list cache backed by chrome.storage.local.
 * Loaded into the service worker via importScripts -> attaches to self.__BTX.cache.
 *
 *   getChapter(provider, bibleId, chapterId) / setChapter(…, payload)
 *   getBibles(key) / setBibles(bibles, key)
 *
 * Chapters are static text, so they get a long TTL; the cache mainly exists to
 * relieve the api.bible rate limits and make re-navigation instant. An index of
 * { key, ts } records enables simple LRU eviction when the entry count grows.
 *
 * The bibles list has one slot, stamped with a fingerprint of the api.bible key
 * it came from: a list is only ever handed back for the same key. The
 * fingerprint is a hash, so the key itself is stored only in settings.
 */
(function (root) {
  'use strict';

  const C = root.__BTX.const;

  function localGet(keys) {
    return chrome.storage.local.get(keys);
  }
  function localSet(obj) {
    return chrome.storage.local.set(obj);
  }
  function localRemove(keys) {
    return chrome.storage.local.remove(keys);
  }

  function chapterKey(provider, bibleId, chapterId) {
    return `${C.CACHE_PREFIX}${provider}::${bibleId}::${chapterId}`;
  }

  async function getIndex() {
    const data = await localGet(C.CACHE_INDEX_KEY);
    return Array.isArray(data[C.CACHE_INDEX_KEY]) ? data[C.CACHE_INDEX_KEY] : [];
  }
  async function setIndex(index) {
    await localSet({ [C.CACHE_INDEX_KEY]: index });
  }

  // Returns the cached chapter payload if present and fresh, else null.
  async function getChapter(provider, bibleId, chapterId) {
    const key = chapterKey(provider, bibleId, chapterId);
    const data = await localGet(key);
    const entry = data[key];
    if (!entry || typeof entry !== 'object') return null;
    if (Date.now() - entry.ts > C.CHAPTER_TTL_MS) {
      await localRemove(key);
      return null;
    }
    return entry.payload;
  }

  // Stores a chapter payload, refreshing the LRU index and evicting if needed.
  async function setChapter(provider, bibleId, chapterId, payload) {
    const key = chapterKey(provider, bibleId, chapterId);
    const entry = { payload, ts: Date.now() };

    let index = await getIndex();
    index = index.filter((e) => e.key !== key);
    index.push({ key, ts: entry.ts });

    // Evict oldest entries beyond the cap.
    const overflow = index.length - C.CACHE_MAX_ENTRIES;
    let evicted = [];
    if (overflow > 0) {
      index.sort((a, b) => a.ts - b.ts);
      evicted = index.splice(0, overflow).map((e) => e.key);
    }

    try {
      if (evicted.length) await localRemove(evicted);
      await localSet({ [key]: entry });
      await setIndex(index);
    } catch (err) {
      // Quota exceeded: drop the oldest half and retry once.
      index.sort((a, b) => a.ts - b.ts);
      const half = index.splice(0, Math.ceil(index.length / 2)).map((e) => e.key);
      try {
        await localRemove(half);
        await localSet({ [key]: entry });
        await setIndex(index);
      } catch (_) {
        // Give up on caching this entry; not fatal.
      }
    }
  }

  // FNV-1a over the key, plus its length: an identity check, not a secret.
  function keyPrint(key) {
    const s = String(key || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + '.' + s.length;
  }

  async function getBibles(key) {
    const data = await localGet(C.BIBLES_CACHE_KEY);
    const entry = data[C.BIBLES_CACHE_KEY];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.keyPrint !== keyPrint(key)) return null;
    if (Date.now() - entry.ts > C.BIBLES_TTL_MS) return null;
    return entry.bibles;
  }
  async function setBibles(bibles, key) {
    await localSet({ [C.BIBLES_CACHE_KEY]: { bibles, keyPrint: keyPrint(key), ts: Date.now() } });
  }

  root.__BTX.cache = { getChapter, setChapter, getBibles, setBibles };
})(self);
