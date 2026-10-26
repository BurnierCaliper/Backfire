// 柯尔特 / Helumica / 拉斯缪尔 新技能：碎渣重炮、废料计数、转移注意、扭矩酸液炮越墙、探测模式、狂瀑、汲取
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));

function setup(party, lv) {
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "KHR" });
  c.startCombat();
  const S = c.S.state;
  const foes = S.units.filter(u => !u.isPlayer);
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 200, max: 200 }]; f.def = f.defMax = 20; });
  const heroes = S.units.filter(u => u.isPlayer);
  heroes.forEach(h => { h.zone = 1; h.level = lv || 11; h.ap = 3; h.bonus = 2; });
  return { c, S, foes };
}
const pops = c => { const out = []; c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") out.push({ id: u.id, value: spec.value, element: spec.element }); }; return out; };

test("技能解锁等级：碎渣重炮 11、转移注意 4、探测模式 4、狂瀑 11、汲取 4", () => {
  const { c, S } = setup(["kolt", "helu", "ras"], 1);
  const ids = u => c.skillList(u).map(s => s.id);
  const k = c.findKit("kolt", S.units), r = c.findKit("ras", S.units);
  assert.ok(!ids(k).includes("kolt_cannon")); assert.ok(!ids(r).includes("ras_torrent"));
  k.level = 11; r.level = 11;
  assert.ok(ids(k).includes("kolt_cannon")); assert.ok(ids(r).includes("ras_torrent"));
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  const w = c.findKit("torque", S.units); w.level = 4;
  assert.ok(ids(w).includes("torque_divert"));
});

test("废料计数：2 级起显示；累积的敌人血量层 + 腐蚀记录 + 转移注意的装甲", () => {
  const { c, S } = setup(["kolt"], 1);
  const k = c.findKit("kolt", S.units);
  assert.doesNotMatch(c.resourceText(k), /废料/);
  k.level = 2;
  k.resources.scrapStore = { armor: 4, flesh: 3 };
  k.resources.rotStore = { flesh: 3 };
  k.resources.divertArmor = 2;
  assert.equal(c.koltScrapTotal(k), 12);
  assert.match(c.resourceText(k), /废料 12/);
  // 仪表：hud-icons.js 在浏览器里从 window 上拿 koltScrapTotal，这里把它挂到 globalThis 上模拟
  const HI = require("../hud-icons.js");
  globalThis.koltScrapTotal = c.koltScrapTotal;
  try {
    const hud = HI.gaugeState(k, S.units);
    assert.equal(hud.scrap, 12); assert.equal(hud.showScrap, true);
    assert.match(HI.gauge(hud), /废料/);
  } finally { delete globalThis.koltScrapTotal; }
});

test("碎渣重炮（电钻机枪）：选区域，子弹随机打该区敌人；每颗独立掷骰，剩余也打一发，每 2 颗 1 击破；每颗都嘲讽", () => {
  const { c, S, foes } = setup(["kolt"]);
  const k = c.findKit("kolt", S.units);
  k.resources.bit = "drill";
  const zones = c.skillFlowSteps("kolt_cannon", k, {}).find(s => s.key === "dest").zones;
  assert.ok(zones.includes(1) && zones.includes(2));
  k.resources.scrapStore = {}; k.resources.rotStore = { flesh: 40 };   // 废料从腐蚀记录来（敌人血量层来的废料算进合计时封顶为生命上限一半）
  const p = pops(c);
  const defs0 = foes.map(f => f.def);
  cmd(c, { actor: k.id, skill: "kolt_cannon", picks: { dest: 1 } });
  assert.ok(p.length >= 3, "好几颗子弹");
  assert.ok(p.every(x => x.element === "electric"));
  assert.ok(p.every(x => x.id === foes[0].id || x.id === foes[1].id), "只打 1 区");
  assert.ok(new Set(p.slice(0, 2).map(x => x.id)).size === 2, "前两颗先把区里两个敌人各打一次");
  assert.equal(c.koltScrapTotal(k), 0, "废料用光");
  const broke = defs0.reduce((s, d, i) => s + d - foes[i].def, 0);
  assert.equal(broke, Math.floor(p.length / 2));
  new Set(p.map(x => x.id)).forEach(id => assert.equal(S.units.find(u => u.id === id).tauntTo, k.id, "每颗都是单体攻击：被嘲讽"));
  assert.equal(k.ap, 2);
});

test("碎渣重炮（电钻）：隔墙的区域不能选", () => {
  const { c, S } = setup(["kolt"]);
  const k = c.findKit("kolt", S.units);
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10, level: 1 });
  const zones = c.skillFlowSteps("kolt_cannon", k, {}).find(s => s.key === "dest").zones;
  assert.ok(!zones.includes(2));
});

test("碎渣重炮（酸液迫击炮）：距离 1-2、越墙；废料量的酸 + 2 击破，同区 1/3 溅射，掉血超 25% 再 +2 击破；主目标被嘲讽", () => {
  const { c, S, foes } = setup(["kolt"]);
  const k = c.findKit("kolt", S.units);
  k.resources.bit = "acid";
  foes[0].zone = 2;   // 2 区两个敌人
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10, level: 1 });
  const ids = c.skillFlowSteps("kolt_cannon", k, {}).find(s => s.key === "target").units.map(u => u.id);
  assert.deepEqual(plain(ids).sort(), [foes[0].id, foes[2].id].sort(), "同区的打不了，只有距离 1-2 的敌人");
  {
    const mode0 = S.zoneMode;
    S.zoneMode = 3;
    const far = foes[1]; far.zone = 3;
    assert.equal(c.zoneDist(1, 3, 3), 2);
    assert.ok(c.skillFlowSteps("kolt_cannon", k, {}).find(s => s.key === "target").units.some(u => u.id === far.id), "距离 2 也能选");
    assert.equal(c.skillTargetError(k, "kolt_cannon", far), null);
    far.zone = 1; S.zoneMode = mode0;
  }
  k.resources.scrapStore = {}; k.resources.rotStore = { flesh: 90 };   // 废料从腐蚀记录来（敌人血量层来的废料算进合计时封顶为生命上限一半）
  const p = pops(c);
  const def0 = foes[2].def;
  cmd(c, { actor: k.id, skill: "kolt_cannon", target: foes[2].id, picks: { target: foes[2].id } });
  const main = p.filter(x => x.id === foes[2].id);
  assert.ok(main.length && main[0].element === "acid", "隔着墙也打到");
  assert.equal(foes[2].def, def0 - 4, "掉血超过上限 25%：2 + 2 击破");
  assert.equal(foes[2].tauntTo, k.id, "主目标被嘲讽");
  const sp = p.filter(x => x.id === foes[0].id);
  assert.ok(sp.length && sp[0].value < main[0].value, "同区溅射");
  assert.notEqual(foes[0].tauntTo, k.id, "溅射是范围伤害，不嘲讽");
  assert.equal(c.koltScrapTotal(k), 0);
});

test("扭矩酸液炮蓄力越过危墙", () => {
  const { c, S, foes } = setup(["kolt"]);
  const k = c.findKit("kolt", S.units);
  k.resources.bit = "acid";
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  const w = c.findKit("torque", S.units);
  w.zone = 1; w.ap = 3;
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10, level: 1 });
  w.resources.acidCharge = 2;
  const hp0 = foes[2].layers[0].current;
  const notes = [];
  c.releaseAcidCharges(notes);
  assert.ok(foes[2].layers[0].current < hp0, notes.join("\n"));
});

test("转移注意：被嘲讽的改打扭矩；自保减伤 25%、架势不低于 1；下回合开始变回武器，失去的装甲记为废料，废物利用额外拿装甲", () => {
  const { c, S, foes } = setup(["kolt"]);
  const k = c.findKit("kolt", S.units);
  cmd(c, { actor: k.id, skill: "kolt_summon" });
  const w = c.findKit("torque", S.units);
  w.zone = 1; w.ap = 3; w.level = 4;
  foes[0].tauntTo = k.id;
  cmd(c, { actor: w.id, skill: "torque_divert" });
  assert.equal(foes[0].tauntTo, w.id);
  assert.ok(w.resources.divertGuard);
  const notes = [];
  c.dealBreak(w, 99, "physical", notes, "测试");
  assert.equal(w.def, 1, "架势不低于 1");
  const armor = w.layers.find(l => l.type === "armor");
  armor.current -= 5;
  c.beginRound([]);
  assert.ok(w.hidden, "变回武器");
  assert.equal(k.resources.divertArmor, 5);
  k.ap = 3; k.level = 2;
  k.resources.scrapStore = {};
  const before = k.layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);
  cmd(c, { actor: k.id, skill: "kolt_scrap" });
  const after = k.layers.filter(l => l.type === "armor").reduce((s, l) => s + l.current, 0);
  assert.equal(after - before, 5);
});

test("Ecmo 探测模式：移动不耗附赠；回合开始扫描所在区；变回武器触发经过的每个区一个配置物", () => {
  const { c, S } = setup(["helu"]);
  const h = c.findKit("helu", S.units);
  cmd(c, { actor: h.id, skill: "helu_summon" });
  const e = c.findKit("ecmo", S.units);
  e.zone = 1; e.ap = 3; e.bonus = 1; e.level = 4;
  cmd(c, { actor: e.id, skill: "ecmo_probe" });
  assert.ok(e.resources.probe);
  const props0 = (S.props || []).length;
  c.beginRound([]);
  assert.equal((S.props || []).length, props0 + 1, "回合开始扫描出一个配置物");
  const bonus = e.bonus;
  c.Commands.dispatch({ type: "move", actor: e.id, dest: 2 });
  assert.equal(e.zone, 2, "移动成功");
  assert.equal(e.bonus, bonus, "不耗附赠");
  // 1 区放个爆炸桶，2 区也放一个
  S.props.push(c.makeProp("boom", 1, 1), c.makeProp("boom", 2, 1));
  const n0 = S.props.length;
  e.zone = 1;
  c.returnWeapon(e);
  assert.ok(S.props.length <= n0 - 2, "两个区各触发一个");
  assert.equal(e.resources.probe, false);
});

test("狂瀑：要高能目标；累积到 100%，每 20% 0.2atk 能量、自己掉 10% 血量", () => {
  const { c, S, foes } = setup(["ras"]);
  const r = c.findKit("ras", S.units);
  assert.match(c.skillTargetError(r, "ras_torrent", foes[0]) || "", /高能/);
  foes[0].statuses = { high: true };
  r.resources.energyPct = 40;
  const hp0 = c.totalHp(r), mx = c.totalMaxHp(r);
  const p = pops(c);
  cmd(c, { actor: r.id, skill: "ras_torrent", target: foes[0].id });
  assert.equal(p.filter(x => x.id === foes[0].id && x.element === "energy").length, 3);
  assert.equal(r.resources.energyPct, 100);
  assert.equal(hp0 - c.totalHp(r), 3 * Math.ceil(mx * 0.1));
});

test("汲取：拉斯缪尔回合结束转 20% 能量为光能；EDC 变回武器；生效中再用免费并结束", () => {
  const { c, S } = setup(["ras"]);
  const r = c.findKit("ras", S.units);
  cmd(c, { actor: r.id, skill: "ras_summon" });
  const e = c.findKit("edc", S.units);
  e.zone = 1; e.ap = 3; e.level = 4;
  cmd(c, { actor: e.id, skill: "edc_siphon" });
  assert.ok(r.resources.siphon);
  assert.ok(e.hidden, "变回武器");
  assert.equal(e.ap, 2);
  r.resources.energyPct = 60; r.resources.light = 0;
  c.endPlayerTurn();
  assert.equal(r.resources.energyPct, 40);
  assert.ok(r.resources.light > 0);
  assert.deepEqual(plain(c.skillCost("edc_siphon")), {});
});

test("柯尔特电钻普攻削弱：0.3 / 0.3 / 0.4 ×atk 三段电击，共 2 击破", () => {
  const { c, S, foes } = setup(["kolt"], 1);
  const k = c.findKit("kolt", S.units);
  k.resources.bit = "drill";
  k.atk = 10;
  foes[0].layers = [{ type: "flesh", current: 200, max: 200 }];
  const p = pops(c);
  const def0 = foes[0].def;
  cmd(c, { actor: k.id, skill: "kolt_aa", target: foes[0].id });
  const hits = p.filter(x => x.id === foes[0].id);
  assert.equal(hits.length, 3);
  const atk = c.effectiveAtk(k, S.units);
  assert.deepEqual(hits.map(x => x.value), [Math.floor(atk * 0.3), Math.floor(atk * 0.3), Math.floor(atk * 0.4)]);
  assert.equal(foes[0].def, def0 - 2);
});

test("废料计数：敌人失去血量层得来的废料算进合计时不超过柯尔特生命上限的一半（腐蚀记录、转移注意的装甲另算）", () => {
  const { c, S } = setup(["kolt"], 1);
  const k = c.findKit("kolt", S.units);
  k.level = 2;
  const cap = Math.floor(c.baseMaxHp(k) * 0.5);
  k.resources.scrapStore = { armor: cap * 3 };
  k.resources.rotStore = {}; k.resources.divertArmor = 0;
  assert.equal(c.koltScrapTotal(k), cap, "累积得再多也封顶为生命上限一半");
  k.resources.rotStore = { flesh: 3 };
  assert.equal(c.koltScrapTotal(k), cap + 3);
  k.resources.scrapStore = { armor: cap - 1 };
  k.resources.rotStore = {};
  assert.equal(c.koltScrapTotal(k), cap - 1, "不到上限照实算");
});

test("碎渣重炮（电钻机枪）扫射同区的飞行敌人：整轮只额外付 1 附赠行动；付不起就这一轮不打飞行的，子弹不作废", () => {
  for (const bonus of [3, 0]) {
    const c = H.load();
    c.BattleSim.setup({ party: ["kolt", "yuito"], enemies: [{ id: "crow", lv: 5, zone: 1 }, { id: "crow", lv: 5, zone: 1 }, { id: "thug_knife", lv: 5, zone: 1 }], seed: "KCFLY" });
    c.startCombat();
    const S = c.S.state, k = c.findKit("kolt", S.units);
    k.level = 10; k.zone = 1; k.resources.bit = "drill"; k.ap = 3; k.bonus = bonus;
    const foes = S.units.filter(u => !u.isPlayer);
    foes.forEach(u => { u.zone = 1; u.layers.forEach(l => { l.current = l.max = 999; }); });
    k.resources.scrapStore = {}; k.resources.rotStore = { flesh: 60 };
    const hp0 = foes.map(u => c.totalHp(u));
    c.Commands.dispatch(JSON.parse(JSON.stringify({ type: "skill", actor: k.id, skill: "kolt_cannon", target: null, picks: { dest: 1 } })));
    const lost = foes.map((u, i) => hp0[i] - c.totalHp(u));
    if (bonus) {
      assert.equal(k.bonus, bonus - 1, "两只飞行的都挨了子弹，也只付 1 次");
      assert.ok(lost[0] > 0 && lost[1] > 0, "两只飞行的都打到了");
    } else {
      assert.equal(k.bonus, 0);
      assert.equal(lost[0] + lost[1], 0, "付不起：不打飞行的");
      assert.ok(lost[2] >= 60, "60 点废料全部打在地面的狂徒身上");
    }
  }
});
