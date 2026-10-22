// 下水道狂鼠的通用机制（docs/ratfolk.md 第 2 节，issue #268）：
//   出血（通用攻击效果，engine.js · BLEED / resolveAttack）、狂暴（自我效果，effects.js · FRENZY / enterFrenzy）、阵营被动「狂潮」（effects.js · frenzyTide）
// 兵种还没登记：测试里把现有敌人临时设成「狂鼠」阵营、给攻击打开出血开关
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

/** 一场摆好的战斗：默认柯尔特 + Helumica 对两个狂徒（匕首），已开战，全员在 1 区 */
function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({
    party: opt.party || ["kolt", "helu"],
    enemies: opt.enemies || [{ id: "thug_knife", lv: opt.lv || 1, zone: 1 }, { id: "thug_knife", lv: opt.lv || 1, zone: 1 }],
    seed: opt.seed || "RATFOLK"
  });
  c.startCombat();
  const st = c.S.state;
  st.units.forEach(u => { if (!u.hidden) u.zone = 1; });
  const [foe, foe2] = st.units.filter(u => !u.isPlayer);
  return { c, st, foe, foe2, kit: k => c.findKit(k, st.units) };
}
/** 一下攻击：默认 ATK 10 × 1 物理、0 击破、不等格挡 */
const hit = (c, a, t, extra) => c.dealTo(a, t, Object.assign({ atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, extra || {}));
const layers = (u, ls) => { u.layers = ls.map((l, i) => ({ type: l[0], current: l[1], max: l[2] != null ? l[2] : l[1], inner: i === ls.length - 1 })); };
const cur = (u, type) => u.layers.find(l => l.type === type).current;
const logText = c => (c.S.state.logPages || []).map(p => (p.lines || []).map(l => l.text).join("\n")).join("\n");
const cfg = (c, name) => vm.runInContext(name, c);
const plain = x => JSON.parse(JSON.stringify(x));   // 规则环境里造的数组 / 对象换成这边的，deepEqual 才比得了
const noBlock = { pickBlocker: () => null, pickAssister: l => l[0].id };

/* ================= 出血 ================= */

test("出血：打中肉体并造成伤害 → 同一层再扣「这一层上限 × 10%」的真实伤害（向下取整），日志单独写一行；没开开关不出血", () => {
  const { c, foe, kit } = field();
  const B = cfg(c, "BLEED");
  assert.equal(B.pct, 0.1, "10% 在配置表里");
  assert.equal(B.decay, 0.5, "减半在配置表里");
  layers(foe, [["flesh", 205]]);
  const out = hit(c, kit("kolt"), foe, { bleed: true });
  assert.equal(out.res.bleed, 20, "205 × 10% = 20.5，向下取整");
  assert.equal(cur(foe, "flesh"), 205 - 10 - 20);
  assert.equal(out.res.total, 30, "实际扣掉的血含出血");
  assert.ok(out.extra.includes("出血 20（真实伤害）"), "日志单独一行");
  // 写进行动日志：这一击本身的伤害一行，出血另起一行
  const lines = [];
  c.hitOne2(kit("kolt"), foe, { atk: 10, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", bleed: true, flags: { action: true, blockResolved: true, block: "none" } }, lines);
  assert.ok(lines.some(s => /→ 狂徒（匕首）：10 伤害/.test(s)), lines.join("\n"));
  assert.ok(lines.some(s => s.trim() === "出血 20（真实伤害）"), lines.join("\n"));
  // 不开开关：照旧
  layers(foe, [["flesh", 205]]);
  const plain = hit(c, kit("kolt"), foe);
  assert.equal(plain.res.bleed || 0, 0);
  assert.equal(cur(foe, "flesh"), 195);
});

test("出血：真实伤害不吃克制、减伤、护盾、狂暴减伤等任何修正", () => {
  const { c, foe, kit } = field();
  layers(foe, [["flesh", 200]]);
  c.enterFrenzy(foe, []);                     // 狂暴：受伤 −25%
  foe.resources.gritTurn = true;              // 减伤 50%
  foe.flying = true;                          // 飞行：攻击伤害减半
  c.S.state.weather = "heat";                 // 酷暑：火 +25%
  const out = hit(c, kit("kolt"), foe, { element: "fire", bleed: true });   // 火打肉体 +50%
  assert.equal(out.res.bleed, 20, "出血照样是上限 200 的 10%");
  assert.equal(200 - cur(foe, "flesh"), out.res.total);
  assert.ok(out.res.total - out.res.bleed < 20, "这一击本身吃了一堆修正");
  // 护盾挡不住：穿刺打到里面的肉体，出血只扣肉体，护盾原样
  const f2 = field();
  layers(f2.foe, [["shield", 50], ["flesh", 100]]);
  const o2 = hit(f2.c, f2.kit("kolt"), f2.foe, { bleed: true, flags: { action: true, blockResolved: true, block: "none", pierce: true } });
  assert.equal(o2.res.bleed, 10);
  assert.equal(cur(f2.foe, "shield"), 50);
  assert.equal(cur(f2.foe, "flesh"), 100 - 10 - 10);
});

test("出血：最少 1 点；只打那一层，打空了也不溢出到下一层", () => {
  const { c, foe, kit } = field();
  layers(foe, [["flesh", 5]]);
  const small = hit(c, kit("kolt"), foe, { atk: 2, bleed: true });
  assert.equal(small.res.bleed, 1, "5 × 10% 取整是 0，最少 1");
  assert.equal(cur(foe, "flesh"), 2);
  // 肉体在外、星灵在里：出血把肉体打空，多出来的不打星灵
  layers(foe, [["flesh", 15, 100], ["spirit", 50]]);
  const capped = hit(c, kit("kolt"), foe, { bleed: true });
  assert.equal(capped.res.bleed, 5, "这一层只剩 5");
  assert.equal(cur(foe, "flesh"), 0);
  assert.equal(cur(foe, "spirit"), 50, "不溢出");
  // 这一击自己就把肉体打穿了：出血没有血可扣，也不打下一层
  layers(foe, [["flesh", 8, 100], ["spirit", 50]]);
  const over = hit(c, kit("kolt"), foe, { bleed: true });
  assert.equal(over.res.bleed, 0);
  assert.equal(cur(foe, "spirit"), 48, "只有这一击自己的溢出");
  assert.ok(!over.extra.some(s => /^出血/.test(s)), "没扣到血就不写出血");
});

test("出血：只在打中肉体 / 星灵层、并对它造成伤害时触发", () => {
  const { c, foe, kit } = field();
  const k = kit("kolt");
  // 星灵：照样出血，打的是星灵这一层
  layers(foe, [["spirit", 100]]);
  assert.equal(hit(c, k, foe, { bleed: true }).res.bleed, 10);
  assert.equal(cur(foe, "spirit"), 80);
  // 装甲 / 护盾 / 沙尘：不出血
  for (const type of ["armor", "shield", "sand"]) {
    layers(foe, [[type, 50], ["flesh", 100]]);
    const out = hit(c, k, foe, { element: "ice", bleed: true });
    assert.equal(out.res.bleed || 0, 0, type);
    assert.equal(cur(foe, "flesh"), 100, type);
  }
  // 打中的是装甲、溢出进肉体：打中的那一层不是肉体，不出血
  layers(foe, [["armor", 5], ["flesh", 100]]);
  const spill = hit(c, k, foe, { element: "ice", bleed: true });
  assert.equal(spill.res.bleed || 0, 0);
  assert.equal(cur(foe, "flesh"), 95);
  // 没造成伤害：0 伤、屹立不倒（免疫）都不出血
  layers(foe, [["flesh", 100]]);
  assert.equal(hit(c, k, foe, { atk: 0, bleed: true }).res.bleed || 0, 0);
  foe.resources.standTurn = true;
  assert.equal(hit(c, k, foe, { bleed: true }).res.bleed || 0, 0);
  assert.equal(cur(foe, "flesh"), 100);
});

test("出血：同一次攻击多次触发时每次减半（10% → 5% → 2.5%），下一次攻击重新从 10% 算", () => {
  const { c, foe, kit } = field();
  layers(foe, [["flesh", 1000]]);
  const out = hit(c, kit("kolt"), foe, { hits: 3, bleed: true });
  assert.deepEqual(plain(out.res.perHit.map(h => h.bleed)), [100, 50, 25]);
  assert.equal(out.res.bleed, 175);
  assert.equal(cur(foe, "flesh"), 1000 - 30 - 175);
  assert.ok(out.extra.includes("出血 100 + 50 + 25 = 175（真实伤害）"), out.extra.join("\n"));
  const again = hit(c, kit("kolt"), foe, { bleed: true });
  assert.equal(again.res.bleed, 100, "新的一次攻击");
});

test("出血：敌人打我方、等协助格挡的一击落下时照样出血", () => {
  const { c, foe, kit } = field();
  const helu = kit("helu");
  layers(helu, [["flesh", 1000]]);
  const out = c.dealTo(foe, helu, { atk: 10, mult: 1, element: "physical", baseBreak: 0, bleed: true, flags: { action: true } });
  assert.ok(out.pending, "柯尔特同区能协助格挡：这一击先进格挡队列");
  c.BattleSim.resolveQueues(noBlock);
  assert.ok(1000 - cur(helu, "flesh") > 100, "这一击 + 出血 100");
  assert.match(logText(c), /出血 100（真实伤害）/);
});

test("出血：坚毅生命照常——起身靠坚毅生命战斗时打的是坚毅生命、不出血；出血把肉体打空照常倒地", () => {
  const { c, foe, kit } = field();
  const helu = kit("helu");
  layers(helu, [["flesh", 0, 100]]);
  helu.upOnShp = true; helu.dying = false; helu.shp = 50; helu.shpMax = 50;
  const onShp = hit(c, foe, helu, { bleed: true });
  assert.ok(onShp.res.shpDealt > 0);
  assert.equal(onShp.res.bleed || 0, 0);
  assert.ok(!onShp.extra.some(s => /^出血/.test(s)));
  // 肉体只剩一点：出血把它打空，和别的伤害一样倒地
  helu.upOnShp = false; helu.shp = 50;
  layers(helu, [["flesh", 12, 100]]);
  const down = hit(c, foe, helu, { bleed: true });
  assert.ok(down.res.bleed > 0);
  assert.equal(cur(helu, "flesh"), 0);
  assert.equal(helu.dying, true);
});

/* ================= 狂暴 ================= */

test("狂暴：进入后 ATK + 等级、状态栏写「狂暴」；已经狂暴的不重复进入；数值在配置表里", () => {
  const { c, st, foe } = field({ lv: 10 });
  const F = cfg(c, "FRENZY");
  assert.deepEqual([F.atkPerLevel, F.breakBonus, F.takenCut, F.freeMoves, F.postureCut], [1, 1, 0.25, 1, 2]);
  const atk0 = c.effectiveAtk(foe, st.units);
  const notes = [];
  assert.equal(c.enterFrenzy(foe, notes, "测试"), true);
  assert.equal(foe.self, "frenzy");
  assert.equal(c.effectiveAtk(foe, st.units), atk0 + 10, "10 级：ATK +10");
  assert.match(c.statusLine(foe), /狂暴/);
  assert.ok(notes.some(s => /进入狂暴（测试）/.test(s)), notes.join("\n"));
  const cap = foe.defMax;
  assert.equal(c.enterFrenzy(foe, []), false, "已经狂暴");
  assert.equal(foe.defMax, cap, "不重复扣架势上限");
});

test("狂暴：造成的击破 +1，每一次攻击、多段攻击的每一段各 +1", () => {
  const { c, foe, foe2 } = field();
  layers(foe2, [["flesh", 1000]]);
  foe2.def = foe2.defMax = 50;
  assert.equal(hit(c, foe, foe2, { baseBreak: 1 }).res.breakDealt, 1, "平时 1");
  c.enterFrenzy(foe, []);
  assert.equal(hit(c, foe, foe2, { baseBreak: 1 }).res.breakDealt, 2);
  assert.equal(hit(c, foe, foe2, { baseBreak: 1, hits: 3 }).res.breakDealt, 6, "三段各 +1");
  assert.equal(hit(c, foe, foe2, { baseBreak: 0 }).res.breakDealt, 1, "本来不击破的攻击也 +1（和千钧一样）");
});

test("狂暴：受到的所有伤害 −25%（攻击、状态伤害都算），和其他百分比加算", () => {
  const { c, foe, kit } = field();
  const k = kit("kolt");
  layers(foe, [["flesh", 1000]]);
  assert.equal(hit(c, k, foe, { atk: 100 }).res.total, 100);
  c.enterFrenzy(foe, []);
  assert.equal(hit(c, k, foe, { atk: 100 }).res.total, 75);
  foe.resources.gritTurn = true;   // 减伤 50%：加算 1 − 0.5 − 0.25 = 25%，不是连乘的 37.5%
  assert.equal(hit(c, k, foe, { atk: 100 }).res.total, 25);
  foe.resources.gritTurn = false;
  const before = cur(foe, "flesh");
  c.applyTypedDot(foe, 100, "acid", [], "测试腐蚀");
  assert.equal(before - cur(foe, "flesh"), 75, "状态伤害也 −25%");
  // 克制表的挨打视角也写上
  const row = c.matchupDefenderRow(foe, "physical", "none", 1, {});
  assert.ok(row.some(e => e.value === -0.25 && /狂暴/.test(e.reason)), JSON.stringify(row));
});

test("狂暴：架势上限 −2（进入时扣、解除时还），和震荡叠加；谁先谁后都一样，上限最少留 1", () => {
  const { c, foe, foe2 } = field();
  foe.def = foe.defMax = 6;
  c.enterFrenzy(foe, []);
  assert.equal(foe.defMax, 4); assert.equal(foe.def, 4);
  foe.statuses.shockwave = true; c.popStatus(foe, "shockwave");
  assert.equal(foe.defMax, 2, "震荡再 −2"); assert.equal(foe.def, 2);
  foe.statuses.shockwave = false; c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 4, "震荡解除：只还震荡扣的");
  foe.statuses.shockwave = true; c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 2);
  c.dealBreak(foe, foe.def, "physical", []);   // 打进失衡 → 狂暴结束
  assert.equal(foe.self, "none");
  assert.equal(foe.defMax, 4, "狂暴结束：只还狂暴扣的，震荡照扣");
  foe.statuses.shockwave = false; c.syncShockwave(foe, []);
  assert.equal(foe.defMax, 6, "都解除：回到原来的上限");
  // 上限只有 3：先震荡（→ 1），再狂暴（被「最少留 1」挡住）；震荡解除后狂暴扣满
  foe2.def = foe2.defMax = 3;
  foe2.statuses.shockwave = true; c.syncShockwave(foe2, []);
  assert.equal(foe2.defMax, 1);
  c.enterFrenzy(foe2, []);
  assert.equal(foe2.defMax, 1, "最少留 1");
  foe2.statuses.shockwave = false; c.syncShockwave(foe2, []);
  assert.equal(foe2.defMax, 1, "震荡还回去 2，狂暴补扣 2");
  c.applyNeutralize(foe2);
  assert.equal(foe2.defMax, 3);
  // 反过来：先狂暴、再震荡，狂暴随晕眩结束后震荡扣满
  const f3 = field();
  f3.foe.def = f3.foe.defMax = 3;
  f3.c.enterFrenzy(f3.foe, []);
  f3.foe.statuses.shockwave = true; f3.c.syncShockwave(f3.foe, []);
  assert.equal(f3.foe.defMax, 1);
  f3.c.dealBreak(f3.foe, 1, "physical", []);
  assert.equal(f3.foe.self, "none");
  assert.equal(f3.foe.defMax, 1, "狂暴还回去 2，震荡补扣 2");
});

test("狂暴：晕眩后解除（照其他自我效果）、架势上限还原；中和也能清掉", () => {
  const { c, foe, foe2, kit } = field();
  layers(foe, [["flesh", 500]]);
  foe.def = foe.defMax = 5;
  c.enterFrenzy(foe, []);
  const notes = [];
  c.dealBreak(foe, foe.def, "physical", notes);
  assert.equal(foe.stunned, true);
  assert.equal(foe.self, "none");
  assert.equal(foe.defMax, 5);
  assert.ok(notes.some(s => /晕眩，狂暴结束/.test(s)), notes.join("\n"));
  // 攻击打进失衡也一样
  layers(foe2, [["flesh", 500]]);
  foe2.def = foe2.defMax = 5;
  c.enterFrenzy(foe2, []);
  hit(c, kit("kolt"), foe2, { baseBreak: foe2.def });
  assert.equal(foe2.stunned, true);
  assert.equal(foe2.self, "none");
  assert.equal(foe2.defMax, 5);
  // 中和
  const f2 = field();
  f2.foe.def = f2.foe.defMax = 5;
  f2.c.enterFrenzy(f2.foe, []);
  const n2 = f2.c.applyNeutralize(f2.foe);
  assert.equal(f2.foe.self, "none");
  assert.equal(f2.foe.defMax, 5);
  assert.ok(n2.some(s => /狂暴」被中和清除/.test(s)), n2.join("\n"));
});

test("狂暴：10 级起的精英要攒满晕眩标记、真正晕眩才解除（直接击破、攻击打进失衡都一样）", () => {
  const { c, foe, kit } = field({ enemies: [{ id: "captain_wolf", lv: 10, zone: 1 }] });
  const wolf = foe;
  assert.equal(c.isBossUnit(wolf), true);
  layers(wolf, [["flesh", 999]]);
  c.enterFrenzy(wolf, []);
  const cap = wolf.defMax;
  // 第一次失衡（直接击破）：记 1 个标记，架势马上恢复，狂暴还在
  c.dealBreak(wolf, wolf.def, "physical", []);
  assert.equal(wolf.stunMarks, 1);
  assert.equal(wolf.stunned, false);
  assert.equal(wolf.self, "frenzy");
  assert.equal(wolf.defMax, cap);
  assert.equal(wolf.def, cap, "恢复到狂暴后的上限");
  // 第二次（攻击打进失衡）：标记攒满、真正晕眩 → 狂暴解除，上限还原
  hit(c, kit("kolt"), wolf, { baseBreak: wolf.def });
  assert.equal(wolf.stunMarks, 2);
  assert.equal(wolf.stunned, true);
  assert.equal(wolf.self, "none");
  assert.equal(wolf.defMax, cap + 2);
  // 其他自我效果走同一个函数：标记没攒满的直接击破也不结束（以前在第一个标记就结束了）
  const f2 = field({ enemies: [{ id: "captain_wolf", lv: 10, zone: 1 }] });
  f2.foe.self = "store";
  f2.c.dealBreak(f2.foe, f2.foe.def, "physical", []);
  assert.equal(f2.foe.stunMarks, 1);
  assert.equal(f2.foe.self, "store");
});

test("失衡 / 晕眩中不能进入狂暴（任何来源都一样）；恢复以后可以再进", () => {
  const { c, foe } = field();
  foe.def = 0; foe.stunned = true;
  const notes = [];
  assert.equal(c.enterFrenzy(foe, notes, "协助"), false);
  assert.equal(foe.self, "none");
  assert.ok(notes.some(s => /失衡中，不能进入狂暴/.test(s)));
  c.recoverFromStun(foe, []);
  assert.equal(c.enterFrenzy(foe, []), true);
  assert.equal(foe.self, "frenzy");
});

test("狂暴：每回合可以免费移动一次（不花附赠 / 行动点），下回合又有；我方移动按钮也写不耗", () => {
  const { c, foe } = field();
  foe.zone = 2;
  c.endPlayerTurn();   // 敌人回合：杂兵 1 行动点
  c.enterFrenzy(foe, []);
  const ap = foe.ap;
  assert.ok(ap >= 1);
  c.doMove(foe, 1);
  assert.equal(foe.zone, 1); assert.equal(foe.ap, ap, "免费");
  assert.match(logText(c), /狂暴：这回合的免费移动/);
  c.doMove(foe, 2);
  assert.equal(foe.zone, 2); assert.equal(foe.ap, ap - 1, "这回合的免费移动用完了，杂兵照常花行动点");
  c.endEnemyTurn(); c.endPlayerTurn();
  const ap2 = foe.ap;
  c.doMove(foe, 1);
  assert.equal(foe.zone, 1); assert.equal(foe.ap, ap2, "下一回合又有一次");
  // 精英：免费移动不花附赠
  const f2 = field({ enemies: [{ id: "captain_wolf", lv: 1, zone: 2 }] });
  f2.foe.zone = 2;
  f2.c.endPlayerTurn();
  f2.c.enterFrenzy(f2.foe, []);
  const bonus = f2.foe.bonus;
  f2.c.doMove(f2.foe, 1);
  assert.equal(f2.foe.zone, 1); assert.equal(f2.foe.bonus, bonus);
  // 我方（自我效果谁都能有）：移动按钮的消耗写「不耗」，移动不花附赠
  const f3 = field();
  const k3 = f3.kit("kolt");
  assert.deepEqual(plain(f3.c.moveBaseCost(k3)), { bonus: 1 });
  f3.c.enterFrenzy(k3, []);
  assert.deepEqual(plain(f3.c.moveBaseCost(k3)), {});
  const b3 = k3.bonus;
  f3.c.doMove(k3, 2);
  assert.equal(k3.zone, 2); assert.equal(k3.bonus, b3);
  assert.deepEqual(plain(f3.c.moveBaseCost(k3)), { bonus: 1 }, "这回合用过了");
});

test("狂暴的免费移动：敌人 AI 用得上——够不着的杂兵先免费走过去，再用行动点出手", () => {
  const run = (frenzy) => {
    const { c, st, foe } = field({ enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
    foe.zone = 2;
    c.endPlayerTurn();
    if (frenzy) c.enterFrenzy(foe, []);
    const hp = () => st.units.filter(u => u.isPlayer && !u.hidden).reduce((s, u) => s + c.totalHp(u), 0);
    const hp0 = hp();
    for (let n = 0; n < 5; n++) {
      if (!foe || foe.dead || foe.stunned || (foe.ap || 0) <= 0) break;
      const plan = c.EnemyAI.plan(foe);
      if (!plan) break;
      const sig = `${foe.ap}|${foe.bonus}|${foe.zone}`;
      plan.thunk();
      c.BattleSim.resolveQueues(noBlock);
      if (`${foe.ap}|${foe.bonus}|${foe.zone}` === sig) break;
    }
    return { zone: foe.zone, hurt: hp0 - hp() };
  };
  const calm = run(false), mad = run(true);
  assert.equal(calm.zone, 1);
  assert.equal(calm.hurt, 0, "平时：杂兵走过去就没有行动点了");
  assert.equal(mad.zone, 1);
  assert.ok(mad.hurt > 0, "狂暴：免费走过去，再出手");
});

test("狂暴的免费移动：主持人手动操作敌人也认（gm.enemyAct 的移动不花行动点）", () => {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "gm-commands.js"), "utf8"), c, { filename: "gm-commands.js" });
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "RATFOLK-GM" });
  const authority = Object.freeze({});
  c.GMCommands.configure({ requireHost: ctx => ctx === authority });
  const send = cmd => c.Commands.dispatch(JSON.parse(JSON.stringify(cmd)), authority);
  const s = c.S.state, enemy = s.units.find(u => !u.isPlayer);
  c.startCombat(); c.endPlayerTurn(); c.GMCommands.beginEnemyRound(s.turnNo);
  send({ type: "gm.setManual", actors: "all", enabled: true });
  c.enterFrenzy(enemy, []);
  enemy.ap = 0;
  send({ type: "gm.enemyAct", actor: enemy.id, action: "move", dest: 1 });
  assert.equal(enemy.zone, 1);
  assert.throws(() => send({ type: "gm.enemyAct", actor: enemy.id, action: "move", dest: 2 }), /预算不足/, "这回合的免费移动用完了");
});

/* ================= 阵营被动：狂潮 ================= */

/** n 个狂徒（匕首）临时设成狂鼠阵营（兵种还没登记），在 2 区；extra：再加的敌人（不是狂鼠） */
function rats(n, extra) {
  const f = field({ enemies: Array.from({ length: n }, () => ({ id: "thug_knife", lv: 1, zone: 2 })).concat(extra || []) });
  assert.equal(cfg(f.c, "RATFOLK_FACTION"), "狂鼠");
  f.c.enemyInfo("thug_knife").faction = cfg(f.c, "RATFOLK_FACTION");
  f.st.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 2; });
  f.rats = f.st.units.filter(u => u.kit === "thug_knife");
  return f;
}

test("狂潮：敌人回合开始时，存活的狂鼠里狂暴的刚好一半 → 所有狂鼠进入狂暴", () => {
  const { c, rats: r } = rats(4, [{ id: "guard_sword", lv: 1, zone: 2 }]);
  c.enterFrenzy(r[0], []); c.enterFrenzy(r[1], []);
  c.endPlayerTurn();
  assert.ok(r.every(u => u.self === "frenzy"), r.map(u => u.self).join());
  assert.match(logText(c), /狂潮：存活的狂鼠 4 只，狂暴的 2 只/);
  const guard = c.S.state.units.find(u => u.kit === "guard_sword");
  assert.equal(guard.self, "none", "不是狂鼠的不算、也不会被拉进去");
});

test("狂潮：不到一半不触发", () => {
  const { c, rats: r } = rats(3);
  c.enterFrenzy(r[0], []);
  c.endPlayerTurn();
  assert.deepEqual(plain(r.map(u => u.self)), ["frenzy", "none", "none"], "1 / 3 不到一半");
  assert.doesNotMatch(logText(c), /狂潮/);
  // 死掉的不算存活：3 只死 1 只，1 / 2 刚好一半
  const f2 = rats(3);
  f2.c.enterFrenzy(f2.rats[0], []);
  f2.rats[2].dead = true;
  f2.c.endPlayerTurn();
  assert.equal(f2.rats[1].self, "frenzy");
});

test("狂潮：失衡 / 晕眩中的不被拉进狂暴，但照样算进存活数量", () => {
  const { c, rats: r } = rats(4);
  c.enterFrenzy(r[0], []); c.enterFrenzy(r[1], []);
  r[2].def = 0; r[2].stunned = true;
  c.endPlayerTurn();
  assert.equal(r[3].self, "frenzy");
  assert.equal(r[2].self, "none", "失衡中的不进入（敌人回合开始后才恢复）");
  assert.equal(r[2].stunned, false, "照常恢复");
  assert.match(logText(c), /失衡中的 1 只除外/);
  // 失衡的照样算存活：3 只里 1 只狂暴、1 只失衡 → 1 / 3 不到一半（只数没失衡的就是 1 / 2 了）
  const f2 = rats(3);
  f2.c.enterFrenzy(f2.rats[0], []);
  f2.rats[1].def = 0; f2.rats[1].stunned = true;
  f2.c.endPlayerTurn();
  assert.equal(f2.rats[2].self, "none");
});

/* ================= 显示 ================= */

test("显示：状态栏、徽章、悬停写出狂暴的效果；联机照常下发（不含坚毅数值）", () => {
  const c = H.load();
  for (const f of ["hud-icons.js", "unit-tip.js", "online-view.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f });
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 10, zone: 2 }], seed: "RATFOLK-UI" });
  c.startCombat();
  const st = c.S.state, foe = st.units.find(u => !u.isPlayer);
  st.units.filter(u => u.isPlayer).forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  c.enterFrenzy(foe, []);
  assert.match(c.statusLine(foe), /狂暴/);
  // 徽章（自我效果的菱形）：提示写出这名单位的效果
  const badge = c.HudIcons.unitBadges(foe).find(b => b.key === "frenzy");
  assert.ok(badge);
  assert.match(badge.title, /ATK \+10/);
  assert.match(badge.title, /架势上限 −2/);
  assert.match(c.HudIcons.badge("frenzy", "", badge.title), /<svg/);
  assert.equal(c.HudIcons.keyOf("狂暴"), "frenzy");
  assert.ok(c.HudIcons.covered("狂暴"));
  // 悬停说明
  const tip = c.UnitTip.effect("狂暴").text;
  for (const re of [/ATK \+ 等级/, /击破 \+1/, /−25%/, /免费移动/, /架势上限 −2/, /晕眩后解除/]) assert.match(tip, re);
  assert.match(c.UnitTip.html({ kind: "enemy", kit: foe.kit }, ["狂暴"], { name: foe.name }), /免费移动/);
  // 联机：自我效果、状态行、弹字照常下发，坚毅数值不发
  const out = c.OnlineView.projectUnit(foe);
  assert.equal(out.self, "frenzy");
  assert.match(out.display.status, /狂暴/);
  const tape = c.OnlineView.projectTape([{ type: "pop", unitId: foe.id, kind: "status", text: "狂暴" }], { state: st });
  assert.equal(tape[0].text, "狂暴");
  assert.doesNotMatch(JSON.stringify(c.OnlineView.projectState(st)), /732911|827319/);
});
