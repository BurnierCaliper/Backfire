// 联机玩家「背包」/「钱包与商店」分工：背包 = 共用背包浮层（backpack-ui.js）列全部道具；钱包与商店 = 钱和花钱的地方，不再重复列道具。
// 截图：BAG_SHOTS=目录 时写 before/after 对比用的图（不提交）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execSync } = require("node:child_process");
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
const SHOTS = process.env.BAG_SHOTS || null;
let browser;
test.before(async () => { try { browser = await playwright().chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function open(t, mobile = false) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app">Original host battlefield</main></body>');
  for (const file of ["game.css", "skin.css", "online.css", "workshop.css", "backpack.css"]) await page.addStyleTag({ path: path.resolve(__dirname, "..", file) });
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
  for (const file of ["items.js", "inventory.js", "workshop-data-adapter.js", "backpack-ui.js", "hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  return { page, errors };
}
async function player(page, patch = {}) { await page.evaluate(patch => fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle", ...patch }), patch); }
const calls = page => page.evaluate(() => fixture.calls);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); };
async function withBag(page, screen = "exploration") {
  await player(page, { screen });
  await page.evaluate(() => {
    fixture.view.state.kuizhi = 520;
    fixture.view.state.units[0].grit = 7; fixture.view.state.units[0].gritMax = 9;
    fixture.view.state.bag = { water: 1200, items: [{ id: "medkit", qty: 3 }, { id: "bomb_e", qty: 2 }, { id: "cm_scrap", qty: 4 }] };
    fixture.emit();
  });
}
const noGrit = async page => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /坚毅生命\s*[:：]?\s*\d|gritMax|"grit"/);

for (const mobile of [false, true]) {
  test(`跑团玩家（${mobile ? "390" : "桌面"}）：「背包」打开共用背包浮层，按类分好；「钱包与商店」只有钱和花钱的地方`, async t => {
    const o = await open(t, mobile); if (!o) return; const { page } = o; await withBag(page);
    const tag = mobile ? "390" : "1280";
    const sup = page.locator('[data-online="supplies"]');
    assert.match(await sup.innerText(), /钱包与商店/);
    await sup.click();
    const shown = await page.locator("#online-supplies").innerText();
    assert.match(shown, /钱和花钱的地方/); assert.match(shown, /道具在「背包」/); assert.match(shown, /奎支 520/);
    assert.doesNotMatch(shown, /简易医疗包|电手榴弹|废料|队伍公共物资|水 1200/, "不再重复列道具");
    await noGrit(page); await shot(page, `after-supplies-${tag}.png`);
    await page.click('[data-online="suppliesClose"]');
    const bagBtn = page.locator('#online-stage [data-online="info"][data-info="bag"]').first();
    if (mobile) for (const b of [bagBtn, sup]) assert.ok((await b.boundingBox()).height >= 44, "按钮至少 44px 高");
    await bagBtn.click();
    const bp = page.locator("#bp-overlay");
    await bp.waitFor();
    assert.equal(await bp.evaluate(el => el.classList.contains("ovl")), true);
    assert.match(await bp.innerText(), /废料\s*×\s*4/, "打开就停在有东西的第一个标签（材料）");
    if (mobile) for (const b of await page.locator("#bp-overlay .bp-tab, #bp-overlay .g-btn").all()) assert.ok((await b.boundingBox()).height >= 44, "背包标签 / 关闭 44px");
    await page.click('#bp-overlay [data-bp-tab="consumable"]');
    const txt = await bp.innerText();
    assert.match(txt, /水 1200 ml/); assert.match(txt, /钱在「钱包与商店」/);
    assert.match(txt, /简易医疗包/); assert.match(txt, /1d4\+6/, "带道具说明");
    assert.equal(await page.locator('#bp-overlay [data-bp-tab="material"] small').innerText(), "1");
    assert.equal(await page.locator('#bp-overlay [data-bp-tab="consumable"] small').innerText(), "2");
    await noGrit(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(page, `after-bag-${tag}.png`);
    // 房主加了医疗包：开着的浮层跟着更新
    await page.evaluate(() => { fixture.view.state.bag.items[0].qty = 5; fixture.emit(); window.BackpackUI.refresh(); });
    assert.match(await bp.innerText(), /简易医疗包\s*×\s*5/);
    assert.deepEqual(o.errors, []);
  });
}

test("跑团玩家：战斗中背包只读、不收起、不挂到被隐藏的 #g-app 上", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await withBag(page, "battle");
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.locator("#bp-overlay").waitFor();
  assert.equal(await page.evaluate(() => document.getElementById("bp-overlay").parentNode === document.body), true);
  assert.equal(await page.evaluate(() => window.BackpackUI.inBattleMode()), true, "换画面不自动收起");
  assert.equal(await page.locator("#bp-overlay [data-bp-workshop]").count(), 0, "只读：没有去工坊");
  await noGrit(page); await shot(page, "after-bag-battle-390.png");
  assert.deepEqual(o.errors, []);
});

test("联机单局玩家：背包只在标题栏一个入口，正文不再有重复的「背包」按钮", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await player(page, { screen: "exploration" });
  const rogue = { stage: "camp", act: 1, region: "荒原", day: 3, daysLeft: 4, daysPerAct: 7, supplies: { water: 1000, food: 3, hours: 5 }, workshopAvailable: true,
    heroes: [{ kit: "kolt", name: "柯尔特", mine: true, level: 2, hp: 30, hpMax: 30, xp: 0, purse: 120, ownerName: "甲", weapons: [] }], items: { medkit: 2 }, vote: { options: [] } };
  await page.evaluate(r => { fixture.view.mode = "rogue"; fixture.view.packet = Object.assign(fixture.view.packet, { mode: "rogue", rogue: r }); fixture.emit(); }, rogue);
  assert.equal(await page.locator('[data-online="rogueBackpack"]').count(), 0);
  assert.ok(await page.locator('[data-online="info"][data-info="bag"]').count() >= 1);
  assert.match(await page.locator('[data-online="supplies"]').innerText(), /钱包与商店/);
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.locator("#bp-overlay").waitFor();
  await noGrit(page); await shot(page, "after-bag-rogue-390.png");
  assert.deepEqual(o.errors, []);
});
