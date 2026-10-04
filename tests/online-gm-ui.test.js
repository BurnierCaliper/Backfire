"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); } catch (_) {}
let browser;
test.before(async () => {
  try { if (!playwright) throw new Error("Playwright is required"); browser = await playwright.chromium.launch(); }
  catch (error) { if (process.env.REQUIRE_UI === "1") throw error; }
});
test.after(async () => { if (browser) await browser.close(); });
async function fixture(t, mobile = false) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1300, height: 900 }, isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close()); const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><main class="g-app">战场</main></body>');
  await page.addStyleTag({ path: path.join(__dirname, "..", "online-gm-ui.css") });
  await page.evaluate(() => {
    const hero = { id: "hero", name: '<img src=x onerror="window.pwned=1">', zone: 1, isPlayer: true, level: 3, layers: [{ type: "flesh", current: 14, max: 20 }], shp: 11, shpMax: 18, def: 3, defMax: 4, ap: 1, apMax: 1, bonus: 1, bonusMax: 1, atk: 8, statuses: {} };
    const enemy = { id: "enemy", name: "狂徒", zone: 2, isPlayer: false, level: 2, layers: [{ type: "flesh", current: 12, max: 15 }], ap: 1, bonus: 1, statuses: {} };
    window.fixture = { calls: [], listeners: [], reject: "", view: { active: false, isHost: false, manualPhase: false, players: [], manual: { enemy: true }, enemyCatalog: [{ id: "thug_knife", name: "狂徒（匕首）" }], enemySkills: { enemy: [{ id: "en_aa", label: "普通攻击" }, { id: "en_gl", label: "榴弹标定" }] }, skillSteps: { en_gl: [{ key: "dest", type: "zone", label: "榴弹落点", zones: [1, 2], optional: false }] }, state: { units: [hero, enemy], zoneMode: 2, props: [{ id: "prop1", name: "爆炸桶", kind: "boom", zone: 1, level: 1, faction: "player", hp: 3, maxHp: 3, link: "1-2" }], fields: { 1: { fire: 0, ruinHp: 30, ruinMax: 30 }, 2: {} }, gaps: { "1-2": { type: "open", hp: 0, maxHp: 0, open: true } }, weather: "none", sandDir: "12" } }, emit() { this.listeners.forEach(f => f()); } };
    window.bridge = { getView: () => JSON.parse(JSON.stringify(fixture.view)), subscribe: fn => { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(x => x !== fn); }; }, submit: async cmd => { fixture.calls.push(JSON.parse(JSON.stringify(cmd))); return fixture.reject ? { ok: false, error: fixture.reject } : { ok: true }; } };
  });
  await page.addScriptTag({ path: path.join(__dirname, "..", "online-gm-ui.js") });
  await page.evaluate(() => { window.component = OnlineGMUI.mount(bridge); });
  return { page, errors };
}
async function host(page) { await page.evaluate(() => { Object.assign(fixture.view, { active: true, isHost: true }); fixture.emit(); }); await page.click("#ogm-toggle"); }
async function calls(page) { return page.evaluate(() => fixture.calls); }
async function tab(page, name) { await page.click(`[data-tab="${name}"]`); }

test("D3 GM UI: no single-player/client DOM; host controls teardown immediately on lost authority", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f;
  assert.equal(await page.locator("#online-gm-tools").count(), 0);
  await page.evaluate(() => { fixture.view.active = true; fixture.emit(); }); assert.equal(await page.locator("#online-gm-tools").count(), 0);
  await host(page); assert.equal(await page.locator("#ogm-panel").count(), 1);
  await page.evaluate(() => { fixture.view.isHost = false; fixture.emit(); }); assert.equal(await page.locator("#online-gm-tools").count(), 0);
  assert.deepEqual(f.errors, []);
});

test("D3 GM UI: spawn and distinct remove/kill commands are explicit JSON with silent default off", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f; await host(page);
  await page.fill("#ogm-enemy-level", "4"); await page.fill("#ogm-enemy-count", "2"); await page.click('[data-action="spawn"]');
  await page.click('[data-action="remove-enemy"]'); await page.check("#ogm-silent"); await page.click('[data-action="kill-enemy"]');
  assert.deepEqual(await calls(page), [
    { type: "gm.spawnEnemy", enemyId: "thug_knife", level: 4, zone: 2, count: 2, silent: false },
    { type: "gm.removeUnit", actor: "enemy", mode: "remove", silent: false },
    { type: "gm.removeUnit", actor: "enemy", mode: "kill", silent: true }
  ]);
  assert.deepEqual(f.errors, []);
});

test("D3 GM UI: manual action uses chosen target/flow and closes tools for real reaction dialogs", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f; await host(page);
  assert.equal(await page.locator('[data-action="enemy-skill"]').isDisabled(), true);
  await page.evaluate(() => { fixture.view.manualPhase = true; fixture.emit(); });
  await page.selectOption("#ogm-target", "hero"); await page.click('[data-action="enemy-skill"]');
  assert.equal(await page.locator("#ogm-panel").count(), 0);
  await page.click("#ogm-toggle"); await page.selectOption("#ogm-skill", "en_gl"); await page.selectOption("#ogm-pick-dest", "1"); await page.click('[data-action="enemy-skill"]');
  const sent = await calls(page);
  assert.deepEqual(sent[0], { type: "gm.enemyAct", actor: "enemy", action: "skill", skill: "en_aa", picks: {}, target: "hero", silent: false });
  assert.deepEqual(sent[1], { type: "gm.enemyAct", actor: "enemy", action: "skill", skill: "en_gl", picks: { dest: 1 }, target: null, silent: false });
  assert.deepEqual(f.errors, []);
});

test("D3 GM UI: unit forms escape names, preserve typing across updates, and submit private SHP only to authority", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f; await host(page); await tab(page, "units");
  assert.equal(await page.locator("#ogm-panel img").count(), 0); assert.equal(await page.evaluate(() => window.pwned), undefined);
  await page.selectOption("#ogm-unit-field", "shp"); await page.fill("#ogm-unit-value", "7");
  await page.evaluate(() => { fixture.view.state.units[0].shp = 5; fixture.emit(); });
  assert.equal(await page.inputValue("#ogm-unit-value"), "7"); await page.click('[data-action="edit-unit"]');
  assert.deepEqual((await calls(page))[0], { type: "gm.editUnit", actor: "hero", patch: { shp: 7 }, silent: false });
  await page.selectOption("#ogm-unit-field", "layers"); await page.fill("#ogm-layer-hp-0", "9"); await page.fill("#ogm-layer-max-0", "25"); await page.click('[data-action="edit-unit"]');
  assert.deepEqual((await calls(page))[1].patch, { layers: [{ current: 9, max: 25 }] });
  assert.deepEqual(f.errors, []);
});

test("D3 GM UI: props, field, gap and weather submit complete typed forms on mobile without horizontal overflow", async t => {
  const f = await fixture(t, true); if (!f) return; const { page } = f; await host(page); await tab(page, "props");
  await page.click('[data-action="destroy-prop"]'); assert.equal((await calls(page))[0].mode, "destroy");
  await tab(page, "field"); await page.selectOption("#ogm-gap-kind", "door"); await page.uncheck("#ogm-gap-open"); await page.click('[data-action="edit-gap"]');
  await page.selectOption("#ogm-field-kind", "fireOn"); await page.fill("#ogm-field-fire", "3"); await page.click('[data-action="edit-field"]');
  await tab(page, "weather"); await page.selectOption("#ogm-weather", "sand"); await page.selectOption("#ogm-sand", "21"); await page.check("#ogm-weather-lock"); await page.click('[data-action="edit-weather"]');
  const sent = await calls(page); assert.equal(sent[1].patch.open, false); assert.equal(sent[2].patch.fire, 3);
  assert.deepEqual(sent[3], { type: "gm.setWeather", weather: "sand", sandDir: "21", phaseStep: 0, lock: true, silent: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector("#ogm-panel").scrollWidth <= document.querySelector("#ogm-panel").clientWidth), true);
  if (process.env.GM_UI_SCREENSHOT) await page.screenshot({ path: process.env.GM_UI_SCREENSHOT, fullPage: true });
  assert.deepEqual(f.errors, []);
});

test("D3 GM UI: rejected commands show safe text and malformed negative values never submit", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f; await host(page);
  await page.fill("#ogm-enemy-count", "-1"); await page.click('[data-action="spawn"]'); assert.equal((await calls(page)).length, 0);
  await page.fill("#ogm-enemy-count", "1"); await page.evaluate(() => { fixture.reject = '<img src=x onerror="window.pwned=1">权限已失效'; });
  await page.click('[data-action="spawn"]'); assert.match(await page.textContent("#ogm-notice"), /权限已失效/);
  assert.equal(await page.locator("#ogm-notice img").count(), 0); assert.deepEqual(f.errors, []);
});
