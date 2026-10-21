// #125 中 · 杂项六条 + 两个尾巴：修武器两条路一致、跑团工坊同时做、长休守夜标记、闪光震撼弹打精英、
// 连续战斗换区域清场地结构、强盗头子算手下被打倒、震荡弹打不到下潜单位、被嘲讽的播撒者规划喷洒
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup({ party, seed: "M125", zoneMode: (opt && opt.zoneMode) || 2, enemies });
  c.startCombat();
  const st = c.S.state;
  return { c, st, P: k => c.findKit(k, st.units), E: k => st.units.find(u => u.kit === k) };
}
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };

/* ---------- 1. 修武器两条路 ---------- */
test("战斗中修武器：「使用道具」和「修理」命令同样的消耗、恢复量，修好的武器这一场都按受损算", () => {
  const out = {};
  for (const how of ["item", "ledger"]) {
    const { c, P } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
    c.S.state.bag = { items: [] };
    c.bagAdd("repair_kit", 1);
    c.LEDGER.dur.torque = 2;
    if (how === "item") c.useItemOn(P("helu"), "repair_kit", null, "torque");
    else c.ledgerRepair("torque", []);
    out[how] = { dur: c.weaponDur("torque"), pts: c.repairPoints(), worn: !!(c.S.state.weaponFallen && c.S.state.weaponFallen.torque) };
  }
  assert.deepEqual(out.item, out.ledger);
  assert.equal(out.item.worn, true, "战斗中修好的武器这一场仍按受损算");
});

test("战斗中「修理」命令也能修好倒地的武器人（和使用道具一样）", () => {
  const { c, P, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  st.bag = { items: [] };
  c.bagAdd("repair_kit", 1);
  const w = c.spawnWeapon(P("kolt"), "torque");
  w.layers.forEach(l => { l.current = 0; });
  w.dead = true;
  c.ledgerRepair("torque", []);
  assert.equal(w.dead, false);
});

/* ---------- 2. 跑团工坊同时做 ---------- */
test("跑团工坊：同时做好几样，时间只推进一次、按最久的那件算", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.S.TRPG.active = true;
  const LEDGER = require("node:vm").runInContext("LEDGER", c);
  c.bagAdd("cm_scrap", 4); c.bagAdd("cm_cell", 2); c.bagAdd("cm_coil", 2);
  c.trpgTeachRecipe("fx_overload", true);
  const h0 = LEDGER.hours;
  // 一件按困难算（2 小时），一件普通（1 小时）：一起开工，只过 2 小时（以前每做一样推进一次，共 3 小时）
  const notes = c.trpgCraft({ jobs: [
    { kit: "kolt", item: "fx_overload", diff: "hard", result: "ok" },
    { kit: "helu", item: "fx_overload", diff: "normal", result: "ok" }
  ] });
  assert.equal(c.bagCount("fx_overload"), 2);
  assert.equal(LEDGER.hours - h0, 2);
  assert.equal(notes.filter(n => /^经过 \d+ 小时/.test(n)).length, 1, "时间只推进一次");
  // 同一个人同时只能做一样
  const dup = c.trpgCraft({ jobs: [{ kit: "kolt", item: "fx_overload", result: "ok" }, { kit: "kolt", item: "fx_overload", result: "ok" }] });
  assert.ok(dup.some(n => /同时只能做一样/.test(n)));
});

/* ---------- 3. 长休标记 ---------- */
test("长休结算：荒野向导守夜照常恢复，不标「守夜 · 没有恢复」；武器人守夜时主人不被标", () => {
  const c = H.load();
  const src = require("node:fs").readFileSync(require("node:path").join(H.ROOT, "ledger.js"), "utf8");
  assert.match(src, /noRest/);
  const before = { day: 1, clock: 0, hours: 0, water: 0, food: 0, heroes: [{ kit: "kolt", name: "柯尔特", dead: false, hp: 1, hpMax: 9, shp: 0, shpMax: 0, weapons: [{ kit: "torque", name: "扭矩", dur: 1, max: 10 }] }] };
  const r1 = c.restReport(before, before, { ok: true, hours: 8, watch: "kolt", noRest: null });
  assert.equal(r1.heroes[0].watch, false, "向导守夜：恢复了");
  const r2 = c.restReport(before, before, { ok: true, hours: 8, watch: "kolt", noRest: "kolt" });
  assert.equal(r2.heroes[0].watch, true, "真的没恢复才标");
  const r3 = c.restReport(before, before, { ok: true, hours: 8, watch: "torque", noRest: "torque" });
  assert.equal(r3.heroes[0].watch, false, "武器人守夜：主人恢复了");
});

/* ---------- 4. 闪光震撼弹打 10 级精英 ---------- */
test("闪光震撼弹打 10 级起的精英：没攒满标记，失衡立刻恢复", () => {
  const { c, P, E } = field(["kolt", "helu"], [{ id: "captain_wolf", lv: 10, zone: 2 }]);
  const e = E("captain_wolf");
  assert.ok(c.isBossUnit(e), "10 级精英走首领规则");
  c.S.state.bag = { items: [] };
  c.bagAdd("fx_flash", 1);
  P("kolt").zone = 2;
  c.useItemOn(P("kolt"), "fx_flash", e, 2);
  assert.equal(e.stunned, false, "标记没攒满：失衡立刻恢复");
  assert.equal(e.stunMarks, 1);
  void P;
});

/* ---------- 5. 换区域清场地结构 ---------- */
test("连续战斗换区域：上一场的危墙 / 空隙不带到下一场", () => {
  const { c, st } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  st.gaps["1-2"] = { type: "wall", hp: 9 };
  st.gaps["2-3"] = { type: "void" };
  c.buildEncounterField({ zoneMode: 2 });
  Object.keys(st.gaps).forEach(k => assert.equal(st.gaps[k].type, "open", k));
});

/* ---------- 6. 强盗头子 ---------- */
test("强盗头子被打倒也算亡命之王的「手下被打倒」", () => {
  const { c, st, E } = field(["kolt", "helu"], [{ id: "outlaw_king", lv: 3, zone: 2 }, { id: "bandit_boss", lv: 3, zone: 2 }]);
  const boss = E("bandit_boss"), king = E("outlaw_king");
  assert.ok(!king.resources.crewDown);
  boss.dead = true;
  c.settleEnemyKill(boss, []);
  assert.equal(king.resources.crewDown, true);
  void st;
});

/* ---------- 7. 震荡弹 ---------- */
test("震荡弹打不到下潜中的单位", () => {
  const { c, P, E } = field(["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  c.S.state.bag = { items: [] };
  c.bagAdd("shockbomb", 1);
  const e = E("thug_knife");
  e.submerged = true;
  const before = e.layers.map(l => l.current).join();
  const posture = e.def;
  const notes = c.useItemOn(P("kolt"), "shockbomb", e, 2);
  assert.match(notes.join("\n"), /下潜中，没有被波及/);
  assert.equal(e.layers.map(l => l.current).join(), before);
  assert.equal(e.def, posture, "架势没动");
});

/* ---------- 8. 被嘲讽的播撒者 ---------- */
test("被嘲讽的播撒者：牵制者同区时 EnemyAI.plan 规划抵近喷洒，不是移动", () => {
  const { c, st, P, E } = field(["tou", "kolt"], [{ id: "spreader", lv: 10, zone: 2 }]);
  const tou = P("tou"), kolt = P("kolt"), a = E("spreader");
  tou.zone = 1; kolt.zone = 2; a.zone = 2; a.tauntTo = kolt.id;
  st.combatPhase = "enemy"; c.refreshEnemyEconomy(a);
  const p = c.EnemyAI.plan(a);
  assert.match(p.meta.skillName, /喷洒/);
  void noBlock;
});
