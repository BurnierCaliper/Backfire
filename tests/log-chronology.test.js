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

test("盾击突进 + 熔融沙尘 + 二次盾突：每一步的架势都写出来，按发生顺序", () => {
  const { c, S, foe, K } = setup(["tou"]);
  const t = K("tou");
  foe.layers = [{ type: "sand", current: 222, max: 222 }, { type: "flesh", current: 200, max: 200 }];
  foe.def = foe.defMax = 12; foe.instant = { melt: true };
  t.resources.shield = 2;
  const from = allLines(S).length;
  c.Commands.dispatch(plain({ type: "skill", actor: t.id, skill: "tou_bash", picks: { dest: 1, target: foe.id, again: "yes" } }));
  const L = allLines(S).slice(from);
  const at = re => L.findIndex(s => re.test(s));
  const head = at(/→ 狂徒（匕首）：\d+ 伤害、1 击破，架势 12 → 11/);
  const melt = at(/熔融沙尘：击破 \+1/);
  const wave = at(/狂徒（匕首） 震荡。/);
  const cap = at(/震荡：架势上限 −2 → 10，架势 11 → 10。/);
  const bash = at(/受到 1 击破（二次盾突）：架势 10 → 9/);
  [head, melt, wave, cap, bash].forEach((i, k) => assert.ok(i >= 0, `第 ${k} 行缺失：\n${L.join("\n")}`));
  assert.ok(head < melt && melt < wave && wave < cap && cap < bash, L.join("\n"));
  assert.equal(foe.def, 9);   // 规则不变：12 → 11（熔融 +1）→ 10（震荡压上限）→ 9（二次盾突）
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
