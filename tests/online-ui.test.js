"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execSync } = require("node:child_process");
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { browser = await playwright().chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function open(t, mobile = false) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app">Original host battlefield</main></body>');
  for (const file of ["game.css", "skin.css", "online.css"]) await page.addStyleTag({ path: path.resolve(__dirname, "..", file) });
  await page.evaluate(() => {
    const players = [{ id: "gm", name: "主持人", gm: true, online: true }, { id: "p1", name: "甲", online: true }, { id: "p2", name: "乙", online: true }];
    const unit = (id, name, isPlayer, zone) => ({ id, name, isPlayer, zone, level: 1, ap: 2, apMax: 2, bonus: 1, bonusMax: 1, def: 6, defMax: 6, layers: [{ type: "flesh", current: 30, max: 35 }], statuses: {}, resources: { nano: 2 } });
    const state = { displayOnly: true, units: [unit("a", "红玉", true, 1), unit("b", "绯秋", true, 1), unit("enemy", "敌人", false, 2)], turnNo: 1, zoneMode: 3, weather: "sand", props: [] };
    const heroes = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }];
    window.fixture = { calls: [], listeners: [], packets: [], view: { active: false, isHost: false, identity: null, status: { connected: true, hostOnline: true, paused: false, roster: players }, screen: "lobby", roomCode: "ABCD23", players, state, heroes, messages: [],
      packet: { view: { mode: "trpg", playerId: "p1", hostId: "gm", units: heroes, heroes, phase: "acting", currentUnitId: "a", order: [] }, state, publicLogs: [{ text: "红玉 · 普通攻击" }] } },
      emit() { this.listeners.forEach(fn => fn()); }, set(data) { Object.assign(this.view, data); this.emit(); },
      async receive(packet) { for (const fn of this.packets) await fn(packet); this.view.packet = packet; this.view.state = packet.state; this.view.screen = packet.screen; this.emit(); }
    };
    const record = (kind, args) => { fixture.calls.push({ kind, args: args == null ? null : JSON.parse(JSON.stringify(args)) }); return { ok: true }; };
    window.OnlineGame = {
      getView: () => JSON.parse(JSON.stringify(fixture.view)), slots: () => [{ index: 0, name: "存档甲" }, { index: 1, name: "空白存档" }], hasSaved: () => true,
      create(opts) { record("create", opts); fixture.set({ active: true, isHost: true, identity: { id: "gm" }, screen: "lobby" }); },
      join(opts) { record("join", opts); fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "lobby" }); },
      resume() { record("resume"); fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle" }); },
      assign(opts) { return record("assign", opts); }, start() { record("start"); fixture.set({ screen: "exploration" }); return { ok: true }; },
      submit(cmd) { return record("submit", cmd); }, reconnect() { return record("reconnect"); }, leave() { record("leave"); fixture.set({ active: false }); },
      async actionMenu(request) {
        record("menu", request); const base = { type: "actionOptions", displayOnly: true, actor: request.actor, skill: request.skill };
        if (!request.skill) return { ...base, choices: { kind: "skill", options: [{ value: "ruby_aa", label: "普通攻击" }, { value: "flow", label: "分步技能" }, { value: "__item", label: "使用道具" }] } };
        if (request.skill === "flow" && !request.picks?.mode) return { ...base, choices: { kind: "choice", key: "mode", optional: false, title: "选择模式", options: [{ value: "heal", label: "治疗" }] } };
        if (request.skill === "flow" && !request.picks?.target) return { ...base, choices: { kind: "unit", key: "target", optional: false, title: "选择友方", options: [{ value: "b", label: "绯秋" }] } };
        if (request.skill === "__item" && !request.item) return { ...base, choices: { kind: "choice", key: "item", title: "选择道具", options: [{ value: "medkit", label: "医疗包" }] } };
        if ((request.skill === "ruby_aa" || request.skill === "__item") && !request.target) return { ...base, choices: { kind: "unit", key: "target", title: "选择目标", options: [{ value: request.skill === "__item" ? "b" : "enemy", label: request.skill === "__item" ? "绯秋" : "敌人" }] } };
        const command = request.skill === "__item" ? { type: "useItem", actor: request.actor, item: request.item, target: request.target, dest: null } : { type: "skill", actor: request.actor, skill: request.skill, target: request.target || request.picks?.target, picks: request.picks || {} };
        return { ...base, choices: { kind: "ready", title: "确认执行", command, options: [] } };
      },
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(f => f !== fn); }; },
      onPacket(fn) { fixture.packets.push(fn); return () => { fixture.packets = fixture.packets.filter(f => f !== fn); }; }
    };
    // Access to either authority entrypoint fails. A display client must work
    // when no rules state or battle engine exists in its environment.
    for (const name of ["GAME", "state", "BattleCommands", "dispatch", "skillFlowSteps", "previewOf", "Screens"]) Object.defineProperty(window, name, { configurable: true, get() { throw new Error("Display touched rules: " + name); } });
  });
  for (const file of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  return { page, errors };
}
async function player(page, patch = {}) { await page.evaluate(patch => fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle", ...patch }), patch); }
const calls = page => page.evaluate(() => fixture.calls);

test("D3 display: title create/join forms send explicit room options and preserve original host screen", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  assert.equal(await page.isVisible("#online-stage"), false);
  await page.getByRole("button", { name: /联机开房/ }).click();
  await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "测试主持");
  await page.selectOption("#ol-slot", "1"); await page.fill("#ol-campaign", "新的团");
  await page.click('[data-online="connect"]');
  assert.deepEqual((await calls(page))[0], { kind: "create", args: { url: "http://localhost:8799", name: "测试主持", slot: 1, campaignName: "新的团" } });
  assert.equal(await page.isVisible("#online-stage"), false); assert.equal(await page.locator("body").evaluate(e => e.classList.contains("online-player")), false);
  await page.selectOption('[data-assign="a"]', "gm"); await page.click('[data-online="assign"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "assign").args, { a: "gm", b: "p2" });
  await page.click('[data-online="start"]'); assert.equal(await page.isVisible("#online-panel"), false);
  assert.deepEqual(o.errors, []);
});

test("D3 display: player picks skills from the skill bar and targets on the field, like the other modes", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page);
  const submits = () => calls(page).then(c => c.filter(x => x.kind === "submit"));
  // 轮到自己：不用点「选择行动」，技能栏自动出来
  await page.waitForSelector('.ol-battle [data-ob-skill="ruby_aa"]');
  assert.equal(await page.locator('[data-online="actor"]').count(), 0);
  // 普通攻击：选技能 → 战场上敌人亮起 → 点敌人就出手
  await page.click('[data-ob-skill="ruby_aa"]');
  await page.waitForSelector('.unit-wrap[data-unit-id="enemy"].is-targetable');
  assert.equal(await page.locator('.unit-wrap[data-unit-id="a"].is-targetable').count(), 0);
  assert.equal((await submits()).length, 0);
  await page.click('.unit-wrap[data-unit-id="enemy"]');
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit"));
  assert.deepEqual((await submits())[0].args, { type: "skill", actor: "a", skill: "ruby_aa", target: "enemy", picks: {} });
  // 分步技能：提示栏里选模式，再在战场上点友方
  await page.waitForSelector('[data-ob-skill="flow"]:not([disabled])');
  await page.click('[data-ob-skill="flow"]');
  await page.getByRole("button", { name: "治疗", exact: true }).click();
  await page.waitForSelector('.unit-wrap[data-unit-id="b"].is-targetable');
  await page.click('.unit-wrap[data-unit-id="b"]');
  await page.waitForFunction(() => fixture.calls.filter(c => c.kind === "submit").length === 2);
  assert.deepEqual((await calls(page)).filter(c => c.kind === "menu").find(c => c.args.picks && c.args.picks.target).args, { actor: "a", skill: "flow", picks: { mode: "heal", target: "b" } });
  // 道具：选道具 → 点友方
  await page.waitForSelector('[data-ob-skill="__item"]:not([disabled])');
  await page.click('[data-ob-skill="__item"]');
  await page.getByRole("button", { name: "医疗包", exact: true }).click();
  await page.waitForSelector('.unit-wrap[data-unit-id="b"].is-targetable');
  await page.click('.unit-wrap[data-unit-id="b"]');
  await page.waitForFunction(() => fixture.calls.filter(c => c.kind === "submit").length === 3);
  assert.deepEqual((await submits()).at(-1).args, { type: "useItem", actor: "a", item: "medkit", target: "b", dest: null });
  // 选了技能以后 Esc 取消，回到技能栏
  await page.waitForSelector('[data-ob-skill="ruby_aa"]:not([disabled])');
  await page.click('[data-ob-skill="ruby_aa"]');
  await page.waitForSelector('.unit-wrap[data-unit-id="enemy"].is-targetable');
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".unit-wrap.is-targetable"));
  // 结束行动
  await page.click(".ol-battle .endturn");
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "endTurn"));
  assert.equal((await submits()).length, 4);
  assert.deepEqual(o.errors, []);
});

test("D3 display: 390px cards and private message history render as text; player replies only to host", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await player(page);
  await page.evaluate(() => { fixture.view.state.units[0].name = '<img src=x onerror="alert(1)">'; fixture.view.state.units[0].shp = 999991; fixture.view.state.units[0].note = "BACKSTAGE-MARKER"; fixture.emit(); });
  assert.equal(await page.locator("#online-stage img").count(), 0);
  assert.doesNotMatch(await page.locator("#online-stage").innerText(), /999991|BACKSTAGE|坚毅|伤害预览/);
  assert.match(await page.locator("#online-stage").innerText(), /沙暴/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => fixture.set({ messages: [{ id: "m1", from: "gm", to: "p1", text: "只给你的线索 <b>文本</b>" }] }));
  assert.equal(await page.isVisible("#online-toast"), true);
  assert.match(await page.locator("#online-toast").innerText(), /仅你可见/);
  await page.click('[data-online="openRoom"]');
  assert.equal(await page.locator("#ol-to").count(), 0);
  await page.fill("#ol-message", "收到线索"); await page.locator('#ol-message-form button[type="submit"]').click();
  assert.deepEqual((await calls(page)).find(c => c.kind === "submit").args, { type: "gmReply", text: "收到线索" });
  assert.equal(await page.locator("#ol-message").inputValue(), "");
  assert.deepEqual(o.errors, []);
});

test("D3 display: incoming tape plays snapshots in sequence and never mutates received packets", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page);
  await page.evaluate(() => {
    const packet = JSON.parse(JSON.stringify(fixture.view.packet)); packet.type = "result"; packet.displayOnly = true; packet.screen = "battle";
    packet.tape = [{ type: "pop", unitId: "a", kind: "dmg", value: 4, snap: packet.state.units.map(u => u.id === "a" ? { ...u, layers: [{ type: "flesh", current: 26, max: 35 }] } : u) }];
    packet.state.units[0].layers[0].current = 26;
    fixture.received = packet; fixture.before = JSON.stringify(packet); fixture.playing = fixture.receive(packet);
  });
  await page.locator(".ol-popup.ol-visible").waitFor();
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /26\s*\/\s*35/);
  assert.equal(await page.locator(".ol-battle [data-ob-skill]").first().isDisabled(), true, "演出中不能操作");
  await page.evaluate(() => fixture.playing);
  await page.waitForFunction(() => document.querySelector(".ol-battle [data-ob-skill]") && !document.querySelector(".ol-battle [data-ob-skill]").disabled);
  assert.equal(await page.evaluate(() => JSON.stringify(fixture.received) === fixture.before), true);
  assert.deepEqual(o.errors, []);
});

test("D3 display: a resync replaces an in-flight old snapshot and prevents its later frames from repainting", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page);
  await page.evaluate(() => {
    const old = JSON.parse(JSON.stringify(fixture.view.packet)); old.type = "result"; old.displayOnly = true; old.screen = "battle";
    old.tape = [20, 10, 5].map(hp => ({ type: "pop", unitId: "a", kind: "dmg", value: 5, snap: old.state.units.map(u => u.id === "a" ? { ...u, layers: [{ type: "flesh", current: hp, max: 35 }] } : u) }));
    old.state.units[0].layers[0].current = 5;
    // Call only the presentation callback. The actual coordinator's epoch test
    // separately ensures this obsolete completion cannot install its packet.
    fixture.oldAnimation = fixture.packets[0](old);
  });
  await page.locator(".ol-popup.ol-visible").waitFor();
  await page.evaluate(async () => {
    const sync = JSON.parse(JSON.stringify(fixture.view.packet)); sync.type = "resync"; sync.displayOnly = true; sync.screen = "battle"; sync.tape = [];
    sync.state.units[0].layers[0].current = 33;
    await fixture.receive(sync);
  });
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /33\s*\/\s*35/);
  await page.evaluate(() => fixture.oldAnimation);
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /33\s*\/\s*35/);
  assert.equal(await page.locator(".ol-popup.ol-visible").count(), 0);
  assert.deepEqual(o.errors, []);
});

test("D3 display: resync invalidates an outstanding old action menu response", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page);
  await page.waitForSelector('.ol-battle [data-ob-skill="ruby_aa"]');
  await page.evaluate(() => { fixture.resolvers = []; OnlineGame.actionMenu = () => new Promise(resolve => { fixture.resolvers.push(resolve); }); });
  await page.click('[data-ob-skill="ruby_aa"]');
  await page.evaluate(async () => {
    const stale = fixture.resolvers[0];
    const sync = JSON.parse(JSON.stringify(fixture.view.packet)); sync.type = "resync"; sync.displayOnly = true; sync.screen = "battle"; sync.tape = [];
    await fixture.receive(sync);
    stale({ type: "actionOptions", displayOnly: true, actor: "a", choices: { kind: "ready", title: "过期菜单", options: [], command: { type: "standUp", actor: "a" } } });
  });
  await page.waitForTimeout(200);
  assert.equal((await calls(page)).filter(c => c.kind === "submit").length, 0, "过期的菜单不会被执行");
  assert.doesNotMatch(await page.locator("#online-stage").innerText(), /过期菜单/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: paused connection disables action and reconnect leaves the display state intact", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page, { status: { connected: true, hostOnline: false, paused: true, roster: [] } });
  assert.equal(await page.locator(".ol-battle .endturn").isDisabled(), true);
  assert.equal(await page.locator(".ol-battle [data-ob-skill]").count(), 0);
  await page.click('[data-online="openRoom"]'); await page.click('[data-online="reconnect"]');
  assert.equal((await calls(page)).filter(c => c.kind === "reconnect").length, 1);
  assert.equal((await calls(page)).filter(c => c.kind === "submit" || c.kind === "menu").length, 0);
  assert.deepEqual(o.errors, []);
});

test("D3 display: join form, lobby public chat and public field changes use the presentation contract", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await page.getByRole("button", { name: /加入房间/ }).click();
  await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "路人甲"); await page.fill("#ol-code", "abcd23");
  await page.click('[data-online="connect"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "join").args, { url: "http://localhost:8799", name: "路人甲", roomCode: "ABCD23" });
  await page.fill("#ol-lobby-text", "我来选红玉"); await page.locator('#ol-lobby-chat button[type="submit"]').click();
  assert.deepEqual((await calls(page)).find(c => c.kind === "submit").args, { type: "chat", text: "我来选红玉" });
  await page.evaluate(() => {
    fixture.view.state.fields = { 1: { fireOn: true, fire: 2, ruinOn: true, ruinHp: 6, ruinMax: 30 } };
    fixture.view.state.gaps = { "1-2": { type: "wall", hp: 9 }, "2-3": { type: "door", open: false } };
    fixture.view.packet.manualPhase = true; fixture.view.packet.view.phase = "enemy";
    fixture.set({ screen: "battle" });
  });
  assert.equal(await page.isVisible("#online-panel"), false);
  const shown = await page.locator("#online-stage").innerText();
  assert.match(shown, /火场 2/); assert.match(shown, /损毁地面 6 \/ 30/); assert.match(shown, /危墙\s*9/); assert.match(shown, /机关门\s*关/); assert.match(shown, /主持人正在操控敌人/);
  assert.equal(await page.locator('.g-zone[data-num="1"].field-fire').count(), 1);
  assert.equal(await page.locator('[data-online="actor"]').count(), 0);
  assert.deepEqual(o.errors, []);
});

test("D3 display: exploration shows shared supplies and every hero XP, updating after host rewards", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await player(page, { screen: "exploration" });
  await page.evaluate(() => {
    fixture.view.state.units[0].xp = 125; fixture.view.state.units[1].xp = 55;
    fixture.view.state.kuizhi = 520;
    fixture.view.state.bag = { water: 1200, items: [{ id: "food_can", name: "罐头食品", qty: 3 }, { id: "medkit", name: "简易医疗包", qty: 2 }] };
    fixture.emit();
  });
  let shown = await page.locator("#online-stage").innerText();
  assert.match(shown, /奎支 520/); assert.match(shown, /水 1200 ml/); assert.match(shown, /罐头食品 × 3/);
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /经验 125/);
  assert.match(await page.locator('[data-unit-id="b"]').innerText(), /经验 55/);
  assert.equal(await page.locator('[data-online="actor"]').count(), 0);
  await page.evaluate(() => { fixture.view.state.units[0].xp += 10; fixture.view.state.kuizhi += 20; fixture.view.state.bag.items[0].qty += 1; fixture.emit(); });
  shown = await page.locator("#online-stage").innerText();
  assert.match(shown, /奎支 540/); assert.match(shown, /罐头食品 × 4/); assert.match(shown, /经验 135/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(o.errors, []);
});

test("D3 display: weather has direction, phase, lock, distinct color and icon; ended shows actual outcome and grade", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await player(page);
  await page.evaluate(() => { fixture.view.state.sandDir = "23"; fixture.view.state.weatherLocked = true; fixture.emit(); });
  assert.match(await page.locator(".ol-weather").innerText(), /风向 2 区 → 3 区/);
  assert.match(await page.locator(".ol-weather").innerText(), /天气已锁定/);
  assert.ok(await page.locator(".ol-weather-icon").innerText());
  const sandColor = await page.locator(".ol-weather").evaluate(e => getComputedStyle(e).color);
  await page.evaluate(() => { fixture.view.state.weather = "phase"; fixture.view.state.phaseStep = 2; fixture.emit(); });
  assert.match(await page.locator(".ol-weather").innerText(), /相位 波峰（2）/);
  assert.notEqual(await page.locator(".ol-weather").evaluate(e => getComputedStyle(e).color), sandColor);
  for (const [weather, name] of [["none", "常态"], ["heat", "酷暑"], ["snow", "雪天"], ["acid", "酸雨"], ["thunder", "雷鸣"], ["glow", "微光"], ["sand", "沙暴"], ["phase", "相位"]]) {
    await page.evaluate(weather => { fixture.view.state.weather = weather; fixture.emit(); }, weather);
    assert.equal(await page.locator(".ol-weather b").innerText(), name);
  }
  for (const [outcome, label] of [["win", "战斗胜利"], ["lose", "战斗失败"], ["retreat", "队伍撤退"]]) {
    await page.evaluate(outcome => { fixture.view.packet.result = { outcome, grade: { grade: "D", score: 37, xpMult: 0.8 } }; fixture.set({ screen: "ended" }); }, outcome);
    const text = await page.locator(".ol-result").innerText();
    assert.match(text, new RegExp(label)); assert.match(text, /评价 D · 37 分/); assert.match(text, /经验倍率 ×0.8/);
    assert.equal(await page.locator('[data-online="actor"], [data-online="endTurn"]').count(), 0);
  }
  await page.evaluate(() => { fixture.view.packet.systemNotice = "房主遇到处理错误，请等待主持人确认后继续"; fixture.emit(); });
  assert.match(await page.locator("#online-stage").innerText(), /房主遇到处理错误，请等待主持人确认后继续/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: earlier private history is paginated, merged by ID and never toasted as new", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page, { messages: [{ id: "msg-101", from: "gm", to: "p1", text: "当前消息" }] });
  await page.evaluate(() => {
    OnlineGame.messageHistory = async request => {
      fixture.calls.push({ kind: "history", args: request });
      return { type: "messageHistory", displayOnly: true, hasMore: request.beforeId === "msg-101", messages: request.beforeId === "msg-101" ? [
        { id: "msg-1", from: "gm", to: "p1", text: "早先的私信" }, { id: "msg-101", from: "gm", to: "p1", text: "当前消息" }
      ] : [] };
    }; fixture.emit();
  });
  await page.click('[data-online="openRoom"]'); await page.click('[data-online="messageHistory"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "history").args, { beforeId: "msg-101" });
  assert.deepEqual(await page.locator("[data-message-id]").evaluateAll(rows => rows.map(r => r.dataset.messageId)), ["msg-1", "msg-101"]);
  assert.equal(await page.isVisible("#online-toast"), false);
  await page.click('[data-online="messageHistory"]');
  assert.deepEqual((await calls(page)).filter(c => c.kind === "history").at(-1).args, { beforeId: "msg-1" });
  assert.equal(await page.locator('[data-online="messageHistory"]').count(), 0);
  assert.match(await page.locator(".ol-messages").innerText(), /消息保存在主持人设备；私信仅双方可见/);
  await page.evaluate(() => fixture.set({ messages: [{ id: "msg-102", from: "gm", to: "p1", text: "新到的消息" }] }));
  assert.deepEqual(await page.locator("[data-message-id]").evaluateAll(rows => rows.map(r => r.dataset.messageId)), ["msg-1", "msg-101", "msg-102"]);
  assert.match(await page.locator("#online-toast").innerText(), /新到的消息/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: a late history page cannot enter another room", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page, { messages: [{ id: "msg-2", from: "gm", to: "p1", text: "原房间" }] });
  await page.evaluate(() => { OnlineGame.messageHistory = () => new Promise(resolve => { fixture.resolveHistory = resolve; }); fixture.emit(); });
  await page.click('[data-online="openRoom"]'); await page.click('[data-online="messageHistory"]');
  await page.evaluate(() => {
    fixture.set({ roomCode: "NEXT23", messages: [] });
    fixture.resolveHistory({ type: "messageHistory", displayOnly: true, hasMore: false, messages: [{ id: "msg-1", from: "gm", to: "p1", text: "过期私信" }] });
  });
  assert.doesNotMatch(await page.locator(".ol-messages").innerText(), /原房间|过期私信/);
  assert.equal(await page.isVisible("#online-toast"), false);
  assert.deepEqual(o.errors, []);
});

test("D3 display: resync restarts pagination at the new window after a long disconnect", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page, { messages: [{ id: "msg-1", from: "gm", to: "p1", text: "旧段一" }, { id: "msg-2", from: "gm", to: "p1", text: "旧段二" }] });
  await page.evaluate(async () => {
    OnlineGame.messageHistory = async request => { fixture.calls.push({ kind: "history", args: request }); return { type: "messageHistory", displayOnly: true, hasMore: true, messages: [{ id: "msg-399", from: "gm", to: "p1", text: "恢复缺口" }] }; };
    const packet = JSON.parse(JSON.stringify(fixture.view.packet));
    Object.assign(packet, { type: "resync", displayOnly: true, screen: "battle", messages: [{ id: "msg-400", from: "gm", to: "p1", text: "最新窗口" }] });
    // The real coordinator installs packet.messages before notifying observers.
    for (const fn of fixture.packets) await fn(packet);
    Object.assign(fixture.view, { packet, state: packet.state, messages: packet.messages }); fixture.emit();
  });
  assert.equal(await page.isVisible("#online-toast"), false);
  await page.click('[data-online="openRoom"]'); await page.click('[data-online="messageHistory"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "history").args, { beforeId: "msg-400" });
  assert.deepEqual(await page.locator("[data-message-id]").evaluateAll(rows => rows.map(r => r.dataset.messageId)), ["msg-399", "msg-400"]);
  assert.deepEqual(o.errors, []);
});

test("D3 display: 房间码可以一键复制；粘贴带空格 / 小写的房间码也能加入", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await page.getByRole("button", { name: /联机开房/ }).click();
  await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "测试主持");
  await page.click('[data-online="connect"]');
  await page.getByRole("button", { name: /消息与成员/ }).click().catch(() => {});
  // 记下被复制的文字：有剪贴板接口时截住 writeText，没有时（本地文件 / 非安全来源）走选中文字 + copy 事件
  await page.evaluate(() => {
    window.__copied = null;
    if (navigator.clipboard) navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    document.addEventListener("copy", () => { const a = document.activeElement; window.__copied = a && "value" in a ? a.value : String(getSelection()); });
  });
  const copy = page.locator('[data-online="copyCode"]');
  assert.equal(await copy.count(), 1, "房间面板上有复制按钮");
  await copy.click();
  await page.waitForFunction(() => /已复制房间码 ABCD23|无法自动复制/.test(document.body.textContent));
  assert.match(await page.textContent("body"), /已复制房间码 ABCD23/);
  assert.equal(await page.evaluate(() => window.__copied), "ABCD23");
  // 房间码文字本身可以整段选中
  assert.equal(await page.locator(".ol-code").first().evaluate(e => getComputedStyle(e).userSelect), "all");
  assert.deepEqual(o.errors, []);
});

test("D3 display: 加入时去掉粘贴进来的空格和标点", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await page.getByRole("button", { name: /加入房间/ }).click();
  await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "路人乙"); await page.fill("#ol-code", " abcd-23 ");
  await page.click('[data-online="connect"]');
  assert.equal((await calls(page)).find(c => c.kind === "join").args.roomCode, "ABCD23");
  assert.deepEqual(o.errors, []);
});
