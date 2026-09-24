/*
 * Page split: a Church-language chapter set into the site's own reading
 * column, paired verse by verse with the English it translates — the
 * extension's only write into the site's reader (ADR-0007).
 *
 * Interface:
 *   show({ key, chapter, layout, uri })  split the page. `chapter` is a
 *                          __BTX.churchText load result (blocks carry ids),
 *                          `layout` 'columns' | 'interlinear', `uri` the
 *                          chapter's /scriptures/… path. Same key as the split
 *                          showing: nothing happens. Waits, as long as it
 *                          takes, for the site to render that chapter
 *                          (article#main[data-uri] === uri) — the site swaps
 *                          the whole article on navigation.
 *   hide()                 remove every trace: layer, CSS, <html> attribute
 *   currentKey()           the key showing (or waiting to show), else null
 *
 * Two layouts (the `churchLanguageLayout` setting; 'panel' never gets here):
 *   columns      the reading column widens to the visible reading area and
 *                splits: English left, translation right. Each pair starts on
 *                one row; the shorter side leaves open space under it (the
 *                English element gets the translation's height as min-height
 *                when the translation runs longer). A translated block with no
 *                English partner (French numbers Psalm superscriptions as
 *                verses) rides under the pair before it rather than vanishing.
 *                Falls back to interlinear while two columns wouldn't each get
 *                MIN_COLUMN_PX of text.
 *   interlinear  the column is untouched; each translation sits under its
 *                English element, which gets room as extra margin-bottom.
 *
 * Mechanism (why it looks indirect): the site's reader is React's, so the
 * split never edits the site's nodes. Everything it adds is (a) one layer
 * appended to article#main holding the translated blocks, absolutely placed
 * at their partners' offsets, (b) <style> elements whose rules select the
 * site's elements by id (p5, title_number1 — the same in every language,
 * ADR-0005), and (c) `data-btx-split` on <html>, which scopes
 * src/content/page-split.css. Pairing is by id and re-derived on every
 * layout, so late renders and re-renders of the article re-pair themselves.
 * Layout reruns on resize of the article or of the page (panel collapse,
 * resize, the site's font-size slider), on mutations inside the article, and
 * re-mounts when the site replaces the article.
 *
 * IIFE -> __BTX.pageSplit (ADR-0002); the pure core is also module.exports
 * (tools/validate-page-split.js).
 */
(function (root) {
  'use strict';

  // ---- Pure core --------------------------------------------------------------

  const GAP_PX = 28; // between the two columns
  const MIN_COLUMN_PX = 300; // narrower than this (about six words a line), columns read worse than interlinear
  const MAX_SECTION_PX = 1240; // how wide the split column may grow
  const INTERLINEAR_GAP_PX = 10; // between an English element and its translation below

  // Whether the page should be split right now.
  function wantsSplit({ visible, mode, row, layout }) {
    return visible === true && mode === 'translation' && !!row && row.provider === 'church'
      && (layout === 'columns' || layout === 'interlinear');
  }

  // The widest centred column that fits the visible reading area [left, right]
  // around `center`, capped at `max`.
  function fitWidth({ center, left, right, max }) {
    const half = Math.min(center - left, right - center);
    return Math.max(0, Math.min(max, Math.floor(2 * half - 24)));
  }

  // Columns only when each side gets a readable measure; `textWidth` is the
  // article's width with the column fitted.
  function effectiveLayout(layout, textWidth) {
    if (layout !== 'columns') return 'interlinear';
    return (textWidth - GAP_PX) / 2 >= MIN_COLUMN_PX ? 'columns' : 'interlinear';
  }

  function cssId(id) {
    return `article#main [id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
  }

  // Which translated blocks ride with which pair. `ids` in the translation's
  // order; `paired(id)` says whether the page has that element. Each unpaired
  // block joins the tail of the pair before it (leading ones, the first pair);
  // with no pair at all there is nothing to hang anything on.
  function groupRows(ids, paired) {
    const rows = [];
    const lead = [];
    for (const id of ids) {
      if (paired(id)) rows.push({ id, tail: rows.length ? [] : lead.splice(0) });
      else if (rows.length) rows[rows.length - 1].tail.push(id);
      else lead.push(id);
    }
    return rows;
  }

  // The per-id rules that give each pair its room. `rows` are measured with
  // only the measuring rules applied: { id, eng, tr, mb } — English height,
  // translation height (tail included), English margin-bottom, all px. With
  // `measure`, only what has to hold while measuring: the columns' width.
  function rowRules(rows, layout, measure) {
    const out = [];
    for (const r of rows) {
      if (layout === 'columns') {
        const room = !measure && r.tr > r.eng ? ` min-height: ${Math.ceil(r.tr)}px !important;` : '';
        out.push(`html[data-btx-split="columns"] ${cssId(r.id)} { width: calc(50% - ${GAP_PX / 2}px) !important; box-sizing: border-box !important;${room} }`);
      } else if (!measure) {
        out.push(`html[data-btx-split="interlinear"] ${cssId(r.id)} { margin-bottom: ${Math.ceil(r.mb + r.tr + INTERLINEAR_GAP_PX)}px !important; }`);
      }
    }
    return out.join('\n');
  }

  const CORE = { GAP_PX, MIN_COLUMN_PX, MAX_SECTION_PX, TAIL_GAP_PX: 8, wantsSplit, fitWidth, effectiveLayout, groupRows, rowRules, cssId };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- DOM shell --------------------------------------------------------------

  const SAN = () => root.__BTX.sanitize;
  const DIR = (bcp47) => root.__BTX.churchText.dirOf(bcp47);
  const ATTR = 'data-btx-split';
  const TYPO = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing',
    'textTransform', 'textAlign', 'textIndent', 'fontVariant'];
  const WATCH_MS = 400;

  // { key, chapter, layout, uri, effective, article, layer, items: [{id,node}],
  //   fitStyle, rowStyle, ro, mo, watch, raf }
  let s = null;

  function currentKey() { return s ? s.key : null; }

  function show(opts) {
    if (s && s.key === opts.key) return;
    hide();
    s = Object.assign({}, opts, { effective: null, article: null, items: [] });
    s.watch = setInterval(watch, WATCH_MS);
    watch();
  }

  function hide() {
    if (!s) return;
    clearInterval(s.watch);
    if (s.raf) cancelAnimationFrame(s.raf);
    unmount();
    s = null;
  }

  // Mount once the site shows our chapter; re-mount if it swaps the article.
  function watch() {
    if (!s) return;
    if (s.article && document.contains(s.article) && document.contains(s.layer)) return;
    const article = document.getElementById('main');
    if (s.article) unmount();
    if (article && article.getAttribute('data-uri') === s.uri) mount(article);
  }

  function mount(article) {
    s.article = article;
    s.fitStyle = style();
    s.rowStyle = style();
    s.layer = document.createElement('div');
    s.layer.className = 'btx-split-layer';
    s.layer.style.setProperty('--btx-split-gap', `${GAP_PX}px`);
    const lang = s.chapter.bcp47 || '';
    for (const block of s.chapter.blocks) {
      if (!block.id) continue;
      const node = document.createElement('div');
      node.className = 'btx-split-item';
      node.setAttribute('data-btx-for', block.id); // the English element it pairs with
      if (lang) node.lang = lang;
      if (DIR(lang)) node.dir = DIR(lang);
      node.appendChild(SAN().renderBlocks([block]));
      s.layer.appendChild(node);
      s.items.push({ id: block.id, node });
    }
    article.appendChild(s.layer);
    s.ro = new ResizeObserver(schedule);
    s.ro.observe(article);
    s.ro.observe(document.documentElement);
    s.mo = new MutationObserver((records) => {
      if (records.some((r) => !s.layer.contains(r.target))) schedule();
    });
    s.mo.observe(article, { childList: true, subtree: true, characterData: true });
    refresh();
  }

  function unmount() {
    if (s.ro) s.ro.disconnect();
    if (s.mo) s.mo.disconnect();
    for (const n of [s.layer, s.fitStyle, s.rowStyle]) if (n) n.remove();
    document.documentElement.removeAttribute(ATTR);
    Object.assign(s, { article: null, layer: null, fitStyle: null, rowStyle: null, ro: null, mo: null, items: [], effective: null });
  }

  function style() {
    const el = document.createElement('style');
    el.setAttribute('data-btx-split-style', '');
    document.head.appendChild(el);
    return el;
  }

  function schedule() {
    if (!s || s.raf) return;
    s.raf = requestAnimationFrame(() => { s.raf = null; refresh(); });
  }

  function refresh() {
    if (!s || !s.article) return;
    fit();
    layout();
  }

  // Where the site's reading area is visible: right of its left-hand
  // navigation (when open), left of the panel's page reserve.
  function readingArea(section) {
    const html = document.documentElement;
    const right = html.clientWidth - (parseFloat(getComputedStyle(html).marginRight) || 0);
    let left = 0;
    for (let n = document.elementFromPoint(4, innerHeight / 2); n && n !== document.body; n = n.parentElement) {
      if (n.contains(section)) break;
      const r = n.getBoundingClientRect();
      if (r.left <= 4 && r.right < right / 2) left = Math.max(left, r.right);
    }
    return { left, right };
  }

  // Decide columns vs interlinear for the room there is, and size the column.
  function fit() {
    const section = document.getElementById('content');
    let effective = 'interlinear';
    let css = '';
    if (s.layout === 'columns' && section) {
      const r = section.getBoundingClientRect(); // centred either way, so its width doesn't matter
      const cs = getComputedStyle(section);
      const pad = 40 + (parseFloat(cs.paddingRight) || 0);
      const width = fitWidth({ center: r.left + r.width / 2, ...readingArea(section), max: MAX_SECTION_PX });
      effective = effectiveLayout('columns', width - pad);
      if (effective === 'columns') {
        css = `html[${ATTR}="columns"] section#content { max-width: ${width}px !important; padding-left: 40px !important; }`;
      }
    }
    if (s.fitStyle.textContent !== css) s.fitStyle.textContent = css;
    if (effective !== s.effective) {
      s.effective = effective;
      document.documentElement.setAttribute(ATTR, effective);
    }
  }

  // Pair, measure, make room, place. Measured under the measuring rules only,
  // so a pair can shrink as well as grow; written back in the same frame, so a
  // pass that changes nothing resizes nothing and the observers stay quiet.
  function layout() {
    const article = s.article;
    const byId = new Map(s.items.map((it) => [it.id, it]));
    const partnerOf = (id) => {
      const el = document.getElementById(id);
      return el && article.contains(el) && !s.layer.contains(el) ? el : null;
    };
    const rows = groupRows(s.items.map((it) => it.id), (id) => !!partnerOf(id));
    const shown = new Set();
    for (const row of rows) {
      row.partner = partnerOf(row.id);
      row.nodes = [row.id].concat(row.tail).map((id) => byId.get(id).node);
      const cs = getComputedStyle(row.partner);
      const vn = row.partner.querySelector('.verse-number');
      const vcs = vn && getComputedStyle(vn);
      for (const node of row.nodes) {
        shown.add(node);
        for (const k of TYPO) node.style[k] = cs[k];
        if (vcs) for (const n of node.querySelectorAll('.btx-vnum')) { n.style.fontWeight = vcs.fontWeight; n.style.fontSize = vcs.fontSize; }
      }
    }
    for (const it of s.items) it.node.hidden = !shown.has(it.node);

    s.rowStyle.textContent = rowRules(rows, s.effective, true);
    const measured = rows.map((row) => ({
      id: row.id,
      eng: row.partner.getBoundingClientRect().height,
      tr: row.nodes.reduce((h, n, i) => h + n.getBoundingClientRect().height + (i ? CORE.TAIL_GAP_PX : 0), 0),
      mb: parseFloat(getComputedStyle(row.partner).marginBottom) || 0,
    }));
    s.rowStyle.textContent = rowRules(measured, s.effective, false);

    const top = article.getBoundingClientRect().top;
    for (const row of rows) {
      const r = row.partner.getBoundingClientRect();
      let y = s.effective === 'columns' ? r.top - top : r.bottom - top + 4;
      for (const node of row.nodes) {
        node.style.top = `${Math.round(y)}px`;
        y += node.getBoundingClientRect().height + CORE.TAIL_GAP_PX;
      }
    }
  }

  root.__BTX = Object.assign(root.__BTX || {}, {
    pageSplit: Object.assign({}, CORE, { show, hide, currentKey }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
