// 联机跑团规则层：主持人暗骰检定（不发给玩家）、玩家主动申请检定（主持人同意后房主掷）、战斗模板「Lv随队」= 队伍等级
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
function fixture() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "TRPG-RULES" });
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) load(c, f);
  const st = c.S.state, ruby = st.units.find(u => u.kit === "ruby"), foe = st.units.find(u => !u.isPlayer);
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "玩家" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [ruby.id]: "p2" } }).ok, true);
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(cmd));
  const playerView = () => V.projectView(plain(c.HotseatGame.getViewFor("p2")), { recipientId: "p2" });
  return { c, st, ruby, foe, send, playerView };
}

test("主持人暗骰检定：可以选敌人；检定和结果都不进玩家的包，房主看得到", () => {
  const { c, ruby, foe, send, playerView } = fixture();
  const ack = send("host", { type: "checkOpen", prof: "侦察", diff: "normal", unitIds: [foe.id, ruby.id], note: "门后有埋伏吗", secret: true });
  assert.equal(ack.ok, true, ack.error);
  const check = c.HotseatGame.getView().checks.at(-1);
  assert.equal(check.secret, true);
  assert.equal(send("p2", { type: "checkRoll", checkId: check.id, unitId: ruby.id }).ok, false, "玩家不能掷暗骰检定");
  assert.equal(send("host", { type: "checkRoll", checkId: check.id, unitId: foe.id }).ok, true);
  const hostView = c.HotseatGame.getView();
  assert.ok(hostView.checks.at(-1).targets[0].result, "房主看得到结果");
  const pv = playerView(), raw = JSON.stringify(pv);
  assert.ok(!pv.checks.some(x => x.id === check.id), "玩家包里没有这个检定");
  assert.doesNotMatch(raw, /暗骰|门后有埋伏/);
  assert.doesNotMatch(raw, /shp|坚毅/);
  // 不是暗骰的检定仍然只能选英雄，照旧公开
  assert.equal(send("host", { type: "checkOpen", prof: "侦察", diff: "normal", unitIds: [foe.id] }).ok, false);
  assert.equal(send("host", { type: "checkOpen", prof: "侦察", diff: "normal", unitIds: [ruby.id] }).ok, true);
  assert.equal(playerView().checks.length, 1);
  // 玩家不能开暗骰
  assert.equal(send("p2", { type: "checkOpen", prof: "侦察", diff: "normal", unitIds: [ruby.id], secret: true }).ok, false);
});

test("玩家主动发起检定：只给自己的角色申请 → 主持人定难度同意 → 房主掷骰，结果大家看得到", () => {
  const { c, st, ruby, send, playerView } = fixture();
  const helu = st.units.find(u => u.kit === "helu");
  assert.equal(send("p2", { type: "checkRequest", unitId: helu.id, prof: "侦察" }).ok, false, "不是自己的角色");
  assert.equal(send("p2", { type: "checkRequest", unitId: ruby.id, prof: "侦察", note: "找暗门" }).ok, true);
  assert.equal(send("p2", { type: "checkRequest", unitId: ruby.id, prof: "侦察" }).ok, false, "同一角色同时只能一条");
  const req = playerView().checkRequests.at(-1);
  assert.equal(req.status, "pending"); assert.equal(req.prof, "侦察"); assert.equal(req.note, "找暗门");
  assert.equal(send("p2", { type: "checkDecide", requestId: req.id, decision: "approve", diff: "easy" }).ok, false, "玩家不能自己同意");
  assert.equal(send("host", { type: "checkDecide", requestId: req.id, decision: "approve", diff: "easy" }).ok, true);
  const pv = playerView();
  const done = pv.checkRequests.find(r => r.id === req.id);
  assert.equal(done.status, "approved");
  const check = pv.checks.find(x => x.id === done.checkId);
  assert.ok(check && check.targets[0].result, "房主已经掷过，结果发给玩家");
  assert.equal(check.diffName, vm.runInContext("ROGUE_CHECKS", c).diffs.easy.name);
  // 撤回 / 不同意
  assert.equal(send("p2", { type: "checkRequest", unitId: ruby.id, prof: "运动" }).ok, true);
  const r2 = playerView().checkRequests.at(-1);
  assert.equal(send("p2", { type: "checkDecide", requestId: r2.id, decision: "cancel" }).ok, true);
  assert.equal(playerView().checkRequests.at(-1).status, "cancelled");
});

test("战斗模板「Lv随队」：跑团开战时按队伍等级（trpgPartyLevel：在队英雄平均）；填了等级的照填的", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "PARTYLV" });
  c.S.TRPG.active = true;
  const hs = c.S.state.units.filter(u => u.isPlayer && !u.weaponOf);
  hs[0].level = 6; hs[1].level = 9;   // 平均 7.5 → 8
  assert.equal(c.trpgPartyLevel(), 8);
  const t = c.battleTemplateNormalize({ name: "随队", board: 2, playerZone: 1,
    enemies: [{ preset: "thug_knife", level: null, zone: 2 }, { preset: "thug_hammer", level: 3, zone: 2 }], props: [{ kind: "boom", zone: 2, faction: "enemy" }] });
  const enc = plain(c.battleTemplateToEncounter(t));
  assert.deepEqual(enc.enemies.map(e => e.level), [8, 3]);
  assert.equal(enc.features.find(f => f.type === "prop").level, 8);
  c.S.TRPG.active = false;   // 跑团外：仍然跟着开战时选的战斗等级
  assert.equal(plain(c.battleTemplateToEncounter(t)).enemies[0].level, undefined);
});
