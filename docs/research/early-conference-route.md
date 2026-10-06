# Early conference talks: live fetch from BYU, link out as fallback

**Recommendation.** Open an early General Conference talk (corpus `E`, 1942-1970, 1,821 talks) by fetching BYU's fragment `https://scriptures.byu.edu/content/talks_ajax/{talkId}` from the content script on the reader's click, and render it in the existing inline reader. The fetch needs no new host permission: BYU answers any request that carries an `Origin` header with `Access-Control-Allow-Origin: *`. The fragment's talk body is byte-for-byte the bundled HTML, so `findTarget`, the citation-span scroll and local highlights keep working unchanged. **Fallback:** when the fetch fails, the reader's external link opens BYU's viewer at `https://scriptures.byu.edu/#:t{hex talkId}${citId}`. The Internet Archive scan of the printed Conference Report is a second reading destination, at `https://archive.org/details/conferencereport{YYYY}{a|sa}/page/{startPage}`. The same fetch serves Teachings of the Prophet Joseph Smith (`T`) and Journal of Discourses (`J`) talks with identical markup, and BYU's fragment also serves modern (`G`) talks.

Checked **October 5, 2026** (Mountain Time; BYU's `Date` headers read Tuesday, October 6, 02:52 GMT) against repository commit `9f10ef051a522db76e6e940d15e5d10308eecba8`. This note extends [issue-50-public-release.md](issue-50-public-release.md) ("Older talks have reading destinations", "Mapping sample") and does not restate it. It answers [issue #55](https://github.com/danielbaldwin47/Translations-and-Citations/issues/55) under the bar and standing readings of [map #52](https://github.com/danielbaldwin47/Translations-and-Citations/issues/52). Terms follow `GLOSSARY.md` ("Citation data", "Release").

**Verified** means an observed response, a counted measurement, or quoted primary source code or documentation. **Inferred** means a consequence drawn from verified facts. **Unknown** means it was not observed. The pass used about a dozen unauthenticated GET/HEAD requests: one or two per sampled talk id, plus `robots.txt`, the BYU home and About pages, `base.js`, one citation list, and three Internet Archive files. There was no crawl, account, email or publication.

## Route comparison

| | Live BYU fetch into the inline reader (recommended) | BYU viewer link-out (fallback) | Internet Archive scan link-out (second fallback) |
| --- | --- | --- | --- |
| Inline reader | Kept | Lost: opens a new tab | Lost: opens a new tab |
| Scroll to the cite | Kept: the citation span ids match the bundle (see "Response shape") | `$citId` hash segment, Verified in code only | Page level only, via `/page/{startPage}` |
| Highlights | Kept, Inferred: the rendered text equals today's bundled text | Lost | Lost |
| Offline | Lost. Inferred: repeat opens within 90 days may come from the browser HTTP cache (`Cache-Control: max-age=7776000`) | Lost | Lost |
| New permission | None (CORS `*`) | None | None |
| Rights evidence | User-triggered display of a page the user could open, which the host serves to any origin (see "Rights evidence") | Linking, expressly blessed by the Church terms | Linking to the rights holder's own upload |
| Dependency | BYU host and its `Access-Control-Allow-Origin` behaviour; neither has a durability promise | BYU host and its hash grammar | archive.org |

## 1. Fetching from the extension

**Verified, response headers.** `curl -sI https://scriptures.byu.edu/content/talks_ajax/889` with no `Origin` header returned:

```
HTTP/1.1 200 OK
Date: Tue, 06 Oct 2026 02:52:48 GMT
Server: Apache
Strict-Transport-Security: max-age=63072000
Upgrade: h2
Connection: Upgrade
Content-Length: 38012
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Vary: Origin,Accept-Encoding,User-Agent
Cache-Control: max-age=7776000
Expires: Mon, 04 Jan 2027 02:52:48 GMT
Content-Type: text/html; charset=utf-8
```

The same GET with `Origin: https://www.churchofjesuschrist.org` returned identical headers plus one line:

```
Access-Control-Allow-Origin: *
```

`Vary: Origin` explains the difference: the server adds the CORS header only when a request carries an `Origin`. A GET with `Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop` for talks 10001 (`J`), 270163 (`T`) and 6141 (`G`) returned `HTTP/1.1 200 OK`, `Access-Control-Allow-Origin: *` and `Content-Type: text/html; charset=utf-8` each time.

**Verified, Chrome documentation.**
- Content scripts "initiate requests on behalf of the web origin that the content script has been injected into and therefore content scripts are also subject to the same origin policy". The documentation adds: "Cross-origin requests are always treated as such in content scripts, even if the extension has host permissions." An extension service worker "can talk to remote servers outside of its origin, as long as the extension requests host permissions." Source: [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
- In Chromium's own explanation, a content script's cross-origin fetch carries "an Origin request header with the page's origin, and the server has a chance to approve the request with a matching Access-Control-Allow-Origin response header". A relaying background context should fetch only "URLs the extension author intends". Source: [Changes to Cross-Origin Requests in Chrome Extension Content Scripts](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/).
- The Church study page's CSP is `frame-src … ;style-src 'self' 'unsafe-inline' *` and has no `connect-src` (`curl -sI` of `/study/scriptures/nt/john/3?lang=eng`). The page therefore places no limit on which hosts can be fetched.

**Inferred.**
- A content-script `fetch` of the fragment succeeds under CORS without a `scriptures.byu.edu` host permission, with no new install warning and no wider Store review surface.
- `credentials: 'omit'`, which `liveFetch` already uses (`src/citations/talk-source.js:69`), is required: a wildcard `Access-Control-Allow-Origin` does not admit credentialed requests.
- This keeps the "citations are content-script-only" rule in `CLAUDE.md`.
- If BYU drops the wildcard, the contingency is a service-worker relay under `host_permissions: ["https://scriptures.byu.edu/*"]` that takes a numeric talk id and builds the URL itself, never accepting a URL from the content script.

**Verified, other headers.** `X-Frame-Options: DENY` rules out embedding BYU's viewer in an iframe inside the panel.

## 2. Response shape

**Verified, comparison with the bundle** (talk 889, J. Reuben Clark, "The Constitution", April 1957). The fragment (38,012 bytes) is BYU's talk `<div class="gcera">` wrapped in viewer chrome. Before the body comes a `#centernavbar` with the label "1957–A:44, J. Reuben Clark, Jr., The Constitution", print and About links with `onclick` handlers, and the `#centercontent > #talkcontent > .nano > #talkwrapper` wrappers. The bundled `src/citations/data/talks/889.html.gz` (37,563 bytes) is the same `div.gcera` inside a standalone `<html>` page. After whitespace normalisation the `div.gcera` content is identical: 37,181 characters with a common prefix to the end.

**Verified, the reader's content root.** `pickContentRoot` (`src/citations/talk-view.js:191`) picks the first match of `.gcbody`, `.discourseBody`, `.page`, … that holds more than 200 characters. Parsing that root in both versions:

| Talk | Corpus | Root picked | Root text, bundled vs live | Ids inside the root | `class="citation"` ids, whole file |
| --- | --- | --- | --- | --- | --- |
| 889 | E | `.gcbody` | 15,704 = 15,704 characters, equal | equal | 12 = 12, same order |
| 10001 | J | `.discourseBody` | 19,406 = 19,406, equal | equal (58) | 33 = 33, same order |
| 270163 | T | `.page` | 2,966 = 2,966, equal | equal (31) | 31 = 31, same order; `footRef` 17 = 17 |

**Inferred.**
- Because the reader renders only that root, the viewer chrome never reaches the panel, and the render contract holds unchanged: ids survive, `textContent` equals the bundled text, so `findTarget`'s citation-span and body-passage targets (`src/citations/talk-source.js:230`) and saved highlight offsets carry over.
- The sanitizer already unwraps the `<a href="javascript:void(0)" onclick="gs(…)">` links the body contains, since `A` is not allowlisted (`talk-view.js:144`). Those links are present in the bundle too.
- **Snippets are no longer needed to place the scroll.** The references-only index drops snippets for copyrighted corpora, so `bySnippet` has nothing to search. The citation span is found by BYU's `citId`, so the index must keep that id for each `E`, `J` and `T` cite.

**Code cost (Inferred).**
- `CORPUS_PLANS.E` (`talk-source.js:38`) becomes a live plan with target `citationSpan`.
- A BYU URL builder from `talkId` sits beside, not inside, `fetchLiveTalk` (`:135`), which carries the Church-only pre-2013 URL repair.
- The `html == null` bundled fallback (`:260`) becomes "no text", which leads to the link-out.
- The fixed external-link label `SITE = 'Open on churchofjesuschrist.org'` (`talk-view.js:50`) becomes per-corpus.
- The `LIVE_TIMEOUT_MS` error state and `panel.keepView(false)` already cover a failed fetch.

## 3. Robots, terms, polite use

**Verified.**
- `https://scriptures.byu.edu/robots.txt` returns `HTTP/1.1 404 Not Found`, so the host states no robots policy.
- The home page links to no terms, license or legal page.
- The About page (`/content/talks_ajax/`) reads: "Scripture Citation Index, Copyright © 2010-2025, Richard C. Galbraith and Stephen W. Liddle. All rights reserved." It also says the site is "our own personal creation", and that its products are "neither made, provided, approved nor endorsed by Intellectual Reserve, Inc." It gives page numbers for 1942-1970 talks against "the Conference Reports".
- No statement of the permission under which BYU hosts the conference text was found.

**Polite-use ceiling (Inferred, proposed for the spec).**
- One fetch per user click on a citation row.
- No prefetch, no background refresh, no bulk or link-check run against `talks_ajax` from installed copies.
- Let the browser HTTP cache honour BYU's 90-day `max-age`.
- Keep the existing 15-second timeout, and retry only on the user's "Try again".
- Persist no fetched text, which matches today's live `G` talks.

## 4. The BYU viewer hash

**Verified in code**, from [`base.js`](https://scriptures.byu.edu/static/homepage/scripts/base.js) (`Last-Modified: Thu, 08 May 2025 17:30:28 GMT`, 3,413 lines):
- `navigate()` runs on load and on `hashchange` (lines 3107, 3111).
- The hash splits on `:` into scriptures, center and sci segments.
- `decodeCenter` (937) sends a center segment `t…` to `decodeTalk` (1164). That function splits off `&query`, then `$target`, sets `currentTalkTarget = target`, parses the id as hex, and requests `/content/talks_ajax/{id}/`.
- The talk success callback calls `scrollToCiteTarget(currentTalkTarget)` (387-388). That runs `$('#' + target).addClass('citematch')` and scrolls to it (2987-2994).
- `encodeTalk` (801) writes `'$' + target.toString(16)`. BYU's own citation list, however, passes the target as a string, for example `getTalk('8007', '129458')` in `/citation_index/citation_ajax/Any/1830/2026/all/s/f/102/20?verses=3`, and a string's `toString(16)` returns it unchanged. **The `$` segment is therefore the decimal citation-span id.** Example: talk 889, cite 22657 (Exodus 20:3-17) gives `https://scriptures.byu.edu/#:t379$22657`.

**Unknown.** Whether this hash opens the talk and highlights the span in a real browser was not run, so it is Verified only as code.

## 5. Internet Archive conference reports

**Verified.**
- The `conferencereport` collection ([advanced search](https://archive.org/advancedsearch.php?q=collection%3Aconferencereport&fl%5B%5D=identifier&fl%5B%5D=date&fl%5B%5D=volume&rows=500&output=json)) holds one English item per conference from 1942 to 1970. April items are `conferencereport{YYYY}a`, October items `conferencereport{YYYY}sa`, 57 in all, with no `1957sa` because the October 1957 conference was cancelled. The rest of the 98 items dated 1942-1970 are translations, for example `1968aspa` and `197072ger`.
- [`conferencereport1957a` metadata](https://archive.org/metadata/conferencereport1957a): contributor "Church History Library, The Church of Jesus Christ of Latter-day Saints"; sponsor "Corporation of the Presiding Bishop, The Church of Jesus Christ of Latter-day Saints"; `possible-copyright-status` "© Copyright by Intellectual Reserve, Inc. All rights reserved."; no `access-restricted-item`; files include `_page_numbers.json`.
- That item's `_page_numbers.json` maps `pageNumber` "44" to `leafNum` 45. In its OCR text the running head "44 GENERAL CONFERENCE" sits just before "PRESIDENT J. REUBEN CLARK, JR.", matching BYU's heading "1957–A:44".
- BookReader resolves a `/page/{x}` path segment by page label, `n{index}` or `leaf{n}`. See `getPageIndices` and `parsePageString` in [BookModel.js](https://github.com/internetarchive/bookreader/blob/e4c8e6bb9f7e5f48b7655ba41845ef02c0f6707a/src/BookReader/BookModel.js) and the `page`/`mode` schema in [UrlPlugin.js](https://github.com/internetarchive/bookreader/blob/e4c8e6bb9f7e5f48b7655ba41845ef02c0f6707a/src/plugins/url/UrlPlugin.js). `https://archive.org/details/conferencereport1957a/page/44/mode/1up` returned HTTP 200.
- All 1,821 bundled `E` talks carry `<title>{YYYY}–{A|O}:{startPage}, …` with year and session matching `sources.json`. `sources.json` itself holds no page, so the build must emit the start page, a bibliographic fact, into the references-only index.

**Grammar:** `https://archive.org/details/conferencereport{YYYY}{A→a, O→sa}/page/{startPage}`.

**Unknown.** Whether every start page has a page label: one item was checked. A one-time build check over the 57 `_page_numbers.json` files settles it. A missing label can fall back to the item root.

## Rights evidence

| Element | Evidence | Reading under the bar |
| --- | --- | --- |
| Live BYU fetch of `E` text | BYU serves the fragment publicly with `Access-Control-Allow-Origin: *`, has no robots policy and no terms page. The text is Church-copyrighted (Internet Archive metadata above). | Inferred: this is the same reading the map adopted for modern talks, "a user-triggered fetch of a page the user could open". Nothing is bundled, stored or redistributed. The CORS header is technical permission, not a license. BYU's own permission to host the text is Unknown. |
| BYU viewer link | Church terms: "we believe that linking to other websites is legally permissible" ([terms](https://www.churchofjesuschrist.org/learn/legal/terms-of-use/go?lang=eng), quoted in issue-50 note) | Verified as a linking reading |
| Internet Archive link | Uploaded by the Church History Library, sponsored by the Presiding Bishopric; linking only | Verified as a linking reading; the strongest provenance of the three |

## TPJS, Journal of Discourses and modern talks

- **TPJS (`T`).** Verified: same endpoint, same CORS header, and markup identical to the bundle, including the `footRef` and footnote structure the body-passage rule needs. Inferred: the live route serves `T` with no reader change beyond the plan entry. Its rights question, Galbraith's annotated edition, is a separate ticket.
- **Journal of Discourses (`J`).** Verified: same mechanism and identical markup. It is not needed, because the map re-sources JoD from public-domain text.
- **Modern conference (`G`).** Verified: BYU's fragment for 6141 returns the talk with 14 citation spans and the wildcard CORS header. Inferred: it could back up the Church same-origin fetch, landing on citation spans where Church pages lack paragraph anchors. The standing reading keeps the Church fetch, so this is an option, not a recommendation.

## Open items

- **Browser test (Unknown).** Load the extension with `E` switched to the live plan, open talk 889 from Exodus 20, and confirm the scroll and a highlight. Open `https://scriptures.byu.edu/#:t379$22657` and confirm the span highlight.
- **BYU's hosting permission and durability (Unknown).** Settled only by asking BYU, which the issue-50 note's permission request already scopes.
- **Internet Archive page labels (Unknown).** Settled by the 57-item build check described in section 5.
