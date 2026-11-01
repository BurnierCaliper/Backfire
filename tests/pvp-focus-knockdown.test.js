// 聚焦抹层打到玩家一方的单位（#544，主人 11/01 手操 PvP 测试发现）：抹掉的是最内层时，和「最内层生命归零」一样走倒地结算
// （app.js · stripFocusLayer → applyKnockdown）——濒死（允许起身时照常起身改打坚毅）、决斗不允许起身就倒在场上（一队全倒判负）、
// 决斗里力竭 3 被击倒只是再起不能、还魂、武器人倒下……照原规则。以前 stripFocusLayer 只把这一层写成 0/0（封死），
// 敌人照旧按内层归零死亡，玩家角色却卡在 0 血不倒、还能一直行动（决斗按全倒判负，这一队可能永远判不输）。
// 抹掉的是外层时照旧只去掉那一层（+2 击破）。聚焦对玩家要几步（app.js · focusSeqLen：玩家角色不是精英 / 首领，1 步）这次不动。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const V = require("../online-view");
const plain = v => JSON.parse(JSON.stringify(v));
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
/** 直接调 dealTo 时这一击写的几行（走指令的才会写进战斗记录） */
const said = out => ((out && out.extra) || []).join("\n");
/** 一下谐波（直接结算，不等协助格挡；击破 0：只看抹层给的）。每次一份新的：dealTo 会往 opt 上写东西 */
const harmonic = () => ({ atk: 10, mult: 1, element: "harmonic", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
/** 一下重击，直接结算 */
const smash = (c, a, t, dmg) => c.dealTo(a, t, { atk: 0, mult: 0, flat: dmg, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });

/** 决斗：1 队 赫鲁米卡、柯尔特，2 队 龙哥、绯秋（opt.party / opt.teams 换阵容），1 队先手。opt.cmd 是指令里另外的字段（stand / rounds），
 *  opt.game 打开游戏版（坚毅不显示数字）。龙哥只有一层肉体（opt.layers 换），赫鲁米卡站到 2 区（普攻是远距离，打得到 3 区的 2 队）；
 *  2 队的附赠清零（不协助格挡，和 issue 里的复现一样） */
function duel(opt = {}) {
  const party = opt.party || ["helu", "kolt", "longge", "hiaki"];
  const c = H.load();
  if (opt.game) c.GAME_MODE = true;
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: opt.seed || "FOCUS544" });
  const S = c.S.state;
  const heroes = party.map(k => c.findKit(k, S.units));
  if (opt.before) opt.before(c, heroes);
  const teams = opt.teams ? opt.teams(heroes) : { "1队": [heroes[0].id, heroes[1].id], "2队": [heroes[2].id, heroes[3].id] };
  c.Commands.dispatch(Object.assign({ type: "battle.duel", teams }, opt.cmd || {}));
  const keep = c.Math.random;
  c.Math.random = () => 0.1;   // 抛硬币：1 队先手
  try { c.startCombat(); } finally { c.Math.random = keep; }
  const unit = k => c.findKit(k, S.units);
  const helu = unit("helu"), longge = unit("longge");
  if (longge) { longge.layers = opt.layers || [{ type: "flesh", current: 60, max: 60, inner: true }]; longge.shp = 30; longge.shpMax = 40; }
  helu.zone = 2;
  clearBonus(c);
  return { c, S, unit, helu, kolt: unit("kolt"), longge, hiaki: unit("hiaki") };
}
/** 2 队（含武器人）的附赠清零：不协助格挡 */
function clearBonus(c) { c.S.state.units.forEach(u => { if (u.isPlayer && c.pvpDuelTeamOf(u) === "2队") u.bonus = 0; }); }
/** 赫鲁米卡聚焦 t 的 layer 那一层，序列定成一步「谐波」；再用普攻（谐波，总打在聚焦的那一层上）打它一下：序列走完，抹层 */
function focusAndAa(c, helu, t, layer) {
  c.applyFocus(t, layer, [], { by: helu });
  assert.equal((t.focuses || []).length, 1, `${t.name} 被聚焦了`);
  t.focuses[0].seq = ["harmonic"];
  helu.ap = Math.max(1, Number(helu.ap) || 0);
  c.Commands.dispatch({ type: "skill", actor: helu.id, skill: "helu_aa", target: t.id });
  assert.ok(!(t.focuses || []).length, "序列走完、聚焦清掉了");
}
/** 把一个人打到倒地（濒死，还没起身） */
function knockDown(u) { (u.layers || []).forEach(l => { l.current = 0; }); u.dying = true; u.upOnShp = false; }

test("决斗里聚焦抹掉玩家角色的最内层（纯肉体）：立刻倒地（濒死），之后照倒地的规则受保护；允许起身时照常起身，之后挨打改扣坚毅（#544：以前 0 血不倒、还能一直行动）", () => {
  const { c, S, helu, kolt, longge } = duel();
  assert.equal(c.focusSeqLen(longge), 1, "玩家角色的聚焦序列 1 步（这次不动）");
  focusAndAa(c, helu, longge, "flesh");
  const log = logText(c);
  assert.match(log, /龙哥 聚焦推进 1\/1（谐波）/);
  assert.match(log, /龙哥 聚焦完成：肉体被抹去（视为 \d+ 点伤害，该层无法再被治疗）。/);
  assert.match(log, /龙哥 聚焦抹层导致最内层归零，陷入濒死。/, "倒地写进战斗记录");
  assert.deepEqual(plain(longge.layers), [{ type: "flesh", current: 0, max: 0, inner: true, sealed: true }], "这一层照旧抹成 0/0、封死");
  assert.equal(longge.dying, true, "立刻倒地（濒死）");
  assert.equal(longge.dead, false);
  assert.equal(longge.upOnShp, false);
  assert.equal(c.battleStat(longge).downs, 0, "敌对玩家阵营聚焦打倒的：和他们的攻击打倒的一样不记倒地次数（#453）");
  // 倒地以后：起身之前不受伤害（坚毅也不扣）；2 队还有绯秋站着，接着打
  kolt.zone = 2;
  const shp0 = longge.shp;
  const hit = smash(c, kolt, longge, 5);
  assert.match((hit.extra || []).join("\n"), /龙哥 濒死倒地，起身之前不受任何伤害。/);
  assert.equal(longge.shp, shp0);
  assert.deepEqual(plain(c.pvpDuelOutcome()), { over: false });
  // 到 2 队的回合：龙哥照常起身（允许起身），之后受伤改扣坚毅生命；没起身前自动对打的打法也只会让他起身
  c.endPlayerTurn();
  assert.equal(S.combatPhase, "enemy");
  assert.equal(c.standUpBlocked(longge), null, "允许起身");
  assert.ok(c.BattleSim.BASIC_POLICY.act(longge), "倒地的人：只会起身");
  c.Commands.dispatch({ type: "standUp", actor: longge.id });
  assert.equal(longge.upOnShp, true, "起身了");
  assert.equal(longge.dying, false);
  smash(c, kolt, longge, 5);
  assert.equal(longge.shp, shp0 - 5, "起身以后挨打扣坚毅生命");
  assert.deepEqual(plain(longge.layers), [{ type: "flesh", current: 0, max: 0, inner: true, sealed: true }], "血量层不动");
  assert.equal(longge.dead, false);
});

test("不允许起身的决斗：聚焦抹掉最内层同样立刻倒地——倒在场上（不移出、不是再起不能）、自己起不来，这一队全部倒地就判负；力竭 3 的决斗里被抹倒只是再起不能、移出战场", () => {
  {
    const { c, longge, hiaki, helu } = duel({ cmd: { stand: false } });
    knockDown(hiaki);   // 2 队的绯秋已经倒地
    assert.deepEqual(plain(c.pvpDuelOutcome()), { over: false }, "龙哥还站着：接着打");
    focusAndAa(c, helu, longge, "flesh");
    assert.equal(longge.dying, true, "倒地");
    assert.ok(c.fieldUnits().includes(longge), "倒在场上");
    assert.ok(!longge.pvpOut && !longge._removed && !longge.dead, "不是再起不能");
    assert.equal(c.standUpBlocked(longge), "决斗不允许起身");
    const r = plain(c.pvpDuelOutcome());
    assert.equal(r.over, true, "2 队全部倒地：分出胜负");
    assert.equal(r.winner, "1队");
    assert.equal(r.why, "wipe");
    assert.equal(r.text, "1 队获胜：2 队全部倒地。");
  }
  { // 力竭 3（被击倒立刻死亡）：决斗里伤害不会致死，照 pvpDuelKnockOut 再起不能
    const { c, S, longge, helu } = duel();
    S.exhaustTier = 3;
    focusAndAa(c, helu, longge, "flesh");
    assert.equal(longge.pvpOut, true, "再起不能");
    assert.equal(longge._removed, true, "移出战场");
    assert.ok(!c.fieldUnits().includes(longge));
    assert.deepEqual(plain(S.pvpDuel.out), [longge.id]);
    assert.match(logText(c), /龙哥 再起不能（决斗中伤害不会致死），移出战场。/);
  }
});

test("守卫：有两层血量的玩家角色，聚焦抹掉外层（装甲）只少这一层、照旧 2 击破，不倒地", () => {
  const { c, helu, longge } = duel({ layers: [{ type: "armor", current: 40, max: 40 }, { type: "flesh", current: 60, max: 60, inner: true }] });
  longge.def = longge.defMax = 8;
  c.applyFocus(longge, "armor", [], { by: helu });
  longge.focuses[0].seq = ["harmonic"];
  const lines = said(c.dealTo(helu, longge, harmonic()));
  assert.deepEqual(plain(longge.layers.map(l => l.type)), ["flesh"], "只少了装甲这一层");
  assert.equal(longge.layers[0].current, 60, "肉体没动");
  assert.equal(longge.def, 6, "抹层 2 击破");
  assert.equal(longge.dying, false, "不倒地");
  assert.equal(longge.dead, false);
  assert.match(lines, /龙哥 聚焦完成：装甲被抹去/);
  assert.match(lines, /龙哥 受到 2 击破（聚焦抹层）/);
  assert.ok(!/陷入濒死/.test(lines));
});

test("守卫：敌人被聚焦抹掉内层照旧死亡（走击杀结算，不写濒死）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "FOCUS544-PVE" });
  c.startCombat();
  const S = c.S.state;
  const helu = c.findKit("helu", S.units), foe = S.units.find(u => !u.isPlayer);
  foe.layers = [{ type: "flesh", current: 60, max: 60, inner: true }];
  helu.zone = 1; foe.zone = 2;
  c.applyFocus(foe, "flesh", []);
  foe.focuses[0].seq = ["harmonic"];
  const lines = said(c.dealTo(helu, foe, harmonic()));
  assert.equal(foe.dead, true, "死亡");
  assert.equal(foe._xpGiven, true, "走了击杀结算");
  assert.equal(c.battleStat(helu).kills, 1, "击杀算赫鲁米卡的");
  assert.ok(!foe.dying);
  assert.match(lines, /聚焦完成：肉体被抹去/);
  assert.ok(!/陷入濒死/.test(lines + logText(c)));
});

test("照倒地的原规则：决斗里武器人被抹掉最内层就倒下（扣 2 耐久）；开着友伤聚焦队友、抹掉最内层，队友照常濒死、不记倒地次数（和友伤打倒的一样）；还魂保住 1 点生命；夕夏被抹倒后起身照常「背水一战」", () => {
  { // 决斗：2 队的灯唤出年糕，年糕被抹掉最内层
    const { c, S, helu, unit } = duel({ party: ["helu", "kolt", "tou", "hiaki"] });
    const tou = unit("tou");
    const mochi = c.spawnWeapon(tou, "mochi");
    assert.ok(mochi && !mochi.hidden, "年糕上场");
    clearBonus(c);
    const dur0 = c.weaponDur("mochi");
    focusAndAa(c, helu, mochi, c.innermostLayer(mochi).type);
    assert.equal(mochi.dead, true, "武器人倒下");
    assert.match(logText(c), new RegExp(`${mochi.name} 最内层归零，武器人倒下。`));
    assert.equal(c.weaponDur("mochi"), dur0 - 2, "倒下扣 2 耐久");
    assert.ok(S.units.includes(tou) && !tou.dying, "灯本人不受影响");
  }
  { // 不是 PvP：开着友伤的赫鲁米卡聚焦队友柯尔特
    const c = H.load();
    c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 3 }], seed: "FOCUS544-FF" });
    c.startCombat();
    c.Commands.dispatch({ type: "battle.friendlyFire", on: true });
    const S = c.S.state;
    const helu = c.findKit("helu", S.units), kolt = c.findKit("kolt", S.units);
    kolt.layers = [{ type: "flesh", current: 60, max: 60, inner: true }];
    helu.zone = 1; kolt.zone = 2;
    c.applyFocus(kolt, "flesh", [], { by: helu });
    assert.equal((kolt.focuses || []).length, 1, "开着友伤：能聚焦队友");
    kolt.focuses[0].seq = ["harmonic"];
    const lines = said(c.dealTo(helu, kolt, harmonic()));
    assert.equal(kolt.dying, true, "队友照常濒死");
    assert.equal(c.battleStat(kolt).downs, 0, "友伤：不记倒地次数");
    assert.match(lines, /柯尔特 聚焦抹层导致最内层归零，陷入濒死。/);
  }
  { // 还魂：每场一次留 1 点生命、免伤到自己下回合开始；被抹掉的这一层照旧封死，治不回来
    const { c, helu, longge } = duel({ before: (c, h) => { h[2].feats = ["revive"]; } });
    focusAndAa(c, helu, longge, "flesh");
    assert.equal(longge.dying, false, "还魂：没倒地");
    assert.equal(c.totalHp(longge), 1, "保留 1 点生命");
    assert.equal(longge.resources.standTurn, true, "免伤到自己下回合开始");
    assert.match(logText(c), /龙哥 还魂：保留 1 点生命/);
    assert.equal(c.healUnit(longge, 20), 0, "封死的这一层治不回来");
  }
  { // 夕夏「背水一战」：被抹倒以后起身，照常引擎强制启动、起身期间不失去架势
    const { c, helu, kolt, unit } = duel({ party: ["helu", "kolt", "xia", "hiaki"] });
    const xia = unit("xia");
    xia.layers = [{ type: "flesh", current: 60, max: 60, inner: true }];
    xia.shp = 30; xia.shpMax = 40;
    focusAndAa(c, helu, xia, "flesh");
    assert.equal(xia.dying, true, "被抹倒");
    c.endPlayerTurn();
    c.Commands.dispatch({ type: "standUp", actor: xia.id });
    assert.equal(xia.upOnShp, true, "起身");
    assert.equal(xia.resources.engine, true, "背水一战：引擎强制启动");
    assert.match(logText(c), /背水一战：引擎强制启动，起身期间不失去架势。/);
    kolt.zone = 2;
    const def0 = xia.def;
    c.dealTo(kolt, xia, { atk: 0, mult: 0, flat: 3, element: "physical", baseBreak: 2, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
    assert.equal(xia.shp, 27, "挨打扣坚毅");
    assert.equal(xia.def, def0, "背水一战：起身中不失去架势");
  }
});

test("守卫：坚毅生命的数值不给玩家看——游戏版里被抹倒、起身、挨打，以及起身中被临时血量补上的内层又被抹掉，战斗记录、弹字、联机投影里都没有坚毅的数字", () => {
  const { c, S, helu, kolt, longge } = duel({ game: true });
  assert.equal(c.shpHidden(), true, "游戏版");
  S.units.filter(u => u.isPlayer).forEach(u => { u.shp = 73291; u.shpMax = 82731; u.shpBase = 61739; u.shpBonus = 32198; });
  focusAndAa(c, helu, longge, "flesh");
  assert.equal(longge.dying, true);
  c.endPlayerTurn();
  c.Commands.dispatch({ type: "standUp", actor: longge.id });
  assert.equal(longge.upOnShp, true);
  kolt.zone = 2;
  const pops0 = (S.floaters || []).length;
  const hit1 = said(smash(c, kolt, longge, 5));   // 起身以后挨一下：打进坚毅
  const pops = (S.floaters || []).slice(pops0).filter(f => f.unitId === longge.id);
  assert.ok(pops.some(f => f.text === "坚毅受创"), "打进坚毅只弹「坚毅受创」");
  assert.ok(!pops.some(f => /\d/.test(String(f.text))), "不弹数字：" + JSON.stringify(pops.map(f => f.text)));
  // 起身中被临时血量补上内层（例：缓冲 15 级起选肉体）：再被聚焦抹掉
  c.addTempLayer(longge, "flesh", 12);
  c.applyFocus(longge, "flesh", [], { by: helu });
  longge.focuses[0].seq = ["harmonic"];
  const hit2 = said(c.dealTo(helu, longge, harmonic()));
  assert.match(hit2, /龙哥 聚焦完成：肉体被抹去（视为 12 点伤害/);
  const now = longge.shp;
  assert.ok(now < 73291 && now > 70000, "挨了几下坚毅");
  const secret = new RegExp([73291, 82731, 61739, 32198, now].map(n => `(^|\\D)${n}(\\D|$)`).join("|"));
  assert.doesNotMatch([logText(c), hit1, hit2].join("\n"), secret, "战斗记录不写坚毅的数字");
  assert.ok(!(S.floaters || []).some(f => secret.test(String(f.text))), "弹字不写坚毅的数字");
  const ps = V.projectState(plain(S));
  assert.doesNotMatch(JSON.stringify(ps), /"shp|73291|82731|61739|32198/, "联机投影不带坚毅");
  assert.equal(ps.units.find(u => u.id === longge.id).upOnShp, true, "只发「起身中」这个状态");
});
