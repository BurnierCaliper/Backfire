// 联机主持人的单位编辑器和单机的一样（app.js · renderEditor 的字段）：名称、即时效果、挂攻击效果、加 / 删血量层、层类型、中和、复制单位、自我效果
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const source = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const c = H.load(); source.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "GM-PARITY" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  const send = cmd => c.Commands.dispatch(plain(cmd), authority);
  const s = c.S.state;
  return { c, s, send, enemy: s.units.find(u => !u.isPlayer), hero: s.units.find(u => u.isPlayer && !u.weaponOf) };
}
const edit = (f, u, patch) => f.send({ type: "gm.editUnit", actor: u.id, patch });
function rejected(f, u, patch, re) {
  const before = JSON.stringify(f.s.units.find(x => x.id === u.id));
  assert.throws(() => edit(f, u, patch), re);
  assert.equal(JSON.stringify(f.s.units.find(x => x.id === u.id)), before, "被拒绝的修改不能改任何东西");
}

test("改名：和单机一样直接改；空名字 / 太长被拒绝", () => {
  const f = fixture();
  edit(f, f.enemy, { name: "  大刀  " });
  assert.equal(f.enemy.name, "大刀");
  rejected(f, f.enemy, { name: "   " }, /名称/);
  rejected(f, f.enemy, { name: "字".repeat(41) }, /名称/);
  rejected(f, f.enemy, { name: 5 }, /名称/);
});

test("即时效果：六种都能开关，别的键被拒绝", () => {
  const f = fixture();
  edit(f, f.enemy, { instant: { melt: true, refract: true } });
  assert.equal(f.enemy.instant.melt, true); assert.equal(f.enemy.instant.refract, true);
  edit(f, f.enemy, { instant: { melt: false } });
  assert.equal(f.enemy.instant.melt, false); assert.equal(f.enemy.instant.refract, true);
  rejected(f, f.enemy, { instant: { iceNext: true } }, /未知/);
  rejected(f, f.enemy, { instant: { melt: 1 } }, /布尔/);
  rejected(f, f.enemy, { instant: {} }, /为空/);
});

test("挂攻击效果：挂 / 取消下一击的属性专属效果，重复挂不重复记，未知的被拒绝", () => {
  const f = fixture();
  edit(f, f.hero, { atkFx: { combust: true, bolt: true } });
  edit(f, f.hero, { atkFx: { combust: true } });
  assert.deepEqual(plain(f.hero.resources.nextAtkFx).sort(), ["bolt", "combust"]);
  edit(f, f.hero, { atkFx: { bolt: false } });
  assert.deepEqual(plain(f.hero.resources.nextAtkFx), ["combust"]);
  rejected(f, f.hero, { atkFx: { nope: true } }, /攻击效果/);
});

test("加层 / 删层 / 改层类型：新层是 10/10 肉体；删层至少留一层；越界被拒绝", () => {
  const f = fixture();
  const n = f.enemy.layers.length;
  edit(f, f.enemy, { addLayer: true });
  assert.equal(f.enemy.layers.length, n + 1);
  assert.deepEqual(plain(f.enemy.layers.at(-1)), { type: "flesh", current: 10, max: 10 });
  edit(f, f.enemy, { layers: f.enemy.layers.map((l, i) => i === n ? { type: "armor", current: 4, max: 12 } : { current: l.current }) });
  assert.equal(f.enemy.layers[n].type, "armor"); assert.equal(f.enemy.layers[n].max, 12); assert.equal(f.enemy.layers[n].current, 4);
  rejected(f, f.enemy, { layers: f.enemy.layers.map(l => ({ type: "nope" })) }, /层类型/);
  edit(f, f.enemy, { removeLayer: n });
  assert.equal(f.enemy.layers.length, n);
  rejected(f, f.enemy, { removeLayer: 99 }, /没有这一层|合法范围/);
  while (f.enemy.layers.length > 1) edit(f, f.enemy, { removeLayer: 0 });
  rejected(f, f.enemy, { removeLayer: 0 }, /至少要留一层/);
});

test("自我效果：切到焚身给 1 层，切走清零（同单机 CalcCommands.self）", () => {
  const f = fixture();
  edit(f, f.enemy, { self: "burn" });
  assert.equal(f.enemy.self, "burn"); assert.equal(f.enemy.selfBurnStacks, 1);
  edit(f, f.enemy, { self: "none" });
  assert.equal(f.enemy.selfBurnStacks, 0);
});

test("结算中和：和单机一样走 applyNeutralize；不能写 false", () => {
  const f = fixture();
  edit(f, f.enemy, { statuses: { burn: 2 } });
  const r = edit(f, f.enemy, { neutralize: true });
  assert.ok(r.notes.some(x => /中和/.test(x)));
  rejected(f, f.enemy, { neutralize: false }, /只能写 true/);
});

test("复制单位：整份复制，名字加「 复制」，新单位要等到允许的敌方回合才行动；玩家角色、多部件敌人不能复制", () => {
  const f = fixture();
  const n = f.s.units.length, name = f.enemy.name;
  const out = f.send({ type: "gm.copyUnit", actor: f.enemy.id });
  const made = f.s.units.find(u => u.id === out.id);
  assert.equal(f.s.units.length, n + 1);
  assert.equal(made.name, name + " 复制"); assert.notEqual(made.id, f.enemy.id);
  assert.equal(made.zone, f.enemy.zone); assert.deepEqual(plain(made.layers), plain(f.enemy.layers));
  assert.ok(f.c.GMCommands.snapshot().units.some(u => u.id === made.id), "新单位登记了行动资格");
  assert.match(out.publicSummary, /复制/);
  assert.throws(() => f.send({ type: "gm.copyUnit", actor: f.hero.id }), /敌人/);
  assert.equal(f.s.units.length, n + 1);
});

test("界面：联机单位编辑器多出名称 / 即时效果 / 挂攻击效果 / 加删层 / 复制 / 回满架势 / 中和这些入口，并发对应的指令", () => {
  const ui = fs.readFileSync(path.join(H.ROOT, "online-gm-ui.js"), "utf8");
  for (const k of ["name:", "instant:", "atkFx:"]) assert.ok(ui.includes(k), k);
  for (const a of ["add-layer", "remove-layer", "neutralize", "full-def", "copy-unit"]) assert.ok(ui.includes(`"${a}"`), a);
  assert.match(ui, /type: "gm\.copyUnit"/);
  assert.match(ui, /patch: \{ addLayer: true \}/);
});
