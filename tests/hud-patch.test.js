// 技能栏 / 队伍栏按需更新（#317，hud-patch.js）：HudPatch.html 把一块里面改成新的 HTML 时，同样的节点留着、只改变了的属性 / 文字；
// 按 key 对上的子元素换了位置就挪过去；别人后来挂上的属性（纸片画面的纸纹 data-olp-tex、style）不碰；读回来的 HTML 和整块重画的一样。
// 在 Node 里跑：tests/mini-dom.js 的小 DOM，DOM 的每一次改动都记下来（只数这一块里面的）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const MD = require("./mini-dom");
const HP = require("../hud-patch.js");

/** 一个页面、一块挂在 body 上的 div */
function page() {
  const P = MD.create("");
  const box = P.document.createElement("div");
  P.document.body.appendChild(box);
  return { P, doc: P.document, box };
}
/** 整块重画出来是什么样（比较读回来的 HTML 用） */
function fresh(doc, html) { const d = doc.createElement("div"); d.innerHTML = html; return d.innerHTML; }
/** 记下 live 里面元素的每一次改动（tests/mini-dom.js · watch）：[种类, 节点]；文字节点改字不记，看节点还是不是原来那个。stop() 收工 */
const watch = (P, live) => MD.watch(live);
/** 改动记录读成 [种类, 是不是这个节点]（直接比节点 deepEqual 太慢） */
const kinds = (log, node) => log.map(([k, n]) => [k, n === node]);

const BTN = (id, o) => {
  o = o || {};
  return `<button type="button" class="sk${o.armed ? " armed" : ""}" data-ob-skill="${id}"${o.disabled ? " disabled" : ""}${o.title ? ` title="${o.title}"` : ""} aria-label="${id}">` +
    `<span class="sk-el" style="color:#ff5b2e"><svg class="eicon" viewBox="0 0 48 48"><g class="c"><path d="M1 1L2 2"/></g></svg></span><span class="nm">${o.name || id}</span><span class="cost">${o.cost || "行动 1"}</span></button>`;
};
const BAR = (list) => list.map(x => (typeof x === "string" ? BTN(x) : BTN(x.id, x))).join("");

test("HudPatch.html：第一次和整块换 innerHTML 一样；同样的 HTML 再给一遍什么都不碰", () => {
  const { P, doc, box } = page();
  box.innerHTML = "<p>页面里原来写好的</p>";
  const html = BAR(["a", "b", "c"]);
  assert.equal(HP.html(box, html, { key: "data-ob-skill" }), true);
  assert.equal(box.innerHTML, fresh(doc, html), "第一次：和整块重画一样");
  const kids = [...box.children];
  const W = watch(P, box);
  try {
    assert.equal(HP.html(box, html, { key: "data-ob-skill" }), false, "一样：返回没动");
    assert.deepEqual(W.log, [], "一样：DOM 一下都没碰");
  } finally { W.stop(); }
  assert.deepEqual([...box.children], kids);
  assert.equal(HP.html(null, html), false, "没有节点不报错");
});

test("HudPatch.html：只有一个按钮选中了 → 按钮都是原来那几个，只改了那一个的 class；别的按钮、里面的图标一下都没碰", () => {
  const { P, doc, box } = page();
  HP.html(box, BAR(["a", "b", "c"]), { key: "data-ob-skill" });
  const [a, b, c] = box.children, svgA = a.querySelector("svg"), pathA = a.querySelector("path");
  const W = watch(P, box);
  let log;
  try { HP.html(box, BAR(["a", { id: "b", armed: true }, "c"]), { key: "data-ob-skill" }); log = W.log.slice(); } finally { W.stop(); }
  assert.deepEqual([...box.children], [a, b, c], "还是同样三个按钮");
  assert.equal(a.querySelector("svg"), svgA, "图标还是原来那个");
  assert.equal(a.querySelector("path"), pathA);
  assert.ok(b.classList.contains("armed"));
  assert.deepEqual(kinds(log, b), [["setAttribute", true]], "只写了一次：b 的 class");
  assert.equal(box.innerHTML, fresh(doc, BAR(["a", { id: "b", armed: true }, "c"])), "读回来和整块重画的一样");
});

test("HudPatch.html：费用 / 名字的字变了 → 只改那一个文字节点；按 key 对上的按钮换了顺序挪过去、多的加上、少的拿掉", () => {
  const { P, doc, box } = page();
  HP.html(box, BAR(["a", "b", "c"]), { key: "data-ob-skill" });
  const [a, b, c] = box.children, costB = b.querySelector(".cost").firstChild;
  const W = watch(P, box);
  let log;
  try { HP.html(box, BAR(["a", { id: "b", cost: "附赠 1" }, "c"]), { key: "data-ob-skill" }); log = W.log.slice(); } finally { W.stop(); }
  assert.deepEqual(log, [], "元素一个都没碰（没换属性、没插入 / 拿掉节点）");
  assert.equal(b.querySelector(".cost").firstChild, costB, "费用还是那个文字节点，只改了字");
  assert.equal(b.querySelector(".cost").textContent, "附赠 1");
  // 换顺序、拿掉 b、加上 d
  HP.html(box, BAR(["c", "d", "a"]), { key: "data-ob-skill" });
  const kids = [...box.children];
  assert.equal(kids[0], c, "c 挪到最前（同一个节点）");
  assert.equal(kids[2], a, "a 挪到最后（同一个节点）");
  assert.ok(kids[1] !== b && kids[1].dataset.obSkill === "d", "d 是新的");
  assert.ok(!b.isConnected, "b 拿掉了");
  assert.equal(box.innerHTML, fresh(doc, BAR(["c", "d", "a"])));
});

test("HudPatch.html：自己写过、这次没有的属性拿掉（disabled、title）；别人后来挂上的（纸片画面的 data-olp-tex、style 里的纸纹）不碰；属性顺序跟着新的走", () => {
  const { doc, box } = page();
  HP.html(box, BAR(["a", "b"]), { key: "data-ob-skill" });
  const [a] = box.children;
  // 纸片画面（online-paper.js · dress）贴纸纹：data-olp-tex、style 里的 --olp-tex
  a.dataset.olpTex = "tag";
  a.style.setProperty("--olp-tex", 'url("x")');
  // 正在同步：按钮都灰掉、写原因（disabled / title 插在 aria-label 前面）
  const busy = BAR([{ id: "a", disabled: true, title: "正在同步，请稍候" }, { id: "b", disabled: true, title: "正在同步，请稍候" }]);
  HP.html(box, busy, { key: "data-ob-skill" });
  assert.equal(box.children[0], a, "还是同一个按钮");
  assert.ok(a.disabled && a.title === "正在同步，请稍候");
  assert.equal(a.dataset.olpTex, "tag", "纸纹的标记还在");
  assert.equal(a.style.getPropertyValue("--olp-tex"), 'url("x")', "纸纹还在");
  const own = (n) => n.attributes.map(x => x.name).filter(k => !/olp|style/.test(k));
  const want = (html) => { const d = doc.createElement("div"); d.innerHTML = html; return d.firstElementChild.attributes.map(x => x.name); };
  assert.deepEqual(own(a), want(busy), "属性顺序和整块重画的一样");
  // 同步完：disabled / title 拿掉，纸纹照旧
  HP.html(box, BAR(["a", "b"]), { key: "data-ob-skill" });
  assert.ok(!a.hasAttribute("disabled") && !a.hasAttribute("title"), "自己写过的拿掉");
  assert.equal(a.dataset.olpTex, "tag");
  assert.equal(a.style.getPropertyValue("--olp-tex"), 'url("x")');
  assert.equal(box.children[1].innerHTML, fresh(doc, BTN("b")).replace(/^<button[^>]*>|<\/button>$/g, ""), "里面照旧");
});

test("HudPatch.html：标签不一样的只换那一个；没有 key 的（「正在取技能…」）和有 key 的按钮来回换也对；嵌在里面的 SVG 只改变了的属性", () => {
  const { doc, box } = page();
  const wait = '<p class="ol-muted">正在取技能…</p>';
  HP.html(box, wait, { key: "data-ob-skill" });
  HP.html(box, BAR(["a", "b"]), { key: "data-ob-skill" });
  assert.equal(box.innerHTML, fresh(doc, BAR(["a", "b"])), "提示换成按钮");
  const [a] = box.children, el = a.querySelector(".sk-el");
  // 属性图标换了（path 的 d 变了）、名字那一格换成 <b>
  const html2 = BTN("a").replace('d="M1 1L2 2"', 'd="M3 3L4 4"').replace('<span class="nm">a</span>', "<b>a</b>") + BTN("b");
  HP.html(box, html2, { key: "data-ob-skill" });
  assert.equal(box.children[0], a, "按钮还是那一个");
  assert.equal(a.querySelector(".sk-el"), el, "属性角标还是那一个");
  assert.equal(a.querySelector("path").getAttribute("d"), "M3 3L4 4", "只改了 path 的 d");
  assert.ok(a.querySelector(":scope > b") && !a.querySelector(".nm"), "标签不一样的那一格换掉");
  assert.equal(box.innerHTML, fresh(doc, html2));
  HP.html(box, wait, { key: "data-ob-skill" });
  assert.equal(box.innerHTML, fresh(doc, wait), "按钮换回提示");
  HP.html(box, "", { key: "data-ob-skill" });
  assert.equal(box.childNodes.length, 0, "空的");
});
