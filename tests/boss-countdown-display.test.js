// 首领机制的倒计时显示：单位卡 / 踩塔牌子 / 悬停说明都写「还有 N 回合」（到时写「本回合落下」）；
// 信息多（首领机制 + 一长串状态）时悬停说明加宽、可以滚动，挤的区里也不再把状态整行藏掉。
// 单机（Roguelike 同一个战斗画面）和联机玩家画面都看得到；坚毅生命永远不给玩家看
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");
const UnitCard = require("../unit-card.js"), UnitTip = require("../unit-tip.js");

/* ---------- 文字（不需要浏览器） ---------- */
test("倒计时文字：还有 N 回合 / 本回合落下；踩塔牌子和悬停说明里的首领机制都写出剩几回合", () => {
  assert.equal(UnitCard.mechLeft({ left: 3 }), "还有 3 回合");
  assert.equal(UnitCard.mechLeft({ left: 1 }), "还有 1 回合");
  assert.equal(UnitCard.mechLeft({ left: 0 }), "本回合落下");
  const lines = UnitCard.mechLines({
    marks: [{ type: "execution", name: "死刑", left: 2, by: "亡命之王", phase: "enemy" }],
    casts: [{ type: "share", name: "分担", left: 0, target: "瑞比", phase: "player" }]
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^死刑（还有 2 回合）：亡命之王 的死刑：2 回合后落下/);
  assert.match(lines[1], /^分担 → 瑞比（本回合落下）：这回合在我方回合开始时落下/);
  const tw = UnitCard.towerHtml([{ type: "tower", name: "踩塔", left: 2, need: 1, have: 0, by: "王", phase: "enemy", soak: 5, fail: 60 }]);
  assert.match(tw, /踩塔 · 还有 2 回合 · 0\/1 人/);
  assert.match(tw, /class="short"/);
  const html = UnitTip.html({ kind: "enemy", kit: "thug_knife" }, ["灼烧×2"], { name: "王", sub: "Lv5", mechs: lines });
  assert.match(html, /首领机制 · 倒计时/);
  assert.match(html, /<b>死刑（还有 2 回合）<\/b>/);
  // 没有机制就不出这一栏
  assert.doesNotMatch(UnitTip.html({ kind: "enemy", kit: "thug_knife" }, [], { name: "王" }), /首领机制/);
});

test("规则 → 显示：首领机制倒数时 left 逐回合减少，联机投影（online-view.js）把 left 原样带给玩家，不带坚毅生命", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "CD-T" });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.shp = 777001; });
  c.addBossMechanic(boss, { type: "execution", turns: 3, hits: [{ flat: 1 }] });
  c.startCombat();
  const left = () => c.bossCastsBy(boss)[0].left;
  assert.equal(left(), 3);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.equal(left(), 2, "过一回合少一回合");
  const target = S.units.find(u => u.id === boss.mechanics[0].st.targetId);
  Object.assign(globalThis, { state: S, bossMarksOn: c.bossMarksOn, bossCastsBy: c.bossCastsBy, statusLine: c.statusLine });
  try {
    delete require.cache[require.resolve("../online-view.js")];
    const OV = require("../online-view.js");
    const pb = OV.projectUnit(boss), pt = OV.projectUnit(target);
    assert.equal(JSON.stringify(pb.display.casts.map(x => [x.name, x.left, x.target])), JSON.stringify([["死刑", 2, target.name]]));
    assert.equal(JSON.stringify(pt.display.marks.map(x => [x.name, x.left])), JSON.stringify([["死刑", 2]]));
    // 卡片上的写法
    assert.match(UnitCard.mechLines(pt.display)[0], /^死刑（还有 2 回合）/);
    assert.doesNotMatch(JSON.stringify([pb, pt]), /777001|"shp"/, "坚毅生命不进玩家数据");
  } finally { for (const k of ["state", "bossMarksOn", "bossCastsBy", "statusLine"]) delete globalThis[k]; }
});

test("挤的区（dense-3）不再把状态 / 首领倒计时整行藏掉；资源一行不再截成省略号；悬停说明能滚动", () => {
  const css = fs.readFileSync(path.join(ROOT, "game.css"), "utf8"), tip = fs.readFileSync(path.join(ROOT, "hud-icons.css"), "utf8");
  assert.doesNotMatch(css, /\.g-zone\.dense-3 [^{]*\.u-status[^{]*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.u-res \{[^}]*text-overflow: ellipsis/);
  assert.match(tip, /\.unit-tip \{[^}]*overflow: hidden auto/);
  assert.match(tip, /\.unit-tip\.ut-wide \.ut-effects \{ grid-template-columns: 1fr 1fr/);
});

/* ---------- 画面（Playwright） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { const pw = playwright(); if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function site(t) {
  const website = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { website.once("error", reject); website.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => website.close(resolve)));
  return "http://127.0.0.1:" + website.address().port;
}
/** 首领身上一长串状态 + 四种机制（踩塔、死刑、分担、远离） */
const PILE = () => {
  const boss = state.units.find(u => !u.isPlayer && !u.dead && u.mechanics);
  boss.statuses = Object.assign(boss.statuses || {}, { burn: 3, shock: true, corr: true, frostbite: true, shockwave: true, weak: true, reso: true, unstable: true, inspire: true, hide: true, advantage: true, chase: true, sturdy: true });
  boss.instant = Object.assign(boss.instant || {}, { melt: true, sting: true, overload: true, shift: true, spread: true, refract: true, doubleStatus: true, omenArmed: true });
  boss.focuses = [{ layerType: "armor", seq: ["fire", "ice", "electric"], step: 1 }];
  boss.stunMarks = 1; boss.harshEnv = true; boss.shelterTurn = 1;
  return boss.id;
};
const MECHS = [{ type: "execution", turns: 3 }, { type: "share", turns: 2 }, { type: "tower", turns: 2 }, { type: "spread", turns: 4 }];

async function checkTip(page, sel) {
  await page.hover(sel);
  await page.waitForSelector(".unit-tip.show");
  const t0 = await page.$eval(".unit-tip", t => ({ mechs: [...t.querySelectorAll(".ut-mechs li")].map(li => li.textContent), wide: t.classList.contains("ut-wide"), scroll: t.classList.contains("ut-scroll"), more: !!t.querySelector(".ut-more"), sh: t.scrollHeight, ch: t.clientHeight, bottom: t.getBoundingClientRect().bottom, text: t.textContent }));
  assert.ok(t0.mechs.length >= 4, "悬停说明列出首领的每个机制");
  for (const name of ["死刑", "分担", "踩塔", "远离"]) assert.ok(t0.mechs.some(x => x.startsWith(name) && /还有 \d 回合/.test(x)), name + " 写出还有几回合");
  assert.ok(t0.wide && t0.scroll && t0.more, "内容多：加宽、可滚动、底下有提示 " + JSON.stringify({ ...t0, text: t0.text.slice(0, 300) }));
  assert.ok(t0.bottom <= 800, "浮窗不超出屏幕");
  assert.doesNotMatch(t0.text, /坚毅生命/);
  await page.mouse.wheel(0, 5000);
  const t1 = await page.$eval(".unit-tip", t => ({ top: t.scrollTop, max: t.scrollHeight - t.clientHeight }));
  assert.ok(t1.top > 0 && Math.abs(t1.top - t1.max) <= 1, "鼠标停在卡上滚轮能翻到浮窗最底下");
  return t0;
}

test("单机战斗画面（Roguelike 同一套）：卡片 / 首领 / 踩塔都写还有几回合；挤的区里也看得到；悬停说明放不下时能滚到底", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.GAME && !!window.UnitCard);
  await page.evaluate(MECHS => {
    GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("首领测试", () => {
      BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }, { id: "thug_knife", lv: 3, zone: 2 }], seed: "CD-UI" });
      const boss = state.units.find(u => !u.isPlayer);
      MECHS.forEach(m => addBossMechanic(boss, m));
      return {};
    });
    GAME.startOrEnd();
  }, MECHS);
  await page.waitForFunction(() => state.combatStarted);
  const bossId = await page.evaluate(PILE);
  await page.evaluate(() => { bossMechSync([]); GAME.refresh(); });
  await page.evaluate(() => document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()));
  await page.waitForTimeout(300);
  const card = await page.$eval(`#g-field .unit-wrap[data-id="${bossId}"]`, w => ({ chips: [...w.querySelectorAll(".mech-chip")].map(c => c.textContent), shown: getComputedStyle(w.querySelector(".u-status")).display, dense: w.closest(".g-zone").className }));
  assert.equal(card.chips.length, 4);
  assert.ok(card.chips.every(x => /· 还有 \d 回合$/.test(x)), card.chips.join(" | "));
  assert.notEqual(card.shown, "none", "状态 / 倒计时一行没藏起来（" + card.dense + "）");
  const tower = await page.$eval("#g-field .ztower", n => n.textContent);
  assert.match(tower, /踩塔 · 还有 2 回合 · \d\/1 人/);
  const marked = await page.$$eval("#g-field .mech-chip[class*=mark-]", ns => ns.map(n => n.textContent));
  assert.ok(marked.some(x => /^死刑 · 还有 3 回合$/.test(x)), marked.join(" | "));
  await checkTip(page, `#g-field .unit-wrap[data-id="${bossId}"] .unit`);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), true, "页面本身不滚动");
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "bug3-rogue-local-tip.png") });
  assert.deepEqual(errors, []);
});

test("联机单局玩家画面（1280×800）：首领倒计时、踩塔倒计时、悬停说明里的机制都看得到；内容多时能滚动；战场高度不变、页面不滚动", { timeout: 120000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const { createLocalRelayServer } = require("../relay/local-server.cjs");
  const origin = await site(t);
  const relay = await createLocalRelayServer({ origins: [origin] }); t.after(() => relay.close());
  const pages = [], errors = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
    const p = await context.newPage(); pages.push(p);
    p.on("pageerror", e => errors.push(e.message)); p.on("dialog", d => d.accept());
    await p.goto(origin + "/game.html"); await p.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
    await p.evaluate(() => { GAME.skip = true; GAME.instant = true; window.__noLevelUpPopup = true; });
  }
  const [host, alice] = pages;
  const code = await host.evaluate(async url => { await OnlineGame.create({ url, name: "房主", mode: "rogue" }); return OnlineGame.getView().roomCode; }, relay.url);
  await alice.evaluate(o => OnlineGame.join(o), { url: relay.url, roomCode: code, name: "Alice" });
  await host.waitForFunction(() => OnlineGame.getView().players.length === 2 && !OnlineGame.isPaused());
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id), hostId = await host.evaluate(() => OnlineGame.getView().identity.id);
  const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  for (const kit of ["ruby", "yuito", "ras"]) await click(host, `.hero-pick[data-kit="${kit}"]`);
  await click(host, "#party-go");
  await host.waitForFunction(() => Screens.is("run") && OnlineGame.getView().heroes.length === 3);
  await host.waitForSelector('#online-panel [data-assign="ruby"]');
  await host.selectOption('#online-panel [data-assign="ruby"]', aliceId);
  await click(host, '#online-panel [data-online="assign"]');
  await host.waitForFunction(a => OnlineRogue.ownerOf("ruby") === a, aliceId);
  await host.evaluate(() => { document.querySelector('#online-panel [data-online="close"]')?.click(); OnlineGame.start(); });
  await alice.waitForFunction(() => !!OnlineGame.getView().packet?.rogue);
  await alice.evaluate(() => OnlineGame.submit({ type: "rogue.vote", option: "task:main" }));
  await click(host, '#run-body .r-go[data-which="main"]');
  await host.waitForFunction(() => RunFlow.current().stage === "task");
  await host.evaluate(() => { const r = RunFlow.current(); r.task.nodes[r.task.index] = { type: "elite", done: false }; RunFlow.refresh(); OnlineGame.touch(); });
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.vote?.options || []).some(o => o.id === "fight"));
  await alice.evaluate(() => OnlineGame.submit({ type: "rogue.vote", option: "fight" }));
  await host.evaluate(id => OnlineRogue.vote(id, "fight"), hostId);
  await host.waitForFunction(() => Screens.is("battle") && state.units.some(u => !u.isPlayer));
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  await host.evaluate(MECHS => { const boss = state.units.find(u => !u.isPlayer && !u.dead); MECHS.forEach(m => addBossMechanic(boss, m)); GAME.startOrEnd(); }, MECHS);
  await host.waitForFunction(() => state.combatStarted);
  const bossId = await host.evaluate(PILE);
  await host.evaluate(() => { bossMechSync([]); state.units.filter(u => u.isPlayer).forEach(u => { u.shp = 777001; }); OnlineGame.touch(); });
  // 行动顺序：房主按当前格子开始，玩家画面露出战场
  await host.waitForSelector('[data-hs="forceStart"]');
  await click(host, '[data-hs="forceStart"]');
  await alice.waitForFunction(id => [...document.querySelectorAll(`.ol-battle [data-unit-id="${id}"] .mech-chip`)].length === 4 && !document.querySelector(".hs-overlay:not([hidden]) .hs-card"), bossId).catch(() => {});
  await alice.waitForFunction(id => [...document.querySelectorAll(`.ol-battle [data-unit-id="${id}"] .mech-chip`)].length === 4, bossId);
  await alice.waitForTimeout(400);
  const seen = await alice.evaluate(id => {
    const w = document.querySelector(`.ol-battle [data-unit-id="${id}"]`);
    const field = document.querySelector(".ol-battle .g-field").getBoundingClientRect();
    return { chips: [...w.querySelectorAll(".mech-chip")].map(c => c.textContent), shown: getComputedStyle(w.querySelector(".u-status")).display,
      tower: (document.querySelector(".ol-battle .ztower") || {}).textContent || "", marks: [...document.querySelectorAll(".ol-battle .mech-chip[class*=mark-]")].map(n => n.textContent),
      field: field.height, pageScroll: document.scrollingElement.scrollHeight - innerHeight, text: document.body.innerText };
  }, bossId);
  assert.equal(seen.chips.length, 4);
  assert.ok(seen.chips.every(x => /· 还有 \d 回合$/.test(x)), seen.chips.join(" | "));
  assert.notEqual(seen.shown, "none");
  assert.match(seen.tower, /踩塔 · 还有 2 回合 · \d\/1 人/);
  assert.ok(seen.marks.some(x => /^死刑 · 还有 3 回合$/.test(x)) && seen.marks.some(x => /^远离 · 还有 4 回合/.test(x)), seen.marks.join(" | "));
  assert.ok(seen.field >= 400, "战场高度没被挤小（" + seen.field + "px）");
  assert.ok(seen.pageScroll <= 1, "页面本身不滚动");
  assert.doesNotMatch(seen.text, /坚毅生命|777001/);
  if (process.env.SHOTS) await alice.screenshot({ path: path.join(process.env.SHOTS, "bug3-online-boss-countdown.png") });
  await checkTip(alice, `.ol-battle [data-unit-id="${bossId}"] .unit`);
  if (process.env.SHOTS) {
    await alice.mouse.wheel(0, -5000); await alice.waitForTimeout(150);
    await alice.screenshot({ path: path.join(process.env.SHOTS, "bug3-online-overflow-tip.png") });
    await alice.mouse.wheel(0, 5000); await alice.waitForTimeout(150);
    await alice.screenshot({ path: path.join(process.env.SHOTS, "bug3-online-overflow-tip-scrolled.png") });
  }
  assert.deepEqual(errors, []);
});
