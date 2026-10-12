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

test("战斗：和敌方炮台同区时有「改写」按钮，点了花 1 行动点做检定", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page, () => {
    const ruby = state.units.find(u => u.kit === "ruby");
    const p = makeProp("turret", ruby.zone, 1);
    p.faction = "enemy";
    state.props.push(p);
  });
  const ruby = await selectHero(page, "ruby");
  const ap0 = await apOf(page, ruby);
  const btn = page.locator("#g-skills button.sk", { hasText: "改写" });
  assert.equal(await btn.count(), 1);
  await btn.click();
  await page.waitForFunction(([i, a]) => state.units.find(u => u.id === i).ap < a && GAME.depth === 0, [ruby, ap0]);
  assert.match(await page.evaluate(() => state.logPages.map(p => p.lines.map(l => l.text || l).join("\n")).join("\n")), /困难「数据操作」检定/);
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

test("单局：刷新后继续保留种子、队伍和任务进度", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-new");
  await page.click('.hero-pick[data-kit="ruby"]');
  await page.click('.hero-pick[data-kit="yuito"]');
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  await page.click('.r-go[data-which="main"]');
  const progress = () => {
    const r = SaveStore.loadRun();
    return { seed: r.seed, party: r.party, stage: r.stage, act: r.act, day: r.day, task: r.task, world: r.world };
  };
  const before = await page.evaluate(progress);
  await page.reload();
  await page.click("#t-continue");
  await page.waitForSelector("#scr-run:not([hidden])");
  assert.deepEqual(await page.evaluate(progress), before);
  assert.deepEqual(o.errors, []);
});

test("单局：路线图——四个区域各有底图；走到岔路时点地图上发光的节点选下一站；走过的节点打勾", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-new");
  await page.waitForSelector("#scr-party:not([hidden])");
  await page.click('.hero-pick[data-kit="ruby"]');
  await page.click('.hero-pick[data-kit="yuito"]');
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
  await page.click('.r-go[data-which="main"]');
  await page.waitForSelector(".route-map");
  // 造一张确定的图，停在第二列的岔路上
  await page.evaluate(() => {
    const r = SaveStore.loadRun();
    r.task.cols = [["battle"], ["shop", "battle", "check"], ["smith", "battle"], ["rest"], ["elite"]];
    r.task.nodes = [{ type: "battle", done: true }, null, null, { type: "rest", done: false }, { type: "elite", done: false }];
    r.task.pick = [0, null, null, 0, 0];
    r.task.index = 1;
    SaveStore.saveRun(r);
    RunFlow.resume();
  });
  await page.waitForSelector(".rm-node.pickable", { state: "attached" });
  assert.equal(await page.locator(".rm-node.pickable").count(), 3);
  assert.equal(await page.locator(".rm-node.done .rm-check").count(), 1, "第一站打了勾");
  assert.equal(await page.locator(".rm-edge.next").count(), 3, "三条能走的路在流动");
  assert.equal(await page.evaluate(() => document.querySelector("#rm-defs").namespaceURI), "http://www.w3.org/2000/svg");
  await page.click('.rm-node.pickable[data-route="2"] .rm-hit');
  await page.waitForFunction(() => SaveStore.loadRun().task.pick[1] === 2);
  assert.match(await page.textContent("#run-body"), /检定/);
  assert.equal(await page.locator(".rm-edge.done").count(), 1, "走过的路线变金色");
  // 四个区域的底图都画得出来
  for (const region of ["外城区", "沙漠", "巨人城", "天网设施"]) {
    const ok = await page.evaluate((rg) => /<svg class="rm-svg"/.test(RouteMap.html({ region: rg, cols: [["battle"], ["rest"]], nodes: [null, null], pick: [], index: 0, choices: [0] })), region);
    assert.ok(ok, region);
  }
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
  // 和协助格挡一样的检定动画：d100 滚动后停在掷出的点数，写明成功线
  await page.waitForSelector("#g-check.show", { timeout: 5000 });
  assert.match(await page.textContent("#g-check-who"), /瑞比 · 困难「数据操作」检定/);
  assert.match(await page.textContent("#g-check-rate"), /需要 ≤ 50/);
  await page.waitForFunction(() => /检定(成功|失败)/.test(document.querySelector("#g-check-hint").textContent), null, { timeout: 10000 });
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
  // 数字键对应技能栏里显示的顺序（武器生物化单独放在结束回合左边的按钮里，不占数字键）
  const idx = await page.evaluate(() => (GAME.skillsShown || []).findIndex(s => s.id === "solo_support"));
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
  const left = await page.evaluate(() => soloSupportInfo().left);
  assert.match(await page.textContent("#g-rank"), new RegExp(`支援 ×${left}`));
  assert.deepEqual(o.errors, []);
});

test("单人模式：主角倒地不判负，下个玩家回合可以用坚毅生命起身", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-solo");
  await page.waitForSelector("#scr-party:not([hidden])");
  await page.click('.hero-pick[data-kit="ruby"]');
  for (const k of ["kolt", "yuito", "tou"]) await page.click(`.hero-pick[data-kit="${k}"]`);
  await page.click('[data-role2="生存"]');
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
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
  const hero = await page.evaluate(() => {
    const h = state.units.find(u => u.kit === "ruby");
    h.layers.forEach(l => { l.current = 0; });
    h.dying = true;
    return h.id;
  });
  await page.click("#g-endturn");
  await page.waitForFunction(() => state.combatPhase === "player" && state.turnNo >= 2 && GAME.depth === 0 || GAME.ended, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => GAME.ended), false, "倒地没有判负");
  await page.click(`.unit-wrap[data-id="${hero}"]`);
  const btn = page.locator("#g-skills button.sk", { hasText: "起身" });
  assert.equal(await btn.count(), 1);
  await btn.click();
  await page.waitForFunction(i => state.units.find(u => u.id === i).upOnShp, hero, { timeout: 10000 });
  assert.deepEqual(o.errors, []);
});

test("手机竖屏：战斗不横向溢出；点目标先预览、再点才出手；战斗记录在抽屉里", async (t) => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  await page.goto(GAME_URL);
  assert.match(await page.textContent(".t-name"), /Antlerscale\s*Backfire/);
  await page.click("#t-new");
  await page.waitForSelector("#scr-party:not([hidden])");
  for (const k of ["ruby", "yuito"]) await page.click(`.hero-pick[data-kit="${k}"]`);
  await page.click("#party-go");
  await page.waitForSelector("#scr-run:not([hidden])");
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, "横向溢出 " + overflow);
  // 瑞比的普通攻击打距离 1：把敌人挪到隔壁区
  const ruby = await page.evaluate(() => {
    const h = state.units.find(u => u.kit === "ruby");
    state.units.filter(u => !u.isPlayer).forEach(u => { u.zone = h.zone > 1 ? h.zone - 1 : 2; });
    GAME.refresh();
    return h.id;
  });
  await page.locator("#g-party .pc", { hasText: "瑞比" }).first().tap();
  await page.waitForFunction(i => GAME.actorId === i, ruby);
  const ap0 = await apOf(page, ruby);
  await page.tap("#g-skills button.sk:first-child");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const foe = await page.evaluate(() => [...GAME.arm.map.entries()].find(([id, c]) => !c.invalid && !String(id).includes(":"))[0]);
  await page.tap(`.unit-wrap[data-id="${foe}"]`);
  assert.equal(await apOf(page, ruby), ap0, "第一下只是预览");
  assert.equal(await page.evaluate(() => document.querySelector("#g-pvbox").classList.contains("live")), true, "预览浮出来");
  await page.tap(`.unit-wrap[data-id="${foe}"]`);
  await page.waitForFunction(([i, a]) => state.units.find(u => u.id === i).ap < a && GAME.depth === 0, [ruby, ap0], { timeout: 15000 });
  // 战斗记录：顶栏按钮打开抽屉，「收起」关上
  await page.tap("#g-log-open");
  await page.waitForFunction(() => document.querySelector("#g-app").classList.contains("log-open"));
  await page.tap("#g-log-close");
  await page.waitForFunction(() => !document.querySelector("#g-app").classList.contains("log-open"));
  assert.deepEqual(errors, []);
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
  // 自爆在整次攻击打完后才判：这次攻击的能量伤害还会继续累积高能，数字 ≥ 999
  assert.ok(seen.some(x => { const m = /pop .*boom\|(\d+)!/.exec(x); return m && Number(m[1]) >= 999; }), "应该有大号的自爆数字：" + seen.filter(x => /boom/.test(x)).join(" / "));
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
  const heads = await page.$$eval(".stats-table thead th", ths => ths.map(th => th.textContent.trim()));
  const rubyCells = cells.find(c => c[0].includes("瑞比"));
  assert.equal(Number(rubyCells[heads.indexOf("造成伤害")]), row.dmg);
  assert.equal(Number(rubyCells[heads.indexOf("击破")]), row.brk);
  assert.match(rubyCells[heads.indexOf("输出占比")], /%$/);
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
  await page.evaluate(() => { state.battleScore.total += 100000; });   // 直接给到最高评价 SSS（经验倍率和 S 一样 ×2）
  await selectHero(page, "ruby");
  await attackFirstFoe(page).catch(() => {});
  await page.waitForFunction(() => GAME.ended, null, { timeout: 15000 });
  assert.equal((await page.textContent("#g-rank .rk-grade")).trim(), "SSS");
  await page.waitForSelector("#g-result.show");
  assert.match(await page.textContent("#g-result .grade-badge"), /S/);
  assert.match(await page.textContent("#g-result p"), /战斗经验 ×2，每人额外 \+\d+/);
  const xp = await page.evaluate(() => partyHeroes().map(h => h.xp));
  // 狂徒 lv1 = 5 经验，4 人平分每人 2；S 再翻一倍 → 每人 4；跑团战斗奖励：队伍最高 1 级 × 20 ÷ 4 人 = 5 → 每人 9
  assert.deepEqual(xp, [9, 9, 9, 9]);
  await page.click("#g-explore-back");
  const last = await page.evaluate(() => [...document.querySelectorAll("#tr-log li")].pop().innerText);
  assert.match(last, /评价 S/);
  assert.deepEqual(o.errors, []);
});

test("奖励结算：真实 UI 评级触发 3→4 级，继续后与无界面的经验和待选升级一致", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  const initial = await page.evaluate(() => {
    const run = Rogue.newRun({ party: ["ruby", "yuito"], seed: "R1-UI-REWARDS" });
    run.stage = "boss";
    run.party.forEach(h => { h.level = 3; h.xp = xpToNext(3) - 1; h.pending = []; });
    Rogue.save(run);
    return run;
  });
  // 两条路径共用同一份战前档案和最后一击后的状态：基础经验已计入，
  // 每人离 4 级仍差 1 点；只有 S 评价补发的 11 点经验才能触发升级。
  const finalBattleState = () => {
    state.turnNo = 4;
    state.battleScore.total = battleGrade().lines.find(x => x[0] === "S")[1];   // 这场的 S 线（固定线 × 0.65 + 基准分 × 倍数 × 0.35）
    state.battleScore.hurt = true;
    state.battleGains.xp = 11;
    state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
    return partyHeroes().map(h => ({ level: h.level, xp: h.xp, need: xpToNext(h.level) }));
  };
  const result = run => {
    const first = state.battleScore.rewardSettlement;
    return JSON.parse(JSON.stringify({
      grade: first.grade.grade, score: first.grade.score, xpBonus: first.xpBonus,
      gains: state.battleGains.xp, stage: run.stage,
      party: run.party.map(h => ({ kit: h.kit, level: h.level, xp: h.xp, hp: h.hp, shp: h.shp, pending: h.pending }))
    }));
  };
  const ctx = require("./headless").load();
  const expected = require("node:vm").runInContext(`(() => {
    const run = ${JSON.stringify(initial)};
    Rogue.enterRunMode(run);
    BattleSim.setup(Rogue.battleSpec(run));
    (${finalBattleState.toString()})();
    settleBattleRewards("win");
    Rogue.finishBattle(run, "win");
    return (${result.toString()})(run);
  })()`, ctx);

  await page.evaluate(() => RunFlow.resume());
  await page.click("#r-fight"); // RogueUI.fight → GAME.startRogueBattle，绑定真实返回回调。
  await page.waitForSelector("#g-app:not([hidden])");
  const before = await page.evaluate(finalBattleState);
  assert.ok(before.every(h => h.level === 3 && h.xp === h.need - 1));
  await page.evaluate(() => { GAME.instant = true; GAME.checkEnd(); }); // 实际 game.js::finish。
  await page.waitForSelector("#g-result.show");
  assert.match(await page.textContent("#g-result .grade-badge"), /S/);
  assert.match(await page.textContent("#g-result p"), /每人额外 \+11/);
  assert.match(await page.textContent("#g-result p"), /3→4/);
  const settled = await page.evaluate(() => {
    const snapshot = () => partyHeroes().map(h => ({ level: h.level, xp: h.xp }));
    const before = snapshot(), duplicate = settleBattleRewards("win"), after = snapshot();
    return { before, after, xpBonus: duplicate.xpBonus, alreadySettled: duplicate.alreadySettled };
  });
  assert.ok(settled.before.every(h => h.level === 4 && h.xp === 10));
  assert.deepEqual(settled.after, settled.before);
  assert.equal(settled.xpBonus, 0);
  assert.equal(settled.alreadySettled, true);
  await page.click("#g-rogue-next"); // onEnd → Rogue.finishBattle → 保存并显示待选升级。
  await page.waitForSelector("#scr-run:not([hidden]) .levelup");
  const saved = await page.evaluate(() => SaveStore.loadRun());
  const actual = await page.evaluate(result, saved);
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)));
  assert.equal(actual.grade, "S");
  assert.equal(actual.xpBonus, 11);
  assert.equal(actual.gains, 22);
  assert.equal(actual.stage, "interlude");
  assert.ok(actual.party.every(h => h.level === 4 && h.xp === 10));
  assert.ok(actual.party.every(h => h.pending.length === 1 && h.pending[0].type === "attr" && h.pending[0].level === 4));
  assert.match(await page.textContent("#run-body .levelup"), /4 级/);
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

test("录音音效：每个录音都能解码、有声、有调音参数；没选录音的类别不出声，电 / 格挡 / 失衡 / 爆炸保留合成音效", async (t) => {
  const o = await open(t); if (!o) return;
  const r = await o.page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 1, 22050);
    const out = {};
    for (const k of Object.keys(SFX_SAMPLES)) {
      const b64 = SFX_SAMPLES[k].split(",")[1];
      const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      try {
        const buf = await ctx.decodeAudioData(u.buffer);
        const d = buf.getChannelData(0); let peak = 0;
        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        out[k] = { peak, dur: buf.duration, tune: !!Sfx.TUNE[k], label: !!Sfx.UI_LABEL[k] };
      } catch (e) { out[k] = { error: String(e) }; }
    }
    // 克制 / 劣势：录音和合成音效都能走效果链（混响 / 低通）而不出错
    const tones = [["ice", { adv: true }], ["fire", { dis: true }], ["electric", { adv: true }], ["stagger", { dis: true }]].map(([e, o]) => Sfx.play(e, o));
    out.__tone = { tones, adv: Sfx.TONE.adv, dis: Sfx.TONE.dis };
    return { out, has: ["physical", "fire", "ice", "acid", "energy", "harmonic", "electric", "parry", "stagger", "boom"].map(k => Sfx.hasSample(k)),
      uiCoin: Sfx.ui("coin"), uiNone: Sfx.ui("victory") };
  });
  const tone = r.out.__tone; delete r.out.__tone;
  assert.deepEqual(tone.tones, [true, true, true, true], "克制 / 劣势音效都能播");
  assert.ok(tone.adv.vol > 1 && tone.adv.rate > 1 && tone.adv.wet > 0, "克制：更响、更高、有混响");
  assert.ok(tone.dis.vol < 1 && tone.dis.rate < 1 && tone.dis.lowpass > 0, "劣势：更轻、更低、发闷");
  const keys = Object.keys(r.out);
  assert.equal(keys.length, 25);
  for (const k of keys) {
    assert.ok(!r.out[k].error, k + " 解码失败：" + r.out[k].error);
    assert.ok(r.out[k].peak > 0.02, k + " 几乎没声音");
    assert.ok(r.out[k].dur > 0.03 && r.out[k].dur < 3, k + " 时长 " + r.out[k].dur);
    assert.ok(r.out[k].tune && r.out[k].label, k + " 缺调音参数或名字");
  }
  assert.deepEqual(r.has, [true, true, true, true, true, true, false, false, false, false]);
  assert.equal(r.uiCoin, true);
  assert.equal(r.uiNone, false, "没选录音的类别（战斗胜利）不出声");
  assert.deepEqual(o.errors, []);
});

test("战斗模板：探索环节新建模板 → 用它开战，进战斗时战场已经摆好；战斗画面也能把当前战场存成模板", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.click('[data-tab="battles"]');
  await page.click('[data-bt="new:"]');
  await page.selectOption('[data-bte="board"]', "3");
  await page.fill('[data-bte="name"]', "桥头伏击");
  await page.selectOption('[data-bte="weather"]', "snow");
  await page.selectOption('[data-bte="enemies.0.zone"]', "3");
  await page.fill('[data-bte="enemies.0.level"]', "3");
  await page.click('[data-bt-act="addEnemy"]');
  await page.selectOption('[data-bte="enemies.1.preset"]', "thug_hammer");
  await page.selectOption('[data-bt-field="2"]', "acid");
  await page.selectOption('[data-bt-gap="2-3"]', "wall");
  await page.fill('[data-bt-gaphp="2-3"]', "30");
  await page.click('[data-bt-act="addProp"]');
  await page.click('[data-bt-act="save"]');
  const card = await page.textContent("#tr-panel");
  assert.match(card, /桥头伏击/);
  assert.match(card, /三区 · 雪天 · 狂徒（匕首） Lv3（3 区）、狂徒（锤） Lv随队（3 区）/);
  await page.click('[data-bt^="fight:"]');
  await page.waitForSelector("#g-start");
  const r = await page.evaluate(() => ({
    started: state.combatStarted, zoneMode: state.zoneMode, weather: state.weather,
    foes: state.units.filter(u => !u.isPlayer).map(u => [u.kit, u.level, u.zone]),
    acid: state.fields[2].acid, wall: [state.gaps["2-3"].type, state.gaps["2-3"].hp],
    props: state.props.map(p => [p.kind, p.zone]), title: document.getElementById("g-enc-name").textContent
  }));
  assert.equal(r.started, false);
  assert.equal(r.zoneMode, 3);
  assert.equal(r.weather, "snow");
  assert.deepEqual(r.foes, [["thug_knife", 3, 3], ["thug_hammer", 1, 3]]);
  assert.equal(r.acid, true);
  assert.deepEqual(r.wall, ["wall", 30]);
  assert.deepEqual(r.props, [["boom", 2]]);
  assert.match(r.title, /桥头伏击 · 主持人预设/);
  // 战斗画面：把当前战场存为模板，再套用
  await page.evaluate(() => { document.getElementById("g-intro")?.remove(); });
  await page.click("#g-field-cfg");
  await page.fill("#g-tpl-name", "桥头伏击 2");
  await page.click("#g-tpl-save");
  const names = await page.$$eval("#g-tpl-list .sheet-slot b", els => els.map(e => e.textContent));
  assert.deepEqual(names, ["桥头伏击", "桥头伏击 2"]);
  assert.equal(await page.evaluate(() => battleTemplateList()[1].enemies.length), 2);
  assert.deepEqual(o.errors, []);
});

test("战斗画面：状态画成图标，技能栏左边有角色仪表，状态生效时图标放大发光", async (t) => {
  const o = await open(t); if (!o) return;
  const { page, errors } = o;
  await newTrpg(page);
  await startBattle(page);
  const foe = await page.evaluate(() => {
    const f = state.units.find(u => !u.isPlayer && !u.dead);
    f.statuses.burn = 2; f.statuses.weak = true;
    GAME.refresh();
    return f.id;
  });
  await page.waitForSelector(`.unit-wrap[data-id="${foe}"] .hi-badge[data-fx="burn"]`);
  assert.equal(await page.textContent(`.unit-wrap[data-id="${foe}"] .hi-badge[data-fx="burn"] .hi-stack`), "2");
  // 有图标的状态不再重复写字
  assert.equal(await page.evaluate(i => [...document.querySelectorAll(`.unit-wrap[data-id="${i}"] .u-status .chip`)].filter(c => /灼烧|虚弱/.test(c.textContent)).length, foe), 0);
  // 层数变了：图标生效一下
  await page.evaluate(i => { state.units.find(u => u.id === i).statuses.burn = 3; GAME.refresh(); }, foe);
  await page.waitForSelector(`.unit-wrap[data-id="${foe}"] .hi-badge.hi-proc[data-fx="burn"]`);
  // 角色仪表跟着当前角色
  await selectHero(page, "tou");
  assert.match(await page.textContent("#g-gauge"), /圣盾/);
  await selectHero(page, "ruby");
  assert.match(await page.textContent("#g-gauge"), /纳米/);
  // 回合结束灼烧结算：单位卡上的灼烧图标生效
  await page.evaluate(() => { window.__procSeen = []; const o = HudIcons.procIn; HudIcons.procIn = (box, k) => { window.__procSeen.push(k); return o(box, k); }; });
  await page.mouse.move(5, 5);
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const yes = page.locator("#g-choice.show button", { hasText: "确定结束" });
  if (await yes.count()) await yes.click();
  // 敌人回合里可能要选格挡：一律选第一个选项，直到看到灼烧图标生效
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__procSeen.includes("burn"))) break;
    const opts = page.locator("#g-choice.show .opts button");
    if (await opts.count()) await opts.first().click().catch(() => {});
    await page.waitForTimeout(250);
  }
  assert.ok(await page.evaluate(() => window.__procSeen.includes("burn")), "灼烧结算时图标没有生效");
  assert.deepEqual(errors, []);
});

test("悬停单位：浮窗里有图鉴描述和身上效果的文字", async (t) => {
  const o = await open(t); if (!o) return;
  const { page, errors } = o;
  await newTrpg(page);
  await startBattle(page);
  const ids = await page.evaluate(() => {
    const f = state.units.find(u => !u.isPlayer && !u.dead);
    f.statuses.burn = 2; f.statuses.weak = true;
    const p = makeProp("boom", f.zone, 1); state.props.push(p);
    GAME.refresh();
    return { foe: f.id, prop: "prop:" + p.id };
  });
  await page.hover(`.unit-wrap[data-id="${ids.foe}"]`);
  await page.waitForSelector(".unit-tip.show");
  const txt = await page.textContent(".unit-tip");
  assert.match(txt, /行动方式/);
  assert.match(txt, /灼烧×2/);
  assert.match(txt, /每回合结束时/);
  assert.match(txt, /虚弱.*atk −25%/);
  await page.mouse.move(5, 5);
  await page.waitForSelector(".unit-tip:not(.show)", { state: "attached" });
  await page.hover(`.unit-wrap[data-id="${ids.prop}"]`);
  await page.waitForSelector(".unit-tip.show");
  assert.match(await page.textContent(".unit-tip"), /爆炸桶[\s\S]*耐久/);
  assert.deepEqual(errors, []);
});

test("战斗：Esc 关掉队伍配置 / 战场配置 / 背包 / 后台等面板；计算器旧弹窗不漏到页面上", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  const legacy = await page.evaluate(() => ({
    assist: document.querySelectorAll("[id=assistModal]").length,
    loose: [...document.querySelectorAll(".modal")].filter(m => !m.closest("#calc-core")).map(m => m.id)
  }));
  assert.deepEqual(legacy, { assist: 1, loose: [] });
  await newTrpg(page);
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  for (const [btn, sheet] of [["#g-party-cfg", "#g-party-sheet"], ["#g-field-cfg", "#g-field-sheet"], ["#g-bag", "#g-bag-sheet"], ["#g-bs", "#g-bs-sheet"]]) {
    await page.click(btn);
    await page.waitForSelector(sheet + ".show");
    await page.keyboard.press("Escape");
    await page.waitForSelector(sheet + ":not(.show)", { state: "attached" });
  }
  assert.equal(await page.evaluate(() => GAME.bsOpen), false);
  assert.deepEqual(o.errors, []);
});

/* ---------- 悬停技能就预演 ---------- */
/** 开战时有选择（柯尔特的初始刀头）就选第一项 */
async function startBattleAnswering(page, prep) {
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  if (prep) await page.evaluate(prep);
  await page.keyboard.press("Space");
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0)) return;
    const opt = page.locator("#g-choice.show .opts button");
    if (await opt.count()) await opt.first().click().catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error("战斗没有开始");
}
/** 悬停前后要一模一样的东西：各单位的血量 / 行动点 / 资源 / 状态、记录条数、随机数位置、指令日志、G.lastCmd、队伍档案 */
const pvFingerprint = () => JSON.stringify({
  draws: RNG.draws(), rng: Math.random === RNG.fn,
  units: state.units.map(u => [u.id, u.ap, u.bonus, u.zone, u.def, (u.layers || []).map(l => l.current), JSON.stringify(u.resources || {}), JSON.stringify(u.statuses || {})]),
  logs: state.logPages.reduce((n, p) => n + p.lines.length, 0), pages: state.logPages.length,
  history: Commands.history().length, lastCmd: JSON.stringify(GAME.lastCmd || null), ledger: JSON.stringify(LEDGER.save())
});
const pvTitle = (page) => page.evaluate(() => document.querySelector("#g-pvbox h4").textContent);

test("悬停技能就预演：不用选目标的技能（拉响引擎）——写消耗和资源变化、卡上出数值牌，不扣点不放出去，局面 / 随机数 / 指令日志都不变；重复悬停用缓存；移开回到默认说明", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.evaluate(() => { GAME.partyKits = ["xia", "ruby"]; GAME.lastEncounter = null; });
  await startBattle(page);
  const xia = await selectHero(page, "xia");
  const ap0 = await apOf(page, xia);
  await page.evaluate(() => {
    RNG.install("PV-HOVER");   // 装上种子随机数：悬停前后随机流的位置不能动
    window.__units = state.units;
    window.__sandboxes = 0;    // 每算一次预演开一次用完就扔的局面：数一数，看重复悬停有没有用缓存
    const inspect = HotseatValidation.inspect;
    HotseatValidation.inspect = (fn) => { window.__sandboxes++; return inspect(fn); };
  });
  const before = await page.evaluate(pvFingerprint);
  const btn = page.locator("#g-skills button.sk", { hasText: "拉响引擎" });
  await btn.hover();
  await page.waitForFunction(() => /拉响引擎 · 预演/.test(document.querySelector("#g-pvbox h4").textContent));
  const box = await page.textContent("#g-pvbox");
  assert.match(box, /消耗 行动点 1（现有 1）/, "最上面一行写消耗");
  assert.match(box, /夕夏 资源：引擎关闭 → 引擎启动/, "预览框写资源变化");
  assert.match(box, /骰子按最小 \/ 最大各预演一次/);
  assert.match(await page.textContent(`.unit-wrap[data-id="${xia}"] .pvtag.show`), /资源：引擎关闭 → 引擎启动/, "夕夏卡上出数值牌");
  assert.equal(await apOf(page, xia), ap0, "悬停不扣行动点");
  assert.equal(await page.evaluate(i => !!state.units.find(u => u.id === i).resources.engine, xia), false, "技能没放出去");
  assert.equal(await page.evaluate(() => GAME.arm), null, "也没进入选目标");
  assert.equal(await page.evaluate(pvFingerprint), before, "悬停前后局面、随机数、指令日志、G.lastCmd 都不变");
  assert.ok(await page.evaluate(() => state.units === window.__units), "state 里的对象引用也原样还回来");
  assert.equal(await page.evaluate(() => window.__sandboxes), 1);
  // 移开：数值牌收起，预览框回到默认说明
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !/预演/.test(document.querySelector("#g-pvbox h4").textContent));
  assert.equal(await page.locator(".pvtag.show").count(), 0);
  assert.match(await page.textContent("#g-pvbox"), /鼠标停在技能上先看预演/);
  // 同一个局面再悬停：用缓存，不重新跑沙盒
  await btn.hover();
  await page.waitForFunction(() => /拉响引擎 · 预演/.test(document.querySelector("#g-pvbox h4").textContent));
  assert.equal(await page.evaluate(() => window.__sandboxes), 1, "重复悬停用缓存");
  // 扫过按钮马上离开（不到 120 毫秒）不算
  await page.mouse.move(5, 5);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#g-skills button.sk")].find(x => /准备/.test(x.textContent));
    b.dispatchEvent(new MouseEvent("mouseenter"));
    b.dispatchEvent(new MouseEvent("mouseleave"));
  });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__sandboxes), 1, "扫过不预演");
  assert.ok(!/预演/.test(await pvTitle(page)));
  assert.equal(await page.evaluate(pvFingerprint), before);
  // 点下去照常直接放出去（只是先看了预演）
  await btn.click();
  await page.waitForFunction(i => state.units.find(u => u.id === i).resources.engine && GAME.depth === 0, xia);
  assert.equal(await apOf(page, xia), ap0 - 1);
  assert.deepEqual(o.errors, []);
});

test("悬停技能就预演：要选目标的技能（柯尔特普攻）只高亮能选的目标、不在卡上出伤害牌（不像范围技能）；有分步的（直流短接）只写说明；瞄准一个目标时才预览结算", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await page.evaluate(() => { GAME.partyKits = ["kolt", "yuito"]; GAME.lastEncounter = null; });
  await startBattleAnswering(page, () => {
    const k = state.units.find(u => u.kit === "kolt");
    state.units.filter(u => !u.isPlayer).forEach(u => { u.zone = k.zone; });   // 电钻打同区：敌人都放到柯尔特这一区
    state.units.find(u => u.kit === "yuito").zone = k.zone === 1 ? 2 : 1;      // 结人的普攻打距离 1
  });
  const kolt = await selectHero(page, "kolt");
  const ap0 = await apOf(page, kolt);
  const foes = await page.evaluate(() => state.units.filter(u => !u.isPlayer && !u.dead).map(u => u.id));
  const before = await page.evaluate(() => JSON.stringify(state.units.map(u => [u.id, u.ap, (u.layers || []).map(l => l.current), u.def])) + state.logPages.reduce((n, p) => n + p.lines.length, 0) + "|" + Commands.history().length);
  await page.locator("#g-skills button.sk", { hasText: "普通攻击" }).hover();
  await page.waitForFunction(() => /普通攻击 · 选目标/.test(document.querySelector("#g-pvbox h4").textContent));
  // 能选的目标高亮（和选目标时一样），卡上不出伤害牌
  const cand = await page.$$eval(".unit-wrap.pv-cand", ws => ws.map(w => w.dataset.id));
  assert.deepEqual(cand.slice().sort(), foes.slice().sort(), "能选的敌人都高亮");
  assert.equal(await page.locator(".pvtag.show").count(), 0, "悬停技能按钮时不在每张卡上画伤害");
  assert.match(await page.textContent("#g-pvbox"), /把鼠标移到目标上/);
  assert.equal(await apOf(page, kolt), ap0);
  assert.equal(await page.evaluate(() => GAME.arm), null, "没有进入选目标");
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector(".unit-wrap.pv-cand"));
  assert.ok(!/预演|选目标/.test(await pvTitle(page)), "移开回到默认说明");
  // 有分步选择的技能：只写消耗和先选什么，不预演
  await page.locator("#g-skills button.sk", { hasText: "直流短接" }).hover();
  await page.waitForFunction(() => /^直流短接/.test(document.querySelector("#g-pvbox h4").textContent));
  const flow = await page.textContent("#g-pvbox");
  assert.match(flow, /消耗 行动点 1/);
  assert.match(flow, /分步选择：先选「可先移动至多 1 区/);
  assert.ok(!/预演/.test(await pvTitle(page)));
  assert.equal(await page.locator(".pvtag.show").count(), 0, "分步技能不预演");
  await page.mouse.move(5, 5);
  assert.equal(await page.evaluate(() => JSON.stringify(state.units.map(u => [u.id, u.ap, (u.layers || []).map(l => l.current), u.def])) + state.logPages.reduce((n, p) => n + p.lines.length, 0) + "|" + Commands.history().length), before, "悬停不改变局面");
  // 选好技能后瞄准：出手的人的资源变化也写出来（结人普攻：咖啡豆变咖啡液）
  const yuito = await selectHero(page, "yuito");
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  await page.hover(`.unit-wrap[data-id="${foes[0]}"]`);
  await page.waitForSelector(`.unit-wrap[data-id="${yuito}"] .pvtag.show`);
  assert.match(await page.textContent(`.unit-wrap[data-id="${yuito}"] .pvtag.show`), /资源：咖啡豆 \d+ · 咖啡液 \d+ → 咖啡豆 \d+ · 咖啡液 \d+/);
  assert.match(await page.textContent("#g-pvbox"), /结人 资源：/);
  assert.equal(await page.locator(".pvtag.show.compact").count(), 0, "瞄准一个目标：牌子照旧是卡片上方的大牌子");
  await page.keyboard.press("Escape");
  assert.deepEqual(o.errors, []);
});

test("手机竖屏：不用选目标的技能（拉响引擎）第一下只预演不扣点，点别的地方取消，再点一下才放出去", async (t) => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("测试团") : d.accept()));
  await page.goto(GAME_URL);
  await newTrpg(page);
  await page.evaluate(() => { GAME.partyKits = ["xia", "ruby"]; GAME.lastEncounter = null; });
  await startBattle(page);
  const xia = await page.evaluate(() => state.units.find(u => u.kit === "xia").id);
  await page.locator("#g-party .pc", { hasText: "夕夏" }).first().tap();
  await page.waitForFunction(i => GAME.actorId === i, xia);
  const ap0 = await apOf(page, xia);
  const engineOn = () => page.evaluate(i => !!state.units.find(u => u.id === i).resources.engine, xia);
  const btn = page.locator("#g-skills button.sk", { hasText: "拉响引擎" });
  await btn.tap();
  await page.waitForFunction(() => /拉响引擎 · 预演/.test(document.querySelector("#g-pvbox h4").textContent));
  await page.waitForTimeout(300);   // 触屏模拟出来的鼠标进出事件之后预演还在
  assert.match(await pvTitle(page), /拉响引擎 · 预演/);
  assert.equal(await apOf(page, xia), ap0, "第一下只预演");
  assert.equal(await engineOn(), false);
  assert.equal(await page.evaluate(() => document.querySelector("#g-pvbox").classList.contains("live")), true, "预演浮在操作栏上面");
  assert.match(await page.textContent("#g-pvbox"), /资源：引擎关闭 → 引擎启动/);
  assert.match(await page.textContent("#g-hint"), /再点一下放出去/);
  // 点别的地方（战场空白处）：取消
  await page.tap('.g-zone[data-num="1"]', { position: { x: 6, y: 6 } });
  await page.waitForFunction(() => !GAME.skillTap && !/预演/.test(document.querySelector("#g-pvbox h4").textContent));
  assert.equal(await page.locator(".pvtag.show").count(), 0);
  // 取消后再点：又只是预演
  await btn.tap();
  await page.waitForFunction(() => /拉响引擎 · 预演/.test(document.querySelector("#g-pvbox h4").textContent));
  assert.equal(await apOf(page, xia), ap0, "取消之后第一下还是只预演");
  // 再点同一个按钮：放出去
  await btn.tap();
  await page.waitForFunction(i => state.units.find(u => u.id === i).resources.engine && GAME.depth === 0, xia, { timeout: 15000 });
  assert.equal(await apOf(page, xia), ap0 - 1, "第二下才放出去");
  assert.deepEqual(errors, []);
});

test("战场数据 / 整局数据：「合并武器人」把角色和自己的武器人并成一行看", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await newTrpg(page);
  await startBattle(page);
  const rows = [
    { id: "a", name: "龙哥", sub: false, dmg: 30, brk: 2, kills: 1, blocks: 1, blockOk: 1, taken: 5, heal: 0, score: 10 },
    { id: "w", name: "小朋友", sub: true, dmg: 10, brk: 3, kills: 0, blocks: 2, blockOk: 1, taken: 4, heal: 6, score: 4 },
    { id: "b", name: "柯尔特", sub: false, dmg: 60, brk: 1, kills: 2, blocks: 0, blockOk: 0, taken: 9, heal: 0, score: 20 }];
  const m = await page.evaluate(r => GAME.mergeStatRows(r), rows);
  assert.equal(m.length, 2);
  assert.equal(m[0].name, "龙哥＋小朋友");
  assert.deepEqual([m[0].dmg, m[0].brk, m[0].blocks, m[0].blockOk, m[0].taken, m[0].heal, m[0].score], [40, 5, 3, 2, 9, 6, 14]);
  assert.equal(m[0].share, 40);
  assert.equal(m[1].share, 60);
  const c = await page.evaluate(r => CareerLog.mergeRows(r.map(x => Object.assign({ battles: 3 }, x))), rows);
  assert.equal(c[0].name, "龙哥＋小朋友");
  assert.equal(c[0].battles, 3, "出场按主人算");
  assert.equal(Math.round(c[0].takenShare), 50);
  await page.click("#g-stats");
  assert.equal((await page.textContent("#g-stats-merge")).trim(), "合并武器人");
  await page.click("#g-stats-merge");
  assert.equal((await page.textContent("#g-stats-merge")).trim(), "分开武器人");
  assert.match(await page.textContent("#g-stats-body"), /瑞比/);
  await page.click("#g-stats-merge");
  await page.click("#g-stats-close");
  assert.deepEqual(o.errors, []);
});

test("训练场：标题选角色和等级进场；对假人打一下记进本回合；假人不行动、掉到一半补满，战斗不会结束", async (t) => {
  const o = await open(t); if (!o) return;
  const { page } = o;
  await page.click("#t-training");
  await page.selectOption("#g-train-kit", "ras");
  await page.selectOption("#g-train-lv", "10");
  await page.click("#g-train-go");
  await page.waitForFunction(() => state.training && state.training.kit === "ras" && GAME.depth === 0);
  assert.equal(await page.evaluate(() => state.units.filter(u => !u.hidden).map(u => u.name).sort().join(",")), ["拉斯缪尔", "训练假人"].sort().join(","));
  await page.keyboard.press("Space");
  await page.waitForFunction(() => state.combatStarted && state.combatPhase === "player" && GAME.depth === 0, null, { timeout: 15000 });
  const ras = await selectHero(page, "ras");
  const hp0 = await page.evaluate(i => totalHp(state.units.find(u => u.id === i)), ras);
  await page.keyboard.press("1");
  await page.waitForFunction(() => GAME.arm && GAME.arm.mode === "unit");
  const dummy = await page.evaluate(() => state.units.find(u => u.trainingDummy).id);
  await page.click(`.unit-wrap[data-id="${dummy}"]`);
  await page.waitForFunction(() => state.training.per[0] > 0 && GAME.depth === 0, null, { timeout: 10000 });
  assert.match(await page.textContent("#g-train"), /训练场 · 拉斯缪尔 Lv10/);
  // 打到只剩 1 血再结束回合：补满（掉的血照记），战斗不结束，进入第 2 回合
  const before = await page.evaluate(() => Training.damage(state));
  await page.evaluate(() => { const d = state.units.find(u => u.trainingDummy); d.layers[0].current = 1; });
  await page.click("#g-endturn");
  await page.waitForFunction(() => state.combatPhase === "player" && state.turnNo >= 2 && GAME.depth === 0 || GAME.ended, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => GAME.ended), false, "假人补满，战斗没有结束");
  const st = await page.evaluate(() => { const d = state.units.find(u => u.trainingDummy); return { hp: totalHp(d), max: totalMaxHp(d), per: state.training.per, dmg: Training.damage(state) }; });
  assert.equal(st.hp, st.max, "补满了");
  assert.ok(st.dmg >= Math.max(before, st.max - 1), "补血前掉的血照记（打到只剩 1 血 → 至少记 max − 1）");
  assert.equal(st.per.length, 2);
  assert.equal(await page.evaluate(i => totalHp(state.units.find(u => u.id === i)), ras), hp0, "假人不行动，没打拉斯缪尔");
  assert.match(await page.textContent("#g-train"), /前 8 回合合计/);
  assert.deepEqual(o.errors, []);
});
