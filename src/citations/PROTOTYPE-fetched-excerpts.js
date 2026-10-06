/*
 * PROTOTYPE — throwaway, branch prototype/fetched-excerpts only. Never merge.
 *
 * Question it answers (wayfinder #59): how does it *feel* when a citation row's
 * excerpt is fetched live instead of bundled? Latency, text popping in, data use.
 *
 * Behaviour (as decided on #59):
 *   - Modern (G) and early (E) conference rows drop their bundled snippet.
 *   - A row fetches its talk once it is on screen (or within the look-ahead
 *     band above/below it) inside an open group (IntersectionObserver rooted
 *     on the panel body; closed <details> content is never visible).
 *   - At most MAX_IN_FLIGHT fetches at once; one fetch per talk per session.
 *     A free slot goes to the topmost row on screen, then the look-ahead band;
 *     a row scrolled past before its turn waits off screen and costs nothing
 *     unless it comes back into view.
 *   - G: live same-origin page; located by paragraph anchor (pN), else the
 *     link locator (an inline scripture link -> its paragraph, or a footnote
 *     link -> the paragraph holding its marker). E: BYU talks_ajax, located by citation span id.
 *   - Miss or failure: the row keeps its reference line only.
 *   - Opening a talk whose page was already fetched reuses that HTML.
 *
 * A stats strip (bottom-left of the window) shows what happened and offers
 * feel knobs: placeholder (reserved "Loading…", reserved skeleton, or none),
 * look-ahead band, and extra delay (to feel a slow connection).
 *
 * IIFE -> __BTX.protoExcerpts.
 */
(function (root) {
  'use strict';

  const MAX_IN_FLIGHT = 6;
  const BYU_AJAX = 'https://scriptures.byu.edu/content/talks_ajax/';

  const knobs = { placeholder: 'loading', lookAhead: 1, delayMs: 0 };
  const stats = { talks: 0, bytes: 0, wireBytes: 0, ms: [], inFlight: 0, queued: 0, waiting: 0,
    anchor: 0, footnote: 0, inline: 0, span: 0, miss: 0, failed: 0, landed: 0, jumped: 0 };

  // fetch key -> { promise, run, nodes:Set<row node>, started }
  const jobs = new Map();
  const visible = new Set();     // row nodes in view or in the look-ahead band
  const pending = new WeakMap(); // row node -> entry, until it is filled

  const corpusOf = (entry) => (entry && entry.source && entry.source.c) || null;
  function handles(entry) {
    const c = corpusOf(entry);
    return (c === 'G' && entry.source.url) || c === 'E';
  }

  /* --------------------------------------------------------------- fetching */

  // Which waiting job a free slot goes to: on screen before look-ahead, then
  // nearest the top of the panel. A job with no row in view waits.
  function nextJob() {
    const vh = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    let best = null, bestRank = Infinity;
    for (const job of jobs.values()) {
      if (job.started) continue;
      for (const node of job.nodes) {
        if (!visible.has(node) || !node.isConnected) continue;
        const r = node.getBoundingClientRect();
        const onScreen = r.bottom > vh.top && r.top < vh.bottom;
        const rank = (onScreen ? 0 : 1e6) + Math.abs(r.top - vh.top);
        if (rank < bestRank) { best = job; bestRank = rank; }
      }
    }
    return best;
  }

  function count() {
    let q = 0, w = 0;
    for (const job of jobs.values()) {
      if (job.started) continue;
      if ([...job.nodes].some((n) => visible.has(n) && n.isConnected)) q++; else w++;
    }
    stats.queued = q; stats.waiting = w;
  }

  function start(job) {
    job.started = true;
    stats.inFlight++;
    job.run().finally(() => { job.done = true; stats.inFlight--; pump(); });
  }

  // Fetches holding a slot: in flight with a row still in view. One whose
  // rows were all scrolled away finishes in the background (for the cache)
  // without blocking the rows now on screen.
  function holding() {
    let n = 0;
    for (const job of jobs.values()) {
      if (job.started && !job.done && [...job.nodes].some((x) => visible.has(x) && x.isConnected)) n++;
    }
    return n;
  }

  function pump() {
    let job;
    while (holding() < MAX_IN_FLIGHT && (job = nextJob())) start(job);
    count();
    draw();
  }

  function wireSize(url) {
    try {
      const e = performance.getEntriesByName(url).pop();
      return e && e.transferSize ? e.transferSize : 0;
    } catch (_) { return 0; }
  }

  // One page per key; pump() starts it once one of its rows is in view.
  function page(key, fetcher, node) {
    let job = jobs.get(key);
    if (!job) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      job = { promise, nodes: new Set(), started: false, run: async () => {
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
      } };
      jobs.set(key, job);
    }
    if (node) job.nodes.add(node);
    pump();
    return job.promise;
  }

  const ts = () => root.__BTX.talkSource;
  function fetchG(entry, node) {
    return page('G:' + entry.source.url, () => ts().fetchLiveTalk(entry.source.url), node);
  }
  function fetchE(entry, node) {
    const url = BYU_AJAX + entry.talkId;
    return page('E:' + entry.talkId, async () => {
      const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
      return res.ok ? { html: await res.text(), url: res.url } : null;
    }, node);
  }

  // For talk-source: HTML fetched (or being fetched) for this live URL, or
  // null. Opening a talk whose excerpt is still waiting starts it now.
  async function cachedLive(url) {
    const job = jobs.get('G:' + url);
    if (!job) return null;
    if (!job.started) start(job);
    const out = await job.promise;
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

  // The paragraph whose scripture link best matches the cite: a footnote
  // link counts for the paragraph holding that footnote's marker; an inline
  // link (recent talks cite in the text, "(Alma 5:12)", with no footnotes)
  // counts for its own paragraph. Ties go to the first in the talk.
  function linkParagraph(doc, entry) {
    const want = chapterPath();
    if (!want) return { node: null };
    const verses = new Set(entry.versesInChapter || []);
    let best = null, bestScore = 0;
    for (const a of doc.querySelectorAll('a[href*="/study/scriptures/"]')) {
      let u;
      try { u = new URL(a.getAttribute('href'), location.origin); } catch (_) { continue; }
      if (u.pathname.replace(/\/+$/, '') !== want) continue;
      let score = 1; // chapter-only match
      for (const v of versesOfId(u.searchParams.get('id'))) if (verses.has(v)) score++;
      if (score <= bestScore) continue;
      const li = a.closest('li[id^="note"]');
      let node, how = 'inline';
      if (li) {
        const ref = doc.querySelector(`a.note-ref[data-scroll-id="${li.id}"], a.note-ref[href$="#${li.id}"]`);
        node = ref && ref.closest('p, li, blockquote');
        how = 'footnote';
      } else {
        node = a.closest('p, li, blockquote');
      }
      if (node) { best = { node, how }; bestScore = score; }
    }
    return best || { node: null };
  }

  function excerptFrom(html, entry) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let node = null, how = 'miss';
    if (corpusOf(entry) === 'G') {
      if (entry.anchor) { node = doc.getElementById(entry.anchor); if (node) how = 'anchor'; }
      if (!node) { const m = linkParagraph(doc, entry); if (m.node) { node = m.node; how = m.how; } }
    } else {
      const span = doc.getElementById(String(entry.citId));
      if (span) { node = span.closest('p, div') || span; how = 'span'; }
    }
    if (!node) return { text: null, how };
    const text = node.textContent.replace(/[\s ]+/g, ' ').trim();
    return { text: text || null, how: text ? how : 'miss' };
  }

  /* -------------------------------------------------------------------- rows */

  // Rooted on the panel body (the scroller): with the viewport as root, the
  // look-ahead margin would be clipped away by the panel's own scroll box.
  let scroller = null, observer = null;
  function makeObserver() {
    const old = observer;
    const band = Math.round((scroller ? scroller.clientHeight : innerHeight) * knobs.lookAhead);
    observer = new IntersectionObserver((records) => {
      for (const r of records) {
        if (r.isIntersecting) visible.add(r.target); else visible.delete(r.target);
      }
      pump();
    }, { root: scroller, rootMargin: `${band}px 0px` });
    if (old) {
      old.disconnect();
      visible.clear();
      for (const job of jobs.values()) for (const n of job.nodes) if (pending.has(n)) observer.observe(n);
    }
  }
  function observe(node, tries = 0) {
    const body = node.isConnected && node.closest('.btx-body');
    if (!body) { if (tries < 20) requestAnimationFrame(() => observe(node, tries + 1)); return; }
    if (body !== scroller) { scroller = body; makeObserver(); }
    observer.observe(node);
  }

  // A miss gives back its reserved lines with a short ease, not a jump.
  function collapse(slot) {
    if (knobs.placeholder === 'pop') { slot.remove(); return; }
    slot.style.height = slot.getBoundingClientRect().height + 'px';
    slot.getBoundingClientRect();
    slot.classList.add('btx-proto-collapse');
    slot.addEventListener('transitionend', () => slot.remove(), { once: true });
    setTimeout(() => slot.remove(), 400);
  }

  async function fill(node, entry) {
    const slot = node.querySelector('.btx-proto-slot');
    const t0 = performance.now();
    const out = await (corpusOf(entry) === 'G' ? fetchG(entry, node) : fetchE(entry, node));
    pending.delete(node);
    if (observer) observer.unobserve(node);
    visible.delete(node);
    const res = out ? excerptFrom(out.html, entry) : { text: null, how: 'failed' };
    if (res.how !== 'failed') stats[res.how]++;
    draw();
    if (!slot) return;
    if (!res.text) { collapse(slot); return; }
    // Landed while the list was off the page (a talk open): no fade to replay.
    if (!node.isConnected) { slot.textContent = `“${res.text}”`; slot.className = 'btx-cit-snippet'; return; }
    const before = slot.offsetHeight;
    slot.textContent = `“${res.text}”`;
    slot.className = 'btx-cit-snippet btx-proto-fade';
    // Fade once: Back re-inserts the cached list, which would replay it.
    // A timer, not animationend: a talk opened mid-fade cancels the animation.
    setTimeout(() => slot.classList.remove('btx-proto-fade'), 300);
    if (knobs.placeholder !== 'pop' && node.isConnected && before) {
      stats.landed++;
      if (Math.abs(slot.offsetHeight - before) > 2) stats.jumped++;
      draw();
    }
    slot.title = `PROTOTYPE: ${res.how}, ${Math.round(performance.now() - t0)} ms after the row was drawn`;
    slot.id = 'btx-proto-' + Math.random().toString(36).slice(2);
    node.setAttribute('aria-describedby', slot.id);
  }

  // Bundled excerpt lengths (tools/PROTOTYPE-excerpt-lengths.js): a number per
  // cite, no text. Until it loads, or for a cite it lacks, the reserve is a
  // full three lines.
  let lengths = null;
  fetch(chrome.runtime.getURL('src/citations/data/PROTOTYPE-excerpt-lengths.json'))
    .then((r) => r.json()).then((j) => { lengths = j; }).catch(() => {});
  const FILLER = 'the word was with god and all things were made by him in the beginning of the ' +
    'light that shines in darkness which comprehended it not there was a man sent from ';
  function filler(chars) {
    let s = '';
    while (s.length < chars) s += FILLER;
    return s.slice(0, Math.max(1, chars));
  }

  // Called by cit-panel's rowEl for a row this prototype handles. The slot is
  // the excerpt's own box (.btx-cit-snippet: font, line-height, 3-line clamp)
  // holding invisible filler of the excerpt's exact length, so the browser
  // wraps it as it will wrap the text: the reserve tracks font size and panel
  // width with no measuring, and the row does not move when the text lands.
  function attach(node, entry) {
    const slot = document.createElement('div');
    slot.className = 'btx-cit-snippet btx-proto-slot';
    const fill_ = document.createElement('span');
    fill_.className = 'btx-proto-filler';
    fill_.setAttribute('aria-hidden', 'true');
    fill_.textContent = filler((lengths && lengths[entry.citId]) || 400);
    slot.appendChild(fill_);
    node.appendChild(slot);
    pending.set(node, entry);
    fill(node, entry);
    observe(node);
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
      ` · waiting off screen ${stats.waiting}` +
      ` · median ${med == null ? '–' : med + ' ms'} · max ${max == null ? '–' : max + ' ms'}` +
      ` · ${kb(stats.wireBytes)} wire / ${kb(stats.bytes)} raw` +
      ` · located: anchor ${stats.anchor}, footnote ${stats.footnote}, inline ${stats.inline}, span ${stats.span}` +
      ` · missed ${stats.miss} · failed ${stats.failed}` +
      ` · rows that moved on arrival ${stats.jumped} of ${stats.landed}`;
  }
  function build() {
    strip = document.createElement('div');
    strip.className = 'btx-proto-strip';
    strip.innerHTML =
      '<b>PROTOTYPE excerpts</b> <span class="s"></span><br>' +
      'placeholder <select class="ph"><option value="loading">exact size, “Loading…”</option>' +
      '<option value="skeleton">exact size, skeleton lines</option><option value="pop">none (pop in)</option></select> ' +
      'look-ahead <select class="la"><option value="1">1 screen</option><option value="0.5">½ screen</option>' +
      '<option value="0">none</option></select> ' +
      'extra delay <select class="dl"><option value="0">0</option><option value="1000">+1 s</option>' +
      '<option value="3000">+3 s</option></select> ' +
      '<button class="rs">clear cache</button> <button class="hd">hide</button>';
    strip.querySelector('.ph').addEventListener('change', (e) => {
      knobs.placeholder = e.target.value;
      document.documentElement.dataset.btxProtoPh = knobs.placeholder;
    });
    strip.querySelector('.la').addEventListener('change', (e) => {
      knobs.lookAhead = +e.target.value;
      if (scroller) makeObserver();
    });
    strip.querySelector('.dl').addEventListener('change', (e) => { knobs.delayMs = +e.target.value; });
    strip.querySelector('.rs').addEventListener('click', () => {
      for (const [k, job] of jobs) if (job.started) jobs.delete(k);
      Object.assign(stats, { talks: 0, bytes: 0, wireBytes: 0, ms: [], anchor: 0, footnote: 0, inline: 0, span: 0, miss: 0, failed: 0, landed: 0, jumped: 0 });
      draw();
    });
    strip.querySelector('.hd').addEventListener('click', () => { strip.style.display = 'none'; });
    document.documentElement.appendChild(strip);
    document.documentElement.dataset.btxProtoPh = knobs.placeholder;
  }

  root.__BTX = Object.assign(root.__BTX || {}, { protoExcerpts: { handles, attach, cachedLive } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
