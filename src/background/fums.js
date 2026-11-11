/*
 * api.bible usage reporting (FUMS), sent by the service worker as a packaged
 * HTTP request — never a script on the page (Chrome Web Store remote-code
 * rule; spec #69, A12).
 *
 *   report(token)    -> Promise; sends GET {C.FUMS_BASE}/f3?t=…&dId=…&sId=…
 *                       for one chapter display, fire-and-forget (a failed
 *                       report is dropped). No token, no report.
 *   connected()      -> Promise; creates the device id if there is none.
 *                       Called on a successful Connect only: the Connect
 *                       click, beside the disclosure sentence
 *                       (C.DISCLOSURE.apiBible), is the reader's consent.
 *   reportUrl(token, deviceId, sessionId) -> string (pure)
 *
 * The worker calls report on every api.bible chapter display, a cache hit
 * too, with the token api.bible returned for that chapter (stored beside the
 * cached chapter). The device id lives in chrome.storage.local under
 * C.FUMS_DEVICE_KEY — on this device only, never sync. Until it exists a
 * report carries no `dId`. The session id is minted when this file loads,
 * so it lasts one worker lifetime.
 *
 * IIFE -> __BTX.fums (loaded via importScripts in the worker; + module.exports
 * so Node can require the pure reportUrl). Covered by
 * tools/validate-service-worker.js.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);
  const SESSION_ID = root.crypto.randomUUID();

  function reportUrl(token, deviceId, sessionId) {
    const q = new URLSearchParams({ t: token });
    if (deviceId) q.set('dId', deviceId);
    q.set('sId', sessionId);
    return `${C.FUMS_BASE}/f3?${q}`;
  }

  async function deviceId() {
    try {
      const data = await chrome.storage.local.get(C.FUMS_DEVICE_KEY);
      return data[C.FUMS_DEVICE_KEY] || null;
    } catch (e) { return null; }
  }

  async function connected() {
    if (await deviceId()) return;
    try { await chrome.storage.local.set({ [C.FUMS_DEVICE_KEY]: root.crypto.randomUUID() }); } catch (e) { /* next Connect tries again */ }
  }

  // Resolves once the request is on its way; the display doesn't wait on it.
  async function report(token) {
    if (!token) return;
    const url = reportUrl(token, await deviceId(), SESSION_ID);
    fetch(url, { credentials: 'omit' }).catch(() => {});
  }

  const API = { report, connected, reportUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { fums: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
