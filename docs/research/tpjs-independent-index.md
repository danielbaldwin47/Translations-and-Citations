# TPJS independent index: what the public-domain text yields on its own

An independent index built from the public-domain 1938 text recovers **728 verse-to-page links on 199 of the 371 pages**. That comes to 263 links from the compilation's own explicit references (168 references, all 168 parsed correctly) and 613 from verbatim quotation matching (90% correct on a hand-checked sample of 60), with 148 links found by both. Measured against Galbraith's 11,348 annotations, the union reproduces **436 (3.8%)**. The ceiling for any verbatim method is low: only 1,042 of Galbraith's cites (9.2%) share even a six-word run with their page. The rest are allusions and topical links that no mechanical method recovers. **Recommendation: build quotation matching for version 1.** It nearly triples the index, gives the reader a passage anchor for every link, and costs one offline tool plus a one-time hand review of a fixed output. The index stays thin all the same. Permission for Galbraith's set ([#58](https://github.com/danielbaldwin47/Translations-and-Citations/issues/58)) remains the only route to a full TPJS index.

Checked **October 6, 2026**, for [issue 63](https://github.com/danielbaldwin47/Translations-and-Citations/issues/63) (part of the [map, issue 52](https://github.com/danielbaldwin47/Translations-and-Citations/issues/52); decision context [#60](https://github.com/danielbaldwin47/Translations-and-Citations/issues/60); rights findings [#53](https://github.com/danielbaldwin47/Translations-and-Citations/issues/53) and `docs/research/tpjs-rights.md` on branch `research/tpjs-rights`), against repository commit `76d54c9`. **Verified** means I ran the measurement or read the primary record on October 6. **Inferred** means a reading or consequence drawn from verified facts. **Unknown** means the evidence was not found. Galbraith's annotations served only as a coverage yardstick. No cite in either method's output comes from them (see "Rights evidence").

## Yield table (Verified)

A **link** is one (TPJS page, book, chapter, verse) pair. A reference to a verse range counts once per verse. A chapter-only reference ("the 14th chapter of John") has no verse, so it counts only in the chapter column.

| Method | References or matches | Verse links | Chapter links | Pages reached | Precision (hand-checked) | Galbraith cites reproduced (verse / chapter level) |
|---|---|---|---|---|---|---|
| Explicit references | 168 references (133 to verses, 35 to chapters only) | 263 | 163 | 72 | **168 of 168 parsed correctly** (100%; 95% Wilson interval 97.8-100%) | 154 (1.4%) / 239 (2.1%) |
| Quotation matching (6-word shingles, run of 8 or more words) | 422 quotation events | 613 | — | 194 | **54 of 60 correct verse** (90%; interval 80-95%). 43 verbatim quotations, 7 same-text, 4 allusions; 6 wrong (2 parallel passages, 4 stock phrases) | 393 (3.5%) / 526 (4.6%) |
| **Union** | — | **728** (148 found by both) | 425 | **199** | ~92% (Inferred: weighted from the two rows) | **436 (3.8%)** / 601 (5.3%) |
| Broader matching (run of 6 or more words, higher rarity floor) | — | 814 (229 more than the primary setting) | — | — | **24 of 40 marginal matches correct** (60%; interval 45-74%) | 497 (4.4%) |

- **Galbraith overlap, defined.** A Galbraith cite counts as reproduced when the union holds a link on the same page, in the same book and chapter, and one of the cite's verses. At the chapter level, the same page and chapter suffice.
- **Overlap by volume** (verse level): KJV 373 of 4,996; D&C 50 of 3,686; PGP 7 of 503; Book of Mormon 6 of 2,163.
- **Galbraith ceiling** (Verified): 1,042 of 11,348 Galbraith cites share any 6-word run with their page (1,830 share 5 words; 3,352 share 4 words, mostly noise). The primary setting reaches 393 of those 1,042. The other ~90% of his set are "direct and contextual" judgments, in his foreword's words, that only a human reader supplies.
- **Galbraith pages:** his set reaches all 371 pages. The independent union reaches 199. A page without a link cannot be opened from a verse.

## Explicit references (Verified)

- **Method.** A regex pass over the annotation-free body text, in eight forms:
  - `Book ch:v[-v][, v]` ("Rev. 22:17", "Romans 11:25, 26 and 27", "Revelation, 19:10th verse", "Philippians (3:20, 21)", "Book of Moses, chapt. 1:39");
  - D&C forms ("D. and C. 105:33", "Doc. and Cov., Sec. 93:29", "Sec. 93:33-35"), with continuation lists ("D. and C. 5:18-19, 29:8-10, 101:23-25");
  - ordinal forms ("the 6th chapter of Hebrews, 1st and 2nd verses", "Mark, 16th chapter, 15th, 16th, 17th, 18th verses", "the 37th verse of 23rd chapter of Matthew", "2nd Epistle of Peter, 1st chapter, 16th to last verses");
  - "the eighty-fourth section of the Doctrine and Covenants, 49-53";
  - "the fiftieth Psalm, from the first to the fifth verse";
  - D&C section lists ("Doctrine and Covenants, Section 124, 127, 128 and 132");
  - "see Isaiah 11;";
  - bracketed chapter-only references ("(Rev. 19)", "[2 Peter 1.]").

  A book name that is also a person's name (Moses, Alma, John, Daniel) counts only with a chapter:verse or "Nth chapter" after it.
- **Hand check: all 168 references** were read in context (listing `sample-explicit.txt`, see "Reproducibility"). Every one is a scripture reference parsed to the book, chapter and verses the text names, and every one exists in the scripture texts below. 118 of the 168 have words of the referenced verse quoted on the same page; the other 50 are "see …" or "read …" pointers. One reference is under-specified: "the 21st of the fourth chapter of Matthew" (p. 349) parses as Matthew 4, not 4:21.
- **Non-scripture references excluded:** "DHC 6:613", "T&S 3:902", "M&A 1:137", "Vol. 2:370", "Article I, Section 10" (the U.S. Constitution), and the "1902 edition" year after "Moses 7:62".
- **Known misses (recall, Inferred):** anaphoric references that lean on an earlier sentence are not extracted. Examples: "In the 20th chapter we find" (p. 65), "Verse 4 reads" (p. 293), "In chapter 12, verse 9", "took for his text 1st chapter, 6th verse" (p. 369, Rev. 1:6, which quotation matching recovers). The body holds 55 phrases with "chapter", "verse", or "Psalm" in them; the ones not covered by the forms above are of this kind.
- **Who wrote them.** Some references are Joseph Smith's own. Others sit in Joseph Fielding Smith's 1938 editorial notes or in B. H. Roberts's notes reprinted from *History of the Church* (for example "Note by Elder B. H. Roberts", p. 354). All of it is public-domain text (see "Rights evidence").

## Quotation matching (Verified unless marked)

**Setting chosen:**
- shingle length 6 words;
- a shingle is ignored when it occurs in more than 3 scripture verses (the `maxdf` cap);
- a match is the longest run of consecutive matching shingles between a page and one verse, and is kept when the run is 8 or more words;
- the run's **specificity** must be at least 6: the summed `log10(N/df)` rarity of its distinct words over all 41,793 verses, so "of the kingdom of God and" scores low and "Michael, the prince, the archangel" scores high.

Three filters follow:
1. **Bible-first:** a non-Bible verse whose span is at least 80% inside Bible matches on the same page is dropped. This handles Mark 16:17 against Mormon 9:24.
2. **Dominated:** a verse whose span is at least 80% inside a strictly longer match for another verse is dropped. This handles synoptic parallels such as Matthew 13:12 against Mark 4:25.
3. **Corpus formula:** an identical run of 11 or fewer words recurring on 4 or more pages is dropped ("Church of Jesus Christ of Latter-day Saints", "the gift of the Holy Ghost by the laying on of").

Normalization lowercases, removes apostrophes, keeps letters only, and maps `shew → show` (and its variants).

**Why 6/8.** A sweep over shingle lengths 5-8, `maxdf` 3 or 10, minimum runs n or n+2, specificity 0-8, and the filters on or off. At 5-word shingles with 5-word runs the matcher returns 5,088 to 9,626 links, mostly stock phrases. At 8-10 words it drops short real quotations ("add to your faith virtue; and to virtue knowledge", 9 words). Six-word shingles with an 8-word run floor keep those. While choosing, I read the sweep's Galbraith-agreement column alongside the hand checks. That column is a proxy only: Galbraith also cites many parallels, so it overstates precision (70% Galbraith agreement against 60% hand-checked precision in the broader sample).

| Shingle n | Max verses per shingle | Min run | Min specificity | Filters | Links | Share also in Galbraith |
|---|---|---|---|---|---|---|
| 5 | 3 | 5 | 0 | off | 5,088 | 25% |
| 5 | 3 | 7 | 6 | on | 772 | 72% |
| 6 | 3 | 6 | 8 | on | 918 | 68% |
| **6** | **3** | **8** | **6** | **on (+ dominated, formula)** | **613** | **79%** |
| 7 | 3 | 9 | 6 | on | 603 | 75% |
| 8 | 3 | 10 | 6 | on | 526 | 78% |

(Sweep rows before the dominated and formula filters were added carry only the Bible-first filter. The bold row is final.)

**Hand check of the primary setting** (60 matches, seeded random sample; labels mine).

| Label | Count | Meaning | Examples |
|---|---|---|---|
| Q: verbatim quotation of that verse | 43 | The page quotes the verse's words. | p. 201 → 1 Cor. 15:29; p. 97 → Matt. 13:30; p. 273 → Mark 1:7 (Galbraith lacks it) |
| T: same text | 7 | The page *is* the text later canonized as that verse: the Liberty Jail letter (D&C 121-123) and the Nauvoo instructions (D&C 130-131). | p. 142 → D&C 121:37; p. 146 → D&C 123:17 |
| A: allusion | 4 | A distinctive phrase from that verse, not a quotation. | p. 77 → D&C 82:19 "with an eye single to the glory of God"; p. 375 → D&C 107:3 "after the order of the Son of God" |
| P: parallel passage | 2 | Same words, wrong verse. | p. 319 → D&C 33:10 (the page quotes John the Baptist, Matt. 3:3); p. 365 → Rev. 8:13 (the page means Rev. 14:6) |
| S: stock phrase | 4 | No reference intended. | p. 314 → JS—H 1:69 "baptism by immersion for the remission of sins"; p. 360 → D&C 20:41 "the baptism of fire and the Holy Ghost"; p. 79 → D&C 84:2 "the western boundaries of the State of Missouri" (also an OCR verse-number error, see below); p. 150 → D&C 49:14 "the Holy Ghost by the laying on of" |

**A link to the right verse** (Q + T + A): 54 of 60. **Strict verbatim quotation** (Q): 43 of 60. Galbraith cites 46 of the 60; of the 14 he does not, 5 are same-text matches, 3 are true quotations, and 6 are the errors.

**Broader setting, marginal matches** (40 of the 229 matches the broader setting adds; run of 6 or more words, specificity 8 or more): Q 14, A 10, P 9, S 7. So **24 of 40 correct**. Loosening adds links at 60% precision, about one wrong link in every 2.5 added.

**False-positive modes** (from the 100 checked matches):
1. **Parallel passages and repeated wording.** Synoptic parallels (Luke 17:33 for Mark 8:35; Luke 17:3 for Matt. 18:15). Bible wording reused in the D&C (D&C 33:10, 84:65, 86:10, 129:3, 33:6). Repeated lines inside a chapter (Matt. 13:43 for 13:9; Rev. 6:5 for 6:2; Rev. 8:13 for 14:6). Psalms quoted in the New Testament (Ps. 8:6 for 1 Cor. 15:27). The Bible-first and dominated filters remove most of these; equal-length ties survive.
2. **Stock doctrinal phrases** ("baptism by immersion for the remission of sins", "the Holy Ghost, according to the Scriptures", "hold out faithful to the end").
3. **Scriptural idiom that is not a quotation** ("be faithful over a few things", "a drawn sword in his hand").
4. **Names and place phrases** ("Sidney Rigdon and Frederick G. Williams", "in the state of New York", "Adam down to the present time").
5. **OCR verse attribution.** When the 1923 D&C OCR misreads a verse number, that verse's words attach to the previous verse, so a match lands one verse early (D&C 84:3 reported as 84:2).

**Same-text links** are correct links but a distinct class: 83 of the 613 links are D&C 121-123 and 130-131 matched to the TPJS pages that carry those texts. Galbraith cites only some of them (2 of the 7 in the sample).

**Volumes:** KJV 438 links, D&C 148 (83 of them same-text), Book of Mormon 14, PGP 13. Quotation matching is a Bible finder. Joseph Smith rarely quotes the Book of Mormon verbatim, and the Book of Mormon cites in Galbraith's set are almost all contextual (6 of 2,163 reproduced).

## Texts used and their edition caveats (Verified unless marked)

| Text | Source | Parse check | Rights status (US) | Caveat |
|---|---|---|---|---|
| TPJS body | `src/citations/data/talks/270007-270395.html.gz` (the 371 `T` sources), with `<div class="footnotes">` lists, `<span class="footRef">` markers and BYU's page chrome removed. Joseph Fielding Smith's lettered 1938 notes (`textFootnotes`) kept. 153,117 words. | No `footRef`, `citation` span or footnote list survives. | Public domain since 1966 (#53, finding 1). | BYU's body text matched the **1940 second-edition** scan on 97.3% of 5-word shingles (#53). Not compared against the 1938 first edition (Unknown). |
| KJV | [Project Gutenberg eBook #10](https://www.gutenberg.org/ebooks/10), updated October 29, 2024 | 31,102 verses, 66 books. Present for 8,242 of 8,248 Galbraith-cited verse keys; the 6 misses are two-word verses below the parser's 3-word floor ("Jesus wept") and Galbraith keys that do not exist (Matt. 3:39). | Public domain in the US. | The file does not name its base printing. In the UK the KJV is under Crown letters patent (Inferred; irrelevant here because no KJV text ships). |
| Book of Mormon | [Project Gutenberg eBook #17](https://www.gutenberg.org/ebooks/17), updated October 11, 2025 | 6,604 verses, 15 books; all 2,759 cited verse keys present. | Gutenberg's clearance: US public domain. | Modern versification, no 1981 chapter headings or footnotes. 2 Nephi 30:6 reads "pure and delightsome", the 1840 and post-1981 reading (Inferred from the edition history; not compared against a 1920 scan). A 1920 scan is the unambiguous public-domain alternative. |
| Doctrine and Covenants | archive.org [`doctrinecovenant0000jose_n3n7`](https://archive.org/details/doctrinecovenant0000jose_n3n7) (1923 printing of the 1921 edition), `_djvu.txt` OCR | 3,478 verses in sections 1-136. 4,647 of 4,837 cited D&C 1-136 verse keys present (96.1%). | Published 1923: US public domain since January 1, 2019. | Lacks D&C 137, 138 and the Official Declarations (canonized 1976-1981); the 191 cited keys there cannot match. OCR misses about 4% of verse numbers (attribution error mode 5 above). |
| Pearl of Great Price | archive.org [`pearlofgreatpric0000jose_d8d6`](https://archive.org/details/pearlofgreatpric0000jose_d8d6) (1929 printing), `_djvu.txt` OCR | 609 verses (Moses, Abraham, JS—Matthew, JS—History, Articles of Faith). 655 of 672 cited keys present (97.5%). | Published 1929: US public domain since January 1, 2025. | JS—Matthew and JS—History are "Writings of Joseph Smith 1 and 2" in this edition; verse numbers match today's. The Abraham facsimile captions are dropped. |

Rejected sources: the 1908 D&C (`thedoctrineandco00smituoft`, public domain) has unusable OCR. The 1917 and 1920 PGP scans were not needed.

## Rights evidence the independent index rests on

1. **The text is public domain.** *Teachings of the Prophet Joseph Smith* was registered as A 115513 (March 12, 1938) and not renewed by March 12, 1966. HathiTrust marks it `pd`. The underlying Joseph Smith sources are public domain on their own (Verified in #53, findings 1-2). That covers Joseph Fielding Smith's selection, headings and notes, including every explicit reference counted here.
2. **The links are facts read off public-domain texts** (Inferred legal reading).
   - "Page 82 quotes Rev. 22:17" and "page 14 refers to Romans 11:25-27" are facts.
   - Facts are not copyrightable (*Feist Publications v. Rural Telephone Service*, 499 U.S. 340 (1991)).
   - The tool finds them mechanically from two public-domain texts. Galbraith's judgment, the "direct and contextual" selection that #53 found protectable, plays no part in which links exist.
   - The scripture texts are build inputs only: the output carries page, book, chapter, verse and a character offset, never scripture text.
3. **Galbraith's set is not an input** (Verified for this research; a requirement for the production tool).
   - Extraction reads only the stripped TPJS text and the four scripture files. The yardstick is loaded afterwards to score coverage.
   - One contamination risk is recorded honestly: the sweep table showed Galbraith agreement while I chose thresholds. The chosen rules are generic (shingle rarity, run length, Bible-first) and name no verse or page.
   - The production tool should not read `citations/*.json` at all. A validator may report coverage against the personal pack.
4. **The stripping is complete** (Verified). The `talks/27xxxx` files hold Galbraith's apparatus only in the footnote list and the `footRef` markers. Both are removed before any measurement, and a scan of the stripped text finds no `footRef`, `citation` span or footnote list.

## Cost of building it as a tool (Inferred)

- **Shape.** `tools/build-tpjs-index.js` would:
  - read the stripped public-domain TPJS text, which the pack build produces anyway for the bundled reader;
  - read the four scripture files from the gitignored build-input directory (`source-data/`, as the BYU databases are now), fetched once by a documented recipe;
  - write one cached input, for example `source-data/tpjs-index.json`, with rows `{page, slug, ch, v, method: "explicit"|"quote", offset}`.

  The pack build reads that file and stays offline and deterministic, as #60 requires.
- **Size.** The research script is 600 lines and runs in about 4 seconds (Verified: `time` on this machine). A production cut drops the sweep, sampling and yardstick code. Explicit references alone are ~150 lines plus tests. Quotation matching adds ~200 lines plus the two OCR parsers, which are the fragile part (verse-number heuristics, footnote filtering). Estimate: 1-2 days including `node:test` cases for the parsers and filters.
- **Precision fix.** The TPJS text never changes, so the output is a fixed list of about 728 rows. One hand review of those rows (an estimated 2-3 hours) can delete the ~50 wrong links. The reviewed list then becomes the committed input, and the review is never repeated. A Bible-only variant (438 links, no OCR) is the fallback if the D&C and PGP parsers prove brittle. It gives up the 83 same-text links and about 65 D&C quotations.
- **Reader anchor (Inferred, important for the spec).** The reader's `bodyPassage` target (ADR-0006) finds a cite's passage through Galbraith's `footRef` markers, which the stripped bundle no longer has. Both methods yield a character offset on the page: the explicit match position or the quotation run. That offset is the replacement passage anchor, so the independent index carries its own scroll targets.

## Recommendation

**Build quotation matching for version 1, at the 6/8 setting, with a one-time hand review of its output.**
- It raises the index from 263 to 728 links and the reachable pages from 72 to 199. It is the only source of passage anchors for pages without an explicit reference.
- At 90% unreviewed precision, it would ship about 60 wrong links. The review brings that close to zero for a few hours of work, because the corpus is fixed.
- Do not loosen to the broader setting. Its marginal links are 60% correct.

Set expectations in the spec and the listing copy: the independent TPJS index holds about 4% of what the personal build shows and reaches about half the pages. Galbraith's permission (#58) remains the route to a full TPJS index.

## Unknowns

- **1938 against 1940 text.** All TPJS text here is BYU's transcription, matched to the 1940 second edition (#53). Whether the first edition differs on any matched page was not checked.
- **Precision beyond the sample.** 90% rests on 60 matches (interval 80-95%). The hand review in the build ticket measures it exactly.
- **Explicit-reference recall.** No independent gold set exists. Anaphoric references are known misses, and their count is not measured.
- **Book of Mormon edition.** The Gutenberg text's base printing is not named; the 2 Ne. 30:6 reading suggests a post-1981 text. A 1920 scan comparison was not run. The output carries no scripture text, so this bears on matching fidelity, not on what ships.
- **D&C 137.** TPJS carries Joseph Smith's January 1836 vision (canonized as D&C 137 in 1976). It is absent from every pre-1931 D&C, so its same-text links cannot be found from a public-domain D&C. They could be found from the TPJS page itself, if the owner wants them.
- **Non-US protection** of the 1938 compilation (Joseph Fielding Smith died in 1972), as #53 noted. Facts extracted from it are unaffected (Inferred).

## Reproducibility

Research script: `tools/research-tpjs-index.js`. Its header marks it as a research script; it is not part of the extension, the build, or the checks.

1. Download the inputs into one directory (sha256 of the files used):
   ```
   curl -L -o kjv.txt     https://www.gutenberg.org/cache/epub/10/pg10.txt          # 0204adae…eed83c0
   curl -L -o bom.txt     https://www.gutenberg.org/cache/epub/17/pg17.txt          # ac4bbea7…a7a6882
   curl -L -o dc1923.txt  https://archive.org/download/doctrinecovenant0000jose_n3n7/doctrinecovenant0000jose_n3n7_djvu.txt   # f08c5262…b383a
   curl -L -o pgp1929.txt https://archive.org/download/pearlofgreatpric0000jose_d8d6/pearlofgreatpric0000jose_d8d6_djvu.txt   # ca4560fc…063360
   ```
2. Primary run: writes `explicit.json`, `quotes.json`, `summary.json`, `sample-explicit.txt`, `sample-quotes.txt` (the 60-match hand-check listing, seed 63):
   ```
   node tools/research-tpjs-index.js --scripture-dir <dir> --out <out> --sample 60
   ```
3. Marginal sample of the broader setting:
   ```
   node tools/research-tpjs-index.js --scripture-dir <dir> --out <out2> --minrun 6 --minspec 8 --sample 40 --marginal-to <out>/quotes.json
   ```
4. Sweep: `--sweep` writes every setting's yield and coverage into `summary.json`.

Full sha256: `kjv.txt 0204adaed1f25700aa854218cae63c7172228c41088f335e99167a071eed83c0`, `bom.txt ac4bbea7d6f19905cf10d21465e0f491a41e2dd3cc2a64e9ee622b1f4a7a6882`, `dc1923.txt f08c5262a821e5bf00caa95303db962401bef771aac1f55e8fc4b18c7a0b383a`, `pgp1929.txt ca4560fcba9a27f69098a700e8fcd5eada203a59bc7ea5ff4518bffc64063360`.
