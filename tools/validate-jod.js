#!/usr/bin/env node
/*
 * Validate the Journal of Discourses pipeline (spec #69 A6, A8): the talk
 * builder's pure core on fixtures, then the J corpus as the public pack ships it.
 * Run: node tools/validate-jod.js   (after build-citation-data.js)
 *
 * Covers tools/build-jod-talks.js (Wikisource wikitext and scan HTML to a talk
 * document, the join key, the text gate, citation-marker placement by word
 * alignment with the page-anchor fallback, snippets re-cut from the
 * Wikisource text, the patch file) and tools/fetch-jod-wikisource.js's
 * request shape. Over the committed public pack: every J talk has a
 * provenance row with a Wikisource revision and its source record carries
 * that revision's permalink; the shipped talk file is the one the builder
 * wrote (its hash is in the row) and carries no BYU markup; every J cite has
 * a citation marker or a page anchor in its talk; every J snippet is a
 * substring of its talk's text.
 * Exits non-zero on failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const jod = require(path.join(ROOT, 'tools', 'build-jod-talks.js'));
const snap = require(path.join(ROOT, 'tools', 'fetch-jod-wikisource.js'));

let failures = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };
const eq = (a, b, msg) => check(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const deep = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* ------------------------------------------------------------ snapshot tool */

console.log('Snapshot requests (fixtures):');
{
  const u = new URL(snap.queryUrl({ action: 'query', generator: 'allpages' }));
  eq(u.searchParams.get('maxlag'), '5', 'every request carries maxlag=5');
  eq(u.searchParams.get('formatversion'), '2', 'every request asks for formatversion 2');
  eq(u.origin + u.pathname, 'https://en.wikisource.org/w/api.php', 'requests go to the English Wikisource API');
  check(/https?:\/\//.test(snap.USER_AGENT), 'the User-Agent carries a way to reach the project');
  check(snap.transcludes('<pages index="Journal of Discourses, Volume 20.pdf" from=32 to=39 />'), 'a <pages index> page is scan-backed');
  check(!snap.transcludes('{{page break|1|top}}\nText.'), 'a plain wikitext page is not');
  const byId = new Map();
  snap.mergePages(byId, { query: { pages: [{ pageid: 7, title: 'T', revisions: [{ revid: 9, timestamp: 'ts', user: 'u', sha1: 'h', slots: { main: { content: 'W' } } }] }] } });
  snap.mergePages(byId, { query: { pages: [{ pageid: 7, title: 'T', templates: [{ title: 'Template:Header' }] }] } });
  deep(byId.get(7), { pageid: 7, title: 'T', templates: ['Template:Header'], revid: 9, timestamp: 'ts', user: 'u', sha1: 'h', wikitext: 'W' },
    'a page split over two batches keeps its revision and gains its templates');
}

/* ------------------------------------------------------------- wikitext */

const PAGE = `{{similar|Salvation}}
{{header
 | title    = [[../../]]
 | author   = Brigham Young (1801-1877)
|section=[[../|Volume 1]], SALVATION
|notes=A Discourse Delivered by President Brigham Young, in the Tabernacle, January 16, 1853.
(Online document scan of [http://contentdm.lib.byu.edu/x ''Journal of Discourses'', Volume 1])
}}

{{page break|1|top}}
The plan of salvation is a ''subject'' that should occupy us. We visit {{SIC|Cincinatti|Cincinnati}} often.

Descend from the busy {{page break|2|top}}classes, and follow them.
{{page break|3 ] fear. For if God spared not the natural branches.

[[Category:Sermons]]
`;

console.log('Wikitext to a talk document (fixtures):');
{
  const doc = jod.wikiDoc(PAGE);
  eq(doc.heading, 'SALVATION', 'the heading is the printed section title, without the volume link');
  eq(doc.subtitle, 'A Discourse Delivered by President Brigham Young, in the Tabernacle, January 16, 1853.',
    'the subtitle is the printed notes line, without the contributor\'s scan note');
  eq(doc.paras.length, 2, 'paragraphs split on blank lines; categories are dropped');
  eq(doc.paras[0].text, 'The plan of salvation is a subject that should occupy us. We visit Cincinatti often.',
    'italics are not text; a [sic] correction keeps the printed spelling');
  deep(doc.paras[0].marks, [{ at: 0, page: 1 }, { at: 27, em: 'open' }, { at: 34, em: 'close' }],
    'a page break and an italic run are positions in the paragraph');
  eq(doc.paras[1].text, 'Descend from the busy classes, and follow them. fear. For if God spared not the natural branches.',
    'a page break mid-paragraph leaves the text whole; a malformed page break loses its stray bracket');
  deep(doc.paras[1].marks.filter((m) => m.page), [{ at: 22, page: 2 }, { at: 48, page: 3 }], 'both page breaks are kept');
  deep(jod.pagesOf(doc), [1, 2, 3], 'the document runs over pages 1–3');
}

const SCAN_WIKITEXT = `{{other versions|Discourse by Elder Joseph F. Smith}}
{{header
 | contributor   = [[Author:Joseph Fielding Smith (1838-1918)|Joseph F. Smith]]
 | section  = Plural Marriage—For the Righteous Only
 | notes    =
}}
<pages index="Journal of Discourses, Volume 20.pdf" from=32 fromsection=2 to=39 />`;
const SCAN_HTML = `<div class="mw-parser-output"><div class="ws-header ws-noexport"><a href="/wiki/x">Prev</a></div>
<p><span style="display:none" id="dynamic&#95;layout&#95;overrider">Layout 2</span></p>
<div class="prp-pages-output" lang="en">
<span><span class="pagenum ws-pagenum" id="24" data-page-number="24" data-page-quality="3"><span id="pageindex&#95;32" class="pagenum-inner ws-noexport">&#8203;</span></span></span><style>.x{}</style><div class="wst-center">
<p>DISCOURSE BY <a href="/wiki/Author:J">ELDER JOSEPH F. SMITH</a>,
</p></div><hr class="wst-rule" />
<p><i>(Reported by G. F. Gibbs.)</i>
</p><p>I will read a part of the <span class="wst-tooltip" title="Doctrine and Covenants">Book of</span> Doctrine &amp; Covenants, <span><span class="pagenum ws-pagenum" data-page-number="25"><span class="pagenum-inner ws-noexport">&#8203;</span></span></span>section 132.
</p></div></div>`;

console.log('Scan-backed page to a talk document (fixtures):');
{
  const doc = jod.scanDoc(SCAN_HTML, SCAN_WIKITEXT);
  eq(doc.heading, 'Plural Marriage—For the Righteous Only', 'the heading comes from the header');
  deep(doc.paras.map((p) => p.text), [
    'DISCOURSE BY ELDER JOSEPH F. SMITH,',
    '(Reported by G. F. Gibbs.)',
    'I will read a part of the Book of Doctrine & Covenants, section 132.',
  ], 'paragraphs come from the transcluded pages only, entities decoded');
  deep(doc.paras[0].marks, [{ at: 0, page: 24 }], 'a page-number span is a page break');
  deep(doc.paras[1].marks, [{ at: 0, em: 'open' }, { at: 26, em: 'close' }], 'italics are kept');
  deep(doc.paras[2].marks, [{ at: 56, page: 25 }], 'a page turn mid-paragraph is a position');
}

// One talk as the snapshot and the BYU DBs give it. BYU's copy differs from
// Wikisource the way the real ones do: modernised spelling, a page-break div,
// citation spans carrying BYU's reference labels, and one cite whose words
// Wikisource does not have.
const WIKI_PAGE = {
  title: 'Journal of Discourses/Volume 1/Test Discourse',
  revid: 16217145, timestamp: '2014-03-01T00:00:00Z', sha1: 'abc123',
  wikitext: `{{header
|section=[[../|Volume 1]], TEST DISCOURSE
|notes=A Discourse by President Brigham Young.
(Online document scan of [http://contentdm.lib.byu.edu/x ''Journal of Discourses'', Volume 1])
}}
{{page break|1|top}}
And it came to pass that the people were gathered together in the valley, and they did rejoice to day in the ''labour'' of their hands.

Then the Lord spake unto them, saying, love one {{page break|2|top}}another as I have loved you.`,
};
const BYU_HTML = '<html><head><title>JD 1:1, Brigham Young, Test Discourse.</title></head><body>' +
  '<div class="discourseHeader"><div class="title">Test Discourse.</div></div><div class="discourseBody" id="d01">' +
  '<div class="paragraph jod" id="v1n1"> And it came to pass that the people were gathered together in the valley' +
  '<span class="citation" id="501"><a href="javascript:void(0)" onclick="sx(this, 501)"> </a><a href="javascript:void(0)">Gen. 1:1</a></span>' +
  ', and they did rejoice today in the labor of their hands. </div><div class="paragraph jod" id="v1n2"> Then the Lord spake unto them, saying, love one ' +
  '<div class="break columnbreak" id="2a">[<a href="/jod/pdf/JoD01/JoD01_0002.pdf">p. 2a]</a></div> another as I have loved you' +
  '<span class="citation" id="502"><a> </a><a>John 13:34</a></span>. Hear him' +
  '<span class="citation" id="503"><a> </a><a>Matt. 17:5</a></span></div></div></body></html>';
const CITES = [{ id: '501', page: 1 }, { id: '502', page: 2 }, { id: '503', page: 2 }];

console.log('BYU talk HTML as an alignment input (fixtures):');
{
  const byu = jod.byuWords(BYU_HTML);
  eq(byu.startPage, 1, 'BYU\'s start page is read from its <title>');
  eq(byu.words.join(' '), 'and it came to pass that the people were gathered together in the valley and they did rejoice today in the labor of their hands ' +
    'then the lord spake unto them saying love one another as i have loved you hear him',
  'BYU\'s words exclude its reference labels and page-break labels');
  deep(byu.cites, [{ id: '501', k: 14 }, { id: '502', k: 40 }, { id: '503', k: 42 }], 'each citation span sits before a word index');
}

console.log('One talk built from Wikisource (fixtures):');
{
  const t = jod.buildTalk({ talkId: 10099, page: WIKI_PAGE, byuHtml: BYU_HTML, cites: CITES, gate: 0.6 });
  check(t.ok, 'the talk joins and passes the text gate');
  check(!/discourseBody|class="break|<a\b|Gen\. 1:1|John 13:34|today|labor\b/.test(t.html),
    'the talk HTML holds no BYU markup, reference label or BYU spelling');
  check(t.html.includes('in the valley,<span class="citation" id="501"></span> and they'),
    'a cite whose 4 preceding words align exactly gets its marker after them');
  check(t.html.includes('as I have loved you.<span class="citation" id="502"></span>'),
    'a cite after a page-break div in BYU\'s copy still aligns');
  check(!t.html.includes('id="503"'), 'a cite whose words Wikisource lacks gets no marker');
  check(t.html.includes('<span class="jodPage" id="jdp-1"></span>And it came') &&
    t.html.includes('love one <span class="jodPage" id="jdp-2"></span>another'), 'page breaks are empty page anchors');
  check(t.html.includes('<i>labour</i>'), 'italics are kept');
  check(t.html.includes('A Discourse by President Brigham Young.') && !/Online document scan/.test(t.html),
    'the printed subtitle is kept, the contributor\'s scan note dropped');
  deep(t.cites['501'], { sn: 'And it came to pass that the people were gathered together in the valley, and they did rejoice to day in the labour of their hands.' },
    'a short paragraph is the whole snippet, in Wikisource\'s spelling');
  deep(t.cites['503'], { sn: 'Then the Lord spake unto them, saying, love one another as I have loved you.', a: 'jdp-2' },
    'an unplaced cite falls back to its printed page\'s anchor');
  eq(t.row.url, 'https://en.wikisource.org/w/index.php?title=Journal_of_Discourses/Volume_1/Test_Discourse&oldid=16217145',
    'the talk\'s URL is the permalink at its revision');
  deep([t.row.title, t.row.revid, t.row.timestamp, t.row.sha1], [WIKI_PAGE.title, 16217145, WIKI_PAGE.timestamp, 'abc123'],
    'the provenance row names the Wikisource page and revision');
  deep(t.row.pages, [1, 2], 'the provenance row has the page range');
  deep(t.row.placed, { marker: 2, page: 1 }, 'the provenance row counts how cites were placed');
  eq(t.row.hash, crypto.createHash('sha256').update(t.html).digest('hex'), 'the provenance row hashes the talk HTML');

  const other = BYU_HTML.replace(/And it came to pass that the people were gathered together/, 'Brethren, I will speak this afternoon on the subject of the');
  const refused = jod.buildTalk({ talkId: 10099, page: WIKI_PAGE, byuHtml: other, cites: CITES });
  check(!refused.ok && refused.row.overlap < jod.GATE, `below the text gate (${jod.GATE}) the join is refused`);
  check(jod.buildTalk({ talkId: 10099, page: WIKI_PAGE, byuHtml: BYU_HTML, cites: CITES }).ok,
    'BYU\'s modernised spelling does not count against the gate');
}

console.log('Patches (fixtures):');
{
  // BYU files a second, separately printed discourse under the same talk;
  // Wikisource has it as its own page.
  const REMARKS = {
    title: 'Journal of Discourses/Volume 1/Remarks by Elder Woodruff', revid: 777, timestamp: '2014-01-01T00:00:00Z', sha1: 'r1',
    wikitext: '{{header\n|section=[[../|Volume 1]], REMARKS BY ELDER WILFORD WOODRUFF\n|notes=\n}}\n' +
      'It is not my purpose at all to detain this congregation, but before dismissing I would say a few words concerning Brother Pratt.',
  };
  const merged = BYU_HTML.replace('</div></div></body>', ' It is not my purpose at all to detain this congregation, but before dismissing I would ' +
    'say a few words concerning Brother Pratt<span class="citation" id="504"><a>Heb. 11:4</a></span>.</div></div></body>');
  const cites = CITES.concat([{ id: '504', page: 2 }]);
  const alone = jod.buildTalk({ talkId: 10099, page: WIKI_PAGE, byuHtml: merged, cites, gate: 0.8 });
  check(!alone.ok, 'without the patch, the merged talk fails the gate');
  const t = jod.buildTalk({
    talkId: 10099, page: WIKI_PAGE, byuHtml: merged, cites, gate: 0.8,
    patches: [{ append: REMARKS.title, page: REMARKS, note: 'Printed as a separate item; BYU files it under this talk.' }],
  });
  check(t.ok, 'an append patch adds the other Wikisource page and the talk passes the gate');
  check(t.html.includes('<p class="jodHeading">REMARKS BY ELDER WILFORD WOODRUFF</p>'), 'the appended page keeps its printed heading');
  check(t.html.includes('Brother Pratt.<span class="citation" id="504"></span>'), 'a cite in the appended text gets its marker');
  deep(t.row.patch, [{ kind: 'append', title: REMARKS.title, revid: 777, timestamp: REMARKS.timestamp, sha1: 'r1',
    url: jod.permalink(REMARKS.title, 777), note: 'Printed as a separate item; BYU files it under this talk.' }],
  'the provenance row names the appended page and its revision');

  // BYU inserts a document the print only mentions.
  const inserted = BYU_HTML.replace('Then the Lord spake', 'William Clayton\'s testimony. The following statement was sworn to before ' +
    'a notary public and is here given in full as it was then read<span class="citation" id="505"><a>D&amp;C 132:1</a></span>. Then the Lord spake');
  const note = 'BYU inserts the affidavit; the print has only the line saying it was read.';
  const without = jod.buildTalk({ talkId: 10099, page: WIKI_PAGE, byuHtml: inserted, cites: CITES.concat([{ id: '505', page: 1 }]), gate: 0.8 });
  check(!without.ok, 'without the patch, a BYU insertion fails the gate');
  const kept = jod.buildTalk({
    talkId: 10099, page: WIKI_PAGE, byuHtml: inserted, cites: CITES.concat([{ id: '505', page: 1 }]), gate: 0.8,
    patches: [{ byuOnly: { from: 'William Clayton\'s testimony', to: 'as it was then read' }, note }],
  });
  check(kept.ok, 'a byuOnly patch leaves BYU\'s insertion out of the gate');
  eq(kept.cites['505'] && kept.cites['505'].a, 'jdp-1', 'a cite inside BYU\'s insertion falls back to its page');
  deep(kept.row.patch, [{ kind: 'byuOnly', from: 'William Clayton\'s testimony', to: 'as it was then read', words: 24, note }],
    'the provenance row records the passage left out of the gate');
  check(!kept.html.includes('notary'), 'nothing of BYU\'s insertion is written');
}

console.log('Alignment words (fixtures):');
{
  const ws = (text) => jod.docWords(jod.wikiDoc(text)).map((w) => w.n).join(' ');
  eq(ws('Shall endure for ever—and to day the Saviour’s labour is marvellous, in every thing.'),
    'shall endure forever and today the saviors labor is marvelous in everything',
  'Liverpool spellings, split compounds and dash-joined words compare as BYU\'s modern forms');
  eq(jod.byuWords('<div class="discourseBody">endure forever. Today the Savior’s labor is marvelous, in everything.</div>').words.join(' '),
    'endure forever today the saviors labor is marvelous in everything', 'BYU\'s words take the same forms');
  const w = jod.docWords(jod.wikiDoc('It is for ever so.'));
  eq(w[2].end, 'It is for ever'.length, 'a merged word ends where its second half ends');
}

console.log('Join and page-range cut (fixtures):');
{
  const doc = (pages, words) => ({ paras: pages.map((p, i) => ({ text: words[i], marks: [{ at: 0, page: p }] })) });
  const say = (s) => s.split(' ').map((w) => w.toLowerCase());
  const SERMON = 'brethren I am glad to see you once more and for the privilege of meeting with you this day';
  const OTHER = 'the subject of this afternoon is the perpetual emigrating fund and those who owe to it';
  const byu = { startPage: 172, words: say(SERMON) };
  const entries = [
    { page: { title: 'A' }, doc: doc([173], [SERMON]), range: [172, 185] },
    { page: { title: 'B' }, doc: doc([172], [OTHER]), range: [170, 172] },
  ];
  const j = jod.joinTalk(entries, byu);
  eq(j && j.page.title, 'A', 'a talk whose Wikisource page starts a page later joins on its listed range');
  eq(j && j.by, 'listed range', 'and the join says how');
  eq(jod.joinTalk([entries[1]], byu), null, 'a page with the same key but other text does not join');
  eq(jod.joinTalk([{ page: { title: 'C' }, doc: doc([174], [SERMON]), range: null }], byu), null,
    'a page with the same text but another key does not join');

  const run = doc([47, 48, 49], ['Almighty Father, thou who dwellest in the heavens', 'we beseech thee to behold us', 'in thy mercy forever. Amen.']);
  const prayer = { words: say('almighty father thou who dwellest in the heavens we beseech thee to behold us in thy mercy forever amen') };
  eq(jod.pagesOf(jod.trimToRange(run, [47, 48], prayer)).join(), '47,48,49', 'a page past the listed range that BYU\'s copy also has stays');
  const runOn = doc([307, 308], ['Almighty Father, thou who dwellest in the heavens we beseech thee to behold us in thy mercy forever. Amen.',
    'Discourse by Elder Orson Pratt on the subject of the resurrection of the dead and the judgment']);
  eq(jod.pagesOf(jod.trimToRange(runOn, [302, 307], prayer)).join(), '307', 'a run-on into the next discourse is cut at the listed end page');
}

console.log('Snippets (fixtures):');
{
  const long = 'First sentence of a long paragraph that keeps going for a good while. ' +
    'Second sentence, which is the one the cite follows and quotes the verse in full. ' +
    'Third sentence runs on after the cite with more words that are not needed here at all, and still more.';
  const at = long.indexOf('in full.') + 'in full.'.length;
  const sn = jod.snippetAt(long, at);
  check(sn.startsWith('Second sentence,') && sn.includes('in full.'), `the snippet starts at the sentence the cite follows (${sn})`);
  check(sn.length <= jod.SNIPPET_MAX + 2, 'the snippet is bounded');
  check(long.includes(sn.replace(/^…|…$/g, '')), 'the snippet is a substring of the paragraph, ellipses aside');
}

/* --------------------------------------------------------------- the packs */

// BYU's talk markup: none of it may reach a shipped J talk.
const BYU_MARKUP = /discourseBody|discourseHeader|class="break|contentdm|byu\.edu|<a\b|onclick|javascript:/;
const textOf = (html) => String(html).replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const squash = (s) => String(s).replace(/\s+/g, '');

function packChecks(dir, name) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
  const index = read('index.json');
  const sources = read('sources.json');
  console.log(`Journal of Discourses in the ${name} pack:`);
  const J = index.pack && index.pack.corpora && index.pack.corpora.J;
  check(J && J.text === 'bundled' && J.attribution === 'wikisource', 'the descriptor bundles J and credits Wikisource');
  const provFile = path.join(dir, 'jod-provenance.json');
  check(fs.existsSync(provFile), 'the pack carries jod-provenance.json');
  if (!fs.existsSync(provFile)) return;
  const prov = JSON.parse(fs.readFileSync(provFile, 'utf8')).talks || {};

  const jTalks = Object.keys(sources).filter((id) => sources[id].c === 'J');
  const html = {};
  let noRow = 0; let badRow = 0; let badUrl = 0; let badHash = 0; let byuMarkup = 0; let missing = 0;
  for (const id of jTalks) {
    const row = prov[id];
    if (!row) { noRow++; continue; }
    if (!Number.isInteger(row.revid) || !row.title || !row.timestamp || !row.sha1) badRow++;
    if (sources[id].url !== jod.permalink(row.title, row.revid) || row.url !== sources[id].url) badUrl++;
    const file = path.join(dir, 'talks', `${id}.html.gz`);
    if (!fs.existsSync(file)) { missing++; continue; }
    const raw = zlib.gunzipSync(fs.readFileSync(file));
    if (crypto.createHash('sha256').update(raw).digest('hex') !== row.hash) badHash++;
    html[id] = raw.toString('utf8');
    if (BYU_MARKUP.test(html[id])) byuMarkup++;
  }
  check(jTalks.length > 1000, `J talks are listed (${jTalks.length})`);
  check(noRow === 0, `every J talk has a provenance row (${noRow} without)`);
  check(badRow === 0, `every provenance row names a Wikisource page, revision, timestamp and sha1 (${badRow} incomplete)`);
  check(badUrl === 0, `every J source's URL is its Wikisource permalink at the provenance revision (${badUrl} not)`);
  check(missing === 0, `every J talk is bundled (${missing} missing)`);
  check(badHash === 0, `every bundled J talk is the file the Wikisource build wrote, by hash (${badHash} differ)`);
  check(byuMarkup === 0, `no bundled J talk carries BYU markup (${byuMarkup} do)`);
  check(Object.keys(prov).every((id) => sources[id] && sources[id].c === 'J'), 'every provenance row is a J talk in the pack');

  let cites = 0; let unplaced = 0; let snippetMiss = 0; let markers = 0; let anchors = 0;
  const misses = [];
  for (const b of read('index.json').books) {
    const shard = read(`citations/${b.slug}.json`);
    for (const [citId, c] of Object.entries(shard.cites)) {
      if (!sources[c.t] || sources[c.t].c !== 'J' || !html[c.t]) continue;
      cites++;
      const h = html[c.t];
      if (h.includes(`<span class="citation" id="${citId}">`)) markers++;
      else if (/^jdp-\d+$/.test(c.a || '') && h.includes(`id="${c.a}"`)) anchors++;
      else unplaced++;
      const core = String(c.sn || '').replace(/^…/, '').replace(/…$/, '');
      if (!core || !squash(textOf(h)).includes(squash(core))) { snippetMiss++; if (misses.length < 3) misses.push(`${citId}: ${c.sn}`); }
    }
  }
  check(cites > 40000, `J cites are walked (${cites})`);
  check(unplaced === 0, `every J cite has a citation marker or a page anchor in its talk (${unplaced} have neither)`);
  check(snippetMiss === 0, `every J snippet is a substring of its bundled talk's text (${snippetMiss} not${misses.length ? ': ' + misses.join(' | ') : ''})`);
  console.log(`  ${jTalks.length} talks; ${cites} cites, ${markers} at a marker, ${anchors} at a page anchor.`);
}

const PACKS = [['public', path.join(ROOT, 'src', 'citations', 'data')], ['personal', path.join(ROOT, 'src', 'citations', 'data-personal')]];
for (const [name, dir] of PACKS) {
  if (fs.existsSync(path.join(dir, 'index.json'))) packChecks(dir, name);
  else if (name === 'public') check(false, `no public pack at ${dir}; run build-citation-data.js`);
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');
