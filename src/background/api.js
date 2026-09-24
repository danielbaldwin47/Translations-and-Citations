/*
 * Network layer. All fetches happen here, in the service worker, where
 * host_permissions let us call the APIs without content-script CORS problems.
 *
 *   listBibles(key)                      -> { bibles: [{ id, name, abbr, description, copyright, provider }], partial? } | { error }
 *   fetchApiBibleChapter(key, id, chap)  -> { payload: { blocks, copyright, reference }, fums } | { error }
 *   fetchBibleApiChapter(id, book, chap) -> { payload } | { error }
 *
 * `partial: true` means a per-version copyright lookup failed, so some rows
 * carry no copyright and nobody can tell which versions the reader added to
 * the key: the worker doesn't cache such a list, and the options page says so.
 *
 * Errors are { error: { code, message, remote?, retryAfterMs? } } with a code
 * from C.ERR. api.bible answers both a wrong key and a version the key isn't
 * licensed for with 403, so `errorFor` reads the body: "Invalid API key" is
 * INVALID_KEY (as is 401, a missing key); any other 403 is FORBIDDEN. A 429
 * from api.bible is RATE_LIMITED with `remote: true` (the worker's own
 * limiter sends the same code without it), plus `retryAfterMs` when the
 * response names a wait in Retry-After (seconds or an HTTP date); with no
 * Retry-After there is no `retryAfterMs` — nobody knows how long to wait.
 *
 * Both providers are normalized to one simple, safe intermediate representation
 * (IR) that the content script renders with text nodes only (no innerHTML):
 *
 *   blocks: [
 *     { type: 'heading', text },
 *     { type: 'para', style, runs: [ {t:'v', n:'3'} | {t:'txt', s:'...', wj:bool} ] }
 *   ]
 *
 * Loaded via importScripts -> self.__BTX.api. The same file loads in Node
 * (module.exports) so tools/validate-options-form.js can drive listBibles and
 * errorFor against a stubbed fetch, and check retryAfterMs.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);
  const BOOKS = (root.__BTX && root.__BTX.books)
    || (typeof require === 'function' ? require('../shared/books.js') : null);
  const ERR = C.ERR;

  function err(code, message) {
    return { error: { code, message: message || code } };
  }

  // ---- api.bible: list available English bibles for a key ----
  async function listBibles(key) {
    if (!key) return err(ERR.NO_KEY);
    let res;
    try {
      res = await fetch(`${C.API_BIBLE_BASE}/bibles?language=eng`, {
        headers: { 'api-key': key },
      });
    } catch (e) {
      return err(ERR.NETWORK, String(e));
    }
    if (!res.ok) return errorFor(res);
    const json = await res.json();
    const bibles = (json.data || []).map((b) => ({
      id: b.id,
      name: b.name,
      abbr: b.abbreviationLocal || b.abbreviation || '',
      // api.bible's edition note ('Protestant', 'Catholic', …): the only thing
      // that tells apart rows sharing an abbreviation and name.
      description: b.description || '',
      copyright: b.copyrightStatement || b.copyright || '',
      provider: C.PROVIDER_APIBIBLE,
    }));
    // The list endpoint usually omits copyright, which the options page needs to
    // tell free (public-domain/CC) versions from the copyrighted ones the user
    // added. Backfill it from the per-version endpoint (parallel, capped).
    const failed = await fillCopyrights(key, bibles.filter((b) => !b.copyright));
    return failed ? { bibles, partial: true } : { bibles };
  }

  // Fill in each bible's copyright from GET /bibles/{id}, with limited
  // concurrency. Best-effort: a failed lookup leaves copyright empty (the
  // version still shows). Resolves with how many lookups failed.
  async function fillCopyrights(key, list) {
    if (!list.length) return 0;
    const CONCURRENCY = 6;
    let i = 0;
    let failed = 0;
    async function worker() {
      while (i < list.length) {
        const b = list[i++];
        try {
          const r = await fetch(`${C.API_BIBLE_BASE}/bibles/${encodeURIComponent(b.id)}`, {
            headers: { 'api-key': key },
          });
          if (!r.ok) { failed++; continue; }
          const j = await r.json();
          const d = j.data || {};
          b.copyright = d.copyright || d.copyrightStatement || '';
        } catch (e) { failed++; }
      }
    }
    const workers = [];
    for (let k = 0; k < Math.min(CONCURRENCY, list.length); k++) workers.push(worker());
    await Promise.all(workers);
    return failed;
  }

  // ---- Map a failed response -> error ----
  // api.bible: see the header for why the body decides between INVALID_KEY
  // and FORBIDDEN.
  async function errorFor(res) {
    const status = res.status;
    if (status === 403) {
      const body = await res.json().catch(() => ({}));
      const invalid = /invalid api key/i.test((body && body.message) || '');
      return err(invalid ? ERR.INVALID_KEY : ERR.FORBIDDEN, `HTTP ${status}`);
    }
    const out = err(statusToErr(status), `HTTP ${status}`);
    if (status === 429) {
      out.error.remote = true;
      const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
      const wait = retryAfterMs(header, Date.now());
      if (wait !== undefined) out.error.retryAfterMs = wait;
    }
    return out;
  }

  // Retry-After as milliseconds from `now`: delta-seconds ("120") or an HTTP
  // date. A date already past is 0; a missing or unreadable header is
  // undefined (no wait is known).
  function retryAfterMs(header, now) {
    const v = typeof header === 'string' ? header.trim() : '';
    if (!v) return undefined;
    if (/^\d+$/.test(v)) return Number(v) * 1000;
    // An HTTP date names its weekday and month; a bare "-5" is neither form.
    const at = /[a-z]/i.test(v) ? Date.parse(v) : NaN;
    if (!Number.isFinite(at)) return undefined;
    return Math.max(0, at - now);
  }

  function statusToErr(status) {
    if (status === 401) return ERR.INVALID_KEY;
    if (status === 403) return ERR.FORBIDDEN;
    if (status === 404) return ERR.NOT_FOUND;
    if (status === 429) return ERR.RATE_LIMITED;
    return ERR.UNKNOWN;
  }

  // ---- api.bible chapter fetch + normalize ----
  async function fetchApiBibleChapter(key, bibleId, chapterId) {
    if (!key) return err(ERR.NO_KEY);
    const params = new URLSearchParams({
      'content-type': 'json',
      'include-verse-numbers': 'true',
      'include-notes': 'false',
      'include-titles': 'true',
      'include-chapter-numbers': 'false',
      'include-verse-spans': 'false',
    });
    const url = `${C.API_BIBLE_BASE}/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}?${params}`;
    let res;
    try {
      res = await fetch(url, { headers: { 'api-key': key } });
    } catch (e) {
      return err(ERR.NETWORK, String(e));
    }
    if (!res.ok) return errorFor(res);
    const json = await res.json();
    const data = json.data || {};
    const meta = json.meta || {};
    return {
      payload: {
        blocks: normalizeApiBibleContent(data.content),
        copyright: data.copyright || '',
        reference: data.reference || '',
      },
      // FUMS usage tracking — only forwarded on fresh fetches (not cache hits),
      // so it reports an actual API access. The content script fires it.
      fums: meta.fumsJsInclude || meta.fumsJs
        ? { include: meta.fumsJsInclude || '', js: meta.fumsJs || '' }
        : null,
    };
  }

  // Walk api.bible JSON content into IR blocks.
  function normalizeApiBibleContent(content) {
    const blocks = [];
    if (!Array.isArray(content)) return blocks;
    for (const node of content) {
      if (!node || node.type !== 'tag' || node.name !== 'para') continue;
      const style = (node.attrs && node.attrs.style) || 'p';
      if (isHeadingStyle(style)) {
        const text = collectText(node).trim();
        if (text) blocks.push({ type: 'heading', text });
        continue;
      }
      const runs = [];
      collectRuns(node.items, runs, false);
      if (runs.length) blocks.push({ type: 'para', style, runs });
    }
    return blocks;
  }

  function isHeadingStyle(style) {
    return /^(s\d?|ms\d?|mt\d?|mr|sr|d)$/.test(style);
  }

  // Recursively flatten inline items into runs (verse markers + text), tracking
  // whether we're inside a "words of Christ" (wj) span.
  function collectRuns(items, runs, wj) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item) continue;
      if (item.type === 'text') {
        if (typeof item.text === 'string' && item.text.length) {
          runs.push({ t: 'txt', s: item.text, wj });
        }
      } else if (item.type === 'tag' && item.name === 'verse') {
        const n = item.attrs && item.attrs.number;
        if (n) runs.push({ t: 'v', n: String(n) });
        // Do NOT recurse into the verse tag: its items only hold the verse
        // number text again, which would duplicate the number in the output.
      } else if (item.type === 'tag') {
        const childWj = wj || (item.attrs && item.attrs.style === 'wj');
        collectRuns(item.items, runs, childWj);
      }
    }
  }

  function collectText(node) {
    let out = '';
    const items = node.items || [];
    for (const item of items) {
      if (!item) continue;
      if (item.type === 'text') out += item.text || '';
      else if (item.type === 'tag') out += collectText(item);
    }
    return out;
  }

  // ---- bible-api.com chapter fetch + normalize (public domain, no key) ----
  async function fetchBibleApiChapter(translationId, ldsBook, chapter) {
    const usfm = BOOKS.ldsToUsfm(ldsBook);
    if (!usfm) return err(ERR.NOT_FOUND, 'Unknown book');
    const url = `${C.BIBLE_API_BASE}/data/${encodeURIComponent(translationId)}/${usfm}/${encodeURIComponent(chapter)}`;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      return err(ERR.NETWORK, String(e));
    }
    if (!res.ok) return err(statusToErr(res.status), `HTTP ${res.status}`);
    const json = await res.json();
    const verses = json.verses || [];
    // bible-api gives no paragraph structure, so render as one continuous para.
    const runs = [];
    for (const v of verses) {
      if (v.verse != null) runs.push({ t: 'v', n: String(v.verse) });
      const text = (v.text || '').replace(/\s+/g, ' ').trim();
      if (text) runs.push({ t: 'txt', s: text + ' ', wj: false });
    }
    const tr = json.translation || {};
    const ref = (verses[0] ? `${BOOKS.ldsToBibleApi(ldsBook)} ${chapter}` : '');
    return {
      payload: {
        blocks: runs.length ? [{ type: 'para', style: 'p', runs }] : [],
        copyright: tr.license || tr.name || 'Public domain',
        reference: ref,
      },
    };
  }

  const API = { listBibles, fetchApiBibleChapter, fetchBibleApiChapter, errorFor, retryAfterMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { api: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
