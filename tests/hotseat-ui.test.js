// D2 热座组件：真实浏览器操作 DOM，桥接投影是显式 JSON；规则校验另由模型测试覆盖。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
function findPlaywright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
const pw = findPlaywright();
let browser;
test.before(async () => {
  try { if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); }
  catch (error) { if (process.env.REQUIRE_UI === "1") throw error; }
});
test.after(async () => { if (browser) await browser.close(); });
async function open(t, { mobile = false, mount = true } = {}) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><main class="g-app"><button id="g-undo">撤销</button><div id="fixture-field">战场</div></main></body>');
  for (const file of ["game.css", "skin.css", "hotseat.css"]) await page.addStyleTag({ path: path.resolve(__dirname, "..", file) });
  await page.evaluate(() => {
    const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2", gm: false }];
    const heroes = [{ id: "a", name: "夕夏", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }, { id: "c", name: "红玉", owner: "p1" }];
    window.fixture = {
      view: { enabled: true, mode: "trpg", playerId: "p1", hostId: "p1", players, heroes, units: heroes, phase: "setup", order: [], confirmed: [], chat: [] },
      calls: [], listeners: [], reject: "",
      emit() { this.listeners.forEach(fn => fn()); },
      set(data) { Object.assign(this.view, data); this.emit(); }
    };
    window.HotseatGame = {
      getView() { return JSON.parse(JSON.stringify(fixture.view)); },
      configure(data) { fixture.calls.push({ configure: JSON.parse(JSON.stringify(data)) }); fixture.view.players = data.players; fixture.view.mode = data.mode; fixture.emit(); return { ok: true }; },
      switchPlayer(id) { fixture.calls.push({ switchPlayer: id }); fixture.view.playerId = id; fixture.emit(); return { ok: true }; },
      submit(command) { fixture.calls.push(JSON.parse(JSON.stringify(command))); return fixture.reject ? { ok: false, error: fixture.reject } : { ok: true }; },
      disable() { fixture.calls.push({ disable: true }); fixture.set({ enabled: false }); return { ok: true }; },
      subscribe(fn) { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(item => item !== fn); }; }
    };
  });
  await page.addScriptTag({ path: path.resolve(__dirname, "..", "hotseat-ui.js") });
  if (mount) await page.evaluate(() => { window.component = HotseatUI.mount(HotseatGame); });
  return { page, errors };
}
const calls = page => page.evaluate(() => fixture.calls);
const setView = (page, data) => page.evaluate(data => fixture.set(data), data);
async function picking(page) {
  await setView(page, {
    phase: "picking", units: [{ id: "a", name: "夕夏", owner: "p1" }, { id: "w", name: "柏妮尔", owner: "p1" }, { id: "b", name: "绯秋", owner: "p2" }],
    order: [{ actor: "a", name: "夕夏", owner: "p1" }, { actor: null }, { actor: "b", name: "绯秋", owner: "p2" }]
  });
}

test("D2 UI: ordinary single-player creates no hotseat DOM; disabled bridge is inert and teardown restores layout", async t => {
  const o = await open(t, { mount: false }); if (!o) return;
  const { page } = o;
  assert.equal(await page.locator("#hotseat-root").count(), 0, "without ?hotseat=1 the auto-entry stays inactive");
  await page.evaluate(() => { fixture.view.enabled = false; window.component = HotseatUI.mount(HotseatGame); });
  assert.equal(await page.locator("#hotseat-root").count(), 0);
  assert.ok(await page.isVisible("#g-undo"));
  await setView(page, { enabled: true });
  assert.ok(await page.isVisible("#hotseat-root"));
  assert.equal(await page.isVisible("#g-undo"), false);
  await page.evaluate(() => component.destroy());
  assert.equal(await page.locator("#hotseat-root").count(), 0);
  assert.equal(await page.locator(".hs-ui").count(), 0);
  assert.equal(await page.evaluate(() => fixture.listeners.length), 0);
  assert.ok(await page.isVisible("#g-undo"));
  assert.deepEqual(o.errors, []);
});

test("D2 UI: 2–4 operators and a GM's multiple heroes are submitted as complete JSON configuration", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.selectOption("#hs-count", "4");
  await page.fill("#hs-name-0", "团长");
  await page.fill("#hs-name-3", "<img src=x onerror=alert(1)>");
  await page.locator('[data-assignment="a"]').selectOption("p1");
  await page.locator('[data-assignment="b"]').selectOption("p2");
  await page.locator('[data-assignment="c"]').selectOption("p1");
  await page.click('[data-hs="configure"]');
  const config = (await calls(page)).find(call => call.configure).configure;
  assert.equal(config.mode, "trpg");
  assert.equal(config.players.length, 4);
  assert.equal(config.players[0].name, "团长");
  assert.equal(config.players.filter(p => p.gm).length, 1);
  assert.deepEqual(config.assignments, { a: "p1", b: "p2", c: "p1" });
  assert.equal(await page.locator(".hs-ui img").count(), 0, "names are rendered as text");
  assert.equal(await page.isVisible("#hs-panel"), false);
  await page.selectOption("#hs-player", "p2");
  assert.equal((await calls(page)).at(-1).switchPlayer, "p2");
  await page.click('[data-hs="openConfig"]');
  await page.selectOption("#hs-count", "2");
  await page.selectOption("#hs-mode", "coop");
  await page.click('[data-hs="configure"]');
  const coop = (await calls(page)).filter(call => call.configure).at(-1).configure;
  assert.equal(coop.players.length, 2);
  assert.equal(coop.players.some(p => p.gm), false);
  assert.deepEqual(o.errors, []);
});

test("D2 UI: each owned unit picks a slot, conflict errors stay visible, confirmation and force-start stay scoped", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await picking(page);
  assert.equal(await page.locator("#hs-pick-unit option").count(), 2, "the owner can arrange the hero and summoned weapon separately");
  assert.ok(await page.locator('[data-hs="confirm"]').isDisabled());
  await page.selectOption("#hs-pick-unit", "w");
  await page.evaluate(() => { fixture.reject = "已被占用"; });
  await page.click('[data-hs="pick"][data-index="2"]');
  assert.equal(await page.textContent("#hs-notice"), "已被占用");
  assert.deepEqual((await calls(page)).at(-1), { type: "orderPick", actor: "w", index: 2 });
  await page.evaluate(() => { fixture.reject = ""; });
  await page.click('[data-hs="pick"][data-index="1"]');
  await setView(page, { order: [{ actor: "a", owner: "p1" }, { actor: "w", owner: "p1" }, { actor: "b", owner: "p2" }] });
  await page.click('[data-hs="confirm"]');
  assert.deepEqual((await calls(page)).at(-1), { type: "orderConfirm" });
  await page.click('[data-hs="forceStart"]');
  assert.deepEqual((await calls(page)).at(-1), { type: "orderStart" });
  await page.selectOption("#hs-player", "p2");
  assert.equal(await page.locator('[data-hs="forceStart"]').count(), 0);
  assert.equal(await page.locator("#hs-pick-unit option").count(), 1);
  assert.deepEqual(o.errors, []);
});

test("D2 UI: order chat sends plain text only in lobby/order panels and keeps typing across state notifications", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await picking(page);
  await page.fill("#hs-chat-text", "我先召唤，再让柏妮尔行动。");
  await setView(page, { chat: [{ playerId: "p2", text: "<script>bad()</script>" }] });
  assert.equal(await page.inputValue("#hs-chat-text"), "我先召唤，再让柏妮尔行动。");
  assert.ok((await page.textContent("#hs-chat-log")).includes("<script>bad()</script>"));
  assert.equal(await page.locator("#hs-chat-log script").count(), 0);
  await page.press("#hs-chat-text", "Enter");
  await page.waitForFunction(() => document.getElementById("hs-chat-text").value === "");
  assert.deepEqual((await calls(page)).at(-1), { type: "chat", text: "我先召唤，再让柏妮尔行动。" });
  await setView(page, { phase: "acting", canConfigure: false });
  assert.equal(await page.isVisible("#hs-chat-form"), false);
  assert.deepEqual(o.errors, []);
});

test("D2 UI: 390px order bar offers touch movement, locks spent slots and requests other owner's swap consent", async t => {
  const o = await open(t, { mobile: true }); if (!o) return;
  const { page } = o;
  await setView(page, {
    phase: "acting", mode: "coop", currentUnitId: "a", canConfigure: false,
    order: [{ actor: "c", name: "红玉", owner: "p1", locked: true, done: true }, { actor: "a", name: "夕夏", owner: "p1", current: true }, { actor: "b", name: "绯秋", owner: "p2" }]
  });
  assert.equal(await page.locator('[data-drag-actor="c"]').getAttribute("draggable"), "false");
  assert.equal(await page.locator('[data-drag-actor="b"]').getAttribute("draggable"), "false");
  assert.equal(await page.locator('[data-drag-actor="a"]').getAttribute("draggable"), "true");
  assert.ok(await page.getByRole("button", { name: "夕夏前移", exact: true }).isDisabled());
  await page.getByRole("button", { name: "夕夏后移", exact: true }).click();
  assert.deepEqual((await calls(page)).at(-1), { type: "orderMove", actor: "a", index: 2 });
  await setView(page, { swap: { requestId: "swap-1", from: "a", to: "b", recipient: "p2" } });
  assert.equal(await page.locator('[data-hs="swapYes"]').count(), 0);
  await page.selectOption("#hs-player", "p2");
  await page.click('[data-hs="swapYes"]');
  assert.deepEqual((await calls(page)).at(-1), { type: "orderSwapAccept", requestId: "swap-1", accept: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile page has no horizontal overflow");
  const bar = await page.locator("#hotseat-root").boundingBox(), field = await page.locator("#fixture-field").boundingBox();
  assert.ok(field.y >= bar.y + bar.height, "hotseat controls reserve space above the battlefield");
  assert.deepEqual(o.errors, []);
});

test("D2 UI: desktop drag and touch buttons send the same explicit move command", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await setView(page, { phase: "acting", mode: "coop", currentUnitId: "a", order: [{ actor: "a", owner: "p1" }, { actor: "b", owner: "p2" }], canConfigure: false });
  await page.locator('[data-drag-actor="a"]').dragTo(page.locator('[data-drag-actor="b"]'));
  assert.deepEqual((await calls(page)).at(-1), { type: "orderMove", actor: "a", index: 1 });
  await page.getByRole("button", { name: "夕夏后移", exact: true }).click();
  assert.deepEqual((await calls(page)).at(-1), { type: "orderMove", actor: "a", index: 1 });
  assert.deepEqual(o.errors, []);
});

test("D2 UI: assistance buttons belong only to eligible owner; every operator sees the 20 second countdown", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  const deadline = Date.now() + 20000;
  await setView(page, { phase: "enemy", ask: { id: "ask-1", kind: "block", title: "敌人攻击红玉", deadline, waitingNames: ["玩家 2"], eligible: false, options: [] } });
  assert.equal(await page.locator('[data-hs="answer"]').count(), 0);
  assert.equal(await page.locator('[data-hs="decline"]').count(), 0);
  assert.match(await page.textContent("#hs-reaction"), /正在等待玩家 2回应/);
  assert.match(await page.textContent("#hs-countdown"), /^(19|20) 秒$/);
  await page.selectOption("#hs-player", "p2");
  await setView(page, { ask: { id: "ask-1", kind: "block", deadline, waitingNames: ["玩家 2"], eligible: true, options: [{ helper: "b", label: "绯秋格挡", sub: "消耗附赠行动" }] } });
  assert.equal(await page.locator('[data-hs="answer"]').count(), 1);
  await page.click('[data-hs="answer"]');
  assert.deepEqual((await calls(page)).at(-1), { type: "answer", askId: "ask-1", helper: "b" });
  await setView(page, { ask: null });
  assert.equal(await page.isVisible("#hs-reaction"), false, "the first accepted response closes all operators' prompt projection");
  await setView(page, { ask: { id: "ask-2", kind: "assist", deadline: Date.now() + 20000, eligible: true, options: [{ helper: "b", label: "绯秋" }] } });
  await page.click('[data-hs="decline"]');
  assert.deepEqual((await calls(page)).at(-1), { type: "answer", askId: "ask-2", helper: null });
  await setView(page, { ask: { id: "ask-2", kind: "assist", deadline: Date.now() + 1000, eligible: true, declined: true, options: [{ helper: "b", label: "绯秋" }] } });
  assert.equal(await page.locator('[data-hs="answer"]').count(), 0);
  assert.match(await page.textContent("#hs-reaction"), /你已选择不协助/);
  assert.deepEqual(o.errors, []);
});

test("D2 UI: owner's generic choice carries distinct JSON extra and has no assistance timeout", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await setView(page, { phase: "acting", ask: { id: "choice-1", kind: "choice", title: "选择刀片", deadline: null, eligible: true, options: [{ helper: "a", label: "纽刀", extra: { blade: "niu" } }, { helper: "a", label: "鸣刀", extra: { blade: "naruto" } }] } });
  assert.equal(await page.locator('[data-hs="answer"]').count(), 2);
  assert.equal(await page.isVisible("#hs-countdown"), false);
  assert.equal(await page.locator('[data-hs="decline"]').count(), 0);
  await page.getByRole("button", { name: "鸣刀", exact: true }).click();
  assert.deepEqual((await calls(page)).at(-1), { type: "answer", askId: "choice-1", helper: "a", extra: { blade: "naruto" } });
  await setView(page, { playerId: "p2", ask: { id: "choice-1", kind: "choice", title: "选择刀片", deadline: 0, eligible: false, waitingNames: ["主持人"], options: [] } });
  assert.equal(await page.locator('[data-hs="answer"]').count(), 0);
  assert.equal(await page.isVisible("#hs-countdown"), false);
  assert.deepEqual(o.errors, []);
});

async function realBattle(t, count, mobile = false, mode = "coop") {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href + "?hotseat=1");
  await page.waitForSelector("#hotseat-root");
  await page.evaluate(count => {
    const party = ["helu", "ruby", "yuito", "xia"].slice(0, count);
    GAME.instant = true;
    GAME.startRogueBattle({ title: "D2 完整战斗", party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], level: 1, seed: `D2-UI-${count}`, before: state => {
      // Strong fixture heroes shorten combat; all turns, damage and rewards use the real UI coordinator.
      state.units.filter(u => u.isPlayer).forEach(u => { u.atk = 5000; u.def = u.defMax = 1000; u.layers.forEach(layer => { layer.current = layer.max = 1000; }); });
    } }, () => {});
    state.units.filter(u => !u.isPlayer).forEach(u => u.layers.forEach(layer => { layer.current = layer.max = 2; }));
    Screens.show("battle");
  }, count);
  await page.selectOption("#hs-count", String(count));
  await page.selectOption("#hs-mode", mode);
  const heroes = await page.evaluate(() => HotseatGame.getView().heroes.slice().sort((a, b) => ["helu", "ruby", "yuito", "xia"].indexOf(unitById(a.id).kit) - ["helu", "ruby", "yuito", "xia"].indexOf(unitById(b.id).kit)));
  for (let i = 0; i < heroes.length; i++) await page.locator(`[data-assignment="${heroes[i].id}"]`).selectOption(`p${i + 1}`);
  await page.click('[data-hs="configure"]');
  assert.equal(await page.evaluate(() => HotseatGame.isActive()), true);
  assert.equal(await page.textContent("#hs-notice"), "", "a valid configuration must complete without bridge errors");
  await page.evaluate(() => { const intro = document.getElementById("g-intro"); if (intro) intro.remove(); });
  await page.click("#g-start");
  await page.waitForFunction(() => HotseatGame.getView().phase === "picking");
  await page.selectOption("#hs-pick-unit", heroes[0].id);
  await page.click('[data-hs="pick"][data-index="0"]');
  return { page, errors, heroes };
}

for (const count of [2, 3, 4]) test(`D2 integration: ${count} operators finish a real battle after an enemy round and a fresh order selection`, async t => {
  const o = await realBattle(t, count, count === 3); if (!o) return;
  const { page, heroes } = o;
  assert.equal(await page.locator(".hs-slots [data-hs=pick]").count(), count);
  await page.click('[data-hs="forceStart"]');
  await page.waitForFunction(() => HotseatGame.getView().phase === "acting");
  const first = await page.evaluate(() => HotseatGame.getView().currentUnitId);
  await page.selectOption("#hs-player", "p2");
  assert.ok(await page.locator("#g-endturn").isDisabled(), "another operator cannot finish the current unit");
  assert.equal(await page.locator("#g-skills button:not(:disabled)").count(), 0);
  await page.selectOption("#hs-player", "p1");
  const preview = await page.evaluate(first => {
    const before = JSON.stringify(HotseatGame.getView().order);
    GAME.previewOf(GAME.skillThunk(first, "helu_summon", null, {}));
    return { before, after: JSON.stringify(HotseatGame.getView().order) };
  }, first);
  assert.equal(preview.after, preview.before, "previewing a summon does not lock a slot or add an actual weapon");
  await page.evaluate(async actor => { await GAME.act({ type: "skill", actor, skill: "helu_summon", target: null, picks: {} }, { actorId: actor, skillName: "唤出 Ecmo" }); }, first);
  // 召唤出的武器人紧挨着本人（在本人前一格），并且立刻轮到它
  const weapon = await page.evaluate(() => { const v = HotseatGame.getView(); return v.order.find(r => r && r.actor === v.currentUnitId); });
  assert.notEqual(weapon.actor, first, "召唤后当前行动单位是武器人");
  assert.equal(await page.evaluate(([w, h]) => { const o = HotseatGame.getView().order; return o.findIndex(r => r && r.actor === h) - o.findIndex(r => r && r.actor === w); }, [weapon.actor, first]), 1);
  assert.equal(weapon.owner, "p1");
  assert.equal(await page.evaluate(() => HotseatGame.getView().order.length), count + 1);
  assert.equal(await page.evaluate(first => HotseatGame.getView().order.find(row => row?.actor === first).locked, first), true);
  const oldIndex = await page.evaluate(w => HotseatGame.getView().order.findIndex(r => r && r.actor === w), weapon.actor);
  await page.locator(`[data-hs="move"][data-actor="${weapon.actor}"][aria-label$="移至末尾"]`).click();
  assert.equal(await page.evaluate(() => HotseatGame.getView().order.at(-1).actor), weapon.actor);
  assert.equal(await page.evaluate(i => HotseatGame.getView().order[i], oldIndex), null, "moving to the empty tail leaves old slot fixed in place");
  await page.evaluate(() => {
    window.autoReplies = []; window.autoReplyErrors = [];
    window.autoReplyTimer = setInterval(() => {
      const view = HotseatGame.getView(); if (!view.ask) return;
      for (const player of view.players) {
        HotseatGame.switchPlayer(player.id);
        const ask = HotseatGame.getView().ask;
        if (!ask || !ask.eligible || ask.declined) continue;
        const option = ask.options[0];
        const command = ask.kind === "choice" ? { type: "answer", askId: ask.id, helper: option.helper, extra: option.extra } : { type: "answer", askId: ask.id, helper: null };
        const answer = HotseatGame.submit(command);
        (answer.ok ? autoReplies : autoReplyErrors).push(answer.ok ? command : answer.error);
      }
    }, 5);
  });
  for (let guard = 0; guard < 10; guard++) {
    const current = await page.evaluate(() => ({ view: HotseatGame.getView(), turn: state.turnNo }));
    if (current.turn > 1) break;
    const slot = current.view.order.find(row => row?.actor === current.view.currentUnitId);
    assert.ok(slot, "an unfinished unit owns each sequential turn");
    const remaining = current.view.order.filter(row => row && !row.done).length;
    await page.selectOption("#hs-player", slot.owner);
    await page.click("#g-endturn");
    await page.waitForFunction(actor => GAME.depth === 0 && (state.turnNo > 1 || HotseatGame.getView().currentUnitId !== actor), slot.actor);
    if (remaining > 1) assert.equal(await page.evaluate(() => state.turnNo), 1, "the enemy round does not start before the final slot ends");
  }
  await page.waitForFunction(() => state.turnNo === 2 && HotseatGame.getView().phase === "picking");
  assert.ok(await page.isVisible("#hs-panel"));
  assert.equal(await page.evaluate(() => Commands.history().some(row => row.command.type === "battle.enemyAction" && row.status === "ok")), true, "the actual enemy coordinator ran");
  assert.deepEqual(await page.evaluate(() => autoReplyErrors), []);
  await page.selectOption("#hs-player", "p1");
  await page.click('[data-hs="forceStart"]');
  for (let guard = 0; guard < 60; guard++) {
    await page.waitForFunction(() => GAME.depth === 0 && (GAME.ended || ["picking", "acting"].includes(HotseatGame.getView().phase)));
    const current = await page.evaluate(() => ({ ended: GAME.ended, view: HotseatGame.getView() }));
    if (current.ended) break;
    if (current.view.phase === "picking") { await page.selectOption("#hs-player", "p1"); await page.click('[data-hs="forceStart"]'); continue; }
    const slot = current.view.order.find(row => row?.actor === current.view.currentUnitId);
    assert.ok(slot, JSON.stringify(current));
    await page.selectOption("#hs-player", slot.owner);
    const move = await page.evaluate(() => {
      const actor = unitById(HotseatGame.getView().currentUnitId), target = state.units.find(u => !u.isPlayer && !u.dead && !u.hidden);
      return actor.kit === "ruby" && target && actor.zone === target.zone ? { type: "move", actor: actor.id, dest: actor.zone === 1 ? 2 : 1 } : null;
    });
    if (move) await page.evaluate(async cmd => { await GAME.act(cmd, { actorId: cmd.actor, skillName: "移动" }); }, move);
    const attack = await page.evaluate(() => {
      const actor = unitById(HotseatGame.getView().currentUnitId), target = state.units.find(u => !u.isPlayer && !u.dead && !u.hidden);
      const skill = GAME.gameSkills(actor).find(sk => sk.id === "ruby_aa" && !GAME.blockReason(actor, sk));
      if (!skill || !target) return null;
      const range = skillRangeFor(actor, skill.id), distance = zoneDist(actor.zone, target.zone, state.zoneMode);
      const reachable = range ? distance >= range.min && distance <= range.max : inSkillRange(actor, target, skill.hint + " " + skill.name, state.zoneMode);
      return reachable ? { type: "skill", actor: actor.id, skill: skill.id, target: target.id, picks: {} } : null;
    });
    if (slot.actor === heroes[1].id) assert.ok(attack, "Ruby reaches a legal firing zone before attacking");
    if (attack) {
      await page.evaluate(async cmd => { await GAME.act(cmd, { actorId: cmd.actor, targetId: cmd.target, skillName: "普通攻击" }); }, attack);
      assert.equal(await page.evaluate(cmd => Commands.history().some(row => row.command.type === "skill" && row.command.actor === cmd.actor && row.command.skill === cmd.skill && row.status === "ok"), attack), true, await page.textContent("#g-hint"));
    }
    if (!await page.evaluate(() => GAME.ended)) await page.click("#g-endturn");
  }
  await page.waitForFunction(() => GAME.ended && GAME.lastOutcome === "win");
  await page.waitForSelector("#g-result.show");
  assert.equal(await page.evaluate(() => HotseatGame.getView().phase), "ended");
  assert.equal(await page.evaluate(() => GAME.undo.length), 0);
  assert.equal(await page.evaluate(() => Commands.history().filter(row => row.command.type === "battle.finish" && row.status === "ok").length), 1);
  assert.equal(await page.evaluate(() => partyHeroes().length), heroes.length);
  assert.deepEqual(o.errors, []);
});

test("D2 integration: real authority projects assistance only to the owner and closes both UI views on acceptance", async t => {
  const o = await realBattle(t, 2); if (!o) return;
  const { page } = o;
  await page.click('[data-hs="forceStart"]');
  const helper = await page.evaluate(() => {
    const candidate = partyHeroes().find(u => u.kit === "ruby");
    window.pendingAsk = HotseatGame.requestAsk("block", "真实协助询问", [{ helper: candidate.id, label: candidate.name, extra: {} }], () => [unitById(candidate.id)], { seq: 1, targetId: partyHeroes()[0].id });
    return candidate.id;
  });
  assert.ok(await page.isVisible("#hs-reaction"));
  assert.equal(await page.locator('[data-hs="answer"]').count(), 0);
  assert.match(await page.textContent("#hs-countdown"), /^(19|20) 秒$/);
  await page.selectOption("#hs-player", "p2");
  assert.equal(await page.locator('[data-hs="answer"]').count(), 1);
  await page.click('[data-hs="answer"]');
  const answer = await page.evaluate(() => pendingAsk);
  assert.equal(answer.unitId, helper);
  assert.equal(await page.isVisible("#hs-reaction"), false);
  await page.selectOption("#hs-player", "p1");
  assert.equal(await page.isVisible("#hs-reaction"), false);
  assert.deepEqual(o.errors, []);
});

test("D2 integration: order selection offers an explicit cross-owner swap before everyone confirms", async t => {
  const o = await realBattle(t, 2, true); if (!o) return;
  const { page, heroes } = o;
  await page.selectOption("#hs-player", "p2");
  await page.click('[data-hs="pick"][data-index="1"]');
  await page.selectOption("#hs-player", "p1");
  await page.locator(`[data-hs="move"][data-actor="${heroes[0].id}"][data-index="1"]`).click();
  assert.equal(await page.evaluate(() => HotseatGame.getView().phase), "picking");
  assert.equal(await page.evaluate(() => HotseatGame.getView().swap.recipient), "p2");
  assert.deepEqual(await page.evaluate(() => HotseatGame.getView().order.map(row => row?.actor)), heroes.map(h => h.id));
  await page.selectOption("#hs-player", "p2");
  await page.click('[data-hs="swapYes"]');
  assert.deepEqual(await page.evaluate(() => HotseatGame.getView().order.map(row => row?.actor)), heroes.map(h => h.id).reverse());
  assert.equal(await page.locator(".hs-tail").count(), 0, "selection has exactly the current number of unit slots");
  assert.deepEqual(o.errors, []);
});

test("D2 integration: removing the final unfinished unit resumes the real enemy coordinator", async t => {
  const o = await realBattle(t, 2, false, "trpg"); if (!o) return;
  const { page, heroes } = o;
  await page.click('[data-hs="forceStart"]');
  await page.click("#g-endturn");
  assert.equal(await page.evaluate(() => HotseatGame.getView().currentUnitId), heroes[1].id);
  const ack = await page.evaluate(actor => HotseatGame.submit({ type: "battle.panel", action: "removeParty", actor }), heroes[1].id);
  assert.equal(ack.ok, true, ack.error);
  await page.waitForFunction(() => state.turnNo === 2 && HotseatGame.getView().phase === "picking");
  assert.equal(await page.evaluate(() => Commands.history().some(row => row.command.type === "battle.enemyAction" && row.status === "ok")), true);
  assert.equal(await page.evaluate(() => HotseatGame.getView().units.length), 1);
  assert.deepEqual(o.errors, []);
});

test("D2 integration: switching to a non-host while retreat confirmation is open cannot finish the battle", async t => {
  const o = await realBattle(t, 2); if (!o) return;
  const { page } = o;
  await page.click('[data-hs="forceStart"]');
  await page.click("#g-retreat");
  await page.waitForSelector("#g-choice.show");
  await page.selectOption("#hs-player", "p2");
  await page.locator("#g-choice .opts button").first().click();
  assert.equal(await page.evaluate(() => GAME.ended), false);
  assert.equal(await page.evaluate(() => !!state.retreated), false);
  assert.equal(await page.evaluate(() => Commands.history().filter(row => row.command.type === "retreat" && row.status === "ok").length), 0);
  assert.equal(await page.isVisible("#g-result"), false);
  assert.deepEqual(o.errors, []);
});

test("D2 integration: a non-GM's winning hit records the TRPG result, saves it and returns to exploration", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept(dialog.type() === "prompt" ? "D2 热座团" : undefined));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href + "?hotseat=1");
  await page.click('[data-hs="closeConfig"]');
  await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.evaluate(() => Commands.dispatch({ type: "trpg.ui", action: "party", kits: ["ruby", "helu"], level: 1 }));
  await page.click("#tr-fight");
  await page.evaluate(() => {
    GAME.instant = true;
    state.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; u.def = 0; u.layers.forEach(layer => { layer.current = layer.max = 1; }); });
    const intro = document.getElementById("g-intro"); if (intro) intro.remove();
  });
  await page.click('[data-hs="openConfig"]');
  const actors = await page.evaluate(() => HotseatGame.getView().heroes.map(u => ({ ...u, kit: unitById(u.id).kit })));
  for (const actor of actors) await page.locator(`[data-assignment="${actor.id}"]`).selectOption(actor.kit === "ruby" ? "p2" : "p1");
  await page.click('[data-hs="configure"]');
  assert.equal(await page.textContent("#hs-notice"), "");
  await page.click("#g-start");
  await page.waitForFunction(() => HotseatGame.getView().phase === "picking");
  await page.selectOption("#hs-player", "p2");
  await page.click('[data-hs="pick"][data-index="0"]');
  await page.selectOption("#hs-player", "p1");
  await page.click('[data-hs="forceStart"]');
  await page.selectOption("#hs-player", "p2");
  await page.evaluate(() => { const u = partyHeroes().find(u => u.kit === "ruby"); u.ap = 20; u.zone = 1; });
  const beforeLog = await page.evaluate(() => trpgReadSlots()[0].log.length);
  for (let guard = 0; guard < 10; guard++) {
    if (await page.evaluate(() => GAME.ended)) break;
    await page.evaluate(async () => {
      const actor = partyHeroes().find(u => u.kit === "ruby"), target = state.units.find(u => !u.isPlayer && !u.dead && !u.hidden);
      await GAME.act({ type: "skill", actor: actor.id, skill: "ruby_aa", target: target.id, picks: {} }, { actorId: actor.id, targetId: target.id, skillName: "普通攻击" });
    });
  }
  assert.equal(await page.evaluate(() => GAME.lastOutcome), "win");
  assert.equal(await page.evaluate(() => HotseatGame.getView().playerId), "p2");
  const saved = await page.evaluate(() => trpgReadSlots()[0]);
  assert.equal(saved.log.length, beforeLog + 1);
  assert.match(saved.log.at(-1).lines.join("\n"), /战斗胜利/);
  assert.equal(await page.evaluate(() => Commands.history().filter(row => row.command.type === "trpg.ui" && row.command.action === "recordBattle" && row.status === "ok").length), 1);
  await page.selectOption("#hs-player", "p1");
  await page.waitForSelector("#g-result.show");
  await page.click("#g-explore-back");
  await page.waitForSelector("#scr-trpg:not([hidden])");
  assert.match(await page.textContent("#tr-log"), /战斗胜利/);
  assert.deepEqual(errors, []);
});
