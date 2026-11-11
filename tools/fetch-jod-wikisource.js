#!/usr/bin/env node
/*
 * Snapshot the Journal of Discourses from English Wikisource: a cached build
 * input for tools/build-jod-talks.js. Network only here; the talk builder and
 * the pack build run offline from the file this writes.
 *
 * Run (Node 22+, no npm install):
 *   node tools/fetch-jod-wikisource.js [--out ./source-data/wikisource-jod.json]
 *
 * What it sends (API:Etiquette, https://www.mediawiki.org/wiki/API:Etiquette):
 * one request at a time with PAUSE_MS between them, a User-Agent naming this
 * project and where to reach it, `maxlag=5` (a lagged server answers with a
 * maxlag error and a Retry-After, and the request is retried after it), and
 * batching through a generator:
 *   1. action=query generator=allpages gapprefix="Journal of Discourses/"
 *      (namespace 0, redirects skipped), prop=revisions|templates with each
 *      page's current revid, timestamp, user, sha1 and wikitext. Follows
 *      `continue` until done.
 *   2. For each page whose wikitext transcludes scans (`<pages index=…>`,
 *      volume 20 today), action=parse&oldid={revid}: the rendered HTML, whose
 *      page-number spans carry the printed page (data-page-number), plus the
 *      revid of every Page-namespace page it transcludes (action=query
 *      prop=revisions on those titles), so the scan text is pinned too.
 *
 * Output (one JSON file, pages sorted by title):
 *   { fetchedAt, api, userAgent,
 *     pages: [{ title, pageid, revid, timestamp, user, sha1, wikitext, templates:[title],
 *               scan?: { html, pages:[{ title, revid, timestamp }] } }] }
 * `revid` pins the text: tools/build-jod-talks.js writes it into each talk's
 * provenance row and permalink, so a rebuild from this file is reproducible,
 * and a refresh (rerun this tool) re-diffs against it.
 *
 * The pure helpers (queryUrl, mergePages, transcludes) are exported for
 * tools/validate-jod.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://en.wikisource.org/w/api.php';
const PREFIX = 'Journal of Discourses/';
const USER_AGENT = 'TranslationsAndCitations-JoD-snapshot/1.0 ' +
  '(https://github.com/danielbaldwin47/Translations-and-Citations/issues; build tool, serial requests)';
const PAUSE_MS = 1000;
const MAX_TRIES = 5;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// The API URL for `params`, with the parameters every request carries.
function queryUrl(params) {
  const u = new URL(API);
  const all = Object.assign({ format: 'json', formatversion: '2', maxlag: '5' }, params);
  for (const [k, v] of Object.entries(all)) u.searchParams.set(k, String(v));
  return u.href;
}

// Fold one generator batch's pages into `byId` (pageid -> page). A page can
// arrive over several batches with only some props filled in; later batches
// add to it and never blank what an earlier one gave.
function mergePages(byId, batch) {
  const pages = (batch && batch.query && batch.query.pages) || [];
  for (const p of pages) {
    const have = byId.get(p.pageid) || { pageid: p.pageid, title: p.title, templates: [] };
    const rev = p.revisions && p.revisions[0];
    if (rev) {
      have.revid = rev.revid;
      have.timestamp = rev.timestamp;
      have.user = rev.user;
      have.sha1 = rev.sha1;
      if (rev.slots && rev.slots.main && typeof rev.slots.main.content === 'string') have.wikitext = rev.slots.main.content;
    }
    for (const t of p.templates || []) if (!have.templates.includes(t.title)) have.templates.push(t.title);
    byId.set(p.pageid, have);
  }
  return byId;
}

// Whether a page's text lives in the scan's Page namespace instead of its own wikitext.
const transcludes = (wikitext) => /<pages\s[^>]*index\s*=/i.test(String(wikitext || ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(params) {
  const url = queryUrl(params);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' } });
    const retryAfter = Number(res.headers.get('retry-after')) || 5;
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    const lagged = body && body.error && body.error.code === 'maxlag';
    if (res.ok && body && !body.error) { await sleep(PAUSE_MS); return body; }
    if (attempt >= MAX_TRIES) throw new Error(`${url}: ${res.status} ${body && body.error ? body.error.code : ''}`);
    console.warn(`  ${lagged ? 'server lagged' : 'request failed (' + res.status + ')'}; retrying in ${retryAfter}s`);
    await sleep(retryAfter * 1000);
  }
}

async function snapshot() {
  const byId = new Map();
  let cont = {};
  let requests = 0;
  for (;;) {
    const body = await getJson(Object.assign({
      action: 'query',
      generator: 'allpages', gapprefix: PREFIX, gapnamespace: 0, gapfilterredir: 'nonredirects', gaplimit: 50,
      prop: 'revisions|templates', rvprop: 'ids|timestamp|user|sha1|content', rvslots: 'main', tllimit: 'max',
    }, cont));
    requests++;
    mergePages(byId, body);
    process.stdout.write(`\r  ${requests} requests, ${byId.size} pages`);
    if (!body.continue) break;
    cont = body.continue;
  }
  process.stdout.write('\n');

  const pages = [...byId.values()].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  for (const p of pages) {
    if (!transcludes(p.wikitext)) continue;
    console.log(`  scan-backed: ${p.title}`);
    const parsed = await getJson({ action: 'parse', oldid: p.revid, prop: 'text|templates', disablelimitreport: 1 });
    const pageTitles = (parsed.parse.templates || []).filter((t) => t.ns === 104).map((t) => t.title);
    const scanPages = [];
    for (let i = 0; i < pageTitles.length; i += 50) {
      const q = await getJson({ action: 'query', titles: pageTitles.slice(i, i + 50).join('|'), prop: 'revisions', rvprop: 'ids|timestamp' });
      for (const sp of q.query.pages || []) {
        const r = sp.revisions && sp.revisions[0];
        scanPages.push({ title: sp.title, revid: r ? r.revid : null, timestamp: r ? r.timestamp : null });
      }
    }
    scanPages.sort((a, b) => (a.title < b.title ? -1 : 1));
    p.scan = { html: parsed.parse.text, pages: scanPages };
  }
  return pages;
}

module.exports = { queryUrl, mergePages, transcludes, USER_AGENT };

if (require.main === module) {
  const out = path.resolve(arg('--out', path.join(__dirname, '..', 'source-data', 'wikisource-jod.json')));
  snapshot().then((pages) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), api: API, userAgent: USER_AGENT, pages }));
    console.log(`Wrote ${pages.length} pages to ${out}`);
  }).catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
}
