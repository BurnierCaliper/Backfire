// 专长图鉴（#52）：图鉴第五本「专长」直接读 FEATS，全部列出，按 ①–④ 分层，写次数 / 消耗 / 涉猎来源 / 标签
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
const H = require("./headless");

test("条目：每个专长一条，文字和 FEATS 一样，按层级排，分组 t1–t4", () => {
  const c = H.load();
  const all = c.codexFeatEntries();
  const ids = require("node:vm").runInContext("Object.keys(FEATS)", c);
  assert.equal(all.length, ids.length);
  ids.forEach(id => {
    const e = all.find(x => x.featId === id);
    assert.ok(e, id);
    assert.equal(e.lines[0], c.featDef(id).text);
    assert.equal(e.group, "t" + c.featDef(id).tier);
  });
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].tier <= all[i].tier);
});

test("次数、消耗、涉猎来源、标签", () => {
  const c = H.load();
  const by = (id) => c.codexFeatEntries().find(e => e.featId === id);
  assert.equal(by("ironwall").name, "以身作盾");
  assert.equal(by("ironwall").uses, "每次短休 1 次");
  assert.equal(by("onemind").uses, "每长休 1 次");
  assert.equal(by("standin").uses, "每次短休 1 次");
  assert.equal(by("standin").cost, "附赠 1");
  assert.equal(by("standin").kindName, "涉猎");
  assert.match(by("standin").dabbleFrom, /护卫职责 一 号技能/);
  assert.match(by("insight").uses, /每长休 2 次/);
  assert.equal(by("unbowed").uses, "每场 1 次");
  assert.ok(by("versatile").tags.includes("可以重复选"));
  assert.ok(by("learned").tags.includes("只在跑团模式"));
  assert.ok(by("haggler").tags.includes("跑团规则（探索）"));
  assert.ok(c.codexMatch(by("ironwall"), "格挡"), "能搜效果文字");
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

test("画面：图鉴里有「专长」这一本，按层级筛，点开看详情", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.click("#t-codex");
  await page.click('.bx [data-mode="feat"]');
  assert.equal(await page.textContent(".bx-head h3"), "专长图鉴");
  const total = await page.$$eval(".bx-grid .bx-card", ns => ns.length);
  assert.ok(total >= 40, String(total));
  await page.click('.bx-tabs [data-filter="t3"]');
  const t3 = await page.$$eval(".bx-grid .bx-card", ns => ns.length);
  assert.ok(t3 > 0 && t3 < total);
  await page.fill(".bx-search", "以身作盾");
  await page.click('.bx-tabs [data-filter="all"]');
  await page.click(".bx-grid .bx-card");
  const detail = await page.textContent(".bx-detail");
  assert.match(detail, /以身作盾/);
  assert.match(detail, /每次短休 1 次/);
  assert.match(detail, /专长 · 专长③ · 13 级/);
  assert.deepEqual(errors, []);
});
