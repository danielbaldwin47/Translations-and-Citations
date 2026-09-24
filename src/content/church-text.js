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
 *     mruFrom(stored) / rememberPick(mru, id) -> [id]
 *       the preference itself: the reader's picks, newest first (MRU_MAX),
 *       migrated from the single id older versions stored.
 *
 *   how does each read, and what else could be added?
 *     labelFor(row, list) -> "NIV — New International Version" | "Español — Spanish"
 *       twins in `list` told apart by description, else id edition, else order
 *     menuFor(list) -> [{ label, items: [{ id, label }] }]
 *       the dropdown: 'Bible translations' then 'Church languages', headed only
 *       when both are there
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
 *       the Official Declarations have none. Results are cached per tab.
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
 *   footer (the study notes), nav, figure, img, table, script, style
 *                                      -> dropped whole
 *   any other inline element           -> flattened to its text
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

  // The translation dropdown: Bible translations, then Church languages, each
  // under its own heading only when both kinds are there.
  //   -> [{ label: 'Bible translations' | 'Church languages' | null, items: [{ id, label }] }]
  function menuFor(list) {
    const rows = Array.isArray(list) ? list : [];
    const item = (r) => ({ id: r.id, label: labelFor(r, rows) });
    const bible = rows.filter((r) => r.provider !== PROVIDER).map(item);
    const church = rows.filter((r) => r.provider === PROVIDER).map(item);
    if (bible.length && church.length) {
      return [{ label: 'Bible translations', items: bible }, { label: 'Church languages', items: church }];
    }
    return bible.length || church.length ? [{ label: null, items: bible.concat(church) }] : [];
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

  function collectBlocks(node, blocks) {
    for (const child of kids(node)) {
      if (child.nodeType !== ELEMENT) continue; // whitespace between blocks
      const tag = tagOf(child);
      if (SKIP[tag]) continue;
      if (tag === 'p' || /^h[1-6]$/.test(tag)) {
        const b = blockOf(child);
        if (b) blocks.push(b);
        continue;
      }
      collectBlocks(child, blocks); // header, div.body-block, section, …
    }
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
    const blocks = [];
    if (rootNode) collectBlocks(rootNode, blocks);
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
    PROVIDER, ID_PREFIX, MRU_MAX, rowFor, textsFor, pickText, mruFrom, rememberPick, labelFor, menuFor, languagesToAdd,
    chapterUri, apiUrl, chapterFrom, servesChapter, dirOf,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return; // Node: the pure core only.

  // ---- Fetch (DOM shell) -----------------------------------------------------

  const ERR = C.ERR;
  const CACHE_MAX = 40;
  const cache = new Map(); // `${lang}|${uri}` -> chapter, oldest first
  const inFlight = new Map(); // `${lang}|${uri}` -> pending load, shared by concurrent callers

  function err(code, message) {
    return { error: { code, message: message || code } };
  }

  // The panel card and the page split ask for the same chapter at once; they
  // share one request rather than racing two.
  function load(parsed, lang) {
    const uri = chapterUri(parsed);
    const key = `${lang}|${uri}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (!inFlight.has(key)) {
      inFlight.set(key, fetchChapter(uri, lang, key).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  async function fetchChapter(uri, lang, key) {
    let res;
    try { res = await fetch(apiUrl(lang, uri), { credentials: 'omit' }); }
    catch (e) { return err(ERR.NETWORK, String(e)); }
    if (res.status === 404) return err(ERR.NOT_FOUND);
    if (!res.ok) return err(ERR.UNKNOWN, `HTTP ${res.status}`);

    let json;
    try { json = await res.json(); } catch (e) { return err(ERR.UNKNOWN, 'Unreadable response'); }
    const body = json && json.content && json.content.body;
    if (typeof body !== 'string') return err(ERR.NOT_FOUND);

    // An inert document: DOMParser runs no scripts and loads no resources, and
    // only text is read back out of it.
    const doc = new DOMParser().parseFromString(body, 'text/html');
    const chapter = chapterFrom(doc.body, json.meta);
    if (!servesChapter(chapter, uri)) return err(ERR.NOT_FOUND);

    cache.set(key, chapter);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return chapter;
  }

  root.__BTX = Object.assign(root.__BTX || {}, {
    churchText: Object.assign({}, CORE, { load }),
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
