// 后台加首领机制时可以填技能名（#291）：战场配置里死刑 / 分担 / 远离 / 踩塔四个面板各有一个「技能名」（选填）。
// 填了：规则给画面的标记 / 读条 / 塔都叫这个名字——横幅、头顶图标、悬停说明、踩塔牌子、战斗记录、加 / 去机制的提示都写它
// （和内置首领的「公开处刑」「沙尘爆裂」一样），联机玩家收到的也是它；不填（空着 / 全是空格）跟以前一样用机制原名；
// 不是字符串、太长、联机白名单发不出去的报错，不偷偷改成别的。存档 / 读档、撤销以后名字不变
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const H = require("./headless");

/** 规则环境 + 画面共用的单位卡（unit-card.js）+ 联机投影（online-view.js） */
function load() {
  const c = H.load();
  for (const f of ["hud-icons.js", "unit-card.js", "unit-tip.js", "online-view.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f });
  return c;
}
/** 再加上战斗画面（game.js；没有网页，只用它导出的存档 / 撤销那几样） */
function withGame() {
  const c = load();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8"), c, { filename: "game.js" });
  return c;
}
const GAME_JS = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

// 战场配置四个面板发的指令（game.js · renderFieldSheet → battle-commands.js）
const CFG = {
  setExecution: { phase: "enemy", turns: 2, then: "repeat", hits: [{ mult: 1 }] },
  setShare: { phase: "enemy", turns: 2, then: "repeat", mult: 2 },
  setSpread: { phase: "enemy", turns: 2, then: "repeat", mult: 1 },
  setTower: { phase: "enemy", turns: 2, then: "repeat", count: 1, need: 1, soak: 0.5, fail: 2 }
};
const ACTIONS = Object.keys(CFG);
const TYPE = { setExecution: "execution", setShare: "share", setSpread: "spread", setTower: "tower" };
const ORIGINAL = { setExecution: "死刑", setShare: "分担", setSpread: "远离", setTower: "踩塔" };
const NAMED = { setExecution: "公开处刑", setShare: "陨星坠落", setSpread: "沙尘爆裂", setTower: "镇魂之柱" };
const expect = (table) => JSON.stringify(ACTIONS.map(a => [TYPE[a], table[a]]));
const names = (list) => JSON.stringify([...list].map(x => [x.type, x.name]));

function field(c, seed) {
  c.BattleSim.setup({ party: ["tou", "kolt", "helu"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed });
  const S = c.S.state;
  const boss = S.units.find(u => !u.isPlayer);
  boss.layers.forEach(l => { l.current = l.max = 999; });
  S.units.filter(u => u.isPlayer).forEach(u => { u.layers.forEach(l => { l.current = l.max = 500; }); u.shp = 777001; });
  c.startCombat();
  return { S, boss };
}
/** 战场配置的一个面板：点「加上 / 改」（extra 盖在默认配置上）；extra = null 是「去掉」 */
const panel = (c, boss, action, extra) => c.Commands.dispatch({ type: "battle.panel", action, actor: boss.id, cfg: extra === null ? null : Object.assign({}, CFG[action], extra) });
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const mech = (boss, type) => boss.mechanics.find(m => m.type === type);
/** 落下：第 1 回合挂上 turns = 1 的机制，第 2 回合敌人回合开始时落下（格挡都不挡；记下格挡标题里的机制名） */
function toFall(c, S) {
  const asked = [];
  const drain = () => { while (S.blockQueue && S.blockQueue.length) { const f = S.blockQueue[0].opt && S.blockQueue[0].opt.flags; if (f && f.execution) asked.push(f.execName); c.finishBlock(null); } };
  c.endPlayerTurn(); drain(); c.endEnemyTurn(); drain(); c.endPlayerTurn(); drain();
  return asked;
}

test("填了技能名：标记 / 读条 / 塔（bossMarksOn / bossCastsBy / bossZoneMarks）都叫这个名字；悬停说明（mechLines）、头顶图标、踩塔牌子、横幅、加上的提示也写它", () => {
  const c = load(), UC = c.UnitCard;
  const { S, boss } = field(c, "MECH-NAME");
  const notes = ACTIONS.map(a => panel(c, boss, a, { name: NAMED[a] }).notes.join("\n"));
  ACTIONS.forEach((a, i) => {
    assert.match(notes[i], new RegExp(`^${boss.name} 加上「${NAMED[a]}」：`), "加上的提示写技能名");
    assert.doesNotMatch(notes[i], new RegExp(`「${ORIGINAL[a]}」`), "不再写机制原名");
  });
  assert.equal(names(boss.mechanics), expect(NAMED), "名字记在机制上");
  // 首领头上正在读条的、被点名的人身上的、区上的塔
  const casts = c.bossCastsBy(boss);
  assert.equal(names(casts), expect(NAMED));
  const t = S.units.find(u => u.id === mech(boss, "execution").st.targetId);
  const marks = c.bossMarksOn(t);
  assert.ok(marks.some(x => x.type === "execution" && x.name === "公开处刑"), names(marks));
  assert.ok(marks.some(x => x.type === "spread" && x.name === "沙尘爆裂"), "远离标记我方全员");
  const z = mech(boss, "tower").st.zones[0];
  const towers = c.bossZoneMarks(z);
  assert.equal(names(towers), JSON.stringify([["tower", "镇魂之柱"]]));
  // 悬停说明
  const lines = [...UC.mechLines({ marks, casts })];
  for (const head of ["公开处刑（还有 2 回合）：" + boss.name + " 的公开处刑：", "沙尘爆裂（还有 2 回合）：" + boss.name + " 的沙尘爆裂：",
    `公开处刑 → ${t.name}（还有 2 回合）`, "沙尘爆裂 → 全员（3）（还有 2 回合）", `镇魂之柱 → ${z}区（还有 2 回合）`]) {
    assert.ok(lines.some(l => l.startsWith(head)), head + "\n" + lines.join("\n"));
  }
  assert.ok(lines.some(l => /^陨星坠落 → \S+（还有 2 回合）/.test(l)));
  assert.ok(lines.every(l => !/^(死刑|分担|远离|踩塔)/.test(l)), lines.join("\n"));
  // 头顶的图标（名字在悬停说明和读屏里）、区名旁边的塔
  assert.match(UC.mechIconsHtml({ marks }), /aria-label="公开处刑：还有 2 回合"/);
  assert.match(UC.mechIconsHtml({ casts }), new RegExp(`aria-label="公开处刑 → ${t.name}：还有 2 回合"`));
  assert.match(UC.mechIconsHtml({ casts }), new RegExp(`aria-label="镇魂之柱 · ${z} 区：还有 2 回合"`));
  assert.match(UC.towerMarkHtml(towers), /aria-label="镇魂之柱：还有 2 回合"/);
  assert.match(UC.towerTip(towers[0]), new RegExp(`^${boss.name} 的镇魂之柱：`));
  // 战场正上方的横幅（game.js · snapUnit 的 casts 就是 bossCastsBy）
  const share = S.units.find(u => u.id === mech(boss, "share").st.targetId);
  assert.deepEqual([...UC.bannerItems([{ id: boss.id, name: boss.name, casts }]).map(UC.bannerText)],
    [`公开处刑 → ${t.name} · 2 回合`, `陨星坠落 → ${share.name} · 2 回合`, "沙尘爆裂 → 全员 · 2 回合", `镇魂之柱 · ${z} 区 · 2 回合`]);
});

test("落下时：战斗记录、协助格挡的标题（execName）写技能名", () => {
  const c = load();
  const { S, boss } = field(c, "MECH-NAME-CAST");
  ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a], turns: 1 }));
  const asked = toFall(c, S);
  const log = logText(S);
  for (const a of ACTIONS) assert.match(log, new RegExp(`【${NAMED[a]}】`), NAMED[a] + " 落下写进战斗记录");
  assert.ok(log.includes(`【${boss.name}】公开处刑 第 1/1 段落下`), "等格挡的那一段落下时（app.js · finishBlock）也写技能名");
  assert.doesNotMatch(log, /【(死刑|分担|远离|踩塔)】/);
  assert.ok(asked.length > 0 && asked.every(n => n === "公开处刑"), "格挡的标题：【公开处刑 1/1】" + JSON.stringify(asked));
});

test("联机：玩家收到的标记 / 读条 / 塔也是这个名字（online-view.js 白名单），玩家端照着画的悬停说明、头顶图标、横幅写它；不带坚毅生命", () => {
  const c = load(), UC = c.UnitCard;
  const { S, boss } = field(c, "MECH-NAME-ONLINE");
  ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a] }));
  const pv = c.OnlineView.projectState(S);
  const pb = pv.units.find(u => u.id === boss.id);
  assert.equal(names(pb.display.casts), expect(NAMED), "首领头上的读条");
  assert.equal(names(pb.mechanics), expect(NAMED), "机制本身（只有名字、目标、回合）");
  const t = mech(boss, "execution").st.targetId, pt = pv.units.find(u => u.id === t);
  assert.ok(pt.display.marks.some(x => x.type === "execution" && x.name === "公开处刑"), names(pt.display.marks));
  assert.ok(pt.display.marks.some(x => x.type === "spread" && x.name === "沙尘爆裂"));
  const z = String(mech(boss, "tower").st.zones[0]);
  assert.equal(names(pv.zoneView[z].towers), JSON.stringify([["tower", "镇魂之柱"]]), "区上的塔");
  // 玩家端（online-ui.js · unitTip / online-battle.js）拿投影来画，和本机同一套 UnitCard（投影里的文字是规范化过的：首领名字的括号变半角）
  const lines = [...UC.mechLines(pt.display)];
  assert.ok(lines.some(l => l.startsWith("公开处刑（还有 2 回合）：" + pb.name + " 的公开处刑：")), lines.join("\n"));
  assert.match(UC.mechIconsHtml(pb.display), new RegExp(`aria-label="公开处刑 → ${pt.name}：还有 2 回合"`));
  assert.match(UC.towerMarkHtml(pv.zoneView[z].towers), /aria-label="镇魂之柱：还有 2 回合"/);
  const banner = [...UC.bannerItems([Object.assign({ id: pb.id, name: pb.name }, pb.display)]).map(UC.bannerText)];
  assert.equal(banner[0], `公开处刑 → ${pt.name} · 2 回合`);
  assert.equal(banner[3], `镇魂之柱 · ${z} 区 · 2 回合`);
  assert.doesNotMatch(JSON.stringify(pv), /777001|"shp"/, "坚毅生命不进玩家数据");
});

test("不填（空着 / 全是空格 / 全角空格）：跟以前一样叫机制原名；填过的改成空着也变回原名", () => {
  for (const blank of [undefined, null, "", "   ", "　　"]) {
    const c = load(), UC = c.UnitCard;
    const { boss } = field(c, "MECH-NAME-BLANK");
    ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a] }));
    assert.equal(names(c.bossCastsBy(boss)), expect(NAMED), "先填了技能名");
    const notes = ACTIONS.map(a => panel(c, boss, a, blank === undefined ? {} : { name: blank }).notes.join("\n"));
    ACTIONS.forEach((a, i) => assert.match(notes[i], new RegExp(`^${boss.name} 加上「${ORIGINAL[a]}」：`), JSON.stringify(blank)));
    assert.ok(boss.mechanics.every(m => !Object.prototype.hasOwnProperty.call(m, "name")), "机制上不记名字（画面用机制原名）");
    const casts = c.bossCastsBy(boss);
    assert.equal(names(casts), expect(ORIGINAL));
    assert.ok([...UC.mechLines({ casts })].every((l, i) => l.startsWith(ORIGINAL[ACTIONS[i]] + " ")));
    assert.match([...UC.bannerItems([{ id: boss.id, name: boss.name, casts }]).map(UC.bannerText)][0], /^死刑 → /);
    assert.match(UC.mechIconsHtml({ casts }), /aria-label="死刑 → /);
  }
});

test("技能名去掉首尾空格，按字数限长（上限 BOSS_MECH_NAME_MAX 在 boss-mechanics.js）；不是字符串、太长的报错，不截短，原来挂着的机制不动", () => {
  const c = load();
  const { boss } = field(c, "MECH-NAME-BAD");
  const MAX = vm.runInContext("BOSS_MECH_NAME_MAX", c);
  assert.ok(Number.isInteger(MAX) && MAX >= 4, "上限放在配置里");
  panel(c, boss, "setExecution", { name: "  公开处刑　" });
  assert.equal(mech(boss, "execution").name, "公开处刑", "去掉首尾空格（半角、全角都算）");
  panel(c, boss, "setShare", { name: "沙".repeat(MAX) });
  assert.equal(mech(boss, "share").name, "沙".repeat(MAX), "正好到上限可以");
  panel(c, boss, "setSpread", { name: "  " + "爆".repeat(MAX) + "  " });
  assert.equal(mech(boss, "spread").name, "爆".repeat(MAX), "首尾的空格不算字数");
  const before = JSON.stringify(boss.mechanics);
  for (const a of ACTIONS) {
    for (const bad of [123, true, ["公开处刑"], { text: "公开处刑" }]) {
      assert.throws(() => panel(c, boss, a, { name: bad }), new RegExp(`^Error: ${TYPE[a]} name must be a string$`), JSON.stringify(bad));
    }
    assert.throws(() => panel(c, boss, a, { name: "塔".repeat(MAX + 1) }), new RegExp(`^Error: ${TYPE[a]} name must be at most ${MAX} characters$`));
  }
  assert.equal(JSON.stringify(boss.mechanics), before, "报错的指令什么都没改");
});

test("联机发不出去的名字（玩家数据白名单 online-view.js · safeText 会整段丢掉的：坚毅、后台……）报错，免得玩家那边没有名字", () => {
  const c = load();
  const { boss } = field(c, "MECH-NAME-SAFE");
  for (const bad of ["坚毅之锤", "后台处刑"]) {
    assert.equal(c.OnlineView.safeText(bad), null, "玩家数据里这段会被丢掉");
    for (const a of ACTIONS) assert.throws(() => panel(c, boss, a, { name: bad }), new RegExp(`${TYPE[a]} name can't be shown to players`));
  }
  assert.equal(boss.mechanics, undefined);
  panel(c, boss, "setTower", { name: "毅然之塔" });
  assert.equal(mech(boss, "tower").name, "毅然之塔", "普通的名字照常");
});

test("去掉机制的提示写现在的名字：填过技能名的写技能名，没填的写机制原名", () => {
  const c = load();
  const { boss } = field(c, "MECH-NAME-OFF");
  ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a] }));
  ACTIONS.forEach(a => assert.deepEqual([...panel(c, boss, a, null).notes], [`${boss.name} 去掉了「${NAMED[a]}」。`]));
  assert.equal(boss.mechanics, undefined);
  ACTIONS.forEach(a => assert.deepEqual([...panel(c, boss, a, null).notes], [`${boss.name} 去掉了「${ORIGINAL[a]}」。`]));
  // 内置首领自己带的名字（亡命之王的「公开处刑」）也一样
  c.addBossMechanic(boss, { type: "execution", name: "公开处刑", turns: 2, hits: [{ mult: 1 }] });
  assert.deepEqual([...panel(c, boss, "setExecution", null).notes], [`${boss.name} 去掉了「公开处刑」。`]);
});

test("存成战斗模板（存在本机）再用它开战：技能名跟着机制走，没填的照旧叫原名", () => {
  const c = load();
  c.GAME = { partyKits: ["tou", "kolt", "helu"] };
  const { boss } = field(c, "MECH-NAME-TPL");
  ACTIONS.forEach(a => panel(c, boss, a, { name: a === "setShare" ? "" : NAMED[a] }));
  const t = c.battleTemplateSave(c.battleTemplateCapture("技能名测试"));
  const raw = c.localStorage.getItem("anterscale-battle-templates");
  // 另一个页面读出模板开战
  const d = load();
  d.GAME = { partyKits: ["tou", "kolt", "helu"] };
  d.localStorage.setItem("anterscale-battle-templates", raw);
  d.dispatch({ type: "battle.setup", level: 5, encounter: d.battleTemplateToEncounter(d.battleTemplateById(t.id)) });
  d.startCombat();
  const foe = d.S.state.units.find(u => !u.isPlayer && u.mechanics);
  assert.equal(JSON.stringify([...d.bossCastsBy(foe)].map(x => [x.type, x.name]).sort()),
    JSON.stringify([["execution", "公开处刑"], ["share", "分担"], ["spread", "沙尘爆裂"], ["tower", "镇魂之柱"]]));
});

test("联机房主的存档（game.js · onlineCheckpoint，写进 localStorage 的那一份）读回来：技能名还在，接着打落下时照样写它", () => {
  const c = withGame();
  const { boss } = field(c, "MECH-NAME-SAVE");
  ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a], turns: 1 }));
  const raw = JSON.stringify(c.GAME.onlineCheckpoint());
  // 刷新页面以后读档（game.js · restoreOnline：整个 state 换成存档里的）
  const d = load(), saved = JSON.parse(raw), S = d.S.state;
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, saved.state);
  const foe = S.units.find(u => u.id === boss.id);
  assert.equal(names(d.bossCastsBy(foe)), expect(NAMED));
  toFall(d, S);
  for (const a of ACTIONS) assert.match(logText(S), new RegExp(`【${NAMED[a]}】`));
});

test("撤销（game.js · battle.undo：每次行动、结束回合前记的快照 saveState）以后名字不变", () => {
  const c = withGame();
  const { S, boss } = field(c, "MECH-NAME-UNDO");
  ACTIONS.forEach(a => panel(c, boss, a, { name: NAMED[a] }));
  // 记快照：照 game.js · pushUndo 的样子，用它自己的 saveState / deepClone
  const saveState = vm.runInContext(`(() => { ${GAME_JS.match(/const SKIP_KEYS = \[[^\]]*\];/)[0]} ${fnSrc(GAME_JS, "deepClone")} ${fnSrc(GAME_JS, "saveState")} return saveState; })()`, c);
  c.GAME.undo.push({ label: "结束第 1 回合", st: saveState(), ledger: null, actorId: null, apWarnTurn: null });
  // 之后改了名字、去掉了一个，再撤销
  panel(c, boss, "setExecution", { name: "另一个名字" });
  panel(c, boss, "setTower", null);
  assert.equal(c.Commands.dispatch({ type: "battle.undo" }).label, "结束第 1 回合");
  const foe = S.units.find(u => u.id === boss.id);
  assert.equal(names(foe.mechanics), expect(NAMED));
  assert.equal(names(c.bossCastsBy(foe)), expect(NAMED));
});

test("战场配置（game.js · renderFieldSheet）：死刑 / 分担 / 远离 / 踩塔四个面板第一项都是「技能名」（选填，灰字写机制原名，最多 BOSS_MECH_NAME_MAX 个字）；改的时候填回现在的名字，点「加上 / 改」时带上 name", () => {
  const fn = fnSrc(GAME_JS, "renderFieldSheet");
  assert.match(fn, /const mechNameBox = \(dflt\) => `<label title="选填：[^"]*不填就叫「\$\{dflt\}」">技能名<input data-x="name" type="text" maxlength="\$\{BOSS_MECH_NAME_MAX\}" placeholder="\$\{dflt\}"><\/label>`;/);
  for (const [box, q, cur, dflt] of [["ed", "f", "cur", "死刑"], ["se", "g", "curS", "分担"], ["pe", "q2", "curP", "远离"], ["te", "q3", "curT", "踩塔"]]) {
    assert.ok(fn.includes(`${box}.innerHTML = \`\${mechNameBox("${dflt}")}\n`), dflt + "：面板第一项是技能名");
    assert.ok(fn.includes(`if (${cur}) {\n        ${q}("name").value = ${cur}.name || "";`), dflt + "：改的时候填回现在的名字");
    assert.ok(fn.includes(`name: ${q}("name").value, phase: ${q}("phase").value`), dflt + "：发指令时带上 name");
  }
});

/* ---------- 浏览器：主持人真的在战场配置里填技能名（没装 Playwright 时跳过） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
let browser = null;
test.before(async () => { const pw = playwright(); if (!pw) return; try { browser = await pw.chromium.launch(); } catch (e) { if (process.env.REQUIRE_UI === "1") throw e; } });
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

test("浏览器 · 战场配置：四个面板都有「技能名」；死刑填「公开处刑」、踩塔只填空格 → 横幅、头顶图标、战斗记录写技能名 / 机制原名；再打开面板名字还在；联机发不出去的名字弹提示、不改", { timeout: 60000 }, async t => {
  if (!browser) { if (process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要 Playwright"); t.skip("Playwright/browser unavailable"); return; }
  const origin = await site(t);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); t.after(() => context.close());
  const page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin + "/game.html"); await page.waitForFunction(() => !!window.GAME && !!window.UnitCard);
  await page.evaluate(() => {
    GAME.skip = true; GAME.instant = true;
    Screens.show("battle");
    GAME.startCustomBattle("技能名测试", () => { BattleSim.setup({ party: ["ruby", "yuito", "ras"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: "MECH-NAME-UI" }); return {}; });
    GAME.startOrEnd();
  });
  await page.waitForFunction(() => state.combatStarted);
  await page.evaluate(() => document.querySelectorAll(".g-intro, .intro, .battle-intro").forEach(n => n.remove()));
  await page.evaluate(() => document.getElementById("g-field-cfg").click());
  await page.waitForSelector("#g-field-sheet.show");
  // 敌人那一行下面的四个面板（死刑、分担、远离、踩塔）：第一项是技能名，空着，灰字写机制原名
  assert.deepEqual(await page.$$eval("#g-enemy-list .exec-edit", eds => eds.map(e => { const i = e.querySelector('[data-x="name"]'); return [i.closest("label").textContent.trim(), i.placeholder, i.maxLength, i.value]; })),
    [["技能名", "死刑", 12, ""], ["技能名", "分担", 12, ""], ["技能名", "远离", 12, ""], ["技能名", "踩塔", 12, ""]]);
  /** 打开第 i 个面板（0 死刑 / 1 分担 / 2 远离 / 3 踩塔），技能名填 name，点「加上 / 改」 */
  const apply = (i, name) => page.evaluate(([i, name]) => {
    const box = document.querySelectorAll("#g-enemy-list .exec-edit")[i];
    box.hidden = false;
    box.querySelector('[data-x="name"]').value = name;
    box.querySelector('[data-x="go"]').click();
  }, [i, name]);
  await apply(0, "公开处刑");
  await apply(3, "   ");
  await page.evaluate(() => GAME.refresh());
  const st = await page.evaluate(() => {
    const boss = state.units.find(u => !u.isPlayer);
    return { id: boss.id, casts: bossCastsBy(boss).map(x => [x.type, x.name]), names: boss.mechanics.map(m => [m.type, m.name || null]), log: state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n") };
  });
  assert.deepEqual(st.casts, [["execution", "公开处刑"], ["tower", "踩塔"]]);
  assert.deepEqual(st.names, [["execution", "公开处刑"], ["tower", null]], "只填空格 = 不填");
  assert.match(st.log, /加上「公开处刑」：/);
  assert.match(st.log, /加上「踩塔」：/);
  // 战场正上方的横幅、首领头上的读条图标
  const banner = await page.$$eval("#g-field > .g-topstack .mech-bar .mb-row", rows => rows.map(r => r.innerText.replace(/\s+/g, " ").trim()));
  assert.ok(banner.some(x => /^公开处刑 → \S+ · 3 回合$/.test(x)) && banner.some(x => /^踩塔 · \d 区 · 3 回合$/.test(x)), JSON.stringify(banner));
  const aria = await page.$$eval(`#g-field .unit-wrap[data-id="${st.id}"] .u-mechs .mech-ico`, els => els.map(e => e.getAttribute("aria-label")));
  assert.ok(aria.some(a => /^公开处刑 → \S+：还有 3 回合$/.test(a)) && aria.some(a => /^踩塔 · \d 区：还有 3 回合$/.test(a)), JSON.stringify(aria));
  // 再打开死刑面板：按钮打勾，技能名还在，按钮变成「改」
  assert.deepEqual(await page.evaluate(() => {
    const box = document.querySelectorAll("#g-enemy-list .exec-edit")[0];
    return [document.querySelector("#g-enemy-list .sheet-slot button").textContent, box.querySelector('[data-x="name"]').value, box.querySelector('[data-x="go"]').textContent];
  }), ["死刑 ✓", "公开处刑", "改"]);
  // 联机发不出去的名字：弹提示，机制不改
  await apply(0, "坚毅之锤");
  assert.match(await page.textContent("#g-hint"), /execution name can't be shown to players/);
  assert.deepEqual(await page.evaluate(() => state.units.find(u => !u.isPlayer).mechanics.map(m => m.name || null)), ["公开处刑", null]);
  assert.deepEqual(errors, []);
});
