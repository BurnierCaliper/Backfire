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
  assert.equal(P.tabOf(memStore(), "chat"), "chat");
  const t = memStore(); P.setTab("chat", t);
  assert.equal(P.tabOf(t), "chat");
  assert.equal(P.setTab("x", t), false, "认不得的页不记");
  assert.equal(P.tabOf(bad), "log");
});

test("顶栏：联机跑团 · 房间码（红章）· 第 N 回合 · 时间 · 天气（夜里写「夜 · 」）；右边镜头远 / 中 / 近、「工具 ▾」、「菜单」（交给暂停页面）", () => {
  const h = P.topHtml({ room: "SA3X7C", turnNo: 3, day: 2, time: "08:00", period: "上午", weather: "雷鸣", night: true,
    cams: [{ label: "远", on: true }, { label: "中" }, { label: "近" }], tools: ['<button data-online="map">地图</button>'] });
  assert.match(h, /<span class="olp-title">联机跑团<\/span>/);
  assert.match(h, /class="olp-room olp-stamp"[^>]*>SA3X7C</);
  assert.match(h, />第 3 回合</);
  assert.match(h, />第 2 天 · <b>08:00<\/b> 上午</);
  assert.match(h, />夜 · 雷鸣</);
  assert.match(h, /data-olp-cam="0" aria-pressed="true"[^>]*>远</);
  assert.match(h, /data-olp="tools" aria-expanded="false"/);
  assert.match(h, /data-pause-open="1"[^>]*>菜单 <kbd>Esc<\/kbd>/);
  assert.match(h, /id="olp-tools"[^>]* hidden>/, "下拉平时收着");
  assert.match(P.topHtml({ rogue: true, room: "X", reconnecting: true }), /联机单局<\/span><span class="olp-room[^>]*>重连中</);
  const open = P.topHtml({ toolsOpen: true, tools: ['<button data-online="map">地图</button>', "", '<span class="ol-hd2d-slot"></span>'] });
  assert.match(open, /aria-expanded="true"/);
  assert.doesNotMatch(open, /id="olp-tools"[^>]* hidden>/);
  assert.match(open, /<div class="olp-tools-list"><button data-online="map">地图<\/button><span class="ol-hd2d-slot"><\/span><\/div>/, "空的项不画；新画面开关的位置在下拉里");
  assert.match(P.topHtml({ room: "<x>" }), /&lt;x&gt;/, "转义");
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

test("新加的 HTML 里没有坚毅生命：顶栏、吊牌、下拉只拿传进来的公开字段", () => {
  const all = P.topHtml({ room: "R", turnNo: 1, weather: "常态", cams: [{ label: "远" }], tools: [] }) + P.tagsHtml([{ index: 0, actor: "a", name: "甲", owner: "p" }]);
  assert.doesNotMatch(all, /shp|坚毅/);
});
