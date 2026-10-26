// #340 第 6 条要浏览器的那部分：跑团任务编辑器里删站、挪站以后，「奖励已发 ✓」跟着那一站走（trpg-ui.js · taskEditorHtml / taskRoute / taskCardHtml）。
// 以前编辑器按位置看「第几站发过」：删掉发过奖励的第 1 站，原来的第 2 站就顶着「奖励已发 ✓」，奖励的输入框也没了。
// 规则（当前站、发奖记账）在 tests/task-route-edit.test.js。
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

test("跑团任务编辑器：删掉发过奖励的第 1 站，「奖励已发 ✓」不会落到下一站头上；保存后当前站和要发的奖励都对", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, "game.html")).href);
  await page.waitForFunction(() => !!window.GAME && !!window.TrpgFlow && typeof trpgTasks === "function");
  await page.evaluate(() => { Commands.dispatch({ type: "trpg.ui", action: "new", index: 0, name: "改路线", level: 1 }); });
  await page.waitForFunction(() => Screens.is("trpg"));
  // 主持人建一条 A / B / C 三站的任务（奖励 100 / 200 / 400 奎支），发布、接下、完成第 1 站：和点按钮一样走 trpg.ui 的 rule（存档、重画）
  const id = await page.evaluate(() => {
    const rule = (action, data) => Commands.dispatch({ type: "trpg.ui", action: "rule", level: 1, command: Object.assign({ type: "trpg", action }, data) });
    rule("taskCreate", { kind: "custom", category: "main" });
    const t = trpgTasks()[trpgTasks().length - 1];
    const node = (title, kuizhi) => ({ type: "event", note: "", enemies: [], weather: "none", zoneMode: 2, title, hidden: false, reward: { xp: 0, kuizhi } });
    rule("taskSave", { task: Object.assign(JSON.parse(JSON.stringify(t)), { nodes: [node("A", 100), node("B", 200), node("C", 400)] }) });
    rule("taskStatus", { id: t.id, status: "posted" });
    rule("taskAccept", { id: t.id });
    rule("taskNodeDone", { id: t.id });
    return t.id;
  });
  await page.click('[data-tab="tasks"]');
  await page.click(`[data-tk="edit:${id}"]`);
  const rows = () => page.evaluate(() => [...document.querySelectorAll(".tk-edit .tk-enode")].map(el => ({
    got: el.classList.contains("tk-got"), title: (el.querySelector('[data-te$=".title"]') || {}).value, reward: !!el.querySelector('[data-te$=".reward.kuizhi"]')
  })));
  assert.deepEqual(await rows(), [{ got: true, title: "A", reward: false }, { got: false, title: "B", reward: true }, { got: false, title: "C", reward: true }]);
  assert.match(await page.locator(".tk-edit").innerText(), /任务进行中：删站、插站、挪站时，走过没有、奖励发过没有都跟着那一站。保存后当前站是路线里第一个还没走过的站/, "进行中的任务：编辑里写明改路线怎么算");
  await page.click('[data-te-act="delNode:0"]');
  assert.deepEqual(await rows(), [{ got: false, title: "B", reward: true }, { got: false, title: "C", reward: true }], "B、C 都没发过奖励：不打勾，奖励照样能改");
  // 挪站：C 挪到最前面再保存，打勾照样跟着站走（这两站都没发过）
  await page.click('[data-te-act="up:1"]');
  assert.deepEqual(await rows(), [{ got: false, title: "C", reward: true }, { got: false, title: "B", reward: true }]);
  await page.click('[data-te-act="down:0"]');
  await page.click('[data-te-act="save"]');
  // 卡片：当前是第 1 站 B，「这一站完成」写着发 B 的奖励；路线上没有打勾的站
  await page.waitForFunction(() => !document.querySelector(".tk-edit"));
  const card = await page.locator(".tk-card.on").innerText();
  assert.match(card, /当前：第 1 站/);
  assert.match(card, /这一站完成（发 \+200 奎支）/);
  assert.equal(await page.locator(".tk-card.on .tk-rw.got").count(), 0, "路线上没有「已发」的站");
  assert.equal(await page.evaluate(id => { const t = trpgTaskById(id); return t.nodes[t.index].title; }, id), "B");
  assert.deepEqual(errors, []);
});
