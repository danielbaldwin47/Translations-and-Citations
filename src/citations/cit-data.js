/*
 * Citation-index data access (content script). Loads one prebuilt,
 * web-accessible data pack on demand and caches it:
 *   - index.json             (the pack's index; its `pack` field is the descriptor)
 *   - sources.json           (talk metadata, loaded once)
 *   - citations/{slug}.json  (per-book shard: { cites, index })
 *   - talks/{talkId}.html.gz (talk HTML of every corpus whose descriptor
 *                            entry says text: 'bundled')
 *
 * Which pack (ADR-0008): the directories in PACK_DIRS, in order — the
 * personal pack (src/citations/data-personal/, not committed) first, then the
 * committed public pack (src/citations/data/). The first index.json that
 * carries a descriptor names the pack for the whole session: every later read
 * comes from that directory, and nothing is merged across the two. loadPack
 * memoizes the probe, so it runs once per page session. The probe exists only
 * because a gated element exists; if none remains, remove it.
 *
 * The Store stamp (issue #90): loadPack first reads STAMP_PATH, a committed
 * file that says {"storeZip": false}; tools/build-store-zip.js ships
 * STORE_STAMP in its place. Under the Store stamp packDirs asks the public
 * pack alone, so the Store zip never requests the personal directory it lacks
 * (Chrome logs a missed extension fetch, and no catch silences it). Both
 * builds hold the stamp file, so reading it never misses.
 *
 * Descriptor contract: loadPack() -> { dir, descriptor, index }, and
 * chapterData's result carries the same descriptor as `pack`. The descriptor
 * is the reader's only source of per-corpus facts: which corpora exist, each
 * one's source type, where its talk text comes from (`text`), its scroll-target
 * rule (`target`), whether its excerpts are bundled or fetched (`excerpt`), its
 * inclusion rule, and the pack vintage. This module never reads a corpus
 * letter and never infers a flavor from the directory it found the pack in.
 *
 * Everything is static + same-extension, so no service worker is involved.
 *
 * chapterData(slug, chapter) is what Citations mode reads: the chapter's
 * cites, each under the verses its own `v` lists (chapterIndex clips the
 * index's spans to that; see there), plus whether the book is in the index
 * at all. Each entry also carries what the footnote locator needs: its book
 * slug, chapter and refRank; and, for a corpus whose excerpt is fetched,
 * `excerptChars`, the length of the text its excerpt will show (absent: the
 * row reserves three lines). `talkId` is the shard's `t` as written: a number
 * for a talk from the BYU base, a `gc/YYYY/MM/{slug}` string for a derived one. chapterIndex, citedVerses and refRanks are pure, and
 * tools/validate-citations.js exercises them (chapterIndex over every shard).
 *
 * IIFE -> __BTX.citData (+ module.exports for the Node validator).
 */
(function (root) {
  'use strict';

  // Probe order: the personal pack first, then the public one.
  const PUBLIC_DIR = 'src/citations/data/';
  const PACK_DIRS = ['src/citations/data-personal/', PUBLIC_DIR];
  const STAMP_PATH = 'src/citations/store-stamp.json';
  const STORE_STAMP = { storeZip: true };

  // Pure: the stamp (parsed STAMP_PATH, or null) -> the directories to probe.
  function packDirs(stamp) {
    return stamp && stamp.storeZip === true ? [PUBLIC_DIR] : PACK_DIRS;
  }

  // Pure over `probe(dir) -> Promise<index|null>`: the first of `dirs` whose
  // index carries a descriptor -> { dir, descriptor, index }, or null.
  async function pickPack(probe, dirs = PACK_DIRS) {
    for (const dir of dirs) {
      let index = null;
      try { index = await probe(dir); } catch (e) { index = null; }
      if (index && index.pack && typeof index.pack === 'object') return { dir, descriptor: index.pack, index };
    }
    return null;
  }

  let packPromise = null;
  function loadPack() {
    if (!packPromise) {
      const read = (p) => fetch(chrome.runtime.getURL(p)).then((res) => (res.ok ? res.json() : null));
      const probe = (dir) => read(dir + 'index.json');
      packPromise = read(STAMP_PATH).catch(() => null)
        .then((stamp) => pickPack(probe, packDirs(stamp))).then((pack) => {
        if (!pack) { packPromise = null; throw new Error('no citation data pack'); }
        return pack;
      });
    }
    return packPromise;
  }

  const base = async (p) => chrome.runtime.getURL((await loadPack()).dir + p);

  let sourcesPromise = null;
  const shardPromises = {};   // slug -> Promise<shard|null>
  const talkPromises = {};    // talkId -> Promise<string|null>

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function loadSources() {
    if (!sourcesPromise) {
      sourcesPromise = base('sources.json').then(fetchJSON).catch((e) => {
        sourcesPromise = null; // allow retry
        throw e;
      });
    }
    return sourcesPromise;
  }

  // Returns the per-book shard, or null if the book has no data file.
  function loadShard(slug) {
    if (!(slug in shardPromises)) {
      shardPromises[slug] = base(`citations/${slug}.json`)
        .then((url) => fetch(url))
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }
    return shardPromises[slug];
  }

  // Bundled talk HTML (gzip). Returns decompressed HTML string, or null.
  function loadTalkHtml(talkId) {
    if (!(talkId in talkPromises)) {
      talkPromises[talkId] = (async () => {
        const res = await fetch(await base(`talks/${talkId}.html.gz`));
        if (!res.ok) return null;
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text();
      })().catch(() => null);
    }
    return talkPromises[talkId];
  }

  // The verses a cite's own `v` field lists: '5', '16-17', '1,4', '2-5,9'.
  function citedVerses(v) {
    const out = new Set();
    for (const part of String(v == null ? '' : v).split(',')) {
      const m = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
      if (!m) continue;
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let n = from; n <= to && n - from < 500; n++) out.add(n);
    }
    return out;
  }

  // Pure: one chapter of a shard's index -> which cites show under which
  // verse. The index can file a cite under verses its own `v` does not list
  // (a build fault in the shipped data: a John 3:5 cite filed under 1–38), so
  // each cite's span is clipped to its `v`. A clip that leaves nothing keeps
  // the index's span, and a verse left with no cite drops out.
  //   chap  { [verse]: [citId] }     cites  { [citId]: { v, … } }
  //   -> { verseOrder:[int] ascending, byVerse:{ [verse]:[citId] },
  //        spanOf:{ [citId]:[verse] ascending } }
  function chapterIndex(chap, cites) {
    const indexed = Object.keys(chap || {}).map(Number).sort((a, b) => a - b);
    const spanOf = {};
    for (const v of indexed) {
      for (const id of chap[String(v)] || []) (spanOf[id] = spanOf[id] || []).push(v);
    }
    for (const id of Object.keys(spanOf)) {
      const c = cites[id];
      if (!c) continue;
      const cited = citedVerses(c.v);
      const clipped = spanOf[id].filter((v) => cited.has(v));
      if (clipped.length) spanOf[id] = clipped;
    }
    const byVerse = {};
    for (const v of indexed) {
      const ids = (chap[String(v)] || []).filter((id) => spanOf[id].includes(v));
      if (ids.length) byVerse[v] = ids;
    }
    const verseOrder = indexed.filter((v) => byVerse[v]);
    return { verseOrder, byVerse, spanOf };
  }

  // Pure: each cite's 1-based rank by numeric cite id among the same talk's
  // cites of the same verses in this chapter (anchored cites included).
  // talkSource.locateParagraph takes the rank-th matching scripture link;
  // BYU's cite ids run in the talk's reading order.
  //   ids [citId] of one chapter, cites { [citId]: { t, v } } -> { [citId]: k }
  function refRanks(ids, cites) {
    const groups = new Map();
    for (const id of ids) {
      const c = cites[id];
      if (!c) continue;
      const key = `${c.t}|${[...citedVerses(c.v)].sort((a, b) => a - b).join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(String(id));
    }
    const out = {};
    for (const group of groups.values()) {
      group.sort((a, b) => Number(a) - Number(b)).forEach((id, i) => { out[id] = i + 1; });
    }
    return out;
  }

  // Deduped citations for a chapter, plus each citation's in-chapter verse span.
  // A single citation can cover a verse range, so it is indexed under every verse
  // it spans; we collect those verses (versesInChapter) so the panel can show a
  // citation once and label its range instead of repeating it per verse.
  // Returns { verseOrder:[int], byVerse:{ [verse]:[citId] }, entries:{ [citId]:entry },
  //   uniqueTotal, bookIndexed, bookName, pack } — or null when there is no
  //   pack or the book has no data file. bookIndexed is false when the shard
  //   indexes no chapter at all (the Official Declarations): a gap in the
  //   index, which the empty state says. pack is the pack descriptor, which
  //   the view-model reads source types and the vintage from.
  async function chapterData(slug, chapter) {
    let pack;
    try { pack = await loadPack(); } catch (e) { return null; }
    const [shard, sources] = await Promise.all([loadShard(slug), loadSources().catch(() => ({}))]);
    if (!shard) return null;
    const book = {
      bookIndexed: Object.keys(shard.index).length > 0,
      bookName: shard.fullName || null,
      pack: pack.descriptor,
    };
    const chap = shard.index[String(chapter)];
    if (!chap) return Object.assign({ verseOrder: [], byVerse: {}, entries: {}, uniqueTotal: 0 }, book);

    const { verseOrder, byVerse, spanOf } = chapterIndex(chap, shard.cites);
    const entries = {};
    const ranks = refRanks(Object.keys(spanOf), shard.cites);
    for (const id of Object.keys(spanOf)) {
      const c = shard.cites[id];
      if (!c) continue; // skip ids with no resolvable citation record
      entries[id] = {
        citId: id,
        talkId: c.t,
        verses: c.v,
        versesInChapter: spanOf[id],
        snippet: c.sn,
        excerptChars: c.ec,
        anchor: c.a,
        book: slug,
        chapter: Number(chapter),
        refRank: ranks[id],
        source: sources[c.t] || {},
      };
    }
    return Object.assign({ verseOrder, byVerse, entries, uniqueTotal: Object.keys(entries).length }, book);
  }

  const API = {
    PACK_DIRS, STAMP_PATH, STORE_STAMP, packDirs, pickPack, loadPack, loadSources, loadShard, loadTalkHtml, chapterData, chapterIndex, citedVerses,
    refRanks,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.__BTX = Object.assign(root.__BTX || {}, { citData: API });
})(typeof globalThis !== 'undefined' ? globalThis : this);
