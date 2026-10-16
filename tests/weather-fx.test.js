// 天气动效（PR #53）：weather-fx.js 摆战场叠加层，game.html 正式引用 weather-fx.css / weather-fx.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
const WFX = require("../weather-fx.js");

test("相位阶段 0..3 → 波谷 / 平衡 / 波峰 / 平衡；不是相位天气没有阶段", () => {
  assert.deepEqual([0, 1, 2, 3, 4, -1].map(n => WFX.phaseStepName("phase", n)), ["trough", "balance", "peak", "balance", "trough", "balance"]);
  assert.equal(WFX.phaseStepName("snow", 2), "");
  assert.equal(WFX.layerClass("snow"), "wfx wfx-snow");
  assert.equal(WFX.layerClass("none"), "");
  assert.equal(WFX.layerClass(""), "");
});

test("game.html 正式引用天气动效，不再是本地预览草稿", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "game.html"), "utf8");
  assert.match(html, /href="weather-fx\.css"/);
  assert.ok(html.indexOf('src="weather-fx.js"') >= 0 && html.indexOf('src="weather-fx.js"') < html.indexOf('src="game.js"'));
  assert.ok(!/weather-fx-draft/.test(html));
  const css = fs.readFileSync(path.join(__dirname, "..", "weather-fx.css"), "utf8");
  ["sand", "snow", "acid", "thunder", "heat", "glow", "phase"].forEach(w => assert.ok(css.includes(".wfx-" + w), w));
  assert.match(css, /prefers-reduced-motion/);
});

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

test("战斗画面：有天气就放叠加层、跟着天气换；不挡点击；没有天气就拿掉", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("天气测试团") : d.accept()));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.evaluate(() => { window.__noLevelUpPopup = true; });
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  await page.evaluate(() => { state.weather = "thunder"; });
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player", null, { timeout: 15000 });
  await page.waitForSelector("#g-field .wfx.wfx-thunder");
  const pe = await page.$eval("#g-field .wfx", n => getComputedStyle(n).pointerEvents);
  assert.equal(pe, "none");
  // 换成相位（顶栏的天气选单）：叠加层换掉，界面带上阶段
  const pick = (w) => page.evaluate(v => { const sel = document.getElementById("g-weather-sel"); sel.value = v; sel.dispatchEvent(new Event("change")); }, w);
  await page.evaluate(() => { state.phaseStep = 2; });
  await pick("phase");
  await page.waitForSelector("#g-field .wfx.wfx-phase");
  assert.equal(await page.$eval("#g-field .wfx", n => n.dataset.phaseStep), "peak");
  assert.equal(await page.$eval("#g-app", n => n.dataset.phaseStep), "peak");
  assert.equal(await page.$$eval("#g-field .wfx", ns => ns.length), 1, "只有一层");
  // 没有天气
  await pick("none");
  await page.waitForFunction(() => !document.querySelector("#g-field .wfx"));
  assert.equal(await page.$eval("#g-app", n => n.dataset.phaseStep || ""), "");
  assert.deepEqual(errors, []);
});
