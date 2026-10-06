/*
 * Unit tests for the pure (DOM-free) halves of the talk reader:
 *   src/citations/talk-source.js — the corpus plan over a pack descriptor (both
 *     flavors, and a corpus the descriptor lacks), the pre-2013 General
 *     Conference URL repair, and the snippet fallback for finding a cite;
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
  E: { sourceType: 'General Conference', text: 'bundled', target: 'citationSpan', excerpt: 'bundled', inclusion: 'all' },
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

test('corpusPlan: early GC and Journal of Discourses follow the descriptor', () => {
  for (const pack of [PUBLIC, PERSONAL]) {
    for (const corpus of ['E', 'J']) {
      assert.deepStrictEqual(talkSource.corpusPlan(pack, corpus), { text: 'bundled', target: 'citationSpan' },
        `${pack.flavor} ${corpus}`);
    }
  }
});

test('corpusPlan: a corpus fetched from BYU keeps its text source', () => {
  const pack = { ...PUBLIC, corpora: { ...CORPORA, E: { ...CORPORA.E, text: 'live-byu' } } };
  assert.deepStrictEqual(talkSource.corpusPlan(pack, 'E'), { text: 'live-byu', target: 'citationSpan' });
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
