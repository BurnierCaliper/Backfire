// #117：沙漠生物 / 敌人 AI 的四个小问题
// 沙鱼隔区捕食先走过去、下潜逃走不掉材料、投掷罐打不到下潜的单位、精英没附赠不规划移动
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: opt.seed || "D117", zoneMode: opt.zoneMode || 3 });
  const st = c.S.state;
  c.LEDGER.clock = opt.night ? 22 * 60 : 10 * 60;
  c.startCombat();
  const by = (k) => st.units.filter(u => u.kit === k);
  return { c, st, by };
}

test("沙鱼夜晚捕食隔区的猎物：先移动过去，不付行动点原地咬空", () => {
  const { c, st, by } = field([{ id: "sandfish_drive", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 3 }], { night: true });
  const fish = by("sandfish_drive")[0], bug = by("dust_bug")[0];
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  bug.detected = true;
  fish.ap = 2; st.combatPhase = "enemy";
  const plan = c.EnemyAI.plan(fish);
  assert.ok(plan && plan.ai, "有计划");
  assert.equal(plan.ai.kind, "move", "先移动");
  assert.equal(plan.ai.dest, 2);
  plan.thunk();
  assert.equal(fish.zone, 2, "走了一步");
  // 走到同区之后才出手
  fish.zone = 3;
  const p2 = c.EnemyAI.plan(fish);
  assert.equal(p2.ai.kind, "hunt", "同区才捕食");
});

test("沙鱼隔区捕食但付不起移动：不规划捕食（不原地咬空）", () => {
  const { c, st, by } = field([{ id: "sandfish_drive", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 3 }], { night: true });
  const fish = by("sandfish_drive")[0], bug = by("dust_bug")[0];
  bug.detected = true;
  fish.ap = 0;
  const plan = c.EnemyAI.plan(fish);
  assert.ok(!plan || !plan.ai || plan.ai.kind !== "hunt");
});

test("下潜逃走的沙鱼战后不掉材料；打死的照掉", () => {
  const vm = require("node:vm");
  const mats = (c) => vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);
  const play = (kill) => {
    const c = H.load(), R = c.Rogue;
    const run = R.newRun({ party: ["kolt", "helu"], seed: "MATS117" });
    run.act = 1; run.actDay = 8; run.stage = "boss";
    c.BattleSim.setup({ party: ["kolt", "helu"], enemies: Array.from({ length: 6 }, () => ({ id: "sandfish_drive", lv: 10, zone: 2 })), seed: "M117", zoneMode: 3 });
    c.S.state.units.filter(u => !u.isPlayer).forEach(u => {
      u._removed = true;
      if (kill) { u.dead = true; u.layers.forEach(l => { l.current = 0; }); } else u.submerged = false;
    });
    const before = mats(c);
    R.finishBattle(run, "win");
    return mats(c) - before;
  };
  assert.equal(play(false), 0, "全部下潜逃走：什么都不掉");
  assert.ok(play(true) > 0, "打死的照掉");
});

test("投掷罐对下潜中的单位不生效，同区其他单位照常", () => {
  const { c, st, by } = field([{ id: "sandfish_ambush", lv: 3, zone: 1 }, { id: "sandfish_drive", lv: 3, zone: 1 }]);
  const amb = by("sandfish_ambush")[0], drive = by("sandfish_drive")[0];
  const kolt = c.findKit("kolt", st.units);
  amb.submerged = true; drive.submerged = false;
  const notes = [];
  c.useEffectItem(kolt, { target: "zone", kind: "status", key: "burn", name: "燃烧罐" }, null, 1, notes);
  assert.ok(!(amb.statuses && amb.statuses.burn), "下潜的没中状态：" + notes.join("|"));
  assert.ok(drive.statuses && drive.statuses.burn, "没下潜的照常");
});

test("精英没有附赠行动：AI 不规划移动", () => {
  const { c, st, by } = field([{ id: "captain_ox", lv: 5, zone: 1 }]);
  const ox = by("captain_ox")[0];
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 3; });
  ox.bonus = 1;
  const p1 = c.EnemyAI.plan(ox);
  assert.ok(p1 && p1.ai && p1.ai.kind === "move", "有附赠时照常移动");
  ox.bonus = 0;
  const p2 = c.EnemyAI.plan(ox);
  assert.ok(!p2 || !p2.ai || p2.ai.kind !== "move", "没附赠不规划移动");
});
