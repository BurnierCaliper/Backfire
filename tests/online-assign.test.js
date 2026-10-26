// 联机跑团角色分配：不在场的角色重新配置时不被清掉；取消「每名玩家一名角色」限制；自己的几个单位在顺序锁定前可以自由换位
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
function load(c, name) { vm.runInContext(fs.readFileSync(path.join(H.ROOT, name), "utf8"), c, { filename: name }); }
function fixture(party) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "ASSIGN" });
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) load(c, f);
  const byKit = k => c.S.state.units.find(u => u.kit === k && !u.weaponOf);
  const owners = () => Object.fromEntries(c.HotseatGame.getView().heroes.map(h => [c.S.state.units.find(u => u.id === h.id).kit, h.owner]));
  return { c, byKit, owners };
}
const P = (...ids) => [{ id: "host", name: "主持人", gm: true }, ...ids.map(id => ({ id, name: id }))];

test("不在这场战斗里的角色：有人进 / 出房间重新配置后，分配不被清掉", () => {
  const { c, byKit, owners } = fixture();
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2", "p3"), assignments: { [byKit("ruby").id]: "p2", [byKit("helu").id]: "p3" } }).ok, true);
  // 主持人开一场只有赫露的战斗（瑞比不在场）
  c.BattleSim.setup({ party: ["helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "ASSIGN-2" });
  // 打完后有新玩家进房间：online-game.js · setupOperators 按场上英雄现有的操控者重新配置
  const now = Object.fromEntries(c.HotseatGame.getView().heroes.map(h => [h.id, h.owner]).filter(([, o]) => o !== "host"));
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2", "p3", "p4"), assignments: now }).ok, true);
  // 回到全队
  c.BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "ASSIGN-3" });
  c.HotseatGame.syncAssignments();
  assert.deepEqual(owners(), { ruby: "p2", helu: "p3", kolt: "host" });
  // 离开房间（座位释放）的玩家，他的不在场角色回到主持人
  c.BattleSim.setup({ party: ["helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "ASSIGN-4" });
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("p3", "p4"), assignments: { [byKit("helu").id]: "p3" } }).ok, true);
  c.BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "ASSIGN-5" });
  c.HotseatGame.syncAssignments();
  assert.deepEqual(owners(), { ruby: "host", helu: "p3", kolt: "host" });
});

test("取消 #165 限制：主持人可以把几名角色分给同一名在线玩家", () => {
  const { c, byKit, owners } = fixture();
  const ack = c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2"), assignments: { [byKit("ruby").id]: "p2", [byKit("helu").id]: "p2" } });
  assert.equal(ack.ok, true, ack.error);
  assert.deepEqual(owners(), { ruby: "p2", helu: "p2", kolt: "host" });
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2"), assignments: { [byKit("ruby").id]: "p2", [byKit("helu").id]: "p2", [byKit("kolt").id]: "p2" } }).ok, true);
  assert.deepEqual(owners(), { ruby: "p2", helu: "p2", kolt: "p2" });
});

test("同一名玩家的几个单位：顺序锁定前自由换位；和别人的单位换位要对方同意", () => {
  const { c, byKit } = fixture();
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2", "p3"), assignments: { [byKit("ruby").id]: "p2", [byKit("helu").id]: "p2", [byKit("kolt").id]: "p3" } }).ok, true);
  const s = c.Hotseat.create({ operators: P("p2", "p3"), gmId: "host", mode: "trpg",
    assignments: { [byKit("ruby").id]: "p2", [byKit("helu").id]: "p2", [byKit("kolt").id]: "p3" }, getUnits: () => c.S.state.units, canStand: () => true });
  s.beginRound(1);
  const ids = ["ruby", "helu", "kolt"].map(k => byKit(k).id);
  s.pick("p2", ids[0], 0); s.pick("p2", ids[1], 1); s.pick("p3", ids[2], 2);
  const slotIds = () => plain(s.snapshot().slots.map(r => r && r.unitId));
  assert.equal(s.move("p2", ids[0], 1).status, "moved", "自己的两个单位直接互换");
  assert.deepEqual(slotIds(), [ids[1], ids[0], ids[2]]);
  assert.equal(s.move("p2", ids[0], 2).status, "pending", "和别人的单位换要对方同意");
  assert.deepEqual(slotIds(), [ids[1], ids[0], ids[2]]);
  assert.throws(() => s.move("p2", ids[2], 0), /不是你的角色/);
});
