# CLAUDE.md

Guidance for working in this repo. Read this first. Domain terms (cite, talk,
corpus, source type, anchor verse, snippet, view, page-synced, …) are defined in
**`CONTEXT.md`** — use its vocabulary. Hard-to-reverse decisions live in
**`docs/adr/`**; check them before proposing structural changes.

## What this is

A **Manifest V3 Chrome extension** (personal, load-unpacked) that augments the
reader on `churchofjesuschrist.org/study` for any standard-works chapter. One
side panel, two modes:

1. **Translation** — the same chapter in another version: on the Bible from
   **scripture.api.bible** with the user's own key (NIV, NKJV, …), and on any
   standard work in a **Church language** (Spanish, Japanese, …) fetched from
   the site's own content endpoint. A Church language is split into the page
   beside the English by default (the **page split**), not shown in the panel.
2. **Citations** (all standard works) — which talks cite each verse (BYU
   Scripture Citation Index data), in two citation layouts (by verse / by
   source). Talks open inline; the reader supports local highlights.

The panel mirrors the site's theme/font/size, scroll-syncs in Translation
mode, and has configurable width. Personal use only — api.bible + BYU/Church
content are not redistributable, so **never** the Chrome Web Store (ADR-0003).

## Hard rules

- **No build step for the extension.** Plain HTML/CSS/JS, loaded unpacked
  (ADR-0002).
- **Module pattern:** every JS file is an IIFE attaching to the single global
  `__BTX.<name>` (plus `module.exports` for Node validators). The service
  worker stays a *classic* worker (`importScripts`). Content scripts are listed
  in dependency order in `manifest.json`; `options.html` loads shared files
  (and the worker's `cache.js`, to paint the cached version list) via
  `<script src>` first.
- **No secrets/CORS in content scripts.** All api.bible calls go through the
  **service worker**. The citation feature and Church-language text are
  content-script-only (static web-accessible data + same-origin site fetches,
  `credentials: 'omit'`).
- **The site's reader is React's:** only `__BTX.pageSplit` writes into it, and
  only through its layer, id-scoped `<style>` rules and `data-btx-split` on
  `<html>` (ADR-0007).
- **Safe rendering:** never `innerHTML` untrusted text. Translations render
  from IR via `src/content/sanitize.js`; fetched talk HTML goes through the
  allowlist sanitizer in `src/citations/talk-view.js`.
- **Theme/DOM hooks are class-name-agnostic** — read computed styles / stable
  hooks; the site's classes are hashed (ADR-0005).
- **Highlights stay local** — `chrome.storage.local`, never the Church
  account or sync storage (ADR-0004).
- **Settings go through `__BTX.settings`** — never `chrome.storage.sync`
  directly (`validate-settings.js` enforces this).
- **Docs are written for agents.** Before creating or editing `CLAUDE.md`,
  `CONTEXT.md`, anything under `docs/`, or a module header comment, load
  `/mattpocock-skills:writing-for-agents` and apply it.

## Layout

One line per module: global name + what it owns. Each file's header comment is
its interface doc — read that before its body.

```
manifest.json              MV3 (v0.1.0); content_scripts order matters
src/
  shared/constants.js      __BTX.const     message types, storage keys, API bases, limits
  shared/settings.js       __BTX.settings  THE owner of synced `btxSettings`: schema, one normalizer per key, get/patch/replace, subscribe({next,prev,changed,own})
  shared/books.js          __BTX.books     66 Bible (slug→USFM/name) + BoM/D&C/PGP registry
  background/
    service-worker.js      classic worker; importScripts; onMessage router (OPEN_OPTIONS {section} → storage.session); toolbar icon = TOGGLE_PANEL, else opens options; install opens options
    api.js                 __BTX.api       api.bible fetch + JSON→IR (403 "Invalid API key" → INVALID_KEY; 429 → remote + retryAfterMs; partial version lists); bible-api.com fallback
    cache.js               __BTX.cache     chapter cache + LRU; version list keyed by a key fingerprint, 7-day TTL (storage.local; the options page reads it too)
    ratelimit.js           __BTX.rate      15/30s + 5000/day, persisted
  content/
    church-text.js         __BTX.churchText which texts a chapter offers + which shows (textsFor/pickText); dropdown rows (labelFor/menuFor); setup-card list (languagesToAdd); pick memory (mruFrom/rememberPick); same-origin Church-language chapter → IR with element ids (chapterFrom; its block walk blockElements also reads the English side for the split)
    page-split.js/.css     __BTX.pageSplit show/hide the page split (columns | interlinear), paired by element id; pure cores wantsSplit / fitWidth / effectiveLayout / groupRows / soloIds / rowRules / readingRight / collapseFits
    detect.js              __BTX.detect    URL parse (all standard works, isBible) + SPA nav
    page-hook.js           page-world history patch, injected via web-accessible <script src>
    theme.js               __BTX.theme     mirror(resolveTarget) → {refresh}: site colors/fonts/header onto the panel; pure policies nextAlignDelay / dominantTextStyle / sameVars
    sanitize.js            __BTX.sanitize  IR → DOM (text nodes only)
    panel.js               __BTX.panel     deep module: panel state (mode/layout/collapsed/width, translatable, the visit's Translation override) + its persistence, DOM (setup / beside cards included), scroll-sync, drag-resize, AND the view host; pure cores exported for Node
    panel.css
    content.js             orchestrator: detect → worker/citations → panel content only (no panel state, no theme policy)
  citations/
    cit-data.js            __BTX.citData   shards/sources/gunzip talks; chapterData(slug,chap) clips each cite's verses to its own `v` (pure citedVerses/chapterIndex)
    cit-view-model.js      __BTX.citVM     PURE: chapter cites → descriptor tree; every ordering/grouping/counting/label rule; toolbar state machine
    cit-panel.js           __BTX.citPanel  DOM adapter over citVM: render(host, opts) / refocus() / markVerse(v) / revealVerse(v); reads verse excerpts from the page (read-only)
    highlights.js          __BTX.highlights local select-to-highlight in the reader
    talk-source.js         __BTX.talkSource load({entry,source}) → {html,url,findTarget}; CORPUS_PLANS table + snippet fallback (snippetKey); pre-2013 GC URL repair; 15s live timeout
    talk-view.js           __BTX.talkView  inline reader: sanitizer, render, highlights, sticky header; one Esc listener on #btx-root (highlight menu first, then Back)
    citations.css
    data/                  GENERATED, committed, shipped (~62 MB, ADR-0003): index.json, sources.json, citations/{slug}.json, talks/{talkId}.html.gz
  options/                 options.html/js/css — three autosaving cards whose ids are C.OPTIONS_SECTIONS (bible / languages / reading); pure form core exported for Node
icons/                     generated by tools/make-icons.js
tools/                     build-citation-data.js, rederive-js-snippets.js, make-icons.js, validate-*.js, test-talk-source.js
source-data/               GITIGNORED build input: the BYU DBs
```

## BYU data facts

- The BYU DBs: `core.53.db` (~44 MB index) + `content.53.db` (~54 MB zlib
  HTML), joined on `TalkID`. Gitignored; in git/LFS history at the "Add BYU
  citation index databases" commit (retrieval recipe in `.gitignore`).
- The build covers all five volumes: ~125.8k cites across 88 shards, verse-keyed
  (ADR-0001) — the ~0.22% of cites with no verse row aren't shown.
- Citation spans: `<span class="citation" id="{citId}">` in talk HTML;
  modern-GC paragraphs carry `uri=".../slug.p21"` deep-link anchors.
- **STPJS markup differs:** citation spans sit in a bottom footnote list
  (`<div class="footnote">N. <span class="citation">…</span></div>`) with body
  markers `<span class="footRef">N</span>`; `stpjsBodyPassage` derives the
  body passage from the matching `footRef`. JoD/GC carry inline spans.
- Some `citation_verse` rows file a cite under verses outside the cite's own
  `v` (5,671 rows / 1,366 cites, nearly all 2024 and 2026 talks). `chapterData`
  clips them at display time and `validate-citations` warns until the build
  skips them. Verse 1000 is a chapter's closing note (JS—H 1, one cite each on
  Malachi 4 and Revelation 22), labelled "Note".
- DB `book.Abbr` == our slug after space→hyphen; the one alias is D&C `sec` →
  `dc` (`ABBR_ALIAS` in the build).
- GC URL transform: `lds.org/ensign/...` →
  `churchofjesuschrist.org/study/ensign/...`; modern entries already store
  full church URLs.

## Build / test / verify

- **Load:** `chrome://extensions` → Developer mode → Load unpacked → repo root.
- **Translation:** on a fresh profile `nt/john/3` opens on Citations; its
  Translation tab shows the setup card. Paste an api.bible key under Bible
  translations in settings — it connects itself, turns on the versions added
  to the key, NIV default. Church languages: Add Español from the setup card
  on `bofm/alma/5` (or check it in settings) — the page splits (columns once
  the panel is collapsed, under each verse while it's too narrow); `ot/ps/23`
  shows poetry lines (Spanish) and furigana (Japanese). A version-list refresh
  costs ~39 api.bible calls against the owner's monthly quota — test with the
  cached list.
- **Citations:** toggle the panel to Citations; verse → source-type group →
  talk reads inline. Also on `bofm/alma/5`, `dc-testament/dc/76`,
  `pgp/moses/1`. In the reader, select text to highlight (click to remove).
- **Regenerate citation data** (BYU DBs in `source-data/`):
  ```
  node --experimental-sqlite tools/build-citation-data.js
  node tools/validate-citations.js
  ```
  `--inspect` first if DB formats may have changed. STPJS snippets alone (no
  DBs): `node tools/rederive-js-snippets.js`.
- **Checks — run all before finishing:** every `node tools/validate-*.js`
  plus `node --test tools/test-talk-source.js` (node:test, no deps); syntax:
  `node --check <file>`. Each validator names the module it covers.
- **Testability rule:** logic lives in a module's pure core (`module.exports`),
  the DOM shell stays thin — new ordering/grouping/label rules go in
  `cit-view-model.js` not `cit-panel.js`; mode/toggle/view-host rules in
  panel.js's pure cores; what an autosave may write (`commitPatch` /
  `translationPatch`) in options.js's pure core.

## Ownership rules

Who owns what. Mechanism and reasoning live in the module headers and their
validators — go there before changing behaviour.

- **Panel state** (`panelMode`, `panelCollapsed`, `citationView`,
  `sidebarWidth`) has one owner in the reader, `__BTX.panel`, persisted via
  `__BTX.settings`. `panel.HANDLED_KEYS` lists what the panel handles itself
  (incl. read-only `scrollSync`, and `fontScale`, which the toolbar's stepper
  also writes);
  `content.js` reads that list — its subscriber skips changes touching only
  those keys, and the panel fires `renderMode` when an external write stales
  its content. The old `chrome.storage.local` `btxPanelMode`/`btxPanelCollapsed`
  keys are migrated once by `panel.init` — nothing else may name them.
- **Options page** autosaves: every change is one `SETTINGS.patch` (never
  `replace`, so panel keys absent from the form survive), and it `subscribe`s
  so an open form adopts changes made elsewhere (`fillForm(changed)`, skipping
  `dirty` fields — changed on screen and not yet written: a slider mid-drag, a
  debounced write, a key being typed). A failed write puts its controls back
  to what storage holds; Try again re-sends every failed write. The api.bible
  key is saved only together with the list it unlocks, on a successful
  connect; Connect is disabled for the already-connected key and "Check for
  new translations" is the explicit refresh; a refresh only moves checkmarks
  or appends rows to "more" (`stableGroups`). Single-value fields live in one
  `FIELDS` table (the Church-language checklist is one row: its `change`
  events bubble to the container; the language search sits outside it).
- **Settings writes** carry a `__btxWrite` tag (how `own` is detected) and
  pass through unknown keys, so a newer version's setting on another machine
  isn't deleted. Sidebar width bounds (280–900) live only in `__BTX.settings`.
  All settings share one 8 KB sync item, so `enabledTranslations` rows are
  stored slim (`{id, abbr, name, provider, description}`, no copyright) and
  duplicate editions collapse to one in the normalizer.
- **View host** (`panel.showView({name,key,cache,render})`): same name + same
  key re-mounts the cached container, different key re-renders; one slot per
  name (`translation`, `citations`, `talk`). A new chapter drops them all; the
  same chapter shown again (a settings change) keeps `citations` and `talk`.
  A view *earns* its slot — spinner/error/empty render is never cached
  (`keepView`/`settleView`; the talk reader calls `panel.keepView(false)` on
  its error path). A citation-row click is a fresh talk open (its key carries
  an open counter); coming back to Citations re-shows the stored key, so the
  talk returns where it was left. The orchestrator names views and supplies
  keys; it holds no panel DOM.
- **Body scroll** has one writer: `panel.js`'s `writeBodyScroll` (via
  `setBodyScroll`). Views ask via `panel.scrollIntoView(target, {clearTop,
  frames})`; placement is the pure `revealTop`. Each view either owns its
  scroll or is page-synced (`viewRestoresScroll`); with `scrollSync` off
  nothing is page-synced. Tracking is 1:1 and instant; only re-alignment after
  a detached user scroll eases — the pure loop (`scrollStep`/`easeRamp`/
  `floorStep`/`carryScroll`/`realignmentDone`) and its constants are
  load-bearing and exercised by `validate-panel-state.js` with the real loop.
  `prefers-reduced-motion` is deliberately not consulted (panel matches the
  browser, not the OS). Call `refreshScrollSync` only where `wantsScrollSync`'s
  inputs move (`applyModeUI`, `applyCollapsedUI`, `hide`, `scrollSync` change).
- **Theme** (`theme.mirror`) owns capture/apply, the launch alignment backoff
  (`nextAlignDelay`, must terminate), which paragraph size to mirror
  (`dominantTextStyle` — most text by char count; a verse selector is the bug,
  #33/ADR-0005), and a `ResizeObserver` on the reading column for the site's
  font-size slider. An apply that changes nothing writes nothing (`sameVars`) —
  otherwise the observer loops. It samples reading text only — paragraphs
  under `nav, header, footer, aside, [role=navigation]` never count
  (`isReadingText`) — and `resolveReadingColumn` tries `main article` first.
  It mirrors two fonts: `--btx-font` (reading: translation text, talk reader)
  and `--btx-ui-font` (the site's body font: chrome, citation list).
  `resolveReadingContainer` is narrowest-first, on purpose. `content.js` only
  calls `refresh()` after `showChapter`.
- **Body text size** has two owners that compose in CSS: `theme.mirror` writes
  `--btx-size`/`--btx-line` (the site's size), the panel writes
  `--btx-size-scale` from `fontScale`, and `panel.css` multiplies them into
  `--btx-body-size`/`--btx-body-line`. Only body text reads those — chips,
  both chrome rows, cards and states stay fixed px, and the citation list's
  designed size ladder scales off the multiplier alone, not off the site.
  Panel-handled, never a re-render; a change keeps the reader's place
  (`keptScrollTop` through `setBodyScroll`). The clamp and step are
  `__BTX.settings`' normalizer (`applyFontScale` calls `normalize`, it does
  not re-clamp). Two editors: the options slider and the toolbar's A− / A+
  stepper, which writes through `persist` like every other panel setting.
  `stepFontScale` is one rule for both jobs — where a click lands, and
  (`null` = nowhere) which button is disabled. Two chrome rows — header
  (Translation | Citations, Settings, Collapse) and toolbar (the version
  dropdown or By source | By verse, then A− / A+): in each the one wide
  control yields (`flex: 1 1 auto; min-width: 0`) and the buttons stay fixed,
  so both fit at the 280px minimum width.
  `--btx-line` is **always a length** — `theme.lineHeightOf` states even
  `normal` in px — because multiplying a ratio would apply the scale twice.
- **Source-type marking** is a coloured strip on each source-type group, hue
  set once per `btx-grp-*` (`--btx-src`). No setting.
- **Translatable and the setup card**: a chapter is translatable when some
  enabled text offers it. On one that isn't, the panel opens on Citations;
  clicking Translation sets the pure core's per-visit override and shows the
  setup card (Add a Church language, or api.bible setup via
  `OPEN_OPTIONS {section}`). The override never rewrites `panelMode` — until
  the chapter becomes translatable under it, which commits `panelMode:
  'translation'`.
- **Page split** (`__BTX.pageSplit`) follows Translation mode: `content.js`'s
  `syncSplit` asks the pure `wantsSplit` wherever an input moves (mode, active
  row, chapter, whether the chapter shows at all, settings) and shows or
  hides; only a new chapter hides it first. `show`/`hide` take an `anchor`
  (`content.js` `splitAnchor`) so the paragraph at the top of the screen stays
  put. It mounts only once `article#main[data-uri]` is the chapter it loaded
  (the site swaps the whole article on navigation), and lays out again on
  resize of the article or page, on mutations inside the article, and when
  the site moves the reading column (polled — the footnote panel and the
  navigation drawer move it without a resize). The reading area ends at the
  site's footnote panel and its floating buttons. Columns give way to
  interlinear while each column would be under `MIN_COLUMN_PX`. The panel
  meanwhile shows the `beside` card: where the text is, the Side by side |
  Under each verse | In the panel control (writes `churchLanguageLayout`), and
  "Collapse panel for wider columns" when `collapseFits`. Collapsing the panel
  does not hide the split — it widens it.
- **Reader scroll targets by corpus** live in `CORPUS_PLANS`
  (`talk-source.js`). `findTarget` runs over the *rendered* talk, so it
  depends on talk-view's render contract: ids survive, classes come back
  `btxk-`-prefixed, footnotes carry `data-btx-footnum`, and the article's
  `textContent` stays exactly the source text (display additions are CSS
  generated content or wrapper spans; the byline and highlight hint sit
  outside the article). Every corpus falls back to the paragraph holding the
  cite's snippet when its plan's target is missing. The STPJS body-passage
  rule is stated twice (build vs reader) on purpose — ADR-0006.

## Gotchas

- Highlights anchor to the nearest `p`/`li`/`blockquote`/heading with an
  `id`, else the top-level block by index, + char offsets + quoted text. On
  re-apply a quote of 16+ characters that moved within its block is followed
  when it occurs there once; any other mismatch is skipped, not misplaced.
- Non-Bible URL segments (`bofm`, `dc-testament`, `pgp`) and
  `dc-testament/dc/{section}` are assumed from convention — confirm on a live
  page; `detect.parseLocation` gates on `BOOKS.isKnownBook`.
- SPA navigation is debounced via `currentKey` in `content.js`; panel-initiated
  changes arrive via `renderMode` instead. Reset `currentKey = null` to force a
  re-render.
- Citations filter: `citVM.filterPlan` decides what hides/opens and restores
  pre-filter open state on clear; `cit-panel` mirrors the plan onto
  `[data-btx-uid]` nodes via a capture-phase `toggle` listener.
- Talk reader header and open citation group headers are `position:sticky`
  inside their `.btx-view`; each sticky `top` and negative top margin must sum
  to zero (mechanism in the CSS comments; nested group headers offset by
  `--btx-vhead-h`); body padding literals live only in `#btx-root`'s
  `--btx-body-pad-top` / `--btx-body-pad-x`.
- The history hook loads `page-hook.js` via `chrome.runtime.getURL` (page CSP
  allow-lists our origin), not inline; the 750ms poll is the fallback.
- The panel pins to `top:0` and mirrors the site toolbar via `--btx-header-h`
  / `--btx-header-bg`; it stays put when the site header expands. Exception:
  while the site's header band, laid out for the full window (it re-lays out
  only on a real viewport resize), runs under the open panel, the panel starts
  below it (`--btx-top`, pure `panelTop`).
- Commits are unsigned (GitHub shows "Unverified"); author email
  `noreply@anthropic.com`. The git proxy port rotates — retry pushes; clear
  any stale `remote.origin.pushurl`.

## Agent skills

- **Issue tracker:** GitHub Issues on `danielbaldwin47/Translations-and-Citations`
  via `gh`. See `docs/agents/issue-tracker.md`.
- **Triage labels:** the five canonical roles, default strings. See
  `docs/agents/triage-labels.md`.
- **Domain docs:** single-context: `CONTEXT.md` + `docs/adr/`. See
  `docs/agents/domain.md`.
