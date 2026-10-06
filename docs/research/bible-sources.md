# Bible translation sources for the public release (issue #56)

**Recommendation.** Bundle the **Berean Standard Bible (BSB)** as the no-setup default, converted at data-build time from the publisher's USFM into the panel's IR. Bundle the **World English Bible (`engwebp`)** as a second public-domain choice. Both cost the operator $0, need no network, and carry no doctrinal condition. Keep **api.bible with the reader's own key** as the only keyed path; it alone supplies NIV/NKJV/etc. today, at the reader's own Starter quota. Do not ship a developer YouVersion key, and do not call any aggregator at runtime: bolls.life serves NIV/ESV/NKJV with no stated license, and the open-license aggregators only re-serve what can be bundled. Drop bible-api.com.

Checked **October 5, 2026**, unauthenticated public GET/HEAD requests only (no accounts, no email). Part of map [#52](https://github.com/danielbaldwin47/Translations-and-Citations/issues/52); vocabulary from `GLOSSARY.md` "Release". Reuses [issue-50-public-release.md](issue-50-public-release.md) for API.Bible, Crossway and the first YouVersion pass; it cites that note rather than restating it.

Labels: **Verified** = read on a primary source (URL given) or measured on October 5; **Inferred** = a consequence drawn from verified facts; **Unknown** = needs an account or a written answer.

## Comparison

| Translation / source | License (Verified unless marked) | Bundle size or API | Attribution required | Doctrinal condition | Operator cost |
| --- | --- | --- | --- | --- | --- |
| **BSB** (bereanbible.com USFM) | Public domain since April 30, 2023 | USFM zip 1,598,038 B; 66 books, 4,838,454 B unzipped | None ("appreciated but not required") | None | $0 |
| **WEB** `engwebp` (ebible.org) | Public domain; "World English Bible" is a trademark | USFM zip 2,903,474 B; 19,022,481 B unzipped (Strong's tags) | None | None | $0 |
| KJV `eng-kjv2006` | Public domain outside the UK; UK Crown letters patent | USFM zip 2,461,785 B | None | None | $0 |
| ASV `eng-asv` | Public domain | USFM zip 2,870,455 B | None (courtesy line offered) | None | $0 |
| LSV `englsv` | CC BY-SA 4.0, Covenant Press | USFM zip 2,802,181 B | Copyright + source notice; share-alike | None | $0 |
| NET `engnet` | Permission grant for *quotation*, not an open license | USFM zip 2,912,759 B | "(NET)" + notice after each quotation, hyperlinked | None | $0, but needs written permission to bundle (Inferred) |
| api.bible, reader's own key | Per-version publisher license via the reader's account | REST; Starter 5,000 calls/month per account | Rights holder's notice every display + API.Bible link; FUMS | **Yes**: Statement of Orthodoxy (Apostles' Creed), Acceptable Use | $0 (reader's quota) |
| YouVersion Platform | Per-publisher "Fast-track Bible License" accepted in the portal | REST; 200 requests/hour per account | Version `copyright` after verses, full notice on About | **Yes**: Trinitarian Statement of Faith (not currently collected); "mission" clause | $0, quota shared by every install if the key ships |
| bible.helloao.org | MIT code; texts carry their upstream (ebible.org) licenses | Static CDN JSON, no stated limit | Per upstream text | None | $0, third-party uptime |
| bolls.life | No license stated for NIV/ESV/NKJV/NASB… | Single 14 € server, "please do not" bulk-fetch | n/a | None | Unusable: no rights evidence |
| getbible.net | Public-domain/open CrossWire modules only | ~100,000 requests/hour per IP | Per module | None | $0, adds nothing over bundling |

## Bundled translations

### BSB: the default

- **Rights evidence (Verified).** "The Berean Bible and Majority Bible texts are officially dedicated to the public domain as of April 30, 2023. All uses are freely permitted." [berean.bible/terms.htm](https://berean.bible/terms.htm). "Licensing is not required for any use." [berean.bible/licensing.htm](https://berean.bible/licensing.htm).
- **Name condition (Verified).** Verbatim copies are "invited to bear the Berean name"; derivative works that vary from the official text should not use it. Stripping footnotes and markup is reformatting, not varying the text (Inferred).
- **Attribution (Verified, optional).** Suggested line: "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain." Show it on the version's About row; nothing per display is required.
- **Download (Verified).** [bereanbible.com/bsb_usfm.zip](https://bereanbible.com/bsb_usfm.zip), 1,598,038 bytes, Last-Modified October 2, 2026 ("3rd Printing"), SHA-256 `f0c56438eb89c98e8f62c5c00461e25cc35b098ad5b179bc350cede759ee5f87` on October 5. USX, USJ, plain text and spreadsheet are also offered on [berean.bible/downloads.htm](https://berean.bible/downloads.htm). The text is still being revised, so record the hash of the file a build used.
- **Markup (Verified, marker counts).** Section headings (3,016 `\s1`, 80 `\s2`), parallel-passage references (`\r`), paragraphs (12,283 `\p`) and poetry (`\q1`/`\q2`), footnotes (9,708 `\f`), words of Jesus (2,840 `\wj`), Psalm titles (`\d`). No Strong's tags. This maps onto every IR feature the panel renders, which WEB does not (no headings).
- Prefer the publisher file over ebible.org's `engbsb` copy (3,017,139 bytes), which has no `\wj` and only `\m` paragraphs (Verified).

### WEB `engwebp`: the second choice

- **Rights evidence (Verified).** "The World English Bible is in the Public Domain … 'World English Bible' is a Trademark of eBible.org. You may copy, publish, proclaim, distribute, redistribute, sell, give away … All we ask is that if you CHANGE the actual text of the World English Bible in any way, you not call the result the World English Bible any more." [ebible.org/engwebp/copr.htm](https://ebible.org/engwebp/copr.htm).
- **Edition (Verified).** `engwebp` is the 66-book edition using "LORD", the closest to a KJV reader's expectations. `eng-web` (3,244,083 B, already cited in the issue-50 note) is the "Yahweh" edition with Apocrypha; `engwebu`, `eng-webbe`, `engwebpb`, `eng-web-c` and `engwmb` (World Messianic Bible) are siblings under the same license. [worldenglish.bible](https://worldenglish.bible/), [details page](https://ebible.org/find/details.php?id=engwebp).
- **Markup (Verified).** Paragraphs (8,170 `\p`) and poetry, 2,464 footnotes, 4,580 `\wj`, **no section headings**. Every ebible.org USFM tags each word with Strong's numbers (`\w word|strong="H1234"\w*`); strip them at conversion. Formats: USFM, USFX (3,314,065 B), VPL; no OSIS or JSON download.

### Not chosen as defaults

- **KJV** is the site's own text, so it adds nothing beside the page (Inferred). ebible.org states the UK letters patent: permission is needed "to print this translation in the United Kingdom or import printed copies into the UK … This royal decree has no effect outside of the UK" ([copr](https://ebible.org/eng-kjv2006/copr.htm), Verified). Whether an electronic copy reaching UK users falls under the patent is Unknown; another reason to leave it out.
- **ASV** is public domain ([copr](https://ebible.org/eng-asv/copr.htm), Verified) but has no headings and no `\wj`.
- **LSV** is CC BY-SA 4.0 ([copr](https://ebible.org/englsv/copr.htm), [lsvbible.com](https://www.lsvbible.com/), Verified), but its USFM has one `\p` per chapter (no paragraphing), no headings, no `\wj`. Share-alike would attach to any modified LSV files we ship (Inferred).
- **NET**: "The NET Bible® Scripture text (without the NET Bible notes) may be quoted in any form … without written permission … contingent upon the quoted text being followed by the designation (NET) and an appropriate copyright acknowledgment"; free apps must use "(NET)" at the end of the quotation, hyperlinked to netbible.org when online; "For permissions expressly not granted above inquire by e-mail." [netbible.com/copyright](https://netbible.com/copyright/) (Verified). The terms speak of quoting and printing, so a full-Bible bundle needs written permission (Inferred). No "1,000 verses" rule appears on the current page (Verified absent).
- **Other open texts** (Verified on their ebible.org copyright pages): Majority Standard Bible (public domain; no paragraphs or `\wj`), Free Bible Version (CC BY-SA 4.0), Open English Bible (CC0, incomplete Old Testament), Translation for Translators (CC BY-SA 4.0, a paraphrase), Unlocked Literal Bible (CC BY-SA 4.0). None beats BSB on completeness plus markup.

### Bundle format

Convert USFM to the IR that `src/background/api.js` already renders, in a `tools/` script like `build-citation-data.js`; the extension keeps no build step (ADR-0002). One file per book keyed by the USFM codes in `src/shared/books.js` (`GEN` … `REV`), each chapter a list of blocks:

```
{ type: 'heading', text }                                   // from \s1, \s2 (and \d as a heading or para style)
{ type: 'para', style, runs: [ {t:'v', n:'3'} | {t:'txt', s, wj} ] }   // \p, \m, \q1, \q2, \li → style; \wj → wj:true
```

Drop footnotes, cross-references, `\r` and Strong's tags at conversion (the IR has no slot for them). Size: BSB text with all markers, notes and cross-references removed measures 4,120,324 bytes (Verified, measured); IR JSON adds per-run overhead, so expect roughly 5-7 MB per translation uncompressed (Inferred). Chrome's package limit is 2 GB (issue-50 note), so size does not constrain the choice.

## Keyed path: api.bible with the reader's own key

Keep it, as an optional setting behind the bundled default. It is the only path with verified NIV/NKJV access today and is already built.

- **What it uniquely offers (Inferred from the issue-50 note).** Licensed copyrighted versions (NIV, NKJV, and whatever the reader's account is granted) with no operator cost or relay: each reader is the account holder under their own Starter plan (5,000 calls/month, three copyrighted Bibles, noncommercial). The relay problems in that note (sections 9.5(e), 12) concern a developer-held key; a reader-held key avoids them.
- **Obligations the extension must implement (Verified in the issue-50 note).** Rights holder's notice on every display; visible API.Bible citation with hyperlink on Starter; refresh cached text within 30 days; FUMS reporting. Replace today's remote-script FUMS injection with the packaged manual GET to `fums.api.bible/f3` (a Store rejection risk otherwise).
- **Doctrinal flag (Verified, issue-50 note).** The terms' Statement of Orthodoxy is the Apostles' Creed, and Acceptable Use requires "message consistency of the Christian Bible and statement of orthodoxy". The reader accepts these when creating their own account; the setup screen should say so.
- **Unknown.** Whether section 12's DRM clause binds a reader-key text panel; whether manual FUMS must report cached displays (U3 in the issue-50 note). Both are support@api.bible questions; neither blocks the bundled default.

## YouVersion Platform: not now

New findings close most of the issue-50 note's U4 and B4 Unknowns.

- **Catalog (Verified).** Text is gated per publisher license: "Each Bible is available only to apps whose organization has accepted the relevant publisher license" ([error codes](https://developers.youversion.com/error-codes.md)). The portal bundle ([App-CJZee01L.js](https://platform.youversion.com/assets/App-CJZee01L.js)) lists Biblica (NIV, NIrV), Lockman (NASB, AMP), BroadStreet (TPT) and smaller publishers as "Fast-track Bible License" choices; NIV is ID 111 in the [quick reference](https://developers.youversion.com/quick-reference.md). Accepting a license shares "Developer PII" with the publisher (terms, Verified). ESV, NKJV, NLT and NRSV/NRSVue appear in no primary source (Unknown).
- **Quota (Verified, portal bundle fallback FAQ).** "YouVersion Platform accounts have a limit of 200 requests per hour", applied "per App Key at the edge", raisable once an app is live. A key shipped in the extension shares 200/hour across every install (Inferred), so it fails a public release at any real use.
- **Key placement (Verified, conflicting).** The portal labels it "Public App Key" and the docs embed it in browser code ([display-bible-html](https://developers.youversion.com/guides/display-bible-html.md)); the API answers `access-control-allow-origin: *`. The terms still say keys are ones "You agree to keep confidential and not share with any third-party". Keys are not origin-restricted (Inferred from the app form and Apps API schema).
- **Caching (Verified).** The terms are silent; the docs say "Cache responses when possible"; the SDK caches no passage text. Per-publisher license text (Biblica's caching rules) is shown only after login (Unknown).
- **Reporting (Inferred).** No FUMS-like call; the SDK sends `X-YVP-App-Key` and `X-YVP-Installation-Id` headers, which a REST client can send too.
- **Who can register (Verified).** Individuals can ("Register as an Organization or an Individual"); an address is required.
- **Doctrinal flag (Verified).** The Statement of Faith reads "God … has eternally existed as the Father, the Son, and the Holy Spirit. These three are coequal and are one God." The registration form holds an `agreeToSoF` field and the dialog is wired, but submission checks only `agreeToS`, so assent is not currently collected (Verified in the bundle; could be switched on). The terms bar material "contrary to YouVersion or Life.Church's mission" ([mission](https://www.youversion.com/mission/)). A Latter-day Saint-serving app sits in a grey zone under that clause, at YouVersion's discretion (Inferred).
- **Verdict (Inferred).** A developer key cannot carry the public release (200/hour shared, confidentiality term). A reader-own-key YouVersion option would give NIV at 200/hour per reader, but it asks the reader to register as an app developer and accept Biblica's license, which is more setup than api.bible for no extra verified version. Revisit only if api.bible's terms block the reader-key path.

## Aggregators: none at runtime

- **bible.helloao.org (Verified).** Run by AO Lab; MIT code at [github.com/HelloAOLab/bible-api](https://github.com/HelloAOLab/bible-api); static JSON on S3/CloudFront; USFM book codes; 1,256 translations, 51 English; no NIV/ESV/NKJV (404). Each translation's `licenseUrl` points to its ebible.org (or berean.bible) page. Its docs claim "no copyright restrictions whatsoever", which is wrong for the CC BY-SA and NET texts it serves (Inferred); rights evidence is each text's upstream license. Whole dataset downloadable ([downloads](https://bible.helloao.org/docs/guide/downloads.html)). Useful as a converter reference or a JSON source for BSB/WEB; bundling makes a runtime dependency unnecessary.
- **bolls.life (Verified).** One developer's single server ([API doc](https://github.com/Bolls-Bible/bain/blob/master/docs/API.md), GPL-3.0). Serves NIV, NIV2011, ESV, NKJV, NASB, NLT, CSB, NRSVCE, MSG and more, with full text returned live. Its only rights statement is a takedown line ([disclaimer](https://bolls.life/static/disclaimer.html)): "If you find any copyright infringement, please report the developer". No publisher license is stated anywhere. It provides no rights evidence for copyrighted text; exclude it.
- **getbible.net (Verified).** "A project of trueChristian.church"; 12 English texts, all public domain, GPL or CC BY-SA, from CrossWire modules ([translations.json](https://api.getbible.net/v2/translations.json)); about 100,000 requests/hour per address. Adds nothing over bundling.
- **bible-api.com (Verified, issue-50 note).** Public-domain texts only; 15 requests/30 s per IP; asks callers not to download an entire Bible. Replaced by the bundle.

## Unknown

| Item | Settles it |
| --- | --- |
| api.bible: DRM (section 12) and FUMS for cached displays under a reader-held key | support@api.bible |
| YouVersion: ESV/NKJV/NLT/NRSV availability; Biblica Fast-track license caching rules | A portal account: `GET /v1/bibles?all_available=true&language_ranges[]=en`, and read the license at acceptance |
| YouVersion: whether the live FAQ's limit still reads 200/hour | The same account's dashboard |
| KJV: whether electronic distribution to UK users falls under the letters patent | Moot if KJV is not bundled |
| NET: whether a full bundle in a free extension is permitted | Email per [netbible.com/copyright](https://netbible.com/copyright/); only if NET is wanted |
