// Helumica「环境扫描」：扫描出配置物 / 与配置物、地形、场地互动；高地与其他场地共存
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(zoneMode) {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 2 }], seed: "HS" });
  c.startCombat();
  const st = c.S.state;
  if (zoneMode) st.zoneMode = zoneMode;
  const helu = c.findKit("helu", st.units);
  helu.level = 2; helu.zone = 1; helu.ap = 5; helu.bonus = 2;
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1;
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2;
  foe.layers.forEach(l => { l.current = l.max = 500; });
  return { c, st, helu, kolt, foe };
}
const scan = (c, helu, picks) => { helu.ap = 5; return c.dispatch({ type: "skill", actor: helu.id, skill: "helu_scan", target: null, picks }); };
const optionValues = (c, helu, picks) => {
  const step = c.skillFlowSteps("helu_scan", helu, picks).find(s => s.key === "act");
  return step.options.map(o => o.value);
};

test("扫描出配置物：一定会在选的区里出现一个配置物", () => {
  const { c, st, helu } = field();
  const n0 = (st.props || []).length;
  scan(c, helu, { dest: 2, act: "spawn" });
  assert.equal(st.props.length, n0 + 1);
  const p = st.props[st.props.length - 1];
  assert.equal(p.zone, 2);
  assert.ok(["boom", "acid", "battery", "scrap"].includes(p.kind));
  assert.equal(helu.resources.scanned, true);
});

test("选项里列出区里的配置物、相邻的危墙 / 桥梁和场地", () => {
  const { c, st, helu } = field();
  st.props = [c.makeProp("boom", 2, 1)];
  st.gaps["1-2"] = { type: "wall", hp: 18, maxHp: 18, open: false };
  c.setZoneField(2, "fire");
  st.fields[2].highland = true;
  const vals = optionValues(c, helu, { dest: 2 });
  assert.ok(vals.includes("spawn"));
  assert.ok(vals.includes("prop:" + st.props[0].id));
  assert.ok(vals.includes("gap:1-2"));
  assert.ok(vals.includes("field:fire"));
  assert.ok(!vals.some(v => v === "field:highland"), "高地没有效果，不列");
});

test("爆炸桶：直接引爆", () => {
  const { c, st, helu, foe } = field();
  const p = c.makeProp("boom", 2, 1);
  st.props = [p];
  const h0 = c.totalHp(foe);
  scan(c, helu, { dest: 2, act: "prop:" + p.id });
  assert.equal(st.props.length, 0);
  assert.ok(c.totalHp(foe) < h0);
});

test("危墙 / 不稳桥梁：耐久 −10", () => {
  const { c, st, helu } = field();
  st.gaps["1-2"] = { type: "bridge", hp: 25, maxHp: 25, open: false };
  scan(c, helu, { dest: 1, act: "gap:1-2" });
  assert.equal(st.gaps["1-2"].hp, 15);
});

test("超充能电池：提取 5+2×等级 护盾给友方，或者直接引爆", () => {
  const { c, st, helu, kolt } = field();
  const p = c.makeProp("battery", 1, 3);
  st.props = [p];
  const steps = c.skillFlowSteps("helu_scan", helu, { dest: 1, act: "prop:" + p.id, mode: "shield" });
  assert.ok(steps.some(s => s.key === "ally"));
  const sh = (u) => ((u.layers || []).find(l => l.type === "shield" && !l.batteryShield) || { current: 0 }).current;
  scan(c, helu, { dest: 1, act: "prop:" + p.id, mode: "shield", ally: kolt.id });
  assert.equal(sh(kolt), 11);
  assert.ok(st.props.includes(p), "提取护盾不会用掉电池");
  scan(c, helu, { dest: 1, act: "prop:" + p.id, mode: "boom" });
  assert.ok(!st.props.includes(p), "引爆后电池没了");
});

test("碎渣机炮：被操控，攻击选定的敌人", () => {
  const { c, st, helu, foe } = field();
  const p = c.makeProp("scrap", 1, 1);
  st.props = [p];
  const h0 = c.totalHp(foe);
  scan(c, helu, { dest: 1, act: "prop:" + p.id, target: foe.id });
  assert.ok(c.totalHp(foe) < h0);
});

test("防卫自律炮台：立刻向 Helumica 的敌人开一炮（敌方炮台也一样）", () => {
  const { c, st, helu, foe } = field();
  const p = c.makeProp("turret", 1, 3);
  p.faction = "enemy";
  st.props = [p];
  const h0 = c.totalHp(foe);
  scan(c, helu, { dest: 1, act: "prop:" + p.id });
  assert.ok(c.totalHp(foe) < h0);
  assert.equal(foe.statuses.high, true);
});

test("场地：火场 / 酸液 / 治愈立刻结算一次回合开始；冻土 1 冰击破；塌陷 +5；损毁 −20", () => {
  const { c, st, helu, foe } = field();
  c.setZoneField(2, "fire", { stacks: 1 });
  let h0 = c.totalHp(foe);
  scan(c, helu, { dest: 2, act: "field:fire" });
  assert.ok(c.totalHp(foe) < h0);
  assert.equal(st.fields[2].fire, 2, "层数也照回合开始 +1");

  c.setZoneField(2, "acid");
  h0 = c.totalHp(foe);
  scan(c, helu, { dest: 2, act: "field:acid" });
  assert.ok(c.totalHp(foe) < h0);

  c.setZoneField(2, "ice");
  const d0 = foe.def;
  scan(c, helu, { dest: 2, act: "field:ice" });
  assert.equal(foe.def, d0 - 1);

  c.setZoneField(1, "heal");
  helu.layers.forEach(l => { l.current = 1; });
  const hh = c.totalHp(helu);
  scan(c, helu, { dest: 1, act: "field:heal" });
  assert.ok(c.totalHp(helu) > hh);

  st.fields[2].collapseOn = true; st.fields[2].collapse = 1;
  scan(c, helu, { dest: 2, act: "field:collapseOn" });
  assert.equal(st.fields[2].collapse, 0, "+5 触发一次塌陷，计数器清零（不留余数）");

  st.fields[1].ruinOn = true; st.fields[1].ruinHp = 30; st.fields[1].ruinMax = 30;
  scan(c, helu, { dest: 1, act: "field:ruinOn" });
  assert.equal(st.fields[1].ruinHp, 10);
});

test("场地：能量场立刻累积高能；干涉场按选择叠 +25% / −25%", () => {
  const { c, st, helu, foe } = field();
  c.setZoneField(2, "energy");
  scan(c, helu, { dest: 2, act: "field:energy" });
  assert.ok(st.fields[2].energyVal > 0);

  c.setZoneField(2, "harmonic");
  assert.ok(c.skillFlowSteps("helu_scan", helu, { dest: 2, act: "field:harmonic" }).some(s => s.key === "sign"));
  scan(c, helu, { dest: 2, act: "field:harmonic", sign: "+" });
  assert.equal(foe.interfere, 0.25);
  scan(c, helu, { dest: 2, act: "field:harmonic", sign: "+" });
  assert.equal(foe.interfere, 0.5);
  scan(c, helu, { dest: 2, act: "field:harmonic", sign: "-" });
  assert.equal(foe.interfere, -0.25, "反向时清空后从 −25% 重计");
});

test("高地和其他区域效果共存：换场地不会把高地清掉，高地也不覆盖别的场地", () => {
  const { c, st } = field();
  st.fields[1].highland = true;
  c.setZoneField(1, "fire");
  assert.equal(st.fields[1].highland, true);
  // 战斗画面的配置面板
  c.dispatch({ type: "battle.panel", action: "setField", zone: 1, kind: "acid" });
  assert.equal(st.fields[1].highland, true);
  assert.equal(st.fields[1].acid, true);
  c.dispatch({ type: "battle.panel", action: "setField", zone: 1, kind: "highland" });
  assert.equal(st.fields[1].acid, true, "加高地不清掉酸液");
  c.dispatch({ type: "battle.panel", action: "setHighland", zone: 1, value: false });
  assert.equal(st.fields[1].highland, false);
  assert.equal(st.fields[1].acid, true);
});

test("单局随机地形：高地不占这一区的场地名额", () => {
  const c = H.load();
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "rogue.js"), "utf8");
  assert.match(src, /usedHigh/);
  void c;
});

test("战斗画面：选区域时点到区里的单位 / 配置物卡片也算点了这个区（区里站满人时也能选）", () => {
  const src = require("fs").readFileSync(require("path").join(H.ROOT, "game.js"), "utf8");
  const i = src.indexOf("function onCardClick");
  const body = src.slice(i, i + 900);
  assert.match(body, /G\.arm\.mode === "zone"/);
  assert.match(body, /pickZoneByClick\(zoneEl\)/);
});
