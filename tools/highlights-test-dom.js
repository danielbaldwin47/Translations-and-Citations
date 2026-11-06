/* Test-only talk DOM for highlight storage actions; extends mini-dom's nodes
 * with events, text splitting and ranges. No browser behavior is inferred
 * from it; native Chromium separately confirms selection and reopening. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseHtml } = require('./mini-dom.js');
const source = fs.readFileSync(path.join(__dirname, '../src/citations/highlights.js'), 'utf8');

function reader(storage, talkId = 1) {
  const doc = parseHtml('<div id="host"><article><p id="p1">Alpha beta gamma delta epsilon.</p><p id="p2">Second paragraph has words.</p></article></div>');
  const events = new WeakMap();
  function decorate(n) {
    n.style = {};
    n.contains = (other) => { for (let p = other; p; p = p.parentNode) if (p === n) return true; return false; };
    n.addEventListener = (type, cb) => {
      if (!events.has(n)) events.set(n, {});
      const handlers = events.get(n);
      (handlers[type] ||= []).push(cb);
    };
    n.dispatchEvent = (event) => {
      if (!event.target) event.target = n;
      event.preventDefault ||= () => {};
      event.stopPropagation ||= () => { event.stopped = true; };
      for (const cb of (events.get(n) || {})[event.type] || []) cb(event);
      if (event.bubbles && !event.stopped && n.parentNode) n.parentNode.dispatchEvent(event);
    };
    n.focus = () => { doc.activeElement = n; };
    n.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 20, width: 100, height: 20 });
    n.normalize = () => {
      for (const c of n.childNodes.slice()) if (c.nodeType !== 3) c.normalize();
      for (let i = n.childNodes.length - 1; i > 0; i--) {
        const a = n.childNodes[i - 1], b = n.childNodes[i];
        if (a.nodeType === 3 && b.nodeType === 3) { a.nodeValue += b.nodeValue; n.removeChild(b); }
      }
    };
    if (n.nodeType === 3) n.splitText = (at) => {
      const tail = doc.createTextNode(n.nodeValue.slice(at));
      n.nodeValue = n.nodeValue.slice(0, at);
      const siblings = n.parentNode.childNodes;
      n.parentNode.insertBefore(tail, siblings[siblings.indexOf(n) + 1] || null);
      return tail;
    };
    for (const child of n.childNodes) decorate(child);
    return n;
  }
  decorate(doc);
  const makeElement = doc.createElement.bind(doc), makeText = doc.createTextNode.bind(doc);
  doc.createElement = (tag) => decorate(makeElement(tag));
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.createTextNode = (text) => decorate(makeText(text));
  doc.activeElement = null;

  const rootOf = (n) => { while (n.parentNode) n = n.parentNode; return n; };
  function offset(root, node, at) {
    let pos = 0, found = null;
    const walk = (n) => {
      if (n === node) {
        found = pos + (n.nodeType === 3 ? at : n.childNodes.slice(0, at).reduce((sum, c) => sum + c.textContent.length, 0));
      }
      if (n.nodeType === 3) pos += n.nodeValue.length;
      else for (const child of n.childNodes) walk(child);
    };
    walk(root);
    return found;
  }
  class Range {
    setStart(node, at) { this.startContainer = node; this.startOffset = at; }
    setEnd(node, at) { this.endContainer = node; this.endOffset = at; }
    setStartBefore(node) { this.setStart(node.parentNode, node.parentNode.childNodes.indexOf(node)); }
    setStartAfter(node) { this.setStart(node.parentNode, node.parentNode.childNodes.indexOf(node) + 1); }
    collapse() { this.setEnd(this.startContainer, this.startOffset); }
    get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; }
    get commonAncestorContainer() {
      for (let n = this.startContainer; n; n = n.parentNode) if (n.contains(this.endContainer)) return n;
      return null;
    }
    toString() {
      const root = rootOf(this.startContainer);
      return root.textContent.slice(offset(root, this.startContainer, this.startOffset), offset(root, this.endContainer, this.endOffset));
    }
    intersectsNode(node) {
      const root = rootOf(this.startContainer), a = offset(root, node, 0);
      return a < offset(root, this.endContainer, this.endOffset) && a + node.textContent.length > offset(root, this.startContainer, this.startOffset);
    }
    cloneRange() { return Object.assign(new Range(), this); }
    getBoundingClientRect() { return { top: 100, bottom: 120, left: 20, width: 100, height: 20 }; }
  }
  doc.createRange = () => new Range();
  let selected = null;
  const selection = {
    get rangeCount() { return selected ? 1 : 0; },
    get isCollapsed() { return !selected || selected.collapsed; },
    getRangeAt: () => selected,
    removeAllRanges: () => { selected = null; },
    addRange: (r) => { selected = r; },
  };
  const context = {
    document: doc, window: { getSelection: () => selection, innerHeight: 900, innerWidth: 1200 },
    chrome: { storage: { local: storage }, runtime: {} }, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ overflowY: 'visible' }), setTimeout, clearTimeout,
    crypto: require('crypto').webcrypto, console,
  };
  vm.runInNewContext(source, context, { filename: 'highlights.js' });
  const api = context.__BTX.highlights;
  const article = doc.querySelector('article'), host = doc.querySelector('#host');
  const click = (node) => node.dispatchEvent({ type: 'click', bubbles: true });
  return {
    api, article,
    attach: () => api.attach(article, talkId, { host }),
    async offer(start, from, end = start, to = from + 5) {
      const r = doc.createRange(); r.setStart(start, from); r.setEnd(end, to);
      selection.addRange(r); article.dispatchEvent({ type: 'mouseup' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    apply: () => click(host.querySelector('.btx-hl-btn')),
    remove(id) {
      selection.removeAllRanges();
      click(Array.from(article.querySelectorAll('.btx-hl')).find((n) => n.getAttribute('data-hl-id') === id));
      click(host.querySelector('.btx-hl-btn'));
    },
    marks: () => Array.from(article.querySelectorAll('.btx-hl')).map((n) => ({ id: n.getAttribute('data-hl-id'), text: n.textContent })),
  };
}

function storage(seed = {}, modern = true) {
  const data = structuredClone(seed), pending = new Set();
  const gets = [];
  let writeCount = 0;
  function defer(task) {
    const p = new Promise((resolve) => setImmediate(() => { task(); resolve(); }));
    pending.add(p); p.then(() => pending.delete(p)); return p;
  }
  const api = {
    get(keys, callback) {
      gets.push(keys);
      return defer(() => {
        const selected = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
        callback(structuredClone(Object.fromEntries(selected.filter((k) => k in data).map((k) => [k, data[k]]))));
      });
    },
    set(values, callback) {
      writeCount++;
      const copy = structuredClone(values);
      return defer(() => { Object.assign(data, copy); if (callback) callback(); });
    },
  };
  if (modern) api.getKeys = (callback) => defer(() => callback(Object.keys(data)));
  return {
    api, data, gets,
    get writes() { return writeCount; },
    async settle() {
      for (let i = 0; i < 3 || pending.size; i++) {
        await Promise.all([...pending]); await new Promise(setImmediate);
      }
    },
  };
}
module.exports = { reader, storage };
