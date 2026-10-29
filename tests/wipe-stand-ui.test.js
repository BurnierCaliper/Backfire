// 全员倒地还能起身时先问再判负、起身可以免费翻滚（#470）——联机房主的战斗流程（game.js · standCheck / resolveQueues）。规则层的细节在 tests/wipe-stand-roll.test.js。
// 真的 game.html 当联机跑团房主（假的转发连接，房间里还有一名玩家「甲」p-1，同 tests/pvp-enemy-turn-ui.test.js 的搭法），旧画面：
//   · 全员倒地但还能起身：不判负；敌人回合打完、这一回合结束前依次问每个能起身的人；
//   · 问的是操控那个角色的玩家：分给甲的发给甲（甲的包里有「起身 / 起身并翻滚到 X 区 / 不起身」，不带坚毅字样），主持人替不了；没分配的问主持人；
//   · 有人起身（可以顺便翻滚到选的区）就进下一回合；都不起身就判负。
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
        identity: { id: "gm-1", role: "host", roomCode: "WS470X", name: "主持人" },
        credentials: () => ({ url: "fake://relay", roomCode: "WS470X", role: "host", token: "token-470", protocol: options.protocol, build: options.build }),
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
  await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#470" }); OnlineGame.start(); });
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

/** 开战：mate = 分给甲的角色（不给就都归主持人）；人都在 1 区，敌人在最远的区、血厚架势高；开打后全员倒地（还能起身），
 *  一个一个结束行动（甲的由甲结束），进敌人回合。返回 { heroes, turn } */
async function wipeAndEndTurn(page, mateFirst) {
  const heroes = await page.evaluate(mate => {
    const hs = HotseatGame.getView().heroes.map(h => h.id);
    if (mate) OnlineGame.assign({ [hs[0]]: "p-1" });
    const far = Math.max(...boardZoneIds());
    state.units.forEach(u => {
      if (u.isPlayer) u.zone = 1;
      else { u.zone = far; u.layers = [{ type: "flesh", current: 999, max: 999 }]; u.def = u.defMax = 40; }
    });
    return hs;
  }, !!mateFirst);
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 15000 });
  await page.evaluate(() => HotseatGame.submit({ type: "orderStart" }));
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting" && GAME.depth === 0, null, { timeout: 15000 });
  const turn = await page.evaluate(ids => {
    ids.forEach(id => { const u = state.units.find(x => x.id === id); u.layers.forEach(l => { l.current = 0; }); u.dying = true; u.upOnShp = false; u.shp = Math.max(5, Number(u.shp) || 0); });
    GAME.checkEnd(); GAME.refresh();
    return state.turnNo;
  }, heroes);
  assert.equal(await page.evaluate(() => GAME.ended), false, "全员倒地但还能起身：不立刻判负（以前立刻判负）");
  for (let i = 0; i < 12 && await page.evaluate(() => state.combatPhase === "player" && !GAME.ended); i++) {
    const cur = await page.evaluate(() => { const v = HotseatGame.getView(); const row = v.order.find(r => r && r.actor === v.currentUnitId); return row ? { id: row.actor, owner: row.owner } : null; });
    if (!cur) break;
    if (cur.owner === "p-1") assert.equal((await fromMate(page, { type: "endTurn" })).ok, true);
    else await page.evaluate(() => { GAME.endTurn(); });   // 不等：最后一个结束以后整个敌人回合、回合结束前的询问都在这一下里
    await page.waitForFunction(id => GAME.depth > 0 || HotseatGame.getView().currentUnitId !== id || state.combatPhase !== "player", cur.id, { timeout: 15000 });
  }
  return { heroes, turn };
}

test("全员倒地还能起身（#470）：敌人回合打完、回合结束前问操控那个角色的玩家——甲的问甲（主持人替不了）、没分配的问主持人；有人起身（顺便翻滚）就进下一回合", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  const { heroes, turn } = await wipeAndEndTurn(page, true);
  const mate = heroes[0];
  let rolled = null;
  for (let i = 0; i < heroes.length + 2; i++) {
    await page.waitForFunction(() => GAME.ended || (state.combatPhase === "player" && GAME.depth === 0) || (HotseatGame.hasAsk() && (state.standQueue || []).length > 0), null, { timeout: 30000 });
    const job = await page.evaluate(() => (HotseatGame.hasAsk() && (state.standQueue || [])[0]) || null);
    if (!job) break;
    assert.equal(await page.evaluate(() => state.combatPhase), "enemy", "敌人回合打完才问（回合还没结束）");
    assert.equal(await page.evaluate(() => state.turnNo), turn, "还在这一回合");
    if (job.unitId === mate) {
      // 发给甲：甲的包里有这次询问、三类选项，不带坚毅字样；主持人那边不能替他选
      await page.waitForFunction(() => { const p = __last("p-1"); return !!(p && p.view && p.view.ask && p.view.ask.eligible); }, null, { timeout: 10000 });
      const ask = await page.evaluate(() => __last("p-1").view.ask);
      assert.match(ask.title, /要不要起身/);
      const labels = ask.options.map(o => o.label);
      assert.equal(labels[0], "起身"); assert.equal(labels[labels.length - 1], "不起身");
      assert.ok(labels.some(l => /^起身并翻滚到 \d 区$/.test(l)), labels.join("、"));
      assert.doesNotMatch(JSON.stringify(ask), /坚毅|shp/i);
      assert.equal(await page.evaluate(() => HotseatGame.getView().ask.eligible), false, "主持人只看到在等甲");
      const no = ask.options.find(o => o.label === "不起身");
      assert.equal((await fromMate(page, { type: "answer", askId: ask.id, helper: no.helper, extra: no.extra })).ok, true);
    } else {
      // 没分配的问主持人：第一个起身并翻滚，其余不起身
      const ask = await page.evaluate(() => HotseatGame.getView().ask);
      assert.equal(ask.eligible, true, "没分配的问主持人");
      const opt = !rolled ? ask.options.find(o => /^起身并翻滚到 \d 区$/.test(o.label)) : ask.options.find(o => o.label === "不起身");
      if (!rolled) rolled = { id: job.unitId, dest: Number(opt.label.match(/(\d) 区/)[1]) };
      assert.equal(await page.evaluate(c => HotseatGame.submit(c).ok, { type: "answer", askId: ask.id, helper: opt.helper, extra: opt.extra }), true);
    }
    await page.waitForFunction(id => !(state.standQueue || []).some(j => j.unitId === id), job.unitId, { timeout: 15000 });
  }
  assert.ok(rolled, "主持人的角色问到了");
  await page.waitForFunction(n => GAME.ended || (state.turnNo === n + 1 && state.combatPhase === "player" && GAME.depth === 0), turn, { timeout: 30000 });
  assert.equal(await page.evaluate(() => GAME.ended), false, "有人起身：接着打");
  const st = await page.evaluate(([a, b]) => { const r = state.units.find(u => u.id === a), m = state.units.find(u => u.id === b); return { up: r.upOnShp, zone: Number(r.zone), mate: m.dying }; }, [rolled.id, mate]);
  assert.deepEqual(st, { up: true, zone: rolled.dest, mate: true }, "主持人的角色起身并翻滚到选的区；甲的角色没起身，还倒着");
  assert.deepEqual(o.errors, []);
});

test("全员倒地还能起身（#470）：回合结束前问了都不起身，才判负", { timeout: 120000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  const { heroes } = await wipeAndEndTurn(page, false);
  for (let i = 0; i < heroes.length + 2; i++) {
    await page.waitForFunction(() => GAME.ended || (HotseatGame.hasAsk() && (state.standQueue || []).length > 0), null, { timeout: 30000 });
    if (await page.evaluate(() => GAME.ended)) break;
    const ask = await page.evaluate(() => HotseatGame.getView().ask);
    const no = ask.options.find(o => o.label === "不起身");
    assert.equal(await page.evaluate(c => HotseatGame.submit(c).ok, { type: "answer", askId: ask.id, helper: no.helper, extra: no.extra }), true);
    await page.waitForFunction(id => GAME.ended || !HotseatGame.hasAsk() || HotseatGame.getView().ask.id !== id, ask.id, { timeout: 15000 });
  }
  await page.waitForFunction(() => GAME.ended, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => GAME.lastOutcome), "lose", "都不起身：判负");
  assert.deepEqual(o.errors, []);
});
