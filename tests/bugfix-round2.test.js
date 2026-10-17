// 第二轮查 bug 报告（docs/bug-backlog.md）里开跑前修的几条：H3 跑团专长存档、H11 预演不动队伍档案
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
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("回归测试团") : d.accept()));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.evaluate(() => { window.__noLevelUpPopup = true; });
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  return { page, errors };
}

test("H3：跑团选好的专长、兼修、没分配的专长点存进队伍记忆，重摆场面 / 读档后还在；旧档丢了的按等级补回成可选点", async t => {
  const o = await trpgPage(t); if (!o) return;
  const { page, errors } = o;
  const out = await page.evaluate(() => {
    const u = state.units.find(x => x.isPlayer && x.kit === "kolt") || state.units.find(x => x.isPlayer && !x.weaponOf);
    u.level = 11; u.featPoints = 2;
    const pick = featChoicesFor(u, u.level)[0];
    Commands.dispatch({ type: "trpg", action: "pickFeat", kit: u.kit, feat: pick });
    GAME.rememberCampaign();
    GAME.setupBattle(1);
    const v = state.units.find(x => x.kit === u.kit);
    const after = { feats: (v.feats || []).slice(), points: v.featPoints, pick };
    // 旧档：记忆里没有专长字段 → 按等级补回成可选点（11 级该有 2 项）
    const camp = JSON.parse(JSON.stringify(GAME.campaign));
    const row = camp.party.find(p => p.kit === u.kit);
    delete row.feats; delete row.featFull; delete row.featPoints;
    GAME.campaign = camp;
    GAME.setupBattle(1);
    const w = state.units.find(x => x.kit === u.kit);
    return { after, old: { feats: (w.feats || []).length, points: w.featPoints } };
  });
  assert.deepEqual(out.after.feats, [out.after.pick]);
  assert.equal(out.after.points, 1);
  assert.deepEqual(out.old, { feats: 0, points: 2 }, "旧档按等级补回 2 个可选点");
  assert.deepEqual(errors, []);
});

test("H11：战斗画面的预演不改队伍档案（武器耐久、每次短休 / 长休的次数、钱包）", async t => {
  const o = await trpgPage(t); if (!o) return;
  const { page, errors } = o;
  const out = await page.evaluate(() => {
    LEDGER.dur = { test_weapon: 10 }; LEDGER.shortOnce = {}; LEDGER.restOnce = {}; LEDGER.purse = { kolt: 100 };
    GAME.previewOf(() => { LEDGER.dur.test_weapon = 3; LEDGER.shortOnce.kolt = { "feat:standin": 1 }; LEDGER.restOnce.kolt = { rally: 1 }; LEDGER.purse.kolt = 0; });
    return JSON.parse(JSON.stringify({ dur: LEDGER.dur, shortOnce: LEDGER.shortOnce, restOnce: LEDGER.restOnce, purse: LEDGER.purse }));
  });
  assert.deepEqual(out, { dur: { test_weapon: 10 }, shortOnce: {}, restOnce: {}, purse: { kolt: 100 } });
  assert.deepEqual(errors, []);
});
