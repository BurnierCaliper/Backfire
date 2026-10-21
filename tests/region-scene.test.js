// 区域下面再分「场景」（issue #239，接着 #229 的 state.region / state.light）：
//   采矿场的矿外 / 矿内 / 矿底（第三采矿场没有矿内），沙漠的沙丘 / 沙珊瑚台地，别的区域暂时各一个。
//   默认跟着地图（沙漠看场上有没有沙珊瑚台地，采矿场没标就是矿外），主持人在战场配置里可以改；
//   联机白名单只放行当前区域认得的场景 id（坚毅生命照旧不发）；只是画面的标签，不改任何结算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const code = f => read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // 去掉注释，只看代码
const load = (c, f) => vm.runInContext(read(f), c, { filename: f });
const PARTY = ["kolt", "helu"];
const MINE = [["rim", "矿外"], ["mid", "矿内"], ["floor", "矿底"]];
/** 随机遭遇（run.js · rollEncounter）：指令只收 JSON 数据，和战斗画面一样先拷一份 */
const rolled = (c, opt) => plain(c.rollEncounter(opt));
/** 自己写的遭遇（不掷随机的场地）：region、scene（遭遇标的场景）、features（场地 / 配置物） */
const enc = (region, extra) => Object.assign({ id: "t-scene", name: "场景测试", region, zoneMode: 2, enemies: [{ preset: "thug_knife", zone: 2 }], features: [] }, extra || {});
const coralAt = (zone) => [{ type: "field", what: "coral", zone }];

/** 战斗原型 / 跑团的战斗画面那条路：battle.setup（和 game.js · setupBattle 同一条指令） */
function field() {
  const c = H.load();
  c.GAME = { partyKits: PARTY.slice() };
  return c;
}
/** 单局：这一站是战斗，按 rogue.js · battleSpec 开战（和 game.js · startRogueBattle 同一条指令） */
function rogueBattle(c, run) {
  if (!run.task) c.Rogue.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = c.Rogue.battleSpec(run);
  c.dispatch({ type: "battle.setupRogue", spec: c.BattleCommands.battleSpecData(spec) }, { before: spec.before });
  return spec;
}
/** 在规则环境里投影（房主那边：online-view.js 和规则文件在同一个页面里） */
function projectIn(c, st) {
  if (!c.OnlineView) load(c, "online-view.js");
  return plain(c.OnlineView.projectState(st || c.S.state, { itemCatalog: c.ITEM_CATALOG || {} }));
}
const noShp = (v) => {
  const wire = JSON.stringify(v).replace(/"upOnShp":(true|false)/g, "");
  assert.doesNotMatch(wire, /shp|坚毅|732911|827319/i);
};
const look = c => [c.S.state.region, c.S.state.scene, c.S.state.scenePick];

/* ---------- 1. 配置表 ---------- */
test("场景表在正式配置里（world-data.js · BATTLE_SCENES，和 BATTLE_REGIONS 放一起）：每个区域都有；采矿场矿外 / 矿内 / 矿底（第三采矿场没有矿内），沙漠沙丘 / 沙珊瑚台地，别的区域暂时各一个；只认这个区域的场景 id", () => {
  const c = H.load(), R = vm.runInContext("BATTLE_REGIONS", c), T = vm.runInContext("BATTLE_SCENES", c);
  assert.deepEqual(Object.keys(T).sort(), [...R].sort(), "每个区域都有场景，没有多出来的区域");
  const pairs = r => plain(T[r].map(s => [s.id, s.name]));
  assert.deepEqual(pairs("第一采矿场"), MINE);
  assert.deepEqual(pairs("第二采矿场"), MINE);
  assert.deepEqual(pairs("第三采矿场"), [["rim", "矿外"], ["floor", "矿底"]], "第三采矿场矿坑浅：没有矿内");
  assert.deepEqual(pairs("沙漠"), [["dune", "沙丘"], ["coral", "沙珊瑚台地"]]);
  ["外城区", "巨人城", "天网设施", "下水道"].forEach(r => assert.equal(T[r].length, 1, r + " 暂时只有一个场景"));
  R.forEach(r => {
    const ids = T[r].map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, r + "：场景 id 不重复");
    T[r].forEach(s => {
      assert.match(s.id, /^[a-z][a-z0-9_]*$/, r + " 的场景 id");
      assert.ok(typeof s.name === "string" && s.name.length >= 1 && s.name.length <= 8, r + " 的场景名");
    });
    assert.deepEqual(plain(c.battleScenes(r)), plain(T[r]));
  });
  // 沙漠：场上有沙珊瑚台地场地时默认用沙珊瑚台地 —— 写在表里（field），不写死在逻辑里
  assert.equal(T["沙漠"].find(s => s.id === "coral").field, "coral");
  assert.ok(T["沙漠"].concat(T["第一采矿场"]).filter(s => s.id !== "coral").every(s => !s.field));
  // 认得的：这个区域的场景 id（区域也可以写地图地点 id）；别的区域的、乱写的认不得
  assert.equal(c.battleSceneId("第一采矿场", "mid"), "mid");
  assert.equal(c.battleSceneId("mine_1", "floor"), "floor");
  assert.equal(c.battleSceneId("第三采矿场", "floor"), "floor");
  assert.equal(c.battleSceneId("沙漠", "coral"), "coral");
  for (const [r, s] of [["第三采矿场", "mid"], ["第一采矿场", "dune"], ["沙漠", "rim"], ["外城区", "rim"], [null, "rim"], ["月球", "rim"], ["极北禁区", "rim"],
    ["第一采矿场", "RIM"], ["第一采矿场", " rim"], ["第一采矿场", ""], ["第一采矿场", null], ["第一采矿场", undefined], ["第一采矿场", 42],
    ["第一采矿场", "__proto__"], ["第一采矿场", "constructor"], ["第一采矿场", "toString"], ["第一采矿场", ["rim"]], ["第一采矿场", { id: "rim" }]])
    assert.equal(c.battleSceneId(r, s), null, `认不得：${r} / ${JSON.stringify(s)}`);
  assert.equal(c.battleSceneName("第二采矿场", "floor"), "矿底");
  assert.equal(c.battleSceneName("沙漠", "coral"), "沙珊瑚台地");
  assert.equal(c.battleSceneName("第三采矿场", "mid"), null);
  for (const r of ["月球", null, undefined, "", "__proto__", "constructor", 42]) assert.deepEqual(plain(c.battleScenes(r)), [], "认不得的区域没有场景：" + String(r));
});

/* ---------- 2. 默认跟着地图 ---------- */
test("默认（沙漠）：场上有沙珊瑚台地场地 → 沙珊瑚台地，否则沙丘；沙珊瑚枝不算，不在场上的区不算；战斗中台地出现 / 消失，重算（联机每次发包前）就跟着变", () => {
  const c = H.load(), st = () => c.S.state;
  c.BattleSim.setup({ party: PARTY, encounter: enc("沙漠"), seed: "SCN-DUNE" });
  assert.deepEqual([st().region, st().scene, st().scenePick, st().sceneMap], ["沙漠", "dune", null, null]);
  c.BattleSim.setup({ party: PARTY, encounter: enc("沙漠", { features: coralAt(2) }), seed: "SCN-CORAL" });
  assert.equal(st().fields[2].coral, true);
  assert.deepEqual([st().region, st().scene], ["沙漠", "coral"]);
  // 沙珊瑚枝（配置物）不是台地场地
  c.BattleSim.setup({ party: PARTY, encounter: enc("沙漠", { features: [{ type: "prop", what: "coral_branch", zone: 2, faction: "neutral" }] }), seed: "SCN-BRANCH" });
  assert.ok(st().props.some(p => p.kind === "coral_branch"));
  assert.equal(st().scene, "dune");
  // 两区的战斗：3 区不在场上，那里的标记不算
  st().fields[3].coral = true;
  assert.equal(c.battleLookSync().scene, "dune");
  // 战斗中（主持人改场地、连续战斗换场）：重算就跟着变
  st().fields[1].coral = true;
  assert.equal(c.battleLookSync().scene, "coral");
  assert.equal(st().scene, "coral");
  st().fields[1].coral = false;
  assert.equal(c.battleLookSync().scene, "dune");
  // 特殊棋盘（四区方形）：4 区的台地算
  c.BattleSim.setup({ party: PARTY, board: "square4", enemies: [], region: "沙漠", seed: "SCN-SQUARE" });
  assert.equal(st().scene, "dune");
  st().fields[4] = Object.assign(st().fields[4] || c.emptyField(), { coral: true });
  assert.equal(c.battleLookSync().scene, "coral");
  // 随机的沙漠遭遇（遭遇表会掷沙珊瑚台地）：有台地就是台地
  for (let i = 0; i < 30; i++) {
    c.BattleSim.setup({ party: PARTY, encounter: rolled(c, { region: "沙漠" }), seed: "SCN-ROLL-" + i });
    const coral = c.boardZoneIds().some(z => st().fields[z] && st().fields[z].coral);
    assert.equal(st().scene, coral ? "coral" : "dune", "随机遭遇 " + i);
  }
  assert.deepEqual(c.__errors, []);
});

test("默认（采矿场）：遭遇 / 地图地点没标就是矿外（单局、遭遇、跑团都是）；标了就按标的（只认这个区域有的场景）；只有一个场景的区域就是它；没有区域的战斗没有场景", () => {
  // 单局：这一幕的区域（幕间改走采矿场）。单局的节点没有矿外 / 矿内 / 矿底的标记 → 矿外
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: PARTY, seed: "SCN-ROGUE" });
  rogueBattle(c, run);
  assert.deepEqual(look(c), ["外城区", "street", null]);
  for (const mine of ["第一采矿场", "第二采矿场", "第三采矿场"]) {
    run.regionPick = { [run.act]: mine };
    rogueBattle(c, run);
    assert.deepEqual(look(c), [mine, "rim", null], "单局 · " + mine);
  }
  // 遭遇 / 战斗原型：BattleSim.setup 给的 region（地点 id 也认）、随机遭遇
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "mine_2", seed: "SCN-SPEC" });
  assert.deepEqual(look(c), ["第二采矿场", "rim", null]);
  c.BattleSim.setup({ party: PARTY, encounter: rolled(c, { region: "第三采矿场" }), seed: "SCN-ROLL3" });
  assert.deepEqual(look(c), ["第三采矿场", "rim", null]);
  // 标了的：BattleSim.setup 的 scene、遭遇的 scene
  c.BattleSim.setup({ party: PARTY, enemies: [], region: "第一采矿场", scene: "floor", seed: "SCN-TAG" });
  assert.deepEqual([c.S.state.scene, c.S.state.sceneMap, c.S.state.scenePick], ["floor", "floor", null], "标的场景算地图来的，不算主持人选的");
  c.BattleSim.setup({ party: PARTY, encounter: enc("第二采矿场", { scene: "mid" }), seed: "SCN-ENC" });
  assert.deepEqual(look(c), ["第二采矿场", "mid", null]);
  // 标了这个区域没有的场景：不认，按默认
  for (const bad of ["mid", "dune", "RIM", "", 42, null, { id: "floor" }, ["floor"]]) {
    c.BattleSim.setup({ party: PARTY, enemies: [], region: "第三采矿场", scene: bad, seed: "SCN-BAD" });
    assert.deepEqual([c.S.state.scene, c.S.state.sceneMap], ["rim", null], "不认：" + JSON.stringify(bad));
  }
  // 只有一个场景的区域
  for (const [r, s] of [["外城区", "street"], ["巨人城", "city"], ["天网设施", "facility"], ["天网塔", "facility"], ["下水道", "tunnel"]]) {
    c.BattleSim.setup({ party: PARTY, enemies: [], region: r, seed: "SCN-ONE" });
    assert.equal(c.S.state.scene, s, r);
  }
  c.BattleSim.setup({ party: PARTY, enemies: [], region: "月球", scene: "rim", seed: "SCN-NOREGION" });
  assert.deepEqual(look(c), [null, null, null], "认不得的区域没有场景");
  // 战斗原型的遭遇（battle.setup，和战斗画面「遭遇」面板开战同一条）
  const f = field();
  f.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场", { scene: "floor" }) });
  assert.deepEqual(look(f), ["第一采矿场", "floor", null]);
  f.dispatch({ type: "battle.setup", level: 1, encounter: rolled(f, { region: "第一采矿场" }) });
  assert.deepEqual(look(f), ["第一采矿场", "rim", null]);
  f.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.deepEqual([...look(f), f.S.state.sceneMap], [null, null, null, null], "默认阵容没有区域、没有场景，上一场的不带过来");
  // 跑团：队伍在地图上的地点（地图上的采矿场只有一个点，没有矿外 / 矿内 / 矿底之分）→ 矿外；遭遇标了这个区域有的场景就按它
  const t = field();
  t.S.TRPG.active = true;
  t.LEDGER.place = "mine_1";
  t.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.deepEqual(look(t), ["第一采矿场", "rim", null]);
  t.LEDGER.place = "mine_3";
  t.dispatch({ type: "battle.setup", level: 1, encounter: enc("第三采矿场", { scene: "floor" }) });
  assert.deepEqual(look(t), ["第三采矿场", "floor", null]);
  t.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { scene: "coral", features: coralAt(2) }) });
  assert.deepEqual(look(t), ["第三采矿场", "rim", null], "跑团先看地图：队伍在第三采矿场，沙漠遭遇标的沙珊瑚台地不算");
  t.LEDGER.place = null;
  t.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(1) }) });
  assert.deepEqual(look(t), ["沙漠", "coral", null], "地图上没标队伍的位置：用遭遇的区域，场上有沙珊瑚台地");
  for (const x of [c, f, t]) assert.deepEqual(x.__errors, []);
});

test("换区域：场景回到新区域的默认（遭遇 / 地图标的场景只算地图上那个区域的）；主持人选的场景新区域也有就留着，没有就回到默认", () => {
  const c = field(), st = () => c.S.state;
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场", { scene: "floor" }) });
  assert.deepEqual(look(c), ["第一采矿场", "floor", null]);
  const region = v => c.dispatch({ type: "battle.panel", action: "setRegion", value: v });
  const scene = v => c.dispatch({ type: "battle.panel", action: "setScene", value: v });
  // 没选场景（跟着地图）：换区域 → 新区域的默认
  region("第二采矿场");
  assert.deepEqual(look(c), ["第二采矿场", "rim", null], "地图标的矿底是第一采矿场的：换到第二采矿场回到默认的矿外");
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "dune", null]);
  st().fields[2].coral = true;
  region("外城区");
  assert.deepEqual(look(c), ["外城区", "street", null]);
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "coral", null], "换到沙漠：场上有沙珊瑚台地就是台地");
  st().fields[2].coral = false;
  region("");
  assert.deepEqual(look(c), ["第一采矿场", "floor", null], "回到跟着地图：又是地图标的矿底");
  region("第一采矿场");
  assert.deepEqual(look(c), ["第一采矿场", "floor", null], "主持人选的区域就是地图上的那个：地图标的照样算");
  region("");
  // 主持人选了场景再换区域
  scene("mid");
  assert.deepEqual(look(c), ["第一采矿场", "mid", "mid"]);
  region("第二采矿场");
  assert.deepEqual(look(c), ["第二采矿场", "mid", "mid"], "第二采矿场也有矿内：留着");
  region("第三采矿场");
  assert.deepEqual(look(c), ["第三采矿场", "rim", null], "第三采矿场没有矿内：回到默认");
  region("第一采矿场");
  assert.deepEqual(look(c), ["第一采矿场", "floor", null], "回默认以后不会再冒出以前选的矿内");
  scene("rim");
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "dune", null], "沙漠没有矿外：回到默认");
  scene("coral");
  region("");
  assert.deepEqual(look(c), ["第一采矿场", "floor", null]);
  // 一次改区域 + 场景（battleLookSet）：场景按改完的区域认；认不得就什么都不改
  c.battleLookSet({ region: "第三采矿场", scene: "floor" });
  assert.deepEqual(look(c), ["第三采矿场", "floor", "floor"]);
  const before = plain(st());
  assert.throws(() => c.battleLookSet({ region: "第二采矿场", scene: "dune" }), /认不得的场景/);
  assert.throws(() => c.battleLookSet({ region: "沙漠", scene: "floor" }), /认不得的场景/);
  assert.deepEqual(plain(st()), before);
  assert.deepEqual(c.__errors, []);
});

/* ---------- 3. 主持人改了以后用改的 ---------- */
test("主持人在战场配置里改场景：setScene 用选的（\"\" = 跟着地图）；只认当前区域的场景，认不得的什么都不改；只管这一场，下一场开战回到跟着地图", () => {
  const c = field(), st = () => c.S.state, scene = v => c.dispatch({ type: "battle.panel", action: "setScene", value: v });
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场") });
  assert.ok(c.BattleCommands.panelActions.includes("setScene"));
  assert.deepEqual(look(c), ["第一采矿场", "rim", null]);
  scene("floor");
  assert.deepEqual(look(c), ["第一采矿场", "floor", "floor"]);
  assert.equal(c.battleLookSync().scene, "floor", "重算以后还是选的");
  assert.equal(st().sceneMap, null, "地图那边没标（下拉框写「跟着地图（当前：矿外）」）");
  assert.equal(c.battleSceneAuto(st().region), "rim");
  // 认不得的值：指令层就拦下，什么都不改
  const before = plain(st());
  for (const cmd of [{ value: "dune" }, { value: "coral" }, { value: "RIM" }, { value: " mid" }, { value: "月球" }, { value: "__proto__" }, { value: 42 }, { value: null }, { value: true }, { value: ["mid"] }, {}])
    assert.throws(() => c.dispatch(Object.assign({ type: "battle.panel", action: "setScene" }, cmd)), /Unknown battle scene/, JSON.stringify(cmd));
  assert.deepEqual(plain(st()), before);
  assert.throws(() => c.battleLookSet({ scene: "dune" }), /认不得的场景/);
  assert.throws(() => c.battleLookSet({ scene: 42 }), /认不得的场景/);
  assert.deepEqual(plain(st()), before);
  // 第三采矿场没有矿内
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "第三采矿场" });
  assert.throws(() => scene("mid"), /Unknown battle scene/);
  scene("floor");
  assert.deepEqual(look(c), ["第三采矿场", "floor", "floor"]);
  // "" = 跟着地图
  scene("");
  assert.deepEqual(look(c), ["第三采矿场", "rim", null]);
  // 沙漠：主持人选了沙丘，场上有沙珊瑚台地也照选的；选回跟着地图又是台地
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(2) }) });
  assert.deepEqual(look(c), ["沙漠", "coral", null]);
  scene("dune");
  assert.equal(c.battleLookSync().scene, "dune");
  scene("");
  assert.equal(st().scene, "coral");
  // 下一场开战：主持人选的清掉
  scene("dune");
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(1) }) });
  assert.deepEqual(look(c), ["沙漠", "coral", null]);
  // 没有区域：只认 ""
  c.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.throws(() => scene("rim"), /Unknown battle scene/);
  scene("");
  assert.deepEqual(look(c), [null, null, null]);
  assert.deepEqual(c.__errors, []);
});

test("只有主持人能改场景（热座 / 联机跑团同一套权限：battle.panel 只有房主能发）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "第二采矿场", seed: "SCN-HOTSEAT" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1; c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) load(c, f);
  const [a, b] = PARTY.map(k => c.findKit(k, c.S.state.units));
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.equal(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [a.id]: "p1", [b.id]: "p2" } }).ok, true);
  const send = (id, cmd) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(cmd); };
  assert.equal(send("p2", { type: "battle.panel", action: "setScene", value: "floor" }).ok, false, "玩家不能改");
  assert.deepEqual([c.S.state.scene, c.S.state.scenePick], ["rim", null]);
  assert.equal(send("p1", { type: "battle.panel", action: "setScene", value: "floor" }).ok, true, "主持人可以改");
  assert.equal(c.S.state.scene, "floor");
  assert.equal(send("p1", { type: "battle.panel", action: "setScene", value: "dune" }).ok, false, "主持人也只能选这个区域有的");
  assert.equal(c.S.state.scene, "floor");
});

/* ---------- 4. 只是画面 ---------- */
test("场景只是画面：规则文件里没有读场景的地方；改场景不动战场上的任何别的东西（场地、单位、配置物、天气、区域、光影），沙珊瑚台地照样是台地", () => {
  for (const f of H.RULE_FILES.filter(f => f !== "world-data.js")) {
    assert.doesNotMatch(code(f), /state\.(?:scene|scenePick|sceneMap)\b/, f + " 读了画面用的场景");
  }
  const c = field(), st = () => c.S.state;
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(2).concat([{ type: "prop", what: "coral_branch", zone: 1, faction: "neutral" }]) }) });
  const rest = () => { const s = plain(st()); delete s.scene; delete s.scenePick; delete s.sceneMap; return s; };
  const before = rest();
  for (const v of ["dune", "coral", ""]) {
    c.dispatch({ type: "battle.panel", action: "setScene", value: v });
    assert.deepEqual(rest(), before, "选了场景「" + v + "」，战场上别的东西一点没变");
  }
  c.dispatch({ type: "battle.panel", action: "setScene", value: "dune" });
  assert.equal(c.isHighGround(st().fields[2]), true, "画面是沙丘，2 区照样是沙珊瑚台地（自带高地）");
  assert.equal(c.coralInZone(2), true);
  assert.equal(c.coralInZone(1), true, "沙珊瑚枝照样会抓人");
  assert.deepEqual(c.__errors, []);
});

/* ---------- 5. 联机白名单 ---------- */
test("联机白名单（online-view.js · projectState）：只放行当前区域认得的场景 id，别的一律不发；没有区域就没有场景；主持人选的 / 地图标的这些房主字段不发；投影里没有坚毅生命", () => {
  const c = field();
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场", { scene: "floor" }) });
  const st = c.S.state;
  st.units.forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  let pv = projectIn(c);
  assert.deepEqual([pv.region, pv.scene], ["第一采矿场", "floor"]);
  noShp(pv);
  ["sceneMap", "scenePick", "regionMap", "regionPick", "lightPick"].forEach(k => assert.equal(pv[k], undefined, k + " 是房主自己的，不发"));
  // 主持人改了以后，投影跟着变
  c.dispatch({ type: "battle.panel", action: "setScene", value: "mid" });
  pv = projectIn(c);
  assert.equal(pv.scene, "mid");
  noShp(pv);
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "沙漠" });
  assert.deepEqual([projectIn(c).region, projectIn(c).scene], ["沙漠", "dune"]);
  // 只放行当前区域认得的（区域写地点 id 也换成区域名再认）；别的区域的、乱写的、塞了别的东西的不发
  const raw = (patch) => projectIn(c, Object.assign(plain(st), patch));
  assert.deepEqual([raw({ region: "mine_3", scene: "floor" }).region, raw({ region: "mine_3", scene: "floor" }).scene], ["第三采矿场", "floor"]);
  assert.equal(raw({ region: "第二采矿场", scene: "mid" }).scene, "mid");
  assert.equal(raw({ region: "沙漠", scene: "coral" }).scene, "coral");
  for (const [region, bad] of [["第三采矿场", "mid"], ["第一采矿场", "dune"], ["沙漠", "rim"], ["外城区", "floor"], ["沙漠", "Dune"], ["沙漠", "dune "], ["沙漠", "<img src=x>"],
    ["沙漠", "dune 坚毅 732911"], ["沙漠", "shp"], ["沙漠", ""], ["沙漠", 42], ["沙漠", true], ["沙漠", null], ["沙漠", { id: "dune" }], ["沙漠", ["dune"]],
    ["沙漠", "__proto__"], ["月球", "dune"], [null, "dune"], [undefined, "rim"], ["", "rim"]])
    assert.equal(raw({ region, scene: bad }).scene, undefined, `场景不发：${JSON.stringify(region)} / ${JSON.stringify(bad)}`);
  // 主机没有配置表（只加载了 online-view.js）：场景一律不发
  const V = require("../online-view.js");
  assert.equal(V.projectState({ units: [], region: "沙漠", scene: "dune", light: "day" }).scene, undefined);
  // 发给玩家的整包（projectPacket）里也有，同样没有坚毅生命
  const pk = plain(c.OnlineView.projectPacket({ type: "result", seq: 1, state: st }, { recipientId: "p1", gmId: "host", itemCatalog: {} }));
  assert.deepEqual([pk.state.region, pk.state.scene], ["沙漠", "dune"]);
  noShp(pk);
  assert.equal(pk.state.sceneMap, undefined);
  assert.equal(pk.state.scenePick, undefined);
});

test("联机跑团：房主在战场配置里换场景，战斗中也能换，玩家收到的跟着变；跟着地图的，房主每次发包前按场上的场地重算（沙珊瑚台地）；公开记录写「主持人调整了战场」", async () => {
  const c = H.load(), queued = [], token = {};
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], region: "第一采矿场", seed: "SCN-ONLINE" });
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false, legacyAddedEnemies() {},
    queueHostEdit(fn) { return new Promise(resolve => queued.push(() => resolve(fn()))); } };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-legacy.js", "online-view.js"]) load(c, f);
  c.GMCommands.configure({ requireHost: ctx => ctx === token });
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "玩家" }], assignments: {} }).ok, true);
  c.HotseatGame.startCombat();
  const player = () => plain(c.OnlineView.projectPacket({ type: "result", seq: 1, state: c.S.state }, { recipientId: "p2", gmId: "host", itemCatalog: {} })).state;
  assert.deepEqual([player().region, player().scene], ["第一采矿场", "rim"]);
  c.Commands.dispatch({ type: "battle.panel", action: "setScene", value: "floor" });
  assert.equal(player().scene, "floor", "战斗中主持人改了，玩家收到的跟着变");
  // 正在播动画：排到播完再改（和战场配置里别的修改一样）；排着的时候先换了区域，场景按换完的区域认（沙珊瑚台地是沙漠的）
  c.GAME.depth = 1;
  c.Commands.dispatch({ type: "battle.panel", action: "setRegion", value: "沙漠" });
  c.Commands.dispatch({ type: "battle.panel", action: "setScene", value: "coral" });
  assert.deepEqual([player().region, player().scene], ["第一采矿场", "floor"]);
  c.GAME.depth = 0; while (queued.length) queued.shift()(); await Promise.resolve();
  assert.deepEqual([c.S.state.region, c.S.state.scene, c.S.state.scenePick], ["沙漠", "coral", "coral"]);
  assert.deepEqual([player().region, player().scene], ["沙漠", "coral"]);
  // 跟着地图的：场地变了（主持人放了沙珊瑚台地），房主发包前重算（online-game.js · rawPacket → battleLookSync）
  c.Commands.dispatch({ type: "battle.panel", action: "setScene", value: "" });
  assert.equal(player().scene, "dune");
  c.HotseatGame.system({ type: "gm.setField", zone: 1, patch: { coral: true } }, token);
  assert.equal(c.S.state.fields[1].coral, true);
  c.battleLookSync();   // 房主发包前（rawPacket）做的就是这个
  assert.equal(player().scene, "coral");
  const og = code("online-game.js"), raw = og.slice(og.indexOf("function rawPacket("));
  assert.ok(/battleLookSync\(\)/.test(raw.slice(0, raw.indexOf("return {"))), "rawPacket 发包前重算");
  assert.match(og, /\["setRegion", "setScene", "setLight"\]\.includes\(cmd\.action\)[\s\S]{0,120}"主持人调整了战场"/, "换场景也写「主持人调整了战场」");
});

/* ---------- 6. 战场配置界面 ---------- */
test("战场配置（game.html / game.js）：「所在区域」旁边一个「场景」下拉框，第一项「跟着地图（当前：……）」，选项跟着当前区域变；改了区域就重画（场景的选项跟着变）", () => {
  const html = read("game.html");
  const sheet = html.slice(html.indexOf('<div class="sheet" id="g-field-sheet">'), html.indexOf('<div class="sheet" id="g-enc-sheet">'));
  assert.match(sheet, /场景\s*<select id="g-cfg-scene"><\/select>/);
  const at = id => sheet.indexOf(`id="${id}"`);
  assert.ok(at("g-cfg-region") > 0 && at("g-cfg-region") < at("g-cfg-scene") && at("g-cfg-scene") < at("g-cfg-light"), "在「所在区域」和「光影」中间");
  assert.match(sheet, /id="g-cfg-look-note">[^<]*所在区域、场景、光影只是画面[^<]*不改任何结算/);
  const js = read("game.js");
  const fn = js.slice(js.indexOf("function renderLookSelects() {"), js.indexOf("function renderFieldSheet() {"));
  assert.match(fn, /跟着地图（当前：\$\{esc\(here \|\| "没有"\)\}）/);
  assert.match(fn, /battleScenes\(region\)\.map\(/, "选项是当前区域的场景");
  assert.match(fn, /battleSceneAuto\(region\)/, "第一项写的是现在默认的那个场景");
  assert.match(js, /\$\("g-cfg-scene"\)\.onchange = \(\) => setLook\("setScene"/);
  // 改好了（不是排着等动画播完）就重画：换了区域，场景的选项跟着变
  assert.match(fn, /if \(\(state\[LOOK_PICK\[action\]\] \|\| ""\) === value\) renderLookSelects\(\);/);
  assert.match(js, /const LOOK_PICK = \{ setRegion: "regionPick", setScene: "scenePick", setLight: "lightPick" \};/);
});

/* ---------- 浏览器：主持人在战场配置里换场景（没装 Playwright 时跳过） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
let browser = null;
test.before(async () => { const pw = playwright(); if (!pw) return; try { browser = await pw.chromium.launch(); } catch (e) { if (process.env.REQUIRE_UI === "1") throw e; } });
test.after(async () => { if (browser) await browser.close(); });

test("浏览器 · 跑团战场配置：场景下拉框默认「跟着地图（当前：矿外）」，选项是这个区域的场景；选了就用选的；换区域选项跟着变，新区域没有的回到跟着地图", async (t) => {
  if (!browser) { if (process.env.REQUIRE_UI === "1") throw new Error("UI 验收需要 Playwright"); t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => (d.type() === "prompt" ? d.accept("测试团") : d.accept()));
  await page.goto(pathToFileURL(path.join(H.ROOT, "game.html")).href);
  await page.evaluate(() => { window.__noLevelUpPopup = true; });
  await page.click("#t-online"); await page.click("#t-sandbox");
  await page.click('[data-new="0"]');
  await page.waitForSelector("#scr-trpg:not([hidden])");
  await page.evaluate(() => { LEDGER.place = "mine_1"; });
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  await page.click("#g-field-cfg");
  await page.waitForSelector("#g-field-sheet.show");
  const opts = sel => page.$$eval(sel + " option", os => os.map(o => [o.value, o.textContent]));
  assert.deepEqual(await opts("#g-cfg-scene"), [["", "跟着地图（当前：矿外）"], ["rim", "矿外"], ["mid", "矿内"], ["floor", "矿底"]]);
  assert.match(await page.textContent("#g-cfg-look-note"), /场景/);
  await page.selectOption("#g-cfg-scene", "floor");
  assert.deepEqual(await page.evaluate(() => [state.region, state.scene, state.scenePick]), ["第一采矿场", "floor", "floor"]);
  assert.equal(await page.inputValue("#g-cfg-scene"), "floor");
  // 换区域：选项跟着变；新区域也有矿底就留着
  await page.selectOption("#g-cfg-region", "第三采矿场");
  assert.deepEqual(await opts("#g-cfg-scene"), [["", "跟着地图（当前：矿外）"], ["rim", "矿外"], ["floor", "矿底"]]);
  assert.equal(await page.inputValue("#g-cfg-scene"), "floor");
  assert.equal(await page.inputValue("#g-cfg-region"), "第三采矿场");
  // 沙漠没有矿底：回到跟着地图
  await page.selectOption("#g-cfg-region", "沙漠");
  const coral = await page.evaluate(() => boardZoneIds().some(z => state.fields[z] && state.fields[z].coral));
  const here = coral ? "沙珊瑚台地" : "沙丘";
  assert.deepEqual(await opts("#g-cfg-scene"), [["", `跟着地图（当前：${here}）`], ["dune", "沙丘"], ["coral", "沙珊瑚台地"]]);
  assert.equal(await page.inputValue("#g-cfg-scene"), "");
  assert.deepEqual(await page.evaluate(() => [state.region, state.scene, state.scenePick]), ["沙漠", coral ? "coral" : "dune", null]);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
});
