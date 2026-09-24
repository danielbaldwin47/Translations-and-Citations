/*
 * Citations mode: renders, for the current chapter, the talks that cite its
 * verses, in one of two citation layouts (opts.view):
 *   - 'verse'  : accordion verse -> source type -> talks. A cite that spans a
 *                verse range shows once per anchor verse with a range badge.
 *   - 'source' : one row per talk, grouped by source type, each badged with
 *                the verses it cites.
 * Clicking a row hands off to the inline talk reader via onOpenTalk.
 *
 * A DOM adapter only: what to show, in what order, with what label, count and
 * open state is decided by the pure view-model in cit-view-model.js, which
 * hands over a descriptor tree (see its header) plus the toolbar's state
 * transitions. Nothing here sorts, groups, counts or labels.
 *
 * Interface (__BTX.citPanel):
 *   render(host, { slug, chapter, fullName, view, focusVerse, onOpenTalk })
 *       Build the list into the view host's container. A focusVerse opens,
 *       outlines and reveals its verse group.
 *   refocus()      Focus the row last opened from the mounted list (after Back
 *                  re-mounts it). No-op when none is mounted or none was opened.
 *   markVerse(v)   Move the focus-verse outline in the mounted by-verse list to
 *                  verse v, without re-rendering, opening or scrolling. No-op in
 *                  by source.
 * Both act on whichever list the panel has mounted, so they hold no reference
 * to a list; every bit of state they read lives on the list's own elements,
 * which the view host caches and re-mounts as one piece.
 *
 * Hooks the rest of the panel reads:
 *   .btx-cit-list[data-btx-cit-empty]   the chapter has no talks (panel.css
 *                                       hides the layout toggle then)
 *   .btx-cit[data-btx-focus-return]     the last-opened row (class btx-cit-last)
 *
 * The one read of the site's page: each verse's own words under its "Verse
 * {v}" header, by element id, as text — only while the page shows this
 * chapter, and never written to (ADR-0007).
 *
 * IIFE -> __BTX.citPanel.
 */
(function (root) {
  'use strict';

  const citData = () => root.__BTX.citData;
  const vm = () => root.__BTX.citVM;
  const panel = () => root.__BTX.panel;

  // A load quicker than this shows no spinner at all, rather than a flash.
  const LOADING_DELAY_MS = 200;
  // The site may still be showing the previous chapter when the list renders
  // (SPA navigation); verse excerpts are retried this many ms later.
  const EXCERPT_RETRY_MS = [600, 2000];

  let describedIds = 0;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // The list the panel has mounted right now (the body holds one view at a time).
  const mountedList = () => document.querySelector('#btx-root .btx-cit-list');

  // A <summary> with a custom caret, a label (plus, on a verse, a slot for the
  // verse's words) and a right-aligned count chip. The aria-label carries the
  // noun the bare chip lacks ("Verse 16, 183 talks").
  function summaryRow(cls, group) {
    const sum = el('summary', cls);
    sum.setAttribute('aria-label', group.a11yLabel);
    sum.appendChild(el('span', 'btx-caret'));
    const label = el('span', 'btx-cit-label');
    label.appendChild(el('span', 'btx-cit-label-text', group.label));
    if (group.kind === 'verse') {
      const excerpt = el('span', 'btx-cit-excerpt');
      excerpt.dataset.btxVerse = String(group.verse);
      label.appendChild(excerpt);
    }
    sum.appendChild(label);
    sum.appendChild(el('span', 'btx-cit-count' + (group.countClass ? ' ' + group.countClass : ''), String(group.count)));
    return sum;
  }

  function rowEl(row, onOpen) {
    const node = el('div', 'btx-cit');
    node.dataset.btxUid = row.uid;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', row.a11yLabel);
    const head = el('div', 'btx-cit-head');
    head.appendChild(el('span', 'btx-cit-speaker', row.speaker));
    if (row.rangeLabel) head.appendChild(el('span', 'btx-cit-range', row.rangeLabel));
    node.appendChild(head);
    if (row.sub) node.appendChild(el('div', 'btx-cit-sub', row.sub));
    if (row.snippet) {
      const snippet = el('div', 'btx-cit-snippet', row.snippet);
      snippet.id = `btx-cit-snippet-${++describedIds}`;
      node.setAttribute('aria-describedby', snippet.id);
      node.appendChild(snippet);
    }
    const open = () => onOpen(row, node);
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return node;
  }

  // Whichever <details> represents a *source type* — the nested group in the
  // by-verse layout, the top-level one in by-source — carries its group key as
  // a class, the hook for the coloured left-edge strip.
  function groupClass(base, group) {
    return group.kind === 'sourceType' ? base + ' btx-grp-' + group.key : base;
  }

  // One top-level group: a <details> per verse (by-verse) or per source type
  // (by-source). Nested source-type groups are <details> too; by-source rows
  // hang in a plain container instead.
  function groupEl(group, onOpen) {
    const node = el('details', groupClass('btx-cit-vgroup', group));
    node.dataset.btxUid = group.uid;
    node.appendChild(summaryRow('btx-cit-vhead', group));
    node.open = group.open;
    if (group.focus) node.classList.add('btx-cit-focus');

    for (const child of group.children) {
      const cnode = el('details', groupClass('btx-cit-cgroup', child));
      cnode.dataset.btxUid = child.uid;
      cnode.appendChild(summaryRow('btx-cit-chead', child));
      cnode.open = child.open;
      for (const row of child.rows) cnode.appendChild(rowEl(row, onOpen));
      node.appendChild(cnode);
    }
    if (group.rows.length) {
      const cgroup = el('div', 'btx-cit-cgroup');
      for (const row of group.rows) cgroup.appendChild(rowEl(row, onOpen));
      node.appendChild(cgroup);
    }
    return node;
  }

  // uid -> element, re-read per interaction so it always reflects the tree
  // that is actually mounted.
  function nodeMap(wrap) {
    const nodes = new Map();
    for (const n of wrap.querySelectorAll('[data-btx-uid]')) nodes.set(n.dataset.btxUid, n);
    return nodes;
  }

  // Toolbar above the list: a live filter box (speaker / title / passage) and
  // Collapse all. The view-model decides what hides, what opens, what the
  // counts, summary and button say; this mirrors each plan onto the elements
  // and reports the user's own open/close back into the state.
  function attachTools(wrap, tools, summary, viewModel) {
    const input = el('input', 'btx-cit-filter');
    input.type = 'search';
    input.placeholder = 'Filter talks…';
    input.setAttribute('aria-label', 'Filter talks');
    const collapse = el('button', 'btx-cit-toolbtn');
    collapse.type = 'button';
    tools.appendChild(input);
    tools.appendChild(collapse);

    const noRes = el('div', 'btx-cit-noresults');
    const noResText = el('p', 'btx-state-text');
    const clear = el('button', 'btx-cit-toolbtn', 'Clear filter');
    clear.type = 'button';
    noRes.appendChild(noResText);
    noRes.appendChild(clear);
    noRes.hidden = true;

    let state = vm().initialState(viewModel);
    let hidden = {};

    function applyOpen(open, nodes) {
      for (const uid of Object.keys(open)) {
        const node = nodes.get(uid);
        if (node) node.open = open[uid];
      }
    }

    // The button hides when there is nothing to collapse; focus on it would
    // fall to the page, so it moves to the first group header instead.
    function showCollapse(label) {
      const had = document.activeElement === collapse;
      if (label) collapse.textContent = label;
      collapse.hidden = !label;
      if (had && collapse.hidden) {
        const first = wrap.querySelector('.btx-cit-vgroup:not(.btx-cit-hidden) > summary');
        (first || input).focus();
      }
    }

    function applyFilter() {
      const plan = vm().filterPlan(viewModel, input.value, state);
      const nodes = nodeMap(wrap);
      for (const uid of Object.keys(plan.hidden)) {
        const node = nodes.get(uid);
        if (node) node.classList.toggle('btx-cit-hidden', plan.hidden[uid]);
      }
      for (const uid of Object.keys(plan.counts)) {
        const node = nodes.get(uid);
        const head = node && node.firstElementChild;
        if (!head) continue;
        head.setAttribute('aria-label', plan.a11y[uid]);
        const chip = head.querySelector('.btx-cit-count');
        if (chip) chip.textContent = String(plan.counts[uid]);
      }
      applyOpen(plan.open, nodes);
      state = vm().applyPlan(state, plan);
      hidden = plan.hidden;
      summary.textContent = plan.summary;
      noRes.hidden = !plan.noResults;
      noResText.textContent = plan.noResults || '';
      showCollapse(plan.collapseLabel);
    }

    input.addEventListener('input', applyFilter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; applyFilter(); }
    });
    clear.addEventListener('click', () => { input.value = ''; applyFilter(); input.focus(); });
    collapse.addEventListener('click', () => {
      const plan = vm().collapseAllPlan(viewModel, state, hidden);
      applyOpen(plan.open, nodeMap(wrap));
      state = vm().applyPlan(state, plan);
      showCollapse(vm().collapseLabel(viewModel, state, hidden));
    });
    // 'toggle' doesn't bubble, but capture listeners on ancestors still see it.
    // Every open/close the user makes lands back in the state object. (Our own
    // writes are already in `state`; the groups' initial open flags never reach
    // here — they are set while the group is still detached — but `initialState`
    // reads them from the same descriptors, so the two agree.)
    wrap.addEventListener('toggle', (e) => {
      const uid = e.target && e.target.dataset && e.target.dataset.btxUid;
      if (!uid || !(uid in state.open)) return;
      state.open[uid] = e.target.open;
      showCollapse(vm().collapseLabel(viewModel, state, hidden));
    }, true);
    showCollapse(vm().collapseLabel(viewModel, state, hidden));
    return noRes;
  }

  // Closing a group from its pinned (sticky) header leaves the header wherever
  // the group began — often far above the fold. Bring it back into view so the
  // reader sees what they just folded. Only for a header the user clicked:
  // Collapse all and the filter toggle groups too, and must not scroll.
  function keepClosedHeaderInView(wrap) {
    let clicked = null;
    wrap.addEventListener('click', (e) => {
      const head = e.target.closest && e.target.closest('summary');
      clicked = head && wrap.contains(head) ? head.parentElement : null;
    }, true);
    wrap.addEventListener('toggle', (e) => {
      if (e.target !== clicked || e.target.open) return;
      clicked = null;
      const head = e.target.firstElementChild;
      const body = wrap.closest('.btx-body');
      if (!head || !body) return;
      if (head.getBoundingClientRect().top < body.getBoundingClientRect().top) panel().scrollIntoView(head);
    }, true);
  }

  // Mark the row being opened as the one Back returns focus to.
  function markLastRow(wrap, node) {
    for (const n of wrap.querySelectorAll('[data-btx-focus-return]')) {
      n.removeAttribute('data-btx-focus-return');
      n.classList.remove('btx-cit-last');
    }
    node.setAttribute('data-btx-focus-return', '');
    node.classList.add('btx-cit-last');
  }

  // --- verse excerpts (read-only, from the site's page) ----------------------

  // The verse's words without its number, pilcrow or study-note markers.
  function verseText(p) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement.closest('sup, button, svg')) text += n.data;
    }
    return text.replace(/\s+/g, ' ').trim().replace(/^\d+\s*/, '').replace(/^¶\s*/, '');
  }

  // Fill the empty excerpt slots, if the page is showing this list's chapter.
  // Returns false when it isn't (yet), so the caller can try again later.
  function fillExcerpts(wrap) {
    if ('btxExcerpts' in wrap.dataset) return true;
    const article = document.querySelector('article[data-uri]');
    const uri = (article && article.getAttribute('data-uri')) || '';
    if (!uri.endsWith(`/${wrap.dataset.btxSlug}/${wrap.dataset.btxChapter}`)) return false;
    let any = false;
    for (const slot of wrap.querySelectorAll('.btx-cit-excerpt')) {
      const p = document.getElementById('p' + slot.dataset.btxVerse);
      if (p && article.contains(p)) slot.textContent = verseText(p);
      if (slot.textContent) any = true;
    }
    if (any) wrap.dataset.btxExcerpts = '';
    return true;
  }

  function scheduleExcerpts(wrap) {
    if (fillExcerpts(wrap)) return;
    for (const ms of EXCERPT_RETRY_MS) setTimeout(() => fillExcerpts(wrap), ms);
  }

  // --- render ---------------------------------------------------------------

  // Render the chapter's citations into `host` — the container the panel's view
  // host handed us. Keeping that container alive (so scroll position and which
  // groups are open survive a mode toggle) is the panel's business, not ours.
  async function render(host, opts) {
    const { slug, chapter, onOpenTalk } = opts;
    host.textContent = '';
    const loading = el('div', 'btx-state btx-loading');
    loading.setAttribute('role', 'status');
    loading.appendChild(el('div', 'btx-spinner'));
    loading.appendChild(el('div', 'btx-state-text', 'Loading citations…'));
    const spin = setTimeout(() => host.appendChild(loading), LOADING_DELAY_MS);

    let data;
    try { data = await citData().chapterData(slug, chapter); } finally { clearTimeout(spin); }
    const viewModel = vm().buildView(data, opts);

    const wrap = el('div', 'btx-cit-list');
    wrap.dataset.btxLayout = viewModel.layout;
    wrap.dataset.btxSlug = slug;
    wrap.dataset.btxChapter = String(chapter);
    const onOpen = (row, node) => {
      markLastRow(wrap, node);
      if (onOpenTalk) onOpenTalk(row.entry);
    };

    if (viewModel.empty) {
      wrap.setAttribute('data-btx-cit-empty', '');
      const empty = el('div', 'btx-state');
      empty.appendChild(el('p', 'btx-state-text', viewModel.emptyText));
      wrap.appendChild(empty);
    } else {
      const summary = el('div', 'btx-cit-summary', viewModel.summary);
      summary.setAttribute('role', 'status');
      wrap.appendChild(summary);
      let noRes = null;
      if (viewModel.showTools) {
        const tools = el('div', 'btx-cit-tools');
        wrap.appendChild(tools);
        noRes = attachTools(wrap, tools, summary, viewModel);
      }
      for (const group of viewModel.groups) wrap.appendChild(groupEl(group, onOpen));
      if (noRes) wrap.appendChild(noRes);
      keepClosedHeaderInView(wrap);
    }

    host.textContent = '';
    host.appendChild(wrap);
    if (viewModel.layout === 'verse' && !viewModel.empty) scheduleExcerpts(wrap);
    const focusEl = viewModel.focusUid && wrap.querySelector(`[data-btx-uid="${CSS.escape(viewModel.focusUid)}"]`);
    // Where the focus verse lands is the panel's rule, not ours — the same one
    // the talk reader gets, so the list arrives with context above it too.
    if (focusEl) panel().scrollIntoView(focusEl, { frames: 1 });
  }

  function refocus() {
    const wrap = mountedList();
    const row = wrap && wrap.querySelector('[data-btx-focus-return]');
    if (row) row.focus({ preventScroll: true });
  }

  function markVerse(v) {
    const wrap = mountedList();
    if (!wrap || wrap.dataset.btxLayout !== 'verse') return;
    fillExcerpts(wrap);
    const uid = vm().verseUid(v);
    for (const n of wrap.querySelectorAll('.btx-cit-focus')) {
      if (n.dataset.btxUid !== uid) n.classList.remove('btx-cit-focus');
    }
    const group = wrap.querySelector(`[data-btx-uid="${CSS.escape(uid)}"]`);
    if (group) group.classList.add('btx-cit-focus');
  }

  root.__BTX = Object.assign(root.__BTX || {}, { citPanel: { render, refocus, markVerse } });
})(typeof globalThis !== 'undefined' ? globalThis : this);
