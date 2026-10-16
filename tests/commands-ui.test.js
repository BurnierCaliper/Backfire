// D1 browser regression: actual buttons must submit data commands, including
// the opt-in file export. Existing ui.test.js assertions stay untouched.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
function findPlaywright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
const pw = findPlaywright();
let browser;
test.before(async () => {
  try { if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); }
  catch (e) { if (process.env.REQUIRE_UI === "1") throw e; }
});
test.after(async () => { if (browser) await browser.close(); });
async function open(t, file = "game.html", debug = false) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "D1 指令回归" : undefined));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", file)).href + (debug ? "?debug=1" : ""));
  return { page, errors };
}
const history = page => page.evaluate(() => Commands.history());

test("D1 UI: exploration changes use commands and the debug menu exports a JSON file", async t => {
  const o = await open(t, "game.html", true); if (!o) return;
  const { page } = o;
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.click('[data-tab="bag"]');
  await page.fill("#tr-kz", "5432");
  await page.click("#tr-kz-add");
  assert.equal(await page.evaluate(() => state.kuizhi), 5432);
  const entries = await history(page);
  assert.ok(entries.some(e => e.command.type === "trpg" && e.command.action === "adjustKuizhi" && e.command.amount === 5432 && e.status === "ok"));
  await page.click("#command-debug summary");
  const nextDownload = page.waitForEvent("download");
  await page.click("#command-log-export");
  const download = await nextDownload;
  assert.equal(download.suggestedFilename(), "backfire-commands.json");
  const dump = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(dump.schema, "backfire-command-log-v1");
  assert.deepEqual(dump.entries, await history(page));
  assert.ok(dump.entries.every(e => e.status === "ok"));
  assert.deepEqual(o.errors, []);
});

test("D1 UI: Rogue party, new run, task and save are data commands", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  assert.equal(await page.locator("#command-debug").count(), 0);
  await page.click("#t-local"); await page.click("#t-new");
  await page.click('.hero-pick[data-kit="ruby"]');
  await page.click('.hero-pick[data-kit="yuito"]');
  await page.click("#party-go");
  await page.click('.r-go[data-which="main"]');
  const entries = await history(page);
  for (const [type, action] of [["run.session", "prepareParty"], ["run.session", "toggleHero"], ["run.session", "newRun"], ["run", "acceptTask"], ["run.session", "save"]]) {
    assert.ok(entries.some(e => e.command.type === type && e.command.action === action && e.status === "ok"), type + ":" + action);
  }
  assert.ok(entries.every(e => e.status === "ok"));
  assert.deepEqual(o.errors, []);
});

test("D1 UI: skill targeting records the resolved data command only after confirmation", async t => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.click("#tr-fight");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0);
  const actor = await page.evaluate(() => partyHeroes().find(h => h.kit === "ruby").id);
  await page.click(`.unit-wrap[data-id="${actor}"]`);
  await page.evaluate(() => Commands.clearLog());
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  assert.equal((await history(page)).filter(e => e.command.type === "skill").length, 0);
  const target = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, candidate]) => !candidate.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${target}"]`);
  await page.waitForFunction(() => GAME.depth === 0 && Commands.history().some(e => e.command.type === "skill" && e.status === "ok"));
  const submitted = (await history(page)).filter(e => e.command.type === "skill");
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].command.actor, actor);
  assert.equal(submitted[0].command.target, target);
  assert.equal(typeof submitted[0].command.picks, "object");
  assert.deepEqual(o.errors, []);
});

test("D1 UI: calculator settings and existing enemy setup submit explicit commands", async t => {
  const o = await open(t, "index.html"); if (!o) return;
  const { page } = o;
  await page.selectOption("#weather", "acid");
  await page.click("#btnAddPreset");
  const entries = await history(page);
  assert.equal(await page.evaluate(() => state.weather), "acid");
  assert.ok(entries.filter(e => e.command.type === "calc" && e.status === "ok").length >= 2);
  assert.ok(entries.every(e => e.status === "ok"));
  assert.deepEqual(o.errors, []);
});
