// #561：哔哩哩&滋啦啦「电光束」卡面写「对一个任意距离的敌人造成 1×atk 的电击伤害，施加感电」（主人 11/01 手操 2v2 决斗发现）。
//   以前：选目标、扣行动点都按卡面「任意距离」放行，伤害结算（app.js · dealToInner 的射程检查）却把没带标记的玩家攻击
//   当成「任意距离 = 距离 0–1」，距离 2 的目标打不到（「哔哩哩&滋啦啦 是任意距离攻击，打不到距离 2 的 夕夏。」）；
//   感电又不看这一击打没打中，照样挂上。
//   现在：电光束带不限距离的标记（flags.anyRange，现成的机制），距离 2 以上照常打；危墙 / 关着的门、屏障照旧挡。
//   感电挂在这一击上（onConnect：打中了才挂）——被屏障吃掉、隔着危墙、目标倒地不受伤害都不挂；被协助格挡挡下也不挂
//   （和其他用 onConnect 写的「打中附带状态」一样：敌人的感电 / 腐蚀 / 高能攻击、Mint 驱逐……），等协助格挡的那一击跟着格挡结果走；
//   有人替目标挨这一击（亡命之王身边的狂徒……）时挂在真正挨打的人身上。
//   顺带查过卡面写「任意距离」、会造成伤害的技能：拉斯缪尔「狂瀑」（按钮提示写任意距离、SKILL_RANGE 0–99）同样打不到距离 2，
//   一起带上 anyRange；Helumica 的协助攻击是反应，本来就不判射程（守卫）。选目标的名单、AI 的候选本来就列得出距离 2 的目标（守卫）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const logText = S => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");
const cmd = (c, o) => c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const armorOf = u => (u.layers.find(l => l.type === "armor") || {}).current;

/** 主人 11/01 手操的那场 2v2 决斗：1 队 川川 / 诺拉（先手，我方回合行动），2 队 夕夏 / 结人（敌人回合行动），Lv10、武器 5 级。
 *  3 区制：1 队站 1 区、2 队站 3 区。川川唤出哔哩哩&滋啦啦（站 1 区）；夕夏一层 34 装甲 + 厚血（打不倒）；
 *  结人先站到 2 区（不在夕夏身边，不会来协助格挡）。天气关掉 */
function duel(seed) {
  const party = ["chuan", "nora", "xia", "yuito"];
  const c = H.load();
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: seed || "beam-561" });
  const S = c.S.state;
  const [chuan, nora, xia, yuito] = party.map(k => c.findKit(k, S.units));
  [chuan, nora, xia, yuito].forEach(h => { h.level = 10; Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = 5; }); });
  c.Commands.dispatch({ type: "battle.duel", teams: { "1队": [chuan.id, nora.id], "2队": [xia.id, yuito.id] } });
  const keep = c.Math.random;
  c.Math.random = () => 0.1;   // 抛硬币：1 队先手
  try { c.startCombat(); } finally { c.Math.random = keep; }
  S.weather = "none";
  cmd(c, { actor: chuan.id, skill: "chuan_summon" });
  const bili = c.findKit("bili", S.units);
  assert.ok(bili && !bili.hidden, "前提：哔哩哩&滋啦啦在场");
  xia.layers = [{ type: "armor", current: 34, max: 34 }, { type: "flesh", current: 300, max: 300, inner: true }];
  yuito.zone = 2;
  return { c, S, chuan, nora, xia, yuito, bili, logs: () => logText(S) };
}
/** 哔哩哩站 zone 区，对夕夏放电光束（和手操一样走指令）；返回这一下写出的记录 */
function beam(f, zone) {
  const { c, S, bili, xia } = f;
  bili.zone = zone;
  bili.ap = 1;
  const from = S.logPages.flatMap(p => p.lines).length;
  cmd(c, { actor: bili.id, skill: "bili_beam", target: xia.id });
  assert.equal(bili.ap, 0, "扣了行动点（出手了）");
  return S.logPages.flatMap(p => p.lines).slice(from).map(l => l.text).join("\n");
}
const dist = (f, zone) => f.c.zoneDist(zone, f.xia.zone, f.S.zoneMode);

test("距离 2：电光束照常打出伤害、挂感电（#561 的现场：哔哩哩 1 区，夕夏 3 区）", () => {
  const f = duel();
  const { c, xia } = f;
  assert.equal(dist(f, 1), 2, "前提：距离 2");
  const hp0 = c.totalHp(xia);
  const log = beam(f, 1);
  assert.doesNotMatch(log, /打不到距离 2/, "不再被「任意距离 0–1」拦下");
  assert.ok(c.totalHp(xia) < hp0, `打出了伤害（${hp0} → ${c.totalHp(xia)}）`);
  assert.ok(armorOf(xia) < 34, "夕夏的装甲掉了");
  assert.equal(xia.statuses.shock, true, "挂上感电");
  assert.match(log, /夕夏 被施加感电/);
});

test("距离 2 和距离 1 打出的伤害一样（电光束没有骰子，1×atk）", () => {
  const dealt = zone => {
    const f = duel();
    const hp0 = f.c.totalHp(f.xia);
    beam(f, zone);
    return hp0 - f.c.totalHp(f.xia);
  };
  const far = dealt(1), near = dealt(2);
  assert.ok(near > 0, "距离 1 打得出伤害");
  assert.equal(far, near, `距离 2（${far}）和距离 1（${near}）一样`);
});

test("守卫：距离 0、1 照旧打出伤害、挂感电", () => {
  for (const zone of [3, 2]) {
    const f = duel();
    const { c, xia } = f;
    assert.equal(dist(f, zone), zone === 3 ? 0 : 1);
    const hp0 = c.totalHp(xia);
    const log = beam(f, zone);
    assert.ok(c.totalHp(xia) < hp0, `距离 ${dist(f, zone)}：打出了伤害`);
    assert.equal(xia.statuses.shock, true, `距离 ${dist(f, zone)}：挂上感电`);
    assert.match(log, /夕夏 被施加感电/);
  }
});

test("打不出去不挂感电：被屏障（结人的防护罩）挡下——距离 2、距离 1 都一样，墙照旧挡", () => {
  for (const zone of [1, 2]) {
    const f = duel();
    const { c, S, xia, yuito } = f;
    // 和生存职责「防护罩」（app.js · role_dome）放出来的一样：屏障配置物，按放的人（结人）的玩家阵营护着夕夏
    const dome = c.makeProp("dome", 3, 10);
    dome.hp = dome.maxHp = 200;
    dome.ownerId = yuito.id;
    S.props.push(dome);
    const hp0 = c.totalHp(xia);
    const log = beam(f, zone);
    assert.equal(c.totalHp(xia), hp0, `距离 ${dist(f, zone)}：夕夏被防护罩护住`);
    assert.ok(dome.hp < 200, `距离 ${dist(f, zone)}：这一下打在防护罩上`);
    assert.notEqual(xia.statuses.shock, true, `距离 ${dist(f, zone)}：没打中夕夏，不挂感电`);
    assert.doesNotMatch(log, /夕夏 被施加感电/);
  }
});

test("打不出去不挂感电：隔着危墙（距离 2、距离 1 都一样）", () => {
  for (const zone of [1, 2]) {
    const f = duel();
    const { c, S, xia } = f;
    S.gaps["2-3"] = Object.assign(c.emptyGap(), { type: "wall", hp: 10, maxHp: 10 });
    const hp0 = c.totalHp(xia);
    const log = beam(f, zone);
    assert.match(log, /危墙挡住/, `距离 ${dist(f, zone)}：被危墙挡下`);
    assert.equal(c.totalHp(xia), hp0);
    assert.notEqual(xia.statuses.shock, true, `距离 ${dist(f, zone)}：不挂感电`);
    assert.doesNotMatch(log, /夕夏 被施加感电/);
  }
});

test("打不出去不挂感电：夕夏倒地没起身（起身之前不受任何伤害）", () => {
  const f = duel();
  const { c, xia } = f;
  xia.layers.forEach(l => { l.current = 0; });
  xia.dying = true; xia.upOnShp = false;
  assert.ok(c.isDownProtected(xia), "前提：倒地没起身");
  const log = beam(f, 1);
  assert.match(log, /夕夏 濒死倒地，起身之前不受任何伤害/);
  assert.notEqual(xia.statuses.shock, true, "没打中：不挂感电");
  assert.doesNotMatch(log, /夕夏 被施加感电/);
});

test("有人替目标挨这一击（亡命之王身边的狂徒）：感电挂在真正挨打的狂徒身上，没挨打的亡命之王不挂", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["chuan", "kolt"], enemies: [{ id: "outlaw_king", lv: 3, zone: 3 }, { id: "thug_knife", lv: 3, zone: 3 }], zoneMode: 3, seed: "guard-561" });
  c.startCombat();
  const S = c.S.state;
  const bili = c.spawnWeapon(c.findKit("chuan", S.units), "bili");
  const king = S.units.find(u => u.kit === "outlaw_king");
  S.units.filter(u => !u.isPlayer).forEach(u => { u.zone = 3; });
  const guard = c.kingGuardFor(king);
  assert.ok(guard, "前提：同区有狂徒替亡命之王挨打");
  bili.zone = 2; bili.ap = 1;   // 距离 1：只看代挡，不牵扯射程
  const kingHp = c.totalHp(king), guardHp = c.totalHp(guard);
  S.attackerId = bili.id; S.targetId = king.id;
  c.runSkill("bili_beam");
  assert.equal(c.totalHp(king), kingHp, "亡命之王没挨打");
  assert.ok(c.totalHp(guard) < guardHp, "狂徒替他挨了这一下");
  assert.equal(guard.statuses.shock, true, "感电挂在挨打的狂徒身上");
  assert.notEqual(king.statuses.shock, true, "没挨打的亡命之王不挂（以前挂在选中的目标身上）");
});

test("协助格挡：结果出来之前不挂；挡下了不挂感电（和其他打中附带状态的一样）；没挡住照常受伤、挂感电", () => {
  for (const ok of [true, false]) {
    const f = duel();
    const { c, S, xia, yuito, bili } = f;
    yuito.zone = 3; yuito.bonus = 1;   // 结人站到夕夏身边，手上 1 个附赠：能替她协助格挡
    assert.ok(c.eligibleBlockers(xia, { attackerId: bili.id }).includes(yuito), "前提：结人能替夕夏协助格挡");
    const hp0 = c.totalHp(xia);
    beam(f, 1);
    assert.equal((S.blockQueue || []).length, 1, "距离 2 的电光束打得出去：排进协助格挡队列");
    assert.notEqual(xia.statuses.shock, true, "格挡结果出来之前不挂感电");
    const from = S.logPages.flatMap(p => p.lines).length;
    c.finishBlock(yuito.id, ok ? { roll: 1, ok: true } : { roll: 99, ok: false });
    const after = S.logPages.flatMap(p => p.lines).slice(from).map(l => l.text).join("\n");
    if (ok) {
      assert.equal(c.totalHp(xia), hp0, "挡下：夕夏免伤");
      assert.notEqual(xia.statuses.shock, true, "挡下：不挂感电");
      assert.match(after, /格挡成功：位移与其他附带效果未生效/);
      assert.doesNotMatch(after, /夕夏 被施加感电/);
    } else {
      assert.ok(c.totalHp(xia) < hp0, "没挡住：照常受伤");
      assert.equal(xia.statuses.shock, true, "没挡住：挂上感电");
      assert.match(after, /夕夏 被施加感电/);
    }
  }
});

test("选目标的名单、AI 的候选动作本来就列得出距离 2 的夕夏（守卫）；悬停预演现在看得到打过去的伤害", () => {
  const f = duel();
  const { c, xia, bili } = f;
  bili.zone = 1; bili.ap = 1;
  // 守卫：AI（sim-search.js · candidatesFor）按卡面射程列候选，以前就有
  const cands = c.BattleSearch.candidatesFor(bili, c.S.SKILL_POLICY_CFG);
  assert.ok(cands.some(x => x.type === "skill" && x.skill === "bili_beam" && x.target === xia.id), "AI 的候选里有电光束打距离 2 的夕夏");
  // 战斗画面（game.js · candidateUnits / previewOf）
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8"), c, { filename: "game.js" });
  const sk = c.GAME.gameSkills(bili).find(s => s.id === "bili_beam");
  assert.ok(sk, "前提：技能栏里有电光束");
  assert.ok(c.GAME.candidateUnits(bili, sk).some(u => u.id === xia.id), "守卫：选目标的名单里有距离 2 的夕夏（以前就有）");
  // 以前预演里这一下被射程拦下，只看得到感电
  const pv = c.GAME.previewOf(c.GAME.skillThunk(bili.id, "bili_beam", xia.id, {}));
  assert.equal(pv.meaningful, true);
  assert.ok(pv.units.get(xia.id).dmgHi > 0, "悬停预演看得到打到距离 2 的伤害");
});

test("顺带：拉斯缪尔「狂瀑」（提示写任意距离）打距离 2 的高能敌人，每一下都打得到（和距离 1 打出的一样多）", () => {
  /** 拉斯缪尔站 zone 区，对 3 区的高能狂徒放狂瀑（能量 40%：累积 3 次、打 3 下 0.2atk）；返回打出的伤害和记录 */
  const torrent = zone => {
    const c = H.load();
    c.BattleSim.setup({ party: ["ras", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 3 }], zoneMode: 3, seed: "torrent-561" });
    c.startCombat();
    const S = c.S.state;
    S.weather = "none";
    const ras = c.findKit("ras", S.units), foe = S.units.find(u => !u.isPlayer);
    ras.level = 11; ras.zone = zone; ras.ap = 3;
    ras.layers.forEach(l => { l.current = l.max = 500; });
    ras.resources.energyPct = 40;
    foe.zone = 3;
    foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
    foe.statuses.high = true;
    assert.ok(c.skillList(ras).some(s => s.id === "ras_torrent" && /任意距离/.test(s.hint)), "前提：狂瀑的提示写着任意距离");
    const hp0 = c.totalHp(foe);
    S.attackerId = ras.id; S.targetId = foe.id;
    c.runSkill("ras_torrent");
    assert.equal(ras.resources.energyPct, 100, "能量累积到 100%");
    return { dist: c.zoneDist(zone, foe.zone, S.zoneMode), dealt: hp0 - c.totalHp(foe), log: logText(S) };
  };
  const far = torrent(1), near = torrent(2);
  assert.equal(far.dist, 2, "前提：距离 2");
  assert.equal(near.dist, 1);
  assert.doesNotMatch(far.log, /打不到距离 2/, "不再被「任意距离 0–1」拦下");
  assert.ok(near.dealt > 0, "距离 1 打得出伤害");
  assert.equal(far.dealt, near.dealt, `距离 2（${far.dealt}）和距离 1（${near.dealt}）一样：3 下都打到了`);
});

test("守卫：Helumica 的协助攻击（卡面任意距离）本来就打得到距离 2——协助名单里有她，谐波伤害照常打出", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["helu", "kolt"], enemies: [{ id: "thug_hammer", lv: 1, zone: 3 }], zoneMode: 3, seed: "helu-561" });
  c.startCombat();
  const S = c.S.state;
  S.weather = "none";
  const helu = c.findKit("helu", S.units), kolt = c.findKit("kolt", S.units), foe = S.units.find(u => !u.isPlayer);
  helu.zone = 1; kolt.zone = 3; foe.zone = 3;
  foe.layers = [{ type: "flesh", current: 500, max: 500, inner: true }];
  foe.def = 0; foe.stunned = true;
  assert.equal(c.zoneDist(helu.zone, foe.zone, S.zoneMode), 2, "前提：距离 2");
  assert.ok(c.eligibleAssisters(kolt, foe).some(u => u.id === helu.id), "协助名单里有距离 2 的 Helumica");
  const hp0 = c.totalHp(foe);
  S.assistQueue = [{ breakerId: kolt.id, targetId: foe.id, vsPlayer: false }];
  c.finishAssist(helu.id);
  assert.doesNotMatch(logText(S), /打不到距离 2/);
  assert.ok(c.totalHp(foe) < hp0, "距离 2 照样打出谐波伤害");
});
