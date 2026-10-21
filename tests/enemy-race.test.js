// 敌人种族（基础部分，docs/enemy-race.md）：种族配置、随机 / 固定分配、六维换算、开关、显示、联机白名单、主持人指定
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const gmSource = new vm.Script(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), { filename: "gm-commands.js" });
const plain = v => JSON.parse(JSON.stringify(v));

function ctx() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [], seed: "RACE" });
  return c;
}
const info = (c, id) => plain(vm.runInContext("ENEMY_INFO", c)[id]);
const baseOf = (c, id, lv) => c.enemyPresets().find(p => p.id === id).build(lv, 2);
const flesh = u => u.layers[u.layers.length - 1];
/** 抽 n 次，返回各结果的占比 */
function shares(c, table, n, key) {
  const cnt = {};
  for (let i = 0; i < n; i++) { const r = c.raceRoll(table); const k = key(r); cnt[k] = (cnt[k] || 0) + 1; }
  Object.keys(cnt).forEach(k => { cnt[k] /= n; });
  return cnt;
}
const near = (got, want, tol, msg) => assert.ok(Math.abs((got || 0) - want) <= tol, `${msg}：${got} 应接近 ${want}`);

test("权重：盗匪 人类 60 / 红皮人 20 / 类人 20，四个大支各 5%、小分支再平分", () => {
  const c = ctx(), N = 60000;
  const tbl = plain(vm.runInContext("ENEMY_RACE_TABLES", c).bandit);
  const big = shares(c, tbl, N, r => r.race);
  near(big["人类"], 0.6, 0.015, "人类"); near(big["红皮人"], 0.2, 0.012, "红皮人");
  ["犬类人", "猫类人", "鼠类人", "牛类人"].forEach(r => near(big[r], 0.05, 0.007, r));
  const small = shares(c, tbl, N, r => r.race + "·" + (r.branch || ""));
  near(small["犬类人·狼"], 0.05 / 3, 0.006, "犬类人·狼"); near(small["鼠类人·兔"], 0.025, 0.006, "鼠类人·兔");
  near(small["牛类人·羊"], 0.05 / 3, 0.006, "牛类人·羊");
  // 狂徒两种、强盗头子、亡命之王、燃气收集机、蚁型两种都按表来
  ["thug_knife", "thug_hammer", "bandit_boss", "outlaw_king"].forEach(id => { assert.deepEqual(info(c, id).races, tbl, id); assert.equal(info(c, id).raceAttrs, true, id); });
});

test("权重：燃气收集机类人四个大支各 25%；蚁型兽人五支，猫约 6.7%、其余各约 23.3%，且不套六维", () => {
  const c = ctx(), N = 60000;
  const gas = info(c, "gas_collector");
  assert.equal(gas.raceAttrs, true);
  const g = shares(c, gas.races, N, r => r.race);
  ["犬类人", "猫类人", "鼠类人", "牛类人"].forEach(r => near(g[r], 0.25, 0.012, r));
  assert.equal(g["人类"], undefined);
  ["ant_guard", "ant_hunter"].forEach(id => {
    const a = info(c, id);
    assert.ok(!a.raceAttrs, id + " 不套六维");
    const s = shares(c, a.races, N, r => r.race + "·" + r.branch);
    near(s["兽人·猫"], 0.0667, 0.01, "猫"); ["狼", "牛", "蜥蜴", "熊"].forEach(b => near(s["兽人·" + b], 0.2333, 0.012, b));
  });
});

test("固定种族：警卫队队长、矿场监工、赤牙；数值不变，不受个体值开关影响", () => {
  const c = ctx();
  const want = { captain_wolf: ["兽人", "狼"], captain_ox: ["兽人", "牛"], captain_lizard: ["兽人", "蜥蜴"], mine_overseer: ["兽人", "熊"], chixia: ["犬类人", "狼"] };
  Object.keys(want).forEach(id => {
    const base = baseOf(c, id, 8);
    const [u] = c.spawnEnemyGroup(id, 8, 2, 2, { hp: 0, atk: 0 });   // 个体值写 0，只看种族有没有动数值
    assert.deepEqual(plain(u.race), { race: want[id][0], branch: want[id][1] }, id);
    assert.equal(u.layers.map(l => l.max).join(), base.layers.map(l => l.max).join(), id + " 血量不变");
    assert.equal(u.atk, base.atk, id + " atk 不变"); assert.equal(u.defMax, base.defMax, id + " 架势不变");
  });
  // BattleSim.setup 默认关着随机，固定种族照样挂上
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "captain_ox", lv: 5, zone: 2 }], seed: "FX" });
  assert.equal(c.raceText(c.S.state.units.find(u => u.kit === "captain_ox")), "兽人·牛");
});

test("蚁型兵种：挂兽人的分支，但数值不变", () => {
  const c = ctx();
  ["ant_guard", "ant_hunter"].forEach(id => {
    const base = baseOf(c, id, 10);
    for (let i = 0; i < 20; i++) {
      const [u] = c.spawnEnemyGroup(id, 10, 2, 2, { hp: 0, atk: 0 });
      assert.equal(u.race.race, "兽人"); assert.ok(["狼", "牛", "蜥蜴", "猫", "熊"].includes(u.race.branch));
      assert.equal(u.layers.map(l => l.max).join(), base.layers.map(l => l.max).join());
      assert.equal(u.atk, base.atk); assert.equal(u.defMax, base.defMax);
    }
  });
});

test("六维：红皮人狂徒（锤）10 级肉体 85、atk 15（原本 74、13）；猫类人 / 鼠类人肉体 63", () => {
  const c = ctx();
  const base = baseOf(c, "thug_hammer", 10);
  assert.equal(flesh(base).max, 74); assert.equal(base.personalAtk, 13);
  const red = baseOf(c, "thug_hammer", 10); c.setEnemyRace(red, "红皮人");
  assert.equal(flesh(red).max, 85); assert.equal(flesh(red).current, 85);
  assert.equal(red.atk, 15); assert.equal(red.personalAtk, 15);
  assert.equal(c.effectiveAtk(red, [red]), 15, "出手用的 atk 也改了");
  ["猫类人·猫", "鼠类人·兔"].forEach(r => { const u = baseOf(c, "thug_hammer", 10); c.setEnemyRace(u, r); assert.equal(flesh(u).max, 63, r); });
  // 人类对敌人没有数值变化
  const hum = baseOf(c, "thug_hammer", 10); c.setEnemyRace(hum, "人类");
  assert.equal(flesh(hum).max, 74); assert.equal(hum.atk, 13); assert.equal(hum.defMax, base.defMax);
  // 牛类人·牛：力量 +2（atk 11 → 14 = 13 + 3）、耐力 +1（架势 +1）；鼠类人 耐力 −1 向上取整后架势不变
  const ox = baseOf(c, "thug_hammer", 10); c.setEnemyRace(ox, "牛类人·牛");
  assert.equal(ox.personalAtk, 16); assert.equal(ox.defMax, base.defMax + 1); assert.equal(flesh(ox).max, 74);
  const mouse = baseOf(c, "thug_hammer", 10); c.setEnemyRace(mouse, "鼠类人·鼠");
  assert.equal(mouse.defMax, base.defMax);
});

test("六维：体质只加在最内层肉体，护盾 / 装甲层不变（燃气收集机）", () => {
  const c = ctx();
  const base = baseOf(c, "gas_collector", 10);
  const u = baseOf(c, "gas_collector", 10); c.setEnemyRace(u, "猫类人·豹");
  assert.equal(u.layers.length, 3);
  assert.equal(u.layers[0].max, base.layers[0].max); assert.equal(u.layers[1].max, base.layers[1].max);
  assert.equal(flesh(u).max, flesh(base).max - 11);
  const k = baseOf(c, "bandit_boss", 10); const kb = baseOf(c, "bandit_boss", 10); c.setEnemyRace(k, "红皮人");
  assert.equal(k.layers[0].max, kb.layers[0].max, "强盗头子的装甲不变"); assert.equal(flesh(k).max, flesh(kb).max + 11);
});

test("六维：敏捷只对本来会格挡的敌人生效", () => {
  const c = ctx();
  const thug = baseOf(c, "thug_knife", 5); c.setEnemyRace(thug, "犬类人·狼");
  assert.equal(thug.raceBlock, undefined, "狂徒本来不格挡");
  assert.equal(c.blockChanceRaw(thug), null);
  const ox = baseOf(c, "captain_ox", 5), before = c.blockChanceRaw(ox);
  c.setEnemyRace(ox, "犬类人·狼", true);   // 牛队长本来格挡 40%；犬类人敏捷 +1 → +5%
  assert.equal(c.blockChanceRaw(ox), before + 5);
  c.setEnemyRace(ox, "红皮人", true);      // 改种族：先减掉旧的，敏捷 −1 → −5%
  assert.equal(c.blockChanceRaw(ox), before - 5);
});

test("顺序：先种族、再个体值（个体值按套完种族之后的数值算）", () => {
  const c = ctx();
  const base = baseOf(c, "thug_hammer", 5);
  const [u] = c.spawnEnemyGroup("thug_hammer", 5, 2, 2, { hp: 10, atk: 10 }, "红皮人");
  assert.equal(u.layers[0].max, Math.round((base.layers[0].max + 6) * 1.1));
  assert.equal(u.atk, Math.round((base.atk + c.raceDelta({ race: "红皮人" }, 5).atk) * 1.1 * 10) / 10);
});

test("开关：BattleSim.setup 默认不随机，随机种族一律当人类、数值不变；iv: true（单局）才随机", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_hammer", lv: 8, zone: 2 }, { id: "gas_collector", lv: 8, zone: 2 }], seed: "OFF" });
  c.S.state.units.filter(u => !u.isPlayer).forEach(u => {
    const base = baseOf(c, u.kit, 8);
    assert.deepEqual(plain(u.race), { race: "人类" }, u.kit);
    assert.equal(flesh(u).max, flesh(base).max); assert.equal(u.atk, base.atk);
  });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_hammer", lv: 8, zone: 2 }], seed: "ON" + i, iv: true });
    seen.add(c.raceText(c.S.state.units.find(u => !u.isPlayer)));
  }
  assert.ok(seen.size >= 3, "单局的战斗照常随机：" + [...seen].join());
  // 主持人指定的种族，关着也生效
  c.BattleSim.setup({ party: ["ruby"], enemies: [{ id: "thug_hammer", lv: 8, zone: 2, race: "红皮人" }], seed: "OFF2" });
  const u = c.S.state.units.find(x => !x.isPlayer);
  assert.equal(c.raceText(u), "红皮人"); assert.equal(flesh(u).max, flesh(baseOf(c, "thug_hammer", 8)).max + 9);
});

test("无种族的敌人没有 race，指定了也不生效", () => {
  const c = ctx();
  const [u] = c.spawnEnemyGroup("guard_sword", 3, 2, 2, null, "红皮人");
  assert.equal(u.race, undefined); assert.equal(c.raceText(u), "");
});

test("分支和统称：「类人」在四个大支里抽；写不认得的种族被忽略", () => {
  const c = ctx();
  for (let i = 0; i < 30; i++) {
    const u = baseOf(c, "thug_knife", 3); c.setEnemyRace(u, "类人");
    assert.ok(/类人$/.test(u.race.race) && u.race.branch, JSON.stringify(u.race));
  }
  assert.equal(c.raceParse("火星人"), null); assert.equal(c.raceParse("兽人·鼠"), null);
  const u = baseOf(c, "thug_knife", 3); c.applyEnemyIV(u, null, "火星人");
  assert.ok(u.race, "写错了就按配置抽");
});

test("主持人（gm 指令）：生成敌人可以指定种族；战斗中改种族按原始数值重算，个体值跟着重算", () => {
  const c = H.load(); gmSource.runInContext(c);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [], seed: "RACE-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: x => x === authority });
  const send = cmd => c.Commands.dispatch(plain(cmd), authority);
  const base = baseOf(c, "thug_hammer", 5);
  const out = send({ type: "gm.spawnEnemy", enemyId: "thug_hammer", level: 5, zone: 2, race: "红皮人", iv: { hp: 10, atk: 0 } });
  const u = c.S.state.units.find(x => x.id === out.ids[0]);
  assert.deepEqual(plain(u.race), { race: "红皮人" });
  assert.equal(flesh(u).max, Math.round((base.layers[0].max + 6) * 1.1));
  // 改种族：不叠加，按原始数值重算
  send({ type: "gm.editUnit", actor: u.id, patch: { race: "猫类人·猫" } });
  assert.equal(c.raceText(u), "猫类人·猫");
  assert.equal(flesh(u).max, Math.round((base.layers[0].max - 6) * 1.1));
  assert.deepEqual(plain(u.iv), { hp: 10, atk: 0 });
  send({ type: "gm.editUnit", actor: u.id, patch: { race: "人类" } });
  assert.equal(flesh(u).max, Math.round(base.layers[0].max * 1.1));
  assert.equal(u.atk, Math.round(base.atk * 1.0 * 10) / 10);
  // 非法 / 无种族的敌人被拒绝
  assert.throws(() => send({ type: "gm.spawnEnemy", enemyId: "thug_hammer", level: 5, zone: 2, race: "火星人" }), /种族/);
  const g = send({ type: "gm.spawnEnemy", enemyId: "guard_sword", level: 3, zone: 2 });
  assert.throws(() => send({ type: "gm.editUnit", actor: g.ids[0], patch: { race: "人类" } }), /没有种族/);
});

test("主持人（战斗模板）：敌人行（含援军）可以指定种族，空着 = 随机；写错的丢掉", () => {
  const c = ctx();
  const t = c.battleTemplateNormalize({ name: "R", enemies: [
    { preset: "thug_knife", level: 3, zone: 2, race: "红皮人" }, { preset: "thug_hammer", level: 3, zone: 2, race: "" }, { preset: "bandit_boss", level: 3, zone: 2, race: "火星人" }],
  waves: [{ turns: 2, enemies: [{ preset: "thug_knife", level: 3, zone: 2, race: "犬类人·狼" }] }] });
  assert.equal(t.enemies[0].race, "红皮人"); assert.equal(t.enemies[1].race, undefined); assert.equal(t.enemies[2].race, undefined);
  assert.equal(t.waves[0].enemies[0].race, "犬类人·狼");
  const enc = c.battleTemplateToEncounter(t);
  assert.equal(enc.waves[0].enemies[0].race, "犬类人·狼");
  c.buildEncounter(enc, 3, 2);
  const foes = c.S.state.units.filter(u => !u.isPlayer);
  assert.equal(c.raceText(foes.find(u => u.kit === "thug_knife")), "红皮人");
  assert.ok(c.raceText(foes.find(u => u.kit === "thug_hammer")), "空着的随机（这里 buildEncounter 在关着的状态下当人类）");
});

test("显示：图鉴固定写种族、随机写「随机：…」，遭遇过的记下见过哪些", () => {
  const c = ctx();
  const row = id => c.bestiaryEntries().find(e => e.kit === id);
  assert.equal(row("captain_ox").race, "兽人·牛");
  assert.equal(row("thug_hammer").race, "随机：人类 / 红皮人 / 类人");
  assert.equal(row("gas_collector").race, "随机：类人");
  assert.equal(row("ant_guard").race, "随机：兽人");
  assert.equal(row("guard_sword").race, "");
  c.bestiaryReset();
  const [u] = c.spawnEnemyGroup("thug_hammer", 3, 2, 2, null, "红皮人");
  c.S.state.units.push(u);
  c.bestiaryRecordBattle("win");
  assert.deepEqual(plain(row("thug_hammer").racesSeen), ["红皮人"]);
});

test("联机：种族是公开信息，投影带上（只放行文本）", () => {
  const c = ctx();
  const [u] = c.spawnEnemyGroup("thug_hammer", 3, 2, 2, null, "牛类人·马");
  const out = V.projectUnit(plain(u));
  assert.deepEqual(out.race, { race: "牛类人", branch: "马" });
  assert.equal(V.projectUnit({ ...plain(u), race: { race: "红皮人", secret: "SECRET" } }).race.secret, undefined);
  assert.equal(V.projectUnit({ ...plain(u), race: "乱写" }).race, undefined);
});
