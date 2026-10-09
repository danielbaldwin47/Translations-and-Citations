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
Single-letter provenance tag on a talk (`sources.json` `c`): `G` modern
General Conference (1971–present), `E` early GC (1942–70), `J` Journal of
Discourses, `T` Teachings of the Prophet Joseph Smith. The pack descriptor
lists the corpora a pack holds and states each one's source type, text
source, scroll-target rule, excerpt kind and inclusion rule; a corpus it does
not list does not exist in the panel (the public pack lists no `T`).

**Source type**:
The panel's grouping of corpora, named by each corpus's `sourceType` in the
pack descriptor and ordered as the descriptor first names them: "General
Conference" (G+E), "Journal of Discourses" (J), "Teachings of the Prophet
Joseph Smith" (T, personal pack only). A **source-type group** is the
collapsible panel section for one of these. Its header's hover text is the
**source note**, the corpus entry's `sourceNote` ("Sermons by early Church
leaders, published 1854–1886"): one per source type, the same on each of its
corpora.
_Avoid_: source (bare — say source type, talk, or BYU DBs depending on which you mean)

**BYU DBs**:
The gitignored build inputs `core.53.db` (index) and `content.53.db` (talk
HTML), living in `source-data/`. Needed only to regenerate shipped data.
_Avoid_: source databases, the source

**Shard**:
One generated per-book JSON file, `src/citations/data/citations/{slug}.json`,
holding that book's cites and a chapter→verse→citId index.

**Bundled talk / live talk**:
Which one a talk is follows its corpus's `text` in the pack descriptor. A
bundled talk (`text: 'bundled'`) ships offline in the pack as
`talks/{talkId}.html.gz`; a live talk is fetched when the reader acts, from
the Church site (`live-church`) or from BYU (`live-byu`).

**Talk source**:
The seam (`__BTX.talkSource`, `src/citations/talk-source.js`) that answers one
question for the reader: given a cite, hand back displayable talk HTML plus a
way to locate that cite's **scroll target** in the rendered result. It owns the
**corpus plan** — for one corpus, where the HTML comes from (live vs bundled)
and what the scroll target is (paragraph anchor / citation span / body
passage), read from the pack descriptor by the pure `corpusPlan`, with the
footnote locator and then the paragraph holding the cite's snippet as
fallbacks. A corpus the descriptor lacks has no plan.
_Avoid_: source (bare — that still means a source type or the BYU DBs); always say talk source

**Scroll target**:
The element in a rendered talk the reader scrolls to and marks for a cite:
the paragraph anchor (live GC), the citation span (E, J), or the body
passage (STPJS). A J cite the Wikisource build could not place targets its
printed page's anchor instead. A live GC cite with no anchor (most from 2020 on) goes to the
paragraph the **footnote locator** names; else, for a corpus that still
bundles a snippet, the paragraph that contains it.

**Footnote locator**:
The rule (`talkSource.locateParagraph`) that places an unanchored modern cite
from the talk's own scripture links, read in the fetched HTML: a footnote's
link sits at the paragraph holding that note's first marker, a body link at
its own paragraph; the cite takes the k-th link with its exact book, chapter
and verses (k = its **refRank**, by cite id among the talk's cites of that
reference). Joseph Smith Translation links never match.

**Snippet**:
The excerpt a bundled corpus cuts at build time, shown under a citation row.
Normally the text around the citation span; for STPJS (`T`) it is the body
passage instead. A references-only corpus has none; see excerpt.

**Excerpt**:
The text shown under a citation row: a bundled corpus's snippet, or, for a
references-only corpus, the cite's target paragraph fetched when the row comes
on screen inside a source-type group the reader opened. While the fetch is
pending the row reserves the excerpt's size from a per-cite character count.
_Avoid_: preview, teaser

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
`panelMode` setting, owned by the panel. A click on either saves it, on any
chapter, Bible chapters included, and every later chapter opens on it (the
**arrangement** decides what that mode shows there). The default is
Citations: a fresh install, and any missing or unreadable stored value, opens
on it.

**Translatable** (of a chapter):
Some enabled text offers *this chapter*: on a Bible chapter always (the
bundled World English Bible is always enabled), elsewhere an enabled Church
language the **chapter check** found the chapter in. Publishing the volume is
not enough (a language can lack a chapter of a volume it publishes). The
**arrangement** reads it from each text's `offered` mark (`null` while the
check has not asked that language).

**Chapter check**:
Whether an enabled Church language has the chapter, learned by fetching it
(`churchText.load`) before the panel decides what to show. It walks the texts
in pick order and fetches only as far as its question needs; a language whose
volume lacks the chapter is excluded with no fetch, and a Bible row needs none.
"Found" and "not available" are remembered per language and chapter for the
tab, so a mode click, a settings change or a resize never fetches again. A
check that fails (network) is remembered for the chapter as `failed`: it
offers the panel's text, whose error card has Try again, but never the page.
While it runs the arrangement answers Translation's loading state wherever an
unchecked language stands before the pick. It also runs, in either mode, for
the **page split**'s language (`pageNext`); that walk never holds up the panel
body. Once the Translation tab settles, the languages it hasn't reached are
checked in the background, so dropdown rows lacking the chapter drop out; a
pick of a row still being checked waits for it in the loading state.
The decision over its results is the pure `churchText.chapterOffer` (its one
walk, `firstOffered`, is the arrangement's too); the fetching loops are
`content.js`'s `runCheck` and `checkRest`.

**Arrangement**:
The one pure rule for what the panel body shows (`arrangement` in the
panel's pure core). Inputs: the chapter's texts, each marked offered or not
(`chapterOffer`), the pick memory, the enabled Church languages, the split
layout, whether the **no-translation line** is dismissed, the stored **mode**,
this visit's mode click and this visit's dropdown pick. Answer: the effective
mode, the body (Citations, loading, the **setup card**, the **beside card**, or
a text), the text the Translation tab is about, the page's language (the
**page split**'s, in either mode, or none), the note (`no-translation`,
`beside-page`, `missing-chapter` or none, with the language it names) and the
mode a click saves. With Translation stored:
- a text offers the chapter: the latest pick that does (the beside card when
  that text is the page's language; a Bible version beside a page's language
  carries the beside-the-page line; when this visit's dropdown pick lacks the
  chapter, the text shown in its place carries the missing-chapter line, "No
  Pohnpeian translation for Doctrine and Covenants 84.");
- a language not yet checked stands before it: the loading state;
- nothing offers it and no Church language is on: the setup card;
- nothing offers it and languages are on: Citations with the **no-translation
  line**, unless the reader clicked Translation on this visit, which shows the
  setup card.
`content.js` describes the chapter to it wherever an input moves
(`panel.showChapter`, `panel.arrange`) and applies the answer.

**No-translation line**:
The one quiet line above the Citations list when the stored mode is
Translation, Church languages are on and none offers the chapter: "No
Kiribati translation for Doctrine and Covenants 76. **Add a language** ×".
It names the enabled Church language nearest the front of the pick memory,
else the first enabled one. "Add a language" is a Translation click on this
visit (the **setup card**); × sets the synced `noTranslationLineDismissed`
setting, so it never shows again on any computer. It never shows with
Citations stored, on a Bible chapter (the **bundled Bible** always offers
one), or once dismissed. The **arrangement** answers it (`note`); the panel's
note slot renders it, above the mounted view and never inside it.

**Effective mode**:
The mode actually showing: the **arrangement**'s mode. It differs from the
stored mode only on a chapter nothing offers while Church languages are on
(Citations under a stored Translation). `panel.effectiveMode()` is the one
source of truth.

**Setup card**:
Translation mode's body when nothing offers the chapter and no Church
language is on, or the reader clicked Translation on this visit: add a Church
language (select + Add; the chapter then shows in it at once), or, on the
Bible, set up api.bible for more translations (opens settings at the `bible`
card via `OPEN_OPTIONS {section}`), or go to the talks that cite the chapter.

**Beside card**:
Translation mode's body while the text the tab is about is the page split's
language: where the text is (by the
layout that actually fits), the split-layout control (its pressed segment is
the layout the page shows; the setting stays what the reader chose), and
"Collapse panel for wider columns" when collapsing would make room
(`pageSplit.collapseFits`).
Its one-line form is the **beside-the-page line**, above a Bible version shown
in the panel while a Church language holds the page: "Español is beside the
page text · **Change**" (the language named as the dropdown leads its row).
Change swaps the line for the same split-layout control, in its place. "In the
panel" there moves the language into the panel in the Bible version's place:
the split layout becomes `panel` and the language goes to the front of the
pick memory, so the dropdown selects it (`layoutChoice` in the panel's pure
core). Picking that language in the dropdown shows the full card instead. The
**arrangement** answers the line (`note: 'beside-page'`); the panel's note slot
renders it.

**Bundled Bible**:
The World English Bible (ebible.org `engwebp`), shipped as IR files under
`src/bible/engwebp/` and served by the worker as provider `bundled`: no key,
rate limit or usage report. Its `enabledTranslations` row is guaranteed by the
settings normalizer and is the default translation while no api.bible version
is on. Its text is never edited (the condition of the name).

**Church language**:
A language the Church publishes the standard works in, offered beside the
page from the site's own content endpoint (`__BTX.churchText`). Enabled ones
are the `churchLanguages` setting (codes from `C.CHURCH_LANGUAGES`); each
becomes a row in the translation dropdown after the api.bible versions, minus
the page's own language and any language that hasn't published the chapter's
collection. A chapter a language lacks is "not available", not an error to
retry. In the reader, *translation* code (the `translation` view,
`findTranslation`, `populateTranslations`, `C.SELECTION_KEY`, the pick memory — a
most-recently-used list of row ids, newest first; a language ticked in settings or added on the setup card goes first) handles both kinds of row —
tell them apart by `provider` (`'church'`). In settings,
the options page and the worker, *translation* (`enabledTranslations`,
`defaultTranslationId`) means a Bible version: api.bible's, or the bundled
World English Bible.

**Page split**:
A Church-language chapter set into the site's own reading column, each block
paired with the English element of the same id (`__BTX.pageSplit`,
ADR-0007). It is independent of the mode: it shows, in Translation and
Citations alike, while the **split layout** is columns or interlinear and the
**arrangement** names a page's language (`churchText.pageLanguage`): the
first Church language in the pick memory that offers the chapter; with none,
the text the Translation tab selects, only when that is a Church language. So
John 3 with no pick and Español on shows no split (the tab selects the Bible),
while Alma 5 splits in Español. A Bible version never holds the page, so on
John 3 NIV can show in the panel with Español on the page. A language whose
chapter check failed never holds it. The next chapter keeps the language if
it offers it, else the next pick that does, else no split. Taking it off the
page is "In the panel" on the **beside card** or its beside-the-page line. The alternative to showing the
text in the panel.
_Avoid_: overlay (that's its mechanism, not the feature)

**Reading layer**:
Everything the extension writes into the site's reader, owned by
`__BTX.pageSplit` (ADR-0007): the fit (while the panel is open, the site's
reading column fits the visible reading area, in every mode, split or not)
and the **page split** (while the **arrangement** names a page's language).
_Avoid_: overlay

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
placeholder, the Clear filter label) and the verse text it reads from the
page (each verse's own words under its header; not an excerpt).
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

## Release

**Flavor**:
The extension loaded with one data pack: the public release or the personal
build. Code, manifest and Store listing are the same in both; only the pack
differs.
_Avoid_: variant, edition, build (bare)

**Public release**:
The flavor distributed through the Chrome Web Store, running the public pack,
in which every shipped element carries rights evidence. The main flavor.
Contrast personal build.
_Avoid_: Store version, free version

**Personal build**:
The load-unpacked flavor for the developer's own use, running the personal
pack. A reserve: it carries the gated elements and behaves like the public
release everywhere else.
_Avoid_: dev build, private version

**Data pack**:
The generated citation data a flavor loads (index, sources, shards, bundled
talks); the unit a flavor swaps. The **public pack** is committed in the repo
and shipped on the Store; the **personal pack** is held privately.
_Avoid_: dataset, the data

**Gated element**:
A shipped element present only in the personal pack, because it has no rights
evidence for the public release.
_Avoid_: personal-only feature, restricted content

**Pack descriptor**:
A data pack's statement of what it holds — which corpora it indexes, which it
bundles, which carry snippets — that the reader's corpus plan follows. The
`pack` field of the pack's `index.json`, written by the build per pack mode:
flavor, pack vintage, base stamp, derived conferences, and per corpus its
`sourceType`, `sourceNote`, `text`, `target`, `excerpt` and `inclusion`.
_Avoid_: pack manifest (manifest means the extension's), flavor flag

**Rights evidence**:
The license, public-domain finding, terms reading, or written permission that
clears one shipped element (a data file, a fetched text, a link) for the
public release. One element, one piece of evidence.
_Avoid_: clearance, legal basis

**Reading destination**:
Where a cite's talk is read on the web, per corpus plan: the Church page at
the paragraph (live-church), BYU's viewer at the citation span (live-byu), or
the source's own URL (a bundled corpus that has one: the Journal of
Discourses' Wikisource permalink). The reader header's external link and the
talk error state open it (`talkSource.readingDestination`).
_Avoid_: link-out target, external link

**References-only**:
A corpus indexed with only facts per cite — talk, verses, speaker, date,
title, URL — and no snippets or bundled talk prose. A property of one corpus
within a pack: a pack may bundle one corpus and index another references-only.
_Avoid_: metadata index, stripped index, references-only index (the pack as a whole is mixed)

**Pack vintage**:
The latest conference a data pack covers. Part of the pack descriptor; shown
to the reader.
_Avoid_: data version, index date

**Pack refresh**:
Rebuilding a data pack to take in a newly published conference. A refresh
changes data only, never code.
_Avoid_: regeneration, data update, rebuild

**Cite provenance**:
Which source a cite's facts came from: the BYU database the pack was first
built from, or the Church's own talk page (its footnotes and scripture links).
A property of one cite within a pack.
_Avoid_: origin, source (which names the talk)

**Inclusion rule**:
Which of a corpus's BYU cites a data pack keeps: `all` (every cite, the
comprehensive-factual-index reading) or `verbatim` (only cites re-derived by
quotation matching against public-domain scripture, BYU's data not an input).
A build input per corpus, recorded in the pack descriptor.
_Avoid_: filter, cite policy

**Derivation run**:
The pack refresh step for one conference: the conference's talk pages (fetched
from the Church content endpoint, or saved by the owner from a browser) yield
explicit verse references, written as derived cites. One run per conference,
idempotent.
_Avoid_: bridge run, scrape

**Store zip**:
The upload package for the Chrome Web Store, made from the committed tree
alone, so nothing gitignored can ship, plus the Store stamp.
_Avoid_: bundle, release build

**Store stamp**:
The one file the Store zip holds in place of the committed one: it tells the
pack probe to ask the public pack alone, so the Store build requests no
personal pack it lacks. Not a flavor (ADR-0008).
_Avoid_: build flag, release marker

**Derived cite**:
A cite whose provenance is the Church's talk page. Every conference newer than
the pack's BYU database is indexed this way, permanently; the BYU database is
a frozen base, never refreshed.
_Avoid_: bridge cite, provisional cite, Church cite
