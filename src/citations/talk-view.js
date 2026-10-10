/*
 * Inline talk reader: opens a talk inside the panel at the passage that cites
 * the verse. talk-source decides where the HTML comes from and where the cite
 * sits in it; this file sanitizes, renders, marks and reveals, and decides
 * nothing per corpus.
 *
 * Interface (__BTX.talkView):
 *   open(host, { entry, source, onBack }) -> Promise
 *       Render the talk for one cite into `host`, the view host's container.
 *       Resolves once the talk or its error state shows. Scrolling goes
 *       through __BTX.panel.scrollIntoView, the body's one scroll writer.
 *   render(html) -> element     Sanitize talk HTML into a detached .btx-talk.
 *   markCite(target, { roomH }) -> { tinted, passage, reveal }   Mark
 *       findTarget's element: the block tinted (null when none), the
 *       paragraph with the accent bar, and the element open() scrolls to
 *       (the target).
 *   Pure: tintsPassage, revealClear, refPunctuation(classAttr) -> { open, close }.
 *   All are Node-tested in tools/test-talk-source.js (render and markCite
 *   over tools/mini-dom.js: the render contract below).
 *
 * Layout: a sticky header (Back, verse chip, external link; then the title),
 * then in the scroll body a byline (speaker, source, and talk-source's credit
 * line, "Text from {publisher}" linking the talk there), the highlight hint
 * on every talk opened before the first highlight exists (it stays on that
 * talk, so the first highlight shifts no text), and the article.
 * The cited passage is marked (markCite: btx-cit-highlight tints the target,
 * or its paragraph when the target has no text, as a Journal of Discourses
 * marker or page anchor has none, and then only a paragraph no taller than
 * about half the panel body, tintsPassage; such a target gets the pin,
 * btx-cit-pin, drawn by CSS; btx-cit-passage puts the accent bar on the
 * paragraph). Open scrolls to the target itself (btx-cit-target), where
 * the cited words are, with the paragraph's first line clear of the header
 * when the whole paragraph fits (revealClear); the verse chip scrolls there
 * again. Focus follows: a talk opened from the keyboard, and the chip, move
 * focus to the cited paragraph (highlights' focusSpot), so a screen reader
 * reads on from there; a mouse open leaves it on Back.
 *
 * Re-mount: the panel caches a loaded talk and re-mounts the same DOM at its
 * scroll offset without calling open(), so every listener lives on the view's
 * own elements, except Esc. Esc is one listener on #btx-root (bound on the
 * first open): while a talk is mounted and the panel is expanded, Esc from
 * anywhere in the panel but a form field closes a highlight menu first, then
 * goes Back. Back takes focus on a fresh build only. A failed load asks the
 * panel not to cache it (panel.keepView(false)) and offers Try again.
 *
 * Render contract with talk-source.findTarget and highlights: source ids
 * survive, source classes come back prefixed `btxk-`, footnotes carry
 * data-btx-footnum, and the article's textContent stays exactly the source
 * text. Display additions are CSS generated content (reference punctuation on
 * data-btx-open/close, note numbers on data-value) or wrapper spans, the
 * cite's mark is classes, and the byline and hint sit outside the article,
 * so saved highlight offsets hold.
 *
 * IIFE -> __BTX.talkView (+ module.exports for the Node tests).
 */
(function (root) {
  'use strict';

  const talkSource = () => root.__BTX.talkSource;
  const highlights = () => root.__BTX.highlights;
  const panel = () => root.__BTX.panel;
  const citVM = () => root.__BTX.citVM;

  // A load quicker than this shows no spinner at all, rather than a flash.
  const LOADING_DELAY_MS = 200;
  // Shown above each talk until the first highlight is made; it stays on that
  // talk (removing it would shift the text under the new mark).
  const HINT = 'Select text to highlight it; click a highlight to remove it. '
    + 'Keyboard: caret browsing (F7), then Shift+arrows. Highlights stay on this computer.';

  // Whether the reader's last input was a key (a talk opened from the
  // keyboard takes focus to the cited passage). Capture-phase, page-wide.
  let lastInputKey = false;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', () => { lastInputKey = true; }, true);
    document.addEventListener('pointerdown', () => { lastInputKey = false; }, true);
  }

  // Tags kept when sanitizing fetched talk HTML; everything else is unwrapped.
  const ALLOWED = new Set(['P', 'DIV', 'SPAN', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'EM', 'I', 'B', 'STRONG', 'CITE', 'SUP', 'SUB', 'BR', 'UL', 'OL', 'LI', 'SECTION', 'ARTICLE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG',
    'HEAD', 'NAV', 'BUTTON', 'FORM', 'INPUT', 'IMG', 'PICTURE', 'FIGURE', 'VIDEO', 'AUDIO']);
  // The paragraph-like block around a target, which gets the accent bar.
  const PASSAGE = 'p, li, blockquote, .btxk-paragraph, .btxk-std, .btxk-footnote';

  // Whether the cited paragraph is tinted: only while it is at most about
  // half the panel body (`roomH`). A taller one (a Journal of Discourses
  // paragraph can run for screens) would fill the panel with tint and say
  // nothing about where the cite is; its accent bar and the pin mark it
  // instead. Nothing measured (no roomH): tinted. Pure.
  function tintsPassage({ passageH, roomH } = {}) {
    if (!(roomH > 0)) return true;
    return (Number(passageH) || 0) <= roomH / 2;
  }

  // How much of the panel body's top the reveal must clear, for a target
  // `into` px below its paragraph's top. The sticky header (headerH) always.
  // When the whole paragraph fits below the header with breathing room either
  // side, also the part of the paragraph above the target, so the paragraph
  // opens at its first line rather than cut off under the header. A taller
  // paragraph opens at the cited words. Pure; px.
  const REVEAL_SLACK_PX = 12;
  function revealClear({ headerH, roomH, passageH, into } = {}) {
    const head = Math.max(0, Number(headerH) || 0);
    const above = Math.max(0, Number(into) || 0);
    const fits = roomH > 0 && passageH > 0 && head + passageH + 2 * REVEAL_SLACK_PX <= roomH;
    return fits ? head + above : head;
  }

  // Mark the cite at `target` (findTarget's element)
  //   -> { tinted, passage, reveal }.
  // A target with text is tinted itself. One with none (a Journal of
  // Discourses marker or page anchor) has nothing to tint: it gets the pin
  // (btx-cit-pin, a mark CSS draws as generated content), and its paragraph
  // is tinted instead while tintsPassage allows (`opts.roomH`, the panel
  // body's height; tinted is then null). The paragraph around the target
  // (`passage`) gets the accent bar. The reader scrolls to the target itself
  // (reveal, marked btx-cit-target for the panel's place-keeper), since a
  // paragraph can run for screens above the cited words. Classes only: the
  // article's text is unchanged.
  function markCite(target, opts) {
    const roomH = opts && opts.roomH;
    const passage = target.closest(PASSAGE);
    const empty = !target.textContent.trim();
    let tinted = passage && empty ? passage : target;
    if (tinted === passage && roomH > 0
      && !tintsPassage({ passageH: passage.getBoundingClientRect().height, roomH })) tinted = null;
    if (tinted) tinted.classList.add('btx-cit-highlight');
    if (passage) passage.classList.add('btx-cit-passage');
    if (empty) target.classList.add('btx-cit-pin');
    target.classList.add('btx-cit-target');
    return { tinted, passage, reveal: target };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: ['M15 18l-6-6 6-6'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

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

  /* ------------------------------------------------------------- sanitizing */

  // BYU wraps a reference it inserted into the text in a span whose classes
  // spell the punctuation its own stylesheet drew around it, left side then
  // right: 'ccontainer lparen rparendot' reads "(John 3:5)." and 'rsemi' ends
  // one reference of a list with ";". An unknown class adds nothing. An
  // opening bracket carries a leading space, which collapses into the text's
  // own space where there is one.
  const REF_WORDS = /paren|brack|dot|comma|semi|colon|quest|bang|mdash|quote|rdquo|ldquo|apos/g;
  const REF_MARKS = {
    dot: '.', comma: ',', semi: ';', colon: ':', quest: '?', bang: '!',
    mdash: '—', quote: '”', rdquo: '”', ldquo: '“', apos: '’',
  };
  function refPunctuation(classAttr) {
    let open = '';
    let close = '';
    for (const cls of String(classAttr || '').split(/\s+/)) {
      const m = /^([lr])([a-z]+)$/.exec(cls);
      const words = m ? m[2].match(REF_WORDS) || [] : [];
      if (!m || words.join('') !== m[2]) continue;
      const left = m[1] === 'l';
      const marks = words.map((w) => {
        if (w === 'paren') return left ? '(' : ')';
        if (w === 'brack') return left ? '[' : ']';
        return REF_MARKS[w];
      }).join('');
      if (left) open += marks; else close += marks;
    }
    if (/^[([]/.test(open)) open = ' ' + open;
    return { open, close };
  }

  const hasClass = (node, name) => !!(node.classList && node.classList.contains(name));

  // Recursively copy `src` children into `dest`, keeping only allowed elements
  // and the attributes the reader needs (see copyOf).
  function sanitizeInto(src, dest) {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === 3) { // text
        dest.appendChild(document.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const tag = node.tagName;
      if (DROP.has(tag)) continue;
      if (tag === 'HEADER') {
        // The talk's own header (video, title, byline) is shown by the reader;
        // a section's header holds that section's heading.
        if (node.parentElement && node.parentElement.tagName === 'SECTION') sanitizeInto(node, dest);
        continue;
      }
      if (tag === 'FOOTER') {
        // Live General Conference notes, where many talks cite the verse.
        if (hasClass(node, 'notes')) dest.appendChild(copyOf(node, 'SECTION'));
        continue;
      }
      if (tag === 'A' || !ALLOWED.has(tag)) { // links keep their text, drop the href
        sanitizeInto(node, dest);
        continue;
      }
      const c = copyOf(node, tag);
      if (hasClass(node, 'citation')) liftSpacer(c, dest);
      dest.appendChild(c);
    }
  }

  // A clean copy of `node` as `tag`: its id, its classes namespaced `btxk-`,
  // a note marker's number (data-value, drawn by CSS) and an inserted
  // reference's punctuation (data-btx-open/close, drawn by CSS).
  function copyOf(node, tag) {
    const c = document.createElement(tag);
    const id = node.getAttribute('id');
    if (id) c.setAttribute('id', id);
    const cls = (node.getAttribute('class') || '').trim();
    if (cls) c.setAttribute('class', 'btxk-' + cls.split(/\s+/).join(' btxk-'));
    const value = tag === 'SUP' && node.getAttribute('data-value');
    if (value && /^[\w.*†‡-]{1,6}$/.test(value)) c.setAttribute('data-value', value);
    if (hasClass(node, 'ccontainer')) {
      const p = refPunctuation(cls);
      if (p.open) c.setAttribute('data-btx-open', p.open);
      if (p.close) c.setAttribute('data-btx-close', p.close);
    }
    sanitizeInto(node, c);
    return c;
  }

  // Each BYU citation span opens with a spacer (a no-break space and a space),
  // a double gap inside the cited reference's mark. It moves out in front of
  // the span, into a wrapper CSS draws zero-width; the characters keep their
  // order, so the paragraph's textContent is unchanged. Where the text before
  // it has no space of its own, the spacer is marked btx-ref-gap and CSS
  // gives the reference a small margin instead.
  function liftSpacer(citation, dest) {
    const first = citation.firstChild;
    if (!first || first.nodeType !== 3 || first.nodeValue.trim()) return;
    const prev = dest.lastChild;
    const spaced = !prev || (prev.nodeType === 3 && /\s$/.test(prev.nodeValue));
    const spacer = el('span', spaced ? 'btx-ref-spacer' : 'btx-ref-spacer btx-ref-gap');
    spacer.appendChild(first);
    dest.appendChild(spacer);
  }

  // Pick the most content-ful root from a parsed document.
  function pickContentRoot(doc) {
    const sels = ['.gcbody', '.discourseBody', '.page', 'article', 'main', '#content', 'body'];
    for (const s of sels) {
      const node = doc.querySelector(s);
      if (node && node.textContent && node.textContent.trim().length > 200) return node;
    }
    return doc.body || doc.documentElement;
  }

  function render(rawHtml) {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    const rootNode = pickContentRoot(doc);
    const wrap = el('div', 'btx-talk');
    sanitizeInto(rootNode, wrap);
    styleFootnoteNumbers(wrap);
    return wrap;
  }

  // First non-empty text node within `node`, in document order.
  function firstTextNode(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) { if (n.nodeValue && n.nodeValue.trim()) return n; }
    return null;
  }

  // Bundled STPJS footnote list items begin with a literal "N." text node. Replace
  // it with a blue superscript number (no period), matching the in-body footRef
  // markers (styled via .btx-footnum in citations.css). The number is also kept on
  // `data-btx-footnum`, which is what talk-source reads to find the body passage —
  // the styling class stays a styling class.
  function styleFootnoteNumbers(article) {
    for (const note of article.querySelectorAll('.btxk-footnote')) {
      const tn = firstTextNode(note);
      const m = tn && /^(\s*)(\d+)\.(\s*)/.exec(tn.nodeValue);
      if (!m) continue;
      tn.nodeValue = tn.nodeValue.slice(m[0].length);
      note.insertBefore(el('span', 'btx-footnum', m[2]), tn);
      note.setAttribute('data-btx-footnum', m[2]);
    }
  }

  /* ------------------------------------------------------------------ states */

  function loadingState() {
    const s = el('div', 'btx-state btx-loading');
    s.setAttribute('role', 'status');
    s.append(el('div', 'btx-spinner'), el('p', 'btx-state-text', 'Loading talk…'));
    return s;
  }

  // `dest` is the cite's reading destination ({ href, label } | null).
  function errorState(dest, onRetry) {
    const s = el('div', 'btx-state btx-talk-error');
    s.setAttribute('role', 'status');
    s.appendChild(el('p', 'btx-state-text', 'Couldn’t load this talk.'));
    if (dest) s.appendChild(el('p', 'btx-state-hint', 'Check your connection and try again.'));
    const again = el('button', 'btx-cta', 'Try again');
    again.type = 'button';
    again.addEventListener('click', onRetry);
    s.appendChild(again);
    if (dest) s.appendChild(externalLink('btx-talk-error-link', dest.href, dest.label));
    return s;
  }

  function externalLink(cls, href, text) {
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // `credit` is talk-source's { text, href?, title? } naming whose text this is;
  // with an href the line links it.
  function byline(heading, credit) {
    const b = el('div', 'btx-talk-byline');
    if (heading.speaker) b.appendChild(el('div', 'btx-talk-speaker', heading.speaker));
    if (heading.where) b.appendChild(el('div', 'btx-talk-where', heading.where));
    if (credit) {
      const line = el('div', 'btx-talk-credit', credit.href ? null : credit.text);
      if (credit.href) {
        const link = externalLink('btx-talk-credit-link', credit.href, credit.text);
        if (credit.title) link.title = credit.title;
        line.appendChild(link);
      }
      b.appendChild(line);
    }
    return b.childElementCount ? b : null;
  }

  function keepView(keep) {
    const p = panel();
    if (p && p.keepView) p.keepView(keep);
  }

  // Esc goes Back from wherever focus sits in the panel: the talk's text, its
  // header, or the panel's chrome after a mode switch re-mounted the talk.
  // A showing highlight menu closes first. Not while the panel is collapsed,
  // and not from a form field (Esc there belongs to the field). One listener
  // on #btx-root, bound on the first open, acting on whichever talk is
  // mounted — a cached talk is re-mounted without open() running again.
  let escRoot = null;
  function bindEsc() {
    const p = panel();
    const rootEl = (p && p.getRootEl && p.getRootEl()) || document.getElementById('btx-root');
    if (!rootEl || rootEl === escRoot) return;
    escRoot = rootEl;
    rootEl.addEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const rootEl = e.currentTarget;
    if (rootEl.classList.contains('btx-collapsed')) return;
    if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
    const back = rootEl.querySelector('.btx-talk-view .btx-talk-back');
    // Under the panel's welcome the talk is inert: Esc from the header's
    // controls must not page it back unseen.
    if (!back || back.closest('[inert]')) return;
    e.preventDefault();
    const hl = highlights();
    if (hl && hl.dismiss()) return;
    back.click();
  }

  /* -------------------------------------------------------------------- open */

  async function open(host, opts) {
    const { entry, onBack } = opts;
    const source = opts.source || {};
    const heading = citVM().talkHeading(source, entry.versesInChapter);
    host.textContent = '';
    host.classList.add('btx-talk-view');
    host.tabIndex = -1; // a click in the text focuses the view, so its keys work

    const header = el('div', 'btx-talk-header');
    const row = el('div', 'btx-talk-row');
    const back = el('button', 'btx-talk-back');
    back.type = 'button';
    back.append(icon(ICONS.back), document.createTextNode('Back'));
    back.title = 'Back to citations (Esc)';
    back.addEventListener('click', () => {
      const hl = highlights();
      if (hl) hl.dismiss();
      if (onBack) onBack();
    });
    const chip = el('button', 'btx-talk-chip', heading.chip.text);
    chip.type = 'button';
    chip.title = 'Go to the cited passage';
    chip.setAttribute('aria-label', heading.chip.a11yLabel);
    chip.hidden = true; // until the passage is found
    // The external link to the cite's reading destination; hidden while the
    // cite has none.
    const ext = externalLink('btx-talk-ext', '#', null);
    ext.hidden = true;
    ext.appendChild(icon(ICONS.external));
    row.append(back, chip, ext);
    const showDestination = (dest) => {
      ext.hidden = !dest;
      if (!dest) { ext.removeAttribute('href'); return; }
      ext.href = dest.href;
      ext.title = dest.label;
      ext.setAttribute('aria-label', dest.label);
    };
    talkSource().destination({ entry, source }).then(showDestination, () => {});
    const title = el('h2', 'btx-talk-title', heading.title);
    title.title = heading.title;
    header.append(row, title);
    const body = el('div', 'btx-talk-scroll');
    host.append(header, body);

    bindEsc();
    // A fresh build only: a re-mounted talk leaves focus where the reader put
    // it (the mode button that brought it back), and Esc still reaches it.
    const byKeyboard = lastInputKey;
    back.focus({ preventScroll: true });

    // The sticky header covers the top of the body; the passage must clear
    // it, and so must its paragraph's first line when the paragraph fits
    // (revealClear).
    let cite = null; // markCite's { tinted, passage, reveal }
    const roomH = () => { const b = host.closest('.btx-body'); return b ? b.clientHeight : 0; };
    const reveal = () => {
      if (!cite) return;
      const t = cite.reveal;
      let clearTop = header.offsetHeight;
      if (cite.passage) {
        const box = cite.passage.getBoundingClientRect();
        clearTop = revealClear({ headerH: clearTop, roomH: roomH(), passageH: box.height, into: t.getBoundingClientRect().top - box.top });
      }
      panel().scrollIntoView(t, { clearTop });
    };
    // Focus follows the reader to the passage, so a screen reader reads on
    // from there: the cited paragraph (else the target), ringed.
    const focusCite = () => {
      const hl = highlights();
      if (cite && hl) hl.focusSpot(cite.passage || cite.reveal);
    };
    chip.addEventListener('click', () => { reveal(); focusCite(); });

    async function show(retry) {
      body.textContent = '';
      const spin = setTimeout(() => body.appendChild(loadingState()), LOADING_DELAY_MS);
      // talk-source decides live vs bundled and hands back a locator for this
      // cite's target. It never throws; html is null when nothing loaded.
      let loaded = { html: null, url: source.url || null, destination: null, credit: null, findTarget: () => null };
      let hintDone = true;
      try {
        const hl = highlights();
        [loaded, hintDone] = await Promise.all([
          talkSource().load({ entry, source }),
          hl ? hl.hintSeen() : true,
        ]);
      } catch (e) { /* error state below */ }
      clearTimeout(spin);
      // A load that finished after the reader left leaves nothing behind, so
      // it earns no cache slot: the next open builds afresh and reveals the
      // passage, rather than re-mounting a talk that never scrolled to it.
      if (!host.isConnected) { host.textContent = ''; return; }
      body.textContent = '';
      // The stored URL may redirect; the loaded destination deep-links the
      // effective one.
      if (loaded.destination) showDestination(loaded.destination);

      if (!loaded.html) {
        body.appendChild(errorState(loaded.destination, () => {
          back.focus({ preventScroll: true });
          show(true);
        }));
        keepView(false);
        return;
      }

      const by = byline(heading, loaded.credit);
      if (by) body.appendChild(by);
      if (!hintDone) body.appendChild(el('p', 'btx-talk-hint', HINT));
      const article = render(loaded.html);
      body.appendChild(article);
      // Local highlights (saved on this machine, re-applied on reopen).
      try {
        highlights().attach(article, entry.talkId, {
          host,
          reveal: (el) => panel().scrollIntoView(el, { clearTop: header.offsetHeight }),
          menuMinTop: () => header.getBoundingClientRect().bottom,
        });
      } catch (e) { /* non-fatal */ }
      if (retry) keepView(true);
      // Two frames, so re-applied highlights and reflow have settled before
      // the header and target are measured.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const found = loaded.findTarget(article);
        if (!found) return;
        cite = markCite(found, { roomH: roomH() });
        chip.hidden = false;
        reveal();
        // A keyboard open: focus moves on from Back to the passage, unless
        // the reader has already moved it.
        if (byKeyboard && document.activeElement === back) focusCite();
      }));
    }

    return show(false);
  }

  const API = { open, render, markCite, tintsPassage, revealClear, refPunctuation };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { talkView: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
