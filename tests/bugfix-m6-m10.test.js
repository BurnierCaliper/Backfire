// 第三轮 · 单机 M-6 ~ M-10：AI 不看危墙门、沙鱼隔墙追猎、委托人认错敌人、工坊打下手、硬撑长休 VIP
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const wall = (c) => Object.assign(c.emptyGap(), { type: "wall", hp: 50, maxHp: 50, level: 1 });

function aiField(kit, zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "ras"], enemies: [{ id: kit, lv: 3, zone: 1 }], seed: "M6", zoneMode });
  c.startCombat();
  const S = c.S.state;
  S.zoneMode = zoneMode;
  S.combatPhase = "enemy";
  const e = S.units.find(u => !u.isPlayer && u.kit === kit);
  const ps = S.units.filter(u => u.isPlayer && !u.hidden);
  e.stunned = false; e.ap = 1; e.bonus = 1;
  return { c, S, e, ps };
}

/* ---------- M-6 ---------- */
test("M-6：远程敌人被贴脸，唯一的退路隔着危墙 → 不规划后撤", () => {
  const { c, S, e, ps } = aiField("guard_gun", 2);
  S.gaps["1-2"] = wall(c);
  e.zone = 1; ps.forEach(p => { p.zone = 1; });
  const plan = c.EnemyAI.plan(e);
  assert.ok(!plan || !/移动/.test(plan.meta.skillName), "不该移动到墙那边：" + (plan && plan.meta.skillName));
});

test("M-6：近战敌人要找的人都隔着危墙 → 不规划接近（走不通的移动）", () => {
  const { c, S, e, ps } = aiField("thug_knife", 3);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "door", open: false });
  e.zone = 1; ps.forEach(p => { p.zone = 3; });
  const plan = c.EnemyAI.plan(e);
  assert.ok(!plan || !/移动到 2 区/.test(plan.meta.skillName), "关着的门走不通：" + (plan && plan.meta.skillName));
});

/* ---------- M-7 ---------- */
test("M-7：沙鱼夜间追猎，猎物隔着危墙 → 不规划走不通的移动", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "sandfish_drive", lv: 3, zone: 1 }, { id: "dust_bug", lv: 3, zone: 3 }], seed: "M7", zoneMode: 3 });
  c.LEDGER.clock = 22 * 60;
  c.startCombat();
  const st = c.S.state;
  st.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  const fish = st.units.find(u => u.kit === "sandfish_drive"), bug = st.units.find(u => u.kit === "dust_bug");
  bug.detected = true;
  st.gaps["2-3"] = wall(c);
  fish.ap = 2; st.combatPhase = "enemy";
  const plan = c.EnemyAI.plan(fish);
  assert.ok(!plan || !(plan.ai && plan.ai.kind === "move" && plan.ai.target === bug), "猎物在墙那边，不该每回合都去追：" + (plan && plan.meta && plan.meta.skillName));
});

/* ---------- M-8 ---------- */
test("M-8：护送委托人同区只有中立的尘虫 → 不躲、不还击它", () => {
  const c = H.load();
  c.S.RNG.install("M8");
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "M8", enemies: [{ id: "dust_bug", lv: 1, zone: 1 }],
    before: () => { c.spawnEscort({ kind: "vip" }, 2, null); } });
  c.S.state.zoneMode = 3;
  c.startCombat();
  const e = c.fieldEscort();
  e.zone = 1;
  const notes = [];
  c.escortAct(notes);
  assert.equal(e.zone, 1, "尘虫是中立的，不用躲：" + notes.join("|"));
  assert.ok(!notes.some(t => /还击|躲开|想躲开/.test(t)), notes.join("|"));
});

test("M-8：下潜中的敌人不算委托人的敌人", () => {
  const c = H.load();
  c.S.RNG.install("M8b");
  c.BattleSim.setup({ party: ["kolt", "helu"], seed: "M8b", enemies: [{ id: "thug_knife", lv: 1, zone: 1 }],
    before: () => { c.spawnEscort({ kind: "vip" }, 2, null); } });
  c.S.state.zoneMode = 3;
  c.startCombat();
  const e = c.fieldEscort();
  e.zone = 1;
  c.S.state.units.find(u => u.kit === "thug_knife").submerged = true;
  const notes = [];
  c.escortAct(notes);
  assert.ok(!notes.some(t => /还击|躲开|想躲开/.test(t)), notes.join("|"));
});

/* ---------- M-9 ---------- */
function workshop() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  c.bagAdd("cm_scrap", 8); c.bagAdd("cm_cell", 4); c.bagAdd("cm_coil", 4);
  c.trpgTeachRecipe("fx_overload", true);
  return c;
}

test("M-9：给别人打下手的人，同时不能做自己的东西", () => {
  const c = workshop();
  const notes = c.trpgCraft({ jobs: [
    { kit: "kolt", item: "fx_overload", helper: "helu", result: "ok" },
    { kit: "helu", item: "fx_overload", result: "ok" }
  ] });
  assert.ok(notes.some(n => /已经在忙了|同时只能做一样/.test(n)), notes.join("|"));
  assert.equal(c.bagCount("fx_overload"), 1, "只做成第一件");
});

test("M-9：做自己东西的人，同时不能给别人打下手", () => {
  const c = workshop();
  const notes = c.trpgCraft({ jobs: [
    { kit: "helu", item: "fx_overload", result: "ok" },
    { kit: "kolt", item: "fx_overload", helper: "helu", result: "ok" }
  ] });
  assert.ok(notes.some(n => /已经在忙了/.test(n)), notes.join("|"));
  assert.equal(c.bagCount("fx_overload"), 1);
});

test("M-9：同一个人不能同时给两件打下手", () => {
  const c = workshop();
  const notes = c.trpgCraft({ jobs: [
    { kit: "kolt", item: "fx_overload", helper: "helu", result: "ok" },
    { kit: "ras", item: "fx_overload", helper: "helu", result: "ok" }
  ] });
  assert.ok(notes.some(n => /已经在忙了/.test(n)), notes.join("|"));
});

/* ---------- M-10 ---------- */
function vipRun() {
  const c = H.load();
  const plain = x => JSON.parse(JSON.stringify(x));
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "M10" });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  c.S.state.kuizhi = 0;
  const cmd = (o) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, o)));
  cmd({ action: "taskCreate", kind: "escort" });
  const t = c.trpgTasks()[0];
  const edit = plain(t); edit.escort.kind = "vip"; cmd({ action: "taskSave", task: edit });
  cmd({ action: "taskStatus", id: t.id, status: "posted" });
  cmd({ action: "taskAccept", id: t.id });
  t.escort.cur = 2;
  return { c, t };
}

test("M-10：补给不够硬撑（长休没成功）→ 护送 VIP 不恢复，日志也不写回满", () => {
  const { c, t } = vipRun();
  const notes = c.trpgLongRest({ hours: 8 });   // 背包里没水没吃的
  assert.ok(notes.some(n => /补给不足/.test(n)), notes.join("|"));
  assert.equal(t.escort.cur, 2, "VIP 和队员一样没恢复");
  assert.ok(!notes.some(n => /血量回满/.test(n)), notes.join("|"));
});

test("M-10：长休成功（主持人强制）→ 护送 VIP 照常回满", () => {
  const { c, t } = vipRun();
  const notes = c.trpgLongRest({ hours: 8, force: true });
  assert.equal(t.escort.cur, null);
  assert.ok(notes.some(n => /血量回满/.test(n)));
});
