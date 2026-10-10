/*
 * Local highlights in the inline talk reader: select text to mark it, click a
 * mark (or Tab to it and press Enter) to remove it. Saved in chrome.storage.local on this machine only
 * (ADR-0004), one list per talk under `btxHl::{talkId}`, and re-applied when
 * the talk is opened again.
 *
 * Interface (__BTX.highlights):
 *   attach(container, talkId, { host, onCreate, reveal })
 *       Wire a freshly rendered talk article and re-apply its saved marks.
 *       `host` is the focusable view around the article: it receives the
 *       keyboard keys and holds the action menu, so the menu leaves the page
 *       with its view. onCreate() runs after each new highlight. reveal(el)
 *       brings a Tab stop into view (the panel's scrollIntoView): every focus
 *       here is non-scrolling.
 *   dismiss() -> bool    Hide the action menu; true when it was showing (the
 *                        reader's Esc closes the menu before the talk).
 *   hintSeen() -> Promise<bool>   Whether a highlight was ever made on this
 *                        computer; the reader shows its one-line hint until then.
 *   all(), load(talkId)  The stored records.
 *   Pure cores (module.exports, tools/validate-highlights.js): tabStops,
 *   opensMenu, stopFromCaret.
 *
 * The action menu offers "Highlight" after a mouse-up or a Shift key-up leaves
 * a selection in the article, and "Remove" after a click on a mark (or a
 * selection inside one). Tab from the talk moves into the menu; a scroll of the
 * reader, or focus leaving the menu, hides it. The menu acts only on an article
 * still on the page. "Highlight" acts on the selection it was offered for, kept
 * when the menu opens: under caret browsing, focus on the menu's button clears
 * the live selection. Esc from the menu puts that selection back.
 *
 * Keyboard removal: each highlight is one Tab stop, its first span
 * (`tabStops`: a highlight is cut into one span per text node, so a long one
 * is many spans), a button whose Enter or Space (`opensMenu`) opens "Remove"
 * with focus on the action; Esc gives focus back to the mark, Enter removes.
 * While the stop has keyboard focus every span of its highlight is ringed.
 * After a keyboard apply or remove, focus is on the view and the caret sits
 * where the mark ends or began; Tab from the view with the caret in its text
 * goes on from the caret (`stopFromCaret`), so the reader keeps their place.
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

  // What the talk view's Tab stops are (see tabFromCaret).
  const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
    + 'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MENU = {
    select: { label: 'Highlight', icon: ['M12 20h8', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'] },
    remove: { label: 'Remove', icon: ['M18 6L6 18', 'M6 6l12 12'] },
  };

  let activeContainer = null;
  let activeTalkId = null;
  let onCreated = null;
  let revealer = null;      // brings a stop Tab moved to into view (attach's reveal)
  let menuHost = null;      // the view the current menu lives in
  let menuEl = null;
  let menuBtn = null;
  let menuAction = null;    // what the menu button does while showing
  let menuFromMark = false; // a click or key on a mark opened it (see onSelectUp)
  let menuRange = null;     // the selection "Highlight" acts on (see showSelectMenu)
  let menuReturn = null;    // the mark a keyboard-opened "Remove" gives focus back to
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

  // ---- pure cores (exported for Node) ----
  // Which mark spans are Tab stops, given each span's highlight id in document
  // order: the first span of each highlight, so a highlight cut into many
  // spans is one stop.
  function tabStops(ids) {
    const seen = new Set();
    return ids.map((id) => !seen.has(id) && !!seen.add(id));
  }

  // Whether a key on a focused mark opens its Remove action: a plain Enter or
  // Space, as on a button.
  function opensMenu(e) {
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
    return e.key === 'Enter' || e.key === ' ';
  }

  // Which Tab stop a Tab (back: Shift+Tab) from the caret lands on, given each
  // stop's start as the side of the caret it lies on (-1 before, 0 at, 1
  // after), in document order: the first at or after it, or the last before
  // it. -1 when there is none.
  function stopFromCaret(sides, back) {
    if (back) return sides.lastIndexOf(-1);
    return sides.findIndex((side) => side >= 0);
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
    return inArticle(sel.getRangeAt(0));
  }

  // `range` when it is non-empty and lies inside a live article, else null.
  function inArticle(range) {
    const c = activeContainer;
    if (!range || range.collapsed || !c || !c.isConnected) return null;
    return c.contains(range.startContainer) && c.contains(range.endContainer) ? range : null;
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
  // Acts on the selection the menu was offered for: focusing the menu's button
  // clears the live selection under caret browsing.
  function createFromSelection() {
    const range = inArticle(menuRange);
    menuRange = null;
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
    markStops(container);
    // The caret waits after the new mark, where a caret-browsing reader goes on.
    const made = marksOf(container, id);
    if (made.length) placeCaret((r) => r.setStartAfter(made[made.length - 1]));
    update(talkId, (list) => list.concat(recs));
    markHintSeen();
    if (onCreated) onCreated();
  }

  // Focus that sat on the mark or in its menu stays in the view, and the caret
  // waits where the mark began, so a keyboard reader keeps their place.
  function removeHighlight(hlId) {
    const container = activeContainer;
    const talkId = activeTalkId;
    menuReturn = null; // the mark is going: focus goes to the view
    const spans = container && container.isConnected ? marksOf(container, hlId) : [];
    const hadFocus = spans.some((span) => span.contains(document.activeElement));
    hideMenu();
    if (!spans.length) return;
    if (hadFocus && menuHost && menuHost.isConnected) menuHost.focus({ preventScroll: true });
    // A live range before the first mark survives the unwrap and normalize.
    const at = document.createRange();
    at.setStartBefore(spans[0]);
    for (const span of spans) {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    markStops(container);
    placeCaret((r) => r.setStart(at.startContainer, at.startOffset));
    update(talkId, (list) => list.filter((r) => r.id !== hlId));
  }

  // Every span of one highlight, in document order.
  function marksOf(container, hlId) {
    return Array.from(container.querySelectorAll(`.btx-hl[data-hl-id="${String(hlId).replace(/["\\]/g, '\\$&')}"]`));
  }

  // A collapsed selection, placed by `set` on a fresh range.
  function placeCaret(set) {
    try {
      const r = document.createRange();
      set(r);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* no caret */ }
  }

  // One Tab stop per highlight (tabStops): its first span is a button whose
  // Enter opens Remove; the other spans carry no stop.
  function markStops(container) {
    const spans = Array.from(container.querySelectorAll('.btx-hl'));
    const stops = tabStops(spans.map((s) => s.getAttribute('data-hl-id')));
    spans.forEach((span, i) => {
      if (stops[i]) {
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute('aria-roledescription', 'highlight');
        span.setAttribute('aria-description', 'Enter to remove');
      } else {
        for (const a of ['tabindex', 'role', 'aria-roledescription', 'aria-description']) span.removeAttribute(a);
      }
    });
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
    // Focus that leaves the menu (Tab on, a click elsewhere) closes it.
    m.addEventListener('focusout', (e) => { if (!m.contains(e.relatedTarget)) hideMenu(); });
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

  // "Highlight" for the selection `range`. The range is kept: Tab into the
  // menu clears the live selection under caret browsing.
  function showSelectMenu(range) {
    menuRange = range.cloneRange();
    showMenuAt(range.getBoundingClientRect(), 'select', createFromSelection);
  }

  // Focus inside the menu goes back where it came from: the mark that opened
  // it, else the talk with the offered selection put back; never the page.
  function hideMenu() {
    const back = menuReturn;
    const range = menuRange;
    menuFromMark = false;
    menuAction = null;
    menuReturn = null;
    menuRange = null;
    if (!menuEl || menuEl.hidden) return false;
    const hadFocus = menuEl.contains(document.activeElement);
    menuEl.hidden = true;
    if (!hadFocus) return true;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    else if (menuHost && menuHost.isConnected) {
      menuHost.focus({ preventScroll: true });
      if (inArticle(range)) placeSelection(range);
    }
    return true;
  }

  function placeSelection(range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function dismiss() { return hideMenu(); }

  // Whether `el` shows to the reader: its middle is not off the panel body,
  // under the reader's sticky header, or off the window.
  function onScreen(el) {
    const r = el.getClientRects()[0];
    if (!r) return false;
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 4), r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }

  // ---- event handlers ----
  function onSelectUp() {
    setTimeout(() => {
      // A click on a mark opens "Remove" from the click that follows this
      // mouse-up, and Enter on a mark opens it with focus in it; this
      // deferred check must not tear either down.
      if (menuFromMark) { menuFromMark = false; return; }
      const range = selectionRange();
      if (!range) { hideMenu(); return; }
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { hideMenu(); return; }
      const mark = markAround(range);
      if (mark) showMenuAt(rect, 'remove', () => removeHighlight(mark.getAttribute('data-hl-id')));
      else showSelectMenu(range);
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
    menuFromMark = true;
  }

  // Enter on a focused mark opens its "Remove" with focus on the action, as a
  // menu button does; Esc gives focus back to the mark.
  function onMarkKey(e) {
    const span = e.target && e.target.closest && e.target.closest('.btx-hl[tabindex]');
    if (!span || span !== e.target || !opensMenu(e)) return false;
    e.preventDefault();
    const hlId = span.getAttribute('data-hl-id');
    showMenuAt(span.getBoundingClientRect(), 'remove', () => removeHighlight(hlId));
    if (!menuEl || menuEl.hidden) return true;
    menuFromMark = true;
    menuReturn = span;
    menuBtn.focus({ preventScroll: true });
    return true;
  }

  // A focused mark rings every span of its highlight, so the reader sees what
  // Remove takes away.
  function onMarkFocus(e) {
    const span = e.target;
    if (!span || !span.matches || !span.matches('.btx-hl[tabindex]')) return;
    const on = e.type === 'focusin' && span.matches(':focus-visible');
    for (const part of marksOf(activeContainer, span.getAttribute('data-hl-id'))) {
      part.classList.toggle('btx-hl-focus', on);
    }
  }

  // Shift+arrow selection offers the menu the way a mouse selection does.
  function onKeyUp(e) {
    if (e.shiftKey || e.key === 'Shift') onSelectUp();
  }

  function onKeyDown(e) {
    if (onMarkKey(e)) return;
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!e.shiftKey && menuEl && !menuEl.hidden && !menuEl.contains(e.target)) {
      e.preventDefault();
      menuBtn.focus({ preventScroll: true });
      return;
    }
    tabFromCaret(e);
  }

  // With the caret in the talk view's text, focus sits on the view around it, and
  // a plain Tab from there would start over at Back. Tab goes on from the
  // caret instead, as it does in a page's own text: to the next stop after it
  // (Shift+Tab: the last before it), or, past the last, out of the talk.
  function tabFromCaret(e) {
    if (e.target !== menuHost) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !menuHost.contains(sel.focusNode) || (menuEl && menuEl.contains(sel.focusNode))) return;
    const caret = document.createRange();
    caret.setStart(sel.focusNode, sel.focusOffset);
    const stops = Array.from(menuHost.querySelectorAll(TABBABLE)).filter((el) =>
      !(menuEl && menuEl.contains(el)) && !el.closest('[hidden], [inert]') && el.getClientRects().length);
    const i = stopFromCaret(stops.map((el) => caret.comparePoint(el, 0)), e.shiftKey);
    if (i >= 0) {
      e.preventDefault();
      stops[i].focus({ preventScroll: true });
      if (revealer && !onScreen(stops[i])) revealer(stops[i]);
    } else if (!e.shiftKey && stops.length) {
      // From the last stop, the browser's own Tab leaves the talk.
      stops[stops.length - 1].focus({ preventScroll: true });
    }
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
    revealer = o.reveal || null;
    menuHost = o.host || container.parentNode;
    buildMenu(menuHost);
    container.addEventListener('mouseup', onSelectUp);
    container.addEventListener('click', onContainerClick);
    container.addEventListener('focusin', onMarkFocus);
    container.addEventListener('focusout', onMarkFocus);
    menuHost.addEventListener('keyup', onKeyUp);
    menuHost.addEventListener('keydown', onKeyDown);
    // One listener per scroller however many talks attach (same function).
    const scroller = scrollerOf(menuHost);
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (!docBound) { document.addEventListener('mousedown', onDocDown, true); docBound = true; }

    const list = await load(talkId);
    for (const rec of list) { try { applyRecord(container, rec); } catch (e) { /* skip bad record */ } }
    markStops(container);
  }

  const API = { attach, dismiss, hintSeen, all, load, tabStops, opensMenu, stopFromCaret };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { highlights: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
