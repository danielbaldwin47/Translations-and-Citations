# Changelog

High-level only. Mechanism lives in module headers, `GLOSSARY.md`, and
`docs/adr/`. Versions are the extension's own numbering (`manifest.json`),
starting fresh at 0.x for the first tagged release.

## 1.0.0 — October 2026

The public release: the extension ships free on the Chrome Web Store, one
codebase in two flavors (ADR-0008). The **public release** runs the committed
public pack; the **personal build** (load-unpacked) runs a private personal
pack, the only home of data without rights evidence. The rights record is
issue #61; the spec is #69.

### For the reader

- **Bible translations with no setup.** The World English Bible is built in
  (public domain, text unaltered): a fresh install opens a Bible chapter with
  it beside the page. api.bible stays for NIV, NKJV and the other versions
  your key unlocks; the `bible-api.com` provider is gone.
- **Citations from every General Conference since 1942** and the **Journal of
  Discourses**, in the public pack. Conference talks are indexed as references
  only: each row's excerpt is the cited paragraph, fetched when the row comes
  on screen inside a group you opened (at most six requests to the Church
  site and two to BYU at a time, one fetch per talk per session, nothing kept
  past the session). While it loads the row holds its exact size. Early
  conference (1942–1970) is fetched from scriptures.byu.edu, its publisher,
  and says so in the byline; the Journal of Discourses text is Wikisource's,
  bundled, with "Text: Wikisource, revision N" and a permalink in the byline.
  Teachings of the Prophet Joseph Smith is in the personal build only.
- **Talks open at the cited paragraph** even without an anchor: the footnote
  locator reads the talk's own scripture links. Groups start collapsed except
  the verse you are reading. The Citations footer and the About card show the
  pack vintage ("Citations through October 2026"); October 2026 is the first
  conference indexed from the Church's own talk pages.
- **Disclosures and About.** One sentence beside Connect and on the setup card
  says what connecting to api.bible sends; one line beside Add language says
  the chapter is fetched from churchofjesuschrist.org. Settings gain an About
  card: version, pack vintage, data sources, the privacy policy
  (`docs/privacy.md`) and support links.
- api.bible usage reporting is a plain request from the service worker, never
  a script on the page. Name: "Translations & Citations: a scripture study
  companion".

### Under the hood

- **Pack descriptor** (`index.json` `pack`): the reader learns every
  per-corpus fact — source type, where text comes from, scroll target,
  bundled or fetched excerpt, inclusion rule, vintage — from the pack it
  finds (`src/citations/data-personal/` first, then `src/citations/data/`),
  never from a corpus table of its own.
- **Build:** `build-citation-data.js --pack public|personal`, with
  `--inclusion` (`all` or `verbatim`, the quotation matcher in
  `verbatim-matcher.js`), excerpt character counts, derived cites from
  `derive-conference.js` (one conference per run, no Church text kept), the
  Journal of Discourses from `fetch-jod-wikisource.js` + `build-jod-talks.js`,
  the Bible from `build-bible-data.js`, and `build-store-zip.js` (the committed
  tree alone, via `git archive`). Pack-aware validators, `validate-manifest`
  (manifest, Store listing texts, privacy policy), `validate-store-zip`,
  `validate-service-worker` (FUMS on cache hits too), `validate-jod`,
  `validate-derivation`, `validate-bible-data`, `validate-verbatim-matcher`.
- Docs: ADR-0008, the pack-refresh checklist (`docs/agents/pack-refresh.md`),
  the Store listing texts (`docs/store/listing.md`), the privacy policy.

### UX pass

A production polish of every surface, driven by a six-surface audit and an
end-to-end verification.

- **Settings save as you go.** No Save button: every change is written at once
  (a "Saved" toast confirms it). Three cards — Bible translations, Church
  languages, Reading. Paste an api.bible key and it connects by itself, turns
  on the translations you added to the key and makes NIV the default; free
  versions wait under "more free translations"; duplicate editions collapse to
  one. Church languages get a search box and fold-open groups (no inner scroll
  box). Plain-language key errors. Settings can be opened at a card from the
  panel. The version list is cached for a week, so opening settings no longer
  costs ~39 api.bible calls.
- **Retired settings**: citation layout (the panel's By source | By verse
  toggle is its one control), source marking (the coloured edge is the only
  style), hiding the layout toggle, and "open sources at the snippet" (talks
  always open at the cited passage). Stored values are ignored.
- **Panel chrome**: two rows — Translation | Citations with Settings and
  Collapse icons, then the mode's own control with A− / A+. The ✕ close button
  is gone: Collapse is the one way to put the panel away, and the toolbar icon
  toggles it (or opens settings where no chapter is showing). The collapsed
  tab is a small icon that no longer covers the site's header. Readable
  contrast in dark mode, SVG icons, screen-reader names and pressed states.
- **Fonts**: translation and talk text use the chapter's reading font; chrome
  and the citation list use the site's UI font (the panel used to pick up the
  navigation drawer's font on long books).
- **First run**: chapters open on working Citations; the Translation tab shows
  a setup card that adds a Church language in one step or links to the
  api.bible setup. The panel now appears when you enter Gospel Library from
  its home page.
- **Church language beside the page**: the panel card says where the text is
  (side by side or under each verse), switches the layout in place, and offers
  to collapse the panel when that makes room for columns.
- **Translation**: grouped version dropdown (Bible translations / Church
  languages), remembers your recent picks per kind of chapter, clearer loading,
  waiting and error states with a next step, copyright at the end of the text,
  readable verse numbers.
- **Citations**: one row per talk (the headline now counts talks), newest
  first, clean snippets (no page markers or footnote debris), "Verse N" groups
  with the verse's opening words, pinned group headers, a filter that updates
  the counts, Collapse all instead of Expand all, and the verse you're reading
  opened and outlined as you scroll.
- **Talk reader**: finds the cited passage in every talk (including the 2020s
  conference talks, which used to open at the top), a header with the cited
  verses and a link to the full talk, notes and section headings on live
  talks, cleaner bundled texts, scoped Esc, keyboard focus that returns to the
  row you opened, a loading spinner, and an error state with Try again. The
  talk you were reading survives a trip to Translation.
- **Fixes found on the way**: 2024 and 2026 talks were filed under verses they
  don't cite (made-up "Verse 42" groups, "vv. 1–38" badges) — each cite now
  follows its own verse list; an api.bible 429 no longer retries forever (at
  most three waits, then Try again); enabling ~20 translations no longer fills
  the 8 KB sync item (rows are stored slim); the page split refits when the
  site's footnote panel opens, and an English block with nothing beside it
  (the Japanese Bible has no chapter summaries) stays in the English column
  instead of running under the translation; the panel moves below the site header when the
  header would run under it; a settings change no longer resets the open talk
  or the citation filter; A− / A+ keep your place.
- New extension icons; one product name, "Translations & Citations".

### Earlier in 1.0.0

- **Church languages** (new options card): the chapter in Spanish, Portuguese,
  Japanese, … beside the English page, on every standard work — straight from
  churchofjesuschrist.org, no key. Checked languages join the translation
  dropdown; on the Book of Mormon, D&C and Pearl of Great Price they make
  Translation mode available for the first time. 100 languages, grouped by what
  each publishes; a language without the current book's volume isn't offered
  there. Chapter heading, summary, poetry lines, Japanese furigana and
  right-to-left scripts (Arabic, Persian, Urdu) carry over; scroll-sync stays
  proportional (French and German number Psalm superscriptions as verses).
- **Page split**: by default a Church language is set into the page itself,
  beside the English — side by side, each verse level with its partner and the
  shorter side leaving open space under it. Options: under each verse, or in
  the panel as before. A window too narrow for two columns shows it under each
  verse until there's room.

- **Panel text size** (Reading card): a 70–160% multiplier on the panel's reading
  text — translation, citation list, talk reader. It multiplies the size
  mirrored from the site, so the site's own font-size slider still applies.
  Chips, toggles and the header keep their fixed size.
- Line-height is now mirrored from the site as a length in every case, so the
  panel's leading tracks its text size instead of compounding with it.

## 0.1.0 — 2026-08-15

Architecture pass over the whole extension plus a batch of panel polish.
No new data; the citation bundle is unchanged.

### For the reader

- **Scroll-sync setting** (Panel card): turn page-follow off entirely.
  Tracking is 1:1 and instant; only re-alignment after you scroll the panel
  yourself eases in, and it always finishes.
- **Citation source marking** (Citations card): acronym chip (GC / JoD / JS)
  or a coloured edge on the group. Chips are one 26px tile family sized from
  their own text, not the site's.
- **Citations open in context** — the cited passage is revealed where it sits,
  not pinned to the top of the panel.
- **Talk reader header sits flush** with the panel body.
- **Theme mirroring** re-applies live when the site's theme or font-size slider
  changes; mirrors the verse body's font, not the chapter heading's.
- Options page stays in sync with panel-side changes (mode, layout, width) and
  its translation list no longer goes stale behind its settings.

### Under the hood

- `src/shared/settings.js` (`__BTX.settings`) is the single owner of synced
  settings: schema, defaults, per-key normalizers, `patch`/`replace`, tagged
  own-writes, unknown keys passed through.
- `panel.js` deepened: owns panel state + persistence, scroll ownership, and a
  view host that caches earned views; `content.js` is an orchestrator only.
- `cit-view-model.js` — pure citation view-model (ordering, grouping, counts,
  labels, filter plan) behind a thin `cit-panel.js` DOM adapter.
- `talk-source.js` — where each corpus's talk text comes from and where to
  scroll in it, as a `CORPUS_PLANS` table under `talk-view.js`.
- `theme.js` owns its re-apply loop (bounded backoff, `ResizeObserver`,
  no-op writes suppressed).
- New Node checks, no deps: `validate-settings`, `validate-panel-state`,
  `validate-cit-view-model`, `validate-options-form`, `validate-theme-align`,
  `test-talk-source`.
- Docs rewritten for agents: `CLAUDE.md` trimmed to rules + pointers,
  `CONTEXT.md` vocabulary, `docs/adr/0006`, `docs/agents/`.

## 0.0.9 — main before this merge

Baseline: Translation + Citations panel for all standard works, inline talk
reader with local highlights, two citation layouts with filter box, options
page, theme/font mirroring, drag-resize, proportional scroll-sync. Tagged
`v0.0.9` on `main` retroactively; no earlier versions were tagged.
