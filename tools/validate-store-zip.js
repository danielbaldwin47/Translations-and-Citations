#!/usr/bin/env node
/*
 * Spec #69 check A5 for tools/build-store-zip.js: the Store zip holds the
 * committed tree at HEAD and the public pack, and nothing from the personal
 * pack directory, source-data/, docs/, tools/ or a markdown file; its Store
 * stamp has cit-data.js probe the public pack alone (issue #90).
 * Run: node tools/validate-store-zip.js   (builds the zip into a temp dir; needs git)
 * Exits non-zero on failure.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./build-store-zip.js');
const citData = require('../src/citations/cit-data.js');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const sample = (list) => list.slice(0, 5).join(', ') + (list.length > 5 ? ', …' : '');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'btx-store-zip-'));
try {
  const out = path.join(tmp, 'store.zip');
  store.storeZip({ ref: 'HEAD', out });
  const zip = fs.readFileSync(out);
  const entries = store.zipEntries(zip);
  const names = entries.map((e) => e.name).filter((n) => !n.endsWith('/'));

  console.log('Store zip contents:');
  check(names.includes('manifest.json'), 'manifest.json sits at the zip root');
  check(names.includes('src/citations/data/index.json'), 'the public pack is in the zip');
  const excluded = [
    ['the personal pack directory', (n) => n.startsWith('src/citations/data-personal/')],
    ['source-data/', (n) => n.startsWith('source-data/')],
    ['docs/', (n) => n.startsWith('docs/')],
    ['tools/', (n) => n.startsWith('tools/')],
    ['a markdown file', (n) => /\.md$/i.test(n)],
    ['a dotfile', (n) => n.split('/').some((p) => p.startsWith('.'))],
  ];
  for (const [what, hit] of excluded) {
    const found = names.filter(hit);
    check(found.length === 0, `nothing from ${what} (${found.length}: ${sample(found)})`);
  }

  // Everything else committed at HEAD ships, and nothing that is not committed.
  const committed = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const expected = committed.filter((n) => !excluded.some(([, hit]) => hit(n)));
  const inZip = new Set(names);
  const missing = expected.filter((n) => !inZip.has(n));
  const extra = names.filter((n) => !committed.includes(n));
  check(missing.length === 0, `every other committed file ships (${missing.length} missing: ${sample(missing)})`);
  check(extra.length === 0, `only committed files ship (${extra.length} extra: ${sample(extra)})`);

  console.log('Store zip pack:');
  const indexEntry = entries.find((e) => e.name === 'src/citations/data/index.json');
  const index = indexEntry ? JSON.parse(store.readEntry(zip, indexEntry)) : null;
  check(index && index.pack && index.pack.flavor === 'public', `the zip's pack descriptor says public (${index && index.pack && index.pack.flavor})`);
  check(index && index.pack && !('T' in index.pack.corpora), 'the zip\'s pack lists no T corpus');

  console.log('Store stamp (issue #90):');
  const stampEntries = entries.filter((e) => e.name === citData.STAMP_PATH);
  check(stampEntries.length === 1, `the zip holds ${citData.STAMP_PATH} once (${stampEntries.length})`);
  let stamp = null;
  try { stamp = stampEntries.length ? JSON.parse(store.readEntry(zip, stampEntries[0])) : null; } catch (e) { stamp = null; }
  const dirs = citData.packDirs(stamp);
  check(dirs.length === 1 && dirs[0] === 'src/citations/data/',
    `the zip's stamp has the reader probe the public pack alone (${JSON.stringify(stamp)} -> ${JSON.stringify(dirs)})`);

  const manifest = JSON.parse(store.readEntry(zip, entries.find((e) => e.name === 'manifest.json')));
  check(store.zipName(manifest) === `translations-and-citations-${manifest.version}.zip`, `the default zip name carries the manifest version (${store.zipName(manifest)})`);

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log(`\nAll checks passed. ${names.length} files in the Store zip.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
