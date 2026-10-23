// 作者试玩反馈（10/20）重做（issue #356）：要浏览器的那部分——单机战斗画面（旧画面）里协助攻击打死自爆小车：
// 协助攻击的打击形状只落在小车身上，打死它的那一下演完以后小车才炸开（爆炸形状、「引爆」）。
// 以前小车的死亡引爆被当成协助攻击本身的伤害：协助攻击的刀光 / 弹道挨个落到被炸到的队友和敌人身上，而且先炸、后挨刀。
// 不用浏览器的那几条（规则、联机的白名单、新画面、音效）在 tests/author-feedback-1020.test.js。
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

test("单机旧画面：协助攻击打死自爆小车——打击形状只落在小车身上，打死它以后小车炸开（以前协助攻击的刀光挨个落到被炸到的人身上）", { timeout: 90000 }, async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(ROOT, "game.html")).href);
  await page.waitForFunction(() => !!window.GAME && !!window.AttackFx && typeof BattleSim !== "undefined");
  // 瑞比在 1 区远程打出失衡；结人和狂徒站在小车那一区（2 区），会被引爆炸到。架势都垫高，炸完不再有人失衡、不再弹问题
  const ids = await page.evaluate(() => {
    window.__noLevelUpPopup = true;
    Math.random = () => 0.999;
    Screens.show("battle");
    GAME.startCustomBattle("自爆小车", () => {
      BattleSim.setup({ party: ["ruby", "yuito"], enemies: [{ id: "boomcar", lv: 3, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "FB20-UI" });
      return {};
    });
    GAME.startOrEnd();
    return { car: state.units.find(u => u.kit === "boomcar").id, ruby: partyHeroes().find(h => h.kit === "ruby").id };
  });
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
  await page.evaluate(car => {
    const intro = document.getElementById("g-intro"); if (intro) intro.remove();
    partyHeroes().forEach(h => { h.zone = h.kit === "ruby" ? 1 : 2; h.def = h.defMax = 99; h.layers.forEach(l => { l.max = Math.max(l.max, 200); l.current = l.max; }); });
    const thug = state.units.find(u => u.kit === "thug_knife");
    thug.def = thug.defMax = 99; thug.layers.forEach(l => { l.max = l.current = 300; });
    // 小车架势 1、血厚：瑞比一下打出失衡但打不死
    const c = state.units.find(u => u.id === car);
    c.def = 1; c.atk = Math.max(10, c.atk || 0);
    c.layers.forEach(l => { l.max = Math.max(l.max, 60); l.current = 60; });
    GAME.refresh();
    // 记下每个打击形状画在哪张卡上（离落点最近的那张）
    window.__hitOn = [];
    const f = AttackFx.impact;
    AttackFx.impact = function (at, move) {
      let best = null, bd = 1e9;
      document.querySelectorAll(".unit-wrap[data-id]").forEach(el => {
        const r = el.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - at.x, r.top + r.height / 2 - at.y);
        if (d < bd) { bd = d; best = el.dataset.id; }
      });
      window.__hitOn.push({ kind: move && move.kind, id: best });
      return f.apply(this, arguments);
    };
  }, ids.car);
  await page.click(`.unit-wrap[data-id="${ids.ruby}"]`);
  await page.waitForFunction(i => GAME.actorId === i, ids.ruby);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.click(`.unit-wrap[data-id="${ids.car}"]`);
  // 没有鼠标的无界面 Chrome 报「hover: none」，画面按触屏走：第一下只预览，再点一下才确认（game.js · onCardClick）
  await page.waitForTimeout(200);
  if (await page.evaluate(() => !!(GAME.arm && GAME.arm.tapId))) await page.click(`.unit-wrap[data-id="${ids.car}"]`);
  await page.waitForFunction(() => !!document.querySelector("#g-choice.show") && /失衡/.test(document.querySelector("#g-choice.show h3").textContent), null, { timeout: 20000 });
  // 协助攻击这一下要把小车打死：血压到 1
  await page.evaluate(i => { const c = state.units.find(u => u.id === i); c.layers.forEach((l, k) => { l.current = k === c.layers.length - 1 ? 1 : 0; }); window.__hitOn = []; }, ids.car);
  await page.click("#g-choice.show .opts button");   // 第一项：结人协助攻击
  await page.waitForFunction(() => GAME.depth === 0 && !document.querySelector("#g-choice.show"), null, { timeout: 30000 });
  const r = await page.evaluate(() => ({ hits: window.__hitOn, log: (state.logPages || []).flatMap(p => p.lines || []).map(l => l.text).join("\n") }));
  assert.match(r.log, /死亡引爆/, "小车被协助攻击打死并引爆");
  assert.ok(r.hits.length >= 2, "协助攻击的打击形状 + 引爆的爆炸：" + JSON.stringify(r.hits));
  assert.ok(r.hits.every(h => h.id === ids.car), "打击形状都落在小车身上：" + JSON.stringify(r.hits));
  assert.equal(r.hits[r.hits.length - 1].kind, "explode", "最后是小车炸开");
  assert.deepEqual(errors, []);
});
