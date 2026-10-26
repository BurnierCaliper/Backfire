// 柯尔特「废物利用」改成累积废料（PR #376，作者 10/26 定）：敌人血量层被摧毁时按种类累积到柯尔特身上（resources.scrapStore），
// 不再只留最近的一层；废物利用一次最多领生命上限的 50%，没领完的留着下次接着领
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const sum = o => Object.values(o || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const layerOf = (u, type) => u.layers.filter(l => l.type === type).reduce((s, l) => s + l.current, 0);

/** 柯尔特（生命上限 100：一次最多领 50）和 Helumica、两个敌人都在 1 区；不算属性克制，伤害照写的数 */
function setup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }], seed: "SCRAP" });
  c.startCombat();
  const S = c.S.state;
  S.weather = "none"; S.noChart = true;
  const kolt = c.findKit("kolt", S.units), helu = c.findKit("helu", S.units);
  const foes = S.units.filter(u => !u.isPlayer);
  [kolt, helu].concat(foes).forEach(u => { u.zone = 1; });
  kolt.level = 6;
  kolt.layers = [{ type: "flesh", current: 10, max: 100, inner: true }];
  const cap = c.koltScrapCap(kolt);
  assert.equal(cap, 50, "一次最多领生命上限的一半");
  const hit = (t, n) => c.dealTo(helu, t, { atk: 0, mult: 0, flat: n, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true } });
  const use = skill => { kolt.ap = 3; return c.Commands.dispatch(plain({ type: "skill", actor: kolt.id, skill, target: null, picks: {} })); };
  const logs = () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
  return { c, S, kolt, helu, foes, cap, hit, use, logs };
}

test("敌人血量层被摧毁时按种类累积成柯尔特的废料：每一层都记，不再只留最近的一层", () => {
  const { c, kolt, foes, cap, hit, use } = setup();
  foes[0].layers = [{ type: "shield", current: 25, max: 25 }, { type: "armor", current: 40, max: 40 }, { type: "flesh", current: 500, max: 500, inner: true }];
  assert.equal(sum(kolt.resources.scrapStore), 0, "开局没有废料");
  hit(foes[0], 30);   // 打碎护盾
  assert.deepEqual(plain(kolt.resources.scrapStore), { shield: 25 }, "记的是那一层的上限");
  hit(foes[0], 60);   // 再打碎装甲：护盾那一份还在
  assert.deepEqual(plain(kolt.resources.scrapStore), { shield: 25, armor: 40 });
  assert.equal(c.koltScrapTotal(kolt), cap, "合计 65：算进合计时封顶为生命上限一半");
  // 废物利用：按记录的先后领，这一次合计领到上限；没领完的留着
  use("kolt_scrap");
  assert.equal(layerOf(kolt, "shield"), 25);
  assert.equal(layerOf(kolt, "armor"), 25);
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: 15 }, "没领完的 15 点装甲留着");
  // 之后再被摧毁的层接着累积
  foes[1].layers = [{ type: "armor", current: 20, max: 20 }, { type: "flesh", current: 500, max: 500, inner: true }];
  hit(foes[1], 25);
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: 35 });
});

test("一击打穿好几层：每一层都累积（以前只记最里面那层）", () => {
  const { kolt, foes, hit } = setup();
  foes[0].layers = [{ type: "shield", current: 10, max: 10 }, { type: "armor", current: 20, max: 20 }, { type: "flesh", current: 500, max: 500, inner: true }];
  hit(foes[0], 40);
  assert.equal(foes[0].layers.find(l => l.type === "flesh").current, 490, "护盾、装甲都打穿了");
  assert.deepEqual(plain(kolt.resources.scrapStore), { shield: 10, armor: 20 }, "从外到内都记下");
});

test("聚焦抹去的层也算被摧毁，累积成废料", () => {
  const { c, kolt, foes } = setup();
  foes[0].layers = [{ type: "armor", current: 30, max: 45 }, { type: "flesh", current: 500, max: 500, inner: true }];
  foes[0].focuses = [{ layerType: "armor" }];
  kolt.resources.scrapStore = { flesh: 5 };
  c.stripFocusLayer(foes[0], "armor", []);
  assert.deepEqual(plain(kolt.resources.scrapStore), { flesh: 5, armor: 45 }, "按那一层的上限记，接在原来的后面");
});

test("废物利用：一次最多领生命上限的一半，按记录的先后、按种类领；没领完的留着，下次接着领，领完才不能用", () => {
  const { c, kolt, cap, use, logs } = setup();
  kolt.resources.scrapStore = { armor: 30, flesh: 40 };
  use("kolt_scrap");
  assert.equal(layerOf(kolt, "armor"), 30, "先记的装甲全部领到（临时装甲层）");
  assert.equal(layerOf(kolt, "flesh"), 30, "肉体只领到上限剩下的 20：回 20 生命");
  assert.deepEqual(plain(kolt.resources.scrapStore), { flesh: 20 }, "没领完的留着");
  assert.match(logs(), new RegExp(`最多领生命上限的一半 ${cap}；还剩 20 点废料`));
  assert.equal(c.skillRequirementError(kolt, "kolt_scrap"), null, "还有废料：可以再用");
  use("kolt_scrap");
  assert.equal(layerOf(kolt, "flesh"), 50, "下次接着领剩下的");
  assert.equal(sum(kolt.resources.scrapStore), 0);
  assert.ok(c.skillRequirementError(kolt, "kolt_scrap"), "领完了：要等新的被摧毁的层");
});

test("废物利用：腐坏抛射 / 转移注意 / 拆卸模式的废料照旧一起全部领取（不受 50% 限制），上限只管累积的敌人血量层", () => {
  const { kolt, use } = setup();
  kolt.resources.scrapStore = { armor: 80 };
  kolt.resources.rotStore = { flesh: 5 };
  kolt.resources.divertArmor = 7;
  kolt.resources.stripStore = { shield: 60 };
  use("kolt_scrap");
  assert.equal(layerOf(kolt, "armor"), 50 + 7, "敌人血量层领到上限 50，转移注意的 7 另算");
  assert.equal(layerOf(kolt, "flesh"), 15, "腐坏抛射的 5 照领");
  assert.equal(layerOf(kolt, "shield"), 60, "拆卸模式的 60 不受上限");
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: 30 });
  assert.equal(sum(kolt.resources.rotStore) + Number(kolt.resources.divertArmor) + sum(kolt.resources.stripStore), 0, "其他来源领完清空");
});

test("一次能领多少读配置表 KOLT_SCRAP.capPct（不写死 0.5）", () => {
  const { c, kolt, use } = setup();
  vm.runInContext("KOLT_SCRAP.capPct = 0.2", c);
  assert.equal(c.koltScrapCap(kolt), 20);
  kolt.resources.scrapStore = { armor: 50 };
  use("kolt_scrap");
  assert.equal(layerOf(kolt, "armor"), 20);
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: 30 });
});

test("废料合计按封顶后的数算；「非法」改装（koltScrapSpend）只扣用掉的那部分，碎渣重炮（koltScrapClear）全部清空", () => {
  const { c, kolt, cap } = setup();
  kolt.resources.scrapStore = { armor: 30, flesh: 40 };
  assert.equal(c.koltScrapTotal(kolt), cap, "累积 70，算进合计时封顶为 50");
  assert.ok(c.koltScrapFull(kolt));
  assert.equal(c.koltScrapSpend(kolt, cap), cap);
  assert.deepEqual(plain(kolt.resources.scrapStore), { flesh: 20 }, "按记录的先后扣 50，剩下的留着");
  assert.equal(c.koltScrapTotal(kolt), 20);
  kolt.resources.scrapStore = { armor: cap * 3 };
  c.koltScrapClear(kolt);
  assert.equal(sum(kolt.resources.scrapStore), 0);
});

test("每场开战清空：上一场累积的废料不带到下一场", () => {
  const { c, kolt } = setup();
  kolt.resources.scrapStore = { armor: 30 };
  c.resetBattleFlags(kolt);
  assert.equal(sum(kolt.resources.scrapStore), 0);
  assert.ok(c.skillRequirementError(kolt, "kolt_scrap"), "开局没有废料：不能用");
});

test("训练场 / 输出循环：每 3 回合注入的护盾废料和实战一样累积，不再覆盖上一次", () => {
  const c = H.load();
  c.Training.setupField("kolt", 10);
  const S = c.S.state, kolt = c.findKit("kolt", S.units), sc = S.dptScrap;
  assert.ok(sc && sc.type === "shield" && sc.lost > 0);
  kolt.resources.scrapStore = {};
  S.turnNo = 3; c.Training.injectScrap(S);
  S.turnNo = 4; c.Training.injectScrap(S);   // 不是 3 的倍数：不注入
  S.turnNo = 6; c.Training.injectScrap(S);
  assert.deepEqual(plain(kolt.resources.scrapStore), { shield: sc.lost * 2 });
});

test("卡面和技能栏提示写的是累积的新规则", () => {
  const { c, kolt } = setup();
  const text = c.SkillText.skillText("kolt_scrap");
  assert.match(text, /敌人血量层被摧毁时会累积废料/);
  assert.match(text, /未领取的废料保留/);
  assert.doesNotMatch(text, /上一个被摧毁/);
  const hint = c.skillList(kolt).find(s => s.id === "kolt_scrap").hint;
  assert.match(hint, /累积的废料/);
  assert.match(hint, /没领完的留着/);
  assert.doesNotMatch(hint, /上一个被摧毁/);
});

test("联机：累积的明细不下发，玩家只看到仪表 / 资源行里封顶后的废料合计", () => {
  const { c, S, kolt, cap } = setup();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const file of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js", "hud-icons.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  kolt.resources.scrapStore = { armor: cap * 2, flesh: 7 };
  const view = plain(c.OnlineView.projectState(S, {}));
  const k = view.units.find(u => u.id === kolt.id);
  assert.equal(k.hud.scrap, cap, "仪表上的合计按封顶后的数");
  assert.match(k.display.res, new RegExp(`废料 ${cap}`));
  assert.equal(k.resources.scrapStore, undefined, "各种类的明细不下发");
  assert.doesNotMatch(JSON.stringify(view).replace(/"upOnShp":(true|false),?/g, ""), /坚毅|shp/i);
});
