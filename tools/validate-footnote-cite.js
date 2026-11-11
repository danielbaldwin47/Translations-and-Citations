#!/usr/bin/env node
/*
 * Check tools/footnote-cite.js, the footnote-cite rule (GLOSSARY.md "Footnote
 * cite"; spec #102), on fixtures: which note cites earn the flag `fn`, and
 * the stemmer its overlap reads. Needs no DB and no downloaded input; the
 * verse texts below are public-domain scripture (Book of Mormon 1830 wording,
 * KJV).
 * Run: node tools/validate-footnote-cite.js   Exits non-zero on failure.
 */
'use strict';

const F = require('./footnote-cite.js');

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const eq = (a, b, msg) => check(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

console.log('Stemmer:');
{
  const same = [
    ['weaknesses', 'weakness'], ['families', 'family'], ['commandments', 'commandment'],
    ['giveth', 'gives'], ['gives', 'give'], ['blessings', 'blessed'], ['blessing', 'blessed'],
    ['loveth', 'loving'], ['churches', 'church'],
  ];
  for (const [a, b] of same) eq(F.stem(a), F.stem(b), `"${a}" and "${b}" share a stem`);
  check(F.stem('seed') !== F.stem('se'), 'a short word keeps its ending ("seed" is not "se")');
  eq(F.stem('nephi'), 'nephi', 'a name stays whole');
  eq(F.stem('jesus'), 'jesus', 'a word ending in -us keeps its s');
  eq(F.stem('weakness'), 'weakness', 'a word ending in -ss keeps it');
}

// The scripture the rule reads: four verses among 4,000 filler verses, so a
// word of the four has the idf a rare word has in the real inputs (about 7.6)
// and the filler's words ("Lord", "people", "give", "land") are common, as in the real inputs.
const VERSES = [
  { slug: '1-ne', ch: 3, v: 7, text: 'And it came to pass that I, Nephi, said unto my father: I will go and do the things which the Lord hath commanded, for I know that the Lord giveth no commandments unto the children of men, save he shall prepare a way for them that they may accomplish the thing which he commandeth them.' },
  { slug: 'ether', ch: 12, v: 27, text: 'And if men come unto me I will show unto them their weakness. I give unto men weakness that they may be humble; and my grace is sufficient for all men that humble themselves before me; for if they humble themselves before me, and have faith in me, then will I make weak things become strong unto them.' },
  { slug: 'matt', ch: 11, v: 28, text: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.' },
  { slug: 'ps', ch: 99, v: 9, text: 'Exalt the LORD our God, and worship at his holy hill; for the LORD our God is holy.' },
  { slug: 'matt', ch: 5, v: 8, text: 'Blessed are the pure in heart: for they shall see God.' },
  { slug: 'john', ch: 13, v: 34, text: 'A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.' },
];
const filler = Array.from({ length: 4000 }, (_, i) => ({ slug: 'gen', ch: 1 + Math.floor(i / 50), v: 1 + (i % 50), text: 'and the Lord did give unto the people of the land' }));
const CTX = F.footnoteContext([...VERSES, ...filler]);

const own = (label) => ({ own: true, label });
const other = (label) => ({ own: false, label });
const NEPHI = { slug: '1-ne', ch: 3, verses: [7] };
const ETHER = { slug: 'ether', ch: 12, verses: [27] };
const MATT = { slug: 'matt', ch: 11, verses: [28] };

// One row per case: the facts the build or the derivation hands the rule,
// and whether the cite is a footnote cite.
const CASES = [
  {
    name: 'bare reference: a note holding the reference alone names a quotation\'s source',
    facts: { ...MATT, note: [own('Matthew 11:28'), '.'], before: 'The Savior invites each of us to come to Him and find peace in our trials.', after: '' },
    fn: false, shape: 'bare',
  },
  {
    name: 'see-also aside: a parallel passage the paragraph does not echo',
    facts: { ...MATT, note: ['See also ', own('Matthew 11:28'), '.'], before: 'My mother taught me to sing hymns as we worked in the garden each summer.', after: '' },
    fn: true, shape: 'also',
  },
  {
    name: 'prose note (Cook 139829\'s shape): heroes listed in a note, the paragraph about something else',
    facts: { ...NEPHI, note: ['Some of my heroes in the scriptures include Caleb (see ', other('Numbers 14:24'), '), Job (see ', other('Job 1:21'), '), and Nephi (see ', own('1 Nephi 3:7'), ').'],
      before: 'I have learned that faithful people are not spared hard days; they choose to keep walking.', after: ' Their example strengthens me.' },
    fn: true, shape: 'prose',
  },
  {
    name: 'Webb 144963\'s shape: "See 1 Nephi 3:7", the paragraph sharing only a name and a common word',
    facts: { ...NEPHI, note: ['See ', own('1 Nephi 3:7'), '.'], before: 'Like Nephi, we can trust that the Lord will give us strength to obey His commandments.', after: '' },
    fn: true, shape: 'see',
  },
  {
    name: 'quoted verse: the paragraph quotes eight or more of the verse\'s words before the marker',
    facts: { ...ETHER, note: ['See ', own('Ether 12:27'), '.'], before: 'The Lord promised, “I give unto men weakness that they may be humble.”', after: '' },
    fn: false, shape: 'see', quoted: true,
  },
  {
    name: 'short quotation: three words or more of the verse closing at a quotation mark before the marker',
    facts: { ...ETHER, note: ['See ', own('Ether 12:27'), '.'], before: 'He has said that His “grace is sufficient.”', after: '' },
    fn: false, shape: 'see', quoted: true,
  },
  {
    name: 'the same words without a closing quotation mark are not a quotation',
    facts: { ...ETHER, note: ['See ', own('Ether 12:27'), '.'], before: 'He has said that His grace is sufficient for us', after: '' },
    fn: true, shape: 'see', quoted: false,
  },
  {
    name: 'high-overlap paraphrase: the paragraph shares the verse\'s distinctive words',
    facts: { ...ETHER, note: ['See ', own('Ether 12:27'), '.'], before: 'When we feel our weaknesses, His grace can make weak things strong as we humble ourselves.', after: '' },
    fn: false, shape: 'see', quoted: false,
  },
  {
    name: 'a verse the inputs lack (D&C 138): no overlap, so a "See" note is a footnote cite',
    facts: { slug: 'dc', ch: 138, verses: [11], note: ['See ', own('Doctrine and Covenants 138:11'), '.'], before: 'The vision of the redemption of the dead came as he pondered.', after: '' },
    fn: true, shape: 'see',
  },
  {
    name: 'a note with words beyond its references and keywords is prose',
    facts: { ...MATT, note: ['This is a hymn of rest. ', own('Matthew 11:28'), '.'], before: 'We sang together on Sunday.', after: '' },
    fn: true, shape: 'prose',
  },
];

console.log('Footnote-cite rule (fixtures):');
for (const c of CASES) {
  const got = F.footnoteCite(c.facts, CTX);
  eq(got.fn, c.fn, `${c.name}: fn`);
  eq(got.shape, c.shape, `${c.name}: note shape`);
  if ('quoted' in c) eq(got.quoted, c.quoted, `${c.name}: quoted`);
}

console.log('Overlap threshold:');
{
  // Two rare shared stems (grace, sufficient) sit under MAX_OVERLAP; three are over it.
  const two = F.footnoteCite({ ...ETHER, note: ['See ', own('Ether 12:27')], before: 'Grace is sufficient.', after: '' }, CTX);
  const three = F.footnoteCite({ ...ETHER, note: ['See ', own('Ether 12:27')], before: 'Grace is sufficient.', after: ' Be humble.' }, CTX);
  check(two.ov < F.MAX_OVERLAP && two.fn, `two rare shared words stay under ${F.MAX_OVERLAP} (ov ${two.ov})`);
  check(three.ov >= F.MAX_OVERLAP && !three.fn, `a third, in the text after the marker, reaches it (ov ${three.ov})`);
  eq(F.MAX_OVERLAP, 16, 'the overlap cut-off is 16 (measured: footnote-label-design, spec #102)');
}

console.log('Words the overlap does not count:');
{
  // Common words that name no topic, which the threshold's calibration never counted.
  const ov = (slug, ch, v) => F.footnoteCite({ slug, ch, verses: [v], note: ['See ', own('x')], before: 'Only the holy can see what we need and use.', after: '' }, CTX).ov;
  eq(ov('ps', 99, 9), 0, '"holy" is not overlap');
  eq(ov('matt', 5, 8), 0, '"see" is not overlap');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
