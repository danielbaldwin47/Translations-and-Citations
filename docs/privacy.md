# Privacy policy: Translations & Citations

Translations & Citations is a Chrome extension that works on scripture
chapters at `www.churchofjesuschrist.org/study`. It shows the chapter in
another Bible translation or Church language and lists the talks that cite
each verse. This page says what the extension stores, what it sends and to
whom, and how to delete what it stores. It applies to version 1.0.0 and
later; the version you have is shown on the About card of the extension's
settings page.

The extension has no server of its own. Nothing you do in it is sent to the
developer. There is no analytics, no ads, no account, and no data is sold or
shared with anyone beyond the parties named below, each of which is contacted
only for the request described.

The use of information received by this extension will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## What the extension stores

Everything the extension stores lives in Chrome's extension storage on your
own computer, in two places.

**Synced settings** (Chrome's `storage.sync`: Chrome copies them between the
devices you are signed in to with the same Chrome profile, and nowhere else).
One settings object holding:

- your api.bible key, if you entered one (see api.bible below);
- the Bible translations you turned on and the default one (id, abbreviation,
  name, provider, description);
- the Church languages you added and where the page shows them (side by side,
  under each verse, or in the panel);
- the panel's mode (Translation or Citations), citation layout (by source or
  by verse), width, text size, whether it is collapsed, and whether it
  scrolls with the page;
- whether you closed the welcome (its Got it button) and the line saying a
  chapter has no translation (its ×), so neither shows again.

**This device only** (Chrome's `storage.local`: never synced):

- highlights you make in the talk reader: for each one, the talk, where it
  sits in the talk, and the highlighted text; plus a flag that you have made
  one (so the one-line hint stops showing);
- cached api.bible chapters you have displayed, for up to 30 days and at most
  500 chapters, each with the usage-report token api.bible returned for it;
- the cached list of translations your api.bible key unlocks, for up to seven
  days, filed under a hash of the key (not the key itself);
- counters of recent api.bible requests, for the extension's own rate limit;
- an api.bible usage-report device id: a random identifier created the first
  time an api.bible key connects successfully, used only in reports to
  api.bible (below);
- the translation you picked most recently, per kind of chapter.

The settings page briefly parks, in Chrome's session storage, which settings
card to scroll to when the panel opens settings; it is cleared when the page
reads it.

Nothing fetched from the Church site or from BYU is stored. Talk text and
Church-language chapters live in the page's memory while the tab is open and
are gone when it closes.

The extension reads the text of the chapter you are reading, on your screen,
to show each verse's text in the citation list and to lay the Church-language
text beside the English. That reading happens in your browser; none of it is
sent anywhere.

## What the extension sends, and to whom

Every request below is made over HTTPS. Requests to the Church site and to
BYU are made without cookies (`credentials: 'omit'`), so they carry no sign-in
and no identity.

### api.bible (`api.scripture.api.bible`), only if you connect a key

Bible translations beyond the built-in World English Bible come from
api.bible with your own free key, which you create at scripture.api.bible
and paste into settings. The sentence beside Connect says what connecting
sends; clicking Connect is your consent. Until you connect, no request goes
to api.bible.

- When you connect or check for new translations: your key, to list the
  translations it unlocks.
- When an api.bible translation is shown for a chapter: your key, the
  translation's id and the chapter's id (book and chapter number). A chapter
  already cached is not requested again for 30 days.

api.bible's own privacy policy covers what it does with requests.

### api.bible usage report (`fums.api.bible`), only if you connect a key

api.bible's licence requires every application to report each display of a
chapter it served. Each time an api.bible chapter is shown, cached or not, the
extension sends one `GET` request to `fums.api.bible` carrying the token
api.bible returned for that chapter, the device id described above, and a
session id (a random identifier that lasts until Chrome stops the extension's
background worker). No page content, no key and no account information is
in that request.

### The Church's site (`www.churchofjesuschrist.org`)

The extension runs only on that site's `/study` pages, which you are already
reading. On your action it makes same-origin requests to the same site,
without cookies:

- when you add a Church language or pick one for a chapter: a request for
  that chapter in that language (the chapter's address and the language
  code), to the site's own content endpoint;
- when you open a General Conference talk in the panel, or open a citation
  group whose rows show excerpts of modern talks: a request for that talk's
  page. At most six such requests are in flight at once, and no talk is
  requested before you act on the chapter.

### BYU (`scriptures.byu.edu`)

Early General Conference talks (1942 to 1970) are fetched from their
publisher, BYU's Scripture Citation Index, when you open one in the panel or
open a citation group whose rows show their excerpts. The request names the
talk's BYU id, without cookies. At most two such requests are in flight at
once. The talk's byline says "Text fetched from scriptures.byu.edu".

### Nothing else

Journal of Discourses text and the World English Bible are packaged with the
extension and read from your computer. Links in the panel that open a talk on
the web (the Church page, BYU's viewer, Wikisource) are ordinary links: they
load only when you click them, in a normal browser tab.

## How to delete what is stored

- **Everything**: uninstall the extension (Remove at `chrome://extensions`).
  Chrome deletes the extension's local storage on this device; the synced
  settings are removed from your Chrome profile as well once the extension
  is gone from your signed-in devices.
- **The api.bible key**: empty the key field in settings. The stored key and
  the cached translation list go with it. The device id stays until the
  extension is removed.
- **A highlight**: click it in the talk reader and choose Remove.
- **Cached chapters**: expire on their own after 30 days; removing the
  extension clears them at once.

## Sources and affiliation

Citation data compiled with reference to the BYU Scripture Citation Index. Not affiliated with or endorsed by BYU or The Church of Jesus Christ of Latter-day Saints.

Journal of Discourses text: Wikisource, public domain. The World English
Bible is in the Public Domain; "World English Bible" is a trademark of
eBible.org.

## Changes and contact

This page is kept in the extension's repository; its history is the record of
changes. Questions go to the repository's issue tracker:
<https://github.com/danielbaldwin47/Translations-and-Citations/issues>.

Last updated: October 2026.
