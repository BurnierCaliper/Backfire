// 角色专属技能 / 被动 / 武器人的一批规则 bug（审计包 P4-heroes）的回归测试
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(party, enemies, opt) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party, enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "P4" }, opt || {}));
  c.startCombat();
  return { c, S: c.S.state };
}
const kit = (S, k) => S.units.find(u => u.kit === k && !u.hidden);
const foesOf = (S) => S.units.filter(u => !u.isPlayer);
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const logText = (S) => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const fatten = (u, hp) => { u.layers = [{ type: "flesh", current: hp, max: hp, inner: true }]; };
const ready = (u, zone) => { if (zone != null) u.zone = zone; u.ap = 5; u.bonus = 5; };
const hit = (c, a, t, opt) => c.dealTo(a, t, Object.assign({ atk: 0, mult: 0, element: "physical", baseBreak: 0, atkRange: "any",
  flags: { action: true, blockResolved: true, block: "none" } }, opt));

/* ---------- 川川 ---------- */

test("巨刃划空打配置物：爆炸桶 / 酸液桶 / 碎渣机炮直接摧毁（爆炸桶照常爆炸），其余按配置物规则结算", () => {
  const { c, S } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), foe = foesOf(S)[0];
  ch.level = 11; ready(ch, 1); foe.zone = 1; fatten(foe, 300);
  ch.layers.forEach(l => { l.current = l.max = 300; });               // 爆炸也会炸到川川：血厚一点，后面还要出手
  // 满耐久的爆炸桶：直接摧毁 → 爆炸、移出场、返还 1 电能
  const boom = c.makeProp("boom", 1, 1); S.props.push(boom);
  ch.resources.charge = 3;
  const foeHp = c.totalHp(foe);
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: "prop:" + boom.id, picks: { target: "prop:" + boom.id } });
  assert.ok(!S.props.includes(boom), "爆炸桶移出场");
  assert.match(logText(S), /爆炸/);
  assert.ok(c.totalHp(foe) < foeHp, "同区敌人挨了爆炸");
  assert.equal(ch.resources.charge, 1, "3 − 3 + 1（摧毁配置物返还）");
  // 酸液桶、碎渣机炮也直接摧毁
  for (const kind of ["acid", "scrap"]) {
    const p = c.makeProp(kind, 1, 1); S.props.push(p);
    ch.resources.charge = 3; ready(ch);
    cmd(c, { actor: ch.id, skill: "chuan_blade", target: "prop:" + p.id, picks: { target: "prop:" + p.id } });
    assert.ok(!S.props.includes(p), kind + " 被摧毁");
  }
  // 电池（装甲生命）：伤害翻倍 2×atk → 4×atk，电打装甲 ×0.75
  const bat = c.makeProp("battery", 1, 1); bat.hp = bat.maxHp = 999; S.props.push(bat);
  ch.resources.charge = 3; ready(ch);
  const atk = c.effectiveAtk(ch, S.units);
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: "prop:" + bat.id, picks: { target: "prop:" + bat.id } });
  assert.equal(999 - bat.hp, Math.floor(Math.floor(atk * 4) * 0.75 + 1e-6));
});

test("巨刃划空不能打自己的铁壁（目标里没有，硬选也不扣点）", () => {
  const { c, S } = setup(["chuan", "nora"]);
  const ch = kit(S, "chuan");
  ch.level = 11; ready(ch, 1); ch.resources.charge = 5;
  cmd(c, { actor: ch.id, skill: "chuan_wall" });
  const wall = S.props.find(p => p.kind === "ironwall");
  assert.ok(wall);
  ready(ch); ch.resources.charge = 3;
  const steps = c.skillFlowSteps("chuan_blade", ch, {});
  assert.ok(!steps.length || !steps[0].units.some(u => u.id === "prop:" + wall.id), "分步里没有自己的铁壁");
  const hp = wall.hp, ap = ch.ap, def = ch.def;
  cmd(c, { actor: ch.id, skill: "chuan_blade", target: "prop:" + wall.id, picks: { target: "prop:" + wall.id } });
  assert.equal(wall.hp, hp);
  assert.equal(ch.ap, ap, "不扣行动点");
  assert.equal(ch.resources.charge, 3, "不扣电能");
  assert.equal(ch.def, def);
});

test("磁场护盾：川川的护盾被过载清零后标记清掉，别人给的护盾被打破不推人", () => {
  const { c, S } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), nora = kit(S, "nora"), foe = foesOf(S)[0];
  ready(ch, 1); nora.zone = 1; foe.zone = 1; fatten(foe, 300); foe.def = foe.defMax = 9;
  ch.resources.charge = 3;
  cmd(c, { actor: ch.id, skill: "chuan_over", target: nora.id });   // 过载 + atk/2 护盾（川川给的）
  assert.ok(nora.shieldFromChuan);
  c.endPlayerTurn(); c.endEnemyTurn();                                // 下回合开始：过载结束，护盾清零
  assert.equal(c.shieldSum(nora), 0);
  assert.ok(!nora.shieldFromChuan && !nora.magnetShield, "标记跟着清掉");
  assert.doesNotMatch(c.statusLine(nora), /磁场护盾/);
  c.addShieldLayer(nora, 6, false);                                   // 别人给的护盾（缓冲 / 电池提取）
  const out = hit(c, foe, nora, { flat: 40 });
  assert.ok(!(out.extra || []).some(t => /磁场护盾/.test(t)), (out.extra || []).join("|"));
  assert.equal(foe.zone, 1, "没有被推开");
  assert.equal(foe.def, 9, "没有磁场护盾的击破");
});

test("磁场护盾：川川给的护盾被打破时川川不在同区，标记也清掉（之后别人的护盾破了不触发）", () => {
  const { c, S } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const ch = kit(S, "chuan"), nora = kit(S, "nora"), foe = foesOf(S)[0];
  ch.zone = 1; nora.zone = 2; foe.zone = 2; fatten(foe, 300); foe.def = foe.defMax = 9;
  nora.layers.forEach(l => { l.current = l.max = 200; });
  c.addShieldLayer(nora, 3);                                          // 川川给的
  hit(c, foe, nora, { flat: 10 });
  assert.ok(!nora.shieldFromChuan, "护盾破了，标记作废");
  c.addShieldLayer(nora, 3, false);
  ch.zone = 2;
  const out = hit(c, foe, nora, { flat: 10 });
  assert.ok(!(out.extra || []).some(t => /磁场护盾/.test(t)));
  assert.equal(foe.zone, 2);
});

test("回收护盾：只清护盾的值；维塔斯自带的护盾层留着，技能给的护盾层整层去掉", () => {
  const { c, S } = setup(["chuan", "nora"]);
  const ch = kit(S, "chuan"), nora = kit(S, "nora");
  ch.weaponLevels.bili = 10; ready(ch, 1); nora.zone = 1;
  assert.ok(c.passivePlus(ch, 2));
  const vitas = c.spawnWeapon(nora, "vitas"); vitas.zone = 1;
  const innate = vitas.layers.find(l => l.type === "shield");
  const innateMax = innate.max;
  c.addShieldLayer(vitas, 4);                                         // 叠在自带护盾层上
  assert.equal(innate.max, innateMax + 4);
  ch.resources.charge = 0;
  cmd(c, { actor: ch.id, skill: "chuan_reclaim", target: vitas.id });
  assert.ok(vitas.layers.includes(innate), "自带的护盾层还在");
  assert.equal(innate.current, 0);
  assert.equal(innate.max, innateMax, "叠上去的那部分去掉");
  assert.equal(ch.resources.charge, 2);
  // 没有自带护盾的人：技能给的护盾层整层去掉
  c.addShieldLayer(nora, 5);
  ready(ch);
  cmd(c, { actor: ch.id, skill: "chuan_reclaim", target: nora.id });
  assert.ok(!nora.layers.some(l => l.type === "shield"));
  // 护盾已经回收空了：再用就拦下，不花附赠动作
  ready(ch); const b0 = ch.bonus;
  cmd(c, { actor: ch.id, skill: "chuan_reclaim", target: vitas.id });
  assert.equal(ch.bonus, b0);
});

test("铁壁也受过载和雷鸣的反伤增益", () => {
  const { c, S } = setup(["chuan", "nora"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), nora = kit(S, "nora"), foe = foesOf(S)[0];
  ready(ch, 1); nora.zone = 1; foe.zone = 1; fatten(foe, 300);
  ch.resources.charge = 1;
  cmd(c, { actor: ch.id, skill: "chuan_wall" });
  const wall = S.props.find(p => p.kind === "ironwall");
  wall.hp = wall.maxHp = 500;
  c.applyInstantEffect(ch, "overload", []);
  const h0 = c.totalHp(foe);
  hit(c, foe, nora, { flat: 20 });                                    // 近距离攻击被铁壁挡下
  assert.ok(wall.hp < 500, "铁壁替同区挨了这一下");
  assert.ok(c.totalHp(foe) < h0, "过载：反伤 50% 闪电");
  // 雷鸣：挡下攻击反伤 等级 × 1d4（川川没有过载也有）
  ch.instant.overload = false;
  S.weather = "thunder"; S.actionWallHit = {};
  const h1 = c.totalHp(foe);
  hit(c, foe, nora, { flat: 20 });
  assert.ok(c.totalHp(foe) < h1, "雷鸣反伤");
});

/* ---------- Helumica 聚焦 ---------- */

function focusField(extra) {
  const { c, S } = setup(["chuan", "helu"].concat(extra || []), [{ id: "bandit_boss", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), helu = kit(S, "helu"), foe = foesOf(S)[0];
  ready(ch, 1); helu.zone = 2; foe.zone = 1; S.weather = "none";
  foe.def = foe.defMax = 30;
  foe.layers = [{ type: "armor", current: 200, max: 200 }, { type: "flesh", current: 500, max: 500, inner: true }];
  c.applyFocus(foe, "armor", []);
  return { c, S, ch, helu, foe };
}

test("聚焦：一次行动只推进一步（川川普攻两刀不再走完精英序列）", () => {
  const { c, S, ch, foe } = focusField();
  foe.focuses[0].seq = ["electric", "electric"];
  ch.resources.charge = 0;
  cmd(c, { actor: ch.id, skill: "chuan_aa", target: foe.id });
  assert.equal(foe.focuses.length, 1);
  assert.equal(foe.focuses[0].step, 1, "两刀只推进 1 步");
  ready(ch);
  cmd(c, { actor: ch.id, skill: "chuan_aa", target: foe.id });
  assert.ok(!foe.layers.some(l => l.type === "armor"), "下一次行动走完序列、抹层");
});

test("聚焦：Helumica 协助攻击的那一击推进过，就不再「直接推进」第二步", () => {
  const { c, S, helu, foe } = focusField();
  foe.focuses[0].seq = ["harmonic", "ice", "ice"];
  helu.zone = 1;
  S.attackerId = helu.id; S.targetId = foe.id;
  c.runSkill("helu_assist", { ignorePhase: true, free: true });
  assert.equal(foe.focuses[0].step, 1);
});

test("聚焦的层被打碎后清除聚焦：不再抹第二次、不再给 2 击破、不再记成废物利用来源", () => {
  const { c, S, helu, foe } = focusField(["kolt"]);                     // 带上柯尔特：废料记在他身上
  const kolt = kit(S, "kolt");
  foe.focuses[0].seq = ["acid", "acid"];
  hit(c, helu, foe, { flat: 400 });                                    // 一下打碎装甲层（物理，不推进序列）
  assert.equal(foe.layers.find(l => l.type === "armor").current, 0);
  assert.equal(foe.focuses.length, 0, "聚焦跟着清掉");
  assert.deepEqual(plain(kolt.resources.scrapStore), { armor: 200 }, "打碎的那一层记成废料");
  kolt.resources.scrapStore = {};                                      // 被废物利用领走
  const def0 = foe.def;
  hit(c, helu, foe, { flat: 5, element: "acid" });
  hit(c, helu, foe, { flat: 5, element: "acid" });
  assert.equal(foe.def, def0, "没有抹层的 2 击破");
  assert.deepEqual(plain(kolt.resources.scrapStore), {}, "同一层没有被重新记成来源");
});

/* ---------- 龙哥 ---------- */

test("龙哥：伤害预览（沙盒预演）里不真的窥探，也不写出没看过的子弹颜色", () => {
  const { c, S } = setup(["longge", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const lg = kit(S, "longge"), foe = foesOf(S)[0];
  ready(lg, 1); foe.zone = 1; fatten(foe, 300);
  const color = lg.resources.ammo[0] === "red" ? "红弹" : "蓝弹";
  c.GAME = { sim: true };
  const mark = S.logPages.flatMap(p => p.lines).length;
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foe.id });
  cmd(c, { actor: lg.id, skill: "longge_safety" });
  c.GAME = null;
  const text = S.logPages.flatMap(p => p.lines).slice(mark).map(l => l.text).join("\n");
  assert.match(text, /窥探 1/);
  assert.doesNotMatch(text, new RegExp("第 1 发是" + color));
  assert.doesNotMatch(text, /查看最后一发：[红蓝]弹/);
  assert.ok(!lg.resources.seen.some(Boolean), "没有记成看过");
  // 真正出手照常窥探
  ready(lg);
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foe.id });
  assert.ok(lg.resources.seen[0], "实战里照常窥探 1");
});

test("Ecmo 音爆：同区配置物按 Helumica 触发配置物的方式各触发一次——拉杆扳一次，爆炸桶 / 酸液桶直接引爆", () => {
  const { c, S } = setup(["helu", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const helu = kit(S, "helu"), foe = foesOf(S)[0];
  ready(helu, 2); foe.zone = 1; fatten(foe, 300);
  S.gaps["1-2"] = { type: "door", hp: 0, open: false };
  const lever = c.makeProp("lever", 1, 1), acid = c.makeProp("acid", 1, 1), boom = c.makeProp("boom", 1, 1);
  S.props.push(lever, acid, boom);
  const ecmo = c.spawnWeapon(helu, "ecmo"); ready(ecmo, 1); ecmo.level = 2;
  ecmo.layers.forEach(l => { l.current = l.max = 500; });
  const mark = S.logPages.flatMap(p => p.lines).length;
  cmd(c, { actor: ecmo.id, skill: "ecmo_boom" });
  const text = S.logPages.flatMap(p => p.lines).slice(mark).map(l => l.text).join("\n");
  assert.equal(S.gaps["1-2"].open, true, "拉杆扳了一次");
  assert.ok(!S.props.includes(acid), "酸液桶直接引爆");
  assert.ok(!S.props.includes(boom), "爆炸桶直接引爆");
  assert.match(text, /音爆/);
  // 同区没有敌人也照样触发配置物
  foe.zone = 2;
  ready(ecmo);
  cmd(c, { actor: ecmo.id, skill: "ecmo_boom" });
  assert.equal(S.gaps["1-2"].open, false, "又扳了一次");
});

/* ---------- 拉斯缪尔 / EDC ---------- */

test("泄能 / 不稳超导：转换的光能以现有累积能量为上限，0 就不给", () => {
  const { c, S } = setup(["ras", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const ras = kit(S, "ras"), foe = foesOf(S)[0];
  ready(ras, 1);
  ras.resources.energyPct = 0; ras.resources.light = 0;
  cmd(c, { actor: ras.id, skill: "ras_dump", target: foe.id });
  assert.equal(ras.resources.light, 0, "0% 不凭空给光能");
  ready(ras);
  ras.resources.energyPct = 10;
  cmd(c, { actor: ras.id, skill: "ras_super" });
  assert.equal(ras.resources.light, Math.floor(c.totalMaxHp(ras) * 0.1), "只转换现有的 10%");
  assert.equal(ras.resources.energyPct, 0);
});

test("诺拉普攻（没有刺入时）、EDC 电流冲击：只能打距离 1；刺入目标在同区照样能打", () => {
  const { c, S } = setup(["nora", "ras"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const nora = kit(S, "nora"), ras = kit(S, "ras"), foe = foesOf(S)[0];
  ready(nora, 1); foe.zone = 1; fatten(foe, 300);
  assert.equal(JSON.stringify(c.skillRangeFor(nora, "nora_aa")), JSON.stringify({ min: 1, max: 1 }));
  cmd(c, { actor: nora.id, skill: "nora_aa", target: foe.id });
  assert.equal(c.totalHp(foe), 300, "同区打不到");
  assert.equal(nora.ap, 5, "不扣行动点");
  nora.zone = 2; ras.zone = 1;
  cmd(c, { actor: nora.id, skill: "nora_aa", target: ras.id });
  assert.equal(nora.ap, 5, "没有刺入时不能打友方：扣点前就拦下");
  cmd(c, { actor: nora.id, skill: "nora_aa", target: foe.id });
  assert.ok(c.totalHp(foe) < 300, "距离 1 能打");
  // 有刺入：刺入目标在同区也能打
  nora.zone = 1; ready(nora);
  c.setPierce(nora, foe, []);
  nora.resources.mood = "cruel";
  const h1 = c.totalHp(foe);
  cmd(c, { actor: nora.id, skill: "nora_aa", target: foe.id });
  assert.ok(c.totalHp(foe) < h1, "刺入目标同区照打");
  // EDC 电流冲击
  ready(ras, 1);
  const edc = c.spawnWeapon(ras, "edc"); ready(edc, 1);
  assert.equal(JSON.stringify(c.skillRangeFor(edc, "edc_shock")), JSON.stringify({ min: 1, max: 1 }));
  const h2 = c.totalHp(foe);
  cmd(c, { actor: edc.id, skill: "edc_shock", target: foe.id });
  assert.equal(c.totalHp(foe), h2, "同区打不到");
  assert.equal(edc.ap, 5);
  edc.zone = 2;
  cmd(c, { actor: edc.id, skill: "edc_shock", target: foe.id });
  assert.ok(c.totalHp(foe) < h2);
});

test("扭矩电钻突进、拉斯缪尔逃离：危墙挡住的终点不列出、硬选也不扣点；不稳态逃离的终点不含原区", () => {
  const { c, S } = setup(["kolt", "ras"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const kolt = kit(S, "kolt"), ras = kit(S, "ras");
  S.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  ready(kolt, 1); kolt.resources.bit = "drill";
  const tq = c.spawnWeapon(kolt, "torque"); ready(tq, 1);
  assert.deepEqual(plain(c.skillFlowSteps("torque_boost", tq, {})[0].zones), []);
  cmd(c, { actor: tq.id, skill: "torque_boost", picks: { dest: 2 } });
  assert.equal(tq.zone, 1, "没有穿墙");
  assert.equal(tq.ap, 5, "不扣行动点");
  ready(ras, 1);
  assert.deepEqual(plain(c.skillFlowSteps("ras_flee", ras, {})[0].zones), []);
  ras.resources.unstable = true; ras.resources.energyPct = 120;
  assert.ok(!c.skillFlowSteps("ras_flee", ras, {})[0].zones.includes(1), "不稳态：终点不含原区");
  cmd(c, { actor: ras.id, skill: "ras_flee", picks: { dest: 2 } });
  assert.equal(ras.zone, 1);
  assert.equal(ras.ap, 5);
  S.gaps["1-2"] = { type: "open", hp: 0, open: true };
  assert.deepEqual(plain(c.skillFlowSteps("ras_flee", ras, {})[0].zones), [2]);
});

test("拉斯缪尔：说明和日志写成和实现一致（达到 100%、任何来源的伤害、倒地）", () => {
  const { c, S } = setup(["ras", "kolt"]);
  const p = c.SkillText.kitInfo("ras").passives.find(x => x.name === "事故幸存");
  assert.match(p.text, /达到 100%/);
  assert.match(p.text, /受到任何来源的伤害（攻击、持续伤害、场地效果、余波……）就会倒地/);
  const ras = kit(S, "ras");
  ras.resources.energyPct = 90;
  c.addRasEnergy(20, "测试");
  const t = logText(S);
  assert.doesNotMatch(t, /即死/);
  assert.match(t, /倒地/);
});

test("过期的日志 / 说明文字：雷电风暴 0.4atk、酸液炮下回合开始、环境扫描写上高压场地", () => {
  const { c, S } = setup(["chuan", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const ch = kit(S, "chuan"), foe = foesOf(S)[0], kolt = kit(S, "kolt");
  ready(ch, 1); foe.zone = 1; fatten(foe, 300);
  const bili = c.spawnWeapon(ch, "bili"); ready(bili, 1); bili.level = 4;
  ch.resources.charge = 2;
  cmd(c, { actor: bili.id, skill: "bili_storm", target: foe.id });
  assert.match(logText(S), /0\.4atk 电击/);
  assert.doesNotMatch(logText(S), /0\.5atk 电击，击破/);
  kolt.resources.bit = "acid"; ready(kolt, 1);
  const tq = c.spawnWeapon(kolt, "torque"); ready(tq, 1);
  cmd(c, { actor: tq.id, skill: "torque_boost", picks: { dest: 2 } });
  assert.match(logText(S), /下回合开始时对 2 区爆发/);
  assert.match(c.SkillText.skillText("helu_scan"), /高压场地/);
});

/* ---------- 诺拉 / 维塔斯 ---------- */

test("维塔斯扯下 / 加压灌输（残忍）：对刺入目标不受距离限制", () => {
  const { c, S } = setup(["nora", "kolt"], [{ id: "thug_knife", lv: 1, zone: 3 }], { zoneMode: 3 });
  const nora = kit(S, "nora"), foe = foesOf(S)[0];
  S.zoneMode = 3;
  nora.zone = 2; foe.zone = 3; fatten(foe, 300);
  c.setPierce(nora, foe, []);
  const vitas = c.spawnWeapon(nora, "vitas"); ready(vitas, 1);
  nora.resources.mood = "cruel"; vitas.resources.mood = "cruel";
  cmd(c, { actor: vitas.id, skill: "vitas_infuse" });
  const h1 = c.totalHp(foe);
  assert.ok(h1 < 300, "加压灌输（残忍）打到了距离 2 的刺入目标");
  cmd(c, { actor: vitas.id, skill: "vitas_rip" });
  assert.ok(c.totalHp(foe) < h1, "扯下打到了");
  assert.equal(c.piercedTarget(nora), null, "刺入结束");
});

test("声波震击：同区没有敌人时，刺入目标那一下照样打；什么都没有就不能用", () => {
  const { c, S } = setup(["nora", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const nora = kit(S, "nora"), foe = foesOf(S)[0];
  ready(nora, 1); nora.level = 11; foe.zone = 2; fatten(foe, 300);
  assert.match(c.skillRequirementError(nora, "nora_sonic") || "", /没有敌人/);
  c.setPierce(nora, foe, []);
  assert.equal(c.skillRequirementError(nora, "nora_sonic"), null);
  cmd(c, { actor: nora.id, skill: "nora_sonic" });
  assert.ok(c.totalHp(foe) < 300, "刺入目标挨了额外那一下");
});

/* ---------- 瑞比 / 明特 ---------- */

function mechaField(wlv) {
  const { c, S } = setup(["ruby", "kolt"], [{ id: "thug_hammer", lv: 1, zone: 1 }]);
  const r = kit(S, "ruby"), foe = foesOf(S)[0];
  if (wlv) r.weaponLevels.mint = wlv;
  ready(r, 1); foe.zone = 1; r.resources.nano = 60;
  r.layers.forEach(l => { l.current = l.max = 50; });
  const m = c.spawnWeapon(r, "mint"); ready(m, 1);
  m.layers.forEach(l => { l.current = l.max = 40; });
  const ruby0 = { def: r.def, defMax: r.defMax };
  c.enterMecha();
  return { c, S, r, m, foe, ruby0 };
}

test("解除机甲：瑞比架势还原成自己的；主动解除、纳米耗尽不坠落", () => {
  const { c, S, r, m, ruby0 } = mechaField();
  assert.ok(r.resources.mecha);
  r.def = 1;                                                          // 机甲（明特的架势）挨过击破
  const hpR = 50, hpM = 40;
  r.ap = 2;
  cmd(c, { actor: r.id, skill: "ruby_unmecha" });
  assert.ok(!r.resources.mecha);
  assert.equal(r.defMax, ruby0.defMax, "架势上限还原");
  assert.equal(r.def, ruby0.def, "架势当前值还原");
  assert.equal(m.def, 1, "机甲用掉的架势留给明特");
  assert.equal(c.totalHp(r), hpR, "主动解除不坠落");
  assert.equal(c.totalHp(m), hpM);
  assert.ok(!r.layers.some(l => l.type === "armor"), "明特的装甲层不留在瑞比身上");
  // 纳米耗尽
  const f2 = mechaField();
  f2.r.resources.nano = 20;
  f2.c.turnEnd();
  assert.ok(!f2.r.resources.mecha);
  assert.equal(f2.c.totalHp(f2.r), 50, "纳米耗尽不坠落");
  assert.equal(f2.c.totalHp(f2.m), 40);
});

test("瑞比机甲被击落：坠落伤害只算一次（两人各自 20%，不再先按整台机甲扣一次）", () => {
  const { c, S, r, m, foe } = mechaField();
  r.def = 1;
  const out = hit(c, foe, r, { flat: 0, baseBreak: 1 });
  assert.ok(!r.resources.mecha, "被击落，机甲结束");
  assert.equal(c.totalHp(r), 50 - 10, "瑞比只受自己的 20%");
  assert.equal(c.totalHp(m), 40 - 8, "明特只受自己的 20%");
  assert.ok(!(out.res.log || []).some(t => /扣除 20% 最大生命/.test(t)), "没有通用击落的 20%");
  assert.ok(r.stunned && m.stunned, "机甲失衡：两人都失衡");
  // 银翼+：瑞比不受坠落伤害、不失衡
  const f2 = mechaField(10);
  f2.r.def = 1;
  hit(f2.c, f2.foe, f2.r, { flat: 0, baseBreak: 1 });
  assert.equal(f2.c.totalHp(f2.r), 50);
  assert.ok(!f2.r.stunned);
  assert.equal(f2.r.def, f2.ruby0.def);
});

test("放弃被动：瑞比 / 明特协助格挡成功不加纳米；拉响引擎点不着火时不扣行动点", () => {
  const { c, S } = setup(["ruby", "xia"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const r = kit(S, "ruby"), x = kit(S, "xia"), foe = foesOf(S)[0];
  r.zone = x.zone = foe.zone = 1; r.bonus = 2;
  S.weaponMods = { mint: { noPassive: true }, berniel: { noPassive: true } };
  // 图纸武器 4 级才生效（主持人手册本版修订）
  r.weaponLevels = Object.assign({}, r.weaponLevels, { mint: 4 });
  x.weaponLevels = Object.assign({}, x.weaponLevels, { berniel: 4 });
  const n0 = r.resources.nano;
  const res = c.performAssistBlock(r, x, foe, { ok: true, roll: 1 });
  assert.ok(res.ok);
  assert.equal(r.resources.nano, n0, "放弃「纳米科技」不加纳米");
  ready(x);
  assert.match(c.skillRequirementError(x, "xia_engine") || "", /放弃/);
  cmd(c, { actor: x.id, skill: "xia_engine" });
  assert.equal(x.ap, 5, "不扣行动点");
  assert.ok(!x.resources.engine);
});

/* ---------- 结人 / 拿铁 ---------- */

test("爱意：能对其他区的友方用（移过去）；拿铁自己不跟着恢复；危墙挡住就不能用", () => {
  const { c, S } = setup(["yuito", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const y = kit(S, "yuito"), kolt = kit(S, "kolt");
  ready(y, 1); y.level = 2; kolt.zone = 2;
  const latte = c.spawnWeapon(y, "latte"); ready(latte, 1); latte.level = 2;
  kolt.layers.forEach(l => { l.current = 1; });
  latte.layers.forEach(l => { l.current = 1; });
  cmd(c, { actor: latte.id, skill: "latte_love", target: kolt.id });
  assert.equal(latte.zone, 2, "移动到友方的区域");
  assert.ok(c.totalHp(kolt) > 1, "友方恢复");
  assert.equal(c.totalHp(latte), 1, "拿铁自己不恢复");
  assert.equal(y.resources.bondId, kolt.id);
  // 危墙挡住
  latte.zone = 1; ready(latte);
  S.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  cmd(c, { actor: latte.id, skill: "latte_love", target: kolt.id });
  assert.equal(latte.zone, 1);
  assert.equal(latte.ap, 5, "不扣行动点");
});

test("冰美式：治疗距离 1 以内的同伴，清场只打距离 1 的那一区", () => {
  const { c, S } = setup(["yuito", "kolt"], [{ id: "thug_knife", lv: 1, zone: 3 }], { zoneMode: 3 });
  const y = kit(S, "yuito"), kolt = kit(S, "kolt"), foe = foesOf(S)[0];
  S.zoneMode = 3; ready(y, 1); kolt.zone = 3; foe.zone = 3; fatten(foe, 300);
  y.resources.liquid = 3;
  const heal = c.skillFlowSteps("yuito_amer", y, { mode: "heal" }).find(s => s.key === "target");
  assert.ok(!heal.units.some(u => u.id === kolt.id), "距离 2 的同伴不在列表里");
  kolt.layers.forEach(l => { l.current = 1; });
  cmd(c, { actor: y.id, skill: "yuito_amer", target: kolt.id, picks: { mode: "heal", target: kolt.id } });
  assert.equal(c.totalHp(kolt), 1);
  assert.equal(y.resources.liquid, 3, "没用掉咖啡液");
  assert.equal(y.ap, 5);
  cmd(c, { actor: y.id, skill: "yuito_amer", target: foe.id, picks: { mode: "atk", target: foe.id } });
  assert.equal(c.totalHp(foe), 300, "距离 2 的区打不到");
  foe.zone = 2;
  cmd(c, { actor: y.id, skill: "yuito_amer", target: foe.id, picks: { mode: "atk", target: foe.id } });
  assert.ok(c.totalHp(foe) < 300, "距离 1 的区照打");
});

test("酸萃是范围攻击：打飞行敌人不逐个多付附赠，每只都受伤", () => {
  const { c, S } = setup(["yuito", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const y = kit(S, "yuito"), [f1, f2] = foesOf(S);
  ready(y, 1); y.level = 20; y.bonus = 0; y.resources.liquid = 1;   // 20 级 5d4：飞行减半后也一定有伤害
  [f1, f2].forEach(f => { f.zone = 1; f.flying = true; fatten(f, 300); });
  cmd(c, { actor: y.id, skill: "yuito_extract", picks: { dest: 1 } });
  assert.ok(c.totalHp(f1) < 300 && c.totalHp(f2) < 300, "两只都受伤");
  assert.equal(y.bonus, 0);
});

/* ---------- 绯秋 ---------- */

test("绯秋两把刀都分出后共享行动点和附赠动作", () => {
  const { c, S } = setup(["hiaki", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const h = kit(S, "hiaki"), foe = foesOf(S)[0];
  ready(h, 1); foe.zone = 1; fatten(foe, 300);
  const niu = c.spawnWeapon(h, "niu"); niu.ap = 1; niu.bonus = 1;
  niu.ap = 0;                                                         // 丹生谷这回合已经用掉了行动点
  const naruto = c.spawnWeapon(h, "naruto");
  assert.equal(naruto.ap, 0, "后分出的刀接着用剩下的");
  assert.equal(naruto.bonus, 1);
  c.spendBonus(naruto, 1, "测试");
  assert.equal(niu.bonus, 0, "一把刀花了附赠，另一把跟着少");
  niu.ap = naruto.ap = 1;
  c.spendAp(niu, 1, "测试");
  assert.equal(naruto.ap, 0);
});

test("燕飞：打完同区敌人后真的移动 1 格；走不到的区不列出", () => {
  const { c, S } = setup(["hiaki", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const h = kit(S, "hiaki"), foe = foesOf(S)[0];
  ready(h, 1); foe.zone = 1; fatten(foe, 300);
  const naruto = c.spawnWeapon(h, "naruto"); ready(naruto, 1); naruto.level = 2;
  const step = c.skillFlowSteps("naruto_fly", naruto, {})[0];
  assert.deepEqual(plain(step.zones), [2]);
  cmd(c, { actor: naruto.id, skill: "naruto_fly", target: foe.id, picks: { dest: 2 } });
  assert.ok(c.totalHp(foe) < 300);
  assert.equal(naruto.zone, 2, "移动到 2 区");
  S.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  assert.equal(c.skillFlowSteps("naruto_fly", naruto, {}).length, 0, "危墙挡住：没有可去的区");
});

test("燕返：耐久 0 的鳴門不能被带出来", () => {
  const { c, S } = setup(["hiaki", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const h = kit(S, "hiaki"), foe = foesOf(S)[0];
  ready(h, 1); foe.zone = 2; fatten(foe, 300);
  const broken = c.weaponBroken;
  c.weaponBroken = (k) => k === "naruto" || broken(k);                // 鳴門耐久为 0
  const niu = c.spawnWeapon(h, "niu"); ready(niu, 1); niu.level = 2;
  cmd(c, { actor: niu.id, skill: "niu_tsubame", target: foe.id });
  assert.ok(!S.units.some(u => u.kit === "naruto" && !u.hidden), "鳴門没有出场");
  assert.ok(!h.resources.narutoOut);
  assert.equal(h.resources.blade, "niu");
});

/* ---------- 灯 / 年糕 ---------- */

test("圣盾对年糕生效（年糕在场时灯必然空手）；免疫或伤害为 0 时不扣圣盾", () => {
  // 两个敌人：同区只有一个时被决一死战拦着，只打得到灯
  const { c, S } = setup(["tou", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const tou = kit(S, "tou"), foe = foesOf(S)[0];
  ready(tou, 1); foe.zone = 1;
  const mochi = c.spawnWeapon(tou, "mochi"); mochi.zone = 1;
  mochi.layers.forEach(l => { l.current = l.max = 300; });
  assert.equal(tou.weaponHeld, false);
  tou.resources.shield = 0;
  hit(c, foe, mochi, { flat: 40 });
  const plainDmg = 300 - c.totalHp(mochi);
  tou.resources.shield = 2;
  const h0 = c.totalHp(mochi);
  hit(c, foe, mochi, { flat: 40 });
  assert.equal(h0 - c.totalHp(mochi), Math.floor(plainDmg / 2), "伤害减半");
  assert.equal(tou.resources.shield, 1, "年糕挨打用掉 1 圣盾");
  // 免疫：不扣
  tou.weaponHeld = true; c.returnWeapon(mochi);
  tou.layers.forEach(l => { l.current = l.max = 300; });
  tou.resources.standTurn = true;
  hit(c, foe, tou, { flat: 20 });
  assert.equal(tou.resources.shield, 1, "免疫时不扣");
  tou.resources.standTurn = false;
  hit(c, foe, tou, { flat: 0 });
  assert.equal(tou.resources.shield, 1, "伤害为 0 不扣");
});

test("年糕格挡咬住敌人：持续到下一个敌人回合结束", () => {
  const { c, S } = setup(["tou", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const tou = kit(S, "tou"), kolt = kit(S, "kolt"), foe = foesOf(S)[0];
  tou.zone = kolt.zone = foe.zone = 1;
  const mochi = c.spawnWeapon(tou, "mochi"); mochi.zone = 1; mochi.bonus = 1;
  c.endPlayerTurn();                                                  // 敌人回合
  c.performAssistBlock(mochi, kolt, foe, { ok: true, roll: 1 });
  assert.ok(foe.noMove);
  c.endEnemyTurn();                                                   // 这个敌人回合结束
  assert.ok(foe.noMove, "还咬着（下一个敌人回合也不能移动）");
  c.endPlayerTurn(); c.endEnemyTurn();                                // 下一个敌人回合结束
  assert.ok(!foe.noMove, "然后松开");
});

test("声波切割每个目标 1 击破（作者定：不改）；超音波施加的折射能被共振分享", () => {
  const { c, S } = setup(["tou", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_hammer", lv: 1, zone: 1 }]);
  const tou = kit(S, "tou"), [f1, f2] = foesOf(S);
  ready(tou, 1); tou.level = 3; f1.zone = f2.zone = 1; fatten(f1, 300); fatten(f2, 300);
  f1.def = f1.defMax = 9;
  tou.resources.shield = 2;
  cmd(c, { actor: tou.id, skill: "tou_sonic", target: f1.id, picks: { target1: f1.id } });
  assert.ok(c.totalHp(f1) < 300);
  assert.equal(f1.def, 8, "1 击破");
  // 超音波：折射的键是 refract，共振照常分享
  f1.statuses.reso = true; f2.statuses.reso = true;
  ready(tou);
  cmd(c, { actor: tou.id, skill: "tou_ultra", target: f1.id });
  assert.ok(f1.instant.refract);
  assert.ok(f2.instant && f2.instant.refract, "共振把折射分享给另一个");
});

/* ---------- 夕夏 ---------- */

test("背水一战：起身后引擎一直开着，一回合没攻击也不熄火", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const x = kit(S, "xia");
  x.layers.forEach(l => { l.current = 0; });
  x.dying = true; x.shp = x.shpMax = 30;
  c.standUp(x);
  assert.ok(x.upOnShp && x.resources.engine);
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.ok(x.resources.engine, "第一回合没攻击也不熄火");
  c.endPlayerTurn(); c.endEnemyTurn();
  assert.ok(x.resources.engine, "之后也一直开着");
});

test("夕夏濒死或晕眩时不自动碾压", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const x = kit(S, "xia"), foe = foesOf(S)[0];
  x.zone = foe.zone = 1; fatten(foe, 300); foe.def = foe.defMax = 30;
  x.resources.crushId = foe.id;
  x.stunned = true;
  c.beginRound([]);
  assert.equal(c.totalHp(foe), 300, "晕眩时不碾");
  x.stunned = false; x.dying = true;
  c.beginRound([]);
  assert.equal(c.totalHp(foe), 300, "濒死时不碾");
  x.dying = false;
  c.beginRound([]);
  assert.ok(c.totalHp(foe) < 300, "能动的时候照常碾");
});

test("圣战起始、居合普攻、引火烧身的移动不能穿过危墙", () => {
  const { c, S } = setup(["tou", "hiaki"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const tou = kit(S, "tou"), h = kit(S, "hiaki"), foe = foesOf(S)[0];
  S.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  ready(tou, 1); foe.zone = 2; fatten(foe, 300);
  const st = c.skillFlowSteps("tou_start", tou, {});
  assert.deepEqual(plain(st[0].zones), [1], "只能留在本区");
  cmd(c, { actor: tou.id, skill: "tou_start", target: foe.id, picks: { dest: 2, target: foe.id } });
  assert.equal(tou.zone, 1);
  assert.equal(tou.ap, 5);
  ready(h, 1); h.resources.stance = "iai";
  cmd(c, { actor: h.id, skill: "hiaki_aa", target: foe.id });
  assert.equal(h.zone, 1, "居合没有穿墙");
  assert.equal(h.ap, 5);
  assert.equal(c.totalHp(foe), 300);
  // 引火烧身：分步里没有隔着危墙的区；硬选也不扣点
  const { c: c2, S: S2 } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const x = kit(S2, "xia");
  S2.gaps["1-2"] = { type: "wall", hp: 8, maxHp: 8, open: false };
  ready(x, 1); x.level = 6; x.resources.engine = true;
  assert.ok(!c2.skillFlowSteps("xia_selfburn", x, {}).some(s => s.key === "dest"));
  cmd(c2, { actor: x.id, skill: "xia_selfburn", picks: { dest: 2 } });
  assert.equal(x.zone, 1);
  assert.equal(x.ap, 5);
});

test("引火自焚最多 5 层（酷暑 10 层）", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const x = kit(S, "xia");
  x.weaponLevels.berniel = 5; ready(x, 1); x.level = 6;
  assert.ok(c.xiaFuelOn());
  x.resources.engine = true; x.resources.fuel = 5;
  cmd(c, { actor: x.id, skill: "xia_selfburn", picks: { mode: "full" } });
  assert.equal(x.self, "burn");
  assert.equal(x.selfBurnStacks, 5);
});

test("全速撞击先挂震荡再结算这一击（和盾击突进一样）：9/9 → 震荡压到 7/7 → 2 击破 → 5", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 2 }]);
  const x = kit(S, "xia"), foe = foesOf(S)[0];
  ready(x, 1); x.level = 3; x.resources.engine = true;
  foe.zone = 2; fatten(foe, 300); foe.def = foe.defMax = 9;
  cmd(c, { actor: x.id, skill: "xia_ram", target: foe.id, picks: { dest: 2, target: foe.id } });
  assert.equal(foe.defMax, 7, "震荡：上限 −2");
  assert.equal(foe.def, 5, "先震荡 9 → 7，再吃 1 + 移动 1 区 = 2 击破 → 5");
  assert.ok(foe.statuses.shockwave);
});

test("处决：对没晕眩的目标在扣点前拦下", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const x = kit(S, "xia"), foe = foesOf(S)[0];
  ready(x, 1); x.level = 2; x.resources.engine = true; foe.zone = 1;
  S.targetId = foe.id;
  assert.match(c.skillTargetError(x, "xia_execute", foe) || "", /晕眩/);
  cmd(c, { actor: x.id, skill: "xia_execute", target: foe.id });
  assert.equal(x.ap, 5);
});

test("狂怒碾压抓住飞行目标：每回合自动碾压不再收「近程打飞行」的附赠行动（以前抓住期间拿不到附赠 → 每回合 0 伤害、永远松不开）", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const x = kit(S, "xia"), foe = foesOf(S)[0];
  x.zone = foe.zone = 1; fatten(foe, 300); foe.def = foe.defMax = 30; foe.flying = true;
  x.resources.crushId = foe.id; x.bonus = 0;
  c.beginRound([]);
  assert.ok(c.totalHp(foe) < 300, "抓着的时候照常碾到");
  assert.equal(x.resources.crushId, foe.id, "没死没失衡，继续抓着");
});

test("狂怒碾压没碾到（附赠不够打飞行目标）：不会抓住目标；已经抓着却碾不到的也松手，不会卡死", () => {
  const { c, S } = setup(["xia", "kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const x = kit(S, "xia"), foe = foesOf(S)[0];
  x.zone = foe.zone = 1; fatten(foe, 300); foe.def = foe.defMax = 30; foe.flying = true;
  x.bonus = 0;
  const lines = c.crushOnce(x, foe, false);
  assert.equal(c.totalHp(foe), 300);
  assert.ok(!x.resources.crushId, "没碾到就抓不住");
  assert.match(lines.join("\n"), /没能抓住/);
  // 付得起附赠：照常抓住
  x.bonus = 1;
  c.crushOnce(x, foe, false);
  assert.ok(c.totalHp(foe) < 300);
  assert.equal(x.resources.crushId, foe.id);
});
