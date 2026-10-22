// 战斗状态带上「所在区域」和「光影（白天 / 傍晚 / 夜晚）」（issue #229）：
//   默认跟着地图 / 时钟走，主持人在战场配置里可以改；联机白名单只放行认得的值（坚毅生命照旧不发）；
//   只是画面的标签，不改任何结算（规则的白天 / 夜晚照旧跟着时钟）
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
const at = (h, m = 0) => h * 60 + m;
const PARTY = ["kolt", "helu"];
/** 随机遭遇（run.js · rollEncounter）：指令只收 JSON 数据（敌人行里有 level: undefined），和战斗画面一样先拷一份 */
const rolled = (c, opt) => plain(c.rollEncounter(opt));

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

/* ---------- 1. 一张表定几点到几点算白天 / 傍晚 / 夜晚 ---------- */
test("光影配置表（daylight.js）：白天 05:00–18:00、傍晚 18:00–20:00、夜晚 20:00–05:00；规则的夜晚 = 傍晚 + 夜晚，和联机玩家画面、长休日月、顶栏时段文字同一张表", () => {
  const c = H.load(), DL = c.DayLight;
  assert.ok(DL && DL.DAY_LIGHT, "daylight.js 的配置表在规则环境里");
  assert.deepEqual([...DL.LIGHTS], ["day", "dusk", "night"]);
  assert.deepEqual(plain(DL.NAMES), { day: "白天", dusk: "傍晚", night: "夜晚" });
  assert.deepEqual([at(4, 59), at(5), at(12), at(17, 59), at(18), at(19, 59), at(20), at(0), at(23, 59)].map(m => c.clockLight(m)),
    ["night", "day", "day", "day", "dusk", "dusk", "night", "night", "night"]);
  const PC = require("../party-cards.js");
  require("../rest-report.js");
  const RR = globalThis.RestReport;
  for (let m = 0; m < 1440; m++) {
    const light = c.clockLight(m), night = c.isNightClock(m);
    // 规则说是夜晚 ⇔ 画面不是白天：不会出现「规则说是夜晚、画面是白天」，也不会反过来
    assert.equal(night, light !== "day", `${m} 分：规则夜晚 ${night}，光影 ${light}`);
    assert.equal(PC.isNight(m), night, `${m} 分：联机玩家画面的夜晚和规则不一样`);
    assert.equal(RR.skyPos(m).body === "moon", night, `${m} 分：长休动画的日月和规则不一样`);
    // 顶栏时段文字的「傍晚」就是光影的傍晚，「夜晚 / 深夜」就是光影的夜晚
    assert.equal(c.dayPeriod(m) === "傍晚", light === "dusk", `${m} 分：时段文字 ${c.dayPeriod(m)}，光影 ${light}`);
    assert.equal(["夜晚", "深夜"].includes(c.dayPeriod(m)), light === "night", `${m} 分：时段文字 ${c.dayPeriod(m)}，光影 ${light}`);
    assert.equal(PC.dayPeriod(m), c.dayPeriod(m));
  }
  // 沙漠生物（规则）：傍晚已经按夜晚行动
  c.S.state.weather = "none";
  c.LEDGER.clock = at(18, 30); assert.equal(c.desertNight(), true);
  c.LEDGER.clock = at(17); assert.equal(c.desertNight(), false);
});

test("光影配置表只有一份：改了分界，规则（沙漠生物）、联机玩家画面、长休日月、顶栏时段文字一起变；规则文件和显示端都不再写死几点算夜晚", () => {
  const c = H.load();
  c.S.state.weather = "none";
  c.LEDGER.clock = at(17, 30);
  assert.equal(c.desertNight(), false);
  assert.equal(c.dayPeriod(at(17, 30)), "下午");
  c.DayLight.DAY_LIGHT.dusk = at(17);              // 规则环境里那一份
  assert.equal(c.isNightClock(at(17, 30)), true);
  assert.equal(c.clockLight(at(17, 30)), "dusk");
  assert.equal(c.desertNight(), true, "沙漠生物跟着表走");
  assert.equal(c.dayPeriod(at(17, 30)), "傍晚", "顶栏时段文字跟着表走");
  // 显示端（联机玩家页面不加载规则文件）：party-cards.js / rest-report.js 读的是 daylight.js 同一份
  const DL = require("../daylight.js"), PC = require("../party-cards.js");
  require("../rest-report.js");
  const RR = globalThis.RestReport, keep = DL.DAY_LIGHT.dusk;
  try {
    assert.equal(PC.isNight(at(17, 30)), false);
    DL.DAY_LIGHT.dusk = at(17);
    assert.equal(PC.isNight(at(17, 30)), true, "联机玩家画面跟着表走");
    assert.equal(PC.dayPeriod(at(17, 30)), "傍晚", "联机玩家的时钟文字跟着表走");
    assert.equal(RR.skyPos(at(17, 30)).body, "moon", "长休动画的日月跟着表走");
  } finally { DL.DAY_LIGHT.dusk = keep; }
  for (const f of ["ledger.js", "party-cards.js", "rest-report.js", "desert.js", "game.js", "online-ui.js"]) {
    assert.doesNotMatch(code(f), /\b(?:18|5|20)\s*\*\s*60\b/, f + "：几点算夜晚写死了（要读 daylight.js 的 DAY_LIGHT）");
  }
  assert.match(code("ledger.js"), /function isNightClock\(min\) \{ return DayLight\.isNight\(min\); \}/);
  // 加载顺序：daylight.js 在规则（ledger.js）、显示端（party-cards.js / rest-report.js）之前
  const html = read("game.html"), pos = f => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(pos("daylight.js") > 0 && pos("daylight.js") < pos("ledger.js") && pos("daylight.js") < pos("party-cards.js") && pos("daylight.js") < pos("rest-report.js"));
  assert.ok(H.RULE_FILES.indexOf("daylight.js") >= 0 && H.RULE_FILES.indexOf("daylight.js") < H.RULE_FILES.indexOf("ledger.js"));
});

/* ---------- 2. 正式的区域名列表 ---------- */
test("区域名列表在正式配置里（world-data.js · BATTLE_REGIONS）：单局的区域都在；地图地点 id / 天网塔对到区域，别的地点和乱写的认不得；HD-2D 原型的地面主题表和它一一对上", () => {
  const c = H.load(), R = vm.runInContext("BATTLE_REGIONS", c), C = c.S.ROGUE_CONFIG;
  C.regions.concat(Object.values(C.altRegions)).forEach(n => assert.ok(R.includes(n), "单局的区域 " + n + " 在列表里"));
  assert.ok(R.includes("下水道"), "下水道（原型先放的地面主题）也在");
  R.forEach(n => assert.equal(c.battleRegionName(n), n));
  Object.entries({ outer_city: "外城区", desert: "沙漠", giant_city: "巨人城", skynet: "天网设施", "天网塔": "天网设施",
    mine_1: "第一采矿场", mine_2: "第二采矿场", mine_3: "第三采矿场", " 沙漠 ": "沙漠" }).forEach(([x, n]) => assert.equal(c.battleRegionName(x), n, x));
  [undefined, null, "", "月球", "极北禁区", "north_zone", "starport", "太阳能板群", "solar_w", "<b>沙漠</b>", "__proto__", "constructor", "toString", 42, {}, ["沙漠"]]
    .forEach(x => assert.equal(c.battleRegionName(x), null, "认不得：" + String(x)));
  // 原型的表：区域名一一对上，别名（地图地点 id、天网塔）认出来的一样，地图上每个地点（id 和名字）两边认的都一样
  const L = require("../hd2d/hd2d-layout.js");   // HD-2D 战场的布局（#261 起在仓库根目录的 hd2d/）
  assert.deepEqual(Object.keys(L.REGIONS).sort(), [...R].sort(), "原型的 REGIONS 和正式的区域名列表一一对上");
  Object.entries(L.REGION_ALIAS).forEach(([alias, name]) => assert.equal(c.battleRegionName(alias), name, alias));
  c.S.WORLD_PLACES.forEach(p => [p.id, p.name].forEach(x => assert.equal(c.battleRegionName(x), L.regionName(x), x)));
  const fromAlias = c.S.WORLD_PLACES.map(p => p.id).filter(id => c.battleRegionName(id));
  assert.deepEqual([...fromAlias].sort(), Object.keys(L.REGION_ALIAS).filter(k => /^[a-z_0-9]+$/.test(k)).sort(), "地图地点 id：两边认的一样多");
});

/* ---------- 3. 默认跟着地图 ---------- */
test("默认跟着地图：单局 = 这一幕的区域（幕间改走的采矿场也是）；遭遇 / 战斗原型 = spec.region（地点 id 换成区域名）；没有区域的战斗 = 没有", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: PARTY, seed: "REG-ROGUE" });
  rogueBattle(c, run);
  assert.equal(c.S.state.region, R.region(run));
  assert.equal(c.S.state.region, "外城区");
  run.regionPick = { [run.act]: "第二采矿场" };     // 幕间选择：改走采矿场
  rogueBattle(c, run);
  assert.equal(c.S.state.region, "第二采矿场");
  assert.equal(c.S.state.regionMap, "第二采矿场");
  assert.equal(c.S.state.regionPick, null);
  // 遭遇：遭遇表 / 随机遭遇的 region
  c.BattleSim.setup({ party: PARTY, encounter: rolled(c, { region: "沙漠" }), seed: "REG-ENC" });
  assert.equal(c.S.state.region, "沙漠");
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "mine_2", seed: "REG-SPEC" });
  assert.equal(c.S.state.region, "第二采矿场", "BattleSim.setup 直接给 region（地点 id 也认）");
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "月球", seed: "REG-BAD" });
  assert.equal(c.S.state.region, null, "认不得的区域不写");
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "REG-NONE" });
  assert.equal(c.S.state.region, null, "没有区域的战斗（训练场之类）");
  // 战斗原型的遭遇（battle.setup，和战斗画面「遭遇」面板开战同一条）
  const f = field();
  f.dispatch({ type: "battle.setup", level: 1, encounter: rolled(f, { region: "巨人城" }) });
  assert.equal(f.S.state.region, "巨人城");
  f.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.equal(f.S.state.region, null, "默认阵容没有区域，上一场的不带过来");
});

test("默认跟着地图（跑团）：队伍在地图上的地点 → 区域（不是区域的地点 = 没有）；地图上没标位置时用遭遇的区域", () => {
  const c = field();
  c.S.TRPG.active = true;
  c.LEDGER.place = "mine_3";
  c.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.equal(c.S.state.region, "第三采矿场");
  c.LEDGER.place = "skynet";
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "沙漠" }) });
  assert.equal(c.S.state.region, "天网设施", "跑团先看地图：随机遭遇是沙漠的，队伍在天网塔");
  c.LEDGER.place = "starport";
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "沙漠" }) });
  assert.equal(c.S.state.region, null, "星际港口不是区域");
  c.LEDGER.place = null;
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "沙漠" }) });
  assert.equal(c.S.state.region, "沙漠", "地图上没标队伍的位置：用遭遇的区域");
  assert.deepEqual(c.__errors, []);
});

/* ---------- 4. 默认跟着时钟 ---------- */
test("默认跟着时钟：开战时按游戏时钟定光影（单局用本局的时钟）；推进时间以后重算就跟着变", () => {
  const c = field();
  for (const [h, light] of [[10, "day"], [18.5, "dusk"], [22, "night"], [3, "night"], [5, "day"]]) {
    c.LEDGER.clock = Math.round(h * 60);
    c.dispatch({ type: "battle.setup", level: 1, encounter: null });
    assert.equal(c.S.state.light, light, h + " 点");
  }
  // 战斗中推进时间（休整面板「过 N 小时」）：重算以后跟着时钟（联机发包前 online-game.js 也是这样重算的）
  c.LEDGER.clock = at(16);
  c.dispatch({ type: "battle.setup", level: 1, encounter: null });
  assert.equal(c.S.state.light, "day");
  c.dispatch({ type: "battle.panel", action: "advance", hours: 3 });
  assert.equal(c.battleLookSync().light, "dusk");
  assert.equal(c.S.state.light, "dusk");
  c.dispatch({ type: "battle.panel", action: "advance", hours: 2 });
  c.battleLookSync();
  assert.equal(c.S.state.light, "night");
  // 单局：本局的时钟（rogue.js 换上了本局的档案）
  const r = H.load(), run = r.Rogue.newRun({ party: PARTY, seed: "REG-CLOCK" });
  r.LEDGER.clock = at(21);
  rogueBattle(r, run);
  assert.equal(r.S.state.light, "night");
  r.LEDGER.clock = at(9);
  rogueBattle(r, run);
  assert.equal(r.S.state.light, "day");
  // BattleSim.setup 布置时也可以直接定光影（和主持人选的一样）
  r.BattleSim.setup({ party: PARTY, enemies: [], light: "dusk", seed: "REG-LIGHT" });
  assert.equal(r.S.state.light, "dusk");
  assert.equal(r.S.state.lightPick, "dusk");
  r.BattleSim.setup({ party: PARTY, enemies: [], light: "noon", seed: "REG-LIGHT2" });
  assert.equal(r.S.state.light, "day", "认不得的光影不认，跟着时钟");
});

/* ---------- 5. 主持人改了以后用改的 ---------- */
test("主持人在战场配置里改：setRegion / setLight 用选的（\"\" = 跟着地图 / 时钟）；认不得的值什么都不改；只管这一场，下一场开战回到跟着地图 / 时钟", () => {
  const c = field();
  c.LEDGER.clock = at(10);
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "外城区" }) });
  assert.deepEqual([c.S.state.region, c.S.state.light], ["外城区", "day"]);
  assert.ok(c.BattleCommands.panelActions.includes("setRegion") && c.BattleCommands.panelActions.includes("setLight"));
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "下水道" });
  c.dispatch({ type: "battle.panel", action: "setLight", value: "night" });
  assert.deepEqual([c.S.state.region, c.S.state.light, c.S.state.regionPick, c.S.state.lightPick], ["下水道", "night", "下水道", "night"]);
  c.LEDGER.clock = at(12); c.battleLookSync();
  assert.equal(c.S.state.light, "night", "选过的光影不跟着时钟");
  assert.equal(c.S.state.regionMap, "外城区", "地图上的区域还记着（下拉框写「跟着地图（当前：外城区）」）");
  // 认不得的值：指令层就拦下，什么都不改
  const before = plain(c.S.state);
  for (const cmd of [{ action: "setRegion", value: "月球" }, { action: "setRegion", value: "mine_1" }, { action: "setRegion", value: 42 }, { action: "setRegion" },
    { action: "setLight", value: "noon" }, { action: "setLight", value: "NIGHT" }, { action: "setLight", value: null }]) {
    assert.throws(() => c.dispatch(Object.assign({ type: "battle.panel" }, cmd)), /Unknown battle (region|light)/, JSON.stringify(cmd));
  }
  assert.deepEqual(plain(c.S.state), before);
  assert.throws(() => c.battleLookSet({ region: "月球" }), /认不得/);
  assert.throws(() => c.battleLookSet({ light: "noon" }), /认不得/);
  assert.deepEqual(plain(c.S.state), before);
  // 回到跟着地图 / 时钟
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "" });
  c.dispatch({ type: "battle.panel", action: "setLight", value: "" });
  assert.deepEqual([c.S.state.region, c.S.state.light, c.S.state.regionPick, c.S.state.lightPick], ["外城区", "day", null, null]);
  // 下一场开战：主持人选的清掉
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "沙漠" });
  c.dispatch({ type: "battle.panel", action: "setLight", value: "dusk" });
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "巨人城" }) });
  assert.deepEqual([c.S.state.region, c.S.state.light, c.S.state.regionPick, c.S.state.lightPick], ["巨人城", "day", null, null]);
});

test("只有主持人能改（热座 / 联机跑团同一套权限：battle.panel 只有房主能发）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: PARTY, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], region: "沙漠", seed: "REG-HOTSEAT" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1; c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) load(c, f);
  const [a, b] = PARTY.map(k => c.findKit(k, c.S.state.units));
  const players = [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }];
  assert.equal(c.HotseatGame.configure({ mode: "trpg", players, assignments: { [a.id]: "p1", [b.id]: "p2" } }).ok, true);
  const send = (id, cmd) => { c.HotseatGame.switchPlayer(id); return c.HotseatGame.submit(cmd); };
  assert.equal(send("p2", { type: "battle.panel", action: "setLight", value: "night" }).ok, false, "玩家不能改");
  assert.equal(c.S.state.lightPick, null);
  assert.equal(send("p1", { type: "battle.panel", action: "setLight", value: "night" }).ok, true, "主持人可以改");
  assert.equal(c.S.state.light, "night");
  assert.equal(send("p1", { type: "battle.panel", action: "setRegion", value: "巨人城" }).ok, true);
  assert.equal(c.S.state.region, "巨人城");
});

/* ---------- 6. 只是画面：改光影不影响夜晚规则 ---------- */
test("改光影不影响夜晚规则：白天把光影改成夜晚，沙漠生物照旧按白天；夜里改成白天，照旧按夜晚（规则只看时钟）", () => {
  const c = H.load();
  const setup = (clock, light) => {
    c.LEDGER.clock = clock;
    c.BattleSim.setup({ party: PARTY, enemies: [{ id: "sandfish_lead", lv: 3, zone: 2 }], region: "沙漠", seed: "REG-DESERT" });
    c.dispatch({ type: "battle.panel", action: "setLight", value: light });
    return c.S.state.units.find(u => u.kit === "sandfish_lead");
  };
  const lead = setup(at(10), "night");
  assert.equal(c.S.state.light, "night");
  assert.equal(c.desertNight(), false, "白天：光影改成夜晚，沙漠生物还是白天");
  assert.equal(c.isNightClock(c.clockNow()), false);
  assert.equal(c.fishBiteOpt(lead, null).diceS, 6, "领潮沙鱼白天「撞击」");
  const lead2 = setup(at(22), "day");
  assert.equal(c.S.state.light, "day");
  assert.equal(c.desertNight(), true, "夜里：光影改成白天，沙漠生物还是夜晚");
  assert.equal(c.fishBiteOpt(lead2, null).diceS, 8, "领潮沙鱼夜晚「撕咬」");
  // 规则代码里没有读光影 / 区域的地方：只有画面（投影、战场配置）和写它的那几个函数读
  for (const f of ["engine.js", "app.js", "desert.js", "ai.js", "effects.js", "enemies.js", "party.js", "boss-mechanics.js", "run.js", "rogue.js", "trpg.js", "ledger.js", "chain.js"]) {
    assert.doesNotMatch(code(f), /state\.(?:light|region|lightPick|regionPick|regionMap)\b/, f + " 读了画面用的区域 / 光影");
  }
});

/* ---------- 7. 联机白名单 ---------- */
test("联机白名单（online-view.js · projectState）：放行认得的区域名（地点 id 换成区域名）和三个光影值，别的一律不发；主持人选的 / 地图来的这些房主自己的字段不发；投影里没有坚毅生命", () => {
  const c = field();
  c.LEDGER.clock = at(19);
  c.dispatch({ type: "battle.setup", level: 1, encounter: rolled(c, { region: "第一采矿场" }) });
  const st = c.S.state;
  st.units.forEach(u => { u.shp = 732911; u.shpMax = 827319; });
  let pv = projectIn(c);
  assert.equal(pv.region, "第一采矿场");
  assert.equal(pv.light, "dusk");
  noShp(pv);
  ["regionMap", "regionPick", "lightPick"].forEach(k => assert.equal(pv[k], undefined, k + " 是房主自己的，不发"));
  // 主持人改了以后，投影跟着变
  c.dispatch({ type: "battle.panel", action: "setRegion", value: "天网设施" });
  c.dispatch({ type: "battle.panel", action: "setLight", value: "night" });
  pv = projectIn(c);
  assert.deepEqual([pv.region, pv.light], ["天网设施", "night"]);
  noShp(pv);
  // 只放行认得的：地点 id 换成区域名；乱写的、塞了别的东西的不发
  const raw = (patch) => projectIn(c, Object.assign(plain(st), patch));
  assert.equal(raw({ region: "mine_1" }).region, "第一采矿场");
  assert.equal(raw({ region: "天网塔" }).region, "天网设施");
  for (const bad of ["月球", "<img src=x>", "极北禁区", "沙漠 坚毅 732911", "", 42, null, { name: "沙漠" }, ["沙漠"]]) assert.equal(raw({ region: bad }).region, undefined, "区域不发：" + JSON.stringify(bad));
  for (const bad of ["noon", "Night", "dusk ", "", 1, true, null, { light: "day" }]) assert.equal(raw({ light: bad }).light, undefined, "光影不发：" + JSON.stringify(bad));
  for (const ok of ["day", "dusk", "night"]) assert.equal(raw({ light: ok }).light, ok);
  // 主机没有配置表（只加载了 online-view.js）：区域一律不发
  const V = require("../online-view.js");
  assert.equal(V.projectState({ units: [], region: "沙漠", light: "night" }).region, undefined);
  // 发给玩家的整包（projectPacket）里也有，同样没有坚毅生命
  const pk = plain(c.OnlineView.projectPacket({ type: "result", seq: 1, state: st }, { recipientId: "p1", gmId: "host", itemCatalog: {} }));
  assert.deepEqual([pk.state.region, pk.state.light], ["天网设施", "night"]);
  noShp(pk);
});

test("联机跑团：房主在战场配置里换光影 / 区域，战斗中也能换，玩家收到的跟着变；跟着时钟的，房主每次发包前按当前时钟重算；公开记录写「主持人调整了战场」", async () => {
  const c = H.load(), queued = [], token = {};
  c.LEDGER.clock = at(10);
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], region: "外城区", seed: "REG-ONLINE" });
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
  assert.deepEqual([player().region, player().light], ["外城区", "day"]);
  c.Commands.dispatch({ type: "battle.panel", action: "setLight", value: "night" });
  c.Commands.dispatch({ type: "battle.panel", action: "setRegion", value: "沙漠" });
  assert.deepEqual([player().region, player().light], ["沙漠", "night"], "战斗中主持人改了，玩家收到的跟着变");
  // 正在播动画：排到播完再改（和战场配置里别的修改一样）
  c.GAME.depth = 1;
  c.Commands.dispatch({ type: "battle.panel", action: "setLight", value: "" });
  assert.equal(player().light, "night");
  c.GAME.depth = 0; while (queued.length) queued.shift()(); await Promise.resolve();
  assert.equal(c.S.state.lightPick, null);
  // 跟着时钟：房主发包（online-game.js · rawPacket）前重算
  c.LEDGER.clock = at(23); c.battleLookSync();
  assert.equal(player().light, "night");
  const og = code("online-game.js"), raw = og.slice(og.indexOf("function rawPacket("));
  assert.ok(/battleLookSync\(\)/.test(raw.slice(0, raw.indexOf("return {"))), "rawPacket 发包前按当前时钟重算光影");
  assert.match(og, /\["setRegion", "setScene", "setLight"\]\.includes\(cmd\.action\)[\s\S]{0,120}"主持人调整了战场"/);   // #239 加了场景
  assert.ok(c.OnlineView.projectLogs([{ kind: "gm", summary: "主持人调整了战场" }])[0].text === "主持人调整了战场");
});

/* ---------- 8. 战场配置界面 ---------- */
test("战场配置（game.html / game.js）：「所在区域」「光影」两个下拉框，第一项「跟着地图 / 跟着时钟（当前：……）」，旁边一句说明只是画面、不改结算", () => {
  const html = read("game.html");
  const sheet = html.slice(html.indexOf('<div class="sheet" id="g-field-sheet">'), html.indexOf('<div class="sheet" id="g-enc-sheet">'));
  assert.match(sheet, /所在区域\s*<select id="g-cfg-region"><\/select>/);
  assert.match(sheet, /光影\s*<select id="g-cfg-light"><\/select>/);
  assert.match(sheet, /id="g-cfg-look-note">[^<]*只是画面[^<]*不改任何结算[^<]*白天 \/ 夜晚照旧跟着时钟/);
  const js = read("game.js");
  assert.match(js, /跟着地图（当前：\$\{esc\(auto \|\| "没有"\)\}）/);
  assert.match(js, /跟着时钟（当前：\$\{esc\(DayLight\.NAMES\[now\]\)\}）/);
  assert.match(js, /BATTLE_REGIONS\.map\(/);
  assert.match(js, /\$\("g-cfg-region"\)\.onchange = \(\) => setLook\("setRegion"/);
  assert.match(js, /\$\("g-cfg-light"\)\.onchange = \(\) => setLook\("setLight"/);
  assert.match(js, /function renderFieldSheet\(\) \{[\s\S]{0,300}renderLookSelects\(\);/);
});

/* ---------- 9. HD-2D 原型接上 ---------- */
test("HD-2D 原型：画面读投影里的 pv.region / pv.light，没有再用页面选的兜底；演示战场把区域、光影当成布置战场写进战斗状态；不绕开白名单读房主的 st", () => {
  const html = read("prototypes/hd2d/index.html");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.match(mod, /const regionNow = \(\) => \(pv && pv\.region\) \|\| pageRegion\(\);/);
  assert.match(mod, /const themeNow = \(\) => \(pv && pv\.light\) \|\| demo\.theme;/);
  assert.match(mod, /L\.build\(project\(\), \{[^}]*region: regionNow\(\), (?:scene: sceneNow\(\), )?theme: themeNow\(\) \}\)/);   // #239 加了场景
  assert.match(mod, /sc\.setBattle\(layout, \{ weather: pv\.weather, theme: themeNow\(\)/);
  assert.equal((mod.match(/BattleSim\.setup\(\{[^}]*region, light: this\.theme,/g) || []).length, 3, "三个演示都把区域、光影写进战斗状态");
  assert.doesNotMatch(mod, /\bst\.(?:region|light|regionMap|regionPick|lightPick)\b/, "不读房主原始 state 里的区域 / 光影");
  // 假网页：页面环境里投影过的演示战场有区域和光影；页面选了认不得的名字就没有（画面用页面选的兜底）
  const page = require("./hd2d-fake-page").load();
  assert.deepEqual(page.errors, []);
  const pv = page.ctx.OnlineView.projectState(page.ctx.BattleSim.setup({ party: PARTY, enemies: [], region: "沙漠", light: "night", seed: "REG-PAGE" }), {});
  assert.deepEqual([pv.region, pv.light], ["沙漠", "night"]);
  const none = page.ctx.OnlineView.projectState(page.ctx.BattleSim.setup({ party: PARTY, enemies: [], region: "?", seed: "REG-PAGE2" }), {});
  assert.equal(none.region, undefined);
});

/* ---------- 浏览器：主持人在战场配置里换区域 / 光影（没装 Playwright 时跳过） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
let browser = null;
test.before(async () => { const pw = playwright(); if (!pw) return; try { browser = await pw.chromium.launch(); } catch (e) { if (process.env.REQUIRE_UI === "1") throw e; } });
test.after(async () => { if (browser) await browser.close(); });

test("浏览器 · 跑团战场配置：下拉框默认「跟着地图（当前：第二采矿场）」「跟着时钟（当前：夜晚）」；选了别的就用选的，夜晚规则不变；选回第一项又跟着时钟", async (t) => {
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
  await page.evaluate(() => { LEDGER.place = "mine_2"; LEDGER.clock = 22 * 60; });
  await page.click("#tr-fight");
  await page.waitForSelector("#g-start");
  await page.click("#g-field-cfg");
  await page.waitForSelector("#g-field-sheet.show");
  const opts = sel => page.$$eval(sel + " option", os => os.map(o => [o.value, o.textContent]));
  const region = await opts("#g-cfg-region"), light = await opts("#g-cfg-light");
  assert.deepEqual(region[0], ["", "跟着地图（当前：第二采矿场）"]);
  assert.ok(region.some(([v]) => v === "沙漠") && region.some(([v]) => v === "下水道"));
  assert.deepEqual(light.map(o => o[1]), ["跟着时钟（当前：夜晚）", "白天", "傍晚", "夜晚"]);
  assert.match(await page.textContent("#g-cfg-look-note"), /不改任何结算/);
  assert.deepEqual(await page.evaluate(() => [state.region, state.light]), ["第二采矿场", "night"]);
  await page.selectOption("#g-cfg-region", "沙漠");
  await page.selectOption("#g-cfg-light", "day");
  assert.deepEqual(await page.evaluate(() => [state.region, state.light, desertNight()]), ["沙漠", "day", true], "光影改成白天，夜晚规则照旧");
  assert.equal(await page.inputValue("#g-cfg-light"), "day");
  await page.selectOption("#g-cfg-light", "");
  assert.equal(await page.evaluate(() => state.light), "night");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
});
