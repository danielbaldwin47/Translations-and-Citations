#!/usr/bin/env node
/*
 * Research (#64): how much of BYU's modern-conference cite set the Church's own
 * talk pages reproduce. For one conference label, fetches each talk from the
 * Church content API (cached under the second argument), derives scripture
 * references from (a) scripture links in the body and footnotes and (b)
 * plain-text references in footnote text, then matches each BYU cite in
 * src/citations/data by (book, chapter, verse overlap); a whole-chapter
 * reference matches any verse of that chapter.
 *
 *   node tools/research-church-byu-compare.js "April 2026 General Conference" ./cache-apr
 *
 * Prints: cites, found by link, found by footnote text, missed, Church links
 * with no BYU cite; then the misses and extras by speaker.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', 'src', 'citations', 'data');
const LBL = process.argv[2] || 'April 2026 General Conference';
const DIR = process.argv[3] || path.resolve(__dirname, '..', 'research-cache', LBL.replace(/\W+/g, '-'));
fs.mkdirSync(DIR, { recursive: true });
const sources = require(ROOT + '/sources.json');
const index = require(ROOT + '/index.json');
const nameToSlug = {};
for (const b of index.books) nameToSlug[b.fullName.toLowerCase()] = b.slug;
Object.assign(nameToSlug, { 'd&c': 'dc', 'doctrine and covenants': 'dc', 'js—h': 'js-h', 'joseph smith—history': 'js-h', 'joseph smith—matthew': 'js-m', 'articles of faith': 'a-of-f', 'official declaration': 'od', 'psalm': 'ps', 'words of mormon': 'w-of-m' });
const names = Object.keys(nameToSlug).sort((a, b) => b.length - a.length);
const nameRe = new RegExp('(?:^|[^A-Za-z])(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s+(\\d+)(?::([\\d,\\s–\\-]+))?', 'gi');
const expand = (v) => { const o = new Set(); for (const p of String(v).split(/[,;]\s*/)) { const m = p.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/); if (m) { for (let i = +m[1]; i <= +m[2]; i++) o.add(i); } else if (/^\d+$/.test(p.trim())) o.add(+p.trim()); } return o; };

const talks = Object.entries(sources).filter(([, s]) => s.lbl === LBL).map(([id, s]) => ({ id, ...s }));
const byu = {};
for (const f of fs.readdirSync(ROOT + '/citations')) {
  const slug = f.replace('.json', ''); const d = JSON.parse(fs.readFileSync(ROOT + '/citations/' + f));
  for (const [chap, verses] of Object.entries(d.index)) for (const ids of Object.values(verses)) for (const id of ids) {
    const c = d.cites[id]; if (!c) continue; const t = String(c.t); if (!sources[t] || sources[t].lbl !== LBL) continue;
    (byu[t] = byu[t] || new Map()).set(id, { slug, chap: +chap, vs: expand(c.v), raw: c.v });
  }
}

async function churchJson(url) {
  const uri = new URL(url).pathname.replace(/^\/study/, '');
  const cache = path.join(DIR, uri.replace(/\//g, '_') + '.json');
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache));
  const api = `https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=${uri}`;
  const r = await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130', Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + api);
  const j = await r.json(); fs.writeFileSync(cache, JSON.stringify(j)); return j;
}
function churchRefs(j) {
  const body = j.content.body || ''; const fn = j.content.footnotes; const list = Array.isArray(fn) ? fn : Object.values(fn || {});
  const refs = []; const seen = new Set();
  const add = (r) => { const k = r.slug + ' ' + r.chap + ' ' + [...r.vs].join(',') + ' ' + r.src; if (!seen.has(k)) { seen.add(k); refs.push(r); } };
  const fromHref = (h, src) => {
    const u = new URL(h.replace(/&amp;/g, '&'), 'https://x'); const seg = u.pathname.replace(/^\/study\/scriptures\//, '').split('/'); if (seg.length < 3) return;
    const slug = seg[seg.length - 2]; const cm = seg[seg.length - 1].split('.')[0].match(/^(\d+)(?:-(\d+))?$/); if (!cm) return;
    const id = u.searchParams.get('id'); const chaps = []; for (let c = +cm[1]; c <= +(cm[2] || cm[1]); c++) chaps.push(c);
    for (const chap of chaps) { const vs = new Set(); if (id && chaps.length === 1) for (const part of id.split(',')) { const m = part.match(/^p(\d+)(?:-p(\d+))?$/); if (!m) continue; for (let i = +m[1]; i <= +(m[2] || m[1]); i++) vs.add(i); } add({ slug, chap, vs, src }); }
  };
  for (const m of body.matchAll(/href="([^"]*\/study\/scriptures\/[^"]*)"/g)) fromHref(m[1], 'link');
  for (const f of list) {
    for (const r of f.referenceUris || []) if (r.href && /\/study\/scriptures\//.test(r.href)) fromHref(r.href, 'link');
    for (const m of String(f.text).matchAll(/href="([^"]*\/study\/scriptures\/[^"]*)"/g)) fromHref(m[1], 'link');
    const plain = String(f.text).replace(/<[^>]+>/g, ' ');
    for (const m of plain.matchAll(nameRe)) { const slug = nameToSlug[m[1].toLowerCase()]; if (slug) add({ slug, chap: +m[2], vs: m[3] ? expand(m[3].replace(/\s/g, '')) : new Set(), src: 'text' }); }
  }
  return refs;
}
const overlap = (a, b) => a.slug === b.slug && a.chap === b.chap && (a.vs.size === 0 || b.vs.size === 0 || [...a.vs].some((v) => b.vs.has(v)));

(async () => {
  const T = { cites: 0, hitLink: 0, hitText: 0, miss: 0, church: 0, churchOnly: 0 }; const misses = [], extras = [];
  for (const t of talks) {
    if (!t.url) { console.log('no url', t.id, t.ti); continue; }
    let j; try { j = await churchJson(t.url); } catch (e) { console.log('ERR', t.id, e.message); continue; }
    const refs = churchRefs(j); const cites = [...(byu[t.id] || new Map()).values()];
    for (const c of cites) {
      T.cites++;
      const hl = refs.find((r) => r.src === 'link' && overlap(c, r)); const ht = !hl && refs.find((r) => r.src === 'text' && overlap(c, r));
      if (hl) T.hitLink++; else if (ht) T.hitText++; else { T.miss++; misses.push(`${t.sp}: ${c.slug} ${c.chap}:${c.raw}`); }
    }
    for (const r of refs.filter((r) => r.src === 'link')) { T.church++; if (!cites.some((c) => overlap(c, r))) { T.churchOnly++; extras.push(`${t.sp}: ${r.slug} ${r.chap}:${[...r.vs].join(',') || '*'}`); } }
  }
  console.log(LBL, 'talks', talks.length, JSON.stringify(T));
  console.log('BYU cites found by Church link:', (T.hitLink / T.cites * 100).toFixed(1) + '%, by link or footnote text:', ((T.hitLink + T.hitText) / T.cites * 100).toFixed(1) + '%');
  console.log('Church scripture links with no BYU cite:', T.churchOnly, 'of', T.church);
  console.log('MISSES:', misses.join(' | ')); console.log('CHURCH-ONLY:', extras.join(' | '));
})();
