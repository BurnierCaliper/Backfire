// 测试用的小 DOM（#297）：Node 里没有浏览器、仓库也不装 jsdom，这里做一个够用的——
//   · innerHTML 真的解析成元素（标签、属性、文字、SVG 的 <path/>），读回来再拼成 HTML；
//   · querySelector / querySelectorAll / closest / matches：标签、#id、.class、[属性]、[属性="值"]、:not(…)、:scope，后代（空格）和子（>）；
//   · 事件：捕获 → 目标 → 冒泡，stopPropagation / preventDefault，元素上的 onclick 之类也会调；被禁用的按钮 click() 不发事件（同浏览器）；
//   · dataset、classList、style（setProperty / getPropertyValue）、hidden / disabled / type / title 跟着属性走。
//
//   const { window, document } = require("./mini-dom").create(html);   // html = 页面 body 里的东西（脚本先去掉）
"use strict";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BOOL = ["hidden", "disabled", "checked", "selected", "readonly", "required", "multiple", "open"];
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", apos: "'", nbsp: " " };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|#x27|apos|nbsp);/g, (m, k) => ENT[k]).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)));
const encText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const encAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const camel = (s) => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, c => "-" + c.toLowerCase());

class Event {
  constructor(type, o) {
    o = o || {};
    Object.assign(this, o);
    this.type = type; this.bubbles = !!o.bubbles; this.cancelable = o.cancelable !== false;
    this.defaultPrevented = false; this._stop = false; this._stopNow = false; this.target = null; this.currentTarget = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._on = {}; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
  appendChild(c) { return this.insertBefore(c, null); }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === "string" ? this.ownerDocument.createTextNode(c) : c)); }
  insertBefore(c, ref) {
    if (c.nodeType === 11) { [...c.childNodes].forEach(x => this.insertBefore(x, ref)); return c; }
    if (ref && ref.parentNode !== this) throw new Error("NotFoundError: insertBefore 的参照节点不在这里");
    if (c.parentNode) c.parentNode.removeChild(c);
    if (ref) this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); else this.childNodes.push(c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error("NotFoundError: 不是它的子节点");
    this.childNodes.splice(i, 1); c.parentNode = null;
    return c;
  }
  replaceChild(n, o) { this.insertBefore(n, o); this.removeChild(o); return o; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent() { return this.childNodes.map(c => c.textContent).join(""); }
  set textContent(v) {
    this.childNodes.forEach(c => { c.parentNode = null; });
    this.childNodes = [];
    if (v != null && v !== "") this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  addEventListener(type, fn, opt) {
    if (typeof fn !== "function") return;
    const capture = opt === true || !!(opt && opt.capture);
    const list = this._on[type] || (this._on[type] = []);
    if (!list.some(l => l.fn === fn && l.capture === capture)) list.push({ fn, capture });
  }
  removeEventListener(type, fn, opt) {
    const capture = opt === true || !!(opt && opt.capture);
    this._on[type] = (this._on[type] || []).filter(l => !(l.fn === fn && l.capture === capture));
  }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    if (this.ownerDocument && this.ownerDocument.defaultView && path[path.length - 1] === this.ownerDocument) path.push(this.ownerDocument.defaultView);
    const call = (n, phase) => {
      ev.currentTarget = n;
      for (const l of (n._on && n._on[ev.type]) || []) {
        if (phase === "capture" && !l.capture) continue;
        if (phase === "bubble" && l.capture) continue;
        l.fn.call(n, ev);
        if (ev._stopNow) return;
      }
      if (phase !== "capture" && typeof n["on" + ev.type] === "function") n["on" + ev.type].call(n, ev);
    };
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) call(path[i], "capture");
    if (!ev._stop) call(this, "target");
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) call(path[i], "bubble");
    return !ev.defaultPrevented;
  }
}

class Text extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.nodeName = "#text"; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v == null ? "" : v); }
}

/** style：属性名用 CSS 的写法存（background、--el……），也能按 camelCase 读写 */
function makeStyle(el) {
  const map = new Map();
  const api = {
    setProperty(k, v) { map.set(String(k), String(v)); el._styleDirty = true; },
    getPropertyValue(k) { return map.has(String(k)) ? map.get(String(k)) : ""; },
    removeProperty(k) { const v = api.getPropertyValue(k); map.delete(String(k)); el._styleDirty = true; return v; },
    get cssText() { return [...map].map(([k, v]) => `${k}: ${v};`).join(" "); },
    set cssText(s) { map.clear(); parseInto(s); el._styleDirty = true; },
    _map: map
  };
  function parseInto(s) {
    String(s || "").split(";").forEach(part => {
      const i = part.indexOf(":");
      if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    });
  }
  api._parse = (s) => { map.clear(); parseInto(s); };
  return new Proxy(api, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === "string") return map.get(kebab(k)) || ""; return undefined; },
    set(t, k, v) { if (k in t) { t[k] = v; return true; } map.set(kebab(String(k)), String(v)); el._styleDirty = true; return true; }
  });
}

class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.nodeName = this.tagName;
    this._attrs = new Map();
    this._rawStyle = null;
    this._styleDirty = false;
    this.style = makeStyle(this);
    const self = this;
    this.dataset = new Proxy({}, {
      get(t, k) { return typeof k === "string" && self.hasAttribute("data-" + kebab(k)) ? self.getAttribute("data-" + kebab(k)) : undefined; },
      set(t, k, v) { self.setAttribute("data-" + kebab(String(k)), v); return true; },
      deleteProperty(t, k) { self.removeAttribute("data-" + kebab(String(k))); return true; },
      has(t, k) { return self.hasAttribute("data-" + kebab(String(k))); },
      ownKeys() { return [...self._attrs.keys()].filter(a => a.indexOf("data-") === 0).map(a => camel(a.slice(5))); },
      getOwnPropertyDescriptor(t, k) { return self.hasAttribute("data-" + kebab(String(k))) ? { enumerable: true, configurable: true, value: self.getAttribute("data-" + kebab(String(k))) } : undefined; }
    });
    this.classList = {
      add: (...cs) => { const s = self._classes(); cs.forEach(c => s.add(String(c))); self._setClasses(s); },
      remove: (...cs) => { const s = self._classes(); cs.forEach(c => s.delete(String(c))); self._setClasses(s); },
      toggle: (c, on) => { const s = self._classes(); const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); self._setClasses(s); return v; },
      contains: (c) => self._classes().has(String(c)),
      replace: (a, b) => { const s = self._classes(); if (!s.has(a)) return false; s.delete(a); s.add(b); self._setClasses(s); return true; },
      get length() { return self._classes().size; },
      forEach: (f) => [...self._classes()].forEach(f),
      [Symbol.iterator]: () => [...self._classes()][Symbol.iterator]()
    };
  }
  _classes() { return new Set(String(this.getAttribute("class") || "").split(/\s+/).filter(Boolean)); }
  _setClasses(s) { this.setAttribute("class", [...s].join(" ")); }
  getAttribute(k) {
    k = String(k).toLowerCase();
    if (k === "style") return this._styleDirty ? this.style.cssText : this._rawStyle;
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  setAttribute(k, v) {
    k = String(k).toLowerCase();
    if (k === "style") { this._rawStyle = String(v); this.style._parse(v); this._styleDirty = false; this._attrs.set(k, ""); return; }
    this._attrs.set(k, String(v));
  }
  removeAttribute(k) { k = String(k).toLowerCase(); this._attrs.delete(k); if (k === "style") { this._rawStyle = null; this.style._parse(""); this._styleDirty = false; } }
  hasAttribute(k) { return this._attrs.has(String(k).toLowerCase()); }
  toggleAttribute(k, f) { const on = f === undefined ? !this.hasAttribute(k) : !!f; if (on) this.setAttribute(k, ""); else this.removeAttribute(k); return on; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value: name === "style" ? this.getAttribute("style") : value })); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get title() { return this.getAttribute("title") || ""; }
  set title(v) { this.setAttribute("title", v); }
  get type() { return this.getAttribute("type") || (this.localName === "button" ? "submit" : ""); }
  set type(v) { this.setAttribute("type", v); }
  get value() { return this.getAttribute("value") || ""; }
  set value(v) { this.setAttribute("value", v); }
  get tabIndex() { return this.hasAttribute("tabindex") ? Number(this.getAttribute("tabindex")) : -1; }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  get nextElementSibling() { for (let n = this.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) return n; return null; }
  get previousElementSibling() { for (let n = this.previousSibling; n; n = n.previousSibling) if (n.nodeType === 1) return n; return null; }
  get innerHTML() { return this.childNodes.map(serialize).join(""); }
  set innerHTML(v) {
    this.childNodes.forEach(c => { c.parentNode = null; });
    this.childNodes = [];
    parseInto(this, String(v == null ? "" : v));
  }
  get outerHTML() { return serialize(this); }
  insertAdjacentHTML(pos, html) {
    const frag = this.ownerDocument.createElement("template-frag");
    frag.innerHTML = html;
    const nodes = [...frag.childNodes];
    if (pos === "beforeend") nodes.forEach(n => this.appendChild(n));
    else if (pos === "afterbegin") { const first = this.firstChild; nodes.forEach(n => this.insertBefore(n, first)); }
    else if (pos === "beforebegin") nodes.forEach(n => this.parentNode.insertBefore(n, this));
    else if (pos === "afterend") { const next = this.nextSibling; nodes.forEach(n => this.parentNode.insertBefore(n, next)); }
  }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  getElementsByClassName(c) { return queryAll(this, "." + c); }
  getElementsByTagName(t) { return queryAll(this, t); }
  matches(sel) { return parseList(sel).some(cx => matchComplex(this, cx, null)); }
  closest(sel) { const list = parseList(sel); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (list.some(cx => matchComplex(n, cx, null))) return n; return null; }
  click() {
    if (this.disabled && ["button", "input", "select", "textarea"].includes(this.localName)) return;
    this.dispatchEvent(new Event("click", { bubbles: true }));
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  scrollIntoView() {} scrollTo() {} scrollBy() {}
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  get offsetWidth() { return 0; } get offsetHeight() { return 0; } get offsetTop() { return 0; } get offsetLeft() { return 0; }
  get clientWidth() { return 0; } get clientHeight() { return 0; } get scrollWidth() { return 0; } get scrollHeight() { return 0; }
}
BOOL.forEach(k => Object.defineProperty(Element.prototype, k, {
  get() { return this.hasAttribute(k); },
  set(v) { if (v) this.setAttribute(k, ""); else this.removeAttribute(k); },
  configurable: true
}));
Object.defineProperty(Element.prototype, "scrollTop", { get() { return this._scrollTop || 0; }, set(v) { this._scrollTop = Number(v) || 0; }, configurable: true });

function serialize(n) {
  if (n.nodeType === 3) return encText(n.data);
  if (n.nodeType !== 1) return "";
  const attrs = n.attributes.map(a => ` ${a.name}="${encAttr(a.value == null ? "" : a.value)}"`).join("");
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${n.childNodes.map(serialize).join("")}</${n.localName}>`;
}

/** HTML → 节点（够测试用：标签、属性、文字、注释、自闭合的 SVG、void 元素；不处理省略结束标签之类的容错） */
function parseInto(parent, html) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === tag) { stack.length = i; break; }
      continue;
    }
    if (m[2]) {
      const el = doc.createElement(m[2]);
      for (const a of (m[3] || "").matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const v = a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : "";
        el.setAttribute(a[1], decode(v));
      }
      top().appendChild(el);
      if (!m[4] && !VOID.has(el.localName)) stack.push(el);
      continue;
    }
    if (m[5]) top().appendChild(doc.createTextNode(decode(m[5])));
  }
}

/* ---------- 选择器 ---------- */
const cache = new Map();
function parseList(sel) {
  sel = String(sel);
  if (cache.has(sel)) return cache.get(sel);
  const out = splitTop(sel, ",").map(s => parseComplex(s.trim())).filter(Boolean);
  cache.set(sel, out);
  return out;
}
/** 按逗号 / 空白拆，跳过 () 和 [] 里面的 */
function splitTop(s, ch) {
  const out = []; let depth = 0, cur = "", q = null;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
/** 一条选择器 → [{ comb: " " | ">" | null, parts }]（从左到右） */
function parseComplex(s) {
  const toks = [];
  let cur = "", depth = 0, q = null;
  const flush = () => { if (cur.trim()) toks.push(cur.trim()); cur = ""; };
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && (c === ">" || c === " " || c === "+" || c === "~")) {
      flush();
      if (c !== " ") toks.push(c);
      else if (toks.length && toks[toks.length - 1] !== " " && ![">", "+", "~"].includes(toks[toks.length - 1])) toks.push(" ");
      continue;
    }
    cur += c;
  }
  flush();
  const out = [];
  let comb = null;
  toks.forEach(t => {
    if (t === " " || t === ">" || t === "+" || t === "~") { comb = t; return; }
    out.push({ comb: out.length ? (comb || " ") : null, parts: parseCompound(t) });
    comb = null;
  });
  return out.length ? out : null;
}
function parseCompound(s) {
  const parts = [];
  const re = /(\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]|:not\(([^)]*)\)|:scope|([a-zA-Z][\w-]*)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) continue;
    if (m[2]) parts.push({ t: "id", v: m[2] });
    else if (m[3]) parts.push({ t: "cls", v: m[3] });
    else if (m[4]) parts.push({ t: "attr", k: m[4].toLowerCase(), v: m[5] != null ? m[5] : m[6] != null ? m[6] : m[7] != null ? m[7] : null });
    else if (m[8] != null) parts.push({ t: "not", list: parseList(m[8]) });
    else if (m[0] === ":scope") parts.push({ t: "scope" });
    else if (m[9]) parts.push({ t: "tag", v: m[9].toLowerCase() });
  }
  return parts;
}
function matchCompound(el, parts, scope) {
  if (!el || el.nodeType !== 1) return false;
  return parts.every(p => {
    if (p.t === "tag") return el.localName === p.v;
    if (p.t === "id") return el.id === p.v;
    if (p.t === "cls") return el.classList.contains(p.v);
    if (p.t === "attr") return el.hasAttribute(p.k) && (p.v == null || el.getAttribute(p.k) === p.v);
    if (p.t === "not") return !p.list.some(cx => matchComplex(el, cx, scope));
    if (p.t === "scope") return el === scope;
    return false;
  });
}
/** 从右往左：最后一节对上 el，前面的按 > / 空白往祖先找（带回溯） */
function matchComplex(el, cx, scope) {
  const step = (node, i) => {
    if (!matchCompound(node, cx[i].parts, scope)) return false;
    if (i === 0) return true;
    const comb = cx[i].comb;
    if (comb === ">") return step(node.parentNode, i - 1);
    if (comb === "+") return step(node.previousElementSibling, i - 1);
    if (comb === "~") { for (let s = node.previousElementSibling; s; s = s.previousElementSibling) if (step(s, i - 1)) return true; return false; }
    for (let a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) if (step(a, i - 1)) return true;
    return false;
  };
  return step(el, cx.length - 1);
}
function queryAll(root, sel, firstOnly) {
  const list = parseList(sel), out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (list.some(cx => matchComplex(c, cx, root))) { out.push(c); if (firstOnly) return true; }
      if (walk(c) && firstOnly) return true;
    }
    return false;
  };
  walk(root);
  return out;
}

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.nodeName = "#document";
    this.readyState = "complete";
    this.visibilityState = "visible";
    this.hidden = false;
    this.activeElement = null;
    this.defaultView = null;
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, t); }
  createDocumentFragment() { const f = new Element(this, "#fragment"); f.nodeType = 11; return f; }
  getElementById(id) { return queryAll(this.documentElement, "#" + id, true)[0] || (this.documentElement.id === id ? this.documentElement : null); }
  querySelector(sel) { return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return queryAll(this.documentElement, sel); }
  getElementsByClassName(c) { return this.querySelectorAll("." + c); }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
}

/** 一个页面：document（body 里放 html）、window（document / 事件 / 计时器 / localStorage……都挂上，可以直接当 vm 的上下文） */
function create(html, opts) {
  opts = opts || {};
  const document = new Document();
  if (html) document.body.innerHTML = String(html).replace(/<script[\s\S]*?<\/script>/g, "");
  const mem = new Map();
  const noop = () => {};
  const window = {
    document, Event, KeyboardEvent: Event, MouseEvent: Event, CustomEvent: Event, Node, Element, HTMLElement: Element, Text,
    localStorage: opts.storage || { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: (fn) => { fn(0); return 0; }, cancelAnimationFrame: noop, queueMicrotask,
    matchMedia: (q) => ({ matches: !!(opts.media && opts.media(q)), media: q, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => "", position: "static", rowGap: "0", paddingTop: "0", paddingBottom: "0" }),
    navigator: { userAgent: "node", language: "zh-CN" },
    location: { href: "http://localhost/game.html", search: "", hash: "", pathname: "/game.html", origin: "http://localhost" },
    console, Math, JSON, Date, Promise, Map, Set, WeakMap, Array, Object, String, Number, Boolean, RegExp, Error, Symbol, Proxy, Reflect,
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1
  };
  window._on = {};
  window.addEventListener = Node.prototype.addEventListener.bind(window);
  window.removeEventListener = Node.prototype.removeEventListener.bind(window);
  window.window = window; window.self = window; window.globalThis = window;
  document.defaultView = window;
  return { window, document, Event };
}

/** 按一下键：从 target（默认 body）发 keydown，冒泡到 document / window */
function key(document, k, o) {
  const ev = new Event("keydown", Object.assign({ bubbles: true, key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, o || {}));
  ((o && o.target) || document.body).dispatchEvent(ev);
  return ev;
}

/**
 * 记下 roots（一个或几个节点）里面元素的每一次改动（#317：技能栏 / 队伍栏有没有被整块重画）：
 * log = [[种类, 节点]]，种类是 setAttribute / removeAttribute / insertBefore / removeChild / innerHTML（节点 = 被改的那个；插入 / 拿掉记在父节点上）。
 * 文字节点改字不记（看节点还是不是原来那个）。元素的类是所有页面共用的：用完一定要 stop()
 */
function watch(roots) {
  const list = [].concat(roots).filter(Boolean);
  const inside = (n) => list.some(r => r.contains(n));
  const log = [], undo = [];
  const wrap = (proto, name) => {
    const f = proto[name];
    proto[name] = function () { if (inside(this)) log.push([name, this]); return f.apply(this, arguments); };
    undo.push(() => { proto[name] = f; });
  };
  ["setAttribute", "removeAttribute"].forEach(n => wrap(Element.prototype, n));
  ["insertBefore", "removeChild"].forEach(n => wrap(Node.prototype, n));
  const ih = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get: ih.get, set(v) { if (inside(this)) log.push(["innerHTML", this]); ih.set.call(this, v); } });
  undo.push(() => Object.defineProperty(Element.prototype, "innerHTML", ih));
  return { log, clear: () => { log.length = 0; }, stop: () => undo.reverse().forEach(f => f()) };
}

module.exports = { create, key, Event, serialize, watch };
