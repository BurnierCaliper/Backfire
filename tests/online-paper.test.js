// 联机玩家战斗画面的「纸片风」界面（#308，online-paper.js，设计在 docs/ui-paper/）：
//   · 不用浏览器的：什么时候是纸片画面、各块的收起状态记在本机、顶栏 / 吊牌 / 工具下拉的 HTML、坚毅生命一个字都没有
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../online-paper.js");

const memStore = (init) => {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
};

test("什么时候是纸片画面：只有联机玩家、战斗 / 战斗结算画面、新画面开着（3D 建好了）；主持人、探索、新画面关着都不是", () => {
  const on = { active: true, isHost: false, screen: "battle", on3d: true };
  assert.equal(P.active(on), true);
  assert.equal(P.active({ ...on, screen: "ended" }), true, "战斗结算画面新画面也挂着");
  assert.equal(P.active({ ...on, on3d: false }), false, "新画面关着 / 还在加载 / 打不开：照旧");
  assert.equal(P.active({ ...on, isHost: true }), false, "主持人那边不变");
  assert.equal(P.active({ ...on, active: false }), false, "不在房间里（单机）不变");
  assert.equal(P.active({ ...on, screen: "exploration" }), false, "探索不变");
  assert.equal(P.active({ ...on, screen: "lobby" }), false);
  assert.equal(P.active(null), false);
});

test("各块的收起状态记在本机：读写都包 try/catch；没记过按默认（抽屉平时收着）；存不了不报错", () => {
  const s = memStore();
  assert.equal(P.isOpen("drawer", s), false, "抽屉默认收着");
  assert.equal(P.setOpen("drawer", true, s), true);
  assert.equal(s.m.get(P.PAPER.keys.drawer), "open");
  assert.equal(P.isOpen("drawer", s), true);
  P.setOpen("drawer", false, s);
  assert.equal(P.isOpen("drawer", s, true), false, "记过的优先于默认");
  const bad = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(P.isOpen("drawer", bad), false, "读不了：按默认");
  assert.equal(P.setOpen("drawer", true, bad), false, "存不了：不报错");
  assert.equal(P.setOpen("drawer", true, null), false);
});

test("顶栏：联机跑团 · 房间码（红章）· 第 N 回合 · 时间 · 天气（夜里写「夜 · 」）；右边镜头远 / 中 / 近、「工具 ▾」、「菜单」（交给暂停页面）", () => {
  const h = P.topHtml({ room: "SA3X7C", turnNo: 3, day: 2, time: "08:00", period: "上午", weather: "雷鸣", night: true,
    cams: [{ label: "远", on: true }, { label: "中" }, { label: "近" }] });
  assert.match(h, /<span class="olp-title">联机跑团<\/span>/);
  assert.match(h, /class="olp-room olp-stamp"[^>]*>SA3X7C</);
  assert.match(h, />第 3 回合</);
  assert.match(h, />第 2 天 · <b>08:00<\/b> 上午</);
  assert.match(h, />夜 · 雷鸣</);
  assert.match(h, /data-olp-cam="0" aria-pressed="true"[^>]*>远</);
  assert.match(h, /data-olp="tools" aria-expanded="false"/);
  assert.match(h, /data-pause-open="1"[^>]*>菜单 <kbd>Esc<\/kbd>/);
  assert.doesNotMatch(h, /pm-open/, "不带 .pm-open（联机时 pause-menu.css 会把不是 .ol-button 的 .pm-open 藏掉）");
  assert.match(P.topHtml({ rogue: true, room: "X", reconnecting: true }), /联机单局<\/span><span class="olp-room[^>]*>重连中</);
  assert.match(P.topHtml({ toolsOpen: true }), /aria-expanded="true"/);
  assert.match(P.topHtml({ room: "<x>" }), /&lt;x&gt;/, "转义");
  // 骨架：顶栏、下拉、吊牌、提示分开；下拉平时收着；下拉里的按钮列表：空的项不画，新画面开关的位置在里面
  const shell = P.shellHtml();
  assert.match(shell, /^<div class="olp-top-host"><\/div><div class="olp-tools[^"]*" id="olp-tools"[^>]* hidden><p class="olp-tools-head">工具（点了就收起）<\/p><div class="olp-tools-list"><\/div><\/div><div class="olp-tags-host"><\/div><p class="olp-note" role="status" hidden><\/p>$/);
  assert.equal(P.toolsHtml(['<button data-online="map">地图</button>', "", null, '<span class="ol-hd2d-slot"></span>']), '<button data-online="map">地图</button><span class="ol-hd2d-slot"></span>');
});

test("行动顺序吊牌：当前的高亮；自己能动的格子平时只露 ⇅，点开才摆出热座栏原来的「延后 / 换位」；正在换位时每格的按钮都摆出来", () => {
  const slots = [
    { index: 0, actor: "a", name: "瑞比", owner: "Alice", current: true, mine: true, face: '<span class="face av"></span>',
      moves: [{ label: "延后", aria: "瑞比延后，移至末尾" }, { label: "换位", aria: "瑞比换位" }] },
    { index: 1, actor: "b", name: "绯秋", owner: "GM", done: true },
    { index: 2, actor: "", vacated: true }
  ];
  const h = P.tagsHtml(slots);
  assert.match(h, /<li class="olp-tag on mine" data-olp-slot="0"/);
  assert.match(h, /data-paper="tagon"><span class="olp-hole" aria-hidden="true"><\/span><span class="face av"><\/span>/);
  assert.match(h, /<b>瑞比<\/b><small>Alice<\/small>/);
  assert.match(h, /data-olp-swap="0" aria-expanded="false"[^>]*>⇅</);
  assert.doesNotMatch(h, /data-olp-move/, "平时不摆按钮");
  assert.match(h, /<li class="olp-tag done" data-olp-slot="1"/);
  assert.match(h, /<li class="olp-tag vacated" data-olp-slot="2"[^]*<b>空位<\/b><small>已挪走<\/small>/);
  const open = P.tagsHtml(slots, { open: 0 });
  assert.match(open, /data-olp-swap="0" aria-expanded="true"/);
  assert.match(open, /data-olp-move="0 0" aria-label="瑞比延后，移至末尾">延后<\/button><button[^>]*data-olp-move="0 1"[^>]*>换位</);
  const moving = P.tagsHtml([{ index: 0, actor: "a", name: "瑞比", moves: [{ label: "取消换位" }] }, { index: 1, actor: "b", name: "结人", moves: [{ label: "换到这里", primary: true }] }], { moving: true });
  assert.match(moving, /data-olp-move="0 0"[^>]*>取消换位</);
  assert.match(moving, /class="olp-move olp-sheet primary"[^>]*data-olp-move="1 0"[^>]*>换到这里</);
  assert.doesNotMatch(moving, /data-olp-swap/, "换位中不再露 ⇅");
});

test("单机 / 主持人 / 新画面关着一条都套不上：online-paper.css 每条规则都挂在 body.ol-paper 下面；game.html 加载了它们；online-ui.js 只在联机玩家 + 新画面开着时加这个类", () => {
  const fs = require("node:fs"), path = require("node:path");
  const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const css = read("online-paper.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // 拆出每条规则的选择器（@media 里面的也算），每个都要以 body.ol-paper / body.online-player.ol-paper 开头
  const sels = [];
  /** 按逗号拆选择器（括号里的逗号不算：:has(button, b)） */
  const split = sel => { const out = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  css.replace(/([^{}@;]+)\{[^{}]*\}/g, (m, sel) => { split(sel).map(s => s.trim()).filter(Boolean).forEach(s => sels.push(s)); return m; });
  assert.ok(sels.length > 40, "拆出了规则：" + sels.length);
  const loose = sels.filter(s => !/^body(\.online-player)?\.ol-paper\b/.test(s) && !/^(from|to|\d+%)$/.test(s));
  assert.deepEqual(loose, [], "这些选择器没挂在 body.ol-paper 下面");
  const html = read("game.html");
  assert.match(html, /<link rel="stylesheet" href="hd2d\/hd2d\.css" \/>[\s\S]*<link rel="stylesheet" href="online-paper\.css" \/>/, "样式在 hd2d.css 后面（压得过新画面的外壳）");
  assert.ok(html.indexOf('<script src="online-paper.js"></script>') > 0 && html.indexOf('<script src="online-paper.js"></script>') < html.indexOf('<script src="online-ui.js"></script>'), "online-paper.js 先于 online-ui.js");
  const ui = read("online-ui.js");
  assert.match(ui, /setPaper\(!!global\.OnlinePaper && global\.OnlinePaper\.active\(\{ active: view\.active, isHost: view\.isHost, screen: view\.screen, on3d: !!\(field3d && field3d\.on\(\)\) \}\)\);/, "只看联机玩家 + 战斗画面 + 新画面建好了");
  assert.equal(P.PAPER.bodyClass, "ol-paper");
});

test("新加的 HTML 里没有坚毅生命：顶栏、吊牌、下拉只拿传进来的公开字段", () => {
  const all = P.shellHtml() + P.topHtml({ room: "R", turnNo: 1, weather: "常态", cams: [{ label: "远" }] }) + P.tagsHtml([{ index: 0, actor: "a", name: "甲", owner: "p" }]);
  assert.doesNotMatch(all, /shp|坚毅/);
});
