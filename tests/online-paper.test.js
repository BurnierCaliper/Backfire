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

test("手机竖屏（#311）：配置表 PAPER.phone——多窄算手机（和 online-paper.css 手机那一段一样宽）、技能栏展开时最多占屏幕高度的 35%（写成 --olp-dock-max）；dockAuto：没手动点过时不是你就收起、轮到你等演出播完展开；电脑上、手动点过的不动", () => {
  const fs = require("node:fs"), path = require("node:path");
  const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.equal(P.PAPER.phone.media, "(max-width: 760px)");
  assert.equal(P.PAPER.phone.dockMax, 35, "最多占屏幕高度的 35%");
  assert.deepEqual(P.phoneVars(), { "--olp-dock-max": "35dvh" });
  const css = read("online-paper.css"), at = css.indexOf("@media " + P.PAPER.phone.media + " {");
  assert.ok(at > 0, "手机那一段的 @media 和配置表一样宽");
  assert.match(css.slice(at), /\.g-hud\.hd2d-shell \{[^}]*max-height: var\(--olp-dock-max\)/, "手机上的技能栏按这个变量限高（CSS 里不另写一个数）");
  assert.match(read("online-ui.js"), /matchMedia\(global\.OnlinePaper\.PAPER\.phone\.media\)/, "online-ui.js 量手机用配置表里那一条");
  const A = o => P.dockAuto(Object.assign({ phone: true, manual: false, mine: false, busy: false }, o));
  assert.equal(A({}), false, "手机上不是你：收起（战场让出来）");
  assert.equal(A({ busy: true }), false, "不是你：演出播着也收起");
  assert.equal(A({ mine: true }), true, "轮到你：展开");
  assert.equal(A({ mine: true, busy: true }), null, "轮到你但演出还在播：不动（别人的演出播完才展开；自己出手的演出播着时不收起来）");
  assert.equal(A({ manual: true, mine: true }), null, "手动点过「技能 ▼ / ▲」：照本机记着的");
  assert.equal(A({ manual: true }), null);
  assert.equal(A({ phone: false, mine: true }), null, "电脑上不动");
  assert.equal(A({ phone: false }), null);
  assert.equal(P.dockAuto(), null);
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
  assert.equal(P.texture(null, "card"), "");
  assert.equal(P.texture({ createElement: () => ({}) }, "card", { time: "day", weather: "none" }), "", "没有 canvas");
  assert.equal(P.texture({ createElement: () => ({}) }, "nope"), "");
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

/* ---------- #321：纸纹是每种纸 × 每套配色一张能无缝平铺的小纹理（不按面板大小画）；撕边 clip-path、影子 drop-shadow ---------- */
/** 假网页：canvas 记下画了几张（createElement("canvas")）、多大、2D 上下文叫了哪些方法 / 设了哪些属性、putImageData 的那块像素，
 *  toBlob / toDataURL 各叫了几次；toBlob 同步回一个真的 Blob（URL.createObjectURL 认它）。纹理缓存在模块里，各条测试用不同的配色 */
function paperDoc() {
  const log = { canvases: 0, blobs: 0, dataUrls: 0, sizes: [], calls: [], sets: [], images: [] }, els = new Map();
  const ctx2d = () => new Proxy({}, {
    get: (t, k) => k === "createImageData" ? (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
      : k === "putImageData" ? (img) => { log.calls.push("putImageData"); log.images.push(img); }
      : k === "createRadialGradient" ? () => ({ addColorStop() {} })
      : k in t ? t[k] : () => { log.calls.push(String(k)); },
    set: (t, k, v) => { log.sets.push(String(k)); t[k] = v; return true; }
  });
  const doc = {
    createElement(tag) {
      if (tag === "i") return { tag, className: "", attrs: {}, parentNode: null, setAttribute(k, v) { this.attrs[k] = v; } };
      if (tag !== "canvas") return {};
      log.canvases++;
      const c = { width: 0, height: 0, getContext: () => { log.sizes.push([c.width, c.height]); return ctx2d(); },
        toBlob(cb) { log.blobs++; cb(new Blob(["png"], { type: "image/png" })); },
        toDataURL() { log.dataUrls++; return "data:image/png;base64,AAAA"; } };
      return c;
    },
    querySelectorAll(sel) {
      if (sel === "[data-olp-tex]") return [...els.values()].flat().filter(e => e.dataset.olpTex);
      return els.get(sel) || [];
    }
  };
  /** 一块面板：sel 选择器、w × h 大小（之后改 el.offsetWidth / offsetHeight 就是变了大小）；kids = 补进去的子节点 */
  const panel = (sel, w, h) => {
    const el = { offsetWidth: w, offsetHeight: h, isConnected: true, dataset: {}, vars: {}, kids: [], style: { setProperty(k, v) { el.vars[k] = v; } }, closest: () => null,
      appendChild(c) { el.kids.push(c); c.parentNode = el; return c; } };
    els.set(sel, (els.get(sel) || []).concat([el]));
    return el;
  };
  return { doc, log, panel };
}
const texUrl = el => (/^url\("(.*)"\)$/.exec(el.vars["--olp-tex"] || "") || [])[1] || "";
const kindsN = () => Object.keys(P.PAPER.art.kinds).length;

test("#321 纸纹只看种类和配色：每种纸 × 每套配色一张平铺纹理（PAPER.art.tile 见方），和面板多大无关；整个游戏最多「种类 × 配色」张", () => {
  const A = P.PAPER.art;
  assert.equal(A.tile, 256, "平铺纹理的边长在配置表里");
  assert.equal(typeof P.tileSpec, "function");
  const day = { time: "day", weather: "none" }, night = { time: "night", weather: "none" };
  const s = P.tileSpec("dock", day);
  assert.deepEqual([s.kind, s.th, s.base], ["dock", "day|none", P.themeVars(day)["--olp-kraft"]]);
  assert.ok(!("w" in s) && !("h" in s), "不带面板大小");
  assert.notEqual(P.tileSpec("dock", night).key, s.key, "换了配色：另一张");
  assert.notEqual(P.tileSpec("kraft", day).key, s.key, "同一个颜色的另一种纸：另一张（褶皱、撕边不一样）");
  assert.equal(P.tileSpec("dock", day).key, s.key, "同一种纸、同一套配色：同一张");
  assert.equal(P.tileSpec("nope", day), null);
  // 上限：种类 × 配色（白天 / 夜晚 × 没有天气 / 沙暴 / 雨 / 雪 / 雾）
  const themes = [];
  ["day", "night"].forEach(time => ["none", "sand", "rain", "snow", "fog"].forEach(weather => themes.push({ time, weather })));
  const keys = new Set();
  themes.forEach(th => Object.keys(A.kinds).forEach(k => keys.add(P.tileSpec(k, th).key)));
  assert.equal(keys.size, kindsN() * themes.length);
});

test("#321 dress：开局把这一套配色的每一种纸都排上，dress 里不画；空闲时（Node 里没有 requestIdleCallback：setTimeout）每种只画一张、toBlob 编码；之后选技能 / 取消（技能栏 235 ↔ 288）、开新的说明框、窗口拖大拖小都不再画", async () => {
  const { doc, log, panel } = paperDoc(), th = { time: "night", weather: "rain" }, T = [["#dock", "dock"], ["#tag", "tag"], ["#tip", "paper"], ["#end", "board"]];
  const dock = panel("#dock", 976, 235), tag = panel("#tag", 150, 44), end = panel("#end", 140, 60);
  assert.equal(P.dress(doc, T, th), 0, "第一次：还没有，这一下什么都不贴");
  assert.equal(log.canvases, 0, "dress 里不画");
  assert.equal(P.pending(), kindsN(), "这一套的每一种纸都排上了");
  for (let i = 0; i < 200 && P.pending() > 0; i++) await new Promise(r => setTimeout(r, 2));
  assert.equal(P.pending(), 0, "空闲时画完了");
  assert.equal(log.canvases, kindsN(), "每种纸一张（一张 canvas，不再有算折面的小画布）");
  assert.ok(log.sizes.every(([w, h]) => w === 256 && h === 256), "都是 256 见方：" + JSON.stringify(log.sizes.slice(0, 3)));
  assert.deepEqual([log.blobs, log.dataUrls], [kindsN(), 0], "toBlob 编码，不用同步的 toDataURL");
  assert.match(texUrl(dock), /^blob:/, "画好就贴上：" + texUrl(dock));
  assert.deepEqual([dock.dataset.olpTex, tag.dataset.olpTex, end.dataset.olpTex], ["dock", "tag", "board"]);
  assert.equal(P.dress(doc, T, th), 0, "都贴着了：不再动");
  const first = texUrl(dock);
  // 选技能 / 取消、技能栏收起展开、窗口拖大拖小：一张都不画，纹理还是那一张
  for (const [w, h] of [[976, 288], [976, 235], [976, 288], [976, 400], [976, 90], [600, 700], [1500, 235], [333, 97]]) {
    dock.offsetWidth = w; dock.offsetHeight = h;
    P.dress(doc, T, th);
    assert.equal(texUrl(dock), first, `${w} × ${h}：还是那一张`);
  }
  // 开新的面板（说明框、悬停的小卡片……），什么大小都直接从缓存贴
  const tip = panel("#tip", 287, 133), tag2 = panel("#tag", 91, 37);
  assert.equal(P.dress(doc, T, th), 2, "新面板马上贴上");
  assert.equal(tip.dataset.olpTex, "paper");
  assert.equal(texUrl(tag2), texUrl(tag), "同一种纸、同一套配色：同一张");
  assert.deepEqual([log.canvases, P.pending(), P.flush()], [kindsN(), 0, 0], "一张都没再画");
});

test("#321 平铺纹理左右、上下接得上（最边上那一列 / 行和另一边的差，和挨着的两列 / 行差不多，不是一道缝）；全在一块像素里算、只 putImageData 一次：不用 shadowBlur、filter、描线、drawImage", () => {
  const S = P.PAPER.art.tile;
  for (const [kind, th] of [["dock", { time: "day", weather: "sand" }], ["board", { time: "day", weather: "none" }], ["receipt", { time: "day", weather: "rain" }]]) {
    const { doc, log } = paperDoc();
    assert.match(P.texture(doc, kind, th), /^data:image\/png/, kind + "：画出来了");
    assert.deepEqual(log.sizes, [[S, S]], kind + "：一张 tile 见方");
    assert.deepEqual(log.calls, ["putImageData"], kind + "：只 putImageData 一次：" + log.calls.join(","));
    assert.ok(!log.sets.some(k => /shadow|filter|stroke|lineWidth/.test(k)), kind + "：没设影子 / 滤镜 / 描线：" + log.sets.join(","));
    const d = log.images[0].data, lum = (x, y) => { const i = (y * S + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    let seamX = 0, seamY = 0, inX = 0, inY = 0;
    for (let i = 0; i < S; i++) { seamX += Math.abs(lum(0, i) - lum(S - 1, i)); seamY += Math.abs(lum(i, 0) - lum(i, S - 1)); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S - 1; x++) { inX += Math.abs(lum(x, y) - lum(x + 1, y)); inY += Math.abs(lum(y, x) - lum(y, x + 1)); }
    seamX /= S; seamY /= S; inX /= S * (S - 1); inY /= S * (S - 1);
    assert.ok(inX > 0.3, kind + "：纹理不是一块平的颜色：" + inX);
    assert.ok(seamX < inX * 1.6 && seamY < inY * 1.6, `${kind}：接缝 ${seamX.toFixed(2)} / ${seamY.toFixed(2)}，挨着的 ${inX.toFixed(2)} / ${inY.toFixed(2)}`);
    // 同一种纸、同一套配色再要一次：缓存里拿，不画
    assert.equal(P.texture(doc, kind, th), P.texture(doc, kind, th));
    assert.equal(log.canvases, 1);
  }
  // 没有 toBlob（旧浏览器）：dress 照样在空闲时画好（toDataURL）
  const old = paperDoc();
  old.doc.createElement = (orig => tag => { const c = orig(tag); delete c.toBlob; return c; })(old.doc.createElement);
  const p = old.panel("#p", 130, 50);
  P.dress(old.doc, [["#p", "card"]], { time: "day", weather: "snow" });
  assert.equal(old.log.canvases, 0);
  assert.equal(P.flush(), kindsN());
  assert.match(texUrl(p), /^data:image\/png/);
});

test("#321 撕边是 CSS clip-path：按面板大小生成的 polygon（沿着边是百分比、往里缩的深度是像素）；撕开的边更毛、收据底边是锯齿、按钮那种没有；技能栏 235 ↔ 288 接着用同一个，差太多才换（只换 CSS 变量，不画纹理）", () => {
  const A = P.PAPER.art;
  assert.deepEqual([A.bucket, A.reuse], [{ steps: [[64, 4], [128, 8], [256, 16], [512, 32]], big: 64 }, 0.25], "分档、接着用的范围在配置表里");
  assert.deepEqual([28, 29, 44, 120, 121, 150, 235, 240, 241, 288, 300, 976, 1024, 1025].map(P.bucket), [28, 32, 44, 120, 128, 160, 240, 240, 256, 288, 320, 1024, 1024, 1088]);
  const c = P.tornClip("dock", 976, 235);
  assert.deepEqual([c.kind, c.w, c.h], ["dock", 1024, 240], "按那一档的大小生成点");
  assert.match(c.css, /^polygon\(.*\)$/);
  /** 拆开 polygon 的点：[x, y]，每个是 { pct, px, back }（百分比 / 像素 / 从 100% 往回减的像素） */
  const parse = css => css.slice(8, -1).split(", ").map(pt => pt.match(/calc\(100% - [\d.]+px\)|[\d.]+%|[\d.]+px/g).map(v =>
    /^calc/.test(v) ? { back: parseFloat(v.slice(12)) } : /%$/.test(v) ? { pct: parseFloat(v) } : { px: parseFloat(v) }));
  const pts = parse(c.css);
  assert.ok(pts.every(p => p.length === 2), "每个点两个数");
  assert.ok(pts.every(([x, y]) => (x.pct != null) !== (y.pct != null)), "沿着边的那个是百分比、另一个是像素");
  const top = pts.filter(([x, y]) => x.pct != null && y.px != null), left = pts.filter(([x, y]) => x.px != null && y.pct != null);
  assert.ok(top.length > 200, "技能栏上边是撕开的：点密（每 4 像素一个）：" + top.length);
  assert.ok(top.every(([, y]) => y.px <= A.kinds.dock.torn.top) && top.some(([, y]) => y.px > A.kinds.dock.jag), "上边撕得更深（最多 torn.top 像素）");
  assert.ok(left.every(([x]) => x.px <= A.kinds.dock.jag), "别的边只毛一点");
  // 收据：底边锯齿（一高一低，齿深 zig.depth）
  const bottom = parse(P.tornClip("receipt", 330, 560).css).filter(([x, y]) => x.pct != null && y.back != null).map(([, y]) => y.back);
  assert.ok(bottom.some(v => v >= A.kinds.receipt.zig.depth) && bottom.some(v => v < 1.6), "锯齿：有深有浅");
  assert.equal(P.tornClip("board", 120, 40), null, "按钮那种（flat）不撕边");
  assert.equal(P.tornClip("nope", 120, 40), null);
  assert.equal(P.tornClip("dock", 0, 40), null);
  assert.equal(P.tornClip("dock", 990, 229), c, "同一档：同一个（记着）");
  // 接着用：同一种纸，宽高各自差不到 reuse
  assert.ok(P.fits(c, "dock", 976, 288), "选了技能变高：接着用");
  assert.ok(!P.fits(c, "dock", 976, 400), "差太多：换");
  assert.ok(!P.fits(c, "kraft", 976, 235), "种类不一样");
  assert.ok(!P.fits(null, "dock", 976, 235));
  // dress：撕边写成 --olp-clip；技能栏 235 ↔ 288 不换，差太多才换；都不画纹理
  const { doc, log, panel } = paperDoc(), th = { time: "night", weather: "sand" }, T = [["#dock", "dock"], ["#btn", "board"]];
  const dock = panel("#dock", 976, 235), btn = panel("#btn", 140, 60);
  P.dress(doc, T, th); P.flush();
  const painted = log.canvases;
  assert.equal(dock.vars["--olp-clip"], c.css);
  assert.equal(btn.vars["--olp-clip"], undefined, "按钮不撕边");
  const was = dock.vars["--olp-clip"];
  for (const h of [288, 235, 288, 241]) { dock.offsetHeight = h; P.dress(doc, T, th); assert.equal(dock.vars["--olp-clip"], was, `高度 ${h}：撕边不换`); }
  dock.offsetHeight = 400;
  P.dress(doc, T, th);
  assert.notEqual(dock.vars["--olp-clip"], was, "差太多：换一个撕边");
  assert.equal(dock.vars["--olp-clip"], P.tornClip("dock", 976, 400).css);
  assert.deepEqual([log.canvases, P.pending()], [painted, 0], "换撕边不画纹理");
});

test("#321 影子是 CSS drop-shadow：大面板（ply）补一层 .olp-ply（只补一个，被拿掉了再补），小纸片、按钮不补；配色变量里有影子（--olp-ply-fx）、平铺大小（--olp-tile）、雪天的霜（--olp-frost，内阴影）", () => {
  const A = P.PAPER.art;
  assert.deepEqual(Object.keys(A.kinds).filter(k => A.kinds[k].ply), ["tapebar", "kraft", "dock", "paper", "receipt"], "大面板");
  const { doc, panel } = paperDoc(), th = { time: "night", weather: "fog" }, T = [["#dock", "dock"], ["#side", "receipt"], ["#tag", "tag"], ["#card", "card"], ["#end", "board"]];
  const dock = panel("#dock", 976, 235), side = panel("#side", 330, 560), tag = panel("#tag", 150, 44), card = panel("#card", 236, 90), end = panel("#end", 140, 60);
  P.dress(doc, T, th); P.flush(); P.dress(doc, T, th); P.dress(doc, T, th);
  const plies = el => el.kids.filter(k => k.className === "olp-ply");
  assert.deepEqual([dock, side].map(el => plies(el).length), [1, 1], "大面板补一层（叫几次都只一个）");
  assert.deepEqual(plies(dock)[0].attrs, { "aria-hidden": "true" }, "读屏不念");
  assert.deepEqual([tag, card, end].map(el => el.kids.length), [0, 0, 0], "小纸片（影子挂在自己身上）、按钮不补");
  // 被拿掉了（面板里面整块重画）：下一次 dress 再补一个
  plies(dock)[0].parentNode = null; dock.kids.length = 0;
  P.dress(doc, T, th);
  assert.equal(plies(dock).length, 1, "再补上");
  // 配色变量：每一套都有，名字一样
  const day = P.themeVars({ time: "day", weather: "none" }), snow = P.themeVars({ time: "night", weather: "snow" });
  assert.equal(day["--olp-tile"], A.tile + "px");
  assert.equal(day["--olp-ply-fx"], "drop-shadow(2px 5px 3.5px rgba(0, 0, 0, 0.42)) drop-shadow(-1px 1px 1px rgba(0, 0, 0, 0.22))", "两层影子（模糊按 canvas 的一半）");
  assert.equal(snow["--olp-frost"], A.weather.snow.frost, "雪天：纸边一层霜");
  assert.match(snow["--olp-frost"], /^inset /, "霜是内阴影");
  assert.equal(day["--olp-frost"], "inset 0 0 0 transparent", "别的天气没有");
  assert.deepEqual(Object.keys(snow).sort(), Object.keys(day).sort());
});

test("#321 换配色（夜里下雪 → 白天起雾 → 回到夜里下雪）：换到没画过的一套才画那一套的每一种纸各一张，回到画过的那一套不再画，直接换回那一张", () => {
  const { doc, log, panel } = paperDoc(), T = [["#dock", "dock"], ["#tag", "tag"]];
  const a = { time: "night", weather: "snow" }, b = { time: "day", weather: "fog" };
  const dock = panel("#dock", 976, 235);
  panel("#tag", 150, 44);
  P.dress(doc, T, a); P.flush();
  const first = texUrl(dock);
  assert.equal(log.canvases, kindsN());
  P.dress(doc, T, b);
  assert.equal(texUrl(dock), first, "新的一套画好之前照旧贴着上一套");
  assert.equal(P.flush(), kindsN());
  assert.notEqual(texUrl(dock), first, "画好换上");
  P.dress(doc, T, a);
  assert.equal(texUrl(dock), first, "回到画过的那一套：马上换回那一张");
  assert.deepEqual([P.flush(), log.canvases], [0, 2 * kindsN()], "一共只画了两套");
});

test("#321 online-paper.css：纸纹平铺（--olp-tile、repeat，不再拉到 100% 100%）；撕边 clip-path、霜是内阴影；.olp-ply 挂 drop-shadow；小纸片的影子挂在自己身上；收起的抽屉也留着影子层", () => {
  const fs = require("node:fs"), path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "..", "online-paper.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /var\(--olp-tex\)[^;]*100% 100%/, "纹理不再拉伸");
  assert.doesNotMatch(css, /--olp-pad/, "纹理不再比面板大一圈（影子不画进位图）");
  const before = /\[data-olp-tex\]::before \{([^}]*)\}/.exec(css);
  assert.ok(before, "面板的纸纹那一层");
  assert.match(before[1], /background: var\(--olp-tex\) 0 0 \/ var\(--olp-tile, 256px\) repeat;/);
  assert.match(before[1], /inset: 0;/);
  assert.match(before[1], /clip-path: var\(--olp-clip, none\);/);
  assert.match(before[1], /box-shadow: var\(--olp-frost, none\);/);
  assert.match(css, /:is\(\.olp-tools-b, \.olp-menu-b, \.summonbtn, \.endturn\)\[data-olp-tex\] \{[^}]*background-size: var\(--olp-tile, 256px\) !important; background-repeat: repeat !important;/, "按钮：平铺当底图");
  assert.match(css, /\[data-olp-tex\] > \.olp-ply \{[^}]*z-index: -2;[^}]*filter: var\(--olp-ply-fx, none\);/, "影子层在纸下面、挂 drop-shadow");
  assert.match(css, /\[data-olp-tex\] > \.olp-ply::before \{[^}]*clip-path: var\(--olp-clip, none\);/, "影子跟着撕边");
  assert.match(css, /:is\(\.olp-tag-card, \.olp-move, \.pm, \.olp-party-tools \.ol-button, \.sk\)\[data-olp-tex\] \{ filter: var\(--olp-ply-fx, none\); \}/, "小纸片的影子挂在自己身上");
  assert.match(css, /\.ol-side\[data-olp-tex\] > \.olp-ply \{ display: block !important; \}/, "收起的抽屉（里面别的都藏起来）也留着影子层");
  assert.doesNotMatch(css, /shadowBlur/);
});

test("新加的 HTML 里没有坚毅生命：顶栏、吊牌、下拉只拿传进来的公开字段", () => {
  const all = P.shellHtml() + P.topHtml({ room: "R", turnNo: 1, weather: "常态", cams: [{ label: "远" }] }) + P.tagsHtml([{ index: 0, actor: "a", name: "甲", owner: "p" }]);
  assert.doesNotMatch(all, /shp|坚毅/);
});
