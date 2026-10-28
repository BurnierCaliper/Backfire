// PvP 第二步（#464，docs/pvp.md 第 1.1 节）：玩家画面上每个单位旁边看得出它属于哪个阵营——名字前面的小方块（阵营名字的头一个字），
// 玩家这一边按阵营上色，非玩家单位写敌人阵营（灰色），悬停写「阵营：名字」（unit-card.js · factionMarks / paintFaction；
// 联机玩家 online-battle.js · snapUnit / cardSnaps，新画面的白卡 hd2d/hd2d-field.js · packetView，悬停说明 online-ui.js · tipHtml；主持人自己的画面 game.js · snapAll）。
// 只发阵营 id / 名字（online-view.js 白名单），坚毅数值照旧不发；只有一个玩家阵营（默认全在「我方」）时一个标记都不画，一切照旧。
// 前几条在 Node 的小 DOM（tests/mini-dom.js）和无界面规则里跑；画面那条用 Playwright，没装时在 Linux 上用机器自带的 Chrome（tests/cdp-browser.js），都没有就跳过。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const H = require("./headless");
const MD = require("./mini-dom");

const ROOT = path.resolve(__dirname, "..");
const file = f => path.join(ROOT, f);
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(f => vm.runInContext(fs.readFileSync(file(f), "utf8"), c, { filename: f }));

/** 小 DOM 的页面：界面图标 + 单位卡 + 联机玩家的战斗画面 */
function page() {
  const P = MD.create('<main id="g-field"></main>');
  const ctx = vm.createContext(P.window);
  ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js"].forEach(f => vm.runInContext(fs.readFileSync(file(f), "utf8"), ctx, { filename: f }));
  return { w: P.window, doc: P.document, UC: P.window.UnitCard, OB: P.window.OnlineBattle };
}
/** 联机玩家收到的单位（online-view.js 投影过的字段）：两个玩家阵营（我方 / 乙队）、一个盗匪 */
const UNITS = (split = true) => [
  { id: "k1", name: "柯尔特", isPlayer: true, zone: 1, level: 5, layers: [{ type: "flesh", current: 20, max: 20 }], faction: "我方", factionName: "我方" },
  { id: "w1", name: "扭矩", isPlayer: true, weaponOf: "kolt", zone: 1, level: 5, layers: [{ type: "armor", current: 8, max: 8 }], faction: "我方", factionName: "我方" },
  { id: "h1", name: "绯秋", isPlayer: true, zone: 3, level: 5, layers: [{ type: "flesh", current: 20, max: 20 }], faction: split ? "乙" : "我方", factionName: split ? "乙队" : "我方" },
  { id: "e1", name: "狂徒", isPlayer: false, zone: 2, level: 3, layers: [{ type: "flesh", current: 12, max: 12 }], enemyFaction: "盗匪" }
];

test("阵营标记的规则（unit-card.js · factionMarks）：场上有两个以上玩家阵营才画；默认阵营总是头一个颜色，别的按 id 排；武器人跟着持有者；非玩家单位写敌人阵营（灰色）；只有一个玩家阵营 / 没配置时是空表", () => {
  const { UC } = page();
  assert.deepEqual(plain(UC.factionMarks(UNITS(false))), {}, "只有一个玩家阵营：一个标记都没有（敌人也不画）");
  assert.deepEqual(plain(UC.factionMarks(UNITS(true).map(u => { const x = Object.assign({}, u); delete x.faction; delete x.factionName; delete x.enemyFaction; return x; }))), {}, "没配置阵营（主机不发阵营字段）：空表");
  const marks = plain(UC.factionMarks(UNITS(true)));
  assert.deepEqual(marks, {
    k1: { name: "我方", tone: "0" }, w1: { name: "我方", tone: "0" }, h1: { name: "乙队", tone: "1" }, e1: { name: "盗匪", tone: "foe" }
  });
  // 默认阵营排在别的阵营后面也还是头一个颜色，别的按 id 的码位排（和语言设置无关，房主、玩家颜色一样）；藏起来的单位不算
  const order = plain(UC.factionMarks([{ id: "a", isPlayer: true, faction: "red", factionName: "红" }, { id: "b", isPlayer: true, faction: "blue", factionName: "蓝" }, { id: "c", isPlayer: true, faction: "我方", factionName: "我方" }, { id: "d", isPlayer: true, faction: "zzz", hidden: true }]));
  assert.deepEqual([order.c.tone, order.b.tone, order.a.tone], ["0", "1", "2"], "我方 → 0，blue → 1，red → 2");
  assert.equal(order.d, undefined, "藏起来的不画");
  assert.equal(UC.FACTION_MARK.title, "阵营：");
});

test("单位卡上的阵营标记（unit-card.js）：名字前面的小方块写阵营名字的头一个字，悬停写「阵营：名字」，按阵营上色；拿掉以后卡片和从来没画过的一模一样", () => {
  const { UC, doc } = page();
  const snap = extra => Object.assign({ id: "u1", name: "绯秋", level: 5, atk: 9, isPlayer: true, layers: [{ type: "flesh", cur: 20, max: 20 }], def: 3, defMax: 3, ap: 2, apMax: 2, bonus: 1, bonusMax: 1, status: "", badges: [] }, extra || {});
  const plainCard = UC.create(snap()); UC.update(plainCard, snap(), {});
  const c = UC.create(snap()); doc.querySelector("#g-field").appendChild(c.wrap);
  UC.update(c, snap({ faction: { name: "乙队", tone: "1" } }), {});
  const mark = c.wrap.querySelector(".u-head .u-fac");
  assert.ok(mark, "名字前面有阵营标记");
  assert.equal(mark.textContent, "乙");
  assert.equal(mark.title, "阵营：乙队");
  assert.equal(mark.dataset.tone, "1");
  assert.equal(c.wrap.querySelector(".u-head").firstChild, mark, "在名字前面");
  UC.update(c, snap({ faction: { name: "我方", tone: "0" } }), {});
  assert.equal(c.wrap.querySelectorAll(".u-fac").length, 1, "换阵营：还是一个标记");
  assert.equal(c.wrap.querySelector(".u-fac").textContent, "我");
  UC.update(c, snap(), {});
  assert.equal(c.wrap.querySelector(".u-fac"), null, "拿掉了");
  assert.equal(c.unit.innerHTML, plainCard.unit.innerHTML, "和从来没画过标记的卡一模一样");
});

test("联机玩家的画面（online-battle.js）：收到两个玩家阵营的包时单位卡画阵营标记、新画面的白卡也带上；只有一个玩家阵营时一个都没有", () => {
  const { OB, doc } = page();
  const snaps = OB.cardSnaps({ units: UNITS(true), props: [] });
  assert.deepEqual(plain(snaps.map(s => s.faction)), [{ name: "我方", tone: "0" }, { name: "我方", tone: "0" }, { name: "乙队", tone: "1" }, { name: "盗匪", tone: "foe" }]);
  assert.ok(OB.cardSnaps({ units: UNITS(false), props: [] }).every(s => s.faction === null), "只有一个玩家阵营：没有标记");
  // 画出来
  const b = OB.create({});
  doc.body.appendChild(b.el);
  b.update({ units: UNITS(true), props: [], zoneMode: 3, fields: {}, gaps: {} }, { mine: ["k1"] });
  const marks = Object.fromEntries([...b.el.querySelectorAll(".unit-wrap")].filter(w => w.dataset.unitId).map(w => [w.dataset.unitId, w.querySelector(".u-fac") ? w.querySelector(".u-fac").title : null]));
  assert.deepEqual(marks, { k1: "阵营：我方", w1: "阵营：我方", h1: "阵营：乙队", e1: "阵营：盗匪" });
  b.update({ units: UNITS(false), props: [], zoneMode: 3, fields: {}, gaps: {} }, { mine: ["k1"] });
  assert.equal(b.el.querySelectorAll(".u-fac").length, 0, "变回一个阵营：标记都拿掉");
  // 新画面（HD-2D）的白卡：packetView 照同一份算
  const ctx = vm.createContext({ console, self: undefined, Math, JSON, Object, Array, Map, Set, String, Number });
  ctx.self = ctx; ctx.UnitCard = page().UC;
  for (const f of ["hd2d/hd2d-layout.js", "hd2d/hd2d-field.js"]) vm.runInContext(fs.readFileSync(file(f), "utf8"), ctx, { filename: f });
  const pv = ctx.HD2DField.packetView({ units: UNITS(true), props: [] }, { OB, OV: { projectUnit: x => x } });
  assert.deepEqual(plain(pv.cards.get("h1").faction), { name: "乙队", tone: "1" }, "白卡也带阵营标记");
});

test("白名单（online-view.js）：发给玩家的包带阵营 id / 名字和行动顺序排到哪一段，不带阵营配置、坚毅数值——主持人加进来的角色也一样", () => {
  const c = H.load();
  load(c, ["gm-commands.js", "online-view.js"]);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "PVP464-MARKS" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  c.BattleCommands.configure({ loadCampaignMem: () => ({ party: [{ kit: "xia", level: 6, shpMax: 523311 }] }) });
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", name: "乙队", phase: "enemy" });
  const xia = c.Commands.dispatch({ type: "gm.addHero", kit: "xia", zone: 3, faction: "乙" }, authority);
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach((u, i) => { u.shp = 712339 + i; u.shpBase = 619103; u.shpBonus = 47109; });
  const packet = c.OnlineView.projectPacket({ type: "result", protocol: 1, build: "x", seq: 1, screen: "battle", state: S,
    view: { players: [], phase: "acting", segment: "enemy", currentUnitId: xia.id } }, { recipientId: "p2", gmId: "host" });
  const unit = id => packet.state.units.find(u => u.id === id);
  assert.deepEqual([unit(xia.id).faction, unit(xia.id).factionName], ["乙", "乙队"], "加进来的角色带阵营");
  assert.equal(unit(c.findKit("kolt", S.units).id).faction, "我方");
  assert.equal(unit(S.units.find(u => !u.isPlayer).id).enemyFaction, "盗匪");
  assert.equal(packet.view.segment, "enemy", "行动顺序排到敌人回合那一段");
  const wire = JSON.stringify(packet).replace(/"upOnShp":(true|false)/g, "");
  assert.doesNotMatch(wire, /712339|712340|712341|619103|47109|523311|shp/i, "坚毅数值一个都不发（队伍记忆里的坚毅上限也不发）");
  assert.ok(!("playerFactions" in packet.state), "阵营配置（谁和谁敌对、谁在哪个回合）不发");
  const odd = c.OnlineView.projectPacket({ type: "result", protocol: 1, build: "x", seq: 2, screen: "battle", state: S, view: { players: [], segment: "<b>x</b>" } }, { recipientId: "p2", gmId: "host" });
  assert.equal(odd.view.segment, undefined, "segment 只放行 player / enemy");
});

test("主持人自己的画面（game.js · snapAll）：场上有两个以上玩家阵营时单位卡快照带阵营标记、悬停写阵营；没配置 / 全在「我方」时快照里没有这个字段", () => {
  const mk = factions => {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "helu", "hiaki"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: "PVP464-HOSTMARK" });
    if (factions) factions(c);
    c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
    load(c, ["unit-card.js", "game.js"]);
    return c;
  };
  const off = mk(null), all = mk(c => c.Commands.dispatch({ type: "battle.playerFaction", faction: "我方" }));
  assert.ok(off.GAME.snapAll().every(s => !("faction" in s)), "没配置：快照和以前一样");
  assert.ok(all.GAME.snapAll().every(s => !("faction" in s)), "配置了但全在「我方」：一样");
  const two = mk(c => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", name: "乙队", unit: c.findKit("hiaki", c.S.state.units).id }));
  const snaps = two.GAME.snapAll(), by = kit => snaps.find(s => s.kit === kit);
  assert.deepEqual(plain(by("kolt").faction), { name: "我方", tone: "0" });
  assert.deepEqual(plain(by("hiaki").faction), { name: "乙队", tone: "1" });
  assert.deepEqual(plain(by("thug_knife").faction), { name: "盗匪", tone: "foe" });
});

/* ---------- 画面（真的浏览器：颜色、位置） ---------- */
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

test("画面：联机玩家的战场上每个单位名字前面有阵营标记——两个玩家阵营颜色不一样，敌人灰色，悬停写阵营名字；只有一个玩家阵营时没有", async t => {
  if (!browser) { t.skip(skipWhy); return; }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  t.after(() => context.close());
  const pg = await context.newPage(), errors = [];
  pg.on("pageerror", e => errors.push(e.message));
  await pg.setContent('<!doctype html><meta charset="utf-8"><body><div id="stage"></div></body>');
  for (const f of ["game.css", "online.css"]) await pg.addStyleTag({ path: file(f) });
  for (const f of ["icons.js", "hud-icons.js", "unit-card.js", "online-battle.js"]) await pg.addScriptTag({ path: file(f) });
  const units = UNITS(true);
  await pg.evaluate(units => {
    window.b = OnlineBattle.create({});
    document.getElementById("stage").appendChild(b.el);
    b.update({ units, props: [], zoneMode: 3, fields: {}, gaps: {} }, { mine: ["k1"] });
  }, units);
  const marks = await pg.evaluate(() => [...document.querySelectorAll(".unit-wrap")].map(w => {
    const m = w.querySelector(".u-fac"), r = m && m.getBoundingClientRect(), name = w.querySelector(".u-name").getBoundingClientRect();
    return { id: w.dataset.unitId, title: m && m.title, text: m && m.textContent, bg: m && getComputedStyle(m).backgroundColor, w: r && r.width, left: r && r.left < name.left };
  }));
  const by = id => marks.find(m => m.id === id);
  assert.ok(marks.every(m => m.w > 0 && m.left), "每张卡都有、看得见、在名字左边：" + JSON.stringify(marks));
  assert.equal(by("h1").title, "阵营：乙队");
  assert.equal(by("h1").text, "乙");
  assert.equal(by("k1").bg, by("w1").bg, "武器人和持有者同色");
  assert.notEqual(by("k1").bg, by("h1").bg, "两个玩家阵营颜色不一样");
  assert.notEqual(by("e1").bg, by("k1").bg, "敌人单独一种颜色");
  await pg.evaluate(units => b.update({ units, props: [], zoneMode: 3, fields: {}, gaps: {} }, { mine: ["k1"] }), UNITS(false));
  assert.equal(await pg.evaluate(() => document.querySelectorAll(".u-fac").length), 0, "只有一个玩家阵营：没有标记");
  assert.deepEqual(errors, []);
});
