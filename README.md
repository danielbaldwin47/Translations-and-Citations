# Translations & Citations for Gospel Library

A Chrome extension for the Gospel Library reader on
[churchofjesuschrist.org/study](https://www.churchofjesuschrist.org/study). While
you read **any standard-works chapter** (Old and New Testament, Book of Mormon,
Doctrine and Covenants, Pearl of Great Price) it shows, in a panel beside the page:

- the **same chapter in another Bible translation** (NIV, NKJV, …) or in any of
  about 100 **Church languages** (Español, Português, 日本語, …), and
- the **General Conference talks, Journal of Discourses sermons and Teachings of
  the Prophet Joseph Smith that cite each verse**.

Citations need no setup. Church languages need no key. Bible translations need a
free key from scripture.api.bible.

**Current version: 0.1.0** — see [CHANGELOG.md](CHANGELOG.md).

## Install (load unpacked)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repo folder. The settings page opens.
4. Pin the extension: puzzle-piece menu → pin **Translations & Citations**.
5. Open any chapter, for example
   [John 3](https://www.churchofjesuschrist.org/study/scriptures/nt/john/3?lang=eng)
   or [Alma 5](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/5?lang=eng).
   The panel shows the talks that cite the chapter right away.

To read the chapter in another language or translation, click **Translation** in
the panel. It offers the Church languages that publish that chapter (pick one
and it appears at once) and, on Bible chapters, a link to set up Bible
translations.

### Bible translations (optional)

Copyrighted translations can't be bundled, so the extension reads them from
**[scripture.api.bible](https://scripture.api.bible/)** with your own free key:

1. Create a free account at <https://scripture.api.bible/> and add the
   translations you want to your key (NIV, NKJV and NIrV, for example).
2. Open the extension's settings (the gear in the panel, or the toolbar icon on
   any page outside Gospel Library) and paste the key under **Bible translations**.
   It connects by itself; the translations you added are turned on, and NIV
   becomes the default when you have it.
3. The key's free translations (KJV, ASV, WEB, …) wait under **more free
   translations** — turn on any you like.

Availability depends on what your key is granted; some translations (NRSV, for
one) aren't in the api.bible catalog at all.

## Using it

- **Translation | Citations** at the top of the panel switches modes.
- **Church languages** show inside the page by default: side by side with the
  English when there's room, otherwise under each verse. You can also show them
  under each verse always, or in the panel.
- **Citations** come in two layouts — **By source** (each talk once, grouped by
  type) and **By verse** (each cited verse with its talks). A filter box narrows
  the list. Click a talk to read it in the panel, opened at the cited passage.
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
| **Bible translations** | api.bible key, which translations the panel offers, the default |
| **Church languages** | which languages to offer (searchable, grouped by what each publishes), and where they show |
| **Reading** | text size, panel width, scrolling the translation with the page, showing on pages in other languages |

Earlier versions had a Citations card (layout, source marking, a toggle to hide
the layout switch, "open scrolled to the snippet"). Those settings are gone: the
By source / By verse switch is always in the panel and remembers your choice,
citations are always marked with a colored edge by type, and talks always open
at the cited passage.

## Scripture Citation Index data

The citation feature is powered by data extracted from the BYU "Scripture Citation
Index" app databases (`core.53.db`, `content.53.db`), processed by
`tools/build-citation-data.js` into the compact, web-fetchable bundle under
`src/citations/data/` (~62 MB: 88 book shards covering all standard works, ~125.8k
citations, plus bundled offline text for non-Church-site sources). This is for
**personal study only** (BYU/Church content is not redistributable — another reason
this stays a load-unpacked extension, not a Web Store listing).

The raw app DBs are **not shipped** (they'd bloat the unpacked extension by ~100 MB
and aren't used at runtime). They live in git/LFS history at the commit that added
them, and are expected in the gitignored `source-data/` folder for rebuilds:

```
mkdir -p source-data        # then put core.53.db / content.53.db here
node --experimental-sqlite tools/build-citation-data.js   # reads source-data/ by default
node tools/validate-citations.js
```

## How it works

```
content script  ──messages──►  service worker  ──fetch──►  api.bible
 (detect chapter,               (owns API key,             (chapter text)
  inject panel,                  caching, rate limits,
  mirror theme,                  normalizes to safe IR)
  sync scroll)   ◄──IR blocks──
```

- The site is a React single-page app, so navigation is detected via a history
  hook + `popstate` + a polling fallback (covers strict CSP). The content script
  runs on every `/study` page, so the panel appears as soon as the site
  navigates to a chapter, including from the Gospel Library home page.
- All api.bible calls go through the **service worker** (which has
  `host_permissions`), avoiding content-script CORS issues and keeping the key out
  of the page.
- Church-language text and citation data are fetched by the content script:
  Church text from the site's own content endpoint, citation data from the
  extension's bundled files.
- Chapter text is normalized to a small intermediate representation and rendered
  with text nodes only (no `innerHTML`), so there's no XSS surface.

## Project layout

Every JS file is an IIFE attaching to the single global `__BTX.<name>`; the
header comment of each file is its interface doc.

| Path | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (content-script order matters) |
| `src/shared/constants.js` | message types, storage keys, API bases, limits, the Church-language table |
| `src/shared/settings.js` | the one owner of synced settings: schema, defaults, normalizers, get/patch/replace, change subscriptions |
| `src/shared/books.js` | LDS-slug maps: 66 Bible (→ USFM/name) + Book of Mormon / D&C / PGP |
| `src/background/service-worker.js` | message router, toolbar icon, first-install page |
| `src/background/api.js` | api.bible fetch + normalization |
| `src/background/cache.js` | chapter/bibles cache (chrome.storage.local) |
| `src/background/ratelimit.js` | 15/30s + daily request limiting |
| `src/content/detect.js` | chapter detection (all standard works) + SPA navigation |
| `src/content/page-hook.js` | page-world history patch |
| `src/content/church-text.js` | which texts a chapter offers; Church-language chapters as IR |
| `src/content/page-split.js` | the Church-language split inside the page |
| `src/content/theme.js` | theme/font mirroring, incl. live re-align on site theme/font-size changes |
| `src/content/sanitize.js` | safe IR → DOM renderer |
| `src/content/panel.js` | panel state + persistence, DOM, scroll-sync, drag-resize, and the view host that caches views |
| `src/content/content.js` | orchestrator: detect → worker/citations → panel content |
| `src/citations/cit-data.js` | loads shards / sources / gzipped talks |
| `src/citations/cit-view-model.js` | pure citation view-model: ordering, grouping, counts, labels, filter plan |
| `src/citations/cit-panel.js` | DOM adapter over the view-model |
| `src/citations/talk-source.js` | where a talk's text comes from per corpus, and where to scroll in it |
| `src/citations/talk-view.js` | inline talk reader + sanitizer |
| `src/citations/highlights.js` | local select-to-highlight in the reader |
| `src/citations/data/` | generated citation bundle (committed) |
| `src/options/` | settings page (Bible translations / Church languages / Reading cards), autosaving |
| `tools/build-citation-data.js` | builds `src/citations/data/` from the BYU DBs |
| `tools/validate-*.js`, `tools/test-talk-source.js` | Node checks, no deps (each names the module it covers) |
| `tools/make-icons.js` | regenerates the icon PNGs |
| `CLAUDE.md`, `CONTEXT.md`, `docs/adr/` | agent guidance, domain vocabulary, architecture decisions |

## Development

```bash
for f in tools/validate-*.js; do node "$f"; done   # all module checks
node --test tools/test-talk-source.js                # talk-source seam tests
node tools/make-icons.js                             # regenerate icons/*.png
```

No dependencies to install — the checks are plain Node scripts against each
module's pure core (`module.exports`).

After editing files, reload the extension at `chrome://extensions` (and reload the
Gospel Library tab) to pick up changes.

## Notes & limitations

- Verse numbering differs across Bible translations, so a translation in the
  panel isn't aligned verse by verse — scroll-sync is proportional, and whole
  chapters line up. Church languages shown in the page are paired verse by verse.
- api.bible has only the Bible; on the Book of Mormon, D&C and Pearl of Great
  Price the panel offers your Church languages.
- Church languages come from an undocumented endpoint of the Church's site
  (`/study/api/v3/language-pages/…`); if it changes, that text stops loading and
  the rest of the panel is unaffected. A language that hasn't published a volume
  says the chapter isn't available.
- Citations are verse-keyed; a tiny fraction of citations reference a whole
  chapter/section (or front matter) with no verse and aren't listed.
- Highlights are stored locally on this machine (`chrome.storage.local`) — they're
  not synced to your Church account and won't appear on other devices.
- Respect each translation's license terms; this tool is for personal study.
