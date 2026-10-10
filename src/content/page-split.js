/*
 * The reading layer: the extension's only write into the site's reader
 * (ADR-0007). It does two things:
 *   - the fit: while the panel is open, the site's reading column fits the
 *     visible reading area, in every mode, split or not (fitColumn, #89);
 *   - the page split: a Church-language chapter set into that column, paired
 *     verse by verse with the English it translates, while the panel's
 *     arrangement names a page's language — in either mode (wantsSplit has
 *     no mode input: the split stays on the page in Citations).
 *
 * Interface:
 *   start()                start the fit, once (content.js's init). From then
 *                          on a page-reserve change (the panel opening,
 *                          collapsing, resizing, hiding) refits at once, and a
 *                          polled watch refits when the site moves the column.
 *                          The fit's rule exists only while the site's own
 *                          column would be clipped: none with the panel
 *                          collapsed or narrow enough.
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
 *   hide({ anchor })       remove every trace of the split: layer, its CSS,
 *                          the <html> attribute; the column is fitted again
 *                          without it in the same reflow. `anchor` (optional)
 *                          as for show. An anchor is kept by scrolling the
 *                          page by its shift (keepAt)
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
 *                site's footnote panel starts, when it is open; it starts
 *                right of the site's navigation drawer, when docked. Both
 *                edges read the site's state only, never the layout the
 *                module applied last (readingEdges, #97).
 *   interlinear  the column keeps the fit's box; each translation sits under
 *                its English element, which gets room as extra margin-bottom.
 *
 * The fit (fitColumn, fitRule): with no split, or interlinear, a column whose
 * text runs past the visible reading area (under the docked drawer, under the
 * panel) is placed inside it: the site's padding stays, holding the
 * annotation toolbar and media icons in its gutters, until the text would be
 * under MIN_COLUMN_PX, then down to the gutter the site's chapter arrows need
 * (arrowGutter: sticky controls just inside the area's edges, found by
 * probing, no class names). The column is measured with the fit's rule switched
 * off, so the rule never feeds its own input. Below about 1200px the site's
 * drawer is a modal over a scrim spanning the page: nothing is docked then.
 *
 * Mechanism (why it looks indirect): the site's reader is React's, so the
 * split never edits the site's nodes. Everything it adds is (a) one layer
 * appended to article#main holding the translated blocks, absolutely placed
 * at their partners' offsets, (b) <style> elements whose rules select the
 * site's elements by id (p5, title_number1 — the same in every language,
 * ADR-0005; the fit's rule selects section#content), and (c)
 * `data-btx-split` on <html>, set only while a split is mounted, which scopes
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
  // The least padding a column narrowed into the reading area keeps each side (#89).
  const FIT_PAD_PX = 16;
  // The text a fitted column keeps at least, whatever the chapter arrows' gutter
  // would take (about four words a line): the gutter gives way below this.
  const MIN_TEXT_PX = 220;
  // A control within ARROW_EDGE_PX of the reading area's edge is a chapter
  // arrow (they sit 8px in); ARROW_BREATH_PX is the gap kept past it.
  const ARROW_EDGE_PX = 24;
  const ARROW_BREATH_PX = 8;

  // Whether the page should be split right now: `row` is the page's language
  // (the panel's arrangement answers it, in either mode), `visible` whether
  // the chapter shows at all.
  function wantsSplit({ visible, row, layout }) {
    return visible === true && !!row && row.provider === 'church'
      && (layout === 'columns' || layout === 'interlinear');
  }

  // The room the site's ‹ › chapter arrows take beside the text (#102 C3).
  // They hang sticky just inside the visible reading area's edges (8px in,
  // 40px wide: a column fitted to the area would put verse text under them).
  // `arrows` are their rects, { left, right } px, as the shell found them;
  // `area` is { left, right }. -> the px each side of the area to keep clear:
  // the wider side's reach plus a breathing gap, the same on both sides so the
  // column does not shift from chapter to chapter (the first and last
  // chapters have one arrow). 0 with no arrow (a narrow window shows none).
  function arrowGutter(area, arrows) {
    let reach = 0;
    for (const a of Array.isArray(arrows) ? arrows : []) {
      if (a.left - area.left <= ARROW_EDGE_PX) reach = Math.max(reach, a.right - area.left);
      else if (area.right - a.right <= ARROW_EDGE_PX) reach = Math.max(reach, area.right - a.left);
    }
    return reach > 0 ? Math.ceil(reach) + ARROW_BREATH_PX : 0;
  }

  // The right edge of the visible reading area in a `width`-wide page: the
  // panel's page reserve when it is open, else short of the site's floating
  // buttons.
  function readingRight({ width, reserve }) {
    return reserve > 0 ? width - reserve : width - FLOAT_GUTTER_PX;
  }

  // Where the visible reading area starts and ends in a `width`-wide page with
  // the panel's page `reserve`: right of what is docked at the left edge (the
  // site's navigation drawer), left of what is docked at the right one (its
  // footnote panel), and never past readingRight. Each stack is what lies
  // under a probe just inside that edge, topmost first (elementsFromPoint),
  // as { left, right, inColumn, holdsColumn, ours }. The probe stops at what
  // holds the reading column or is the panel (`ours`), and skips what sits
  // inside the reading column: that moves with the layout the module applies
  // (the site's annotation toolbar hangs left of the text), and counting it
  // made the decision feed back on itself (#97). Docked means touching the
  // edge and not spanning the area. A box that spans it (the scrim under the
  // site's modal drawer, below about 1200px) means the page is under a modal
  // and is not laid out around anything: nothing on that side is docked.
  //   -> { left, right }
  function readingEdges({ width, reserve, leftStack, rightStack }) {
    const edge = readingRight({ width, reserve });
    // The boxes docked at one edge, or none when a box spans the area.
    const docked = (stack, touches) => {
      const out = [];
      for (const n of stack) {
        if (n.holdsColumn || n.ours) break;
        if (n.inColumn) continue;
        if (n.left <= 4 && n.right >= edge - 4) return [];
        if (touches(n)) out.push(n);
      }
      return out;
    };
    const left = docked(leftStack, (r) => r.left <= 4).reduce((x, r) => Math.max(x, r.right), 0);
    const right = docked(rightStack, (r) => r.right >= edge - 4).reduce((x, r) => Math.min(x, r.left), edge);
    return { left, right };
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

  // The fit rule (#89): where the site's reading column goes in the visible
  // reading area [area.left, area.right] (readingEdges). `column` is
  // section#content as the site lays it out, with none of this module's
  // rules applied: { left, right, padLeft, padRight }, px. `layout` is the
  // split's ('columns' | 'interlinear') or null with no split; `width` and
  // `reserve` the page's width and the panel's page reserve.
  //   - Side by side: the column widens around its own centre to the area
  //     (fitWidth), while two columns fit (effectiveLayout).
  //   - Otherwise, with the panel open: a column whose text runs past the
  //     area (under the docked drawer, under the panel) narrows to the area.
  //     The text narrows; the site's padding stays (its gutters hold the
  //     annotation toolbar and the media icons) until the text would be
  //     under MIN_COLUMN_PX, then gives way down to the chapter arrows'
  //     `gutter` (arrowGutter, px each side; 0 when none) and no further,
  //     unless the text would then be under MIN_TEXT_PX: the gutter gives way
  //     down to FIT_PAD_PX a side. Text under the arrows, even inside the
  //     area, is a box too: it is moved clear of them (#102 C3).
  //   - Otherwise no box: the site's own layout, untouched. With the panel
  //     collapsed the site lays the column out for the window itself.
  //   -> { effective, collapseFits, box }  `effective` is the split's layout
  //      actually shown (null with no split); `box` { left, width, padLeft,
  //      padRight } in px, or null
  function fitColumn({ layout, area, column, width, reserve, gutter }) {
    const split = layout === 'columns' || layout === 'interlinear';
    const center = (column.left + column.right) / 2;
    const pad = 40 + column.padRight; // the columns' padding: 40px left, the site's own right
    let effective = split ? 'interlinear' : null;
    let roomier = false;
    if (layout === 'columns') {
      const w = fitWidth({ center, left: area.left, right: area.right, max: MAX_SECTION_PX });
      effective = effectiveLayout('columns', w - pad);
      roomier = collapseFits({ center, left: area.left, width, reserve, pad, max: MAX_SECTION_PX });
      if (effective === 'columns') {
        return { effective, collapseFits: roomier, box: { left: Math.round(center - w / 2), width: w, padLeft: 40, padRight: column.padRight } };
      }
    }
    const gut = Math.max(0, gutter || 0);
    const fits = column.left + column.padLeft >= area.left + gut && column.right - column.padRight <= area.right - gut;
    if (!(reserve > 0) || fits) return { effective, collapseFits: roomier, box: null };
    const left = Math.ceil(Math.max(column.left, area.left));
    const w = Math.max(0, Math.floor(Math.min(column.right, area.right)) - left);
    // The least padding a side keeps: the arrows' gutter, unless that would
    // leave under MIN_TEXT_PX of text; never under FIT_PAD_PX.
    const floor = Math.max(FIT_PAD_PX, Math.min(gut, Math.floor((w - MIN_TEXT_PX) / 2)));
    const give = Math.max(floor, Math.floor((w - MIN_COLUMN_PX) / 2));
    const padOf = (site) => Math.min(gut > 0 ? Math.max(site, floor) : site, give);
    return {
      effective,
      collapseFits: roomier,
      box: { left, width: w, padLeft: padOf(column.padLeft), padRight: padOf(column.padRight) },
    };
  }

  // The rule placing fitColumn's box. `container` is the left edge of the
  // column's container (the column's left less its own left margin): the
  // column is placed from there, whatever the site's margins were, since the
  // site's grid can hold it wider than the page. margin-right: auto keeps the
  // placement in a right-to-left page too. '' for no box.
  function fitRule(box, container) {
    if (!box) return '';
    const px = (n) => `${Math.round(n * 100) / 100}px`;
    return `section#content { box-sizing: border-box !important; width: ${px(box.width)} !important; min-width: 0 !important; max-width: none !important; `
      + `margin-left: ${px(box.left - container)} !important; margin-right: auto !important; `
      + `padding-left: ${px(box.padLeft)} !important; padding-right: ${px(box.padRight)} !important; }`;
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
  // { left, width } of section#content and the reading area's `areaLeft`,
  // `areaRight` and the chapter arrows' `gutter`, in px; null (never fitted) always differs.
  function moved(prev, next) {
    if (!prev || !next) return prev !== next;
    return ['left', 'width', 'areaLeft', 'areaRight', 'gutter'].some((k) => Math.abs((Number(prev[k]) || 0) - (Number(next[k]) || 0)) > 1);
  }

  const CORE = {
    GAP_PX, MIN_COLUMN_PX, MAX_SECTION_PX, FLOAT_GUTTER_PX, FIT_PAD_PX, TAIL_GAP_PX: 8,
    MIN_TEXT_PX, wantsSplit, readingRight, readingEdges, arrowGutter, collapseFits, fitWidth, effectiveLayout, fitColumn, fitRule, groupRows, soloIds, rowRules, cssId, moved,
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

  // The split: { key, chapter, layout, uri, anchor, effective, article,
  //   layer, items: [{id,node}], rowStyle, ro, mo, watch }
  let s = null;

  // The reading layer's fit, split or not (#89): the <style> holding
  // fitRule's rule (present only while it holds one), where the column sat
  // after the last fit (geometry), the pending frame, and whether start() ran.
  let fitStyle = null;
  let geo = null;
  let raf = 0;
  let started = false;

  // From here on the reading column fits the open space while the panel is
  // open (fitColumn), split or not: a page-reserve change (the panel opening,
  // collapsing, resizing, hiding) refits at once, and the watch refits when
  // the site moves the column. Idempotent.
  function start() {
    if (started) return;
    started = true;
    new ResizeObserver(schedule).observe(document.documentElement);
    setInterval(tick, WATCH_MS);
    schedule();
  }

  // The fit's watch while no split is mounted (the split's watch covers it
  // then). Idle with no rule applied and no page reserve: nothing to fit, and
  // the reserve coming back resizes <html>, which the observer sees.
  function tick() {
    if (s) return;
    if (!fitStyle && !(parseFloat(getComputedStyle(document.documentElement).marginRight) > 0)) return;
    if (moved(geo, geometry())) schedule();
  }

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
  // was on would otherwise move off. The column is fitted again without the
  // split in the same reflow: with the panel collapsed or narrow enough, that
  // leaves no rule at all.
  function hide(opts) {
    if (!s) return;
    const anchor = opts && opts.anchor;
    const keep = topIn(s.article, anchor);
    clearInterval(s.watch);
    unmount();
    s = null;
    refresh();
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
      if (moved(geo, geometry())) schedule();
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
    return { left: r.left, width: r.width, areaLeft: area.left, areaRight: area.right, gutter: area.gutter };
  }

  // The first mount keeps show's `anchor` where it was; a re-mount is the
  // site's new article, with nothing of the old one to keep.
  function mount(article) {
    const anchor = s.anchor;
    s.anchor = null;
    const keep = topIn(article, anchor);
    s.article = article;
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
    for (const n of [s.layer, s.rowStyle]) if (n) n.remove();
    document.documentElement.removeAttribute(ATTR);
    Object.assign(s, { article: null, layer: null, rowStyle: null, ro: null, mo: null, items: [], effective: null, collapseFits: false });
  }

  function style() {
    const el = document.createElement('style');
    el.setAttribute('data-btx-split-style', '');
    document.head.appendChild(el);
    return el;
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; refresh(); });
  }

  // Fit the column, then lay the split out in it, if one is mounted.
  function refresh() {
    fit();
    if (s && s.article) layout();
    geo = geometry(); // after our own writes, so the watch sees only the site's moves
  }

  // Where the site's reading area is visible (readingEdges), probed just
  // inside each edge, halfway down. fit() and the watch's geometry() both read
  // it, so they agree on what moved.
  //   -> { left, right, width (the page's), reserve (the panel's) }
  function readingArea(section) {
    const html = document.documentElement;
    const width = html.clientWidth;
    const reserve = parseFloat(getComputedStyle(html).marginRight) || 0;
    const stack = (x) => document.elementsFromPoint(x, innerHeight / 2).map((n) => {
      const r = n.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        inColumn: n !== section && section.contains(n),
        holdsColumn: n.contains(section),
        ours: !!n.closest('#btx-root'),
      };
    });
    const edge = readingRight({ width, reserve });
    const { left, right } = readingEdges({ width, reserve, leftStack: stack(4), rightStack: stack(edge - 4) });
    return { left, right, width, reserve, gutter: arrowGutter({ left, right }, chapterArrows(section, left, right)) };
  }

  // The site's chapter arrows: the controls sticky at mid-height just inside
  // the reading area's edges (the same hook-free probe as the edges: what
  // sits at the arrow's centre, 28px in), outside the reading column and the
  // panel. -> [{ left, right }]
  function chapterArrows(section, left, right) {
    const out = [];
    for (const x of [left + 28, right - 28]) {
      for (const n of document.elementsFromPoint(x, innerHeight / 2)) {
        if (n.closest('#btx-root') || section.contains(n) || n.contains(section)) continue;
        const control = n.closest('a, button');
        if (control && /^(sticky|fixed)$/.test(getComputedStyle(control).position)) {
          const r = control.getBoundingClientRect();
          out.push({ left: r.left, right: r.right });
        }
        break;
      }
    }
    return out;
  }

  // Fit the reading column to the visible reading area (fitColumn), and with
  // a split mounted decide columns vs interlinear for the room there is. The
  // column is measured with the fit's own rule switched off, so the rule
  // never feeds back into its own input (#97); it is switched back on in the
  // same frame, so a fit that changes nothing resizes nothing.
  function fit() {
    const split = s && s.article ? s : null;
    const section = document.getElementById('content');
    let res = { effective: split ? 'interlinear' : null, collapseFits: false, box: null };
    let css = '';
    if (section) {
      if (fitStyle) fitStyle.disabled = true;
      const r = section.getBoundingClientRect();
      const cs = getComputedStyle(section);
      const column = { left: r.left, right: r.right, padLeft: parseFloat(cs.paddingLeft) || 0, padRight: parseFloat(cs.paddingRight) || 0 };
      const area = readingArea(section);
      res = fitColumn({ layout: split ? split.layout : null, area, column, width: area.width, reserve: area.reserve, gutter: area.gutter });
      css = fitRule(res.box, r.left - (parseFloat(cs.marginLeft) || 0));
      if (fitStyle) fitStyle.disabled = false;
    }
    if (css && !fitStyle) fitStyle = style();
    if (fitStyle && !css) { fitStyle.remove(); fitStyle = null; }
    if (fitStyle && fitStyle.textContent !== css) fitStyle.textContent = css;
    if (!split) return;
    const { effective, collapseFits: roomier } = res;
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
    pageSplit: Object.assign({}, CORE, { start, show, hide, currentKey, currentLayout }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
