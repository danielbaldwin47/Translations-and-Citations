# Chrome Web Store listing texts

The texts the owner pastes into the Chrome Web Store dashboard for the public
release (#84; spec #69, "Store artifacts"). Each pasteable text is the `text`
block under its heading. `node tools/validate-manifest.js` checks them against
`manifest.json` and the About card's `C.ABOUT` (`src/shared/constants.js`), so
edit a text here first, run the validator, then paste it.

## Name

`Translations & Citations: a scripture study companion`

The dashboard takes it from `manifest.json` `name`. Owner decision: it leads
with the extension's own words and contains neither "Gospel Library" nor
"Scripture Citation Index". To rename, change `name` and this line together.

## Summary

The dashboard takes it from `manifest.json` `description` (at most 132
characters, both modes named).

## Description

```text
Read each scripture chapter in another translation or language, and see the talks that cite every verse, in a panel beside the page on churchofjesuschrist.org/study.

Translations
• The World English Bible is built in: open a Bible chapter and it appears beside the page, with no setup.
• Bring your own free api.bible key for NIV, NKJV and the other versions your key unlocks.
• Read any standard work in one of about 100 Church languages (Español, Português, 日本語, …), side by side with the English or under each verse.

Citations
• For all five standard works: the General Conference addresses (1942 to the latest conference) and Journal of Discourses sermons that cite each verse, listed by verse or by source.
• Each row shows an excerpt of the cited paragraph. Click it to read the talk inline, opened at the cited passage.
• Highlight passages as you read; highlights stay on your device.
• Updated after each general conference.

The panel follows the site's theme, font and text size, scrolls with the page, and can be resized or collapsed.

Free, no ads, no account. No analytics of our own. Only api.bible's required usage report, and only once you connect a key. The privacy policy lists what is stored and what is sent where.

Citation data compiled with reference to the BYU Scripture Citation Index. Not affiliated with or endorsed by BYU or The Church of Jesus Christ of Latter-day Saints.
```

## Single purpose

```text
Scripture study on churchofjesuschrist.org/study: for the chapter being read, show it in another translation or language and list the talks that cite each verse.
```

## Permission justifications

One line per dashboard field.

- `storage`: Saves the reader's settings (synced through Chrome) and, on this device only, highlights, cached api.bible chapters and the api.bible usage-report device id.
- `https://rest.api.bible/*`: Fetches the version list and the chapter being read from api.bible, with the reader's own key, for the translations that key unlocks.
- `https://fums.api.bible/*`: Sends api.bible's required anonymous usage report for each api.bible chapter shown, which the api.bible licence asks every app to send.
- `https://scriptures.byu.edu/*`: Fetches an early General Conference talk (1942 to 1970) from BYU, its publisher, when the reader opens it or opens the citation list that shows its excerpt.
- `https://www.churchofjesuschrist.org/study*`: Runs the panel on the scripture chapter being read, and fetches from the same site the chapter in a Church language the reader added and the talks the reader opens.

## Remote code

```text
No, I am not using remote code.
```

## Data usage

Tick these three data types:

- **Authentication information**: the reader's api.bible key, kept in Chrome sync storage and sent only to api.bible.
- **Website content**: the extension reads the verse text of the page being read and fetches Church and BYU pages.
- **Web history**: the chapter being read is sent to api.bible when an api.bible translation shows it.

Then tick all three certifications (no sale or transfer outside the approved use cases, no use unrelated to the single purpose, no use for creditworthiness or lending).

## Privacy policy

`https://github.com/danielbaldwin47/Translations-and-Citations/blob/main/docs/privacy.md`

The About card links the same address (`C.ABOUT.privacyUrl`); the page itself is #81. If the policy is published elsewhere, change `C.ABOUT.privacyUrl` and this line together.

## Support

`https://github.com/danielbaldwin47/Translations-and-Citations/issues`

Owner decision (default: this repository's issues), also linked from the About card (`C.ABOUT.supportUrl`).

## After the first upload

The dashboard shows the item's public key (Package, "View public key"). Put its base64 body, without the `-----BEGIN PUBLIC KEY-----` lines, in `manifest.json` as `"key"`, so the load-unpacked personal build shares the Store item's id (spec A25), then run `node tools/validate-manifest.js`.
