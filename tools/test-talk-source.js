/*
 * Unit tests for the pure (DOM-free) halves of the talk reader:
 *   src/citations/talk-source.js — the corpus plan over a pack descriptor (both
 *     flavors, and a corpus the descriptor lacks), the BYU URL builder and
 *     viewer hash, the per-corpus reading destination, the pre-2013 General
 *     Conference URL repair, the footnote locator (synthetic talks, then one
 *     real talk per era from tools/fixtures/footnote-locator.json), the
 *     snippet fallback for finding a cite, the fetch scheduler's slot policy
 *     (slotPolicy, pure), and the fetch policy through load() and excerpt()
 *     (one fetch per talk per session, a bounded cache, per-host slots, rows
 *     out of view never fetched) over a stubbed fetch and pack, the excerpt's
 *     text (BYU's paragraph without its insertions, the Church paragraph at
 *     its anchor or the locator's, none for a body passage), and the shared
 *     link parser's two span rules;
 *   src/citations/talk-view.js   — the punctuation of BYU's inserted references,
 *     and the render contract: load() -> render -> findTarget -> markCite over
 *     tools/mini-dom.js, for a Journal of Discourses marker cite, a page-anchor
 *     cite and an early-conference reference (text unchanged, ids kept, the
 *     right block marked).
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
  J: { sourceType: 'Journal of Discourses', text: 'bundled', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all', attribution: 'wikisource' },
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

test('targetIds: a Journal of Discourses cite falls back from its marker to its page anchor', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'J');
  assert.deepStrictEqual(talkSource.targetIds(plan, { citId: '73652' }), ['73652']);
  assert.deepStrictEqual(talkSource.targetIds(plan, { citId: '73653', anchor: 'jdp-12' }), ['73653', 'jdp-12']);
});

test('targetIds: a modern talk\'s paragraph anchor is not a span fallback', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'G');
  assert.deepStrictEqual(talkSource.targetIds(plan, { citId: 7, anchor: 'p21' }), ['7'],
    'its pN anchors are the live page\'s, tried before the span when the talk is live');
});

const PERMALINK = 'https://en.wikisource.org/w/index.php?title=Journal_of_Discourses/Volume_1/Salvation&oldid=16217145';

test('talkCredit: a Wikisource talk says so plainly, linking its permalink with the revision on hover', () => {
  assert.deepStrictEqual(talkSource.talkCredit(CORPORA.J, { c: 'J', url: PERMALINK }),
    { text: 'Text from Wikisource', href: PERMALINK, title: 'Wikisource revision 16217145' });
  assert.deepStrictEqual(talkSource.talkCredit(CORPORA.J, { c: 'J', url: 'https://en.wikisource.org/wiki/Journal_of_Discourses' }),
    { text: 'Text from Wikisource', href: 'https://en.wikisource.org/wiki/Journal_of_Discourses' }, 'no revision, no title');
  assert.strictEqual(talkSource.talkCredit(CORPORA.J, { c: 'J' }), null, 'nothing to link');
});

test('talkCredit: a live-church talk credits the Church site and links the talk', () => {
  assert.deepStrictEqual(talkSource.talkCredit(CORPORA.G, { c: 'G', url: NELSON }),
    { text: 'From churchofjesuschrist.org', href: NELSON });
  assert.strictEqual(talkSource.talkCredit(CORPORA.G, { c: 'G' }), null, 'no talk URL, nothing to link');
  assert.deepStrictEqual(talkSource.talkCredit({ ...CORPORA.G }, { c: 'X', url: NELSON }),
    { text: 'From churchofjesuschrist.org', href: NELSON }, 'decided by the descriptor text, not the letter');
});

test('talkCredit: a BYU-fetched talk keeps the fetch line; a corpus the pack lacks has none', () => {
  assert.deepStrictEqual(talkSource.talkCredit(CORPORA.E, { c: 'E' }), { text: 'Text fetched from scriptures.byu.edu' });
  assert.deepStrictEqual(talkSource.talkCredit(CORPORA.E, { c: 'E', url: NELSON }), { text: 'Text fetched from scriptures.byu.edu' });
  assert.strictEqual(talkSource.talkCredit(null, { c: 'T' }), null, 'a corpus the pack lacks');
});

test('readingDestination: a Journal of Discourses cite at its page anchor still opens the permalink', () => {
  const plan = talkSource.corpusPlan(PUBLIC, 'J');
  assert.deepStrictEqual(
    talkSource.readingDestination(plan, { entry: { talkId: 10001, citId: 7, anchor: 'jdp-3' }, source: { c: 'J', url: PERMALINK } }),
    { href: PERMALINK, label: 'Open on en.wikisource.org' },
  );
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

// #87: BYU stored two 2012 slugs with a trailing "!" the Church's link lacks.
const MAY_2012_INDEX = [
  '/study/ensign/2012/05?lang=eng',
  '/study/ensign/2012/05/general-young-women-meeting/now-is-the-time-to-arise-and-shine?lang=eng',
  '/study/ensign/2012/05/saturday-afternoon-session/abide-in-the-lords-territory?lang=eng',
  '/study/ensign/2012/05/saturday-morning-session/arise-and-shine-forth?lang=eng',
];

test('pickSessionUrl: a trailing "!" in our slug still finds the Church link (#87)', () => {
  const landed = `${ORIGIN}/study/ensign/2012/05?lang=eng`;
  assert.strictEqual(
    talkSource.pickSessionUrl({
      originalUrl: `${ORIGIN}/study/ensign/2012/05/now-is-the-time-to-arise-and-shine!?lang=eng`,
      landedUrl: landed,
      hrefs: MAY_2012_INDEX,
    }),
    `${ORIGIN}/study/ensign/2012/05/general-young-women-meeting/now-is-the-time-to-arise-and-shine?lang=eng`,
  );
  assert.strictEqual(
    talkSource.pickSessionUrl({
      originalUrl: `${ORIGIN}/study/ensign/2012/05/abide-in-the-lords-territory!?lang=eng`,
      landedUrl: landed,
      hrefs: MAY_2012_INDEX,
    }),
    `${ORIGIN}/study/ensign/2012/05/saturday-afternoon-session/abide-in-the-lords-territory?lang=eng`,
  );
});

test('pickSessionUrl: a "!" slug with no matching link still yields null (#87)', () => {
  assert.strictEqual(
    talkSource.pickSessionUrl({
      originalUrl: `${ORIGIN}/study/ensign/2012/05/now-is-the-time!?lang=eng`,
      landedUrl: `${ORIGIN}/study/ensign/2012/05?lang=eng`,
      hrefs: MAY_2012_INDEX,
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
  assert.deepStrictEqual(r.credit, { text: 'Text fetched from scriptures.byu.edu' });
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

test('load: a Journal of Discourses talk credits its Wikisource revision and opens the permalink', async () => {
  const log = stubReader(PUBLIC);
  const r = await talkSource.load({ entry: { talkId: 10001, citId: 7 }, source: { c: 'J', url: PERMALINK } });
  assert.strictEqual(r.html, '<p>bundled</p>');
  assert.deepStrictEqual(r.credit, { text: 'Text from Wikisource', href: PERMALINK, title: 'Wikisource revision 16217145' });
  assert.deepStrictEqual(r.destination, { href: PERMALINK, label: 'Open on en.wikisource.org' });
  assert.strictEqual(log.requests.length, 0, 'read from the bundle, offline');
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
  assert.deepStrictEqual(r.credit, { text: 'From churchofjesuschrist.org', href: NELSON }, 'the credit opens the talk, not a paragraph');
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

// The fetch scheduler's slot policy (spec #69 "Reader", excerpts): given the
// free slots on one host and the requests waiting for them, which start now.
// Each waiting request carries the rows that want it, each row on screen
// ('visible'), in the look-ahead band ('ahead') or scrolled away ('gone'),
// with `top` its distance in pixels from the top of the visible area.
const slotPolicy = talkSource.slotPolicy;
const waiting = (id, rows, urgent) => ({ id, urgent: !!urgent, rows });

test('slotPolicy: on-screen rows go before look-ahead rows, nearest the top first', () => {
  const picks = slotPolicy({ free: 6, waiting: [
    waiting('below-band', [{ zone: 'ahead', top: 900 }]),
    waiting('screen-low', [{ zone: 'visible', top: 500 }]),
    waiting('above-band', [{ zone: 'ahead', top: -120 }]),
    waiting('screen-high', [{ zone: 'visible', top: 40 }]),
  ] });
  assert.deepStrictEqual(picks, ['screen-high', 'screen-low', 'above-band', 'below-band']);
});

test('slotPolicy: only as many start as there are free slots', () => {
  const rows = (top) => [{ zone: 'visible', top }];
  const all = [waiting('a', rows(10)), waiting('b', rows(20)), waiting('c', rows(30))];
  assert.deepStrictEqual(slotPolicy({ free: 2, waiting: all }), ['a', 'b']);
  assert.deepStrictEqual(slotPolicy({ free: 0, waiting: all }), []);
  assert.deepStrictEqual(slotPolicy({ free: -1, waiting: all }), []);
});

test('slotPolicy: a row scrolled past before its turn is not fetched unless it returns', () => {
  const passed = waiting('passed', [{ zone: 'gone', top: -3000 }]);
  const onScreen = waiting('here', [{ zone: 'visible', top: 0 }]);
  assert.deepStrictEqual(slotPolicy({ free: 6, waiting: [passed, onScreen] }), ['here']);
  assert.deepStrictEqual(slotPolicy({ free: 6, waiting: [passed] }), [], 'a free slot does not go to it either');
  const returned = waiting('passed', [{ zone: 'ahead', top: -200 }]);
  assert.deepStrictEqual(slotPolicy({ free: 6, waiting: [returned] }), ['passed']);
});

test('slotPolicy: a talk listed at several rows ranks by its best row', () => {
  const picks = slotPolicy({ free: 1, waiting: [
    waiting('ahead-only', [{ zone: 'ahead', top: 610 }]),
    waiting('twice', [{ zone: 'gone', top: -4000 }, { zone: 'visible', top: 300 }]),
  ] });
  assert.deepStrictEqual(picks, ['twice']);
});

test('slotPolicy: a talk the reader opens goes first, rows or none', () => {
  const picks = slotPolicy({ free: 2, waiting: [
    waiting('row', [{ zone: 'visible', top: 0 }]),
    waiting('opened', [], true),
    waiting('opened-after-scrolling-past', [{ zone: 'gone', top: -900 }], true),
  ] });
  assert.deepStrictEqual(picks, ['opened', 'opened-after-scrolling-past']);
});

test('slotPolicy: equals keep their arrival order', () => {
  const same = [{ zone: 'visible', top: 100 }];
  assert.deepStrictEqual(slotPolicy({ free: 3, waiting: [waiting('x', same), waiting('y', same), waiting('z', same)] }),
    ['x', 'y', 'z']);
});

// excerpt() through the same stubs: a row's claim says where it is when a
// slot frees. These watch the requests; the excerpt text tests follow
// (excerpt reads the HTML string, so its text is checked here too).
const FETCHED_PACK = { ...PUBLIC, corpora: {
  ...CORPORA, G: { ...CORPORA.G, excerpt: 'fetched' }, E: { ...CORPORA.E, excerpt: 'fetched' },
} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const rowAt = (zone, top = 0) => ({ zone, top, where() { return { zone: this.zone, top: this.top }; } });

test('excerpt: a row scrolled away before its turn is never fetched, until it returns', async () => {
  const log = stubReader(FETCHED_PACK);
  const row = rowAt('gone', -2000);
  const pending = talkSource.excerpt({ entry: { talkId: 60001, citId: 9 }, source: { c: 'E' } }, row);
  await settle();
  assert.strictEqual(log.requests.length, 0, 'no request for a row out of view');
  row.zone = 'ahead';
  talkSource.reschedule();
  await pending;
  assert.deepStrictEqual(log.requests.map((q) => q.url), ['https://scriptures.byu.edu/content/talks_ajax/60001']);
});

test('excerpt: opening the talk fetches a waiting excerpt\'s talk once, for both', async () => {
  const log = stubReader(FETCHED_PACK);
  const entry = { talkId: 60002, citId: 9 };
  const pending = talkSource.excerpt({ entry, source: { c: 'E' } }, rowAt('gone', -2000));
  await settle();
  assert.strictEqual(log.requests.length, 0);
  const r = await talkSource.load({ entry, source: { c: 'E' } });
  await pending;
  assert.ok(r.html);
  assert.strictEqual(log.requests.length, 1, 'the reader and the row share one request');
});

test('excerpt: once the slots are busy, rows on screen go before the look-ahead band, nearest the top first', async () => {
  const log = stubReader(FETCHED_PACK, { gate: tick });
  const open = (talkId) => talkSource.load({ entry: { talkId, citId: 1 }, source: { c: 'E' } });
  const ask = (talkId, row) => talkSource.excerpt({ entry: { talkId, citId: 1 }, source: { c: 'E' } }, row);
  const busy = [open(60010), open(60011)]; // the reader holds both BYU slots
  const rows = [
    ask(60021, rowAt('ahead', 700)), ask(60022, rowAt('ahead', -650)),
    ask(60023, rowAt('visible', 300)), ask(60024, rowAt('visible', 20)),
  ];
  await Promise.all(busy.concat(rows));
  const order = log.requests.map((q) => Number(q.url.split('/').pop()));
  assert.deepStrictEqual(order, [60010, 60011, 60024, 60023, 60022, 60021]);
  assert.strictEqual(log.peak['scriptures.byu.edu'], 2);
});

// The excerpt's text, read from the fetched HTML string (no DOM): the
// paragraph the reader's target order lands on, as the row shows it.
const byuSpan = (id, ref) => `<span class="citation" id="${id}"><a href="javascript:void(0)" onclick="sx(this, ${id})">  </a>` +
  `<a href="javascript:void(0)" onclick="gs(${id})">${ref}</a></span>`;
const byuFragment = (body) => '<div id="centernavbar"><div id="talklabel">1957–A:133, Marion G. Romney</div></div>' +
  `<div id="talkcontent"><div class="gcera"><div class="gcbody">${body}</div></div></div>`;

test('excerpt: an early-conference row shows BYU\'s paragraph without the references BYU inserted', async () => {
  stubReader(FETCHED_PACK, { respond: () => ({ html: byuFragment(
    '<p>\nOpening.\n</p><p>\nFor you shall live by every word that proceedeth forth\nfrom the mouth of God &amp; man ' +
    `<span class="ccontainer lparen rparendot">${byuSpan(11779, 'D&amp;C 84:44')}</span>\n</p><p>More.</p>`) }) });
  const text = await talkSource.excerpt({ entry: { talkId: 60101, citId: 11779 }, source: { c: 'E' } }, rowAt('visible'));
  assert.strictEqual(text, 'For you shall live by every word that proceedeth forth from the mouth of God & man');
});

test('excerpt: a paragraph that is only a reference shows the reference', async () => {
  stubReader(FETCHED_PACK, { respond: () => ({ html: byuFragment(
    `<p class="gcsub"><span class="ccontainer lparen rparen">${byuSpan(77, 'John 3:5')}</span></p>`) }) });
  const text = await talkSource.excerpt({ entry: { talkId: 60102, citId: 77 }, source: { c: 'E' } }, rowAt('visible'));
  assert.strictEqual(text, 'John 3:5');
});

test('excerpt: a modern row shows the Church page\'s paragraph at the cite\'s anchor, else the locator\'s', async () => {
  const page = talk(
    [para('p1', 'Opening.'), para('p2', `Born of water.${marker(1)}`), para('p3', 'Close &amp; amen.')],
    [note(1, ref('nt/john/3?lang=eng&amp;id=p5#p5', 'John 3:5'))],
  );
  stubReader(FETCHED_PACK, { respond: () => ({ html: page }) });
  const source = { c: 'G', url: `${ORIGIN}/study/general-conference/2024/04/excerpt-a?lang=eng` };
  const anchored = await talkSource.excerpt({ entry: { talkId: 60103, citId: 1, anchor: 'p3' }, source }, rowAt('visible'));
  assert.strictEqual(anchored, 'Close & amen.');
  const located = await talkSource.excerpt({
    entry: { talkId: 60103, citId: 2, book: 'john', chapter: 3, verses: '5', refRank: 1 }, source,
  }, rowAt('visible'));
  assert.strictEqual(located, 'Born of water.', 'the marker\'s number is drawn from data-value, not text');
});

test('excerpt: a body-passage target needs the rendered talk, so it has no excerpt and fetches nothing', async () => {
  const pack = { ...PUBLIC, corpora: { T: { sourceType: 'TPJS', text: 'live-byu', target: 'bodyPassage', excerpt: 'fetched', inclusion: 'all' } } };
  const log = stubReader(pack);
  const text = await talkSource.excerpt({ entry: { talkId: 60104, citId: 3 }, source: { c: 'T' } }, rowAt('visible'));
  assert.strictEqual(text, null);
  assert.strictEqual(log.requests.length, 0);
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

// --- footnote locator ---------------------------------------------------------
// Synthetic talks in the live site's markup: body paragraphs carry data-aid and
// a pN id, footnote markers are a.note-ref[data-scroll-id], footnotes are
// li[id^="note"], scripture links are a.scripture-ref.
const SCRIPTURE = '/study/scriptures';
const ref = (path, label) => `<a class="scripture-ref" href="${SCRIPTURE}/${path}">${label}</a>`;
const marker = (n) => `<a class="note-ref" href="/study/x?lang=eng#note${n}" data-scroll-id="note${n}"><sup class="marker" data-value="${n}"></sup></a>`;
const para = (id, inner) => `<p data-aid="${id.replace(/\D/g, '') || 0}" id="${id}">${inner}</p>`;
const note = (n, inner) => `<li data-marker="${n}." id="note${n}"><p data-aid="9${n}" id="note${n}_p1">${inner}</p></li>`;
const talk = (body, notes) =>
  `<html><body><article><div class="body-block">${body.join('')}</div>` +
  `<footer><ol>${(notes || []).join('')}</ol></footer></article></body></html>`;
const locate = (html, cite) => talkSource.locateParagraph(html, Object.assign({ rank: 1 }, cite));

test('locateParagraph: a footnote link places the cite at the paragraph holding its marker', () => {
  const html = talk(
    [para('p1', 'Opening.'), para('p2', `The Word.${marker(1)}`), para('p3', 'Close.')],
    [note(1, ref('nt/john/1?lang=eng&amp;id=p1,3,14#p1', 'John 1:1, 3, 14'))],
  );
  assert.strictEqual(locate(html, { book: 'john', chapter: 1, verses: '1,3,14' }), 'p2');
});

test('locateParagraph: a link written in a body paragraph places the cite there', () => {
  // Recent talks cite in the text, "(Alma 5:14)", with no footnote.
  const html = talk([para('p1', 'Opening.'), para('p2', `Have ye (${ref('bofm/alma/5?lang=eng&amp;id=p14#p14', 'Alma 5:14')}).`)]);
  assert.strictEqual(locate(html, { book: 'alma', chapter: 5, verses: '14' }), 'p2');
});

test('locateParagraph: the verse set must equal the cite’s, not overlap it', () => {
  const html = talk([
    para('p1', ref('nt/john/1?lang=eng&amp;id=p1,14#p1', 'John 1:1, 14')),
    para('p2', ref('nt/john/1?lang=eng&amp;id=p1-p3#p1', 'John 1:1–3')),
  ]);
  assert.strictEqual(locate(html, { book: 'john', chapter: 1, verses: '1' }), null);
  assert.strictEqual(locate(html, { book: 'john', chapter: 1, verses: '1-3' }), 'p2');
  assert.strictEqual(locate(html, { book: 'john', chapter: 1, verses: '14,1' }), 'p1');
});

test('locateParagraph: another book or chapter never matches', () => {
  const html = talk([
    para('p1', ref('bofm/alma/6?lang=eng&amp;id=p14#p14', 'Alma 6:14')),
    para('p2', ref('bofm/mosiah/5?lang=eng&amp;id=p14#p14', 'Mosiah 5:14')),
  ]);
  assert.strictEqual(locate(html, { book: 'alma', chapter: 5, verses: '14' }), null);
});

test('locateParagraph: the k-th match by the cite’s rank among same-reference cites', () => {
  const html = talk(
    [para('p1', `First.${marker(1)}`), para('p2', ref('bofm/1-ne/8?lang=eng&amp;id=p33#p33', '1 Nephi 8:33')), para('p3', `Third.${marker(2)}`)],
    [note(1, ref('bofm/1-ne/8?lang=eng&amp;id=p33#p33', '1 Nephi 8:33')), note(2, ref('bofm/1-ne/8?lang=eng&amp;id=p33#p33', '1 Nephi 8:33'))],
  );
  const cite = { book: '1-ne', chapter: 8, verses: '33' };
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 1 })), 'p1');
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 2 })), 'p2');
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 3 })), 'p3');
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 4 })), 'p3', 'fewer matches than the rank: the last');
});

test('locateParagraph: reading order puts a footnote link at its marker, not at the note list', () => {
  // Note 1's marker comes after the inline link, so the inline link is the first match.
  const html = talk(
    [para('p1', ref('nt/matt/11?lang=eng&amp;id=p28-p30#p28', 'Matthew 11:28–30')), para('p2', `Later.${marker(1)}`)],
    [note(1, ref('nt/matt/11?lang=eng&amp;id=p28-p30#p28', 'Matthew 11:28–30'))],
  );
  const cite = { book: 'matt', chapter: 11, verses: '28-30' };
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 1 })), 'p1');
  assert.strictEqual(locate(html, Object.assign({}, cite, { rank: 2 })), 'p2');
});

test('locateParagraph: a footnote sits at the paragraph holding its first marker', () => {
  const html = talk(
    [para('p1', 'No marker.'), para('p2', `First.${marker(4)}`), para('p3', `Again.${marker(4)}`)],
    [note(4, ref('ot/ps/23?lang=eng&amp;id=p1#p1', 'Psalm 23:1'))],
  );
  assert.strictEqual(locate(html, { book: 'ps', chapter: 23, verses: '1' }), 'p2');
});

test('locateParagraph: a whole-chapter cite matches a chapter link or a chapter-span link', () => {
  const span = talk([para('p1', 'Intro.'), para('p2', `As taught in ${ref('bofm/2-ne/31?lang=eng', '2 Nephi 31–32')}.`)]);
  assert.strictEqual(locate(span, { book: '2-ne', chapter: 32, verses: '1-9' }), 'p2', 'the span covers chapter 32');
  assert.strictEqual(locate(span, { book: '2-ne', chapter: 31, verses: '1-21' }), 'p2', 'and the linked chapter');
  assert.strictEqual(locate(span, { book: '2-ne', chapter: 33, verses: '1-15' }), null, 'not a chapter past the span');
  assert.strictEqual(locate(span, { book: '2-ne', chapter: 31, verses: '20' }), null, 'a verse cite needs its verses');

  const chapterOnly = talk([para('p1', `See ${ref('pgp/moses/1?lang=eng', 'Moses 1')}.`)]);
  assert.strictEqual(locate(chapterOnly, { book: 'moses', chapter: 1, verses: '1-42' }), 'p1');
  // "Alma 5:3–4" with no id is not a span of chapters 3 to 4.
  const versey = talk([para('p1', ref('bofm/alma/5?lang=eng', 'Alma 5:3–4'))]);
  assert.strictEqual(locate(versey, { book: 'alma', chapter: 4, verses: '1-20' }), null);
});

// The shared link parser and the two span rules (the locator's and the
// derivation run's), side by side.
test('linkChapters: the locator takes any span holding the chapter; the derivation only one starting there', () => {
  const at = (path, label) => talkSource.scriptureLink(`${SCRIPTURE}/${path}`, label);
  const from31 = at('bofm/2-ne/31?lang=eng', '2 Nephi 31–32');
  assert.deepStrictEqual(talkSource.linkChapters(from31, 'locate'), [31, 32]);
  assert.deepStrictEqual(talkSource.linkChapters(from31, 'derive'), [31, 32]);
  const from32 = at('bofm/2-ne/32?lang=eng', '2 Nephi 31–32');
  assert.deepStrictEqual(talkSource.linkChapters(from32, 'locate'), [31, 32], 'recall: the span still holds 32');
  assert.deepStrictEqual(talkSource.linkChapters(from32, 'derive'), [32, 32], 'precision: no cite for 31 from a link to 32');
  const versed = at('bofm/alma/5?lang=eng&id=p3-p4#p3', 'Alma 5:3–4');
  assert.deepStrictEqual([versed.verses, versed.span], [[3, 4], null], 'a verse id is not a chapter span');
  assert.strictEqual(at('jst/jst-john/1?lang=eng&id=p1#p1', 'JST, John 1:1'), null, 'the JST is no one\'s link');
});

test('decodeEntities: numeric references in full, known names, an unknown name as written', () => {
  assert.strictEqual(talkSource.decodeEntities('D&amp;C &#8217;&#x2014; &rsquo;&eacute; &c;'), 'D&C ’— ’é &c;');
});

test('locateParagraph: Joseph Smith Translation links never match', () => {
  const html = talk(
    [para('p1', `The Word.${marker(20)}`)],
    [note(20, ref('jst/jst-john/1?lang=eng&amp;id=p1#p1', 'Joseph Smith Translation, John 1:1'))],
  );
  assert.strictEqual(locate(html, { book: 'john', chapter: 1, verses: '1' }), null);
  assert.strictEqual(locate(html, { book: 'jst-john', chapter: 1, verses: '1' }), null);
});

test('locateParagraph: escaped copies in the page’s scripts and links outside paragraphs are ignored', () => {
  const html = '<html><head><script>window.__STATE__={"body":"<p data-aid=\\"1\\" id=\\"p9\\"><a class=\\"scripture-ref\\" href=\\"/study/scriptures/nt/john/3?id=p16\\">John 3:16</a></p>"}</script></head>' +
    `<body><nav>${ref('nt/john/3?lang=eng&amp;id=p16#p16', 'John 3:16')}</nav>${para('p1', 'Plain.')}${para('p2', ref('nt/john/3?lang=eng&amp;id=p16#p16', 'John 3:16'))}</body></html>`;
  assert.strictEqual(locate(html, { book: 'john', chapter: 3, verses: '16' }), 'p2');
});

// One real talk per era (tools/fixtures/footnote-locator.json: the fetched
// article with its words removed, each cite's ground-truth paragraphs from its
// BYU snippet). Each must place at least the share of its cites that the
// issue 66 research sample placed for that era.
const RESEARCH_HIT_RATE = { '1971-2012': 0.908, '2013-19': 1, '2020+': 0.973 };
for (const fixture of require('./fixtures/footnote-locator.json').talks) {
  test(`locateParagraph: a ${fixture.era} talk (${fixture.talkId}) holds the research hit rate`, () => {
    const off = fixture.cites
      .map((c) => ({ c, got: talkSource.locateParagraph(fixture.html, c) }))
      .filter(({ c, got }) => !c.paragraphs.includes(got));
    const rate = 1 - off.length / fixture.cites.length;
    assert.ok(rate >= RESEARCH_HIT_RATE[fixture.era],
      `${(rate * 100).toFixed(1)}% placed; off: ${off.map(({ c, got }) => `${c.citId} ${c.book} ${c.chapter}:${c.verses} -> ${got}`).join('; ')}`);
  });
}

test('locateParagraph: no match, no cite or no HTML yields null', () => {
  const html = talk([para('p1', 'Nothing linked.')]);
  assert.strictEqual(locate(html, { book: 'john', chapter: 3, verses: '16' }), null);
  assert.strictEqual(locate('', { book: 'john', chapter: 3, verses: '16' }), null);
  assert.strictEqual(talkSource.locateParagraph(html, null), null);
  assert.strictEqual(locate(html, { book: 'john', chapter: 3, verses: '' }), null);
});

// ---- Render contract (talk-view render + talk-source findTarget + markCite) --
// The reader's chain in Node, over tools/mini-dom.js: load() reads the talk,
// talk-view renders it, findTarget finds the cite, markCite marks it. The
// contract (CLAUDE.md, "Reader scroll targets by corpus"): ids survive, and
// the article's textContent stays exactly the source text, marks included.
require('./mini-dom.js').install();

// A Journal of Discourses talk as tools/build-jod-talks.js writes it (trimmed
// from talk 100001): an empty citation marker after the cited words, and
// empty printed-page anchors (jdp-N), one opening a paragraph, one inside one.
const JOD_TALK = `<!doctype html>
<html><head><meta charset="utf-8"><title>JD 10:1, ETERNAL EXISTENCE OF MAN</title></head><body><article class="jodTalk">
<p class="jodSubtitle">Remarks by President BRIGHAM YOUNG, made in the Bowery, Great Salt Lake City, September 28, 1862.</p>
<p id="jp-1"><span class="jodPage" id="jdp-1"></span>We have had a very interesting journey to the southern settlements.</p>
<p id="jp-3">All the works of mankind amount to but little, unless they are performed in the name of the Lord.<span class="citation" id="81620"></span> Let every man seek to learn the things of God &quot;by revelation.&quot;</p>
<p id="jp-4">No man can comprehend that there never was a beginning. Who can comprehend <span class="jodPage" id="jdp-2"></span>the duration of time?</p>
</article></body></html>`;
const JOD_TEXT = '\n' +
  'Remarks by President BRIGHAM YOUNG, made in the Bowery, Great Salt Lake City, September 28, 1862.\n' +
  'We have had a very interesting journey to the southern settlements.\n' +
  'All the works of mankind amount to but little, unless they are performed in the name of the Lord. Let every man seek to learn the things of God "by revelation."\n' +
  'No man can comprehend that there never was a beginning. Who can comprehend the duration of time?\n';

// Open one cite the way the reader does -> { article, marked: markCite's { tinted, reveal } }.
async function openCite(entry, source, html) {
  globalThis.__BTX.citData = {
    loadPack: async () => ({ dir: 'src/citations/data/', descriptor: PUBLIC }),
    loadTalkHtml: async () => html,
  };
  const loaded = await talkSource.load({ entry, source });
  const article = talkView.render(loaded.html);
  const target = loaded.findTarget(article);
  const marked = target && talkView.markCite(target);
  return { article, marked };
}
const marksOf = (article, cls) => article.querySelectorAll(`.${cls}`).map((e) => e.id || e.tagName);

test('render contract: a Journal of Discourses marker cite tints its paragraph, text unchanged', async () => {
  const { article, marked } = await openCite({ talkId: 'jod-render-1', citId: '81620' }, { c: 'J' }, JOD_TALK);
  assert.strictEqual(article.textContent, JOD_TEXT);
  assert.strictEqual(marked.tinted.id, 'jp-3', 'the marker has no text: its paragraph is tinted');
  assert.strictEqual(marked.reveal.id, '81620', 'the reader scrolls to the cited words, not the paragraph top');
  assert.deepStrictEqual(marksOf(article, 'btx-cit-highlight'), ['jp-3']);
  assert.deepStrictEqual(marksOf(article, 'btx-cit-target'), ['81620'], 'the place-keeper finds the marker');
  assert.deepStrictEqual(marksOf(article, 'btx-cit-passage'), ['jp-3']);
  assert.ok(article.querySelector('[id="81620"]'), 'the marker keeps its id');
});

test('render contract: a page-anchor cite tints the paragraph holding its anchor, as a marker cite does', async () => {
  // Not placed by the Wikisource build: no marker in the talk, only its page.
  const { article, marked } = await openCite(
    { talkId: 'jod-render-2', citId: '99999', anchor: 'jdp-2' }, { c: 'J' }, JOD_TALK);
  assert.strictEqual(article.textContent, JOD_TEXT);
  assert.strictEqual(marked.tinted.id, 'jp-4');
  assert.strictEqual(marked.reveal.id, 'jdp-2', 'the printed page starts mid-paragraph: the reader scrolls there');
  assert.deepStrictEqual(marksOf(article, 'btx-cit-highlight'), ['jp-4']);
  assert.deepStrictEqual(marksOf(article, 'btx-cit-target'), ['jdp-2']);
  assert.deepStrictEqual(marksOf(article, 'btx-cit-passage'), ['jp-4']);
  assert.ok(article.querySelector('[id="jdp-2"]'), 'the anchor keeps its id');
});

test('render contract: an early-conference cite still tints its reference, with the bar on its paragraph', async () => {
  stubReader(PUBLIC, { respond: () => ({ html: byuFragment(
    '<p>\nOpening.\n</p><p id="para2">\nFor you shall live by every word &amp; man ' +
    `<span class="ccontainer lparen rparendot">${byuSpan(11779, 'D&amp;C 84:44')}</span>\n</p>`) }) });
  const loaded = await talkSource.load({ entry: { talkId: 60201, citId: 11779 }, source: { c: 'E' } });
  const article = talkView.render(loaded.html);
  const marked = talkView.markCite(loaded.findTarget(article));
  assert.strictEqual(article.textContent,
    '1957–A:133, Marion G. Romney\nOpening.\n\nFor you shall live by every word & man   D&C 84:44\n',
    'the spacer moves out of the reference, the characters keep their order');
  assert.strictEqual(marked.tinted.id, '11779');
  assert.strictEqual(marked.reveal.id, '11779');
  assert.deepStrictEqual(marksOf(article, 'btx-cit-highlight'), ['11779']);
  assert.deepStrictEqual(marksOf(article, 'btx-cit-target'), ['11779']);
  assert.deepStrictEqual(marksOf(article, 'btx-cit-passage'), ['para2']);
});
