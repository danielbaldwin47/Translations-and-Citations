#!/usr/bin/env node
/*
 * Build the Store zip (GLOSSARY.md "Store zip"): the Chrome Web Store upload,
 * made from the committed tree alone with `git archive`, so nothing gitignored
 * (the personal pack, source-data/) can ship. `.gitattributes` marks what the
 * archive leaves out: docs/, tools/, markdown files and git's dotfiles.
 *
 * The one file the zip carries that the commit does not: the Store stamp
 * (issue #90). The committed src/citations/store-stamp.json is export-ignored
 * and `git archive --add-virtual-file` writes cit-data's STORE_STAMP at the
 * same path, so the reader probes the public pack alone (cit-data.js header).
 *
 *   node tools/build-store-zip.js [--ref HEAD] [--out dist/translations-and-citations-{version}.zip]
 *
 * Archives the commit, not the working tree: commit first, and build the zip
 * at the release commit. Uncommitted changes are reported, never included.
 * tools/validate-store-zip.js checks the result (spec #69, A5).
 *
 * Exports storeZip({ref, out}), zipName(manifest), and a minimal zip reader
 * (zipEntries(buf), readEntry(buf, entry)) for the validator.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');
const { execFileSync } = require('child_process');
const citData = require('../src/citations/cit-data.js');

const ROOT = path.resolve(__dirname, '..');

// The upload's file name for a manifest.
function zipName(manifest) {
  return `translations-and-citations-${manifest.version}.zip`;
}

// Archive `ref` into `out` as a zip; returns `out`. The committed stamp is
// export-ignored and the Store stamp stands in its place.
function storeZip({ ref = 'HEAD', out }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const stampArg = `--add-virtual-file=${citData.STAMP_PATH}:${JSON.stringify(citData.STORE_STAMP)}\n`;
  execFileSync('git', ['archive', '--format=zip', `--output=${out}`, stampArg, ref], { cwd: ROOT });
  return out;
}

// The central directory's entries: [{ name, method, compressedSize, offset }].
function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    entries.push({
      name: buf.toString('utf8', at + 46, at + 46 + nameLen),
      method: buf.readUInt16LE(at + 10),
      compressedSize: buf.readUInt32LE(at + 20),
      offset: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// One entry's contents as a UTF-8 string (stored or deflated).
function readEntry(buf, entry) {
  const at = entry.offset;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  return (entry.method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
}

module.exports = { storeZip, zipName, zipEntries, readEntry };

if (require.main === module) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const ref = arg('--ref', 'HEAD');
  const manifest = JSON.parse(execFileSync('git', ['show', `${ref}:manifest.json`], { cwd: ROOT, encoding: 'utf8' }));
  const out = path.resolve(arg('--out', path.join(ROOT, 'dist', zipName(manifest))));
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) console.warn(`Note: uncommitted changes are not in the zip (it archives ${ref}):\n${dirty}`);
  storeZip({ ref, out });
  const entries = zipEntries(fs.readFileSync(out)).filter((e) => !e.name.endsWith('/'));
  console.log(`Store zip: ${out} (${entries.length} files, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB) from ${ref}.`);
}
