"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const { createLocalRelayServer } = require("../relay/local-server.cjs");
const ROOT = path.resolve(__dirname, "..");
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { const pw = playwright(); if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function fixture(t) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const website = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise(resolve => website.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => website.close(resolve)));
  const origin = "http://127.0.0.1:" + website.address().port;
  const relay = await createLocalRelayServer({ origins: [origin] }); t.after(() => relay.close());
  const pages = [], contexts = [], errors = [], wire = [];
  for (const width of [1440, 1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    page.on("websocket", ws => ws.on("framereceived", frame => { try { wire.push({ page: pages.indexOf(page), data: JSON.parse(frame.payload) }); } catch (_) {} }));
    await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
    await page.evaluate(() => { GAME.skip = true; GAME.instant = true; });
  }
  t.after(async () => { for (const context of contexts) await context.close(); });
  const [host, alice, bob] = pages;
  const created = await host.evaluate(async url => { await OnlineGame.create({ url, name: "GM", slot: 0, campaignName: "D3 integration" }); return OnlineGame.getView().roomCode; }, relay.url);
  for (const [page, name] of [[alice, "Alice"], [bob, "Bob"]]) await page.evaluate(options => OnlineGame.join(options), { url: relay.url, roomCode: created, name });
  await host.waitForFunction(() => OnlineGame.getView().players.length === 3 && !OnlineGame.isPaused());
  for (const page of [alice, bob]) await page.waitForFunction(() => !!OnlineGame.getView().packet?.state);
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id), bobId = await bob.evaluate(() => OnlineGame.getView().identity.id);
  await host.evaluate(({ aliceId, bobId }) => OnlineGame.assign(Object.fromEntries(HotseatGame.getView().heroes.slice(0, 2).map((hero, i) => [hero.id, i === 0 ? aliceId : bobId]))), { aliceId, bobId });
  return { host, alice, bob, aliceId, bobId, pages, errors, wire };
}
const submit = (page, cmd) => page.evaluate(command => OnlineGame.submit(command), cmd);
function logicalPackets(frames) {
  const result = [], chunks = new Map();
  for (const { page, data } of frames) {
    if (data.kind === "data") result.push({ page, packet: data.payload, bytes: Buffer.byteLength(JSON.stringify(data.payload)) });
    else if (data.kind === "chunk") {
      const key = page + ":" + data.from + ":" + data.id;
      if (data.index === 0) chunks.set(key, []);
      const parts = chunks.get(key); assert.ok(parts, "chunk must have a first frame");
      assert.equal(parts.length, data.index); parts.push(data.text);
      if (parts.length === data.count) { const text = parts.join(""); result.push({ page, packet: JSON.parse(text), bytes: Buffer.byteLength(text) }); chunks.delete(key); }
    }
  }
  assert.equal(chunks.size, 0, "a measurement must include complete logical messages"); return result;
}
function measureAction(t, label, frames) {
  const packets = logicalPackets(frames).filter(row => row.packet.type === "result");
  assert.ok(packets.length > 0); assert.ok(packets.every(row => row.bytes <= 50 * 1024), label + " logical payload, after projection/delta but before relay fragmentation, must be <=50 KiB");
  assert.ok(packets.some(row => row.packet.wireFormat === "backfire-display-delta-v1"));
  const stats = [1, 2].map(page => { const rows = packets.filter(row => row.page === page); return { recipient: page, packets: rows.length, max: Math.max(...rows.map(row => row.bytes)), total: rows.reduce((n, row) => n + row.bytes, 0) }; });
  assert.ok(stats.every(row => row.total <= 50 * 1024), label + " complete result traffic to each recipient must also be <=50 KiB");
  t.diagnostic(label + " logical bytes: " + JSON.stringify(stats)); return stats;
}

test("D3 game sessions: remote ownership, GM/private messages, round actions and host/player reload recovery", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob, aliceId, bobId } = f;
  assert.equal((await submit(alice, { type: "gm.setWeather", weather: "snow" })).ok, false);
  assert.equal((await submit(host, { type: "gm.setWeather", weather: "snow" })).ok, true);
  assert.equal(await host.evaluate(() => state.weather), "snow");
  assert.equal((await submit(host, { type: "gm.setWeather", weather: "none" })).ok, true);
  assert.equal((await submit(host, { type: "gm.msg", to: aliceId, text: "ONLY_ALICE_D3" })).ok, true);
  await alice.waitForFunction(() => OnlineGame.getView().messages.some(m => m.text === "ONLY_ALICE_D3"));
  assert.ok(!(await bob.evaluate(() => JSON.stringify(OnlineGame.getView()))).includes("ONLY_ALICE_D3"));
  assert.equal((await submit(alice, { type: "gmReply", text: "ALICE_REPLY_D3" })).ok, true);
  await host.waitForFunction(() => OnlineGame.getView().messages.some(m => m.text === "ALICE_REPLY_D3"));
  assert.ok(!(await bob.evaluate(() => JSON.stringify(OnlineGame.getView()))).includes("ALICE_REPLY_D3"));
  await host.evaluate(() => { OnlineGame.start(); TrpgFlow.toBattle(); GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  try { await host.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 20000 }); }
  catch (error) { throw new Error(error.message + " " + JSON.stringify(await host.evaluate(() => ({ depth: GAME.depth, phase: HotseatGame.getView().phase, ask: HotseatGame.getView().ask, started: state.combatStarted, combatPhase: state.combatPhase, notice: OnlineGame.getView().notice }))) + " errors=" + JSON.stringify(f.errors)); }
  const heroes = await host.evaluate(() => HotseatGame.getView().heroes);
  assert.equal(heroes.length, 4);
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(hero.owner === aliceId ? alice : hero.owner === bobId ? bob : host, { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  await host.waitForFunction(() => HotseatGame.getView().phase === "acting");
  const actor = heroes[0].id;
  const before = await host.evaluate(() => JSON.stringify(state));
  const forbidden = await submit(bob, { type: "move", actor, dest: 2, sender: aliceId });
  assert.equal(forbidden.ok, false); assert.match(forbidden.error, /不是你的|不能操作.*其他/);
  assert.equal(await host.evaluate(() => JSON.stringify(state)), before);
  assert.deepEqual(await host.evaluate(() => ({ players: partyHeroes().length, enemies: state.units.filter(u => !u.isPlayer).length })), { players: 4, enemies: 3 });
  const attackMenu = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "ruby_aa" }), actor);
  assert.equal(attackMenu.choices.kind, "unit");
  const attackTarget = attackMenu.choices.options[0].value;
  const attackReady = await alice.evaluate(({ actor, target }) => OnlineGame.actionMenu({ actor, skill: "ruby_aa", target }), { actor, target: attackTarget });
  assert.equal(attackReady.choices.kind, "ready");
  const attackStart = f.wire.length, answered = new Set();
  await alice.evaluate(command => { window.attackResult = null; OnlineGame.submit(command).then(result => { window.attackResult = result; }); }, attackReady.choices.command);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(await alice.evaluate(() => window.attackResult))) {
    for (const [index, page] of [host, alice, bob].entries()) {
      const ask = await page.evaluate(() => OnlineGame.isHost() ? HotseatGame.getView().ask : OnlineGame.getView().packet?.view?.ask);
      const key = index + ":" + ask?.id;
      if (ask?.eligible && !ask.declined && !answered.has(key)) { answered.add(key); assert.equal((await submit(page, { type: "answer", askId: ask.id, helper: null, extra: {} })).ok, true); }
    }
    await host.waitForTimeout(25);
  }
  const attackResult = await alice.evaluate(() => window.attackResult); assert.equal(attackResult?.ok, true, JSON.stringify(attackResult));
  const finalAttackSeq = await alice.evaluate(() => OnlineGame.getView().packet.seq);
  await bob.waitForFunction(seq => OnlineGame.getView().packet?.seq >= seq, finalAttackSeq);
  measureAction(t, "4v3 ruby two-hit attack", f.wire.slice(attackStart));
  const menu = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "__move" }), actor);
  assert.equal(menu.type, "actionOptions"); assert.ok(menu.choices.options.length > 0);
  const dest = menu.choices.options[0].value;
  const ready = await alice.evaluate(({ actor, dest }) => OnlineGame.actionMenu({ actor, skill: "__move", dest }), { actor, dest });
  assert.equal(ready.choices.kind, "ready");
  assert.deepEqual(await host.evaluate(() => ({ players: partyHeroes().length, enemies: state.units.filter(u => !u.isPlayer).length })), { players: 4, enemies: 3 });
  const wireStart = f.wire.length;
  assert.equal((await submit(alice, ready.choices.command)).ok, true);
  await host.waitForFunction(id => HotseatGame.getView().order.find(row => row?.actor === id)?.locked, actor);
  assert.equal(await host.evaluate(id => state.units.find(u => u.id === id).zone, actor), dest);
  for (const page of [alice, bob]) await page.waitForFunction(({ actor, dest }) => OnlineGame.getView().packet.state.units.find(u => u.id === actor)?.zone === dest, { actor, dest });
  measureAction(t, "4v3 move", f.wire.slice(wireStart));
  const recovery = await host.evaluate(() => ({ order: HotseatGame.getView().order, phase: HotseatGame.getView().phase, current: HotseatGame.getView().currentUnitId, units: state.units.map(u => ({ id: u.id, ap: u.ap, bonus: u.bonus, zone: u.zone })) }));
  await host.reload(); await host.waitForFunction(() => !!window.OnlineGame);
  await alice.waitForFunction(() => OnlineGame.isPaused());
  await host.evaluate(async () => { GAME.skip = true; GAME.instant = true; await OnlineGame.resume(); });
  await alice.waitForFunction(() => !OnlineGame.isPaused());
  assert.deepEqual(await host.evaluate(() => ({ order: HotseatGame.getView().order, phase: HotseatGame.getView().phase, current: HotseatGame.getView().currentUnitId, units: state.units.map(u => ({ id: u.id, ap: u.ap, bonus: u.bonus, zone: u.zone })) })), recovery);
  assert.equal((await submit(alice, { type: "orderMove", actor, index: 4 })).ok, false);
  const playerIdentity = await bob.evaluate(() => OnlineGame.getView().identity);
  await bob.reload(); await bob.waitForFunction(() => !!window.OnlineGame); await bob.evaluate(() => OnlineGame.resume());
  await bob.waitForFunction(() => !!OnlineGame.getView().packet?.state);
  assert.deepEqual(await bob.evaluate(() => OnlineGame.getView().identity), playerIdentity);
  assert.equal(await bob.evaluate(() => innerWidth), 390);
  const stateOnClient = await bob.evaluate(() => JSON.stringify(OnlineGame.getView().packet));
  assert.ok(!/"shp(?:Max)?"/.test(stateOnClient));
  assert.ok(!JSON.stringify(f.wire.filter(m => m.page === 2)).includes("ONLY_ALICE_D3"));
  assert.deepEqual(f.errors, []);
});

test("D3 game sessions: remote summon, mixed AI/manual round, reactions, victory and saved exploration return", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob, aliceId, bobId } = f;
  await host.evaluate(({ aliceId, bobId }) => {
    OnlineGame.assign(Object.fromEntries(partyHeroes().filter(u => ["hiaki", "ruby"].includes(u.kit)).map(u => [u.id, u.kit === "hiaki" ? aliceId : bobId])));
    OnlineGame.start(); TrpgFlow.toBattle(); GAME.skip = true; GAME.instant = true;
  }, { aliceId, bobId });
  const enemyControl = await host.evaluate(() => { const ai = state.units.find(u => !u.isPlayer && u.kit === "thug_knife"); return { ai: ai.id, manual: state.units.filter(u => !u.isPlayer && u.id !== ai.id).map(u => u.id) }; });
  assert.equal((await submit(host, { type: "gm.setManual", actors: enemyControl.manual, enabled: true })).ok, true);
  await host.evaluate(() => { GAME.startOrEnd(); });
  await host.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  const heroes = await host.evaluate(aliceId => HotseatGame.getView().heroes.sort((a, b) => Number(b.owner === aliceId) - Number(a.owner === aliceId)), aliceId);
  const pageFor = owner => owner === aliceId ? alice : owner === bobId ? bob : host;
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(pageFor(hero.owner), { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  const actor = heroes[0].id;
  const first = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "hiaki_summon" }), actor);
  assert.equal(first.choices.kind, "choice"); assert.equal(first.choices.key, "blade");
  assert.ok(first.choices.options.some(option => option.value === "niu"));
  const ready = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "hiaki_summon", picks: { blade: "niu" } }), actor);
  assert.equal(ready.choices.kind, "ready"); assert.equal((await submit(alice, ready.choices.command)).ok, true);
  await alice.waitForFunction(() => OnlineGame.getView().packet.view.order.length === 5);
  const weapon = await host.evaluate(() => state.units.find(u => u.kit === "niu" && !u.hidden).id);
  const order = await host.evaluate(() => HotseatGame.getView().order);
  assert.equal(order.at(-1).actor, weapon); assert.equal(order.at(-1).owner, aliceId);
  assert.equal((await submit(bob, { type: "move", actor: weapon, dest: 2 })).ok, false);
  for (const row of order.slice(0, -1)) assert.equal((await submit(pageFor(row.owner), { type: "endTurn", actor: row.actor })).ok, true);
  await alice.evaluate(cmd => { window.roundResult = null; OnlineGame.submit(cmd).then(result => { window.roundResult = result; }); }, { type: "endTurn", actor: weapon });
  try { await host.waitForFunction(() => OnlineGame.getView().manualPhase && state.combatPhase === "enemy", null, { timeout: 5000 }); }
  catch (error) { throw new Error(error.message + " " + JSON.stringify(await host.evaluate(() => ({ depth: GAME.depth, phase: HotseatGame.getView().phase, ask: HotseatGame.getView().ask, combatPhase: state.combatPhase, manual: GMCommands.snapshot(), notice: OnlineGame.getView().notice, last: JSON.parse(localStorage.getItem("backfire-online-v1")).requests.slice(-1).map(entry => entry[1].response) }))) + " player=" + JSON.stringify(await alice.evaluate(() => window.roundResult)) + " errors=" + JSON.stringify(f.errors)); }
  const aiActions = await host.evaluate(() => Commands.history().filter(row => row.command.type === "battle.enemyAction").map(row => row.command.actor));
  assert.ok(aiActions.includes(enemyControl.ai), "the unmarked enemy acts through the existing AI before the manual phase");
  assert.ok(enemyControl.manual.every(id => !aiActions.includes(id)), "manual enemies cannot also receive an automatic AI turn");
  const enemy = await host.evaluate(() => { const u = state.units.find(u => !u.isPlayer && GMCommands.isManual(u) && enemySkillList(u).some(skill => skill.id === "en_aa")); return { id: u.id, zone: u.zone, ap: u.ap }; });
  // The default minion has one AP. Put it beside the target through the real
  // GM editor so the manual attack can use that AP, rather than spending it on
  // a movement and accidentally testing an unaffordable second action.
  if (enemy.zone !== 1) assert.equal((await submit(host, { type: "gm.editUnit", actor: enemy.id, patch: { zone: 1 } })).ok, true);
  const target = await host.evaluate(id => (touDuelVictim(unitById(id)) || partyHeroes().find(u => u.kit === "ruby")).id, enemy.id);
  const apBefore = await host.evaluate(id => unitById(id).ap, enemy.id);
  await host.evaluate(cmd => { window.enemyResult = null; OnlineGame.submit(cmd).then(result => { window.enemyResult = result; }); }, { type: "gm.enemyAct", actor: enemy.id, action: "skill", skill: "en_aa", target });
  let answered = 0; const answeredAsks = new Set();
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !(await host.evaluate(() => window.enemyResult))) {
    for (const page of [alice, bob, host]) {
      const ask = await page.evaluate(() => OnlineGame.isHost() ? HotseatGame.getView().ask : OnlineGame.getView().packet?.view?.ask);
      if (ask?.eligible && !ask.declined && !answeredAsks.has(ask.id)) {
        const option = ask.options[0];
        const ack = await submit(page, { type: "answer", askId: ask.id, helper: option?.helper || null, extra: option?.extra || {} });
        assert.equal(ack.ok, true); answered++; answeredAsks.add(ask.id); break;
      }
    }
    await host.waitForTimeout(25);
  }
  const enemyResult = await host.evaluate(() => window.enemyResult);
  assert.equal(enemyResult?.ok, true, "manual enemy action resolves without deadlocking the player's endTurn: " + JSON.stringify(enemyResult));
  assert.equal(await host.evaluate(id => unitById(id).ap, enemy.id), apBefore - 1);
  assert.ok(answered > 0, "at least one real reaction was answered by the owning session");
  let rejectionTimer;
  try {
    const rejected = await Promise.race([submit(bob, { type: "gm.enemyEndTurn" }), new Promise((_, reject) => { rejectionTimer = setTimeout(() => reject(new Error("host-only rejection was blocked behind the manual enemy turn")), 5000); })]);
    assert.equal(rejected.ok, false);
  } finally { clearTimeout(rejectionTimer); }
  assert.equal((await submit(host, { type: "gm.enemyEndTurn" })).ok, true);
  await host.waitForFunction(() => state.turnNo === 2 && HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  await alice.waitForFunction(() => !!window.roundResult);
  const roundResult = await alice.evaluate(() => window.roundResult); assert.equal(roundResult.ok, true, JSON.stringify(roundResult));
  const livingEnemies = await host.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden && !u._removed).map(u => u.id));
  assert.equal(livingEnemies.length, 3);
  for (const id of livingEnemies) {
    const killed = await submit(host, { type: "gm.removeUnit", actor: id, mode: "kill" });
    assert.equal(killed.ok, true, JSON.stringify(killed));
  }
  await host.waitForFunction(() => GAME.ended && GAME.lastOutcome === "win" && OnlineGame.getView().screen === "ended");
  await host.waitForSelector("#g-result.show");
  assert.match(await host.locator("#g-result").innerText(), /胜利/);
  const playerResults = [], hostGrade = await host.evaluate(() => battleGrade().grade);
  for (const page of [alice, bob]) {
    await page.waitForFunction(() => OnlineGame.getView().screen === "ended" && OnlineGame.getView().packet?.result?.outcome === "win");
    const result = await page.evaluate(() => OnlineGame.getView().packet.result);
    playerResults.push({ result, visible: await page.locator("#online-stage").innerText() });
  }
  const savedAfterWin = await host.evaluate(() => {
    const saved = trpgReadSlots()[0];
    return { name: saved.name, campaign: saved.campaign, log: saved.log, summary: trpgSlotSummary(saved), xp: partyHeroes().map(u => u.xp) };
  });
  assert.equal(savedAfterWin.name, "D3 integration");
  assert.ok(savedAfterWin.campaign); assert.match(JSON.stringify(savedAfterWin.log), /战斗胜利/);
  assert.ok(savedAfterWin.xp.every(xp => xp > 0));
  assert.ok(savedAfterWin.summary.kuizhi > 0);
  await host.click("#g-explore-back");
  await host.waitForSelector("#scr-trpg:not([hidden])");
  for (const page of [host, alice, bob]) await page.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  assert.match(await host.locator("#tr-log").innerText(), /战斗胜利/);
  const savedAfterReturn = await host.evaluate(() => { const slots = trpgReadSlots(); return { summary: trpgSlotSummary(slots[0]), log: slots[0].log, others: slots.slice(1) }; });
  assert.equal(savedAfterReturn.summary.name, savedAfterWin.summary.name);
  assert.equal(savedAfterReturn.summary.kuizhi, savedAfterWin.summary.kuizhi);
  assert.deepEqual(savedAfterReturn.log, savedAfterWin.log);
  assert.ok(savedAfterReturn.others.every(slot => !slot));
  for (const { result, visible } of playerResults) {
    assert.equal(result.grade.grade, hostGrade, "player result must preserve the actual grade: " + JSON.stringify(result));
    assert.match(visible, /战斗胜利/, "the public result must also be rendered for the player");
  }
  assert.deepEqual(f.errors, []);
});

test("D3 game sessions: host reload during a reaction preserves remaining time and refusals without replaying the attack", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob, aliceId, bobId } = f;
  await host.evaluate(({ aliceId, bobId }) => {
    OnlineGame.assign(Object.fromEntries(partyHeroes().filter(u => ["hiaki", "yuito"].includes(u.kit)).map(u => [u.id, u.kit === "hiaki" ? aliceId : bobId])));
    OnlineGame.start(); TrpgFlow.toBattle(); GAME.skip = true; GAME.instant = true; GAME.startOrEnd();
  }, { aliceId, bobId });
  await host.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  const heroes = await host.evaluate(() => HotseatGame.getView().heroes);
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(hero.owner === aliceId ? alice : hero.owner === bobId ? bob : host, { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  const attack = await host.evaluate(() => ({ type: "gm.forceAttack", input: {
    dmAtk: state.units.find(u => !u.isPlayer).id, dmTgt: partyHeroes().find(u => u.kit === "ruby").id,
    dmEle: "physical", dmMult: 0, dmFlat: 1, dmBrk: 0, dmSkipBlock: false
  } }));
  await host.evaluate(command => { window.interruptedAttack = null; OnlineGame.submit(command).then(result => { window.interruptedAttack = result; }); }, attack);
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.getView().packet?.view?.ask?.eligible, null, { timeout: 5000 });
  const originalAsk = await alice.evaluate(() => OnlineGame.getView().packet.view.ask);
  assert.equal(originalAsk.kind, "block");
  assert.equal((await submit(bob, { type: "answer", askId: originalAsk.id, helper: null, extra: {} })).ok, true);
  await bob.waitForFunction(() => OnlineGame.getView().packet.view.ask?.declined);
  // Real elapsed time makes a fresh 20-second question distinguishable from
  // continuation. Neither the clock nor saved authority is altered by the test.
  await host.waitForTimeout(2200);
  const pending = await host.evaluate(() => ({
    jobSeq: state.jobSeq, job: state.blockQueue[0].seq,
    remaining: HotseatGame.checkpoint().askRemainingMs,
    helpers: partyHeroes().map(u => ({ id: u.id, bonus: u.bonus }))
  }));
  assert.ok(pending.remaining > 10000 && pending.remaining < 18500);
  await host.reload(); await host.waitForFunction(() => !!window.OnlineGame);
  await alice.waitForFunction(() => OnlineGame.isPaused());
  await host.evaluate(async () => { GAME.skip = true; GAME.instant = true; await OnlineGame.resume(); });
  await alice.waitForFunction(oldId => !OnlineGame.isPaused() && OnlineGame.getView().packet?.view?.ask?.eligible && OnlineGame.getView().packet.view.ask.id !== oldId, originalAsk.id, { timeout: 5000 });
  await bob.waitForFunction(oldId => OnlineGame.getView().packet?.view?.ask?.id !== oldId && OnlineGame.getView().packet?.view?.ask?.declined, originalAsk.id, { timeout: 5000 });
  const restored = await alice.evaluate(() => ({ ask: OnlineGame.getView().packet.view.ask, remaining: OnlineGame.getView().packet.view.ask.deadline - Date.now() }));
  assert.ok(restored.remaining > 0 && restored.remaining <= pending.remaining + 250, "recovery must retain the remaining duration instead of granting another 20 seconds");
  assert.deepEqual(await host.evaluate(() => ({ jobSeq: state.jobSeq, job: state.blockQueue[0].seq })), { jobSeq: pending.jobSeq, job: pending.job });
  const stale = await submit(alice, { type: "answer", askId: originalAsk.id, helper: originalAsk.options[0].helper, extra: originalAsk.options[0].extra || {} });
  assert.equal(stale.ok, false, "the pre-refresh question cannot be answered again"); assert.equal(stale.type, "ack");
  const option = restored.ask.options[0]; assert.ok(option);
  assert.equal((await submit(bob, { type: "answer", askId: restored.ask.id, helper: option.helper, extra: option.extra || {} })).ok, false, "a declined player cannot answer for another player's helper after recovery");
  const accepted = await submit(alice, { type: "answer", askId: restored.ask.id, helper: option.helper, extra: option.extra || {} });
  assert.equal(accepted.ok, true, JSON.stringify({ accepted, ask: restored.ask, current: await alice.evaluate(() => OnlineGame.getView().packet.view.ask) }));
  await host.waitForFunction(() => !HotseatGame.hasAsk() && GAME.depth === 0 && !state.blockQueue.length, null, { timeout: 5000 });
  const completed = await host.evaluate(id => ({
    jobSeq: state.jobSeq, bonus: unitById(id).bonus,
    locked: HotseatGame.getView().order.find(row => row?.actor === id).locked,
    attacks: Commands.history().filter(row => row.command.type === "gm.forceAttack").length,
    answers: Commands.history().filter(row => row.command.type === "blockAnswer").length,
    phase: state.combatPhase
  }), option.helper);
  assert.equal(completed.jobSeq, pending.jobSeq, "the restored queue settles the existing hit rather than issuing a second attack");
  assert.equal(completed.attacks, 0); assert.equal(completed.answers, 1);
  assert.equal(completed.bonus, pending.helpers.find(u => u.id === option.helper).bonus - 1);
  assert.equal(completed.locked, true); assert.equal(completed.phase, "player");
  assert.deepEqual(f.errors, []);
});
