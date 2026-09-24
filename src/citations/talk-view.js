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
 *   refPunctuation(classAttr) -> { open, close }   Pure; Node-tested in
 *       tools/test-talk-source.js.
 *
 * Layout: a sticky header (Back, verse chip, external link; then the title),
 * then in the scroll body a byline (speaker, source), the one-line highlight
 * hint until the first highlight exists, and the article. The cited passage is
 * marked (btx-cit-highlight on the target, btx-cit-passage on its paragraph)
 * and revealed on open; the verse chip reveals it again.
 *
 * Re-mount: the panel caches a loaded talk and re-mounts the same DOM at its
 * scroll offset, so every listener lives on the view's own elements. Esc on
 * the view closes a highlight menu first, then goes Back. A failed load asks
 * the panel not to cache it (panel.keepView(false)) and offers Try again.
 *
 * Render contract with talk-source.findTarget and highlights: source ids
 * survive, source classes come back prefixed `btxk-`, footnotes carry
 * data-btx-footnum, and the article's textContent stays exactly the source
 * text. Display additions are CSS generated content (reference punctuation on
 * data-btx-open/close, note numbers on data-value) or wrapper spans, and the
 * byline and hint sit outside the article, so saved highlight offsets hold.
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
  const HINT = 'Select text to highlight it. Highlights stay on this computer.';
  const SITE = 'Open on churchofjesuschrist.org';

  // Tags kept when sanitizing fetched talk HTML; everything else is unwrapped.
  const ALLOWED = new Set(['P', 'DIV', 'SPAN', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'EM', 'I', 'B', 'STRONG', 'CITE', 'SUP', 'SUB', 'BR', 'UL', 'OL', 'LI', 'SECTION', 'ARTICLE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG',
    'HEAD', 'NAV', 'BUTTON', 'FORM', 'INPUT', 'IMG', 'PICTURE', 'FIGURE', 'VIDEO', 'AUDIO']);
  // The paragraph-like block around a target, which gets the accent bar.
  const PASSAGE = 'p, li, blockquote, .btxk-paragraph, .btxk-std, .btxk-footnote';

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

  function errorState(url, onRetry) {
    const s = el('div', 'btx-state btx-talk-error');
    s.setAttribute('role', 'status');
    s.appendChild(el('p', 'btx-state-text', "Couldn't load this talk."));
    if (url) s.appendChild(el('p', 'btx-state-hint', 'Check your connection and try again.'));
    const again = el('button', 'btx-cta', 'Try again');
    again.type = 'button';
    again.addEventListener('click', onRetry);
    s.appendChild(again);
    if (url) s.appendChild(externalLink('btx-talk-error-link', url, SITE));
    return s;
  }

  function externalLink(cls, href, text) {
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function byline(heading) {
    const b = el('div', 'btx-talk-byline');
    if (heading.speaker) b.appendChild(el('div', 'btx-talk-speaker', heading.speaker));
    if (heading.where) b.appendChild(el('div', 'btx-talk-where', heading.where));
    return b.childElementCount ? b : null;
  }

  function keepView(keep) {
    const p = panel();
    if (p && p.keepView) p.keepView(keep);
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
    row.append(back, chip);
    let ext = null;
    if (source.url) {
      ext = externalLink('btx-talk-ext', talkSource().fullTalkUrl(source.url, entry.anchor), null);
      ext.title = SITE;
      ext.setAttribute('aria-label', SITE);
      ext.appendChild(icon(ICONS.external));
      row.appendChild(ext);
    }
    const title = el('h2', 'btx-talk-title', heading.title);
    title.title = heading.title;
    header.append(row, title);
    const body = el('div', 'btx-talk-scroll');
    host.append(header, body);

    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      const hl = highlights();
      if (hl && hl.dismiss()) return;
      back.click();
    });
    back.focus({ preventScroll: true });

    // The sticky header covers the top of the body; the passage must clear it.
    let target = null;
    const reveal = () => { if (target) panel().scrollIntoView(target, { clearTop: header.offsetHeight }); };
    chip.addEventListener('click', reveal);

    async function show(retry) {
      body.textContent = '';
      const spin = setTimeout(() => body.appendChild(loadingState()), LOADING_DELAY_MS);
      // talk-source decides live vs bundled and hands back a locator for this
      // cite's target. It never throws; html is null when nothing loaded.
      let loaded = { html: null, url: source.url || null, findTarget: () => null };
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
      // The stored URL may redirect; deep-link the effective one.
      if (ext && loaded.url) ext.href = talkSource().fullTalkUrl(loaded.url, entry.anchor);

      if (!loaded.html) {
        body.appendChild(errorState(loaded.url || source.url, () => {
          back.focus({ preventScroll: true });
          show(true);
        }));
        keepView(false);
        return;
      }

      const by = byline(heading);
      if (by) body.appendChild(by);
      let hint = hintDone ? null : el('p', 'btx-talk-hint', HINT);
      if (hint) body.appendChild(hint);
      const article = render(loaded.html);
      body.appendChild(article);
      // Local highlights (saved on this machine, re-applied on reopen).
      try {
        highlights().attach(article, entry.talkId, {
          host,
          onCreate: () => { if (hint) { hint.remove(); hint = null; } },
        });
      } catch (e) { /* non-fatal */ }
      if (retry) keepView(true);
      // Two frames, so re-applied highlights and reflow have settled before
      // the header and target are measured.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        target = loaded.findTarget(article);
        if (!target) return;
        target.classList.add('btx-cit-highlight');
        const passage = target.closest(PASSAGE);
        if (passage) passage.classList.add('btx-cit-passage');
        chip.hidden = false;
        reveal();
      }));
    }

    return show(false);
  }

  const API = { open, render, refPunctuation };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { talkView: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
