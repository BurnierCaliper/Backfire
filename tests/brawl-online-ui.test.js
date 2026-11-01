// 联机玩法「争斗」第 2 步：接上联机（#543 / issue #560）——真的 game.html 当房主（假的转发连接，同 tests/pvp-duel-ui.test.js 的搭法），旧画面：
//   · 手机竖屏（390×844）：标题「联机玩法」→「联机开房」，「玩法」下拉框选「争斗」→ 开房 → 房间画面：房主定等级段 / 每队人数 / AI 队，
//     自己选进 1 队、选角色、一项一项选属性加点和专长 → 准备好 → 开打 → 翻硬币（写谁先手、后手的补偿）→ 战场；全程没有横向溢出；
//   · 一个人开房、对面整队 AI：AI 自己排顺序、出手（房主这边每次都结束行动），打完一整场 → 结算（谁赢）→「回到房间」再来一局，队伍档案换回开打前的样子；
//   · 两个真人（房主 + 甲）：两队都是同一个角色；发给甲的包开打前没有房主的养成，任何时候都没有坚毅数字、没有 AI 的想法。
// 房间、白名单、会话的细节在 tests/brawl-online.test.js，规则在 tests/brawl.test.js。
// 用 Playwright，没装时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
// 坚毅生命的字段 / 字样（upOnShp 是公开的「起身中」，不算）；AI 的想法 / 搜索（sim-search.js · BattleSearch 的统计、试跑的种子）
const LEAK = /"shp"|"shpMax"|shpBase|shpBonus|坚毅/;
const AI_LEAK = /"decisions"|"tried"|skill:[^"]*:@|BattleSearch|"stats":\{"decisions/;

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

/** 房主的 game.html（旧画面）：假的转发连接，房间里有 opt.mates（[{ id, name }]）这几名玩家 */
async function hostPage(t, opt = {}) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext(opt.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(origin + "/game.html");
  await page.evaluate(() => localStorage.setItem("backfire-hd2d-field", "off"));
  await page.goto(origin + "/game.html");
  await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME && !!window.HotseatGame && !!window.OnlineBrawl && !!window.BrawlUI);
  await page.evaluate(mates => {
    window.__noLevelUpPopup = true;
    window.confirm = () => true;
    const roster = [{ id: "gm-1", name: "房主", role: "host", online: true }].concat(mates.map(m => ({ id: m.id, name: m.name, role: "player", online: true })));
    const relay = window.__relay = { sent: [], onMessage: null, onStatus: null, status: { connected: true, paused: false, hostOnline: true, roster } };
    const copy = v => JSON.parse(JSON.stringify(v));
    RelayTransport.createHost = async options => {
      const ep = {
        identity: { id: "gm-1", role: "host", roomCode: "BRAWL5", name: "房主" },
        credentials: () => ({ url: "fake://relay", roomCode: "BRAWL5", role: "host", token: "token-560", protocol: options.protocol, build: options.build }),
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
    window.__ack = (id, no) => { const hit = relay.sent.filter(x => x.to === id && x.value.type === "ack" && x.value.requestId === no).pop(); return hit ? hit.value : null; };
    let no = 0;
    window.__fromPlayer = (id, command) => { relay.onMessage({ type: "cmd", requestId: ++no, command, protocol: OnlineGame.PROTOCOL, build: OnlineGame.BUILD }, id); return no; };
  }, opt.mates || []);
  return { page, errors, context };
}
/** 玩家发来一条指令，等房主回 ack */
async function fromMate(page, id, command) {
  const no = await page.evaluate(([who, c]) => __fromPlayer(who, c), [id, command]);
  await page.waitForFunction(([who, n]) => !!__ack(who, n), [id, no], { timeout: 15000 });
  return page.evaluate(([who, n]) => __ack(who, n), [id, no]);
}
/** 房间画面里自己第 i 个角色的养成：每一步选第一个能选的 */
async function pickAll(page) {
  for (let guard = 0; guard < 20; guard++) {
    const next = await page.evaluate(() => {
      const s = [...document.querySelectorAll("#online-brawl [data-brawl-attr], #online-brawl [data-brawl-feat], #online-brawl [data-brawl-full]")].find(el => !el.value);
      if (!s) return null;
      const o = [...s.options].find(x => x.value && !x.disabled);
      const key = ["data-brawl-attr", "data-brawl-feat", "data-brawl-full"].find(a => s.hasAttribute(a));
      return { sel: `#online-brawl [${key}="${s.getAttribute(key)}"]`, value: o && o.value, busy: s.disabled };
    });
    if (!next) return;
    if (next.busy) { await page.waitForTimeout(80); continue; }
    await page.selectOption(next.sel, next.value);
    await page.waitForTimeout(60);
  }
}
/** 房主这边的「玩家」：轮到房主的单位就结束行动；排顺序时把自己的单位排进空格、确定；问到房主的询问一律不协助 / 选第一项 */
async function passiveHost(page) {
  await page.evaluate(() => {
    window.__hostBot = setInterval(() => {
      if (GAME.ended) return;
      const v = HotseatGame.getView(), me = v.playerId;
      const ask = v.ask;
      if (ask && ask.eligible && !ask.declined) {
        const o = ask.kind === "choice" ? (ask.options || [])[0] : null;
        HotseatGame.submit({ type: "answer", askId: ask.id, helper: o ? o.helper : null, extra: o ? o.extra || {} : {} });
        return;
      }
      if (v.phase === "picking") {
        const mine = (v.units || []).filter(u => u.owner === me), placed = new Set((v.order || []).filter(Boolean).map(r => r.actor));
        const todo = mine.find(u => !placed.has(u.id)), free = (v.order || []).findIndex(r => !r);
        if (todo && free >= 0) { HotseatGame.submit({ type: "orderPick", actor: todo.id, index: free }); return; }
        if (mine.length && !todo && !(v.confirmed || []).includes(me)) HotseatGame.submit({ type: "orderConfirm" });
        return;
      }
      if (v.phase === "acting" && GAME.depth === 0 && !HotseatGame.hasAsk()) {
        const cur = (v.order || []).find(r => r && r.current);
        if (cur && cur.owner === me) GAME.endTurn();
      }
    }, 120);
  });
}
const noOverflow = page => page.evaluate(() => {
  const doc = document.documentElement, room = document.querySelector("#online-brawl");
  const wide = [...document.querySelectorAll("#online-brawl *")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map(el => el.tagName + "." + el.className).slice(0, 5);
  return { page: doc.scrollWidth <= innerWidth + 1, room: !room || room.hidden || room.scrollWidth <= room.clientWidth + 1, wide };
});

test("手机竖屏（390×844）：「玩法」选「争斗」开房 → 房主定设定、2 队交给 AI → 自己选进 1 队、选角色、一项一项选养成 → 准备好 → 开打 → 翻硬币写清楚谁先手、后手的补偿；没有横向溢出", { timeout: 180000 }, async t => {
  const o = await hostPage(t, { mobile: true }); if (!o) return; const { page, errors } = o;
  await page.waitForSelector("#t-online");
  await page.tap("#t-online");
  await page.waitForFunction(() => [...document.querySelectorAll(".ol-title-entry")].some(b => /联机开房/.test(b.textContent)));
  await page.evaluate(() => [...document.querySelectorAll(".ol-title-entry")].find(b => /联机开房/.test(b.textContent)).click());
  await page.waitForSelector("#ol-mode");
  const modes = await page.evaluate(() => [...document.querySelectorAll("#ol-mode option")].map(x => [x.value, x.textContent]));
  assert.deepEqual(modes.map(m => m[0]), ["trpg", "rogue", "brawl"], "「玩法」多一项「争斗」");
  assert.match(modes[2][1], /争斗/);
  await page.selectOption("#ol-mode", "brawl");
  await page.waitForFunction(() => /争斗：两队人数一样/.test(document.querySelector("#online-panel").textContent) && !document.querySelector("#ol-slot"), null, { timeout: 5000 });
  await page.tap('[data-online="connect"]');
  await page.waitForSelector("#online-brawl", { timeout: 15000 });
  assert.equal(await page.evaluate(() => OnlineGame.getView().mode), "brawl");
  assert.equal(await page.evaluate(() => document.querySelector("#online-panel").hidden), true, "大厅是争斗的房间画面，房间面板不挡着");
  assert.match(await page.textContent("#online-brawl"), /争斗 · 第 1 局/);
  let wide = await noOverflow(page);
  assert.ok(wide.page && wide.room, "房间画面没有横向溢出：" + wide.wide.join("、"));
  // 房主定设定：Lv10 段、2 队交给 AI
  await page.selectOption('#online-brawl [data-brawl-opt="tier"]', "1");
  await page.waitForFunction(() => OnlineBrawl.viewFor("gm-1").tier === 1);
  await page.selectOption('#online-brawl [data-brawl-opt="ai"]', "2队");
  await page.waitForFunction(() => OnlineBrawl.viewFor("gm-1").ai === "2队" && !!document.querySelector('#online-brawl [data-brawl-ai="0"]'));
  assert.match(await page.textContent('#online-brawl [data-brawl-team="2队"]'), /AI/);
  // 自己选进 1 队、选柯尔特
  await page.selectOption('#online-brawl [data-brawl-seat][data-team="1队"][data-index="0"]', "kolt");
  await page.waitForSelector('#online-brawl [data-brawl-slot="1队:0"]');
  assert.match(await page.textContent('#online-brawl [data-brawl-slot="1队:0"]'), /还没选完/);
  // 「准备好」被拦下并写原因
  await page.tap('#online-brawl [data-brawl="ready"]');
  await page.waitForFunction(() => /还没选完/.test((document.querySelector("#online-brawl .brawl-error") || {}).textContent || ""));
  await pickAll(page);
  await page.waitForFunction(() => /养成选好了/.test(document.querySelector('#online-brawl [data-brawl-slot="1队:0"]').textContent), null, { timeout: 10000 });
  wide = await noOverflow(page);
  assert.ok(wide.page && wide.room, "选养成时没有横向溢出：" + wide.wide.join("、"));
  assert.doesNotMatch(await page.textContent("#online-brawl"), /坚毅/, "房间画面不写坚毅");
  await page.tap('#online-brawl [data-brawl="ready"]');
  await page.waitForFunction(() => OnlineBrawl.viewFor("gm-1").start.ok === true);
  await page.waitForFunction(() => !document.querySelector('#online-brawl [data-brawl="start"]').disabled);
  await page.tap('#online-brawl [data-brawl="start"]');
  // 翻硬币：写谁先手、后手的补偿；放完开战
  await page.waitForSelector("#brawl-toss", { timeout: 10000 });
  await page.waitForFunction(() => /先手/.test(document.querySelector("#brawl-toss").textContent) && /后手：开局每个角色多 1 个附赠动作/.test(document.querySelector("#brawl-toss").textContent), null, { timeout: 10000 });
  const first = await page.evaluate(() => state.pvpDuel.first);
  assert.match(await page.textContent("#brawl-toss"), new RegExp((first === "1队" ? "1 队" : "2 队") + "先手"));
  // 开战前柯尔特自选初始刀头：问的是操控他的人（房主），AI 那一队的不用房主答
  await page.waitForSelector('.hs-ask-options [data-hs="answer"]', { timeout: 15000 });
  assert.match(await page.textContent(".hs-ask-card"), /柯尔特 · 初始刀头/);
  await page.tap('.hs-ask-options [data-hs="answer"][data-option="0"]');
  await page.waitForFunction(() => state.combatStarted === true, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => Screens.is("battle")), true);
  assert.equal(await page.evaluate(() => document.querySelector("#online-brawl").hidden), true, "开打以后房间画面收起");
  assert.deepEqual(await page.evaluate(() => state.units.filter(u => u.isPlayer && !u.weaponOf).map(u => u.level)), [10, 10], "Lv10 段");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#g-bs")).display), "none", "房主也是玩家：后台按钮藏起来");
  wide = await noOverflow(page);
  assert.ok(wide.page, "战场没有横向溢出");
  assert.deepEqual(errors, []);
});

test("一个人开房、对面整队 AI：AI 自己排顺序、出手、回答询问（节奏照敌人 AI），打完一整场 → 结算写谁赢 →「回到房间」再来一局（设定、位置、养成留着），队伍档案换回开打前的样子", { timeout: 300000 }, async t => {
  const o = await hostPage(t); if (!o) return; const { page, errors } = o;
  const before = await page.evaluate(async () => {
    GAME.skip = true; GAME.instant = true;
    BRAWL_ROOM_CFG.aiStepMs = 60; BRAWL_ROOM_CFG.tossMs = 600;   // 测试里放快一点（照样一步一步来）
    const ledger = JSON.stringify(LEDGER.save());
    window.__campBefore = localStorage.getItem("anterscale-campaign");   // 队伍记忆（game.js · CAMP_KEY）
    await OnlineGame.create({ url: "fake://relay", name: "房主", mode: "brawl" });
    const go = cmd => OnlineGame.submit(cmd).then(r => { if (r && r.ok === false) throw new Error(r.error); });
    await go({ type: "brawl.set", tier: 1, size: 2, ai: "2队", rounds: 3 });
    await go({ type: "brawl.seat", team: "1队", index: 0, kit: "tou" });
    await go({ type: "brawl.seat", team: "1队", index: 1, kit: "ruby" });
    for (const [i, kit] of [[0, "tou"], [1, "ruby"]]) { const e = brawlSimEntry(kit, 1); await go({ type: "brawl.build", team: "1队", index: i, build: { attrs: e.attrs, feats: e.feats, cyberPlan: e.cyberPlan } }); }
    await go({ type: "brawl.ready", on: true });
    return { ledger, view: OnlineBrawl.viewFor("gm-1") };
  });
  assert.equal(before.view.start.ok, true, "一个人 + AI 队就能开打：" + before.view.start.why.join("；"));
  await passiveHost(page);
  await page.evaluate(() => OnlineGame.start());
  await page.waitForFunction(() => state.combatStarted === true, null, { timeout: 20000 });
  const ai = await page.evaluate(() => state.pvpDuel.teams["2队"].map(id => HotseatGame.getView().heroes.find(h => h.id === id).owner));
  assert.deepEqual(ai, ["brawl-ai", "brawl-ai"], "2 队归 AI 操作者");
  // AI 排顺序（会话里每一轮开始一起排）：AI 的单位自己排进格子、确定
  await page.waitForFunction(() => { const v = HotseatGame.getView(); return v.phase !== "picking" || false; }, null, { timeout: 20000 });
  // 打完一整场（限定 3 回合：到了按剩余血量百分比判）
  await page.waitForFunction(() => GAME.ended === true, null, { timeout: 240000 });
  const end = await page.evaluate(() => ({ acted: state.pvpDuel.teams["2队"].map(id => state.units.find(u => u.id === id).name).filter(n => (state.logPages || []).some(p => p.lines.some(l => String(l.text).startsWith(`【${n}】`)))),
    result: JSON.parse(JSON.stringify(state.pvpDuel.result)),
    room: OnlineBrawl.viewFor("gm-1"), stashed: brawlStashed(), ledger: JSON.stringify(LEDGER.save()), panel: document.querySelector("#g-result").textContent,
    back: getComputedStyle(document.querySelector("#g-brawl-back")).display, explore: getComputedStyle(document.querySelector("#g-explore-back")).display,
    camp: localStorage.getItem("anterscale-campaign") === window.__campBefore }));
  assert.ok(end.acted.length >= 1, "AI 那一队自己出手了（战斗记录里有它们的技能）");
  assert.equal(end.result.over, true);
  assert.equal(end.room.phase, "ended");
  assert.equal(end.stashed, false, "打完把开局收起来的队伍档案放回去");
  assert.equal(end.ledger, before.ledger, "队伍档案和开打前一样（争斗不读也不写存档）");
  assert.equal(end.camp, true, "队伍记忆没被争斗的角色盖掉");
  assert.match(end.panel, /争斗没有掉落、经验、奎支/);
  assert.notEqual(end.back, "none", "结算面板有「回到房间（再来一局）」");
  assert.equal(end.explore, "none");
  // 回到房间：再来一局
  await page.waitForSelector("#g-result.show #g-brawl-back", { timeout: 15000 });
  await page.click("#g-brawl-back");
  await page.waitForFunction(() => OnlineBrawl.viewFor("gm-1").phase === "setup" && OnlineGame.getView().screen === "lobby");
  const again = await page.evaluate(() => OnlineBrawl.viewFor("gm-1"));
  assert.equal(again.no, 2);
  assert.deepEqual([again.tier, again.size, again.ai, again.rounds], [1, 2, "2队", 3], "设定留着");
  assert.deepEqual(again.teams["1队"].map(r => [r.kit, r.done]), [["tou", true], ["ruby", true]], "位置、养成留着");
  assert.deepEqual(again.ready, [], "准备好要重新按");
  await page.waitForSelector("#online-brawl");
  assert.deepEqual(errors, []);
});

test("两个真人（房主 + 甲）：两队都是同一个角色；发给甲的包开打前没有房主的养成，任何时候都没有坚毅数字、没有 AI 的想法；甲排自己的顺序", { timeout: 180000 }, async t => {
  const o = await hostPage(t, { mates: [{ id: "p-1", name: "甲" }] }); if (!o) return; const { page, errors } = o;
  await page.evaluate(async () => {
    GAME.skip = true; GAME.instant = true; BRAWL_ROOM_CFG.tossMs = 400;
    await OnlineGame.create({ url: "fake://relay", name: "房主", mode: "brawl" });
    const go = cmd => OnlineGame.submit(cmd).then(r => { if (r && r.ok === false) throw new Error(r.error); });
    await go({ type: "brawl.set", tier: 1 });
    await go({ type: "brawl.seat", team: "1队", index: 0, kit: "hiaki" });
    // 房主的养成：属性加意志、智力（甲不会选的组合）
    const e = brawlSimEntry("hiaki", 1);
    await go({ type: "brawl.build", team: "1队", index: 0, build: { attrs: ["wil", "int"], feats: e.feats, cyberPlan: { armor: 2 } } });
    await go({ type: "brawl.ready", on: true });
  });
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.brawl && p.brawl.teams["1队"][0].kit === "hiaki"; });
  const seen = await page.evaluate(() => __last("p-1").brawl);
  assert.equal(seen.teams["1队"][0].done, true);
  assert.equal("build" in seen.teams["1队"][0], false, "甲看不到房主的养成");
  // 甲也选绯秋（2 队）
  const sit = await fromMate(page, "p-1", { type: "brawl.seat", team: "2队", index: 0, kit: "hiaki" });
  assert.equal(sit.ok, true, sit.error);
  const bad = await fromMate(page, "p-1", { type: "brawl.seat", team: "1队", index: 0, kit: "ruby" });
  assert.equal(bad.ok, false); assert.match(bad.error, /这个位置已经有人了/);
  const e = await page.evaluate(() => brawlSimEntry("hiaki", 1));
  const b = await fromMate(page, "p-1", { type: "brawl.build", team: "2队", index: 0, build: { attrs: e.attrs, feats: e.feats, cyberPlan: null } });
  assert.equal(b.ok, true, b.error);
  const r = await fromMate(page, "p-1", { type: "brawl.ready", on: true });
  assert.equal(r.ok, true, r.error);
  const before = await page.evaluate(() => __all("p-1"));
  assert.doesNotMatch(before, /"wil","int"/, "开打前发给甲的没有房主的属性加点");
  assert.doesNotMatch(before, /"armor":2/, "也没有房主的改造方案");
  await page.evaluate(() => OnlineGame.start());
  await page.waitForFunction(() => state.combatStarted === true, null, { timeout: 15000 });
  await page.waitForFunction(() => HotseatGame.getView().phase === "picking");
  const heroes = await page.evaluate(() => HotseatGame.getView().heroes.map(h => ({ kit: state.units.find(u => u.id === h.id).kit, owner: h.owner })));
  assert.deepEqual(heroes.map(h => h.kit), ["hiaki", "hiaki"], "两队都是绯秋");
  assert.deepEqual(heroes.map(h => h.owner).sort(), ["gm-1", "p-1"], "各归各的");
  // 甲排自己的顺序
  const mine = await page.evaluate(() => HotseatGame.getView().units.find(u => u.owner === "p-1").id);
  const free = await page.evaluate(() => HotseatGame.getView().order.findIndex(x => !x));
  const pick = await fromMate(page, "p-1", { type: "orderPick", actor: mine, index: free });
  assert.equal(pick.ok, true, pick.error);
  const conf = await fromMate(page, "p-1", { type: "orderConfirm" });
  assert.equal(conf.ok, true, conf.error);
  await page.waitForFunction(() => { const p = __last("p-1"); return p && p.view && p.view.order.some(x => x && x.actor && x.owner === "p-1"); });
  const all = await page.evaluate(() => __all("p-1"));
  assert.doesNotMatch(all, LEAK, "发给甲的包里没有坚毅数字");
  assert.doesNotMatch(all, AI_LEAK, "也没有 AI 的想法 / 搜索");
  const last = await page.evaluate(() => __last("p-1"));
  assert.equal(last.mode, "brawl");
  assert.ok(last.brawl.toss && ["1队", "2队"].includes(last.brawl.toss.first), "翻硬币的结果发给甲");
  assert.deepEqual(errors, []);
});
