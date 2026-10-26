// 单位悬停说明（unit-tip.js）：图鉴摘的简单描述 + 身上效果的文字说明
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

function load() {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "hud-icons.js"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "unit-tip.js"), "utf8"), c);
  return c;
}

test("简单描述：角色看图鉴介绍，敌人看行动方式和能力，配置物 / 间隔看配置物图鉴，武器人看被动", () => {
  const c = load(), T = c.UnitTip;
  assert.match(T.describe({ kind: "hero", kit: "ruby" }).text, /机甲/);
  const e = T.describe({ kind: "enemy", kit: "thug_knife" });
  assert.match(e.kicker, /杂兵/);
  assert.match(e.text, /行动方式/);
  assert.ok(e.list.length > 0);
  const p = T.describe({ kind: "prop", propKind: "boom" });
  assert.match(p.kicker, /配置物/);
  assert.ok(p.list.some(x => /耐久/.test(x)));
  assert.ok(T.describe({ kind: "gap", gapType: "wall" }).list.length > 0);
  const w = T.describe({ kind: "weapon", kit: "mochi", ownerName: "灯" });
  assert.equal(w.kicker, "灯的武器人");
});

test("效果：带层数 / 数值的词也能认出来，说明取自图鉴；图鉴没有的用补充说明", () => {
  const c = load(), T = c.UnitTip;
  assert.match(T.effect("灼烧×3").text, /灼烧层数/);
  assert.equal(T.effect("灼烧×3").name, "灼烧×3");
  assert.match(T.effect("高能 7").text, /自爆/);
  assert.match(T.effect("导体").text, /导体/);
  assert.match(T.effect("失衡").text, /跳过回合/);
  assert.match(T.effect("掩护（灯）").text, /协助格挡/);
  assert.match(T.effect("聚焦护甲 火→[冰]").text, /聚焦/);
  assert.equal(T.effect("酸液炮").text, "");
  const h = T.html({ kind: "enemy", kit: "thug_knife" }, ["灼烧×2", "虚弱", "灼烧×2"], { name: "狂徒", sub: "Lv1" });
  assert.match(h, /身上的效果/);
  assert.equal((h.match(/<b>灼烧×2<\/b>/g) || []).length, 1, "重复的只写一次");
  assert.match(h, /<svg/, "有图标的效果前面带图标");
  assert.match(T.html({ kind: "prop", propKind: "boom" }, [], { name: "爆炸桶" }), /没有效果/);
});

/* ---------- 简短版（联机悬停，作者 10/20 定）：完整的在点开的详情面板里 ---------- */
const plain = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
const MORE = "点一下单位看全部说明";
const MECHS = ["死刑（还有 2 回合）：亡命之王 的死刑：2 回合后落下。每一段都可以协助格挡。", "分担 → 瑞比（本回合落下）：这回合在我方回合开始时落下"];

test("简短版：名字、行动方式、首领机制的倒计时照写；不列能力和种族被动；效果只写名字、最多 8 个（多的写 +N）；末尾提示点开看全部", () => {
  const c = load(), T = c.UnitTip;
  assert.equal(T.BRIEF.effects, 8, "最多列几个在配置里");
  const tokens = ["灼烧×3", "感电", "腐蚀", "冻伤", "震荡", "共振", "不稳", "虚弱", "高能 6", "熔融", "过载"];
  const head = { name: "亡命之王", sub: "Lv5 · 2 区", mechs: MECHS, perks: ["红皮：火属性伤害 -10%"] };
  const full = T.html({ kind: "enemy", kit: "outlaw_king" }, tokens, head);
  const brief = T.html({ kind: "enemy", kit: "outlaw_king" }, tokens, head, { brief: true, more: MORE });
  // 完整版照旧（本机的悬停说明、联机的详情面板）：能力、种族被动、效果的说明都在
  assert.match(full, /class="ut-list"/); assert.match(full, /种族被动/); assert.match(full, /class="ut-effects"/); assert.match(full, /灼烧层数/);
  assert.equal(T.html({ kind: "enemy", kit: "outlaw_king" }, tokens, head, {}), full, "不给 brief 就是完整版");
  // 简短版
  assert.match(brief, /<b>亡命之王<\/b><span>Lv5 · 2 区<\/span>/);
  assert.match(brief, /行动方式/, "行动方式那一句还在");
  assert.match(brief, /首领机制 · 倒计时/); assert.match(brief, /<b>死刑（还有 2 回合）<\/b>/, "首领机制的倒计时照样列出");
  assert.doesNotMatch(brief, /class="ut-list"|种族被动/, "不列能力、种族被动");
  assert.match(brief, /身上的效果 · 11/);
  const chips = (brief.match(/<ul class="ut-chips">([\s\S]*?)<\/ul>/) || [])[1] || "";
  assert.equal((chips.match(/<b>/g) || []).length, 8, "最多 8 个效果");
  assert.match(brief, /class="ut-chips-more">\+3</, "多的写 +3");
  assert.doesNotMatch(plain(brief), /灼烧层数|每回合结束时/, "不写效果的说明");
  assert.match(brief, new RegExp(`class="ut-open">${MORE}<`));
  assert.ok(plain(brief).length < plain(full).length / 2, "字数比完整版少得多：" + plain(brief).length + " / " + plain(full).length);
  // 效果不多：全写，没有 +N；没有效果写「没有效果」
  const few = T.html({ kind: "enemy", kit: "thug_knife" }, ["灼烧×2", "虚弱"], { name: "狂徒" }, { brief: true });
  assert.doesNotMatch(few, /ut-chips-more|ut-open/);
  assert.match(few, /<b>灼烧×2<\/b>[\s\S]*<b>虚弱<\/b>/);
  assert.match(T.html({ kind: "enemy", kit: "thug_knife" }, [], { name: "狂徒" }, { brief: true }), /没有效果/);
});

test("简短版也照样认得：分阶段的首领写现在是哪个阶段（不列能力）、载具写车和乘员、驻波墙写它过滤什么、配置物写耐久", () => {
  const c = load(), T = c.UnitTip;
  const stage = T.html({ kind: "enemy", kit: "sand_aggregate", stage: 2 }, [], { name: "沙灵聚合体", sub: "Lv5 · 2 区" }, { brief: true, more: MORE });
  assert.match(stage, /当前阶段：<b>二阶段<\/b> · 还有其他阶段/);
  assert.doesNotMatch(stage, /class="ut-list"|机械臂|沙爪/, "能力一个都不列（哪一阶段的都不列）");
  const fullStage = T.html({ kind: "enemy", kit: "sand_aggregate", stage: 2 }, [], { name: "沙灵聚合体", sub: "Lv5 · 2 区" });
  assert.match(fullStage, /机械臂/); assert.doesNotMatch(fullStage, /沙爪/, "完整版（详情面板）照旧只列当前阶段的能力");
  const car = T.html({ kind: "prop", propKind: "fortress" }, ["晕眩标记 0/2"], { name: "移动堡垒", sub: "Lv3 · 2 区 · 敌方", rows: ["驾驶员：狂徒", "炮手：锤子"], rowsTitle: "乘员 2 / 4" }, { brief: true });
  assert.match(car, /<b>移动堡垒<\/b><span>Lv3 · 2 区 · 敌方<\/span>/);
  assert.match(car, /乘员 2 \/ 4<\/div><ul class="ut-list"><li>驾驶员：狂徒<\/li><li>炮手：锤子<\/li><\/ul>/, "乘员名单照写");
  assert.match(car, /<b>晕眩标记 0\/2<\/b>/);
  const wave = T.html({ kind: "gap", gapType: "wave", text: "这一道过滤火属性，降幅：穿过它的火属性伤害降低。" }, [], { name: "驻波墙·火·降幅（1–2 区之间）", sub: "暂时取代：危墙（耐久 12）" }, { brief: true });
  assert.match(wave, /驻波墙·火·降幅/); assert.match(wave, /暂时取代：危墙（耐久 12）/); assert.match(wave, /这一道过滤火属性/);
  const boom = T.html({ kind: "prop", propKind: "boom" }, [], { name: "爆炸桶", sub: "耐久 5/8 · 2 区" }, { brief: true });
  assert.match(boom, /爆炸桶[\s\S]*耐久 5\/8/);
});
