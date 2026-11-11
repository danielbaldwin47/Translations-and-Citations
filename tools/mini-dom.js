/*
 * A minimal DOM for Node, so tools/test-talk-source.js can run talk-view's
 * render() and talk-source's findTarget over real talk markup and check the
 * render contract (CLAUDE.md, "Reader scroll targets by corpus").
 *
 * install() sets globalThis.document, DOMParser and NodeFilter. It covers what
 * those two modules call and no more: parsing well-formed HTML (void
 * elements, an open <p> closed by a block, entities), element and text
 * nodes, attributes, classList, textContent, appendChild / insertBefore,
 * matches / closest / querySelector(All), and a SHOW_TEXT tree walker.
 * Selectors are comma lists of compound simple selectors: tag, #id, .class,
 * [attr="value"]. Anything else throws, so a test never passes on a selector
 * this file does not understand.
 *
 * Test-only: never loaded by the extension (tools/ is not in the Store zip).
 */
'use strict';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'wbr']);
const CLOSES_P = new Set(['p', 'div', 'ul', 'ol', 'li', 'dl', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'pre', 'section', 'article', 'header', 'footer', 'figure', 'hr']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : all;
  });
}

class Node {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get textContent() {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    if (this.nodeType === 3) { this.nodeValue = String(v); return; }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v != null && v !== '') this.appendChild(new Text(String(v)));
  }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new Text(n) : n); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  querySelectorAll(selector) {
    const sels = parseSelectors(selector);
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (sels.some((s) => matchCompound(c, s))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class Text extends Node {
  constructor(value) { super(3); this.nodeValue = value; }
}

class Element extends Node {
  constructor(tag) {
    super(1);
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => { const l = list(); for (const c of cs) if (!l.includes(c)) l.push(c); this.className = l.join(' '); },
      remove: (...cs) => { this.className = list().filter((c) => !cs.includes(c)).join(' '); },
    };
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  matches(selector) { return parseSelectors(selector).some((s) => matchCompound(this, s)); }
  closest(selector) {
    const sels = parseSelectors(selector);
    for (let e = this; e; e = e.parentElement) if (sels.some((s) => matchCompound(e, s))) return e;
    return null;
  }
}

class Document extends Node {
  constructor() { super(9); }
  get documentElement() { return this.childNodes.find((c) => c.nodeType === 1) || null; }
  get body() { return this.documentElement && this.documentElement.querySelector('body'); }
  createElement(tag) { return new Element(tag); }
  createTextNode(value) { return new Text(String(value)); }
  createTreeWalker(rootNode, whatToShow) {
    if (whatToShow !== NodeFilter.SHOW_TEXT) throw new Error('mini-dom: only SHOW_TEXT tree walkers');
    const texts = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) texts.push(c); else walk(c); } };
    walk(rootNode);
    let i = 0;
    return { nextNode: () => texts[i++] || null };
  }
}

const NodeFilter = { SHOW_TEXT: 4 };

// 'p, .a.b, [id="x"]' -> [{ tag, id, classes, attrs }]
function parseSelectors(selector) {
  return String(selector).split(',').map((part) => {
    const s = part.trim();
    const out = { tag: null, id: null, classes: [], attrs: [] };
    const re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)="((?:[^"\\]|\\.)*)"\]/y;
    let at = 0;
    while (at < s.length) {
      re.lastIndex = at;
      const m = re.exec(s);
      if (!m || (m[1] && at > 0)) throw new Error(`mini-dom: unsupported selector "${s}"`);
      if (m[1]) out.tag = m[1].toUpperCase();
      else if (m[2]) out.id = m[2];
      else if (m[3]) out.classes.push(m[3]);
      else out.attrs.push([m[4], m[5].replace(/\\(.)/g, '$1')]);
      at = re.lastIndex;
    }
    if (!s) throw new Error('mini-dom: empty selector');
    return out;
  });
}

function matchCompound(el, s) {
  if (s.tag && el.tagName !== s.tag) return false;
  if (s.id && el.id !== s.id) return false;
  for (const c of s.classes) if (!el.classList.contains(c)) return false;
  for (const [name, value] of s.attrs) if (el.getAttribute(name) !== value) return false;
  return true;
}

function parseAttrs(el, src) {
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let m; (m = re.exec(src));) {
    const v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
    el.setAttribute(m[1].toLowerCase(), decode(v));
  }
}

// HTML -> Document with html > head + body, as a browser builds it.
function parseHtml(html) {
  const doc = new Document();
  const top = new Element('#fragment');
  const stack = [top];
  const current = () => stack[stack.length - 1];
  const TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  for (let m; (m = TOKEN.exec(html));) {
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (CLOSES_P.has(tag) && current().tagName === 'P') stack.pop();
      const el = new Element(tag);
      const selfClosing = /\/\s*$/.test(m[3]);
      parseAttrs(el, selfClosing ? m[3].replace(/\/\s*$/, '') : m[3]);
      current().appendChild(el);
      if (!VOID.has(tag) && !selfClosing) stack.push(el);
    } else if (m[4] != null || m[0] === '<') {
      current().appendChild(new Text(decode(m[4] != null ? m[4] : '<')));
    }
  }
  let htmlEl = top.children.find((c) => c.tagName === 'HTML');
  if (!htmlEl) {
    htmlEl = new Element('html');
    htmlEl.appendChild(new Element('head'));
    const body = new Element('body');
    for (const c of top.childNodes.slice()) body.appendChild(c);
    htmlEl.appendChild(body);
  }
  doc.appendChild(htmlEl);
  return doc;
}

class DOMParser {
  parseFromString(html) { return parseHtml(String(html)); }
}

function install() {
  globalThis.document = new Document();
  globalThis.DOMParser = DOMParser;
  globalThis.NodeFilter = NodeFilter;
}

module.exports = { install, parseHtml };
