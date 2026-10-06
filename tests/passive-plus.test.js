// 被动升级（武器 5 级 → 被动 1+，10 级 → 被动 2+）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

/** party：角色；wlv：每个角色的武器等级 */
function field(party, wlv, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies: [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "PP" }, opt || {}));
  const st = c.S.state;
  st.units.filter(u => u.isPlayer && u.linkedKits).forEach(u => u.linkedKits.forEach(k => { u.weaponLevels[k] = wlv; }));
  return { c, st, foes: () => st.units.filter(u => !u.isPlayer && !u.hidden) };
}
const K = (c, st, kit) => c.findKit(kit, st.units);

test("等级门槛：武器 4 级没有升级，5 级被动 1+，10 级被动 2+；资料面板名字带 +", () => {
  for (const [lv, p1, p2] of [[4, false, false], [5, true, false], [10, true, true]]) {
    const { c, st } = field(["kolt", "helu"], lv);
    const kolt = K(c, st, "kolt");
    assert.equal(c.passivePlus(kolt, 1), p1, `lv${lv} p1`);
    assert.equal(c.passivePlus(kolt, 2), p2, `lv${lv} p2`);
    const names = c.SkillText.passivesOf(kolt).map(p => p.name).join(",");
    assert.equal(names, `更换刀头${p1 ? "+" : ""},过度自信${p2 ? "+" : ""}`);
  }
});

test("绯秋按两把刀里较高的那把算", () => {
  const { c, st } = field(["hiaki", "kolt"], 1);
  const h = K(c, st, "hiaki");
  h.weaponLevels.naruto = 5;
  assert.equal(c.passivePlus(h, 1), true);
});

test("柯尔特：换刀 0.75atk；电钻格挡 +10%；酸液炮 atk +5；满血减伤 45%；队友为他格挡 +10%", () => {
  const { c, st } = field(["kolt", "helu"], 10);
  c.startCombat();
  const kolt = K(c, st, "kolt"), helu = K(c, st, "helu");
  kolt.resources.bit = "drill";
  const base = c.blockChance(kolt);
  assert.equal(c.finalBlockChance(kolt, null, helu), Math.min(100, base + 10));
  const a0 = c.effectiveAtk(kolt, st.units);
  kolt.resources.bit = "acid";
  assert.equal(c.effectiveAtk(kolt, st.units), a0 + 5);
  const hb = c.blockChance(helu);
  assert.equal(c.finalBlockChance(helu, null, kolt), Math.min(100, hb + 10));
  const foe = st.units.find(u => !u.isPlayer);
  const out = c.dealTo(foe, kolt, { atk: 0, mult: 0, flat: 20, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(out.res.flags.prideReduce, 0.45);
  assert.equal(Math.round(out.res.total), 11, "20 × 0.55");
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /passivePlus\(k, 1\) \? 0\.75 : 0\.5/);
});

test("Helumica：开局自动聚焦一个敌人的外层、自动扫描出一个配置物", () => {
  const { c, st, foes } = field(["helu", "kolt"], 10);
  const n0 = (st.props || []).length;
  c.startCombat();
  assert.equal(foes().filter(f => (f.focuses || []).length).length, 1);
  assert.equal(st.props.length, n0 + 1);
});

test("拉斯缪尔：开局光能 = 等级 + 1d6；不稳态受伤 ×3、不倒地；治疗 ×3", () => {
  const { c, st } = field(["ras", "kolt"], 10);
  const ras = K(c, st, "ras");
  ras.level = 3;
  c.startCombat();
  assert.ok(ras.resources.light >= 4 && ras.resources.light <= 9, String(ras.resources.light));
  ras.resources.unstable = true;
  ras.layers = [{ type: "flesh", current: 100, max: 100 }];
  const foe = st.units.find(u => !u.isPlayer);
  c.dealTo(foe, ras, { atk: 0, mult: 0, flat: 5, element: "physical", baseBreak: 0, flags: { action: true, blockResolved: true } });
  assert.equal(c.totalHp(ras), 85, "受伤 ×3");
  assert.equal(ras.dying, false);
  c.healUnit(ras, 4);
  assert.equal(c.totalHp(ras), 97, "治疗 ×3");
});

test("夏：燃油——引擎启动时用引擎技能 +1，加油 +2，火属性攻击消耗全部燃油加伤；起身后每回合 +1", () => {
  const { c, st } = field(["xia", "kolt"], 10);
  c.startCombat();
  const xia = K(c, st, "xia"), foe = st.units.find(u => !u.isPlayer);
  xia.zone = foe.zone; xia.level = 3;
  foe.layers.forEach(l => { l.current = l.max = 500; });
  const go = (id, t, picks) => { xia.ap = 3; xia.bonus = 3; return c.dispatch({ type: "skill", actor: xia.id, skill: id, target: t ? t.id : null, picks: picks || {} }); };
  go("xia_engine");
  assert.equal(xia.resources.engine, true);
  assert.equal(xia.resources.fuel, 0, "拉响引擎本身不加燃油");
  assert.equal(c.skillList(xia).find(s => s.id === "xia_engine").name, "加油");
  go("xia_engine");
  assert.equal(xia.resources.fuel, 2, "加油 +2");
  go("xia_aa", foe);   // 火属性：先消耗 2 燃油（+20%），之后引擎运转 +1
  assert.equal(xia.resources.fuel, 1);
  xia.resources.fuel = 5;
  c.addFuel(3);
  assert.equal(xia.resources.fuel, 5, "最多 5 点");
  // 起身后每回合 +1
  xia.resources.fuel = 0; xia.upOnShp = true;
  c.beginRound([]);
  assert.equal(xia.resources.fuel, 1);
});

test("川川：开局 1 电能；回收护盾清护盾 +2 电能", () => {
  const { c, st } = field(["chuan", "kolt"], 10);
  c.startCombat();
  const ch = K(c, st, "chuan"), kolt = K(c, st, "kolt");
  assert.equal(ch.resources.charge, 1);
  assert.ok(c.skillList(ch).some(s => s.id === "chuan_reclaim"));
  c.addShieldLayer(kolt, 6);
  ch.ap = 3; ch.bonus = 2;
  c.dispatch({ type: "skill", actor: ch.id, skill: "chuan_reclaim", target: kolt.id, picks: {} });
  assert.ok(!kolt.layers.some(l => l.type === "shield"));
  assert.equal(ch.resources.charge, 3);
});

test("诺拉：冷气注射 2d4；刺入最多两个，普攻对两个刺入对象都结算", () => {
  const { c, st, foes } = field(["nora", "kolt"], 5);
  c.startCombat();
  const n = K(c, st, "nora");
  const [f1, f2] = foes();
  [f1, f2].forEach(f => { f.zone = n.zone; f.layers.forEach(l => { l.current = l.max = 300; }); });
  c.setPierce(n, f1, []); c.setPierce(n, f2, []);
  assert.equal(c.piercedTargets(n).length, 2);
  n.resources.mood = "cruel";
  const h1 = c.totalHp(f1), h2 = c.totalHp(f2);
  n.ap = 3;
  c.dispatch({ type: "skill", actor: n.id, skill: "nora_aa", target: f1.id, picks: {} });
  assert.ok(c.totalHp(f1) < h1 && c.totalHp(f2) < h2);
  // 第三个刺入会顶掉最早的
  const kolt = K(c, st, "kolt");
  c.setPierce(n, kolt, []);
  assert.equal(c.piercedTargets(n).map(u => u.id).join(","), [f2.id, kolt.id].join(","));
});

test("诺拉 2+：回合开始不再随机翻面", () => {
  const { c, st } = field(["nora", "kolt"], 10);
  c.startCombat();
  const n = K(c, st, "nora");
  n.resources.mood = "gentle";
  for (let i = 0; i < 20; i++) c.beginRound([]);
  assert.equal(n.resources.mood, "gentle");
});

test("瑞比：初始纳米 60、补充能源 +10；被击落时不受坠落伤害", () => {
  const { c, st } = field(["ruby", "kolt"], 10);
  c.startCombat();
  const r = K(c, st, "ruby");
  assert.equal(r.resources.nano, 60);
  r.ap = 3; r.bonus = 2;
  c.dispatch({ type: "skill", actor: r.id, skill: "ruby_refuel", target: null, picks: {} });
  assert.equal(r.resources.nano, 70);
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /银翼\+：瑞比安全退出机甲/);
});

test("结人：偶数回合 +1 咖啡豆；被牵挂的队友回合内没受伤 → +1 架势、atk +10 叠加", () => {
  const { c, st } = field(["yuito", "kolt"], 10);
  c.startCombat();
  const y = K(c, st, "yuito"), kolt = K(c, st, "kolt");
  const b0 = y.resources.bean;
  st.turnNo = 2; c.beginRound([]);
  assert.equal(y.resources.bean, b0 + 1);
  y.resources.bondId = kolt.id;
  kolt.def = 1;
  const a0 = c.effectiveAtk(kolt, st.units);
  c.turnEnd();
  assert.equal(kolt.def, 2);
  assert.equal(c.effectiveAtk(kolt, st.units), a0 + 10);
  c.turnEnd();
  assert.equal(c.effectiveAtk(kolt, st.units), a0 + 20, "可叠加");
});

test("绯秋：鳴門武器人击破 +1；切换刀势得 1 附赠动作", () => {
  const { c, st } = field(["hiaki", "kolt"], 10);
  c.startCombat();
  const h = K(c, st, "hiaki");
  const b0 = h.bonus;
  c.setHiakiStance(h, "iai");
  assert.equal(h.bonus, b0 + 1);
  c.setHiakiStance(h, "iai");
  assert.equal(h.bonus, b0 + 1, "没有切换不给");
});

test("灯：两个敌人同区也都被决一死战吸引（只有一个敌人时才取最低骰）；开局 +1 圣盾；消耗圣盾回 2d10", () => {
  const { c, st, foes } = field(["tou", "kolt"], 10);
  c.startCombat();
  const tou = K(c, st, "tou");
  const [f1, f2] = foes();
  f1.zone = f2.zone = tou.zone;
  assert.ok(c.touDuelVictim(f1) && c.touDuelVictim(f2));
  assert.equal(c.shouldDiceMin(f1), false);
  assert.ok(tou.resources.shield >= 2, "开局 1 + 回合开始 1");
  tou.layers.forEach(l => { l.current = 1; });
  c.touShieldHeal(tou);
  assert.ok(c.totalHp(tou) >= 3);
});
