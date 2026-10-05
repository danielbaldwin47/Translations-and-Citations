# Translations & Citations

Domain glossary for the Chrome extension that augments the scripture reader on
`churchofjesuschrist.org/study` with alternate Bible translations, the
chapter in other Church languages, and BYU Scripture Citation Index data. This file defines what the words mean; file
layout, rules, and commands live in `CLAUDE.md`.

## Scripture geography

**Standard works**:
The five scripture collections the extension covers: Old Testament, New
Testament, Book of Mormon, Doctrine and Covenants, Pearl of Great Price.

**Volume**:
One of the five standard-works collections. In the BYU data this is
`book.ParentBookID` (1 OT, 2 NT, 3 BoM, 4 D&C, 5 PGP).
_Avoid_: collection (that word is reserved for the URL segment, e.g. `bofm`, `dc-testament`, `pgp`)

**Slug**:
The Church-site URL identifier for a book (`john`, `alma`, `dc`). Also the key
for per-book shard files. D&C "chapters" are section numbers.
_Avoid_: book id, abbreviation

**USFM**:
The industry 3-letter book code (`JHN`, `GEN`) used only when talking to
api.bible. Bible books have both a slug and a USFM code; non-Bible books have
only a slug.

## Citation data

**Cite**:
One record from the BYU Scripture Citation Index: talk X cites verse(s) Y.
Keyed by `citId` in a shard's `cites` map. This is the unit `uniqueTotal`
counts; the panel itself counts talks (a talk may carry several cites of one
chapter). A cite's own `v` field is the truth about which verses it cites —
`citData.chapterData` clips the index's verse rows to it.
_Avoid_: citation (overloaded — use cite for the data record, citation span for the HTML marker, citation row for the panel row)

**Citation span**:
The `<span class="citation" id="{citId}">` marker inside a talk's HTML where
the scripture reference appears. The reader scrolls to it (except STPJS, which
scrolls to the body passage).

**Talk**:
One sermon/discourse/chapter of teachings, identified by `talkId`; its metadata
(speaker, title, date, URL) lives in `sources.json`. Many cites can point at
one talk.
_Avoid_: source, sermon

**Corpus**:
Single-letter provenance tag on a talk: `G` modern General Conference
(1971–present, fetched live), `E` early GC (1942–70), `J` Journal of
Discourses, `T` Teachings of the Prophet Joseph Smith (E/J/T are bundled).

**Source type**:
The panel's grouping of corpora: "General Conference" (G+E), "Journal of
Discourses" (J), "Teachings of the Prophet Joseph Smith" (T). A
**source-type group** is the collapsible panel section for one of these.
_Avoid_: source (bare — say source type, talk, or BYU DBs depending on which you mean)

**BYU DBs**:
The gitignored build inputs `core.53.db` (index) and `content.53.db` (talk
HTML), living in `source-data/`. Needed only to regenerate shipped data.
_Avoid_: source databases, the source

**Shard**:
One generated per-book JSON file, `src/citations/data/citations/{slug}.json`,
holding that book's cites and a chapter→verse→citId index.

**Bundled talk / live talk**:
A bundled talk ships offline as `talks/{talkId}.html.gz` (corpora E/J/T); a
live talk (corpus G) is fetched from the Church site when opened.

**Talk source**:
The seam (`__BTX.talkSource`, `src/citations/talk-source.js`) that answers one
question for the reader: given a cite, hand back displayable talk HTML plus a
way to locate that cite's **scroll target** in the rendered result. It owns the
**corpus plan** — the per-corpus table of where the HTML comes from (live vs
bundled) and what the scroll target is (paragraph anchor / citation span / body
passage), with the paragraph holding the cite's snippet as every corpus's
fallback.
_Avoid_: source (bare — that still means a source type or the BYU DBs); always say talk source

**Scroll target**:
The element in a rendered talk the reader scrolls to and marks for a cite:
the paragraph anchor (live GC), the citation span (bundled E/J), or the body
passage (STPJS) — else the paragraph that contains the cite's snippet (most
2020s GC cites carry no paragraph anchor).

**Snippet**:
The short excerpt shown under a citation row. Normally the text around the
citation span; for STPJS (`T`) it is the body passage instead.

**Body passage**:
In STPJS talks, the sentence(s) the footnote annotates — the text around the
matching `footRef` marker, not the footnote's reference line. STPJS snippets
and reader scroll both target it.

**Contiguous range**:
A run of consecutive verses covered by one cite (e.g. vv. 3–5).

**Anchor verse**:
The first verse of each contiguous range a cite covers. In the by-verse layout
a talk appears once per anchor verse, not under every verse in the range.
Verse 1000 is a chapter's closing note (JS—H 1), shown as "Note".

**uniqueTotal**:
The count of distinct cites in a chapter. It only decides the empty state; the
panel's headline ("519 talks cite this chapter") and every count chip count
distinct talks.

## Panel

**Mode**:
The user's preferred panel feature: Translation or Citations. Stored as the
`panelMode` setting, owned by the panel.

**Translatable** (of a chapter):
Some enabled text offers it: an enabled api.bible translation on a Bible
chapter, or an enabled Church language that publishes its volume. `content.js`
decides it from `churchText.textsFor`; the panel only reads the flag
(`showChapter({ key, translatable })`).

**Effective mode**:
The mode actually showing. Equals the mode on a translatable chapter; on any
other the panel opens on Citations. The Translation | Citations control always
shows: Translation there sets a per-visit **override** that shows the **setup
card**, without rewriting the stored preference — unless the chapter becomes
translatable under it (a language added from the card), which commits
`panelMode: 'translation'`. The next chapter or a Citations click clears the
override. The pure rule is `effectiveMode` / `selectMode` / `setChapter`;
`panel.effectiveMode()` is the one source of truth.

**Setup card**:
Translation mode's body on an untranslatable chapter: add a Church language
(select + Add), or set up api.bible translations (opens settings at the
`bible` card via `OPEN_OPTIONS {section}`), or go to the talks that cite the
chapter.

**Beside card**:
Translation mode's body while the page split shows: where the text is (by the
layout that actually fits), the split-layout control, and "Collapse panel for
wider columns" when collapsing would make room (`pageSplit.collapseFits`).

**Church language**:
A language the Church publishes the standard works in, offered beside the
page from the site's own content endpoint (`__BTX.churchText`). Enabled ones
are the `churchLanguages` setting (codes from `C.CHURCH_LANGUAGES`); each
becomes a row in the translation dropdown after the api.bible versions, minus
the page's own language and any language that hasn't published the chapter's
collection. A chapter a language lacks is "not available", not an error to
retry. In the reader, *translation* code (the `translation` view,
`findTranslation`, `populateTranslations`, `btxSelectedTranslation` — a
most-recently-used list of row ids, newest first) handles both kinds of row —
tell them apart by `provider` (`'church'`). In settings,
the options page and the worker, *translation* (`enabledTranslations`,
`defaultTranslationId`) still means api.bible versions only.

**Page split**:
A Church-language chapter set into the site's own reading column, each block
paired with the English element of the same id (`__BTX.pageSplit`,
ADR-0007). It shows while the panel is in Translation mode with a Church
language picked, and the panel body shows the **beside card**. The alternative
to showing the text in the panel.
_Avoid_: overlay (that's its mechanism, not the feature)

**Split layout**:
How the page split arranges a pair — the `churchLanguageLayout` setting:
**columns** (default; side by side, each pair starting on one row, the shorter
side leaving open space under it), **interlinear** (the translation under each
English element), or **panel** (no split; the text shows in the panel).
Columns fall back to interlinear while the reading area is too narrow for two
readable columns.

**View**:
One named body of panel content that can be mounted in the panel body:
`translation`, `citations`, or `talk` (the inline reader). Exactly one is
mounted at a time.

**View key**:
The string identifying *which content* a view is showing — chapter + version
(+ `::page` or `::panel` for a Church-language row) for translation, chapter +
citation layout for citations (the verse being read is passed only when the
list is built, and moved with `citPanel.markVerse` / `revealVerse` after
that), talk + cite + an open counter for the talk reader (a row click opens
afresh; returning to Citations re-shows the stored key). Same name and same
key means the mounted DOM is still valid; a
different key means rebuild. The orchestrator supplies keys, the view host
compares them. A view only becomes re-mountable once it has earned it: a
spinner, an error, or a render that painted nothing is never cached.

**View host**:
The part of `__BTX.panel` that mounts views: it holds one cached body per view
name, remembers where each view was scrolled, invalidates them
all on a new chapter (the same chapter shown again keeps `citations` and
`talk`), and is the only writer of the panel body's scroll
position. Callers name a view and say how to build it (`showView`) or ask for a
node to be scrolled into sight (`scrollIntoView`); no module outside the panel holds
panel DOM.

**Page-synced view**:
A view whose scroll position is dictated by the reader page rather than by the
view itself — today, only Translation, which mirrors the page as the user
scrolls it. A page-synced view is never restored to a saved offset:
it is **placed** against the page each time it mounts. Every other view
(Citations, the talk reader) is *scroll-owning* — it comes back to where it was
left. Exactly one of the two applies to any view, which is what keeps
scroll-sync and scroll-restore from writing the same body. *Recording* an
offset, though, is unconditional: ownership can change under a view (see
below), and one that recorded nothing while page-synced would come back to the
top of the chapter rather than to where the reader was.

A reader who doesn't want the panel moving on its own turns **scroll-sync**
off (the `scrollSync` setting, on by default). That is not a milder follow: it
removes the page as a driver entirely — no tracking, no re-alignment — so
there is no page-synced view left and Translation becomes scroll-owning like
the rest. Where the user puts the panel is where it stays, including across a
trip to Citations and back.

**Placement**:
Putting a view's body at its starting scroll position at the moment it mounts,
as opposed to *moving* an already-visible body. Placement is instant: a body
that just appeared has no previous on-screen position to move from.

**Detached** (of a page-synced view):
The state where the user has scrolled the panel away from the position the page
points at. A detached panel is the user's: scroll-sync stops writing to it, so
it never fights their scrolling. The next page scroll **re-aligns** it — the
one movement in the panel that eases rather than happening instantly, since the
body may have a long way to travel back. On arrival it is attached again and
tracks the page 1:1.

What eases is only the **gap** — how far the user took the panel from where the
page points. Page scrolling that continues through a re-alignment is mirrored
1:1 as always, so the gap closes on its own fixed schedule however long the
user keeps scrolling; the panel never trails the page.

**Citation layout**:
How the Citations mode arranges rows: **by verse** (verse → source-type group →
talks) or **by source** (one row per talk, grouped by source type). Talks are
newest first in both. Stored as the `citationView` setting; the in-panel
By source | By verse toggle is its only control.
_Avoid_: view (bare — that is a hosted panel view; the `citationView` setting
name predates the term)

**Citation row**:
One rendered `.btx-cit` row in the panel: one talk. In by-verse layout a
talk's cites anchored at the same verse merge into one row; in by-source
layout each talk is one row, opening at its earliest cite.

**Citation view-model**:
The pure module (`src/citations/cit-view-model.js`, `__BTX.citVM`) that turns a
chapter's cites into descriptors. Every ordering, grouping, counting,
open-state and data-derived label rule of Citations mode lives there;
`cit-panel` only builds elements from what it returns (display-ready
snippets with their quote marks, the no-results line and the summary
included), and owns nothing beyond fixed chrome (the loading line, the filter
placeholder, the Clear filter label) and the verse excerpts it reads from the
page.
_Avoid_: renderer, formatter

**Descriptor**:
A plain object describing one thing the panel will render, carrying a **uid**
stable within one built view-model. A group descriptor (verse or source-type)
carries its label, count chip, open flag, `a11yLabel` and (verse groups) its
verse; a citation-row descriptor carries the talkId, speaker, title line,
range badge, display-ready snippet, `a11yLabel` and filter haystack. The
uid is how the DOM adapter maps element ↔ descriptor (`data-btx-uid`) and how
toolbar state is keyed.

**Plan**:
The computed next state of the citations toolbar — which rows and groups hide,
which groups open, the visible counts and summary, the no-results line, and
the Collapse all label (null hides the button) — returned by the view-model
and applied by the panel. Filter clearing restores the open state captured
when filtering began.

**Highlight**:
A user-made local text highlight inside the inline talk reader. Stored in
`chrome.storage.local` on this machine only — never synced to a Church
account.
_Avoid_: annotation (the Church site's own feature, which the extension never touches)

**IR**:
The normalized JSON intermediate representation a fetched translation chapter
is reduced to before rendering; the sanitizer renders only from IR, never raw
HTML.

## Settings

**Setting**:
One user preference in the synced `btxSettings` object (`chrome.storage.sync`)
— api key, enabled translations, citation layout, panel mode, panel width,
collapsed, … Owned end-to-end by `__BTX.settings`: schema, defaults,
normalization, reads, writes and change events. The panel's own state
(`panelMode`, `panelCollapsed`, `citationView`, `sidebarWidth`) is settings
too: in the reader only `__BTX.panel` writes it, and the panel adopts any
external write (the options page edits `sidebarWidth`; `citationView`'s only
editor is the panel's toggle).
What stays per-machine in `chrome.storage.local` (selected translation,
highlights) is *not* a setting.
_Avoid_: config, preference (as a code term)

**Normalizer**:
The single function that turns a setting's raw stored value — missing, legacy,
corrupted, wrong type — into a valid one. Exactly one per setting, so every
context resolves the same stored bytes to the same value.

**Own write**:
A settings change made by the context now being notified of it. Chrome echoes
a write back to its own author, so `subscribe` flags it (`own: true`) and a
caller that already applied the change locally can skip re-applying it.
