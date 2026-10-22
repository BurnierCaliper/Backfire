// 测试用的小 CSS 层叠（#297）：Node 里没有浏览器，这里照 CSS 的规矩算「这个元素最后用的是哪一条规则的哪个值」——
//   · 解析：最外层的规则和 @media 里的规则（@keyframes / @font-face 之类整块跳过）；注释去掉，字符串、括号里的分号 / 逗号不拆；
//   · @media：按给的视口算 min-width / max-width / min-height / max-height、and、逗号、not；减少动态效果、深色模式、打印这些按桌面浏览器的默认（不成立），
//            hover / pointer 按 vp.touch；
//   · 选择器：:is(…) / :where(…) 先展开成几条，再交给 mini-dom 的 matches（标签、#id、.class、[属性]、:not(…)、空格 / > / + / ~）；
//            :hover / :focus 这类状态、::before 这类伪元素不算（画面静止时不套）；别的伪类、[属性*=…] 小 DOM 认不得——这种规则要是去掉伪类就对得上，
//            记在 unknown 里（测试自己决定要不要管），不当成套上了；
//   · 谁赢：!important > 优先级（id, 类 / 属性 / 伪类, 标签；:not / :is 按里面最高的一条，:where 算 0）> 后写的。行内 style 不管（测的是样式表里的规则）。
//
//   const C = require("./mini-css");
//   const rules = C.load([["game.css", text], ...]);
//   const cs = C.computed(el, rules, { width: 1440, height: 900 });
//   cs.get("padding-left")   // 照 CSS 的规矩，简写（padding / margin / inset / gap / flex）和分开写的谁强用谁
//   cs.map                   // 属性 → { value, important, spec, order, sel, file }（只按写出来的属性名记）
//   cs.unknown               // 小 DOM 判断不了、可能套上的规则
"use strict";

/** 按 ch 拆（括号、方括号、字符串里面的不拆） */
function splitTop(s, ch) {
  const out = []; let depth = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "\\") { cur += s[++i] || ""; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === ch && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** 和 i 处的 { 配对的 }（跳过字符串） */
function closeOf(s, i) {
  let depth = 0, q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("CSS 的大括号没配上");
}

/** 规则里的声明：[{ prop, value, important }]（按写的顺序） */
function declsOf(body) {
  const out = [];
  splitTop(body, ";").forEach(d => {
    const i = d.indexOf(":");
    if (i <= 0) return;
    const prop = d.slice(0, i).trim().toLowerCase();
    let value = d.slice(i + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    if (prop && value) out.push({ prop, value, important });
  });
  return out;
}

/** 一份 CSS → 规则 [{ sel, decls, media: [@media 后面的条件……], file }] */
function parse(text, file, media) {
  const s = String(text).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("{", i);
    if (open < 0) break;
    const prelude = s.slice(i, open).split(";").pop().trim();   // 前面要是有 @charset 之类的一句话，不算进选择器
    const close = closeOf(s, open);
    const body = s.slice(open + 1, close);
    if (/^@media\b/i.test(prelude)) parse(body, file, (media || []).concat([prelude.replace(/^@media\s*/i, "")])).forEach(r => out.push(r));
    else if (prelude && prelude[0] !== "@") out.push({ sel: prelude, decls: declsOf(body), media: media || [], file });
    i = close + 1;
  }
  return out;
}
/** 几份 CSS 按顺序接起来（后面的同优先级压前面的）：files = [[文件名, 内容], ...] */
function load(files) {
  const out = [];
  files.forEach(([file, text]) => parse(text, file).forEach(r => out.push(r)));
  out.forEach((r, k) => { r.order = k; });
  return out;
}

/** @media 的条件在这个视口下成不成立：vp = { width, height, touch } */
function mediaOk(q, vp) {
  return splitTop(q, ",").some(part => {
    part = part.trim().toLowerCase().replace(/^only\s+/, "");
    if (!part) return false;
    const neg = /^not\s+/.test(part);
    if (neg) part = part.replace(/^not\s+/, "");
    const ok = part.split(/\s+and\s+/).every(c => {
      c = c.trim();
      if (c === "screen" || c === "all") return true;
      const m = /^\(\s*([\w-]+)\s*(?::\s*([^)]+))?\)$/.exec(c);
      if (!m) return false;
      const k = m[1], v = (m[2] || "").trim(), px = parseFloat(v);
      if (k === "min-width") return vp.width >= px;
      if (k === "max-width") return vp.width <= px;
      if (k === "min-height") return vp.height >= px;
      if (k === "max-height") return vp.height <= px;
      if (k === "orientation") return v === (vp.height > vp.width ? "portrait" : "landscape");
      if (k === "hover" || k === "any-hover") return v === (vp.touch ? "none" : "hover");
      if (k === "pointer" || k === "any-pointer") return v === (vp.touch ? "coarse" : "fine");
      return false;   // prefers-reduced-motion、prefers-color-scheme、print……：桌面浏览器默认不成立
    });
    return neg ? !ok : ok;
  });
}

/** 选择器里第一个 :name( 和它配对的 )：{ name, start, open, close } */
function pseudoFn(sel, names) {
  const re = new RegExp(":(" + names + ")\\(", "g");
  const m = re.exec(sel);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0, i = open;
  for (; i < sel.length; i++) { if (sel[i] === "(") depth++; else if (sel[i] === ")" && --depth === 0) break; }
  return { name: m[1], start: m.index, open, close: i };
}
const cmpSpec = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
/** 一条选择器（不带逗号）的优先级 [id, 类 / 属性 / 伪类, 标签 / 伪元素] */
function specificity(sel) {
  let a = 0, b = 0, c = 0, s = String(sel);
  for (let f; (f = pseudoFn(s, "not|is|where|has|matches")); ) {
    if (f.name !== "where") {
      const best = splitTop(s.slice(f.open + 1, f.close), ",").map(x => specificity(x.trim())).sort(cmpSpec).pop() || [0, 0, 0];
      a += best[0]; b += best[1]; c += best[2];
    }
    s = s.slice(0, f.start) + s.slice(f.close + 1);
  }
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ""; });
  s = s.replace(/::[\w-]+/g, () => { c++; return ""; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ""; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ""; });
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { b++; return ""; });
  s.replace(/(^|[\s>+~])([a-zA-Z][\w-]*)/g, () => { c++; return ""; });
  return [a, b, c];
}
/** :is(a, b) / :where(…) 展开成几条（小 DOM 不认 :is） */
function expand(sel) {
  const f = pseudoFn(sel, "is|where|matches");
  if (!f) return [sel];
  const head = sel.slice(0, f.start), tail = sel.slice(f.close + 1);
  return splitTop(sel.slice(f.open + 1, f.close), ",").flatMap(x => expand(head + x.trim() + tail));
}
const STATE = /::|:(hover|active|focus|focus-visible|focus-within|visited|link|target)\b/;
const NOT_ARG = /:not\((?:[^()]|\([^()]*\))*\)/g;
/** 小 DOM 认不得的：:not 以外的伪类、[属性*=…] 之类 */
function unsupported(sel) {
  if (/\[[^\]]*[*^$~|]=/.test(sel)) return true;
  let bad = false;
  const rest = sel.replace(NOT_ARG, (m) => { if (unsupported(m.slice(5, -1))) bad = true; return ""; });
  return bad || /:[\w-]+/.test(rest);
}
const stripPseudo = (sel) => sel.replace(NOT_ARG, "").replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, "").replace(/\[([\w-]+)[*^$~|]=[^\]]*\]/g, "[$1]");
function matches(el, sel) { try { return el.matches(sel); } catch (e) { return false; } }

/* ---------- 简写和分开写的（只管测试里看的几种）---------- */
const SIDES = ["top", "right", "bottom", "left"];
/** 1 ~ 4 个值 → 上右下左 */
function sides(v) {
  const p = splitTop(String(v).trim(), " ").filter(Boolean);
  const [t, r = t, b = t, l = r] = p;
  return { top: t, right: r, bottom: b, left: l };
}
/** 分开写的属性 → [简写, 从简写的值里取这一项] */
function shorthandOf(prop) {
  let m = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
  if (m) return [m[1], (v) => sides(v)[m[2]]];
  if (SIDES.includes(prop)) return ["inset", (v) => sides(v)[prop]];
  if (prop === "row-gap" || prop === "column-gap") return ["gap", (v) => { const p = splitTop(String(v).trim(), " ").filter(Boolean); return prop === "row-gap" ? p[0] : (p[1] || p[0]); }];
  m = /^flex-(grow|shrink|basis)$/.exec(prop);
  if (m) {
    return ["flex", (v) => {
      const p = splitTop(String(v).trim(), " ").filter(Boolean);
      if (p[0] === "none") return { grow: "0", shrink: "0", basis: "auto" }[m[1]];
      if (p[0] === "auto") return { grow: "1", shrink: "1", basis: "auto" }[m[1]];
      const nums = p.filter(x => /^[\d.]+$/.test(x)), basis = p.find(x => !/^[\d.]+$/.test(x));
      return { grow: nums[0] || "1", shrink: nums[1] || "1", basis: basis || (p.length === 1 ? "0%" : "0%") }[m[1]];
    }];
  }
  return null;
}
const beats = (x, y) => (x.important !== y.important ? x.important : (cmpSpec(x.spec, y.spec) || (x.order - y.order)) >= 0);

/**
 * 这个元素在视口 vp 下套上的规则，按 CSS 的规矩挑出每个属性赢的那一条。
 * 返回 { map: 属性 → { value, important, spec, order, sel, file }, get(prop)（简写一起比）, unknown: [{ sel, file }] }
 */
function computed(el, rules, vp) {
  const map = new Map(), unknown = [];
  rules.forEach(r => {
    if (!r.media.every(m => mediaOk(m, vp))) return;
    let best = null;
    splitTop(r.sel, ",").forEach(one => {
      one = one.trim();
      if (!one || STATE.test(one)) return;
      const spec = specificity(one);
      for (const v of expand(one)) {
        if (unsupported(v)) { if (matches(el, stripPseudo(v))) unknown.push({ sel: one, file: r.file }); continue; }
        if (matches(el, v)) { if (!best || cmpSpec(spec, best.spec) > 0) best = { sel: one, spec }; break; }
      }
    });
    if (!best) return;
    r.decls.forEach(d => {
      const cand = { value: d.value, important: d.important, spec: best.spec, order: r.order, sel: best.sel, file: r.file };
      const cur = map.get(d.prop);
      if (!cur || beats(cand, cur)) map.set(d.prop, cand);
    });
  });
  function get(prop) {
    const own = map.get(prop), sh = shorthandOf(prop), short = sh ? map.get(sh[0]) : null;
    if (short && (!own || beats(short, own))) return sh[1](short.value);
    return own ? own.value : undefined;
  }
  return { map, get, unknown };
}

module.exports = { parse, load, mediaOk, specificity, expand, computed, splitTop };
