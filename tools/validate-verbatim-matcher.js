#!/usr/bin/env node
/*
 * Check tools/verbatim-matcher.js, the quotation matcher behind inclusion
 * rule `verbatim` (spec #69, "Build"; issue #72), on fixtures: which of a
 * talk's cites it re-derives, and how it reads the public-domain scripture
 * inputs. Needs no DB and no downloaded input.
 * Run: node tools/validate-verbatim-matcher.js   Exits non-zero on failure.
 */
'use strict';

const M = require('./verbatim-matcher.js');

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// BYU's citation span as the talk HTML carries it.
const span = (id, ref) => `<span class="ccontainer lparen rparendot"><span class="citation" id="${id}">` +
  `<a href="javascript:void(0)" onclick="sx(this, ${id})"> </a><a href="javascript:void(0)" onclick="gs(${id})">${ref}</a></span></span>`;
const kept = (html, cites, scripture) => [...M.verbatimCites(html, cites, scripture)].sort();

const SCRIPTURE = M.scriptureIndex([
  { slug: 'dc', ch: 84, v: 44, text: 'For you shall live by every word that proceedeth forth from the mouth of God.' },
  { slug: 'dc', ch: 84, v: 45, text: 'For the word of the Lord is truth, and whatsoever is truth is light.' },
  { slug: 'john', ch: 3, v: 16, text: 'For God so loved the world, that he gave his only begotten Son,' },
  { slug: 'john', ch: 3, v: 17, text: 'that whosoever believeth in him should not perish, but have everlasting life.' },
  { slug: 'matt', ch: 24, v: 28, text: 'For wheresoever the carcase is, there will the eagles be gathered together.' },
]);

console.log('Re-derived cites (fixtures):');
{
  const html = '<p>\nFor you shall live by every word that proceedeth forth\nfrom the mouth of God\n' +
    `${span(11, 'D&amp;C 84:44')}\n</p><p>\nThere is much more.</p>`;
  deep(kept(html, [{ id: 11, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [11],
    'a cite whose verse the paragraph before its span quotes is re-derived');

  // Journal of Discourses: "wherever the carcass is" alludes to Matt. 24:28.
  const allusion = '<div class="paragraph jod" id="v4n1534"> I know that thousands will flock to this land, ' +
    `for wherever the carcass is,${span(65791, 'Matt. 24:28')} they will come. </div>`;
  deep(kept(allusion, [{ id: 65791, slug: 'matt', ch: 24, verses: [28] }], SCRIPTURE), [],
    'an allusion is not re-derived');

  const elsewhere = '<p>For you shall live by every word that proceedeth forth from the mouth of God.</p>' +
    `<p>As the revelation says, so we live.${span(12, 'D&amp;C 84:44')}</p>`;
  deep(kept(elsewhere, [{ id: 12, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [],
    'a quotation in another paragraph does not re-derive the cite');

  const far = `<p>For you shall live by every word that proceedeth forth from the mouth of God. ${'And so on. '.repeat(60)}${span(13, 'D&amp;C 84:44')}</p>`;
  deep(kept(far, [{ id: 13, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [],
    `a quotation more than ${M.WINDOW} characters before the span does not count`);

  const seven = `<p>We all live by every word that proceedeth forth, he said.${span(14, 'D&amp;C 84:44')}</p>`;
  deep(kept(seven, [{ id: 14, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [],
    `fewer than ${M.MIN_RUN} shared words is not a quotation`);

  const across = '<p>For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him ' +
    `should be saved${span(15, 'John 3:16-17')}, and again${span(16, 'John 3:17')}.</p>`;
  deep(kept(across, [{ id: 15, slug: 'john', ch: 3, verses: [16, 17] }, { id: 16, slug: 'john', ch: 3, verses: [17] }], SCRIPTURE), [15],
    'a quotation running across verses counts toward a cite of the range, and only its words in a cite\'s own verses count');

  const paged = '<div class="paragraph jod" id="v4n1">He said, For wheresoever the car<div class="hyphen">-</div>' +
    '<div class="break pagebreak" id="208a">[<a href="/jod/pdf/JoD04/JoD04_0208.pdf" target="pdfwin">p. 208a]<b class="impdf"></b></a></div>' +
    `case is, there will the eagles be gathered together.${span(17, 'Matt. 24:28')} </div>`;
  deep(kept(paged, [{ id: 17, slug: 'matt', ch: 24, verses: [28] }], SCRIPTURE), [17],
    'a page marker and a line-end hyphen inside a quotation do not break it');

  const labelled = `<p>For you shall live by every word${span(18, 'Deut. 8:3')} that proceedeth forth from the mouth of God${span(19, 'D&amp;C 84:44')}</p>`;
  deep(kept(labelled, [{ id: 19, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [19],
    'another cite\'s label inside a quotation does not break it');

  const missing = `<p>A great and marvelous vision of the redemption of the dead was opened to me.${span(20, 'D&amp;C 138:11')}</p>`;
  deep(kept(missing, [{ id: 20, slug: 'dc', ch: 138, verses: [11] }], SCRIPTURE), [],
    'a cite whose verses the inputs lack is never re-derived');
  deep(kept(`<p>No span here, for you shall live by every word that proceedeth forth from the mouth of God.</p>`,
    [{ id: 21, slug: 'dc', ch: 84, verses: [44] }], SCRIPTURE), [], 'a cite whose span the talk lacks is not re-derived');
}

// The scripture inputs as downloaded: Gutenberg texts carry "c:v " markers
// (a 1:1 opens the next book); the 1920s OCR scans carry chapter headings and
// "N. " verse lines among running heads and footnote keys.
console.log('Scripture inputs (fixtures):');
{
  const gutenberg = 'Header\n*** START OF THE PROJECT GUTENBERG EBOOK ***\nThe First Book of Moses: Called Genesis\n\n' +
    '1:1 In the beginning God created the heaven and the earth.\n\n1:2 And the earth was without form, and void;\n' +
    'and darkness was upon the face of the deep.\n\n2:1 Thus the heavens and the earth were finished.\n\n' +
    'Exodus\n\n1:1 Now these are the names of the children of Israel.\n*** END OF THE PROJECT GUTENBERG EBOOK ***\nLicense 1:1 text';
  deep(M.parseGutenberg(gutenberg, ['gen', 'ex']).map((v) => [v.slug, v.ch, v.v, v.text]), [
    ['gen', 1, 1, 'In the beginning God created the heaven and the earth.'],
    ['gen', 1, 2, 'And the earth was without form, and void; and darkness was upon the face of the deep.'],
    ['gen', 2, 1, 'Thus the heavens and the earth were finished.'],
    ['ex', 1, 1, 'Now these are the names of the children of Israel.'],
  ], 'a Gutenberg text splits into verses at its c:v markers, a 1:1 opening the next book');
  check(/expected 3/.test((() => { try { M.parseGutenberg(gutenberg, ['gen', 'ex', 'lev']); return ''; } catch (e) { return e.message; } })()),
    'a Gutenberg text with fewer books than expected is an error, not a short index');

  const ocr = ['SECTION 1.', '1. Hearken, O ye people of my church, saith the voice of him', 'who dwells on high.',
    'DOCTRINE AND COVENANTS', '2. For verily the voice of the Lord is unto all men,', 'a, 20:46; b, 1:5.',
    'SECTION 2.', '1. Behold, I will reveal unto you the Priesthood.', 'OFFICIAL DECLARATION'].join('\n');
  deep(M.parseOcr(ocr, [{ slug: 'dc', from: 0, to: 8, chapter: /^SECTION\s/, firstChapter: 1 }]).map((v) => [v.slug, v.ch, v.v, v.text]), [
    ['dc', 1, 1, 'Hearken, O ye people of my church, saith the voice of him who dwells on high.'],
    ['dc', 1, 2, 'For verily the voice of the Lord is unto all men,'],
    ['dc', 2, 1, 'Behold, I will reveal unto you the Priesthood.'],
  ], 'an OCR scan splits at its headings and verse lines, dropping running heads and footnote keys');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
