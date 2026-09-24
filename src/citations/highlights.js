/*
 * Local highlights in the inline talk reader: select text to mark it, click a
 * mark to remove it. Saved in chrome.storage.local on this machine only
 * (ADR-0004), one list per talk under `btxHl::{talkId}`, and re-applied when
 * the talk is opened again.
 *
 * Interface (__BTX.highlights):
 *   attach(container, talkId, { host, onCreate })
 *       Wire a freshly rendered talk article and re-apply its saved marks.
 *       `host` is the focusable view around the article: it receives the
 *       keyboard-selection keys and holds the action menu, so the menu leaves
 *       the page with its view. onCreate() runs after each new highlight.
 *   dismiss() -> bool    Hide the action menu; true when it was showing (the
 *                        reader's Esc closes the menu before the talk).
 *   hintSeen() -> Promise<bool>   Whether a highlight was ever made on this
 *                        computer; the reader shows its one-line hint until then.
 *   all(), load(talkId)  The stored records.
 *
 * The action menu offers "Highlight" after a mouse-up or a Shift key-up leaves
 * a selection in the article, and "Remove" after a click on a mark (or a
 * selection inside one). Tab from the talk moves into the menu; a scroll of the
 * reader hides it. The menu acts only on an article still on the page.
 *
 * Anchoring: a record names its block — the nearest paragraph, list item,
 * quote or heading around the selection that has an id (the sanitizer keeps
 * ids), else the article's top-level child — by id (blockId) and, for a
 * top-level child, by index (blockIdx); plus char offsets into the block's
 * textContent and the quoted text. Re-apply finds the block (id, else index),
 * checks the text still matches, then re-wraps the offsets in <span.btx-hl>.
 * A quote that moved within its block is followed only when it is distinctive
 * (RELOCATE_MIN characters) and occurs there exactly once; any other mismatch
 * is skipped, never misplaced. So the reader keeps a talk's textContent exactly
 * its source text (see talk-view's render contract).
 *
 * IIFE -> __BTX.highlights.
 */
(function (root) {
  'use strict';

  const KEY = (talkId) => `btxHl::${talkId}`;
  const HINT_KEY = 'btxHlHintSeen';
  // What a record may anchor to, when it carries an id.
  const BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, .btxk-paragraph, .btxk-std';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MENU = {
    select: { label: 'Highlight', icon: ['M12 20h8', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'] },
    remove: { label: 'Remove', icon: ['M18 6L6 18', 'M6 6l12 12'] },
  };

  let activeContainer = null;
  let activeTalkId = null;
  let onCreated = null;
  let menuHost = null;      // the view the current menu lives in
  let menuEl = null;
  let menuBtn = null;
  let menuAction = null;    // what the menu button does while showing
  let menuFromClick = false; // a click on a mark opened it (see onSelectUp)
  let docBound = false;
  let writes = Promise.resolve(); // serialises each read-modify-write of a list

  // ---- storage ----
  function load(talkId) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(KEY(talkId), (d) => resolve((d && d[KEY(talkId)]) || [])); }
      catch (e) { resolve([]); }
    });
  }
  function store(talkId, list) {
    try { chrome.storage.local.set({ [KEY(talkId)]: list }); } catch (e) { /* ignore */ }
  }
  function update(talkId, change) {
    writes = writes.then(async () => store(talkId, change(await load(talkId)))).catch(() => {});
    return writes;
  }

  // All saved highlights across talks (for a future review menu).
  function all() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(null, (d) => {
          const out = [];
          for (const k of Object.keys(d || {})) {
            if (k.indexOf('btxHl::') === 0) out.push({ talkId: k.slice(7), items: d[k] || [] });
          }
          resolve(out);
        });
      } catch (e) { resolve([]); }
    });
  }

  // Without storage there is nothing to learn, so no hint either.
  function hintSeen() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(HINT_KEY, (d) => resolve(!!(d && d[HINT_KEY]))); }
      catch (e) { resolve(true); }
    });
  }
  function markHintSeen() {
    try { chrome.storage.local.set({ [HINT_KEY]: true }); } catch (e) { /* ignore */ }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- offset helpers ----
  // The block a record for `node` anchors to (see the header), or null.
  function blockOf(container, node) {
    const start = node && node.nodeType === 3 ? node.parentNode : node;
    if (!start || !container.contains(start)) return null;
    for (let n = start; n && n !== container; n = n.parentNode) {
      if (n.id && n.matches(BLOCKS)) return n;
    }
    let n = start;
    while (n && n.parentNode !== container) n = n.parentNode;
    return n || null;
  }

  // Character offset of (node, offset) from the start of `block` (text-only).
  function charOffset(block, node, offset) {
    const r = document.createRange();
    r.setStart(block, 0);
    try { r.setEnd(node, offset); } catch (e) { return 0; }
    return r.toString().length;
  }

  // Wrap [start,end) of `block`'s text in a highlight span tagged with hlId.
  function wrapRange(block, start, end, hlId) {
    if (end <= start) return;
    const nodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    let pos = 0;
    for (const tn of nodes) {
      const len = tn.nodeValue.length;
      const ns = pos, ne = pos + len;
      pos = ne;
      const os = Math.max(start, ns);
      const oe = Math.min(end, ne);
      if (oe <= os) continue;
      let target = tn;
      const localStart = os - ns;
      const localLen = oe - os;
      if (localStart > 0) target = target.splitText(localStart);
      if (localLen < target.nodeValue.length) target.splitText(localLen);
      const span = document.createElement('span');
      span.className = 'btx-hl';
      span.setAttribute('data-hl-id', hlId);
      target.parentNode.insertBefore(span, target);
      span.appendChild(target);
    }
  }

  function blockText(block) { return (block && block.textContent) || ''; }

  // Where a quote now sits in its block, when it moved: only a quote long
  // enough to be distinctive that occurs there exactly once; else -1.
  const RELOCATE_MIN = 16;
  function relocate(block, text) {
    if (!text || text.length < RELOCATE_MIN) return -1;
    const t = blockText(block);
    const at = t.indexOf(text);
    return at >= 0 && t.indexOf(text, at + 1) < 0 ? at : -1;
  }

  // Re-apply one stored record into the active container.
  function applyRecord(container, rec) {
    let block = null;
    if (rec.blockId) block = container.querySelector(`[id="${String(rec.blockId).replace(/["\\]/g, '\\$&')}"]`);
    if (!block && rec.blockIdx != null) block = container.children[rec.blockIdx] || null;
    if (!block) return;
    let start = rec.start;
    if (blockText(block).slice(rec.start, rec.end) !== rec.text) {
      // content shifted; try the index fallback, then the quote itself
      const alt = rec.blockIdx != null ? container.children[rec.blockIdx] : null;
      if (alt && blockText(alt).slice(rec.start, rec.end) === rec.text) block = alt;
      else if ((start = relocate(block, rec.text)) < 0) return;
    }
    wrapRange(block, start, start + rec.text.length, rec.id);
  }

  // The current selection, when it lies inside a live article.
  function selectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const c = activeContainer;
    if (!c || !c.isConnected || !c.contains(range.startContainer) || !c.contains(range.endContainer)) return null;
    return range;
  }

  // The selection cut per anchor block: [{ block, start, end }].
  function blockSpans(container, range) {
    const texts = [];
    const common = range.commonAncestorContainer;
    if (common.nodeType === 3) texts.push(common);
    else {
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) if (range.intersectsNode(n)) texts.push(n);
    }
    const spans = new Map();
    for (const tn of texts) {
      const s = tn === range.startContainer ? range.startOffset : 0;
      const e = tn === range.endContainer ? range.endOffset : tn.nodeValue.length;
      const block = e > s && blockOf(container, tn);
      if (!block) continue;
      const bs = charOffset(block, tn, s);
      const be = charOffset(block, tn, e);
      const cur = spans.get(block);
      if (cur) { cur.start = Math.min(cur.start, bs); cur.end = Math.max(cur.end, be); }
      else spans.set(block, { block, start: bs, end: be });
    }
    return Array.from(spans.values());
  }

  // The mark a range lies wholly inside, or null.
  function markAround(range) {
    const markOf = (node) => {
      const e = node.nodeType === 3 ? node.parentElement : node;
      return e && e.closest ? e.closest('.btx-hl') : null;
    };
    const a = markOf(range.startContainer);
    const b = markOf(range.endContainer);
    return a && b && a.getAttribute('data-hl-id') === b.getAttribute('data-hl-id') ? a : null;
  }

  // ---- create / remove ----
  function createFromSelection() {
    const range = selectionRange();
    if (!range) { hideMenu(); return; }
    const container = activeContainer;
    const talkId = activeTalkId;
    const id = newId();
    const ts = Date.now();
    // Every record is measured before any is wrapped: wrapping splits the
    // text nodes the range points into.
    const recs = blockSpans(container, range).map(({ block, start, end }) => ({
      id,
      blockId: block.getAttribute('id') || null,
      blockIdx: block.parentNode === container ? Array.prototype.indexOf.call(container.children, block) : null,
      start,
      end,
      text: blockText(block).slice(start, end),
      ts,
    })).filter((rec) => rec.text.trim());
    hideMenu();
    if (!recs.length) return;
    for (const rec of recs) applyRecord(container, rec);
    window.getSelection().removeAllRanges();
    update(talkId, (list) => list.concat(recs));
    markHintSeen();
    if (onCreated) onCreated();
  }

  function removeHighlight(hlId) {
    const container = activeContainer;
    const talkId = activeTalkId;
    hideMenu();
    if (!container || !container.isConnected) return;
    container.querySelectorAll(`.btx-hl[data-hl-id="${String(hlId).replace(/["\\]/g, '\\$&')}"]`).forEach((span) => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    update(talkId, (list) => list.filter((r) => r.id !== hlId));
  }

  // ---- action menu ----
  function icon(paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false',
    })) svg.setAttribute(k, v);
    for (const d of paths) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  function buildMenu(host) {
    const m = document.createElement('div');
    m.className = 'btx-hl-menu';
    m.hidden = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btx-hl-btn';
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }); // keep the selection
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (menuAction) menuAction();
    });
    m.appendChild(btn);
    host.appendChild(m);
    menuEl = m;
    menuBtn = btn;
  }

  function showMenuAt(rect, mode, action) {
    if (!menuEl || !menuEl.isConnected) return;
    menuAction = action;
    menuBtn.textContent = '';
    menuBtn.append(icon(MENU[mode].icon), document.createTextNode(MENU[mode].label));
    menuEl.hidden = false;
    const w = menuEl.offsetWidth || 120;
    const h = menuEl.offsetHeight || 36;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    menuEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left)) + 'px';
    menuEl.style.top = top + 'px';
  }

  // Focus inside the menu goes back to the talk, not to the page.
  function hideMenu() {
    menuFromClick = false;
    menuAction = null;
    if (!menuEl || menuEl.hidden) return false;
    const hadFocus = menuEl.contains(document.activeElement);
    menuEl.hidden = true;
    if (hadFocus && menuHost && menuHost.isConnected) menuHost.focus({ preventScroll: true });
    return true;
  }

  function dismiss() { return hideMenu(); }

  // ---- event handlers ----
  function onSelectUp() {
    setTimeout(() => {
      // A click on a mark opens "Remove" from the click that follows this
      // mouse-up; this deferred check must not tear it down.
      if (menuFromClick) return;
      const range = selectionRange();
      if (!range) { hideMenu(); return; }
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { hideMenu(); return; }
      const mark = markAround(range);
      if (mark) showMenuAt(rect, 'remove', () => removeHighlight(mark.getAttribute('data-hl-id')));
      else showMenuAt(rect, 'select', createFromSelection);
    }, 0);
  }

  function onContainerClick(e) {
    const span = e.target && e.target.closest && e.target.closest('.btx-hl');
    if (!span) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // a drag that ended on a mark is a selection
    e.stopPropagation();
    const hlId = span.getAttribute('data-hl-id');
    showMenuAt(span.getBoundingClientRect(), 'remove', () => removeHighlight(hlId));
    menuFromClick = true;
  }

  // Shift+arrow selection offers the menu the way a mouse selection does.
  function onKeyUp(e) {
    if (e.shiftKey || e.key === 'Shift') onSelectUp();
  }

  function onKeyDown(e) {
    if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!menuEl || menuEl.hidden || menuEl.contains(e.target)) return;
    e.preventDefault();
    menuBtn.focus();
  }

  function onScroll() { if (menuEl && !menuEl.hidden) hideMenu(); }

  function onDocDown(e) {
    if (menuEl && !menuEl.hidden && !menuEl.contains(e.target)) hideMenu();
  }

  // The nearest ancestor that scrolls (the panel body).
  function scrollerOf(node) {
    for (let n = node && node.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;
    }
    return null;
  }

  // Public: attach to a freshly-rendered talk article. Loads + re-applies saved
  // highlights and wires select-to-highlight / click-to-remove.
  async function attach(container, talkId, opts) {
    const o = opts || {};
    hideMenu();
    activeContainer = container;
    activeTalkId = talkId;
    onCreated = o.onCreate || null;
    menuHost = o.host || container.parentNode;
    buildMenu(menuHost);
    container.addEventListener('mouseup', onSelectUp);
    container.addEventListener('click', onContainerClick);
    menuHost.addEventListener('keyup', onKeyUp);
    menuHost.addEventListener('keydown', onKeyDown);
    // One listener per scroller however many talks attach (same function).
    const scroller = scrollerOf(menuHost);
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (!docBound) { document.addEventListener('mousedown', onDocDown, true); docBound = true; }

    const list = await load(talkId);
    for (const rec of list) { try { applyRecord(container, rec); } catch (e) { /* skip bad record */ } }
  }

  root.__BTX = Object.assign(root.__BTX || {}, { highlights: { attach, dismiss, hintSeen, all, load } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
