# Issue 64: are BYU's modern-conference cites derivable from the Church's talk pages?

Measured October 6, 2026 for the Public pack regeneration ticket (#64). Tool:
`tools/research-church-byu-compare.js` (this branch). Inputs: the pack in
`main` (BYU database stamped 2026-05-18) and the Church content API
(`/study/api/v3/language-pages/type/content?lang=eng&uri=/general-conference/YYYY/MM/<talk>`),
one fetch per talk, 66 fetches in all.

## Question

If a new conference's cites can be derived from the talk pages alone, the
public pack can be refreshed days after the Church publishes the text instead
of waiting four weeks to four months for BYU's database.

## Method

For every BYU cite of a talk (book, chapter, verses), look for a Church-side
reference to the same chapter with overlapping verses. Church-side references
come from two places: `scripture-ref` links in the body and in footnote
`referenceUris` (verses encoded as `id=pN-pM`; a chapter link with no `id` is a
whole-chapter reference), and plain-text references in footnote text
("John 1:5, NKJV."), parsed with the pack's book names. A whole-chapter
reference on either side matches any verse of that chapter.

## Results

| Conference | Talks | BYU cites | Found by link | Found by footnote text | Not found | Church links with no BYU cite |
| --- | --- | --- | --- | --- | --- | --- |
| April 2026 | 33 | 694 | 675 (97.3%) | 5 | 14 | 0 of 629 |
| October 2025 | 33 | 706 | 699 (99.0%) | 2 | 5 | 2 of 680 |

Every "not found" cite was read by hand:

- **April 2026, all 14**: one footnote, "He ministered to people as recorded in
  the Book of Mormon (see 3 Nephi 11–26)", carries a link on chapter 11 only;
  BYU filed chapters 12 to 26 too. A chapter-range parser on the footnote text
  recovers them. With it, April 2026 is 694 of 694.
- **October 2025, 1 of 5**: "(Moroni 6:4)" in the body prose, unlinked. A
  reference parser over the body text recovers it.
- **October 2025, 4 of 5**: John 12, John 13, 1 Samuel 17:40, Jonah 3. Neither
  linked nor mentioned anywhere in the talk. These are BYU's allusion
  judgments.
- **Found by footnote text (7)**: references to non-KJV versions or the Joseph
  Smith Translation ("Hebrews 2:10, New International Reader's Version";
  "Joseph Smith Translation, Matthew 27:54"), which the Church leaves unlinked.
- **Church links with no BYU cite (2)**: two links into `jst-matt`, a book the
  pack does not carry.

## Finding

Explicit references (links, footnote text, body prose, chapter ranges)
reproduce 100% of BYU's April 2026 cites and 99.4% of October 2025 (702 of
706). The remainder is allusion cites BYU adds by judgment, about 4 per
conference of 700. Every Church scripture link maps to a BYU cite. The
derivation is deterministic for everything but allusions.

Verified: the counts above, by running the tool. Inferred: that other recent
conferences behave like these two (the Footnote locator ticket, #66, measured
the same link coverage at 97 to 100% for 2013 onward on a different sample).

## Facts on timing (from the same session)

- BYU's Android releases after each conference, 2019 to 2026: usually 27 to 56
  days, twice 96 and 133 days, once no release (October 2024). No October 2026
  release as of October 6, 2026.
- The Church API already listed October 2026 (4 sessions, 38 talks) on
  October 6, 2026, two days after conference, with the talk manifests at a low
  revision number (2, against 7 for April), so early text may still be revised.
