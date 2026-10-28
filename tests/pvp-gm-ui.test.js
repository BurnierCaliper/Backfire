// PvP 第二步（#464）：联机跑团主持人面板（online-gm-ui.js）的画面测试。面板只是界面：每个按钮发出去的都是明确的 JSON 指令——
//   · 「生成敌人」旁边的「加入玩家角色」：任何一张角色卡（已经在场上的灰掉）、选区、选阵营 → gm.addHero；在场玩家角色「移出」→ gm.removeHero
// 规则那一边（指令真的做了什么）在 tests/pvp-gm-panel.test.js。
// 页面和 tests/online-gm-ui.test.js 一样用假的桥（getView / submit / subscribe），只加载面板自己的脚本；没加载规则时面板用 view 里给的角色卡 / 阵营。
// 用 Playwright，没装时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execSync } = require("node:child_process");

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

/** 主持人面板 + 假的桥。view.state.units：柯尔特（我方，主持人操控）、绯秋（乙队，玩家 2 操控）、狂徒；场上已有柯尔特 / 绯秋两张角色卡 */
async function fixture(t) {
  if (!browser) { t.skip(skipWhy); return null; }
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await require("./old-screen")(context);
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><main class="g-app">战场</main></body>');
  await page.addStyleTag({ path: path.join(__dirname, "..", "online-gm-ui.css") });
  await page.addStyleTag({ path: path.join(__dirname, "..", "pause-menu.css") });
  await page.evaluate(() => {
    const hero = (id, kit, name, zone, faction) => ({ id, kit, name, zone, faction, isPlayer: true, level: 3, layers: [{ type: "flesh", current: 14, max: 20 }], def: 3, defMax: 4, ap: 1, apMax: 1, bonus: 1, bonusMax: 1, atk: 8, statuses: {} });
    const kolt = hero("k1", "kolt", "柯尔特", 1, "我方"), hiaki = hero("h1", "hiaki", '<img src=x onerror="window.pwned=1">', 3, "乙");
    const enemy = { id: "enemy", name: "狂徒", zone: 2, isPlayer: false, level: 2, layers: [{ type: "flesh", current: 12, max: 15 }], ap: 1, bonus: 1, statuses: {} };
    window.fixture = { calls: [], listeners: [], reject: "",
      view: { active: true, isHost: true, manualPhase: false, manual: {}, enemyCatalog: [{ id: "thug_knife", name: "狂徒（匕首）" }], enemySkills: {}, skillSteps: {},
        players: [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }],
        heroes: [{ id: "k1", name: "柯尔特", owner: "p1" }, { id: "h1", name: "绯秋", owner: "p2" }],
        heroCards: [{ kit: "kolt", name: "柯尔特" }, { kit: "hiaki", name: "绯秋" }, { kit: "xia", name: "夕夏" }, { kit: "nora", name: "诺拉" }],
        factions: [{ id: "我方", name: "我方", phase: "player" }, { id: "乙", name: "乙队", phase: "enemy" }],
        state: { units: [kolt, hiaki, enemy], zoneMode: 3, props: [], fields: { 1: {}, 2: {}, 3: {} }, gaps: { "1-2": { type: "open" }, "2-3": { type: "open" } }, weather: "none", sandDir: "12", combatStarted: true, combatPhase: "player", turnNo: 1 } },
      emit() { this.listeners.forEach(f => f()); } };
    window.bridge = { getView: () => JSON.parse(JSON.stringify(fixture.view)), subscribe: fn => { fixture.listeners.push(fn); return () => { fixture.listeners = fixture.listeners.filter(x => x !== fn); }; },
      submit: async cmd => { fixture.calls.push(JSON.parse(JSON.stringify(cmd))); return fixture.reject ? { ok: false, error: fixture.reject } : { ok: true }; } };
  });
  await page.addScriptTag({ path: path.join(__dirname, "..", "pause-menu.js") });
  await page.addScriptTag({ path: path.join(__dirname, "..", "online-gm-ui.js") });
  await page.evaluate(() => { window.component = OnlineGMUI.mount(bridge); PauseMenu.setOnline({ host: true }); PauseMenu.open(); });
  await page.click('#pm-overlay [data-pause-item="gmTools"]');
  return { page, errors };
}
const calls = page => page.evaluate(() => fixture.calls);

test("主持人面板「加入玩家角色」（#464）：在「生成敌人」旁边；任何一张角色卡都能选，已经在场上的灰掉；选区、选阵营 → gm.addHero；在场玩家角色写着阵营和操控者，「移出」→ gm.removeHero", async t => {
  const f = await fixture(t); if (!f) return; const { page } = f;
  // 在「敌人」那一栏、「生成敌人」下面
  const heads = await page.evaluate(() => [...document.querySelectorAll("#ogm-panel h3")].map(h => h.textContent));
  assert.ok(heads.indexOf("加入玩家角色") > heads.indexOf("生成敌人") && heads.indexOf("加入玩家角色") >= 0, "「加入玩家角色」紧跟在「生成敌人」后面：" + heads.join(" / "));
  const opts = await page.evaluate(() => [...document.querySelectorAll("#ogm-hero-kit option")].map(o => ({ v: o.value, t: o.textContent, off: o.disabled })));
  assert.deepEqual(opts.map(o => o.v), ["kolt", "hiaki", "xia", "nora"], "每一张角色卡都列出来");
  assert.deepEqual(opts.filter(o => o.off).map(o => o.v), ["kolt", "hiaki"], "已经在场上的灰掉");
  assert.match(opts[0].t, /已在场上/);
  assert.equal(await page.inputValue("#ogm-hero-kit"), "xia", "默认选第一张没在场上的");
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#ogm-hero-faction option")].map(o => o.textContent)), ["我方", "乙队"], "阵营按名字列出");
  // 加入：选区、选阵营
  await page.selectOption("#ogm-hero-kit", "nora");
  await page.selectOption("#ogm-hero-zone", "1");
  await page.selectOption("#ogm-hero-faction", "乙");
  await page.click('[data-action="add-hero"]');
  // 默认阵营不写 faction
  await page.selectOption("#ogm-hero-kit", "xia");
  await page.selectOption("#ogm-hero-faction", "我方");
  await page.click('[data-action="add-hero"]');
  // 在场玩家角色：阵营、操控者；移出
  const rows = await page.evaluate(() => [...document.querySelectorAll(".ogm-heroes li")].map(li => li.textContent));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /柯尔特.*1 区.*我方.*操控：主持人/);
  assert.match(rows[1], /3 区.*乙队.*操控：玩家 2/);
  await page.click('.ogm-heroes [data-action="remove-hero"][data-id="h1"]');
  assert.deepEqual(await calls(page), [
    { type: "gm.addHero", kit: "nora", zone: 1, faction: "乙", silent: false },
    { type: "gm.addHero", kit: "xia", zone: 3, silent: false },
    { type: "gm.removeHero", actor: "h1", silent: false }
  ]);
  assert.equal(await page.evaluate(() => window.pwned), undefined, "名字照原样转义");
  assert.deepEqual(f.errors, []);
});
