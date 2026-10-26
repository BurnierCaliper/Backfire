// #340 第 7 条要浏览器的那部分：跑团任务战斗打到一半刷新页面，用房主的房间检查点恢复，接着打赢——任务照样走到下一站。
// 房间检查点是 online-game.js · save 给房主写的那两份（game.js · onlineCheckpoint 战场 + LEDGER、trpg-ui.js · TrpgFlow.onlineCheckpoint），
// 恢复照 online-game.js · doResume 的顺序。以前 TrpgFlow 的那份里没有正在打的任务战斗（TRPG.taskBattle），恢复后打赢了任务不动。
// 联机协调层本身（真的 save / resume）在 tests/task-battle-resume.test.js。
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

test("跑团任务战斗里刷新页面、按房间检查点恢复后打赢：任务走到下一站、发这一站的奖励、记下护送对象的血量", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  const url = pathToFileURL(path.join(ROOT, "game.html")).href;
  await page.goto(url);
  await page.waitForFunction(() => !!window.GAME && !!window.TrpgFlow && typeof trpgTasks === "function");
  await page.evaluate(() => { window.__noLevelUpPopup = true; Commands.dispatch({ type: "trpg.ui", action: "new", index: 0, name: "刷新团", level: 1 }); });
  await page.waitForFunction(() => Screens.is("trpg"));
  // 主持人建一条护送任务（第 1 站战斗、奖励 300 奎支；第 2 站事件），发布、接下：和点按钮一样走 trpg.ui 的 rule（存档、重画）
  const id = await page.evaluate(() => {
    const rule = (action, data) => Commands.dispatch({ type: "trpg.ui", action: "rule", level: 1, command: Object.assign({ type: "trpg", action }, data) });
    rule("taskCreate", { kind: "escort", category: "main" });
    const t = trpgTasks()[trpgTasks().length - 1];
    rule("taskSave", { task: Object.assign(JSON.parse(JSON.stringify(t)), { nodes: [
      { type: "battle", title: "伏击", note: "", enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], weather: "none", zoneMode: 2, hidden: false, reward: { xp: 0, kuizhi: 300 } },
      { type: "event", title: "检查货物", note: "", enemies: [], weather: "none", zoneMode: 2, hidden: false, reward: { xp: 0, kuizhi: 0 } }] }) });
    rule("taskStatus", { id: t.id, status: "posted" });
    rule("taskAccept", { id: t.id });
    return t.id;
  });
  // 任务页点「开战」：记下这场是任务战斗，进战斗画面，护送对象跟着上场
  await page.click('[data-tab="tasks"]');
  await page.click(`[data-tk="fight:${id}"]`);
  await page.waitForFunction(() => Screens.is("battle") && !!fieldEscort());
  await page.evaluate(() => { GAME.skip = true; GAME.instant = true; GAME.startOrEnd(); });
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 30000 });
  // 打到一半：护送对象挨了几下；房主的房间检查点（刷新时 online-game.js 在 pagehide 里写的就是这两份）
  const escortHp = await page.evaluate(() => {
    const e = fieldEscort(); e.layers[0].current = e.layers[0].max - 3;
    localStorage.setItem("tb-resume-test", JSON.stringify({ game: GAME.onlineCheckpoint(), trpg: TrpgFlow.onlineCheckpoint() }));
    return e.layers[0].current;
  });
  // 刷新页面，照 doResume 的顺序恢复：先战场（GAME），再跑团（TrpgFlow），然后回到战斗画面
  await page.goto(url);
  await page.waitForFunction(() => !!window.GAME && !!window.TrpgFlow && typeof trpgTasks === "function");
  const resumed = await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    const saved = JSON.parse(localStorage.getItem("tb-resume-test"));
    GAME.restoreOnline(saved.game); TrpgFlow.restoreOnline(saved.trpg); Screens.show("battle");
    GAME.skip = true; GAME.instant = true;
    return { taskBattle: TRPG.taskBattle, escort: !!fieldEscort(), purses: partyHeroes().reduce((s, h) => s + trpgPurse(h.kit), 0) };
  });
  assert.equal(resumed.escort, true, "护送对象跟着战场一起恢复");
  // 打赢：敌人全倒，走真的结算（game.js · checkEnd → finish → onBattleFinished → trpg-ui.js · recordBattle）
  await page.evaluate(() => { state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; (u.layers || []).forEach(l => { l.current = 0; }); }); GAME.checkEnd(); });
  await page.waitForFunction(() => GAME.ended);
  const after = await page.evaluate(id => {
    const t = trpgTaskById(id), log = TrpgFlow.onlineCheckpoint().log;
    return { index: t.index, status: t.status, cur: t.escort.cur, taskBattle: TRPG.taskBattle, log: (log[log.length - 1] || { lines: [] }).lines.join("\n"),
      purses: partyHeroes().reduce((s, h) => s + trpgPurse(h.kit), 0) };
  }, id);
  assert.equal(after.index, 1, "走到第 2 站：" + after.log);
  assert.equal(after.status, "active");
  assert.match(after.log, /战斗胜利/);
  assert.match(after.log, /任务「.+」第 1 站（伏击）完成。下一站：检查货物。/);
  assert.equal(after.purses - resumed.purses, 300, "这一站的 300 奎支进了各人钱包");
  assert.equal(after.cur, escortHp, "护送对象的血量记回任务");
  assert.deepEqual(resumed.taskBattle, { id, index: 0 }, "恢复后接着认这一场是任务战斗");
  assert.equal(after.taskBattle, null, "结算完就不是任务战斗了");
  assert.deepEqual(errors, []);
});
