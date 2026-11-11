#!/usr/bin/env node
/*
 * Build the bundled World English Bible: the `engwebp` USFM archive from
 * ebible.org converted into the panel's translation IR (the shape api.js
 * documents), one file per USFM book, under C.BUNDLED_BIBLE.dir. The service
 * worker serves chapters from those files (provider `bundled`).
 *
 * Input (gitignored, cached beside the BYU databases):
 *   source-data/engwebp_usfm.zip   https://ebible.org/Scriptures/engwebp_usfm.zip
 * Fetch it once with:
 *   curl -L -o source-data/engwebp_usfm.zip https://ebible.org/Scriptures/engwebp_usfm.zip
 *
 * Run (Node 22+, no npm install):
 *   node tools/build-bible-data.js [--archive path] [--downloaded YYYY-MM-DD]
 * then: node tools/validate-bible-data.js
 * --downloaded defaults to the archive file's modification date.
 *
 * Output:
 *   {dir}/index.json   { id, name, source, sha256, downloaded, books: { GEN: 50, … } }
 *   {dir}/{USFM}.json  { book, chapters: { "1": [block, …], … } }
 *     block: { type:'heading', text } | { type:'para', style, runs }
 *     run:   { t:'v', n } | { t:'txt', s, wj }
 *
 * Conversion. The text is left unaltered — the condition of the name "World
 * English Bible" — and tools/validate-bible-data.js checks it, chapter by
 * chapter, against the USFM with its markup stripped. Only markup changes:
 *   \w word|strong="…"\w*, \+w … \+w*   -> the word (Strong's tags stripped)
 *   \f … \f*, \x … \x*                  -> dropped (footnotes, cross-references)
 *   \p \m \mi \nb \pi1 \li1 \q1 \q2     -> a para with that style (\nb as p)
 *   \b                                  -> ends the para (a stanza break)
 *   \d \ms1 \sp                         -> a heading (Psalm title, Psalms'
 *                                          "BOOK 1", Song's speaker)
 *   \wj … \wj*                          -> runs with wj: true (words of Jesus)
 *   \qs … \qs*, \bk … \bk*              -> plain text (Selah, a book title)
 *   \v N                                -> { t:'v', n }
 *   the book header before \c 1 (\id \h \toc \mt \cl …) -> not chapter text
 * Whitespace collapses to single spaces; a para's runs are trimmed at its ends.
 * Any other marker inside a chapter stops the build: new markup must be mapped
 * here, not silently dropped.
 *
 * Also exports readZip(buffer) -> { name: Buffer } (stored and deflated
 * entries; no dependencies) for the validator.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const BOOKS = require(path.join(ROOT, 'src/shared/books.js'));

const SOURCE_URL = 'https://ebible.org/Scriptures/engwebp_usfm.zip';

// ---- zip ----
function readZip(buf) {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    if (method === 0) out[name] = Buffer.from(raw);
    else if (method === 8) out[name] = zlib.inflateRawSync(raw);
    else throw new Error(`${name}: unsupported zip method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---- USFM -> IR ----
const PARA = { p: 'p', m: 'm', mi: 'mi', nb: 'p', pi1: 'pi1', li1: 'li1', q1: 'q1', q2: 'q2' };
const HEADING = new Set(['d', 'ms1', 'sp']);
const PLAIN_SPANS = new Set(['qs', 'bk']); // character spans whose text is plain text

// Notes out, Strong's tags off: what remains is text plus structural markers.
function stripNotes(text) {
  return text
    .replace(/\\f .*?\\f\*/gs, '')
    .replace(/\\x .*?\\x\*/gs, '')
    .replace(/\\(\+?)w ([^\\|]*)(?:\|[^\\]*)?\\\1w\*/g, '$2');
}

// One book's USFM -> { chapters: { n: blocks } }.
function convertBook(usfm, label) {
  const chapters = {};
  let blocks = null; // the current chapter's
  let para = null;
  let wj = false;

  const closePara = () => {
    if (para) {
      const runs = para.runs;
      // Trim the para's ends; drop a text run trimmed to nothing.
      const first = runs.findIndex((r) => r.t === 'txt');
      if (first >= 0) runs[first].s = runs[first].s.replace(/^\s+/, '');
      for (let i = runs.length - 1; i >= 0; i--) if (runs[i].t === 'txt') { runs[i].s = runs[i].s.replace(/\s+$/, ''); break; }
      para.runs = runs.filter((r) => r.t !== 'txt' || r.s !== '');
      if (para.runs.length) blocks.push(para);
    }
    para = null;
  };
  const openPara = (style) => { closePara(); para = { type: 'para', style, runs: [] }; };
  const addText = (s, where) => {
    if (!s) return;
    const text = s.replace(/\s+/g, ' ');
    if (!para) {
      if (!text.trim()) return;
      throw new Error(`${where}: text outside a paragraph: "${text.slice(0, 40)}"`);
    }
    const last = para.runs[para.runs.length - 1];
    const lastTxt = last && last.t === 'txt' ? last : null;
    // One space between runs, and a bare space joins the run before it (the
    // gap between two words-of-Jesus spans is not narration).
    const t = lastTxt && lastTxt.s.endsWith(' ') ? text.replace(/^ /, '') : text;
    if (!t) return;
    if (lastTxt && (lastTxt.wj === wj || t === ' ')) lastTxt.s += t;
    else para.runs.push({ t: 'txt', s: t, wj });
  };

  const lines = stripNotes(usfm).split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const where = `${label}:${ln + 1}`;
    if (!line.trim()) continue;
    const m = /^\\([a-z]+[0-9]*)(?:\s+|$)(.*)$/.exec(line);
    if (!m) throw new Error(`${where}: a line that opens with no marker`);
    const [, tag, rest] = m;
    if (tag === 'c') {
      closePara();
      const n = rest.trim();
      if (!/^\d+$/.test(n)) throw new Error(`${where}: bad chapter "${n}"`);
      blocks = chapters[n] = [];
      wj = false;
      continue;
    }
    if (!blocks) continue; // the book header, before \c 1
    if (HEADING.has(tag)) {
      closePara();
      if (/\\/.test(rest)) throw new Error(`${where}: markup in a heading`);
      const text = rest.replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: 'heading', text });
      continue;
    }
    let content = rest;
    if (Object.prototype.hasOwnProperty.call(PARA, tag)) openPara(PARA[tag]);
    else if (tag === 'b') { closePara(); continue; }
    else if (tag === 'v') content = line; // a verse continuing the para
    else throw new Error(`${where}: unmapped paragraph marker \\${tag}`);
    if (!para && content.trim()) throw new Error(`${where}: a verse outside a paragraph`);

    // Inline: verse numbers and character spans. The one space after an
    // opening marker is its delimiter, not text; a closing marker has none.
    const re = /\\v (\S+) ?|\\(\+?[a-z]+[0-9]*)(?:(\*)| ?)/g;
    let at = 0;
    let t;
    while ((t = re.exec(content))) {
      addText(content.slice(at, t.index), where);
      at = re.lastIndex;
      if (t[1] !== undefined) { para.runs.push({ t: 'v', n: t[1] }); continue; }
      const name = t[2];
      const closing = t[3] === '*';
      if (name === 'wj') { wj = !closing; continue; }
      if (PLAIN_SPANS.has(name)) continue;
      throw new Error(`${where}: unmapped character marker \\${name}${closing ? '*' : ''}`);
    }
    addText(content.slice(at), where);
  }
  closePara();
  return { chapters };
}

// ---- build ----
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main() {
  const archive = path.resolve(arg('--archive', path.join(ROOT, 'source-data', 'engwebp_usfm.zip')));
  if (!fs.existsSync(archive)) {
    console.error(`No archive at ${archive}. Fetch it with:\n  curl -L -o source-data/engwebp_usfm.zip ${SOURCE_URL}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(archive);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const downloaded = arg('--downloaded', fs.statSync(archive).mtime.toISOString().slice(0, 10));
  const files = readZip(buf);
  const out = path.join(ROOT, C.BUNDLED_BIBLE.dir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const books = {};
  let bytes = 0;
  for (const u of Object.values(BOOKS.LDS_TO_USFM)) {
    const name = Object.keys(files).find((f) => new RegExp(`^\\d+-${u}engwebp\\.usfm$`).test(f));
    if (!name) throw new Error(`the archive has no ${u}`);
    const { chapters } = convertBook(files[name].toString('utf8'), name);
    books[u] = Object.keys(chapters).length;
    const json = JSON.stringify({ book: u, chapters });
    bytes += json.length;
    fs.writeFileSync(path.join(out, `${u}.json`), json);
  }
  const index = { id: C.BUNDLED_BIBLE.id, name: C.BUNDLED_BIBLE.name, source: SOURCE_URL, sha256, downloaded, books };
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  const total = Object.values(books).reduce((a, b) => a + b, 0);
  console.log(`Wrote ${Object.keys(books).length} books, ${total} chapters, ${(bytes / 1e6).toFixed(1)} MB to ${path.relative(ROOT, out)}/`);
  console.log(`Archive ${sha256} (downloaded ${downloaded})`);
}

module.exports = { readZip, convertBook };
if (require.main === module) main();
