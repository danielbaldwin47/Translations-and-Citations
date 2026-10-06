/*
 * PROTOTYPE — throwaway, branch prototype/fetched-excerpts only. Never merge.
 *
 * Writes src/citations/data/PROTOTYPE-excerpt-lengths.json: { citId: chars }
 * for every modern (G) and early (E) conference cite — the character length
 * of the excerpt the fetched-excerpts prototype will show (the paragraph
 * holding the cite, as text, plus its two quote marks). A number only: no
 * talk text ships. The panel reserves exactly that much text's worth of
 * space before the fetch lands.
 *
 * Measured from the BYU content DB's copy of each talk. For G the citation
 * span's own label ("John 1:9") is dropped — the live page has no such label;
 * for E it stays, since the prototype shows BYU's own HTML.
 *
 *   node --experimental-sqlite tools/PROTOTYPE-excerpt-lengths.js --content <content.53.db>
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = path.resolve(__dirname, '..', 'src', 'citations', 'data');
const content = new DatabaseSync(arg('--content', path.resolve(__dirname, '..', 'source-data', 'content.53.db')), { readOnly: true });
const body = content.prepare('SELECT Text FROM talkbody WHERE TalkID=?');
const sources = JSON.parse(fs.readFileSync(path.join(DATA, 'sources.json'), 'utf8'));

const htmlCache = new Map();
function talkHtml(id) {
  if (!htmlCache.has(id)) {
    const r = body.get(id);
    htmlCache.set(id, r ? zlib.inflateSync(Buffer.from(r.Text).subarray(2)).toString('utf8') : null);
  }
  return htmlCache.get(id);
}

const textOf = (frag) => frag
  .replace(/<[^>]*>/g, '')
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, 'x')
  .replace(/[\s ]+/g, ' ')
  .trim();

// The paragraph around the span with this id: last <p|<div opening before it,
// first </p>|</div> after it.
function paragraphLength(html, citId, dropLabels) {
  const at = html.indexOf(`<span class="citation" id="${citId}"`);
  if (at < 0) return null;
  const open = Math.max(html.lastIndexOf('<p', at), html.lastIndexOf('<div', at));
  const closes = ['</p>', '</div>'].map((t) => html.indexOf(t, at)).filter((i) => i >= 0);
  if (open < 0 || !closes.length) return null;
  let frag = html.slice(open, Math.min(...closes));
  if (dropLabels) frag = frag.replace(/<span class="citation"[^>]*>.*?<\/span>/gs, '');
  const text = textOf(frag);
  return text ? text.length + 2 : null; // + the “ ” the row wraps it in
}

const out = {};
let n = 0, missing = 0;
for (const f of fs.readdirSync(path.join(DATA, 'citations'))) {
  const shard = JSON.parse(fs.readFileSync(path.join(DATA, 'citations', f), 'utf8'));
  for (const [id, c] of Object.entries(shard.cites)) {
    const src = sources[c.t];
    if (!src || !((src.c === 'G' && src.url) || src.c === 'E')) continue;
    const html = talkHtml(c.t);
    const len = html && paragraphLength(html, id, src.c === 'G');
    if (len) { out[id] = len; n++; } else missing++;
  }
}
fs.writeFileSync(path.join(DATA, 'PROTOTYPE-excerpt-lengths.json'), JSON.stringify(out));
const lens = Object.values(out).sort((a, b) => a - b);
const pct = (p) => lens[Math.floor(lens.length * p)];
console.log(`${n} cites measured, ${missing} not found; chars p10 ${pct(0.1)} p25 ${pct(0.25)} median ${pct(0.5)} p75 ${pct(0.75)}`);
console.log(`under 150 chars: ${lens.filter((l) => l < 150).length}; under 250: ${lens.filter((l) => l < 250).length}`);
