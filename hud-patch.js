/* Antlerscale: Backfire · 技能栏 / 队伍栏按需更新（#317）
 *
 * 主人反馈新画面选技能时画面一闪一闪：以前每画一遍都把技能栏、队伍栏整块换 innerHTML——按钮、头像、贴纸 SVG 全部重新解析，
 * 悬停状态丢掉，说明框、纸片画面贴的纸纹（online-paper.js · dress）跟着重来。这里给 game.js（单机）、online-battle.js（联机玩家）用：
 *   HudPatch.html(el, html, o)   把 el 里面改成 html：同样的节点留着，只改变了的属性 / 文字；多的加上、少的拿掉，标签不一样的那一个才换。
 *                                o.key = 子元素按哪个属性对上（例 "data-ob-skill"：同一个技能还是同一个按钮，换了位置就挪过去）。
 *                                和上一次给这个 el 的 html 一样：什么都不碰。第一次（里面的东西不是这里画的）照旧整块换一次。返回动过没有
 * 别的代码后来挂上的属性（纸片画面的 data-olp-tex、style 里的纸纹）不碰：只拿掉这里上次写过、这次没有的。
 * 改完读回来的 HTML 和整块重画的一样（属性顺序也照新的排）。Node 里能 require（tests/hud-patch.test.js 用 tests/mini-dom.js 跑） */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HudPatch = api;
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /** 记在节点上的：上一次给的 html（MEMO）、这里写过的属性（OWN） */
  const MEMO = "__hudHtml", OWN = "__hudOwn";

  const names = (n) => Array.from(n.attributes || [], a => a.name);
  /** 这里挂上去的节点：记下哪些属性是这里写的（以后只拿掉这些） */
  function own(n) {
    if (n.nodeType !== 1) return;
    n[OWN] = names(n);
    Array.from(n.childNodes).forEach(own);
  }
  const keyOf = (n, key) => (key && n.nodeType === 1 && n.hasAttribute(key) ? n.getAttribute(key) : null);
  const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.nodeName === b.nodeName && a.namespaceURI === b.namespaceURI));

  /** o 的属性改成 n 的：变了的才写；这里上次写过、这次没有的拿掉；别人挂上的不碰。顺序和 n 不一样时按 n 的顺序重写一遍 */
  function patchAttrs(o, n) {
    const want = names(n);
    (o[OWN] || []).forEach(k => { if (want.indexOf(k) < 0 && o.hasAttribute(k)) o.removeAttribute(k); });
    const have = names(o).filter(k => want.indexOf(k) >= 0);
    const order = have.concat(want.filter(k => have.indexOf(k) < 0));
    if (order.some((k, i) => k !== want[i])) want.forEach(k => { if (o.hasAttribute(k)) o.removeAttribute(k); });
    want.forEach(k => { const v = n.getAttribute(k); if (o.getAttribute(k) !== v) o.setAttribute(k, v); });
    o[OWN] = want;
  }
  function patchNode(o, n) {
    if (o.nodeType !== 1) { if (o.data !== n.data) o.data = n.data; return; }
    patchAttrs(o, n);
    patchKids(o, n, null);
  }
  /** live 的子节点改成和 next 的一样：按 key（没有 key 的按位置）对上的留着改，对不上的用 next 里的新节点（直接挪过去） */
  function patchKids(live, next, key) {
    const want = Array.from(next.childNodes);
    const pool = new Map();
    if (key) Array.from(live.childNodes).forEach(c => { const k = keyOf(c, key); if (k != null && !pool.has(k)) pool.set(k, c); });
    let at = 0;
    want.forEach(n => {
      const here = live.childNodes[at] || null, k = keyOf(n, key);
      let o = null;
      if (k != null) { o = pool.get(k) || null; pool.delete(k); }
      else if (here && keyOf(here, key) == null) o = here;
      if (o && same(o, n)) {
        patchNode(o, n);
        if (o !== here) live.insertBefore(o, here);
      } else {
        own(n);
        live.insertBefore(n, here);
      }
      at++;
    });
    while (live.childNodes.length > at) live.removeChild(live.lastChild);
  }

  /** el 里面改成 html（见文件头）。o = { key }。返回动过没有 */
  function html(el, h, o) {
    if (!el) return false;
    h = String(h == null ? "" : h);
    if (el[MEMO] === h) return false;
    const first = el[MEMO] === undefined;
    el[MEMO] = h;
    if (first) {
      // 第一次：里面原来的东西不是这里画的（页面里写好的、别处 innerHTML 的），和以前一样整块换一次
      el.innerHTML = h;
      Array.from(el.childNodes).forEach(own);
      return true;
    }
    const doc = el.ownerDocument || root.document;
    const t = doc.createElement("template");
    t.innerHTML = h;
    patchKids(el, t.content || t, (o && o.key) || null);
    return true;
  }

  return { html };
});
