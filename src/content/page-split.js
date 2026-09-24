/*
 * Page split: a Church-language chapter set into the site's own reading
 * column, paired verse by verse with the English it translates — the
 * extension's only write into the site's reader (ADR-0007).
 *
 * Interface:
 *   show({ key, chapter, layout, uri, onLayout, anchor })  split the page.
 *                          `chapter` is a __BTX.churchText load result (blocks
 *                          carry ids), `layout` 'columns' | 'interlinear',
 *                          `uri` the chapter's /scriptures/… path. Same key as
 *                          the split showing: nothing happens. Waits, as long
 *                          as it takes, for the site to render that chapter
 *                          (article#main[data-uri] === uri) — the site swaps
 *                          the whole article on navigation. `anchor`
 *                          (optional) is a chapter element kept at the same
 *                          place on screen through the first mount's reflow,
 *                          and through taking a split with another key away
 *                          `onLayout({ effective, collapseFits })` fires when
 *                          either changes — on mount, and when a resize or the
 *                          panel moves the room: `effective` is the layout
 *                          actually on the page ('columns' | 'interlinear'),
 *                          `collapseFits` whether collapsing the open panel
 *                          would give columns room (collapseFits, pure).
 *   hide({ anchor })       remove every trace: layer, CSS, <html> attribute.
 *                          `anchor` (optional) as for show. An anchor is kept
 *                          by scrolling the page by its shift (keepAt)
 *   currentKey()           the key showing (or waiting to show), else null
 *   currentLayout()        { effective, collapseFits } now, else null (not
 *                          mounted yet)
 *
 * Two layouts (the `churchLanguageLayout` setting; 'panel' never gets here):
 *   columns      the reading column widens to the visible reading area and
 *                splits: English left, translation right. Each pair starts on
 *                one row; the shorter side leaves open space under it (the
 *                English element gets the translation's height as min-height
 *                when the translation runs longer). A translated block with no
 *                English partner (French numbers Psalm superscriptions as
 *                verses) rides under the pair before it rather than vanishing;
 *                an English block with no translated partner (Japanese and
 *                Korean Bible chapters have no chapter summary) keeps to the
 *                English column, open space beside it. English blocks are
 *                found by the translation's own rule (churchText.blockElements).
 *                Falls back to interlinear while two columns wouldn't each get
 *                MIN_COLUMN_PX of text. The visible reading area ends at the
 *                panel's page reserve, or FLOAT_GUTTER_PX short of the window
 *                edge with the panel collapsed (readingRight), or where the
 *                site's footnote panel starts, when it is open.
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
 * when the site moves the reading column without resizing either (its
 * footnote panel or navigation drawer opening or closing: `moved`, polled);
 * it re-mounts when the site replaces the article.
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
  // The site floats buttons over the reading area's right edge (the audio
  // player's round button). The panel covers them while it is open; with the
  // panel collapsed the columns would run under them, so they keep this clear.
  const FLOAT_GUTTER_PX = 72;

  // Whether the page should be split right now.
  function wantsSplit({ visible, mode, row, layout }) {
    return visible === true && mode === 'translation' && !!row && row.provider === 'church'
      && (layout === 'columns' || layout === 'interlinear');
  }

  // The right edge of the visible reading area in a `width`-wide page: the
  // panel's page reserve when it is open, else short of the site's floating
  // buttons.
  function readingRight({ width, reserve }) {
    return reserve > 0 ? width - reserve : width - FLOAT_GUTTER_PX;
  }

  // Would the panel's collapse make room for columns? Collapsing hands its page
  // reserve back, so the reading area runs to readingRight's collapsed edge and
  // the column re-centres by half the reserve. `pad` is the section's own
  // horizontal padding. False with no reserve: there is nothing to hand back.
  function collapseFits({ center, left, width, reserve, pad, max }) {
    if (!(reserve > 0)) return false;
    const right = readingRight({ width, reserve: 0 });
    return effectiveLayout('columns', fitWidth({ center: center + reserve / 2, left, right, max }) - pad) === 'columns';
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

  // English blocks with no pair (groupRows' row ids), in page order: Japanese
  // Daniel 1 has no chapter summary, so `study_summary1` is solo there.
  function soloIds(englishIds, pairedIds) {
    const paired = new Set(pairedIds);
    return englishIds.filter((id) => id && !paired.has(id));
  }

  // The per-id rules that give each pair its room. `rows` are measured with
  // only the measuring rules applied: { id, eng, tr, mb } — English height,
  // translation height (tail included), English margin-bottom, all px. With
  // `measure`, only what has to hold while measuring: the columns' width.
  // `solo` (soloIds) keep to the English column in columns, like every pair;
  // interlinear leaves them alone.
  function rowRules(rows, layout, measure, solo = []) {
    const out = [];
    const column = `width: calc(50% - ${GAP_PX / 2}px) !important; box-sizing: border-box !important;`;
    for (const r of rows) {
      if (layout === 'columns') {
        const room = !measure && r.tr > r.eng ? ` min-height: ${Math.ceil(r.tr)}px !important;` : '';
        out.push(`html[data-btx-split="columns"] ${cssId(r.id)} { ${column}${room} }`);
      } else if (!measure) {
        out.push(`html[data-btx-split="interlinear"] ${cssId(r.id)} { margin-bottom: ${Math.ceil(r.mb + r.tr + INTERLINEAR_GAP_PX)}px !important; }`);
      }
    }
    if (layout === 'columns') for (const id of solo) out.push(`html[data-btx-split="columns"] ${cssId(id)} { ${column} }`);
    return out.join('\n');
  }

  // Has the reading column moved since the last fit? The site moves it
  // without resizing anything the observers watch — opening a footnote slides
  // it left, closing the navigation drawer widens the room beside it — so the
  // watch compares where it was fitted with where it is now. `geo` is
  // { left, width } of section#content and the reading area's `areaLeft` and
  // `areaRight`, in px; null (never fitted) always differs.
  function moved(prev, next) {
    if (!prev || !next) return prev !== next;
    return ['left', 'width', 'areaLeft', 'areaRight'].some((k) => Math.abs((Number(prev[k]) || 0) - (Number(next[k]) || 0)) > 1);
  }

  const CORE = {
    GAP_PX, MIN_COLUMN_PX, MAX_SECTION_PX, FLOAT_GUTTER_PX, TAIL_GAP_PX: 8,
    wantsSplit, readingRight, collapseFits, fitWidth, effectiveLayout, groupRows, soloIds, rowRules, cssId, moved,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- DOM shell --------------------------------------------------------------

  const SAN = () => root.__BTX.sanitize;
  const DIR = (bcp47) => root.__BTX.churchText.dirOf(bcp47);
  const BLOCKS = (node) => root.__BTX.churchText.blockElements(node);
  const ATTR = 'data-btx-split';
  const TYPO = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight', 'letterSpacing',
    'textTransform', 'textAlign', 'textIndent', 'fontVariant'];
  const WATCH_MS = 400;

  // { key, chapter, layout, uri, anchor, effective, article, layer,
  //   items: [{id,node}], fitStyle, rowStyle, ro, mo, watch, raf, geo }
  let s = null;

  function currentKey() { return s ? s.key : null; }
  function currentLayout() { return s && s.effective ? { effective: s.effective, collapseFits: s.collapseFits } : null; }

  function show(opts) {
    if (s && s.key === opts.key) return;
    hide({ anchor: opts.anchor });
    s = Object.assign({}, opts, { effective: null, collapseFits: false, article: null, items: [] });
    s.watch = setInterval(watch, WATCH_MS);
    watch();
  }

  // `anchor`: an element of the chapter to keep at the same place on screen —
  // taking the split away reflows the whole column, and the verse the reader
  // was on would otherwise move off.
  function hide(opts) {
    if (!s) return;
    const anchor = opts && opts.anchor;
    const keep = topIn(s.article, anchor);
    clearInterval(s.watch);
    if (s.raf) cancelAnimationFrame(s.raf);
    unmount();
    s = null;
    keepAt(anchor, keep);
  }

  // Where `anchor` sits on screen now, if it is an element of `article`, else
  // null; keepAt puts it back there after a reflow by scrolling the page.
  function topIn(article, anchor) {
    return anchor && article && article.contains(anchor) ? anchor.getBoundingClientRect().top : null;
  }

  function keepAt(anchor, top) {
    if (top === null || !anchor.isConnected) return;
    const shift = anchor.getBoundingClientRect().top - top;
    if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: 'instant' });
  }

  // Mount once the site shows our chapter; re-mount if it swaps the article;
  // refit when the site moves the reading column (moved).
  function watch() {
    if (!s) return;
    if (s.article && document.contains(s.article) && document.contains(s.layer)) {
      if (moved(s.geo, geometry())) schedule();
      return;
    }
    const article = document.getElementById('main');
    if (s.article) unmount();
    if (article && article.getAttribute('data-uri') === s.uri) mount(article);
  }

  // Where the reading column sits now: see moved.
  function geometry() {
    const section = document.getElementById('content');
    if (!section) return null;
    const r = section.getBoundingClientRect();
    const area = readingArea(section);
    return { left: r.left, width: r.width, areaLeft: area.left, areaRight: area.right };
  }

  // The first mount keeps show's `anchor` where it was; a re-mount is the
  // site's new article, with nothing of the old one to keep.
  function mount(article) {
    const anchor = s.anchor;
    s.anchor = null;
    const keep = topIn(article, anchor);
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
    keepAt(anchor, keep);
  }

  function unmount() {
    if (s.ro) s.ro.disconnect();
    if (s.mo) s.mo.disconnect();
    for (const n of [s.layer, s.fitStyle, s.rowStyle]) if (n) n.remove();
    document.documentElement.removeAttribute(ATTR);
    Object.assign(s, { article: null, layer: null, fitStyle: null, rowStyle: null, ro: null, mo: null, items: [], effective: null, collapseFits: false, geo: null });
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
    s.geo = geometry(); // after our own writes, so the watch sees only the site's moves
  }

  // Where the site's reading area is visible: right of its left-hand
  // navigation (when open), left of its right-hand footnote panel (when open)
  // and of the panel's page reserve. Each side is found by probing just
  // inside that edge, halfway down, for something docked there that doesn't
  // hold the reading column.
  //   -> { left, right, width (the page's), reserve (the panel's) }
  function readingArea(section) {
    const html = document.documentElement;
    const width = html.clientWidth;
    const reserve = parseFloat(getComputedStyle(html).marginRight) || 0;
    let right = readingRight({ width, reserve });
    const edge = right;
    let left = 0;
    const docked = (x, test) => {
      for (let n = document.elementFromPoint(x, innerHeight / 2); n && n !== document.body; n = n.parentElement) {
        if (n.contains(section) || n.closest('#btx-root')) break;
        test(n.getBoundingClientRect());
      }
    };
    docked(4, (r) => { if (r.left <= 4 && r.right < edge / 2) left = Math.max(left, r.right); });
    docked(edge - 4, (r) => { if (r.right >= edge - 4 && r.left > edge / 2) right = Math.min(right, r.left); });
    return { left, right, width, reserve };
  }

  // Decide columns vs interlinear for the room there is, and size the column.
  function fit() {
    const section = document.getElementById('content');
    let effective = 'interlinear';
    let roomier = false;
    let css = '';
    if (s.layout === 'columns' && section) {
      const r = section.getBoundingClientRect(); // centred either way, so its width doesn't matter
      const cs = getComputedStyle(section);
      const pad = 40 + (parseFloat(cs.paddingRight) || 0);
      const area = readingArea(section);
      const center = r.left + r.width / 2;
      const width = fitWidth({ center, left: area.left, right: area.right, max: MAX_SECTION_PX });
      effective = effectiveLayout('columns', width - pad);
      roomier = collapseFits({ center, left: area.left, width: area.width, reserve: area.reserve, pad, max: MAX_SECTION_PX });
      if (effective === 'columns') {
        css = `html[${ATTR}="columns"] section#content { max-width: ${width}px !important; padding-left: 40px !important; }`;
      }
    }
    if (s.fitStyle.textContent !== css) s.fitStyle.textContent = css;
    if (effective !== s.effective || roomier !== s.collapseFits) {
      if (effective !== s.effective) document.documentElement.setAttribute(ATTR, effective);
      s.effective = effective;
      s.collapseFits = roomier;
      if (s.onLayout) s.onLayout({ effective, collapseFits: roomier });
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
    const english = BLOCKS(article).filter((el) => !s.layer.contains(el)).map((el) => el.id);
    const solo = soloIds(english, rows.map((row) => row.id));

    s.rowStyle.textContent = rowRules(rows, s.effective, true, solo);
    const measured = rows.map((row) => ({
      id: row.id,
      eng: row.partner.getBoundingClientRect().height,
      tr: row.nodes.reduce((h, n, i) => h + n.getBoundingClientRect().height + (i ? CORE.TAIL_GAP_PX : 0), 0),
      mb: parseFloat(getComputedStyle(row.partner).marginBottom) || 0,
    }));
    s.rowStyle.textContent = rowRules(measured, s.effective, false, solo);

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
    pageSplit: Object.assign({}, CORE, { show, hide, currentKey, currentLayout }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
