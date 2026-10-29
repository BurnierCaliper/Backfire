// PvP：被嘲讽时攻击只能打嘲讽者，开着友伤也不能打队友（#478，#467 的调整，作者 10/29：「被嘲讽了就只能打嘲讽的」；docs/pvp.md 第 5 节）。
//   · 以前（#464 / PR #467）：被嘲讽的玩家角色只是选「敌对」的单位时只能选嘲讽者，开着友伤打自己阵营的队友不受限制；
//   · 现在：所有攻击都只能以嘲讽者为目标——打敌人的技能开着友伤选得到的队友、分步里「选敌人」那几步列进来的队友、
//     「任意单位」的攻击技能（电能鞭、磁力移动……，engine.js · SKILL_ATTACKS_ANY）选的自己人都不行；武器人跟着一起被嘲讽，同样只能打嘲讽者。
//   · 只限制攻击：给友方的治疗、增益（双重奏、应急处理、意式浓缩给行动点……）照常；反应（协助攻击、协助格挡）照旧不受限制、也不用掉嘲讽。
//   · 只有一个玩家阵营（普通 PvE）时一切照旧（队友挂着的嘲讽不起作用）。
// 规则在 app.js · tauntFoe / tauntAttackPick / tauntStepOk / playerTauntWhy / skillFlowSteps、game.js · candidateUnits、enemies.js · friendlyFireAside。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file }));
const ids = list => plain(list.map(u => u.id)).sort();

/** party 里第 3、4 个分到「乙」（split = false 时不分阵营），其余在「我方」；狂徒一只（血厚）；全在 1 区，带战斗画面（game.js）和联机校验 */
function field(party, opt = {}) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP478-TAUNT" });
  const S = c.S.state, heroes = party.map(k => c.findKit(k, S.units)), thug = S.units.find(u => !u.isPlayer);
  S.units.forEach(u => { u.zone = 1; });
  thug.layers = [{ type: "flesh", current: 500, max: 500 }]; thug.def = thug.defMax = 30;
  if (opt.split !== false) heroes.slice(2).forEach(h => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: h.id }));
  c.startCombat();
  heroes.forEach(h => { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 4; h.level = Math.max(Number(h.level) || 1, 10); });
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  load(c, ["game.js", "hotseat-validation.js"]);
  const skill = (a, id) => c.GAME.gameSkills(a).find(s => s.id === id);
  const cand = (a, id) => ids(c.GAME.candidateUnits(a, skill(a, id)));
  const validate = (a, id, t, picks) => c.HotseatValidation.validateBattle({ type: "skill", actor: a.id, skill: id, target: t ? t.id : null, picks: picks || {} }, { session: { assertAction: () => true }, sender: "p1", game: { depth: 0, tape: null } });
  /** 带着分步的选择问扣点之前的检查（和联机校验、本机出手一样：分步记在 state.skillFlow 上） */
  const why = (a, id, t, picks) => {
    S.skillFlow = picks ? { id, actorId: a.id, picks, index: 99 } : null;
    try { return c.skillTargetError(a, id, t) || ""; } finally { S.skillFlow = null; }
  };
  const settle = () => { while (S.blockQueue && S.blockQueue.length) c.finishBlock(null); };
  return { c, S, heroes, thug, skill, cand, validate, why, settle };
}

test("被嘲讽开着友伤也不能打队友（打敌人的技能）：本机名单、扣点之前的检查、联机校验都只剩嘲讽者，直接发指令打队友不扣点、打不到", () => {
  const f = field(["kolt", "helu", "yuito", "nora"]);
  const { c, S, heroes: [kolt, helu, yuito, nora], thug, cand, validate, why, settle } = f;
  [kolt, helu, nora, thug].forEach(u => { u.zone = 2; });   // 结人的普攻打距离 1
  c.setFriendlyFire(null, true);   // 本机一个人操控：开着友伤，同阵营（乙）的诺拉也打得到
  assert.equal(c.attackFoe(yuito, nora), true, "开着友伤：诺拉打得到");
  assert.deepEqual(cand(yuito, "yuito_aa"), ids([kolt, helu, nora, thug]), "对照：没被嘲讽时开着友伤能打诺拉");
  yuito.tauntTo = kolt.id;   // 被敌对阵营（我方）的柯尔特嘲讽
  assert.equal(c.playerTauntTarget(yuito), kolt);
  assert.deepEqual(cand(yuito, "yuito_aa"), [kolt.id], "被嘲讽：名单只剩嘲讽者（诺拉也不能选，以前开着友伤照样能打）");
  assert.match(why(yuito, "yuito_aa", nora), /结人 被 柯尔特 嘲讽：只能攻击 柯尔特/, "扣点之前拦下");
  assert.equal(why(yuito, "yuito_aa", kolt), "", "打嘲讽者照常");
  assert.throws(() => validate(yuito, "yuito_aa", nora), /嘲讽/, "联机 / 热座出手前的校验也拦下");
  assert.doesNotThrow(() => validate(yuito, "yuito_aa", kolt));
  // 直接发指令打诺拉：不扣行动点、诺拉没挨打
  const ap = yuito.ap, hp = c.totalHp(nora);
  c.Commands.dispatch({ type: "skill", actor: yuito.id, skill: "yuito_aa", target: nora.id, picks: {} });
  settle();
  assert.equal(yuito.ap, ap, "扣点之前就拦下");
  assert.equal(c.totalHp(nora), hp, "诺拉没挨打");
  assert.equal(yuito.tauntTo, kolt.id, "被拦下的那一下不用掉嘲讽");
  // 分步选了「打」的那一档、目标是本机选的单体目标（意式浓缩的酸液攻击）：也只能打嘲讽者
  assert.match(why(yuito, "yuito_espresso", nora, { mode: "atk" }), /嘲讽/, "意式浓缩的酸液攻击打诺拉：拦下");
  // 诺拉的普攻（算「任意单位」；没有刺入时打选中的距离 1 的目标）：开着友伤打同阵营的结人也不行
  nora.tauntTo = kolt.id;
  assert.equal(c.skillSideOf(nora, "nora_aa"), "any");
  assert.match(why(nora, "nora_aa", yuito), /诺拉 被 柯尔特 嘲讽/);
  assert.deepEqual(plain(c.__errors), []);
  assert.ok(S && helu);
});

test("被嘲讽开着友伤：分步里「选敌人」的那一步也拿掉队友（灯的普攻、声波切割）；武器人一起被嘲讽，年糕的吼叫也打不了队友", () => {
  const f = field(["kolt", "helu", "tou", "chuan"]);
  const { c, S, heroes: [kolt, helu, tou, chuan], thug, cand, validate, why, settle } = f;
  c.setFriendlyFire(null, true);
  const near = { rangeMode: "near" };   // 灯有圣盾：普攻先选打同区还是花圣盾打距离 1，再选同区的目标
  const targets = () => ids((c.skillFlowSteps("tou_aa", tou, near).find(st => st.key === "target") || { units: [] }).units);
  assert.ok(targets().includes(chuan.id), "对照：没被嘲讽时开着友伤，分步里列着同阵营的川川");
  tou.tauntTo = kolt.id;
  assert.deepEqual(targets(), [kolt.id], "被嘲讽：分步里的目标只剩嘲讽者（以前开着友伤列进来的川川还在）");
  assert.match(why(tou, "tou_aa", chuan, { rangeMode: "near", target: chuan.id }), /灯 被 柯尔特 嘲讽/, "分步里选了川川：扣点之前拦下");
  assert.throws(() => validate(tou, "tou_aa", chuan, { rangeMode: "near", target: chuan.id }), /嘲讽|不合法的分步选择/);
  assert.doesNotThrow(() => validate(tou, "tou_aa", kolt, { rangeMode: "near", target: kolt.id }));
  const sonic = c.skillFlowSteps("tou_sonic", tou, {}).filter(st => st.type === "unit");
  assert.ok(sonic.length && sonic.every(st => st.units.every(u => u.id === kolt.id)), "声波切割的每一步也只剩嘲讽者");
  // 直接发指令：分步里选川川，不扣点、川川没挨打
  const ap = tou.ap, hp = c.totalHp(chuan);
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_aa", target: chuan.id, picks: { rangeMode: "near", target: chuan.id } });
  settle();
  assert.equal(tou.ap, ap, "扣点之前就拦下");
  assert.equal(c.totalHp(chuan), hp, "川川没挨打");
  // 武器人：年糕跟着灯被嘲讽，吼叫（打敌人）开着友伤也不能吼川川
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  assert.ok(mochi && !mochi.hidden, "年糕在场");
  mochi.ap = mochi.apMax = 4; mochi.bonus = mochi.bonusMax = 4;
  assert.equal(c.playerTauntTarget(mochi), kolt, "年糕跟着灯一起被嘲讽");
  assert.ok(!cand(mochi, "mochi_roar").includes(chuan.id), "年糕的吼叫名单里没有川川");
  assert.ok(!cand(mochi, "mochi_roar").includes(tou.id), "也没有灯");
  assert.deepEqual(cand(mochi, "mochi_roar"), [kolt.id], "只剩嘲讽者");
  assert.match(why(mochi, "mochi_roar", chuan), /年糕 被 柯尔特 嘲讽/);
  assert.ok(helu && thug);
});

test("被嘲讽时「任意单位」的攻击技能（电能鞭、磁力移动）也不能打自己人——开没开友伤都一样；给自己人的「任意单位」技能（电站超频）照常", () => {
  const f = field(["kolt", "helu", "chuan", "tou"]);
  const { c, S, heroes: [kolt, helu, chuan, tou], thug, cand, validate, why, settle } = f;
  chuan.tauntTo = kolt.id;
  assert.equal(c.attackFoe(chuan, tou), false, "没开友伤");
  assert.equal(c.skillSideOf(chuan, "chuan_whip"), "any", "电能鞭照提示文字猜成「任意单位」，开不开友伤都选得到队友");
  assert.ok(cand(chuan, "chuan_whip").includes(kolt.id));
  assert.ok(!cand(chuan, "chuan_whip").includes(tou.id), "被嘲讽：电能鞭的名单里没有同阵营的灯（以前照样能抽队友）");
  assert.match(why(chuan, "chuan_whip", tou), /川川 被 柯尔特 嘲讽：只能攻击 柯尔特/);
  assert.throws(() => validate(chuan, "chuan_whip", tou), /嘲讽/);
  const ap = chuan.ap, hp = c.totalHp(tou);
  c.Commands.dispatch({ type: "skill", actor: chuan.id, skill: "chuan_whip", target: tou.id, picks: {} });
  settle();
  assert.equal(chuan.ap, ap, "直接发指令抽灯：不扣行动点");
  assert.equal(c.totalHp(tou), hp, "灯没挨打");
  // 开着友伤也一样
  c.setFriendlyFire(null, true);
  assert.ok(!cand(chuan, "chuan_whip").includes(tou.id));
  // 电站超频（任意单位过载 / 护盾，不是攻击）：给自己人照常
  assert.ok(cand(chuan, "chuan_over").includes(tou.id), "电站超频给灯：照常能选");
  assert.equal(why(chuan, "chuan_over", tou), "", "不拦");
  // 磁力移动（哔哩哩：推远 / 拉到身边 + 1 击破）：分步里选自己人也不行（武器人跟着川川被嘲讽）
  c.Commands.dispatch({ type: "skill", actor: chuan.id, skill: "chuan_summon" });
  const bili = c.findKit("bili", S.units);
  assert.ok(bili && !bili.hidden, "哔哩哩在场");
  bili.ap = bili.apMax = 4; bili.bonus = bili.bonusMax = 4;
  const magnet = ids((c.skillFlowSteps("bili_magnet", bili, {}).find(st => st.key === "target") || { units: [] }).units);
  assert.deepEqual(magnet, [kolt.id], "磁力移动的目标只剩嘲讽者（灯、川川都拿掉）");
  assert.match(why(bili, "bili_magnet", tou, { target: tou.id, dest: 2 }), /嘲讽/);
  assert.ok(helu && thug);
});

test("只限制攻击：被嘲讽开着友伤，打不了队友，但照样能治疗、增益同一个队友（双重奏、应急处理、意式浓缩给行动点），治疗不用掉嘲讽；反应（协助攻击、协助格挡）照旧", () => {
  const f = field(["kolt", "helu", "yuito", "nora"]);
  const { c, S, heroes: [kolt, helu, yuito, nora], thug, cand, validate, why, settle } = f;
  c.setFriendlyFire(null, true);
  yuito.tauntTo = kolt.id;
  kolt.zone = nora.zone = 2;
  assert.match(why(yuito, "yuito_aa", nora), /嘲讽/, "攻击诺拉：拦下");
  nora.zone = 1;
  // 双重奏（分步里选治疗谁）：名单里有诺拉，检查不拦，真的治疗了
  yuito.resources.liquid = 3;
  const duet = c.skillFlowSteps("yuito_duet", yuito, {}).find(st => st.key === "target");
  assert.ok(duet && duet.units.some(u => u.id === nora.id), "双重奏的名单里还有诺拉");
  assert.equal(why(yuito, "yuito_duet", nora, { target: nora.id }), "", "治疗诺拉不拦");
  assert.doesNotThrow(() => validate(yuito, "yuito_duet", nora, { target: nora.id }));
  nora.layers.forEach(l => { l.current = Math.max(1, Math.floor(l.max / 3)); });
  const hp = c.totalHp(nora), liquid = yuito.resources.liquid;
  c.Commands.dispatch({ type: "skill", actor: yuito.id, skill: "yuito_duet", target: nora.id, picks: { target: nora.id } });
  assert.ok(c.totalHp(nora) > hp, "诺拉真的被治疗了");
  assert.equal(yuito.resources.liquid, liquid - 2, "花了咖啡液");
  assert.equal(yuito.tauntTo, kolt.id, "治疗队友不用掉嘲讽（没打嘲讽者）");
  // 应急处理（单体给友方）、意式浓缩给行动点（分步里给友方的那一档）：照常
  assert.ok(cand(yuito, "role_firstaid").includes(nora.id), "应急处理的名单里有诺拉");
  assert.equal(why(yuito, "role_firstaid", nora), "", "应急处理诺拉不拦");
  const ap = c.skillFlowSteps("yuito_espresso", yuito, { mode: "ap" }).find(st => st.key === "target");
  assert.ok(ap && ap.units.some(u => u.id === nora.id), "意式浓缩给行动点：名单里有诺拉");
  assert.equal(why(yuito, "yuito_espresso", nora, { mode: "ap", target: nora.id }), "", "给诺拉加行动点不拦");
  // 反应：协助攻击照样能接（打别的失衡单位），不用掉嘲讽
  thug.stunned = true; thug.def = 0;
  S.assistQueue = [{ breakerId: nora.id, targetId: thug.id, vsPlayer: false, pvpStage: "players" }];
  assert.ok(c.eligibleAssisters(nora, thug, S.assistQueue[0]).some(u => u.id === yuito.id), "结人在协助攻击的名单里");
  const thugHp = c.totalHp(thug);
  c.finishAssist(yuito.id);
  settle();
  assert.ok(c.totalHp(thug) < thugHp, "结人的协助攻击打到了狂徒");
  assert.equal(yuito.tauntTo, kolt.id, "协助攻击不用掉嘲讽");
  // 反应：协助格挡照样能替同阵营的诺拉挡
  thug.stunned = false;
  assert.ok(c.eligibleBlockers(nora, { attackerId: thug.id, targetId: nora.id }).some(u => u.id === yuito.id), "结人照样能替诺拉协助格挡");
  assert.ok(helu);
});

test("只有一个玩家阵营（普通 PvE）时一切照旧：开着友伤、队友挂着嘲讽也照常能打队友和敌人、电能鞭照常；同样的场面分成两个敌对阵营才拦", () => {
  const scene = split => {
    const f = field(["kolt", "helu", "yuito", "chuan"], { split });
    const { c, heroes: [kolt, helu, yuito, chuan], thug } = f;
    [kolt, helu, chuan, thug].forEach(u => { u.zone = 2; });
    c.setFriendlyFire(null, true);
    yuito.tauntTo = kolt.id; chuan.tauntTo = kolt.id;   // 同阵营时：柯尔特开着友伤打到队友，「过度自信」会挂上这个
    helu.zone = 1;
    return Object.assign(f, { kolt, helu, yuito, chuan });
  };
  const one = scene(false);
  assert.equal(one.c.playerTauntTarget(one.yuito), null, "只有一个阵营：嘲讽不起作用");
  assert.deepEqual(one.cand(one.yuito, "yuito_aa"), ids([one.kolt, one.chuan, one.thug]), "照旧能打队友（开着友伤）和狂徒");
  assert.equal(one.why(one.yuito, "yuito_aa", one.chuan), "");
  assert.ok(one.cand(one.chuan, "chuan_whip").includes(one.helu.id), "电能鞭照常能抽同区的赫鲁米卡");
  assert.equal(one.why(one.chuan, "chuan_whip", one.helu), "");
  // 分成两个敌对阵营（结人、川川在乙，被我方的柯尔特嘲讽）：结人打同阵营的川川、川川抽同阵营的结人都拦下
  const two = scene(true);
  assert.equal(two.c.playerTauntTarget(two.yuito), two.kolt);
  assert.deepEqual(two.cand(two.yuito, "yuito_aa"), [two.kolt.id], "只剩嘲讽者");
  assert.match(two.why(two.yuito, "yuito_aa", two.chuan), /嘲讽/);
  two.yuito.zone = 2;
  assert.match(two.why(two.chuan, "chuan_whip", two.yuito), /嘲讽/);
});
