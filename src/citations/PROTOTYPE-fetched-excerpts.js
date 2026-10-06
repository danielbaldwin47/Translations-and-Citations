/*
 * PROTOTYPE — throwaway, branch prototype/fetched-excerpts only. Never merge.
 *
 * Question it answers (wayfinder #59): how does it *feel* when a citation row's
 * excerpt is fetched live instead of bundled? Latency, text popping in, data use.
 *
 * Behaviour (as decided on #59):
 *   - Modern (G) and early (E) conference rows drop their bundled snippet.
 *   - A row fetches its talk once it is visible inside an open group
 *     (IntersectionObserver; closed <details> content is never visible).
 *   - At most MAX_IN_FLIGHT fetches at once; one fetch per talk per session.
 *   - G: live same-origin page; located by paragraph anchor (pN), else the
 *     footnote locator (the footnote linking the cited verse -> paragraph
 *     holding its marker). E: BYU talks_ajax, located by citation span id.
 *   - Miss or failure: the row keeps its reference line only.
 *   - Opening a talk whose page was already fetched reuses that HTML.
 *
 * A stats strip (bottom-left of the window) shows what happened and offers two
 * feel knobs: placeholder style (pop-in vs reserved skeleton) and extra delay
 * (to feel a slow connection).
 *
 * IIFE -> __BTX.protoExcerpts.
 */
(function (root) {
  'use strict';

  const MAX_IN_FLIGHT = 4;
  const BYU_AJAX = 'https://scriptures.byu.edu/content/talks_ajax/';

  const knobs = { placeholder: 'pop', delayMs: 0 };
  const stats = { talks: 0, bytes: 0, wireBytes: 0, ms: [], inFlight: 0, queued: 0,
    anchor: 0, footnote: 0, span: 0, miss: 0, failed: 0 };

  const pages = new Map();   // fetch key -> Promise<{ html, url } | null>
  const queue = [];          // pending fetch thunks
  const pending = new WeakMap(); // row node -> entry, until it is seen

  const corpusOf = (entry) => (entry && entry.source && entry.source.c) || null;
  function handles(entry) {
    const c = corpusOf(entry);
    return (c === 'G' && entry.source.url) || c === 'E';
  }

  /* --------------------------------------------------------------- fetching */

  function pump() {
    while (stats.inFlight < MAX_IN_FLIGHT && queue.length) {
      const run = queue.shift();
      stats.queued = queue.length;
      stats.inFlight++;
      run().finally(() => { stats.inFlight--; draw(); pump(); });
    }
    draw();
  }

  function wireSize(url) {
    try {
      const e = performance.getEntriesByName(url).pop();
      return e && e.transferSize ? e.transferSize : 0;
    } catch (_) { return 0; }
  }

  // One page per key, queued behind the concurrency cap.
  function page(key, fetcher) {
    if (pages.has(key)) return pages.get(key);
    const p = new Promise((resolve) => {
      queue.push(async () => {
        const t0 = performance.now();
        let out = null;
        try {
          if (knobs.delayMs) await new Promise((r) => setTimeout(r, knobs.delayMs));
          out = await fetcher();
        } catch (_) { out = null; }
        if (out && out.html != null) {
          stats.talks++;
          stats.bytes += out.html.length;
          stats.wireBytes += wireSize(out.url) || 0;
          stats.ms.push(performance.now() - t0);
        } else {
          stats.failed++;
        }
        resolve(out && out.html != null ? out : null);
      });
      stats.queued = queue.length;
    });
    pages.set(key, p);
    pump();
    return p;
  }

  const ts = () => root.__BTX.talkSource;
  function fetchG(entry) {
    return page('G:' + entry.source.url, () => ts().fetchLiveTalk(entry.source.url));
  }
  function fetchE(entry) {
    const url = BYU_AJAX + entry.talkId;
    return page('E:' + entry.talkId, async () => {
      const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
      return res.ok ? { html: await res.text(), url: res.url } : null;
    });
  }

  // For talk-source: HTML already fetched for this live URL, or null.
  async function cachedLive(url) {
    const p = pages.get('G:' + url);
    if (!p) return null;
    const out = await p;
    return out ? out.html : null;
  }

  /* ---------------------------------------------------------------- locating */

  // "p1,3,14" / "p4-p8" / "p12" -> Set of verse numbers.
  function versesOfId(id) {
    const out = new Set();
    for (const part of String(id || '').split(',')) {
      const m = /^p?(\d+)(?:-p?(\d+))?$/.exec(part.trim());
      if (!m) continue;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let v = a; v <= b && v - a < 200; v++) out.add(v);
    }
    return out;
  }

  // The chapter the list belongs to, as the site writes it in footnote links.
  function chapterPath() {
    const m = /\/study\/scriptures\/[^?#]+/.exec(location.pathname);
    return m ? m[0].replace(/\/+$/, '') : null;
  }

  function footnoteParagraph(doc, entry) {
    const want = chapterPath();
    if (!want) return null;
    const verses = new Set(entry.versesInChapter || []);
    let best = null, bestScore = 0;
    for (const li of doc.querySelectorAll('li[id^="note"]')) {
      for (const a of li.querySelectorAll('a[href*="/study/scriptures/"]')) {
        let u;
        try { u = new URL(a.getAttribute('href'), location.origin); } catch (_) { continue; }
        if (u.pathname.replace(/\/+$/, '') !== want) continue;
        const vs = versesOfId(u.searchParams.get('id'));
        let score = 1; // chapter-only match
        for (const v of vs) if (verses.has(v)) score++;
        if (score > bestScore) { best = li.id; bestScore = score; }
      }
    }
    if (!best) return null;
    const ref = doc.querySelector(`a.note-ref[data-scroll-id="${best}"], a.note-ref[href$="#${best}"]`);
    return ref ? ref.closest('p, li, blockquote') : null;
  }

  function excerptFrom(html, entry) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let node = null, how = 'miss';
    if (corpusOf(entry) === 'G') {
      if (entry.anchor) { node = doc.getElementById(entry.anchor); if (node) how = 'anchor'; }
      if (!node) { node = footnoteParagraph(doc, entry); if (node) how = 'footnote'; }
    } else {
      const span = doc.getElementById(String(entry.citId));
      if (span) { node = span.closest('p, div') || span; how = 'span'; }
    }
    if (!node) return { text: null, how };
    const text = node.textContent.replace(/[\s ]+/g, ' ').trim();
    return { text: text || null, how: text ? how : 'miss' };
  }

  /* -------------------------------------------------------------------- rows */

  const observer = new IntersectionObserver((records) => {
    for (const r of records) {
      if (!r.isIntersecting) continue;
      const node = r.target;
      const entry = pending.get(node);
      observer.unobserve(node);
      if (!entry) continue;
      pending.delete(node);
      fill(node, entry);
    }
  }, { rootMargin: '0px' });

  async function fill(node, entry) {
    const slot = node.querySelector('.btx-proto-slot');
    if (slot && knobs.placeholder === 'skeleton') slot.classList.add('btx-proto-skeleton');
    const t0 = performance.now();
    const out = await (corpusOf(entry) === 'G' ? fetchG(entry) : fetchE(entry));
    const res = out ? excerptFrom(out.html, entry) : { text: null, how: 'failed' };
    if (res.how !== 'failed') stats[res.how]++;
    draw();
    if (!slot) return;
    slot.classList.remove('btx-proto-skeleton', 'btx-proto-reserve');
    if (!res.text) { slot.remove(); return; }
    slot.textContent = `“${res.text}”`;
    slot.className = 'btx-cit-snippet' + (knobs.placeholder === 'skeleton' ? ' btx-proto-fade' : '');
    slot.title = `PROTOTYPE: ${res.how}, ${Math.round(performance.now() - t0)} ms after the row appeared`;
    slot.id = 'btx-proto-' + Math.random().toString(36).slice(2);
    node.setAttribute('aria-describedby', slot.id);
  }

  // Called by cit-panel's rowEl for a row this prototype handles.
  function attach(node, entry) {
    const slot = document.createElement('div');
    slot.className = 'btx-proto-slot';
    if (knobs.placeholder === 'skeleton') slot.classList.add('btx-proto-reserve');
    node.appendChild(slot);
    pending.set(node, entry);
    observer.observe(node);
  }

  /* ------------------------------------------------------------- stats strip */

  let strip = null;
  function kb(n) { return n ? (n / 1024).toFixed(0) + ' KB' : '–'; }
  function draw() {
    if (!strip) build();
    const ms = stats.ms.slice().sort((a, b) => a - b);
    const med = ms.length ? Math.round(ms[Math.floor(ms.length / 2)]) : null;
    const max = ms.length ? Math.round(ms[ms.length - 1]) : null;
    strip.querySelector('.s').textContent =
      `talks fetched ${stats.talks} · in flight ${stats.inFlight} · queued ${stats.queued}` +
      ` · median ${med == null ? '–' : med + ' ms'} · max ${max == null ? '–' : max + ' ms'}` +
      ` · ${kb(stats.wireBytes)} wire / ${kb(stats.bytes)} raw` +
      ` · located: anchor ${stats.anchor}, footnote ${stats.footnote}, span ${stats.span}` +
      ` · missed ${stats.miss} · failed ${stats.failed}`;
  }
  function build() {
    strip = document.createElement('div');
    strip.className = 'btx-proto-strip';
    strip.innerHTML =
      '<b>PROTOTYPE excerpts</b> <span class="s"></span><br>' +
      'placeholder <select class="ph"><option value="pop">none (pop in)</option>' +
      '<option value="skeleton">reserved skeleton</option></select> ' +
      'extra delay <select class="dl"><option value="0">0</option><option value="1000">+1 s</option>' +
      '<option value="3000">+3 s</option></select> ' +
      '<button class="rs">clear cache</button> <button class="hd">hide</button>';
    strip.querySelector('.ph').addEventListener('change', (e) => { knobs.placeholder = e.target.value; });
    strip.querySelector('.dl').addEventListener('change', (e) => { knobs.delayMs = +e.target.value; });
    strip.querySelector('.rs').addEventListener('click', () => {
      pages.clear();
      Object.assign(stats, { talks: 0, bytes: 0, wireBytes: 0, ms: [], anchor: 0, footnote: 0, span: 0, miss: 0, failed: 0 });
      draw();
    });
    strip.querySelector('.hd').addEventListener('click', () => { strip.style.display = 'none'; });
    document.documentElement.appendChild(strip);
  }

  root.__BTX = Object.assign(root.__BTX || {}, { protoExcerpts: { handles, attach, cachedLive } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
