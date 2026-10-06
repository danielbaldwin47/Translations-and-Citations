/*
 * Talk source: the one place that knows how a talk is obtained and where its
 * cite sits inside it. Answers a single question for the reader —
 *
 *     load({ entry, source }) -> { html, url, findTarget(container) }
 *
 * "give me displayable HTML for this cite, plus how to find its target once
 * that HTML is rendered". Corpus differences (live fetch vs bundled gzip,
 * paragraph anchor vs citation span vs STPJS body passage) are decided by the
 * CORPUS_PLANS table below; talk-view renders and scrolls, and decides nothing
 * per corpus.
 *
 * Target order. A fetched modern talk (plan target 'anchor'): the cite's
 * paragraph anchor (pN), else the footnote locator (locateParagraph: the
 * paragraph the talk's own scripture links name, read from the fetched HTML
 * because the sanitizer unwraps links), else the snippet's paragraph for
 * corpora that still bundle a snippet. Every other plan, and a modern talk
 * read from the bundle: the citation span (STPJS: its body passage), else the
 * snippet's paragraph (snippetKey / snippetMatches).
 *
 * A live fetch gives up after LIVE_TIMEOUT_MS, so a hung request ends in the
 * reader's error state rather than an endless spinner.
 *
 * The DOM-free half (corpusPlan, the pre-2013 URL repair, locateParagraph,
 * snippetKey, snippetMatches) is exported for Node: `node --test tools/test-talk-source.js`.
 *
 * IIFE -> __BTX.talkSource (+ module.exports for the Node tests).
 */
(function (root) {
  'use strict';

  const citData = () => root.__BTX && root.__BTX.citData;

  // Per-corpus policy (GLOSSARY.md "Corpus"):
  //   fetch  'live'    — same-origin fetch from churchofjesuschrist.org
  //          'bundled' — the shipped talks/{talkId}.html.gz
  //   target 'anchor'       — the talk's paragraph anchor (pN), citation span as fallback
  //          'citationSpan' — <span class="citation" id="{citId}"> in the bundled markup
  //          'bodyPassage'  — STPJS: the body text the footnote annotates, not the
  //                           footnote-list line the citation span actually lives in
  const CORPUS_PLANS = {
    G: { fetch: 'live', target: 'anchor' },          // modern General Conference, 1971–
    E: { fetch: 'bundled', target: 'citationSpan' }, // early General Conference, 1942–70
    J: { fetch: 'bundled', target: 'citationSpan' }, // Journal of Discourses
    T: { fetch: 'bundled', target: 'bodyPassage' },  // Teachings of the Prophet Joseph Smith
  };

  const BUNDLED = { fetch: 'bundled', target: 'citationSpan' };
  const LIVE = { fetch: 'live', target: 'anchor' };

  // Resolve the plan for a talk. `hasUrl` is the escape hatch for data that
  // doesn't match the table: an unknown corpus is treated as live iff it ships a
  // URL, and a nominally live talk without one has to read the bundle (fetching
  // an undefined URL would otherwise blow up the reader).
  function corpusPlan(corpus, opts) {
    const hasUrl = opts && 'hasUrl' in opts ? !!opts.hasUrl : true;
    const plan = CORPUS_PLANS[corpus] || (hasUrl ? LIVE : BUNDLED);
    if (plan.fetch === 'live' && !hasUrl) return { ...BUNDLED };
    return { fetch: plan.fetch, target: plan.target };
  }

  /* ---------------------------------------------------------------- fetching */

  // Pre-Oct-2013 GC talks were stored without their session segment, e.g.
  // /study/ensign/2012/11/temple-standard. The site now 302s those to the
  // conference landing page (/study/ensign/2012/11), so a plain fetch silently
  // renders the wrong page. resolvedUrlCache memoizes the recovered session-
  // qualified URL per original so we only resolve once per session.
  const resolvedUrlCache = new Map();

  const LIVE_TIMEOUT_MS = 15000;
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

  // The body can still fail (or time out) after the headers arrived.
  async function bodyText(res) {
    try { return await res.text(); } catch (e) { return null; }
  }

  // Fetch a live church talk, recovering from the pre-2013 session-less redirect.
  // Returns { html, url }: html is the talk's HTML (null if it couldn't be loaded),
  // url is the effective talk URL (resolved when a redirect was repaired). Never throws.
  async function fetchLiveTalk(originalUrl) {
    const target = resolvedUrlCache.get(originalUrl) || originalUrl;
    let res;
    try { res = await liveFetch(target); }
    catch (e) { return { html: null, url: originalUrl }; }
    if (!res.ok) return { html: null, url: res.url };

    // Common case (post-2013, or an already-resolved cache hit): not bounced.
    if (resolvedUrlCache.has(originalUrl) || !bouncedToConference(originalUrl, res.url)) {
      return { html: await bodyText(res), url: res.url };
    }

    // Bounced to the conference landing page: recover from its table of contents.
    let realUrl = null;
    try {
      realUrl = pickSessionUrl({
        originalUrl,
        landedUrl: res.url,
        hrefs: hrefsIn((await bodyText(res)) || '', res.url),
        origin: location.origin,
      });
    } catch (e) { /* fall through */ }
    if (!realUrl) return { html: null, url: res.url }; // couldn't resolve -> bundled/CTA fallback

    let res2;
    try { res2 = await liveFetch(realUrl); }
    catch (e) { return { html: null, url: realUrl }; }
    if (!res2.ok) return { html: null, url: res2.url };
    const html = await bodyText(res2);
    if (html != null) resolvedUrlCache.set(originalUrl, realUrl);
    return { html, url: res2.url };
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
    // <span class="citation" id="{citId}">
    const span = entry.citId == null ? null : byId(container, String(entry.citId));
    if (!span) return bySnippet(container, snippetKey(entry.snippet));
    if (plan.target !== 'bodyPassage') return span;
    const note = span.closest('.btxk-footnote');
    return (note && bodyPassageForFootnote(container, note)) || span;
  }

  /* -------------------------------------------------------------------- load */

  // Public: obtain displayable HTML for `entry` plus how to find its target.
  // Returns { html, url, findTarget(container) }; html is null when the talk
  // could not be loaded (caller shows the "open on the site" fallback).
  async function load({ entry, source }) {
    const src = source || {};
    const plan = corpusPlan(src.c, { hasUrl: !!src.url });
    let html = null;
    let url = src.url || null;
    let live = false;

    if (plan.fetch === 'live') {
      const r = await fetchLiveTalk(src.url);
      if (r.html != null) { html = r.html; live = true; }
      url = r.url || src.url;
    }
    if (html == null) { // bundled talk (E/J/T), or a live one whose fetch failed
      try { html = await citData().loadTalkHtml(entry.talkId); }
      catch (e) { html = null; }
    }

    return {
      html,
      url,
      findTarget: (container) => findTarget(container, { plan, entry, live, html }),
    };
  }

  const API = {
    load, corpusPlan, fullTalkUrl, pickSessionUrl, bouncedToConference, lastSlug,
    snippetKey, snippetMatches, locateParagraph,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { talkSource: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
