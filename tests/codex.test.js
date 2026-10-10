// 配置物图鉴 / 效果图鉴（codex.js）：手册第五、七、八章的条目都在，克制倍率和战斗用的 CHART 一致，搜索能用
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("效果图鉴：七种属性状态 / 即时 / 自我 / 攻击效果各 7 条，通用状态 8 条，天气 8 种", () => {
  const c = H.load();
  const all = c.codexEffectEntries();
  const count = (g) => all.filter(e => e.group === g).length;
  ["status", "instant", "self"].forEach(g => assert.equal(count(g), 7, g));
  assert.equal(count("attack"), 10, "七种属性攻击效果 + 穿刺 / 猛击 / 弱点特效");
  assert.equal(count("common"), 8);
  assert.equal(count("weather"), 8);
  assert.equal(count("element"), 7);
  assert.equal(count("layer"), 5);
  ["灼烧", "感电", "腐蚀", "冻伤", "震荡", "高能", "共振", "晕眩", "不稳", "躲藏", "火场", "冻土", "熔融", "刺骨", "中和", "导体", "霜结", "飞行"].forEach(n =>
    assert.ok(all.some(e => e.name === n), n));
  // 每个分类都在 CODEX_EFFECT_GROUPS 里，id 不重复
  const groups = c.S.CODEX_EFFECT_GROUPS.map(g => g.id);
  all.forEach(e => assert.ok(groups.includes(e.group), e.name));
  assert.equal(new Set(all.map(e => e.id)).size, all.length);
  all.forEach(e => assert.ok(e.lines.length, e.name + " 有说明"));
});

test("伤害属性条目的克制倍率来自 CHART", () => {
  const c = H.load();
  const fire = c.codexEffectEntries().find(e => e.group === "element" && e.element === "fire");
  assert.equal(fire.chart.find(x => x.layer === "flesh").value, 0.5);
  assert.equal(fire.chart.find(x => x.layer === "armor").value, -0.25);
  const sand = c.codexEffectEntries().find(e => e.group === "layer" && e.layer === "sand");
  assert.equal(sand.chart.find(x => x.element === "harmonic").value, 0.5);
  assert.equal(c.codexPct(0.5), "+50%");
  assert.equal(c.codexPct(-0.25), "−25%");
});

test("配置物图鉴：手册里的 10 种 + 技能造出来的铁壁 / 防护罩 / 废铁墙；碎渣机炮写着使用也扣耐久", () => {
  const c = H.load();
  const props = c.codexPropEntries();
  ["bridge", "wall", "door", "button", "lever", "battery", "boom", "acid", "scrap", "turret", "ironwall", "dome", "scrapwall"].forEach(id =>
    assert.ok(props.some(p => p.id === id), id));
  assert.equal(props.find(p => p.id === "wall").group, "gap");
  assert.equal(props.find(p => p.id === "boom").group, "zone");
  assert.equal(props.find(p => p.id === "boom").movable, true);
  assert.equal(props.find(p => p.id === "dome").group, "skill");
  assert.match(props.find(p => p.id === "scrap").lines.join(""), /受到攻击或使用后减少1耐久/);
  // 游戏里每种配置物都有图鉴条目
  props.forEach(p => assert.ok(p.lines.length, p.name));
});

test("搜索：名字、说明文字、属性名都能搜，多个关键词要全部包含", () => {
  const c = H.load();
  const hits = (q) => c.codexEffectEntries().filter(e => c.codexMatch(e, q)).map(e => e.name);
  assert.ok(hits("灼烧").includes("灼烧"));
  assert.ok(hits("灼烧").includes("中和"), "说明文字里提到也算");
  assert.ok(hits("冰 击破").every(n => n), "多个关键词");
  assert.ok(!hits("冰 击破").includes("灼烧"));
  assert.equal(hits("").length, c.codexEffectEntries().length);
  assert.ok(c.codexPropEntries().filter(p => c.codexMatch(p, "爆炸")).some(p => p.id === "boom"));
});

test("角色图鉴：11 名角色都有介绍和 1–5 星难度，带完整的被动（含升级）、技能、职责技能和武器人", () => {
  const c = H.load();
  const heroes = c.codexHeroEntries();
  assert.deepEqual(JSON.parse(JSON.stringify(heroes.map(h => h.kit))), ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras", "longge"]);
  heroes.forEach(h => {
    assert.ok(h.intro.length > 40, h.kit + " 介绍");
    assert.ok(h.stars >= 1 && h.stars <= 5, h.kit + " 星级");
    assert.ok(h.sheet, h.kit + " 资料");
    assert.ok(h.sheet.passives.length >= 2, h.kit + " 被动");
    assert.ok(h.sheet.skills.now.length + h.sheet.skills.later.length >= 3, h.kit + " 技能");
    assert.ok(h.sheet.weapons.length >= 1, h.kit + " 武器人");
    assert.ok(h.roleSkills.length >= 4, h.kit + " 职责技能");
    assert.ok(h.race && h.job, h.kit + " 种族职业");
  });
  const hiaki = heroes.find(h => h.kit === "hiaki");
  assert.match(hiaki.sheet.passives[0].next, /丹生谷提供的以及武器人的协助格挡率/, "被动升级文字");
  assert.equal(hiaki.sheet.weapons.length, 2);
  assert.ok(!hiaki.sheet.skills.now.some(k => k.name === "一闪"), "1 级不展示未解锁技能");
  assert.equal(hiaki.sheet.skills.later.length, 0);
  // 图鉴「按等级查看」：all 里列全部技能和解锁等级（默认只显示 1 级，点别的等级再看）
  const hAll = hiaki.sheet.skills.all;
  assert.ok(hAll.some(k => k.name === "一闪" && k.minLv === 2), "一闪 2 级解锁");
  assert.ok(hAll.filter(k => (k.minLv || 1) <= 1).every(k => hiaki.sheet.skills.now.some(n => n.id === k.id)), "1 级的就是当前技能");
  const kolt = heroes.find(h => h.kit === "kolt");
  assert.ok(kolt.sheet.skills.all.some(k => k.id === "kolt_cannon" && k.minLv === 11));
  assert.ok(kolt.sheet.weapons[0].skills.all.some(k => k.id === "torque_divert" && k.minLv === 4), "武器人的技能也按等级列");
  assert.equal(c.codexPlusLevel(1), 5);
  assert.equal(c.codexPlusLevel(2), 10);
  assert.equal(heroes.find(h => h.kit === "tou").stars, 2);
  assert.equal(heroes.find(h => h.kit === "ras").stars, 5);
  // 搜索也能搜到角色（技能名、介绍）
  assert.deepEqual(JSON.parse(JSON.stringify(heroes.filter(h => c.codexMatch(h, "咖啡")).map(h => h.kit))), ["yuito"]);
});
