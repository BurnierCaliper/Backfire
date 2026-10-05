// 主持人后台：按叙事直接改角色被动 / 资源数值和聚焦
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(party) {
  const c = H.load();
  c.BattleSim.setup({ party: party || ["ras", "helu", "nora", "kolt"], enemies: [{ id: "bandit_boss", lv: 1, zone: 2 }], seed: "BSP" });
  c.startCombat();
  return { c, st: c.S.state, foe: c.S.state.units.find(u => !u.isPlayer) };
}
const send = (c, cmd) => c.Commands.dispatch(plain(Object.assign({ type: "backstage" }, cmd)));

test("拉斯缪尔：光能、累积能量 %、不稳态都能直接改", () => {
  const { c, st } = field();
  const ras = c.findKit("ras", st.units);
  send(c, { action: "passive", actor: ras.id, key: "light", value: 12 });
  send(c, { action: "passive", actor: ras.id, key: "energyPct", value: "85" });
  send(c, { action: "passive", actor: ras.id, key: "unstable", value: true });
  assert.equal(ras.resources.light, 12);
  assert.equal(ras.resources.energyPct, 85);
  assert.equal(ras.resources.unstable, true);
  send(c, { action: "passive", actor: ras.id, key: "light", value: -5 });
  assert.equal(ras.resources.light, 0, "数字夹在范围里");
});

test("Helumica 是否扫描过、柯尔特刀头、诺拉情绪（维塔斯跟着变）", () => {
  const { c, st } = field();
  const helu = c.findKit("helu", st.units), kolt = c.findKit("kolt", st.units), nora = c.findKit("nora", st.units);
  helu.resources.scanned = true;
  send(c, { action: "passive", actor: helu.id, key: "scanned", value: false });
  assert.equal(helu.resources.scanned, false);
  send(c, { action: "passive", actor: kolt.id, key: "bit", value: "acid" });
  assert.equal(kolt.resources.bit, "acid");
  const vitas = c.spawnWeapon(nora, "vitas");
  send(c, { action: "passive", actor: nora.id, key: "mood", value: "cruel" });
  assert.equal(nora.resources.mood, "cruel");
  assert.equal(vitas.resources.mood, "cruel");
});

test("不在表里的键、表外的选项值一律拒绝", () => {
  const { c, st } = field();
  const kolt = c.findKit("kolt", st.units);
  assert.throws(() => send(c, { action: "passive", actor: kolt.id, key: "hp", value: 1 }));
  assert.throws(() => send(c, { action: "passive", actor: kolt.id, key: "bit", value: "laser" }));
});

test("聚焦：指定层和序列、已推进步数；留空随机；可以清除", () => {
  const { c, foe } = field();
  const layer = foe.layers[0].type;
  send(c, { action: "focus", actor: foe.id, op: "set", layerType: layer, seq: "火 电 冰", step: 1 });
  assert.equal(foe.focuses.length, 1);
  assert.equal(foe.focuses[0].seq.join(","), "fire,electric,ice");
  assert.equal(foe.focuses[0].step, 1);
  send(c, { action: "focus", actor: foe.id, op: "set", layerType: layer, seq: "" });
  assert.equal(foe.focuses[0].seq.length, c.focusSeqLen(foe), "留空按规则随机");
  send(c, { action: "focus", actor: foe.id, op: "clear", layerType: layer });
  assert.equal(foe.focuses.length, 0);
});

test("后台面板列出被动和聚焦两节", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /角色被动 \/ 资源/);
  assert.match(src, /data-focusset/);
});
