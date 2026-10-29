// PvP 第三步：决斗——联机的申请、同意、主持人开启、准备画面（选队、选项）和白名单（#472，docs/pvp.md 第 1.2 节）。
// 会话规则在 hotseat.js · requestDuel / decideDuel / openDuel / pickDuel / setDuelOptions / closeDuel（table.duel），
// 联机桥在 hotseat-game.js（duel* 指令只在探索环节放行、选队按角色分配查操控者、duelView / duelSpec），
// 白名单在 online-view.js（projectView 的 duel、projectUnit 的 pvpOut、publicResult 的 duel / teams、projectState 的 duel、projectLogs 的 duel）。
// 主持人点「开始决斗」布置战场、打完回到探索在 tests/pvp-duel-ui.test.js（真的 game.html）
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

/** 联机跑团房间：主持人 host、玩家甲 p1（柯尔特、赫鲁米卡）、玩家乙 p2（绯秋）；灯、opt.more 的角色没分配（归主持人）。在探索环节 */
function room(opt = {}) {
  const party = ["kolt", "helu", "hiaki", "tou"].concat(opt.more || []);
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "DUEL472-ONLINE" });
  c.S.TRPG.active = true;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) load(c, f);
  const st = c.S.state, hero = k => st.units.find(u => u.kit === k);
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p1", name: "甲" }, { id: "p2", name: "乙" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [hero("kolt").id]: "p1", [hero("helu").id]: "p1", [hero("hiaki").id]: "p2" } }).ok, true);
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(cmd));
  const view = who => V.projectView(plain(c.HotseatGame.getViewFor(who)), { recipientId: who });
  const duel = () => c.HotseatGame.getView().duel;
  const chat = () => c.HotseatGame.getView().chat.map(m => m.text).join("\n");
  return { c, st, hero, send, view, duel, chat };
}
const ok = (ack, msg) => assert.equal(ack.ok, true, (msg || "") + "：" + ack.error);
const byKit = list => plain(list).slice().sort((a, b) => String(a.kit || a[0]).localeCompare(String(b.kit || b[0])));
// 坚毅生命的数值 / 字段（upOnShp 是公开的「起身中」，不算）
const LEAK = /732911|827319|617392|321987|"shp|坚毅|restore/;
const no = (ack, re, msg) => { assert.equal(ack.ok, false, msg); if (re) assert.match(ack.error, re, msg); };

test("玩家申请发起决斗 → 主持人同意 → 准备画面：各人只能给自己操控的角色选队（没分配的归主持人选），主持人定选项；房主拿到两队和选项", () => {
  const { c, send, duel, chat, view } = room();
  assert.equal(duel(), null, "一开始没有决斗");
  no(send("host", { type: "duelRequest" }), /主持人直接开启/, "主持人不用申请");
  ok(send("p1", { type: "duelRequest" }), "甲申请");
  assert.equal(duel().status, "asked");
  assert.equal(duel().by, "p1");
  assert.equal(duel().byName, "甲");
  assert.match(chat(), /甲 申请发起决斗，等主持人同意/);
  no(send("p2", { type: "duelRequest" }), /已经有人申请了决斗/, "同一时间只有一场");
  no(send("p2", { type: "duelDecide", decision: "approve" }), /只有主持人/, "玩家不能同意");
  no(send("p2", { type: "duelDecide", decision: "cancel" }), /只能撤回自己的申请/, "乙撤不了甲的申请");
  no(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }), /还没开始准备/, "还没同意不能选队");
  ok(send("host", { type: "duelDecide", decision: "approve" }), "主持人同意");
  assert.equal(duel().status, "prep");
  assert.match(chat(), /主持人同意了 甲 的决斗申请：大家选进 1 队或 2 队/);
  // 准备画面：每名角色写着归谁
  assert.deepEqual(byKit(duel().heroes.map(h => [h.kit, h.owner, h.team])), byKit([["kolt", "p1", null], ["helu", "p1", null], ["hiaki", "p2", null], ["tou", "host", null]]));
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }));
  ok(send("p1", { type: "duelPick", kit: "helu", team: "1队" }));
  no(send("p1", { type: "duelPick", kit: "hiaki", team: "1队" }), /只能给自己操控的角色选队/, "甲不能替乙选");
  ok(send("p2", { type: "duelPick", kit: "hiaki", team: "2队" }));
  no(send("host", { type: "duelPick", kit: "kolt", team: "2队" }), /只能给自己操控的角色选队/, "主持人也不能替玩家选");
  ok(send("host", { type: "duelPick", kit: "tou", team: "2队" }), "主持人给没分配的灯选");
  no(send("p1", { type: "duelPick", kit: "kolt", team: "3队" }), /没有这一队/);
  no(send("p1", { type: "duelPick", kit: "nobody", team: "1队" }), /没有这名角色/);
  // 改主意：不参加，再选回来
  ok(send("p1", { type: "duelPick", kit: "helu", team: null }));
  assert.equal(duel().heroes.find(h => h.kit === "helu").team, null);
  ok(send("p1", { type: "duelPick", kit: "helu", team: "1队" }));
  // 选项：只有主持人能定；默认允许起身、不限回合
  assert.equal(duel().stand, true);
  assert.equal(duel().rounds, null);
  no(send("p1", { type: "duelOptions", stand: false }), /只有主持人/, "玩家不能定选项");
  no(send("host", { type: "duelOptions", rounds: 0 }), /回合数要在 1 到 99 之间/);
  no(send("host", { type: "duelOptions", stand: "no" }), /允许起身只能是开或关/);
  ok(send("host", { type: "duelOptions", stand: false }));
  ok(send("host", { type: "duelOptions", rounds: 10 }));
  assert.equal(duel().stand, false);
  assert.equal(duel().rounds, 10);
  ok(send("host", { type: "duelOptions", rounds: null }), "关掉回合上限");
  assert.equal(duel().rounds, null);
  ok(send("host", { type: "duelOptions", rounds: 12 }));
  // 房主开始决斗时拿到的：两队（角色 kit）和选项
  const spec = plain(c.HotseatGame.duelSpec());
  assert.deepEqual(spec.teams["1队"].slice().sort(), ["helu", "kolt"]);
  assert.deepEqual(spec.teams["2队"].slice().sort(), ["hiaki", "tou"]);
  assert.equal(spec.stand, false);
  assert.equal(spec.rounds, 12);
  // 玩家的画面看得到同样的东西（白名单）
  const pv = plain(view("p2").duel);
  assert.deepEqual(Object.assign({}, pv, { heroes: null }), { id: duel().id, status: "prep", by: "p1", byName: "甲", at: duel().at, stand: false, rounds: 12, heroes: null });
  assert.deepEqual(byKit(pv.heroes), byKit([{ kit: "kolt", owner: "p1", name: "柯尔特", team: "1队" }, { kit: "helu", owner: "p1", name: "Helumica", team: "1队" }, { kit: "hiaki", owner: "p2", name: "绯秋", team: "2队" }, { kit: "tou", owner: "host", name: "灯", team: "2队" }]));
  // 开打了：准备画面收起，频道里写一句
  c.HotseatGame.duelStarted("决斗开始：测试");
  assert.equal(duel(), null);
  assert.match(chat(), /决斗开始：测试/);
});

test("选队上限：每队最多 4 人（两队人数可以不一样），满了的那一队选不进；开打要每队至少 1 人", () => {
  const { c, send, duel } = room({ more: ["ruby", "yuito"] });
  ok(send("host", { type: "duelOpen" }), "主持人直接开启");
  assert.equal(duel().status, "prep");
  for (const k of ["tou", "ruby", "yuito"]) ok(send("host", { type: "duelPick", kit: k, team: "1队" }));
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }), "第 4 人");
  no(send("p1", { type: "duelPick", kit: "helu", team: "1队" }), /1 队已经满 4 人了/, "第 5 人选不进");
  assert.throws(() => c.HotseatGame.duelSpec(), /2 队至少要 1 人才能开打/, "2 队没人：开不了");
  ok(send("p1", { type: "duelPick", kit: "helu", team: "2队" }), "4 对 1 可以");
  const teams = plain(c.HotseatGame.duelSpec().teams);
  assert.deepEqual(teams["1队"].slice().sort(), ["kolt", "ruby", "tou", "yuito"]);
  assert.deepEqual(teams["2队"], ["helu"]);
  // 腾出一个位置就又能选进
  ok(send("host", { type: "duelPick", kit: "yuito", team: null }));
  ok(send("p2", { type: "duelPick", kit: "hiaki", team: "1队" }));
  assert.equal(duel().heroes.filter(h => h.team === "1队").length, 4);
});

test("主持人开启 / 取消；玩家撤回申请；主持人不同意；有人申请时主持人开启就是同意；准备中不能再申请", () => {
  const { send, duel, chat } = room();
  ok(send("host", { type: "duelOpen" }));
  assert.match(chat(), /主持人开启了决斗：大家选进 1 队或 2 队/);
  no(send("p1", { type: "duelRequest" }), /决斗已经在准备了/);
  no(send("host", { type: "duelOpen" }), /决斗已经在准备了/);
  no(send("p1", { type: "duelDecide", decision: "cancel" }), /只能撤回自己的申请/, "玩家不能取消主持人开的");
  ok(send("host", { type: "duelDecide", decision: "cancel" }));
  assert.equal(duel(), null);
  assert.match(chat(), /主持人取消了决斗/);
  ok(send("p1", { type: "duelRequest" }));
  ok(send("p1", { type: "duelDecide", decision: "cancel" }), "甲撤回");
  assert.equal(duel(), null);
  assert.match(chat(), /甲 撤回了决斗申请/);
  ok(send("p2", { type: "duelRequest" }));
  ok(send("host", { type: "duelDecide", decision: "reject" }));
  assert.equal(duel(), null);
  assert.match(chat(), /主持人没有同意 乙 的决斗申请/);
  ok(send("p2", { type: "duelRequest" }));
  ok(send("host", { type: "duelOpen" }), "有人申请时主持人开启 = 同意");
  assert.equal(duel().status, "prep");
  assert.equal(duel().by, "p2");
  no(send("host", { type: "duelDecide", decision: "bogus" }), /没有这种处理/);
});

test("只在探索环节：开战以后（战斗中）不能申请、开启、选队；死掉的角色不能参加", () => {
  const { st, send, duel, hero } = room();
  hero("tou").dead = true;
  ok(send("host", { type: "duelOpen" }));
  assert.ok(!duel().heroes.some(h => h.kit === "tou"), "死掉的灯不在名单里");
  no(send("host", { type: "duelPick", kit: "tou", team: "1队" }), /没有这名角色/);
  st.combatStarted = true;
  no(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }), /战斗中不能决斗/);
  no(send("host", { type: "duelDecide", decision: "cancel" }), /战斗中不能决斗/);
  st.combatStarted = false;
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }));
});

test("房主刷新恢复房间：准备画面（谁申请的、选好的队、选项）跟着会话的检查点留着", () => {
  const { c, send, duel } = room();
  ok(send("p1", { type: "duelRequest" }));
  ok(send("host", { type: "duelDecide", decision: "approve" }));
  ok(send("p1", { type: "duelPick", kit: "kolt", team: "1队" }));
  ok(send("host", { type: "duelOptions", rounds: 7 }));
  const saved = plain(c.HotseatGame.checkpoint());
  const before = plain(duel());
  c.HotseatGame.restoreOnline(saved);
  assert.deepEqual(plain(duel()), before, "恢复以后一样");
  ok(send("p2", { type: "duelPick", kit: "hiaki", team: "2队" }), "接着选");
});

test("白名单：准备画面只发角色 kit / 名字 / 操控者 / 选的队和选项；战斗里只发允许起身、回合上限、先手；再起不能只发这个状态；结算发胜负和各阵营的分数——坚毅数值一个都不发", () => {
  // 准备画面
  const { c, st, send, view } = room();
  st.units.filter(u => u.isPlayer).forEach((u, i) => { u.shp = 732911 + i; u.shpMax = 827319 + i; u.shpBase = 617392; u.shpBonus = 321987; });
  ok(send("p1", { type: "duelRequest" }));
  ok(send("host", { type: "duelDecide", decision: "approve" }));
  const raw = JSON.stringify(view("p2"));
  assert.doesNotMatch(raw, LEAK);
  assert.deepEqual(Object.keys(view("p2").duel).sort(), ["at", "by", "byName", "heroes", "id", "rounds", "stand", "status"]);
  assert.deepEqual(Object.keys(view("p2").duel.heroes[0]).sort(), ["kit", "name", "owner"], "没选队的人没有 team");
  // 乱塞的字段不放行
  const fake = V.projectView({ duel: { status: "prep", id: "duel-1", stand: true, rounds: 5, heroes: [{ kit: "kolt", name: "柯尔特", owner: "p1", team: "3队", shp: 99, layers: [1] }], restore: { shp: 5 } } }, { recipientId: "p1" });
  assert.deepEqual(plain(fake.duel), { status: "prep", id: "duel-1", stand: true, rounds: 5, heroes: [{ kit: "kolt", owner: "p1", name: "柯尔特" }] });
  assert.equal(V.projectView({ duel: { status: "bogus" } }, { recipientId: "p1" }).duel, undefined);

  // 战斗：state.pvpDuel 只放行三样，决斗前的坚毅（restore）不发；再起不能只发 pvpOut
  const d = H.load();
  d.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "DUEL472-WL" });
  const S = d.S.state, h = k => d.findKit(k, S.units);
  d.LEDGER.heroes = { kolt: { layers: [3, 4], shp: 732911, dying: false, dead: false, upOnShp: false } };
  d.Commands.dispatch({ type: "battle.duel", teams: { "1队": [h("kolt").id, h("helu").id], "2队": [h("hiaki").id, h("tou").id] }, stand: false, rounds: 8 });
  d.Math.random = () => 0.9;
  d.startCombat();
  S.units.filter(u => u.isPlayer).forEach(u => { u.shp = 827319; });
  const hiaki = h("hiaki"), kolt = h("kolt");
  (hiaki.layers || []).forEach(l => { l.current = 0; }); hiaki.upOnShp = true; hiaki.shp = 2; hiaki.zone = kolt.zone;
  d.dealTo(kolt, hiaki, { atk: 0, mult: 0, flat: 40, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(hiaki.pvpOut, true);
  const ps = V.projectState(plain(S));
  assert.deepEqual(ps.duel, { stand: false, rounds: 8, first: "2队" });
  const pu = ps.units.find(u => u.id === hiaki.id);
  assert.equal(pu.pvpOut, true, "再起不能：只发这个状态");
  assert.equal(pu.hidden, true, "移出了战场");
  assert.doesNotMatch(JSON.stringify(ps), LEAK);
  // 演出带里的「再起不能」字
  const pop = (S.floaters || []).find(f => f.text === "再起不能");
  assert.ok(pop);
  const tape = V.projectTape([{ type: "pop", kind: "status", unitId: hiaki.id, text: "再起不能", element: "physical" }], { state: plain(S) });
  assert.equal(tape[0].text, "再起不能");

  // 结算：胜负（哪一队 / 平局、怎么分出的、回合上限的剩余血量百分比）和各阵营的分数
  S.pvpDuel.result = { over: true, winner: null, draw: true, why: "rounds", rounds: 8, pct: { "1队": 0.5, "2队": 0.5 } };
  const settled = plain(d.settleBattleRewards("draw"));
  const pr = V.projectPacket({ result: Object.assign({}, settled, { outcome: "draw" }), state: plain(S) }, { recipientId: "p1", gmId: "host" });
  assert.equal(pr.result.outcome, "draw");
  assert.deepEqual(pr.result.duel, { draw: true, why: "rounds", pct: { "1队": 0.5, "2队": 0.5 }, rounds: 8 });
  assert.deepEqual(pr.result.teams.map(t => t.name), ["1 队", "2 队"], "一分没拿的那一队也列出来");
  // 打进坚毅的伤害也照算（作者 10/29，PVP_TEAM_SCORE.shpCounts）；打倒（再起不能）算击杀。发出去的只有分值，没有坚毅数值（下面 LEAK 检查）
  assert.equal(pr.result.teams[0].parts.kill, d.S.SCORE_RULES.kill.elite, "打倒（再起不能）算击杀");
  assert.ok(pr.result.teams[0].parts.dmg > 0, "打进坚毅的伤害照算");
  assert.deepEqual(Object.keys(pr.result.teams[0].parts).sort(), ["dmg", "kill"]);
  assert.deepEqual(plain(pr.result.teams[1]), { id: "2队", name: "2 队", total: 0, parts: {} });
  for (const t of pr.result.teams) assert.deepEqual(Object.keys(t).sort(), ["id", "name", "parts", "total"]);
  assert.doesNotMatch(JSON.stringify(pr), LEAK);
  // 乱塞的字段不放行
  const junk = V.projectPacket({ result: { outcome: "draw", duel: { result: { over: true, winner: "3队", why: "x", pct: { "1队": 5, shp: 1 } }, restore: { shp: 1 } }, teams: [{ id: "1队", name: "1 队", total: 9, parts: { dmg: 3, shp: 9, bonus: 4 } }] } }, { recipientId: "p1", gmId: "host" });
  assert.deepEqual(plain(junk.result.duel), { draw: false, pct: { "1队": 1 } });
  assert.deepEqual(plain(junk.result.teams), [{ id: "1队", name: "1 队", total: 9, parts: { dmg: 3 } }]);

  // 公开记录：决斗开始、抛硬币谁先手、哪一队赢 / 平局（只认事件名和队伍 id）
  const logs = V.projectLogs([{ kind: "duel", event: "start" }, { kind: "duel", event: "toss", first: "2队" }, { kind: "duel", event: "end", winner: "1队", why: "wipe" },
    { kind: "duel", event: "end", winner: null, why: "rounds" }, { kind: "duel", event: "toss", first: "坚毅 9" }, { kind: "duel", event: "x" }]).map(l => l.text);
  assert.deepEqual(logs, ["决斗开始", "抛硬币：2 队先手（我方回合行动），1 队后手（敌人回合行动）", "1 队获胜", "回合上限到了，按剩余血量百分比：平局"]);
});

test("指令清单：决斗的申请 / 同意 / 开启 / 选队 / 选项是玩家能发的指令（online-game.js 的 controls、hotseat-game.js 的 tableTypes），开始决斗只有主持人（trpg.ui）", () => {
  const og = fs.readFileSync(path.join(H.ROOT, "online-game.js"), "utf8"), hg = fs.readFileSync(path.join(H.ROOT, "hotseat-game.js"), "utf8");
  for (const t of ["duelRequest", "duelDecide", "duelOpen", "duelPick", "duelOptions"]) {
    assert.ok(new RegExp(`controls = new Set\\(\\[[^\\]]*"${t}"`).test(og), t + "：玩家能发");
    assert.ok(new RegExp(`tableTypes = new Set\\(\\[[^\\]]*"${t}"`).test(hg), t + "：不受战斗阶段、询问影响（会话自己查探索环节）");
  }
  assert.ok(!/controls = new Set\(\[[^\]]*"(toDuel|battle\.duel)"/.test(og), "开始决斗、布置决斗玩家发不了");
  // 玩家发 trpg.ui / battle.duel：房主拒绝
  const { send } = room();
  no(send("p1", { type: "trpg.ui", action: "toDuel" }), /只有房主/);
  no(send("p1", { type: "battle.duel", teams: { "1队": ["a"], "2队": ["b"] } }), /只有房主|这条指令只能由房主/);
});
