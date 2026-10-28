// PvP 第二步（#464，docs/pvp.md 第 5 节「嘲讽对玩家」，作者 10/28）：
//   · 玩家角色被嘲讽时，也只能选嘲讽它的那个单位作为攻击目标（和敌人被嘲讽一样）；
//   · 玩家角色被嘲讽时，它的武器人一起被嘲讽。
// 本机选目标的名单（game.js · candidateUnits）、分步名单（app.js · skillFlowSteps）、出手前的校验（app.js · skillTargetError：本机扣点之前、
// 联机 hotseat-validation.js）、联机的动作菜单（online-actions.js）、对敌人用的道具（items.js · itemUseError）都认；规则在 enemies.js · playerTauntTarget。
// 只认敌对的人的嘲讽：同阵营的队友开着友伤嘲讽的不算——只有一个玩家阵营时一切照旧。
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

/** 柯尔特、赫鲁米卡在「我方」，绯秋、灯在「乙」（split = false 时不分阵营），狂徒一只；全在 1 区，带战斗画面（game.js）、联机校验和动作菜单。
 *  summon：灯先叫出年糕（武器人；灯空手了） */
function field(opt = {}) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu", "hiaki", "tou"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], zoneMode: 3, seed: opt.seed || "PVP464-TAUNT" });
  const S = c.S.state;
  const [kolt, helu, hiaki, tou] = ["kolt", "helu", "hiaki", "tou"].map(k => c.findKit(k, S.units));
  const thug = S.units.find(u => !u.isPlayer);
  S.units.forEach(u => { u.zone = 1; });
  thug.layers = [{ type: "flesh", current: 500, max: 500 }]; thug.def = thug.defMax = 30;
  if (opt.split !== false) [hiaki, tou].forEach(h => c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", unit: h.id }));
  c.startCombat();
  [kolt, helu, hiaki, tou].forEach(h => { h.ap = h.apMax = 4; h.bonus = h.bonusMax = 4; h.level = Math.max(Number(h.level) || 1, 5); });
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  load(c, ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]);
  if (opt.summon) c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_summon" });
  const mochi = c.findKit("mochi", S.units);
  if (mochi) { mochi.ap = mochi.apMax = 4; mochi.bonus = mochi.bonusMax = 4; }
  const skill = (a, id) => c.GAME.gameSkills(a).find(s => s.id === id);
  const cand = (a, id) => ids(c.GAME.candidateUnits(a, skill(a, id)));
  const validate = (a, id, t, picks) => c.HotseatValidation.validateBattle({ type: "skill", actor: a.id, skill: id, target: t ? t.id : null, picks: picks || {} }, { session: { assertAction: () => true }, sender: "p1", game: { depth: 0, tape: null } });
  return { c, S, kolt, helu, hiaki, tou, mochi, thug, skill, cand, validate };
}

test("嘲讽对玩家：被敌对阵营的人嘲讽后，打敌人的技能只能选嘲讽者——本机名单、分步名单、出手前的校验（扣点之前拦下）、联机校验都认；给自己人用的照常", () => {
  const f = field();
  const { c, S, kolt, helu, hiaki, tou, thug, cand, validate } = f;
  // 对照：没被嘲讽时灯能打我方的人和狂徒
  assert.deepEqual(cand(tou, "tou_aa"), ids([kolt, helu, thug]), "没被嘲讽：我方两人和狂徒都能选");
  // 柯尔特（我方）嘲讽灯（乙）：真的放一次坦克职责的嘲讽（灯的嘲讽技能由柯尔特这边用不了，这里用通用的标记，和规则里各种嘲讽同一个字段）
  tou.tauntTo = kolt.id;
  assert.equal(c.playerTauntTarget(tou), kolt, "灯被柯尔特嘲讽");
  assert.equal(c.playerTauntTarget(hiaki), null, "绯秋没被嘲讽");
  // 本机名单：只剩柯尔特（狂徒、赫鲁米卡都不能选）
  assert.deepEqual(cand(tou, "tou_aa"), [kolt.id], "普攻的名单只有嘲讽者");
  // 出手前的校验：扣点之前拦下，原因写明
  assert.match(c.skillTargetError(tou, "tou_aa", helu) || "", /灯 被 柯尔特 嘲讽：只能攻击 柯尔特/);
  assert.match(c.skillTargetError(tou, "tou_aa", thug) || "", /嘲讽/, "敌人（非玩家单位）也不能打");
  assert.equal(c.skillTargetError(tou, "tou_aa", kolt), null, "打嘲讽者照常");
  // 联机 / 热座出手前的校验
  const near = { rangeMode: "near" };   // 灯有圣盾：普攻先选打同区还是花圣盾打距离 1，再选同区的目标（分步里选的也只剩嘲讽者）
  assert.deepEqual(plain(c.skillFlowSteps("tou_aa", tou, near).find(st => st.key === "target").units.map(u => u.id)), [kolt.id], "普攻分步里的目标只剩柯尔特");
  assert.throws(() => validate(tou, "tou_aa", helu, { rangeMode: "near", target: helu.id }), /嘲讽|不合法的分步选择/);
  assert.throws(() => validate(tou, "tou_aa", thug, { rangeMode: "near", target: thug.id }), /嘲讽|不合法的分步选择/);
  assert.doesNotThrow(() => validate(tou, "tou_aa", kolt, { rangeMode: "near", target: kolt.id }));
  // 分步名单：声波切割的两个目标都只剩嘲讽者（同区那一步有柯尔特；距离 1 那一步没有能选的）
  const steps = c.skillFlowSteps("tou_sonic", tou, {});
  steps.filter(st => st.type === "unit").forEach(st => assert.ok(st.units.every(u => u.id === kolt.id), st.label + "：只剩嘲讽者"));
  // 直接发指令打别人：不扣行动点、打不到
  const ap = tou.ap, hp = c.totalHp(helu);
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_aa", target: helu.id, picks: near });
  assert.equal(tou.ap, ap, "扣点之前就拦下");
  assert.equal(c.totalHp(helu), hp, "赫鲁米卡没挨打");
  // 给自己人用的技能不管嘲讽（给友方的名单照旧是乙的人）
  const ally = c.GAME.gameSkills(tou).find(s => c.skillSideOf(tou, s.id) === "ally" || c.skillSideOf(tou, s.id) === "allySelf");
  if (ally) assert.doesNotMatch(c.skillTargetError(tou, ally.id, hiaki) || "", /嘲讽/, "给友方用的技能（" + ally.id + "）不受嘲讽限制");
  // 打了嘲讽者：这次嘲讽用掉了（「下次攻击必须打你」），之后照常选目标
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_aa", target: kolt.id, picks: near });
  while (S.blockQueue && S.blockQueue.length) c.finishBlock(null);   // 柯尔特的队友不帮忙挡
  assert.ok(tou.ap < ap, "真的出手了");
  assert.equal(tou.tauntTo, null, "灯打了柯尔特：嘲讽用掉");
  assert.ok(cand(tou, "tou_aa").includes(thug.id), "之后照常选目标");
});

test("嘲讽对玩家：武器人一起被嘲讽（年糕跟着灯）；对嘲讽者出过一次手（灯或者年糕都算）嘲讽就用掉，之后照常选目标", () => {
  const f = field({ summon: true });
  const { c, kolt, helu, tou, mochi, thug, cand, validate } = f;
  assert.ok(mochi && !mochi.hidden, "年糕在场");
  tou.tauntTo = kolt.id;
  assert.equal(c.playerTauntTarget(mochi), kolt, "年糕跟着灯一起被嘲讽");
  assert.deepEqual(cand(mochi, "mochi_roar"), [kolt.id], "年糕的吼叫也只能选柯尔特");
  assert.match(c.skillTargetError(mochi, "mochi_roar", thug) || "", /年糕 被 柯尔特 嘲讽/);
  assert.throws(() => validate(mochi, "mochi_roar", helu), /嘲讽/);
  // 年糕吼了柯尔特：这次嘲讽用掉了，灯也解开
  const ap = mochi.ap;
  c.Commands.dispatch({ type: "skill", actor: mochi.id, skill: "mochi_roar", target: kolt.id, picks: {} });
  while (c.S.state.blockQueue && c.S.state.blockQueue.length) c.finishBlock(null);   // 柯尔特的队友不帮忙挡
  assert.ok(mochi.ap < ap, "真的出手了");
  assert.equal(tou.tauntTo, null, "武器人和持有者共用一次嘲讽：年糕吼了柯尔特就用掉了");
  assert.equal(c.playerTauntTarget(tou), null);
  assert.equal(c.playerTauntTarget(mochi), null);
  assert.ok(cand(mochi, "mochi_roar").includes(thug.id), "之后照常选目标");
});

test("嘲讽对玩家：真的放一次嘲讽（灯的「嘲讽」对敌对阵营的柯尔特）——柯尔特的普攻、对敌人用的道具都只能对灯；联机的动作菜单也只列灯", () => {
  const f = field();
  const { c, S, kolt, helu, hiaki, tou, thug, cand } = f;
  c.Commands.dispatch({ type: "skill", actor: tou.id, skill: "tou_taunt", target: kolt.id, picks: { target: kolt.id } });
  assert.equal(kolt.tauntTo, tou.id, "柯尔特被灯嘲讽");
  assert.equal(c.playerTauntTarget(kolt), tou);
  assert.deepEqual(cand(kolt, "kolt_aa"), [tou.id], "本机名单只有灯");
  // 对敌人用的道具（铝热弹）：只能用在灯身上
  c.bagAdd("fx_melt", 2);
  assert.match(c.itemUseError(kolt, "fx_melt", thug, null) || "", /柯尔特 被 灯 嘲讽：只能对 灯 用/);
  assert.match(c.itemUseError(kolt, "fx_melt", hiaki, null) || "", /嘲讽/);
  assert.equal(c.itemUseError(kolt, "fx_melt", tou, null), null);
  assert.deepEqual(ids(c.itemTargetUnits(kolt, "fx_melt")), [tou.id], "道具能选的也只有灯");
  // 联机：房主给玩家的动作菜单（online-actions.js）只列灯
  const menu = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect, assertAction: () => true, getState: () => S });
  const out = menu.menu({ actor: kolt.id, skill: "kolt_aa" }, "p1");
  assert.equal(out.choices.kind, "unit");
  assert.deepEqual(plain(out.choices.options.map(o => o.value)), [tou.id], "联机的名单只有灯");
  // 用道具打了灯：嘲讽用掉
  c.Commands.dispatch({ type: "useItem", actor: kolt.id, item: "fx_melt", target: tou.id });
  assert.equal(kolt.tauntTo, null, "对嘲讽者用了道具也算出过手");
  assert.ok(helu);
});

test("嘲讽对玩家：只认敌对的人——同阵营队友开着友伤嘲讽的不算；只有一个玩家阵营时一切照旧（玩家身上挂着嘲讽也不限制选目标）；嘲讽者倒地 / 躲起来时不起作用", () => {
  const off = field({ split: false });
  const before = off.cand(off.tou, "tou_aa");
  off.tou.tauntTo = off.kolt.id;   // 同阵营：柯尔特开着友伤打到队友时「过度自信」会挂上这个
  assert.equal(off.c.playerTauntTarget(off.tou), null, "只有一个阵营：不限制");
  assert.deepEqual(off.cand(off.tou, "tou_aa"), before, "名单和没挂嘲讽时一样");
  assert.ok(before.includes(off.thug.id), "照旧能打狂徒");
  assert.equal(off.c.skillTargetError(off.tou, "tou_aa", off.thug), null);
  const f = field();
  const { c, kolt, helu, hiaki, tou, cand } = f;
  helu.tauntTo = kolt.id;   // 同是「我方」
  assert.equal(c.playerTauntTarget(helu), null, "同阵营的队友嘲讽不算");
  tou.tauntTo = kolt.id;
  kolt.dying = true; kolt.upOnShp = false;
  assert.equal(c.playerTauntTarget(tou), null, "嘲讽者倒地：不起作用");
  kolt.dying = false; kolt.statuses.hide = true;
  assert.equal(c.playerTauntTarget(tou), null, "嘲讽者躲起来选不中：不起作用");
  kolt.statuses.hide = false;
  // 两个阵营设成友好以后：打不到它了，嘲讽也不起作用
  c.Commands.dispatch({ type: "battle.playerFaction", faction: "乙", other: "我方", hostile: false });
  assert.equal(c.playerTauntTarget(tou), null, "互相友好：不起作用");
  assert.ok(cand(tou, "tou_aa").length >= 0 && hiaki);
});

test("嘲讽对玩家：自动对打的玩家打法也认嘲讽（被嘲讽时只打嘲讽者）", () => {
  const f = field();
  const { c, kolt, helu, tou } = f;
  tou.tauntTo = kolt.id;
  const thunk = c.BattleSim.BASIC_POLICY.act(tou);
  assert.ok(thunk, "有能做的");
  const hp = c.totalHp(helu);
  thunk();
  while (c.S.state.blockQueue && c.S.state.blockQueue.length) c.finishBlock(null);
  assert.equal(c.totalHp(helu), hp, "没去打血少的赫鲁米卡");
  assert.equal(tou.tauntTo, null, "打了柯尔特，嘲讽用掉");
});
