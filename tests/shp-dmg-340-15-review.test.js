// （新）issue #340 第 15 条（按 #417 审查补的）：致命的一下、真实的回合结束灼烧、拉斯缪尔不稳态、坠落、
// 联机演出（HD2DFx · cues / numberOf）和联机战场日志摘要（online-game.js · hitSummary / online-view.js · projectLogs），玩家都只看到「坚毅受创」、看不到数字；
// 主持人 / 计算器照旧：多段攻击每段一个数字
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const OV = require("../online-view");
const FX = require("../hd2d/hd2d-fx");

const plain = x => JSON.parse(JSON.stringify(x));
const load = (c, file) => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
const HIT7 = { atk: 0, mult: 0, flat: 7, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } };

/** 起身中的玩家（坚毅 shp）；gameMode = 游戏版（shpHidden） */
function field(opt = {}) {
  const c = H.load();
  c.GAME_MODE = opt.gameMode !== false;
  c.BattleSim.setup({ party: [opt.kit || "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SHP-15R" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  const foe = c.S.state.units.find(u => !u.isPlayer);
  hero.layers.forEach(l => { l.current = 0; });
  hero.dying = false;
  hero.upOnShp = true;
  hero.shp = opt.shp == null ? 40 : opt.shp;
  hero.shpMax = 53;
  hero.zone = 1;
  foe.zone = 1;
  c.S.state.floaters = [];
  return { c, hero, foe };
}
const floats = c => (c.S.state.floaters || []).map(f => String(f.text || ""));

test("第 15 条：致命的一下（坚毅 3 挨 7）也只弹「坚毅受创」、日志不写数字（结算后 upOnShp 已清掉，以前照旧弹 7）", () => {
  const { c, hero, foe } = field({ shp: 3 });
  const out = c.dealTo(foe, hero, HIT7);
  assert.ok(hero.dead && !hero.upOnShp, "确实打死了，upOnShp 已清掉");
  assert.deepEqual(floats(c), ["坚毅受创"]);
  const lines = c.formatHitLines(foe, hero, out, []).join("\n");
  assert.match(lines, /坚毅受创/);
  assert.doesNotMatch(lines, /\d/, "日志不能带数字：" + lines);
});

test("第 15 条：真实的回合结束灼烧（2 层掷骰）打进坚毅：日志整句换成固定写法，不带掷骰和伤害；致命的那一下也一样", () => {
  for (const shp of [40, 2]) {
    const { c, hero } = field({ shp });
    const lines = [];
    c.appendLog = t => lines.push(...String(t).split("\n"));
    hero.statuses.burn = 2;
    c.turnEnd();
    assert.ok(hero.shp < shp, "确实扣了坚毅");
    const mine = lines.filter(l => l.includes(hero.name) && /灼烧/.test(l) && !/叠层/.test(l));
    assert.deepEqual(mine, [`${hero.name} 灼烧 → 坚毅受创`], `坚毅 ${shp}：` + JSON.stringify(lines));
    assert.ok(floats(c).includes("坚毅受创"));
    assert.ok(floats(c).every(t => !/\d/.test(t)), JSON.stringify(floats(c)));
  }
});

test("第 15 条：拉斯缪尔不稳态起身中挨打（直接死亡）也只弹「坚毅受创」、日志不写数字", () => {
  const { c, hero, foe } = field({ kit: "ras" });
  hero.resources = hero.resources || {};
  hero.resources.unstable = true;
  const out = c.dealTo(foe, hero, HIT7);
  assert.ok(hero.dead, "不稳态：起身后再受伤直接死亡");
  assert.deepEqual(floats(c), ["坚毅受创"]);
  const lines = c.formatHitLines(foe, hero, out, []).join("\n");
  assert.doesNotMatch(lines, /\d/, lines);
});

test("第 15 条：起身中坠落（间隙）只弹「坚毅受创」，日志不写数字", () => {
  const { c, hero } = field();
  const notes = [];
  c.gapFall(hero, notes);
  assert.deepEqual(floats(c), ["坚毅受创"]);
  assert.ok(notes.every(n => !/\d/.test(n)), JSON.stringify(notes));
});

test("第 15 条：计算器（不是游戏版）起身中照旧：两段攻击各弹一个数字（以前合成一个）", () => {
  const { c, hero, foe } = field({ gameMode: false });
  assert.equal(c.shpHidden(), false);
  c.dealTo(foe, hero, Object.assign({}, HIT7, { hits: 2, flat: 4 }));
  const f = floats(c);
  assert.equal(f.length, 2, JSON.stringify(f));
  assert.ok(f.every(t => /^\d+!*$/.test(t)), JSON.stringify(f));
});

test("第 15 条：联机投影——主机标了 grit 的一下（致命：快照里已经不是起身中）也不给数、只带标记；演出照样打中，数字只写「坚毅受创」", () => {
  const { c, hero, foe } = field({ shp: 3 });
  const tape = [];
  c.spawnPopup = (unit, spec) => tape.push(Object.assign({ type: "pop", unitId: unit.id, kind: spec.kind || "dmg", snap: plain([unit]) }, plain(spec)));
  c.dealTo(foe, hero, HIT7);
  const pop = tape.find(e => e.kind === "dmg");
  assert.equal(pop.grit, true, "主机这一下带 grit 标记");
  const pk = OV.projectTape(tape, { state: plain(c.S.state) });
  const p = pk.find(e => e.kind === "dmg");
  assert.equal(p.grit, true);
  assert.equal(p.value, undefined, "投影不给数");
  assert.doesNotMatch(JSON.stringify(pk).replace(/"upOnShp":(true|false)/g, ""), /坚毅|shp/i, "包里没有坚毅字样（起身中的布尔值照旧发）");
  assert.deepEqual(FX.numberOf(p), { unitId: hero.id, kind: "word", text: "坚毅受创", el: "physical" });
  const cue = FX.cues({ fx: { actor: foe.id, target: hero.id, move: { kind: "slash", el: "physical", melee: true } }, tape: [Object.assign({}, p, { main: true })], state: { units: [] } }, {});
  assert.equal(cue.waves.length, 1, "照样演打中");
  assert.deepEqual(cue.numbers.map(n => n.text), ["坚毅受创"]);
});

test("第 15 条：联机战场日志摘要（hitSummary）认主机的 grit 标记：致命的一下也只记「坚毅受创」，不记伤害数；真实 projectLogs 放行该词、不漏数字", async () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "SHP-15H" });
  const hero = c.S.state.units.find(u => u.isPlayer && !u.weaponOf);
  const sent = [];
  let status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }] }, statusListener;
  c.console = { error() {}, log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.queueMicrotask = queueMicrotask;
  c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    refresh() {}, disarm() {}, resumeHotseat() {}, onlineCheckpoint: () => plain({ state: c.S.state }), restoreOnline() {}, resumeOnline: async () => {}, setupBattle() {} };
  c.Screens = { current: () => "trpg", is: s => s === "trpg" };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  // 用真实 OnlineView.projectLogs（以前 mock 成透传，白名单缺「坚毅受创」时测不到整行被丢掉）
  c.OnlineView = { projectPacket: p => plain(p), projectLogs: OV.projectLogs };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: "backfire-d3-v1", protocol: 1 }),
    onMessage() {}, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async m => { sent.push(plain(m)); return { ok: true }; }, async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-wire.js", "online-game.js"]) load(c, file);
  await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  // 致命的一下：快照里已经死了、不是起身中；只有主机的 grit 标记说明这一下打进了坚毅
  const snap = [{ id: hero.id, name: hero.name, isPlayer: true, upOnShp: false, dying: false, dead: true }];
  const tape = [{ type: "pop", unitId: hero.id, kind: "dmg", value: 7, grit: true, element: "physical", main: true, snap }];
  c.OnlineGame.onActionSettled({ type: "battle.endEnemyTurn" }, {}, tape, {});
  // getView 已经走真实 projectLogs：hits 折进 text，dmg=0 且只有「坚毅受创」时整行必须还在
  const logs = plain(c.OnlineGame.getView().packet.publicLogs);
  const round = logs.filter(l => l.kind === "round").pop();
  assert.ok(round, JSON.stringify(logs));
  assert.match(round.text, new RegExp(hero.name + "：坚毅受创"), "投影后仍见「坚毅受创」：" + round.text);
  assert.doesNotMatch(round.text, /\d+\s*伤害/, "投影后不能写伤害数：" + round.text);
  assert.doesNotMatch(round.text, /\b7\b/, "投影后不能漏出这一下的 7：" + round.text);
  assert.doesNotMatch(JSON.stringify(logs), /"shp"|坚毅\s*\d|\d+\s*坚毅/, "投影包不能带坚毅数字");
});

test("第 15 条：真实 OnlineView.projectLogs 放行「坚毅受创」；纯坚毅命中不整行消失，也不漏坚毅数字", () => {
  const logs = OV.projectLogs([
    { kind: "round", turn: 3, hits: [
      { name: "瑞比", dmg: 0, brk: 0, heal: 0, words: ["坚毅受创"] },
      { name: "狂徒", dmg: 12, brk: 1, words: ["失衡"] }
    ] },
    { kind: "action", actorName: "刀客", actionName: "普通攻击", hits: [
      { name: "瑞比", dmg: 0, words: ["坚毅受创"], shp: 37 }
    ] }
  ]);
  const texts = logs.map(r => r.text);
  const gritLines = texts.filter(t => t.includes("瑞比"));
  assert.ok(gritLines.some(t => /瑞比：坚毅受创/.test(t)), "纯坚毅命中必须留下这一行：" + texts.join(" | "));
  assert.ok(texts.some(t => /狂徒：12 伤害，击破 1，失衡/.test(t)));
  assert.ok(texts.some(t => /刀客 · 普通攻击 → 瑞比：坚毅受创/.test(t)));
  assert.ok(gritLines.every(t => !/瑞比：[^；]*\d/.test(t)), "瑞比坚毅段不能带数字：" + gritLines.join(" | "));
  assert.doesNotMatch(JSON.stringify(logs), /37|"shp"/i, "投影不能带 shp / 37");
});
