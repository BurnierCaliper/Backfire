// 单机战斗画面的「纸片风」界面（#339，game-paper.js / game-paper.css；和联机玩家共用 paper-ui.js / online-paper.css）——不用浏览器的部分：
//   · 什么时候是单机的纸片画面（战斗画面 + 新画面建好了 + 不是联机玩家）；顶栏写什么模式；吊牌（一个人打 / 热座）
//   · 旧顶栏里每一个按钮、下拉框都在「工具 ▾」的分组里（或者是挪到胶带上的字）——以后顶栏多了按钮这里会提醒
//   · 新画面关着一条都套不上：game-paper.css 每条规则都挂在 body.ol-paper.g-paper 下面；online-paper.css 给单机加的选择器也是
//   · 联机和单机共用一份（paper-ui.js）：顶栏 / 吊牌的 HTML 联机的样子一个字没变；新加的 HTML 里没有坚毅生命
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../paper-ui.js");
const GP = require("../game-paper.js");
const OP = require("../online-paper.js");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("什么时候是单机的纸片画面：战斗画面、单机的新画面建好了（#g-app.hd2d-on）、不是联机玩家；新画面关着 / 还在加载、别的画面、联机玩家都不是", () => {
  const on = { screen: "battle", on3d: true, onlinePlayer: false };
  assert.equal(GP.active(on), true);
  assert.equal(GP.active({ ...on, on3d: false }), false, "新画面关着 / 还在加载 / 打不开：旧画面一点不变");
  assert.equal(GP.active({ ...on, onlinePlayer: true }), false, "联机玩家的战斗画面归 online-paper.js");
  for (const s of ["title", "run", "trpg", "party", undefined]) assert.equal(GP.active({ ...on, screen: s }), false, String(s));
  assert.equal(GP.active(null), false);
  assert.equal(GP.GPAPER.bodyClass, "g-paper");
  assert.equal(GP.GPAPER.paperClass, "ol-paper", "和联机共用的纸片样子挂在同一个类下面");
});

test("顶栏最前面写模式：联机跑团 / 联机单局（房主）、热座、跑团、训练场、单人模式、单局、自定义战斗；文字都在配置表里", () => {
  const M = GP.GPAPER.text.modes;
  assert.equal(GP.modeOf({ host: true }), M.host);
  assert.equal(GP.modeOf({ host: true, hostRogue: true, hotseat: true, trpg: true }), M.hostRogue, "房主优先");
  assert.equal(GP.modeOf({ hotseat: true, trpg: true }), M.hotseat);
  assert.equal(GP.modeOf({ trpg: true }), M.trpg);
  assert.equal(GP.modeOf({ training: true }), M.training);
  assert.equal(GP.modeOf({ rogue: true }), M.rogue);
  assert.equal(GP.modeOf({ rogue: true, solo: true }), M.solo);
  assert.equal(GP.modeOf({}), M.custom);
  assert.deepEqual([M.host, M.hostRogue, M.trpg, M.rogue, M.solo], ["联机跑团", "联机单局", "跑团", "单局", "单人模式"]);
});

test("吊牌：一个人打的时候是我方每个人（行动中 / 待行动 / 已行动 / 失衡 / 倒下），点牌子 = 选这个人；热座 / 联机房主是热座栏的行动顺序，⇅ 是热座栏原来的按钮", () => {
  const S = GP.GPAPER.text.status;
  const list = [{ id: "a", name: "瑞比", face: "<i></i>", on: true }, { id: "b", name: "结人", spent: true }, { id: "c", name: "绯秋", stunned: true }, { id: "d", name: "灯", down: true }, { id: "e", name: "柯尔特" }];
  const s = GP.soloSlots(list, { acting: true });
  assert.deepEqual(s.map(x => [x.actor, x.current, x.done, x.owner, !!x.pick]),
    [["a", true, false, S.acting, true], ["b", false, true, S.spent, true], ["c", false, true, S.stunned, true], ["d", false, true, S.down, false], ["e", false, false, S.ready, true]]);
  assert.equal(GP.soloSlots(list, { acting: false })[0].current, false, "敌人回合：没有谁在行动");
  const h = OP.tagsHtml(s);
  assert.match(h, /<li class="olp-tag on" data-olp-slot="0" data-olp-pick="a"/);
  assert.doesNotMatch(h, /data-olp-pick="d"/, "倒下的点不了");
  assert.doesNotMatch(h, /data-olp-swap/, "一个人打不用排顺序：没有 ⇅");
  // 热座 / 联机房主：和联机玩家的吊牌（online-ui.js · paperSlots）同一个算法
  const view = { phase: "acting", currentUnitId: "a", playerId: "p1", players: [{ id: "p1", name: "主持人" }, { id: "p2", name: "乙" }],
    order: [{ actor: "a", owner: "p1", current: true }, { actor: "b", owner: "p2", locked: true }, null], units: [{ id: "a", name: "瑞比" }, { id: "b", name: "结人" }] };
  const moves = new Map([[0, [{ hs: "move", label: "延后" }, { hs: "moveStart", label: "换位" }]]]);
  const hs = GP.hotseatSlots(view, new Map([["a", { name: "瑞比", face: "<i></i>" }]]), moves);
  assert.deepEqual(hs.map(x => [x.actor, x.name, x.owner, x.current, x.locked, x.vacated, x.mine, x.moves.length]),
    [["a", "瑞比", "主持人", true, false, false, true, 2], ["b", "结人", "乙", false, true, false, false, 0], ["", "", "", false, false, true, false, 0]]);
  assert.match(OP.tagsHtml(hs), /data-olp-swap="0"/, "热座栏这一格有按钮：带 ⇅");
  assert.deepEqual(GP.hotseatSlots({ phase: "setup", order: [{ actor: "a" }] }), [], "没开打（分配中）：不挂吊牌");
});

test("旧顶栏（game.html 的 .g-top）里每一个按钮、下拉框、链接都在「工具 ▾」的分组里；只是字的那几块（回合、我方 / 敌人行动、天气、时钟、遭遇）挪到胶带上；一个都不漏、不重复", () => {
  const html = read("game.html"), top = html.slice(html.indexOf('<header class="g-top">'), html.indexOf("</header>", html.indexOf('<header class="g-top">')));
  const ids = [...top.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 25, "量到了顶栏：" + ids.length);
  const grouped = GP.GPAPER.tools.flatMap(g => g.ids), hide = GP.GPAPER.hide;
  assert.deepEqual(ids.filter(id => !grouped.includes(id) && !hide.includes(id)), [], "这些在顶栏里，「工具 ▾」里却没有");
  assert.deepEqual(grouped.filter(id => !ids.includes(id)), [], "配置里写了顶栏没有的");
  assert.equal(new Set(grouped.concat(hide)).size, grouped.length + hide.length, "不重复");
  // 交互的东西（按钮、下拉框、链接）都在分组里；挪到胶带上的都是只读的字
  const interactive = [...top.matchAll(/<(button|select|a)\b[^>]*\sid="([^"]+)"/g)].map(m => m[2]);
  assert.deepEqual(interactive.filter(id => !grouped.includes(id) && id !== "g-log-open"), [], "按钮都进了下拉");
  assert.ok(hide.every(id => !interactive.includes(id) || id === "g-log-open"), "藏起来的只有字（和手机上的「记录」：抽屉自己的竖标签代替它）");
  // 每组一个小标题，文字在配置表里
  assert.deepEqual(GP.GPAPER.tools.map(g => g.head), ["战斗", "查看", "布置 · 主持人", "其他"]);
});

test("新画面关着时一条都套不上：game-paper.css 每条规则都挂在 body.ol-paper.g-paper 下面；online-paper.css 里给单机加的选择器也挂在 body.ol-paper.g-paper 下面；game.html 加载顺序", () => {
  const selectors = (file) => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, ""), out = [];
    const split = sel => { const o = []; let depth = 0, cur = ""; for (const ch of sel) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { o.push(cur); cur = ""; } else cur += ch; } o.push(cur); return o; };
    css.replace(/([^{}@;]+)\{[^{}]*\}/g, (m, sel) => { split(sel).map(s => s.trim()).filter(Boolean).forEach(s => out.push(s)); return m; });
    return out.filter(s => !/^(from|to|\d+%)$/.test(s));
  };
  const own = selectors("game-paper.css");
  assert.ok(own.length > 30, "拆出了规则：" + own.length);
  assert.deepEqual(own.filter(s => !/^body\.ol-paper\.g-paper\b/.test(s)), [], "game-paper.css 这些选择器没挂在 body.ol-paper.g-paper 下面");
  const shared = selectors("online-paper.css").filter(s => /\.g-app(?![\w-])|#g-paper(?![\w-])|#g-log(?![\w-])|\.g-top(?![\w-])/.test(s));
  assert.ok(shared.length > 40, "online-paper.css 给单机加的选择器：" + shared.length);
  assert.deepEqual(shared.filter(s => !/^body\.ol-paper(\.g-paper)?\b/.test(s)), []);
  assert.deepEqual(shared.filter(s => /\.g-app/.test(s) && !/^body\.ol-paper\.g-paper\b/.test(s)), [], "单机的 .g-app 那一份都挂在 .g-paper 下面（联机玩家的画面里套不上）");
  // 加载顺序：样式在 online-paper.css 后面；paper-ui.js 在 online-paper.js、game-paper.js 前面
  const html = read("game.html"), at = s => html.indexOf(s);
  assert.ok(at('<link rel="stylesheet" href="online-paper.css" />') > 0 && at('<link rel="stylesheet" href="game-paper.css" />') > at('<link rel="stylesheet" href="online-paper.css" />'));
  assert.ok(at('<script src="paper-ui.js"></script>') > 0 && at('<script src="paper-ui.js"></script>') < at('<script src="online-paper.js"></script>') && at('<script src="online-paper.js"></script>') < at('<script src="game-paper.js"></script>'));
});

test("联机和单机共用 paper-ui.js 那一份：配色、纸纹、收据是同一个对象；联机的顶栏 HTML 一个字没变，单机多写的（遭遇、我方 / 敌人行动、准备中）只在给了的时候写", () => {
  assert.equal(OP.PAPER.palette, UI.BASE.palette, "配色只有一份");
  assert.equal(GP.GPAPER.palette, UI.BASE.palette);
  assert.equal(OP.PAPER.art.kinds, UI.BASE.art.kinds, "纸纹只有一份");
  assert.equal(GP.GPAPER.art.kinds, UI.BASE.art.kinds);
  assert.equal(OP.texture, UI.texture);
  assert.notEqual(OP.PAPER.art.targets, GP.GPAPER.art.targets, "贴纸纹的面板各家一份");
  Object.values(GP.GPAPER.art.targets).forEach(([sel, kind]) => kind.split("|").forEach(k => assert.ok(UI.BASE.art.kinds[k], sel + " → " + k)));
  assert.notEqual(OP.PAPER.keys.drawer, GP.GPAPER.keys.drawer, "抽屉收起 / 展开各记各的");
  // 联机的顶栏：和抽出来之前一样（tests/online-paper.test.js 也逐字对着）
  const online = OP.topHtml({ room: "SA3X7C", turnNo: 3, weather: "常态" });
  assert.match(online, /^<div class="olp-top olp-sheet" data-paper="tapebar"><span class="olp-title">联机跑团<\/span><span class="olp-room olp-stamp" title="房间码">SA3X7C<\/span><span class="olp-meta olp-turn">第 3 回合<\/span><span class="olp-meta olp-weather">常态<\/span><span class="olp-right">/);
  assert.match(online, /aria-controls="olp-tools"/);
  // 单机：模式、遭遇、「准备中」、我方 / 敌人行动
  const solo = GP.PAPER.text && UI.make(GP.GPAPER).topHtml({ title: "单局", sub: "遭遇 外城区巷战", turnText: "准备中", phase: { text: "敌人行动", enemy: true }, weather: "沙暴", night: true });
  assert.match(solo, /<span class="olp-title">单局<\/span><span class="olp-meta olp-sub">遭遇 外城区巷战<\/span><span class="olp-meta olp-turn">准备中<\/span><span class="olp-meta olp-phase enemy">敌人行动<\/span><span class="olp-meta olp-weather">夜 · 沙暴<\/span>/);
  assert.match(solo, /aria-controls="g-paper-tools"/, "「工具」按钮指着旧顶栏变的下拉");
  // 新加的 HTML 里没有坚毅生命
  const all = solo + OP.tagsHtml(GP.soloSlots([{ id: "a", name: "瑞比" }], { acting: true })) + UI.make(GP.GPAPER).shellHtml({ tools: false });
  assert.doesNotMatch(all, /shp|坚毅/);
});
