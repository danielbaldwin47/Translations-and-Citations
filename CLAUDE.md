# CLAUDE.md

Guidance for working in this repo. Read this first. Domain terms (cite, talk,
corpus, source type, anchor verse, snippet, view, page-synced, …) are defined in
**`GLOSSARY.md`** — use its vocabulary. Hard-to-reverse decisions live in
**`docs/adr/`**; check them before proposing structural changes.

## What this is

A **Manifest V3 Chrome extension** that augments the reader on
`churchofjesuschrist.org/study` for any standard-works chapter. One side
panel, two modes:

1. **Translation** — the same chapter in another version: on the Bible the
   bundled **World English Bible** (no key; the default while no api.bible
   version is on) or
   **api.bible** with the user's own key (NIV, NKJV, …), and on any
   standard work in a **Church language** (Spanish, Japanese, …) fetched from
   the site's own content endpoint. A Church language is split into the page
   beside the English by default (the **page split**), not shown in the panel.
2. **Citations** (all standard works) — which talks cite each verse (BYU
   Scripture Citation Index data), in two citation layouts (by verse / by
   source). Talks open inline; the reader supports local highlights.

The panel mirrors the site's theme/font/size, scroll-syncs in Translation
mode, and has configurable width. Two flavors, one codebase (ADR-0008): the
**public release** on the Chrome Web Store runs the committed public pack; the
**personal build** (load-unpacked) runs a private personal pack, the only home
of data without rights evidence. The release spec is issue #69; the Store
texts are `docs/store/listing.md`, the privacy policy `docs/privacy.md`.

## Hard rules

- **No build step for the extension.** Plain HTML/CSS/JS, loaded unpacked
  (ADR-0002).
- **Module pattern:** every JS file is an IIFE attaching to the single global
  `__BTX.<name>` (plus `module.exports` for Node validators). The service
  worker stays a *classic* worker (`importScripts`). Content scripts are listed
  in dependency order in `manifest.json`; `options.html` loads shared files,
  `church-text.js` (the pick memory a tick writes) and the worker's
  `cache.js` (to paint the cached version list) via `<script src>` first.
- **No secrets/CORS in content scripts.** All api.bible calls go through the
  **service worker**. The citation feature and Church-language text are
  content-script-only (static web-accessible data, same-origin site fetches,
  and BYU's talk fragments, which BYU serves to any origin by CORS; every
  fetch `credentials: 'omit'`).
- **Packaged code only** (Web Store remote-code rule): every script that runs
  ships in the zip. api.bible usage reporting is the worker's HTTP GET
  (`fums.js`), never a script on the page (`validate-service-worker.js`).
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
- **Docs are written for agents.** Before creating or editing anything an
  agent will read as instructions — `CLAUDE.md`, `GLOSSARY.md`, anything under
  `docs/`, a module header comment, or an issue an agent works from (a spec, a
  wayfinder ticket, a `ready-for-agent` issue) — load
  `/mattpocock-skills:writing-for-agents` and apply it.

## Layout

One line per module: global name + what it owns. Each file's header comment is
its interface doc — read that before its body.

```
manifest.json              MV3 (v1.0.0); content_scripts order matters; tools/validate-manifest.js checks it, docs/store/listing.md and docs/privacy.md
src/
  shared/constants.js      __BTX.const     message types, storage keys, API bases, API_BIBLE_PAGES (sign-up, dashboard: the reader-facing links), limits, BUNDLED_BIBLE, DISCLOSURE (the two consent sentences), ABOUT (source lines, privacyUrl, supportUrl)
  shared/settings.js       __BTX.settings  THE owner of synced `btxSettings`: schema, one normalizer per key, get/patch/replace, subscribe({next,prev,changed,own})
  shared/books.js          __BTX.books     66 Bible (slug→USFM/name) + BoM/D&C/PGP registry
  shared/rate-copy.js      __BTX.rateCopy  the monthly-limit lines (pausedLine / nearLine), one copy for the panel and the options page
  background/
    service-worker.js      classic worker; importScripts; onMessage router (OPEN_OPTIONS {section} → storage.session; OPEN_WELCOME → the Alma 5 tab); toolbar icon = TOGGLE_PANEL, else opens options; install opens Alma 5 (`C.FIRST_RUN_URL`, through `openWelcome`, which OPEN_WELCOME shares), update marks the welcome seen
    api.js                 __BTX.api       api.bible fetch (host `rest.api.bible`, C.API_BIBLE_BASE) + JSON→IR (403 "Invalid API key" → INVALID_KEY; 429 → remote + retryAfterMs; partial version lists); fetchBundledChapter serves the World English Bible from src/bible/
    cache.js               __BTX.cache     chapter cache, LRU by last read; fewer than `C.CACHE_MAX_VERSES` (500) api.bible verses held (api.bible's terms; pure `versesIn` / `dropKeys`; an index record with no count drops first, the chapter just written never); version list keyed by a key fingerprint, 7-day TTL (storage.local; the options page reads it too)
    ratelimit.js           __BTX.rate      15/30s burst window + this browser's api.bible calls per calendar month, its writes serialized (no cap: only api.bible's 429 at or past 5,000, naming no short wait, pauses); pure answerOf / rateState ok/near/paused (near only below 5,000), attached as `rate` to every api.bible chapter and version-list answer
    fums.js                __BTX.fums      api.bible usage report (FUMS v3 GET) on every api.bible display, cache hits too; device id minted on a successful Connect (storage.local), session id per worker lifetime
  content/
    church-text.js         __BTX.churchText which texts a chapter offers + which shows (textsFor/pickText/pickOrder; the one walk firstOffered; the chapter check's chapterOffer over checkResults, keyed by checkKey; the page's language, pageLanguage); the toolbar's two menus (bibleMenu/languageMenu, labels labelFor, a lone language's name nameFor); setup-card list (languagesToAdd); pick memory (mruFrom/rememberPick; rememberTicked for a tick in settings; stored under C.SELECTION_KEY, written by content.js and the options page); same-origin Church-language chapter → IR with element ids (chapterFrom; its block walk blockElements also reads the English side for the split)
    page-split.js/.css     __BTX.pageSplit the reading layer, independent of the mode: start() fits the site's reading column to the open space while the panel is open (fitColumn / fitRule); show/hide the page split (columns | interlinear) while the arrangement names a page's language, paired by element id, headed by the Hide line (its click is show's onHide); pure cores wantsSplit / hideLineCopy / fitWidth / effectiveLayout / fitColumn / fitRule / groupRows / soloIds / rowRules / readingRight / readingEdges / collapseFits
    detect.js              __BTX.detect    URL parse (all standard works, isBible) + SPA nav
    page-hook.js           page-world history patch, injected via web-accessible <script src>
    theme.js               __BTX.theme     mirror(resolveTarget) → {refresh}: site colors/fonts/header onto the panel; pure policies nextAlignDelay / dominantTextStyle / sameVars
    sanitize.js            __BTX.sanitize  IR → DOM (text nodes only)
    panel.js               __BTX.panel     deep module: panel state (mode/layout/collapsed/width, the visit's mode click) + its persistence, the arrangement (what the body shows), DOM (setup / beside cards and the welcome included), scroll-sync, drag-resize, AND the view host; pure cores exported for Node
    panel.css
    content.js             orchestrator: detect → worker/citations → panel content only (no panel state, no theme policy)
  citations/
    cit-data.js            __BTX.citData   probes the pack once per session (personal dir, then public; the Store zip's stamp → public alone; pure packDirs/pickPack) → loadPack() {dir,descriptor}; shards/sources/gunzip talks; chapterData(slug,chap) carries the descriptor as `pack`, clips each cite's verses to its own `v` and ranks same-reference cites for the locator (pure citedVerses/chapterIndex/refRanks)
    cit-view-model.js      __BTX.citVM     PURE: chapter cites → descriptor tree; source types and their header notes from the pack descriptor; every ordering/grouping/counting/label rule; vintage footer; toolbar state machine
    cit-panel.js           __BTX.citPanel  DOM adapter over citVM: render(host, opts) / refocus() / markVerse(v) / revealVerse(v); reads verse text from the page (read-only); fetched row excerpts (observer on the panel body, exact-size reserve)
    highlights.js          __BTX.highlights local highlights in the reader: select to add (mouse-up or Shift key-up offers Highlight); one Tab stop per highlight, Enter opens Remove
    talk-source.js         __BTX.talkSource load({entry,source}) → {html,url,destination,credit,findTarget}; excerpt({entry,source}, claim) → paragraph text (read from the fetched HTML string: excerptAt / paragraphText, no DOM); pure corpusPlan(descriptor, corpus, {hasUrl}), readingDestination, talkCredit (by the descriptor's `text`/`attribution`, never a corpus letter: "Text from {publisher}" linking the talk — BYU Scripture Citation Index (its viewer), churchofjesuschrist.org, Wikisource (the permalink, title "Wikisource revision N")), BYU fragment/viewer URLs; footnote locator (locateParagraph, pure on fetched HTML), targetIds (span, then a J cite's page anchor) + snippet fallback (snippetKey); HTML scanning the build tools require (decodeEntities, scanTalk, scriptureLink, linkChapters' 'locate' vs 'derive' span rules, dropByuInsertions); pre-2013 GC URL repair; FETCH_POLICY (per-host slots, session talk cache, 15s timeout) + pure slotPolicy (which waiting fetch a free slot goes to)
    talk-view.js           __BTX.talkView  inline reader: sanitizer, render, markCite (tint the cited block, pin an empty target, scroll to the target; focus there from the keyboard), highlights, sticky header; one Esc listener on #btx-root (highlight menu first, then Back)
    citations.css
    data/                  GENERATED, committed, shipped: the public pack (~30 MB, ADR-0008): index.json (its `pack` is the pack descriptor), sources.json, citations/{slug}.json (G/E cites: no snippet, an excerpt count `ec`, `fn: true` on a footnote cite), talks/{talkId}.html.gz (J only, Wikisource text), jod-provenance.json
    data-personal/         GITIGNORED: the personal pack, same layout, descriptor flavor `personal` (build --pack personal)
    store-stamp.json       the Store stamp (GLOSSARY); read by cit-data.js, swapped in by build-store-zip
  bible/engwebp/           GENERATED, committed, shipped: the World English Bible as IR, {USFM}.json per book + index.json (archive SHA-256, download date); C.BUNDLED_BIBLE names it
  options/                 options.html/js/css — cards in the order of C.OPTIONS_SECTIONS: languages, bible, reading (autosaving), then About (text, plus one button, "Show the welcome again": it writes `welcomeSeen` false (`WELCOME_AGAIN`) and sends OPEN_WELCOME; aboutCopy stays text); the Church-language list is the pure languageList ("Your languages" = the enabled ones, then the coverage groups without them, each row's search match; languageTick: a tick or untick clears the search and names where focus goes); pure form core exported for Node
icons/                     generated by tools/make-icons.js
docs/                      adr/ (decisions), agents/ (issue-tracker, triage-labels, domain, pack-refresh checklist), store/listing.md (Store texts), privacy.md (the page C.ABOUT.privacyUrl publishes), research/
tools/                     build-citation-data.js (+ verbatim-matcher.js, inclusion rule verbatim; + footnote-cite.js, the footnote-cite rule it shares with derive-conference.js), fetch-jod-wikisource.js + build-jod-talks.js (+ jod-patches.json), derive-conference.js (derivation run), build-bible-data.js, build-store-zip.js, rederive-js-snippets.js, make-icons.js, validate-*.js, test-talk-source.js (+ mini-dom.js, its Node DOM); fixtures/base-talk-ids.json freezes base talk ids (A26)
source-data/               GITIGNORED build input, filled from the owner's private repo (recipe in .gitignore): the BYU DBs, engwebp_usfm.zip, scripture/ (verbatim matcher), the Wikisource snapshot (wikisource-jod.json), the J build (jod-talks/), derived/gc-YYYY-MM.json (derivation runs)
```

## BYU data facts

- The BYU DBs: `core.53.db` (~44 MB index) + `content.53.db` (~54 MB zlib
  HTML), joined on `TalkID`. Gitignored; held in the owner's private repo
  with the derivation inputs and the personal pack, and in this repo's LFS
  history at commit `0d154d7` (retrieval recipes in `.gitignore`). They are a
  **frozen base** (stamp `2026-05-18`): every later conference enters as
  derived cites from the Church's talk pages, never from a newer DB.
- The build covers all five volumes: ~125.8k BYU cites across 88 shards,
  verse-keyed (ADR-0001) — the ~0.22% of cites with no verse row aren't shown.
  The public pack holds 115,050 cites (no T; October 2026's 585 derived cites
  included) over 7,112 talks: 3,896 G, 1,821 E, 1,395 J (bundled).
- Citation spans: `<span class="citation" id="{citId}">` in talk HTML;
  modern-GC paragraphs carry `uri=".../slug.p21"` deep-link anchors.
- **STPJS markup differs:** citation spans sit in a bottom footnote list
  (`<div class="footnote">N. <span class="citation">…</span></div>`) with body
  markers `<span class="footRef">N</span>`; `stpjsBodyPassage` derives the
  body passage from the matching `footRef`. JoD/GC carry inline spans.
- **Journal of Discourses text is Wikisource's**, at pinned revisions: BYU's
  J HTML is an alignment input only (where each cite sits), never shipped.
  Each J cite has an empty marker span or, unaligned, its printed page's
  anchor `jdp-N`; the J source URL is the Wikisource permalink. Pipeline and
  patch file: `tools/build-jod-talks.js` header.
- Some `citation_verse` rows file a cite under verses outside the cite's own
  `v` (5,671 rows / 1,366 cites, nearly all 2024 and 2026 talks). `chapterData`
  clips them at display time and `validate-citations` warns until the build
  skips them. Verse 1000 is a chapter's closing note (JS—H 1, one cite each on
  Malachi 4 and Revelation 22), labelled "Note".
- DB `book.Abbr` == our slug after space→hyphen; the one alias is D&C `sec` →
  `dc` (`ABBR_ALIAS` in the build).
- GC URL transform (`toChurchUrl`): `lds.org/ensign/...` →
  `churchofjesuschrist.org/study/ensign/...`; modern entries already store
  full church URLs. The 30 April 2019 talks are stored as
  `lds.org/study/ensign/2019/05/{session}/{slug}` and become
  `.../study/ensign/2019/05/{slug}` (the session path redirects).
- The excerpt character count (`ec`, `excerptChars`) is the length of the
  text the row will show, read from `content.53.db` by the corpus's `text`:
  `live-byu` (E) calls the reader's own `talkSource.paragraphText` (BYU's
  labels and inlined footnotes dropped); `live-church` (G) predicts the
  Church paragraph — in-text references kept with their `ccontainer`
  punctuation, BYU's spacer and `sup.noteMarker` (number and note) dropped.
  Talk 2723 (1975) has no citation spans, so its cites carry no count.
- `fn` marks a footnote cite (GLOSSARY), decided in two steps:
  `inFootnote` finds the cite's first citation span in a note (the
  `sup.noteMarker` BYU inlines at a note marker, or the closing
  `footer.notes` list), then the rule in `tools/footnote-cite.js` reads that
  note and the paragraph around its marker. Only corpora whose descriptor
  entry has `footnoteFlag: true` carry it (G and E; BYU's E text has no
  notes, so E flags none). Modern talks put most references in notes, mostly
  bare references naming a quotation's source: of the public pack's 51,045 G
  cites, 25,010 sit in a note and 8,298 are footnote cites (8,063 BYU, 235
  derived). A derived cite carries the `fn` its derivation input gives:
  the rule needs the Church page's text, so it runs at fetch time. The
  reader does not read `fn` (GLOSSARY: Footnote cite).

## Build / test / verify

- **Load:** `chrome://extensions` → Developer mode → Load unpacked → repo root.
  Without `src/citations/data-personal/` this is the public release's data
  (the reader falls back to the public pack); with it, the personal build.
  README "Install" has both recipes.
- **Translation:** on a fresh profile `nt/john/3` opens in Translation with
  the World English Bible and its public-domain line. Settings' Bible
  translations card lists the api.bible setup steps; their links open
  api.bible's sign-up and dashboard pages with no redirect. Paste the key from
  the dashboard — it connects itself, turns on the versions added to the key,
  NIV default. Church languages: Add Español from the setup card
  on `bofm/alma/5` (or check it in settings) — the page splits (columns once
  the panel is collapsed, under each verse while it's too narrow); `ot/ps/23`
  shows poetry lines (Spanish) and furigana (Japanese). A version-list refresh
  costs ~39 api.bible calls against the owner's monthly quota — test with the
  cached list.
- **Citations:** toggle the panel to Citations; verse → source-type group →
  talk reads inline. Also on `bofm/alma/5`, `dc-testament/dc/76`,
  `pgp/moses/1`. In the reader, select text to highlight (click to remove); by
  keyboard, Tab to a highlight, Enter opens Remove, Enter removes.
- **Regenerate citation data** (BYU DBs in `source-data/`):
  ```
  node tools/fetch-jod-wikisource.js            # network; only to refresh the snapshot
  node --experimental-sqlite tools/build-jod-talks.js
  node --experimental-sqlite tools/build-citation-data.js
  node --experimental-sqlite tools/build-citation-data.js --pack personal
  node tools/validate-citations.js && node tools/validate-jod.js
  ```
  The J build feeds both packs. Then the public pack, then the personal pack (see
  "Pack descriptor" below); `validate-citations` checks each pack present
  against its own descriptor. `--inclusion E=verbatim,J=verbatim` sets a
  corpus's inclusion rule (the committed pack is `all`). Every build, and
  every derivation run, reads the public-domain scripture in
  `source-data/scripture/` (download recipe in the build tool's header; the
  footnote-cite rule needs it) and stops when it is missing; a `verbatim`
  build prints its coverage. Check a verbatim pack in a
  scratch dir: `--out <dir>`, then `validate-citations.js --dir <dir>`. `--inspect` first if DB
  formats may have changed. STPJS snippets alone (no DBs, personal pack):
  `node tools/rederive-js-snippets.js`. Both builds also merge the derived
  cites in `source-data/derived/` and print the diff report (`--report FILE`
  writes it). A new conference enters by a pack refresh: follow
  `docs/agents/pack-refresh.md`.
- **Store zip** (the Chrome Web Store upload, from the commit, never the
  working tree): commit, then `node tools/build-store-zip.js` writes
  `dist/translations-and-citations-{version}.zip`; `.gitattributes`
  `export-ignore` decides what is left out, and `validate-store-zip` checks it.
  The zip swaps in the Store stamp (mechanism: `build-store-zip.js` header).
- **Regenerate the bundled Bible** (`source-data/engwebp_usfm.zip` from
  ebible.org; the tool prints the download command when it is missing):
  `node tools/build-bible-data.js` then `node tools/validate-bible-data.js`,
  whose unaltered-text check runs only with the archive present. The text is
  never edited: changing it forfeits the name "World English Bible".
- **Checks — run all before finishing:** every `node tools/validate-*.js`
  plus `node --test tools/test-talk-source.js` (node:test, no deps); syntax:
  `node --check <file>`. Each validator names the module it covers. The
  release texts are checked too: `validate-manifest` reads
  `docs/store/listing.md` and `docs/privacy.md` against `manifest.json` and
  `C.ABOUT` (every manifest host is a named party in the policy), and
  `validate-options-form` holds the disclosure sentences to `C.DISCLOSURE`.
- **Testability rule:** logic lives in a module's pure core (`module.exports`),
  the DOM shell stays thin — new ordering/grouping/label rules go in
  `cit-view-model.js` not `cit-panel.js`; mode/toggle/view-host rules in
  panel.js's pure cores; what an autosave may write (`commitPatch` /
  `translationPatch`) in options.js's pure core.

## Ownership rules

Who owns what. Mechanism and reasoning live in the module headers and their
validators — go there before changing behaviour.

- **Panel state** (`panelMode`, `panelCollapsed`, `citationView`,
  `sidebarWidth`, `welcomeSeen`) has one owner in the reader, `__BTX.panel`, persisted via
  `__BTX.settings`. `panelMode` defaults to Citations in the settings
  normalizer (a missing or unreadable stored value falls there; a stored
  Translation stays), and the panel's `createState` fallback agrees. `panel.HANDLED_KEYS` lists what the panel handles itself
  (incl. read-only `scrollSync`, and `fontScale`, which the toolbar's stepper
  also writes);
  `content.js` reads that list — its subscriber skips changes touching only
  those keys, and the panel fires `renderMode` when an external write stales
  its content. The old `chrome.storage.local` `btxPanelMode`/`btxPanelCollapsed`
  keys are migrated once by `panel.init` — nothing else may name them.
  `welcomeSeen` (GLOSSARY: Welcome) is written true by the panel's Got it or
  Skip and by the worker on an update, and false by "Show the welcome again";
  when the welcome shows is the pure `welcomeDue`, what it says the steps
  table (`WELCOME_STEPS`, one step at a time through `welcomeStepView`), whose
  controls must be in the panel's `CONTROL_NAMES` and show in every mode.
- **Options page** autosaves: every change is one `SETTINGS.patch` (never
  `replace`, so panel keys absent from the form survive), and it `subscribe`s
  so an open form adopts changes made elsewhere (`fillForm(changed)`, skipping
  `dirty` fields — changed on screen and not yet written: a slider mid-drag, a
  debounced write, a key being typed). A failed write puts its controls back
  to what storage holds; Try again re-sends every failed write. The api.bible
  key is saved only together with the list it unlocks, on a successful
  connect; Connect is disabled for the already-connected key and "Check for
  new translations" is the explicit refresh; a refresh only moves checkmarks
  or appends rows to "more" (`stableGroups`). In a paused api.bible month the
  stored key stays connected (the paused line under it, `pausedNote`; the
  refresh rests aria-disabled), and a new key refused then is not saved
  (`keyErrorText` says when to try Connect again). Single-value fields live in one
  `FIELDS` table (the Church-language checklist is one row: its `change`
  events bubble to the container; the language search sits outside it). A
  newly ticked language also goes to the front of the pick memory
  (`chrome.storage.local`, `C.SELECTION_KEY`) through `churchText.rememberTicked`,
  written before the setting so open tabs have it by their re-render; the same
  tick writes `churchLanguageShown` on in the same patch (`commitPatch` given the
  stored languages as `before`; an untick never names it, and the form has no
  control for it). A tick or untick also clears the language search and keeps focus on that
  language's checkbox in its new place (`languageTick`; an untick opens the
  coverage group it returns to).
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
  (`null` = nowhere) which button is disabled. Chrome rows — header
  (Translation | Citations, Settings, Collapse); the toolbar's main row (the
  Bible version dropdown or By source | By verse, then A− / A+); and in
  Translation, while a language is ticked, the language row (GLOSSARY: the
  name or the language dropdown, then the switch; off the Bible it takes the
  stepper and the main row goes; which rows show is the pure `toolbarRows`):
  in each the one wide control yields (`flex: 1 1 auto; min-width: 0`) and
  the buttons and the switch stay fixed, so all fit at the 280px minimum
  width.
  `--btx-line` is **always a length** — `theme.lineHeightOf` states even
  `normal` in px — because multiplying a ratio would apply the scale twice.
- **Source-type marking** is a coloured strip on each source-type group, hue
  set once per `btx-grp-{sourceType slug}` (`--btx-src`). No setting.
- **Translatable and the setup card**: a chapter is translatable when some
  enabled text offers *that chapter* — a Church language only once the
  chapter check (GLOSSARY) found it there; the pure `churchText.chapterOffer`
  marks each text `offered` from its results. What shows is the panel's pure
  **arrangement** (GLOSSARY), the one place the mode rules live: a mode click
  saves `panelMode` on any chapter; Translation on a chapter nothing offers
  shows one card. The setup card (Add a Church language, or api.bible setup
  via `OPEN_OPTIONS {section}`) when no Church language is ticked. With one
  ticked: the off card while the language switch (`churchLanguageShown`) is
  off on a non-Bible chapter, unless the check already knows every ticked
  language lacks the chapter; the not-available card (its link opens
  settings at `languages`) when the reader clicked Translation on this visit
  (the off card's Show counts as one); else Citations with the
  no-translation line (GLOSSARY), unless the synced
  `noTranslationLineDismissed` is set or the switch is off. A Bible chapter
  every ticked language lacks carries the not-available line above the
  Bible version. The cards name the language by `churchText.nameFor`, are
  states (never an earned view), and their copy is the panel's pure
  `offCopy` / `notAvailableCopy`.
  `content.js` hands it the chapter's facts (`showChapter` / `arrange`, via
  `factsFor`), runs the check while it answers `loading` (so Citations never
  paints first), and applies the answer; it holds no mode rule of its own.
- **Page split** (`__BTX.pageSplit`) follows the arrangement's page's
  language (`page`, the pure `churchText.pageLanguage`, GLOSSARY: Page
  split), never the mode: it stays on the page in Citations, and on John 3
  NIV can show in the panel beside it. It shows only while the **language
  switch** is on: the synced `churchLanguageShown` (GLOSSARY), a fact
  `content.js`'s `factsFor` hands the arrangement, which passes it to
  `pageLanguage`; off names no page language and no `pageNext`, so no split
  and no chapter check, and the layout setting is untouched. It is not a
  panel-handled key: another tab's change re-asks the arrangement through
  the settings subscriber; this tab's writes go through `content.js`'s one
  writer, `setLanguageShown(on, {anchor})`, which arranges and renders
  itself.
  `content.js`'s `syncSplit` runs wherever an input moves (mode, pick,
  chapter, whether the chapter shows at all, settings): while `pageNext`
  names an unchecked language it runs the chapter check (in Citations too,
  never holding up the panel body, asking `panel.arrangement(facts)`, which
  stores nothing), then asks the pure `wantsSplit` and
  shows or hides; only a new chapter hides it first. `show`/`hide` take an `anchor`
  (`content.js` `splitAnchor`) so the paragraph at the top of the screen stays
  put. It mounts only once `article#main[data-uri]` is the chapter it loaded
  (the site swaps the whole article on navigation), and lays out again on
  resize of the article or page, on mutations inside the article, and when
  the site moves the reading column (polled — the footnote panel and the
  navigation drawer move it without a resize). The reading area ends at the
  site's footnote panel and its floating buttons. Columns give way to
  interlinear while each column would be under `MIN_COLUMN_PX`. In
  Translation off the Bible, when the tab's text is the page's language, the
  panel shows the `beside` card: the Side by side | Under each verse | In the
  panel control, the room hint, and "Collapse panel for wider columns" when
  `collapseFits`. On a Bible chapter the panel shows a Bible version, with the
  beside-the-page line naming the layout the page shows ("Español is side by
  side · Change"; GLOSSARY: Beside card), whose Change opens the same control
  in its place. Every pick on the control writes `churchLanguageLayout` alone.
  In the panel is a layout, not the way off: on a Bible chapter it shows the
  language in the version's place and the version dropdown rests (the
  arrangement's `versionRests`, applied by the panel's toolbar). Both hosts press the layout the page
  *shows* (`pressedLayout`; columns wanted without room presses Under each
  verse) while the setting stays what the reader chose, so side by side
  returns by itself; a click is judged against the setting (`layoutClick`),
  and Side by side with no room is answered with `roomHint`, never ignored.
  Collapsing the panel does not hide the split — it widens it.
- **Reading column fit** (#89) belongs to `__BTX.pageSplit` too, split or
  not: `content.js` calls `start()` once, and the pure `fitColumn` places
  `section#content` inside the visible reading area while the panel is open
  and the site's own column would be clipped (the site's grid holds it at
  least 640px wide, and docks the drawer at full-window widths). Its one
  id-scoped rule goes away with the panel collapsed or narrow enough, and
  the split lays out inside the fitted column.
- **Pack descriptor** (`index.json` `pack`): the build's `CORPORA` /
  `PACK_CORPORA` tables (`build-citation-data.js`) are the one place a
  per-corpus fact is written; the reader learns every per-corpus fact from the
  descriptor — corpus plans (`talkSource.corpusPlan`), source types and the
  vintage footer (`citVM.buildView` via `data.pack`) — never from a corpus
  table of its own or from which directory the pack came from. A corpus the
  descriptor lacks has no group, row, plan or reading destination. A source
  type's header hover text is the corpus entry's `sourceNote` (the build's
  `SOURCE_NOTES`, one note per source type, the same on every corpus of that
  type); a pack without notes gives its headers no title.
- **Reader scroll targets by corpus** follow each corpus's `target` in the
  pack descriptor (`talkSource.corpusPlan`). `findTarget` runs over the *rendered* talk only
  (a row's excerpt follows the same order over the fetched HTML string, in
  `excerptAt`; a body passage has no excerpt), so it depends on talk-view's
  render contract: ids survive, classes come back
  `btxk-`-prefixed, footnotes carry `data-btx-footnum`, and the article's
  `textContent` stays exactly the source text (display additions are CSS
  generated content or wrapper spans, the cite's mark is classes —
  `markCite` tints a target with no text through its paragraph, a short one
  only, and pins it with a CSS-drawn mark, while the reader still scrolls to
  the target itself; the byline
  and highlight hint sit outside the article). `test-talk-source.js` checks
  the contract in Node over `tools/mini-dom.js`. A live GC cite with no paragraph anchor goes to the
  paragraph `locateParagraph` names: it reads the fetched HTML string, since
  the sanitizer unwraps the links it needs, and returns an id. Every corpus
  then falls back to the paragraph holding the cite's snippet, if it bundles
  one. The target order is stated once, in `talk-source.js`'s header. The
  STPJS body-passage rule is stated twice (build vs reader) on purpose —
  ADR-0006.

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
  pre-filter open state on clear; a query made only of verse tokens
  (`citVM.verseQuery`) filters by the rows' verses, anything else is text;
  `cit-panel` mirrors the plan onto `[data-btx-uid]` nodes via a
  capture-phase `toggle` listener.
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
  below it (`--btx-top`, pure `panelTop`), and `paintTopCap` fills the strip
  above it beneath the band's controls. A synthetic `resize` event does not
  re-lay the band out: it compares `documentElement.clientWidth`, which the
  page reserve leaves unchanged.
- Commits are unsigned (GitHub shows "Unverified"); author email
  `noreply@anthropic.com`. The git proxy port rotates — retry pushes; clear
  any stale `remote.origin.pushurl`.

## Agent skills

- **Issue tracker:** GitHub Issues on `danielbaldwin47/Translations-and-Citations`
  via `gh`. See `docs/agents/issue-tracker.md`.
- **Triage labels:** the five canonical roles, default strings. See
  `docs/agents/triage-labels.md`.
- **Domain docs:** single-context: `GLOSSARY.md` + `docs/adr/`. See
  `docs/agents/domain.md`.
