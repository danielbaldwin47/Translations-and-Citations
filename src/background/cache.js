/*
 * Chapter + bibles-list cache backed by chrome.storage.local.
 * Loaded into the service worker via importScripts -> attaches to self.__BTX.cache,
 * and into the options page (<script src>), which reads the version list for
 * its first paint.
 *
 *   getChapter(provider, bibleId, chapterId) / setChapter(…, payload)
 *   getBibles(key, { anyAge }?) / setBibles(bibles, key) / dropBibles()
 *
 * getBibles hands back only a list younger than C.BIBLES_TTL_MS unless
 * `anyAge` — the options page draws a stale list at once while the worker
 * refreshes it.
 *
 * Chapters are static text, so they get a long TTL; the cache mainly exists to
 * relieve the api.bible rate limits and make re-navigation instant. An index of
 * { key, ts, verses } records drives eviction; `ts` is when the chapter was
 * last written or read (the entry's own `ts`, which the TTL reads, is its write
 * time).
 *
 * The verse cap (#127): api.bible's terms ask a cache to hold fewer than 500
 * consecutive verses, so after every write the api.bible chapters held total
 * fewer than C.CACHE_MAX_VERSES (500) verses, least recently read dropped
 * first. `verses` is counted from the IR's verse markers (`versesIn`); the
 * rule is the pure `dropKeys(index, keepKey)`. A record with no count (written
 * before the cap existed) is dropped before any counted one, since its size is
 * unknown; reading such a chapter fills the count in. The chapter just written
 * is never dropped, so it re-reads from the cache. The 500-entry cap and the
 * 30-day TTL stay as outer bounds. The bundled Bible is never cached.
 * Covered by tools/validate-service-worker.js.
 *
 * The bibles list has one slot, stamped with a fingerprint of the api.bible key
 * it came from: a list is only ever handed back for the same key. The
 * fingerprint is a hash, so the key itself is stored only in settings. A key
 * api.bible has since rejected (regenerated, revoked) still fingerprints the
 * same, so the worker drops the slot when that happens.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);

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

  // ---- The verse cap (pure) ----

  // Verses in an IR payload: its distinct verse markers. A chapter with none
  // counts as one, so a chapter never weighs nothing.
  function versesIn(payload) {
    const seen = new Set();
    const blocks = payload && Array.isArray(payload.blocks) ? payload.blocks : [];
    for (const b of blocks) {
      for (const r of (b && Array.isArray(b.runs) ? b.runs : [])) {
        if (r && r.t === 'v') seen.add(String(r.n));
      }
    }
    return Math.max(1, seen.size);
  }

  const APIBIBLE_PREFIX = `${C.CACHE_PREFIX}${C.PROVIDER_APIBIBLE}::`;
  const hasCount = (r) => Number.isInteger(r.verses) && r.verses > 0;

  // The keys to drop so the api.bible records left total fewer than `cap`
  // verses. Records with no count go first; then the least recently read.
  // `keepKey` (the chapter just written) is never dropped.
  function dropKeys(index, keepKey, cap) {
    const limit = cap === undefined ? C.CACHE_MAX_VERSES : cap;
    const api = (Array.isArray(index) ? index : []).filter((r) => r && String(r.key).startsWith(APIBIBLE_PREFIX));
    const byAge = (a, b) => a.ts - b.ts;
    const drop = api.filter((r) => r.key !== keepKey && !hasCount(r)).sort(byAge).map((r) => r.key);
    const counted = api.filter((r) => hasCount(r));
    let total = counted.reduce((n, r) => n + r.verses, 0);
    for (const r of counted.filter((x) => x.key !== keepKey).sort(byAge)) {
      if (total < limit) break;
      drop.push(r.key);
      total -= r.verses;
    }
    return drop;
  }

  // Index changes are read-modify-write; one at a time keeps a read's touch
  // from overwriting a write's evictions.
  let queue = Promise.resolve();
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  // Returns the cached chapter payload if present and fresh, else null. A read
  // makes the chapter the most recently read.
  async function getChapter(provider, bibleId, chapterId) {
    const key = chapterKey(provider, bibleId, chapterId);
    const data = await localGet(key);
    const entry = data[key];
    if (!entry || typeof entry !== 'object') return null;
    if (Date.now() - entry.ts > C.CHAPTER_TTL_MS) {
      await localRemove(key);
      await serial(async () => setIndex((await getIndex()).filter((e) => e.key !== key))).catch(() => {});
      return null;
    }
    await touch(key, entry.payload).catch(() => {}); // a failed touch never costs the reader the chapter
    return entry.payload;
  }

  async function touch(key, payload) {
    await serial(async () => {
      const index = await getIndex();
      const rec = index.find((e) => e.key === key);
      if (!rec) return;
      rec.ts = Date.now();
      if (!hasCount(rec)) rec.verses = versesIn(payload);
      await setIndex(index);
    });
  }

  // Stores a chapter payload, refreshing the LRU index and evicting past the
  // entry cap and the verse cap.
  function setChapter(provider, bibleId, chapterId, payload) {
    return serial(() => write(provider, bibleId, chapterId, payload));
  }

  async function write(provider, bibleId, chapterId, payload) {
    const key = chapterKey(provider, bibleId, chapterId);
    const entry = { payload, ts: Date.now() };

    let index = await getIndex();
    index = index.filter((e) => e.key !== key);
    index.push({ key, ts: entry.ts, verses: versesIn(payload) });

    // Evict oldest entries beyond the entry cap, then past the verse cap.
    const overflow = index.length - C.CACHE_MAX_ENTRIES;
    let evicted = [];
    if (overflow > 0) {
      index.sort((a, b) => a.ts - b.ts);
      evicted = index.filter((e) => e.key !== key).slice(0, overflow).map((e) => e.key);
    }
    evicted = evicted.concat(dropKeys(index.filter((e) => !evicted.includes(e.key)), key));
    index = index.filter((e) => !evicted.includes(e.key));

    try {
      if (evicted.length) await localRemove(evicted);
      await localSet({ [key]: entry });
      await setIndex(index);
    } catch (err) {
      // Quota exceeded: drop the oldest half (never this chapter) and retry once.
      index.sort((a, b) => a.ts - b.ts);
      const half = index.filter((e) => e.key !== key).slice(0, Math.ceil(index.length / 2)).map((e) => e.key);
      index = index.filter((e) => !half.includes(e.key));
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

  async function getBibles(key, opts) {
    const data = await localGet(C.BIBLES_CACHE_KEY);
    const entry = data[C.BIBLES_CACHE_KEY];
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.bibles)) return null;
    if (entry.keyPrint !== keyPrint(key)) return null;
    if (!(opts && opts.anyAge) && Date.now() - entry.ts > C.BIBLES_TTL_MS) return null;
    return entry.bibles;
  }
  async function setBibles(bibles, key) {
    await localSet({ [C.BIBLES_CACHE_KEY]: { bibles, keyPrint: keyPrint(key), ts: Date.now() } });
  }
  async function dropBibles() {
    await localRemove(C.BIBLES_CACHE_KEY);
  }

  const API = { getChapter, setChapter, getBibles, setBibles, dropBibles, versesIn, dropKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { cache: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
