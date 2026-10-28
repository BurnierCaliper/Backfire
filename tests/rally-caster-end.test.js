// 全队集结：施放者晕眩 / 濒死 / 死亡时，清掉这名施放者给每个队员的那一份（别人的份额保留）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const kit = (S, k) => S.units.find(u => u.kit === k);

function field(opt) {
  opt = opt || {};
  const c = H.load();
  // 结人（辅助·全队集结）+ Helumica（改成直伤拿 +15）
  const party = opt.party || ["yuito", "helu"];
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: opt.seed || "RALLY-END" });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const h = kit(S, party.includes("helu") ? "helu" : party[1]);
  if (y) { y.zone = 1; y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15; c.resetBattleFlags(y); y.ap = 3; y.bonus = 3; }
  if (h) { h.zone = 1; h.roles = Object.assign({}, h.roles, { primary: opt.heluRole || "直伤" }); }
  return { c, S, y, h };
}

function castRally(c, y) {
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.ok(y.resources && y.resources.rallyOn, "施放者挂了 rallyOn");
}

test("全队集结：施放者晕眩 → 全体直伤 +15 结束（队员自己没晕）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.equal(h.rallyAtk, 15);
  // 施放者被打进失衡（真实 dealBreak）
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("全队集结：队员自己晕眩 → 加成还在（不是看每个拿到的人）", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  const notes = [];
  c.dealBreak(h, 99, "physical", notes, "测试");
  assert.equal(!!h.stunned, true);
  assert.ok(y.resources.rallyOn, "施放者还在场上，rallyOn 还在");
  assert.equal(h.rallyAtk, 15, "队员自己晕眩不丢集结");
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  assert.ok(!notes.some(s => /全队集结结束/.test(s)), notes.join("\n"));
});

test("全队集结：施放者濒死 → 全体加成结束", () => {
  const { c, y, h } = field();
  const before = c.effectiveAtk(h, c.S.state.units);
  castRally(c, y);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before + 15);
  // 打空最内层 → applyKnockdown → dying
  (y.layers || []).forEach(l => { l.current = 0; });
  const notes = [];
  const out = c.applyKnockdown(y, notes);
  assert.equal(out, "dying");
  assert.equal(!!y.dying, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before);
  assert.ok(notes.some(s => /全队集结结束：施放者濒死/.test(s)), notes.join("\n"));
});

test("异常集结：持续期间每回合 +1 附赠；倒下不收回本回合已发的，下回合起不再加", () => {
  // Q1：refreshEconomy 按 rallyBy 份额每回合加；主人 10/28：倒下不扣回
  const { c, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  castRally(c, y);
  assert.equal(h.rallyBuff, "异常");
  assert.ok(h.rallyBy && h.rallyBy[y.id] && h.rallyBy[y.id].bonusGranted === 1);
  // 施放当回合已 +1；下一玩家回合 refreshEconomy 仍应带集结份额 → 正常 1 + 集结 1 = 2
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "集结持续期间每回合都有异常 +1");
  assert.equal(h.rallyBuff, "异常", "标记还在");
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyBuff, undefined);
  assert.equal(h.bonus, 2, "本回合已发的附赠保留");
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1, "结束后 refreshEconomy 不再加集结附赠");
});

test("牵挂：结人代扛进失衡 → 集结立刻结束", () => {
  const { c, S, y, h } = field();
  const foe = S.units.find(u => !u.isPlayer);
  castRally(c, y);
  c.setBond(y, h);
  assert.equal(y.resources.bondId, h.id);
  y.def = 1;
  foe.zone = 1;
  // 真实 dealTo：击破由结人代扛 → 结人失衡 → 集结立刻结束
  const out = c.dealTo(foe, h, {
    element: "physical", mult: 1, atk: 1, baseBreak: 5, atkRange: "melee",
    flags: { action: true, block: "none", blockResolved: true }
  });
  assert.equal(!!y.stunned, true, "结人因牵挂失衡");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(out.extra.some(s => /全队集结结束/.test(s)), out.extra.join("\n"));
});

test("闪光震撼弹：施放者被 itemStun → 集结立刻结束", () => {
  const { c, y, h } = field();
  castRally(c, y);
  const notes = [];
  c.itemStun(y, notes);
  assert.equal(!!y.stunned, true);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("捏碎颅骨：力竭 3 施放者直接死亡 → 集结结束", () => {
  const { c, y, h } = field();
  castRally(c, y);
  c.S.state.exhaustTier = 3;   // exhaustTierOf 读 state.exhaustTier
  const notes = [];
  c.crushSkullDown(y, notes);
  assert.equal(!!y.dead, true, "力竭 3 捏碎颅骨直接死亡");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(notes.some(s => /全队集结结束：施放者死亡/.test(s)), notes.join("\n"));
});

test("捏碎颅骨死亡漏钩时：beginRound 对已死施放者仍清掉集结", () => {
  // 模拟「死了但没调 endRallyIfCasterDown」：rallyOn 仍 true，队友还有加成
  const { c, y, h } = field({ seed: "RALLY-DEAD-SWEEP" });
  castRally(c, y);
  const before = c.effectiveAtk(h, c.S.state.units);
  y.dead = true;
  y.dying = false;
  // 故意不调 endRallyIfCasterDown，只靠 beginRound 兜底
  assert.equal(!!y.resources.rallyOn, true);
  assert.equal(h.rallyAtk, 15);
  const notes = [];
  c.beginRound(notes);
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(c.effectiveAtk(h, c.S.state.units), before - 15);
  assert.ok(notes.some(s => /全队集结结束：施放者死亡/.test(s)), notes.join("\n"));
});

test("坦克队员自己失衡：rallyDr 仍生效（engine 与施放者还在）", () => {
  // 在 main 上失败：engine 以前在自己失衡时丢掉 rallyDr
  const { c, y, h } = field({ seed: "RALLY-TANK" });
  h.roles = Object.assign({}, h.roles, { primary: "坦克" });
  castRally(c, y);
  assert.equal(!!h.resources.rallyDr, true);
  // 队员自己失衡
  const notes = [];
  c.dealBreak(h, 99, "physical", notes, "测试");
  assert.equal(!!h.stunned, true);
  assert.ok(y.resources.rallyOn, "施放者还在");
  assert.equal(!!h.resources.rallyDr, true, "自己失衡不丢坦克减伤");
  // 真实 resolveAttack：加算百分比应含 −15%
  const foe = c.S.state.units.find(u => !u.isPlayer);
  const r = c.resolveAttack({
    attacker: foe, target: h, atk: 10, mult: 1, flat: 0, diceValue: 0,
    element: "physical", baseBreak: 0, hits: 1, flags: {},
    weather: "none", phaseStep: 1, zoneMode: 2, targetField: {}, attackerField: {}
  });
  const log = (r.log || []).join("\n");
  assert.match(log, /全队集结（坦克）/, log);
  assert.match(log, /加算百分比合计 -15%/, log);
});

test("载具驾驶员标记没攒满：stunShrugged 时集结不结束", () => {
  const { c, y, h } = field({ seed: "RALLY-VEH" });
  castRally(c, y);
  // 假装结人和载具合并（isBossUnit 对 vehMerged 为 true）
  y.vehMerged = true;
  y.stunMarks = 0;
  y._bossMarked = false;
  assert.equal(!!c.isBossUnit(y), true);
  assert.equal(!!c.stunShrugged(y), true);
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");   // 真打一次：架势打空，但标记没攒满
  assert.equal(!!y.resources.rallyOn, true);
  assert.equal(h.rallyAtk, 15);
  assert.ok(!notes.some(s => /全队集结结束/.test(s)));
});

test("直伤集结结束：召唤武器重算 atk 后再清，不把 atk 扣到基础以下", () => {
  // 旧 clearRallyBuff 做 u.atk − rallyAtk：柯尔特 10→25→召唤扭矩重算成 6→再 −15 = −9
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "kolt"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "RALLY-ATK-FLOOR" });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const k = kit(S, "kolt");
  y.zone = 1; k.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  k.roles = Object.assign({}, k.roles, { primary: "直伤" });
  const personal = Number(k.personalAtk) || 0;
  assert.equal(k.atk, personal + (Number(k.weaponAtk) || 0));
  castRally(c, y);
  assert.equal(k.rallyAtk, 15);
  assert.equal(k.atk, personal + (Number(k.weaponAtk) || 0) + 15);
  // 召唤扭矩：owner.atk = personalAtk，集结的 +15 从字段里消失，但 rallyAtk 还在
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  assert.equal(k.atk, personal, "召唤后 atk 被重算成 personalAtk");
  assert.equal(k.rallyAtk, 15);
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(k.rallyAtk || 0, 0);
  assert.ok(k.atk >= personal, `atk 不应低于 personalAtk（实际 ${k.atk}）`);
  assert.equal(k.atk, personal);
  assert.equal(c.effectiveAtk(k, S.units), personal);
  // 再清一次应幂等
  c.clearRallyBuff(k, []);
  assert.equal(k.atk, personal);
});

test("异常集结：每回合 refreshEconomy 都加 +1（多回合）", () => {
  const { c, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  castRally(c, y);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "第二回合仍是 1+1");
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "第三回合仍是 1+1");
});

test("两人全队集结叠加：直伤 +30；一人倒下留 +15；两人都倒下清零", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["yuito", "nora", "helu"],
    enemies: [{ id: "thug_knife", lv: 3, zone: 1 }],
    seed: "RALLY-STACK"
  });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const m = kit(S, "nora");
  const h = kit(S, "helu");
  for (const u of [y, m, h]) u.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  m.roles = { primary: "辅助", secondary: "辅助" }; m.level = 15;
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  c.resetBattleFlags(m); m.ap = 3; m.bonus = 3;
  const baseAtk = Number(h.atk) || 0;
  const beforeEff = c.effectiveAtk(h, S.units);

  castRally(c, y);
  assert.equal(h.rallyAtk, 15);
  assert.equal(h.atk, baseAtk + 15);
  assert.ok(h.rallyBy && h.rallyBy[y.id] && h.rallyBy[y.id].atkGranted === 15);

  castRally(c, m);
  assert.equal(h.rallyAtk, 30, "两人各 +15 叠加");
  assert.equal(h.atk, baseAtk + 30);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff + 30);
  assert.ok(h.rallyBy[y.id] && h.rallyBy[m.id]);

  // 结人倒下：只清结人那份
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  assert.equal(!!y.resources.rallyOn, false);
  assert.equal(!!m.resources.rallyOn, true, "诺拉的 rallyOn 还在");
  assert.equal(h.rallyAtk, 15, "留下诺拉的 +15");
  assert.equal(h.atk, baseAtk + 15);
  assert.ok(!h.rallyBy[y.id] && h.rallyBy[m.id]);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff + 15);

  // 诺拉也倒下：全清
  c.dealBreak(m, 99, "physical", notes, "测试");
  assert.equal(!!m.resources.rallyOn, false);
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(h.rallyBuff, undefined);
  assert.equal(h.atk, baseAtk);
  assert.equal(c.effectiveAtk(h, S.units), beforeEff);
});

test("两人全队集结·异常：一人倒下留下另一人的 +1 附赠", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["yuito", "nora", "helu"],
    enemies: [{ id: "thug_knife", lv: 3, zone: 1 }],
    seed: "RALLY-STACK-BONUS"
  });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito");
  const m = kit(S, "nora");
  const h = kit(S, "helu");
  for (const u of [y, m, h]) u.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  m.roles = { primary: "辅助", secondary: "辅助" }; m.level = 15;
  h.roles = Object.assign({}, h.roles, { primary: "异常" });
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  c.resetBattleFlags(m); m.ap = 3; m.bonus = 3;

  castRally(c, y);
  castRally(c, m);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 3, "正常1 + 两份额各+1");
  assert.equal(Object.keys(h.rallyBy || {}).length, 2);

  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.bonus, 3, "本回合已发的保留");
  assert.ok(h.rallyBy && h.rallyBy[m.id] && !h.rallyBy[y.id]);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2, "诺拉还在时每回合仍 +1");

  c.dealBreak(m, 99, "physical", [], "测试");
  assert.equal(h.bonus, 2, "本回合已发的保留");
  assert.equal(h.rallyBuff, undefined);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1);
});

test("直伤集结结束：atk 托底不用 effectiveAtk（不把 bond/duet 写进 u.atk）", () => {
  const { c, S, y, h } = field();
  h.roles = Object.assign({}, h.roles, { primary: "直伤" });
  const personal = Number(h.personalAtk) || 0;
  const weapon = Number(h.weaponAtk) || 0;
  const base = personal + weapon;
  h.bondAtk = 10;
  h.duetAtk = 7;
  castRally(c, y);
  assert.equal(h.rallyAtk, 15);
  assert.equal(h.atk, base + 15, "u.atk 只含基础+集结，不含 bond/duet");
  assert.equal(c.effectiveAtk(h, S.units), c.baseEffectiveAtk(h, S.units) + 10 + 7 + 15);
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(h.atk, base, "清掉后 u.atk 回到基础，bond/duet 仍只在 effectiveAtk");
  assert.ok(!h.bondAtk || h.bondAtk === 10);
});

function twoCasters(seed, heluRole) {
  const c = H.load();
  c.BattleSim.setup({ party: ["yuito", "nora", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed });
  c.startCombat();
  const S = c.S.state;
  const y = kit(S, "yuito"), m = kit(S, "nora"), h = kit(S, "helu");
  for (const u of [y, m, h]) u.zone = 1;
  y.roles = { primary: "辅助", secondary: "辅助" }; y.level = 15;
  m.roles = { primary: "辅助", secondary: "辅助" }; m.level = 15;
  h.roles = Object.assign({}, h.roles, { primary: heluRole });
  c.resetBattleFlags(y); y.ap = 3; y.bonus = 3;
  c.resetBattleFlags(m); m.ap = 3; m.bonus = 3;
  return { c, S, y, m, h };
}

test("两人集结·日志：一人倒下点名施放者、注明另一份还在；辅助份额不写", () => {
  const { c, y, m, h } = twoCasters("RALLY-LOG", "坦克");
  castRally(c, y); castRally(c, m);
  const notes = [];
  c.dealBreak(y, 99, "physical", notes, "测试");
  const log = notes.join("\n");
  assert.equal(h.resources.rallyDr, 1, "诺拉那份 −15% 还在");
  assert.match(log, new RegExp(`${h.name} 失去${y.name}的全队集结增益（${m.name}的还在）`), log);
  assert.ok(!notes.some(s => s.startsWith(`${m.name} 失去`)), "诺拉拿到的是辅助份额，没有效果，不写：\n" + log);
  assert.ok(!/增益结束。/.test(log), log);
  const iEnd = notes.findIndex(s => /全队集结结束：施放者晕眩/.test(s));
  const iLose = notes.findIndex(s => /失去/.test(s));
  assert.ok(iEnd >= 0 && iEnd < iLose, "先写集结结束，再写各人失去：\n" + log);
});

test("施放者倒下时已死亡的队员：份额也清掉，GM 复活后不再每回合 +1", () => {
  const { c, y, h } = field({ heluRole: "异常" });
  castRally(c, y);
  assert.ok(h.rallyBy && h.rallyBy[y.id]);
  h.dead = true; h.dying = false;
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(!!y.resources.rallyOn, false);
  assert.ok(!h.rallyBy || !h.rallyBy[y.id], "死亡队员身上的份额也清了");
  c.dmRevive(h);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1, "复活后只有正常 1 个附赠");
});

test("异常集结：本回合已用掉 1 个附赠后施放者倒下，留着的那个不被扣（主人 10/28）", () => {
  const { c, y, h } = field({ heluRole: "异常" });
  castRally(c, y);
  c.refreshEconomy(h);
  assert.equal(h.bonus, 2);
  h.bonus -= 1;   // 玩家回合用掉 1 个，留 1 个协助格挡
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(require("vm").runInContext("RALLY_REVOKE_BONUS_ON_DOWN", c), false);
  assert.equal(h.bonus, 1, "留着协助格挡的附赠还在");
  c.refreshEconomy(h);
  assert.equal(h.bonus, 1, "下一回合起不再加集结附赠");
});

test("GM 强制失衡：集结结束写进日志", () => {
  const { c, y, h } = field();
  castRally(c, y);
  const notes = [];
  c.dmForceStun(y, notes);
  assert.equal(h.rallyAtk || 0, 0);
  assert.ok(notes.some(s => /全队集结结束：施放者晕眩/.test(s)), notes.join("\n"));
});

test("失衡的辅助不能施放全队集结：给出原因，不扣次数、不加增益", () => {
  const { c, y, h } = field();
  y.stunned = true;
  assert.equal(c.skillRequirementError(y, "role_rally"), "失衡时不能施放全队集结");
  const apBefore = y.ap;
  cmd(c, { actor: y.id, skill: "role_rally" });
  assert.ok(!(y.resources && y.resources.rallyOn), "没有施放");
  assert.equal(h.rallyAtk || 0, 0);
  assert.equal(y.ap, apBefore, "不扣行动点");
  y.stunned = false;
  assert.equal(c.skillRequirementError(y, "role_rally"), null, "恢复后可以施放（次数没被用掉）");
});

test("两人集结·坦克叠加：rallyDr = 2，实际结算 −30%，克制表也是 −30%；一人倒下回到 −15%", () => {
  const { c, S, y, m, h } = twoCasters("RALLY-TANK2", "坦克");
  castRally(c, y); castRally(c, m);
  assert.equal(h.resources.rallyDr, 2);
  const foe = S.units.find(u => !u.isPlayer);
  const atk = () => c.resolveAttack({ attacker: foe, target: h, atk: 100, mult: 1, hits: 1, baseBreak: 0, element: "physical",
    flags: { action: true }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 0, atkRange: "any" });
  assert.match(atk().log.join("\n"), /加算百分比合计 -30%/);
  const ch = c.matchupDefenderOf ? c.matchupDefenderOf(h) : null;
  if (ch) assert.equal(ch.resources.rallyDr, 2);
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.resources.rallyDr, 1);
  assert.match(atk().log.join("\n"), /加算百分比合计 -15%/);
});

test("两人集结·击破叠加：rallyBreak = 2；一人倒下剩 1", () => {
  const { c, y, m, h } = twoCasters("RALLY-BRK2", "击破");
  castRally(c, y); castRally(c, m);
  assert.equal(h.rallyBreak, 2);
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.rallyBreak, 1);
  c.dealBreak(m, 99, "physical", [], "测试");
  assert.equal(h.rallyBreak || 0, 0);
});

test("两人集结·护卫叠加：协助格挡 +30%；一人倒下剩 +15%", () => {
  const { c, S, y, m, h } = twoCasters("RALLY-BLK2", "护卫");
  const foe = S.units.find(u => !u.isPlayer);
  const base = c.finalBlockChance(h, foe, y, "melee");
  castRally(c, y); castRally(c, m);
  assert.equal(h.rallyBlock, 30);
  assert.equal(c.finalBlockChance(h, foe, y, "melee"), base + 30);
  c.dealBreak(y, 99, "physical", [], "测试");
  assert.equal(h.rallyBlock, 15);
  assert.equal(c.finalBlockChance(h, foe, y, "melee"), base + 15);
});
