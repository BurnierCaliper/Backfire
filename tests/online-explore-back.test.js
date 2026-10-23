// 联机跑团：主持人在已经开始的战斗里点「探索环节」（game.html · #g-to-explore），任何时候确认后都能回到探索（#322）。
// 以前「有时候没反应」的几种情况：
//   ① 行动阶段、没在播演出：确认后被 online-legacy.js · preflight 当成「重置遭遇」拒绝，画面不动
//   ② 播演出 / 敌人回合 / 主持人手动操控敌人 / 等玩家回答协助格挡（GAME.depth > 0）：trpg-ui.js · requestBackFromBattle 直接 return
//   ③ 开战前等玩家的分步选择（例：柯尔特的初始刀头分给了玩家）：被 hotseat-game.js「正在等待其他操作者回应」挡掉
//   ④ 每回合选行动顺序时：主持人的「行动顺序」卡片（#hs-panel）盖住整个战斗顶栏，点不到按钮
// 前两条测试不要浏览器（规则边界：online-legacy.js / hotseat-game.js）；后面用真的 game.html 当联机房主（假的转发连接、一名玩家「甲」），
// 要浏览器：Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const vm = require("node:vm");
const path = require("node:path");
const { execSync } = require("node:child_process");
const H = require("./headless");

/* ---------------- 规则边界（无界面） ---------------- */
const plain = x => JSON.parse(JSON.stringify(x));
function loadFile(c, name) { vm.runInContext(fs.readFileSync(path.join(H.ROOT, name), "utf8"), c, { filename: name }); }
/** 联机房主的指令边界（同 online-legacy.test.js）：热座会话 + online-legacy.js；trpg.ui 的处理换成记一笔。
 *  toPlayer：交给玩家「甲」（p2）操控的英雄 kit */
function fixture(toPlayer) {
  const c = H.load(), queued = [], token = {}, uiCalls = [];
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "322-EXPLORE" });
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = {
    isHost: () => true, isPaused: () => false,
    queueHostEdit(fn) { return new Promise(resolve => queued.push(() => resolve(fn()))); },
    legacyAddedEnemies() {}
  };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-legacy.js"]) loadFile(c, file);
  c.GMCommands.configure({ requireHost: context => context === token });
  // trpg-ui.js · backFromBattle：先停下战斗流程（game.js · abandonBattle → HotseatGame.abandon），再回探索
  c.Commands.register("trpg.ui", cmd => {
    uiCalls.push(cmd.action);
    if (cmd.action === "backFromBattle" && typeof c.HotseatGame.abandon === "function") c.HotseatGame.abandon();
    return cmd.action;
  }, { domain: "trpg-ui" });
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "甲" }];
  const assignments = Object.fromEntries(state.units.filter(u => u.isPlayer && !u.weaponOf && (toPlayer || []).includes(u.kit)).map(u => [u.id, "p2"]));
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments }).ok, true);
  return { c, state, queued, uiCalls, send: command => c.Commands.dispatch(plain(command)) };
}
const BACK = { type: "trpg.ui", action: "backFromBattle", level: 1 };

test("① ② 规则边界：战斗中、演出 / 敌人回合中（GAME.depth > 0）「回到探索环节」马上执行——不当成重置遭遇拒绝，也不排队等结算", () => {
  const f = fixture();
  f.c.HotseatGame.startCombat();
  assert.equal(f.state.combatStarted, true);
  // 行动阶段、没在播演出
  assert.equal(f.send(BACK), "backFromBattle", "以前：联机战斗中不能重置遭遇……");
  // 正在播演出 / 敌人回合
  f.c.GAME.depth = 1;
  assert.equal(f.send(BACK), "backFromBattle");
  assert.deepEqual(f.uiCalls, ["backFromBattle", "backFromBattle"]);
  assert.equal(f.queued.length, 0, "不排队等结算");
  // 别的重置遭遇 / 切换存档照旧拒绝
  f.c.GAME.depth = 0;
  for (const action of ["toBattle", "title", "party"]) assert.throws(() => f.send({ type: "trpg.ui", action, level: 1, kits: ["ruby"] }), /联机战斗中/);
  assert.deepEqual(f.uiCalls, ["backFromBattle", "backFromBattle"]);
});

test("③ 规则边界：有人没回答的分步选择 / 协助询问也挡不住「回到探索环节」；HotseatGame.abandon 收回它们，等着的流程收到「没人回答」", async () => {
  const f = fixture(["helu"]);
  const [ruby, helu] = ["ruby", "helu"].map(kit => f.state.units.find(u => u.kit === kit && u.isPlayer && !u.weaponOf));
  // 开战前的分步选择（柯尔特的初始刀头那种），交给玩家「甲」回答：别的操作照旧要等
  const picked = f.c.HotseatGame.ownedChoice(helu, "初始状态", [{ label: "温和", value: "a" }, { label: "残忍", value: "b" }]);
  assert.equal(f.c.HotseatGame.hasAsk(), true);
  assert.equal(f.c.HotseatGame.getViewFor("p2").ask.eligible, true, "问的是甲");
  assert.throws(() => f.send({ type: "trpg.ui", action: "toBattle", level: 1 }), /正在等待其他操作者回应/);
  assert.equal(f.send(BACK), "backFromBattle", "以前：正在等待其他操作者回应");
  assert.equal(await picked, null, "等着这个选择的流程收到 null，不会拿着答案接着开战");
  assert.equal(f.c.HotseatGame.hasAsk(), false);
  assert.equal(f.c.HotseatGame.getView().ask, null);
  // 战斗中等人回答协助格挡
  f.c.HotseatGame.startCombat();
  const asked = f.c.HotseatGame.requestAsk("block", "狂徒 攻击 红玉 · 协助格挡", [{ helper: helu.id, label: helu.name, sub: "" }], () => [helu], { seq: 7, targetId: ruby.id });
  assert.equal(f.c.HotseatGame.hasAsk(), true);
  f.c.GAME.depth = 1;
  assert.equal(f.send(BACK), "backFromBattle");
  const answer = await asked;
  assert.equal(answer.unitId, null, "没人格挡");
  assert.equal(f.c.HotseatGame.hasAsk(), false);
  assert.equal(f.c.HotseatGame.getView().phase, "setup", "行动顺序回到战前");
});

/* ---------------- 真的 game.html（联机房主） ---------------- */
function playwright() {
  try { return require("playwright"); } catch (_) { /* 没装在本地 */ }
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) { /* 也没装在全局 */ }
  return null;
}
let browser = null, skipWhy = "", server = null, origin = "";
test.before(async () => {
  try {
    const pw = playwright();
    browser = pw ? await pw.chromium.launch() : await require("./cdp-browser").launch();
    if (!browser) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    browser = null; skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0];
  }
  if (!browser) return;
  server = http.createServer((req, res) => {
    const file = path.resolve(H.ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(H.ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[path.extname(file)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

/** 联机房主的 game.html：假的转发连接（房间里还有一名在线玩家「甲」p-1），开好跑团房间、开始游戏。
 *  opt.party：上场队员；opt.online：false 时不开房间（单机跑团） */
async function hostPage(t, opt) {
  opt = opt || {};
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());   // Playwright：确认框点「确定」（备用浏览器自己会点）
  await page.goto(origin + "/game.html");
  // #316 起新画面（HD-2D）默认开：这里测旧画面（新画面的浮层都在战场里面，不盖顶栏）
  await page.evaluate(() => localStorage.setItem("backfire-hd2d-field", "off"));
  await page.goto(origin + "/game.html");
  await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME && !!window.TrpgFlow && !!window.HotseatGame);
  await page.evaluate(() => {
    // 「确定放弃这场战斗吗？」记下问过什么，点「确定」
    window.__asked = [];
    window.confirm = text => { window.__asked.push(String(text)); return true; };
  });
  if (opt.online !== false) {
    await page.evaluate(() => {
      const roster = [{ id: "gm-1", name: "主持人", role: "host", online: true }, { id: "p-1", name: "甲", role: "player", online: true }];
      const relay = window.__relay = { sent: [], onMessage: null, onStatus: null, status: { connected: true, paused: false, hostOnline: true, roster } };
      const copy = v => JSON.parse(JSON.stringify(v));
      RelayTransport.createHost = async options => {
        const ep = {
          identity: { id: "gm-1", role: "host", roomCode: "EXP322", name: "主持人" },
          credentials: () => ({ url: "fake://relay", roomCode: "EXP322", role: "host", token: "token-322", protocol: options.protocol, build: options.build }),
          status: () => copy(relay.status),
          send(value, to) { relay.sent.push({ to, value: copy(value), at: performance.now() }); return Promise.resolve(); },
          setReady: () => Promise.resolve(), releaseSeat: () => Promise.resolve(),
          onMessage(fn) { relay.onMessage = fn; return () => {}; },
          onStatus(fn) { relay.onStatus = fn; fn(copy(relay.status)); return () => {}; },
          close() {}, reconnect: () => Promise.resolve(ep)
        };
        return ep;
      };
      // 发给玩家「甲」的最后一包（OnlineWire 只压历史记录、演出带；screen / manualPhase / view.ask / offlineWait 原样带着）
      window.__last = id => { const hit = relay.sent.filter(x => x.to === id && ["result", "resync"].includes(x.value.type)).pop(); return hit ? hit.value : null; };
      // 玩家发来一条指令（走房主的 receive，和真的转发一样）
      let no = 0;
      window.__fromPlayer = (id, command) => relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id);
      window.__setOnline = (id, online) => { relay.status = copy(relay.status); relay.status.roster.forEach(p => { if (p.id === id) p.online = online; }); relay.onStatus(copy(relay.status)); };
    });
    await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#322" }); OnlineGame.start(); });
    await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !OnlineGame.isPaused());
    if (opt.party) await page.evaluate(kits => OnlineGame.setParty(kits), opt.party);
  } else {
    await page.evaluate(kits => {
      Commands.dispatch({ type: "trpg.ui", action: "new", index: 0, name: "单机跑团", level: 1 });
      if (kits) Commands.dispatch({ type: "trpg.ui", action: "party", kits, level: 1 });
    }, opt.party || null);
    await page.waitForFunction(() => Screens.is("trpg"));
  }
  // 进战斗（不开打）：演出照常播（演出中途点「探索环节」才测得到），只是快一点
  await page.evaluate(() => { TrpgFlow.toBattle(); GAME.fast = true; });
  await page.waitForFunction(() => Screens.is("battle") && !state.combatStarted);
  // 开战前的大字（game.js · battleIntro）铺满整个画面、点一下就收起：和玩家一样先点掉（它本来就挡所有按钮几秒钟，不是这里要测的）
  await page.evaluate(() => { const intro = document.querySelector("#g-intro"); if (intro) intro.click(); });
  await page.waitForFunction(() => !document.querySelector("#g-intro"));
  return { page, errors };
}
/** 开打：所有英雄先归主持人（opt.owner 指定的 kit 归玩家「甲」）；返回场上英雄 */
async function startCombat(page, owners) {
  await page.evaluate(owners => {
    const map = {};
    for (const h of HotseatGame.getView().heroes) { const u = state.units.find(x => x.id === h.id); if (u && owners && owners[u.kit]) map[h.id] = owners[u.kit]; }
    OnlineGame.assign(map);
  }, owners || null);
  await page.evaluate(() => { GAME.startOrEnd(); });
}
/** 选完行动顺序（主持人「按当前格子开始」），进我方行动 */
async function toActing(page) {
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  await page.evaluate(() => OnlineGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0);
}
/** 所有英雄都归主持人：一个个结束行动，直到敌人回合开始（不等它播完） */
async function toEnemyTurn(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 16 && state.combatPhase === "player" && GAME.depth === 0; i++) { GAME.endTurn(); await new Promise(r => setTimeout(r, 0)); }
  });
  await page.waitForFunction(() => GAME.depth > 0 && state.combatPhase === "enemy", null, { timeout: 8000 });
}
/** 点战斗顶栏的「探索环节」：真的点下去（被别的东西盖住就点不到） */
const clickExplore = page => page.click("#g-to-explore", { timeout: 3000 });
/** 回到探索以后：画面、战斗流程、热座会话都干净，玩家「甲」那边也切回探索；过一阵子再看一次，半路的流程没有醒过来接着打 */
async function assertBackClean(page, errors, label) {
  const now = await page.evaluate(() => ({ screen: Screens.current(), depth: GAME.depth, started: state.combatStarted, phase: HotseatGame.getView().phase, ask: HotseatGame.getView().ask, busy: document.getElementById("g-app").classList.contains("busy") }));
  assert.deepEqual(now, { screen: "trpg", depth: 0, started: false, phase: "setup", ask: null, busy: false }, label + "：点了以后马上回到探索");
  await page.waitForFunction(() => { const p = window.__last && __last("p-1"); return !window.__relay || !!p && p.screen === "exploration"; }, null, { timeout: 3000 });
  if (await page.evaluate(() => !!window.__relay)) {
    const p = await page.evaluate(() => { const p = __last("p-1"); return { screen: p.screen, manualPhase: p.manualPhase, ask: p.view.ask || null, offlineWait: p.offlineWait || null }; });
    assert.deepEqual(p, { screen: "exploration", manualPhase: false, ask: null, offlineWait: null }, label + "：玩家那边切回探索，询问 / 手动敌人阶段 / 倒计时都没了");
  }
  const mark = await page.evaluate(() => Commands.history().length ? Commands.history()[Commands.history().length - 1].seq : 0);
  await page.waitForTimeout(1800);
  const later = await page.evaluate(m => ({
    screen: Screens.current(), depth: GAME.depth, started: state.combatStarted, phase: HotseatGame.getView().phase, choice: !!document.querySelector("#g-choice.show"),
    battleCmds: Commands.history().filter(e => e.seq > m && /^(battle\.(enemyAction|endEnemyTurn|endPlayerTurn)|blockAnswer|assistAnswer|koltSwapAnswer|openingChoice|startCombat|endTurn)$/.test(e.command.type)).map(e => e.command.type)
  }), mark);
  assert.deepEqual(later, { screen: "trpg", depth: 0, started: false, phase: "setup", choice: false, battleCmds: [] }, label + "：半路的演出 / 敌人回合没有醒过来接着结算");
  assert.deepEqual(errors, [], label + "：页面没有报错");
  // 之后照常能开下一场（柯尔特归玩家时，开打前照常先问他初始刀头）
  await page.evaluate(() => { TrpgFlow.toBattle(); GAME.startOrEnd(); });
  await page.waitForFunction(() => Screens.is("battle") && GAME.depth === 0 && (state.combatStarted && ["picking", "acting"].includes(HotseatGame.getView().phase) ||
    !state.combatStarted && (HotseatGame.getView().ask || {}).kind === "choice"), null, { timeout: 5000 });
  assert.deepEqual(errors, [], label + "：再开一场也没有报错");
}

test("①（真的页面）行动阶段、没在播演出：确认后回到探索；这场的伤亡、用掉的东西都回到开战前", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  const probe = () => page.evaluate(() => ({ kz: Number(state.kuizhi) || 0, hours: LEDGER.hours, hp: state.units.filter(u => u.isPlayer && !u.weaponOf).map(u => u.kit + ":" + u.layers.map(l => l.current).join("/")).join(" ") }));
  const before = await probe();
  await startCombat(page); await toActing(page);
  // 打到一半：钱变了、队伍档案（距长休的时间）变了、有人受伤
  await page.evaluate(() => { state.kuizhi = (Number(state.kuizhi) || 0) + 999; LEDGER.hours = (Number(LEDGER.hours) || 0) + 7; state.units.find(u => u.isPlayer && !u.weaponOf).layers[0].current = 1; });
  await clickExplore(page);
  assert.equal((await page.evaluate(() => __asked)).length, 1, "打到一半先问一句");
  assert.deepEqual(await probe(), before, "这场不结算，回到开战前");
  await assertBackClean(page, errors, "①");
});

test("②（真的页面）敌人回合正在播演出时也能回去：敌人不再接着行动，G.depth 不会变成负数", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  await startCombat(page); await toActing(page);
  // 双方挤在同一区：敌人回合一定有人出手（演出要播一阵子）
  await page.evaluate(() => { state.units.forEach(u => { u.zone = 1; }); GAME.refresh(); });
  await toEnemyTurn(page);
  await clickExplore(page);
  await assertBackClean(page, errors, "② 敌人回合");
});

test("②（真的页面）主持人手动操控敌人的阶段：回去后手动阶段放开，玩家那边不再显示「主持人操控敌人」", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  await startCombat(page); await toActing(page);
  const r = await page.evaluate(() => OnlineGame.submit({ type: "gm.setManual", actors: "all", enabled: true }));
  assert.equal(r.ok, true, JSON.stringify(r));
  await page.evaluate(() => { for (let i = 0; i < 16 && state.combatPhase === "player" && GAME.depth === 0; i++) GAME.endTurn(); });
  await page.waitForFunction(() => OnlineGame.getView().manualPhase === true && GAME.depth > 0, null, { timeout: 8000 });
  await page.waitForFunction(() => __last("p-1") && __last("p-1").manualPhase === true);
  await clickExplore(page);
  assert.equal(await page.evaluate(() => OnlineGame.getView().manualPhase), false);
  await assertBackClean(page, errors, "② 手动敌人");
});

test("②（真的页面）敌人回合等玩家回答协助格挡：回去后询问收回，排在后面的主持人操作作废（不落到新战场上）", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  // 英雄都归玩家「甲」：敌人打谁，能格挡的都是甲的人，询问发给甲
  const kits = await page.evaluate(() => state.units.filter(u => u.isPlayer && !u.weaponOf).map(u => u.kit));
  await startCombat(page, Object.fromEntries(kits.map(k => [k, "p-1"])));
  await toActing(page);
  await page.evaluate(() => { state.units.forEach(u => { u.zone = 1; if (u.isPlayer) u.bonus = Math.max(1, u.bonus || 0); }); GAME.refresh(); });
  // 甲把自己每个单位的行动都结束：敌人回合开始
  await page.evaluate(async () => {
    for (let i = 0; i < 16 && state.combatPhase === "player"; i++) { __fromPlayer("p-1", { type: "endTurn" }); await new Promise(r => setTimeout(r, 120)); }
  });
  await page.waitForFunction(() => !!HotseatGame.getView().ask && HotseatGame.getView().ask.kind === "block" && GAME.depth > 0, null, { timeout: 15000 });
  await page.waitForFunction(() => { const p = __last("p-1"); return !!p && !!p.view.ask; });
  // 等格挡的时候主持人又加了一个敌人：排队等这一下结算完
  const enemies = await page.evaluate(() => state.units.filter(u => !u.isPlayer).length);
  await page.evaluate(() => { window.__spawn = OnlineGame.submit({ type: "gm.spawnEnemy", enemyId: "thug_knife", level: 1, zone: 1 }); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => state.units.filter(u => !u.isPlayer).length), enemies, "还在排队");
  await clickExplore(page);
  const spawn = await page.evaluate(() => window.__spawn);
  assert.equal(spawn.ok, false);
  assert.match(spawn.error, /放弃/);
  assert.equal(await page.evaluate(() => state.units.some(u => !u.isPlayer && u.level === 1 && u.kit === "thug_knife" && u.zone === 1)), false, "排队的加敌人没有落到新战场上");
  await assertBackClean(page, errors, "② 等协助格挡");
});

test("③（真的页面）开战前等玩家选柯尔特的初始刀头：回去后选择收回；甲之后再回答也不会开战", { timeout: 60000 }, async t => {
  const o = await hostPage(t, { party: ["kolt", "ruby"] }); if (!o) return; const { page, errors } = o;
  await startCombat(page, { kolt: "p-1" });
  await page.waitForFunction(() => !!HotseatGame.getView().ask && HotseatGame.getView().ask.kind === "choice");
  await page.waitForFunction(() => { const p = __last("p-1"); return !!p && !!p.view.ask && p.view.ask.kind === "choice"; });
  const ask = await page.evaluate(() => __last("p-1").view.ask);
  await clickExplore(page);
  assert.equal((await page.evaluate(() => __asked)).length, 0, "还没开打：不用问");
  assert.equal(await page.evaluate(() => Screens.current()), "trpg", "以前：正在等待其他操作者回应");
  // 甲这时才点了「酸液炮」：已经作废
  await page.evaluate(a => __fromPlayer("p-1", { type: "answer", askId: a.id, helper: a.options[1].helper, extra: a.options[1].extra }), ask);
  await assertBackClean(page, errors, "③");
});

test("④（真的页面）选行动顺序时主持人的「行动顺序」卡片不盖住战斗顶栏：「探索环节」点得到", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  await startCombat(page);
  await page.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  await page.waitForSelector("#hs-panel .hs-card", { state: "visible" });
  const hit = await page.evaluate(() => {
    const b = document.getElementById("g-to-explore"); b.scrollIntoView({ block: "center", inline: "center" });
    const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { onTop: !!at && (at === b || b.contains(at)), cover: at ? (at.id || at.className || at.tagName) : null };
  });
  assert.equal(hit.onTop, true, "以前被 #hs-panel 盖住：" + hit.cover);
  await clickExplore(page);
  await assertBackClean(page, errors, "④");
});

test("（真的页面）玩家掉线、轮到他的单位在倒计时：回去后倒计时清掉", { timeout: 60000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  const kit = await page.evaluate(() => state.units.find(u => u.isPlayer && !u.weaponOf).kit);
  await startCombat(page, { [kit]: "p-1" });
  await page.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  // 甲的单位排第一个
  const first = await page.evaluate(k => HotseatGame.getView().heroes.find(h => state.units.find(u => u.id === h.id).kit === k).id, kit);
  await page.evaluate(id => __fromPlayer("p-1", { type: "orderPick", actor: id, index: 0 }), first);
  await page.waitForFunction(id => (HotseatGame.getView().order[0] || {}).actor === id, first);
  await page.evaluate(() => OnlineGame.submit({ type: "orderStart" }));
  await page.waitForFunction(id => HotseatGame.getView().phase === "acting" && HotseatGame.getView().currentUnitId === id, first);
  await page.evaluate(() => __setOnline("p-1", false));
  await page.waitForFunction(() => !!OnlineGame.getView().offlineWait);
  await clickExplore(page);
  assert.equal(await page.evaluate(() => OnlineGame.getView().offlineWait), null);
  await page.evaluate(() => __setOnline("p-1", true));
  await assertBackClean(page, errors, "掉线倒计时");
});

test("（真的页面）单机跑团：敌人回合正在播演出时点「探索环节」也能回去", { timeout: 60000 }, async t => {
  const o = await hostPage(t, { online: false }); if (!o) return; const { page, errors } = o;
  await page.evaluate(() => { GAME.startOrEnd(); });
  await page.waitForFunction(() => state.combatStarted && GAME.depth === 0 && !document.querySelector("#g-choice.show"));
  await page.evaluate(() => { state.units.forEach(u => { u.zone = 1; }); GAME.refresh(); GAME.apWarnTurn = state.turnNo; GAME.endTurn(); });
  await page.waitForFunction(() => GAME.depth > 0 && state.combatPhase === "enemy", null, { timeout: 8000 });
  await clickExplore(page);
  const now = await page.evaluate(() => ({ screen: Screens.current(), depth: GAME.depth, started: state.combatStarted }));
  assert.deepEqual(now, { screen: "trpg", depth: 0, started: false });
  await page.waitForTimeout(1800);
  const later = await page.evaluate(() => ({ screen: Screens.current(), depth: GAME.depth, started: state.combatStarted, choice: !!document.querySelector("#g-choice.show") }));
  assert.deepEqual(later, { screen: "trpg", depth: 0, started: false, choice: false });
  assert.deepEqual(errors, []);
});
