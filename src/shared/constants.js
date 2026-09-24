/*
 * Shared constants for Translations & Citations.
 *
 * Authored as an IIFE that attaches to a single namespace (`__BTX.const`) so the
 * exact same file works verbatim in every context with no build step:
 *   - content script  (listed in manifest content_scripts, isolated world)
 *   - service worker  (pulled in via importScripts)
 *   - options page    (plain <script src>)
 *   - node validator  (via module.exports)
 */
(function (root) {
  'use strict';

  const CONST = {
    // --- API endpoints ---
    API_BIBLE_BASE: 'https://api.scripture.api.bible/v1',
    BIBLE_API_BASE: 'https://bible-api.com',

    // --- Providers ---
    PROVIDER_APIBIBLE: 'api.bible',
    PROVIDER_BIBLEAPI: 'bible-api.com',

    // --- Message types (content <-> worker) ---
    MSG: {
      GET_ENABLED_TRANSLATIONS: 'GET_ENABLED_TRANSLATIONS',
      GET_CHAPTER: 'GET_CHAPTER',
      LIST_BIBLES: 'LIST_BIBLES',
      OPEN_OPTIONS: 'OPEN_OPTIONS',
      TOGGLE_PANEL: 'TOGGLE_PANEL',
    },

    // --- Error codes returned in { error: { code } } ---
    ERR: {
      NO_KEY: 'NO_KEY',
      RATE_LIMITED: 'RATE_LIMITED',
      NOT_FOUND: 'NOT_FOUND',
      NETWORK: 'NETWORK',
      FORBIDDEN: 'FORBIDDEN',
      INVALID_KEY: 'INVALID_KEY',
      UNKNOWN: 'UNKNOWN',
    },

    // --- chrome.storage.sync keys (settings) ---
    SETTINGS_KEY: 'btxSettings',

    // --- Options deep links ---
    // OPEN_OPTIONS may carry `section`, one of OPTIONS_SECTIONS (the options
    // page's card ids). The worker parks it in chrome.storage.session under
    // OPTIONS_FOCUS_KEY before opening the page; the page reads it, clears it,
    // and scrolls that card into view.
    OPTIONS_SECTIONS: ['bible', 'languages', 'reading'],
    OPTIONS_FOCUS_KEY: 'btxOptionsFocus',

    // --- chrome.storage.local key prefixes (cache + rate limiting) ---
    CACHE_PREFIX: 'chapter::',
    CACHE_INDEX_KEY: 'btxCacheIndex',
    BIBLES_CACHE_KEY: 'btxBiblesCache',
    RATE_RECENT_KEY: 'btxRateRecent',
    RATE_DAILY_PREFIX: 'btxRateDaily::',

    // --- Cache TTLs (ms) ---
    CHAPTER_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days (chapters are static)
    BIBLES_TTL_MS: 24 * 60 * 60 * 1000, // 1 day
    CACHE_MAX_ENTRIES: 500,

    // --- Rate limits (api.bible) ---
    RATE_WINDOW_MS: 30 * 1000,
    RATE_WINDOW_MAX: 15, // 15 requests / 30s
    RATE_DAILY_MAX: 5000, // 5000 requests / day

    // --- Which translation becomes the default, in order of preference ---
    // The options page picks the first of these the reader has turned on, and
    // falls back to the first one on the list.
    DEFAULT_ABBRS: ['NIV', 'NKJV', 'NRSV', 'ESV', 'KJV'],

    // --- Public-domain translations available on bible-api.com (no key) ---
    BIBLE_API_TRANSLATIONS: [
      { id: 'web', abbr: 'WEB', name: 'World English Bible' },
      { id: 'kjv', abbr: 'KJV', name: 'King James Version' },
      { id: 'asv', abbr: 'ASV', name: 'American Standard Version (1901)' },
      { id: 'bbe', abbr: 'BBE', name: 'Bible in Basic English' },
      { id: 'darby', abbr: 'DARBY', name: 'Darby Bible' },
      { id: 'dra', abbr: 'DRA', name: 'Douay-Rheims 1899 American Edition' },
      { id: 'ylt', abbr: 'YLT', name: "Young's Literal Translation (NT only)" },
      { id: 'oeb-us', abbr: 'OEB-US', name: 'Open English Bible, US Edition' },
      { id: 'webbe', abbr: 'WEBBE', name: 'World English Bible, British Edition' },
    ],

    // --- Church languages offered beside the page (__BTX.churchText) ---
    // The site's own `lang=` codes. `tag` is the BCP 47 tag for marking up the
    // language's own name (glyph choice for CJK, pronunciation), `name` that
    // name, `english` its English one, `vols` the URL collections it publishes
    // (a language without the chapter's collection is left out of that
    // chapter's dropdown).
    // Built 2026-09-23 by probing /study/api/v3/language-pages/type/content for
    // every code in /languages/api/languages: a collection counts when it serves
    // chapters (a few are partial — Chinese OT is Genesis–Deuteronomy, Hawaiian
    // D&C 136 of 140 — and a missing chapter reads "not available"). Left out:
    // ase (serves the English text), cym (1830 chapter divisions, no verse
    // numbers), efi kaz ben sot and the 17 "Selections from the Book of Mormon"
    // languages (a minority of chapters). Grouped by coverage, then English name
    // — which is the order the options page and the dropdown list them in.
    CHURCH_LANGUAGES: (() => {
      const ALL = ['ot', 'nt', 'bofm', 'dc-testament', 'pgp'];
      const BIBLE_BOFM = ['ot', 'nt', 'bofm'];
      const BIBLE = ['ot', 'nt'];
      const BOFM_DC_PGP = ['bofm', 'dc-testament', 'pgp'];
      const BOFM_DC = ['bofm', 'dc-testament'];
      const BOFM = ['bofm'];
      return [
      // All five volumes
      { code: 'yue', tag: 'yue-Hant', name: '繁體中文 - 廣東話', english: 'Cantonese (Traditional Chinese)', vols: ALL },
      { code: 'zhs', tag: 'zh-Hans', name: '简体中文 - 普通话', english: 'Chinese, Simplified (Mandarin)', vols: ALL },
      { code: 'zho', tag: 'zh-Hant', name: '繁體中文 - 國語', english: 'Chinese, Traditional (Mandarin)', vols: ALL },
      { code: 'eng', tag: 'en', name: 'English', english: 'English', vols: ALL },
      { code: 'fin', tag: 'fi', name: 'Suomi', english: 'Finnish', vols: ALL },
      { code: 'fra', tag: 'fr', name: 'Français', english: 'French', vols: ALL },
      { code: 'deu', tag: 'de', name: 'Deutsch', english: 'German', vols: ALL },
      { code: 'ita', tag: 'it', name: 'Italiano', english: 'Italian', vols: ALL },
      { code: 'jpn', tag: 'ja', name: '日本語', english: 'Japanese', vols: ALL },
      { code: 'kor', tag: 'ko', name: '한국어', english: 'Korean', vols: ALL },
      { code: 'por', tag: 'pt-BR', name: 'Português (Brasil)', english: 'Portuguese', vols: ALL },
      { code: 'spa', tag: 'es', name: 'Español', english: 'Spanish', vols: ALL },
      { code: 'swe', tag: 'sv', name: 'Svenska', english: 'Swedish', vols: ALL },
      { code: 'ton', tag: 'to', name: 'Faka-Tonga', english: 'Tongan', vols: ALL },
      { code: 'tur', tag: 'tr', name: 'Türkçe', english: 'Turkish', vols: ALL },
      // Bible + Book of Mormon
      { code: 'ara', tag: 'ar', name: 'العربية', english: 'Arabic', vols: BIBLE_BOFM },
      { code: 'yap', tag: 'yap', name: 'Thin Nu Wa\'ab', english: 'Yapese', vols: BIBLE_BOFM },
      // Bible only
      { code: 'meu', tag: 'meu', name: 'Motu', english: 'Motu', vols: BIBLE },
      // Book of Mormon, Doctrine and Covenants, Pearl of Great Price
      { code: 'afr', tag: 'af', name: 'Afrikaans', english: 'Afrikaans', vols: BOFM_DC_PGP },
      { code: 'alb', tag: 'sq', name: 'Shqip', english: 'Albanian', vols: BOFM_DC_PGP },
      { code: 'amh', tag: 'am', name: 'አማርኛ', english: 'Amharic', vols: BOFM_DC_PGP },
      { code: 'hye', tag: 'hy', name: 'Հայերեն', english: 'Armenian', vols: BOFM_DC_PGP },
      { code: 'bis', tag: 'bi', name: 'Bislama', english: 'Bislama', vols: BOFM_DC_PGP },
      { code: 'bul', tag: 'bg', name: 'Български', english: 'Bulgarian', vols: BOFM_DC_PGP },
      { code: 'cat', tag: 'ca', name: 'Català', english: 'Catalan', vols: BOFM_DC_PGP },
      { code: 'ceb', tag: 'ceb', name: 'Cebuano', english: 'Cebuano', vols: BOFM_DC_PGP },
      { code: 'rar', tag: 'rar', name: 'Māori Kuki Airani', english: 'Cook Islands Māori', vols: BOFM_DC_PGP },
      { code: 'hrv', tag: 'hr', name: 'Hrvatski', english: 'Croatian', vols: BOFM_DC_PGP },
      { code: 'ces', tag: 'cs', name: 'Česky', english: 'Czech', vols: BOFM_DC_PGP },
      { code: 'dan', tag: 'da', name: 'Dansk', english: 'Danish', vols: BOFM_DC_PGP },
      { code: 'nld', tag: 'nl', name: 'Nederlands', english: 'Dutch', vols: BOFM_DC_PGP },
      { code: 'est', tag: 'et', name: 'Eesti', english: 'Estonian', vols: BOFM_DC_PGP },
      { code: 'fat', tag: 'fat', name: 'Fante', english: 'Fante', vols: BOFM_DC_PGP },
      { code: 'fij', tag: 'fj', name: 'Vosa vakaviti', english: 'Fijian', vols: BOFM_DC_PGP },
      { code: 'kat', tag: 'ka', name: 'ქართული', english: 'Georgian', vols: BOFM_DC_PGP },
      { code: 'ell', tag: 'el', name: 'Ελληνικά', english: 'Greek', vols: BOFM_DC_PGP },
      { code: 'grn', tag: 'gn', name: 'Guaraní (Avañe\'ẽ)', english: 'Guaraní', vols: BOFM_DC_PGP },
      { code: 'hat', tag: 'ht', name: 'Kreyòl Ayisyen', english: 'Haitian Creole', vols: BOFM_DC_PGP },
      { code: 'haw', tag: 'haw', name: 'ʻŌlelo Hawaiʻi', english: 'Hawaiian', vols: BOFM_DC_PGP },
      { code: 'hil', tag: 'hil', name: 'Hiligaynon', english: 'Hiligaynon', vols: BOFM_DC_PGP },
      { code: 'hin', tag: 'hi', name: 'हिन्दी', english: 'Hindi', vols: BOFM_DC_PGP },
      { code: 'hmn', tag: 'hmn', name: 'Hmoob', english: 'Hmong', vols: BOFM_DC_PGP },
      { code: 'hun', tag: 'hu', name: 'Magyar', english: 'Hungarian', vols: BOFM_DC_PGP },
      { code: 'isl', tag: 'is', name: 'íslenska', english: 'Icelandic', vols: BOFM_DC_PGP },
      { code: 'ibo', tag: 'ig', name: 'Igbo', english: 'Igbo', vols: BOFM_DC_PGP },
      { code: 'ilo', tag: 'ilo', name: 'Ilokano', english: 'Ilokano', vols: BOFM_DC_PGP },
      { code: 'ind', tag: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', vols: BOFM_DC_PGP },
      { code: 'khm', tag: 'km', name: 'ភាសាខ្មែរ', english: 'Khmer', vols: BOFM_DC_PGP },
      { code: 'kin', tag: 'rw', name: 'Kinyarwanda', english: 'Kinyarwanda', vols: BOFM_DC_PGP },
      { code: 'gil', tag: 'gil', name: 'Kiribati', english: 'Kiribati (Gilbertese)', vols: BOFM_DC_PGP },
      { code: 'lao', tag: 'lo', name: 'ພາສາລາວ', english: 'Lao', vols: BOFM_DC_PGP },
      { code: 'lav', tag: 'lv', name: 'Latviešu', english: 'Latvian', vols: BOFM_DC_PGP },
      { code: 'lin', tag: 'ln', name: 'Lingála', english: 'Lingala', vols: BOFM_DC_PGP },
      { code: 'lit', tag: 'lt', name: 'Lietuvių', english: 'Lithuanian', vols: BOFM_DC_PGP },
      { code: 'mkd', tag: 'mk', name: 'Македонски', english: 'Macedonian', vols: BOFM_DC_PGP },
      { code: 'mlg', tag: 'mg', name: 'Malagasy', english: 'Malagasy', vols: BOFM_DC_PGP },
      { code: 'msa', tag: 'ms', name: 'Bahasa Melayu', english: 'Malay', vols: BOFM_DC_PGP },
      { code: 'mri', tag: 'mi', name: 'Te Reo Māori', english: 'Māori', vols: BOFM_DC_PGP },
      { code: 'mah', tag: 'mh', name: 'Kajin Majōl', english: 'Marshallese', vols: BOFM_DC_PGP },
      { code: 'mon', tag: 'mn', name: 'Монгол', english: 'Mongolian', vols: BOFM_DC_PGP },
      { code: 'nep', tag: 'ne', name: 'नेपाली', english: 'Nepali', vols: BOFM_DC_PGP },
      { code: 'nor', tag: 'no', name: 'Norsk', english: 'Norwegian', vols: BOFM_DC_PGP },
      { code: 'pes', tag: 'fa', name: 'فارسی', english: 'Persian', vols: BOFM_DC_PGP },
      { code: 'pol', tag: 'pl', name: 'Polski', english: 'Polish', vols: BOFM_DC_PGP },
      { code: 'kek', tag: 'kek', name: 'Q’eqchi’', english: 'Qʼeqchiʼ', vols: BOFM_DC_PGP },
      { code: 'ron', tag: 'ro', name: 'Română', english: 'Romanian', vols: BOFM_DC_PGP },
      { code: 'rus', tag: 'ru', name: 'Русский', english: 'Russian', vols: BOFM_DC_PGP },
      { code: 'smo', tag: 'sm', name: 'Gagana Samoa', english: 'Samoan', vols: BOFM_DC_PGP },
      { code: 'srp', tag: 'sr-Cyrl', name: 'Српски', english: 'Serbian', vols: BOFM_DC_PGP },
      { code: 'tsn', tag: 'tn', name: 'Setswana', english: 'Setswana', vols: BOFM_DC_PGP },
      { code: 'sna', tag: 'sn', name: 'Shona', english: 'Shona', vols: BOFM_DC_PGP },
      { code: 'sin', tag: 'si', name: 'සිංහල', english: 'Sinhala', vols: BOFM_DC_PGP },
      { code: 'slk', tag: 'sk', name: 'Slovenčina', english: 'Slovak', vols: BOFM_DC_PGP },
      { code: 'slv', tag: 'sl', name: 'Slovenščina', english: 'Slovenian', vols: BOFM_DC_PGP },
      { code: 'swa', tag: 'sw', name: 'Kiswahili', english: 'Swahili', vols: BOFM_DC_PGP },
      { code: 'tgl', tag: 'tl', name: 'Tagalog', english: 'Tagalog', vols: BOFM_DC_PGP },
      { code: 'tah', tag: 'ty', name: 'Reo Tahiti', english: 'Tahitian', vols: BOFM_DC_PGP },
      { code: 'tam', tag: 'ta', name: 'தமிழ்', english: 'Tamil', vols: BOFM_DC_PGP },
      { code: 'tel', tag: 'te', name: 'తెలుగు', english: 'Telugu', vols: BOFM_DC_PGP },
      { code: 'tha', tag: 'th', name: 'ภาษาไทย', english: 'Thai', vols: BOFM_DC_PGP },
      { code: 'twi', tag: 'tw', name: 'Twi', english: 'Twi', vols: BOFM_DC_PGP },
      { code: 'ukr', tag: 'uk', name: 'Українська', english: 'Ukrainian', vols: BOFM_DC_PGP },
      { code: 'urd', tag: 'ur', name: 'اردو', english: 'Urdu', vols: BOFM_DC_PGP },
      { code: 'vie', tag: 'vi', name: 'Tiếng Việt', english: 'Vietnamese', vols: BOFM_DC_PGP },
      { code: 'xho', tag: 'xh', name: 'isiXhosa', english: 'Xhosa', vols: BOFM_DC_PGP },
      { code: 'yor', tag: 'yo', name: 'Èdè Yorùbá', english: 'Yoruba', vols: BOFM_DC_PGP },
      { code: 'zul', tag: 'zu', name: 'isiZulu', english: 'Zulu', vols: BOFM_DC_PGP },
      // Book of Mormon + Doctrine and Covenants
      { code: 'mlt', tag: 'mt', name: 'Malti', english: 'Maltese', vols: BOFM_DC },
      { code: 'pon', tag: 'pon', name: 'Mahsen en Pohnpei', english: 'Pohnpeian', vols: BOFM_DC },
      { code: 'ssw', tag: 'ss', name: 'siSwati', english: 'Swati', vols: BOFM_DC },
      // Book of Mormon only
      { code: 'aym', tag: 'ay', name: 'Aymar Aru', english: 'Aymara', vols: BOFM },
      { code: 'mya', tag: 'my', name: 'ဗမာစာ', english: 'Burmese', vols: BOFM },
      { code: 'nya', tag: 'ny', name: 'Chichewa', english: 'Chichewa', vols: BOFM },
      { code: 'cmn-Latn', tag: 'zh-Latn', name: '漢語拼音', english: 'Chinese (Pinyin)', vols: BOFM },
      { code: 'chk', tag: 'chk', name: 'Fosun Chuuk', english: 'Chuukese', vols: BOFM },
      { code: 'qvi', tag: 'qvi', name: 'Kichwa', english: 'Kichwa (Ecuador)', vols: BOFM },
      { code: 'kos', tag: 'kos', name: 'Kahs Kosrae', english: 'Kosraean', vols: BOFM },
      { code: 'pag', tag: 'pag', name: 'Pangasinan', english: 'Pangasinan', vols: BOFM },
      { code: 'tpi', tag: 'tpi', name: 'Tok Pisin', english: 'Tok Pisin', vols: BOFM },
      { code: 'lua', tag: 'lua', name: 'Tshiluba', english: 'Tshiluba', vols: BOFM },
      ];
    })(),

    // NOTE: the settings schema and its defaults live in
    // src/shared/settings.js (`__BTX.settings`), which owns the whole
    // `SETTINGS_KEY` object — reads, writes, normalization and change events.
  };

  // Expose to whichever context loaded this file.
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
  root.__BTX = Object.assign(root.__BTX || {}, { const: CONST });
})(typeof globalThis !== 'undefined' ? globalThis : this);
