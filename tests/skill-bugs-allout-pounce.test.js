// 全力以赴对特盛乱打生效；猛扑能选同区目标（选目标后才多出「带到哪一区」那一步）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

function setup(party) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "SKB" });
  c.startCombat();
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 200, max: 200 }]; f.def = f.defMax = 10; f.zone = 1; });
  foes[2].zone = 2;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 3; h.bonus = 2; });
  return { c, S, foes, K: k => c.findKit(k, S.units) };
}

test("全力以赴 → 特盛乱打：第一下带猛击（击破 ×2，绯秋承受原击破），用掉；其余照常 1 击破", () => {
  const { c, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.resources.stance = "waki";
  h.def = h.defMax = 5;
  cmd(c, { actor: h.id, skill: "hiaki_allin" });
  assert.equal(h.resources.smashNext, true);
  cmd(c, { actor: h.id, skill: "hiaki_barrage" });
  assert.equal(foes[0].def, 8, "猛击：2 击破");
  assert.equal(foes[1].def, 9, "第二个照常 1 击破");
  assert.equal(foes[2].def, 10, "别区不受影响");
  assert.equal(h.def, 4, "绯秋承受原击破 1");
  assert.equal(h.resources.smashNext, false, "全力以赴已用掉");
  assert.equal(foes[0].barrageBy, h.id);
  assert.equal(foes[1].barrageBy, h.id);
  assert.equal(h.resources.stance, "draw");
});

test("没有全力以赴时特盛乱打不变：各 1 击破，绯秋架势不动", () => {
  const { c, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.resources.stance = "waki"; h.def = h.defMax = 5;
  cmd(c, { actor: h.id, skill: "hiaki_barrage" });
  assert.deepEqual(plain(foes.map(f => f.def)), [9, 9, 10]);
  assert.equal(h.def, 5);
});

test("猛扑同区目标：选目标后才多出「带到哪一区」；只带目标的预演没有效果，选完目的地才结算", () => {
  const { c, S, foes, K } = setup(["tou"]);
  const t = K("tou");
  cmd(c, { actor: t.id, skill: "tou_summon" });
  const m = c.findKit("mochi", S.units); m.zone = 1; m.ap = 3; m.bonus = 2;
  assert.equal(c.skillFlowSteps("mochi_pounce", m, {}).length, 1);
  assert.equal(c.skillFlowSteps("mochi_pounce", m, { target: foes[0].id }).length, 2, "同区目标多一步");
  assert.equal(c.skillFlowSteps("mochi_pounce", m, { target: foes[2].id }).length, 1, "距离 1 目标不用选区");
  const hp0 = foes[0].layers[0].current, d0 = foes[0].def;
  cmd(c, { actor: m.id, skill: "mochi_pounce", target: foes[0].id, picks: { target: foes[0].id, dest: 2 } });
  assert.equal(m.zone, 2); assert.equal(foes[0].zone, 2, "目标被带走");
  assert.ok(foes[0].layers[0].current < hp0, "受到伤害");
  assert.equal(foes[0].def, d0 - 1, "1 击破");
});

test("战斗画面分步选择：是否最后一步按「选了这一项之后」的步骤算（同区猛扑目标才能点）", () => {
  const g = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(g, /const isLastWith = v => \{/);
  assert.match(g, /next = skillFlowSteps\(sk\.id, live, withPick\(v\)\)/);
  assert.match(g, /thunk: isLastWith\(u\.id\) \? skillThunk\(actor\.id, sk\.id, u\.id, withPick\(u\.id\)\) : null/);
  assert.doesNotMatch(g, /const isLast = steps\.every/);
});

test("全力以赴 → 破势：第一个敌人击破 ×2，绯秋承受原击破，用掉；第二个照常", () => {
  const { c, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.def = h.defMax = 5;
  foes[0].def = 1; foes[1].def = 1;
  h.resources.smashNext = true;
  cmd(c, { actor: h.id, skill: "role_breakwave" });
  assert.equal(foes[0].def, 0);
  assert.equal(foes[1].def, 0);
  assert.equal(h.def, 4, "反震 1");
  assert.equal(h.resources.smashNext, false);
});

test("没有全力以赴时破势不动绯秋架势", () => {
  const { c, foes, K } = setup(["hiaki"]);
  const h = K("hiaki");
  h.def = h.defMax = 5; foes[0].def = 1;
  cmd(c, { actor: h.id, skill: "role_breakwave" });
  assert.equal(foes[0].def, 0);
  assert.equal(h.def, 5);
});
