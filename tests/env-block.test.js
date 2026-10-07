// 天气 / 场地改不了时，只改天气 / 场地的技能直接不能用；环境扫描激发高压场地；进战斗前的低血量提醒
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(party, weather, setFields) {
  const c = H.load();
  c.S.RNG.install("ENV");
  c.BattleSim.setup({ party, weather: weather || "none", enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "ENV",
    before: (st) => { if (setFields) setFields(st); } });
  c.startCombat();
  return c;
}
const why = (c, kit, id) => c.skillRequirementError(c.findKit(kit, c.S.state.units), id);

test("固有天气：制冰机、驻波、大气干扰直接不能用（不会白花行动点）", () => {
  const c = field(["yuito", "helu"], "heat");
  assert.match(why(c, "latte", "latte_ice") || why(c, "yuito", "latte_ice"), /固有天气/);
  assert.match(why(c, "helu", "helu_wave"), /固有天气/);
  assert.match(why(c, "helu", "helu_storm"), /固有天气/);
  const ap = c.findKit("helu", c.S.state.units).ap;
  c.Commands.dispatch({ type: "skill", actor: c.findKit("helu", c.S.state.units).id, skill: "helu_storm", target: null, picks: {} });
  assert.equal(c.findKit("helu", c.S.state.units).ap, ap, "没有花掉行动点");
  assert.equal(c.S.state.weather, "heat");
});

test("没有固有天气时可以用；天气被锁定时同样不能用；已经是那种天气、又没扫描过也不能用", () => {
  const c = field(["helu"], "none");
  assert.equal(why(c, "helu", "helu_storm"), null);
  c.S.state.weatherLock = "锁定";
  assert.match(why(c, "helu", "helu_storm"), /锁定/);
  c.S.state.weatherLock = null;
  c.setWeather("sand");
  assert.match(why(c, "helu", "helu_storm"), /环境扫描/);
  c.findKit("helu", c.S.state.units).resources.scanned = true;
  assert.equal(why(c, "helu", "helu_storm"), null);
});

test("固有场地 / 深渊 / 损毁地面：酸萃、直流短接只能选能改的区，一个都没有就不能用", () => {
  const c = field(["yuito", "kolt"], "none", (st) => { st.fields[1].heal = true; st.fields[2].ice = true; });
  const yu = c.findKit("yuito", c.S.state.units);
  yu.resources.liquid = 2;
  assert.ok(c.S.state.fields[1].innate && c.S.state.fields[2].innate);
  assert.match(why(c, "yuito", "yuito_extract"), /没有能变成酸液地面/);
  assert.match(why(c, "kolt", "kolt_short"), /没有能变成高压场地/);
  c.S.state.fields[2].innate = false;
  assert.equal(why(c, "yuito", "yuito_extract"), null);
  const steps = c.skillFlowSteps("yuito_extract", yu, {});
  assert.deepEqual(Array.from(steps[0].zones), [2], "只列出能改的区");
  const k = c.findKit("kolt", c.S.state.units);
  assert.deepEqual(Array.from(c.skillFlowSteps("kolt_short", k, {})[0].zones), [2]);
});

test("环境扫描：高压场地也能激发（区里所有单位受到一次高压电击）", () => {
  const c = field(["helu"], "none", (st) => { st.fields[2].electric = true; });
  const h = c.findKit("helu", c.S.state.units); h.level = 5;
  assert.ok(c.heluScanOptions(2).some(o => o.value === "field:electric"));
  const foe = c.S.state.units.find(u => !u.isPlayer);
  const before = foe.layers.reduce((s, l) => s + l.current, 0);
  c.Commands.dispatch({ type: "skill", actor: h.id, skill: "helu_scan", target: null, picks: { dest: 2, act: "field:electric" } });
  assert.ok(foe.layers.reduce((s, l) => s + l.current, 0) < before);
});

test("进战斗前提醒：血量低于 20% 且今天还能短休的队员", () => {
  const c = field(["kolt", "helu"]);
  assert.equal(c.lowHpRestWarning().length, 0);
  const k = c.findKit("kolt", c.S.state.units);
  k.layers[k.layers.length - 1].current = 1;
  const w = c.lowHpRestWarning();
  assert.equal(w.length, 1);
  assert.equal(w[0].kit, "kolt");
  assert.match(c.lowHpWarningText(w), /队伍状态不佳/);
  c.LEDGER.shortUsed.kolt = 9;   // 短休用完了就不提醒
  assert.equal(c.lowHpRestWarning().length, 0);
});

test("单局：能短休的地方才提醒", () => {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "LOWHP" });
  R.acceptTask(run, "main");
  run.party[0].hp = [{ type: "flesh", current: 1 }];
  const w = R.lowHpWarning(run);
  assert.equal(R.canShortRestBefore(run).ok ? w.length : 0, R.canShortRestBefore(run).ok ? 1 : 0);
});
