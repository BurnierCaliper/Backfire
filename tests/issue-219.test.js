// #219（作者 10/21 定）：瑞比「补充能源」二选一——纳米 +10，或者把全部纳米 1:1 压缩成储备能源（纳米归 0）。
// 储备能源没有上限，纳米不够时自动补差额（机甲维持、无人机激光、机体修复、进入机甲）；战斗结束清零；联机按白名单下发
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const logText = S => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const reserve = r => Number(r.resources.nanoReserve) || 0;

/** 瑞比武器 10 级（纳米科技+ 解锁补充能源），和柯尔特一起打一个血很厚的狂徒 */
function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "I219" });
  const S = c.S.state;
  S.units.filter(u => u.isPlayer && u.linkedKits).forEach(u => u.linkedKits.forEach(k => { u.weaponLevels[k] = 10; }));
  c.startCombat();
  const r = c.findKit("ruby", S.units), foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  r.zone = foe.zone = 1; r.level = 11; r.ap = 3; r.bonus = 3;
  return { c, S, r, foe };
}
function mint(c, r) {
  const m = c.spawnWeapon(r, "mint");
  m.zone = r.zone; m.ap = 3; m.bonus = 3; m.level = 11;
  return m;
}
/** 唤出明特、进机甲（进的时候纳米给满，之后测试自己改纳米和储备） */
function mecha(c, r) {
  const m = mint(c, r);
  r.resources.nano = 100;
  c.enterMecha();
  assert.ok(r.resources.mecha, "进了机甲");
  return m;
}

test("补充能源是分步二选一：纳米 +10，或者压缩；都只花 1 个附赠动作", () => {
  const { c, r } = setup();
  assert.ok(c.skillList(r).some(s => s.id === "ruby_refuel"));
  r.resources.nano = 30;
  const steps = c.skillFlowSteps("ruby_refuel", r, {});
  assert.equal(steps.length, 1);
  assert.equal(steps[0].key, "mode");
  assert.equal(steps[0].type, "choice");
  assert.equal(steps[0].optional, false);
  assert.deepEqual(plain(steps[0].options.map(o => o.value)), ["nano", "compress"]);
  // 纳米 +10
  r.bonus = 2;
  const ap = r.ap;
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "nano" } });
  assert.equal(r.resources.nano, 40);
  assert.equal(reserve(r), 0, "没有压缩就没有储备");
  assert.equal(r.bonus, 1, "花 1 个附赠动作");
  assert.equal(r.ap, ap, "不花行动点");
  // 压缩
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "compress" } });
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 40);
  assert.equal(r.bonus, 0, "压缩也只花 1 个附赠动作");
  assert.equal(r.ap, ap);
});

test("压缩 1:1：全部纳米进储备、纳米归 0；储备没有上限，超过 100 照样往上加", () => {
  const { c, S, r } = setup();
  r.bonus = 5;
  r.resources.nano = 100;
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "compress" } });
  assert.equal(r.resources.nano, 0, "纳米归 0");
  assert.equal(reserve(r), 100, "1:1");
  r.resources.nano = 100;
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "compress" } });
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 200, "储备没有上限");
  assert.match(logText(S), /储备能源 \+100 → 200/);
  // 之后纳米照样从 0 攒（上限还是 100），不碰储备
  c.addNano(130);
  assert.equal(r.resources.nano, 100);
  assert.equal(reserve(r), 200);
});

test("数值在配置表里：改补充能源的加量和压缩比例，技能跟着变", () => {
  const { c, r } = setup();
  assert.deepEqual(plain(vm.runInContext("RUBY_REFUEL", c)), { nano: 10, compressRate: 1 });
  vm.runInContext("RUBY_REFUEL.nano = 15; RUBY_REFUEL.compressRate = 2;", c);
  r.bonus = 5; r.resources.nano = 30;
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "nano" } });
  assert.equal(r.resources.nano, 45);
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "compress" } });
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 90);
});

test("纳米是 0 时没有东西可以压缩：不问二选一，直接 +10；硬要压缩也不白花附赠动作", () => {
  const { c, r } = setup();
  r.resources.nano = 0; r.bonus = 2;
  assert.equal(c.skillFlowSteps("ruby_refuel", r, {}).length, 0);
  cmd(c, { actor: r.id, skill: "ruby_refuel", picks: { mode: "compress" } });
  assert.equal(r.bonus, 2, "没压缩成，不花附赠");
  assert.equal(reserve(r), 0);
  cmd(c, { actor: r.id, skill: "ruby_refuel" });
  assert.equal(r.resources.nano, 10, "不选就是 +10（和以前一样）");
  assert.equal(r.bonus, 1);
});

test("机甲维持（每回合 20，机体强化 40）：纳米不够，差额从储备扣；纳米够就不动储备", () => {
  const { c, S, r } = setup();
  mecha(c, r);
  r.resources.nano = 5; r.resources.nanoReserve = 50;
  c.turnEnd();
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 35, "差 15 从储备扣");
  assert.ok(r.resources.mecha, "还有储备，机甲继续");
  assert.match(logText(S), /机甲维持：纳米 −5 → 0，储备能源 −15 → 35/);
  r.resources.overdrive = true;
  r.resources.nano = 10;
  c.turnEnd();
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 5, "机体强化 40：纳米 10 + 储备 30");
  assert.ok(r.resources.mecha);
  r.resources.overdrive = false;
  r.resources.nano = 60;
  c.turnEnd();
  assert.equal(r.resources.nano, 40);
  assert.equal(reserve(r), 5, "纳米够的时候不动储备");
});

test("纳米和储备都扣光才因为「纳米耗尽」退出机甲", () => {
  const { c, S, r } = setup();
  const m = mecha(c, r);
  r.resources.nano = 0; r.resources.nanoReserve = 25;
  c.turnEnd();
  assert.ok(r.resources.mecha, "纳米 0、储备还剩 5：机甲继续");
  assert.equal(reserve(r), 5);
  assert.doesNotMatch(logText(S), /纳米耗尽/);
  c.turnEnd();
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 0);
  assert.ok(!r.resources.mecha, "两边都扣光：退出机甲");
  assert.ok(!m.hidden, "明特回到场上");
  assert.match(logText(S), /纳米耗尽，机甲结束/);
});

test("无人机激光耗 10 纳米：纳米不够从储备扣；纳米 + 储备不够 10 才不发射", () => {
  const { c, S, r, foe } = setup();
  mecha(c, r);
  r.resources.drone = true;
  r.resources.nano = 5; r.resources.nanoReserve = 100;
  const hp = c.totalHp(foe);
  c.turnEnd();
  assert.ok(c.totalHp(foe) < hp, "激光打出去了");
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 100 - 5 - 20, "激光差的 5、机甲维持 20 都从储备扣");
  assert.match(logText(S), /无人机激光射向 .+（纳米 −5 → 0，储备能源 −5 → 95）/);
  // 两边加起来不够 10：不发射，也不扣
  r.resources.nano = 3; r.resources.nanoReserve = 4;
  const hp2 = c.totalHp(foe);
  c.turnEnd();
  assert.equal(c.totalHp(foe), hp2, "不够 10 不发射");
  assert.ok(!r.resources.mecha, "机甲维持把两边扣光：退出机甲");
});

test("机体修复耗 20 纳米：门槛按纳米 + 储备算，纳米不够从储备扣", () => {
  const { c, r } = setup();
  const m = mint(c, r);
  m.layers.forEach(l => { l.current = 1; });
  r.resources.nano = 5; r.resources.nanoReserve = 10;
  assert.equal(c.skillRequirementError(m, "mint_repair"), "纳米能源不足 20", "5 + 10 不够 20");
  r.resources.nanoReserve = 30;
  assert.equal(c.skillRequirementError(m, "mint_repair"), null, "5 + 30 够了");
  const hp = c.totalHp(m);
  cmd(c, { actor: m.id, skill: "mint_repair" });
  assert.ok(c.totalHp(m) > hp, "修好了");
  assert.equal(r.resources.nano, 0);
  assert.equal(reserve(r), 15, "差 15 从储备扣");
});

test("进入机甲：纳米 0、储备 > 0 也能进；两边都是 0 不能进", () => {
  const { c, S, r } = setup();
  const m = mint(c, r);
  r.resources.nano = 0;
  cmd(c, { actor: m.id, skill: "mint_mecha" });
  assert.ok(!r.resources.mecha, "纳米、储备都是 0");
  assert.match(logText(S), /纳米能源不足，无法进入机甲/);
  r.resources.nanoReserve = 30;
  cmd(c, { actor: m.id, skill: "mint_mecha" });
  assert.ok(r.resources.mecha, "储备也算纳米能源");
});

test("战斗结束（胜利 / 失败 / 撤退）储备清零，纳米不动", () => {
  for (const outcome of ["win", "lose", "retreat"]) {
    const { c, r } = setup();
    r.resources.nano = 50; r.resources.nanoReserve = 120;
    c.settleBattleRewards(outcome);
    assert.equal(reserve(r), 0, outcome);
    assert.equal(r.resources.nano, 50, outcome + "：纳米不动");
  }
});

test("下一场战斗不带储备：开战时清掉（纳米照旧可以跨战斗保留）", () => {
  const c = H.load();
  c.GAME = { partyKits: ["ruby", "kolt"] };
  // 模拟队伍记忆（game.js · applyCampaignToField）把上一场的纳米带过来，还夹着储备
  const carry = () => { const r = c.findKit("ruby", c.S.state.units); r.resources.nano = 55; r.resources.nanoReserve = 88; };
  c.dispatch({ type: "battle.setup", level: 1, encounter: null }, { applyCampaignToField: carry });
  const r = c.findKit("ruby", c.S.state.units);
  assert.equal(r.resources.nano, 55, "纳米照旧保留");
  assert.equal(reserve(r), 0, "储备不跨战斗");
  // game.js · packHero：战斗之间只保留纳米，不保留储备
  const src = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  const keep = src.match(/(\[[^\]]*"nano"[^\]]*\])\.forEach\(k => \{ if \(r\[k\] != null\) keep\[k\] = r\[k\]; \}\)/);
  assert.ok(keep, "找得到 packHero 保留资源的那一行");
  assert.doesNotMatch(keep[1], /nanoReserve/);
});

test("连续战斗换区域还是同一场：储备接着用，不清零", () => {
  const c = H.load();
  const stage = name => ({ name, zoneMode: 2, enemies: [{ preset: "thug_knife", level: 1, zone: 2 }] });
  c.BattleSim.setup({ party: ["ruby", "kolt"], encounter: Object.assign(stage("巷口"), { stages: [stage("仓库")] }), level: 1, seed: "I219C" });
  c.startCombat();
  const S = c.S.state, r = c.findKit("ruby", S.units);
  r.resources.nanoReserve = 66;
  S.units.filter(u => !u.isPlayer && !u.dead).forEach(u => { u.layers.forEach(l => { l.current = 0; }); u.dead = true; });
  assert.equal(c.dispatch({ type: "battle.chain" }).continued, true);
  assert.equal(S.chain.index, 1);
  assert.equal(reserve(r), 66);
});

test("显示：能量表、资源文字有储备时写「储备 n」，没有就不写；纳米 + 储备够就显示可进入机甲", () => {
  const HI = require("../hud-icons.js");
  const g = res => HI.gauge(HI.gaugeState({ kit: "ruby", level: 11, resources: res }));
  assert.doesNotMatch(g({ nano: 30 }), /储备/);
  assert.match(g({ nano: 0, nanoReserve: 150 }), /储备 <b class="num">150<\/b>/);
  assert.equal(HI.gaugeState({ kit: "ruby", resources: { nano: 0, nanoReserve: 150 } }).reserve, 150, "储备没有上限，不夹到 100");
  assert.match(g({ nano: 5, nanoReserve: 30 }), /可进入机甲/);
  assert.match(g({ nano: 5 }), /能源不足/);
  const { c, r } = setup();
  r.resources.nano = 40;
  assert.doesNotMatch(c.resourceText(r), /储备/);
  r.resources.nanoReserve = 150;
  assert.match(c.resourceText(r), /^纳米 40\/100 · 储备 150/);
  // 说明文字：技能条提示、技能说明、纳米科技+ 都写到储备能源
  assert.match(c.skillList(r).find(s => s.id === "ruby_refuel").hint, /压缩/);
  assert.match(c.SkillText.skillText("ruby_refuel"), /储备能源/);
  assert.match(c.SkillText.passivesOf(r).find(p => /纳米科技/.test(p.name)).text, /储备能源/);
});

test("联机：储备能源按白名单下发（资源和能量表），玩家端资源名表有中文名", () => {
  require("../hud-icons.js");
  const V = require("../online-view");
  const u = { id: "r1", kit: "ruby", name: "瑞比", isPlayer: true, zone: 1, level: 11, layers: [{ type: "flesh", current: 30, max: 30 }],
    shp: 732911, resources: { nano: 0, nanoReserve: 150, shp: 732911 } };
  const out = V.projectUnit(u);
  assert.equal(out.resources.nanoReserve, 150);
  assert.equal(out.resources.nano, 0);
  assert.equal(out.hud.reserve, 150);
  assert.doesNotMatch(JSON.stringify(out), /732911|shp/i, "坚毅照旧不下发");
  const src = fs.readFileSync(path.join(H.ROOT, "online-ui.js"), "utf8");
  const names = vm.runInNewContext("(" + src.match(/const names = (\{[^}]*\});/)[1] + ")");
  assert.equal(names.nanoReserve, "储备");
});
