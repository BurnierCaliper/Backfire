// #340 第 5 条：离开酸液地面 / 越过空隙要花 1 行动点。#153（L-20）让精英 / 首领一律多留 1 点出手，
// 可精英每回合只有 1 行动点：站在酸液上（被击落的播撒者每回合往脚下铺酸液）就整场走不出来，
// 远程精英同区有我方时整场一步都不动。现在原地出不了手（谁都打不到，或者打得到的不是要打的人）时，
// 用最后 1 行动点走这一步（ai.js · aiPlan 再规划一次、firingStep）；原地打得到要打的人时照旧留着出手
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: "T340-5", zoneMode: opt.zoneMode || 3 });
  c.startCombat();
  const S = c.S.state;
  return { c, S, P: k => c.findKit(k, S.units), E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead) };
}
const tank = u => u.layers.forEach(l => { l.max = 999; l.current = 999; });
const heroes = S => S.units.filter(u => u.isPlayer && !u.hidden);
const logText = S => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const brief = plan => JSON.stringify(plan ? { kind: plan.ai && plan.ai.kind, dest: plan.ai && plan.ai.dest, sid: plan.ai && plan.ai.sid, name: plan.meta && plan.meta.skillName } : null);
/** 敌人回合，站在 zone 区的酸液上，1 行动点 + 1 附赠（精英每回合就这么多）；不飞（被击落）、不带种族附赠 */
function onAcid(S, e, zone) {
  e.zone = zone; e.flying = false; e.race = null; e.stunned = false;
  S.fields[zone].acid = true;
  S.combatPhase = "enemy";
  e.ap = 1; e.bonus = 1;
}

test("远程精英站在酸液上、我方都在同区：用最后 1 行动点退到没人的相邻区（以前整步不出手）", () => {
  for (const kit of ["spreader", "captain_lizard", "ant_hunter", "sewer_keeper"]) {
    const { c, S, E } = field([{ id: kit, lv: 12, zone: 2 }]);
    const e = E(kit);
    heroes(S).forEach(u => { u.zone = 2; tank(u); });
    onAcid(S, e, 2);
    const plan = c.EnemyAI.plan(e);
    assert.ok(plan && plan.ai && plan.ai.kind === "move", kit + "：规划移动 " + brief(plan));
    const dest = plan.ai.dest;
    assert.ok(dest === 1 || dest === 3, kit + "：退到没人的相邻区 " + dest);
    plan.thunk();
    assert.equal(e.zone, dest, kit + "：走出了酸液");
    assert.equal(e.ap, 0, kit + "：花的是行动点");
    assert.equal(e.bonus, 1, kit + "：附赠没动");
    assert.match(logText(S), /离开酸液地面/);
  }
});

test("整场：被击落的播撒者每回合往脚下铺酸液，同区有我方时不再从头站到尾（退开以后照常喷洒）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "spreader", lv: 12, zone: 2 }], seed: "T340-5", zoneMode: 3 });
  const S = c.S.state;
  const e = S.units.find(u => u.kit === "spreader");
  heroes(S).forEach(u => { u.zone = 2; tank(u); });
  e.flying = false; e.race = null;
  const r = c.BattleSim.run({ maxRounds: 6, policy: { act: () => null } });   // 我方一直不动
  assert.equal(r.winner, "timeout");
  assert.notEqual(e.zone, 2, "播撒者走出了我方所在的区");
  assert.ok(r.actions >= 2, "播撒者有行动（以前 0 次）：" + r.actions);
  assert.match(logText(S), /【播撒者[^】]*】喷洒/, "退开以后隔一区喷洒");
});

test("精英站在酸液上、隔两区才有人：用最后 1 行动点朝人走一步（以前 #153 的 L-20 场景，整场走不出来）", () => {
  const { c, S, E } = field([{ id: "captain_wolf", lv: 5, zone: 3 }]);
  const w = E("captain_wolf");
  heroes(S).forEach(u => { u.zone = 1; tank(u); });
  onAcid(S, w, 3);
  const plan = c.EnemyAI.plan(w);
  assert.ok(plan && plan.ai && plan.ai.kind === "move" && plan.ai.dest === 2, "朝 1 区走到 2 区：" + brief(plan));
  plan.thunk();
  assert.equal(w.zone, 2);
  assert.equal(w.ap, 0);
  // 下一回合不在酸液上：照常附赠移动 + 行动点出手
  w.ap = 1; w.bonus = 1;
  const next = c.EnemyAI.plan(w);
  assert.ok(next && next.ai && next.ai.kind === "move" && next.ai.dest === 1, "下回合附赠走到 1 区：" + brief(next));
  next.thunk();
  assert.equal(w.ap, 1, "附赠移动，行动点留着出手");
  const hit = c.EnemyAI.plan(w);
  assert.ok(hit && hit.ai && hit.ai.kind === "attack", "然后出手：" + brief(hit));
});

test("越过空隙也一样：近战精英隔着空隙、原地打不到人时，用最后 1 行动点去越过（以前整场不动）", () => {
  const { c, S, E } = field([{ id: "captain_wolf", lv: 5, zone: 2 }], { zoneMode: 2 });
  const w = E("captain_wolf");
  heroes(S).forEach(u => { u.zone = 1; tank(u); });
  S.gaps["1-2"] = { type: "void", hp: 0, maxHp: 0, open: false };
  w.zone = 2; w.race = null; w.stunned = false;
  S.combatPhase = "enemy";
  w.ap = 1; w.bonus = 1;
  const plan = c.EnemyAI.plan(w);
  assert.ok(plan && plan.ai && plan.ai.kind === "move" && plan.ai.dest === 1, "去越过空隙：" + brief(plan));
  c.Math.random = () => 0.1;   // 运动检定（50%）过
  plan.thunk();
  assert.equal(w.zone, 1, "越过了空隙");
  assert.equal(w.ap, 0, "花的是行动点");
});

test("原地打得到人时照旧留着唯一的行动点出手，不花在离开酸液上（#153 L-20 保留，另见 enemy-terrain-153.test.js）", () => {
  // 播撒者同区有柯尔特、隔一区有夕夏：原地喷洒夕夏，不动
  const { c, S, E, P } = field([{ id: "spreader", lv: 12, zone: 2 }]);
  const sp = E("spreader"), h = P("helu");
  P("kolt").zone = 2; h.zone = 1;
  heroes(S).forEach(tank);
  onAcid(S, sp, 2);
  const plan = c.EnemyAI.plan(sp);
  assert.ok(plan && plan.ai && plan.ai.kind === "attack", "原地喷洒：" + brief(plan));
  assert.equal(plan.ai.target, h);
  plan.thunk();
  assert.equal(sp.zone, 2, "没有走");
});

test("被嘲讽时只看嘲讽者：嘲讽者在隔壁区、近战精英打不到他（同区还有别人），用最后 1 行动点走过去", () => {
  const { c, S, E, P } = field([{ id: "captain_wolf", lv: 5, zone: 2 }]);
  const w = E("captain_wolf"), k = P("kolt"), h = P("helu");
  heroes(S).forEach(tank);
  k.zone = 1; h.zone = 2;
  onAcid(S, w, 2);
  w.tauntTo = k.id;
  const plan = c.EnemyAI.plan(w);
  assert.ok(plan && plan.ai && plan.ai.kind === "move" && plan.ai.dest === 1, "走向嘲讽者：" + brief(plan));
  // 远程精英被隔两区的人嘲讽（隔一区的人打得到也不能打）：去能打到嘲讽者的站位，以前原地硬打、打不到
  const f2 = field([{ id: "captain_lizard", lv: 5, zone: 3 }]);
  const liz = f2.E("captain_lizard"), k2 = f2.P("kolt");
  heroes(f2.S).forEach(tank);
  k2.zone = 1; f2.P("helu").zone = 2;
  onAcid(f2.S, liz, 3);
  liz.tauntTo = k2.id;
  const p2 = f2.c.EnemyAI.plan(liz);
  assert.ok(p2 && p2.ai && p2.ai.kind === "move" && p2.ai.dest === 2, "走到 2 区去打嘲讽者：" + brief(p2));
});

test("原地打得到的不是要打的人：暴虐猎手追血量最多的人，同区只有别人时，用最后 1 行动点追过去（以前整步不出手）", () => {
  const { c, S, E, P } = field([{ id: "rat_tyrant", lv: 5, zone: 2 }]);
  const t = E("rat_tyrant"), k = P("kolt"), h = P("helu");
  tank(h); h.zone = 1;   // 血量最多的在 1 区
  k.zone = 2;            // 同区的柯尔特打得到，但不是它要追的人
  onAcid(S, t, 2);
  const plan = c.EnemyAI.plan(t);
  assert.ok(plan && plan.ai && plan.ai.kind === "move" && plan.ai.dest === 1, "追到 1 区：" + brief(plan));
  plan.thunk();
  assert.equal(t.zone, 1);
  assert.equal(t.ap, 0);
});

test("杂兵照旧：离开酸液只要 1 行动点（不受这次改动影响）", () => {
  const { c, S, E } = field([{ id: "riot_rifle", lv: 5, zone: 2 }]);
  const e = E("riot_rifle");
  heroes(S).forEach(u => { u.zone = 2; tank(u); });
  onAcid(S, e, 2);
  e.bonus = 0;
  const plan = c.EnemyAI.plan(e);
  assert.ok(plan && plan.ai && plan.ai.kind === "move", "燃烧步枪退开：" + brief(plan));
});

test("不在酸液上的精英没有附赠：照旧不移动（精英 / 首领平时只能用附赠移动，不改花行动点）", () => {
  const { c, S, E } = field([{ id: "captain_wolf", lv: 5, zone: 2 }]);
  const w = E("captain_wolf");
  heroes(S).forEach(u => { u.zone = 1; tank(u); });
  w.race = null; w.stunned = false;
  S.combatPhase = "enemy";
  w.ap = 1; w.bonus = 0;
  assert.equal(c.EnemyAI.plan(w), null);
});
