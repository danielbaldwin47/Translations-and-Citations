# Church-language text is split into the page by overlay, never by editing the site's DOM

A Church-language chapter can be shown in the site's own reading column,
paired verse by verse with the English (`src/content/page-split.js`, the
`churchLanguageLayout` setting). This is the one place the extension writes
into the site's reader, and that reader is a React tree the extension does not
own. So the split adds exactly three things and touches nothing else:

- **one layer**, appended to `article#main`, holding the translated blocks
  (built by the IR renderer, text nodes only) absolutely placed at their
  English partners' offsets, headed by the Hide line (text nodes and one
  button; its room is an id rule on the first pair's English);
- **`<style>` elements** whose rules select the site's elements by id (`p5`,
  `title_number1`) to make room — width in columns, `min-height` when the
  translation runs longer, `margin-bottom` for interlinear;
- **`data-btx-split` on `<html>`**, which scopes `page-split.css`.

Rejected: inserting translated nodes between the site's verses, or restyling
them inline. React would reconcile against nodes it didn't create, and the
site re-renders the article whenever it likes (annotations, highlights,
navigation swaps the whole `article#main`). Rules keyed by id survive any of
that; the layer re-pairs on every layout and re-mounts when the article is
replaced.

Pairing is by element id because the ids are the same in every language
(ADR-0005's "stable hooks" — never the site's hashed classes). The known cost:
a translation that numbers verses differently (French and German count Psalm
superscriptions as verses) pairs by number, not by meaning; its extra verses
ride under the last pair rather than being dropped.

The obligation: any new write into the site's page goes through this module
and these three mechanisms, and `tools/validate-page-split.js` greps that the
shell only reads the site's elements.

One side effect that is not a write into the page: when the split mounts or
unmounts, it scrolls the *window* by the shift of an anchor paragraph so the
reader's place holds (`hide({ anchor })`, `keepAt`). It never scrolls the
panel body — `panel.js` stays that body's only scroll writer.

Amended October 9, 2026 (issues #89 and #109): `__BTX.pageSplit` owns **the
reading layer**, which does two things, both independent of the panel's mode:
it fits the site's reading column to the open space (#89), and it adds the
split while the panel's arrangement names a page's language (#109).

The split follows the arrangement, not the mode. A reader reading Spanish
side by side keeps it on the page in Citations and reads the talks that cite
each verse beside it. `wantsSplit` has no mode input; `content.js`'s
`syncSplit` shows the arrangement's `page` (`churchText.pageLanguage`, while
the split layout is in-page; GLOSSARY: Page split) whenever the chapter shows
at all, and runs the chapter check for it in Citations too.

The fit: a widened panel otherwise left the column wider
than the space between the site's docked drawer and the panel, so verse text
ran under both. The fit is one more id-scoped `<style>` rule, on
`section#content`: it places the column inside the visible reading area
(pure `fitColumn` / `fitRule`), and it exists only while the panel is open
and the site's own column would be clipped. With the panel collapsed, or
narrow enough, the module removes the rule and the site's layout is back
exactly. `content.js` starts the layer once (`start()`); the split, when
shown, lays out inside the fitted column. The mechanism is still the three
listed above, with no new kind of write: one layer, id-scoped rules, and
`data-btx-split` on `<html>` (set only while a split is mounted).
The panel's own chrome sits outside the reader and is not a write into it:
`#btx-root`, and the cap `panel.js` paints above the panel while the panel
starts below the site's header band (`panelTop`).
