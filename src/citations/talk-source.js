/*
 * Talk source: the one place that knows how a talk is obtained and where its
 * cite sits inside it. Answers a single question for the reader —
 *
 *     load({ entry, source }) -> { html, url, destination, credit, findTarget(container) }
 *     destination({ entry, source }) -> { href, label } | null
 *
 * "give me displayable HTML for this cite, plus how to find its target once
 * that HTML is rendered, where to read it on the web, and whose text it is" —
 * and the same for a citation row's excerpt:
 *
 *     excerpt({ entry, source }, claim) -> Promise<paragraph text | null>
 *     reschedule()   rows moved: hand free request slots out again
 *
 * excerpt() is the text of the paragraph load()'s findTarget lands on, from
 * the same fetch and cache; `claim` is the row asking ({ where() -> { zone,
 * top } }, see slotPolicy). Corpus differences (Church fetch vs BYU fetch vs
 * bundled gzip, paragraph anchor vs citation span vs STPJS body passage,
 * Church page vs BYU viewer) are decided by the corpus plan; talk-view and
 * cit-panel render, and decide nothing per corpus.
 *
 * Fetch policy (FETCH_POLICY, this module's alone): per-host request slots
 * (6 to the Church site, 2 to BYU; a request holds its slot until it ends,
 * so no host ever has more in flight), one session-only talk cache shared by
 * the reader and row excerpts (bounded LRU, in memory, never persisted), and
 * the 15-second timeout. A talk is fetched only for the reader or for an
 * excerpt row in view. A free slot goes where slotPolicy (pure) says: the
 * reader's open first, then rows on screen, then the look-ahead band,
 * nearest the top; a row scrolled away waits until it returns.
 *
 * Descriptor contract: the corpus plan is a pure function of the pack
 * descriptor (citData.loadPack().descriptor, written by
 * tools/build-citation-data.js) — corpusPlan(descriptor, corpus, { hasUrl })
 * reads the corpus's `text` and `target` and nothing else; this module holds
 * no per-corpus table. A corpus the descriptor lacks has no plan, so load()
 * hands back no HTML, no URL, no destination and no target for it.
 *
 * Target order. A fetched modern talk (plan target 'anchor'): the cite's
 * paragraph anchor (pN), else the footnote locator (locateParagraph: the
 * paragraph the talk's own scripture links name, read from the fetched HTML
 * because the sanitizer unwraps links), else the snippet's paragraph for
 * corpora that still bundle a snippet. Every other plan (a BYU-fetched early
 * conference talk included), and a modern talk read from the bundle: the
 * citation span (STPJS: its body passage), else the cite's own anchor (a
 * Journal of Discourses cite the Wikisource build could not place carries its
 * printed page's anchor, `jdp-N`), else the snippet's paragraph
 * (snippetKey / snippetMatches).
 *
 * Credit (talkCredit): the byline line saying whose text the reader shows,
 * from the descriptor's corpus entry: a BYU-fetched talk's fetch line, or a
 * Wikisource-attributed corpus's "Text: Wikisource, revision N" linking the
 * source's permalink.
 *
 * The DOM-free half (corpusPlan, readingDestination, talkCredit, the BYU URL
 * builders, the pre-2013 URL repair, locateParagraph, slotPolicy,
 * snippetKey, snippetMatches) is exported for Node, and load() runs there over a stubbed
 * fetch and citData: `node --test tools/test-talk-source.js`.
 *
 * IIFE -> __BTX.talkSource (+ module.exports for the Node tests).
 */
(function (root) {
  'use strict';

  const citData = () => root.__BTX && root.__BTX.citData;

  // The corpus plan, read from the pack descriptor's entry for the corpus
  // (GLOSSARY.md "Pack descriptor", "Corpus"):
  //   text   'live-church' — same-origin fetch from churchofjesuschrist.org
  //          'live-byu'     — BYU's talk fragment from scriptures.byu.edu (byuTalkUrl)
  //          'bundled'      — the pack's talks/{talkId}.html.gz
  //   target 'anchor'       — the talk's paragraph anchor (pN), citation span as fallback
  //          'citationSpan' — <span class="citation" id="{citId}"> in the talk markup
  //          'bodyPassage'  — STPJS: the body text the footnote annotates, not the
  //                           footnote-list line the citation span actually lives in
  // A corpus the descriptor lacks has no plan (null): the reader shows no
  // talk and no reading destination for it. `hasUrl` is the escape hatch for
  // data the descriptor doesn't foresee: a nominally live talk that ships no
  // URL reads the bundle (fetching an undefined URL would blow up the reader).
  function corpusPlan(descriptor, corpus, opts) {
    const corpora = (descriptor && descriptor.corpora) || {};
    const entry = Object.prototype.hasOwnProperty.call(corpora, corpus) ? corpora[corpus] : null;
    if (!entry) return null;
    const hasUrl = opts && 'hasUrl' in opts ? !!opts.hasUrl : true;
    const text = entry.text === 'live-church' && !hasUrl ? 'bundled' : entry.text;
    return { text, target: entry.target };
  }

  /* --------------------------------------------------------------------- BYU */

  const BYU_ORIGIN = 'https://scriptures.byu.edu';
  // A BYU talk id is its decimal TalkID; a derived talk's id (a Church path)
  // is not one, and has no BYU fragment or viewer.
  const byuTalkNumber = (talkId) => (/^\d+$/.test(String(talkId == null ? '' : talkId)) ? Number(talkId) : null);

  // BYU's talk fragment: the talk's markup, served to any origin with a
  // wildcard CORS header, so the content script fetches it with credentials
  // omitted. Its citation-span ids are the index's citIds.
  function byuTalkUrl(talkId) {
    const n = byuTalkNumber(talkId);
    return n == null ? null : `${BYU_ORIGIN}/content/talks_ajax/${n}`;
  }

  // BYU's viewer at one talk: `#:t{talk id in hex}${citation-span id}`. The
  // `$` segment is the span's decimal id, which the viewer highlights and
  // scrolls to (verified in a browser, October 5, 2026: #:t379$22657).
  function byuViewerUrl(talkId, citId) {
    const n = byuTalkNumber(talkId);
    if (n == null) return null;
    const cite = citId == null || citId === '' ? '' : `$${citId}`;
    return `${BYU_ORIGIN}/#:t${n.toString(16)}${cite}`;
  }

  /* ---------------------------------------------------------------- fetching */

  // Pre-Oct-2013 GC talks were stored without their session segment, e.g.
  // /study/ensign/2012/11/temple-standard. The site now 302s those to the
  // conference landing page (/study/ensign/2012/11), so a plain fetch silently
  // renders the wrong page. resolvedUrlCache memoizes the recovered session-
  // qualified URL per original so we only resolve once per session.
  const resolvedUrlCache = new Map();

  // Fetch policy (spec #69 "Reader"): the talk source is its one home.
  //   slots      requests in flight at once, per host; a request holds its
  //              slot until its body has arrived or failed
  //   talkCache  talks the session cache holds (see cachedTalk)
  //   timeoutMs  a request gives up after this, so a hung one ends in the
  //              reader's error state rather than an endless spinner
  // No prefetch: a talk is fetched only when a view asks for it.
  const FETCH_POLICY = Object.freeze({
    slots: Object.freeze({ 'www.churchofjesuschrist.org': 6, 'scriptures.byu.edu': 2 }),
    talkCache: 60,
    timeoutMs: 15000,
  });
  const LIVE_TIMEOUT_MS = FETCH_POLICY.timeoutMs;
  const liveFetch = (url) => fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });

  function lastSlug(pathname) {
    return String(pathname).replace(/\/+$/, '').split('/').pop() || '';
  }

  // True when a fetch of `originalUrl` landed somewhere else — i.e. the
  // session-less pre-2013 URL was redirected to the conference landing page.
  function bouncedToConference(originalUrl, landedUrl) {
    return lastSlug(new URL(landedUrl).pathname) !== lastSlug(new URL(originalUrl).pathname);
  }

  // Given the links on that landing page, find the session-qualified URL for our
  // talk: same origin, same conference directory, exactly [session, slug] below
  // it. Returns null (never a guess) when nothing matches. Pure — no DOM, no
  // network — so the repair is testable in Node.
  function pickSessionUrl({ originalUrl, landedUrl, hrefs, origin }) {
    const orig = new URL(originalUrl);
    const base = landedUrl || originalUrl;
    const wanted = origin || new URL(base).origin;
    const slug = lastSlug(orig.pathname);
    const dir = orig.pathname.replace(/\/[^/]+\/?$/, ''); // /study/ensign/2012/11
    for (const href of hrefs || []) {
      let p;
      try { p = new URL(href, base); } catch (e) { continue; }
      if (p.origin !== wanted) continue;
      const path = p.pathname.replace(/\/+$/, '');
      if (!path.startsWith(dir + '/') || path === dir + '/' + slug) continue; // skip the self-link
      const rest = path.slice(dir.length + 1).split('/'); // [session, slug]
      if (rest.length === 2 && rest[1] === slug) {
        const u = new URL(path, wanted);
        u.search = orig.search; // preserve ?lang=eng
        return u.href;
      }
    }
    return null;
  }

  // Deep-link to a live church talk paragraph: "...&id=pN#pN" scrolls to and
  // highlights that paragraph on churchofjesuschrist.org.
  function fullTalkUrl(url, anchor) {
    if (!anchor) return url;
    const base = String(url).split('#')[0];
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return `${base}${sep}id=${anchor}#${anchor}`;
  }

  // The reading destination: the page the reader header's external link and
  // the error state open, per corpus plan. Pure.
  //   live-church  the Church page at the paragraph anchor; `url` (the
  //                effective URL after a repaired redirect) beats source.url
  //   live-byu     BYU's viewer at the citation span
  //   bundled      the source's own URL when it has one (the Journal of
  //                Discourses' Wikisource permalink), else none
  // -> { href, label } | null. The label names the destination's host.
  function readingDestination(plan, { entry, source, url } = {}) {
    if (!plan) return null;
    const e = entry || {};
    const page = url || (source && source.url) || null;
    let href = null;
    if (plan.text === 'live-byu') href = byuViewerUrl(e.talkId, e.citId);
    else if (plan.text === 'live-church') href = page && fullTalkUrl(page, e.anchor);
    else href = page;
    if (!href) return null;
    let host;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch (err) { return null; }
    return { href, label: `Open on ${host}` };
  }

  // Absolute hrefs of every link in `html`. A single unparseable href must not
  // abort the repair, so each one is resolved defensively.
  function hrefsIn(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      try { out.push(new URL(a.getAttribute('href'), baseUrl).href); } catch (e) { /* skip */ }
    }
    return out;
  }

  // The slot policy (pure): which waiting requests start now on one host.
  //   slotPolicy({ free, waiting: [{ id, urgent, rows: [{ zone, top }] }] }) -> [id]
  // `free` is the host's slots not in flight; `waiting` is in arrival order.
  // A request is urgent when the reader opened its talk; otherwise it serves
  // excerpt rows, each 'visible' (on screen), 'ahead' (within the look-ahead
  // band) or 'gone' (scrolled away, or its list is no longer shown), `top`
  // its distance in pixels from the top of the visible area. Urgent requests
  // go first, in arrival order; then requests with a row on screen, then
  // those with a row in the band, each nearest the top first (a talk at
  // several rows ranks by its best one). A request whose rows are all gone
  // waits, so a row scrolled past before its turn costs nothing unless it
  // returns.
  const ZONE_RANK = { visible: 0, ahead: 1 };
  function slotPolicy({ free, waiting }) {
    if (!(free > 0)) return [];
    const ranked = [];
    (waiting || []).forEach((w, order) => {
      let best = null;
      for (const r of w.rows || []) {
        if (!(r.zone in ZONE_RANK)) continue;
        const rank = [ZONE_RANK[r.zone], Math.abs(Number(r.top) || 0)];
        if (!best || rank[0] < best[0] || (rank[0] === best[0] && rank[1] < best[1])) best = rank;
      }
      if (w.urgent) ranked.push({ id: w.id, key: [-1, 0], order });
      else if (best) ranked.push({ id: w.id, key: best, order });
    });
    ranked.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.order - b.order);
    return ranked.slice(0, free).map((r) => r.id);
  }

  // Per-host request slots (FETCH_POLICY.slots; a host not listed gets one).
  // A request holds its slot while in flight, so a host never has more in
  // flight than its slots (spec A16) — a request whose rows have all left
  // view still finishes, into the cache, and its slot frees when it does.
  // Which waiting request a free slot goes to is slotPolicy's call, re-asked
  // whenever a request ends or rows move (reschedule).
  const slotState = new Map(); // host -> { busy, waiting: [{ id, demand, start }] }
  let requestSeq = 0;

  // A talk's demand: who wants its fetch. `urgent` once the reader opens
  // it; `claims` are the excerpt rows that want it, each { where() -> { zone,
  // top } }, read at decision time. A request with no demand is urgent.
  const rowsOf = (demand) => (demand ? Array.from(demand.claims, (c) => c.where()) : []);

  function pump() {
    for (const [host, s] of slotState) {
      if (!s.waiting.length) continue;
      const free = (FETCH_POLICY.slots[host] || 1) - s.busy;
      const ids = slotPolicy({
        free,
        waiting: s.waiting.map((w) => ({ id: w.id, urgent: !w.demand || w.demand.urgent, rows: rowsOf(w.demand) })),
      });
      for (const id of ids) {
        const i = s.waiting.findIndex((w) => w.id === id);
        const [w] = s.waiting.splice(i, 1);
        s.busy++;
        w.start();
      }
    }
  }

  function withSlot(host, demand, task) {
    let s = slotState.get(host);
    if (!s) slotState.set(host, (s = { busy: 0, waiting: [] }));
    return new Promise((resolve) => {
      s.waiting.push({
        id: ++requestSeq,
        demand,
        start: () => {
          task().then(resolve, () => resolve(null)).finally(() => { s.busy--; pump(); });
        },
      });
      pump();
    });
  }

  // Public: rows moved (in or out of view, or the list scrolled); hand any
  // free slots out again.
  function reschedule() { pump(); }

  // One GET under its host's slot, held until the body has arrived (the body
  // can still fail or time out after the headers). Never throws:
  // -> { ok, url, html }; ok false and url null when the request itself failed.
  function request(url, demand) {
    return withSlot(new URL(url).hostname, demand, async () => {
      let res;
      try { res = await liveFetch(url); } catch (e) { return { ok: false, url: null, html: null }; }
      let html = null;
      if (res.ok) { try { html = await res.text(); } catch (e) { html = null; } }
      return { ok: res.ok, url: res.url || url, html };
    });
  }

  // Fetch a live church talk, recovering from the pre-2013 session-less redirect.
  // Returns { html, url }: html is the talk's HTML (null if it couldn't be loaded),
  // url is the effective talk URL (resolved when a redirect was repaired). Never throws.
  async function fetchLiveTalk(originalUrl, demand) {
    const target = resolvedUrlCache.get(originalUrl) || originalUrl;
    const r = await request(target, demand);
    if (!r.ok) return { html: null, url: r.url || originalUrl };

    // Common case (post-2013, or an already-resolved cache hit): not bounced.
    if (resolvedUrlCache.has(originalUrl) || !bouncedToConference(originalUrl, r.url)) {
      return { html: r.html, url: r.url };
    }

    // Bounced to the conference landing page: recover from its table of contents.
    let realUrl = null;
    try {
      realUrl = pickSessionUrl({
        originalUrl,
        landedUrl: r.url,
        hrefs: hrefsIn(r.html || '', r.url),
        origin: location.origin,
      });
    } catch (e) { /* fall through */ }
    if (!realUrl) return { html: null, url: r.url }; // couldn't resolve -> error state

    const r2 = await request(realUrl, demand);
    if (!r2.ok) return { html: null, url: r2.url || realUrl };
    if (r2.html != null) resolvedUrlCache.set(originalUrl, realUrl);
    return { html: r2.html, url: r2.url };
  }

  /* ------------------------------------------------------------ fetch policy */

  // The session talk cache: one fetch per talk per session, shared by every
  // view of the talk (the reader and row excerpts). It holds the promise, so
  // views that ask at once share one request; it keeps only successes (a
  // failure is dropped, so Try again asks the network again); it is bounded,
  // evicting the least recently used talk; and it lives in this module's
  // memory only, never in storage, so a reload empties it.
  const TALK_CACHE_MAX = FETCH_POLICY.talkCache;

  function lruCache(max) {
    const map = new Map();
    return {
      get(key) {
        if (!map.has(key)) return undefined;
        const v = map.get(key);
        map.delete(key);
        map.set(key, v);
        return v;
      },
      set(key, v) {
        map.delete(key);
        map.set(key, v);
        while (map.size > max) map.delete(map.keys().next().value);
      },
      peek(key) { return map.get(key); },
      delete(key) { map.delete(key); },
    };
  }

  const talkCache = lruCache(TALK_CACHE_MAX);

  // `fetcher(demand)` -> Promise<{ html, url }> (never rejects), once per
  // talk. `claim` is an excerpt row asking (see rowsOf); no claim is the
  // reader asking, which makes a fetch still waiting for a slot urgent.
  const demands = new Map(); // talk key -> its demand, until its fetch settles
  function cachedTalk(talkId, fetcher, claim) {
    const key = String(talkId);
    let p = talkCache.get(key);
    if (!p) {
      const demand = { urgent: false, claims: new Set() };
      demands.set(key, demand);
      p = fetcher(demand);
      talkCache.set(key, p);
      p.then((r) => {
        if (demands.get(key) === demand) demands.delete(key);
        if ((!r || r.html == null) && talkCache.peek(key) === p) talkCache.delete(key);
      });
    }
    const demand = demands.get(key);
    if (demand) {
      if (claim) demand.claims.add(claim); else demand.urgent = true;
      pump();
    }
    return p;
  }

  // The byline line of a talk whose text came from BYU (spec #69 disclosure).
  const BYU_CREDIT = 'Text fetched from scriptures.byu.edu';

  // The reader's credit line for a loaded talk, from its corpus's descriptor
  // entry (`corpusEntry`, descriptor.corpora[letter]). Pure. -> { text, href? } | null
  //   text 'live-byu'            the BYU fetch line
  //   attribution 'wikisource'   "Text: Wikisource, revision N" linking the
  //                              source's URL, the permalink whose `oldid` is N
  function talkCredit(corpusEntry, source) {
    if (!corpusEntry) return null;
    if (corpusEntry.text === 'live-byu') return { text: BYU_CREDIT };
    const url = source && source.url;
    if (corpusEntry.attribution === 'wikisource' && url) {
      const rev = /[?&]oldid=(\d+)/.exec(url);
      return { text: 'Text: Wikisource' + (rev ? `, revision ${rev[1]}` : ''), href: url };
    }
    return null;
  }

  // Fetch an early-conference talk's fragment from BYU -> its HTML, or null.
  // Never throws. The fragment wraps the talk's div.gcera in viewer chrome;
  // talk-view renders only the content root, so the chrome never shows.
  async function fetchByuTalk(talkId, demand) {
    const url = byuTalkUrl(talkId);
    return url ? (await request(url, demand)).html : null;
  }

  /* --------------------------------------------------------- footnote locator */

  // Where an unanchored modern cite sits, read from the talk's own scripture
  // links (research: docs/research/issue-66-footnote-locator.md on
  // research/footnote-locator, 90.8% / 100% / 97.3% hits by era).
  //
  //   locateParagraph(html, { book, chapter, verses, rank }) -> paragraph id | null
  //
  // `html` is the fetched talk page as a string; `book` is the URL slug
  // ('alma', '1-ne', 'dc'), `verses` the cite's `v` ('1-3,14'), `rank` the
  // cite's 1-based rank by cite id among the talk's cites of the same book,
  // chapter and verses (citData.chapterData's refRank).
  //
  // Candidates are every a.scripture-ref in reading order: a link inside a
  // footnote li[id^="note"] sits at the body paragraph holding that note's
  // first a.note-ref marker, a link inside a body paragraph sits there. A
  // candidate matches when it links the cite's book and chapter with a verse
  // set equal to the cite's, or, for a whole-chapter cite (v '1-N'), when it
  // links the chapter with no verses (its label may name a chapter span,
  // "2 Nephi 31–32"). Joseph Smith Translation links never match. The rank-th
  // match wins, or the last when there are fewer.
  //
  // It reads the HTML before sanitizing because talk-view unwraps every link;
  // the paragraph ids it returns survive sanitizing. No DOM: a small tag
  // scanner, so it runs in Node too.

  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'source', 'track', 'wbr']);
  // Content that is not markup the reader sees: the page's JSON state carries
  // escaped copies of the talk.
  const RAW_TEXT = /<(script|style|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const BODY_PARAGRAPH = /^(?:p|h[1-6])$/;

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] || m;
    });
  }

  function attrsOf(s) {
    const out = {};
    ATTR.lastIndex = 0;
    for (let m; (m = ATTR.exec(s));) {
      out[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] || '');
    }
    return out;
  }
  const hasClass = (attrs, name) => String(attrs.class || '').split(/\s+/).includes(name);

  // '1-3,14' or 'p1-p3,p14' -> sorted verse numbers; [] when nothing parses.
  function verseList(s) {
    const out = new Set();
    for (const part of String(s == null ? '' : s).split(',')) {
      const m = /^\s*p?(\d+)(?:\s*[-–]\s*p?(\d+))?\s*$/.exec(part);
      if (!m) continue;
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let n = from; n <= to && n - from < 500; n++) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  }

  // Every scripture link with the paragraph it sits at, in reading order.
  function scriptureLinks(html) {
    const text = String(html || '').replace(RAW_TEXT, '');
    const stack = [];           // open elements: { tag, para?, note? }
    const markerAt = {};        // note id -> { para, pos } of its first body marker
    const links = [];           // { pos, href, label, para?, note? }
    let link = null;            // the scripture link being read
    let last = 0;
    const innermost = (key) => {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i][key]) return stack[i][key];
      return null;
    };
    TAG.lastIndex = 0;
    for (let m; (m = TAG.exec(text));) {
      if (link) link.label += text.slice(last, m.index);
      last = TAG.lastIndex;
      const tag = m[2].toLowerCase();
      if (m[1]) { // closing tag: pop to the matching element, if it is open
        if (tag === 'a' && link) { links.push(link); link = null; }
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) { stack.length = i; break; }
        }
        continue;
      }
      const attrs = attrsOf(m[3]);
      const id = attrs.id || '';
      const frame = { tag };
      if (BODY_PARAGRAPH.test(tag) && 'data-aid' in attrs && id && !id.startsWith('note')) frame.para = id;
      if (tag === 'li' && id.startsWith('note')) frame.note = id;
      if (tag === 'a' && hasClass(attrs, 'note-ref')) {
        const noteId = attrs['data-scroll-id'] || (/#(note[^#]*)$/.exec(attrs.href || '') || [])[1];
        const para = innermost('para');
        if (noteId && para && !innermost('note') && !markerAt[noteId]) markerAt[noteId] = { para, pos: m.index };
      }
      if (tag === 'a' && hasClass(attrs, 'scripture-ref')) {
        if (link) links.push(link);
        link = { pos: m.index, href: attrs.href || '', label: '', note: innermost('note'), para: innermost('para') };
      }
      if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3])) stack.push(frame);
    }
    if (link) links.push(link);

    const placed = [];
    for (const l of links) {
      const at = l.note ? markerAt[l.note] : l.para ? { para: l.para, pos: l.pos } : null;
      if (at) placed.push({ para: at.para, key: at.pos, pos: l.pos, href: l.href, label: decodeEntities(l.label) });
    }
    return placed.sort((a, b) => a.key - b.key || a.pos - b.pos);
  }

  // A scripture link's target: { book, chapter, verses:[...] | null (whole
  // chapter), chapters:[from, to] } or null (not a chapter link, or the JST).
  function parseScriptureLink(href, label) {
    let u;
    try { u = new URL(href, 'https://www.churchofjesuschrist.org'); } catch (e) { return null; }
    const m = /^\/study\/scriptures\/([^/]+)\/([^/]+)\/(\d+)\/?$/.exec(u.pathname);
    if (!m || m[1] === 'jst' || /^jst-/.test(m[2])) return null;
    const chapter = Number(m[3]);
    const id = u.searchParams.get('id');
    if (id) return { book: m[2], chapter, verses: verseList(id), chapters: [chapter, chapter] };
    // A chapter link whose label ends in a chapter span ("2 Nephi 31–32",
    // a bare "6–9") covers every chapter of the span.
    const span = /(?:^|[^:\d])(\d+)\s*[–—-]\s*(\d+)\s*$/.exec(String(label || '').trim());
    const chapters = span && Number(span[1]) <= chapter && chapter <= Number(span[2])
      ? [Number(span[1]), Number(span[2])] : [chapter, chapter];
    return { book: m[2], chapter, verses: null, chapters };
  }

  function locateParagraph(html, cite) {
    const c = cite || {};
    const want = verseList(c.verses);
    if (!c.book || !c.chapter || !want.length) return null;
    const chapter = Number(c.chapter);
    const wholeChapter = /^\s*1\s*[-–]\s*\d+\s*$/.test(String(c.verses));
    const wanted = want.join(',');
    const matches = [];
    for (const l of scriptureLinks(html)) {
      const t = parseScriptureLink(l.href, l.label);
      if (!t || t.book !== c.book) continue;
      const exact = t.verses && t.chapter === chapter && t.verses.join(',') === wanted;
      const whole = wholeChapter && !t.verses && t.chapters[0] <= chapter && chapter <= t.chapters[1];
      if (exact || whole) matches.push(l.para);
    }
    if (!matches.length) return null;
    const k = Math.max(1, Number(c.rank) || 1);
    return matches[Math.min(k, matches.length) - 1];
  }

  /* ------------------------------------------------------------ scroll target */

  function cssId(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function byId(container, id) { return container.querySelector(`[id="${cssId(id)}"]`); }

  // STPJS: a citId span lives in the bottom footnote list; map it to the body
  // passage that footnote annotates (the paragraph holding the matching footRef).
  // This is the render-time half of the body-passage rule the build tool also
  // applies to snippets — see docs/adr/0006-stpjs-body-passage-stated-twice.md.
  function bodyPassageForFootnote(container, note) {
    // talk-view's render stamps the footnote number on data-btx-footnum; fall back
    // to the raw leading "N." for markup that never went through it.
    const num = note.getAttribute('data-btx-footnum') ||
      (/^\s*(\d+)\./.exec(note.textContent) || [])[1];
    if (!num) return null;
    for (const ref of container.querySelectorAll('.btxk-footRef')) {
      if (ref.textContent.trim() === num) return ref.closest('p, .btxk-std') || ref;
    }
    return null;
  }

  // The part of a cite's snippet that can be found verbatim in the talk: the
  // text before the first ellipsis and before the first inline footnote
  // ("…obscurity,” 26 [ Doctrine and Covenants 1:30 ] bringing…" keeps
  // "…obscurity,”"), whitespace collapsed, at most SNIPPET_KEY_MAX characters.
  // null when fewer than SNIPPET_KEY_MIN remain — too short to pick out one
  // paragraph.
  const SNIPPET_KEY_MIN = 20;
  const SNIPPET_KEY_MAX = 60;
  function snippetKey(snippet) {
    let s = String(snippet || '').replace(/^[\s\u00a0]*(?:…|\.\.\.)/, '');
    const cut = s.search(/…|\.\.\.|(?:^|\s)\d{1,3}\s*\[/);
    if (cut >= 0) s = s.slice(0, cut);
    s = s.replace(/[\s\u00a0]+/g, ' ').trim();
    if (s.length < SNIPPET_KEY_MIN) return null;
    return s.slice(0, SNIPPET_KEY_MAX).trim();
  }

  // Whether `text` holds `key`, ignoring whitespace entirely: the build's
  // snippets and the rendered talk disagree on spaces around inline markup
  // ("common consent ," vs "common consent,") and on non-breaking spaces.
  const squash = (s) => String(s || '').replace(/[\s\u00a0]+/g, '');
  function snippetMatches(text, key) {
    return !!key && squash(text).includes(squash(key));
  }

  // The innermost paragraph-like block whose text holds `key`, or null.
  const SNIPPET_BLOCKS = 'p, li, blockquote, .btxk-paragraph, .btxk-std';
  function bySnippet(container, key) {
    if (!key) return null;
    const firstIn = (n) => Array.from(n.querySelectorAll(SNIPPET_BLOCKS))
      .find((b) => snippetMatches(b.textContent, key)) || null;
    let hit = firstIn(container);
    for (let inner = hit && firstIn(hit); inner; inner = firstIn(hit)) hit = inner;
    return hit;
  }

  // The element ids tried for a cite once a live paragraph anchor and the
  // locator have had their turn, most precise first. Pure, so the order is
  // testable in Node: the citation span, then — outside the anchor plan, whose
  // pN anchors are the live page's — the cite's own anchor: a Journal of
  // Discourses cite the Wikisource build could not place carries its printed
  // page's anchor (jdp-N) instead of a marker.
  function targetIds(plan, entry) {
    const ids = entry.citId == null ? [] : [String(entry.citId)];
    if (entry.anchor && plan.target !== 'anchor') ids.push(String(entry.anchor));
    return ids;
  }

  // Locate the cite inside the rendered (sanitized) talk, per the corpus plan.
  // Render contract with talk-view: source ids survive, source classes come back
  // namespaced (`footnote` -> `btxk-footnote`), and each footnote carries its
  // number on `data-btx-footnum`. Change one side, change this.
  // Target order: the header's.
  function findTarget(container, { plan, entry, live, html }) {
    if (plan.target === 'anchor' && live) {
      const anchored = entry.anchor && byId(container, entry.anchor);
      if (anchored) return anchored;
      const located = locateParagraph(html, {
        book: entry.book, chapter: entry.chapter, verses: entry.verses, rank: entry.refRank,
      });
      const hit = located && byId(container, located);
      if (hit) return hit;
    }
    for (const id of targetIds(plan, entry)) {
      const hit = byId(container, id);
      if (!hit) continue;
      // STPJS: <span class="citation" id="{citId}"> sits in the footnote list.
      if (plan.target !== 'bodyPassage' || id !== String(entry.citId)) return hit;
      const note = hit.closest('.btxk-footnote');
      return (note && bodyPassageForFootnote(container, note)) || hit;
    }
    return bySnippet(container, snippetKey(entry.snippet));
  }

  /* -------------------------------------------------------------------- load */

  // The talk's corpus plan and its descriptor entry -> { plan, corpusEntry }
  // (both null for a corpus the pack lacks). `src.c` is the corpus letter.
  async function corpusFor(src) {
    let pack = null;
    try { pack = await citData().loadPack(); } catch (e) { pack = null; }
    const descriptor = pack && pack.descriptor;
    const plan = corpusPlan(descriptor, src.c, { hasUrl: !!src.url });
    return { plan, corpusEntry: plan ? descriptor.corpora[src.c] : null };
  }

  // Public: the cite's reading destination before its talk loads (the header
  // link shows at once) -> Promise<{ href, label } | null>. load() returns the
  // same, with the effective URL of a repaired redirect.
  async function destination({ entry, source }) {
    const src = source || {};
    return readingDestination((await corpusFor(src)).plan, { entry, source: src });
  }

  // A talk's HTML per its plan, through the session cache for a fetched
  // one -> { html, url }; html null when it could not be had. `claim`: as
  // cachedTalk's (none for the reader).
  async function talkHtml(plan, entry, src, claim) {
    if (plan.text === 'live-church') {
      const r = await cachedTalk(entry.talkId, (d) => fetchLiveTalk(src.url, d), claim);
      return { html: r.html, url: r.url || src.url || null };
    }
    if (plan.text === 'live-byu') {
      const r = await cachedTalk(entry.talkId, async (d) => ({ html: await fetchByuTalk(entry.talkId, d), url: null }), claim);
      return { html: r.html, url: src.url || null };
    }
    let html = null;
    try { html = await citData().loadTalkHtml(entry.talkId); } catch (e) { html = null; }
    return { html, url: src.url || null };
  }

  // Public: obtain displayable HTML for `entry` plus how to find its target.
  // Returns { html, url, destination, credit, findTarget(container) }:
  //   html         null when the talk could not be loaded (the caller shows
  //                its error state, with the destination as the way out)
  //   destination  readingDestination's { href, label } | null
  //   credit       talkCredit's { text, href? } for a loaded talk, or null
  // A live talk whose fetch failed has no html: it never falls back to the
  // pack, whose talk files are only the bundled corpora's.
  async function load({ entry, source }) {
    const src = source || {};
    const { plan, corpusEntry } = await corpusFor(src);
    if (!plan) return { html: null, url: null, destination: null, credit: null, findTarget: () => null };
    const { html, url } = await talkHtml(plan, entry, src);
    const live = html != null && plan.text !== 'bundled';

    return {
      html,
      url,
      destination: readingDestination(plan, { entry, source: src, url }),
      credit: html != null ? talkCredit(corpusEntry, src) : null,
      findTarget: (container) => findTarget(container, { plan, entry, live, html }),
    };
  }

  // BYU's insertions into a talk's prose (its citation-span labels and the
  // footnotes it inlines into modern talks); the publishing site's paragraph
  // has none, and the build's excerpt count leaves them out too
  // (tools/build-citation-data.js BYU_INSERTION).
  const BYU_INSERTIONS = 'span[class^="ccontainer"], span.citation, sup.noteMarker';
  const EXCERPT_BLOCK = 'p, li, blockquote, h1, h2, h3, h4, h5, h6';

  // The text of the paragraph a target sits in, as the build counted it:
  // BYU's insertions dropped, unless nothing else is left (a paragraph that is
  // only a reference).
  function paragraphText(target) {
    const block = target.matches(EXCERPT_BLOCK) ? target : target.closest('p, div') || target;
    const copy = block.cloneNode(true);
    for (const n of copy.querySelectorAll(BYU_INSERTIONS)) n.remove();
    const squashed = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return squashed(copy.textContent) || squashed(block.textContent) || null;
  }

  // Public: the text of the paragraph the reader would scroll to for this
  // cite -> Promise<string | null> (null: no plan, the fetch failed, or the
  // target is missing). It shares the reader's fetch, cache and findTarget.
  // `claim` ({ where() -> { zone, top } }) is the row asking: its fetch
  // waits for a slot under slotPolicy, and never starts while every row
  // asking is gone. Call reschedule() when rows move.
  async function excerpt({ entry, source }, claim) {
    const src = source || {};
    const { plan } = await corpusFor(src);
    if (!plan) return null;
    const { html } = await talkHtml(plan, entry, src, claim);
    if (html == null) return null;
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    const target = findTarget(doc, { plan, entry, live: plan.text !== 'bundled', html });
    return target ? paragraphText(target) : null;
  }

  const API = {
    load, destination, excerpt, reschedule, slotPolicy, corpusPlan, targetIds, talkCredit, fullTalkUrl, pickSessionUrl, bouncedToConference, lastSlug,
    snippetKey, snippetMatches, locateParagraph, byuTalkUrl, byuViewerUrl, readingDestination, FETCH_POLICY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { talkSource: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
