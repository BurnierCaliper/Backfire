// 跑团诊所装的义体跟着队伍记忆走（backlog 第三轮 H-1）：rememberCampaign → 重新摆队伍 / 存档读档，义体、血量、坚毅上限都还在
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setupField(c, seed) {
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed });
}
function field() {
  const c = H.load();
  setupField(c, "CWMEM");
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(fs.readFileSync(H.ROOT + "/game.js", "utf8"), c, { filename: "game.js" });
  c.S.TRPG.active = true; c.S.TRPG.clinicOpen = true;
  c.LEDGER.purse = { kolt: 50000 };
  c.cyberwareLoadExamples();
  return c;
}
const snap = u => plain({ cw: u.cyberware, over: u.cyberOverinstall, layers: u.layers.map(l => [l.type, l.max]), shpMax: u.shpMax });
const kolt = c => c.findKit("kolt", c.S.state.units);

function install(c) {
  kolt(c).level = 5;   // #315：5 级起才能在诊所装义体（等级跟着队伍记忆 / 存档走）
  c.trpgCyberwareInstall("kolt", "example_t5_melee");
  const u = kolt(c);
  u.cyberOverinstall = true;
  return u;
}

const dispatch = (c, cmd) => c.Commands.dispatch(plain(cmd));
// 与战斗画面「开战」同一条路：battle.setup 里会调 applyCampaignToField
const redeploy = c => c.GAME.partyKits.splice(0, 9, "kolt", "helu") && dispatch(c,{ type: "battle.setup", level: 3, encounter: null, xpMult: 1 });

test("装义体 → rememberCampaign → 重新摆队伍：义体、血量层、坚毅上限和刚装好时一致", () => {
  const c = field();
  const before = snap(install(c));
  assert.equal(before.cw.length, 1);
  dispatch(c, { type: "battle.rememberCampaign" });
  redeploy(c);
  assert.deepEqual(snap(kolt(c)), before);
});

test("存档读档：义体跟着存档走", () => {
  const c = field();
  const before = snap(install(c));
  dispatch(c, { type: "battle.panel", action: "saveSlot", index: 0 });
  c.GAME.campaign = null;
  c.localStorage.removeItem("anterscale-campaign");
  dispatch(c, { type: "battle.panel", action: "loadSlot", index: 0, level: 3 });
  redeploy(c);
  assert.deepEqual(snap(kolt(c)), before);
});
