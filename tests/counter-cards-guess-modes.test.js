// High Flux 黑市玩法：猜大猜小 · 赌命桌接进长线养成 / 跑团（#489 第 4 步）：
// 长线养成（rogue.js · blackMarketSettle，run 指令 blackMarket）：押输的点数从角色的坚毅里扣，扣光即真死（等级清零、移出队伍、记进 deadKits），
//   赢的奎支、材料进这一局；只在任务板前；记录不写坚毅数值。
// 跑团（trpg.js · trpgBlackMarketSettle，trpg 指令 blackMarket）：主持人当庄；扣光状态记成死亡；奖金进角色钱包（死了进公账）。
// 接上界面：坚毅剩 1 点和满的，黑市入口和牌桌每一步完全一样；押输了剩 1 点的照规则死。入口只给名字；联机 / 热座不开
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
const plain = x => JSON.parse(JSON.stringify(x));
const DEAL = { element: "fire", weather: "heat", layer: "flesh" };
const NO_GRIT_NUMBER = /坚毅\s*[−\-+]?\d|\d+\s*点坚毅|剩\s*\d|扣/;

/** 长线养成的一局（规则环境里也加载猜大猜小：账从 lifeBill 来） */
function growth(seed) {
  const c = H.load();
  ["counter-cards.js", "counter-cards-guess.js"].forEach(f => vm.runInContext(read(f), c, { filename: f }));
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed, growth: true });
  return { c, run, R: c.Rogue };
}
const shpOf = (g, kit) => g.R.heroView(g.run, g.run.party.find(h => h.kit === kit)).shp;
const bm = (g, kit, bill) => g.c.dispatch(plain({ type: "run", action: "blackMarket", kit, bill }), { run: g.run });

/** 跑团：场上两名角色（主持人的探索环节） */
function trpg(seed) {
  const c = H.load();
  ["counter-cards.js", "counter-cards-guess.js"].forEach(f => vm.runInContext(read(f), c, { filename: f }));
  c.S.RNG.install(seed || "BM-TRPG");
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: seed || "BM-TRPG" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  c.S.state.bag = { items: [] };
  return c;
}
const tsend = (c, command) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, command)));
const unitOf = (c, kit) => c.findKit(kit, c.S.state.units);

/** 界面：game.html 的真页面结构 + 猜大猜小的脚本（和 tests/counter-cards-guess-life.test.js 一样） */
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
/** 同一手在两页上交替点：第一轮押两格必输的、第二轮押一格必输的、第三轮不押（押输 1 + 1 + 2 = 4 点）；每点一下调 step() */
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

/* ---------- 长线养成 ---------- */

test("长线养成：押输的点数从角色的坚毅里扣（记录只写「坚毅受创」，不写数字）；赢的奎支和材料进这一局", () => {
  const g = growth("BM1"), kit = "kolt", full = shpOf(g, kit);
  assert.ok(full > 3);
  const kz0 = g.R.supplies().kuizhi, mat0 = g.c.bagCount("mat_crystal");
  const r = bm(g, kit, { lost: 3, prize: { kuizhi: 900, items: [{ id: "mat_crystal", n: 1 }] }, hurt: true });
  assert.equal(r.dead, false);
  assert.equal(shpOf(g, kit), full - 3);
  assert.equal(g.R.supplies().kuizhi, kz0 + 900);
  assert.equal(g.c.bagCount("mat_crystal"), mat0 + 1);
  assert.ok(r.notes.some(t => /坚毅受创/.test(t)));
  assert.ok(r.notes.some(t => /赢得 900 奎支、稀有晶体 ×1/.test(t)));
  const text = r.notes.concat(g.run.log.map(l => l.text));
  text.forEach(t => assert.doesNotMatch(t, NO_GRIT_NUMBER, t));
  assert.ok(g.run.log.some(l => /坚毅受创/.test(l.text)), "写进这一局的记录");
  // 没押输：坚毅不动
  bm(g, kit, { lost: 0, prize: { kuizhi: 0, items: [] }, hurt: false });
  assert.equal(shpOf(g, kit), full - 3);
});

test("长线养成：坚毅扣光即真死——移出队伍、记进 deadKits（下次抽到从 1 级重新培养）；剩 1 点也照样能上桌", () => {
  const g = growth("BM2"), kit = "kolt";
  const h = g.run.party.find(x => x.kit === kit);
  h.shp = 1; h.level = 6;
  const r = bm(g, kit, { lost: 4, prize: { kuizhi: 300, items: [] }, hurt: true });
  assert.equal(r.dead, true);
  assert.ok(!g.run.party.some(x => x.kit === kit), "移出队伍");
  assert.ok(g.run.deadKits.includes(kit));
  assert.ok(r.notes.some(t => /永久死亡，等级与武器等级清零，移出队伍/.test(t)));
  assert.ok(r.notes.some(t => /坚毅耗尽/.test(t)));
  r.notes.forEach(t => assert.doesNotMatch(t, NO_GRIT_NUMBER, t));
  assert.notEqual(g.run.stage, "over", "还有别人：这一局照常");
  assert.throws(() => bm(g, kit, { lost: 1 }), /队伍里没有/);
});

test("长线养成之外没有黑市赌命桌；不在任务板前（接了任务在路上）也不能上", () => {
  const g = growth("BM3");
  g.R.acceptTask(g.run, 0);
  assert.notEqual(g.run.stage, "board");
  assert.throws(() => bm(g, "kolt", { lost: 1 }), /任务板/);
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "BM3n" });
  assert.throws(() => c.dispatch(plain({ type: "run", action: "blackMarket", kit: "kolt", bill: { lost: 1 } }), { run }), /只有长线养成/);
});

test("长线养成接上界面：角色坚毅剩 1 点和满的，黑市入口、牌桌每一步完全一样；押输了剩 1 点的照规则真死、满的只是受创", () => {
  const A = growth("BM4"), B = growth("BM4");
  const kit = A.run.party[0].kit;
  A.run.party[0].shp = 1;
  const full = shpOf(B, kit);
  assert.ok(full > 5);
  const pa = page(), pb = page();
  // 和 rogue-ui.js · renderBlackMarket 一样：上桌的角色只给 id 和名字
  const seats = (g) => g.run.party.map(h => ({ id: h.kit, name: g.R.heroName(h.kit) }));
  const opt = { death: "坚毅扣光即真正死亡：等级与武器等级清零、移出队伍，下次抽到从 1 级重新培养" };
  assert.equal(pa.UI.blackMarketHtml(seats(A), opt), pb.UI.blackMarketHtml(seats(B), opt));
  assert.equal((pa.UI.blackMarketHtml(seats(A), opt).match(/data-ccg-black=/g) || []).length, 2, "两个人都能上桌");
  const adapter = (g) => (bill) => bm(g, kit, bill);
  pa.UI.startLife({ seat: seats(A)[0], settle: adapter(A), seed: "same", deals: [DEAL], fast: true });   // fast：结算前不停（过渡在 counter-cards-guess-ui.test.js 查）
  pb.UI.startLife({ seat: seats(B)[0], settle: adapter(B), seed: "same", deals: [DEAL], fast: true });
  let steps = 0;
  const same = () => {
    steps++;
    if (pa.UI.state().hand.over) return;
    assert.equal(pa.$("#scr-ccg").innerHTML, pb.$("#scr-ccg").innerHTML, "第 " + steps + " 步");
    assert.deepEqual(plain(pa.UI.view().legal), plain(pb.UI.view().legal));
  };
  same();
  playLosingBoth(pa, pb, same);
  assert.ok(steps >= 6);
  assert.ok(!A.run.party.some(h => h.kit === kit), "剩 1 点的：真死、移出队伍");
  assert.ok(A.run.deadKits.includes(kit));
  assert.equal(shpOf(B, kit), full - 4, "满的：只是受创");
  assert.match(pa.$("#ccg-banner").textContent, /坚毅耗尽——永久死亡/);
  assert.doesNotMatch(pb.$("#ccg-banner").textContent, /永久死亡/);
  [pa, pb].forEach(p => {
    assert.match(p.$("#ccg-banner").textContent, /坚毅受创/);
    // 坚毅数值本来就小，会和固定代价的字（「第二轮 2 点」）撞上：去掉规则文字以后，和坚毅挨着的地方不能有数字
    const rest = p.$("#scr-ccg").textContent.replace(/押上 [124] 点坚毅|押上 [124] 点|第[一二三]轮 [124] 点|每格押上 [124 \/]+点/g, "");
    assert.doesNotMatch(rest, /\d+\s*点坚毅|坚毅\s*[−\-+]?\d|剩\s*\d/);
  });
});

/* ---------- 跑团 ---------- */

test("跑团：主持人当庄；押输的坚毅从角色身上扣（记录不写数字），扣光状态记成死亡；奖金进这名角色的钱包（死了进公账），材料进背包", () => {
  const c = trpg("BM5");
  const u = unitOf(c, "kolt"), full = u.shp;
  assert.ok(full > 2);
  let notes = tsend(c, { action: "blackMarket", kit: "kolt", bill: { lost: 2, prize: { kuizhi: 500, items: [{ id: "mat_heart", n: 1 }] }, hurt: true } });
  assert.equal(u.shp, full - 2);
  assert.equal(c.trpgPurse("kolt"), 500);
  assert.equal(c.bagCount("mat_heart"), 1);
  assert.ok(notes.some(t => /坚毅受创/.test(t)));
  notes.forEach(t => assert.doesNotMatch(t, NO_GRIT_NUMBER, t));
  // 扣光：状态记成死亡；这一手赢的奎支进队伍公账
  notes = tsend(c, { action: "blackMarket", kit: "kolt", bill: { lost: 999, prize: { kuizhi: 100, items: [] }, hurt: true } });
  assert.equal(u.dead, true);
  assert.equal(u.shp, 0);
  assert.equal(c.trpgHeroStatus(u), "dead");
  assert.equal(c.trpgPurse("party"), 100);
  assert.ok(notes.some(t => /坚毅耗尽，永久死亡/.test(t)));
  notes.forEach(t => assert.doesNotMatch(t, NO_GRIT_NUMBER, t));
  // 死了不能再上桌；另一个人不受影响
  assert.match(tsend(c, { action: "blackMarket", kit: "kolt", bill: { lost: 1 } }).join(""), /已经死亡/);
  assert.equal(unitOf(c, "helu").dead, false);
});

test("跑团接上界面：坚毅剩 1 点和满的，牌桌每一步完全一样（庄家写主持人）；押输了剩 1 点的状态记成死亡", () => {
  const A = trpg("BM6"), B = trpg("BM6");
  unitOf(A, "kolt").shp = 1;
  const full = unitOf(B, "kolt").shp;
  const pa = page(), pb = page();
  // 和 trpg-ui.js · openBlackMarket 一样：跑 trpg 指令，再看这名角色是不是死了
  const adapter = (c) => (bill) => { tsend(c, { action: "blackMarket", kit: "kolt", bill }); return { dead: !!unitOf(c, "kolt").dead }; };
  const seat = { id: "kolt", name: unitOf(A, "kolt").name };
  pa.UI.startLife({ seat, dealer: "主持人", settle: adapter(A), seed: "t", deals: [DEAL], fast: true });
  pb.UI.startLife({ seat, dealer: "主持人", settle: adapter(B), seed: "t", deals: [DEAL], fast: true });
  assert.match(pa.$("#ccg-top").textContent, /庄家：主持人/);
  const same = () => { if (!pa.UI.state().hand.over) assert.equal(pa.$("#scr-ccg").innerHTML, pb.$("#scr-ccg").innerHTML); };
  same();
  playLosingBoth(pa, pb, same);
  assert.equal(A.trpgHeroStatus(unitOf(A, "kolt")), "dead");
  assert.equal(unitOf(B, "kolt").shp, full - 4);
  assert.match(pa.$("#ccg-banner").textContent, /永久死亡/);
  assert.doesNotMatch(pb.$("#ccg-banner").textContent, /永久死亡/);
});

/* ---------- 入口 ---------- */

test("入口：长线养成的任务板、跑团的「商人」页都有黑市（只给名字，不读坚毅）；联机开着房间 / 本机热座时这里不开（联机玩家在「赌场」里上桌，#526）", () => {
  const rogueUi = read("rogue-ui.js"), trpgUi = read("trpg-ui.js");
  assert.match(rogueUi, /\$\{renderBlackMarket\(\)\}/);
  assert.match(rogueUi, /CounterCardsGuessUI\.blackMarketHtml\(run\.party\.map\(h => \(\{ id: h\.kit, name: Rogue\.heroName\(h\.kit\) \}\)\)/);
  assert.match(rogueUi, /dispatch\(\{ type: "run", action: "blackMarket", kit, bill \}, \{ run \}\)/);
  assert.match(rogueUi, /\[data-ccg-black\]/);
  assert.match(trpgUi, /\$\{blackMarketHtml\(\)\}/);
  assert.match(trpgUi, /CounterCardsGuessUI\.blackMarketHtml\(heroes\(\)\.filter\(h => !h\.dead\)\.map\(h => \(\{ id: h\.kit, name: h\.name \}\)\)/);
  assert.match(trpgUi, /ruleCommand\("blackMarket", \{ kit, bill \}\)/);
  assert.match(trpgUi, /\[data-ccg-black\]/);
  // 这两段接入的代码里不碰坚毅
  const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const rogueBm = between(rogueUi, "function renderBlackMarket", "function doDraw");
  const trpgBm = between(trpgUi, "function blackMarketHtml()", "function merchantEditorHtml");
  assert.ok(rogueBm.length > 200 && trpgBm.length > 200);
  [rogueBm, trpgBm].forEach(src => assert.doesNotMatch(src, /shp|heroView/));
  // game.html：猜大猜小的规则和界面在长线养成 / 跑团的界面之前加载
  const html = read("game.html"), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at("counter-cards-guess.js") > 0 && at("counter-cards-guess-ui.js") > at("counter-cards-ui.js"));
  assert.ok(at("counter-cards-guess-ui.js") < at("rogue-ui.js") && at("counter-cards-guess-ui.js") < at("trpg-ui.js"));
  // 联机 / 热座：本机的入口没有上桌的按钮，startLife 也不开（联机玩家在探索环节的「赌场」里上桌，#526：casino-online-ui.js）
  const p = page(), seats = [{ id: "kolt", name: "柯尔特" }];
  assert.match(p.UI.blackMarketHtml(seats), /data-ccg-black="kolt"/);
  assert.match(p.UI.blackMarketHtml(seats), /押坚毅永远能下/);
  p.w.HotseatGame = { isActive: () => true };
  const off = p.UI.blackMarketHtml(seats);
  assert.match(off, /联机时玩家在探索环节的「赌场」里上赌命桌，这里不开/);
  assert.doesNotMatch(off, /data-ccg-black/);
  assert.throws(() => p.UI.startLife({ seat: seats[0] }), /这里不开/);
  p.w.HotseatGame = { isActive: () => false };
  p.w.OnlineGame = { getView: () => ({ active: true }) };
  assert.match(p.UI.blackMarketHtml(seats), /联机时玩家在探索环节的「赌场」里上赌命桌/);
});
