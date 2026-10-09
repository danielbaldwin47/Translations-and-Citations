/*
 * Church-language parallel text: the current chapter as the Church itself
 * publishes it in another language, for any standard work. It answers two
 * questions for the orchestrator:
 *
 *   which texts can sit beside this chapter, and which one shows?
 *     textsFor({ isBible, collection, bibleRows, languages, pageLang }) -> [row]
 *       api.bible rows (Bible chapters only) followed by one synthetic row per
 *       enabled Church language that publishes this collection (its `vols` in
 *       C.CHURCH_LANGUAGES), minus the language the page is already in.
 *       A Church row is { id:'church:spa', provider:'church', lang, abbr, name }
 *       so it rides the same dropdown and view key as an api.bible version.
 *     pickText(list, preferredIds) -> id | null
 *       the first preferred id the list offers, else the list's first row.
 *       The caller's preference is never rewritten by a fallback, which is
 *       what lets a Bible version survive a detour through the Book of Mormon.
 *     pickOrder(list, preferredIds) -> [row]
 *       pickText's order over every row
 *     firstOffered(rows, preferredIds) -> { row, next }
 *       the one walk over pickOrder that chapterOffer, pageLanguage and the
 *       panel's arrangement share: the first row offering the chapter, or
 *       `next`, the language of the first row not checked yet in its way
 *     chapterOffer({ texts, results, preferredIds })
 *         -> { texts: [row + { offered, failed? }], pick, next, translatable, unchecked }
 *       the chapter check's decision (GLOSSARY): a Church row offers the
 *       chapter only once found there (`results[lang]` 'found' | 'unavailable'
 *       | 'error', absent = not checked). 'error' (the check hit a network
 *       error) counts as offered, so the panel's error card says why, and
 *       marks the row `failed`. `pick` / `next` are firstOffered's.
 *       `offered` and `translatable` are true / false / null (null = not
 *       checked yet). `unchecked`: every language not checked yet, which the
 *       background check asks once the Translation tab settles
 *     pageLanguage({ texts, picks, layout }) -> { id, next }
 *       the page split's language (GLOSSARY: Page split), while `layout` is
 *       'columns' | 'interlinear': the first Church language in `picks` that
 *       offers the chapter; failing that, the row the Translation tab selects
 *       (firstOffered over every row), only when it is a Church row. A
 *       `failed` row never holds the page. `next`: an unchecked language in
 *       the way (check it, then ask again; `id` is null meanwhile)
 *     mruFrom(stored) / rememberPick(mru, id) -> [id]
 *       the preference itself: the reader's picks, newest first (MRU_MAX),
 *       migrated from the single id older versions stored.
 *     rememberTicked(mru, before, after) -> [id]
 *       the same list after the enabled Church languages change from `before`
 *       to `after` (codes): each newly ticked language goes to the front
 *       through rememberPick (the last ticked leads), an untick changes
 *       nothing. The options page's write; content.js's setup card calls
 *       rememberPick for the one language it adds.
 *
 *   how does each read, and what else could be added?
 *     labelFor(row, list) -> "NIV — New International Version" | "Español — Spanish"
 *       twins in `list` told apart by description, else id edition, else order
 *     menuFor(list, { isBible }) -> [{ label, items: [{ id, label }] }]
 *       the dropdown. Bible chapter: 'Bible versions' then 'Languages', always
 *       headed, a group only when it has rows (one Bible version alone is still
 *       headed). Any other chapter: no Bible group, the language rows in one
 *       unheaded group. `isBible` is the caller's fact about the chapter, never
 *       inferred from the rows.
 *     languagesToAdd({ collection, pageLang, enabled }) -> [{ code, label }]
 *       the setup card's list: languages publishing the volume, not yet on,
 *       A–Z by English name and labelled English first ("Spanish — Español")
 *
 *   what does that chapter say?
 *     load(parsed, lang) -> Promise<{ blocks, verses, title, bcp47, dir, uri } | { error }>
 *       same-origin GET of the site's content endpoint (credentials omitted,
 *       like talk-source's live talks — no worker, no key, no rate limit),
 *       parsed off-document with DOMParser and reduced to the translation IR
 *       (see api.js) by chapterFrom. Nothing fetched is ever inserted as HTML:
 *       sanitize.renderBlocks builds the DOM from text nodes. What isn't the
 *       chapter asked for is { error: { code: NOT_FOUND } } (servesChapter):
 *       a 404 (the language lacks that volume), or a 200 that is really a
 *       contents page — the endpoint answers a missing book or chapter with
 *       the volume's or book's contents, whose `data-uri` (…/_manifest,
 *       …/_contents) differs from the one asked for. Verses aren't required:
 *       the Official Declarations have none. Results are cached per tab, and
 *       NOT_FOUND is remembered for the tab: never fetched twice.
 *     checkKey(parsed, lang) -> `${lang}|${uri}`
 *       how every per-tab record of one language's chapter is keyed (load's
 *       cache, and the caller's Set of failed checks)
 *     checkResults(parsed, langs, failed) -> { [lang]: 'found' | 'unavailable' | 'error' }
 *       chapterOffer's `results`: what load has learned about this chapter in
 *       this tab, else 'error' where `failed` (a Set of checkKeys) holds it
 *
 * chapterFrom(root, meta) is the markup rule, pure over a minimal node
 * interface (nodeType, tagName, childNodes, getAttribute, nodeValue) so Node
 * can exercise it on fixtures (tools/validate-church-text.js). Blocks are
 * classified by id first — the ids (title1, title_number1, study_summary1,
 * intro1, …) are the same in every language, while tags and classes vary by
 * translation (English Psalm 119's letter headings are p.usx-qa#title1,
 * Spanish ones h2#title1):
 *   h1–h6, #title*, #title_number*      -> { type:'heading', text }, plus
 *                                         `runs` when it carries furigana
 *   #study_summary*, .study-summary    -> para style 'summary'
 *   #intro*, #study_intro*, #subtitle* -> para style 'intro'
 *   any other p (verses included)      -> para style 'p', or 'q1' when it
 *                                         holds poetry span.line runs
 *   span.verse-number                  -> { t:'v', n } (native digits kept)
 *   span.line                          -> its own row: { t:'br' } before it
 *                                         unless it opens the verse, and
 *                                         before any prose that follows it
 *   ruby (rb + rt)                     -> { t:'ruby', s, rt }
 *   .marker (footnote letters, and the  -> dropped
 *   text markers *, *) of some
 *   translations), span.para-mark, rt/rp
 *   footer (the study notes), nav, aside, figure, img, table, script,
 *   style, template                    -> dropped whole
 *   any other inline element           -> flattened to its text
 * blockElements(root) returns the candidate block elements in page order —
 * every p and h1–h6 outside the dropped ones; chapterFrom keeps those with
 * text. __BTX.pageSplit walks the English article with it, so both sides are
 * read by one rule.
 * Every block also carries the source element's `id` when it has one (p5,
 * title_number1, …) — the same in every language, which is how __BTX.pageSplit
 * pairs a block with the English element it translates.
 * `dir` is 'rtl' for right-to-left languages: the site marks none of them.
 *
 * IIFE -> __BTX.churchText (ADR-0002); the pure core is also module.exports.
 */
(function (root) {
  'use strict';

  const C = (root.__BTX && root.__BTX.const)
    || (typeof require === 'function' ? require('../shared/constants.js') : null);

  const PROVIDER = 'church';
  const ID_PREFIX = 'church:';
  const API_PATH = '/study/api/v3/language-pages/type/content';

  const LANG_BY_CODE = {};
  for (const l of C.CHURCH_LANGUAGES) LANG_BY_CODE[l.code] = l;

  // ---- Which texts, and which one ------------------------------------------

  function rowFor(code) {
    const l = Object.prototype.hasOwnProperty.call(LANG_BY_CODE, code) ? LANG_BY_CODE[code] : null;
    if (!l) return null;
    // The dropdown reads "abbr — name"; a language whose own name is its
    // English name (English) shows once rather than as "English — English".
    return { id: ID_PREFIX + l.code, provider: PROVIDER, lang: l.code, abbr: l.name === l.english ? '' : l.name, name: l.english };
  }

  function publishes(code, collection) {
    const l = LANG_BY_CODE[code];
    return !collection || l.vols.indexOf(collection) >= 0;
  }

  function textsFor(opts) {
    const o = opts || {};
    const bible = o.isBible !== false && Array.isArray(o.bibleRows) ? o.bibleRows : [];
    const church = (Array.isArray(o.languages) ? o.languages : [])
      .filter((code) => code !== o.pageLang)
      .map(rowFor)
      .filter((row) => row && publishes(row.lang, o.collection));
    return bible.concat(church);
  }

  function pickText(list, preferredIds) {
    const rows = Array.isArray(list) ? list : [];
    for (const id of preferredIds || []) {
      if (id && rows.some((t) => t.id === id)) return id;
    }
    return rows.length ? rows[0].id : null;
  }

  // pickText's order over every row: the preferred ids the list offers, newest
  // first, then the rest in list order. firstOffered walks it.
  function pickOrder(list, preferredIds) {
    const rows = Array.isArray(list) ? list : [];
    const preferred = (preferredIds || []).filter((id, i, all) => id && all.indexOf(id) === i)
      .map((id) => rows.find((t) => t.id === id)).filter(Boolean);
    return preferred.concat(rows.filter((t) => preferred.indexOf(t) < 0));
  }

  // The one walk every "which text" question makes: `rows` in pickText's
  // order, stopping at the first row that offers the chapter (`offered`
  // true) or the first the chapter check hasn't asked yet (null).
  //   -> { row: row | null, next: lang | null }   next: check it, then ask again
  function firstOffered(rows, preferredIds) {
    for (const row of pickOrder(rows, preferredIds)) {
      if (row.offered === true) return { row, next: null };
      if (row.offered === null) return { row: null, next: row.lang };
    }
    return { row: null, next: null };
  }

  // ---- Which texts offer this chapter (the chapter check's decision) ---------
  // A Church language offers a chapter only once the chapter check found it
  // there; a Bible row (bundled or api.bible) offers it without a check.
  // `results` maps a language to what its check said — 'found', 'unavailable'
  // (the language lacks the chapter), or 'error' (the check failed: offered, so
  // the panel's error card says why, and marked `failed`, so it never holds
  // the page) — and lacks the languages not checked yet. The rows are walked
  // by firstOffered, and checking stops at the first one that offers the
  // chapter:
  //   -> { texts: [row + { offered: true | false | null, failed? }],   null = not checked yet
  //        pick: id | null,                 pickText over the offered rows, once settled
  //        next: lang | null,               the language to check next; null = settled
  //        translatable: true | false | null,   null = unknown until `next` is checked
  //        unchecked: [lang] }              every language not checked yet (the background check)
  function chapterOffer(opts) {
    const o = opts || {};
    const results = o.results || {};
    const offeredBy = (row) => {
      if (row.provider !== PROVIDER) return true;
      const r = Object.prototype.hasOwnProperty.call(results, row.lang) ? results[row.lang] : undefined;
      if (r === undefined) return null;
      return r !== 'unavailable';
    };
    const failed = (row) => row.provider === PROVIDER && results[row.lang] === 'error';
    const texts = (Array.isArray(o.texts) ? o.texts : []).map((row) => Object.assign({}, row, { offered: offeredBy(row) },
      failed(row) ? { failed: true } : null));
    const walk = firstOffered(texts, o.preferredIds);
    const pick = walk.row ? walk.row.id : null;
    const next = walk.next;
    const translatable = texts.some((t) => t.offered === true) ? true
      : (texts.some((t) => t.offered === null) ? null : false);
    const unchecked = texts.filter((t) => t.offered === null).map((t) => t.lang);
    return { texts, pick, next, translatable, unchecked };
  }

  // ---- Which language holds the page ----------------------------------------
  // The page split's language (GLOSSARY: Page split), while the split layout
  // is in-page ('columns' | 'interlinear'): the first Church language in the
  // pick memory whose chapter the check found, so on John 3 NIV can show in
  // the panel while Español holds the page. With none, the row the
  // Translation tab selects, only when it is a Church language: John 3 with
  // no pick keeps the Bible in the panel and no split, Alma 5 splits in its
  // one language. `texts` are chapterOffer's rows.
  //   -> { id: row id | null,       the page's language, null = none (yet)
  //        next: lang | null }      a language not checked yet in the way: check it, then ask again
  function pageLanguage(opts) {
    const o = opts || {};
    const none = { id: null, next: null };
    if (o.layout !== 'columns' && o.layout !== 'interlinear') return none;
    const picks = Array.isArray(o.picks) ? o.picks : [];
    // A failed check offers the panel's text (its error card), never the page.
    const rows = (Array.isArray(o.texts) ? o.texts : []).filter(Boolean)
      .map((row) => (row.failed ? Object.assign({}, row, { offered: false }) : row));
    const named = firstOffered(rows.filter((row) => row.provider === PROVIDER && picks.indexOf(row.id) >= 0), picks);
    if (named.row || named.next) return { id: named.row ? named.row.id : null, next: named.next };
    // No pick names a language that offers it: the Translation tab's selection,
    // when that is a language.
    const selected = firstOffered(rows, picks);
    return { id: selected.row && selected.row.provider === PROVIDER ? selected.row.id : null, next: selected.next };
  }

  // ---- What the reader picked, most recent first ------------------------------
  // One remembered pick per volume would forget Spanish after a trip to NIV in
  // the Bible, so the preference is a short most-recently-used list: pickText
  // walks it, and each volume finds the newest pick it offers.
  const MRU_MAX = 6;

  // The stored preference, whatever shape an older version left: a single id
  // (before the list existed), a list, or nothing.
  function mruFrom(stored) {
    const ids = typeof stored === 'string' ? [stored] : (Array.isArray(stored) ? stored : []);
    return ids.filter((id, i) => typeof id === 'string' && id !== '' && ids.indexOf(id) === i).slice(0, MRU_MAX);
  }

  function rememberPick(mru, id) {
    const rest = mruFrom(mru).filter((x) => x !== id);
    return (typeof id === 'string' && id !== '' ? [id] : []).concat(rest).slice(0, MRU_MAX);
  }

  // The pick memory after the enabled Church languages change from `before`
  // to `after` (codes): each language newly on goes to the front through
  // rememberPick, in `after`'s order, so the last one ticked leads. Unticking
  // changes nothing: the list is a record of picks, not of what is on (the
  // text lists drop an unticked language by themselves).
  function rememberTicked(mru, before, after) {
    const was = Array.isArray(before) ? before : [];
    return (Array.isArray(after) ? after : [])
      .filter((code) => was.indexOf(code) < 0 && rowFor(code))
      .reduce((list, code) => rememberPick(list, ID_PREFIX + code), mruFrom(mru));
  }

  // ---- How a row reads -------------------------------------------------------
  // "NIV — New International Version", "Español — Spanish", "English". Two rows
  // that would read the same (api.bible lists World English Bible Updated three
  // times) are told apart by api.bible's `description` ("Protestant"), else by
  // the id's edition suffix ("…-02" -> "(2)"), else by their order.
  function baseLabel(row) {
    return row.abbr ? `${row.abbr} — ${row.name}` : String(row.name || row.id);
  }

  function labelFor(row, list) {
    const base = baseLabel(row);
    const twins = (Array.isArray(list) ? list : []).filter((r) => r !== row && baseLabel(r) === base);
    if (!twins.length) return base;
    const desc = (r) => (typeof r.description === 'string' ? r.description.trim() : '');
    if (desc(row) && twins.every((r) => desc(r) !== desc(row))) return `${base} (${desc(row)})`;
    const edition = (r) => {
      const m = /-([0-9a-z]+)$/i.exec(String(r.id));
      return m ? m[1].replace(/^0+(?=.)/, '') : '';
    };
    if (edition(row) && twins.every((r) => edition(r) !== edition(row))) return `${base} (${edition(row)})`;
    const n = list.filter((r) => baseLabel(r) === base).indexOf(row);
    return n < 0 ? base : `${base} (${n + 1})`;
  }

  // The translation dropdown: on a Bible chapter "Bible versions" then
  // "Languages", each only when it has rows; elsewhere the rows unheaded.
  //   -> [{ label: 'Bible versions' | 'Languages' | null, items: [{ id, label }] }]
  function menuFor(list, opts) {
    const rows = Array.isArray(list) ? list : [];
    const item = (r) => ({ id: r.id, label: labelFor(r, rows) });
    const bible = rows.filter((r) => r.provider !== PROVIDER).map(item);
    const church = rows.filter((r) => r.provider === PROVIDER).map(item);
    if (!(opts && opts.isBible)) {
      return bible.length || church.length ? [{ label: null, items: bible.concat(church) }] : [];
    }
    const groups = [];
    if (bible.length) groups.push({ label: 'Bible versions', items: bible });
    if (church.length) groups.push({ label: 'Languages', items: church });
    return groups;
  }

  // The languages the setup card offers to add: every Church language that
  // publishes this chapter's volume, minus the page's own and any already on.
  // One A–Z list by English name, each label English first ("Spanish —
  // Español"): the reader of an English page looks a language up by its
  // English name, and a native <select>'s type-ahead matches a label's start.
  //   -> [{ code, label }]
  function languagesToAdd(opts) {
    const o = opts || {};
    const on = Array.isArray(o.enabled) ? o.enabled : [];
    return C.CHURCH_LANGUAGES
      .filter((l) => l.code !== o.pageLang && on.indexOf(l.code) < 0 && publishes(l.code, o.collection))
      .sort((a, b) => a.english.localeCompare(b.english, 'en'))
      .map((l) => ({ code: l.code, label: l.name === l.english ? l.english : `${l.english} — ${l.name}` }));
  }

  // ---- Where the chapter lives ----------------------------------------------

  function chapterUri(parsed) {
    return `/scriptures/${parsed.collection}/${parsed.ldsBook}/${parsed.chapter}`;
  }

  function apiUrl(lang, uri) {
    return `${API_PATH}?${new URLSearchParams({ lang, uri }).toString()}`;
  }

  // ---- Markup -> IR (pure) ---------------------------------------------------

  const ELEMENT = 1;
  const TEXT = 3;
  const SKIP = { footer: 1, nav: 1, figure: 1, img: 1, table: 1, script: 1, style: 1, template: 1, aside: 1 };

  function tagOf(node) { return String(node.tagName || '').toLowerCase(); }
  function classesOf(node) {
    const c = node.getAttribute && node.getAttribute('class');
    return c ? String(c).split(/\s+/).filter(Boolean) : [];
  }
  function kids(node) { return Array.from(node.childNodes || []); }

  // Text as the reader sees it: ruby readings and footnote letters excluded.
  function textOf(node) {
    if (node.nodeType === TEXT) return node.nodeValue || '';
    if (node.nodeType !== ELEMENT) return '';
    const tag = tagOf(node);
    if (tag === 'rt' || tag === 'rp' || SKIP[tag]) return '';
    if (classesOf(node).includes('marker')) return '';
    return kids(node).map(textOf).join('');
  }

  // Poetry lines are blocks on the site, so each one gets its own row here —
  // and so does prose on either side of them ("Entonces María dijo:" before
  // Luke 1:46's first line, "que interpretado es…" after Matthew 1:23's last).
  // `ctx.lines` counts the lines seen in this paragraph; `ctx.afterLine` is set
  // while the last thing written was the end of a line, so the next visible
  // text starts a new row.
  function hasVisible(runs) {
    return runs.some((r) => r.t === 'ruby' || (r.t === 'txt' && r.s.trim()));
  }

  function breakAfterLine(runs, ctx, s) {
    if (ctx.afterLine && s.trim()) {
      runs.push({ t: 'br' });
      ctx.afterLine = false;
    }
  }

  function pushText(runs, s, ctx) {
    if (!s) return;
    breakAfterLine(runs, ctx, s);
    const last = runs[runs.length - 1];
    if (last && last.t === 'txt') last.s += s;
    else runs.push({ t: 'txt', s });
  }

  function collectRuns(node, runs, ctx) {
    for (const child of kids(node)) {
      if (child.nodeType === TEXT) { pushText(runs, child.nodeValue, ctx); continue; }
      if (child.nodeType !== ELEMENT) continue;
      const tag = tagOf(child);
      const cls = classesOf(child);
      if (SKIP[tag] || tag === 'rt' || tag === 'rp') continue;
      if (cls.includes('marker') || cls.includes('para-mark')) continue;
      if (tag === 'br') { runs.push({ t: 'br' }); continue; }
      if (cls.includes('verse-number')) {
        const n = textOf(child).trim();
        if (n) runs.push({ t: 'v', n });
        continue;
      }
      if (tag === 'ruby') {
        // textOf skips an <rt> itself (it is not base text), so read inside it.
        const rt = kids(child).filter((k) => k.nodeType === ELEMENT && tagOf(k) === 'rt')
          .map((k) => kids(k).map(textOf).join('')).join('');
        const s = textOf(child);
        if (s && rt) {
          breakAfterLine(runs, ctx, s);
          runs.push({ t: 'ruby', s, rt });
        } else {
          pushText(runs, s, ctx);
        }
        continue;
      }
      if (cls.includes('line')) {
        if (ctx.lines++ > 0 || hasVisible(runs)) runs.push({ t: 'br' });
        ctx.afterLine = false;
        collectRuns(child, runs, ctx);
        ctx.afterLine = true;
        continue;
      }
      collectRuns(child, runs, ctx); // links, emphasis, small caps, … -> their text
    }
  }

  function paraOf(node, style) {
    const runs = [];
    const ctx = { lines: 0, afterLine: false };
    collectRuns(node, runs, ctx);
    if (!runs.some((r) => r.t !== 'txt' || r.s.trim())) return null;
    return { type: 'para', style: style === 'p' && ctx.lines > 0 ? 'q1' : style, runs };
  }

  function blockOf(node) {
    const id = String((node.getAttribute && node.getAttribute('id')) || '');
    const block = classify(node, id);
    if (block && id) block.id = id;
    return block;
  }

  function classify(node, id) {
    const tag = tagOf(node);
    const cls = classesOf(node);
    if (/^h[1-6]$/.test(tag) || /^title(_number)?\d/.test(id) || cls.includes('title-number')) {
      const text = textOf(node).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      // Japanese titles carry furigana; plain text would lose the readings.
      const runs = [];
      collectRuns(node, runs, { lines: 0, afterLine: false });
      return runs.some((r) => r.t === 'ruby') ? { type: 'heading', text, runs } : { type: 'heading', text };
    }
    if (/^study_summary\d/.test(id) || cls.includes('study-summary')) return paraOf(node, 'summary');
    if (/^(intro|study_intro|subtitle)\d/.test(id) || cls.includes('intro') || cls.includes('study-intro')) {
      return paraOf(node, 'intro');
    }
    return paraOf(node, 'p');
  }

  function blockElements(node, found = []) {
    for (const child of kids(node)) {
      if (child.nodeType !== ELEMENT) continue; // whitespace between blocks
      const tag = tagOf(child);
      if (SKIP[tag]) continue;
      if (tag === 'p' || /^h[1-6]$/.test(tag)) found.push(child);
      else blockElements(child, found); // header, div.body-block, section, …
    }
    return found;
  }

  function isVerse(block) {
    return block.type === 'para' && block.runs.some((r) => r.t === 'v');
  }

  // Scripts written right to left, by BCP 47 primary subtag.
  const RTL = { ar: 1, fa: 1, ur: 1, he: 1, yi: 1, ps: 1, sd: 1, ug: 1, dv: 1, ckb: 1 };
  function dirOf(bcp47) {
    return RTL[String(bcp47 || '').toLowerCase().split('-')[0]] ? 'rtl' : '';
  }

  function chapterFrom(rootNode, meta) {
    const blocks = rootNode ? blockElements(rootNode).map(blockOf).filter(Boolean) : [];
    const m = meta || {};
    const attrs = m.pageAttributes || {};
    const bcp47 = typeof attrs['data-bcp47-lang'] === 'string' ? attrs['data-bcp47-lang'] : '';
    return {
      blocks,
      verses: blocks.filter(isVerse).length,
      title: typeof m.title === 'string' ? m.title.trim() : '',
      bcp47,
      dir: dirOf(bcp47),
      uri: typeof attrs['data-uri'] === 'string' ? attrs['data-uri'] : '',
    };
  }

  // Is this parsed page the chapter that was asked for? The endpoint answers a
  // missing book or chapter with 200 and a contents page, not a 404 — told
  // apart by its data-uri. Verses are only the fallback when a page names no
  // uri: an Official Declaration is a chapter without a single verse number.
  function servesChapter(chapter, uri) {
    if (!chapter || !chapter.blocks.length) return false;
    if (chapter.uri) return chapter.uri === uri;
    return chapter.verses > 0;
  }

  const CORE = {
    PROVIDER, ID_PREFIX, MRU_MAX, rowFor, textsFor, pickText, pickOrder, firstOffered, chapterOffer, pageLanguage, mruFrom, rememberPick, rememberTicked, labelFor, menuFor, languagesToAdd,
    chapterUri, apiUrl, chapterFrom, blockElements, servesChapter, dirOf,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- Fetch (DOM shell) -----------------------------------------------------

  const ERR = C.ERR;
  const CACHE_MAX = 40;
  const cache = new Map(); // checkKey -> chapter, oldest first
  const inFlight = new Map(); // checkKey -> pending load, shared by concurrent callers
  // What the chapter check learned this tab, checkKey -> 'found' |
  // 'unavailable'. Unbounded but tiny; never evicted, so a language that lacks
  // a chapter is fetched for it once per tab, and one that has it is known to
  // even after `cache` evicted its text.
  const known = new Map();

  function err(code, message) {
    return { error: { code, message: message || code } };
  }

  // The panel card and the page split ask for the same chapter at once; they
  // share one request rather than racing two.
  // One language's chapter, as every per-tab record of it is keyed.
  function checkKey(parsed, lang) {
    return `${lang}|${chapterUri(parsed)}`;
  }

  function load(parsed, lang) {
    const uri = chapterUri(parsed);
    const key = checkKey(parsed, lang);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (known.get(key) === 'unavailable') return Promise.resolve(err(ERR.NOT_FOUND));
    if (!inFlight.has(key)) {
      inFlight.set(key, fetchChapter(uri, lang, key).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  async function fetchChapter(uri, lang, key) {
    const missing = () => { known.set(key, 'unavailable'); return err(ERR.NOT_FOUND); };
    let res;
    try { res = await fetch(apiUrl(lang, uri), { credentials: 'omit' }); }
    catch (e) { return err(ERR.NETWORK, String(e)); }
    if (res.status === 404) return missing();
    if (!res.ok) return err(ERR.UNKNOWN, `HTTP ${res.status}`);

    let json;
    try { json = await res.json(); } catch (e) { return err(ERR.UNKNOWN, 'Unreadable response'); }
    const body = json && json.content && json.content.body;
    if (typeof body !== 'string') return missing();

    // An inert document: DOMParser runs no scripts and loads no resources, and
    // only text is read back out of it.
    const doc = new DOMParser().parseFromString(body, 'text/html');
    const chapter = chapterFrom(doc.body, json.meta);
    if (!servesChapter(chapter, uri)) return missing();

    known.set(key, 'found');
    cache.set(key, chapter);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return chapter;
  }

  // The chapter check's results for `parsed` so far, as chapterOffer reads
  // them: { [lang]: 'found' | 'unavailable' | 'error' }, languages not
  // checked absent. `failed` is the caller's Set of checkKeys whose check
  // failed (network): what this tab learned outranks it.
  function checkResults(parsed, langs, failed) {
    const out = {};
    for (const lang of langs || []) {
      const key = checkKey(parsed, lang);
      const r = known.get(key) || (failed && failed.has(key) ? 'error' : null);
      if (r) out[lang] = r;
    }
    return out;
  }

  root.__BTX = Object.assign(root.__BTX || {}, {
    churchText: Object.assign({}, CORE, { load, checkKey, checkResults }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
