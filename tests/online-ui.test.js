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
  await page.click(".ol-relay summary"); await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "测试主持");
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
  // 结束行动：还有行动点没用时先确认（PR #40）
  // 游戏内确认框（8c5cd5c 起不再用浏览器原生 confirm()）
  await page.click(".ol-battle .endturn");
  await page.waitForSelector('[data-confirm="yes"]');
  const asked = await page.evaluate(() => document.querySelector('[data-confirm="yes"]').closest(".ol-card").innerText);
  await page.click('[data-confirm="yes"]');
  await page.waitForFunction(() => fixture.calls.some(c => c.kind === "submit" && c.args.type === "endTurn"));
  assert.match(asked, /确定结束行动/);
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

test("D3 display: 房主发来的专属演出照着播——协助攻击推镜头，敌人倒下先留着（带红叉）、这一下演完再淡出", async t => {
  const o = await open(t); if (!o) return; const { page } = o; await player(page);
  await page.addScriptTag({ path: path.resolve(__dirname, "..", "attack-fx.js") });
  await page.evaluate(() => {
    window.__seen = { focus: false, held: false, pre: 0, ko: 0 };
    const L = AttackFx.script("laser"), pre = L.pre;
    L.pre = function () { window.__seen.pre++; return pre.apply(this, arguments); };
    const ko = AttackFx.ko; AttackFx.ko = function () { window.__seen.ko++; return ko.apply(this, arguments); };
    new MutationObserver(() => {
      if (document.querySelector(".ol-battle.assist-focus")) window.__seen.focus = true;
      const c = document.querySelector('[data-unit-id="enemy"]');
      if (c && c.classList.contains("dead") && c.classList.contains("ko-held") && getComputedStyle(c).opacity === "1") window.__seen.held = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    const packet = JSON.parse(JSON.stringify(fixture.view.packet)); packet.type = "result"; packet.displayOnly = true; packet.screen = "battle";
    const dead = packet.state.units.map(u => u.id === "enemy" ? { ...u, dead: true, layers: [{ type: "flesh", current: 0, max: 35 }] } : u);
    packet.tape = [{ type: "pop", unitId: "enemy", kind: "dmg", value: 30, main: true, element: "energy", snap: dead }];
    packet.fx = { actor: "a", target: "enemy", move: { kind: "bolt", el: "energy" }, script: "laser", assist: true };
    packet.state = { ...packet.state, units: dead };
    fixture.playing = fixture.receive(packet);
  });
  await page.evaluate(() => fixture.playing);
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__seen), { focus: true, held: true, pre: 1, ko: 1 });
  const after = await page.evaluate(() => {
    const c = document.querySelector('[data-unit-id="enemy"]');
    return { focus: !!document.querySelector(".ol-battle.assist-focus"), held: !!(c && c.classList.contains("ko-held")), anims: [...document.querySelectorAll(".ol-battle .g-field > *, .ol-battle .g-hud")].reduce((n, el) => n + el.getAnimations().length, 0) };
  });
  assert.deepEqual(after, { focus: false, held: false, anims: 0 }, "演完拉回原样、放开淡出");
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

test("联机跑团主持人：大厅里勾选队员换人；探索时顶栏有「角色分配」入口；战斗中说明不能改", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await page.evaluate(() => {
    OnlineGame.partyChoices = () => [{ kit: "ruby", name: "瑞比", on: true }, { kit: "hiaki", name: "绯秋", on: true }, { kit: "kolt", name: "柯尔特", on: false }];
    OnlineGame.setParty = kits => { fixture.calls.push({ kind: "setParty", args: kits }); return { ok: true }; };
    fixture.set({ active: true, isHost: true, identity: { id: "gm" }, screen: "lobby" });
  });
  await page.waitForSelector("[data-party-kit=kolt]");
  await page.check("[data-party-kit=kolt]"); await page.uncheck("[data-party-kit=ruby]");
  await page.click('[data-online="setParty"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "setParty").args, ["hiaki", "kolt"]);
  await page.evaluate(() => fixture.set({ screen: "exploration" }));
  await page.click('[data-online="openAssign"]');
  assert.equal(await page.isVisible("#ol-assign-head"), true);
  assert.equal(await page.locator("[data-assign]").count(), 2);
  await page.evaluate(() => fixture.set({ screen: "battle" }));
  assert.equal(await page.locator('[data-online="openAssign"]').count(), 0);
  // 面板还开着（刚才点开的）：战斗中只写说明，没有分配下拉框
  assert.match(await page.locator("#online-panel").innerText(), /战斗中不能改角色分配/);
  assert.equal(await page.locator("[data-assign]").count(), 0);
  assert.deepEqual(o.errors, []);
});

test("加入房间只要填房间码：转发服务默认用 Backfire 的那个；本机存不了昵称也不报错", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await page.getByRole("button", { name: /加入房间/ }).click();
  assert.equal(await page.isVisible("#ol-url"), false, "转发服务地址收起来了");
  await page.fill("#ol-name", "夕夏"); await page.fill("#ol-code", "abcd23");
  await page.click('[data-online="connect"]');
  assert.deepEqual((await calls(page)).find(c => c.kind === "join").args, { url: "https://backfire-relay.richardguu22.workers.dev", name: "夕夏", roomCode: "ABCD23" });
  // 这个测试页面不让用 localStorage：存不了也不报错（o.errors 为空），昵称照常发出去
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(o.errors, []);
});

test("D3 display: join form, lobby public chat and public field changes use the presentation contract", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await page.getByRole("button", { name: /加入房间/ }).click();
  await page.click(".ol-relay summary"); await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "路人甲"); await page.fill("#ol-code", "abcd23");
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
  assert.doesNotMatch(await page.locator("#online-stage").innerText(), /队伍公共物资/, "物资收进弹窗，不压在舞台上");
  await page.click('[data-online="supplies"]');
  let shown = await page.locator("#online-supplies").innerText();
  assert.match(shown, /奎支 520/); assert.match(shown, /水 1200 ml/); assert.match(shown, /罐头食品 × 3/);
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /经验 125/);
  assert.match(await page.locator('[data-unit-id="b"]').innerText(), /经验 55/);
  assert.equal(await page.locator('[data-online="actor"]').count(), 0);
  await page.evaluate(() => { fixture.view.state.units[0].xp += 10; fixture.view.state.kuizhi += 20; fixture.view.state.bag.items[0].qty += 1; fixture.emit(); });
  shown = await page.locator("#online-supplies").innerText();
  assert.match(shown, /奎支 540/); assert.match(shown, /罐头食品 × 4/);
  assert.match(await page.locator('[data-unit-id="a"]').innerText(), /经验 135/);
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
  await page.click(".ol-relay summary"); await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "测试主持");
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
  await page.click(".ol-relay summary"); await page.fill("#ol-url", "http://localhost:8799"); await page.fill("#ol-name", "路人乙"); await page.fill("#ol-code", " abcd-23 ");
  await page.click('[data-online="connect"]');
  assert.equal((await calls(page)).find(c => c.kind === "join").args.roomCode, "ABCD23");
  assert.deepEqual(o.errors, []);
});

test("跑团地图：玩家也能打开地图，看到主持人标的队伍位置（只读）", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  for (const file of ["world-data.js", "world-travel.js", "world-map.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  await page.addStyleTag({ path: path.resolve(__dirname, "..", "world-map.css") });
  const place = await page.evaluate(() => WORLD_PLACES[0]);
  await player(page, { screen: "exploration" });
  await page.evaluate(p => { fixture.view.packet.view.map = { place: p.id, x: null, y: null }; fixture.emit(); }, place);
  const btn = page.locator('[data-online="map"]');
  assert.equal(await btn.count(), 1, "探索画面有「地图」按钮");
  await btn.click();
  await page.waitForSelector(".wm.show", { state: "attached" });
  const text = await page.locator(".wm").textContent();
  assert.match(text, new RegExp("队伍在" + place.name));
  // 只读：玩家不能把队伍拖到别处（没有「把队伍移到这里」）
  assert.doesNotMatch(text, /把队伍移到这里/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: 敌人身上的聚焦在玩家画面上写出来（和本地卡片一样）", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page);
  await page.evaluate(() => { fixture.view.state.units[2].focuses = [{ layerType: "flesh", seq: ["fire", "ice", "electric"], step: 1 }]; fixture.emit(); });
  assert.match(await page.locator('#online-stage [data-unit-id="enemy"]').first().innerText(), /聚焦肉体 火→\[冰\]→电/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: 主机发来的状态行、资源、武器耐久、区域预警都画在玩家的战场上", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page);
  await page.evaluate(() => {
    const st = fixture.view.state;
    st.units[2].display = { status: "掩护(红玉) · 无法移动 · 嘲讽", atk: 12 };
    st.units[0].display = { status: "扳机解锁", res: "纳米 40/100 · 机甲中", dur: { cur: 3, max: 5, name: "银翼" } };
    st.zoneView = { 2: { threats: [{ label: "火雨 · 下回合", from: "敌人", ready: false }] } };
    fixture.emit();
  });
  const enemy = await page.locator('#online-stage [data-unit-id="enemy"]').first().innerText();
  assert.match(enemy, /掩护/); assert.match(enemy, /无法移动/); assert.match(enemy, /ATK 12/);
  const mine = await page.locator('#online-stage [data-unit-id="a"]').first().innerText();
  assert.match(mine, /纳米 40\/100/);
  assert.match(await page.locator('#online-stage .g-zone[data-num="2"] .zthreat').innerText(), /火雨/);
  assert.deepEqual(o.errors, []);
});

test("D3 display: 行动结算后舞台不跳回最上面（玩家往下翻着看战场时）", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await player(page);
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) fixture.view.state.units.push({ id: "e" + i, name: "敌" + i, isPlayer: false, zone: 2, level: 1, ap: 1, apMax: 1, bonus: 0, bonusMax: 0, def: 3, defMax: 3, layers: [{ type: "flesh", current: 9, max: 9 }], statuses: {}, resources: {} });
    fixture.emit();
  });
  // 战斗中舞台整体不滚动（战场 + 技能栏一屏放下，和单局一样）；单位多时是战场自己往下翻
  const scroller = "#online-stage .ol-battle .g-field";
  const before = await page.evaluate(sel => { const s = document.querySelector(sel); s.scrollTop = s.scrollHeight; return s.scrollTop; }, scroller);
  assert.ok(before > 200, "战场比可见区域高、已经往下翻了");
  await page.evaluate(() => {
    const p = JSON.parse(JSON.stringify(fixture.view.packet)); p.state = JSON.parse(JSON.stringify(fixture.view.state)); p.screen = "battle";
    p.state.turnNo = 2; p.state.units[2].layers[0].current = 20; p.publicLogs = [...p.publicLogs, { text: "红玉 · 普通攻击" }]; p.view.currentUnitId = "b";
    return fixture.receive(p);
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(sel => document.querySelector(sel).scrollTop, scroller);
  assert.ok(after > before - 200, `滚动位置保留（${before} → ${after}）`);
  assert.deepEqual(o.errors, []);
});

test("offline wait bar shows the remaining seconds before the absent player's turn is skipped", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await player(page, { offlineWait: { name: "乙", deadline: Date.now() + 42000 } });
  await page.waitForFunction(() => /乙 离线，等待其返回（还剩 4[12] 秒，到时间自动跳过）/.test(document.querySelector("#online-pause").textContent));
  assert.deepEqual(o.errors, []);
});

/** 跑团诊所 · 义体的联机包（trpg.js · trpgCyberwarePacket 形状，过 online-view 白名单） */
function trpgCyberwarePacket(installed, purse) {
  const H = require("./headless"), V = require("../online-view");
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CWOUI" });
  c.S.TRPG.active = true; c.S.TRPG.clinicOpen = true;
  c.LEDGER.purse = { kolt: 50000, helu: 3 };
  c.cyberwareLoadExamples();
  if (installed) c.trpgCyberwareInstall("kolt", "example_t5_melee");
  const p = JSON.parse(JSON.stringify(c.trpgCyberwarePacket("kolt")));
  if (purse != null) p.purse = purse;
  return V.projectPacket({ type: "result", cyberware: { heroes: [p] } }, { recipientId: "p1", gmId: "gm" }).cyberware;
}
test("跑团诊所 · 义体：物资弹窗里的入口打开浮层，提交 cyberwareInstall；新包到了重画钱包 / 已装；进战斗收起", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  for (const file of ["workshop.css", "cyberware.css"]) await page.addStyleTag({ path: path.resolve(__dirname, "..", file) });
  await page.addScriptTag({ path: path.resolve(__dirname, "..", "cyberware-ui.js") });
  const before = trpgCyberwarePacket(false), after = trpgCyberwarePacket(true);
  await player(page, { screen: "exploration", mode: "trpg" });
  await page.evaluate(cw => { fixture.view.packet.cyberware = cw; fixture.emit(); }, before);
  assert.match(await page.locator('[data-online="supplies"]').innerText(), /🦾/);
  await page.click('[data-online="supplies"]');
  const entry = page.locator(".ol-trpg-cw");
  assert.match(await entry.innerText(), /钱包 50000 奎支/);
  if (process.env.CW_SHOTS) await page.screenshot({ path: path.resolve(__dirname, "..", "shots", "cyberware-trpg-entry.png") });
  await page.click('[data-online="trpgCyberware"]');
  await page.waitForSelector("#cw-overlay:not([hidden]) .cw-card");
  assert.match(await page.locator("#cw-overlay").innerText(), /手里有 50000 奎支/);
  await page.click('[data-cw-pick="example_t5_melee"]');
  assert.match(await page.locator(".cw-confirm").innerText(), /0% → 40%/);
  await page.click(".cw-confirm [data-cw-cmd]");
  const sent = (await calls(page)).filter(c => c.kind === "submit").pop().args;
  assert.deepEqual(sent, { type: "cyberwareInstall", kit: "kolt", id: "example_t5_melee" });
  // 房主结算后的新包：浮层跟着重画
  await page.evaluate(cw => { fixture.view.packet.cyberware = cw; fixture.emit(); }, after);
  await page.waitForSelector("#cw-overlay .cw-row.on");
  assert.match(await page.locator("#cw-overlay").innerText(), /手里有 47000 奎支/);
  if (process.env.CW_SHOTS) await page.screenshot({ path: path.resolve(__dirname, "..", "shots", "cyberware-trpg-installed.png") });
  await page.click("#cw-overlay .cw-row.on [data-cw-cmd]");
  assert.deepEqual((await calls(page)).filter(c => c.kind === "submit").pop().args, { type: "cyberwareRemove", kit: "kolt", id: "example_t5_melee" });
  // 进战斗：收起
  await page.evaluate(() => fixture.set({ screen: "battle" }));
  assert.equal(await page.locator("#cw-overlay").isHidden(), true);
  assert.deepEqual(o.errors, []);
});
