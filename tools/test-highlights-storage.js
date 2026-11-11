/* Dependency-free highlight persistence checks through public DOM actions and
 * load/all in independent module contexts. Run through validate-highlights. */
'use strict';
const assert = require('node:assert/strict');
const { reader, storage } = require('./highlights-test-dom.js');
const plain = (value) => JSON.parse(JSON.stringify(value));
const texts = (r) => r.marks().map((mark) => mark.text).sort();
const record = (id, start, end, text, extra = {}) => ({ id, blockId: 'p1', blockIdx: 0, start, end, text, ...extra });

module.exports = async function checkStorage() {
  let cases = 0;
  async function check(name, run) { await run(); cases++; }
  await check('concurrent additions and removals', async () => {
    const saved = storage();
    const a = reader(saved.api), b = reader(saved.api);
    await Promise.all([a.attach(), b.attach()]);
    await Promise.all([a.offer(a.article.querySelector('p').firstChild, 0), b.offer(b.article.querySelector('p').firstChild, 6)]);
    a.apply(); b.apply(); await saved.settle();
    const fresh = reader(saved.api); await fresh.attach();
    assert.deepEqual(texts(fresh), ['Alpha', 'beta '], 'both concurrent highlights return on reopening');
    assert.equal((await fresh.api.all())[0].items.length, 2, 'all returns both saved records');
    a.remove(a.marks()[0].id); b.remove(b.marks()[0].id); await saved.settle();
    const reopened = reader(saved.api); await reopened.attach();
    assert.deepEqual(reopened.marks(), [], 'concurrent removals stay removed on reopening');
    assert.deepEqual(plain(await reopened.api.load(1)), [], 'load excludes both tombstones');
  });

  await check('legacy additions and removals overlap', async () => {
    const legacy = [record('old-one', 0, 5, 'Alpha'), record('old-two', 6, 10, 'beta')];
    const saved = storage({ 'btxHl::1': legacy, unrelated: { body: 'cached chapter' } });
    const a = reader(saved.api), b = reader(saved.api);
    await Promise.all([a.attach(), b.attach()]);
    assert.equal(saved.writes, 0, 'opening legacy marks does not migrate storage');
    assert.deepEqual(plain(await a.api.load(1)), legacy, 'legacy ids, anchors, quotes and record order survive');
    assert.equal(saved.writes, 0, 'reading legacy marks does not migrate storage');
    assert.ok(saved.gets.every((keys) => Array.isArray(keys) && !keys.includes('unrelated')), 'modern reads omit unrelated cached values');
    a.remove('old-one'); b.remove('old-two'); await saved.settle();
    assert.deepEqual(plain(await a.api.load(1)), [], 'separate legacy deletions cannot resurrect each other');
    assert.ok(!('btxHl::1' in saved.data), 'removed legacy quotes leave storage (privacy policy: Remove deletes)');
    assert.deepEqual(plain(await a.api.all()), [{ talkId: '1', items: [] }], 'all excludes deleted legacy quotes');
    const newReader = reader(saved.api); await newReader.attach();
    await newReader.offer(newReader.article.querySelector('p').firstChild, 11);
    newReader.apply(); await saved.settle();
    assert.deepEqual((await newReader.api.load(1)).map((rec) => rec.text).join(','), 'gamma', 'new mark survives legacy tombstones');
  });

  await check('concurrent addition and unrelated removal', async () => {
    const saved = storage({ 'btxHl::1': [record('old', 0, 5, 'Alpha')] });
    const a = reader(saved.api), b = reader(saved.api);
    await Promise.all([a.attach(), b.attach()]);
    await a.offer(a.article.querySelector('p').lastChild, 1);
    a.apply(); b.remove('old'); await saved.settle();
    const fresh = reader(saved.api); await fresh.attach();
    assert.deepEqual(texts(fresh), ['beta '], 'addition and removal both persist after reopening');
  });

  await check('one multi-block logical highlight', async () => {
    const saved = storage(), a = reader(saved.api);
    await a.attach();
    const paragraphs = a.article.querySelectorAll('p');
    await a.offer(paragraphs[0].firstChild, 25, paragraphs[1].firstChild, 6);
    a.apply(); await saved.settle();
    const loaded = plain(await a.api.load(1));
    assert.deepEqual(loaded.map((rec) => rec.text), ['silon.', 'Second']);
    assert.equal(new Set(loaded.map((rec) => rec.id)).size, 1, 'one selection keeps its logical id across blocks');
    const values = Object.values(saved.data).filter(Array.isArray);
    assert.equal(values.length, 1, 'one logical highlight has one atomic storage value');
    assert.equal(values[0].length, 2, 'both block records commit together');
    const fresh = reader(saved.api); await fresh.attach();
    assert.equal(fresh.marks().length, 2);
    fresh.remove(loaded[0].id); await saved.settle();
    assert.deepEqual(plain(await a.api.load(1)), [], 'one removal removes every block record');
    assert.ok(!JSON.stringify(saved.data).includes('Second'), 'new-format removal replaces its stored quote');
  });

  await check('overlap order and removal', async () => {
    const saved = storage(), a = reader(saved.api);
    await a.attach();
    await a.offer(a.article.querySelector('p').firstChild, 6, a.article.querySelector('p').firstChild, 16);
    a.apply(); await saved.settle();
    const firstId = a.marks()[0].id;
    const p = a.article.querySelector('p');
    await a.offer(p.firstChild, 0, p.lastChild, 6); a.apply(); await saved.settle();
    const initial = a.marks();
    const fresh = reader(saved.api); await fresh.attach();
    assert.deepEqual(fresh.marks(), initial, 'reopening replays overlapping marks in the same order');
    const secondId = initial.find((mark) => mark.id !== firstId).id;
    fresh.remove(secondId); await saved.settle();
    assert.deepEqual(fresh.marks(), [{ id: firstId, text: 'beta gamma' }], 'removing an overlap preserves the earlier mark');
    assert.equal(fresh.article.textContent, 'Alpha beta gamma delta epsilon.Second paragraph has words.', 'highlight actions preserve source text');
  });

  await check('immediate removal waits for creation', async () => {
    const saved = storage(), a = reader(saved.api);
    await a.attach();
    await a.offer(a.article.querySelector('p').firstChild, 0);
    a.apply(); a.remove(a.marks()[0].id); await saved.settle();
    const fresh = reader(saved.api); await fresh.attach();
    assert.deepEqual(fresh.marks(), [], 'a removal before the add save finishes stays removed');
  });

  await check('encoded identifiers and old Chromium fallback', async () => {
    const talk = 'gc/2026/10/a::b%talk', other = 'gc/2026/10/a';
    const legacyId = 'mark::with/%delimiters';
    const saved = storage({ [`btxHl::${talk}`]: [record(legacyId, 0, 5, 'Alpha')], [`btxHl::${other}`]: [record('other', 6, 10, 'beta')] }, false);
    const a = reader(saved.api, talk); await a.attach(); a.remove(legacyId); await saved.settle();
    assert.ok(!(`btxHl::${talk}` in saved.data), 'the removed legacy quote leaves storage');
    assert.deepEqual(saved.data[`btxHl::${other}`].map((rec) => rec.text), ['beta'], 'another talk\'s legacy quotes are untouched');
    assert.deepEqual(plain(await a.api.load(talk)), [], 'encoded legacy identifier removes from the intended talk');
    assert.deepEqual(plain(await a.api.load(other)).map((rec) => rec.id), ['other'], 'separator-containing talk does not affect another talk');
    assert.ok(saved.gets.some((keys) => keys === null), 'old Chromium fallback remains supported');
    const all = plain(await a.api.all());
    assert.equal(all.find((group) => group.talkId === talk).items.length, 0);
    assert.equal(all.find((group) => group.talkId === other).items.length, 1);
  });
  console.log(`highlights storage: ${cases} of ${cases} cases pass`);
};

if (require.main === module) module.exports().catch((error) => { console.error(error); process.exitCode = 1; });
