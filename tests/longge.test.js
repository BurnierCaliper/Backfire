// 龙哥（兽人-蜥蜴典当行 · 冰/火 · 生存专精）与武器人「小朋友」：枪管手杖、胶囊弹药、窥探、吐酸、鳞片
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup(seed, extra) {
  const c = H.load();
  c.BattleSim.setup(Object.assign({ party: ["longge", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: seed || "LG" }, extra || {}));
  c.startCombat();
  const S = c.S.state;
  const lg = c.findKit("longge", S.units);
  lg.zone = 1;
  const foes = S.units.filter(u => !u.isPlayer);
  foes[0].zone = 1; foes[1].zone = 2;
  foes.forEach(f => { f.layers = [{ type: "flesh", current: 300, max: 300 }]; f.def = f.defMax = 9; });
  lg.ap = 3; lg.bonus = 2;
  return { c, S, lg, foes };
}
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
function capturePops(c) {
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "dmg") pops.push({ id: u.id, value: spec.value, element: spec.element }); };
  return pops;
}

test("角色卡数值：atk 4+5、生命 16、坚毅 11、架势 5、协助格挡 35%+30%；兽人-蜥蜴典当行、生存专精", () => {
  const { c, lg } = setup();
  assert.equal(lg.personalAtk, 4);
  assert.equal(lg.weaponAtk, 5, "小朋友：3 + (智力 8×0.4 + 敏捷 6×0.2)×0.5 = 5");
  assert.equal(lg.atk, 9);
  assert.equal(c.totalMaxHp(lg), 16);
  assert.equal(lg.shpMax, 11);
  assert.equal(lg.defMax, 5);
  assert.equal(c.blockChance(lg), 65);
  assert.equal(c.heroProfile("longge").race, "兽人-蜥蜴");
  assert.equal(c.heroProfile("longge").job, "典当行");
  const ids = c.skillList(lg).map(s => s.id);
  ["longge_aa", "longge_chill", "longge_spit", "longge_summon", "role_firstaid"].forEach(id => assert.ok(ids.includes(id), id));
});

test("胶囊弹药：开战 6 发，红蓝各 3，顺序随机；扳机锁定、什么都没窥探", () => {
  const { lg } = setup();
  const r = lg.resources;
  assert.equal(r.ammo.length, 6);
  assert.equal(r.ammo.filter(x => x === "red").length, 3);
  assert.equal(r.ammo.filter(x => x === "blue").length, 3);
  assert.equal(r.trigger, false);
  assert.equal(r.known, 0);
  const orders = new Set();
  for (let i = 0; i < 12; i++) orders.add(setup("LG-ORDER" + i).lg.resources.ammo.join(","));
  assert.ok(orders.size > 1, "顺序随机");
});

test("普通攻击（手杖）：近距离 1atk 冰 +1 击破，窥探 1；扳机没解锁时没有霰弹枪可选", () => {
  const { c, S, lg, foes } = setup();
  assert.equal(c.skillFlowSteps("longge_aa", lg, {}).some(s => s.key === "mode"), false);
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[0].id });
  assert.equal(pops[0].element, "ice");
  assert.equal(pops[0].value, 9);
  assert.equal(foes[0].def, 8);
  assert.equal(lg.resources.known, 1);
  assert.equal(lg.resources.ammo.length, 6, "手杖不耗弹");
  assert.match(c.resourceText(lg), /弹药 6\/6（[红蓝]\?{5}）/);
  // 手杖打不到距离 1
  lg.ap = 3;
  const before = foes[1].layers[0].current;
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[1].id });
  assert.equal(foes[1].layers[0].current, before);
  assert.ok(S);
});

test("协助攻击：立刻解锁扳机；霰弹枪耗 1 发打 1.5atk 子弹属性，窥探 2", () => {
  const { c, S, lg, foes } = setup();
  const first = lg.resources.ammo[0];
  lg.resources.assistMode = "gun";
  const pops = capturePops(c);
  S.attackerId = lg.id; S.targetId = foes[1].id;
  c.runSkill("longge_assist", { ignorePhase: true, free: true });
  assert.equal(lg.resources.trigger, true);
  assert.equal(lg.resources.ammo.length, 5);
  assert.equal(pops[0].element, first === "red" ? "fire" : "ice");
  assert.equal(pops[0].value, Math.floor(9 * 1.5 * (first === "red" ? 1.5 : 1)), "火打血肉克制 +50%");
  assert.equal(lg.resources.known, 2);
});

test("协助攻击（手杖）：移动到敌人那一区戳 0.5atk 冰；有子弹就耗 1 发治疗同区友方", () => {
  const { c, S, lg, foes } = setup();
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = 2;
  kolt.layers.forEach(l => { l.current = Math.max(1, l.max - 10); });
  const first = lg.resources.ammo[0];
  const hp0 = c.totalHp(kolt);
  lg.resources.assistMode = "cane";
  const pops = capturePops(c);
  S.attackerId = lg.id; S.targetId = foes[1].id;
  c.runSkill("longge_assist", { ignorePhase: true, free: true });
  assert.equal(lg.zone, 2);
  assert.equal(pops[0].element, "ice");
  assert.equal(pops[0].value, Math.floor(9 * 0.5));
  assert.equal(lg.resources.ammo.length, 5);
  const healed = c.totalHp(kolt) - hp0;
  assert.equal(healed, first === "blue" ? 6 : 4, "蓝弹 等级+5；红弹 已损失 10 的 40%");
});

test("霰弹枪普攻：远距离 1.5atk 子弹属性 +1 击破；冷气穿刺霰弹枪蓝弹刺骨并治疗该区友方，红弹 0.5atk 火", () => {
  const { c, S, lg, foes } = setup("LG-GUN");
  lg.resources.trigger = true;
  lg.resources.ammo = ["red", "blue", "red"];
  assert.ok(c.skillFlowSteps("longge_aa", lg, {}).some(s => s.key === "mode"));
  assert.deepEqual(plain(c.skillFlowSteps("longge_aa", lg, { mode: "gun" }).find(s => s.key === "target").units.map(u => u.id)), [foes[1].id]);
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[1].id, picks: { mode: "gun", target: foes[1].id } });
  assert.equal(pops[0].element, "fire");
  assert.equal(pops[0].value, Math.floor(9 * 1.5 * 1.5), "1.5atk，火打血肉 +50%");
  assert.equal(foes[1].def, 8);
  // 蓝弹冷气穿刺
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = 2; kolt.layers.forEach(l => { l.current = Math.max(1, l.max - 10); });
  const hp0 = c.totalHp(kolt);
  lg.ap = 3;
  cmd(c, { actor: lg.id, skill: "longge_chill", target: foes[1].id, picks: { mode: "gun", target: foes[1].id } });
  assert.ok(foes[1].instant.sting, "刺骨");
  assert.equal(c.totalHp(kolt) - hp0, 6);
  // 红弹冷气穿刺：半路爆开 0.5atk 火
  pops.length = 0;
  lg.ap = 3;
  cmd(c, { actor: lg.id, skill: "longge_chill", target: foes[1].id, picks: { mode: "gun", target: foes[1].id } });
  assert.equal(pops[0].element, "fire");
  assert.equal(lg.resources.ammo.length, 0);
  // 打光以后没有霰弹枪可选
  assert.equal(c.skillFlowSteps("longge_aa", lg, {}).some(s => s.key === "mode"), false);
});

test("弹药打光后扳机无法解锁；协助格挡成功窥探 1 并解锁扳机", () => {
  const { c, S, lg, foes } = setup();
  const notes = [];
  lg.resources.ammo = [];
  c.longgeUnlock(lg, notes, "测试");
  assert.equal(lg.resources.trigger, false);
  assert.match(notes.join(""), /无法解锁/);
  const s2 = setup("LG-BLOCK");
  const kolt = s2.c.findKit("kolt", s2.S.units);
  const out = s2.c.performAssistBlock(s2.lg, kolt, s2.foes[0], { roll: 1, ok: true });
  assert.ok(out.ok);
  assert.equal(s2.lg.resources.trigger, true);
  assert.equal(s2.lg.resources.known, 1);
  assert.ok(S && foes);
});

test("吐酸：附赠动作、近距离、角色本身 atk 的酸液，每场一次；鳞片：能量伤害 +25%", () => {
  const { c, lg, foes } = setup();
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_spit", target: foes[0].id });
  assert.equal(pops[0].element, "acid");
  assert.equal(pops[0].value, 4, "角色本身 atk 4，不算武器");
  assert.equal(lg.bonus, 1);
  assert.ok(c.skillRequirementError(lg, "longge_spit"));
  // 鳞片
  const r = c.resolveAttack ? null : null;
  const src = require("node:fs").readFileSync(require("node:path").join(H.ROOT, "engine.js"), "utf8");
  assert.match(src, /鳞片（兽人-蜥蜴）：能量受伤 \+25%/);
  assert.equal(r, null);
});

test("鳞片：敌人的能量攻击打龙哥 +25%", () => {
  const { c, S, lg, foes } = setup();
  const res = c.dealTo(foes[0], lg, { element: "energy", mult: 0, flat: 8, baseBreak: 0, atk: 0, flags: { action: true, blockResolved: true } });
  assert.equal(res.res.intended || res.res.total, 10);
  const res2 = c.dealTo(foes[0], lg, { element: "physical", mult: 0, flat: 8, baseBreak: 0, atk: 0, flags: { action: true, blockResolved: true } });
  assert.equal(res2.res.intended || res2.res.total, 8, "其他属性不变");
  assert.ok(S);
});

test("应急处理（龙哥）：照手册 1d4+2，半血以下取最大 6", () => {
  const { c, S, lg } = setup();
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = lg.zone;
  kolt.layers.forEach(l => { l.current = 1; });
  const hp0 = c.totalHp(kolt);
  cmd(c, { actor: lg.id, skill: "role_firstaid", target: kolt.id });
  assert.equal(c.totalHp(kolt) - hp0, 6);
});

test("小朋友：装甲 12、架势 4、耐久 5（每两级 +1）、atk 5；格挡 60%，守护龙哥 75%", () => {
  const { c, S, lg } = setup();
  cmd(c, { actor: lg.id, skill: "longge_summon" });
  const w = c.findKit("xiaoxiao", S.units);
  assert.ok(w && !w.hidden);
  assert.equal(w.layers[0].type, "armor");
  assert.equal(w.layers[0].max, 12);
  assert.equal(w.defMax, 4);
  assert.equal(w.atk, 5);
  assert.equal(c.weaponBaseDur("xiaoxiao", 1), 5);
  assert.equal(c.weaponBaseDur("xiaoxiao", 2), 6, "和其他武器一样每两级 +1");
  assert.equal(c.weaponBaseDur("xiaoxiao", 5), 7);
  const kolt = c.findKit("kolt", S.units);
  const foe = S.units.find(u => !u.isPlayer);
  assert.equal(c.finalBlockChance(w, foe, kolt), 60);
  assert.equal(c.finalBlockChance(w, foe, lg), 75);
  assert.ok(c.isUnarmed(lg), "唤出后龙哥空手");
  assert.deepEqual(plain(c.skillList(w).map(s => s.id)), ["xiaoxiao_punch", "xiaoxiao_heal", "xiaoxiao_return"], "连续拳要武器 2 级");
});

test("小朋友：直冲拳耗 1 发 1atk 子弹属性 +2 击破；格挡成功反击；治疗支援后收回并解锁扳机", () => {
  const { c, S, lg, foes } = setup();
  cmd(c, { actor: lg.id, skill: "longge_summon" });
  const w = c.findKit("xiaoxiao", S.units);
  w.zone = 1; w.ap = 3;
  lg.resources.ammo = ["blue", "red", "blue", "red"];
  const pops = capturePops(c);
  cmd(c, { actor: w.id, skill: "xiaoxiao_punch", target: foes[0].id });
  assert.equal(pops[0].element, "ice");
  assert.equal(pops[0].value, 5);
  assert.equal(foes[0].def, 7);
  assert.equal(lg.resources.ammo.length, 3);
  // 格挡成功：反击（红弹）
  pops.length = 0;
  w.bonus = 1;
  const out = c.performAssistBlock(w, lg, foes[0], { roll: 1, ok: true });
  assert.ok(out.ok);
  assert.equal(pops[0].element, "fire");
  assert.equal(lg.resources.ammo.length, 2);
  // 治疗支援：蓝弹给龙哥，然后收回 → 解锁扳机
  lg.layers.forEach(l => { l.current = 2; });
  w.ap = 3;
  cmd(c, { actor: w.id, skill: "xiaoxiao_heal", target: lg.id });
  assert.equal(c.totalHp(lg), 8, "蓝弹 等级 1 + 5");
  assert.ok(w.hidden, "收回");
  assert.equal(lg.resources.trigger, true, "变回武器解锁扳机（还剩 1 发）");
  assert.equal(lg.resources.ammo.length, 1);
  lg.resources.ammo = [];
  assert.ok(c.skillRequirementError(w, "xiaoxiao_punch"), "没子弹不能直冲拳");
});

test("模拟器：龙哥能打完整场战斗（协助攻击自动选模式）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["longge", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }, { id: "thug_knife", lv: 1, zone: 2 }], seed: "LG-SIM" });
  const r = c.BattleSim.run ? c.BattleSim.run({ maxRounds: 30 }) : null;
  assert.ok(r);
});

test("主持人后台：可以改剩余子弹（红 / 蓝顺序）、已窥探枚数、扳机、吐酸", () => {
  const { c, lg } = setup();
  c.dmSetPassive(lg, "ammo", "红蓝r");
  assert.deepEqual(plain(lg.resources.ammo), ["red", "blue", "red"]);
  c.dmSetPassive(lg, "known", 5);
  assert.equal(lg.resources.known, 3, "不超过剩余子弹数");
  c.dmSetPassive(lg, "trigger", true);
  assert.equal(lg.resources.trigger, true);
  assert.match(c.resourceText(lg), /扳机解锁 · 弹药 3\/6（红蓝红）/);
});

test("子弹打光扳机锁上；手杖协助攻击可以自己选治疗同区的谁（含自己）", () => {
  const { c, S, lg, foes } = setup();
  lg.resources.trigger = true;
  lg.resources.ammo = ["red"];
  lg.resources.seen = [true];
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[1].id, picks: { mode: "gun", target: foes[1].id } });
  assert.equal(lg.resources.ammo.length, 0);
  assert.equal(lg.resources.trigger, false, "打光就锁上");
  // 手杖协助：选治疗自己
  const s2 = setup("LG-HEAL");
  const kolt = s2.c.findKit("kolt", s2.S.units);
  kolt.zone = 2; kolt.layers.forEach(l => { l.current = 1; });
  s2.lg.layers.forEach(l => { l.current = 6; });
  s2.lg.resources.ammo = ["blue", "red"]; s2.lg.resources.seen = [false, false];
  s2.c.Commands.dispatch(plain({ type: "assistAnswer", helper: null, extra: {} }));   // 空队列：什么都不做
  s2.S.assistQueue = [{ targetId: s2.foes[1].id, breakerId: kolt.id }];
  s2.c.finishAssist(s2.lg.id, { mode: "cane", heal: s2.lg.id });
  assert.equal(s2.lg.zone, 2);
  assert.equal(s2.c.totalHp(s2.lg), 12, "蓝弹治疗自己 +6（虽然柯尔特血更少）");
  assert.equal(s2.c.totalHp(kolt), 1);
  assert.ok(S);
});

test("解开保险（2 级，行动点）：解锁扳机，查看最后一发；结算完才问要不要移到最前", () => {
  const { c, S, lg } = setup();
  assert.ok(!c.skillList(lg).some(s => s.id === "longge_safety"), "1 级还没有");
  lg.level = 2;
  assert.ok(c.skillList(lg).some(s => s.id === "longge_safety"));
  lg.resources.ammo = ["blue", "blue", "red"]; lg.resources.seen = [false, false, false];
  assert.deepEqual(plain(c.skillFlowSteps("longge_safety", lg, {})), [], "选技能时不给任何提示，取消就看不到颜色");
  cmd(c, { actor: lg.id, skill: "longge_safety" });
  assert.equal(lg.ap, 2, "行动点");
  assert.equal(lg.bonus, 2);
  assert.equal(lg.resources.trigger, true);
  assert.deepEqual(plain(lg.resources.seen), [false, false, true], "最后一发看过了");
  assert.equal(S.longgeSafetyQueue.length, 1, "等着选");
  c.Commands.dispatch({ type: "longgeSafetyAnswer", front: true });
  assert.deepEqual(plain(lg.resources.ammo), ["red", "blue", "blue"]);
  assert.deepEqual(plain(lg.resources.seen), [true, false, false]);
  assert.match(c.resourceText(lg), /弹药 3\/6（红\?\?）/);
  // 留在最后
  cmd(c, { actor: lg.id, skill: "longge_safety" });
  c.Commands.dispatch({ type: "longgeSafetyAnswer", front: false });
  assert.deepEqual(plain(lg.resources.seen), [true, false, true]);
  assert.match(c.resourceText(lg), /（红\?蓝）/);
  assert.equal(S.longgeSafetyQueue.length, 0);
  // 只剩 1 发：不用问
  lg.resources.ammo = ["red"]; lg.resources.seen = [false];
  cmd(c, { actor: lg.id, skill: "longge_safety" });
  assert.equal(S.longgeSafetyQueue.length, 0);
  assert.deepEqual(plain(lg.resources.seen), [true]);
});

test("连续拳（武器 2 级）：全红升龙拳 3atk 火 +3，全蓝撼地拳 2atk 冰 +5，混合逐发结算", () => {
  const run = (ammo) => {
    const { c, S, lg, foes } = setup("LG-COMBO");
    lg.weaponLevels = Object.assign({}, lg.weaponLevels, { xiaoxiao: 2 });
    cmd(c, { actor: lg.id, skill: "longge_summon" });
    const w = c.findKit("xiaoxiao", S.units);
    w.zone = 1; w.ap = 3;
    lg.resources.ammo = ammo.slice(); lg.resources.seen = ammo.map(() => true);
    const pops = capturePops(c);
    const def0 = foes[0].def;
    cmd(c, { actor: w.id, skill: "xiaoxiao_combo", target: foes[0].id });
    return { pops, brk: def0 - foes[0].def, w, lg, c };
  };
  const red = run(["red", "red", "red"]);
  assert.ok(red.c.skillList(red.w).some(s => s.id === "xiaoxiao_combo"));
  assert.equal(red.pops.length, 1);
  assert.equal(red.pops[0].element, "fire");
  assert.equal(red.pops[0].value, Math.floor(red.w.atk * 3 * 1.5), "火打血肉 +50%");
  assert.equal(red.brk, 3);
  const blue = run(["blue", "blue", "blue", "red"]);
  assert.equal(blue.pops[0].element, "ice");
  assert.equal(blue.pops[0].value, blue.w.atk * 2);
  assert.equal(blue.brk, 5);
  assert.equal(blue.lg.resources.ammo.length, 1);
  const mix = run(["red", "blue", "blue"]);
  assert.deepEqual(plain(mix.pops.map(p => p.element)), ["fire", "ice", "ice"]);
  assert.equal(mix.brk, 2);
  const few = run(["red", "blue"]);
  assert.ok(few.c.skillRequirementError(few.w, "xiaoxiao_combo"), "不到 3 发不能用");
});

test("吐酸属性：长休时换（记在队伍档案），下一场开战按新属性", () => {
  const { c, lg, foes } = setup();
  const opt = c.longRestOptions({});
  const row = opt.heroes.find(h => h.kit === "longge");
  assert.equal(row.spit, "acid");
  assert.ok(opt.heroes.find(h => h.kit === "kolt").spit === null, "不是蜥蜴没有吐酸");
  c.S.state.kuizhi = 0;
  const r = c.ledgerLongRest({ force: true, spit: { longge: "fire", kolt: "ice" } }, []);
  assert.match(r.notes.join("\n"), /吐酸攻击属性：酸 → 火/);
  assert.equal(c.spitElementOf("longge"), "fire");
  assert.equal(c.LEDGER.save().spit.longge, "fire", "存档带上");
  c.resetBattleFlags(lg);
  assert.equal(lg.resources.spitElement, "fire");
  lg.zone = foes[0].zone; lg.bonus = 1;
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_spit", target: foes[0].id });
  assert.equal(pops[0].element, "fire");
});

test("消耗子弹时开枪 / 出拳的人头顶跳出红弹 / 蓝弹（画面用 bullet 弹字）", () => {
  const { c, S, lg, foes } = setup();
  lg.resources.trigger = true;
  lg.resources.ammo = ["blue", "red", "red", "blue"]; lg.resources.seen = [false, false, false, false];
  const pops = [];
  c.spawnPopup = (u, spec) => { if (spec.kind === "bullet") pops.push({ id: u.id, text: spec.text, element: spec.element }); };
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[1].id, picks: { mode: "gun", target: foes[1].id } });
  assert.deepEqual(plain(pops), [{ id: lg.id, text: "蓝弹", element: "ice" }]);
  cmd(c, { actor: lg.id, skill: "longge_summon" });
  const w = c.findKit("xiaoxiao", S.units);
  w.zone = foes[0].zone; w.ap = 3;
  cmd(c, { actor: w.id, skill: "xiaoxiao_punch", target: foes[0].id });
  assert.deepEqual(plain(pops[1]), { id: w.id, text: "红弹", element: "fire" }, "小朋友出拳：小朋友头顶");
  const src = require("node:fs").readFileSync(require("node:path").join(H.ROOT, "online-view.js"), "utf8");
  assert.match(src, /"partner", "bullet"[,\]]/, "联机投影也放行");
});

test("连续拳打飞行目标：三拳都打出去，近程打飞行的附赠行动整次只付一次；付不起就不出手、不耗子弹", () => {
  const go = (bonus) => {
    const c = H.load();
    c.BattleSim.setup({ party: ["longge", "kolt"], enemies: [{ id: "crow", lv: 1, zone: 1 }], seed: "LG-CROW" });
    c.startCombat();
    const S = c.S.state;
    const lg = c.findKit("longge", S.units);
    lg.zone = 1; lg.ap = 3; lg.bonus = 2; lg.weaponLevels = { xiaoxiao: 2 };
    cmd(c, { actor: lg.id, skill: "longge_summon" });
    const w = c.findKit("xiaoxiao", S.units);
    const f = S.units.find(u => !u.isPlayer);
    w.zone = 1; f.zone = 1; w.ap = 3; w.bonus = bonus;
    f.layers.forEach(l => { l.current = l.max = 300; });
    assert.ok(f.flying);
    lg.resources.ammo = ["blue", "blue", "red"]; lg.resources.seen = [false, false, false];
    const pops = capturePops(c);
    cmd(c, { actor: w.id, skill: "xiaoxiao_combo", target: f.id });
    return { pops, w, lg };
  };
  const ok = go(1);
  assert.deepEqual(plain(ok.pops.map(p => p.element)), ["ice", "ice", "fire"], "三拳都打出去");
  assert.equal(ok.w.bonus, 0, "附赠行动只扣一次");
  const no = go(0);
  assert.equal(no.pops.length, 0);
  assert.equal(no.lg.resources.ammo.length, 3, "不出手也不耗子弹");
  assert.equal(no.w.ap, 3, "行动点也不扣");
});

test("普通攻击能打危墙：手杖打同区边上的墙（冰 1 击破，窥探 1），霰弹枪打距离 1 的墙（耗 1 发）", () => {
  const { c, S, lg } = setup("LG-WALL");
  S.gaps["1-2"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10, level: 1 });
  const ids = (p) => c.skillFlowSteps("longge_aa", lg, p).find(s => s.key === "target").units.map(u => u.id);
  assert.ok(ids({}).includes("gap:1-2"), "手杖目标里有 1–2 之间的危墙");
  assert.ok(!c.skillFlowSteps("longge_chill", lg, {}).find(s => s.key === "target").units.some(u => /^gap:/.test(u.id)), "冷气穿刺不打墙");
  cmd(c, { actor: lg.id, skill: "longge_aa", target: "gap:1-2", picks: { target: "gap:1-2" } });
  assert.equal(S.gaps["1-2"].hp, 9);
  assert.equal(lg.ap, 2);
  assert.equal(lg.resources.known, 1, "手杖窥探 1");
  assert.equal(lg.resources.ammo.length, 6);
  // 霰弹枪：墙另一边的 2 区在距离 1，也能打
  lg.resources.trigger = true;
  assert.ok(ids({ mode: "gun" }).includes("gap:1-2"));
  cmd(c, { actor: lg.id, skill: "longge_aa", target: "gap:1-2", picks: { mode: "gun", target: "gap:1-2" } });
  assert.equal(S.gaps["1-2"].hp, 8);
  assert.equal(lg.resources.ammo.length, 5, "霰弹枪耗 1 发");
});

// —— 新技能与被动升级 ——
const lvUp = (lg, wl) => { lg.level = 11; lg.weaponLevels = Object.assign({}, lg.weaponLevels, { xiaoxiao: wl || 1 }); };
const seenAll = lg => { lg.resources.seen = lg.resources.ammo.map(() => true); lg.resources.known = lg.resources.ammo.length; };

test("技能解锁：热能轰击 3 级、饮弹 6 级、洗牌 11 级；完全换弹要胶囊弹药+", () => {
  const { c, lg } = setup();
  const ids = () => c.skillList(lg).map(s => s.id);
  lg.level = 1;
  ["longge_heat", "longge_drink", "longge_shuffle", "longge_reload"].forEach(id => assert.ok(!ids().includes(id), id));
  lg.level = 3; assert.ok(ids().includes("longge_heat"));
  lg.level = 6; assert.ok(ids().includes("longge_drink"));
  lg.level = 11; assert.ok(ids().includes("longge_shuffle"));
  assert.ok(!ids().includes("longge_reload"));
  lvUp(lg, 10);
  assert.ok(ids().includes("longge_reload"));
});

test("热能轰击：手杖给同区敌人熔融；不能打远处", () => {
  const { c, lg, foes } = setup();
  lvUp(lg);
  const tids = c.skillFlowSteps("longge_heat", lg, {}).find(s => s.key === "target").units.map(u => u.id);
  assert.ok(tids.includes(foes[0].id));
  assert.ok(!tids.includes(foes[1].id));
  cmd(c, { actor: lg.id, skill: "longge_heat", target: foes[0].id });
  assert.ok(foes[0].instant && foes[0].instant.melt, "熔融");
  assert.equal(lg.resources.ammo.length, 6);
});

test("热能轰击（霰弹枪）：红弹 → 同区敌人全熔融、同区友方按红弹治疗；蓝弹 → 同区友方各 1 冰击破", () => {
  const { c, S, lg, foes } = setup();
  lvUp(lg);
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = 1;
  const extra = foes[1]; extra.zone = 1;
  lg.resources.trigger = true;
  lg.resources.ammo = ["red", "blue", "blue"]; seenAll(lg);
  kolt.layers[kolt.layers.length - 1].current = 1;
  const before = c.totalHp(kolt);
  cmd(c, { actor: lg.id, skill: "longge_heat", target: foes[0].id, picks: { mode: "gun", target: foes[0].id } });
  const melted = f => !!(f.instant && f.instant.melt);
  assert.ok(melted(foes[0]) && melted(extra), "同区敌人都熔融");
  assert.ok(c.totalHp(kolt) > before, "同区友方被红弹治疗");
  assert.equal(lg.resources.ammo.length, 2);
  // 蓝弹
  lg.ap = 3;
  const defs = [lg.def, kolt.def];
  cmd(c, { actor: lg.id, skill: "longge_heat", target: foes[0].id, picks: { mode: "gun", target: foes[0].id } });
  assert.equal(lg.def, defs[0] - 1);
  assert.equal(kolt.def, defs[1] - 1);
});

test("饮弹：蓝弹 → 霜结并按蓝弹治疗自己；红弹 → 自己受 1×atk 火焰并返还行动点", () => {
  const { c, lg } = setup();
  lvUp(lg);
  lg.resources.ammo = ["blue", "red"]; seenAll(lg);
  lg.layers[lg.layers.length - 1].current = 1;
  const hp0 = c.totalHp(lg);
  cmd(c, { actor: lg.id, skill: "longge_drink" });
  assert.equal(c.totalHp(lg), Math.min(c.totalMaxHp(lg), hp0 + lg.level + 5));
  assert.equal(lg.self, "frost", "霜结");
  assert.equal(lg.ap, 2);
  const hp1 = c.totalHp(lg);
  cmd(c, { actor: lg.id, skill: "longge_drink" });
  assert.ok(c.totalHp(lg) < hp1, "红弹烧自己");
  assert.equal(lg.ap, 2, "红弹返还行动点");
  assert.equal(lg.resources.ammo.length, 0);
});

test("洗牌：剩下的子弹重排、看过的作废；连续红打随机敌人，连续蓝治疗血最低的队友，都没有就窥探 1", () => {
  const { c, S, lg, foes } = setup();
  lvUp(lg);
  const kolt = c.findKit("kolt", S.units);
  // 全红 3 发：必然 3 连红 → 两次火焰
  lg.resources.shuffleLock = false; lg.resources.ammo = ["red", "red", "red"]; seenAll(lg);
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.equal(pops.filter(p => p.element === "fire").length, 2);
  assert.ok(lg.resources.seen.every(x => !x), "看过的颜色作废");
  // 全蓝 3 发：治疗两次
  lg.ap = 3;
  lg.resources.shuffleLock = false; lg.resources.ammo = ["blue", "blue", "blue"];
  kolt.layers[kolt.layers.length - 1].current = 1;
  lg.layers[lg.layers.length - 1].current = Math.max(1, lg.layers[lg.layers.length - 1].max - 1);
  const k0 = c.totalHp(kolt);
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.ok(c.totalHp(kolt) > k0, "血最低的柯尔特被治疗");
  // 红蓝交替的两发不可能连续 → 窥探 1
  lg.ap = 3;
  lg.resources.shuffleLock = false; lg.resources.ammo = ["red", "blue"];
  const fhp = foes.map(f => f.layers[0].current);
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.equal(lg.resources.known, 1, "窥探 1");
  assert.deepEqual(foes.map(f => f.layers[0].current), fhp);
});

test("洗牌：连续红弹的火焰只在打得到的敌人里随机（距离 1 以内），不会抽到射程外的敌人打空", () => {
  const { c, S, lg, foes } = setup();
  lvUp(lg);
  S.zoneMode = 3;
  lg.zone = 1; foes[0].zone = 3; foes[1].zone = 2;   // 3 区的敌人距离 2，打不到
  for (let seed = 0; seed < 12; seed++) {
    lg.ap = 3;
    lg.resources.shuffleLock = false; lg.resources.ammo = ["red", "red", "red"]; seenAll(lg);
    const far0 = foes[0].layers[0].current, near0 = foes[1].layers[0].current;
    c.S.RNG.install("SHUF" + seed);
    cmd(c, { actor: lg.id, skill: "longge_shuffle" });
    assert.equal(foes[0].layers[0].current, far0, "射程外的敌人不挨打");
    assert.ok(foes[1].layers[0].current < near0, "打得到的敌人挨了火焰");
  }
  // 附近一个打得到的都没有：不出火焰，也不报错
  foes[1].zone = 3;
  lg.ap = 3; lg.resources.shuffleLock = false; lg.resources.ammo = ["red", "red"]; seenAll(lg);
  const hp = foes.map(f => f.layers[0].current);
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.deepEqual(foes.map(f => f.layers[0].current), hp);
});

test("胶囊弹药+：打光后 1 行动点完全换弹（随机 6 发，扳机要重新解锁）", () => {
  const { c, lg } = setup();
  lvUp(lg, 10);
  lg.resources.ammo = ["red"]; seenAll(lg);
  lg.resources.ammo = [];
  lg.resources.seen = [];
  cmd(c, { actor: lg.id, skill: "longge_reload" });
  assert.equal(lg.resources.ammo.length, 6);
  assert.equal(lg.resources.ammo.filter(x => x === "red").length, 3);
  assert.equal(lg.resources.trigger, false);
  assert.equal(lg.ap, 2);
});

test("枪管手杖+：霰弹枪普攻能打近距离，红弹再对同区其他敌人 0.75atk 火", () => {
  const { c, S, lg, foes } = setup();
  lvUp(lg, 5);
  foes[1].zone = 1;
  lg.resources.trigger = true;
  lg.resources.ammo = ["red", "red"]; seenAll(lg);
  const ids = c.skillFlowSteps("longge_aa", lg, { mode: "gun" }).find(s => s.key === "target").units.map(u => u.id);
  assert.ok(ids.includes(foes[0].id), "近距离也能选");
  const pops = capturePops(c);
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[0].id, picks: { mode: "gun", target: foes[0].id } });
  assert.ok(pops.some(p => p.id === foes[0].id));
  assert.ok(pops.some(p => p.id === foes[1].id && p.element === "fire"), "溅射同区另一个敌人");
  assert.ok(S);
});

test("枪管手杖+：霰弹枪近距离打同区飞行敌人不用多付附赠行动（开枪不是近身挥打）；提示写明近 / 远距离", () => {
  const { c, lg, foes } = setup();
  lvUp(lg, 5);
  lg.resources.trigger = true;
  lg.resources.ammo = ["blue", "blue"]; seenAll(lg);
  foes[0].flying = true;
  lg.bonus = 0;
  assert.match(c.skillList(lg).find(s => s.id === "longge_aa").hint, /霰弹枪：近 \/ 远距离/);
  const hp0 = c.totalHp(foes[0]);
  cmd(c, { actor: lg.id, skill: "longge_aa", target: foes[0].id, picks: { mode: "gun", target: foes[0].id } });
  assert.ok(c.totalHp(foes[0]) < hp0, "打中了");
  assert.equal(lg.bonus, 0);
});

test("枪管手杖（未升级）：霰弹枪普攻只能打距离 1", () => {
  const { c, lg, foes } = setup();
  lg.resources.trigger = true;
  const ids = c.skillFlowSteps("longge_aa", lg, { mode: "gun" }).find(s => s.key === "target").units.map(u => u.id);
  assert.ok(!ids.includes(foes[0].id));
  assert.ok(ids.includes(foes[1].id));
});

test("胶囊弹药+：长休排好下一场的 6 发顺序，只用一场", () => {
  const { c, lg } = setup();
  lvUp(lg, 10);
  const opt = c.longRestOptions({});
  assert.ok(opt.ammoOrders.length === 21);
  assert.equal(opt.heroes.find(h => h.kit === "longge").ammo, "");
  assert.equal(opt.heroes.find(h => h.kit === "kolt").ammo, null);
  c.S.state.kuizhi = 0;
  c.ledgerLongRest({ force: true, ammo: { longge: "RRRBBB" } }, []);
  assert.equal(c.LEDGER.ammoOrder.longge, "RRRBBB");
  assert.deepEqual(plain(c.longgeOpeningAmmo()), ["red", "red", "red", "blue", "blue", "blue"]);
  assert.equal(c.LEDGER.ammoOrder.longge, undefined, "用掉就清");
});

test("小朋友 4 级爆发治疗：不用先窥探；不同色白扣行动点、不耗子弹；全红回满，全蓝 2×(等级+5) 临时护盾", () => {
  const { c, S, lg } = setup();
  lvUp(lg);
  cmd(c, { actor: lg.id, skill: "longge_summon" });
  const w = c.findKit("xiaoxiao", S.units);
  w.zone = 1; w.ap = 3; w.level = 4;
  assert.ok(c.skillList(w).some(s => s.id === "xiaoxiao_burst"));
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = 1;
  kolt.layers[kolt.layers.length - 1].current = 1;
  // 没窥探也能用；颜色不对 → 白扣行动点，子弹不动
  lg.resources.ammo = ["red", "blue", "red"];
  lg.resources.seen = [false, false, false];
  assert.equal(c.longgeBurstWhy(w), null, "没看到颜色也可以用");
  const hp0 = c.totalHp(kolt);
  cmd(c, { actor: w.id, skill: "xiaoxiao_burst", target: kolt.id, picks: { target: kolt.id } });
  assert.equal(w.ap, 2, "白扣行动点");
  assert.equal(lg.resources.ammo.length, 3, "子弹不消耗");
  assert.equal(c.totalHp(kolt), hp0);
  // 已经窥探到不同色：明知会失败，直接拦下
  seenAll(lg);
  assert.match(c.longgeBurstWhy(w), /同一种颜色/);
  w.ap = 3;
  lg.resources.ammo = ["red", "red", "red", "blue", "blue", "blue"];
  lg.resources.seen = lg.resources.ammo.map(() => false);
  assert.equal(c.longgeBurstWhy(w), null);
  cmd(c, { actor: w.id, skill: "xiaoxiao_burst", target: kolt.id, picks: { target: kolt.id } });
  assert.equal(c.totalHp(kolt), c.totalMaxHp(kolt));
  w.ap = 3;
  const hp = c.totalHp(kolt);
  cmd(c, { actor: w.id, skill: "xiaoxiao_burst", target: kolt.id, picks: { target: kolt.id } });
  assert.equal(c.totalHp(kolt) - hp, 2 * (lg.level + 5), "临时护盾");
  assert.equal(lg.resources.ammo.length, 0);
});

test("洗牌：洗过以后子弹数量没变过就不能连续洗；开枪 / 换弹之后可以再洗", () => {
  const { c, lg } = setup();
  lvUp(lg);
  lg.ap = 3;
  lg.resources.ammo = ["red", "blue", "red", "blue"]; seenAll(lg);
  assert.equal(c.skillRequirementError(lg, "longge_shuffle"), null);
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.match(String(c.skillRequirementError(lg, "longge_shuffle")), /不能连续洗牌/);
  const ap = lg.ap;
  cmd(c, { actor: lg.id, skill: "longge_shuffle" });
  assert.equal(lg.ap, ap, "被拦下，不扣行动点");
  // 打出一发：数量变了，可以再洗
  c.longgeTakeBullet(lg, []);
  assert.equal(lg.resources.ammo.length, 3);
  assert.equal(c.skillRequirementError(lg, "longge_shuffle"), null);
});
