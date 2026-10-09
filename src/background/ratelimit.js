/*
 * api.bible call accounting: a 15-requests / 30s burst window, and this
 * browser's count of api.bible calls per calendar month with the state it
 * names. Both persist in chrome.storage.local (MV3 workers are killed
 * often). Cache hits call none of this — only real network calls count.
 *
 *   check()               -> { ok: true } | { ok: false, reason: 'window', retryAfterMs }
 *                            the burst window only; never refuses on the month's count
 *   consume(answer)       one chapter request: the burst window, the month's count,
 *                         and api.bible's answer
 *   counted(calls, answer) `calls` requests outside the burst window (a version
 *                         list: the list, then one lookup per version)
 *   state()               -> the month's rate state, from storage (rateState)
 *
 * `answer` is what api.bible said: 'limited' (a 429), 'answered' (anything
 * else it answered), or null (no answer, e.g. offline: the last answer stands).
 *
 * The month's record (C.RATE_MONTH_KEY): { month: 'YYYY-MM', count, limited },
 * `limited` = api.bible's last answer was a 429. A record from another month
 * reads as a fresh one. Months are the reader's local calendar months.
 *
 * Pure core (module.exports, tools/validate-service-worker.js):
 *   monthOf(date)            -> 'YYYY-MM'
 *   rateState(record, date)  -> { state: 'ok' | 'near', month }
 *                             | { state: 'paused', month, until: 'YYYY-MM-DD' }
 *     near:   count >= C.RATE_MONTH_NEAR (about 80% of the free plan);
 *     paused: api.bible's last answer was a 429 and count >= C.RATE_MONTH_FREE,
 *             until the 1st of next month. A 429 below that is burst handling.
 *   The worker attaches this state to every api.bible chapter answer as `rate`.
 *   Nothing here refuses a call on the count: only api.bible's 429 pauses, so a
 *   paid plan's higher limit is never cut short.
 *
 * Loaded via importScripts -> self.__BTX.rate; the same file loads in Node.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);

  // ---- Pure core ----
  const pad2 = (n) => String(n).padStart(2, '0');

  function monthOf(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function firstOfNextMonth(date) {
    const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return `${monthOf(next)}-01`;
  }

  // The stored record as it stands for `date`'s month.
  function monthRecord(stored, date) {
    const month = monthOf(date);
    if (!stored || stored.month !== month) return { month, count: 0, limited: false };
    const count = Number.isFinite(stored.count) && stored.count > 0 ? Math.floor(stored.count) : 0;
    return { month, count, limited: stored.limited === true };
  }

  function rateState(stored, date) {
    const r = monthRecord(stored, date);
    if (r.limited && r.count >= C.RATE_MONTH_FREE) return { state: 'paused', month: r.month, until: firstOfNextMonth(date) };
    return { state: r.count >= C.RATE_MONTH_NEAR ? 'near' : 'ok', month: r.month };
  }

  // The record after `calls` more requests and api.bible's `answer`.
  function afterCalls(stored, date, calls, answer) {
    const r = monthRecord(stored, date);
    const limited = answer === 'limited' ? true : answer === 'answered' ? false : r.limited;
    return { month: r.month, count: r.count + Math.max(0, calls | 0), limited };
  }

  // ---- Storage shell ----
  function localGet(keys) {
    return chrome.storage.local.get(keys);
  }
  function localSet(obj) {
    return chrome.storage.local.set(obj);
  }

  function recentOf(data, now) {
    return (Array.isArray(data[C.RATE_RECENT_KEY]) ? data[C.RATE_RECENT_KEY] : [])
      .filter((t) => now - t < C.RATE_WINDOW_MS);
  }

  async function check() {
    const now = Date.now();
    const recent = recentOf(await localGet([C.RATE_RECENT_KEY]), now);
    if (recent.length >= C.RATE_WINDOW_MAX) {
      const oldest = Math.min.apply(null, recent);
      return { ok: false, reason: 'window', retryAfterMs: C.RATE_WINDOW_MS - (now - oldest) + 50 };
    }
    return { ok: true };
  }

  async function consume(answer) {
    const now = Date.now();
    const data = await localGet([C.RATE_RECENT_KEY, C.RATE_MONTH_KEY]);
    const recent = recentOf(data, now);
    recent.push(now);
    await localSet({
      [C.RATE_RECENT_KEY]: recent,
      [C.RATE_MONTH_KEY]: afterCalls(data[C.RATE_MONTH_KEY], new Date(now), 1, answer),
    });
  }

  async function counted(calls, answer) {
    const data = await localGet([C.RATE_MONTH_KEY]);
    await localSet({ [C.RATE_MONTH_KEY]: afterCalls(data[C.RATE_MONTH_KEY], new Date(), calls, answer) });
  }

  async function state() {
    const data = await localGet([C.RATE_MONTH_KEY]);
    return rateState(data[C.RATE_MONTH_KEY], new Date());
  }

  const RATE = { check, consume, counted, state, monthOf, rateState };
  if (typeof module !== 'undefined' && module.exports) module.exports = RATE;
  root.__BTX = Object.assign(root.__BTX || {}, { rate: RATE });
})(typeof globalThis !== 'undefined' ? globalThis : this);
