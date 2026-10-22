// 制作材料（docs/workshop-design.md 第 4 节）：7 种、队伍公用、按敌人类型掉落、单局打赢后进背包、跑团黑市 3 倍价
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const build = (c, id, lv) => c.enemyPresets().find(x => x.id === id).build(lv || 10, 4);

test("7 种制作材料登记在物品表里：队伍公用、不是战斗道具", () => {
  const c = H.load();
  const mats = vm.runInContext("CRAFT_MATERIALS", c);
  assert.equal(mats.length, 7);
  mats.forEach(m => { const s = c.ITEM_CATALOG[m.id]; assert.ok(s && s.supply && !s.combat, m.id); });
});

test("掉落表按敌人登记：54 个敌人都有表；机械掉废料 / 线圈，酸火系掉化工残液，沙漠生物掉沙鱼鳞，星灵掉星灵组织", () => {
  const c = H.load();
  const ids = c.enemyPresets().map(p => p.id).filter(id => id !== "blank_pc");
  assert.equal(ids.length, 54);   // 下水道狂鼠的四个兵种（#277）加进来：50 → 54
  const T = vm.runInContext("ENEMY_DROPS", c), A = vm.runInContext("ENEMY_DROP_ALIAS", c);
  ids.forEach(id => assert.ok(T[A[id] || id], id));
  const has = (id, m) => c.enemyDropTable(id).some(d => d.id === m);
  assert.ok(has("guard_sword", "cm_coil") && has("guard_sword", "cm_scrap"));
  assert.ok(has("dumpdrone", "cm_chem") && has("gas_collector", "cm_gas"));
  assert.ok(has("sandfish_drive", "cm_scale") && has("meteor_spider", "cm_spirit"));
  assert.ok(has("thug_knife", "cm_scrap"), "狂徒现在也会掉破烂");
  assert.ok(has("dust_bug", "cm_scale") && c.enemyDropTable("dust_bug")[0].chance <= 0.15, "中立生物小概率");
  assert.deepEqual(c.enemyDropTable("ufo_boss"), c.enemyDropTable("ufo_body"));
  // 只出现制作材料
  const mats = vm.runInContext("CRAFT_MATERIALS", c).map(m => m.id);
  Object.values(T).forEach(t => Object.keys(t).forEach(id => assert.ok(mats.includes(id), id)));
});

test("rollEnemyDrops：可注入 rng（确定性）；p ≥ 1 保底，首领保底精制料", () => {
  const c = H.load();
  const J = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(J(c.rollEnemyDrops(["guard_sword"], () => 0.99)), [], "掷不中什么都没有");
  assert.deepEqual(J(c.rollEnemyDrops(["guard_sword"], () => 0)), [{ id: "cm_scrap", qty: 1 }, { id: "cm_coil", qty: 1 }, { id: "cm_cell", qty: 1 }]);
  const king = J(c.rollEnemyDrops([build(c, "outlaw_king")], () => 0.99));
  assert.ok(king.some(m => m.id === "cm_gas" && m.qty >= 1) && king.some(m => m.id === "cm_cell" && m.qty >= 1), "亡命之王保底燃气 + 电芯");
  assert.deepEqual(J(c.rollEnemyDrops([{ kit: "kolt", isPlayer: true }], () => 0)), []);
  const e = c.enemyDropExpected(["guard_sword", "guard_sword"]);
  assert.ok(Math.abs(e.cm_scrap - 0.5) < 1e-9);
});

test("单局打赢：打倒的敌人掉的材料合成一行进背包", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "MATS" });
  run.act = 1; run.actDay = 8; run.stage = "boss";
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const st = c.S.state;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  const before = vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);
  const notes = R.finishBattle(run, "win");
  const after = vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);
  assert.ok(after > before, "拿到了材料");
  assert.ok(notes.some(n => /^材料：/.test(n)), notes.join("\n"));
});

test("跑团物品表：制作材料在黑市按参考价 3 倍卖", () => {
  const c = H.load();
  const rows = vm.runInContext("HANDBOOK_SHOP", c).filter(r => r.group === "制作材料（黑市）");
  assert.equal(rows.length, 7);
  const scrap = rows.find(r => r.key === "cm_scrap");
  assert.equal(scrap.price, 300);
});

test("跑团打赢：打倒的敌人按同一张表掉材料进队伍背包，和主持人配的掉落合在一份结算里；输了不掉", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "outlaw_king", lv: 5, zone: 2 }], seed: "TRPGMAT" });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  c.S.state.battleDrops = { kuizhi: 50, items: [{ id: "medkit", qty: 1 }] };
  c.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
  const r = JSON.parse(JSON.stringify(c.settleBattleRewards("win")));
  assert.equal(r.drops.kuizhi, 50);
  assert.ok(r.drops.items.some(x => x.id === "medkit"), "主持人配的照给");
  assert.ok(r.drops.items.some(x => x.id === "cm_gas" && x.qty >= 1), "亡命之王保底燃气浓缩物");
  assert.ok(c.bagCount("cm_gas") >= 1 && c.bagCount("medkit") === 1);
  assert.doesNotMatch(JSON.stringify(r.drops), /shp|坚毅/);
  const c2 = H.load();
  c2.BattleSim.setup({ party: ["kolt"], enemies: [{ id: "outlaw_king", lv: 5, zone: 2 }], seed: "TRPGMAT2" });
  c2.S.TRPG.active = true; c2.S.state.bag = { items: [] };
  c2.settleBattleRewards("lose");
  assert.equal(c2.bagCount("cm_gas"), 0);
});

test("图鉴条目带可能掉的材料（数据）", () => {
  const c = H.load();
  const e = c.bestiaryEntries().find(x => x.kit === "gas_collector");
  assert.ok(e.drops.some(d => d.id === "cm_gas" && d.name === "燃气浓缩物" && d.chance > 0));
});

// —— 跑团路径（PR #172 审查补测）——
const J = x => JSON.parse(JSON.stringify(x));
const trpgBattle = (enemies, seed) => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed });
  c.S.TRPG.active = true;
  c.S.state.bag = { items: [] };
  return c;
};
const matTotal = c => vm.runInContext("CRAFT_MATERIALS", c).map(m => c.bagCount(m.id)).reduce((a, b) => a + b, 0);

test("跑团：打赢才掉，输了 / 撤退都不掉（掷骰全中也不掉）", () => {
  for (const outcome of ["win", "lose", "retreat"]) {
    const c = trpgBattle([{ id: "guard_sword", lv: 5, zone: 2 }, { id: "guard_gun", lv: 5, zone: 2 }], "TW" + outcome);
    vm.runInContext("Math.random = () => 0", c);
    c.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
    const r = c.settleBattleRewards(outcome);
    if (outcome === "win") { assert.ok(matTotal(c) > 0, "胜利掉材料"); assert.ok(r.drops && r.drops.items.length); }
    else { assert.equal(matTotal(c), 0, outcome + " 不掉"); assert.equal(r.drops, null); }
  }
});

test("跑团：同一场结算两次（rewardSettlement 已缓存）不重掷、不重复进背包", () => {
  const c = trpgBattle([{ id: "outlaw_king", lv: 5, zone: 2 }], "TWICE");
  c.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; });
  let calls = 0;
  vm.runInContext("Math.random = () => 0", c);
  const r1 = J(c.settleBattleRewards("win"));
  const bag1 = matTotal(c);
  c.__count = () => { calls++; return 0; };
  vm.runInContext("Math.random = () => __count()", c);
  const r2 = J(c.settleBattleRewards("win"));
  assert.equal(r2.alreadySettled, true);
  assert.equal(calls, 0, "第二次没有掷骰");
  assert.equal(matTotal(c), bag1, "背包没多");
  assert.deepEqual(r2.drops, r1.drops, "返回的是缓存的合并掉落");
});

test("mergeBattleDrops：同 id 合并数量；只有一边有值时原样返回；都没有为 null", () => {
  const c = H.load();
  const a = { kuizhi: 50, items: [{ id: "cm_scrap", name: "废料", qty: 1 }, { id: "medkit", name: "医疗包", qty: 1 }] };
  const b = { kuizhi: 0, items: [{ id: "cm_scrap", name: "废料", qty: 2 }, { id: "cm_cell", name: "电芯", qty: 1 }] };
  const m = J(c.mergeBattleDrops(a, b));
  assert.equal(m.kuizhi, 50);
  assert.deepEqual(m.items.map(x => [x.id, x.qty]), [["cm_scrap", 3], ["medkit", 1], ["cm_cell", 1]]);
  assert.equal(a.items[0].qty, 1, "不改原对象");
  assert.deepEqual(J(c.mergeBattleDrops(a, null)), J(a));
  assert.deepEqual(J(c.mergeBattleDrops(null, b)), J(b));
  assert.equal(c.mergeBattleDrops(null, null), null);
});

test("跑团：飞碟 Boss（ufo_boss → ufo_body 别名）按本体表掉，机械足空表不掉", () => {
  const c = trpgBattle([{ id: "ufo_boss", lv: 10, zone: 2 }], "UFO");
  vm.runInContext("Math.random = () => 0.99", c);   // 只剩整数保底
  const foes = c.S.state.units.filter(u => !u.isPlayer);
  assert.ok(foes.some(u => u.kit === "ufo_body"));
  foes.forEach(u => { u.dead = true; });
  assert.deepEqual(J(c.enemyDropTable("ufo_leg")), []);
  const r = J(c.settleBattleRewards("win"));
  const got = Object.fromEntries(r.drops.items.map(x => [x.id, x.qty]));
  assert.deepEqual(got, { cm_scrap: 1, cm_coil: 2, cm_cell: 2, cm_spirit: 1 }, JSON.stringify(got));
});

test("召唤物和铁壁不掉落", () => {
  const c = H.load();
  const summon = { kit: "guard_sword", dead: true, summonedBy: "x" };
  const wall = { kit: "ironwall", dead: true };
  const real = { kit: "guard_sword", dead: true };
  assert.deepEqual(J(c.enemyDropFoes([summon, wall, real, { kit: "guard_sword", dead: false }])), [real]);
  const t = trpgBattle([{ id: "guard_sword", lv: 5, zone: 2 }], "SUMMON");
  vm.runInContext("Math.random = () => 0", t);
  t.S.state.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.summonedBy = "boss"; });
  t.S.state.units.push({ kit: "ironwall", dead: true, isPlayer: false, layers: [] });
  t.settleBattleRewards("win");
  assert.equal(matTotal(t), 0);
});

test("第三采矿场：4 个杂兵一场期望约 2 份；按代币算（衍蛛两只一组）也在 1–3", () => {
  const c = H.load();
  const E = k => Object.values(c.enemyDropExpected([k])).reduce((a, b) => a + b, 0);
  const kits = ["alarm_bot", "meteor_miner", "meteor_spider", "meteor_centipede"];
  const avg4 = kits.reduce((a, k) => a + E(k), 0);   // 4 个杂兵随机抽 = 4 × 每种平均
  assert.ok(avg4 >= 1.9 && avg4 <= 2.1, "第三采矿场 4 杂兵期望 " + avg4.toFixed(2));
  const perToken = [E("alarm_bot"), E("meteor_miner"), 2 * E("meteor_spider"), E("meteor_centipede")];
  perToken.forEach(v => assert.ok(v * 4 >= 1 && v * 4 <= 3, String(v)));
});

test("穴鸦是食腐鸟：不掉沙鱼鳞，掉废料一类；一群 4 只约 1 份；材料说明对得上", () => {
  const c = H.load();
  const t = c.enemyDropTable("crow");
  assert.ok(!t.some(d => d.id === "cm_scale"));
  assert.ok(t.some(d => d.id === "cm_scrap"));
  const pack4 = 4 * t.reduce((a, d) => a + d.chance, 0);
  assert.ok(pack4 >= 0.95 && pack4 <= 1.15, "4 只 " + pack4);
  const mats = vm.runInContext("CRAFT_MATERIALS", c);
  assert.doesNotMatch(mats.find(m => m.id === "cm_scale").hint, /穴鸦/);
  assert.match(mats.find(m => m.id === "cm_scrap").hint, /穴鸦/);
});
