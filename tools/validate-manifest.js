#!/usr/bin/env node
/*
 * Spec #69 checks A23 and A27 for manifest.json: the manifest describes the
 * extension the Store ships.
 *   - version is 1.0.0 or later (three numbers);
 *   - the name avoids "Gospel Library" and "Scripture Citation Index" and fits
 *     Chrome's 75-character limit;
 *   - the description is at most 132 characters and names both modes
 *     (translation, citations);
 *   - host_permissions are exactly api.bible, its FUMS reporting host and
 *     scriptures.byu.edu, all in version 1 (a host added in an update
 *     disables every install until the reader accepts it); `storage` is the
 *     only API permission;
 *   - both pack directories (public and personal) are web-accessible;
 *   - `key`, when present, is a public key (base64 DER SubjectPublicKeyInfo).
 *     It comes from the Store dashboard once the listing exists (owner, #84);
 *     until then its absence is a warning, not a failure;
 *   - the Store listing texts (docs/store/listing.md) match it: the
 *     description's first sentence names both modes and carries the BYU
 *     source and not-affiliated line, no word repeats more than five times,
 *     the single-purpose text is the spec's, every permission and host has a
 *     one-line justification, the URLs are the About card's (C.ABOUT);
 *   - the privacy policy (A28, A30) exists at the docs/ path C.ABOUT.privacyUrl
 *     names, carries the Limited Use statement verbatim and the BYU source
 *     line, names every host the manifest reaches as a party, and covers
 *     synced vs device storage, deletion (uninstall), and no analytics, sale
 *     or ads.
 * Run: node tools/validate-manifest.js   Exits non-zero on failure.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const eq = (a, b, msg) => check(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

console.log('Version (1.0.0):');
const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version || '');
check(v && Number(v[1]) >= 1, `version is 1.0.0 or later, three numbers (got ${manifest.version})`);

console.log('Name and description (A27):');
const name = String(manifest.name || '');
check(name && !/gospel library/i.test(name), `the name does not contain "Gospel Library" (${name})`);
check(!/scripture citation index/i.test(name), 'the name does not contain "Scripture Citation Index"');
check(name.length <= 75, `the name fits Chrome's 75 characters (${name.length})`);
const desc = String(manifest.description || '');
check(desc && desc.length <= 132, `the description is at most 132 characters (${desc.length})`);
check(/translation/i.test(desc), 'the description names Translation mode');
check(/\bcit(e|es|ation|ations)\b/i.test(desc), 'the description names Citations mode');

console.log('Permissions (A23):');
const HOSTS = ['https://api.scripture.api.bible/*', 'https://fums.api.bible/*', 'https://scriptures.byu.edu/*'];
check(same(manifest.host_permissions || [], HOSTS),
  `host_permissions are exactly ${HOSTS.join(', ')} (got ${JSON.stringify(manifest.host_permissions)})`);
check(!manifest.optional_host_permissions, 'no optional host permissions: every host ships in version 1');
check(same(manifest.permissions || [], ['storage']), `storage is the only API permission (got ${JSON.stringify(manifest.permissions)})`);
const scriptMatches = (manifest.content_scripts || []).flatMap((s) => s.matches || []);
check(same(scriptMatches, ['https://www.churchofjesuschrist.org/study*']), 'content scripts run on churchofjesuschrist.org/study only');

console.log('Web-accessible packs:');
const wars = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
check(wars.includes('src/citations/data/*'), 'the public pack directory is web-accessible');
check(wars.includes('src/citations/data-personal/*'), 'the personal pack directory is web-accessible');
check(wars.includes('src/citations/store-stamp.json'), 'the Store stamp is web-accessible (the pack probe reads it first, issue #90)');

console.log('Key (A25):');
if (manifest.key == null) {
  console.log('  ! no `key` yet: add the Store listing\'s public key from the dashboard (owner, #84)');
} else {
  let ok = false;
  try {
    ok = crypto.createPublicKey({ key: Buffer.from(String(manifest.key), 'base64'), format: 'der', type: 'spki' }).type === 'public';
  } catch (e) { ok = false; }
  check(ok, '`key` is a base64 DER public key (the dashboard\'s "Public key", without the PEM header lines)');
}

// The Store listing texts (docs/store/listing.md) are pasted into the
// dashboard: they must match what this manifest asks for.
console.log('Store listing texts (A27, A28):');
const C = require(path.join(ROOT, 'src/shared/constants.js'));
const listing = fs.readFileSync(path.join(ROOT, 'docs/store/listing.md'), 'utf8').replace(/\r\n/g, '\n');
const section = (title) => ((listing.split(/^## /m).find((s) => s.startsWith(title + '\n')) || '').slice(title.length + 1)).trim();
// A section's pasteable text: the fenced block in it.
const pasted = (title) => ((section(title).match(/```text\n([\s\S]*?)\n```/) || [])[1] || '').trim();
check(listing.includes('`' + name + '`'), 'the listing names the manifest name');
const storeDesc = pasted('Description');
const first = (storeDesc.match(/^[^.]*\./) || [''])[0];
check(/translation/i.test(first) && /\bcit(e|es|ation|ations)\b/i.test(first), 'the description\'s first sentence names both modes');
check(storeDesc.includes(C.ABOUT.citationSource), 'the description carries the BYU source line and the not-affiliated line (C.ABOUT.citationSource)');
const counts = {};
for (const w of storeDesc.toLowerCase().match(/[a-z’']{5,}/g) || []) counts[w] = (counts[w] || 0) + 1;
const repeated = Object.keys(counts).filter((w) => counts[w] > 5);
check(!repeated.length, `no word repeats more than 5 times in the description (${repeated.map((w) => `${w} ×${counts[w]}`).join(', ')})`);
check(storeDesc.length <= 16000, 'the description fits the dashboard field');
eq(pasted('Single purpose'), 'Scripture study on churchofjesuschrist.org/study: for the chapter being read, show it in another '
  + 'translation or language and list the talks that cite each verse.', 'the single-purpose text is the spec\'s');
const justified = section('Permission justifications');
for (const p of [...(manifest.permissions || []), ...(manifest.host_permissions || []), ...scriptMatches]) {
  check(new RegExp('^- `' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`: \\S', 'm').test(justified), `a one-line justification for ${p}`);
}
const dataTypes = section('Data usage');
for (const t of ['Authentication information', 'Website content', 'Web history']) {
  check(dataTypes.includes(t), `the data-usage answers tick ${t}`);
}
check(/^No\b/.test(pasted('Remote code')), 'remote code is answered No');
check(section('Privacy policy').includes(C.ABOUT.privacyUrl) && section('Support').includes(C.ABOUT.supportUrl),
  'the privacy policy and support URLs are the About card\'s (C.ABOUT)');

// The privacy policy (A28, A30) is the page C.ABOUT.privacyUrl publishes
// from this repo: the file the URL's path names under docs/.
console.log('Privacy policy (A30):');
const LIMITED_USE = 'The use of information received by this extension will adhere to the Chrome Web Store '
  + 'User Data Policy, including the Limited Use requirements.';
const policyPath = (C.ABOUT.privacyUrl.match(/\/blob\/[^/]+\/(docs\/.+\.md)$/) || [])[1];
check(policyPath, `C.ABOUT.privacyUrl names a markdown file under docs/ on a branch (${C.ABOUT.privacyUrl})`);
const policy = policyPath && fs.existsSync(path.join(ROOT, policyPath))
  ? fs.readFileSync(path.join(ROOT, policyPath), 'utf8').replace(/\r\n/g, '\n') : '';
check(policy, `the policy exists at ${policyPath || '(no path)'}`);
check(policy.includes(LIMITED_USE), 'the policy carries the Limited Use statement verbatim');
check(policy.includes(C.ABOUT.citationSource), 'the policy carries the BYU source line and the not-affiliated line (C.ABOUT.citationSource)');
// Every host the manifest lets the extension reach is a named party.
const hosts = [...(manifest.host_permissions || []), ...scriptMatches].map((p) => new URL(p.replace(/\*$/, '')).hostname);
for (const h of hosts) check(policy.includes(h), `the policy names ${h} as a party contacted`);
for (const word of [/\bsync\b/i, /\bdevice\b/i, /\buninstall/i]) {
  check(word.test(policy), `the policy covers ${word} (where data is stored, and how to delete it)`);
}
check(/no analytics/i.test(policy) && /\bsell|\bsold|\bsale\b/i.test(policy) && /\bads?\b/i.test(policy),
  'the policy states no analytics, no sale, no ads');

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
