// 战斗日志按时间顺序：先发生的先写；架势变化（命中、震荡压上限、二次盾突）都写出来
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "LOGCHRONO" });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 3; h.bonus = 2; });
  const foe = S.units.find(u => !u.isPlayer);
  foe.zone = 1;
  return { c, S, foe, K: k => c.findKit(k, S.units) };
}
const allLines = S => S.logPages.flatMap(p => p.lines.map(l => l.text));

function bash(melt, again) {
  const { c, S, foe, K } = setup(["tou"]);
  const t = K("tou");
  foe.layers = [{ type: "sand", current: 222, max: 222 }, { type: "flesh", current: 200, max: 200 }];
  foe.def = foe.defMax = 12; if (melt) foe.instant = { melt: true };
  t.resources.shield = 2;
  const from = allLines(S).length;
  c.Commands.dispatch(plain({ type: "skill", actor: t.id, skill: "tou_bash", picks: { dest: 1, target: foe.id, again: again ? "yes" : "no" } }));
  return { foe, L: allLines(S).slice(from) };
}

test("盾击突进：先挂震荡（压上限）→ 再结算这一击（熔融 +1 击破）→ 二次盾突，日志同样顺序", () => {
  const { foe, L } = bash(true, true);
  const at = re => L.findIndex(s => re.test(s));
  const wave = at(/狂徒（匕首） 震荡。/);
  const cap = at(/震荡：架势上限 −2 → 10，架势 12 → 10。/);
  const head = at(/→ 狂徒（匕首）：\d+ 伤害、1 击破，架势 10 → 9/);
  const melt = at(/熔融沙尘：击破 \+1/);
  const again = at(/受到 1 击破（二次盾突）：架势 9 → 8/);
  [wave, cap, head, melt, again].forEach((i, k) => assert.ok(i >= 0, `第 ${k} 行缺失：\n${L.join("\n")}`));
  assert.ok(wave < cap && cap < head && head < melt && melt < again, L.join("\n"));
  assert.equal(foe.defMax, 10);
  assert.equal(foe.def, 8);   // 12 →（震荡）10 →（熔融 +1 击破）9 →（二次盾突）8
});

test("盾击突进：没有熔融时这一击 0 击破，12 → 10（震荡）→ 10 → 9（二次盾突）", () => {
  const { foe } = bash(false, true);
  assert.equal(foe.def, 9);
  assert.equal(bash(false, false).foe.def, 10);
});

test("技能里攒着的话不会被中途直接写的日志抢到前面", () => {
  const { c } = setup(["tou"]);
  const sink = c.withLogSink(() => {
    const lines = [];
    c.withPendingLines(lines, () => {
      lines.push("先发生");
      c.appendLog("后发生");
      lines.push("最后");
      c.appendLog(lines.join("\n"));   // 写自己攒的话：不重复
    });
  });
  assert.deepEqual(Array.from(sink), ["先发生", "后发生", "最后"]);
});

test("震荡压低架势上限时，当前架势被压下来也写进日志", () => {
  const { c, S, foe } = setup(["tou"]);
  foe.def = foe.defMax = 8;
  foe.statuses.shockwave = true;
  const from = allLines(S).length;
  c.popStatus(foe, "shockwave");
  assert.equal(foe.def, 6);
  assert.ok(allLines(S).slice(from).some(s => /震荡：架势上限 −2 → 6，架势 8 → 6。/.test(s)));
});

// ---- 多步技能按说明的顺序结算 ----
function field2(party, enemies) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "STEPS" });
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 5; h.bonus = 5; });
  S.units.filter(u => !u.isPlayer).forEach(f => { f.layers = [{ type: "flesh", current: 300, max: 300 }]; f.def = f.defMax = 10; });
  return { c, S, K: k => c.findKit(k, S.units), foes: S.units.filter(u => !u.isPlayer) };
}

test("逃离：先移动 → 累积 20% 能量 → 再按远距离攻击打原区域的敌人；日志同序", () => {
  const { c, S, K, foes } = field2(["ras"]);
  const ras = K("ras"), foe = foes[0];
  ras.zone = 1; foe.zone = 1;
  const from = allLines(S).length;
  const h0 = c.totalHp(foe);
  c.Commands.dispatch(plain({ type: "skill", actor: ras.id, skill: "ras_flee", picks: { dest: 2, target: foe.id } }));
  assert.equal(ras.zone, 2);
  assert.ok(c.totalHp(foe) < h0, "打到了原区域的敌人");
  const L = allLines(S).slice(from);
  const at = re => L.findIndex(s => re.test(s));
  const mv = at(/逃离：从 1 区到 2 区/), en = at(/累积能量 \+20%/), hit = at(/→ 狂徒（匕首）：\d+ 伤害/);
  assert.ok(mv >= 0 && en > mv && hit > en, L.join("\n"));
});

test("逃离：不稳态走远了（距离 2）也能打到原区域的敌人，按远距离判定（不付近程打飞行的附赠行动）", () => {
  const { c, S, K, foes } = field2(["ras"]);
  S.zoneMode = 3;
  const ras = K("ras"), foe = foes[0];
  ras.zone = 1; foe.zone = 1; foe.flying = true;
  ras.resources.unstable = true; ras.resources.energyPct = 120;
  const b0 = ras.bonus, h0 = c.totalHp(foe);
  c.Commands.dispatch(plain({ type: "skill", actor: ras.id, skill: "ras_flee", picks: { dest: 3, target: foe.id } }));
  assert.equal(ras.zone, 3);
  assert.ok(c.totalHp(foe) < h0, "距离 2 也打到了");
  assert.equal(ras.bonus, b0, "远距离攻击：不用为近程打飞行付附赠行动");
});

test("圣战起始：带的人和灯一起到 → 再施加错位；日志同序", () => {
  const { c, S, K, foes } = field2(["tou", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const tou = K("tou"), kolt = K("kolt"), foe = foes[0];
  tou.zone = kolt.zone = 1; foe.zone = 2; tou.resources.shield = 2;
  const from = allLines(S).length;
  c.Commands.dispatch(plain({ type: "skill", actor: tou.id, skill: "tou_start", picks: { dest: 2, target: foe.id, carryMode: "yes", carry: kolt.id } }));
  assert.equal(tou.zone, 2); assert.equal(kolt.zone, 2);
  assert.equal(tou.resources.shield, 1);
  const L = allLines(S).slice(from);
  const at = re => L.findIndex(s => re.test(s));
  const carry = at(/随圣战起始一起移动：1 区 → 2 区/), shift = at(/对 狂徒（匕首） 施加错位/);
  assert.ok(carry >= 0 && shift > carry, L.join("\n"));
});

test("绯秋居合普攻：深渊里的目标（飞行）不列出，也不能硬选", () => {
  const { c, S, K, foes } = field2(["hiaki"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const h = K("hiaki"), foe = foes[0];
  h.zone = 1; foe.zone = 2; foe.flying = true;
  h.resources.stance = "iai";
  S.fields[2] = Object.assign({}, S.fields[2] || {}, { abyss: true });
  assert.equal(c.skillTargetMoveOk(h, "hiaki_aa", foe), false);
  S.fields[2].abyss = false;
  assert.equal(c.skillTargetMoveOk(h, "hiaki_aa", foe), true);
  S.fields[2].abyss = true;
  const ap0 = h.ap;
  S.targetId = foe.id;
  c.Commands.dispatch(plain({ type: "skill", actor: h.id, skill: "hiaki_aa", target: foe.id }));
  assert.equal(h.zone, 1, "没有走进深渊");
  assert.equal(h.ap, ap0, "不扣行动点");
});
