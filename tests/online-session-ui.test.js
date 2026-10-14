"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { execSync } = require("node:child_process");
const { createLocalRelayServer } = require("../relay/local-server.cjs");
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_RELAY = process.env.BACKFIRE_PUBLIC_RELAY || "";
const PUBLIC_PORT = Number(process.env.BACKFIRE_PUBLIC_TEST_PORT || 8080);
if (PUBLIC_RELAY) {
  const url = new URL(PUBLIC_RELAY);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("BACKFIRE_PUBLIC_RELAY must be an HTTPS relay URL without credentials, query or fragment");
  if (!Number.isInteger(PUBLIC_PORT) || PUBLIC_PORT < 1 || PUBLIC_PORT > 65535) throw new Error("BACKFIRE_PUBLIC_TEST_PORT must be an available port from 1 to 65535");
}
async function publicScreenshot(t, page, name) {
  if (!PUBLIC_RELAY) return;
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "backfire-public-"));
  const filename = path.join(directory, name + ".png");
  await page.screenshot({ path: filename, fullPage: false }); t.diagnostic("PUBLIC VIEWPORT SCREENSHOT: " + filename);
}
async function assertPlayerIsolation(page) {
  const actual = await page.evaluate(() => ({
    legacy: [...document.body.children].filter(node => !node.matches(".ol-ui, .hs-ui") && getComputedStyle(node).display !== "none").map(node => node.tagName + (node.id ? "#" + node.id : "")),
    documentHeight: document.documentElement.scrollHeight, bodyHeight: document.body.scrollHeight, viewport: innerHeight
  }));
  assert.deepEqual(actual.legacy, [], "a remote player's page must hide every legacy top-level game/GM panel");
  assert.ok(actual.documentHeight <= actual.viewport + 1 && actual.bodyHeight <= actual.viewport + 1, "only online panels may scroll; the outer page must not expose legacy content: " + JSON.stringify(actual));
}
async function assertHostControlsClickable(page, screen, t, label = screen) {
  assert.equal(await page.evaluate(() => OnlineGame.getView().screen), screen);
  const original = page.viewportSize();
  const sizes = [[1440, 900], [768, 1024], [390, 844], [320, 568], [844, 390], [568, 320]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const tools = page.locator("#ogm-toggle"), room = page.locator('#online-dock [data-online="openRoom"]');
    await tools.waitFor({ state: "visible" }); await room.waitFor({ state: "visible" });
    const [toolRect, roomRect] = await Promise.all([tools.boundingBox(), room.boundingBox()]);
    const context = JSON.stringify({ screen, label, width, height, toolRect, roomRect });
    for (const rect of [toolRect, roomRect]) assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1, "both host controls must remain inside the viewport: " + context);
    const overlapping = Math.max(toolRect.x, roomRect.x) < Math.min(toolRect.x + toolRect.width, roomRect.x + roomRect.width) && Math.max(toolRect.y, roomRect.y) < Math.min(toolRect.y + toolRect.height, roomRect.y + roomRect.height);
    assert.equal(overlapping, false, "host tools and room controls must not overlap: " + context);
    // Exercise the browser's normal hit testing on the complete game page.
    // Forced clicks/DOM-dispatched events would hide the original regression.
    await tools.click({ timeout: 3000 });
    await page.locator("#ogm-panel").waitFor({ state: "visible" });
    assert.match(await page.locator("#ogm-panel h2").innerText(), /主持人工具/);
    await page.locator('#ogm-panel [data-action="close"]').click({ timeout: 3000 });
    await page.locator("#ogm-panel").waitFor({ state: "hidden" });
    await room.click({ timeout: 3000 });
    await page.locator("#online-panel").waitFor({ state: "visible" });
    assert.match(await page.locator("#online-panel").innerText(), /房间成员/);
    await page.locator('#online-panel [data-online="close"]').click({ timeout: 3000 });
    await page.locator("#online-panel").waitFor({ state: "hidden" });
    if (process.env.BACKFIRE_CAPTURE_CONTROLS === "1" && [1440, 390].includes(width)) {
      const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "backfire-controls-"));
      const filename = path.join(directory, label + "-" + width + "px.png");
      await page.screenshot({ path: filename, fullPage: false }); t.diagnostic("HOST CONTROLS SCREENSHOT: " + filename);
    }
  }
  await page.setViewportSize(original);
}
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
  await new Promise((resolve, reject) => { website.once("error", reject); website.listen(PUBLIC_RELAY ? PUBLIC_PORT : 0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => website.close(resolve)));
  const origin = "http://127.0.0.1:" + website.address().port;
  const relay = PUBLIC_RELAY ? { url: PUBLIC_RELAY } : await createLocalRelayServer({ origins: [origin] });
  if (!PUBLIC_RELAY) t.after(() => relay.close());
  else t.diagnostic("PUBLIC RELAY: " + PUBLIC_RELAY + "; browser origin " + origin + "; no local workerd started");
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
  for (const page of [alice, bob]) await assertPlayerIsolation(page);
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id), bobId = await bob.evaluate(() => OnlineGame.getView().identity.id);
  await host.evaluate(({ aliceId, bobId }) => OnlineGame.assign(Object.fromEntries(HotseatGame.getView().heroes.slice(0, 2).map((hero, i) => [hero.id, i === 0 ? aliceId : bobId]))), { aliceId, bobId });
  return { host, alice, bob, aliceId, bobId, pages, errors, wire, origin, relayUrl: relay.url };
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
    OnlineGame.start();
  }, { aliceId, bobId });
  await host.waitForSelector("#scr-trpg:not([hidden])");
  await assertHostControlsClickable(host, "exploration", t);
  await host.evaluate(() => { TrpgFlow.toBattle(); GAME.skip = true; GAME.instant = true; });
  const enemyControl = await host.evaluate(() => { const ai = state.units.find(u => !u.isPlayer && u.kit === "thug_knife"); return { ai: ai.id, manual: state.units.filter(u => !u.isPlayer && u.id !== ai.id).map(u => u.id) }; });
  assert.equal((await submit(host, { type: "gm.setManual", actors: enemyControl.manual, enabled: true })).ok, true);
  await host.evaluate(() => { GAME.startOrEnd(); });
  await host.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0);
  const heroes = await host.evaluate(aliceId => HotseatGame.getView().heroes.sort((a, b) => Number(b.owner === aliceId) - Number(a.owner === aliceId)), aliceId);
  const pageFor = owner => owner === aliceId ? alice : owner === bobId ? bob : host;
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(pageFor(hero.owner), { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  await assertHostControlsClickable(host, "battle", t);
  const actor = heroes[0].id;
  const first = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "hiaki_summon" }), actor);
  assert.equal(first.choices.kind, "choice"); assert.equal(first.choices.key, "blade");
  assert.ok(first.choices.options.some(option => option.value === "niu"));
  const ready = await alice.evaluate(actor => OnlineGame.actionMenu({ actor, skill: "hiaki_summon", picks: { blade: "niu" } }), actor);
  assert.equal(ready.choices.kind, "ready"); assert.equal((await submit(alice, ready.choices.command)).ok, true);
  await alice.waitForFunction(() => OnlineGame.getView().packet.view.order.length === 5);
  const weapon = await host.evaluate(() => state.units.find(u => u.kit === "niu" && !u.hidden).id);
  const order = await host.evaluate(() => HotseatGame.getView().order);
  // 召唤出的武器人紧挨着本人（在本人前一格），并且立刻轮到它
  const wi = order.findIndex(row => row && row.actor === weapon), hi = order.findIndex(row => row && row.actor === actor);
  assert.equal(wi, hi - 1); assert.equal(order[wi].owner, aliceId);
  assert.equal(await host.evaluate(() => HotseatGame.getView().currentUnitId), weapon);
  assert.equal((await submit(bob, { type: "move", actor: weapon, dest: 2 })).ok, false);
  const rows = order.filter(row => row && !row.done), last = rows.at(-1);
  for (const row of rows.slice(0, -1)) assert.equal((await submit(pageFor(row.owner), { type: "endTurn", actor: row.actor })).ok, true);
  await pageFor(last.owner).evaluate(cmd => { window.roundResult = null; OnlineGame.submit(cmd).then(result => { window.roundResult = result; }); }, { type: "endTurn", actor: last.actor });
  try { await host.waitForFunction(() => OnlineGame.getView().manualPhase && state.combatPhase === "enemy", null, { timeout: 5000 }); }
  catch (error) { throw new Error(error.message + " " + JSON.stringify(await host.evaluate(() => ({ depth: GAME.depth, phase: HotseatGame.getView().phase, ask: HotseatGame.getView().ask, combatPhase: state.combatPhase, manual: GMCommands.snapshot(), notice: OnlineGame.getView().notice, last: JSON.parse(localStorage.getItem("backfire-online-v1")).requests.slice(-1).map(entry => entry[1].response) }))) + " player=" + JSON.stringify(await pageFor(last.owner).evaluate(() => window.roundResult)) + " errors=" + JSON.stringify(f.errors)); }
  assert.match(await host.locator("#ogm-toggle").innerText(), /敌人待操作/);
  await assertHostControlsClickable(host, "battle", t, "manual-enemy");
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
  await pageFor(last.owner).waitForFunction(() => !!window.roundResult);
  const roundResult = await pageFor(last.owner).evaluate(() => window.roundResult); assert.equal(roundResult.ok, true, JSON.stringify(roundResult));
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
  await assertPlayerIsolation(bob); await publicScreenshot(t, bob, "player-390px-victory");
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
  await assertPlayerIsolation(bob); await publicScreenshot(t, bob, "player-390px-exploration");
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

// Explicit opt-in: this fourth case creates one additional short-lived room on
// the supplied public service. The ordinary local suite remains three cases.
if (PUBLIC_RELAY) test("D3 public relay: five display latency samples, version rejection, private messages and 30-second recovery", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob, aliceId, pages } = f;
  const roomCode = await host.evaluate(() => OnlineGame.getView().roomCode);
  for (const mismatch of ["protocol", "build"]) {
    const rejected = await alice.evaluate(async ({ url, roomCode, mismatch }) => {
      try {
        const endpoint = await RelayTransport.join({ url, roomCode, name: "Version rejection probe", autoReconnect: false,
          protocol: OnlineGame.PROTOCOL + (mismatch === "protocol" ? 1 : 0), build: OnlineGame.BUILD + (mismatch === "build" ? "-wrong" : "") });
        endpoint.close(); return { accepted: true };
      } catch (error) { return { accepted: false, error: error.message }; }
    }, { url: f.relayUrl, roomCode, mismatch });
    assert.equal(rejected.accepted, false, mismatch + " mismatch must be rejected"); assert.match(rejected.error, /版本/);
  }
  assert.equal(await host.evaluate(() => OnlineGame.getView().players.length), 3, "rejected versions must not acquire player seats");
  const privateText = "PUBLIC_PRIVATE_" + Date.now();
  assert.equal((await submit(host, { type: "gm.msg", to: aliceId, text: privateText })).ok, true);
  await alice.waitForFunction(text => OnlineGame.getView().messages.some(m => m.text === text), privateText);
  assert.ok(!(await bob.evaluate(() => JSON.stringify(OnlineGame.getView()))).includes(privateText));

  const samples = [];
  for (let sample = 1; sample <= 5; sample++) {
    const text = "PUBLIC_LATENCY_" + sample + "_" + Date.now();
    await Promise.all(pages.map(page => page.evaluate(text => {
      window.publicLatency = { text, displayedAt: null };
      const panel = document.getElementById("online-panel");
      const observer = new MutationObserver(() => {
        const paragraph = [...panel.querySelectorAll(".ol-messages li p")].find(p => p.textContent === text);
        if (paragraph && paragraph.getClientRects().length && !panel.hidden) {
          publicLatency.displayedAt = performance.timeOrigin + performance.now(); observer.disconnect();
        }
      });
      observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }, text)));
    // Measure to the real message DOM update, without combat animation, rather
    // than relay ACK time or a polling interval. All contexts share this host's
    // wall clock; this is one network location, not cross-device clock sync.
    const sent = await host.evaluate(async text => {
      const startedAt = performance.timeOrigin + performance.now();
      const ack = await OnlineGame.submit({ type: "gm.msg", to: "all", text }); return { startedAt, ack };
    }, text);
    assert.equal(sent.ack.ok, true);
    await Promise.all(pages.map(page => page.waitForFunction(() => window.publicLatency.displayedAt !== null)));
    const times = await Promise.all(pages.map(page => page.evaluate(() => publicLatency.displayedAt)));
    const recipients = times.map((at, index) => ({ recipient: ["host", "Alice", "Bob-390px"][index], milliseconds: Math.round((at - sent.startedAt) * 10) / 10 }));
    assert.ok(recipients.every(row => row.milliseconds >= 0));
    samples.push({ sample, recipients, allDisplayedMs: Math.max(...recipients.map(row => row.milliseconds)) });
  }
  const sorted = samples.map(row => row.allDisplayedMs).sort((a, b) => a - b);
  t.diagnostic("PUBLIC NETWORK DISPLAY LATENCY (real message DOM commit; no combat animation; one desktop/network location): " + JSON.stringify({ samples, medianMs: sorted[2], maxMs: sorted[4], over1500ms: sorted.filter(ms => ms > 1500).length }));

  const identities = await Promise.all(pages.map(page => page.evaluate(() => OnlineGame.getView().identity)));
  const disconnectedAt = Date.now();
  // Navigation destroys the real host WebSocket and runtime. Only the saved
  // local room checkpoint and token survive; nothing auto-rejoins for 30 s.
  await host.goto("about:blank");
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.isPaused() && !OnlineGame.getView().status.hostOnline);
  assert.equal((await submit(alice, { type: "gmReply", text: "must not be sent while paused" })).ok, false);
  await host.waitForTimeout(Math.max(0, 30000 - (Date.now() - disconnectedAt)));
  assert.ok(Date.now() - disconnectedAt >= 30000);
  t.diagnostic("PUBLIC HOST INTERRUPTION: " + (Date.now() - disconnectedAt) + " ms before restoring the saved identity");
  await host.goto(f.origin + "/game.html"); await host.waitForFunction(() => !!window.OnlineGame);
  await host.evaluate(() => OnlineGame.resume());
  for (const page of [host, alice, bob]) await page.waitForFunction(() => !OnlineGame.isPaused());
  assert.deepEqual(await host.evaluate(() => OnlineGame.getView().identity), identities[0]);
  const after = "PUBLIC_AFTER_RECOVERY_" + Date.now();
  assert.equal((await submit(alice, { type: "gmReply", text: after })).ok, true);
  await host.waitForFunction(text => OnlineGame.getView().messages.some(m => m.text === text), after);
  await bob.reload(); await bob.waitForFunction(() => !!window.OnlineGame); await bob.evaluate(() => OnlineGame.resume());
  await bob.waitForFunction(() => !!OnlineGame.getView().packet?.state && !OnlineGame.isPaused());
  assert.deepEqual(await bob.evaluate(() => OnlineGame.getView().identity), identities[2]);
  assert.deepEqual(await alice.evaluate(() => OnlineGame.getView().identity), identities[1]);
  assert.ok(!JSON.stringify(f.wire.filter(row => row.page === 2)).includes(privateText), "private content must stay absent from Bob's public-network frames");
  assert.deepEqual(f.errors, []);
});

test("联机：玩家能看角色资料 / 武器 / 背包；小队聊天全程可用；输入法拼字不被打断", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob } = f;
  const shot = async (page, name) => { if (process.env.BACKFIRE_SHOTS) await page.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, name + ".png") }); };
  await host.evaluate(() => { OnlineGame.start(); bagAdd("medkit", 2); });
  await host.evaluate(() => OnlineGame.queueHostEdit(() => {}));
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !document.getElementById("online-side").hidden);
  // 探索时右侧栏默认就是小队频道
  assert.equal(await alice.evaluate(() => document.getElementById("online-side").dataset.tab), "chat");
  // 小队聊天：玩家发、所有人都看得到
  await alice.fill("#ol-side-text", "我们先去黑市");
  await alice.click("#ol-side-form button[type=submit]");
  await host.waitForFunction(() => HotseatGame.getView().chat.some(m => m.text === "我们先去黑市"));
  await bob.waitForFunction(() => /我们先去黑市/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  assert.equal(await alice.inputValue("#ol-side-text"), "", "发出去后清空输入框");
  // 主持人：探索记录栏有「探索 / 小队」频道，也能直接回
  await host.locator('.tr-log [data-host-tab="chat"]').click();
  assert.match(await host.locator(".tr-log .ol-host-chat").innerText(), /我们先去黑市/);
  await host.fill(".tr-log .ol-host-chat input", "好的路上小心");
  await host.click(".tr-log .ol-host-chat button[type=submit]");
  try { await host.waitForFunction(() => HotseatGame.getView().chat.some(m => m.text === "好的路上小心"), null, { timeout: 5000 }); }
  catch (e) { throw new Error("主持人消息没发出去：" + JSON.stringify(await host.evaluate(() => ({ notice: OnlineGame.getView().notice, input: document.querySelector(".tr-log .ol-host-chat input").value, chat: HotseatGame.getView().chat })))); }
  await alice.waitForFunction(() => /好的路上小心/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  // 输入法拼字中：别人发消息时，输入框不被换掉，拼到一半的内容还在
  await bob.click("#ol-side-text");
  await bob.evaluate(() => { window.__inp = document.getElementById("ol-side-text"); window.__inp.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); window.__inp.value = "wo m"; });
  await alice.fill("#ol-side-text", "Bob 你看看背包");
  await alice.click("#ol-side-form button[type=submit]");
  await bob.waitForFunction(() => /Bob 你看看背包/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  assert.deepEqual(await bob.evaluate(() => ({ same: document.getElementById("ol-side-text") === window.__inp, value: window.__inp.value, focused: document.activeElement === window.__inp })), { same: true, value: "wo m", focused: true });
  // 房间面板里的私信框：拼字时整个面板不重画
  await bob.evaluate(() => { window.__inp.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); window.__inp.value = ""; });
  await bob.click('#online-dock [data-online="openRoom"]');
  await bob.click("#ol-message");
  await bob.evaluate(() => { window.__ta = document.getElementById("ol-message"); window.__ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); window.__ta.value = "zhu chi"; });
  await host.evaluate(() => OnlineGame.submit({ type: "gm.msg", to: "all", text: "全体注意天快黑了" }));
  await bob.waitForFunction(() => OnlineGame.getView().messages.some(m => m.text === "全体注意天快黑了"));
  await bob.waitForTimeout(200);
  assert.deepEqual(await bob.evaluate(() => ({ same: document.getElementById("ol-message") === window.__ta, value: window.__ta.value })), { same: true, value: "zhu chi" });
  await bob.evaluate(() => window.__ta.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await bob.waitForFunction(() => /全体注意天快黑了/.test(document.getElementById("online-panel").textContent), null, { timeout: 5000 });
  await bob.click('#online-panel [data-online="close"]');
  // 角色资料：玩家自己的英雄，完整技能和被动，但没有坚毅生命数值
  const data = await alice.evaluate(() => OnlineGame.sheetData());
  assert.ok(data.sheets.length >= 2, "队伍里的英雄资料都在");
  assert.ok(!/"shp/.test(JSON.stringify(data)), "坚毅生命数值不发给玩家");
  assert.ok(data.sheets.every(s => s.passives.length && (s.skills.now.length + s.skills.later.length)), "被动和技能都在");
  await shot(alice, "1-player-exploration"); await shot(host, "2-host-exploration"); await shot(bob, "3-player-mobile");
  await alice.click('[data-online="info"][data-info="sheet"]');
  await alice.waitForSelector("#hero-sheet.show");
  await shot(alice, "4-player-sheet");
  const myName = await alice.evaluate(() => { const v = OnlineGame.getView(); const mine = v.packet.view.units.find(u => u.owner === v.identity.id); return mine.name; });
  assert.match(await alice.locator("#hero-sheet").innerText(), new RegExp(myName));
  await alice.click("#hs-close");
  await alice.click('[data-online="info"][data-info="armory"]');
  await alice.waitForSelector("#armory-sheet.show");
  await alice.keyboard.press("Escape").catch(() => {});
  await alice.evaluate(() => document.getElementById("armory-sheet").classList.remove("show"));
  // 背包：名字、数量、说明
  await alice.click('[data-online="info"][data-info="bag"]');
  await alice.waitForSelector("#online-bag:not([hidden])");
  await shot(alice, "5-player-bag");
  const bagText = await alice.locator("#online-bag").innerText();
  assert.match(bagText, /简易医疗包/); assert.match(bagText, /× 2/); assert.match(bagText, /1d4\+6/);
  await alice.click('#online-bag [data-bag="close"]');
  // 战斗中：右侧栏变成「战斗 / 小队」，默认战斗频道，也能切到小队聊天
  await host.evaluate(() => { TrpgFlow.toBattle(); GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  assert.equal(await alice.locator('#online-side [data-side="log"]').innerText(), "战斗");
  assert.equal(await alice.evaluate(() => document.getElementById("online-side").dataset.tab), "log");
  await host.evaluate(() => OnlineGame.submit({ type: "chat", text: "战斗中也能说话" }));
  await alice.waitForFunction(() => !document.querySelector('#online-side [data-side="chat"] .ol-badge').hidden, null, { timeout: 5000 });
  try { await alice.click('#online-side [data-side="chat"]', { timeout: 4000 }); }
  catch (e) { throw new Error("点不到小队频道：" + JSON.stringify(await alice.evaluate(() => { const p = document.getElementById("hs-panel"), r = p.getBoundingClientRect(), cs = getComputedStyle(p); return { body: document.body.className, right: cs.right, rect: [r.x, r.y, r.width, r.height], side: document.getElementById("online-side").getBoundingClientRect().x, w: innerWidth }; }))); }
  assert.match(await alice.locator("#online-side .ol-side-chat").innerText(), /战斗中也能说话/);
  await shot(alice, "6-player-battle-chat");
  await alice.fill("#ol-side-text", "收到");
  await alice.click("#ol-side-form button[type=submit]");
  await host.waitForFunction(() => HotseatGame.getView().chat.some(m => m.text === "收到"));
  // 主持人战斗记录栏也有「战斗 / 小队」
  await host.locator('#g-log [data-host-tab="chat"]').click();
  assert.match(await host.locator("#g-log .ol-host-chat").innerText(), /收到/);
  await shot(host, "7-host-battle-chat");
  await host.locator('#g-log [data-host-tab="log"]').click();
  assert.equal(await host.locator("#g-logs").isVisible(), true);
  for (const page of [alice, bob]) await assertPlayerIsolation(page);
  assert.deepEqual(f.errors, []);
});

test("联机：主持人用战斗模板开战，玩家一进战斗就看到摆好的战场", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice } = f;
  const shot = async (page, name) => { if (process.env.BACKFIRE_SHOTS) await page.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, name + ".png") }); };
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => battleTemplateSave({ name: "桥头伏击", board: 3, weather: "snow", playerZone: 1,
    enemies: [{ preset: "thug_knife", level: 2, zone: 3 }, { preset: "thug_hammer", level: 2, zone: 2 }],
    fields: { 2: { acid: true } }, gaps: { "2-3": { type: "wall", hp: 30 } }, props: [{ kind: "boom", zone: 2, faction: "enemy" }] }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await shot(host, "tpl-1-host-templates");
  await host.click('[data-bt^="fight:"]');
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  await alice.waitForFunction(() => (OnlineGame.getView().packet?.state?.units || []).filter(u => !u.isPlayer).length === 2);
  const seen = await alice.evaluate(() => { const s = OnlineGame.getView().packet.state; return { zoneMode: s.zoneMode, weather: s.weather, foes: s.units.filter(u => !u.isPlayer).map(u => u.zone).sort(), props: (s.props || []).length, wall: (s.gaps || {})["2-3"]?.type, started: !!s.combatStarted }; });
  assert.deepEqual(seen, { zoneMode: 3, weather: "snow", foes: [2, 3], props: 1, wall: "wall", started: false });
  await shot(alice, "tpl-2-player-battle"); await shot(host, "tpl-3-host-battle");
  assert.deepEqual(f.errors, []);
});

test("联机：四区方形棋盘，玩家画面摆成 2×2，4 区和所有间隙都看得到", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice } = f;
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => battleTemplateSave({ name: "仓库", board: "square4", enemies: [{ preset: "thug_knife", level: 1, zone: 4 }], fields: { 4: { ice: true } }, gaps: { "2-4": { type: "wall", hp: 20 } } }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt^="fight:"]');
  await alice.waitForFunction(() => document.querySelectorAll("#online-stage .ol-battle .g-zone").length === 4);
  const r = await alice.evaluate(() => {
    const zone = id => document.querySelector(`#online-stage .ol-battle .g-zone[data-num="${id}"]`);
    const [b1, b2, b3, b4] = [1, 2, 3, 4].map(id => zone(id).getBoundingClientRect());
    const gap = k => (document.querySelector(`#online-stage .ol-battle .g-gap[data-key="${k}"]`) || {}).textContent || "";
    return { grid: Math.abs(b1.top - b2.top) < 2 && Math.abs(b3.top - b4.top) < 2 && b3.top > b1.bottom - 1 && Math.abs(b1.left - b3.left) < 2,
      foeIn4: /狂徒/.test(zone(4).textContent), ice4: /冻土/.test(zone(4).textContent), ice4cls: zone(4).classList.contains("field-ice"),
      gap24: gap("2-4"), gap13: gap("1-3") };
  });
  assert.equal(r.grid, true, "2×2 排版（和战斗画面同一种棋盘）");
  assert.equal(r.foeIn4, true);
  assert.equal(r.ice4, true);
  assert.equal(r.ice4cls, true);
  assert.match(r.gap24, /危墙\s*20/);
  assert.match(r.gap13, /畅通/);
  if (process.env.BACKFIRE_SHOTS) await alice.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, "board-square4.png") });
  assert.deepEqual(f.errors, []);
});

test("联机：按钮掷 d100 / 主持人暗骰；主持人发起检定、玩家自己掷；玩家申请属性点、主持人同意后才加上", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob } = f;
  const shot = async (page, name) => { if (process.env.BACKFIRE_SHOTS) await page.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, name + ".png") }); };
  await host.evaluate(() => { OnlineGame.start(); });
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !document.getElementById("online-side").hidden);
  // 掷骰：按钮 → 选熟练项 → 掷 d100
  await alice.click('#online-side [data-roll-open]');
  await alice.waitForSelector("#online-roll:not([hidden]) #ol-roll-prof");
  await alice.selectOption("#ol-roll-prof", "数据操作");
  assert.match(await alice.locator("#online-roll").innerText(), /二级熟练[\s\S]*大成功 ≤5 · 极难 ≤25 · 困难 ≤50 · 普通 \/ 简单 ≤100/, "瑞比数据操作二级");
  await alice.fill("#ol-roll-note", "黑进门禁");
  await shot(alice, "roll-dialog");
  await alice.click('#online-roll [data-roll="go"]');
  await bob.waitForFunction(() => /掷骰 · 瑞比「数据操作」二级熟练[:：]d100 \d+ → (大成功|极难成功|困难成功|普通成功|简单成功|失败)[(（]黑进门禁[)）]/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  await alice.waitForSelector("#online-roll", { state: "hidden" });
  assert.equal(await alice.locator("#ol-roll-secret").count(), 0, "玩家没有暗骰选项");
  // 主持人暗骰
  await host.click('#tr-tabs [data-tab="party"]');
  await host.locator('.tr-log [data-host-tab="chat"]').click();
  await host.click('.tr-log [data-roll-open]');
  await host.check("#ol-roll-secret");
  await host.click('#online-roll [data-roll="go"]');
  await host.waitForFunction(() => HotseatGame.getView().chat.some(m => m.secret && /^暗骰 · /.test(m.text)));
  await alice.waitForTimeout(300);
  assert.ok(!/暗骰/.test(await alice.evaluate(() => JSON.stringify(OnlineGame.getView()))), "玩家收不到暗骰");
  // 检定：主持人在「检定」页发起
  await host.click('#tr-tabs [data-tab="checks"]');
  await host.selectOption("#ck-prof", "侦察");
  await host.selectOption("#ck-diff", "easy");
  await host.fill("#ck-note", "看看门后有什么");
  await host.click("#ck-open");
  await alice.waitForSelector('#online-stage [data-online="checkRoll"]');
  await shot(alice, "check-1-player");
  assert.equal(await alice.locator('#online-stage [data-online="checkRoll"]').count(), 1, "只能掷自己的角色");
  await alice.click('#online-stage [data-online="checkRoll"]');
  await bob.waitForFunction(() => /检定 · .+「侦察」简单/.test(document.querySelector("#online-side .ol-side-chat").textContent));
  await host.waitForFunction(() => /成功|失败/.test(document.getElementById("tr-panel").textContent) && /代掷/.test(document.getElementById("tr-panel").textContent));
  await shot(host, "check-2-host");
  // 属性点：Alice 的角色有 1 点
  const mine = await alice.evaluate(() => { const v = OnlineGame.getView(); return v.packet.view.units.find(u => u.owner === v.identity.id).id; });
  await host.evaluate(id => OnlineGame.queueHostEdit(() => { state.units.find(u => u.id === id).attrPoints = 1; }), mine);
  await alice.waitForSelector('#online-stage [data-online="attrRequest"][data-attr="dex"]');
  await alice.click('#online-stage [data-online="attrRequest"][data-attr="dex"]');
  await alice.waitForFunction(() => /等主持人确认：敏捷 \+1/.test(document.getElementById("online-stage").textContent));
  await shot(alice, "attr-1-player");
  await host.click('#tr-tabs [data-tab="party"]');
  await host.waitForSelector('[data-attr-req^="approve:"]');
  const dexBefore = await host.evaluate(id => state.units.find(u => u.id === id).attrs.dex, mine);
  await host.click('[data-attr-req^="approve:"]');
  await host.waitForFunction(id => state.units.find(u => u.id === id).attrPoints === 0, mine);
  assert.equal(await host.evaluate(id => state.units.find(u => u.id === id).attrs.dex, mine), dexBefore + 1);
  await alice.waitForFunction(() => /主持人已同意/.test(document.getElementById("online-stage").textContent));
  assert.equal(await alice.locator('#online-stage [data-online="attrRequest"]').count(), 0);
  assert.deepEqual(f.errors, []);
});

test("联机：模板带的战斗掉落打赢后进背包，玩家结算里看得到；能看这场的战斗记录和最近 10 场战绩", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice } = f;
  const shot = async (page, name) => { if (process.env.BACKFIRE_SHOTS) await page.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, name + ".png") }); };
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => battleTemplateSave({ name: "仓库守卫", board: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }], drops: { kuizhi: 300, items: [{ id: "medkit", qty: 2 }] } }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt^="fight:"]');
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; });
  await host.evaluate(() => { GAME.startOrEnd(); });
  await host.waitForFunction(() => state.combatStarted && GAME.depth === 0);
  const before = await host.evaluate(() => ({ kz: Number(state.kuizhi) || 0, med: bagCount("medkit") }));
  for (const id of await host.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead && !u.hidden).map(u => u.id))) assert.equal((await submit(host, { type: "gm.removeUnit", actor: id, mode: "kill" })).ok, true);
  await host.waitForFunction(() => GAME.ended && GAME.lastOutcome === "win");
  const after = await host.evaluate(() => ({ kz: Number(state.kuizhi) || 0, med: bagCount("medkit") }));
  assert.ok(after.kz >= before.kz + 300, "掉落的奎支加在敌人自己掉的之外");
  assert.equal(after.med, before.med + 2);
  assert.match(await host.locator("#g-result").innerText(), /战斗掉落：300 奎支、简易医疗包×2/);
  await alice.waitForFunction(() => OnlineGame.getView().screen === "ended" && /战斗掉落/.test(document.getElementById("online-stage").textContent));
  assert.match(await alice.locator(".ol-result").innerText(), /300 奎支、简易医疗包 ×2/);
  await alice.click('#online-stage [data-online="showLog"]');
  assert.equal(await alice.evaluate(() => document.getElementById("online-side").dataset.tab), "log");
  await alice.click('.ol-result [data-online="info"][data-info="record"]');
  await alice.waitForSelector("#online-bag:not([hidden]) .ol-record");
  const rec = await alice.locator("#online-bag").innerText();
  assert.match(rec, /仓库守卫/);
  assert.match(rec, /胜利/);
  assert.match(rec, /掉落：300 奎支、简易医疗包×2/);
  await shot(alice, "record-player");
  assert.deepEqual(f.errors, []);
});

test("联机：编辑器做的模板掉落——房主开战后刷新页面、玩家自己打赢，回到探索后队伍背包和玩家背包里都有；战绩里这场名字还在", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob } = f;
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt="new:"]');
  await host.fill('[data-bte="name"]', "仓库守卫");
  await host.fill("[data-bt-dropkz]", "300");
  await host.selectOption("#bt-drop-item", "medkit"); await host.fill("#bt-drop-qty", "2");
  await host.click('[data-bt-act="addDrop"]'); await host.click('[data-bt-act="save"]');
  await host.click('[data-bt^="fight:"]');
  await host.evaluate(aliceId => OnlineGame.assign(Object.fromEntries(HotseatGame.getView().heroes.filter(h => h.name === "绯秋").map(h => [h.id, aliceId]))), f.aliceId);
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await host.waitForFunction(() => state.combatStarted && GAME.depth === 0);
  await host.reload(); await host.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
  await host.evaluate(async () => { GAME.skip = true; GAME.instant = true; await OnlineGame.resume(); });
  await host.waitForFunction(() => !OnlineGame.isPaused() && state.combatStarted && GAME.depth === 0);
  const before = await host.evaluate(() => ({ kz: Number(state.kuizhi) || 0, med: bagCount("medkit") }));
  // 敌人只剩 1 点血、和绯秋同区；绯秋排第一个，由 Alice 自己普通攻击打赢
  await host.evaluate(() => { state.units.forEach(u => { u.zone = 1; if (!u.isPlayer) { u.layers.forEach(l => { l.current = 0; }); u.layers[u.layers.length - 1].current = 1; u.def = 0; } }); });
  const heroes = await host.evaluate(() => HotseatGame.getView().heroes.slice().sort((a, b) => (b.name === "绯秋") - (a.name === "绯秋")));
  const pageFor = owner => owner === f.aliceId ? alice : owner === f.bobId ? bob : host;
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(pageFor(hero.owner), { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  await host.waitForFunction(() => HotseatGame.getView().currentUnitId && GAME.depth === 0);
  const cur = await host.evaluate(() => ({ actor: HotseatGame.getView().currentUnitId, target: state.units.find(u => !u.isPlayer && !u.dead).id }));
  const menu = await alice.evaluate(c => OnlineGame.actionMenu({ actor: c.actor, skill: "hiaki_aa", target: c.target }), cur);
  assert.equal(menu.choices.kind, "ready");
  assert.equal((await submit(alice, menu.choices.command)).ok, true);
  await host.waitForFunction(() => GAME.ended && GAME.lastOutcome === "win");
  await host.evaluate(() => TrpgFlow.backFromBattle());
  await host.waitForFunction(() => Screens.is("trpg"));
  const back = await host.evaluate(() => ({ kz: Number(state.kuizhi) || 0, med: bagCount("medkit") }));
  assert.ok(back.kz >= before.kz + 300); assert.equal(back.med, before.med + 2);
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  const bag = (await alice.evaluate(() => OnlineGame.sheetData())).bag;
  assert.equal(bag.kuizhi, back.kz); assert.equal(bag.items.find(x => x.id === "medkit").qty, back.med);
  await alice.click('[data-online="info"][data-info="record"]');
  await alice.waitForSelector("#online-bag:not([hidden]) .ol-record");
  const rec = await alice.locator("#online-bag").innerText();
  assert.match(rec, /仓库守卫/); assert.match(rec, /掉落：300 奎支、简易医疗包×2/);
  assert.deepEqual(f.errors, []);
});

test("联机跑团：玩家的角色升级只弹在这名玩家的画面上，带新技能说明；主持人操控的角色在主持人本机弹", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob } = f;
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  const kit = await host.evaluate(aliceId => { const h = HotseatGame.getView().heroes.find(x => x.owner === aliceId); const u = state.units.find(x => x.id === h.id); u.xp = xpToNext(u.level) ; tryLevelUp(u); OnlineGame.touch(); return u.kit; }, f.aliceId);
  await alice.waitForSelector("#online-levelup:not([hidden]) .lvu-card");
  assert.match(await alice.locator("#online-levelup").innerText(), /升到 \d+ 级/);
  await new Promise(r => setTimeout(r, 900));
  assert.equal(await bob.locator("#online-levelup:not([hidden])").count(), 0);
  assert.equal(await host.locator("#g-levelup:not([hidden])").count(), 0);
  await alice.click('#online-levelup [data-lvu="ok"]');
  await host.waitForFunction(() => !LevelUp.unseen().length);
  // 主持人操控的角色（没分配的）：主持人本机弹
  await host.evaluate(() => { const own = OnlineGame.getView().identity.id; const h = HotseatGame.getView().heroes.find(x => x.owner === own); const u = state.units.find(x => x.id === h.id); u.xp = xpToNext(u.level); tryLevelUp(u); });
  await host.waitForSelector("#g-levelup:not([hidden]) .lvu-card");
  await host.click('#g-levelup [data-lvu="ok"]');
  assert.ok(kit);
  assert.deepEqual(f.errors, []);
});

test("联机：模板配了援军和连续战斗，玩家画面顶上也有点线点和援军倒计时；打完第一场一起去下一个区域", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice } = f;
  await host.evaluate(() => { OnlineGame.start(); window.__noLevelUpPopup = true; });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => {
    const a = battleTemplateSave({ name: "B 区", board: 3, enemies: [{ preset: "thug_knife", level: 1, zone: 3 }] });
    battleTemplateSave({ name: "A 区", board: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }], waves: [{ turns: 3, enemies: [{ preset: "thug_hammer", level: 1, zone: 2 }] }], chain: [a.id] });
  });
  await host.click('#tr-tabs [data-tab="battles"]');
  const id = await host.evaluate(() => battleTemplateList().find(x => x.name === "A 区").id);
  await host.click(`[data-bt="fight:${id}"]`);
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await host.waitForFunction(() => state.combatStarted && GAME.depth === 0);
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle" && !!document.querySelector("#online-stage .ol-chain"));
  const bar = await alice.locator("#online-stage .ol-chain").innerText();
  assert.match(bar, /第 1 \/ 2 场/); assert.match(bar, /援军 1 个 · 3 回合后抵达 2 区/);
  assert.equal(await alice.locator("#online-stage .ol-chain .ch-dot").count(), 2);
  // 场上的敌人打光：援军提前到下一回合
  for (const uid of await host.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead).map(u => u.id))) assert.equal((await submit(host, { type: "gm.removeUnit", actor: uid, mode: "kill" })).ok, true);
  await alice.waitForFunction(() => /下回合抵达/.test(document.querySelector("#online-stage .ol-chain")?.textContent || ""));
  assert.equal(await host.evaluate(() => GAME.ended), false);
  // 援军也打掉（直接放上场再击杀），第一场结束：去 B 区
  await host.evaluate(() => { state.turnNo += 1; Chain.roundStart([]); OnlineGame.touch(); });
  for (const uid of await host.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead).map(u => u.id))) assert.equal((await submit(host, { type: "gm.removeUnit", actor: uid, mode: "kill" })).ok, true);
  await host.waitForFunction(() => state.chain && state.chain.index === 1);
  await alice.waitForFunction(() => /第 2 \/ 2 场/.test(document.querySelector("#online-stage .ol-chain")?.textContent || "") && OnlineGame.getView().packet.state.zoneMode === 3);
  assert.deepEqual(f.errors, []);
});

test("联机：主持人发大字，所有玩家画面中间弹出，几秒后淡出；小队频道留记录；刚进房间不重播旧的", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, bob } = f;
  const shot = async (page, name) => { if (process.env.BACKFIRE_SHOTS) await page.screenshot({ path: path.join(process.env.BACKFIRE_SHOTS, name + ".png") }); };
  await host.evaluate(() => { OnlineGame.start(); });
  for (const page of [alice, bob]) await page.waitForFunction(() => OnlineGame.getView().screen === "exploration" && !document.getElementById("online-side").hidden);
  await host.locator('.tr-log [data-host-tab="chat"]').click();
  await host.click('.tr-log [data-title-open]');
  await host.click('#online-title-form [data-title-preset^="援军来了"]');
  await host.fill('#online-title-form [data-tf="sub"]', "北边山坡亮起了火把");
  await host.fill('#online-title-form [data-tf="seconds"]', "3");
  await host.click('#online-title-form [data-title="go"]');
  for (const page of [alice, bob]) await page.waitForSelector("#online-title.on:not([hidden])");
  assert.match(await alice.locator("#online-title").innerText(), /援军来了[\s\S]*北边山坡亮起了火把/);
  assert.ok(await alice.evaluate(() => document.getElementById("online-title").classList.contains("ol-tone-hope")));
  await alice.waitForTimeout(700);
  await shot(alice, "title-player"); await shot(bob, "title-player-mobile");
  assert.match(await bob.locator("#online-side .ol-side-chat").innerText(), /【援军来了】/);
  await alice.waitForSelector("#online-title", { state: "hidden", timeout: 6000 });
  // 玩家刷新重连：旧的大字不重播
  await bob.reload(); await bob.waitForFunction(() => !!window.OnlineGame); await bob.evaluate(() => OnlineGame.resume());
  await bob.waitForFunction(() => !!OnlineGame.getView().packet?.view?.title);
  await bob.waitForTimeout(500);
  assert.equal(await bob.locator("#online-title").isHidden(), true);
  // 玩家发不了
  assert.equal((await submit(alice, { type: "showTitle", text: "我是主持人" })).ok, false);
  assert.deepEqual(f.errors, []);
});

test("联机：玩家悬停单位 / 配置物，看到图鉴描述和身上效果的文字", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice } = f;
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => battleTemplateSave({ name: "悬停", board: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }], props: [{ kind: "boom", zone: 2, faction: "enemy" }] }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt^="fight:"]');
  await alice.waitForFunction(() => document.querySelectorAll("#online-stage .ol-battle .unit.foe:not(.prop)").length === 1);
  await alice.hover("#online-stage .ol-battle .unit-wrap:has(.unit.foe:not(.prop))");
  await alice.waitForSelector(".unit-tip.show");
  const txt = await alice.textContent(".unit-tip");
  assert.match(txt, /行动方式/);
  await alice.mouse.move(2, 2);
  await alice.hover("#online-stage .ol-battle .unit-wrap[data-prop-id]");
  await alice.waitForFunction(() => /爆炸桶[\s\S]*耐久/.test(document.querySelector(".unit-tip.show")?.textContent || ""));
  assert.deepEqual(f.errors, []);
});

test("联机：「消息」列表来新消息不再跳回最上面——在底部就贴底，往上翻着看旧的就停在原处", { timeout: 120000 }, async t => {
  const fx = await fixture(t); if (!fx) return;
  const { host, alice, errors } = fx;
  const list = '#online-panel [data-keep-scroll="messages"]';
  for (let i = 1; i <= 14; i++) await submit(host, { type: "gm.msg", to: "all", text: `第 ${i} 条：` + "前面的路被沙暴盖住了，".repeat(3) });
  await alice.waitForFunction(sel => (document.querySelector(sel)?.children.length || 0) >= 14, list);
  const metrics = () => alice.evaluate(sel => {
    const el = document.querySelector(sel);
    return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, overflow: el.scrollHeight > el.clientHeight + 10 };
  }, list);
  let m = await metrics();
  assert.ok(m.overflow, "消息够多，列表要能滚");
  assert.ok(m.gap < 24, "从没滚过：贴底显示最新的消息 " + JSON.stringify(m));
  await submit(host, { type: "gm.msg", to: "all", text: "第 15 条" });
  await alice.waitForFunction(sel => document.querySelector(sel)?.innerText.includes("第 15 条"), list);
  m = await metrics();
  assert.ok(m.gap < 24, "在底部时来新消息：继续贴底（以前整块重画，跳回最上面）" + JSON.stringify(m));
  // 往上翻到中间看旧消息
  await alice.evaluate(sel => { const el = document.querySelector(sel); el.scrollTop = 40; el.dispatchEvent(new Event("scroll")); }, list);
  await submit(host, { type: "gm.msg", to: "all", text: "第 16 条" });
  await alice.waitForFunction(sel => document.querySelector(sel)?.innerText.includes("第 16 条"), list);
  m = await metrics();
  assert.ok(Math.abs(m.top - 40) <= 1, "往上翻着看旧消息时来新消息：停在原处 " + JSON.stringify(m));
  assert.deepEqual(errors, []);
});

test("联机：选目标时能选的敌人在战场上标编号，同名敌人也分得清；点哪只打哪只", { timeout: 120000 }, async t => {
  const fx = await fixture(t); if (!fx) return;
  const { host, alice, bob, aliceId, bobId, errors } = fx;
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  // 两只一模一样的狂徒（匕首），都在 2 区；瑞比的普攻是「距离 1」
  await host.evaluate(() => battleTemplateSave({ name: "两只狂徒", board: 2, weather: "none", playerZone: 1,
    enemies: [{ preset: "thug_knife", level: 1, zone: 2 }, { preset: "thug_knife", level: 1, zone: 2 }] }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt^="fight:"]');
  await alice.waitForFunction(() => OnlineGame.getView().screen === "battle");
  await host.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await host.waitForFunction(() => HotseatGame.getView().phase === "picking" && GAME.depth === 0, null, { timeout: 20000 });
  const heroes = await host.evaluate(() => HotseatGame.getView().heroes);
  for (const [index, hero] of heroes.entries()) assert.equal((await submit(hero.owner === aliceId ? alice : hero.owner === bobId ? bob : host, { type: "orderPick", actor: hero.id, index })).ok, true);
  for (const page of [alice, bob, host]) assert.equal((await submit(page, { type: "orderConfirm" })).ok, true);
  await host.waitForFunction(() => HotseatGame.getView().phase === "acting");
  const first = heroes.find(h => h.owner === aliceId);
  assert.equal(await host.evaluate(id => state.units.find(u => u.id === id).kit, first.id), "ruby", "这个用例用瑞比的普攻（距离 1）");
  // 新的联机战斗画面：底部技能栏点「普通攻击」，能打的目标在战场上亮起并标编号
  await alice.waitForSelector('#online-stage .ol-battle [data-ob-skill]:not([disabled])');
  await alice.locator('#online-stage .ol-battle [data-ob-skill]', { hasText: "普通攻击" }).first().click();
  await alice.waitForFunction(() => document.querySelectorAll("#online-stage .ol-battle .unit-wrap.is-targetable .ob-pick-no").length === 2);
  const shown = await alice.evaluate(() => [...document.querySelectorAll("#online-stage .ol-battle .unit-wrap.is-targetable")].map(c => ({ id: c.dataset.unitId, no: c.querySelector(".ob-pick-no").textContent })));
  assert.deepEqual(shown.map(c => c.no).sort(), ["1", "2"], "两只狂徒的卡片各有一个编号");
  // 点战场上的第 2 只
  const target = shown.find(c => c.no === "2").id, other = shown.find(c => c.no === "1").id;
  const hpOf = id => host.evaluate(id => state.units.find(u => u.id === id).layers.reduce((s, l) => s + Math.max(0, l.current), 0), id);
  const before = { target: await hpOf(target), other: await hpOf(other) };
  await alice.click(`#online-stage .ol-battle .unit-wrap[data-unit-id="${target}"]`);
  await host.waitForFunction(({ id, hp }) => { const u = state.units.find(x => x.id === id); return u.dead || u.layers.reduce((s, l) => s + Math.max(0, l.current), 0) < hp; }, { id: target, hp: before.target });
  assert.equal(await hpOf(other), before.other, "没点的那只不挨打");
  assert.deepEqual(errors, []);
});

test("联机跑团（issue #44）：主持人在大厅换队员——留下的角色还是原来的人操控，新加入的归主持人；玩家画面跟着更新", { timeout: 120000 }, async t => {
  const f = await fixture(t); if (!f) return;
  const { host, alice, aliceId } = f;
  const before = await host.evaluate(() => HotseatGame.getView().heroes.map(h => ({ kit: state.units.find(u => u.id === h.id).kit, owner: h.owner })));
  const keep = before.find(h => h.owner === aliceId);
  assert.ok(keep, "fixture 给 Alice 分了角色");
  const choices = await host.evaluate(() => OnlineGame.partyChoices());
  const extra = choices.find(c => !c.on);
  assert.ok(extra, "还有没上场的角色可以换上来");
  const kits = [keep.kit, extra.kit];
  assert.deepEqual(await host.evaluate(k => OnlineGame.setParty(k), kits), { ok: true });
  const after = await host.evaluate(() => HotseatGame.getView().heroes.map(h => ({ kit: state.units.find(u => u.id === h.id).kit, owner: h.owner })));
  const gm = await host.evaluate(() => OnlineGame.getView().identity.id);
  assert.deepEqual(after.map(h => h.kit).sort(), kits.slice().sort());
  assert.equal(after.find(h => h.kit === keep.kit).owner, aliceId, "留下的角色还归 Alice");
  assert.equal(after.find(h => h.kit === extra.kit).owner, gm, "新加入的归主持人");
  const name = extra.name;
  await alice.waitForFunction(n => (OnlineGame.getView().heroes || []).some(h => h.name === n), name);
  assert.deepEqual(f.errors, []);
});
