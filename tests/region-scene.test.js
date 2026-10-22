// 区域下面再分「场景」（issue #239，接着 #229 的 state.region / state.light）：
//   采矿场的矿外 / 矿内 / 矿底（第三采矿场没有矿内），沙漠的沙丘 / 沙珊瑚台地，别的区域暂时各一个。
//   默认（主人在 issue 里补充的规则）：单局每场按这场战斗的种子在区域的场景里随机抽一个（不动战斗用的随机数）；
//   跑团 / 战斗原型用列表第一个（采矿场 = 矿外）；沙漠场上有沙珊瑚台地场地时固定是沙珊瑚台地。
//   主持人在战场配置里可以改；联机白名单只放行当前区域认得的场景 id（坚毅生命照旧不发）；只是画面的标签，不改任何结算
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
/** 自己写的遭遇（不掷随机的场地）：region、features（场地 / 配置物） */
const enc = (region, extra) => Object.assign({ id: "t-scene", name: "场景测试", region, zoneMode: 2, enemies: [{ preset: "thug_knife", zone: 2 }], features: [] }, extra || {});
const coralAt = (zone) => [{ type: "field", what: "coral", zone }];

/** 战斗原型 / 跑团的战斗画面那条路：battle.setup（和 game.js · setupBattle 同一条指令） */
function field() {
  const c = H.load();
  c.GAME = { partyKits: PARTY.slice() };
  return c;
}
/** 单局：这一站是战斗，按 rogue.js · battleSpec 开战（和 game.js · startRogueBattle 同一条指令）。patch 可以改开战数据（测试用） */
function rogueBattle(c, run, patch) {
  if (!run.task) c.Rogue.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = c.Rogue.battleSpec(run);
  if (patch) patch(spec);
  c.dispatch({ type: "battle.setupRogue", spec: c.BattleCommands.battleSpecData(spec) }, { before: spec.before });
  return spec;
}
/** 新开一局（种子 seed），这一幕走 region（幕间改走的采矿场就是这样记的：run.regionPick） */
function rogueRun(c, seed, region) {
  const run = c.Rogue.newRun({ party: PARTY, seed });
  if (region) run.regionPick = { [run.act]: region };
  return run;
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
const onBoardCoral = c => c.boardZoneIds().some(z => c.S.state.fields[z] && c.S.state.fields[z].coral);

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
  // 沙漠：场上有沙珊瑚台地场地时固定用沙珊瑚台地 —— 写在表里（field），不写死在逻辑里
  assert.equal(T["沙漠"].find(s => s.id === "coral").field, "coral");
  assert.ok(R.every(r => T[r].every(s => s.id === "coral" ? s.field === "coral" : s.field === undefined)), "只有沙珊瑚台地带 field");
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

test("HD-2D 原型的地面主题表按场景留出接口（hd2d-layout.js · SCENES）：区域、场景 id 和正式的场景表一一对上，先都用所属区域现在的样子；布局带上场景", () => {
  const c = H.load(), T = vm.runInContext("BATTLE_SCENES", c), L = require("../prototypes/hd2d/hd2d-layout.js");
  assert.deepEqual(Object.keys(L.SCENES).sort(), Object.keys(T).sort(), "原型的 SCENES 和正式的场景表区域一一对上");
  Object.entries(T).forEach(([r, list]) => {
    assert.deepEqual(Object.keys(L.SCENES[r]).sort(), plain(list.map(s => s.id)).sort(), r + "：场景 id 一一对上");
    list.forEach(s => {
      assert.ok(L.GROUNDS[L.SCENES[r][s.id]], `${r} · ${s.name}：地面主题在 GROUNDS 里`);
      assert.equal(L.groundOf(r, s.id), L.groundOf(r), `${r} · ${s.name}：先用所属区域现在的样子`);
      assert.equal(L.sceneOf(r, s.id), s.id);
    });
  });
  // 认不得的场景 = 区域自己的样子；认不得的区域 = 兜底；地图地点 id 也认
  assert.equal(L.groundOf("第一采矿场", "dune"), L.groundOf("第一采矿场"));
  assert.equal(L.groundOf("mine_2", "floor"), "mine2");
  assert.equal(L.sceneOf("mine_2", "floor"), "floor");
  assert.equal(L.groundOf("月球", "rim"), L.GROUND_DEFAULT);
  for (const [r, s] of [["第三采矿场", "mid"], ["沙漠", "rim"], ["月球", "rim"], ["第一采矿场", "__proto__"], ["第一采矿场", "constructor"], ["第一采矿场", undefined], ["第一采矿场", 1]])
    assert.equal(L.sceneOf(r, s), null, `认不得：${r} / ${String(s)}`);
  // 布局：给了场景就带上（out.scene），地面主题按「区域 + 场景」挑
  const st = { zoneMode: 2, units: [], fields: {}, gaps: {} };
  const out = L.build(st, { region: "第一采矿场", scene: "floor" });
  assert.deepEqual([out.region, out.scene, out.ground], ["第一采矿场", "floor", "mine1"]);
  assert.equal(L.build(st, { region: "第三采矿场", scene: "mid" }).scene, null, "第三采矿场没有矿内");
  assert.equal(L.build(st, { region: "第一采矿场" }).scene, null);
  assert.equal(L.build(st, { scene: "rim" }).scene, null, "没有区域就没有场景");
});

/* ---------- 2. 默认：跑团 / 战斗原型 ---------- */
test("默认（跑团 / 战斗原型）：列表第一个——采矿场是矿外（遭遇、BattleSim.setup、跑团队伍在地图上的采矿场都是）；只有一个场景的区域就是它；没有区域的战斗没有场景", () => {
  // 遭遇 / 战斗原型：BattleSim.setup 给的 region（地点 id 也认）、随机遭遇
  const c = H.load();
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "mine_2", seed: "SCN-SPEC" });
  assert.deepEqual(look(c), ["第二采矿场", "rim", null]);
  assert.equal(c.S.state.sceneRoll, null, "不是单局：不随机");
  for (const mine of ["第一采矿场", "第二采矿场", "第三采矿场"]) {
    for (let i = 0; i < 6; i++) {
      c.BattleSim.setup({ party: PARTY, encounter: rolled(c, { region: mine }), seed: `SCN-ROLL-${mine}-${i}` });
      assert.deepEqual(look(c), [mine, "rim", null], `${mine} · 随机遭遇 ${i}：种子不同也是矿外`);
    }
  }
  // 只有一个场景的区域
  for (const [r, s] of [["外城区", "street"], ["巨人城", "city"], ["天网设施", "facility"], ["天网塔", "facility"], ["下水道", "tunnel"]]) {
    c.BattleSim.setup({ party: PARTY, enemies: [], region: r, seed: "SCN-ONE" });
    assert.equal(c.S.state.scene, s, r);
  }
  c.BattleSim.setup({ party: PARTY, enemies: [], region: "月球", seed: "SCN-NOREGION" });
  assert.deepEqual(look(c), [null, null, null], "认不得的区域没有场景");
  c.BattleSim.setup({ party: PARTY, enemies: [], seed: "SCN-NONE" });
  assert.deepEqual(look(c), [null, null, null], "没有区域的战斗（训练场之类）");
  // 战斗原型的遭遇（battle.setup，和战斗画面「遭遇」面板开战同一条）
  const f = field();
  f.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场") });
  assert.deepEqual(look(f), ["第一采矿场", "rim", null]);
  f.dispatch({ type: "battle.setup", level: 1, encounter: rolled(f, { region: "第三采矿场" }) });
  assert.deepEqual(look(f), ["第三采矿场", "rim", null]);
  f.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.deepEqual([...look(f), f.S.state.sceneRoll], [null, null, null, null], "默认阵容没有区域、没有场景，上一场的不带过来");
  // 跑团：队伍在地图上的地点 → 区域 → 列表第一个（不看地图、遭遇上有没有矿外 / 矿内 / 矿底的标记）
  const t = field();
  t.S.TRPG.active = true;
  t.LEDGER.place = "mine_1";
  t.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.deepEqual(look(t), ["第一采矿场", "rim", null]);
  t.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场", { scene: "floor" }) });
  assert.deepEqual(look(t), ["第一采矿场", "rim", null], "遭遇上写的 scene 不算（不按地图 / 遭遇标记）");
  t.LEDGER.place = "mine_3";
  t.dispatch({ type: "battle.setup", level: 1, encounter: rolled(t, { region: "沙漠" }) });
  assert.deepEqual(look(t), ["第三采矿场", "rim", null], "跑团先看地图：队伍在第三采矿场");
  t.LEDGER.place = null;
  t.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(1) }) });
  assert.deepEqual(look(t), ["沙漠", "coral", null], "地图上没标队伍的位置：用遭遇的区域，场上有沙珊瑚台地");
  for (const x of [c, f, t]) assert.deepEqual(x.__errors, []);
});

test("默认（沙漠）：场上有沙珊瑚台地场地 → 沙珊瑚台地，否则沙丘；沙珊瑚枝不算，不在场上的区不算；战斗中台地出现 / 消失，重算（联机每次发包前）就跟着变", () => {
  const c = H.load(), st = () => c.S.state;
  c.BattleSim.setup({ party: PARTY, encounter: enc("沙漠"), seed: "SCN-DUNE" });
  assert.deepEqual(look(c), ["沙漠", "dune", null]);
  c.BattleSim.setup({ party: PARTY, encounter: enc("沙漠", { features: coralAt(2) }), seed: "SCN-CORAL" });
  assert.equal(st().fields[2].coral, true);
  assert.deepEqual(look(c), ["沙漠", "coral", null]);
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
  // 随机的沙漠遭遇（遭遇表会掷沙珊瑚台地）：有台地就是台地，没有就是沙丘
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    c.BattleSim.setup({ party: PARTY, encounter: rolled(c, { region: "沙漠" }), seed: "SCN-ROLL-" + i });
    const coral = onBoardCoral(c);
    if (coral) seen++;
    assert.equal(st().scene, coral ? "coral" : "dune", "随机遭遇 " + i);
  }
  assert.ok(seen > 0, "随机沙漠遭遇里有带沙珊瑚台地的");
  assert.deepEqual(c.__errors, []);
});

/* ---------- 3. 默认：单局随机 ---------- */
test("单局：每场在这一幕区域的场景里随机抽一个（按这场战斗的种子）；同一种子抽出的一样（再开一次、读档以后、联机玩家收到的），不同种子能抽到不同的场景", () => {
  const draw = (seed, region) => {
    const c = H.load(), run = rogueRun(c, seed, region);
    const spec = rogueBattle(c, run);
    return { c, run, spec, scene: c.S.state.scene };
  };
  for (const [region, ids] of [["第一采矿场", ["rim", "mid", "floor"]], ["第二采矿场", ["rim", "mid", "floor"]], ["第三采矿场", ["rim", "floor"]]]) {
    const got = new Map();
    for (let i = 0; i < 30; i++) {
      const { c, spec, scene } = draw(`SCN-RUN-${i}`, region);
      assert.equal(c.S.state.region, region);
      assert.ok(ids.includes(scene), `${region} · 种子 ${i}：${scene} 在这个区域的场景里`);
      assert.equal(c.S.state.scenePick, null, "抽的不算主持人选的");
      assert.equal(typeof spec.sceneSeed, "string", "单局的开战数据带着抽场景用的种子");
      assert.ok(spec.sceneSeed.startsWith(spec.seed), "抽场景的种子从这场战斗的种子来");
      got.set(scene, (got.get(scene) || 0) + 1);
    }
    assert.deepEqual([...got.keys()].sort(), [...ids].sort(), `${region}：不同种子抽到了每一个场景（${JSON.stringify([...got])}）`);
  }
  // 同一种子：再开一次同一场（重开画面）、换个页面再开（另一套规则环境）都一样；联机玩家收到的也是它
  const a = draw("SCN-SAME", "第一采矿场"), b = draw("SCN-SAME", "第一采矿场");
  assert.equal(a.scene, b.scene);
  rogueBattle(a.c, a.run);
  assert.equal(a.c.S.state.scene, a.scene, "同一场再开一次：一样");
  assert.equal(projectIn(a.c).scene, a.scene, "联机玩家收到的就是它");
  // 读档：存档、换一套规则环境读回来，再开这一场
  a.c.Rogue.save(a.run);
  const c2 = H.load();
  c2.localStorage.setItem(c2.SaveStore.KEYS.run, a.c.localStorage.getItem(a.c.SaveStore.KEYS.run));
  const run2 = c2.SaveStore.loadRun();
  c2.Rogue.enterRunMode(run2);
  rogueBattle(c2, run2);
  assert.deepEqual([c2.S.state.region, c2.S.state.scene], ["第一采矿场", a.scene], "读档以后再开这一场：一样");
  // 同一局里不同的战斗（别的任务的战斗、首领战）各抽各的（种子不一样）；一整局下来不会每场都是同一个
  const c = H.load(), run = rogueRun(c, "SCN-ONE-RUN", "第一采矿场"), scenes = new Set(), seeds = new Set();
  c.Rogue.acceptTask(run, "main");
  for (let i = 0; i < 12; i++) {
    run.taskNo = 100 + i;   // 第几个任务（战斗的种子里有它）
    const spec = rogueBattle(c, run);
    scenes.add(c.S.state.scene); seeds.add(spec.sceneSeed);
  }
  assert.equal(seeds.size, 12, "每场的种子不一样");
  assert.ok(scenes.size >= 2, "同一局里的战斗不是全都同一个场景");
  run.stage = "boss";
  const boss = c.Rogue.battleSpec(run);
  assert.ok(boss.sceneSeed && boss.sceneSeed.startsWith(boss.seed), "首领战也按自己的种子抽");
  for (const x of [a.c, b.c, c2, c]) assert.deepEqual(x.__errors, []);
});

test("单局：沙漠场上有沙珊瑚台地场地时固定是沙珊瑚台地（画面和场地对得上）；没有时在沙丘 / 沙珊瑚台地里抽；只有一个场景的区域就是它", () => {
  let withCoral = 0;
  const free = new Set();
  for (let i = 0; i < 40; i++) {
    const c = H.load(), run = rogueRun(c, `SCN-DESERT-${i}`, "沙漠");
    rogueBattle(c, run);
    const coral = onBoardCoral(c);
    if (coral) { withCoral++; assert.equal(c.S.state.scene, "coral", `种子 ${i}：场上有沙珊瑚台地`); }
    else { assert.ok(["dune", "coral"].includes(c.S.state.scene)); free.add(c.S.state.scene); }
    // 这一场的战场上加一块沙珊瑚台地（同一个种子）：固定是沙珊瑚台地
    const c2 = H.load(), run2 = rogueRun(c2, `SCN-DESERT-${i}`, "沙漠");
    rogueBattle(c2, run2, spec => { spec.encounter.features = (spec.encounter.features || []).filter(f => f.what !== "coral").concat(coralAt(1)); });
    assert.equal(c2.S.state.fields[1].coral, true);
    assert.equal(c2.S.state.scene, "coral", `种子 ${i}：加了沙珊瑚台地`);
  }
  assert.deepEqual([...free].sort(), ["coral", "dune"], "没有沙珊瑚台地的沙漠战斗：两个场景都抽得到");
  assert.ok(withCoral > 0, "单局自己掷出来的战场里也有带沙珊瑚台地的（rogue-data.js · ROGUE_BATTLEFIELD）");
  // 只有一个场景的区域：单局抽来抽去也是它
  for (const [r, s] of [["外城区", "street"], ["巨人城", "city"], ["天网设施", "facility"]]) {
    for (let i = 0; i < 5; i++) {
      const c = H.load();
      rogueBattle(c, rogueRun(c, `SCN-SOLO-${r}-${i}`, r));
      assert.deepEqual([c.S.state.region, c.S.state.scene], [r, s]);
    }
  }
});

test("单局：抽场景不动战斗用的随机数——开战后随机流的位置、整场打下来的结果和不抽（去掉开战数据里的 sceneSeed）一模一样；抽的时候不调 Math.random", () => {
  // 找一个抽到的不是默认（矿外）的种子：抽和不抽的画面不一样，结算要一样
  let seed = null;
  for (let i = 0; i < 40 && !seed; i++) {
    const c = H.load();
    rogueBattle(c, rogueRun(c, `SCN-SEQ-${i}`, "第一采矿场"));
    if (c.S.state.scene !== "rim") seed = `SCN-SEQ-${i}`;
  }
  assert.ok(seed, "找得到抽到矿内 / 矿底的种子");
  const fight = (drop) => {
    const c = H.load(), run = rogueRun(c, seed, "第一采矿场");
    const spec = rogueBattle(c, run, drop ? s => { assert.ok(s.sceneSeed); delete s.sceneSeed; } : null);
    const draws = c.S.RNG.draws(), scene = c.S.state.scene, roll = c.S.state.sceneRoll;
    const result = plain(c.BattleSim.run({ maxRounds: 12 }));
    const rest = plain(c.S.state);
    delete rest.scene; delete rest.sceneRoll;
    (rest.floaters || []).forEach(f => { delete f.born; });   // 飘字出现的时刻（Date.now()，演出用），两次跑本来就不一样
    return { c, spec, draws, scene, roll, result, rest, after: c.S.RNG.draws() };
  };
  const on = fight(false), off = fight(true);
  assert.notEqual(on.scene, "rim", "抽了：矿内 / 矿底");
  assert.equal(off.scene, "rim", "没抽：默认的矿外");
  assert.equal(typeof on.roll, "number");
  assert.equal(off.roll, null);
  assert.equal(on.draws, off.draws, "开战后随机流在同一个位置");
  assert.ok(on.result.actions > 0 && on.result.rounds >= 1, "真打了几回合");
  assert.deepEqual(on.result, off.result, "整场打下来的结果一样");
  assert.equal(on.after, off.after, "打完以后随机流也在同一个位置");
  assert.deepEqual(on.rest, off.rest, "战斗状态除了场景以外一模一样");
  // 直接调开战时写画面的那一步：随机流不动（不用 Math.random，也不碰战斗装上的种子随机数）
  const c = H.load();
  c.S.RNG.install("SCN-SPY");
  const before = c.S.RNG.draws(), fn = c.Math.random;
  let calls = 0;
  c.Math.random = function () { calls++; return fn(); };
  try {
    c.battleLookStart({ region: "第一采矿场", sceneSeed: "SCN-SPY:fight:1:0:scene" });
    c.battleLookSync();
    c.battleLookSet({ region: "第三采矿场" });
  } finally { c.Math.random = fn; }
  assert.equal(calls, 0, "没调 Math.random");
  assert.equal(c.S.RNG.draws(), before, "战斗的随机流没动");
  assert.ok(["rim", "floor"].includes(c.S.state.scene));
  for (const x of [on.c, off.c, c]) assert.deepEqual(x.__errors, []);
});

/* ---------- 4. 换区域：回到新区域的默认 ---------- */
test("换区域：场景回到新区域的默认（跑团：列表第一个 / 沙漠看沙珊瑚台地；单局：用这场战斗抽的那个数在新区域里抽）；主持人选的场景新区域也有就留着，没有就回到默认", () => {
  const c = field(), st = () => c.S.state;
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场") });
  assert.deepEqual(look(c), ["第一采矿场", "rim", null]);
  const region = v => c.dispatch({ type: "battle.panel", action: "setRegion", value: v });
  const scene = v => c.dispatch({ type: "battle.panel", action: "setScene", value: v });
  // 没选场景：换区域 → 新区域的默认
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "dune", null]);
  st().fields[2].coral = true;
  region("外城区");
  assert.deepEqual(look(c), ["外城区", "street", null]);
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "coral", null], "换到沙漠：场上有沙珊瑚台地就是台地");
  st().fields[2].coral = false;
  region("");
  assert.deepEqual(look(c), ["第一采矿场", "rim", null], "回到跟着地图");
  // 主持人选了场景再换区域
  scene("mid");
  assert.deepEqual(look(c), ["第一采矿场", "mid", "mid"]);
  region("第二采矿场");
  assert.deepEqual(look(c), ["第二采矿场", "mid", "mid"], "第二采矿场也有矿内：留着");
  region("第三采矿场");
  assert.deepEqual(look(c), ["第三采矿场", "rim", null], "第三采矿场没有矿内：回到默认");
  region("第一采矿场");
  assert.deepEqual(look(c), ["第一采矿场", "rim", null], "回默认以后不会再冒出以前选的矿内");
  scene("floor");
  region("沙漠");
  assert.deepEqual(look(c), ["沙漠", "dune", null], "沙漠没有矿底：回到默认");
  // 一次改区域 + 场景（battleLookSet）：场景按改完的区域认；认不得就什么都不改
  c.battleLookSet({ region: "第三采矿场", scene: "floor" });
  assert.deepEqual(look(c), ["第三采矿场", "floor", "floor"]);
  const before = plain(st());
  assert.throws(() => c.battleLookSet({ region: "第二采矿场", scene: "dune" }), /认不得的场景/);
  assert.throws(() => c.battleLookSet({ region: "沙漠", scene: "floor" }), /认不得的场景/);
  assert.deepEqual(plain(st()), before);
  // 单局（单局的战斗画面没有战场配置，这里直接调）：换了区域，用这场战斗抽的那个数在新区域的场景里抽，同一个数抽出来的总是一样
  const r = H.load(), run = rogueRun(r, "SCN-RE", "第一采矿场");
  rogueBattle(r, run);
  const roll = r.S.state.sceneRoll;
  assert.ok(typeof roll === "number" && roll >= 0 && roll < 1, "单局开战时抽的数记在 state.sceneRoll");
  const want = (reg) => plain(r.battleScenes(reg))[Math.floor(roll * r.battleScenes(reg).length)].id;
  assert.equal(r.S.state.scene, want("第一采矿场"));
  for (const reg of ["第三采矿场", "第二采矿场", "外城区", "第一采矿场"]) {
    r.battleLookSet({ region: reg });
    assert.equal(r.S.state.scene, want(reg), "单局换到 " + reg);
    assert.equal(r.battleLookSync().scene, want(reg), "重算还是它");
  }
  for (const x of [c, r]) assert.deepEqual(x.__errors, []);
});

/* ---------- 5. 主持人改了以后用改的 ---------- */
test("主持人在战场配置里改场景：setScene 用选的（\"\" = 回到默认）；只认当前区域的场景，认不得的什么都不改；只管这一场，下一场开战清掉；布置战场时直接给的 scene 也算主持人选的", () => {
  const c = field(), st = () => c.S.state, scene = v => c.dispatch({ type: "battle.panel", action: "setScene", value: v });
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场") });
  assert.ok(c.BattleCommands.panelActions.includes("setScene"));
  assert.deepEqual(look(c), ["第一采矿场", "rim", null]);
  scene("floor");
  assert.deepEqual(look(c), ["第一采矿场", "floor", "floor"]);
  assert.equal(c.battleLookSync().scene, "floor", "重算以后还是选的");
  assert.equal(c.battleSceneAuto(st().region), "rim", "默认的还是矿外（下拉框写「跟着地图（当前：矿外）」）");
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
  // "" = 回到默认
  scene("");
  assert.deepEqual(look(c), ["第三采矿场", "rim", null]);
  // 沙漠：主持人选了沙丘，场上有沙珊瑚台地也照选的；选回默认又是台地
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
  // 布置战场时直接给的 scene（BattleSim.setup，和 light 一样：和主持人选的一样）；这个区域没有的不认
  c.BattleSim.setup({ party: PARTY, enemies: [], region: "第一采矿场", scene: "floor", seed: "SCN-PICK" });
  assert.deepEqual(look(c), ["第一采矿场", "floor", "floor"]);
  for (const bad of ["mid", "dune", "RIM", "", 42, null, { id: "floor" }, ["floor"]]) {
    c.BattleSim.setup({ party: PARTY, enemies: [], region: "第三采矿场", scene: bad, seed: "SCN-BAD" });
    assert.deepEqual(look(c), ["第三采矿场", "rim", null], "不认：" + JSON.stringify(bad));
  }
  // 单局里主持人（单机的测试、以后的入口）选了也用选的
  const r = H.load(), run = rogueRun(r, "SCN-PICK-ROGUE", "第一采矿场");
  rogueBattle(r, run);
  const drawn = r.S.state.scene, other = ["rim", "mid", "floor"].find(x => x !== drawn);
  r.dispatch({ type: "battle.panel", action: "setScene", value: other });
  assert.deepEqual([r.S.state.scene, r.S.state.scenePick], [other, other]);
  r.dispatch({ type: "battle.panel", action: "setScene", value: "" });
  assert.equal(r.S.state.scene, drawn, "回到默认：还是这场抽的那个");
  for (const x of [c, r]) assert.deepEqual(x.__errors, []);
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

/* ---------- 6. 只是画面 ---------- */
test("场景只是画面：规则文件里没有读场景的地方；改场景不动战场上的任何别的东西（场地、单位、配置物、天气、区域、光影），沙珊瑚台地照样是台地", () => {
  for (const f of H.RULE_FILES.filter(f => f !== "world-data.js")) {
    assert.doesNotMatch(code(f), /state\.(?:scene|scenePick|sceneRoll)\b/, f + " 读了画面用的场景");
  }
  const c = field(), st = () => c.S.state;
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("沙漠", { features: coralAt(2).concat([{ type: "prop", what: "coral_branch", zone: 1, faction: "neutral" }]) }) });
  const rest = () => { const s = plain(st()); delete s.scene; delete s.scenePick; return s; };
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

/* ---------- 7. 联机白名单 ---------- */
test("联机白名单（online-view.js · projectState）：只放行当前区域认得的场景 id，别的一律不发；没有区域就没有场景；主持人选的 / 单局抽的数这些房主字段不发；投影里没有坚毅生命", () => {
  const c = field();
  c.dispatch({ type: "battle.setup", level: 1, encounter: enc("第一采矿场") });
  const st = c.S.state;
  st.units.forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  let pv = projectIn(c);
  assert.deepEqual([pv.region, pv.scene], ["第一采矿场", "rim"]);
  noShp(pv);
  ["scenePick", "sceneRoll", "regionMap", "regionPick", "lightPick"].forEach(k => assert.equal(pv[k], undefined, k + " 是房主自己的，不发"));
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
  assert.equal(pk.state.scenePick, undefined);
  assert.equal(pk.state.sceneRoll, undefined);
  // 单局：投影里是抽到的那个场景，抽的数（sceneRoll）不发
  const r = H.load();
  rogueBattle(r, rogueRun(r, "SCN-WIRE", "第二采矿场"));
  r.S.state.units.forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  const rv = projectIn(r);
  assert.deepEqual([rv.region, rv.scene], ["第二采矿场", r.S.state.scene]);
  assert.equal(typeof r.S.state.sceneRoll, "number");
  assert.equal(rv.sceneRoll, undefined);
  noShp(rv);
});

test("联机跑团：房主在战场配置里换场景，战斗中也能换，玩家收到的跟着变；没选的，房主每次发包前按场上的场地重算（沙珊瑚台地）；公开记录写「主持人调整了战场」", async () => {
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
  // 没选的：场地变了（主持人放了沙珊瑚台地），房主发包前重算（online-game.js · rawPacket → battleLookSync）
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

/* ---------- 8. 战场配置界面 ---------- */
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

/* ---------- 9. HD-2D 原型接上 ---------- */
test("HD-2D 原型：画面读投影里的 pv.scene，没有再用页面选的兜底；顶栏的场景下拉框（选项跟着区域变，网址 ?scene=）选的当成布置战场写进战斗状态；不绕开白名单读房主的 st", () => {
  const html = read("prototypes/hd2d/index.html");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.includes('id="scene-select"'), "顶栏有场景下拉框");
  assert.ok(new RegExp(/var OWN = \/(.*)\/;/.exec(html)[1]).test("scene-select"), "垫片认得场景下拉框是页面自己的元素");
  assert.match(mod, /const sceneNow = \(\) => \(pv && pv\.scene\) \|\| scenePick;/);
  assert.equal((mod.match(/L\.build\((?:project\(\)|pv), \{[^}]*region: regionNow\(\), scene: sceneNow\(\), theme: themeNow\(\) \}\)/g) || []).length, 2, "两处排布局都带上场景");
  assert.match(mod, /battleLookStart\(\{ region: pageRegion\(\), scene: scenePick, light: demo\.theme \}\)/, "页面选的场景当成布置战场写进战斗状态");
  assert.match(mod, /function loadDemo\(id\) \{[\s\S]*?st = demo\.make\(pageRegion\(\)\);\s*placeLook\(\);/, "演示布置完（场地都摆好了）再写一遍，场景的默认看得到沙珊瑚台地");
  assert.match(mod, /\.get\("scene"\)/, "网址参数 ?scene=");
  assert.match(mod, /battleScenes\(/, "下拉框列的是正式场景表里当前区域的场景");
  assert.doesNotMatch(mod, /\bst\.(?:scene|scenePick|sceneRoll)\b/, "不读房主原始 state 里的场景");
  const css = read("prototypes/hd2d/hd2d.css");
  assert.ok(/@media \(max-width: 720px\)[\s\S]*#scene-select[^{]*\{[^}]*display: none/.test(css), "手机上收起场景下拉框（和区域下拉框一样）");
  // 假网页：页面环境里投影过的演示战场有场景；演示布置完再写一遍（和页面一样），沙珊瑚台地算得上
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const P = page.ctx;
  let pv = P.OnlineView.projectState(P.BattleSim.setup({ party: PARTY, enemies: [], region: "第一采矿场", scene: "floor", light: "dusk", seed: "SCN-PAGE" }), {});
  assert.deepEqual([pv.region, pv.scene], ["第一采矿场", "floor"]);
  const st = P.BattleSim.setup({ party: PARTY, enemies: [], region: "沙漠", light: "day", seed: "SCN-PAGE2" });
  st.fields[2].coral = true;
  P.battleLookStart({ region: "沙漠", scene: null, light: "day" });
  pv = P.OnlineView.projectState(st, {});
  assert.deepEqual([pv.region, pv.scene], ["沙漠", "coral"]);
  P.battleLookStart({ region: "第三采矿场", scene: "mid", light: "day" });
  assert.equal(P.OnlineView.projectState(st, {}).scene, "rim", "页面选了这个区域没有的场景：主机不认，按默认");
  const none = P.OnlineView.projectState(P.BattleSim.setup({ party: PARTY, enemies: [], region: "?", scene: "rim", seed: "SCN-PAGE3" }), {});
  assert.equal(none.scene, undefined, "认不得的区域：投影里没有场景（画面用页面选的兜底）");
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

test("浏览器 · 跑团战场配置：场景下拉框默认「跟着地图（当前：矿外）」，选项是这个区域的场景；选了就用选的；换区域选项跟着变，新区域没有的回到默认", async (t) => {
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
  // 沙漠没有矿底：回到默认
  await page.selectOption("#g-cfg-region", "沙漠");
  const coral = await page.evaluate(() => boardZoneIds().some(z => state.fields[z] && state.fields[z].coral));
  const here = coral ? "沙珊瑚台地" : "沙丘";
  assert.deepEqual(await opts("#g-cfg-scene"), [["", `跟着地图（当前：${here}）`], ["dune", "沙丘"], ["coral", "沙珊瑚台地"]]);
  assert.equal(await page.inputValue("#g-cfg-scene"), "");
  assert.deepEqual(await page.evaluate(() => [state.region, state.scene, state.scenePick]), ["沙漠", coral ? "coral" : "dune", null]);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
});
