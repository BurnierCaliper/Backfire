// 申请检定界面（check-request-ui.js，规则 PR #193）：玩家申请 / 撤回 / 看结果，主持人批准（定难度）/ 拒绝
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
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><section id="scr-title"><div class="t-menu"></div></section><main class="g-app">Original host battlefield</main></body>');
  for (const file of ["game.css", "skin.css", "online.css", "workshop.css"]) await page.addStyleTag({ path: path.resolve(__dirname, "..", file) });
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
  for (const file of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-battle.js", "check-request-ui.js", "online-ui.js"]) await page.addScriptTag({ path: path.resolve(__dirname, "..", file) });
  return { page, errors };
}
async function player(page, patch = {}) { await page.evaluate(patch => fixture.set({ active: true, isHost: false, identity: { id: "p1" }, screen: "battle", ...patch }), patch); }
const calls = page => page.evaluate(() => fixture.calls);
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..");
const OV = require("../online-view.js");
const CR = require("../check-request-ui.js");

test("白名单：checkRequests 里混进坚毅生命 / 主持人备注也发不到玩家；界面只画熟练项、说明、状态、公开结果", () => {
  const view = { checkRequests: [{ id: "ckreq-1", unitId: "a", unitName: "红玉", operatorId: "p1", prof: "侦察", note: "看看门后", status: "approved", checkId: "check-2", shp: 9137, gmNote: "坚毅生命 9137" }],
    checks: [{ id: "check-2", prof: "侦察", diffName: "困难", status: "done", targets: [{ unitId: "a", name: "红玉", base: 0.4, result: { ok: true, rolls: [{ roll: 23 }] }, shp: 9137 }] }] };
  const out = OV.projectView(view, { recipientId: "p1", gmId: "gm" });
  assert.doesNotMatch(JSON.stringify(out.checkRequests), /9137|坚毅|gmNote/);
  const html = CR.playerHtml({ own: "p1", units: [{ id: "a", name: "红玉", kit: "ruby" }], requests: out.checkRequests, checks: out.checks, form: { unit: "", prof: "", note: "" } });
  assert.doesNotMatch(html, /9137|坚毅/);
  assert.match(html, /已同意/); assert.match(html, /困难（成功率 40%）· <b class="ol-ok">成功<\/b> · d100 23/);
});

test("界面文件：浮层带 .ovl；game.html 先载 check-request-ui.js 再载 online-ui.js；online-ui 只挂一个入口", () => {
  const src = fs.readFileSync(path.join(ROOT, "check-request-ui.js"), "utf8"), html = fs.readFileSync(path.join(ROOT, "game.html"), "utf8");
  assert.match(src, /className = "ol-ui ol-overlay ol-bag ovl crq"/);
  assert.ok(html.indexOf('src="check-request-ui.js"') > 0 && html.indexOf('src="check-request-ui.js"') < html.indexOf('src="online-ui.js"'));
  assert.match(fs.readFileSync(path.join(ROOT, "online-ui.js"), "utf8"), /CheckRequestUI\.mount\(/);
});

async function setup(page, isHost, requests, extra) {
  await page.evaluate(([isHost, requests, extra]) => {
    window.PROFICIENCIES = { "侦察类": ["侦察", "潜行"], "交涉类": ["说服"] };
    window.ROGUE_CHECKS = { diffs: { easy: { name: "简单" }, normal: { name: "普通" }, hard: { name: "困难" }, extreme: { name: "极难" } }, chance: [[0.5, 0.3, 0.15, 0.05], [0.7, 0.5, 0.3, 0.1], [0.9, 0.7, 0.5, 0.2], [1, 0.9, 0.7, 0.4]] };
    window.heroProfile = kit => ({ profs: kit === "ruby" ? { 侦察: 2 } : {} });
    fixture.view.state.units[0].kit = "ruby"; fixture.view.state.units[1].kit = "fei";
    const hs = fixture.view.packet.view; hs.checkRequests = requests; Object.assign(hs, extra || {});
    fixture.set({ active: true, isHost, identity: { id: isHost ? "gm" : "p1" }, screen: "exploration" });
  }, [isHost, requests, extra || null]);
}
const submits = page => page.evaluate(() => fixture.calls.filter(c => c.kind === "submit").map(c => c.args));

test("玩家：标题栏「申请检定」→ 选自己的角色（好几名都能选）、熟练项、说明，提交 checkRequest；按钮 ≥44px，390px 不横向溢出", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await setup(page, false, []);
  // 一人两名角色
  await page.evaluate(() => { const hs = fixture.view.packet.view; hs.units = hs.heroes = [{ id: "a", name: "红玉", owner: "p1" }, { id: "b", name: "绯秋", owner: "p1" }]; fixture.emit(); });
  await page.click('#online-stage [data-crq="open"]');
  assert.equal(await page.isVisible("#online-check-req"), true);
  assert.deepEqual(await page.locator("#crq-unit option").allTextContents(), ["红玉", "绯秋"]);
  assert.match(await page.locator("#crq-prof").innerText(), /侦察（二级熟练）/);
  await page.selectOption("#crq-unit", "b"); await page.selectOption("#crq-prof", "说服"); await page.fill("#crq-note", "让守卫放行");
  const h = await page.locator('[data-crq="send"]').evaluate(e => e.getBoundingClientRect().height);
  assert.ok(h >= 44, "按钮高度 " + h);
  await page.click('[data-crq="send"]');
  assert.deepEqual((await submits(page)).at(-1), { type: "checkRequest", unitId: "b", prof: "说服", note: "让守卫放行" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(o.errors, []);
});

test("玩家：申请的状态——等主持人（可撤回、同一角色不能再提）/ 已同意（公开结果）/ 没同意；队友的结果也看得到", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  const reqs = [
    { id: "r1", unitId: "a", unitName: "红玉", operatorId: "p1", prof: "侦察", note: "", status: "pending" },
    { id: "r2", unitId: "a", unitName: "红玉", operatorId: "p1", prof: "潜行", note: "", status: "rejected" },
    { id: "r3", unitId: "a", unitName: "红玉", operatorId: "p1", prof: "说服", note: "", status: "approved", checkId: "c1" },
    { id: "r4", unitId: "b", unitName: "绯秋", operatorId: "p2", prof: "侦察", note: "", status: "approved", checkId: "c2" }];
  const checks = [{ id: "c1", prof: "说服", diffName: "普通", status: "done", targets: [{ unitId: "a", name: "红玉", base: 0.3, result: { ok: false, rolls: [{ roll: 77 }] } }] },
    { id: "c2", prof: "侦察", diffName: "简单", status: "done", targets: [{ unitId: "b", name: "绯秋", base: 0.5, result: { ok: true, rolls: [{ roll: 4 }] } }] }];
  await setup(page, false, reqs, { checks });
  assert.match(await page.locator('#online-stage [data-crq="open"]').innerText(), /申请检定 · 等待 1/);
  await page.click('#online-stage [data-crq="open"]');
  const text = await page.locator("#online-check-req").innerText();
  assert.match(text, /侦察[\s\S]*等主持人/); assert.match(text, /潜行[\s\S]*主持人没有同意/); assert.match(text, /说服[\s\S]*已同意[\s\S]*失败 · d100 77/);
  assert.match(text, /队友的检定结果[\s\S]*绯秋[\s\S]*成功 · d100 4/);
  assert.equal(await page.locator('[data-crq="send"]').isDisabled(), true, "红玉还有一条在等");
  await page.click('[data-req-id="r1"] [data-crq="cancel"]');
  assert.deepEqual((await submits(page)).at(-1), { type: "checkDecide", requestId: "r1", decision: "cancel" });
  assert.deepEqual(o.errors, []);
});

test("主持人：有待处理申请时左下角「检定申请 · N」；浮层里每条选难度（带成功率）批准 / 拒绝", async t => {
  const o = await open(t, true); if (!o) return; const { page } = o;
  await setup(page, true, [{ id: "r1", unitId: "a", unitName: "红玉", operatorId: "p1", prof: "侦察", note: "看看门后", status: "pending" },
    { id: "r2", unitId: "b", unitName: "绯秋", operatorId: "p2", prof: "说服", note: "", status: "pending" }]);
  await page.waitForSelector(".crq-pill:not([hidden])");
  assert.equal(await page.locator(".crq-pill").innerText(), "检定申请 · 2");
  const pill = await page.locator(".crq-pill").evaluate(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: r.width, h: r.height, left: r.left, bottom: innerHeight - r.bottom, vw: innerWidth, vh: innerHeight, bg: cs.backgroundColor, z: cs.zIndex }; });
  assert.ok(pill.w < pill.vw / 2 && pill.h < pill.vh / 2, `左下角的小按钮，不能变成整屏遮罩：${JSON.stringify(pill)}`);
  assert.ok(pill.left <= 20 && pill.bottom <= 20, `贴在左下角：${JSON.stringify(pill)}`);
  assert.equal(pill.z, "95");
  await page.click(".crq-pill");
  const r1 = page.locator('[data-req-id="r1"]');
  assert.match(await r1.innerText(), /红玉「侦察」二级熟练（看看门后） · 甲/);
  assert.match(await r1.locator("select").innerText(), /困难（成功率 50%）/);
  await r1.locator("select").selectOption("hard");
  await r1.locator('[data-crq="approve"]').click();
  await page.locator('[data-req-id="r2"] [data-crq="reject"]').click();
  assert.deepEqual((await submits(page)).slice(-2), [{ type: "checkDecide", requestId: "r1", decision: "approve", diff: "hard" }, { type: "checkDecide", requestId: "r2", decision: "reject" }]);
  for (const sel of ['[data-crq="approve"]', '[data-crq="reject"]']) assert.ok(await r1.locator(sel).evaluate(e => e.getBoundingClientRect().height) >= 44);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(o.errors, []);
});

test("联机单局不出现申请检定（规则只在跑团）", async t => {
  const o = await open(t); if (!o) return; const { page } = o;
  await setup(page, false, []);
  await page.evaluate(() => { fixture.view.packet.mode = "rogue"; fixture.emit(); });
  assert.equal(await page.locator('#online-stage [data-crq="open"]').count(), 0);
  assert.equal(await page.locator('.crq-pill').isVisible(), false);
});
