# Early conference and Journal of Discourses cites: how many are verbatim quotations

Text matching against public-domain scripture recovers **58.5%** of early General Conference (E) cites and **15.0%** of Journal of Discourses (J) cites as verbatim quotations of the cited verse. The rest are near-quotations (12.1% / 18.1%) or allusions and paraphrases that only BYU's editorial judgment links to a verse (29.4% / 66.8%). The citation span labels in the bundled talk HTML are BYU's own, not the speaker's: only 1.0% (E) and 0.3% (J) of cites have the speaker naming the reference beside the quote.

Measured October 6, 2026, against `main` at `76d54c9` for the go/no-go decision ([issue 61](https://github.com/danielbaldwin47/Translations-and-Citations/issues/61)). Modern conference is not measured here; its cites are named by the talk's own footnotes and links ([Footnote locator](https://github.com/danielbaldwin47/Translations-and-Citations/issues/66): 90.8% to 100% found).

**Verified** means a script run on the bundled data; **Inferred** means a consequence drawn from it.

## Results (Verified)

Share of cites by the longest run of words shared between the talk text before the citation span and the cited verse(s).

| Corpus | Volume | Cites judged | Verbatim (8+ words) | Near (5-7 words) | Allusion | Excluded |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| E | Bible | 10,170 | 55.9% | 12.0% | 32.0% | 4 |
| E | Book of Mormon | 1,967 | 61.2% | 11.9% | 26.9% | 0 |
| E | D&C and Pearl of Great Price | 5,124 | 62.6% | 12.3% | 25.0% | 127 |
| E | all | 17,261 | 58.5% | 12.1% | 29.4% | 131 |
| J | Bible | 31,137 | 17.8% | 18.1% | 64.1% | 57 |
| J | Book of Mormon | 3,253 | 9.7% | 18.1% | 72.2% | 5 |
| J | D&C and Pearl of Great Price | 11,582 | 9.1% | 18.2% | 72.7% | 579 |
| J | all | 45,972 | 15.0% | 18.1% | 66.8% | 641 |

Controls:

- Chance baseline: scoring every cite against the wrong verses (v+7) gives 1.6% verbatim in E and 0.4% in J, so false verbatim hits are negligible.
- Window: adding 300 characters after the span moves every share by under one point (E 58.8%, J 15.6%).
- OCR attribution: a misread D&C verse number would put words on a neighbouring verse. Checking the verses either side turns only 18 of 1,914 E and 52 of 10,527 J non-verbatim D&C/PGP cites verbatim, so OCR quality does not explain the low J share.

Span labels (`tools/research-cite-explicit.js`): all 64,155 E and J citation spans have the shape `<span class="citation" id="N"><a onclick="sx(this,N)"> </a><a onclick="gs(N)">REFERENCE LABEL</a></span>`, sitting after the quoted words. 99.7% (E) and 99.9% (J) of span texts are reference labels; the remainder are front-matter labels such as "BM Title Page". The label is inserted mid-sentence in sampled spans, and only 18 of 17,456 E spans and 94 of 46,699 J spans repeat a reference already present in the adjacent text, so the label is BYU's, not the speaker's.

Speaker-written references (`tools/research-cite-author-refs.js`): with every span stripped, a reference-looking string (book plus digits, or n:n) sits within 120 characters of the span's position for 174 of 17,456 E cites (1.0%) and 158 of 46,699 J cites (0.3%). This is an upper bound: it also matches section and chapter mentions that are not references.

## Method

- Talk text: the paragraph text up to the citation span, last 600 characters, from the bundled talk HTML (`src/citations/data/talks/{talkId}.html.gz`). Other cites' labels and Journal of Discourses page markers are stripped. Every cite found its span; the shard snippet was never needed.
- Scripture: the four public-domain inputs of the TPJS research (KJV, Gutenberg eBook 10; Book of Mormon, Gutenberg eBook 17; the 1923 D&C and 1929 Pearl of Great Price scans on archive.org), parsed by `tools/research-tpjs-index.js`. SHA-256 of the files used: `0204adae…eed83c0` (kjv), `ac4bbea7…a7a6882` (bom), `f08c5262…b383a` (dc1923), `ca4560fc…063360` (pgp1929).
- Match: the longest common run of tokens between the talk text and the cited verses joined in order (ranges expanded, capped at 10 verses). Verbatim at 8 or more words, or 6 or more when the cited text is under 8 words; near at 5 to 7; allusion otherwise.
- Excluded: cites whose verses have no text in the inputs (the 1923 D&C lacks sections 137-138 and the Official Declarations; the scan drops about 4% of D&C verse numbers). A further 110 E and 324 J cites had only part of their range present and were judged on that part.

## Caveats

- The near class mixes short exact quotes, altered quotes and stock phrases (15-example hand check, Inferred). A permissive reading of "mechanically recoverable" is verbatim plus near: about 70% in E and 33% in J.
- Ranges over 10 verses were cut to their first 10 (378 E, 1,122 J cites); a quotation from later in the range scores as an allusion.
- The KJV and Book of Mormon inputs use modern verse numbers and, for the Book of Mormon, modern wording; nineteenth-century speakers quoted the 1830 to 1879 text, which may push the J Book of Mormon share slightly low (Inferred).

## Rerun

```
mkdir -p source-data/scripture && cd source-data/scripture
curl -L -o kjv.txt     https://www.gutenberg.org/cache/epub/10/pg10.txt
curl -L -o bom.txt     https://www.gutenberg.org/cache/epub/17/pg17.txt
curl -L -o dc1923.txt  https://archive.org/download/doctrinecovenant0000jose_n3n7/doctrinecovenant0000jose_n3n7_djvu.txt
curl -L -o pgp1929.txt https://archive.org/download/pearlofgreatpric0000jose_d8d6/pearlofgreatpric0000jose_d8d6_djvu.txt
cd ../..
node tools/research-cite-verbatim.js            # about 8 seconds; --control for the baseline, --after for the wider window
node tools/research-cite-explicit.js
node tools/research-cite-author-refs.js
```

The scripts are research scripts, not part of the extension, the build or the checks.
