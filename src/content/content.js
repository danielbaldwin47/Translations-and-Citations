/*
 * Orchestrator (content-script entry). Detection, worker messaging, and data
 * fetching — the panel owns its own state (mode, layout, collapsed, width) and
 * hosts the views (caching, scroll position):
 *  - watches SPA navigation and renders the matching chapter's content
 *  - points the theme module at the panel root (it owns keeping it in sync)
 *  - manages translation selection and hands the panel each Translation state
 *    (loading, rate-limit wait, error, setup card, beside card, text); the
 *    dropdown's rows and labels are __BTX.churchText's pure textsFor /
 *    menuFor, and the row shown is the arrangement's, walking a
 *    most-recently-used list (C.SELECTION_KEY in chrome.storage.local). The options page writes
 *    it too (a Church language ticked there leads) and this tab adopts that
 *    write through storage.onChanged
 *  - describes the chapter to the panel's arrangement (factsFor: the texts
 *    chapterOffer marked offered, the pick memory, the enabled languages, the
 *    split layout) wherever one of those moves, and applies its answer: the
 *    mode, body and note showing are the arrangement's, never decided here
 *  - applies the arrangement's note to the panel's note slot (applyNote, after
 *    every mode render and wherever the arrangement moves: it names the
 *    language and the chapter) and writes the no-translation line's dismissal
 *    (noTranslationLineDismissed) through __BTX.settings
 *  - runs the chapter check (runCheck over churchText.chapterOffer) while the
 *    arrangement answers `loading`, then arranges again; once the
 *    Translation tab settles, checks the languages left (checkRest) so the
 *    dropdown drops rows lacking the chapter. A rate-limited
 *    load waits and retries only as panel.retryWait allows, counting its
 *    automatic retries per chapter and version
 *  - writes the cards' picks through __BTX.settings (a Church language added
 *    from the setup card, the layout control's layout) and renders them
 *    itself, since its settings subscriber skips its own writes; a layout
 *    pick that names a row (the panel's layoutChoice) also goes to the front
 *    of the pick memory
 *  - keeps the page split (__BTX.pageSplit) on the arrangement's page's
 *    language, in either mode (syncSplit), running the chapter check for it
 *    when the arrangement names one unchecked (`pageNext`), in Citations too,
 *    without holding up the panel body; a new chapter drops the split, a
 *    same-chapter re-render keeps it unless what it shows changed, and
 *    bringing it or taking it away keeps the paragraph at the top of the
 *    screen in place
 *  - Citations: builds the list opened at the verse being read (readingVerse:
 *    only in the article of the chapter being rendered, read before the split
 *    comes or goes), moves that verse's mark as the page scrolls (citPanel.markVerse,
 *    By verse only), and brings a list re-mounted by a mode switch to that
 *    verse when the reader has moved on (citPanel.revealVerse). An open talk
 *    (openEntry) survives a trip to Translation under its stored view key; a
 *    click on a citation row opens it afresh (a numbered key). Back returns
 *    focus to the row it came from (citPanel.refocus)
 *  - answers the panel's renderMode event with fresh mode content
 *  - answers the toolbar icon (TOGGLE_PANEL): collapse or expand the panel; on
 *    a chapter the language preference hides, show it for this tab instead.
 *    The reply's `shown` says whether a chapter shows (false: the worker
 *    opens the options page)
 *  - asks the worker to open the options page, at a card when one is named
 *    (OPEN_OPTIONS { section: 'bible' })
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

  // Settings the panel reacts to by itself (owning some, e.g. panelMode, and
  // applying others, e.g. sidebarWidth). A change touching only these never
  // needs the orchestrator's full re-render — the panel adopts it and fires
  // renderMode when it made the mounted content stale. The list belongs to the panel; we
  // read it rather than keeping a copy that could drift.
  const PANEL_KEYS = panel.HANDLED_KEYS;

  let enabled = null; // { translations, churchLanguages, churchLanguageLayout, defaultId, provider, hasKey }
  // What the reader last picked, newest first (persisted under C.SELECTION_KEY).
  // A preference, not what is showing: a chapter that doesn't offer the newest
  // pick shows the newest one it does, or a fallback, and rewrites nothing —
  // see pickText.
  let mru = [];
  let selectionRead = null; // the stored list, merged in once (loadSelection)
  let texts = []; // the rows the current chapter may show: textsFor, minus those the chapter check found lacking it
  let activeId = null; // the row showing now (chapterOffer's pick)
  // The chapter check: the churchText.checkKeys whose check failed (network,
  // not "not available") for the chapter showing, so a pass doesn't re-ask
  // them; cleared with each new chapter. "Found" and "not available" live in
  // churchText for the tab.
  let failedChecks = new Set();
  let transToken = 0; // numbers each renderTranslation, so a stale one stops
  let splitToken = 0; // guards the page split against stale chapter loads
  let current = null; // parsed location
  let reqToken = 0; // guards against stale responses
  let retryTimer = null;
  // Automatic rate-limit retries in a row, per chapter and version (panel's
  // retryWait caps them): { key: transKey(), n }.
  let retries = { key: null, n: 0 };
  let themeMirror = null; // theme.mirror handle — the theme module keeps the panel in sync
  let currentKey = null; // dedupes repeat navigation events for the same chapter
  let shownChapter = null; // the chapter last shown (currentKey is reset to force a re-render)
  let arrangedKey = null; // the chapter the panel's arrangement describes (render's showChapter)
  // The talk open in Citations mode, re-opened when Citations comes back; the
  // list's layout when it was built (another layout asks for the list).
  let openEntry = null;
  let openKey = null; // its view key: a list click opens afresh, a re-show restores
  let talkOpens = 0; // numbers each fresh open, so its key never hits the cache
  let citViewShown = null;
  let markedVerse = null; // the verse the mounted By-verse list was last told about
  let revealedVerse = null; // the verse it was built opened at, or last revealed
  let markRaf = 0;

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

  // The book as the reader names a chapter of it: the site says "Psalm 23",
  // not "Psalms 23".
  function bookLabel(slug) {
    if (slug === 'ps') return 'Psalm';
    return BOOKS.bookFullName(slug) || slug;
  }

  function chapterLabel(parsed) {
    return `${bookLabel(parsed.ldsBook)} ${parsed.chapter}`;
  }

  // How a sentence names a text: an api.bible version by its abbreviation
  // ("NIV"), a Church language by its English name ("Spanish").
  function nameOf(tr) {
    if (!tr) return '';
    return tr.provider === churchText.PROVIDER ? tr.name : (tr.abbr || tr.name);
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

  // Where a Church language shows: 'columns' | 'interlinear' (in the page) or
  // 'panel'.
  function placement() {
    const l = enabled && enabled.churchLanguageLayout;
    return l === 'panel' || l === 'interlinear' ? l : 'columns';
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

  // ---- The chapter check ----------------------------------------------------
  // A Church language offers a chapter only once its chapter is fetched and
  // found (churchText.chapterOffer decides from the results so far). `rows`
  // are textsFor's. Ordered by the reader's picks: the check walks them as
  // pickText would and stops where its question is answered.
  function offerFor(parsed, rows) {
    const langs = rows.filter((r) => r.provider === churchText.PROVIDER).map((r) => r.lang);
    const results = churchText.checkResults(parsed, langs, failedChecks);
    return churchText.chapterOffer({ texts: rows, results, preferredIds: preferredIds() });
  }

  // The pick memory as both walks read it: the chapter check, and the panel's
  // arrangement (so they settle on the same row).
  function preferredIds() {
    return mru.concat(enabled ? enabled.defaultId : []);
  }

  // What the panel's arrangement needs to know about the chapter showing,
  // besides its own stored mode and this visit's click.
  function factsFor(e, offer) {
    return {
      texts: offer.texts, picks: preferredIds(), languages: e.churchLanguages, layout: placement(),
      dismissed: e.noTranslationLineDismissed === true,
    };
  }

  // A fact about the chapter showing moved (a pick, the layout, the
  // dismissal, a check): the panel arranges it again from what this tab knows,
  // fetching nothing.
  function rearrange() {
    return panel.arrange(factsFor(enabled, offerFor(current, textsForChapter(current, enabled))));
  }

  // The arrangement's note, handed to the panel's note slot with the
  // language's row and the chapter as the reader names it (the panel's
  // noteCopy words it), and the split layout the beside-the-page line's
  // Change control presses. The panel renders the line above the view it
  // belongs to and shows it only while that view is mounted, so this runs
  // after every mode render and wherever the arrangement moves (a render with
  // no note clears the slot).
  function applyNote() {
    const a = panel.arrangement();
    const row = a.note && current ? churchText.rowFor(a.noteLang) : null;
    if (!row) { panel.setNote(null); return; }
    panel.setNote({ kind: a.note, row, chapter: chapterLabel(current), layout: placement() });
  }

  // The line's ×: dismissed for good, on every computer (a synced setting).
  function dismissNote() {
    if (enabled) enabled = Object.assign({}, enabled, { noTranslationLineDismissed: true });
    SETTINGS.patch({ noTranslationLineDismissed: true });
    if (!current || !enabled) return;
    rearrange();
    applyNote();
  }

  // Fetch the language `question(offer)` names until it names none, then
  // resolve the offer. `stale()` true -> the reader moved on: resolves null.
  // Each fetch is churchText.load's, so the panel's text shares it, and a
  // language found lacking the chapter is never fetched for it again in this
  // tab.
  async function runCheck(parsed, rows, question, stale) {
    for (;;) {
      const offer = offerFor(parsed, rows);
      const lang = question(offer);
      if (!lang) return offer;
      const res = await churchText.load(parsed, lang);
      if (stale()) return null;
      if (!res || (res.error && res.error.code !== C.ERR.NOT_FOUND)) failedChecks.add(churchText.checkKey(parsed, lang));
    }
  }

  // The dropdown lists the languages the check hasn't reached. Once the
  // Translation tab has settled, ask the rest (chapterOffer's `unchecked`) so
  // a row lacking the chapter drops out of it. Each fetch is churchText.load's:
  // a pick of a row still being asked waits on the same request, and what is
  // learned is the tab's. A failed fetch leaves its row in, unchecked: a pick
  // asks again. `stale()`: renderTranslation's, true once another render
  // overtook the one that asked.
  async function checkRest(parsed, e, stale) {
    const rows = textsForChapter(parsed, e);
    const pending = offerFor(parsed, rows).unchecked;
    if (!pending.length) return;
    await Promise.all(pending.map((lang) => churchText.load(parsed, lang)));
    if (stale()) return; // another Translation render asks again, sharing these loads
    const offer = offerFor(parsed, rows);
    if (panel.arrange(factsFor(e, offer)).body === 'setup') return;
    texts = offer.texts.filter((t) => t.offered !== false);
    panel.populateTranslations(churchText.menuFor(texts, { isBible: parsed.isBible !== false }), activeId);
  }

  // The panel's brief loading state, while the check fetches.
  function showChecking() {
    return panel.showView({ name: 'translation', key: 'checking', render: () => panel.showTranslation({ kind: 'loading' }) });
  }

  // Merge the stored list in behind any pick made before it was read, once.
  function loadSelection() {
    if (!selectionRead) {
      selectionRead = getStored(C.SELECTION_KEY).then((stored) => {
        mru = churchText.mruFrom(mru.concat(churchText.mruFrom(stored)));
      });
    }
    return selectionRead;
  }

  // The pick counts at once; the write waits for the stored list, so a pick
  // made before anything was read (the setup card, on a tab that opened in
  // Citations) doesn't replace the reader's older picks.
  function remember(id) {
    mru = churchText.rememberPick(mru, id);
    loadSelection().then(() => {
      try { chrome.storage.local.set({ [C.SELECTION_KEY]: mru }); } catch (e) { /* ignore */ }
    });
  }

  async function render() {
    const parsed = detect.parseLocation(location.pathname, location.search);
    current = parsed;

    if (!parsed) {
      panel.hide();
      currentKey = null;
      shownChapter = null;
      openEntry = null;
      syncSplit();
      return;
    }

    // Skip spurious events (e.g. verse-anchor hashchange) for the same chapter.
    // Panel-initiated changes arrive via renderMode instead, bypassing this.
    const key = chapterKey(parsed);
    if (key === currentKey) return;
    currentKey = key;
    clearTimeout(retryTimer);
    if (key !== shownChapter) {
      // A talk stays open across a settings change, not across chapters.
      openEntry = null;
      failedChecks = new Set();
      // The split's per-id rules would land on the incoming chapter's
      // elements before its text arrives. (The same chapter again keeps it:
      // syncSplit replaces it only if the settings changed what it shows.)
      ++splitToken;
      pageSplit.hide();
    }
    shownChapter = key;

    const e = await loadEnabled();

    // The panel arranges itself from what is known so far (the chapter
    // check's results this tab): a text not checked yet in the way of the
    // pick is Translation's loading state, and renderTranslation runs the
    // check before anything else shows.
    await loadSelection();
    const offer = offerFor(parsed, textsForChapter(parsed, e));
    texts = offer.texts.filter((t) => t.offered !== false);
    panel.showChapter(Object.assign({ key }, factsFor(e, offer)));
    arrangedKey = key;
    if (themeMirror) themeMirror.refresh(); // the panel is on screen: theme it now

    await renderActiveMode();
  }

  // `reveal`: the panel switched mode, so a re-mounted By-verse list is
  // brought to the verse being read (a same-chapter settings change leaves
  // the list as it was).
  function renderActiveMode(opts) {
    if (!current) return undefined;
    const out = renderModeBody(opts);
    applyNote();
    return out;
  }

  function renderModeBody(opts) {
    if (panel.effectiveMode() === 'citations') {
      // Read before the split comes or goes: either reflows the page (and
      // keeps the reader's place on screen).
      const paragraph = readingParagraph();
      syncSplit({ anchor: splitAnchor() }); // the page's language stays; a new chapter's arrives
      // A talk left open comes back where it was left — unless the reader has
      // since picked another citation layout, which asks for the list.
      if (panel.citationView() !== citViewShown) openEntry = null;
      if (openEntry) return openTalk(openEntry);
      return renderCitations(current, { reading: verseOf(paragraph), reveal: !!(opts && opts.reveal) });
    }
    return renderTranslation();
  }

  function splitKey(parsed, row, layout) {
    return `${citKey(parsed)}|${row.lang}|${layout}`;
  }

  function chapterKey(parsed) {
    return `${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}/${parsed.lang}`;
  }

  // The page split shows the arrangement's page language, in either mode: the
  // first Church language in pick order that offers the chapter, while the
  // split layout is in-page. It goes when there is none, when the chapter
  // doesn't show (the page left). Called wherever one of those inputs moves; pageSplit.show is a
  // no-op for the key already showing. While a language in the way is not
  // checked yet (`pageNext`), the chapter check asks for it first — in
  // Citations too, where nothing else runs it; the panel's body never waits
  // on it. `anchor`: the paragraph to keep in place while the split comes or
  // goes (splitAnchor).
  async function syncSplit(opts) {
    const anchor = opts && opts.anchor;
    const token = ++splitToken;
    const parsed = current;
    const e = enabled;
    if (!parsed || !e) {
      pageSplit.hide({ anchor });
      return;
    }
    // render() hasn't described this chapter to the panel yet: it syncs
    // once it has (a new chapter dropped the split already).
    if (arrangedKey !== chapterKey(parsed)) return;
    let a = panel.arrangement();
    if (a.pageNext) {
      const stale = () => token !== splitToken || !current || chapterKey(current) !== chapterKey(parsed);
      const rows = textsForChapter(parsed, e);
      // Asked of the pure arrangement: nothing is stored until the check settles.
      const offer = await runCheck(parsed, rows, (o) => panel.arrangement(factsFor(e, o)).pageNext, stale);
      if (!offer) return;
      a = panel.arrange(factsFor(e, offer));
      applyNote(); // the page's language is known now: the line beside a Bible version names it
    }
    const row = a.page ? churchText.rowFor(a.page.slice(churchText.ID_PREFIX.length)) : null;
    const layout = placement();
    if (!pageSplit.wantsSplit({ visible: true, row, layout })) {
      pageSplit.hide({ anchor });
      return;
    }
    const key = splitKey(parsed, row, layout);
    if (pageSplit.currentKey() === key) return;
    const res = await churchText.load(parsed, row.lang);
    if (token !== splitToken) return;
    if (!res || res.error) { pageSplit.hide(); return; } // the panel card says why
    pageSplit.show({
      key,
      chapter: res,
      layout,
      uri: churchText.chapterUri(parsed),
      anchor,
      // What actually fits changes with the window and the panel: the card
      // standing in for the text says which one the page shows.
      onLayout: (fit) => panel.updateBeside(fit),
    });
  }

  // The panel switched its mode or citation layout and needs fresh content.
  // (Saving the outgoing view's scroll position is the panel's job.)
  function onRenderMode() {
    if (!current) return;
    renderActiveMode({ reveal: true });
  }

  async function renderTranslation() {
    const e = await loadEnabled();
    // The user can toggle to Citations while that resolves; mounting a
    // translation view now would paint over the citations they asked for.
    if (panel.effectiveMode() !== 'translation') return;
    await loadSelection();
    const token = ++transToken;
    const parsed = current;
    const stale = () => token !== transToken || current !== parsed || panel.effectiveMode() !== 'translation';
    if (stale()) return;
    const rows = textsForChapter(parsed, e);
    let offer = offerFor(parsed, rows);
    let shown = panel.arrange(factsFor(e, offer));
    if (shown.body === 'loading') {
      // The chapter check isn't done: the loading state, then what the
      // arrangement makes of its answer. A text still loading for the
      // previous pick must not land on the loading state.
      ++reqToken;
      clearTimeout(retryTimer);
      showChecking();
      offer = await runCheck(parsed, rows, (o) => o.next, stale);
      if (!offer) return;
      shown = panel.arrange(factsFor(e, offer));
    }
    applyNote(); // the beside-the-page line comes with a Bible version, goes with anything else
    // Nothing offers the chapter and Church languages are on: Citations.
    if (shown.mode !== 'translation') return renderActiveMode();
    const list = texts = offer.texts.filter((t) => t.offered !== false);
    if (shown.body === 'setup') {
      // Nothing left to show, so nothing in flight may land here either: a load
      // started for a row that has just gone would paint over this state (and
      // be cached under its key).
      ++reqToken;
      clearTimeout(retryTimer);
      activeId = null;
      syncSplit();
      panel.populateTranslations([], '');
      // Nothing offers the chapter, and the arrangement says the setup card
      // (never cached — the panel re-renders it every time).
      const bible = current.isBible === false ? null
        : (e.hasKey ? 'noversions' : 'nokey');
      return panel.showView({ name: 'translation', key: 'setup', render: () => {
        panel.showTranslation({
          kind: 'setup',
          chapter: chapterLabel(current),
          bible,
          languages: churchText.languagesToAdd({
            collection: current.collection,
            pageLang: current.lang,
            enabled: e.churchLanguages,
          }),
        });
      } });
    }
    activeId = shown.text;
    panel.populateTranslations(churchText.menuFor(list, { isBible: current.isBible !== false }), activeId);
    syncSplit({ anchor: splitAnchor() }); // another version may bring the split or take it away
    checkRest(parsed, e, stale);
    // Same chapter and same version -> the panel re-mounts what it has, and
    // loadChapter never runs.
    return panel.showView({ name: 'translation', key: transKey(), render: () => loadChapter() });
  }

  // A Church language in the page and the same one in the panel are different
  // views: the one shows a card, the other the text.
  function transKey() {
    if (!current) return null;
    const row = findTranslation(activeId);
    const where = row && row.provider === churchText.PROVIDER ? (panel.arrangement().body === 'beside' ? '::page' : '::panel') : '';
    return `${citKey(current)}::${activeId}${where}`;
  }

  function citKey(parsed) {
    return `${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}`;
  }

  // ---- Citations: where the reader is on the page -------------------------
  // The verse being read is the first verse paragraph still visible below the
  // site's sticky header (read-only: rects and computed styles, no writes).
  // By verse opens at it, and its outline follows the page's scroll.

  function stickyBottom(article) {
    const r = article.getBoundingClientRect();
    let n = document.elementFromPoint(r.left + r.width / 2, 1);
    for (; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'sticky' || pos === 'fixed') return Math.max(0, n.getBoundingClientRect().bottom);
    }
    return 0;
  }

  // The site's article, only while it is the chapter being rendered: right
  // after an in-app navigation the site still shows the previous chapter's.
  function chapterArticle() {
    const article = document.getElementById('main');
    if (!article || !current || article.getAttribute('data-uri') !== churchText.chapterUri(current)) return null;
    return article;
  }

  function readingParagraph() {
    const article = chapterArticle();
    if (!article) return null;
    const top = stickyBottom(article);
    for (const p of article.querySelectorAll('p[id^="p"]')) {
      if (/^p\d+/.test(p.id) && p.getBoundingClientRect().bottom > top) return p;
    }
    return null;
  }

  // What the page split keeps in place while it comes or goes: the first of
  // the chapter's paragraphs (heading and summary included) at least half on
  // screen below the site's sticky header. Not the reading verse: a verse
  // whose last line barely shows would push everything the reader sees down
  // as it grows. At the top of the page, the top stays the top.
  function splitAnchor() {
    const article = chapterArticle();
    if (!article) return null;
    const top = stickyBottom(article);
    for (const p of article.querySelectorAll('p[id]')) {
      const r = p.getBoundingClientRect();
      if ((r.top + r.bottom) / 2 > top) return p;
    }
    return null;
  }

  function verseOf(p) {
    const m = p && /^p(\d+)/.exec(p.id);
    return m ? Number(m[1]) : null;
  }

  function readingVerse() {
    return verseOf(readingParagraph());
  }

  function wantsVerseMarks() {
    return !!current && !openEntry && typeof citPanel.markVerse === 'function'
      && panel.effectiveMode() === 'citations' && panel.citationView() === 'verse';
  }

  // Tell the mounted By-verse list which verse is being read, when that moved.
  function markReading() {
    if (!wantsVerseMarks()) return;
    const v = readingVerse();
    if (v == null || v === markedVerse) return;
    markedVerse = v;
    citPanel.markVerse(v);
  }

  function onPageScroll() {
    if (markRaf || !wantsVerseMarks()) return;
    markRaf = requestAnimationFrame(() => { markRaf = 0; markReading(); });
  }

  // opts: { reading, reveal } — the verse being read, when the caller had to
  // read it early (renderActiveMode, before the split goes), and whether a
  // re-mounted list is brought to it (a mode switch; never Back).
  function renderCitations(parsed, opts) {
    const o = opts || {};
    const view = panel.citationView();
    citViewShown = view;
    // The layout is part of the content's identity, so flipping By source /
    // By verse rebuilds while a plain toggle re-mounts. Where the reader is
    // on the page is not: a re-mounted list is revealed at it (a mode switch
    // after the reader moved on) or only re-marked.
    const key = `${citKey(parsed)}::${view}`;
    const reading = 'reading' in o ? o.reading : readingVerse();
    let built = false;
    const out = panel.showView({
      name: 'citations',
      key,
      render: (host) => {
        built = true;
        markedVerse = reading;
        revealedVerse = reading;
        return citPanel.render(host, {
          slug: parsed.ldsBook,
          chapter: parsed.chapter,
          fullName: bookLabel(parsed.ldsBook),
          // At the top of the chapter there is nothing to open at.
          focusVerse: reading > 1 ? reading : undefined,
          onOpenTalk: (entry) => openTalk(entry, { fresh: true }),
          view,
        });
      },
    });
    if (built) return out;
    if (o.reveal && view === 'verse' && reading > 1 && reading !== revealedVerse && typeof citPanel.revealVerse === 'function') {
      revealedVerse = reading;
      markedVerse = reading;
      citPanel.revealVerse(reading);
    } else {
      markReading();
    }
    return out;
  }

  // The talk reader is a view like the others — which is what makes "‹ Back"
  // land on the citation list exactly where it was left, and a trip to
  // Translation and back land on the talk where it was left (the stored key,
  // so the panel re-mounts it at its scroll). A click on a citation row is a
  // fresh open (`fresh`): a key never used before, so the talk is built again,
  // revealed at the cite, with Back focused — even the talk just left. The
  // talk view marks a failed load not-worth-keeping itself.
  function openTalk(entry, opts) {
    if ((opts && opts.fresh) || !openKey || openEntry !== entry) {
      openKey = `${entry.talkId}#${entry.citId}#${++talkOpens}`;
    }
    openEntry = entry;
    return panel.showView({
      name: 'talk',
      key: openKey,
      render: (host) => talkView.open(host, {
        entry,
        source: entry.source || {},
        onBack: backToList,
      }),
    });
  }

  function backToList() {
    openEntry = null;
    openKey = null;
    if (!current) return;
    Promise.resolve(renderCitations(current, { reveal: false })).then(() => {
      if (typeof citPanel.refocus === 'function') citPanel.refocus();
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
    panel.showTranslation({ kind: 'loading', label: nameOf(tr) });

    const myToken = ++reqToken;
    if (tr.provider === churchText.PROVIDER) return loadChurchChapter(parsed, tr, myToken);
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
      handleError((res && res.error) || { code: C.ERR.UNKNOWN }, tr);
      return;
    }
    retries = { key: null, n: 0 };
    panel.showTranslation({
      kind: 'content',
      blocks: res.blocks,
      copyright: res.copyright || tr.copyright || '',
    });
  }

  // A Church-language chapter comes straight from the site (same origin), so
  // it skips the worker, the key, the rate limiter and api.bible's usage
  // report. Split into the page (syncSplit), the panel only says so — or why
  // it couldn't.
  async function loadChurchChapter(parsed, tr, myToken) {
    const res = await churchText.load(parsed, tr.lang);
    if (myToken !== reqToken) return; // user navigated/switched in the meantime
    if (panel.effectiveMode() !== 'translation') return; // user toggled to citations mid-load
    if (!res || res.error) {
      handleError((res && res.error) || { code: C.ERR.UNKNOWN }, tr);
      return;
    }
    const layout = placement();
    // A Try again that worked where the chapter check failed: the language
    // offers the chapter now, and may hold the page.
    const arranged = failedChecks.has(churchText.checkKey(parsed, tr.lang)) ? rearrange() : panel.arrangement();
    if (arranged.body === 'beside') {
      // The split's own load may have failed where this one (a Try again)
      // worked: ask for it again, or the card would say the text is on the
      // page when it isn't. A no-op while it is showing.
      syncSplit();
      const fit = pageSplit.currentKey() === splitKey(parsed, tr, layout) ? pageSplit.currentLayout() : null;
      panel.showTranslation(Object.assign({ kind: 'beside', name: nameOf(tr), layout }, fit));
      return;
    }
    panel.showTranslation({
      kind: 'content',
      blocks: res.blocks,
      copyright: 'From churchofjesuschrist.org · © Intellectual Reserve, Inc.',
      lang: res.bcp47,
      dir: res.dir,
      besideLink: true,
    });
  }

  function handleError(error, tr) {
    // A short, stated rate-limit wait is not an error to the reader: a wait,
    // with a countdown to the retry — a few times at most (panel.retryWait).
    const key = transKey();
    if (retries.key !== key) retries = { key, n: 0 };
    const wait = panel.retryWait(error, retries.n);
    if (wait !== null) {
      retries.n += 1;
      panel.showTranslation({ kind: 'waiting', seconds: Math.ceil(wait / 1000) });
      retryTimer = setTimeout(loadChapter, wait);
      return;
    }
    panel.showTranslation({
      kind: 'error',
      code: error.code,
      name: nameOf(tr),
      chapter: current ? chapterLabel(current) : '',
      church: tr.provider === churchText.PROVIDER,
      alternatives: texts.length > 1,
      remote: error.remote === true,
      retryAfterMs: error.retryAfterMs,
    });
  }

  // ---- The cards' picks ------------------------------------------------------
  // Both write a setting through __BTX.settings and then render the change
  // here: the settings subscriber below skips this context's own writes.

  // The setup card's "Add a Church language": turn it on, make it the pick,
  // and show the chapter with it at once (the split appears straight away).
  async function addLanguage(code) {
    const s = await SETTINGS.get();
    const next = await SETTINGS.patch({ churchLanguages: s.churchLanguages.concat(code) });
    // The worker's copy of the settings may not have caught up yet.
    if (enabled) enabled = Object.assign({}, enabled, { churchLanguages: next.churchLanguages });
    remember(churchText.ID_PREFIX + code);
    currentKey = null; // same chapter, now translatable
    render();
  }

  // The layout control: on the beside card, in the beside-the-page line's
  // place (its Change), and above a language read in the panel (the way back
  // into the page). `pick` is the row the choice makes the pick (the panel's
  // layoutChoice): "In the panel" from the line moves the page's language
  // into the panel in the Bible version's place, so it leads the pick memory
  // and the dropdown selects it. Between the two in-page layouts only the
  // split, the card and the line's control move; into or out of the panel,
  // the view itself changes.
  function changeLayout(layout, pick) {
    const before = placement();
    if (enabled) enabled = Object.assign({}, enabled, { churchLanguageLayout: layout });
    const after = placement();
    SETTINGS.patch({ churchLanguageLayout: layout });
    if (!current || panel.effectiveMode() !== 'translation' || after === before) return;
    if (pick) remember(pick);
    if (before !== 'panel' && after !== 'panel') {
      // The layout is one of the arrangement's facts (the page's language
      // needs an in-page one).
      rearrange();
      panel.updateBeside({ layout: after });
      applyNote();
      syncSplit({ anchor: splitAnchor() });
    } else {
      renderTranslation();
    }
  }

  // No chapter on this page: nothing to show or hide. Otherwise the icon
  // collapses or expands the panel, on every page whatever its language.
  function onToolbarClick() {
    if (!current) return;
    panel.toggleCollapsed();
  }

  // ---- Wire up ----
  async function init() {
    await panel.init({
      renderMode: onRenderMode,
      onTranslationChange: (id) => {
        remember(id);
        // Another version is different content: re-enter the view so it gets
        // its own cache key rather than overwriting the mounted one.
        if (panel.effectiveMode() === 'translation') renderTranslation();
      },
      onRetry: () => { retries = { key: null, n: 0 }; loadChapter(); }, // the reader's own retry starts a fresh run
      onGear: (section) => send(section ? { type: C.MSG.OPEN_OPTIONS, section } : { type: C.MSG.OPEN_OPTIONS }),
      onAddLanguage: addLanguage,
      onLayoutChange: changeLayout,
      onDismissNote: dismissNote,
    });

    // Hand the theme module the panel root (null while there's nothing shown);
    // it owns applying, aligning and re-applying from here on.
    themeMirror = theme.mirror(() => (current ? panel.getRootEl() : null));

    // The reading layer fits the site's reading column to the space the open
    // panel leaves, in every mode, split or not (#89).
    pageSplit.start();

    detect.setupNavigation(() => render());
    window.addEventListener('scroll', onPageScroll, { passive: true });

    // Settings changed (options page, or another tab) -> adopt what's ours, and
    // re-render only when it wasn't our own write and something the panel
    // doesn't own by itself moved.
    SETTINGS.subscribe(({ changed, own }) => {
      if (own) return; // we already rendered the change that caused this write
      if (!changed.some((k) => !PANEL_KEYS.includes(k))) return;
      enabled = null;
      currentKey = null; // force a re-render with the new settings
      if (current) render();
    });

    // The options page put a ticked language first. It writes the pick memory
    // before the setting, so this lands before the re-render above.
    chrome.storage.onChanged.addListener((changes, area) => {
      const c = area === 'local' && changes[C.SELECTION_KEY];
      if (c) mru = churchText.mruFrom(c.newValue);
    });

    // The toolbar icon. Answered at once, so the worker can tell a tab with a
    // panel from one without (where it opens the options page instead).
    // `shown`: whether a chapter shows once the click is acted on — false on a
    // Gospel Library page with none, where the worker opens the options page.
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== C.MSG.TOGGLE_PANEL) return;
      sendResponse({ ok: true, shown: !!current });
      onToolbarClick();
    });

    render();
  }

  init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
