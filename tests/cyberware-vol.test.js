// 义体：单体伤害型模板 .vol1–.vol4（#262，夕夏定）——正式目录、诊所（改造率 / 拆除 / 以新换旧 / 负担警告）、
// 战斗里发动（每次短休 1 次、坚毅最少留 1、不吃 atk、打不出去的目标在扣点前拦下；预演不把发动消耗算成效果）、
// 同屏校验和房主的行动菜单、图鉴第六本「义体」（不露任何人现在的坚毅生命）、
// 种类表能直接加新种类、和专长（推搡、勾索、跃迁、挑衅、震慑、地震）不冲突
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const J = v => JSON.parse(JSON.stringify(v));
const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const run = (c, src) => vm.runInContext(src, c);
// 6 体质 6 智力：改造率上限 60%，原生命上限 Lv5 38 / Lv20 128（和 tests/cyberware.test.js 一样）
const hero = (lv, extra) => Object.assign({ kit: "t", name: "测试", attrs: { str: 5, con: 6, dex: 5, wil: 6, int: 6, sta: 5 }, level: lv, shp: 20, shpMax: 20, cyberware: [] }, extra || {});
const ids = u => (u.cyberware || []).map(x => x.id);
const logText = S => (S.logPages || []).flatMap(p => p.lines.map(l => l.text)).join("\n");
const VOLS = [[5, 1], [10, 2], [15, 3], [20, 4]];

/* ---------- 正式目录 ---------- */
test("正式目录：打击义体 / 射击义体各 .vol1–.vol4（5 / 10 / 15 / 20 级），单体伤害型，数值照档位表；示例不在正式目录里", () => {
  const c = H.load();
  const all = J(c.cyberwareCatalog());
  assert.deepEqual(all.map(d => d.name), ["打击义体.vol1", "打击义体.vol2", "打击义体.vol3", "打击义体.vol4", "射击义体.vol1", "射击义体.vol2", "射击义体.vol3", "射击义体.vol4"]);
  assert.deepEqual(all.map(d => d.id), ["strike_v1", "strike_v2", "strike_v3", "strike_v4", "shot_v1", "shot_v2", "shot_v3", "shot_v4"]);
  const tierTable = run(c, "CYBERWARE_TIER");
  for (const d of all) {
    const [tier, vol] = VOLS.find(([, v]) => d.name.endsWith(".vol" + v));
    assert.equal(d.tier, tier); assert.equal(d.vol, vol);
    assert.equal(d.kind, "attack"); assert.equal(d.element, "physical");
    assert.equal(d.range, d.line === "strike" ? "melee" : "ranged");
    assert.equal(d.conflict, null, "没有部位 / 槽位标签");
    assert.ok(!d.example);
    assert.equal(d.break, 2); assert.equal(d.fireShp, 2); assert.equal(d.dailyShp, 2);
    assert.deepEqual(d.cost, { ap: 1 }); assert.equal(d.usesPerShortRest, 1);
    for (const k of ["hpCut", "shpCut", "occupancy", "price", "removePrice"]) assert.equal(d[k], tierTable[tier][k], `${d.name} ${k}`);
  }
  // 伤害：近战 n×10 + nd20，远程每颗 d20 换 d12+2（n = 等级 ÷ 5）
  assert.deepEqual(all.map(d => c.cyberwarePacket(hero(20)).shop.find(x => x.id === d.id).damageText),
    ["10 + 1d20", "20 + 2d20", "30 + 3d20", "40 + 4d20", "10 + 1×(d12+2)", "20 + 2×(d12+2)", "30 + 3×(d12+2)", "40 + 4×(d12+2)"]);
  assert.ok(!all.some(d => d.id === "example_t5_melee"));
  c.cyberwareLoadExamples();
  assert.ok(c.cyberwareCatalog().some(d => d.id === "example_t5_melee"), "示例照旧要显式加载");
});

test("名字和专长 / 技能不撞：没有一件义体和专长同名，也不含推搡、勾索、跃迁、挑衅、震慑、地震", () => {
  const c = H.load();
  const feats = run(c, "Object.keys(FEATS).map(id => FEATS[id].name)");
  const names = c.cyberwareCatalog().map(d => d.name);
  for (const n of names) {
    assert.ok(!feats.includes(n), n);
    for (const f of ["推搡", "勾索", "跃迁", "挑衅", "震慑", "地震"]) assert.ok(!n.includes(f), `${n} 不含 ${f}`);
  }
  // 技能 id 前缀分开：义体 cw_，专长 feat_
  assert.equal(c.cyberwareOfSkill("feat_shove"), null);
  assert.equal(c.featOfSkill("cw_strike_v1"), null);
});

/* ---------- 诊所 ---------- */
test("诊所：装上占改造率（扣的生命上限 ÷ 原生命上限 + 15%）、扣生命上限；花钱拆除，完全还原", () => {
  const c = H.load();
  const u = Object.assign(hero(20), { isPlayer: true, layers: [{ type: "flesh", current: 128, max: 128, inner: true }], shp: 30, shpMax: 30 });
  c.__u = u; run(c, "applyLevelStats(__u)");
  const hp0 = u.layers[0].max, shp0 = u.shpMax;
  const purse = { kuizhi: 20000 };
  const pv = J(c.cyberwareInstall(u, "strike_v4", purse));
  assert.equal(pv.cost, 12000); assert.equal(purse.kuizhi, 8000);
  assert.equal(pv.rateBefore, 0); assert.equal(pv.rateAfter, Math.round((20 / 128 + 0.15) * 1000) / 10);
  assert.equal(u.layers[0].max, hp0 - 20); assert.equal(u.shpMax, shp0 - 3);
  const view = J(c.cyberwareView(u));
  assert.equal(view.installed[0].kindName, "单体伤害型"); assert.equal(view.installed[0].vol, 4);
  assert.match(view.installed[0].summary, /近战 · 打同区的一名敌人 · 40 \+ 4d20 物理 · 2 击破（不吃 atk）/);
  c.cyberwareRemove(u, "strike_v4", purse);
  assert.equal(purse.kuizhi, 4000, "拆除费 4000");
  assert.equal(u.layers[0].max, hp0); assert.equal(u.shpMax, shp0);
  assert.deepEqual(ids(u), []);
});

test("不能升级，只能以新换旧：同系列只能装一件；换等级 = 旧的拆除费 + 新的价格，改造率按拆掉旧的以后算", () => {
  const c = H.load();
  const u = hero(20, { cyberware: [{ id: "strike_v1" }] });
  const pv = J(c.cyberwareInstallPreview(u, "strike_v2"));
  assert.equal(pv.ok, true);
  assert.equal(pv.replaces, "strike_v1"); assert.equal(pv.replaceName, "打击义体.vol1");
  assert.equal(pv.replaceCost, 1000); assert.equal(pv.price, 6000); assert.equal(pv.cost, 7000);
  const solo = J(c.cyberwareInstallPreview(hero(20), "strike_v2"));
  assert.equal(pv.rateAfter, solo.rateAfter, "装完只剩 .vol2，不是两件一起算");
  const purse = { kuizhi: 6999 };
  assert.throws(() => c.cyberwareInstall(u, "strike_v2", purse), /奎支不够/);
  assert.deepEqual(ids(u), ["strike_v1"], "钱不够什么都不动");
  purse.kuizhi = 7000;
  c.cyberwareInstall(u, "strike_v2", purse);
  assert.equal(purse.kuizhi, 0);
  assert.deepEqual(ids(u), ["strike_v2"], "旧的拆掉、新的装上，不会两件同时在身上");
  // 换回低等级也一样是以新换旧
  assert.equal(J(c.cyberwareInstallPreview(u, "strike_v1")).replaces, "strike_v2");
  // 诊所目录里写着以新换旧
  const row = J(c.cyberwareShopView(u)).find(r => r.id === "strike_v3");
  assert.equal(row.replaces, "strike_v2"); assert.equal(row.replaceCost, 2000);
  // 没有部位 / 槽位：不同系列可以一起装，只看改造率
  const both = J(c.cyberwareInstallPreview(u, "shot_v1"));
  assert.equal(both.ok, true); assert.equal(both.replaces, null); assert.equal(both.cost, 3000);
  c.cyberwareInstall(u, "shot_v1", { kuizhi: 3000 });
  assert.deepEqual(ids(u).sort(), ["shot_v1", "strike_v2"]);
  assert.equal(J(c.cyberwareView(u)).installed.length, 2);
});

test("单局诊所：以新换旧走同一个 installCyberware，记录写明拆了哪件、花了多少", () => {
  const c = H.load();
  const R = c.Rogue, rr = R.newRun({ party: ["kolt", "helu"], seed: "CWVOL" });
  rr.stage = "camp";
  c.S.state.kuizhi = 100000;
  const h = rr.party.find(x => x.kit === "kolt");
  h.level = 5;   // #315：5 级起才能在诊所装 / 拆义体（5 级的柯尔特装 .vol2 不超上限）
  c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "shot_v1" }, { run: rr });
  assert.equal(c.S.state.kuizhi, 97000);
  const pk = J(R.cyberwarePacketFor(rr, "kolt"));
  assert.equal(pk.previews.shot_v2.replaces, "shot_v1");
  c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "shot_v2" }, { run: rr });
  assert.equal(c.S.state.kuizhi, 97000 - 6000 - 1000);
  assert.deepEqual(J(h.cyberware), [{ id: "shot_v2" }]);
  assert.match(rr.log.map(x => x.text).join("\n"), /柯尔特 以新换旧：拆掉「射击义体\.vol1」，装上「射击义体\.vol2」，花掉 7000 奎支（拆除费 1000 \+ 新义体 6000）/);
});

test("安装负担重时给警告：超出改造率上限要专长；有专长才能装，并写「这会给身体带来极大负担。」", () => {
  const c = H.load();
  const u = hero(5);   // 原生命上限 38，上限 60%：.vol4（20 ÷ 38 + 15% = 67.6%）超上限
  const pv = J(c.cyberwareInstallPreview(u, "strike_v4"));
  assert.equal(pv.ok, false); assert.equal(pv.overinstall, true); assert.equal(pv.burden, "heavy");
  assert.match(pv.error, /超出改造率上限/);
  u.cyberOverinstall = true;
  const pv2 = J(c.cyberwareInstallPreview(u, "strike_v4"));
  assert.equal(pv2.ok, true); assert.equal(pv2.warning, "这会给身体带来极大负担。");
  // 不超上限：每天消耗坚毅生命的义体照样提醒有负担（只给档位文字）
  const pv3 = J(c.cyberwareInstallPreview(hero(20), "strike_v1"));
  assert.equal(pv3.burden, "strain"); assert.equal(pv3.warning, "这会给身体带来负担。");
});

/* ---------- 坚毅生命：最少留 1、不会致死 ---------- */
test("坚毅消耗最低到 1：发动、每天、过度安装都扣不到 1 以下；装上扣坚毅上限也不会把人扣到 0", () => {
  const c = H.load();
  const u = hero(20, { shp: 3, cyberware: [{ id: "strike_v1" }] });
  assert.equal(J(c.cyberwareFire(u, "strike_v1", () => 0)).damage.total, 11);
  assert.equal(u.shp, 1);
  c.cyberwareShortRest(u);
  c.cyberwareFire(u, "strike_v1");
  assert.equal(u.shp, 1, "已经是 1：再发动也不扣");
  u.cyberOverinstall = true;
  u.cyberware.push({ id: "shot_v4" }, { id: "strike_v4" });
  assert.ok(c.cyberwareDailyCost(u) > 2);
  c.cyberwareDayTick(u);
  assert.equal(u.shp, 1, "每天的消耗（含过度安装）也最少留 1");
  // 装上扣坚毅上限：growth.js 按比例缩放当前坚毅（1 / 3 × 1 四舍五入是 0），原来有 1 的缩放后也至少留 1
  const w = Object.assign(hero(1, { attrs: { str: 5, con: 6, dex: 5, wil: 1, int: 6, sta: 5 }, cyberOverinstall: true }),
    { isPlayer: true, layers: [{ type: "flesh", current: 14, max: 14, inner: true }] });
  c.__w = w; run(c, "applyLevelStats(__w)");
  assert.equal(w.shpMax, 6);
  w.shp = 1;
  c.cyberwareInstall(w, "strike_v4", null, { free: true });
  assert.equal(w.shpMax, 3); assert.equal(w.shp, 1);
  c.cyberwareInstall(w, "shot_v4", null, { free: true });
  assert.equal(w.shpMax, 1); assert.equal(w.shp, 1, "坚毅上限扣到 1 时也留 1，不会致死");
});

/* ---------- 战斗 ---------- */
function field(seed) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 20, zone: 1 }, { id: "thug_knife", lv: 20, zone: 2 }], seed: seed || "CWVB" });
  const S = c.S.state;
  const [a, b] = ["kolt", "helu"].map(k => c.findKit(k, S.units));
  c.startCombat();
  S.combatPhase = "player";
  const foes = S.units.filter(u => !u.isPlayer && !u.dead && !u.hidden);
  a.zone = 1; a.ap = 2; a.bonus = 1;
  b.zone = 1;
  return { c, S, a, b, near: foes.find(u => Number(u.zone) === 1), far: foes.find(u => Number(u.zone) === 2) };
}
function equip(c, u, idList) {
  u.cyberware = idList.map(id => ({ id }));
  c.applyLevelStats(u);
}
function fire(c, S, a, id, t) {
  S.attackerId = a.id; S.targetId = t ? t.id : null;
  c.runSkill(id);
}
/** 再加载战斗画面（预演、候选目标）、同屏校验和房主的行动菜单（和 tests/online-actions.test.js 一样，无界面也能跑） */
function withGame(c) {
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  for (const f of ["game.js", "hotseat-validation.js", "online-view.js", "online-actions.js"]) vm.runInContext(read(f), c, { filename: f });
  return c;
}
/** 起身中：血量打空、受伤改打坚毅生命 */
function upOnShp(a, shp) {
  a.layers.forEach(l => { l.current = 0; });
  a.dying = false; a.upOnShp = true; a.shp = shp;
}

test("战斗：装着的义体出现在技能列表（空手也能用），1 行动点、只打敌人，近战打同区、远程打距离 1", () => {
  const { c, a } = field();
  assert.ok(!c.skillList(a).some(s => s.id.startsWith("cw_")), "没装就没有");
  equip(c, a, ["strike_v1", "shot_v2"]);
  const list = J(c.skillList(a).filter(s => s.id.startsWith("cw_")));
  assert.deepEqual(list.map(s => s.name), ["打击义体.vol1", "射击义体.vol2"]);
  assert.ok(list.every(s => s.bare), "义体长在身上：空手也能用");
  assert.match(list[0].hint, /义体 · 近战 · 打同区的一名敌人 · 10 \+ 1d20 物理 · 2 击破（不吃 atk） · 1 行动点 · 发动消耗 2 点坚毅生命（最少留 1） · 短休前还能用 1 次/);
  assert.deepEqual(J(c.skillCost("cw_strike_v1")), { ap: 1 });
  assert.deepEqual(J(run(c, "SKILL_RANGE.cw_strike_v1")), { min: 0, max: 0 });
  assert.deepEqual(J(run(c, "SKILL_RANGE.cw_shot_v2")), { min: 1, max: 1 });
  assert.equal(run(c, "SKILL_TARGET_SIDE.cw_strike_v1"), "enemy");
  a.weaponHeld = false;
  assert.ok(c.skillList(a).some(s => s.id === "cw_strike_v1"), "武器不在手上也能用");
});

test("战斗：发动 = 一次攻击，固定伤害（不吃 atk）、2 击破；花 1 行动点；坚毅 −2；每次短休 1 次，跨场次不刷新，短休 / 长休后恢复", () => {
  const out = [];
  for (const atk of [5, 500]) {
    const { c, S, a, near } = field("CWVB-ATK");
    equip(c, a, ["strike_v1"]);
    S.inputs = Object.assign({}, S.inputs, { diceMode: "manual", diceManual: 7 });   // 骰子定成 7：伤害 = 10 + 7
    a.atk = atk; a.personalAtk = atk;
    a.shp = 10;
    const hp0 = c.totalHp(near), def0 = near.def;
    fire(c, S, a, "cw_strike_v1", near);
    out.push({ dmg: hp0 - c.totalHp(near), brk: def0 - near.def, ap: a.ap, shp: a.shp });
    if (atk === 5) {
      assert.match(logText(S), /发动义体「打击义体\.vol1」/);
      assert.match(c.skillRequirementError(a, "cw_strike_v1") || "", /短休前不能再用/);
      assert.match(J(c.skillList(a)).find(s => s.id === "cw_strike_v1").hint, /短休前还能用 0 次/);
      // 下一场（重新摆队伍）：次数记在队伍档案里，不会因为换场刷新
      c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 5, zone: 1 }], seed: "CWVB-2" });
      const a2 = c.findKit("kolt", c.S.state.units);
      equip(c, a2, ["strike_v1"]);
      assert.match(c.skillRequirementError(a2, "cw_strike_v1") || "", /短休前不能再用/);
      c.ledgerShortRest(["kolt"]);
      assert.equal(c.skillRequirementError(a2, "cw_strike_v1"), null, "短休后恢复");
      c.useShortOnce("kolt", "cw:strike_v1", 1);
      c.ledgerLongRest({ force: true });
      assert.equal(c.skillRequirementError(a2, "cw_strike_v1"), null, "长休后恢复");
    }
  }
  assert.equal(out[0].dmg, out[1].dmg, "atk 5 和 500 打出的伤害一样");
  assert.ok(out[0].dmg > 0);
  assert.ok(out[0].brk >= 2, "2 击破（目标一侧的效果可能再加）");
  assert.equal(out[0].ap, 1, "花 1 行动点");
  assert.equal(out[0].shp, 8, "坚毅 −2");
});

test("战斗：远程打不到同区、近战打不到隔壁；没选目标不花次数也不扣坚毅；打友方在扣行动点之前拦下", () => {
  const { c, S, a, b, near, far } = field();
  equip(c, a, ["strike_v1", "shot_v1"]);
  a.shp = 10;
  fire(c, S, a, "cw_shot_v1", near);
  assert.match(logText(S), /不能打距离 0 的目标/);
  fire(c, S, a, "cw_strike_v1", far);
  assert.match(logText(S), /不能打距离 1 的目标/);
  assert.equal(a.ap, 2); assert.equal(a.shp, 10);
  fire(c, S, a, "cw_strike_v1", b);
  assert.match(logText(S), /只能对敌人使用/);
  assert.equal(a.ap, 2); assert.equal(a.shp, 10);
  assert.equal(c.cyberwareUsesLeft(a, "strike_v1"), 1);
  // 不选目标（画面靠「先选」判断还要选目标）：不记次数、不扣坚毅
  fire(c, S, a, "cw_strike_v1", null);
  assert.match(logText(S), /先选「打击义体\.vol1」打哪一名敌人/);
  assert.equal(c.cyberwareUsesLeft(a, "strike_v1"), 1); assert.equal(a.shp, 10);
  // 远程打距离 1 的敌人照常
  a.ap = 2;
  const hp0 = c.totalHp(far);
  fire(c, S, a, "cw_shot_v1", far);
  assert.ok(c.totalHp(far) < hp0);
});

test("战斗：游戏版日志不写坚毅扣了多少（扣到 1 就扣不动，写数字会露出剩余值）；跑团主持人照常看到数字", () => {
  for (const game of [true, false]) {
    const { c, S, a, near } = field("CWVB-LOG");
    if (game) c.GAME_MODE = true;
    equip(c, a, ["strike_v1"]);
    a.shp = 1;
    fire(c, S, a, "cw_strike_v1", near);
    assert.equal(a.shp, 1, "最少留 1，不会致死");
    assert.ok(!a.dead);
    const txt = logText(S);
    if (game) {
      assert.match(txt, /柯尔特 的义体消耗了一些坚毅生命（不会致死）。/);
      assert.doesNotMatch(txt, /坚毅\s*[−-]\s*\d/);
    } else {
      assert.match(txt, /坚毅 −0（义体发动消耗 2，最少留 1，不会致死）/);
    }
  }
});

test("战斗：起身后（受伤改打坚毅生命）发动义体也不会把人扣死", () => {
  const { c, S, a, near } = field("CWVB-UP");
  equip(c, a, ["strike_v1"]);
  upOnShp(a, 2);
  fire(c, S, a, "cw_strike_v1", near);
  assert.equal(a.shp, 1);
  assert.ok(!a.dead && !a.dying);
});

test("战斗：躲藏中的、下潜中的（义体不是谐波属性）敌人打不出去，在扣行动点之前拦下：不花行动点、次数、坚毅；谐波属性的打得到下潜的", () => {
  const { c, S, a, near } = field("CWVB-HIDE");
  equip(c, a, ["strike_v1"]);
  a.shp = 10;
  near.statuses.hide = true;
  fire(c, S, a, "cw_strike_v1", near);
  assert.match(logText(S), /躲藏中，不能被选作攻击目标/);
  near.statuses.hide = false; near.submerged = true;
  fire(c, S, a, "cw_strike_v1", near);
  assert.match(logText(S), /下潜中，只有谐波攻击打得到/);
  assert.equal(a.ap, 2); assert.equal(a.shp, 10);
  assert.equal(c.cyberwareUsesLeft(a, "strike_v1"), 1);
  // 谐波属性的义体（以后在 CYBERWARE_LINES 加一行就有）：下潜的照样能打，打到就被迫浮上来
  run(c, `cyberwareRegister({ id: "reso_v1", name: "测试谐波.vol1", tier: 5, kind: "attack", element: "harmonic", line: "reso" })`);
  equip(c, a, ["reso_v1"]);
  assert.equal(c.skillTargetError(a, "cw_reso_v1", near), null);
  const hp0 = c.totalHp(near);
  fire(c, S, a, "cw_reso_v1", near);
  assert.ok(c.totalHp(near) < hp0);
  assert.ok(!near.submerged);
});

test("预演：起身中发动义体，自己扣的坚毅不算这次行动的效果——坚毅 1 和 5 预演出来完全一样（不露出是不是只剩 1），躲藏的目标照样不能选", () => {
  const seen = [];
  for (const shp of [1, 5]) {
    const { c, S, a, near } = field("CWVB-PV");
    c.GAME_MODE = true;
    withGame(c);
    equip(c, a, ["strike_v1"]);
    upOnShp(a, shp);
    // 预演跑完把 state 整个还原成备份（单位换成了新对象）：每次都按 id 重新取
    const unit = id => S.units.find(u => u.id === id);
    const pv = t => c.GAME.previewOf(c.GAME.skillThunk(a.id, "cw_strike_v1", t ? t.id : null, {}));
    assert.equal(pv(null).needsTarget, true, "没选目标：先选");
    const hit = pv(near), self = hit.units.get(a.id);
    assert.equal(hit.meaningful, true);
    assert.ok(hit.units.get(near.id).dmgHi > 0, "目标照常预览伤害");
    assert.equal(self.shpLoss, 0, "自己的卡片上不写「伤到坚毅」");
    assert.equal(self.changed, false);
    unit(near.id).statuses.hide = true;
    const hidden = pv(near);
    assert.equal(hidden.meaningful, false, "躲藏的目标：没有效果，不能选");
    assert.match(hidden.reason, /躲藏中/);
    assert.equal(unit(a.id).shp, shp, "预演不改任何东西");
    seen.push(JSON.stringify({ self: J(self), lines: J(hit.lines), hidden: hidden.meaningful }));
  }
  assert.equal(seen[0], seen[1], "坚毅 1 和 5 的预演完全一样");
});

/* ---------- 和专长不冲突 ---------- */
test("和专长不冲突：次数各记各的（专长 featUsed / feat: 键，义体 cw: 键），专长动作和义体可以在同一回合各用各的", () => {
  // Helumica（环境手）：挑衅 / 勾索 / 震慑 / 地震这几张涉猎专长对她都是可用的（柯尔特会坦克技能，挑衅会被收起）
  const { c, S, b: a, near } = field("CWVB-FEAT");
  a.feats = ["provoke", "shove", "grapple", "blink", "daunt", "quake"];
  equip(c, a, ["strike_v1"]);
  a.ap = 3; a.bonus = 2;
  const names = J(c.skillList(a)).map(s => s.id);
  for (const id of ["feat_provoke", "feat_shove", "feat_grapple", "feat_blink", "feat_daunt", "feat_quake", "cw_strike_v1"]) assert.ok(names.includes(id), id);
  // 先用专长：义体次数不动
  fire(c, S, a, "feat_provoke", near);
  assert.equal(near.tauntTo, a.id);
  assert.equal(c.cyberwareUsesLeft(a, "strike_v1"), 1);
  // 再发动义体：专长的次数不动
  const featUsed = J((a.resources || {}).featUsed || {});
  fire(c, S, a, "cw_strike_v1", near);
  assert.equal(c.cyberwareUsesLeft(a, "strike_v1"), 0);
  assert.deepEqual(J((a.resources || {}).featUsed || {}), featUsed);
  assert.equal(c.featSkillWhy(a, "feat_shove"), null, "推搡照常能用");
  assert.equal(c.featSkillWhy(a, "feat_grapple"), null, "勾索照常能用");
  // 跃迁照专长原文：用行动点攻击之后可以免费移动 1 格（发动义体是用行动点的攻击）
  assert.equal(c.featSkillWhy(a, "feat_blink"), null);
  // 义体自己不带位移 / 嘲讽 / 虚弱 / 不稳：这些都是专长的效果
  assert.equal(Number(near.zone), 1);
  assert.ok(!(near.statuses || {}).weak && !(near.statuses || {}).unstable);
  // 队伍档案里：义体的次数键是 cw:，专长的是 feat:，互不覆盖
  assert.deepEqual(Object.keys(J(c.LEDGER.shortOnce[a.kit] || {})), ["cw:strike_v1"]);
});

/* ---------- 图鉴 ---------- */
test("图鉴「义体」：每件一条，写名称、等级、效果、改造率、坚毅生命的具体消耗和诊所规则；按种类分组", () => {
  const c = H.load();
  const all = J(c.codexCyberwareEntries());
  assert.equal(all.length, 8);
  assert.deepEqual(J(c.codexCyberwareGroups()), [{ id: "attack", name: "单体伤害型" }]);
  const v1 = all.find(e => e.cwId === "strike_v1"), r4 = all.find(e => e.cwId === "shot_v4");
  assert.equal(v1.name, "打击义体.vol1"); assert.equal(v1.tier, 5); assert.equal(v1.vol, 1);
  assert.equal(v1.group, "attack"); assert.equal(v1.groupName, "单体伤害型");
  assert.match(v1.effect[0], /对同区的一名敌人造成 10 \+ 1d20 点物理伤害、2 击破/);
  assert.match(r4.effect[0], /对距离 1 的一名敌人造成 40 \+ 4×\(d12\+2\) 点物理伤害/);
  assert.match(v1.use, /1 行动点，每次短休 1 次/);
  assert.match(v1.rate, /固定 15% \+ 生命上限 −5 按原生命上限折算（原生命上限 30 时约 31\.7%/);
  assert.match(v1.grit.join(""), /发动一次消耗 2 点坚毅生命。/);
  assert.match(v1.grit.join(""), /装着的每一天（每次长休算一天）消耗 2 点坚毅生命。/);
  assert.match(v1.grit.join(""), /最少留 1，不会致死/);
  assert.ok(!v1.grit.some(s => /坚毅生命上限/.test(s)), ".vol1 不扣坚毅上限（shpCut 0）");
  assert.match(r4.grit.join(""), /坚毅生命上限 −3/);
  assert.match(v1.clinic.join(""), /3000 奎支；拆除：1000 奎支/);
  assert.match(v1.clinic.join(""), /不能升级：「打击义体」系列共 4 个等级，同时只能装其中一件；换等级要在诊所以新换旧/);
  assert.match(v1.clinic.join(""), /没有部位 \/ 槽位限制/);
  // 搜索：名字后缀、种类名、效果文字都能搜
  assert.deepEqual(all.filter(e => c.codexMatch(e, ".vol2")).map(e => e.cwId), ["strike_v2", "shot_v2"]);
  assert.equal(all.filter(e => c.codexMatch(e, "单体伤害型")).length, 8);
  assert.deepEqual(all.filter(e => c.codexMatch(e, "射击义体 d12")).length, 4);
});

test("图鉴「义体」不显示任何人现在的坚毅生命：条目不读角色，里面没有 shp 字段，也没有队伍当前的坚毅数值", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CWVC" });
  c.S.state.units.forEach(u => { if (u.isPlayer) { u.shp = 4321; u.shpMax = 9876; u.cyberware = [{ id: "strike_v1" }]; } });
  const s = JSON.stringify(J(c.codexCyberwareEntries()));
  assert.doesNotMatch(s, /4321|9876/);
  assert.doesNotMatch(s, /"shp[A-Z]?\w*"\s*:\s*\d/, "没有坚毅数值字段");
  // 画面：bestiary-ui.js 多了「义体」这一本，详情按 codex 的条目画（不读角色）
  const ui = read("bestiary-ui.js");
  assert.match(ui, /\["cyber", "义体"\]/);
  assert.match(ui, /mode === "cyber"\) return typeof codexCyberwareEntries === "function"/);
  assert.match(ui, /function renderCyberDetail\(e\)/);
  assert.doesNotMatch(ui.slice(ui.indexOf("function renderCyberDetail"), ui.indexOf("function renderCodexDetail")), /shp|state\.units|partyHeroes/);
});

/* ---------- 联机 ---------- */
test("联机：诊所包里有种类名、效果、以新换旧的字段（过白名单），没有坚毅数值，也不出现「坚毅」两个字", () => {
  const c = H.load();
  const u = hero(20, { shp: 4321, shpMax: 9876, cyberware: [{ id: "strike_v1" }] });
  const pk = J(c.cyberwarePacket(u));
  pk.previews = {};
  c.cyberwareCatalog().forEach(d => { pk.previews[d.id] = J(c.cyberwareInstallPreview(u, d.id)); });
  const out = V.projectCyberware(pk);
  const row = out.shop.find(r => r.id === "strike_v2");
  assert.equal(row.kindName, "单体伤害型"); assert.equal(row.vol, 2); assert.equal(row.line, "strike");
  assert.match(row.summary, /近战 · 打同区的一名敌人 · 20 \+ 2d20 物理/);
  assert.equal(row.replaces, "strike_v1"); assert.equal(row.replaceName, "打击义体.vol1"); assert.equal(row.replaceCost, 1000);
  assert.equal(out.previews.strike_v2.replaces, "strike_v1"); assert.equal(out.previews.strike_v2.cost, 7000); assert.equal(out.previews.strike_v2.price, 6000);
  assert.equal(out.view.installed[0].summary, row.summary.replace("20 + 2d20", "10 + 1d20"));
  const s = JSON.stringify(out);
  assert.doesNotMatch(s, /4321|9876|shp|Shp|坚毅/);
});

test("同屏 / 联机：校验接受义体技能打敌人，拒绝友方、射程外、躲藏中的目标；房主的行动菜单列出义体和能打的目标（起身中坚毅 1 和 5 一样）", () => {
  const { Hotseat } = require("../hotseat");
  const lists = [];
  for (const shp of [1, 5]) {
    const { c, S, a, b, near, far } = field("CWVB-NET");
    c.GAME_MODE = true;
    withGame(c);
    equip(c, a, ["strike_v1"]);
    const hs = { session: { assertAction() { return true; } }, sender: "p1" };
    const validate = target => c.HotseatValidation.validateBattle(J({ type: "skill", actor: a.id, skill: "cw_strike_v1", target, picks: {} }), hs);
    assert.equal(validate(near.id), true);
    assert.throws(() => validate(b.id), /只能对敌人使用/);
    assert.throws(() => validate(far.id), /射程/);
    near.statuses.hide = true;
    assert.throws(() => validate(near.id), /躲藏中/);
    near.statuses.hide = false;
    // 房主的行动菜单（online-actions.js）：技能里有义体；选了义体以后列出能打的目标
    const session = Hotseat.create({ operators: ["p1", "p2"], gmId: "p1", assignments: { [a.id]: "p1", [b.id]: "p2" }, getUnits: () => S.units, canStand: u => !c.standUpBlocked(u) });
    session.beginRound(1); session.pick("p1", a.id, 0); session.pick("p2", b.id, 1); session.forceStart("p1");
    const service = c.OnlineActions.create({ game: c.GAME, validation: c.HotseatValidation, inspect: c.HotseatValidation.inspect,
      assertAction: (sender, id) => session.assertAction(sender, id), getState: () => S });
    const menu = req => J(service.menu(Object.assign({ requestId: 1, actor: a.id }, req), "p1")).choices;
    assert.ok(menu({}).options.some(o => o.value === "cw_strike_v1" && !o.disabled), "技能菜单里有义体");
    upOnShp(a, shp);
    const targets = () => menu({ skill: "cw_strike_v1" }).options.map(o => o.value);
    const open = targets();
    assert.ok(open.includes(near.id));
    assert.ok(!open.includes(b.id) && !open.includes(far.id), "友方、射程外的不列");
    near.statuses.hide = true;
    const hidden = targets();
    near.statuses.hide = false;
    assert.ok(!hidden.includes(near.id), "躲藏的不列");
    assert.equal(a.shp, shp, "列菜单不改任何东西");
    lists.push(JSON.stringify([open.includes(near.id), hidden.includes(near.id)]));
  }
  assert.equal(lists[0], lists[1], "起身中坚毅 1 和 5 能选的目标一样");
});

/* ---------- 诊所浮层 ---------- */
test("诊所浮层：同系列写「以新换旧」，确认框列出先拆哪件、拆除费 + 新价格；不出现坚毅", () => {
  const c = H.load();
  vm.runInContext(read("cyberware-ui.js"), c, { filename: "cyberware-ui.js" });
  const R = c.Rogue, rr = R.newRun({ party: ["kolt", "helu"], seed: "CWVUI" });
  rr.stage = "camp";
  c.S.state.kuizhi = 100000;
  rr.party[0].level = 5;   // #315：5 级起才能在诊所装 / 拆义体
  rr.party[0].cyberOverinstall = true;
  R.installCyberware(rr, "kolt", "strike_v1");
  const U = c.CyberwareUI;
  U.reset();
  const q = (action, f) => c.dispatch(Object.assign({ type: "run.query", action }, f), { run: rr });
  const model = () => U.localModel({ heroes: [{ kit: "kolt", name: "柯尔特" }], packetOf: kit => q("cyberware", { kit }), previewOf: (kit, id) => q("cyberwarePreview", { kit, id }), money: () => c.S.state.kuizhi });
  let html = U.html(model());
  assert.match(html, /义体不能升级：同一系列只能装一件，换等级就以新换旧/);
  const row = (html.match(/<li class="cw-row[^"]*">(?:(?!<\/li>)[\s\S])*data-cw-pick="strike_v2"[\s\S]*?<\/li>/) || [""])[0];
  assert.match(row, /以新换旧：会先拆掉「打击义体\.vol1」（拆除费 1000 奎支）/);
  assert.match(row, />以新换旧<\/button>/);
  assert.match(row, /10 级 · 单体伤害型 · 近战 · 打同区的一名敌人 · 20 \+ 2d20 物理 · 2 击破（不吃 atk） · 生命上限 −10/);
  U.state.confirm = "strike_v2";
  html = U.html(model());
  assert.match(html, /以新换旧：打击义体\.vol2/);
  assert.match(html, /费用 <b>7000<\/b> 奎支（拆除费 1000 \+ 新义体 6000）/);
  assert.match(html, /先拆掉「打击义体\.vol1」，再装上「打击义体\.vol2」：义体不能升级，只能以新换旧/);
  assert.match(html, />(确认以新换旧|仍然安装)<\/button>/);
  assert.doesNotMatch(html, /坚毅|shp/i);
  const cmd = JSON.parse(html.match(/data-cw-cmd="([^"]+)"[^>]*>(确认以新换旧|仍然安装)/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(cmd, { action: "installCyberware", kit: "kolt", id: "strike_v2" });
  c.dispatch(Object.assign({ type: "run" }, cmd), { run: rr });
  assert.deepEqual(J(rr.party[0].cyberware), [{ id: "strike_v2" }]);
});

/* ---------- 可扩展：新种类只在种类表里加一项 ---------- */
test("可扩展：在 CYBERWARE_KINDS 里加一种（例：主动位移），诊所、图鉴、战斗、联机都认得，不用改别处", () => {
  const { c, S, a } = field("CWVX");
  run(c, `CYBERWARE_KINDS.test_dash = {
    name: "测试位移型",
    defaults: { fireShp: 1 },
    summary: d => "移动到相连的一区",
    lines: d => ["测试：移动到相连的一区。"],
    steps: (u, d) => [{ key: "dest", type: "zone", optional: false, label: "去哪一区", zones: zoneNeighbors(u.zone) }],
    run(u, d, ctx) {
      const dest = ctx.picks.dest != null ? Number(ctx.picks.dest) : null;
      if (dest == null) { ctx.lines.push("先选去哪一区。"); return false; }
      displaceTo(u, dest, ctx.lines, "测试位移");
    }
  };
  cyberwareRegister({ id: "dash_v1", name: "测试位移.vol1", tier: 5, kind: "test_dash", line: "dash" });`);
  // 图鉴：多一个分组、多一条
  assert.ok(J(c.codexCyberwareGroups()).some(g => g.id === "test_dash" && g.name === "测试位移型"));
  const e = J(c.codexCyberwareEntries()).find(x => x.cwId === "dash_v1");
  assert.equal(e.groupName, "测试位移型"); assert.deepEqual(e.effect, ["测试：移动到相连的一区。"]);
  assert.match(e.grit.join(""), /发动一次消耗 1 点坚毅生命/);
  assert.ok(!e.grit.some(s => /每一天/.test(s)), "这一种没有每天的消耗");
  // 诊所 / 联机：照样算改造率、能装；展示字段来自种类表
  const u = hero(20);
  assert.equal(J(c.cyberwareInstallPreview(u, "dash_v1")).ok, true);
  const row = J(c.cyberwareShopView(u)).find(r => r.id === "dash_v1");
  assert.equal(row.summary, "移动到相连的一区"); assert.equal(row.kindName, "测试位移型");
  assert.equal(V.projectCyberware({ kit: "t", view: J(c.cyberwareView(u)), shop: [row] }).shop[0].summary, "移动到相连的一区");
  // 战斗：技能列表、分步、发动（次数、坚毅照样由义体那边记）
  equip(c, a, ["dash_v1"]);
  assert.ok(c.skillList(a).some(s => s.id === "cw_dash_v1"));
  assert.deepEqual(J(c.skillFlowSteps("cw_dash_v1", a, {})).map(s => s.key), ["dest"]);
  a.shp = 10;
  S.attackerId = a.id; S.targetId = null;
  S.skillFlow = { id: "cw_dash_v1", actorId: a.id, picks: { dest: 2 }, index: 99 };
  c.runSkill("cw_dash_v1");
  S.skillFlow = null;
  assert.equal(Number(a.zone), 2);
  assert.equal(a.shp, 9);
  assert.equal(c.cyberwareUsesLeft(a, "dash_v1"), 0);
  // 不在 CYBERWARE_KINDS 里的种类直接报错，不会悄悄当成伤害型
  assert.throws(() => run(c, `cyberwareRegister({ id: "x", tier: 5, kind: "nope" })`), /没有这种义体/);
  // 种类自己的字段写错（单体伤害型的射程拼错）也是注册时就报错（validate），不会悄悄按近战算
  assert.throws(() => run(c, `cyberwareRegister({ id: "typo_v1", tier: 5, kind: "attack", range: "ranges" })`), /单体伤害型的射程只能是 melee \/ ranged：ranges/);
  assert.equal(c.cyberwareCatalog().some(d => d.id === "typo_v1"), false);
});

/* ---------- 画面：图鉴里的「义体」（没装 Playwright 时跳过） ---------- */
function findPlaywright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(require("node:child_process").execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
const pw = findPlaywright();
let browser;
test.before(async () => { try { if (pw) browser = await pw.chromium.launch(); } catch (e) { browser = null; } });
test.after(async () => { if (browser) await browser.close(); });

test("画面：图鉴里有「义体」这一本，按种类筛、能搜 .vol2，点开看详情（写坚毅消耗的规则，不写谁还剩多少）", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(require("node:url").pathToFileURL(path.join(H.ROOT, "game.html")).href);
  await page.click("#t-codex");
  await page.click('.bx [data-mode="cyber"]');
  assert.equal(await page.textContent(".bx-head h3"), "义体图鉴");
  assert.equal(await page.$$eval(".bx-grid .bx-card", ns => ns.length), 8);
  await page.click('.bx-tabs [data-filter="attack"]');
  assert.equal(await page.$$eval(".bx-grid .bx-card", ns => ns.length), 8);
  await page.fill(".bx-search", ".vol2");
  assert.equal(await page.$$eval(".bx-grid .bx-card", ns => ns.length), 2);
  await page.click(".bx-grid .bx-card");
  const detail = await page.textContent(".bx-detail");
  assert.match(detail, /义体 · 单体伤害型 · 10 级/);
  assert.match(detail, /打击义体\.vol2/);
  assert.match(detail, /发动一次消耗 2 点坚毅生命/);
  assert.match(detail, /以新换旧/);
  assert.deepEqual(errors, []);
});

/* ---------- README ---------- */
test("README：规则改动记录里有这次改动（在整节里找，不按字数截：上面别的记录再长也不影响）", () => {
  const readme = read("README.md");
  const start = readme.indexOf("## 规则改动记录");
  assert.ok(start >= 0, "README 有「规则改动记录」");
  const next = readme.indexOf("\n## ", start + 1);
  const entries = readme.slice(start, next < 0 ? readme.length : next).split(/\n(?=- \*\*)/);
  assert.ok(entries.some(s => /issue #262/.test(s) && /单体伤害型/.test(s) && /\.vol1/.test(s)), "有 #262 这一条");
});
