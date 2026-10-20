// issue #124：联机单局客制化图纸走个人钱包；房主在长休投票时选的守夜人 / 食物 / 睡眠不丢
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");

function setup(seed) {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["torque", "helu", "ruby"], seed });
  c.S.state.kuizhi = 0;
  const performed = [];
  c.RunFlow = {
    current: () => run,
    actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }),
    perform: cmd => { performed.push(cmd); return Promise.resolve(); }
  };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "online-rogue.js"), "utf8"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });
  return { c, R, run, O, d: O.data(run), performed };
}
const act = (O, who, command) => O.handle(who, { type: "rogue.act", command });

test("联机单局装客制化图纸：钱从自己的钱包出（以前读公账永远「奎支不够」）", () => {
  const { run, O, d } = setup("OL124-BP");
  run.stage = "board"; run.smiths = ["zekahr"]; run.blueprints = ["bp_zekahr_fool"];
  const owner = run.party.find(h => h.weapons.includes("ecmo")) || run.party[1];
  const kit = owner.weapons[0];
  owner.weaponLevels = Object.assign({}, owner.weaponLevels, { [kit]: 4 });
  const payer = owner.kit;
  d.purse[payer] = 100000;
  const before = d.purse[payer];
  // 房主操控的角色直接装；别人操控的角色由本人发指令
  const who = payer === "torque" || !["helu", "ruby"].includes(payer) ? "host" : "p2";
  act(O, who, { action: "installBlueprint", blueprint: "bp_zekahr_fool", kit, smith: "zekahr" });
  assert.equal(run.installed[kit], "bp_zekahr_fool");
  assert.ok(d.purse[payer] < before, "钱扣在付钱角色的钱包上");
});

test("联机单局：别人的武器不能拿自己的钱装图纸", () => {
  const { run, O, d } = setup("OL124-BP2");
  run.stage = "board"; run.smiths = ["zekahr"]; run.blueprints = ["bp_zekahr_fool"];
  d.purse.helu = 100000; d.purse.ruby = 100000;
  const other = run.party.find(h => h.kit === "ruby");
  assert.throws(() => O.handle("p2", { type: "rogue.act", command: { action: "installBlueprint", blueprint: "bp_zekahr_fool", kit: other.weapons[0], payer: "helu", smith: "zekahr" } }), /只能动自己角色的武器/);
});

test("联机单局长休：房主选的守夜人 / 食物 / 睡眠随投票结果一起执行", async () => {
  const { run, O, d, performed } = setup("OL124-REST");
  run.stage = "camp";
  const longOpt = O.options(run).find(o => o.cmd.action === "camp");
  assert.ok(longOpt, "营地有「休整」选项");
  const cmd = Object.assign({}, longOpt.cmd, { watch: "helu", food: { torque: "x" }, sleep: { torque: "y" } });
  const opt = O.matchOption(cmd);
  O.vote("host", opt.id, cmd);
  O.vote("p2", opt.id);
  assert.ok(O.tryResolve(true));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(performed.length, 1);
  assert.equal(performed[0].watch, "helu");
  assert.equal(JSON.stringify(performed[0].food), JSON.stringify({ torque: "x" }));
  assert.equal(JSON.stringify(performed[0].sleep), JSON.stringify({ torque: "y" }));
  assert.ok(d);
});
