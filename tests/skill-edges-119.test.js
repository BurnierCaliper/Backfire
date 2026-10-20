// #119：击破 / 屏障相关的技能边角——盾击突进 / 全速撞击 × 屏障、巨刃划空改砍屏障 × 危墙、收发代理锁定、特盛乱打瞬斩距离
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

function setup(party, enemyZone) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: enemyZone || 2 }], seed: "E119" });
  c.startCombat();
  const S = c.S.state;
  if (enemyZone === 3) { S.board = null; S.zoneMode = 3; }   // 三区直排：1 区到 3 区距离 2
  const foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 300, max: 300, inner: true }];
  foe.def = foe.defMax = 10; foe.zone = enemyZone || 2;
  S.units.filter(u => u.isPlayer).forEach(h => { h.zone = 1; h.level = 11; h.ap = 5; h.bonus = 5; });
  const K = k => c.findKit(k, S.units);
  return { c, S, foe, K };
}

test("盾击突进打屏障后的敌人：屏障吃下这一击，震荡不挂在目标身上", () => {
  const { c, S, foe, K } = setup(["tou"]);
  const t = K("tou");
  t.resources.shield = 0;
  const wall = c.makeProp("scrapwall", 2, 1); wall.hp = wall.maxHp = 999; S.props.push(wall);
  const hp = c.totalHp(foe), d0 = foe.def;
  cmd(c, { actor: t.id, skill: "tou_bash", picks: { dest: 2, target: foe.id } });
  assert.equal(t.zone, 2);
  assert.ok(wall.hp < 999, "屏障挨了这一击");
  assert.equal(c.totalHp(foe), hp);
  assert.ok(!(foe.statuses && foe.statuses.shockwave), "没有震荡");
  assert.equal(foe.def, d0);
  assert.equal(foe.defMax, 10);
});

test("没有屏障时盾击突进照常挂震荡", () => {
  const { c, foe, K } = setup(["tou"]);
  const t = K("tou");
  t.resources.shield = 0;
  cmd(c, { actor: t.id, skill: "tou_bash", picks: { dest: 2, target: foe.id } });
  assert.ok(foe.statuses.shockwave);
});

test("巨刃划空改砍屏障：隔着危墙打不到，不耗电能、屏障和危墙都没动", () => {
  const { c, S, foe, K } = setup(["chuan"]);
  const ch = K("chuan");
  ch.resources.charge = 3;
  const wall = c.makeProp("scrapwall", 2, 1); wall.hp = wall.maxHp = 999; S.props.push(wall);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 25, maxHp: 25, level: 1 });
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: foe.id, picks: { target: foe.id } });
  assert.equal(wall.hp, 999, "屏障没挨砍");
  assert.equal(S.gaps["1-2"].hp, 25);
  assert.equal(ch.resources.charge, 3, "没出手不耗电能");
});

test("收发代理（银翼）：目标在距离 2 / 躲藏 / 下潜时打不到，不扣纳米", () => {
  for (const mode of ["far", "hide", "dive"]) {
    const { c, S, foe, K } = setup(["ruby"], mode === "far" ? 3 : 2);
    const r = K("ruby");
    r.zone = 1;
    r.resources.drone = true; r.resources.mecha = true; r.resources.nano = 100;
    if (mode === "hide") foe.statuses = Object.assign(foe.statuses || {}, { hide: true });
    if (mode === "dive") foe.submerged = true;
    const hp = c.totalHp(foe);
    c.turnEnd();
    assert.equal(c.totalHp(foe), hp, mode);
    assert.equal(r.resources.nano, 80, mode + "：只扣机甲维持 20，无人机不耗纳米");
  }
});

test("特盛乱打：进入居合时距离 2 的被标记敌人也砍得到", () => {
  const { c, S, foe, K } = setup(["hiaki"], 3);
  const h = K("hiaki");
  assert.equal(c.zoneDist(h.zone, foe.zone, S.zoneMode), 2);
  foe.barrageBy = h.id;
  const hp = c.totalHp(foe);
  c.setHiakiStance(h, "iai");
  assert.ok(c.totalHp(foe) < hp, "距离 2 也被砍到");
  assert.equal(foe.barrageBy, null);
});
