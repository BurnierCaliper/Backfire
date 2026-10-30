// PvP 全面找 bug（#490）：大量自动对打 + 对照 docs/pvp.md 读代码找到、规则写得清楚的几处，修完各一条测试（都先在没修的代码上失败）。
//   1. 决斗只能在探索环节：hotseat-game.js · duelExploring 看主持人是不是在战斗画面，以前写 root.Screens——screens.js 的 Screens 是顶层 const，
//      不挂在 window 上，这一条从来没拦过（打完还没回到探索、进了战斗环节还没开打时照样能申请 / 选队 / 开始决斗）。
//   2. 决斗准备画面每队最多 4 人：只数现在还能参加的角色（hotseat.js · pickDuel 的 eligible），选了队以后死亡 / 被移出队伍的不占名额。
//   3. 主持人分阵营按阵营分出胜负时，联机玩家的结算标题、公开记录写「X 获胜」（app.js · pvpWinnersPublic、online-view.js · projectWinners /
//      projectLogs、online-game.js、online-ui.js · resultMarkup），以前人人都是「战斗胜利」（输的阵营也是）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const V = require("../online-view");
const plain = x => JSON.parse(JSON.stringify(x));
function load(c, name) { vm.runInContext(fs.readFileSync(path.join(H.ROOT, name), "utf8"), c, { filename: name }); }

/** 联机跑团房间（和 tests/pvp-duel-online.test.js 一样）：主持人 host、玩家甲 p1（柯尔特、赫鲁米卡）、玩家乙 p2（绯秋）；灯、opt.more 的角色归主持人。在探索环节 */
function room(opt = {}) {
  const party = ["kolt", "helu", "hiaki", "tou"].concat(opt.more || []);
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "PVP490-ONLINE" });
  c.S.TRPG.active = true;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  // 画面切换（screens.js）：和浏览器里一样是顶层 const（不挂在 window 上）
  vm.runInContext('const Screens = (function () { let cur = "trpg"; return { show: n => { cur = n; }, is: n => cur === n, current: () => cur }; })();', c);
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) load(c, f);
  const st = c.S.state, hero = k => st.units.find(u => u.kit === k);
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p1", name: "甲" }, { id: "p2", name: "乙" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [hero("kolt").id]: "p1", [hero("helu").id]: "p1", [hero("hiaki").id]: "p2" } }).ok, true);
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(cmd));
  const duel = () => c.HotseatGame.getView().duel;
  const screen = name => vm.runInContext(`Screens.show(${JSON.stringify(name)})`, c);
  return { c, st, hero, send, duel, screen };
}
const ok = (ack, msg) => assert.equal(ack.ok, true, (msg || "") + "：" + ack.error);
const no = (ack, re, msg) => { assert.equal(ack.ok, false, msg); if (re) assert.match(ack.error, re, msg); };

test("决斗只能在探索环节：主持人在战斗画面（进了战斗环节还没开打、打完还没回到探索）时申请 / 开启 / 选队 / 开始决斗都被拒（#490：以前 root.Screens 永远找不到，从来没拦过）", () => {
  const { c, send, duel, screen } = room();
  screen("battle");   // 主持人点了「进入战斗环节」：战斗画面，还没开打
  assert.equal(c.S.state.combatStarted, false);
  no(send("p1", { type: "duelRequest" }), /先回到探索环节再决斗/, "战斗画面：玩家申请被拒");
  no(send("host", { type: "duelOpen" }), /先回到探索环节再决斗/, "战斗画面：主持人开启也被拒");
  assert.equal(duel(), null, "没有决斗");
  screen("trpg");   // 回到探索
  ok(send("host", { type: "duelOpen" }), "探索环节：能开启");
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }));
  ok(send("p2", { type: "duelPick", kit: "hiaki", team: "2队" }));
  screen("battle");   // 准备着的时候主持人又进了战斗画面（或者一场战斗打完还没回到探索）
  no(send("p1", { type: "duelPick", kit: "helu", team: "1队" }), /先回到探索环节再决斗/, "战斗画面：选队被拒");
  no(send("host", { type: "duelOptions", rounds: 5 }), /先回到探索环节再决斗/, "战斗画面：定选项被拒");
  assert.throws(() => c.HotseatGame.duelSpec(), /先回到探索环节再决斗/, "战斗画面：开始决斗被拒");
  screen("trpg");
  const spec = c.HotseatGame.duelSpec();
  assert.deepEqual(plain(spec.teams), { "1队": ["kolt"], "2队": ["hiaki"] }, "回到探索：照常开始");
});

test("决斗准备画面每队最多 4 人：选了队以后死亡 / 被移出队伍的角色不占名额（#490：以前照样算进人数，名单上 3 / 4 却选不进去，又改不掉那一格）", () => {
  const { send, duel, hero, c } = room({ more: ["ruby", "yuito"] });
  ok(send("host", { type: "duelOpen" }));
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }));
  ok(send("p1", { type: "duelPick", kit: "helu", team: "1队" }));
  ok(send("host", { type: "duelPick", kit: "tou", team: "1队" }));
  ok(send("host", { type: "duelPick", kit: "ruby", team: "1队" }));
  ok(send("p2", { type: "duelPick", kit: "hiaki", team: "2队" }));
  no(send("host", { type: "duelPick", kit: "yuito", team: "1队" }), /1 队已经满 4 人了/, "满 4 人：照旧选不进");
  hero("tou").dead = true;   // 灯在别的战斗里死了：不在准备画面的名单里了
  assert.deepEqual(plain(duel().heroes.filter(h => h.team === "1队").map(h => h.kit).sort()), ["helu", "kolt", "ruby"], "名单上 1 队只剩 3 人");
  ok(send("host", { type: "duelPick", kit: "yuito", team: "1队" }), "1 队现在 3 人：结人选得进");
  const spec = c.HotseatGame.duelSpec();
  assert.deepEqual(plain(spec.teams["1队"]).sort(), ["helu", "kolt", "ruby", "yuito"], "开始决斗：1 队 4 人（死亡的灯不算）");
  no(send("p1", { type: "duelPick", kit: "hiaki", team: "1队" }), /只能给自己操控的角色选队/, "只能给自己操控的角色选：照旧");
});

test("嘲讽对玩家：武器人和持有者共用一次嘲讽——两个都挂着同一个人的嘲讽时，持有者先打了嘲讽者也两个都解除（#490：以前只解除持有者自己，年糕还被嘲讽着）", () => {
  const setup = () => {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], zoneMode: 3, seed: "PVP490-WTAUNT" });
    const S = c.S.state, kolt = c.findKit("kolt", S.units), tou = c.findKit("tou", S.units);
    c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: tou.id });   // 乙和我方默认敌对，都在我方回合行动
    c.startCombat();
    S.units.forEach(u => { if (u.isPlayer) u.zone = 1; });
    c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
    const mochi = c.findKit("mochi", S.units);
    assert.ok(mochi && !mochi.hidden, "年糕上场");
    // 柯尔特的「过度自信」先后打中灯、年糕：两个都挂着柯尔特的嘲讽
    tou.tauntTo = kolt.id; mochi.tauntTo = kolt.id;
    assert.equal(c.playerTauntTarget(tou), kolt);
    assert.equal(c.playerTauntTarget(mochi), kolt);
    return { c, S, kolt, tou, mochi };
  };
  { // 灯（持有者）先打了柯尔特：两个都解除
    const { c, kolt, tou, mochi } = setup();
    tou.ap = 3; tou.bonus = 3;
    const hp = c.totalHp(kolt);
    c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "bare_aa", target: kolt.id });
    assert.ok(c.totalHp(kolt) < hp || tou.ap < 3, "灯真的出手打了柯尔特");
    assert.equal(c.playerTauntTarget(tou), null, "灯解除");
    assert.equal(c.playerTauntTarget(mochi), null, "年糕也解除（共用一次）");
  }
  { // 年糕（武器人）先打了柯尔特：照旧两个都解除
    const { c, kolt, tou, mochi } = setup();
    mochi.ap = 3; mochi.bonus = 3;
    c.Commands.dispatch({ type: "skill", actor: mochi.id, skill: "mochi_aa", target: kolt.id });
    assert.equal(c.playerTauntTarget(tou), null);
    assert.equal(c.playerTauntTarget(mochi), null);
  }
  { // 年糕挂的是别人的嘲讽：灯打了柯尔特不解除年糕那一个
    const { c, kolt, tou, mochi } = setup();
    mochi.tauntTo = "somebody-else";
    c.playerTauntDone(tou, kolt);
    assert.equal(tou.tauntTo, null);
    assert.equal(mochi.tauntTo, "somebody-else", "不是同一个嘲讽者：不动");
  }
});

test("主持人面板「应用分配」换好几个人时一条指令一起改（battle.playerFaction 的 members）：两个人互换阵营不会在中间那一刻被判成战斗结束（#490）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "PVP490-SWAP" });
  const S = c.S.state;
  const [kolt, helu] = ["kolt", "helu"].map(k => c.findKit(k, S.units));
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: helu.id });
  c.startCombat();
  assert.equal(c.pvpSplit(), true);
  assert.equal(c.BattleSim.outcome(), null, "1 对 1：接着打");
  // 一条一条改：中间那一刻两个人在同一个阵营、又没有敌人——会被当成「我方获胜」（房主每条指令后都判一次胜负）
  const one = H.load();
  one.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "PVP490-SWAP" });
  const [k1, h1] = ["kolt", "helu"].map(k => one.findKit(k, one.S.state.units));
  one.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: h1.id });
  one.startCombat();
  one.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: k1.id });
  assert.equal(one.BattleSim.outcome(), "player", "对照：一条一条改，中间那一刻就判了胜负");
  // 一条指令一起改：改完照样是 1 对 1，接着打
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", members: { [kolt.id]: "乙", [helu.id]: "我方" } });
  assert.equal(c.playerFactionOf(kolt), "乙");
  assert.equal(c.playerFactionOf(helu), "我方");
  assert.equal(c.pvpSplit(), true);
  assert.equal(c.BattleSim.outcome(), null, "互换以后照样 1 对 1：不判胜负");
  // 校验：武器人不能单独分、没有的阵营、和 unit 一起给、空的都拒绝，配置不变
  const before = JSON.stringify(S.playerFactions);
  c.Commands.dispatch({ type: "skill", actor: kolt.id, skill: "kolt_summon" });
  const torque = c.findKit("torque", S.units);
  if (torque && !torque.hidden) assert.throws(() => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", members: { [torque.id]: "乙" } }), /weapon units follow their holder/);
  assert.throws(() => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", members: { [kolt.id]: "丁" } }), /没有这个玩家阵营：丁/);
  assert.throws(() => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: kolt.id, members: { [helu.id]: "乙" } }), /unit or members/);
  assert.throws(() => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", members: {} }), /members must be/);
  assert.equal(JSON.stringify(S.playerFactions), before, "被拒的指令不改配置");
  // 面板：换一个人照旧发 unit（和以前一样），换好几个人发一条 members（浏览器里的画法见 tests/pvp-gm-ui.test.js，这里查源码）
  const gm = fs.readFileSync(path.join(H.ROOT, "online-gm-ui.js"), "utf8");
  assert.match(gm, /if \(list\.length <= 1\) return list\.map\(x => \(\{ type: "battle\.playerFaction", faction: x\.faction, unit: x\.unit \}\)\);/);
  assert.match(gm, /return \[\{ type: "battle\.playerFaction", faction: list\[0\]\.faction, members: all \}\];/);
});

/** 主持人分阵营：我方（柯尔特、赫鲁米卡）对敌对的乙（绯秋、灯），没有敌人；乙全员倒地、起不来 → 我方获胜 */
function gmBattle() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [], seed: "PVP490-WIN" });
  const S = c.S.state;
  const [kolt, helu, hiaki, tou] = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", name: "乙队", phase: "enemy" });
  [hiaki, tou].forEach(u => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: u.id }));
  c.startCombat();
  [hiaki, tou].forEach(u => { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = true; u.upOnShp = false; u.shp = 0; });
  return { c, S, kolt, helu, hiaki, tou };
}

test("主持人分阵营按阵营分出胜负：结算带获胜的阵营（只有 id / 名字），联机玩家的结算、公开记录写「X 获胜」，不是人人都「战斗胜利」；普通 PvE 照旧（#490）", () => {
  const { c } = gmBattle();
  assert.deepEqual(plain(c.pvpBattleOutcome().winners), ["我方"]);
  const res = plain(c.settleBattleRewards("win"));
  assert.deepEqual(res.winners, [{ id: "我方", name: "我方" }], "结算带获胜的阵营");
  assert.deepEqual(plain(c.settleBattleRewards("win")).winners, [{ id: "我方", name: "我方" }], "再结算一次（已经结算过）也带着");
  // 联机白名单：只放 id / 名字
  const pr = V.projectPacket({ result: Object.assign({}, res, { outcome: "win" }) }, { recipientId: "p1", gmId: "host" });
  assert.deepEqual(plain(pr.result.winners), [{ id: "我方", name: "我方" }]);
  const junk = V.projectPacket({ result: { outcome: "win", winners: [{ id: "乙", name: "乙队", shp: 99, members: ["x"] }, { id: "丙" }, "我方", null] } }, { recipientId: "p1", gmId: "host" });
  assert.deepEqual(plain(junk.result.winners), [{ id: "乙", name: "乙队" }], "乱塞的字段不放行");
  // 公开记录：哪几个阵营获胜
  const logs = V.projectLogs([{ kind: "victory", winners: ["乙队", "丙队"], turn: 3 }, { kind: "victory", turn: 4 }, { kind: "victory", winners: ["坚毅生命 9"] }]);
  assert.deepEqual(logs.map(l => l.text), ["乙队、丙队 获胜", "战斗胜利", "战斗胜利"], "只认阵营名字；没有的照旧「战斗胜利」");
  // 玩家的结算标题照 winners 写（online-ui.js · resultMarkup，这里查源码）
  const ui = fs.readFileSync(path.join(H.ROOT, "online-ui.js"), "utf8");
  assert.match(ui, /const winners = Array\.isArray\(result\.winners\)[^\n]*\n\s*const heading = duel \?[^\n]*winners\.length \? `\$\{winners\.join\("、"\)\} 获胜`/, "结算标题：有获胜的阵营就写「X 获胜」");
  const og = fs.readFileSync(path.join(H.ROOT, "online-game.js"), "utf8");
  assert.match(og, /value\.winners\.map\(w => w && w\.name\)/, "公开记录的「战斗胜利」带上获胜的阵营名字");
  // 普通 PvE（只有一个玩家阵营）：结算不带 winners，和以前一样
  const p = H.load();
  p.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "PVP490-PVE" });
  p.startCombat();
  p.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
  const pve = plain(p.settleBattleRewards("win"));
  assert.equal("winners" in pve, false, "普通 PvE：不带 winners");
  // 输的一方（全员倒下）也不带
  const { c: c2, kolt, helu } = gmBattle();
  [kolt, helu].forEach(u => { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = true; u.upOnShp = false; u.shp = 0; });
  assert.equal(c2.pvpBattleOutcome().wiped, true);
  assert.equal("winners" in plain(c2.settleBattleRewards("lose")), false, "全员倒下（敌人赢）：不带");
});
