/*
 * Safe renderer: turns the normalized IR (blocks/runs from the worker, or from
 * __BTX.churchText) into DOM using only createElement / text nodes. No
 * innerHTML, no parsing of remote HTML, so there is no XSS surface even though
 * the text comes from a third-party API.
 *
 * A heading is { type:'heading', text } or, when it carries furigana, also
 * `runs`. Paragraph styles: 'q…' is poetry (indented), 'summary' the italic chapter
 * summary, 'intro' a chapter's introductory line; anything else is prose.
 * Runs: { t:'v', n } verse number, { t:'txt', s, wj } text, { t:'ruby', s, rt }
 * text with a reading above it (Japanese furigana), { t:'br' } a line break.
 *
 * IIFE -> __BTX.sanitize.
 */
(function (root) {
  'use strict';

  function renderBlocks(blocks) {
    const frag = document.createDocumentFragment();
    if (!Array.isArray(blocks)) return frag;

    for (const block of blocks) {
      if (!block) continue;
      if (block.type === 'heading') {
        const h = document.createElement('h3');
        h.className = 'btx-heading';
        if (Array.isArray(block.runs)) renderRuns(block.runs, h); // furigana
        else h.textContent = block.text || '';
        frag.appendChild(h);
      } else if (block.type === 'para') {
        const p = document.createElement('p');
        p.className = 'btx-para';
        const style = String(block.style || 'p');
        if (/^q/.test(style)) p.classList.add('btx-poetry', `btx-${style}`);
        else if (style === 'summary' || style === 'intro') p.classList.add(`btx-${style}`);
        renderRuns(block.runs, p);
        frag.appendChild(p);
      }
    }
    return frag;
  }

  function renderRuns(runs, parent) {
    if (!Array.isArray(runs)) return;
    for (const run of runs) {
      if (!run) continue;
      if (run.t === 'v') {
        const sup = document.createElement('sup');
        sup.className = 'btx-vnum';
        sup.textContent = run.n || '';
        parent.appendChild(sup);
        parent.appendChild(document.createTextNode(' '));
      } else if (run.t === 'txt') {
        if (run.wj) {
          const span = document.createElement('span');
          span.className = 'btx-wj';
          span.textContent = run.s || '';
          parent.appendChild(span);
        } else {
          parent.appendChild(document.createTextNode(run.s || ''));
        }
      } else if (run.t === 'ruby') {
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(run.s || ''));
        const rt = document.createElement('rt');
        rt.textContent = run.rt || '';
        ruby.appendChild(rt);
        parent.appendChild(ruby);
      } else if (run.t === 'br') {
        parent.appendChild(document.createElement('br'));
      }
    }
  }

  root.__BTX = Object.assign(root.__BTX || {}, {
    sanitize: { renderBlocks },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
