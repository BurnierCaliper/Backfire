// 画面冒烟测试：用真的浏览器打开 game.html，把跑团模式、战斗画面、单局、音效各走一遍。
//
// 需要 Playwright（本机或全局装的都行：npm i -D playwright 或 npm i -g playwright）。
// 找不到就整组跳过，npm test 其余部分照常跑，不用装任何依赖。
// 规则层的测试管「算得对不对」，这里管「画面上点得动、点了有反应、没有报错」——
// 例如「技能不等选目标就放出去」这种只在画面里出现的问题。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
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
const GAME_URL = "file://" + path.resolve(__dirname, "..", "game.html");

let browser = null;
let skipWhy = pw ? "" : "没装 Playwright，跳过画面测试";
test.before(async () => {
  if (!pw) return;
  try { browser = await pw.chromium.launch(); } catch (e) { skipWhy = "浏览器启动失败，跳过画面测试：" + e.message.split("\n")[0]; }
});
test.after(async () => { if (browser) await browser.close(); });

/** 每个测试一个全新的浏览器环境（本机存档互不影响） */
async function open(t) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  let promptAnswer = "测试团";
  page.on("dialog", d => (d.type() === "prompt" ? d.accept(promptAnswer) : d.accept()));
  await page.goto(GAME_URL);
  t.after(() => context.close());
  return { page, errors, setPrompt: (s) => { promptAnswer = s; } };
}

async function newTrpg(page, slot) {
  await page.click("#t-sandbox");
  await page.click(`[data-new="${slot || 0}"]`);
  await page.waitForSelector("#scr-trpg:not([hidden])");
}
/** 从探索环节进战斗；prep 在开战前改场面（放墙、放按钮、删敌人……） */
async function startBattle(page, prep) {
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
const apOf = (page, id) => page.evaluate(i => state.units.find(u => u.id === i).ap, id);

test("标题画面正常打开，没有报错", async (t) => {
  const o = await open(t); if (!o) return;
  await o.page.waitForSelector("#scr-title:not([hidden])");
  for (const id of ["#t-new", "#t-sandbox"]) assert.ok(await o.page.isVisible(id));
  assert.deepEqual(o.errors, []);
});

test("跑团模式：开团、买东西、休息、升级武器、后台改数值，刷新后还在", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.click('[data-tab="bag"]');
  await page.fill("#tr-kz", "20000"); await page.click("#tr-kz-add");
  await page.click('[data-tab="shop"]');
  for (let i = 0; i < 3; i++) await page.click('[data-buy="mat_metal"]');
  await page.click('[data-tab="smith"]');
  await page.click('[data-up$=":self"]:not([disabled])');
  await page.click('[data-tab="rest"]');
  await page.click('[data-hours="8"]');
  await page.click("#tr-long-force");
  await page.click("#tr-bs");
  await page.fill("#bs-kz", "4321");
  await page.click("#bs-apply");
  const s1 = await page.evaluate(() => ({ kz: state.kuizhi, wl: JSON.stringify(partyHeroes().map(h => h.weaponLevels || {})), log: document.querySelectorAll("#tr-log li").length }));
  assert.equal(s1.kz, 4321);
  assert.match(s1.wl, /:2/);
  assert.ok(s1.log >= 6);
  await page.reload();
  await page.click("#t-sandbox");
  await page.click('[data-open="0"]');
  const s2 = await page.evaluate(() => ({ kz: state.kuizhi, wl: JSON.stringify(partyHeroes().map(h => h.weaponLevels || {})), log: document.querySelectorAll("#tr-log li").length }));
  assert.deepEqual(s2, s1);
  assert.deepEqual(o.errors, []);
});

test("跑团模式：两个存档空位互不影响", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page, 0);
  await page.click('[data-tab="bag"]');
  await page.fill("#tr-kz", "777"); await page.click("#tr-kz-add");
  await page.click("#tr-slots");
  o.setPrompt("第二团");
  await page.click('[data-new="1"]');
  assert.equal(await page.evaluate(() => state.kuizhi), 0);
  await page.click("#tr-slots");
  await page.click('[data-open="0"]');
  assert.equal(await page.evaluate(() => state.kuizhi), 777);
  assert.deepEqual(o.errors, []);
});

test("战斗：需要目标的技能先等选目标，点敌人才出手并扣行动点", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  const ruby = await selectHero(page, "ruby");
  const ap0 = await apOf(page, ruby);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  assert.equal(await apOf(page, ruby), ap0, "还没选目标就扣了行动点");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  const hp0 = await page.evaluate(i => totalHp(state.units.find(u => u.id === i)), foe);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap < 1 && GAME.depth === 0, ruby);
  const hp1 = await page.evaluate(i => totalHp(state.units.find(u => u.id === i)), foe);
  assert.ok(hp1 <= hp0);
  assert.deepEqual(o.errors, []);
});

test("战斗：危墙可以选为目标，打一下扣行动点、耐久下降", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => { state.gaps["1-2"] = { type: "wall", hp: 30, maxHp: 30, open: false }; });
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForSelector(".g-gap.is-targetable");
  await page.click(".g-gap.is-targetable");
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, ruby);
  assert.ok(await page.evaluate(() => state.gaps["1-2"].hp < 30));
  assert.deepEqual(o.errors, []);
});

test("战斗：按钮可以被攻击触发，门打开", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    state.gaps["1-2"] = { type: "door", hp: 0, maxHp: 0, open: false };
    const b = makeProp("button", 1, 1); b.link = "1-2"; state.props = [b];
  });
  await selectHero(page, "hiaki");   // 近战，打同区的按钮
  await page.keyboard.press("1");
  await page.waitForSelector(".is-targetable:has(.prop)");
  await page.click(".is-targetable:has(.prop)");
  await page.waitForFunction(() => state.gaps["1-2"].open === true && GAME.depth === 0);
  assert.deepEqual(o.errors, []);
});

test("跑团战斗：击杀得到经验和奎支，结算写进探索记录", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    Math.random = () => 0.999;   // 不让格挡、闪避之类的随机判定干扰
    const foes = state.units.filter(u => !u.isPlayer);
    state.units = state.units.filter(u => u.isPlayer || u === foes[0]);
    foes[0].layers.forEach(l => { l.current = 1; });
  });
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer).id);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => GAME.ended, null, { timeout: 15000 });
  await page.waitForSelector("#g-explore-back", { state: "visible" });
  await page.click("#g-explore-back");
  await page.waitForSelector("#scr-trpg:not([hidden])");
  const last = await page.evaluate(() => [...document.querySelectorAll("#tr-log li")].pop().innerText);
  assert.match(last, /战斗胜利/);
  assert.match(last, /每人获得 \d+ 经验/);
  assert.ok(await page.evaluate(() => partyHeroes().every(h => h.xp > 0)));
  assert.ok(ruby);
  assert.deepEqual(o.errors, []);
});

test("单局：选队伍出发，任务板正常显示", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-new");
  await page.waitForSelector("#scr-party:not([hidden])");
  const picks = page.locator(".hero-pick");
  await picks.nth(0).click(); await picks.nth(1).click();
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  assert.ok((await page.textContent("#run-body")).length > 0);
  assert.deepEqual(o.errors, []);
});

test("音效：七种属性都能合成，有声、不削顶、不出错", async (t) => {
  const o = await open(t); if (!o) return;
  const r = await o.page.evaluate(async () => {
    const out = {};
    for (const e of Sfx.ELEMENTS) {
      const d = await Sfx.render(e, { big: true });
      let peak = 0, bad = false, zc = 0;
      for (let i = 0; i < d.length; i++) { if (!isFinite(d[i])) bad = true; peak = Math.max(peak, Math.abs(d[i])); if (i && (d[i - 1] < 0) !== (d[i] < 0)) zc++; }
      out[e] = { peak, bad, zc };
    }
    return out;
  });
  for (const [e, v] of Object.entries(r)) {
    assert.equal(v.bad, false, e + " 有非法采样");
    assert.ok(v.peak > 0.05, e + " 几乎没声音");
    assert.ok(v.peak < 1, e + " 削顶");
  }
  assert.ok(r.ice.zc > r.physical.zc * 5, "冰应该比物理清亮得多");
  // 开关
  await o.page.click("#t-sandbox");
  await o.page.click('[data-new="0"]');
  await o.page.click("#tr-fight");
  await o.page.click("#g-sfx");
  assert.equal(await o.page.evaluate(() => Sfx.enabled()), false);
  await o.page.click("#g-sfx");
  assert.equal(await o.page.evaluate(() => Sfx.enabled()), true);
  assert.deepEqual(o.errors, []);
});
