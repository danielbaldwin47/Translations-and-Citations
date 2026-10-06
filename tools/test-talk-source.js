/*
 * Unit tests for the pure (DOM-free) halves of the talk reader:
 *   src/citations/talk-source.js — the corpus plan over a pack descriptor (both
 *     flavors, and a corpus the descriptor lacks), the BYU URL builder and
 *     viewer hash, the per-corpus reading destination, the pre-2013 General
 *     Conference URL repair, the snippet fallback for finding a cite, and
 *     load()'s fetch policy (one fetch per talk per session, a bounded cache,
 *     per-host slots) over a stubbed fetch and pack;
 *   src/citations/talk-view.js   — the punctuation of BYU's inserted references.
 *
 * Run: node --test tools/test-talk-source.js
 * No test framework — node:test is built in (ADR-0002: no build step, no deps).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const talkSource = require('../src/citations/talk-source.js');
const talkView = require('../src/citations/talk-view.js');

const ORIGIN = 'https://www.churchofjesuschrist.org';

// Pack descriptors as each pack mode writes them (spec #69, "Flavors and the
// pack descriptor"). The public pack lists no T corpus; the personal pack does.
const CORPORA = {
  G: { sourceType: 'General Conference', text: 'live-church', target: 'anchor', excerpt: 'bundled', inclusion: 'all' },
  E: { sourceType: 'General Conference', text: 'live-byu', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all' },
  J: { sourceType: 'Journal of Discourses', text: 'bundled', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all' },
};
const PACK_BASE = { vintage: '2026-04', base: { db: 'core.53.db', updated: '2026-05-18' }, derived: [] };
const PUBLIC = { ...PACK_BASE, flavor: 'public', corpora: CORPORA };
const PERSONAL = {
  ...PACK_BASE,
  flavor: 'personal',
  corpora: {
    ...CORPORA,
    T: { sourceType: 'Teachings of the Prophet Joseph Smith', text: 'bundled', target: 'bodyPassage', excerpt: 'bundled', inclusion: 'all' },
  },
};

test('corpusPlan: modern General Conference is fetched from the Church site', () => {
  for (const pack of [PUBLIC, PERSONAL]) {
    assert.deepStrictEqual(talkSource.corpusPlan(pack, 'G'), { text: 'live-church', target: 'anchor' }, pack.flavor);
  }
});

test('corpusPlan: early GC is fetched from BYU and Journal of Discourses is bundled', () => {
  for (const pack of [PUBLIC, PERSONAL]) {
    assert.deepStrictEqual(talkSource.corpusPlan(pack, 'E'), { text: 'live-byu', target: 'citationSpan' }, pack.flavor);
    assert.deepStrictEqual(talkSource.corpusPlan(pack, 'J'), { text: 'bundled', target: 'citationSpan' }, pack.flavor);
  }
});

test('corpusPlan: a BYU talk needs no URL of its own', () => {
  assert.deepStrictEqual(talkSource.corpusPlan(PUBLIC, 'E', { hasUrl: false }), { text: 'live-byu', target: 'citationSpan' });
});

test('corpusPlan: the personal pack plans STPJS to the body passage', () => {
  assert.deepStrictEqual(talkSource.corpusPlan(PERSONAL, 'T'), { text: 'bundled', target: 'bodyPassage' });
});

test('corpusPlan: a corpus the descriptor lacks has no plan', () => {
  assert.strictEqual(talkSource.corpusPlan(PUBLIC, 'T'), null, 'the public pack has no STPJS');
  assert.strictEqual(talkSource.corpusPlan(PUBLIC, 'T', { hasUrl: true }), null, 'not even with a URL');
  assert.strictEqual(talkSource.corpusPlan(PERSONAL, 'X'), null, 'an unknown corpus');
  assert.strictEqual(talkSource.corpusPlan(PERSONAL, undefined), null, 'no corpus at all');
  assert.strictEqual(talkSource.corpusPlan(null, 'G'), null, 'no descriptor at all');
});

test('corpusPlan: a live talk that ships no URL reads the bundle', () => {
  assert.deepStrictEqual(talkSource.corpusPlan(PUBLIC, 'G', { hasUrl: false }), { text: 'bundled', target: 'anchor' });
  assert.deepStrictEqual(talkSource.corpusPlan(PUBLIC, 'G', { hasUrl: true }), { text: 'live-church', target: 'anchor' });
  // A bundled corpus is bundled with or without a URL.
  assert.deepStrictEqual(talkSource.corpusPlan(PUBLIC, 'J', { hasUrl: true }), { text: 'bundled', target: 'citationSpan' });
});

// BYU's talk fragment and viewer (spec #69 "Reader"; research note
// docs/research/early-conference-route.md on branch research/early-conference-route).
test('byuTalkUrl: the talk fragment endpoint for a BYU talk id', () => {
  assert.strictEqual(talkSource.byuTalkUrl(889), 'https://scriptures.byu.edu/content/talks_ajax/889');
  assert.strictEqual(talkSource.byuTalkUrl('889'), 'https://scriptures.byu.edu/content/talks_ajax/889');
});

test('byuTalkUrl: an id that is not a BYU talk number has no URL', () => {
  assert.strictEqual(talkSource.byuTalkUrl('gc/2026/10/12nelson'), null, 'a derived talk id');
  assert.strictEqual(talkSource.byuTalkUrl(''), null);
  assert.strictEqual(talkSource.byuTalkUrl(undefined), null);
  assert.strictEqual(talkSource.byuTalkUrl('12/../x'), null);
});

// Owner-verified in a browser on October 5, 2026: #:t379$22657 opens talk 889
// (J. Reuben Clark, April 1957) with cite 22657 highlighted.
test('byuViewerUrl: the talk id in hex, then the citation-span id in decimal', () => {
  assert.strictEqual(talkSource.byuViewerUrl(889, 22657), 'https://scriptures.byu.edu/#:t379$22657');
  assert.strictEqual(talkSource.byuViewerUrl('889', '22657'), 'https://scriptures.byu.edu/#:t379$22657');
});

test('byuViewerUrl: no cite id opens the talk at its top; no BYU id, no viewer', () => {
  assert.strictEqual(talkSource.byuViewerUrl(889, null), 'https://scriptures.byu.edu/#:t379');
  assert.strictEqual(talkSource.byuViewerUrl('gc/2026/10/12nelson', 5), null);
});

// The reading destination: where the reader header's external link and the
// error state send the reader, per corpus plan (spec #69 "Reader").
const NELSON = `${ORIGIN}/study/general-conference/2019/10/12nelson?lang=eng`;

test('readingDestination: modern General Conference goes to the Church page at its paragraph', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'G');
  assert.deepStrictEqual(
    talkSource.readingDestination(plan, { entry: { talkId: 6141, citId: 1, anchor: 'p21' }, source: { c: 'G', url: NELSON } }),
    { href: `${NELSON}&id=p21#p21`, label: 'Open on churchofjesuschrist.org' },
  );
});

test('readingDestination: the effective URL of a repaired redirect wins over the stored one', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'G');
  const stored = `${ORIGIN}/study/ensign/2012/11/temple-standard?lang=eng`;
  const landed = `${ORIGIN}/study/ensign/2012/11/sunday-morning-session/temple-standard?lang=eng`;
  assert.deepStrictEqual(
    talkSource.readingDestination(plan, { entry: { talkId: 1 }, source: { c: 'G', url: stored }, url: landed }),
    { href: landed, label: 'Open on churchofjesuschrist.org' },
  );
});

test('readingDestination: early General Conference goes to BYU\'s viewer at the cite', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'E');
  assert.deepStrictEqual(
    talkSource.readingDestination(plan, { entry: { talkId: 889, citId: 22657 }, source: { c: 'E' } }),
    { href: 'https://scriptures.byu.edu/#:t379$22657', label: 'Open on scriptures.byu.edu' },
  );
});

test('readingDestination: a bundled talk with a URL goes to that page', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'J');
  const permalink = 'https://en.wikisource.org/w/index.php?title=Journal_of_Discourses/Volume_1/X&oldid=123';
  assert.deepStrictEqual(
    talkSource.readingDestination(plan, { entry: { talkId: 10001, citId: 7 }, source: { c: 'J', url: permalink } }),
    { href: permalink, label: 'Open on en.wikisource.org' },
  );
});

test('readingDestination: no URL and no fetch host, or no plan, means no destination', () => {
  const entry = { talkId: 270163, citId: 9 };
  assert.strictEqual(talkSource.readingDestination(talkSource.corpusPlan(PERSONAL, 'T'), { entry, source: { c: 'T' } }), null);
  assert.strictEqual(talkSource.readingDestination(talkSource.corpusPlan(PUBLIC, 'T'), { entry, source: { c: 'T' } }), null);
  assert.strictEqual(
    talkSource.readingDestination(talkSource.corpusPlan(PUBLIC, 'E'), { entry: { talkId: 'gc/2026/10/x' }, source: { c: 'E' } }),
    null, 'a talk BYU does not hold',
  );
});

test('lastSlug: trailing slashes do not shift the slug', () => {
  assert.strictEqual(talkSource.lastSlug('/study/ensign/2012/11/temple-standard'), 'temple-standard');
  assert.strictEqual(talkSource.lastSlug('/study/ensign/2012/11/temple-standard/'), 'temple-standard');
  assert.strictEqual(talkSource.lastSlug('/study/ensign/2012/11'), '11');
});

test('bouncedToConference: a same-slug landing is not a bounce', () => {
  const url = `${ORIGIN}/study/general-conference/2019/10/12nelson?lang=eng`;
  assert.strictEqual(talkSource.bouncedToConference(url, url), false);
  assert.strictEqual(
    talkSource.bouncedToConference(url, `${ORIGIN}/study/general-conference/2019/10/12nelson`),
    false,
  );
});

test('bouncedToConference: a pre-2013 talk landing on the conference page is a bounce', () => {
  assert.strictEqual(
    talkSource.bouncedToConference(
      `${ORIGIN}/study/ensign/2012/11/temple-standard?lang=eng`,
      `${ORIGIN}/study/ensign/2012/11?lang=eng`,
    ),
    true,
  );
});

test('pickSessionUrl: recovers the session-qualified URL and keeps ?lang=eng', () => {
  const original = `${ORIGIN}/study/ensign/2012/11/temple-standard?lang=eng`;
  const landed = `${ORIGIN}/study/ensign/2012/11?lang=eng`;
  const hrefs = [
    '/study/ensign/2012/11?lang=eng',                                    // self / landing
    '/study/ensign/2012/11/temple-standard?lang=eng',                    // the session-less self-link
    '/study/ensign/2012/11/saturday-morning-session/other-talk?lang=eng',
    '/study/ensign/2012/11/sunday-morning-session/temple-standard?lang=eng',
  ];
  assert.strictEqual(
    talkSource.pickSessionUrl({ originalUrl: original, landedUrl: landed, hrefs }),
    `${ORIGIN}/study/ensign/2012/11/sunday-morning-session/temple-standard?lang=eng`,
  );
});

test('pickSessionUrl: absolute same-origin hrefs work too', () => {
  const original = `${ORIGIN}/study/ensign/2012/11/temple-standard?lang=eng`;
  assert.strictEqual(
    talkSource.pickSessionUrl({
      originalUrl: original,
      landedUrl: `${ORIGIN}/study/ensign/2012/11`,
      hrefs: [`${ORIGIN}/study/ensign/2012/11/sunday-morning-session/temple-standard`],
    }),
    `${ORIGIN}/study/ensign/2012/11/sunday-morning-session/temple-standard?lang=eng`,
  );
});

test('pickSessionUrl: ignores other origins, other slugs, and deeper paths', () => {
  const original = `${ORIGIN}/study/ensign/2012/11/temple-standard?lang=eng`;
  const landed = `${ORIGIN}/study/ensign/2012/11`;
  const hrefs = [
    'https://example.com/study/ensign/2012/11/x/temple-standard',       // foreign origin
    '/study/ensign/2012/11/sunday-morning-session/other-talk',          // other slug
    '/study/ensign/2012/11/a/b/temple-standard',                        // too deep
    '/study/ensign/2013/04/sunday-morning-session/temple-standard',     // other conference
    'javascript:void(0)',                                              // unparseable
  ];
  assert.strictEqual(talkSource.pickSessionUrl({ originalUrl: original, landedUrl: landed, hrefs }), null);
});

test('pickSessionUrl: no candidates yields null rather than a guess', () => {
  assert.strictEqual(
    talkSource.pickSessionUrl({
      originalUrl: `${ORIGIN}/study/ensign/2012/11/temple-standard`,
      landedUrl: `${ORIGIN}/study/ensign/2012/11`,
      hrefs: [],
    }),
    null,
  );
});

test('fullTalkUrl: no anchor leaves the URL alone', () => {
  const url = `${ORIGIN}/study/general-conference/2019/10/12nelson?lang=eng`;
  assert.strictEqual(talkSource.fullTalkUrl(url, ''), url);
  assert.strictEqual(talkSource.fullTalkUrl(url, null), url);
});

test('fullTalkUrl: appends the paragraph deep link, dropping any existing hash', () => {
  assert.strictEqual(
    talkSource.fullTalkUrl(`${ORIGIN}/study/general-conference/2019/10/12nelson?lang=eng`, 'p21'),
    `${ORIGIN}/study/general-conference/2019/10/12nelson?lang=eng&id=p21#p21`,
  );
  assert.strictEqual(
    talkSource.fullTalkUrl(`${ORIGIN}/study/general-conference/2019/10/12nelson`, 'p21'),
    `${ORIGIN}/study/general-conference/2019/10/12nelson?id=p21#p21`,
  );
  assert.strictEqual(
    talkSource.fullTalkUrl(`${ORIGIN}/study/x?lang=eng#p3`, 'p21'),
    `${ORIGIN}/study/x?lang=eng&id=p21#p21`,
  );
});

// Shapes taken from shipped General Conference cites that carry no paragraph
// anchor (every one from 2020 on), whose snippet is then the only locator.
test('snippetKey: stops at the first inline footnote marker', () => {
  assert.strictEqual(
    talkSource.snippetKey('I know your sorrows, and I have come to deliver you. 6 [ See Exodus 3:7–8 ]'),
    'I know your sorrows, and I have come to deliver you.',
  );
  assert.strictEqual(
    talkSource.snippetKey('We need “times of refreshing.” 10 [ Acts 3:19 ] Times of personal restoration.'),
    'We need “times of refreshing.”',
  );
});

test('snippetKey: stops at the ellipsis and keeps at most 60 characters', () => {
  const key = talkSource.snippetKey('Nephi described how in the latter days Satan would attempt to pacify and lull the children of God…');
  assert.strictEqual(key, 'Nephi described how in the latter days Satan would attempt t');
  assert.strictEqual(talkSource.snippetKey('The Savior commended His disciples… and more'), 'The Savior commended His disciples');
  // A leading ellipsis marks a mid-sentence start, not the end of the key.
  assert.strictEqual(talkSource.snippetKey('…and the gates of hell shall not prevail against it'), 'and the gates of hell shall not prevail against it');
});

test('snippetKey: collapses whitespace, non-breaking spaces included', () => {
  assert.strictEqual(
    talkSource.snippetKey('See Russell\u00a0M. Nelson,\n  “Opening   Remarks,” Ensign, Nov. 2018'),
    'See Russell M. Nelson, “Opening Remarks,” Ensign, Nov. 2018',
  );
});

test('snippetKey: too little text to pick out one paragraph yields null', () => {
  assert.strictEqual(talkSource.snippetKey('See John 3:16. 4 [ John 3:16 ]'), null);
  assert.strictEqual(talkSource.snippetKey(''), null);
  assert.strictEqual(talkSource.snippetKey(undefined), null);
  assert.strictEqual(talkSource.snippetKey('20 [ See 1 Nephi 3:7 ]'), null);
});

test('snippetMatches: ignores whitespace differences around inline markup', () => {
  const para = 'With those raised hands, we were participating in common consent,\u00a0where we can choose';
  assert.strictEqual(talkSource.snippetMatches(para, 'participating in common consent , where'), true);
  assert.strictEqual(talkSource.snippetMatches(para, 'participating in general conference'), false);
  assert.strictEqual(talkSource.snippetMatches(para, null), false);
});

// load() through its public interface. The pack and the network are stubs:
// citData hands back a descriptor, and fetch records each request and answers
// from `respond(url)` once `gate()` lets it. Each test uses its own talk ids,
// because the talk cache lives for the session (the module's lifetime).
function stubReader(descriptor, { respond, gate } = {}) {
  const log = { requests: [], bundleReads: 0, inFlight: 0, peak: {} };
  globalThis.__BTX.citData = {
    loadPack: async () => ({ dir: 'src/citations/data/', descriptor }),
    loadTalkHtml: async () => { log.bundleReads++; return '<p>bundled</p>'; },
  };
  const inFlightBy = {};
  globalThis.fetch = async (url, init) => {
    const host = new URL(url).hostname;
    log.requests.push({ url, init });
    inFlightBy[host] = (inFlightBy[host] || 0) + 1;
    log.peak[host] = Math.max(log.peak[host] || 0, inFlightBy[host]);
    try {
      if (gate) await gate();
      const r = respond ? respond(url) : { html: `<div class="gcera">${url}</div>` };
      if (r.error) throw new TypeError('Failed to fetch');
      return { ok: r.status == null || r.status < 400, status: r.status || 200, url, text: async () => r.html };
    } finally {
      inFlightBy[host]--;
    }
  };
  return log;
}

test('load: an early-conference talk is fetched from BYU, credentials omitted', async () => {
  const log = stubReader(PUBLIC);
  const r = await talkSource.load({ entry: { talkId: 889, citId: 22657 }, source: { c: 'E' } });
  assert.deepStrictEqual(log.requests.map((q) => q.url), ['https://scriptures.byu.edu/content/talks_ajax/889']);
  assert.strictEqual(log.requests[0].init.credentials, 'omit');
  assert.strictEqual(r.html, '<div class="gcera">https://scriptures.byu.edu/content/talks_ajax/889</div>');
  assert.strictEqual(r.credit, 'Text fetched from scriptures.byu.edu');
  assert.deepStrictEqual(r.destination, { href: 'https://scriptures.byu.edu/#:t379$22657', label: 'Open on scriptures.byu.edu' });
  assert.strictEqual(log.bundleReads, 0);
});

test('load: a failed BYU fetch offers the viewer link, never the bundle', async () => {
  for (const respond of [() => ({ error: true }), () => ({ status: 503, html: 'busy' })]) {
    const log = stubReader(PUBLIC, { respond });
    const r = await talkSource.load({ entry: { talkId: 890, citId: 5 }, source: { c: 'E' } });
    assert.strictEqual(r.html, null);
    assert.deepStrictEqual(r.destination, { href: 'https://scriptures.byu.edu/#:t37a$5', label: 'Open on scriptures.byu.edu' });
    assert.strictEqual(log.bundleReads, 0);
  }
});

test('destination: known before the talk loads, with no request', async () => {
  const log = stubReader(PUBLIC);
  assert.deepStrictEqual(
    await talkSource.destination({ entry: { talkId: 889, citId: 22657 }, source: { c: 'E' } }),
    { href: 'https://scriptures.byu.edu/#:t379$22657', label: 'Open on scriptures.byu.edu' },
  );
  assert.strictEqual(await talkSource.destination({ entry: { talkId: 1 }, source: { c: 'T' } }), null);
  assert.strictEqual(log.requests.length, 0);
});

test('load: a bundled talk reads the pack and credits no fetch', async () => {
  const log = stubReader(PUBLIC);
  const r = await talkSource.load({ entry: { talkId: 10001, citId: 7 }, source: { c: 'J' } });
  assert.strictEqual(r.html, '<p>bundled</p>');
  assert.strictEqual(r.credit, null);
  assert.strictEqual(r.destination, null);
  assert.strictEqual(log.requests.length, 0);
});

test('load: a talk is fetched once per session, however often and however soon it opens again', async () => {
  const log = stubReader(PUBLIC);
  const open = (citId) => talkSource.load({ entry: { talkId: 900, citId }, source: { c: 'E' } });
  const [a, b] = await Promise.all([open(1), open(2)]); // two views at once
  const c = await open(3);                              // and a reopen later
  assert.strictEqual(log.requests.length, 1);
  assert.ok(a.html && a.html === b.html && b.html === c.html);
  assert.strictEqual(c.destination.href, 'https://scriptures.byu.edu/#:t384$3', 'each cite keeps its own destination');
});

test('load: a modern talk is fetched once per session too', async () => {
  const log = stubReader(PUBLIC);
  const source = { c: 'G', url: NELSON };
  await talkSource.load({ entry: { talkId: 6141, anchor: 'p2' }, source });
  const r = await talkSource.load({ entry: { talkId: 6141, anchor: 'p9' }, source });
  assert.strictEqual(log.requests.length, 1);
  assert.strictEqual(r.destination.href, `${NELSON}&id=p9#p9`);
});

test('load: a failed fetch is not kept, so Try again asks the network again', async () => {
  let fail = true;
  const log = stubReader(PUBLIC, { respond: () => (fail ? { error: true } : { html: '<div>ok</div>' }) });
  const open = () => talkSource.load({ entry: { talkId: 901, citId: 1 }, source: { c: 'E' } });
  assert.strictEqual((await open()).html, null);
  fail = false;
  assert.strictEqual((await open()).html, '<div>ok</div>');
  assert.strictEqual(log.requests.length, 2);
});

test('load: the session cache is bounded and lets the least recently opened talk go', async () => {
  const max = talkSource.FETCH_POLICY.talkCache;
  assert.ok(Number.isInteger(max) && max > 0);
  const log = stubReader(PUBLIC);
  const open = (talkId) => talkSource.load({ entry: { talkId, citId: 1 }, source: { c: 'E' } });
  const ids = Array.from({ length: max }, (_, i) => 20000 + i);
  for (const id of ids) await open(id);       // fills the cache
  await open(ids[0]);                          // touched: now the most recent
  await open(30000);                           // one more: ids[1] goes
  assert.strictEqual(log.requests.length, max + 1);
  await open(ids[0]);
  assert.strictEqual(log.requests.length, max + 1, 'the touched talk stayed');
  await open(ids[1]);
  assert.strictEqual(log.requests.length, max + 2, 'the least recent one was let go');
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('load: at most 2 requests are in flight to BYU, and every talk still arrives', async () => {
  assert.strictEqual(talkSource.FETCH_POLICY.slots['scriptures.byu.edu'], 2);
  const log = stubReader(PUBLIC, { gate: tick });
  const ids = [40001, 40002, 40003, 40004, 40005];
  const all = await Promise.all(ids.map((talkId) => talkSource.load({ entry: { talkId, citId: 1 }, source: { c: 'E' } })));
  assert.strictEqual(log.peak['scriptures.byu.edu'], 2);
  assert.ok(all.every((r) => r.html), 'every talk loaded');
  assert.strictEqual(log.requests.length, 5);
});

test('load: at most 6 requests are in flight to the Church site', async () => {
  assert.strictEqual(talkSource.FETCH_POLICY.slots['www.churchofjesuschrist.org'], 6);
  const log = stubReader(PUBLIC, { gate: tick });
  const ids = Array.from({ length: 9 }, (_, i) => 50000 + i);
  const all = await Promise.all(ids.map((talkId) => talkSource.load({
    entry: { talkId }, source: { c: 'G', url: `${ORIGIN}/study/general-conference/2019/10/t${talkId}?lang=eng` },
  })));
  assert.strictEqual(log.peak['www.churchofjesuschrist.org'], 6);
  assert.ok(all.every((r) => r.html), 'every talk loaded');
});

test('load: a request that fails gives its slot back', async () => {
  const log = stubReader(PUBLIC, { gate: tick, respond: (url) => (/4100[12]$/.test(url) ? { error: true } : { html: '<div/>' }) });
  const open = (talkId) => talkSource.load({ entry: { talkId, citId: 1 }, source: { c: 'E' } });
  await Promise.all([open(41001), open(41002)]);
  const r = await open(41003);
  assert.strictEqual(r.html, '<div/>');
  assert.strictEqual(log.peak['scriptures.byu.edu'], 2);
});

test('refPunctuation: spells the class-encoded punctuation around an inserted reference', () => {
  const p = talkView.refPunctuation;
  assert.deepStrictEqual(p('ccontainer lparen rparendot'), { open: ' (', close: ').' });
  assert.deepStrictEqual(p('ccontainer lparen rparencomma'), { open: ' (', close: '),' });
  assert.deepStrictEqual(p('ccontainer rsemi'), { open: '', close: ';' });
  assert.deepStrictEqual(p('ccontainer lmdash'), { open: '—', close: '' });
  assert.deepStrictEqual(p('ccontainer lbrack rbrackparencomma'), { open: ' [', close: ']),' });
  assert.deepStrictEqual(p('ccontainer lparen rparenquestquotemdash'), { open: ' (', close: ')?”—' });
  assert.deepStrictEqual(p('ccontainer lmdash raposrdquo'), { open: '—', close: '’”' });
});

test('refPunctuation: an unknown token adds nothing rather than a guess', () => {
  assert.deepStrictEqual(talkView.refPunctuation('ccontainer lparen rparenwhatever'), { open: ' (', close: '' });
  assert.deepStrictEqual(talkView.refPunctuation(''), { open: '', close: '' });
});

// Spec #69: the BYU host permission ships in version 1 regardless (the content
// script's fetch works by CORS today; a later relay must not disable installs).
test('manifest: grants the BYU host permission', () => {
  const manifest = require('../manifest.json');
  assert.ok(manifest.host_permissions.includes('https://scriptures.byu.edu/*'));
});
