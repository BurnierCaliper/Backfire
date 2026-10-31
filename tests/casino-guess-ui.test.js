// 猜大猜小进赌场（#528）· 界面：赌场面板（casino-ui.js）里有猜大猜小的一组桌子；坐下打开猜大猜小的牌桌（counter-cards-guess-ui.js 的赌场模式，
// 接法同 casino-ui.js · TABLE_UI 接 Flux Duel / Flux Hold'em）：顶栏写桌子、买入和「离桌」，结算横幅「再来一手 / 离桌」，每走一步交给模式存档；
// 桌上不够时从钱包补看得见；结算前的过渡（#525）照常放。长线养成在真浏览器（手机 390×844）里坐猜大猜小的桌子打一手：不报错、没有横向溢出。
// Node 里用 tests/mini-dom.js 跑 game.html 的真页面结构（同 tests/casino-ui.test.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const J = v => JSON.parse(JSON.stringify(v));
// 先后同 game.html：High Flux → 两种 Flux → 猜大猜小 → casino.js
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "counter-cards-guess.js", "casino.js"];
// 火打肉体 · 酷暑 = +2；火打装甲 · 酷暑 = 0（层牌最后才翻：前三轮的赔率表两手一样）
const PLUS2 = { element: "fire", weather: "heat", layer: "flesh" };
const ZERO = { element: "fire", weather: "heat", layer: "armor" };

function page() {
  const html = read("game.html"), body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const P = MD.create(body, { media: (q) => /prefers-reduced-motion: reduce/.test(q) });
  const ctx = vm.createContext(P.window);
  ["engine.js", "icons.js", "weather-fx.js", "pause-menu.js", "matchup-ui.js"].concat(RULES,
    ["counter-cards-ui.js", "flux-ui.js", "flux-duel-ui.js", "flux-holdem-ui.js", "counter-cards-guess-ui.js", "casino-ui.js"])
    .forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  const doc = P.document;
  return { w: P.window, doc, $: (s) => doc.querySelector(s), $$: (s) => Array.from(doc.querySelectorAll(s)),
    K: P.window.Casino, G: P.window.CounterCardsGuess, UI: P.window.CounterCardsGuessUI };
}
const click = (el) => { assert.ok(el, "要点的东西不在"); el.click(); };
const visible = (el) => !!el && !el.hidden;
const cell = (p, r) => p.$(`#ccg-board .ccg-cell[data-result="${r}"]`);
const act = (p, a) => p.$(`#ccg-actions [data-ccg="${a}"]`);
/** 一个最简单的模式（同 tests/casino-ui.test.js）：钱包是一个对象、奎支是一个数，面板画在一个 div 里；
 *  opt.wallet：钱包（不给 = 第一次来，送 50 枚赠送筹码）；opt.deals：每次坐下的这一手发哪三张牌（按顺序，测试用） */
function mode(p, opt) {
  opt = opt || {};
  const K = p.K, deals = (opt.deals || []).slice();
  const m = { w: K.wallet(opt.wallet || null), kuizhi: 1000, saves: 0, backs: 0, box: p.doc.createElement("div") };
  if (!opt.wallet) K.welcome(m.w);
  p.doc.body.appendChild(m.box);
  m.adapter = {
    view: () => ({ chips: K.chips(m.w), sellable: K.sellable(m.w), kuizhi: m.kuizhi, tables: K.tables(), buy: K.CONFIG.buy, sell: K.CONFIG.sell, game: m.w.seat ? m.w.seat.game : null }),
    buy: (n) => { const r = K.buy(m.w, n, m.kuizhi); m.kuizhi -= r.cost; return [r.text]; },
    sell: (n) => { const r = K.sell(m.w, n); m.kuizhi += r.gain; return [r.text]; },
    sit: (t, b) => { K.sit(m.w, t, b, { seed: "界面" + t, deal: deals.shift() }); return [`坐上 ${t}`]; },
    leave: () => [K.leave(m.w).text],
    saved: () => { m.saves++; },
    refresh: () => { m.box.innerHTML = p.w.CasinoUI.html(m.adapter.view()); },
    back: () => { m.backs++; m.adapter.refresh(); }
  };
  m.box.addEventListener("click", e => p.w.CasinoUI.handle(e, m.adapter));
  m.adapter.refresh();
  m.$ = (s) => m.box.querySelector(s);
  return m;
}
/** 坐下 id 这张桌子，买入 n 枚 */
function sit(m, id, n) {
  m.$(`[data-casino-buyin="${id}"]`).value = String(n);
  click(m.$(`[data-casino="sit"][data-table="${id}"]`));
}

test("赌场面板：猜大猜小一组三张桌子（名字读配置），写庄家是赌场、每轮每格最低注，倍率、最低买入、入场费折成钱包几枚；开头写有哪几种玩法；面板上没有坚毅", () => {
  const p = page(), m = mode(p);
  const groups = Array.from(m.box.querySelectorAll(".cs-game"));
  assert.deepEqual(groups.map(g => g.dataset.game), ["highflux", "duel", "holdem", "guess"]);
  const gg = m.$('.cs-game[data-game="guess"]');
  assert.equal(gg.querySelector("h3").textContent, "猜大猜小");
  assert.match(gg.textContent, /庄家是赌场，筹码无限：盖三张牌，你分三轮押这一手的得分/);
  assert.deepEqual(Array.from(gg.querySelectorAll(".cs-table")).map(t => t.dataset.table), ["guess-alley", "guess-hall", "guess-vip"]);
  const alley = m.$('.cs-table[data-table="guess-alley"]').textContent;
  assert.match(alley, /后巷小桌/);
  assert.match(alley, /庄家：赌场 · 每格最低注 2 \/ 4 \/ 8 枚/);
  assert.match(alley, /桌上每枚 10 奎支（钱包 1 枚 = 桌上 20 枚）· 最低买入 20 枚（1 枚筹码）· 入场费 2 枚（0\.1 枚筹码，每局一次）/);
  assert.match(m.$('.cs-table[data-table="guess-vip"]').textContent, /桌上每枚 200 奎支（钱包 1 枚 = 桌上 1 枚）· 最低买入 50 枚（50 枚筹码）· 入场费 2 枚（2 枚筹码，每局一次）/);
  assert.equal(m.$('[data-casino-buyin="guess-hall"]').value, "30", "买入默认填最低买入");
  const vip = m.$('[data-casino="sit"][data-table="guess-vip"]');
  assert.ok(vip.disabled, "赠送的 50 枚不够贵宾室的最低买入 + 入场费");
  assert.match(vip.textContent, /筹码不够（要 52 枚）/);
  assert.match(m.box.textContent, /和赌场打牌：High Flux、Flux Duel、Flux Hold'em、猜大猜小。/);
  assert.match(m.box.textContent, /钱包空了才问借不借（猜大猜小没有借贷：补不满只能不押）/, "面板的规则写明猜大猜小补不满只能不押");
  assert.ok(!/坚毅/.test(m.box.textContent), "赌场押的是筹码：面板上没有坚毅");
  assert.ok(!p.K.tables().some(t => t.id === p.G.GUESS_CONFIG.life.id), "黑市赌命桌不在赌场里");
  // 名字读配置
  p.G.GUESS_CONFIG.name = "Guess X";
  m.adapter.refresh();
  assert.equal(m.$('.cs-game[data-game="guess"] h3').textContent, "Guess X");
  assert.match(m.$('[data-casino-buyin="guess-hall"]').getAttribute("aria-label"), /Guess X · 大厅买入几枚/);
  p.G.GUESS_CONFIG.name = "猜大猜小";
});

test("坐下猜大猜小的桌子 → 打开猜大猜小的牌桌（赌场模式）：打的是钱包里坐着的这一手；顶栏写桌子、买入和「离桌」，没有换桌 / 回到标题；买入都在桌上（入场费坐下时交过了）；点格子押注、不押，每走一步交给模式存档；结算前的过渡照常放，横幅「再来一手 / 离桌」", () => {
  const p = page(), m = mode(p, { deals: [PLUS2, ZERO] });
  sit(m, "guess-hall", 40);
  const st = p.UI.state();
  assert.ok(st && st.casino, "猜大猜小的牌桌开了，是赌场模式");
  assert.equal(st.hand, m.w.seat.game, "打的就是钱包里坐着的这一手");
  assert.ok(visible(p.$("#scr-ccg")) && visible(p.$("#ccg-game")) && !visible(p.$("#ccg-setup")));
  const top = p.$("#ccg-top");
  assert.match(top.textContent, /猜大猜小 · 大厅 · 买入 40 枚 · 庄家：赌场/);
  assert.ok(top.querySelector('[data-ccg="leave"]'), "顶栏有「离桌」");
  assert.ok(!top.querySelector('[data-ccg="setup"]') && !top.querySelector('[data-ccg="title"]'), "赌场桌不能换桌，也没有「回到标题」");
  assert.equal(p.$("#ccg-board .cc-chips b").textContent, "40", "买入 40 枚都在桌上");
  assert.match(p.$("#ccg-board").textContent, /赌场 · 筹码无限/);
  assert.match(p.$("#ccg-board").textContent, /入场费 2 枚（不退）/);
  const rules = p.$("#ccg-side .cc-rules").textContent;
  assert.match(rules, /每手入场费 2 枚（不退）；每格最低注第一轮 2、第二轮 4、第三轮 8/, "规则说明读坐着的这张桌子");
  assert.match(rules, /入场费坐下时从筹码钱包交给赌场；桌上不够这一轮每格的最低注时，先自动从钱包补到够押一格/);
  // 第一轮押 +2：点格子（默认最低注 2 枚），+ 调到 3 枚，押注
  const saves = m.saves;
  click(cell(p, 2));
  click(p.$('#ccg-actions .ccg-line [data-ccg="amt"][data-d="1"]'));
  click(act(p, "bet"));
  assert.equal(m.saves, saves + 1, "押注交给模式存档");
  assert.deepEqual(J(st.hand.players[0].slips.map(x => [x.round, x.result, x.amount, x.odds])), [[1, 2, 3, 18]]);
  assert.equal(p.$("#ccg-board .cc-chips b").textContent, "37");
  click(act(p, "pass"));
  click(act(p, "pass"));
  assert.equal(m.saves, saves + 3, "不押也交给模式存档");
  assert.ok(st.hand.over);
  // 结算前的过渡（#525）照常放：横幅先不弹，点「直接看结算」
  assert.ok(p.UI.state().settle, "先放结算前的过渡");
  assert.ok(!visible(p.$("#ccg-banner")));
  click(act(p, "skipSettle"));
  const banner = p.$("#ccg-banner");
  assert.ok(visible(banner));
  assert.match(banner.textContent, /这一手结算 · 大厅/);
  assert.match(banner.textContent, /结果 \+2/);
  assert.match(banner.textContent, /押中 1 格，连本带利拿回 54 枚/);
  assert.match(banner.textContent, /这一手 \+49 枚/, "54 − 3 − 入场费 2");
  assert.match(banner.textContent, /桌上 91 枚/);
  assert.match(banner.textContent, /净输赢含入场费 2 枚（坐下时从钱包交给了赌场）/);
  assert.match(banner.querySelector('[data-ccg="casinoAgain"]').textContent, /^再来一手（买入 40 枚 \+ 入场费 2 枚）$/);
  assert.ok(banner.querySelector('[data-ccg="leave"]'), "横幅有「离桌」");
  for (const a of ["again", "setup", "title"]) assert.ok(!banner.querySelector(`[data-ccg="${a}"]`), "赌场桌的结算横幅没有 " + a);
  assert.ok(!/坚毅/.test(p.$("#scr-ccg").textContent), "押筹码的桌子：牌桌上没有坚毅");
  // 面板上：坐着时写坐在哪张桌子、这一局打完了；「看总结算」回到牌桌直接是横幅
  m.adapter.refresh();
  assert.match(m.$(".cs-seat").textContent, /你坐在猜大猜小 · 大厅：买入 40 枚，交了入场费 2 枚 · 这一局打完了/);
  click(m.$('[data-casino="play"]'));
  assert.equal(p.UI.state().hand, m.w.seat.game, "回到同一手");
  assert.ok(visible(p.$("#ccg-banner")), "打完的这一手直接是结算横幅");
  // 再来一手：上一手结算回钱包（桌上 91 枚 = 钱包 22.75 枚），同一张桌子同样买入再坐下、再交入场费
  const h1 = m.w.seat.game;
  click(p.$('#ccg-banner [data-ccg="casinoAgain"]'));
  assert.ok(m.w.seat && m.w.seat.game !== h1, "开了新的一手");
  assert.deepEqual([m.w.seat.table, m.w.seat.buyIn, m.w.seat.fee], ["guess-hall", 40, 2]);
  assert.equal(p.UI.state().hand, m.w.seat.game);
  assert.ok(!visible(p.$("#ccg-banner")), "新的一手：横幅收起");
  assert.deepEqual([p.K.chips(m.w).gift, p.K.chips(m.w).normal], [49.5 - 10.5, 12.75], "赢来的 12.75 枚是普通筹码；再坐下的入场费、买入先拿赠送的");
  // 打到一半离桌：押下的 2 枚不退
  click(cell(p, 0));
  click(act(p, "bet"));
  click(p.$('#ccg-top [data-ccg="leave"]'));
  assert.equal(m.w.seat, null, "离桌结算");
  assert.equal(m.backs, 1, "回到模式的画面");
  assert.match(m.box.textContent, /离开猜大猜小 · 大厅：桌上剩 38 枚（买入 40 枚，输 2 枚），钱包少了 0\.5 枚筹码。/);
});

test("牌局里从钱包补筹码看得见（#520 的做法）：记录写「你从钱包补了 N 枚到桌上」，顶栏、赌场面板座位上的买入跟着加上；「再来一手」照旧按当初选的买入；钱包也空了操作栏写只能不押；离桌按总买入结算", () => {
  const p = page(), m = mode(p, { deals: [PLUS2] });                         // 赠送 50 枚
  sit(m, "guess-alley", 20);                                                  // 后巷小桌：入场费 0.1 枚 + 买入 1 枚
  p.UI.act({ type: "bet", bets: { "0": 20 } });                               // 第一轮把 20 枚都押在 0：第二轮开盘时手上 0 枚
  assert.equal(p.UI.state().hand.round, 2);
  assert.match(p.$("#ccg-side .cc-log").textContent, /你从钱包补了 4 枚到桌上。/, "牌桌的记录里写着");
  assert.equal(p.$("#ccg-board .cc-chips b").textContent, "4");
  assert.match(p.$("#ccg-top").textContent, /猜大猜小 · 后巷小桌 · 买入 24 枚/, "顶栏的买入跟着加上");
  assert.ok(cell(p, 2).tagName.toLowerCase() === "button", "补够了：能押");
  assert.match(p.UI.state().casino.againText, /^再来一手（买入 20 枚 \+ 入场费 2 枚）$/, "「再来一手」照旧按当初选的买入");
  m.adapter.refresh();
  assert.match(m.$(".cs-seat").textContent, /你坐在猜大猜小 · 后巷小桌：买入 24 枚（含从钱包补的 4 枚），交了入场费 2 枚 · 第 2 \/ 3 轮/);
  assert.match(m.box.textContent, /筹码 48\.7 枚/, "钱包少了 0.2 枚（桌上 4 枚）");
  // 离桌：按总买入结算
  click(m.$('[data-casino="play"]'));
  click(p.$('#ccg-top [data-ccg="leave"]'));
  assert.match(m.box.textContent, /离开猜大猜小 · 后巷小桌：桌上剩 4 枚（买入 24 枚，含从钱包补的 4 枚，输 20 枚）/);
  // 钱包也空了：补不到，操作栏写只能不押
  const FACE = p.K.CONFIG.face;
  const poor = mode(p, { wallet: { gifted: true, gift: 0, normal: 1.1 * FACE }, deals: [PLUS2] });   // 正好够入场费 + 买入
  sit(poor, "guess-alley", 20);
  p.UI.act({ type: "bet", bets: { "0": 20 } });
  assert.equal(p.UI.state().hand.round, 2);
  assert.ok(!/从钱包补了/.test(p.$("#ccg-side .cc-log").textContent), "没补");
  assert.match(p.$("#ccg-actions").textContent, /桌上的筹码不够这一轮的最低注 4 枚，钱包里的也补不上，只能不押。/);
  assert.ok(act(p, "pass"), "只能不押");
  assert.ok(!act(p, "bet"));
});

test("打到一半存档、读档：面板上「回到牌桌」接着打这一手（停在第几轮、押过的注都在），补筹码从读进来的钱包补", () => {
  const p = page(), FACE = p.K.CONFIG.face;
  const m = mode(p, { wallet: { gifted: true, gift: 0, normal: 60 * FACE }, deals: [PLUS2] });   // 贵宾室：桌上 1 枚 = 钱包 1 枚
  sit(m, "guess-vip", 50);                                                    // 钱包剩 8 枚
  click(cell(p, 2));
  click(act(p, "bet"));                                                       // 第一轮押 +2 的 2 枚
  assert.equal(p.UI.state().hand.round, 2);
  // 存档 → 读档（新的钱包对象、新的这一手）：面板上「回到牌桌」
  const m2 = mode(p, { wallet: J(m.w) });
  assert.match(m2.$(".cs-seat").textContent, /你坐在猜大猜小 · 贵宾室：买入 50 枚，交了入场费 2 枚 · 第 2 \/ 3 轮/);
  click(m2.$('[data-casino="play"]'));
  const st = p.UI.state();
  assert.equal(st.hand, m2.w.seat.game, "打的是读进来的这一手");
  assert.match(p.$("#ccg-actions").textContent, /第 2 轮下注/);
  assert.match(cell(p, 2).querySelector(".ccg-slip").textContent, /2 枚 ×18/, "第一轮押的注还摆在格子上");
  assert.equal(p.$("#ccg-board .cc-chips b").textContent, "48");
  p.UI.act({ type: "bet", bets: { "2": 48 } });                               // 第二轮押光：第三轮开盘时从读进来的钱包补 8 枚
  assert.match(p.$("#ccg-side .cc-log").textContent, /你从钱包补了 8 枚到桌上。/);
  assert.deepEqual([p.K.chips(m2.w).normal, p.K.chips(m.w).normal], [0, 8], "补的是读进来的钱包");
  assert.ok(m2.saves >= 1, "接着打也每一步存档");
});

/* ---------- 真浏览器（手机 390×844）：没装 Playwright 时用机器自带的 Chrome（tests/cdp-browser.js），都没有才跳过 ---------- */
function findPlaywright() {
  try { return require("playwright"); } catch (e) {}
  try {
    const rootDir = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return require(path.join(rootDir, "playwright"));
  } catch (e) {}
  return null;
}
const pw = findPlaywright();
const GAME_URL = pathToFileURL(path.join(ROOT, "game.html")).href;
let browser = null, cdp = null, skipWhy = "";
async function uiBrowser() {
  if (browser || cdp) return browser || cdp;
  if (skipWhy) return null;
  if (pw) { try { browser = await pw.chromium.launch(); return browser; } catch (e) { skipWhy = "浏览器启动失败：" + e.message.split("\n")[0]; } }
  try { cdp = await require("./cdp-browser").launch(); } catch (e) { skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0]; }
  if (!cdp && !skipWhy) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  if (!cdp && process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要浏览器：" + skipWhy);
  return cdp;
}
test.after(async () => { if (browser) await browser.close(); if (cdp) await cdp.close(); });

test("真浏览器（手机 390×844）：长线养成 → 任务板前去赌场 → 坐猜大猜小的后巷小桌打一手（结算前的过渡照常放）→ 离桌回到任务板，钱包结算对；不报错、没有横向溢出", { timeout: 180000 }, async (t) => {
  const b = await uiBrowser();
  if (!b) { t.skip(skipWhy); return; }
  const context = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], bad = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(GAME_URL);
  // 结算前的过渡调短（每步 150 毫秒、判定中 300 毫秒），照常不开 fast
  await page.evaluate(() => { Object.assign(CounterCardsUI.UI_CONFIG.settle, { lastMs: 150, judgeMs: 300, reducedJudgeMs: 300 }); });
  const overflow = async (where) => {
    const o = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
    if (o > 1) bad.push(`${where}：横向溢出 ${o}px`);
  };
  // 手指点按：两下点得太快（不到 300 毫秒）浏览器会当成同一个手势，后一下不合成 click——每下之前停一会儿，像真人点的
  const tap = async (sel) => { await page.waitForTimeout(350); await page.tap(sel); };
  // 标题 → 本地玩法 → 长线养成 → 选两名角色出发
  await tap("#t-local");
  await page.waitForFunction(() => !document.querySelector("#t-growth").disabled);
  await tap("#t-growth");
  await page.waitForFunction(() => Screens.is("party"));
  for (const kit of ["ruby", "yuito"]) await tap(`.hero-pick[data-kit="${kit}"]`);
  await tap("#party-go");
  await page.waitForFunction(() => Screens.is("run") && !!document.querySelector("#r-casino-open"));
  // 去赌场：第一次来送 50 枚赠送筹码；面板上有猜大猜小的一组桌子
  await tap("#r-casino-open");
  await page.waitForSelector('[data-casino="sit"][data-table="guess-alley"]');
  assert.equal(await page.evaluate(() => document.querySelector('.cs-game[data-game="guess"] h3').textContent), "猜大猜小");
  await overflow("赌场面板");
  await tap('[data-casino="sit"][data-table="guess-alley"]');
  await page.waitForFunction(() => Screens.is("guess") && !!CounterCardsGuessUI.state() && !!CounterCardsGuessUI.state().casino);
  assert.equal(await page.evaluate(() => CounterCardsGuessUI.state().hand === RunFlow.current().casino.seat.game), true, "打的是长线存档钱包里坐着的这一手");
  assert.match(await page.evaluate(() => document.querySelector("#ccg-top").textContent), /猜大猜小 · 后巷小桌 · 买入 20 枚/);
  await overflow("猜大猜小牌桌（第一轮）");
  // 第一轮押 0（最低注 2 枚），后面每轮不押；结果已经定了的那一轮直接翻牌
  await tap('#ccg-board .ccg-cell[data-result="0"]');
  await tap('#ccg-actions [data-ccg="bet"]');
  for (let i = 0; i < 4 && !(await page.evaluate(() => CounterCardsGuessUI.state().hand.over)); i++) {
    await overflow(`猜大猜小牌桌（第 ${await page.evaluate(() => CounterCardsGuessUI.state().hand.round)} 轮）`);
    await tap('#ccg-actions [data-ccg="pass"]');
  }
  assert.equal(await page.evaluate(() => RunFlow.current().casino.seat.game.over), true, "这一手打完了（长线存档里的那一手）");
  // 结算前的过渡 → 结算横幅
  const phases = new Set();
  for (let i = 0; i < 200; i++) {
    const m = await page.evaluate(() => ({ settle: CounterCardsGuessUI.state().settle && CounterCardsGuessUI.state().settle.phase, banner: !document.querySelector("#ccg-banner").hidden }));
    if (m.settle) { phases.add(m.settle); await overflow("结算前的过渡（" + m.settle + "）"); }
    if (m.banner) break;
    await page.waitForTimeout(20);
  }
  assert.ok(phases.has("judge"), "放过「判定中」：" + [...phases].join("、"));
  await page.waitForSelector('#ccg-banner [data-ccg="leave"]');
  await overflow("结算横幅");
  const chips = await page.evaluate(() => CounterCardsGuessUI.state().hand.players[0].chips);
  // 离桌：回到任务板，桌上剩的按倍率回钱包（后巷小桌：桌上 20 枚 = 钱包 1 枚）
  await tap('#ccg-banner [data-ccg="leave"]');
  await page.waitForFunction(() => Screens.is("run"));
  const after = await page.evaluate(() => ({ text: document.querySelector("#scr-run").textContent, seat: RunFlow.current().casino.seat, chips: Casino.chips(RunFlow.current().casino) }));
  assert.equal(after.seat, null, "离桌结算");
  assert.match(after.text, new RegExp(`离开猜大猜小 · 后巷小桌：桌上剩 ${chips} 枚（买入 20 枚`));
  assert.ok(Math.abs(after.chips.total - (50 - 0.1 - 1 + chips / 20)) < 1e-9, `钱包：${after.chips.total}`);
  await overflow("离桌回到任务板");
  assert.ok(!/坚毅/.test(await page.evaluate(() => document.querySelector("#scr-ccg").textContent)), "押筹码的桌子：牌桌上没有坚毅");
  assert.deepEqual(bad, [], "每一步都没有横向溢出");
  assert.deepEqual(errors, []);
});
