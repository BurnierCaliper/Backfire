// PvP 第二步：主持人分阵营的面板和操控（#464，docs/pvp.md 第 1.1 节、第 5 节）。规则层（玩家阵营、敌友、回合归属、胜负）是第一步（#445 / #456 / #460）。
// 这一份测不用浏览器的部分：
//   · 主持人「加入玩家角色」（gm.addHero / gm.removeHero，gm-commands.js；app.js · spawnHeroCard / removeHeroUnit）：任何一张角色卡，
//     带着角色卡原本的等级、装备、加点（队伍记忆），选区、选阵营；同一张已经在场上不能再加；移出和移出敌人一样；
//     角色卡已经分配给房间里某名玩家的，加进来照旧归他（hotseat-game.js · adoptAddedHero）
// 面板本身（online-gm-ui.js）的画面测试在 tests/pvp-gm-ui.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file }));
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const byId = (S, id) => S.units.find(u => u.id === id);

/** 规则 + 主持人指令：柯尔特、赫鲁米卡上场，狂徒一只。memory = 队伍记忆（game.js · loadCampaignMem 给的那一份） */
function gmField(opt = {}) {
  const c = H.load();
  load(c, ["gm-commands.js"]);
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], zoneMode: 3, seed: opt.seed || "PVP464-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  if (opt.memory) c.BattleCommands.configure({ loadCampaignMem: () => opt.memory });
  const send = cmd => c.Commands.dispatch(plain(cmd), authority);
  return { c, S: c.S.state, send, authority };
}
const faction = (c, cmd) => c.Commands.dispatch(Object.assign({ type: "battle.playerFaction" }, cmd));
const RUBY_MEMORY = { kit: "ruby", level: 7, xp: 30, attrs: { str: 7, con: 6, dex: 9, wil: 6, int: 10, sta: 5 }, attrPoints: 1, attrPicks: ["int"],
  weaponLevels: { mint: 3 }, bonds: { mint: 2 }, feats: ["provoke"], featPoints: 0, shpMax: 20 };

test("加入玩家角色：任何一张角色卡都行——有队伍记忆的带着记忆里的等级、装备、加点，没人用过的按角色卡原样；选加入哪一区、哪个玩家阵营", () => {
  const { c, S, send } = gmField({ memory: { party: [RUBY_MEMORY] } });
  // 阵营要先建好（选的是已有的阵营）
  assert.throws(() => send({ type: "gm.addHero", kit: "ruby", zone: 3, faction: "乙" }), /没有这个玩家阵营/);
  assert.ok(!S.units.some(u => u.kit === "ruby"), "被拒的指令不留下单位");
  faction(c, { faction: "乙", name: "乙队", phase: "enemy" });
  const out = send({ type: "gm.addHero", kit: "ruby", zone: 3, faction: "乙" });
  const ruby = S.units.find(u => u.id === out.id);
  assert.ok(ruby && ruby.isPlayer && ruby.kit === "ruby" && !ruby.weaponOf, "瑞比上场了（玩家角色）");
  assert.equal(ruby.zone, 3, "加入选的那一区");
  assert.equal(c.playerFactionOf(ruby), "乙", "分到选的阵营");
  assert.equal(ruby.level, 7, "等级照队伍记忆");
  assert.deepEqual(plain(ruby.attrs), RUBY_MEMORY.attrs, "加点（属性）照队伍记忆");
  assert.equal(ruby.attrPoints, 1); assert.deepEqual(plain(ruby.attrPicks), ["int"]);
  assert.equal(ruby.weaponLevels.mint, 3, "装备（武器等级）照队伍记忆");
  assert.deepEqual(plain(ruby.feats), ["provoke"], "专长照队伍记忆");
  assert.equal(ruby.weaponHeld, true, "武器拿在手上");
  assert.match(out.publicSummary, /2|3 区加入玩家角色 瑞比 Lv7/);
  // 没人用过的角色卡（队伍记忆里没有）：按角色卡原样（1 级），默认阵营
  const xia = byId(S, send({ type: "gm.addHero", kit: "xia", zone: 1 }).id);
  assert.equal(xia.level, (c.livePartyCards().find(x => x.kit === "xia") || {}).level || 1, "角色卡原本的等级");
  assert.equal(c.playerFactionOf(xia), "我方", "不选阵营 = 默认阵营");
  assert.deepEqual(plain(c.__errors), []);
});

test("加入玩家角色：同一张角色卡已经在场上（含倒下的）不能再加一份；武器的卡、不认识的卡、档案里已经死亡的角色不行；字段校验；只有主持人能发", () => {
  const { c, S, send } = gmField();
  const kolt = c.findKit("kolt", S.units);
  const count = () => S.units.length;
  const n = count();
  assert.throws(() => send({ type: "gm.addHero", kit: "kolt", zone: 1 }), /已经在场上/, "柯尔特在场上：不能再加一份");
  kolt.dead = true; kolt.dying = false;
  assert.throws(() => send({ type: "gm.addHero", kit: "kolt", zone: 1 }), /已经在场上/, "倒下了也还在这一场里");
  kolt.dead = false;
  assert.throws(() => send({ type: "gm.addHero", kit: "mint", zone: 1 }), /没有这张角色卡/, "武器的卡跟着角色进场，不能单独加");
  assert.throws(() => send({ type: "gm.addHero", kit: "nobody", zone: 1 }), /没有这张角色卡/);
  assert.throws(() => send({ type: "gm.addHero", kit: "xia", zone: 4 }), /区域/, "没有 4 区");
  assert.throws(() => send({ type: "gm.addHero", kit: "xia", zone: 1, level: 9 }), /未知字段/, "等级不能自己填：按角色卡");
  c.LEDGER.heroes.xia = { layers: [0], shp: 0, dead: true };
  assert.throws(() => send({ type: "gm.addHero", kit: "xia", zone: 1 }), /已经死亡/, "跑团档案里已经死亡的角色");
  delete c.LEDGER.heroes.xia;
  assert.throws(() => c.Commands.dispatch({ type: "gm.addHero", kit: "xia", zone: 1 }, {}), /主持人/, "不是房间主持人");
  assert.equal(count(), n, "被拒的都没有加人");
  // 同一张卡移出以后可以再加回来
  send({ type: "gm.removeHero", actor: kolt.id });
  const back = send({ type: "gm.addHero", kit: "kolt", zone: 2 });
  assert.equal(S.units.filter(u => u.kit === "kolt" && !u.weaponOf).length, 1, "移出以后能再加，场上只有一份");
  assert.ok(back.id && back.id !== kolt.id);
});

test("加入玩家角色：开战以后加进来的——所在阵营正好在这个回合行动就补满行动点 / 附赠，不然到它自己的回合开始时再补；跑团档案记着的伤势照档案", () => {
  const { c, S, send } = gmField();
  faction(c, { faction: "乙", phase: "enemy" });
  c.LEDGER.heroes.tou = { layers: [5], shp: 7, dead: false, dying: false };
  c.startCombat();
  const xia = byId(S, send({ type: "gm.addHero", kit: "xia", zone: 1 }).id);
  assert.ok(xia.ap > 0 && xia.ap === xia.apMax && xia.bonus === xia.bonusMax, "我方回合加进「我方」：马上能动");
  const tou = byId(S, send({ type: "gm.addHero", kit: "tou", zone: 3, faction: "乙" }).id);
  assert.equal(tou.ap, 0, "我方回合加进在敌人回合行动的乙：现在不能动");
  assert.equal(tou.bonus, 0);
  assert.equal(tou.layers[0].current, 5, "跑团档案里的伤势照档案（和开战摆队伍一样）");
  c.endPlayerTurn();
  assert.ok(tou.ap > 0, "敌人回合开始时补上");
});

test("移出玩家角色：和移出敌人一样不算击杀；武器人跟着一起离场，分到的阵营去掉，指向它的嘲讽失效；敌人 / 武器人不能用这个指令移出", () => {
  const { c, S, send } = gmField({ party: ["kolt", "tou"] });
  const kolt = c.findKit("kolt", S.units), tou = c.findKit("tou", S.units), thug = S.units.find(u => !u.isPlayer);
  c.startCombat();
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden, "年糕上场");
  faction(c, { faction: "乙", unit: tou.id });
  thug.tauntTo = tou.id;
  assert.throws(() => send({ type: "gm.removeHero", actor: thug.id }), /只能移出玩家角色/, "敌人用「移出」敌人");
  assert.throws(() => send({ type: "gm.removeHero", actor: mochi.id }), /只能移出玩家角色/, "武器人跟着角色，不能单独移出");
  const before = logText(c);
  const out = send({ type: "gm.removeHero", actor: tou.id });
  assert.deepEqual(plain(out.ids).sort(), [tou.id, mochi.id].sort(), "灯和年糕一起离场");
  assert.ok(!S.units.some(u => u.id === tou.id || u.id === mochi.id));
  assert.ok(!(tou.id in S.playerFactions.members), "分到的阵营去掉了");
  assert.equal(thug.tauntTo, null, "指向它的嘲讽失效");
  assert.match(out.publicSummary, /移出 灯/);
  assert.doesNotMatch(logText(c).slice(before.length), /倒下|死亡|击杀/, "不算击杀、不触发倒下");
  assert.ok(S.units.includes(kolt));
});

/** 联机房主（online-game.js 的协调，转发连接、演出换成确定的假件；和 tests/online-host.test.js 同一套搭法）：房间里主持人 host、玩家 p2 */
async function onlineHost() {
  const c = H.load(), sends = [], errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "PVP464-ONLINE" });
  let message, statusListener;
  const status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }, { id: "p2", role: "player", name: "玩家", online: true }] };
  c.console = { error: e => errors.push(String(e)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 1; c.queueMicrotask = queueMicrotask; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    refresh() {}, disarm() {}, resumeHotseat() {}, checkEnd() {}, onlineCheckpoint: () => plain({ state }), restoreOnline() {}, resumeOnline: async () => {},
    async actSystem(cmd, meta, context) { this.depth++; try { const value = c.HotseatGame.system(cmd, context); c.OnlineGame.onActionSettled(cmd, value, [], meta); return value; } finally { this.depth--; } } };
  c.Screens = { current: () => "battle", is: screen => screen === "battle" };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  c.OnlineView = { projectPacket: p => plain({ ...p, displayOnly: true }), projectLogs: rows => plain(rows) };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: "backfire-d3-v1", protocol: 1 }),
    onMessage(fn) { message = fn; }, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async (packet, recipient) => { sends.push({ packet: plain(packet), recipient }); return { ok: true }; },
    async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  load(c, ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-wire.js", "online-game.js"]);
  await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  c.OnlineGame.start();
  const heroes = state.units.filter(u => u.isPlayer && !u.weaponOf);
  c.OnlineGame.assign(Object.fromEntries(heroes.map(u => [u.id, u.kit === "kolt" ? "p2" : "host"])));
  // 玩家发来的指令包（requestId 递增）；等房主回 ack
  let requestId = 0;
  const fromPlayer = async command => {
    const id = ++requestId, before = sends.length;
    await message({ type: "cmd", requestId: id, command, protocol: 1, build: "backfire-d3-v1" }, "p2");
    for (let i = 0; i < 50 && !sends.slice(before).some(s => s.packet.type === "ack" && s.packet.requestId === id); i++) await new Promise(r => setTimeout(r, 5));
    return (sends.slice(before).find(s => s.packet.type === "ack" && s.packet.requestId === id) || {}).packet;
  };
  return { c, state, heroes, errors, fromPlayer, publicLogs: () => c.OnlineGame.getView().packet.publicLogs };
}

test("联机房主：主持人面板发的 battle.playerFaction 和主持人指令一样走结算流程（改了立刻生效、公开记录只写「调整了战场」）；不合法的退回规则层的原因、不进结算；玩家发不了", async () => {
  const f = await onlineHost();
  const { c, state, heroes } = f, kolt = heroes.find(u => u.kit === "kolt");
  c.HotseatGame.startCombat(); c.HotseatGame.beginRound();
  const ok = await c.OnlineGame.submit({ type: "battle.playerFaction", faction: "乙", name: "乙队", phase: "enemy", unit: kolt.id });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(c.playerFactionOf(kolt), "乙", "改了立刻生效");
  assert.equal(c.playerFactionInfo("乙").phase, "enemy");
  assert.equal(f.publicLogs().at(-1).summary, "主持人调整了战场", "公开记录不写谁和谁敌对");
  // 不合法：规则层的原因原样退回，状态不变，也不当成「房主遇到处理错误」
  const before = plain(state.playerFactions);
  const bad = await c.OnlineGame.submit({ type: "battle.playerFaction", faction: "我方", remove: true });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不能删/);
  const unknown = await c.OnlineGame.submit({ type: "battle.playerFaction", faction: "乙", other: "丁", hostile: true });
  assert.match(unknown.error, /没有这个玩家阵营/);
  assert.deepEqual(plain(state.playerFactions), before, "被拒的不留下改动");
  assert.equal(c.OnlineGame.getView().packet.systemNotice, "", "没有「房主遇到处理错误」");
  // 玩家发不了
  const fromP2 = await f.fromPlayer({ type: "battle.playerFaction", faction: "乙", unit: heroes.find(u => u.kit === "ruby").id });
  assert.equal(fromP2.ok, false);
  assert.match(fromP2.error, /只有主持人/);
  assert.equal(c.playerFactionOf(heroes.find(u => u.kit === "ruby")), "我方");
  // 加入玩家角色也从这条路走：公开记录写「在 X 区加入 谁 Lv」
  const add = await c.OnlineGame.submit({ type: "gm.addHero", kit: "xia", zone: 1, faction: "乙" });
  assert.equal(add.ok, true, add.error);
  const row = f.publicLogs().at(-1);
  assert.deepEqual([row.action, row.unitName, row.zone], ["spawn", "夕夏", 1]);
  assert.equal(typeof row.level, "number");
  assert.equal((await c.OnlineGame.submit({ type: "gm.removeHero", actor: state.units.find(u => u.kit === "xia").id })).ok, true);
  assert.deepEqual([f.publicLogs().at(-1).action, f.publicLogs().at(-1).unitName], ["remove", "夕夏"]);
  assert.deepEqual(f.errors, []);
});

/** 热座 / 联机（房主的 hotseat-game.js，真的会话和校验）：p1 主持人，p2 玩家。主持人指令照联机的路走 HotseatGame.system */
function hotseat(opt = {}) {
  const f = gmField({ party: opt.party || ["kolt", "helu"], seed: opt.seed || "PVP464-HS" });
  const { c } = f;
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1;
  c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  load(c, ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]);
  const S = c.S.state, units = (opt.party || ["kolt", "helu"]).map(k => c.findKit(k, S.units));
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }, { id: "p3", name: "玩家 3" }];
  const assignments = opt.assignments ? opt.assignments(units) : { [units[0].id]: "p1", [units[1].id]: "p2" };
  assert.deepEqual(plain(c.HotseatGame.configure({ mode: "trpg", players, assignments })), { ok: true });
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(command); };
  const gm = command => c.HotseatGame.system(plain(command), f.authority);
  const owner = u => (c.HotseatGame.getView().heroes.find(h => h.id === u.id) || {}).owner;
  return Object.assign(f, { S, units, send, gm, owner });
}

test("热座 / 联机：加进来的角色卡已经分配给房间里某名玩家的，照旧归他操控；没分配过的归主持人；主持人可以照常转交", () => {
  const f = hotseat();
  const { c, S, units: [kolt, helu], send, gm, owner } = f;
  assert.equal(owner(helu), "p2");
  assert.equal(send("p1", { type: "startCombat" }).ok, true);
  c.HotseatGame.beginRound();
  // 赫鲁米卡（玩家 2 的角色）移出战场再加回来：照旧归玩家 2
  gm({ type: "gm.removeHero", actor: helu.id });
  assert.ok(!c.HotseatGame.getView().heroes.some(h => h.id === helu.id));
  const back = byId(S, gm({ type: "gm.addHero", kit: "helu", zone: 1 }).id);
  assert.equal(owner(back), "p2", "房间里有人在用的角色：照旧由那名玩家操控");
  // 没人用过的角色卡：主持人操控
  const xia = byId(S, gm({ type: "gm.addHero", kit: "xia", zone: 1 }).id);
  assert.equal(owner(xia), "p1", "没分配过的归主持人");
  // 加进来的人排进这一回合的行动顺序（我方回合行动的阵营），玩家 2 能给自己的选格子、不能替主持人的选
  const roster = plain(c.HotseatGame.getView().units.map(r => r.id));
  assert.ok(roster.includes(back.id) && roster.includes(xia.id), "加进来的排进行动顺序");
  assert.equal(send("p2", { type: "orderPick", actor: back.id, index: 0 }).ok, true, "玩家 2 给赫鲁米卡选格子");
  assert.equal(send("p2", { type: "orderPick", actor: xia.id, index: 1 }).ok, false, "夕夏归主持人");
  // 主持人照常能转交（战斗中转交）
  assert.equal(c.HotseatGame.transferHero(xia.id, "p3").ok, true);
  assert.equal(owner(xia), "p3");
  assert.ok(kolt);
});

test("热座 / 联机（自查）：只有「加入玩家角色」（gm.addHero）照角色卡原来的操控者；战场配置「加入队员」（battle.panel addParty）加进来的照旧归主持人——和以前一样", () => {
  const f = hotseat();
  const { c, S, units: [, helu], send, gm } = f;
  const operator = id => (c.HotseatGame.getView().units.find(r => r.id === id) || {}).owner;   // 会话里真正的操控者（行动顺序那一份）
  assert.equal(send("p1", { type: "startCombat" }).ok, true);
  c.HotseatGame.beginRound();
  assert.equal(operator(helu.id), "p2");
  gm({ type: "gm.removeHero", actor: helu.id });
  const ack = send("p1", { type: "battle.panel", action: "addParty", kit: "helu", zone: 1 });
  assert.equal(ack.ok, true, ack.error);
  const back = S.units.find(u => u.kit === "helu" && !u.weaponOf);
  assert.ok(back && back.id !== helu.id);
  assert.equal(operator(back.id), "p1", "加入队员：照旧归主持人（以前加进来的人没分配过就是主持人的）");
  // 换成「加入玩家角色」：照旧归玩家 2
  gm({ type: "gm.removeHero", actor: back.id });
  const again = byId(S, gm({ type: "gm.addHero", kit: "helu", zone: 1 }).id);
  assert.equal(operator(again.id), "p2", "加入玩家角色：照角色卡原来的操控者");
});
