// 职责技能的发动、目标、次数、显示（审计台账 E1 节，包 P2-roles）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], seed: opt.seed || "P2", zoneMode: opt.zoneMode });
  c.startCombat();
  return { c, S: c.S.state };
}
/** 再加载战斗画面（出手预演 / 候选目标）和热座校验 */
function withGame(c) {
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  return c;
}
const kit = (S, k) => S.units.find(u => u.kit === k);
const foes = S => S.units.filter(u => !u.isPlayer && !u.dead && !u.hidden);
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const lastLog = (S, n) => S.logPages.flatMap(p => p.lines).map(l => l.text).slice(-(n || 1)).join("\n");
const hotseat = { session: { assertAction() { return true; } }, sender: "p1" };
const validate = (c, o) => c.HotseatValidation.validateBattle(plain(Object.assign({ type: "skill", target: null, picks: {} }, o)), hotseat);
const preview = (c, actor, id, target, picks) => c.GAME.previewOf(c.GAME.skillThunk(actor.id, id, target || null, picks || {}));
function passRound(c) { c.endPlayerTurn(); c.endEnemyTurn(); }
/** 换职责、等级，并按新等级重置本场的次数（嘲讽次数等在开战时按等级给） */
function asRole(c, u, role, lv) {
  u.roles = { primary: role, secondary: role };
  u.level = lv;
  c.resetBattleFlags(u);
  u.ap = 3; u.bonus = 3;
}

/* ---------- 1 传播 ---------- */
test("传播：来源和承受者都自己选；只复制属性状态，不盖掉承受者已有的状态（灼烧叠层、高能取较大），即时效果不复制", () => {
  const { c, S } = setup(["nora", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }]);
  const n = kit(S, "nora"), k = kit(S, "kolt");
  n.zone = 1; k.zone = 2; n.ap = 2;
  const [A, B] = foes(S);
  B.layers = [{ type: "flesh", current: 50, max: 50 }];
  A.statuses.burn = 3; A.statuses.shock = true; A.statuses.high = true; A.highEnergy = 4; A.statuses.latestElement = "fire";
  A.instant.melt = true; A.statuses.weak = true;
  B.statuses.burn = 2; B.statuses.frostbite = true; B.statuses.corr = true; B.statuses.high = true; B.highEnergy = 6;
  const steps = c.skillFlowSteps("role_spread", n, {});
  assert.deepEqual(plain(steps.map(s => s.key)), ["target1", "target"]);
  assert.ok(steps[0].units.some(u => u.id === A.id));
  assert.ok(!steps[0].units.some(u => u.id === k.id), "身上没有属性状态的不能当来源");
  assert.ok(!c.skillFlowSteps("role_spread", n, { target1: A.id })[1].units.some(u => u.id === A.id), "承受者不能是来源自己");
  cmd(c, { actor: n.id, skill: "role_spread", target: B.id, picks: { target1: A.id, target: B.id } });
  assert.equal(n.ap, 1);
  assert.equal(B.statuses.burn, 5, "灼烧叠层：原有 2 + 来源 3");
  assert.equal(B.statuses.shock, true);
  assert.equal(B.statuses.frostbite, true, "来源没有的冻伤不会被盖掉");
  assert.equal(B.statuses.corr, true);
  assert.equal(B.highEnergy, 6, "高能值取较大");
  assert.ok(!B.instant.melt, "即时效果不复制");
  assert.ok(!B.statuses.weak, "通用状态不复制");
  assert.equal(B.statuses.latestElement, "fire");
  assert.equal(k.statuses.burn, 0, "不会顺手复制给同区的我方");
  assert.match(lastLog(S, 3), /传播：狂徒（锤） 身上的/);
});

test("传播：没有合法承受者、或复制过去没变化时，在扣行动点之前拦下", () => {
  const { c, S } = setup(["nora", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 2 }]);
  const n = kit(S, "nora"), y = kit(S, "yuito"), A = foes(S)[0];
  n.ap = 2;
  assert.match(c.skillRequirementError(n, "role_spread"), /没有能传播/, "场上没有属性状态：按钮变灰");
  A.statuses.shock = true; n.statuses.shock = true; y.statuses.shock = true;
  assert.match(c.skillRequirementError(n, "role_spread"), /没有能传播/, "人人都已感电：传过去没有变化");
  cmd(c, { actor: n.id, skill: "role_spread", target: y.id, picks: { target1: A.id, target: y.id } });
  assert.equal(n.ap, 2, "没扣行动点");
  y.statuses.shock = false;
  assert.equal(c.skillRequirementError(n, "role_spread"), null);
  cmd(c, { actor: n.id, skill: "role_spread", target: n.id, picks: { target1: A.id, target: n.id } });
  assert.equal(n.ap, 2, "选了没变化的承受者：拦下");
  cmd(c, { actor: n.id, skill: "role_spread", target: y.id });
  assert.equal(n.ap, 2, "没走分步（没有来源）：拦下");
  cmd(c, { actor: n.id, skill: "role_spread", target: y.id, picks: { target1: A.id, target: y.id } });
  assert.equal(n.ap, 1);
  assert.equal(y.statuses.shock, true);
});

test("传播：热座校验分步，战斗画面预演承受者有效", () => {
  const { c, S } = setup(["nora", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 2 }, { id: "thug_knife", lv: 1, zone: 2 }]);
  withGame(c);
  const n = kit(S, "nora"); n.level = 10; n.ap = 2; n.bonus = 1;
  const [A, B] = foes(S);
  A.statuses.corr = true;
  assert.equal(validate(c, { actor: n.id, skill: "role_spread", target: B.id, picks: { target1: A.id, target: B.id } }), true);
  assert.throws(() => validate(c, { actor: n.id, skill: "role_spread", target: A.id, picks: { target1: A.id, target: A.id } }), /分步/);
  assert.throws(() => validate(c, { actor: n.id, skill: "role_spread", target: B.id }), /分步/);
  assert.equal(preview(c, n, "role_spread", B.id, { target1: A.id, target: B.id }).meaningful, true);
});

test("新加的分步名都在联机转发的白名单里（传播 target1 / 保释 target2、ally / 黄金时间 status / 借力 dest / 不倒战意 mode / 缓冲 layer）", () => {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "online-view.js"), "utf8"), c, { filename: "online-view.js" });
  const V = c.OnlineView;
  const picksList = [{ target1: "u1", target: "u2" }, { target: "u1", target2: "u2", ally: "u3" }, { target: "u1", status: "melt" }, { target: "u1", dest: 3 }, { mode: "all" }, { layer: "armor" }];
  for (const picks of picksList) {
    const out = plain(V.projectActionMenu({ type: "actionOptions", actor: "u0", choices: { kind: "ready", title: "确认执行", options: [], command: { type: "skill", actor: "u0", skill: "role_spread", target: "u2", picks } } }));
    assert.deepEqual(out.choices.command.picks, picks);
  }
  for (const key of ["target1", "target", "target2", "ally", "status", "dest", "mode", "layer"]) {
    const out = plain(V.projectActionMenu({ type: "actionOptions", actor: "u0", choices: { kind: "unit", key, title: "选", options: [] } }));
    assert.equal(out.choices.key, key);
  }
});

/* ---------- 2 状态栏 / 出手预演 ---------- */
test("状态栏显示保释、恶劣环境、加倍计量、黄金时间、击破预告、禁足", () => {
  const { c, S } = setup(["kolt", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const k = kit(S, "kolt"), y = kit(S, "yuito"), f = foes(S)[0];
  y.shelterTurn = true;
  f.harshEnv = true; f.instant.doubleStatus = true; f.instant.goldHold = "melt"; f.instant.omenArmed = true; f.lockdownBy = k.id;
  assert.match(c.statusLine(y), /保释/);
  const line = c.statusLine(f);
  for (const re of [/恶劣环境/, /加倍计量/, /黄金时间（熔融）/, /击破预告/, /禁足（柯尔特）/]) assert.match(line, re);
});

test("出手预演：加倍计量 / 黄金时间 / 击破预告 / 保释 / 恶劣环境 / 不倒战意的目标不再全灰", () => {
  const { c, S } = setup(["kolt", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  withGame(c);
  const k = kit(S, "kolt"), y = kit(S, "yuito"), [A, B] = foes(S);
  k.zone = 1; y.zone = 1; A.zone = 1; B.zone = 1;
  A.statuses.burn = 2; A.instant.melt = true;
  asRole(c, k, "异常", 15);
  assert.equal(preview(c, k, "role_double_dot", A.id).meaningful, true);
  const none = preview(c, k, "role_double_dot", B.id);
  assert.equal(none.meaningful, false, "身上没有状态的敌人：加倍计量没东西可翻倍");
  assert.match(none.reason, /没有状态效果/);
  asRole(c, k, "辅助", 15);
  assert.deepEqual(plain(c.skillFlowSteps("role_gold", k, {})[0].units.map(u => u.id)), [A.id], "只列身上有即时效果的单位");
  assert.equal(preview(c, k, "role_gold", A.id, { target: A.id }).meaningful, true);
  assert.equal(preview(c, k, "role_sturdy", y.id, { mode: "one" }).meaningful, true);
  asRole(c, k, "击破", 15);
  assert.equal(preview(c, k, "role_omen", A.id).meaningful, true);
  asRole(c, k, "环境手", 15);
  const harsh = c.skillList(k).find(s => s.id === "role_harsh");
  const cands = c.GAME.candidateUnits(k, harsh).map(u => u.id);
  assert.ok(cands.includes(A.id) && cands.includes(y.id) && cands.includes(k.id), "恶劣环境：「一名单位」敌我都能选");
  assert.equal(preview(c, k, "role_harsh", y.id).meaningful, true);
  assert.equal(preview(c, k, "role_harsh", A.id).meaningful, true);
  assert.equal(preview(c, k, "role_shelter", y.id, { target: y.id }).meaningful, true);
});

test("折戟 / 击破预告 / 加倍计量不能对配置物用（以前会当成攻击打一下）", () => {
  const { c, S } = setup(["hiaki", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const hk = kit(S, "hiaki"); hk.zone = 1;
  asRole(c, hk, "击破", 15);
  const boom = c.makeProp("boom", 1, 1); boom.hp = boom.maxHp = 30;
  S.props.push(boom);
  cmd(c, { actor: hk.id, skill: "role_halve", target: "prop:" + boom.id });
  assert.equal(boom.hp, 30);
  assert.equal(hk.ap, 3, "没扣行动点");
});

/* ---------- 3 嘲讽 ---------- */
test("嘲讽：每场 2 次（5 级 3、15 级 4）；10 级前每回合限一次，10 级起一回合可多次；日志写施放者自己的名字", () => {
  const five = [1, 2, 3, 4, 5].map(() => ({ id: "thug_knife", lv: 1, zone: 1 }));
  const { c, S } = setup(["tou", "kolt"], five);
  const t = kit(S, "tou"), fs = foes(S);
  t.zone = 1;
  for (const [lv, cap] of [[1, 2], [5, 3], [10, 3], [15, 4]]) {
    t.level = lv; c.resetBattleFlags(t);
    assert.equal(t.resources.tauntLeft, cap, lv + " 级");
  }
  t.level = 5; c.resetBattleFlags(t); t.bonus = 3;
  cmd(c, { actor: t.id, skill: "tou_taunt", target: fs[0].id, picks: { target: fs[0].id } });
  assert.equal(t.resources.tauntLeft, 2);
  assert.match(c.skillRequirementError(t, "tou_taunt"), /每回合只能嘲讽一次/);
  cmd(c, { actor: t.id, skill: "tou_taunt", target: fs[1].id, picks: { target: fs[1].id } });
  assert.equal(t.bonus, 2, "10 级前同一回合第二次：不扣附赠");
  assert.ok(!fs[1].tauntTo);
  passRound(c);
  t.bonus = 3;
  cmd(c, { actor: t.id, skill: "tou_taunt", target: fs[1].id, picks: { target: fs[1].id } });
  assert.equal(fs[1].tauntTo, t.id, "下一回合又能嘲讽");
  t.level = 10; c.resetBattleFlags(t); t.bonus = 5;
  for (let i = 0; i < 3; i++) cmd(c, { actor: t.id, skill: "tou_taunt", target: fs[i].id, picks: { target: fs[i].id } });
  assert.equal(t.resources.tauntLeft, 0, "10 级起一回合内用了 3 次");
  assert.match(c.skillRequirementError(t, "tou_taunt"), /已用尽/);
  // 柯尔特（坦克专精）
  const k = kit(S, "kolt"); k.zone = 1; k.bonus = 2;
  cmd(c, { actor: k.id, skill: "tou_taunt", target: fs[3].id, picks: { target: fs[3].id } });
  assert.match(lastLog(S, 2), /下次攻击必须打柯尔特/);
  assert.doesNotMatch(lastLog(S, 2), /必须打灯/);
});

/* ---------- 4 保释 ---------- */
test("保释：每场 2 次（15 级 3 次）；一次附赠动作可以连保多名友方；用完了不扣附赠", () => {
  const { c, S } = setup(["helu", "kolt", "yuito"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  withGame(c);
  const h = kit(S, "helu"), k = kit(S, "kolt"), y = kit(S, "yuito");
  asRole(c, h, "环境手", 5);
  h.bonus = 2;
  assert.deepEqual(plain(c.skillFlowSteps("role_shelter", h, {}).map(s => s.key)), ["target"]);
  const steps = c.skillFlowSteps("role_shelter", h, { target: k.id });
  assert.deepEqual(plain(steps.map(s => s.key)), ["target", "target2"]);
  assert.equal(steps[1].optional, true);
  assert.ok(!steps[1].units.some(u => u.id === k.id) && !steps[0].units.some(u => u.id === h.id));
  cmd(c, { actor: h.id, skill: "role_shelter", target: y.id, picks: { target: k.id, target2: y.id } });
  assert.equal(h.bonus, 1, "两人只花一个附赠动作");
  assert.ok(k.shelterTurn && y.shelterTurn);
  assert.match(c.statusLine(k), /保释/);
  passRound(c);
  assert.ok(!k.shelterTurn, "只到这一回合");
  h.bonus = 2;
  assert.match(c.skillRequirementError(h, "role_shelter"), /已用完/);
  cmd(c, { actor: h.id, skill: "role_shelter", target: k.id, picks: { target: k.id } });
  assert.equal(h.bonus, 2, "用完了不扣附赠");
  assert.ok(!k.shelterTurn);
  asRole(c, h, "环境手", 15);
  assert.equal(c.roleUsesLeft(h, "role_shelter"), 3);
  assert.equal(validate(c, { actor: h.id, skill: "role_shelter", target: y.id, picks: { target: k.id, target2: y.id } }), true);
});

/* ---------- 5 次数用完 ---------- */
test("有次数的职责技能用完后在扣费之前拦下、按钮变灰（以前照扣行动点 / 附赠，什么都不发生）", () => {
  const cases = [
    ["role_refine", "直伤", 1, 1], ["role_refine", "直伤", 15, 2], ["role_pierce", "直伤", 15, 1], ["role_gambit", "直伤", 15, 1],
    ["role_grit", "坦克", 10, 2], ["role_stand", "坦克", 15, 1], ["role_fear", "护卫", 10, 2], ["role_fear", "护卫", 15, 3],
    ["role_all_reflect", "护卫", 15, 1], ["role_dome", "生存", 10, 1], ["role_buffer", "生存", 5, 1], ["role_buffer", "生存", 15, 2],
    ["role_renew", "生存", 15, 1], ["role_apocalypse", "环境手", 15, 1], ["role_harsh", "环境手", 10, 1], ["role_lock", "环境手", 1, 1],
    ["role_shake", "控场", 15, 1], ["role_rearrange", "控场", 15, 1], ["role_double_dot", "异常", 15, 1],
    ["role_gold", "辅助", 15, 2], ["role_halve", "击破", 15, 1], ["role_omen", "击破", 15, 1]
  ];
  for (const [id, role, lv, cap] of cases) {
    const { c, S } = setup(["kolt", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
    const k = kit(S, "kolt"), y = kit(S, "yuito"), f = foes(S)[0];
    k.zone = 1; y.zone = 1; f.zone = 1;
    asRole(c, k, role, lv);
    f.layers = [{ type: "flesh", current: 999, max: 999 }]; f.def = f.defMax = 20;
    f.statuses.burn = 1;
    const target = ["role_buffer", "role_renew"].includes(id) ? y.id : f.id;
    const fx = ["melt", "sting"];
    for (let i = 0; i < cap; i++) {
      f.instant[fx[i]] = true;
      k.ap = 3; k.bonus = 3;
      cmd(c, { actor: k.id, skill: id, target, picks: id === "role_gold" ? { target: f.id } : {} });
      assert.ok(k.ap < 3 || k.bonus < 3, `${id} 第 ${i + 1} 次照常发动`);
    }
    k.ap = 3; k.bonus = 3;
    assert.match(String(c.skillRequirementError(k, id)), /已用完/, id + " 按钮变灰");
    cmd(c, { actor: k.id, skill: id, target, picks: id === "role_gold" ? { target: f.id } : {} });
    assert.equal(k.ap, 3, id + " 不扣行动点");
    assert.equal(k.bonus, 3, id + " 不扣附赠");
  }
});

/* ---------- 6 借力 ---------- */
test("借力：自己选友方和目的地（三区制从 1 区直接移到 3 区）；热座校验目的地", () => {
  const { c, S } = setup(["chuan", "yuito"], [{ id: "thug_knife", lv: 1, zone: 3 }], { zoneMode: 3 });
  withGame(c);
  const ch = kit(S, "chuan"), y = kit(S, "yuito");
  asRole(c, ch, "控场", 5);
  ch.zone = 1; y.zone = 1; ch.bonus = 2;
  const steps = c.skillFlowSteps("role_boost", ch, { target: y.id });
  assert.deepEqual(plain(steps.map(s => s.key)), ["target", "dest"]);
  assert.deepEqual(plain(steps[1].zones), [2, 3]);
  assert.ok(!steps[0].units.some(u => u.id === ch.id), "其他友方");
  assert.equal(validate(c, { actor: ch.id, skill: "role_boost", target: y.id, picks: { target: y.id, dest: 3 } }), true);
  assert.throws(() => validate(c, { actor: ch.id, skill: "role_boost", target: y.id, picks: { target: y.id, dest: 1 } }), /分步/);
  cmd(c, { actor: ch.id, skill: "role_boost", target: y.id });
  assert.equal(ch.bonus, 2, "没选目的地：拦下，不扣附赠");
  cmd(c, { actor: ch.id, skill: "role_boost", target: y.id, picks: { target: y.id, dest: 3 } });
  assert.equal(y.zone, 3);
  assert.equal(ch.bonus, 1);
});

/* ---------- 7 唤出 ---------- */
test("唤出扭矩 / Ecmo / EDC：每场开战都满血唤出（上一场倒下也一样，作者定）；只有耐久为 0 时在扣费之前拦下", () => {
  for (const [owner, w, sid] of [["kolt", "torque", "kolt_summon"], ["helu", "ecmo", "helu_summon"], ["ras", "edc", "ras_summon"]]) {
    {
      const { c, S } = setup([owner, "yuito"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
      c.LEDGER.weapons = { [w]: [{ type: "armor", current: 0 }] };   // 旧档里「上一场倒下」的记录不再起作用
      const o = kit(S, owner); o.ap = 2; o.bonus = 2;
      assert.equal(c.skillRequirementError(o, sid), null, sid);
      cmd(c, { actor: o.id, skill: sid });
      const wu = S.units.find(u => u.kit === w);
      assert.ok(wu, sid + " 唤出来了");
      assert.equal(wu.layers.reduce((n, l) => n + l.current, 0), wu.layers.reduce((n, l) => n + l.max, 0), sid + " 满血");
    }
    {
      const { c, S } = setup([owner, "yuito"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
      c.LEDGER.dur[w] = 0;
      const o = kit(S, owner); o.ap = 2; o.bonus = 2;
      assert.match(String(c.skillRequirementError(o, sid)), /耐久/, sid);
      cmd(c, { actor: o.id, skill: sid });
      assert.equal(o.ap, 2, sid + " 不扣行动点");
      assert.equal(o.bonus, 2, sid + " 不扣附赠");
      assert.ok(!S.units.some(u => u.kit === w), sid + " 没有唤出");
    }
  }
});

/* ---------- 8 低 ---------- */
test("不倒战意 15 级：可以用行动点让全部友方此回合坚挺（热座不要求目标）；一名友方照旧花附赠", () => {
  const { c, S } = setup(["yuito", "kolt", "chuan"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  withGame(c);
  const y = kit(S, "yuito"), k = kit(S, "kolt"), ch = kit(S, "chuan");
  asRole(c, y, "辅助", 15);
  y.zone = 1; ch.zone = 1; k.zone = 2;
  assert.deepEqual(plain(c.skillFlowSteps("role_sturdy", y, {}).map(s => s.key)), ["mode"]);
  assert.equal(validate(c, { actor: y.id, skill: "role_sturdy", picks: { mode: "all" } }), true);
  cmd(c, { actor: y.id, skill: "role_sturdy", picks: { mode: "all" } });
  assert.equal(y.ap, 2, "全部友方：花行动点");
  assert.equal(y.bonus, 3);
  for (const u of [y, k, ch]) assert.equal(u.statuses.sturdy, true, u.name);
  passRound(c);
  y.ap = 3; y.bonus = 3;
  cmd(c, { actor: y.id, skill: "role_sturdy", target: ch.id, picks: { mode: "one" } });
  assert.equal(y.bonus, 2, "一名友方：花附赠");
  assert.equal(ch.statuses.sturdy, true);
  assert.ok(!k.statuses.sturdy);
  y.level = 14;
  assert.equal(c.skillFlowSteps("role_sturdy", y, {}).length, 0, "15 级以前没有这一步");
});

test("缓冲 15 级：可以自选给哪一种血量", () => {
  const { c, S } = setup(["longge", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const lg = kit(S, "longge"), k = kit(S, "kolt");
  asRole(c, lg, "生存", 15);
  lg.zone = 1; k.zone = 1;
  assert.equal(c.skillFlowSteps("role_buffer", lg, {})[0].key, "layer");
  cmd(c, { actor: lg.id, skill: "role_buffer", target: k.id, picks: { layer: "armor" } });
  assert.ok(k.layers.some(l => l.type === "armor" && l.current >= 6), "给的是装甲");
  assert.ok(!k.layers.some(l => l.type === "shield"));
  lg.level = 14;
  assert.equal(c.skillFlowSteps("role_buffer", lg, {}).length, 0);
});

test("全力以赴空手也能用（职责技能可以空手放）", () => {
  const { c, S } = setup(["xia", "hiaki"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const x = kit(S, "xia"), hk = kit(S, "hiaki");
  x.level = 5; x.bonus = 2; x.weaponHeld = false;
  assert.ok(c.skillList(x).some(s => s.id === "hiaki_allin"));
  cmd(c, { actor: x.id, skill: "hiaki_allin" });
  assert.equal(x.resources.smashNext, true);
  assert.equal(x.bonus, 1);
  hk.resources.niuOut = true; hk.resources.narutoOut = true;
  assert.ok(c.skillList(hk).some(s => s.id === "hiaki_allin"), "绯秋两把刀都分出去也还在");
});

test("禁足怒吼：这一回合只能攻击坦克（敌人出手一次后也一样），回合结束清掉；不作用到已死亡的敌人", () => {
  const { c, S } = setup(["kolt", "yuito"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const k = kit(S, "kolt"), y = kit(S, "yuito"), [A, B] = foes(S);
  asRole(c, k, "坦克", 5);
  k.zone = 1; y.zone = 1; A.zone = 1; B.zone = 1; B.dead = true;
  cmd(c, { actor: k.id, skill: "role_lockdown" });
  assert.equal(A.lockdownBy, k.id);
  assert.equal(A.noMove, true);
  assert.ok(!B.lockdownBy && !B.noMove, "已死亡的敌人不算");
  assert.match(c.statusLine(A), /禁足（柯尔特）/);
  const aim = () => c.EnemyAI.target(A, { dist: 0, aim: "lowest" }, c.EnemyAI.players());
  y.layers.forEach(l => { l.current = 1; });   // 本来会去打血量最低的结人
  assert.equal(aim().unit.id, k.id);
  assert.equal(aim().forced, true);
  A.tauntTo = null;   // 出手一次后嘲讽会被清掉，禁足不会
  assert.equal(aim().unit.id, k.id);
  passRound(c);
  assert.equal(A.lockdownBy, null, "回合结束清掉，不会残留到之后的回合");
  assert.equal(A.noMove, false);
  assert.equal(aim().unit.id, y.id);
});

test("破势 / 撼动不作用到已死亡的敌人", () => {
  const { c, S } = setup(["hiaki", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const hk = kit(S, "hiaki"), k = kit(S, "kolt"), [A, B] = foes(S);
  hk.zone = 1; k.zone = 1; A.zone = 1; B.zone = 1;
  asRole(c, hk, "击破", 15);
  A.def = 2; B.def = 2; B.dead = true;
  cmd(c, { actor: hk.id, skill: "role_breakwave" });
  assert.equal(A.def, 1);
  assert.equal(B.def, 2, "死掉的敌人不吃破势");
  asRole(c, k, "控场", 15);
  A.def = A.defMax;   // 只剩 1 点架势时不稳会直接失衡，这里看不稳本身
  cmd(c, { actor: k.id, skill: "role_shake" });
  assert.equal(A.statuses.unstable, true);
  assert.ok(!B.statuses.unstable && !B.noMove, "死掉的敌人不吃撼动");
});

/* ---------- 9 技能四 ---------- */
test("全队集结：战斗画面的预演不会真的用掉「一次长休限一次」的次数；用过了在扣费之前拦下", () => {
  const { c, S } = setup(["yuito", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  withGame(c);
  const y = kit(S, "yuito");
  asRole(c, y, "辅助", 15);
  preview(c, y, "role_rally");
  assert.equal(c.roleUsesLeft(y, "role_rally"), 1, "悬停预演之后还能用");
  assert.equal(c.skillRequirementError(y, "role_rally"), null);
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.equal(y.ap, 2);
  assert.match(String(c.skillRequirementError(y, "role_rally")), /这次长休已经用过/);
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.equal(y.ap, 2, "用过了不扣行动点");
});

test("击破预告：玩家回合打进失衡的敌人，回合结束判成功（返还次数，施放者不失衡）；没打进失衡照旧判失败", () => {
  const { c, S } = setup(["hiaki", "yuito"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const hk = kit(S, "hiaki"), f = foes(S)[0];
  hk.zone = 1; f.zone = 1;
  asRole(c, hk, "击破", 15);
  cmd(c, { actor: hk.id, skill: "role_omen", target: f.id });
  assert.match(c.statusLine(f), /击破预告/);
  c.dealBreak(f, 99, "physical", [], "测试");
  assert.equal(f.stunned, true);
  c.endPlayerTurn();
  assert.equal(f.stunned, false, "敌人回合开始就从失衡恢复了");
  c.endEnemyTurn();
  assert.doesNotMatch(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /击破预告失败/);
  assert.ok(hk.ap > 0, "施放者没有失衡");
  assert.equal(c.roleUsesLeft(hk, "role_omen"), 1, "成功返还次数");
  hk.ap = 3;
  cmd(c, { actor: hk.id, skill: "role_omen", target: f.id });
  passRound(c);
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /击破预告失败/);
});
