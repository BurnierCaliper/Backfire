// 联机单局（Roguelike）：房主跑规则；路线等队伍的事投票决定；钱各算各的；战利品按需求分（online-rogue.js）
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const { createLocalRelayServer } = require("../relay/local-server.cjs");
const ROOT = path.resolve(__dirname, "..");
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { const pw = playwright(); if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });

async function room(t) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
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
  const origin = "http://127.0.0.1:" + website.address().port;
  const relay = await createLocalRelayServer({ origins: [origin] });
  t.after(() => relay.close());
  const pages = [], contexts = [], errors = [];
  for (const width of [1440, 1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    page.on("console", m => { if (m.type() === "error") console.log("CONSOLE", pages.indexOf(page), m.text()); });
    await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
    await page.evaluate(() => { GAME.skip = true; GAME.instant = true; });
  }
  t.after(async () => { for (const context of contexts) await context.close(); });
  const [host, alice, bob] = pages;
  const code = await host.evaluate(async url => { await OnlineGame.create({ url, name: "房主", mode: "rogue" }); return OnlineGame.getView().roomCode; }, relay.url);
  for (const [page, name] of [[alice, "Alice"], [bob, "Bob"]]) await page.evaluate(options => OnlineGame.join(options), { url: relay.url, roomCode: code, name });
  await host.waitForFunction(() => OnlineGame.getView().players.length === 3 && !OnlineGame.isPaused());
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id), bobId = await bob.evaluate(() => OnlineGame.getView().identity.id);
  const hostId = await host.evaluate(() => OnlineGame.getView().identity.id);
  return { host, alice, bob, aliceId, bobId, hostId, errors, relayUrl: relay.url };
}
const submit = (page, cmd) => page.evaluate(command => OnlineGame.submit(command), cmd);
const rogueView = page => page.evaluate(() => OnlineGame.getView().packet?.rogue || null);
/** 房主选队伍出发，把瑞比给 Alice、结人给 Bob，拉斯缪尔留给自己，然后开始 */
async function depart(f) {
  const { host, alice, bob, aliceId, bobId } = f;
  assert.equal(await host.evaluate(() => Screens.current()), "party");
  for (const kit of ["ruby", "yuito", "ras"]) await host.click(`.hero-pick[data-kit="${kit}"]`);
  await host.click("#party-go");
  await host.waitForFunction(() => Screens.is("run") && OnlineGame.getView().heroes.length === 3);
  // 房间面板（队伍选好后自动打开）里按角色分配给玩家
  await host.waitForSelector('#online-panel [data-assign="ruby"]');
  await host.selectOption('#online-panel [data-assign="ruby"]', aliceId);
  await host.selectOption('#online-panel [data-assign="yuito"]', bobId);
  await host.click('#online-panel [data-online="assign"]');
  await host.waitForFunction(({ aliceId, bobId }) => OnlineRogue.ownerOf("ruby") === aliceId && OnlineRogue.ownerOf("yuito") === bobId, { aliceId, bobId });
  // 一名玩家不能操控两名角色
  assert.equal(await host.evaluate(a => { try { OnlineGame.assign(a); return "ok"; } catch (e) { return e.message; } }, { ruby: aliceId, yuito: aliceId }), "每名玩家最多操控一名角色，没分配的角色由房主操控");
  await host.click('#online-panel [data-online="close"]');
  await host.evaluate(() => OnlineGame.start());
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !!OnlineGame.getView().packet?.rogue);
}

test("联机单局：房主选队伍、分角色；开局的钱平分进各人钱包；任务板大家投票，人齐按多数决定", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob } = f;
  await depart(f);
  const start = await host.evaluate(() => Rogue.CONFIG.start.kuizhi);
  const r0 = await rogueView(alice);
  assert.equal(r0.stage, "board");
  assert.deepEqual(r0.heroes.map(h => [h.kit, h.mine]), [["ruby", true], ["yuito", false], ["ras", false]]);
  const each = Math.floor(start / 3);
  assert.ok(r0.heroes.every(h => h.purse >= each && h.purse <= each + 1));
  assert.equal(r0.heroes.reduce((s, h) => s + h.purse, 0), start);
  assert.ok(r0.vote.options.some(o => o.id === "task:main"));
  // Alice 投主线；Bob 投第一个支线；还没人齐，不结算
  // Alice 在自己的画面上点投票按钮
  await alice.click('#online-stage [data-online="rogueVote"][data-option="task:main"]');
  await alice.waitForFunction(() => OnlineGame.getView().packet.rogue.vote.options.some(o => o.id === "task:main" && o.mine));
  if (process.env.BACKFIRE_SHOTS) await alice.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, "rogue-player-board.png"), fullPage: true });
  if (process.env.BACKFIRE_SHOTS) await host.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, "rogue-host-board.png"), fullPage: true });
  const side = r0.vote.options.find(o => o.id !== "task:main");
  if (side) assert.equal((await submit(bob, { type: "rogue.vote", option: side.id })).ok, true);
  else assert.equal((await submit(bob, { type: "rogue.vote", option: "task:main" })).ok, true);
  assert.equal(await host.evaluate(() => RunFlow.current().stage), "board");
  // 房主在单局画面上点「执行主线」= 投主线；人齐了，主线 2 票胜出
  await host.click('#run-body .r-go[data-which="main"]');
  await host.waitForFunction(() => RunFlow.current().stage === "task");
  await alice.waitForFunction(() => OnlineGame.getView().packet?.rogue?.stage === "task");
  const r1 = await rogueView(alice);
  assert.match(r1.lastVote, /执行主线.*（2 票）/);
  // 玩家的画面上能看到投票按钮和任务路线
  assert.ok(await alice.locator("#online-stage .ol-rogue-route").count());
  // 升级：瑞比有一项待选，Alice 自己选；没选完之前投票不结算
  await host.evaluate(() => { RunFlow.current().party.find(h => h.kit === "ruby").pending = [{ type: "attr", level: 2, noRepeat: false }]; OnlineRogue.changed(); });
  await alice.waitForFunction(() => !!OnlineGame.getView().packet.rogue.choice);
  await bob.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.waitingLevel || []).length > 0);   // Bob 的画面也要等这次更新到（两边收到的先后不一定）
  assert.match((await rogueView(bob)).waitingLevel.join(), /瑞比/);
  const opts = (await rogueView(alice)).vote.options;
  for (const page of [alice, bob]) await submit(page, { type: "rogue.vote", option: opts[0].id });
  await host.evaluate(({ hostId, id }) => OnlineRogue.vote(hostId, id), { hostId: f.hostId, id: opts[0].id });
  await new Promise(r => setTimeout(r, 300));
  assert.match(await host.evaluate(() => OnlineRogue.blocker()), /等 瑞比 选完升级/);
  const stageBefore = await host.evaluate(() => JSON.stringify([RunFlow.current().task.index, RunFlow.current().task.nodes]));
  assert.equal(await host.evaluate(() => JSON.stringify([RunFlow.current().task.index, RunFlow.current().task.nodes])), stageBefore);
  // Bob 不能替瑞比选
  const choice = (await rogueView(alice)).choice;
  assert.equal(choice.more, 0, "玩家界面也知道后面还有几项待选");
  assert.equal((await submit(bob, { type: "rogue.act", command: { action: "choose", kit: "ruby", index: choice.index, value: choice.options[0].value } })).ok, false);
  await alice.click('#online-stage [data-online="rogueAct"]');
  await host.waitForFunction(() => !Rogue.pendingChoices(RunFlow.current()).length);
  // 选完了：人早就投齐，马上按票数结算
  await host.waitForFunction(s => JSON.stringify([RunFlow.current().task.index, RunFlow.current().task.nodes]) !== s || Screens.is("battle"), stageBefore);
  // 掉线：Bob 操控的结人还有待选升级，Bob 掉线以后不再卡全队（回来照样能选）
  if (await host.evaluate(() => Screens.is("battle"))) { assert.deepEqual(f.errors, []); return; }
  await host.evaluate(() => { RunFlow.current().party.find(h => h.kit === "yuito").pending = [{ type: "attr", level: 2, noRepeat: false }]; OnlineRogue.changed(); });
  assert.match(await host.evaluate(() => OnlineRogue.blocker()), /等 结人 选完升级/);
  await bob.close();
  await host.waitForFunction(() => OnlineRogue.blocker() === "", null, { timeout: 30000 });
  assert.deepEqual(f.errors, []);
});

test("联机单局：精英战打赢——敌人掉的奎支平分；掉的道具按需求分；自己的钱买东西记在自己名下，别人用不了", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob, hostId } = f;
  await host.evaluate(() => { window.__noLevelUpPopup = true; });   // 这里不测升级提示
  await depart(f);
  for (const page of [alice, bob]) await submit(page, { type: "rogue.vote", option: "task:main" });
  await host.click('#run-body .r-go[data-which="main"]');
  await host.waitForFunction(() => RunFlow.current().stage === "task");
  // 让这一站是精英战，大家投「迎战」
  await host.evaluate(() => { const r = RunFlow.current(); r.task.nodes[r.task.index] = { type: "elite", done: false }; RunFlow.refresh(); OnlineGame.touch(); });
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.vote?.options || []).some(o => o.id === "fight"));
  for (const page of [alice, bob]) assert.equal((await submit(page, { type: "rogue.vote", option: "fight" })).ok, true);
  await host.evaluate(hostId => OnlineRogue.vote(hostId, "fight"), hostId);
  await host.waitForFunction(() => Screens.is("battle") && state.units.some(u => !u.isPlayer));
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  // 战斗里的操控：瑞比归 Alice、结人归 Bob
  const owners = await host.evaluate(() => Object.fromEntries(HotseatGame.getView().heroes.map(h => [state.units.find(u => u.id === h.id).kit, h.owner])));
  assert.equal(owners.ruby, f.aliceId); assert.equal(owners.yuito, f.bobId); assert.equal(owners.ras, hostId);
  const purseBefore = await host.evaluate(() => RunFlow.current().party.map(h => OnlineRogue.purse(h.kit)));
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await host.waitForFunction(() => state.combatStarted && GAME.depth === 0);
  for (const id of await host.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden).map(u => u.id))) assert.equal((await submit(host, { type: "gm.removeUnit", actor: id, mode: "kill" })).ok, true);
  await host.waitForFunction(() => GAME.ended && GAME.lastOutcome === "win");
  const loot = await host.evaluate(() => Number(state.kuizhi) || 0);
  assert.ok(loot > 0, "精英战敌人掉了奎支");
  await host.click("#g-rogue-next");
  await host.waitForFunction(() => Screens.is("run"));
  const purseAfter = await host.evaluate(() => RunFlow.current().party.map(h => OnlineRogue.purse(h.kit)));
  assert.equal(purseAfter.reduce((a, b) => a + b, 0) - purseBefore.reduce((a, b) => a + b, 0), loot, "掉的奎支全部分进钱包");
  assert.ok(Math.max(...purseAfter.map((v, i) => v - purseBefore[i])) - Math.min(...purseAfter.map((v, i) => v - purseBefore[i])) <= 1, "每人分到的一样（零头最多差 1）");
  assert.equal(await host.evaluate(() => Number(state.kuizhi) || 0), 0);
  // 精英战一定掉一个道具：Alice 需求，Bob 放弃，房主放弃 → 归瑞比
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.loot || []).length === 1);
  const l = (await rogueView(alice)).loot[0];
  assert.equal((await submit(alice, { type: "rogue.need", loot: l.no, kit: "ruby", need: true })).ok, true);
  assert.equal((await submit(bob, { type: "rogue.need", loot: l.no, kit: "yuito", need: false })).ok, true);
  // 不能替别人的角色选
  assert.equal((await submit(bob, { type: "rogue.need", loot: l.no, kit: "ruby", need: false })).ok, false);
  await host.evaluate(({ hostId, no }) => OnlineRogue.need(hostId, no, "ras", false), { hostId, no: l.no });
  await alice.waitForFunction(() => !(OnlineGame.getView().packet?.rogue?.loot || []).length);
  const r2 = await rogueView(alice);
  const ruby = r2.heroes.find(h => h.kit === "ruby");
  assert.equal(ruby.items.reduce((s, x) => s + x.qty, 0), 1, "道具归了唯一需求的瑞比");
  assert.match(r2.lootLog.join(" "), /在需求的 瑞比 里抽中 瑞比/);
  // 商店：Alice 用瑞比的钱买医疗包，记在瑞比名下；Bob 的结人用不了
  await host.evaluate(() => {
    const r = RunFlow.current();
    r.task.nodes[r.task.index] = { type: "shop", done: false };
    r.shopStock = { place: `t${r.taskNo}.${r.task.index}`, keys: ["water_500", "medkit"] };   // 这家店一定有医疗包
    RunFlow.refresh(); OnlineGame.touch();
  });
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.shop || []).some(x => x.key === "medkit"));
  const money0 = (await rogueView(alice)).heroes.find(h => h.kit === "ruby").purse;
  const medBefore = await host.evaluate(() => bagCount("medkit"));
  const accessBefore = await host.evaluate(() => ({ ruby: OnlineRogue.available("ruby", "medkit"), yuito: OnlineRogue.available("yuito", "medkit") }));
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "buy", key: "medkit", qty: 1, payer: "ruby" } })).ok, true);
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "buy", key: "medkit", qty: 1, payer: "yuito" } })).ok, false, "不能花别人的钱");
  await alice.waitForFunction(m => OnlineGame.getView().packet.rogue.heroes.find(h => h.kit === "ruby").purse < m, money0);
  const r3 = await rogueView(alice);
  assert.equal(money0 - r3.heroes.find(h => h.kit === "ruby").purse, await host.evaluate(() => ROGUE_SHOP.find(x => x.key === "medkit").price));
  assert.equal(await host.evaluate(() => bagCount("medkit")), medBefore + 1);
  const access = await host.evaluate(() => ({ ruby: OnlineRogue.available("ruby", "medkit"), yuito: OnlineRogue.available("yuito", "medkit") }));
  assert.equal(access.ruby, accessBefore.ruby + 1, "买下的医疗包记在瑞比名下");
  assert.equal(access.yuito, accessBefore.yuito, "结人用不了瑞比买的医疗包");
  // 战斗里用道具也按这个算（hotseat-validation / 行动菜单用的 itemCountFor）
  const fieldAccess = await host.evaluate(() => ({ ruby: itemCountFor(state.units.find(u => u.kit === "ruby"), "medkit"), yuito: itemCountFor(state.units.find(u => u.kit === "yuito"), "medkit") }));
  assert.deepEqual(fieldAccess, access);
  if (process.env.BACKFIRE_SHOTS) await alice.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, "rogue-player-shop.png"), fullPage: true });
  // 买水归队伍公用
  const water = await host.evaluate(() => ledgerWater());
  assert.equal((await submit(bob, { type: "rogue.act", command: { action: "buy", key: "water_500", qty: 1, payer: "yuito" } })).ok, true);
  await host.waitForFunction(w => ledgerWater() === w + 500, water);
  // 玩家不能自己决定队伍的事（只能投票）
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "leaveNode" } })).ok, false);
  assert.deepEqual(f.errors, []);
});

test("联机单局：房主刷新页面后单局、钱包、投票都还在", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice } = f;
  await depart(f);
  assert.equal((await submit(alice, { type: "rogue.vote", option: "task:main" })).ok, true);
  const before = await host.evaluate(() => ({ seed: RunFlow.current().seed, purse: RunFlow.current().party.map(h => OnlineRogue.purse(h.kit)) }));
  await host.reload(); await host.waitForFunction(() => !!window.OnlineGame);
  await host.evaluate(async () => { GAME.skip = true; GAME.instant = true; await OnlineGame.resume(); });
  await host.waitForFunction(() => !OnlineGame.isPaused() && !!RunFlow.current());
  const after = await host.evaluate(() => ({ seed: RunFlow.current().seed, purse: RunFlow.current().party.map(h => OnlineRogue.purse(h.kit)), screen: Screens.current() }));
  assert.equal(after.seed, before.seed); assert.deepEqual(after.purse, before.purse); assert.equal(after.screen, "run");
  await alice.waitForFunction(() => !OnlineGame.isPaused() && (OnlineGame.getView().packet?.rogue?.vote?.options || []).some(o => o.id === "task:main" && o.mine));
  assert.deepEqual(f.errors, []);
});

test("联机单局：角色升级只弹给操控它的玩家，列出新技能的完整说明；点「知道了」后房主那边也记为已看", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob } = f;
  await depart(f);
  await host.evaluate(() => { const u = state.units.find(x => x.kit === "ruby"); u.xp = xpToNext(1) + xpToNext(2); tryLevelUp(u); OnlineGame.touch(); });
  await alice.waitForSelector("#online-levelup:not([hidden]) .lvu-card");
  const text = await alice.locator("#online-levelup").innerText();
  assert.match(text, /瑞比 升到 3 级/);
  assert.match(text, /电流激荡/); assert.match(text, /电击伤害/);
  assert.doesNotMatch(text, /坚毅生命/, "坚毅生命对玩家保密");
  if (process.env.BACKFIRE_SHOTS) await alice.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, "levelup-player.png") });
  // Bob、房主不弹（瑞比不是他们的）
  await new Promise(r => setTimeout(r, 900));
  assert.equal(await bob.locator("#online-levelup:not([hidden])").count(), 0);
  assert.equal(await host.locator("#g-levelup:not([hidden])").count(), 0);
  await alice.click('#online-levelup [data-lvu="ok"]');
  await host.waitForFunction(() => !LevelUp.unseen().length);
  await alice.waitForSelector("#online-levelup", { state: "hidden" });
  // 房主自己的拉斯缪尔升级：房主本机弹
  await host.evaluate(() => { const u = state.units.find(x => x.kit === "ras"); u.xp = xpToNext(1); tryLevelUp(u); });
  await host.waitForSelector("#g-levelup:not([hidden]) .lvu-card");
  assert.match(await host.locator("#g-levelup").innerText(), /拉斯缪尔 升到 2 级/);
  await host.click('#g-levelup [data-lvu="ok"]');
  await host.waitForSelector("#g-levelup", { state: "hidden" });
  assert.deepEqual(f.errors, []);
});

test("联机单局：工坊——各人给自己的角色排活，房主按「开工」一起做；做出来的归自己；学配方从自己钱包出", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob } = f;
  await depart(f);
  await host.evaluate(() => {
    bagAdd("cm_scrap", 2); bagAdd("cm_chem", 3); bagAdd("cm_scale", 1);
    RunFlow.current().smiths = ["tima"];   // 季玛教巧手
    OnlineRogue.changed();
  });
  await alice.waitForFunction(() => !!OnlineGame.getView().packet?.rogue?.workshop);
  const wk = await rogueView(alice);
  assert.ok(wk.workshop.mine[0].options.some(o => o.id === "fx_smoke"), "瑞比（巧手）能做烟雾弹");
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "setCraftJob", kit: "yuito", item: "fx_calm" } })).ok, false, "不能给别人的角色排活");
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "setCraftJob", kit: "ruby", item: "fx_smoke" } })).ok, true);
  assert.equal((await submit(bob, { type: "rogue.act", command: { action: "setCraftJob", kit: "yuito", item: "fx_calm" } })).ok, true);
  await host.waitForFunction(() => Rogue.craftQueue(RunFlow.current()).length === 2);
  const h0 = await host.evaluate(() => Rogue.hoursAwake());
  await host.click("#r-workshop");
  await host.click('#ws-overlay [data-ws-cmd*="craftQueued"]');
  await host.waitForFunction(() => bagCount("fx_smoke") === 1 && bagCount("fx_calm") === 1);
  assert.equal(await host.evaluate(() => Rogue.hoursAwake()) - h0, 1, "同时做，时间按最久的算");
  const owned = await host.evaluate(() => OnlineRogue.data().owned);
  assert.equal(owned.ruby.fx_smoke, 1);
  assert.equal(owned.yuito.fx_calm, 1);
  // 学配方：从自己的钱包出
  const before = await host.evaluate(() => OnlineRogue.purse("ruby"));
  await host.evaluate(() => { OnlineRogue.data().purse.ruby = 5000; OnlineRogue.changed(); });
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "learnRecipe", item: "fx_sting", smith: "tima", payer: "ruby" } })).ok, true);
  assert.equal(await host.evaluate(() => OnlineRogue.purse("ruby")), 5000 - 800);
  assert.ok(await host.evaluate(() => Rogue.knowsRecipe(RunFlow.current(), "fx_sting")));
  assert.ok(before >= 0);
  // 拆解：只能拆自己的或者公用的
  assert.equal((await submit(bob, { type: "rogue.act", command: { action: "salvage", item: "fx_smoke", payer: "yuito" } })).ok, false);
  assert.equal((await submit(alice, { type: "rogue.act", command: { action: "salvage", item: "fx_smoke", payer: "ruby" } })).ok, true);
  assert.deepEqual(f.errors, []);
});

test("联机单局：幕间选择是队伍投票——下一幕去原本的区域还是采矿场，多数决定", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob } = f;
  await depart(f);
  await host.evaluate(() => { RunFlow.current().stage = "interlude"; OnlineRogue.changed(); RunFlow.refresh(); });
  await alice.waitForFunction(() => OnlineGame.getView().packet?.rogue?.stage === "interlude");
  const r = await rogueView(alice);
  assert.deepEqual(r.vote.options.map(o => o.id), ["nextAct:沙漠", "nextAct:第一采矿场"]);
  assert.match(r.vote.options[1].label, /第一采矿场/);
  // Alice、Bob 投采矿场，房主在自己的画面上点「沙漠」；2 : 1 去采矿场
  await alice.click('#online-stage [data-online="rogueVote"][data-option="nextAct:第一采矿场"]');
  assert.equal((await submit(bob, { type: "rogue.vote", option: "nextAct:第一采矿场" })).ok, true);
  await host.click('#run-body [data-next-region="沙漠"]');
  await host.waitForFunction(() => RunFlow.current().act === 2);
  assert.equal(await host.evaluate(() => Rogue.region(RunFlow.current())), "第一采矿场");
  await alice.waitForFunction(() => OnlineGame.getView().packet?.rogue?.region === "第一采矿场");
  assert.deepEqual(f.errors, []);
});

test("联机单局：玩家打开武器面板（战斗外重摆队伍、单位 id 变了）后开战，仍能操作自己的角色", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host, alice, bob, aliceId, hostId } = f;
  await depart(f);
  // 战斗外的查询会把队伍重摆上场（Rogue.withParty），id 全换
  const idsBefore = await host.evaluate(() => state.units.filter(u => u.isPlayer).map(u => u.id).join());
  assert.equal((await alice.evaluate(() => OnlineGame.sheetData())).type, "sheetData");
  await host.waitForFunction(ids => state.units.filter(u => u.isPlayer).map(u => u.id).join() !== ids, idsBefore);
  for (const page of [alice, bob]) await submit(page, { type: "rogue.vote", option: "task:main" });
  await host.click('#run-body .r-go[data-which="main"]');
  await host.waitForFunction(() => RunFlow.current().stage === "task");
  await host.evaluate(() => { const r = RunFlow.current(); r.task.nodes[r.task.index] = { type: "battle", done: false }; RunFlow.refresh(); OnlineGame.touch(); });
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.rogue?.vote?.options || []).some(o => o.id === "fight"));
  for (const page of [alice, bob]) await submit(page, { type: "rogue.vote", option: "fight" });
  await host.evaluate(hostId => OnlineRogue.vote(hostId, "fight"), hostId);
  await host.waitForFunction(() => Screens.is("battle") && state.units.some(u => !u.isPlayer));
  // 会话里按单位 id 记的分配要跟上新战场
  const held = await host.evaluate(() => { const a = HotseatGame.assignments(); return Object.fromEntries(Object.entries(a).map(([id, o]) => [state.units.find(u => u.id === id)?.kit || "STALE:" + id, o])); });
  assert.equal(held.ruby, aliceId);
  assert.ok(!Object.keys(held).some(k => k.startsWith("STALE:")), "分配里不能留旧 id");
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await host.waitForFunction(() => ["picking", "selecting"].includes(HotseatGame.getView().phase));
  const ruby = await host.evaluate(() => state.units.find(u => u.kit === "ruby" && !u.weaponOf).id);
  const ack = await submit(alice, { type: "orderPick", actor: ruby, index: 0 });
  assert.equal(ack.ok, true, ack.error);
  assert.deepEqual(f.errors, []);
});

test("联机单局：战斗外房主刷新，存档里残留的战斗状态不会弹出过期的结算面板", { timeout: 120000 }, async t => {
  const f = await room(t); if (!f) return;
  const { host } = f;
  await depart(f);
  // 模拟存档带着上一场战斗的状态：已开战、场上没敌人
  await host.evaluate(() => { state.combatStarted = true; GAME.ended = false; OnlineGame.touch(); });
  await host.reload(); await host.waitForFunction(() => !!window.OnlineGame);
  await host.evaluate(async () => { GAME.skip = true; GAME.instant = true; await OnlineGame.resume(); });
  await host.waitForFunction(() => !OnlineGame.isPaused() && !!RunFlow.current());
  await host.waitForTimeout(800);
  assert.equal(await host.evaluate(() => Screens.current()), "run");
  assert.equal(await host.evaluate(() => document.getElementById("g-result").classList.contains("show")), false);
  assert.deepEqual(f.errors, []);
});
