/*
 * Orchestrator (content-script entry). Detection, worker messaging, and data
 * fetching — the panel owns its own state (mode, layout, collapsed, width) and
 * hosts the views (caching, scroll position):
 *  - watches SPA navigation and renders the matching chapter's content
 *  - points the theme module at the panel root (it owns keeping it in sync)
 *  - manages translation selection and the loading/error/no-key states; the
 *    dropdown's rows and the pick among them are __BTX.churchText's pure
 *    textsFor / pickText (api.bible versions, then Church languages)
 *  - answers the panel's renderMode event with fresh mode content
 *  - names each view and supplies its content key; it holds no panel DOM
 *
 * Runs once per page. Shared modules (constants/settings/books) and the other
 * content modules are loaded before this file via the manifest content_scripts
 * order.
 */
(function (root) {
  'use strict';

  const C = root.__BTX.const;
  const SETTINGS = root.__BTX.settings;
  const BOOKS = root.__BTX.books;
  const detect = root.__BTX.detect;
  const theme = root.__BTX.theme;
  const panel = root.__BTX.panel;
  const citPanel = root.__BTX.citPanel;
  const talkView = root.__BTX.talkView;
  const churchText = root.__BTX.churchText;
  const pageSplit = root.__BTX.pageSplit;

  const SELECTION_KEY = 'btxSelectedTranslation';

  // Settings the panel reacts to by itself (owning some, displaying others,
  // e.g. showCitationToggle). A change touching only these never needs the
  // orchestrator's full re-render — the panel adopts it and fires renderMode
  // when it made the mounted content stale. The list belongs to the panel; we
  // read it rather than keeping a copy that could drift.
  const PANEL_KEYS = panel.HANDLED_KEYS;

  let enabled = null; // { translations, churchLanguages, defaultId, provider, hasKey }
  // The version the user last picked (persisted under SELECTION_KEY). A
  // preference, not what is showing: a chapter that doesn't offer it shows a
  // fallback without overwriting it — see pickText.
  let selectedId = null;
  let selectionLoaded = false;
  let texts = []; // the rows the current chapter offers (textsFor)
  let activeId = null; // the row showing now (pickText)
  let splitToken = 0; // guards the page split against stale chapter loads
  let current = null; // parsed location
  let reqToken = 0; // guards against stale responses
  let retryTimer = null;
  let userClosed = false;
  let themeMirror = null; // theme.mirror handle — the theme module keeps the panel in sync
  let currentKey = null; // dedupes repeat navigation events for the same chapter
  let scrollToSnippet = true; // open sources scrolled to the cited paragraph

  function getStored(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (d) => resolve(d && d[key])); } catch (e) { resolve(undefined); }
    });
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ error: { code: C.ERR.NETWORK, message: chrome.runtime.lastError.message } });
          } else {
            resolve(res);
          }
        });
      } catch (e) {
        resolve({ error: { code: C.ERR.UNKNOWN, message: String(e) } });
      }
    });
  }

  function refLabel(parsed) {
    const name = BOOKS.bookFullName(parsed.ldsBook) || parsed.ldsBook;
    return `${name} ${parsed.chapter}`;
  }

  function findTranslation(id) {
    return texts.find((t) => t.id === id);
  }

  async function loadEnabled(force) {
    if (enabled && !force) return enabled;
    enabled = await send({ type: C.MSG.GET_ENABLED_TRANSLATIONS });
    if (!enabled || enabled.error) enabled = { translations: [], churchLanguages: [], defaultId: '', provider: C.PROVIDER_APIBIBLE, hasKey: false };
    return enabled;
  }

  function textsForChapter(parsed, e) {
    return churchText.textsFor({
      isBible: parsed.isBible !== false,
      collection: parsed.collection,
      bibleRows: e.translations,
      languages: e.churchLanguages,
      pageLang: parsed.lang,
    });
  }

  function storeSelection(id) {
    try { chrome.storage.local.set({ [SELECTION_KEY]: id }); } catch (e) { /* ignore */ }
  }

  async function render() {
    const parsed = detect.parseLocation(location.pathname, location.search);
    current = parsed;

    if (!parsed) {
      panel.hide();
      currentKey = null;
      syncSplit();
      return;
    }

    // Skip spurious events (e.g. verse-anchor hashchange) for the same chapter.
    // Panel-initiated changes arrive via renderMode instead, bypassing this.
    const key = `${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}/${parsed.lang}`;
    if (key === currentKey) return;
    currentKey = key;
    clearTimeout(retryTimer);
    // A new chapter: the split's per-id rules would land on the incoming
    // chapter's elements before its text arrives.
    ++splitToken;
    pageSplit.hide();

    if (userClosed) {
      panel.hide();
      return;
    }

    const e = await loadEnabled();

    // Respect the "English pages only" preference.
    if (e.actOnNonEngOnly !== false && parsed.lang !== 'eng') {
      panel.hide();
      syncSplit();
      return;
    }

    // Every Bible chapter is translatable (with nothing enabled it says so);
    // any other chapter only once a Church language gives it a text.
    texts = textsForChapter(parsed, e);
    panel.showChapter({ title: refLabel(parsed), translatable: parsed.isBible !== false || texts.length > 0 });
    if (themeMirror) themeMirror.refresh(); // the panel is on screen: theme it now

    await renderActiveMode();
  }

  function renderActiveMode() {
    if (!current) return undefined;
    if (panel.effectiveMode() === 'citations') {
      syncSplit(); // the split belongs to Translation mode
      return renderCitations(current);
    }
    return renderTranslation();
  }

  // The page split follows Translation mode: it shows while the active row is a
  // Church language whose layout is in-page, and goes with everything else —
  // Citations, an api.bible version, the panel closed, the page left. Called
  // wherever one of those inputs moves; pageSplit.show is a no-op for the key
  // already showing.
  async function syncSplit() {
    const e = enabled;
    const row = findTranslation(activeId);
    const layout = e && e.churchLanguageLayout;
    const want = pageSplit.wantsSplit({
      visible: !!current && !userClosed && !!e && !(e.actOnNonEngOnly !== false && current.lang !== 'eng'),
      mode: panel.effectiveMode(),
      row,
      layout,
    });
    if (!want) {
      ++splitToken;
      pageSplit.hide();
      return;
    }
    const parsed = current;
    const key = `${citKey(parsed)}|${row.lang}|${layout}`;
    if (pageSplit.currentKey() === key) return;
    const token = ++splitToken;
    const res = await churchText.load(parsed, row.lang);
    if (token !== splitToken) return;
    if (!res || res.error) { pageSplit.hide(); return; } // the panel card says why
    pageSplit.show({ key, chapter: res, layout, uri: churchText.chapterUri(parsed) });
  }

  // The panel switched its mode or citation layout and needs fresh content.
  // (Saving the outgoing view's scroll position is the panel's job.)
  function onRenderMode() {
    if (!current) return;
    renderActiveMode();
  }

  async function renderTranslation() {
    const e = await loadEnabled();
    // The user can toggle to Citations while that resolves; mounting a
    // translation view now would paint over the citations they asked for.
    if (panel.effectiveMode() !== 'translation') return;
    const list = texts = textsForChapter(current, e);
    if (!list.length) {
      // Nothing left to show, so nothing in flight may land here either: a load
      // started for a row that has just gone would paint over this state (and
      // be cached under its key).
      ++reqToken;
      clearTimeout(retryTimer);
      activeId = null;
      syncSplit();
      panel.populateTranslations([], '');
      // Not a chapter — the panel won't re-mount these states anyway.
      return panel.showView({ name: 'translation', key: 'no-translations', render: () => {
        if (e.provider === C.PROVIDER_APIBIBLE && !e.hasKey) panel.showTranslation({ kind: 'nokey' });
        else panel.showTranslation({ kind: 'error', message: 'No translations enabled yet. Open settings (⚙) to choose.', retry: false });
      } });
    }
    if (!selectionLoaded) {
      const stored = await getStored(SELECTION_KEY);
      if (!selectedId) selectedId = typeof stored === 'string' ? stored : null;
      selectionLoaded = true;
    }
    activeId = churchText.pickText(list, [selectedId, e.defaultId]);
    panel.populateTranslations(list, activeId);
    syncSplit();
    // Same chapter and same version -> the panel re-mounts what it has, and
    // loadChapter never runs.
    return panel.showView({ name: 'translation', key: transKey(), render: () => loadChapter() });
  }

  function transKey() {
    return current ? `${citKey(current)}::${activeId}` : null;
  }

  function citKey(parsed) {
    return `${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}`;
  }

  function renderCitations(parsed, focusVerse) {
    const view = panel.citationView();
    // The layout (and any focus verse) is part of the content's identity, so
    // flipping By source / By verse rebuilds while a plain toggle re-mounts.
    const key = `${citKey(parsed)}::${view}${focusVerse ? '::v' + focusVerse : ''}`;
    return panel.showView({
      name: 'citations',
      key,
      render: (host) => citPanel.render(host, {
        slug: parsed.ldsBook,
        chapter: parsed.chapter,
        fullName: BOOKS.bookFullName(parsed.ldsBook) || parsed.ldsBook,
        focusVerse,
        onOpenTalk: openTalk,
        view,
      }),
    });
  }

  // The talk reader is a view like the others — which is what makes "‹ Back"
  // land on the citation list exactly where it was left. It is never cached:
  // each open re-fetches and re-attaches its own highlights and Esc handler.
  function openTalk(entry) {
    return panel.showView({
      name: 'talk',
      key: `${entry.talkId}#${entry.citId}`,
      cache: false,
      render: (host) => talkView.open(host, {
        entry,
        source: entry.source || {},
        onBack: () => renderCitations(current),
        autoScroll: scrollToSnippet,
      }),
    });
  }

  async function loadChapter() {
    clearTimeout(retryTimer);
    // A stale caller (rate-limit retry timer, translation change) must not
    // paint a translation spinner over a mounted citations view.
    if (panel.effectiveMode() !== 'translation') return;
    const parsed = current;
    const tr = findTranslation(activeId);
    if (!parsed || !tr) return;
    const label = tr.abbr || tr.name;
    panel.showTranslation({ kind: 'loading', label });

    const myToken = ++reqToken;
    if (tr.provider === churchText.PROVIDER) return loadChurchChapter(parsed, tr, label, myToken);
    const chapterId = detect.toUsfmChapterId(parsed);
    const res = await send({
      type: C.MSG.GET_CHAPTER,
      provider: tr.provider,
      bibleId: tr.id,
      chapterId,
      ldsBook: parsed.ldsBook,
      chapter: parsed.chapter,
    });
    if (myToken !== reqToken) return; // user navigated/switched in the meantime
    if (panel.effectiveMode() !== 'translation') return; // user toggled to citations mid-load

    if (!res || res.error) {
      handleError((res && res.error) || { code: C.ERR.UNKNOWN }, label);
      return;
    }
    panel.showTranslation({
      kind: 'content',
      blocks: res.blocks,
      copyright: res.copyright || tr.copyright || '',
      reference: res.reference || refLabel(parsed),
    });
    if (res.fums) fireFums(res.fums);
  }

  // A Church-language chapter comes straight from the site (same origin), so
  // it skips the worker, the key, the rate limiter and FUMS. Split into the
  // page (syncSplit), the panel only says so — or why it couldn't.
  async function loadChurchChapter(parsed, tr, label, myToken) {
    const res = await churchText.load(parsed, tr.lang);
    if (myToken !== reqToken) return; // user navigated/switched in the meantime
    if (panel.effectiveMode() !== 'translation') return; // user toggled to citations mid-load
    if (!res || res.error) {
      handleError((res && res.error) || { code: C.ERR.UNKNOWN }, label);
      return;
    }
    if (enabled && enabled.churchLanguageLayout !== 'panel') {
      panel.showTranslation({ kind: 'beside', label });
      return;
    }
    panel.showTranslation({
      kind: 'content',
      blocks: res.blocks,
      copyright: 'From churchofjesuschrist.org · © Intellectual Reserve, Inc.',
      reference: res.title || refLabel(parsed),
      lang: res.bcp47,
      dir: res.dir,
    });
  }

  function showError(message, retry) {
    panel.showTranslation({ kind: 'error', message, retry });
  }

  function handleError(error, label) {
    switch (error.code) {
      case C.ERR.NO_KEY:
        panel.showTranslation({ kind: 'nokey' });
        break;
      case C.ERR.RATE_LIMITED: {
        const wait = Math.min(Math.max(error.retryAfterMs || 2000, 1000), 60000);
        showError(`Rate limited. Retrying in ${Math.ceil(wait / 1000)}s…`, false);
        retryTimer = setTimeout(loadChapter, wait);
        break;
      }
      case C.ERR.NOT_FOUND:
        showError(`${label} doesn’t have this chapter available.`, false);
        break;
      case C.ERR.INVALID_KEY:
        showError('Your API key was rejected. Open settings (⚙) to fix it.', false);
        break;
      case C.ERR.FORBIDDEN:
        showError(`Your key isn’t licensed for ${label}.`, false);
        break;
      case C.ERR.NETWORK:
        showError('Network error. Check your connection.');
        break;
      default:
        showError('Could not load this chapter.');
    }
  }

  // Best-effort FUMS usage tracking (api.bible terms). Injected into the page
  // world; silently degrades if the site CSP blocks it.
  function fireFums(fums) {
    try {
      if (fums.include) {
        const s = document.createElement('script');
        s.src = fums.include;
        s.async = true;
        (document.head || document.documentElement).appendChild(s);
      }
      if (fums.js) {
        const s2 = document.createElement('script');
        s2.textContent = fums.js;
        (document.head || document.documentElement).appendChild(s2);
        s2.remove();
      }
    } catch (e) { /* ignore */ }
  }

  // ---- Wire up ----
  async function init() {
    await panel.init({
      renderMode: onRenderMode,
      onTranslationChange: (id) => {
        selectedId = id;
        storeSelection(id);
        // Another version is different content: re-enter the view so it gets
        // its own cache key rather than overwriting the mounted one.
        if (panel.effectiveMode() === 'translation') renderTranslation();
      },
      onRetry: () => loadChapter(),
      onGear: () => send({ type: C.MSG.OPEN_OPTIONS }),
      onClose: () => { userClosed = true; panel.hide(); syncSplit(); },
    });

    scrollToSnippet = (await SETTINGS.get()).scrollToSnippet;

    // Hand the theme module the panel root (null while there's nothing shown);
    // it owns applying, aligning and re-applying from here on.
    themeMirror = theme.mirror(() => (current && !userClosed ? panel.getRootEl() : null));

    detect.setupNavigation(() => render());

    // Settings changed (options page, or another tab) -> adopt what's ours, and
    // re-render only when it wasn't our own write and something the panel
    // doesn't own by itself moved.
    SETTINGS.subscribe(({ next, changed, own }) => {
      scrollToSnippet = next.scrollToSnippet;
      if (own) return; // we already rendered the change that caused this write
      if (!changed.some((k) => !PANEL_KEYS.includes(k))) return;
      enabled = null;
      currentKey = null; // force a re-render with the new settings
      if (current) render();
    });

    // Toolbar icon toggles the panel.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === C.MSG.TOGGLE_PANEL) {
        userClosed = !userClosed;
        if (userClosed) {
          panel.hide();
          syncSplit();
        } else {
          currentKey = null; // force re-render after re-opening
          render();
        }
      }
    });

    render();
  }

  init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
