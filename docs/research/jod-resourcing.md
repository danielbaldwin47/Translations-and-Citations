# Journal of Discourses: re-sourcing the 1,395 J talks from Wikisource

**Recommendation.** Take the text of the public release's J talks from English Wikisource at pinned revisions. Join each talk to its Wikisource page by **(volume, start page)**, not by title. Carry each cite's citation span across from BYU's markup by word alignment. Ship none of BYU's J HTML. Measured on October 5, 2026:

- 1,395 of 1,395 J talks join to a Wikisource page by (volume, start page).
- After the join, 1,391 talks need no repair, 2 need an automatic trim, and 2 need a passage transcribed from the scan.
- 97.5% of citation spans land at an exact word position; the rest fall back to their printed page.
- Re-deriving a span from the verse reference alone finds BYU's spot for only 43% of cites. It works as a fallback, not as the method.

Answers [issue 54](https://github.com/danielbaldwin47/Translations-and-Citations/issues/54) under map [#52](https://github.com/danielbaldwin47/Translations-and-Citations/issues/52). It builds on [issue-50-public-release.md](issue-50-public-release.md) ("Independent acquisition", "Older talks"), which it does not restate. Vocabulary follows `GLOSSARY.md` ("Citation data", "Release").

**Verified** means a primary source fetched, or a script run, on October 5, 2026. Repository data was read at commit `9f10ef051a522db76e6e940d15e5d10308eecba8`. **Inferred** means a reasoned consequence. **Unknown** means evidence is still needed. This is a research record, not a legal opinion. Every request was an unauthenticated public GET, sent serially with a descriptive User-Agent. Nothing was edited, created or sent.

## Recommended pipeline for `tools/`

The pipeline has two scripts and a validator. They run on the personal build host, which holds the BYU DBs and is already where the references-only index is built.

1. **`tools/fetch-jod-wikisource.js`: snapshot the source.** It calls the MediaWiki Action API at `https://en.wikisource.org/w/api.php` with these parameters:
   - `generator=allpages&gapprefix=Journal of Discourses/&gapnamespace=0&gaplimit=50`
   - `prop=revisions|templates|categories&rvprop=ids|timestamp|user|sha1|content&rvslots=main`
   - `maxlag=5` and `formatversion=2`

   Requests go one at a time and follow `continue`, with `Accept-Encoding: gzip` and a User-Agent that carries contact details. This is the practice [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) asks for (revision 8373208): serial requests, batching through a generator, `maxlag` for non-interactive jobs, and a User-Agent with contact information.

   Measured: 89 requests returned all 1,509 pages, in about 1.5 minutes with a 1-second pause between requests. A page whose wikitext is a `<pages index=…>` transclusion has no inline page-break markers. For each such page, the script calls `action=parse&oldid={revid}` and reads the `data-page-number` and `data-page-quality` attributes from the rendered page-number spans. There are 2 such pages, both in volume 20.

   The snapshot records, per page: title, `revid`, timestamp, `sha1`, the wikitext, the templates, and whether the page is scan-backed along with each Page-namespace quality level.

   The [Wikisource dump](https://dumps.wikimedia.org/enwikisource/latest/) is an offline alternative, but it is 3,428,152,987 bytes (`enwikisource-latest-pages-articles.xml.bz2`, dated October 1, 2026). It is not worth that size for 1,509 pages.
2. **`tools/build-jod-talks.js`: build each J talk.**
   1. **Join.** Find the talk's volume and start page (see "Matching"), look up the Wikisource page with the same key, and accept the pair only when the text gate passes.
   2. **Body.** Render the wikitext body to the bundled-talk HTML, from paragraphs and `{{page break|N}}` markers.
      - Each page break becomes an anchor (for example `<span id="jdp-N">`).
      - The heading comes from the header's `section`. The subtitle comes from `notes`, minus the parenthetical "(Online document scan …)" line.
      - Cut the body at the end page from the volume page's range wherever the page runs past it (see "Defects").
   3. **Citation spans.** Insert `<span class="citation" id="{citId}">` at the aligned position (see "Citation spans"). The span is an empty marker, or carries a label generated from the verse key; BYU's reference text is not used.
   4. **Fallbacks.** A cite whose position does not align gets its page anchor. Optionally, try the verse-text match first, restricted to that page.
   5. **Snippet.** Re-derive the cite's snippet from the Wikisource text around the marker.
   6. **Provenance.** Write `jod-provenance.json`, which maps each talkId to the Wikisource title, `revid`, timestamp, `sha1`, page range, license basis, and how the cite positions were placed.
3. **`tools/validate-jod.js`: check the result.** Every J talk has a provenance row. Every J cite has a marker or a page anchor. The text gate holds. No body text comes from BYU HTML.

The reader keeps the J corpus plan's `citationSpan` target in `src/citations/talk-source.js`. Inferred: a page-anchor fallback is a new corpus-plan target, and it replaces today's snippet-paragraph fallback for J.

## Matching (question 2)

The key is **(volume, start page)**:

- **Volume** is `floor(talkId / 10000)`. Verified on 1,395 of 1,395 talks, both here and in issue 50.
- **BYU's start page** is the `<title>JD v:p,` of each bundled talk, for example `src/citations/data/talks/10001.html.gz` → `JD 1:1`. The build can also read the start page from the BYU DBs.
- **Wikisource's start page** is the first `{{page break|N}}` in the page, or the `data-page-number` of a transcluded page.

Results (all Verified):

| Measure | Result |
| --- | --- |
| Talks joined by key | 1,394 of 1,395 directly. The 1 other (talk 200004) is the transcluded volume 20 page, which joins through its rendered page numbers. |
| Text gate: share of BYU word 5-grams found in the Wikisource text | ≥0.95 for 1,372; ≥0.90 for 1,393. Below 0.90: talks 210002 (0.65) and 210034 (0.80–0.90). |
| Key collisions | None. No Wikisource page joined to two talks. 33 Wikisource subpages joined no talk; they are uncited discourses plus the volume 1 Letter and Introduction. |
| Speaker check: BYU speaker's surname appears in the Wikisource author or notes | 1,393 of 1,395. Talk 190047 is a "Remarks" piece that BYU credits to L. W. Hardy and Wikisource to John Taylor; its text match is 0.97. Talk 200004 is the transcluded page. |
| Manual matching needed | **0.** The 838–1,302 title matches in issue 50 are superseded; titles become a cross-check only. |

What the pages contain (Verified):

- `Journal of Discourses/` has 1,509 pages: 26 volume pages, 1,428 subpages and 55 redirects from old `Volume1/…` titles.
- Each volume page lists its discourses with page ranges, for example `[[/Salvation|Salvation]] by Brigham Young (1-6)`. That gives 1,417 ranges across the 26 volumes.

## Text quality and defects

Agreement with BYU's transcription (Verified): 1,393 pairs, word-aligned with `difflib`.

| Measure | Value |
| --- | --- |
| BYU words | 5,907,020 |
| Wikisource words | 5,918,077 |
| Words identical and aligned | 5,879,315 |
| BYU words without a match | 0.47% |
| Per talk: median / 99th percentile | 0.43% / 1.33% |

Most of the residue is BYU's **spelling modernisation**; Wikisource keeps the Liverpool printing's British forms. The top substitutions:

- "today" for "to day" (2,449)
- "forever" for "for ever" (679)
- "cannot" for "can not" (491)
- "labor" for "labour" (429)
- "veil" for "vail" (419)
- "savior" for "saviour" (364)
- "canyon" for "kanyon" (106 + 92)
- "Melchizedek" for "Melchisedek" or "Melchisedec" (239)

Inferred: Wikisource follows the 1854–1886 print more closely than BYU does. It also has stray OCR marks, for example "enjoy. a freedom" in [Salvation](https://en.wikisource.org/wiki/Journal_of_Discourses/Volume_1/Salvation) (revision 16217145).

Defects found (Verified):

| Talk | Defect | Remedy |
| --- | --- | --- |
| 210002 "Law of Celestial Marriage" | Wikisource has about 65% of BYU's text. | Transcribe the missing passage from the scan (manual). |
| 210034 "A Double Birthday" | Wikisource lacks an 825-word passage. | Transcribe from the scan (manual). |
| 120059 "The Opposition of Wickedness to Righteousness" | The page also carries the next discourse, pp. 308–316, which is 5,375 extra words. That discourse has its own page. | Cut at the volume page's end page (307), automatically. |
| 230011 "Peace and Prosperity of the Saints" | 163 extra words in Wikisource. | Cut by page range, then check. |
| 120037 "Life and Health" | BYU's copy is truncated: 241 words, p. 176 only. Wikisource has pp. 176–179 and 1,604 words. | None. Wikisource is better here. |

**Coverage expectation:**

- 1,391 talks automatic.
- 2 talks automatic after the cut.
- 2 talks manual. Each is a missing passage of roughly 1–3 printed pages, re-keyed from the [archive.org scans](https://archive.org/details/JoDV21).

Unknown: how accurate Wikisource is against the printed page. No scan comparison was run. The 99.5% agreement with BYU may not be independent evidence, because both texts could descend from the same e-text.

Proofreading status (Verified):

- 1,426 of 1,428 subpages are plain wikitext with no scan behind them, so ProofreadPage has no status for them.
- History of 10 sampled pages: all created in 2007 by user Bochica, with summaries such as "Added header, text, page breaks, scan corrections".
- Only `Index:Journal of Discourses, Volume 20.pdf` exists. Its 12 Page-namespace pages are 11 "Proofread" (quality 3) and 1 "Without text"; they back the 2 transcluded volume 20 subpages.
- Last-revision years: 917 pages last edited in 2014 and 490 in 2026. Pin `revid` and re-diff on each refresh.

## Start page and page range from the source (question 3)

Read the start and end pages from the Wikisource text. The package label `lbl` is a cite page, so it never gives the range.

- Wikisource's first `{{page break|N}}` equals the start of the volume page's range for 1,407 of 1,415 pages that have both. Its last marker gives the end page. Verified.
- Against BYU, the start page matches for 1,388 of 1,393 pairs and the end page for 1,378 of 1,393. Verified.
- The package label's page equals BYU's start page for only 140 of 1,395 talks. It equals the page of one of the talk's own citation spans for 1,395 of 1,395. Verified: `lbl` is the page of one cite (the build reads `cit.Volume`/`cit.Page`, `tools/build-citation-data.js` `sourceLabel`). Use it only as that cite's page.
- Per-cite pages are in the BYU DB (`citation.Page`). Inferred: that is the source for the page-anchor fallback.

## Citation spans and scroll targets (question 5)

In BYU's J HTML the citation span is BYU's own insertion, for example `…sounding brass, or a tinkling cymbal<span class="citation" id="73652">…1 Cor. 13:1</a></span>`. The printed discourse has no reference text at that point. 46,613 J cites; all 46,613 have a span in the bundled HTML, which holds 46,699 spans in total.

| Method | Result (Verified, measured on BYU's text with BYU's span as truth) |
| --- | --- |
| **Verse reference alone.** Take the longest run of shared words between the verse text and the talk; the guess counts as a hit when the span sits 5 words before to 40 words after the run's end. | 20,040 (43.0%) hit. 6,026 (12.9%) share no 3-word run with the verse at all; these are allusions and topical cites. Restricted to the cite's page: 24,738 (53.1%) hit. |
| **Transfer by alignment.** Map BYU's span position onto the Wikisource words; it counts only when the 4 words before the span sit inside one exactly matching block. | 45,527 of 46,699 (97.5%) map. 1,088 fail the strict rule. A further 84 were not tried: they sit in talk 210002 and in talk 200004, which was scored before its rendered text was used. Of those mapped, 45,258 (99.4%) land on the same printed page as BYU's. |
| **Page anchor.** Use the cite's page (`citation.Page`), shown as the page-break anchor. | Available for every cite that has a page. Precise to one printed page (two columns). |

Inferred: "from the verse reference alone" does not reproduce BYU's targets. Transfer by alignment does, then the page anchor, with the verse-text match as an optional step on that page.

Where the positions come from is a rights question. The marker's position comes from BYU's placement, which is part of the same allusion judgment the cite records. Map #52's standing reading bars reusing BYU's allusion judgments only for copyrighted corpora, and J is public domain. The shipped marker holds no BYU text, and the snippet is re-cut from the public-domain Wikisource text. Inferred: this falls within the standing reading.

The match used scripture text from [bcbooks/scriptures-json](https://github.com/bcbooks/scriptures-json) as a measurement aid only; nothing from it ships. Its book names were mapped to shard slugs in canonical order.

## Rights evidence for the bundled result (questions 1 and 4)

| Element | Evidence | Status |
| --- | --- | --- |
| Discourse prose (published Liverpool, 1854–1886) | "all works published in the United States before January 1, 1931, are in the public domain" ([Copyright Office](https://www.copyright.gov/what-is-copyright/), cited in issue 50). JoD was printed in England, and that statement covers US publication; U.S. terms for foreign works published before 1931 lead to the same result. Wikisource's parent page [Journal of Discourses](https://en.wikisource.org/wiki/Journal_of_Discourses) (revision 13432762) carries `{{PD-old}}`. 0 of 1,428 subpages carry their own license template, so they inherit from the parent. | Verified tags. US public domain: Inferred. |
| Wikisource transcription | Wikisource contributions are released under CC BY-SA 4.0 and GFDL "unless otherwise noted" ([Wikisource:Copyright policy](https://en.wikisource.org/wiki/Wikisource:Copyright_policy), revision 15195841, 2025-07-11). [Terms of Use §7(g)](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content) (revision 554823): reuse "must comply with the underlying license(s)". [Compendium §313.4(A)](https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf) (chapter dated 01/28/2021): "A work that is a mere copy of another work of authorship is not copyrightable", listing "Photocopying, scanning, or digitizing a literary work". | Inferred: a faithful OCR transcription adds no protectable authorship, so the body text is public domain. Attribution is still cheap: a byline line or the provenance file naming the Wikisource revision. |
| Wikisource contributor additions | The header's "(Online document scan of …)" note, author links, categories, `{{SIC}}` (3 pages), `{{Similar}}` (5) and `{{other versions}}` (2) are contributor material. The `section` heading and the subtitle line in `notes` transcribe the printed heading. | Verified that these occur. Inferred: drop them and keep the printed heading. |
| BYU's J HTML as a fallback (question 4) | Body: public-domain text with spelling modernised (measured above). [Compendium §313.4(B)](https://www.copyright.gov/comp3/chap300/ch300-copyrightable-authorship.pdf) lists "Editing that merely consists of spelling and grammatical corrections" as de minimis. §313.6(D) and 17 U.S.C. §103(b): protection of new material "does not affect or enlarge" protection of the public-domain material. BYU adds spans with reference labels, header fields, links to BYU PDFs and CONTENTdm, and paragraph ids. BYU's About page reads "All rights reserved" (issue 50). | Inferred: stripped of BYU's markup, the text is unprotected in the US. **Not needed:** Wikisource covers 1,393 of 1,395, and BYU's copy is worse on talk 120037. Keep BYU HTML as a build-time alignment input only. Unknown: any contract or app-terms limit on the BYU data outside copyright. |
| Page scans for the 2 manual passages | [archive.org `JoDV01`…`JoDV26`](https://archive.org/details/JoDV21) are 26 volume items in the `folkscanomy` collection, with no license metadata. Google/Oxford scans such as [`journaldiscours01youngoog`](https://archive.org/details/journaldiscours01youngoog) are marked `NOT_IN_COPYRIGHT`. [Commons: Volume 20 PDF](https://commons.wikimedia.org/wiki/File:Journal_of_Discourses,_Volume_20.pdf) has 384 pages and is tagged public domain. | Verified metadata. Inferred: a transcription from any of them is public domain. |
| Outside the US | All 52 J speakers died by 1933 (Inferred from general biography; not checked). That puts the prose out of term in life+70 countries, but not yet in life+100 countries (Mexico) for the latest-dying speakers. | Unknown for life+100 jurisdictions. The map's bar is a reasonable-basis reading; Wikisource's own posture is US law. |

## Unknown, and what settles it

- **Wikisource accuracy against the print.** Diff a sample of pages against the archive.org scans. This is build-time QA, not research.
- **Whether the owner fixes Wikisource upstream.** The 2 missing passages could be added to Wikisource before re-pulling. That would be a public edit, so it is the owner's call; the alternative is a local patch file with its own provenance.
- **Rights in life+100 jurisdictions** for the 4–5 speakers who died after 1925.
- **Any BYU data-use terms outside copyright.** This only matters if BYU text ships, which this design avoids.
