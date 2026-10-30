// #382：打爆同区有人的爆炸桶，战斗画面弹出「爆炸桶 阵亡：队伍成员爆炸桶 的坚毅生命耗尽……」。
// 原因：画面快照里不是敌方的配置物 isPlayer 也是 true（game.js · snapProp：定卡片排在哪一边、画成哪一方）；
// 爆炸桶耐久打到 0 以后先炸同区的人、再从场上拿掉，炸到人那一下的快照里桶已经是「倒下」，
// 演出（game.js · playBeats）就把它当成我方有人阵亡，盖「倒下」、弹阵亡提示。超充能电池等别的配置物一样。
// 现在配置物被打掉只盖「摧毁」，阵亡提示只给真的队伍成员（武器人、护送对象照旧）。
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

/** 跑团沙盒开一场默认的战斗（同 task-battle-resume-ui.test.js），开战后记下弹过的提示框和盖过的章 */
async function battle(t, oldScreen) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (oldScreen) await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(pathToFileURL(path.join(ROOT, "game.html")).href);
  await page.waitForFunction(() => !!window.GAME && typeof trpgTasks === "function");
  await page.evaluate(() => { window.__noLevelUpPopup = true; Commands.dispatch({ type: "trpg.ui", action: "new", index: 0, name: "爆炸桶团", level: 1 }); });
  await page.waitForFunction(() => Screens.is("trpg"));
  await page.click("#tr-fight");
  await page.waitForFunction(() => Screens.is("battle") && !!document.querySelector("#g-start") && !state.combatStarted);
  await page.evaluate(() => { GAME.instant = true; GAME.startOrEnd(); });
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__choices = []; window.__stamps = [];
    const box = document.getElementById("g-choice");
    new MutationObserver(() => { if (box.classList.contains("show")) window.__choices.push(box.querySelector("h3").textContent); })
      .observe(box, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains("stamp")) window.__stamps.push(n.textContent); })))
      .observe(document.body, { childList: true, subtree: true });
    // 敌人都挪到 2 区，我方都在 1 区、血量和架势都厚（炸不死、不失衡）
    state.units.forEach(u => {
      if (!u.isPlayer) u.zone = 2;
      else if (!u.hidden) { u.zone = 1; u.def = u.defMax = 99; u.layers.forEach(l => { l.current = l.max = 500; }); }
    });
    GAME.refresh();
  });
  return { page, errors };
}

/** 在 1 区摆一个配置物，用第一名队员的一次行动把它打掉（走战斗画面的整套演出：game.js · act → perform → playTape）；
 *  中途弹出的提示框都点掉，返回弹过的提示框标题和盖过的章 */
async function blowUp(page, kind, element, dmg, prep) {
  await page.evaluate(({ kind, element, dmg, prep }) => {
    const hero = partyHeroes()[0];
    if (prep) (0, eval)("(" + prep + ")")(hero);
    const p = makeProp(kind, 1, 1);
    state.props.push(p);
    GAME.refresh();
    window.__actDone = false;
    GAME.act(() => {
      const prop = state.props.find(x => x.id === p.id);
      damageProp(prop, { element, dmg }, hero).forEach(s => appendLog(s));
    }, { skillName: "测试：打掉" + p.name }).then(() => { window.__actDone = true; });
  }, { kind, element, dmg, prep: prep ? String(prep) : null });
  for (let i = 0; i < 10; i++) {
    await page.waitForFunction(() => window.__actDone || !!document.querySelector("#g-choice.show"), null, { timeout: 30000 });
    if (await page.evaluate(() => window.__actDone)) break;
    const seen = await page.evaluate(() => window.__choices.length);
    await page.click("#g-choice.show .opts button");
    // 点掉以后：行动结束，或者收起了，或者马上弹出了下一个
    await page.waitForFunction(n => window.__actDone || window.__choices.length > n || !document.querySelector("#g-choice.show"), seen);
  }
  return page.evaluate(k => ({ choices: window.__choices.slice(), stamps: window.__stamps.slice(), left: state.props.filter(p => p.kind === k).length,
    alive: partyHeroes().filter(h => !h.dead).length }), kind);
}

for (const oldScreen of [true, false]) {
  const screen = oldScreen ? "旧画面" : "新画面";
  test(`打爆同区有人的爆炸桶、超充能电池：不弹「阵亡」提示（${screen}）`, { timeout: 90000 }, async t => {
    if (!browser) { t.skip(skipWhy); return; }
    const { page, errors } = await battle(t, oldScreen);
    const alive0 = await page.evaluate(() => partyHeroes().filter(h => !h.dead).length);
    const boom = await blowUp(page, "boom", "fire", 5);
    assert.equal(boom.left, 0, "爆炸桶炸掉了");
    assert.deepEqual(boom.choices, [], "以前弹「爆炸桶 阵亡」");
    assert.equal(boom.alive, alive0, "队友都还活着");
    const battery = await blowUp(page, "battery", "physical", 999);
    assert.equal(battery.left, 0, "电池炸掉了");
    assert.deepEqual(battery.choices, [], "以前弹「超充能电池 阵亡」");
    if (oldScreen) {
      // 旧画面：配置物卡上盖「摧毁」，不再盖队员倒下用的「倒下」
      assert.ok(battery.stamps.filter(s => s === "摧毁").length >= 2, JSON.stringify(battery.stamps));
      assert.ok(!battery.stamps.includes("倒下"), JSON.stringify(battery.stamps));
    }
    assert.deepEqual(errors, []);
  });
}

test("爆炸桶炸死了起身中的队友：只弹这名队友的阵亡提示（照旧），不弹爆炸桶的", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const { page, errors } = await battle(t, true);
  const name = await page.evaluate(() => partyHeroes()[0].name);
  // 第一名队员起身中、坚毅生命只剩 1：爆炸（1d20 + 1 火焰）一定打光
  const out = await blowUp(page, "boom", "fire", 5, hero => {
    hero.layers.forEach(l => { l.current = 0; }); hero.dying = false; hero.upOnShp = true; hero.shp = 1;
  });
  assert.equal(out.left, 0);
  assert.deepEqual(out.choices, [`${name} 阵亡`], "以前弹完队友的，还多弹一个「爆炸桶 阵亡」");
  assert.ok(out.stamps.includes("倒下"), "队友照旧盖「倒下」：" + JSON.stringify(out.stamps));
  assert.ok(out.stamps.includes("摧毁"), JSON.stringify(out.stamps));
  assert.deepEqual(errors, []);
});
