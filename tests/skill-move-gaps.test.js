// #340 第 4 条：直流短接、猛扑、发射针尖（温和）、针尖剑斩里的移动也要走得到（app.js · skillMoveWhy）——
// 危墙 / 关着的机关门 / 空隙挡路，地面单位不能主动进深渊。以前这四个技能直接改所在区，能穿墙；猛扑带不走目标时年糕自己照样过去
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, weather: "none", enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "G4" }, opt || {}));
  c.startCombat();
  const S = c.S.state;
  S.units.filter(u => !u.isPlayer).forEach(f => { f.layers = [{ type: "flesh", current: 300, max: 300, inner: true }]; });
  return { c, S, foe: S.units.find(u => !u.isPlayer), kit: k => S.units.find(u => u.kit === k && !u.hidden) };
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const ready = (u, zone) => { if (zone != null) u.zone = zone; u.ap = 5; u.bonus = 5; };
// 1–2 区之间挡路的三种间隔
const BLOCKERS = {
  危墙: () => ({ type: "wall", hp: 8, maxHp: 8, open: false }),
  关着的门: () => ({ type: "door", open: false }),
  空隙: () => ({ type: "void" })
};
function withMochi(gap) {
  const f = setup(["tou", "kolt"]);
  if (gap) f.S.gaps["1-2"] = gap();
  const m = f.c.spawnWeapon(f.kit("tou"), "mochi");
  ready(m, 1);
  return Object.assign(f, { m });
}
/** 诺拉在 2 区刺入同区的敌人，维塔斯分出来站在 1 区 */
function withVitas(gap) {
  const f = setup(["nora", "kolt"]);
  if (gap) f.S.gaps["1-2"] = gap();
  const n = f.kit("nora");
  n.zone = 2; n.level = 5; n.resources.mood = "gentle";
  f.c.setPierce(n, f.foe, []);
  const v = f.c.spawnWeapon(n, "vitas");
  ready(v, 1); v.level = 5;
  return Object.assign(f, { n, v });
}

test("直流短接：危墙 / 关着的门 / 空隙那边的区不列出；硬选也不扣行动点、不过去、不铺场地", () => {
  for (const [name, gap] of Object.entries(BLOCKERS)) {
    const { c, S, kit } = setup(["kolt", "helu"]);
    S.gaps["1-2"] = gap();
    const k = kit("kolt");
    ready(k, 1); k.resources.bit = "drill";
    assert.deepEqual(plain(c.skillFlowSteps("kolt_short", k, {})[0].zones), [1], name + "：只剩原区");
    cmd(c, { actor: k.id, skill: "kolt_short", picks: { dest: 2 } });
    assert.equal(k.zone, 1, name + "：没有过去");
    assert.equal(k.ap, 5, name + "：不扣行动点");
    assert.ok(!S.fields[2].electric && !S.fields[1].electric, name + "：哪一区都没铺高压场地");
  }
});

test("直流短接：门开着照常移过去再铺场地；原区铺不了、旁边又过不去时整个技能不能用", () => {
  const { c, S, kit } = setup(["kolt", "helu"]);
  S.gaps["1-2"] = { type: "door", open: true };
  const k = kit("kolt");
  ready(k, 1); k.resources.bit = "drill";
  assert.deepEqual(plain(c.skillFlowSteps("kolt_short", k, {})[0].zones), [1, 2]);
  cmd(c, { actor: k.id, skill: "kolt_short", picks: { dest: 2 } });
  assert.equal(k.zone, 2);
  assert.equal(k.ap, 4);
  assert.ok(S.fields[2].electric, "2 区变成高压场地");
  // 原区是固有场地铺不了、2 区隔着危墙：一个能选的区都没有，按钮直接不能用（以前列出 2 区，穿墙过去铺）
  const b = setup(["kolt", "helu"]);
  const k2 = b.kit("kolt");
  ready(k2, 1); k2.resources.bit = "drill";
  b.S.fields[1].innate = true;
  b.S.gaps["1-2"] = BLOCKERS.危墙();
  assert.match(b.c.skillRequirementError(k2, "kolt_short") || "", /没有能变成高压场地/);
  b.S.gaps["1-2"] = { type: "open" };
  assert.equal(b.c.skillRequirementError(k2, "kolt_short"), null, "墙没了就能用");
});

test("猛扑：隔着危墙 / 关着的门的敌人不列出，硬选也不扣行动点、不过去、不掉血；空隙那边照样能扑过去（猛扑是「跃」）", () => {
  for (const name of ["危墙", "关着的门"]) {
    const { c, foe, m } = withMochi(BLOCKERS[name]);
    const units = c.skillFlowSteps("mochi_pounce", m, {})[0].units.map(u => u.id);
    assert.ok(!units.includes(foe.id), name + "：目标不列出");
    const hp0 = c.totalHp(foe);
    cmd(c, { actor: m.id, skill: "mochi_pounce", target: foe.id, picks: { target: foe.id } });
    assert.equal(m.zone, 1, name + "：年糕没有过去");
    assert.equal(m.ap, 5, name + "：不扣行动点");
    assert.equal(c.totalHp(foe), hp0, name + "：没有挨打");
  }
  // 作者裁定（README「按作者裁定调整第二批规则修复」）：猛扑和飞行一样能越过空隙，不花越过空隙的行动点
  const { c, foe, m } = withMochi(BLOCKERS.空隙);
  assert.ok(c.skillFlowSteps("mochi_pounce", m, {})[0].units.some(u => u.id === foe.id));
  const hp0 = c.totalHp(foe);
  cmd(c, { actor: m.id, skill: "mochi_pounce", target: foe.id, picks: { target: foe.id } });
  assert.equal(m.zone, 2);
  assert.equal(m.ap, 4, "只花猛扑本身的 1 行动点");
  assert.ok(c.totalHp(foe) < hp0);
});

test("猛扑带走同区目标：目标带不动（千钧）时年糕也留在原区，照样在原区出手", () => {
  const { c, S, m } = withMochi();
  const foe = S.units.find(u => !u.isPlayer);
  foe.zone = 1; foe.self = "anchor";
  const hp0 = c.totalHp(foe);
  cmd(c, { actor: m.id, skill: "mochi_pounce", target: foe.id, picks: { target: foe.id, dest: 2 } });
  assert.equal(foe.zone, 1, "千钧：没被带走");
  assert.equal(m.zone, 1, "年糕也没过去（以前自己跳到 2 区，再隔着一区打同区的招）");
  assert.ok(c.totalHp(foe) < hp0, "照样出手");
  assert.match(logText(S), /无法被移动/);
});

test("猛扑带走同区目标：年糕是地面单位，深渊区不列出、硬选也不扣点（以前年糕站进深渊不掉下去）；一个能带去的区都没有时同区目标也不列出", () => {
  const { c, S, m } = withMochi();
  S.zoneMode = 3;
  S.fields[3] = S.fields[3] || {};
  S.fields[2].abyss = true;
  const foe = S.units.find(u => !u.isPlayer);
  foe.zone = 1;
  const steps = c.skillFlowSteps("mochi_pounce", m, { target: foe.id });
  assert.ok(!steps[1].zones.includes(2), "深渊区不列出");
  cmd(c, { actor: m.id, skill: "mochi_pounce", target: foe.id, picks: { target: foe.id, dest: 2 } });
  assert.equal(m.zone, 1);
  assert.equal(foe.zone, 1);
  assert.equal(m.ap, 5, "不扣行动点");
  // 两区制：另一区是深渊（隔着危墙也一样），同区的目标没地方带，不列出（以前列出来，选完卡在选区那一步）
  const b = withMochi();
  b.foe.zone = 1;
  b.S.fields[2].abyss = true;
  assert.ok(!b.c.skillFlowSteps("mochi_pounce", b.m, {})[0].units.some(u => u.id === b.foe.id), "没地方带：不列出");
  b.S.fields[2].abyss = false;
  b.S.gaps["1-2"] = BLOCKERS.危墙();
  assert.ok(!b.c.skillFlowSteps("mochi_pounce", b.m, {})[0].units.some(u => u.id === b.foe.id), "隔着危墙：不列出");
  b.S.gaps["1-2"] = { type: "open" };
  assert.ok(b.c.skillFlowSteps("mochi_pounce", b.m, {})[0].units.some(u => u.id === b.foe.id), "有地方带就列出");
});

test("温和的发射针尖：目标那一区走不过去（危墙 / 关着的门 / 空隙）时诺拉留在原区、日志写原因，刺入照旧", () => {
  for (const [name, gap] of Object.entries(BLOCKERS)) {
    const { c, S, foe, kit } = setup(["nora", "kolt"]);
    S.gaps["1-2"] = gap();
    const n = kit("nora");
    ready(n, 1); n.resources.mood = "gentle";
    cmd(c, { actor: n.id, skill: "nora_needle", target: foe.id });
    assert.equal(n.zone, 1, name + "：诺拉没有过去");
    assert.ok(c.piercedTargets(n).some(u => u.id === foe.id), name + "：刺入照旧（隔墙能不能刺入另见体检「需要作者确认」）");
    assert.match(logText(S), /温和：诺拉没有移动/, name);
  }
});

test("温和的发射针尖：没挡着照常移到目标那一区；目标飞在深渊上时不跟进去", () => {
  const { c, S, foe, kit } = setup(["nora", "kolt"]);
  const n = kit("nora");
  ready(n, 1); n.resources.mood = "gentle";
  cmd(c, { actor: n.id, skill: "nora_needle", target: foe.id });
  assert.equal(n.zone, 2);
  const b = setup(["nora", "kolt"]);
  const n2 = b.kit("nora");
  ready(n2, 1); n2.resources.mood = "gentle";
  b.S.fields[2].abyss = true; b.foe.flying = true;
  cmd(b.c, { actor: n2.id, skill: "nora_needle", target: b.foe.id });
  assert.equal(n2.zone, 1, "地面单位不能主动走进深渊");
  assert.ok(b.c.piercedTargets(n2).some(u => u.id === b.foe.id));
});

test("针尖剑斩：走不到刺入目标那一区（危墙 / 关着的门 / 空隙）就不能用（按钮写原因），不扣行动点、不出手；门开着照常先移过去再斩", () => {
  for (const [name, gap] of Object.entries(BLOCKERS)) {
    const { c, S, foe, v } = withVitas(gap);
    assert.match(c.skillRequirementError(v, "vitas_slash") || "", /走不到刺入目标.*2 区/, name + "：按钮直接写原因");
    const hp0 = c.totalHp(foe);
    // 有刺入对象时不用选目标（画面上就是这样直接放的）
    cmd(c, { actor: v.id, skill: "vitas_slash" });
    assert.equal(v.zone, 1, name + "：维塔斯没有过去");
    assert.equal(v.ap, 5, name + "：不扣行动点");
    assert.equal(c.totalHp(foe), hp0, name + "：没有出手");
    assert.match(logText(S), /走不到刺入目标/, name);
  }
  const { c, foe, v } = withVitas(() => ({ type: "door", open: true }));
  assert.equal(c.skillRequirementError(v, "vitas_slash"), null);
  const hp0 = c.totalHp(foe);
  cmd(c, { actor: v.id, skill: "vitas_slash" });
  assert.equal(v.zone, 2);
  assert.equal(v.ap, 4);
  assert.ok(c.totalHp(foe) < hp0);
});

test("联机 / 热座校验：直流短接、猛扑穿墙的选择和走不到刺入目标的针尖剑斩都拒绝；温和的发射针尖放行（只是不移动）", () => {
  const load = (f) => { vm.runInContext(fs.readFileSync(path.join(H.ROOT, "hotseat-validation.js"), "utf8"), f.c, { filename: "hotseat-validation.js" }); return f; };
  const validate = (c, o) => c.HotseatValidation.validateBattle(plain(Object.assign({ type: "skill", target: null, picks: {} }, o)),
    { session: { assertAction() { return true; } }, sender: "p1" });
  {
    const { c, S, kit } = load(setup(["kolt", "helu"]));
    S.gaps["1-2"] = BLOCKERS.危墙();
    const k = kit("kolt"); ready(k, 1); k.resources.bit = "drill";
    assert.throws(() => validate(c, { actor: k.id, skill: "kolt_short", picks: { dest: 2 } }), /分步选择/);
    assert.equal(validate(c, { actor: k.id, skill: "kolt_short", picks: { dest: 1 } }), true);
  }
  {
    const f = withMochi(BLOCKERS.关着的门); load(f);
    assert.throws(() => validate(f.c, { actor: f.m.id, skill: "mochi_pounce", target: f.foe.id, picks: { target: f.foe.id } }), /分步选择/);
  }
  {
    const f = withVitas(BLOCKERS.危墙); load(f);
    assert.throws(() => validate(f.c, { actor: f.v.id, skill: "vitas_slash" }), /危墙/);
  }
  {
    const { c, S, foe, kit } = load(setup(["nora", "kolt"]));
    S.gaps["1-2"] = BLOCKERS.危墙();
    const n = kit("nora"); ready(n, 1); n.resources.mood = "gentle";
    assert.equal(validate(c, { actor: n.id, skill: "nora_needle", target: foe.id }), true);
  }
});
