// 战场数据加上倒地次数（#398）：要浏览器的那部分——单机战斗画面（旧画面）里打开「战场数据」，表上有「倒地次数」一列，
// 每个人这场倒地了几次、合计都对；面板开着时又有人倒地，跟着刷新；「合并武器人」以后照样有这一列。
// 规则那几条（三处设 dying = true 都记、不算倒地的几种情况）在 tests/battle-stats-downs.test.js。
// 用 Playwright；没装 Playwright 时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function playwright() {
  try { return require("playwright"); } catch (_) { /* 没装在本地 */ }
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) { /* 也没装在全局 */ }
  return null;
}
let browser = null, skipWhy = "";
test.before(async () => {
  try {
    const pw = playwright();
    browser = pw ? await pw.chromium.launch() : await require("./cdp-browser").launch();
    if (!browser) skipWhy = "没装 Playwright，也没有能用的 Chrome，跳过画面测试";
  } catch (e) {
    if (process.env.REQUIRE_UI === "1") throw e;
    browser = null; skipWhy = "浏览器启动失败，跳过画面测试：" + String(e.message).split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

/** 战场数据表：表头、每一行、合计（单元格的文字） */
const readTable = page => page.evaluate(() => {
  const cells = tr => (tr ? [...tr.children].map(td => td.textContent.trim()) : []);
  const sheet = document.getElementById("g-stats-sheet");
  return {
    shown: sheet.classList.contains("show"),
    head: cells(sheet.querySelector(".stats-table thead tr")),
    rows: [...sheet.querySelectorAll(".stats-table tbody tr")].map(cells),
    foot: cells(sheet.querySelector(".stats-table tfoot tr"))
  };
});

test("单机旧画面：战场数据表有「倒地次数」一列（排在承受伤害后面），每人这场倒地几次、合计都对；开着面板又有人倒地会跟着刷新，合并武器人也有", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, "game.html")).href);
  await page.waitForFunction(() => !!window.GAME && typeof BattleSim !== "undefined");
  // 三人队：倒下两个也还有人站着，不会打成全员倒地（不带柯尔特：开战先问初始刀头）
  const names = await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    Screens.show("battle");
    GAME.startCustomBattle("倒地次数", () => {
      BattleSim.setup({ party: ["ruby", "yuito", "helu"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "DOWNS-UI" });
      return {};
    });
    GAME.startOrEnd();
    const n = k => partyHeroes().find(h => h.kit === k).name;
    return { ruby: n("ruby"), yuito: n("yuito"), helu: n("helu") };
  });
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
  /** 这个人血量打空、走倒地结算（陷入濒死），画面刷新 */
  const knockDown = kit => page.evaluate(k => {
    const intro = document.getElementById("g-intro"); if (intro) intro.remove();
    const u = partyHeroes().find(h => h.kit === k);
    u.layers.forEach(l => { l.current = 0; });
    applyKnockdown(u, []);
    GAME.refresh();
    return u.dying;
  }, kit);
  assert.equal(await knockDown("ruby"), true);
  await page.click("#g-stats");
  await page.waitForFunction(() => document.getElementById("g-stats-sheet").classList.contains("show"));
  let tb = await readTable(page);
  const col = tb.head.indexOf("倒地次数");
  assert.ok(col > 0, "表头有「倒地次数」：" + tb.head.join(" / "));
  assert.equal(tb.head[col - 1], "承受伤害");
  const cell = (rows, name) => (rows.find(r => r[0] === name) || [])[col];
  assert.equal(cell(tb.rows, names.ruby), "1");
  assert.equal(cell(tb.rows, names.helu), "0");
  assert.equal(cell(tb.rows, names.yuito), "0");
  assert.equal(tb.foot[col], "1", "合计");
  // 面板开着：又有人倒地，跟着刷新
  assert.equal(await knockDown("helu"), true);
  tb = await readTable(page);
  assert.equal(tb.shown, true);
  assert.equal(cell(tb.rows, names.helu), "1");
  assert.equal(tb.foot[col], "2");
  // 合并武器人：照样有这一列，合计不变
  await page.click("#g-stats-merge");
  tb = await readTable(page);
  assert.equal(tb.head[col], "倒地次数");
  assert.equal(tb.foot[col], "2");
  assert.deepEqual(errors, []);
});
