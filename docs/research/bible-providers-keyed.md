# Keyed Bible providers: is there a better one than api.bible? (issue #98)

**Answer: stay on api.bible's Starter plan as the one keyed path, move the base URL to `https://rest.api.bible/v1`, and add nothing now.** No provider beats it on all three of the ticket's measures. The ones with looser limits each serve a single translation: Crossway's ESV API and Tyndale's NLT API allow 5,000 requests a day against api.bible's 5,000 a month. YouVersion is the only one with more translations per free account (NIV, NIrV, NASB, AMP, TPT and others at 200 requests an hour), but the reader would have to register as an app developer, create an app, and accept each publisher's licence, which is more setup than api.bible, not less. Bible Brain bars offline copies outright, Biblia has no copyrighted English text worth adding, and bolls.life and the NET Bible web service are not keyed and give no licence. The one addition that brings a translation api.bible lacks is **ESV through Crossway's own API**: api.bible says it cannot supply ESV. It needs a code change (an HTML-to-IR converter and a cache capped at 500 verses for ESV) and Crossway's written word on eligibility, since its terms limit the service to use "consistent with the historic Christian understanding of doctrine", including the Trinity. On the host question: `api.scripture.api.bible` is **not being retired on any set date**. api.bible's Legacy Users FAQ says "The old endpoint will be deprecated in the future" but also "There is currently no specific sunset date in place and we do not plan to end support for auto-routing." Two api.bible rules bear on code already shipped: its docs ask that a cache hold "fewer than 500 consecutive verses", and the free plan's quota is monthly.

Checked **October 9, 2026**, using unauthenticated public GET requests only: no accounts and no keys. The anonymous test calls were one NLT `key=TEST` request (Psalm 23 and John 3) and one NET Bible request. This builds on [#56's findings](https://github.com/danielbaldwin47/Translations-and-Citations/blob/research/bible-sources/docs/research/bible-sources.md) and on `docs/research/issue-50-public-release.md` (on `main`), and cites them instead of repeating them.

Labels: **Verified** means read on the cited primary page, or seen in a response on October 9. **Inferred** means drawn from verified facts. **Unknown** means the answer sits behind a login or an unreachable page; the reason is given each time.

## Comparison

"Reader key" means each reader makes their own account and pastes their own key, so the extension ships no credential.

| Provider (path) | Sign-up asks for | Free tier: copyrighted translations | Free tier: limits | Licence holder | Caching terms | Response format | Doctrinal flag | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **api.bible Starter** (today, reader key) | Organisation details (type, HQ, staff count, tax ID if any) and app details (where it's accessed, audience, purpose, description, estimated users); individuals allowed (Verified) | Up to 3 of NIV, NKJV, NLT, NASB, CSB, AMP, MSG, GNT…; no ESV (Verified) | 5,000 calls/month, no overage; 1 free account per person (Verified) | Reader's own account, under api.bible's agreement (Verified) | Terms: refresh at least every 30 days. Docs: hold "fewer than 500 consecutive verses", clear "every 14 days or less" (Verified) | JSON content blocks, HTML or text (Verified) | Statement of Orthodoxy (Apostles' Creed) plus Acceptable Use (Verified) | **Keep** |
| api.bible Pro (reader key, paid) | Same as Starter, plus payment | Copyrighted Bibles with no stated limit (Verified) | 150,000 calls/month; "$29+ / Month" plus licence fees by users and translations (Verified) | Reader's paid account (Verified) | Same as Starter | Same | Same | Not for readers: costs money (Inferred) |
| api.bible Legacy plan (accounts made before Oct 2025) | None: existing accounts carried over (Verified) | Same access as before migration (Verified) | Limits from before migration (Verified); values Unknown, they are per account | Account holder | Same terms | Same | Same | Covers only existing keys, not new readers (Inferred) |
| YouVersion Platform (reader registers own app) | Developer account; Organisation or Individual; address; development stage; Terms of Service; then accept each publisher licence (Verified) | Any "Fast-track" licence accepted: Biblica (NIV, NIrV), Lockman (NASB, AMP), BroadStreet (TPT), MissionAssist and others (Verified); ESV, NKJV and NLT Unknown | 200 requests/hour per app key (Verified) | The reader's org/app, under each publisher licence (Verified) | Terms say nothing about caching; docs say "Cache responses when possible" (Verified) | JSON envelope; passage text as HTML (`format=html`) (Verified) | Statement of Faith (Trinitarian) dialog in sign-up but not required on submit; "mission" clause (Verified) | Not now: more setup than api.bible |
| Crossway ESV API (reader key) | Crossway account, then "create an API Application" (Verified); application fields Unknown (behind login) | ESV only (Verified) | 5,000 queries/day, 1,000/hour, 60/minute; ≤500 verses per query (Verified) | The key holder; individuals allowed (Verified) | Store at most 500 verses or half a book, whichever is less; "periodically clear" (Verified) | JSON wrapper holding HTML or plain-text passages (Verified) | Use only "consistent with the historic Christian understanding of doctrine", including the Trinity (Verified) | Only candidate for a second path: waits on Crossway |
| Tyndale NLT API (reader key, or no key) | Name, email, password; phone, organisation, website and purpose optional (Verified) | NLT, NLT (UK), NTV (Spanish), KJV (Verified) | Key: 500 verses per request, 5,000 requests/day. No key: 50 verses per request, 500/day per IP (Verified) | Key holder, under Tyndale's standard terms (Verified) | No API rule (Verified absent); NLT notice allows quoting up to 500 verses (Verified) | HTML fragment with poetry, heading and red-letter classes (Verified) | Affirm use "consistent with Tyndale's purpose", no creed (Verified) | Adds limits, not translations: NLT is on api.bible already |
| Bible Brain / DBP4 (Faith Comes By Hearing) | Name, email, description of intended use; approval at FCBH's discretion (Verified) | English copyrighted catalogue Unknown (needs a key) | No published limit (Verified absent) | Key holder (Verified) | "No DBP Content may be downloaded or made available for offline use" (Verified) | JSON (Inferred from the API's docs; no response seen) | FCBH Statement of Faith (Verified) | Rejected: bars the chapter cache |
| Biblia API (Faithlife/Logos) | Sign-in, one key per app (Verified) | LEB only; the rest is public domain or original languages (Verified) | "more than 5,000 calls in an hour" counts as excessive (Verified) | Key holder (Verified) | No extracting "for storage in an alternate database system" (Verified) | Text or HTML, optionally in JSON (Verified) | None stated (Verified absent) | Rejected: nothing to add over the bundle |
| bolls.life (no key; rejected in #56) | Nothing | Serves NIV, ESV, NKJV and others (#56, Verified) | No published limit | **None**: only a takedown line (Verified) | None stated | JSON | None | Still rejected: no rights evidence |
| NET Bible web service, labs.bible.org (no key; NET rejected in #56) | Nothing (Verified: answers without a key) | NET only | Unknown: the terms page is behind a Cloudflare check | **None by account**: netbible.com's quotation permission (#56) | Unknown (same reason) | JSON per verse, HTML inside the text (Verified) | None (#56) | Still rejected: not keyed, and full chapters go beyond a quotation grant (#56, Inferred) |

## api.bible (keep)

**Sign-up and plan.**
- Sign-up asks for "what kind of organization you are … where you're headquartered, how many individuals you have on staff, and what (if applicable) your tax ID is", plus the app's "target audience … its purpose, a brief description of it, and your estimated user size" ([Create Your Account](https://docs.api.bible/quick-start/create-your-account), Verified).
- The terms (§17) let an individual describe "themselves if they are individuals … (e.g. non-profit, church, individual, etc)" ([Terms](https://api.bible/terms-and-conditions), Verified).
- Starter is "$0 / Month", lets you "Pick 3 of your favorite copyrighted Bibles", includes "5,000 API calls per month", "No overage protection available", and is "Strictly non-commercial use". Pro is "$29+ / Month" with "150,000 API calls per month" ([sign-up](https://api.bible/sign-up), Verified). The Pro price adds "licensing fees based on monthly active users and selected translations" ([Express licensing FAQ](https://care.api.bible/article/405-express-licensing-faqs), updated October 1, 2026, Verified).
- Bibles are changed in the dashboard: "Edit Plan", then "Edit Bible Licenses" ([Working with Bibles](https://docs.api.bible/quick-start/working-with-bibles), Verified).

**Translations.** The homepage names "NIV, NLT, NKJV, NASB, CSB and more" ([api.bible](https://api.bible/), Verified). "The ESV is not currently available through API.Bible"; it points to Crossway's API ([Express licensing FAQ](https://care.api.bible/article/405-express-licensing-faqs), Verified). The live catalogue renders in the browser after login, so the full Starter list is Unknown.

**New terms since #56.** The Terms of Service are dated "Thu Sep 03 2026" ([Terms](https://api.bible/terms-and-conditions), Verified). Three clauses are new against #56:
- "Each individual or legal entity is strictly limited to a single free-tier account or application." This suits a reader key: one reader, one account (Inferred).
- The NKJV is available on Starter or Pro "only to applications designated as non-commercial whose selected end-user range … does not exceed 5,000 Monthly End Users." With a reader key, each reader's app has one user (Inferred).
- Starter users "are required to include a visible citation and hyperlink to https://api.bible within their application's interface."

**Caching.** The terms and the docs disagree, so follow the stricter of each:
- Terms: "All cached content from API.Bible must be updated at least once every 30 days", and "You are required to check at least every 30 days for content updates" ([Terms](https://api.bible/terms-and-conditions), Verified). The api.bible FAQ also says 30 days ([FAQ](https://api.bible/faq), Verified).
- Docs: "You can cache data, but we request that you limit it to fewer than 500 consecutive verses. We also recommend that you clear your cache every 14 days or less" ([Common Questions](https://docs.api.bible/common-questions), Verified).
- In the code: `C.CHAPTER_TTL_MS` is 30 days, which meets the terms. `CACHE_MAX_ENTRIES` is 500 *chapters* (`src/shared/constants.js:62`, `:68`), which can hold far more than 500 consecutive verses of one Bible. That goes against the docs' request, which is worded as a request, not a rule (Inferred).

**Quota against the code.** `__BTX.rate` limits calls to 5,000 a *day*. Starter allows 5,000 a *month* ([Rate Limiting](https://docs.api.bible/quick-start/rate-limiting), Verified). The rate-limit issue filed in #92's triage covers this.

**Format.** Content comes as "html, json, and text"; JSON is "an array of content blocks with varying display attributes" ([Content Output Formats](https://docs.api.bible/resources/content-output-formats), Verified). That is what `api.js` already turns into IR.

**Doctrinal flag.** The Statement of Orthodoxy (last updated February 2, 2026) is the Apostles' Creed. Acceptable Use (February 25, 2026) requires use "consistent with the Christian Bible and statement of orthodoxy" ([Terms](https://api.bible/terms-and-conditions), Verified).

### Is `api.scripture.api.bible` being retired?

Not on any set date. All quotes below are from the [Legacy Users FAQ](https://docs.api.bible/resources/legacy-users-faq), Verified:
- "The legacy API endpoint (api.scripture.api.bible) will transition to rest.api.bible".
- "Requests to api.scripture.api.bible will be automatically routed to the new API"; "The migration is designed to be seamless with DNS-level routing".
- "The old endpoint will be deprecated in the future", but "There is currently no specific sunset date in place and we do not plan to end support for auto-routing. However, we still recommend that you migrate to the new rest.api.bible endpoint as soon you are able."
- "Migration will occur in phases, with the primary cutover happening on June 2, 2026".
- "Your existing API key will continue to work"; "all API configuration is identical."
- Legacy accounts must "reset your password by June 2027 to ensure continued access to the portal"; this is about the portal, not the API.

Both hosts answer `401` without a key (measured October 9, Verified). Moving needs `https://rest.api.bible/*` in `host_permissions` and `C.API_BIBLE_BASE` changed. A new host may make Chrome ask existing users to approve it again (Inferred; check against Chrome's permission-warning rules before release).

## YouVersion Platform (not now)

- **Sign-up (Verified).** You need a YouVersion Platform account, then you "Provide details about your application and use case and create an app" to get an App Key ([Authentication](https://developers.youversion.com/authentication.md)). The portal's form offers "Organization" or "Individual", asks for an address and a development stage, and blocks submission until "You must agree to the Terms of Service to proceed" ([portal bundle](https://platform.youversion.com/assets/App-BDSNWjYR.js)).
- **Translations (Verified).** "Each Bible is available only to apps whose organization has accepted the relevant publisher license" ([Error Codes](https://developers.youversion.com/error-codes.md)). The portal's Fast-track list maps Biblica to NIV and NIrV, The Lockman Foundation to NASB and AMP, BroadStreet to TPT, then MissionAssist and others ([portal bundle](https://platform.youversion.com/assets/App-BDSNWjYR.js)). Crossway, Tyndale and Thomas Nelson appear nowhere in the bundle, so ESV, NLT and NKJV are Unknown (needs an account to call `GET /v1/bibles`).
- **Limits (Verified).** The portal FAQ says "YouVersion Platform accounts have a limit of 200 requests per hour" ([portal bundle](https://platform.youversion.com/assets/App-BDSNWjYR.js)). A 429 comes with `Retry-After` ([Authentication](https://developers.youversion.com/authentication.md)).
- **Licence holder (Verified).** The app's organisation (or the individual), through each publisher licence it accepts. "Sign in with YouVersion" grants only identity scopes and a `highlights` permission ([Sign-in APIs](https://developers.youversion.com/sign-in-apis.md)), so a reader signing in to someone else's app does not hold a Bible licence (Inferred). A reader key here means each reader registers an app.
- **Caching (Verified).** The terms in the bundle have no caching clause. The docs list "Cache responses when possible" as a best practice ([Quick Reference](https://developers.youversion.com/quick-reference.md)). Each publisher's own licence text shows only after login, so publisher caching rules are Unknown. The terms also require "You shall enable and maintain any usage reporting mechanisms built into YV IP", which would mean an extra reporting job (Inferred).
- **Format (Verified).** The JSON envelope is `{ "data": [...] }`. Passage text is HTML: `.../passages/{id}?format=html`. Unless the SDK transforms it, "verse-level targeting, normalized tables, and extracted footnote data" are missing ([Display Bible HTML](https://developers.youversion.com/guides/display-bible-html.md)). The service worker would need an HTML-to-IR converter (Inferred).
- **Doctrinal flag (Verified).** The form holds an `agreeToSoF` field and shows the "YouVersion Statement of Faith" dialog, but submission checks only `agreeToS` ([portal bundle](https://platform.youversion.com/assets/App-BDSNWjYR.js)). This is unchanged since #56.
- **Verdict (Inferred).** It has the best free limits and the most translations per account, but the reader carries a developer registration and one licence acceptance per publisher. For NIV, NASB and AMP, api.bible already covers them with one form. Revisit if api.bible ends the reader-key path.

## Crossway ESV API (the only possible second path)

- **Sign-up.** The reader needs a Crossway account ([login](https://api.esv.org/login/), Verified). Creating an app redirects to login (`/account/create-application/`, Verified), so the fields it asks for are Unknown. The service "is available for use only by individuals and non-commercial organizations" ([ESV API](https://api.esv.org/), Verified).
- **Limits (Verified).** "You may only perform 5,000 queries per day, with no more than 1,000 requests in an hour and no more than 60 requests per minute"; "up to 500 verses per query, or half a book, whichever is less" ([ESV API](https://api.esv.org/)).
- **Licence holder.** The key holder: "You may not sell, share, or publish your access key" ([ESV API](https://api.esv.org/), Verified). A key the reader keeps in their own browser stays within that rule (Inferred).
- **Caching (Verified).** "You may not locally store more than 500 verses or one-half of any book of the Bible (whichever is less)"; "You can cache up to 500 verses. We encourage you to periodically clear out your cache" ([ESV API](https://api.esv.org/)). The 30-day chapter cache would need its own verse-counted limit for ESV, about a dozen average chapters (Inferred).
- **Format (Verified).** Endpoints `/v3/passage/html/` and `/v3/passage/text/` return JSON with a `passages` array of strings; options include `include-headings`, `include-footnotes` and `include-verse-numbers` ([Passage HTML](https://api.esv.org/docs/passage-html/)). The docs do not mention a words-of-Christ marker, so that is Unknown (needs a key). The last text update was "2025-02-20" ([Changelog](https://api.esv.org/docs/changelog/)).
- **Attribution (Verified).** Show the returned copyright notice, the letters "ESV", a link to www.esv.org on each page, and a full notice on a copyright page ([ESV API](https://api.esv.org/)).
- **Doctrinal flag (Verified).** Use must be "consistent with the historic Christian understanding of doctrine and the Bible", including "one God … who exists eternally in three persons--Father, Son, and Holy Spirit", plus a Statement of Faith link ([ESV API](https://api.esv.org/)). Whether a reader of the Church's site qualifies is Crossway's call. This is open item B1 in `docs/research/issue-50-public-release.md`; Unknown.

## Tyndale NLT API

- **Sign-up (Verified).** The form asks for First Name, Last Name, Email and Password (required), and Phone, Organization, Website and "Purposed Use" ([Register](https://api.nlt.to/Account/Register)).
- **Limits (Verified).** "Key-Based Use … No more than 500 verses per request … No more than 5000 requests per day … Non-commercial use"; anonymous use allows "No more than 50 verses per request" and "No more than 500 requests per day", and "If key=TEST or omitted, then your IP address will be used as a key" ([NLT API](https://api.nlt.to/), [Documentation](https://api.nlt.to/Documentation)).
- **Translations (Verified).** `version` takes NLT, NLTUK, NTV and KJV ([Documentation](https://api.nlt.to/Documentation)).
- **Caching.** The API pages state no caching rule (Verified absent). The NLT copyright notice lets you quote "up to and inclusive of five hundred (500) verses without express written permission" ([Bible Gateway's NLT page](https://biblegateway.com/versions/New-Living-Translation-NLT-Bible/), which reproduces Tyndale's notice; Verified). Whether that limit binds a reader's local cache is Unknown (ask permission@tyndale.com).
- **Format (Verified, measured).** An HTML document with `verse_export` elements per verse, carrying classes `subhead`, `psa-title`, `poet1` / `poet2`, `body`, `red` (words of Jesus), `vn` and `tn` (footnotes). John 3 returned 17 `red` spans, and Psalm 23 returned poetry lines and a heading. This maps onto the IR with an HTML converter (Inferred).
- **Doctrinal flag (Verified).** "You affirm that your use is consistent with Tyndale's purpose" ([NLT API](https://api.nlt.to/)). That purpose is to "Minister to the spiritual needs of people, primarily through the publication of literature consistent with biblical principles" ([Tyndale purpose](https://www.tyndale.com/purpose)). There is no creed to accept.
- **Verdict (Inferred).** NLT is already on api.bible, so going direct adds daily limits and an easier sign-up for one translation, not new text. Keyless NLT is a separate, no-setup question outside this ticket; it would need Tyndale's caching answer first.

## Rejected providers

- **Bible Brain / DBP4** ([licence](https://www.faithcomesbyhearing.com/bible-brain/license), Verified):
  - Keys come after you "provide us with your name, email, a description of your intended use", and "We may approve or deny your API Key request at our sole discretion".
  - End users must get content "completely free of charge", used "in accordance with FCBH's Statement of Faith".
  - "No DBP Content may be downloaded or made available for offline use by any person or outside of DBP". The 30-day chapter cache in `chrome.storage.local` is an offline copy, so this rejects it (Inferred).
  - The English copyrighted catalogue is Unknown (needs a key).
- **Biblia API** (Faithlife/Logos, Verified):
  - One key per app ([API Keys](https://bibliaapi.com/docs/API_Keys)).
  - The catalogue's only copyrighted English text is the Lexham English Bible; the rest is public domain or original languages ([Available Bibles](https://bibliaapi.com/docs/Available_Bibles)).
  - The terms call the APIs "an experimental service", bar extracting content "for storage in an alternate database system", and define excessive use as "more than 5,000 calls in an hour" ([Terms of Use](https://bibliaapi.com/docs/Terms_of_Use)).
  - Output is text or HTML, optionally wrapped in JSON ([Bible Content](https://bibliaapi.com/docs/Bible_Content)).
- **bolls.life.** Its whole disclaimer still reads "If you find any copyright infringement, please report the developer, it will be removed as soon as possible" ([disclaimer](https://bolls.life/static/disclaimer.html), Verified October 9). There is still no licence.
- **NET Bible web service.** `https://labs.bible.org/api/?passage=…&type=json` answers without a key, with `access-control-allow-origin: *`, as one JSON object per verse with HTML markup and Strong's tags inside `text` (Verified, measured). Its terms page `labs.bible.org/api_web_service` returned a Cloudflare 403 challenge, so its terms and limits are Unknown. The NET text's own grant covers quotation, not full chapters ([netbible.com/copyright](https://netbible.com/copyright/), per #56).
- **Bible Gateway.** No public developer API was found in a search (Unknown; there is no primary page to cite).

## Unknown

| Item | Why it is unknown | How to settle it |
| --- | --- | --- |
| Full api.bible Starter catalogue (which copyrighted Bibles a new account can pick) | Catalogue renders client-side after login | Starter account, Plan → Edit Bible Licenses |
| Legacy plan limits for pre-October-2025 keys | Per-account, carried over from the old portal | The owner's dashboard |
| YouVersion ESV/NKJV/NLT availability; each publisher licence's caching terms | Shown only after login | Portal account: `GET /v1/bibles?language_ranges[]=en&all_available=true`; read each licence at acceptance |
| ESV application form fields and woc marker | Behind Crossway login; needs a key | Crossway account |
| ESV eligibility for this extension (doctrine clause) | Crossway's discretion | licensing@crossway.org (issue-50 B1) |
| NLT caching limit for a local chapter cache | Not stated on the API pages | permission@tyndale.com |
| Bible Brain English copyrighted catalogue | Needs an approved key | Moot: offline ban rejects it |
| NET labs API terms and limits | Cloudflare 403 on the terms page | A browser visit to labs.bible.org/api_web_service |
| Whether adding `rest.api.bible` to `host_permissions` makes Chrome ask users to re-approve | Not checked against Chrome docs here | Chrome's permission-warning docs, or a test update of an unpacked build |
