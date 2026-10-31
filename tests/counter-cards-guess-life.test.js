// High Flux 黑市玩法：猜大猜小 · 赌命版（#489）：黑市 NPC 当庄，押的是坚毅生命。
// 规则层（counter-cards-guess.js）：每格押上固定代价（1 / 2 / 4 点）、不收入场费、赔率比普通桌高；规则层根本不读坚毅；
//   结算后押输了几点只交给接入层（lifeBill），画面（view）里没有；赢了按赔率折奎支，单格赔率够高另给稀有材料。
// 界面（counter-cards-guess-ui.js · startLife）：坚毅剩 1 点和剩 100 点，每一步的画面和能做的操作完全一样（主人 10/30「押坚毅永远能下」）；
//   画面里没有剩余坚毅、也没有扣了多少（只写「坚毅受创」）；接入层说死了就写永久死亡、只能离桌；联机开着房间不开
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
const c = H.load();
vm.runInContext(read("counter-cards.js"), c, { filename: "counter-cards.js" });
vm.runInContext(read("counter-cards-guess.js"), c, { filename: "counter-cards-guess.js" });
const G = c.CounterCardsGuess;
const C = c.CounterCards.CC_CONFIG;
const L = G.GUESS_CONFIG.life;
const RESULTS = [-2, -1, 0, 1, 2];
const oddsRow = (b) => J(b.cells.map(x => (x.open ? x.odds : null)));
const lifeHand = (deal, players) => G.newHand({ seed: "L", table: L.id, deal, players: players || [{ id: "ruby", name: "瑞比" }] });
const bet = (h, id, bets) => G.act(h, id, { type: "bet", bets });
const pass = (h, id) => G.act(h, id, { type: "pass" });
/** 这一手里押不中的开盘格子（按结果挑，保证押输） */
const losers = (h, score) => h.board.cells.filter(x => x.open && x.result !== score).map(x => x.result);

/* ---------- 规则层 ---------- */

test("赌命桌：押的是坚毅，每格押上固定代价（第一轮 1、第二轮 2、第三轮 4 点）；不收入场费、没有筹码；押别的点数押不进去", () => {
  assert.deepEqual(J(L.stake), [1, 2, 4]);
  const t = G.tableOf(L.id);
  assert.equal(t.life, true); assert.equal(t.entry, 0); assert.equal(t.name, "黑市赌命桌");
  assert.ok(!G.tables().some(x => x.id === L.id), "普通桌的列表里没有赌命桌");
  const deal = { element: "fire", weather: "heat", layer: "flesh" };
  const h = lifeHand(deal);
  assert.equal(h.players[0].chips, null);
  const L1 = J(G.legal(h, "ruby"));
  assert.deepEqual(L1.map(o => o.type), ["bet", "pass"]);
  assert.equal(L1[0].stake, 1); assert.equal(L1[0].unit, "shp");
  assert.equal(L1[0].min, undefined); assert.equal(L1[0].max, undefined, "没有「最多押多少」：不看还剩多少坚毅");
  const v = J(G.view(h, "ruby"));
  assert.equal(v.me.chips, undefined); assert.equal(v.me.paid, undefined);
  assert.equal(v.table.life, true); assert.equal(v.table.dealer, "黑市庄家");
  assert.throws(() => bet(h, "ruby", { 0: 2 }), /固定代价/);
  bet(h, "ruby", { 0: 1, "-1": true });
  assert.deepEqual(J(h.players[0].slips.map(x => x.amount)), [1, 1]);
  assert.equal(G.legal(h, "ruby")[0].stake, 2);
  const open = h.board.cells.find(x => x.open).result;
  assert.throws(() => bet(h, "ruby", { [open]: 1 }), /押上 2 点坚毅/);
  bet(h, "ruby", { [open]: 2 });
  if (!h.over) {
    assert.equal(G.legal(h, "ruby")[0].stake, 4);
    bet(h, "ruby", { [h.board.cells.find(x => x.open).result]: true });
  }
  assert.ok(h.over);
  assert.ok(h.log.some(e => /押上 1 点/.test(e.text)), "记录里写固定代价（规则文字）");
});

test("规则层根本不读坚毅：玩家带着坚毅字段也不进对局；坚毅 1 点和 999 点，每一步能做的操作和画面一模一样", () => {
  const deal = { element: "acid", weather: "sand", layer: "armor" };
  const a = lifeHand(deal, [{ id: "ruby", name: "瑞比", shp: 1, shpMax: 30 }]);
  const b = lifeHand(deal, [{ id: "ruby", name: "瑞比", shp: 999, shpMax: 999 }]);
  assert.doesNotMatch(JSON.stringify(a), /shp/);
  const same = () => {
    assert.deepEqual(J(G.legal(a, "ruby")), J(G.legal(b, "ruby")));
    assert.deepEqual(J(G.view(a, "ruby")), J(G.view(b, "ruby")));
  };
  same();
  const r1 = a.board.cells.filter(x => x.open).map(x => x.result).slice(0, 2);
  const bets1 = {}; r1.forEach(r => { bets1[r] = 1; });
  bet(a, "ruby", bets1); bet(b, "ruby", bets1);
  same();
  pass(a, "ruby"); pass(b, "ruby");
  same();
  pass(a, "ruby"); pass(b, "ruby");
  same();
  assert.deepEqual(J(G.lifeBill(a, "ruby")), J(G.lifeBill(b, "ruby")));
});

test("赌命桌的赔率比普通桌高（35/35 不抽水，占位）；不开盘的规则一样（第三轮 k = 4 照样不开）", () => {
  assert.deepEqual(J(L.odds), [35, 35]);
  assert.deepEqual(oddsRow(G.board({}, L.odds)), [9, 3.5, 2.5, 4.5, 20]);
  const boards = [[{}, 245]];
  for (const el of C.elements) { boards.push([{ element: el }, 35]); for (const w of C.weathers) boards.push([{ element: el, weather: w }, 5]); }
  let higher = 0;
  boards.forEach(([known]) => {
    const n = G.board(known), l = G.board(known, L.odds);
    l.cells.forEach((x, i) => {
      if (n.cells[i].open) { assert.ok(x.open && x.odds >= n.cells[i].odds, JSON.stringify(known) + x.result); if (x.odds > n.cells[i].odds) higher++; }
      if (x.k === 0 || x.k === l.N) assert.equal(x.open, false);
      if (l.N === 5 && x.k === 4) assert.equal(x.open, false, "第三轮 k = 4：5/4 → 1 倍，不开");
    });
  });
  assert.ok(higher > 50, "大多数格子更高");
  const h = lifeHand({ element: "fire", weather: "heat", layer: "flesh" });
  assert.deepEqual(oddsRow(h.board), [9, 3.5, 2.5, 4.5, 20]);
});

test("结算：押输了几点只交给接入层（lifeBill），画面里只有「受没受创」；赢了按 押上的点数 × 赔率（向下取整）× 100 奎支，单格赔率够高另给稀有材料", () => {
  const deal = { element: "energy", weather: "glow", layer: "flesh" };
  const score = G.outcome(deal.element, deal.layer, deal.weather);
  const h = lifeHand(deal);
  const lose1 = losers(h, score);
  bet(h, "ruby", { [score]: 1, [lose1[0]]: 1 });             // 第一轮：押中一格、押输一格
  const lose2 = losers(h, score);
  bet(h, "ruby", { [lose2[0]]: 2 });                         // 第二轮：押输一格
  if (!h.over) {
    const cell3 = h.board.cells.find(x => x.result === score);
    if (cell3.open) bet(h, "ruby", { [score]: 4 }); else pass(h, "ruby");
  }
  assert.ok(h.over);
  const p = h.players[0];
  const wins = p.slips.filter(x => x.win), lost = p.slips.filter(x => !x.win);
  assert.ok(wins.length >= 1 && lost.length === 2);
  const bill = J(G.lifeBill(h, "ruby"));
  assert.equal(bill.lost, 1 + 2, "押输的两格：1 + 2 点");
  assert.equal(bill.hurt, true);
  let kz = 0; const items = {};
  wins.forEach(x => {
    kz += Math.floor(x.amount * x.odds) * 100;
    const tier = x.odds >= 20 ? "mat_heart" : x.odds >= 10 ? "mat_crystal" : null;
    if (tier) items[tier] = (items[tier] || 0) + 1;
  });
  assert.equal(bill.prize.kuizhi, kz);
  assert.deepEqual(bill.prize.items.reduce((o, x) => { o[x.id] = x.n; return o; }, {}), items);
  // 画面：押注写固定代价（stake），结算有 win / prize / hurt；押输了一共几点（due / lost）不在里面
  const v = J(G.view(h, "ruby"));
  assert.equal(v.me.hurt, true);
  assert.deepEqual(v.me.prize, bill.prize);
  v.me.slips.forEach(x => { assert.ok([1, 2, 4].includes(x.stake)); assert.equal(x.amount, undefined); assert.equal(x.pay, undefined); });
  assert.doesNotMatch(JSON.stringify(v), /"due"|"lost"/);
  assert.ok(v.log.some(e => /坚毅受创/.test(e.text)));
  assert.ok(!v.log.some(e => /坚毅\s*[−\-+]?\d|\d+\s*点坚毅受创|扣/.test(e.text)), "记录里不写扣了几点");
  // 稀有材料：押中单格赔率 ≥ 10 给稀有晶体、≥ 20 给赫心结晶（取够得着的最高一档）
  assert.deepEqual(J(G.lifeBill(Object.assign(lifeHand(deal), {}), "ruby")), null, "还没结算没有账");
  assert.equal(G.lifeBill(G.newHand({ seed: "x", deal, players: [{ id: "p", chips: 10 }] }), "p"), null, "普通桌没有这个账");
});

test("押中高赔率的格子另给稀有材料：能量第二轮押 −2（32 倍 → 赌命桌 35 倍）给赫心结晶", () => {
  // 能量打肉体、天气相位：找一张让结果是 −2 的组合
  let deal = null;
  for (const w of C.weathers) for (const ly of C.layers) if (!deal && G.outcome("energy", ly, w) === -2) deal = { element: "energy", weather: w, layer: ly };
  assert.ok(deal, "能量有一种组合是 −2");
  const h = lifeHand(deal);
  bet(h, "ruby", { 0: 1 });
  const cell = h.board.cells.find(x => x.result === -2);
  assert.equal(cell.k, 1); assert.equal(cell.odds, 35);
  bet(h, "ruby", { "-2": 2 });
  if (!h.over) pass(h, "ruby");
  const bill = J(G.lifeBill(h, "ruby"));
  assert.ok(bill.prize.items.some(x => x.id === "mat_heart"));
  assert.ok(bill.prize.kuizhi >= 2 * 35 * 100);
  assert.match(G.prizeText(bill.prize), /赫心结晶|mat_heart/);
});

test("赌命桌也防白看：第一轮没押的，后两轮不能再押（直接翻完，什么都不扣）", () => {
  const h = lifeHand({ element: "ice", weather: "snow", layer: "sand" });
  pass(h, "ruby");
  assert.ok(h.over);
  const bill = J(G.lifeBill(h, "ruby"));
  assert.equal(bill.lost, 0); assert.equal(bill.hurt, false);
  assert.deepEqual(bill.prize, { kuizhi: 0, items: [] });
});

/* ---------- 界面 ---------- */

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "items.js", "counter-cards.js", "counter-cards-ui.js", "counter-cards-guess.js", "counter-cards-guess-ui.js"]
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)), UI: P.window.CounterCardsGuessUI, G: P.window.CounterCardsGuess };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
/** 接入层的替身：角色身上的坚毅只在这里（界面拿不到）；结算时扣，扣光就死 */
function grit(shp, shpMax) {
  const unit = { shp, shpMax: shpMax || Math.max(shp, 100) }, calls = [];
  const settle = (bill) => {
    calls.push(bill);
    unit.shp = Math.max(0, unit.shp - bill.lost);
    return unit.shp <= 0 ? { dead: true, notes: ["等级与武器等级清零，移出队伍。"] } : { dead: false };
  };
  return { unit, settle, calls };
}
const SEAT = { id: "ruby", name: "瑞比" };
const DEAL = { element: "fire", weather: "heat", layer: "flesh" };
/** 一手：第一轮押两格必输的，第二轮押一格必输的，第三轮不押（押输 1 + 1 + 2 = 4 点）。每点一下都调 step() */
function playLosing(p, step) {
  const score = p.G.outcome(DEAL.element, DEAL.layer, DEAL.weather);
  // 每点一下整块重画：按结果重新找格子（旧的元素已经不在页面上了）
  const pickLosers = (n) => p.$$("#ccg-board button.ccg-cell").map(b => Number(b.dataset.result)).filter(r => r !== score).slice(0, n)
    .forEach(r => { click(p.$(`#ccg-board button.ccg-cell[data-result="${r}"]`)); step(); });
  pickLosers(2);
  click(p.$('#ccg-actions [data-ccg="bet"]')); step();
  pickLosers(1);
  click(p.$('#ccg-actions [data-ccg="bet"]')); step();
  if (p.$('#ccg-actions [data-ccg="pass"]')) { click(p.$('#ccg-actions [data-ccg="pass"]')); step(); }
}
/** 同一手在两页上交替点（每点一下两边都点、再调 step() 比较） */
function playLosingBoth(pa, pb, step) {
  const score = pa.G.outcome(DEAL.element, DEAL.layer, DEAL.weather);
  const both = (fn) => { fn(pa); fn(pb); step(); };
  const pickLosers = (n) => pa.$$("#ccg-board button.ccg-cell").map(b => Number(b.dataset.result)).filter(r => r !== score).slice(0, n)
    .forEach(r => both(p => click(p.$(`#ccg-board button.ccg-cell[data-result="${r}"]`))));
  const press = (act) => both(p => click(p.$(`#ccg-actions [data-ccg="${act}"]`)));
  pickLosers(2); press("bet");
  pickLosers(1); press("bet");
  if (pa.$('#ccg-actions [data-ccg="pass"]')) press("pass");
}

test("赌命桌界面：坚毅剩 1 点和剩 100 点，每一步的画面（整块 HTML）和能做的操作完全一样——不变灰、不提示「坚毅不足」、选项一样多", () => {
  const A = grit(1), B = grit(100);
  const pa = page(), pb = page();
  pa.UI.startLife({ seat: SEAT, settle: A.settle, seed: "same", deals: [DEAL], fast: true });   // fast：结算前不停（过渡在 counter-cards-guess-ui.test.js 查）
  pb.UI.startLife({ seat: SEAT, settle: B.settle, seed: "same", deals: [DEAL], fast: true });
  let steps = 0;
  const same = () => {
    steps++;
    const sa = pa.UI.state(), sb = pb.UI.state();
    if (sa.hand.over) return;   // 结算以后：坚毅扣光的那一个死了（照规则），下面单独比
    assert.equal(pa.$("#scr-ccg").innerHTML, pb.$("#scr-ccg").innerHTML, "第 " + steps + " 步的画面");
    assert.deepEqual(J(pa.G.legal(sa.hand, "ruby")), J(pb.G.legal(sb.hand, "ruby")));
    const text = pa.$("#scr-ccg").textContent;
    assert.doesNotMatch(text, /不足|不够/, "没有「坚毅不足」这类提示");
    pa.$$("#ccg-board .ccg-cell").forEach(c => { if (c.classList.contains("open")) assert.equal(c.tagName.toLowerCase(), "button", "开盘的格子都能点"); });
  };
  same();
  assert.match(pa.$("#ccg-actions").textContent, /每格押上 1 点坚毅（固定代价）/);
  assert.ok(!pa.$("#ccg-board .cc-chips"), "赌命桌没有筹码堆");
  playLosingBoth(pa, pb, same);
  assert.ok(steps >= 6, "一步一步比过：" + steps);
  // 两边都押完了：押输 4 点。剩 1 点的死了（扣光即真死），剩 100 点的只是受创
  assert.equal(A.calls.length, 1); assert.equal(B.calls.length, 1);
  assert.equal(A.calls[0].lost, 4); assert.equal(B.calls[0].lost, 4);
  const ba = pa.$("#ccg-banner").textContent, bb = pb.$("#ccg-banner").textContent;
  assert.match(ba, /坚毅受创/); assert.match(bb, /坚毅受创/);
  assert.match(ba, /瑞比 坚毅耗尽——永久死亡/); assert.doesNotMatch(bb, /永久死亡/);
  assert.ok(!pa.$('#ccg-banner [data-ccg="again"]'), "死了不能再来一手");
  assert.ok(pb.$('#ccg-banner [data-ccg="again"]'));
});

test("赌命桌界面：押注过程一步一步比（剩 5 点和剩 100 点都扛得住这一手）：连结算横幅都一模一样", () => {
  const A = grit(5), B = grit(100);
  const pa = page(), pb = page();
  pa.UI.startLife({ seat: SEAT, settle: A.settle, seed: "s5", deals: [DEAL, DEAL], fast: true });
  pb.UI.startLife({ seat: SEAT, settle: B.settle, seed: "s5", deals: [DEAL, DEAL], fast: true });
  const same = () => assert.equal(pa.$("#scr-ccg").innerHTML, pb.$("#scr-ccg").innerHTML);
  same();
  const steps = [];
  playLosing(pa, () => steps.push(pa.$("#scr-ccg").innerHTML));
  const stepsB = [];
  playLosing(pb, () => stepsB.push(pb.$("#scr-ccg").innerHTML));
  assert.deepEqual(stepsB, steps);
  same();
  assert.equal(A.unit.shp, 1); assert.equal(B.unit.shp, 96);
  // 再来一手：还是一模一样（剩 1 点的这一手也照样能押）
  click(pa.$('#ccg-banner [data-ccg="again"]')); click(pb.$('#ccg-banner [data-ccg="again"]'));
  same();
  assert.ok(pa.$$("#ccg-board button.ccg-cell").length >= 3, "剩 1 点也照样能押");
});

test("赌命桌的画面、记录里没有剩余坚毅，也没有扣了多少：押注写「押上 N 点坚毅」（固定代价），结算只写「坚毅受创」", () => {
  const A = grit(7319, 9241);
  const p = page();
  p.UI.startLife({ seat: SEAT, settle: A.settle, seed: "num", deals: [DEAL], fast: true });
  const htmls = [];
  playLosing(p, () => htmls.push(p.$("#scr-ccg").innerHTML));
  assert.equal(A.unit.shp, 7315);
  htmls.push(p.$("#scr-ccg").innerHTML, p.doc.body.innerHTML);
  htmls.forEach(h => {
    ["7319", "9241", "7315"].forEach(n => assert.ok(!h.includes(n), "画面里出现了坚毅数值 " + n));
    // 和坚毅挨着的数字只能是固定代价「押上 N 点」（N = 1 / 2 / 4）
    const rest = h.replace(/押上 [124] 点坚毅/g, "").replace(/押上 [124] 点/g, "");
    assert.doesNotMatch(rest, /\d+\s*点坚毅|坚毅\s*[−\-+]?\d/);
  });
  const banner = p.$("#ccg-banner").textContent;
  assert.match(banner, /坚毅受创/);
  assert.doesNotMatch(banner, /扣|剩/);
  assert.match(p.$("#ccg-board").textContent, /押上 1 点 ×/, "押注条写固定代价");
  assert.match(p.$("#ccg-side").textContent, /坚毅受创/);
});

test("押中了赢奖品：横幅写赢得多少奎支 / 材料（奎支不是坚毅，照写）；没押输写「坚毅无损」", () => {
  const A = grit(10);
  const p = page();
  const score = p.G.outcome(DEAL.element, DEAL.layer, DEAL.weather);
  p.UI.startLife({ seat: SEAT, settle: A.settle, seed: "win", deals: [DEAL], fast: true });
  click(p.$(`#ccg-board button.ccg-cell[data-result="${score}"]`));
  click(p.$('#ccg-actions [data-ccg="bet"]'));
  click(p.$('#ccg-actions [data-ccg="pass"]'));
  click(p.$('#ccg-actions [data-ccg="pass"]'));
  const banner = p.$("#ccg-banner").textContent;
  assert.match(banner, /押中 1 格：赢得 \d+ 奎支/);
  assert.match(banner, /坚毅无损/);
  assert.equal(A.calls[0].lost, 0);
  assert.ok(A.calls[0].prize.kuizhi > 0);
  assert.equal(A.unit.shp, 10);
});

test("离桌回到原来的画面（还没结算的这一手不算，什么都不扣）；联机开着房间时不开赌命桌", () => {
  const A = grit(10);
  const p = page();
  let back = 0;
  p.UI.startLife({ seat: SEAT, settle: A.settle, back: () => { back++; }, seed: "leave", deals: [DEAL] });
  assert.ok(visible(p.$("#ccg-game")));
  assert.equal(p.doc.body.dataset.screen, "guess");
  assert.match(p.$("#ccg-top").textContent, /黑市赌命桌/);
  assert.match(p.$("#ccg-top").textContent, /瑞比/);
  click(p.$("#ccg-board button.ccg-cell"));
  click(p.$('#ccg-actions [data-ccg="bet"]'));
  click(p.$('#ccg-top [data-ccg="leave"]'));
  assert.equal(back, 1);
  assert.equal(A.calls.length, 0, "没结算：接入层什么都没扣");
  assert.equal(p.UI.state(), null);
  // 联机：开着房间（主持人或玩家）时不开
  p.w.OnlineGame = { getView: () => ({ active: true }) };
  assert.throws(() => p.UI.startLife({ seat: SEAT, settle: A.settle }), /联机不开赌命桌/);
});
