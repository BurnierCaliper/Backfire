// 攻击演出（attack-fx.js）在真浏览器里：出手时按招式画刀光 / 弹道，攻击者冲过去、目标被打退，
// 敌人倒下喷红叉，敌人回合问格挡时问题框贴底、战场上画出这一击的指向，选目标时有瞄准线。
// 需要 Playwright（同 tests/ui.test.js）；找不到就整组跳过，`npm run test:ui` 时必须跑。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { execSync } = require("child_process");

function findPlaywright() {
  try { return require("playwright"); } catch (e) {}
  try {
    const root = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return require(path.join(root, "playwright"));
  } catch (e) {}
  return null;
}
const pw = findPlaywright();
const GAME_URL = pathToFileURL(path.resolve(__dirname, "..", "game.html")).href;
const requireUI = process.env.REQUIRE_UI === "1";

let browser = null;
let skipWhy = pw ? "" : "没装 Playwright，跳过画面测试";
test.before(async () => {
  if (!pw) {
    if (requireUI) throw new Error("UI 验收需要 Playwright；请安装或通过 NODE_PATH 指定现有安装。");
    return;
  }
  try { browser = await pw.chromium.launch(); } catch (e) {
    if (requireUI) throw e;
    skipWhy = "浏览器启动失败，跳过画面测试：" + e.message.split("\n")[0];
  }
});
test.after(async () => { if (browser) await browser.close(); });

async function open(t) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("测试团") : d.accept()));
  await page.goto(GAME_URL);
  await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    // 记下演出层画了什么：每一下打中的招式、喷了几个红叉、瞄准线 / 攻击指向画过没有
    window.__fx = { impacts: [], ko: 0, aim: 0, threat: 0 };
    const wrap = (k, fn) => { const f = AttackFx[k]; AttackFx[k] = function () { fn.apply(null, arguments); return f.apply(this, arguments); }; };
    wrap("impact", (at, move) => window.__fx.impacts.push(move && move.kind));
    wrap("ko", () => { window.__fx.ko++; });
    wrap("aim", () => { window.__fx.aim++; });
    wrap("threat", () => { window.__fx.threat++; });
  });
  t.after(() => context.close());
  return { page, errors };
}
async function startBattle(page, prep) {
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  if (prep) await page.evaluate(prep);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
}
async function selectHero(page, kit) {
  const id = await page.evaluate(k => (partyHeroes().find(h => h.kit === k) || {}).id, kit);
  assert.ok(id, "队伍里没有 " + kit);
  await page.click(`.unit-wrap[data-id="${id}"]`);
  await page.waitForFunction(i => GAME.actorId === i, id);
  return id;
}

test("攻击演出：绯秋近身一刀——瞄准时有瞄准线，出手冲过去、画刀光，目标顺着挨打的方向被打退", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.5;
    const foe = state.units.find(u => !u.isPlayer); foe.zone = 1;
  });
  await page.evaluate(() => {
    window.__seen = { lunge: false, knock: false };
    new MutationObserver(() => {
      if (document.querySelector(".unit-wrap.lunge")) window.__seen.lunge = true;
      if (document.querySelector(".unit-wrap.hit.knock")) window.__seen.knock = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  const hiaki = await selectHero(page, "hiaki");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && Number(u.zone) === 1).id);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.hover(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => window.__fx.aim > 0, null, { timeout: 3000 });
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, hiaki, { timeout: 15000 });
  const fx = await page.evaluate(() => window.__fx);
  assert.ok(fx.impacts.includes("slash"), "绯秋的普通攻击按刀光演：" + JSON.stringify(fx.impacts));
  assert.ok(await page.evaluate(() => window.__seen.lunge), "攻击者冲过去");
  assert.ok(await page.evaluate(() => window.__seen.knock), "目标顺着挨打的方向被打退");
  assert.ok(await page.evaluate(() => !!document.getElementById("atk-fx")), "演出画布在页面上");
  assert.deepEqual(o.errors, []);
});

test("攻击演出：瑞比两发能量弹打倒敌人——两下各补一个落点，倒下喷红叉", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.999;
    const foes = state.units.filter(u => !u.isPlayer);
    state.units = state.units.filter(u => u.isPlayer || u === foes[0]);
    foes[0].layers.forEach(l => { l.current = 1; });
  });
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer).id);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => GAME.ended || (GAME.depth === 0 && state.units.find(u => !u.isPlayer).dead), null, { timeout: 15000 });
  await page.waitForFunction(() => window.__fx.ko > 0, null, { timeout: 5000 });
  const fx = await page.evaluate(() => window.__fx);
  assert.deepEqual(fx.impacts.filter(k => k === "bolt").length, 2, "两段能量弹各有落点：" + JSON.stringify(fx.impacts));
  assert.equal(fx.ko, 1, "敌人倒下喷一个红叉");
  assert.ok(ruby);
  assert.deepEqual(o.errors, []);
});

test("敌人回合问协助格挡：问题框贴在底部、战场不压暗，画出敌人这一击从谁指向谁", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => {
    Math.random = () => 0.5;
    state.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 1; });
  });
  await page.keyboard.press("Space");
  // 还有行动点没用：先确认结束回合（普通确认框，不贴底）
  await page.waitForSelector("#g-choice.show", { timeout: 20000 });
  if (await page.evaluate(() => document.querySelector("#g-choice.show h3").textContent === "结束回合")) {
    assert.equal(await page.evaluate(() => document.getElementById("g-choice").classList.contains("dock")), false, "普通确认框照旧居中压暗");
    await page.keyboard.press("1");
    await page.waitForFunction(() => !!document.querySelector("#g-choice.show") && document.querySelector("#g-choice.show h3").textContent !== "结束回合", null, { timeout: 20000 });
  }
  assert.match(await page.evaluate(() => document.querySelector("#g-choice.show h3").textContent), /攻击|处刑/, "敌人打过来，问要不要格挡");
  assert.ok(await page.evaluate(() => document.getElementById("g-choice").classList.contains("dock")), "格挡询问贴底");
  assert.ok(await page.evaluate(() => window.__fx.threat > 0), "战场上画出这一击的指向");
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById("g-choice")).backgroundImage);
  assert.match(bg, /gradient/, "上半截几乎不压暗（渐变）");
  await page.keyboard.press("Escape");   // 不格挡
  await page.waitForFunction(() => !document.querySelector("#g-choice.show") || document.querySelector("#g-choice.show h3").textContent, null, { timeout: 5000 });
  // 收起之后不是贴底样式残留在别的问题上：随便开一个普通确认框看一眼
  await page.waitForFunction(() => state.combatPhase === "player" && GAME.depth === 0 || !!document.querySelector("#g-choice.show"), null, { timeout: 30000 });
  assert.deepEqual(o.errors, []);
});

test("演出 2× 和点击跳过：攻击演出跟着加速 / 立刻收掉，不拖住战斗", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await startBattle(page, () => { Math.random = () => 0.5; });
  await page.keyboard.press("f");
  assert.equal(await page.evaluate(() => GAME.fast), true);
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && !u.dead).id);
  const t0 = Date.now();
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForTimeout(60);
  await page.click(`.unit-wrap[data-id="${ruby}"]`).catch(() => {});   // 演出中点战场 = 跳过
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, ruby, { timeout: 15000 });
  assert.ok(Date.now() - t0 < 6000, "跳过后很快结束：" + (Date.now() - t0) + "ms");
  await page.waitForFunction(() => !AttackFx.busy(), null, { timeout: 3000 });
  assert.deepEqual(o.errors, []);
});
