/*
 * PROTOTYPE — throwaway, not a feature. Answers one question: what would a
 * Church-language text look like split into the reader's own page, instead of
 * in the side panel? Three variants, switchable from the floating bar at the
 * bottom of the page (or ← / →):
 *
 *   A  Parallel columns — the reading column widens and splits; English left,
 *      the other language right, every verse pair starting on the same row.
 *   B  Interlinear — the column stays; each verse's translation sits under it.
 *   C  Split pane — the right half of the page is a second reader that follows
 *      the English one verse by verse (not proportionally) as you scroll.
 *
 * Inert unless the URL carries ?btx-split=A|B|C (kept for the tab in
 * sessionStorage so chapter navigation stays in the prototype; ✕ on the bar
 * turns it off). Language: ?btx-split-lang=jpn, else the first enabled Church
 * language, else Spanish. It hides the side panel while active.
 *
 * Pairs by element id — p1…pN, title_number1, study_summary1, … are the same
 * in every language (ADR-0005: stable hooks, never the site's hashed classes).
 * Each translated element copies its English partner's computed typography,
 * so it reads as part of the page. Prototype-grade: it appends one layer to
 * article#main (React owns that tree) and writes per-id CSS.
 */
(function (root) {
  'use strict';

  const B = root.__BTX;
  const VARIANTS = [
    { key: 'A', name: 'Parallel columns' },
    { key: 'B', name: 'Interlinear' },
    { key: 'C', name: 'Split pane' },
  ];
  const SS_KEY = 'btx-split-variant';
  const TYPO = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing',
    'textTransform', 'textAlign', 'textIndent', 'color', 'fontVariant'];
  const GAP = 28;

  let active = null; // { key, variant, lang, cleanup[], pairs, unpaired, status }
  let bar = null;

  function params() { return new URLSearchParams(location.search); }
  function wantedVariant() {
    const q = params().get('btx-split');
    if (q && VARIANTS.some((v) => v.key === q.toUpperCase())) {
      try { sessionStorage.setItem(SS_KEY, q.toUpperCase()); } catch (e) { /* ignore */ }
      return q.toUpperCase();
    }
    try { return sessionStorage.getItem(SS_KEY); } catch (e) { return null; }
  }

  async function wantedLang() {
    const q = params().get('btx-split-lang');
    if (q) return q;
    try {
      const s = await B.settings.get();
      if (s.churchLanguages && s.churchLanguages.length) return s.churchLanguages[0];
    } catch (e) { /* ignore */ }
    return 'spa';
  }

  function setVariant(key) {
    try {
      if (key) sessionStorage.setItem(SS_KEY, key); else sessionStorage.removeItem(SS_KEY);
    } catch (e) { /* ignore */ }
    const u = new URL(location.href);
    if (key) u.searchParams.set('btx-split', key); else u.searchParams.delete('btx-split');
    history.replaceState(history.state, '', u.toString());
    tick(true);
  }

  // ---- fetch + pair ----------------------------------------------------------

  async function loadForeign(parsed, lang) {
    const CT = B.churchText;
    const uri = CT.chapterUri(parsed);
    const res = await fetch(CT.apiUrl(lang, uri), { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const doc = new DOMParser().parseFromString(json.content.body, 'text/html');
    const attrs = (json.meta && json.meta.pageAttributes) || {};
    if (attrs['data-uri'] && attrs['data-uri'] !== uri) throw new Error('not published in this language');
    const items = [];
    for (const el of doc.body.querySelectorAll('p[id], h1[id], h2[id], h3[id], h4[id]')) {
      if (el.closest('footer, figure')) continue;
      const block = CT.chapterFrom({ childNodes: [el] }, {}).blocks[0];
      if (block) items.push({ id: el.id, block });
    }
    return { items, bcp47: attrs['data-bcp47-lang'] || '', title: (json.meta && json.meta.title) || '' };
  }

  function render(item, partner) {
    const wrap = document.createElement('div');
    wrap.className = 'btxs-item';
    wrap.setAttribute('data-for', item.id);
    wrap.appendChild(B.sanitize.renderBlocks([item.block]));
    if (partner) {
      const cs = getComputedStyle(partner);
      for (const k of TYPO) wrap.style[k] = cs[k];
      const vn = partner.querySelector('.verse-number');
      if (vn) {
        const vcs = getComputedStyle(vn);
        for (const n of wrap.querySelectorAll('.btx-vnum')) {
          n.style.fontWeight = vcs.fontWeight;
          n.style.color = vcs.color;
          n.style.fontSize = vcs.fontSize;
        }
      }
    }
    return wrap;
  }

  // ---- shared chrome -----------------------------------------------------------

  function addStyle(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    return s;
  }

  function accentColor(article) {
    const a = article.querySelector('a[href]');
    return a ? getComputedStyle(a).color : 'rgb(0, 120, 180)';
  }

  // The reading area the site leaves visible: from the right edge of its
  // left-hand navigation (when open) to `right`. section#content is centred in
  // a column wider than that, so a widened column has to be fitted to it.
  function fitContent(right, maxWidth) {
    const content = document.getElementById('content');
    if (!content) return () => {};
    let left = 0;
    for (let n = document.elementFromPoint(4, innerHeight / 2); n && n !== document.body; n = n.parentElement) {
      if (n.contains(content)) break;
      const r = n.getBoundingClientRect();
      if (r.left <= 4 && r.right < right / 2) left = Math.max(left, r.right);
    }
    const style = addStyle('section#content { padding-left: 40px !important; padding-right: 40px !important; }');
    const r = content.getBoundingClientRect();
    const c = r.left + r.width / 2;
    const width = Math.max(320, Math.min(maxWidth, 2 * Math.min(c - left, right - c) - 24));
    style.textContent += `\nsection#content { max-width: ${Math.round(width)}px !important; }`;
    return () => style.remove();
  }

  function pageBackground(el) {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return 'white';
  }

  const BASE_CSS = `
    #btx-root { display: none !important; }
    html { margin-right: 0 !important; }
    .btxs-item .btx-para, .btxs-item .btx-heading { margin: 0; font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit; }
    .btxs-item .btx-vnum { vertical-align: baseline; line-height: inherit; margin-inline-end: .3em; }
    .btxs-item .btx-poetry { padding-inline-start: 1.2em; }
    .btxs-item rt { font-size: .5em; }
    .btxs-item br { display: inline !important; } /* the site hides <br> in its reader */
  `;

  // ---- variants ------------------------------------------------------------------

  // A and B both lay translated items over article#main at their partners'
  // offsets and make room with per-id CSS; they differ in where "room" is.
  function overlayVariant(ctx, mode) {
    const { article, items } = ctx;
    const cleanup = [];
    const base = addStyle(BASE_CSS + 'article#main { position: relative; }');
    cleanup.push(() => base.remove());
    if (mode === 'A') cleanup.push(fitContent(document.documentElement.clientWidth, 1240));
    const sized = addStyle('');
    cleanup.push(() => sized.remove());

    const layer = document.createElement('div');
    layer.className = 'btxs-layer';
    layer.style.cssText = 'position:absolute; inset:0 0 auto 0; pointer-events:none;';
    article.appendChild(layer);
    cleanup.push(() => layer.remove());

    const pairs = [];
    const unpaired = [];
    for (const it of items) {
      const partner = document.getElementById(it.id);
      if (!partner || !article.contains(partner)) { unpaired.push(it.id); continue; }
      const node = render(it, partner);
      node.style.position = 'absolute';
      node.style.pointerEvents = 'auto';
      if (mode === 'A') {
        node.style.left = `calc(50% + ${GAP / 2}px)`;
        node.style.width = `calc(50% - ${GAP / 2}px)`;
      } else {
        node.style.left = '0';
        node.style.width = '100%';
        node.style.boxSizing = 'border-box';
        node.style.paddingInlineStart = '14px';
        node.style.borderInlineStart = `3px solid ${accentColor(article)}`;
        node.style.opacity = '0.82';
        node.style.fontSize = `calc(${getComputedStyle(partner).fontSize} * 0.92)`;
      }
      if (ctx.bcp47) node.lang = ctx.bcp47;
      if (B.churchText.dirOf(ctx.bcp47)) node.dir = 'rtl';
      layer.appendChild(node);
      pairs.push({ id: it.id, partner, node });
    }
    if (mode === 'A' && pairs.length) {
      const narrow = pairs.map((p) => `article#main [id="${p.id}"]`).join(',\n');
      cleanup.push(addStyleRef(`${narrow} { width: calc(50% - ${GAP / 2}px) !important; box-sizing: border-box; }`));
    }

    const sel = (id) => `article#main [id="${id}"]`;
    // Row alignment: each translated item is pinned to its partner's top. A
    // pair whose translation runs longer gets that height as the English
    // element's min-height, so the next pair still starts on one row; a pair
    // whose English runs longer simply leaves open space under the translation.
    function layout() {
      sized.textContent = ''; // measure natural English heights first
      const aTop = article.getBoundingClientRect().top;
      const rules = [];
      const heights = pairs.map((p) => ({ p, eng: p.partner.getBoundingClientRect().height, tr: p.node.getBoundingClientRect().height }));
      for (const h of heights) {
        if (mode === 'A') {
          if (h.tr > h.eng) rules.push(`${sel(h.p.id)} { min-height: ${Math.ceil(h.tr)}px !important; }`);
        } else {
          const mb = parseFloat(getComputedStyle(h.p.partner).marginBottom) || 0;
          rules.push(`${sel(h.p.id)} { margin-bottom: ${Math.ceil(h.tr + mb + 10)}px !important; }`);
        }
      }
      sized.textContent = rules.join('\n');
      for (const h of heights) {
        const r = h.p.partner.getBoundingClientRect();
        const top = mode === 'A' ? r.top - aTop : r.bottom - aTop + 4;
        h.p.node.style.top = `${Math.round(top)}px`;
      }
      layer.style.height = `${Math.ceil(article.getBoundingClientRect().height)}px`;
    }
    let lastWidth = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.round(article.getBoundingClientRect().width);
      if (w !== lastWidth) { lastWidth = w; requestAnimationFrame(layout); }
    });
    ro.observe(article);
    cleanup.push(() => ro.disconnect());
    lastWidth = Math.round(article.getBoundingClientRect().width);
    layout();
    // fonts and the site's own late layout settle after first paint
    const t = [300, 1200].map((ms) => setTimeout(layout, ms));
    cleanup.push(() => t.forEach(clearTimeout));
    return { cleanup, pairs: pairs.length, unpaired };
  }

  function addStyleRef(css) {
    const s = addStyle(css);
    return () => s.remove();
  }

  // C: a second reader in the right half of the page, following by verse.
  function paneVariant(ctx) {
    const { article, items } = ctx;
    const cleanup = [];
    const content = document.getElementById('content') || article;
    const left = Math.max(0, content.parentElement.getBoundingClientRect().left);
    const paneWidth = Math.round((window.innerWidth - left) / 2);
    const base = addStyle(BASE_CSS + `
      html { margin-right: ${paneWidth}px !important; }
      .btxs-pane { position: fixed; top: 0; right: 0; bottom: 0; width: ${paneWidth}px; overflow-y: auto;
        z-index: 2147483000; box-sizing: border-box; padding: 0 40px 60vh; border-left: 1px solid rgba(128,128,128,.35); }
      .btxs-pane-head { position: sticky; top: 0; z-index: 1; padding: 18px 0 12px; font: 600 13px/1.2 system-ui, sans-serif;
        letter-spacing: .04em; text-transform: uppercase; }
      .btxs-pane-head span { opacity: .7; }
      .btxs-pane .btxs-item { margin: 0 0 var(--btxs-mb, 16px); }
      .btxs-pane .btxs-item.btxs-now { box-shadow: -14px 0 0 -11px var(--btxs-accent); }
    `);
    cleanup.push(() => base.remove());
    cleanup.push(fitContent(window.innerWidth - paneWidth, 760));

    const pane = document.createElement('div');
    pane.className = 'btxs-pane';
    const bg = pageBackground(article);
    pane.style.background = bg;
    pane.style.setProperty('--btxs-accent', accentColor(article));
    const head = document.createElement('div');
    head.className = 'btxs-pane-head';
    head.style.background = bg;
    const label = document.createElement('span');
    label.textContent = `${ctx.langName} · ${ctx.title}`;
    head.appendChild(label);
    pane.appendChild(head);
    document.body.appendChild(pane);
    cleanup.push(() => pane.remove());

    const pairs = [];
    const unpaired = [];
    for (const it of items) {
      const partner = document.getElementById(it.id);
      const node = render(it, partner && article.contains(partner) ? partner : null);
      if (partner) node.style.setProperty('--btxs-mb', getComputedStyle(partner).marginBottom);
      if (ctx.bcp47) node.lang = ctx.bcp47;
      if (B.churchText.dirOf(ctx.bcp47)) node.dir = 'rtl';
      pane.appendChild(node);
      if (partner && article.contains(partner)) pairs.push({ id: it.id, partner, node });
      else unpaired.push(it.id);
    }

    // Verse-anchored follow: whatever English element crosses the reading line
    // (a third of the way down), put its partner at the same height, at the
    // same fraction through it.
    let raf = null;
    function follow() {
      raf = null;
      const line = window.innerHeight / 3;
      let cur = pairs[0];
      for (const p of pairs) {
        const r = p.partner.getBoundingClientRect();
        if (r.top <= line) cur = p; else break;
      }
      if (!cur) return;
      const r = cur.partner.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (line - r.top) / Math.max(1, r.height)));
      const paneTop = pane.getBoundingClientRect().top;
      const target = cur.node.offsetTop + f * cur.node.offsetHeight - (line - paneTop);
      pane.scrollTop = target;
      for (const p of pairs) p.node.classList.toggle('btxs-now', p === cur);
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(follow); };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanup.push(() => window.removeEventListener('scroll', onScroll));
    const t = [0, 300, 1200].map((ms) => setTimeout(follow, ms));
    cleanup.push(() => t.forEach(clearTimeout));
    return { cleanup, pairs: pairs.length, unpaired };
  }

  // ---- lifecycle -------------------------------------------------------------------

  function teardown() {
    if (!active) return;
    for (const fn of (active.cleanup || []).reverse()) { try { fn(); } catch (e) { /* ignore */ } }
    active = null;
  }

  let busy = false;
  async function tick(force) {
    const variant = wantedVariant();
    const parsed = B.detect.parseLocation(location.pathname, location.search);
    if (!variant || !parsed) { teardown(); drawBar(); return; }
    const lang = await wantedLang();
    const key = `${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}|${variant}|${lang}`;
    if (!force && active && active.key === key) return;
    if (busy) return;
    const article = document.getElementById('main');
    if (!article || !document.getElementById('p1')) return; // React hasn't rendered the chapter yet
    busy = true;
    teardown();
    active = { key, variant, lang, cleanup: [], status: 'loading…' };
    drawBar();
    try {
      const f = await loadForeign(parsed, lang);
      if (!active || active.key !== key) return;
      const L = (B.const.CHURCH_LANGUAGES || []).find((l) => l.code === lang);
      const ctx = { article, items: f.items, bcp47: f.bcp47, title: f.title, langName: L ? L.name : lang };
      const r = variant === 'C' ? paneVariant(ctx) : overlayVariant(ctx, variant);
      active.cleanup = r.cleanup;
      active.status = `${ctx.langName} · ${r.pairs} paired` + (r.unpaired.length ? ` · ${r.unpaired.length} unpaired (${r.unpaired.slice(0, 4).join(', ')}${r.unpaired.length > 4 ? '…' : ''})` : '');
      console.info('[btx split prototype]', { variant, lang, paired: r.pairs, unpaired: r.unpaired });
    } catch (e) {
      if (active && active.key === key) active.status = `${lang}: ${e.message}`;
    } finally {
      busy = false;
      drawBar();
    }
  }

  // ---- floating switcher (prototype chrome, deliberately not the site's look) ----------

  function drawBar() {
    const variant = wantedVariant();
    if (!variant) { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.style.cssText = 'position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147483647;' +
        'display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:999px; background:#111; color:#fff;' +
        'font:500 13px/1 system-ui,sans-serif; box-shadow:0 6px 24px rgba(0,0,0,.35); white-space:nowrap;';
      document.body.appendChild(bar);
    }
    const i = VARIANTS.findIndex((v) => v.key === variant);
    const v = VARIANTS[i];
    bar.textContent = '';
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = 'all:unset; cursor:pointer; padding:4px 8px; border-radius:999px; background:#2a2a2a;';
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };
    btn('‹', 'Previous variant (←)', () => setVariant(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length].key));
    const label = document.createElement('span');
    label.textContent = `PROTOTYPE  ${v.key} · ${v.name}  —  ${active ? active.status : 'waiting for the chapter…'}`;
    bar.appendChild(label);
    btn('›', 'Next variant (→)', () => setVariant(VARIANTS[(i + 1) % VARIANTS.length].key));
    btn('✕', 'Turn the prototype off', () => setVariant(null));
  }

  window.addEventListener('keydown', (e) => {
    if (!wantedVariant()) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const i = VARIANTS.findIndex((v) => v.key === wantedVariant());
    const n = VARIANTS[(i + (e.key === 'ArrowRight' ? 1 : VARIANTS.length - 1)) % VARIANTS.length];
    setVariant(n.key);
  }, true);

  setInterval(() => tick(false), 500);
  tick(false);
})(typeof globalThis !== 'undefined' ? globalThis : this);
