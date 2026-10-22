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

test("白天 / 夜晚 / 天气的配色（第 2 步）：跟着这一包的光影（没有就看游戏时钟）和天气；配色都在配置表里，写成 CSS 变量", () => {
  // 光影优先；傍晚和规则表一样算夜里；旧主机没发光影就看时钟
  assert.deepEqual(P.themeOf({ light: "day", night: true, weather: "none" }), { time: "day", weather: "none" });
  assert.deepEqual(P.themeOf({ light: "dusk" }), { time: "night", weather: "none" });
  assert.deepEqual(P.themeOf({ light: "night" }).time, "night");
  assert.deepEqual(P.themeOf({ night: true }).time, "night");
  assert.deepEqual(P.themeOf({}).time, "day");
  // 天气：沙暴、下雨（酸雨 / 雷鸣）、雪、雾（相位、微光）；别的不加
  const w = k => P.themeOf({ light: "day", weather: k }).weather;
  assert.deepEqual(["sand", "acid", "thunder", "snow", "phase", "glow", "heat", "none", "toString", undefined].map(w), ["sand", "rain", "rain", "snow", "fog", "fog", "none", "none", "none", "none"]);
  // 白天：牛皮纸、米白卡片；夜晚：深色牛皮纸、黑卡纸、浅色字
  const day = P.themeVars({ time: "day", weather: "none" }), night = P.themeVars({ time: "night", weather: "none" });
  assert.equal(day["--olp-kraft"], P.PAPER.palette.day.kraft);
  assert.equal(day["--olp-paper-ink"], P.PAPER.palette.day.paperInk);
  assert.equal(night["--olp-paper"], P.PAPER.palette.night.paper);
  const lum = hex => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) * 299 + ((v >> 8) & 255) * 587 + (v & 255) * 114) / 1000; };
  assert.ok(lum(day["--olp-paper"]) > 200 && lum(night["--olp-paper"]) < 60, "白天浅色纸、夜里黑卡纸");
  assert.ok(lum(day["--olp-paper-ink"]) < 60 && lum(night["--olp-paper-ink"]) > 200, "夜里字是浅色");
  assert.equal(day["--olp-edge-fx"], "inset 0 0 0 transparent", "没有天气：纸边不加东西");
  // 沙暴：底色往沙黄混、纸边发黄；字的颜色不染
  const sand = P.themeVars({ time: "day", weather: "sand" });
  assert.equal(sand["--olp-kraft"], P.mix(P.PAPER.palette.day.kraft, P.PAPER.weathers.sand.tint, P.PAPER.weathers.sand.mix));
  assert.notEqual(sand["--olp-kraft"], day["--olp-kraft"]);
  assert.equal(sand["--olp-kraft-ink"], day["--olp-kraft-ink"]);
  assert.equal(sand["--olp-edge-fx"], P.PAPER.weathers.sand.edge);
  // 雪：纸边一层霜；雨：偏蓝灰；雾：字往灰里退（对比低一点）
  assert.match(P.themeVars({ time: "day", weather: "snow" })["--olp-edge-fx"], /rgba\(255, 255, 255/);
  const rain = P.themeVars({ time: "day", weather: "rain" })["--olp-paper"], [r, , b] = [1, 3, 5].map(i => parseInt(rain.slice(i, i + 2), 16));
  assert.ok(b - r > parseInt(P.PAPER.palette.day.paper.slice(5, 7), 16) - parseInt(P.PAPER.palette.day.paper.slice(1, 3), 16), "雨天纸偏蓝");
  const fog = P.themeVars({ time: "day", weather: "fog" });
  assert.ok(lum(fog["--olp-paper-ink"]) > lum(day["--olp-paper-ink"]), "雾天字淡一点");
  assert.equal(P.mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(P.mix("rgba(1,2,3,.5)", "#ffffff", 0.5), "rgba(1,2,3,.5)", "认不得的颜色原样");
  // 每一套的变量名都一样（换一套时上一套的不会留下）
  assert.deepEqual(Object.keys(night).sort(), Object.keys(day).sort());
  assert.deepEqual(Object.keys(sand).sort(), Object.keys(day).sort());
});

test("纸片美术的纯函数：撕边的点都在纸里面、同一个种子画出来一样；没有 canvas（Node 里）不贴纹理也不报错", () => {
  const a = P.roughPath(120, 40, { jag: 2, torn: { top: 6 } }, P.rng(42)), b = P.roughPath(120, 40, { jag: 2, torn: { top: 6 } }, P.rng(42));
  assert.deepEqual(a, b, "同一个种子一样");
  assert.ok(a.length > 30);
  assert.ok(a.every(([x, y]) => x >= 0 && x <= 120 && y >= 0 && y <= 40), "都在纸里面");
  assert.ok(a.filter(([, y]) => y < 10).some(([, y]) => y > 2), "撕开的那一边更毛（往里缩得更多）");
  const r = P.rng(1); assert.ok([r(), r(), r()].every(v => v > 0 && v < 1));
  assert.equal(P.texture(null, "card", 10, 10), "");
  assert.equal(P.texture({ createElement: () => ({}) }, "card", 10, 10), "", "没有 canvas");
  assert.equal(P.texture({ createElement: () => ({}) }, "nope", 10, 10), "");
  assert.equal(P.dress(null), 0);
  // 每种纸用的颜色都在配色表里；贴纹理的面板都有种类
  Object.values(P.PAPER.art.kinds).forEach(k => assert.ok(P.PAPER.palette.day[k.color] && P.PAPER.palette.night[k.color], k.color));
  P.PAPER.art.targets.forEach(([sel, kind]) => kind.split("|").forEach(k => assert.ok(P.PAPER.art.kinds[k], sel + " → " + k)));
});

test("纸纹的折面数跟着面积走（审查：大面板的折面被放大成「碎地砖」）：越大的纸折面越多，小纸片至少是这种纸原来的块数，有上限；按格子找最近的点和挨个比一样", () => {
  const A = P.PAPER.art;
  // 越大越多：吊牌 < 队伍卡 < 抽屉（340 × 560）< 手机上拉满屏的抽屉（390 × 844），到上限为止
  const n = [[112, 40], [236, 300], [340, 560], [390, 844]].map(([w, h]) => P.facetCount("paper", w, h));
  assert.ok(n[0] < n[1] && n[1] < n[2] && n[2] < n[3], "折面数随面积增加：" + n);
  assert.equal(P.facetCount("tag", 112, 40), A.kinds.tag.facets, "小纸片：照原来的块数");
  assert.equal(P.facetCount("paper", 340, 560), Math.round(340 * 560 / A.facet.area), "每 area 平方像素一块");
  assert.equal(P.facetCount("paper", 4000, 4000), A.facet.max, "有上限（防止太慢）");
  assert.equal(P.facetCount("nope", 100, 100), 0);
  // 一块折面平均多大：大纸和小纸差不多细（不再被放大成一大块一大块）
  const per = (k, w, h) => (w * h) / P.facetCount(k, w, h);
  assert.ok(per("paper", 340, 560) <= A.facet.area * 1.01 && per("dock", 960, 170) <= A.facet.area * 1.01, "大纸每块折面不超过 area");
  // 按格子找：和挨个比的结果一模一样（同一个 Voronoi，只是快）
  const rnd = P.rng(5), pts = Array.from({ length: 60 }, () => ({ x: rnd() * 90, y: rnd() * 140 })), near = P.nearest2(pts, 90, 140);
  for (let y = 0; y < 140; y += 3) for (let x = 0; x < 90; x += 3) {
    let d1 = 1e9, d2 = 1e9, i1 = 0;
    pts.forEach((p, i) => { const dd = (x - p.x) ** 2 + (y - p.y) ** 2; if (dd < d1) { d2 = d1; d1 = dd; i1 = i; } else if (dd < d2) d2 = dd; });
    const got = near(x, y);
    assert.deepEqual([got.i1, got.d1, got.d2], [i1, d1, d2], `(${x}, ${y})`);
  }
  assert.deepEqual(P.nearest2([{ x: 1, y: 1 }], 10, 10)(5, 5).i1, 0, "只有一个点也行");
});

test("战斗记录是热敏收据（审查第 1 条）：BACKFIRE / 战斗记录 · 房间码、一排等号；*** 第 N 回合 *** 分隔；伤害数字靠右单独一格、击破 / 弹字写小字；回合末尾「本回合合计」", () => {
  const logs = [
    { kind: "gm", text: "主持人调整了队伍物资" },
    { kind: "round", text: "第 1 回合开始", turn: 1 },
    { kind: "action", text: "瑞比 · 普通攻击 → 狂徒(匕首)：12 伤害，击破 1，克制", turn: 1 },
    { kind: "gm", text: "主持人调整了战场" },                                            // 没带回合：算在当时那一回合
    { kind: "action", text: "结人 · 冰封领域 → 狂徒：5 伤害；强盗：4 伤害，冻伤", turn: 1 },
    { kind: "phase", text: "敌人回合", phase: "enemy", turn: 1 },
    { kind: "round", text: "第 2 回合开始 → 狂徒：3 伤害，灼烧", turn: 2 },
    { kind: "action", text: "灯 · 包扎 → 结人：治疗 6", turn: 2 }
  ];
  const g = P.receiptGroups(logs);
  assert.deepEqual(g.map(x => [x.turn, x.lines.length, x.total]), [[null, 1, { dmg: 0, brk: 0, heal: 0 }], [1, 4, { dmg: 21, brk: 1, heal: 0 }], [2, 2, { dmg: 3, brk: 0, heal: 6 }]],
    "按回合分好；「第 1 回合开始」不单独占一行，带结算的「第 2 回合开始」照旧写；合计只加收据上写着的数");
  assert.deepEqual(P.receiptLine(logs[2]), { kind: "action", who: "瑞比", what: "普通攻击", targets: [{ name: "狂徒(匕首)", dmg: 12, brk: 1, heal: 0, words: ["克制"] }] });
  assert.deepEqual(P.receiptLine(logs[0]), { kind: "gm", who: "主持人", what: "调整了队伍物资", targets: [] });
  assert.equal(P.receiptLine({ text: "红玉 · 普通攻击 → 狂徒 12" }).who, "红玉", "旧的写法（没有 kind）也认");
  const h = P.receiptHtml(logs, { room: "SA3X7C" });
  // 顶上：BACKFIRE / 战斗记录 · 房间码、一排等号
  assert.match(h, /^<li class="olp-rc-h"><b>BACKFIRE<\/b><span>战斗记录 · SA3X7C<\/span><\/li><li class="olp-rc-rule" aria-hidden="true">={20,}<\/li>/);
  // 回合分隔、每条一行（虚线在 CSS：.olp-rc-r 的下边框）、伤害靠右（单独一格 .olp-rc-n）
  assert.match(h, /<li class="olp-rc-sep">\*\*\* 第 1 回合 \*\*\*<\/li>/);
  assert.match(h, /<li class="olp-rc-r"><span class="olp-rc-l"><b>瑞比<\/b> 普通攻击 → 狂徒\(匕首\)<\/span><span class="olp-rc-n">12<\/span><small>击破 1 · 克制<\/small><\/li>/);
  assert.match(h, /<li class="olp-rc-r"><span class="olp-rc-l"><b>主持人<\/b> 调整了队伍物资<\/span><span class="olp-rc-n"><\/span><\/li>/);
  assert.match(h, /<b>结人<\/b> 冰封领域<\/span><span class="olp-rc-n"><\/span><span class="olp-rc-t">→ 狂徒<\/span><span class="olp-rc-n">5<\/span><span class="olp-rc-t">→ 强盗<\/span><span class="olp-rc-n">4<\/span><small>冻伤<\/small>/, "打了几个目标：一个目标一行，各自的数靠右");
  assert.match(h, /<li class="olp-rc-p">敌人回合<\/li>/);
  // 本回合合计：每个回合的末尾（合计上面一排虚线）
  assert.match(h, /<li class="olp-rc-cut" aria-hidden="true">- - [- ]+<\/li><li class="olp-rc-total">\* 本回合合计 伤害 21 · 击破 1 \*<\/li><li class="olp-rc-sep">\*\*\* 第 2 回合 \*\*\*<\/li>/);
  assert.match(h, /<li class="olp-rc-total">\* 本回合合计 伤害 3 · 治疗 6 \*<\/li>$/, "最后一回合也有（写到现在为止）");
  assert.equal((h.match(/class="olp-rc-sep"/g) || []).length, 2);
  // 空的：只有抬头和一句提示；转义
  assert.match(P.receiptHtml([], { room: "R" }), /<li class="olp-rc-empty">还没有公开记录。<\/li>$/);
  assert.match(P.receiptHtml([{ kind: "action", text: "<b>x</b> · 攻击", turn: 1 }], { room: "<r>" }), /&lt;r&gt;[\s\S]*&lt;b&gt;x&lt;\/b&gt;/);
  // 收据的纸：底边是锯齿撕口（一高一低交替）
  const zig = P.PAPER.art.kinds.receipt.zig, path = P.roughPath(80, 60, P.PAPER.art.kinds.receipt, P.rng(3)), bottom = path.filter(([, y]) => y > 60 - zig.depth - 2);
  assert.ok(bottom.some(([, y]) => y <= 60 - zig.depth + 0.01) && bottom.some(([, y]) => y > 60 - 1.6), "锯齿：有深有浅");
  assert.deepEqual(P.PAPER.art.targets.find(([sel]) => /data-tab="log"/.test(sel)), ['#online-side[data-tab="log"]:not(.ol-side-collapsed)', "receipt"], "战斗记录那一面贴收据纸");
});

test("小队聊天的便利贴：每个发送人固定一种颜色，自己发的是另一种（都在配置表里）", () => {
  const N = P.PAPER.notes;
  assert.equal(P.noteColor("p1", true), N.mine);
  assert.equal(P.noteColor("p2"), P.noteColor("p2"), "同一个人一样");
  assert.ok(N.colors.includes(P.noteColor("p2")) && N.colors.includes(P.noteColor("")));
  assert.ok(new Set(["p1", "p2", "p3", "gm", "p4", "p5"].map(id => P.noteColor(id))).size > 1, "不同的人不全是一个颜色");
  assert.equal(P.themeVars({ time: "night" })["--olp-note-ink"], N.ink, "便利贴上的字夜里也是深色");
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
