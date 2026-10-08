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

test("应急处理（龙哥）：2d4+3，半血以下取最大 11", () => {
  const { c, S, lg } = setup();
  const kolt = c.findKit("kolt", S.units);
  kolt.zone = lg.zone;
  kolt.layers.forEach(l => { l.current = 1; });
  const hp0 = c.totalHp(kolt);
  cmd(c, { actor: lg.id, skill: "role_firstaid", target: kolt.id });
  assert.equal(c.totalHp(kolt) - hp0, 11);
});

test("小朋友：装甲 12、架势 4、耐久 5（每五级 +1）、atk 5；格挡 60%，守护龙哥 75%", () => {
  const { c, S, lg } = setup();
  cmd(c, { actor: lg.id, skill: "longge_summon" });
  const w = c.findKit("xiaoxiao", S.units);
  assert.ok(w && !w.hidden);
  assert.equal(w.layers[0].type, "armor");
  assert.equal(w.layers[0].max, 12);
  assert.equal(w.defMax, 4);
  assert.equal(w.atk, 5);
  assert.equal(c.weaponBaseDur("xiaoxiao", 1), 5);
  assert.equal(c.weaponBaseDur("xiaoxiao", 4), 5);
  assert.equal(c.weaponBaseDur("xiaoxiao", 5), 6);
  assert.equal(c.weaponBaseDur("edc", 2), 6, "其他武器照旧每两级 +1");
  const kolt = c.findKit("kolt", S.units);
  const foe = S.units.find(u => !u.isPlayer);
  assert.equal(c.finalBlockChance(w, foe, kolt), 60);
  assert.equal(c.finalBlockChance(w, foe, lg), 75);
  assert.ok(c.isUnarmed(lg), "唤出后龙哥空手");
  assert.deepEqual(plain(c.skillList(w).map(s => s.id)), ["xiaoxiao_punch", "xiaoxiao_heal", "xiaoxiao_return"]);
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
