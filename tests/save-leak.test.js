// 报告 H1 / H15：从跑团战斗回标题后跑团规则没关、训练场结算写存档——两条都会改坏跑团存档
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
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
test.before(async () => { try { if (pw) browser = await pw.chromium.launch(); } catch (e) { browser = null; } });
test.after(async () => { if (browser) await browser.close(); });

async function trpgPage(t) {
  if (!browser) { t.skip("Playwright/browser unavailable"); return null; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], dialogs = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => { dialogs.push(d.message()); return d.type() === "prompt" ? d.accept("回归测试团") : d.accept(); });
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.evaluate(() => { window.__noLevelUpPopup = true; });
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  return { page, errors, dialogs };
}
const slotKuizhi = page => page.evaluate(() => trpgReadSlots()[0].campaign.kuizhi);

test("H1：跑团战斗里点顶栏「标题」——放弃没打完的战斗、存团、关掉跑团规则；之后开单局不带跑团规则", async t => {
  const o = await trpgPage(t); if (!o) return;
  const { page, errors, dialogs } = o;
  await page.evaluate(() => { state.kuizhi = 1234; TrpgFlow.toBattle(); });
  await page.waitForSelector("#g-app:not([hidden])");
  assert.equal(await slotKuizhi(page), 1234, "开战前存过");
  // 打到一半：奎支变了（比如用了东西），然后回标题
  await page.evaluate(() => { state.combatStarted = true; state.kuizhi = 99999; });
  await page.click("#g-title");
  await page.waitForSelector("#scr-title:not([hidden])");
  assert.match(dialogs.at(-1) || "", /回到标题会放弃这场战斗/);
  const after = await page.evaluate(() => ({ active: TRPG.active, cls: document.body.classList.contains("trpg"), kuizhi: trpgReadSlots()[0].campaign.kuizhi }));
  assert.deepEqual(after, { active: false, cls: false, kuizhi: 1234 }, "跑团关掉、空位里是开战前那份");
  // 跑团规则不再影响别的模式（专长探索项、撤销步数……都看 TRPG.active）
  assert.equal(await page.evaluate(() => featTrpgOk()), false);
  assert.deepEqual(errors, []);
});

test("H1：不管从哪条路回到标题，跑团模式都会关掉并存好团", async t => {
  const o = await trpgPage(t); if (!o) return;
  const { page, errors } = o;
  const out = await page.evaluate(() => {
    state.kuizhi = 4321;
    Screens.show("title");
    return { active: TRPG.active, kuizhi: trpgReadSlots()[0].campaign.kuizhi };
  });
  assert.deepEqual(out, { active: false, kuizhi: 4321 });
  assert.deepEqual(errors, []);
});

test("H15：训练场撤退 / 全员倒地不结算、不写队伍记忆和跑团空位", async t => {
  const o = await trpgPage(t); if (!o) return;
  const { page, errors } = o;
  // 先回标题（跑团存好关掉），记下现在的存档
  await page.evaluate(() => Screens.show("title"));
  const before = await page.evaluate(() => ({ slots: localStorage.getItem(TRPG_SLOTS_KEY), camp: localStorage.getItem("anterscale-campaign"), dur: JSON.stringify(LEDGER.dur || null) }));
  await page.evaluate(() => { Training.start("ruby", 10); });
  await page.waitForSelector("#g-app:not([hidden])");
  await page.evaluate(() => GAME.startOrEnd());
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player");
  const durBefore = await page.evaluate(() => JSON.stringify(LEDGER.dur || null));
  await page.click("#g-retreat");
  await page.waitForSelector("#g-choice.show");
  await page.locator("#g-choice .opts button").first().click();
  await page.waitForFunction(() => GAME.ended);
  const after = await page.evaluate(() => ({ slots: localStorage.getItem(TRPG_SLOTS_KEY), camp: localStorage.getItem("anterscale-campaign"), dur: JSON.stringify(LEDGER.dur || null) }));
  assert.equal(after.slots, before.slots, "跑团空位没被改");
  assert.equal(after.camp, before.camp, "队伍记忆没被改");
  assert.equal(after.dur, durBefore, "战后不结算耐久");
  assert.deepEqual(errors, []);
});
