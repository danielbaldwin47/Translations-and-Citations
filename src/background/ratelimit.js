/*
 * api.bible call accounting: a 15-requests / 30s burst window, and this
 * browser's count of api.bible calls per calendar month with the state it
 * names. Both persist in chrome.storage.local (MV3 workers are killed
 * often). Cache hits call none of this — only real network calls count.
 *
 *   check()                -> { ok: true } | { ok: false, reason: 'window', retryAfterMs }
 *                             the burst window only; never refuses on the month's count
 *   consume(answer)        one chapter request: the burst window, the month's count,
 *                          and api.bible's answer
 *   addCalls(calls, answer) adds `calls` requests outside the burst window (a
 *                          version list: the list, then one lookup per version)
 *   state()                -> the month's rate state, from storage (rateState)
 *   forgetDaily()          removes the daily counters from before the monthly
 *                          count (legacyKeys); the worker calls it on an update
 *
 * consume and addCalls read, change and write one record, so they run one at
 * a time (`serial`): two tabs, or a list refresh beside a chapter, never lose
 * a call. The worker is one context, so an in-memory queue serializes them.
 *
 * `answer` is what api.bible said (answerOf): 'limited', 'answered', or null
 * (no answer, e.g. offline: the last answer stands).
 *
 * The month's record (C.RATE_MONTH_KEY): { month: 'YYYY-MM', count, limited },
 * `limited` = api.bible's last answer said the month is used up. A record
 * from another month reads as a fresh one. Months are the reader's local
 * calendar months.
 *
 * Pure core (module.exports, tools/validate-service-worker.js):
 *   monthOf(date)            -> 'YYYY-MM'
 *   answerOf(result)         -> 'limited' | 'answered' | null, from an api.js result
 *   rateState(record, date)  -> { state: 'ok' | 'near', month }
 *                             | { state: 'paused', month, until: 'YYYY-MM-DD' }
 *   legacyKeys(keys)         -> the stored keys that are old daily counters
 *
 * The rule:
 *   - limited: api.bible answered 429 with no Retry-After, or one of at least
 *     C.RATE_BURST_WAIT_MS (an hour). A 429 naming a shorter wait is api.bible
 *     pacing a burst, which says nothing about the month: it reads as
 *     'answered', so a paid plan's quick 429 never pauses anything.
 *   - paused: limited, and count >= C.RATE_MONTH_FREE (the free plan's 5,000),
 *     until the 1st of next month. A 429 below that is burst handling.
 *   - near: C.RATE_MONTH_NEAR (about 80%) <= count < C.RATE_MONTH_FREE. Past
 *     the free limit with api.bible still answering, the key is on a higher
 *     plan, so "about 80%" would be false: ok.
 *   The worker attaches this state to every api.bible chapter and version-list
 *   answer as `rate`. Nothing here refuses a call on the count: only
 *   api.bible's 429 pauses, so a paid plan's higher limit is never cut short.
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
    const near = r.count >= C.RATE_MONTH_NEAR && r.count < C.RATE_MONTH_FREE;
    return { state: near ? 'near' : 'ok', month: r.month };
  }

  // What api.bible said, for the month's record (the rule in the header).
  function answerOf(result) {
    const e = result && result.error;
    if (!e) return 'answered';
    if (e.code === C.ERR.RATE_LIMITED && e.remote) {
      const wait = Number(e.retryAfterMs);
      const burst = e.retryAfterMs != null && Number.isFinite(wait) && wait < C.RATE_BURST_WAIT_MS;
      return burst ? 'answered' : 'limited';
    }
    return e.code === C.ERR.NETWORK ? null : 'answered';
  }

  // The daily counters the monthly count replaced (#125), one key a day.
  const LEGACY_DAILY_PREFIX = 'btxRateDaily::';
  function legacyKeys(keys) {
    return (keys || []).filter((k) => String(k).startsWith(LEGACY_DAILY_PREFIX));
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

  // One read-modify-write at a time (as cache.js does for its index).
  let queue = Promise.resolve();
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function consume(answer) {
    return serial(async () => {
      const now = Date.now();
      const data = await localGet([C.RATE_RECENT_KEY, C.RATE_MONTH_KEY]);
      const recent = recentOf(data, now);
      recent.push(now);
      await localSet({
        [C.RATE_RECENT_KEY]: recent,
        [C.RATE_MONTH_KEY]: afterCalls(data[C.RATE_MONTH_KEY], new Date(now), 1, answer),
      });
    });
  }

  function addCalls(calls, answer) {
    return serial(async () => {
      const data = await localGet([C.RATE_MONTH_KEY]);
      await localSet({ [C.RATE_MONTH_KEY]: afterCalls(data[C.RATE_MONTH_KEY], new Date(), calls, answer) });
    });
  }

  async function forgetDaily() {
    const stale = legacyKeys(Object.keys(await localGet(null)));
    if (stale.length) await chrome.storage.local.remove(stale);
  }

  async function state() {
    const data = await localGet([C.RATE_MONTH_KEY]);
    return rateState(data[C.RATE_MONTH_KEY], new Date());
  }

  const RATE = { check, consume, addCalls, state, forgetDaily, monthOf, answerOf, rateState, legacyKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = RATE;
  root.__BTX = Object.assign(root.__BTX || {}, { rate: RATE });
})(typeof globalThis !== 'undefined' ? globalThis : this);
