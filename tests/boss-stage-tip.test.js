// 分阶段的首领 / 精英（#205）：战斗里的悬停说明只写当前阶段的能力——
// 别的阶段的能力不列，只留一句「还有其他阶段」（不剧透）；首领机制的倒计时照旧；图鉴照旧列全部阶段。
// 联机玩家拿到的是房主算好的阶段编号（online-view.js 白名单只发编号），悬停说明和单机一样，不含坚毅生命
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const H = require("./headless");

function load() {
  const c = H.load();
  for (const f of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-view.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f });
  return c;
}
function field(c, enemies, seed) {
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.max = 999; l.current = 999; }); u.shp = 777001; });
  return S;
}
const hit = (c, a, t, atk) => c.dealTo(a, t, { atk, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

/** 单机战斗画面（game.js · unitTipHtml）交给 UnitTip 的：快照里的阶段编号、状态词、首领机制倒计时 */
function localTip(c, u) {
  const tokens = (c.statusLine(u) || "").split(" · ").filter(t => t && t !== "无状态");
  return c.UnitTip.html({ kind: "enemy", kit: u.kit, stage: c.bestiaryStageOf(u) }, tokens,
    { name: u.name, sub: `Lv${u.level} · ${u.zone} 区`, mechs: c.UnitCard.mechLines({ marks: c.bossMarksOn(u), casts: c.bossCastsBy(u) }) });
}
/** 联机玩家画面（online-ui.js · unitTip）：只看房主投影过来的数据 */
function onlineTip(c, pv) {
  const d = pv.display || {};
  const tokens = (d.status || "").split(" · ").filter(Boolean);
  return c.UnitTip.html({ kind: "enemy", kit: pv.kit, stage: d.stage }, tokens,
    { name: pv.name, sub: `Lv${pv.level} · ${pv.zone} 区`, mechs: c.UnitCard.mechLines({ marks: d.marks, casts: d.casts }) });
}
/** 悬停说明里列出来的能力（去掉标签的文字） */
const abilities = html => [...html.matchAll(/<ul class="ut-list">([\s\S]*?)<\/ul>/g)]
  .flatMap(m => [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => x[1].replace(/<[^>]+>/g, "")));
const plain = html => html.replace(/<[^>]+>/g, "");

/** 这一阶段：悬停说明写出阶段名和「还有其他阶段」，有 has 里的能力名，没有 not 里的（整段说明里都找不到） */
function checkStage(c, u, stage, name, has, not) {
  assert.equal(c.bestiaryStageOf(u), stage, `${u.name} 在第 ${stage} 阶段`);
  const html = localTip(c, u), text = plain(html), list = abilities(html).join("\n");
  assert.ok(text.includes("当前阶段：" + name), `写出现在是「${name}」：${text}`);
  assert.ok(text.includes("还有其他阶段"), "别的阶段只留一句提示");
  for (const w of has) assert.ok(list.includes(w), `${name}：能力里应该有「${w}」\n${list}`);
  for (const w of not) assert.ok(!text.includes(w), `${name}：不该写别的阶段的「${w}」\n${text}`);
  return html;
}
const stageLine = html => (html.match(/<p class="ut-stage">[\s\S]*?<\/p>/) || [""])[0];
/** 联机投影：只多一个阶段编号；玩家端的悬停说明和单机一样，不含坚毅生命 */
function checkOnline(c, S, u) {
  const pv = c.OnlineView.projectUnit(u);
  assert.equal(pv.display.stage, c.bestiaryStageOf(u), "房主算的阶段编号原样发给玩家");
  const mine = onlineTip(c, pv), local = localTip(c, u);
  assert.equal(stageLine(mine), stageLine(local), "阶段那一行一样");
  assert.deepEqual(abilities(mine), abilities(local), "列的能力一样");
  // 整段也一样（投影发给玩家的文字本来就做了 NFKC 规范化：首领机制目标里的「（2）」到玩家那边是「(2)」，和这次无关）
  assert.equal(mine.normalize("NFKC"), local.normalize("NFKC"), "玩家端的悬停说明和单机一样");
  assert.doesNotMatch(mine, /坚毅|777001/);
  assert.doesNotMatch(JSON.stringify(c.OnlineView.projectState(S)), /777001|"shp"/, "坚毅生命不进玩家数据");
}

const AGG = {
  1: ["沙爪", "沙尘爆裂", "狂暴连打"],
  2: ["机械臂", "电能炮"],
  3: ["吸引碎片", "肉体操控"]
};
const others = (table, k) => Object.keys(table).filter(x => Number(x) !== k).flatMap(x => table[x]);

test("配置：分阶段的敌人每个阶段列的能力都能在图鉴说明里找到，一行能力最多属于一个阶段", () => {
  const c = load();
  const ST = vm.runInContext("BESTIARY_STAGES", c), TX = c.S.BESTIARY_TEXT;
  assert.deepEqual(Object.keys(ST).sort(), ["livesand", "sand_aggregate", "ufo_boss"]);
  for (const [kit, stages] of Object.entries(ST)) {
    const lines = TX[kit].abilities;
    assert.ok(stages.length >= 2, kit + " 至少两个阶段");
    const claimed = new Map();
    stages.forEach((s, i) => {
      assert.ok(s.name && s.skill && s.abilities.length, `${kit} 第 ${i + 1} 阶段写全了`);
      s.abilities.forEach(p => {
        const hits = lines.filter(a => a.startsWith(p));
        assert.ok(hits.length >= 1, `${kit}「${p}」在图鉴说明里找不到`);
        hits.forEach(a => { assert.ok(!claimed.has(a) || claimed.get(a) === i, `${kit}：「${a}」被两个阶段认领`); claimed.set(a, i); });
      });
    });
    assert.equal(new Set(stages.map(s => s.skill)).size, stages.length, kit + " 每个阶段认的招式不同");
  }
});

test("沙灵聚合体：一 / 二 / 三阶段各只写自己的能力；三阶段吸满碎片回到二阶段，说明跟着回去；联机一致", () => {
  const c = load();
  const S = field(c, [{ id: "sand_aggregate", lv: 5, zone: 2 }], "STAGE-AGG");
  const a = S.units.find(u => u.kit === "sand_aggregate"), k = c.findKit("kolt", S.units);
  k.zone = 2;
  a.layers.forEach(l => { l.max = Math.max(l.max, 500); });
  const h1 = checkStage(c, a, 1, "一阶段", AGG[1], others(AGG, 1));
  assert.match(h1, /首领机制 · 倒计时[\s\S]*沙尘爆裂/, "首领机制的倒计时照旧");
  checkOnline(c, S, a);
  // 打穿外层沙壳 → 二阶段
  a.layers[0].current = 1; hit(c, k, a, 50);
  assert.equal(a.resources.phase, 2);
  const h2 = checkStage(c, a, 2, "二阶段", AGG[2], others(AGG, 2));
  assert.match(h2, /首领机制 · 倒计时[\s\S]*电能炮/, "二阶段的电能炮倒计时照旧显示");
  checkOnline(c, S, a);
  // 装甲击破 → 三阶段
  a.layers.find(l => l.type === "armor").current = 1; hit(c, k, a, 50);
  assert.equal(a.resources.phase, 3);
  checkStage(c, a, 3, "三阶段", AGG[3], others(AGG, 3));
  checkOnline(c, S, a);
  // 吸引碎片两次 → 回到二阶段
  S.combatPhase = "enemy"; a.ap = 2; S.attackerId = a.id;
  c.runSkill("en_agg3_debris"); a.ap = 2; c.runSkill("en_agg3_debris");
  assert.equal(a.resources.phase, 2);
  checkStage(c, a, 2, "二阶段", AGG[2], others(AGG, 2));
  checkOnline(c, S, a);
});

test("飞碟触灵：按还活着的机械足分阶段（4–5 / 2–3 / 1 条），本体和机械足的说明都只写当前阶段；联机一致", () => {
  const c = load();
  const S = field(c, [{ id: "ufo_boss", lv: 3, zone: 2 }], "STAGE-UFO");
  const body = S.units.find(u => u.kit === "ufo_body");
  const legs = S.units.filter(u => u.kit === "ufo_leg");
  assert.equal(legs.length, 5);
  const UFO = { 1: ["五足齐全", "踩踏"], 2: ["剩三足"], 3: ["剩一足", "自爆"] };
  const common = ["毁掉一只机械足", "协助"];
  const want = { 5: [1, "机械足 4–5 条"], 4: [1, "机械足 4–5 条"], 3: [2, "机械足 2–3 条"], 2: [2, "机械足 2–3 条"], 1: [3, "机械足 1 条"] };
  for (let n = 5; n >= 1; n--) {
    const alive = legs.filter(u => !u.dead);
    while (alive.length > n) { const leg = alive.pop(); leg.layers.forEach(l => { l.current = 0; }); leg.dead = true; }
    c.syncUfoBody(body);
    assert.equal(c.ufoLivingLegs(body).length, n);
    const [stage, name] = want[n];
    // 和规则给的招式对得上：踩踏 / 激光扫射 / 准备自爆
    assert.ok(c.enemySkillList(body).some(s => s.id === ["ufo_stomp", "ufo_sweep", "ufo_prime"][stage - 1]), `${n} 条腿时的招式`);
    const hb = checkStage(c, body, stage, name, UFO[stage].concat(common), others(UFO, stage));
    const leg = legs.find(u => !u.dead);
    assert.equal(c.bestiaryStageOf(leg), stage, "机械足跟着本体的阶段");
    assert.deepEqual(abilities(localTip(c, leg)), abilities(hb), "机械足的悬停说明列的能力和本体一样");
    checkOnline(c, S, body);
    checkOnline(c, S, leg);
  }
});

test("活沙：被杀死吸收沙灵变成巨型活沙之前 / 之后各只写自己那一形态的能力；联机一致", () => {
  const c = load();
  const S = field(c, [{ id: "livesand", lv: 3, zone: 2 }, { id: "sand_beast", lv: 3, zone: 2 }, { id: "sand_human", lv: 3, zone: 2 }], "STAGE-LIVE");
  const live = S.units.find(u => u.kit === "livesand"), k = c.findKit("kolt", S.units);
  k.zone = 2;
  const LIVE = { 1: ["每回合一次", "被杀死时吸收"], 2: ["穿刺", "流沙漩涡", "三回合内"] };
  checkStage(c, live, 1, "活沙", LIVE[1].concat("可以对自己协助"), others(LIVE, 1));
  checkOnline(c, S, live);
  live.layers.forEach(l => { l.current = 1; });
  hit(c, k, live, 50);
  assert.equal(live.resources && live.resources.giant, true, "吸收后变成巨型活沙");
  assert.equal(live.dead, false);
  checkStage(c, live, 2, "巨型活沙", LIVE[2].concat("可以对自己协助"), others(LIVE, 2));
  checkOnline(c, S, live);
});

test("不分阶段的敌人照旧：不写阶段，能力全列；联机不发阶段编号", () => {
  const c = load();
  const S = field(c, [{ id: "outlaw_king", lv: 5, zone: 2 }, { id: "chixia", lv: 5, zone: 1 }, { id: "thug_knife", lv: 3, zone: 2 }], "STAGE-NONE");
  for (const kit of ["outlaw_king", "chixia", "thug_knife"]) {
    const u = S.units.find(x => x.kit === kit);
    assert.equal(c.bestiaryStageOf(u), 0, kit);
    const html = localTip(c, u);
    assert.doesNotMatch(html, /当前阶段|还有其他阶段/);
    assert.equal(abilities(html).length, c.S.BESTIARY_TEXT[kit].abilities.length, kit + " 能力全列");
    assert.equal((c.OnlineView.projectUnit(u).display || {}).stage, undefined, kit + " 联机不发阶段");
  }
  // 我方单位也不发
  assert.equal((c.OnlineView.projectUnit(c.findKit("kolt", S.units)).display || {}).stage, undefined);
});

test("图鉴不受影响：分阶段的敌人照旧列全部阶段的能力；不知道阶段（战斗外）时悬停说明也照旧全列", () => {
  const c = load();
  const e = kit => c.bestiaryEntries().find(x => x.kit === kit).text.abilities.join("\n");
  for (const w of [].concat(AGG[1], AGG[2], AGG[3])) assert.ok(e("sand_aggregate").includes(w), "图鉴：沙灵聚合体 " + w);
  for (const w of ["五足齐全", "剩三足", "剩一足"]) assert.ok(e("ufo_boss").includes(w), "图鉴：飞碟触灵 " + w);
  for (const w of ["每回合一次", "穿刺", "三回合内"]) assert.ok(e("livesand").includes(w), "图鉴：活沙 " + w);
  for (const kit of ["sand_aggregate", "ufo_boss", "livesand"]) {
    const d = c.UnitTip.describe({ kind: "enemy", kit });
    assert.equal(d.stage, "");
    assert.equal(d.list.length, c.S.BESTIARY_TEXT[kit].abilities.length);
  }
});

test("联机白名单：阶段只放行 1–9 的整数，别的不发", () => {
  const c = load();
  const S = field(c, [{ id: "sand_aggregate", lv: 5, zone: 2 }], "STAGE-WL");
  const a = S.units.find(u => u.kit === "sand_aggregate");
  const real = c.bestiaryStageOf;
  try {
    for (const bad of [2.5, "2", 0, -1, 10, NaN, { n: 2 }, null]) {
      c.bestiaryStageOf = () => bad;
      assert.equal((c.OnlineView.projectUnit(a).display || {}).stage, undefined, "不发 " + String(bad));
    }
  } finally { c.bestiaryStageOf = real; }
  assert.equal(c.OnlineView.projectUnit(a).display.stage, 1);
});

test("联机演出（tape）里的画面快照：身上没有 resources，用快照里算好的阶段，不会退回一阶段", () => {
  const c = load();
  const S = field(c, [{ id: "sand_aggregate", lv: 5, zone: 2 }], "STAGE-TAPE");
  const a = S.units.find(u => u.kit === "sand_aggregate"), k = c.findKit("kolt", S.units);
  k.zone = 2; a.layers[0].current = 1; hit(c, k, a, 50);
  assert.equal(c.bestiaryStageOf(a), 2);
  // game.js · snapUnit 的样子：只有画面要的字段（层是 cur / max），阶段已经算好放在 stage 上
  assert.match(fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8"), /stage: [^\n]*bestiaryStageOf\(u\)/, "snapUnit 记下阶段");
  const snap = { id: a.id, name: a.name, kit: a.kit, level: a.level, zone: a.zone, layers: a.layers.map(l => ({ type: l.type, cur: l.current, max: l.max })), stage: c.bestiaryStageOf(a) };
  const tape = c.OnlineView.projectTape([{ type: "pop", unitId: a.id, kind: "dmg", value: 3, snap: [snap] }], { state: S });
  const pv = tape[0].snap.find(u => u.id === a.id);
  assert.equal(pv.display.stage, 2, "演出中玩家看到的也是二阶段");
  assert.deepEqual(abilities(onlineTip(c, pv)), abilities(localTip(c, a)));
});

/* ---------- 画面（Playwright；没装就跳过） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
let browser;
test.before(async () => { try { const pw = playwright(); if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); } catch (error) { if (process.env.REQUIRE_UI === "1") throw error; } });
test.after(async () => { if (browser) await browser.close(); });
async function site(t) {
  const website = http.createServer((req, res) => {
    const file = path.resolve(H.ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(H.ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" })[path.extname(file)] || "application/octet-stream");
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { website.once("error", reject); website.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => website.close(resolve)));
  return "http://127.0.0.1:" + website.address().port;
}
/** 房主那边：打穿沙灵聚合体的外层沙壳，进二阶段 */
const TO_PHASE2 = () => {
  const a = state.units.find(u => u.kit === "sand_aggregate"), k = state.units.find(u => u.isPlayer && !u.weaponOf && !u.dead);
  k.zone = a.zone;
  a.layers[0].current = 1;
  dealTo(k, a, { atk: 50, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  return a.resources.phase;
};
function checkTipText(text, stage) {
  assert.ok(text.includes("当前阶段：" + ["一阶段", "二阶段"][stage - 1]), text);
  assert.match(text, /还有其他阶段/);
  for (const w of AGG[stage]) assert.ok(text.includes(w), `第 ${stage} 阶段应该写「${w}」：${text}`);
  for (const w of others({ 1: AGG[1], 2: AGG[2], 3: AGG[3] }, stage)) assert.ok(!text.includes(w), `第 ${stage} 阶段不该写「${w}」：${text}`);
  assert.doesNotMatch(text, /坚毅生命|777001/);
}

test("单机战斗画面：沙灵聚合体一阶段的悬停说明只写一阶段的能力，打穿沙壳进二阶段后只写二阶段的", { timeout: 60000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.GAME && !!window.UnitTip);
  await page.evaluate(() => {
    GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("阶段测试", () => {
      BattleSim.setup({ party: ["ruby", "yuito"], enemies: [{ id: "sand_aggregate", lv: 5, zone: 2 }], seed: "STAGE-UI" });
      state.units.filter(u => u.isPlayer).forEach(u => { u.shp = 777001; });
      return {};
    });
    GAME.startOrEnd();
  });
  await page.waitForFunction(() => state.combatStarted);
  await page.evaluate(() => document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()));
  const id = await page.evaluate(() => state.units.find(u => u.kit === "sand_aggregate").id);
  const tip = async () => {
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    await page.hover(`#g-field .unit-wrap[data-id="${id}"] .unit`);
    await page.waitForSelector(".unit-tip.show");
    return page.textContent(".unit-tip");
  };
  checkTipText(await tip(), 1);
  assert.equal(await page.evaluate(TO_PHASE2), 2);
  await page.evaluate(() => GAME.refresh());
  checkTipText(await tip(), 2);
  assert.deepEqual(errors, []);
});

test("联机玩家画面：悬停说明和单机一样只写当前阶段——房主那边进二阶段，玩家看到的跟着换", { timeout: 120000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const { createLocalRelayServer } = require("../relay/local-server.cjs");
  const origin = await site(t);
  const relay = await createLocalRelayServer({ origins: [origin] }); t.after(() => relay.close());
  const pages = [], errors = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); t.after(() => context.close());
    const p = await context.newPage(); pages.push(p);
    p.on("pageerror", e => errors.push(e.message)); p.on("dialog", d => d.accept());
    await p.goto(origin + "/game.html"); await p.waitForFunction(() => !!window.OnlineGame && !!window.GAME);
    await p.evaluate(() => { GAME.skip = true; GAME.instant = true; });
  }
  const [host, alice] = pages;
  const code = await host.evaluate(async url => { await OnlineGame.create({ url, name: "GM", slot: 0, campaignName: "阶段测试" }); return OnlineGame.getView().roomCode; }, relay.url);
  await alice.evaluate(o => OnlineGame.join(o), { url: relay.url, roomCode: code, name: "Alice" });
  await host.waitForFunction(() => OnlineGame.getView().players.length === 2 && !OnlineGame.isPaused());
  await alice.waitForFunction(() => !!OnlineGame.getView().packet?.state);
  const aliceId = await alice.evaluate(() => OnlineGame.getView().identity.id);
  await host.evaluate(a => OnlineGame.assign({ [HotseatGame.getView().heroes[0].id]: a }), aliceId);
  await host.evaluate(() => { OnlineGame.start(); });
  await alice.waitForFunction(() => OnlineGame.getView().screen === "exploration");
  await host.evaluate(() => battleTemplateSave({ name: "阶段", board: 2, enemies: [{ preset: "sand_aggregate", level: 5, zone: 2 }] }));
  await host.click('#tr-tabs [data-tab="battles"]');
  await host.click('[data-bt^="fight:"]');
  await host.waitForFunction(() => state.units.some(u => u.kit === "sand_aggregate"));
  const id = await host.evaluate(() => state.units.find(u => u.kit === "sand_aggregate").id);
  await host.evaluate(() => { state.units.filter(u => u.isPlayer).forEach(u => { u.shp = 777001; }); OnlineGame.touch(); });
  const sel = `#online-stage .ol-battle [data-unit-id="${id}"]`;
  await alice.waitForSelector(sel);
  // 玩家画面收到新数据后重画要一点时间：移开再悬停，直到说明里写的是想要的阶段（最多试 20 次）
  const tip = async (stage) => {
    const want = "当前阶段：" + ["一阶段", "二阶段"][stage - 1];
    let text = "";
    for (let i = 0; i < 20 && !text.includes(want); i++) {
      await alice.mouse.move(2, 2);
      await alice.waitForTimeout(150);
      await alice.hover(sel);
      text = await alice.evaluate(() => document.querySelector(".unit-tip.show")?.textContent || "");
    }
    return text;
  };
  checkTipText(await tip(1), 1);
  assert.equal(await host.evaluate(TO_PHASE2), 2);
  await host.evaluate(() => { GAME.refresh(); OnlineGame.touch(); });
  await alice.waitForFunction(i => OnlineGame.getView().packet?.state?.units?.find(u => u.id === i)?.display?.stage === 2, id);
  checkTipText(await tip(2), 2);
  assert.doesNotMatch(await alice.evaluate(() => JSON.stringify(OnlineGame.getView().packet)), /777001|"shp"/);
  assert.deepEqual(errors, []);
});
