// roguelike 每日挑战（#52）：每天固定种子，种子定队伍和专长的 4 个选项，记下出现 / 被选，算选取率
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("种子和队伍：按日期固定；4 人、不重复、至少一名输出，主职责尽量不重复", () => {
  const c = H.load();
  const R = c.Rogue;
  assert.equal(R.dailySeed("2026-10-16"), "daily-2026-10-16");
  assert.match(R.dailySeed(), /^daily-\d{4}-\d{2}-\d{2}$/);
  const a = plain(R.dailyParty("daily-2026-10-16")), b = plain(R.dailyParty("daily-2026-10-16"));
  assert.deepEqual(a, b, "同一天同一支队伍");
  assert.equal(a.length, 4);
  assert.equal(new Set(a).size, 4);
  const role = (k) => (R.cardOf(k).roles || {}).primary;
  assert.ok(a.some(k => ["直伤", "击破"].includes(role(k))), "至少一名输出");
  assert.equal(new Set(a.map(role)).size, 4, "主职责不重复");
  const days = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"].map(d => plain(R.dailyParty(R.dailySeed(d))).join());
  assert.ok(new Set(days.concat(a.join())).size > 1, "不同日子队伍会变");
});

function dailyRun(c, seed) {
  const R = c.Rogue;
  const run = R.newRun({ party: plain(R.dailyParty(seed)), seed, daily: true });
  const h = run.party[0];
  h.level = 7; h.pending = [{ type: "feat", level: 7 }];
  return { R, run, h };
}

test("专长 4 选 1：选项由种子固定，读档 / 别人打都一样；只能从这 4 个里选", () => {
  const seed = "daily-2026-10-16";
  const one = dailyRun(H.load(), seed), two = dailyRun(H.load(), seed);
  const opts = plain(one.R.choiceOptions(one.run, one.h.kit, 0)).map(o => o.value);
  assert.equal(opts.length, 4);
  assert.deepEqual(plain(two.R.choiceOptions(two.run, two.h.kit, 0)).map(o => o.value), opts, "同种子同选项");
  assert.deepEqual(plain(one.R.choiceOptions(one.run, one.h.kit, 0)).map(o => o.value), opts, "再看一次不变");
  assert.equal(one.run.featLog.length, 1, "出现只记一次");
  assert.equal(one.run.daily.date, "2026-10-16");
  const all = plain(one.R.choiceOptions(Object.assign({}, one.run, { daily: null }), one.h.kit, 0)).map(o => o.value);
  const outside = all.find(id => !opts.includes(id));
  assert.throws(() => one.R.choose(one.run, one.h.kit, 0, outside), /不可选/);
  one.R.choose(one.run, one.h.kit, 0, opts[2]);
  assert.equal(one.run.featLog[0].picked, opts[2]);
  assert.deepEqual(plain(one.run.featLog[0].offered), opts);
});

test("局结束：存到本机，算选取率（被选 / 出现）；同一局只记一次", () => {
  const c = H.load();
  const { R, run, h } = dailyRun(c, "daily-2026-10-16");
  const opts = plain(R.choiceOptions(run, h.kit, 0)).map(o => o.value);
  R.choose(run, h.kit, 0, opts[0]);
  R.endRun(run, false, "测试");
  R.endRun(run, false, "测试");
  const stats = plain(R.dailyStats());
  assert.equal(stats.runs.length, 1);
  assert.equal(stats.runs[0].seed, "daily-2026-10-16");
  assert.equal(stats.runs[0].result.win, false);
  const rates = plain(R.featPickRates());
  assert.deepEqual(rates[opts[0]], { shown: 1, picked: 1, rate: 1 });
  assert.deepEqual(rates[opts[1]], { shown: 1, picked: 0, rate: 0 });
});

test("普通单局不受影响：专长照常列出全部可选的", () => {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "NORMAL" });
  const h = run.party[0];
  h.level = 7; h.pending = [{ type: "feat", level: 7 }];
  assert.ok(R.choiceOptions(run, h.kit, 0).length > 4);
  assert.ok(!run.daily && !run.featLog);
  assert.throws(() => R.newRun({ party: ["kolt"], seed: "x", daily: true, solo: true, partners: [] }));
});

function findPlaywright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
const pw = findPlaywright();
let browser;
test.before(async () => { try { if (pw) browser = await pw.chromium.launch(); } catch (e) { browser = null; } });
test.after(async () => { if (browser) await browser.close(); });

test("画面：本地玩法里有「每日挑战」，写着今天的队伍，点了直接出发", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.evaluate(() => { window.__noLevelUpPopup = true; });
  await page.click("#t-local");
  const sub = await page.textContent("#t-daily-sub");
  assert.match(sub, /\d{4}-\d{2}-\d{2} · .+、.+ · 专长 4 选 1/);
  await page.click("#t-daily");
  await page.waitForSelector("#scr-run:not([hidden])");
  const daily = await page.evaluate(() => { const r = RunFlow.current(); return { daily: !!r.daily, seed: r.seed, n: r.party.length }; });
  assert.equal(daily.daily, true);
  assert.match(daily.seed, /^daily-/);
  assert.equal(daily.n, 4);
  assert.deepEqual(errors, []);
});
