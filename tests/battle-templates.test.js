// 战斗模板（battle-templates.js）：主持人提前布置战场，开战时直接摆好
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.GAME = { partyKits: ["kolt", "helu"] };
  return c;
}
const AMBUSH = {
  name: "桥头伏击", note: "第二天傍晚", tier: "elite", board: 3, weather: "sand", playerZone: 1,
  enemies: [
    { preset: "thug_knife", level: 4, zone: 3, mechanics: [{ type: "execution", phase: "enemy", turns: 2, then: "once", hits: [{ mult: 2 }], st: { due: 9 } }] },
    { preset: "thug_hammer", level: null, zone: 2 },
    { preset: "no_such_enemy", level: 1, zone: 2 }
  ],
  fields: { 2: { acid: true, highland: true, bogus: 5 } },
  gaps: { "2-3": { type: "wall", hp: 25 }, "1-2": { type: "door", open: true }, "1-3": { type: "wall" } },
  props: [{ kind: "boom", zone: 2, faction: "enemy" }, { kind: "ironwall", zone: 1 }]
};

test("战斗模板：存在本机，可以列出、改、复制、删；不认识的东西被去掉", () => {
  const c = field();
  assert.deepEqual(plain(c.battleTemplateList()), []);
  const t = c.battleTemplateSave(AMBUSH);
  assert.equal(c.battleTemplateList().length, 1);
  assert.deepEqual(plain(t.enemies), [
    { preset: "thug_knife", level: 4, zone: 3, mechanics: [{ type: "execution", phase: "enemy", turns: 2, then: "once", hits: [{ mult: 2 }] }] },
    { preset: "thug_hammer", level: null, zone: 2 }
  ], "不认识的敌人去掉；首领机制只留配置，不带战斗进度");
  assert.deepEqual(plain(t.fields), { 2: { acid: true, highland: true } });
  assert.deepEqual(plain(t.gaps), { "1-2": { type: "door", hp: null, open: true }, "2-3": { type: "wall", hp: 25, open: false } }, "三区没有 1-3 连接");
  assert.deepEqual(plain(t.props), [{ kind: "boom", zone: 2, level: null, faction: "enemy" }], "技能造出来的铁壁不能放进模板");
  assert.ok(JSON.parse(c.localStorage.getItem("anterscale-battle-templates")).list.length === 1);

  const edited = c.battleTemplateSave(Object.assign(plain(t), { name: "桥头伏击·改" }));
  assert.equal(edited.id, t.id);
  assert.equal(c.battleTemplateList().length, 1, "同 id 是覆盖");
  const dup = c.battleTemplateDuplicate(t.id);
  assert.notEqual(dup.id, t.id);
  assert.equal(dup.name, "桥头伏击·改 副本");
  assert.equal(c.battleTemplateList().length, 2);
  assert.equal(c.battleTemplateDelete(t.id), true);
  assert.deepEqual(plain(c.battleTemplateList().map(x => x.id)), [dup.id]);
});

test("战斗模板：开战时敌人、首领机制、天气、场地、间隙、配置物、我方站位一次摆好", () => {
  const c = field();
  const t = c.battleTemplateSave(Object.assign({}, AMBUSH, { playerZone: 2 }));
  const enc = c.battleTemplateToEncounter(t);
  c.dispatch({ type: "battle.setup", level: 3, encounter: enc });
  const st = c.S.state;
  assert.equal(st.zoneMode, 3);
  assert.equal(st.weather, "sand");
  const foes = st.units.filter(u => !u.isPlayer);
  assert.deepEqual(plain(foes.map(u => [u.kit, u.level, u.zone])), [["thug_knife", 4, 3], ["thug_hammer", 3, 2]], "等级空着的跟着战斗等级");
  assert.equal(foes[0].mechanics.length, 1);
  assert.ok(st.units.filter(u => u.isPlayer).every(u => u.zone === 2), "我方按模板站在 2 区");
  assert.equal(st.fields[2].acid, true);
  assert.equal(st.fields[2].highland, true);
  assert.deepEqual(plain([st.gaps["2-3"].type, st.gaps["2-3"].hp, st.gaps["2-3"].maxHp]), ["wall", 25, 25]);
  assert.deepEqual(plain([st.gaps["1-2"].type, st.gaps["1-2"].open]), ["door", true]);
  assert.deepEqual(plain(st.props.map(p => [p.kind, p.zone, p.faction, p.level])), [["boom", 2, "enemy", 3]]);
  assert.equal(c.S.state.combatStarted, false, "摆好了，等主持人点开始");
  // 开打后死刑照常标记
  c.startCombat();
  assert.ok(foes[0].mechanics[0].st && foes[0].mechanics[0].st.due != null, "首领机制开战后开始倒计时");
});

test("战斗模板：从战斗画面上摆好的战场记下来，再开一次一模一样", () => {
  const c = field();
  c.dispatch({ type: "battle.setup", level: 2, encounter: c.battleTemplateToEncounter(AMBUSH) });
  const cap = c.battleTemplateCapture("再来一次");
  assert.equal(cap.name, "再来一次");
  assert.equal(cap.board, 3);
  assert.equal(cap.weather, "sand");
  assert.equal(cap.tier, "elite", "跟着这场遭遇的类型");
  assert.deepEqual(plain(cap.enemies).map(e => [e.preset, e.level, e.zone, !!e.mechanics]), [["thug_knife", 4, 3, true], ["thug_hammer", 2, 2, false]], "记下的是实际等级");
  assert.deepEqual(plain(cap.gaps["2-3"]), { type: "wall", hp: 25, open: false });
  assert.deepEqual(plain(cap.props), [{ kind: "boom", zone: 2, level: 2, faction: "enemy" }]);
  assert.deepEqual(plain(cap.fields), { 2: { acid: true, highland: true } });
  const again = field();
  again.dispatch({ type: "battle.setup", level: 9, encounter: again.battleTemplateToEncounter(cap) });
  assert.deepEqual(plain(again.S.state.units.filter(u => !u.isPlayer).map(u => [u.kit, u.level, u.zone])), [["thug_knife", 4, 3], ["thug_hammer", 2, 2]]);
});

test("战斗模板：特殊棋盘（四区方形）的场地和间隙；上一场的棋盘连接不会带到直排", () => {
  const c = field();
  const sq = c.battleTemplateNormalize({ name: "仓库", board: "square4", enemies: [{ preset: "thug_knife", zone: 4 }], fields: { 4: { ice: true } }, gaps: { "1-3": { type: "bridge", hp: 12 }, "2-3": { type: "wall" } } });
  assert.equal(sq.playerZone, 3, "默认站在棋盘给我方的区");
  assert.deepEqual(plain(Object.keys(sq.gaps)), ["1-3"], "方形棋盘 2、3 区不相连");
  c.dispatch({ type: "battle.setup", level: 2, encounter: c.battleTemplateToEncounter(sq) });
  const st = c.S.state;
  assert.equal(st.board.id, "square4");
  assert.equal(st.fields[4].ice, true);
  assert.deepEqual(plain([st.gaps["1-3"].type, st.gaps["1-3"].hp]), ["bridge", 12]);
  assert.ok(st.units.filter(u => u.isPlayer).every(u => u.zone === 3));
  c.dispatch({ type: "battle.setup", level: 2, encounter: c.battleTemplateToEncounter({ name: "巷子", board: 2, enemies: [{ preset: "thug_knife", zone: 2 }] }) });
  assert.equal(c.S.state.board, null);
  assert.deepEqual(plain(Object.keys(c.S.state.gaps).sort()), ["1-2", "2-3"]);
});

test("战斗模板：导出成文字、导入（同 id 覆盖），坏文字报错", () => {
  const c = field();
  const a = c.battleTemplateSave({ name: "甲", enemies: [{ preset: "thug_knife", zone: 2 }] });
  c.battleTemplateSave({ name: "乙", enemies: [] });
  const text = c.battleTemplateExport([a.id]);
  const other = field();
  assert.equal(other.battleTemplateImport(text), 1);
  assert.equal(other.battleTemplateList()[0].name, "甲");
  assert.equal(other.battleTemplateImport(JSON.stringify({ list: [Object.assign(plain(a), { name: "甲改" })] })), 1);
  assert.deepEqual(plain(other.battleTemplateList().map(t => t.name)), ["甲改"]);
  assert.throws(() => other.battleTemplateImport("不是 JSON"), /不是有效的模板文字/);
  assert.match(c.battleTemplateSummary(a), /两区 · 狂徒（匕首） Lv随队（2 区）/);
});

test("战斗模板：编辑表单改场地 / 高地，换成和战场配置一样的字段", () => {
  const c = field();
  const t = c.battleTemplateNormalize({ name: "x", board: 2 });
  c.battleTemplateSetField(t, 1, "fireOn", false);
  assert.deepEqual(plain(t.fields[1]), { fire: 1, fireOn: true });
  assert.equal(c.battleTemplateFieldKind(t.fields[1]), "fireOn");
  c.battleTemplateSetField(t, 1, "", true);
  assert.deepEqual(plain(t.fields[1]), { highland: true });
  c.battleTemplateSetField(t, 1, "", false);
  assert.equal(t.fields[1], undefined);
});

test("跑团任务：战斗站选了模板，打这一站按模板摆（存的是拷贝）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "TPL-TASK" });
  c.S.TRPG.active = true;
  const cmd = o => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, o)));
  const tpl = c.battleTemplateSave(AMBUSH);
  cmd({ action: "taskCreate", kind: "custom" });
  const t = c.trpgTasks()[0];
  const edit = plain(t);
  edit.nodes = [{ type: "battle", enemies: [], template: tpl }, { type: "rest" }];
  cmd({ action: "taskSave", task: edit });
  assert.equal(t.nodes[0].template.name, "桥头伏击");
  assert.equal(t.nodes[1].template, null);
  c.battleTemplateDelete(tpl.id);
  cmd({ action: "taskStatus", id: t.id, status: "posted" });
  cmd({ action: "taskAccept", id: t.id });
  const cfg = c.trpgTaskPrepareBattle(t.id);
  assert.equal(cfg.template.id, tpl.id, "模板删了也照样能打");
  assert.deepEqual(plain(c.S.TRPG.taskBattle), { id: t.id, index: 0 });
  const enc = c.battleTemplateToEncounter(cfg.template);
  assert.equal(enc.layoutLocked, true);
  assert.equal(c.layoutLabel(enc.layout), "主持人预设");
});

test("战斗掉落：模板带上、打赢才进背包（只给一次）；输了不给；战绩记下最近 10 场的明细", () => {
  const c = field();
  const t = c.battleTemplateNormalize({ name: "仓库", enemies: [{ preset: "thug_knife", zone: 2 }], drops: { kuizhi: 250, items: [{ id: "medkit", qty: 2 }, { id: "nope", qty: 1 }] } });
  assert.deepEqual(plain(t.drops), { kuizhi: 250, items: [{ id: "medkit", qty: 2 }] });
  c.dispatch({ type: "battle.setup", level: 1, encounter: c.battleTemplateToEncounter(t) });
  assert.deepEqual(plain(c.S.state.battleDrops), { kuizhi: 250, items: [{ id: "medkit", qty: 2 }] });
  const kz = Number(c.S.state.kuizhi) || 0;
  const r = c.dispatch({ type: "battle.finish", outcome: "win" });
  assert.deepEqual(plain(r.drops), { kuizhi: 250, items: [{ id: "medkit", name: "简易医疗包", qty: 2 }] });
  assert.equal(c.S.state.kuizhi, kz + 250);
  assert.equal(c.bagCount("medkit"), 2);
  assert.deepEqual(plain(c.dispatch({ type: "battle.finish", outcome: "win" }).drops), plain(r.drops), "重复结算不再给");
  assert.equal(c.bagCount("medkit"), 2);
  const b = c.S.LEDGER.career.battles.at(-1);
  assert.equal(b.name, "仓库");
  assert.deepEqual(plain(b.drops), plain(r.drops));
  assert.ok(b.rows.length >= 2 && b.rows.every(x => typeof x.dmg === "number"), "每个上场的人都有一行");
  // 主持人在战场配置里改掉落；输了不给
  c.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.equal(c.S.state.battleDrops, null);
  c.dispatch({ type: "battle.panel", action: "setDrops", drops: { kuizhi: 99, items: [] } });
  assert.equal(c.S.state.battleDrops.kuizhi, 99);
  assert.equal(c.dispatch({ type: "battle.finish", outcome: "lose" }).drops, null);
  // 只留最近 10 场的明细
  for (let i = 0; i < 12; i++) { c.dispatch({ type: "battle.setup", level: 1, encounter: null }); c.dispatch({ type: "battle.finish", outcome: "win" }); }
  const all = c.S.LEDGER.career.battles;
  assert.equal(all.filter(x => x.rows).length, 10);
});
