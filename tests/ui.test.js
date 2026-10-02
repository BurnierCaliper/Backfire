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

test("战斗：灯的普通攻击能选中危墙；打中时危墙抖动闪白、弹出数字", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.evaluate(() => { GAME.partyKits = ["tou", "ruby"]; GAME.lastEncounter = null; });
  await startBattle(page, () => {
    state.gaps["1-2"] = { type: "wall", hp: 30, maxHp: 30, open: false };
    state.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  });
  // 记下危墙竖条有没有被加上受击 class、有没有弹出数字
  await page.evaluate(() => {
    window.__gapHit = false; window.__pop = false;
    new MutationObserver(() => {
      if (document.querySelector("#g-field .g-gap.hit")) window.__gapHit = true;
      if (document.querySelector(".fx .pop, #g-fx .pop, .pop")) window.__pop = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
  const tou = await selectHero(page, "tou");
  await page.evaluate(i => { state.units.find(u => u.id === i).resources.shield = 0; }, tou);   // 不弹「是否耗圣盾」
  await page.keyboard.press("1");
  await page.waitForSelector(".g-gap.is-targetable", { timeout: 5000 });
  await page.click(".g-gap.is-targetable");
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, tou);
  assert.equal(await page.evaluate(() => state.gaps["1-2"].hp), 29, "危墙吃 1 击破");
  assert.ok(await page.evaluate(() => window.__gapHit), "危墙应该播受击");
  assert.ok(await page.evaluate(() => window.__pop), "应该弹出数字");
  assert.deepEqual(o.errors, []);
});

test("结算面板点「战场数据」：结算面板收起，关掉数据表后回到结算面板", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    Math.random = () => 0.999;   // 不让格挡、闪避之类的随机判定干扰
    const foes = state.units.filter(u => !u.isPlayer);
    state.units = state.units.filter(u => u.isPlayer || u === foes[0]);
    foes[0].layers.forEach(l => { l.current = 1; });
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer).id);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => GAME.ended, null, { timeout: 15000 });
  await page.waitForSelector("#g-result.show");
  await page.click("#g-review-stats");
  assert.equal(await page.evaluate(() => document.getElementById("g-result").classList.contains("show")), false, "结算面板应该收起");
  assert.ok(await page.isVisible("#g-stats-sheet"), "数据表应该显示");
  await page.click("#g-stats-close");
  assert.equal(await page.evaluate(() => document.getElementById("g-result").classList.contains("show")), true, "关掉数据表回到结算面板");
  assert.equal(await page.isVisible("#g-stats-sheet"), false);
  assert.deepEqual(o.errors, []);
});

test("战斗：打配置物时攻击者前冲、配置物受击闪白", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    const b = makeProp("battery", 2, 1); b.faction = "enemy"; state.props = [b];
  });
  await page.evaluate(() => {
    window.__propHit = false; window.__lunge = false;
    new MutationObserver(() => {
      if (document.querySelector('.unit-wrap.hit[data-id^="prop:"]')) window.__propHit = true;
      if (document.querySelector(".unit-wrap.lunge")) window.__lunge = true;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  const ruby = await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const pid = await page.evaluate(() => "prop:" + state.props[0].id);
  const hp0 = await page.evaluate(() => state.props[0].hp);
  await page.click(`.unit-wrap[data-id="${pid}"]`);
  await page.waitForFunction(i => state.units.find(u => u.id === i).ap === 0 && GAME.depth === 0, ruby);
  assert.ok(await page.evaluate(() => state.props[0].hp) < hp0);
  assert.ok(await page.evaluate(() => window.__propHit), "配置物应该受击闪白");
  assert.ok(await page.evaluate(() => window.__lunge), "攻击者应该前冲");
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

test("单局：熟练项检定节点——每个人的熟练等级和成功率，点人检定后前进", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-new");
  await page.waitForSelector("#scr-party:not([hidden])");
  // 选瑞比和结人
  await page.click('.hero-pick[data-kit="ruby"]');
  await page.click('.hero-pick[data-kit="yuito"]');
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  assert.match(await page.textContent("#run-party"), /人类 · 黑客 · 数据操作2/);
  await page.click('.r-go[data-which="main"]');
  // 存档里把当前这站换成一个困难、会受伤的数据操作检定，再读档
  await page.evaluate(() => {
    const r = SaveStore.loadRun();
    r.task.nodes[r.task.index] = { type: "check", done: false, check: { diff: "hard", prof: "数据操作", injure: true, reward: 2500 } };
    r.task.nodes[r.task.index + 1] = { type: "check", done: false };   // 下一站也是检定：页面上一直有检定按钮
    SaveStore.saveRun(r);
    RunFlow.resume();
  });
  await page.waitForSelector('[data-check="ruby"]');
  const body = await page.textContent("#run-body");
  assert.match(body, /困难/);
  assert.match(body, /2500 奎支/);
  assert.match(body, /有风险/);
  // 瑞比数据操作二级：困难 50%，人类重掷后 75%；结人没有这项：不能尝试
  assert.match(await page.textContent('[data-check="ruby"]'), /二级熟练[\s\S]*75%[\s\S]*可重掷/);
  assert.equal(await page.isDisabled('[data-check="yuito"]'), true);
  await page.click('[data-check="ruby"]');
  // 下一站也可能刚好是检定（随机生成的主线），所以等日志，不等按钮消失
  await page.waitForFunction(() => /困难「数据操作」检定/.test(document.querySelector("#run-log").textContent));
  assert.equal(await page.evaluate(() => SaveStore.loadRun().task.index), 1, "前进到下一站");
  assert.deepEqual(o.errors, []);
});

test("单局：休息点可以选守夜；没人守夜被偷袭时进遭遇战，我方跳过第一回合；战斗前只剩短休", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-new");
  await page.waitForSelector("#scr-party:not([hidden])");
  await page.click('.hero-pick[data-kit="ruby"]');
  await page.click('.hero-pick[data-kit="yuito"]');
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  await page.click('.r-go[data-which="main"]');
  // 战斗节点前：只有短休，没有「先长休再前进」
  await page.evaluate(() => {
    const r = SaveStore.loadRun();
    r.task.nodes[r.task.index] = { type: "battle", done: false };
    SaveStore.saveRun(r);
    RunFlow.resume();
  });
  await page.waitForSelector("#r-short-before");
  assert.equal(await page.locator("#r-rest-before").count(), 0);
  // 休息点：有守夜选项和偷袭概率；概率设成 100%
  await page.evaluate(() => {
    const r = SaveStore.loadRun();
    r.task.nodes[r.task.index] = { type: "rest", done: false };
    r.ambushChance = 1;
    SaveStore.saveRun(r);
    RunFlow.resume();
  });
  await page.waitForSelector("#r-watch");
  assert.match(await page.textContent("#r-ambush-chance"), /100%/);
  assert.ok(await page.locator('#r-watch option[value="ruby"]').count() === 1);
  await page.click("#r-long");
  await page.waitForSelector("#r-fight");
  assert.match(await page.textContent("#run-body"), /偷袭/);
  await page.click("#r-fight");
  await page.waitForSelector("#g-start");
  assert.equal(await page.evaluate(() => state.ambush), true);
  await page.keyboard.press("Space");
  // 第一回合被跳过：直接进敌人回合，打完回到第 2 回合的玩家回合
  await page.waitForFunction(() => state.turnNo >= 2 || GAME.ended, null, { timeout: 30000 });
  assert.match(await page.evaluate(() => state.logPages.map(p => p.lines.map(l => l.text || l).join("\n")).join("\n")), /遭遇战/);
  assert.deepEqual(o.errors, []);
});

test("单人模式：选主角、三名伙伴、第二副职责出发；战斗里 2 行动点，攒够分数后用支援叫伙伴登场", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-solo");
  await page.waitForSelector("#scr-party:not([hidden])");
  assert.match(await page.textContent("#party-title"), /单人模式/);
  await page.click('.hero-pick[data-kit="ruby"]');
  assert.equal(await page.isDisabled('[data-role2="直伤"]').catch(() => true), true, "瑞比本来的职责不能选");
  for (const k of ["kolt", "yuito", "tou"]) await page.click(`.hero-pick[data-kit="${k}"]`);
  assert.equal(await page.isDisabled("#party-go"), true, "还没选第二副职责");
  await page.click('[data-role2="生存"]');
  assert.equal(await page.isDisabled("#party-go"), false);
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  assert.match(await page.textContent("#run-party"), /第二副职责 生存/);
  assert.match(await page.textContent("#run-party"), /柯尔特、结人、灯/);
  await page.click('.r-go[data-which="main"]');
  await page.evaluate(() => {
    const r = SaveStore.loadRun();
    r.task.nodes[r.task.index] = { type: "battle", done: false };
    SaveStore.saveRun(r);
    RunFlow.resume();
  });
  await page.click("#r-fight");
  await page.waitForSelector("#g-start");
  await page.waitForSelector("#g-intro", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.click("#g-start");
  await page.waitForFunction(() => state.combatStarted && GAME.depth === 0, null, { timeout: 15000 });
  const hero = await page.evaluate(() => state.units.find(u => u.kit === "ruby").id);
  assert.equal(await apOf(page, hero), 2);
  await page.evaluate(() => { state.battleScore.total = 600; });
  await page.click(`.unit-wrap[data-id="${hero}"]`);
  await page.waitForFunction(i => GAME.actorId === i, hero);
  // 记下伙伴的卡片有没有登场
  await page.evaluate(() => {
    window.__partner = false;
    new MutationObserver(() => {
      if ([...document.querySelectorAll(".unit-wrap")].some(w => /柯尔特/.test(w.textContent))) window.__partner = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  const idx = await page.evaluate(() => GAME.gameSkills(unitById(GAME.actorId)).findIndex(s => s.id === "solo_support"));
  assert.ok(idx >= 0, "主角有支援技能");
  await page.keyboard.press(String(idx + 1));
  await page.waitForSelector("#g-choice.show");
  assert.match(await page.textContent("#g-choice"), /柯尔特/);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer).id);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => GAME.depth === 0 && state.solo.used.length === 1)) break;
    if (await page.evaluate(() => !!document.querySelector("#g-choice.show"))) await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  assert.deepEqual(await page.evaluate(() => state.solo.used), ["kolt"]);
  assert.equal(await apOf(page, hero), 1);
  assert.ok(await page.evaluate(() => window.__partner), "伙伴应该短暂登场");
  assert.equal(await page.evaluate(() => state.units.some(u => u.isPartner)), false, "打完退场");
  assert.match(await page.textContent("#g-rank"), /支援 ×0/);
  assert.deepEqual(o.errors, []);
});

test("格挡成功：敌方队长·牛格挡住攻击时，响起钢铁碰撞声", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.evaluate(() => { GAME.enemyPlan = [{ id: "captain_ox", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }]; GAME.lastEncounter = null; });
  await startBattle(page);
  await page.evaluate(() => {
    window.__parry = 0;
    const orig = Sfx.parry;
    Sfx.parry = () => { window.__parry++; return orig(); };
    Math.random = () => 0;   // d100 掷出 1：格挡必定成功
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const thug = await page.evaluate(() => state.units.find(u => u.kit === "thug_knife").id);
  await page.click(`.unit-wrap[data-id="${thug}"]`);
  await page.waitForFunction(() => window.__parry > 0 && GAME.depth === 0, null, { timeout: 15000 });
  assert.deepEqual(o.errors, []);
});

test("打出失衡：敌人架势被打空时，响起沉重的失衡声", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => {
    Math.random = () => 0.999;   // 不让格挡干扰
    state.units.filter(u => !u.isPlayer).forEach(u => { u.def = 1; });   // 开战会回满架势，所以开战后再改
    window.__stagger = 0;
    const orig = Sfx.stagger;
    Sfx.stagger = () => { window.__stagger++; return orig(); };
  });
  await selectHero(page, "ruby");   // 普通攻击共 1 击破：架势 1 → 0
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  // 打出失衡后会弹出「协助攻击」的选择，所以这里不等演出结束，只等失衡声响起
  await page.waitForFunction(i => state.units.find(u => u.id === i).stunned && window.__stagger >= 1, foe, { timeout: 15000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__stagger), 1, "一次失衡只响一声");
  assert.deepEqual(o.errors, []);
});

test("打死敌人：血量显示成负数；小刀补死照常消失", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => {
    Math.random = () => 0.999;
    state.units.filter(u => !u.isPlayer).forEach(u => u.layers.forEach(l => { l.current = 1; }));
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForSelector(`.unit-wrap[data-id="${foe}"].overkill`, { timeout: 15000 });
  const hp = await page.textContent(`.unit-wrap[data-id="${foe}"] .hpn`);
  assert.match(hp, /^−\d+\//, "血量应该是负数：" + hp);
  assert.ok(!(await page.evaluate(i => document.querySelector(`.unit-wrap[data-id="${i}"]`).classList.contains("dead-slow"), foe)), "小刀补死照常消失");
  assert.deepEqual(o.errors, []);
});

test("一记重击打死：铭牌多停一会儿再慢慢消失", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => {
    Math.random = () => 0.999;
    state.units.filter(u => !u.isPlayer).forEach(u => u.layers.forEach(l => { l.max = 6; l.current = 5; }));
  });
  await selectHero(page, "ruby");   // 一击 6 伤害 ≥ 上限 6 的一半
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForSelector(`.unit-wrap[data-id="${foe}"].dead-slow`, { timeout: 15000 });
  // 普通击杀 3 秒后就没了；重击的 3.5 秒时铭牌还在
  await page.waitForTimeout(3500);
  assert.ok(await page.isVisible(`.unit-wrap[data-id="${foe}"]`) || await page.$(`.unit-wrap[data-id="${foe}"]`), "重击打死的铭牌应该还在");
  assert.deepEqual(o.errors, []);
});

test("高能自爆：震屏、大字、爆炸声、大号数字", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => {
    Math.random = () => 0.999;
    const f = state.units.find(u => !u.isPlayer);
    f.highEnergy = 999; f.statuses.high = true;
    window.__boom = 0;
    const orig = Sfx.boom;
    Sfx.boom = () => { window.__boom++; return orig(); };
    // 记下演出里出现过的大字和数字
    window.__seen = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.className) window.__seen.push(n.className + "|" + n.textContent); })))
      .observe(document.body, { childList: true, subtree: true });
  });
  await selectHero(page, "ruby");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => state.units.find(u => !u.isPlayer && u.highEnergy >= 999).id);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => window.__boom >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const seen = await page.evaluate(() => window.__seen);
  assert.ok(seen.some(x => /stamp boom\|高能自爆/.test(x)), "应该盖「高能自爆」大字");
  assert.ok(seen.some(x => /pop .*boom\|999!/.test(x)), "应该有大号的自爆数字");
  // 自爆是重击：铭牌显示负血量，慢慢消失
  await page.waitForSelector(`.unit-wrap[data-id="${foe}"].dead-slow`, { timeout: 5000 });
  assert.match(await page.textContent(`.unit-wrap[data-id="${foe}"] .hpn`), /^−\d+\//);
  assert.deepEqual(o.errors, []);
});

test("攻击效果打出大字：属性专属按属性上色，通用的灰色；多段攻击每个字只打一次", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  const ruby = await selectHero(page, "ruby");
  await page.evaluate((id) => {
    Math.random = () => 0.999;
    const r = state.units.find(u => u.id === id);
    r.resources.nextAtkFx = ["combust", "bolt"];
    r.resources.smashNext = true;
    r.resources.weakNext = true;
    window.__words = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList && n.classList.contains("fxword")) window.__words.push(n.className + "|" + n.textContent + "|" + getComputedStyle(n).color);
    }))).observe(document.body, { childList: true, subtree: true });
  }, ruby);
  await page.keyboard.press("1");   // 瑞比普通攻击：两段
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => window.__words.length >= 4, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const words = await page.evaluate(() => window.__words);
  const count = (name) => words.filter(w => w.split("|")[1] === name).length;
  for (const n of ["爆燃", "雷击", "猛击", "弱点特效"]) assert.equal(count(n), 1, n + " 应该正好打一次：" + words.join(" / "));
  assert.ok(words.some(w => /fx-fire\|爆燃/.test(w)));
  assert.ok(words.some(w => /fx-electric\|雷击/.test(w)));
  assert.ok(words.some(w => /fx-generic\|猛击\|rgb\(138, 143, 150\)/.test(w)), "通用效果应该是灰色");
  assert.deepEqual(o.errors, []);
});

/* ---------- 撤销 ---------- */
const attackFirstFoe = async (page) => {
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.click(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(() => GAME.depth === 0 && !document.querySelector(".choice.show, .g-choice.show"));
  return foe;
};

test("战斗撤销：撤回上一步，血量、行动点都回来；跑团模式能连撤好几步，连「开始战斗」也能撤", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => { Math.random = () => 0.999; });
  const ruby = await selectHero(page, "ruby");
  const hpOf = (id) => page.evaluate(i => totalHp(state.units.find(u => u.id === i)), id);
  const before = { ap: await apOf(page, ruby) };
  const foe = await attackFirstFoe(page);
  const hitHp = await hpOf(foe);
  assert.equal(await apOf(page, ruby), before.ap - 1);
  await page.click("#g-undo");
  assert.equal(await apOf(page, ruby), before.ap, "行动点应该回来");
  assert.ok(await hpOf(foe) > hitHp, "敌人血量应该回来");
  assert.match(await page.textContent("#g-logs"), /↶ 撤销：普通攻击/);
  // 再撤一步：回到开战前
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => state.combatStarted), false);
  assert.ok(await page.isDisabled("#g-undo"));
  assert.deepEqual(o.errors, []);
});

test("战斗撤销：打死敌人后马上撤销，敌人不会被延迟的清场计时器删掉", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => { Math.random = () => 0.999; state.units.filter(u => !u.isPlayer).forEach(u => u.layers.forEach(l => { l.current = 1; })); });
  await selectHero(page, "ruby");
  const foe = await attackFirstFoe(page);
  assert.ok(await page.evaluate(i => state.units.find(u => u.id === i).dead, foe));
  await page.click("#g-undo");
  await page.waitForTimeout(5200);   // 超过清场计时（3 秒，重击 4.9 秒）
  const back = await page.evaluate(i => { const u = state.units.find(x => x.id === i); return u ? { dead: !!u.dead, hp: totalHp(u) } : null; }, foe);
  assert.ok(back && !back.dead && back.hp > 0, "撤销后敌人应该还在：" + JSON.stringify(back));
  assert.ok(await page.$(`.unit-wrap[data-id="${foe}"]`), "铭牌也应该还在");
  assert.deepEqual(o.errors, []);
});

test("战斗撤销：不在跑团模式时只能撤一步", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => { Math.random = () => 0.999; TRPG.active = false; });
  const ruby = await selectHero(page, "ruby");
  await page.evaluate(i => { state.units.find(u => u.id === i).ap = 2; }, ruby);
  await attackFirstFoe(page);
  await attackFirstFoe(page);
  assert.equal(await apOf(page, ruby), 0);
  assert.equal(await page.evaluate(() => GAME.undo.length), 1);
  await page.click("#g-undo");
  assert.equal(await apOf(page, ruby), 1, "只撤回最后一次攻击");
  assert.ok(await page.isDisabled("#g-undo"));
  assert.deepEqual(o.errors, []);
});

test("探索环节撤销：买错东西可以撤回；打完仗回来不能撤到战斗之前", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.click('[data-tab="bag"]');
  await page.fill("#tr-kz", "5000"); await page.click("#tr-kz-add");
  await page.click('[data-tab="shop"]');
  await page.click('[data-buy="medkit"]');
  await page.click('[data-buy="medkit"]');
  const s = () => page.evaluate(() => ({ kz: state.kuizhi, med: bagCount("medkit"), log: document.querySelectorAll("#tr-log li").length }));
  assert.deepEqual(await s(), { kz: 3800, med: 2, log: 3 });
  await page.click("#tr-undo");
  assert.deepEqual(await s(), { kz: 4400, med: 1, log: 2 });
  await page.keyboard.press("Control+z");
  assert.deepEqual(await s(), { kz: 5000, med: 0, log: 1 });
  // 刷新后也是撤销后的样子
  await page.reload(); await page.click("#t-sandbox"); await page.click('[data-open="0"]');
  assert.deepEqual(await s(), { kz: 5000, med: 0, log: 1 });
  // 进战斗再回来：撤销清空
  await page.click('[data-tab="shop"]');
  await page.click('[data-buy="medkit"]');
  await page.click("#tr-fight");
  await page.click("#g-to-explore");
  assert.ok(await page.isDisabled("#tr-undo"));
  assert.deepEqual(o.errors, []);
});

test("Helumica 的预测：预测的伤害和格挡骰就是实际掷出来的", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.evaluate(() => { GAME.partyKits = ["kolt", "helu"]; GAME.enemyPlan = [{ id: "thug_hammer", lv: 1, zone: 1 }]; GAME.lastEncounter = null; });
  await page.click("#tr-fight");
  await page.evaluate(() => { state.units.forEach(u => { u.zone = 1; }); });
  await page.keyboard.press("Space");
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0)) break;
    const opt = page.locator("#g-choice.show .opts button"); if (await opt.count()) await opt.first().click().catch(() => {});
    await page.waitForTimeout(200);
  }
  const foe = await page.evaluate(() => { const f = state.units.find(u => !u.isPlayer); applyFocus(f, null, []); GAME.refresh(); return f.id; });
  const readPred = async () => { await page.hover(`[data-id="${foe}"]`); await page.waitForTimeout(300); return page.textContent("#g-pvbox"); };
  const pred = await readPred();
  const m = pred.match(/([^\s】]+) 预计受到 (\d+) 伤害.*?格挡骰 (\d+)/);
  assert.ok(m, "预测里应该有伤害和格挡骰：" + pred);
  const who = m[1].replace(/^.*?(柯尔特|Helumica)$/, "$1"), dmg = Number(m[2]), roll = Number(m[3]);
  const endTurn = async (choose) => {
    const hp0 = await page.evaluate(n => totalHp(partyHeroes().find(h => h.name === n)), who);
    await page.mouse.move(5, 5);
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    const yes = page.locator("#g-choice.show button", { hasText: "确定结束" });
    if (await yes.count()) await yes.click();
    let shown = null;
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => state.turnNo === 2 && state.combatPhase === "player" && GAME.depth === 0)) break;
      const chk = await page.evaluate(() => { const n = document.getElementById("g-check-num"); return document.querySelector("#g-check.show") && /ok|fail/.test(n.className) ? Number(n.textContent) : null; });
      if (chk != null) shown = chk;
      const opts = page.locator("#g-choice.show .opts button");
      if (await opts.count()) {
        const btn = choose === "none" ? opts.filter({ hasText: "不格挡" }) : opts.filter({ hasText: "格挡" }).filter({ hasNotText: "不格挡" });
        await (await btn.count() ? btn.first() : opts.last()).click().catch(() => {});
      }
      await page.waitForTimeout(150);
    }
    const hp1 = await page.evaluate(n => totalHp(partyHeroes().find(h => h.name === n)), who);
    return { lost: hp0 - hp1, shown };
  };
  const r1 = await endTurn("none");
  assert.equal(r1.lost, dmg, `预测 ${who} 受到 ${dmg}，实际 ${r1.lost}`);
  await page.click("#g-undo");
  assert.equal(await readPred(), pred, "撤销回来，预测不变");
  const r2 = await endTurn("block");
  assert.equal(r2.shown, roll, `预测格挡骰 ${roll}，实际 ${r2.shown}`);
  assert.deepEqual(o.errors, []);
});

test("战场数据：攻击后能在面板里看到伤害 / 击破，开着面板会随行动刷新，撤销一起回退", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  await page.evaluate(() => { Math.random = () => 0.999; });
  await page.click("#g-stats");
  assert.match(await page.textContent("#g-stats-body"), /瑞比/);
  await page.click("#g-stats-close");
  const ruby = await selectHero(page, "ruby");
  const foe = await attackFirstFoe(page);
  const row = await page.evaluate(i => GAME.statRows().find(r => r.id === i), ruby);
  assert.ok(row.dmg > 0 && row.brk > 0, "瑞比应该有伤害和击破：" + JSON.stringify(row));
  await page.click("#g-stats");
  const cells = await page.$$eval(".stats-table tbody tr", trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
  const rubyCells = cells.find(c => c[0].includes("瑞比"));
  assert.equal(Number(rubyCells[1]), row.dmg);
  assert.equal(Number(rubyCells[2]), row.brk);
  await page.click("#g-stats-close");
  await page.click("#g-undo");
  assert.equal((await page.evaluate(i => GAME.statRows().find(r => r.id === i), ruby)).dmg, 0, "撤销后数据回退");
  assert.ok(foe);
  assert.deepEqual(o.errors, []);
});

test("战斗评分：右上角显示评价并随得分变化；胜利时按评价加战斗经验（S ×2）", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    Math.random = () => 0.999;
    const foes = state.units.filter(u => !u.isPlayer);
    state.units = state.units.filter(u => u.isPlayer || u === foes[0]);
    foes[0].layers.forEach(l => { l.current = 1; });
  });
  assert.ok(await page.isVisible("#g-rank"));
  assert.equal((await page.textContent("#g-rank .rk-grade")).trim(), "D", "开战 0 分：C 线以下是 D");
  await page.evaluate(() => { state.battleScore.total += 100000; });   // 直接给到 S
  await selectHero(page, "ruby");
  await attackFirstFoe(page).catch(() => {});
  await page.waitForFunction(() => GAME.ended, null, { timeout: 15000 });
  assert.equal((await page.textContent("#g-rank .rk-grade")).trim(), "S");
  await page.waitForSelector("#g-result.show");
  assert.match(await page.textContent("#g-result .grade-badge"), /S/);
  assert.match(await page.textContent("#g-result p"), /战斗经验 ×2，每人额外 \+\d+/);
  const xp = await page.evaluate(() => partyHeroes().map(h => h.xp));
  // 狂徒 lv1 = 5 经验，4 人平分每人 2；S 再翻一倍 → 每人 4
  assert.deepEqual(xp, [4, 4, 4, 4]);
  await page.click("#g-explore-back");
  const last = await page.evaluate(() => [...document.querySelectorAll("#tr-log li")].pop().innerText);
  assert.match(last, /评价 S/);
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
  // 格挡成功的钢铁声：明亮、余音长
  const parry = await o.page.evaluate(async () => {
    const d = await Sfx.render("parry");
    let peak = 0, lastLoud = 0, zc = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); if (a > 0.01) lastLoud = i; if (i && (d[i - 1] < 0) !== (d[i] < 0)) zc++; }
    return { peak, ring: lastLoud / 44100, zcr: zc / (d.length / 44100) };
  });
  assert.ok(parry.peak > 0.05 && parry.peak < 1, "格挡声音量 " + parry.peak);
  assert.ok(parry.ring > 0.5, "钢铁声应该有余音：" + parry.ring);
  assert.ok(parry.zcr > 1500, "钢铁声应该明亮：" + parry.zcr);
  // 失衡声：比格挡沉得多、长得多
  const stag = await o.page.evaluate(async () => {
    const d = await Sfx.render("stagger");
    let peak = 0, lastLoud = 0, zc = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); if (a > 0.01) lastLoud = i; if (i && (d[i - 1] < 0) !== (d[i] < 0)) zc++; }
    // 钟声的尾音应该一路平滑变小；嗡嗡声会忽大忽小。数 0.3–1.5 秒里每 50 毫秒「比上一格响 5% 以上」的次数
    const w = 2205, rms = [];
    for (let s = Math.round(0.3 * 44100); s + w < Math.min(d.length, 1.5 * 44100); s += w) { let q = 0; for (let i = s; i < s + w; i++) q += d[i] * d[i]; rms.push(Math.sqrt(q / w)); }
    let swells = 0; for (let i = 1; i < rms.length; i++) if (rms[i] > rms[i - 1] * 1.05) swells++;
    return { peak, ring: lastLoud / 44100, zcr: zc / (d.length / 44100), swells };
  });
  assert.ok(stag.swells <= 1, "失衡声应该像敲钟一样平滑衰减，不该嗡嗡地晃：" + stag.swells);
  assert.ok(stag.peak > 0.05 && stag.peak < 1, "失衡声音量 " + stag.peak);
  assert.ok(stag.ring > parry.ring * 1.8, "失衡声应该比格挡悠长：" + stag.ring + " vs " + parry.ring);
  assert.ok(stag.zcr < parry.zcr / 4, "失衡声应该比格挡低沉：" + stag.zcr + " vs " + parry.zcr);
  const boom = await o.page.evaluate(async () => {
    const d = await Sfx.render("boom");
    let peak = 0, bad = false;
    for (let i = 0; i < d.length; i++) { if (!isFinite(d[i])) bad = true; peak = Math.max(peak, Math.abs(d[i])); }
    return { peak, bad };
  });
  assert.ok(!boom.bad && boom.peak > 0.05 && boom.peak < 1, "爆炸声音量 " + boom.peak);
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
