// #379：矿场警戒自动机（休眠）——我方单位进入它所在的区，不管是怎么进去的都要叫醒它，并给吵醒它的人施加高能。
// 以前只有自己走（doMoveInner）、被推 / 拉（displaceTo）会叫醒（tests/mine3-enemies.test.js）；技能里直接换区（直流短接、居合先移动、
// 圣战起始、协助攻击跟到目标那一区……）、紧追跟上、灯协助格挡成功跟到进攻者那一区、夕夏回合开始跟上抓着的敌人都叫不醒
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "tou"], enemies, seed: "WAKE379", zoneMode: opt.zoneMode || 2 });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { if (u.isPlayer) { u.zone = 1; u.ap = 5; u.bonus = 5; u.statuses.high = false; u.highEnergy = 0; } });
  return {
    c, S,
    P: k => c.findKit(k, S.units),
    E: k => S.units.find(u => !u.isPlayer && u.kit === k && !u.dead),
    logs: () => S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n")
  };
}
const cmd = (f, o) => f.c.Commands.dispatch(plain(Object.assign({ type: "skill" }, o)));
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 日志里写着「谁 进入它所在的区，解除休眠」 */
const wokeBy = (text, u) => new RegExp(`${esc(u.name)} 进入它所在的区，解除休眠`).test(text);

test("技能里直接换区（直流短接）走进它的区：解除休眠，给走进来的人施加高能；走到别的区、开场就在同区的人唤出武器人都不算", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 3 }], { zoneMode: 3 });
  const bot = f.E("alarm_bot"), k = f.P("kolt"), tou = f.P("tou");
  tou.zone = 3;   // 开场就和它同区
  cmd(f, { actor: tou.id, skill: "tou_summon" });
  const mochi = f.P("mochi");
  assert.ok(mochi && Number(mochi.zone) === 3, "年糕唤出在 3 区");
  assert.equal(bot.dormant, true, "这次行动里才上场的（唤出）不算进区");
  cmd(f, { actor: k.id, skill: "kolt_short", picks: { dest: 2 } });
  assert.equal(k.zone, 2);
  assert.equal(bot.dormant, true, "走到没有它的区：不叫醒");
  cmd(f, { actor: k.id, skill: "kolt_short", picks: { dest: 3 } });
  assert.equal(k.zone, 3, "直流短接移动到 3 区");
  assert.equal(bot.dormant, false, "技能里移动进它的区：醒");
  assert.equal(k.statuses.high, true, "吵醒它的柯尔特被施加高能");
  assert.ok(wokeBy(f.logs(), k), "日志写明是柯尔特走进来吵醒的");
  assert.ok(!tou.statuses.high && !mochi.statuses.high, "本来就在那一区的不挂高能");
});

test("技能先移动再出手（居合普攻）：出手之前就叫醒——吵醒它的是走进来这一下，不是挨打；高能只挂一次", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }], { party: ["hiaki", "kolt"] });
  const bot = f.E("alarm_bot"), h = f.P("hiaki");
  h.resources.stance = "iai";
  const hp0 = f.c.totalHp(h);
  cmd(f, { actor: h.id, skill: "hiaki_aa", target: bot.id });
  assert.equal(h.zone, 2, "居合先移动到 2 区");
  assert.equal(bot.dormant, false);
  const text = f.logs();
  assert.ok(wokeBy(text, h), "写的是绯秋走进来吵醒的");
  assert.doesNotMatch(text, /受到攻击，解除休眠/, "不是挨了这一下才醒");
  assert.ok(text.indexOf("解除休眠") === text.lastIndexOf("解除休眠"), "只叫醒一次");
  assert.equal(h.statuses.high, true);
  assert.equal(f.c.totalHp(h), hp0, "高能只挂一次：没有再改成 1 点能量伤害");
});

test("一起到的（圣战起始耗圣盾带人同行）：吵醒它的算出手的灯，被带着的人不挂高能", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }]);
  const bot = f.E("alarm_bot"), tou = f.P("tou"), k = f.P("kolt");
  tou.resources.shield = 3;
  cmd(f, { actor: tou.id, skill: "tou_start", target: bot.id, picks: { dest: 2, target: bot.id, carryMode: "yes", carry: k.id } });
  assert.deepEqual([tou.zone, k.zone], [2, 2], "灯带着柯尔特一起到 2 区");
  assert.equal(bot.dormant, false);
  assert.equal(tou.statuses.high, true, "出手的灯被施加高能");
  assert.equal(k.statuses.high, false, "被带着的柯尔特不挂");
  assert.ok(wokeBy(f.logs(), tou));
});

test("被别人带进它的区（点火突进带着队友飞过去）：叫醒，吵醒它的算出手的柏妮尔，被带着的人不挂高能", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }], { party: ["xia", "kolt"] });
  const bot = f.E("alarm_bot"), x = f.P("xia"), k = f.P("kolt");
  cmd(f, { actor: x.id, skill: "xia_summon" });
  const b = f.P("berniel");
  assert.ok(b, "柏妮尔唤出");
  b.zone = 1; b.ap = 5; b.bonus = 5; b.statuses.high = false;
  assert.equal(bot.dormant, true);
  cmd(f, { actor: b.id, skill: "berniel_dash", picks: { dest: 2, carry: k.id } });
  assert.deepEqual([b.zone, k.zone], [2, 2], "柏妮尔带着柯尔特飞到 2 区");
  assert.equal(bot.dormant, false, "被带进来：醒");
  assert.equal(b.statuses.high, true, "出手的柏妮尔被施加高能");
  assert.equal(k.statuses.high, false, "被带着的柯尔特不挂");
  assert.ok(wokeBy(f.logs(), b));
});

test("三方混战：协助攻击跟到失衡的异星生物那一区（警戒自动机也在）——打的是异星生物也照样叫醒，跟进来的人被施加高能", () => {
  const f = field([{ id: "meteor_spider", lv: 5, zone: 2 }, { id: "alarm_bot", lv: 5, zone: 2 }]);
  const bot = f.E("alarm_bot"), sp = f.E("meteor_spider"), k = f.P("kolt"), tou = f.P("tou");
  sp.layers.forEach(l => { l.max = 999; l.current = 999; });
  const hp0 = f.c.totalHp(sp);
  sp.def = 0; sp.stunned = true;
  f.c.queueAssistAttack(tou, sp);
  f.c.finishAssist(k.id);
  assert.equal(k.zone, 2, "柯尔特协助攻击跟到 2 区");
  assert.ok(f.c.totalHp(sp) < hp0, "打到了衍蛛");
  assert.equal(bot.dormant, false, "异星生物挨打不算同伙挨打，跟进来这一下叫醒");
  assert.equal(k.statuses.high, true);
  assert.ok(wokeBy(f.logs(), k));
});

test("紧追跟上走进它的区：叫醒，给跟进来的人施加高能（被紧追的是它的同伙，自己走进来不叫醒）", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }, { id: "meteor_miner", lv: 5, zone: 1 }]);
  const bot = f.E("alarm_bot"), m = f.E("meteor_miner"), k = f.P("kolt");
  m.statuses.chase = true; m.chasers = [k.id]; m.statuses.high = false;
  f.c.doMove(m, 2, { free: true });
  assert.equal(m.zone, 2);
  assert.equal(k.zone, 2, "柯尔特紧追跟上");
  assert.equal(bot.dormant, false, "紧追跟进来：醒");
  assert.equal(k.statuses.high, true);
  assert.equal(m.statuses.high, false, "同伙走进来不算");
  assert.ok(wokeBy(f.logs(), k));
});

test("灯协助格挡成功、跟到进攻者那一区：叫醒，灯被施加高能；本来就在进攻者那一区不算", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }, { id: "meteor_miner", lv: 5, zone: 2 }]);
  const bot = f.E("alarm_bot"), m = f.E("meteor_miner"), tou = f.P("tou"), k = f.P("kolt");
  tou.zone = 2; k.zone = 2;   // 开场就和它同区：开采机打柯尔特，灯挡下，「移到进攻者那一区」没有换区
  let out = f.c.performAssistBlock(tou, k, m, { ok: true, roll: 1 });
  assert.equal(out.ok, true);
  assert.equal(bot.dormant, true, "没有换区：不叫醒");
  tou.zone = 1; k.zone = 1;   // 开采机隔一区打柯尔特，灯挡下后跟到 2 区
  out = f.c.performAssistBlock(tou, k, m, { ok: true, roll: 1 });
  assert.equal(out.ok, true);
  assert.equal(tou.zone, 2, "灯移动到进攻者所在的 2 区");
  assert.equal(bot.dormant, false, "跟到进攻者那一区：醒");
  assert.equal(tou.statuses.high, true);
  assert.ok(wokeBy(out.notes.join("\n"), tou));
});

test("夕夏抓着的敌人走进它的区，回合开始夕夏跟过去再碾：叫醒，夕夏被施加高能", () => {
  const f = field([{ id: "alarm_bot", lv: 5, zone: 2 }, { id: "sand_beast", lv: 5, zone: 1 }], { party: ["xia", "kolt"] });
  const bot = f.E("alarm_bot"), foe = f.E("sand_beast"), x = f.P("xia");
  foe.layers.forEach(l => { l.max = 999; l.current = 999; }); foe.def = foe.defMax = 30;
  x.resources.crushId = foe.id;
  f.c.doMove(foe, 2, { free: true });
  assert.equal(foe.zone, 2);
  assert.equal(bot.dormant, true, "沙灵和安保不敌对：它自己走进去不叫醒");
  assert.equal(x.zone, 1, "夕夏还没跟过去");
  const notes = [];
  f.c.beginRound(notes);
  assert.equal(x.zone, 2, "回合开始夕夏跟过去");
  assert.ok(f.c.totalHp(foe) < 999 * foe.layers.length, "照常碾到");
  assert.equal(bot.dormant, false, "跟进来：醒");
  assert.equal(x.statuses.high, true);
  assert.ok(wokeBy(notes.join("\n"), x));
});
