# Issue 66: how often the footnote locator places an unanchored modern cite

**Answer.** The footnote locator as #59 states it (the first footnote whose scripture link matches the cite's book, chapter and verses) places 20% of sampled pre-2013 cites, 84% of 2013–19 cites and 86% of 2020+ cites. It also puts 5% of 2020+ cites on the wrong paragraph. Three changes lift it to **91% / 100% / 97% hits with 0–2.6% wrong**:

1. Also accept scripture links written in the body paragraph itself. Older talks mostly use these instead of footnotes.
2. Let a chapter-level link labelled with a chapter span ("2 Nephi 31–32") match a cite of a whole chapter in that span.
3. Pick the k-th matching link, where k is the cite's rank among the talk's cites of the same reference.

Every rule that loosens the verse match (any shared verse, or chapter only) adds wrong paragraphs faster than it adds hits.

Measured October 6, 2026, against branch base `695c209` and the live `churchofjesuschrist.org` pages. Scope: [issue 66](https://github.com/danielbaldwin47/Translations-and-Citations/issues/66), part of [#52](https://github.com/danielbaldwin47/Translations-and-Citations/issues/52). The rule feeds the fetched-excerpt spec (#62) decided in [#59](https://github.com/danielbaldwin47/Translations-and-Citations/issues/59).

**Verified** means measured in this run or read in the repository at `695c209`. **Inferred** means a reading of those measurements.

## The rule to specify

This is the **recommended rule**. In the tables below it is "footnotes + inline, exact or whole chapter, ranked". Each step is Verified as measured in the tables below.

1. **Candidates.** Collect every `a.scripture-ref` link in reading order, from two places:
   - inside a footnote `li[id^="note"]`: the candidate sits at the body paragraph that holds that note's first `a.note-ref[data-scroll-id="noteN"]` marker;
   - directly inside a body paragraph: the candidate sits at that paragraph.
2. **Parse a link.** The path is `/study/scriptures/{volume}/{book}/{chapter}`, and `book` is the repository's book slug (`src/shared/books.js`). The `id` query parameter lists verses: `p1,3,14`, `p23-p24`, `p8-p10`. A link with no `id` covers the whole chapter. When its label also ends in a span ("2 Nephi 31–32", or a bare "6–9"), it covers every chapter in that span. A link under `/jst/` never matches.
3. **Match.** A link matches a cite when one of these holds:
   - its book and chapter are the cite's and its verse set **equals** the cite's `v` (`"1-3,14"` = {1, 2, 3, 14});
   - the cite's `v` is a whole chapter (`/^1-\d+$/`) and a chapter-level link covers the cite's chapter.
4. **Rank.** Find the cite's rank k among all of the talk's cites with the same book, chapter and `v`, by citation id ascending, anchored cites included. Take the k-th matching candidate, or the last one when there are fewer. Those cites are all in the same book's shard.
5. **No match:** a miss. Per #59 the row shows its reference line only, and the reader falls through to the next target rule.

A wrong placement cannot be repaired by a cascade. Adding "else the only paragraph with an overlapping verse, else the only paragraph linking the chapter" gains at most 0.7 points of hits in the sample (0.2 in the corroboration run) and adds wrong placements (Verified, rule comparison below).

The rule has to run on the **fetched HTML**, before sanitizing. `talk-view.js:144` unwraps every `<a>`, so the rendered talk has neither `a.note-ref` markers nor `a.scripture-ref` links. Paragraph ids survive (`copyOf`, `talk-view.js:160`), so the locator can return a paragraph id for `findTarget` to look up in the rendered talk (Verified by reading the code; the design is Inferred).

## Results per era

**Population (Verified):** 11,863 unanchored `G` cites. 724 are 1971–2012, 2,319 are 2013–19 and 8,820 are 2020+. 2,217 of the 2,319 come from March 2018 to October 2019.

**Sample (Verified):** 381 cites in 235 talks, drawn at random (seed 66) by era and volume, with every volume represented in every era.
- **Scored:** the cites whose ground-truth paragraph was found.
- **Excluded:** cites whose snippet gives no key (`snippetKey` returns null, under 20 characters), or whose key is not in the live text.

| Era | Sampled | Scored | Excluded: no key | Excluded: not in live text |
| --- | --- | --- | --- | --- |
| 1971–2012 | 100 | 76 | 9 | 15 |
| 2013–19 | 127 | 122 | 1 | 4 |
| 2020+ | 154 | 149 | 2 | 3 |

**Rates (Verified).** "Wrong" is a paragraph other than the ground truth; "miss" is no paragraph.

| Era | #59 rule as stated: hit / wrong / miss | Recommended rule: hit / wrong / miss |
| --- | --- | --- |
| 1971–2012 | 19.7% / 1.3% / 78.9% | **90.8% / 2.6% / 6.6%** |
| 2013–19 | 84.4% / 0.0% / 15.6% | **100% / 0% / 0%** |
| 2020+ | 85.9% / 5.4% / 8.7% | **97.3% / 1.3% / 1.3%** |

**Corroboration (Verified):** every unanchored cite in the 235 fetched talks, 5,690 of the 11,863 (48%). These cites cluster by talk, so treat the sample as the per-era estimate and this run as a check on it.

| Era | Scored | #59 rule as stated | Recommended rule |
| --- | --- | --- | --- |
| 1971–2012 | 431 of 552 | 19.5% / 0.9% / 79.6% | **96.3% / 0.7% / 3.0%** |
| 2013–19 | 1,640 of 1,715 | 84.0% / 1.9% / 14.1% | **99.6% / 0.1% / 0.3%** |
| 2020+ | 3,360 of 3,423 | 89.2% / 3.6% / 7.2% | **98.6% / 0.6% / 0.8%** |

**Unknown:** how the locator does on the 91 of 552 pre-2013 cites (16%) whose BYU snippet is not in today's online text. With no ground truth they cannot be scored.

## Rule comparison

Hit / wrong / miss, in percent. First number: the sample. In brackets: every unanchored cite in the fetched talks. All figures Verified.

- **First:** the first match in reading order.
- **Ranked:** the k-th match (step 4).
- **Unique:** accept only when every match falls in the same paragraph.

| Rule | 1971–2012 | 2013–19 | 2020+ |
| --- | --- | --- | --- |
| Footnotes, exact, first (#59 rule as stated) | 19.7/1.3/78.9 (19.5/0.9/79.6) | 84.4/0/15.6 (84.0/1.9/14.1) | 85.9/5.4/8.7 (89.2/3.6/7.2) |
| Footnotes, exact, ranked | 19.7/1.3/78.9 (20.2/0.2/79.6) | 84.4/0/15.6 (85.8/0.1/14.1) | 89.9/1.3/8.7 (92.4/0.4/7.2) |
| Footnotes, exact, unique | 18.4/1.3/80.3 (19.3/0.2/80.5) | 84.4/0/15.6 (82.0/0.1/18.0) | 81.9/0.7/17.4 (86.2/0.3/13.5) |
| Footnotes, verse overlap, first | 19.7/2.6/77.6 (18.8/2.3/78.9) | 82.8/1.6/15.6 (81.8/4.9/13.4) | 83.9/8.7/7.4 (86.8/7.4/5.8) |
| Footnotes, chapter only, first | 19.7/5.3/75.0 (15.8/6.7/77.5) | 72.1/13.1/14.8 (74.6/13.7/11.7) | 79.9/14.1/6.0 (79.1/16.3/4.5) |
| Footnotes, exact > overlap > chapter, first | 22.4/2.6/75.0 (20.4/2.1/77.5) | 85.2/0/14.8 (85.7/2.6/11.7) | 87.9/6.0/6.0 (90.7/4.8/4.5) |
| Footnotes + inline, exact, ranked | 86.8/2.6/10.5 (94.4/0.5/5.1) | 96.7/0/3.3 (95.9/0.1/4.0) | 94.6/1.3/4.0 (94.6/0.6/4.8) |
| **Footnotes + inline, exact or whole chapter, ranked (recommended)** | **90.8/2.6/6.6 (96.3/0.7/3.0)** | **100/0/0 (99.6/0.1/0.3)** | **97.3/1.3/1.3 (98.6/0.6/0.8)** |
| Recommended, then overlap-unique, then chapter-unique | 90.8/2.6/6.6 (96.3/0.9/2.8) | 100/0/0 (99.7/0.2/0.1) | 98.0/1.3/0.7 (98.8/0.7/0.4) |

What the comparison shows (Inferred):
- **Ranking beats "first".** On 2020+ it cuts wrong placements from 3.6% to 0.4% at no cost in hits. A talk that links one verse twice gets two BYU cites, and taking the first match puts both on the first paragraph. That ranking works also implies BYU citation ids run in reading order.
- **Requiring the link count to equal BYU's cite count is a bad gate.** That variant of ranking (accept only when the talk has exactly as many matching links as BYU has cites) abstains on 35% of 2020+ cites (Verified), because the two counts often disagree.

## Miss causes, counted

Each cite that failed was classified by what the ground-truth paragraph's own footnotes and links say about the cited chapter. Counts cover every unanchored cite in the fetched talks (1971–2012 + 2013–19 + 2020+). All counts Verified.

**Under the #59 rule as stated** (818 misses):

| Cause | 1971–2012 | 2013–19 | 2020+ |
| --- | --- | --- | --- |
| Scripture link in the body text, no footnote | 320 | 168 | 78 |
| Chapter-span link ("2 Nephi 31–32") or chapter-only link | 5 | 53 | 124 |
| Reference written as text, not linked | 0 | 6 | 10 |
| Verse range or list differs from the cite, or other verses of the chapter | 1 | 1 | 15 |
| Joseph Smith Translation footnote (Bednar 2022 note 20 is one) | 2 | 3 | 7 |
| No footnote on the paragraph and no link | 11 | 1 | 7 |
| The paragraph's footnotes do not reference the verse | 4 | 0 | 2 |

Under the recommended rule, 45 cites still miss. The 2020+ row:

| Cause | Misses |
| --- | --- |
| Other verses of the chapter | 8 |
| Joseph Smith Translation | 7 |
| Chapter-only | 3 |
| Reference written as text, not linked | 3 |
| Another chapter | 2 |
| No footnote, no link | 2 |
| Verse list differs | 1 |
| Footnotes do not reference the verse | 1 |

The two other eras:
- **1971–2012** (13 misses): no footnote 6, footnotes do not reference the verse 4, Joseph Smith Translation 2, verse list differs 1.
- **2013–19** (5 misses): Joseph Smith Translation 3, chapter-only 1, verse list differs 1.

**Joseph Smith Translation, checked on the issue's example:** cite 138466 (John 1:1, `liahona/2022/05/14bednar`) is a miss, not a wrong placement. Note 20 has no scripture link at all, and note 22 links John 1:1, 14, which is not an exact match.

**Wrong placements under the recommended rule** (25 in the corroboration run):
- 13 are the same reference linked again elsewhere, with the rank off by one.
- In the rest, the true paragraph has no link to the verse but another paragraph does. This includes 3 with no footnote, 6 with unlinked or unrelated footnotes, 2 that link another chapter and 1 Joseph Smith Translation.
- **"See also" footnotes:** 9 of the 25 wrong placements chose a footnote whose text says "see". "See" footnotes cause no misses of their own.

## Fetch time and size

One fetch per era, measured with `curl --compressed` and a browser User-Agent. All figures Verified.

| Era | Talk | Over the wire | Uncompressed | Time |
| --- | --- | --- | --- | --- |
| 1993 | `ensign/1993/11/combatting-spiritual-drift…` | 74.6 KB | 252 KB | 0.15–0.33 s |
| 2006 | `ensign/2006/11/the-gathering-of-scattered-israel` | 63.3 KB | 269 KB | 0.10–0.52 s |
| 2018 | `ensign/2018/05/…/am-i-a-child-of-god` | 63.3 KB | 262 KB | 0.20–0.52 s |
| 2019 | `ensign/2019/05/53gong` | 69.3 KB | 294 KB | 0.13–0.52 s |
| 2022 | `liahona/2022/05/14bednar` | 57.5 KB | 235 KB | 0.06–0.34 s |
| 2024 | `general-conference/2024/10/57nelson` | 56.4 KB | 223 KB | 0.09 s |

Across the 216 fresh fetches of the sample run (Node `fetch`, 3 in flight), the median time was 671 ms (1971–2012), 761 ms (2013–19) and 677 ms (2020+). The slowest fetch took 2.25 s. All 235 talks loaded: one returned a 502 on the first run and loaded on the second. The 2006 session-less URL loaded without a redirect.

## Side finding: April 2019 talk URLs are broken

All 30 April 2019 talks in `sources.json` (609 cites, all unanchored) have URLs of the form `https://www.churchofjesuschrist.org/study/study/ensign/2019/05/{session}/{slug}`. Those URLs return 404. The live talk is at `/study/ensign/2019/05/{slug}`, with no session segment, which returns 200. Today the reader cannot load these talks live, and they have no bundled copy (`talks/8388.html.gz` does not exist). All facts here are Verified. This study repaired the URLs before fetching, so the April 2019 sample cites are scored. The fix belongs in the build's URL transform (Inferred).

## Method

All steps Verified.

1. **Data.** Read every shard in `src/citations/data/citations/`. A cite's chapter comes from its shard's `index`; no cite is filed under two chapters. Kept corpus `G` cites without `a`.
2. **Sample.** For each era, each volume received a quota proportional to its share (era quotas 90 / 120 / 150), with a minimum of 12 per volume, drawn by a seeded random number generator.
3. **Fetch.** Fetched each talk's `sources.json` URL with a browser User-Agent, at most 3 in flight, and repaired session-less URLs as `talk-source.js` `pickSessionUrl` does. Retried once on a 5xx error. The HTML was cached outside the repository.
4. **Parse.** Body paragraphs are the `p` and `h1`–`h6` elements carrying `data-aid` whose id does not start with `note`. Footnotes are `li[id^="note"]`.
5. **Ground truth.** The truth is every body paragraph whose text holds `snippetKey(sn)` under `snippetMatches`, both from `talk-source.js`. When the key sits in a footnote instead (5 cites, all pre-2013), the truth is the paragraph holding that footnote's marker.
6. **Script.** The measuring script (about 370 lines, network-bound) is not committed. To re-run it, rebuild it from this method.
