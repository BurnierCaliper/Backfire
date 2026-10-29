// PvP 第二步（#464）：敌人回合由玩家操控——房主的战斗流程（game.js）。会话和校验的细节在 tests/pvp-enemy-turn.test.js、tests/pvp-round-order.test.js。
// 真的 game.html 当联机跑团房主（假的转发连接，房间里还有一名玩家「甲」p-1，同 tests/phone-host-gm-ui.test.js 的搭法），旧画面：
//   · 这一轮开始时所有玩家角色一起排行动顺序（#478）：甲在自己那边给他在敌人回合行动的角色选格子；我方回合里轮不到乙的人；
//   · 敌人回合开始时不再另外排，照排好的顺序轮到在敌人回合行动的阵营（甲的角色、主持人没分配的角色），敌人的 AI 先不动；
//   · 甲在自己那边照常行动（发来的移动 / 结束行动由房主执行），主持人替不了他；主持人操控没分配的那个；
//   · 这一段的人全部结束行动，才跑敌人的 AI，然后照常进下一回合；发给甲的包里写着现在是敌人回合那一段、轮到谁。
// 用 Playwright，没装时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

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
    const f = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[path.extname(f)] || "application/octet-stream");
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

/** 联机房主的 game.html（旧画面）：假的转发连接、开好跑团房间、开始游戏、进战斗（不开打） */
async function hostPage(t) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(origin + "/game.html");
  await page.evaluate(() => localStorage.setItem("backfire-hd2d-field", "off"));
  await page.goto(origin + "/game.html");
  await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME && !!window.TrpgFlow && !!window.HotseatGame);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    window.confirm = () => true;
    const roster = [{ id: "gm-1", name: "主持人", role: "host", online: true }, { id: "p-1", name: "甲", role: "player", online: true }];
    const relay = window.__relay = { sent: [], onMessage: null, onStatus: null, status: { connected: true, paused: false, hostOnline: true, roster } };
    const copy = v => JSON.parse(JSON.stringify(v));
    RelayTransport.createHost = async options => {
      const ep = {
        identity: { id: "gm-1", role: "host", roomCode: "PV464X", name: "主持人" },
        credentials: () => ({ url: "fake://relay", roomCode: "PV464X", role: "host", token: "token-464", protocol: options.protocol, build: options.build }),
        status: () => copy(relay.status),
        send(value, to) { relay.sent.push({ to, value: copy(value) }); return Promise.resolve(); },
        setReady: () => Promise.resolve(), releaseSeat: () => Promise.resolve(),
        onMessage(fn) { relay.onMessage = fn; return () => {}; },
        onStatus(fn) { relay.onStatus = fn; fn(copy(relay.status)); return () => {}; },
        close() {}, reconnect: () => Promise.resolve(ep)
      };
      return ep;
    };
    window.__last = id => { const hit = relay.sent.filter(x => x.to === id && ["result", "resync"].includes(x.value.type)).pop(); return hit ? hit.value : null; };
    window.__ack = no => { const hit = relay.sent.filter(x => x.to === "p-1" && x.value.type === "ack" && x.value.requestId === no).pop(); return hit ? hit.value : null; };
    let no = 0;
    window.__fromPlayer = (id, command) => { relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id); return no; };
  });
  await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#464" }); OnlineGame.start(); });
  await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !OnlineGame.isPaused());
  await page.evaluate(() => { TrpgFlow.toBattle(); GAME.fast = true; });
  await page.waitForFunction(() => Screens.is("battle") && !state.combatStarted);
  await page.evaluate(() => { const intro = document.querySelector("#g-intro"); if (intro) intro.click(); });
  await page.waitForFunction(() => !document.querySelector("#g-intro"));
  return { page, errors, context };
}
/** 玩家「甲」发来一条指令，等房主回 ack */
async function fromMate(page, command) {
  const no = await page.evaluate(c => __fromPlayer("p-1", c), command);
  await page.waitForFunction(n => !!__ack(n), no, { timeout: 15000 });
  return page.evaluate(n => __ack(n), no);
}
const idle = page => page.waitForFunction(() => GAME.depth === 0 && !HotseatGame.hasAsk(), null, { timeout: 20000 });

test("敌人回合由玩家操控（#464 / #478）：这一轮开始时所有人一起排顺序，敌人回合开始时照排好的顺序轮到乙——甲自己操控他的角色、主持人操控没分配的；这一段全部结束行动才跑敌人的 AI，然后进下一回合", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  // 头一名英雄归甲；它和第二名（主持人的、没分配）分到「乙」，乙在敌人回合行动
  const ids = await page.evaluate(async () => {
    const hs = HotseatGame.getView().heroes, a = hs[0].id, b = hs[1].id;
    OnlineGame.assign({ [a]: "p-1" });
    for (const unit of [a, b]) {
      const r = await OnlineGame.submit({ type: "battle.playerFaction", faction: "乙", name: "乙队", phase: "enemy", unit });
      if (!r.ok) throw new Error(r.error);
    }
    // 双方挤在同一区，敌人打得到人（摆位置不是这里要测的）；敌人血厚，这一回合打不完
    state.units.forEach(u => { u.zone = 1; if (!u.isPlayer) { u.layers = [{ type: "flesh", current: 999, max: 999 }]; u.def = u.defMax = 40; } });
    return { mate: a, gmHero: b, ours: hs.slice(2).map(h => h.id) };
  });
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  // 这一轮开始：所有人一起排（#478），乙的人也在；甲在自己那边给他的角色选第一格
  const all = [ids.mate, ids.gmHero].concat(ids.ours).sort();
  assert.deepEqual((await page.evaluate(() => HotseatGame.getView().units.map(u => u.id))).sort(), all, "这一轮开始时乙的人也排");
  await page.waitForFunction(id => { const p = __last("p-1"); return p && p.view && p.view.phase === "picking" && (p.view.units || []).some(u => u.id === id); }, ids.mate, { timeout: 10000 });
  assert.equal((await fromMate(page, { type: "orderPick", actor: ids.mate, index: 0 })).ok, true, "甲给自己在敌人回合行动的角色选格子");
  assert.equal((await fromMate(page, { type: "orderConfirm" })).ok, true);
  await page.evaluate(() => HotseatGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  // 我方回合：轮不到排在第一格的甲的角色（在敌人回合行动），也动不了它
  assert.ok(ids.ours.includes(await page.evaluate(() => HotseatGame.getView().currentUnitId)), "我方回合先轮到我方的人");
  assert.equal((await fromMate(page, { type: "move", actor: ids.mate, dest: 2 })).ok, false, "我方回合甲的角色动不了（在敌人回合行动）");
  for (let i = 0; i < 8 && await page.evaluate(() => state.combatPhase === "player"); i++) {
    await page.evaluate(() => GAME.endTurn());
    await page.waitForFunction(() => GAME.depth === 0 || state.combatPhase === "enemy", null, { timeout: 15000 });
  }
  // 敌人回合：照这一轮开始时排好的顺序轮到乙的人（不再另外排），敌人的 AI 不动
  await page.waitForFunction(() => state.combatPhase === "enemy" && HotseatGame.segment() === "enemy" && GAME.depth === 0, null, { timeout: 20000 });
  const seg = await page.evaluate(() => ({ phase: HotseatGame.getView().phase, current: HotseatGame.getView().currentUnitId, order: HotseatGame.getView().order.map(r => r && r.actor), turn: state.turnNo,
    foeAp: state.units.filter(u => !u.isPlayer && !u.dead).map(u => u.ap) }));
  assert.equal(seg.phase, "acting", "敌人回合开始时不再选顺序");
  assert.equal(seg.order[0], ids.mate, "还是这一轮开始时排的那一份");
  assert.equal(seg.current, ids.mate, "排在第一格的甲的角色先动");
  // 发给甲的包：现在是敌人回合那一段（白名单带 segment），轮到他的角色
  await page.waitForFunction(id => { const p = __last("p-1"); return p && p.view && p.view.segment === "enemy" && p.view.phase === "acting" && p.view.currentUnitId === id; }, ids.mate, { timeout: 10000 });
  // 主持人替不了甲；甲自己动
  const zone0 = await page.evaluate(id => state.units.find(u => u.id === id).zone, ids.mate);
  await page.evaluate(id => GAME.act({ type: "move", actor: id, dest: 2 }, { actorId: id }), ids.mate);
  await idle(page);
  assert.equal(await page.evaluate(id => state.units.find(u => u.id === id).zone, ids.mate), zone0, "主持人不能替甲的角色行动");
  const moved = await fromMate(page, { type: "move", actor: ids.mate, dest: 2 });
  assert.equal(moved.ok, true, moved.error);
  await idle(page);
  assert.equal(await page.evaluate(id => state.units.find(u => u.id === id).zone, ids.mate), 2, "甲的移动由房主执行了");
  // 这一段没结束：敌人还没出手、回合没推进
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => ({ phase: state.combatPhase, turn: state.turnNo, foeAp: state.units.filter(u => !u.isPlayer && !u.dead).map(u => u.ap) })),
    { phase: "enemy", turn: seg.turn, foeAp: seg.foeAp }, "甲还没结束：敌人的 AI 没动");
  // 甲结束行动 → 轮到主持人没分配的那个；甲动不了它
  assert.equal((await fromMate(page, { type: "endTurn" })).ok, true);
  await page.waitForFunction(id => HotseatGame.getView().currentUnitId === id && GAME.depth === 0, ids.gmHero, { timeout: 15000 });
  assert.equal((await fromMate(page, { type: "move", actor: ids.gmHero, dest: 2 })).ok, false, "甲不能动主持人的角色");
  await page.evaluate(id => GAME.act({ type: "move", actor: id, dest: 2 }, { actorId: id }), ids.gmHero);
  await idle(page);
  assert.equal(await page.evaluate(id => state.units.find(u => u.id === id).zone, ids.gmHero), 2, "主持人操控没分配的角色");
  // 主持人结束最后一个 → 敌人的 AI → 下一回合
  await page.evaluate(() => GAME.endTurn());
  await page.waitForFunction(turn => state.turnNo === turn + 1 && state.combatPhase === "player" && HotseatGame.segment() === "player" && GAME.depth === 0, seg.turn, { timeout: 30000 });
  assert.equal(await page.evaluate(() => HotseatGame.getView().phase), "picking", "下一轮开始：又一起排顺序");
  assert.deepEqual((await page.evaluate(() => HotseatGame.getView().units.map(u => u.id))).sort(), all, "所有人都排");
  assert.deepEqual(o.errors, []);
});
