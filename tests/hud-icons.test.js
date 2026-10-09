"use strict";
// 角色仪表 + 状态 / 效果图标（hud-icons.js）：单位身上挂哪些徽章、状态文字哪些已经有图标、每个角色的仪表数据和画法
const test = require("node:test");
const assert = require("node:assert/strict");
const HI = require("../hud-icons.js");

test("徽章：属性状态、通用状态、即时 / 自我效果、挂着的攻击效果都有图标，层数跟着走", () => {
  const u = { statuses: { burn: 3, shock: true, frostbite: true, shockwave: true, reso: true, unstable: true, weak: true, inspire: true, sturdy: true, hide: true, advantage: true, chase: true, corr: true },
    highEnergy: 7, instant: { melt: true, sting: true, overload: true, shift: true, spread: true, refract: true, iceNext: true },
    self: "burn", selfBurnStacks: 2, resources: { nextAtkFx: ["combust", "icebreak", "bolt", "etch", "backflow", "inertia", "diffract", "unknown"] } };
  const list = HI.unitBadges(u);
  const keys = list.map(b => b.key);
  for (const k of ["burn", "shock", "corr", "frost", "quake", "high", "reso", "unsteady", "chase", "weak", "inspire", "firm", "hide", "adv",
    "melt", "pierceIce", "overload", "shift", "diffuse", "refract", "selfBurn", "blast", "iceBreak", "strike", "etch", "backflow", "inertia", "diffract"]) {
    assert.ok(keys.includes(k), "缺少 " + k);
  }
  assert.equal(list.find(b => b.key === "burn").stack, 3);
  assert.equal(list.find(b => b.key === "high").stack, 7);
  assert.equal(list.find(b => b.key === "selfBurn").stack, 2);
  assert.equal(keys.length, new Set(keys).size, "不重复");
  assert.deepEqual(HI.unitBadges({ statuses: {} }), []);
  assert.deepEqual(HI.unitBadges(null), []);
  // 别人挂上的标记：刺入、牵挂
  assert.deepEqual(HI.unitBadges({}, ["needle", "bond", "nope"]).map(b => b.key), ["needle", "bond"]);
});

test("每个设计稿里的图标都能画出来；徽章带名字、颜色和层数", () => {
  for (const k of HI.KEYS) {
    const h = HI.badge(k, 2);
    assert.match(h, /<svg/, k);
    assert.match(h, new RegExp(`data-fx="${k}"`));
    assert.match(h, /--glow:#[0-9a-f]{6}/i);
  }
  assert.equal(HI.badge("不存在"), "");
  assert.match(HI.badge("burn", 3), /hi-stack">3</);
  assert.doesNotMatch(HI.badge("weak"), /hi-stack/);
  // 攻击效果的箭头框各用各的裁剪 id（同一屏多个不会串）
  const a = HI.badge("smash"), b = HI.badge("smash");
  assert.notEqual(a.match(/clipPath id="([^"]+)"/)[1], b.match(/clipPath id="([^"]+)"/)[1]);
  assert.match(HI.badge("burn", '"><script>'), /&quot;&gt;&lt;script&gt;/);
});

test("状态文字：有图标的词不再写字，没有图标的保留", () => {
  for (const t of ["灼烧×3", "高能 5", "感电", "自焚×2", "导体", "熔融", "刺入", "牵挂", "共振", "坚挺"]) assert.ok(HI.covered(t), t);
  for (const t of ["不稳态", "酸液炮", "聚焦护甲 火→[冰]", "掩护（灯）", "嘲讽", "冰冻+50%", "一阶段"]) assert.ok(!HI.covered(t), t);
  assert.equal(HI.keyOf("猛击"), "smash");
  assert.equal(HI.keyOf("超载"), "overload");
  assert.equal(HI.keyOf("随便"), null);
});

test("角色仪表：11 个角色都有数据和画面，读的是单位身上的资源", () => {
  const cases = {
    xia: { resources: { engine: true, fuel: 3 } },
    chuan: { resources: { charge: 9 } },
    nora: { resources: { mood: "cruel", piercedId: "e1" } },
    ruby: { resources: { nano: 15, mecha: false } },
    yuito: { resources: { bean: 2, liquid: 1, bondId: "a" } },
    hiaki: { resources: { blade: "naruto", stance: "waki", niuOut: true } },
    tou: { resources: { shield: 2, tauntLeft: 1 } },
    kolt: { resources: { bit: "acid" }, layers: [{ current: 10, max: 10 }] },
    helu: { resources: { scanned: true, lockLeft: 1 } },
    ras: { resources: { energyPct: 120, light: 12 } },
    longge: { resources: { ammo: ["red", "blue", "blue"], seen: [true, false, true], trigger: true, spitUsed: true } }
  };
  const units = [{ id: "a", name: "灯", isPlayer: true }, { id: "e1", name: "狂徒", focuses: [{ seq: ["fire", "ice"], step: 1 }] }];
  for (const [kit, u] of Object.entries(cases)) {
    const st = HI.gaugeState({ kit, ...u }, units);
    assert.equal(st.kit, kit);
    const h = HI.gauge(st);
    assert.ok(h.length > 100, kit + " 仪表是空的");
    assert.doesNotThrow(() => JSON.stringify(st));
  }
  assert.equal(HI.gaugeState({ kit: "xia", resources: { fuel: 99 } }).fuel, 5);
  assert.equal(HI.gaugeState({ kit: "hiaki", resources: { stance: "waki", niuOut: true } }).stance, "guard");
  assert.equal(HI.gaugeState({ kit: "hiaki", resources: { niuOut: true } }).out, "niu");
  assert.equal(HI.gaugeState({ kit: "yuito", resources: { bondId: "a" } }, units).bondName, "灯");
  assert.equal(HI.gaugeState({ kit: "kolt", resources: {}, layers: [{ current: 10, max: 10 }] }).full, true);
  assert.equal(HI.gaugeState({ kit: "kolt", resources: {}, layers: [{ current: 9, max: 10 }] }).full, false);
  const lg = HI.gaugeState(cases.longge.resources && { kit: "longge", ...cases.longge });
  assert.deepEqual(lg.ammo, [{ c: "red", seen: true }, { c: "blue", seen: false }, { c: "blue", seen: true }]);
  assert.equal(lg.spit, false);
  const helu = HI.gaugeState({ kit: "helu", resources: {} }, units);
  assert.deepEqual([helu.focus, helu.need], [1, 2]);
  assert.match(HI.gauge(lg), /剩 3 发 · 窥探 2/);
  assert.equal(HI.gaugeState({ kit: "boomcar" }), null);
  assert.equal(HI.gauge(null), "");
  assert.equal(HI.gauge({ kit: "nobody" }), "");
});
