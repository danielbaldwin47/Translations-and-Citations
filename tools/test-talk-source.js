/*
 * Unit tests for the pure (DOM-free) halves of the talk reader:
 *   src/citations/talk-source.js — the corpus plan table, the pre-2013 General
 *     Conference URL repair, the footnote locator (synthetic talks, then one
 *     real talk per era from tools/fixtures/footnote-locator.json), and the
 *     snippet fallback for finding a cite;
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

test('corpusPlan: modern General Conference is fetched live', () => {
  const plan = talkSource.corpusPlan('G');
  assert.strictEqual(plan.fetch, 'live');
  assert.strictEqual(plan.target, 'anchor');
});

test('corpusPlan: early GC and Journal of Discourses read the bundled talk', () => {
  for (const corpus of ['E', 'J']) {
    const plan = talkSource.corpusPlan(corpus);
    assert.strictEqual(plan.fetch, 'bundled', corpus);
    assert.strictEqual(plan.target, 'citationSpan', corpus);
  }
});

test('corpusPlan: STPJS scrolls to the body passage, not the footnote list', () => {
  const plan = talkSource.corpusPlan('T');
  assert.strictEqual(plan.fetch, 'bundled');
  assert.strictEqual(plan.target, 'bodyPassage');
});

test('corpusPlan: an unknown corpus falls back on whether a live URL exists', () => {
  assert.strictEqual(talkSource.corpusPlan('', { hasUrl: true }).fetch, 'live');
  assert.strictEqual(talkSource.corpusPlan(undefined, { hasUrl: false }).fetch, 'bundled');
  // A corpus that claims "live" but ships no URL still has to read the bundle.
  assert.strictEqual(talkSource.corpusPlan('G', { hasUrl: false }).fetch, 'bundled');
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
