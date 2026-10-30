// High Flux（#485）· 规则引擎 counter-cards.js：计分（克制表 + 天气，特别是微光、酸雨对装甲）、每轮流程、
// 庄家天气行动 / 偷看、暗出、下注（最低额 = 轮数、最多加注 2 次、过牌 / 弃牌、不封顶——跟不起要先借、跟注后的追加窗口，#496）、玩家翻天气 / 暗弃跳过 / 常态、
// 相位全押封顶、平局滚存、分档赔付、看不到对方的牌、赌场接口；克制表（得分）和手里元素牌的悬停预览
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const c = H.load();
vm.runInContext(read("counter-cards.js"), c, { filename: "counter-cards.js" });
const CC = c.CounterCards;
const C = CC.CC_CONFIG;
const J = v => JSON.parse(JSON.stringify(v));
const A = (g, side, type, extra) => CC.act(g, side, Object.assign({ type }, extra || {}));
// 对照 engine.js 原函数
const mod = (el, layer, w, acidArmor) => vm.runInContext(`chartMod(${JSON.stringify(el)}, ${JSON.stringify(layer)}, ${JSON.stringify(w)}, null, ${!!acidArmor})`, c);
const wpct = (w, el) => vm.runInContext(`weatherDamagePct(${JSON.stringify(w)}, ${JSON.stringify(el)})`, c);
const ALL_WEATHER = [null].concat(C.weathers);
const DECK = ["thunder", "sand", "glow", "heat", "snow", "acid", "phase"];

/** 打到第一轮下注：庄家天气行动（默认：有天气保留、没有就不动），双方暗出 */
function toBet1(g, dealerCard, playerCard, dw) {
  A(g, "dealer", "weather", { op: dw || (g.weather ? "keep" : "pass") });
  A(g, "dealer", "play", { card: dealerCard });
  A(g, "player", "play", { card: playerCard });
}
/** 这一个下注回合双方都过牌 */
function checks(g) { const first = g.betting.toAct; A(g, first, "check"); A(g, CC.other(first), "check"); }
/** 跟注后开了追加窗口（#496）：双方都放弃追加，窗口关掉、这个下注回合结束 */
function passWindow(g) { if (g.betting && g.betting.window) CC.toAct(g).forEach(side => A(g, side, "pass")); }
/** 跟注，跟完开了追加窗口就都放弃追加 */
function call(g, side) { A(g, side, "call"); passWindow(g); }
/** 打完一整轮：都过牌，玩家翻天气（或 skip 指定的牌） */
function quietRound(g, dealerCard, playerCard, o) {
  o = o || {};
  toBet1(g, dealerCard, playerCard, o.dw);
  checks(g);
  if (o.skip) A(g, "player", "skip", { card: o.skip }); else A(g, "player", "reveal");
  if (g.stage === "normal") A(g, "player", "noNormal");
  if (g.stage === "bet2") checks(g);
}
/** 筹码很少时也能打完一整轮：不借（o.loan = { 一方: 借多少 } 时照借）、天气照 o.dw、能过牌就过牌否则跟注、玩家翻天气、不用常态 */
function playRound(g, dealerCard, playerCard, o) {
  o = o || {};
  const n = g.results.length;
  for (let guard = 0; g.results.length === n && !g.over; guard++) {
    assert.ok(guard < 40, "这一轮打不完：" + g.stage);
    const side = CC.toAct(g)[0];
    switch (g.stage) {
      case "loan": { const amt = o.loan && o.loan[side]; if (amt) A(g, side, "borrow", { amount: amt }); else A(g, side, "noLoan"); break; }
      case "dealerWeather": A(g, "dealer", "weather", { op: o.dw || (g.weather ? "keep" : "pass") }); break;
      case "play": A(g, side, "play", { card: side === "dealer" ? dealerCard : playerCard }); break;
      case "bet1": case "bet2": { const L = CC.legal(g, side); A(g, side, L.some(x => x.type === "check") ? "check" : L.some(x => x.type === "pass") ? "pass" : "call"); break; }
      case "weather": A(g, "player", "reveal"); break;
      case "normal": A(g, "player", "noNormal"); break;
      default: assert.fail("没想到的阶段：" + g.stage);
    }
  }
}
/** DECK 下五轮都打平（雷鸣 / 沙暴 / 微光 / 酷暑 / 雪天里各出一对 0 分的牌）；o.loans[第几轮] = 那一轮开始时谁借多少 */
function fiveTies(g, o) {
  o = o || {};
  const L = (r) => (o.loans || {})[r];
  playRound(g, "flesh", "ice", { loan: L(1) });
  playRound(g, "sand", "physical", { loan: L(2) });
  playRound(g, "spirit", "harmonic", { loan: L(3) });
  playRound(g, "shield", "energy", { dw: "discard", loan: L(4) });
  playRound(g, "armor", "acid", { loan: L(5) });
}

/* ---------- 计分 ---------- */

test("计分直接取游戏里的克制表和天气数值：7 元素 × 5 层 × 8 种天气（含没有天气）每一格都和 engine.js 一致", () => {
  for (const w of ALL_WEATHER) for (const el of C.elements) for (const ly of C.layers) {
    const ww = w || "none";
    const base = mod(el, ly, ww, false);
    const chart = base > 0.001 ? 1 : base < -0.001 ? -1 : 0;
    const extra = Math.round((wpct(ww, el) + mod(el, ly, ww, ww === "acid") - base) / 0.25);
    assert.equal(CC.chartScore(el, ly, w), chart, `${el}/${ly}/${ww}`);
    assert.equal(CC.weatherScore(el, ly, w), extra, `${el}/${ly}/${ww}`);
    assert.equal(CC.score(el, ly, w), chart + extra, `${el}/${ly}/${ww}`);
  }
});

test("没有天气：克制 +1、劣势 −1、其余 0；物理打肉体是 0（垫牌）", () => {
  assert.equal(CC.score("fire", "flesh"), 1);
  assert.equal(CC.score("acid", "armor"), 1);
  assert.equal(CC.score("electric", "shield"), 1);
  assert.equal(CC.score("energy", "spirit"), 1);
  assert.equal(CC.score("harmonic", "sand"), 1);
  assert.equal(CC.score("fire", "armor"), -1);
  assert.equal(CC.score("harmonic", "flesh"), -1);
  assert.equal(CC.score("ice", "spirit"), -1);
  assert.equal(CC.score("physical", "flesh"), 0);
  assert.equal(CC.score("physical", "sand"), 0);
  assert.equal(CC.score("ice", "flesh"), 0);
  // 克制是 +50%，也只记 +1
  assert.deepEqual(J(CC.scoreParts("fire", "flesh", null)), { chart: 1, weather: 0, total: 1 });
});

test("微光：能量以外的元素克制关系全部反转，能量 +1 且不反转", () => {
  assert.equal(CC.score("fire", "flesh", "glow"), -1);       // 克制 → 劣势
  assert.equal(CC.score("fire", "armor", "glow"), 1);        // 劣势 → 克制
  assert.equal(CC.score("acid", "armor", "glow"), -1);
  assert.equal(CC.score("physical", "armor", "glow"), 1);
  assert.equal(CC.score("harmonic", "sand", "glow"), -1);
  assert.equal(CC.score("ice", "spirit", "glow"), 1);
  assert.equal(CC.score("physical", "flesh", "glow"), 0);    // 0 反转还是 0
  assert.deepEqual(J(CC.scoreParts("energy", "spirit", "glow")), { chart: 1, weather: 1, total: 2 });
  assert.deepEqual(J(CC.scoreParts("energy", "armor", "glow")), { chart: -1, weather: 1, total: 0 });
});

test("酸雨：酸、电 +1，能量 0，其余 −1；酸、冰以外的元素打装甲额外 +1", () => {
  // 打装甲
  assert.deepEqual(J(CC.scoreParts("fire", "armor", "acid")), { chart: -1, weather: 0, total: -1 });       // −1 酸雨 +1 装甲
  assert.deepEqual(J(CC.scoreParts("electric", "armor", "acid")), { chart: -1, weather: 2, total: 1 });    // +1 酸雨 +1 装甲
  assert.deepEqual(J(CC.scoreParts("energy", "armor", "acid")), { chart: -1, weather: 1, total: 0 });      // 0 酸雨 +1 装甲
  assert.deepEqual(J(CC.scoreParts("physical", "armor", "acid")), { chart: -1, weather: 0, total: -1 });
  assert.deepEqual(J(CC.scoreParts("harmonic", "armor", "acid")), { chart: -1, weather: 0, total: -1 });
  assert.deepEqual(J(CC.scoreParts("acid", "armor", "acid")), { chart: 1, weather: 1, total: 2 });         // 酸不吃装甲那一项
  assert.deepEqual(J(CC.scoreParts("ice", "armor", "acid")), { chart: 0, weather: -1, total: -1 });        // 冰也不吃
  // 打别的层没有装甲那一项
  assert.equal(CC.score("fire", "flesh", "acid"), 0);
  assert.equal(CC.score("electric", "shield", "acid"), 2);
  assert.equal(CC.score("energy", "spirit", "acid"), 1);
  assert.equal(CC.score("harmonic", "sand", "acid"), 0);
});

test("酷暑 / 雪天 / 雷鸣 / 沙暴 / 相位的天气修正", () => {
  assert.equal(CC.score("fire", "flesh", "heat"), 2);
  assert.equal(CC.score("acid", "armor", "heat"), 2);
  assert.equal(CC.score("ice", "flesh", "heat"), -1);
  assert.equal(CC.score("ice", "flesh", "snow"), 1);
  assert.equal(CC.score("physical", "flesh", "snow"), 1);
  assert.equal(CC.score("fire", "flesh", "snow"), 0);
  assert.equal(CC.score("acid", "armor", "snow"), 0);
  assert.equal(CC.score("electric", "shield", "thunder"), 2);
  assert.equal(CC.score("energy", "spirit", "thunder"), 2);
  assert.equal(CC.score("electric", "shield", "sand"), 0);
  assert.equal(CC.score("acid", "armor", "sand"), 0);
  for (const el of C.elements) for (const ly of C.layers) assert.equal(CC.score(el, ly, "phase"), CC.score(el, ly, null));
});

test("现在的克制表和天气数值下单轮分差只在 −2…+2（所以分档赔付只有差 1、差 2 两档：主人 10/30 删掉了打不出来的「差 3 及以上」）", () => {
  const all = [];
  for (const w of ALL_WEATHER) for (const el of C.elements) for (const ly of C.layers) all.push(CC.score(el, ly, w));
  assert.equal(Math.max(...all), 2);
  assert.equal(Math.min(...all), -2);
});

/* ---------- 克制表（得分）：牌局中随时能开的完整克制表（作者 10/29 在 PR #486 的评论） ---------- */

test("克制表（得分）：格式同 matchup.js · matchupChart（行 = 7 张元素牌、列 = 5 张层牌），每一格就是这个天气下的 score()，天气改过的格子记着原来的分", () => {
  const matchup = vm.runInContext("matchupChart('none')", c);
  for (const w of ALL_WEATHER) {
    const ch = CC.chart(w);
    assert.equal(ch.unit, "score", "格子写得分，不写百分比");
    assert.equal(ch.weather, w || "none");
    assert.equal(ch.weatherName, w ? C.weatherNames[w] : "常态");
    assert.deepEqual(Object.keys(ch).filter(k => k in matchup).sort(), Object.keys(matchup).sort(), "matchupChart 有的字段都有");
    assert.deepEqual(J(ch.rows.map(r => r.id)), J(C.elements));
    assert.deepEqual(J(ch.cols.map(k => [k.id, k.name])), J(C.layers.map(ly => [ly, CC.cardName(ly)])), "列名用层牌的名字");
    assert.ok(ch.rows.every(r => r.pct === 0 && r.pctBase === 0), "天气修正算进格子，不放在整行");
    let n = 0;
    C.elements.forEach((el, i) => C.layers.forEach((ly, j) => {
      const x = ch.cells[i][j], s = CC.score(el, ly, w), was = CC.score(el, ly, null);
      assert.deepEqual([x.row, x.col, x.value, x.base], [el, ly, s, was], `${el}/${ly}/${w}`);
      assert.equal(x.kindId, s > 0 ? "adv" : s < 0 ? "dis" : "neu", "按得分正负上色");
      assert.equal(x.kind, s > 0 ? "玩家赢" : s < 0 ? "庄家赢" : "平局");
      assert.equal(x.baseKind, was > 0 ? "玩家赢" : was < 0 ? "庄家赢" : "平局");
      assert.equal(x.changed, s !== was);
      assert.equal(x.chart + x.weather, s);
      if (x.changed) n++;
    }));
    assert.equal(ch.changed.length, n);
    if (!w || w === "phase") assert.equal(n, 0, "没有天气、相位：一格都没改");
    assert.match(ch.notes[0], /^得分 = 克制（克制 \+1、被克制 −1、普通 0）\+ 天气修正（每 25% 记 ±1）。正分玩家赢，负分庄家赢，0 平局/);
  }
  const none = CC.chart(null);
  assert.deepEqual(J(none.legend), { adv: "玩家赢（正分）", dis: "庄家赢（负分）", neu: "平局（0）" });
  assert.equal(none.corner, "元素 \\ 层");
  assert.equal(none.tag, "High Flux 得分");
  assert.equal(CC.chart("没有这种天气").weather, "none");
});

test("克制表（得分）：格子的原因写这一分怎么来的——酷暑火打肉体 +1 → +2、微光反转、酸雨打装甲另 +1；表下面写这个天气的修正，相位写全押", () => {
  const cellOf = (ch, el, ly) => ch.cells[C.elements.indexOf(el)][C.layers.indexOf(ly)];
  const none = CC.chart(null);
  assert.equal(cellOf(none, "fire", "flesh").reason, "克制 +1");
  assert.equal(cellOf(none, "physical", "flesh").reason, "普通 0");
  assert.equal(none.notes.length, 1, "没有天气：只有计分规则");
  const heat = CC.chart("heat"), hot = cellOf(heat, "fire", "flesh");
  assert.deepEqual([hot.base, hot.value, hot.changed], [1, 2, true]);
  assert.equal(hot.reason, "克制 +1；酷暑：火 +1");
  assert.ok(heat.notes.includes("酷暑天气修正：火、酸 +1；冰 −1"));
  const glow = CC.chart("glow"), flip = cellOf(glow, "fire", "flesh");
  assert.deepEqual([flip.base, flip.value, flip.kind, flip.baseKind], [1, -1, "庄家赢", "玩家赢"]);
  assert.equal(flip.reason, "被克制 −1（微光：克制关系反转）");
  assert.equal(cellOf(glow, "energy", "spirit").reason, "克制 +1；微光：能量 +1", "能量不反转");
  assert.ok(glow.notes.includes("微光：克制关系反转（能量除外）"));
  const acid = CC.chart("acid"), elec = cellOf(acid, "electric", "armor");
  assert.deepEqual([elec.base, elec.value], [-1, 1]);
  assert.equal(elec.reason, "被克制 −1；酸雨：电 +1；酸雨：打装甲另 +1");
  assert.deepEqual([cellOf(acid, "ice", "armor").value, cellOf(acid, "acid", "armor").value], [-1, 2], "酸、冰打装甲不另加");
  assert.ok(acid.notes.includes("酸雨：火、电、能量、物理、谐波打装甲另 +1"));
  assert.ok(acid.notes.includes("酸雨天气修正：火、冰、物理、谐波 −1；酸、电 +1"));
  assert.ok(CC.chart("phase").notes.some(n => /^相位：不改得分；翻到相位的那一轮双方全押/.test(n)));
});

test("悬停预览（作者 10/29 在 PR #486 的评论）：cardChart(元素牌, 天气) 就是克制表 chart(天气) 里这张牌的那一行——打肉体、装甲、护盾、沙尘、星灵的得分和计分 score()、克制表完全一致（微光反转、酸雨打装甲也是）；常态、层牌没有", () => {
  for (const w of ALL_WEATHER) {
    const ch = CC.chart(w);
    C.elements.forEach((el, i) => {
      const p = CC.cardChart(el, w);
      assert.deepEqual([p.card, p.name, p.weather, p.weatherName], [el, CC.cardName(el), w || "none", ch.weatherName], `${el}/${w}`);
      assert.deepEqual(J(p.cells.map(x => [x.layer, x.name])), J(C.layers.map(ly => [ly, CC.cardName(ly)])), "五种层，次序同克制表的列");
      p.cells.forEach((x, j) => {
        const cell = ch.cells[i][j];
        assert.equal(x.value, CC.score(el, C.layers[j], w), `${el}/${C.layers[j]}/${w}：和计分一致`);
        assert.deepEqual([x.value, x.kindId, x.kind, x.base, x.changed, x.reason], [cell.value, cell.kindId, cell.kind, cell.base, cell.changed, cell.reason], `${el}/${C.layers[j]}/${w}：和克制表那一格一致`);
      });
    });
  }
  const row = (el, w) => J(CC.cardChart(el, w).cells.map(x => x.value));
  assert.deepEqual(row("fire", null), [1, -1, 0, 0, -1], "没有天气：火克肉体、被装甲和星灵克");
  assert.deepEqual(row("fire", "heat"), [2, 0, 1, 1, 0], "酷暑：火 +1");
  assert.deepEqual(row("fire", "glow"), [-1, 1, 0, 0, 1], "微光：克制关系反转");
  assert.deepEqual(row("energy", "glow"), [1, 0, 1, 1, 2], "微光：能量不反转，另 +1");
  assert.deepEqual(row("electric", "acid"), [1, 1, 2, 0, 1], "酸雨：电 +1，打装甲另 +1");
  assert.deepEqual(row("ice", "acid"), [-1, -1, -1, -1, -2], "酸雨：冰 −1，打装甲不另加");
  assert.deepEqual(row("fire", "phase"), row("fire", null), "相位不改得分");
  assert.equal(CC.cardChart("normal", "heat"), null, "常态不是元素牌");
  assert.equal(CC.cardChart("flesh", null), null, "层牌没有");
  assert.equal(CC.cardChart("fire", "没有这种天气").weather, "none");
});

/* ---------- 开局 ---------- */

test("开局：双方各 50 枚筹码；庄家 5 张层牌，玩家 7 张元素牌 + 常态；天气堆 7 张洗混；第 1 轮先下底注", () => {
  assert.equal(C.startChips, 50);
  const g = CC.newGame({ seed: "开局" });
  assert.deepEqual(J(g.sides.dealer.hand), ["flesh", "armor", "shield", "sand", "spirit"]);
  assert.deepEqual(J(g.sides.player.hand), ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic", "normal"]);
  assert.deepEqual(J(g.deck.slice().sort()), J(C.weathers.slice().sort()));
  assert.equal(g.round, 1);
  assert.equal(g.sides.dealer.chips, 49); assert.equal(g.sides.player.chips, 49);
  assert.equal(g.sides.dealer.bet, 1); assert.equal(g.sides.player.bet, 1);
  assert.equal(g.weather, null);
  assert.deepEqual(J(CC.toAct(g)), ["dealer"]);
  // 同一个种子洗出来一样；换种子会变
  assert.deepEqual(J(CC.newGame({ seed: "开局" }).deck), J(g.deck));
  const orders = new Set(Array.from({ length: 12 }, (_, i) => CC.newGame({ seed: "S" + i }).deck.join()));
  assert.ok(orders.size > 1);
});

/* ---------- 庄家天气行动 ---------- */

test("庄家天气行动：没有天气时偷看堆顶（只有庄家看到），放回原位或压到牌堆底，玩家看得到选了哪种", () => {
  const g = CC.newGame({ seed: "偷看", deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] });
  assert.deepEqual(J(CC.legal(g, "dealer").map(o => o.op)), ["peek", "pass"]);
  A(g, "dealer", "weather", { op: "peek" });
  assert.equal(g.stage, "dealerPeek");
  const dv = CC.view(g, "dealer");
  assert.equal(dv.peek.card, "glow");
  assert.equal(dv.deckTop, "glow");
  assert.ok(dv.log.some(e => e.t === "peekCard" && e.card === "glow"));
  const pv = CC.view(g, "player");
  assert.equal(pv.peek, undefined);
  assert.doesNotMatch(JSON.stringify(pv), /glow|微光/);
  A(g, "dealer", "place", { where: "bottom" });
  assert.deepEqual(J(g.deck), ["heat", "snow", "acid", "thunder", "sand", "phase", "glow"]);
  const pv2 = CC.view(g, "player");
  assert.ok(pv2.log.some(e => /偷看了天气堆顶的一张，压到了牌堆底/.test(e.text)));
  assert.doesNotMatch(JSON.stringify(pv2), /glow|微光/);
  const dv2 = CC.view(g, "dealer");
  assert.equal(dv2.deckTop, null); assert.equal(dv2.deckBottom, "glow");
  assert.equal(g.stage, "play");
  // 放回原位
  const g2 = CC.newGame({ seed: "偷看2", deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] });
  A(g2, "dealer", "weather", { op: "peek" }); A(g2, "dealer", "place", { where: "top" });
  assert.equal(g2.deck[0], "glow");
  assert.ok(CC.view(g2, "player").log.some(e => /放回原位/.test(e.text)));
  assert.equal(CC.view(g2, "dealer").deckTop, "glow");
});

test("庄家天气行动：场上有天气时弃掉或保留（保留以后还可以接着偷看：peek）；弃掉的天气离场", () => {
  const g = CC.newGame({ seed: "弃天气", deck: DECK });
  quietRound(g, "flesh", "ice");                     // 第 1 轮翻出雷鸣（冰打肉体 0，平局滚存）
  assert.equal(g.weather, "thunder");
  assert.deepEqual(J(CC.legal(g, "dealer").map(o => o.op)), ["discard", "keep", "peek"]);
  A(g, "dealer", "weather", { op: "discard" });
  assert.equal(g.weather, null);
  assert.deepEqual(J(g.gone), ["thunder"]);
  assert.ok(CC.view(g, "player").log.some(e => /庄家弃掉了场上的天气〔雷鸣〕/.test(e.text)));
});

/* ---------- 庄家天气行动：保留以后也能偷看、按顺序往下看（#502，主人 10/30） ---------- */

test("庄家天气行动（#502）：场上有天气时保留以后还能接着偷看下一张（peek = 保留 + 偷看），看完放回原位或压到牌堆底；不看就是 keep", () => {
  const g = CC.newGame({ seed: "保留偷看", deck: DECK });
  quietRound(g, "flesh", "ice");                     // 第 1 轮翻出雷鸣；堆里剩沙暴、微光、酷暑、雪天、酸雨、相位
  assert.equal(g.weather, "thunder");
  A(g, "dealer", "weather", { op: "peek" });
  assert.equal(g.weather, "thunder", "保留以后偷看：天气留在场上");
  assert.deepEqual(J(g.gone), []);
  assert.equal(g.stage, "dealerPeek");
  assert.deepEqual(J(CC.legal(g, "dealer").map(o => o.where)), ["top", "bottom"]);
  const dv = CC.view(g, "dealer");
  assert.deepEqual(J(dv.peek), { card: "sand", where: null, at: 0 });
  assert.ok(dv.log.some(e => e.t === "peekCard" && e.to === "dealer" && e.card === "sand" && e.text === "你偷看到天气堆顶是〔沙暴〕。"));
  A(g, "dealer", "place", { where: "bottom" });
  assert.deepEqual(J(g.deck), ["glow", "heat", "snow", "acid", "phase", "sand"]);
  assert.equal(g.stage, "play");
  assert.deepEqual(J(CC.view(g, "dealer").deckSeen), { top: [], bottom: ["sand"], unseen: 5 });
  assert.equal(CC.view(g, "dealer").deckBottom, "sand");
  // 放回原位
  const g2 = CC.newGame({ seed: "保留偷看2", deck: DECK });
  quietRound(g2, "flesh", "ice");
  A(g2, "dealer", "weather", { op: "peek" }); A(g2, "dealer", "place", { where: "top" });
  assert.equal(g2.weather, "thunder");
  assert.deepEqual(J(g2.deck), ["sand", "glow", "heat", "snow", "acid", "phase"]);
  assert.deepEqual(J(CC.view(g2, "dealer").deckSeen), { top: ["sand"], bottom: [], unseen: 5 });
  assert.equal(CC.view(g2, "dealer").deckTop, "sand");
  // 保留、不看（keep）：和以前一样，直接暗出
  const g3 = CC.newGame({ seed: "保留不看", deck: DECK });
  quietRound(g3, "flesh", "ice");
  A(g3, "dealer", "weather", { op: "keep" });
  assert.equal(g3.stage, "play");
  assert.equal(g3.weather, "thunder");
  assert.equal(g3.peek, null);
  assert.deepEqual(J(CC.view(g3, "dealer").deckSeen), { top: [], bottom: [], unseen: 6 });
});

test("庄家天气行动（#502）：玩家只看得到庄家做了哪种操作（弃掉 / 保留 / 偷看后放回原位 / 偷看后压到牌堆底），看不到那张牌；view 里没有庄家看过的牌", () => {
  const g = CC.newGame({ seed: "只看操作", deck: DECK });
  quietRound(g, "flesh", "ice");                     // 雷鸣
  A(g, "dealer", "weather", { op: "peek" });
  let pv = CC.view(g, "player");
  assert.ok(pv.log.some(e => e.t === "dw" && e.op === "keep" && e.text === "庄家保留了场上的天气〔雷鸣〕。"), "看得到庄家保留了");
  assert.doesNotMatch(JSON.stringify(pv), /sand|沙暴/);
  A(g, "dealer", "place", { where: "bottom" });
  pv = CC.view(g, "player");
  assert.ok(pv.log.some(e => e.t === "dw" && e.op === "peek" && e.where === "bottom" && e.text === "庄家偷看了天气堆顶的一张，压到了牌堆底。"));
  assert.doesNotMatch(JSON.stringify(pv), /sand|沙暴/, "看不到压到牌堆底的是哪张");
  for (const k of ["peek", "deckSeen", "deckTop", "deckBottom"]) assert.ok(!(k in pv), "玩家的 view 里没有 " + k);
  assert.ok(pv.log.every(e => e.t !== "peekCard"), "偷看到的牌只记在庄家的私人记录里");
  // 庄家自己看得到
  const dv = CC.view(g, "dealer");
  assert.ok(dv.log.some(e => e.t === "peekCard" && e.card === "sand"));
  assert.deepEqual(J(dv.deckSeen.bottom), ["sand"]);
});

test("偷看按顺序往下看（#502）：每次看的是庄家自己还没看过的下一张——第 1 轮看了堆顶 A 放回原位，第 2 轮玩家暗弃跳过、A 还在堆顶，第 3 轮再偷看看到的是 A 下面的 B；B 压到堆底以后堆顶还是 A，玩家翻开的是真正的堆顶 A", () => {
  const g = CC.newGame({ seed: "往下看", deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] });
  // 第 1 轮：没有天气，偷看堆顶的 A（微光），放回原位；玩家暗弃跳过
  A(g, "dealer", "weather", { op: "peek" });
  assert.deepEqual(J(CC.view(g, "dealer").peek), { card: "glow", where: null, at: 0 });
  A(g, "dealer", "place", { where: "top" });
  assert.deepEqual(J(CC.view(g, "dealer").deckSeen), { top: ["glow"], bottom: [], unseen: 6 });
  A(g, "dealer", "play", { card: "flesh" }); A(g, "player", "play", { card: "ice" });
  checks(g); A(g, "player", "skip", { card: "fire" }); checks(g);
  // 第 2 轮：庄家不动，玩家又暗弃跳过：A 还在堆顶
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "sand" }); A(g, "player", "play", { card: "physical" });
  checks(g); A(g, "player", "skip", { card: "acid" }); checks(g);
  assert.equal(g.round, 3);
  assert.equal(g.deck[0], "glow");
  assert.equal(CC.view(g, "dealer").deckTop, "glow", "庄家还记得堆顶是 A");
  // 第 3 轮：再偷看，看到的是 A 下面的 B（酷暑），不会又看一遍 A
  A(g, "dealer", "weather", { op: "peek" });
  const dv = CC.view(g, "dealer");
  assert.deepEqual(J(dv.peek), { card: "heat", where: null, at: 1 });
  assert.ok(dv.log.some(e => e.t === "peekCard" && e.card === "heat" && e.at === 1 && e.text === "你偷看到天气堆从上往下第 2 张是〔酷暑〕（上面 1 张你已经看过）。"));
  // 压到堆底：压的是 B 这一张，A 还留在堆顶；庄家记得堆底那张是 B
  A(g, "dealer", "place", { where: "bottom" });
  assert.deepEqual(J(g.deck), ["glow", "snow", "acid", "thunder", "sand", "phase", "heat"]);
  const dv2 = CC.view(g, "dealer");
  assert.deepEqual(J(dv2.deckSeen), { top: ["glow"], bottom: ["heat"], unseen: 5 });
  assert.equal(dv2.deckTop, "glow"); assert.equal(dv2.deckBottom, "heat");
  const pv = CC.view(g, "player");
  assert.ok(pv.log.some(e => e.t === "dw" && e.op === "peek" && e.at === 1 && e.text === "庄家偷看了天气堆从上往下第 2 张，压到了牌堆底。"));
  assert.doesNotMatch(JSON.stringify(pv), /glow|微光|heat|酷暑/);
  // 玩家翻开的总是真正的堆顶：A
  A(g, "dealer", "play", { card: "spirit" }); A(g, "player", "play", { card: "harmonic" });
  checks(g); A(g, "player", "reveal");
  assert.equal(g.weather, "glow");
  assert.deepEqual(J(g.deck), ["snow", "acid", "thunder", "sand", "phase", "heat"]);
  assert.deepEqual(J(CC.view(g, "dealer").deckSeen), { top: [], bottom: ["heat"], unseen: 5 }, "翻开的 A 从看过的记录里拿掉，堆底的 B 还记着");
  if (g.stage === "normal") A(g, "player", "noNormal");
  checks(g);
  // 第 4 轮：保留微光以后偷看，看的又是现在的堆顶（没看过）
  A(g, "dealer", "weather", { op: "peek" });
  assert.deepEqual(J(CC.view(g, "dealer").peek), { card: "snow", where: null, at: 0 });
});

test("偷看按顺序往下看（#502）：天气堆里剩下的牌庄家都看过了就不能再偷看——场上有天气只能弃掉 / 保留，没有天气这一轮就没有天气行动", () => {
  // 每轮都偷看、压到牌堆底，玩家翻开下一张：第 4 轮压完，堆里剩下的 4 张庄家全看过；玩家再翻开一张，剩 3 张也全看过
  const deck = ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"];
  const fourRounds = (g, last) => {
    [["flesh", "ice"], ["sand", "physical"], ["spirit", "harmonic"], ["shield", "energy"]].forEach(([dc, pc], i) => {
      A(g, "dealer", "weather", { op: "peek" });
      assert.equal(g.peek.at, 0, `第 ${i + 1} 轮：前面看过的都压到了堆底，看的是堆顶`);
      A(g, "dealer", "place", { where: "bottom" });
      A(g, "dealer", "play", { card: dc }); A(g, "player", "play", { card: pc });
      checks(g); A(g, "player", "reveal");
      if (g.stage === "normal") { if (i === 3 && last) last(g); else A(g, "player", "noNormal"); }
      checks(g);
    });
  };
  const g = CC.newGame({ seed: "看完", deck });
  fourRounds(g);
  assert.equal(g.round, 5);
  assert.equal(g.weather, "heat", "玩家翻开的是真正的堆顶（压到底的酷暑转了一圈回到堆顶）");
  assert.deepEqual(J(g.deck), ["acid", "glow", "phase"]);
  assert.deepEqual(J(CC.view(g, "dealer").deckSeen), { top: [], bottom: ["acid", "glow", "phase"], unseen: 0 });
  assert.deepEqual(J(CC.legal(g, "dealer").map(o => o.op)), ["discard", "keep"], "全看过了：保留以后不能再偷看");
  assert.throws(() => A(g, "dealer", "weather", { op: "peek" }), /不能这样做/);
  // 没有天气（第 4 轮用常态清掉了）：全看过了，庄家这一轮没有天气行动
  const h = CC.newGame({ seed: "看完2", deck });
  fourRounds(h, (x) => A(x, "player", "normal", { card: "fire" }));
  assert.equal(h.round, 5);
  assert.equal(h.weather, null);
  assert.equal(h.stage, "play", "没有可选的天气行动：直接暗出");
  assert.ok(CC.view(h, "player").log.some(e => e.t === "dw" && e.op === "none" && e.r === 5 && e.text === "场上没有天气、天气堆里剩下的 3 张庄家都看过了，庄家这一轮没有天气行动。"));
});

test("偷看按顺序往下看（#502）：随便合法地乱打 200 局，庄家看过的记录一直和天气堆对得上（top 是堆顶往下那几张，bottom 是最底下那几张）；每次偷看的都是第一张没看过的，看过的不会再看；保留以后偷看天气留在场上", () => {
  const rng = CC.makeRng("往下看乱打");
  const n = { peek: 0, deep: 0, kept: 0, bottom: 0 };
  for (let i = 0; i < 200; i++) {
    const g = CC.newGame({ seed: "P" + i });
    for (let steps = 0; !g.over; steps++) {
      assert.ok(steps < 400, "卡住了：" + g.stage);
      const who = CC.toAct(g), side = who[Math.floor(rng() * who.length)];
      const opts = CC.legal(g, side), o = opts[Math.floor(rng() * opts.length)];
      const a = Object.assign({}, o);
      if (o.min != null) a.amount = o.min;
      const before = J(CC.view(g, "dealer").deckSeen), w = g.weather;
      CC.act(g, side, a);
      const s = CC.view(g, "dealer").deckSeen, d = g.deck;
      assert.deepEqual(J(s.top), J(d.slice(0, s.top.length)), "top 是堆顶往下那几张");
      assert.deepEqual(J(s.bottom), J(d.slice(d.length - s.bottom.length)), "bottom 是最底下那几张");
      assert.equal(s.unseen, d.length - s.top.length - s.bottom.length);
      assert.ok(s.unseen >= 0);
      if (a.type === "weather" && a.op === "peek") {
        n.peek++;
        assert.ok(before.unseen > 0, "还有没看过的才能偷看");
        assert.equal(g.peek.at, before.top.length, "看的是堆顶往下看过的几张后面那一张");
        assert.ok(!before.top.includes(g.peek.card) && !before.bottom.includes(g.peek.card), "看过的不会再看");
        if (g.peek.at > 0) n.deep++;
        if (w) { n.kept++; assert.equal(g.weather, w, "保留以后偷看：天气还在场上"); }
      }
      if (a.type === "place" && a.where === "bottom") n.bottom++;
    }
  }
  assert.ok(n.peek > 0 && n.deep > 0 && n.kept > 0 && n.bottom > 0, JSON.stringify(n));
});

/* ---------- 暗出 ---------- */

test("暗出：玩家只能出元素牌（常态不能当出牌），庄家出层牌；对方看不到出了什么", () => {
  const g = CC.newGame({ seed: "暗出", deck: DECK });
  A(g, "dealer", "weather", { op: "pass" });
  assert.deepEqual(J(CC.toAct(g).sort()), ["dealer", "player"]);
  assert.ok(!CC.legal(g, "player").some(o => o.card === "normal"));
  assert.throws(() => A(g, "player", "play", { card: "normal" }));
  assert.throws(() => A(g, "player", "play", { card: "flesh" }));
  A(g, "player", "play", { card: "harmonic" });
  A(g, "dealer", "play", { card: "spirit" });
  const dv = CC.view(g, "dealer"), pv = CC.view(g, "player");
  assert.equal(dv.opp.played, true); assert.equal(dv.opp.card, undefined); assert.equal(dv.opp.hand, undefined);
  assert.doesNotMatch(JSON.stringify(dv), /harmonic|谐波|"normal"|"fire"/);
  assert.doesNotMatch(JSON.stringify(pv), /spirit|星灵|"flesh"|"armor"/);
  assert.equal(pv.opp.handCount, 4);
  assert.equal(g.stage, "bet1");
  assert.equal(g.betting.toAct, "player");
});

/* ---------- 下注 ---------- */

test("下注：每轮最低下注额 = 轮数，低于最低额不行；第一轮玩家先、第二轮庄家先", () => {
  const g = CC.newGame({ seed: "下注", deck: DECK });
  toBet1(g, "flesh", "ice");
  assert.equal(CC.legal(g, "player").find(o => o.type === "bet").min, 1);
  checks(g); A(g, "player", "reveal");
  assert.equal(g.stage, "normal");                    // 翻出雷鸣：问要不要用常态
  A(g, "player", "noNormal");
  assert.equal(g.stage, "bet2"); assert.equal(g.betting.toAct, "dealer");
  checks(g);                                          // 第 1 轮：冰打肉体、雷鸣，平局
  quietRound(g, "sand", "physical");                  // 第 2 轮：沙暴，物理打沙尘 0，平局
  toBet1(g, "spirit", "harmonic");                    // 第 3 轮
  assert.equal(g.round, 3);
  const bet = CC.legal(g, "player").find(o => o.type === "bet");
  assert.equal(bet.min, 3);
  assert.throws(() => A(g, "player", "bet", { amount: 2 }), /3–/);
  A(g, "player", "bet", { amount: 3 });
  assert.equal(g.sides.player.bet, 4);                // 底注 1 + 3
  assert.equal(CC.legal(g, "dealer").find(o => o.type === "raise").min, 3);
});

test("下注：每个下注回合最多加注 2 次；过牌只能在还没人下注时", () => {
  const g = CC.newGame({ seed: "加注", deck: DECK });
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 1 });
  assert.ok(!CC.legal(g, "dealer").some(o => o.type === "check"));
  A(g, "dealer", "raise", { amount: 1 });
  A(g, "player", "raise", { amount: 2 });
  const opts = CC.legal(g, "dealer").map(o => o.type);
  assert.deepEqual(J(opts), ["call", "fold"]);
  assert.throws(() => A(g, "dealer", "raise", { amount: 1 }));
  A(g, "dealer", "call");
  assert.equal(g.sides.dealer.bet, g.sides.player.bet);
  assert.equal(g.sides.player.bet, 1 + 1 + 1 + 2);    // 底注 1 + 下注 1 + 跟上庄家加的 1 + 再加 2
  assert.equal(g.stage, "weather");
});

/* ---------- 下注不封顶（#496，主人 10/30 试玩后定） ---------- */

test("下注不封顶（#496）：想押多少押多少，只受自己手上的筹码限制——玩家 49 枚对庄家 9 枚，能押到自己的 49 枚（以前封顶在庄家的 9 枚）；加注也一样", () => {
  const g = CC.newGame({ seed: "不封顶", deck: DECK, dealerChips: 10 });
  toBet1(g, "flesh", "fire");
  assert.deepEqual(J(CC.legal(g, "player").find(o => o.type === "bet")), { type: "bet", min: 1, max: 49 });
  A(g, "player", "bet", { amount: 30 });
  assert.deepEqual([g.sides.player.bet, g.sides.player.chips], [31, 19]);
  // 第 2 轮：庄家手上比玩家多，玩家下注后庄家能加注到自己手上的全部（以前封顶在玩家手上的）
  const h = CC.newGame({ seed: "不封顶2", deck: DECK, playerChips: 10 });
  toBet1(h, "flesh", "fire");
  A(h, "player", "bet", { amount: 2 });
  assert.deepEqual(J(CC.legal(h, "dealer").find(o => o.type === "raise")), { type: "raise", min: 1, max: 47 });   // 手上 49：跟 2，再加最多 47
  A(h, "dealer", "raise", { amount: 20 });
  assert.equal(h.sides.dealer.bet, 1 + 2 + 20);
  assert.equal(h.sides.player.chips, 7, "玩家手上只剩 7 枚，比要跟的 20 枚少");
});

test("下注不封顶：对方押得比自己手上的还多，跟不起——不能直接跟、不能加注，只能弃牌或先向主持方借（借到补上「要跟的 + 最低下注额」的缺口为止）；借得不够还能接着借，借够了照常跟注", () => {
  const g = CC.newGame({ seed: "借来跟", deck: DECK, dealerChips: 10 });
  toBet1(g, "flesh", "fire");
  A(g, "player", "bet", { amount: 30 });
  // 庄家手上 9 枚，要跟 30 枚：缺口 30 + 1 − 9 = 22 → 最多借 24 枚
  assert.deepEqual(J(CC.legal(g, "dealer")), [{ type: "fold" }, { type: "borrow", min: 3, max: 24, step: 3, need: 31 }]);
  assert.throws(() => A(g, "dealer", "call"), /庄家现在不能这样做/);
  assert.throws(() => A(g, "dealer", "raise", { amount: 1 }), /庄家现在不能这样做/);
  assert.throws(() => A(g, "dealer", "borrow", { amount: 27 }), /3–24 枚/);
  // 先借 3 枚：手上 12 枚，还是跟不起，接着借
  A(g, "dealer", "borrow", { amount: 3 });
  assert.deepEqual(J(CC.toAct(g)), ["dealer"], "借完还是庄家下注");
  assert.deepEqual(J(CC.legal(g, "dealer")), [{ type: "fold" }, { type: "borrow", min: 3, max: 21, step: 3, need: 31 }]);
  A(g, "dealer", "borrow", { amount: 18 });
  assert.deepEqual([g.sides.dealer.chips, g.sides.dealer.loan, g.sides.dealer.owe], [30, 21, 28]);
  const opts = CC.legal(g, "dealer");
  assert.deepEqual(J(opts.find(o => o.type === "call")), { type: "call", amount: 30 });
  assert.ok(!opts.some(o => o.type === "raise"), "跟完手上就没有了：不能加注");
  assert.deepEqual(J(opts.find(o => o.type === "borrow")), { type: "borrow", min: 3, max: 3, step: 3, need: 31 }, "还差最低下注额 1 枚：想加注可以再借一份");
  A(g, "dealer", "call");
  assert.deepEqual([g.sides.dealer.bet, g.sides.dealer.chips, g.sides.player.bet, g.sides.player.chips], [31, 0, 31, 19]);
  // 借了多少、要还多少照旧公开
  const pv = CC.view(g, "player");
  assert.deepEqual([pv.opp.loan, pv.opp.owe], [21, 28]);
  assert.ok(pv.log.some(e => e.t === "loan" && e.by === "dealer" && e.amount === 18 && !e.to));
});

/* ---------- 跟注后的追加窗口（#496 第 2 条） ---------- */

test("跟注后的追加窗口（#496）：秒数在 CC_CONFIG.callWindowSec（3 秒）；一方跟注后不马上结束，双方都还能加注、弃牌或者放弃追加（pass）；双方都放弃追加就关窗，这个下注回合结束", () => {
  assert.equal(C.callWindowSec, 3);
  const g = CC.newGame({ seed: "窗口", deck: DECK });
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 2 }); A(g, "dealer", "call");
  assert.equal(g.stage, "bet1", "跟注后还在第一轮下注");
  assert.deepEqual(J(CC.toAct(g)), ["dealer", "player"], "两边同时都能动作");
  for (const side of ["dealer", "player"]) {
    assert.deepEqual(J(CC.legal(g, side)), [{ type: "pass" }, { type: "raise", min: 1, max: 47 }, { type: "fold" }], side + "：加注额只受自己手上的筹码限制");
    const v = CC.view(g, side);
    assert.deepEqual(J(v.betting.window), { n: 1, by: "dealer", sec: 3, passed: false });
    assert.equal(v.betting.toCall, 0);
    assert.ok(v.log.some(e => e.t === "window" && e.op === "open" && !e.to && e.text === "庄家跟注，开 3 秒追加窗口：双方都还可以加注或弃牌，没人动作就结束这个下注回合。"));
  }
  for (const bad of ["check", "call", "bet"]) assert.throws(() => A(g, "player", bad, { amount: 1 }), /玩家现在不能这样做/);
  A(g, "dealer", "pass");
  assert.deepEqual(J(CC.toAct(g)), ["player"], "庄家放弃追加：只等玩家");
  assert.deepEqual(J(CC.legal(g, "dealer")), []);
  assert.equal(CC.view(g, "dealer").betting.window.passed, true);
  // 放弃追加不公开：倒计时里玩家看不出庄家还会不会加注
  const pv = CC.view(g, "player");
  assert.deepEqual(J(pv.waiting), ["dealer", "player"]);
  assert.ok(!JSON.stringify(pv).includes('"passed":true') && !pv.log.some(e => (e.t === "bet" || e.t === "window") && e.op === "pass"));
  assert.throws(() => A(g, "dealer", "raise", { amount: 1 }), /现在不是庄家操作的时候/);
  A(g, "player", "pass");
  assert.equal(g.stage, "weather", "双方都放弃追加：第一轮下注结束，玩家翻天气");
  assert.ok(g.log.some(e => e.t === "window" && e.op === "close" && e.text === "双方都不追加，追加窗口关闭。"));
  assert.deepEqual([g.sides.dealer.bet, g.sides.player.bet], [3, 3]);
  // 第二轮下注的窗口关了就结算
  A(g, "player", "reveal"); A(g, "player", "noNormal");
  A(g, "dealer", "bet", { amount: 1 }); A(g, "player", "call");
  assert.deepEqual(J(CC.view(g, "dealer").betting.window), { n: 1, by: "player", sec: 3, passed: false });
  A(g, "player", "pass"); A(g, "dealer", "pass");
  assert.equal(g.results.length, 1, "第二轮下注的窗口关了：结算");
  assert.deepEqual(J(g.results[0].bets), { dealer: 4, player: 4 });
});

test("追加窗口里加注：关窗，照常轮到对方跟注 / 加注 / 弃牌（放弃追加过的也照常应对）；跟注的一方自己也能在窗口里加注；对方跟注后再开一次窗口；窗口里的加注算进每个下注回合最多加注 2 次，用完以后跟注直接结束、不开窗口", () => {
  const g = CC.newGame({ seed: "窗口加注", deck: DECK });
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 1 }); A(g, "dealer", "call");     // 第 1 个窗口
  A(g, "dealer", "pass");
  A(g, "player", "raise", { amount: 2 });                             // 庄家已经放弃追加，玩家在窗口里加注
  assert.equal(g.betting.window, null, "加注就关窗");
  assert.equal(g.betting.raises, 1);
  assert.deepEqual(J(CC.toAct(g)), ["dealer"]);
  assert.deepEqual(J(CC.legal(g, "dealer").map(o => o.type)), ["call", "raise", "fold"], "放弃追加过，也照常应对加注");
  assert.ok(g.log.some(e => e.t === "bet" && e.op === "raise" && e.by === "player" && e.amount === 2));
  A(g, "dealer", "call");                                             // 第 2 个窗口
  assert.deepEqual(J(g.betting.window), { n: 2, by: "dealer", passed: { dealer: false, player: false } });
  A(g, "dealer", "raise", { amount: 3 });                             // 跟注的庄家自己在窗口里加注：这一回合第 2 次加注
  assert.equal(g.betting.raises, 2);
  assert.deepEqual(J(CC.legal(g, "player").map(o => o.type)), ["call", "fold"], "加注次数用完：不能再加");
  A(g, "player", "call");
  assert.equal(g.betting, null, "加注次数用完：跟注直接结束这个下注回合，不开窗口");
  assert.equal(g.stage, "weather");
  assert.deepEqual([g.sides.dealer.bet, g.sides.player.bet], [1 + 1 + 2 + 3, 1 + 1 + 2 + 3]);
  assert.equal(g.log.filter(e => e.t === "window" && e.op === "open").length, 2);
});

test("追加窗口里弃牌：立即判负（同平时），对方拿走底池；两边谁都能弃", () => {
  for (const side of ["dealer", "player"]) {
    const g = CC.newGame({ seed: "窗口弃牌" + side, deck: DECK });
    toBet1(g, "flesh", "ice");
    A(g, "player", "bet", { amount: 3 }); A(g, "dealer", "call");
    A(g, side, "fold");
    const r = g.results[0];
    assert.deepEqual([r.outcome, r.folded, r.winner, r.pot], ["fold", side, CC.other(side), 8]);
    assert.equal(g.sides[CC.other(side)].chips, 50 + 4 - 1, "赢家拿走底池（下一轮下了底注）");
  }
});

test("追加窗口到时间：CounterCards.closeWindow(对局) 关窗（还没表态的都算放弃追加），这个下注回合结束——规则层不计时，界面倒计时到了调它；窗口没开着时什么都不做", () => {
  const g = CC.newGame({ seed: "窗口超时", deck: DECK });
  toBet1(g, "flesh", "ice");
  assert.equal(CC.closeWindow(g), false, "没开窗口：不动");
  assert.equal(g.stage, "bet1");
  A(g, "player", "bet", { amount: 2 }); A(g, "dealer", "call");
  A(g, "dealer", "pass");
  assert.equal(CC.closeWindow(g), true);
  assert.equal(g.stage, "weather");
  assert.ok(g.log.some(e => e.t === "window" && e.op === "close" && e.why === "timeout" && e.text === "追加窗口到时间了，没人加注。"));
  assert.equal(CC.closeWindow(g), false, "已经关了");
  // 双方都还没表态也一样
  A(g, "player", "reveal"); A(g, "player", "noNormal");
  A(g, "dealer", "bet", { amount: 1 }); A(g, "player", "call");
  assert.deepEqual(J(CC.toAct(g)), ["dealer", "player"]);
  assert.equal(CC.closeWindow(g), true);
  assert.equal(g.results.length, 1, "第二轮下注的窗口到时间：结算");
});

test("追加窗口：押光了的一方在窗口里加不了注（只能放弃追加或弃牌），对方照样能加，加了押光的一方要跟就得借；双方手上都没有筹码（谁都加不了注）时跟注也不开窗口；过牌 → 过牌不开窗口", () => {
  const g = CC.newGame({ seed: "窗口押光", deck: DECK, playerChips: 12 });
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 11 }); A(g, "dealer", "call");
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "pass" }, { type: "fold" }], "押光了：加不了注，窗口里也不能借");
  assert.deepEqual(J(CC.legal(g, "dealer")), [{ type: "pass" }, { type: "raise", min: 1, max: 38 }, { type: "fold" }]);
  A(g, "player", "pass");
  A(g, "dealer", "raise", { amount: 5 });
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "fold" }, { type: "borrow", min: 3, max: 6, step: 3, need: 6 }], "跟不起：要跟就得借");
  // 两边都押光：不开窗口
  const h = CC.newGame({ seed: "都押光", deck: DECK, dealerChips: 12, playerChips: 12 });
  toBet1(h, "flesh", "ice");
  A(h, "player", "bet", { amount: 11 }); A(h, "dealer", "call");
  assert.equal(h.stage, "weather", "谁都加不了注：跟注直接结束");
  assert.ok(!h.log.some(e => e.t === "window"));
  // 过牌 → 过牌：没有跟注，不开窗口
  const k = CC.newGame({ seed: "过牌", deck: DECK });
  toBet1(k, "flesh", "ice"); checks(k);
  assert.equal(k.stage, "weather");
  assert.ok(!k.log.some(e => e.t === "window"));
});

test("弃牌：立即判负，输掉自己已下的筹码，包括自己在滚存底池里的那一份", () => {
  const g = CC.newGame({ seed: "弃牌", deck: DECK });
  quietRound(g, "flesh", "ice");                      // 第 1 轮平局：双方各 1 枚滚存
  assert.equal(g.results[0].outcome, "tie");
  assert.equal(g.results[0].rollover, true);
  assert.equal(g.sides.dealer.pot, 1); assert.equal(g.sides.player.pot, 1);
  toBet1(g, "sand", "physical");
  A(g, "player", "bet", { amount: 2 });
  A(g, "dealer", "fold");
  const r = g.results[1];
  assert.equal(r.outcome, "fold"); assert.equal(r.folded, "dealer"); assert.equal(r.winner, "player");
  assert.equal(r.pot, 6);                             // 滚存 1 + 1，底注 1 + 1，下注 2
  assert.equal(g.sides.player.chips, 52 - 1);         // 50 −1 −1 −2 +6 = 52，第 3 轮底注 −1
  assert.equal(g.sides.dealer.chips, 48 - 1);
  assert.equal(g.sides.dealer.pot, 0); assert.equal(g.sides.player.pot, 0);
  assert.equal(r.tier, 0);
});

test("平局底池滚存到下一轮；第 5 轮打平，各自拿回自己的筹码（含滚存的那一份）", () => {
  const g = CC.newGame({ seed: "滚存", deck: DECK });
  quietRound(g, "flesh", "ice");                      // 雷鸣：冰打肉体 0
  toBet1(g, "sand", "physical");                      // 沙暴：物理打沙尘 0
  A(g, "player", "bet", { amount: 2 }); call(g, "dealer");
  A(g, "player", "reveal"); A(g, "player", "noNormal"); checks(g);
  quietRound(g, "spirit", "harmonic");                // 微光：谐波打星灵 0
  quietRound(g, "shield", "energy", { dw: "discard" }); // 酷暑：能量打护盾 0
  assert.ok(g.results.every(r => r.outcome === "tie" && r.rollover));
  assert.equal(g.sides.player.pot, 6); assert.equal(g.sides.dealer.pot, 6);
  quietRound(g, "armor", "acid");                     // 雪天：酸打装甲 +1 −1 = 0
  const last = g.results[4];
  assert.equal(last.outcome, "tie"); assert.equal(last.refund, true);
  assert.equal(g.over, true);
  assert.equal(g.sides.player.chips, 50); assert.equal(g.sides.dealer.chips, 50);
  assert.equal(g.final.winner, null);
});

test("手上的筹码押光了、平局滚存里还有自己的一份：下一轮不下底注，押着底池接着打；下注不封顶（#496）以后押光的这一方照样要过下注这一关——能过牌，对方下注时要跟就得先借", () => {
  const g = CC.newGame({ seed: "押光", deck: DECK, playerChips: 12 });
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 11 }); call(g, "dealer");
  A(g, "player", "reveal"); A(g, "player", "noNormal");   // 雷鸣：冰打肉体 0
  // 玩家押光了：第二轮下注照常（以前按较少一方封顶在 0，整轮跳过），庄家先；押光的玩家能过牌（或借了再下注）
  assert.equal(g.stage, "bet2"); assert.equal(g.sides.player.chips, 0);
  A(g, "dealer", "check");
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "check" }, { type: "fold" }, { type: "borrow", min: 3, max: 3, step: 3, need: 1 }]);
  A(g, "player", "check");
  assert.equal(g.results[0].rollover, true);
  assert.equal(g.round, 2); assert.equal(g.over, false);
  assert.equal(g.sides.player.chips, 0); assert.equal(g.sides.player.pot, 12);
  // 手上没筹码了：先问玩家借不借（这里不借）
  assert.equal(g.stage, "loan"); assert.deepEqual(J(CC.toAct(g)), ["player"]);
  A(g, "player", "noLoan");
  assert.equal(g.sides.player.bet, 0); assert.equal(g.sides.dealer.bet, 0);   // 不下底注
  assert.ok(g.log.some(e => e.t === "round" && e.r === 2 && /不下底注/.test(e.text) && !/不下注/.test(e.text)));
  A(g, "dealer", "weather", { op: "keep" });
  A(g, "dealer", "play", { card: "spirit" }); A(g, "player", "play", { card: "energy" });
  // 第 2 轮照样下注：玩家过牌，庄家下注 2 枚，玩家手上没有，跟不起——要跟就先借（缺口 2 + 2 = 4 → 最多借 6 枚）
  assert.equal(g.stage, "bet1");
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 2 });
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "fold" }, { type: "borrow", min: 3, max: 6, step: 3, need: 4 }]);
  A(g, "player", "borrow", { amount: 3 });
  call(g, "player");
  A(g, "player", "reveal"); A(g, "player", "noNormal");
  A(g, "dealer", "check"); A(g, "player", "check");
  // 沙暴里能量打星灵 +1：玩家拿走底池（滚存 12 + 12，这一轮各 2）
  const r = g.results[1];
  assert.equal(r.winner, "player"); assert.equal(r.pot, 28);
  assert.equal(g.sides.player.chips, 3 - 2 + 28 - 1); assert.equal(g.sides.dealer.chips, 38 - 2 - 1);   // 第 3 轮照常下底注
  assert.deepEqual([g.sides.player.loan, g.sides.player.owe], [3, 4]);
});

/* ---------- 玩家的天气 ---------- */

test("玩家必须翻天气，除非暗弃一张手牌跳过（弃的牌不公开，常态也能弃）；新翻的天气顶替旧天气", () => {
  const g = CC.newGame({ seed: "翻天气", deck: DECK });
  quietRound(g, "flesh", "ice");
  assert.equal(g.weather, "thunder");
  toBet1(g, "sand", "physical"); checks(g);
  const types = CC.legal(g, "player").map(o => o.type + (o.card ? ":" + o.card : ""));
  assert.ok(types.includes("reveal"));
  assert.ok(types.includes("skip:normal"));
  assert.ok(types.includes("skip:fire"));
  A(g, "player", "skip", { card: "fire" });
  assert.equal(g.weather, "thunder");                 // 没翻：天气不变
  assert.equal(g.deck.length, 6);
  const dv = CC.view(g, "dealer");
  assert.ok(dv.log.some(e => /玩家暗弃一张手牌，跳过翻天气/.test(e.text)));
  assert.doesNotMatch(JSON.stringify(dv), /"fire"|〔火〕/);
  assert.equal(dv.opp.discardCount, 1);
  assert.ok(CC.view(g, "player").log.some(e => e.text === "你暗弃了〔火〕。"));
  if (g.stage === "normal") A(g, "player", "noNormal");
  checks(g);
  // 第 3 轮翻出新天气：顶替雷鸣
  quietRound(g, "spirit", "harmonic");
  assert.equal(g.weather, "sand");
  assert.deepEqual(J(g.gone), ["thunder"]);
});

test("暗弃要给后面每一轮留够元素牌：7 张元素牌最多弃 2 张，之后只能弃常态", () => {
  const g = CC.newGame({ seed: "留牌", deck: DECK });
  quietRound(g, "flesh", "ice", { skip: "fire" });
  quietRound(g, "sand", "physical", { skip: "acid" });
  toBet1(g, "spirit", "harmonic"); checks(g);
  const skips = CC.legal(g, "player").filter(o => o.type === "skip").map(o => o.card);
  assert.deepEqual(J(skips), ["normal"]);
  assert.throws(() => A(g, "player", "skip", { card: "electric" }));
  A(g, "player", "skip", { card: "normal" });
  if (g.stage === "normal") A(g, "player", "noNormal");
  checks(g);
  toBet1(g, "shield", "energy"); checks(g);
  assert.deepEqual(J(CC.legal(g, "player").map(o => o.type)), ["reveal"]);
});

test("常态：每局一次，代价是暗弃一张元素牌，清除当前天气；场上没有天气时不能用", () => {
  const g = CC.newGame({ seed: "常态", deck: ["glow", "heat", "snow", "acid", "thunder", "sand", "phase"] });
  toBet1(g, "flesh", "fire"); checks(g);
  A(g, "player", "reveal");                           // 翻出微光：火打肉体变成 −1
  assert.equal(g.stage, "normal");
  assert.ok(CC.legal(g, "player").some(o => o.type === "normal" && o.card === "physical"));
  A(g, "player", "normal", { card: "physical" });
  assert.equal(g.weather, null);
  assert.deepEqual(J(g.gone), ["glow"]);
  assert.equal(g.normalUsed, true);
  assert.ok(!g.sides.player.hand.includes("normal"));
  assert.ok(!g.sides.player.hand.includes("physical"));
  const dv = CC.view(g, "dealer");
  assert.ok(dv.log.some(e => /玩家打出常态（暗弃一张元素牌），清除了天气〔微光〕/.test(e.text)));
  assert.doesNotMatch(JSON.stringify(dv), /"physical"|〔物理〕/);
  checks(g);
  assert.equal(g.results[0].winner, "player");        // 没有天气：火打肉体 +1
  // 以后不再问常态
  toBet1(g, "armor", "acid"); checks(g);
  A(g, "player", "reveal");
  assert.equal(g.weather, "heat");
  assert.equal(g.stage, "bet2");
  // 没有天气时不问常态（跳过翻天气）
  const g2 = CC.newGame({ seed: "常态2", deck: DECK });
  toBet1(g2, "flesh", "ice"); checks(g2);
  A(g2, "player", "skip", { card: "fire" });
  assert.equal(g2.stage, "bet2");
});

test("常态不能覆盖相位：翻到相位不问常态，相位留在场上也不能用常态清掉", () => {
  const g = CC.newGame({ seed: "相位常态", deck: ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"] });
  toBet1(g, "flesh", "ice"); checks(g);
  A(g, "player", "reveal");
  assert.equal(g.results.length, 1);                  // 没停在常态：直接全押、结算
  assert.equal(g.results[0].allIn, true);
  assert.equal(g.weather, "phase");
  A(g, "dealer", "weather", { op: "keep" });
  A(g, "dealer", "play", { card: "armor" }); A(g, "player", "play", { card: "acid" });
  checks(g);
  A(g, "player", "skip", { card: "fire" });
  assert.equal(g.stage, "bet2");                      // 相位还在场上：不问常态
  assert.ok(!CC.legal(g, "player").some(o => o.type === "normal"));
});

/* ---------- 相位：全押封顶 ---------- */

test("相位：翻到相位双方全押，上限是筹码较少一方的全部筹码（庄家 20、玩家 50 → 各押 20）", () => {
  const g = CC.newGame({ seed: "全押", deck: ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"], dealerChips: 20, playerChips: 50 });
  toBet1(g, "flesh", "fire");
  A(g, "player", "bet", { amount: 3 }); call(g, "dealer");
  A(g, "player", "reveal");
  const r = g.results[0];
  assert.equal(r.allIn, true);
  assert.deepEqual(J(r.bets), { dealer: 20, player: 20 });
  assert.equal(r.winner, "player");                   // 相位没有修正：火打肉体 +1
  assert.equal(r.tier, 1); assert.equal(r.extra, 0);
  assert.equal(g.sides.player.chips, 70);
  assert.equal(g.sides.dealer.chips, 0);
  assert.equal(g.stage, "loan");                      // 庄家输光：先问借不借
  A(g, "dealer", "noLoan");
  assert.equal(g.over, true);                         // 不借，对局结束
  assert.equal(g.final.winner, "player");
  assert.deepEqual(J(g.final.busted), ["dealer"]);
});

test("相位：筹码多的一方输了也只输到上限；不能弃牌、不再下注", () => {
  const g = CC.newGame({ seed: "全押2", deck: ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"], dealerChips: 50, playerChips: 12 });
  toBet1(g, "armor", "fire"); checks(g);
  A(g, "player", "reveal");
  const r = g.results[0];
  assert.deepEqual(J(r.bets), { dealer: 12, player: 12 });
  assert.equal(r.winner, "dealer");                   // 火打装甲 −1
  assert.equal(g.sides.player.chips, 0);
  assert.equal(g.sides.dealer.chips, 62);
  A(g, "player", "noLoan");                           // 玩家输光、不借
  assert.equal(g.over, true);
});

test("相位轮打平：各自退回自己下的筹码（含滚存的那一份），不滚存", () => {
  const g = CC.newGame({ seed: "相位平", deck: ["thunder", "phase", "heat", "snow", "acid", "sand", "glow"] });
  quietRound(g, "flesh", "ice");                      // 雷鸣：平局，滚存各 1
  toBet1(g, "sand", "physical"); checks(g);
  A(g, "player", "reveal");                           // 相位：物理打沙尘 0
  const r = g.results[1];
  assert.equal(r.allIn, true); assert.equal(r.outcome, "tie"); assert.equal(r.refund, true);
  assert.deepEqual(J(r.bets), { dealer: 49, player: 49 });
  assert.equal(g.sides.player.pot, 0); assert.equal(g.sides.dealer.pot, 0);
  assert.equal(g.sides.player.chips, 49); assert.equal(g.sides.dealer.chips, 49);   // 退回 50，第 3 轮底注 −1
  assert.equal(g.round, 3);
});

/* ---------- 分档赔付 ---------- */

test("分档赔付（结算函数）：差 1 只拿底池；差 2 输家再赔自己下注额的 0.5 倍（半枚向下取整）；差 3 及以上按差 2 赔（主人 10/30 删掉了「再赔 1 倍」那一档）", () => {
  const s = (dBet, pBet, extra) => Object.assign({ dealer: { bet: dBet, pot: 2, chips: 30, infinite: false }, player: { bet: pBet, pot: 2, chips: 30, infinite: false } }, extra || {});
  const t1 = CC.settle(1, s(7, 7));
  assert.equal(t1.winner, "player"); assert.equal(t1.tier, 1); assert.equal(t1.pot, 18); assert.equal(t1.extra, 0);
  assert.deepEqual(J(t1.after), { dealer: { chips: 30, pot: 0 }, player: { chips: 48, pot: 0 } });
  const t2 = CC.settle(-2, s(7, 7));
  assert.equal(t2.winner, "dealer"); assert.equal(t2.tier, 2); assert.equal(t2.extra, 3);      // 7 × 0.5 = 3.5 → 3
  assert.deepEqual(J(t2.after), { dealer: { chips: 30 + 18 + 3, pot: 0 }, player: { chips: 27, pot: 0 } });
  const t3 = CC.settle(3, s(8, 8));
  assert.equal(t3.tier, 2); assert.equal(t3.extra, 4);    // 按差 2：8 × 0.5 = 4
  assert.equal(CC.settle(5, s(8, 8)).extra, 4);       // 超过 2 都按差 2 的 0.5 倍
  assert.equal(CC.settle(-4, s(6, 6)).extra, 3);
  // 额外赔付最多赔光剩下的筹码（差 3 按差 2：该赔 10 × 0.5 = 5，手上只剩 4）
  const poor = CC.settle(3, { dealer: { bet: 10, pot: 0, chips: 4, infinite: false }, player: { bet: 10, pot: 0, chips: 0, infinite: false } });
  assert.equal(poor.extra, 4); assert.equal(poor.after.dealer.chips, 0); assert.equal(poor.after.player.chips, 24);
  // 庄家筹码无限：照赔（差 3 按差 2：10 × 0.5 = 5）
  const inf = CC.settle(3, { dealer: { bet: 10, pot: 0, chips: -5, infinite: true }, player: { bet: 10, pot: 0, chips: 0, infinite: false } });
  assert.equal(inf.extra, 5);
  // 平局：滚存 / 相位、最后一轮退回
  const tie = CC.settle(0, s(3, 3));
  assert.equal(tie.rollover, true); assert.equal(tie.after.player.pot, 5); assert.equal(tie.after.player.chips, 30);
  const back = CC.settle(0, s(3, 3), { allIn: true });
  assert.equal(back.refund, true); assert.equal(back.after.player.chips, 35); assert.equal(back.after.player.pot, 0);
  assert.deepEqual(J([CC.tierOf(0), CC.tierOf(1), CC.tierOf(-2), CC.tierOf(3), CC.tierOf(-7)]), [0, 1, 2, 2, 2]);
  assert.deepEqual(J([CC.extraOf(1, 9), CC.extraOf(2, 9), CC.extraOf(3, 9)]), [0, 4, 4]);
});

test("分档赔付只有两档（主人 10/30 删掉「差 3 及以上」）：tierExtra 只到差 2；分差超过 2（照现在的数值打不出来）赔付和差 2 一模一样，结算写「差 2」", () => {
  assert.deepEqual(J(C.tierExtra), [0, 0, 0.5], "下标 = 分差：差 1 只拿底池，差 2 再赔 0.5 倍，没有第 3 档");
  const s = (bet) => ({ dealer: { bet, pot: 3, chips: 40, infinite: false }, player: { bet, pot: 3, chips: 40, infinite: false } });
  for (const bet of [1, 5, 9, 12]) for (const sign of [1, -1]) {
    const two = J(CC.settle(sign * 2, s(bet)));
    for (const d of [3, 4, 5, 9]) {
      const out = J(CC.settle(sign * d, s(bet)));
      assert.equal(out.tier, 2, `差 ${d} 按差 2`);
      assert.deepEqual(out, two, `${sign > 0 ? "玩家" : "庄家"}赢、输家下了 ${bet} 枚、差 ${d}：和差 2 一样（再赔 ${Math.floor(bet * 0.5)} 枚）`);
    }
  }
  // 结算的公开说明：分差超过 2 也写「差 2」，不再有「差 3 及以上」
  const text = CC.resultText({ r: 1, outcome: "player", winner: "player", tier: CC.tierOf(4), extra: 2, pot: 10, delta: { dealer: -7, player: 7 } });
  assert.match(text, /玩家赢（差 2）/);
  assert.doesNotMatch(text, /差 3/);
});

test("分档赔付（整局里）：酷暑下火打肉体差 2，庄家这一轮下了 5 枚 → 再赔 2 枚", () => {
  const g = CC.newGame({ seed: "差2", deck: ["heat", "snow", "acid", "thunder", "glow", "sand", "phase"] });
  toBet1(g, "flesh", "fire");
  A(g, "player", "bet", { amount: 1 }); call(g, "dealer");
  A(g, "player", "reveal");
  A(g, "player", "noNormal");
  A(g, "dealer", "check"); A(g, "player", "bet", { amount: 3 }); call(g, "dealer");
  const r = g.results[0];
  assert.equal(r.winner, "player"); assert.equal(r.tier, 2);
  assert.deepEqual(J(r.bets), { dealer: 5, player: 5 });
  assert.equal(r.pot, 10); assert.equal(r.extra, 2);
  assert.deepEqual(J(r.delta), { dealer: -7, player: 7 });
  // 公开的结算只有胜负、分档和筹码变动，不说谁出了什么
  const text = CC.view(g, "dealer").log.find(e => e.t === "result").text;
  assert.match(text, /玩家赢（差 2）/);
  assert.doesNotMatch(text, /火|肉体/);
});

/* ---------- 借贷 ---------- */

test("借贷：数值在 CC_CONFIG——3 枚一份，每借 3 枚结束时还 4 枚（3→4、6→8）", () => {
  assert.equal(C.loan.unit, 3);
  assert.equal(C.loan.repay, 4);
  assert.deepEqual(J([CC.repayOf(3), CC.repayOf(6), CC.repayOf(9)]), [4, 8, 12]);
});

test("借贷（每轮开始）：输光了先问借不借；最少借 3 枚、3 的倍数、最多借到补上缺口；借了多少、要还多少是公开的", () => {
  const g = CC.newGame({ seed: "借贷", deck: ["thunder", "phase", "heat", "snow", "acid", "sand", "glow"] });
  quietRound(g, "flesh", "ice");                      // 雷鸣：平局
  toBet1(g, "armor", "fire"); checks(g);
  A(g, "player", "reveal");                           // 相位全押：火打装甲 −1，玩家输光
  assert.equal(g.sides.player.chips, 0); assert.equal(g.sides.player.pot, 0);
  assert.equal(g.over, false);
  // 第 3 轮开始前：底注 1 + 最低下注 3 = 4，缺 4 枚 → 最多借 6 枚（两份）
  assert.equal(g.round, 3); assert.equal(g.stage, "loan");
  assert.deepEqual(J(CC.toAct(g)), ["player"]);
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "borrow", min: 3, max: 6, step: 3, need: 4 }, { type: "noLoan" }]);
  assert.equal(g.sides.player.bet, 0);                // 还没下底注
  for (const bad of [0, 2, 4, 9]) assert.throws(() => A(g, "player", "borrow", { amount: bad }), /3 的倍数/);
  assert.throws(() => A(g, "dealer", "borrow", { amount: 3 }), /现在不是庄家操作的时候/);
  A(g, "player", "borrow", { amount: 6 });
  const p = g.sides.player;
  assert.equal(p.loan, 6); assert.equal(p.owe, 8);
  assert.equal(p.chips, 5); assert.equal(p.bet, 1);  // 借了 6 枚，下了 1 枚底注
  assert.equal(g.stage, "dealerWeather");
  const dv = CC.view(g, "dealer"), pv = CC.view(g, "player");
  assert.equal(dv.opp.loan, 6); assert.equal(dv.opp.owe, 8);
  assert.equal(pv.me.loan, 6); assert.equal(pv.me.owe, 8);
  for (const v of [dv, pv]) assert.ok(v.log.some(e => e.t === "loan" && !e.to && e.text === "玩家向主持方借了 6 枚筹码（对局结束时还 8 枚）。"));
});

test("借贷（每轮开始）：不够「底注 + 最低下注」但没输光——不借也接着打；够用就不问；两边都要问时输光的先问，它不借对局就结束", () => {
  // 1 枚：不够第 1 轮的 1 + 1 = 2 枚，缺 1 枚 → 最多借 3 枚
  const g = CC.newGame({ seed: "差一点", playerChips: 1 });
  assert.equal(g.stage, "loan");
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "borrow", min: 3, max: 3, step: 3, need: 2 }, { type: "noLoan" }]);
  A(g, "player", "noLoan");
  assert.equal(g.over, false); assert.equal(g.stage, "dealerWeather");
  assert.equal(g.sides.player.chips, 0); assert.equal(g.sides.player.loan, 0);
  assert.ok(CC.view(g, "dealer").log.some(e => e.text === "玩家没有向主持方借。"));
  // 2 枚正好够：不问
  assert.equal(CC.newGame({ seed: "够了", playerChips: 2 }).stage, "dealerWeather");
  // 玩家输光、庄家只是不够：先问玩家；玩家不借，对局结束，庄家不用借
  const h = CC.newGame({ seed: "先问", dealerChips: 1, playerChips: 0 });
  assert.deepEqual(J(h.loanAsk), ["player", "dealer"]);
  assert.deepEqual(J(CC.toAct(h)), ["player"]);
  A(h, "player", "noLoan");
  assert.equal(h.over, true);
  assert.equal(h.sides.dealer.loan, 0);
  assert.deepEqual(J(h.final.busted), ["player"]);
  assert.equal(h.final.rounds, 0);                    // 一轮也没打
  assert.equal(h.final.winner, "dealer");
});

test("借贷（下注时）：轮到自己下注、手上不够「要跟的 + 最低下注额」可以先借，借完还是自己下注；借来的不算这一轮的输赢", () => {
  const g = CC.newGame({ seed: "下注借", deck: DECK, playerChips: 8 });
  // 第 1 轮：玩家下 4、庄家跟，雷鸣里冰打肉体平局，滚存
  toBet1(g, "flesh", "ice");
  A(g, "player", "bet", { amount: 4 }); call(g, "dealer");
  A(g, "player", "reveal"); A(g, "player", "noNormal"); checks(g);
  // 第 2 轮：剩 3 枚，够 1 + 2，开局不问；底注后剩 2 枚。庄家下 2，玩家要跟 2 + 最低下注 2 = 4，缺 2 枚 → 最多借 3 枚
  assert.equal(g.stage, "dealerWeather");
  assert.equal(g.sides.player.chips, 2);
  toBet1(g, "sand", "physical");
  assert.ok(!CC.legal(g, "player").some(o => o.type === "borrow"), "过牌、下注都够：不能借");
  A(g, "player", "check");
  assert.ok(!CC.legal(g, "dealer").some(o => o.type === "borrow"), "庄家筹码够：不能借");
  A(g, "dealer", "bet", { amount: 2 });
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "call", amount: 2 }, { type: "fold" }, { type: "borrow", min: 3, max: 3, step: 3, need: 4 }]);
  A(g, "player", "borrow", { amount: 3 });
  assert.deepEqual(J(CC.toAct(g)), ["player"]);       // 借完还是玩家下注
  assert.equal(g.sides.player.chips, 5); assert.equal(g.sides.player.owe, 4);
  const opts = CC.legal(g, "player");
  assert.deepEqual(J(opts.find(o => o.type === "raise")), { type: "raise", min: 2, max: 3 });
  assert.ok(!opts.some(o => o.type === "borrow"), "够了就不能再借");
  A(g, "player", "raise", { amount: 3 }); call(g, "dealer");
  A(g, "player", "reveal"); A(g, "player", "noNormal");   // 沙暴：物理打沙尘 0
  checks(g);                                          // 玩家押光了，第二轮下注照常（下注不封顶，#496）：都过牌
  const r = g.results[1];
  assert.equal(r.outcome, "tie");
  assert.deepEqual(J(r.delta), { dealer: -6, player: -6 });   // 双方各押 6 枚进滚存；借来的 3 枚不算玩家的进账
  // 第 3 轮：手上没筹码、底池里还有一份 → 开局问借不借（缺 4 枚，最多借 6 枚）
  assert.equal(g.stage, "loan");
  assert.equal(CC.legal(g, "player")[0].max, 6);
});

test("借贷：赌场里庄家筹码无限，从来不用借；玩家借了，离桌时扣还", () => {
  const t = CC.casino.tables()[0];
  const g = CC.casino.newGame(t.id, t.minBuyIn, { deck: ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"] });
  toBet1(g, "armor", "fire"); checks(g);
  A(g, "player", "reveal");                           // 相位全押：火打装甲 −1，玩家输光
  assert.equal(g.sides.player.chips, 0);
  assert.deepEqual(J(g.loanAsk), ["player"]);
  A(g, "player", "borrow", { amount: 3 });
  assert.equal(g.sides.dealer.loan, 0);
  const out = CC.casino.cashOut(g);
  assert.equal(out.chips, 2 - 4);                     // 手上 2 枚（下了 1 枚底注），还要还 4 枚
  assert.equal(out.loan, 3); assert.equal(out.owe, 4);
  assert.equal(out.net, -2 - t.minBuyIn);
});

test("借贷不设上限（#496 第 3 条）：一局里总共能借多少没有上限（CC_CONFIG.loan.maxUnits 是 null：每次最多借到补上缺口，借几次都行）——对方押很大时借到补上缺口再跟，一局借了 96 枚（开局才 10 枚）；还不上的照样记成负数", () => {
  assert.equal(C.loan.maxUnits, null);
  const g = CC.newGame({ seed: "借不封顶", deck: DECK, playerChips: 10 });
  // 第 1 轮：玩家手上 9 枚，庄家押 45 枚——缺口 45 + 1 − 9 = 37，最多借 39 枚；借 36 枚正好够跟
  A(g, "dealer", "weather", { op: "pass" });
  A(g, "dealer", "play", { card: "armor" }); A(g, "player", "play", { card: "fire" });
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 45 });
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "fold" }, { type: "borrow", min: 3, max: 39, step: 3, need: 46 }]);
  A(g, "player", "borrow", { amount: 36 });
  call(g, "player");
  A(g, "player", "reveal"); A(g, "player", "noNormal"); checks(g);   // 雷鸣：火打装甲 −1，庄家赢
  assert.deepEqual([g.results[0].winner, g.results[0].pot], ["dealer", 92]);
  assert.deepEqual([g.sides.player.chips, g.sides.player.loan, g.sides.player.owe], [0, 36, 48]);
  // 第 2 轮：输光了，开局先借 3 枚；庄家又押 59 枚——再借 57 枚跟（这一局第三次借）
  assert.deepEqual(J(CC.toAct(g)), ["player"]);
  A(g, "player", "borrow", { amount: 3 });
  A(g, "dealer", "weather", { op: "keep" });
  A(g, "dealer", "play", { card: "spirit" }); A(g, "player", "play", { card: "ice" });
  A(g, "player", "check"); A(g, "dealer", "bet", { amount: 59 });
  assert.deepEqual(J(CC.legal(g, "player")), [{ type: "fold" }, { type: "borrow", min: 3, max: 60, step: 3, need: 61 }]);
  A(g, "player", "borrow", { amount: 57 });
  call(g, "player");
  A(g, "player", "reveal"); A(g, "player", "noNormal"); checks(g);   // 沙暴：冰打星灵 −1，庄家又赢
  assert.equal(g.results[1].winner, "dealer");
  // 一局借了 36 + 3 + 57 = 96 枚，每借 3 枚还 4 枚：要还 128 枚
  assert.deepEqual([g.sides.player.loan, g.sides.player.owe], [96, 128]);
  A(g, "player", "noLoan");                                           // 又输光了，不借：对局结束
  assert.equal(g.over, true);
  assert.deepEqual(J(g.final.held), { dealer: 156, player: 0 });
  assert.deepEqual(J(g.final.chips), { dealer: 156, player: -128 }, "还不上的记成负数");
  assert.deepEqual(J(g.final.loans.player), { loan: 96, owe: 128 });
  assert.equal(g.final.winner, "dealer");
  assert.equal(g.sides.dealer.chips + g.sides.player.chips, 10 + 50 + 96 - 128, "筹码守恒：开局的加上借来的，减去要还的");
  assert.match(g.log[g.log.length - 1].text, /玩家 -128 枚（已扣还借款 128 枚），庄家 156 枚——按最终筹码数，庄家赢/);
});

/* ---------- 最终胜负：按最终筹码数（扣还借款之后） ---------- */

test("最终胜负按最终筹码数比，不按相对开局的变化量：庄家 30、玩家 60 开局，五轮都打平 → 玩家赢", () => {
  const g = CC.newGame({ seed: "比筹码", deck: DECK, dealerChips: 30, playerChips: 60 });
  fiveTies(g);
  assert.equal(g.over, true);
  assert.ok(g.results.every(r => r.outcome === "tie"));
  assert.deepEqual(J(g.final.chips), { dealer: 30, player: 60 });
  assert.deepEqual(J(g.final.net), { dealer: 0, player: 0 });    // 变化量一样
  assert.equal(g.final.winner, "player");
  assert.match(g.log[g.log.length - 1].text, /玩家 60 枚，庄家 30 枚——按最终筹码数，玩家赢/);
});

test("对局结束时从筹码里扣还借款（每 3 枚还 4 枚），胜负按扣还之后的筹码数：扣还前庄家多，扣还后玩家多 → 玩家赢", () => {
  const g = CC.newGame({ seed: "扣还", deck: DECK, dealerChips: 5, playerChips: 5 });
  fiveTies(g, { loans: { 3: { dealer: 3 } } });       // 第 3 轮开始两边都只剩 3 枚，不够 1 + 3：庄家借 3 枚，玩家不借
  assert.equal(g.over, true);
  assert.equal(g.sides.dealer.loan, 3);
  assert.deepEqual(J(g.final.held), { dealer: 8, player: 5 });   // 扣还之前
  assert.deepEqual(J(g.final.loans), { dealer: { loan: 3, owe: 4 }, player: { loan: 0, owe: 0 } });
  assert.deepEqual(J(g.final.chips), { dealer: 4, player: 5 });  // 扣还之后
  assert.equal(g.sides.dealer.chips, 4);
  assert.equal(g.final.winner, "player");
  assert.match(g.log[g.log.length - 1].text, /玩家 5 枚，庄家 4 枚（已扣还借款 4 枚）——按最终筹码数，玩家赢/);
});

test("还不上的借款记成负数：输光后借 6 枚又输光、不再借 → 最终 −8 枚", () => {
  const g = CC.newGame({ seed: "欠债", deck: ["thunder", "phase", "heat", "snow", "acid", "sand", "glow"] });
  quietRound(g, "flesh", "ice");
  toBet1(g, "armor", "fire"); checks(g);
  A(g, "player", "reveal");                           // 相位全押：玩家输光
  A(g, "player", "borrow", { amount: 6 });
  A(g, "dealer", "weather", { op: "discard" });
  A(g, "dealer", "play", { card: "shield" }); A(g, "player", "play", { card: "physical" });
  A(g, "player", "bet", { amount: 5 }); call(g, "dealer");
  A(g, "player", "reveal"); A(g, "player", "noNormal");   // 酷暑：物理打护盾 −1
  checks(g);                                          // 玩家押光了，第二轮下注照常（下注不封顶，#496）：都过牌
  assert.equal(g.results[2].winner, "dealer");
  assert.deepEqual(J(CC.toAct(g)), ["player"]);       // 又输光了：再问一次
  A(g, "player", "noLoan");
  assert.equal(g.over, true);
  assert.deepEqual(J(g.final.held), { dealer: 106, player: 0 });
  assert.deepEqual(J(g.final.chips), { dealer: 106, player: -8 });
  assert.equal(g.final.winner, "dealer");
  assert.equal(g.final.rounds, 3);
  assert.deepEqual(J(g.final.busted), ["player"]);
});

/* ---------- 看不到对方的牌 ---------- */

test("view：对方的手牌、暗出的牌、暗弃的牌都不在里面；自己的私人记录只给自己", () => {
  const g = CC.newGame({ seed: "视角", deck: DECK });
  quietRound(g, "flesh", "ice", { skip: "fire" });
  toBet1(g, "armor", "electric");
  const pv = CC.view(g, "player"), dv = CC.view(g, "dealer");
  assert.deepEqual(Object.keys(pv.opp).sort(), ["bet", "chips", "discardCount", "handCount", "infinite", "loan", "owe", "played", "pot", "st", "start"]);
  assert.deepEqual(Object.keys(dv.opp).sort(), Object.keys(pv.opp).sort());
  assert.ok(pv.log.every(e => !e.to || e.to === "player"));
  assert.ok(dv.log.every(e => !e.to || e.to === "dealer"));
  for (const k of ["fire", "ice", "electric", "火", "冰", "〔电〕"]) assert.ok(!JSON.stringify(dv).includes(k), k);
  for (const k of ["flesh", "armor", "肉体", "装甲"]) assert.ok(!JSON.stringify(pv).includes(k), k);
  assert.deepEqual(J(pv.me.history.map(h => h.card)), ["ice", "electric"]);
});

/* ---------- 整局 ---------- */

test("随便合法地乱打 300 局（借贷也乱借，押得比对方手上的还多时对方借来跟；跟注后的追加窗口里乱加注 / 弃牌 / 放弃追加，也会到时间）：都能打完，筹码守恒（算上借的、还的），打满 5 轮时庄家 5 张层牌各出一次", () => {
  const rng = CC.makeRng("乱打");
  let loans = 0, windows = 0, timeouts = 0, windowRaises = 0, shortLoans = 0, negative = 0, maxLoan = 0;
  for (let n = 0; n < 300; n++) {
    const g = CC.newGame({ seed: "R" + n });
    let steps = 0;
    while (!g.over) {
      const who = CC.toAct(g);
      assert.ok(who.length, "卡住了：" + g.stage);
      // 追加窗口开着：有时候谁都不动，到时间关窗（界面倒计时结束时调 closeWindow）
      if (g.betting && g.betting.window && rng() < 0.2) { assert.equal(CC.closeWindow(g), true); timeouts++; assert.ok(++steps < 400); continue; }
      const side = who[Math.floor(rng() * who.length)];
      const opts = CC.legal(g, side);
      const o = opts[Math.floor(rng() * opts.length)];
      const a = Object.assign({}, o);
      if (o.type === "bet" || o.type === "raise") a.amount = o.min + Math.floor(rng() * (o.max - o.min + 1));
      if (o.type === "borrow") a.amount = o.min + o.step * Math.floor(rng() * ((o.max - o.min) / o.step + 1));
      if (o.type === "raise" && g.betting.window) windowRaises++;
      // 下注不封顶：对方押得比自己手上的还多（跟不起）时借——借贷不设上限
      if (o.type === "borrow" && g.betting && !opts.some(x => x.type === "call") && g.sides[CC.other(side)].st > g.sides[side].st) shortLoans++;
      CC.act(g, side, a);
      assert.ok(++steps < 400);
    }
    const d = g.sides.dealer, p = g.sides.player;
    loans += d.loan + p.loan;
    maxLoan = Math.max(maxLoan, d.loan, p.loan);
    if (g.final.chips.dealer < 0 || g.final.chips.player < 0) negative++;
    windows += g.log.filter(e => e.t === "window" && e.op === "open").length;
    // 借来的筹码进了桌上，对局结束时扣还（每 3 枚还 4 枚）
    assert.equal(d.chips + p.chips, 100 + d.loan + p.loan - d.owe - p.owe, "种子 R" + n);
    assert.equal(d.owe, CC.repayOf(d.loan)); assert.equal(p.owe, CC.repayOf(p.loan));
    assert.equal(d.pot + p.pot, 0);
    assert.ok(g.final.held.dealer >= 0 && g.final.held.player >= 0);
    assert.deepEqual(J(g.final.chips), { dealer: d.chips, player: p.chips });
    if (g.round === 5 && g.results.length === 5) assert.deepEqual(J(d.history.map(h => h.card).sort()), J(C.layers.slice().sort()));
    assert.ok(g.final);
  }
  assert.ok(loans > 0, "乱打里借过筹码");
  assert.ok(windows > 0 && timeouts > 0 && windowRaises > 0, `乱打里开过追加窗口 ${windows} 次、到时间 ${timeouts} 次、窗口里加注 ${windowRaises} 次`);
  assert.ok(shortLoans > 0, "乱打里有过跟不起、借来跟的时候：" + shortLoans);
  assert.ok(maxLoan > C.startChips, `一局借得比开局筹码还多（最多一方借了 ${maxLoan} 枚）：借贷不设上限`);
  assert.ok(negative > 0, "乱打里有还不上、最后记成负数的：" + negative);
});

test("不合法的操作会被拒绝：不是自己的回合、对局结束后", () => {
  const g = CC.newGame({ seed: "拒绝", deck: DECK });
  assert.throws(() => A(g, "player", "play", { card: "fire" }), /现在不是玩家操作的时候/);
  assert.throws(() => A(g, "dealer", "weather", { op: "discard" }));
  assert.throws(() => A(g, "dealer", "bet", { amount: 1 }));
  const over = CC.newGame({ seed: "完", dealerChips: 0 });
  assert.throws(() => A(over, "dealer", "weather", { op: "pass" }), /不能这样做/);   // 一开局就没筹码：先问借不借
  A(over, "dealer", "noLoan");
  assert.equal(over.over, true);
  assert.throws(() => A(over, "dealer", "weather", { op: "pass" }), /已经结束/);
});

/* ---------- 赌场（预留接口） ---------- */

test("赌场：有最低买入；庄家筹码无限，全押上限按玩家的筹码；离桌按桌子的倍率折算", () => {
  const tables = CC.casino.tables();
  assert.ok(tables.length >= 2);
  tables.forEach(t => { assert.ok(t.minBuyIn > 0); assert.ok(t.rate > 0); assert.ok(["easy", "normal", "hard"].includes(t.difficulty)); });
  const t = tables[0];
  assert.throws(() => CC.casino.newGame(t.id, t.minBuyIn - 1), /最低买入/);
  assert.throws(() => CC.casino.newGame("没有的桌子", 100));
  const g = CC.casino.newGame(t.id, t.minBuyIn, { deck: ["phase", "heat", "snow", "acid", "thunder", "sand", "glow"] });
  assert.equal(g.sides.player.chips, t.minBuyIn - 1);
  assert.equal(g.sides.dealer.infinite, true);
  const pv = CC.view(g, "player");
  assert.equal(pv.opp.infinite, true); assert.equal(pv.opp.chips, null);
  toBet1(g, "flesh", "fire"); checks(g);
  A(g, "player", "reveal");                           // 相位全押：上限是玩家的全部筹码
  assert.deepEqual(J(g.results[0].bets), { dealer: t.minBuyIn, player: t.minBuyIn });
  assert.equal(g.sides.player.chips, t.minBuyIn * 2 - 1);
  const out = CC.casino.cashOut(g);
  assert.equal(out.chips, t.minBuyIn * 2 - 1);
  assert.equal(out.net, t.minBuyIn - 1);
  assert.equal(out.netValue, (t.minBuyIn - 1) * t.rate);
  assert.throws(() => CC.casino.cashOut(CC.newGame({ seed: "x" })), /不是赌场/);
});
