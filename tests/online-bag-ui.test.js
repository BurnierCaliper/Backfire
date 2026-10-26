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
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
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
  for (const file of ["items.js", "ledger.js", "inventory.js", "workshop-data-adapter.js", "backpack-ui.js", "hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  return { page, errors };
}
async function player(page, patch = {}) { await page.evaluate(patch => fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle", ...patch }), patch); }
const calls = page => page.evaluate(() => fixture.calls);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); };
// 坚毅生命的真实字段是 shp / shpMax（online-view.js · hiddenSheetKey）：设成不会和别的数字撞上的值
async function withBag(page, screen = "exploration") {
  await player(page, { screen });
  await page.evaluate(() => {
    fixture.view.state.kuizhi = 520;
    for (const u of fixture.view.state.units) { u.shp = 4321; u.shpMax = 9876; }
    fixture.view.state.bag = { water: 1200, items: [{ id: "medkit", qty: 3 }, { id: "bomb_e", qty: 2 }, { id: "cm_scrap", qty: 4 }] };
    fixture.emit();
  });
}
// 先去掉道具目录里的说明文字（可以写坚毅生命消耗），剩下的文字里不能有 shp / shpMax 的值，也不能有「坚毅生命 + 数字」
// （例如由剩余值算出来的百分比、扣了多少、前后对比）
const noGrit = async page => {
  for (const sel of ["#bp-overlay", "#online-supplies"]) {
    const txt = await page.evaluate(s => {
      let t = (document.querySelector(s) || {}).innerText || "";
      const hints = Object.values(typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {}).map(v => v && v.hint).filter(Boolean).sort((a, b) => b.length - a.length);
      for (const h of hints) t = t.split(h).join("");
      return t;
    }, sel);
    assert.doesNotMatch(txt, /4321|9876/, `${sel} 不显示玩家当前的坚毅生命（shp / shpMax）`);
    assert.doesNotMatch(txt, /坚毅(生命)?\s*[:：]?\s*[+-]?\d/, `${sel} 除道具说明外不出现「坚毅生命 + 数字」`);
  }
};
const sub = page => page.locator("#bp-overlay .ws-sub").innerText();
const bagOpen = page => page.evaluate(() => { const b = document.getElementById("bp-overlay"); return !!b && !b.hidden; });

// 规则：道具 / 效果说明可以写明坚毅生命的具体消耗 / 恢复量；玩家当前剩余的坚毅生命（shp / shpMax），以及任何能推出剩余值的数字（shpBase / shpBonus、实际扣了多少、前后对比、百分比）绝不给玩家看
test("跑团玩家：背包照原样显示提到坚毅生命消耗的道具说明，但不显示任何人当前的坚毅生命", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await withBag(page);
  await page.evaluate(() => { fixture.view.state.bag.items.push({ id: "food_gourmet", qty: 1 }); fixture.emit(); });
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.click('#bp-overlay [data-bp-tab="consumable"]');
  const txt = await page.locator("#bp-overlay").innerText();
  const hint = await page.evaluate(() => ITEM_CATALOG.food_gourmet.hint);
  assert.match(hint, /坚毅\s*\d|\d\s*坚毅/, "选一条带数字的说明（美食：额外恢复 5 坚毅）");
  assert.ok(txt.includes(hint), "道具说明原样显示，可以提到坚毅生命消耗");
  await noGrit(page);
  assert.deepEqual(o.errors, []);
});

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
    assert.equal(await sub(page), "BACKPACK", "探索中可看可选");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-bp-close")), true, "焦点在「关闭」");
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
    // 房主改了包：只靠收包后的 render，开着的浮层就是这一包（不手动 refresh）
    await page.evaluate(() => { fixture.view.state.bag.items[0].qty = 5; fixture.emit(); });
    assert.match(await bp.innerText(), /简易医疗包\s*×\s*5/);
    await page.evaluate(() => { fixture.view.state.bag.items[0].qty = 6; fixture.emit(); });
    assert.match(await bp.innerText(), /简易医疗包\s*×\s*6/, "每一包都跟上，不慢一包");
    // Esc 关
    await page.keyboard.press("Escape");
    assert.equal(await bagOpen(page), false);
    assert.deepEqual(o.errors, []);
  });
}

test("跑团玩家：战斗中背包只读；换画面不收起；轮到我回应协助 / 格挡时收起，不挡住询问", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await withBag(page, "battle");
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.locator("#bp-overlay").waitFor();
  assert.equal(await page.evaluate(() => document.getElementById("bp-overlay").parentNode === document.body), true, "挂在 body 上（玩家页隐藏了 #g-app）");
  assert.equal(await sub(page), "只读（战斗中）");
  await noGrit(page); await shot(page, "after-bag-battle-390.png");
  // 换画面（战斗 → 结算）：浮层还在
  await page.evaluate(() => { document.body.dataset.screen = "ended"; fixture.set({ screen: "ended" }); });
  await page.waitForTimeout(50);
  assert.equal(await bagOpen(page), true, "换画面不自动收起");
  // 不轮到我的询问：不收
  await page.evaluate(() => { fixture.set({ screen: "battle" }); fixture.view.packet.view.ask = { id: "ask-0", kind: "block", deadline: Date.now() + 20000, waitingNames: ["乙"], eligible: false, options: [] }; fixture.emit(); });
  assert.equal(await bagOpen(page), true);
  // 轮到我：收起
  await page.evaluate(() => { fixture.view.packet.view.ask = { id: "ask-1", kind: "block", deadline: Date.now() + 20000, eligible: true, options: [{ helper: "a", label: "红玉格挡" }] }; fixture.emit(); });
  assert.equal(await bagOpen(page), false, "询问来了，背包浮层收起");
  assert.deepEqual(o.errors, []);
});

test("跑团玩家：离开房间后背包浮层收起，不留在标题画面上", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await withBag(page);
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.locator("#bp-overlay").waitFor();
  await page.evaluate(() => fixture.set({ active: false }));
  assert.equal(await bagOpen(page), false);
  assert.deepEqual(o.errors, []);
});

test("联机单局玩家：背包只在标题栏一个入口；没有「钱包与商店」按钮（钱和商店都在正文）；探索 → 战斗变只读", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o; await player(page, { screen: "exploration" });
  const rogue = { stage: "camp", act: 1, region: "荒原", day: 3, daysLeft: 4, daysPerAct: 7, supplies: { water: 1000, food: 3, hours: 5 }, workshopAvailable: { kits: ["kolt"] },
    heroes: [{ kit: "kolt", name: "柯尔特", mine: true, level: 2, hp: 30, hpMax: 30, xp: 0, purse: 120, ownerName: "甲", weapons: [] }],
    bag: [{ kit: "kolt", shared: { material: [{ id: "cm_scrap", name: "废料", qty: 2, hint: "" }], consumable: [], mod: [], key: [] }, personal: null }],
    cyber: [{ kit: "kolt", name: "柯尔特" }], vote: { options: [] } };
  await page.evaluate(r => { fixture.view.mode = "rogue"; fixture.view.packet = Object.assign(fixture.view.packet, { mode: "rogue", rogue: r }); fixture.emit(); }, rogue);
  assert.equal(await page.locator('[data-online="rogueBackpack"]').count(), 0);
  assert.equal(await page.locator('[data-online="supplies"]').count(), 0, "单局不显示「钱包与商店」");
  await page.locator('[data-online="info"][data-info="bag"]').first().click();
  await page.locator("#bp-overlay").waitFor();
  assert.equal(await sub(page), "BACKPACK");
  await noGrit(page); await shot(page, "after-bag-rogue-390.png");
  await page.evaluate(() => fixture.set({ screen: "battle" }));
  assert.equal(await bagOpen(page), true);
  assert.equal(await sub(page), "只读（战斗中）");
  assert.equal(await page.locator("#bp-overlay [data-bp-workshop]").count(), 0, "战斗中没有「去工坊」");
  assert.equal(await page.locator('#bp-overlay [data-bp-tab="cyber"] small').innerText(), "0", "战斗中不给义体方案（和房主一致）");
  assert.deepEqual(o.errors, []);
});
