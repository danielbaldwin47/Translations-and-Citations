/*
 * The monthly-limit lines (spec #101), one copy for every page that says
 * them: the panel (content script) and the options page. Pure, no DOM, no
 * storage; the inputs are the month's rate state the worker attaches to
 * api.bible answers (background/ratelimit.js rateState):
 *   { state: 'ok' | 'near' | 'paused', month: 'YYYY-MM', until?: 'YYYY-MM-DD' }.
 *
 *   pausedLine(until)        -> "api.bible’s free monthly limit is reached. Back on {Month D}."
 *                               (the date dropped when `until` isn't one)
 *   nearLine(rate, seenMonth) -> "You’re at about 80% of api.bible’s free monthly limit."
 *                               when `rate` is near and its month isn't `seenMonth`
 *                               (the 'YYYY-MM' it was last shown), else ''
 *   monthDay(until)          -> 'November 1', or '' when `until` isn't a date
 *
 * Both lines are worded about the plan's limit: no version name, no call
 * counts (the count is this browser's alone). The panel re-exports them as
 * its own (tools/validate-panel-state.js); the options page's Connect line
 * uses pausedLine (tools/validate-options-form.js).
 *
 * Loaded as a content script and by options.html -> __BTX.rateCopy; the same
 * file loads in Node (module.exports).
 */
(function (root) {
  'use strict';

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function monthDay(until) {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(until || ''));
    const month = m && MONTH_NAMES[Number(m[1]) - 1];
    return month && Number(m[2]) >= 1 ? `${month} ${Number(m[2])}` : '';
  }

  function pausedLine(until) {
    const day = monthDay(until);
    return day ? `api.bible’s free monthly limit is reached. Back on ${day}.` : 'api.bible’s free monthly limit is reached.';
  }

  function nearLine(rate, seenMonth) {
    if (!rate || rate.state !== 'near' || !/^\d{4}-\d{2}$/.test(String(rate.month || ''))) return '';
    if (rate.month === seenMonth) return '';
    return 'You’re at about 80% of api.bible’s free monthly limit.';
  }

  const RATE_COPY = { monthDay, pausedLine, nearLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = RATE_COPY;
  root.__BTX = Object.assign(root.__BTX || {}, { rateCopy: RATE_COPY });
})(typeof globalThis !== 'undefined' ? globalThis : this);
