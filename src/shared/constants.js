/*
 * Shared constants for the Bible Translation extension.
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

    // --- Default translations to pre-select in options (best-effort match) ---
    DEFAULT_ABBRS: ['NRSV', 'NIV', 'NKJV'],

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
    // The site's own `lang=` codes. `name` is the language's own name, `english`
    // its English one, `vols` the URL collections it publishes (a language
    // without the chapter's collection is left out of that chapter's dropdown).
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
      { code: 'yue', name: '繁體中文 - 廣東話', english: 'Cantonese (Traditional Chinese)', vols: ALL },
      { code: 'zhs', name: '简体中文 - 普通话', english: 'Chinese, Simplified (Mandarin)', vols: ALL },
      { code: 'zho', name: '繁體中文 - 國語', english: 'Chinese, Traditional (Mandarin)', vols: ALL },
      { code: 'eng', name: 'English', english: 'English', vols: ALL },
      { code: 'fin', name: 'Suomi', english: 'Finnish', vols: ALL },
      { code: 'fra', name: 'Français', english: 'French', vols: ALL },
      { code: 'deu', name: 'Deutsch', english: 'German', vols: ALL },
      { code: 'ita', name: 'Italiano', english: 'Italian', vols: ALL },
      { code: 'jpn', name: '日本語', english: 'Japanese', vols: ALL },
      { code: 'kor', name: '한국어', english: 'Korean', vols: ALL },
      { code: 'por', name: 'Português (Brasil)', english: 'Portuguese', vols: ALL },
      { code: 'spa', name: 'Español', english: 'Spanish', vols: ALL },
      { code: 'swe', name: 'Svenska', english: 'Swedish', vols: ALL },
      { code: 'ton', name: 'Faka-Tonga', english: 'Tongan', vols: ALL },
      { code: 'tur', name: 'Türkçe', english: 'Turkish', vols: ALL },
      // Bible + Book of Mormon
      { code: 'ara', name: 'العربية', english: 'Arabic', vols: BIBLE_BOFM },
      { code: 'yap', name: 'Thin Nu Wa\'ab', english: 'Yapese', vols: BIBLE_BOFM },
      // Bible only
      { code: 'meu', name: 'Motu', english: 'Motu', vols: BIBLE },
      // Book of Mormon, Doctrine and Covenants, Pearl of Great Price
      { code: 'afr', name: 'Afrikaans', english: 'Afrikaans', vols: BOFM_DC_PGP },
      { code: 'alb', name: 'Shqip', english: 'Albanian', vols: BOFM_DC_PGP },
      { code: 'amh', name: 'አማርኛ', english: 'Amharic', vols: BOFM_DC_PGP },
      { code: 'hye', name: 'Հայերեն', english: 'Armenian', vols: BOFM_DC_PGP },
      { code: 'bis', name: 'Bislama', english: 'Bislama', vols: BOFM_DC_PGP },
      { code: 'bul', name: 'Български', english: 'Bulgarian', vols: BOFM_DC_PGP },
      { code: 'cat', name: 'Català', english: 'Catalan', vols: BOFM_DC_PGP },
      { code: 'ceb', name: 'Cebuano', english: 'Cebuano', vols: BOFM_DC_PGP },
      { code: 'rar', name: 'Māori Kuki Airani', english: 'Cook Islands Māori', vols: BOFM_DC_PGP },
      { code: 'hrv', name: 'Hrvatski', english: 'Croatian', vols: BOFM_DC_PGP },
      { code: 'ces', name: 'Česky', english: 'Czech', vols: BOFM_DC_PGP },
      { code: 'dan', name: 'Dansk', english: 'Danish', vols: BOFM_DC_PGP },
      { code: 'nld', name: 'Nederlands', english: 'Dutch', vols: BOFM_DC_PGP },
      { code: 'est', name: 'Eesti', english: 'Estonian', vols: BOFM_DC_PGP },
      { code: 'fat', name: 'Fante', english: 'Fante', vols: BOFM_DC_PGP },
      { code: 'fij', name: 'Vosa vakaviti', english: 'Fijian', vols: BOFM_DC_PGP },
      { code: 'kat', name: 'ქართული', english: 'Georgian', vols: BOFM_DC_PGP },
      { code: 'ell', name: 'Ελληνικά', english: 'Greek', vols: BOFM_DC_PGP },
      { code: 'grn', name: 'Guaraní (Avañe\'ẽ)', english: 'Guaraní', vols: BOFM_DC_PGP },
      { code: 'hat', name: 'Kreyòl Ayisyen', english: 'Haitian Creole', vols: BOFM_DC_PGP },
      { code: 'haw', name: 'ʻŌlelo Hawaiʻi', english: 'Hawaiian', vols: BOFM_DC_PGP },
      { code: 'hil', name: 'Hiligaynon', english: 'Hiligaynon', vols: BOFM_DC_PGP },
      { code: 'hin', name: 'हिन्दी', english: 'Hindi', vols: BOFM_DC_PGP },
      { code: 'hmn', name: 'Hmoob', english: 'Hmong', vols: BOFM_DC_PGP },
      { code: 'hun', name: 'Magyar', english: 'Hungarian', vols: BOFM_DC_PGP },
      { code: 'isl', name: 'íslenska', english: 'Icelandic', vols: BOFM_DC_PGP },
      { code: 'ibo', name: 'Igbo', english: 'Igbo', vols: BOFM_DC_PGP },
      { code: 'ilo', name: 'Ilokano', english: 'Ilokano', vols: BOFM_DC_PGP },
      { code: 'ind', name: 'Bahasa Indonesia', english: 'Indonesian', vols: BOFM_DC_PGP },
      { code: 'khm', name: 'ភាសាខ្មែរ', english: 'Khmer', vols: BOFM_DC_PGP },
      { code: 'kin', name: 'Kinyarwanda', english: 'Kinyarwanda', vols: BOFM_DC_PGP },
      { code: 'gil', name: 'Kiribati', english: 'Kiribati (Gilbertese)', vols: BOFM_DC_PGP },
      { code: 'lao', name: 'ພາສາລາວ', english: 'Lao', vols: BOFM_DC_PGP },
      { code: 'lav', name: 'Latviešu', english: 'Latvian', vols: BOFM_DC_PGP },
      { code: 'lin', name: 'Lingála', english: 'Lingala', vols: BOFM_DC_PGP },
      { code: 'lit', name: 'Lietuvių', english: 'Lithuanian', vols: BOFM_DC_PGP },
      { code: 'mkd', name: 'Македонски', english: 'Macedonian', vols: BOFM_DC_PGP },
      { code: 'mlg', name: 'Malagasy', english: 'Malagasy', vols: BOFM_DC_PGP },
      { code: 'msa', name: 'Bahasa Melayu', english: 'Malay', vols: BOFM_DC_PGP },
      { code: 'mri', name: 'Te Reo Māori', english: 'Māori', vols: BOFM_DC_PGP },
      { code: 'mah', name: 'Kajin Majōl', english: 'Marshallese', vols: BOFM_DC_PGP },
      { code: 'mon', name: 'Монгол', english: 'Mongolian', vols: BOFM_DC_PGP },
      { code: 'nep', name: 'नेपाली', english: 'Nepali', vols: BOFM_DC_PGP },
      { code: 'nor', name: 'Norsk', english: 'Norwegian', vols: BOFM_DC_PGP },
      { code: 'pes', name: 'فارسی', english: 'Persian', vols: BOFM_DC_PGP },
      { code: 'pol', name: 'Polski', english: 'Polish', vols: BOFM_DC_PGP },
      { code: 'kek', name: 'Q’eqchi’', english: 'Qʼeqchiʼ', vols: BOFM_DC_PGP },
      { code: 'ron', name: 'Română', english: 'Romanian', vols: BOFM_DC_PGP },
      { code: 'rus', name: 'Русский', english: 'Russian', vols: BOFM_DC_PGP },
      { code: 'smo', name: 'Gagana Samoa', english: 'Samoan', vols: BOFM_DC_PGP },
      { code: 'srp', name: 'Српски', english: 'Serbian', vols: BOFM_DC_PGP },
      { code: 'tsn', name: 'Setswana', english: 'Setswana', vols: BOFM_DC_PGP },
      { code: 'sna', name: 'Shona', english: 'Shona', vols: BOFM_DC_PGP },
      { code: 'sin', name: 'සිංහල', english: 'Sinhala', vols: BOFM_DC_PGP },
      { code: 'slk', name: 'Slovenčina', english: 'Slovak', vols: BOFM_DC_PGP },
      { code: 'slv', name: 'Slovenščina', english: 'Slovenian', vols: BOFM_DC_PGP },
      { code: 'swa', name: 'Kiswahili', english: 'Swahili', vols: BOFM_DC_PGP },
      { code: 'tgl', name: 'Tagalog', english: 'Tagalog', vols: BOFM_DC_PGP },
      { code: 'tah', name: 'Reo Tahiti', english: 'Tahitian', vols: BOFM_DC_PGP },
      { code: 'tam', name: 'தமிழ்', english: 'Tamil', vols: BOFM_DC_PGP },
      { code: 'tel', name: 'తెలుగు', english: 'Telugu', vols: BOFM_DC_PGP },
      { code: 'tha', name: 'ภาษาไทย', english: 'Thai', vols: BOFM_DC_PGP },
      { code: 'twi', name: 'Twi', english: 'Twi', vols: BOFM_DC_PGP },
      { code: 'ukr', name: 'Українська', english: 'Ukrainian', vols: BOFM_DC_PGP },
      { code: 'urd', name: 'اردو', english: 'Urdu', vols: BOFM_DC_PGP },
      { code: 'vie', name: 'Tiếng Việt', english: 'Vietnamese', vols: BOFM_DC_PGP },
      { code: 'xho', name: 'isiXhosa', english: 'Xhosa', vols: BOFM_DC_PGP },
      { code: 'yor', name: 'Èdè Yorùbá', english: 'Yoruba', vols: BOFM_DC_PGP },
      { code: 'zul', name: 'isiZulu', english: 'Zulu', vols: BOFM_DC_PGP },
      // Book of Mormon + Doctrine and Covenants
      { code: 'mlt', name: 'Malti', english: 'Maltese', vols: BOFM_DC },
      { code: 'pon', name: 'Mahsen en Pohnpei', english: 'Pohnpeian', vols: BOFM_DC },
      { code: 'ssw', name: 'siSwati', english: 'Swati', vols: BOFM_DC },
      // Book of Mormon only
      { code: 'aym', name: 'Aymar Aru', english: 'Aymara', vols: BOFM },
      { code: 'mya', name: 'ဗမာစာ', english: 'Burmese', vols: BOFM },
      { code: 'nya', name: 'Chichewa', english: 'Chichewa', vols: BOFM },
      { code: 'cmn-Latn', name: '漢語拼音', english: 'Chinese (Pinyin)', vols: BOFM },
      { code: 'chk', name: 'Fosun Chuuk', english: 'Chuukese', vols: BOFM },
      { code: 'qvi', name: 'Kichwa', english: 'Kichwa (Ecuador)', vols: BOFM },
      { code: 'kos', name: 'Kahs Kosrae', english: 'Kosraean', vols: BOFM },
      { code: 'pag', name: 'Pangasinan', english: 'Pangasinan', vols: BOFM },
      { code: 'tpi', name: 'Tok Pisin', english: 'Tok Pisin', vols: BOFM },
      { code: 'lua', name: 'Tshiluba', english: 'Tshiluba', vols: BOFM },
      ];
    })(),

    // NOTE: the settings schema and its defaults live in
    // src/shared/settings.js (`__BTX.settings`), which owns the whole
    // `SETTINGS_KEY` object — reads, writes, normalization and change events.

    // Heuristic: is a version free/open (public domain or Creative Commons)?
    // Used to hide the free versions and surface only the copyrighted ones the
    // user added to their api.bible key. Unknown/empty copyright -> treated as
    // not-free (shown), so we never hide a wanted version we couldn't classify.
    isFreeVersion(copyrightText) {
      if (!copyrightText) return false;
      return /public domain|creative commons|\bcc[\s-]?(by|0)/i.test(String(copyrightText));
    },
  };

  // Expose to whichever context loaded this file.
  if (typeof module !== 'undefined' && module.exports) module.exports = CONST;
  root.__BTX = Object.assign(root.__BTX || {}, { const: CONST });
})(typeof globalThis !== 'undefined' ? globalThis : this);
