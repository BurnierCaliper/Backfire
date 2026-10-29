// PvP 第三步：决斗（#472）——房主的界面和流程。真的 game.html 当联机跑团房主（假的转发连接，房间里还有一名玩家「甲」p-1，
// 同 tests/pvp-enemy-turn-ui.test.js 的搭法），旧画面：
//   · 探索环节：甲申请决斗 → 主持人探索顶栏「进入战斗环节」旁边的「决斗」写着有申请，点开浮层「同意」→ 准备画面；
//     甲给自己的角色选队，主持人给没分配的角色选队、定「允许起身」「限定回合数」，点「开始决斗」→ 战斗画面：只有参加的人，1 队在 1 区、2 队在 3 区；
//   · 发给甲的包：准备画面（谁在哪一队）、战斗里的决斗选项、开战抛硬币的公开记录、结算的胜负和两队的分数；坚毅数值一个都没有；
//   · 打完回到探索环节：队伍档案里的血量 / 坚毅恢复成决斗前的样子；战斗中没有「决斗」入口。
// 会话和白名单的细节在 tests/pvp-duel-online.test.js，战斗规则在 tests/pvp-duel.test.js。
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

/** 联机房主的 game.html（旧画面）：假的转发连接、开好跑团房间、开始游戏，停在探索环节 */
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
  await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME && !!window.TrpgFlow && !!window.HotseatGame && !!window.DuelUI);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    window.confirm = () => true;
    const roster = [{ id: "gm-1", name: "主持人", role: "host", online: true }, { id: "p-1", name: "甲", role: "player", online: true }];
    const relay = window.__relay = { sent: [], onMessage: null, onStatus: null, status: { connected: true, paused: false, hostOnline: true, roster } };
    const copy = v => JSON.parse(JSON.stringify(v));
    RelayTransport.createHost = async options => {
      const ep = {
        identity: { id: "gm-1", role: "host", roomCode: "DUEL72", name: "主持人" },
        credentials: () => ({ url: "fake://relay", roomCode: "DUEL72", role: "host", token: "token-472", protocol: options.protocol, build: options.build }),
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
    window.__all = id => relay.sent.filter(x => x.to === id).map(x => JSON.stringify(x.value)).join("\n");
    // 公开记录按差量发（online-wire.js：每包只带新增的那几条）：把发给这个人的全部接起来
    window.__logs = id => relay.sent.filter(x => x.to === id && ["result", "resync"].includes(x.value.type)).flatMap(x => (x.value.publicLogs || []).map(l => l.text));
    window.__ack = no => { const hit = relay.sent.filter(x => x.to === "p-1" && x.value.type === "ack" && x.value.requestId === no).pop(); return hit ? hit.value : null; };
    let no = 0;
    window.__fromPlayer = (id, command) => { relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id); return no; };
  });
  await page.evaluate(async () => { await OnlineGame.create({ url: "fake://relay", name: "主持人", slot: 0, campaignName: "#472" }); OnlineGame.start(); });
  await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !OnlineGame.isPaused() && Screens.is("trpg"));
  return { page, errors, context };
}
/** 玩家「甲」发来一条指令，等房主回 ack */
async function fromMate(page, command) {
  const no = await page.evaluate(c => __fromPlayer("p-1", c), command);
  await page.waitForFunction(n => !!__ack(n), no, { timeout: 15000 });
  return page.evaluate(n => __ack(n), no);
}
const idle = page => page.waitForFunction(() => GAME.depth === 0 && !HotseatGame.hasAsk(), null, { timeout: 20000 });

test("决斗（#472）：甲申请 → 主持人在「决斗」浮层同意 → 选队、定选项 → 开始决斗（只有参加的人，1 队在 1 区、2 队在 3 区）→ 开战抛硬币 → 分出胜负、两队的分数发给甲 → 回到探索，血量 / 坚毅恢复成决斗前的样子", { timeout: 180000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page } = o;
  // 头一名英雄归甲；其余没分配（归主持人）
  const ids = await page.evaluate(() => {
    const hs = HotseatGame.getView().heroes;
    OnlineGame.assign({ [hs[0].id]: "p-1" });
    const kit = id => state.units.find(u => u.id === id).kit;
    return { mate: kit(hs[0].id), gm: hs.slice(1).map(h => kit(h.id)), names: hs.map(h => h.name) };
  });
  assert.ok(ids.gm.length >= 1, "至少还有一名主持人的角色");
  // 决斗前：甲的角色带着伤（探索时场上的样子，记进队伍档案）。结束后要恢复成这样
  const before = await page.evaluate(kit => {
    const u = state.units.find(x => x.kit === kit);
    (u.layers || []).forEach(l => { l.current = Math.max(1, Math.floor(l.max / 2)); });
    u.shp = 7;
    ledgerCapture();
    return JSON.parse(JSON.stringify({ heroes: LEDGER.heroes, dur: LEDGER.dur }));
  }, ids.mate);
  assert.equal(before.heroes[ids.mate].shp, 7);
  // 主持人的探索顶栏：「进入战斗环节」旁边有「决斗」
  await page.waitForSelector("#tr-duel");
  assert.equal(await page.evaluate(() => document.querySelector("#tr-fight").nextElementSibling.id), "tr-duel", "在「进入战斗环节」旁边");
  assert.equal(await page.textContent("#tr-duel"), "决斗");
  // 甲申请
  const req = await fromMate(page, { type: "duelRequest" });
  assert.equal(req.ok, true, req.error);
  await page.waitForFunction(() => document.querySelector("#tr-duel").textContent === "决斗 · 有申请");
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.view.duel && p.view.duel.status === "asked"; });
  // 主持人点开浮层同意
  await page.click("#tr-duel");
  await page.waitForSelector('#online-duel:not([hidden]) [data-duel="approve"]');
  assert.match(await page.textContent("#online-duel"), /甲 申请发起决斗/);
  await page.click('#online-duel [data-duel="approve"]');
  await page.waitForFunction(() => HotseatGame.getView().duel && HotseatGame.getView().duel.status === "prep");
  // 甲给自己的角色选 1 队；主持人在浮层里给没分配的第一名选 2 队
  const pick = await fromMate(page, { type: "duelPick", kit: ids.mate, team: "1队" });
  assert.equal(pick.ok, true, pick.error);
  await page.waitForSelector(`#online-duel [data-duel="pick"][data-kit="${ids.gm[0]}"][data-team="2队"]`);
  assert.equal(await page.locator(`#online-duel [data-duel="pick"][data-kit="${ids.mate}"]`).count(), 0, "甲的角色主持人选不了（没有按钮）");
  await page.click(`#online-duel [data-duel="pick"][data-kit="${ids.gm[0]}"][data-team="2队"]`);
  await page.waitForFunction(kit => HotseatGame.getView().duel.heroes.find(h => h.kit === kit).team === "2队", ids.gm[0]);
  // 选项：不允许起身、限定 10 回合
  await page.waitForSelector("#duel-stand");
  await page.click("#duel-stand");
  await page.waitForFunction(() => HotseatGame.getView().duel.stand === false);
  await page.click("#duel-limit");
  await page.waitForFunction(() => HotseatGame.getView().duel.rounds === 10);
  // 发给甲的包：谁在哪一队、选项；没有坚毅
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.view.duel && p.view.duel.rounds === 10 && p.view.duel.stand === false; });
  const pd = await page.evaluate(() => __last("p-1").view.duel);
  assert.equal(pd.heroes.find(h => h.kit === ids.mate).team, "1队");
  assert.equal(pd.heroes.find(h => h.kit === ids.gm[0]).team, "2队");
  assert.equal(pd.heroes.find(h => h.kit === ids.mate).owner, "p-1");
  // 开始决斗
  await page.click('#online-duel [data-duel="start"]');
  await page.waitForFunction(() => Screens.is("battle") && !!state.pvpDuel && !state.combatStarted);
  await page.evaluate(() => { const intro = document.querySelector("#g-intro"); if (intro) intro.click(); GAME.fast = true; });
  const field = await page.evaluate(() => ({ heroes: state.units.filter(u => u.isPlayer && !u.weaponOf).map(u => [u.kit, u.zone, playerFactionOf(u)]), foes: state.units.filter(u => !u.isPlayer).length,
    zoneMode: state.zoneMode, title: document.querySelector("#g-enc-name").textContent, prep: HotseatGame.getView().duel, duelBtn: !!document.querySelector("#tr-duel") && !document.querySelector("#tr-duel").closest("[hidden]") }));
  assert.deepEqual(field.heroes.sort(), [[ids.gm[0], 3, "2队"], [ids.mate, 1, "1队"]].sort(), "只有参加的两个人：1 队在 1 区、2 队在 3 区");
  assert.equal(field.foes, 0, "没有敌人");
  assert.equal(field.zoneMode, 3);
  assert.equal(field.title, "决斗");
  assert.equal(field.prep, null, "准备画面收起");
  assert.match(await page.evaluate(() => HotseatGame.getView().chat.map(m => m.text).join("\n")), /决斗开始：1 队（[^）]+）对 2 队（[^）]+），不允许起身，限定 10 回合。/);
  // 甲的角色还归甲操控
  assert.equal(await page.evaluate(kit => HotseatGame.getView().heroes.find(h => state.units.find(u => u.id === h.id).kit === kit).owner, ids.mate), "p-1");
  // 开战：抛硬币，公开记录写谁先手；甲的包里有决斗的选项
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && !!state.pvpDuel.first && GAME.depth === 0, null, { timeout: 15000 });
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.state && p.state.duel && p.state.duel.first; });
  await page.waitForFunction(() => __logs("p-1").some(t => /^抛硬币/.test(t)), null, { timeout: 10000 }).catch(() => {});
  const ps = await page.evaluate(() => { const p = __last("p-1"); return { duel: p.state.duel, logs: __logs("p-1") }; });
  assert.equal(ps.duel.stand, false);
  assert.equal(ps.duel.rounds, 10);
  assert.ok(["1队", "2队"].includes(ps.duel.first));
  assert.ok(ps.logs.some(t => /^抛硬币：[12] 队先手（我方回合行动），[12] 队后手（敌人回合行动）$/.test(t)), "抛硬币的结果大家都看得到：" + ps.logs.join(" / "));
  // 决斗里甲的角色又受了伤；然后 2 队的人倒地（不允许起身：倒地就算倒下）→ 1 队获胜
  await idle(page);
  const hurt = await page.evaluate(kit => { const u = state.units.find(x => x.kit === kit && !x.weaponOf); u.layers.forEach(l => { l.current = 1; }); u.shp = 3; return { shp: u.shp }; }, ids.mate);
  assert.equal(hurt.shp, 3);
  await page.evaluate(kit => { const u = state.units.find(x => x.kit === kit && !x.weaponOf); u.layers.forEach(l => { l.current = 0; }); u.dying = true; GAME.checkEnd(); }, ids.gm[0]);
  await page.waitForFunction(() => GAME.ended);
  assert.equal(await page.textContent("#g-result h2"), "1 队 获胜");
  assert.match(await page.textContent("#g-result p"), /1 队获胜：2 队全部倒地。决斗没有掉落、经验、奎支；血量、坚毅生命、武器耐久恢复成决斗前的样子（用掉的道具不恢复）。各阵营的分数（只是显示）：1 队 \d+ 分/);
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.result && p.result.duel; });
  const res = await page.evaluate(() => __last("p-1").result);
  assert.equal(res.duel.winner, "1队");
  assert.equal(res.duel.why, "wipe");
  assert.deepEqual(res.teams.map(t => t.name), ["1 队", "2 队"]);
  assert.equal(res.grade, undefined, "不评级");
  assert.ok(!res.drops, "没有掉落");
  assert.doesNotMatch(await page.evaluate(() => __all("p-1")), /"shp|坚毅|restore/, "发给甲的东西里没有坚毅");
  // 回到探索：队伍档案恢复成决斗前的样子；「决斗」入口回来
  await page.evaluate(() => TrpgFlow.backFromBattle());
  await page.waitForFunction(() => Screens.is("trpg") && !!document.querySelector("#tr-duel"));
  const after = await page.evaluate(() => JSON.parse(JSON.stringify({ heroes: LEDGER.heroes, dur: LEDGER.dur })));
  assert.deepEqual(after.heroes[ids.mate], before.heroes[ids.mate], "甲的角色：血量 / 坚毅恢复成决斗前的样子");
  for (const k of Object.keys(after.dur || {})) assert.equal(after.dur[k], (before.dur || {})[k], k + " 的耐久恢复");
  assert.equal(await page.textContent("#tr-duel"), "决斗");
  assert.deepEqual(o.errors, []);
});

test("决斗浮层（duel-ui.js）：玩家看自己的角色能选队、别人的只能看；人数不够时主持人的「开始决斗」是灰的；文字里没有坚毅", { timeout: 60000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const DuelUI = require("../duel-ui.js");
  const duel = { id: "duel-1", status: "prep", by: "p1", byName: "甲", stand: true, rounds: null,
    heroes: [{ kit: "kolt", name: "柯尔特", owner: "p1", team: "1队" }, { kit: "helu", name: "Helumica", owner: "p1" }, { kit: "hiaki", name: "绯秋", owner: "p2", team: "2队" }, { kit: "tou", name: "灯", owner: "host" }] };
  const p1 = DuelUI.playerHtml({ own: "p1", gmId: "host", duel, busy: false });
  assert.match(p1, /data-kit="kolt" data-team="1队" aria-pressed="true" disabled/, "柯尔特已经在 1 队");
  assert.match(p1, /data-kit="helu" data-team="2队" aria-pressed="false">/, "赫鲁米卡能选");
  assert.doesNotMatch(p1, /data-kit="hiaki"/, "乙的角色甲选不了");
  assert.match(p1, /1 队（1\/4）/);
  assert.match(p1, /允许起身；不限回合/);
  assert.doesNotMatch(p1, /坚毅|shp/);
  // 申请中：申请人能撤回，别人只能等
  assert.match(DuelUI.playerHtml({ own: "p1", duel: Object.assign({}, duel, { status: "asked" }) }), /data-duel="cancel"/);
  assert.doesNotMatch(DuelUI.playerHtml({ own: "p2", duel: Object.assign({}, duel, { status: "asked" }) }), /data-duel="cancel"/);
  assert.match(DuelUI.playerHtml({ own: "p2", duel: null }), /data-duel="request"/);
  // 主持人：灯（没分配）有按钮；1 队有人、2 队有人 → 能开始；2 队没人 → 灰的
  const gm = DuelUI.gmHtml({ own: "host", duel, busy: false, playerName: id => ({ p1: "甲", p2: "乙" })[id] || id });
  assert.match(gm, /data-kit="tou" data-team="1队"/);
  assert.doesNotMatch(gm, /data-duel="pick" data-kit="kolt"/, "玩家的角色主持人不选");
  assert.match(gm, /data-duel="start">开始决斗/);
  const lonely = Object.assign({}, duel, { heroes: duel.heroes.filter(h => h.kit !== "hiaki") });
  assert.match(DuelUI.gmHtml({ own: "host", duel: lonely }), /data-duel="start" disabled>开始决斗/);
  assert.match(DuelUI.gmHtml({ own: "host", duel: Object.assign({}, duel, { status: "asked" }) }), /data-duel="approve"[\s\S]*data-duel="reject"/);
  assert.match(DuelUI.gmHtml({ own: "host", duel: null }), /data-duel="open"/);
});
