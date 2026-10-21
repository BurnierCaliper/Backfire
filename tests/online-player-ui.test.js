// 联机玩家画面（#akane part 1）：长休时间、和主持人共用的队伍卡（不带坚毅）、主持人皮肤、夜晚色调、一人多角色
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
  for (const file of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "party-cards.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  return { page, errors };
}
async function player(page, patch = {}) { await page.evaluate(patch => fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle", ...patch }), patch); }
const calls = page => page.evaluate(() => fixture.calls);
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..");
const PC = require("../party-cards.js");
const OV = require("../online-view.js");
// 房主那边的英雄（带坚毅生命，数值故意取得很显眼）
const heroRaw = (id, kit, name) => ({ id, kit, name, level: 3, xp: 40, def: 5, defMax: 6, atk: 7, shp: 9137, shpMax: 9241, linkedKits: [kit + "_w"], weaponLevels: { [kit + "_w"]: 2 } });
const partyFixture = () => [
  { id: "a", kit: "ruby", name: "红玉", level: 3, hp: 26, hpMax: 35, atk: 7, def: 5, defMax: 6, block: 40, xp: 40, xpNext: 100, attrPoints: 0, featPoints: 0, feats: [], weapons: [{ kit: "torque", name: "扭矩", level: 2, bond: 1, dur: 4, max: 6 }, { kit: "spare", name: "备用刀", level: 1, bond: 0, dur: 0, max: 5 }] },
  { id: "b", kit: "fei", name: "绯秋", level: 2, hp: 20, hpMax: 30, atk: 5, def: 4, defMax: 4, block: null, xp: 10, xpNext: 60, attrPoints: 0, featPoints: 0, feats: [], weapons: [{ kit: "bow", name: "长弓", level: 1, bond: 0, dur: 6, max: 6 }] },
  { id: "c", kit: "kolt", name: "柯尔特", level: 2, hp: 18, hpMax: 28, atk: 6, def: 4, defMax: 4, block: 25, xp: 0, xpNext: 60, attrPoints: 0, featPoints: 0, feats: [], weapons: [] }];

test("队伍卡：玩家那份（heroDto gm:false）根本没有坚毅字段；主持人那份有，并且只有主持人卡片画「坚毅」一行", () => {
  const p = PC.heroDto(heroRaw("a", "ruby", "红玉"), { gm: false }), g = PC.heroDto(heroRaw("a", "ruby", "红玉"), { gm: true });
  assert.equal("shp" in p, false); assert.equal("shpMax" in p, false);
  assert.equal(g.shp, 9137);
  assert.doesNotMatch(PC.heroCardHtml(p, { gm: false }), /坚毅|9137|9241/);
  assert.doesNotMatch(PC.heroCardHtml(g, { gm: false }), /坚毅|9137/, "就算数据里有，玩家版也不画");
  assert.match(PC.heroCardHtml(g, { gm: true }), /坚毅 <span>9137\/9241<\/span>/);
});

test("队伍卡白名单：online-view.js · projectParty 丢掉坚毅（房主就算误带也发不出去）；整个玩家包里没有坚毅数值", () => {
  const leaky = partyFixture().map(h => ({ ...h, shp: 9137, shpMax: 9241, note: "坚毅生命 9137" }));
  const out = OV.projectPacket({ type: "state", party: leaky, clock: { day: 3, clock: 1290, hours: 22.5 } }, { recipientId: "p1", gmId: "gm" });
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /shp|9137|9241|坚毅/);
  assert.equal(out.party.length, 3); assert.deepEqual(out.party[0].weapons.map(w => [w.name, w.dur, w.max]), [["扭矩", 4, 6], ["备用刀", 0, 5]]);
  assert.deepEqual(out.clock, { day: 3, clock: 1290, hours: 22.5 });
  const html = out.party.map(h => PC.heroCardHtml(h, { gm: false })).join("");
  assert.doesNotMatch(html, /坚毅|9137/);
  assert.match(html, /扭矩 Lv2 · 羁绊 1 · 耐久 4\/6/); assert.match(html, /备用刀 Lv1 · 耐久 0\/5（损坏）/); assert.match(html, /血量 <span>26\/35/);
});

test("时钟：和主持人顶栏同一句「距上次长休」，过 20 小时带力竭提示；18:00–05:00 算夜晚（和 ledger.js 一致）", () => {
  const h = PC.clockHtml({ day: 2, clock: 14 * 60 + 30, hours: 3 + 20 / 60 });
  assert.match(h, /第 <b>2<\/b> 天 <b class="tr-time">14:30<\/b> 下午 · 距上次长休 <b>3 小时 20 分<\/b>/);
  assert.match(PC.clockHtml({ day: 1, clock: 0, hours: 41 }), /力竭 2/);
  assert.deepEqual([17 * 60 + 59, 18 * 60, 4 * 60 + 59, 5 * 60].map(PC.isNight), [false, true, true, false]);
  const ledger = fs.readFileSync(path.join(ROOT, "ledger.js"), "utf8");
  assert.match(ledger, /nightFrom: 18 \* 60, nightTo: 5 \* 60/, "改了昼夜分界要同时改 party-cards.js");
  // 主持人顶栏 / 左栏和玩家画面用同一个渲染器；房主的包里带 hours 和 party
  const tu = fs.readFileSync(path.join(ROOT, "trpg-ui.js"), "utf8"), og = fs.readFileSync(path.join(ROOT, "online-game.js"), "utf8");
  assert.match(tu, /PartyCards\.clockHtml\(\{ day: LEDGER\.day, clock: LEDGER\.clock, hours: LEDGER\.hours \}\)/);
  assert.match(tu, /PartyCards\.heroCardHtml\(PartyCards\.heroDto\(h, \{ gm: true/);
  assert.match(og, /hours: Number\(LEDGER\.hours\) \|\| 0/); assert.match(og, /PartyCards\.heroDto\(h, \{ gm: false \}\)/);
  assert.ok(fs.readFileSync(path.join(ROOT, "game.html"), "utf8").indexOf('src="party-cards.js"') < fs.readFileSync(path.join(ROOT, "game.html"), "utf8").indexOf('src="trpg-ui.js"'));
});

test("旧的 ol-zones 文字战场删掉了：战斗只走 online-battle.js（和主持人同一套单位卡）", () => {
  const ol = fs.readFileSync(path.join(ROOT, "online-ui.js"), "utf8");
  assert.doesNotMatch(ol, /ol-zones|function gapsMarkup|function zoneGrid|function actionsMarkup/);
});

async function exploration(page, patch) {
  await player(page, { screen: "exploration" });
  await page.evaluate(([party, patch]) => { Object.assign(fixture.view.packet, { party, clock: { day: 2, clock: 600, hours: 5 } }, patch || {}); fixture.emit(); }, [partyFixture(), patch || null]);
}

test("联机跑团玩家探索画面：时钟写距上次长休；队伍卡和主持人同一个渲染器，全部武器带耐久，没有坚毅", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await exploration(page);
  const stage = await page.locator("#online-stage").innerText();
  assert.match(stage, /第 2 天 10:00 上午 · 距上次长休 5 小时/);
  assert.equal(await page.locator("#online-stage .tr-party .rhero").count(), 3);
  assert.match(await page.locator('.rhero[data-hero-kit="ruby"]').innerText(), /扭矩 Lv2 · 羁绊 1 · 耐久 4\/6[\s\S]*备用刀 Lv1 · 耐久 0\/5（损坏）/);
  assert.doesNotMatch(stage, /坚毅/);
  assert.match(await page.locator('.rhero[data-hero-kit="ruby"]').innerText(), /甲（你）/);
  // 主持人的皮肤：舞台是 .ol-skin，按钮是 .g-btn
  assert.equal(await page.locator("#online-stage.ol-skin").count(), 1);
  assert.ok(await page.locator('#online-stage button.g-btn[data-online="info"]').count() > 0);
  assert.deepEqual(o.errors, []);
});

test("一名玩家操控好几名角色：自己的都标（你），可以切换「当前角色」，资料按钮打开对应的那名", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await exploration(page);
  await page.evaluate(() => { const hs = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }, { id: "c", name: "柯尔特", owner: "p1" }];
    fixture.view.packet.view.heroes = hs; fixture.view.packet.view.units = hs; fixture.emit(); });
  assert.equal(await page.locator(".rhero.mine").count(), 2);
  assert.equal(await page.locator('.rhero.focus[data-hero-kit="ruby"]').count(), 1);
  assert.equal(await page.locator('.rhero[data-hero-kit="fei"] [data-online="info"]').count(), 0, "队友的卡没有资料按钮");
  await page.click('.rhero[data-hero-kit="kolt"] [data-online="focusHero"]');
  assert.equal(await page.locator('.rhero.focus[data-hero-kit="kolt"]').count(), 1);
  assert.equal(await page.locator('.rhero[data-hero-kit="kolt"] [data-online="focusHero"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(o.errors, []);
});

test("夜晚色调：packet.clock 在 18:00–05:00 时玩家舞台压暗（跑团和单局都一样），白天去掉", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await exploration(page, { clock: { day: 2, clock: 21 * 60 + 40, hours: 12 } });
  assert.equal(await page.locator("#online-stage.is-night").count(), 1);
  await page.evaluate(() => { fixture.view.packet.clock = { day: 3, clock: 8 * 60, hours: 0 }; fixture.emit(); });
  assert.equal(await page.locator("#online-stage.is-night").count(), 0);
  // 联机单局：同一个 packet.clock
  await page.evaluate(() => { fixture.view.packet.mode = "rogue"; fixture.view.packet.clock = { day: 1, clock: 2 * 60, hours: 3 }; fixture.emit(); });
  assert.equal(await page.locator("#online-stage.is-night").count(), 1);
  // 战场上的区域也压暗（和 game.css 的 .g-app.is-night .g-zone 一样）
  await page.evaluate(() => { fixture.view.packet.mode = "trpg"; fixture.view.packet.clock = { day: 1, clock: 23 * 60, hours: 3 }; fixture.set({ screen: "battle" }); });
  await page.waitForSelector("#online-stage .g-zone");
  assert.match(await page.locator("#online-stage .g-zone").first().evaluate(e => getComputedStyle(e).boxShadow), /inset/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#online-stage .g-field"), "::after").content), '""', "战场四周暗角");
  assert.deepEqual(o.errors, []);
});

test("390px：标题下的工具按钮换行排成格子，一个都不被截掉，按钮高度 ≥ 44px（探索和战斗）", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await exploration(page);
  const check = async label => {
    const r = await page.evaluate(() => {
      const box = document.querySelector("#online-stage .ol-stage-heading .ol-info-tools"), bb = box.getBoundingClientRect();
      const btns = [...box.querySelectorAll("button")].filter(b => b.offsetParent);
      return { n: btns.length, rows: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size, scroll: box.scrollWidth - box.clientWidth,
        clipped: btns.filter(b => { const r = b.getBoundingClientRect(); return r.left < bb.left - 1 || r.right > bb.right + 1 || r.right > innerWidth || b.scrollWidth > b.clientWidth + 1; }).map(b => b.textContent),
        minH: Math.min(...btns.map(b => b.getBoundingClientRect().height)), page: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.ok(r.n >= 6, label); assert.ok(r.rows >= 2, label + " 换行"); assert.equal(r.scroll, 0, label + " 不横滑");
    assert.deepEqual(r.clipped, [], label + " 没有被截的按钮"); assert.ok(r.minH >= 44, label + " 高度 " + r.minH); assert.ok(r.page, label);
  };
  await check("探索");
  await page.evaluate(() => fixture.set({ screen: "battle" })); await page.waitForSelector("#online-stage .g-zone");
  await check("战斗");
  assert.deepEqual(o.errors, []);
});
