// 护送任务（escort.js）：单局护送、跑团任务系统（trpg-tasks.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(kind, foes) {
  const c = H.load();
  c.S.RNG.install("ESC-" + kind);
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "ESC-" + kind,
    enemies: foes || [{ id: "thug_knife", lv: 2, zone: 1 }],
    before: () => { c.spawnEscort({ kind }, 2, null); } });
  return c;
}

test("护送对象：我方单位但玩家不能操作，归零直接被摧毁，不算进全员倒地", () => {
  const c = field("cart");
  const e = c.fieldEscort();
  assert.equal(e.isPlayer, true);
  assert.equal(c.isWeaponUnit(e), true);
  assert.ok(!c.partyHeroes().includes(e));
  c.startCombat();
  assert.equal(e.ap, 0); assert.equal(e.bonus, 0);
  assert.equal(e.noPosture, true, "货车不会失衡");
  const foe = c.S.state.units.find(u => !u.isPlayer);
  c.dealTo(foe, e, { atk: 999, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
  assert.equal(e.dead, true);
  assert.ok(!e.dying);
  assert.deepEqual(plain(c.escortStatus()), { hp: 0, max: e.layers[0].max, destroyed: true });
  assert.equal(c.BattleSim.outcome(), null, "队员都还站着，战斗继续");
});

test("护送的人物：敌人回合前躲开有敌人的区域，并还击射程内血最少的敌人", () => {
  const c = field("vip", [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  c.S.state.zoneMode = 3;
  c.startCombat();
  const e = c.fieldEscort();
  e.zone = 1;
  const notes = [];
  c.escortAct(notes);
  assert.equal(e.zone, 2);
  assert.ok(notes.some(t => /还击/.test(t)), notes.join("\n"));
});

test("敌人按原来的逻辑打：护送对象是合法目标", () => {
  const c = field("cart", [{ id: "thug_knife", lv: 3, zone: 1 }, { id: "thug_hammer", lv: 3, zone: 1 }, { id: "thug_knife", lv: 3, zone: 1 }]);
  const r = c.BattleSim.run({ maxTurns: 10 });
  assert.ok(r.winner);
  assert.ok(c.escortStatus().hp < c.fieldEscort().layers[0].max, "打了几回合，货车挨过打");
});

/* ---------- 单局 ---------- */
function escortRun(seed) {
  const c = H.load(); const R = c.Rogue;
  for (let i = 0; i < 40; i++) {
    const run = R.newRun({ party: ["kolt", "helu"], seed: seed + i });
    const k = run.board.findIndex(t => t.kind === "escort");
    if (k >= 0) return { c, R, run, k };
  }
  throw new Error("没抽到护送任务");
}
const toLastFight = (run) => {
  const last = run.task.cols.length - 1;
  run.task.index = last;
  run.task.nodes[last] = run.task.nodes[last] || { type: run.task.cols[last][0], done: false };
};

test("单局护送：任务板写明护送对象；接下后每场战斗都带上，血量跨战斗保留", () => {
  const { c, R, run, k } = escortRun("ESC-R");
  const t = run.board[k];
  assert.ok(["cart", "vip"].includes(t.escort.kind));
  assert.ok(R.escortInfo(run, t).max > 0);
  R.acceptTask(run, k);
  toLastFight(run);
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const e = c.fieldEscort();
  assert.ok(e, "护送对象上场");
  e.layers[0].current = Math.floor(e.layers[0].max * 0.9);
  const kz = c.S.state.kuizhi;
  const pay = R.taskPay(run, run.task);
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t2 => /完好送达/.test(t2)), notes.join("\n"));
  assert.equal(c.S.state.kuizhi, kz + pay.kuizhi + Math.round(pay.kuizhi * 0.5 / 100) * 100);
});

test("单局护送：护送对象被摧毁 = 任务失败，没有报酬，回城", () => {
  const { c, R, run, k } = escortRun("ESC-F");
  R.acceptTask(run, k);
  const kz = c.S.state.kuizhi;
  toLastFight(run);
  c.BattleSim.setup(R.battleSpec(run));
  const e = c.fieldEscort();
  e.layers[0].current = 0; e.dead = true;
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t => /护送失败/.test(t)), notes.join("\n"));
  assert.equal(run.task, null);
  assert.equal(run.stage, "camp");
  assert.equal(c.S.state.kuizhi, kz);
});

test("单局护送：中途受损的血量带到下一场；受损严重就没有额外报酬", () => {
  const { c, R, run, k } = escortRun("ESC-H");
  R.acceptTask(run, k);
  run.task.escort.cur = 3;
  toLastFight(run);
  c.BattleSim.setup(R.battleSpec(run));
  assert.equal(c.fieldEscort().layers[0].current, 3);
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t => /受损严重/.test(t)), notes.join("\n"));
});

/* ---------- 跑团任务系统 ---------- */
function trpg() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "TRPG-TASK" });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  c.S.state.kuizhi = 0;
  return c;
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, o)));

test("跑团任务：主持人新建、编辑（路线、敌人、奖励、护送对象）、发布、接下", () => {
  const c = trpg();
  cmd(c, { action: "taskCreate", kind: "escort" });
  const t = c.trpgTasks()[0];
  assert.equal(t.status, "draft");
  assert.equal(t.kind, "escort");
  assert.ok(t.escort);
  const edit = plain(t);
  edit.name = "运水去北站";
  edit.reward = { kuizhi: 1200, xp: 30, items: [{ id: "medkit", qty: 2 }], parts: ["c_str_dex"], blueprints: ["bp_trevor_bigkill"], intactKuizhi: 600 };
  edit.escort = { kind: "vip", name: "老陈", hp: 25, def: 2, atk: 4, level: 2 };
  edit.nodes = [{ type: "battle", note: "桥头", enemies: [{ id: "thug_knife", lv: 2, zone: 2 }, { id: "nope", lv: 1, zone: 2 }], weather: "acid", zoneMode: 3 }, { type: "rest", note: "" }];
  cmd(c, { action: "taskSave", task: edit });
  const s = c.trpgTasks()[0];
  assert.equal(s.name, "运水去北站");
  assert.deepEqual(plain(s.nodes[0].enemies), [{ id: "thug_knife", lv: 2, zone: 2 }], "不认识的敌人被去掉");
  assert.equal(s.nodes[0].weather, "acid");
  assert.equal(s.nodes[0].zoneMode, 3);
  assert.equal(c.escortSpec(s.escort, 2).hpMax, 25);
  assert.match(cmd(c, { action: "taskAccept", id: s.id }).join(""), /只能接下已发布/);
  cmd(c, { action: "taskStatus", id: s.id, status: "posted" });
  cmd(c, { action: "taskAccept", id: s.id });
  assert.equal(s.status, "active");
});

test("跑团任务：打战斗站按配置摆敌人，护送对象上场；赢了走到下一站；结算发奖励", () => {
  const c = trpg();
  cmd(c, { action: "taskCreate", kind: "escort" });
  const t = c.trpgTasks()[0];
  const edit = plain(t);
  edit.reward = { kuizhi: 1000, xp: 20, items: [{ id: "medkit", qty: 1 }], parts: ["b_int_con"], blueprints: ["bp_trevor_bigkill"], intactKuizhi: 500 };
  edit.nodes = [{ type: "battle", enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], weather: "snow", zoneMode: 2 }, { type: "event", note: "检查货物" }];
  cmd(c, { action: "taskSave", task: edit });
  cmd(c, { action: "taskStatus", id: t.id, status: "posted" });
  cmd(c, { action: "taskAccept", id: t.id });
  const cfg = c.trpgTaskPrepareBattle(t.id);
  assert.deepEqual(plain(cfg), { enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], weather: "snow", zoneMode: 2 });
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: cfg.enemies, seed: "TB", before: () => c.trpgSpawnTaskEscort() });
  const e = c.fieldEscort();
  assert.ok(e, "护送对象上场");
  e.layers[0].current = e.layers[0].max - 1;
  const notes = c.trpgTaskAfterBattle("win");
  assert.equal(t.index, 1, notes.join("\n"));
  assert.equal(t.escort.cur, e.layers[0].max - 1);
  assert.equal(c.S.TRPG.taskBattle, null);
  cmd(c, { action: "taskNodeDone", id: t.id });
  const done = cmd(c, { action: "taskComplete", id: t.id });
  assert.equal(t.status, "done");
  assert.equal(c.S.state.kuizhi, 1500, done.join("\n"));
  assert.equal(c.bagCount("medkit"), 1);
  assert.equal(c.bagCount("part_b_int_con"), 1);
  assert.equal(c.bagCount("bp_trevor_bigkill"), 1);
  assert.ok(c.findKit("kolt", c.S.state.units).xp >= 20);
});

test("跑团任务：护送对象被摧毁 → 任务失败；任务跟着存档（LEDGER）走", () => {
  const c = trpg();
  cmd(c, { action: "taskCreate", kind: "escort" });
  const t = c.trpgTasks()[0];
  cmd(c, { action: "taskStatus", id: t.id, status: "posted" });
  cmd(c, { action: "taskAccept", id: t.id });
  const cfg = c.trpgTaskPrepareBattle(t.id);
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: cfg.enemies, seed: "TB2", before: () => c.trpgSpawnTaskEscort() });
  const e = c.fieldEscort(); e.layers[0].current = 0; e.dead = true;
  const notes = c.trpgTaskAfterBattle("win");
  assert.equal(t.status, "failed", notes.join("\n"));
  const saved = c.LEDGER.save();
  assert.equal(saved.tasks[0].status, "failed");
  c.LEDGER.reset();
  assert.equal(c.trpgTasks().length, 0);
  c.LEDGER.load(saved);
  assert.equal(c.trpgTasks()[0].name, t.name);
});

test("跑团任务：长休时护送的人物回满，货车不会", () => {
  const c = trpg();
  cmd(c, { action: "taskCreate", kind: "escort" });
  const t = c.trpgTasks()[0];
  const edit = plain(t); edit.escort.kind = "vip"; cmd(c, { action: "taskSave", task: edit });
  cmd(c, { action: "taskStatus", id: t.id, status: "posted" });
  cmd(c, { action: "taskAccept", id: t.id });
  t.escort.cur = 2;
  const notes = [];
  c.trpgTaskRestEscort(notes);
  assert.equal(t.escort.cur, null);
});

test("护送对象的浮窗 / 联机投影：写「护送对象」和它自己的说明，不写成武器人", () => {
  const c = field("vip");
  const e = c.fieldEscort();
  globalThis.ESCORT_KINDS = c.ESCORT_KINDS || { vip: { note: "敌人回合前会躲开有敌人的区域，能用手枪还击" } };
  try {
    const T = require("../unit-tip.js");
    const d = T.describe({ kind: "escort", kit: e.kit, escort: e.escort });
    assert.equal(d.kicker, "护送对象");
    assert.match(d.text, /躲开有敌人的区域/);
    assert.match(d.text, /护送失败/);
    assert.doesNotMatch(JSON.stringify(d), /武器人/);
  } finally { delete globalThis.ESCORT_KINDS; }
  // 联机投影带上 escort（玩家那边据此画「护送对象」）
  const OV = require("../online-view.js");
  assert.equal(OV.projectUnit(e).escort, "vip");
});
