# Translations & Citations

A Chrome extension for the scripture reader on
[churchofjesuschrist.org/study](https://www.churchofjesuschrist.org/study). While
you read **any standard-works chapter** (Old and New Testament, Book of Mormon,
Doctrine and Covenants, Pearl of Great Price) it shows, in a panel beside the page:

- the **same chapter in another Bible translation** — the World English Bible is
  built in; NIV, NKJV and others with your own free api.bible key — or in any of
  about 100 **Church languages** (Español, Português, 日本語, …), and
- the **General Conference talks (1942 to the latest conference) and Journal of
  Discourses sermons that cite each verse**, with an excerpt of the cited
  paragraph; each talk reads inline, opened at the cited passage.

Citations and the World English Bible need no setup. Church languages need no
key. Other Bible translations need a free key from api.bible.

**Current version: 1.0.0** — see [CHANGELOG.md](CHANGELOG.md). Free, no ads, no
account. No analytics of our own. Only api.bible's required usage report, and
only once you connect a key. The [privacy policy](docs/privacy.md) lists what
is stored and what is sent where.

## Install

### From the Chrome Web Store

1. Open the listing — `<store-listing-url>` (filled in when the listing is
   published) — and click **Add to Chrome**. Alma 5 opens in a new tab, with
   a short welcome tour of the panel's controls; **Skip** or **Got it** closes it.
2. Pin the extension: puzzle-piece menu → pin **Translations & Citations**.
3. Open any chapter, for example
   [John 3](https://www.churchofjesuschrist.org/study/scriptures/nt/john/3?lang=eng)
   or [Alma 5](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/5?lang=eng).
   The panel opens on **Citations**, the talks that cite each verse; on a
   Bible chapter its **Translation** tab shows the World English Bible with
   no setup.

### What ships

The Store build is the committed tree of this repository: the code, the World
English Bible (`src/bible/engwebp/`) and the **public pack** of citation data
(`src/citations/data/`: General Conference and Journal of Discourses, with the
Journal of Discourses text bundled from Wikisource). Everything in it carries
rights evidence (ADR-0008). The Citations footer and the About card in settings
say which conference the pack runs through ("Citations through October 2026");
the pack is refreshed after each general conference.

### The personal build (load unpacked)

The same code loaded unpacked runs the **personal pack**, a private data pack
that also holds Teachings of the Prophet Joseph Smith. It is the developer's
own build, not a second Store item.

```bash
git clone https://github.com/danielbaldwin47/Translations-and-Citations.git
cd Translations-and-Citations
git clone <private-repo-url> /tmp/btx-private && cp -r /tmp/btx-private/data-personal src/citations/
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → the repo
folder. The reader probes `src/citations/data-personal/` first and falls back to
the public pack, so the same checkout without that directory *is* the public
release's data. (The Store zip carries a stamp that skips the personal probe,
so it requests no missing file.) Once `manifest.json` carries the Store
listing's `key`, both flavors share one extension id and therefore one set of settings and highlights; Chrome
runs one extension per id, so the Store install is disabled while the unpacked
one is loaded.

### Bible translations beyond the World English Bible (optional)

Copyrighted translations can't be bundled, so the extension reads them from
**[api.bible](https://api.bible/sign-up)** with your own free key:

1. Create a free account at <https://api.bible/sign-up> and add the
   translations you want to your key (NIV, NKJV and NIrV, for example).
2. Open the extension's settings (the gear in the panel, or the toolbar icon on
   any page that isn't showing a chapter) and paste the key under **Bible
   translations**. Connecting sends the chapters you open, your key, and an
   anonymous usage report to API.Bible (the sentence beside Connect says so;
   nothing is sent before you connect). It connects by itself; the
   translations you added are turned on, and NIV becomes the default when you
   have it.
3. The key's free translations (KJV, ASV, …) wait under **more free
   translations** — turn on any you like.

Availability depends on what your key is granted; some translations (NRSV, for
one) aren't in the api.bible catalog at all.

## Using it

- **Translation | Citations** at the top of the panel switches modes.
- **Church languages** show inside the page by default: side by side with the
  English when there's room, otherwise under each verse. You can also show them
  under each verse always, or in the panel. Adding one fetches that language's
  chapter from churchofjesuschrist.org.
- **Citations** come in two layouts — **By source** (each talk once, grouped by
  type) and **By verse** (each cited verse with its talks). Groups start
  collapsed except the verse you are reading; a filter box narrows the list.
  Opening a group fetches the excerpts of the rows that come on screen (modern
  talks from the Church site, 1942–1970 talks from scriptures.byu.edu); the
  Journal of Discourses reads offline. Click a talk to read it in the panel,
  opened at the cited passage, with a link to the full talk on the web.
- **Highlights**: select text in a talk to highlight it; click a highlight to
  remove it. Highlights stay on this computer (not synced to your Church account).
- **A− / A+** in the panel header size the panel's text; drag the panel's left
  edge to resize it. Both are also on the settings page.
- **Collapse** the panel to a tab at the page edge with the collapse button in
  its header; the tab or the toolbar icon brings it back. It stays collapsed
  across chapters until you open it again.
- The panel matches the site's light, dark and sepia themes, its fonts and its
  text size, and scrolls the translation along with the page (turn that off in
  settings to scroll the panel on its own).

Every setting saves as you change it; there is no Save button.

## Settings

| Card | What's there |
|------|--------------|
| **Church languages** | which languages to offer (searchable, your languages on top, the rest grouped by what each publishes), and where they show |
| **Bible translations** | api.bible key and Connect, which translations the panel offers, the default |
| **Reading** | text size, panel width, scrolling the translation with the page |
| **About** | version, pack vintage, data sources, privacy policy and support links, Show the welcome again |

## Citation data

Citation data is compiled with reference to the BYU Scripture Citation Index
and is not affiliated with or endorsed by BYU or The Church of Jesus Christ of
Latter-day Saints. The BYU databases (`core.53.db`, `content.53.db`) are a
frozen base; every conference after it is indexed from the Church's own talk
pages (`tools/derive-conference.js`). `tools/build-citation-data.js` writes a
**data pack**: `index.json` (whose `pack` field is the pack descriptor the
reader follows), `sources.json`, one shard per book under `citations/`, and
`talks/` for corpora whose text is bundled.

The public pack (~30 MB, 88 books, ~115k cites) holds General Conference as
references only — talk, verses, speaker, date, title, URL, and the length of
the paragraph each row will show; the text is fetched when you act — and the
Journal of Discourses whole, its text from Wikisource at pinned revisions
(`jod-provenance.json`). The personal pack adds Teachings of the Prophet Joseph
Smith (Galbraith's cite set and text), which has no rights evidence for public
release.

The databases and the other build inputs are not in this repository (they live
in the owner's private repo; recipe in `.gitignore`). To rebuild from them, see
`CLAUDE.md` "Build / test / verify"; a new conference enters by the pack
refresh in `docs/agents/pack-refresh.md`.

## How it works

```
content script  ──messages──►  service worker  ──fetch──►  api.bible (+ usage report)
 (detect chapter,               (owns API key,              or the packaged
  inject panel,                  caching, rate limits,      World English Bible
  mirror theme,                  normalizes to safe IR)
  sync scroll)   ◄──IR blocks──
```

- The site is a React single-page app, so navigation is detected via a history
  hook + `popstate` + a polling fallback (covers strict CSP). The content script
  runs on every `/study` page, so the panel appears as soon as the site
  navigates to a chapter, including from the site's home page.
- All api.bible calls go through the **service worker** (which has
  `host_permissions`), avoiding content-script CORS issues and keeping the key out
  of the page. The worker also sends api.bible's required usage report as a
  plain HTTP request; no script is ever injected into the page.
- Church-language text, citation data and talk text are fetched by the content
  script: Church text and modern talks from the site itself (same origin, no
  cookies), early-conference talks from scriptures.byu.edu, citation data from
  the extension's packaged files.
- Chapter text is normalized to a small intermediate representation and rendered
  with text nodes only (no `innerHTML`); fetched talk HTML goes through an
  allowlist sanitizer.

## Project layout

Every JS file is an IIFE attaching to the single global `__BTX.<name>`; the
header comment of each file is its interface doc. `CLAUDE.md` has the one-line
map of every module; the table below is the tour.

| Path | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest, version 1.0.0 (content-script order matters) |
| `src/shared/constants.js` | message types, storage keys, API bases, limits, the bundled Bible, disclosures, About-card text and URLs, the Church-language table |
| `src/shared/settings.js` | the one owner of synced settings: schema, defaults, normalizers, get/patch/replace, change subscriptions |
| `src/shared/books.js` | slug maps: 66 Bible (→ USFM/name) + Book of Mormon / D&C / PGP |
| `src/background/service-worker.js` | message router, toolbar icon, first-install page |
| `src/background/api.js` | api.bible fetch + normalization; the packaged World English Bible |
| `src/background/cache.js`, `ratelimit.js`, `fums.js` | chapter/version cache, api.bible rate limiting, api.bible usage report |
| `src/bible/engwebp/` | the World English Bible as IR, generated by `tools/build-bible-data.js` |
| `src/content/detect.js`, `page-hook.js` | chapter detection (all standard works) + SPA navigation |
| `src/content/church-text.js`, `page-split.js` | Church-language chapters as IR; the split inside the page |
| `src/content/theme.js`, `sanitize.js` | theme/font mirroring; safe IR → DOM renderer |
| `src/content/panel.js` | panel state + persistence, DOM, scroll-sync, drag-resize, and the view host |
| `src/content/content.js` | orchestrator: detect → worker/citations → panel content |
| `src/citations/cit-data.js` | finds the pack (personal first, then public), loads shards / sources / bundled talks |
| `src/citations/cit-view-model.js`, `cit-panel.js` | pure citation view-model; its DOM adapter (fetched excerpts) |
| `src/citations/talk-source.js` | per-corpus plan from the pack descriptor: where a talk's text comes from, where to scroll, fetch policy |
| `src/citations/talk-view.js`, `highlights.js` | inline talk reader + sanitizer; local highlights |
| `src/citations/data/` | the public pack (generated, committed, shipped) |
| `src/citations/data-personal/` | the personal pack (gitignored) |
| `src/options/` | settings page: Church languages / Bible translations / Reading / About |
| `tools/` | build tools (citation packs, derivation run, Journal of Discourses, Bible, Store zip), `validate-*.js`, `test-talk-source.js`, `make-icons.js` |
| `docs/privacy.md` | the privacy policy the About card and the Store listing link |
| `docs/store/listing.md` | the Store listing texts, checked against the manifest |
| `CLAUDE.md`, `GLOSSARY.md`, `docs/adr/`, `docs/agents/` | agent guidance, domain vocabulary, decisions, checklists |

## Development

```bash
for f in tools/validate-*.js; do node "$f"; done   # all module checks
node --test tools/test-talk-source.js                # talk-source seam tests
node tools/build-store-zip.js                        # the Store upload, from the commit
node tools/make-icons.js                             # regenerate icons/*.png
```

No dependencies to install — the checks are plain Node scripts against each
module's pure core (`module.exports`).

After editing files, reload the extension at `chrome://extensions` (and reload
the study tab) to pick up changes.

## Notes & limitations

- Verse numbering differs across Bible translations, so a translation in the
  panel isn't aligned verse by verse — scroll-sync is proportional, and whole
  chapters line up. Church languages shown in the page are paired verse by verse.
- Bible translations exist only for the Bible; on the Book of Mormon, D&C and
  Pearl of Great Price the panel offers your Church languages.
- Church languages come from an undocumented endpoint of the Church's site
  (`/study/api/v3/language-pages/…`); if it changes, that text stops loading and
  the rest of the panel is unaffected. A language that hasn't published a volume
  says the chapter isn't available.
- Conference talks and their excerpts need the network: offline, a talk shows an
  error state with a link to read it on the web, and its row keeps the
  reference line. The Journal of Discourses reads offline.
- Citations are verse-keyed; a tiny fraction of citations reference a whole
  chapter/section (or front matter) with no verse and aren't listed.
- Highlights are stored locally on this machine (`chrome.storage.local`) — they're
  not synced to your Church account and won't appear on other devices.
- Respect each translation's license terms.
