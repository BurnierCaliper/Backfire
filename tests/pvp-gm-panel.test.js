// PvP 第二步：主持人分阵营的面板和操控（#464，docs/pvp.md 第 1.1 节、第 5 节）。规则层（玩家阵营、敌友、回合归属、胜负）是第一步（#445 / #456 / #460）。
// 这一份测不用浏览器的部分：
//   · 主持人「加入玩家角色」（gm.addHero / gm.removeHero，gm-commands.js；app.js · spawnHeroCard / removeHeroUnit）：任何一张角色卡，
//     带着角色卡原本的等级、装备、加点（队伍记忆），选区、选阵营；同一张已经在场上不能再加；移出和移出敌人一样；
//     角色卡已经分配给房间里某名玩家的，加进来照旧归他（hotseat-game.js · adoptNewHeroes）
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
