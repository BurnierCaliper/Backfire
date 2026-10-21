"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Hotseat, LocalTransport } = require("../hotseat");
const H = require("./headless");
const plain = value => JSON.parse(JSON.stringify(value));
function hero(id, kit) { return { id, kit, name: kit, isPlayer: true, shp: 10, layers: [{ current: 20 }] }; }
function fixture(options = {}) {
  let units = options.units || [hero("ruby", "ruby"), hero("hiaki", "hiaki"), hero("xia", "xia")];
  let time = 1000;
  const s = Hotseat.create({ operators: [{ id: "gm", name: "主持人" }, { id: "a", name: "甲" }, { id: "b", name: "乙" }], gmId: "gm",
    assignments: { ruby: "a", hiaki: "b" }, getUnits: () => units, now: () => time, canStand: u => u.shp > 0 && !u.exhausted, ...options });
  return { s, get units() { return units; }, setUnits(v) { units = v; }, advance(ms) { time += ms; } };
}
function force(f) { f.s.beginRound(1); f.s.forceStart("gm"); }

for (const count of [2, 3, 4]) test(`${count} 个操作者完整选序、按单位完成并交给敌方`, () => {
  const kits = ["ruby", "hiaki", "xia", "kolt"].slice(0, count), units = kits.map((k, i) => hero("h" + i, k));
  const operators = units.map((u, i) => ({ id: "p" + i, name: "玩家" + i }));
  const assignments = Object.fromEntries(units.map((u, i) => [u.id, "p" + i]));
  const s = Hotseat.create({ mode: "coop", operators, gmId: "p0", assignments, getUnits: () => units });
  s.beginRound(1);
  for (let i = 0; i < count; i++) { s.pick("p" + i, units[i].id, i); s.confirm("p" + i); }
  assert.equal(s.snapshot().phase, "acting");
  for (let i = 0; i < count; i++) {
    assert.equal(s.snapshot().currentUnitId, units[i].id);
    assert.equal(s.assertAction("p" + i, units[i].id), true);
    assert.equal(s.finishUnit("p" + i).roundDone, i === count - 1);
  }
  assert.equal(s.snapshot().phase, "enemy");
  s.beginRound(2); assert.ok(s.snapshot().slots.every(x => x === null));
});

test("未分配英雄由GM代管，武器按主人一对多；支援伙伴和非角色召唤物不占格", () => {
  const units = [hero("h", "hiaki"), hero("g", "ruby"),
    { ...hero("w1", "niu"), weaponOf: "hiaki" }, { ...hero("w2", "naruto"), weaponOf: "h" },
    { ...hero("held", "mint"), weaponOf: "ruby", hidden: true },
    { ...hero("partner", "kolt"), isPartner: true }, hero("summon", "unknown_summon"),
    { ...hero("foe", "ruby"), isPlayer: false }];
  const { s } = fixture({ units, assignments: { h: "a" } });
  assert.deepEqual(s.snapshot().roster.map(r => [r.unitId, r.operatorId]), [["h", "a"], ["g", "gm"], ["w1", "a"], ["w2", "a"]]);
  s.beginRound(1); s.pick("a", "h", 0);
  assert.throws(() => s.confirm("a"), /全部单位/);
  s.pick("a", "w1", 2); s.pick("a", "w2", 3); s.confirm("a");
  assert.equal(s.snapshot().phase, "selecting");
  s.pick("gm", "g", 1); s.confirm("gm"); assert.equal(s.snapshot().phase, "acting");
});

test("倒地能起身保留顺位，不可起身、永久死亡、融合或离场单位排除", () => {
  const units = [
    { ...hero("rise", "ruby"), dying: true, layers: [{ current: 0 }] },
    { ...hero("exhaust", "hiaki"), dying: true, exhausted: true, layers: [{ current: 0 }] },
    { ...hero("grit", "xia"), dying: true, shp: 0, layers: [{ current: 0 }] },
    { ...hero("dead", "kolt"), dead: true }, { ...hero("fused", "yuito"), fused: true },
    { ...hero("gone", "chuan"), _removed: true }
  ];
  const { s } = fixture({ units, assignments: {} });
  assert.deepEqual(s.snapshot().roster.map(r => r.unitId), ["rise"]);
  s.beginRound(1); s.forceStart("gm"); assert.equal(s.assertAction("gm", "rise"), true);
  units[0].dying = false; units[0].upOnShp = true; s.reconcile();
  assert.equal(s.snapshot().slots[0].spent, false, "起身的既有规则不扣点，D2不能额外锁点");
  units[0].dead = true; s.reconcile(); assert.equal(s.snapshot().phase, "enemy");
});

test("选格先到先得，可以改空格；只有房主可用当前格子开始", () => {
  const f = fixture(), s = f.s; s.beginRound(1);
  s.pick("a", "ruby", 1);
  const before = s.snapshot(); assert.throws(() => s.pick("b", "hiaki", 1), /已被占用/);
  assert.deepEqual(s.snapshot(), before);
  s.pick("a", "ruby", 2); assert.equal(s.snapshot().slots[1], null);
  assert.throws(() => s.forceStart("a"), /房主/);
  s.forceStart("gm");
  assert.deepEqual(s.snapshot().slots.map(r => r.unitId), ["hiaki", "xia", "ruby"]);
});

test("归属和顺位拒绝，主机也不能普通操作别人的角色", () => {
  const f = fixture(), s = f.s;
  assert.throws(() => s.assertAction("a", "ruby"), /不能操作/);
  s.beginRound(1); assert.throws(() => s.assertAction("a", "ruby"), /确定行动顺序/);
  s.forceStart("gm");
  assert.throws(() => s.assertAction("b", "ruby"), /不是你的/);
  assert.throws(() => s.assertAction("gm", "ruby"), /不是你的/);
  assert.throws(() => s.assertAction("b", "hiaki"), /还没轮到/);
  assert.throws(() => s.finishUnit("b", "hiaki"), /还没轮到/);
});

test("开场反应已花点的单位可首次选位，落格后不能通过再次pick绕过锁定", () => {
  const f = fixture(), s = f.s; s.beginRound(1);
  s.markSpent([{ unitId: "hiaki", ap: 0, bonus: 1 }]);
  s.pick("b", "hiaki", 2); s.confirm("b");
  assert.equal(s.snapshot().slots[2].spent, true);
  const before = s.snapshot();
  assert.throws(() => s.pick("b", "hiaki", 1), /固定/);
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual(s.pick("b", "hiaki", 2), before, "同一位置幂等，保留已确认状态");
  s.pick("a", "ruby", 0);
  s.forceStart("gm");
  assert.deepEqual(s.snapshot().slots.map(r => r.unitId), ["ruby", "xia", "hiaki"]);
  assert.equal(s.snapshot().slots[2].spent, true);
});

test("未花点当前单位能让位；移到尾部留空，固定格的绝对位置不变", () => {
  const f = fixture(), s = f.s; force(f);
  const first = s.move("a", "ruby", 3);
  assert.equal(first.status, "moved"); assert.equal(s.snapshot().slots[0], null);
  assert.equal(s.snapshot().currentUnitId, "hiaki");
  s.markSpent([{ unitId: "hiaki", ap: 0, bonus: 1 }]);
  assert.throws(() => s.move("b", "hiaki", 4), /固定/);
  assert.throws(() => s.move("a", "ruby", 0), /固定格子之后/);
  s.move("a", "ruby", 4);
  assert.equal(s.snapshot().slots[1].unitId, "hiaki");
  assert.equal(s.snapshot().slots[3], null);
});

test("后位反应锁定后，前方未行动者仍可移到尾部空格且不挤动锁格", () => {
  const f = fixture(), s = f.s; force(f);
  s.markSpent([{ unitId: "xia", ap: 0, bonus: 1 }]);
  s.move("a", "ruby", 3);
  assert.deepEqual(s.snapshot().slots.map(r => r && r.unitId), [null, "hiaki", "xia", "ruby"]);
  assert.equal(s.snapshot().slots[2].spent, true);
  assert.throws(() => s.move("b", "hiaki", 3), /互换双方/);
  assert.equal(s.snapshot().slots[2].unitId, "xia");
});

test("只认实际正支出；扣后退款不会解锁，完成格固定，新回合才清锁", () => {
  const f = fixture(), s = f.s; force(f);
  s.markSpent([{ unitId: "ruby", ap: 0, bonus: 0 }]); assert.equal(s.snapshot().slots[0].spent, false);
  s.markSpent([{ unitId: "ruby", ap: 1, bonus: 0 }]);
  s.markSpent([{ unitId: "ruby", ap: -1, bonus: 0 }]); assert.equal(s.snapshot().slots[0].spent, true);
  s.finishUnit("a"); assert.equal(s.snapshot().slots[0].completed, true);
  assert.throws(() => s.move("a", "ruby", 3), /固定/);
  s.finishUnit("b"); s.finishUnit("gm"); s.beginRound(2); s.forceStart("gm");
  assert.ok(s.snapshot().slots.every(r => !r.spent && !r.completed));
});

test("跨主人互换需目标主人同意，其他人不能代答或操作请求", () => {
  const f = fixture(), s = f.s; force(f);
  const before = s.snapshot().slots;
  const request = s.move("a", "ruby", 1); assert.equal(request.status, "pending");
  assert.deepEqual(s.snapshot().slots, before);
  assert.throws(() => s.acceptSwap("gm", request.requestId, true), /不是发给你/);
  s.acceptSwap("b", request.requestId, true);
  assert.deepEqual(s.snapshot().slots.map(r => r.unitId), ["hiaki", "ruby", "xia"]);
  assert.throws(() => s.acceptSwap("b", request.requestId, true), /失效/);
  const second = s.move("b", "hiaki", 1); s.acceptSwap("a", second.requestId, false);
  assert.equal(s.snapshot().slots[0].unitId, "hiaki");
});

test("同主人直接换，跑团GM可以直接调别人，合作房主没有GM越权", () => {
  const f = fixture({ assignments: { ruby: "a", hiaki: "a" } }); force(f);
  assert.equal(f.s.move("a", "ruby", 1).status, "moved");
  assert.equal(f.s.move("gm", "ruby", 2).status, "moved");
  const coop = fixture({ mode: "coop" }); force(coop);
  assert.throws(() => coop.s.move("gm", "ruby", 1), /不是你的/);
});

test("互换期间花点或离场让请求失效", () => {
  const f = fixture(), s = f.s; force(f);
  const first = s.move("a", "ruby", 1);
  s.markSpent([{ unitId: "hiaki", bonus: 1, ap: 0 }]);
  assert.throws(() => s.acceptSwap("b", first.requestId, true), /失效/);
  assert.equal(s.snapshot().pendingSwaps.length, 0);
});

test("真实绯秋武器新id再唤出继承同回合支出锁，恢复融合单位也保留锁", () => {
  const c = H.load(); c.BattleSim.setup({ party: ["hiaki", "ruby"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "D2-WEAPON" }); c.startCombat();
  const st = c.S.state, h = c.findKit("hiaki", st.units), ruby = c.findKit("ruby", st.units);
  const s = Hotseat.create({ operators: ["a", "b"], gmId: "a", assignments: { [h.id]: "a", [ruby.id]: "b" }, getUnits: () => st.units, canStand: u => !c.standUpBlocked(u) });
  s.beginRound(1); s.forceStart("a");
  c.dispatch({ type: "skill", actor: h.id, skill: "hiaki_summon", target: null, picks: { blade: "niu" } });
  s.reconcile();
  const firstWeapon = st.units.find(u => u.kit === "niu" && !u.hidden);
  assert.ok(firstWeapon); assert.equal(s.snapshot().slots.at(-1).unitId, firstWeapon.id); assert.equal(s.ownerOf(firstWeapon.id), "a");
  s.markSpent([{ unitId: firstWeapon.id, ap: 1, bonus: 0 }]);
  firstWeapon.hidden = true; s.reconcile(); assert.equal(s.ownerOf(firstWeapon.id), null);
  const replacement = { ...plain(firstWeapon), id: "new-niu-id", hidden: false };
  st.units = st.units.filter(u => u.id !== firstWeapon.id).concat(replacement); s.reconcile();
  assert.equal(s.snapshot().slots.at(-1).unitId, replacement.id); assert.equal(s.snapshot().slots.at(-1).spent, true);
  assert.throws(() => s.move("a", replacement.id, s.snapshot().slots.length), /固定/);
  replacement.fused = true; s.reconcile(); replacement.fused = false; s.reconcile();
  assert.equal(s.snapshot().slots.at(-1).spent, true);
});

test("协助只给候选操作者选项，同一主人可选自己的多个单位；最先同意者生效", () => {
  const f = fixture({ units: [hero("ruby", "ruby"), hero("hiaki", "hiaki"), hero("xia", "xia"), { ...hero("niu", "niu"), weaponOf: "hiaki" }] }), s = f.s;
  force(f);
  const closed = []; s.onAskClosed(x => closed.push(x));
  const ask = s.openAsk({ kind: "block", jobId: 5, targetId: "ruby", candidates: ["hiaki", "niu", "xia"] });
  assert.deepEqual(s.askFor("a").options, []);
  assert.deepEqual(s.askFor("b").options.map(x => x.unitId), ["hiaki", "niu"]);
  assert.equal(Object.hasOwn(s.snapshot().ask, "candidates"), false);
  assert.throws(() => s.answer("a", ask.id, { unitId: "hiaki" }), /没有发给你/);
  assert.throws(() => s.answer("b", ask.id, { unitId: "xia" }), /其他单位/);
  const accepted = s.answer("b", ask.id, { unitId: "niu", extra: {} });
  assert.equal(accepted.accepted, true);
  const late = s.answer("gm", ask.id, { unitId: "xia" }); assert.equal(late.accepted, false);
  assert.equal(late.result.unitId, "niu"); assert.equal(closed.length, 1);
  assert.equal(s.snapshot().ask, null);
});

test("协助不要求当前顺位，等待中普通行动暂停，全部拒绝或20秒到期不协助", () => {
  const f = fixture(), s = f.s; force(f);
  let ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"] });
  assert.throws(() => s.assertAction("a", "ruby"), /等待协助/);
  assert.equal(s.answer("b", ask.id, { unitId: null }).status, "waiting");
  assert.equal(s.askFor("b").declined, true); assert.deepEqual(s.askFor("b").options, []);
  assert.equal(s.answer("gm", ask.id, { unitId: null }).result.reason, "declined");
  ask = s.openAsk({ kind: "assist", candidates: ["hiaki"] });
  assert.equal(s.askFor("b").deadline, 21000);
  f.advance(19999); s.tick(); assert.ok(s.snapshot().ask);
  f.advance(1); assert.equal(s.answer("b", ask.id, { unitId: "hiaki" }).result.reason, "timeout");
  assert.equal(s.snapshot().ask, null); assert.equal(s.assertAction("a", "ruby"), true);
});

test("联机协助攻击：其他玩家举手，打出失衡的玩家从举手的人里选；不选就不发动，到时间由最先举手的人出手", () => {
  const f = fixture(), s = f.s; force(f);
  // 瑞比（甲）打出失衡：乙（绯秋）、主持人（夕夏）能协助
  let ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"], chooser: "a" });
  assert.equal(s.askFor("a").isChooser, true);
  assert.equal(s.askFor("a").eligible, false, "还没人举手，甲没有可选的");
  const r = s.answer("b", ask.id, { unitId: "hiaki", extra: { blade: "naruto" } });
  assert.equal(r.status, "waiting"); assert.equal(r.raised, true);
  assert.equal(s.snapshot().ask.hands.length, 1, "举手不会直接出手");
  assert.equal(s.askFor("b").raised, "hiaki");
  s.answer("gm", ask.id, { unitId: "xia" });
  assert.deepEqual(plain(s.askFor("a").hands.map(h => h.unitId)), ["hiaki", "xia"]);
  assert.equal(s.askFor("a").eligible, true);
  assert.throws(() => s.answer("b", ask.id, { unitId: "xia" }), /不能代替/);
  const done = s.answer("a", ask.id, { unitId: "hiaki" });
  assert.equal(done.accepted, true);
  assert.equal(done.result.unitId, "hiaki"); assert.equal(done.result.operatorId, "b");
  assert.deepEqual(plain(done.result.extra), { blade: "naruto" }, "照举手时选的方式出手");
  // 不选：不发动
  ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"], chooser: "a" });
  s.answer("b", ask.id, { unitId: "hiaki" });
  assert.equal(s.answer("a", ask.id, { unitId: null }).result.reason, "declined");
  // 放下手、其他人都不协助：没人举手就结束
  ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"], chooser: "a" });
  s.answer("b", ask.id, { unitId: "hiaki" });
  s.answer("b", ask.id, { unitId: null });
  assert.equal(s.snapshot().ask.hands.length, 0);
  assert.equal(s.answer("gm", ask.id, { unitId: null }).result.reason, "declined");
  // 到时间打出失衡的人还没选：最先举手的人出手
  ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"], chooser: "a" });
  s.answer("gm", ask.id, { unitId: "xia" });
  s.answer("b", ask.id, { unitId: "hiaki" });
  f.advance(20000); s.tick();
  assert.equal(s.snapshot().closedAsk.unitId, "xia");
  assert.equal(s.snapshot().closedAsk.reason, "accepted");
  // 没有 chooser（单机热座等）：照旧先回答的人生效
  ask = s.openAsk({ kind: "assist", candidates: ["hiaki", "xia"] });
  assert.equal(s.answer("b", ask.id, { unitId: "hiaki" }).accepted, true);
});

test("候选离场和战斗结束关闭询问，重复回答不重复结算", () => {
  const f = fixture(), s = f.s; force(f); const events = []; s.onAskClosed(x => events.push(x));
  const ask = s.openAsk({ kind: "assist", candidates: ["hiaki"] });
  f.units.find(u => u.id === "hiaki").dead = true; s.reconcile();
  assert.equal(events[0].reason, "unavailable"); assert.equal(s.answer("b", ask.id, { unitId: "hiaki" }).accepted, false);
  s.openAsk({ kind: "block", candidates: ["ruby"] }); s.endBattle(); assert.equal(events[1].reason, "ended");
  assert.equal(s.snapshot().phase, "ended");
});

test("只有战前/探索可重分配；小队聊天全程开放；快照不能改权威状态", () => {
  const f = fixture(), s = f.s;
  s.setAssignments({ ruby: "b", hiaki: "a" }); assert.equal(s.ownerOf("ruby"), "b");
  assert.throws(() => s.setAssignments({ ruby: "unknown" }), /操作者/);
  s.chat("a", "  让我先走  "); assert.equal(s.snapshot().chat[0].text, "让我先走");
  const view = s.snapshot(); view.roster[0].operatorId = "gm"; view.assignments.ruby = "gm";
  assert.equal(s.ownerOf("ruby"), "b");
  s.beginRound(1); s.chat("b", "可以"); s.forceStart("gm");
  s.chat("a", "战斗中"); assert.equal(s.snapshot().chat.at(-1).text, "战斗中", "作者要求：战斗中也能小队聊天");
  assert.throws(() => s.setAssignments({}), /战斗中/);
  s.endBattle(); s.setAssignments({}); s.reset(); assert.equal(s.snapshot().phase, "setup");
});

test("小队聊天：多行消息（字符画）保留换行和第一行行首的全角空格，只去掉开头的空行和末尾空白", () => {
  const s = fixture().s;
  s.chat("a", "\r\n　\r\n　　龍龍\r\n龍奶奶龍　\n\n");
  assert.equal(s.snapshot().chat.at(-1).text, "　　龍龍\n龍奶奶龍");
  s.chat("a", "　单行照旧去掉两头空白　");
  assert.equal(s.snapshot().chat.at(-1).text, "单行照旧去掉两头空白");
  assert.throws(() => s.chat("a", "\n　\n"), /不能为空/);
});

test("LocalTransport同步先到先得，身份绑定连接，所有收件人获得独立JSON副本", () => {
  const hub = LocalTransport.createHub({ hostId: "authority" }), a = hub.connect("a"), b = hub.connect("b");
  const received = [];
  hub.host.onMessage((message, from) => { received.push({ from, value: message.value }); message.value = 99; });
  const original = { type: "answer", value: 1, from: "forged" }; a.send(original); b.send({ type: "answer", value: 2 });
  assert.deepEqual(received, [{ from: "a", value: 1 }, { from: "b", value: 2 }]); assert.equal(original.value, 1);
  let aView, bView;
  a.onMessage(m => { aView = m; m.nested.value = 99; }); b.onMessage(m => { bView = m; });
  hub.host.send({ type: "view", nested: { value: 3 } }); assert.equal(aView.nested.value, 99); assert.equal(bView.nested.value, 3);
  hub.host.send({ type: "view", nested: { value: 4 } }, "b"); assert.equal(bView.nested.value, 4);
  assert.throws(() => a.send({ type: "cmd" }, "b"), /only send/);
  assert.throws(() => hub.connect("authority"), /Duplicate/);
  assert.throws(() => a.send({ callback() {} }), /JSON/);
  a.close(); assert.throws(() => a.send({ type: "cmd" }), /closed/);
  hub.close(); assert.throws(() => b.send({ type: "cmd" }), /closed/);
});

test("战斗中召唤武器人：紧挨着本人，并且立刻轮到武器人；武器人结束后回到还有行动的本人", () => {
  const f = fixture({ units: [hero("ruby", "ruby"), hero("hiaki", "hiaki"), hero("xia", "xia")] }), s = f.s;
  force(f);
  const order = () => s.snapshot().slots.map(r => r && r.unitId);
  const first = order();
  // 轮到绯秋时让他先花点（锁定格子）
  while (s.snapshot().currentUnitId !== "hiaki") s.finishUnit(s.snapshot().slots.find(r => r && !r.completed).operatorId);
  s.markSpent([{ unitId: "hiaki", ap: 1 }]);
  f.setUnits([...f.units, { ...hero("niu", "niu"), weaponOf: "hiaki" }]);
  s.reconcile();
  const after = order();
  const i = after.indexOf("niu"), h = after.indexOf("hiaki");
  assert.equal(i, h - 1, "武器人紧挨着本人（在本人前面一格，立刻行动）：" + after.join(","));
  assert.equal(s.snapshot().currentUnitId, "niu", "立刻轮到武器人");
  assert.equal(after.length, first.length + 1);
  s.finishUnit("b", "niu");
  assert.equal(s.snapshot().currentUnitId, "hiaki", "武器人结束后回到本人");
});

test("不是本人的回合时出现的武器人：排在本人后面一格", () => {
  const f = fixture({ units: [hero("ruby", "ruby"), hero("hiaki", "hiaki"), hero("xia", "xia")] }), s = f.s;
  force(f);
  const before = s.snapshot().slots.map(r => r && r.unitId);
  f.setUnits([...f.units, { ...hero("niu", "niu"), weaponOf: "hiaki" }]);
  s.reconcile();
  const after = s.snapshot().slots.map(r => r && r.unitId);
  if (s.snapshot().currentUnitId !== "hiaki") assert.equal(after.indexOf("niu"), after.indexOf("hiaki") + 1, after.join(","));
  assert.equal(after.length, before.length + 1);
});

test("小队聊天：战斗中也能发，最多保留 300 条，重建会话时带上旧记录", () => {
  const f = fixture(), s = f.s;
  force(f);
  assert.equal(s.snapshot().phase, "acting");
  s.chat("a", "先打左边那个");
  assert.equal(s.snapshot().chat.at(-1).text, "先打左边那个");
  for (let i = 0; i < 320; i++) s.chat("b", "刷屏" + i);
  assert.equal(s.snapshot().chat.length, 300);
  const kept = s.snapshot().chat;
  const s2 = Hotseat.create({ operators: [{ id: "gm", name: "主持人" }, { id: "a", name: "甲" }], gmId: "gm", getUnits: () => f.units, chat: kept });
  assert.equal(s2.snapshot().chat.length, 300);
  s2.chat("a", "新的一条");
  const ids = s2.snapshot().chat.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, "新消息编号不和旧的重复");
});

test("掷骰（d100）：≤5 大成功，再按熟练的成功线分极难 / 困难 / 普通 / 简单，都不过是失败；暗骰只有主持人能用、玩家看不到", () => {
  const L1 = { extreme: 12.5, hard: 25, normal: 50, easy: 100 }, L0 = { extreme: 0, hard: 0, normal: 0, easy: 50 };
  const tier = (roll, lines) => Hotseat.rollTier(roll, lines).name;
  assert.deepEqual([1, 5, 6, 12, 13, 25, 26, 50, 51, 100].map(r => tier(r, L1)),
    ["大成功", "大成功", "极难成功", "极难成功", "困难成功", "困难成功", "普通成功", "普通成功", "简单成功", "简单成功"]);
  assert.deepEqual([5, 30, 50, 51].map(r => tier(r, L0)), ["大成功", "简单成功", "简单成功", "失败"], "没有熟练只能过简单");
  const adv = Hotseat.rollD100({ adv: true, lines: L1 }, (() => { const q = [0.7, 0.2]; let k = 0; return () => q[k++]; })());
  assert.deepEqual([adv.dice, adv.roll, adv.tier.name], [[71, 21], 21, "困难成功"], "优势取低");
  const dis = Hotseat.rollD100({ dis: true, lines: L1 }, (() => { const q = [0.7, 0.2]; let k = 0; return () => q[k++]; })());
  assert.equal(dis.roll, 71, "劣势取高");
  const f = fixture({ random: () => 0.03 }), s = f.s;
  s.skillRoll("a", { unitId: "ruby", name: "瑞比", prof: "侦察", level: 1, lines: L1, note: "看门后" });
  const row = s.snapshot().chat.at(-1);
  assert.equal(row.text, "掷骰 · 瑞比「侦察」一级熟练：d100 4 → 大成功（看门后）");
  assert.deepEqual(row.roll, { total: 4, tier: "crit" });
  assert.throws(() => s.skillRoll("b", { unitId: "ruby", name: "瑞比", prof: "侦察", lines: L1 }), /只能替自己的角色/);
  assert.throws(() => s.skillRoll("a", { unitId: "ruby", name: "瑞比", prof: "侦察", lines: L1 }, true), /只有主持人能暗骰/);
  s.skillRoll("gm", { unitId: "hiaki", name: "绯秋", prof: "欺瞒", level: 1, lines: L1 }, true);
  assert.equal(s.snapshot().chat.at(-1).secret, true);
  const V = require("../online-view");
  const view = V.projectView({ chat: s.snapshot().chat }, { recipientId: "a" });
  assert.ok(!view.chat.some(m => /暗骰/.test(m.text)), "玩家看不到暗骰");
  assert.deepEqual([view.chat.at(-1).roll, view.chat.at(-1).tier], [true, "crit"]);
  s.chat("a", "/r 1d20");
  assert.equal(s.snapshot().chat.at(-1).text, "/r 1d20", "文字指令不再掷骰，原样当聊天");
});

test("检定：主持人发起，玩家只能替自己的角色掷，结果写进小队频道；跨重建保留", () => {
  const seq = [0.3, 0.9, 0.1]; let i = 0;
  const f = fixture({ random: () => seq[i++ % seq.length] }), s = f.s;
  assert.throws(() => s.openCheck("a", { prof: "侦察", targets: [{ unitId: "ruby" }] }), /只有主持人/);
  s.openCheck("gm", { prof: "侦察", diff: "normal", diffName: "普通", note: "看看门后", targets: [
    { unitId: "ruby", name: "瑞比", base: 0.5 }, { unitId: "hiaki", name: "绯秋", base: 0.5, adv: true }] });
  const c = s.snapshot().table.checks[0];
  assert.equal(c.status, "open");
  assert.match(s.snapshot().chat.at(-1).text, /主持人发起普通「侦察」检定：瑞比、绯秋（看看门后）/);
  assert.throws(() => s.rollCheck("a", c.id, "hiaki"), /只能替自己的角色/);
  s.rollCheck("a", c.id, "ruby");
  assert.equal(s.snapshot().table.checks[0].targets[0].result.ok, true, "0.3 < 0.5 成功");
  assert.match(s.snapshot().chat.at(-1).text, /检定 · 瑞比「侦察」普通（成功率 50%）：d100 31 → 成功/);
  assert.throws(() => s.rollCheck("a", c.id, "ruby"), /已经掷过/);
  s.rollCheck("gm", c.id, "hiaki");   // 主持人代掷；优势两颗 0.9、0.1 → 第二颗成功
  const t = s.snapshot().table.checks[0].targets[1];
  assert.equal(t.result.ok, true);
  assert.equal(t.result.rolls.length, 2);
  assert.equal(s.snapshot().table.checks[0].status, "done");
  const g = fixture({ table: s.snapshot().table });
  assert.equal(g.s.snapshot().table.checks[0].targets[1].result.ok, true, "重建会话带上检定");
  // 劣势、迎难直上、没资格
  assert.equal(Hotseat.rollCheck({ base: 0.5, dis: true }, () => 0.3).ok, true);
  assert.equal(Hotseat.rollCheck({ base: 0.5, dis: true }, (() => { const q = [0.3, 0.7]; let k = 0; return () => q[k++]; })()).ok, false);
  const re = Hotseat.rollCheck({ base: 0.5, reroll: true }, (() => { const q = [0.9, 0.2]; let k = 0; return () => q[k++]; })());
  assert.deepEqual([re.ok, re.rerolled], [true, true]);
  assert.equal(Hotseat.rollCheck({ base: 0 }).ok, false);
});

test("属性点申请：只能给自己的角色、一次一条；主持人同意 / 不同意，玩家可以撤回", () => {
  const f = fixture(), s = f.s;
  assert.throws(() => s.requestAttr("b", "ruby", "str"), /只能给自己的角色/);
  s.requestAttr("a", "ruby", "str", "瑞比");
  assert.throws(() => s.requestAttr("a", "ruby", "dex"), /还在等主持人确认/);
  const r = s.snapshot().table.attrs[0];
  assert.deepEqual([r.unitName, r.attrs[0], r.status], ["瑞比", "str", "pending"]);
  assert.throws(() => s.decideAttr("a", r.id, "approve"), /只有主持人/);
  s.decideAttr("gm", r.id, "approve");
  assert.equal(s.snapshot().table.attrs[0].status, "approved");
  assert.throws(() => s.decideAttr("gm", r.id, "reject"), /已经处理过/);
  s.requestAttr("a", "ruby", "dex", "瑞比");
  s.decideAttr("a", s.snapshot().table.attrs[1].id, "cancel");
  assert.equal(s.snapshot().table.attrs[1].status, "cancelled");
});

test("大字：只有主持人能发，最长 40 字、停留 2–15 秒；小队频道留一条记录；跨重建保留最近一条", () => {
  const f = fixture(), s = f.s;
  assert.throws(() => s.showTitle("a", { text: "我来了" }), /只有主持人/);
  assert.throws(() => s.showTitle("gm", { text: "  " }), /不能为空/);
  s.showTitle("gm", { text: "援军来了", sub: "北边山坡亮起了火把", tone: "hope", seconds: 99 });
  const t = s.snapshot().table.title;
  assert.deepEqual([t.text, t.sub, t.tone, t.seconds], ["援军来了", "北边山坡亮起了火把", "hope", 15]);
  assert.equal(s.snapshot().chat.at(-1).text, "【援军来了】 北边山坡亮起了火把");
  s.showTitle("gm", { text: "他们来了", tone: "weird" });
  const t2 = s.snapshot().table.title;
  assert.notEqual(t2.id, t.id);
  assert.deepEqual([t2.tone, t2.seconds], ["plain", 4]);
  assert.equal(fixture({ table: s.snapshot().table }).s.snapshot().table.title.text, "他们来了");
  const V = require("../online-view");
  const view = V.projectView({ title: t2, chat: s.snapshot().chat }, { recipientId: "a" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.title)), { text: "他们来了", sub: "", seconds: 4, at: t2.at, id: t2.id, tone: "plain" });
  assert.equal(view.chat.at(-1).title, true);
});

test("战斗中（行动阶段）当前角色可以直接和自己的武器人换位，不用请求；和队友换要对方同意", () => {
  const units = [hero("h", "hiaki"), hero("g", "ruby"), { ...hero("w1", "niu"), weaponOf: "hiaki" }];
  const { s } = fixture({ units, assignments: { h: "a", g: "b" } });
  s.beginRound(1); s.pick("a", "h", 0); s.pick("b", "g", 1); s.pick("a", "w1", 2); s.confirm("a"); s.confirm("b");
  assert.equal(s.snapshot().phase, "acting"); assert.equal(s.snapshot().currentUnitId, "h");
  assert.equal(s.move("a", "h", 2).status, "moved");
  assert.deepEqual(s.snapshot().slots.map(x => x && x.unitId), ["w1", "g", "h"]);
  assert.equal(s.snapshot().currentUnitId, "w1", "武器人换到前面就先轮到它");
  assert.equal(s.move("a", "w1", 1).status, "pending", "和队友换要对方同意");
});

test("转交角色（#165）：选顺序阶段可转，武器人跟着转，顺序格子不变；转给主持人 = 收回", () => {
  const f = fixture({ units: [hero("ruby", "ruby"), hero("hiaki", "hiaki"), { ...hero("niu", "niu"), weaponOf: "hiaki" }] }), s = f.s;
  s.beginRound(1); s.pick("b", "hiaki", 0); s.pick("b", "niu", 1); s.pick("a", "ruby", 2); s.confirm("b");
  assert.deepEqual(s.snapshot().confirmed, ["b"]);
  assert.deepEqual(s.transferState(), { ok: true, reason: "" });
  s.transfer("gm", "hiaki", "gm");
  assert.deepEqual(s.snapshot().roster.filter(r => r.unitId !== "ruby").map(r => [r.unitId, r.operatorId]), [["hiaki", "gm"], ["niu", "gm"]]);
  assert.deepEqual(s.snapshot().slots.map(r => r && r.unitId), ["hiaki", "niu", "ruby"]);
  assert.throws(() => s.pick("b", "hiaki", 0), /不是你的/);
  s.transfer("gm", "hiaki", "a");
  assert.equal(s.snapshot().roster.find(r => r.unitId === "niu").operatorId, "a");
  assert.throws(() => s.transfer("a", "hiaki", "b"), /只有房主/);
  assert.throws(() => s.transfer("gm", "hiaki", "a"), /本来就/);
  assert.throws(() => s.transfer("gm", "niu", "b"), /只能转交英雄/);
});

test("转交角色（#165）：行动做到一半、协助询问没回答、敌人行动中都拒绝并写明原因；两个单位之间可以转", () => {
  const f = fixture(), s = f.s; force(f);
  assert.equal(s.transferState().ok, true);
  s.markSpent([{ unitId: s.snapshot().currentUnitId, ap: 1 }]);
  assert.match(s.transferState().reason, /正在行动/);
  assert.throws(() => s.transfer("gm", "xia", "a"), /正在行动/);
  const first = s.snapshot().currentUnitId, owner = s.snapshot().roster.find(r => r.unitId === first).operatorId;
  s.finishUnit(owner, first);
  assert.equal(s.transferState().ok, true);
  s.transfer("gm", "xia", "a"); assert.equal(s.snapshot().roster.find(r => r.unitId === "xia").operatorId, "a");
  const ask = s.openAsk({ kind: "assist", candidates: ["xia"] });
  assert.match(s.transferState().reason, /协助询问/);
  assert.throws(() => s.transfer("gm", "xia", "b"), /协助询问/);
  s.answer("a", ask.id, { unitId: null });
  for (let guard = 0; s.snapshot().currentUnitId && guard < 5; guard++) { const id = s.snapshot().currentUnitId; s.finishUnit(s.snapshot().roster.find(r => r.unitId === id).operatorId, id); }
  assert.equal(s.snapshot().phase, "enemy");
  assert.match(s.transferState().reason, /敌人行动/);
});
