// 分步选择的技能：真正结算之前随时能放弃，放弃后状态和开始前完全一样（issue #188）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const KITS = ["kolt", "helu", "chuan", "nora", "mochi", "mint", "tou", "hiaki", "yuito", "berniel", "bili", "xia"];

function field(party) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "GIVEUP" });
  c.startCombat();
  c.S.state.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; u.ap = 3; u.bonus = 3; u.level = 15; });
  return c;
}
// 战斗记录会多一行「开始分步选择」，不算状态；其余整个 state 都比
const snap = c => { const s = JSON.parse(JSON.stringify(c.S.state)); delete s.log; delete s.logPages; delete s.skillFlow; return s; };
// 逐个顶层字段比，失败时能直接看出是哪一项被改了
function sameState(a, b, msg) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    assert.equal(JSON.stringify(b[k]), JSON.stringify(a[k]), `${msg}（字段 ${k}）`);
  }
}

test("所有分步技能：开始分步 → 放弃，状态和开始前完全一样", () => {
  let checked = 0;
  for (const kit of KITS) {
    const c = field([kit]);
    const st = c.S.state;
    const actor = c.findKit(kit, st.units);
    if (!actor) continue;
    if (kit === "kolt") c.spawnWeapon(actor, "torque");
    const actors = st.units.filter(u => u.isPlayer && !u.dead);
    for (const a of actors) {
      for (const sk of c.skillList(a)) {
        let steps = [];
        try { steps = c.skillFlowSteps(sk.id, a, {}); } catch (e) { continue; }
        if (!steps.length) continue;
        st.attackerId = a.id;
        const before = snap(c);
        c.beginSkillFlow(sk.id);
        assert.ok(st.skillFlow, `${sk.id} 应该进入分步`);
        c.cancelSkillFlow();
        assert.equal(st.skillFlow, null, `${sk.id} 放弃后不该残留 skillFlow`);
        sameState(before, snap(c), `${sk.id} 放弃后状态应和开始前一样`);
        checked++;
      }
    }
  }
  assert.ok(checked > 10, `至少检查了十几个分步技能（实际 ${checked}）`);
});

test("拆装部件：走到最后一步前放弃，刀头、行动点、强制收回都不变", () => {
  const c = field(["kolt"]);
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  kolt.resources.bit = "drill";
  const torque = c.spawnWeapon(kolt, "torque");
  torque.zone = 1; torque.ap = 2;
  st.attackerId = torque.id;
  const ap = torque.ap, bonus = torque.bonus, hidden = torque.hidden;
  c.beginSkillFlow("torque_swap");
  const steps = c.skillFlowSteps("torque_swap", torque, {});
  c.applyFlowPick(null);   // 第一步选了「不选」，还没到最后一步
  assert.ok(steps.length > 1 ? st.skillFlow : true);
  if (st.skillFlow) c.cancelSkillFlow();
  if (steps.length > 1) {
    assert.equal(kolt.resources.bit, "drill", "刀头没换");
    assert.equal(torque.ap, ap);
    assert.equal(torque.bonus, bonus);
    assert.equal(!!torque.hidden, !!hidden, "没有被强制收回");
  }
});
