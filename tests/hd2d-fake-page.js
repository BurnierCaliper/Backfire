// HD-2D 原型页面（prototypes/hd2d/index.html）在 Node 里的「假网页」：
// 照页面的顺序跑垫片 → 规则文件 → 界面函数的空壳 → hd2d-layout.js，用来确认 app.js 的 init() 在原型页面里不报错。
//
//   const page = require("./hd2d-fake-page").load();
//   page.errors     // 加载过程中抛出的错误 / console.error
//   page.ctx        // 规则环境（BattleSim、HD2DLayout……）
//
// 假网页只模拟到「替身 div 会不会让代码报错」这个程度：
//   · getElementById 找到的、页面里写死的元素按真实标签来（div 没有 options / value；select 有 options）
//   · 代码自己用 innerHTML 生成的内容当成「什么都有」（浏览器会解析出真的元素，这里不重写一个 HTML 解析器）
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

const ROOT = path.resolve(__dirname, "..");
const PAGE = path.join(ROOT, "prototypes", "hd2d", "index.html");

/** innerHTML 生成的内容：什么属性都有、什么方法都能调（浏览器里它们是解析出来的真元素） */
function anything() {
  const store = {};
  return new Proxy(function () {}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => "";
      if (typeof k === "symbol") return undefined;
      if (k === "length") return 0;
      if (k === "then") return undefined;
      return anything();
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return anything(); }
  });
}

function makeDom(html) {
  const ids = new Map();
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1;
      this.childNodes = []; this.parentNode = null; this.style = {}; this.dataset = {};
      this._attrs = {}; this._html = ""; this._text = ""; this._parsed = false; this._classes = new Set();
      this.hidden = false; this.title = ""; this.scrollTop = 0; this.scrollLeft = 0;
      const self = this;
      this.classList = {
        add: (...c) => c.forEach(x => self._classes.add(String(x))),
        remove: (...c) => c.forEach(x => self._classes.delete(String(x))),
        toggle: (c, on) => { const v = on === undefined ? !self._classes.has(c) : !!on; if (v) self._classes.add(c); else self._classes.delete(c); return v; },
        contains: (c) => self._classes.has(c),
        replace: (a, b) => { if (!self._classes.has(a)) return false; self._classes.delete(a); self._classes.add(b); return true; },
        get length() { return self._classes.size; },
        forEach: (f) => [...self._classes].forEach(f)
      };
    }
    get id() { return this._attrs.id || ""; }
    set id(v) { this._attrs.id = String(v); ids.set(String(v), this); }
    get className() { return [...this._classes].join(" "); }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
    get childElementCount() { return this.children.length; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
    get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; }
    get nextElementSibling() { return this.nextSibling; }
    get parentElement() { return this.parentNode; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get innerHTML() { return this._html; }
    set innerHTML(v) {
      this._html = String(v); this.childNodes.length = 0; this._parsed = this._html.trim().length > 0;
      for (const m of this._html.matchAll(/\sid="([^"]+)"/g)) ids.set(m[1], anything());   // 生成的元素 getElementById 找得到
    }
    get outerHTML() { return "<" + this.tagName.toLowerCase() + ">" + this._html + "</" + this.tagName.toLowerCase() + ">"; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v == null ? "" : v); this.childNodes.length = 0; this._html = ""; this._parsed = false; }
    get innerText() { return this._text; }
    set innerText(v) { this.textContent = v; }
    insertAdjacentHTML(pos, h) { this._html += String(h); this._parsed = true; }
    appendChild(c) { if (c && c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c); if (c && typeof c === "object") { try { c.parentNode = this; } catch (e) {} } this.childNodes.push(c); return c; }
    append(...cs) { cs.forEach(c => this.appendChild(typeof c === "string" ? doc.createTextNode(c) : c)); }
    prepend(...cs) { cs.reverse().forEach(c => this.insertBefore(typeof c === "string" ? doc.createTextNode(c) : c, this.firstChild)); }
    insertBefore(c, ref) { const i = ref ? this.childNodes.indexOf(ref) : -1; if (c.parentNode && c.parentNode.removeChild) c.parentNode.removeChild(c); c.parentNode = this; if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c); return c; }
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); if (c) c.parentNode = null; return c; }
    replaceChild(n, o) { const i = this.childNodes.indexOf(o); if (i >= 0) { this.childNodes[i] = n; n.parentNode = this; o.parentNode = null; } return o; }
    replaceChildren(...cs) { this.childNodes.length = 0; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }
    cloneNode() { const c = new El(this.tagName); c._html = this._html; c._parsed = this._parsed; return c; }
    setAttribute(k, v) { k = String(k); this._attrs[k] = String(v); if (k === "id") ids.set(String(v), this); if (k === "class") this.className = v; }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    removeAttribute(k) { delete this._attrs[k]; }
    hasAttribute(k) { return k in this._attrs; }
    toggleAttribute(k, f) { const on = f === undefined ? !(k in this._attrs) : !!f; if (on) this._attrs[k] = ""; else delete this._attrs[k]; return on; }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
    querySelector() { return this._parsed ? anything() : null; }
    querySelectorAll() { return this._parsed ? [anything()] : []; }
    getElementsByTagName() { return this.querySelectorAll(); }
    getElementsByClassName() { return this.querySelectorAll(); }
    closest() { return null; }
    matches() { return false; }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    getClientRects() { return []; }
    focus() {} blur() {} click() {} scrollIntoView() {} scrollTo() {} scrollBy() {}
    animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
    get offsetWidth() { return 0; } get offsetHeight() { return 0; } get offsetTop() { return 0; } get offsetLeft() { return 0; }
    get clientWidth() { return 0; } get clientHeight() { return 0; } get scrollWidth() { return 0; } get scrollHeight() { return 0; }
  }
  /** 真的下拉框：options / value / selectedIndex 都有 */
  class Select extends El {
    get options() { return this.childNodes.filter(c => c.tagName === "OPTION"); }
    get selectedIndex() { return this.options.findIndex(o => o.selected); }
    get value() { const o = this.options.find(x => x.selected) || this.options[0]; return o ? o.value : ""; }
    set value(v) { this.options.forEach(o => { o.selected = o.value === String(v); }); }
  }
  class Option extends El {
    constructor() { super("option"); this.value = ""; this.selected = false; this.disabled = false; }
  }
  function Document() {}
  Document.prototype.getElementById = function (id) { return ids.get(String(id)) || null; };
  Document.prototype.createElement = function (tag) {
    const t = String(tag).toLowerCase();
    return t === "select" ? new Select("select") : t === "option" ? new Option() : new El(t);
  };
  Document.prototype.createTextNode = function (t) { return { nodeType: 3, textContent: String(t), parentNode: null }; };
  Document.prototype.createDocumentFragment = function () { return new El("#fragment"); };
  Document.prototype.querySelector = function () { return null; };
  Document.prototype.querySelectorAll = function () { return []; };
  Document.prototype.getElementsByTagName = function () { return []; };
  Document.prototype.addEventListener = function () {};
  Document.prototype.removeEventListener = function () {};
  Document.prototype.dispatchEvent = function () { return true; };
  const doc = new Document();
  doc.documentElement = new El("html");
  doc.head = new El("head"); doc.body = new El("body");
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.hidden = false; doc.readyState = "complete"; doc.visibilityState = "visible"; doc.title = "";
  doc.fonts = { ready: Promise.resolve(), load: () => Promise.resolve([]) };

  // 页面里写死的元素（不含脚本）：按标签建出来，挂到 body 下；下拉框带上它的 options
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const parents = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>([^<]*)/g)) {
    const [, close, tag, attrs, text] = m;
    const t = tag.toLowerCase();
    if (close) { if (parents.length && parents[parents.length - 1].tag === t) parents.pop(); continue; }
    if (["meta", "link", "br", "img", "input", "feturbulence", "fedisplacementmap", "fegaussianblur"].includes(t) || /\/\s*$/.test(attrs)) continue;
    const el = doc.createElement(t);
    const id = /\sid="([^"]+)"/.exec(attrs), val = /\svalue="([^"]*)"/.exec(attrs);
    if (id) el.id = id[1];
    if (t === "option") { el.value = val ? val[1] : text; el.textContent = text; }
    const parent = parents.length ? parents[parents.length - 1].el : doc.body;
    parent.appendChild(el);
    parents.push({ tag: t, el });
  }
  return { document: doc, Document, El };
}

function memoryStorageClass() {
  function Storage() { this._m = new Map(); }
  Storage.prototype.getItem = function (k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; };
  Storage.prototype.setItem = function (k, v) { this._m.set(String(k), String(v)); };
  Storage.prototype.removeItem = function (k) { this._m.delete(String(k)); };
  Storage.prototype.clear = function () { this._m.clear(); };
  Storage.prototype.key = function (i) { return [...this._m.keys()][i] || null; };
  Object.defineProperty(Storage.prototype, "length", { get() { return this._m.size; } });
  return Storage;
}

/** 照 index.html 的顺序加载：垫片 → 规则文件 → 界面函数的空壳 → hd2d-layout.js。opt.html 可以换一份页面（测试旧垫片用） */
function load(opt) {
  const html = (opt && opt.html) || fs.readFileSync(PAGE, "utf8");
  const dom = makeDom(html);
  const Storage = memoryStorageClass();
  const errors = [];
  const noop = () => {};
  const sandbox = {
    console: { log: noop, info: noop, warn: noop, debug: noop, error: (...a) => errors.push(a.map(String).join(" ")) },
    document: dom.document, Document: dom.Document, HTMLElement: dom.El, Element: dom.El, Node: dom.El,
    Storage, localStorage: new Storage(), sessionStorage: new Storage(),
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop, queueMicrotask: noop,
    matchMedia: () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    navigator: { userAgent: "node", language: "zh-CN", clipboard: { writeText: () => Promise.resolve() } },
    location: { href: "http://localhost/prototypes/hd2d/index.html", search: "", hash: "", pathname: "/prototypes/hd2d/index.html", origin: "http://localhost", reload: noop },
    history: { replaceState: noop, pushState: noop },
    performance: { now: () => Date.now() },
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    alert: noop, confirm: () => false, prompt: () => null,
    Event: function Event(type) { this.type = type; }, CustomEvent: function CustomEvent(type, o) { this.type = type; this.detail = o && o.detail; },
    MutationObserver: function () { return { observe: noop, disconnect: noop }; },
    ResizeObserver: function () { return { observe: noop, disconnect: noop }; },
    IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
    Math: Object.create(Math)
  };
  const listeners = {};
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.removeEventListener = noop;
  sandbox.dispatchEvent = () => true;
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = (src, filename) => {
    try { new vm.Script(src, { filename }).runInContext(ctx); }
    catch (e) { errors.push(filename + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
  };
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const shim = inline.find(s => s.includes("Document.prototype.getElementById"));
  const stubs = inline.find(s => s.includes("render[A-Z]"));
  run(shim, "index.html（垫片）");
  H.RULE_FILES.forEach(f => {
    if (fs.existsSync(path.join(ROOT, f))) run(fs.readFileSync(path.join(ROOT, f), "utf8"), f);
  });
  run(stubs, "index.html（界面函数空壳）");
  run(fs.readFileSync(path.join(ROOT, "prototypes", "hd2d", "hd2d-layout.js"), "utf8"), "hd2d-layout.js");
  // 顶层 const 不挂在 window 上（同 headless.js），页面主脚本用到的这个取出来
  try { ctx.BattleSim = vm.runInContext("BattleSim", ctx); } catch (e) { errors.push("BattleSim 没加载：" + e.message); }
  return { ctx, errors, listeners, document: dom.document };
}

module.exports = { load };
